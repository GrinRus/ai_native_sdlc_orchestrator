import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { analyzeProjectRuntime } from "../src/project-analysis.mjs";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const workspaceRoot = path.resolve(currentDir, "../../..");

/**
 * @param {(repoRoot: string) => void} callback
 */
function withTempRepo(callback) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-w1-s03-"));
  fs.mkdirSync(path.join(repoRoot, ".git"), { recursive: true });
  fs.cpSync(path.join(workspaceRoot, "examples"), path.join(repoRoot, "examples"), { recursive: true });

  try {
    callback(repoRoot);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
}

test("analyzeProjectRuntime records monorepo topology and runnable command candidates", () => {
  withTempRepo((repoRoot) => {
    fs.writeFileSync(path.join(repoRoot, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n", "utf8");
    fs.mkdirSync(path.join(repoRoot, "apps", "api"), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, "apps", "api", "index.ts"), "export const value = 1;\n", "utf8");
    fs.writeFileSync(
      path.join(repoRoot, "package.json"),
      JSON.stringify(
        {
          name: "fixture-monorepo",
          scripts: {
            lint: "pnpm lint",
            test: "pnpm test",
            build: "pnpm build",
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    fs.writeFileSync(path.join(repoRoot, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");

    const result = analyzeProjectRuntime({ projectRef: repoRoot, cwd: repoRoot });

    assert.equal(result.report.project_id, "aor-core");
    assert.equal(result.report.repo_facts.topology, "monorepo");
    assert.equal(result.report.repo_facts.package_manager, "pnpm");
    assert.deepEqual(result.report.command_catalog.required_for_smoke_verify, [
      "pnpm lint",
      "pnpm test",
      "pnpm build",
    ]);
    assert.equal(fs.existsSync(result.reportPath), true);
    assert.equal(fs.existsSync(result.routeResolutionPath), true);
    assert.equal(result.routeResolutionMatrix.length, 10);
    assert.equal(fs.existsSync(result.assetResolutionPath), true);
    assert.equal(result.assetResolutionMatrix.length, 10);
    assert.equal(
      result.assetResolutionMatrix.find((entry) => entry.step_class === "planning")?.wrapper.wrapper_ref,
      "wrapper.planner.default@v1",
    );
    assert.equal(result.report.route_resolution.matrix.length, 10);
    assert.equal(result.report.asset_resolution.matrix.length, 10);

    const reloaded = JSON.parse(fs.readFileSync(result.reportPath, "utf8"));
    assert.equal(reloaded.report_id, result.report.report_id);
    assert.equal(reloaded.status, "ready-for-bootstrap");
    assert.equal(reloaded.route_resolution.matrix.length, 10);
    assert.equal(reloaded.asset_resolution.matrix.length, 10);
  });
});

test("analyzeProjectRuntime marks low-confidence facts as unknown for non-node fixture", () => {
  withTempRepo((repoRoot) => {
    fs.writeFileSync(path.join(repoRoot, "pyproject.toml"), "[project]\nname='fixture-python'\n", "utf8");
    fs.writeFileSync(
      path.join(repoRoot, "Makefile"),
      "test:\n\tpytest\n\ncodestyle:\n\tpython -m ruff check .\n",
      "utf8",
    );
    fs.writeFileSync(path.join(repoRoot, "main.py"), "print('hello')\n", "utf8");

    const result = analyzeProjectRuntime({ projectRef: repoRoot, cwd: repoRoot });

    assert.equal(result.report.repo_facts.topology, "single-repo");
    assert.equal(result.report.repo_facts.package_manager, "unknown");
    assert.ok(
      result.report.unknown_facts.some(
        (fact) => fact.field === "repo_facts.package_manager" && fact.value === "unknown" && fact.confidence === "low",
      ),
      "expected package-manager unknown marker",
    );
    assert.ok(result.report.toolchain_facts.test_commands.includes("make test"));
    assert.ok(result.report.toolchain_facts.lint_commands.includes("make codestyle"));
  });
});

test("analyzeProjectRuntime works on the AOR repository with isolated runtime root", () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-w1-s03-runtime-"));
  try {
    const result = analyzeProjectRuntime({
      cwd: workspaceRoot,
      projectRef: workspaceRoot,
      projectProfile: path.join(workspaceRoot, "examples/project.aor.yaml"),
      runtimeRoot,
    });

    assert.equal(result.report.project_id, "aor-core");
    assert.equal(result.report.repo_facts.topology, "monorepo");
    assert.equal(result.report.repo_facts.package_manager, "pnpm");
    assert.equal(result.reportPath.startsWith(runtimeRoot), true);
    assert.equal(fs.existsSync(result.reportPath), true);
    assert.equal(fs.existsSync(result.routeResolutionPath), true);
    assert.equal(fs.existsSync(result.assetResolutionPath), true);
  } finally {
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
});

test("analyzeProjectRuntime surfaces deterministic step-level route overrides", () => {
  withTempRepo((repoRoot) => {
    const result = analyzeProjectRuntime({
      projectRef: repoRoot,
      cwd: repoRoot,
      routeOverrides: {
        planning: "route.plan.default",
      },
    });

    const planning = result.routeResolutionMatrix.find((entry) => entry.step_class === "planning");
    assert.ok(planning);
    assert.equal(planning.resolution_source.kind, "step-override");
    assert.equal(planning.resolution_source.field, "step_overrides.planning");
    const planningBundle = result.assetResolutionMatrix.find((entry) => entry.step_class === "planning");
    assert.ok(planningBundle);
    assert.equal(planningBundle.wrapper.resolution_source.kind, "project-default");
  });
});
