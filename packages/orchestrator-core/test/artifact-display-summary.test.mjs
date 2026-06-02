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
import { readFlowEvidenceGraph, listFlowProjections } from "../src/control-plane/flow-projections.mjs";
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
        evidenceRef(repoRoot, packet.packetFile),
        "evidence://reports/provider-raw-evidence-missing.json",
      ],
      closure_state: {},
      generated_at: "2026-06-02T00:00:00.000Z",
    });

    const flowList = listFlowProjections({ cwd: repoRoot, projectRef: repoRoot });
    const flow = flowList.flows.find((entry) => entry.mission_id === "missing-ref");
    assert.ok(flow);
    const missingSummary = flow.artifact_display_summaries.find((entry) => entry.raw_ref === "evidence://reports/provider-raw-evidence-missing.json");
    assert.equal(missingSummary?.status, "missing");
    assert.equal(missingSummary?.severity, "critical");

    const graph = readFlowEvidenceGraph({ cwd: repoRoot, projectRef: repoRoot, flowId: flow.flow_id });
    const missingNode = graph.nodes.find((node) => node.ref === "evidence://reports/provider-raw-evidence-missing.json");
    assert.equal(missingNode?.display_summary?.status, "missing");
  });
});
