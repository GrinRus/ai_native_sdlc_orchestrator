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
  writeRuntimeJson(filePath, {
    decision_id: `${runId}.review-decision.${decision}.v1`,
    project_id: init.projectId,
    run_id: runId,
    decision,
    decider_ref: "operator://test",
    reason: `Fixture ${decision} decision.`,
    review_report_ref: `evidence://.aor/projects/${init.projectId}/reports/review-report-${runId}.json`,
    runtime_harness_report_ref: `evidence://.aor/projects/${init.projectId}/reports/runtime-harness-report-${runId}.json`,
    delivery_manifest_refs: [],
    learning_handoff_refs: [],
    decision_basis: {
      review_overall_status: "pass",
      review_recommendation: "proceed",
      runtime_harness_overall_decision: "pass",
      blocking_findings: [],
    },
    delivery_gate: {
      status: held ? "blocked" : "pass",
      blocks_downstream: held,
      required_downstream_decision: "approve",
      findings: held ? [`${decision} blocks downstream delivery.`] : [],
    },
    evidence_refs: [
      `evidence://.aor/projects/${init.projectId}/reports/review-report-${runId}.json`,
      `evidence://.aor/projects/${init.projectId}/reports/runtime-harness-report-${runId}.json`,
    ],
    decided_at: "2026-05-06T00:00:00.000Z",
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
    assert.equal(report.bounded_execution.upstream_writes_default, false);
    assert.equal(report.bounded_execution.requires_review_before_writeback, true);
    assert.equal(fs.existsSync(resolved.nextActionReportFile), true);
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
    assert.equal(report.primary_action.action_id, "closure-complete");
    assert.equal(report.closure_state.learning.status, "handoff-complete");
    assert.ok(report.closure_state.evidence_chain.some((ref) => ref.includes("learning-loop-handoff")));
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
