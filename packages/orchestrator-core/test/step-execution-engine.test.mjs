import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { materializeIntakeArtifactPacket } from "../src/artifact-store.mjs";
import { readRunEventHistory } from "../src/control-plane/read-surface.mjs";
import { initializeProjectRuntime } from "../src/project-init.mjs";
import { resolveCanonicalContainedPath } from "../src/shared/canonical-paths.mjs";
import { invokeStepAdapterForStep } from "../src/step-adapter-invocation.mjs";
import {
  executeRoutedStep as executeRoutedStepWithoutAuditOverride,
  executeRuntimeHarnessControlledStep as executeRuntimeHarnessControlledStepWithoutAuditOverride,
} from "../src/step-execution-engine.mjs";
import { classifyRuntimeStepOutcome, materializeRuntimeHarnessReport } from "../src/runtime-harness-report.mjs";
import {
  collectMissionChangeEvidence,
  filterNonBootstrapChangedPaths,
  filterRunnerOwnedStatePaths,
  listChangedPaths,
  matchesScopePattern,
  parseGitStatusPorcelainZ,
} from "../src/shared/mission-scope.mjs";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const workspaceRoot = path.resolve(currentDir, "../../..");

// These fixtures intentionally exercise external write-capable development probes.
// The release-hold behavior itself is covered separately by the readiness suite.
const executeRoutedStep = (options) =>
  executeRoutedStepWithoutAuditOverride({ ...options, unsafeDevelopmentOverride: true });
const executeRuntimeHarnessControlledStep = (options) =>
  executeRuntimeHarnessControlledStepWithoutAuditOverride({ ...options, unsafeDevelopmentOverride: true });

function fakeModelAdapterProfile(args) {
  return {
    runner_family: "fake",
    execution: {
      runtime_mode: "external-process",
      handler: "fake-external-runner",
      evidence_namespace: "evidence://adapter-live/fake",
      external_runtime: {
        command: process.execPath,
        model_argument: { prefix_args: ["--"], flag: "--model" },
        permission_policy: { default_mode: "test", modes: { test: { args } } },
        request_via_stdin: true,
        request_transport: "stdin-json",
        stdin_json_scope: "test-only",
        timeout_ms: 30000,
      },
    },
  };
}

test("adapter invocation executes one compatible fallback and records argv/model parity", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aor-w58-s03-fallback-"));
  try {
    const primary = fakeModelAdapterProfile(["-e", "process.exit(1)"]);
    const fallback = fakeModelAdapterProfile([
      "-e",
      "process.stdout.write(JSON.stringify({status:'success',summary:'fallback ok'}))",
    ]);
    const result = invokeStepAdapterForStep({
      dryRun: false,
      requestedStepClass: "implement",
      adapterResolution: {
        adapter: { adapter_id: "primary-fake", profile: primary },
        execution_candidates: [
          { candidate_index: 0, kind: "primary", adapter_id: "primary-fake", provider: "first", requested_model: "coding-primary", effective_model: "model-a", model_source: "policy-approved-alias", profile: primary },
          { candidate_index: 1, kind: "fallback", adapter_id: "fallback-fake", provider: "second", requested_model: "coding-fallback", effective_model: "model-b", model_source: "policy-approved-alias", profile: fallback },
        ],
      },
      adapterRequest: {
        request_id: "fallback-request",
        run_id: "fallback-run",
        step_id: "fallback-step",
        step_class: "implement",
        route: { resolved_route_id: "route.implement.default", retry_policy_ref: "retry.transient.default" },
        asset_bundle: {},
        policy_bundle: { policy: { profile: { retry: { max_attempts: 1, on: ["runner-crash"] } } } },
        input_packet_refs: [],
        dry_run: false,
        context: {},
      },
      deliveryPlan: { status: "ready", execution_allowed: true },
      runtimeEvidenceRoot: path.join(root, "evidence"),
      projectRoot: root,
      executionRoot: root,
    });
    assert.equal(result.status, "passed");
    assert.equal(result.adapterResponse.output.route_attempts.length, 2);
    assert.equal(result.adapterResponse.output.fallback_transitions.length, 1);
    assert.equal(result.adapterResponse.output.effective_model, "model-b");
    assert.deepEqual(
      result.adapterResponse.output.external_runner.args.slice(-3),
      ["--", "--model", "model-b"],
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

/**
 * @param {(repoRoot: string) => void} callback
 */
function withTempRepo(callback) {
  const repoRoot = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "aor-w2-s05-")));
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
 * @param {Record<string, string>} env
 * @param {() => void} callback
 */
function withEnv(env, callback) {
  const previous = new Map(Object.keys(env).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(env)) {
    process.env[key] = value;
  }
  try {
    callback();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("changed path parsing ignores AOR runtime before bootstrap-owned filtering", () => {
  withTempRepo((repoRoot) => {
    const cachePath = path.join(
      repoRoot,
      ".aor/cache/ms-playwright/chromium/Google Chrome for Testing.app/Contents/Info.plist",
    );
    const quotedCachePath = path.join(repoRoot, ".aor/rehearsal-venv/lib/python3.10/launcher manifest.xml");
    const sourcePath = path.join(repoRoot, "src/feature with space.txt");
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.mkdirSync(path.dirname(quotedCachePath), { recursive: true });
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    fs.writeFileSync(cachePath, "runtime cache\n", "utf8");
    fs.writeFileSync(quotedCachePath, "quoted runtime cache\n", "utf8");
    fs.writeFileSync(sourcePath, "target change\n", "utf8");

    const changedPaths = listChangedPaths(repoRoot).changedPaths;
    assert.ok(changedPaths.includes("src/feature with space.txt"));
    assert.equal(
      changedPaths.some((entry) => entry.startsWith(".aor/")),
      false,
    );
    assert.equal(
      filterNonBootstrapChangedPaths(changedPaths).some((entry) => entry.startsWith(".aor/")),
      false,
    );
  });
});

test("NUL-delimited Git status preserves both rename endpoints and literal path bytes", () => {
  const parsed = parseGitStatusPorcelainZ(
    "R  source/new name.ts\0source/old name.ts\0?? source/unicode-λ.ts\0 D source/line\r\nbreak.ts\0",
  );
  assert.deepEqual(parsed[0], {
    indexStatus: "R",
    worktreeStatus: " ",
    kind: "rename",
    path: "source/new name.ts",
    sourcePath: "source/old name.ts",
    destinationPath: "source/new name.ts",
    paths: ["source/old name.ts", "source/new name.ts"],
  });
  assert.deepEqual(parsed[1].paths, ["source/unicode-λ.ts"]);
  assert.deepEqual(parsed[2].paths, ["source/line\r\nbreak.ts"]);
  assert.equal(matchesScopePattern("source/*.ts", "source/new name.ts"), true);
  assert.equal(matchesScopePattern("source/*.ts", "source/nested/new.ts"), false);
  assert.equal(matchesScopePattern("source/**", "source-escape/new.ts"), false);
});

test("canonical containment rejects symlink ancestors that escape the project boundary", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-contained-project-"));
  const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-contained-outside-"));
  try {
    fs.mkdirSync(path.join(projectRoot, "source"));
    fs.symlinkSync(outsideRoot, path.join(projectRoot, "source", "external"), "dir");
    assert.equal(resolveCanonicalContainedPath({ root: projectRoot, relativePath: "source/new.ts" }).ok, true);
    const escaped = resolveCanonicalContainedPath({ root: projectRoot, relativePath: "source/external/new.ts" });
    assert.equal(escaped.ok, false);
    assert.equal(escaped.reason, "symlink-escape");
    assert.equal(resolveCanonicalContainedPath({ root: projectRoot, relativePath: "../outside.ts" }).ok, false);
    assert.equal(resolveCanonicalContainedPath({ root: projectRoot, relativePath: "source\\new.ts" }).ok, false);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(outsideRoot, { recursive: true, force: true });
  }
});

test("mission evidence treats SSL key log output as diagnostic noise, not meaningful product diff", () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-mission-scope-"));
  const gitInit = spawnSync("git", ["init"], { cwd: repoRoot, encoding: "utf8" });
  assert.equal(gitInit.status, 0, gitInit.stderr || gitInit.stdout);

  try {
    const sourcePath = path.join(repoRoot, "src/index.py");
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    fs.writeFileSync(sourcePath, "print('target change')\n", "utf8");
    fs.writeFileSync(path.join(repoRoot, "test"), "# TLS secrets log file, generated by OpenSSL / Python\n", "utf8");

    const evidence = collectMissionChangeEvidence({
      projectRoot: repoRoot,
      artifactsRoot: path.join(repoRoot, ".aor/artifacts"),
      evidenceRoot: repoRoot,
    });

    assert.ok(evidence.changedPaths.includes("test"));
    assert.deepEqual(evidence.diagnosticSideEffectPaths, ["test"]);
    assert.deepEqual(evidence.meaningfulChangedPaths, ["src/index.py"]);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("runner-owned state paths are tracked outside bootstrap-owned runtime paths", () => {
  withTempRepo((repoRoot) => {
    const qwenSkillPath = path.join(repoRoot, ".qwen/skills/aor-implement-regression-fix/SKILL.md");
    const aorRuntimePath = path.join(repoRoot, ".aor/projects/demo/reports/runtime.json");
    fs.mkdirSync(path.dirname(qwenSkillPath), { recursive: true });
    fs.mkdirSync(path.dirname(aorRuntimePath), { recursive: true });
    fs.writeFileSync(qwenSkillPath, "runner-local skill state\n", "utf8");
    fs.writeFileSync(aorRuntimePath, "{}\n", "utf8");

    const changedPaths = listChangedPaths(repoRoot).changedPaths;

    assert.deepEqual(filterRunnerOwnedStatePaths(changedPaths), [
      ".qwen/skills/aor-implement-regression-fix/SKILL.md",
    ]);
    assert.equal(
      filterNonBootstrapChangedPaths(changedPaths).some((entry) => entry.startsWith(".aor/")),
      false,
    );
  });
});

/**
 * @param {string} repoRoot
 * @param {{ command: string, args: string[] }} runtime
 */
function configureCodexExternalRuntime(repoRoot, runtime) {
  const adapterPath = path.join(repoRoot, "examples/adapters/codex-cli.yaml");
  const source = fs.readFileSync(adapterPath, "utf8");
  const permissionArgs = runtime.args.length > 0 ? runtime.args : ["--version"];
  const executionBlock = [
    "execution:",
    "  live_baseline: true",
    "  runtime_mode: external-process",
    "  handler: codex-cli-external-runner",
    "  evidence_namespace: evidence://adapter-live/codex-cli",
    "  external_runtime:",
    `    command: ${JSON.stringify(runtime.command)}`,
    "    model_argument:",
    "      prefix_args: [--]",
    "      flag: --model",
    "    permission_policy:",
    "      default_mode: full-bypass",
    "      modes:",
    "        full-bypass:",
    "          args:",
    ...permissionArgs.map((argument) => `            - ${JSON.stringify(argument)}`),
    "    request_via_stdin: true",
    "    stdin_json_scope: test-only",
    "    timeout_ms: 30000",
  ].join("\n");
  const updated = source.replace(/execution:\n[\s\S]*?\nsandbox_mode:/u, `${executionBlock}\nsandbox_mode:`);
  fs.writeFileSync(adapterPath, updated, "utf8");
}

/**
 * @param {string} repoRoot
 * @param {{ command: string, fullBypassArgs: string[], restrictedArgs: string[] }} runtime
 */
function configureCodexExternalRuntimePermissionModes(repoRoot, runtime) {
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
    "    model_argument:",
    "      prefix_args: [--]",
    "      flag: --model",
    "    permission_policy:",
    "      default_mode: full-bypass",
    "      modes:",
    "        full-bypass:",
    "          args:",
    ...runtime.fullBypassArgs.map((argument) => `            - ${JSON.stringify(argument)}`),
    "        restricted:",
    "          args:",
    ...runtime.restrictedArgs.map((argument) => `            - ${JSON.stringify(argument)}`),
    "    request_via_stdin: true",
    "    stdin_json_scope: test-only",
    "    timeout_ms: 30000",
  ].join("\n");
  const updated = source.replace(/execution:\n[\s\S]*?\nsandbox_mode:/u, `${executionBlock}\nsandbox_mode:`);
  fs.writeFileSync(adapterPath, updated, "utf8");
}

/**
 * @param {string} repoRoot
 * @param {{ command: string }} runtime
 */
function configureOpenCodeExternalRuntime(repoRoot, runtime) {
  const adapterPath = path.join(repoRoot, "examples/adapters/open-code.yaml");
  const source = fs.readFileSync(adapterPath, "utf8");
  const updated = source.replace(/\n    command: .+\n/u, `\n    command: ${JSON.stringify(runtime.command)}\n`);
  fs.writeFileSync(adapterPath, updated, "utf8");
}

test("executeRoutedStep resolves route/assets/policy/adapter and persists compiled context for runner dry-runs", () => {
  withTempRepo((repoRoot) => {
    for (const stepClass of ["implement", "review", "qa"]) {
      const expectedSkillRefs = {
        implement: ["skill.runner.implement@v1"],
        review: ["skill.runner.review@v1"],
        qa: ["skill.runner.qa@v1"],
      }[stepClass];
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
      assert.deepEqual(contextCompilation.compiled_context_artifact.skill_refs, expectedSkillRefs);

      assert.equal(typeof result.stepResult.routed_execution.adapter_request.context, "object");
      assert.equal(
        result.stepResult.routed_execution.adapter_request.context.compiled_context_ref,
        contextCompilation.compiled_context_ref,
      );
      assert.equal(
        result.stepResult.routed_execution.adapter_request.context.compiled_context_file,
        contextCompilation.compiled_context_file,
      );
      assert.deepEqual(result.stepResult.routed_execution.adapter_request.context.skill_refs, expectedSkillRefs);
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
    const stepResult = JSON.parse(fs.readFileSync(step.stepResultPath, "utf8"));
    stepResult.quality_repair_lineage = {
      request_ref: "evidence://.aor/projects/aor-core/reports/quality-repair-request-runtime-harness-smoke.json",
      cycle_id: "runtime-harness-smoke.quality-cycle.review.v1",
      source_stage: "review",
      status: "review-required",
      attempt_index: 1,
      evidence_refs: [
        "evidence://.aor/projects/aor-core/reports/quality-repair-request-runtime-harness-smoke.json",
      ],
    };
    fs.writeFileSync(step.stepResultPath, `${JSON.stringify(stepResult, null, 2)}\n`, "utf8");

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
    assert.equal(report.report.step_decisions[0].quality_repair_lineage.request_ref, stepResult.quality_repair_lineage.request_ref);
    assert.equal(report.report.quality_repair_lineage.request_ref, stepResult.quality_repair_lineage.request_ref);
  });
});

test("materializeRuntimeHarnessReport aggregates linked run-decision step evidence", () => {
  withTempRepo((repoRoot) => {
    const runId = "runtime-harness-linked-step";
    const step = executeRoutedStep({
      projectRef: repoRoot,
      cwd: repoRoot,
      stepClass: "implement",
      dryRun: true,
      runId,
      stepId: "run.start.implement",
    });
    const linkedReportsRoot = path.join(repoRoot, ".aor/projects/sibling-run/reports");
    fs.mkdirSync(linkedReportsRoot, { recursive: true });
    const linkedStepResultPath = path.join(linkedReportsRoot, path.basename(step.stepResultPath));
    fs.renameSync(step.stepResultPath, linkedStepResultPath);
    const linkedStepResultRef = `evidence://${path.relative(repoRoot, linkedStepResultPath).replace(/\\/g, "/")}`;

    const report = materializeRuntimeHarnessReport({
      projectRef: repoRoot,
      cwd: repoRoot,
      runId,
      runDecision: {
        overall_decision: "pass",
        terminal_status: "closed",
        failure_class: "none",
        repair_status: "not_required",
        summary: "Runtime Harness closed linked step evidence.",
        evidence_refs: [linkedStepResultRef],
      },
    });

    assert.equal(report.report.overall_decision, "pass");
    assert.equal(report.report.step_decisions.length, 1);
    assert.equal(report.report.step_decisions[0].compiled_context_ref, step.stepResult.routed_execution.context_compilation.compiled_context_ref);
    assert.ok(report.report.evidence_refs.includes(linkedStepResultRef));
  });
});

test("runtime harness classifies structured permission denials before strict no-op repair", () => {
  const outcome = classifyRuntimeStepOutcome(
    {
      step_result_id: "run.permission.step.implement",
      run_id: "run.permission",
      step_id: "run.start.implement",
      step_class: "runner",
      status: "passed",
      summary: "Adapter completed without changes.",
      evidence_refs: [],
      routed_execution: {
        mode: "execute",
        adapter_response: {
          status: "success",
          output: {
            runner_output: {
              type: "result",
              result: "Could you grant permission to read the handoff packet?",
              permission_denials: [
                {
                  tool_name: "Read",
                  tool_input: {
                    file_path: ".aor/projects/run/artifacts/handoff.json",
                  },
                },
              ],
            },
          },
        },
      },
    },
    {
      gitStatusAvailable: true,
      strictCodeChangingNoop: true,
      meaningfulChangedPaths: [],
    },
  );

  assert.deepEqual(outcome, {
    failureClass: "permission-mode-blocked",
    decision: "repair",
    missionOutcome: "not_satisfied",
  });

  const nestedOutcome = classifyRuntimeStepOutcome(
    {
      step_result_id: "run.permission.step.implement.nested",
      run_id: "run.permission",
      step_id: "run.start.implement",
      step_class: "runner",
      status: "passed",
      summary: "Adapter completed without changes.",
      evidence_refs: [],
      routed_execution: {
        mode: "execute",
        adapter_response: {
          status: "success",
          output: {
            runner_output: {
              jsonl_events: [
                {
                  type: "tool_result",
                  permission_denials: [
                    {
                      tool_name: "Read",
                      tool_input: {
                        file_path: ".aor/projects/run/artifacts/spec.json",
                      },
                    },
                  ],
                },
              ],
            },
          },
        },
      },
    },
    {
      gitStatusAvailable: true,
      strictCodeChangingNoop: true,
      meaningfulChangedPaths: [],
    },
  );

  assert.deepEqual(nestedOutcome, {
    failureClass: "permission-mode-blocked",
    decision: "repair",
    missionOutcome: "not_satisfied",
  });

  const mediatedOutcome = classifyRuntimeStepOutcome(
    {
      step_result_id: "run.permission.step.implement.mediated",
      run_id: "run.permission",
      step_id: "run.start.implement",
      step_class: "runner",
      status: "failed",
      summary: "Adapter blocked on permission.",
      evidence_refs: [],
      failure_class: "permission-mode-blocked",
      runtime_permission_decision: {
        decision: "ask_user",
        rule_id: "runtime-permission.ask-user.sensitive-or-unknown",
      },
      routed_execution: {
        mode: "execute",
        adapter_response: {
          status: "blocked",
          output: {
            failure_kind: "permission-mode-blocked",
          },
        },
      },
    },
    {
      gitStatusAvailable: true,
      strictCodeChangingNoop: true,
      meaningfulChangedPaths: [],
    },
  );

  assert.deepEqual(mediatedOutcome, {
    failureClass: "permission-mode-blocked",
    decision: "block",
    missionOutcome: "not_satisfied",
  });

  const approvedOutcome = classifyRuntimeStepOutcome(
    {
      step_result_id: "run.permission.step.implement.approved",
      run_id: "run.permission",
      step_id: "run.start.implement",
      step_class: "runner",
      status: "failed",
      summary: "Operator approved permission.",
      evidence_refs: [],
      failure_class: "permission-mode-blocked",
      runtime_permission_decision: {
        decision: "user_approved",
        rule_id: "runtime-permission.ask-user.sensitive-or-unknown",
      },
      routed_execution: {
        mode: "execute",
        adapter_response: {
          status: "blocked",
          output: {
            failure_kind: "permission-mode-blocked",
          },
        },
      },
    },
    {
      gitStatusAvailable: true,
      strictCodeChangingNoop: true,
      meaningfulChangedPaths: [],
    },
  );

  assert.deepEqual(approvedOutcome, {
    failureClass: "permission-mode-blocked",
    decision: "block",
    missionOutcome: "not_satisfied",
  });
});

test("runtime harness ignores target Permission denied diagnostics when mission changes exist", () => {
  const outcome = classifyRuntimeStepOutcome(
    {
      step_result_id: "run.target-permission.step.implement",
      run_id: "run.target-permission",
      step_id: "run.start.implement",
      step_class: "runner",
      status: "passed",
      summary: "Adapter completed with target diagnostics.",
      evidence_refs: [],
      routed_execution: {
        mode: "execute",
        adapter_response: {
          status: "success",
          output: {
            runner_output: {
              jsonl_events: [
                {
                  type: "item.completed",
                  item: {
                    type: "agent_message",
                    text: "Full npm test reported Playwright Permission denied (1100) in the browser sandbox, but source/utils/merge.ts and test/headers.ts were changed.",
                  },
                },
              ],
            },
          },
        },
      },
    },
    {
      gitStatusAvailable: true,
      strictCodeChangingNoop: true,
      meaningfulChangedPaths: ["source/utils/merge.ts", "test/headers.ts"],
    },
  );

  assert.deepEqual(outcome, {
    failureClass: "none",
    decision: "pass",
    missionOutcome: "satisfied",
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
          subject_snapshot: { reference: `run://${runId}`, family: "run", version: 1, digest: "sha256:test-eval-fail", source_refs: ["evidence://eval/fail"] },
          case_resolution: [{ case_id: "case-fail", status: "resolved", input_digest: "sha256:input", expected_digest: "sha256:expected" }],
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

test("executeRoutedStep returns the completed result for an idempotent request key", () => {
  withTempRepo((repoRoot) => {
    const options = {
      projectRef: repoRoot,
      cwd: repoRoot,
      stepClass: "implement",
      dryRun: true,
      runId: "run.idempotent.attempt",
      stepId: "step.idempotent.attempt",
      requestKey: "request.idempotent.attempt",
    };
    const first = executeRoutedStep(options);
    const retry = executeRoutedStep(options);
    assert.equal(retry.stepResultPath, first.stepResultPath);
    assert.equal(retry.stepResult.step_result_id, first.stepResult.step_result_id);
    assert.equal(fs.readdirSync(path.dirname(first.stepResultPath)).filter((file) => file.includes("run.idempotent.attempt")).length > 0, true);
  });
});

test("executeRoutedStep injects mission traceability before adapter request", () => {
  withTempRepo((repoRoot) => {
    const init = initializeProjectRuntime({ cwd: repoRoot, projectRef: repoRoot });
    fs.writeFileSync(
      path.join(init.runtimeLayout.reportsRoot, "project-analysis-report.json"),
      `${JSON.stringify(
        {
          report_id: "project-analysis-report",
          feature_traceability: {
            mission_id: "ky-retry-hooks-governance",
            required_path_prefixes: ["source/", "test/", "index.d.ts"],
            expected_evidence: ["verify-summary", "review-report"],
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    const handoffFile = path.join(init.runtimeLayout.artifactsRoot, "approved-handoff.json");
    fs.writeFileSync(
      handoffFile,
      `${JSON.stringify(
        {
          packet_id: "approved-handoff",
          feature_traceability: {
            mission_id: "ky-retry-hooks-governance",
            request_title: "Exercise retry hooks",
          },
          allowed_paths: ["source/**", "test/**", "index.d.ts"],
          repo_scopes: [{ repo_id: "sindresorhus/ky", paths: ["source/**", "test/**", "index.d.ts"] }],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const result = executeRoutedStep({
      projectRef: repoRoot,
      cwd: repoRoot,
      stepClass: "implement",
      dryRun: true,
      runId: "runtime-harness-traceability-adapter-request",
      stepId: "run.start.implement",
      approvedHandoffRef: handoffFile,
      promotionEvidenceRefs: ["evidence://promotion/pass-traceability"],
      executionRoot: repoRoot,
    });

    const adapterTraceability = result.stepResult.routed_execution.adapter_request.feature_traceability;
    assert.deepEqual(adapterTraceability.required_path_prefixes, ["source/", "test/", "index.d.ts"]);
    assert.deepEqual(adapterTraceability.allowed_paths, ["source/**", "test/**", "index.d.ts"]);
    assert.deepEqual(result.stepResult.routed_execution.feature_traceability.allowed_paths, [
      "source/**",
      "test/**",
      "index.d.ts",
    ]);
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
    const runId = "provider-heartbeat-live-step";
    const init = initializeProjectRuntime({ projectRef: repoRoot, cwd: repoRoot });
    const providerStepStatusStateFile = path.join(init.runtimeLayout.stateRoot, `run-control-state-${runId}.json`);
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
      runId,
      stepId: "run.start.implement",
      approvedHandoffRef: "evidence://handoff/approved-1",
      promotionEvidenceRefs: [
        "evidence://promotion/pass-1",
        "packet://spec@evidence://reports/spec-step-result.json",
      ],
      executionRoot,
      providerStepStatusStateFile,
    });

    assert.equal(result.stepResult.status, "passed");
    assert.equal(result.stepResult.routed_execution.mode, "execute");
    assert.equal(result.stepResult.routed_execution.no_write_enforced, false);
    assert.equal(result.stepResult.routed_execution.delivery_plan.status, "ready");
    assert.equal(result.stepResult.routed_execution.delivery_plan.writeback_allowed, false);
    assert.equal(result.stepResult.routed_execution.delivery_plan.target_write_allowed, true);
    assert.equal(result.stepResult.routed_execution.delivery_plan.direct_edits_allowed, true);
    assert.equal(result.stepResult.routed_execution.delivery_plan.meaningful_change_required, true);
    assert.equal(result.stepResult.routed_execution.adapter_resolution.adapter.adapter_id, "codex-cli");
    assert.equal(result.stepResult.routed_execution.adapter_request.dry_run, false);
    assert.deepEqual(result.stepResult.routed_execution.adapter_request.context.execution_permissions, {
      execution_allowed: true,
      writeback_allowed: false,
      target_write_allowed: true,
      direct_edits_allowed: true,
      meaningful_change_required: true,
      delivery_mode: "fork-first-pr",
    });
    assert.equal(result.stepResult.routed_execution.adapter_response.adapter_id, "codex-cli");
    assert.equal(result.stepResult.routed_execution.adapter_response.status, "success");
    assert.equal(result.stepResult.routed_execution.adapter_response.output.mode, "execute");
    assert.equal(result.stepResult.routed_execution.adapter_response.output.external_runner.command, process.execPath);
    assert.ok(
      result.stepResult.routed_execution.adapter_request.input_packet_refs.includes(
        "packet://handoff@evidence://handoff/approved-1",
      ),
    );
    assert.ok(
      result.stepResult.routed_execution.adapter_request.input_packet_refs.includes(
        "packet://spec@evidence://reports/spec-step-result.json",
      ),
    );
    assert.equal(
      result.stepResult.routed_execution.adapter_request.context.required_inputs_resolved.packets.required.find(
        (entry) => entry.packet === "handoff",
      )?.resolved_ref,
      "packet://handoff@evidence://handoff/approved-1",
    );
    assert.equal(result.stepResult.external_runner.command, process.execPath);
    assert.equal(result.stepResult.external_runner.permission_mode, "full-bypass");
    const isolatedExecutionRoot = result.stepResult.routed_execution.workspace_isolation.execution_root;
    assert.equal(
      fs.realpathSync(result.stepResult.routed_execution.adapter_response.output.external_runner.execution_root),
      fs.realpathSync(isolatedExecutionRoot),
    );
    assert.equal(
      fs.realpathSync(result.stepResult.routed_execution.adapter_response.output.runner_output.cwd),
      fs.realpathSync(isolatedExecutionRoot),
    );
    assert.equal(fs.readdirSync(executionRoot).length, 0);
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
    const heartbeatHistory = readRunEventHistory({ projectRef: repoRoot, cwd: repoRoot, runId });
    const heartbeatEvents = heartbeatHistory.events.filter((event) => event.event_type === "provider.heartbeat");
    assert.equal(heartbeatEvents.length, 2);
    assert.equal(heartbeatEvents[0].provider_step_status?.status, "running");
    assert.equal(heartbeatEvents[1].provider_step_status?.status, "completed");
    assert.equal(heartbeatEvents[1].provider_step_status?.adapter, "codex-cli");
  });
});

test("no-write live execution runs in a disposable checkout and blocks adapter mutations", () => {
  withTempRepo((repoRoot) => {
    const profilePath = path.join(repoRoot, "examples/project.aor.yaml");
    fs.writeFileSync(
      profilePath,
      fs.readFileSync(profilePath, "utf8").replace("default_delivery_mode: fork-first-pr", "default_delivery_mode: no-write"),
      "utf8",
    );
    configureCodexExternalRuntime(repoRoot, {
      command: process.execPath,
      args: [
        "-e",
        [
          "const fs=require('node:fs');",
          "const input=JSON.parse(fs.readFileSync(0,'utf8'));",
          "const request=input.request||{};",
          "fs.writeFileSync('unauthorized-no-write.txt','must be rejected\\n');",
          "process.stdout.write(JSON.stringify({status:'success',summary:'malicious no-write adapter',output:{permissions:request.context.execution_permissions}}));",
        ].join(""),
      ],
    });

    const result = executeRoutedStepWithoutAuditOverride({
      projectRef: repoRoot,
      cwd: repoRoot,
      stepClass: "implement",
      dryRun: false,
      runId: "no-write-malicious-adapter",
      stepId: "run.start.implement",
    });

    const plan = result.stepResult.routed_execution.delivery_plan;
    assert.equal(plan.status, "ready");
    assert.equal(plan.execution_allowed, true);
    assert.equal(plan.writeback_allowed, false);
    assert.equal(plan.target_write_allowed, false);
    assert.equal(plan.direct_edits_allowed, false);
    assert.equal(plan.meaningful_change_required, false);
    assert.equal(result.stepResult.status, "failed");
    assert.match(result.stepResult.summary, /No-write integrity violation/u);
    assert.equal(result.stepResult.routed_execution.workspace_isolation.primary_integrity.unchanged, true);
    assert.equal(result.stepResult.routed_execution.workspace_isolation.execution_integrity.unchanged, false);
    assert.equal(result.stepResult.routed_execution.workspace_isolation.cleanup.status, "deleted");
    assert.equal(fs.existsSync(result.stepResult.routed_execution.workspace_isolation.execution_root), false);
    assert.equal(fs.existsSync(path.join(repoRoot, "unauthorized-no-write.txt")), false);
    assert.deepEqual(result.stepResult.routed_execution.adapter_request.context.execution_permissions, {
      execution_allowed: true,
      writeback_allowed: false,
      target_write_allowed: false,
      direct_edits_allowed: false,
      meaningful_change_required: false,
      delivery_mode: "no-write",
    });
  });
});

test("live execution records and blocks a malicious adapter mutation of the primary checkout", () => {
  withTempRepo((repoRoot) => {
    const escapedTarget = path.join(repoRoot, "escaped-primary-write.txt");
    configureCodexExternalRuntime(repoRoot, {
      command: process.execPath,
      args: [
        "-e",
        [
          "const fs=require('node:fs');",
          `fs.writeFileSync(${JSON.stringify(escapedTarget)},'escaped\\n');`,
          "process.stdout.write(JSON.stringify({status:'success',summary:'malicious primary mutation',output:{attempted_escape:true}}));",
        ].join(""),
      ],
    });

    const result = executeRoutedStep({
      projectRef: repoRoot,
      cwd: repoRoot,
      stepClass: "implement",
      dryRun: false,
      runId: "malicious-primary-mutation",
      stepId: "run.start.implement",
      approvedHandoffRef: "evidence://handoff/malicious-primary-mutation",
      promotionEvidenceRefs: ["evidence://promotion/malicious-primary-mutation"],
    });

    assert.equal(result.stepResult.status, "failed");
    assert.match(result.stepResult.summary, /Primary checkout integrity violation/u);
    assert.equal(result.stepResult.routed_execution.workspace_isolation.primary_integrity.unchanged, false);
    assert.ok(result.stepResult.routed_execution.workspace_isolation.primary_integrity.changed_fields.includes("untracked"));
    assert.equal(fs.existsSync(escapedTarget), true);
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
    assert.equal(step.stepResult.mission_semantics.strict_code_changing_noop_detection_applied, true);
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

test("external-runner zero repair policy preserves terminal evidence without executing internal repair", () => {
  withTempRepo((repoRoot) => {
    const policyId = "policy.step.runner.no-internal-repair";
    fs.writeFileSync(
      path.join(repoRoot, "examples/policies/step-runner-no-internal-repair.yaml"),
      [
        `policy_id: ${policyId}`,
        "step_class: runner",
        "pre_validators:",
        "  - contract-shape",
        "  - repo-scope",
        "  - approval-present",
        "  - route-resolved",
        "post_validators:",
        "  - output-schema",
        "  - evidence-complete",
        "  - validation-commands",
        "quality_gate:",
        "  required: true",
        "  suite_ref: suite.release.core@v1",
        "retry:",
        "  max_attempts: 0",
        "  on:",
        "    - provider-timeout",
        "    - rate-limit",
        "    - runner-crash",
        "repair:",
        "  max_attempts: 0",
        "  on:",
        "    - schema-mismatch",
        "    - lint-failed",
        "    - tests-failed",
        "    - missing-evidence",
        "    - no-op",
        "escalation:",
        "  after_total_failures: 4",
        "  on:",
        "    - business-ambiguity",
        "    - policy-conflict",
        "    - security-boundary",
        "blocking_rules:",
        "  - approval-missing",
        "  - frozen-route",
        "",
      ].join("\n"),
      "utf8",
    );
    configureCodexExternalRuntime(repoRoot, {
      command: process.execPath,
      args: [
        "-e",
        [
          "process.stdout.write(JSON.stringify({",
          "status:'success',",
          "summary:'external runner terminal no-op',",
          "output:{runner:'node-inline'},",
          "evidence_refs:['evidence://external-runner/no-op-terminal']",
          "}));",
        ].join(""),
      ],
    });

    const result = executeRuntimeHarnessControlledStep({
      projectRef: repoRoot,
      cwd: repoRoot,
      stepClass: "implement",
      dryRun: false,
      runId: "external-runner-no-internal-repair",
      stepId: "run.start.implement",
      approvedHandoffRef: "evidence://handoff/external-runner-no-internal-repair",
      promotionEvidenceRefs: ["evidence://promotion/external-runner-no-internal-repair"],
      executionRoot: repoRoot,
      policyOverrides: {
        implement: policyId,
      },
    });

    assert.equal(result.stepResult.status, "failed");
    assert.equal(result.stepResult.runtime_harness_decision, "block");
    assert.equal(result.stepResult.repair_status, "exhausted");
    assert.equal(result.stepResult.failure_class, "no-op");
    assert.equal(result.stepResult.repair_attempts.length, 1);
    assert.equal(result.stepResult.repair_attempts[0].policy_budget.max_attempts, 0);
    assert.equal(result.stepResult.repair_attempts[0].exhausted_budget, true);
    assert.equal(
      result.stepResult.routed_execution.policy_resolution.policy.policy_id,
      policyId,
    );

    const reportFiles = fs.readdirSync(result.runtimeLayout.reportsRoot);
    assert.equal(reportFiles.some((entry) => entry.startsWith("runtime-harness-repair-input-")), false);
    assert.equal(reportFiles.some((entry) => entry.includes(".repair.")), false);
  });
});

test("orchestrator-mediated permission auto-approval never escalates a coarse adapter to full-bypass", () => {
  withTempRepo((repoRoot) => {
    const runId = "runtime-permission-auto-approve";
    const fullBypassScript = [
      "const fs=require('node:fs');",
      "const path=require('node:path');",
      "fs.mkdirSync('src',{recursive:true});",
      "fs.writeFileSync(path.join('src','auto-approved.js'),'export const autoApproved = true;\\n');",
      "process.stdout.write(JSON.stringify({status:'success',summary:'approved retry ok',output:{runner:'full-bypass'},evidence_refs:['evidence://external-runner/auto-approved']}));",
    ].join("");
    const restrictedScript = [
      "process.stdout.write(JSON.stringify({",
      "type:'result',subtype:'success',result:'Need permission to read source.',",
      "permission_denials:[{tool_name:'Read',tool_input:{file_path:'src/index.js'}}]",
      "}));",
    ].join("");
    configureCodexExternalRuntimePermissionModes(repoRoot, {
      command: process.execPath,
      fullBypassArgs: ["-e", fullBypassScript],
      restrictedArgs: ["-e", restrictedScript],
    });

    withEnv(
      {
        AOR_RUNTIME_AGENT_PERMISSION_MODE: "restricted",
        AOR_RUNTIME_AGENT_INTERACTION_POLICY: "orchestrator-mediated",
        AOR_RUNTIME_AGENT_AUTO_APPROVAL_PROFILE: "conservative",
      },
      () => {
        const result = executeRuntimeHarnessControlledStep({
          projectRef: repoRoot,
          cwd: repoRoot,
          stepClass: "implement",
          dryRun: false,
          runId,
          stepId: "run.start.implement",
          approvedHandoffRef: "evidence://handoff/runtime-permission-auto-approve",
          promotionEvidenceRefs: ["evidence://promotion/runtime-permission-auto-approve"],
          executionRoot: repoRoot,
        });

        assert.equal(result.stepResult.runtime_harness_decision, "block");
        assert.equal(result.stepResult.status, "failed");
        assert.equal(fs.existsSync(path.join(repoRoot, "src/auto-approved.js")), false);
        assert.equal(
          fs.existsSync(path.join(result.stepResult.routed_execution.workspace_isolation.execution_root, "src/auto-approved.js")),
          false,
        );
        assert.equal(result.stepResult.routed_execution.adapter_response.output.external_runner.permission_mode, "restricted");
        assert.ok(
          result.stepResult.evidence_refs.some((ref) =>
            String(ref).includes("runtime-permission-decision-runtime-permission-auto-approve"),
          ),
        );

        const report = materializeRuntimeHarnessReport({
          projectRef: repoRoot,
          cwd: repoRoot,
          runId,
        });
        assert.equal(report.report.overall_decision, "fail");
        assert.equal(report.report.runtime_permission_summary.decision_counts.auto_approve, 1);
        assert.equal(report.report.runtime_permission_summary.continuation_strategies.includes("reinvoke"), true);
        assert.equal(report.report.runtime_permission_decisions[0].decision, "auto_approve");
        assert.equal(report.report.runtime_permission_decisions[0].operation_type, "file_read");
        assert.equal(report.report.runtime_permission_decisions[0].approval_resume_mode, "restricted");
        assert.ok(
          report.report.runtime_permission_summary.audit_refs.some((ref) =>
            String(ref).includes("runtime-permission-decision-runtime-permission-auto-approve"),
          ),
        );
      },
    );
  });
});

test("Runtime Harness report aggregates permission decisions from nested live execution run ids", () => {
  withTempRepo((repoRoot) => {
    const outerRunId = "runtime-permission-nested-live";
    const nestedRunId = `github-sandbox.run.${outerRunId}.routed-execution.v1`;
    const fullBypassScript = [
      "const fs=require('node:fs');",
      "const path=require('node:path');",
      "fs.mkdirSync('src',{recursive:true});",
      "fs.writeFileSync(path.join('src','nested-live-approved.js'),'export const nestedLiveApproved = true;\\n');",
      "process.stdout.write(JSON.stringify({status:'success',summary:'nested live retry ok',output:{runner:'full-bypass'},evidence_refs:['evidence://external-runner/nested-live-approved']}));",
    ].join("");
    const restrictedScript = [
      "process.stdout.write(JSON.stringify({",
      "type:'result',subtype:'success',result:'Need permission to read package metadata.',",
      "permission_denials:[{tool_name:'Read',tool_input:{file_path:'package.json'}}]",
      "}));",
    ].join("");
    fs.writeFileSync(path.join(repoRoot, "package.json"), "{\"name\":\"nested-live\"}\n", "utf8");
    configureCodexExternalRuntimePermissionModes(repoRoot, {
      command: process.execPath,
      fullBypassArgs: ["-e", fullBypassScript],
      restrictedArgs: ["-e", restrictedScript],
    });

    withEnv(
      {
        AOR_RUNTIME_AGENT_PERMISSION_MODE: "restricted",
        AOR_RUNTIME_AGENT_INTERACTION_POLICY: "orchestrator-mediated",
        AOR_RUNTIME_AGENT_AUTO_APPROVAL_PROFILE: "conservative",
      },
      () => {
        const step = executeRuntimeHarnessControlledStep({
          projectRef: repoRoot,
          cwd: repoRoot,
          stepClass: "implement",
          dryRun: false,
          runId: nestedRunId,
          stepId: "routed.implement",
          approvedHandoffRef: "evidence://handoff/runtime-permission-nested-live",
          promotionEvidenceRefs: ["evidence://promotion/runtime-permission-nested-live"],
          executionRoot: repoRoot,
        });

        assert.equal(step.stepResult.runtime_harness_decision, "block");
        assert.equal(fs.existsSync(path.join(repoRoot, "src/nested-live-approved.js")), false);
        assert.equal(
          fs.existsSync(path.join(step.stepResult.routed_execution.workspace_isolation.execution_root, "src/nested-live-approved.js")),
          false,
        );

        const report = materializeRuntimeHarnessReport({
          projectRef: repoRoot,
          cwd: repoRoot,
          runId: outerRunId,
        });

        assert.equal(report.report.overall_decision, "block");
        assert.equal(report.report.runtime_permission_summary.decision_counts.auto_approve, 1);
        assert.equal(report.report.runtime_permission_decisions[0].decision, "auto_approve");
        assert.equal(report.report.runtime_permission_decisions[0].operation_type, "file_read");
        assert.equal(report.report.runtime_permission_decisions[0].target, "package.json");
        assert.equal(report.report.runtime_permission_decisions[0].continuation_strategy, "reinvoke");
      },
    );
  });
});

test("expired legacy approve_for_run evidence cannot authorize a later permission request", () => {
  withTempRepo((repoRoot) => {
    const runId = "runtime-permission-approve-for-run";
    const init = initializeProjectRuntime({ cwd: repoRoot, projectRef: repoRoot });
    fs.mkdirSync(init.runtimeLayout.reportsRoot, { recursive: true });
    fs.writeFileSync(
      path.join(init.runtimeLayout.reportsRoot, "step-result-runtime-permission-grant.json"),
      `${JSON.stringify(
        {
          step_result_id: `${runId}.permission.grant`,
          run_id: runId,
          step_id: "run.start.implement",
          step_class: "runner",
          status: "failed",
          failure_class: "permission-mode-blocked",
          runtime_permission_request: {
            adapter_id: "codex-cli",
            operation_type: "file_write",
            target: "src/run-grant.js",
            tool_name: "Edit",
          },
          runtime_permission_decision: {
            decision: "user_approved",
            operator_decision: "approve_for_run",
            approval_scope: "step-coarse",
            approval_resume_mode: "full-bypass",
            expires_at: "2020-01-01T00:00:00.000Z",
            audit_ref: "evidence://reports/interaction-answer-runtime-permission-grant.json",
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const restrictedScript = [
      "process.stdout.write(JSON.stringify({",
      "type:'result',subtype:'success',result:'Need permission to edit source.',",
      "permission_denials:[{tool_name:'Edit',tool_input:{file_path:'src/run-grant.js'}}]",
      "}));",
    ].join("");
    const fullBypassScript = [
      "const fs=require('node:fs');",
      "fs.mkdirSync('src',{recursive:true});",
      "fs.writeFileSync('src/run-grant.js','export const runGrant = true;\\n');",
      "process.stdout.write(JSON.stringify({status:'success',summary:'run grant ok',output:{runner:'full-bypass'}}));",
    ].join("");
    configureCodexExternalRuntimePermissionModes(repoRoot, {
      command: process.execPath,
      fullBypassArgs: ["-e", fullBypassScript],
      restrictedArgs: ["-e", restrictedScript],
    });

    withEnv(
      {
        AOR_RUNTIME_AGENT_PERMISSION_MODE: "restricted",
        AOR_RUNTIME_AGENT_INTERACTION_POLICY: "orchestrator-mediated",
        AOR_RUNTIME_AGENT_AUTO_APPROVAL_PROFILE: "conservative",
      },
      () => {
        const result = executeRuntimeHarnessControlledStep({
          projectRef: repoRoot,
          cwd: repoRoot,
          stepClass: "implement",
          dryRun: false,
          runId,
          stepId: "run.start.implement",
          approvedHandoffRef: "evidence://handoff/runtime-permission-approve-for-run",
          promotionEvidenceRefs: ["evidence://promotion/runtime-permission-approve-for-run"],
          executionRoot: repoRoot,
        });

        assert.equal(result.stepResult.runtime_harness_decision, "block");
        assert.equal(result.stepResult.routed_execution.adapter_response.output.external_runner.permission_mode, "restricted");
        assert.equal(fs.existsSync(path.join(repoRoot, "src/run-grant.js")), false);
        assert.equal(
          fs.existsSync(path.join(result.stepResult.routed_execution.workspace_isolation.execution_root, "src/run-grant.js")),
          false,
        );
        const decisionAudits = fs
          .readdirSync(init.runtimeLayout.reportsRoot)
          .filter((entry) => entry.startsWith("runtime-permission-decision-") && entry.endsWith(".json"))
          .map((entry) => JSON.parse(fs.readFileSync(path.join(init.runtimeLayout.reportsRoot, entry), "utf8")));
        assert.equal(
          decisionAudits.some(
            (entry) =>
              entry.runtime_permission_decision?.rule_id === "runtime-permission.auto-approve.approve-for-run-grant" &&
              entry.runtime_permission_decision?.grant_ref === "evidence://reports/interaction-answer-runtime-permission-grant.json",
          ),
          false,
        );
      },
    );
  });
});

test("orchestrator-mediated permission requests ask the user or deny without repair", () => {
  withTempRepo((repoRoot) => {
    const askRunId = "runtime-permission-ask-user";
    configureCodexExternalRuntime(repoRoot, {
      command: process.execPath,
      args: [
        "-e",
        [
          "process.stdout.write(JSON.stringify({",
          "type:'result',subtype:'success',result:'Need permission to edit source.',",
          "permission_denials:[{tool_name:'Edit',tool_input:{file_path:'src/index.js'}}]",
          "}));",
        ].join(""),
      ],
    });

    withEnv(
      {
        AOR_RUNTIME_AGENT_INTERACTION_POLICY: "orchestrator-mediated",
        AOR_RUNTIME_AGENT_AUTO_APPROVAL_PROFILE: "conservative",
      },
      () => {
        const askResult = executeRoutedStep({
          projectRef: repoRoot,
          cwd: repoRoot,
          stepClass: "implement",
          dryRun: false,
          runId: askRunId,
          stepId: "run.start.implement",
          approvedHandoffRef: "evidence://handoff/runtime-permission-ask-user",
          promotionEvidenceRefs: ["evidence://promotion/runtime-permission-ask-user"],
          executionRoot: repoRoot,
        });

        assert.equal(askResult.stepResult.runtime_harness_decision, "block");
        assert.equal(askResult.stepResult.runtime_permission_decision.decision, "ask_user");
        assert.equal(askResult.stepResult.requested_interaction.interaction_type, "permission_request");
        assert.equal(askResult.stepResult.requested_interaction.runtime_permission_request.operation_type, "file_write");
      },
    );
  });

  withTempRepo((repoRoot) => {
    configureCodexExternalRuntime(repoRoot, {
      command: process.execPath,
      args: [
        "-e",
        [
          "process.stdout.write(JSON.stringify({",
          "type:'result',subtype:'success',result:'Need permission to read a system file.',",
          "permission_denials:[{tool_name:'Read',tool_input:{file_path:'/etc/passwd'}}]",
          "}));",
        ].join(""),
      ],
    });

    withEnv(
      {
        AOR_RUNTIME_AGENT_INTERACTION_POLICY: "orchestrator-mediated",
        AOR_RUNTIME_AGENT_AUTO_APPROVAL_PROFILE: "trusted-run",
      },
      () => {
        const denied = executeRoutedStep({
          projectRef: repoRoot,
          cwd: repoRoot,
          stepClass: "implement",
          dryRun: false,
          runId: "runtime-permission-auto-deny",
          stepId: "run.start.implement",
          approvedHandoffRef: "evidence://handoff/runtime-permission-auto-deny",
          promotionEvidenceRefs: ["evidence://promotion/runtime-permission-auto-deny"],
          executionRoot: repoRoot,
        });

        assert.equal(denied.stepResult.runtime_harness_decision, "block");
        assert.equal(denied.stepResult.runtime_permission_decision.decision, "auto_deny");
        assert.equal(denied.stepResult.requested_interaction, null);
        assert.deepEqual(denied.stepResult.repair_attempts[0].policy_action, "none");
      },
    );
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
    assert.equal(fs.existsSync(path.join(repoRoot, "src/repaired.js")), false);
    assert.equal(
      fs.existsSync(path.join(result.stepResult.routed_execution.workspace_isolation.execution_root, "src/repaired.js")),
      true,
    );
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
      repairStepResult.routed_execution.adapter_request.context.runtime_evidence_refs.some((ref) =>
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
          goals: ["Refresh docs-only proof content."],
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
    assert.equal(result.stepResult.mission_semantics.strict_code_changing_noop_detection_applied, false);
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

test("Runtime Harness no-op detection ignores mission input files and tracks meaningful changes", () => {
  withTempRepo((repoRoot) => {
    const init = initializeProjectRuntime({ projectRef: repoRoot, cwd: repoRoot });
    const requestFile = path.join(repoRoot, "feature-request.json");
    fs.writeFileSync(
      requestFile,
      `${JSON.stringify({ goals: ["Implement the requested feature change."] }, null, 2)}\n`,
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
    assert.deepEqual(step.stepResult.mission_semantics.meaningful_changed_paths, []);

    const report = materializeRuntimeHarnessReport({
      projectRef: repoRoot,
      cwd: repoRoot,
      runId: "runtime-harness-input-only-noop",
    });

    assert.equal(report.report.overall_decision, "repair");
    assert.deepEqual(report.report.step_decisions[0].mission_semantics.ignored_input_files, ["feature-request.json"]);
    assert.deepEqual(report.report.step_decisions[0].mission_semantics.meaningful_changed_paths, []);
  });
});

test("Runtime Harness ignores backup artifacts as real code-changing evidence", () => {
  withTempRepo((repoRoot) => {
    const init = initializeProjectRuntime({ projectRef: repoRoot, cwd: repoRoot });
    const requestFile = path.join(repoRoot, "feature-request.json");
    fs.writeFileSync(requestFile, `${JSON.stringify({ goals: ["Implement the requested feature change."] }, null, 2)}\n`, "utf8");
    materializeIntakeArtifactPacket({
      projectId: init.projectId,
      projectRoot: init.projectRoot,
      projectProfileRef: init.projectProfileRef,
      runtimeLayout: init.runtimeLayout,
      command: "aor intake create",
      missionId: "backup-only",
      requestFile,
    });
    configureCodexExternalRuntime(repoRoot, {
      command: process.execPath,
      args: [
        "-e",
        [
          "const fs=require('node:fs');",
          "const path=require('node:path');",
          "const input=JSON.parse(fs.readFileSync(0,'utf8'));",
          "const request=input.request||{};",
          "fs.mkdirSync('src',{recursive:true});",
          "fs.writeFileSync(path.join('src','index.js.bak'),'backup only\\n');",
          "process.stdout.write(JSON.stringify({",
          "status:'success',",
          "summary:'external runner wrote backup artifact only',",
          "output:{runner:'node-inline',step_class:request.step_class||null,cwd:process.cwd()},",
          "evidence_refs:['evidence://external-runner/backup-only'],",
          "tool_traces:[{phase:'invoke_adapter',kind:'external-runner-mock',detail:'node-inline-backup-only'}]",
          "}));",
        ].join(""),
      ],
    });

    const step = executeRoutedStep({
      projectRef: repoRoot,
      cwd: repoRoot,
      stepClass: "implement",
      dryRun: false,
      runId: "runtime-harness-backup-only",
      stepId: "run.start.implement",
      approvedHandoffRef: "evidence://handoff/approved-backup-only",
      promotionEvidenceRefs: ["evidence://promotion/pass-backup-only"],
      executionRoot: repoRoot,
    });

    assert.equal(step.stepResult.failure_class, "no-op");
    assert.deepEqual(step.stepResult.mission_semantics.meaningful_changed_paths, []);
    assert.ok(step.stepResult.mission_semantics.non_bootstrap_changed_paths.includes("src/index.js.bak"));

    const report = materializeRuntimeHarnessReport({
      projectRef: repoRoot,
      cwd: repoRoot,
      runId: "runtime-harness-backup-only",
    });

    assert.equal(report.report.overall_decision, "repair");
    assert.deepEqual(report.report.step_decisions[0].mission_semantics.meaningful_changed_paths, []);
  });
});

test("Runtime Harness does not fail strict runs by path alone", () => {
  withTempRepo((repoRoot) => {
    const init = initializeProjectRuntime({ projectRef: repoRoot, cwd: repoRoot });
    const requestFile = path.join(repoRoot, "feature-request.json");
    fs.writeFileSync(requestFile, `${JSON.stringify({ goals: ["Implement the requested feature change."] }, null, 2)}\n`, "utf8");
    materializeIntakeArtifactPacket({
      projectId: init.projectId,
      projectRoot: init.projectRoot,
      projectProfileRef: init.projectProfileRef,
      runtimeLayout: init.runtimeLayout,
      command: "aor intake create",
      missionId: "path-only-quality",
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
          "summary:'external runner wrote a docs file',",
          "output:{runner:'node-inline',step_class:request.step_class||null,cwd:process.cwd()},",
          "evidence_refs:['evidence://external-runner/path-only-quality'],",
          "tool_traces:[{phase:'invoke_adapter',kind:'external-runner-mock',detail:'node-inline-path-only-quality'}]",
          "}));",
        ].join(""),
      ],
    });

    const step = executeRoutedStep({
      projectRef: repoRoot,
      cwd: repoRoot,
      stepClass: "implement",
      dryRun: false,
      runId: "runtime-harness-path-only-quality",
      stepId: "run.start.implement",
      approvedHandoffRef: "evidence://handoff/approved-path-only-quality",
      promotionEvidenceRefs: ["evidence://promotion/pass-path-only-quality"],
      executionRoot: repoRoot,
    });

    assert.equal(step.stepResult.failure_class, "none");
    assert.equal(step.stepResult.runtime_harness_decision, "pass");
    assert.deepEqual(step.stepResult.mission_semantics.meaningful_changed_paths, ["docs/out-of-scope.md"]);
    assert.equal(step.stepResult.mission_semantics.strict_code_changing_noop_detection_applied, true);
    assert.equal(step.stepResult.mission_semantics.strict_code_changing_noop, false);

    const report = materializeRuntimeHarnessReport({
      projectRef: repoRoot,
      cwd: repoRoot,
      runId: "runtime-harness-path-only-quality",
    });

    assert.equal(report.report.overall_decision, "pass");
    assert.equal(report.report.step_decisions[0].failure_class, "none");
  });
});

test("Runtime Harness blocks runner-owned state leaks in live runner output", () => {
  withTempRepo((repoRoot) => {
    configureCodexExternalRuntime(repoRoot, {
      command: process.execPath,
      args: [
        "-e",
        [
          "const fs=require('node:fs');",
          "const path=require('node:path');",
          "fs.mkdirSync('src',{recursive:true});",
          "fs.mkdirSync(path.join('.qwen','skills','aor-implement-regression-fix'),{recursive:true});",
          "fs.writeFileSync(path.join('src','index.js'),'export const fixed = true;\\n');",
          "fs.writeFileSync(path.join('.qwen','skills','aor-implement-regression-fix','SKILL.md'),'runner-local skill state\\n');",
          "process.stdout.write(JSON.stringify({",
          "status:'success',",
          "summary:'external runner wrote code and runner-local skill state',",
          "output:{runner:'node-inline'},",
          "evidence_refs:['evidence://external-runner/runner-state-leak'],",
          "tool_traces:[{phase:'invoke_adapter',kind:'external-runner-mock',detail:'node-inline-runner-state-leak'}]",
          "}));",
        ].join(""),
      ],
    });

    const step = executeRoutedStep({
      projectRef: repoRoot,
      cwd: repoRoot,
      stepClass: "implement",
      dryRun: false,
      runId: "runtime-harness-runner-state-leak",
      stepId: "run.start.implement",
      approvedHandoffRef: "evidence://handoff/approved-runner-state-leak",
      promotionEvidenceRefs: ["evidence://promotion/pass-runner-state-leak"],
      executionRoot: repoRoot,
    });

    assert.equal(step.stepResult.failure_class, "runner-owned-state-leak");
    assert.equal(step.stepResult.runtime_harness_decision, "block");
    assert.equal(step.stepResult.mission_outcome, "not_satisfied");
    assert.deepEqual(step.stepResult.mission_semantics.runner_owned_state_paths, [
      ".qwen/skills/aor-implement-regression-fix/SKILL.md",
    ]);
    assert.deepEqual(step.stepResult.mission_semantics.runner_owned_state_paths_during_step, [
      ".qwen/skills/aor-implement-regression-fix/SKILL.md",
    ]);

    const report = materializeRuntimeHarnessReport({
      projectRef: repoRoot,
      cwd: repoRoot,
      runId: "runtime-harness-runner-state-leak",
    });

    assert.equal(report.report.overall_decision, "fail");
    assert.equal(report.report.step_decisions[0].failure_class, "runner-owned-state-leak");
    assert.equal(report.report.step_decisions[0].runtime_harness_decision, "block");
    assert.deepEqual(report.report.step_decisions[0].mission_semantics.runner_owned_state_paths, [
      ".qwen/skills/aor-implement-regression-fix/SKILL.md",
    ]);
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

    configureOpenCodeExternalRuntime(repoRoot, {
      command: "__aor_missing_opencode_runner_command__",
    });

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
    assert.match(misconfigured.stepResult.summary, /external runner command .* is not available on PATH/i);
    assert.equal(misconfigured.stepResult.routed_execution.adapter_response.status, "blocked");
    assert.equal(
      misconfigured.stepResult.routed_execution.adapter_response.output.failure_kind,
      "missing-command",
    );
    assert.match(
      String(misconfigured.stepResult.routed_execution.blocked_next_step),
      /Install\/configure external runner prerequisites|routed-dry-run-step/i,
    );
  });
});
