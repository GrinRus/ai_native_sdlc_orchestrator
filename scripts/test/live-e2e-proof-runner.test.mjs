import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadProofRunnerProfile } from "../live-e2e/lib/profile-catalog.mjs";
import { prepareAorInstallationProof } from "../live-e2e/lib/flows.mjs";
import { writeProofRunnerArtifacts } from "../live-e2e/run-profile.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const runProfileScript = path.join(repoRoot, "scripts/live-e2e/run-profile.mjs");

function withTempRoot(callback) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-live-e2e-proof-runner-"));
  try {
    callback(tempRoot);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function writeProfile(tempRoot, liveOverrides) {
  const profilePath = path.join(tempRoot, "profile.yaml");
  const live = {
    flow_range_policy: "delivery_default",
    installation_policy: "source-install-required",
    interaction_capability: "public-control-plane",
    frontend_capability: "none",
    safety_policy: "no-upstream-write",
    operator_mode: "skill-agent",
    agent_decision_policy: "required",
    interaction_answer_policy: "agent-required",
    target_write_policy: "aor-runtime-only-before-execution",
    ...liveOverrides,
  };
  fs.writeFileSync(
    profilePath,
    [
      "profile_id: live-e2e.test.skill-agent-only",
      "run_tier: acceptance",
      "journey_mode: full-journey",
      "target_catalog_id: ky",
      "feature_mission_id: regress-basic",
      "implementation_loop:",
      "  enabled: true",
      "  max_iterations: 1",
      "live_e2e:",
      ...Object.entries(live).map(([key, value]) => `  ${key}: ${value}`),
      "",
    ].join("\n"),
    "utf8",
  );
  return profilePath;
}

test("proof runner profile validation rejects deterministic operator mode", () => {
  withTempRoot((tempRoot) => {
    const profilePath = writeProfile(tempRoot, { operator_mode: "deterministic-fixture" });
    assert.throws(
      () => loadProofRunnerProfile({ hostRoot: repoRoot, profileRef: profilePath }),
      /live_e2e\.operator_mode must be skill-agent/u,
    );
  });
});

test("proof runner profile validation requires skill-agent decision policy", () => {
  withTempRoot((tempRoot) => {
    const profilePath = writeProfile(tempRoot, { agent_decision_policy: "optional" });
    assert.throws(
      () => loadProofRunnerProfile({ hostRoot: repoRoot, profileRef: profilePath }),
      /live_e2e\.agent_decision_policy must be required/u,
    );
  });
});

test("proof runner profile validation requires agent interaction answers", () => {
  withTempRoot((tempRoot) => {
    const profilePath = writeProfile(tempRoot, { interaction_answer_policy: "deterministic-fixture" });
    assert.throws(
      () => loadProofRunnerProfile({ hostRoot: repoRoot, profileRef: profilePath }),
      /live_e2e\.interaction_answer_policy must be agent-required/u,
    );
  });
});

test("proof runner profile validation accepts browser task frontend proof", () => {
  withTempRoot((tempRoot) => {
    const profilePath = writeProfile(tempRoot, { frontend_capability: "browser-task-proof" });
    const loaded = loadProofRunnerProfile({ hostRoot: repoRoot, profileRef: profilePath });
    assert.equal(loaded.profile.live_e2e.frontend_capability, "browser-task-proof");
  });
});

test("proof runner rejects removed --agent-judge-file flag before live execution", () => {
  const result = spawnSync(
    process.execPath,
    [runProfileScript, "--project-ref", repoRoot, "--profile", "scripts/live-e2e/profiles/full-journey-regress-ky.yaml", "--agent-judge-file", "judge.json"],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /--agent-judge-file is no longer supported/u);
});

test("proof runner rejects removed --examples-root flag before live execution", () => {
  const result = spawnSync(
    process.execPath,
    [runProfileScript, "--project-ref", repoRoot, "--profile", "scripts/live-e2e/profiles/full-journey-regress-ky.yaml", "--examples-root", "examples"],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /--examples-root is no longer supported/u);
});

test("proof runner reuses valid installation proof for manual resume", () => {
  withTempRoot((tempRoot) => {
    const reportsRoot = path.join(tempRoot, "reports");
    fs.mkdirSync(reportsRoot, { recursive: true });
    const runId = "cached-install-proof";
    const launcher = path.join(reportsRoot, "aor-session-launcher.sh");
    fs.writeFileSync(launcher, "#!/bin/sh\nexit 0\n", "utf8");
    fs.chmodSync(launcher, 0o755);
    const proofFile = path.join(reportsRoot, `live-e2e-aor-installation-proof-${runId}.json`);
    fs.writeFileSync(
      proofFile,
      `${JSON.stringify(
        {
          status: "pass",
          install_mode: "isolated",
          launcher_ref: launcher,
          command_transcripts: [path.join(reportsRoot, "01-help.json")],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const result = prepareAorInstallationProof({
      hostRoot: repoRoot,
      reportsRoot,
      runId,
      profile: { live_e2e: { installation_policy: "source-install-required" } },
      aorBinOverride: null,
      installMode: "isolated",
      isolatedWorkspaceRoot: path.join(tempRoot, "workspace"),
      isolatedSourceRoot: path.join(tempRoot, "source"),
      runtimeRoot: path.join(tempRoot, ".aor"),
    });

    assert.equal(result.proof.reused_for_manual_resume, true);
    assert.equal(result.launch.command, launcher);
    assert.equal(result.setupEntry.public_surface, "cached pnpm source install");
  });
});

test("proof runner writes partial quality summaries for blocked live E2E reports", () => {
  withTempRoot((tempRoot) => {
    const reportsRoot = path.join(tempRoot, "reports");
    const runtimeRoot = path.join(tempRoot, "runtime");
    const targetCheckoutRoot = path.join(tempRoot, "target");
    fs.mkdirSync(reportsRoot, { recursive: true });
    fs.mkdirSync(runtimeRoot, { recursive: true });
    fs.mkdirSync(targetCheckoutRoot, { recursive: true });

    const files = Object.fromEntries(
      [
        "controller-state.json",
        "install-proof.json",
        "generated-project.aor.yaml",
        "feature-request.json",
        "baseline-verify-summary.json",
        "discovery-plan.json",
        "discovery-execution.json",
        "discovery-inspection.json",
        "discovery-classification.json",
        "discovery-agent-request.json",
        "discovery-transcript.json",
      ].map((name) => [name, path.join(reportsRoot, name)]),
    );
    for (const file of Object.values(files)) {
      fs.writeFileSync(file, "{}\n", "utf8");
    }

    const runId = "blocked-partial-quality";
    const stepJournalEntry = {
      sequence: 1,
      step_id: "discovery",
      step_instance_id: "discovery",
      iteration: 1,
      flow_stage: "discovery",
      plan: {
        objective: "Observe discovery.",
        public_surface: "aor discovery run",
        command_labels: ["discovery-run"],
        expected_artifacts: ["analysis_report_file"],
        inspection_sources: ["command_transcript"],
        safety_constraints: ["no-upstream-write"],
      },
      plan_ref: files["discovery-plan.json"],
      public_surface: "aor discovery run",
      transcript_ref: files["discovery-transcript.json"],
      execution_ref: files["discovery-execution.json"],
      inspection_ref: files["discovery-inspection.json"],
      classification_ref: files["discovery-classification.json"],
      artifact_refs: [files["discovery-transcript.json"]],
      started_at: "2026-06-09T00:00:00.000Z",
      finished_at: "2026-06-09T00:00:01.000Z",
      duration_sec: 1,
      deterministic_analysis: {
        status: "pass",
        exit_code: 0,
        failure_class: null,
        missing_evidence: [],
        recommendation: "continue",
      },
      semantic_analysis: {
        status: "blocked",
        judge_source: "skill-agent",
        findings: ["Operator decision artifact is required before continuation."],
      },
      agent_decision_request_ref: files["discovery-agent-request.json"],
      operator_decision_ref: path.join(reportsRoot, "missing-decision.json"),
      operator_decision_status: "missing",
      inspected_evidence_refs: [],
      requested_interaction: null,
      decision: {
        action: "diagnose",
        reason: "Missing skill-agent operator decision.",
      },
      resume_result: null,
      frontend_interaction_refs: [],
      final_step_verdict: "blocked",
    };

    const written = writeProofRunnerArtifacts({
      hostRoot: repoRoot,
      hostProjectId: "aor-test",
      layout: { reportsRoot, runtimeRoot },
      runId,
      profilePath: path.join(tempRoot, "profile.yaml"),
      profile: {
        profile_id: "live-e2e.test.blocked-partial-quality",
        journey_mode: "full-journey",
        target_catalog_id: "ky",
        feature_mission_id: "ky-release-doc-typing",
        scenario_family: "release",
        provider_variant_id: "openai-primary",
        stages: ["bootstrap", "discovery", "spec", "planning", "handoff", "execution", "review", "qa", "delivery", "release"],
        live_e2e: {
          flow_range_policy: "full_lifecycle",
          operator_mode: "skill-agent",
          agent_decision_policy: "required",
          interaction_answer_policy: "agent-required",
          target_write_policy: "aor-runtime-only-before-execution",
        },
      },
      flowResult: {
        startedAt: "2026-06-09T00:00:00.000Z",
        finishedAt: "2026-06-09T00:00:02.000Z",
        status: "blocked",
        stageResults: [
          {
            stage: "discovery",
            status: "pass",
            evidence_refs: [files["discovery-transcript.json"]],
            summary: "Discovery reached an operator decision boundary.",
          },
        ],
        commandResults: [
          {
            label: "discovery-run",
            command_surface: "aor discovery run",
            status: "pass",
            exit_code: 0,
            transcript_file: files["discovery-transcript.json"],
            artifact_refs: [files["discovery-transcript.json"]],
          },
        ],
        artifacts: {
          host_runtime_root: runtimeRoot,
          host_reports_root: reportsRoot,
          live_e2e_controller_state_file: files["controller-state.json"],
          live_e2e_controller_stop: {
            decision: { action: "diagnose", next_step: "discovery" },
            state: { completed_steps: ["discovery"], current_step: "discovery" },
          },
          live_e2e_step_journal_entries: [stepJournalEntry],
          aor_installation: {
            status: "pass",
            declared_policy: "source-install-required",
            effective_policy: "source-install-required",
            install_mode: "repo-local",
            source_channel: "source-only-alpha",
            workspace_root: tempRoot,
            runtime_root: runtimeRoot,
            original_source_root: repoRoot,
            installed_source_root: repoRoot,
            launcher_ref: runProfileScript,
            command_transcripts: [],
          },
          aor_installation_proof_file: files["install-proof.json"],
          target_checkout_root: targetCheckoutRoot,
          generated_project_profile_file: files["generated-project.aor.yaml"],
          feature_request_file: files["feature-request.json"],
          baseline_verify_summary_file: files["baseline-verify-summary.json"],
          baseline_verify_status: "pass",
          feature_mission_id: "ky-release-doc-typing",
          feature_size: "medium",
        },
      },
      aorLaunch: {
        command: process.execPath,
        argsPrefix: [],
        binaryRef: runProfileScript,
      },
    });

    assert.equal(written.summary.status, "blocked");
    assert.equal(written.summary.continuation_status, "blocked");
    assert.equal(written.summary.blocked_step_id, "discovery");
    assert.equal(written.summary.runner_quality_summary.summary_type, "partial");
    assert.equal(written.summary.runner_quality_summary.lifecycle_completeness.pending_steps.includes("release"), true);
    assert.equal(written.summary.quality_judgement.judgement_type, "partial");
    assert.equal(written.summary.quality_judgement.provider_execution_status, "not_attempted");
    assert.notEqual(written.summary.runner_quality_summary, null);
    assert.notEqual(written.summary.quality_judgement, null);
  });
});

test("proof runner removes stale operator-boundary findings from accepted pass steps", () => {
  withTempRoot((tempRoot) => {
    const reportsRoot = path.join(tempRoot, "reports");
    const runtimeRoot = path.join(tempRoot, "runtime");
    const targetCheckoutRoot = path.join(tempRoot, "target");
    fs.mkdirSync(reportsRoot, { recursive: true });
    fs.mkdirSync(runtimeRoot, { recursive: true });
    fs.mkdirSync(targetCheckoutRoot, { recursive: true });

    const files = Object.fromEntries(
      [
        "controller-state.json",
        "install-proof.json",
        "generated-project.aor.yaml",
        "feature-request.json",
        "baseline-verify-summary.json",
        "post-run-verify-summary.json",
        "post-run-diagnostic-summary.json",
        "review-report.json",
        "runtime-harness-report.json",
        "evaluation-report.json",
        "delivery-manifest.json",
        "release-packet.json",
        "learning-scorecard.json",
        "learning-handoff.json",
        "command-transcript.json",
      ].map((name) => [name, path.join(reportsRoot, name)]),
    );
    for (const file of Object.values(files)) {
      fs.writeFileSync(file, "{}\n", "utf8");
    }
    fs.writeFileSync(files["review-report.json"], '{"code_quality":{"status":"pass","findings":[]}}\n', "utf8");

    const staleFinding = "Skill-agent operator decision is required before the next public step.";
    const steps = ["discovery", "spec", "planning", "handoff", "execution", "review", "qa", "delivery", "release", "learning"];
    const stepJournalEntries = steps.map((step, index) => {
      const planRef = path.join(reportsRoot, `${step}-plan.json`);
      const executionRef = path.join(reportsRoot, `${step}-execution.json`);
      const inspectionRef = path.join(reportsRoot, `${step}-inspection.json`);
      const classificationRef = path.join(reportsRoot, `${step}-classification.json`);
      const decisionRequestRef = path.join(reportsRoot, `${step}-agent-request.json`);
      const operatorDecisionRef = path.join(reportsRoot, `operator-decision-${step}.json`);
      for (const file of [
        planRef,
        executionRef,
        inspectionRef,
        classificationRef,
        decisionRequestRef,
        operatorDecisionRef,
      ]) {
        fs.writeFileSync(file, "{}\n", "utf8");
      }

      return {
        sequence: index + 1,
        step_id: step,
        step_instance_id: step,
        iteration: 1,
        flow_stage: step,
        plan: {
          objective: `Observe ${step}.`,
          public_surface: `aor ${step} run`,
          command_labels: [`${step}-run`],
          expected_artifacts: ["command_transcript"],
          inspection_sources: ["command_transcript"],
          safety_constraints: ["no-upstream-write"],
        },
        plan_ref: planRef,
        public_surface: `aor ${step} run`,
        transcript_ref: files["command-transcript.json"],
        execution_ref: executionRef,
        inspection_ref: inspectionRef,
        classification_ref: classificationRef,
        artifact_refs: [files["command-transcript.json"]],
        started_at: "2026-06-09T00:00:00.000Z",
        finished_at: "2026-06-09T00:00:01.000Z",
        duration_sec: 1,
        deterministic_analysis: {
          status: "pass",
          exit_code: 0,
          failure_class: null,
          missing_evidence: [],
          recommendation: "continue",
        },
        semantic_analysis: {
          status: "pass",
          judge_source: "skill-agent",
          findings: [staleFinding],
        },
        agent_decision_request_ref: decisionRequestRef,
        operator_decision_ref: operatorDecisionRef,
        operator_decision_status: "accepted",
        inspected_evidence_refs: [files["command-transcript.json"]],
        requested_interaction: null,
        decision: {
          action: "continue",
          reason: `${step} accepted.`,
          next_step: steps[index + 1] ?? null,
        },
        resume_result: null,
        frontend_interaction_refs: [],
        final_step_verdict: "pass",
      };
    });

    const runId = "accepted-pass-clears-stale-finding";
    const finalVerdictFile = path.join(reportsRoot, `live-e2e-final-skill-agent-verdict-${runId}.json`);
    fs.writeFileSync(
      finalVerdictFile,
      `${JSON.stringify(
        {
          verdict_id: `${runId}.final-skill-agent-verdict.v1`,
          run_id: runId,
          status: "pass",
          judge_source: "skill-agent",
          inspected_evidence_refs: [files["controller-state.json"]],
          evidence_refs: [files["controller-state.json"]],
          findings: [],
          final_recommendation: "accept",
          created_at: "2026-06-09T00:00:00.000Z",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const written = writeProofRunnerArtifacts({
      hostRoot: repoRoot,
      hostProjectId: "aor-test",
      layout: { reportsRoot, runtimeRoot },
      runId,
      profilePath: path.join(tempRoot, "profile.yaml"),
      profile: {
        profile_id: "live-e2e.test.accepted-pass-clears-stale-finding",
        journey_mode: "full-journey",
        target_catalog_id: "ky",
        feature_mission_id: "ky-release-doc-typing",
        scenario_family: "release",
        provider_variant_id: "openai-primary",
        run_tier: "acceptance",
        stages: ["bootstrap", ...steps],
        live_e2e: {
          flow_range_policy: "full_lifecycle",
          operator_mode: "skill-agent",
          agent_decision_policy: "required",
          interaction_answer_policy: "agent-required",
          target_write_policy: "aor-runtime-only-before-execution",
        },
      },
      flowResult: {
        startedAt: "2026-06-09T00:00:00.000Z",
        finishedAt: "2026-06-09T00:00:02.000Z",
        status: "pass",
        stageResults: steps.map((step) => ({
          stage: step,
          status: "pass",
          evidence_refs: [files["command-transcript.json"]],
          summary: `${step} passed.`,
        })),
        commandResults: [
          {
            label: "learning-handoff",
            command_surface: "aor learning handoff",
            status: "pass",
            exit_code: 0,
            transcript_file: files["command-transcript.json"],
            artifact_refs: [files["command-transcript.json"]],
          },
        ],
        artifacts: {
          host_runtime_root: runtimeRoot,
          host_reports_root: reportsRoot,
          live_e2e_controller_state_file: files["controller-state.json"],
          live_e2e_step_journal_entries: stepJournalEntries,
          aor_installation: {
            status: "pass",
            declared_policy: "source-install-required",
            effective_policy: "source-install-required",
            install_mode: "repo-local",
            source_channel: "source-only-alpha",
            workspace_root: tempRoot,
            runtime_root: runtimeRoot,
            original_source_root: repoRoot,
            installed_source_root: repoRoot,
            launcher_ref: runProfileScript,
            command_transcripts: [],
          },
          aor_installation_proof_file: files["install-proof.json"],
          target_checkout_root: targetCheckoutRoot,
          generated_project_profile_file: files["generated-project.aor.yaml"],
          feature_request_file: files["feature-request.json"],
          baseline_verify_summary_file: files["baseline-verify-summary.json"],
          baseline_verify_status: "pass",
          post_run_verify_summary_file: files["post-run-verify-summary.json"],
          post_run_verify_status: "pass",
          post_run_diagnostic_verify_summary_file: files["post-run-diagnostic-summary.json"],
          post_run_diagnostic_status: "pass",
          provider_execution_status: "pass",
          real_code_change_status: "pass",
          runtime_harness_decision: "pass",
          run_start_runtime_harness_decision: "pass",
          latest_runtime_harness_decision: "pass",
          runtime_harness_report_file: files["runtime-harness-report.json"],
          review_report_file: files["review-report.json"],
          evaluation_report_file: files["evaluation-report.json"],
          evaluation_status: "pass",
          delivery_manifest_file: files["delivery-manifest.json"],
          delivery_quality_gate_status: "pass",
          release_packet_file: files["release-packet.json"],
          release_status: "pass",
          learning_loop_scorecard_file: files["learning-scorecard.json"],
          learning_loop_handoff_file: files["learning-handoff.json"],
          quality_gate_decision: "pass",
          code_quality_status: "pass",
          feature_mission_id: "ky-release-doc-typing",
          feature_size: "medium",
          matrix_cell: { cell_id: "ky.release.medium.openai" },
        },
      },
      aorLaunch: {
        command: process.execPath,
        argsPrefix: [],
        binaryRef: runProfileScript,
      },
    });

    assert.equal(written.summary.status, "pass");
    const observationReport = JSON.parse(fs.readFileSync(written.summary.live_e2e_observation_report_file, "utf8"));
    assert.equal(observationReport.overall_status, "pass");
    assert.deepEqual(observationReport.final_analysis.findings, []);
    assert.equal(
      observationReport.step_journal.every((entry) => !entry.semantic_analysis.findings.includes(staleFinding)),
      true,
    );
  });
});
