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
    assert.equal(result.stepResult.routed_execution.delivery_plan.delivery_mode, "fork-first-pr");
    assert.equal(result.stepResult.routed_execution.delivery_plan.status, "blocked");
    assert.equal(fs.existsSync(result.stepResult.routed_execution.delivery_plan.delivery_plan_file), true);
    assert.equal(result.stepResult.routed_execution.adapter_resolution.adapter.adapter_id, "codex-cli");
    assert.equal(result.stepResult.routed_execution.adapter_response.adapter_id, "mock-runner");
    assert.ok(Array.isArray(result.stepResult.evidence_refs));
    assert.ok(result.stepResult.evidence_refs.length > 0);
    assert.ok(Array.isArray(result.stepResult.routed_execution.architecture_traceability.contract_refs));
    assert.ok(result.stepResult.routed_execution.architecture_traceability.contract_refs.includes("docs/contracts/step-result.md"));
  });
});

test("executeRoutedStep enforces discovery completeness gate for spec build and carries architecture traceability", () => {
  withTempRepo((repoRoot) => {
    const result = executeRoutedStep({
      projectRef: repoRoot,
      cwd: repoRoot,
      stepClass: "spec",
      dryRun: true,
      requireDiscoveryCompleteness: true,
    });

    assert.equal(result.stepResult.status, "passed");
    assert.equal(result.stepResult.routed_execution.discovery_completeness_gate.status, "pass");
    assert.equal(result.stepResult.routed_execution.discovery_completeness_gate.blocking, false);
    assert.equal(typeof result.stepResult.routed_execution.discovery_completeness_gate.analysis_report_id, "string");
    assert.equal(fs.existsSync(result.stepResult.routed_execution.discovery_completeness_gate.analysis_report_file), true);
    assert.equal(result.stepResult.routed_execution.architecture_traceability.selected_step.step_class, "spec");
    assert.equal(typeof result.stepResult.routed_execution.architecture_traceability.selected_step.route_id, "string");
  });
});

test("executeRoutedStep blocks spec build when discovery completeness gate fails", () => {
  withTempRepo((repoRoot) => {
    fs.rmSync(path.join(repoRoot, "examples", "eval"), { recursive: true, force: true });

    const result = executeRoutedStep({
      projectRef: repoRoot,
      cwd: repoRoot,
      stepClass: "spec",
      dryRun: true,
      requireDiscoveryCompleteness: true,
    });

    assert.equal(result.stepResult.status, "failed");
    assert.match(result.stepResult.summary, /Spec build blocked by discovery completeness checks/i);
    assert.equal(result.stepResult.routed_execution.discovery_completeness_gate.status, "fail");
    assert.equal(result.stepResult.routed_execution.discovery_completeness_gate.blocking, true);
    assert.equal(result.stepResult.routed_execution.route_resolution, null);
    assert.match(
      String(result.stepResult.routed_execution.blocked_next_step),
      /close failing completeness checks before executing spec build/i,
    );
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
