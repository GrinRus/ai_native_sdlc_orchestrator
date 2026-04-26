import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { materializeIntakeArtifactPacket } from "../src/artifact-store.mjs";
import { initializeProjectRuntime } from "../src/project-init.mjs";
import { executeRoutedStep, executeRuntimeHarnessControlledStep } from "../src/step-execution-engine.mjs";
import { materializeRuntimeHarnessReport } from "../src/runtime-harness-report.mjs";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const workspaceRoot = path.resolve(currentDir, "../../..");

/**
 * @param {(repoRoot: string) => void} callback
 */
function withTempRepo(callback) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-w2-s05-"));
  const gitInit = spawnSync("git", ["init"], { cwd: repoRoot, encoding: "utf8" });
  assert.equal(gitInit.status, 0, gitInit.stderr || gitInit.stdout);
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
      assert.equal(result.stepResult.mission_outcome, "satisfied");
      assert.equal(result.stepResult.failure_class, "none");
      assert.equal(result.stepResult.runtime_harness_decision, "pass");
      assert.deepEqual(result.stepResult.repair_attempts, []);
      assert.equal(typeof result.stepResult.stage_timings.duration_sec, "number");
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

test("materializeRuntimeHarnessReport aggregates routed step decisions for one run", () => {
  withTempRepo((repoRoot) => {
    const runId = "runtime-harness-smoke";
    const step = executeRoutedStep({
      projectRef: repoRoot,
      cwd: repoRoot,
      stepClass: "implement",
      dryRun: true,
      runId,
      stepId: "run.start.implement",
    });

    const report = materializeRuntimeHarnessReport({
      projectRef: repoRoot,
      cwd: repoRoot,
      runId,
    });

    assert.equal(fs.existsSync(report.reportPath), true);
    assert.equal(report.report.run_id, runId);
    assert.equal(report.report.overall_decision, "pass");
    assert.equal(report.report.step_decisions.length, 1);
    assert.equal(report.report.step_decisions[0].compiled_context_ref, step.stepResult.routed_execution.context_compilation.compiled_context_ref);
    assert.equal(report.report.step_decisions[0].runtime_harness_decision, "pass");
  });
});

test("materializeRuntimeHarnessReport links eval reports by subject_ref run URI", () => {
  withTempRepo((repoRoot) => {
    const runId = "runtime-harness-eval-fail";
    const step = executeRoutedStep({
      projectRef: repoRoot,
      cwd: repoRoot,
      stepClass: "implement",
      dryRun: true,
      runId,
      stepId: "run.start.implement",
    });
    const evalReportPath = path.join(step.runtimeLayout.reportsRoot, `evaluation-report-${runId}.json`);
    fs.writeFileSync(
      evalReportPath,
      `${JSON.stringify(
        {
          report_id: `${runId}.evaluation-report.v1`,
          subject_ref: `run://${runId}`,
          subject_type: "run",
          subject_fingerprint: "sha256:test-eval-fail",
          suite_ref: "suite.regress.short@v1",
          dataset_ref: "dataset.regress.short@v1",
          scorer_metadata: [{ scorer_id: "deterministic", mode: "deterministic", implementation: "test" }],
          grader_results: { deterministic: { passed: 0, failed: 1 } },
          summary_metrics: { total_cases: 1, passed_cases: 0, failed_cases: 1, pass_rate: 0 },
          status: "fail",
          evidence_refs: ["evidence://eval/fail"],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const report = materializeRuntimeHarnessReport({
      projectRef: repoRoot,
      cwd: repoRoot,
      runId,
    });

    assert.equal(report.report.overall_decision, "fail");
    assert.equal(
      report.report.run_findings.some((finding) => finding.failure_class === "eval-failed"),
      true,
    );
  });
});

test("materializeRuntimeHarnessReport flags strict code-changing empty delivery patch", () => {
  withTempRepo((repoRoot) => {
    const runId = "runtime-harness-empty-delivery";
    const step = executeRoutedStep({
      projectRef: repoRoot,
      cwd: repoRoot,
      stepClass: "implement",
      dryRun: true,
      runId,
      stepId: "run.start.implement",
    });
    const deliveryManifestPath = path.join(step.runtimeLayout.artifactsRoot, `delivery-manifest-${runId}.json`);
    fs.writeFileSync(
      deliveryManifestPath,
      `${JSON.stringify(
        {
          manifest_id: `${runId}.delivery-manifest.v1`,
          project_id: "aor-core",
          ticket_id: "ticket.runtime-harness-empty-delivery",
          run_refs: [`run://${runId}`],
          step_ref: `step://${runId}/run.start.implement`,
          delivery_mode: "patch-only",
          writeback_policy: { mode: "patch-only", network_mode: "disabled" },
          repo_deliveries: [{ repo_id: "main", changed_paths: [], writeback_result: "patch-only" }],
          verification_refs: [],
          approval_context: {},
          evidence_root: "evidence://delivery/empty",
          source_refs: {},
          status: "submitted",
          created_at: "2026-04-26T00:00:00.000Z",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const report = materializeRuntimeHarnessReport({
      projectRef: repoRoot,
      cwd: repoRoot,
      runId,
    });

    assert.equal(report.report.overall_decision, "fail");
    assert.equal(
      report.report.run_findings.some((finding) => finding.failure_class === "delivery-empty-patch"),
      true,
    );
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

test("materializeRuntimeHarnessReport marks strict code-changing live no-op as repair", () => {
  withTempRepo((repoRoot) => {
    const runId = "runtime-harness-no-op";
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
          "summary:'external runner ok without edits',",
          "output:{runner:'node-inline',step_class:request.step_class||null,cwd:process.cwd()},",
          "evidence_refs:['evidence://external-runner/no-op-success'],",
          "tool_traces:[{phase:'invoke_adapter',kind:'external-runner-mock',detail:'node-inline-no-op'}]",
          "}));",
        ].join(""),
      ],
    });

    const step = executeRoutedStep({
      projectRef: repoRoot,
      cwd: repoRoot,
      stepClass: "implement",
      dryRun: false,
      runId,
      stepId: "run.start.implement",
      approvedHandoffRef: "evidence://handoff/approved-no-op",
      promotionEvidenceRefs: ["evidence://promotion/pass-no-op"],
      executionRoot: repoRoot,
    });

    assert.equal(step.stepResult.failure_class, "no-op");
    assert.equal(step.stepResult.mission_outcome, "not_satisfied");
    assert.equal(step.stepResult.runtime_harness_decision, "repair");
    assert.equal(step.stepResult.repair_attempts.length, 1);
    assert.equal(step.stepResult.mission_semantics.strict_code_changing_noop, true);

    const report = materializeRuntimeHarnessReport({
      projectRef: repoRoot,
      cwd: repoRoot,
      runId,
    });

    assert.equal(report.report.overall_decision, "repair");
    assert.equal(report.report.step_decisions[0].failure_class, "no-op");
    assert.equal(report.report.step_decisions[0].mission_outcome, "not_satisfied");
    assert.equal(report.report.step_decisions[0].runtime_harness_decision, "repair");
    assert.equal(report.report.step_decisions[0].repair_attempts.length, 1);
    assert.equal(report.report.step_decisions[0].repair_attempts[0].failure_class, "no-op");
    assert.equal(report.report.step_decisions[0].repair_attempts[0].policy_budget.max_attempts, 2);
    assert.deepEqual(report.report.step_decisions[0].mission_semantics.non_bootstrap_changed_paths, []);
  });
});

test("executeRuntimeHarnessControlledStep repairs a failed implement step and reruns the original step", () => {
  withTempRepo((repoRoot) => {
    const runId = "runtime-harness-controller-repair-pass";
    configureCodexExternalRuntime(repoRoot, {
      command: process.execPath,
      args: [
        "-e",
        [
          "const fs=require('node:fs');",
          "const path=require('node:path');",
          "const input=JSON.parse(fs.readFileSync(0,'utf8'));",
          "const request=input.request||{};",
          "if(request.step_class==='repair'){fs.mkdirSync('src',{recursive:true});fs.writeFileSync(path.join('src','repaired.js'),'export const repaired = true;\\n');}",
          "process.stdout.write(JSON.stringify({",
          "status:'success',",
          "summary:'runtime harness controller fixture ok',",
          "output:{runner:'node-inline',step_class:request.step_class||null,cwd:process.cwd()},",
          "evidence_refs:['evidence://external-runner/controller-repair'],",
          "tool_traces:[{phase:'invoke_adapter',kind:'external-runner-mock',detail:'controller-repair'}]",
          "}));",
        ].join(""),
      ],
    });

    const result = executeRuntimeHarnessControlledStep({
      projectRef: repoRoot,
      cwd: repoRoot,
      stepClass: "implement",
      dryRun: false,
      runId,
      stepId: "run.start.implement",
      approvedHandoffRef: "evidence://handoff/controller-repair",
      promotionEvidenceRefs: ["evidence://promotion/controller-repair"],
      executionRoot: repoRoot,
    });

    assert.equal(result.stepResult.status, "passed");
    assert.equal(result.stepResult.runtime_harness_decision, "pass");
    assert.equal(result.stepResult.repair_status, "succeeded_after_repair");
    assert.equal(result.stepResult.repair_attempts.length, 1);
    assert.equal(result.stepResult.repair_attempts[0].policy_action, "repair");
    assert.equal(result.stepResult.repair_attempts[0].result, "pass");
    assert.equal(typeof result.stepResult.repair_attempts[0].repair_compiled_context_ref, "string");
    assert.ok(
      result.stepResult.repair_attempts[0].input_evidence_refs.some((ref) =>
        String(ref).includes("runtime-harness-repair-input"),
      ),
    );
    assert.equal(fs.existsSync(path.join(repoRoot, "src/repaired.js")), true);
    const repairStepResultFile = fs
      .readdirSync(result.runtimeLayout.reportsRoot)
      .find((entry) => entry.startsWith("step-result-") && entry.includes("run.start.implement.repair.1.repair"));
    assert.equal(typeof repairStepResultFile, "string");
    const repairStepResult = JSON.parse(
      fs.readFileSync(path.join(result.runtimeLayout.reportsRoot, /** @type {string} */ (repairStepResultFile)), "utf8"),
    );
    assert.ok(
      repairStepResult.routed_execution.adapter_request.context.provenance.runtime_evidence_refs.some((ref) =>
        String(ref).includes("runtime-harness-repair-input"),
      ),
    );
    assert.ok(
      repairStepResult.evidence_refs.some((ref) => String(ref).includes("runtime-harness-repair-input")),
    );

    const report = materializeRuntimeHarnessReport({
      projectRef: repoRoot,
      cwd: repoRoot,
      runId,
    });
    assert.equal(report.report.overall_decision, "pass");
    assert.equal(
      report.report.step_decisions.some((decision) => decision.repair_attempts?.[0]?.policy_action === "repair"),
      true,
    );
  });
});

test("executeRuntimeHarnessControlledStep exhausts repair budget without recursive repair", () => {
  withTempRepo((repoRoot) => {
    const runId = "runtime-harness-controller-repair-exhausted";
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
          "summary:'runtime harness no-op fixture',",
          "output:{runner:'node-inline-noop',step_class:request.step_class||null,cwd:process.cwd()},",
          "evidence_refs:['evidence://external-runner/controller-noop'],",
          "tool_traces:[{phase:'invoke_adapter',kind:'external-runner-mock',detail:'controller-noop'}]",
          "}));",
        ].join(""),
      ],
    });

    const result = executeRuntimeHarnessControlledStep({
      projectRef: repoRoot,
      cwd: repoRoot,
      stepClass: "implement",
      dryRun: false,
      runId,
      stepId: "run.start.implement",
      approvedHandoffRef: "evidence://handoff/controller-exhausted",
      promotionEvidenceRefs: ["evidence://promotion/controller-exhausted"],
      executionRoot: repoRoot,
    });

    assert.equal(result.stepResult.status, "failed");
    assert.equal(result.stepResult.runtime_harness_decision, "block");
    assert.equal(result.stepResult.repair_status, "exhausted");
    assert.ok(result.stepResult.repair_attempts.length >= 1);
    assert.equal(result.stepResult.repair_attempts.every((attempt) => attempt.policy_action === "repair"), true);
    assert.equal(result.stepResult.repair_attempts.at(-1).result, "exhausted");

    const report = materializeRuntimeHarnessReport({
      projectRef: repoRoot,
      cwd: repoRoot,
      runId,
    });
    assert.equal(report.report.overall_decision, "fail");
    assert.equal(
      report.report.step_decisions.filter((decision) => decision.step_class === "repair").length <= 2,
      true,
    );
  });
});

test("Runtime Harness applies soft mission strictness for docs-only no-op runs", () => {
  withTempRepo((repoRoot) => {
    const runId = "runtime-harness-docs-only-noop";
    const init = initializeProjectRuntime({ projectRef: repoRoot, cwd: repoRoot });
    const requestFile = path.join(repoRoot, "docs-only-request.json");
    fs.writeFileSync(
      requestFile,
      `${JSON.stringify(
        {
          mission_type: "docs-only",
          allowed_paths: ["docs/**"],
          forbidden_paths: ["src/**"],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    materializeIntakeArtifactPacket({
      projectId: init.projectId,
      projectRoot: init.projectRoot,
      projectProfileRef: init.projectProfileRef,
      runtimeLayout: init.runtimeLayout,
      command: "aor intake create",
      missionId: "docs-only-noop",
      requestFile,
    });
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
          "summary:'docs-only noop ok',",
          "output:{runner:'node-inline-noop',step_class:request.step_class||null,cwd:process.cwd()},",
          "evidence_refs:['evidence://external-runner/docs-only-noop'],",
          "tool_traces:[{phase:'invoke_adapter',kind:'external-runner-mock',detail:'docs-only-noop'}]",
          "}));",
        ].join(""),
      ],
    });

    const result = executeRuntimeHarnessControlledStep({
      projectRef: repoRoot,
      cwd: repoRoot,
      stepClass: "implement",
      dryRun: false,
      runId,
      stepId: "run.start.implement",
      approvedHandoffRef: "evidence://handoff/docs-only-noop",
      promotionEvidenceRefs: ["evidence://promotion/docs-only-noop"],
      executionRoot: repoRoot,
    });

    assert.equal(result.stepResult.runtime_harness_decision, "pass");
    assert.equal(result.stepResult.mission_semantics.strict_code_changing_noop, false);
    assert.equal(result.stepResult.mission_semantics.mission_type, "docs-only");
    assert.equal(result.stepResult.mission_semantics.strictness_profile, "soft-docs");

    const report = materializeRuntimeHarnessReport({
      projectRef: repoRoot,
      cwd: repoRoot,
      runId,
    });
    assert.equal(report.report.mission_type, "docs-only");
    assert.equal(report.report.strictness_profile, "soft-docs");
    assert.equal(report.report.overall_decision, "pass");
  });
});

test("Runtime Harness no-op detection ignores mission input files and enforces allowed scope", () => {
  withTempRepo((repoRoot) => {
    const init = initializeProjectRuntime({ projectRef: repoRoot, cwd: repoRoot });
    const requestFile = path.join(repoRoot, "feature-request.json");
    fs.writeFileSync(
      requestFile,
      `${JSON.stringify(
        {
          allowed_paths: ["src/**", "test/**"],
          forbidden_paths: ["docs/**"],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    materializeIntakeArtifactPacket({
      projectId: init.projectId,
      projectRoot: init.projectRoot,
      projectProfileRef: init.projectProfileRef,
      runtimeLayout: init.runtimeLayout,
      command: "aor intake create",
      missionId: "scope-noop",
      requestFile,
    });
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
          "summary:'external runner ok without mission changes',",
          "output:{runner:'node-inline',step_class:request.step_class||null,cwd:process.cwd()},",
          "evidence_refs:['evidence://external-runner/input-only-noop'],",
          "tool_traces:[{phase:'invoke_adapter',kind:'external-runner-mock',detail:'node-inline-input-only-noop'}]",
          "}));",
        ].join(""),
      ],
    });

    const step = executeRoutedStep({
      projectRef: repoRoot,
      cwd: repoRoot,
      stepClass: "implement",
      dryRun: false,
      runId: "runtime-harness-input-only-noop",
      stepId: "run.start.implement",
      approvedHandoffRef: "evidence://handoff/approved-input-only-noop",
      promotionEvidenceRefs: ["evidence://promotion/pass-input-only-noop"],
      executionRoot: repoRoot,
    });

    assert.equal(step.stepResult.failure_class, "no-op");
    assert.deepEqual(step.stepResult.mission_semantics.ignored_input_files, ["feature-request.json"]);
    assert.deepEqual(step.stepResult.mission_semantics.mission_scoped_changed_paths, []);
    assert.deepEqual(step.stepResult.mission_semantics.scope_violation_paths, []);

    const report = materializeRuntimeHarnessReport({
      projectRef: repoRoot,
      cwd: repoRoot,
      runId: "runtime-harness-input-only-noop",
    });

    assert.equal(report.report.overall_decision, "repair");
    assert.deepEqual(report.report.step_decisions[0].mission_semantics.ignored_input_files, ["feature-request.json"]);
    assert.deepEqual(report.report.step_decisions[0].mission_semantics.mission_scoped_changed_paths, []);
  });
});

test("Runtime Harness fails strict runs with forbidden mission-scope changes", () => {
  withTempRepo((repoRoot) => {
    const init = initializeProjectRuntime({ projectRef: repoRoot, cwd: repoRoot });
    const requestFile = path.join(repoRoot, "feature-request.json");
    fs.writeFileSync(
      requestFile,
      `${JSON.stringify({ allowed_paths: ["src/**"], forbidden_paths: ["docs/**"] }, null, 2)}\n`,
      "utf8",
    );
    materializeIntakeArtifactPacket({
      projectId: init.projectId,
      projectRoot: init.projectRoot,
      projectProfileRef: init.projectProfileRef,
      runtimeLayout: init.runtimeLayout,
      command: "aor intake create",
      missionId: "scope-violation",
      requestFile,
    });
    configureCodexExternalRuntime(repoRoot, {
      command: process.execPath,
      args: [
        "-e",
        [
          "const fs=require('node:fs');",
          "const input=JSON.parse(fs.readFileSync(0,'utf8'));",
          "const request=input.request||{};",
          "fs.mkdirSync('docs',{recursive:true});",
          "fs.writeFileSync('docs/out-of-scope.md','forbidden change\\n');",
          "process.stdout.write(JSON.stringify({",
          "status:'success',",
          "summary:'external runner wrote forbidden scope',",
          "output:{runner:'node-inline',step_class:request.step_class||null,cwd:process.cwd()},",
          "evidence_refs:['evidence://external-runner/forbidden-scope'],",
          "tool_traces:[{phase:'invoke_adapter',kind:'external-runner-mock',detail:'node-inline-forbidden-scope'}]",
          "}));",
        ].join(""),
      ],
    });

    const step = executeRoutedStep({
      projectRef: repoRoot,
      cwd: repoRoot,
      stepClass: "implement",
      dryRun: false,
      runId: "runtime-harness-scope-violation",
      stepId: "run.start.implement",
      approvedHandoffRef: "evidence://handoff/approved-scope-violation",
      promotionEvidenceRefs: ["evidence://promotion/pass-scope-violation"],
      executionRoot: repoRoot,
    });

    assert.equal(step.stepResult.failure_class, "repo-scope-violation");
    assert.equal(step.stepResult.runtime_harness_decision, "fail");
    assert.deepEqual(step.stepResult.mission_semantics.scope_violation_paths, ["docs/out-of-scope.md"]);

    const report = materializeRuntimeHarnessReport({
      projectRef: repoRoot,
      cwd: repoRoot,
      runId: "runtime-harness-scope-violation",
    });

    assert.equal(report.report.overall_decision, "fail");
    assert.equal(report.report.step_decisions[0].failure_class, "repo-scope-violation");
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
      "missing-command",
    );
    assert.match(
      String(result.stepResult.routed_execution.blocked_next_step),
      /Install\/configure external runner prerequisites/i,
    );
  });
});

test("executeRoutedStep blocks live execution deterministically for unapproved or misconfigured adapter paths", () => {
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

    const misconfigured = executeRoutedStep({
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

    assert.equal(misconfigured.stepResult.status, "failed");
    assert.match(misconfigured.stepResult.summary, /live runtime is misconfigured/i);
    assert.equal(misconfigured.stepResult.routed_execution.adapter_response.status, "blocked");
    assert.equal(
      misconfigured.stepResult.routed_execution.adapter_response.output.failure_kind,
      "missing-live-runtime",
    );
    assert.match(
      String(misconfigured.stepResult.routed_execution.blocked_next_step),
      /Install\/configure external runner prerequisites|routed-dry-run-step/i,
    );
  });
});
