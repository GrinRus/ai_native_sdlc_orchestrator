import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { CliUsageError } from "../src/operator-cli/command-runtime.mjs";
import { assertLearningHandoffPrerequisites } from "../src/operator-cli/command-handlers/quality.mjs";

function fixture() {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-learning-gate-"));
  fs.mkdirSync(path.join(projectRoot, "reports"), { recursive: true });
  for (const name of ["review.json", "harness.json", "step.json", "decision.json"]) {
    fs.writeFileSync(path.join(projectRoot, "reports", name), "{}\n", "utf8");
  }
  const reviewRef = "evidence://reports/review.json";
  const harnessRef = "evidence://reports/harness.json";
  return {
    projectRoot,
    runId: "run.learning-gate",
    runState: { status: "completed" },
    runSummary: { step_result_refs: ["evidence://reports/step.json"] },
    reviewArtifact: {
      artifact_ref: reviewRef,
      document: {
        overall_status: "pass",
        review_recommendation: "proceed",
        findings: [],
        evidence_refs: ["evidence://reports/step.json"],
        generated_at: "2026-09-06T08:00:00.000Z",
      },
    },
    runtimeHarnessArtifact: {
      artifact_ref: harnessRef,
      document: {
        overall_decision: "pass",
        evidence_refs: ["evidence://reports/step.json"],
        generated_at: "2026-09-06T08:00:01.000Z",
      },
    },
    reviewDecisions: [{
      artifact_ref: "evidence://reports/decision.json",
      document: {
        decision: "approve",
        review_report_ref: reviewRef,
        runtime_harness_report_ref: harnessRef,
        delivery_gate: { status: "pass", blocks_downstream: false },
        evidence_refs: [reviewRef, harnessRef],
        decided_at: "2026-09-06T08:00:02.000Z",
      },
    }],
  };
}

test("learning handoff gate accepts a terminal run with current approved evidence", () => {
  const input = fixture();
  try {
    const result = assertLearningHandoffPrerequisites(input);
    assert.equal(result.decision.decision, "approve");
  } finally {
    fs.rmSync(input.projectRoot, { recursive: true, force: true });
  }
});

test("learning handoff gate fails closed for active or stale evidence and completed replay", () => {
  const input = fixture();
  try {
    assert.throws(
      () => assertLearningHandoffPrerequisites({ ...input, runState: { status: "running" } }),
      (error) => error instanceof CliUsageError && /terminal success/u.test(error.message),
    );
    assert.throws(
      () => assertLearningHandoffPrerequisites({
        ...input,
        reviewDecisions: [{ ...input.reviewDecisions[0], document: { ...input.reviewDecisions[0].document, review_report_ref: "evidence://reports/other.json" } }],
      }),
      (error) => error instanceof CliUsageError && /stale or mismatched review/u.test(error.message),
    );
    assert.throws(
      () => assertLearningHandoffPrerequisites({ ...input, existingLearningHandoff: { artifact_ref: "evidence://reports/learning.json" } }),
      (error) => error instanceof CliUsageError && /immutable/u.test(error.message),
    );
  } finally {
    fs.rmSync(input.projectRoot, { recursive: true, force: true });
  }
});
