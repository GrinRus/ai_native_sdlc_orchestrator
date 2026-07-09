import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { materializeIntakeArtifactPacket } from "../src/artifact-store.mjs";
import { resolveNextAction } from "../src/next-action.mjs";
import { initializeProjectRuntime } from "../src/project-init.mjs";

/**
 * @param {(tempRoot: string) => void} callback
 */
function withCleanRepo(callback) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-w21-s04-next-"));
  fs.mkdirSync(path.join(tempRoot, ".git"), { recursive: true });
  fs.writeFileSync(path.join(tempRoot, "package.json"), `${JSON.stringify({ name: "next-target" }, null, 2)}\n`, "utf8");
  try {
    callback(tempRoot);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

/**
 * @param {ReturnType<typeof initializeProjectRuntime>} init
 * @param {Partial<Parameters<typeof materializeIntakeArtifactPacket>[0]>} overrides
 */
function writeMission(init, overrides = {}) {
  return materializeIntakeArtifactPacket({
    projectId: init.projectId,
    projectRoot: init.projectRoot,
    projectProfileRef: init.projectProfileRef,
    runtimeLayout: init.runtimeLayout,
    command: "aor mission create",
    missionId: "checkout-risk",
    requestTitle: "Checkout risk",
    requestBrief: "Reduce checkout risk.",
    requestConstraints: ["Keep changes bounded."],
    goals: ["Make checkout failures actionable."],
    kpis: [
      {
        kpi_id: "checkout-risk",
        name: "Checkout risk",
        target: "Reduce support tickets.",
      },
    ],
    definitionOfDone: ["Checkout error copy is actionable."],
    allowedPaths: ["apps/web/**"],
    forbiddenPaths: ["packages/settlement/**"],
    deliveryMode: "patch-only",
    sourceKind: "local-prd",
    sourceRef: "docs/product/checkout-risk.md",
    ...overrides,
  });
}

/**
 * @param {string} filePath
 * @param {Record<string, unknown>} document
 */
function writeRuntimeJson(filePath, document) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
}

/**
 * @param {string} filePath
 * @param {number} mtimeMs
 */
function setMtime(filePath, mtimeMs) {
  const timestamp = new Date(mtimeMs);
  fs.utimesSync(filePath, timestamp, timestamp);
}

/**
 * @param {string} projectProfilePath
 */
function appendSoftReadinessPolicy(projectProfilePath) {
  fs.appendFileSync(
    projectProfilePath,
    "\nartifact_readiness_policy:\n  research:\n    allow_incomplete_for_spec: true\n    reason: Soft test policy accepts incomplete research for bounded spec drafting.\n",
    "utf8",
  );
  return projectProfilePath;
}

/**
 * @param {ReturnType<typeof initializeProjectRuntime>} init
 */
function writeAnalysisEvidence(init) {
  const filePath = path.join(init.runtimeLayout.reportsRoot, "project-analysis-report.json");
  writeRuntimeJson(filePath, {
    report_id: `${init.projectId}.analysis.v1`,
    project_id: init.projectId,
    discovery_completeness: {
      status: "pass",
      blocking: false,
      checks: [],
    },
    evidence_refs: [],
  });
  return filePath;
}

/**
 * @param {ReturnType<typeof initializeProjectRuntime>} init
 * @param {"adr-ready" | "incomplete"} status
 */
function writeResearchEvidence(init, status) {
  const filePath = path.join(init.runtimeLayout.reportsRoot, "discovery-research-report.json");
  writeRuntimeJson(filePath, {
    report_id: `${init.projectId}.discovery-research.v1`,
    project_id: init.projectId,
    status,
    completeness: {
      status,
      blocking: status !== "adr-ready",
    },
    research_inputs: {
      source_refs: ["evidence://reports/project-analysis-report.json"],
    },
    open_questions: status === "adr-ready" ? [] : ["Which local ADR should own the final spec decision?"],
    evidence_refs: ["evidence://reports/project-analysis-report.json"],
  });
  return filePath;
}

/**
 * @param {ReturnType<typeof initializeProjectRuntime>} init
 */
function writeSpecEvidence(init) {
  const filePath = path.join(init.runtimeLayout.reportsRoot, "step-result-spec-artifact.json");
  writeRuntimeJson(filePath, {
    step_result_id: `${init.projectId}.spec.pass.v1`,
    project_id: init.projectId,
    run_id: `${init.projectId}.spec-artifact`,
    step_id: "artifact.spec",
    step_class: "artifact",
    status: "pass",
    summary: "Spec artifact passed.",
    evidence_refs: ["evidence://reports/discovery-research-report.json"],
    routed_execution: {
      architecture_traceability: {
        selected_step: {
          step_class: "spec",
        },
      },
    },
  });
  return filePath;
}

/**
 * @param {ReturnType<typeof initializeProjectRuntime>} init
 * @param {string} runId
 */
function writeExecutionEvidence(init, runId) {
  const filePath = path.join(init.runtimeLayout.reportsRoot, `step-result-${runId}.json`);
  writeRuntimeJson(filePath, {
    step_result_id: `${runId}.implement.pass`,
    project_id: init.projectId,
    run_id: runId,
    step_id: "run.start.implement",
    step_class: "runner",
    status: "pass",
    summary: "Implementation step passed.",
    evidence_refs: [`evidence://reports/step-result-${runId}.json`],
  });
  return filePath;
}

/**
 * @param {ReturnType<typeof initializeProjectRuntime>} init
 * @param {string} runId
 */
function writeReviewEvidence(init, runId) {
  const reviewReportFile = path.join(init.runtimeLayout.reportsRoot, `review-report-${runId}.json`);
  const runtimeHarnessReportFile = path.join(init.runtimeLayout.reportsRoot, `runtime-harness-report-${runId}.json`);
  writeRuntimeJson(reviewReportFile, {
    review_report_id: `${runId}.review-report.v1`,
    project_id: init.projectId,
    run_id: runId,
    overall_status: "pass",
    review_recommendation: "proceed",
    findings: [],
    evidence_refs: [`evidence://reports/step-result-${runId}.json`],
  });
  writeRuntimeJson(runtimeHarnessReportFile, {
    report_id: `${runId}.runtime-harness-report.v1`,
    project_id: init.projectId,
    run_id: runId,
    overall_decision: "pass",
    run_findings: [],
    evidence_refs: [`evidence://reports/step-result-${runId}.json`],
  });
  return {
    reviewReportFile,
    runtimeHarnessReportFile,
  };
}

/**
 * @param {ReturnType<typeof initializeProjectRuntime>} init
 * @param {string} runId
 * @param {"approve" | "hold" | "request-repair"} decision
 */
function writeReviewDecision(init, runId, decision) {
  const held = decision !== "approve";
  const filePath = path.join(init.runtimeLayout.reportsRoot, `review-decision-${runId}-${decision}.json`);
  const reviewRef = `evidence://.aor/projects/${init.projectId}/reports/review-report-${runId}.json`;
  const harnessRef = `evidence://.aor/projects/${init.projectId}/reports/runtime-harness-report-${runId}.json`;
  writeRuntimeJson(filePath, {
    decision_id: `${runId}.review-decision.${decision}.v1`,
    project_id: init.projectId,
    run_id: runId,
    decision,
    decider_ref: "operator://test",
    reason: `Fixture ${decision} decision.`,
    review_report_ref: reviewRef,
    runtime_harness_report_ref: harnessRef,
    delivery_manifest_refs: [],
    learning_handoff_refs: [],
    decision_basis: {
      review_overall_status: "pass",
      review_recommendation: "proceed",
      runtime_harness_overall_decision: "pass",
      blocking_findings: [],
    },
    repair_context:
      decision === "request-repair"
        ? {
            source_phase: "review",
            cycle_iteration: 1,
            unresolved_findings: ["Fixture repair decision blocks downstream delivery."],
            unresolved_finding_details: [
              {
                finding_id: "fixture.repair",
                category: "review",
                severity: "blocking",
                summary: "Fixture repair decision blocks downstream delivery.",
                evidence_refs: [reviewRef, harnessRef],
                resolution_requirement: "Resolve the fixture repair finding before downstream delivery.",
              },
            ],
            meaningful_changed_paths: [],
	            verification_status: "not_pass",
	            verification_refs: [reviewRef, harnessRef],
	            previous_repair_decision_refs: [],
	            context_fingerprint: "sha256:next-action-fixture-repair",
	            new_context_since_previous: ["first-repair-decision"],
	            stop_reason: "Fixture repair decision requested another execution iteration.",
	            requested_next_step: "execution",
	          }
        : {
            source_phase: "none",
            cycle_iteration: 0,
            unresolved_findings: [],
            unresolved_finding_details: [],
            meaningful_changed_paths: [],
	            verification_status: held ? "not_pass" : "pass",
	            verification_refs: [],
	            previous_repair_decision_refs: [],
	            context_fingerprint: "none",
	            new_context_since_previous: [],
	            stop_reason: "none",
	            requested_next_step: "none",
	          },
    delivery_gate: {
      status: held ? "blocked" : "pass",
      blocks_downstream: held,
      required_downstream_decision: "approve",
      findings: held ? [`${decision} blocks downstream delivery.`] : [],
    },
    evidence_refs: [
      reviewRef,
      harnessRef,
    ],
    decided_at: "2026-05-06T00:00:00.000Z",
  });
  return filePath;
}

/**
 * @param {ReturnType<typeof initializeProjectRuntime>} init
 * @param {string} runId
 * @param {{
 *   sourceStage?: "review" | "qa",
 *   status?: "requested" | "in-progress" | "review-required" | "qa-required" | "budget-exhausted" | "closed",
 *   attemptIndex?: number,
 *   maxAttempts?: number,
 *   remainingAttempts?: number,
 *   blockers?: string[],
 *   operatorOverrideRef?: string | null,
 *   evidenceRefs?: string[],
 * }} [options]
 */
function writeQualityRepairRequest(init, runId, options = {}) {
  const sourceStage = options.sourceStage ?? "review";
  const status = options.status ?? "requested";
  const filePath = path.join(init.runtimeLayout.reportsRoot, `quality-repair-request-${runId}-${sourceStage}-${status}.json`);
  const sourceRef = sourceStage === "qa"
    ? `evidence://.aor/projects/${init.projectId}/reports/runtime-harness-report-${runId}.json`
    : `evidence://.aor/projects/${init.projectId}/reports/review-report-${runId}.json`;
  writeRuntimeJson(filePath, {
    request_id: `${runId}.quality-repair-request.${sourceStage}.v1`,
    project_id: init.projectId,
    run_id: runId,
    cycle_id: `${runId}.quality-cycle.${sourceStage}.v1`,
    source_stage: sourceStage,
    source_ref: sourceRef,
    finding_refs: [`${sourceStage}.finding.fixture`],
    repair_scope: {
      target_step: "implement",
      requested_next_step: "execution",
      allowed_paths: ["apps/web/**"],
      verification_refs: [sourceRef],
      required_evidence_refs: [
        `evidence://.aor/projects/${init.projectId}/reports/review-report-${runId}.json`,
        `evidence://.aor/projects/${init.projectId}/reports/runtime-harness-report-${runId}.json`,
      ],
      compiled_context_refs: [],
      reason: "Fixture quality repair request.",
    },
    attempt_budget: {
      policy_ref: `project-profile://${init.projectId}#quality_repair_policy`,
      max_attempts: options.maxAttempts ?? 2,
      attempt_index: options.attemptIndex ?? 1,
      remaining_attempts: options.remainingAttempts ?? 1,
    },
    status,
    blockers:
      options.blockers ??
      (status === "budget-exhausted"
        ? ["repair-budget-exhausted", "operator-approval-required-before-delivery"]
        : status === "closed"
          ? []
          : [sourceStage === "qa" ? "delivery-blocked-until-post-repair-review-and-qa" : "delivery-blocked-until-post-repair-review"]),
    evidence_refs: [
      sourceRef,
      ...(Array.isArray(options.evidenceRefs) ? options.evidenceRefs.filter((ref) => typeof ref === "string") : []),
    ],
    status_history: [
      {
        status,
        changed_at: "2026-07-04T14:20:00.000Z",
        summary: "Fixture quality repair state.",
        evidence_refs: [sourceRef],
      },
    ],
    created_at: "2026-07-04T14:20:00.000Z",
    updated_at: "2026-07-04T14:20:00.000Z",
    operator_override_ref: options.operatorOverrideRef ?? null,
  });
  return filePath;
}

/**
 * @param {ReturnType<typeof initializeProjectRuntime>} init
 * @param {string} runId
 * @param {string} status
 */
function writeSiblingRunControlState(init, runId, status = "completed") {
  const siblingProjectRoot = path.join(init.runtimeLayout.projectsRoot, `${init.projectId}.execution`);
  const filePath = path.join(siblingProjectRoot, "state", `run-control-state-${runId}.json`);
  writeRuntimeJson(filePath, {
    run_id: runId,
    status,
    current_step: "implement",
    last_action: "start",
    started_at: "2026-07-04T14:21:00.000Z",
    updated_at: "2026-07-04T14:25:00.000Z",
    action_sequence: 1,
  });
  return filePath;
}

/**
 * @param {ReturnType<typeof initializeProjectRuntime>} init
 * @param {string} runId
 * @param {{ status?: string, blockingReasons?: string[] }} [options]
 */
function writeDeliveryPlan(init, runId, options = {}) {
  const filePath = path.join(init.runtimeLayout.artifactsRoot, `delivery-plan-${runId}.json`);
  writeRuntimeJson(filePath, {
    plan_id: `${runId}.delivery-plan.implement.v1`,
    project_id: init.projectId,
    run_id: runId,
    step_class: "implement",
    delivery_mode: "patch-only",
    status: options.status ?? "ready",
    blocking_reasons: options.blockingReasons ?? [],
    evidence_refs: [`evidence://reports/review-decision-${runId}-approve.json`],
  });
  return filePath;
}

/**
 * @param {ReturnType<typeof initializeProjectRuntime>} init
 * @param {string} runId
 */
function writeReleaseEvidence(init, runId) {
  writeRuntimeJson(path.join(init.runtimeLayout.artifactsRoot, `delivery-manifest-${runId}.json`), {
    manifest_id: `${runId}.delivery-manifest.v1`,
    project_id: init.projectId,
    run_refs: [runId],
    status: "submitted",
    repo_deliveries: [{ repo_id: "target", writeback_result: "patch-created" }],
    evidence_refs: [`evidence://artifacts/delivery-plan-${runId}.json`],
  });
  writeRuntimeJson(path.join(init.runtimeLayout.artifactsRoot, `release-packet-${runId}.json`), {
    packet_id: `${runId}.release-packet.v1`,
    project_id: init.projectId,
    run_refs: [runId],
    status: "ready-for-close",
    delivery_manifest_ref: `evidence://artifacts/delivery-manifest-${runId}.json`,
    evidence_lineage: {
      execution_refs: [`evidence://artifacts/delivery-plan-${runId}.json`],
      delivery_output_refs: [`evidence://artifacts/delivery-manifest-${runId}.json`],
    },
    evidence_refs: [`evidence://artifacts/delivery-manifest-${runId}.json`],
  });
}

/**
 * @param {ReturnType<typeof initializeProjectRuntime>} init
 * @param {string} runId
 */
function writeLearningHandoff(init, runId) {
  writeRuntimeJson(path.join(init.runtimeLayout.reportsRoot, `learning-loop-scorecard-${runId}.json`), {
    scorecard_id: `${runId}.learning-loop.scorecard.v1`,
    project_id: init.projectId,
    run_id: runId,
    status: "complete",
    evidence_refs: [`evidence://artifacts/release-packet-${runId}.json`],
  });
  writeRuntimeJson(path.join(init.runtimeLayout.reportsRoot, `learning-loop-handoff-${runId}.json`), {
    handoff_id: `${runId}.learning-loop.handoff.v1`,
    project_id: init.projectId,
    run_id: runId,
    status: "complete",
    evidence_refs: [
      `evidence://reports/learning-loop-scorecard-${runId}.json`,
      `evidence://artifacts/release-packet-${runId}.json`,
    ],
  });
}

test("resolveNextAction recommends discovery for complete guided mission intake", () => {
  withCleanRepo((tempRoot) => {
    const init = initializeProjectRuntime({ cwd: tempRoot, projectRef: tempRoot });
    writeMission(init);

    const resolved = resolveNextAction({ cwd: tempRoot, projectRef: tempRoot });
    const report = resolved.nextActionReport;

    assert.equal(report.status, "ready");
    assert.equal(report.project_state.stage, "discovery");
    assert.equal(report.primary_action.action_id, "discovery-run");
    assert.match(report.primary_action.command, /aor discovery run/);
    assert.equal(report.mission_state.completeness_status, "complete");
    assert.equal(report.mission_state.delivery_mode, "patch-only");
    assert.deepEqual(report.mission_state.allowed_paths, ["apps/web/**"]);
    assert.equal(report.artifact_readiness.stages.mission.status, "complete");
    assert.equal(report.artifact_readiness.stages.discovery.status, "pending");
    assert.equal(report.artifact_readiness.stages.research.status, "pending");
    assert.equal(report.artifact_readiness.stages.spec.status, "blocked");
    assert.equal(report.bounded_execution.upstream_writes_default, false);
    assert.equal(report.bounded_execution.requires_review_before_writeback, true);
    assert.equal(fs.existsSync(resolved.nextActionReportFile), true);
  });
});

test("resolveNextAction blocks spec when strict research readiness is incomplete", () => {
  withCleanRepo((tempRoot) => {
    const init = initializeProjectRuntime({ cwd: tempRoot, projectRef: tempRoot });
    writeMission(init);
    writeAnalysisEvidence(init);
    writeResearchEvidence(init, "incomplete");

    const report = resolveNextAction({ cwd: tempRoot, projectRef: tempRoot }).nextActionReport;

    assert.equal(report.status, "blocked");
    assert.equal(report.project_state.stage, "research");
    assert.equal(report.primary_action.action_id, "discovery-run");
    assert.equal(report.artifact_readiness.policy.mode, "strict");
    assert.equal(report.artifact_readiness.stages.discovery.status, "complete");
    assert.equal(report.artifact_readiness.stages.research.status, "blocked");
    assert.equal(report.artifact_readiness.stages.spec.status, "blocked");
    assert.equal(report.blockers[0].code, "research-adr-ready-required");
  });
});

test("resolveNextAction allows spec from incomplete research only with soft readiness policy", () => {
  withCleanRepo((tempRoot) => {
    const init = initializeProjectRuntime({ cwd: tempRoot, projectRef: tempRoot });
    const projectProfile = appendSoftReadinessPolicy(init.projectProfilePath);
    writeMission(init);
    writeAnalysisEvidence(init);
    writeResearchEvidence(init, "incomplete");

    const report = resolveNextAction({ cwd: tempRoot, projectRef: tempRoot, projectProfile }).nextActionReport;

    assert.equal(report.status, "ready");
    assert.equal(report.project_state.stage, "spec-build");
    assert.equal(report.primary_action.action_id, "spec-build");
    assert.equal(report.artifact_readiness.policy.mode, "soft");
    assert.equal(report.artifact_readiness.stages.research.status, "incomplete");
    assert.equal(report.artifact_readiness.stages.research.soft_decision.allowed, true);
    assert.equal(report.artifact_readiness.stages.spec.status, "pending");
  });
});

test("resolveNextAction marks spec stale when upstream research changes", () => {
  withCleanRepo((tempRoot) => {
    const init = initializeProjectRuntime({ cwd: tempRoot, projectRef: tempRoot });
    writeMission(init);
    writeAnalysisEvidence(init);
    const researchFile = writeResearchEvidence(init, "adr-ready");
    const specFile = writeSpecEvidence(init);
    setMtime(researchFile, fs.statSync(specFile).mtimeMs + 2_000);

    const report = resolveNextAction({ cwd: tempRoot, projectRef: tempRoot }).nextActionReport;

    assert.equal(report.status, "blocked");
    assert.equal(report.project_state.stage, "spec-build");
    assert.equal(report.primary_action.action_id, "spec-build");
    assert.equal(report.artifact_readiness.stages.research.status, "adr-ready");
    assert.equal(report.artifact_readiness.stages.spec.status, "stale");
    assert.deepEqual(report.artifact_readiness.stages.spec.stale_reasons, ["research-changed-after-spec"]);
    assert.equal(report.blockers[0].code, "spec-stale");
  });
});

test("resolveNextAction routes ready spec evidence to planning instead of closure review", () => {
  withCleanRepo((tempRoot) => {
    const init = initializeProjectRuntime({ cwd: tempRoot, projectRef: tempRoot });
    writeMission(init);
    writeAnalysisEvidence(init);
    writeResearchEvidence(init, "adr-ready");
    writeSpecEvidence(init);

    const report = resolveNextAction({ cwd: tempRoot, projectRef: tempRoot }).nextActionReport;

    assert.equal(report.status, "ready");
    assert.equal(report.project_state.stage, "planning");
    assert.equal(report.primary_action.action_id, "handoff-prepare");
    assert.equal(report.artifact_readiness.stages.spec.status, "ready");
    assert.equal(report.artifact_readiness.stages.planning.status, "pending");
    assert.equal(report.closure_state.run_id, null);
  });
});

test("resolveNextAction recommends review run when execution evidence has no closure review", () => {
  withCleanRepo((tempRoot) => {
    const init = initializeProjectRuntime({ cwd: tempRoot, projectRef: tempRoot });
    writeMission(init);
    writeExecutionEvidence(init, "run.closure.review");

    const report = resolveNextAction({ cwd: tempRoot, projectRef: tempRoot }).nextActionReport;

    assert.equal(report.status, "ready");
    assert.equal(report.project_state.stage, "review");
    assert.equal(report.primary_action.action_id, "review-run");
    assert.equal(report.closure_state.run_id, "run.closure.review");
    assert.equal(report.closure_state.review.status, "missing");
    assert.equal(report.closure_state.delivery.status, "blocked-review-required");
    assert.ok(report.primary_action.command.includes("aor review run"));
  });
});

test("resolveNextAction recommends approve decision after review and harness evidence", () => {
  withCleanRepo((tempRoot) => {
    const init = initializeProjectRuntime({ cwd: tempRoot, projectRef: tempRoot });
    writeMission(init);
    writeExecutionEvidence(init, "run.closure.decision");
    writeReviewEvidence(init, "run.closure.decision");

    const report = resolveNextAction({ cwd: tempRoot, projectRef: tempRoot }).nextActionReport;

    assert.equal(report.status, "ready");
    assert.equal(report.project_state.stage, "review");
    assert.equal(report.primary_action.action_id, "review-decide");
    assert.equal(report.closure_state.review.status, "decision-required");
    assert.equal(report.closure_state.delivery.blocked_reasons.includes("approved-review-decision-required"), true);
  });
});

test("resolveNextAction routes approved review decisions to gated delivery preparation", () => {
  withCleanRepo((tempRoot) => {
    const init = initializeProjectRuntime({ cwd: tempRoot, projectRef: tempRoot });
    writeMission(init);
    writeExecutionEvidence(init, "run.closure.approve");
    writeReviewEvidence(init, "run.closure.approve");
    writeReviewDecision(init, "run.closure.approve", "approve");

    const report = resolveNextAction({ cwd: tempRoot, projectRef: tempRoot }).nextActionReport;

    assert.equal(report.status, "ready");
    assert.equal(report.project_state.stage, "delivery");
    assert.equal(report.primary_action.action_id, "delivery-prepare");
    assert.match(report.primary_action.command, /--require-review-decision/);
    assert.equal(report.closure_state.review.status, "approved");
    assert.equal(report.closure_state.delivery.status, "ready-to-prepare");
  });
});

test("resolveNextAction blocks held and repair-requested review decisions", () => {
  withCleanRepo((tempRoot) => {
    const init = initializeProjectRuntime({ cwd: tempRoot, projectRef: tempRoot });
    writeMission(init);
    writeExecutionEvidence(init, "run.closure.hold");
    writeReviewEvidence(init, "run.closure.hold");
    writeReviewDecision(init, "run.closure.hold", "hold");

    const held = resolveNextAction({ cwd: tempRoot, projectRef: tempRoot }).nextActionReport;
    assert.equal(held.status, "blocked");
    assert.equal(held.primary_action.action_id, "resolve-review-hold");
    assert.equal(held.blockers[0].code, "review-held");
    assert.equal(held.closure_state.review.status, "held");
  });

  withCleanRepo((tempRoot) => {
    const init = initializeProjectRuntime({ cwd: tempRoot, projectRef: tempRoot });
    writeMission(init);
    writeExecutionEvidence(init, "run.closure.repair");
    writeReviewEvidence(init, "run.closure.repair");
    writeReviewDecision(init, "run.closure.repair", "request-repair");

    const repair = resolveNextAction({ cwd: tempRoot, projectRef: tempRoot }).nextActionReport;
    assert.equal(repair.status, "blocked");
    assert.equal(repair.primary_action.action_id, "run-review-repair");
    assert.equal(repair.blockers[0].code, "review-repair-requested");
    assert.equal(repair.closure_state.review.status, "repair-requested");
  });
});

test("resolveNextAction returns one safe primary action for quality repair request states", () => {
  withCleanRepo((tempRoot) => {
    const init = initializeProjectRuntime({ cwd: tempRoot, projectRef: tempRoot });
    writeMission(init);
    writeExecutionEvidence(init, "run.quality.review-requested");
    writeReviewEvidence(init, "run.quality.review-requested");
    writeQualityRepairRequest(init, "run.quality.review-requested", { sourceStage: "review", status: "requested" });

    const report = resolveNextAction({ cwd: tempRoot, projectRef: tempRoot }).nextActionReport;
    assert.equal(report.status, "blocked");
    assert.equal(report.project_state.stage, "repair");
    assert.equal(report.primary_action.action_id, "run-review-quality-repair");
    assert.equal(report.blockers[0].code, "review-repair-requested");
    assert.equal(report.closure_state.quality_repair.flow_state, "review-repair-requested");
    assert.equal(report.closure_state.delivery.status, "blocked-quality-repair");
    assert.equal(report.quality_repair_lineage.request_ref, report.closure_state.quality_repair.request_ref);
  });

  withCleanRepo((tempRoot) => {
    const init = initializeProjectRuntime({ cwd: tempRoot, projectRef: tempRoot });
    const runId = "run.quality.guarded-repair";
    const handoffEvidenceRef = `evidence://.aor/projects/${init.projectId}/artifacts/${init.projectId}.handoff.bootstrap.v1.json`;
    const handoffFile = path.join(init.runtimeLayout.artifactsRoot, `${init.projectId}.handoff.bootstrap.v1.json`);
    const readinessRef = `/tmp/live-e2e-execution-readiness-${runId}.json`;
    const implementRef = `evidence://.aor/projects/${init.projectId}/reports/step-result-routed-${runId}.routed.implement.implement.attempt.1.json`;
    writeMission(init);
    writeExecutionEvidence(init, runId);
    writeReviewEvidence(init, runId);
    writeQualityRepairRequest(init, runId, {
      sourceStage: "review",
      status: "requested",
      evidenceRefs: [handoffEvidenceRef, handoffFile, readinessRef, implementRef],
    });

    const report = resolveNextAction({ cwd: tempRoot, projectRef: tempRoot }).nextActionReport;
    assert.equal(report.primary_action.action_id, "run-review-quality-repair");
    assert.match(report.primary_action.command, /--approved-handoff-ref/u);
    assert.match(report.primary_action.command, /--promotion-evidence-refs/u);
    assert.match(report.primary_action.command, new RegExp(handoffFile.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
    assert.match(report.primary_action.command, new RegExp(readinessRef.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
    assert.match(report.primary_action.command, new RegExp(implementRef.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
    assert.equal(report.blockers[0].next_command, report.primary_action.command);
  });

  withCleanRepo((tempRoot) => {
    const init = initializeProjectRuntime({ cwd: tempRoot, projectRef: tempRoot });
    writeMission(init);
    writeExecutionEvidence(init, "run.quality.qa-requested");
    writeReviewEvidence(init, "run.quality.qa-requested");
    writeQualityRepairRequest(init, "run.quality.qa-requested", { sourceStage: "qa", status: "requested" });

    const report = resolveNextAction({ cwd: tempRoot, projectRef: tempRoot }).nextActionReport;
    assert.equal(report.status, "blocked");
    assert.equal(report.primary_action.action_id, "run-qa-quality-repair");
    assert.equal(report.blockers[0].code, "qa-repair-requested");
    assert.equal(report.closure_state.quality_repair.flow_state, "qa-repair-requested");
    assert.match(report.primary_action.command, /--target-step implement/u);
    assert.match(report.primary_action.reason, /review and QA/u);
  });

  withCleanRepo((tempRoot) => {
    const init = initializeProjectRuntime({ cwd: tempRoot, projectRef: tempRoot });
    writeMission(init);
    writeExecutionEvidence(init, "run.quality.review-required");
    writeReviewEvidence(init, "run.quality.review-required");
    writeQualityRepairRequest(init, "run.quality.review-required", { status: "review-required" });

    const report = resolveNextAction({ cwd: tempRoot, projectRef: tempRoot }).nextActionReport;
    assert.equal(report.status, "ready");
    assert.equal(report.project_state.stage, "review");
    assert.equal(report.primary_action.action_id, "review-quality-repair");
    assert.match(report.primary_action.command, /aor review run/u);
    assert.equal(report.closure_state.quality_repair.flow_state, "review-required");
  });

  withCleanRepo((tempRoot) => {
    const init = initializeProjectRuntime({ cwd: tempRoot, projectRef: tempRoot });
    const runId = "run.quality.completed-repair";
    writeMission(init);
    writeExecutionEvidence(init, runId);
    writeReviewEvidence(init, runId);
    writeQualityRepairRequest(init, runId, {
      sourceStage: "review",
      status: "requested",
      remainingAttempts: 0,
    });
    const repairStateFile = writeSiblingRunControlState(init, `${runId}.repair`, "completed");

    const report = resolveNextAction({ cwd: tempRoot, projectRef: tempRoot }).nextActionReport;
    assert.equal(report.status, "ready");
    assert.equal(report.project_state.stage, "review");
    assert.equal(report.primary_action.action_id, "review-quality-repair");
    assert.match(report.primary_action.command, new RegExp(`--run-id ${runId}\\.repair`, "u"));
    assert.equal(report.closure_state.quality_repair.status, "requested");
    assert.equal(report.closure_state.quality_repair.flow_state, "review-required");
    assert.ok(
      report.closure_state.quality_repair.evidence_refs.some((ref) =>
        ref.endsWith(path.relative(tempRoot, repairStateFile).replace(/\\/gu, "/")),
      ),
    );
  });

  withCleanRepo((tempRoot) => {
    const init = initializeProjectRuntime({ cwd: tempRoot, projectRef: tempRoot });
    writeMission(init);
    writeExecutionEvidence(init, "run.quality.qa-required");
    writeReviewEvidence(init, "run.quality.qa-required");
    writeQualityRepairRequest(init, "run.quality.qa-required", { sourceStage: "qa", status: "qa-required" });

    const report = resolveNextAction({ cwd: tempRoot, projectRef: tempRoot }).nextActionReport;
    assert.equal(report.status, "ready");
    assert.equal(report.project_state.stage, "qa");
    assert.equal(report.primary_action.action_id, "qa-quality-repair");
    assert.match(report.primary_action.command, /--target-step qa/u);
    assert.equal(report.closure_state.quality_repair.flow_state, "qa-required");
  });

  withCleanRepo((tempRoot) => {
    const init = initializeProjectRuntime({ cwd: tempRoot, projectRef: tempRoot });
    writeMission(init);
    writeExecutionEvidence(init, "run.quality.exhausted");
    writeReviewEvidence(init, "run.quality.exhausted");
    writeQualityRepairRequest(init, "run.quality.exhausted", {
      status: "budget-exhausted",
      maxAttempts: 1,
      attemptIndex: 1,
      remainingAttempts: 0,
    });

    const report = resolveNextAction({ cwd: tempRoot, projectRef: tempRoot }).nextActionReport;
    assert.equal(report.status, "blocked");
    assert.equal(report.primary_action.action_id, "hold-exhausted-quality-repair");
    assert.equal(report.blockers[0].code, "repair-cycle-exhausted");
    assert.equal(report.primary_action.command.includes("run start"), false);
    assert.equal(report.closure_state.quality_repair.flow_state, "repair-cycle-exhausted");
  });

  withCleanRepo((tempRoot) => {
    const init = initializeProjectRuntime({ cwd: tempRoot, projectRef: tempRoot });
    writeMission(init);
    writeExecutionEvidence(init, "run.quality.closed");
    writeReviewEvidence(init, "run.quality.closed");
    writeReviewDecision(init, "run.quality.closed", "approve");
    writeQualityRepairRequest(init, "run.quality.closed", { status: "closed" });

    const report = resolveNextAction({ cwd: tempRoot, projectRef: tempRoot }).nextActionReport;
    assert.equal(report.status, "ready");
    assert.equal(report.project_state.stage, "delivery");
    assert.equal(report.primary_action.action_id, "delivery-prepare");
    assert.equal(report.closure_state.quality_repair.flow_state, "delivery-ready");
    assert.equal(report.closure_state.delivery.status, "ready-to-prepare");
  });
});

test("resolveNextAction can scope quality repair guidance to an explicit run", () => {
  withCleanRepo((tempRoot) => {
    const init = initializeProjectRuntime({ cwd: tempRoot, projectRef: tempRoot });
    writeMission(init, {
      kpis: [],
      definitionOfDone: [],
      deliveryMode: "no-write",
    });
    writeExecutionEvidence(init, "run.quality.scoped");
    writeReviewEvidence(init, "run.quality.scoped");
    writeQualityRepairRequest(init, "run.quality.scoped", { sourceStage: "review", status: "requested" });

    const projectReport = resolveNextAction({ cwd: tempRoot, projectRef: tempRoot }).nextActionReport;
    assert.equal(projectReport.project_state.stage, "mission-intake");

    const runReport = resolveNextAction({ cwd: tempRoot, projectRef: tempRoot, runId: "run.quality.scoped" }).nextActionReport;
    assert.equal(runReport.status, "blocked");
    assert.equal(runReport.project_state.stage, "repair");
    assert.equal(runReport.primary_action.action_id, "run-review-quality-repair");
    assert.equal(runReport.closure_state.run_id, "run.quality.scoped");
    assert.equal(runReport.closure_state.quality_repair.flow_state, "review-repair-requested");
  });
});

test("resolveNextAction blocks delivery when prepared evidence keeps safety blockers", () => {
  withCleanRepo((tempRoot) => {
    const init = initializeProjectRuntime({ cwd: tempRoot, projectRef: tempRoot });
    writeMission(init);
    writeExecutionEvidence(init, "run.closure.blocked-delivery");
    writeReviewEvidence(init, "run.closure.blocked-delivery");
    writeReviewDecision(init, "run.closure.blocked-delivery", "approve");
    writeDeliveryPlan(init, "run.closure.blocked-delivery", {
      status: "blocked",
      blockingReasons: ["promotion-evidence-required"],
    });

    const report = resolveNextAction({ cwd: tempRoot, projectRef: tempRoot }).nextActionReport;

    assert.equal(report.status, "blocked");
    assert.equal(report.project_state.stage, "delivery");
    assert.equal(report.primary_action.action_id, "fix-delivery-blockers");
    assert.equal(report.blockers[0].code, "promotion-evidence-required");
    assert.equal(report.closure_state.delivery.status, "blocked");
  });
});

test("resolveNextAction routes release-ready evidence to learning handoff and closure completion", () => {
  withCleanRepo((tempRoot) => {
    const init = initializeProjectRuntime({ cwd: tempRoot, projectRef: tempRoot });
    writeMission(init);
    writeExecutionEvidence(init, "run.closure.learning");
    writeReviewEvidence(init, "run.closure.learning");
    writeReviewDecision(init, "run.closure.learning", "approve");
    writeDeliveryPlan(init, "run.closure.learning");
    writeReleaseEvidence(init, "run.closure.learning");

    const report = resolveNextAction({ cwd: tempRoot, projectRef: tempRoot }).nextActionReport;

    assert.equal(report.status, "ready");
    assert.equal(report.project_state.stage, "learning");
    assert.equal(report.primary_action.action_id, "learning-handoff");
    assert.equal(report.closure_state.delivery.status, "release-ready");
    assert.equal(report.closure_state.learning.status, "ready-for-handoff");
  });

  withCleanRepo((tempRoot) => {
    const init = initializeProjectRuntime({ cwd: tempRoot, projectRef: tempRoot });
    writeMission(init);
    writeExecutionEvidence(init, "run.closure.complete");
    writeReviewEvidence(init, "run.closure.complete");
    writeReviewDecision(init, "run.closure.complete", "approve");
    writeDeliveryPlan(init, "run.closure.complete");
    writeReleaseEvidence(init, "run.closure.complete");
    writeLearningHandoff(init, "run.closure.complete");

    const report = resolveNextAction({ cwd: tempRoot, projectRef: tempRoot }).nextActionReport;

    assert.equal(report.status, "ready");
    assert.equal(report.project_state.stage, "learning");
    assert.equal(report.primary_action.action_id, "start-new-flow");
    assert.match(report.primary_action.command, /mission create/u);
    assert.match(report.primary_action.command, /--follow-up-source-handoff-ref/u);
    assert.equal(report.closure_state.learning.status, "handoff-complete");
    assert.ok(report.closure_state.evidence_chain.some((ref) => ref.includes("learning-loop-handoff")));
    assert.equal(report.bounded_execution.upstream_writes_default, false);
  });

  withCleanRepo((tempRoot) => {
    const init = initializeProjectRuntime({ cwd: tempRoot, projectRef: tempRoot });
    writeMission(init);
    writeExecutionEvidence(init, "run.closure.complete");
    writeReviewEvidence(init, "run.closure.complete");
    writeReviewDecision(init, "run.closure.complete", "approve");
    writeDeliveryPlan(init, "run.closure.complete");
    writeReleaseEvidence(init, "run.closure.complete");
    writeLearningHandoff(init, "run.closure.complete");
    writeExecutionEvidence(init, "run.post-run-diagnostic");

    const report = resolveNextAction({ cwd: tempRoot, projectRef: tempRoot }).nextActionReport;

    assert.equal(report.project_state.stage, "learning");
    assert.equal(report.primary_action.action_id, "start-new-flow");
    assert.equal(report.closure_state.run_id, "run.closure.complete");
    assert.equal(report.closure_state.learning.status, "handoff-complete");
  });

  withCleanRepo((tempRoot) => {
    const init = initializeProjectRuntime({ cwd: tempRoot, projectRef: tempRoot });
    writeMission(init);
    writeExecutionEvidence(init, "run.learning.partial-release");
    writeReviewEvidence(init, "run.learning.partial-release");
    writeReviewDecision(init, "run.learning.partial-release", "approve");
    writeDeliveryPlan(init, "run.learning.partial-release");
    writeLearningHandoff(init, "run.learning.partial-release");

    const report = resolveNextAction({ cwd: tempRoot, projectRef: tempRoot }).nextActionReport;

    assert.equal(report.project_state.stage, "learning");
    assert.equal(report.primary_action.action_id, "start-new-flow");
    assert.equal(report.closure_state.delivery.status, "delivery-plan-ready");
    assert.equal(report.closure_state.learning.status, "handoff-complete");
  });
});

test("resolveNextAction blocks when guided mission intake is missing KPI and Definition of Done", () => {
  withCleanRepo((tempRoot) => {
    const init = initializeProjectRuntime({ cwd: tempRoot, projectRef: tempRoot });
    writeMission(init, {
      kpis: [],
      definitionOfDone: [],
      deliveryMode: "no-write",
    });

    const report = resolveNextAction({ cwd: tempRoot, projectRef: tempRoot }).nextActionReport;
    const blockerCodes = report.blockers.map((blocker) => blocker.code);

    assert.equal(report.status, "blocked");
    assert.equal(report.project_state.stage, "mission-intake");
    assert.equal(report.primary_action.action_id, "complete-mission-intake");
    assert.deepEqual(report.mission_state.missing_fields, ["kpis", "definition_of_done"]);
    assert.ok(blockerCodes.includes("mission-kpis-missing"));
    assert.ok(blockerCodes.includes("mission-definition_of_done-missing"));
    assert.equal(report.bounded_execution.delivery_capable_mode, false);
  });
});

test("resolveNextAction preserves explicit runtime root in primary and blocker commands", () => {
  withCleanRepo((tempRoot) => {
    const defaultReport = resolveNextAction({ cwd: tempRoot, projectRef: tempRoot }).nextActionReport;
    assert.equal(defaultReport.primary_action.command.includes("--runtime-root"), false);

    const runtimeRoot = path.join(tempRoot, "custom-aor-runtime");
    const runtimeRootFlag = `--runtime-root ${runtimeRoot}`;
    const init = initializeProjectRuntime({ cwd: tempRoot, projectRef: tempRoot, runtimeRoot });
    writeMission(init, {
      kpis: [],
      definitionOfDone: [],
      deliveryMode: "no-write",
    });

    const report = resolveNextAction({ cwd: tempRoot, projectRef: tempRoot, runtimeRoot }).nextActionReport;
    assert.equal(report.status, "blocked");
    assert.ok(report.primary_action.command.includes(runtimeRootFlag));
    assert.ok(report.blockers.every((blocker) => String(blocker.next_command).includes(runtimeRootFlag)));
  });
});

test("resolveNextAction points to run status when a run is already active", () => {
  withCleanRepo((tempRoot) => {
    const init = initializeProjectRuntime({ cwd: tempRoot, projectRef: tempRoot });
    const runStateFile = path.join(init.runtimeLayout.stateRoot, "run-control-state-active-mission.json");
    fs.writeFileSync(
      runStateFile,
      `${JSON.stringify({ run_id: "active-mission", status: "running" }, null, 2)}\n`,
      "utf8",
    );

    const report = resolveNextAction({ cwd: tempRoot, projectRef: tempRoot }).nextActionReport;

    assert.equal(report.status, "ready");
    assert.equal(report.project_state.stage, "run-active");
    assert.equal(report.primary_action.action_id, "inspect-active-run");
    assert.match(report.primary_action.command, /aor run status/);
    assert.match(report.primary_action.command, /--run-id active-mission/);
  });
});

test("resolveNextAction blocks invalid mission packet state when body_ref is unreadable", () => {
  withCleanRepo((tempRoot) => {
    const init = initializeProjectRuntime({ cwd: tempRoot, projectRef: tempRoot });
    const intake = writeMission(init);
    fs.rmSync(intake.packetBodyFile, { force: true });

    const report = resolveNextAction({ cwd: tempRoot, projectRef: tempRoot }).nextActionReport;

    assert.equal(report.status, "blocked");
    assert.equal(report.primary_action.action_id, "repair-mission-intake");
    assert.equal(report.blockers[0].code, "intake-body-missing");
  });
});
