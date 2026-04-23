import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  parse as parseYaml,
  stringify as stringifyYaml,
} from "../../packages/contracts/node_modules/yaml/dist/index.js";

const currentFilePath = fileURLToPath(import.meta.url);
const workspaceRoot = path.resolve(path.dirname(currentFilePath), "../..");
const harnessScriptPath = path.join(workspaceRoot, "scripts/live-e2e/run-profile.mjs");

/**
 * @param {(tempRoot: string) => void} callback
 */
function withTempRoot(callback) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-live-e2e-harness-"));
  try {
    callback(tempRoot);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

/**
 * @param {{ cwd: string, args: string[] }} options
 */
function runGitChecked(options) {
  const run = spawnSync("git", options.args, { cwd: options.cwd, encoding: "utf8" });
  assert.equal(
    run.status,
    0,
    `git ${options.args.join(" ")} failed: ${(run.stderr ?? run.stdout ?? "").trim()}`,
  );
}

/**
 * @param {{
 *   hostTempRoot: string,
 *   branch?: string,
 * }} options
 */
function createLocalTargetRepository(options) {
  const branch = options.branch ?? "main";
  const targetRepoRoot = path.join(options.hostTempRoot, "target-repo");
  fs.mkdirSync(targetRepoRoot, { recursive: true });
  fs.writeFileSync(
    path.join(targetRepoRoot, "README.md"),
    "# Local target repository for installed-user rehearsal tests\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(targetRepoRoot, "package.json"),
    `${JSON.stringify(
      {
        name: "local-installed-user-target",
        private: true,
        version: "0.0.0",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  runGitChecked({ cwd: targetRepoRoot, args: ["init", "-b", branch] });
  runGitChecked({ cwd: targetRepoRoot, args: ["config", "user.email", "target@example.com"] });
  runGitChecked({ cwd: targetRepoRoot, args: ["config", "user.name", "Target Test"] });
  runGitChecked({ cwd: targetRepoRoot, args: ["add", "-A"] });
  runGitChecked({ cwd: targetRepoRoot, args: ["commit", "-m", "target init"] });

  return {
    targetRepoRoot,
    targetRef: branch,
  };
}

/**
 * @param {{
 *   tempRoot: string,
 * }} options
 */
function createExamplesRoot(options) {
  const examplesRoot = path.join(options.tempRoot, "examples-root");
  fs.cpSync(path.join(workspaceRoot, "examples"), examplesRoot, { recursive: true });
  return examplesRoot;
}

/**
 * @param {{
 *   examplesRoot: string,
 *   command: string,
 *   args: string[],
 * }} options
 */
function configureCodexExternalRuntime(options) {
  const adapterPath = path.join(options.examplesRoot, "adapters/codex-cli.yaml");
  const source = fs.readFileSync(adapterPath, "utf8");
  const executionBlock = [
    "execution:",
    "  live_baseline: true",
    "  runtime_mode: external-process",
    "  handler: codex-cli-external-runner",
    "  evidence_namespace: evidence://adapter-live/codex-cli",
    "  external_runtime:",
    `    command: ${JSON.stringify(options.command)}`,
    "    args:",
    ...options.args.map((argument) => `      - ${JSON.stringify(argument)}`),
    "    request_via_stdin: true",
    "    timeout_ms: 30000",
  ].join("\n");
  const updated = source.replace(/execution:\n[\s\S]*?\nsandbox_mode:/u, `${executionBlock}\nsandbox_mode:`);
  fs.writeFileSync(adapterPath, updated, "utf8");
}

/**
 * @param {{ examplesRoot: string }} options
 */
function configureCodexExternalRuntimeSuccess(options) {
  configureCodexExternalRuntime({
    examplesRoot: options.examplesRoot,
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
        "output:{runner:'node-inline',step_class:request.step_class||null,execution_root:process.cwd()},",
        "evidence_refs:['evidence://external-runner/live-e2e-harness-success'],",
        "tool_traces:[{phase:'invoke_adapter',kind:'external-runner-mock',detail:'node-inline'}]",
        "}));",
      ].join(""),
    ],
  });
}

/**
 * @param {{
 *   templateProfilePath: string,
 *   outputProfilePath: string,
 *   targetRepoRoot: string,
 *   targetRef: string,
 *   setupCommands?: string[],
 *   verifyCommands?: string[],
 *   liveExecution?: Record<string, unknown>,
 * }} options
 */
function writeLocalHarnessProfile(options) {
  const profile = /** @type {Record<string, unknown>} */ (
    parseYaml(fs.readFileSync(options.templateProfilePath, "utf8"))
  );
  const targetRepo = /** @type {Record<string, unknown>} */ (profile.target_repo ?? {});
  targetRepo.repo_url = options.targetRepoRoot;
  targetRepo.ref = options.targetRef;
  targetRepo.checkout_strategy = "full";
  profile.target_repo = targetRepo;

  const verification = /** @type {Record<string, unknown>} */ (profile.verification ?? {});
  verification.setup_commands =
    options.setupCommands ?? ['node -e "process.stdout.write(\'setup ok\\n\')"'];
  verification.commands =
    options.verifyCommands ?? ['node -e "process.stdout.write(\'verify ok\\n\')"'];
  profile.verification = verification;

  if (options.liveExecution) {
    profile.live_execution = options.liveExecution;
  }

  fs.writeFileSync(options.outputProfilePath, stringifyYaml(profile), "utf8");
}

/**
 * @param {{
 *   runtimeRoot: string,
 *   examplesRoot: string,
 *   profilePath: string,
 *   runId: string,
 * }} options
 */
function runHarness(options) {
  const run = spawnSync(
    process.execPath,
    [
      harnessScriptPath,
      "--project-ref",
      workspaceRoot,
      "--runtime-root",
      options.runtimeRoot,
      "--examples-root",
      options.examplesRoot,
      "--profile",
      options.profilePath,
      "--run-id",
      options.runId,
    ],
    {
      cwd: workspaceRoot,
      encoding: "utf8",
    },
  );
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
}

test("internal harness runs a valid short profile through public CLI subprocesses", () => {
  withTempRoot((tempRoot) => {
    const targetRepo = createLocalTargetRepository({ hostTempRoot: tempRoot });
    const examplesRoot = createExamplesRoot({ tempRoot });
    configureCodexExternalRuntimeSuccess({ examplesRoot });
    const profilePath = path.join(tempRoot, "regress-short.local.yaml");
    writeLocalHarnessProfile({
      templateProfilePath: path.join(workspaceRoot, "scripts/live-e2e/profiles/regress-short.yaml"),
      outputProfilePath: profilePath,
      targetRepoRoot: targetRepo.targetRepoRoot,
      targetRef: targetRepo.targetRef,
    });

    const result = runHarness({
      runtimeRoot: path.join(tempRoot, "runtime"),
      examplesRoot,
      profilePath,
      runId: "installed-user-valid",
    });
    assert.equal(result.live_e2e_run_status, "pass");
    assert.equal(fs.existsSync(result.live_e2e_run_summary_file), true);

    const summary = JSON.parse(fs.readFileSync(result.live_e2e_run_summary_file, "utf8"));
    assert.equal(summary.status, "pass");
    assert.equal(fs.existsSync(summary.target_checkout_root), true);
    assert.equal(fs.existsSync(summary.generated_project_profile_file), true);
    assert.equal(fs.existsSync(summary.routed_step_result_file), true);
    assert.equal(fs.existsSync(summary.learning_loop_scorecard_file), true);
    assert.equal(summary.control_surfaces.internal_harness.includes("scripts/live-e2e/run-profile.mjs"), true);
    assert.equal(summary.control_surfaces.public_cli_sequence.includes("aor project analyze"), true);
    assert.equal(summary.control_surfaces.public_cli_sequence.includes("aor release prepare"), false);
    assert.equal(summary.control_surfaces.examples_root, examplesRoot);
    const learningLoopHandoff = JSON.parse(fs.readFileSync(summary.learning_loop_handoff_file, "utf8"));
    assert.deepEqual(learningLoopHandoff.backlog_refs, [
      "docs/backlog/mvp-implementation-backlog.md",
      "docs/backlog/mvp-roadmap.md",
      "docs/ops/live-e2e-standard-runner.md",
    ]);
    const routedStepResult = JSON.parse(fs.readFileSync(summary.routed_step_result_file, "utf8"));
    assert.equal(routedStepResult.status, "passed");
    assert.equal(routedStepResult.routed_execution.adapter_response.status, "success");
  });
});

test("internal harness records a failed run when target ref cannot be resolved", () => {
  withTempRoot((tempRoot) => {
    const targetRepo = createLocalTargetRepository({ hostTempRoot: tempRoot, branch: "main" });
    const examplesRoot = createExamplesRoot({ tempRoot });
    configureCodexExternalRuntimeSuccess({ examplesRoot });
    const profilePath = path.join(tempRoot, "regress-short.invalid-ref.yaml");
    writeLocalHarnessProfile({
      templateProfilePath: path.join(workspaceRoot, "scripts/live-e2e/profiles/regress-short.yaml"),
      outputProfilePath: profilePath,
      targetRepoRoot: targetRepo.targetRepoRoot,
      targetRef: "missing-ref",
    });

    const result = runHarness({
      runtimeRoot: path.join(tempRoot, "runtime"),
      examplesRoot,
      profilePath,
      runId: "installed-user-invalid-ref",
    });
    assert.equal(result.live_e2e_run_status, "fail");
    const summary = JSON.parse(fs.readFileSync(result.live_e2e_run_summary_file, "utf8"));
    assert.equal(summary.status, "fail");
    assert.match(String(summary.error), /target checkout clone failed|Remote branch missing-ref not found/u);
  });
});

test("internal harness surfaces missing external runner prerequisites", () => {
  withTempRoot((tempRoot) => {
    const targetRepo = createLocalTargetRepository({ hostTempRoot: tempRoot });
    const examplesRoot = createExamplesRoot({ tempRoot });
    configureCodexExternalRuntime({
      examplesRoot,
      command: "__aor_missing_runner_command__",
      args: [],
    });
    const profilePath = path.join(tempRoot, "regress-short.missing-runner.yaml");
    writeLocalHarnessProfile({
      templateProfilePath: path.join(workspaceRoot, "scripts/live-e2e/profiles/regress-short.yaml"),
      outputProfilePath: profilePath,
      targetRepoRoot: targetRepo.targetRepoRoot,
      targetRef: targetRepo.targetRef,
    });

    const result = runHarness({
      runtimeRoot: path.join(tempRoot, "runtime"),
      examplesRoot,
      profilePath,
      runId: "installed-user-missing-runner",
    });
    assert.equal(result.live_e2e_run_status, "fail");
    const summary = JSON.parse(fs.readFileSync(result.live_e2e_run_summary_file, "utf8"));
    assert.equal(summary.status, "fail");
    assert.equal(fs.existsSync(summary.artifacts.routed_step_result_file), true);

    const routedStepResult = JSON.parse(fs.readFileSync(summary.artifacts.routed_step_result_file, "utf8"));
    assert.equal(routedStepResult.status, "failed");
    assert.equal(routedStepResult.routed_execution.adapter_response.status, "blocked");
    assert.equal(routedStepResult.routed_execution.adapter_response.output.failure_kind, "missing-prerequisite");
  });
});

test("internal harness records a policy-blocked live execution when approvals and promotion evidence are withheld", () => {
  withTempRoot((tempRoot) => {
    const targetRepo = createLocalTargetRepository({ hostTempRoot: tempRoot });
    const examplesRoot = createExamplesRoot({ tempRoot });
    configureCodexExternalRuntimeSuccess({ examplesRoot });
    const profilePath = path.join(tempRoot, "regress-short.policy-blocked.yaml");
    writeLocalHarnessProfile({
      templateProfilePath: path.join(workspaceRoot, "scripts/live-e2e/profiles/regress-short.yaml"),
      outputProfilePath: profilePath,
      targetRepoRoot: targetRepo.targetRepoRoot,
      targetRef: targetRepo.targetRef,
      liveExecution: {
        include_approved_handoff: false,
        include_promotion_evidence: false,
      },
    });

    const result = runHarness({
      runtimeRoot: path.join(tempRoot, "runtime"),
      examplesRoot,
      profilePath,
      runId: "installed-user-policy-blocked",
    });
    assert.equal(result.live_e2e_run_status, "fail");
    const summary = JSON.parse(fs.readFileSync(result.live_e2e_run_summary_file, "utf8"));
    assert.equal(summary.status, "fail");
    assert.equal(fs.existsSync(summary.artifacts.routed_step_result_file), true);

    const routedStepResult = JSON.parse(fs.readFileSync(summary.artifacts.routed_step_result_file, "utf8"));
    assert.equal(routedStepResult.status, "failed");
    assert.equal(routedStepResult.routed_execution.adapter_response.status, "blocked");
    assert.ok(
      routedStepResult.routed_execution.adapter_response.output.blocking_reasons.includes("approved-handoff-required"),
    );
    assert.ok(
      routedStepResult.routed_execution.adapter_response.output.blocking_reasons.includes("promotion-evidence-required"),
    );
  });
});
