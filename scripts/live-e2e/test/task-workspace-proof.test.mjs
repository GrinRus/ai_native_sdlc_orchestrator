import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTaskWorkspaceProofManifest,
  validateTaskWorkspaceProofManifest,
  validateTaskWorkspaceScenarioEvidence,
} from "../lib/task-workspace-proof.mjs";

test("W70-S09 proof manifest requires all eight screens, canonical actions, and local-only evidence", () => {
  const manifest = buildTaskWorkspaceProofManifest();
  assert.deepEqual(validateTaskWorkspaceProofManifest(manifest), { ok: true, findings: [] });
  assert.equal(manifest.provider_execution, "prohibited");
  assert.equal(manifest.screens.length, 8);
  assert.equal(manifest.compatibility.historical_v2_counts_for_acceptance, false);
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
