import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { applyRunControlAction, readRunControlState } from "../src/index.mjs";
import { appendRunEvent, openRunEventStream, readRunEvents } from "../src/live-event-stream.mjs";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const workspaceRoot = path.resolve(currentDir, "../../..");

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
 * @param {(repoRoot: string) => Promise<void> | void} callback
 */
async function withTempRepo(callback) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-w5-s02-"));
  fs.cpSync(path.join(workspaceRoot, "examples"), path.join(repoRoot, "examples"), { recursive: true });
  runGitChecked({ cwd: repoRoot, args: ["init"] });
  runGitChecked({ cwd: repoRoot, args: ["config", "user.email", "aor@example.com"] });
  runGitChecked({ cwd: repoRoot, args: ["config", "user.name", "AOR Test"] });
  runGitChecked({ cwd: repoRoot, args: ["add", "-A"] });
  runGitChecked({ cwd: repoRoot, args: ["commit", "-m", "initial"] });

  try {
    await callback(repoRoot);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
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
  });
});

test("run-control API emits deterministic control events and durable audit evidence", async () => {
  await withTempRepo(async (repoRoot) => {
    const runId = "run.control.api.v1";

    const started = applyRunControlAction({
      projectRef: repoRoot,
      cwd: repoRoot,
      runId,
      action: "start",
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

    const blockedSteer = applyRunControlAction({
      projectRef: repoRoot,
      cwd: repoRoot,
      runId,
      action: "steer",
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
