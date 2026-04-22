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
    assert.equal(fs.existsSync(result.policyResolutionPath), true);
    assert.equal(result.policyResolutionMatrix.length, 10);
    assert.equal(result.adapterResolutionMatrix.length, 10);
    assert.equal(fs.existsSync(result.evaluationRegistryPath), true);
    assert.ok(result.evaluationRegistry.datasets.length > 0);
    assert.ok(result.evaluationRegistry.suites.length > 0);
    assert.equal(
      result.assetResolutionMatrix.find((entry) => entry.step_class === "planning")?.wrapper.wrapper_ref,
      "wrapper.planner.default@v1",
    );
    assert.equal(result.report.route_resolution.matrix.length, 10);
    assert.equal(result.report.asset_resolution.matrix.length, 10);
    assert.equal(result.report.policy_resolution.matrix.length, 10);
    assert.ok(result.report.evaluation_registry.dataset_refs.length > 0);
    assert.ok(result.report.evaluation_registry.suite_refs.length > 0);
    assert.equal(
      result.policyResolutionMatrix.find((entry) => entry.step_class === "planning")?.policy.policy_id,
      "policy.step.planner.default",
    );
    assert.equal(
      result.adapterResolutionMatrix.find((entry) => entry.step_class === "implement")?.adapter.adapter_id,
      "codex-cli",
    );

    const reloaded = JSON.parse(fs.readFileSync(result.reportPath, "utf8"));
    assert.equal(reloaded.report_id, result.report.report_id);
    assert.equal(reloaded.status, "ready-for-bootstrap");
    assert.equal(reloaded.route_resolution.matrix.length, 10);
    assert.equal(reloaded.asset_resolution.matrix.length, 10);
    assert.equal(reloaded.policy_resolution.matrix.length, 10);
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
    assert.equal(fs.existsSync(result.policyResolutionPath), true);
    assert.equal(fs.existsSync(result.evaluationRegistryPath), true);
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
    const planningPolicy = result.policyResolutionMatrix.find((entry) => entry.step_class === "planning");
    assert.ok(planningPolicy);
    assert.equal(planningPolicy.policy.resolution_source.kind, "project-default");
  });
});

test("analyzeProjectRuntime fails early when resolved adapter lacks required route capability", () => {
  withTempRepo((repoRoot) => {
    const adapterPath = path.join(repoRoot, "examples/adapters/codex-cli.yaml");
    const adapterContent = fs.readFileSync(adapterPath, "utf8");
    fs.writeFileSync(adapterPath, adapterContent.replace("live_logs: true", "live_logs: false"), "utf8");

    assert.throws(
      () =>
        analyzeProjectRuntime({
          projectRef: repoRoot,
          cwd: repoRoot,
        }),
      /missing capabilities \[live_logs\]/i,
    );
  });
});

test("analyzeProjectRuntime fails early when suite and dataset subject types are incompatible", () => {
  withTempRepo((repoRoot) => {
    const suitePath = path.join(repoRoot, "examples/eval/suite-release-core.yaml");
    const suiteContent = fs.readFileSync(suitePath, "utf8");
    fs.writeFileSync(suitePath, suiteContent.replace("subject_type: run", "subject_type: wrapper"), "utf8");

    assert.throws(
      () =>
        analyzeProjectRuntime({
          projectRef: repoRoot,
          cwd: repoRoot,
        }),
      /Evaluation registry validation failed:/i,
    );
  });
});
