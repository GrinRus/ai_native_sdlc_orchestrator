import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTaskWorkspaceProofManifest,
  TASK_WORKSPACE_SCENARIO_IDS,
  validateTaskWorkspaceProofManifest,
  validateTaskWorkspaceScenarioEvidence,
} from "../lib/task-workspace-proof.mjs";

test("W70-S09 proof manifest requires all eight screens, canonical actions, and local-only evidence", () => {
  const manifest = buildTaskWorkspaceProofManifest();
  assert.deepEqual(validateTaskWorkspaceProofManifest(manifest), { ok: true, findings: [] });
  assert.equal(manifest.provider_execution, "prohibited");
  assert.equal(manifest.screens.length, 8);
  assert.equal(manifest.compatibility.historical_v2_counts_for_acceptance, false);
  assert.deepEqual(manifest.scenarios, TASK_WORKSPACE_SCENARIO_IDS);
  assert.equal(manifest.scenario_matrix.length, TASK_WORKSPACE_SCENARIO_IDS.length);
  assert.equal(manifest.closure_requirements.no_upstream_write, true);
});

test("W70-S09 rejects legacy selectors and synthetic API-only evidence", () => {
  const manifest = buildTaskWorkspaceProofManifest();
  manifest.source_text = ["Continue Flow", ".flow-cockpit"];
  const result = validateTaskWorkspaceProofManifest(manifest);
  assert.equal(result.ok, false);
  assert.match(result.findings.join("\n"), /forbidden legacy marker/);

  const evidence = validateTaskWorkspaceScenarioEvidence({ screen_id: "tasks-home", action_id: "task.create", ui_interaction: false });
  assert.equal(evidence.ok, false);
  assert.match(evidence.findings.join("\n"), /durable_public_id/);
  assert.match(evidence.findings.join("\n"), /ui_interaction/);
});

test("W70-S08 closure matrix rejects provider execution, upstream writes, and missing branches", () => {
  const manifest = buildTaskWorkspaceProofManifest();
  manifest.scenario_matrix[0].provider_execution = "allowed";
  assert.equal(validateTaskWorkspaceProofManifest(manifest).ok, false);
  const missing = buildTaskWorkspaceProofManifest();
  missing.scenarios = missing.scenarios.filter((id) => id !== "offline");
  assert.equal(validateTaskWorkspaceProofManifest(missing).ok, false);
  const validEvidence = {
    scenario_id: "completion",
    screen_id: "completion-evidence",
    action_id: "task.complete",
    durable_public_id: "task.completed.1",
    post_reload_readback_ref: "evidence://task.completed.1",
    ui_interaction: true,
    provider_execution: "prohibited",
    upstream_write: "prohibited",
  };
  assert.deepEqual(validateTaskWorkspaceScenarioEvidence(validEvidence), { ok: true, findings: [] });
  assert.equal(validateTaskWorkspaceScenarioEvidence({ ...validEvidence, scenario_id: "live-provider" }).ok, false);
});
