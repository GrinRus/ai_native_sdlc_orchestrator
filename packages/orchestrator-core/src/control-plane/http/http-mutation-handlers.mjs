import { HttpRequestBodyError, asString, readJsonRequestBody, sendError, sendJson } from "./http-utils.mjs";
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
import { readFlowProjection } from "../flow-projections.mjs";
import { listTaskProjections } from "../read-surface.mjs";
import { validateTaskActionPayload } from "../task-action-catalog.mjs";
import {
  approveTaskPlan,
  createTaskPlan,
  requestTaskPlanRevision,
  resolveExecutionUnitContext,
} from "../../task-plan-service.mjs";
import { applyTopologyAction, TopologyManagementError } from "../topology-management.mjs";
import { applyExecutionProfileAction, ExecutionProfileError } from "../execution-profile.mjs";
import { connectAdditionalRepository, createProjectConnectionJob, deleteProjectData, disconnectProject, refreshProjectSource } from "../project-source.mjs";
import { openNativeFolderPicker } from "../folder-picker.mjs";
import { exportEvidence, materializeProjectConfig, ProjectWritebackError } from "../../project-writeback.mjs";
import {
  IntentServiceError,
  answerIntentQuestions,
  cancelIntentSubmission,
  confirmAndStartIntent,
  confirmIntent,
  createIntentSubmission,
  listIntentSubmissions,
  prepareIntentSubmission,
  retryIntentStart,
  reviseIntentSubmission,
} from "../../intent-service.mjs";

const RUN_CONTROL_ACTIONS = new Set(["start", "pause", "resume", "steer", "cancel"]);
const UI_LIFECYCLE_ACTIONS = new Set(["attach", "detach"]);
const PLAN_ACTIONS = new Set(["create", "request_revision", "approve"]);

/**
 * @param {import("node:http").IncomingMessage} request
 * @param {import("node:http").ServerResponse} response
 * @returns {Promise<Record<string, unknown> | null>}
 */
async function readMutationPayload(request, response, options = {}) {
  try {
    return await readJsonRequestBody(request, options);
  } catch (error) {
    if (error instanceof HttpRequestBodyError) {
      sendError(response, error.statusCode, error.code, error.message);
      return null;
    }
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
  const workspaceSetRef = asString(payload.workspace_set_ref);
  if (
    new Set([Boolean(executionPlanRef), Boolean(executionUnitId), Boolean(workspaceSetRef)]).size > 1
    || (action !== "start" && (executionPlanRef || executionUnitId || workspaceSetRef))
  ) {
    sendError(response, 400, "invalid_execution_unit_context", "execution_plan_ref, execution_unit_id, and workspace_set_ref are a workspace-bound input valid only for run start.");
    return;
  }
  if (payload.expected_revision !== undefined && (!Number.isInteger(payload.expected_revision) || payload.expected_revision < 0)) {
    sendError(response, 400, "invalid_expected_revision", "expected_revision must be a non-negative integer.");
    return;
  }
  let executionContext = null;
  if (executionPlanRef && executionUnitId && workspaceSetRef) {
    try {
      executionContext = resolveExecutionUnitContext({ ...runtimeOptions, executionPlanRef, executionUnitId, workspaceSetRef });
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
    workspaceSetRef: executionContext?.workspaceSetRef,
    executionRoot: executionContext?.executionRoot,
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
  try {
    if (action === "connect") {
      const source = payload.source && typeof payload.source === "object" && !Array.isArray(payload.source) ? payload.source : null;
      if (!source) {
        sendError(response, 400, "invalid_project_source", "Project action 'connect' requires source.");
        return;
      }
      const job = createProjectConnectionJob({ registry, source, label: asString(payload.label) ?? undefined });
      sendJson(response, 202, { job, status_ref: `/api/project-connection-jobs/${encodeURIComponent(job.job_id)}` });
      return;
    }
    const projectId = asString(payload.project_id);
    if (!projectId) {
      sendError(response, 400, "project_id_required", `Project action '${action ?? "missing"}' requires project_id.`);
      return;
    }
    if (action === "refresh-source") sendJson(response, 200, refreshProjectSource({ registry, projectId }));
    else if (action === "connect-repository") sendJson(response, 201, connectAdditionalRepository({ registry, projectId, source: payload.source, label: asString(payload.label) ?? undefined }));
    else if (action === "disconnect") sendJson(response, 200, disconnectProject({ registry, projectId }));
    else if (action === "delete-aor-data") sendJson(response, 200, deleteProjectData({ registry, projectId, confirmation: asString(payload.confirmation) }));
    else if (action === "materialize-project-config") sendJson(response, 200, materializeProjectConfig({ registry, projectId }));
    else if (action === "export-evidence") sendJson(response, 201, exportEvidence({ registry, projectId, flowId: asString(payload.flow_id), exportId: asString(payload.export_id), evidenceRefs: payload.evidence_refs }));
    else sendError(response, 400, "invalid_project_action", `Unsupported project action '${action ?? "missing"}'.`);
  } catch (error) {
    sendError(response, error instanceof ProjectWritebackError ? error.statusCode : 400, error?.code ?? "project_action_failed", error instanceof Error ? error.message : String(error));
  }
}

export async function handleFolderPickerAction({ request, response }) {
  const payload = await readMutationPayload(request, response);
  if (!payload) return;
  if ((asString(payload.action) ?? "open") !== "open") {
    sendError(response, 400, "invalid_folder_picker_action", "Folder picker supports only action 'open'.");
    return;
  }
  sendJson(response, 200, openNativeFolderPicker());
}

export async function handleIntentSubmissionCreate({ request, response, params, registry }) {
  const payload = await readMutationPayload(request, response, { maxBytes: 6 * 1024 * 1024 });
  if (!payload) return;
  try {
    const result = createIntentSubmission({
      registry,
      projectId: params.projectId,
      requestText: typeof payload.request_text === "string" ? payload.request_text : "",
      attachments: Array.isArray(payload.attachments) ? payload.attachments : [],
      markdownSources: Array.isArray(payload.markdown_sources) ? payload.markdown_sources : [],
      autoPrepare: payload.auto_prepare !== false,
    });
    sendJson(response, 202, { ...result, status_ref: `/api/projects/${encodeURIComponent(params.projectId)}/intent-submissions/${encodeURIComponent(result.submission.submission_id)}` });
  } catch (error) {
    if (error instanceof IntentServiceError) sendError(response, error.statusCode, error.code, error.message);
    else throw error;
  }
}

export async function handleIntentSubmissionAction({ request, response, params, registry }) {
  const payload = await readMutationPayload(request, response);
  if (!payload) return;
  try {
    const action = asString(payload.action);
    let result;
    if (action === "retry") result = prepareIntentSubmission({ registry, projectId: params.projectId, submissionId: params.submissionId });
    else if (action === "revise") result = reviseIntentSubmission({ registry, projectId: params.projectId, submissionId: params.submissionId, normalization: payload.normalization });
    else if (action === "answer") result = answerIntentQuestions({ registry, projectId: params.projectId, submissionId: params.submissionId, answers: payload.answers });
    else if (action === "cancel") result = cancelIntentSubmission({ registry, projectId: params.projectId, submissionId: params.submissionId });
    else if (action === "confirm") result = confirmIntent({
      registry,
      projectId: params.projectId,
      submissionId: params.submissionId,
      expectedRevision: Number.isInteger(payload.expected_revision) ? payload.expected_revision : undefined,
    });
    else if (action === "confirm-and-start") result = confirmAndStartIntent({ registry, projectId: params.projectId, submissionId: params.submissionId });
    else if (action === "retry-start") result = retryIntentStart({ registry, projectId: params.projectId, submissionId: params.submissionId });
    else {
      sendError(response, 400, "intent_submission.invalid_action", `Unsupported intent action '${action ?? "missing"}'.`);
      return;
    }
    sendJson(response, action === "confirm-and-start" ? 202 : 200, result);
  } catch (error) {
    if (error instanceof IntentServiceError) sendError(response, error.statusCode, error.code, error.message, error.details);
    else throw error;
  }
}

export async function handleTaskAction({ request, response, params, registry, runtimeOptions }) {
  const payload = await readMutationPayload(request, response);
  if (!payload) return;
  const action = asString(payload.action);
  const actionValidation = validateTaskActionPayload(action, payload);
  if (!actionValidation.ok) {
    sendError(response, 400, actionValidation.code === "task.unknown_action" ? "task.invalid_action" : actionValidation.code, actionValidation.message, {
      action_catalog: true,
      field_errors: actionValidation.field_errors,
    });
    return;
  }
  const definition = actionValidation.definition;
  const task = listTaskProjections({
    ...runtimeOptions,
    registry,
    projectId: params.projectId,
    intentSubmissions: listIntentSubmissions({ registry, projectId: params.projectId }).submissions,
  }).tasks.find((candidate) => candidate.task_id === params.taskId);
  if (!task) {
    sendError(response, 404, "task.not_found", `Task '${params.taskId}' was not found.`);
    return;
  }
  try {
    if (task.completed_read_only === true && action !== "follow-up") {
      sendError(response, 409, "task.completed_read_only", "Completed Tasks are immutable; create a follow-up Intent instead.");
      return;
    }
    if (action === "follow-up") {
      if (task.completed_read_only !== true) {
        sendError(response, 409, "task.follow_up_requires_completion", "Follow-up Tasks can only be created from a completed Task.");
        return;
      }
      const requestText = asString(payload.request_text);
      if (!requestText) {
        sendError(response, 400, "task.follow_up_text_required", "A follow-up Task requires request_text.");
        return;
      }
      const result = createIntentSubmission({
        registry,
        projectId: params.projectId,
        requestText,
        attachments: [],
        markdownSources: [],
        autoPrepare: true,
      });
      sendJson(response, 202, {
        task_id: task.task_id,
        action,
        intent_submission: result.submission,
        readback: { durable: true, task_id: task.task_id, new_intent_submission_id: result.submission.submission_id, follow_up: true },
      });
      return;
    }
    const durableReadback = (result = null, status = null) => {
      const tasks = listTaskProjections({
        ...runtimeOptions,
        registry,
        projectId: params.projectId,
        intentSubmissions: listIntentSubmissions({ registry, projectId: params.projectId }).submissions,
      });
      const refreshed = tasks.tasks.find((candidate) => candidate.task_id === task.task_id)
        ?? (result?.flow_id ? tasks.tasks.find((candidate) => candidate.flow_id === result.flow_id) : null)
        ?? task;
      return {
        durable: true,
        task: refreshed,
        task_id: refreshed.task_id,
        intent_submission_ref: refreshed.intent_submission_ref ?? null,
        mission_id: refreshed.mission_id ?? null,
        flow_id: refreshed.flow_id ?? result?.flow_id ?? null,
        run_ids: refreshed.run_ids ?? [],
        revision: refreshed.revision ?? null,
        state: refreshed.status_detail ?? refreshed.status ?? null,
        evidence_refs: refreshed.evidence_refs ?? [],
        ...(status ? { result_status: status } : {}),
      };
    };
    if (["confirm", "start"].includes(action)) {
      if (action === "start" && task.status === "prepared") {
        const route = task.prepared_contract?.approved_execution_route;
        if (!route?.route_id || route.readiness !== "ready") {
          sendError(response, 409, "task.execution_route_not_ready", "Task start requires an approved execution route with a ready readiness revision.", {
            recovery_actions: [{ action: "refresh", payload: { resource: `task://${task.task_id}`, current_revision: task.revision ?? null } }],
          });
          return;
        }
      }
      const submissionId = asString(task.lineage?.intent_submission_id);
      if (!submissionId) {
        sendError(response, 409, "task.confirm_unavailable", "This Task is not an intent-backed prepared submission.");
        return;
      }
      const result = action === "confirm"
        ? confirmIntent({ registry, projectId: params.projectId, submissionId, expectedRevision: Number.isInteger(payload.expected_revision) ? payload.expected_revision : task.revision })
        : confirmAndStartIntent({ registry, projectId: params.projectId, submissionId, expectedRevision: Number.isInteger(payload.expected_revision) ? payload.expected_revision : task.revision });
      sendJson(response, action === "start" ? 202 : 200, { task_id: task.task_id, action, confirmation: result, readback: durableReadback(result, action === "start" ? "accepted" : "confirmed") });
      return;
    }
    if (definition.dispatch === "intent.prepare") {
      const submissionId = asString(task.lineage?.intent_submission_id);
      if (!submissionId) {
        sendError(response, 409, "task.prepare_unavailable", "This Task has no intent submission that can be resumed.");
        return;
      }
      const result = prepareIntentSubmission({ registry, projectId: params.projectId, submissionId });
      sendJson(response, 202, {
        task_id: task.task_id,
        action,
        preparation: result,
        readback: durableReadback(result, "accepted"),
      });
      return;
    }
    if (action === "request" || action === "retry") {
      const requestText = asString(payload.request_text) ?? (action === "retry" ? "Request a bounded retry for this Task after reviewing the recorded failure." : "");
      if (!requestText) {
        sendError(response, 400, "task.request_text_required", "A durable Task request requires request_text.");
        return;
      }
      const result = createOperatorRequest({
        ...runtimeOptions,
        sourceSurface: "task-workspace",
        targetStage: asString(task.current_step) ?? "implement",
        intentType: action === "retry" ? "repair" : (asString(payload.intent_type) ?? "analyze"),
        requestText,
        targetFlowId: task.flow_id ?? undefined,
        targetRefs: asStringArray(task.evidence_refs),
        allowedPaths: asStringArray(payload.allowed_paths),
        idempotencyKey: asString(payload.idempotency_key) ?? asString(payload.command_id) ?? undefined,
        deliveryMode: "no-write",
      });
      sendJson(response, result.idempotent ? 200 : 201, {
        task_id: task.task_id,
        action,
        operator_request: {
          request_id: result.requestId,
          operator_request_ref: result.operatorRequestRef,
          status: result.status,
          idempotent: result.idempotent === true,
          document: result.operatorRequest,
        },
        readback: durableReadback(result),
      });
      return;
    }
    if (definition.dispatch === "readback") {
      sendJson(response, 200, { task_id: task.task_id, action, accepted: true, readback: durableReadback(null, "read-only") });
      return;
    }
    if (definition.dispatch === "lifecycle") {
      if (task.primary_action?.action_id !== action) {
        sendError(response, 409, "task.action_not_current", `Task action '${action}' is not the server-published next action.`, {
          current_action: task.primary_action?.action_id ?? null,
          recovery_actions: [{ action: "refresh", payload: { resource: `task://${task.task_id}`, current_revision: task.revision ?? null } }],
        });
        return;
      }
      const flags = {};
      if (action === "discovery-run" && task.intent_submission_ref) flags["input-packet"] = task.intent_submission_ref;
      if (["review-run", "learning-handoff"].includes(action) && task.run_ids?.[0]) flags["run-id"] = task.run_ids[0];
      if (["delivery-prepare", "release-prepare"].includes(action)) {
        if (task.run_ids?.[0]) flags["run-id"] = task.run_ids[0];
        flags.mode = task.prepared_contract?.delivery_mode ?? "no-write";
        flags["require-review-decision"] = true;
      }
      for (const [key, value] of Object.entries(payload)) {
        if (["action", "expected_revision", "command_id", "request_text", "allowed_paths", "intent_type"].includes(key)) continue;
        if (value !== undefined) flags[key] = value;
      }
      const lifecycle = runLifecycleCommand({
        ...runtimeOptions,
        cwd: runtimeOptions.cwd ?? runtimeOptions.projectRef,
        projectRef: runtimeOptions.projectRef,
        command: definition.lifecycle_command,
        flags,
      });
      if (!lifecycle.ok) {
        sendError(response, lifecycle.statusCode ?? 409, lifecycle.error?.code ?? "task.lifecycle_blocked", lifecycle.error?.detail ?? "Published Task action is blocked.", {
          action_id: action,
          evidence_refs: lifecycle.result?.evidence_refs ?? [],
          recovery_actions: [{ action: "retry", payload: { task_id: task.task_id, action } }],
        });
        return;
      }
      sendJson(response, lifecycle.statusCode === 202 ? 202 : 200, {
        task_id: task.task_id,
        action,
        lifecycle_command: lifecycle.result,
        readback: durableReadback(lifecycle.result, "accepted"),
      });
      return;
    }
    const runId = task.run_ids?.[0];
    if (!runId) {
      sendError(response, 409, "task.control_unavailable", "This Task has no server-owned active run reference for the requested control.", {
        recovery_actions: [{ action: "request", payload: { task_id: task.task_id, reason: "Inspect the Task runtime state and create a bounded operator request." } }],
      });
      return;
    }
    const result = applyRunControlAction({
      ...runtimeOptions,
      action,
      runId,
      commandId: asString(payload.command_id) ?? `task.${task.task_id}.${action}`,
      expectedRevision: Number.isInteger(payload.expected_revision) ? payload.expected_revision : undefined,
      approvalRef: asString(payload.approval_ref) ?? undefined,
      reason: asString(payload.reason) ?? `Task Workspace requested ${action}.`,
    });
    if (result.blocked) {
      sendError(response, 409, result.blockedReason?.code ?? "task.control_blocked", result.blockedReason?.message ?? "Task control action is blocked.", {
        recovery_actions: [{ action: "request", payload: { task_id: task.task_id, reason: "Create a durable operator request for this blocked control." } }],
      });
      return;
    }
    sendJson(response, 200, { task_id: task.task_id, action, run_control: result, readback: durableReadback({ flow_id: task.flow_id, run_id: runId }, result.blocked ? "blocked" : "accepted") });
  } catch (error) {
    if (error instanceof IntentServiceError) {
      sendError(response, error.statusCode ?? 409, error.code, error.message, error.details);
      return;
    }
    if (error instanceof OperatorRequestError) {
      sendError(response, error.statusCode, error.code, error.message);
      return;
    }
    sendError(response, 500, error?.code ?? "task.action_failed", error instanceof Error ? error.message : "Task action failed.");
  }
}

export async function handleProjectTopologyAction({ request, response, params, registry }) {
  const payload = await readMutationPayload(request, response);
  if (!payload) return;
  try {
    const result = applyTopologyAction({
      registry,
      projectId: params.projectId,
      expectedRevision: Number.isInteger(payload.expected_revision) ? payload.expected_revision : undefined,
      action: asString(payload.action) ?? "",
      family: asString(payload.family) ?? "topology",
      payload: payload.value && typeof payload.value === "object" && !Array.isArray(payload.value) ? payload.value : {},
    });
    sendJson(response, payload.action === "reanalyze" ? 202 : 200, result);
  } catch (error) {
    if (error instanceof TopologyManagementError) {
      sendError(response, error.statusCode, error.code, error.message);
      return;
    }
    throw error;
  }
}

export async function handleExecutionProfileAction({ request, response, params, registry }) {
  const payload = await readMutationPayload(request, response);
  if (!payload) return;
  try {
    const result = applyExecutionProfileAction({
      registry,
      projectId: params.projectId,
      action: asString(payload.action) ?? "",
      step: asString(payload.step) ?? undefined,
      routeId: asString(payload.route_id) ?? undefined,
      expectedRevision: Number.isInteger(payload.expected_revision) ? payload.expected_revision : undefined,
    });
    sendJson(response, payload.action === "check" ? 202 : 200, result);
  } catch (error) {
    if (error instanceof ExecutionProfileError) {
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
 * Explicit API parity surface for the quality-repair retry mutation. The
 * lifecycle command remains the canonical implementation; this route only
 * supplies a typed action envelope for API clients.
 */
export async function handleQualityRepairAction({ request, response, runtimeOptions }) {
  const payload = await readMutationPayload(request, response);
  if (!payload) return;
  if (asString(payload.action) !== "retry") {
    sendError(response, 400, "quality_repair.invalid_action", "Quality repair action must be 'retry'.");
    return;
  }
  const flags = { ...payload };
  delete flags.action;
  const result = runLifecycleCommand({
    ...runtimeOptions,
    command: "repair retry",
    flags,
  });
  if (!result.ok) {
    sendJson(response, result.statusCode, {
      error: result.error,
      ...(result.result ? { lifecycle_command: toLifecycleCommandResponse(result.result) } : {}),
    });
    return;
  }
  sendJson(response, 200, { quality_repair: toLifecycleCommandResponse(result.result) });
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
      idempotencyKey: asString(payload.idempotency_key) ?? undefined,
      targetRefs: asStringArray(payload.target_refs),
      allowedPaths: asStringArray(payload.allowed_paths),
      deliveryMode: asString(payload.delivery_mode) ?? undefined,
    });
    sendJson(response, result.idempotent ? 200 : 201, {
      operator_request: {
        request_id: result.requestId,
        operator_request_ref: result.operatorRequestRef,
        operator_request_file: result.operatorRequestFile,
        status: result.status,
        idempotent: result.idempotent === true,
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
