import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { withTempRepo as withTempRepoHelper } from "../../../scripts/test/helpers/temp-repo.mjs";
import { requestRunJobCancel, startRunJob } from "../../../packages/orchestrator-core/src/run-job.mjs";
import { classifyRunJobTerminalStatus } from "../../../packages/orchestrator-core/src/run-job-status.mjs";
import { applyRunControlAction, readRunControlState } from "../src/index.mjs";
import { appendRunEvent, openRunEventStream, readRunEvents } from "../src/live-event-stream.mjs";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const workspaceRoot = path.resolve(currentDir, "../../..");

/**
 * @param {(repoRoot: string) => Promise<void> | void} callback
 */
async function withTempRepo(callback) {
  await withTempRepoHelper({ prefix: "aor-w5-s02-", workspaceRoot }, callback);
}

async function waitForJob(file, accepted, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = JSON.parse(fs.readFileSync(file, "utf8"));
    if (accepted.includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${accepted.join("|")} in '${file}'`);
}

test("live event stream supports ordered replay and subscribe flow", async () => {
  await withTempRepo(async (repoRoot) => {
    const runId = "run.live.stream.v1";

    const started = appendRunEvent({
      projectRef: repoRoot,
      cwd: repoRoot,
      runId,
      eventType: "run.started",
      payload: {
        stage: "bootstrap",
        status: "started",
      },
    });
    appendRunEvent({
      projectRef: repoRoot,
      cwd: repoRoot,
      runId,
      eventType: "step.updated",
      payload: {
        step_id: "bootstrap.clone",
        status: "pass",
      },
    });
    appendRunEvent({
      projectRef: repoRoot,
      cwd: repoRoot,
      runId,
      eventType: "evidence.linked",
      payload: {
        evidence_ref: "evidence://reports/run.live.stream.v1/step-result-bootstrap.json",
      },
    });

    const ordered = readRunEvents({
      projectRef: repoRoot,
      cwd: repoRoot,
      runId,
    });
    assert.equal(ordered.length, 3);
    assert.deepEqual(
      ordered.map((event) => event.event_type),
      ["run.started", "step.updated", "evidence.linked"],
    );
    assert.deepEqual(
      ordered.map((event) => event.payload.sequence),
      [1, 2, 3],
    );

    const stream = openRunEventStream({
      projectRef: repoRoot,
      cwd: repoRoot,
      runId,
      afterEventId: started.event.event_id,
      maxReplay: 50,
    });
    assert.equal(stream.protocol, "sse");
    assert.equal(stream.backpressure.policy, "bounded-replay-window");
    assert.equal(stream.replay_events.length, 2);
    assert.deepEqual(
      stream.replay_events.map((event) => event.event_type),
      ["step.updated", "evidence.linked"],
    );

    const received = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("timed out waiting for streamed live-run event"));
      }, 3000);
      const unsubscribe = stream.subscribe((event) => {
        clearTimeout(timeout);
        unsubscribe();
        resolve(event);
      });
    });

    appendRunEvent({
      projectRef: repoRoot,
      cwd: repoRoot,
      runId,
      eventType: "warning.raised",
      payload: {
        code: "budget.near_limit",
        summary: "Wall-clock usage exceeded 80 percent.",
      },
    });

    const streamedEvent = /** @type {Record<string, unknown>} */ (await received);
    assert.equal(streamedEvent.event_type, "warning.raised");
    assert.equal(streamedEvent.payload.sequence, 4);

    const noReplay = openRunEventStream({ projectRef: repoRoot, cwd: repoRoot, runId, maxReplay: 0 });
    assert.deepEqual(noReplay.replay_events, []);
    assert.equal(noReplay.backpressure.max_replay_events, 0);
    const capped = openRunEventStream({ projectRef: repoRoot, cwd: repoRoot, runId, maxReplay: 100_000 });
    assert.equal(capped.backpressure.max_replay_events, 1000);
  });
});

test("durable journal tail delivers a separate-process append exactly once", async () => {
  await withTempRepo(async (repoRoot) => {
    const runId = "run.cross.process.stream.v1";
    const stream = openRunEventStream({ projectRef: repoRoot, cwd: repoRoot, runId, maxReplay: 0 });
    const received = [];
    const completed = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("timed out waiting for cross-process event")), 5000);
      const unsubscribe = stream.subscribe((event) => {
        received.push(event);
        clearTimeout(timeout);
        unsubscribe();
        resolve();
      });
    });
    const moduleUrl = new URL("../src/live-event-stream.mjs", import.meta.url).href;
    const child = spawnSync(process.execPath, [
      "--input-type=module",
      "-e",
      `import { appendRunEvent } from ${JSON.stringify(moduleUrl)}; appendRunEvent({projectRef:${JSON.stringify(repoRoot)},cwd:${JSON.stringify(repoRoot)},runId:${JSON.stringify(runId)},eventType:"provider.heartbeat",payload:{status:"running"}});`,
    ], { cwd: workspaceRoot, encoding: "utf8" });
    assert.equal(child.status, 0, child.stderr);
    await completed;
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(received.length, 1);
    assert.equal(received[0].event_type, "provider.heartbeat");
  });
});

test("CLI run status follow waits for a later terminal event", async () => {
  await withTempRepo(async (repoRoot) => {
    const runId = "run.cli.follow.terminal.v1";
    appendRunEvent({ projectRef: repoRoot, cwd: repoRoot, runId, eventType: "run.started", payload: { status: "running" } });
    const child = spawn(process.execPath, [
      path.join(workspaceRoot, "apps/cli/bin/aor.mjs"),
      "run", "status", "--project-ref", repoRoot, "--run-id", runId, "--follow", "true", "--max-replay", "0",
    ], { cwd: workspaceRoot, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(child.exitCode, null, "follow must remain attached before a terminal event");
    appendRunEvent({ projectRef: repoRoot, cwd: repoRoot, runId, eventType: "run.terminal", payload: { status: "succeeded" } });
    const exitCode = await new Promise((resolve) => child.once("exit", resolve));
    assert.equal(exitCode, 0, stderr);
    const payload = JSON.parse(stdout);
    assert.equal(payload.follow_mode.enabled, true);
    assert.equal(payload.run_event_history.total_events, 2);
    assert.deepEqual(payload.replay_events, []);
  });
});

test("CLI late follow exits after an already durable terminal event", async () => {
  await withTempRepo(async (repoRoot) => {
    const runId = "run.cli.follow.late.terminal.v1";
    appendRunEvent({ projectRef: repoRoot, cwd: repoRoot, runId, eventType: "run.started", payload: { status: "running" } });
    appendRunEvent({ projectRef: repoRoot, cwd: repoRoot, runId, eventType: "run.terminal", payload: { status: "succeeded" } });
    const result = spawnSync(process.execPath, [
      path.join(workspaceRoot, "apps/cli/bin/aor.mjs"),
      "run", "status", "--project-ref", repoRoot, "--run-id", runId, "--follow", "true", "--max-replay", "0",
    ], { cwd: workspaceRoot, encoding: "utf8", timeout: 5000 });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).follow_mode.enabled, true);
  });
});

test("CLI run status follow releases its subscription on SIGINT", async () => {
  await withTempRepo(async (repoRoot) => {
    const runId = "run.cli.follow.sigint.v1";
    appendRunEvent({ projectRef: repoRoot, cwd: repoRoot, runId, eventType: "run.started", payload: { status: "running" } });
    const child = spawn(process.execPath, [
      path.join(workspaceRoot, "apps/cli/bin/aor.mjs"),
      "run", "status", "--project-ref", repoRoot, "--run-id", runId, "--follow", "true", "--max-replay", "1",
    ], { cwd: workspaceRoot, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    await new Promise((resolve) => setTimeout(resolve, 1000));
    assert.equal(child.exitCode, null, "follow process must be ready before SIGINT");
    child.kill("SIGINT");
    const exitCode = await new Promise((resolve) => child.once("exit", resolve));
    assert.equal(exitCode, 0);
    assert.equal(JSON.parse(stdout).follow_mode.enabled, true);
  });
});

test("run job cancellation terminates its supervised process group", async () => {
  await withTempRepo(async (repoRoot) => {
    const runId = "run.job.cancel.supervisor.v1";
    appendRunEvent({ projectRef: repoRoot, cwd: repoRoot, runId, eventType: "run.started", payload: { status: "running" } });
    const started = startRunJob({
      projectRef: repoRoot,
      cwd: repoRoot,
      runId,
      args: ["run", "status", "--project-ref", repoRoot, "--run-id", runId, "--follow", "true", "--max-replay", "0"],
    });
    const running = await waitForJob(started.file, ["running"]);
    assert.ok(running.worker.pid > 0);
    requestRunJobCancel({ projectRef: repoRoot, cwd: repoRoot, runId });
    const canceled = await waitForJob(started.file, ["canceled"]);
    assert.equal(canceled.status, "canceled");
    assert.ok(canceled.terminal_at);
    assert.ok(canceled.worker_result.signal);
  });
});

test("concurrent identical run starts claim one fenced worker", async () => {
  await withTempRepo(async (repoRoot) => {
    const runId = "run.job.concurrent.claim.v1";
    const moduleUrl = new URL("../../../packages/orchestrator-core/src/run-job.mjs", import.meta.url).href;
    const source = `
      const { startRunJob } = await import(process.argv[1]);
      const result = startRunJob({
        projectRef: process.argv[2], cwd: process.argv[2], runId: process.argv[3],
        args: ["doctor", "--project-ref", process.argv[2]],
      });
      process.stdout.write(JSON.stringify({ idempotent: result.idempotent, file: result.file }));
    `;
    const starts = await Promise.all(Array.from({ length: 8 }, () => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["--input-type=module", "--eval", source, moduleUrl, repoRoot, runId], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("error", reject);
      child.on("exit", (code) => code === 0 ? resolve(JSON.parse(stdout)) : reject(new Error(stderr)));
    })));
    assert.equal(starts.filter((entry) => entry.idempotent === false).length, 1);
    const terminal = await waitForJob(starts[0].file, ["succeeded", "failed"]);
    assert.equal(terminal.status, "succeeded", JSON.stringify(terminal.worker_result));
    assert.equal(terminal.worker.fencing_token, 1);
    assert.ok(terminal.worker.pid > 0);
  });
});

test("exit-zero structured interaction is waiting-input before success classification", () => {
  assert.equal(classifyRunJobTerminalStatus({
    currentStatus: "running",
    signal: null,
    exitCode: 0,
    commandOutput: { output: { requested_interaction: { requested: true, status: "requested" } } },
  }), "waiting-input");
  assert.equal(classifyRunJobTerminalStatus({
    currentStatus: "running", signal: null, exitCode: 0, commandOutput: { status: "pass" },
  }), "succeeded");
});

test("run-control API emits deterministic control events and durable audit evidence", async () => {
  await withTempRepo(async (repoRoot) => {
    const runId = "run.control.api.v1";

    const started = applyRunControlAction({
      projectRef: repoRoot,
      cwd: repoRoot,
      runId,
      action: "start",
      commandId: "command.start.retry",
      expectedRevision: 0,
    });
    assert.equal(started.blocked, false);
    assert.equal(started.state?.status, "running");
    assert.equal(started.primaryEvent.event_type, "run.started");
    assert.equal(started.evidenceEvent.event_type, "evidence.linked");
    assert.equal(started.primaryEvent.payload.policy_context.approval_required, false);
    assert.equal(started.primaryEvent.payload.policy_context.high_risk, false);
    assert.equal(started.evidenceEvent.payload.policy_context.action, "start");
    assert.equal(fs.existsSync(started.auditFile), true);
    assert.equal(fs.existsSync(started.stateFile), true);
    const retriedStart = applyRunControlAction({
      projectRef: repoRoot,
      cwd: repoRoot,
      runId,
      action: "start",
      commandId: "command.start.retry",
      expectedRevision: 0,
    });
    assert.equal(retriedStart.revision, 1);
    assert.equal(readRunEvents({ projectRef: repoRoot, cwd: repoRoot, runId }).length, 2);
    assert.throws(() => applyRunControlAction({
      projectRef: repoRoot,
      cwd: repoRoot,
      runId,
      action: "start",
      commandId: "command.start.retry",
      expectedRevision: 0,
      executionPlanRef: "evidence://plans/different.json",
    }), { code: "run-control-command-conflict" });
    assert.throws(() => applyRunControlAction({
      projectRef: repoRoot,
      cwd: repoRoot,
      runId,
      action: "pause",
      commandId: "command.stale.pause",
      expectedRevision: 0,
    }), { code: "run-control-revision-conflict" });

    const blockedSteer = applyRunControlAction({
      projectRef: repoRoot,
      cwd: repoRoot,
      runId,
      action: "steer",
      commandId: "command.blocked.steer",
      expectedRevision: 1,
    });
    assert.equal(blockedSteer.blocked, true);
    assert.equal(blockedSteer.primaryEvent.event_type, "warning.raised");
    assert.equal(blockedSteer.primaryEvent.payload.policy_context.approval_required, true);
    assert.equal(blockedSteer.primaryEvent.payload.policy_context.high_risk, true);
    assert.equal(blockedSteer.auditRecord.blocked_reason.code, "scope.target_step_required");
    assert.equal(fs.existsSync(blockedSteer.auditFile), true);

    const canceled = applyRunControlAction({
      projectRef: repoRoot,
      cwd: repoRoot,
      runId,
      action: "cancel",
      approvalRef: "approval://RC-API-1001",
      commandId: "command.cancel",
      expectedRevision: 2,
    });
    assert.equal(canceled.blocked, false);
    assert.equal(canceled.state?.status, "canceled");
    assert.equal(canceled.primaryEvent.event_type, "run.terminal");
    assert.equal(canceled.evidenceEvent.event_type, "evidence.linked");
    assert.equal(canceled.primaryEvent.payload.policy_context.approval_required, true);
    assert.equal(canceled.primaryEvent.payload.policy_context.approval_ref_present, true);

    const stateSnapshot = readRunControlState({
      projectRef: repoRoot,
      cwd: repoRoot,
      runId,
    });
    assert.equal(stateSnapshot.state?.status, "canceled");

    const events = readRunEvents({
      projectRef: repoRoot,
      cwd: repoRoot,
      runId,
    });
    assert.deepEqual(
      events.map((event) => event.event_type),
      ["run.started", "evidence.linked", "warning.raised", "evidence.linked", "run.terminal", "evidence.linked"],
    );
    assert.deepEqual(
      events.map((event) => event.payload.sequence),
      [1, 2, 3, 4, 5, 6],
    );
  });
});

test("concurrent run-control CAS accepts one command without overwriting it", async () => {
  await withTempRepo(async (repoRoot) => {
    const runId = "run.control.concurrent.cas.v1";
    applyRunControlAction({
      projectRef: repoRoot, cwd: repoRoot, runId, action: "start",
      commandId: "command.concurrent.start", expectedRevision: 0,
    });
    const moduleUrl = new URL("../src/index.mjs", import.meta.url).href;
    const source = `
      const { applyRunControlAction } = await import(process.argv[1]);
      try {
        const result = applyRunControlAction({
          projectRef: process.argv[2], cwd: process.argv[2], runId: process.argv[3],
          action: process.argv[4], commandId: \`command.concurrent.\${process.argv[4]}\`,
          expectedRevision: 1, approvalRef: process.argv[4] === "cancel" ? "approval://CAS-1" : undefined,
        });
        process.stdout.write(JSON.stringify({ applied: result.applied, revision: result.revision }));
      } catch (error) {
        process.stderr.write(\`\${String(error.code)}\\n\${String(error.stack)}\`);
        process.exit(2);
      }
    `;
    const runCommand = (action) => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["--input-type=module", "--eval", source, moduleUrl, repoRoot, runId, action], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("error", reject);
      child.on("exit", (code) => resolve({ code, stdout, stderr }));
    });
    const results = await Promise.all([runCommand("pause"), runCommand("cancel")]);
    assert.equal(results.filter((result) => result.code === 0).length, 1, JSON.stringify(results));
    assert.equal(results.filter((result) => result.stderr.includes("run-control-revision-conflict")).length, 1, JSON.stringify(results));
    const state = readRunControlState({ projectRef: repoRoot, cwd: repoRoot, runId }).state;
    assert.equal(state.action_sequence, 2);
    assert.ok(["paused", "canceled"].includes(state.status));
  });
});
