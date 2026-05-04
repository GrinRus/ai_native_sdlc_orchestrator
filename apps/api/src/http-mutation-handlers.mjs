import { asString, readJsonRequestBody, sendError, sendJson } from "./http-utils.mjs";
import { toRunControlResponse, toUiLifecycleResponse } from "./http-presenters.mjs";
import { applyRunControlAction } from "./run-control.mjs";
import { attachUiLifecycle, detachUiLifecycle } from "./ui-lifecycle.mjs";

const RUN_CONTROL_ACTIONS = new Set(["start", "pause", "resume", "steer", "cancel"]);
const UI_LIFECYCLE_ACTIONS = new Set(["attach", "detach"]);

/**
 * @param {import("node:http").IncomingMessage} request
 * @param {import("node:http").ServerResponse} response
 * @returns {Promise<Record<string, unknown> | null>}
 */
async function readMutationPayload(request, response) {
  try {
    return await readJsonRequestBody(request);
  } catch (error) {
    if (error instanceof Error && error.message === "invalid_json") {
      sendError(response, 400, "invalid_json", "Request body must be valid JSON.");
      return null;
    }
    if (error instanceof Error && error.message === "invalid_payload") {
      sendError(response, 400, "invalid_payload", "Request body must be a JSON object.");
      return null;
    }
    throw error;
  }
}

/**
 * @param {{
 *   request: import("node:http").IncomingMessage,
 *   response: import("node:http").ServerResponse,
 *   runtimeOptions: { cwd?: string, projectRef: string, runtimeRoot?: string },
 * }} options
 */
export async function handleRunControlAction({ request, response, runtimeOptions }) {
  const payload = await readMutationPayload(request, response);
  if (!payload) {
    return;
  }

  const action = asString(payload.action);
  if (!action || !RUN_CONTROL_ACTIONS.has(action)) {
    sendError(response, 400, "invalid_run_control_action", `Unsupported run-control action '${action ?? "missing"}'.`);
    return;
  }

  const result = applyRunControlAction({
    ...runtimeOptions,
    action: /** @type {"start" | "pause" | "resume" | "steer" | "cancel"} */ (action),
    runId: asString(payload.run_id) ?? undefined,
    targetStep: asString(payload.target_step) ?? undefined,
    reason: asString(payload.reason) ?? undefined,
    approvalRef: asString(payload.approval_ref) ?? undefined,
  });
  const runControlPayload = toRunControlResponse(result);

  if (result.blocked) {
    sendJson(response, 409, {
      error: {
        code: result.blockedReason?.code ?? "run_control.blocked",
        message: result.blockedReason?.message ?? "Run-control action blocked by policy or lifecycle transition.",
      },
      run_control: runControlPayload,
    });
    return;
  }

  sendJson(response, 200, {
    run_control: runControlPayload,
  });
}

/**
 * @param {{
 *   request: import("node:http").IncomingMessage,
 *   response: import("node:http").ServerResponse,
 *   runtimeOptions: { cwd?: string, projectRef: string, runtimeRoot?: string },
 * }} options
 */
export async function handleUiLifecycleAction({ request, response, runtimeOptions }) {
  const payload = await readMutationPayload(request, response);
  if (!payload) {
    return;
  }

  const action = asString(payload.action);
  if (!action || !UI_LIFECYCLE_ACTIONS.has(action)) {
    sendError(response, 400, "invalid_ui_lifecycle_action", `Unsupported ui-lifecycle action '${action ?? "missing"}'.`);
    return;
  }

  const result =
    action === "attach"
      ? attachUiLifecycle({
          ...runtimeOptions,
          runId: asString(payload.run_id) ?? undefined,
          controlPlane: asString(payload.control_plane) ?? undefined,
        })
      : detachUiLifecycle({
          ...runtimeOptions,
          runId: asString(payload.run_id) ?? undefined,
        });

  sendJson(response, 200, {
    ui_lifecycle: toUiLifecycleResponse(result),
  });
}
