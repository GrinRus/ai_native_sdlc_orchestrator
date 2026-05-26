import {
  applyRunControlAction,
  attachUiLifecycle,
  detachUiLifecycle,
  readProjectState,
  readUiLifecycleState,
  runLifecycleCommand,
  submitInteractionAnswer,
} from "../../../api/src/index.mjs";
import { asRecord, asString } from "./shared.mjs";
import { resolveControlPlaneUrl, writeControlPlaneJson } from "./transport.mjs";

/**
 * @param {ReturnType<typeof applyRunControlAction>} result
 * @returns {Record<string, unknown>}
 */
function toRunControlMutationPayload(result) {
  return {
    action: result.action,
    run_id: result.runId,
    blocked: result.blocked,
    blocked_reason: result.blockedReason ?? null,
    applied: result.applied,
    transition: result.transition,
    guardrails: result.guardrails,
    state: result.state,
    state_file: result.stateFile,
    audit_id: result.auditRecord.audit_id,
    audit_file: result.auditFile,
    primary_event_id: result.primaryEvent.event_id,
    evidence_event_id: result.evidenceEvent.event_id,
    stream_log_file: result.streamLogFile,
    next_actions: result.nextActions,
  };
}

/**
 * @param {ReturnType<typeof attachUiLifecycle> | ReturnType<typeof detachUiLifecycle>} result
 * @returns {Record<string, unknown>}
 */
function toUiLifecycleMutationPayload(result) {
  return {
    action: result.action,
    idempotent: result.idempotent,
    connection_state: asString(result.state.connection_state) ?? "detached",
    headless_safe: result.state.headless_safe === true,
    state: result.state,
    state_file: result.stateFile,
  };
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef: string,
 *   runtimeRoot?: string,
 *   controlPlane?: string,
 *   controlPlaneAuthToken?: string,
 *   runId?: string,
 *   action: "start" | "pause" | "resume" | "steer" | "cancel",
 *   targetStep?: string,
 *   reason?: string,
 *   approvalRef?: string,
 * }} options
 */
export async function applyOperatorRunControl(options) {
  const requestedControlPlane = asString(options.controlPlane);
  const controlPlaneAuthToken = asString(options.controlPlaneAuthToken) ?? undefined;
  const uiLifecycle = readUiLifecycleState(options);
  const connectedControlPlane = resolveControlPlaneUrl({
    requestedControlPlane,
    uiLifecycleState: uiLifecycle.state,
  });

  if (connectedControlPlane) {
    const projectState = readProjectState(options);
    const payload = await writeControlPlaneJson({
      controlPlane: connectedControlPlane,
      pathname: `/api/projects/${encodeURIComponent(projectState.project_id)}/run-control/actions`,
      body: {
        action: options.action,
        run_id: options.runId ?? null,
        target_step: options.targetStep ?? null,
        reason: options.reason ?? null,
        approval_ref: options.approvalRef ?? null,
      },
      authToken: controlPlaneAuthToken,
    });
    return {
      binding_mode: "detached-http-mutation",
      control_plane: connectedControlPlane,
      run_control: asRecord(payload).run_control ?? {},
    };
  }

  const result = applyRunControlAction({
    cwd: options.cwd,
    projectRef: options.projectRef,
    runtimeRoot: options.runtimeRoot,
    runId: options.runId,
    action: options.action,
    targetStep: options.targetStep,
    reason: options.reason,
    approvalRef: options.approvalRef,
  });

  return {
    binding_mode: "module-in-process",
    control_plane: null,
    run_control: toRunControlMutationPayload(result),
  };
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef: string,
 *   runtimeRoot?: string,
 *   controlPlane?: string,
 *   controlPlaneAuthToken?: string,
 *   runId?: string,
 *   action: "attach" | "detach",
 * }} options
 */
export async function applyOperatorUiLifecycle(options) {
  const requestedControlPlane = asString(options.controlPlane);
  const controlPlaneAuthToken = asString(options.controlPlaneAuthToken) ?? undefined;
  const uiLifecycle = readUiLifecycleState(options);
  const connectedControlPlane = resolveControlPlaneUrl({
    requestedControlPlane,
    uiLifecycleState: uiLifecycle.state,
  });

  if (connectedControlPlane) {
    const projectState = readProjectState(options);
    const payload = await writeControlPlaneJson({
      controlPlane: connectedControlPlane,
      pathname: `/api/projects/${encodeURIComponent(projectState.project_id)}/ui-lifecycle/actions`,
      body: {
        action: options.action,
        run_id: options.runId ?? null,
        control_plane: options.action === "attach" ? connectedControlPlane : null,
      },
      authToken: controlPlaneAuthToken,
    });
    return {
      binding_mode: "detached-http-mutation",
      control_plane: connectedControlPlane,
      ui_lifecycle: asRecord(payload).ui_lifecycle ?? {},
    };
  }

  const result =
    options.action === "attach"
      ? attachUiLifecycle({
          cwd: options.cwd,
          projectRef: options.projectRef,
          runtimeRoot: options.runtimeRoot,
          runId: options.runId,
          controlPlane: requestedControlPlane ?? undefined,
        })
      : detachUiLifecycle({
          cwd: options.cwd,
          projectRef: options.projectRef,
          runtimeRoot: options.runtimeRoot,
          runId: options.runId,
        });

  return {
    binding_mode: "module-in-process",
    control_plane: null,
    ui_lifecycle: toUiLifecycleMutationPayload(result),
  };
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef: string,
 *   runtimeRoot?: string,
 *   controlPlane?: string,
 *   controlPlaneAuthToken?: string,
 *   command: string,
 *   flags?: Record<string, unknown>,
 * }} options
 */
export async function applyOperatorLifecycleCommand(options) {
  const requestedControlPlane = asString(options.controlPlane);
  const controlPlaneAuthToken = asString(options.controlPlaneAuthToken) ?? undefined;
  const uiLifecycle = readUiLifecycleState(options);
  const connectedControlPlane = resolveControlPlaneUrl({
    requestedControlPlane,
    uiLifecycleState: uiLifecycle.state,
  });

  if (connectedControlPlane) {
    const projectState = readProjectState(options);
    const payload = await writeControlPlaneJson({
      controlPlane: connectedControlPlane,
      pathname: `/api/projects/${encodeURIComponent(projectState.project_id)}/lifecycle-command/actions`,
      body: {
        command: options.command,
        flags: options.flags ?? {},
      },
      authToken: controlPlaneAuthToken,
      allowedStatusCodes: [409],
    });
    return {
      binding_mode: "detached-http-mutation",
      control_plane: connectedControlPlane,
      lifecycle_command: asRecord(payload).lifecycle_command ?? {},
      error: asRecord(payload).error ?? null,
    };
  }

  const result = runLifecycleCommand({
    cwd: options.cwd,
    projectRef: options.projectRef,
    runtimeRoot: options.runtimeRoot,
    command: options.command,
    flags: options.flags,
  });

  return {
    binding_mode: "module-runtime-command",
    control_plane: null,
    lifecycle_command: result.ok ? result.result : result.result ?? {},
    error: result.ok ? null : result.error,
  };
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef: string,
 *   runtimeRoot?: string,
 *   controlPlane?: string,
 *   controlPlaneAuthToken?: string,
 *   runId: string,
 *   interactionId: string,
 *   answer: string,
 *   decision?: string,
 *   reason?: string,
 *   approvalRef?: string,
 *   answerEvidenceRef?: string,
 * }} options
 */
export async function submitOperatorInteractionAnswer(options) {
  const requestedControlPlane = asString(options.controlPlane);
  const controlPlaneAuthToken = asString(options.controlPlaneAuthToken) ?? undefined;
  const uiLifecycle = readUiLifecycleState(options);
  const connectedControlPlane = resolveControlPlaneUrl({
    requestedControlPlane,
    uiLifecycleState: uiLifecycle.state,
  });

  if (connectedControlPlane) {
    const projectState = readProjectState(options);
    const payload = await writeControlPlaneJson({
      controlPlane: connectedControlPlane,
      pathname: `/api/projects/${encodeURIComponent(projectState.project_id)}/interactions/answers`,
      body: {
        run_id: options.runId,
        interaction_id: options.interactionId,
        answer: options.answer,
        decision: options.decision ?? null,
        reason: options.reason ?? null,
        approval_ref: options.approvalRef ?? null,
        answer_evidence_ref: options.answerEvidenceRef ?? null,
      },
      authToken: controlPlaneAuthToken,
      allowedStatusCodes: [409],
    });
    return {
      binding_mode: "detached-http-mutation",
      control_plane: connectedControlPlane,
      interaction_answer: asRecord(payload).interaction_answer ?? {},
      error: asRecord(payload).error ?? null,
    };
  }

  const result = submitInteractionAnswer({
    cwd: options.cwd,
    projectRef: options.projectRef,
    runtimeRoot: options.runtimeRoot,
    runId: options.runId,
    interactionId: options.interactionId,
    answer: options.answer,
    decision: options.decision,
    reason: options.reason,
    approvalRef: options.approvalRef,
    answerEvidenceRef: options.answerEvidenceRef,
  });

  return {
    binding_mode: "module-runtime-command",
    control_plane: null,
    interaction_answer: {
      run_id: result.runId,
      interaction_id: result.interactionId,
      interaction_status: result.interactionStatus,
      answer_accepted: result.answerAccepted,
      decision: result.decision ?? null,
      answer_audit_ref: result.answerAuditRef,
      step_result_ref: result.stepResultRef,
      blocked: result.blocked,
      blocked_reason: result.blockedReason,
      blocked_event_id: result.blockedEvent?.event_id ?? null,
    },
    error: result.blocked
      ? {
          code: "interaction.continuation_blocked",
          message: result.blockedReason?.message,
        }
      : null,
  };
}
