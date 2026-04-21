import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { executeRoutedStep } from "../src/step-execution-engine.mjs";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const workspaceRoot = path.resolve(currentDir, "../../..");

/**
 * @param {(repoRoot: string) => void} callback
 */
function withTempRepo(callback) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-w2-s05-"));
  fs.mkdirSync(path.join(repoRoot, ".git"), { recursive: true });
  fs.cpSync(path.join(workspaceRoot, "examples"), path.join(repoRoot, "examples"), { recursive: true });

  try {
    callback(repoRoot);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
}

test("executeRoutedStep resolves route/assets/policy/adapter and writes durable dry-run step-result", () => {
  withTempRepo((repoRoot) => {
    const result = executeRoutedStep({
      projectRef: repoRoot,
      cwd: repoRoot,
      stepClass: "implement",
      dryRun: true,
    });

    assert.equal(fs.existsSync(result.stepResultPath), true);
    assert.equal(result.stepResult.step_class, "runner");
    assert.equal(result.stepResult.status, "passed");
    assert.equal(result.stepResult.routed_execution.mode, "dry-run");
    assert.equal(result.stepResult.routed_execution.route_resolution.resolved_route_id, "route.implement.default");
    assert.equal(result.stepResult.routed_execution.asset_resolution.wrapper.wrapper_ref, "wrapper.runner.default@v3");
    assert.equal(result.stepResult.routed_execution.policy_resolution.policy.policy_id, "policy.step.runner.default");
    assert.equal(result.stepResult.routed_execution.policy_resolution.resolved_bounds.budget.max_cost_usd, 25);
    assert.equal(result.stepResult.routed_execution.adapter_resolution.adapter.adapter_id, "codex-cli");
    assert.equal(result.stepResult.routed_execution.adapter_response.adapter_id, "mock-runner");
    assert.ok(Array.isArray(result.stepResult.evidence_refs));
    assert.ok(result.stepResult.evidence_refs.length > 0);
  });
});

test("executeRoutedStep still writes failed step-result when routed resolution fails", () => {
  withTempRepo((repoRoot) => {
    const adapterPath = path.join(repoRoot, "examples/adapters/codex-cli.yaml");
    const adapterContent = fs.readFileSync(adapterPath, "utf8");
    fs.writeFileSync(adapterPath, adapterContent.replace("live_logs: true", "live_logs: false"), "utf8");

    const result = executeRoutedStep({
      projectRef: repoRoot,
      cwd: repoRoot,
      stepClass: "implement",
      dryRun: true,
    });

    assert.equal(fs.existsSync(result.stepResultPath), true);
    assert.equal(result.stepResult.status, "failed");
    assert.match(result.stepResult.summary, /missing capabilities \[live_logs\]/i);
    assert.equal(result.stepResult.routed_execution.route_resolution.step_class, "implement");
    assert.equal(result.stepResult.routed_execution.adapter_response, null);
    assert.equal(result.stepResult.routed_execution.no_write_enforced, true);
  });
});
