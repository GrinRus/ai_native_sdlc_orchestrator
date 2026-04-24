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
        scripts: {
          build: 'node -e "process.stdout.write(\'build ok\\n\')"',
          lint: 'node -e "process.stdout.write(\'lint ok\\n\')"',
          test: 'node -e "process.stdout.write(\'test ok\\n\')"',
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  fs.mkdirSync(path.join(targetRepoRoot, "src"), { recursive: true });
  fs.writeFileSync(path.join(targetRepoRoot, "src/index.js"), "export const localTarget = true;\n", "utf8");
  fs.mkdirSync(path.join(targetRepoRoot, "test"), { recursive: true });
  fs.writeFileSync(path.join(targetRepoRoot, "test/local.test.js"), "console.log('local test fixture');\n", "utf8");
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
 * @param {{ tempRoot: string }} options
 */
function createFakeCodexBinary(options) {
  const binRoot = path.join(options.tempRoot, "fake-bin");
  fs.mkdirSync(binRoot, { recursive: true });
  const codexPath = path.join(binRoot, "codex");
  fs.writeFileSync(
    codexPath,
    [
      "#!/usr/bin/env node",
      "const fs = require('node:fs');",
      "const input = JSON.parse(fs.readFileSync(0, 'utf8'));",
      "const request = input.request || {};",
      "process.stdout.write(JSON.stringify({",
      "  status: 'success',",
      "  summary: 'fake codex ok',",
      "  output: { runner: 'fake-codex', step_class: request.step_class || null, execution_root: process.cwd() },",
      "  evidence_refs: ['evidence://external-runner/live-e2e-harness-fake-codex'],",
      "  tool_traces: [{ phase: 'invoke_adapter', kind: 'fake-codex', detail: 'path-override' }],",
      "}));",
      "",
    ].join("\n"),
    "utf8",
  );
  fs.chmodSync(codexPath, 0o755);
  return {
    binRoot,
    codexPath,
  };
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
 * @param {{ examplesRoot: string }} options
 */
function configureCodexExternalRuntimeForbiddenWrite(options) {
  configureCodexExternalRuntime({
    examplesRoot: options.examplesRoot,
    command: process.execPath,
    args: [
      "-e",
      [
        "const fs=require('node:fs');",
        "fs.mkdirSync('docs',{recursive:true});",
        "fs.writeFileSync('docs/control-plane-leak.md','# leaked from target run\\n');",
        "const input=JSON.parse(fs.readFileSync(0,'utf8'));",
        "const request=input.request||{};",
        "process.stdout.write(JSON.stringify({",
        "status:'success',",
        "summary:'external runner wrote forbidden docs path',",
        "output:{runner:'node-inline',step_class:request.step_class||null,execution_root:process.cwd()},",
        "evidence_refs:['evidence://external-runner/live-e2e-harness-forbidden-write'],",
        "tool_traces:[{phase:'invoke_adapter',kind:'external-runner-mock',detail:'forbidden-write'}]",
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
 *   catalogRoot: string,
 *   catalogId: string,
 *   repoUrl: string,
 *   ref: string,
 *   missionId: string,
 * }} options
 */
function writeLocalCatalogTarget(options) {
  const targetRoot = path.join(options.catalogRoot, "targets");
  fs.mkdirSync(targetRoot, { recursive: true });
  fs.writeFileSync(
    path.join(targetRoot, `${options.catalogId}.yaml`),
    stringifyYaml({
      catalog_id: options.catalogId,
      repo: {
        repo_id: options.catalogId,
        repo_url: options.repoUrl,
        ref: options.ref,
        checkout_strategy: "full",
      },
      verification: {
        setup_commands: ['node -e "process.stdout.write(\'setup ok\\n\')"'],
        commands: ['node -e "process.stdout.write(\'verify ok\\n\')"'],
      },
      safety_defaults: {
        write_back_to_remote: false,
        preferred_delivery_mode: "patch",
      },
      feature_missions: [
        {
          mission_id: options.missionId,
          title: "Local full-journey mission",
          brief: "Use one bounded local mission for harness coverage.",
          allowed_paths: ["src/**", "test/**", "package.json"],
          forbidden_paths: ["docs/**", ".github/**", "scripts/**", "examples/**", "context/**"],
          expected_evidence: ["review-report", "learning-loop-handoff"],
          acceptance_checks: ["keep changes inside src and test only"],
          change_budget: {
            max_changed_files: 4,
            max_added_lines: 120,
          },
        },
      ],
    }),
    "utf8",
  );
}

/**
 * @param {{
 *   outputProfilePath: string,
 *   catalogId: string,
 *   missionId: string,
 *   internalTestHooks?: Record<string, unknown>,
 *   outputPolicy?: Record<string, unknown>,
 * }} options
 */
function writeLocalFullJourneyProfile(options) {
  fs.writeFileSync(
    options.outputProfilePath,
    stringifyYaml({
      profile_id: "live-e2e.full-journey.local",
      version: 1,
      journey_mode: "full-journey",
      flow_kind: "regress",
      duration_class: "short",
      target_catalog_id: options.catalogId,
      feature_mission_id: options.missionId,
      bootstrap_template: "github-default",
      runtime: {
        mode: "ephemeral",
        runtime_root: ".aor",
      },
      stages: ["bootstrap", "discovery", "spec", "planning", "handoff", "execution", "review", "qa", "delivery", "learning"],
      verification: {
        eval_suites: ["suite.regress.short@v1"],
        harness: {
          enabled: false,
        },
      },
      output_policy: {
        materialize_release_packet: false,
        write_back_to_remote: false,
        preferred_delivery_mode: "patch",
        ...(options.outputPolicy ?? {}),
      },
      ...(options.internalTestHooks ? { internal_test_hooks: options.internalTestHooks } : {}),
    }),
    "utf8",
  );
}

/**
 * @param {{
 *   runtimeRoot: string,
 *   examplesRoot?: string,
 *   profilePath: string,
 *   runId: string,
 *   catalogRoot?: string,
 *   omitExamplesRoot?: boolean,
 *   extraEnv?: NodeJS.ProcessEnv,
 * }} options
 */
function runHarness(options) {
  const args = [
    harnessScriptPath,
    "--project-ref",
    workspaceRoot,
    "--runtime-root",
    options.runtimeRoot,
    "--profile",
    options.profilePath,
    "--run-id",
    options.runId,
  ];
  if (!options.omitExamplesRoot) {
    assert.ok(options.examplesRoot, "examplesRoot is required unless omitExamplesRoot=true");
    args.push("--examples-root", options.examplesRoot);
  }
  if (options.catalogRoot) {
    args.push("--catalog-root", options.catalogRoot);
  }
  const run = spawnSync(process.execPath, args, {
    cwd: workspaceRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      ...(options.extraEnv ?? {}),
    },
  });
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

test("internal harness runs a catalog-backed full-journey profile without harness-side asset injection", () => {
  withTempRoot((tempRoot) => {
    const targetRepo = createLocalTargetRepository({ hostTempRoot: tempRoot });
    const examplesRoot = createExamplesRoot({ tempRoot });
    configureCodexExternalRuntimeSuccess({ examplesRoot });
    const catalogRoot = path.join(tempRoot, "catalog");
    writeLocalCatalogTarget({
      catalogRoot,
      catalogId: "local-target",
      repoUrl: targetRepo.targetRepoRoot,
      ref: targetRepo.targetRef,
      missionId: "local-mission",
    });
    const profilePath = path.join(tempRoot, "full-journey.local.yaml");
    writeLocalFullJourneyProfile({
      outputProfilePath: profilePath,
      catalogId: "local-target",
      missionId: "local-mission",
    });

    const result = runHarness({
      runtimeRoot: path.join(tempRoot, "runtime"),
      examplesRoot,
      profilePath,
      runId: "full-journey-local",
      catalogRoot,
    });
    assert.equal(result.live_e2e_run_status, "pass");
    const summary = JSON.parse(fs.readFileSync(result.live_e2e_run_summary_file, "utf8"));
    assert.equal(summary.status, "pass");
    assert.equal(summary.control_surfaces.public_cli_sequence.includes("aor project init"), true);
    assert.equal(summary.control_surfaces.public_cli_sequence.includes("aor intake create"), true);
    assert.equal(summary.control_surfaces.public_cli_sequence.includes("aor discovery run"), true);
    assert.equal(summary.control_surfaces.public_cli_sequence.includes("aor run start"), true);
    assert.equal(summary.control_surfaces.public_cli_sequence.includes("aor review run"), true);
    assert.equal(summary.control_surfaces.public_cli_sequence.includes("aor learning handoff"), true);
    assert.deepEqual(
      summary.command_results.map((entry) => entry.label),
      [
        "project-init",
        "intake-create",
        "project-analyze",
        "project-validate",
        "project-verify-preflight",
        "discovery-run",
        "spec-build",
        "wave-create",
        "handoff-approve",
        "project-validate-approved-handoff",
        "run-start",
        "run-status",
        "review-run",
        "eval-run",
        "deliver-prepare",
        "audit-runs",
        "learning-handoff",
      ],
    );
    assert.equal(fs.existsSync(path.join(summary.target_checkout_root, ".aor-live-e2e")), false);
    assert.equal(typeof summary.verdict_matrix, "object");
    assert.equal(summary.verdict_matrix.target_selection, "pass");
    assert.equal(summary.verdict_matrix.feature_request_quality, "pass");
    assert.equal(summary.verdict_matrix.overall_verdict, "pass_with_findings");
    assert.equal(fs.existsSync(summary.artifacts.feature_request_file), true);
    assert.equal(fs.existsSync(summary.learning_loop_handoff_file), true);
  });
});

test("full-journey mode defaults to packaged bootstrap assets when --examples-root is omitted", () => {
  withTempRoot((tempRoot) => {
    const targetRepo = createLocalTargetRepository({ hostTempRoot: tempRoot });
    const fakeCodex = createFakeCodexBinary({ tempRoot });
    const catalogRoot = path.join(tempRoot, "catalog");
    writeLocalCatalogTarget({
      catalogRoot,
      catalogId: "local-target",
      repoUrl: targetRepo.targetRepoRoot,
      ref: targetRepo.targetRef,
      missionId: "local-mission",
    });
    const profilePath = path.join(tempRoot, "full-journey.default-packaged-assets.yaml");
    writeLocalFullJourneyProfile({
      outputProfilePath: profilePath,
      catalogId: "local-target",
      missionId: "local-mission",
    });

    const result = runHarness({
      runtimeRoot: path.join(tempRoot, "runtime"),
      profilePath,
      runId: "full-journey-default-packaged-assets",
      catalogRoot,
      omitExamplesRoot: true,
      extraEnv: {
        PATH: `${fakeCodex.binRoot}${path.delimiter}${process.env.PATH ?? ""}`,
      },
    });
    assert.equal(result.live_e2e_run_status, "pass");
    const summary = JSON.parse(fs.readFileSync(result.live_e2e_run_summary_file, "utf8"));
    assert.equal(summary.status, "pass");
    assert.equal(summary.control_surfaces.examples_root, null);
    assert.equal(fs.existsSync(summary.generated_project_profile_file), true);
    assert.equal(fs.existsSync(summary.artifacts.target_examples_root), true);
  });
});

test("full-journey mode rejects unknown catalog targets", () => {
  withTempRoot((tempRoot) => {
    const examplesRoot = createExamplesRoot({ tempRoot });
    configureCodexExternalRuntimeSuccess({ examplesRoot });
    const catalogRoot = path.join(tempRoot, "catalog");
    fs.mkdirSync(path.join(catalogRoot, "targets"), { recursive: true });
    const profilePath = path.join(tempRoot, "full-journey.unknown-target.yaml");
    writeLocalFullJourneyProfile({
      outputProfilePath: profilePath,
      catalogId: "missing-target",
      missionId: "local-mission",
    });

    const run = spawnSync(
      process.execPath,
      [
        harnessScriptPath,
        "--project-ref",
        workspaceRoot,
        "--runtime-root",
        path.join(tempRoot, "runtime"),
        "--examples-root",
        examplesRoot,
        "--profile",
        profilePath,
        "--run-id",
        "full-journey-missing-target",
        "--catalog-root",
        catalogRoot,
      ],
      { cwd: workspaceRoot, encoding: "utf8" },
    );
    assert.equal(run.status, 1);
    assert.match(run.stderr, /Target catalog 'missing-target' was not found/u);
  });
});

test("full-journey mode rejects unknown feature missions", () => {
  withTempRoot((tempRoot) => {
    const targetRepo = createLocalTargetRepository({ hostTempRoot: tempRoot });
    const examplesRoot = createExamplesRoot({ tempRoot });
    configureCodexExternalRuntimeSuccess({ examplesRoot });
    const catalogRoot = path.join(tempRoot, "catalog");
    writeLocalCatalogTarget({
      catalogRoot,
      catalogId: "local-target",
      repoUrl: targetRepo.targetRepoRoot,
      ref: targetRepo.targetRef,
      missionId: "known-mission",
    });
    const profilePath = path.join(tempRoot, "full-journey.unknown-mission.yaml");
    writeLocalFullJourneyProfile({
      outputProfilePath: profilePath,
      catalogId: "local-target",
      missionId: "missing-mission",
    });

    const run = spawnSync(
      process.execPath,
      [
        harnessScriptPath,
        "--project-ref",
        workspaceRoot,
        "--runtime-root",
        path.join(tempRoot, "runtime"),
        "--examples-root",
        examplesRoot,
        "--profile",
        profilePath,
        "--run-id",
        "full-journey-missing-mission",
        "--catalog-root",
        catalogRoot,
      ],
      { cwd: workspaceRoot, encoding: "utf8" },
    );
    assert.equal(run.status, 1);
    assert.match(run.stderr, /Feature mission 'missing-mission' was not found/u);
  });
});

test("full-journey mode fails when discovery artifacts are not mission-traceable", () => {
  withTempRoot((tempRoot) => {
    const targetRepo = createLocalTargetRepository({ hostTempRoot: tempRoot });
    const examplesRoot = createExamplesRoot({ tempRoot });
    configureCodexExternalRuntimeSuccess({ examplesRoot });
    const catalogRoot = path.join(tempRoot, "catalog");
    writeLocalCatalogTarget({
      catalogRoot,
      catalogId: "local-target",
      repoUrl: targetRepo.targetRepoRoot,
      ref: targetRepo.targetRef,
      missionId: "local-mission",
    });
    const profilePath = path.join(tempRoot, "full-journey.discovery-gap.yaml");
    writeLocalFullJourneyProfile({
      outputProfilePath: profilePath,
      catalogId: "local-target",
      missionId: "local-mission",
      internalTestHooks: {
        drop_spec_step_result_after_spec_build: true,
      },
    });

    const result = runHarness({
      runtimeRoot: path.join(tempRoot, "runtime"),
      examplesRoot,
      profilePath,
      runId: "full-journey-discovery-gap",
      catalogRoot,
    });
    assert.equal(result.live_e2e_run_status, "fail");
    const summary = JSON.parse(fs.readFileSync(result.live_e2e_run_summary_file, "utf8"));
    assert.equal(summary.status, "fail");
    assert.equal(summary.command_results.some((entry) => entry.label === "spec-build"), true);
    assert.match(String(summary.error), /Spec build did not materialize a routed step-result artifact/u);
  });
});

test("full-journey mode fails when approved handoff validation is blocked", () => {
  withTempRoot((tempRoot) => {
    const targetRepo = createLocalTargetRepository({ hostTempRoot: tempRoot });
    const examplesRoot = createExamplesRoot({ tempRoot });
    configureCodexExternalRuntimeSuccess({ examplesRoot });
    const catalogRoot = path.join(tempRoot, "catalog");
    writeLocalCatalogTarget({
      catalogRoot,
      catalogId: "local-target",
      repoUrl: targetRepo.targetRepoRoot,
      ref: targetRepo.targetRef,
      missionId: "local-mission",
    });
    const profilePath = path.join(tempRoot, "full-journey.handoff-block.yaml");
    writeLocalFullJourneyProfile({
      outputProfilePath: profilePath,
      catalogId: "local-target",
      missionId: "local-mission",
      internalTestHooks: {
        block_approved_handoff_validation: true,
      },
    });

    const result = runHarness({
      runtimeRoot: path.join(tempRoot, "runtime"),
      examplesRoot,
      profilePath,
      runId: "full-journey-handoff-block",
      catalogRoot,
    });
    assert.equal(result.live_e2e_run_status, "fail");
    const summary = JSON.parse(fs.readFileSync(result.live_e2e_run_summary_file, "utf8"));
    assert.equal(summary.status, "fail");
    assert.match(String(summary.error), /Approved handoff validation was blocked by internal test hook/u);
  });
});

test("full-journey mode fails when review detects control-plane leakage", () => {
  withTempRoot((tempRoot) => {
    const targetRepo = createLocalTargetRepository({ hostTempRoot: tempRoot });
    const examplesRoot = createExamplesRoot({ tempRoot });
    configureCodexExternalRuntimeForbiddenWrite({ examplesRoot });
    const catalogRoot = path.join(tempRoot, "catalog");
    writeLocalCatalogTarget({
      catalogRoot,
      catalogId: "local-target",
      repoUrl: targetRepo.targetRepoRoot,
      ref: targetRepo.targetRef,
      missionId: "local-mission",
    });
    const profilePath = path.join(tempRoot, "full-journey.review-fail.yaml");
    writeLocalFullJourneyProfile({
      outputProfilePath: profilePath,
      catalogId: "local-target",
      missionId: "local-mission",
    });

    const result = runHarness({
      runtimeRoot: path.join(tempRoot, "runtime"),
      examplesRoot,
      profilePath,
      runId: "full-journey-review-fail",
      catalogRoot,
    });
    assert.equal(result.live_e2e_run_status, "fail");
    const summary = JSON.parse(fs.readFileSync(result.live_e2e_run_summary_file, "utf8"));
    assert.equal(summary.status, "fail");
    assert.equal(summary.verdict_matrix.code_quality, "fail");
    assert.equal(fs.existsSync(summary.incident_report_file), true);
    const reviewReport = JSON.parse(fs.readFileSync(summary.artifacts.review_report_file, "utf8"));
    assert.equal(reviewReport.code_quality.status, "fail");
  });
});

test("full-journey mode fails when delivery prepare is blocked", () => {
  withTempRoot((tempRoot) => {
    const targetRepo = createLocalTargetRepository({ hostTempRoot: tempRoot });
    const examplesRoot = createExamplesRoot({ tempRoot });
    configureCodexExternalRuntimeSuccess({ examplesRoot });
    const catalogRoot = path.join(tempRoot, "catalog");
    writeLocalCatalogTarget({
      catalogRoot,
      catalogId: "local-target",
      repoUrl: targetRepo.targetRepoRoot,
      ref: targetRepo.targetRef,
      missionId: "local-mission",
    });
    const profilePath = path.join(tempRoot, "full-journey.delivery-block.yaml");
    writeLocalFullJourneyProfile({
      outputProfilePath: profilePath,
      catalogId: "local-target",
      missionId: "local-mission",
      internalTestHooks: {
        block_delivery_prepare: true,
      },
    });

    const result = runHarness({
      runtimeRoot: path.join(tempRoot, "runtime"),
      examplesRoot,
      profilePath,
      runId: "full-journey-delivery-block",
      catalogRoot,
    });
    assert.equal(result.live_e2e_run_status, "fail");
    const summary = JSON.parse(fs.readFileSync(result.live_e2e_run_summary_file, "utf8"));
    assert.equal(summary.status, "fail");
    assert.equal(summary.command_results.some((entry) => entry.label === "deliver-prepare"), true);
    assert.match(String(summary.error), /Delivery prepare was blocked/u);
  });
});

test("full-journey mode fails when public learning closure outputs are missing", () => {
  withTempRoot((tempRoot) => {
    const targetRepo = createLocalTargetRepository({ hostTempRoot: tempRoot });
    const examplesRoot = createExamplesRoot({ tempRoot });
    configureCodexExternalRuntimeSuccess({ examplesRoot });
    const catalogRoot = path.join(tempRoot, "catalog");
    writeLocalCatalogTarget({
      catalogRoot,
      catalogId: "local-target",
      repoUrl: targetRepo.targetRepoRoot,
      ref: targetRepo.targetRef,
      missionId: "local-mission",
    });
    const profilePath = path.join(tempRoot, "full-journey.learning-gap.yaml");
    writeLocalFullJourneyProfile({
      outputProfilePath: profilePath,
      catalogId: "local-target",
      missionId: "local-mission",
      internalTestHooks: {
        drop_learning_handoff_outputs: true,
      },
    });

    const result = runHarness({
      runtimeRoot: path.join(tempRoot, "runtime"),
      examplesRoot,
      profilePath,
      runId: "full-journey-learning-gap",
      catalogRoot,
    });
    assert.equal(result.live_e2e_run_status, "fail");
    const summary = JSON.parse(fs.readFileSync(result.live_e2e_run_summary_file, "utf8"));
    assert.equal(summary.status, "fail");
    assert.equal(summary.command_results.some((entry) => entry.label === "learning-handoff"), true);
    assert.match(String(summary.error), /Learning handoff did not materialize the required public closure artifacts/u);
  });
});
