import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { withTempRepo as withTempRepoHelper } from "../../../scripts/test/helpers/temp-repo.mjs";
import { validateContractDocument } from "../../../packages/contracts/src/index.mjs";
import { materializeCompilerRevisionStatus } from "../../../packages/orchestrator-core/src/compiler-revision.mjs";
import { materializeMultirepoCoordinationStatus } from "../../../packages/orchestrator-core/src/multirepo-coordination.mjs";
import { initializeProjectRuntime } from "../../../packages/orchestrator-core/src/project-init.mjs";
import { applyRunControlAction, appendRunEvent, createControlPlaneHttpServer } from "../src/index.mjs";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const workspaceRoot = path.resolve(currentDir, "../../..");

/**
 * @param {(repoRoot: string) => Promise<void> | void} callback
 */
async function withTempRepo(callback) {
  await withTempRepoHelper({ prefix: "aor-w9-s07-api-http-", workspaceRoot }, callback);
}

/**
 * @param {{ family: import("../../../packages/contracts/src/index.d.ts").ContractFamily, filePath: string, document: Record<string, unknown> }} options
 */
function writeContractFile(options) {
  const validation = validateContractDocument({
    family: options.family,
    document: options.document,
    source: `runtime://${options.family}`,
  });
  assert.equal(validation.ok, true, `${options.family} fixture must pass contract validation`);
  fs.writeFileSync(options.filePath, `${JSON.stringify(options.document, null, 2)}\n`, "utf8");
}

/**
 * @param {{ repoRoot: string, count: number }} options
 * @returns {ReturnType<typeof initializeProjectRuntime>}
 */
function seedPromotionDecisions(options) {
  const init = initializeProjectRuntime({ projectRef: options.repoRoot, cwd: options.repoRoot });
  for (let index = 0; index < options.count; index += 1) {
    writeContractFile({
      family: "promotion-decision",
      filePath: path.join(init.runtimeLayout.artifactsRoot, `promotion-decision-scale-${String(index).padStart(3, "0")}.json`),
      document: {
        decision_id: `${init.projectId}.promotion.scale.${index}`,
        subject_ref: "wrapper://wrapper.runner.default@v3",
        from_channel: "candidate",
        to_channel: "stable",
        evidence_refs: [init.stateFile],
        evidence_summary: {
          reason: "seed fixture for bounded read-model smoke test",
        },
        status: "pass",
      },
    });
  }
  return init;
}

test("detached control-plane source checkout smoke command verifies local API transport", async () => {
  await withTempRepo((repoRoot) => {
    const runtimeRoot = path.join(repoRoot, ".aor-smoke");
    const result = spawnSync(
      process.execPath,
      [
        path.join(workspaceRoot, "apps/api/scripts/control-plane-smoke.mjs"),
        "--project-ref",
        repoRoot,
        "--runtime-root",
        runtimeRoot,
        "--host",
        "127.0.0.1",
        "--port",
        "0",
        "--json",
      ],
      {
        cwd: workspaceRoot,
        encoding: "utf8",
      },
    );

    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.status, "ready");
    assert.match(payload.base_url, /^http:\/\/127\.0\.0\.1:\d+$/u);
    assert.match(payload.state_url, /^http:\/\/127\.0\.0\.1:\d+\/api\/projects\/[^/]+\/state$/u);
    assert.equal(payload.serve, false);
    assert.equal(fs.existsSync(path.join(runtimeRoot, "projects", payload.project_id, "state", "project-init-state.json")), true);
  });
});

/**
 * @param {Response} response
 * @param {{ timeoutMs?: number }} [options]
 */
async function readNextLiveRunEvent(response, options = {}) {
  const events = await readLiveRunEvents(response, { ...options, count: 1 });
  return events[0];
}

/**
 * @param {Response} response
 * @param {{ timeoutMs?: number, count?: number }} [options]
 */
async function readLiveRunEvents(response, options = {}) {
  const timeoutMs = options.timeoutMs ?? 3000;
  const count = options.count ?? 1;
  if (!response.body) {
    throw new Error("SSE response body is missing.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const timeoutAt = Date.now() + timeoutMs;
  const events = [];

  try {
    while (Date.now() < timeoutAt && events.length < count) {
      const remaining = timeoutAt - Date.now();
      const readResult = await Promise.race([
        reader.read(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timed out waiting for SSE event")), remaining)),
      ]);

      if (readResult.done) {
        break;
      }

      buffer += decoder.decode(readResult.value, { stream: true });

      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");

        const normalized = block.replace(/\r/g, "");
        const lines = normalized.split("\n");
        let event = "message";
        let data = "";
        for (const line of lines) {
          if (line.startsWith("event:")) {
            event = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            data = data.length > 0 ? `${data}\n${line.slice(5).trimStart()}` : line.slice(5).trimStart();
          }
        }

        if (event !== "live-run-event" || data.length === 0) {
          continue;
        }

        events.push(JSON.parse(data));
        if (events.length >= count) {
          return events;
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  throw new Error("timed out waiting for live-run-event payload");
}

/**
 * @param {string} url
 * @param {Record<string, unknown>} payload
 */
async function postJson(url, payload) {
  return fetch(url, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(payload),
  });
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
function writeApprovedClosureArtifacts(runtimeLayout, projectId, runId) {
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
    decider_ref: "operator://api-test",
    reason: "Approved closure API fixture.",
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
}

/**
 * @param {string} url
 * @param {string | null} token
 */
async function getJson(url, token = null) {
  /** @type {Record<string, string>} */
  const headers = {
    accept: "application/json",
  };
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  return fetch(url, { headers });
}

/**
 * @param {string} url
 * @param {Record<string, unknown>} payload
 * @param {string | null} token
 */
async function postJsonWithToken(url, payload, token = null) {
  /** @type {Record<string, string>} */
  const headers = {
    accept: "application/json",
    "content-type": "application/json; charset=utf-8",
  };
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  return fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
}

test("detached control-plane transport serves read baseline endpoints", async () => {
  await withTempRepo(async (repoRoot) => {
    const runId = "run.http.transport.read.v1";
    applyRunControlAction({
      projectRef: repoRoot,
      cwd: repoRoot,
      runId,
      action: "start",
    });
    appendRunEvent({
      projectRef: repoRoot,
      cwd: repoRoot,
      runId,
      eventType: "step.updated",
      payload: {
        step_id: "runner.implement",
        status: "pass",
      },
    });
    materializeMultirepoCoordinationStatus({
      projectRef: repoRoot,
      cwd: repoRoot,
      action: "inspect",
      runId: "run.http.transport.multirepo",
      repoIds: ["backend", "frontend"],
      repoValidationRefs: [
        "backend=validation://repos/backend/profile-entry",
        "frontend=validation://repos/frontend/profile-entry",
      ],
    });
    materializeCompilerRevisionStatus({
      projectRef: repoRoot,
      cwd: repoRoot,
      compilerRevisionRef: "compiler-revision://runtime-context-compiler@v1",
      action: "promote",
      promotionDecisionRef: "evidence://.aor/projects/http/artifacts/promotion-decision-compiler-v1.json",
      compiledContextRefs: ["compiled-context://compiled-context.http.implement.runtime-context-compiler"],
      evaluationRefs: ["evidence://.aor/projects/http/reports/evaluation-report-runtime-context-compiler.json"],
      compatibilityStatus: "compatible",
    });

    const transport = await createControlPlaneHttpServer({
      projectRef: repoRoot,
      cwd: repoRoot,
      host: "127.0.0.1",
      port: 0,
    });

    try {
      const stateResponse = await fetch(`${transport.baseUrl}/api/projects/${transport.projectId}/state`);
      assert.equal(stateResponse.status, 200);
      const state = await stateResponse.json();
      assert.equal(state.project_root, repoRoot);

      const runsResponse = await fetch(`${transport.baseUrl}/api/projects/${transport.projectId}/runs`);
      assert.equal(runsResponse.status, 200);
      const runs = await runsResponse.json();
      assert.ok(runs.some((run) => run.run_id === runId));

      const historyResponse = await fetch(
        `${transport.baseUrl}/api/projects/${transport.projectId}/runs/${runId}/events/history?limit=25`,
      );
      assert.equal(historyResponse.status, 200);
      const history = await historyResponse.json();
      assert.equal(history.run_id, runId);
      assert.ok(history.total_events >= 2);

      const policyResponse = await fetch(
        `${transport.baseUrl}/api/projects/${transport.projectId}/runs/${runId}/policy-history?limit=25`,
      );
      assert.equal(policyResponse.status, 200);
      const policyHistory = await policyResponse.json();
      assert.equal(policyHistory.run_id, runId);
      assert.equal(Array.isArray(policyHistory.entries), true);

      const deliveryResponse = await fetch(
        `${transport.baseUrl}/api/projects/${transport.projectId}/delivery-manifests`,
      );
      assert.equal(deliveryResponse.status, 200);
      const deliveryManifests = await deliveryResponse.json();
      assert.equal(Array.isArray(deliveryManifests), true);

      const promotionResponse = await fetch(
        `${transport.baseUrl}/api/projects/${transport.projectId}/promotion-decisions`,
      );
      assert.equal(promotionResponse.status, 200);
      const promotionDecisions = await promotionResponse.json();
      assert.equal(Array.isArray(promotionDecisions), true);

      const strategicResponse = await fetch(
        `${transport.baseUrl}/api/projects/${transport.projectId}/strategic-snapshot`,
      );
      assert.equal(strategicResponse.status, 200);
      const strategicSnapshot = await strategicResponse.json();
      assert.equal(typeof strategicSnapshot.wave_snapshot.total_slices, "number");
      assert.equal(strategicSnapshot.planner_metrics.metric_names.includes("clean_close_rate"), true);

      const plannerMetricsResponse = await fetch(
        `${transport.baseUrl}/api/projects/${transport.projectId}/planner-metrics`,
      );
      assert.equal(plannerMetricsResponse.status, 200);
      const plannerMetrics = await plannerMetricsResponse.json();
      assert.deepEqual(plannerMetrics.metric_names, strategicSnapshot.planner_metrics.metric_names);

      const financeMonitoringResponse = await fetch(
        `${transport.baseUrl}/api/projects/${transport.projectId}/finance-monitoring`,
      );
      assert.equal(financeMonitoringResponse.status, 200);
      const financeMonitoring = await financeMonitoringResponse.json();
      assert.deepEqual(financeMonitoring.dimension_names, strategicSnapshot.finance_monitoring.dimension_names);
      assert.equal(typeof financeMonitoring.monitoring_loop.evidence_classes.production_monitoring.status, "string");

      const multirepoResponse = await fetch(
        `${transport.baseUrl}/api/projects/${transport.projectId}/multirepo-coordination`,
      );
      assert.equal(multirepoResponse.status, 200);
      const multirepoStatuses = await multirepoResponse.json();
      assert.equal(Array.isArray(multirepoStatuses), true);
      assert.ok(multirepoStatuses.some((entry) => entry.family === "multirepo-coordination-status"));

      const compilerRevisionResponse = await fetch(
        `${transport.baseUrl}/api/projects/${transport.projectId}/compiler-revisions`,
      );
      assert.equal(compilerRevisionResponse.status, 200);
      const compilerRevisionStatuses = await compilerRevisionResponse.json();
      assert.equal(Array.isArray(compilerRevisionStatuses), true);
      assert.ok(compilerRevisionStatuses.some((entry) => entry.family === "compiler-revision-status"));

      const nextActionResponse = await fetch(
        `${transport.baseUrl}/api/projects/${transport.projectId}/next-action-report`,
      );
      assert.equal(nextActionResponse.status, 200);
      assert.equal(await nextActionResponse.json(), null);
    } finally {
      await transport.close();
    }
  });
});

test("detached control-plane read routes bound large runtime artifact windows", async () => {
  await withTempRepo(async (repoRoot) => {
    seedPromotionDecisions({ repoRoot, count: 225 });

    const transport = await createControlPlaneHttpServer({
      projectRef: repoRoot,
      cwd: repoRoot,
      host: "127.0.0.1",
      port: 0,
    });

    try {
      const defaultResponse = await fetch(`${transport.baseUrl}/api/projects/${transport.projectId}/promotion-decisions`);
      assert.equal(defaultResponse.status, 200);
      const defaultDecisions = await defaultResponse.json();
      assert.equal(defaultDecisions.length <= 200, true);
      assert.equal(defaultDecisions.length > 0, true);

      const explicitLimitResponse = await fetch(
        `${transport.baseUrl}/api/projects/${transport.projectId}/promotion-decisions?limit=5`,
      );
      assert.equal(explicitLimitResponse.status, 200);
      const explicitLimitDecisions = await explicitLimitResponse.json();
      assert.equal(explicitLimitDecisions.length, 5);

      const cappedLimitResponse = await fetch(
        `${transport.baseUrl}/api/projects/${transport.projectId}/promotion-decisions?limit=5000`,
      );
      assert.equal(cappedLimitResponse.status, 200);
      const cappedLimitDecisions = await cappedLimitResponse.json();
      assert.equal(cappedLimitDecisions.length, 225);
    } finally {
      await transport.close();
    }
  });
});

test("detached control-plane transport streams follow events through SSE", async () => {
  await withTempRepo(async (repoRoot) => {
    const runId = "run.http.transport.follow.v1";
    appendRunEvent({
      projectRef: repoRoot,
      cwd: repoRoot,
      runId,
      eventType: "run.started",
      payload: {
        status: "running",
      },
    });

    const transport = await createControlPlaneHttpServer({
      projectRef: repoRoot,
      cwd: repoRoot,
      host: "127.0.0.1",
      port: 0,
    });

    try {
      const historyResponse = await fetch(
        `${transport.baseUrl}/api/projects/${transport.projectId}/runs/${runId}/events/history?limit=10`,
      );
      assert.equal(historyResponse.status, 200);
      const history = await historyResponse.json();
      const lastEventId = history.events.at(-1)?.event_id;
      assert.equal(typeof lastEventId, "string");

      const controller = new AbortController();
      const streamResponse = await fetch(
        `${transport.baseUrl}/api/projects/${transport.projectId}/runs/${runId}/events?after_event_id=${encodeURIComponent(lastEventId)}`,
        {
          headers: {
            accept: "text/event-stream",
          },
          signal: controller.signal,
        },
      );
      assert.equal(streamResponse.status, 200);

      const nextEventPromise = readNextLiveRunEvent(streamResponse, { timeoutMs: 3000 });
      appendRunEvent({
        projectRef: repoRoot,
        cwd: repoRoot,
        runId,
        eventType: "warning.raised",
        payload: {
          code: "scope.target_step_required",
          summary: "Transport follow smoke warning.",
        },
      });

      const streamed = await nextEventPromise;
      assert.equal(streamed.event_type, "warning.raised");
      assert.equal(streamed.summary, "Transport follow smoke warning.");
      controller.abort();
    } finally {
      await transport.close();
    }
  });
});

test("detached control-plane transport supports bounded run-control and ui-lifecycle mutations", async () => {
  await withTempRepo(async (repoRoot) => {
    const runId = "run.http.transport.mutation.v1";
    const transport = await createControlPlaneHttpServer({
      projectRef: repoRoot,
      cwd: repoRoot,
      host: "127.0.0.1",
      port: 0,
    });

    try {
      const startResponse = await postJson(
        `${transport.baseUrl}/api/projects/${transport.projectId}/run-control/actions`,
        {
          action: "start",
          run_id: runId,
          reason: "http transport mutation smoke",
        },
      );
      assert.equal(startResponse.status, 200);
      const startPayload = await startResponse.json();
      assert.equal(startPayload.run_control.action, "start");
      assert.equal(startPayload.run_control.run_id, runId);
      assert.equal(startPayload.run_control.blocked, false);
      assert.equal(startPayload.run_control.state.status, "running");
      assert.equal(fs.existsSync(startPayload.run_control.audit_file), true);
      assert.equal(fs.existsSync(startPayload.run_control.state_file), true);

      const blockedResponse = await postJson(
        `${transport.baseUrl}/api/projects/${transport.projectId}/run-control/actions`,
        {
          action: "cancel",
          run_id: runId,
          reason: "cancel without approval should stay blocked",
        },
      );
      assert.equal(blockedResponse.status, 409);
      const blockedPayload = await blockedResponse.json();
      assert.equal(blockedPayload.error.code, "approval.required");
      assert.equal(blockedPayload.run_control.action, "cancel");
      assert.equal(blockedPayload.run_control.blocked, true);
      assert.equal(fs.existsSync(blockedPayload.run_control.audit_file), true);
      assert.equal(fs.existsSync(blockedPayload.run_control.state_file), true);

      const uiAttachResponse = await postJson(
        `${transport.baseUrl}/api/projects/${transport.projectId}/ui-lifecycle/actions`,
        {
          action: "attach",
          run_id: runId,
          control_plane: transport.baseUrl,
        },
      );
      assert.equal(uiAttachResponse.status, 200);
      const uiAttachPayload = await uiAttachResponse.json();
      assert.equal(uiAttachPayload.ui_lifecycle.action, "attach");
      assert.equal(uiAttachPayload.ui_lifecycle.connection_state, "connected");
      assert.equal(uiAttachPayload.ui_lifecycle.headless_safe, true);
      assert.equal(fs.existsSync(uiAttachPayload.ui_lifecycle.state_file), true);

      const uiDetachResponse = await postJson(
        `${transport.baseUrl}/api/projects/${transport.projectId}/ui-lifecycle/actions`,
        {
          action: "detach",
          run_id: runId,
        },
      );
      assert.equal(uiDetachResponse.status, 200);
      const uiDetachPayload = await uiDetachResponse.json();
      assert.equal(uiDetachPayload.ui_lifecycle.action, "detach");
      assert.equal(uiDetachPayload.ui_lifecycle.connection_state, "detached");
      assert.equal(uiDetachPayload.ui_lifecycle.headless_safe, true);

      const invalidActionResponse = await postJson(
        `${transport.baseUrl}/api/projects/${transport.projectId}/run-control/actions`,
        {
          action: "explode",
          run_id: runId,
        },
      );
      assert.equal(invalidActionResponse.status, 400);
      const invalidActionPayload = await invalidActionResponse.json();
      assert.equal(invalidActionPayload.error.code, "invalid_run_control_action");
    } finally {
      await transport.close();
    }
  });
});

test("detached control-plane transport invokes bounded lifecycle command mutations through CLI/runtime path", async () => {
  await withTempRepo(async (repoRoot) => {
    const runId = "run.http.transport.lifecycle.v1";
    const transport = await createControlPlaneHttpServer({
      projectRef: repoRoot,
      cwd: repoRoot,
      host: "127.0.0.1",
      port: 0,
    });

    try {
      const commandUrl = `${transport.baseUrl}/api/projects/${transport.projectId}/lifecycle-command/actions`;

      const successResponse = await postJson(commandUrl, {
        command: "intake create",
        flags: {
          request_title: "Connected lifecycle command smoke",
          request_brief: "Exercise control-plane lifecycle mutation parity.",
        },
      });
      assert.equal(successResponse.status, 200);
      const successPayload = await successResponse.json();
      assert.equal(successPayload.lifecycle_command.command, "intake create");
      assert.equal(successPayload.lifecycle_command.blocked, false);
      assert.equal(successPayload.lifecycle_command.command_output.command, "intake create");
      assert.equal(fs.existsSync(successPayload.lifecycle_command.command_output.artifact_packet_file), true);
      assert.ok(successPayload.lifecycle_command.artifact_refs.includes(successPayload.lifecycle_command.command_output.artifact_packet_file));

      const missionResponse = await postJson(commandUrl, {
        command: "mission create",
        flags: {
          mission_id: "web-guided-flow",
          goal: "Expose guided lifecycle in the web console.",
          constraint: "Keep orchestration owned by the runtime.",
          kpi: "guided-web:Guided web:Operator reaches next action:Console smoke",
          dod: "Console shows blockers, evidence, and next action.",
          allowed_path: "apps/web/**",
          forbidden_path: "secrets/**",
          delivery_mode: "patch-only",
          source_kind: "local-note",
          source_ref: "docs/ops/ui-attach-detach.md",
        },
      });
      assert.equal(missionResponse.status, 200);
      const missionPayload = await missionResponse.json();
      assert.equal(missionPayload.lifecycle_command.command, "mission create");
      assert.equal(missionPayload.lifecycle_command.blocked, false);
      assert.equal(missionPayload.lifecycle_command.command_output.product_intake_completeness.status, "complete");

      const packetsResponse = await fetch(`${transport.baseUrl}/api/projects/${transport.projectId}/packets`);
      assert.equal(packetsResponse.status, 200);
      const packetsPayload = await packetsResponse.json();
      assert.equal(
        packetsPayload.some(
          (entry) => entry.family === "artifact-packet" && entry.document.packet_type === "intake-request",
        ),
        true,
      );

      const nextResponse = await postJson(commandUrl, {
        command: "next",
        flags: {},
      });
      assert.equal(nextResponse.status, 200);
      const nextPayload = await nextResponse.json();
      assert.equal(nextPayload.lifecycle_command.command, "next");
      assert.equal(nextPayload.lifecycle_command.command_output.next_action_primary.action_id, "discovery-run");
      assert.equal(fs.existsSync(nextPayload.lifecycle_command.command_output.next_action_report_file), true);

      const nextReportResponse = await fetch(`${transport.baseUrl}/api/projects/${transport.projectId}/next-action-report`);
      assert.equal(nextReportResponse.status, 200);
      const nextReportPayload = await nextReportResponse.json();
      assert.equal(nextReportPayload.family, "next-action-report");
      assert.equal(nextReportPayload.document.primary_action.action_id, "discovery-run");
      assert.equal(nextReportPayload.document.closure_state.run_id, null);

      const flowsResponse = await fetch(`${transport.baseUrl}/api/projects/${transport.projectId}/flows`);
      assert.equal(flowsResponse.status, 200);
      const flowsPayload = await flowsResponse.json();
      assert.equal(flowsPayload.read_only, true);
      assert.ok(flowsPayload.active_flow_ids.includes(`flow.${transport.projectId}.web-guided-flow`));
      assert.equal(flowsPayload.completed_flow_ids.length, 0);

      const selectedFlowResponse = await fetch(`${transport.baseUrl}/api/projects/${transport.projectId}/flows/selected`);
      assert.equal(selectedFlowResponse.status, 200);
      const selectedFlowPayload = await selectedFlowResponse.json();
      assert.equal(selectedFlowPayload.flow_id, `flow.${transport.projectId}.web-guided-flow`);
      assert.equal(selectedFlowPayload.status, "active");

      const flowDetailResponse = await fetch(
        `${transport.baseUrl}/api/projects/${transport.projectId}/flows/${encodeURIComponent(selectedFlowPayload.flow_id)}`,
      );
      assert.equal(flowDetailResponse.status, 200);
      const flowDetailPayload = await flowDetailResponse.json();
      assert.equal(flowDetailPayload.latest_next_action_report_ref.includes("next-action-report"), true);

      const runtimeLayout = missionPayload.lifecycle_command.command_output.runtime_layout;
      assert.equal(typeof runtimeLayout.reportsRoot, "string");
      assert.equal(typeof runtimeLayout.artifactsRoot, "string");
      writeApprovedClosureArtifacts(runtimeLayout, transport.projectId, "run.api.closure.v1");

      const closureNextResponse = await postJson(commandUrl, {
        command: "next",
        flags: {},
      });
      assert.equal(closureNextResponse.status, 200);
      const closureNextPayload = await closureNextResponse.json();
      const closureOutput = closureNextPayload.lifecycle_command.command_output;
      assert.equal(closureOutput.next_action_primary.action_id, "release-prepare");
      assert.equal(closureOutput.next_action_closure_state.run_id, "run.api.closure.v1");
      assert.equal(closureOutput.next_action_closure_state.review.status, "approved");
      assert.equal(closureOutput.next_action_closure_state.delivery.status, "delivery-plan-ready");

      const closureReportResponse = await fetch(`${transport.baseUrl}/api/projects/${transport.projectId}/next-action-report`);
      assert.equal(closureReportResponse.status, 200);
      const closureReportPayload = await closureReportResponse.json();
      assert.equal(closureReportPayload.family, "next-action-report");
      assert.equal(closureReportPayload.document.closure_state.run_id, "run.api.closure.v1");
      assert.equal(
        closureReportPayload.document.closure_state.evidence_chain.join("\n").includes("review-decision-run.api.closure.v1-approve"),
        true,
      );

      const invalidFlagResponse = await postJson(commandUrl, {
        command: "review run",
        flags: {},
      });
      assert.equal(invalidFlagResponse.status, 400);
      const invalidFlagPayload = await invalidFlagResponse.json();
      assert.equal(invalidFlagPayload.error.code, "invalid_lifecycle_flags");
      assert.match(invalidFlagPayload.error.message, /--run-id/u);

      const invalidReviewDecisionResponse = await postJson(commandUrl, {
        command: "review decide",
        flags: {
          decision: "hold",
        },
      });
      assert.equal(invalidReviewDecisionResponse.status, 400);
      const invalidReviewDecisionPayload = await invalidReviewDecisionResponse.json();
      assert.equal(invalidReviewDecisionPayload.error.code, "invalid_lifecycle_flags");
      assert.match(invalidReviewDecisionPayload.error.message, /--run-id/u);

      const startResponse = await postJson(
        `${transport.baseUrl}/api/projects/${transport.projectId}/run-control/actions`,
        {
          action: "start",
          run_id: runId,
        },
      );
      assert.equal(startResponse.status, 200);

      const blockedResponse = await postJson(commandUrl, {
        command: "run cancel",
        flags: {
          run_id: runId,
          reason: "cancel without approval should return a stable lifecycle block",
        },
      });
      assert.equal(blockedResponse.status, 409);
      const blockedPayload = await blockedResponse.json();
      assert.equal(blockedPayload.error.code, "lifecycle_command.blocked");
      assert.equal(blockedPayload.lifecycle_command.command, "run cancel");
      assert.equal(blockedPayload.lifecycle_command.command_output.run_control_blocked, true);
      assert.equal(fs.existsSync(blockedPayload.lifecycle_command.command_output.run_control_audit_file), true);
    } finally {
      await transport.close();
    }
  });
});

test("detached control-plane transport records interactive continuation answers without streaming raw answer text", async () => {
  await withTempRepo(async (repoRoot) => {
    const runId = "run.http.transport.interaction.v1";
    const interactionId = "question-1";
    const transport = await createControlPlaneHttpServer({
      projectRef: repoRoot,
      cwd: repoRoot,
      host: "127.0.0.1",
      port: 0,
    });

    try {
      const stateResponse = await fetch(`${transport.baseUrl}/api/projects/${transport.projectId}/state`);
      assert.equal(stateResponse.status, 200);
      const statePayload = await stateResponse.json();
      const reportsRoot = statePayload.runtime_layout.reports_root ?? statePayload.runtime_layout.reportsRoot;
      fs.mkdirSync(reportsRoot, { recursive: true });
      const stepResultFile = path.join(reportsRoot, "step-result-interactive-question.json");
      fs.writeFileSync(
        stepResultFile,
        `${JSON.stringify(
          {
            step_result_id: `${runId}.runner.question`,
            run_id: runId,
            step_id: "runner.implement",
            step_class: "runner",
            status: "failed",
            summary: "Runner requested operator input.",
            evidence_refs: ["evidence://reports/runner-question.json"],
            requested_interaction: {
              requested: true,
              interaction_id: interactionId,
              status: "requested",
              prompt_summary: "Choose the deployment target.",
              question_evidence_refs: ["evidence://reports/runner-question.json"],
              answer_audit_refs: [],
              continuation: {
                next_action: "resume_from_boundary",
                reason_code: "operator-answer-required",
              },
              state_history: [
                {
                  status: "requested",
                  timestamp: "2026-05-07T00:00:00.000Z",
                  summary: "Choose the deployment target.",
                  evidence_refs: ["evidence://reports/runner-question.json"],
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

      const answerText = "Use the staging target.";
      const answerResponse = await postJson(
        `${transport.baseUrl}/api/projects/${transport.projectId}/interactions/answers`,
        {
          run_id: runId,
          interaction_id: interactionId,
          answer: answerText,
          reason: "operator selected a safe target",
        },
      );
      assert.equal(answerResponse.status, 200);
      const answerPayload = await answerResponse.json();
      assert.equal(answerPayload.interaction_answer.interaction_id, interactionId);
      assert.equal(answerPayload.interaction_answer.answer_accepted, true);
      assert.equal(answerPayload.interaction_answer.interaction_status, "resumed");
      assert.equal(fs.existsSync(answerPayload.interaction_answer.answer_audit_file), true);

      const auditRecord = JSON.parse(fs.readFileSync(answerPayload.interaction_answer.answer_audit_file, "utf8"));
      assert.equal(auditRecord.answer_text, answerText);

      const updatedStepResult = JSON.parse(fs.readFileSync(stepResultFile, "utf8"));
      assert.equal(JSON.stringify(updatedStepResult).includes(answerText), false);
      assert.equal(updatedStepResult.requested_interaction.status, "resumed");
      assert.deepEqual(
        updatedStepResult.requested_interaction.state_history.map((entry) => entry.status),
        ["requested", "answered", "resumed"],
      );
      assert.equal(updatedStepResult.requested_interaction.continuation.next_action, "continue_run");
      assert.ok(updatedStepResult.requested_interaction.answer_audit_refs.includes(answerPayload.interaction_answer.answer_audit_ref));
      assert.ok(updatedStepResult.evidence_refs.includes(answerPayload.interaction_answer.answer_audit_ref));

      const historyResponse = await fetch(
        `${transport.baseUrl}/api/projects/${transport.projectId}/runs/${runId}/events/history?limit=10`,
      );
      assert.equal(historyResponse.status, 200);
      const historyPayload = await historyResponse.json();
      assert.equal(JSON.stringify(historyPayload).includes(answerText), false);
      assert.equal(JSON.stringify(historyPayload).includes(answerPayload.interaction_answer.answer_audit_ref), true);

      const streamResponse = await fetch(
        `${transport.baseUrl}/api/projects/${transport.projectId}/runs/${runId}/events?max_replay=10`,
        {
          headers: {
            accept: "text/event-stream",
          },
        },
      );
      assert.equal(streamResponse.status, 200);
      const streamedEvents = await readLiveRunEvents(streamResponse, { count: 3, timeoutMs: 3000 });
      assert.equal(JSON.stringify(streamedEvents).includes(answerText), false);
      assert.deepEqual(
        streamedEvents
          .map((event) => event.interaction?.status)
          .filter((status) => typeof status === "string"),
        ["answered", "resumed"],
      );
    } finally {
      await transport.close();
    }
  });
});

test("detached control-plane authn/authz enforces bearer auth with project-scoped permissions", async () => {
  await withTempRepo(async (repoRoot) => {
    const runId = "run.http.transport.auth.v1";
    const transport = await createControlPlaneHttpServer({
      projectRef: repoRoot,
      cwd: repoRoot,
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
          {
            token: "legacy-default-token",
            token_id: "legacy-default",
          },
          {
            token: "legacy-empty-token",
            token_id: "legacy-empty",
            permissions: [],
          },
          {
            token: "foreign-token",
            token_id: "foreign",
            permissions: ["read"],
            project_refs: ["project.unrelated"],
          },
        ],
      },
    });

    try {
      const stateUrl = `${transport.baseUrl}/api/projects/${transport.projectId}/state`;
      const runControlUrl = `${transport.baseUrl}/api/projects/${transport.projectId}/run-control/actions`;

      const missingAuthResponse = await getJson(stateUrl);
      assert.equal(missingAuthResponse.status, 401);
      const missingAuthPayload = await missingAuthResponse.json();
      assert.equal(missingAuthPayload.error.code, "auth.missing_credentials");
      assert.equal(missingAuthPayload.error.auth.required_permission, "read");

      const forbiddenProjectResponse = await getJson(stateUrl, "foreign-token");
      assert.equal(forbiddenProjectResponse.status, 403);
      const forbiddenProjectPayload = await forbiddenProjectResponse.json();
      assert.equal(forbiddenProjectPayload.error.code, "auth.forbidden_project");
      assert.equal(forbiddenProjectPayload.error.auth.project_id, transport.projectId);

      const readAllowedResponse = await getJson(stateUrl, "reader-token");
      assert.equal(readAllowedResponse.status, 200);
      const readAllowedPayload = await readAllowedResponse.json();
      assert.equal(readAllowedPayload.project_id, transport.projectId);

      const legacyDefaultReadResponse = await getJson(stateUrl, "legacy-default-token");
      assert.equal(legacyDefaultReadResponse.status, 200);

      const legacyEmptyMutateResponse = await postJsonWithToken(
        runControlUrl,
        {
          action: "start",
          run_id: "run.http.transport.auth.local-trusted-defaults.v1",
        },
        "legacy-empty-token",
      );
      assert.equal(legacyEmptyMutateResponse.status, 200);
      const legacyEmptyMutatePayload = await legacyEmptyMutateResponse.json();
      assert.equal(legacyEmptyMutatePayload.run_control.blocked, false);

      const mutateForbiddenResponse = await postJsonWithToken(
        runControlUrl,
        {
          action: "start",
          run_id: runId,
        },
        "reader-token",
      );
      assert.equal(mutateForbiddenResponse.status, 403);
      const mutateForbiddenPayload = await mutateForbiddenResponse.json();
      assert.equal(mutateForbiddenPayload.error.code, "auth.insufficient_permission");
      assert.equal(mutateForbiddenPayload.error.auth.required_permission, "mutate");

      const mutateAllowedResponse = await postJsonWithToken(
        runControlUrl,
        {
          action: "start",
          run_id: runId,
        },
        "operator-token",
      );
      assert.equal(mutateAllowedResponse.status, 200);
      const mutateAllowedPayload = await mutateAllowedResponse.json();
      assert.equal(mutateAllowedPayload.run_control.action, "start");
      assert.equal(mutateAllowedPayload.run_control.blocked, false);
      assert.equal(fs.existsSync(mutateAllowedPayload.run_control.audit_file), true);
    } finally {
      await transport.close();
    }
  });
});

test("local app server serves SPA config and existing control-plane routes", async () => {
  await withTempRepo(async (projectRoot) => {
    const transport = await createControlPlaneHttpServer({
      cwd: workspaceRoot,
      projectRef: projectRoot,
      host: "127.0.0.1",
      port: 0,
      app: {
        staticRoot: path.join(workspaceRoot, "apps/web/dist"),
        packageVersion: "0.0.0-test",
      },
    });

    try {
      const htmlResponse = await fetch(`${transport.baseUrl}/`);
      assert.equal(htmlResponse.status, 200);
      const html = await htmlResponse.text();
      assert.match(html, /AOR Operator Console/);

      const configResponse = await getJson(`${transport.baseUrl}/app-config.json`);
      assert.equal(configResponse.status, 200);
      const config = await configResponse.json();
      assert.equal(config.project_id, transport.projectId);
      assert.equal(config.api_base_url, transport.baseUrl);

      const stateResponse = await getJson(`${transport.baseUrl}/api/projects/${transport.projectId}/state`);
      assert.equal(stateResponse.status, 200);
      const state = await stateResponse.json();
      assert.equal(state.project_id, transport.projectId);

      const missionResponse = await postJson(
        `${transport.baseUrl}/api/projects/${transport.projectId}/lifecycle-command/actions`,
        {
          command: "mission create",
          flags: {
            title: "Local app mission",
            brief: "Create mission evidence from the local app.",
            goal: ["Prove app lifecycle mutation."],
            constraint: ["No upstream writes."],
            kpi: ["app-ready:App ready:ready:status"],
            dod: ["Mission packet exists."],
            "delivery-mode": "no-write",
          },
        },
      );
      assert.equal(missionResponse.status, 200);
      const mission = await missionResponse.json();
      assert.equal(mission.lifecycle_command.command, "mission create");
      assert.equal(mission.lifecycle_command.blocked, false);
    } finally {
      await transport.close();
    }
  });
});

test("production-hardened transport enforces authz and redacts configured secrets from denials and logs", async () => {
  await withTempRepo(async (repoRoot) => {
    const runId = "run.http.transport.production-hardening.v1";
    const secretToken = "prod-secret-token";
    const transport = await createControlPlaneHttpServer({
      projectRef: repoRoot,
      cwd: repoRoot,
      host: "127.0.0.1",
      port: 0,
      auth: {
        mode: "production-hardened",
        tokens: [
          {
            token: "reader-prod-token",
            token_id: "reader",
            permissions: ["read"],
          },
          {
            token: "mutate-prod-token",
            token_id: "mutator",
            permissions: ["mutate"],
          },
          {
            token: "missing-permissions-prod-token",
            token_id: "missing-permissions",
          },
          {
            token: "empty-permissions-prod-token",
            token_id: "empty-permissions",
            permissions: [],
          },
          {
            token: "foreign-prod-token",
            token_id: "foreign",
            permissions: ["read", "mutate"],
            project_refs: ["project.unrelated"],
          },
          {
            token: secretToken,
            token_id: "operator",
            permissions: ["read", "mutate"],
          },
        ],
      },
    });

    try {
      const stateUrl = `${transport.baseUrl}/api/projects/${transport.projectId}/state`;
      const runControlUrl = `${transport.baseUrl}/api/projects/${transport.projectId}/run-control/actions`;

      const missingAuthResponse = await getJson(stateUrl);
      assert.equal(missingAuthResponse.status, 401);
      const missingAuthPayload = await missingAuthResponse.json();
      assert.equal(missingAuthPayload.error.code, "auth.missing_credentials");
      assert.equal(missingAuthPayload.error.auth.security_mode, "production-hardened");

      const missingPermissionsResponse = await getJson(stateUrl, "missing-permissions-prod-token");
      assert.equal(missingPermissionsResponse.status, 403);
      const missingPermissionsPayload = await missingPermissionsResponse.json();
      assert.equal(missingPermissionsPayload.error.code, "auth.insufficient_permission");
      assert.equal(missingPermissionsPayload.error.auth.required_permission, "read");
      assert.equal(JSON.stringify(missingPermissionsPayload).includes("missing-permissions-prod-token"), false);

      const emptyPermissionsResponse = await getJson(stateUrl, "empty-permissions-prod-token");
      assert.equal(emptyPermissionsResponse.status, 403);
      const emptyPermissionsPayload = await emptyPermissionsResponse.json();
      assert.equal(emptyPermissionsPayload.error.code, "auth.insufficient_permission");
      assert.equal(emptyPermissionsPayload.error.auth.required_permission, "read");
      assert.equal(JSON.stringify(emptyPermissionsPayload).includes("empty-permissions-prod-token"), false);

      const mutateOnlyReadResponse = await getJson(stateUrl, "mutate-prod-token");
      assert.equal(mutateOnlyReadResponse.status, 403);
      const mutateOnlyReadPayload = await mutateOnlyReadResponse.json();
      assert.equal(mutateOnlyReadPayload.error.code, "auth.insufficient_permission");
      assert.equal(mutateOnlyReadPayload.error.auth.required_permission, "read");

      const wrongProjectResponse = await getJson(stateUrl, "foreign-prod-token");
      assert.equal(wrongProjectResponse.status, 403);
      const wrongProjectPayload = await wrongProjectResponse.json();
      assert.equal(wrongProjectPayload.error.code, "auth.forbidden_project");
      assert.equal(JSON.stringify(wrongProjectPayload).includes("foreign-prod-token"), false);

      const mutateOnlyAllowedResponse = await postJsonWithToken(
        runControlUrl,
        {
          action: "start",
          run_id: "run.http.transport.production-mutator-only.v1",
        },
        "mutate-prod-token",
      );
      assert.equal(mutateOnlyAllowedResponse.status, 200);
      const mutateOnlyAllowedPayload = await mutateOnlyAllowedResponse.json();
      assert.equal(mutateOnlyAllowedPayload.run_control.blocked, false);

      const deniedMutateResponse = await postJsonWithToken(
        runControlUrl,
        {
          action: "start",
          run_id: runId,
        },
        "reader-prod-token",
      );
      assert.equal(deniedMutateResponse.status, 403);
      const deniedMutatePayload = await deniedMutateResponse.json();
      assert.equal(deniedMutatePayload.error.code, "auth.insufficient_permission");
      assert.equal(JSON.stringify(deniedMutatePayload).includes(secretToken), false);

      const startResponse = await postJsonWithToken(
        runControlUrl,
        {
          action: "start",
          run_id: runId,
          reason: "production hardening baseline",
        },
        secretToken,
      );
      assert.equal(startResponse.status, 200);

      const blockedResponse = await postJsonWithToken(
        runControlUrl,
        {
          action: "cancel",
          run_id: runId,
          reason: `operator pasted ${secretToken} while requesting cancel`,
        },
        secretToken,
      );
      assert.equal(blockedResponse.status, 409);
      const blockedPayload = await blockedResponse.json();
      assert.equal(blockedPayload.error.code, "approval.required");
      assert.equal(blockedPayload.run_control.blocked, true);
      assert.equal(JSON.stringify(blockedPayload).includes(secretToken), false);

      const auditRaw = fs.readFileSync(blockedPayload.run_control.audit_file, "utf8");
      assert.equal(auditRaw.includes(secretToken), false);
      assert.equal(auditRaw.includes("[REDACTED]"), true);

      const eventLogRaw = fs.readFileSync(blockedPayload.run_control.stream_log_file, "utf8");
      assert.equal(eventLogRaw.includes(secretToken), false);

      const historyResponse = await getJson(
        `${transport.baseUrl}/api/projects/${transport.projectId}/runs/${runId}/events/history?limit=25`,
        secretToken,
      );
      assert.equal(historyResponse.status, 200);
      const historyPayload = await historyResponse.json();
      assert.equal(JSON.stringify(historyPayload).includes(secretToken), false);
    } finally {
      await transport.close();
    }
  });
});
