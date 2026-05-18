import { asPositiveInteger, asRecord, asString } from "./http-utils.mjs";

/**
 * @param {{ action: string, runId: string, blocked: boolean, blockedReason?: { code?: string, message?: string } | null, applied: boolean, transition: unknown, guardrails: unknown, state: unknown, stateFile: string, auditRecord: { audit_id: string }, auditFile: string, primaryEvent: { event_id: string }, evidenceEvent: { event_id: string }, streamLogFile: string, nextActions: unknown }} result
 * @returns {Record<string, unknown>}
 */
export function toRunControlResponse(result) {
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
 * @param {{ action: string, idempotent: boolean, state: Record<string, unknown>, stateFile: string }} result
 * @returns {Record<string, unknown>}
 */
export function toUiLifecycleResponse(result) {
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
 * @param {{ command: string, args: string[], exit_code: number, stdout: string, stderr: string, command_output: Record<string, unknown> | null, artifact_refs: string[], evidence_refs: string[], blocked: boolean, blocked_reason: Record<string, unknown> | null, interactive_continuation: Record<string, unknown> | null }} result
 * @returns {Record<string, unknown>}
 */
export function toLifecycleCommandResponse(result) {
  return {
    command: result.command,
    args: result.args,
    exit_code: result.exit_code,
    stdout: result.stdout,
    stderr: result.stderr,
    command_output: result.command_output,
    artifact_refs: result.artifact_refs,
    evidence_refs: result.evidence_refs,
    blocked: result.blocked,
    blocked_reason: result.blocked_reason,
    interactive_continuation: result.interactive_continuation,
  };
}

/**
 * @param {{ runId: string, interactionId: string, interactionStatus: string, answerAccepted: boolean, answerAuditFile: string, answerAuditRef: string, stepResultFile: string, stepResultRef: string, runControlTransition: unknown, blocked: boolean, blockedReason: Record<string, unknown> | null, evidenceEvent: { event_id: string }, stepEvent: { event_id: string }, resumedEvent?: { event_id: string }, blockedEvent?: { event_id: string } | null, warningEvent?: { event_id: string } | null, streamLogFile: string }} result
 * @returns {Record<string, unknown>}
 */
export function toInteractionAnswerResponse(result) {
  return {
    run_id: result.runId,
    interaction_id: result.interactionId,
    interaction_status: result.interactionStatus,
    answer_accepted: result.answerAccepted,
    answer_audit_file: result.answerAuditFile,
    answer_audit_ref: result.answerAuditRef,
    step_result_file: result.stepResultFile,
    step_result_ref: result.stepResultRef,
    run_control_transition: result.runControlTransition,
    blocked: result.blocked,
    blocked_reason: result.blockedReason,
    evidence_event_id: result.evidenceEvent.event_id,
    step_event_id: result.stepEvent.event_id,
    resumed_event_id: result.resumedEvent?.event_id ?? null,
    blocked_event_id: result.blockedEvent?.event_id ?? null,
    warning_event_id: result.warningEvent?.event_id ?? null,
    stream_log_file: result.streamLogFile,
  };
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
 * @param {Record<string, unknown>} payload
 * @returns {Record<string, unknown> | null}
 */
function toPolicyContext(payload) {
  const policyContext = asRecord(payload.policy_context);
  if (Object.keys(policyContext).length === 0) {
    return null;
  }
  return {
    action: asString(policyContext.action),
    risk_tier: asString(policyContext.risk_tier),
    high_risk: policyContext.high_risk === true,
    approval_required: policyContext.approval_required === true,
    approval_ref_present: policyContext.approval_ref_present === true,
  };
}

/**
 * @param {Record<string, unknown>} event
 */
export function toHistoryEvent(event) {
  const payload = asRecord(event.payload);
  const interaction = asRecord(payload.interaction);
  const continuation = asRecord(interaction.continuation);
  return {
    event_id: asString(event.event_id) ?? "",
    timestamp: asString(event.timestamp),
    event_type: asString(event.event_type) ?? "unknown",
    sequence: asPositiveInteger(payload.sequence),
    summary: asString(payload.summary),
    control_action: asString(payload.control_action),
    step_id: asString(payload.step_id),
    status: asString(payload.status),
    interaction_id: asString(payload.interaction_id),
    step_result_ref: asString(payload.step_result_ref),
    answer_audit_ref: asString(payload.answer_audit_ref),
    interaction:
      Object.keys(interaction).length > 0
        ? {
            interaction_id: asString(interaction.interaction_id),
            status: asString(interaction.status),
            step_result_ref: asString(interaction.step_result_ref),
            question_summary: asString(interaction.question_summary),
            answer_required: interaction.answer_required === true,
            answer_audit_refs: asStringArray(interaction.answer_audit_refs),
            continuation:
              Object.keys(continuation).length > 0
                ? {
                    next_action: asString(continuation.next_action),
                    reason_code: asString(continuation.reason_code),
                  }
                : null,
          }
        : null,
    policy_context: toPolicyContext(payload),
  };
}
