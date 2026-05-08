import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { appendRunEvent, createControlPlaneHttpServer } from "../../api/src/index.mjs";
import { invokeCli } from "../../cli/src/index.mjs";
import {
  applyOperatorRunControl,
  applyOperatorUiLifecycle,
  applyOperatorLifecycleCommand,
  attachOperatorConsoleSession,
  buildOperatorConsoleSnapshot,
  renderOperatorConsoleHtml,
  submitOperatorInteractionAnswer,
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
 * @param {string[]} args
 * @param {{ cwd: string }} options
 * @returns {Promise<{ status: number | null, stdout: string, stderr: string }>}
 */
function spawnNode(args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (status) => {
      resolve({ status, stdout, stderr });
    });
  });
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

/**
 * @param {string} projectRoot
 * @param {string} runId
 * @param {string} interactionId
 * @returns {string}
 */
function seedRequestedInteraction(projectRoot, runId, interactionId) {
  const initResult = invokeCli(["project", "init", "--project-ref", projectRoot]);
  assert.equal(initResult.exitCode, 0, initResult.stderr);
  const initPayload = JSON.parse(initResult.stdout);
  const reportsRoot = initPayload.runtime_layout.reportsRoot;
  fs.mkdirSync(reportsRoot, { recursive: true });
  const stepResultFile = path.join(reportsRoot, "step-result-web-interaction-question.json");
  fs.writeFileSync(
    stepResultFile,
    `${JSON.stringify(
      {
        step_result_id: `${runId}.web.runner.question`,
        run_id: runId,
        step_id: "runner.implement",
        step_class: "runner",
        status: "failed",
        summary: "Runner requested operator input.",
        evidence_refs: ["evidence://reports/web-runner-question.json"],
        requested_interaction: {
          requested: true,
          interaction_id: interactionId,
          status: "requested",
          prompt_summary: "Select the operator-approved target.",
          question_evidence_refs: ["evidence://reports/web-runner-question.json"],
          answer_audit_refs: [],
          continuation: {
            next_action: "resume_from_boundary",
            reason_code: "operator-answer-required",
          },
          state_history: [
            {
              status: "requested",
              timestamp: "2026-05-07T00:00:00.000Z",
              summary: "Select the operator-approved target.",
              evidence_refs: ["evidence://reports/web-runner-question.json"],
              continuation: {
                next_action: "resume_from_boundary",
                reason_code: "operator-answer-required",
              },
            },
          ],
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return stepResultFile;
}

/**
 * @param {string} filePath
 * @param {Record<string, unknown>} document
 */
function writeRuntimeJson(filePath, document) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
}

/**
 * @param {{ artifactsRoot: string, reportsRoot: string }} runtimeLayout
 * @param {string} projectId
 * @param {string} runId
 */
function seedGuidedClosureArtifacts(runtimeLayout, projectId, runId) {
  writeRuntimeJson(path.join(runtimeLayout.reportsRoot, `step-result-${runId}.json`), {
    step_result_id: `${runId}.implement.pass`,
    project_id: projectId,
    run_id: runId,
    step_id: "run.start.implement",
    step_class: "runner",
    status: "pass",
    evidence_refs: [`evidence://reports/step-result-${runId}.json`],
  });
  writeRuntimeJson(path.join(runtimeLayout.reportsRoot, `review-report-${runId}.json`), {
    review_report_id: `${runId}.review-report.v1`,
    project_id: projectId,
    run_id: runId,
    overall_status: "pass",
    review_recommendation: "proceed",
    findings: [],
    evidence_refs: [`evidence://reports/step-result-${runId}.json`],
  });
  writeRuntimeJson(path.join(runtimeLayout.reportsRoot, `runtime-harness-report-${runId}.json`), {
    report_id: `${runId}.runtime-harness-report.v1`,
    project_id: projectId,
    run_id: runId,
    overall_decision: "pass",
    run_findings: [],
    evidence_refs: [`evidence://reports/step-result-${runId}.json`],
  });
  writeRuntimeJson(path.join(runtimeLayout.reportsRoot, `review-decision-${runId}-approve.json`), {
    decision_id: `${runId}.review-decision.approve.v1`,
    project_id: projectId,
    run_id: runId,
    decision: "approve",
    decider_ref: "operator://web-test",
    reason: "Approved guided web closure fixture.",
    review_report_ref: `evidence://reports/review-report-${runId}.json`,
    runtime_harness_report_ref: `evidence://reports/runtime-harness-report-${runId}.json`,
    delivery_manifest_refs: [],
    learning_handoff_refs: [],
    decision_basis: {
      review_overall_status: "pass",
      review_recommendation: "proceed",
      runtime_harness_overall_decision: "pass",
      blocking_findings: [],
    },
    delivery_gate: {
      status: "pass",
      blocks_downstream: false,
      required_downstream_decision: "approve",
      findings: [],
    },
    evidence_refs: [`evidence://reports/review-report-${runId}.json`, `evidence://reports/runtime-harness-report-${runId}.json`],
    decided_at: "2026-05-06T00:00:00.000Z",
  });
  writeRuntimeJson(path.join(runtimeLayout.artifactsRoot, `delivery-plan-${runId}.json`), {
    plan_id: `${runId}.delivery-plan.implement.v1`,
    project_id: projectId,
    run_id: runId,
    step_class: "implement",
    delivery_mode: "patch-only",
    status: "ready",
    blocking_reasons: [],
    evidence_refs: [`evidence://reports/review-decision-${runId}-approve.json`],
  });
  writeRuntimeJson(path.join(runtimeLayout.artifactsRoot, `delivery-manifest-${runId}.json`), {
    manifest_id: `${runId}.delivery-manifest.v1`,
    project_id: projectId,
    run_refs: [runId],
    status: "submitted",
    repo_deliveries: [{ repo_id: "target", writeback_result: "patch-created" }],
    evidence_refs: [`evidence://artifacts/delivery-plan-${runId}.json`],
  });
  writeRuntimeJson(path.join(runtimeLayout.artifactsRoot, `release-packet-${runId}.json`), {
    packet_id: `${runId}.release-packet.v1`,
    project_id: projectId,
    run_refs: [runId],
    status: "ready-for-close",
    delivery_manifest_ref: `evidence://artifacts/delivery-manifest-${runId}.json`,
    evidence_lineage: {
      execution_refs: [`evidence://artifacts/delivery-plan-${runId}.json`],
      delivery_output_refs: [`evidence://artifacts/delivery-manifest-${runId}.json`],
    },
    evidence_refs: [`evidence://artifacts/delivery-manifest-${runId}.json`],
  });
}

test("web console snapshot builds run list and run detail from shared API contracts", async () => {
  await withTempProject(async (projectRoot) => {
    const runId = seedOperatorArtifacts(projectRoot);
    const snapshot = await buildOperatorConsoleSnapshot({
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
    assert.deepEqual(snapshot.strategic_snapshot.planner_metrics.metric_names, [
      "clean_close_rate",
      "retry_rate",
      "repair_rate",
      "blocker_rate",
    ]);
    assert.equal(typeof snapshot.finance_monitoring, "object");
    assert.deepEqual(snapshot.finance_monitoring.dimension_names, [
      "project",
      "route",
      "bundle",
      "compiler_revision",
      "adapter",
    ]);
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
    assert.ok(
      snapshot.api_ui_contract_alignment.read_model.includes("GET /api/projects/:projectId/planner-metrics"),
    );
    assert.ok(
      snapshot.api_ui_contract_alignment.read_model.includes("GET /api/projects/:projectId/finance-monitoring"),
    );
    assert.ok(
      snapshot.api_ui_contract_alignment.read_model.includes("GET /api/projects/:projectId/next-action-report"),
    );
    assert.equal(snapshot.guided_lifecycle.stages.length, 7);
    assert.equal(snapshot.guided_lifecycle.mutation_transport.available, true);

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
    assert.match(html, /Clean-close rate/);
    assert.match(html, /Finance Monitoring/);
    assert.match(html, /Telemetry state/);
    assert.match(html, /Guided lifecycle/);
    assert.match(html, /Lifecycle commands/);
    assert.match(html, /Runner interactions/);
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

    const session = await attachOperatorConsoleSession({
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

    const snapshotAfterDetach = await buildOperatorConsoleSnapshot({
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
    const transport = await createControlPlaneHttpServer({
      cwd: projectRoot,
      projectRef: projectRoot,
      host: "127.0.0.1",
      port: 0,
    });

    try {
      const attachResult = invokeCli([
        "ui",
        "attach",
        "--project-ref",
        projectRoot,
        "--run-id",
        runId,
        "--control-plane",
        transport.baseUrl,
      ]);
      assert.equal(attachResult.exitCode, 0, attachResult.stderr);

      const attachedSnapshot = await buildOperatorConsoleSnapshot({
        cwd: projectRoot,
        projectRef: projectRoot,
        runId,
      });
      assert.equal(attachedSnapshot.ui_lifecycle.ui_attached, true);
      assert.equal(attachedSnapshot.ui_lifecycle.connection_state, "connected");

      const detachResult = invokeCli(["ui", "detach", "--project-ref", projectRoot, "--run-id", runId]);
      assert.equal(detachResult.exitCode, 0, detachResult.stderr);

      const detachedSnapshot = await buildOperatorConsoleSnapshot({
        cwd: projectRoot,
        projectRef: projectRoot,
        runId,
      });
      assert.equal(detachedSnapshot.ui_lifecycle.ui_attached, false);
      assert.equal(detachedSnapshot.ui_lifecycle.connection_state, "detached");
      assert.ok(detachedSnapshot.runs.some((run) => run.run_id === runId));
    } finally {
      await transport.close();
    }
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
    const transport = await createControlPlaneHttpServer({
      cwd: projectRoot,
      projectRef: projectRoot,
      host: "127.0.0.1",
      port: 0,
    });

    try {
      const outputHtml = path.join(projectRoot, ".aor", "web", "operator-console-smoke.html");
      const run = await spawnNode(
        [
          path.join(workspaceRoot, "apps/web/scripts/operator-console-smoke.mjs"),
          "--project-ref",
          projectRoot,
          "--run-id",
          runId,
          "--control-plane",
          transport.baseUrl,
          "--output-html",
          outputHtml,
        ],
        { cwd: workspaceRoot },
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
        lifecycle_command_count: summary.lifecycle_command_count,
        interaction_count: summary.interaction_count,
        guided_lifecycle_state: summary.guided_lifecycle_state,
        guided_current_stage_id: summary.guided_current_stage_id,
        guided_stage_count: summary.guided_stage_count,
        lifecycle_mutation_path_present: Array.isArray(summary.contract_alignment.mutation_model)
          ? summary.contract_alignment.mutation_model.includes("POST /api/projects/:projectId/lifecycle-command/actions")
          : false,
        interaction_answer_path_present: Array.isArray(summary.contract_alignment.mutation_model)
          ? summary.contract_alignment.mutation_model.includes("POST /api/projects/:projectId/interactions/answers")
          : false,
        policy_history_path_present: Array.isArray(summary.contract_alignment.read_model)
          ? summary.contract_alignment.read_model.includes("GET /api/projects/:projectId/runs/:runId/policy-history")
          : false,
      };
      assert.deepEqual(subset, fixture);
    } finally {
      await transport.close();
    }
  });
});

test("web connected mode consumes detached HTTP/SSE transport while preserving detachable session behavior", async () => {
  await withTempProject(async (projectRoot) => {
    const runId = seedOperatorArtifacts(projectRoot);

    const transport = await createControlPlaneHttpServer({
      cwd: projectRoot,
      projectRef: projectRoot,
      host: "127.0.0.1",
      port: 0,
    });

    try {
      const attachResult = invokeCli([
        "ui",
        "attach",
        "--project-ref",
        projectRoot,
        "--run-id",
        runId,
        "--control-plane",
        transport.baseUrl,
      ]);
      assert.equal(attachResult.exitCode, 0, attachResult.stderr);

      const snapshot = await buildOperatorConsoleSnapshot({
        cwd: projectRoot,
        projectRef: projectRoot,
        runId,
      });
      assert.equal(snapshot.ui_lifecycle.connection_state, "connected");
      assert.equal(snapshot.api_ui_contract_alignment.binding_mode, "detached-http-sse");
      assert.equal(snapshot.api_ui_contract_alignment.control_plane, transport.baseUrl);
      assert.ok(
        snapshot.api_ui_contract_alignment.read_model.includes("GET /api/projects/:projectId/finance-monitoring"),
      );
      assert.equal(typeof snapshot.finance_monitoring.monitoring_loop.evidence_classes.production_monitoring.status, "string");

      const session = await attachOperatorConsoleSession({
        cwd: projectRoot,
        projectRef: projectRoot,
        runId,
        follow: true,
      });
      assert.equal(session.stream_protocol, "sse");
      assert.equal(session.stream_backpressure.policy, "bounded-replay-window");

      const streamedEvent = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("timed out waiting for connected-mode follow event")), 3000);
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
        payload: { code: "connected.mode.transport.follow" },
      });

      const received = /** @type {Record<string, unknown>} */ (await streamedEvent);
      assert.equal(received.event_type, "warning.raised");
      const reconnectAfterEventId = session.replay_events.at(-1)?.event_id;

      const detached = session.detach();
      assert.equal(detached.detached, true);
      assert.ok(detached.captured_event_count >= 1);

      const reconnectSession = await attachOperatorConsoleSession({
        cwd: projectRoot,
        projectRef: projectRoot,
        runId,
        follow: true,
        afterEventId: typeof reconnectAfterEventId === "string" ? reconnectAfterEventId : undefined,
      });
      const reconnectedEvent = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("timed out waiting for reconnected follow event")), 3000);
        const unsubscribe = reconnectSession.onEvent((event) => {
          clearTimeout(timeout);
          unsubscribe();
          resolve(event);
        });
      });

      appendRunEvent({
        projectRef: projectRoot,
        cwd: projectRoot,
        runId,
        eventType: "step.updated",
        payload: { step_id: "runner.review", status: "pass" },
      });

      const reconnected = /** @type {Record<string, unknown>} */ (await reconnectedEvent);
      assert.equal(reconnected.event_type, "step.updated");
      reconnectSession.detach();
    } finally {
      await transport.close();
    }
  });
});

test("web connected mode routes run-control and ui-lifecycle mutations through detached transport", async () => {
  await withTempProject(async (projectRoot) => {
    seedOperatorArtifacts(projectRoot);
    const runId = "run.web.transport.mutation.v1";
    const transport = await createControlPlaneHttpServer({
      cwd: projectRoot,
      projectRef: projectRoot,
      host: "127.0.0.1",
      port: 0,
    });

    try {
      const attachResult = invokeCli([
        "ui",
        "attach",
        "--project-ref",
        projectRoot,
        "--run-id",
        runId,
        "--control-plane",
        transport.baseUrl,
      ]);
      assert.equal(attachResult.exitCode, 0, attachResult.stderr);

      const remoteStart = await applyOperatorRunControl({
        cwd: projectRoot,
        projectRef: projectRoot,
        runId,
        action: "start",
      });
      assert.equal(remoteStart.binding_mode, "detached-http-mutation");
      assert.equal(remoteStart.run_control.action, "start");
      assert.equal(remoteStart.run_control.run_id, runId);
      assert.equal(remoteStart.run_control.blocked, false);

      const remoteDetach = await applyOperatorUiLifecycle({
        cwd: projectRoot,
        projectRef: projectRoot,
        runId,
        action: "detach",
      });
      assert.equal(remoteDetach.binding_mode, "detached-http-mutation");
      assert.equal(remoteDetach.ui_lifecycle.action, "detach");
      assert.equal(remoteDetach.ui_lifecycle.connection_state, "detached");

      const localPause = await applyOperatorRunControl({
        cwd: projectRoot,
        projectRef: projectRoot,
        runId,
        action: "pause",
      });
      assert.equal(localPause.binding_mode, "module-in-process");
      assert.equal(localPause.run_control.action, "pause");
      assert.equal(localPause.run_control.blocked, false);
      assert.equal(localPause.run_control.state.status, "paused");
    } finally {
      await transport.close();
    }
  });
});

test("web connected mode drives lifecycle commands through detached control-plane mutations", async () => {
  await withTempProject(async (projectRoot) => {
    const runId = seedOperatorArtifacts(projectRoot);
    const transport = await createControlPlaneHttpServer({
      cwd: projectRoot,
      projectRef: projectRoot,
      host: "127.0.0.1",
      port: 0,
    });

    try {
      const attachResult = invokeCli([
        "ui",
        "attach",
        "--project-ref",
        projectRoot,
        "--run-id",
        runId,
        "--control-plane",
        transport.baseUrl,
      ]);
      assert.equal(attachResult.exitCode, 0, attachResult.stderr);

      const result = await applyOperatorLifecycleCommand({
        cwd: projectRoot,
        projectRef: projectRoot,
        command: "intake create",
        flags: {
          request_title: "Web connected lifecycle intake",
          request_brief: "Submitted through the web full-flow console.",
        },
      });
      assert.equal(result.binding_mode, "detached-http-mutation");
      assert.equal(result.lifecycle_command.command, "intake create");
      assert.equal(result.lifecycle_command.blocked, false);
      assert.equal(fs.existsSync(result.lifecycle_command.command_output.artifact_packet_file), true);

      const snapshot = await buildOperatorConsoleSnapshot({
        cwd: projectRoot,
        projectRef: projectRoot,
        runId,
      });
      assert.ok(
        snapshot.api_ui_contract_alignment.mutation_model.includes(
          "POST /api/projects/:projectId/lifecycle-command/actions",
        ),
      );
      assert.ok(snapshot.api_ui_contract_alignment.lifecycle_commands.includes("intake create"));
    } finally {
      await transport.close();
    }
  });
});

test("guided web lifecycle progresses mission and next action through connected control-plane mutations", async () => {
  await withTempProject(async (projectRoot) => {
    fs.writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify({ name: "guided-web-success" }, null, 2), "utf8");
    fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
    const onboard = invokeCli(["onboard", projectRoot, "--json"]);
    assert.equal(onboard.exitCode, 0, onboard.stderr);

    const runId = "run.guided.web.success.v1";
    const transport = await createControlPlaneHttpServer({
      cwd: projectRoot,
      projectRef: projectRoot,
      host: "127.0.0.1",
      port: 0,
    });

    try {
      const attachResult = invokeCli([
        "ui",
        "attach",
        "--project-ref",
        projectRoot,
        "--run-id",
        runId,
        "--control-plane",
        transport.baseUrl,
      ]);
      assert.equal(attachResult.exitCode, 0, attachResult.stderr);

      const mission = await applyOperatorLifecycleCommand({
        cwd: projectRoot,
        projectRef: projectRoot,
        command: "mission create",
        flags: {
          mission_id: "guided-web-success",
          goal: "Make the web console show the guided lifecycle.",
          constraint: "Use control-plane lifecycle mutations.",
          kpi: "guided-web:Guided web:Operator sees next action:Console smoke",
          dod: "Console shows status, evidence, blockers, and next action.",
          allowed_path: "apps/web/**",
          forbidden_path: "secrets/**",
          delivery_mode: "patch-only",
          source_kind: "local-note",
          source_ref: "docs/ops/ui-attach-detach.md",
        },
      });
      assert.equal(mission.binding_mode, "detached-http-mutation");
      assert.equal(mission.lifecycle_command.command, "mission create");
      assert.equal(mission.lifecycle_command.command_output.product_intake_completeness.status, "complete");

      const next = await applyOperatorLifecycleCommand({
        cwd: projectRoot,
        projectRef: projectRoot,
        command: "next",
      });
      assert.equal(next.binding_mode, "detached-http-mutation");
      assert.equal(next.lifecycle_command.command_output.next_action_primary.action_id, "discovery-run");

      const snapshot = await buildOperatorConsoleSnapshot({
        cwd: projectRoot,
        projectRef: projectRoot,
        runId,
      });
      assert.equal(snapshot.api_ui_contract_alignment.binding_mode, "detached-http-sse");
      assert.ok(
        snapshot.api_ui_contract_alignment.read_model.includes("GET /api/projects/:projectId/next-action-report"),
      );
      assert.ok(snapshot.api_ui_contract_alignment.lifecycle_commands.includes("mission create"));
      assert.ok(snapshot.api_ui_contract_alignment.lifecycle_commands.includes("next"));
      assert.equal(snapshot.guided_lifecycle.current_stage_id, "discovery-spec-plan");
      assert.equal(snapshot.guided_lifecycle.stages.length, 7);
      const missionStage = snapshot.guided_lifecycle.stages.find((stage) => stage.stage_id === "mission");
      const discoveryStage = snapshot.guided_lifecycle.stages.find((stage) => stage.stage_id === "discovery-spec-plan");
      assert.equal(missionStage?.status, "done");
      assert.equal(discoveryStage?.status, "ready");
      assert.equal(discoveryStage?.next_action.mutation.transport, "control-plane");
      assert.equal(discoveryStage?.next_action.mutation.command, "discovery run");
      assert.equal(discoveryStage?.next_action.command.includes("aor discovery run"), true);
      assert.ok((discoveryStage?.evidence_refs.length ?? 0) > 0);

      const html = renderOperatorConsoleHtml(snapshot);
      assert.match(html, /Guided lifecycle/);
      assert.match(html, /Discovery, Spec, Plan/);
      assert.match(html, /aor discovery run/);

      seedGuidedClosureArtifacts(
        mission.lifecycle_command.command_output.runtime_layout,
        transport.projectId,
        "run.guided.web.closure.v1",
      );
      const closureNext = await applyOperatorLifecycleCommand({
        cwd: projectRoot,
        projectRef: projectRoot,
        command: "next",
      });
      assert.equal(closureNext.lifecycle_command.command_output.next_action_primary.action_id, "learning-handoff");
      assert.equal(
        closureNext.lifecycle_command.command_output.next_action_closure_state.delivery.status,
        "release-ready",
      );

      const closureSnapshot = await buildOperatorConsoleSnapshot({
        cwd: projectRoot,
        projectRef: projectRoot,
        runId: "run.guided.web.closure.v1",
      });
      assert.equal(closureSnapshot.guided_lifecycle.current_stage_id, "learning");
      assert.equal(closureSnapshot.guided_lifecycle.closure_state.run_id, "run.guided.web.closure.v1");
      const reviewStage = closureSnapshot.guided_lifecycle.stages.find((stage) => stage.stage_id === "review-qa");
      const deliveryStage = closureSnapshot.guided_lifecycle.stages.find((stage) => stage.stage_id === "delivery-release");
      const learningStage = closureSnapshot.guided_lifecycle.stages.find((stage) => stage.stage_id === "learning");
      assert.equal(reviewStage?.closure_state.status, "approved");
      assert.equal(reviewStage?.safety_gates.delivery_gate_status, "pass");
      assert.equal(deliveryStage?.closure_state.status, "release-ready");
      assert.equal(learningStage?.status, "ready");
      assert.equal(learningStage?.next_action.mutation.command, "learning handoff");
      assert.ok((learningStage?.evidence_refs.length ?? 0) > 0);

      const closureHtml = renderOperatorConsoleHtml(closureSnapshot);
      assert.match(closureHtml, /learning handoff/);
      assert.match(closureHtml, /ready-for-close/);
    } finally {
      await transport.close();
    }
  });
});

test("guided web lifecycle renders blocked and read-only states without losing evidence", async () => {
  await withTempProject(async (projectRoot) => {
    fs.writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify({ name: "guided-web-blocked" }, null, 2), "utf8");
    fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
    const onboard = invokeCli(["onboard", projectRoot, "--json"]);
    assert.equal(onboard.exitCode, 0, onboard.stderr);

    const runId = "run.guided.web.blocked.v1";
    const transport = await createControlPlaneHttpServer({
      cwd: projectRoot,
      projectRef: projectRoot,
      host: "127.0.0.1",
      port: 0,
    });

    try {
      const attachResult = invokeCli([
        "ui",
        "attach",
        "--project-ref",
        projectRoot,
        "--run-id",
        runId,
        "--control-plane",
        transport.baseUrl,
      ]);
      assert.equal(attachResult.exitCode, 0, attachResult.stderr);

      const incompleteMission = await applyOperatorLifecycleCommand({
        cwd: projectRoot,
        projectRef: projectRoot,
        command: "mission create",
        flags: {
          mission_id: "guided-web-blocked",
          goal: "Expose a blocked guided web stage.",
          constraint: "Keep blocked reasons explicit.",
          source_kind: "local-note",
          source_ref: "docs/ops/ui-attach-detach.md",
        },
      });
      assert.equal(incompleteMission.binding_mode, "detached-http-mutation");
      assert.equal(incompleteMission.lifecycle_command.command_output.product_intake_completeness.status, "incomplete");

      const next = await applyOperatorLifecycleCommand({
        cwd: projectRoot,
        projectRef: projectRoot,
        command: "next",
      });
      assert.equal(next.lifecycle_command.command_output.next_action_status, "blocked");

      const snapshot = await buildOperatorConsoleSnapshot({
        cwd: projectRoot,
        projectRef: projectRoot,
        runId,
      });
      assert.equal(snapshot.guided_lifecycle.state, "blocked");
      assert.equal(snapshot.guided_lifecycle.current_stage_id, "mission");
      const missionStage = snapshot.guided_lifecycle.stages.find((stage) => stage.stage_id === "mission");
      assert.equal(missionStage?.status, "blocked");
      assert.ok(missionStage?.blockers.some((blocker) => blocker.code === "mission-kpis-missing"));
      assert.ok(missionStage?.blockers.some((blocker) => blocker.code === "mission-definition_of_done-missing"));
      assert.equal(missionStage?.next_action.mutation.command, "mission create");

      const readOnlySnapshot = await buildOperatorConsoleSnapshot({
        cwd: projectRoot,
        projectRef: projectRoot,
        runId,
        readOnly: true,
      });
      const readOnlyMissionStage = readOnlySnapshot.guided_lifecycle.stages.find((stage) => stage.stage_id === "mission");
      assert.equal(readOnlySnapshot.guided_lifecycle.state, "read_only");
      assert.equal(readOnlyMissionStage?.next_action.mutation.available, false);
      assert.ok((readOnlyMissionStage?.evidence_refs.length ?? 0) > 0);

      const html = renderOperatorConsoleHtml(readOnlySnapshot);
      assert.match(html, /mission-kpis-missing/);
      assert.match(html, /read-only/);
    } finally {
      await transport.close();
    }
  });
});

test("web connected mode surfaces runner questions and submits blocked interaction answers", async () => {
  await withTempProject(async (projectRoot) => {
    const runId = seedOperatorArtifacts(projectRoot);
    const interactionId = "web-question-1";
    const stepResultFile = seedRequestedInteraction(projectRoot, runId, interactionId);
    const transport = await createControlPlaneHttpServer({
      cwd: projectRoot,
      projectRef: projectRoot,
      host: "127.0.0.1",
      port: 0,
    });

    try {
      const attachResult = invokeCli([
        "ui",
        "attach",
        "--project-ref",
        projectRoot,
        "--run-id",
        runId,
        "--control-plane",
        transport.baseUrl,
      ]);
      assert.equal(attachResult.exitCode, 0, attachResult.stderr);

      const beforeSnapshot = await buildOperatorConsoleSnapshot({
        cwd: projectRoot,
        projectRef: projectRoot,
        runId,
      });
      const interaction = beforeSnapshot.run_detail.interactions.find(
        (entry) => entry.interaction_id === interactionId,
      );
      assert.equal(interaction?.answer_required, true);
      const beforeHtml = renderOperatorConsoleHtml(beforeSnapshot);
      assert.match(beforeHtml, /web-question-1/);
      assert.match(beforeHtml, /Select the operator-approved target/);

      const answerText = "Use staging.";
      const answer = await submitOperatorInteractionAnswer({
        cwd: projectRoot,
        projectRef: projectRoot,
        runId,
        interactionId,
        answer: answerText,
        reason: "operator selected safe target",
      });
      assert.equal(answer.binding_mode, "detached-http-mutation");
      assert.equal(answer.error.code, "interaction.continuation_blocked");
      assert.equal(answer.interaction_answer.answer_accepted, true);
      assert.equal(answer.interaction_answer.interaction_status, "blocked");

      const updatedStepResult = JSON.parse(fs.readFileSync(stepResultFile, "utf8"));
      assert.equal(JSON.stringify(updatedStepResult).includes(answerText), false);
      assert.equal(updatedStepResult.requested_interaction.status, "blocked");
      assert.deepEqual(
        updatedStepResult.requested_interaction.state_history.map((entry) => entry.status),
        ["requested", "answered", "blocked"],
      );
      assert.ok(updatedStepResult.requested_interaction.answer_audit_refs.includes(answer.interaction_answer.answer_audit_ref));

      const afterSnapshot = await buildOperatorConsoleSnapshot({
        cwd: projectRoot,
        projectRef: projectRoot,
        runId,
      });
      const updatedInteraction = afterSnapshot.run_detail.interactions.find(
        (entry) => entry.interaction_id === interactionId,
      );
      assert.equal(updatedInteraction?.interaction_status, "blocked");
      assert.equal(updatedInteraction?.answer_required, false);
      assert.equal(JSON.stringify(afterSnapshot).includes(answerText), false);
      assert.equal(renderOperatorConsoleHtml(afterSnapshot).includes(answerText), false);
      assert.equal(
        JSON.stringify(afterSnapshot.run_detail.event_history).includes(answer.interaction_answer.answer_audit_ref),
        true,
      );

      const session = await attachOperatorConsoleSession({
        cwd: projectRoot,
        projectRef: projectRoot,
        runId,
        follow: true,
      });
      const replayCount = session.replay_events.length;
      const detached = session.detach();
      assert.equal(detached.detached, true);
      assert.equal(detached.captured_event_count, replayCount);
    } finally {
      await transport.close();
    }
  });
});

test("web connected mode supports auth-enabled detached transport with bearer token", async () => {
  await withTempProject(async (projectRoot) => {
    const runId = seedOperatorArtifacts(projectRoot);
    const transport = await createControlPlaneHttpServer({
      cwd: projectRoot,
      projectRef: projectRoot,
      host: "127.0.0.1",
      port: 0,
      auth: {
        enabled: true,
        tokens: [
          {
            token: "reader-token",
            token_id: "reader",
            permissions: ["read"],
          },
          {
            token: "operator-token",
            token_id: "operator",
            permissions: ["read", "mutate"],
          },
        ],
      },
    });

    try {
      const attachResult = invokeCli([
        "ui",
        "attach",
        "--project-ref",
        projectRoot,
        "--run-id",
        runId,
        "--control-plane",
        transport.baseUrl,
      ]);
      assert.equal(attachResult.exitCode, 0, attachResult.stderr);

      await assert.rejects(
        () =>
          buildOperatorConsoleSnapshot({
            cwd: projectRoot,
            projectRef: projectRoot,
            runId,
          }),
        /Control-plane request failed \(401\)/,
      );

      const snapshot = await buildOperatorConsoleSnapshot({
        cwd: projectRoot,
        projectRef: projectRoot,
        runId,
        controlPlaneAuthToken: "reader-token",
      });
      assert.equal(snapshot.api_ui_contract_alignment.binding_mode, "detached-http-sse");
      assert.equal(snapshot.api_ui_contract_alignment.auth_mode, "optional-bearer-token");

      await assert.rejects(
        () =>
          applyOperatorRunControl({
            cwd: projectRoot,
            projectRef: projectRoot,
            runId,
            action: "start",
            controlPlaneAuthToken: "reader-token",
          }),
        /Control-plane mutation failed \(403\)/,
      );

      const controlResult = await applyOperatorRunControl({
        cwd: projectRoot,
        projectRef: projectRoot,
        runId,
        action: "start",
        controlPlaneAuthToken: "operator-token",
      });
      assert.equal(controlResult.binding_mode, "detached-http-mutation");
      assert.equal(controlResult.run_control.action, "start");
    } finally {
      await transport.close();
    }
  });
});
