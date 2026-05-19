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
  fs.cpSync(path.join(workspaceRoot, "examples"), path.join(tempRoot, "examples"), { recursive: true });

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
    assert.equal(firstRun.artifactPacketId, "aor-core.artifact.bootstrap.v1");
    assert.equal(firstRun.artifactPacketFile, secondRun.artifactPacketFile);
    assert.equal(fs.existsSync(firstRun.artifactPacketFile), true);

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
    assert.equal(parsedState.asset_mode, "materialized");
    assert.equal(parsedState.onboarding_report_ref, ".aor/projects/aor-core/reports/onboarding-report.json");
    assert.equal(fs.existsSync(firstRun.onboardingReportFile), true);
    assert.equal(firstRun.onboardingReport.status, "ready");
    assert.equal(firstRun.onboardingReport.asset_mode, "materialized");

    const packet = JSON.parse(fs.readFileSync(firstRun.artifactPacketFile, "utf8"));
    assert.equal(packet.packet_id, "aor-core.artifact.bootstrap.v1");
    assert.equal(packet.packet_type, "bootstrap");
    assert.equal(packet.project_id, "aor-core");
  });
});

test("initializeProjectRuntime onboards a clean repo in bundled mode without target asset copies", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-w21-s03-clean-"));
  fs.mkdirSync(path.join(tempRoot, ".git"), { recursive: true });
  fs.writeFileSync(path.join(tempRoot, "package.json"), JSON.stringify({ name: "clean-repo" }, null, 2), "utf8");

  try {
    const result = initializeProjectRuntime({ cwd: tempRoot, projectRef: tempRoot });

    assert.equal(result.projectId, path.basename(tempRoot).toLowerCase());
    assert.equal(result.assetMode, "bundled");
    assert.equal(result.bootstrapMaterializationStatus, "bundled");
    assert.match(result.projectProfileRef, /^\.aor\/projects\/.+\/state\/project\.aor\.yaml$/);
    assert.equal(fs.existsSync(path.join(tempRoot, "project.aor.yaml")), false);
    assert.equal(fs.existsSync(path.join(tempRoot, "examples")), false);
    assert.equal(fs.existsSync(result.projectProfilePath), true);
    assert.equal(result.registryRoots.routes, path.join(workspaceRoot, "examples/routes"));

    const report = JSON.parse(fs.readFileSync(result.onboardingReportFile, "utf8"));
    assert.equal(report.status, "ready");
    assert.equal(report.asset_mode, "bundled");
    assert.equal(report.project_state.existing_profile_found, false);
    assert.deepEqual(report.write_effects.target_repo_writes, []);
    assert.equal(report.write_effects.copied_example_registries, false);
    assert.equal(report.write_effects.materialized_profile, false);
    assert.ok(report.write_effects.runtime_writes.includes(result.projectProfileRef));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("initializeProjectRuntime materializes profile and assets only when materialized mode is explicit", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-w21-s03-materialized-"));
  fs.mkdirSync(path.join(tempRoot, ".git"), { recursive: true });

  try {
    const result = initializeProjectRuntime({
      cwd: tempRoot,
      projectRef: tempRoot,
      assetMode: "materialized",
    });

    assert.equal(result.assetMode, "materialized");
    assert.equal(result.projectProfileRef, "project.aor.yaml");
    assert.equal(fs.existsSync(path.join(tempRoot, "project.aor.yaml")), true);
    assert.equal(fs.existsSync(path.join(tempRoot, "examples/routes")), true);
    assert.equal(result.registryRoots.routes, path.join(tempRoot, "examples/routes"));

    const report = JSON.parse(fs.readFileSync(result.onboardingReportFile, "utf8"));
    assert.equal(report.asset_mode, "materialized");
    assert.equal(report.write_effects.materialized_profile, true);
    assert.equal(report.write_effects.copied_example_registries, true);
    assert.ok(report.write_effects.target_repo_writes.includes("project.aor.yaml"));
    assert.ok(report.write_effects.target_repo_writes.includes("examples"));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("initializeProjectRuntime merges bundled bootstrap assets when a target examples directory already exists", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-w21-s03-existing-examples-"));
  fs.mkdirSync(path.join(tempRoot, ".git"), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, "examples"), { recursive: true });
  fs.writeFileSync(path.join(tempRoot, "examples", "README.md"), "target examples stay intact\n", "utf8");

  try {
    const result = initializeProjectRuntime({
      cwd: tempRoot,
      projectRef: tempRoot,
      assetMode: "materialized",
    });

    assert.equal(result.assetMode, "materialized");
    assert.equal(fs.readFileSync(path.join(tempRoot, "examples", "README.md"), "utf8"), "target examples stay intact\n");
    assert.equal(fs.existsSync(path.join(tempRoot, "examples/routes")), true);
    assert.equal(fs.existsSync(path.join(tempRoot, "examples/wrappers")), true);
    assert.equal(result.registryRoots.routes, path.join(tempRoot, "examples/routes"));

    const report = JSON.parse(fs.readFileSync(result.onboardingReportFile, "utf8"));
    assert.equal(report.write_effects.copied_example_registries, true);
    assert.ok(report.write_effects.target_repo_writes.includes("examples"));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("initializeProjectRuntime blocks invalid explicit profile references before writing runtime state", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-w21-s03-missing-profile-"));
  fs.mkdirSync(path.join(tempRoot, ".git"), { recursive: true });

  try {
    assert.throws(
      () =>
        initializeProjectRuntime({
          cwd: tempRoot,
          projectRef: tempRoot,
          projectProfile: "missing-project.aor.yaml",
        }),
      /Project profile 'missing-project\.aor\.yaml' was not found/,
    );
    assert.equal(fs.existsSync(path.join(tempRoot, ".aor")), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("initializeProjectRuntime fails clearly for invalid explicit project reference", () => {
  const missing = path.join(os.tmpdir(), "aor-w1-s02-missing-path");
  assert.throws(
    () => initializeProjectRuntime({ cwd: workspaceRoot, projectRef: missing }),
    /Invalid project reference/,
  );
});
