import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadEvaluationRegistry, resolveSuiteWithDataset } from "../src/evaluation-registry.mjs";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const workspaceRoot = path.resolve(currentDir, "../../..");

/**
 * @param {(repoRoot: string) => void} callback
 */
function withTempRepo(callback) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-w3-s02-"));
  fs.mkdirSync(path.join(repoRoot, ".git"), { recursive: true });
  fs.cpSync(path.join(workspaceRoot, "examples"), path.join(repoRoot, "examples"), { recursive: true });

  try {
    callback(repoRoot);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
}

test("loadEvaluationRegistry discovers datasets and suites deterministically", () => {
  withTempRepo((repoRoot) => {
    const registry = loadEvaluationRegistry({ workspaceRoot: repoRoot });

    assert.equal(registry.ok, true);
    assert.ok(registry.datasets.length > 0);
    assert.ok(registry.suites.length > 0);
    assert.equal(registry.issues.length, 0);
    assert.ok(registry.suites.every((suite) => typeof suite.suite_ref === "string"));
    assert.ok(registry.datasets.every((dataset) => typeof dataset.dataset_ref === "string"));
  });
});

test("resolveSuiteWithDataset resolves suite and dataset by suite ref", () => {
  withTempRepo((repoRoot) => {
    const registry = loadEvaluationRegistry({ workspaceRoot: repoRoot });
    const resolved = resolveSuiteWithDataset(registry, "suite.release.core@v1");

    assert.equal(resolved.suite.suite_ref, "suite.release.core@v1");
    assert.equal(resolved.dataset?.dataset_ref, "dataset://run-regression@2026-04-20T08:00:00Z");
  });
});

test("loadEvaluationRegistry reports subject-type mismatch deterministically", () => {
  withTempRepo((repoRoot) => {
    const suitePath = path.join(repoRoot, "examples/eval/suite-release-core.yaml");
    const suiteContent = fs.readFileSync(suitePath, "utf8");
    fs.writeFileSync(suitePath, suiteContent.replace("subject_type: run", "subject_type: wrapper"), "utf8");

    const registry = loadEvaluationRegistry({ workspaceRoot: repoRoot });

    assert.equal(registry.ok, false);
    assert.ok(
      registry.issues.some(
        (issue) =>
          issue.code === "suite_dataset_subject_type_mismatch" &&
          issue.suite_ref === "suite.release.core@v1" &&
          issue.dataset_ref === "dataset://run-regression@2026-04-20T08:00:00Z",
      ),
      "expected suite/dataset mismatch issue in registry",
    );
  });
});
