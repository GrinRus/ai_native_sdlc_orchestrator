import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { applyRunControlAction, appendRunEvent, createControlPlaneHttpServer } from "../src/index.mjs";

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
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-w9-s07-api-http-"));
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
