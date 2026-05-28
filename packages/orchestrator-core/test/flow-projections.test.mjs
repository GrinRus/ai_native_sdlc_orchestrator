import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { materializeIntakeArtifactPacket } from "../src/artifact-store.mjs";
import {
  listFlowProjections,
  readFlowEvidenceGraph,
  readFlowProjection,
  readFlowRuntimeTrace,
  readSelectedFlowProjection,
} from "../src/control-plane/flow-projections.mjs";
import { appendRunEvent } from "../src/control-plane/live-event-stream.mjs";
import { resolveNextAction } from "../src/next-action.mjs";
import { createOperatorRequest } from "../src/operator-request.mjs";
import { initializeProjectRuntime } from "../src/project-init.mjs";

/**
 * @param {(repoRoot: string) => void} callback
 */
function withCleanRepo(callback) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-w34-flow-"));
  fs.mkdirSync(path.join(repoRoot, ".git"), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, "package.json"), `${JSON.stringify({ name: "flow-target" }, null, 2)}\n`, "utf8");
  try {
    callback(repoRoot);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
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
 * @param {string} missionId
 * @param {string} deliveryMode
 * @param {{ followUpSourceHandoffRef?: string }} options
 */
function writeMission(init, missionId, deliveryMode = "patch-only", options = {}) {
  return materializeIntakeArtifactPacket({
    projectId: init.projectId,
    projectRoot: init.projectRoot,
    projectProfileRef: init.projectProfileRef,
    runtimeLayout: init.runtimeLayout,
    command: "aor mission create",
    missionId,
    requestTitle: `Mission ${missionId}`,
    requestBrief: `Deliver ${missionId}.`,
    requestConstraints: ["Keep the flow bounded."],
    goals: [`Complete ${missionId}.`],
    kpis: [
      {
        kpi_id: missionId,
        name: `KPI ${missionId}`,
        target: "Operator can inspect flow evidence.",
      },
    ],
    definitionOfDone: [`${missionId} has inspectable evidence.`],
    allowedPaths: ["docs/**"],
    forbiddenPaths: ["secrets/**"],
    deliveryMode,
    sourceKind: "local-note",
    sourceRef: `docs/${missionId}.md`,
    followUpSourceHandoffRef: options.followUpSourceHandoffRef ?? null,
  });
}

/**
 * @param {ReturnType<typeof initializeProjectRuntime>} init
 * @param {string} runId
 */
function writeCompletedClosure(init, runId) {
  writeRuntimeJson(path.join(init.runtimeLayout.reportsRoot, `step-result-${runId}.json`), {
    step_result_id: `${runId}.implement.pass`,
    project_id: init.projectId,
    run_id: runId,
    step_id: "run.start.implement",
    step_class: "runner",
    status: "pass",
    evidence_refs: [`evidence://reports/step-result-${runId}.json`],
  });
  writeRuntimeJson(path.join(init.runtimeLayout.reportsRoot, `review-report-${runId}.json`), {
    review_report_id: `${runId}.review-report.v1`,
    project_id: init.projectId,
    run_id: runId,
    overall_status: "pass",
    review_recommendation: "proceed",
    findings: [],
    evidence_refs: [`evidence://reports/step-result-${runId}.json`],
  });
  writeRuntimeJson(path.join(init.runtimeLayout.reportsRoot, `runtime-harness-report-${runId}.json`), {
    report_id: `${runId}.runtime-harness-report.v1`,
    project_id: init.projectId,
    run_id: runId,
    overall_decision: "pass",
    run_findings: [],
    evidence_refs: [`evidence://reports/step-result-${runId}.json`],
  });
  writeRuntimeJson(path.join(init.runtimeLayout.reportsRoot, `review-decision-${runId}-approve.json`), {
    decision_id: `${runId}.review-decision.approve.v1`,
    project_id: init.projectId,
    run_id: runId,
    decision: "approve",
    decider_ref: "operator://flow-test",
    reason: "Approved completed flow fixture.",
    review_report_ref: `evidence://reports/review-report-${runId}.json`,
    runtime_harness_report_ref: `evidence://reports/runtime-harness-report-${runId}.json`,
    delivery_manifest_refs: [],
    learning_handoff_refs: [],
    decision_basis: {
      review_overall_status: "pass",
      review_recommendation: "proceed",
      runtime_harness_overall_decision: "pass",
      blocking_findings: [],
    },
    delivery_gate: {
      status: "pass",
      blocks_downstream: false,
      required_downstream_decision: "approve",
      findings: [],
    },
    evidence_refs: [`evidence://reports/review-report-${runId}.json`],
    decided_at: "2026-05-28T00:00:00.000Z",
  });
  writeRuntimeJson(path.join(init.runtimeLayout.artifactsRoot, `delivery-plan-${runId}.json`), {
    plan_id: `${runId}.delivery-plan.implement.v1`,
    project_id: init.projectId,
    run_id: runId,
    step_class: "implement",
    delivery_mode: "patch-only",
    status: "ready",
    blocking_reasons: [],
    evidence_refs: [`evidence://reports/review-decision-${runId}-approve.json`],
  });
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

/**
 * @param {ReturnType<typeof initializeProjectRuntime>} init
 * @returns {string[]}
 */
function runtimeJsonSnapshot(init) {
  return [
    ...fs.readdirSync(init.runtimeLayout.artifactsRoot).map((entry) => `artifacts/${entry}`),
    ...fs.readdirSync(init.runtimeLayout.reportsRoot).map((entry) => `reports/${entry}`),
  ].sort();
}

test("flow projections keep completed evidence read-only while new flow selection advances", () => {
  withCleanRepo((repoRoot) => {
    const init = initializeProjectRuntime({ cwd: repoRoot, projectRef: repoRoot });
    writeMission(init, "checkout-risk", "patch-only");

    const activeNext = resolveNextAction({ cwd: repoRoot, projectRef: repoRoot });
    assert.equal(fs.existsSync(activeNext.nextActionReportArchiveFile), true);

    writeCompletedClosure(init, "run.checkout-risk");
    const completedNext = resolveNextAction({ cwd: repoRoot, projectRef: repoRoot });
    assert.match(completedNext.nextActionReportArchiveFile, /next-action-report-checkout-risk\.json$/u);

    let flowList = listFlowProjections({ cwd: repoRoot, projectRef: repoRoot });
    const checkoutFlowId = `flow.${init.projectId}.checkout-risk`;
    const followUpFlowId = `flow.${init.projectId}.follow-up-risk`;
    const completedFlow = flowList.flows.find((flow) => flow.flow_id === checkoutFlowId);
    assert.ok(completedFlow);
    assert.equal(completedFlow.status, "completed");
    assert.equal(completedFlow.completed_read_only, true);
    assert.equal(completedFlow.closure_state.completed, true);
    assert.equal(completedFlow.closure_state.follow_up_eligible, true);
    assert.ok(completedFlow.evidence_refs.some((ref) => ref.includes("learning-loop-handoff-run.checkout-risk")));
    const sourceHandoffRef = completedFlow.closure_state.recommended_follow_up_source_handoff_ref;
    assert.ok(sourceHandoffRef.includes("learning-loop-handoff-run.checkout-risk"));

    writeMission(init, "follow-up-risk", "no-write", { followUpSourceHandoffRef: sourceHandoffRef });
    const followUpNext = resolveNextAction({ cwd: repoRoot, projectRef: repoRoot });
    assert.equal(followUpNext.nextActionReport.primary_action.action_id, "discovery-run");

    const beforeRead = runtimeJsonSnapshot(init);
    const selectedOnce = readSelectedFlowProjection({ cwd: repoRoot, projectRef: repoRoot });
    const selectedTwice = readSelectedFlowProjection({ cwd: repoRoot, projectRef: repoRoot });
    const afterRead = runtimeJsonSnapshot(init);
    assert.deepEqual(afterRead, beforeRead);
    assert.equal(selectedOnce?.flow_id, followUpFlowId);
    assert.deepEqual(selectedTwice, selectedOnce);

    flowList = listFlowProjections({ cwd: repoRoot, projectRef: repoRoot });
    assert.ok(flowList.active_flow_ids.includes(followUpFlowId));
    assert.ok(flowList.completed_flow_ids.includes(checkoutFlowId));
    assert.equal(flowList.selected_flow_id, followUpFlowId);
    const followUpFlow = flowList.flows.find((flow) => flow.flow_id === followUpFlowId);
    assert.equal(followUpFlow?.follow_up_source_handoff_ref, sourceHandoffRef);
    assert.equal(followUpFlow?.closure_state.follow_up_source_handoff_ref, sourceHandoffRef);
    assert.equal(followUpFlow?.mission_settings.title, "Mission follow-up-risk");

    const detail = readFlowProjection({
      cwd: repoRoot,
      projectRef: repoRoot,
      flowId: checkoutFlowId,
    });
    assert.equal(detail?.latest_next_action_report_ref?.includes("next-action-report-checkout-risk.json"), true);
  });
});

test("flow evidence graph and runtime trace stay scoped and sanitized", () => {
  withCleanRepo((repoRoot) => {
    const init = initializeProjectRuntime({ cwd: repoRoot, projectRef: repoRoot });
    writeMission(init, "checkout-risk", "patch-only");
    resolveNextAction({ cwd: repoRoot, projectRef: repoRoot });
    writeCompletedClosure(init, "run.checkout-risk");
    appendRunEvent({
      cwd: repoRoot,
      projectRef: repoRoot,
      runId: "run.checkout-risk",
      eventType: "run.terminal",
      payload: { summary: "Runtime completed checkout-risk." },
      timestamp: "2026-05-28T00:01:00.000Z",
    });
    resolveNextAction({ cwd: repoRoot, projectRef: repoRoot });

    writeMission(init, "follow-up-risk", "no-write");
    resolveNextAction({ cwd: repoRoot, projectRef: repoRoot });

    const completedFlowId = `flow.${init.projectId}.checkout-risk`;
    const activeFlowId = `flow.${init.projectId}.follow-up-risk`;
    createOperatorRequest({
      cwd: repoRoot,
      projectRef: repoRoot,
      targetFlowId: completedFlowId,
      targetStage: "review",
      intentType: "analyze",
      requestText: "RAW SECRET completed flow analysis text",
      targetRefs: ["README.md"],
      deliveryMode: "no-write",
    });
    createOperatorRequest({
      cwd: repoRoot,
      projectRef: repoRoot,
      targetFlowId: activeFlowId,
      targetStage: "discovery",
      intentType: "analyze",
      requestText: "RAW SECRET active flow analysis text",
      targetRefs: ["README.md"],
      deliveryMode: "no-write",
    });

    const graph = readFlowEvidenceGraph({
      cwd: repoRoot,
      projectRef: repoRoot,
      flowId: completedFlowId,
    });
    assert.ok(graph);
    const serializedGraph = JSON.stringify(graph);
    assert.equal(graph.isolation.excludes_unrelated_flows, true);
    assert.equal(serializedGraph.includes("follow-up-risk"), false);
    assert.equal(serializedGraph.includes("request_text"), false);
    assert.ok(graph.nodes.some((node) => node.family === "operator-request" && node.target_flow_id === completedFlowId));
    assert.ok(graph.nodes.some((node) => node.ref.includes("learning-loop-handoff-run.checkout-risk")));

    const trace = readFlowRuntimeTrace({
      cwd: repoRoot,
      projectRef: repoRoot,
      flowId: completedFlowId,
    });
    assert.ok(trace);
    const kinds = trace.trace_items.map((item) => item.kind);
    assert.ok(kinds.includes("step-result"));
    assert.ok(kinds.includes("runtime-harness-report"));
    assert.ok(kinds.includes("delivery-manifest"));
    assert.ok(kinds.includes("release-packet"));
    assert.ok(kinds.includes("live-event"));
    assert.deepEqual(trace.run_ids, ["run.checkout-risk"]);
    assert.equal(JSON.stringify(trace).includes("request_text"), false);
  });
});
