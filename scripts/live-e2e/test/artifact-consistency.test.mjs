import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { evaluateArtifactConsistency } from "../lib/artifact-consistency.mjs";

function buildFixture(root) {
  const matrixCell = { cell_id: "fixture.medium.local" };
  const coverageFollowUp = { current_cell_required: true, next_required_matrix_cell: { cell_id: "fixture.next" } };
  const learning = { matrix_cell: matrixCell, coverage_follow_up: coverageFollowUp };
  const handoffFile = path.join(root, "learning-handoff.json");
  const scorecardFile = path.join(root, "learning-scorecard.json");
  fs.writeFileSync(handoffFile, JSON.stringify(learning));
  fs.writeFileSync(scorecardFile, JSON.stringify(learning));
  return {
    artifacts: { matrix_cell: matrixCell, coverage_follow_up: coverageFollowUp, learning_loop_handoff_file: handoffFile, learning_loop_scorecard_file: scorecardFile },
    reviewReport: { feature_traceability: { matrix_cell: matrixCell, coverage_follow_up: coverageFollowUp } },
    auditPayload: { run_audit_records: [{ run_id: "fixture-run", matrix_cell: matrixCell, coverage_follow_up: coverageFollowUp }] },
    runId: "fixture-run",
  };
}

test("artifact consistency preserves equivalent matrix and coverage fields", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aor-artifact-consistency-"));
  try {
    assert.equal(evaluateArtifactConsistency(buildFixture(root)).status, "pass");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("artifact consistency rejects a mutated learning handoff", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aor-artifact-consistency-"));
  try {
    const fixture = buildFixture(root);
    fs.writeFileSync(fixture.artifacts.learning_loop_handoff_file, JSON.stringify({ matrix_cell: { cell_id: "mutated" }, coverage_follow_up: fixture.artifacts.coverage_follow_up }));
    const result = evaluateArtifactConsistency(fixture);
    assert.equal(result.status, "fail");
    assert.match(result.summary, /learning-loop-handoff\.matrix_cell differs/u);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("artifact consistency seam stays one-way and provider-neutral", () => {
  const flowSource = fs.readFileSync(path.join(process.cwd(), "scripts/live-e2e/lib/flows.mjs"), "utf8");
  const seamSource = fs.readFileSync(path.join(process.cwd(), "scripts/live-e2e/lib/artifact-consistency.mjs"), "utf8");
  assert.match(flowSource, /from "\.\/artifact-consistency\.mjs"/u);
  assert.doesNotMatch(seamSource, /target-materialization|provider-qualification|runLiveAdapter/iu);
});
