import { asString, readJsonRequestBody, sendError, sendJson } from "./http-utils.mjs";
import {
  toInteractionAnswerResponse,
  toLifecycleCommandResponse,
  toRunControlResponse,
  toUiLifecycleResponse,
} from "./http-presenters.mjs";
import { InteractionAnswerError, submitInteractionAnswer } from "./interaction-answer.mjs";
import { runLifecycleCommand } from "./lifecycle-command.mjs";
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
 *   runtimeOptions: { cwd?: string, projectRef: string, runtimeRoot?: string, redactionPolicy?: unknown },
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
 *   runtimeOptions: { cwd?: string, projectRef: string, runtimeRoot?: string, redactionPolicy?: unknown },
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

/**
 * @param {{
 *   request: import("node:http").IncomingMessage,
 *   response: import("node:http").ServerResponse,
 *   runtimeOptions: { cwd?: string, projectRef: string, runtimeRoot?: string, redactionPolicy?: unknown },
 * }} options
 */
export async function handleLifecycleCommandAction({ request, response, runtimeOptions }) {
  const payload = await readMutationPayload(request, response);
  if (!payload) {
    return;
  }

  const command = asString(payload.command);
  const flags = typeof payload.flags === "object" && payload.flags !== null && !Array.isArray(payload.flags)
    ? /** @type {Record<string, unknown>} */ (payload.flags)
    : {};
  if (payload.flags !== undefined && (typeof payload.flags !== "object" || payload.flags === null || Array.isArray(payload.flags))) {
    sendError(response, 400, "invalid_lifecycle_flags", "Lifecycle command flags must be a JSON object when supplied.");
    return;
  }

  const result = runLifecycleCommand({
    ...runtimeOptions,
    command: command ?? "",
    flags,
  });

  if (!result.ok) {
    sendJson(response, result.statusCode, {
      error: result.error,
      ...(result.result ? { lifecycle_command: toLifecycleCommandResponse(result.result) } : {}),
    });
    return;
  }

  sendJson(response, 200, {
    lifecycle_command: toLifecycleCommandResponse(result.result),
  });
}

/**
 * @param {{
 *   request: import("node:http").IncomingMessage,
 *   response: import("node:http").ServerResponse,
 *   runtimeOptions: { cwd?: string, projectRef: string, runtimeRoot?: string, redactionPolicy?: unknown },
 * }} options
 */
export async function handleInteractionAnswer({ request, response, runtimeOptions }) {
  const payload = await readMutationPayload(request, response);
  if (!payload) {
    return;
  }

  const runId = asString(payload.run_id);
  const interactionId = asString(payload.interaction_id);
  const answerEvidenceRef = asString(payload.answer_evidence_ref) ?? undefined;
  const decision = asString(payload.decision) ?? undefined;
  const answer = typeof payload.answer === "string" ? payload.answer.trim() : "";

  if (!runId || !interactionId) {
    sendError(response, 400, "interaction_answer.invalid_payload", "run_id and interaction_id are required.");
    return;
  }

  if (answer.length === 0 && !answerEvidenceRef && !decision) {
    sendError(
      response,
      400,
      "interaction_answer.invalid_answer",
      "answer is required unless answer_evidence_ref points to durable operator evidence or decision is supplied.",
    );
    return;
  }

  try {
    const result = submitInteractionAnswer({
      ...runtimeOptions,
      runId,
      interactionId,
      answer,
      decision,
      reason: asString(payload.reason) ?? undefined,
      approvalRef: asString(payload.approval_ref) ?? undefined,
      answerEvidenceRef,
    });
    const answerPayload = toInteractionAnswerResponse(result);

    if (result.blocked) {
      sendJson(response, 409, {
        error: {
          code: "interaction.continuation_blocked",
          message: result.blockedReason?.message ?? "Interaction answer was accepted but continuation remains blocked.",
        },
        interaction_answer: answerPayload,
      });
      return;
    }

    sendJson(response, 200, {
      interaction_answer: answerPayload,
    });
  } catch (error) {
    if (error instanceof InteractionAnswerError) {
      sendError(response, error.statusCode, error.code, error.message);
      return;
    }
    throw error;
  }
}
