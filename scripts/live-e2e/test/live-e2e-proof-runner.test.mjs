import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { deriveRuntimeRunId } from "../lib/common.mjs";
import { loadContractFile } from "../lib/contracts/index.mjs";
import {
  discoverHostProjectId,
  createProofRunnerEnvironment,
  createSessionRoots,
  ensureRuntimeLayout,
  loadCatalogTarget,
  loadProofRunnerProfile,
  resolveCatalogRoot,
  resolveFullJourneyProfile,
} from "../lib/profile-catalog.mjs";
import {
  materializeFeatureRequestFile,
  materializeGeneratedProjectProfile,
  materializeHostLiveE2eAssets,
  materializeProviderPinnedPolicyOverrides,
  materializeProviderPinnedRouteOverrides,
  materializeTargetCheckout,
} from "../lib/target-materialization.mjs";
import { runLiveAdapterPreflight } from "../lib/preflight.mjs";
import { buildProviderQualificationMatrix } from "../lib/provider-qualification-matrix.mjs";
import { applyProductionProofEvidence } from "../lib/production-proof.mjs";
import { collectTypedEvidenceRefs } from "../lib/evidence-ref-collector.mjs";
import {
  archivedNextActionReportForMission,
  buildHandoffApprovalArgs,
  buildTargetPreExecutionStatusReport,
  collectGuidedBrowserTaskProof,
  collectReviewFindingDetails,
  collectReviewChangedPaths,
  collectRuntimeHarnessChangedPaths,
  buildAcceptanceRepairDrillFinding,
  evaluateBaselineVerifyGate,
  evaluateRepairProofExpectations,
  evaluateTargetToolchainPreflight,
  nextActionReportClosesFlow,
  nodeVersionSatisfiesRequiredRange,
  prepareAorInstallationProof,
  reconcileSummaryMeaningfulChangedPaths,
  reviewAllowsLiveE2eDelivery,
  resolveFlowIdentityFromPacket,
  resolveAcceptanceRepairDrill,
  runGuidedWebSmoke,
  runtimeHarnessReportHasMissionRelevantChanges,
  resolveActiveAcceptanceRepairDrill,
  resolveExecutionStageStatusForRuntimeHarnessDecision,
} from "../lib/flows.mjs";
import { deriveGuidedFollowUpMissionId } from "../lib/guided-flow-identity.mjs";
import { prepareProviderWorkspaceDependencies } from "../lib/provider-workspace-setup.mjs";
import {
  REQUIRED_GUIDED_COMMAND_LABELS,
  buildGuidedJourneyProof,
  validateGuidedJourneyProof,
} from "../lib/guided-proof.mjs";
import {
  hasPendingIncludedControllerStep,
  preparePendingOperatorDecision,
  resolveEvaluatorRunProfileArgs,
  shouldAwaitFirstControllerObservation,
} from "../step-evaluator.mjs";
import {
  buildArtifactReadinessProof,
  resolveRunHealthFailure,
  writeProofRunnerArtifacts,
} from "../run-profile.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

test("live E2E assessment refs include only typed evidence fields and known evidence groups", () => {
  const refs = collectTypedEvidenceRefs({
    command: "CI=1 npx ava test/headers.ts",
    title: "Inspect docs/contracts/00-index.md before continuing",
    route_id: "route.anthropic.primary",
    requested_model: "claude-default",
    inline_context: "context_doc_id: example\nsource:\n  ref: docs/architecture/runtime.md",
    report_ref: "evidence://reports/review.json",
    transcript_file: "/tmp/aor proof/command.json",
    related_refs: ["packet://mission/example", "reports/verification.json"],
    nested: {
      evidence_refs: ["reports/runtime-harness.json"],
      command: "aor review run --project-ref /tmp/project",
    },
    evidence: {
      review: "reports/review.json",
      summary: "Review passed without artifacts",
    },
  });

  assert.deepEqual(refs, [
    "evidence://reports/review.json",
    "/tmp/aor proof/command.json",
    "packet://mission/example",
    "reports/verification.json",
    "reports/runtime-harness.json",
    "reports/review.json",
  ]);
  assert.equal(refs.some((ref) => ref.includes("npx ava")), false);
  assert.equal(refs.some((ref) => ref.includes("context_doc_id")), false);
});
const runProfileScript = path.join(repoRoot, "scripts/live-e2e/run-profile.mjs");
const fullJourneyFlowScript = path.join(repoRoot, "scripts/live-e2e/lib/flows.mjs");
const manualLiveE2eScript = path.join(repoRoot, "scripts/live-e2e/manual-live-e2e.mjs");
const qualityAssessmentScript = path.join(repoRoot, "scripts/live-e2e/quality-assessment.mjs");
const qualificationLoopScript = path.join(repoRoot, "scripts/live-e2e/qualification-loop.mjs");

test("private live E2E delivery preserves non-actionable review warnings without treating them as repair failures", () => {
  const verificationWarning = {
    overall_status: "warn",
    findings: [
      {
        severity: "warn",
        category: "verification-mapping",
        summary: "Changed tests are covered by the deferred diagnostic verification command.",
      },
    ],
  };
  const actionableWarning = {
    overall_status: "warn",
    review_recommendation: "repair",
    findings: [{ severity: "warn", category: "code-quality", summary: "Implementation change required." }],
  };

  assert.equal(reviewAllowsLiveE2eDelivery({}, "pass"), true);
  assert.equal(reviewAllowsLiveE2eDelivery(verificationWarning, "warn"), true);
  assert.equal(reviewAllowsLiveE2eDelivery(actionableWarning, "warn"), false);
  assert.equal(reviewAllowsLiveE2eDelivery({ overall_status: "fail" }, "fail"), false);
});

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

test("step evaluator pins a generated run id across continuation attempts", () => {
  withTempRoot((tempRoot) => {
    const profilePath = path.join(tempRoot, "profile.yaml");
    fs.writeFileSync(profilePath, "profile_id: live-e2e.test.stable-evaluator\n", "utf8");

    const args = ["--project-ref", ".", "--profile", profilePath];
    const resolved = resolveEvaluatorRunProfileArgs(args);
    const runIdIndex = resolved.indexOf("--run-id");

    assert.notEqual(runIdIndex, -1);
    assert.match(resolved[runIdIndex + 1], /^live-e2e\.test\.stable-evaluator\.run-\d{12}$/u);
    assert.deepEqual(resolved.slice(0, args.length), args);
  });
});

test("step evaluator preserves explicit run id", () => {
  const args = ["--project-ref", ".", "--profile", "profile.yaml", "--run-id", "live-e2e.explicit.run"];

  assert.deepEqual(resolveEvaluatorRunProfileArgs(args), args);
});

function writeJsonFixture(filePath, payload = {}) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return filePath;
}

function writeTextFixture(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, payload, "utf8");
  return filePath;
}

test("artifact readiness proof summarizes public readiness and prompt lineage", () => {
  withTempRoot((tempRoot) => {
    const generatedProjectProfileFile = writeTextFixture(
      path.join(tempRoot, "project.aor.yaml"),
      [
        "project_id: test-project",
        "default_prompt_bundles:",
        "  discovery: prompt-bundle://discovery-default@v1",
        "  research: prompt-bundle://research-default@v1",
        "  spec: prompt-bundle://spec-default@v1",
        "  planning: prompt-bundle://planner-default@v1",
        "",
      ].join("\n"),
    );
    const nextActionReportFile = writeJsonFixture(path.join(tempRoot, "next-action-report.json"), {
      next_action_status: "ready",
      next_action_primary: "planning",
      artifact_readiness: {
        policy: { mode: "strict", allow_incomplete_research_for_spec: false },
        stages: {
          mission: { status: "complete", evidence_ref: "packet://mission" },
          discovery: { status: "complete", evidence_ref: "evidence://analysis" },
          research: { status: "adr-ready", evidence_ref: "evidence://research" },
          spec: {
            status: "ready",
            evidence_ref: "evidence://spec",
            required_evidence_refs: ["evidence://analysis", "evidence://research", "evidence://spec"],
          },
          planning: { status: "ready", evidence_ref: "packet://handoff" },
        },
      },
    });
    const analysisReportFile = writeJsonFixture(path.join(tempRoot, "analysis-report.json"), {
      asset_resolution: {
        matrix: [
          {
            step_class: "discovery",
            route: { resolved_route_id: "route.discovery.default" },
            wrapper: { wrapper_ref: "wrapper.artifact.default@v1" },
            prompt_bundle: { prompt_bundle_ref: "prompt-bundle://discovery-default@v1" },
          },
          {
            step_class: "research",
            route: { resolved_route_id: "route.research.default" },
            wrapper: { wrapper_ref: "wrapper.artifact.default@v1" },
            prompt_bundle: { prompt_bundle_ref: "prompt-bundle://research-default@v1" },
          },
          {
            step_class: "spec",
            route: { resolved_route_id: "route.spec.default" },
            wrapper: { wrapper_ref: "wrapper.artifact.default@v1" },
            prompt_bundle: { prompt_bundle_ref: "prompt-bundle://spec-default@v1" },
          },
          {
            step_class: "planning",
            route: { resolved_route_id: "route.plan.default" },
            wrapper: { wrapper_ref: "wrapper.planner.default@v1" },
            prompt_bundle: { prompt_bundle_ref: "prompt-bundle://planner-default@v1" },
          },
        ],
      },
      architecture_traceability: {
        step_linkage: [
          {
            step_class: "spec",
            route_id: "route.spec.default",
            wrapper_ref: "wrapper.artifact.default@v1",
            prompt_bundle_ref: "prompt-bundle://spec-default@v1",
            policy_id: "policy.step.artifact.default",
          },
        ],
      },
    });
    const discoveryResearchReportFile = writeJsonFixture(path.join(tempRoot, "discovery-research-report.json"), {
      status: "adr-ready",
      research_inputs: { source_refs: ["runtime://local-research-note"] },
      open_questions: [],
      adr_ready_recommendations: [{ status: "ready" }],
    });
    const specStepResultFile = writeJsonFixture(path.join(tempRoot, "spec-step-result.json"), {
      routed_execution: {
        architecture_traceability: {
          selected_step: {
            step_class: "spec",
            route_id: "route.spec.default",
            wrapper_ref: "wrapper.artifact.default@v1",
            prompt_bundle_ref: "prompt-bundle://spec-default@v1",
            policy_id: "policy.step.artifact.default",
          },
        },
        context_compilation: {
          compiled_context_ref: "compiled-context://test.spec",
          compiled_context_file: path.join(tempRoot, "compiled-context.json"),
          compiled_context_artifact: {
            prompt_bundle_ref: "prompt-bundle://spec-default@v1",
            packet_refs: ["packet://discovery", "packet://research"],
            context_bundle_refs: ["context-bundle://context.bundle.artifact.foundation@v1"],
            skill_refs: ["skill.artifact.default@v1"],
            provenance: {
              compiler_revision_ref: "compiler-revision://runtime-context-compiler@v1",
              project_profile_ref: generatedProjectProfileFile,
              route_profile_ref: "route.spec.default",
              wrapper_profile_ref: "wrapper.artifact.default@v1",
            },
          },
        },
        adapter_request: {
          input_packet_refs: ["packet://discovery", "packet://research"],
        },
      },
    });

    const proof = buildArtifactReadinessProof({
      artifacts: {
        generated_project_profile_file: generatedProjectProfileFile,
        analysis_report_file: analysisReportFile,
        discovery_research_report_file: discoveryResearchReportFile,
        spec_step_result_file: specStepResultFile,
        wave_ticket_file: path.join(tempRoot, "wave-ticket.json"),
        handoff_packet_file: path.join(tempRoot, "handoff-packet.json"),
        handoff_status: "pending-approval",
        next_action_report_files: [nextActionReportFile],
        artifact_readiness_snapshots: [
          {
            checkpoint: "planning",
            command_label: "artifact-readiness-next-after-planning",
            transcript_file: path.join(tempRoot, "next-transcript.json"),
            next_action_report_file: nextActionReportFile,
            artifact_readiness: {
              policy: { mode: "strict", allow_incomplete_research_for_spec: false },
              stages: {
                mission: { status: "complete", evidence_ref: "packet://mission" },
                discovery: { status: "complete", evidence_ref: "evidence://analysis" },
                research: { status: "adr-ready", evidence_ref: "evidence://research" },
                spec: {
                  status: "ready",
                  evidence_ref: "evidence://spec",
                  required_evidence_refs: ["evidence://analysis", "evidence://research", "evidence://spec"],
                },
                planning: { status: "pending", evidence_ref: null },
              },
            },
            evidence_refs: [nextActionReportFile],
          },
          {
            checkpoint: "planning",
            command_label: "artifact-readiness-next-after-planning",
            transcript_file: path.join(tempRoot, "next-transcript-resume.json"),
            next_action_report_file: nextActionReportFile,
            artifact_readiness: {
              stages: {
                planning: { status: "stale", evidence_ref: null },
              },
            },
            evidence_refs: [nextActionReportFile],
          },
        ],
      },
    });

    assert.equal(proof.proof_status, "available");
    assert.equal(proof.readiness_snapshots.length, 1);
    assert.equal(proof.readiness_snapshots[0].stages.research.status, "adr-ready");
    assert.equal(proof.readiness_snapshots[0].stages.planning.status, "pending");
    assert.equal(proof.discovery_research.adr_ready, true);
    assert.equal(proof.planning.handoff_status, "pending-approval");
    const discoveryStep = proof.prompt_lineage.steps.find((entry) => entry.step === "discovery");
    assert.equal(discoveryStep.profile_prompt_bundle_ref, "prompt-bundle://discovery-default@v1");
    assert.equal(discoveryStep.analysis_prompt_bundle_ref, "prompt-bundle://discovery-default@v1");
    const specStep = proof.prompt_lineage.steps.find((entry) => entry.step === "spec");
    assert.equal(specStep.compiled_context_ref, "compiled-context://test.spec");
    assert.equal(specStep.compiled_context_prompt_bundle_ref, "prompt-bundle://spec-default@v1");
    assert.deepEqual(specStep.required_input_refs, ["packet://discovery", "packet://research"]);
    assert.ok(proof.evidence_refs.includes(nextActionReportFile));
  });
});

const aorOperatorAccessibilityCheckIds = Object.freeze([
  "keyboard_navigation",
  "focus_order",
  "contrast_and_readability",
  "semantic_structure",
  "screen_reader_labels",
  "accessible_error_feedback",
]);

test("proof runner TMPDIR stays short for socket-sensitive target verification", () => {
  withTempRoot((tempRoot) => {
    const sessionsRoot = path.join(tempRoot, "projects", "aor-core", "sessions");
    const runId = "w47-control-fastify-repair-medium-20260624-4b263c3e73b4";
    const sessionRoots = createSessionRoots({ sessionsRoot, runId });
    const { env } = createProofRunnerEnvironment({
      sessionRoots,
      runnerAuthMode: "isolated",
    });

    assert.equal(env.TMPDIR, sessionRoots.tmpRoot);
    assert.equal(env.npm_config_cpu, process.arch);
    assert.equal(env.npm_config_os, process.platform);
    assert.equal(sessionRoots.tmpRoot.startsWith(sessionRoots.sessionRoot), false);
    assert.ok(sessionRoots.tmpRoot.length < 80, `expected short TMPDIR, got ${sessionRoots.tmpRoot}`);
    assert.equal(fs.existsSync(sessionRoots.tmpRoot), true);
  });
});

test("step evaluator keeps resuming when an included current step is still pending", () => {
  const pendingDeliveryState = {
    current_step: "delivery",
    included_steps: ["discovery", "spec", "planning", "handoff", "execution", "review", "qa", "delivery"],
    completed_steps: ["discovery", "spec", "planning", "handoff", "execution", "review", "qa"],
  };
  assert.equal(
    hasPendingIncludedControllerStep(pendingDeliveryState),
    true,
  );
  assert.equal(shouldAwaitFirstControllerObservation({ step_journal: [] }, pendingDeliveryState), true);
  assert.equal(shouldAwaitFirstControllerObservation({ step_journal: [{ step_id: "delivery" }] }, pendingDeliveryState), false);
  assert.equal(
    hasPendingIncludedControllerStep({
      current_step: "delivery",
      included_steps: ["discovery", "qa", "delivery"],
      completed_steps: ["discovery", "qa", "delivery"],
    }),
    false,
  );
  assert.equal(
    hasPendingIncludedControllerStep({
      current_step: "learning",
      included_steps: ["discovery", "qa", "delivery"],
      completed_steps: ["discovery", "qa", "delivery"],
    }),
    false,
  );
  assert.equal(
    shouldAwaitFirstControllerObservation(
      { step_journal: [] },
      {
        current_step: "learning",
        included_steps: ["discovery", "qa", "delivery"],
        completed_steps: ["discovery", "qa", "delivery"],
      },
    ),
    false,
  );
});

test("step evaluator writes a public block decision for deterministic non-pass evidence", () => {
  withTempRoot((tempRoot) => {
    const requestFile = path.join(tempRoot, "live-e2e-agent-decision-request-run-09-execution.json");
    const decisionFile = path.join(tempRoot, "live-e2e-operator-decision-run-09-execution.json");
    writeJsonFixture(requestFile, {
      request_id: "run.execution.operator-decision-request",
      step_id: "execution",
      step_instance_id: "execution",
      iteration: 1,
      deterministic_analysis: { status: "not_pass" },
      expected_response_shape: {
        action: "continue|block|diagnose",
        inspected_evidence_refs: [],
        evidence_refs: [],
      },
      operator_context: {
        operator_ref: "skill://live-e2e-runner",
      },
      operator_decision_expected_ref: decisionFile,
    });

    const result = preparePendingOperatorDecision({
      step_journal: [
        {
          sequence: 9,
          step_id: "execution",
          step_instance_id: "execution",
          agent_decision_request_ref: requestFile,
          operator_decision_status: "missing",
          deterministic_analysis: { status: "not_pass" },
        },
      ],
    });

    assert.equal(result.status, "prepared");
    assert.equal(result.action, "block");
    assert.equal(fs.existsSync(decisionFile), true);
    const decision = JSON.parse(fs.readFileSync(decisionFile, "utf8"));
    assert.equal(decision.action, "block");
    assert.equal(decision.semantic_analysis.status, "blocked");
    assert.match(decision.reason, /deterministic status 'not_pass'/u);
  });
});

function buildAccessibilityChecks(evidenceRef) {
  return aorOperatorAccessibilityCheckIds.map((checkId) => ({
    check_id: checkId,
    status: "pass",
    evidence_refs: [evidenceRef],
    findings: [],
  }));
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
    browserTaskProof: path.join(reportsRoot, "browser-task-proof.json"),
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
  writeJsonFixture(files.browserTaskProof, {
    status: "pass",
    accessibility_summary_file: files.webAccessibility,
    visual_guardrail_file: files.webVisual,
    keyboard_focus_sequence: [
      { index: 1, role: "button", label: "New Flow", selector: "button.new-flow-button" },
      { index: 2, role: "button", label: "Ask AOR", selector: "button.topbar-ask-button" },
    ],
    accessibility_checks: buildAccessibilityChecks(files.webAccessibility),
    task_outcome: {
      status: "pass",
      checked_tasks: ["AOR operator accessibility proof"],
      findings: [],
    },
  });
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
  return { proof, targetCheckoutRoot, reportsRoot, commandResults, artifacts };
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

test("summary changed-path collection uses meaningful paths without diagnostic fallbacks", () => {
  withTempRoot((tempRoot) => {
    const runtimeHarnessReport = writeJsonFixture(path.join(tempRoot, "runtime-harness-report.json"), {
      step_decisions: [
        {
          mission_semantics: {
            meaningful_changed_paths: ["source/utils/merge.ts"],
            non_bootstrap_changed_paths: ["source/utils/merge.ts", "test"],
          },
        },
      ],
    });
    const reviewReport = writeJsonFixture(path.join(tempRoot, "review-report.json"), {
      code_quality: {
        changed_paths: ["source/utils/merge.ts"],
        changed_path_diagnostics: {
          meaningful_changed_paths: ["source/utils/merge.ts"],
          non_input_changed_paths: ["source/utils/merge.ts", "test"],
        },
      },
    });

    assert.deepEqual(collectRuntimeHarnessChangedPaths(runtimeHarnessReport), ["source/utils/merge.ts"]);
    assert.deepEqual(collectReviewChangedPaths(reviewReport), ["source/utils/merge.ts"]);
  });
});

test("summary changed-path reconciliation uses immutable delivery authorization, not the primary checkout", () => {
  assert.deepEqual(
    reconcileSummaryMeaningfulChangedPaths(["source/utils.py", "test"], { authorizedChangedPaths: ["source/utils.py"] }),
    ["source/utils.py"],
  );
  assert.throws(
    () => reconcileSummaryMeaningfulChangedPaths(["source/other.py"], { authorizedChangedPaths: ["source/utils.py"] }),
    /disagrees with Runtime Harness\/review evidence/u,
  );
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

test("ky readiness and full-suite diagnostics isolate the timing-sensitive totalTimeout case without dropping coverage", () => {
  const catalogRoot = resolveCatalogRoot({ hostRoot: repoRoot, catalogRootOverride: null });
  const target = loadCatalogTarget({ catalogRoot, targetCatalogId: "ky" });
  const splitSuiteCommands = [
    "npm test -- --match='!*totalTimeout bounds a never-ending successful response body*'",
    "npx ava test/main.ts --match='totalTimeout bounds a never-ending successful response body'",
  ];

  assert.deepEqual(target.entry.verification.commands, splitSuiteCommands);
  for (const missionId of [
    "ky-header-regression",
    "ky-fetch-options-regression",
    "ky-retry-hooks-governance",
    "ky-request-lifecycle-observability-xlarge",
  ]) {
    const mission = target.entry.feature_missions.find((entry) => entry.mission_id === missionId);
    assert.ok(mission, `missing Ky mission ${missionId}`);
    assert.deepEqual(mission.post_run_quality.diagnostic_commands, [
      "npx playwright install",
      ...splitSuiteCommands,
    ]);
    assert.equal(mission.post_run_quality.diagnostic_commands.includes("npm test"), false);
  }
});

test("W35 silent provider UX proof fixture preserves fail-closed operator evidence", () => {
  const fixture = JSON.parse(
    fs.readFileSync(
      path.join(repoRoot, "scripts/live-e2e/fixtures/evidence/w35-s05/silent-provider-ux-proof.sample.json"),
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
      path.join(repoRoot, "scripts/live-e2e/fixtures/evidence/w35-s05/live-attempts-summary.sample.json"),
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
  assert.equal(codexAttempt.target_pre_execution_status_ref, "scripts/live-e2e/fixtures/evidence/w37-s01/target-pre-execution-status.sample.json");
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
      path.join(repoRoot, "scripts/live-e2e/fixtures/evidence/w40-s04/provider-qualification-matrix.sample.json"),
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

test("W46 canary targets keep required coverage small-only", () => {
  const catalogRoot = resolveCatalogRoot({ hostRoot: repoRoot, catalogRootOverride: null });
  for (const targetCatalogId of ["ky", "commander-js", "pluggy"]) {
    const target = loadCatalogTarget({ catalogRoot, targetCatalogId });
    const requiredCells = target.entry.required_matrix_cells.filter((entry) => entry.coverage_tier === "required");
    assert.ok(requiredCells.length > 0, `${targetCatalogId} should retain a small required canary cell`);
    assert.ok(
      requiredCells.every((entry) => entry.feature_size === "small"),
      `${targetCatalogId} required coverage must be small-only`,
    );
  }
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
      assert.equal(loaded.document.runtime_defaults.verification_command_timeout_sec, 1800);
      assert.deepEqual(loaded.document.repos[0].lint_commands, ["npm install --prefer-offline --no-audit --no-fund"]);
      assert.equal(loaded.document.repos[0].lint_commands.includes("npx playwright install"), false);
    }
  });
});

test("host assets pin Codex model defaults without changing other provider defaults", () => {
  withTempRoot((tempRoot) => {
    const sourceCodex = loadContractFile({
      filePath: path.join(repoRoot, "examples/adapters/codex-cli.yaml"),
      family: "adapter-capability-profile",
    });
    assert.equal(sourceCodex.ok, true);
    const sourceModes = sourceCodex.document.execution.external_runtime.permission_policy.modes;
    for (const mode of Object.values(sourceModes)) {
      assert.equal(mode.args.includes("--model"), false, "source adapter remains unchanged outside asset materialization");
    }

    const cases = [
      {
        adapterId: "codex-cli",
        expectedPrefix: ["--model", "gpt-5.5", "-c", 'model_reasoning_effort="xhigh"'],
      },
      { adapterId: "claude-code", expectedPrefix: null },
      { adapterId: "qwen-code", expectedPrefix: null },
    ];
    for (const current of cases) {
      const hostAssets = materializeHostLiveE2eAssets({
        examplesRoot: path.join(repoRoot, "examples"),
        generatedAssetsRoot: path.join(tempRoot, current.adapterId),
        providerVariant: { primary_adapter: current.adapterId },
      });
      const copied = loadContractFile({
        filePath: path.join(hostAssets.assetsRoot, "adapters", `${current.adapterId}.yaml`),
        family: "adapter-capability-profile",
      });
      assert.equal(copied.ok, true);
      const modes = copied.document.execution.external_runtime.permission_policy.modes;
      for (const mode of Object.values(modes)) {
        if (current.expectedPrefix) {
          assert.deepEqual(mode.args.slice(0, current.expectedPrefix.length), current.expectedPrefix);
        } else {
          assert.equal(mode.args.includes("--model"), false, `${current.adapterId} keeps its CLI model default`);
        }
      }
    }
  });
});

test("full-journey host assets atomically restore provider routes on every resume segment", () => {
  withTempRoot((tempRoot) => {
    const profileRef = "scripts/live-e2e/profiles/full-journey-governance-ky-large-codex.yaml";
    const loadedProfile = loadProofRunnerProfile({ hostRoot: repoRoot, profileRef });
    const resolved = resolveFullJourneyProfile({
      profile: loadedProfile.profile,
      catalogRoot: path.join(repoRoot, "scripts/live-e2e/catalog"),
    });
    const generatedAssetsRoot = path.join(tempRoot, "resume-assets");
    const materialize = () => materializeHostLiveE2eAssets({
      examplesRoot: path.join(repoRoot, "examples"),
      generatedAssetsRoot,
      providerVariant: resolved.providerVariant,
      providerVariantId: resolved.resolvedProfile.provider_variant_id,
      profile: resolved.resolvedProfile,
    });

    for (const segment of ["initial", "resume"]) {
      const assets = materialize();
      assert.equal(
        assets.providerRoutes.routeOverrides.discovery,
        "route.discovery.default.openai-primary",
        `${segment} segment exposes the pinned discovery route before project initialization`,
      );
      assert.equal(
        loadContractFile({
          filePath: path.join(assets.routesRoot, "discovery-openai-primary.yaml"),
          family: "provider-route-profile",
        }).ok,
        true,
      );
      assert.ok(assets.providerPolicies.policyFiles.length > 0);
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
        targetRepoId: "sindresorhus/ky",
        targetRepoRef: "main",
      },
      generatedAssetsRoot,
    });

    const loaded = loadContractFile({
      filePath: result.generatedProjectProfileFile,
      family: "project-profile",
    });
    assert.equal(loaded.ok, true);
    assert.equal(loaded.document.repos[0].repo_id, "ky");
    assert.equal(loaded.document.repos[0].name, "sindresorhus/ky");
    assert.equal(loaded.document.runtime_defaults.workspace_mode, "ephemeral");
    assert.equal(loaded.document.runtime_defaults.verification_command_timeout_sec, 120);
    assert.deepEqual(loaded.document.repos[0].lint_commands, ["CI=1 npm install --prefer-offline --no-audit --no-fund"]);
    assert.deepEqual(loaded.document.repos[0].test_commands, [
      "CI=1 npx xo",
      "CI=1 npm run build",
      "CI=1 npx ava test/headers.ts",
    ]);
    assert.equal(loaded.document.repos[0].lint_commands.includes("npx playwright install"), false);
  });
});

test("run-health keeps failed project bootstrap ahead of controller-incomplete fallback", () => {
  const failure = resolveRunHealthFailure({
    observationReport: { report_status: "in_progress" },
    commandHealth: {
      status: "fail",
      failed_commands: [{ command_surface: "aor project init" }],
    },
    controllerHealth: { status: "pass" },
    providerHealth: { status: "pass" },
    targetReadiness: { status: "not_attempted" },
    targetEnvironmentHealth: { status: "pass" },
    diagnosticHealth: { status: "pass" },
    evidenceHealth: { status: "pass", weak_evidence_refs: [] },
    resumeInteractionHealth: { status: "pass" },
    lifecycleCompletion: { continuation_status: "blocked" },
    artifacts: {},
  });

  assert.deepEqual(failure, {
    owner: "aor",
    phase: "project_bootstrap",
    class: "public_command_failed",
    summary: "Public project bootstrap failed before live E2E controller execution.",
  });
});

test("full journey materializes the structured plan before handoff approval", () => {
  const source = fs.readFileSync(path.join(repoRoot, "scripts/live-e2e/lib/flows.mjs"), "utf8");
  assert.match(source, /runCommand\("plan-create", \[\s*"plan",\s*"create"/u);
  assert.doesNotMatch(source, /runCommand\("wave-create"/u);
});

test("provider workspace setup materializes disposable dependencies with bounded evidence", () => {
  withTempRoot((tempRoot) => {
    const targetCheckoutRoot = path.join(tempRoot, "target");
    const reportsRoot = path.join(tempRoot, "reports");
    fs.mkdirSync(targetCheckoutRoot, { recursive: true });
    fs.mkdirSync(reportsRoot, { recursive: true });
    const result = prepareProviderWorkspaceDependencies({
      targetCheckoutRoot,
      reportsRoot,
      runId: "dependency-setup-pass",
      setupCommands: [
        `${JSON.stringify(process.execPath)} -e "require('fs').mkdirSync('node_modules/example', {recursive:true})"`,
      ],
      env: process.env,
      timeoutMs: 10_000,
    });

    assert.equal(result.status, "pass");
    assert.equal(fs.existsSync(path.join(targetCheckoutRoot, "node_modules/example")), true);
    assert.deepEqual(result.report.dependency_roots, ["node_modules"]);
    assert.equal(result.report.setup_commands[0].status, "pass");
    assert.equal(fs.existsSync(result.reportFile), true);
  });
});

test("provider workspace setup fails closed before provider execution", () => {
  withTempRoot((tempRoot) => {
    const targetCheckoutRoot = path.join(tempRoot, "target");
    const reportsRoot = path.join(tempRoot, "reports");
    fs.mkdirSync(targetCheckoutRoot, { recursive: true });
    fs.mkdirSync(reportsRoot, { recursive: true });
    const result = prepareProviderWorkspaceDependencies({
      targetCheckoutRoot,
      reportsRoot,
      runId: "dependency-setup-fail",
      setupCommands: [`${JSON.stringify(process.execPath)} -e "process.exit(7)"`],
      env: process.env,
      timeoutMs: 10_000,
    });

    assert.equal(result.status, "fail");
    assert.equal(result.report.setup_commands[0].exit_code, 7);
    assert.match(result.report.summary, /failed before provider execution/u);
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

test("generated ky medium profiles cover mission, hook, and retry test surfaces", () => {
  for (const profileRef of [
    "scripts/live-e2e/profiles/full-journey-regress-ky-medium-codex.yaml",
    "scripts/live-e2e/profiles/full-journey-regress-ky-medium-anthropic.yaml",
  ]) {
    withTempRoot((tempRoot) => {
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
        runId: "ky-medium-complete-primary-coverage",
        targetCheckout: { targetRepoId: "ky", targetRepoRef: "main" },
        generatedAssetsRoot,
      });
      const loaded = loadContractFile({
        filePath: result.generatedProjectProfileFile,
        family: "project-profile",
      });

      assert.equal(loaded.ok, true);
      assert.equal(loaded.document.runtime_defaults.verification_command_timeout_sec, 1800);
      assert.deepEqual(loaded.document.repos[0].test_commands, [
        "CI=1 npx xo",
        "CI=1 npm run build",
        "CI=1 npx ava test/fetch.ts",
        "CI=1 npx ava test/hooks.ts",
        "CI=1 npx ava test/retry.ts --match='*shouldRetry*'",
      ]);
    });
  }
});

test("W66 Ky medium qualification profiles budget the required full diagnostic suite", () => {
  for (const profileRef of [
    "scripts/live-e2e/profiles/full-journey-regress-ky-medium-codex.yaml",
    "scripts/live-e2e/profiles/full-journey-regress-ky-medium-anthropic.yaml",
  ]) {
    const { profile } = loadProofRunnerProfile({ hostRoot: repoRoot, profileRef });
    assert.equal(profile.live_e2e.target_command_timeout_sec, 1800);
  }
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
    assert.equal(loaded.document.runtime_defaults.workspace_mode, "workspace-clone");
    assert.equal(loaded.document.runtime_defaults.verification_command_timeout_sec, 1800);
    assert.deepEqual(loaded.document.repos[0].lint_commands, ["CI=1 npm install --prefer-offline --no-audit --no-fund"]);
    assert.deepEqual(loaded.document.repos[0].test_commands, [
      "CI=1 npx xo",
      "CI=1 npm run build",
      "CI=1 npx ava test/main.ts test/hooks.ts",
      "CI=1 npx ava test/retry.ts --match='*shouldRetry*'",
    ]);
    assert.deepEqual(resolved.mission.post_run_quality.diagnostic_commands, [
      "npx playwright install",
      "npm test -- --match='!*totalTimeout bounds a never-ending successful response body*'",
      "npx ava test/main.ts --match='totalTimeout bounds a never-ending successful response body'",
    ]);
    assert.equal(loaded.document.repos[0].test_commands.includes("npm test"), false);
    assert.equal(loaded.document.repos[0].lint_commands.includes("npx playwright install"), false);
  });
});

test("generated ky xlarge manual profile includes focused retry primary verification", () => {
  withTempRoot((tempRoot) => {
    const profileRef = "scripts/live-e2e/profiles/manual-xlarge-governance-ky-openai.yaml";
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
      runId: "ky-xlarge-openai-focused-retry-primary",
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
      "CI=1 npx xo",
      "CI=1 npm run build",
      "CI=1 npx ava test/main.ts test/hooks.ts",
      "CI=1 npx ava test/retry.ts --match='*shouldRetry*'",
    ]);
    assert.deepEqual(resolved.mission.post_run_quality.diagnostic_commands, [
      "npx playwright install",
      "npm test -- --match='!*totalTimeout bounds a never-ending successful response body*'",
      "npx ava test/main.ts --match='totalTimeout bounds a never-ending successful response body'",
    ]);
    assert.equal(resolved.mission.post_run_quality.diagnostic_failure_mode, "warn");
    assert.equal(loaded.document.repos[0].test_commands.includes("npm test"), false);
    assert.equal(loaded.document.repos[0].lint_commands.includes("npm test"), false);
  });
});

test("generated Vitest large profile isolates verification and checks hard-target setup before execution", () => {
  withTempRoot((tempRoot) => {
    const profileRef = "scripts/live-e2e/profiles/full-journey-regress-vitest-large-openai.yaml";
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
      runId: "vitest-large-hard-target-readiness",
      targetCheckout: {
        targetRepoId: "vitest",
        targetRepoRef: "main",
      },
      generatedAssetsRoot,
    });

    const loaded = loadContractFile({
      filePath: result.generatedProjectProfileFile,
      family: "project-profile",
    });

    assert.equal(loaded.ok, true);
    assert.equal(loaded.document.runtime_defaults.workspace_mode, "workspace-clone");
    assert.equal(loaded.document.target_toolchain.node.required_range, "^22.12.0 || ^24.0.0 || >=26.0.0");
    assert.equal(loaded.document.target_toolchain.node.env_override, "AOR_LIVE_E2E_TARGET_NODE_BIN");
    assert.equal(
      loaded.document.repos[0].lint_commands.some((command) =>
        command.includes("Vitest proof requires Node ^22.12.0 || ^24.0.0 || >=26.0.0"),
      ),
      true,
    );
    assert.equal(
      loaded.document.repos[0].lint_commands.some((command) =>
        command.includes("AOR_LIVE_E2E_TARGET_NODE_BIN") && command.includes("pnpm build"),
      ),
      true,
    );
    assert.equal(
      loaded.document.repos[0].test_commands.some((command) =>
        command.includes("AOR_LIVE_E2E_TARGET_NODE_BIN") && command.includes("pnpm test"),
      ),
      true,
    );
    assert.equal(
      loaded.document.repos[0].test_commands.some((command) =>
        command.includes("AOR_LIVE_E2E_TARGET_NODE_BIN") && command.includes("pnpm lint"),
      ),
      true,
    );
  });
});

test("SQLAlchemy large profile uses a short physical target checkout root", () => {
  const profileRef = "scripts/live-e2e/profiles/full-journey-regress-sqlalchemy-large-openai.yaml";
  const loadedProfile = loadProofRunnerProfile({ hostRoot: repoRoot, profileRef });
  const catalogRoot = resolveCatalogRoot({ hostRoot: repoRoot, catalogRootOverride: null });
  const target = loadCatalogTarget({ catalogRoot, targetCatalogId: "sqlalchemy" });
  const mission = target.entry.feature_missions.find(
    (entry) => entry.mission_id === "sqlalchemy-query-typing-regression",
  );

  assert.equal(loadedProfile.profile.live_e2e.target_checkout_root_mode, "short-physical");
  assert.ok(mission);
  assert.deepEqual(mission.post_run_quality.primary_commands, [
    ".aor/live-e2e-venv/bin/python -m pytest test/sql test/orm",
  ]);
  assert.deepEqual(mission.post_run_quality.diagnostic_commands, [
    ".aor/live-e2e-venv/bin/python -m pytest test",
  ]);
  assert.equal(mission.post_run_quality.diagnostic_failure_mode, "warn");
  assert.ok(
    mission.acceptance_checks.some((entry) =>
      entry.includes("full-suite diagnostic pytest must pass before product acceptance"),
    ),
  );
  assert.ok(
    mission.evaluator_rubric.evidence_expectations.some((entry) =>
      entry.includes("Diagnostic acceptance command") && entry.includes("warning evidence is not accepted closure"),
    ),
  );
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

    const nodeStepFile = writeJsonFixture(path.join(tempRoot, "node-step.json"), {
      status: "failed",
      command:
        "node -e \"console.error('Vitest proof requires Node ^22.12.0 || ^24.0.0 || >=26.0.0, got ' + process.version); process.exit(1)\"",
      summary: "Verification command failed: missing prerequisite(s) detected.",
      stderr: "Vitest proof requires Node ^22.12.0 || ^24.0.0 || >=26.0.0, got v25.9.0",
      evidence_refs: [writeJsonFixture(path.join(tempRoot, "node-transcript.json"))],
      command_timeout_ms: 120000,
      timed_out: false,
      missing_prerequisites: [],
    });
    const nodeReport = buildTargetPreExecutionStatusReport({
      verifySummary: { status: "failed", command_timeout_ms: 120000 },
      verifyPayload: { verify_summary_file: path.join(tempRoot, "verify-summary-node.json") },
      stepResultFiles: [nodeStepFile],
      setupCommands: [
        "node -e \"console.error('Vitest proof requires Node ^22.12.0 || ^24.0.0 || >=26.0.0, got ' + process.version); process.exit(1)\"",
      ],
      verificationCommands: ["pnpm test"],
      baselineGateDecision: { status: "fail", decision: "block", summary: "node-preflight-failed" },
      runResult: {
        durationSec: 1,
        timeoutMs: 300000,
        transcriptFile: path.join(tempRoot, "project-verify-node.json"),
      },
    });
    assert.equal(nodeReport.failure_owner, "environment");
    assert.equal(nodeReport.failure_phase, "target_setup");
    assert.equal(nodeReport.failure_class, "environment_node_version_unsupported");

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

test("baseline diagnostic verification recognizes target Node wrapped commands as warnings", () => {
  withTempRoot((tempRoot) => {
    const routedDryRunFile = writeJsonFixture(path.join(tempRoot, "routed-dry-run.json"), {
      status: "passed",
    });
    const verificationStepFile = writeJsonFixture(path.join(tempRoot, "wrapped-verify-step.json"), {
      status: "failed",
      command:
        '[ -z "${AOR_LIVE_E2E_TARGET_NODE_BIN:-}" ] || export PATH="$(dirname "$AOR_LIVE_E2E_TARGET_NODE_BIN"):$PATH"; pnpm test',
      summary:
        'Verification command \'[ -z "${AOR_LIVE_E2E_TARGET_NODE_BIN:-}" ] || export PATH="$(dirname "$AOR_LIVE_E2E_TARGET_NODE_BIN"):$PATH"; pnpm test\' failed with exit code 1.',
      evidence_refs: [writeJsonFixture(path.join(tempRoot, "wrapped-verify-transcript.json"))],
      command_timeout_ms: 1800000,
      timed_out: false,
      missing_prerequisites: [],
    });

    const gate = evaluateBaselineVerifyGate({
      verifySummary: { status: "failed", command_timeout_ms: 1800000, validation_gate_status: "pass" },
      verifyPayload: {
        verify_summary_file: path.join(tempRoot, "verify-summary.json"),
        routed_step_result_file: routedDryRunFile,
      },
      stepResultFiles: [verificationStepFile],
      setupCommands: ["pnpm install --frozen-lockfile", "pnpm build"],
      verificationCommands: ["pnpm test", "pnpm lint"],
      mode: "diagnostic",
    });

    assert.equal(gate.status, "warn");
    assert.equal(gate.decision, "continue_with_warnings");
    assert.deepEqual(gate.blocking_reasons, []);
    assert.equal(gate.failed_commands.length, 1);

    const report = buildTargetPreExecutionStatusReport({
      verifySummary: { status: "failed", command_timeout_ms: 1800000 },
      verifyPayload: { verify_summary_file: path.join(tempRoot, "verify-summary.json") },
      stepResultFiles: [verificationStepFile],
      setupCommands: ["pnpm install --frozen-lockfile", "pnpm build"],
      verificationCommands: ["pnpm test", "pnpm lint"],
      baselineGateDecision: gate,
      runResult: { durationSec: 33, timeoutMs: 9060000, transcriptFile: path.join(tempRoot, "project-verify.json") },
    });

    assert.equal(report.status, "warn");
    assert.equal(report.failure_owner, null);
    assert.equal(report.target_verification_status.status, "warn");
    assert.equal(report.target_verification_status.failure_owner, null);
    assert.equal(report.target_verification_status.warning_reason.includes("pnpm test"), true);
  });
});

test("baseline blocking verification keeps target Node wrapped command failures as blockers", () => {
  withTempRoot((tempRoot) => {
    const routedDryRunFile = writeJsonFixture(path.join(tempRoot, "routed-dry-run.json"), {
      status: "passed",
    });
    const verificationStepFile = writeJsonFixture(path.join(tempRoot, "wrapped-verify-step.json"), {
      status: "failed",
      command:
        '[ -z "${AOR_LIVE_E2E_TARGET_NODE_BIN:-}" ] || export PATH="$(dirname "$AOR_LIVE_E2E_TARGET_NODE_BIN"):$PATH"; pnpm test',
      summary:
        'Verification command \'[ -z "${AOR_LIVE_E2E_TARGET_NODE_BIN:-}" ] || export PATH="$(dirname "$AOR_LIVE_E2E_TARGET_NODE_BIN"):$PATH"; pnpm test\' failed with exit code 1.',
      evidence_refs: [writeJsonFixture(path.join(tempRoot, "wrapped-verify-transcript.json"))],
      command_timeout_ms: 1800000,
      timed_out: false,
      missing_prerequisites: [],
    });

    const gate = evaluateBaselineVerifyGate({
      verifySummary: { status: "failed", command_timeout_ms: 1800000, validation_gate_status: "pass" },
      verifyPayload: {
        verify_summary_file: path.join(tempRoot, "verify-summary.json"),
        routed_step_result_file: routedDryRunFile,
      },
      stepResultFiles: [verificationStepFile],
      setupCommands: ["pnpm install --frozen-lockfile", "pnpm build"],
      verificationCommands: ["pnpm test", "pnpm lint"],
      mode: "blocking",
    });

    assert.equal(gate.status, "fail");
    assert.equal(gate.decision, "block");
    assert.equal(gate.failure_owner, "target_repository");
    assert.equal(gate.failure_phase, "target_verification");
    assert.equal(gate.failure_class, "target_verification_blocked");

    const report = buildTargetPreExecutionStatusReport({
      verifySummary: { status: "failed", command_timeout_ms: 1800000 },
      verifyPayload: { verify_summary_file: path.join(tempRoot, "verify-summary.json") },
      stepResultFiles: [verificationStepFile],
      setupCommands: ["pnpm install --frozen-lockfile", "pnpm build"],
      verificationCommands: ["pnpm test", "pnpm lint"],
      baselineGateDecision: gate,
      runResult: { durationSec: 33, timeoutMs: 9060000, transcriptFile: path.join(tempRoot, "project-verify.json") },
    });

    assert.equal(report.status, "blocked");
    assert.equal(report.failure_owner, "target_repository");
    assert.equal(report.failure_phase, "target_verification");
    assert.equal(report.failure_class, "target_verification_blocked");
    assert.equal(report.target_verification_status.status, "blocked");
    assert.equal(report.target_verification_status.failure_owner, "target_repository");
    assert.equal(report.target_verification_status.failure_phase, "target_verification");
    assert.equal(report.target_verification_status.failure_class, "target_verification_blocked");
  });
});

test("target toolchain preflight blocks incompatible Node before target commands", () => {
  withTempRoot((tempRoot) => {
    assert.equal(nodeVersionSatisfiesRequiredRange("22.12.0", "^22.12.0 || ^24.0.0 || >=26.0.0"), true);
    assert.equal(nodeVersionSatisfiesRequiredRange("24.1.0", "^22.12.0 || ^24.0.0 || >=26.0.0"), true);
    assert.equal(nodeVersionSatisfiesRequiredRange("25.9.0", "^22.12.0 || ^24.0.0 || >=26.0.0"), false);
    assert.equal(nodeVersionSatisfiesRequiredRange("26.0.0", "^22.12.0 || ^24.0.0 || >=26.0.0"), true);

    const fakeNode = path.join(tempRoot, "fake-node");
    fs.writeFileSync(fakeNode, "#!/bin/sh\necho 25.9.0\n", "utf8");
    fs.chmodSync(fakeNode, 0o755);
    const result = evaluateTargetToolchainPreflight({
      profile: {
        target_toolchain: {
          node: {
            required_range: "^22.12.0 || ^24.0.0 || >=26.0.0",
            env_override: "AOR_LIVE_E2E_TARGET_NODE_BIN",
          },
        },
      },
      env: {
        ...process.env,
        AOR_LIVE_E2E_TARGET_NODE_BIN: fakeNode,
      },
      reportsRoot: tempRoot,
      runId: "toolchain-preflight-node-block",
    });

    assert.equal(result.status, "blocked");
    assert.equal(result.report.failure_owner, "environment");
    assert.equal(result.report.failure_phase, "target_setup");
    assert.equal(result.report.failure_class, "environment_node_version_unsupported");
    assert.equal(result.report.selected_binary, fakeNode);
    assert.equal(result.report.observed_version, "25.9.0");
    assert.equal(fs.existsSync(result.reportFile), true);
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
        "    model_argument:",
        "      prefix_args: [--]",
        "      flag: --model",
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
        "    model_argument:",
        "      prefix_args: [--]",
        "      flag: --model",
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
        "    model_argument:",
        "      prefix_args: [--]",
        "      flag: --model",
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
        "    model_argument:",
        "      prefix_args: [--]",
        "      flag: --model",
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

test("target checkout materialization pins one validated commit for the whole matrix", () => {
  withTempRoot((tempRoot) => {
    const sourceRepo = path.join(tempRoot, "source-repo");
    fs.mkdirSync(sourceRepo, { recursive: true });
    fs.writeFileSync(path.join(sourceRepo, "README.md"), "first\n", "utf8");
    for (const args of [["init", "-b", "main"], ["config", "user.email", "aor@example.com"], ["config", "user.name", "AOR Test"], ["add", "README.md"], ["commit", "-m", "first"]]) {
      const result = spawnSync("git", args, { cwd: sourceRepo, encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr || result.stdout);
    }
    const pinned = spawnSync("git", ["rev-parse", "HEAD"], { cwd: sourceRepo, encoding: "utf8" }).stdout.trim();
    fs.writeFileSync(path.join(sourceRepo, "README.md"), "second\n", "utf8");
    spawnSync("git", ["commit", "-am", "second"], { cwd: sourceRepo, encoding: "utf8" });
    const previous = process.env.AOR_LIVE_E2E_TARGET_COMMIT;
    process.env.AOR_LIVE_E2E_TARGET_COMMIT = pinned;
    try {
      const checkout = materializeTargetCheckout({
        hostRoot: tempRoot,
        layout: { targetCheckoutsRoot: path.join(tempRoot, "checkouts") },
        runId: "pinned-target",
        profile: { target_repo: { repo_id: "target", repo_url: sourceRepo, ref: "main", checkout_strategy: "full" } },
      });
      assert.equal(checkout.targetCommitSha, pinned);
      assert.equal(fs.readFileSync(path.join(checkout.targetCheckoutRoot, "README.md"), "utf8"), "first\n");
    } finally {
      if (previous === undefined) delete process.env.AOR_LIVE_E2E_TARGET_COMMIT;
      else process.env.AOR_LIVE_E2E_TARGET_COMMIT = previous;
    }
  });
});

test("target checkout pin rejects abbreviated or malformed commit identities", () => {
  const previous = process.env.AOR_LIVE_E2E_TARGET_COMMIT;
  process.env.AOR_LIVE_E2E_TARGET_COMMIT = "deadbeef";
  try {
    assert.throws(() => materializeTargetCheckout({
      hostRoot: repoRoot,
      layout: { targetCheckoutsRoot: path.join(os.tmpdir(), "unused-aor-checkouts") },
      runId: "invalid-pin",
      profile: { target_repo: { repo_id: "target", repo_url: repoRoot, ref: "main" } },
    }), /full lowercase Git commit SHA/u);
  } finally {
    if (previous === undefined) delete process.env.AOR_LIVE_E2E_TARGET_COMMIT;
    else process.env.AOR_LIVE_E2E_TARGET_COMMIT = previous;
  }
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
  assert.match(flowsSource, /providerVariantId: asNonEmptyString\(options\.profile\.provider_variant_id\)/u);
  assert.match(flowsSource, /const providerRoutes = hostAssets\.providerRoutes/u);
  assert.match(flowsSource, /const providerPolicies = hostAssets\.providerPolicies/u);
  assert.match(flowsSource, /--policy-overrides/u);
});

test("live E2E post-run verification selects generic project-profile command groups", () => {
  const flowsSource = fs.readFileSync(path.join(repoRoot, "scripts/live-e2e/lib/flows.mjs"), "utf8");
  assert.match(
    flowsSource,
    /runCommand\("project-verify-post-run-primary", \[[\s\S]*?"--project-profile",\s+generatedProfile\.generatedProjectProfileFile,[\s\S]*?"--execution-root",\s+latestExecutionRoot,[\s\S]*?"--verification-label",\s+"post-run-primary"/u,
  );
  assert.match(
    flowsSource,
    /runCommand\("project-verify-post-run-diagnostic", \[[\s\S]*?"--project-profile",\s+generatedProfile\.generatedProjectProfileFile,[\s\S]*?"--execution-root",\s+latestExecutionRoot,[\s\S]*?"--verification-label",\s+"post-run-diagnostic"/u,
  );
  assert.match(flowsSource, /diagnosticIntent: POST_RUN_DIAGNOSTIC_INTENT/u);
  assert.match(
    flowsSource,
    /verificationCommands: postRunQualityPolicy\.diagnosticCommands/u,
  );
  assert.doesNotMatch(flowsSource, /label\.includes\(["']diagnostic["']\)/u);
  assert.doesNotMatch(flowsSource, /buildVerifyOverrideArgs/u);
  assert.doesNotMatch(flowsSource, /applyTargetToolchainPolicyToOverrideCommands/u);
});

test("live E2E handoff approval preserves the generated project profile context", () => {
  assert.deepEqual(buildHandoffApprovalArgs({
    projectProfileFile: "/tmp/generated-project.yaml",
    handoffPacketFile: "/tmp/runtime/handoff.json",
    approvalRef: "approval://qualification/run",
  }), [
    "handoff",
    "approve",
    "--project-ref",
    ".",
    "--project-profile",
    "/tmp/generated-project.yaml",
    "--runtime-root",
    ".aor",
    "--handoff-packet",
    "/tmp/runtime/handoff.json",
    "--approval-ref",
    "approval://qualification/run",
  ]);
});

test("live E2E derives canonical public run ids from qualification ids", () => {
  assert.equal(
    deriveRuntimeRunId("live-e2e-ky-medium-codex-20260718T080810Z"),
    "live-e2e-ky-medium-codex-20260718t080810z",
  );
  assert.equal(
    deriveRuntimeRunId("live-e2e-ky-medium-codex-20260718T080810Z", 2),
    "live-e2e-ky-medium-codex-20260718t080810z.repair-2",
  );
});

test("guided flow identity accepts opaque public packet ids", () => {
  withTempRoot((tempRoot) => {
    const packetFile = path.join(tempRoot, "packet-9b3a0478705a1cbe3cd169fb4cdaec11.json");
    fs.writeFileSync(
      packetFile,
      `${JSON.stringify({
        packet_id: "packet-9b3a0478705a1cbe3cd169fb4cdaec11",
        project_id: "github-sandbox.run.qualification",
        invocation_context: {
          mission_id: "header-regression-follow-up",
        },
      }, null, 2)}\n`,
      "utf8",
    );

    assert.deepEqual(resolveFlowIdentityFromPacket(tempRoot, packetFile), {
      flowId: "flow.github-sandbox.run.qualification.header-regression-follow-up",
      projectId: "github-sandbox.run.qualification",
      missionId: "header-regression-follow-up",
    });
  });
});

test("guided follow-up identity stays inside the public flow-id boundary", () => {
  const projectId = "github-sandbox.run.w66-guided-ui-20260720t150129-f42f572";
  const missionId = deriveGuidedFollowUpMissionId({
    projectId,
    missionId: "ky-header-regression",
    runId: "w66-guided-ui-20260720t150129-f42f572",
  });
  const flowId = `flow.${projectId}.${missionId}`;

  assert.match(missionId, /^ky-header-regression-follow-up-[a-f0-9]{12}$/u);
  assert.ok(flowId.length <= 128, `Expected bounded flow id, received ${flowId.length} characters.`);
  assert.equal(
    missionId,
    deriveGuidedFollowUpMissionId({
      projectId,
      missionId: "ky-header-regression",
      runId: "w66-guided-ui-20260720t150129-f42f572",
    }),
  );
  assert.notEqual(
    missionId,
    deriveGuidedFollowUpMissionId({
      projectId,
      missionId: "ky-header-regression",
      runId: "w66-guided-ui-20260720t150130-f42f572",
    }),
  );
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

test("guided journey proof recovers an installed mission command from durable resume transcripts", () => {
  withTempRoot((tempRoot) => {
    const fixture = writeGuidedProofFixture(tempRoot);
    const runId = "w34-flow-loop";
    const transcriptRoot = path.join(fixture.reportsRoot, `live-e2e-command-traces-${runId}`);
    fs.mkdirSync(transcriptRoot, { recursive: true });
    const missionTranscript = path.join(transcriptRoot, "06-mission-create.json");
    writeJsonFixture(missionTranscript, {
      label: "mission-create",
      exit_code: 0,
      timed_out: false,
      parsed_json: {
        artifact_packet_file: fixture.artifacts.intake_artifact_packet_file,
        artifact_packet_body_file: fixture.artifacts.intake_artifact_packet_body_file,
      },
    });

    const proof = buildGuidedJourneyProof({
      runId,
      profile: {
        profile_id: "live-e2e.installed-user.guided-journey",
        output_policy: { write_back_to_remote: false, preferred_delivery_mode: "patch-only" },
      },
      commandResults: fixture.commandResults.filter((entry) => entry.label !== "mission-create"),
      artifacts: fixture.artifacts,
      targetCheckoutRoot: fixture.targetCheckoutRoot,
      reportsRoot: fixture.reportsRoot,
      targetHeadBefore: "0000000000000000000000000000000000000000",
      targetHeadAfter: "0000000000000000000000000000000000000000",
      targetGitStatusWithoutRuntime: [],
    });

    assert.ok(proof.command_labels.includes("mission-create"));
    assert.ok(proof.command_transcript_files.includes(missionTranscript));
    assert.deepEqual(validateGuidedJourneyProof(proof, { targetCheckoutRoot: fixture.targetCheckoutRoot }), []);
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
    const earlyNormalizedRunId = `${normalizedRunId}.early-ui`;
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
    const earlyBrowserTaskProofFile = path.join(
      reportsRoot,
      `installed-user-guided-browser-task-proof-${earlyNormalizedRunId}.json`,
    );
    const earlyScreenshotFile = path.join(
      reportsRoot,
      `installed-user-guided-browser-task-proof-${earlyNormalizedRunId}.png`,
    );
    fs.writeFileSync(earlyScreenshotFile, "png", "utf8");
    const earlyKeyboardFocusSequence = [
      { index: 1, role: "button", label: "New Flow", selector: "button.new-flow-button" },
      { index: 2, role: "button", label: "Ask AOR", selector: "button.topbar-ask-button" },
    ];
    const earlyWebSmokeSummaryFile = writeJsonFixture(
      path.join(reportsRoot, `installed-user-guided-web-smoke-${earlyNormalizedRunId}.json`),
      {
        summary_file: path.join(reportsRoot, `installed-user-guided-web-smoke-${earlyNormalizedRunId}.json`),
        rendered_html_file: path.join(reportsRoot, `installed-user-guided-web-smoke-${earlyNormalizedRunId}.html`),
        dom_snapshot_file: path.join(reportsRoot, `installed-user-guided-web-smoke-dom-${earlyNormalizedRunId}.json`),
        accessibility_summary_file: path.join(
          reportsRoot,
          `installed-user-guided-web-smoke-accessibility-${earlyNormalizedRunId}.json`,
        ),
        visual_guardrail_file: path.join(
          reportsRoot,
          `installed-user-guided-web-smoke-visual-guardrail-${earlyNormalizedRunId}.json`,
        ),
        browser_task_proof_request_file: path.join(
          reportsRoot,
          `installed-user-guided-browser-task-proof-request-${earlyNormalizedRunId}.json`,
        ),
        browser_task_proof_file: earlyBrowserTaskProofFile,
        screenshot_files: [earlyScreenshotFile],
        keyboard_focus_sequence: earlyKeyboardFocusSequence,
        accessibility_checks: buildAccessibilityChecks(earlyScreenshotFile),
        task_outcome: {
          status: "pass",
          checked_tasks: ["early browser-task evidence capture"],
          findings: [],
        },
        ux_findings: ["Initial AOR mission and next-action UI was inspectable before implementation."],
        html_loaded: true,
        flow_selector_loaded: true,
        new_flow_action_loaded: true,
        guided_lifecycle_state: "smoke-pass",
        detached: true,
      },
    );
    writeJsonFixture(path.join(reportsRoot, `installed-user-guided-browser-task-proof-request-${earlyNormalizedRunId}.json`), {
      expected_browser_task_proof_file: earlyBrowserTaskProofFile,
    });
    writeJsonFixture(earlyBrowserTaskProofFile, {
      status: "pass",
      rendered_html_file: path.join(reportsRoot, `installed-user-guided-web-smoke-${earlyNormalizedRunId}.html`),
      dom_snapshot_file: path.join(reportsRoot, `installed-user-guided-web-smoke-dom-${earlyNormalizedRunId}.json`),
      accessibility_summary_file: path.join(
        reportsRoot,
        `installed-user-guided-web-smoke-accessibility-${earlyNormalizedRunId}.json`,
      ),
      visual_guardrail_file: path.join(
        reportsRoot,
        `installed-user-guided-web-smoke-visual-guardrail-${earlyNormalizedRunId}.json`,
      ),
      screenshot_files: [earlyScreenshotFile],
      keyboard_focus_sequence: earlyKeyboardFocusSequence,
      accessibility_checks: buildAccessibilityChecks(earlyScreenshotFile),
      task_outcome: {
        status: "pass",
        checked_tasks: ["early browser-task evidence capture"],
        findings: [],
      },
      ux_findings: ["Initial AOR mission and next-action UI was inspectable before implementation."],
    });
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
    writeJsonFixture(files["delivery-manifest.json"], {
      delivery_mode: "patch-only",
      writeback_policy: {
        allow_remote_push: false,
      },
      repo_deliveries: [
        {
          repo_id: "sindresorhus/ky",
          role: "target",
          changed_paths: [],
          writeback_result: "patch-materialized",
          commit_refs: [],
          patch_file: path.join(reportsRoot, "delivery.patch"),
        },
      ],
    });
    writeJsonFixture(files["learning-scorecard.json"], {
      status: "pass",
      evidence_refs: ["evidence://learning/scorecard"],
      linked_backlog_refs: ["backlog://W52-S10"],
      linked_eval_suite_refs: ["suite.live-e2e.w52"],
      coverage_follow_up: {
        current_cell_required: true,
        next_required_matrix_cell: {
          cell_id: "ky.regress.medium.openai",
        },
        remaining_required_matrix_cells: [
          {
            cell_id: "ky.regress.medium.openai",
          },
        ],
      },
    });
    writeJsonFixture(files["learning-handoff.json"], {
      run_status: "pass",
      backlog_refs: ["backlog://W52-S10"],
      quality_refs: ["quality://live-e2e/w52"],
      evidence_refs: ["evidence://learning/handoff"],
      next_actions: ["Keep W52 evidence matrix attached to the proof findings."],
      coverage_follow_up: {
        current_cell_required: true,
        next_required_matrix_cell: {
          cell_id: "ky.regress.medium.openai",
        },
        remaining_required_matrix_cells: [
          {
            cell_id: "ky.regress.medium.openai",
          },
        ],
      },
    });
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
    fs.writeFileSync(path.join(reportsRoot, `installed-user-guided-web-smoke-${earlyNormalizedRunId}.html`), "<main>AOR early</main>\n", "utf8");
    writeJsonFixture(path.join(reportsRoot, `installed-user-guided-web-smoke-dom-${earlyNormalizedRunId}.json`));
    writeJsonFixture(path.join(reportsRoot, `installed-user-guided-web-smoke-accessibility-${earlyNormalizedRunId}.json`));
    writeJsonFixture(path.join(reportsRoot, `installed-user-guided-web-smoke-visual-guardrail-${earlyNormalizedRunId}.json`));
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
        early_guided_web_smoke: JSON.parse(fs.readFileSync(earlyWebSmokeSummaryFile, "utf8")),
        early_guided_web_smoke_summary_file: earlyWebSmokeSummaryFile,
        early_guided_web_smoke_html_file: path.join(reportsRoot, `installed-user-guided-web-smoke-${earlyNormalizedRunId}.html`),
        early_guided_web_dom_snapshot_file: path.join(reportsRoot, `installed-user-guided-web-smoke-dom-${earlyNormalizedRunId}.json`),
        early_guided_web_accessibility_summary_file: path.join(
          reportsRoot,
          `installed-user-guided-web-smoke-accessibility-${earlyNormalizedRunId}.json`,
        ),
        early_guided_web_visual_guardrail_file: path.join(
          reportsRoot,
          `installed-user-guided-web-smoke-visual-guardrail-${earlyNormalizedRunId}.json`,
        ),
        early_guided_web_screenshot_files: [earlyScreenshotFile],
        early_guided_browser_task_proof_request_file: path.join(
          reportsRoot,
          `installed-user-guided-browser-task-proof-request-${earlyNormalizedRunId}.json`,
        ),
        early_guided_browser_task_proof_file: earlyBrowserTaskProofFile,
        early_guided_browser_task_app_server_cleanup: {
          status: "terminated",
          pid: 12345,
          terminated_at: "2026-06-09T00:00:00.500Z",
        },
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

    const runControlState = JSON.parse(fs.readFileSync(written.runControlStateFile, "utf8"));
    assert.equal(runControlState.run_id, runId);
    assert.equal(runControlState.last_action, "external-runner-status");
    assert.ok(runControlState.evidence_refs.includes(written.summaryFile));
    assert.equal(written.summary.run_control_state_file, written.runControlStateFile);

    const observationReport = JSON.parse(fs.readFileSync(written.summary.live_e2e_observation_report_file, "utf8"));
    const earlyInteraction = observationReport.frontend_interactions.find(
      (entry) => entry.interaction_id === "early-guided-ui-proof",
    );
    const fullInteraction = observationReport.frontend_interactions.find(
      (entry) => entry.interaction_id === "guided-web-smoke",
    );
    assert.equal(observationReport.frontend_interactions.length, 2);
    assert.equal(earlyInteraction.task_outcome.status, "pass");
    assert.equal(earlyInteraction.browser_task_proof_ref, earlyBrowserTaskProofFile);
    assert.equal(fullInteraction.task_outcome.status, "not_pass");
    assert.equal(written.summary.feature_request_file, files["feature-request.json"]);
    assert.equal(written.summary.guided_web_smoke_summary_file, webSmokeSummaryFile);
    assert.equal(written.summary.guided_browser_task_proof_file, null);
    assert.equal(written.summary.early_guided_web_smoke_summary_file, earlyWebSmokeSummaryFile);
    assert.equal(written.summary.early_guided_browser_task_proof_file, earlyBrowserTaskProofFile);
    assert.equal(written.summary.guided_ui_evidence.early_guided_browser_task_proof_file, earlyBrowserTaskProofFile);
    assert.equal(written.summary.guided_ui_evidence.early_browser_task_proof_present, true);
    assert.equal(written.runHealthReport.overall_status, "blocked");
    assert.equal(written.runHealthReport.evidence_health.status, "blocked");
    assert.equal(written.runHealthReport.evidence_health.weak_evidence_refs.includes("guided-browser-task-proof"), true);
    assert.equal(written.runHealthReport.guided_ui_evidence.early_guided_browser_task_proof_file, earlyBrowserTaskProofFile);
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
      visual_guardrail_file: path.join(
        reportsRoot,
        `installed-user-guided-web-smoke-visual-guardrail-${normalizedRunId}.json`,
      ),
      screenshot_files: [screenshotFile],
      task_outcome: {
        status: "pass",
        checked_tasks: ["browser-task evidence capture"],
        findings: [],
      },
    });

    const missingAccessibilityChecks = writeProofRunnerArtifacts(writeOptions);
    assert.equal(missingAccessibilityChecks.runHealthReport.overall_status, "blocked");
    assert.equal(
      missingAccessibilityChecks.runHealthReport.evidence_health.weak_evidence_refs.includes(
        "browser-task-proof.accessibility_checks.keyboard_navigation",
      ),
      true,
    );

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
      keyboard_focus_sequence: [
        { index: 1, role: "button", label: "New Flow", selector: "button.new-flow-button" },
        { index: 2, role: "button", label: "Ask AOR", selector: "button.topbar-ask-button" },
      ],
      accessibility_checks: buildAccessibilityChecks(screenshotFile),
      task_outcome: {
        status: "pass",
        checked_tasks: ["browser-task evidence capture", "operator task interaction"],
        findings: [],
      },
      ux_findings: ["The AOR operator flow selector and next action were inspectable."],
    });

    const hydrated = writeProofRunnerArtifacts(writeOptions);
    const hydratedObservation = JSON.parse(fs.readFileSync(hydrated.summary.live_e2e_observation_report_file, "utf8"));
    const hydratedEarlyInteraction = hydratedObservation.frontend_interactions.find(
      (entry) => entry.interaction_id === "early-guided-ui-proof",
    );
    const hydratedFullInteraction = hydratedObservation.frontend_interactions.find(
      (entry) => entry.interaction_id === "guided-web-smoke",
    );
    const hydratedWebSmoke = JSON.parse(fs.readFileSync(webSmokeSummaryFile, "utf8"));
    assert.equal(hydratedObservation.frontend_interactions.length, 2);
    assert.equal(hydrated.summary.guided_browser_task_proof_file, browserTaskProofFile);
    assert.equal(hydrated.summary.guided_ui_evidence.status, "pass");
    assert.equal(hydrated.summary.guided_ui_evidence.guided_browser_task_proof_file, browserTaskProofFile);
    assert.equal(hydrated.summary.guided_ui_evidence.early_guided_browser_task_proof_file, earlyBrowserTaskProofFile);
    assert.equal(hydratedEarlyInteraction.browser_task_proof_ref, earlyBrowserTaskProofFile);
    assert.equal(hydratedFullInteraction.task_outcome.status, "pass");
    assert.equal(hydratedFullInteraction.browser_task_proof_ref, browserTaskProofFile);
    assert.equal(hydratedObservation.guided_ui_evidence.status, "pass");
    assert.equal(hydratedObservation.guided_ui_evidence.guided_browser_task_proof_file, browserTaskProofFile);
    assert.equal(hydratedObservation.guided_ui_evidence.early_guided_browser_task_proof_file, earlyBrowserTaskProofFile);
    assert.deepEqual(hydratedFullInteraction.screenshot_refs, [screenshotFile]);
    assert.equal(hydratedFullInteraction.keyboard_focus_sequence.length, 2);
    assert.equal(hydratedWebSmoke.keyboard_focus_sequence.length, 2);
    assert.deepEqual(
      hydratedFullInteraction.accessibility_checks.map((entry) => entry.check_id),
      aorOperatorAccessibilityCheckIds,
    );
    assert.equal(hydratedWebSmoke.task_outcome.status, "pass");
    assert.equal(hydratedWebSmoke.browser_task_proof_file, browserTaskProofFile);
    assert.deepEqual(hydratedWebSmoke.screenshot_files, [screenshotFile]);
    assert.equal(
      hydratedWebSmoke.ux_findings.some((finding) =>
        /browser-task-proof requires skill-agent browser evidence/iu.test(finding),
      ),
      false,
    );
    assert.equal(hydrated.runHealthReport.guided_ui_evidence.status, "pass");
    assert.equal(hydrated.runHealthReport.guided_ui_evidence.guided_browser_task_proof_file, browserTaskProofFile);
    assert.equal(hydrated.runHealthReport.overall_status, "pass");
    assert.equal(hydrated.summary.delivery_manifest_summary.delivery_mode, "patch-only");
    assert.equal(hydrated.summary.delivery_manifest_summary.patch_only, true);
    assert.equal(hydrated.summary.delivery_manifest_summary.write_back_to_remote, false);
    assert.equal(hydrated.summary.delivery_manifest_summary.changed_path_count, 0);
    assert.deepEqual(hydrated.summary.delivery_manifest_summary.writeback_results, ["patch-materialized"]);
    assert.equal(hydrated.summary.delivery_manifest_summary.repo_deliveries[0].changed_path_count, 0);
    assert.equal(hydrated.summary.delivery_manifest_summary.no_upstream_write_evidence.status, "pass");
    assert.equal(hydrated.summary.learning_handoff_summary.scorecard_status, "pass");
    assert.equal(hydrated.summary.learning_handoff_summary.handoff_run_status, "pass");
    assert.deepEqual(hydrated.summary.learning_handoff_summary.backlog_refs, ["backlog://W52-S10"]);
    assert.equal(hydrated.summary.learning_handoff_summary.next_actions.length, 1);
    assert.equal(hydrated.summary.learning_handoff_summary.remaining_required_matrix_cell_count, 1);
    assert.equal(hydratedObservation.final_analysis.delivery.changed_path_count, 0);
    assert.deepEqual(hydratedObservation.final_analysis.learning.backlog_refs, ["backlog://W52-S10"]);

    const diagnosticStepResultFile = path.join(reportsRoot, "guided-post-run-diagnostic-step-result.json");
    const diagnosticSummaryFile = path.join(reportsRoot, "guided-post-run-diagnostic-summary.json");
    const diagnosticTranscriptFile = path.join(reportsRoot, "guided-post-run-diagnostic-transcript.json");
    writeJsonFixture(diagnosticStepResultFile, {
      status: "failed",
      command: "npm test",
      repo_scope: "sindresorhus/ky",
      timed_out: false,
      summary: "Timing-sensitive diagnostic command failed.",
    });
    writeJsonFixture(diagnosticSummaryFile, {
      status: "failed",
      step_result_refs: [diagnosticStepResultFile],
    });
    writeOptions.flowResult.artifacts.post_run_quality_policy = {
      diagnostic_failure_mode: "warn",
      diagnostic_commands: ["npm test"],
    };
    writeOptions.flowResult.artifacts.post_run_diagnostic_status = "warn";
    writeOptions.flowResult.artifacts.post_run_diagnostic_transcript_file = diagnosticTranscriptFile;
    writeOptions.flowResult.artifacts.post_run_diagnostic_verify_summary_file = diagnosticSummaryFile;
    writeOptions.flowResult.artifacts.post_run_diagnostic_verify_step_result_files = [diagnosticStepResultFile];
    writeJsonFixture(diagnosticTranscriptFile, {
      label: "project-verify-post-run-diagnostic",
      status: "failed",
      timed_out: true,
      stdout: "diagnostic terminal output before pipe wait",
      stderr: "waiting on diagnostic pipe",
    });

    const hydratedWithDiagnosticWarn = writeProofRunnerArtifacts(writeOptions);
    assert.equal(hydratedWithDiagnosticWarn.runHealthReport.guided_ui_evidence.status, "pass");
    assert.equal(hydratedWithDiagnosticWarn.runHealthReport.diagnostic_health.status, "warn");
    assert.equal(hydratedWithDiagnosticWarn.runHealthReport.diagnostic_health.timed_out_command_count, 1);
    assert.equal(
      hydratedWithDiagnosticWarn.runHealthReport.diagnostic_health.timed_out_commands[0].step_result_ref,
      diagnosticTranscriptFile,
    );
    assert.equal(
      hydratedWithDiagnosticWarn.runHealthReport.diagnostic_health.timed_out_commands[0].failure_owner,
      "target_repository",
    );
    assert.equal(
      hydratedWithDiagnosticWarn.runHealthReport.diagnostic_health.timed_out_commands[0].diagnostic_intent,
      "post-run-diagnostic",
    );
    assert.equal(
      hydratedWithDiagnosticWarn.runHealthReport.diagnostic_health.timed_out_commands[0].failure_phase,
      "target_verification",
    );
    assert.equal(
      hydratedWithDiagnosticWarn.runHealthReport.diagnostic_health.timed_out_commands[0].failure_class,
      "post_run_diagnostic_timeout",
    );
    assert.equal(
      hydratedWithDiagnosticWarn.runHealthReport.diagnostic_health.evidence_refs.includes(diagnosticTranscriptFile),
      true,
    );
    assert.equal(hydratedWithDiagnosticWarn.runHealthReport.overall_status, "warn");
    assert.equal(hydratedWithDiagnosticWarn.runHealthReport.failure_summary.class, "post_run_diagnostic_warning");
  });
});

test("proof runner blocks incomplete declared full lifecycle before claiming observation pass", () => {
  withTempRoot((tempRoot) => {
    const reportsRoot = path.join(tempRoot, "reports");
    const runtimeRoot = path.join(tempRoot, "runtime");
    const targetCheckoutRoot = path.join(tempRoot, "target");
    fs.mkdirSync(reportsRoot, { recursive: true });
    fs.mkdirSync(runtimeRoot, { recursive: true });
    fs.mkdirSync(targetCheckoutRoot, { recursive: true });

    const runId = "incomplete-full-lifecycle";
    const observedSteps = ["discovery", "spec", "planning", "handoff", "execution", "review", "qa"];
    const allSteps = [...observedSteps, "delivery", "release", "learning"];
    const files = Object.fromEntries(
      [
        "controller-state.json",
        "install-proof.json",
        "target-checkout.txt",
        ...observedSteps.map((step) => `${step}-artifact.json`),
      ].map((name) => [name, path.join(reportsRoot, name)]),
    );
    for (const file of Object.values(files)) writeJsonFixture(file);

    const stepJournal = observedSteps.map((step, index) => ({
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
      deterministic_analysis: { status: "pass", exit_code: 0, failure_class: null, missing_evidence: [], recommendation: "continue" },
      semantic_analysis: { status: "pass", judge_source: "skill-agent", findings: [] },
      agent_decision_request_ref: files[`${step}-artifact.json`],
      operator_decision_ref: files[`${step}-artifact.json`],
      operator_decision_status: "accepted",
      inspected_evidence_refs: [files[`${step}-artifact.json`]],
      requested_interaction: null,
      decision: { action: "continue", reason: "Accepted test evidence." },
      resume_result: null,
      frontend_interaction_refs: [],
      final_step_verdict: "pass",
    }));

    writeJsonFixture(files["controller-state.json"], {
      current_step: null,
      completed_steps: observedSteps,
      included_steps: allSteps,
      pending_decision: null,
      artifacts_snapshot: {
        target_checkout_root: targetCheckoutRoot,
        provider_execution_status: "completed",
        feature_size: "small",
      },
    });

    const written = writeProofRunnerArtifacts({
      hostRoot: repoRoot,
      hostProjectId: "aor-test",
      layout: { reportsRoot, runtimeRoot },
      runId,
      profilePath: path.join(tempRoot, "profile.yaml"),
      profile: {
        profile_id: "live-e2e.test.incomplete-full-lifecycle",
        journey_mode: "full-journey",
        run_tier: "acceptance",
        target_catalog_id: "ky",
        feature_mission_id: "ky-header-regression",
        scenario_family: "regress",
        provider_variant_id: "openai-primary",
        stages: allSteps,
        live_e2e: {
          flow_range_policy: "full_lifecycle",
          frontend_capability: "none",
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
        stageResults: observedSteps.map((step) => ({
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

    const observationReport = JSON.parse(fs.readFileSync(written.summary.live_e2e_observation_report_file, "utf8"));
    assert.equal(observationReport.report_status, "in_progress");
    assert.equal(observationReport.overall_status, "blocked");
    assert.deepEqual(written.runHealthReport.lifecycle_completion.pending_steps, ["delivery", "release", "learning"]);
    assert.equal(written.runHealthReport.overall_status, "blocked");
    assert.equal(written.runHealthReport.failure_summary.class, "controller_incomplete");
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
      keepBrowserTaskAppSurface: false,
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
    assert.deepEqual(request.required_accessibility_checks, aorOperatorAccessibilityCheckIds);
    assert.match(request.instructions.join("\n"), /Open app_url, not smoke_app_url/u);
    assert.ok(Number.isInteger(request.app_server_pid));
    assert.equal(result.summary.browser_task_app_url, "http://127.0.0.1:61002/");
    assert.equal(result.summary.browser_task_app_server_cleanup.status, "terminated");
    assert.equal(result.browserTaskAppServerCleanup.status, "terminated");
  });
});

test("guided browser-task collector materializes proof through configured Python runtime", () => {
  withTempRoot((tempRoot) => {
    const reportsRoot = path.join(tempRoot, "reports");
    fs.mkdirSync(reportsRoot, { recursive: true });
    const fakePython = path.join(tempRoot, "fake-python.cjs");
    fs.writeFileSync(
      fakePython,
      [
        "#!/usr/bin/env node",
        "const fs = require('fs');",
        "const path = require('path');",
        "if (process.argv[2] === '-c') process.exit(0);",
        "const payload = JSON.parse(process.argv[3]);",
        "const evidenceRefs = [",
        "  payload.browser_task_proof_file,",
        "  payload.rendered_html_file,",
        "  payload.dom_snapshot_file,",
        "  payload.accessibility_summary_file,",
        "  payload.visual_guardrail_file,",
        "  payload.screenshot_file,",
        "];",
        "for (const file of evidenceRefs) fs.mkdirSync(path.dirname(file), { recursive: true });",
        "fs.writeFileSync(payload.rendered_html_file, '<main><button>New Flow</button><button>Ask AOR</button></main>\\n');",
        "fs.writeFileSync(payload.dom_snapshot_file, JSON.stringify({ status: 'pass' }, null, 2) + '\\n');",
        "fs.writeFileSync(payload.accessibility_summary_file, JSON.stringify({ status: 'pass' }, null, 2) + '\\n');",
        "fs.writeFileSync(payload.visual_guardrail_file, JSON.stringify({ status: 'pass' }, null, 2) + '\\n');",
        "fs.writeFileSync(payload.screenshot_file, 'png');",
        "const checks = [",
        "  'keyboard_navigation',",
        "  'focus_order',",
        "  'contrast_and_readability',",
        "  'semantic_structure',",
        "  'screen_reader_labels',",
        "  'accessible_error_feedback',",
        "].map((check_id) => ({ check_id, status: 'pass', evidence_refs: evidenceRefs, findings: [] }));",
        "const proof = {",
        "  status: 'pass',",
        "  proof_source: 'fake-python-guided-browser-task-collector',",
        "  env_playwright_browsers_path: process.env.PLAYWRIGHT_BROWSERS_PATH || null,",
        "  browser_task_proof_request_file: payload.browser_task_proof_request_file,",
        "  rendered_html_file: payload.rendered_html_file,",
        "  dom_snapshot_file: payload.dom_snapshot_file,",
        "  accessibility_summary_file: payload.accessibility_summary_file,",
        "  visual_guardrail_file: payload.visual_guardrail_file,",
        "  screenshot_files: [payload.screenshot_file],",
        "  keyboard_focus_sequence: [",
        "    { index: 1, role: 'button', label: 'New Flow', selector: 'button.new-flow-button' },",
        "    { index: 2, role: 'button', label: 'Ask AOR', selector: 'button.topbar-ask-button' },",
        "  ],",
        "  accessibility_checks: checks,",
        "  task_outcome: { status: 'pass', checked_tasks: ['browser-task evidence capture'], findings: [] },",
        "};",
        "fs.writeFileSync(payload.browser_task_proof_file, JSON.stringify(proof, null, 2) + '\\n');",
        "console.log(JSON.stringify({ status: 'pass', proof_file: payload.browser_task_proof_file }));",
        "",
      ].join("\n"),
      "utf8",
    );
    fs.chmodSync(fakePython, 0o755);

    const runId = "guided-collector";
    const result = collectGuidedBrowserTaskProof({
      enabled: true,
      runId,
      reportsRoot,
      env: {
        ...process.env,
        AOR_LIVE_E2E_BROWSER_PROOF_PYTHON_BIN: fakePython,
        PLAYWRIGHT_BROWSERS_PATH: path.join(tempRoot, "target-cache", "ms-playwright"),
      },
      appUrl: "http://127.0.0.1:61002/",
      browserTaskProofRequestFile: path.join(
        reportsRoot,
        `installed-user-guided-browser-task-proof-request-${runId}.json`,
      ),
      browserTaskProofFile: path.join(reportsRoot, `installed-user-guided-browser-task-proof-${runId}.json`),
      outputHtml: path.join(reportsRoot, `installed-user-guided-web-smoke-${runId}.html`),
      domSnapshotFile: path.join(reportsRoot, `installed-user-guided-web-smoke-dom-${runId}.json`),
      accessibilitySummaryFile: path.join(
        reportsRoot,
        `installed-user-guided-web-smoke-accessibility-${runId}.json`,
      ),
      visualSnapshotFile: path.join(reportsRoot, `installed-user-guided-web-smoke-visual-guardrail-${runId}.json`),
    });

    assert.equal(result.status, "pass");
    assert.equal(fs.existsSync(result.proof_file), true);
    assert.equal(fs.existsSync(result.screenshot_file), true);
    const proof = JSON.parse(fs.readFileSync(result.proof_file, "utf8"));
    assert.equal(proof.task_outcome.status, "pass");
    assert.equal(proof.env_playwright_browsers_path, null);
    assert.deepEqual(
      proof.accessibility_checks.map((entry) => entry.check_id),
      aorOperatorAccessibilityCheckIds,
    );
  });
});

test("guided browser-task collector retries one transient environment failure", () => {
  withTempRoot((tempRoot) => {
    const reportsRoot = path.join(tempRoot, "reports");
    fs.mkdirSync(reportsRoot, { recursive: true });
    const fakePython = path.join(tempRoot, "flaky-python.cjs");
    const counterFile = path.join(tempRoot, "collector-attempts.txt");
    fs.writeFileSync(
      fakePython,
      [
        "#!/usr/bin/env node",
        "const fs = require('fs');",
        "const path = require('path');",
        "if (process.argv[2] === '-c') process.exit(0);",
        `const counterFile = ${JSON.stringify(counterFile)};`,
        "const attempt = fs.existsSync(counterFile) ? Number(fs.readFileSync(counterFile, 'utf8')) + 1 : 1;",
        "fs.writeFileSync(counterFile, String(attempt));",
        "if (attempt === 1) process.exit(75);",
        "const payload = JSON.parse(process.argv[3]);",
        "fs.mkdirSync(path.dirname(payload.browser_task_proof_file), { recursive: true });",
        "fs.writeFileSync(payload.browser_task_proof_file, JSON.stringify({ status: 'pass' }) + '\\n');",
        "fs.writeFileSync(payload.screenshot_file, 'png');",
        "console.log(JSON.stringify({ status: 'pass', proof_file: payload.browser_task_proof_file }));",
      ].join("\n"),
      "utf8",
    );
    fs.chmodSync(fakePython, 0o755);

    const runId = "guided-collector-retry";
    const result = collectGuidedBrowserTaskProof({
      enabled: true,
      runId,
      reportsRoot,
      env: {
        ...process.env,
        AOR_LIVE_E2E_BROWSER_PROOF_PYTHON_BIN: fakePython,
      },
      appUrl: "http://127.0.0.1:61002/",
      browserTaskProofRequestFile: path.join(reportsRoot, `browser-request-${runId}.json`),
      browserTaskProofFile: path.join(reportsRoot, `browser-proof-${runId}.json`),
      outputHtml: path.join(reportsRoot, `browser-${runId}.html`),
      domSnapshotFile: path.join(reportsRoot, `browser-dom-${runId}.json`),
      accessibilitySummaryFile: path.join(reportsRoot, `browser-a11y-${runId}.json`),
      visualSnapshotFile: path.join(reportsRoot, `browser-visual-${runId}.json`),
    });

    assert.equal(result.status, "pass");
    assert.deepEqual(result.attempts, [
      { attempt: 1, status: 75, signal: null, proof_materialized: false },
      { attempt: 2, status: 0, signal: null, proof_materialized: true },
    ]);
    assert.equal(fs.readFileSync(counterFile, "utf8"), "2");
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

test("guided UI proof defers warn diagnostics until browser evidence is materialized", () => {
  const flowSource = fs.readFileSync(fullJourneyFlowScript, "utf8");
  const profileSource = fs.readFileSync(
    path.join(repoRoot, "scripts/live-e2e/profiles/installed-user-guided-journey.yaml"),
    "utf8",
  );
  const qaDeferredMarkerIndex = flowSource.indexOf("diagnostic://post-run-diagnostic-deferred-until-guided-proof");
  const guidedWebSmokeIndex = flowSource.indexOf("const webSmoke = runGuidedWebSmoke");
  const deferredDiagnosticRunIndex = flowSource.indexOf("artifacts.post_run_diagnostic_deferred_after_guided_proof = true");
  assert.notEqual(qaDeferredMarkerIndex, -1);
  assert.notEqual(guidedWebSmokeIndex, -1);
  assert.notEqual(deferredDiagnosticRunIndex, -1);
  assert.ok(qaDeferredMarkerIndex < guidedWebSmokeIndex);
  assert.ok(guidedWebSmokeIndex < deferredDiagnosticRunIndex);
  assert.match(flowSource, /function resolveGuidedWarnDiagnosticTimeoutMs/u);
  assert.match(flowSource, /allowFailureResult: runOptions\.allowFailureResult === true/u);
  assert.match(profileSource, /guided_warn_diagnostic_timeout_sec: 600/u);
});

test("flow-health regress profiles report policy-excluded QA as passing evidence", () => {
  const flowSource = fs.readFileSync(fullJourneyFlowScript, "utf8");

  assert.match(flowSource, /qaOverallStatus = "pass";\s*\n\s*artifacts\.evaluation_status = "skipped";/u);
  assert.match(
    flowSource,
    /markStage\(\s*\n\s*stageMap,\s*\n\s*"qa",\s*\n\s*"pass",\s*\n\s*qaEvidenceRefs,\s*\n\s*"Profile quality-cycle policy excludes evaluator QA; required flow-health QA evidence passed\."/u,
  );
  assert.doesNotMatch(flowSource, /markStage\(stageMap, "qa", "skipped", \[\], "Profile quality-cycle policy excludes QA\."/u);
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
  assert.match(flowSource, /function buildCachedPostRunDiagnosticVerifyResult/u);
  assert.match(flowSource, /post_run_diagnostic_reused_after_resume/u);
  assert.match(flowSource, /cached post-run diagnostic verification/u);
  const cachedDiagnosticIndex = flowSource.indexOf("const cachedPostRunDiagnosticVerify =");
  const runDiagnosticIndex = flowSource.indexOf(
    'const postRunDiagnosticVerify = runCommand("project-verify-post-run-diagnostic"',
  );
  assert.notEqual(cachedDiagnosticIndex, -1);
  assert.notEqual(runDiagnosticIndex, -1);
  assert.ok(cachedDiagnosticIndex < runDiagnosticIndex);
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

test("full-journey resolver rejects profiles without explicit catalog matrix cell", () => {
  const loaded = loadProofRunnerProfile({
    hostRoot: repoRoot,
    profileRef: "scripts/live-e2e/profiles/full-journey-release-ky-medium-openai.yaml",
  });
  const profile = structuredClone(loaded.profile);
  profile.provider_variant_id = "anthropic-primary";

  assert.throws(
    () =>
      resolveFullJourneyProfile({
        profile,
        catalogRoot: resolveCatalogRoot({ hostRoot: repoRoot }),
      }),
    /must match an explicit required_matrix_cells or manual_matrix_cells entry/u,
  );
});

test("medium product-change profiles must declare the full implementation quality cycle", () => {
  const loaded = loadProofRunnerProfile({
    hostRoot: repoRoot,
    profileRef: "scripts/live-e2e/profiles/full-journey-regress-httpx-medium-openai.yaml",
  });
  const profile = structuredClone(loaded.profile);
  profile.implementation_loop.cycle_steps = ["execution", "review"];

  assert.throws(
    () =>
      resolveFullJourneyProfile({
        profile,
        catalogRoot: resolveCatalogRoot({ hostRoot: repoRoot }),
      }),
    /implementation_loop\.cycle_steps must include qa/u,
  );

  const missingRepairSources = structuredClone(loaded.profile);
  missingRepairSources.implementation_loop.repair_sources = ["review"];
  assert.throws(
    () =>
      resolveFullJourneyProfile({
        profile: missingRepairSources,
        catalogRoot: resolveCatalogRoot({ hostRoot: repoRoot }),
      }),
    /implementation_loop\.repair_sources must include qa, post-run-primary, post-run-diagnostic/u,
  );
});

test("W45 repair profiles declare replayable repair-loop proof expectations", () => {
  const repairProfileRefs = [
    "scripts/live-e2e/profiles/full-journey-repair-commander-js-medium-anthropic.yaml",
    "scripts/live-e2e/profiles/full-journey-repair-fastify-medium-openai.yaml",
    "scripts/live-e2e/profiles/full-journey-repair-httpie-medium-anthropic.yaml",
    "scripts/live-e2e/profiles/full-journey-repair-nextjs-medium-anthropic.yaml",
    "scripts/live-e2e/profiles/full-journey-repair-pluggy-medium-anthropic.yaml",
  ];
  const requiredFlags = [
    "require_quality_repair_request_refs",
    "require_implementation_repair_refs",
    "require_review_rerun_refs",
    "require_qa_rerun_refs",
    "qa_origin_requires_post_repair_review",
    "budget_exhaustion_operator_hold_required",
    "no_upstream_write_evidence_required",
  ];
  const acceptanceDrillSources = new Map([
    ["scripts/live-e2e/profiles/full-journey-repair-fastify-medium-openai.yaml", "review"],
    ["scripts/live-e2e/profiles/full-journey-repair-pluggy-medium-anthropic.yaml", "qa"],
  ]);

  for (const profileRef of repairProfileRefs) {
    const loaded = loadProofRunnerProfile({ hostRoot: repoRoot, profileRef });
    const resolved = resolveFullJourneyProfile({
      profile: loaded.profile,
      catalogRoot: resolveCatalogRoot({ hostRoot: repoRoot }),
    });
    const proofExpectations = resolved.resolvedProfile.implementation_loop.proof_expectations;

    assert.deepEqual(proofExpectations.required_repair_paths, [
      "review-origin",
      "qa-origin",
      "budget-exhaustion",
    ]);
    for (const flag of requiredFlags) {
      assert.equal(proofExpectations[flag], true, `${profileRef} must set ${flag}=true`);
    }
    assert.equal(resolved.resolvedProfile.output_policy.write_back_to_remote, false);
    assert.ok(
      ["patch-only", "fork-first-pr"].includes(resolved.resolvedProfile.output_policy.preferred_delivery_mode),
      `${profileRef} must keep no-upstream-write delivery evidence bounded`,
    );
    if (acceptanceDrillSources.has(profileRef)) {
      const drill = proofExpectations.acceptance_repair_drill;
      assert.equal(drill.source_phase, acceptanceDrillSources.get(profileRef));
      assert.equal(drill.trigger, "when-no-organic-repair");
      assert.match(drill.finding_id, /^w45\./u);
      assert.match(drill.resolution_requirement, /public repair execution/u);
    }
  }

  const loaded = loadProofRunnerProfile({
    hostRoot: repoRoot,
    profileRef: "scripts/live-e2e/profiles/full-journey-repair-httpie-medium-anthropic.yaml",
  });
  const missingReviewRerunProof = structuredClone(loaded.profile);
  missingReviewRerunProof.implementation_loop.proof_expectations.require_review_rerun_refs = false;
  assert.throws(
    () =>
      resolveFullJourneyProfile({
        profile: missingReviewRerunProof,
        catalogRoot: resolveCatalogRoot({ hostRoot: repoRoot }),
      }),
    /implementation_loop\.proof_expectations\.require_review_rerun_refs=true/u,
  );

  const unsafeQaRepairProof = structuredClone(loaded.profile);
  unsafeQaRepairProof.implementation_loop.proof_expectations.qa_origin_requires_post_repair_review = false;
  assert.throws(
    () =>
      resolveFullJourneyProfile({
        profile: unsafeQaRepairProof,
        catalogRoot: resolveCatalogRoot({ hostRoot: repoRoot }),
      }),
    /implementation_loop\.proof_expectations\.qa_origin_requires_post_repair_review=true/u,
  );
});

test("W45 acceptance repair drills activate only for clean first-pass public evidence", () => {
  const drill = resolveAcceptanceRepairDrill({
    acceptance_repair_drill: {
      source_phase: "qa",
      trigger: "when-no-organic-repair",
      finding_id: "w45.qa.acceptance-drill",
      summary: "Request QA-origin repair proof.",
      resolution_requirement: "Complete a public repair execution before delivery.",
    },
  });

  assert.equal(drill.source_phase, "qa");
  assert.equal(
    resolveActiveAcceptanceRepairDrill({
      drill,
      iteration: 1,
      sourcePhase: "qa",
      currentRepairSource: null,
      stageStatus: "pass",
      secondaryStatus: "pass",
      priorRepairDecisionFiles: [],
    }),
    drill,
  );
  assert.equal(
    resolveActiveAcceptanceRepairDrill({
      drill,
      iteration: 2,
      sourcePhase: "qa",
      currentRepairSource: null,
      stageStatus: "pass",
      secondaryStatus: "pass",
      priorRepairDecisionFiles: [],
    }),
    null,
  );
  assert.equal(
    resolveActiveAcceptanceRepairDrill({
      drill,
      iteration: 1,
      sourcePhase: "qa",
      currentRepairSource: "qa",
      stageStatus: "pass",
      secondaryStatus: "pass",
      priorRepairDecisionFiles: [],
    }),
    null,
  );
  assert.equal(
    resolveActiveAcceptanceRepairDrill({
      drill,
      iteration: 1,
      sourcePhase: "qa",
      currentRepairSource: null,
      stageStatus: "fail",
      secondaryStatus: "pass",
      priorRepairDecisionFiles: [],
    }),
    null,
  );

  const finding = buildAcceptanceRepairDrillFinding({
    drill,
    sourcePhase: "qa",
    iteration: 1,
    evidenceRefs: ["review-report.json", "evaluation-report.json"],
  });
  assert.equal(finding.finding_id, "w45.qa.acceptance-drill");
  assert.equal(finding.category, "qa");
  assert.equal(finding.acceptance_drill, true);
  assert.deepEqual(finding.evidence_refs, ["review-report.json", "evaluation-report.json"]);
});

test("W45 repair-loop proof fixture covers review-origin, QA-origin, and exhausted budget paths", () => {
  const fixture = JSON.parse(
    fs.readFileSync(
      path.join(repoRoot, "scripts/live-e2e/fixtures/evidence/w45-s05/repair-loop-proof.sample.json"),
      "utf8",
    ),
  );
  assert.equal(fixture.slice_id, "W45-S05");
  assert.equal(fixture.proof_scope.deterministic_fixture_only, true);
  assert.equal(fixture.proof_scope.live_acceptance_deferred_to, "W45-S06");
  assert.equal(fixture.no_upstream_write.write_back_to_remote, false);

  const paths = new Map(fixture.repair_paths.map((entry) => [entry.path_id, entry]));
  assert.deepEqual([...paths.keys()].sort(), [
    "budget-exhaustion-operator-hold",
    "qa-origin-repair-closure",
    "review-origin-repair-closure",
  ]);

  const reviewOrigin = paths.get("review-origin-repair-closure");
  assert.equal(reviewOrigin.source_stage, "review");
  assert.equal(reviewOrigin.final_status, "closed");
  assert.match(reviewOrigin.quality_repair_request_ref, /quality-repair-request-review-origin/u);
  assert.match(reviewOrigin.implementation_repair_ref, /repair#1/u);
  assert.match(reviewOrigin.review_rerun_ref, /review-report-repair-rerun/u);
  assert.match(reviewOrigin.qa_rerun_ref, /qa-report-repair-rerun/u);
  assert.match(reviewOrigin.no_upstream_write_evidence_ref, /no-upstream-write/u);
  assert.equal(reviewOrigin.delivery_release_blocked_until_closed, true);

  const qaOrigin = paths.get("qa-origin-repair-closure");
  assert.equal(qaOrigin.source_stage, "qa");
  assert.equal(qaOrigin.final_status, "closed");
  assert.equal(qaOrigin.qa_origin_post_repair_review_required, true);
  assert.ok(
    qaOrigin.stage_sequence.indexOf("repair#1") < qaOrigin.stage_sequence.indexOf("review#2"),
    "QA-origin repair must return through review before QA closure",
  );
  assert.ok(
    qaOrigin.stage_sequence.indexOf("review#2") < qaOrigin.stage_sequence.indexOf("qa#2"),
    "QA-origin repair must rerun QA only after post-repair review",
  );
  assert.match(qaOrigin.quality_repair_request_ref, /quality-repair-request-qa-origin/u);
  assert.match(qaOrigin.review_rerun_ref, /review-report-post-repair/u);
  assert.match(qaOrigin.qa_rerun_ref, /qa-report-post-review/u);

  const exhausted = paths.get("budget-exhaustion-operator-hold");
  assert.equal(exhausted.final_status, "operator-hold");
  assert.equal(exhausted.attempt_budget.attempt_index, exhausted.attempt_budget.max_attempts);
  assert.equal(exhausted.attempt_budget.remaining_attempts, 0);
  assert.equal(exhausted.requires_operator_override_for_delivery, true);
  assert.equal(exhausted.delivery_release_blocked_until_closed, true);
  assert.equal(exhausted.implementation_repair_refs.length, exhausted.attempt_budget.max_attempts);
  assert.equal(exhausted.review_rerun_refs.length, exhausted.attempt_budget.max_attempts);
  assert.deepEqual(exhausted.qa_rerun_refs, []);
  assert.match(exhausted.operator_hold_ref, /next-action-budget-exhausted/u);
});

test("W45 repair proof expectations fail closed without materialized repair refs", () => {
  const result = evaluateRepairProofExpectations({
    profile: {
      implementation_loop: {
        proof_expectations: {
          required_repair_paths: ["review-origin", "qa-origin"],
          require_quality_repair_request_refs: true,
          require_implementation_repair_refs: true,
          require_review_rerun_refs: true,
          require_qa_rerun_refs: true,
          qa_origin_requires_post_repair_review: true,
          no_upstream_write_evidence_required: true,
        },
      },
      output_policy: {
        write_back_to_remote: false,
      },
    },
    artifacts: {
      implementation_loop: {
        iterations: [
          {
            iteration: 1,
            repair_requested: false,
          },
        ],
      },
    },
  });

  assert.equal(result.status, "fail");
  assert.ok(
    result.findings.some((finding) => finding.includes("quality_repair_request ref")),
    "missing request refs should block repair-profile acceptance",
  );
  assert.ok(
    result.findings.some((finding) => finding.includes("declared repair path")),
    "missing any declared repair path should block repair-profile acceptance",
  );
});

test("W45 repair proof expectations accept one closed declared repair path per run", () => {
  withTempRoot((tempRoot) => {
    const reviewDecisionFile = path.join(tempRoot, "review-decision-review-origin.json");
    fs.writeFileSync(
      reviewDecisionFile,
      `${JSON.stringify(
        {
          decision: "request-repair",
          quality_repair_request_ref: "evidence://reports/quality-repair-request-review-origin.json",
          repair_context: {
            source_phase: "review",
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const result = evaluateRepairProofExpectations({
      profile: {
        implementation_loop: {
          proof_expectations: {
            required_repair_paths: ["review-origin", "qa-origin", "budget-exhaustion"],
            require_quality_repair_request_refs: true,
            require_implementation_repair_refs: true,
            require_review_rerun_refs: true,
            require_qa_rerun_refs: true,
            qa_origin_requires_post_repair_review: true,
            no_upstream_write_evidence_required: true,
          },
        },
        output_policy: {
          write_back_to_remote: false,
        },
      },
      artifacts: {
        review_repair_decision_files: [reviewDecisionFile],
        quality_repair_request_refs: ["evidence://reports/quality-repair-request-review-origin.json"],
        quality_repair_request_files: [path.join(tempRoot, "quality-repair-request-review-origin.json")],
        closed_quality_repair_request_refs: ["evidence://reports/quality-repair-request-review-origin.json"],
        implementation_loop: {
          iterations: [
            {
              iteration: 1,
              repair_requested: true,
              repair_decision_file: reviewDecisionFile,
            },
            {
              iteration: 2,
              routed_step_result_file: path.join(tempRoot, "step-result-repair-2.json"),
              review_report_file: path.join(tempRoot, "review-report-repair-2.json"),
              evaluation_report_file: path.join(tempRoot, "evaluation-report-repair-2.json"),
              qa_status: "pass",
            },
          ],
        },
      },
    });

    assert.equal(result.status, "pass");
    assert.deepEqual(result.evidence.observed_declared_repair_paths, ["review-origin"]);
    assert.equal(result.evidence.implementation_repair_refs.length, 1);
    assert.equal(result.evidence.review_rerun_refs.length, 1);
    assert.equal(result.evidence.qa_rerun_refs.length, 1);
  });
});

test("W45 repair proof expectations accept resumed final repair iteration evidence", () => {
  withTempRoot((tempRoot) => {
    const reviewDecisionFile = path.join(tempRoot, "review-decision-review-origin.json");
    fs.writeFileSync(
      reviewDecisionFile,
      `${JSON.stringify(
        {
          decision: "request-repair",
          quality_repair_request_ref: "evidence://reports/quality-repair-request-review-origin.json",
          repair_context: {
            source_phase: "review",
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const result = evaluateRepairProofExpectations({
      profile: {
        implementation_loop: {
          proof_expectations: {
            required_repair_paths: ["review-origin", "qa-origin", "budget-exhaustion"],
            require_quality_repair_request_refs: true,
            require_implementation_repair_refs: true,
            require_review_rerun_refs: true,
            require_qa_rerun_refs: true,
            qa_origin_requires_post_repair_review: true,
            no_upstream_write_evidence_required: true,
          },
        },
        output_policy: {
          write_back_to_remote: false,
        },
      },
      artifacts: {
        review_repair_decision_files: [reviewDecisionFile],
        quality_repair_request_refs: ["evidence://reports/quality-repair-request-review-origin.json"],
        quality_repair_request_files: [path.join(tempRoot, "quality-repair-request-review-origin.json")],
        closed_quality_repair_request_refs: ["evidence://reports/quality-repair-request-review-origin.json"],
        implementation_loop: {
          iterations: [
            {
              iteration: 1,
              previous_repair_decision_files: [reviewDecisionFile],
              routed_step_result_file: path.join(tempRoot, "step-result-repair-resumed.json"),
              review_report_file: path.join(tempRoot, "review-report-repair-resumed.json"),
              evaluation_report_file: path.join(tempRoot, "evaluation-report-repair-resumed.json"),
              qa_status: "pass",
              repair_requested: false,
            },
          ],
        },
      },
    });

    assert.equal(result.status, "pass");
    assert.deepEqual(result.evidence.observed_declared_repair_paths, ["review-origin"]);
    assert.deepEqual(result.evidence.implementation_repair_refs, [
      path.join(tempRoot, "step-result-repair-resumed.json"),
    ]);
    assert.deepEqual(result.evidence.review_rerun_refs, [
      path.join(tempRoot, "review-report-repair-resumed.json"),
    ]);
    assert.deepEqual(result.evidence.qa_rerun_refs, [
      path.join(tempRoot, "evaluation-report-repair-resumed.json"),
    ]);
  });
});

test("W45 repair proof expectations accept closed review-origin and QA-origin evidence", () => {
  withTempRoot((tempRoot) => {
    const reviewDecisionFile = path.join(tempRoot, "review-decision-review-origin.json");
    const qaDecisionFile = path.join(tempRoot, "review-decision-qa-origin.json");
    fs.writeFileSync(
      reviewDecisionFile,
      `${JSON.stringify(
        {
          decision: "request-repair",
          quality_repair_request_ref: "evidence://reports/quality-repair-request-review-origin.json",
          repair_context: {
            source_phase: "review",
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    fs.writeFileSync(
      qaDecisionFile,
      `${JSON.stringify(
        {
          decision: "request-repair",
          quality_repair_request_ref: "evidence://reports/quality-repair-request-qa-origin.json",
          repair_context: {
            source_phase: "qa",
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const result = evaluateRepairProofExpectations({
      profile: {
        implementation_loop: {
          proof_expectations: {
            required_repair_paths: ["review-origin", "qa-origin"],
            require_quality_repair_request_refs: true,
            require_implementation_repair_refs: true,
            require_review_rerun_refs: true,
            require_qa_rerun_refs: true,
            qa_origin_requires_post_repair_review: true,
            no_upstream_write_evidence_required: true,
          },
        },
        output_policy: {
          write_back_to_remote: false,
        },
      },
      artifacts: {
        review_repair_decision_files: [reviewDecisionFile, qaDecisionFile],
        quality_repair_request_refs: [
          "evidence://reports/quality-repair-request-review-origin.json",
          "evidence://reports/quality-repair-request-qa-origin.json",
        ],
        quality_repair_request_files: [
          path.join(tempRoot, "quality-repair-request-review-origin.json"),
          path.join(tempRoot, "quality-repair-request-qa-origin.json"),
        ],
        closed_quality_repair_request_refs: [
          "evidence://reports/quality-repair-request-review-origin.json",
          "evidence://reports/quality-repair-request-qa-origin.json",
        ],
        implementation_loop: {
          iterations: [
            {
              iteration: 1,
              repair_requested: true,
              repair_decision_file: reviewDecisionFile,
            },
            {
              iteration: 2,
              routed_step_result_file: path.join(tempRoot, "step-result-repair-2.json"),
              review_report_file: path.join(tempRoot, "review-report-repair-2.json"),
              evaluation_report_file: path.join(tempRoot, "evaluation-report-repair-2.json"),
              qa_status: "pass",
            },
            {
              iteration: 3,
              repair_requested: true,
              repair_decision_file: qaDecisionFile,
            },
            {
              iteration: 4,
              routed_step_result_file: path.join(tempRoot, "step-result-repair-4.json"),
              review_report_file: path.join(tempRoot, "review-report-repair-4.json"),
              evaluation_report_file: path.join(tempRoot, "evaluation-report-repair-4.json"),
              qa_status: "pass",
            },
          ],
        },
      },
    });

    assert.equal(result.status, "pass");
    assert.deepEqual(result.evidence.repair_source_stages.sort(), ["qa", "review"]);
    assert.equal(result.evidence.implementation_repair_refs.length, 2);
    assert.equal(result.evidence.review_rerun_refs.length, 2);
    assert.equal(result.evidence.qa_rerun_refs.length, 2);
  });
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

test("full journey requests repair only for actionable review or QA findings before delivery approval", () => {
  const flowsSource = fs.readFileSync(fullJourneyFlowScript, "utf8");

  assert.match(
    flowsSource,
    /latestExecutionRoot\s*=\s*asNonEmptyString\(asRecord\(stepResult\.mission_semantics\)\.git_status_root\) \|\| latestExecutionRoot/u,
    "the runner must derive one retained execution root from public step evidence",
  );
  const runOwnedExecutionRootUsages = flowsSource.match(/"--execution-root",\s+latestExecutionRoot/gu);
  assert.equal(
    runOwnedExecutionRootUsages?.length,
    9,
    "repair execution, verification, review, decisions, guided approval, delivery, and release must use the run-owned workspace",
  );
  const releasePrepareCommands = [...flowsSource.matchAll(/runCommand\("release-prepare", \[([\s\S]*?)\]\s*,/gu)];
  assert.equal(releasePrepareCommands.length >= 2, true);
  for (const [, releaseArgs] of releasePrepareCommands.slice(-2)) {
    assert.match(releaseArgs, /"--execution-root",\s+latestExecutionRoot/u);
  }
  assert.match(
    flowsSource,
    /release_packet_status === "ready-for-close"/u,
    "private qualification must not treat a blocked release packet as passing merely because a file exists",
  );
  assert.match(
    flowsSource,
    /\.\.\.\(iteration > 1 \? \["--execution-root", latestExecutionRoot\] : \[\]\)/u,
    "repair run start must resume the accumulated run-owned execution workspace",
  );
  assert.match(
    flowsSource,
    /closeSatisfiedQualityRepairRequests\(\{[\s\S]*?executionRoot: latestExecutionRoot/gu,
    "repair closure must preserve the run-owned execution workspace lineage",
  );
  const auditRunCommands = [...flowsSource.matchAll(/runCommand\("audit-runs", \[([\s\S]*?)\]\)/gu)];
  assert.equal(auditRunCommands.length, 2);
  for (const [, auditArgs] of auditRunCommands) {
    assert.doesNotMatch(auditArgs, /--project-profile/u, "audit runs does not accept a project profile flag");
  }
  const learningHandoffCommands = [...flowsSource.matchAll(/runCommand\("learning-handoff", \[([\s\S]*?)\]\)/gu)];
  assert.equal(learningHandoffCommands.length, 2);
  assert.match(learningHandoffCommands[0][1], /\.\.\.commandBaseArgs/u);
  assert.match(
    learningHandoffCommands[1][1],
    /"--project-profile",\s+generatedProfile\.generatedProjectProfileFile/u,
  );
  assert.match(flowsSource, /const reviewNeedsRepair = reviewRequiresActionableRepair\(reviewReport, reviewOverallStatus\)/u);
  assert.match(flowsSource, /const reviewHasNonRepairWarnings = reviewOverallStatus === "warn" && !reviewNeedsRepair/u);
  assert.match(flowsSource, /reviewNeedsRepair[\s\S]*reviewRepairActions\.has\("request-repair"\)/u);
  assert.match(flowsSource, /reviewHasOnlyVerificationMappingFindings/u);
  assert.match(flowsSource, /verification_mapping_gap/u);
  assert.match(flowsSource, /acceptable_residual_risk_not_recognized/u);
  assert.match(flowsSource, /provider_did_not_address_finding/u);
  assert.match(flowsSource, /const qaNeedsRepair = qaEvaluationStatus === "fail"/u);
  assert.match(flowsSource, /const diagnosticNeedsRepair = qaDiagnosticStatus === "fail"/u);
  assert.match(flowsSource, /terminalCycleFailure = !canRepair && \(qaNeedsRepair \|\| diagnosticNeedsRepair\)/u);
  assert.match(flowsSource, /qa_repair_loop_exhausted/u);
  assert.match(flowsSource, /review_repair_loop_exhausted/u);
  assert.match(flowsSource, /--repair-context-file/u);
  assert.match(flowsSource, /source_phase: repairSource \?\? "review"/u);
  assert.match(flowsSource, /qaOverallStatus === "fail"/u);
  assert.match(flowsSource, /const unresolvedReviewFindings = collectReviewFindingSummaries\(reviewReport\)/u);
  assert.match(flowsSource, /const unresolvedReviewFindingDetails = collectReviewFindingDetails\(reviewReport\)/u);
  assert.match(flowsSource, /unresolved_finding_details: repairFindingDetails/u);
  assert.match(flowsSource, /repair_necessity: repairNecessity/u);
  assert.match(flowsSource, /previous_repair_decision_files: previousRepairDecisionRefs/u);
  assert.match(flowsSource, /repair_context_fingerprint: pendingRepairContextFingerprint/u);
  assert.match(flowsSource, /new_context_since_previous: newRepairContextSignals/u);
  assert.match(flowsSource, /newRepairContextSignals,\s*\n\s*\}\);/u);
  assert.match(flowsSource, /repeated_repair_context_without_new_evidence/u);
  assert.match(flowsSource, /Unresolved findings:/u);
  assert.match(flowsSource, /Runtime Harness decision:/u);
  assert.ok(
    flowsSource.indexOf('runCommand("review-run"') < flowsSource.indexOf("const previousRepairContexts = readRepairDecisionContexts"),
    "expected fresh review evidence before repeated repair context comparison",
  );
});

test("repair context keeps verification failure details structured", () => {
  const [detail] = collectReviewFindingDetails({
    findings: [
      {
        finding_id: "artifact-quality.01",
        category: "artifact-quality",
        severity: "fail",
        summary: "Verify-summary failed with command-level details for: npx xo.",
        evidence_refs: ["evidence://reports/verify-summary-post-run-primary.json"],
        verification_failure_details: [
          {
            command: "npx xo",
            command_group_id: "post-change-primary",
            role: "test",
            phase: "post-change",
            enforcement: "required",
            enforcement_result: "fail",
            exit_code: 1,
            timed_out: false,
            timeout_class: "focused-test",
            command_timeout_ms: 1800000,
            working_dir: ".",
            repo_scope: "sindresorhus/ky",
            stdout_excerpt: "source/utils/merge.ts:206:1\n  TODO warning plus test/retry.ts null type error",
            stderr_excerpt: "",
            failure_summary: "Post-change verification command 'npx xo' failed with exit code 1.",
            evidence_refs: [
              "evidence://reports/step-result-post-run-primary-2.json",
              "evidence://reports/verify-command-post-run-primary-2.log",
            ],
          },
        ],
      },
    ],
  });

  assert.equal(detail.finding_id, "artifact-quality.01");
  assert.deepEqual(detail.evidence_refs, [
    "evidence://reports/verify-summary-post-run-primary.json",
    "evidence://reports/step-result-post-run-primary-2.json",
    "evidence://reports/verify-command-post-run-primary-2.log",
  ]);
  assert.equal(detail.verification_failure_details[0].command, "npx xo");
  assert.match(detail.verification_failure_details[0].stdout_excerpt, /test\/retry\.ts null type/u);
  assert.equal(detail.evidence_refs.includes("npx xo"), false);
  assert.equal(detail.evidence_refs.some((ref) => ref.includes("source/utils/merge.ts")), false);
  assert.equal(
    detail.evidence_refs.includes("Post-change verification command 'npx xo' failed with exit code 1."),
    false,
  );
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

test("proof runner preserves exhausted review repair loop as review run-health failure", () => {
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
        "review-report.json",
        "post-run-verify-summary.json",
        "review-plan.json",
        "review-transcript.json",
        "review-inspection.json",
        "review-classification.json",
        "review-agent-request.json",
        "review-operator-decision.json",
      ].map((name) => [name, path.join(reportsRoot, name)]),
    );
    for (const file of Object.values(files)) {
      writeJsonFixture(file);
    }
    writeJsonFixture(files["review-report.json"], {
      overall_status: "warn",
      findings: [
        {
          severity: "warn",
          summary: "Test plan count was lowered in 'test/headers.ts'.",
          evidence_refs: [files["review-report.json"]],
        },
      ],
    });
    writeJsonFixture(files["post-run-verify-summary.json"], { status: "passed" });
    writeJsonFixture(files["review-operator-decision.json"], {
      action: "block",
      status: "accepted",
      semantic_analysis: {
        status: "blocked",
        judge_source: "skill-agent",
        findings: ["Review did not pass after the implementation repair budget was exhausted."],
      },
      inspected_evidence_refs: [files["review-transcript.json"], files["review-report.json"]],
      evidence_refs: [files["review-transcript.json"], files["review-report.json"]],
    });

    const runId = "implementation-loop-exhausted-review";
    const reviewEntry = {
      sequence: 1,
      step_id: "review",
      step_instance_id: "review#3",
      iteration: 3,
      flow_stage: "review",
      plan: {
        objective: "Observe final review.",
        public_surface: "aor review run",
        command_labels: ["review-run"],
        expected_artifacts: ["review_report_file"],
        inspection_sources: ["command_transcript"],
        safety_constraints: ["no-upstream-write"],
      },
      plan_ref: files["review-plan.json"],
      public_surface: "aor review run",
      transcript_ref: files["review-transcript.json"],
      execution_ref: files["review-transcript.json"],
      inspection_ref: files["review-inspection.json"],
      classification_ref: files["review-classification.json"],
      artifact_refs: [files["review-transcript.json"], files["review-report.json"]],
      started_at: "2026-06-09T00:00:00.000Z",
      finished_at: "2026-06-09T00:00:01.000Z",
      duration_sec: 1,
      deterministic_analysis: {
        status: "not_pass",
        exit_code: 0,
        failure_class: "stage-failed",
        missing_evidence: [],
        recommendation: "inspect stage evidence refs and command transcripts",
      },
      semantic_analysis: {
        status: "blocked",
        judge_source: "skill-agent",
        findings: ["Implementation repair loop stopped because review did not pass."],
      },
      agent_decision_request_ref: files["review-agent-request.json"],
      operator_decision_ref: files["review-operator-decision.json"],
      operator_decision_status: "accepted",
      inspected_evidence_refs: [files["review-transcript.json"], files["review-report.json"]],
      requested_interaction: null,
      decision: {
        action: "block",
        reason: "Review did not pass after the implementation repair budget was exhausted.",
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
        profile_id: "live-e2e.test.implementation-loop-exhausted-review",
        journey_mode: "full-journey",
        target_catalog_id: "ky",
        feature_mission_id: "ky-undefined-header-removal",
        scenario_family: "regress",
        provider_variant_id: "openai-primary",
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
        status: "blocked",
        stageResults: [
          {
            stage: "review",
            status: "fail",
            evidence_refs: [files["review-transcript.json"], files["review-report.json"]],
            summary: "Implementation repair loop stopped because review did not pass.",
          },
        ],
        commandResults: [
          {
            label: "review-run",
            command_surface: "aor review run",
            status: "pass",
            exit_code: 0,
            transcript_file: files["review-transcript.json"],
            artifact_refs: [files["review-report.json"]],
          },
        ],
        artifacts: {
          host_runtime_root: runtimeRoot,
          host_reports_root: reportsRoot,
          live_e2e_controller_state_file: files["controller-state.json"],
          live_e2e_step_journal_entries: [reviewEntry],
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
          review_report_file: files["review-report.json"],
          post_run_verify_summary_file: files["post-run-verify-summary.json"],
          post_run_verify_status: "pass",
          provider_execution_status: "completed",
          real_code_change_status: "pass",
          meaningful_changed_paths: ["source/utils/merge.ts", "test/headers.ts"],
          feature_mission_id: "ky-undefined-header-removal",
          feature_size: "small",
          failure_owner: "provider",
          failure_phase: "review",
          failure_class: "review_repair_loop_exhausted",
        },
      },
      aorLaunch: {
        command: process.execPath,
        argsPrefix: [],
        binaryRef: runProfileScript,
      },
    });

    assert.equal(written.summary.live_e2e_run_health_overall_status, "blocked");
    assert.equal(written.summary.failure_owner, "provider");
    assert.equal(written.summary.failure_phase, "review");
    assert.equal(written.summary.failure_class, "review_repair_loop_exhausted");
    assert.equal(written.runHealthReport.failure_summary.owner, "provider");
    assert.equal(written.runHealthReport.failure_summary.phase, "review");
    assert.equal(written.runHealthReport.failure_summary.class, "review_repair_loop_exhausted");
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
            next_step: "delivery",
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
          live_e2e_controller_stop: {
            reason: "Stale controller stop from an earlier resume before delivery completed.",
            state: {
              current_step: "delivery",
              completed_steps: ["discovery", "spec", "planning", "handoff", "execution", "review", "qa"],
            },
            decision: {
              action: "continue",
              reason: "Earlier QA continue decision.",
              next_step: "delivery",
            },
          },
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

test("proof runner classifies provider context-window overflow as provider run-health blocked", () => {
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

    const runId = "provider-context-window-blocked-run-health";
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
        exit_code: 1,
        failure_class: "provider_context_window_exceeded",
        missing_evidence: [],
        recommendation: "block",
      },
      semantic_analysis: {
        status: "blocked",
        judge_source: "skill-agent",
        findings: ["Provider exhausted its context window during execution after accepting a bounded work packet."],
      },
      agent_decision_request_ref: files["execution-agent-request.json"],
      operator_decision_ref: files["execution-decision.json"],
      operator_decision_status: "accepted",
      inspected_evidence_refs: [files["adapter-raw-evidence.json"]],
      requested_interaction: null,
      decision: {
        action: "block",
        reason: "Provider context window exceeded.",
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
        profile_id: "live-e2e.test.provider-context-window-blocked",
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
            summary: "Provider exhausted its context window during execution.",
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
          failure_class: "provider_context_window_exceeded",
          provider_execution_status: "blocked",
          adapter_raw_evidence_ref: files["adapter-raw-evidence.json"],
          request_artifact_ref: files["adapter-request.json"],
          provider_work_packet_ref: files["provider-work-packet.json"],
          context_budget_status: "pass",
          context_budget_failure_class: "provider_context_window_exceeded",
          raw_provider_error_summary: "Prompt is too long: input tokens exceed context window",
          top_context_size_sources: [
            {
              source: "provider_work_packet.context",
              bytes: 2048,
              chars: 2048,
              estimated_tokens: 682,
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
    assert.equal(written.runHealthReport.provider_health.context_budget_status, "pass");
    assert.equal(written.runHealthReport.provider_health.context_budget_failure_class, "provider_context_window_exceeded");
    assert.match(written.runHealthReport.provider_health.raw_provider_error_summary, /Prompt is too long/i);
    assert.equal(written.runHealthReport.target_readiness.status, "pass");
    assert.equal(written.runHealthReport.target_readiness.failure_owner, null);
    assert.equal(written.summary.failure_owner, "provider");
    assert.equal(written.observationReport.failure_owner, "provider");
    assert.equal(written.scorecard.failure_owner, "provider");
    assert.equal(written.runHealthReport.failure_summary.owner, "provider");
    assert.equal(written.runHealthReport.failure_summary.phase, "provider_execution");
    assert.equal(written.runHealthReport.failure_summary.class, "provider_context_window_exceeded");
  });
});

test("proof runner keeps malformed Codex schema failures under provider execution", () => {
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

    const rawProviderErrorSummary =
      "Malformed Codex/OpenAI tool-call schema failure: property_name_above_max_length in input[3].arguments";
    const providerRecommendedAction =
      "Malformed Codex/OpenAI tool-call schema failure; inspect raw provider JSONL/stdout/stderr and retry with the clean Codex tool surface.";
    const runId = "malformed-codex-schema-provider-run-health";
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
        status: "fail",
        exit_code: 1,
        failure_class: "external-runner-failed",
        missing_evidence: [],
        recommendation: "block",
      },
      semantic_analysis: {
        status: "fail",
        judge_source: "skill-agent",
        findings: [rawProviderErrorSummary],
      },
      agent_decision_request_ref: files["execution-agent-request.json"],
      operator_decision_ref: files["execution-decision.json"],
      operator_decision_status: "accepted",
      inspected_evidence_refs: [files["adapter-raw-evidence.json"]],
      requested_interaction: null,
      decision: {
        action: "block",
        reason: "Provider emitted malformed Codex/OpenAI tool-call schema evidence.",
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
        profile_id: "live-e2e.test.malformed-codex-schema-provider",
        journey_mode: "full-journey",
        target_catalog_id: "ky",
        feature_mission_id: "ky-release-doc-typing",
        scenario_family: "release",
        provider_variant_id: "openai-primary",
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
            evidence_refs: [files["adapter-raw-evidence.json"]],
            summary: rawProviderErrorSummary,
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
          failure_class: "external-runner-failed",
          provider_execution_status: "failed",
          provider_step_status: {
            provider: "openai",
            adapter: "codex-cli",
            status: "failed",
            recommended_action: providerRecommendedAction,
          },
          adapter_raw_evidence_ref: files["adapter-raw-evidence.json"],
          request_artifact_ref: files["adapter-request.json"],
          provider_work_packet_ref: files["provider-work-packet.json"],
          context_budget_status: "pass",
          context_budget_failure_class: null,
          raw_provider_error_summary: rawProviderErrorSummary,
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

    assert.equal(written.summary.live_e2e_run_health_overall_status, "fail");
    assert.equal(written.runHealthReport.overall_status, "fail");
    assert.equal(written.runHealthReport.target_readiness.status, "pass");
    assert.equal(written.runHealthReport.target_readiness.failure_owner, null);
    assert.equal(written.runHealthReport.target_environment_health.failure_owner, null);
    assert.equal(written.runHealthReport.provider_health.status, "fail");
    assert.match(written.runHealthReport.provider_health.raw_provider_error_summary, /property_name_above_max_length/i);
    assert.match(
      written.runHealthReport.provider_health.provider_step_status.recommended_action,
      /Malformed Codex\/OpenAI tool-call schema failure/i,
    );
    assert.equal(written.runHealthReport.failure_summary.owner, "provider");
    assert.equal(written.runHealthReport.failure_summary.phase, "provider_execution");
    assert.equal(written.runHealthReport.failure_summary.class, "external-runner-failed");
    assert.equal(written.summary.failure_owner, "provider");
    assert.equal(written.observationReport.failure_phase, "provider_execution");
    assert.equal(written.scorecard.failure_class, "external-runner-failed");
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
            label: "discovery-diagnostic-not-diagnostic",
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
    assert.equal(written.runHealthReport.command_health.failed_commands[0].diagnostic_intent, null);
    assert.equal(written.runHealthReport.diagnostic_health.status, "pass");
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
    writeJsonFixture(files["controller-state.json"], {
      current_step: "execution",
      included_steps: deliverySteps,
      completed_steps: ["discovery", "spec", "planning", "handoff", "execution"],
      pending_decision: {
        action: "block",
        reason: "Post-run target verification failed.",
        next_step: "review",
      },
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
    assert.equal(written.runHealthReport.target_readiness.status, "blocked");
    assert.equal(written.runHealthReport.target_readiness.failure_owner, "environment");
    assert.equal(written.runHealthReport.target_readiness.failure_phase, "target_setup");
    assert.equal(written.runHealthReport.target_readiness.product_execution_started, false);
    assert.equal(written.observationReport.target_readiness.status, "blocked");
    assert.equal(written.summary.target_readiness.status, "blocked");
    assert.equal(written.summary.target_readiness.failure_class, "environment_disk_space_exhausted");
    assert.equal(written.summary.failure_owner, "environment");
    assert.equal(written.summary.failure_phase, "target_setup");
    assert.equal(written.summary.failure_class, "environment_disk_space_exhausted");
    assert.equal(written.observationReport.failure_owner, "environment");
    assert.equal(written.observationReport.failure_phase, "target_setup");
    assert.equal(written.observationReport.failure_class, "environment_disk_space_exhausted");
    assert.equal(written.scorecard.failure_owner, "environment");
    assert.equal(written.scorecard.failure_phase, "target_setup");
    assert.equal(written.scorecard.failure_class, "environment_disk_space_exhausted");
    assert.equal(written.runHealthReport.failure_summary.owner, "environment");
    assert.equal(written.runHealthReport.failure_summary.phase, "target_setup");
    assert.equal(written.runHealthReport.failure_summary.class, "environment_disk_space_exhausted");
  });
});

test("proof runner raises target verification readiness blockers to top-level artifacts", () => {
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
    for (const file of Object.values(files)) {
      writeJsonFixture(file);
    }
    const written = writeProofRunnerArtifacts({
      hostRoot: repoRoot,
      hostProjectId: "aor-test",
      layout: { reportsRoot, runtimeRoot },
      runId: "target-verification-readiness-blocker",
      profilePath: path.join(tempRoot, "profile.yaml"),
      profile: {
        profile_id: "live-e2e.test.target-verification-readiness-blocker",
        journey_mode: "full-journey",
        target_catalog_id: "vitest",
        feature_mission_id: "vitest-large-regression",
        provider_variant_id: "openai-primary",
        stages: ["bootstrap", "execution"],
        live_e2e: { flow_range_policy: "delivery_default" },
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
            summary: "Target verification blocked before provider execution.",
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
            install_mode: "repo-local",
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
          target_verification_status_detail: {
            status: "blocked",
            failure_owner: "target_repository",
            failure_phase: "target_verification",
            failure_class: "target_verification_blocked",
          },
          feature_mission_id: "vitest-large-regression",
          feature_size: "large",
        },
      },
      aorLaunch: {
        command: process.execPath,
        argsPrefix: [],
        binaryRef: runProfileScript,
      },
    });

    assert.equal(written.runHealthReport.target_readiness.status, "blocked");
    assert.equal(written.runHealthReport.target_readiness.product_execution_started, false);
    assert.equal(written.runHealthReport.target_readiness.failure_owner, "target_repository");
    assert.equal(written.runHealthReport.target_readiness.failure_phase, "target_verification");
    assert.equal(written.runHealthReport.target_readiness.failure_class, "target_verification_blocked");
    assert.equal(written.summary.target_readiness.failure_owner, "target_repository");
    assert.equal(written.summary.target_readiness.failure_phase, "target_verification");
    assert.equal(written.summary.target_readiness.failure_class, "target_verification_blocked");
    assert.equal(written.observationReport.target_readiness.failure_owner, "target_repository");
    assert.equal(written.observationReport.target_readiness.failure_phase, "target_verification");
    assert.equal(written.observationReport.target_readiness.failure_class, "target_verification_blocked");
    for (const artifact of [written.summary, written.observationReport, written.scorecard]) {
      assert.equal(artifact.failure_owner, "target_repository");
      assert.equal(artifact.failure_phase, "target_verification");
      assert.equal(artifact.failure_class, "target_verification_blocked");
    }
    assert.equal(written.runHealthReport.failure_summary.owner, "target_repository");
    assert.equal(written.runHealthReport.failure_summary.phase, "target_verification");
    assert.equal(written.runHealthReport.failure_summary.class, "target_verification_blocked");
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

test("proof runner run-health uses hydrated delivery, verification, and diagnostic facts", () => {
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
        "post-run-diagnostic-summary.json",
        "post-run-diagnostic-step-result.json",
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
    writeJsonFixture(files["post-run-diagnostic-step-result.json"], {
      status: "failed",
      command: "npm test",
      repo_scope: "httpie-cli",
      timed_out: true,
      summary: "Diagnostic command timed out.",
    });
    writeJsonFixture(files["post-run-diagnostic-summary.json"], {
      status: "failed",
      step_result_refs: [files["post-run-diagnostic-step-result.json"]],
      timed_out_commands: [
        {
          repo_scope: "httpie-cli",
          command: "npm test",
          step_result_ref: files["post-run-diagnostic-step-result.json"],
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
        post_run_quality_policy: {
          diagnosticFailureMode: "warn",
          diagnosticCommands: ["npm test"],
        },
        post_run_diagnostic_status: "warn",
        post_run_diagnostic_verify_summary_file: files["post-run-diagnostic-summary.json"],
        post_run_diagnostic_verify_step_result_files: [files["post-run-diagnostic-step-result.json"]],
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
          {
            label: "project-verify-post-run-diagnostic",
            command_surface: "aor project verify",
            diagnostic_intent: "post-run-diagnostic",
            status: "fail",
            exit_code: -1,
            transcript_file: files["post-run-diagnostic-step-result.json"],
            summary: "Diagnostic command timed out.",
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
    assert.equal(written.summary.live_e2e_run_health_overall_status, "warn");
    assert.equal(written.summary.final_skill_agent_verdict_request_file, undefined);
    assert.equal(written.summary.delivery_manifest_file, files["delivery-manifest.json"]);
    assert.equal(written.summary.review_report_file, files["review-report.json"]);
    assert.equal(written.summary.post_run_verify_status, "pass");
    assert.equal(written.summary.real_code_change_status, "pass");
    assert.deepEqual(written.summary.meaningful_changed_paths, [
      "httpie/manager/tasks/plugins.py",
      "tests/test_httpie_cli.py",
    ]);
    assert.equal(written.runHealthReport.overall_status, "warn");
    assert.equal(written.runHealthReport.command_health.failed_command_count, 0);
    assert.equal(written.runHealthReport.diagnostic_health.status, "warn");
    assert.equal(written.runHealthReport.diagnostic_health.timed_out_command_count, 1);
    assert.equal(written.runHealthReport.diagnostic_health.failed_command_count, 1);
    assert.equal(
      written.runHealthReport.diagnostic_health.timed_out_commands[0].failure_owner,
      "target_repository",
    );
    assert.equal(
      written.runHealthReport.diagnostic_health.timed_out_commands[0].diagnostic_intent,
      "post-run-diagnostic",
    );
    assert.equal(
      written.runHealthReport.diagnostic_health.timed_out_commands[0].failure_phase,
      "target_verification",
    );
    assert.equal(
      written.runHealthReport.diagnostic_health.timed_out_commands[0].failure_class,
      "post_run_diagnostic_timeout",
    );
    assert.equal(written.runHealthReport.failure_summary.class, "post_run_diagnostic_warning");
    assert.equal(written.runHealthReport.provider_health.provider_execution_status, "completed");
    assert.equal(written.runHealthReport.provider_health.top_context_size_sources[0].source, "provider_work_packet.context");
    assert.equal(written.runHealthReport.target_environment_health.target_verification_status, "pass");
    assert.equal(written.runHealthReport.failure_summary.owner, "target_repository");
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
