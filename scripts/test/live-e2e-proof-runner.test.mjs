import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadContractFile } from "../../packages/contracts/src/index.mjs";
import { loadProofRunnerProfile } from "../live-e2e/lib/profile-catalog.mjs";
import {
  materializeFeatureRequestFile,
  materializeGeneratedProjectProfile,
  materializeProviderPinnedPolicyOverrides,
  materializeProviderPinnedRouteOverrides,
  materializeTargetCheckout,
} from "../live-e2e/lib/target-materialization.mjs";
import { runLiveAdapterPreflight } from "../live-e2e/lib/preflight.mjs";
import {
  archivedNextActionReportForMission,
  nextActionReportClosesFlow,
  prepareAorInstallationProof,
  runtimeHarnessReportHasMissionRelevantChanges,
  resolveExecutionStageStatusForRuntimeHarnessDecision,
} from "../live-e2e/lib/flows.mjs";
import {
  REQUIRED_GUIDED_COMMAND_LABELS,
  buildGuidedJourneyProof,
  validateGuidedJourneyProof,
} from "../live-e2e/lib/guided-proof.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const runProfileScript = path.join(repoRoot, "scripts/live-e2e/run-profile.mjs");
const manualLiveE2eScript = path.join(repoRoot, "scripts/live-e2e/manual-live-e2e.mjs");

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
            "    - final-skill-agent-verdict",
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

test("ky small and medium Codex/Qwen profiles are loadable catalog-backed live E2E profiles", () => {
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
  for (const attempt of fixture.attempts) {
    assert.equal(attempt.status, "blocked");
    assert.equal(attempt.product_pass_claimed, false);
    assert.equal(attempt.no_upstream_write, true);
    assert.match(attempt.public_command_surface, /live-e2e|qwen/u);
  }
  const codexAttempt = fixture.attempts.find((entry) => entry.provider_variant_id === "openai-primary");
  assert.equal(codexAttempt.blocker_class, "target-verification-environment");
  assert.match(codexAttempt.public_observation, /baseline-diagnostic/u);
  const qwenAttempt = fixture.attempts.find((entry) => entry.provider_variant_id === "qwen-primary");
  assert.match(qwenAttempt.public_observation, /0\.17\.0/u);
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
        expected_evidence: ["routed-step-result"],
        acceptance_checks: ["pass targeted headers test"],
        change_evidence: {
          required_path_prefixes: ["source/", "test/"],
        },
      },
    });

    assert.deepEqual(result.requestDocument.change_evidence.required_path_prefixes, ["source/", "test/"]);
    const persisted = JSON.parse(fs.readFileSync(result.requestFile, "utf8"));
    assert.deepEqual(persisted.change_evidence.required_path_prefixes, ["source/", "test/"]);
  });
});

test("generated live E2E profile allows the selected candidate provider adapter", () => {
  withTempRoot((tempRoot) => {
    const generatedAssetsRoot = path.join(tempRoot, "assets");
    fs.mkdirSync(generatedAssetsRoot, { recursive: true });

    const result = materializeGeneratedProjectProfile({
      hostRoot: repoRoot,
      profilePath: path.join(repoRoot, "scripts/live-e2e/profiles/installed-user-guided-journey-qwen.yaml"),
      profile: {
        runtime: { mode: "ephemeral" },
        output_policy: { preferred_delivery_mode: "patch-only" },
        verification: {},
      },
      catalogEntry: { verification: {} },
      providerVariant: {
        provider: "qwen",
        primary_adapter: "qwen-code",
      },
      runId: "qwen-provider-allowlist",
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
    assert.ok(loaded.document.allowed_providers.includes("qwen"));
    assert.ok(loaded.document.allowed_adapters.includes("qwen-code"));
    assert.equal(loaded.document.runtime_defaults.verification_command_timeout_sec, 1800);
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

test("run summary canonical status is recomputed on resumed final verdicts", () => {
  const runProfileSource = fs.readFileSync(runProfileScript, "utf8");
  assert.doesNotMatch(
    runProfileSource,
    /if \(Object\.keys\(existing\)\.length > 0\) return existing/u,
  );
});

test("manual live E2E exposes final skill-agent verdict installation workflow", () => {
  const help = spawnSync(process.execPath, [manualLiveE2eScript, "--help"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--final-verdict-file/u);

  const source = fs.readFileSync(manualLiveE2eScript, "utf8");
  assert.match(source, /installFinalSkillAgentVerdict/u);
  assert.match(source, /final_skill_agent_verdict/u);
  assert.match(source, /expected_final_skill_agent_verdict_ref/u);
  assert.match(source, /requiredPublicAction[\s\S]*final_skill_agent_verdict/u);
  assert.match(source, /!currentStep && finalSkillAgentVerdictMissing/u);
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
