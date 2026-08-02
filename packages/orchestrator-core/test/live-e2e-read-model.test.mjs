import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { listRuns, readProjectState } from "../src/control-plane/read-surface.mjs";
import { initializeProjectRuntime } from "../src/project-init.mjs";

function createProject() {
  const projectRoot = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "aor-external-run-projection-")));
  fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, "README.md"), "# External run projection test\n");
  return {
    projectRoot,
    init: initializeProjectRuntime({ projectRef: projectRoot, cwd: projectRoot }),
  };
}

function projection(runId, overrides = {}) {
  return {
    schema_version: 1,
    projection_id: `external-run.${runId}.v1`,
    run_id: runId,
    profile_id: "external-controller-profile",
    status: "blocked",
    report_status: "in_progress",
    generated_at: "2026-07-26T12:00:00.000Z",
    current_step: "delivery",
    blocked_step_id: "delivery",
    pending_steps: ["delivery"],
    completed_steps: ["execution", "review"],
    missing_operator_decision_steps: ["delivery"],
    missing_evidence_refs: [],
    failure_summary: {
      owner: "operator",
      phase: "controller_decision",
      class: "controller_incomplete",
      summary: "Delivery requires an accepted operator decision.",
    },
    pending_decision: {
      action: "diagnose",
      reason: "Inspect public delivery evidence before continuing.",
    },
    resume_interaction_health: {
      status: "blocked",
      pending_interaction_count: 0,
      pending_decision_count: 1,
    },
    controller_health: { status: "blocked", missing_phase_evidence: [] },
    blockers: [{
      code: "external_run.delivery.pending_diagnose",
      severity: "warning",
      summary: "Delivery requires an operator decision.",
    }],
    artifact_display_summaries: [{
      artifact_ref: `evidence://external-runs/${runId}/health`,
      type: "run-health",
      stage: "delivery",
      label: "Run health",
      description: "Delivery is blocked.",
      status: "blocked",
    }],
    evidence_refs: [`evidence://external-runs/${runId}/health`],
    ...overrides,
  };
}

test("control-plane consumes a generic external-run projection from the selected project", () => {
  const { projectRoot, init } = createProject();
  try {
    const runId = "external-run.test.blocked";
    fs.writeFileSync(
      path.join(init.runtimeLayout.reportsRoot, `external-run-projection-${runId}.json`),
      `${JSON.stringify(projection(runId), null, 2)}\n`,
    );
    const state = readProjectState({ projectRef: projectRoot, cwd: projectRoot });
    assert.equal(state.run_health.run_id, runId);
    assert.equal(state.run_health.status, "blocked");
    assert.equal(state.run_health.failure_summary.class, "controller_incomplete");
    assert.ok(state.run_health.blockers.some((entry) => entry.code === "external_run.delivery.pending_diagnose"));
    assert.ok(state.artifact_display_summaries.some((entry) => entry.label === "Run health"));

    const run = listRuns({ projectRef: projectRoot, cwd: projectRoot }).find((entry) => entry.run_id === runId);
    assert.equal(run?.run_health.status, "blocked");
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test("control-plane ignores private filenames and malformed generic ingress", () => {
  const { projectRoot, init } = createProject();
  try {
    fs.writeFileSync(
      path.join(init.runtimeLayout.reportsRoot, "live-e2e-run-health-report-private.json"),
      `${JSON.stringify({ run_id: "private-run", overall_status: "blocked" })}\n`,
    );
    fs.writeFileSync(
      path.join(init.runtimeLayout.reportsRoot, "external-run-projection-invalid.json"),
      `${JSON.stringify({ schema_version: 1, run_id: "invalid" })}\n`,
    );
    const state = readProjectState({ projectRef: projectRoot, cwd: projectRoot });
    assert.equal(state.run_health, null);
    assert.equal(listRuns({ projectRef: projectRoot, cwd: projectRoot }).some((entry) => entry.run_id === "private-run"), false);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});
