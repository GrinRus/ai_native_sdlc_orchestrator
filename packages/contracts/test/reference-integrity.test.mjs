import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { validateExampleReferences } from "../src/index.mjs";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const workspaceRoot = path.resolve(currentDir, "../../..");

/**
 * @template T
 * @param {(tempRoot: string) => T} callback
 * @returns {T}
 */
function withTempWorkspace(callback) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-w0-s03-"));
  fs.cpSync(path.join(workspaceRoot, "examples"), path.join(tempRoot, "examples"), { recursive: true });

  try {
    return callback(tempRoot);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

/**
 * @param {string} tempRoot
 * @param {string} relativeFilePath
 * @param {(document: Record<string, unknown>) => void} mutate
 */
function mutateYamlFile(tempRoot, relativeFilePath, mutate) {
  const filePath = path.join(tempRoot, relativeFilePath);
  const content = fs.readFileSync(filePath, "utf8");
  const document = parseYaml(content);
  mutate(document);
  fs.writeFileSync(filePath, stringifyYaml(document), "utf8");
}

test("reference integrity passes for current examples graph", () => {
  const result = validateExampleReferences({ workspaceRoot });
  assert.equal(result.ok, true, "expected current examples graph to pass reference integrity");
  assert.equal(result.issues.length, 0, "expected zero reference integrity issues");
  assert.ok(result.checkedReferences > 0, "expected validator to check at least one reference");
});

test("missing route wrapper reference fails with reference_target_missing", () => {
  withTempWorkspace((tempRoot) => {
    mutateYamlFile(tempRoot, "examples/routes/implement-default.yaml", (document) => {
      document.wrapper_profile_ref = "wrapper.missing@v1";
    });

    const result = validateExampleReferences({ workspaceRoot: tempRoot });
    assert.equal(result.ok, false);

    const issue = result.issues.find(
      (candidate) =>
        candidate.code === "reference_target_missing" &&
        candidate.field === "wrapper_profile_ref" &&
        candidate.reference === "wrapper.missing@v1",
    );
    assert.ok(issue, "expected missing wrapper reference issue");
  });
});

test("missing wrapper prompt bundle reference fails with reference_target_missing", () => {
  withTempWorkspace((tempRoot) => {
    mutateYamlFile(tempRoot, "examples/wrappers/wrapper-runner-default.yaml", (document) => {
      document.prompt_bundle_ref = "prompt-bundle://missing@v1";
    });

    const result = validateExampleReferences({ workspaceRoot: tempRoot });
    assert.equal(result.ok, false);

    const issue = result.issues.find(
      (candidate) =>
        candidate.code === "reference_target_missing" &&
        candidate.field === "prompt_bundle_ref" &&
        candidate.reference === "prompt-bundle://missing@v1",
    );
    assert.ok(issue, "expected missing prompt bundle reference issue");
  });
});

test("missing suite dataset reference fails with reference_target_missing", () => {
  withTempWorkspace((tempRoot) => {
    mutateYamlFile(tempRoot, "examples/eval/suite-release-core.yaml", (document) => {
      document.dataset_ref = "dataset://missing@2026-04-20T08:00:00Z";
    });

    const result = validateExampleReferences({ workspaceRoot: tempRoot });
    assert.equal(result.ok, false);

    const issue = result.issues.find(
      (candidate) =>
        candidate.code === "reference_target_missing" &&
        candidate.field === "dataset_ref" &&
        candidate.reference === "dataset://missing@2026-04-20T08:00:00Z",
    );
    assert.ok(issue, "expected missing dataset reference issue");
  });
});

test("invalid suite ref format fails with reference_format_invalid", () => {
  withTempWorkspace((tempRoot) => {
    mutateYamlFile(tempRoot, "examples/project.aor.yaml", (document) => {
      const evalPolicy = /** @type {Record<string, unknown>} */ (document.eval_policy);
      evalPolicy.default_release_suite_ref = "suite.release.core";
    });

    const result = validateExampleReferences({ workspaceRoot: tempRoot });
    assert.equal(result.ok, false);

    const issue = result.issues.find(
      (candidate) =>
        candidate.code === "reference_format_invalid" &&
        candidate.field === "eval_policy.default_release_suite_ref" &&
        candidate.reference === "suite.release.core",
    );
    assert.ok(issue, "expected invalid suite ref format issue");
  });
});

test("wrong-family suite ref fails with reference_target_type_mismatch", () => {
  withTempWorkspace((tempRoot) => {
    mutateYamlFile(tempRoot, "examples/project.aor.yaml", (document) => {
      const evalPolicy = /** @type {Record<string, unknown>} */ (document.eval_policy);
      evalPolicy.default_release_suite_ref = "wrapper.runner.default@v3";
    });

    const result = validateExampleReferences({ workspaceRoot: tempRoot });
    assert.equal(result.ok, false);

    const issue = result.issues.find(
      (candidate) =>
        candidate.code === "reference_target_type_mismatch" &&
        candidate.field === "eval_policy.default_release_suite_ref" &&
        candidate.reference === "wrapper.runner.default@v3",
    );
    assert.ok(issue, "expected wrong-family suite ref issue");
  });
});
