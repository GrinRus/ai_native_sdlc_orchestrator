import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { appendRunEvent } from "../../api/src/index.mjs";
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
    /Inputs: --project-ref <path> \(optional, defaults to cwd discovery\), --project-profile <path> \(optional\), --runtime-root <path> \(optional\), --help/,
  );
  assert.match(
    result.stdout,
    /Outputs: resolved_project_ref, resolved_runtime_root, project_profile_ref, runtime_layout, runtime_state_file, artifact_packet_id, artifact_packet_file, contract_families, command_catalog_alignment/,
  );
  assert.match(result.stdout, /Contract families: project-profile/);
});

test("eval run help documents quality-shell status and offline semantics", () => {
  const result = invokeCli(["eval", "run", "--help"]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /Status: implemented in quality shell \(W3-S03\)/);
  assert.match(result.stdout, /Eval run is offline and independent from delivery automation\./);
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

test("live-e2e command help documents start observe and abort semantics", () => {
  const result = invokeCli(["live-e2e", "start", "--help"]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /Status: implemented in live E2E shell \(W5-S05\)/);
  assert.match(result.stdout, /standard profile run and emits durable run summary \+ scorecard artifacts/);
  assert.match(result.stdout, /--hold-open=true leaves the run in running state/);
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

test("planned commands report not implemented status", () => {
  const result = invokeCli(["harness", "replay"]);

  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Command 'aor harness replay' is planned and not implemented yet\./);
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

    const specResult = invokeCli(["spec", "build", "--project-ref", projectRoot]);
    assert.equal(specResult.exitCode, 0, specResult.stderr);
    const specPayload = JSON.parse(specResult.stdout);
    assert.equal(specPayload.command, "spec build");
    assert.equal(typeof specPayload.routed_step_result_id, "string");
    assert.equal(fs.existsSync(specPayload.routed_step_result_file), true);
    const specStepResult = JSON.parse(fs.readFileSync(specPayload.routed_step_result_file, "utf8"));
    assert.equal(specStepResult.step_class, "artifact");

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
      },
      spec_build: {
        command: specPayload.command,
        status: specPayload.status,
        routed_step_result_id: specPayload.routed_step_result_id,
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
    fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
    fs.cpSync(path.join(workspaceRoot, "examples"), path.join(projectRoot, "examples"), { recursive: true });

    const runId = "run-control-smoke";

    const startResult = invokeCli(["run", "start", "--project-ref", projectRoot, "--run-id", runId]);
    assert.equal(startResult.exitCode, 0, startResult.stderr);
    const startPayload = JSON.parse(startResult.stdout);
    assert.equal(startPayload.run_control_action, "start");
    assert.equal(startPayload.run_control_blocked, false);
    assert.equal(startPayload.run_control_state.status, "running");
    assert.equal(fs.existsSync(startPayload.run_control_state_file), true);
    assert.equal(fs.existsSync(startPayload.run_control_audit_file), true);

    const pauseResult = invokeCli(["run", "pause", "--project-ref", projectRoot, "--run-id", runId]);
    assert.equal(pauseResult.exitCode, 0, pauseResult.stderr);
    const pausePayload = JSON.parse(pauseResult.stdout);
    assert.equal(pausePayload.run_control_action, "pause");
    assert.equal(pausePayload.run_control_blocked, false);
    assert.equal(pausePayload.run_control_state.status, "paused");
    assert.equal(fs.existsSync(pausePayload.run_control_audit_file), true);

    const blockedScopeResult = invokeCli(["run", "steer", "--project-ref", projectRoot, "--run-id", runId]);
    assert.equal(blockedScopeResult.exitCode, 0, blockedScopeResult.stderr);
    const blockedScopePayload = JSON.parse(blockedScopeResult.stdout);
    assert.equal(blockedScopePayload.run_control_action, "steer");
    assert.equal(blockedScopePayload.run_control_blocked, true);
    assert.equal(blockedScopePayload.run_control_guardrails.approval_required, true);
    assert.equal(blockedScopePayload.run_control_transition.from_status, "paused");
    assert.equal(blockedScopePayload.run_control_transition.to_status, "paused");
    assert.equal(fs.existsSync(blockedScopePayload.run_control_audit_file), true);
    const blockedScopeAudit = JSON.parse(fs.readFileSync(blockedScopePayload.run_control_audit_file, "utf8"));
    assert.equal(blockedScopeAudit.run_id, runId);
    assert.equal(blockedScopeAudit.blocked, true);
    assert.equal(blockedScopeAudit.blocked_reason.code, "scope.target_step_required");

    const resumeResult = invokeCli(["run", "resume", "--project-ref", projectRoot, "--run-id", runId]);
    assert.equal(resumeResult.exitCode, 0, resumeResult.stderr);
    const resumePayload = JSON.parse(resumeResult.stdout);
    assert.equal(resumePayload.run_control_blocked, false);
    assert.equal(resumePayload.run_control_state.status, "running");

    const invalidTransitionResult = invokeCli(["run", "resume", "--project-ref", projectRoot, "--run-id", runId]);
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
      runId,
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
      runId,
      "--approval-ref",
      "approval://RC-1001",
    ]);
    assert.equal(cancelResult.exitCode, 0, cancelResult.stderr);
    const cancelPayload = JSON.parse(cancelResult.stdout);
    assert.equal(cancelPayload.run_control_blocked, false);
    assert.equal(cancelPayload.run_control_state.status, "canceled");
    assert.equal(fs.existsSync(cancelPayload.run_control_audit_file), true);

    const statusResult = invokeCli(["run", "status", "--project-ref", projectRoot, "--run-id", runId]);
    assert.equal(statusResult.exitCode, 0, statusResult.stderr);
    const statusPayload = JSON.parse(statusResult.stdout);
    assert.ok(statusPayload.run_summaries.some((summary) => summary.run_id === runId));

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

test("live-e2e standard runner supports start observe report and bounded abort surfaces", () => {
  withTempProject((projectRoot) => {
    fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
    fs.cpSync(path.join(workspaceRoot, "examples"), path.join(projectRoot, "examples"), { recursive: true });

    const startResult = invokeCli([
      "live-e2e",
      "start",
      "--project-ref",
      projectRoot,
      "--profile",
      path.join(workspaceRoot, "examples/live-e2e/regress-short.yaml"),
      "--hold-open",
      "true",
    ]);
    assert.equal(startResult.exitCode, 0, startResult.stderr);
    const startPayload = JSON.parse(startResult.stdout);
    assert.equal(startPayload.live_e2e_run_status, "running");
    assert.equal(fs.existsSync(startPayload.live_e2e_run_summary_file), true);
    assert.ok(Array.isArray(startPayload.live_e2e_scorecard_files));
    assert.ok(startPayload.live_e2e_scorecard_files.length >= 1);
    assert.equal(fs.existsSync(startPayload.live_e2e_scorecard_files[0]), true);

    const statusResult = invokeCli([
      "live-e2e",
      "status",
      "--project-ref",
      projectRoot,
      "--run-id",
      startPayload.live_e2e_run_id,
      "--abort",
      "true",
      "--reason",
      "test-abort",
    ]);
    assert.equal(statusResult.exitCode, 0, statusResult.stderr);
    const statusPayload = JSON.parse(statusResult.stdout);
    assert.equal(statusPayload.live_e2e_abort_applied, true);
    assert.equal(statusPayload.live_e2e_run_status, "aborted");
    assert.ok(Array.isArray(statusPayload.live_e2e_scorecards));
    assert.ok(statusPayload.live_e2e_scorecards.length >= 1);
    const abortedSummary = JSON.parse(fs.readFileSync(statusPayload.live_e2e_run_summary_file, "utf8"));
    assert.equal(fs.existsSync(abortedSummary.learning_loop_scorecard_file), true);
    assert.equal(fs.existsSync(abortedSummary.learning_loop_handoff_file), true);
    assert.equal(fs.existsSync(abortedSummary.incident_report_file), true);
    const incidentReport = JSON.parse(fs.readFileSync(abortedSummary.incident_report_file, "utf8"));
    assert.ok(Array.isArray(incidentReport.linked_run_refs));
    assert.ok(incidentReport.linked_run_refs.some((entry) => String(entry).includes(startPayload.live_e2e_run_id)));

    const reportResult = invokeCli([
      "live-e2e",
      "report",
      "--project-ref",
      projectRoot,
      "--run-id",
      startPayload.live_e2e_run_id,
    ]);
    assert.equal(reportResult.exitCode, 0, reportResult.stderr);
    const reportPayload = JSON.parse(reportResult.stdout);
    assert.equal(reportPayload.live_e2e_run_status, "aborted");
    assert.equal(reportPayload.read_only, true);
    assert.ok(Array.isArray(reportPayload.live_e2e_scorecards));
    assert.ok(reportPayload.live_e2e_scorecards.length >= 1);

    const transcriptFixture = JSON.parse(
      fs.readFileSync(path.join(fixturesDir, "live-e2e-standard-transcript.json"), "utf8"),
    );
    const transcriptSubset = {
      start: {
        command: startPayload.command,
        status: startPayload.status,
        live_e2e_run_status: startPayload.live_e2e_run_status,
      },
      status: {
        command: statusPayload.command,
        status: statusPayload.status,
        live_e2e_run_status: statusPayload.live_e2e_run_status,
        live_e2e_abort_applied: statusPayload.live_e2e_abort_applied,
      },
      report: {
        command: reportPayload.command,
        status: reportPayload.status,
        read_only: reportPayload.read_only,
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

test("project verify supports routed dry-run smoke execution and durable routed step-result output", () => {
  withTempProject((projectRoot) => {
    fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
    fs.cpSync(path.join(workspaceRoot, "examples"), path.join(projectRoot, "examples"), { recursive: true });

    const result = invokeCli([
      "project",
      "verify",
      "--project-ref",
      projectRoot,
      "--routed-dry-run-step",
      "implement",
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
    assert.equal(routedStepResult.routed_execution.route_resolution.step_class, "implement");
    assert.equal(routedStepResult.routed_execution.delivery_plan.delivery_mode, "fork-first-pr");
    assert.equal(routedStepResult.routed_execution.delivery_plan.status, "blocked");
    assert.equal(
      fs.existsSync(routedStepResult.routed_execution.delivery_plan.delivery_plan_file),
      true,
    );
    assert.equal(routedStepResult.routed_execution.adapter_resolution.adapter.adapter_id, "codex-cli");
    assert.equal(routedStepResult.routed_execution.adapter_response.adapter_id, "mock-runner");
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
