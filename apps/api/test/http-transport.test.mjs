import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { withTempRepo as withTempRepoHelper } from "../../../scripts/test/helpers/temp-repo.mjs";
import { materializeCompilerRevisionStatus } from "../../../packages/orchestrator-core/src/compiler-revision.mjs";
import { materializeMultirepoCoordinationStatus } from "../../../packages/orchestrator-core/src/multirepo-coordination.mjs";
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
 * @param {Response} response
 * @param {{ timeoutMs?: number }} [options]
 */
async function readNextLiveRunEvent(response, options = {}) {
  const timeoutMs = options.timeoutMs ?? 3000;
  if (!response.body) {
    throw new Error("SSE response body is missing.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const timeoutAt = Date.now() + timeoutMs;

  while (Date.now() < timeoutAt) {
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

      return JSON.parse(data);
    }
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
              summary: "Choose the deployment target.",
              evidence_refs: ["evidence://reports/runner-question.json"],
              continuation: {
                next_action: "resume_from_boundary",
              },
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
      assert.equal(answerResponse.status, 409);
      const answerPayload = await answerResponse.json();
      assert.equal(answerPayload.error.code, "interaction.continuation_blocked");
      assert.equal(answerPayload.interaction_answer.interaction_id, interactionId);
      assert.equal(answerPayload.interaction_answer.answer_accepted, true);
      assert.equal(answerPayload.interaction_answer.interaction_status, "blocked");
      assert.equal(fs.existsSync(answerPayload.interaction_answer.answer_audit_file), true);

      const auditRecord = JSON.parse(fs.readFileSync(answerPayload.interaction_answer.answer_audit_file, "utf8"));
      assert.equal(auditRecord.answer_text, answerText);

      const updatedStepResult = JSON.parse(fs.readFileSync(stepResultFile, "utf8"));
      assert.equal(updatedStepResult.requested_interaction.status, "blocked");
      assert.ok(updatedStepResult.requested_interaction.answer_audit_refs.includes(answerPayload.interaction_answer.answer_audit_ref));
      assert.ok(updatedStepResult.evidence_refs.includes(answerPayload.interaction_answer.answer_audit_ref));

      const historyResponse = await fetch(
        `${transport.baseUrl}/api/projects/${transport.projectId}/runs/${runId}/events/history?limit=10`,
      );
      assert.equal(historyResponse.status, 200);
      const historyPayload = await historyResponse.json();
      assert.equal(JSON.stringify(historyPayload).includes(answerText), false);
      assert.equal(JSON.stringify(historyPayload).includes(answerPayload.interaction_answer.answer_audit_ref), true);
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
