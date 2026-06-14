import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { materializeIntakeArtifactPacket } from "../src/artifact-store.mjs";
import {
  listPacketArtifacts,
  listStepResults,
  readProjectState,
} from "../src/control-plane/read-surface.mjs";
import { readFlowEvidenceGraph, readFlowRuntimeTrace, listFlowProjections } from "../src/control-plane/flow-projections.mjs";
import { buildArtifactDisplaySummary, buildMissingArtifactDisplaySummary } from "../src/artifact-display-summary.mjs";
import { initializeProjectRuntime } from "../src/project-init.mjs";

/**
 * @param {(repoRoot: string) => void} callback
 */
function withCleanRepo(callback) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-artifact-display-"));
  fs.mkdirSync(path.join(repoRoot, ".git"), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, "package.json"), `${JSON.stringify({ name: "artifact-display-target" }, null, 2)}\n`, "utf8");
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
function writeJson(filePath, document) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
}

/**
 * @param {string} repoRoot
 * @param {string} filePath
 * @returns {string}
 */
function evidenceRef(repoRoot, filePath) {
  return `evidence://${path.relative(repoRoot, filePath).replace(/\\/g, "/")}`;
}

test("artifact display summary classifies refs without making raw refs the label", () => {
  const summary = buildArtifactDisplaySummary({
    rawRef: "/very/long/runtime/reports/provider-raw-evidence-qwen.json",
    status: "ready",
  });

  assert.equal(summary.type, "provider-raw-evidence");
  assert.equal(summary.stage, "execution");
  assert.equal(summary.raw_ref, "/very/long/runtime/reports/provider-raw-evidence-qwen.json");
  assert.notEqual(summary.label, summary.raw_ref);
  assert.ok(summary.actions.some((action) => action.action_id === "copy_raw_ref"));

  const successfulCommand = buildArtifactDisplaySummary({
    rawRef: "/runtime/reports/live-e2e-command-traces-run/01-project-init.json",
    status: "exit-0",
  });
  assert.equal(successfulCommand.severity, "success");

  const missing = buildMissingArtifactDisplaySummary("evidence://reports/target-diff-summary.json");
  assert.equal(missing.status, "missing");
  assert.equal(missing.severity, "critical");
  assert.equal(missing.type, "target-diff");
});

test("control-plane read surfaces expose artifact display summaries for packet and step refs", () => {
  withCleanRepo((repoRoot) => {
    const init = initializeProjectRuntime({ cwd: repoRoot, projectRef: repoRoot });
    materializeIntakeArtifactPacket({
      projectId: init.projectId,
      projectRoot: init.projectRoot,
      projectProfileRef: init.projectProfileRef,
      runtimeLayout: init.runtimeLayout,
      command: "aor mission create",
      missionId: "artifact-summary",
      requestTitle: "Artifact summary",
      requestBrief: "Verify display summaries.",
      requestConstraints: ["No raw refs as primary UI labels."],
      goals: ["Expose readable summaries."],
      kpis: [{ kpi_id: "summary", name: "Summary", target: "available" }],
      definitionOfDone: ["Readable artifact summaries are exposed."],
      allowedPaths: ["docs/**"],
      forbiddenPaths: [],
      deliveryMode: "no-write",
      sourceKind: "local-note",
      sourceRef: "docs/artifact-summary.md",
    });

    writeJson(path.join(init.runtimeLayout.reportsRoot, "step-result-run.artifact-summary.json"), {
      step_result_id: "run.artifact-summary.implement.pass",
      project_id: init.projectId,
      run_id: "run.artifact-summary",
      step_id: "run.start.implement",
      step_class: "runner",
      status: "pass",
      summary: "Routed step passed.",
      evidence_refs: ["evidence://reports/step-result-run.artifact-summary.json"],
    });

    const packets = listPacketArtifacts({ cwd: repoRoot, projectRef: repoRoot });
    assert.ok(packets[0]?.display_summary);
    assert.equal(packets[0].display_summary.type, "packet");
    assert.notEqual(packets[0].display_summary.label, packets[0].display_summary.raw_ref);

    const steps = listStepResults({ cwd: repoRoot, projectRef: repoRoot });
    assert.equal(steps[0]?.display_summary.type, "routed-step-result");
    assert.equal(steps[0]?.display_summary.status, "pass");

    const state = readProjectState({ cwd: repoRoot, projectRef: repoRoot });
    assert.ok(state.artifact_display_summaries.some((entry) => entry.type === "packet"));
    assert.ok(state.artifact_display_summaries.some((entry) => entry.type === "routed-step-result"));
  });
});

test("project state exposes live E2E summaries and nested provider heartbeat", () => {
  withCleanRepo((repoRoot) => {
    const init = initializeProjectRuntime({ cwd: repoRoot, projectRef: repoRoot });
    const requestFile = path.join(init.runtimeLayout.reportsRoot, "live-e2e-agent-decision-request-ui-proof-02-spec.json");
    const decisionFile = path.join(init.runtimeLayout.reportsRoot, "live-e2e-operator-decision-ui-proof-02-spec.json");
    const observationFile = path.join(init.runtimeLayout.reportsRoot, "live-e2e-step-observation-ui-proof-02-spec.json");
    writeJson(requestFile, {
      request_id: "ui-proof.spec.operator-decision-request",
      run_id: "ui-proof",
      step_id: "spec",
      operator_decision_expected_ref: decisionFile,
      expected_response_shape: { action: "continue|diagnose|block" },
      decision_rubric: {
        required_evidence_refs: [observationFile],
        frontend_evidence_refs: [],
      },
      created_at: "2026-06-02T00:00:00.000Z",
    });
    writeJson(observationFile, {
      run_id: "ui-proof",
      step_id: "spec",
      flow_stage: "discovery",
      operator_decision_status: "missing",
      deterministic_analysis: { status: "pass" },
      created_at: "2026-06-02T00:01:00.000Z",
    });
    const runSummaryFile = path.join(init.runtimeLayout.reportsRoot, "live-e2e-run-summary-ui-proof.json");
    writeJson(runSummaryFile, {
      run_id: "ui-proof",
      status: "blocked",
      created_at: "2026-06-02T00:02:00.000Z",
    });
    const baselineSummaryFile = path.join(init.runtimeLayout.reportsRoot, "live-e2e-baseline-verify-ui-proof-01-verify-summary-baseline-diagnostic-abc123.json");
    writeJson(baselineSummaryFile, {
      run_id: "github-sandbox.run.ui-proof.verify.baseline-diagnostic.v1",
      status: "passed",
      created_at: "2026-06-02T00:03:00.000Z",
    });
    const baselineCommandFile = path.join(init.runtimeLayout.reportsRoot, "live-e2e-baseline-verify-ui-proof-02-step-result-baseline-diagnostic-1-def456.json");
    writeJson(baselineCommandFile, {
      run_id: "github-sandbox.run.ui-proof.verify.baseline-diagnostic.v1",
      step_id: "verify.baseline-diagnostic.command.1",
      status: "passed",
      command: "npm install --prefer-offline --no-audit --no-fund",
      created_at: "2026-06-02T00:04:00.000Z",
    });
    const assessmentRequestFile = path.join(init.runtimeLayout.reportsRoot, "live-e2e-quality-assessment-request-ui-proof.json");
    writeJson(assessmentRequestFile, {
      run_id: "ui-proof",
      status: "ready",
      created_at: "2026-06-02T00:05:00.000Z",
    });
    const nestedStateFile = path.join(
      init.runtimeLayout.projectRuntimeRoot,
      "target-checkouts",
      "demo",
      ".aor",
      "projects",
      "target.run.ui-proof",
      "state",
      "run-control-state-ui-proof.json",
    );
    writeJson(nestedStateFile, {
      run_id: "ui-proof",
      status: "running",
      provider_step_status: {
        provider: "codex",
        adapter: "codex-cli",
        route_id: "route.spec.default",
        step_id: "spec",
        status: "silent-running",
        elapsed_ms: 65000,
        timeout_budget_ms: 300000,
        remaining_budget_ms: 235000,
        last_output_at: null,
        last_artifact_update_at: null,
        current_command_label: "external-provider-runner",
        recommended_action: "No output yet; provider is still running.",
        started_at: "2026-06-02T00:00:00.000Z",
        updated_at: "2026-06-02T00:01:05.000Z",
      },
    });

    const state = readProjectState({ cwd: repoRoot, projectRef: repoRoot });
    assert.equal(state.provider_step_status?.status, "silent-running");
    assert.equal(state.provider_step_status?.provider, "codex");
    assert.ok(state.artifact_display_summaries.some((entry) =>
      entry.type === "operator-decision-request" &&
      entry.status === "pending" &&
      entry.raw_ref === requestFile,
    ));
    assert.ok(state.artifact_display_summaries.some((entry) =>
      entry.type === "step-observation" &&
      entry.status === "awaiting-decision" &&
      entry.severity === "warning" &&
      entry.raw_ref === observationFile,
    ));
    assert.ok(state.artifact_display_summaries.some((entry) =>
      entry.raw_ref === runSummaryFile &&
      entry.label === "Live E2E run summary",
    ));
    assert.ok(state.artifact_display_summaries.some((entry) =>
      entry.raw_ref === baselineSummaryFile &&
      entry.label === "Baseline verification summary",
    ));
    assert.ok(state.artifact_display_summaries.some((entry) =>
      entry.raw_ref === baselineCommandFile &&
      entry.label === "Baseline check: npm install --prefer-offline --no-audit",
    ));
    assert.ok(state.artifact_display_summaries.some((entry) =>
      entry.raw_ref === assessmentRequestFile &&
      entry.label === "Live E2E quality assessment request",
    ));
  });
});

test("flow projection and evidence graph render missing refs as explicit summaries", () => {
  withCleanRepo((repoRoot) => {
    const init = initializeProjectRuntime({ cwd: repoRoot, projectRef: repoRoot });
    const packet = materializeIntakeArtifactPacket({
      projectId: init.projectId,
      projectRoot: init.projectRoot,
      projectProfileRef: init.projectProfileRef,
      runtimeLayout: init.runtimeLayout,
      command: "aor mission create",
      missionId: "missing-ref",
      requestTitle: "Missing ref",
      requestBrief: "Verify missing evidence rendering.",
      requestConstraints: ["No silent missing rows."],
      goals: ["Expose missing ref finding."],
      kpis: [{ kpi_id: "missing", name: "Missing", target: "visible" }],
      definitionOfDone: ["Missing ref summary exists."],
      allowedPaths: ["docs/**"],
      forbiddenPaths: [],
      deliveryMode: "no-write",
      sourceKind: "local-note",
      sourceRef: "docs/missing-ref.md",
    });
    const reportFile = path.join(init.runtimeLayout.reportsRoot, "next-action-report-missing-ref.json");
    writeJson(reportFile, {
      report_id: "next-action.missing-ref.v1",
      project_id: init.projectId,
      mission_id: "missing-ref",
      mission_state: { mission_id: "missing-ref" },
      project_state: { stage: "review" },
      primary_action: { action_id: "inspect", command: "aor next", reason: "fixture" },
      blockers: [],
      evidence_refs: [
        evidenceRef(repoRoot, init.stateFile),
        evidenceRef(repoRoot, path.join(init.runtimeLayout.reportsRoot, "onboarding-report.json")),
        evidenceRef(repoRoot, packet.packetFile),
        evidenceRef(repoRoot, packet.packetBodyFile),
        "evidence://reports/provider-raw-evidence-missing.json",
      ],
      closure_state: {},
      generated_at: "2026-06-02T00:00:00.000Z",
    });

    const flowList = listFlowProjections({ cwd: repoRoot, projectRef: repoRoot });
    const flow = flowList.flows.find((entry) => entry.mission_id === "missing-ref");
    assert.ok(flow);
    const stateSummary = flow.artifact_display_summaries.find((entry) => entry.raw_ref === evidenceRef(repoRoot, init.stateFile));
    assert.equal(stateSummary?.status, "ready");
    assert.equal(stateSummary?.type, "runtime-state");
    const onboardingSummary = flow.artifact_display_summaries.find((entry) => entry.raw_ref === evidenceRef(repoRoot, path.join(init.runtimeLayout.reportsRoot, "onboarding-report.json")));
    assert.equal(onboardingSummary?.status, "ready");
    assert.equal(onboardingSummary?.type, "onboarding-report");
    const bodySummary = flow.artifact_display_summaries.find((entry) => entry.raw_ref === evidenceRef(repoRoot, packet.packetBodyFile));
    assert.equal(bodySummary?.status, "ready");
    assert.equal(bodySummary?.label, "Mission intake body");
    const missingSummary = flow.artifact_display_summaries.find((entry) => entry.raw_ref === "evidence://reports/provider-raw-evidence-missing.json");
    assert.equal(missingSummary?.status, "missing");
    assert.equal(missingSummary?.severity, "critical");

    const graph = readFlowEvidenceGraph({ cwd: repoRoot, projectRef: repoRoot, flowId: flow.flow_id });
    const stateNode = graph.nodes.find((node) => node.ref === evidenceRef(repoRoot, init.stateFile));
    assert.equal(stateNode?.display_summary?.status, "ready");
    const bodyNode = graph.nodes.find((node) => node.ref === evidenceRef(repoRoot, packet.packetBodyFile));
    assert.equal(bodyNode?.display_summary?.status, "ready");
    const missingNode = graph.nodes.find((node) => node.ref === "evidence://reports/provider-raw-evidence-missing.json");
    assert.equal(missingNode?.display_summary?.status, "missing");

    const trace = readFlowRuntimeTrace({ cwd: repoRoot, projectRef: repoRoot, flowId: flow.flow_id });
    const traceState = trace.trace_items.find((item) => item.ref === evidenceRef(repoRoot, init.stateFile));
    assert.equal(traceState?.display_summary?.status, "ready");
    const traceOnboarding = trace.trace_items.find((item) => item.ref === evidenceRef(repoRoot, path.join(init.runtimeLayout.reportsRoot, "onboarding-report.json")));
    assert.equal(traceOnboarding?.display_summary?.status, "ready");
  });
});
