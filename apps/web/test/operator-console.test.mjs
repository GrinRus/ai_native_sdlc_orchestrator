import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { appendRunEvent } from "../../api/src/index.mjs";
import { invokeCli } from "../../cli/src/index.mjs";
import {
  attachOperatorConsoleSession,
  buildOperatorConsoleSnapshot,
  renderOperatorConsoleHtml,
} from "../src/operator-console.mjs";

const currentFilePath = fileURLToPath(import.meta.url);
const fixturesDir = path.join(path.dirname(currentFilePath), "fixtures");
const workspaceRoot = path.resolve(path.dirname(currentFilePath), "../../..");

/**
 * @param {(projectRoot: string) => Promise<void> | void} callback
 */
async function withTempProject(callback) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-web-w5-s04-"));
  try {
    await callback(tempRoot);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

/**
 * @param {string} projectRoot
 * @returns {string}
 */
function seedOperatorArtifacts(projectRoot) {
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

  const prepareResult = invokeCli(["handoff", "prepare", "--project-ref", projectRoot]);
  assert.equal(prepareResult.exitCode, 0, prepareResult.stderr);

  const evalResult = invokeCli([
    "eval",
    "run",
    "--project-ref",
    projectRoot,
    "--suite-ref",
    "suite.release.core@v1",
    "--subject-ref",
    "run://web-console-smoke",
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

  return runId;
}

test("web console snapshot builds run list and run detail from shared API contracts", async () => {
  await withTempProject(async (projectRoot) => {
    const runId = seedOperatorArtifacts(projectRoot);
    const snapshot = buildOperatorConsoleSnapshot({
      cwd: projectRoot,
      projectRef: projectRoot,
      runId,
    });

    assert.equal(snapshot.project.project_root, projectRoot);
    assert.ok(Array.isArray(snapshot.runs));
    assert.ok(snapshot.runs.some((run) => run.run_id === runId));
    assert.ok(snapshot.packet_artifacts.length >= 1);
    assert.ok(snapshot.run_detail.step_results.length >= 1);
    assert.equal(snapshot.run_detail.event_history.run_id, runId);
    assert.equal(snapshot.run_detail.event_history.total_events, 0);
    assert.ok(snapshot.run_detail.policy_history.entry_count >= 1);
    assert.ok(snapshot.quality_artifacts.length >= 1);
    assert.equal(typeof snapshot.strategic_snapshot, "object");
    assert.ok(Array.isArray(snapshot.strategic_snapshot.wave_snapshot.waves));
    assert.equal(typeof snapshot.strategic_snapshot.risk_snapshot.level_totals.high, "number");
    assert.equal(
      snapshot.api_ui_contract_alignment.live_stream,
      "GET /api/projects/:projectId/runs/:runId/events",
    );
    assert.ok(
      snapshot.api_ui_contract_alignment.read_model.includes(
        "GET /api/projects/:projectId/runs/:runId/events/history",
      ),
    );
    assert.ok(
      snapshot.api_ui_contract_alignment.read_model.includes(
        "GET /api/projects/:projectId/runs/:runId/policy-history",
      ),
    );

    const html = renderOperatorConsoleHtml(snapshot, {
      title: "AOR Web Console Smoke",
      streamProtocol: "sse",
      liveEventCount: 2,
    });
    assert.match(html, /AOR Operator Console/);
    assert.match(html, new RegExp(runId));
    assert.match(html, /Run detail evidence links/);
    assert.match(html, /Policy history entries/);
    assert.match(html, /Event history entries/);
    assert.match(html, /Strategic Snapshot/);
    assert.match(html, /High-risk runs/);
  });
});

test("web console follow mode reuses shared stream and detach is non-disruptive", async () => {
  await withTempProject(async (projectRoot) => {
    const runId = seedOperatorArtifacts(projectRoot);

    appendRunEvent({
      projectRef: projectRoot,
      cwd: projectRoot,
      runId,
      eventType: "run.started",
      payload: { stage: "bootstrap" },
    });
    appendRunEvent({
      projectRef: projectRoot,
      cwd: projectRoot,
      runId,
      eventType: "step.updated",
      payload: { step_id: "runner.implement", status: "pass" },
    });

    const session = attachOperatorConsoleSession({
      cwd: projectRoot,
      projectRef: projectRoot,
      runId,
      follow: true,
      maxReplay: 50,
    });

    assert.equal(session.mode, "detachable-web-console");
    assert.equal(session.follow_enabled, true);
    assert.equal(session.stream_protocol, "sse");
    assert.equal(session.stream_backpressure.policy, "bounded-replay-window");
    assert.equal(session.replay_events.length, 2);
    assert.equal(session.snapshot.run_detail.event_history.total_events, 2);
    assert.ok(session.snapshot.run_detail.policy_history.entry_count >= 1);

    const streamedEvent = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("timed out waiting for web follow event")), 3000);
      const unsubscribe = session.onEvent((event) => {
        clearTimeout(timeout);
        unsubscribe();
        resolve(event);
      });
    });

    appendRunEvent({
      projectRef: projectRoot,
      cwd: projectRoot,
      runId,
      eventType: "warning.raised",
      payload: { code: "budget.near_limit" },
    });

    const received = /** @type {Record<string, unknown>} */ (await streamedEvent);
    assert.equal(received.event_type, "warning.raised");
    const capturedBeforeDetach = session.replay_events.length;
    const detached = session.detach();
    assert.equal(detached.detached, true);
    assert.equal(detached.captured_event_count, capturedBeforeDetach);

    appendRunEvent({
      projectRef: projectRoot,
      cwd: projectRoot,
      runId,
      eventType: "run.terminal",
      payload: { status: "pass" },
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(session.replay_events.length, capturedBeforeDetach);

    const snapshotAfterDetach = buildOperatorConsoleSnapshot({
      cwd: projectRoot,
      projectRef: projectRoot,
      runId,
    });
    assert.ok(snapshotAfterDetach.runs.some((run) => run.run_id === runId));
  });
});

test("web snapshot reflects ui attach/detach lifecycle while headless reads remain available", async () => {
  await withTempProject(async (projectRoot) => {
    const runId = seedOperatorArtifacts(projectRoot);

    const attachResult = invokeCli([
      "ui",
      "attach",
      "--project-ref",
      projectRoot,
      "--run-id",
      runId,
      "--control-plane",
      "http://localhost:8080",
    ]);
    assert.equal(attachResult.exitCode, 0, attachResult.stderr);

    const attachedSnapshot = buildOperatorConsoleSnapshot({
      cwd: projectRoot,
      projectRef: projectRoot,
      runId,
    });
    assert.equal(attachedSnapshot.ui_lifecycle.ui_attached, true);
    assert.equal(attachedSnapshot.ui_lifecycle.connection_state, "connected");

    const detachResult = invokeCli(["ui", "detach", "--project-ref", projectRoot, "--run-id", runId]);
    assert.equal(detachResult.exitCode, 0, detachResult.stderr);

    const detachedSnapshot = buildOperatorConsoleSnapshot({
      cwd: projectRoot,
      projectRef: projectRoot,
      runId,
    });
    assert.equal(detachedSnapshot.ui_lifecycle.ui_attached, false);
    assert.equal(detachedSnapshot.ui_lifecycle.connection_state, "detached");
    assert.ok(detachedSnapshot.runs.some((run) => run.run_id === runId));
  });
});

test("operator console smoke script renders html and emits transcript summary", async () => {
  await withTempProject(async (projectRoot) => {
    const runId = seedOperatorArtifacts(projectRoot);
    appendRunEvent({
      projectRef: projectRoot,
      cwd: projectRoot,
      runId,
      eventType: "run.started",
      payload: { stage: "bootstrap" },
    });

    const outputHtml = path.join(projectRoot, ".aor", "web", "operator-console-smoke.html");
    const run = spawnSync(
      process.execPath,
      [
        path.join(workspaceRoot, "apps/web/scripts/operator-console-smoke.mjs"),
        "--project-ref",
        projectRoot,
        "--run-id",
        runId,
        "--follow",
        "true",
        "--output-html",
        outputHtml,
      ],
      { cwd: workspaceRoot, encoding: "utf8" },
    );

    assert.equal(run.status, 0, run.stderr);
    const summary = JSON.parse(run.stdout);
    assert.equal(fs.existsSync(summary.rendered_html_file), true);

    const fixture = JSON.parse(
      fs.readFileSync(path.join(fixturesDir, "operator-console-smoke.json"), "utf8"),
    );
    const subset = {
      mode: summary.mode,
      follow_enabled: summary.follow_enabled,
      stream_protocol: summary.stream_protocol,
      detached: summary.detached,
      policy_history_path_present: Array.isArray(summary.contract_alignment.read_model)
        ? summary.contract_alignment.read_model.includes("GET /api/projects/:projectId/runs/:runId/policy-history")
        : false,
    };
    assert.deepEqual(subset, fixture);
  });
});
