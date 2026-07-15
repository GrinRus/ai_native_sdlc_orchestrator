import { asString, readJsonRequestBody, sendError, sendJson } from "./http-utils.mjs";
import {
  toInteractionAnswerResponse,
  toLifecycleCommandResponse,
  toRunControlResponse,
  toUiLifecycleResponse,
} from "./http-presenters.mjs";
import { InteractionAnswerError, submitInteractionAnswer } from "../interaction-answer.mjs";
import { runLifecycleCommand } from "../lifecycle-command.mjs";
import { requestRunJobCancel } from "../../run-job.mjs";
import { OperatorRequestError, createOperatorRequest, runOperatorRequest } from "../../operator-request.mjs";
import { applyRunControlAction } from "../run-control.mjs";
import { attachUiLifecycle, detachUiLifecycle } from "../ui-lifecycle.mjs";
import { summarizeProjectContext } from "../local-project-registry.mjs";
import { readFlowProjection } from "../flow-projections.mjs";
import {
  approveTaskPlan,
  createTaskPlan,
  requestTaskPlanRevision,
  resolveExecutionUnitContext,
} from "../../task-plan-service.mjs";

const RUN_CONTROL_ACTIONS = new Set(["start", "pause", "resume", "steer", "cancel"]);
const UI_LIFECYCLE_ACTIONS = new Set(["attach", "detach"]);
const PLAN_ACTIONS = new Set(["create", "request_revision", "approve"]);

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

  const executionPlanRef = asString(payload.execution_plan_ref);
  const executionUnitId = asString(payload.execution_unit_id);
  if (Boolean(executionPlanRef) !== Boolean(executionUnitId) || (action !== "start" && (executionPlanRef || executionUnitId))) {
    sendError(response, 400, "invalid_execution_unit_context", "execution_plan_ref and execution_unit_id are a paired input valid only for run start.");
    return;
  }
  if (payload.expected_revision !== undefined && (!Number.isInteger(payload.expected_revision) || payload.expected_revision < 0)) {
    sendError(response, 400, "invalid_expected_revision", "expected_revision must be a non-negative integer.");
    return;
  }
  let executionContext = null;
  if (executionPlanRef && executionUnitId) {
    try {
      executionContext = resolveExecutionUnitContext({ ...runtimeOptions, executionPlanRef, executionUnitId });
    } catch (error) {
      sendError(response, 409, typeof error?.code === "string" ? error.code : "execution-unit-invalid", error instanceof Error ? error.message : "Execution unit context is invalid.");
      return;
    }
  }

  const result = applyRunControlAction({
    ...runtimeOptions,
    action: /** @type {"start" | "pause" | "resume" | "steer" | "cancel"} */ (action),
    runId: asString(payload.run_id) ?? undefined,
    targetStep: asString(payload.target_step) ?? undefined,
    reason: asString(payload.reason) ?? undefined,
    approvalRef: asString(payload.approval_ref) ?? undefined,
    executionPlanRef: executionContext?.executionPlanRef,
    executionUnitId: executionContext?.executionUnitId,
    taskRefs: executionContext?.taskRefs,
    commandId: asString(payload.command_id) ?? undefined,
    expectedRevision: Number.isInteger(payload.expected_revision) ? payload.expected_revision : undefined,
  });
  const runControlPayload = toRunControlResponse(result);

  if (action === "cancel" && !result.blocked) {
    requestRunJobCancel({ ...runtimeOptions, runId: result.runId });
  }

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
 *   params: Record<string, string>,
 *   runtimeOptions: { cwd?: string, projectRef: string, runtimeRoot?: string, redactionPolicy?: unknown },
 * }} options
 */
export async function handleFlowPlanAction({ request, response, params, runtimeOptions }) {
  const payload = await readMutationPayload(request, response);
  if (!payload) return;

  const action = asString(payload.action);
  if (!action || !PLAN_ACTIONS.has(action)) {
    sendError(response, 400, "invalid_plan_action", `Unsupported plan action '${action ?? "missing"}'.`);
    return;
  }
  const flow = readFlowProjection({ ...runtimeOptions, flowId: params.flowId });
  if (!flow) {
    sendError(response, 404, "flow.not_found", `Flow '${params.flowId}' was not found.`);
    return;
  }

  try {
    if (action === "create") {
      const result = createTaskPlan({
        ...runtimeOptions,
        flowId: params.flowId,
        approvedArtifactPath: asString(flow.intake_packet_ref) ?? undefined,
      });
      sendJson(response, 202, {
        flow_id: params.flowId,
        planning_run_ref: result.planningRunRef,
        plan_ref: result.planRef,
        plan_status: result.plan.plan_status,
        validation_report_ref: result.plan.source_refs?.validation_report_ref ?? null,
        evaluation_report_ref: result.plan.source_refs?.evaluation_report_ref ?? null,
        semantic_evaluation: result.plan.semantic_evaluation ?? null,
      });
      return;
    }
    if (action === "request_revision") {
      const result = requestTaskPlanRevision({
        ...runtimeOptions,
        flowId: params.flowId,
        planRef: asString(payload.plan_ref) ?? undefined,
        reason: asString(payload.reason) ?? "",
      });
      sendJson(response, 202, {
        flow_id: params.flowId,
        planning_run_ref: result.planningRunRef,
        plan_ref: result.planRef,
        plan_status: result.plan.plan_status,
        revision_request: result.revisionRequest,
      });
      return;
    }
    const result = approveTaskPlan({
      ...runtimeOptions,
      flowId: params.flowId,
      planRef: asString(payload.plan_ref) ?? undefined,
      approvalRef: asString(payload.approval_ref) ?? "",
    });
    sendJson(response, 200, {
      flow_id: params.flowId,
      plan_ref: result.planRef,
      plan_status: result.plan.plan_status,
      execution_plan: result.executionPlan,
      task_progress: result.taskProgress,
    });
  } catch (error) {
    const code = typeof error?.code === "string" ? error.code : "plan-action-failed";
    const conflicts = new Set([
      "structured-plan-required",
      "plan-incomplete",
      "plan-stale",
      "plan-immutable",
      "plan-unapproved",
      "plan-flow-mismatch",
      "planning-route-failed",
    ]);
    sendError(response, conflicts.has(code) ? 409 : 400, code, error instanceof Error ? error.message : String(error));
  }
}

/**
 * @param {{
 *   request: import("node:http").IncomingMessage,
 *   response: import("node:http").ServerResponse,
 *   registry: ReturnType<import("../local-project-registry.mjs").createLocalProjectRegistry>,
 * }} options
 */
export async function handleProjectAction({ request, response, registry }) {
  const payload = await readMutationPayload(request, response);
  if (!payload) {
    return;
  }

  const action = asString(payload.action);
  if (action !== "add") {
    sendError(response, 400, "invalid_project_action", `Unsupported project action '${action ?? "missing"}'.`);
    return;
  }

  const projectRef = asString(payload.project_ref);
  if (!projectRef) {
    sendError(response, 400, "invalid_project_ref", "Project action 'add' requires project_ref.");
    return;
  }

  try {
    const context = registry.addProject({
      projectRef,
      projectProfile: asString(payload.project_profile) ?? undefined,
      runtimeRoot: asString(payload.runtime_root) ?? undefined,
      label: asString(payload.label) ?? undefined,
    });
    sendJson(response, 200, {
      project: summarizeProjectContext(context),
      ...registry.summarize(),
    });
  } catch (error) {
    sendError(response, 400, "project_add_failed", error instanceof Error ? error.message : String(error));
  }
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
  if (payload.unsafe_development_override !== undefined && typeof payload.unsafe_development_override !== "boolean") {
    sendError(
      response,
      400,
      "invalid_unsafe_development_override",
      "unsafe_development_override must be a boolean when supplied.",
    );
    return;
  }
  if (payload.unsafe_development_override !== undefined) {
    flags.unsafe_development_override = payload.unsafe_development_override;
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

  if (result.accepted === true) {
    const job = result.result.job;
    sendJson(response, 202, {
      run_id: job.run_id,
      job_id: job.job_id,
      status: job.status,
      revision: job.revision,
      status_ref: job.status_ref,
      event_ref: job.event_ref,
      lifecycle_command: toLifecycleCommandResponse(result.result),
    });
    return;
  }

  sendJson(response, 200, { lifecycle_command: toLifecycleCommandResponse(result.result) });
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function asStringArray(value) {
  return Array.isArray(value)
    ? value.filter((entry) => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim())
    : [];
}

/**
 * @param {{
 *   request: import("node:http").IncomingMessage,
 *   response: import("node:http").ServerResponse,
 *   runtimeOptions: { cwd?: string, projectRef: string, runtimeRoot?: string, redactionPolicy?: unknown },
 * }} options
 */
export async function handleOperatorRequestCreate({ request, response, runtimeOptions }) {
  const payload = await readMutationPayload(request, response);
  if (!payload) {
    return;
  }

  try {
    const result = createOperatorRequest({
      ...runtimeOptions,
      sourceSurface: asString(payload.source_surface) ?? "api",
      targetStage: asString(payload.target_stage) ?? "",
      intentType: asString(payload.intent_type) ?? "",
      requestText: asString(payload.request_text) ?? asString(payload.request) ?? "",
      targetFlowId: asString(payload.target_flow_id) ?? undefined,
      targetRefs: asStringArray(payload.target_refs),
      allowedPaths: asStringArray(payload.allowed_paths),
      deliveryMode: asString(payload.delivery_mode) ?? undefined,
    });
    sendJson(response, 201, {
      operator_request: {
        request_id: result.requestId,
        operator_request_ref: result.operatorRequestRef,
        operator_request_file: result.operatorRequestFile,
        status: result.status,
        document: result.operatorRequest,
      },
    });
  } catch (error) {
    if (error instanceof OperatorRequestError) {
      sendError(response, error.statusCode, error.code, error.message);
      return;
    }
    throw error;
  }
}

/**
 * @param {{
 *   request: import("node:http").IncomingMessage,
 *   response: import("node:http").ServerResponse,
 *   params: Record<string, string>,
 *   runtimeOptions: { cwd?: string, projectRef: string, runtimeRoot?: string, redactionPolicy?: unknown },
 * }} options
 */
export async function handleOperatorRequestAction({ request, response, params, runtimeOptions }) {
  const payload = await readMutationPayload(request, response);
  if (!payload) {
    return;
  }

  const action = asString(payload.action);
  if (action !== "run") {
    sendError(response, 400, "operator_request.invalid_action", `Unsupported operator request action '${action ?? "missing"}'.`);
    return;
  }

  try {
    const requestRef = asString(payload.request_ref) ?? params.requestId;
    const result = runOperatorRequest({
      ...runtimeOptions,
      requestRef,
      targetStep: asString(payload.target_step) ?? undefined,
    });
    sendJson(response, 200, {
      operator_request_run: {
        request_id: result.requestId,
        operator_request_ref: result.operatorRequestRef,
        operator_request_file: result.operatorRequestFile,
        run_id: result.runId,
        routed_step_result_file: result.routedStepResultFile,
        routed_step_result_ref: result.routedStepResultRef,
        compiled_context_ref: result.compiledContextRef,
        proposal_refs: result.proposalRefs,
        patch_refs: result.patchRefs,
        next_action_report_file: result.nextActionReportFile,
        next_action_report_ref: result.nextActionReportRef,
        document: result.operatorRequest,
      },
    });
  } catch (error) {
    if (error instanceof OperatorRequestError) {
      sendError(response, error.statusCode, error.code, error.message);
      return;
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
