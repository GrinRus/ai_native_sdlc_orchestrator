import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { runEvaluationSuite } from "../src/eval-runner.mjs";
import { initializeProjectRuntime } from "../src/project-init.mjs";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const workspaceRoot = path.resolve(currentDir, "../../..");

/**
 * @param {(repoRoot: string) => void} callback
 */
function withTempRepo(callback) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-w3-s03-"));
  fs.mkdirSync(path.join(repoRoot, ".git"), { recursive: true });
  fs.cpSync(path.join(workspaceRoot, "examples"), path.join(repoRoot, "examples"), { recursive: true });

  try {
    callback(repoRoot);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
}

function writeRunSubject(repoRoot, runId, status = "pass") {
  const init = initializeProjectRuntime({ cwd: repoRoot, projectRef: repoRoot });
  fs.writeFileSync(path.join(init.runtimeLayout.reportsRoot, `run-subject-${runId}.json`), `${JSON.stringify({ run_id: runId, status })}\n`, "utf8");
}

test("runEvaluationSuite executes suite and writes durable evaluation report", () => {
  withTempRepo((repoRoot) => {
    writeRunSubject(repoRoot, "candidate-release-core");
    const result = runEvaluationSuite({
      cwd: repoRoot,
      projectRef: repoRoot,
      suiteRef: "suite.release.core@v1",
      subjectRef: "run://candidate-release-core",
      subjectVersion: "git:abc123",
    });

    assert.equal(fs.existsSync(result.evaluationReportPath), true);
    assert.equal(result.evaluationReport.suite_ref, "suite.release.core@v1");
    assert.equal(result.evaluationReport.subject_ref, "run://candidate-release-core");
    assert.equal(result.evaluationReport.subject_type, "run");
    assert.equal(result.evaluationReport.status, "pass");
    assert.equal(typeof result.evaluationReport.subject_fingerprint, "string");
    assert.ok(result.evaluationReport.subject_fingerprint.startsWith("sha256:"));
    assert.ok(Array.isArray(result.evaluationReport.scorer_metadata));
    assert.ok(result.evaluationReport.scorer_metadata.some((scorer) => scorer.scorer_id === "deterministic"));
  });
});

test("runEvaluationSuite falls back to project default suite ref when not passed", () => {
  withTempRepo((repoRoot) => {
    writeRunSubject(repoRoot, "candidate-default-suite");
    const result = runEvaluationSuite({
      cwd: repoRoot,
      projectRef: repoRoot,
      subjectRef: "run://candidate-default-suite",
    });

    assert.equal(result.suiteRef, "suite.release.core@v1");
    assert.equal(result.evaluationReport.suite_ref, "suite.release.core@v1");
  });
});

test("runEvaluationSuite supports mixed scorer suites through same interface", () => {
  withTempRepo((repoRoot) => {
    writeRunSubject(repoRoot, "candidate-regress-long");
    const result = runEvaluationSuite({
      cwd: repoRoot,
      projectRef: repoRoot,
      suiteRef: "suite.regress.long@v1",
      subjectRef: "run://candidate-regress-long",
    });

    assert.equal(result.evaluationReport.status, "pass");
    const scorerIds = result.evaluationReport.scorer_metadata.map((scorer) => scorer.scorer_id).sort();
    assert.deepEqual(scorerIds, ["deterministic", "pairwise-judge"]);
    assert.equal(result.evaluationReport.case_resolution[0].status, "resolved");
    assert.ok(result.evaluationReport.subject_snapshot.digest.startsWith("sha256:"));
  });
});

test("runEvaluationSuite fails closed when immutable case content is missing", () => {
  withTempRepo((repoRoot) => {
    writeRunSubject(repoRoot, "candidate-missing-case");
    fs.rmSync(path.join(repoRoot, "examples/eval/cases/run-regression/case-run-0091/expected.yaml"));
    const result = runEvaluationSuite({ cwd: repoRoot, projectRef: repoRoot, subjectRef: "run://candidate-missing-case" });
    assert.equal(result.evaluationReport.status, "fail");
    assert.equal(result.evaluationReport.case_resolution[0].status, "failed");
  });
});

test("runEvaluationSuite fails when suite subject type mismatches target asset family", () => {
  withTempRepo((repoRoot) => {
    assert.throws(
      () =>
        runEvaluationSuite({
          cwd: repoRoot,
          projectRef: repoRoot,
          suiteRef: "suite.cert.core@v4",
          subjectRef: "run://candidate-wrong-family",
        }),
      /subject_type 'wrapper' does not match subject_ref type 'run'/,
    );
  });
});
