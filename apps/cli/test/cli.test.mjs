import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parse as parseYaml } from "../../../packages/contracts/node_modules/yaml/dist/index.js";

import { appendRunEvent, applyRunControlAction } from "../../api/src/index.mjs";
import { validateContractDocument } from "../../../packages/contracts/src/index.mjs";
import { invokeCli } from "../src/index.mjs";

const currentFilePath = fileURLToPath(import.meta.url);
const fixturesDir = path.join(path.dirname(currentFilePath), "fixtures");
const workspaceRoot = path.resolve(path.dirname(currentFilePath), "../../..");

/**
 * @param {(projectRoot: string) => void} callback
 */
function withTempProject(callback) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-cli-w1-s01-"));
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
 * @param {{ family: import("../../../packages/contracts/src/index.d.ts").ContractFamily, filePath: string, document: Record<string, unknown> }} options
 */
function writeContractFixture(options) {
  const validation = validateContractDocument({
    family: options.family,
    document: options.document,
    source: `fixture://${options.family}`,
  });
  assert.equal(validation.ok, true, `${options.family} fixture must pass contract validation`);
  fs.writeFileSync(options.filePath, `${JSON.stringify(options.document, null, 2)}\n`, "utf8");
}

/**
 * @param {{ projectRoot: string, command: string, args: string[] }} options
 */
function configureCodexExternalRuntime(options) {
  const adapterPath = path.join(options.projectRoot, "examples/adapters/codex-cli.yaml");
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
 * @param {{ projectRoot: string }} options
 */
function configureCodexExternalRuntimeSuccess(options) {
  configureCodexExternalRuntime({
    projectRoot: options.projectRoot,
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
        "evidence_refs:['evidence://external-runner/live-e2e-success'],",
        "tool_traces:[{phase:'invoke_adapter',kind:'external-runner-mock',detail:'node-inline'}]",
        "}));",
      ].join(""),
    ],
  });
}

/**
 * @param {{
 *   hostProjectRoot: string,
 *   branch?: string,
 * }} options
 */
function createLocalTargetRepository(options) {
  const branch = options.branch ?? "main";
  const targetRepoRoot = path.join(options.hostProjectRoot, "target-repo");
  fs.mkdirSync(targetRepoRoot, { recursive: true });
  fs.writeFileSync(
    path.join(targetRepoRoot, "README.md"),
    "# Local target repository for live-e2e tests\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(targetRepoRoot, "package.json"),
    `${JSON.stringify(
      {
        name: "local-live-e2e-target",
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
 * @param {() => void} callback
 */
function withBootstrapAssetsEnv(callback) {
  const previousBootstrapAssetsRoot = process.env.AOR_BOOTSTRAP_ASSETS_ROOT;
  const previousExamplesRoot = process.env.AOR_EXAMPLES_ROOT;
  process.env.AOR_BOOTSTRAP_ASSETS_ROOT = path.join(workspaceRoot, "examples");
  delete process.env.AOR_EXAMPLES_ROOT;
  try {
    callback();
  } finally {
    if (typeof previousBootstrapAssetsRoot === "string") {
      process.env.AOR_BOOTSTRAP_ASSETS_ROOT = previousBootstrapAssetsRoot;
    } else {
      delete process.env.AOR_BOOTSTRAP_ASSETS_ROOT;
    }
    if (typeof previousExamplesRoot === "string") {
      process.env.AOR_EXAMPLES_ROOT = previousExamplesRoot;
    } else {
      delete process.env.AOR_EXAMPLES_ROOT;
    }
  }
}

test("global help transcript matches fixture", () => {
  const expected = fs.readFileSync(path.join(fixturesDir, "help-transcript.txt"), "utf8");
  const result = invokeCli(["--help"]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, expected);
});

test("implemented command help documents inputs outputs and contracts", () => {
  const result = invokeCli(["project", "init", "--help"]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /Status: implemented in bootstrap shell \(W1-S01\)/);
  assert.match(
    result.stdout,
    /Inputs: --project-ref <path> \(optional, defaults to cwd discovery\), --project-profile <path> \(optional\), --runtime-root <path> \(optional\), --materialize-project-profile \(optional\), --bootstrap-template <template_id\|path> \(optional\), --materialize-bootstrap-assets \(optional\), --repo-build-command <cmd> \(optional, repeatable\), --repo-lint-command <cmd> \(optional, repeatable\), --repo-test-command <cmd> \(optional, repeatable\), --help/,
  );
  assert.match(
    result.stdout,
    /Outputs: resolved_project_ref, resolved_runtime_root, project_profile_ref, runtime_layout, runtime_state_file, artifact_packet_id, artifact_packet_file, artifact_packet_body_file, bootstrap_materialization_status, materialized_project_profile_file, materialized_bootstrap_assets_root, bootstrap_materialization_idempotent, contract_families, command_catalog_alignment/,
  );
  assert.match(result.stdout, /Contract families: project-profile/);
});

test("W13 review and learning command help documents verdict and closure semantics", () => {
  const reviewHelp = invokeCli(["review", "run", "--help"]);
  const learningHelp = invokeCli(["learning", "handoff", "--help"]);

  assert.equal(reviewHelp.exitCode, 0);
  assert.equal(reviewHelp.stderr, "");
  assert.match(reviewHelp.stdout, /Status: implemented in review shell \(W13-S05\)/);
  assert.match(reviewHelp.stdout, /report-only review verdict/);
  assert.match(reviewHelp.stdout, /review_report_file/);

  assert.equal(learningHelp.exitCode, 0);
  assert.equal(learningHelp.stderr, "");
  assert.match(learningHelp.stdout, /Status: implemented in learning-loop shell \(W13-S05\)/);
  assert.match(learningHelp.stdout, /public learning-loop scorecard and handoff artifacts/);
  assert.match(learningHelp.stdout, /learning_loop_scorecard_file/);
  assert.match(learningHelp.stdout, /incident_report_file/);
});

test("eval run help documents quality-shell status and offline semantics", () => {
  const result = invokeCli(["eval", "run", "--help"]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /Status: implemented in quality shell \(W3-S03\)/);
  assert.match(result.stdout, /Eval run is offline and independent from delivery automation\./);
});

test("harness replay help documents replay semantics and incompatibility guidance", () => {
  const result = invokeCli(["harness", "replay", "--help"]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /Status: implemented in quality shell \(W9-S05\)/);
  assert.match(result.stdout, /--capture-file points to an existing harness-capture-\*\.json artifact\./);
  assert.match(result.stdout, /status='incompatible'/);
});

test("asset promote help documents promotion semantics", () => {
  const result = invokeCli(["asset", "promote", "--help"]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /Status: implemented in quality shell \(W9-S06\)/);
  assert.match(result.stdout, /Promote defaults to candidate -> stable/);
  assert.match(result.stdout, /promotion_rollout_action/);
});

test("asset freeze help documents freeze guardrail semantics", () => {
  const result = invokeCli(["asset", "freeze", "--help"]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /Status: implemented in quality shell \(W9-S06\)/);
  assert.match(result.stdout, /Freeze defaults to stable -> frozen/);
  assert.match(result.stdout, /freeze remains hold/);
});

test("harness certify help documents certification semantics", () => {
  const result = invokeCli(["harness", "certify", "--help"]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /Status: implemented in quality shell \(W3-S05\)/);
  assert.match(result.stdout, /Status semantics are pass, hold, or fail\./);
});

test("operator command help documents read-only and future control semantics", () => {
  const result = invokeCli(["run", "status", "--help"]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /Status: implemented in operator shell \(W5-S03\)/);
  assert.match(result.stdout, /This command is read-only\./);
  assert.match(result.stdout, /Use run start\/pause\/resume\/steer\/cancel for bounded control actions\./);
});

test("run-control command help documents guardrails and audit semantics", () => {
  const result = invokeCli(["run", "steer", "--help"]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /Status: implemented in run-control shell \(W6-S03\)/);
  assert.match(result.stdout, /--target-step <step_class>/);
  assert.match(result.stdout, /requires --approval-ref when policy guardrails demand approval/);
});

test("ui lifecycle command help documents attach and detach semantics", () => {
  const result = invokeCli(["ui", "attach", "--help"]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /Status: implemented in UI lifecycle shell \(W6-S04\)/);
  assert.match(result.stdout, /Attach records explicit UI lifecycle state/);
  assert.match(result.stdout, /--control-plane is optional/);
});

test("delivery and release command help documents bounded policy semantics", () => {
  const deliverHelp = invokeCli(["deliver", "prepare", "--help"]);
  const releaseHelp = invokeCli(["release", "prepare", "--help"]);

  assert.equal(deliverHelp.exitCode, 0);
  assert.equal(deliverHelp.stderr, "");
  assert.match(deliverHelp.stdout, /Status: implemented in delivery\/release shell \(W6-S05\)/);
  assert.match(deliverHelp.stdout, /--promotion-evidence-refs <ref\[,ref...\]> \(optional\)/);
  assert.match(deliverHelp.stdout, /Non-no-write modes require approved handoff and promotion evidence refs/);

  assert.equal(releaseHelp.exitCode, 0);
  assert.equal(releaseHelp.stderr, "");
  assert.match(releaseHelp.stdout, /Release prepare enforces release preconditions before delivery\/release artifact materialization\./);
});

test("incident and audit command help documents run-linked operational semantics", () => {
  const incidentHelp = invokeCli(["incident", "open", "--help"]);
  const recertifyHelp = invokeCli(["incident", "recertify", "--help"]);
  const auditHelp = invokeCli(["audit", "runs", "--help"]);

  assert.equal(incidentHelp.exitCode, 0);
  assert.equal(incidentHelp.stderr, "");
  assert.match(incidentHelp.stdout, /Status: implemented in incident\/audit shell \(W6-S06\)/);
  assert.match(incidentHelp.stdout, /--run-id <id>/);
  assert.match(incidentHelp.stdout, /writes one contract-valid incident-report/);

  assert.equal(recertifyHelp.exitCode, 0);
  assert.equal(recertifyHelp.stderr, "");
  assert.match(recertifyHelp.stdout, /Status: implemented in incident recertification shell \(W8-S06\)/);
  assert.match(recertifyHelp.stdout, /--incident-id <id>/);
  assert.match(recertifyHelp.stdout, /--decision <recertify\|hold\|re-enable>/);
  assert.match(recertifyHelp.stdout, /Re-enable requires explicit promotion evidence with status=pass/);
  assert.match(recertifyHelp.stdout, /Freeze\/demote rollout actions trigger rollback-safe hold/);

  assert.equal(auditHelp.exitCode, 0);
  assert.equal(auditHelp.stderr, "");
  assert.match(auditHelp.stdout, /run-centric snapshots for packet, step, quality, and finance evidence refs/);
});

test("unknown command fails clearly", () => {
  const result = invokeCli(["project", "unknown"]);

  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Unknown command 'project unknown'/);
});

test("missing required project-ref fails clearly", () => {
  const result = invokeCli(["project", "analyze"]);

  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Missing required flag '--project-ref'/);
});

test("invalid project-ref fails clearly", () => {
  const result = invokeCli(["project", "validate", "--project-ref", "./does-not-exist"]);

  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Invalid project reference '\.\/does-not-exist': path does not exist\./);
});

test("planned command section is empty when the current shell has no planned commands", () => {
  const result = invokeCli(["--help"]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /Planned commands \(not implemented yet\):\n\nUse 'aor <group> <command> --help'/);
});

test("W6 intake/discovery/spec/wave command pack writes durable artifacts", () => {
  withTempProject((projectRoot) => {
    fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
    fs.cpSync(path.join(workspaceRoot, "examples"), path.join(projectRoot, "examples"), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, "package.json"),
      JSON.stringify({ name: "fixture", scripts: { lint: "eslint .", test: "node --test", build: "tsc -b" } }, null, 2),
      "utf8",
    );
    fs.writeFileSync(path.join(projectRoot, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\\n", "utf8");

    const intakeResult = invokeCli(["intake", "create", "--project-ref", projectRoot]);
    assert.equal(intakeResult.exitCode, 0, intakeResult.stderr);
    const intakePayload = JSON.parse(intakeResult.stdout);
    assert.equal(intakePayload.command, "intake create");
    assert.equal(fs.existsSync(intakePayload.artifact_packet_file), true);

    const discoveryResult = invokeCli(["discovery", "run", "--project-ref", projectRoot]);
    assert.equal(discoveryResult.exitCode, 0, discoveryResult.stderr);
    const discoveryPayload = JSON.parse(discoveryResult.stdout);
    assert.equal(discoveryPayload.command, "discovery run");
    assert.equal(fs.existsSync(discoveryPayload.analysis_report_file), true);
    assert.equal(fs.existsSync(discoveryPayload.route_resolution_file), true);
    assert.equal(discoveryPayload.discovery_completeness_status, "pass");
    assert.equal(discoveryPayload.discovery_completeness_blocking, false);
    assert.ok(Array.isArray(discoveryPayload.discovery_completeness_checks));
    assert.equal(typeof discoveryPayload.architecture_traceability, "object");

    const specResult = invokeCli(["spec", "build", "--project-ref", projectRoot]);
    assert.equal(specResult.exitCode, 0, specResult.stderr);
    const specPayload = JSON.parse(specResult.stdout);
    assert.equal(specPayload.command, "spec build");
    assert.equal(typeof specPayload.routed_step_result_id, "string");
    assert.equal(fs.existsSync(specPayload.routed_step_result_file), true);
    assert.equal(specPayload.discovery_completeness_status, "pass");
    assert.equal(specPayload.discovery_completeness_blocking, false);
    assert.ok(Array.isArray(specPayload.discovery_completeness_checks));
    assert.equal(typeof specPayload.architecture_traceability, "object");
    const specStepResult = JSON.parse(fs.readFileSync(specPayload.routed_step_result_file, "utf8"));
    assert.equal(specStepResult.step_class, "artifact");
    assert.equal(specStepResult.routed_execution.discovery_completeness_gate.status, "pass");
    assert.equal(specStepResult.routed_execution.architecture_traceability.selected_step.step_class, "spec");

    const waveResult = invokeCli(["wave", "create", "--project-ref", projectRoot]);
    assert.equal(waveResult.exitCode, 0, waveResult.stderr);
    const wavePayload = JSON.parse(waveResult.stdout);
    assert.equal(wavePayload.command, "wave create");
    assert.equal(fs.existsSync(wavePayload.wave_ticket_file), true);
    assert.equal(fs.existsSync(wavePayload.handoff_packet_file), true);
    assert.equal(wavePayload.handoff_status, "pending-approval");

    const transcriptFixture = JSON.parse(
      fs.readFileSync(path.join(fixturesDir, "intake-discovery-spec-wave-transcript.json"), "utf8"),
    );
    const transcriptSubset = {
      intake_create: {
        command: intakePayload.command,
        status: intakePayload.status,
        artifact_packet_id: intakePayload.artifact_packet_id,
      },
      discovery_run: {
        command: discoveryPayload.command,
        status: discoveryPayload.status,
        analysis_report_id: discoveryPayload.analysis_report_id,
        discovery_completeness_status: discoveryPayload.discovery_completeness_status,
      },
      spec_build: {
        command: specPayload.command,
        status: specPayload.status,
        routed_step_result_id: specPayload.routed_step_result_id,
        discovery_completeness_status: specPayload.discovery_completeness_status,
      },
      wave_create: {
        command: wavePayload.command,
        status: wavePayload.status,
        wave_ticket_id: wavePayload.wave_ticket_id,
        handoff_status: wavePayload.handoff_status,
      },
    };
    assert.deepEqual(transcriptSubset, transcriptFixture);
  });
});

test("spec build blocks when discovery completeness checks fail", () => {
  withTempProject((projectRoot) => {
    fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
    fs.cpSync(path.join(workspaceRoot, "examples"), path.join(projectRoot, "examples"), { recursive: true });
    fs.rmSync(path.join(projectRoot, "examples", "eval"), { recursive: true, force: true });

    const discoveryResult = invokeCli(["discovery", "run", "--project-ref", projectRoot]);
    assert.equal(discoveryResult.exitCode, 0, discoveryResult.stderr);
    const discoveryPayload = JSON.parse(discoveryResult.stdout);
    assert.equal(discoveryPayload.discovery_completeness_status, "fail");
    assert.equal(discoveryPayload.discovery_completeness_blocking, true);

    const specResult = invokeCli(["spec", "build", "--project-ref", projectRoot]);
    assert.equal(specResult.exitCode, 0, specResult.stderr);
    const specPayload = JSON.parse(specResult.stdout);
    assert.equal(specPayload.discovery_completeness_status, "fail");
    assert.equal(specPayload.discovery_completeness_blocking, true);
    assert.equal(fs.existsSync(specPayload.routed_step_result_file), true);

    const specStepResult = JSON.parse(fs.readFileSync(specPayload.routed_step_result_file, "utf8"));
    assert.equal(specStepResult.status, "failed");
    assert.match(specStepResult.summary, /Spec build blocked by discovery completeness checks/i);
    assert.equal(specStepResult.routed_execution.discovery_completeness_gate.status, "fail");
  });
});

test("W6 intake/discovery/spec/wave commands require --project-ref", () => {
  const commands = [
    ["intake", "create"],
    ["discovery", "run"],
    ["spec", "build"],
    ["wave", "create"],
  ];

  for (const [group, verb] of commands) {
    const result = invokeCli([group, verb]);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /Missing required flag '--project-ref'/);
  }
});

test("W6 run-control command pack enforces guardrails, transitions, and durable audit evidence", () => {
  withTempProject((projectRoot) => {
    runGitChecked({ cwd: projectRoot, args: ["init"] });
    runGitChecked({ cwd: projectRoot, args: ["config", "user.email", "aor@example.com"] });
    runGitChecked({ cwd: projectRoot, args: ["config", "user.name", "AOR Test"] });
    fs.cpSync(path.join(workspaceRoot, "examples"), path.join(projectRoot, "examples"), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, "package.json"),
      JSON.stringify({ name: "fixture", scripts: { lint: "eslint .", test: "node --test", build: "tsc -b" } }, null, 2),
      "utf8",
    );
    fs.writeFileSync(path.join(projectRoot, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\\n", "utf8");
    configureCodexExternalRuntimeSuccess({ projectRoot });

    const executionRunId = "run-control-execution-smoke";

    const preflightResult = invokeCli([
      "project",
      "verify",
      "--project-ref",
      projectRoot,
      "--routed-dry-run-step",
      "implement",
    ]);
    assert.equal(preflightResult.exitCode, 0, preflightResult.stderr);
    const preflightPayload = JSON.parse(preflightResult.stdout);
    const promotionEvidenceRefs = [
      preflightPayload.verify_summary_file,
      ...preflightPayload.step_result_files,
    ].join(",");

    const startResult = invokeCli([
      "run",
      "start",
      "--project-ref",
      projectRoot,
      "--run-id",
      executionRunId,
      "--approved-handoff-ref",
      "evidence://handoff/run-control-approved",
      "--promotion-evidence-refs",
      promotionEvidenceRefs,
    ]);
    assert.equal(startResult.exitCode, 0, startResult.stderr);
    const startPayload = JSON.parse(startResult.stdout);
    assert.equal(startPayload.run_control_action, "start");
    assert.equal(startPayload.run_control_blocked, false);
    assert.equal(startPayload.run_control_state.status, "completed");
    assert.equal(fs.existsSync(startPayload.run_control_state_file), true);
    assert.equal(fs.existsSync(startPayload.run_control_audit_file), true);
    assert.equal(typeof startPayload.routed_step_result_id, "string");
    assert.equal(fs.existsSync(startPayload.routed_step_result_file), true);

    const transitionRunId = "run-control-transition-smoke";
    applyRunControlAction({
      projectRef: projectRoot,
      runId: transitionRunId,
      action: "start",
    });

    const pauseResult = invokeCli(["run", "pause", "--project-ref", projectRoot, "--run-id", transitionRunId]);
    assert.equal(pauseResult.exitCode, 0, pauseResult.stderr);
    const pausePayload = JSON.parse(pauseResult.stdout);
    assert.equal(pausePayload.run_control_action, "pause");
    assert.equal(pausePayload.run_control_blocked, false);
    assert.equal(pausePayload.run_control_state.status, "paused");
    assert.equal(fs.existsSync(pausePayload.run_control_audit_file), true);

    const blockedScopeResult = invokeCli([
      "run",
      "steer",
      "--project-ref",
      projectRoot,
      "--run-id",
      transitionRunId,
    ]);
    assert.equal(blockedScopeResult.exitCode, 0, blockedScopeResult.stderr);
    const blockedScopePayload = JSON.parse(blockedScopeResult.stdout);
    assert.equal(blockedScopePayload.run_control_action, "steer");
    assert.equal(blockedScopePayload.run_control_blocked, true);
    assert.equal(blockedScopePayload.run_control_guardrails.approval_required, true);
    assert.equal(blockedScopePayload.run_control_transition.from_status, "paused");
    assert.equal(blockedScopePayload.run_control_transition.to_status, "paused");
    assert.equal(fs.existsSync(blockedScopePayload.run_control_audit_file), true);
    const blockedScopeAudit = JSON.parse(fs.readFileSync(blockedScopePayload.run_control_audit_file, "utf8"));
    assert.equal(blockedScopeAudit.run_id, transitionRunId);
    assert.equal(blockedScopeAudit.blocked, true);
    assert.equal(blockedScopeAudit.blocked_reason.code, "scope.target_step_required");

    const resumeResult = invokeCli(["run", "resume", "--project-ref", projectRoot, "--run-id", transitionRunId]);
    assert.equal(resumeResult.exitCode, 0, resumeResult.stderr);
    const resumePayload = JSON.parse(resumeResult.stdout);
    assert.equal(resumePayload.run_control_blocked, false);
    assert.equal(resumePayload.run_control_state.status, "running");

    const invalidTransitionResult = invokeCli([
      "run",
      "resume",
      "--project-ref",
      projectRoot,
      "--run-id",
      transitionRunId,
    ]);
    assert.equal(invalidTransitionResult.exitCode, 0, invalidTransitionResult.stderr);
    const invalidTransitionPayload = JSON.parse(invalidTransitionResult.stdout);
    assert.equal(invalidTransitionPayload.run_control_action, "resume");
    assert.equal(invalidTransitionPayload.run_control_blocked, true);
    assert.equal(invalidTransitionPayload.run_control_transition.from_status, "running");
    assert.equal(invalidTransitionPayload.run_control_transition.to_status, "running");

    const blockedApprovalResult = invokeCli([
      "run",
      "cancel",
      "--project-ref",
      projectRoot,
      "--run-id",
      transitionRunId,
    ]);
    assert.equal(blockedApprovalResult.exitCode, 0, blockedApprovalResult.stderr);
    const blockedApprovalPayload = JSON.parse(blockedApprovalResult.stdout);
    assert.equal(blockedApprovalPayload.run_control_action, "cancel");
    assert.equal(blockedApprovalPayload.run_control_blocked, true);
    assert.equal(blockedApprovalPayload.run_control_guardrails.approval_required, true);
    assert.equal(fs.existsSync(blockedApprovalPayload.run_control_audit_file), true);

    const cancelResult = invokeCli([
      "run",
      "cancel",
      "--project-ref",
      projectRoot,
      "--run-id",
      transitionRunId,
      "--approval-ref",
      "approval://RC-1001",
    ]);
    assert.equal(cancelResult.exitCode, 0, cancelResult.stderr);
    const cancelPayload = JSON.parse(cancelResult.stdout);
    assert.equal(cancelPayload.run_control_blocked, false);
    assert.equal(cancelPayload.run_control_state.status, "canceled");
    assert.equal(fs.existsSync(cancelPayload.run_control_audit_file), true);

    const statusResult = invokeCli([
      "run",
      "status",
      "--project-ref",
      projectRoot,
      "--run-id",
      transitionRunId,
    ]);
    assert.equal(statusResult.exitCode, 0, statusResult.stderr);
    const statusPayload = JSON.parse(statusResult.stdout);
    assert.ok(statusPayload.run_summaries.some((summary) => summary.run_id === transitionRunId));

    const transcriptFixture = JSON.parse(
      fs.readFileSync(path.join(fixturesDir, "run-control-transcript.json"), "utf8"),
    );
    const transcriptSubset = {
      run_start: {
        command: startPayload.command,
        status: startPayload.status,
        run_control_action: startPayload.run_control_action,
        run_control_blocked: startPayload.run_control_blocked,
      },
      run_pause: {
        command: pausePayload.command,
        status: pausePayload.status,
        run_control_action: pausePayload.run_control_action,
        run_control_blocked: pausePayload.run_control_blocked,
      },
      run_steer_blocked: {
        command: blockedScopePayload.command,
        status: blockedScopePayload.status,
        run_control_action: blockedScopePayload.run_control_action,
        run_control_blocked: blockedScopePayload.run_control_blocked,
        blocked_reason_code: blockedScopeAudit.blocked_reason.code,
      },
      run_cancel: {
        command: cancelPayload.command,
        status: cancelPayload.status,
        run_control_action: cancelPayload.run_control_action,
        run_control_blocked: cancelPayload.run_control_blocked,
      },
    };
    assert.deepEqual(transcriptSubset, transcriptFixture);
  });
});

test("W6 ui attach/detach command pack reports lifecycle state and preserves headless operation", () => {
  withTempProject((projectRoot) => {
    fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
    fs.cpSync(path.join(workspaceRoot, "examples"), path.join(projectRoot, "examples"), { recursive: true });

    const runStartResult = invokeCli(["run", "start", "--project-ref", projectRoot, "--run-id", "ui-lifecycle-smoke"]);
    assert.equal(runStartResult.exitCode, 0, runStartResult.stderr);

    const attachConnected = invokeCli([
      "ui",
      "attach",
      "--project-ref",
      projectRoot,
      "--run-id",
      "ui-lifecycle-smoke",
      "--control-plane",
      "http://localhost:8080",
    ]);
    assert.equal(attachConnected.exitCode, 0, attachConnected.stderr);
    const attachConnectedPayload = JSON.parse(attachConnected.stdout);
    assert.equal(attachConnectedPayload.ui_lifecycle_action, "attach");
    assert.equal(attachConnectedPayload.ui_lifecycle_state.ui_attached, true);
    assert.equal(attachConnectedPayload.ui_lifecycle_connection_state, "connected");
    assert.equal(attachConnectedPayload.ui_lifecycle_idempotent, false);

    const attachRetry = invokeCli([
      "ui",
      "attach",
      "--project-ref",
      projectRoot,
      "--run-id",
      "ui-lifecycle-smoke",
      "--control-plane",
      "http://localhost:8080",
    ]);
    assert.equal(attachRetry.exitCode, 0, attachRetry.stderr);
    const attachRetryPayload = JSON.parse(attachRetry.stdout);
    assert.equal(attachRetryPayload.ui_lifecycle_idempotent, true);

    const detachResult = invokeCli(["ui", "detach", "--project-ref", projectRoot, "--run-id", "ui-lifecycle-smoke"]);
    assert.equal(detachResult.exitCode, 0, detachResult.stderr);
    const detachPayload = JSON.parse(detachResult.stdout);
    assert.equal(detachPayload.ui_lifecycle_action, "detach");
    assert.equal(detachPayload.ui_lifecycle_state.ui_attached, false);
    assert.equal(detachPayload.ui_lifecycle_connection_state, "detached");
    assert.equal(detachPayload.ui_lifecycle_idempotent, false);

    const detachRetry = invokeCli(["ui", "detach", "--project-ref", projectRoot, "--run-id", "ui-lifecycle-smoke"]);
    assert.equal(detachRetry.exitCode, 0, detachRetry.stderr);
    const detachRetryPayload = JSON.parse(detachRetry.stdout);
    assert.equal(detachRetryPayload.ui_lifecycle_idempotent, true);

    const attachDisconnected = invokeCli([
      "ui",
      "attach",
      "--project-ref",
      projectRoot,
      "--run-id",
      "ui-lifecycle-smoke",
    ]);
    assert.equal(attachDisconnected.exitCode, 0, attachDisconnected.stderr);
    const attachDisconnectedPayload = JSON.parse(attachDisconnected.stdout);
    assert.equal(attachDisconnectedPayload.ui_lifecycle_connection_state, "disconnected");
    assert.equal(attachDisconnectedPayload.ui_lifecycle_headless_safe, true);
    assert.equal(fs.existsSync(attachDisconnectedPayload.ui_lifecycle_state_file), true);

    const detachAfterDisconnected = invokeCli([
      "ui",
      "detach",
      "--project-ref",
      projectRoot,
      "--run-id",
      "ui-lifecycle-smoke",
    ]);
    assert.equal(detachAfterDisconnected.exitCode, 0, detachAfterDisconnected.stderr);

    const headlessRunStatus = invokeCli([
      "run",
      "status",
      "--project-ref",
      projectRoot,
      "--run-id",
      "ui-lifecycle-smoke",
    ]);
    assert.equal(headlessRunStatus.exitCode, 0, headlessRunStatus.stderr);
    const headlessStatusPayload = JSON.parse(headlessRunStatus.stdout);
    assert.ok(headlessStatusPayload.run_summaries.some((summary) => summary.run_id === "ui-lifecycle-smoke"));
    assert.equal(headlessStatusPayload.ui_lifecycle_state.connection_state, "detached");

    const transcriptFixture = JSON.parse(
      fs.readFileSync(path.join(fixturesDir, "ui-lifecycle-transcript.json"), "utf8"),
    );
    const transcriptSubset = {
      attach_connected: {
        command: attachConnectedPayload.command,
        status: attachConnectedPayload.status,
        ui_lifecycle_action: attachConnectedPayload.ui_lifecycle_action,
        ui_lifecycle_connection_state: attachConnectedPayload.ui_lifecycle_connection_state,
        ui_lifecycle_idempotent: attachConnectedPayload.ui_lifecycle_idempotent,
      },
      detach: {
        command: detachPayload.command,
        status: detachPayload.status,
        ui_lifecycle_action: detachPayload.ui_lifecycle_action,
        ui_lifecycle_connection_state: detachPayload.ui_lifecycle_connection_state,
        ui_lifecycle_idempotent: detachPayload.ui_lifecycle_idempotent,
      },
      attach_disconnected: {
        command: attachDisconnectedPayload.command,
        status: attachDisconnectedPayload.status,
        ui_lifecycle_action: attachDisconnectedPayload.ui_lifecycle_action,
        ui_lifecycle_connection_state: attachDisconnectedPayload.ui_lifecycle_connection_state,
        ui_lifecycle_headless_safe: attachDisconnectedPayload.ui_lifecycle_headless_safe,
      },
    };
    assert.deepEqual(transcriptSubset, transcriptFixture);
  });
});

test("W6 delivery/release prepare command pack enforces policy guardrails and emits durable artifacts", () => {
  withTempProject((projectRoot) => {
    fs.cpSync(path.join(workspaceRoot, "examples"), path.join(projectRoot, "examples"), { recursive: true });
    runGitChecked({ cwd: projectRoot, args: ["init"] });
    runGitChecked({ cwd: projectRoot, args: ["config", "user.email", "aor@example.com"] });
    runGitChecked({ cwd: projectRoot, args: ["config", "user.name", "AOR Test"] });
    runGitChecked({ cwd: projectRoot, args: ["add", "-A"] });
    runGitChecked({ cwd: projectRoot, args: ["commit", "-m", "initial"] });
    runGitChecked({ cwd: projectRoot, args: ["remote", "add", "origin", "https://github.com/openai/openai.git"] });

    const targetFile = path.join(projectRoot, "examples/project.aor.yaml");

    const noWriteResult = invokeCli([
      "deliver",
      "prepare",
      "--project-ref",
      projectRoot,
      "--run-id",
      "w6-deliver-no-write",
      "--mode",
      "no-write",
    ]);
    assert.equal(noWriteResult.exitCode, 0, noWriteResult.stderr);
    const noWritePayload = JSON.parse(noWriteResult.stdout);
    assert.equal(noWritePayload.delivery_mode, "no-write");
    assert.equal(noWritePayload.delivery_writeback_result, "no-write-confirmed");
    assert.equal(noWritePayload.delivery_blocking, false);
    assert.equal(noWritePayload.delivery_governance_decision.decision, "allow");
    assert.equal(noWritePayload.release_packet_status, "ready-for-close");
    assert.equal(fs.existsSync(noWritePayload.delivery_manifest_file), true);
    assert.equal(fs.existsSync(noWritePayload.release_packet_file), true);
    const noWriteManifest = JSON.parse(fs.readFileSync(noWritePayload.delivery_manifest_file, "utf8"));
    const noWriteReleasePacket = JSON.parse(fs.readFileSync(noWritePayload.release_packet_file, "utf8"));
    const manifestFixture = JSON.parse(
      fs.readFileSync(path.join(fixturesDir, "delivery-prepare-manifest.fixture.json"), "utf8"),
    );
    const releasePacketFixture = JSON.parse(
      fs.readFileSync(path.join(fixturesDir, "release-prepare-packet.fixture.json"), "utf8"),
    );
    const manifestSubset = {
      delivery_mode: noWriteManifest.delivery_mode,
      status: noWriteManifest.status,
      writeback_mode: noWriteManifest.writeback_policy?.mode,
      writeback_result: noWriteManifest.repo_deliveries?.[0]?.writeback_result,
    };
    const releasePacketSubset = {
      status: noWriteReleasePacket.status,
      delivery_manifest_ref_present: typeof noWriteReleasePacket.delivery_manifest_ref === "string",
    };
    assert.deepEqual(manifestSubset, manifestFixture);
    assert.deepEqual(releasePacketSubset, releasePacketFixture);

    fs.appendFileSync(targetFile, "\n# w6-s05 local-branch prepare smoke\n", "utf8");
    const branchResult = invokeCli([
      "deliver",
      "prepare",
      "--project-ref",
      projectRoot,
      "--run-id",
      "w6-deliver-local-branch",
      "--mode",
      "local-branch",
      "--approved-handoff-ref",
      "evidence://handoff/local-branch",
      "--promotion-evidence-refs",
      "evidence://promotion/local-branch",
      "--branch-name",
      "aor/w6-s05-local-branch",
      "--commit-message",
      "W6-S05 local branch prepare smoke",
    ]);
    assert.equal(branchResult.exitCode, 0, branchResult.stderr);
    const branchPayload = JSON.parse(branchResult.stdout);
    assert.equal(branchPayload.delivery_mode, "local-branch");
    assert.equal(branchPayload.delivery_writeback_result, "local-branch-committed");
    assert.equal(branchPayload.delivery_blocking, false);
    assert.equal(branchPayload.delivery_governance_decision.decision, "allow");
    assert.equal(branchPayload.release_packet_status, "ready-for-close");
    assert.equal(fs.existsSync(branchPayload.delivery_manifest_file), true);
    assert.equal(fs.existsSync(branchPayload.release_packet_file), true);
    const branchName = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: projectRoot,
      encoding: "utf8",
    }).stdout.trim();
    assert.equal(branchName, "aor/w6-s05-local-branch");

    fs.appendFileSync(targetFile, "\n# w6-s05 fork-first prepare smoke\n", "utf8");
    const forkResult = invokeCli([
      "deliver",
      "prepare",
      "--project-ref",
      projectRoot,
      "--run-id",
      "w6-deliver-fork-first",
      "--mode",
      "fork-first-pr",
      "--approved-handoff-ref",
      "evidence://handoff/fork-first",
      "--promotion-evidence-refs",
      "evidence://promotion/fork-first",
      "--fork-owner",
      "aor-bot",
      "--branch-name",
      "aor/w6-s05-fork-first",
      "--pr-title",
      "W6-S05 fork-first smoke",
    ]);
    assert.equal(forkResult.exitCode, 0, forkResult.stderr);
    const forkPayload = JSON.parse(forkResult.stdout);
    assert.equal(forkPayload.delivery_mode, "fork-first-pr");
    assert.equal(forkPayload.delivery_writeback_result, "fork-pr-planned");
    assert.equal(forkPayload.delivery_blocking, false);
    assert.equal(forkPayload.delivery_governance_decision.decision, "allow");
    assert.equal(forkPayload.release_packet_status, "ready-for-close");
    assert.equal(fs.existsSync(forkPayload.delivery_manifest_file), true);
    assert.equal(fs.existsSync(forkPayload.release_packet_file), true);

    const releaseBlockedResult = invokeCli([
      "release",
      "prepare",
      "--project-ref",
      projectRoot,
      "--run-id",
      "w6-release-blocked",
      "--mode",
      "patch-only",
    ]);
    assert.equal(releaseBlockedResult.exitCode, 1);
    assert.equal(releaseBlockedResult.stdout, "");
    assert.match(releaseBlockedResult.stderr, /Release preconditions failed: /);
    assert.match(releaseBlockedResult.stderr, /approved-handoff-required/);
    assert.match(releaseBlockedResult.stderr, /promotion-evidence-required/);

    const transcriptFixture = JSON.parse(
      fs.readFileSync(path.join(fixturesDir, "delivery-release-prepare-transcript.json"), "utf8"),
    );
    const transcriptSubset = {
      deliver_no_write: {
        command: noWritePayload.command,
        status: noWritePayload.status,
        delivery_mode: noWritePayload.delivery_mode,
        delivery_writeback_result: noWritePayload.delivery_writeback_result,
        release_packet_status: noWritePayload.release_packet_status,
      },
      deliver_local_branch: {
        command: branchPayload.command,
        status: branchPayload.status,
        delivery_mode: branchPayload.delivery_mode,
        delivery_writeback_result: branchPayload.delivery_writeback_result,
        release_packet_status: branchPayload.release_packet_status,
      },
      deliver_fork_first: {
        command: forkPayload.command,
        status: forkPayload.status,
        delivery_mode: forkPayload.delivery_mode,
        delivery_writeback_result: forkPayload.delivery_writeback_result,
        release_packet_status: forkPayload.release_packet_status,
      },
    };
    assert.deepEqual(transcriptSubset, transcriptFixture);
  });
});

test("delivery and release outputs enforce multi-repo coordination evidence and preserve rerun scope", () => {
  withTempProject((projectRoot) => {
    fs.cpSync(path.join(workspaceRoot, "examples"), path.join(projectRoot, "examples"), { recursive: true });
    runGitChecked({ cwd: projectRoot, args: ["init"] });
    runGitChecked({ cwd: projectRoot, args: ["config", "user.email", "aor@example.com"] });
    runGitChecked({ cwd: projectRoot, args: ["config", "user.name", "AOR Test"] });
    runGitChecked({ cwd: projectRoot, args: ["add", "-A"] });
    runGitChecked({ cwd: projectRoot, args: ["commit", "-m", "initial"] });

    const profilePath = path.join(projectRoot, "examples/project.aor.yaml");
    const profileContent = fs.readFileSync(profilePath, "utf8");
    fs.writeFileSync(
      profilePath,
      profileContent.replace(
        "repo_graph: []",
        [
          "  - repo_id: docs",
          "    name: docs",
          "    source:",
          "      kind: local",
          "      root: docs",
          "    default_branch: main",
          "    role: documentation",
          "repo_graph: []",
        ].join("\n"),
      ),
      "utf8",
    );

    const blockedRelease = invokeCli([
      "release",
      "prepare",
      "--project-ref",
      projectRoot,
      "--run-id",
      "w8-release-coordination-blocked",
      "--mode",
      "patch-only",
      "--approved-handoff-ref",
      "evidence://handoff/w8-release-coordination-blocked",
      "--promotion-evidence-refs",
      "evidence://promotion/w8-release-coordination-blocked",
    ]);
    assert.equal(blockedRelease.exitCode, 1);
    assert.equal(blockedRelease.stdout, "");
    assert.match(blockedRelease.stderr, /multi-repo-coordination-evidence-required/);

    const deliverResult = invokeCli([
      "deliver",
      "prepare",
      "--project-ref",
      projectRoot,
      "--run-id",
      "w8-deliver-rerun-coordination",
      "--mode",
      "no-write",
      "--coordination-evidence-refs",
      "evidence://coordination/w8-deliver-rerun-coordination",
      "--rerun-of-run-id",
      "w8-deliver-previous-failed",
      "--rerun-failed-step",
      "deliver.prepare",
      "--rerun-packet-boundary",
      "delivery-manifest",
    ]);
    assert.equal(deliverResult.exitCode, 0, deliverResult.stderr);
    const deliverPayload = JSON.parse(deliverResult.stdout);
    assert.equal(deliverPayload.delivery_mode, "no-write");
    assert.equal(deliverPayload.delivery_coordination.required, true);
    assert.deepEqual(deliverPayload.delivery_coordination.repo_ids, ["main", "docs"]);
    assert.equal(deliverPayload.delivery_coordination.status, "present");
    assert.equal(deliverPayload.delivery_rerun_recovery.requested, true);
    assert.equal(deliverPayload.delivery_rerun_recovery.status, "ready");
    assert.equal(deliverPayload.delivery_rerun_recovery.failed_step_ref, "deliver.prepare");
    assert.equal(deliverPayload.delivery_rerun_recovery.packet_boundary, "delivery-manifest");
    assert.ok(deliverPayload.delivery_rerun_recovery.rerun_of_run_ref.includes("w8-deliver-previous-failed"));
  });
});

test("delivery and release surfaces explicit governance deny/escalation reasons for high-risk policy paths", () => {
  withTempProject((projectRoot) => {
    fs.cpSync(path.join(workspaceRoot, "examples"), path.join(projectRoot, "examples"), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });

    const profilePath = path.join(projectRoot, "examples/project.aor.yaml");
    const profileContent = fs.readFileSync(profilePath, "utf8");
    fs.writeFileSync(
      profilePath,
      profileContent.replace("  - openai\n  - anthropic\n  - open-code", "  - anthropic\n  - open-code"),
      "utf8",
    );

    const denyResult = invokeCli([
      "release",
      "prepare",
      "--project-ref",
      projectRoot,
      "--run-id",
      "w8-release-governance-deny",
      "--mode",
      "patch-only",
      "--approved-handoff-ref",
      "evidence://handoff/approved",
      "--promotion-evidence-refs",
      "evidence://promotion/pass",
    ]);
    assert.equal(denyResult.exitCode, 1);
    assert.equal(denyResult.stdout, "");
    assert.match(denyResult.stderr, /Release preconditions failed:/);
    assert.match(denyResult.stderr, /provider-not-allowlisted/);
  });

  withTempProject((projectRoot) => {
    fs.cpSync(path.join(workspaceRoot, "examples"), path.join(projectRoot, "examples"), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });

    const routePath = path.join(projectRoot, "examples/routes/implement-default.yaml");
    const routeContent = fs.readFileSync(routePath, "utf8");
    fs.writeFileSync(routePath, routeContent.replace("risk_tier: medium", "risk_tier: high"), "utf8");

    const escalateResult = invokeCli([
      "release",
      "prepare",
      "--project-ref",
      projectRoot,
      "--run-id",
      "w8-release-governance-escalate",
      "--mode",
      "patch-only",
      "--approved-handoff-ref",
      "evidence://handoff/approved",
      "--promotion-evidence-refs",
      "evidence://promotion/pass",
    ]);
    assert.equal(escalateResult.exitCode, 1);
    assert.equal(escalateResult.stdout, "");
    assert.match(escalateResult.stderr, /Release preconditions failed:/);
    assert.match(escalateResult.stderr, /high-risk-security-review-required/);
    assert.match(escalateResult.stderr, /high-risk-human-approval-required/);
  });
});

test("W6 incident and audit command pack links run evidence to durable incident and audit outputs", () => {
  withTempProject((projectRoot) => {
    fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
    fs.cpSync(path.join(workspaceRoot, "examples"), path.join(projectRoot, "examples"), { recursive: true });

    const verifyResult = invokeCli([
      "project",
      "verify",
      "--project-ref",
      projectRoot,
      "--routed-dry-run-step",
      "implement",
    ]);
    assert.equal(verifyResult.exitCode, 0, verifyResult.stderr);
    const verifyPayload = JSON.parse(verifyResult.stdout);
    const routedStepResult = JSON.parse(fs.readFileSync(verifyPayload.routed_step_result_file, "utf8"));
    const runId = routedStepResult.run_id;
    const reportsRoot = path.dirname(verifyPayload.routed_step_result_file);
    const runtimeProjectRoot = path.dirname(reportsRoot);
    const artifactsRoot = path.join(runtimeProjectRoot, "artifacts");

    writeContractFixture({
      family: "step-result",
      filePath: path.join(reportsRoot, `step-result-finance-audit-${runId.replace(/[^\w.-]+/g, "-")}.json`),
      document: {
        step_result_id: `${runId}.step.finance.audit`,
        run_id: runId,
        step_id: "runner.finance.audit",
        step_class: "runner",
        status: "passed",
        summary: "Finance evidence fixture for audit runs",
        evidence_refs: [verifyPayload.routed_step_result_file],
        routed_execution: {
          started_at: "2026-01-01T02:00:00.000Z",
          finished_at: "2026-01-01T02:00:04.000Z",
          route_resolution: {
            resolved_route_id: "route.finance.audit.fixture",
          },
          asset_resolution: {
            wrapper: {
              wrapper_ref: "wrapper://wrapper.finance.audit@v1",
            },
          },
          adapter_resolution: {
            adapter: {
              adapter_id: "adapter.finance.audit",
            },
          },
          policy_resolution: {
            resolved_bounds: {
              budget: {
                max_cost_usd: 9999,
                timeout_sec: 9999,
                max_cost_source: "policy.finance.audit.max_cost",
                timeout_source: "policy.finance.audit.timeout",
              },
            },
          },
        },
      },
    });

    const promotionDecisionFile = path.join(
      artifactsRoot,
      `promotion-decision-finance-audit-${runId.replace(/[^\w.-]+/g, "-")}.json`,
    );
    writeContractFixture({
      family: "promotion-decision",
      filePath: promotionDecisionFile,
      document: {
        decision_id: `fixture.promotion.finance.${runId}`,
        run_id: runId,
        subject_ref: "wrapper://wrapper.finance.audit@v1",
        from_channel: "candidate",
        to_channel: "stable",
        evidence_refs: [verifyPayload.routed_step_result_file],
        evidence_summary: {
          finance_signals: {
            capture_latency_sec: 0.25,
            replay_latency_sec: 0.35,
            total_latency_sec: 0.6,
          },
          baseline_comparison: {
            baseline_pass_rate: 0.88,
            candidate_pass_rate: 0.86,
          },
        },
        status: "pass",
      },
    });
    const promotionDecisionRef = `evidence://${path.relative(projectRoot, promotionDecisionFile).replace(/\\/g, "/")}`;
    const blockedPromotionFile = path.join(
      artifactsRoot,
      `promotion-decision-finance-audit-blocked-${runId.replace(/[^\w.-]+/g, "-")}.json`,
    );
    writeContractFixture({
      family: "promotion-decision",
      filePath: blockedPromotionFile,
      document: {
        decision_id: `fixture.promotion.finance.blocked.${runId}`,
        run_id: runId,
        subject_ref: "wrapper://wrapper.finance.audit@v1",
        from_channel: "candidate",
        to_channel: "stable",
        evidence_refs: [verifyPayload.routed_step_result_file],
        evidence_summary: {
          finance_signals: {
            capture_latency_sec: 0.9,
            replay_latency_sec: 0.8,
            total_latency_sec: 1.7,
          },
          baseline_comparison: {
            baseline_pass_rate: 0.8,
            candidate_pass_rate: 0.6,
          },
        },
        status: "hold",
      },
    });
    const blockedPromotionRef = `evidence://${path.relative(projectRoot, blockedPromotionFile).replace(/\\/g, "/")}`;
    const rollbackPromotionFile = path.join(
      artifactsRoot,
      `promotion-decision-finance-audit-rollback-${runId.replace(/[^\w.-]+/g, "-")}.json`,
    );
    writeContractFixture({
      family: "promotion-decision",
      filePath: rollbackPromotionFile,
      document: {
        decision_id: `fixture.promotion.finance.rollback.${runId}`,
        run_id: runId,
        subject_ref: "wrapper://wrapper.finance.audit@v1",
        from_channel: "stable",
        to_channel: "demoted",
        evidence_refs: [verifyPayload.routed_step_result_file],
        evidence_summary: {
          finance_signals: {
            capture_latency_sec: 0.4,
            replay_latency_sec: 0.5,
            total_latency_sec: 0.9,
          },
          baseline_comparison: {
            baseline_pass_rate: 0.92,
            candidate_pass_rate: 0.52,
          },
        },
        status: "pass",
        rollout_decision: {
          action: "demote",
          requested_transition: {
            from_channel: "stable",
            to_channel: "demoted",
          },
        },
      },
    });
    const rollbackPromotionRef = `evidence://${path.relative(projectRoot, rollbackPromotionFile).replace(/\\/g, "/")}`;
    const tiedArtifactTimestamp = new Date("2026-01-01T02:00:10.000Z");
    for (const fixturePath of [promotionDecisionFile, blockedPromotionFile, rollbackPromotionFile]) {
      fs.utimesSync(fixturePath, tiedArtifactTimestamp, tiedArtifactTimestamp);
    }

    const incidentOpenResult = invokeCli([
      "incident",
      "open",
      "--project-ref",
      projectRoot,
      "--run-id",
      runId,
      "--summary",
      "release regression requires follow-up",
      "--severity",
      "critical",
      "--linked-asset-refs",
      "evidence://external/manual-note",
    ]);
    assert.equal(incidentOpenResult.exitCode, 0, incidentOpenResult.stderr);
    const incidentOpenPayload = JSON.parse(incidentOpenResult.stdout);
    assert.equal(typeof incidentOpenPayload.incident_id, "string");
    assert.equal(incidentOpenPayload.incident_status, "open");
    assert.equal(incidentOpenPayload.incident_run_ref, `run://${runId}`);
    assert.equal(fs.existsSync(incidentOpenPayload.incident_file), true);
    assert.ok(incidentOpenPayload.incident_linked_asset_refs.includes("evidence://external/manual-note"));
    const incidentDocument = JSON.parse(fs.readFileSync(incidentOpenPayload.incident_file, "utf8"));
    const incidentFixture = JSON.parse(
      fs.readFileSync(path.join(fixturesDir, "incident-report.fixture.json"), "utf8"),
    );
    const recertificationFixture = JSON.parse(
      fs.readFileSync(path.join(fixturesDir, "incident-recertification-branches.fixture.json"), "utf8"),
    );
    const incidentSubset = {
      severity: incidentDocument.severity,
      status: incidentDocument.status,
      linked_run_ref_present: Array.isArray(incidentDocument.linked_run_refs)
        ? incidentDocument.linked_run_refs.includes(`run://${runId}`)
        : false,
      linked_manual_note_present: Array.isArray(incidentDocument.linked_asset_refs)
        ? incidentDocument.linked_asset_refs.includes("evidence://external/manual-note")
        : false,
    };
    assert.deepEqual(incidentSubset, incidentFixture);

    const blockedRecertifyResult = invokeCli([
      "incident",
      "recertify",
      "--project-ref",
      projectRoot,
      "--incident-id",
      incidentOpenPayload.incident_id,
      "--decision",
      "re-enable",
      "--promotion-ref",
      blockedPromotionRef,
    ]);
    assert.equal(blockedRecertifyResult.exitCode, 1);
    assert.equal(blockedRecertifyResult.stdout, "");
    assert.match(
      blockedRecertifyResult.stderr,
      /Re-enable is blocked: promotion decision '.*' has status 'hold' \(requires pass\)\./,
    );

    const holdRecertifyResult = invokeCli([
      "incident",
      "recertify",
      "--project-ref",
      projectRoot,
      "--incident-id",
      incidentOpenPayload.incident_id,
      "--decision",
      "hold",
      "--reason",
      "waiting for approved recertification evidence",
    ]);
    assert.equal(holdRecertifyResult.exitCode, 0, holdRecertifyResult.stderr);
    const holdRecertifyPayload = JSON.parse(holdRecertifyResult.stdout);
    assert.equal(holdRecertifyPayload.incident_status, "hold");
    assert.equal(holdRecertifyPayload.incident_recertification_decision, "hold");
    assert.equal(holdRecertifyPayload.incident_recertification_to_status, "hold");

    const approvedRecertifyResult = invokeCli([
      "incident",
      "recertify",
      "--project-ref",
      projectRoot,
      "--incident-id",
      incidentOpenPayload.incident_id,
      "--decision",
      "re-enable",
      "--promotion-ref",
      promotionDecisionRef,
    ]);
    assert.equal(approvedRecertifyResult.exitCode, 0, approvedRecertifyResult.stderr);
    const approvedRecertifyPayload = JSON.parse(approvedRecertifyResult.stdout);
    assert.equal(approvedRecertifyPayload.incident_status, "re-enabled");
    assert.equal(approvedRecertifyPayload.incident_recertification_decision, "re-enable");
    assert.equal(approvedRecertifyPayload.incident_recertification_gate, recertificationFixture.approved.gate);
    assert.equal(approvedRecertifyPayload.incident_recertification_promotion_ref, promotionDecisionRef);
    assert.equal(
      approvedRecertifyPayload.incident_recertification_platform_linkage,
      recertificationFixture.approved.platform_linkage,
    );
    assert.equal(
      approvedRecertifyPayload.incident_recertification_rollback_required,
      recertificationFixture.approved.rollback_required,
    );
    assert.equal(approvedRecertifyPayload.incident_recertification_finance_evidence_root, reportsRoot);
    assert.equal(approvedRecertifyPayload.incident_recertification_quality_evidence_root, reportsRoot);
    assert.ok(approvedRecertifyPayload.incident_recertification_finance_evidence_refs.length >= 1);
    assert.ok(approvedRecertifyPayload.incident_recertification_quality_evidence_refs.length >= 1);

    const rollbackRecertifyResult = invokeCli([
      "incident",
      "recertify",
      "--project-ref",
      projectRoot,
      "--incident-id",
      incidentOpenPayload.incident_id,
      "--decision",
      "re-enable",
      "--promotion-ref",
      rollbackPromotionRef,
    ]);
    assert.equal(rollbackRecertifyResult.exitCode, 0, rollbackRecertifyResult.stderr);
    const rollbackRecertifyPayload = JSON.parse(rollbackRecertifyResult.stdout);
    assert.equal(rollbackRecertifyPayload.incident_status, recertificationFixture.rollback.incident_status);
    assert.equal(rollbackRecertifyPayload.incident_recertification_decision, "re-enable");
    assert.equal(rollbackRecertifyPayload.incident_recertification_gate, recertificationFixture.rollback.gate);
    assert.equal(
      rollbackRecertifyPayload.incident_recertification_platform_action,
      recertificationFixture.rollback.platform_action,
    );
    assert.equal(
      rollbackRecertifyPayload.incident_recertification_platform_linkage,
      recertificationFixture.rollback.platform_linkage,
    );
    assert.equal(
      rollbackRecertifyPayload.incident_recertification_rollback_required,
      recertificationFixture.rollback.rollback_required,
    );
    assert.equal(
      rollbackRecertifyPayload.incident_recertification_to_status,
      recertificationFixture.rollback.to_status,
    );
    assert.equal(rollbackRecertifyPayload.incident_recertification_finance_evidence_root, reportsRoot);
    assert.equal(rollbackRecertifyPayload.incident_recertification_quality_evidence_root, reportsRoot);
    assert.ok(rollbackRecertifyPayload.incident_recertification_finance_evidence_refs.length >= 1);
    assert.ok(rollbackRecertifyPayload.incident_recertification_quality_evidence_refs.length >= 1);

    const rollbackIncidentDocument = JSON.parse(fs.readFileSync(rollbackRecertifyPayload.incident_file, "utf8"));
    assert.equal(rollbackIncidentDocument.status, "hold");
    assert.equal(rollbackIncidentDocument.recertification.platform_recertification.rollout_action, "demote");
    assert.equal(rollbackIncidentDocument.recertification.platform_recertification.linkage_status, "rollback");
    assert.equal(rollbackIncidentDocument.recertification.platform_recertification.rollback_required, true);
    assert.equal(rollbackIncidentDocument.recertification.finance_evidence_root, reportsRoot);
    assert.equal(rollbackIncidentDocument.recertification.quality_evidence_root, reportsRoot);

    const incidentShowResult = invokeCli([
      "incident",
      "show",
      "--project-ref",
      projectRoot,
      "--incident-id",
      incidentOpenPayload.incident_id,
    ]);
    assert.equal(incidentShowResult.exitCode, 0, incidentShowResult.stderr);
    const incidentShowPayload = JSON.parse(incidentShowResult.stdout);
    assert.equal(Array.isArray(incidentShowPayload.incident_records), true);
    assert.equal(incidentShowPayload.incident_records.length, 1);
    assert.equal(incidentShowPayload.incident_records[0].incident_id, incidentOpenPayload.incident_id);
    assert.ok(incidentShowPayload.incident_records[0].linked_run_refs.includes(`run://${runId}`));

    const auditResult = invokeCli([
      "audit",
      "runs",
      "--project-ref",
      projectRoot,
      "--run-id",
      runId,
    ]);
    assert.equal(auditResult.exitCode, 0, auditResult.stderr);
    const auditPayload = JSON.parse(auditResult.stdout);
    assert.equal(Array.isArray(auditPayload.run_audit_records), true);
    assert.equal(auditPayload.run_audit_records.length, 1);
    assert.equal(auditPayload.run_audit_records[0].run_id, runId);
    assert.ok(Array.isArray(auditPayload.run_audit_records[0].incident_refs));
    assert.ok(auditPayload.run_audit_records[0].incident_refs.length >= 1);
    assert.ok(auditPayload.run_audit_records[0].finance_evidence);
    assert.ok(
      auditPayload.run_audit_records[0].finance_evidence.route_ids.includes("route.finance.audit.fixture"),
    );
    assert.ok(
      auditPayload.run_audit_records[0].finance_evidence.wrapper_refs.includes("wrapper://wrapper.finance.audit@v1"),
    );
    assert.ok(auditPayload.run_audit_records[0].finance_evidence.adapter_ids.includes("adapter.finance.audit"));
    assert.equal(auditPayload.run_audit_records[0].finance_evidence.max_cost_usd, 9999);
    assert.equal(auditPayload.run_audit_records[0].finance_evidence.timeout_sec, 9999);
    assert.equal(auditPayload.run_audit_records[0].finance_evidence.baseline_pass_rate, 0.88);
    assert.equal(auditPayload.run_audit_records[0].finance_evidence.candidate_pass_rate, 0.86);
    assert.ok(auditPayload.run_audit_records[0].finance_evidence.step_latency_sec.samples >= 1);
    assert.ok(auditPayload.run_audit_records[0].finance_evidence.certification_latency_sec.samples >= 3);
    const auditFixture = JSON.parse(
      fs.readFileSync(path.join(fixturesDir, "run-audit-record.fixture.json"), "utf8"),
    );
    const auditSubset = {
      run_ref: auditPayload.run_audit_records[0].run_ref,
      has_incident_refs: auditPayload.run_audit_records[0].incident_refs.length > 0,
      has_evidence_refs: auditPayload.run_audit_records[0].evidence_refs.length > 0,
      has_finance_evidence: typeof auditPayload.run_audit_records[0].finance_evidence === "object",
      has_finance_latency: auditPayload.run_audit_records[0].finance_evidence.step_latency_sec.samples > 0,
    };
    assert.deepEqual(auditSubset, auditFixture);

    const missingIncidentResult = invokeCli([
      "incident",
      "show",
      "--project-ref",
      projectRoot,
      "--incident-id",
      "missing-incident-id",
    ]);
    assert.equal(missingIncidentResult.exitCode, 1);
    assert.equal(missingIncidentResult.stdout, "");
    assert.match(missingIncidentResult.stderr, /Incident 'missing-incident-id' was not found\./);

    const missingAuditRunResult = invokeCli([
      "audit",
      "runs",
      "--project-ref",
      projectRoot,
      "--run-id",
      "missing-run-id",
    ]);
    assert.equal(missingAuditRunResult.exitCode, 1);
    assert.equal(missingAuditRunResult.stdout, "");
    assert.match(missingAuditRunResult.stderr, /Run 'missing-run-id' was not found for audit output\./);

    const transcriptFixture = JSON.parse(
      fs.readFileSync(path.join(fixturesDir, "incident-audit-transcript.json"), "utf8"),
    );
    const transcriptSubset = {
      incident_open: {
        command: incidentOpenPayload.command,
        status: incidentOpenPayload.status,
        incident_status: incidentOpenPayload.incident_status,
      },
      incident_show: {
        command: incidentShowPayload.command,
        status: incidentShowPayload.status,
        record_count: incidentShowPayload.incident_records.length,
      },
      incident_recertify: {
        command: approvedRecertifyPayload.command,
        status: approvedRecertifyPayload.status,
        incident_status: approvedRecertifyPayload.incident_status,
      },
      audit_runs: {
        command: auditPayload.command,
        status: auditPayload.status,
        record_count: auditPayload.run_audit_records.length,
      },
    };
    assert.deepEqual(transcriptSubset, transcriptFixture);
  });
});

test("operator commands inspect runs, packets, and evidence through shared control-plane surfaces", () => {
  withTempProject((projectRoot) => {
    fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
    fs.cpSync(path.join(workspaceRoot, "examples"), path.join(projectRoot, "examples"), { recursive: true });

    const verifyResult = invokeCli([
      "project",
      "verify",
      "--project-ref",
      projectRoot,
      "--routed-dry-run-step",
      "implement",
    ]);
    assert.equal(verifyResult.exitCode, 0, verifyResult.stderr);
    const verifyPayload = JSON.parse(verifyResult.stdout);
    const routedStepResult = JSON.parse(fs.readFileSync(verifyPayload.routed_step_result_file, "utf8"));
    const runId = routedStepResult.run_id;

    appendRunEvent({
      projectRef: projectRoot,
      cwd: projectRoot,
      runId,
      eventType: "run.started",
      payload: {
        stage: "bootstrap",
      },
    });
    appendRunEvent({
      projectRef: projectRoot,
      cwd: projectRoot,
      runId,
      eventType: "step.updated",
      payload: {
        step_id: "runner.implement",
        status: "pass",
      },
    });

    const runStatusResult = invokeCli([
      "run",
      "status",
      "--project-ref",
      projectRoot,
      "--run-id",
      runId,
      "--follow",
      "true",
      "--max-replay",
      "10",
    ]);
    assert.equal(runStatusResult.exitCode, 0, runStatusResult.stderr);
    const runStatusPayload = JSON.parse(runStatusResult.stdout);
    assert.ok(runStatusPayload.run_summaries.some((summary) => summary.run_id === runId));
    assert.equal(runStatusPayload.follow_mode.enabled, true);
    assert.equal(runStatusPayload.stream_protocol, "sse");
    assert.equal(runStatusPayload.stream_backpressure.policy, "bounded-replay-window");
    assert.deepEqual(
      runStatusPayload.replay_events.map((event) => event.event_type),
      ["run.started", "step.updated"],
    );
    assert.equal(runStatusPayload.run_event_history.run_id, runId);
    assert.equal(runStatusPayload.run_event_history.total_events, 2);
    assert.equal(runStatusPayload.run_policy_history.run_id, runId);
    assert.ok(runStatusPayload.run_policy_history.entry_count >= 1);
    assert.ok(
      runStatusPayload.run_policy_history.entries.some(
        (entry) => entry.route_id === "route.implement.default" && entry.policy_id === "policy.step.runner.default",
      ),
    );
    const selectedRunSummary = runStatusPayload.run_summaries.find((summary) => summary.run_id === runId);
    assert.ok(selectedRunSummary);
    assert.ok(Array.isArray(selectedRunSummary.policy_context.policy_ids));
    assert.ok(selectedRunSummary.policy_context.policy_ids.includes("policy.step.runner.default"));
    assert.equal(typeof runStatusPayload.strategic_snapshot, "object");
    assert.ok(Array.isArray(runStatusPayload.strategic_snapshot.wave_snapshot.waves));
    assert.equal(typeof runStatusPayload.strategic_snapshot.risk_snapshot.level_totals.high, "number");
    assert.equal(runStatusPayload.read_only, true);
    assert.ok(runStatusPayload.future_control_hooks.includes("run pause"));

    const prepareResult = invokeCli(["handoff", "prepare", "--project-ref", projectRoot]);
    assert.equal(prepareResult.exitCode, 0, prepareResult.stderr);

    const packetResult = invokeCli([
      "packet",
      "show",
      "--project-ref",
      projectRoot,
      "--family",
      "wave-ticket",
      "--limit",
      "1",
    ]);
    assert.equal(packetResult.exitCode, 0, packetResult.stderr);
    const packetPayload = JSON.parse(packetResult.stdout);
    assert.equal(packetPayload.selected_family, "wave-ticket");
    assert.equal(packetPayload.read_only, true);
    assert.equal(packetPayload.packet_artifacts.length, 1);
    assert.equal(packetPayload.packet_artifacts[0].family, "wave-ticket");

    const evalResult = invokeCli([
      "eval",
      "run",
      "--project-ref",
      projectRoot,
      "--suite-ref",
      "suite.release.core@v1",
      "--subject-ref",
      "run://operator-cli-smoke",
    ]);
    assert.equal(evalResult.exitCode, 0, evalResult.stderr);

    const certifyResult = invokeCli([
      "harness",
      "certify",
      "--project-ref",
      projectRoot,
      "--asset-ref",
      "wrapper://wrapper.eval.default@v1",
      "--subject-ref",
      "wrapper://wrapper.eval.default@v1",
      "--suite-ref",
      "suite.cert.core@v4",
    ]);
    assert.equal(certifyResult.exitCode, 0, certifyResult.stderr);

    const evidenceResult = invokeCli(["evidence", "show", "--project-ref", projectRoot]);
    assert.equal(evidenceResult.exitCode, 0, evidenceResult.stderr);
    const evidencePayload = JSON.parse(evidenceResult.stdout);
    assert.ok(Array.isArray(evidencePayload.step_results));
    assert.ok(Array.isArray(evidencePayload.quality_artifacts));
    assert.ok(Array.isArray(evidencePayload.promotion_decisions));
    assert.equal(evidencePayload.read_only, true);
    assert.ok(evidencePayload.future_control_hooks.includes("incident open"));

    const transcriptFixture = JSON.parse(
      fs.readFileSync(path.join(fixturesDir, "operator-cli-transcript.json"), "utf8"),
    );
    const transcriptSubset = {
      run_status: {
        command: runStatusPayload.command,
        status: runStatusPayload.status,
        read_only: runStatusPayload.read_only,
        stream_protocol: runStatusPayload.stream_protocol,
        run_event_history_total: runStatusPayload.run_event_history.total_events,
        run_policy_history_entries: runStatusPayload.run_policy_history.entry_count,
      },
      packet_show: {
        command: packetPayload.command,
        status: packetPayload.status,
        selected_family: packetPayload.selected_family,
        read_only: packetPayload.read_only,
      },
      evidence_show: {
        command: evidencePayload.command,
        status: evidencePayload.status,
        read_only: evidencePayload.read_only,
      },
    };
    assert.deepEqual(transcriptSubset, transcriptFixture);
  });
});

test("project verify resolves runtime root and contract metadata", () => {
  withTempProject((projectRoot) => {
    fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
    fs.cpSync(path.join(workspaceRoot, "examples"), path.join(projectRoot, "examples"), { recursive: true });
    const result = invokeCli(["project", "verify", "--project-ref", projectRoot]);

    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");

    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.command, "project verify");
    assert.equal(parsed.status, "implemented");
    assert.equal(parsed.resolved_project_ref, projectRoot);
    assert.equal(parsed.resolved_runtime_root, path.join(projectRoot, ".aor"));
    assert.equal(parsed.command_catalog_alignment, "docs/architecture/14-cli-command-catalog.md");
    assert.equal(fs.existsSync(parsed.verify_summary_file), true);
    assert.ok(Array.isArray(parsed.step_result_files));
    assert.ok(parsed.step_result_files.length > 0);
    assert.ok(parsed.step_result_files.every((filePath) => fs.existsSync(filePath)));
    const verifySummary = JSON.parse(fs.readFileSync(parsed.verify_summary_file, "utf8"));
    assert.deepEqual(verifySummary.preflight_safety.sequence, [
      "clone",
      "inspect",
      "analyze",
      "validate",
      "verify",
      "stop",
    ]);
    assert.equal(verifySummary.preflight_safety.workspace_mode, "ephemeral");
    assert.equal(verifySummary.preflight_safety.network_mode, "deny-by-default");
    assert.ok(Array.isArray(verifySummary.command_owners));
    assert.ok(verifySummary.command_owners.includes("main"));
    assert.equal(verifySummary.reusable_by.bootstrap_rehearsal, true);
    assert.equal(verifySummary.reusable_by.quality_rehearsal, true);
    assert.equal(verifySummary.reusable_by.delivery_rehearsal, true);
    assert.equal(verifySummary.reusable_by.source_runbook, "docs/ops/live-e2e-no-write-preflight.md");

    assert.deepEqual(parsed.contract_families, [
      {
        family: "step-result",
        group: "execution-and-quality",
        source_contract: "docs/contracts/step-result.md",
        status: "implemented",
      },
    ]);
  });
});

test("project verify supports routed dry-run smoke execution with compiled-context linkage", () => {
  withTempProject((projectRoot) => {
    fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
    fs.cpSync(path.join(workspaceRoot, "examples"), path.join(projectRoot, "examples"), { recursive: true });

    for (const stepClass of ["implement", "review", "qa"]) {
      const result = invokeCli([
        "project",
        "verify",
        "--project-ref",
        projectRoot,
        "--routed-dry-run-step",
        stepClass,
      ]);

      assert.equal(result.exitCode, 0, result.stderr);
      const parsed = JSON.parse(result.stdout);
      assert.equal(typeof parsed.routed_step_result_id, "string");
      assert.equal(fs.existsSync(parsed.routed_step_result_file), true);
      assert.ok(parsed.step_result_files.includes(parsed.routed_step_result_file));

      const routedStepResult = JSON.parse(fs.readFileSync(parsed.routed_step_result_file, "utf8"));
      assert.equal(routedStepResult.step_class, "runner");
      assert.equal(routedStepResult.status, "passed");
      assert.equal(routedStepResult.routed_execution.mode, "dry-run");
      assert.equal(routedStepResult.routed_execution.no_write_enforced, true);
      assert.equal(routedStepResult.routed_execution.route_resolution.step_class, stepClass);
      assert.equal(routedStepResult.routed_execution.delivery_plan.delivery_mode, "fork-first-pr");
      assert.equal(routedStepResult.routed_execution.delivery_plan.status, "blocked");
      assert.equal(
        fs.existsSync(routedStepResult.routed_execution.delivery_plan.delivery_plan_file),
        true,
      );
      assert.equal(routedStepResult.routed_execution.adapter_resolution.adapter.adapter_id, "codex-cli");
      assert.equal(routedStepResult.routed_execution.adapter_response.adapter_id, "mock-runner");
      assert.equal(typeof routedStepResult.routed_execution.context_compilation.compiled_context_ref, "string");
      assert.match(
        routedStepResult.routed_execution.context_compilation.compiled_context_ref,
        /^compiled-context:\/\//u,
      );
      assert.equal(
        fs.existsSync(routedStepResult.routed_execution.context_compilation.compiled_context_file),
        true,
      );
      assert.equal(
        routedStepResult.routed_execution.adapter_request.context.compiled_context_ref,
        routedStepResult.routed_execution.context_compilation.compiled_context_ref,
      );
      assert.ok(
        routedStepResult.evidence_refs.includes(
          routedStepResult.routed_execution.context_compilation.compiled_context_ref,
        ),
      );
    }
  });
});

test("project verify supports routed live execution baseline when delivery evidence is provided", () => {
  withTempProject((projectRoot) => {
    fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
    fs.cpSync(path.join(workspaceRoot, "examples"), path.join(projectRoot, "examples"), { recursive: true });
    configureCodexExternalRuntime({
      projectRoot,
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
          "output:{runner:'node-inline',step_class:request.step_class||null},",
          "evidence_refs:['evidence://external-runner/project-verify-live-success'],",
          "tool_traces:[{phase:'invoke_adapter',kind:'external-runner-mock',detail:'node-inline'}]",
          "}));",
        ].join(""),
      ],
    });

    const result = invokeCli([
      "project",
      "verify",
      "--project-ref",
      projectRoot,
      "--routed-live-step",
      "implement",
      "--approved-handoff-ref",
      "evidence://handoff/live-approved",
      "--promotion-evidence-refs",
      "evidence://promotion/live-pass",
    ]);

    assert.equal(result.exitCode, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(typeof parsed.routed_step_result_id, "string");
    assert.equal(fs.existsSync(parsed.routed_step_result_file), true);

    const routedStepResult = JSON.parse(fs.readFileSync(parsed.routed_step_result_file, "utf8"));
    assert.equal(routedStepResult.step_class, "runner");
    assert.equal(routedStepResult.status, "passed");
    assert.equal(routedStepResult.routed_execution.mode, "execute");
    assert.equal(routedStepResult.routed_execution.no_write_enforced, false);
    assert.equal(routedStepResult.routed_execution.delivery_plan.status, "ready");
    assert.equal(routedStepResult.routed_execution.delivery_plan.writeback_allowed, true);
    assert.equal(routedStepResult.routed_execution.adapter_resolution.adapter.adapter_id, "codex-cli");
    assert.equal(routedStepResult.routed_execution.adapter_request.dry_run, false);
    assert.equal(routedStepResult.routed_execution.adapter_response.adapter_id, "codex-cli");
    assert.equal(routedStepResult.routed_execution.adapter_response.status, "success");
    assert.equal(routedStepResult.routed_execution.adapter_response.output.mode, "execute");
    assert.equal(
      routedStepResult.routed_execution.adapter_response.output.external_runner.command,
      process.execPath,
    );
    assert.equal(
      routedStepResult.routed_execution.adapter_response.output.external_runner.execution_root,
      projectRoot,
    );
    assert.ok(
      routedStepResult.routed_execution.adapter_response.evidence_refs.includes(
        "evidence://external-runner/project-verify-live-success",
      ),
    );

    const fixture = JSON.parse(
      fs.readFileSync(path.join(fixturesDir, "project-verify-routed-live-smoke.json"), "utf8"),
    );
    const subset = {
      status: routedStepResult.status,
      mode: routedStepResult.routed_execution.mode,
      no_write_enforced: routedStepResult.routed_execution.no_write_enforced,
      delivery_plan_status: routedStepResult.routed_execution.delivery_plan.status,
      delivery_plan_writeback_allowed: routedStepResult.routed_execution.delivery_plan.writeback_allowed,
      adapter_id: routedStepResult.routed_execution.adapter_response.adapter_id,
      adapter_status: routedStepResult.routed_execution.adapter_response.status,
      adapter_output_mode: routedStepResult.routed_execution.adapter_response.output.mode,
    };
    assert.deepEqual(subset, fixture);
  });
});

test("project verify routed live execution blocks with explicit guardrails when evidence is missing", () => {
  withTempProject((projectRoot) => {
    fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
    fs.cpSync(path.join(workspaceRoot, "examples"), path.join(projectRoot, "examples"), { recursive: true });

    const result = invokeCli([
      "project",
      "verify",
      "--project-ref",
      projectRoot,
      "--routed-live-step",
      "implement",
    ]);

    assert.equal(result.exitCode, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(fs.existsSync(parsed.routed_step_result_file), true);

    const routedStepResult = JSON.parse(fs.readFileSync(parsed.routed_step_result_file, "utf8"));
    assert.equal(routedStepResult.status, "failed");
    assert.equal(routedStepResult.routed_execution.mode, "execute");
    assert.match(routedStepResult.summary, /delivery guardrails/i);
    assert.equal(routedStepResult.routed_execution.adapter_response.status, "blocked");
    assert.ok(
      routedStepResult.routed_execution.adapter_response.output.blocking_reasons.includes("approved-handoff-required"),
    );
    assert.ok(
      routedStepResult.routed_execution.adapter_response.output.blocking_reasons.includes("promotion-evidence-required"),
    );

    const fixture = JSON.parse(
      fs.readFileSync(path.join(fixturesDir, "project-verify-routed-live-blocked-smoke.json"), "utf8"),
    );
    const subset = {
      status: routedStepResult.status,
      mode: routedStepResult.routed_execution.mode,
      adapter_status: routedStepResult.routed_execution.adapter_response.status,
      has_approved_handoff_required: routedStepResult.routed_execution.adapter_response.output.blocking_reasons.includes(
        "approved-handoff-required",
      ),
      has_promotion_evidence_required: routedStepResult.routed_execution.adapter_response.output.blocking_reasons.includes(
        "promotion-evidence-required",
      ),
    };
    assert.deepEqual(subset, fixture);
  });
});

test("project verify routed live execution reports missing external runner prerequisites", () => {
  withTempProject((projectRoot) => {
    fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
    fs.cpSync(path.join(workspaceRoot, "examples"), path.join(projectRoot, "examples"), { recursive: true });
    configureCodexExternalRuntime({
      projectRoot,
      command: "__aor_missing_runner_command__",
      args: [],
    });

    const result = invokeCli([
      "project",
      "verify",
      "--project-ref",
      projectRoot,
      "--routed-live-step",
      "implement",
      "--approved-handoff-ref",
      "evidence://handoff/live-approved",
      "--promotion-evidence-refs",
      "evidence://promotion/live-pass",
    ]);

    assert.equal(result.exitCode, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(fs.existsSync(parsed.routed_step_result_file), true);

    const routedStepResult = JSON.parse(fs.readFileSync(parsed.routed_step_result_file, "utf8"));
    assert.equal(routedStepResult.status, "failed");
    assert.equal(routedStepResult.routed_execution.mode, "execute");
    assert.equal(routedStepResult.routed_execution.adapter_response.status, "blocked");
    assert.equal(
      routedStepResult.routed_execution.adapter_response.output.failure_kind,
      "missing-prerequisite",
    );
    assert.match(
      String(routedStepResult.routed_execution.blocked_next_step),
      /Install\/configure external runner prerequisites/i,
    );
  });
});

test("eval run executes offline suite and persists evaluation report", () => {
  withTempProject((projectRoot) => {
    fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
    fs.cpSync(path.join(workspaceRoot, "examples"), path.join(projectRoot, "examples"), { recursive: true });

    const smokeFixture = JSON.parse(
      fs.readFileSync(path.join(fixturesDir, "eval-run-smoke-transcript.json"), "utf8"),
    );
    const result = invokeCli([
      "eval",
      "run",
      "--project-ref",
      projectRoot,
      "--suite-ref",
      "suite.release.core@v1",
      "--subject-ref",
      "run://smoke-target",
    ]);

    assert.equal(result.exitCode, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(typeof parsed.evaluation_report_id, "string");
    assert.equal(fs.existsSync(parsed.evaluation_report_file), true);

    const evaluationReport = JSON.parse(fs.readFileSync(parsed.evaluation_report_file, "utf8"));
    assert.equal(evaluationReport.suite_ref, "suite.release.core@v1");
    assert.equal(evaluationReport.subject_ref, "run://smoke-target");
    assert.equal(Array.isArray(evaluationReport.scorer_metadata), true);
    assert.equal(typeof evaluationReport.summary_metrics, "object");

    const smokeSubset = {
      command: parsed.command,
      status: parsed.status,
      evaluation_status: parsed.evaluation_status,
      evaluation_blocking: parsed.evaluation_blocking,
      evaluation_suite_ref: parsed.evaluation_suite_ref,
      evaluation_subject_ref: parsed.evaluation_subject_ref,
    };
    assert.deepEqual(smokeSubset, smokeFixture);
  });
});

test("harness replay replays a capture and writes durable replay evidence", () => {
  withTempProject((projectRoot) => {
    fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
    fs.cpSync(path.join(workspaceRoot, "examples"), path.join(projectRoot, "examples"), { recursive: true });

    const fixture = JSON.parse(
      fs.readFileSync(path.join(fixturesDir, "harness-replay-transcript.json"), "utf8"),
    );

    const certifyResult = invokeCli([
      "harness",
      "certify",
      "--project-ref",
      projectRoot,
      "--asset-ref",
      "wrapper://wrapper.eval.default@v1",
      "--subject-ref",
      "wrapper://wrapper.eval.default@v1",
      "--suite-ref",
      "suite.cert.core@v4",
      "--step-class",
      "implement",
    ]);
    assert.equal(certifyResult.exitCode, 0, certifyResult.stderr);
    const certifyPayload = JSON.parse(certifyResult.stdout);

    const replayResult = invokeCli([
      "harness",
      "replay",
      "--project-ref",
      projectRoot,
      "--capture-file",
      certifyPayload.certification_harness_capture_file,
    ]);

    assert.equal(replayResult.exitCode, 0, replayResult.stderr);
    const replayPayload = JSON.parse(replayResult.stdout);
    assert.equal(typeof replayPayload.harness_replay_id, "string");
    assert.equal(replayPayload.harness_replay_status, "pass");
    assert.equal(replayPayload.harness_replay_compatible, true);
    assert.equal(fs.existsSync(replayPayload.harness_replay_file), true);
    assert.equal(fs.existsSync(replayPayload.harness_replay_evaluation_report_file), true);
    assert.ok(Array.isArray(replayPayload.harness_replay_evidence_refs));
    assert.equal(replayPayload.harness_replay_evidence_refs.length > 0, true);

    const transcriptSubset = {
      command: replayPayload.command,
      status: replayPayload.status,
      harness_replay_status: replayPayload.harness_replay_status,
      harness_replay_compatible: replayPayload.harness_replay_compatible,
    };
    assert.deepEqual(transcriptSubset, fixture);
  });
});

test("harness replay reports incompatible captures with explicit blocked-next-step guidance", () => {
  withTempProject((projectRoot) => {
    fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
    fs.cpSync(path.join(workspaceRoot, "examples"), path.join(projectRoot, "examples"), { recursive: true });

    const reportFixture = JSON.parse(
      fs.readFileSync(path.join(fixturesDir, "harness-replay-report.fixture.json"), "utf8"),
    );

    const certifyResult = invokeCli([
      "harness",
      "certify",
      "--project-ref",
      projectRoot,
      "--asset-ref",
      "wrapper://wrapper.eval.default@v1",
      "--subject-ref",
      "wrapper://wrapper.eval.default@v1",
      "--suite-ref",
      "suite.cert.core@v4",
      "--step-class",
      "implement",
    ]);
    assert.equal(certifyResult.exitCode, 0, certifyResult.stderr);
    const certifyPayload = JSON.parse(certifyResult.stdout);

    const capture = JSON.parse(fs.readFileSync(certifyPayload.certification_harness_capture_file, "utf8"));
    capture.compatibility.route_id = "route://mismatched-route@v0";
    fs.writeFileSync(
      certifyPayload.certification_harness_capture_file,
      `${JSON.stringify(capture, null, 2)}\n`,
      "utf8",
    );

    const replayResult = invokeCli([
      "harness",
      "replay",
      "--project-ref",
      projectRoot,
      "--capture-file",
      certifyPayload.certification_harness_capture_file,
    ]);

    assert.equal(replayResult.exitCode, 0, replayResult.stderr);
    const replayPayload = JSON.parse(replayResult.stdout);
    assert.equal(replayPayload.harness_replay_status, "incompatible");
    assert.equal(replayPayload.harness_replay_compatible, false);
    assert.equal(fs.existsSync(replayPayload.harness_replay_file), true);
    assert.equal(replayPayload.harness_replay_evaluation_report_file, null);

    const replayReport = JSON.parse(fs.readFileSync(replayPayload.harness_replay_file, "utf8"));
    const reportSubset = {
      status: replayReport.status,
      compatibility: {
        compatible: replayReport.compatibility.compatible,
      },
      blocked_next_step: replayReport.blocked_next_step,
    };
    assert.deepEqual(reportSubset, reportFixture);
  });
});

test("asset promote writes durable promotion decision with promote rollout semantics", () => {
  withTempProject((projectRoot) => {
    fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
    fs.cpSync(path.join(workspaceRoot, "examples"), path.join(projectRoot, "examples"), { recursive: true });

    const transcriptFixture = JSON.parse(
      fs.readFileSync(path.join(fixturesDir, "asset-promote-transcript.json"), "utf8"),
    );
    const decisionFixture = JSON.parse(
      fs.readFileSync(path.join(fixturesDir, "asset-promote-decision.fixture.json"), "utf8"),
    );

    const result = invokeCli([
      "asset",
      "promote",
      "--project-ref",
      projectRoot,
      "--asset-ref",
      "wrapper://wrapper.eval.default@v1",
      "--subject-ref",
      "wrapper://wrapper.eval.default@v1",
      "--suite-ref",
      "suite.cert.core@v4",
    ]);

    assert.equal(result.exitCode, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.promotion_decision_status, "pass");
    assert.equal(payload.promotion_from_channel, "candidate");
    assert.equal(payload.promotion_to_channel, "stable");
    assert.equal(payload.promotion_rollout_action, "promote");
    assert.equal(fs.existsSync(payload.promotion_decision_file), true);

    const transcriptSubset = {
      command: payload.command,
      status: payload.status,
      promotion_decision_status: payload.promotion_decision_status,
      promotion_rollout_action: payload.promotion_rollout_action,
    };
    assert.deepEqual(transcriptSubset, transcriptFixture);

    const decision = JSON.parse(fs.readFileSync(payload.promotion_decision_file, "utf8"));
    const decisionSubset = {
      status: decision.status,
      from_channel: decision.from_channel,
      to_channel: decision.to_channel,
      rollout_action: decision.evidence_summary.rollout_decision.action,
    };
    assert.deepEqual(decisionSubset, decisionFixture);
  });
});

test("asset freeze defaults to hold when freeze guardrail evidence is missing", () => {
  withTempProject((projectRoot) => {
    fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
    fs.cpSync(path.join(workspaceRoot, "examples"), path.join(projectRoot, "examples"), { recursive: true });

    const transcriptFixture = JSON.parse(
      fs.readFileSync(path.join(fixturesDir, "asset-freeze-transcript.json"), "utf8"),
    );
    const decisionFixture = JSON.parse(
      fs.readFileSync(path.join(fixturesDir, "asset-freeze-decision.fixture.json"), "utf8"),
    );

    const result = invokeCli([
      "asset",
      "freeze",
      "--project-ref",
      projectRoot,
      "--asset-ref",
      "wrapper://wrapper.eval.default@v1",
      "--subject-ref",
      "wrapper://wrapper.eval.default@v1",
      "--suite-ref",
      "suite.cert.core@v4",
    ]);

    assert.equal(result.exitCode, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.promotion_decision_status, "hold");
    assert.equal(payload.promotion_from_channel, "stable");
    assert.equal(payload.promotion_to_channel, "frozen");
    assert.equal(payload.promotion_rollout_action, "hold");
    assert.equal(fs.existsSync(payload.promotion_decision_file), true);

    const transcriptSubset = {
      command: payload.command,
      status: payload.status,
      promotion_decision_status: payload.promotion_decision_status,
      promotion_rollout_action: payload.promotion_rollout_action,
    };
    assert.deepEqual(transcriptSubset, transcriptFixture);

    const decision = JSON.parse(fs.readFileSync(payload.promotion_decision_file, "utf8"));
    const freezeGuardrailCheck = decision.evidence_summary.governance_checks.find(
      (entry) => entry.check_id === "freeze-channel-guardrail",
    );
    const decisionSubset = {
      status: decision.status,
      to_channel: decision.to_channel,
      rollout_action: decision.evidence_summary.rollout_decision.action,
      freeze_guardrail_status: freezeGuardrailCheck?.status ?? null,
    };
    assert.deepEqual(decisionSubset, decisionFixture);
  });
});

test("asset promote reports fail status when evaluative evidence regresses", () => {
  withTempProject((projectRoot) => {
    fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
    fs.cpSync(path.join(workspaceRoot, "examples"), path.join(projectRoot, "examples"), { recursive: true });

    const datasetPath = path.join(projectRoot, "examples/eval/dataset-wrapper-certification.yaml");
    const dataset = fs.readFileSync(datasetPath, "utf8");
    fs.writeFileSync(
      datasetPath,
      dataset.replace(
        "expected_ref: evidence://datasets/wrapper-certification/CASE-WRAP-0023/expected.json",
        'expected_ref: ""',
      ),
      "utf8",
    );

    const result = invokeCli([
      "asset",
      "promote",
      "--project-ref",
      projectRoot,
      "--asset-ref",
      "wrapper://wrapper.eval.default@v1",
      "--subject-ref",
      "wrapper://wrapper.eval.default@v1",
      "--suite-ref",
      "suite.cert.core@v4",
    ]);

    assert.equal(result.exitCode, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.promotion_decision_status, "fail");
    assert.equal(payload.promotion_rollout_action, "reject");
  });
});

test("asset freeze keeps freeze rollout action when regression evidence exists", () => {
  withTempProject((projectRoot) => {
    fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
    fs.cpSync(path.join(workspaceRoot, "examples"), path.join(projectRoot, "examples"), { recursive: true });

    const datasetPath = path.join(projectRoot, "examples/eval/dataset-wrapper-certification.yaml");
    const dataset = fs.readFileSync(datasetPath, "utf8");
    fs.writeFileSync(
      datasetPath,
      dataset.replace(
        "expected_ref: evidence://datasets/wrapper-certification/CASE-WRAP-0023/expected.json",
        'expected_ref: ""',
      ),
      "utf8",
    );

    const result = invokeCli([
      "asset",
      "freeze",
      "--project-ref",
      projectRoot,
      "--asset-ref",
      "wrapper://wrapper.eval.default@v1",
      "--subject-ref",
      "wrapper://wrapper.eval.default@v1",
      "--suite-ref",
      "suite.cert.core@v4",
    ]);

    assert.equal(result.exitCode, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.promotion_decision_status, "fail");
    assert.equal(payload.promotion_rollout_action, "freeze");
  });
});

test("harness certify writes durable promotion decision with explicit evidence set", () => {
  withTempProject((projectRoot) => {
    fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
    fs.cpSync(path.join(workspaceRoot, "examples"), path.join(projectRoot, "examples"), { recursive: true });

    const smokeFixture = JSON.parse(
      fs.readFileSync(path.join(fixturesDir, "harness-certify-transcript.json"), "utf8"),
    );

    const result = invokeCli([
      "harness",
      "certify",
      "--project-ref",
      projectRoot,
      "--asset-ref",
      "wrapper://wrapper.eval.default@v1",
      "--subject-ref",
      "wrapper://wrapper.eval.default@v1",
      "--suite-ref",
      "suite.cert.core@v4",
      "--step-class",
      "implement",
    ]);

    assert.equal(result.exitCode, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(typeof parsed.promotion_decision_id, "string");
    assert.equal(fs.existsSync(parsed.promotion_decision_file), true);
    assert.equal(fs.existsSync(parsed.certification_evaluation_report_file), true);
    assert.equal(fs.existsSync(parsed.certification_harness_capture_file), true);
    assert.equal(fs.existsSync(parsed.certification_harness_replay_file), true);

    const decision = JSON.parse(fs.readFileSync(parsed.promotion_decision_file, "utf8"));
    assert.equal(decision.subject_ref, "wrapper://wrapper.eval.default@v1");
    assert.equal(decision.status, "pass");
    assert.equal(typeof decision.evidence_summary, "object");
    assert.ok(Array.isArray(decision.evidence_refs));
    assert.ok(decision.evidence_refs.length >= 3);
    assert.equal(decision.evidence_summary.evaluation_status, "pass");
    assert.equal(decision.evidence_summary.harness_replay_status, "pass");

    const smokeSubset = {
      command: parsed.command,
      status: parsed.status,
      promotion_decision_status: parsed.promotion_decision_status,
    };
    assert.deepEqual(smokeSubset, smokeFixture);
  });
});

test("harness certify exposes context lifecycle evidence for context asset promotion", () => {
  withTempProject((projectRoot) => {
    fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
    fs.cpSync(path.join(workspaceRoot, "examples"), path.join(projectRoot, "examples"), { recursive: true });

    const result = invokeCli([
      "harness",
      "certify",
      "--project-ref",
      projectRoot,
      "--asset-ref",
      "context-bundle://context.bundle.runner.foundation@v1",
      "--subject-ref",
      "wrapper://wrapper.eval.default@v1",
      "--suite-ref",
      "suite.cert.core@v4",
      "--step-class",
      "implement",
    ]);

    assert.equal(result.exitCode, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.promotion_decision_status, "pass");
    assert.equal(fs.existsSync(parsed.promotion_decision_file), true);

    const decision = JSON.parse(fs.readFileSync(parsed.promotion_decision_file, "utf8"));
    const lifecycle = decision.evidence_summary.context_lifecycle;
    assert.equal(typeof lifecycle, "object");
    assert.equal(lifecycle.context_asset_ref, "context-bundle://context.bundle.runner.foundation@v1");
    assert.equal(lifecycle.quality_comparison.comparison_ready, true);
    assert.equal(Array.isArray(lifecycle.immutable_provenance_refs), true);
    assert.equal(lifecycle.immutable_provenance_refs.length > 0, true);

    const evidenceResult = invokeCli(["evidence", "show", "--project-ref", projectRoot]);
    assert.equal(evidenceResult.exitCode, 0, evidenceResult.stderr);
    const evidencePayload = JSON.parse(evidenceResult.stdout);
    const contextPromotion = evidencePayload.promotion_decisions.find(
      (artifact) => artifact.document.subject_ref === "context-bundle://context.bundle.runner.foundation@v1",
    );
    assert.ok(contextPromotion);
    assert.equal(
      contextPromotion.document.evidence_summary.context_lifecycle.context_asset_version,
      1,
    );
  });
});

test("project init discovers repo root from cwd and materializes runtime layout idempotently", () => {
  withTempProject((projectRoot) => {
    fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, "examples"), { recursive: true });
    fs.copyFileSync(
      path.join(workspaceRoot, "examples/project.aor.yaml"),
      path.join(projectRoot, "examples/project.aor.yaml"),
    );

    const nestedCwd = path.join(projectRoot, "nested", "workspace");
    fs.mkdirSync(nestedCwd, { recursive: true });

    const firstRun = invokeCli(["project", "init"], { cwd: nestedCwd });
    const secondRun = invokeCli(["project", "init"], { cwd: nestedCwd });

    assert.equal(firstRun.exitCode, 0, firstRun.stderr);
    assert.equal(secondRun.exitCode, 0, secondRun.stderr);

    const firstPayload = JSON.parse(firstRun.stdout);
    const secondPayload = JSON.parse(secondRun.stdout);

    assert.equal(firstPayload.resolved_project_ref, projectRoot);
    assert.equal(secondPayload.resolved_project_ref, projectRoot);
    assert.equal(firstPayload.project_profile_ref, "examples/project.aor.yaml");
    assert.equal(secondPayload.project_profile_ref, "examples/project.aor.yaml");
    assert.equal(firstPayload.runtime_state_file, secondPayload.runtime_state_file);
    assert.equal(fs.existsSync(firstPayload.runtime_state_file), true);
    assert.equal(firstPayload.artifact_packet_id, "aor-core.artifact.bootstrap.v1");
    assert.equal(firstPayload.artifact_packet_file, secondPayload.artifact_packet_file);
    assert.equal(fs.existsSync(firstPayload.artifact_packet_file), true);

    const runtimeState = JSON.parse(fs.readFileSync(firstPayload.runtime_state_file, "utf8"));
    assert.equal(runtimeState.project_id, "aor-core");
    assert.equal(runtimeState.selected_profile_ref, "examples/project.aor.yaml");
    assert.equal(runtimeState.project_root, projectRoot);

    const artifactPacket = JSON.parse(fs.readFileSync(firstPayload.artifact_packet_file, "utf8"));
    assert.equal(artifactPacket.packet_id, "aor-core.artifact.bootstrap.v1");
    assert.equal(artifactPacket.project_id, "aor-core");
    assert.equal(artifactPacket.packet_type, "bootstrap");
  });
});

test("project init materializes bundled bootstrap profile and assets idempotently for a clean target repo", () => {
  withTempProject((projectRoot) => {
    runGitChecked({ cwd: projectRoot, args: ["init"] });
    runGitChecked({ cwd: projectRoot, args: ["config", "user.email", "aor@example.com"] });
    runGitChecked({ cwd: projectRoot, args: ["config", "user.name", "AOR Test"] });
    fs.writeFileSync(path.join(projectRoot, "README.md"), "# clean repo\n", "utf8");
    fs.writeFileSync(
      path.join(projectRoot, "package.json"),
      JSON.stringify({ name: "clean-target", scripts: { lint: "eslint .", test: "node --test", build: "tsc -b" } }, null, 2),
      "utf8",
    );

    withBootstrapAssetsEnv(() => {
      const firstRun = invokeCli([
        "project",
        "init",
        "--project-ref",
        projectRoot,
        "--materialize-project-profile",
        "--materialize-bootstrap-assets",
        "--repo-build-command",
        "npm test",
        "--repo-lint-command",
        "npm install",
        "--repo-lint-command",
        "npx playwright install",
        "--repo-test-command",
        "npm test",
      ]);
      const secondRun = invokeCli([
        "project",
        "init",
        "--project-ref",
        projectRoot,
        "--materialize-project-profile",
        "--materialize-bootstrap-assets",
        "--repo-build-command",
        "npm test",
        "--repo-lint-command",
        "npm install",
        "--repo-lint-command",
        "npx playwright install",
        "--repo-test-command",
        "npm test",
      ]);

      assert.equal(firstRun.exitCode, 0, firstRun.stderr);
      assert.equal(secondRun.exitCode, 0, secondRun.stderr);

      const firstPayload = JSON.parse(firstRun.stdout);
      const secondPayload = JSON.parse(secondRun.stdout);

      assert.equal(firstPayload.bootstrap_materialization_status, "materialized");
      assert.equal(firstPayload.bootstrap_materialization_idempotent, false);
      assert.equal(firstPayload.project_profile_ref, "project.aor.yaml");
      assert.equal(fs.existsSync(firstPayload.materialized_project_profile_file), true);
      assert.equal(fs.existsSync(firstPayload.materialized_bootstrap_assets_root), true);
      assert.equal(fs.existsSync(path.join(projectRoot, "examples", "project.github.aor.yaml")), true);
      const materializedProfile = parseYaml(fs.readFileSync(firstPayload.materialized_project_profile_file, "utf8"));
      assert.deepEqual(materializedProfile.repos[0].build_commands, ["npm test"]);
      assert.deepEqual(materializedProfile.repos[0].lint_commands, ["npm install", "npx playwright install"]);
      assert.deepEqual(materializedProfile.repos[0].test_commands, ["npm test"]);

      assert.equal(secondPayload.bootstrap_materialization_status, "reused-existing");
      assert.equal(secondPayload.bootstrap_materialization_idempotent, true);
      assert.equal(secondPayload.materialized_project_profile_file, firstPayload.materialized_project_profile_file);
      assert.equal(secondPayload.materialized_bootstrap_assets_root, firstPayload.materialized_bootstrap_assets_root);
    });
  });
});

test("intake create preserves mission traceability and discovery run consumes explicit input packets", () => {
  withTempProject((projectRoot) => {
    runGitChecked({ cwd: projectRoot, args: ["init"] });
    runGitChecked({ cwd: projectRoot, args: ["config", "user.email", "aor@example.com"] });
    runGitChecked({ cwd: projectRoot, args: ["config", "user.name", "AOR Test"] });
    fs.cpSync(path.join(workspaceRoot, "examples"), path.join(projectRoot, "examples"), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, "package.json"),
      JSON.stringify({ name: "fixture", scripts: { lint: "eslint .", test: "node --test", build: "tsc -b" } }, null, 2),
      "utf8",
    );
    fs.writeFileSync(path.join(projectRoot, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\\n", "utf8");

    const requestFile = path.join(projectRoot, "feature-request.json");
    fs.writeFileSync(
      requestFile,
      `${JSON.stringify(
        {
          allowed_paths: ["source/**", "test/**"],
          forbidden_paths: ["docs/**", "examples/**", "context/**"],
          expected_evidence: ["verify-summary", "review-report"],
          change_budget: { max_changed_files: 6, max_added_lines: 220 },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const intakeResult = invokeCli([
      "intake",
      "create",
      "--project-ref",
      projectRoot,
      "--mission-id",
      "fixture-mission",
      "--request-title",
      "Fixture mission request",
      "--request-brief",
      "Prepare one bounded feature mission request.",
      "--request-constraints",
      "keep the change inside source and test",
      "--request-constraints",
      "avoid docs and control-plane content",
      "--request-file",
      requestFile,
    ]);
    assert.equal(intakeResult.exitCode, 0, intakeResult.stderr);
    const intakePayload = JSON.parse(intakeResult.stdout);
    assert.equal(fs.existsSync(intakePayload.artifact_packet_file), true);
    assert.equal(fs.existsSync(intakePayload.artifact_packet_body_file), true);
    const intakeBody = JSON.parse(fs.readFileSync(intakePayload.artifact_packet_body_file, "utf8"));
    assert.equal(intakeBody.mission_traceability.mission_id, "fixture-mission");
    assert.equal(intakeBody.feature_request.request_file, requestFile);
    assert.deepEqual(intakeBody.feature_request.request_document.allowed_paths, ["source/**", "test/**"]);

    const discoveryResult = invokeCli([
      "discovery",
      "run",
      "--project-ref",
      projectRoot,
      "--input-packet",
      intakePayload.artifact_packet_file,
    ]);
    assert.equal(discoveryResult.exitCode, 0, discoveryResult.stderr);
    const discoveryPayload = JSON.parse(discoveryResult.stdout);
    const analysisReport = JSON.parse(fs.readFileSync(discoveryPayload.analysis_report_file, "utf8"));
    const intakePacketRef = `evidence://${path.relative(projectRoot, intakePayload.artifact_packet_file).replace(/\\/g, "/")}`;
    assert.equal(analysisReport.feature_traceability.mission_id, "fixture-mission");
    assert.equal(analysisReport.feature_traceability.input_packet_ref, intakePacketRef);
    assert.deepEqual(analysisReport.feature_traceability.allowed_paths, ["source/**", "test/**"]);
  });
});

test("W13 run start, review run, and learning handoff produce durable execution and closure artifacts", () => {
  withTempProject((projectRoot) => {
    runGitChecked({ cwd: projectRoot, args: ["init"] });
    runGitChecked({ cwd: projectRoot, args: ["config", "user.email", "aor@example.com"] });
    runGitChecked({ cwd: projectRoot, args: ["config", "user.name", "AOR Test"] });
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, "test"), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, "source", "mission.js"), "export const mission = 'baseline';\n", "utf8");
    fs.writeFileSync(
      path.join(projectRoot, "test", "mission.test.js"),
      "import test from 'node:test';\nimport assert from 'node:assert/strict';\n\ntest('mission smoke', () => {\n  assert.equal(1, 1);\n});\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(projectRoot, "package.json"),
      JSON.stringify(
        {
          name: "fixture",
          scripts: {
            lint: "node -e \"process.exit(0)\"",
            test: "node --test ./test/mission.test.js",
            build: "node -e \"process.exit(0)\"",
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    fs.writeFileSync(path.join(projectRoot, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\\n", "utf8");
    runGitChecked({ cwd: projectRoot, args: ["add", "-A"] });
    runGitChecked({ cwd: projectRoot, args: ["commit", "-m", "baseline"] });
    fs.appendFileSync(path.join(projectRoot, "source", "mission.js"), "export const missionPatch = 'updated';\n", "utf8");

    withBootstrapAssetsEnv(() => {
      const initResult = invokeCli([
        "project",
        "init",
        "--project-ref",
        projectRoot,
        "--materialize-project-profile",
        "--materialize-bootstrap-assets",
      ]);
      assert.equal(initResult.exitCode, 0, initResult.stderr);
      configureCodexExternalRuntimeSuccess({ projectRoot });

      const requestFile = path.join(projectRoot, "feature-request.json");
      fs.writeFileSync(
        requestFile,
        `${JSON.stringify(
          {
            allowed_paths: ["source/**", "test/**"],
            forbidden_paths: ["docs/**", "examples/**", "context/**", ".agents/**", "scripts/live-e2e/**"],
            expected_evidence: ["verify-summary", "routed-step-result", "review-report"],
            change_budget: { max_changed_files: 6, max_added_lines: 220 },
          },
          null,
          2,
        )}\n`,
        "utf8",
      );

      const intakeResult = invokeCli([
        "intake",
        "create",
        "--project-ref",
        projectRoot,
        "--mission-id",
        "fixture-review-mission",
        "--request-title",
        "Fixture review mission",
        "--request-brief",
        "Exercise the public full-journey review path.",
        "--request-file",
        requestFile,
      ]);
      assert.equal(intakeResult.exitCode, 0, intakeResult.stderr);
      const intakePayload = JSON.parse(intakeResult.stdout);

      const discoveryResult = invokeCli([
        "discovery",
        "run",
        "--project-ref",
        projectRoot,
        "--input-packet",
        intakePayload.artifact_packet_file,
      ]);
      assert.equal(discoveryResult.exitCode, 0, discoveryResult.stderr);

      const specResult = invokeCli(["spec", "build", "--project-ref", projectRoot]);
      assert.equal(specResult.exitCode, 0, specResult.stderr);

      const waveResult = invokeCli(["wave", "create", "--project-ref", projectRoot]);
      assert.equal(waveResult.exitCode, 0, waveResult.stderr);
      const wavePayload = JSON.parse(waveResult.stdout);

      const approveResult = invokeCli([
        "handoff",
        "approve",
        "--project-ref",
        projectRoot,
        "--handoff-packet",
        wavePayload.handoff_packet_file,
        "--approval-ref",
        "approval://W13-1001",
      ]);
      assert.equal(approveResult.exitCode, 0, approveResult.stderr);
      const approvedPayload = JSON.parse(approveResult.stdout);

      const validateResult = invokeCli([
        "project",
        "validate",
        "--project-ref",
        projectRoot,
        "--require-approved-handoff",
        "--handoff-packet",
        approvedPayload.handoff_packet_file,
      ]);
      assert.equal(validateResult.exitCode, 0, validateResult.stderr);
      assert.equal(JSON.parse(validateResult.stdout).handoff_gate_status, "pass");

      const preflightVerify = invokeCli([
        "project",
        "verify",
        "--project-ref",
        projectRoot,
        "--project-profile",
        "project.aor.yaml",
        "--routed-dry-run-step",
        "implement",
      ]);
      assert.equal(preflightVerify.exitCode, 0, preflightVerify.stderr);
      const preflightPayload = JSON.parse(preflightVerify.stdout);

      const runId = "w13-review-learning-smoke";
      const runStart = invokeCli([
        "run",
        "start",
        "--project-ref",
        projectRoot,
        "--project-profile",
        "project.aor.yaml",
        "--run-id",
        runId,
        "--target-step",
        "implement",
        "--approved-handoff-ref",
        approvedPayload.handoff_packet_file,
        "--promotion-evidence-refs",
        [preflightPayload.verify_summary_file, ...preflightPayload.step_result_files].join(","),
      ]);
      assert.equal(runStart.exitCode, 0, runStart.stderr);
      const runStartPayload = JSON.parse(runStart.stdout);
      assert.equal(runStartPayload.run_control_state.status, "completed");
      assert.equal(fs.existsSync(runStartPayload.routed_step_result_file), true);

      const reviewRun = invokeCli([
        "review",
        "run",
        "--project-ref",
        projectRoot,
        "--project-profile",
        "project.aor.yaml",
        "--run-id",
        runId,
      ]);
      assert.equal(reviewRun.exitCode, 0, reviewRun.stderr);
      const reviewPayload = JSON.parse(reviewRun.stdout);
      assert.equal(reviewPayload.review_overall_status, "pass");
      assert.equal(reviewPayload.review_recommendation, "proceed");
      const reviewReport = JSON.parse(fs.readFileSync(reviewPayload.review_report_file, "utf8"));
      assert.equal(reviewReport.feature_traceability.mission_id, "fixture-review-mission");
      assert.equal(reviewReport.code_quality.status, "pass");
      assert.equal(reviewReport.discovery_quality.status, "pass");
      assert.equal(
        validateContractDocument({
          family: "review-report",
          document: reviewReport,
          source: "fixture://review-report",
        }).ok,
        true,
      );

      const auditRun = invokeCli([
        "audit",
        "runs",
        "--project-ref",
        projectRoot,
        "--run-id",
        runId,
      ]);
      assert.equal(auditRun.exitCode, 0, auditRun.stderr);
      assert.equal(JSON.parse(auditRun.stdout).run_audit_records.length, 1);

      const learningRun = invokeCli([
        "learning",
        "handoff",
        "--project-ref",
        projectRoot,
        "--run-id",
        runId,
      ]);
      assert.equal(learningRun.exitCode, 0, learningRun.stderr);
      const learningPayload = JSON.parse(learningRun.stdout);
      assert.equal(fs.existsSync(learningPayload.learning_loop_scorecard_file), true);
      assert.equal(fs.existsSync(learningPayload.learning_loop_handoff_file), true);
      assert.equal(Object.prototype.hasOwnProperty.call(learningPayload, "incident_report_file"), true);
      const learningScorecard = JSON.parse(fs.readFileSync(learningPayload.learning_loop_scorecard_file, "utf8"));
      const learningHandoff = JSON.parse(fs.readFileSync(learningPayload.learning_loop_handoff_file, "utf8"));
      assert.equal(
        validateContractDocument({
          family: "learning-loop-scorecard",
          document: learningScorecard,
          source: "fixture://learning-loop-scorecard",
        }).ok,
        true,
      );
      assert.equal(
        validateContractDocument({
          family: "learning-loop-handoff",
          document: learningHandoff,
          source: "fixture://learning-loop-handoff",
        }).ok,
        true,
      );
    });
  });
});

test("project analyze writes durable analysis report under runtime root", () => {
  withTempProject((projectRoot) => {
    fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
    fs.cpSync(path.join(workspaceRoot, "examples"), path.join(projectRoot, "examples"), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, "package.json"),
      JSON.stringify({ name: "fixture", scripts: { lint: "eslint .", test: "node --test", build: "tsc -b" } }, null, 2),
      "utf8",
    );
    fs.writeFileSync(path.join(projectRoot, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\\n", "utf8");

    const result = invokeCli([
      "project",
      "analyze",
      "--project-ref",
      projectRoot,
      "--route-overrides",
      "planning=route.plan.default",
      "--policy-overrides",
      "planning=policy.step.planner.default",
    ]);

    assert.equal(result.exitCode, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.analysis_report_id, "aor-core.analysis.v1");
    assert.equal(fs.existsSync(parsed.analysis_report_file), true);
    assert.equal(fs.existsSync(parsed.route_resolution_file), true);
    assert.ok(Array.isArray(parsed.route_resolution_steps));
    assert.equal(parsed.route_resolution_steps.length, 10);
    assert.ok(parsed.route_resolution_steps.every((step) => typeof step.resolved_route_id === "string"));
    assert.equal(fs.existsSync(parsed.asset_resolution_file), true);
    assert.ok(Array.isArray(parsed.asset_resolution_steps));
    assert.equal(parsed.asset_resolution_steps.length, 10);
    assert.equal(fs.existsSync(parsed.policy_resolution_file), true);
    assert.ok(Array.isArray(parsed.policy_resolution_steps));
    assert.equal(parsed.policy_resolution_steps.length, 10);
    assert.equal(fs.existsSync(parsed.evaluation_registry_file), true);
    assert.ok(Array.isArray(parsed.evaluation_registry_suites));
    assert.ok(Array.isArray(parsed.evaluation_registry_datasets));
    assert.ok(parsed.evaluation_registry_suites.length > 0);
    assert.ok(parsed.evaluation_registry_datasets.length > 0);
    assert.equal(parsed.discovery_completeness_status, "pass");
    assert.equal(parsed.discovery_completeness_blocking, false);
    assert.ok(Array.isArray(parsed.discovery_completeness_checks));
    assert.equal(typeof parsed.architecture_traceability, "object");
    const planningRoute = parsed.route_resolution_steps.find((step) => step.step_class === "planning");
    assert.ok(planningRoute);
    assert.equal(planningRoute.resolution_source.kind, "step-override");
    const planningAssets = parsed.asset_resolution_steps.find((step) => step.step_class === "planning");
    assert.ok(planningAssets);
    assert.equal(planningAssets.wrapper.wrapper_ref, "wrapper.planner.default@v1");
    const planningPolicy = parsed.policy_resolution_steps.find((step) => step.step_class === "planning");
    assert.ok(planningPolicy);
    assert.equal(planningPolicy.policy.policy_id, "policy.step.planner.default");
    assert.equal(planningPolicy.policy.resolution_source.kind, "step-override");
    assert.equal(planningPolicy.resolved_bounds.writeback_mode.mode, "pull-request");

    const report = JSON.parse(fs.readFileSync(parsed.analysis_report_file, "utf8"));
    assert.equal(report.project_id, "aor-core");
    assert.equal(report.status, "ready-for-bootstrap");
    assert.equal(report.route_resolution.matrix.length, 10);
    assert.equal(report.asset_resolution.matrix.length, 10);
    assert.equal(report.policy_resolution.matrix.length, 10);
    assert.ok(Array.isArray(report.evaluation_registry.suite_refs));
    assert.ok(Array.isArray(report.evaluation_registry.dataset_refs));
    assert.equal(report.discovery_completeness.status, "pass");
    assert.equal(report.discovery_completeness.blocking, false);
    assert.ok(Array.isArray(report.architecture_traceability.step_linkage));
    assert.ok(report.architecture_traceability.step_linkage.some((entry) => entry.step_class === "planning"));
  });
});

test("project validate writes validation report with deterministic status", () => {
  withTempProject((projectRoot) => {
    fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
    fs.cpSync(path.join(workspaceRoot, "examples"), path.join(projectRoot, "examples"), { recursive: true });

    const result = invokeCli(["project", "validate", "--project-ref", projectRoot]);
    assert.equal(result.exitCode, 0, result.stderr);

    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.validation_report_id, "aor-core.validation.v1");
    assert.equal(fs.existsSync(parsed.validation_report_file), true);
    assert.ok(parsed.validation_status === "pass" || parsed.validation_status === "warn");
  });
});

test("handoff prepare materializes wave-ticket and pending handoff packet", () => {
  withTempProject((projectRoot) => {
    fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
    fs.cpSync(path.join(workspaceRoot, "examples"), path.join(projectRoot, "examples"), { recursive: true });

    const result = invokeCli(["handoff", "prepare", "--project-ref", projectRoot]);
    assert.equal(result.exitCode, 0, result.stderr);

    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.command, "handoff prepare");
    assert.equal(typeof parsed.wave_ticket_id, "string");
    assert.equal(fs.existsSync(parsed.wave_ticket_file), true);
    assert.equal(parsed.handoff_status, "pending-approval");
    assert.equal(fs.existsSync(parsed.handoff_packet_file), true);
    assert.equal(parsed.handoff_approval_state.state, "pending");

    const handoffPacket = JSON.parse(fs.readFileSync(parsed.handoff_packet_file, "utf8"));
    assert.equal(typeof handoffPacket.writeback_mode, "string");
    assert.equal(typeof handoffPacket.scope_constraints, "object");
    assert.equal(handoffPacket.command_policy.owner, "project-profile");
  });
});

test("project validate enforces approved handoff gate when required", () => {
  withTempProject((projectRoot) => {
    fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
    fs.cpSync(path.join(workspaceRoot, "examples"), path.join(projectRoot, "examples"), { recursive: true });

    const prepareResult = invokeCli(["handoff", "prepare", "--project-ref", projectRoot]);
    assert.equal(prepareResult.exitCode, 0, prepareResult.stderr);
    const prepared = JSON.parse(prepareResult.stdout);

    const validateBeforeApproval = invokeCli([
      "project",
      "validate",
      "--project-ref",
      projectRoot,
      "--require-approved-handoff",
      "--handoff-packet",
      prepared.handoff_packet_file,
    ]);
    assert.equal(validateBeforeApproval.exitCode, 0, validateBeforeApproval.stderr);
    const beforePayload = JSON.parse(validateBeforeApproval.stdout);
    assert.equal(beforePayload.handoff_gate_status, "fail");
    assert.equal(beforePayload.handoff_gate_blocking, true);
    assert.equal(beforePayload.validation_status, "fail");

    const approveResult = invokeCli([
      "handoff",
      "approve",
      "--project-ref",
      projectRoot,
      "--handoff-packet",
      prepared.handoff_packet_file,
      "--approval-ref",
      "approval://APP-1001",
    ]);
    assert.equal(approveResult.exitCode, 0, approveResult.stderr);
    const approved = JSON.parse(approveResult.stdout);
    assert.equal(approved.handoff_status, "approved");
    assert.equal(approved.handoff_approval_state.state, "approved");

    const validateAfterApproval = invokeCli([
      "project",
      "validate",
      "--project-ref",
      projectRoot,
      "--require-approved-handoff",
      "--handoff-packet",
      prepared.handoff_packet_file,
    ]);
    assert.equal(validateAfterApproval.exitCode, 0, validateAfterApproval.stderr);
    const afterPayload = JSON.parse(validateAfterApproval.stdout);
    assert.equal(afterPayload.handoff_gate_status, "pass");
    assert.equal(afterPayload.handoff_gate_blocking, false);
    assert.notEqual(afterPayload.validation_status, "fail");
  });
});

test("project verify refuses to continue when validation gate is enforced and status is fail", () => {
  withTempProject((projectRoot) => {
    fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
    fs.cpSync(path.join(workspaceRoot, "examples"), path.join(projectRoot, "examples"), { recursive: true });
    const profilePath = path.join(projectRoot, "examples/project.aor.yaml");
    const profileContent = fs.readFileSync(profilePath, "utf8");
    fs.writeFileSync(
      profilePath,
      profileContent.replace("allow_direct_write: false", "allow_direct_write: true"),
      "utf8",
    );

    const validateResult = invokeCli(["project", "validate", "--project-ref", projectRoot]);
    assert.equal(validateResult.exitCode, 0, validateResult.stderr);

    const verifyResult = invokeCli([
      "project",
      "verify",
      "--project-ref",
      projectRoot,
      "--require-validation-pass",
    ]);

    assert.equal(verifyResult.exitCode, 1);
    assert.match(verifyResult.stderr, /Validation gate blocked verify flow/);
  });
});
