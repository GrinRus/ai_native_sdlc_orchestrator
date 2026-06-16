import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadContractFile } from "../../packages/contracts/src/index.mjs";
import {
  discoverHostProjectId,
  ensureRuntimeLayout,
  loadCatalogTarget,
  loadProofRunnerProfile,
  resolveCatalogRoot,
  resolveFullJourneyProfile,
} from "../live-e2e/lib/profile-catalog.mjs";
import {
  materializeFeatureRequestFile,
  materializeGeneratedProjectProfile,
  materializeProviderPinnedPolicyOverrides,
  materializeProviderPinnedRouteOverrides,
  materializeTargetCheckout,
} from "../live-e2e/lib/target-materialization.mjs";
import { runLiveAdapterPreflight } from "../live-e2e/lib/preflight.mjs";
import { buildProviderQualificationMatrix } from "../live-e2e/lib/provider-qualification-matrix.mjs";
import { applyProductionProofEvidence } from "../live-e2e/lib/production-proof.mjs";
import {
  archivedNextActionReportForMission,
  buildTargetPreExecutionStatusReport,
  evaluateBaselineVerifyGate,
  nextActionReportClosesFlow,
  prepareAorInstallationProof,
  runGuidedWebSmoke,
  runtimeHarnessReportHasMissionRelevantChanges,
  resolveExecutionStageStatusForRuntimeHarnessDecision,
} from "../live-e2e/lib/flows.mjs";
import {
  REQUIRED_GUIDED_COMMAND_LABELS,
  buildGuidedJourneyProof,
  validateGuidedJourneyProof,
} from "../live-e2e/lib/guided-proof.mjs";
import { writeProofRunnerArtifacts } from "../live-e2e/run-profile.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const runProfileScript = path.join(repoRoot, "scripts/live-e2e/run-profile.mjs");
const fullJourneyFlowScript = path.join(repoRoot, "scripts/live-e2e/lib/flows.mjs");
const manualLiveE2eScript = path.join(repoRoot, "scripts/live-e2e/manual-live-e2e.mjs");
const qualityAssessmentScript = path.join(repoRoot, "scripts/live-e2e/quality-assessment.mjs");
const qualificationLoopScript = path.join(repoRoot, "scripts/live-e2e/qualification-loop.mjs");

function withTempRoot(callback) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-live-e2e-proof-runner-"));
  try {
    callback(tempRoot);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function writeProfile(tempRoot, liveOverrides, options = {}) {
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
      ...(options.guidedJourney
        ? [
            "guided_journey:",
            "  enabled: true",
            "  proof_requirements:",
            "    - browser-task-proof",
            "    - flow-loop-proof",
            "    - quality-assessment-report",
            "  flow_loop_proof:",
            "    enabled: true",
            "  browser_task_proof:",
            "    required: true",
          ]
        : []),
      "",
    ].join("\n"),
    "utf8",
  );
  return profilePath;
}

function writeJsonFixture(filePath, payload = {}) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return filePath;
}

function writeGuidedProofFixture(tempRoot) {
  const targetCheckoutRoot = path.join(tempRoot, "target");
  const reportsRoot = path.join(tempRoot, "reports");
  fs.mkdirSync(path.join(targetCheckoutRoot, ".aor"), { recursive: true });
  fs.mkdirSync(reportsRoot, { recursive: true });
  const files = {
    onboarding: writeJsonFixture(path.join(targetCheckoutRoot, ".aor/projects/local-target/reports/onboarding-report.json")),
    missionPacket: writeJsonFixture(path.join(targetCheckoutRoot, ".aor/projects/local-target/artifacts/local-target.artifact.intake.first-flow.v1.json")),
    missionBody: writeJsonFixture(path.join(targetCheckoutRoot, ".aor/projects/local-target/artifacts/local-target.artifact.intake.first-flow.v1.body.json")),
    completedNext: writeJsonFixture(path.join(targetCheckoutRoot, ".aor/projects/local-target/reports/next-action-report-first-flow.json")),
    routedStep: writeJsonFixture(path.join(targetCheckoutRoot, ".aor/projects/local-target/reports/step-result.json")),
    reviewReport: writeJsonFixture(path.join(targetCheckoutRoot, ".aor/projects/local-target/reports/review-report.json")),
    reviewDecision: writeJsonFixture(path.join(targetCheckoutRoot, ".aor/projects/local-target/reports/review-decision.json")),
    deliveryManifest: writeJsonFixture(path.join(targetCheckoutRoot, ".aor/projects/local-target/reports/delivery-manifest.json")),
    deliveryTranscript: writeJsonFixture(path.join(targetCheckoutRoot, ".aor/projects/local-target/reports/delivery-transcript.json")),
    releasePacket: writeJsonFixture(path.join(targetCheckoutRoot, ".aor/projects/local-target/reports/release-packet.json")),
    learningScorecard: writeJsonFixture(path.join(targetCheckoutRoot, ".aor/projects/local-target/reports/learning-loop-scorecard.json")),
    learningHandoff: writeJsonFixture(path.join(targetCheckoutRoot, ".aor/projects/local-target/reports/learning-loop-handoff.json")),
    webSummary: writeJsonFixture(path.join(reportsRoot, "web-smoke.json")),
    webHtml: writeJsonFixture(path.join(reportsRoot, "web-smoke.html"), { html: "<main>AOR</main>" }),
    webDom: writeJsonFixture(path.join(reportsRoot, "web-dom.json")),
    webAccessibility: writeJsonFixture(path.join(reportsRoot, "web-accessibility.json")),
    webVisual: writeJsonFixture(path.join(reportsRoot, "web-visual.json")),
    browserTaskProof: writeJsonFixture(path.join(reportsRoot, "browser-task-proof.json")),
    newMissionPacket: writeJsonFixture(path.join(targetCheckoutRoot, ".aor/projects/local-target/artifacts/local-target.artifact.intake.second-flow.v1.json")),
    newMissionBody: writeJsonFixture(path.join(targetCheckoutRoot, ".aor/projects/local-target/artifacts/local-target.artifact.intake.second-flow.v1.body.json")),
    newNext: writeJsonFixture(path.join(targetCheckoutRoot, ".aor/projects/local-target/reports/next-action-report-second-flow.json")),
    operatorRequest: writeJsonFixture(path.join(targetCheckoutRoot, ".aor/projects/local-target/operator-requests/request-second-flow.json"), {
      target_flow_id: "flow.local-target.second-flow",
      target_stage: "discovery",
      intent_type: "analyze",
      delivery_mode: "no-write",
    }),
  };
  const commandResults = REQUIRED_GUIDED_COMMAND_LABELS.map((label, index) => ({
    label,
    transcript_file: writeJsonFixture(path.join(reportsRoot, `${String(index + 1).padStart(2, "0")}-${label}.json`)),
  }));
  const artifacts = {
    target_checkout_root: targetCheckoutRoot,
    onboarding_report_file: files.onboarding,
    intake_artifact_packet_file: files.missionPacket,
    intake_artifact_packet_body_file: files.missionBody,
    next_action_report_file: files.completedNext,
    completed_flow_next_action_report_file: files.completedNext,
    routed_step_result_file: files.routedStep,
    review_report_file: files.reviewReport,
    review_decision_file: files.reviewDecision,
    delivery_manifest_file: files.deliveryManifest,
    delivery_transcript_file: files.deliveryTranscript,
    release_packet_file: files.releasePacket,
    learning_loop_scorecard_file: files.learningScorecard,
    learning_loop_handoff_file: files.learningHandoff,
    guided_web_smoke_summary_file: files.webSummary,
    guided_web_smoke_html_file: files.webHtml,
    guided_web_dom_snapshot_file: files.webDom,
    guided_web_accessibility_summary_file: files.webAccessibility,
    guided_web_visual_guardrail_file: files.webVisual,
    guided_browser_task_proof_file: files.browserTaskProof,
    first_flow_id: "flow.local-target.first-flow",
    first_flow_status: "completed",
    completed_flow_read_only: true,
    second_flow_id: "flow.local-target.second-flow",
    follow_up_source_handoff_ref: files.learningHandoff,
    new_flow_mission_artifact_packet_file: files.newMissionPacket,
    new_flow_mission_artifact_packet_body_file: files.newMissionBody,
    new_flow_next_action_report_file: files.newNext,
    flow_targeted_operator_request_file: files.operatorRequest,
    flow_targeted_operator_request_ref: "packet://operator-request@flow.local-target.second-flow",
    flow_targeted_operator_request_id: "request.second-flow",
    flow_targeted_operator_request: {
      target_flow_id: "flow.local-target.second-flow",
      target_stage: "discovery",
      intent_type: "analyze",
      delivery_mode: "no-write",
    },
    guided_web_smoke: {
      summary_file: files.webSummary,
      rendered_html_file: files.webHtml,
      dom_snapshot_file: files.webDom,
      accessibility_summary_file: files.webAccessibility,
      visual_guardrail_file: files.webVisual,
      browser_task_proof_file: files.browserTaskProof,
      screenshot_files: [],
      task_outcome: { status: "pass", findings: [] },
      ux_findings: ["Flow selector and closure actions were inspectable."],
      guided_lifecycle_state: "smoke-pass",
      html_loaded: true,
      flow_selector_loaded: true,
      new_flow_action_loaded: true,
      guided_current_stage_id: "learning",
      detached: true,
    },
  };
  const proof = buildGuidedJourneyProof({
    runId: "w34-flow-loop",
    profile: { profile_id: "live-e2e.installed-user.guided-journey", output_policy: { write_back_to_remote: false, preferred_delivery_mode: "patch-only" } },
    commandResults,
    artifacts,
    targetCheckoutRoot,
    reportsRoot,
    targetHeadBefore: "0000000000000000000000000000000000000000",
    targetHeadAfter: "0000000000000000000000000000000000000000",
    targetGitStatusWithoutRuntime: [],
  });
  return { proof, targetCheckoutRoot };
}

test("full-journey execution status fails closed for blocking Runtime Harness decisions", () => {
  assert.equal(
    resolveExecutionStageStatusForRuntimeHarnessDecision({ runtimeHarnessDecision: "pass" }),
    "pass",
  );
  assert.equal(
    resolveExecutionStageStatusForRuntimeHarnessDecision({ runtimeHarnessDecision: "pass_with_findings" }),
    "warn",
  );
  assert.equal(
    resolveExecutionStageStatusForRuntimeHarnessDecision({ runtimeHarnessDecision: "block" }),
    "fail",
  );
  assert.equal(
    resolveExecutionStageStatusForRuntimeHarnessDecision({ runtimeHarnessDecision: "fail" }),
    "fail",
  );
  assert.equal(
    resolveExecutionStageStatusForRuntimeHarnessDecision({ runtimeHarnessDecision: "repair" }),
    "fail",
  );
  assert.equal(
    resolveExecutionStageStatusForRuntimeHarnessDecision({ existingStageStatus: "fail", runtimeHarnessDecision: "pass" }),
    "fail",
  );
});

test("Runtime Harness real-code evidence must match mission-relevant changed paths when declared", () => {
  withTempRoot((tempRoot) => {
    const reportPath = path.join(tempRoot, "runtime-harness-report.json");
    const mission = {
      change_evidence: {
        required_path_prefixes: ["source/", "test/"],
      },
    };

    writeJsonFixture(reportPath, {
      step_decisions: [
        {
          mission_semantics: {
            meaningful_changed_paths: ["test-replace-option.mjs"],
            non_bootstrap_changed_paths: ["test-replace-option.mjs"],
          },
        },
      ],
    });
    assert.equal(runtimeHarnessReportHasMissionRelevantChanges(reportPath, mission), false);
    assert.equal(runtimeHarnessReportHasMissionRelevantChanges(reportPath), true);

    writeJsonFixture(reportPath, {
      step_decisions: [
        {
          mission_semantics: {
            meaningful_changed_paths: ["source/utils/merge.ts"],
            non_bootstrap_changed_paths: ["source/utils/merge.ts"],
          },
        },
      ],
    });
    assert.equal(runtimeHarnessReportHasMissionRelevantChanges(reportPath, mission), true);

    writeJsonFixture(reportPath, {
      step_decisions: [
        {
          mission_semantics: {
            meaningful_changed_paths: ["test/headers.ts"],
            non_bootstrap_changed_paths: ["test/headers.ts"],
          },
        },
      ],
    });
    assert.equal(runtimeHarnessReportHasMissionRelevantChanges(reportPath, mission), true);
  });
});

test("production proof fails when delivery manifest omits Runtime Harness changed paths", () => {
  withTempRoot((tempRoot) => {
    const runtimeHarnessReport = writeJsonFixture(path.join(tempRoot, "runtime-harness-report.json"), {
      overall_decision: "pass",
      step_decisions: [
        {
          mission_semantics: {
            meaningful_changed_paths: [
              "httpie/manager/tasks/plugins.py",
              "tests/test_httpie_cli.py",
            ],
          },
        },
      ],
    });
    const reviewReport = writeJsonFixture(path.join(tempRoot, "review-report.json"), {
      overall_status: "pass",
      code_quality: {
        status: "pass",
        changed_paths: [
          "httpie/manager/tasks/plugins.py",
          "tests/test_httpie_cli.py",
        ],
      },
      provider_traceability: { status: "pass" },
      feature_size_fit: { status: "pass" },
    });
    const deliveryManifest = writeJsonFixture(path.join(tempRoot, "delivery-manifest.json"), {
      repo_deliveries: [
        {
          changed_paths: ["httpie/manager/tasks/plugins.py"],
          writeback_result: "patch-materialized",
          commit_refs: [],
          checkout_provenance: {
            head_before: { commit: "0000000000000000000000000000000000000000" },
            head_after: { commit: "0000000000000000000000000000000000000000" },
          },
        },
      ],
    });
    const requiredFiles = {
      liveAdapterPreflight: writeJsonFixture(path.join(tempRoot, "live-adapter-preflight.json")),
      postRunVerify: writeJsonFixture(path.join(tempRoot, "post-run-verify-summary.json")),
      learningScorecard: writeJsonFixture(path.join(tempRoot, "learning-loop-scorecard.json")),
      learningHandoff: writeJsonFixture(path.join(tempRoot, "learning-loop-handoff.json")),
    };
    const proof = applyProductionProofEvidence({
      productionProof: {
        enabled: true,
        proof_scope: "pending",
        external_runner_mode: "real-external-process",
        require_runner_auth: false,
        require_permission_readiness: false,
        mock_runner_allowed: false,
      },
      flowResult: {
        status: "pass",
        artifacts: {
          live_adapter_preflight_file: requiredFiles.liveAdapterPreflight,
          live_adapter_preflight: {
            status: "pass",
            edit_readiness: { status: "pass" },
          },
          latest_runtime_harness_report_file: runtimeHarnessReport,
          review_report_file: reviewReport,
          delivery_manifest_file: deliveryManifest,
          post_run_verify_summary_file: requiredFiles.postRunVerify,
          learning_loop_scorecard_file: requiredFiles.learningScorecard,
          learning_loop_handoff_file: requiredFiles.learningHandoff,
        },
      },
    });

    assert.equal(proof.real_code_change_proof_complete, false);
    assert.equal(proof.evidence_status, "pending");
    assert.equal(proof.delivery_integrity.status, "fail");
    assert.deepEqual(proof.delivery_integrity.missing_runtime_harness_changed_paths, [
      "tests/test_httpie_cli.py",
    ]);
    assert.ok(
      proof.findings.includes("delivery manifest omits Runtime Harness meaningful path: tests/test_httpie_cli.py"),
    );
  });
});

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
    const profilePath = writeProfile(tempRoot, { frontend_capability: "browser-task-proof" }, { guidedJourney: true });
    const loaded = loadProofRunnerProfile({ hostRoot: repoRoot, profileRef: profilePath });
    assert.equal(loaded.profile.live_e2e.frontend_capability, "browser-task-proof");
  });
});

test("proof runner profile validation requires guided flow-loop metadata for browser task proof", () => {
  withTempRoot((tempRoot) => {
    const profilePath = writeProfile(tempRoot, { frontend_capability: "browser-task-proof" });
    assert.throws(
      () => loadProofRunnerProfile({ hostRoot: repoRoot, profileRef: profilePath }),
      /guided_journey\.flow_loop_proof\.enabled=true/u,
    );
  });
});

test("ky Codex/Qwen/Anthropic profiles are loadable catalog-backed live E2E profiles", () => {
  const cases = [
    {
      profile: "scripts/live-e2e/profiles/full-journey-regress-ky-small-codex.yaml",
      profileId: "live-e2e.full-journey.regress.ky.small.codex",
      duration: "small",
      provider: "openai-primary",
      mission: "ky-header-regression",
    },
    {
      profile: "scripts/live-e2e/profiles/full-journey-regress-ky-medium-codex.yaml",
      profileId: "live-e2e.full-journey.regress.ky.medium.codex",
      duration: "medium",
      provider: "openai-primary",
      mission: "ky-fetch-options-regression",
    },
    {
      profile: "scripts/live-e2e/profiles/full-journey-regress-ky-small-qwen.yaml",
      profileId: "live-e2e.full-journey.regress.ky.small.qwen",
      duration: "small",
      provider: "qwen-primary",
      mission: "ky-header-regression",
    },
    {
      profile: "scripts/live-e2e/profiles/full-journey-regress-ky-medium-qwen.yaml",
      profileId: "live-e2e.full-journey.regress.ky.medium.qwen",
      duration: "medium",
      provider: "qwen-primary",
      mission: "ky-fetch-options-regression",
    },
    {
      profile: "scripts/live-e2e/profiles/full-journey-governance-ky-large-anthropic.yaml",
      profileId: "live-e2e.full-journey.governance.ky.large.anthropic",
      duration: "long",
      provider: "anthropic-primary",
      mission: "ky-retry-hooks-governance",
    },
  ];

  for (const current of cases) {
    const { profile } = loadProofRunnerProfile({ hostRoot: repoRoot, profileRef: current.profile });
    assert.equal(profile.profile_id, current.profileId);
    assert.equal(profile.journey_mode, "full-journey");
    assert.equal(profile.duration_class, current.duration);
    assert.equal(profile.target_catalog_id, "ky");
    assert.equal(profile.feature_mission_id, current.mission);
    assert.equal(profile.provider_variant_id, current.provider);
    assert.equal(profile.live_e2e.operator_mode, "skill-agent");
    assert.equal(profile.live_e2e.agent_decision_policy, "required");
    assert.equal(profile.output_policy.write_back_to_remote, false);
    assert.equal(profile.output_policy.preferred_delivery_mode, "patch-only");
  }

  const qwenProvider = loadContractFile({
    filePath: path.join(repoRoot, "scripts/live-e2e/catalog/providers/qwen-primary.yaml"),
    family: "live-e2e-provider-variant",
  });
  assert.equal(qwenProvider.ok, true);
  assert.equal(qwenProvider.document.provider, "qwen");
  assert.equal(qwenProvider.document.primary_adapter, "qwen-code");
  assert.equal(qwenProvider.document.coverage_tier, "extended");
});

test("W35 silent provider UX proof fixture preserves fail-closed operator evidence", () => {
  const fixture = JSON.parse(
    fs.readFileSync(
      path.join(repoRoot, "examples/live-e2e/fixtures/w35-s05/silent-provider-ux-proof.sample.json"),
      "utf8",
    ),
  );
  assert.equal(fixture.slice_id, "W35-S05");
  assert.equal(fixture.provider_step_status.status, "silent-running");
  assert.equal(fixture.provider_step_status.current_command_label, "external-provider-runner");
  assert.equal(fixture.provider_step_status.elapsed_ms > 0, true);
  assert.equal(fixture.provider_step_status.timeout_budget_ms > fixture.provider_step_status.elapsed_ms, true);

  const providerSummary = fixture.artifact_display_summaries.find((entry) => entry.type === "provider-raw-evidence");
  assert.equal(providerSummary.label, "Qwen provider raw evidence");
  assert.equal(providerSummary.actions.some((entry) => entry.action_id === "copy_raw_ref"), true);

  const groups = new Map(fixture.execution_evidence.changed_path_groups.map((entry) => [entry.group_id, entry]));
  assert.deepEqual(groups.get("mission-relevant").paths, ["source/core/Ky.ts", "test/headers.ts"]);
  assert.deepEqual(groups.get("runner-owned-leak").paths, [".qwen/skills/aor/SKILL.md"]);
  assert.deepEqual(groups.get("scratch-unrelated").paths, ["scratch-output.txt"]);
  assert.equal(fixture.execution_evidence.no_upstream_write_status, "pass");
  assert.equal(fixture.execution_evidence.actions.find((entry) => entry.action_id === "stop_provider").command_surface, "aor run cancel");
  assert.match(
    fixture.execution_evidence.actions.find((entry) => entry.action_id === "diagnose_current_step").command_surface,
    /--action diagnose/u,
  );

  assert.deepEqual(
    fixture.decision_helper.prepared_decision.inspected_evidence_refs,
    fixture.decision_helper.decision_rubric.required_evidence_refs,
  );
  assert.deepEqual(fixture.decision_helper.validation_preview.missing_required_inspected_evidence_refs, []);
  assert.equal(fixture.proof_model.operator_kind, "skill-agent");
  assert.equal(fixture.proof_model.legacy_bounded_or_mock_backed_profiles_restored, false);
});

test("W35 live attempts summary records blockers without claiming product pass", () => {
  const fixture = JSON.parse(
    fs.readFileSync(
      path.join(repoRoot, "examples/live-e2e/fixtures/w35-s05/live-attempts-summary.sample.json"),
      "utf8",
    ),
  );
  assert.equal(fixture.slice_id, "W35-S05");
  assert.equal(fixture.closure_policy.synthetic_fixture_can_prove_ui_observability_only, true);
  assert.equal(fixture.closure_policy.legacy_bounded_or_mock_backed_profiles_restored, false);
  for (const attempt of fixture.attempts.filter((entry) => entry.status !== "pass")) {
    assert.equal(attempt.status, "blocked");
    assert.equal(attempt.product_pass_claimed, false);
    assert.equal(attempt.no_upstream_write, true);
  }
  const codexAttempt = fixture.attempts.find((entry) => entry.run_id === "w35-s05-codex-small-1780389151");
  assert.equal(codexAttempt.blocker_class, "target-verification-environment");
  assert.equal(codexAttempt.failure_owner, "target_repository");
  assert.equal(codexAttempt.failure_phase, "target_verification");
  assert.equal(codexAttempt.target_pre_execution_status_ref, "examples/live-e2e/fixtures/w37-s01/target-pre-execution-status.sample.json");
  assert.match(codexAttempt.public_observation, /baseline-diagnostic/u);
  const qwenAttempt = fixture.attempts.find((entry) => entry.run_id === "w35-s05-qwen-small-preflight");
  assert.equal(qwenAttempt.failure_owner, "target_repository");
  assert.equal(qwenAttempt.failure_phase, "target_verification");
  assert.match(qwenAttempt.public_observation, /0\.17\.0/u);
  const codexClosure = fixture.attempts.find((entry) => entry.run_id === "w35-s05-codex-small-proof-20260603094440");
  assert.equal(codexClosure.status, "pass");
  assert.equal(codexClosure.run_health_status, "pass");
  assert.equal(codexClosure.product_pass_claimed, true);
  assert.equal(codexClosure.target_setup_status, "pass");
  assert.equal(codexClosure.target_verification_status, "pass");
  const qwenClosure = fixture.attempts.find((entry) => entry.run_id === "w35-s05-qwen-interrupt-proof-20260603102247");
  assert.equal(qwenClosure.status, "blocked");
  assert.equal(qwenClosure.failure_owner, "operator");
  assert.equal(qwenClosure.failure_phase, "provider_execution");
  assert.equal(qwenClosure.blocker_class, "operator_stopped");
  assert.equal(qwenClosure.provider_step_status.interruption_owner, "operator");
  assert.equal(qwenClosure.provider_step_status.interruption_status, "operator-stopped");
  assert.equal(qwenClosure.target_setup_status, "pass");
  assert.equal(qwenClosure.target_verification_status, "pass");
  assert.equal(qwenClosure.product_pass_claimed, false);
});

test("W40 provider qualification matrix uses evidence owner and phase instead of provider name", () => {
  const fixture = JSON.parse(
    fs.readFileSync(
      path.join(repoRoot, "examples/live-e2e/fixtures/w40-s04/provider-qualification-matrix.sample.json"),
      "utf8",
    ),
  );
  const cells = new Map(fixture.matrix.provider_cells.map((entry) => [entry.provider_variant_id, entry]));
  assert.equal(fixture.matrix.release_blocking_status, "pass");
  assert.deepEqual(fixture.matrix.release_blocking_provider_ids, []);
  assert.equal(cells.get("openai-primary").qualification_status, "qualified");
  assert.equal(cells.get("anthropic-primary").qualification_status, "candidate");
  assert.equal(cells.get("open-code-primary").qualification_status, "blocked");
  assert.equal(cells.get("qwen-primary").qualification_status, "blocked");
  assert.equal(cells.get("qwen-primary").failure_owner, "operator");
  assert.equal(cells.get("qwen-primary").failure_phase, "provider_execution");
  assert.equal(cells.get("qwen-primary").failure_class, "operator_stopped");
  for (const providerId of ["anthropic-primary", "open-code-primary", "qwen-primary"]) {
    assert.equal(cells.get(providerId).release_blocking, false);
  }

  const matrix = buildProviderQualificationMatrix({
    providers: [
      {
        provider_variant_id: "qwen-primary",
        provider: "qwen",
        adapter: "qwen-code",
        coverage_tier: "extended",
      },
      {
        provider_variant_id: "openai-primary",
        provider: "openai",
        adapter: "codex-cli",
        coverage_tier: "required",
      },
    ],
    attempts: [
      {
        run_id: "qwen-aor-ui-regression",
        provider_variant_id: "qwen-primary",
        status: "needs_fix",
        failure_owner: "aor",
        failure_phase: "ui_validation",
        failure_class: "aor_failure",
        public_observation: "The UI hid the accepted operator decision even though the Qwen provider step completed.",
      },
      {
        run_id: "codex-target-setup-blocked",
        provider_variant_id: "openai-primary",
        status: "blocked",
        failure_owner: "target_repository",
        failure_phase: "target_setup",
        failure_class: "target_setup_blocked",
        public_observation: "The target repository install timed out before provider execution.",
      },
      {
        run_id: "qwen-operator-stopped",
        provider_variant_id: "qwen-primary",
        status: "blocked",
        provider_step_status: {
          status: "interrupted",
          interruption_owner: "operator",
          interruption_status: "operator-stopped",
          interruption_reason: "Operator stopped the provider through public run-control after collecting progress evidence.",
        },
      },
    ],
    releaseBlockingProviderIds: ["openai-primary"],
  });
  const qwenCell = matrix.provider_cells.find((entry) => entry.provider_variant_id === "qwen-primary");
  const codexCell = matrix.provider_cells.find((entry) => entry.provider_variant_id === "openai-primary");
  assert.equal(qwenCell.qualification_status, "blocked");
  assert.equal(qwenCell.failure_owner, "operator");
  assert.equal(qwenCell.failure_phase, "provider_execution");
  assert.equal(qwenCell.failure_class, "operator_stopped");
  assert.match(qwenCell.blocker_reason, /public run-control/u);
  assert.equal(codexCell.qualification_status, "blocked");
  assert.equal(codexCell.failure_owner, "target_repository");
  assert.equal(codexCell.failure_phase, "target_setup");
  assert.equal(matrix.release_blocking_status, "blocked");
  assert.deepEqual(matrix.release_blocking_failures, [
    {
      provider_variant_id: "openai-primary",
      qualification_status: "blocked",
      failure_owner: "target_repository",
      failure_phase: "target_setup",
    },
  ]);
});

test("catalog feature request materialization preserves required path prefixes", () => {
  withTempRoot((tempRoot) => {
    const result = materializeFeatureRequestFile({
      targetCheckoutRoot: tempRoot,
      runId: "mission-prefix-request",
      scenarioFamily: "regress",
      providerVariantId: "openai-primary",
      providerVariant: {
        provider: "codex",
        primary_adapter: "codex-cli",
      },
      scenarioPolicy: {
        required_stages: ["execution"],
        required_evidence: ["routed-step-result"],
      },
      featureSize: "small",
      matrixCell: {
        cell_id: "ky.regress.small.openai",
      },
      coverageFollowUp: {},
      mission: {
        mission_id: "ky-header-regression",
        title: "Header regression",
        brief: "Preserve narrow header behavior.",
        goals: ["Keep header handling bounded."],
        kpis: [
          {
            kpi_id: "ky-header-green",
            name: "Header test gate",
            target: "targeted AVA header test passes",
            measurement: "post-run primary verification",
          },
        ],
        definition_of_done: ["Targeted header verification passes."],
        expected_evidence: ["routed-step-result"],
        acceptance_checks: ["pass targeted headers test"],
        change_evidence: {
          required_path_prefixes: ["source/", "test/"],
        },
        post_run_quality: {
          primary_commands: ["npx ava test/headers.ts"],
          diagnostic_commands: ["npm test"],
          diagnostic_failure_mode: "warn",
        },
      },
    });

    assert.deepEqual(result.requestDocument.goals, ["Keep header handling bounded."]);
    assert.deepEqual(result.requestDocument.kpis[0].kpi_id, "ky-header-green");
    assert.deepEqual(result.requestDocument.definition_of_done, ["Targeted header verification passes."]);
    assert.deepEqual(result.requestDocument.change_evidence.required_path_prefixes, ["source/", "test/"]);
    assert.deepEqual(result.requestDocument.post_run_quality.primary_commands, ["npx ava test/headers.ts"]);
    const persisted = JSON.parse(fs.readFileSync(result.requestFile, "utf8"));
    assert.deepEqual(persisted.change_evidence.required_path_prefixes, ["source/", "test/"]);
    assert.deepEqual(persisted.post_run_quality.primary_commands, ["npx ava test/headers.ts"]);
  });
});

test("HTTPie medium catalog mission declares bounded machine-readable path and warning-output guidance", () => {
  const catalogRoot = resolveCatalogRoot({ hostRoot: repoRoot, catalogRootOverride: null });
  const target = loadCatalogTarget({ catalogRoot, targetCatalogId: "httpie-cli" });
  const mission = target.entry.feature_missions.find((entry) => entry.mission_id === "httpie-cli-repair-exit-codes");

  assert.deepEqual(mission.change_evidence.required_path_prefixes, [
    "httpie/manager/tasks/plugins.py",
    "tests/test_httpie_cli.py",
  ]);
  assert.match(mission.brief, /stderr warning\s+tokens/u);
  assert.ok(
    mission.acceptance_checks.some((entry) => /primary pytest stderr has no runtime warning tokens/u.test(entry)),
    "expected explicit no-warning primary verification acceptance check",
  );
  assert.ok(
    mission.acceptance_checks.some((entry) => /cleanup-safe pytest fixtures or context-managed resources/u.test(entry)),
    "expected cleanup-safe test guidance without target-specific fixture names",
  );
});

test("generated live E2E profile allows selected guided provider adapters", () => {
  withTempRoot((tempRoot) => {
    const cases = [
      {
        profilePath: path.join(repoRoot, "scripts/live-e2e/profiles/installed-user-guided-journey.yaml"),
        provider: "openai",
        adapter: "codex-cli",
        runId: "openai-provider-allowlist",
      },
      {
        profilePath: path.join(repoRoot, "scripts/live-e2e/profiles/installed-user-guided-journey-qwen.yaml"),
        provider: "qwen",
        adapter: "qwen-code",
        runId: "qwen-provider-allowlist",
      },
      {
        profilePath: path.join(repoRoot, "scripts/live-e2e/profiles/installed-user-guided-journey-anthropic.yaml"),
        provider: "anthropic",
        adapter: "claude-code",
        runId: "anthropic-provider-allowlist",
      },
    ];

    for (const current of cases) {
      const loadedProfile = loadProofRunnerProfile({ hostRoot: repoRoot, profileRef: current.profilePath });
      const generatedAssetsRoot = path.join(tempRoot, current.provider, "assets");
      fs.mkdirSync(generatedAssetsRoot, { recursive: true });

      const result = materializeGeneratedProjectProfile({
        hostRoot: repoRoot,
        profilePath: loadedProfile.profilePath,
        profile: loadedProfile.profile,
        catalogEntry: { verification: {} },
        providerVariant: {
          provider: current.provider,
          primary_adapter: current.adapter,
        },
        runId: current.runId,
        targetCheckout: {
          targetRepoId: "ky",
          targetRepoRef: "main",
        },
        generatedAssetsRoot,
      });

      const loaded = loadContractFile({
        filePath: result.generatedProjectProfileFile,
        family: "project-profile",
      });
      assert.equal(loaded.ok, true);
      assert.ok(loaded.document.allowed_providers.includes(current.provider));
      assert.ok(loaded.document.allowed_adapters.includes(current.adapter));
      assert.equal(loaded.document.runtime_defaults.verification_command_timeout_sec, 120);
      assert.deepEqual(loaded.document.repos[0].lint_commands, ["npm install --prefer-offline --no-audit --no-fund"]);
      assert.equal(loaded.document.repos[0].lint_commands.includes("npx playwright install"), false);
    }
  });
});

test("generated ky small Codex profile uses bounded target setup and mission-scoped verification", () => {
  withTempRoot((tempRoot) => {
    const profileRef = "scripts/live-e2e/profiles/full-journey-regress-ky-small-codex.yaml";
    const loadedProfile = loadProofRunnerProfile({ hostRoot: repoRoot, profileRef });
    const resolved = resolveFullJourneyProfile({
      profile: loadedProfile.profile,
      catalogRoot: path.join(repoRoot, "scripts/live-e2e/catalog"),
    });
    const generatedAssetsRoot = path.join(tempRoot, "assets");
    fs.mkdirSync(generatedAssetsRoot, { recursive: true });

    const result = materializeGeneratedProjectProfile({
      hostRoot: repoRoot,
      profilePath: loadedProfile.profilePath,
      profile: resolved.resolvedProfile,
      catalogEntry: resolved.catalogEntry,
      providerVariant: resolved.providerVariant,
      runId: "ky-small-bounded-target-setup",
      targetCheckout: {
        targetRepoId: "ky",
        targetRepoRef: "main",
      },
      generatedAssetsRoot,
    });

    const loaded = loadContractFile({
      filePath: result.generatedProjectProfileFile,
      family: "project-profile",
    });
    assert.equal(loaded.ok, true);
    assert.equal(loaded.document.runtime_defaults.verification_command_timeout_sec, 120);
    assert.deepEqual(loaded.document.repos[0].lint_commands, ["npm install --prefer-offline --no-audit --no-fund"]);
    assert.deepEqual(loaded.document.repos[0].test_commands, [
      "npx xo",
      "npm run build",
      "npx ava test/headers.ts",
    ]);
    assert.equal(loaded.document.repos[0].lint_commands.includes("npx playwright install"), false);
  });
});

test("generated live E2E profile falls back to mission-scoped primary verification", () => {
  withTempRoot((tempRoot) => {
    const generatedAssetsRoot = path.join(tempRoot, "assets");
    fs.mkdirSync(generatedAssetsRoot, { recursive: true });

    const result = materializeGeneratedProjectProfile({
      hostRoot: repoRoot,
      profilePath: path.join(repoRoot, "scripts/live-e2e/profiles/full-journey-regress-ky.yaml"),
      profile: {
        runtime: { mode: "ephemeral" },
        output_policy: { preferred_delivery_mode: "patch-only" },
        verification: {
          build: true,
          lint: true,
          tests: "project-default",
        },
      },
      catalogEntry: {
        verification: {
          setup_commands: ["npm install --prefer-offline --no-audit --no-fund"],
          commands: ["npm test"],
        },
      },
      mission: {
        post_run_quality: {
          primary_commands: ["npx xo", "npm run build", "npx ava test/headers.ts"],
        },
      },
      providerVariant: {
        provider: "codex",
        primary_adapter: "codex-cli",
      },
      runId: "mission-primary-verification",
      targetCheckout: {
        targetRepoId: "ky",
        targetRepoRef: "main",
      },
      generatedAssetsRoot,
    });

    const loaded = loadContractFile({
      filePath: result.generatedProjectProfileFile,
      family: "project-profile",
    });
    assert.equal(loaded.ok, true);
    assert.deepEqual(loaded.document.repos[0].test_commands, [
      "npx xo",
      "npm run build",
      "npx ava test/headers.ts",
    ]);
    assert.equal(loaded.document.repos[0].test_commands.includes("npm test"), false);
  });
});

test("generated ky large Anthropic profile uses bounded governance verification", () => {
  withTempRoot((tempRoot) => {
    const profileRef = "scripts/live-e2e/profiles/full-journey-governance-ky-large-anthropic.yaml";
    const loadedProfile = loadProofRunnerProfile({ hostRoot: repoRoot, profileRef });
    const resolved = resolveFullJourneyProfile({
      profile: loadedProfile.profile,
      catalogRoot: path.join(repoRoot, "scripts/live-e2e/catalog"),
    });
    const generatedAssetsRoot = path.join(tempRoot, "assets");
    fs.mkdirSync(generatedAssetsRoot, { recursive: true });

    const result = materializeGeneratedProjectProfile({
      hostRoot: repoRoot,
      profilePath: loadedProfile.profilePath,
      profile: resolved.resolvedProfile,
      catalogEntry: resolved.catalogEntry,
      mission: resolved.mission,
      providerVariant: resolved.providerVariant,
      runId: "ky-large-anthropic-bounded-target-setup",
      targetCheckout: {
        targetRepoId: "ky",
        targetRepoRef: "main",
      },
      generatedAssetsRoot,
    });

    const loaded = loadContractFile({
      filePath: result.generatedProjectProfileFile,
      family: "project-profile",
    });
    assert.equal(loaded.ok, true);
    assert.equal(loaded.document.runtime_defaults.verification_command_timeout_sec, 600);
    assert.deepEqual(loaded.document.repos[0].lint_commands, ["npm install --prefer-offline --no-audit --no-fund"]);
    assert.deepEqual(loaded.document.repos[0].test_commands, [
      "npx xo",
      "npm run build",
      "npx ava test/main.ts test/hooks.ts",
      "npx ava test/retry.ts --match='*shouldRetry*'",
    ]);
    assert.deepEqual(resolved.mission.post_run_quality.diagnostic_commands, [
      "npx playwright install",
      "npm test",
    ]);
    assert.equal(loaded.document.repos[0].test_commands.includes("npm test"), false);
    assert.equal(loaded.document.repos[0].lint_commands.includes("npx playwright install"), false);
  });
});

test("target pre-execution status separates target setup, target verification, and AOR failures", () => {
  withTempRoot((tempRoot) => {
    const setupTranscript = writeJsonFixture(path.join(tempRoot, "setup-transcript.json"));
    const setupStepFile = writeJsonFixture(path.join(tempRoot, "setup-step.json"), {
      status: "failed",
      command: "npm install --prefer-offline --no-audit --no-fund",
      summary: "Verification command 'npm install --prefer-offline --no-audit --no-fund' timed out after 120000ms.",
      evidence_refs: [setupTranscript],
      command_timeout_ms: 120000,
      timed_out: true,
      missing_prerequisites: [],
    });
    const verificationStepFile = writeJsonFixture(path.join(tempRoot, "verify-step.json"), {
      status: "failed",
      command: "npx ava test/headers.ts",
      summary: "Verification command 'npx ava test/headers.ts' failed with exit code 1.",
      evidence_refs: [writeJsonFixture(path.join(tempRoot, "verify-transcript.json"))],
      command_timeout_ms: 120000,
      timed_out: false,
      missing_prerequisites: [],
    });

    const setupReport = buildTargetPreExecutionStatusReport({
      verifySummary: { status: "failed", command_timeout_ms: 120000 },
      verifyPayload: { verify_summary_file: path.join(tempRoot, "verify-summary.json") },
      stepResultFiles: [setupStepFile, verificationStepFile],
      setupCommands: ["npm install --prefer-offline --no-audit --no-fund"],
      verificationCommands: ["npx ava test/headers.ts"],
      baselineGateDecision: { status: "fail", decision: "block", summary: "readiness-command-failed" },
      runResult: {
        durationSec: 121,
        timeoutMs: 300000,
        transcriptFile: path.join(tempRoot, "project-verify.json"),
      },
    });
    assert.equal(setupReport.status, "blocked");
    assert.equal(setupReport.failure_owner, "target_repository");
    assert.equal(setupReport.failure_phase, "target_setup");
    assert.equal(setupReport.failure_class, "target_setup_blocked");
    assert.equal(setupReport.target_setup_status.timed_out, true);
    assert.equal(setupReport.target_verification_status.status, "blocked");

    const verificationReport = buildTargetPreExecutionStatusReport({
      verifySummary: { status: "failed", command_timeout_ms: 120000 },
      verifyPayload: { verify_summary_file: path.join(tempRoot, "verify-summary.json") },
      stepResultFiles: [verificationStepFile],
      setupCommands: ["npm install --prefer-offline --no-audit --no-fund"],
      verificationCommands: ["npx ava test/headers.ts"],
      baselineGateDecision: { status: "warn", decision: "continue_with_warnings", summary: "target verification failed" },
      runResult: { durationSec: 5, timeoutMs: 300000, transcriptFile: path.join(tempRoot, "project-verify.json") },
    });
    assert.equal(verificationReport.status, "warn");
    assert.equal(verificationReport.failure_owner, null);
    assert.equal(verificationReport.failure_phase, null);
    assert.equal(verificationReport.failure_class, null);
    assert.equal(verificationReport.target_verification_status.status, "warn");
    assert.equal(verificationReport.target_verification_status.warning_reason, "Verification command 'npx ava test/headers.ts' failed with exit code 1.");

    const aorReport = buildTargetPreExecutionStatusReport({
      verifySummary: {},
      verifyPayload: {},
      stepResultFiles: [],
      setupCommands: ["npm install --prefer-offline --no-audit --no-fund"],
      verificationCommands: ["npx ava test/headers.ts"],
      baselineGateDecision: { status: "fail", decision: "block", summary: "AOR command timed out." },
      runResult: {
        label: "project-verify-preflight",
        durationSec: 300,
        timeoutMs: 300000,
        transcriptFile: path.join(tempRoot, "project-verify-timeout.json"),
        timedOut: true,
      },
    });
    assert.equal(aorReport.failure_owner, "aor");
    assert.equal(aorReport.failure_phase, "target_verification");
    assert.equal(aorReport.failure_class, "aor_failure");
  });
});

test("target pre-execution status classifies disk exhaustion as environment failure", () => {
  withTempRoot((tempRoot) => {
    const setupTranscript = writeJsonFixture(path.join(tempRoot, "setup-transcript.json"));
    const setupStepFile = writeJsonFixture(path.join(tempRoot, "setup-step.json"), {
      status: "failed",
      command: "yarn install --immutable",
      summary: "Verification command 'yarn install --immutable' failed with exit code 1.",
      evidence_refs: [setupTranscript],
      command_timeout_ms: 600000,
      timed_out: false,
      missing_prerequisites: [],
      output_excerpt: {
        stdout_tail: "YN0001: Error: ENOSPC: no space left on device, copyfile '.yarn/cache/example.zip'",
        stderr_tail: "",
      },
    });

    const baselineDecision = evaluateBaselineVerifyGate({
      verifySummary: { status: "failed", validation_gate_status: "pass" },
      verifyPayload: {},
      stepResultFiles: [setupStepFile],
      setupCommands: ["yarn install --immutable"],
      verificationCommands: ["yarn g:lint"],
      mode: "blocking",
    });
    assert.equal(baselineDecision.failure_owner, "environment");
    assert.equal(baselineDecision.failure_phase, "target_setup");
    assert.equal(baselineDecision.failure_class, "environment_disk_space_exhausted");
    assert.equal(
      baselineDecision.blocking_reasons.includes("environment_disk_space_exhausted:yarn install --immutable"),
      true,
    );

    const setupReport = buildTargetPreExecutionStatusReport({
      verifySummary: { status: "failed", command_timeout_ms: 600000 },
      verifyPayload: { verify_summary_file: path.join(tempRoot, "verify-summary.json") },
      stepResultFiles: [setupStepFile],
      setupCommands: ["yarn install --immutable"],
      verificationCommands: ["yarn g:lint"],
      baselineGateDecision: baselineDecision,
      runResult: {
        durationSec: 9,
        timeoutMs: 900000,
        transcriptFile: path.join(tempRoot, "project-verify.json"),
      },
    });
    assert.equal(setupReport.status, "blocked");
    assert.equal(setupReport.failure_owner, "environment");
    assert.equal(setupReport.failure_phase, "target_setup");
    assert.equal(setupReport.failure_class, "environment_disk_space_exhausted");
    assert.equal(setupReport.target_setup_status.failure_owner, "environment");
    assert.equal(setupReport.target_setup_status.failure_class, "environment_disk_space_exhausted");
    assert.equal(setupReport.target_verification_status.status, "not_attempted");
    assert.equal(setupReport.target_verification_status.failure_owner, "environment");
    assert.equal(setupReport.target_verification_status.failure_class, "environment_disk_space_exhausted");
  });
});

test("baseline verify gate annotates blocker owner and phase", () => {
  withTempRoot((tempRoot) => {
    const stepFile = writeJsonFixture(path.join(tempRoot, "verify-step.json"), {
      status: "failed",
      command: "npx ava test/headers.ts",
      summary: "Target test failed.",
      evidence_refs: [],
      missing_prerequisites: [],
    });
    const result = evaluateBaselineVerifyGate({
      verifySummary: { status: "failed", validation_gate_status: "pass" },
      verifyPayload: {},
      stepResultFiles: [stepFile],
      setupCommands: ["npm install --prefer-offline --no-audit --no-fund"],
      verificationCommands: ["npx ava test/headers.ts"],
      mode: "diagnostic",
    });
    assert.equal(result.failure_owner, "target_repository");
    assert.equal(result.failure_phase, "target_verification");
    assert.equal(result.failure_class, "target_verification_blocked");
  });
});

test("live adapter preflight honors short execution root aliases", () => {
  withTempRoot((tempRoot) => {
    const longSegment = "live-e2e-installed-user-guided-journey-qwen-final-ui-1780348266";
    const targetCheckoutRoot = path.join(tempRoot, longSegment, "runtime", "projects", "aor-core", "target-checkouts", `ky-${longSegment}`);
    const reportsRoot = path.join(tempRoot, "reports");
    const adapterProfileRoot = path.join(tempRoot, "adapters");
    fs.mkdirSync(targetCheckoutRoot, { recursive: true });
    fs.mkdirSync(reportsRoot, { recursive: true });
    fs.mkdirSync(adapterProfileRoot, { recursive: true });
    fs.writeFileSync(
      path.join(adapterProfileRoot, "qwen-code.yaml"),
      [
        "adapter_id: qwen-code",
        "runner_family: qwen",
        "version: 1",
        "launch_modes:",
        "  - non-interactive",
        "capabilities:",
        "  repo_read: true",
        "  repo_write: true",
        "  shell_commands: true",
        "  structured_output: true",
        "constraints:",
        "  requires_local_runtime: true",
        "execution:",
        "  runtime_mode: external-process",
        "  handler: qwen-code-external-runner",
        "  evidence_namespace: evidence://adapter-live/qwen-code",
        "  external_runtime:",
        `    command: ${process.execPath}`,
        "    request_transport: stdin-json",
        "    stdin_json_scope: test-only",
        "    execution_root_mode: short-symlink",
        "    preflight_timeout_ms: 30000",
        "    timeout_ms: 30000",
        "    permission_policy:",
        "      default_mode: full-bypass",
        "      modes:",
        "        full-bypass:",
        "          args:",
        "            - -e",
        "            - process.stdout.write(JSON.stringify({status:'success',summary:'preflight ok'}));",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = runLiveAdapterPreflight({
      targetCheckoutRoot,
      adapterProfileRoot,
      providerVariant: {
        provider: "qwen",
        primary_adapter: "qwen-code",
        coverage_tier: "extended",
      },
      providerVariantId: "qwen-primary",
      coverageTier: "extended",
      env: process.env,
      runnerAuthMode: "host",
      runnerAuthSource: "host",
      runtimeAgentPermissionMode: "full-bypass",
      runtimeAgentInteractionPolicy: "fail-closed",
      runtimeAgentAutoApprovalProfile: "none",
      authProbeRequired: true,
      runId: "qwen-long-run-id-short-root",
      reportsRoot,
    });

    assert.equal(result.status, "pass");
    assert.equal(result.report.external_runtime.execution_root_mode, "short-symlink");
    assert.ok(result.report.external_runtime.execution_root.length < targetCheckoutRoot.length);
    assert.equal(fs.realpathSync(result.report.external_runtime.execution_root), fs.realpathSync(targetCheckoutRoot));
    assert.equal(result.report.external_runtime.canonical_execution_root, fs.realpathSync(targetCheckoutRoot));
  });
});

test("live adapter preflight applies env_from aliases without leaking values", () => {
  withTempRoot((tempRoot) => {
    const targetCheckoutRoot = path.join(tempRoot, "target");
    const reportsRoot = path.join(tempRoot, "reports");
    const adapterProfileRoot = path.join(tempRoot, "adapters");
    fs.mkdirSync(targetCheckoutRoot, { recursive: true });
    fs.mkdirSync(reportsRoot, { recursive: true });
    fs.mkdirSync(adapterProfileRoot, { recursive: true });
    fs.writeFileSync(
      path.join(adapterProfileRoot, "qwen-code.yaml"),
      [
        "adapter_id: qwen-code",
        "runner_family: qwen",
        "version: 1",
        "launch_modes:",
        "  - non-interactive",
        "capabilities:",
        "  repo_read: true",
        "  repo_write: true",
        "  shell_commands: true",
        "  structured_output: true",
        "constraints:",
        "  requires_local_runtime: true",
        "execution:",
        "  runtime_mode: external-process",
        "  handler: qwen-code-external-runner",
        "  evidence_namespace: evidence://adapter-live/qwen-code",
        "  external_runtime:",
        `    command: ${process.execPath}`,
        "    request_transport: stdin-json",
        "    stdin_json_scope: test-only",
        "    preflight_timeout_ms: 30000",
        "    timeout_ms: 30000",
        "    env_from:",
        "      AOR_TEST_PREFLIGHT_TARGET_SECRET: AOR_TEST_PREFLIGHT_SOURCE_SECRET",
        "    native_timeout_arg:",
        "      flag: --max-wall-time",
        "      format: duration-seconds",
        "      reserve_ms: 5000",
        "    permission_policy:",
        "      default_mode: full-bypass",
        "      modes:",
        "        full-bypass:",
        "          args:",
        "            - -e",
        [
          "            - ",
          "if(!process.env.AOR_TEST_PREFLIGHT_TARGET_SECRET||process.env.AOR_TEST_PREFLIGHT_TARGET_SECRET!==process.env.AOR_TEST_PREFLIGHT_SOURCE_SECRET){process.stderr.write('missing env alias');process.exit(1);}",
          "process.stdout.write(JSON.stringify({status:'success',summary:'preflight env alias ok'}));",
        ].join(""),
        "            - --",
        "",
      ].join("\n"),
      "utf8",
    );

    const env = {
      ...process.env,
      AOR_TEST_PREFLIGHT_SOURCE_SECRET: "preflight-secret-from-source",
    };
    delete env.AOR_TEST_PREFLIGHT_TARGET_SECRET;
    const result = runLiveAdapterPreflight({
      targetCheckoutRoot,
      adapterProfileRoot,
      providerVariant: {
        provider: "qwen",
        primary_adapter: "qwen-code",
        coverage_tier: "extended",
      },
      providerVariantId: "qwen-primary",
      coverageTier: "extended",
      env,
      runnerAuthMode: "host",
      runnerAuthSource: "host",
      runtimeAgentPermissionMode: "full-bypass",
      runtimeAgentInteractionPolicy: "fail-closed",
      runtimeAgentAutoApprovalProfile: "none",
      authProbeRequired: true,
      runId: "qwen-preflight-env-from",
      reportsRoot,
    });

    assert.equal(result.status, "pass");
    assert.deepEqual(result.report.external_runtime.env_from_applied, [
      { target: "AOR_TEST_PREFLIGHT_TARGET_SECRET", source: "AOR_TEST_PREFLIGHT_SOURCE_SECRET" },
    ]);
    assert.deepEqual(result.report.external_runtime.native_timeout_args, ["--max-wall-time", "25s"]);
    assert.equal(JSON.stringify(result.report).includes("preflight-secret-from-source"), false);
  });
});

test("live adapter preflight uses a preflight-specific request-artifact prompt and marker edit", () => {
  withTempRoot((tempRoot) => {
    const targetCheckoutRoot = path.join(tempRoot, "target");
    const reportsRoot = path.join(tempRoot, "reports");
    const adapterProfileRoot = path.join(tempRoot, "adapters");
    const captureFile = path.join(tempRoot, "preflight-calls.jsonl");
    const runnerScript = path.join(tempRoot, "preflight-runner.mjs");
    fs.mkdirSync(targetCheckoutRoot, { recursive: true });
    fs.mkdirSync(reportsRoot, { recursive: true });
    fs.mkdirSync(adapterProfileRoot, { recursive: true });
    fs.writeFileSync(
      runnerScript,
      [
        "import fs from 'node:fs';",
        "const args = process.argv.slice(2);",
        "const requestFileIndex = args.indexOf('--request-file');",
        "const requestFile = requestFileIndex >= 0 ? args[requestFileIndex + 1] : args.find((entry) => entry.endsWith('.json'));",
        "const message = args.find((entry) => entry.includes('provider work packet')) || '';",
        "const packet = JSON.parse(fs.readFileSync(requestFile, 'utf8'));",
        "fs.appendFileSync(process.env.AOR_PREFLIGHT_CAPTURE_FILE, `${JSON.stringify({message, requestFile, step_class: packet.request.step_class, preflight_contract: packet.request.preflight_contract})}\\n`);",
        "const probe = packet.request.edit_probe || packet.request.permission_probe;",
        "if (probe) fs.writeFileSync(probe.marker_file, probe.expected_marker_contents, 'utf8');",
        "process.stdout.write(JSON.stringify({status:'success',summary:'preflight ok'}));",
        "",
      ].join("\n"),
      "utf8",
    );
    fs.writeFileSync(
      path.join(adapterProfileRoot, "claude-code.yaml"),
      [
        "adapter_id: claude-code",
        "runner_family: claude",
        "version: 1",
        "launch_modes:",
        "  - non-interactive",
        "capabilities:",
        "  repo_read: true",
        "  repo_write: true",
        "  shell_commands: true",
        "  structured_output: true",
        "constraints:",
        "  requires_local_runtime: true",
        "execution:",
        "  runtime_mode: external-process",
        "  live_baseline: true",
        "  handler: claude-code-external-runner",
        "  evidence_namespace: evidence://adapter-live/claude-code",
        "  external_runtime:",
        `    command: ${process.execPath}`,
        "    request_transport: request-artifact",
        "    request_file:",
        "      argument: --request-file",
        "      message: Execute the approved AOR implementation using the provider work packet at {provider_work_packet_path}.",
        "    preflight_timeout_ms: 30000",
        "    timeout_ms: 30000",
        "    env_from:",
        "      AOR_PREFLIGHT_CAPTURE_FILE: AOR_PREFLIGHT_CAPTURE_FILE",
        "    permission_policy:",
        "      default_mode: full-bypass",
        "      modes:",
        "        full-bypass:",
        "          args:",
        `            - ${JSON.stringify(runnerScript)}`,
        "",
      ].join("\n"),
      "utf8",
    );

    const result = runLiveAdapterPreflight({
      targetCheckoutRoot,
      adapterProfileRoot,
      providerVariant: {
        provider: "anthropic",
        primary_adapter: "claude-code",
        coverage_tier: "required",
      },
      providerVariantId: "anthropic-primary",
      coverageTier: "required",
      env: {
        ...process.env,
        AOR_PREFLIGHT_CAPTURE_FILE: captureFile,
      },
      runnerAuthMode: "host",
      runnerAuthSource: "host",
      runtimeAgentPermissionMode: "full-bypass",
      runtimeAgentInteractionPolicy: "fail-closed",
      runtimeAgentAutoApprovalProfile: "none",
      authProbeRequired: true,
      permissionReadinessRequired: true,
      runId: "claude-request-artifact-preflight",
      reportsRoot,
    });

    assert.equal(result.status, "pass");
    const calls = fs
      .readFileSync(captureFile, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(calls.length, 3);
    assert.ok(calls.every((call) => call.message.includes("Run only the AOR live-adapter preflight")));
    assert.ok(calls.every((call) => call.message.includes("Do not invoke provider CLIs")));
    assert.ok(calls.every((call) => call.message.includes("commands-run: []")));
    assert.ok(calls.every((call) => !call.message.includes("Execute the approved AOR implementation")));
    assert.equal(calls[0].preflight_contract.auth_probe_is_this_invocation, true);
    assert.equal(calls[0].preflight_contract.shell_commands_allowed, "none");
    assert.deepEqual(calls[0].preflight_contract.forbidden_provider_commands, [
      "codex",
      "claude",
      "opencode",
      "qwen",
    ]);
    assert.equal(calls[1].preflight_contract.shell_commands_allowed, "explicit-probe-files-only");
    assert.equal(calls[2].preflight_contract.shell_commands_allowed, "explicit-probe-files-only");
    assert.equal(result.report.edit_readiness.attempts[0].marker_status, "present");
    assert.equal(result.report.permission_readiness.attempts[0].marker_status, "present");
  });
});

test("live adapter preflight retries transient readiness runner timeouts", () => {
  withTempRoot((tempRoot) => {
    const targetCheckoutRoot = path.join(tempRoot, "target");
    const reportsRoot = path.join(tempRoot, "reports");
    const adapterProfileRoot = path.join(tempRoot, "adapters");
    const callStateFile = path.join(tempRoot, "preflight-call-state.json");
    const runnerScript = path.join(tempRoot, "preflight-flaky-runner.mjs");
    fs.mkdirSync(targetCheckoutRoot, { recursive: true });
    fs.mkdirSync(reportsRoot, { recursive: true });
    fs.mkdirSync(adapterProfileRoot, { recursive: true });
    fs.writeFileSync(
      runnerScript,
      [
        "import fs from 'node:fs';",
        "const args = process.argv.slice(2);",
        "const requestFileIndex = args.indexOf('--request-file');",
        "const requestFile = requestFileIndex >= 0 ? args[requestFileIndex + 1] : args.find((entry) => entry.endsWith('.json'));",
        "const packet = JSON.parse(fs.readFileSync(requestFile, 'utf8'));",
        "const stateFile = process.env.AOR_PREFLIGHT_CALL_STATE_FILE;",
        "const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {};",
        "const stepClass = packet.request.step_class;",
        "state[stepClass] = (state[stepClass] || 0) + 1;",
        "fs.writeFileSync(stateFile, JSON.stringify(state));",
        "if (stepClass === 'preflight-permission-readiness' && state[stepClass] === 1) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10000);",
        "const probe = packet.request.edit_probe || packet.request.permission_probe;",
        "if (probe) fs.writeFileSync(probe.marker_file, probe.expected_marker_contents, 'utf8');",
        "process.stdout.write(JSON.stringify({status:'success',summary:'preflight ok'}));",
        "",
      ].join("\n"),
      "utf8",
    );
    fs.writeFileSync(
      path.join(adapterProfileRoot, "codex-cli.yaml"),
      [
        "adapter_id: codex-cli",
        "runner_family: codex",
        "version: 1",
        "launch_modes:",
        "  - non-interactive",
        "capabilities:",
        "  repo_read: true",
        "  repo_write: true",
        "  shell_commands: true",
        "  structured_output: true",
        "constraints:",
        "  requires_local_runtime: true",
        "execution:",
        "  runtime_mode: external-process",
        "  live_baseline: true",
        "  handler: codex-cli-external-runner",
        "  evidence_namespace: evidence://adapter-live/codex-cli",
        "  external_runtime:",
        `    command: ${process.execPath}`,
        "    request_transport: request-artifact",
        "    request_file:",
        "      argument: --request-file",
        "      message: Execute the approved AOR implementation using the provider work packet at {provider_work_packet_path}.",
        "    preflight_timeout_ms: 2000",
        "    timeout_ms: 30000",
        "    env_from:",
        "      AOR_PREFLIGHT_CALL_STATE_FILE: AOR_PREFLIGHT_CALL_STATE_FILE",
        "    permission_policy:",
        "      default_mode: full-bypass",
        "      modes:",
        "        full-bypass:",
        "          args:",
        `            - ${JSON.stringify(runnerScript)}`,
        "",
      ].join("\n"),
      "utf8",
    );

    const result = runLiveAdapterPreflight({
      targetCheckoutRoot,
      adapterProfileRoot,
      providerVariant: {
        provider: "openai",
        primary_adapter: "codex-cli",
        coverage_tier: "required",
      },
      providerVariantId: "openai-primary",
      coverageTier: "required",
      env: {
        ...process.env,
        AOR_PREFLIGHT_CALL_STATE_FILE: callStateFile,
      },
      runnerAuthMode: "host",
      runnerAuthSource: "host",
      runtimeAgentPermissionMode: "full-bypass",
      runtimeAgentInteractionPolicy: "fail-closed",
      runtimeAgentAutoApprovalProfile: "none",
      authProbeRequired: true,
      permissionReadinessRequired: true,
      runId: "codex-flaky-permission-readiness",
      reportsRoot,
    });

    assert.equal(result.status, "pass");
    assert.equal(result.report.permission_readiness.attempts.length, 2);
    assert.equal(result.report.permission_readiness.attempts[0].failure_kind, "external-runner-timeout");
    assert.equal(result.report.permission_readiness.attempts[0].timed_out, true);
    assert.equal(result.report.permission_readiness.attempts[1].status, "pass");
    assert.equal(result.report.permission_readiness.attempts[1].marker_status, "present");
    const callState = JSON.parse(fs.readFileSync(callStateFile, "utf8"));
    assert.equal(callState["preflight-permission-readiness"], 2);
  });
});

test("target checkout materialization supports short physical roots for path-sensitive providers", () => {
  withTempRoot((tempRoot) => {
    const sourceRepo = path.join(tempRoot, "source-repo");
    fs.mkdirSync(sourceRepo, { recursive: true });
    fs.writeFileSync(path.join(sourceRepo, "README.md"), "# target\n", "utf8");
    for (const args of [
      ["init", "-b", "main"],
      ["config", "user.email", "aor@example.com"],
      ["config", "user.name", "AOR Test"],
      ["add", "README.md"],
      ["commit", "-m", "initial"],
    ]) {
      const result = spawnSync("git", args, { cwd: sourceRepo, encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr || result.stdout);
    }
    const layout = {
      targetCheckoutsRoot: path.join(tempRoot, "runtime", "projects", "aor-core", "target-checkouts"),
    };
    fs.mkdirSync(layout.targetCheckoutsRoot, { recursive: true });

    const checkout = materializeTargetCheckout({
      hostRoot: tempRoot,
      layout,
      runId: "live-e2e.installed-user.guided-journey.qwen-short-root-1780350000",
      profile: {
        live_e2e: {
          target_checkout_root_mode: "short-physical",
        },
        target_repo: {
          repo_id: "sindresorhus/ky",
          repo_url: sourceRepo,
          ref: "main",
          checkout_strategy: "full",
        },
      },
    });

    assert.equal(fs.existsSync(path.join(checkout.targetCheckoutRoot, ".git")), true);
    assert.equal(fs.readFileSync(path.join(checkout.targetCheckoutRoot, "README.md"), "utf8"), "# target\n");
    assert.equal(checkout.targetCheckoutRoot.startsWith(layout.targetCheckoutsRoot), false);
    assert.ok(checkout.targetCheckoutRoot.length < path.join(layout.targetCheckoutsRoot, "sindresorhus-ky-live-e2e.installed-user.guided-journey.qwen-short-root-1780350000").length);
  });
});

test("provider-pinned route materialization honors profile step timeout overrides", () => {
  withTempRoot((tempRoot) => {
    const routesRoot = path.join(tempRoot, "routes");
    fs.cpSync(path.join(repoRoot, "examples/routes"), routesRoot, { recursive: true });

    const result = materializeProviderPinnedRouteOverrides({
      routesRoot,
      providerVariant: {
        provider: "qwen",
        primary_adapter: "qwen-code",
        route_override_policy: {
          steps: ["implement", "repair"],
        },
      },
      providerVariantId: "qwen-primary",
      profile: {
        live_e2e: {
          provider_step_timeouts_sec: {
            implement: 600,
            repair: 300,
          },
        },
      },
    });

    assert.equal(result.routeOverrides.implement, "route.implement.default.qwen-primary");
    assert.equal(result.routeOverrides.repair, "route.repair.default.qwen-primary");
    const implementRoute = loadContractFile({
      filePath: path.join(routesRoot, "implement-qwen-primary.yaml"),
      family: "provider-route-profile",
    });
    const repairRoute = loadContractFile({
      filePath: path.join(routesRoot, "repair-qwen-primary.yaml"),
      family: "provider-route-profile",
    });
    assert.equal(implementRoute.ok, true);
    assert.equal(repairRoute.ok, true);
    assert.equal(implementRoute.document.constraints.timeout_sec, 600);
    assert.equal(repairRoute.document.constraints.timeout_sec, 300);
  });
});

test("provider-pinned policy materialization honors bounded retry and repair overrides", () => {
  withTempRoot((tempRoot) => {
    const policiesRoot = path.join(tempRoot, "policies");
    fs.cpSync(path.join(repoRoot, "examples/policies"), policiesRoot, { recursive: true });

    const result = materializeProviderPinnedPolicyOverrides({
      policiesRoot,
      providerVariantId: "qwen-primary",
      profile: {
        live_e2e: {
          provider_step_retry_max_attempts: {
            implement: 0,
            repair: 0,
          },
          provider_step_repair_max_attempts: {
            implement: 0,
            repair: 0,
          },
        },
      },
    });

    assert.equal(
      result.policyOverrides.implement,
      "policy.step.runner.default.qwen-primary.implement.bounded",
    );
    assert.equal(
      result.policyOverrides.repair,
      "policy.step.repair.default.qwen-primary.repair.bounded",
    );
    const implementPolicy = loadContractFile({
      filePath: path.join(policiesRoot, "implement-qwen-primary-policy.yaml"),
      family: "step-policy-profile",
    });
    const repairPolicy = loadContractFile({
      filePath: path.join(policiesRoot, "repair-qwen-primary-policy.yaml"),
      family: "step-policy-profile",
    });
    assert.equal(implementPolicy.ok, true);
    assert.equal(repairPolicy.ok, true);
    assert.equal(implementPolicy.document.retry.max_attempts, 0);
    assert.equal(implementPolicy.document.repair.max_attempts, 0);
    assert.equal(repairPolicy.document.retry.max_attempts, 0);
    assert.equal(repairPolicy.document.repair.max_attempts, 0);
  });
});

test("provider-pinned policy materialization defaults live E2E provider steps to no internal repair", () => {
  withTempRoot((tempRoot) => {
    const policiesRoot = path.join(tempRoot, "policies");
    fs.cpSync(path.join(repoRoot, "examples/policies"), policiesRoot, { recursive: true });

    const result = materializeProviderPinnedPolicyOverrides({
      policiesRoot,
      providerVariantId: "openai-primary",
      providerVariant: {
        provider: "openai",
        primary_adapter: "codex-cli",
        route_override_policy: {
          steps: ["implement", "review", "qa", "repair"],
        },
      },
      profile: {
        live_e2e: {},
      },
    });

    assert.deepEqual(Object.keys(result.policyOverrides).sort(), ["implement", "qa", "repair", "review"]);
    for (const [step, policyId] of Object.entries(result.policyOverrides)) {
      const loaded = loadContractFile({
        filePath: path.join(policiesRoot, `${step}-openai-primary-policy.yaml`),
        family: "step-policy-profile",
      });
      assert.equal(loaded.ok, true);
      assert.equal(loaded.document.policy_id, policyId);
      assert.equal(loaded.document.retry.max_attempts, 0);
      assert.equal(loaded.document.repair.max_attempts, 0);
    }
  });
});

test("live E2E generated project profile wiring preserves provider variants in every flow", () => {
  const flowsSource = fs.readFileSync(path.join(repoRoot, "scripts/live-e2e/lib/flows.mjs"), "utf8");
  const materializationCalls = flowsSource.match(
    /const generatedProfile = materializeGeneratedProjectProfile\(\{[\s\S]*?\n    \}\);/gu,
  ) ?? [];

  assert.ok(materializationCalls.length > 0);
  for (const materializationCall of materializationCalls) {
    assert.match(materializationCall, /providerVariant: options\.providerVariant/u);
  }
  assert.match(flowsSource, /materializeProviderPinnedPolicyOverrides/u);
  assert.match(flowsSource, /providerVariant: options\.providerVariant/u);
  assert.match(flowsSource, /--policy-overrides/u);
});

test("guided journey proof requires flow-loop and browser-task evidence", () => {
  withTempRoot((tempRoot) => {
    const { proof, targetCheckoutRoot } = writeGuidedProofFixture(tempRoot);
    assert.deepEqual(validateGuidedJourneyProof(proof, { targetCheckoutRoot }), []);

    const missingSecondFlow = structuredClone(proof);
    missingSecondFlow.flow_loop.second_flow_id = missingSecondFlow.flow_loop.first_flow_id;
    assert.match(
      validateGuidedJourneyProof(missingSecondFlow, { targetCheckoutRoot }).join("\n"),
      /second flow distinct/u,
    );

    const missingBrowserTask = structuredClone(proof);
    missingBrowserTask.web_smoke.browser_task_proof_file = null;
    assert.match(
      validateGuidedJourneyProof(missingBrowserTask, { targetCheckoutRoot }).join("\n"),
      /browser-task proof evidence/u,
    );

    const missingTargetFlow = structuredClone(proof);
    missingTargetFlow.flow_loop.operator_request.target_flow_id = null;
    assert.match(
      validateGuidedJourneyProof(missingTargetFlow, { targetCheckoutRoot }).join("\n"),
      /operator_request\.target_flow_id/u,
    );
  });
});

test("proof runner hydrates guided UI refs and blocks missing browser-task proof", () => {
  withTempRoot((tempRoot) => {
    const reportsRoot = path.join(tempRoot, "reports");
    const runtimeRoot = path.join(tempRoot, "runtime");
    const targetCheckoutRoot = path.join(tempRoot, "target");
    fs.mkdirSync(reportsRoot, { recursive: true });
    fs.mkdirSync(runtimeRoot, { recursive: true });
    fs.mkdirSync(targetCheckoutRoot, { recursive: true });

    const runId = "guided-ui-proof-missing";
    const normalizedRunId = "guided-ui-proof-missing";
    const webSmokeSummaryFile = writeJsonFixture(
      path.join(reportsRoot, `installed-user-guided-web-smoke-${normalizedRunId}.json`),
      {
        summary_file: path.join(reportsRoot, `installed-user-guided-web-smoke-${normalizedRunId}.json`),
        rendered_html_file: path.join(reportsRoot, `installed-user-guided-web-smoke-${normalizedRunId}.html`),
        dom_snapshot_file: path.join(reportsRoot, `installed-user-guided-web-smoke-dom-${normalizedRunId}.json`),
        accessibility_summary_file: path.join(
          reportsRoot,
          `installed-user-guided-web-smoke-accessibility-${normalizedRunId}.json`,
        ),
        visual_guardrail_file: path.join(
          reportsRoot,
          `installed-user-guided-web-smoke-visual-guardrail-${normalizedRunId}.json`,
        ),
        browser_task_proof_request_file: path.join(
          reportsRoot,
          `installed-user-guided-browser-task-proof-request-${normalizedRunId}.json`,
        ),
        browser_task_proof_file: null,
        screenshot_files: [],
        task_outcome: {
          status: "not_pass",
          checked_tasks: ["browser-task evidence capture"],
          findings: ["browser-task-proof requires skill-agent browser evidence."],
        },
        ux_findings: ["browser-task-proof requires skill-agent browser evidence."],
        html_loaded: true,
        flow_selector_loaded: true,
        new_flow_action_loaded: true,
        guided_lifecycle_state: "smoke-pass",
        detached: true,
      },
    );
    const files = Object.fromEntries(
      [
        "controller-state.json",
        "install-proof.json",
        "generated-project.aor.yaml",
        "feature-request.json",
        "intake-packet.json",
        "intake-body.json",
        "discovery-report.json",
        "spec-step-result.json",
        "handoff-packet.json",
        "approved-handoff-packet.json",
        "runtime-harness-report.json",
        "review-report.json",
        "evaluation-report.json",
        "delivery-manifest.json",
        "release-packet.json",
        "learning-scorecard.json",
        "learning-handoff.json",
        "post-run-verify-summary.json",
        "web.html",
        "web-dom.json",
        "web-accessibility.json",
        "web-visual.json",
        "browser-task-proof-request.json",
      ].map((name) => [name, path.join(reportsRoot, name)]),
    );
    for (const file of Object.values(files)) writeJsonFixture(file);
    writeJsonFixture(files["browser-task-proof-request.json"], {
      expected_browser_task_proof_file: path.join(
        reportsRoot,
        `installed-user-guided-browser-task-proof-${normalizedRunId}.json`,
      ),
    });
    fs.writeFileSync(path.join(reportsRoot, `installed-user-guided-web-smoke-${normalizedRunId}.html`), "<main>AOR</main>\n", "utf8");
    writeJsonFixture(path.join(reportsRoot, `installed-user-guided-web-smoke-dom-${normalizedRunId}.json`));
    writeJsonFixture(path.join(reportsRoot, `installed-user-guided-web-smoke-accessibility-${normalizedRunId}.json`));
    writeJsonFixture(path.join(reportsRoot, `installed-user-guided-web-smoke-visual-guardrail-${normalizedRunId}.json`));
    writeJsonFixture(path.join(reportsRoot, `installed-user-guided-browser-task-proof-request-${normalizedRunId}.json`), {
      expected_browser_task_proof_file: path.join(
        reportsRoot,
        `installed-user-guided-browser-task-proof-${normalizedRunId}.json`,
      ),
    });

    const includedSteps = ["discovery", "spec", "planning", "handoff", "execution", "review", "qa", "delivery", "release", "learning"];
    const stepJournal = includedSteps.map((step, index) => {
      const ref = writeJsonFixture(path.join(reportsRoot, `${step}-artifact.json`));
      return {
        sequence: index + 1,
        step_id: step,
        step_instance_id: step,
        iteration: 1,
        flow_stage: step,
        plan: {
          objective: `${step} objective`,
          public_surface: `aor ${step}`,
          command_labels: [`${step}-command`],
          expected_artifacts: [`${step}-artifact`],
          inspection_sources: ["command_transcript"],
          safety_constraints: ["no-upstream-write"],
        },
        plan_ref: ref,
        public_surface: `aor ${step}`,
        transcript_ref: ref,
        execution_ref: ref,
        inspection_ref: ref,
        classification_ref: ref,
        artifact_refs: [ref],
        started_at: "2026-06-09T00:00:00.000Z",
        finished_at: "2026-06-09T00:00:01.000Z",
        duration_sec: 1,
        deterministic_analysis: { status: "pass", exit_code: 0, failure_class: null, missing_evidence: [], recommendation: "continue" },
        semantic_analysis: { status: "pass", judge_source: "skill-agent", findings: [] },
        agent_decision_request_ref: ref,
        operator_decision_ref: ref,
        operator_decision_status: "accepted",
        inspected_evidence_refs: [ref],
        requested_interaction: null,
        decision: { action: "continue", reason: "Accepted test evidence." },
        resume_result: null,
        frontend_interaction_refs: [],
        final_step_verdict: "pass",
      };
    });

    writeJsonFixture(files["controller-state.json"], {
      current_step: null,
      completed_steps: includedSteps,
      artifacts_snapshot: {
        target_checkout_root: targetCheckoutRoot,
        generated_project_profile_file: files["generated-project.aor.yaml"],
        feature_request_file: files["feature-request.json"],
        intake_artifact_packet_file: files["intake-packet.json"],
        intake_artifact_packet_body_file: files["intake-body.json"],
        discovery_analysis_report_file: files["discovery-report.json"],
        spec_step_result_file: files["spec-step-result.json"],
        handoff_packet_file: files["handoff-packet.json"],
        approved_handoff_packet_file: files["approved-handoff-packet.json"],
        runtime_harness_report_file: files["runtime-harness-report.json"],
        review_report_file: files["review-report.json"],
        evaluation_report_file: files["evaluation-report.json"],
        delivery_manifest_file: files["delivery-manifest.json"],
        release_packet_file: files["release-packet.json"],
        learning_loop_scorecard_file: files["learning-scorecard.json"],
        learning_loop_handoff_file: files["learning-handoff.json"],
        post_run_verify_summary_file: files["post-run-verify-summary.json"],
        post_run_verify_status: "pass",
        provider_execution_status: "completed",
        real_code_change_status: "pass",
        guided_web_smoke: JSON.parse(fs.readFileSync(webSmokeSummaryFile, "utf8")),
        guided_web_smoke_summary_file: webSmokeSummaryFile,
        guided_web_smoke_html_file: path.join(reportsRoot, `installed-user-guided-web-smoke-${normalizedRunId}.html`),
        guided_web_dom_snapshot_file: path.join(reportsRoot, `installed-user-guided-web-smoke-dom-${normalizedRunId}.json`),
        guided_web_accessibility_summary_file: path.join(
          reportsRoot,
          `installed-user-guided-web-smoke-accessibility-${normalizedRunId}.json`,
        ),
        guided_web_visual_guardrail_file: path.join(
          reportsRoot,
          `installed-user-guided-web-smoke-visual-guardrail-${normalizedRunId}.json`,
        ),
        guided_browser_task_proof_request_file: path.join(
          reportsRoot,
          `installed-user-guided-browser-task-proof-request-${normalizedRunId}.json`,
        ),
        guided_browser_task_proof_file: null,
        feature_mission_id: "ky-header-regression",
        feature_size: "small",
      },
    });

    const writeOptions = {
      hostRoot: repoRoot,
      hostProjectId: "aor-test",
      layout: { reportsRoot, runtimeRoot },
      runId,
      profilePath: path.join(tempRoot, "profile.yaml"),
      profile: {
        profile_id: "live-e2e.test.guided-ui-proof-missing",
        journey_mode: "full-journey",
        run_tier: "acceptance",
        target_catalog_id: "ky",
        feature_mission_id: "ky-header-regression",
        scenario_family: "regress",
        provider_variant_id: "openai-primary",
        stages: includedSteps,
        live_e2e: {
          flow_range_policy: "full_lifecycle",
          frontend_capability: "browser-task-proof",
          operator_mode: "skill-agent",
          agent_decision_policy: "required",
          interaction_answer_policy: "agent-required",
          target_write_policy: "aor-runtime-only-before-execution",
        },
        guided_journey: {
          enabled: true,
          proof_requirements: ["web-smoke", "browser-task-proof"],
          browser_task_proof: { required: true },
        },
      },
      flowResult: {
        startedAt: "2026-06-09T00:00:00.000Z",
        finishedAt: "2026-06-09T00:00:02.000Z",
        status: "pass",
        stageResults: includedSteps.map((step) => ({
          stage: step,
          status: "pass",
          evidence_refs: [files["delivery-manifest.json"]],
          summary: `${step} passed.`,
        })),
        commandResults: [],
        artifacts: {
          host_runtime_root: runtimeRoot,
          host_reports_root: reportsRoot,
          live_e2e_controller_state_file: files["controller-state.json"],
          live_e2e_step_journal_entries: stepJournal,
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
        },
      },
      aorLaunch: {
        command: process.execPath,
        argsPrefix: [],
        binaryRef: runProfileScript,
      },
    };

    const written = writeProofRunnerArtifacts(writeOptions);

    const observationReport = JSON.parse(fs.readFileSync(written.summary.live_e2e_observation_report_file, "utf8"));
    assert.equal(observationReport.frontend_interactions.length, 1);
    assert.equal(observationReport.frontend_interactions[0].task_outcome.status, "not_pass");
    assert.equal(written.summary.feature_request_file, files["feature-request.json"]);
    assert.equal(written.summary.guided_web_smoke_summary_file, webSmokeSummaryFile);
    assert.equal(written.summary.guided_browser_task_proof_file, null);
    assert.equal(written.runHealthReport.overall_status, "blocked");
    assert.equal(written.runHealthReport.evidence_health.status, "blocked");
    assert.equal(written.runHealthReport.evidence_health.weak_evidence_refs.includes("guided-browser-task-proof"), true);
    assert.equal(written.runHealthReport.failure_summary.owner, "operator");
    assert.equal(written.runHealthReport.failure_summary.phase, "ui_validation");
    assert.equal(written.runHealthReport.failure_summary.class, "guided_browser_task_proof_missing");

    const browserTaskProofFile = path.join(
      reportsRoot,
      `installed-user-guided-browser-task-proof-${normalizedRunId}.json`,
    );
    const screenshotFile = path.join(reportsRoot, `installed-user-guided-browser-task-proof-${normalizedRunId}.png`);
    fs.writeFileSync(screenshotFile, "png", "utf8");
    writeJsonFixture(browserTaskProofFile, {
      status: "pass",
      rendered_html_file: path.join(reportsRoot, `installed-user-guided-web-smoke-${normalizedRunId}.html`),
      dom_snapshot_file: path.join(reportsRoot, `installed-user-guided-web-smoke-dom-${normalizedRunId}.json`),
      accessibility_summary_file: path.join(
        reportsRoot,
        `installed-user-guided-web-smoke-accessibility-${normalizedRunId}.json`,
      ),
      visual_guardrail_file: path.join(
        reportsRoot,
        `installed-user-guided-web-smoke-visual-guardrail-${normalizedRunId}.json`,
      ),
      screenshot_files: [screenshotFile],
      task_outcome: {
        status: "pass",
        checked_tasks: ["browser-task evidence capture", "operator task interaction"],
        findings: [],
      },
      ux_findings: ["The AOR operator flow selector and next action were inspectable."],
    });

    const hydrated = writeProofRunnerArtifacts(writeOptions);
    const hydratedObservation = JSON.parse(fs.readFileSync(hydrated.summary.live_e2e_observation_report_file, "utf8"));
    const hydratedWebSmoke = JSON.parse(fs.readFileSync(webSmokeSummaryFile, "utf8"));
    assert.equal(hydrated.summary.guided_browser_task_proof_file, browserTaskProofFile);
    assert.equal(hydratedObservation.frontend_interactions[0].task_outcome.status, "pass");
    assert.equal(hydratedObservation.frontend_interactions[0].browser_task_proof_ref, browserTaskProofFile);
    assert.deepEqual(hydratedObservation.frontend_interactions[0].screenshot_refs, [screenshotFile]);
    assert.equal(hydratedWebSmoke.task_outcome.status, "pass");
    assert.equal(hydratedWebSmoke.browser_task_proof_file, browserTaskProofFile);
    assert.deepEqual(hydratedWebSmoke.screenshot_files, [screenshotFile]);
    assert.equal(
      hydratedWebSmoke.ux_findings.some((finding) =>
        /browser-task-proof requires skill-agent browser evidence/iu.test(finding),
      ),
      false,
    );
    assert.equal(hydrated.runHealthReport.overall_status, "pass");
  });
});

test("guided browser-task proof request points at a live app surface, not the short-lived smoke URL", () => {
  withTempRoot((tempRoot) => {
    const reportsRoot = path.join(tempRoot, "reports");
    const targetCheckoutRoot = path.join(tempRoot, "target");
    fs.mkdirSync(reportsRoot, { recursive: true });
    fs.mkdirSync(path.join(targetCheckoutRoot, ".aor"), { recursive: true });
    const fakeAor = path.join(tempRoot, "fake-aor.mjs");
    fs.writeFileSync(
      fakeAor,
      [
        "const args = process.argv.slice(2);",
        "if (args.includes('--smoke')) {",
        "  console.log(JSON.stringify({",
        "    command: 'app',",
        "    mode: 'local-spa',",
        "    status: 'smoke-pass',",
        "    app_url: 'http://127.0.0.1:61001/',",
        "    control_plane: 'http://127.0.0.1:61001',",
        "    project_id: 'local-target',",
        "    project_ref: process.cwd(),",
        "    runtime_root: process.cwd() + '/.aor',",
        "    html_loaded: true,",
        "    flow_selector_loaded: true,",
        "    new_flow_action_loaded: true,",
        "    first_run_wizard_loaded: true,",
        "    project_switcher_loaded: true,",
        "    config_project_id: 'local-target',",
        "    config_default_project_id: 'local-target',",
        "    project_index_default_project_id: 'local-target',",
        "    state_project_id: 'local-target',",
        "    render_guard_status: 'pass',",
        "    render_guard: { status: 'pass', findings: [] }",
        "  }));",
        "  process.exit(0);",
        "}",
        "console.log(JSON.stringify({",
        "  command: 'app',",
        "  mode: 'local-spa',",
        "  status: 'running',",
        "  app_url: 'http://127.0.0.1:61002/',",
        "  control_plane: 'http://127.0.0.1:61002',",
        "  project_id: 'local-target',",
        "  project_ref: process.cwd(),",
        "  runtime_root: process.cwd() + '/.aor'",
        "}));",
        "setInterval(() => {}, 1000);",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = runGuidedWebSmoke({
      aorLaunch: {
        command: process.execPath,
        argsPrefix: [fakeAor],
        binaryRef: fakeAor,
      },
      targetCheckoutRoot,
      runId: "guided-live-surface",
      reportsRoot,
      env: process.env,
    });
    const request = JSON.parse(fs.readFileSync(result.browserTaskProofRequestFile, "utf8"));
    assert.equal(request.smoke_app_url, "http://127.0.0.1:61001/");
    assert.equal(request.app_url, "http://127.0.0.1:61002/");
    assert.equal(request.control_plane, "http://127.0.0.1:61002");
    assert.equal(request.app_server_status, "running");
    assert.equal(
      request.rendered_html_file,
      path.join(reportsRoot, "installed-user-guided-web-smoke-guided-live-surface.html"),
    );
    assert.equal(
      request.dom_snapshot_file,
      path.join(reportsRoot, "installed-user-guided-web-smoke-dom-guided-live-surface.json"),
    );
    assert.equal(
      request.accessibility_summary_file,
      path.join(reportsRoot, "installed-user-guided-web-smoke-accessibility-guided-live-surface.json"),
    );
    assert.equal(
      request.visual_guardrail_file,
      path.join(reportsRoot, "installed-user-guided-web-smoke-visual-guardrail-guided-live-surface.json"),
    );
    assert.deepEqual(request.evidence_refs, [
      request.rendered_html_file,
      request.dom_snapshot_file,
      request.accessibility_summary_file,
      request.visual_guardrail_file,
    ]);
    assert.match(request.instructions.join("\n"), /Open app_url, not smoke_app_url/u);
    assert.ok(Number.isInteger(request.app_server_pid));
    assert.equal(result.summary.browser_task_app_url, "http://127.0.0.1:61002/");
    try {
      process.kill(request.app_server_pid, "SIGTERM");
    } catch {
      // Test cleanup only.
    }
  });
});

test("guided flow loop prefers archived first-flow next-action evidence", () => {
  withTempRoot((tempRoot) => {
    const targetRoot = path.join(tempRoot, "target");
    const reportsRoot = path.join(targetRoot, ".aor/projects/project.one/reports");
    fs.mkdirSync(reportsRoot, { recursive: true });
    const archivedReportFile = path.join(reportsRoot, "next-action-report-first-flow.json");
    fs.writeFileSync(
      archivedReportFile,
      `${JSON.stringify({
        closure_state: {
          learning: {
            status: "handoff-complete",
          },
        },
        primary_action: {
          action_id: "start-new-flow",
        },
      }, null, 2)}\n`,
      "utf8",
    );

    const archived = archivedNextActionReportForMission(targetRoot, {
      projectId: "project.one",
      missionId: "first-flow",
    });

    assert.equal(archived, archivedReportFile);
    assert.equal(nextActionReportClosesFlow(JSON.parse(fs.readFileSync(archivedReportFile, "utf8"))), true);
    assert.equal(
      nextActionReportClosesFlow({
        closure_state: { learning: { status: "waiting-for-release" } },
        primary_action: { action_id: "spec-build" },
      }),
      false,
    );
  });
});

test("run summary uses run-health instead of canonical outcome verdicts", () => {
  const runProfileSource = fs.readFileSync(runProfileScript, "utf8");
  assert.match(runProfileSource, /function buildRunHealthReport/u);
  assert.match(runProfileSource, /live_e2e_run_health_report_file/u);
  assert.doesNotMatch(runProfileSource, /quality_judgement/u);
  assert.doesNotMatch(runProfileSource, /runner_quality_summary/u);
  assert.doesNotMatch(runProfileSource, /final_skill_agent_verdict/u);
  assert.doesNotMatch(runProfileSource, /canonical_status/u);
});

test("proof runner preserves target setup and provider interruption evidence on manual resume", () => {
  const runProfileSource = fs.readFileSync(runProfileScript, "utf8");
  const flowSource = fs.readFileSync(fullJourneyFlowScript, "utf8");
  assert.match(runProfileSource, /function hydrateFlowArtifactsFromControllerState/u);
  assert.match(runProfileSource, /artifacts_snapshot/u);
  assert.match(runProfileSource, /target_pre_execution_status/u);
  assert.match(runProfileSource, /target_setup_status/u);
  assert.match(runProfileSource, /target_verification_status_detail/u);
  assert.match(runProfileSource, /function classifyProviderStepStatus/u);
  assert.match(runProfileSource, /failure_owner: operatorStopped \? "operator" : "provider"/u);
  assert.match(runProfileSource, /failure_owner: "provider"/u);
  assert.match(runProfileSource, /failure_phase: "provider_execution"/u);
  assert.match(runProfileSource, /failure_class: operatorStopped \? "operator_stopped" : "provider_blocked"/u);
  assert.match(runProfileSource, /failure_class: "provider_blocked"/u);
  assert.match(runProfileSource, /provider_step_status:[\s\S]*options\.flowResult\.artifacts\.provider_step_status/u);
  assert.match(runProfileSource, /function buildRunHealthReport/u);
  assert.match(runProfileSource, /source_observation_report_file/u);
  assert.match(flowSource, /shouldReuseLiveAdapterPreflight/u);
  assert.match(flowSource, /live_adapter_preflight_reused_after_resume/u);
});

test("manual live E2E exposes operator decisions and leaves outcome assessment post-run", () => {
  const help = spawnSync(process.execPath, [manualLiveE2eScript, "--help"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--operator-decision-file/u);
  assert.doesNotMatch(help.stdout, /--final-verdict-file/u);

  const source = fs.readFileSync(manualLiveE2eScript, "utf8");
  assert.doesNotMatch(source, /installFinalSkillAgentVerdict/u);
  assert.doesNotMatch(source, /final_skill_agent_verdict/u);

  const assessmentHelp = spawnSync(process.execPath, [qualityAssessmentScript, "--help"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(assessmentHelp.status, 0);
  assert.match(assessmentHelp.stdout, /quality-assessment\.mjs prepare/u);
  assert.match(assessmentHelp.stdout, /quality-assessment\.mjs validate/u);
  assert.match(assessmentHelp.stdout, /quality-assessment\.mjs gate/u);
});

test("manual decision preparation ignores stale accepted request files when request is implicit", () => {
  withTempRoot((tempRoot) => {
    const runId = "manual-stale-request";
    const projectRoot = path.join(tempRoot, "project");
    const runtimeRoot = path.join(tempRoot, "runtime");
    const reportsRoot = path.join(runtimeRoot, "projects/aor-core/reports");
    fs.mkdirSync(projectRoot, { recursive: true });
    const evidenceRef = writeJsonFixture(path.join(reportsRoot, "evidence.json"), { status: "pass" });

    const pendingDecisionRef = path.join(reportsRoot, "pending-decision.json");
    const pendingRequestRef = writeJsonFixture(
      path.join(reportsRoot, `live-e2e-agent-decision-request-${runId}-02-spec.json`),
      {
        request_id: `${runId}.spec.operator-decision-request`,
        step_id: "spec",
        step_instance_id: "spec",
        operator_decision_expected_ref: pendingDecisionRef,
        deterministic_analysis: { status: "pass" },
        decision_rubric: { required_evidence_refs: [evidenceRef] },
        expected_response_shape: {
          action: "continue|diagnose|block",
          inspected_evidence_refs: [evidenceRef],
          evidence_refs: [evidenceRef],
        },
      },
    );

    const staleDecisionRef = writeJsonFixture(path.join(reportsRoot, "stale-decision.json"), { action: "continue" });
    const staleRequestRef = writeJsonFixture(
      path.join(reportsRoot, `live-e2e-agent-decision-request-${runId}-01-discovery.json`),
      {
        request_id: `${runId}.discovery.operator-decision-request`,
        step_id: "discovery",
        step_instance_id: "discovery",
        operator_decision_expected_ref: staleDecisionRef,
        deterministic_analysis: { status: "pass" },
        decision_rubric: { required_evidence_refs: [evidenceRef] },
        expected_response_shape: {
          action: "continue|diagnose|block",
          inspected_evidence_refs: [evidenceRef],
          evidence_refs: [evidenceRef],
        },
      },
    );
    const now = new Date();
    fs.utimesSync(pendingRequestRef, new Date(now.getTime() - 10_000), new Date(now.getTime() - 10_000));
    fs.utimesSync(staleRequestRef, now, now);

    const result = spawnSync(
      process.execPath,
      [
        manualLiveE2eScript,
        "--prepare-decision",
        "--project-ref",
        projectRoot,
        "--runtime-root",
        runtimeRoot,
        "--run-id",
        runId,
        "--action",
        "continue",
        "--dry-run",
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
      },
    );

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, "preview");
    assert.equal(output.request_ref, pendingRequestRef);
    assert.equal(output.output_ref, pendingDecisionRef);
  });
});

test("manual resume installs an already prepared decision through its source request ref", () => {
  withTempRoot((tempRoot) => {
    const runId = "manual-prepared-decision";
    const projectRoot = path.join(tempRoot, "project");
    const runtimeRoot = path.join(tempRoot, "runtime");
    const reportsRoot = path.join(runtimeRoot, "projects/aor-core/reports");
    fs.mkdirSync(projectRoot, { recursive: true });
    const evidenceRef = writeJsonFixture(path.join(reportsRoot, "evidence.json"), { status: "pass" });
    const decisionRef = path.join(reportsRoot, "operator-decision.json");
    const requestRef = writeJsonFixture(
      path.join(reportsRoot, `live-e2e-agent-decision-request-${runId}-01-discovery.json`),
      {
        request_id: `${runId}.discovery.operator-decision-request`,
        step_id: "discovery",
        step_instance_id: "discovery",
        operator_decision_expected_ref: decisionRef,
        deterministic_analysis: { status: "pass" },
        decision_rubric: { required_evidence_refs: [evidenceRef] },
        expected_response_shape: {
          action: "continue|diagnose|block",
          inspected_evidence_refs: [evidenceRef],
          evidence_refs: [evidenceRef],
        },
      },
    );
    writeJsonFixture(decisionRef, {
      action: "continue",
      source_agent_decision_request_ref: requestRef,
      inspected_evidence_refs: [evidenceRef],
    });

    const result = spawnSync(
      process.execPath,
      [
        manualLiveE2eScript,
        "--project-ref",
        projectRoot,
        "--profile",
        path.join(tempRoot, "missing-profile.yaml"),
        "--runtime-root",
        runtimeRoot,
        "--run-id",
        runId,
        "--operator-decision-file",
        decisionRef,
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
      },
    );

    assert.notEqual(result.status, 0);
    assert.doesNotMatch(
      `${result.stdout}\n${result.stderr}`,
      /No pending live E2E operator decision request was found/u,
    );
  });
});

test("run-profile returns existing terminal pass reports without rebuilding run-health", () => {
  withTempRoot((tempRoot) => {
    const runId = "terminal-pass-idempotent";
    const runtimeRoot = path.join(tempRoot, "runtime");
    const profilePath = path.join(repoRoot, "scripts/live-e2e/profiles/full-journey-regress-ky.yaml");
    const hostProjectId = discoverHostProjectId(repoRoot);
    const layout = ensureRuntimeLayout({
      hostRoot: repoRoot,
      runtimeRootOverride: runtimeRoot,
      hostProjectId,
    });
    const includedSteps = ["discovery", "spec", "planning", "handoff", "execution", "review", "qa", "delivery"];
    const controllerStateFile = path.join(layout.reportsRoot, `live-e2e-controller-state-${runId}.json`);
    const observationReportFile = path.join(layout.reportsRoot, `live-e2e-observation-report-${runId}.json`);
    const runHealthReportFile = path.join(layout.reportsRoot, `live-e2e-run-health-report-${runId}.json`);
    const summaryFile = path.join(layout.reportsRoot, `live-e2e-run-summary-${runId}.json`);
    const scorecardFile = path.join(layout.reportsRoot, `live-e2e-scorecard-target-${runId}.json`);
    const installProofFile = path.join(layout.reportsRoot, `live-e2e-aor-installation-proof-${runId}.json`);
    const stepObservationFile = path.join(layout.reportsRoot, `live-e2e-step-observation-${runId}-08-delivery.json`);

    writeJsonFixture(controllerStateFile, {
      current_step: null,
      completed_steps: includedSteps,
      pending_decision: {
        action: "continue",
        reason: "Skill-agent accepted public evidence and required inspection refs.",
        next_step: null,
      },
    });
    writeJsonFixture(observationReportFile, {
      report_id: `${runId}.live-e2e-observation.v2`,
      run_id: runId,
      report_status: "final",
      overall_status: "pass",
      flow_range: {
        included_steps: includedSteps,
      },
      step_journal: [],
      evidence_refs: [controllerStateFile],
    });
    writeJsonFixture(runHealthReportFile, {
      report_id: `${runId}.live-e2e-run-health.v1`,
      run_id: runId,
      overall_status: "pass",
      failure_summary: {
        owner: null,
        phase: null,
        class: null,
        summary: null,
      },
    });
    writeJsonFixture(scorecardFile);
    writeJsonFixture(installProofFile);
    writeJsonFixture(stepObservationFile);
    writeJsonFixture(summaryFile, {
      run_id: runId,
      status: "pass",
      run_health_status: "pass",
      live_e2e_run_health_report_file: runHealthReportFile,
      live_e2e_observation_report_file: observationReportFile,
      live_e2e_controller_state_file: controllerStateFile,
      live_e2e_step_observation_files: [stepObservationFile],
      aor_installation_proof_file: installProofFile,
      scorecard_files: [scorecardFile],
    });

    const result = spawnSync(
      process.execPath,
      [
        runProfileScript,
        "--project-ref",
        repoRoot,
        "--profile",
        profilePath,
        "--run-id",
        runId,
        "--runtime-root",
        runtimeRoot,
        "--controller-mode",
        "manual",
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
      },
    );

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const output = JSON.parse(result.stdout);
    assert.equal(output.live_e2e_run_status, "pass");
    assert.equal(output.live_e2e_run_health_status, "pass");
    assert.equal(output.live_e2e_run_summary_file, summaryFile);
    assert.equal(output.live_e2e_run_health_report_file, runHealthReportFile);
    assert.deepEqual(output.live_e2e_step_observation_files, [stepObservationFile]);
    assert.doesNotMatch(result.stderr, /run-health report failed contract validation/u);
  });
});

test("xlarge catalog profiles resolve as manual-only matrix cells", () => {
  const loaded = loadProofRunnerProfile({
    hostRoot: repoRoot,
    profileRef: "scripts/live-e2e/profiles/manual-xlarge-release-nextjs-openai.yaml",
  });
  const resolved = resolveFullJourneyProfile({
    profile: loaded.profile,
    catalogRoot: resolveCatalogRoot({ hostRoot: repoRoot }),
  });

  assert.equal(resolved.featureSize, "xlarge");
  assert.equal(resolved.coverageTier, "manual");
  assert.equal(resolved.matrixCell.cell_id, "nextjs.release.xlarge.openai");
  assert.equal(resolved.resolvedProfile.run_tier, "full-journey-observation");
});

test("run-profile rejects xlarge profiles outside manual controller mode", () => {
  const result = spawnSync(
    process.execPath,
    [
      runProfileScript,
      "--project-ref",
      repoRoot,
      "--profile",
      "scripts/live-e2e/profiles/manual-xlarge-release-nextjs-openai.yaml",
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /feature_size=xlarge, which is manual-only/u);
});

test("qualification loop rejects xlarge profiles", () => {
  const result = spawnSync(
    process.execPath,
    [
      qualificationLoopScript,
      "--project-ref",
      repoRoot,
      "--profile",
      "scripts/live-e2e/profiles/manual-xlarge-release-nextjs-openai.yaml",
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /xlarge is manual-only/u);
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
    assert.equal(fs.existsSync(result.proof.cached_launcher_smoke_file), true);
    assert.equal(result.launch.command, launcher);
    assert.equal(result.setupEntry.public_surface, "cached pnpm source install");
    assert.equal(result.setupEntry.evidence_refs.includes(result.proof.cached_launcher_smoke_file), true);
  });
});

test("source install proof force-refreshes dependencies and smokes intake CLI", () => {
  const flowsSource = fs.readFileSync(fullJourneyFlowScript, "utf8");

  assert.match(flowsSource, /pnpm-install-frozen-lockfile-force/u);
  assert.match(flowsSource, /\["install", "--frozen-lockfile", "--force"\]/u);
  assert.match(flowsSource, /pnpm-aor-intake-create-help/u);
  assert.match(flowsSource, /\["aor", "intake", "create", "--help"\]/u);
});

test("full journey review warnings request repair instead of passing into QA approval", () => {
  const flowsSource = fs.readFileSync(fullJourneyFlowScript, "utf8");

  assert.match(flowsSource, /const reviewNeedsRepair = reviewOverallStatus !== "pass"/u);
  assert.match(flowsSource, /reviewNeedsRepair[\s\S]*reviewRepairActions\.has\("request-repair"\)/u);
  assert.match(flowsSource, /reviewOverallStatus === "warn" \? "warn" : "pass"/u);
  assert.match(flowsSource, /reviewOverallStatus !== "pass" \|\| artifacts\.post_run_verify_status === "fail"/u);
});

test("proof runner writes run-health reports for blocked live E2E reports", () => {
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
    assert.equal(written.summary.live_e2e_run_health_overall_status, "blocked");
    assert.equal(fs.existsSync(written.summary.live_e2e_run_health_report_file), true);
    assert.equal(written.runHealthReport.overall_status, "blocked");
    assert.equal(written.runHealthReport.failure_summary.owner, "operator");
    assert.equal(written.runHealthReport.failure_summary.phase, "controller_decision");
    assert.equal(written.runHealthReport.failure_summary.class, "controller_incomplete");
    assert.equal(written.runHealthReport.controller_health.missing_operator_decision_steps.includes("discovery"), true);
    assert.equal(written.runHealthReport.resume_interaction_health.pending_decision_count, 1);
    assert.equal(written.summary.runner_quality_summary, undefined);
    assert.equal(written.summary.quality_judgement, undefined);
  });
});

test("proof runner keeps partial controller observations in progress when pending steps lack decisions", () => {
  withTempRoot((tempRoot) => {
    const reportsRoot = path.join(tempRoot, "reports");
    const runtimeRoot = path.join(tempRoot, "runtime");
    const targetCheckoutRoot = path.join(tempRoot, "target");
    fs.mkdirSync(reportsRoot, { recursive: true });
    fs.mkdirSync(runtimeRoot, { recursive: true });
    fs.mkdirSync(targetCheckoutRoot, { recursive: true });

    const runId = "partial-guided-ui-proof-blocked";
    const genericEvidence = path.join(reportsRoot, "generic-evidence.json");
    const installProof = path.join(reportsRoot, "install-proof.json");
    const controllerState = path.join(reportsRoot, "controller-state.json");
    const generatedProject = path.join(reportsRoot, "generated-project.aor.yaml");
    const featureRequest = path.join(reportsRoot, "feature-request.json");
    const baselineVerify = path.join(reportsRoot, "baseline-verify-summary.json");
    for (const file of [genericEvidence, installProof, generatedProject, featureRequest, baselineVerify]) {
      fs.writeFileSync(file, "{}\n", "utf8");
    }
    fs.writeFileSync(
      controllerState,
      `${JSON.stringify(
        {
          current_step: "qa",
          completed_steps: ["discovery", "spec", "planning", "handoff", "execution", "review", "qa"],
          pending_decision: {
            action: "diagnose",
            reason: "Skill-agent operator decision is required before continuation.",
            next_step: "delivery",
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const makeStep = (step, sequence, status = "accepted") => {
      const planRef = path.join(reportsRoot, `${sequence}-${step}-plan.json`);
      const executionRef = path.join(reportsRoot, `${sequence}-${step}-execution.json`);
      const inspectionRef = path.join(reportsRoot, `${sequence}-${step}-inspection.json`);
      const classificationRef = path.join(reportsRoot, `${sequence}-${step}-classification.json`);
      const requestRef = path.join(reportsRoot, `${sequence}-${step}-request.json`);
      const decisionRef = path.join(reportsRoot, `${sequence}-${step}-decision.json`);
      for (const file of [planRef, executionRef, inspectionRef, classificationRef, requestRef, decisionRef]) {
        fs.writeFileSync(file, "{}\n", "utf8");
      }
      return {
        sequence,
        step_id: step,
        step_instance_id: step,
        iteration: 1,
        flow_stage: step,
        plan: {
          objective: `Observe ${step}.`,
          public_surface: `aor ${step}`,
          command_labels: [step],
          expected_artifacts: [genericEvidence],
          inspection_sources: ["command_transcript"],
          safety_constraints: ["black-box-public-surfaces-only"],
        },
        plan_ref: planRef,
        public_surface: `aor ${step}`,
        execution_ref: executionRef,
        inspection_ref: inspectionRef,
        classification_ref: classificationRef,
        artifact_refs: [genericEvidence],
        started_at: "2026-06-09T00:00:00.000Z",
        finished_at: "2026-06-09T00:00:01.000Z",
        duration_sec: 1,
        deterministic_analysis: {
          status: status === "accepted" ? "pass" : "blocked",
          exit_code: 0,
          failure_class: null,
          missing_evidence: [],
          recommendation: status === "accepted" ? "continue" : "diagnose",
        },
        semantic_analysis: {
          status: status === "accepted" ? "pass" : "blocked",
          judge_source: status === "accepted" ? "skill-agent" : null,
          findings: status === "accepted" ? [] : ["Skill-agent operator decision is required before continuation."],
        },
        agent_decision_request_ref: requestRef,
        operator_decision_ref: status === "accepted" ? decisionRef : null,
        operator_decision_status: status,
        inspected_evidence_refs: status === "accepted" ? [requestRef, executionRef, inspectionRef, classificationRef] : [],
        requested_interaction: null,
        decision: {
          action: status === "accepted" ? "continue" : "diagnose",
          reason:
            status === "accepted"
              ? "Public step completed with required evidence."
              : "Skill-agent operator decision is required before continuation.",
          next_step: status === "accepted" ? null : "delivery",
        },
        resume_result: null,
        frontend_interaction_refs: [],
        final_step_verdict: status === "accepted" ? "pass" : "blocked",
      };
    };

    const stepEntries = ["discovery", "spec", "planning", "handoff", "execution", "review"].map((step, index) =>
      makeStep(step, index + 1),
    );
    stepEntries.push(makeStep("qa", 7, "missing"));

    const written = writeProofRunnerArtifacts({
      hostRoot: repoRoot,
      hostProjectId: "aor-test",
      layout: { reportsRoot, runtimeRoot },
      runId,
      profilePath: path.join(tempRoot, "profile.yaml"),
      profile: {
        profile_id: "live-e2e.test.partial-guided-proof-blocked",
        journey_mode: "full-journey",
        target_catalog_id: "ky",
        feature_mission_id: "ky-release-doc-typing",
        scenario_family: "release",
        provider_variant_id: "openai-primary",
        live_e2e: {
          flow_range_policy: "delivery_default",
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
            stage: "qa",
            status: "fail",
            evidence_refs: [genericEvidence],
            summary: "Guided AOR operator UI proof was missing.",
          },
        ],
        commandResults: [],
        artifacts: {
          host_runtime_root: runtimeRoot,
          host_reports_root: reportsRoot,
          live_e2e_controller_state_file: controllerState,
          live_e2e_step_journal_entries: stepEntries,
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
          aor_installation_proof_file: installProof,
          target_checkout_root: targetCheckoutRoot,
          generated_project_profile_file: generatedProject,
          feature_request_file: featureRequest,
          baseline_verify_summary_file: baselineVerify,
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

    const observationReport = JSON.parse(fs.readFileSync(written.summary.live_e2e_observation_report_file, "utf8"));
    assert.equal(observationReport.report_status, "in_progress");
    assert.equal(written.summary.status, "blocked");
    assert.equal(written.summary.live_e2e_run_health_overall_status, "blocked");
    assert.equal(written.runHealthReport.overall_status, "blocked");
    assert.equal(written.runHealthReport.controller_health.missing_operator_decision_steps.includes("qa"), true);
    assert.equal(written.runHealthReport.failure_summary.owner, "operator");

    const terminalControllerState = path.join(reportsRoot, "controller-state-terminal.json");
    fs.writeFileSync(
      terminalControllerState,
      `${JSON.stringify(
        {
          current_step: null,
          completed_steps: ["discovery", "spec", "planning", "handoff", "execution", "review", "qa", "delivery"],
          pending_decision: {
            action: "continue",
            reason: "Skill-agent accepted public evidence and required inspection refs.",
            next_step: null,
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    const terminalEntries = ["discovery", "spec", "planning", "handoff", "execution", "review", "qa", "delivery"].map(
      (step, index) => makeStep(step, index + 1),
    );
    const terminalDeliveryManifest = path.join(reportsRoot, "delivery-manifest.json");
    fs.writeFileSync(terminalDeliveryManifest, "{}\n", "utf8");
    const terminalWritten = writeProofRunnerArtifacts({
      hostRoot: repoRoot,
      hostProjectId: "aor-test",
      layout: { reportsRoot, runtimeRoot },
      runId: `${runId}-terminal`,
      profilePath: path.join(tempRoot, "profile.yaml"),
      profile: {
        profile_id: "live-e2e.test.partial-guided-proof-terminal",
        journey_mode: "full-journey",
        target_catalog_id: "ky",
        feature_mission_id: "ky-release-doc-typing",
        scenario_family: "release",
        provider_variant_id: "openai-primary",
        live_e2e: {
          flow_range_policy: "delivery_default",
          operator_mode: "skill-agent",
          agent_decision_policy: "required",
          interaction_answer_policy: "agent-required",
          target_write_policy: "aor-runtime-only-before-execution",
        },
      },
      flowResult: {
        startedAt: "2026-06-09T00:00:00.000Z",
        finishedAt: "2026-06-09T00:00:03.000Z",
        status: "pass",
        stageResults: [
          {
            stage: "delivery",
            status: "pass",
            evidence_refs: [terminalDeliveryManifest],
            summary: "Delivery completed.",
          },
        ],
        commandResults: [],
        artifacts: {
          host_runtime_root: runtimeRoot,
          host_reports_root: reportsRoot,
          live_e2e_controller_state_file: terminalControllerState,
          live_e2e_step_journal_entries: terminalEntries,
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
          aor_installation_proof_file: installProof,
          target_checkout_root: targetCheckoutRoot,
          generated_project_profile_file: generatedProject,
          feature_request_file: featureRequest,
          baseline_verify_summary_file: baselineVerify,
          baseline_verify_status: "pass",
          delivery_manifest_file: terminalDeliveryManifest,
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
    const terminalObservationReport = JSON.parse(
      fs.readFileSync(terminalWritten.summary.live_e2e_observation_report_file, "utf8"),
    );
    assert.equal(terminalObservationReport.report_status, "final");
    assert.equal(terminalWritten.summary.status, "pass");
    assert.equal(terminalWritten.runHealthReport.overall_status, "pass");
  });
});

test("proof runner classifies context-budget provider blockers as run-health blocked", () => {
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
        "execution-plan.json",
        "execution-step-result.json",
        "execution-inspection.json",
        "execution-classification.json",
        "execution-agent-request.json",
        "execution-decision.json",
        "adapter-request.json",
        "provider-work-packet.json",
        "adapter-raw-evidence.json",
      ].map((name) => [name, path.join(reportsRoot, name)]),
    );
    for (const file of Object.values(files)) {
      fs.writeFileSync(file, "{}\n", "utf8");
    }

    const runId = "context-budget-blocked-run-health";
    const stepJournalEntry = {
      sequence: 1,
      step_id: "execution",
      step_instance_id: "execution",
      iteration: 1,
      flow_stage: "execution",
      plan: {
        objective: "Observe routed live execution.",
        public_surface: "aor run start",
        command_labels: ["run-start"],
        expected_artifacts: ["routed_step_result_file"],
        inspection_sources: ["adapter_raw_evidence"],
        safety_constraints: ["no-upstream-write"],
      },
      plan_ref: files["execution-plan.json"],
      public_surface: "aor run start",
      execution_ref: files["execution-step-result.json"],
      inspection_ref: files["execution-inspection.json"],
      classification_ref: files["execution-classification.json"],
      artifact_refs: [files["adapter-request.json"], files["provider-work-packet.json"], files["adapter-raw-evidence.json"]],
      started_at: "2026-06-09T00:00:00.000Z",
      finished_at: "2026-06-09T00:00:01.000Z",
      duration_sec: 1,
      deterministic_analysis: {
        status: "blocked",
        exit_code: null,
        failure_class: "compiled_context_budget_exceeded",
        missing_evidence: [],
        recommendation: "block",
      },
      semantic_analysis: {
        status: "blocked",
        judge_source: "skill-agent",
        findings: ["Provider work packet exceeded the configured context budget before provider invocation."],
      },
      agent_decision_request_ref: files["execution-agent-request.json"],
      operator_decision_ref: files["execution-decision.json"],
      operator_decision_status: "accepted",
      inspected_evidence_refs: [files["adapter-raw-evidence.json"]],
      requested_interaction: null,
      decision: {
        action: "block",
        reason: "Context budget exceeded.",
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
        profile_id: "live-e2e.test.context-budget-blocked",
        journey_mode: "full-journey",
        target_catalog_id: "ky",
        feature_mission_id: "ky-release-doc-typing",
        scenario_family: "release",
        provider_variant_id: "anthropic-primary",
        stages: ["bootstrap", "execution"],
        live_e2e: {
          flow_range_policy: "delivery_default",
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
            stage: "execution",
            status: "fail",
            evidence_refs: [files["adapter-raw-evidence.json"]],
            summary: "Provider work packet exceeded the configured context budget.",
          },
        ],
        commandResults: [],
        artifacts: {
          host_runtime_root: runtimeRoot,
          host_reports_root: reportsRoot,
          live_e2e_controller_state_file: files["controller-state.json"],
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
          failure_owner: "aor",
          failure_phase: "provider_execution",
          failure_class: "compiled_context_budget_exceeded",
          provider_execution_status: "blocked",
          adapter_raw_evidence_ref: files["adapter-raw-evidence.json"],
          request_artifact_ref: files["adapter-request.json"],
          provider_work_packet_ref: files["provider-work-packet.json"],
          context_budget_status: "fail",
          context_budget_failure_class: "compiled_context_budget_exceeded",
          top_context_size_sources: [
            {
              source: "provider_work_packet.context",
              bytes: 4096,
              chars: 4096,
              estimated_tokens: 1366,
            },
          ],
          feature_mission_id: "ky-release-doc-typing",
          feature_size: "large",
        },
      },
      aorLaunch: {
        command: process.execPath,
        argsPrefix: [],
        binaryRef: runProfileScript,
      },
    });

    assert.equal(written.summary.live_e2e_run_health_overall_status, "blocked");
    assert.equal(written.runHealthReport.overall_status, "blocked");
    assert.equal(written.runHealthReport.provider_health.status, "blocked");
    assert.equal(written.runHealthReport.provider_health.context_budget_status, "fail");
    assert.equal(written.runHealthReport.provider_health.context_budget_failure_class, "compiled_context_budget_exceeded");
    assert.equal(written.runHealthReport.failure_summary.owner, "aor");
    assert.equal(written.runHealthReport.failure_summary.phase, "provider_execution");
    assert.equal(written.runHealthReport.failure_summary.class, "compiled_context_budget_exceeded");
  });
});

test("proof runner propagates provider work-packet non-execution into run-health", () => {
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
        "execution-plan.json",
        "execution-step-result.json",
        "execution-inspection.json",
        "execution-classification.json",
        "execution-agent-request.json",
        "execution-decision.json",
        "execution-transcript.json",
        "adapter-request.json",
        "provider-work-packet.json",
        "adapter-raw-evidence.json",
      ].map((name) => [name, path.join(reportsRoot, name)]),
    );
    for (const file of Object.values(files)) {
      fs.writeFileSync(file, "{}\n", "utf8");
    }

    const runId = "provider-work-packet-not-executed-run-health";
    const stepJournalEntry = {
      sequence: 1,
      step_id: "execution",
      step_instance_id: "execution",
      iteration: 1,
      flow_stage: "execution",
      plan: {
        objective: "Observe routed live execution.",
        public_surface: "aor run start",
        command_labels: ["run-start"],
        expected_artifacts: ["routed_step_result_file"],
        inspection_sources: ["adapter_raw_evidence"],
        safety_constraints: ["no-upstream-write"],
      },
      plan_ref: files["execution-plan.json"],
      public_surface: "aor run start",
      transcript_ref: files["execution-transcript.json"],
      execution_ref: files["execution-step-result.json"],
      inspection_ref: files["execution-inspection.json"],
      classification_ref: files["execution-classification.json"],
      artifact_refs: [files["adapter-request.json"], files["provider-work-packet.json"], files["adapter-raw-evidence.json"]],
      started_at: "2026-06-09T00:00:00.000Z",
      finished_at: "2026-06-09T00:00:01.000Z",
      duration_sec: 1,
      deterministic_analysis: {
        status: "fail",
        exit_code: 0,
        failure_class: "provider_work_packet_not_executed",
        missing_evidence: [],
        recommendation: "block",
      },
      semantic_analysis: {
        status: "fail",
        judge_source: "skill-agent",
        findings: ["Provider returned a work-packet summary instead of changing the target checkout."],
      },
      agent_decision_request_ref: files["execution-agent-request.json"],
      operator_decision_ref: files["execution-decision.json"],
      operator_decision_status: "accepted",
      inspected_evidence_refs: [files["adapter-raw-evidence.json"]],
      requested_interaction: null,
      decision: {
        action: "block",
        reason: "Provider did not execute the work packet.",
      },
      resume_result: null,
      frontend_interaction_refs: [],
      final_step_verdict: "fail",
    };

    const written = writeProofRunnerArtifacts({
      hostRoot: repoRoot,
      hostProjectId: "aor-test",
      layout: { reportsRoot, runtimeRoot },
      runId,
      profilePath: path.join(tempRoot, "profile.yaml"),
      profile: {
        profile_id: "live-e2e.test.provider-work-packet-not-executed",
        journey_mode: "full-journey",
        target_catalog_id: "ky",
        feature_mission_id: "ky-release-doc-typing",
        scenario_family: "governance",
        provider_variant_id: "anthropic-primary",
        stages: ["bootstrap", "execution"],
        live_e2e: {
          flow_range_policy: "delivery_default",
          operator_mode: "skill-agent",
          agent_decision_policy: "required",
          interaction_answer_policy: "agent-required",
          target_write_policy: "aor-runtime-only-before-execution",
        },
      },
      flowResult: {
        startedAt: "2026-06-09T00:00:00.000Z",
        finishedAt: "2026-06-09T00:00:02.000Z",
        status: "failed",
        stageResults: [
          {
            stage: "execution",
            status: "fail",
            evidence_refs: [files["adapter-raw-evidence.json"], files["provider-work-packet.json"]],
            summary: "Provider summarized the work packet instead of executing implementation.",
          },
        ],
        commandResults: [],
        artifacts: {
          host_runtime_root: runtimeRoot,
          host_reports_root: reportsRoot,
          live_e2e_controller_state_file: files["controller-state.json"],
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
          failure_owner: "provider",
          failure_phase: "provider_execution",
          failure_class: "provider_work_packet_not_executed",
          provider_execution_status: "completed",
          adapter_raw_evidence_ref: files["adapter-raw-evidence.json"],
          request_artifact_ref: files["adapter-request.json"],
          provider_work_packet_ref: files["provider-work-packet.json"],
          context_budget_status: "pass",
          top_context_size_sources: [
            {
              source: "provider_work_packet.resolved_local_refs",
              bytes: 1024,
              chars: 1024,
              estimated_tokens: 341,
            },
          ],
          feature_mission_id: "ky-retry-hooks-governance",
          feature_size: "large",
        },
      },
      aorLaunch: {
        command: process.execPath,
        argsPrefix: [],
        binaryRef: runProfileScript,
      },
    });

    assert.equal(written.runHealthReport.overall_status, "fail");
    assert.equal(written.runHealthReport.failure_summary.owner, "provider");
    assert.equal(written.runHealthReport.failure_summary.phase, "provider_execution");
    assert.equal(written.runHealthReport.failure_summary.class, "provider_work_packet_not_executed");
    assert.equal(written.runHealthReport.command_health.command_count, 1);
    assert.equal(written.runHealthReport.command_health.failed_command_count, 1);
    assert.equal(written.runHealthReport.provider_health.top_context_size_sources[0].source, "provider_work_packet.resolved_local_refs");
  });
});

test("proof runner writes run-health reports for failed live E2E reports", () => {
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
        "discovery-decision.json",
        "discovery-transcript.json",
      ].map((name) => [name, path.join(reportsRoot, name)]),
    );
    for (const file of Object.values(files)) {
      fs.writeFileSync(file, "{}\n", "utf8");
    }

    const runId = "failed-command-run-health";
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
        status: "not_pass",
        exit_code: 1,
        failure_class: "command_failed",
        missing_evidence: [],
        recommendation: "diagnose",
      },
      semantic_analysis: {
        status: "not_pass",
        judge_source: "skill-agent",
        findings: ["Discovery command failed before artifact quality could be assessed."],
      },
      agent_decision_request_ref: files["discovery-agent-request.json"],
      operator_decision_ref: files["discovery-decision.json"],
      operator_decision_status: "accepted",
      inspected_evidence_refs: [files["discovery-transcript.json"]],
      requested_interaction: null,
      decision: {
        action: "diagnose",
        reason: "Public command failed.",
      },
      resume_result: null,
      frontend_interaction_refs: [],
      final_step_verdict: "not_pass",
    };

    const written = writeProofRunnerArtifacts({
      hostRoot: repoRoot,
      hostProjectId: "aor-test",
      layout: { reportsRoot, runtimeRoot },
      runId,
      profilePath: path.join(tempRoot, "profile.yaml"),
      profile: {
        profile_id: "live-e2e.test.failed-command-run-health",
        journey_mode: "full-journey",
        target_catalog_id: "ky",
        feature_mission_id: "ky-release-doc-typing",
        scenario_family: "release",
        provider_variant_id: "openai-primary",
        stages: ["bootstrap", "discovery"],
        live_e2e: {
          flow_range_policy: "delivery_default",
          operator_mode: "skill-agent",
          agent_decision_policy: "required",
          interaction_answer_policy: "agent-required",
          target_write_policy: "aor-runtime-only-before-execution",
        },
      },
      flowResult: {
        startedAt: "2026-06-09T00:00:00.000Z",
        finishedAt: "2026-06-09T00:00:02.000Z",
        status: "fail",
        stageResults: [
          {
            stage: "discovery",
            status: "fail",
            evidence_refs: [files["discovery-transcript.json"]],
            summary: "Discovery command failed.",
          },
        ],
        commandResults: [
          {
            label: "discovery-run",
            command_surface: "aor discovery run",
            status: "fail",
            exit_code: 1,
            transcript_file: files["discovery-transcript.json"],
            artifact_refs: [files["discovery-transcript.json"]],
            summary: "Discovery command failed with exit code 1.",
          },
        ],
        artifacts: {
          host_runtime_root: runtimeRoot,
          host_reports_root: reportsRoot,
          live_e2e_controller_state_file: files["controller-state.json"],
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

    assert.equal(written.summary.status, "not_pass");
    assert.equal(written.summary.live_e2e_run_health_overall_status, "fail");
    assert.equal(written.runHealthReport.overall_status, "fail");
    assert.equal(written.runHealthReport.failure_summary.owner, "aor");
    assert.equal(written.runHealthReport.failure_summary.phase, "unknown");
    assert.equal(written.runHealthReport.failure_summary.class, "public_command_failed");
    assert.equal(written.runHealthReport.command_health.failed_command_count, 1);
    assert.equal(written.summary.quality_judgement, undefined);
  });
});

test("proof runner run-health prioritizes post-run target verification failure over public command aggregation", () => {
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
        "execution-transcript.json",
        "post-run-verify-summary.json",
      ].map((name) => [name, path.join(reportsRoot, name)]),
    );
    const deliverySteps = ["discovery", "spec", "planning", "handoff", "execution", "review", "qa", "delivery"];
    for (const step of deliverySteps) {
      for (const field of ["plan", "execution", "inspection", "classification", "agent-request", "decision", "transcript"]) {
        files[`${step}-${field}.json`] = path.join(reportsRoot, `${step}-${field}.json`);
      }
    }
    for (const file of Object.values(files)) {
      fs.writeFileSync(file, "{}\n", "utf8");
    }

    const runId = "post-run-target-verification-failed-run-health";
    const stepJournal = deliverySteps.map((step, index) => {
      const executionStep = step === "execution";
      return {
        sequence: index + 1,
        step_id: step,
        step_instance_id: step,
        iteration: 1,
        flow_stage: step,
        plan: {
          objective: `Observe ${step}.`,
          public_surface: executionStep ? "aor run start" : `aor ${step} run`,
          command_labels: executionStep ? ["run-start", "project-verify-post-run-primary"] : [`${step}-run`],
          expected_artifacts: [],
          inspection_sources: ["command_transcript"],
          safety_constraints: ["no-upstream-write"],
        },
        plan_ref: files[`${step}-plan.json`],
        public_surface: executionStep ? "aor run start" : `aor ${step} run`,
        transcript_ref: executionStep ? files["execution-transcript.json"] : files[`${step}-transcript.json`],
        execution_ref: files[`${step}-execution.json`],
        inspection_ref: files[`${step}-inspection.json`],
        classification_ref: files[`${step}-classification.json`],
        artifact_refs: executionStep
          ? [files["execution-transcript.json"], files["post-run-verify-summary.json"]]
          : [files[`${step}-transcript.json`]],
        started_at: "2026-06-09T00:00:00.000Z",
        finished_at: "2026-06-09T00:00:01.000Z",
        duration_sec: 1,
        deterministic_analysis: {
          status: executionStep ? "not_pass" : "pass",
          exit_code: 0,
          failure_class: executionStep ? "post_run_verification_failed" : null,
          missing_evidence: [],
          recommendation: executionStep ? "diagnose" : "continue",
        },
        semantic_analysis: {
          status: executionStep ? "blocked" : "pass",
          judge_source: "skill-agent",
          findings: executionStep ? ["Post-run target verification failed after provider execution."] : [],
        },
        agent_decision_request_ref: files[`${step}-agent-request.json`],
        operator_decision_ref: files[`${step}-decision.json`],
        operator_decision_status: "accepted",
        inspected_evidence_refs: executionStep
          ? [files["execution-transcript.json"], files["post-run-verify-summary.json"]]
          : [files[`${step}-transcript.json`]],
        requested_interaction: null,
        decision: {
          action: executionStep ? "block" : "continue",
          reason: executionStep ? "Post-run target verification failed." : "Step evidence accepted.",
        },
        resume_result: null,
        frontend_interaction_refs: [],
        final_step_verdict: executionStep ? "blocked" : "pass",
      };
    });

    const written = writeProofRunnerArtifacts({
      hostRoot: repoRoot,
      hostProjectId: "aor-test",
      layout: { reportsRoot, runtimeRoot },
      runId,
      profilePath: path.join(tempRoot, "profile.yaml"),
      profile: {
        profile_id: "live-e2e.test.post-run-target-verification-failed",
        journey_mode: "full-journey",
        target_catalog_id: "ky",
        feature_mission_id: "ky-release-doc-typing",
        scenario_family: "release",
        provider_variant_id: "openai-primary",
        stages: ["bootstrap", "discovery", "spec", "planning", "handoff", "execution", "review", "qa", "delivery"],
        live_e2e: {
          flow_range_policy: "delivery_default",
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
            stage: "execution",
            status: "fail",
            evidence_refs: [files["execution-transcript.json"], files["post-run-verify-summary.json"]],
            summary: "Execution produced target changes, but post-run verification failed.",
          },
        ],
        commandResults: [
          {
            label: "run-start",
            command_surface: "aor run start",
            status: "fail",
            exit_code: 0,
            transcript_file: files["execution-transcript.json"],
            artifact_refs: [files["execution-transcript.json"], files["post-run-verify-summary.json"]],
            summary: "execution",
          },
        ],
        artifacts: {
          host_runtime_root: runtimeRoot,
          host_reports_root: reportsRoot,
          live_e2e_controller_state_file: files["controller-state.json"],
          live_e2e_step_journal_entries: stepJournal,
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
          target_setup_status: { status: "pass" },
          target_verification_status_detail: { status: "pass" },
          post_run_verify_status: "fail",
          post_run_verify_summary_file: files["post-run-verify-summary.json"],
          provider_execution_status: "completed",
          provider_step_status: { provider: "openai", adapter: "codex-cli", status: "completed" },
          feature_mission_id: "ky-release-doc-typing",
          feature_size: "large",
        },
      },
      aorLaunch: {
        command: process.execPath,
        argsPrefix: [],
        binaryRef: runProfileScript,
      },
    });

    assert.equal(written.runHealthReport.overall_status, "blocked");
    assert.equal(written.runHealthReport.target_environment_health.status, "fail");
    assert.equal(written.runHealthReport.target_environment_health.target_verification_status, "fail");
    assert.equal(written.runHealthReport.failure_summary.owner, "target_repository");
    assert.equal(written.runHealthReport.failure_summary.phase, "target_verification");
    assert.equal(written.runHealthReport.failure_summary.class, "target_verification_failed");
    assert.equal(written.runHealthReport.command_health.failed_command_count, 1);
  });
});

test("proof runner preserves environment owner from target setup status in run-health", () => {
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
      ].map((name) => [name, path.join(reportsRoot, name)]),
    );
    const deliverySteps = ["discovery", "spec", "planning", "handoff", "execution", "review", "qa", "delivery"];
    for (const step of deliverySteps) {
      for (const field of ["plan", "execution", "inspection", "classification", "agent-request", "decision", "transcript"]) {
        files[`${step}-${field}.json`] = path.join(reportsRoot, `${step}-${field}.json`);
      }
    }
    for (const file of Object.values(files)) {
      fs.writeFileSync(file, "{}\n", "utf8");
    }

    const stepJournal = deliverySteps.map((step, index) => ({
      sequence: index + 1,
      step_id: step,
      step_instance_id: step,
      iteration: 1,
      flow_stage: step,
      plan: {
        objective: `Observe ${step}.`,
        public_surface: `aor ${step} run`,
        command_labels: [`${step}-run`],
        expected_artifacts: [],
        inspection_sources: ["command_transcript"],
        safety_constraints: ["no-upstream-write"],
      },
      plan_ref: files[`${step}-plan.json`],
      public_surface: `aor ${step} run`,
      transcript_ref: files[`${step}-transcript.json`],
      execution_ref: files[`${step}-execution.json`],
      inspection_ref: files[`${step}-inspection.json`],
      classification_ref: files[`${step}-classification.json`],
      artifact_refs: [files[`${step}-transcript.json`]],
      started_at: "2026-06-09T00:00:00.000Z",
      finished_at: "2026-06-09T00:00:01.000Z",
      duration_sec: 1,
      deterministic_analysis: {
        status: step === "execution" ? "not_pass" : "pass",
        exit_code: step === "execution" ? 1 : 0,
        failure_class: step === "execution" ? "target_setup_blocked" : null,
        missing_evidence: [],
        recommendation: step === "execution" ? "diagnose" : "continue",
      },
      semantic_analysis: {
        status: step === "execution" ? "blocked" : "pass",
        judge_source: "skill-agent",
        findings: step === "execution" ? ["Target setup failed before provider execution."] : [],
      },
      agent_decision_request_ref: files[`${step}-agent-request.json`],
      operator_decision_ref: files[`${step}-decision.json`],
      operator_decision_status: "accepted",
      inspected_evidence_refs: [files[`${step}-transcript.json`]],
      requested_interaction: null,
      decision: {
        action: step === "execution" ? "block" : "continue",
        reason: step === "execution" ? "Target setup failed before provider execution." : "Step evidence accepted.",
      },
      resume_result: null,
      frontend_interaction_refs: [],
      final_step_verdict: step === "execution" ? "blocked" : "pass",
    }));

    const written = writeProofRunnerArtifacts({
      hostRoot: repoRoot,
      hostProjectId: "aor-test",
      layout: { reportsRoot, runtimeRoot },
      runId: "environment-target-setup-run-health",
      profilePath: path.join(tempRoot, "profile.yaml"),
      profile: {
        profile_id: "live-e2e.test.environment-target-setup",
        journey_mode: "full-journey",
        target_catalog_id: "nextjs",
        feature_mission_id: "nextjs-typeguard-regression",
        scenario_family: "regress",
        provider_variant_id: "openai-primary",
        stages: ["bootstrap", "discovery", "spec", "planning", "handoff", "execution", "review", "qa", "delivery"],
        live_e2e: {
          flow_range_policy: "delivery_default",
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
            stage: "execution",
            status: "fail",
            evidence_refs: [files["baseline-verify-summary.json"]],
            summary: "Target setup failed before provider execution.",
          },
        ],
        commandResults: [],
        artifacts: {
          host_runtime_root: runtimeRoot,
          host_reports_root: reportsRoot,
          live_e2e_controller_state_file: files["controller-state.json"],
          live_e2e_step_journal_entries: stepJournal,
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
          baseline_verify_status: "fail",
          target_setup_status: {
            status: "blocked",
            failure_owner: "environment",
            failure_phase: "target_setup",
            failure_class: "environment_disk_space_exhausted",
          },
          target_verification_status_detail: {
            status: "not_attempted",
            failure_owner: "environment",
            failure_phase: "target_setup",
            failure_class: "environment_disk_space_exhausted",
          },
          feature_mission_id: "nextjs-typeguard-regression",
          feature_size: "large",
        },
      },
      aorLaunch: {
        command: process.execPath,
        argsPrefix: [],
        binaryRef: runProfileScript,
      },
    });

    assert.equal(written.runHealthReport.overall_status, "blocked");
    assert.equal(written.runHealthReport.target_environment_health.status, "blocked");
    assert.equal(written.runHealthReport.target_environment_health.failure_owner, "environment");
    assert.equal(written.runHealthReport.target_environment_health.failure_class, "environment_disk_space_exhausted");
    assert.equal(written.runHealthReport.failure_summary.owner, "environment");
    assert.equal(written.runHealthReport.failure_summary.phase, "target_setup");
    assert.equal(written.runHealthReport.failure_summary.class, "environment_disk_space_exhausted");
  });
});

test("proof runner run-health classifies failed live adapter preflight readiness", () => {
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
        "live-adapter-preflight.json",
      ].map((name) => [name, path.join(reportsRoot, name)]),
    );
    for (const file of Object.values(files)) {
      fs.writeFileSync(file, "{}\n", "utf8");
    }

    const runId = "failed-adapter-preflight-run-health";
    const written = writeProofRunnerArtifacts({
      hostRoot: repoRoot,
      hostProjectId: "aor-test",
      layout: { reportsRoot, runtimeRoot },
      runId,
      profilePath: path.join(tempRoot, "profile.yaml"),
      profile: {
        profile_id: "live-e2e.test.failed-adapter-preflight-run-health",
        journey_mode: "full-journey",
        target_catalog_id: "ky",
        feature_mission_id: "ky-release-doc-typing",
        scenario_family: "release",
        provider_variant_id: "anthropic-primary",
        stages: ["bootstrap", "discovery"],
        live_e2e: {
          flow_range_policy: "delivery_default",
          operator_mode: "skill-agent",
          agent_decision_policy: "required",
          interaction_answer_policy: "agent-required",
          target_write_policy: "aor-runtime-only-before-execution",
        },
      },
      flowResult: {
        startedAt: "2026-06-09T00:00:00.000Z",
        finishedAt: "2026-06-09T00:00:02.000Z",
        status: "fail",
        stageResults: [
          {
            stage: "bootstrap",
            status: "fail",
            evidence_refs: [files["live-adapter-preflight.json"]],
            summary: "Live adapter preflight failed permission-readiness for adapter 'claude-code' before run start.",
          },
        ],
        commandResults: [],
        artifacts: {
          host_runtime_root: runtimeRoot,
          host_reports_root: reportsRoot,
          live_e2e_controller_state_file: files["controller-state.json"],
          live_e2e_step_journal_entries: [],
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
          live_adapter_preflight_file: files["live-adapter-preflight.json"],
          live_adapter_preflight: {
            status: "fail",
            provider_variant_id: "anthropic-primary",
            primary_adapter: "claude-code",
            failure_kind: "permission-mode-blocked",
            summary: "Live adapter preflight failed permission-readiness for adapter 'claude-code' before run start.",
          },
        },
      },
      aorLaunch: {
        command: process.execPath,
        argsPrefix: [],
        binaryRef: runProfileScript,
      },
    });

    assert.equal(written.summary.status, "not_pass");
    assert.equal(written.summary.live_e2e_run_health_overall_status, "fail");
    assert.equal(written.runHealthReport.overall_status, "fail");
    assert.equal(written.runHealthReport.failure_summary.owner, "provider");
    assert.equal(written.runHealthReport.failure_summary.phase, "readiness");
    assert.equal(written.runHealthReport.failure_summary.class, "permission-mode-blocked");
    assert.match(written.runHealthReport.failure_summary.summary, /permission-readiness/u);
    assert.equal(written.summary.quality_judgement, undefined);
  });
});

test("proof runner does not consume final skill-agent verdicts or emit result-quality summaries", () => {
  withTempRoot((tempRoot) => {
    const reportsRoot = path.join(tempRoot, "reports");
    const runtimeRoot = path.join(tempRoot, "runtime");
    const targetCheckoutRoot = path.join(tempRoot, "target");
    fs.mkdirSync(reportsRoot, { recursive: true });
    fs.mkdirSync(runtimeRoot, { recursive: true });
    fs.mkdirSync(targetCheckoutRoot, { recursive: true });

    const runId = "no-final-verdict-consumption";
    const includedSteps = ["discovery", "spec", "planning", "handoff", "execution", "review", "qa", "delivery"];
    const files = Object.fromEntries(
      [
        "controller-state.json",
        "install-proof.json",
        "delivery-artifact.json",
        "delivery-manifest.json",
        "review-report.json",
        "evaluation-report.json",
        ...includedSteps.map((step) => `${step}-artifact.json`),
      ].map((name) => [name, path.join(reportsRoot, name)]),
    );
    for (const file of Object.values(files)) {
      fs.writeFileSync(file, "{}\n", "utf8");
    }

    const stepJournal = includedSteps.map((step, index) => ({
      sequence: index + 1,
      step_id: step,
      step_instance_id: step,
      iteration: 1,
      flow_stage: step,
      plan: {
        objective: `Observe ${step}.`,
        public_surface: `aor ${step}`,
        command_labels: [`${step}-run`],
        expected_artifacts: [],
        inspection_sources: ["command_transcript"],
        safety_constraints: ["no-upstream-write"],
      },
      plan_ref: files[`${step}-artifact.json`],
      public_surface: `aor ${step}`,
      transcript_ref: files[`${step}-artifact.json`],
      execution_ref: files[`${step}-artifact.json`],
      inspection_ref: files[`${step}-artifact.json`],
      classification_ref: files[`${step}-artifact.json`],
      artifact_refs: [files[`${step}-artifact.json`]],
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
        findings: [],
      },
      agent_decision_request_ref: files[`${step}-artifact.json`],
      operator_decision_ref: files[`${step}-artifact.json`],
      operator_decision_status: "accepted",
      inspected_evidence_refs: [files[`${step}-artifact.json`]],
      requested_interaction: null,
      decision: {
        action: "continue",
        reason: "Accepted test evidence.",
      },
      resume_result: null,
      frontend_interaction_refs: [],
      final_step_verdict: "pass",
    }));

    const written = writeProofRunnerArtifacts({
      hostRoot: repoRoot,
      hostProjectId: "aor-test",
      layout: { reportsRoot, runtimeRoot },
      runId,
      profilePath: path.join(tempRoot, "profile.yaml"),
      profile: {
        profile_id: "live-e2e.test.final-verdict-not-pass",
        journey_mode: "full-journey",
        target_catalog_id: "ky",
        feature_mission_id: "ky-retry-hooks-governance",
        scenario_family: "governance",
        provider_variant_id: "anthropic-primary",
        stages: includedSteps,
        live_e2e: {
          flow_range_policy: "delivery_default",
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
        stageResults: includedSteps.map((step) => ({
          stage: step,
          status: "pass",
          evidence_refs: [files[`${step}-artifact.json`]],
          summary: `${step} passed.`,
        })),
        commandResults: [
          {
            label: "deliver-prepare",
            command_surface: "aor deliver prepare",
            status: "pass",
            exit_code: 0,
            transcript_file: files["delivery-artifact.json"],
            artifact_refs: [files["delivery-artifact.json"]],
          },
        ],
        artifacts: {
          host_runtime_root: runtimeRoot,
          host_reports_root: reportsRoot,
          live_e2e_controller_state_file: files["controller-state.json"],
          live_e2e_step_journal_entries: stepJournal,
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
          feature_mission_id: "ky-retry-hooks-governance",
          feature_size: "large",
          matrix_cell: {
            cell_id: "ky.governance.large.anthropic",
          },
          post_run_verify_status: "pass",
          provider_execution_status: "pass",
          real_code_change_status: "pass",
          runtime_harness_decision: "pass",
          run_start_runtime_harness_decision: "pass",
          latest_runtime_harness_decision: "pass",
          delivery_manifest_file: files["delivery-manifest.json"],
          review_report_file: files["review-report.json"],
          evaluation_report_file: files["evaluation-report.json"],
        },
      },
      aorLaunch: {
        command: process.execPath,
        argsPrefix: [],
        binaryRef: runProfileScript,
      },
    });

    assert.equal(written.summary.status, "pass");
    assert.equal(written.summary.live_e2e_run_health_overall_status, "pass");
    assert.equal(written.summary.acceptance_status, undefined);
    assert.equal(written.summary.runner_quality_summary, undefined);
    assert.equal(written.summary.quality_judgement, undefined);
    assert.equal(written.summary.final_skill_agent_verdict_file, undefined);
    assert.equal(written.runHealthReport.overall_status, "pass");
    assert.equal(written.runHealthReport.failure_summary.owner, null);
  });
});

test("proof runner run-health uses hydrated delivery and verification facts", () => {
  withTempRoot((tempRoot) => {
    const reportsRoot = path.join(tempRoot, "reports");
    const runtimeRoot = path.join(tempRoot, "runtime");
    const targetCheckoutRoot = path.join(tempRoot, "target");
    fs.mkdirSync(reportsRoot, { recursive: true });
    fs.mkdirSync(runtimeRoot, { recursive: true });
    fs.mkdirSync(targetCheckoutRoot, { recursive: true });

    const runId = "run-health-hydrated";
    const includedSteps = ["discovery", "spec", "planning", "handoff", "execution", "review", "qa", "delivery"];
    const files = Object.fromEntries(
      [
        "controller-state.json",
        "install-proof.json",
        "generated-project.aor.yaml",
        "feature-request.json",
        "baseline-verify-summary.json",
        "delivery-artifact.json",
        "delivery-manifest.json",
        "review-report.json",
        "evaluation-report.json",
        "runtime-harness-report.json",
        "post-run-verify-summary.json",
        ...includedSteps.map((step) => `${step}-artifact.json`),
      ].map((name) => [name, path.join(reportsRoot, name)]),
    );
    for (const step of includedSteps) {
      writeJsonFixture(files[`${step}-artifact.json`]);
    }
    writeJsonFixture(files["install-proof.json"]);
    writeJsonFixture(files["generated-project.aor.yaml"]);
    writeJsonFixture(files["feature-request.json"]);
    writeJsonFixture(files["baseline-verify-summary.json"]);
    writeJsonFixture(files["delivery-artifact.json"]);
    writeJsonFixture(files["evaluation-report.json"]);
    writeJsonFixture(files["post-run-verify-summary.json"], {
      status: "passed",
    });
    writeJsonFixture(files["review-report.json"], {
      overall_status: "pass",
      artifact_quality: {
        status: "pass",
        findings: [],
      },
      code_quality: {
        status: "pass",
        changed_paths: ["httpie/manager/tasks/plugins.py", "tests/test_httpie_cli.py"],
        findings: [],
      },
    });
    writeJsonFixture(files["delivery-manifest.json"], {
      repo_deliveries: [
        {
          repo_id: "httpie-cli",
          changed_paths: ["httpie/manager/tasks/plugins.py", "tests/test_httpie_cli.py"],
          writeback_result: "patch-materialized",
          commit_refs: [],
        },
      ],
    });
    writeJsonFixture(files["runtime-harness-report.json"], {
      overall_decision: "pass",
      step_decisions: [
        {
          mission_semantics: {
            meaningful_changed_paths: ["source/httpie/core.py", "tests/test_core.py"],
            non_bootstrap_changed_paths: ["source/httpie/core.py", "tests/test_core.py"],
          },
        },
      ],
    });

    const stepJournal = includedSteps.map((step, index) => ({
      sequence: index + 1,
      step_id: step,
      step_instance_id: step,
      iteration: 1,
      flow_stage: step,
      plan: {
        objective: `Observe ${step}.`,
        public_surface: `aor ${step}`,
        command_labels: [`${step}-run`],
        expected_artifacts: [],
        inspection_sources: ["command_transcript"],
        safety_constraints: ["no-upstream-write"],
      },
      plan_ref: files[`${step}-artifact.json`],
      public_surface: `aor ${step}`,
      transcript_ref: files[`${step}-artifact.json`],
      execution_ref: files[`${step}-artifact.json`],
      inspection_ref: files[`${step}-artifact.json`],
      classification_ref: files[`${step}-artifact.json`],
      artifact_refs: [files[`${step}-artifact.json`]],
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
        findings: [],
      },
      agent_decision_request_ref: files[`${step}-artifact.json`],
      operator_decision_ref: files[`${step}-artifact.json`],
      operator_decision_status: "accepted",
      inspected_evidence_refs: [files[`${step}-artifact.json`]],
      requested_interaction: null,
      decision: {
        action: "continue",
        reason: "Accepted test evidence.",
      },
      resume_result: null,
      frontend_interaction_refs: [],
      final_step_verdict: "pass",
    }));

    writeJsonFixture(files["controller-state.json"], {
      current_step: null,
      completed_steps: includedSteps,
      artifacts_snapshot: {
        target_checkout_root: targetCheckoutRoot,
        generated_project_profile_file: files["generated-project.aor.yaml"],
        feature_request_file: files["feature-request.json"],
        baseline_verify_summary_file: files["baseline-verify-summary.json"],
        baseline_verify_status: "pass",
        delivery_manifest_file: files["delivery-manifest.json"],
        review_report_file: files["review-report.json"],
        evaluation_report_file: files["evaluation-report.json"],
        post_run_verify_summary_file: files["post-run-verify-summary.json"],
        post_run_verify_status: "pass",
        provider_execution_status: "completed",
        runtime_harness_report_file: files["runtime-harness-report.json"],
        context_budget_status: "pass",
        top_context_size_sources: [
          {
            source: "provider_work_packet.context",
            bytes: 2048,
            chars: 2048,
            estimated_tokens: 683,
          },
        ],
        feature_mission_id: "httpie-plugin-upgrade-exit-status",
        feature_size: "medium",
        matrix_cell: {
          cell_id: "httpie.repair.medium.anthropic",
        },
      },
    });

    const written = writeProofRunnerArtifacts({
      hostRoot: repoRoot,
      hostProjectId: "aor-test",
      layout: { reportsRoot, runtimeRoot },
      runId,
      profilePath: path.join(tempRoot, "profile.yaml"),
      profile: {
        profile_id: "live-e2e.test.final-verdict-request-hydrated",
        journey_mode: "full-journey",
        run_tier: "acceptance",
        target_catalog_id: "httpie",
        feature_mission_id: "httpie-plugin-upgrade-exit-status",
        scenario_family: "repair",
        provider_variant_id: "anthropic-primary",
        stages: includedSteps,
        live_e2e: {
          flow_range_policy: "delivery_default",
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
        stageResults: includedSteps.map((step) => ({
          stage: step,
          status: "pass",
          evidence_refs: [files[`${step}-artifact.json`]],
          summary: `${step} passed.`,
        })),
        commandResults: [
          {
            label: "deliver-prepare",
            command_surface: "aor deliver prepare",
            status: "pass",
            exit_code: 0,
            transcript_file: files["delivery-artifact.json"],
            artifact_refs: [files["delivery-artifact.json"]],
          },
        ],
        artifacts: {
          host_runtime_root: runtimeRoot,
          host_reports_root: reportsRoot,
          runtime_harness_report_file: files["runtime-harness-report.json"],
          live_e2e_controller_state_file: files["controller-state.json"],
          live_e2e_step_journal_entries: stepJournal,
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
        },
      },
      aorLaunch: {
        command: process.execPath,
        argsPrefix: [],
        binaryRef: runProfileScript,
      },
    });

    assert.equal(written.summary.status, "pass");
    assert.equal(written.summary.live_e2e_run_health_overall_status, "pass");
    assert.equal(written.summary.final_skill_agent_verdict_request_file, undefined);
    assert.equal(written.summary.delivery_manifest_file, files["delivery-manifest.json"]);
    assert.equal(written.summary.review_report_file, files["review-report.json"]);
    assert.equal(written.summary.post_run_verify_status, "pass");
    assert.equal(written.summary.real_code_change_status, "pass");
    assert.deepEqual(written.summary.meaningful_changed_paths, ["source/httpie/core.py", "tests/test_core.py"]);
    assert.equal(written.runHealthReport.overall_status, "pass");
    assert.equal(written.runHealthReport.provider_health.provider_execution_status, "completed");
    assert.equal(written.runHealthReport.provider_health.top_context_size_sources[0].source, "provider_work_packet.context");
    assert.equal(written.runHealthReport.target_environment_health.target_verification_status, "pass");
    assert.equal(written.runHealthReport.failure_summary.owner, null);
  });
});

test("proof runner run-health ignores repaired review warnings and non-failure class none", () => {
  withTempRoot((tempRoot) => {
    const reportsRoot = path.join(tempRoot, "reports");
    const runtimeRoot = path.join(tempRoot, "runtime");
    const targetCheckoutRoot = path.join(tempRoot, "target");
    fs.mkdirSync(reportsRoot, { recursive: true });
    fs.mkdirSync(runtimeRoot, { recursive: true });
    fs.mkdirSync(targetCheckoutRoot, { recursive: true });

    const runId = "run-health-repaired-review-warnings";
    const baseSteps = ["discovery", "spec", "planning", "handoff", "execution", "qa", "delivery"];
    const stepEntries = [
      ...baseSteps.map((step) => ({ step, instance: step, iteration: 1, status: "pass" })),
      { step: "review", instance: "review", iteration: 1, status: "pass" },
      { step: "review", instance: "review#2", iteration: 2, status: "warn" },
      { step: "review", instance: "review#3", iteration: 3, status: "pass" },
    ].sort((left, right) => {
      const order = ["discovery", "spec", "planning", "handoff", "execution", "review", "qa", "delivery"];
      const stepOrder = order.indexOf(left.step) - order.indexOf(right.step);
      return stepOrder === 0 ? left.iteration - right.iteration : stepOrder;
    });
    const files = Object.fromEntries(
      [
        "controller-state.json",
        "install-proof.json",
        "generated-project.aor.yaml",
        "feature-request.json",
        "baseline-verify-summary.json",
        "review-report.json",
        "evaluation-report.json",
        "delivery-manifest.json",
        "post-run-verify-summary.json",
        ...stepEntries.map((entry, index) => `${String(index + 1).padStart(2, "0")}-${entry.instance}.json`),
      ].map((name) => [name, path.join(reportsRoot, name)]),
    );
    for (const file of Object.values(files)) {
      writeJsonFixture(file);
    }
    writeJsonFixture(files["post-run-verify-summary.json"], { status: "passed" });
    writeJsonFixture(files["review-report.json"], { overall_status: "pass" });
    writeJsonFixture(files["delivery-manifest.json"], {
      repo_deliveries: [
        {
          repo_id: "ky",
          changed_paths: ["source/core/Ky.ts", "test/retry.ts"],
          writeback_result: "patch-materialized",
          commit_refs: [],
        },
      ],
    });

    const stepJournal = stepEntries.map((entry, index) => {
      const ref = files[`${String(index + 1).padStart(2, "0")}-${entry.instance}.json`];
      return {
        sequence: index + 1,
        step_id: entry.step,
        step_instance_id: entry.instance,
        iteration: entry.iteration,
        flow_stage: entry.step,
        plan_ref: ref,
        public_surface: `aor ${entry.step}`,
        transcript_ref: ref,
        execution_ref: ref,
        inspection_ref: ref,
        classification_ref: ref,
        artifact_refs: [ref],
        started_at: "2026-06-09T00:00:00.000Z",
        finished_at: "2026-06-09T00:00:01.000Z",
        duration_sec: 1,
        deterministic_analysis: {
          status: entry.status,
          exit_code: 0,
          failure_class: null,
          missing_evidence: [],
          recommendation: entry.status === "warn" ? "inspect stage evidence refs" : "continue",
        },
        semantic_analysis: {
          status: entry.status,
          judge_source: "skill-agent",
          findings: [],
        },
        agent_decision_request_ref: ref,
        operator_decision_ref: ref,
        operator_decision_status: "accepted",
        inspected_evidence_refs: [ref],
        requested_interaction: null,
        decision: {
          action: entry.status === "warn" ? "retry_public_step" : "continue",
          reason: "Accepted test evidence.",
        },
        resume_result: null,
        frontend_interaction_refs: [],
        final_step_verdict: entry.status,
      };
    });

    writeJsonFixture(files["controller-state.json"], {
      current_step: null,
      completed_steps: stepEntries.map((entry) => entry.instance),
      artifacts_snapshot: {
        target_checkout_root: targetCheckoutRoot,
        generated_project_profile_file: files["generated-project.aor.yaml"],
        feature_request_file: files["feature-request.json"],
        baseline_verify_summary_file: files["baseline-verify-summary.json"],
        baseline_verify_status: "pass",
        delivery_manifest_file: files["delivery-manifest.json"],
        review_report_file: files["review-report.json"],
        evaluation_report_file: files["evaluation-report.json"],
        post_run_verify_summary_file: files["post-run-verify-summary.json"],
        post_run_verify_status: "pass",
        provider_execution_status: "completed",
        failure_owner: "provider",
        failure_phase: "provider_execution",
        failure_class: "none",
        real_code_change_status: "pass",
        feature_mission_id: "ky-retry-hooks-governance",
        feature_size: "large",
      },
    });

    const written = writeProofRunnerArtifacts({
      hostRoot: repoRoot,
      hostProjectId: "aor-test",
      layout: { reportsRoot, runtimeRoot },
      runId,
      profilePath: path.join(tempRoot, "profile.yaml"),
      profile: {
        profile_id: "live-e2e.test.run-health-repaired-review-warnings",
        journey_mode: "full-journey",
        run_tier: "acceptance",
        target_catalog_id: "ky",
        feature_mission_id: "ky-retry-hooks-governance",
        scenario_family: "governance",
        provider_variant_id: "anthropic-primary",
        stages: ["discovery", "spec", "planning", "handoff", "execution", "review", "qa", "delivery"],
        live_e2e: {
          flow_range_policy: "delivery_default",
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
        stageResults: ["discovery", "spec", "planning", "handoff", "execution", "review", "qa", "delivery"].map((step) => ({
          stage: step,
          status: "pass",
          evidence_refs: [files["delivery-manifest.json"]],
          summary: `${step} passed.`,
        })),
        commandResults: [],
        artifacts: {
          host_runtime_root: runtimeRoot,
          host_reports_root: reportsRoot,
          live_e2e_controller_state_file: files["controller-state.json"],
          live_e2e_step_journal_entries: stepJournal,
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
          failure_owner: "provider",
          failure_phase: "provider_execution",
          failure_class: "none",
        },
      },
      aorLaunch: {
        command: process.execPath,
        argsPrefix: [],
        binaryRef: runProfileScript,
      },
    });

    assert.equal(written.summary.status, "pass");
    assert.equal(written.summary.live_e2e_run_health_overall_status, "pass");
    assert.equal(written.runHealthReport.overall_status, "pass");
    assert.equal(written.runHealthReport.command_health.failed_command_count, 0);
    assert.equal(written.runHealthReport.failure_summary.owner, null);
    assert.equal(written.runHealthReport.failure_summary.class, null);
  });
});

test("proof runner does not report delivery path omissions before manifest exists", () => {
  withTempRoot((tempRoot) => {
    const reportsRoot = path.join(tempRoot, "reports");
    const runtimeRoot = path.join(tempRoot, "runtime");
    const targetCheckoutRoot = path.join(tempRoot, "target");
    fs.mkdirSync(reportsRoot, { recursive: true });
    fs.mkdirSync(runtimeRoot, { recursive: true });
    fs.mkdirSync(targetCheckoutRoot, { recursive: true });

    const runId = "pre-delivery-no-omission-noise";
    const includedSteps = ["discovery", "spec", "planning", "handoff", "execution", "review"];
    const files = Object.fromEntries(
      [
        "controller-state.json",
        "install-proof.json",
        "generated-project.aor.yaml",
        "feature-request.json",
        "runtime-harness-report.json",
        "review-report.json",
        "post-run-verify-summary.json",
        ...includedSteps.map((step) => `${step}-artifact.json`),
      ].map((name) => [name, path.join(reportsRoot, name)]),
    );
    for (const step of includedSteps) {
      writeJsonFixture(files[`${step}-artifact.json`]);
    }
    writeJsonFixture(files["install-proof.json"]);
    writeJsonFixture(files["generated-project.aor.yaml"]);
    writeJsonFixture(files["feature-request.json"]);
    writeJsonFixture(files["post-run-verify-summary.json"], {
      status: "passed",
    });
    writeJsonFixture(files["runtime-harness-report.json"], {
      overall_decision: "pass",
      step_decisions: [
        {
          mission_semantics: {
            meaningful_changed_paths: ["source/core/Ky.ts", "test/retry.ts"],
          },
        },
      ],
    });
    writeJsonFixture(files["review-report.json"], {
      overall_status: "pass",
      artifact_quality: {
        status: "pass",
        findings: [],
      },
      code_quality: {
        status: "pass",
        changed_paths: ["source/core/Ky.ts", "test/retry.ts"],
        findings: [],
      },
    });

    const stepJournal = includedSteps.map((step, index) => ({
      sequence: index + 1,
      step_id: step,
      step_instance_id: step,
      iteration: 1,
      flow_stage: step,
      plan: {
        objective: `Observe ${step}.`,
        public_surface: `aor ${step}`,
        command_labels: [`${step}-run`],
        expected_artifacts: [],
        inspection_sources: ["command_transcript"],
        safety_constraints: ["no-upstream-write"],
      },
      plan_ref: files[`${step}-artifact.json`],
      public_surface: `aor ${step}`,
      transcript_ref: files[`${step}-artifact.json`],
      execution_ref: files[`${step}-artifact.json`],
      inspection_ref: files[`${step}-artifact.json`],
      classification_ref: files[`${step}-artifact.json`],
      artifact_refs: [files[`${step}-artifact.json`]],
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
        findings: [],
      },
      agent_decision_request_ref: files[`${step}-artifact.json`],
      operator_decision_ref: files[`${step}-artifact.json`],
      operator_decision_status: "accepted",
      inspected_evidence_refs: [files[`${step}-artifact.json`]],
      requested_interaction: null,
      decision: {
        action: "continue",
        reason: "Accepted test evidence.",
      },
      resume_result: null,
      frontend_interaction_refs: [],
      final_step_verdict: "pass",
    }));

    writeJsonFixture(files["controller-state.json"], {
      current_step: "delivery",
      completed_steps: includedSteps,
      artifacts_snapshot: {
        target_checkout_root: targetCheckoutRoot,
        generated_project_profile_file: files["generated-project.aor.yaml"],
        feature_request_file: files["feature-request.json"],
        latest_runtime_harness_report_file: files["runtime-harness-report.json"],
        review_report_file: files["review-report.json"],
        post_run_verify_summary_file: files["post-run-verify-summary.json"],
        post_run_verify_status: "pass",
        provider_execution_status: "completed",
        real_code_change_status: "pass",
        feature_mission_id: "ky-retry-hooks-governance",
        feature_size: "large",
        matrix_cell: {
          cell_id: "ky.governance.large.anthropic",
        },
      },
    });

    const written = writeProofRunnerArtifacts({
      hostRoot: repoRoot,
      hostProjectId: "aor-test",
      layout: { reportsRoot, runtimeRoot },
      runId,
      profilePath: path.join(tempRoot, "profile.yaml"),
      profile: {
        profile_id: "live-e2e.test.pre-delivery-no-omission-noise",
        journey_mode: "full-journey",
        run_tier: "acceptance",
        target_catalog_id: "ky",
        feature_mission_id: "ky-retry-hooks-governance",
        scenario_family: "governance",
        provider_variant_id: "anthropic-primary",
        stages: includedSteps,
        live_e2e: {
          flow_range_policy: "delivery_default",
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
        stageResults: includedSteps.map((step) => ({
          stage: step,
          status: "pass",
          evidence_refs: [files[`${step}-artifact.json`]],
          summary: `${step} passed.`,
        })),
        commandResults: [],
        artifacts: {
          host_runtime_root: runtimeRoot,
          host_reports_root: reportsRoot,
          live_e2e_controller_state_file: files["controller-state.json"],
          live_e2e_step_journal_entries: stepJournal,
          target_checkout_root: targetCheckoutRoot,
          latest_runtime_harness_report_file: files["runtime-harness-report.json"],
          review_report_file: files["review-report.json"],
          post_run_verify_summary_file: files["post-run-verify-summary.json"],
          post_run_verify_status: "pass",
          provider_execution_status: "completed",
          real_code_change_status: "pass",
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
        },
      },
      aorLaunch: {
        command: process.execPath,
        argsPrefix: [],
        binaryRef: runProfileScript,
      },
    });

    const serializedSummary = JSON.stringify(written.summary);
    assert.equal(serializedSummary.includes("delivery manifest omits Runtime Harness meaningful"), false);
    assert.equal(serializedSummary.includes("delivery manifest omits review"), false);
  });
});
