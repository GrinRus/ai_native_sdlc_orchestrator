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

/**
 * @param {string} repoRoot
 * @param {{ command: string, args: string[] }} runtime
 */
function configureCodexExternalRuntime(repoRoot, runtime) {
  const adapterPath = path.join(repoRoot, "examples/adapters/codex-cli.yaml");
  const source = fs.readFileSync(adapterPath, "utf8");
  const executionBlock = [
    "execution:",
    "  live_baseline: true",
    "  runtime_mode: external-process",
    "  handler: codex-cli-external-runner",
    "  evidence_namespace: evidence://adapter-live/codex-cli",
    "  external_runtime:",
    `    command: ${JSON.stringify(runtime.command)}`,
    "    args:",
    ...runtime.args.map((argument) => `      - ${JSON.stringify(argument)}`),
    "    request_via_stdin: true",
    "    timeout_ms: 30000",
  ].join("\n");
  const updated = source.replace(/execution:\n[\s\S]*?\nsandbox_mode:/u, `${executionBlock}\nsandbox_mode:`);
  fs.writeFileSync(adapterPath, updated, "utf8");
}

test("executeRoutedStep resolves route/assets/policy/adapter and persists compiled context for runner dry-runs", () => {
  withTempRepo((repoRoot) => {
    for (const stepClass of ["implement", "review", "qa"]) {
      const result = executeRoutedStep({
        projectRef: repoRoot,
        cwd: repoRoot,
        stepClass,
        dryRun: true,
      });

      assert.equal(fs.existsSync(result.stepResultPath), true);
      assert.equal(result.stepResult.step_class, "runner");
      assert.equal(result.stepResult.status, "passed");
      assert.equal(result.stepResult.routed_execution.mode, "dry-run");
      assert.equal(result.stepResult.routed_execution.route_resolution.step_class, stepClass);
      assert.equal(result.stepResult.routed_execution.asset_resolution.wrapper.wrapper_ref, "wrapper.runner.default@v3");
      assert.equal(result.stepResult.routed_execution.policy_resolution.policy.policy_id, "policy.step.runner.default");
      assert.equal(
        typeof result.stepResult.routed_execution.policy_resolution.resolved_bounds.budget.max_cost_usd,
        "number",
      );
      assert.ok(result.stepResult.routed_execution.policy_resolution.resolved_bounds.budget.max_cost_usd > 0);
      assert.equal(result.stepResult.routed_execution.delivery_plan.delivery_mode, "fork-first-pr");
      assert.equal(result.stepResult.routed_execution.delivery_plan.status, "blocked");
      assert.equal(fs.existsSync(result.stepResult.routed_execution.delivery_plan.delivery_plan_file), true);
      assert.equal(result.stepResult.routed_execution.adapter_resolution.adapter.adapter_id, "codex-cli");
      assert.equal(result.stepResult.routed_execution.adapter_response.adapter_id, "mock-runner");
      assert.ok(Array.isArray(result.stepResult.evidence_refs));
      assert.ok(result.stepResult.evidence_refs.length > 0);
      assert.ok(Array.isArray(result.stepResult.routed_execution.architecture_traceability.contract_refs));
      assert.ok(
        result.stepResult.routed_execution.architecture_traceability.contract_refs.includes("docs/contracts/step-result.md"),
      );

      const contextCompilation = result.stepResult.routed_execution.context_compilation;
      assert.equal(typeof contextCompilation.compiled_context_ref, "string");
      assert.match(contextCompilation.compiled_context_ref, /^compiled-context:\/\//u);
      assert.equal(fs.existsSync(contextCompilation.compiled_context_file), true);
      assert.equal(typeof contextCompilation.diagnostics.compiled_context_fingerprint, "string");
      assert.equal(contextCompilation.compiled_context_artifact.step, stepClass);
      assert.equal(contextCompilation.compiled_context_artifact.prompt_bundle_ref, "prompt-bundle://runner-default@v3");
      assert.ok(
        contextCompilation.compiled_context_artifact.context_bundle_refs.includes(
          "context-bundle://context.bundle.runner.foundation@v1",
        ),
      );

      assert.equal(typeof result.stepResult.routed_execution.adapter_request.context, "object");
      assert.equal(
        result.stepResult.routed_execution.adapter_request.context.compiled_context_ref,
        contextCompilation.compiled_context_ref,
      );
      assert.ok(
        result.stepResult.evidence_refs.includes(contextCompilation.compiled_context_ref),
      );
    }
  });
});

test("executeRoutedStep keeps same-step routed artifacts distinct for repeated executions in one runtime root", () => {
  withTempRepo((repoRoot) => {
    const first = executeRoutedStep({
      projectRef: repoRoot,
      cwd: repoRoot,
      stepClass: "implement",
      dryRun: true,
    });
    const second = executeRoutedStep({
      projectRef: repoRoot,
      cwd: repoRoot,
      stepClass: "implement",
      dryRun: true,
    });

    assert.equal(first.stepResult.status, "passed");
    assert.equal(second.stepResult.status, "passed");
    assert.notEqual(first.stepResultPath, second.stepResultPath);
    assert.notEqual(
      first.stepResult.routed_execution.context_compilation.compiled_context_file,
      second.stepResult.routed_execution.context_compilation.compiled_context_file,
    );
    assert.notEqual(
      first.stepResult.routed_execution.context_compilation.compiled_context_ref,
      second.stepResult.routed_execution.context_compilation.compiled_context_ref,
    );
    assert.equal(fs.existsSync(first.stepResultPath), true);
    assert.equal(fs.existsSync(second.stepResultPath), true);
    assert.equal(fs.existsSync(first.stepResult.routed_execution.context_compilation.compiled_context_file), true);
    assert.equal(fs.existsSync(second.stepResult.routed_execution.context_compilation.compiled_context_file), true);

    assert.equal(first.stepResult.step_result_id, `${first.runId}.step.implement`);
    assert.equal(second.stepResult.step_result_id, `${second.runId}.step.implement.attempt.2`);
    assert.ok(
      second.stepResult.evidence_refs.includes(second.stepResult.routed_execution.context_compilation.compiled_context_ref),
    );
    assert.equal(
      second.stepResult.routed_execution.adapter_request.context.compiled_context_ref,
      second.stepResult.routed_execution.context_compilation.compiled_context_ref,
    );

    const reportFiles = fs.readdirSync(first.runtimeLayout.reportsRoot).filter((entry) => entry.endsWith(".json"));
    assert.ok(reportFiles.filter((entry) => entry.startsWith("step-result-routed-")).length >= 2);
    assert.ok(reportFiles.filter((entry) => entry.startsWith("compiled-context-")).length >= 2);
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

test("executeRoutedStep supports live execution for supported adapter when delivery guardrails are ready", () => {
  withTempRepo((repoRoot) => {
    const executionRoot = path.join(repoRoot, "target-checkout-root");
    fs.mkdirSync(executionRoot, { recursive: true });
    configureCodexExternalRuntime(repoRoot, {
      command: process.execPath,
      args: [
        "-e",
        [
          "const fs=require('node:fs');",
          "const input=JSON.parse(fs.readFileSync(0,'utf8'));",
          "const request=input.request||{};",
          "process.stdout.write(JSON.stringify({",
          "status:'success',",
          "summary:'external runner ok',",
          "output:{runner:'node-inline',step_class:request.step_class||null,cwd:process.cwd()},",
          "evidence_refs:['evidence://external-runner/step-success'],",
          "tool_traces:[{phase:'invoke_adapter',kind:'external-runner-mock',detail:'node-inline'}]",
          "}));",
        ].join(""),
      ],
    });

    const result = executeRoutedStep({
      projectRef: repoRoot,
      cwd: repoRoot,
      stepClass: "implement",
      dryRun: false,
      approvedHandoffRef: "evidence://handoff/approved-1",
      promotionEvidenceRefs: ["evidence://promotion/pass-1"],
      executionRoot,
    });

    assert.equal(result.stepResult.status, "passed");
    assert.equal(result.stepResult.routed_execution.mode, "execute");
    assert.equal(result.stepResult.routed_execution.no_write_enforced, false);
    assert.equal(result.stepResult.routed_execution.delivery_plan.status, "ready");
    assert.equal(result.stepResult.routed_execution.delivery_plan.writeback_allowed, true);
    assert.equal(result.stepResult.routed_execution.adapter_resolution.adapter.adapter_id, "codex-cli");
    assert.equal(result.stepResult.routed_execution.adapter_request.dry_run, false);
    assert.equal(result.stepResult.routed_execution.adapter_response.adapter_id, "codex-cli");
    assert.equal(result.stepResult.routed_execution.adapter_response.status, "success");
    assert.equal(result.stepResult.routed_execution.adapter_response.output.mode, "execute");
    assert.equal(result.stepResult.routed_execution.adapter_response.output.external_runner.command, process.execPath);
    assert.equal(
      fs.realpathSync(result.stepResult.routed_execution.adapter_response.output.external_runner.execution_root),
      fs.realpathSync(executionRoot),
    );
    assert.equal(
      fs.realpathSync(result.stepResult.routed_execution.adapter_response.output.runner_output.cwd),
      fs.realpathSync(executionRoot),
    );
    assert.ok(
      result.stepResult.routed_execution.adapter_response.evidence_refs.includes(
        "evidence://external-runner/step-success",
      ),
    );
    assert.equal(typeof result.stepResult.routed_execution.context_compilation.compiled_context_ref, "string");
    assert.match(
      result.stepResult.routed_execution.context_compilation.compiled_context_ref,
      /^compiled-context:\/\//u,
    );
    assert.ok(
      result.stepResult.evidence_refs.includes(
        result.stepResult.routed_execution.context_compilation.compiled_context_ref,
      ),
    );
  });
});

test("executeRoutedStep reports missing external runner prerequisites as blocked live adapter response", () => {
  withTempRepo((repoRoot) => {
    configureCodexExternalRuntime(repoRoot, {
      command: "__aor_missing_runner_command__",
      args: [],
    });

    const result = executeRoutedStep({
      projectRef: repoRoot,
      cwd: repoRoot,
      stepClass: "implement",
      dryRun: false,
      approvedHandoffRef: "evidence://handoff/approved-3",
      promotionEvidenceRefs: ["evidence://promotion/pass-3"],
    });

    assert.equal(result.stepResult.status, "failed");
    assert.equal(result.stepResult.routed_execution.adapter_response.status, "blocked");
    assert.equal(
      result.stepResult.routed_execution.adapter_response.output.failure_kind,
      "missing-prerequisite",
    );
    assert.match(
      String(result.stepResult.routed_execution.blocked_next_step),
      /Install\/configure external runner prerequisites/i,
    );
  });
});

test("executeRoutedStep blocks live execution deterministically for unapproved or unsupported adapter paths", () => {
  withTempRepo((repoRoot) => {
    const unapproved = executeRoutedStep({
      projectRef: repoRoot,
      cwd: repoRoot,
      stepClass: "implement",
      dryRun: false,
    });

    assert.equal(unapproved.stepResult.status, "failed");
    assert.match(unapproved.stepResult.summary, /delivery guardrails/i);
    assert.equal(unapproved.stepResult.routed_execution.adapter_response.status, "blocked");
    assert.ok(
      Array.isArray(unapproved.stepResult.routed_execution.adapter_response.output.blocking_reasons),
    );
    assert.ok(
      unapproved.stepResult.routed_execution.adapter_response.output.blocking_reasons.includes(
        "approved-handoff-required",
      ),
    );

    const unsupported = executeRoutedStep({
      projectRef: repoRoot,
      cwd: repoRoot,
      stepClass: "implement",
      dryRun: false,
      approvedHandoffRef: "evidence://handoff/approved-2",
      promotionEvidenceRefs: ["evidence://promotion/pass-2"],
      adapterOverrides: {
        implement: "open-code",
      },
    });

    assert.equal(unsupported.stepResult.status, "failed");
    assert.match(unsupported.stepResult.summary, /supported adapters: codex-cli/i);
    assert.equal(unsupported.stepResult.routed_execution.adapter_response.status, "blocked");
    assert.equal(unsupported.stepResult.routed_execution.adapter_response.output.failure_kind, "adapter-not-supported");
    assert.match(
      String(unsupported.stepResult.routed_execution.blocked_next_step),
      /supported live adapter|routed-dry-run-step/i,
    );
  });
});
