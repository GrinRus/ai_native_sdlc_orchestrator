import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  discoverProjectRoot,
  initializeProjectRuntime,
  resolveProjectProfilePath,
} from "../src/project-init.mjs";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const workspaceRoot = path.resolve(currentDir, "../../..");

/**
 * @param {(tempRoot: string) => void} callback
 */
function withTempRepo(callback) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-w1-s02-"));

  fs.mkdirSync(path.join(tempRoot, ".git"), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, "examples"), { recursive: true });

  const profileSource = path.join(workspaceRoot, "examples/project.aor.yaml");
  const profileTarget = path.join(tempRoot, "examples/project.aor.yaml");
  fs.copyFileSync(profileSource, profileTarget);

  try {
    callback(tempRoot);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

test("discoverProjectRoot finds git root from nested cwd", () => {
  withTempRepo((tempRoot) => {
    const nestedPath = path.join(tempRoot, "src", "nested");
    fs.mkdirSync(nestedPath, { recursive: true });

    const discovered = discoverProjectRoot({ cwd: nestedPath });
    assert.equal(discovered, tempRoot);
  });
});

test("resolveProjectProfilePath defaults to examples/project.aor.yaml in repo root", () => {
  withTempRepo((tempRoot) => {
    const resolved = resolveProjectProfilePath({
      cwd: tempRoot,
      projectRoot: tempRoot,
    });

    assert.equal(resolved, path.join(tempRoot, "examples/project.aor.yaml"));
  });
});

test("initializeProjectRuntime creates idempotent runtime layout and durable state", () => {
  withTempRepo((tempRoot) => {
    const nestedPath = path.join(tempRoot, "apps", "cli");
    fs.mkdirSync(nestedPath, { recursive: true });

    const firstRun = initializeProjectRuntime({ cwd: nestedPath });
    const secondRun = initializeProjectRuntime({ cwd: nestedPath });

    assert.equal(firstRun.projectRoot, tempRoot);
    assert.equal(secondRun.projectRoot, tempRoot);
    assert.equal(firstRun.projectProfileRef, "examples/project.aor.yaml");
    assert.equal(secondRun.projectProfileRef, "examples/project.aor.yaml");

    for (const dirPath of [
      firstRun.runtimeLayout.runtimeRoot,
      firstRun.runtimeLayout.projectsRoot,
      firstRun.runtimeLayout.projectRuntimeRoot,
      firstRun.runtimeLayout.artifactsRoot,
      firstRun.runtimeLayout.reportsRoot,
      firstRun.runtimeLayout.stateRoot,
    ]) {
      assert.equal(fs.existsSync(dirPath), true, `expected runtime directory ${dirPath}`);
    }

    assert.equal(firstRun.stateFile, secondRun.stateFile, "state file path should stay stable across repeated runs");

    const stateContent = fs.readFileSync(firstRun.stateFile, "utf8");
    const parsedState = JSON.parse(stateContent);

    assert.equal(parsedState.project_id, "aor-core");
    assert.equal(parsedState.display_name, "AOR Core");
    assert.equal(parsedState.selected_profile_ref, "examples/project.aor.yaml");
    assert.equal(parsedState.project_root, tempRoot);
    assert.equal(parsedState.runtime_root, path.join(tempRoot, ".aor"));
  });
});

test("initializeProjectRuntime fails clearly for invalid explicit project reference", () => {
  const missing = path.join(os.tmpdir(), "aor-w1-s02-missing-path");
  assert.throws(
    () => initializeProjectRuntime({ cwd: workspaceRoot, projectRef: missing }),
    /Invalid project reference/,
  );
});
