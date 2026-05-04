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
  return {
    event_id: asString(event.event_id) ?? "",
    timestamp: asString(event.timestamp),
    event_type: asString(event.event_type) ?? "unknown",
    sequence: asPositiveInteger(payload.sequence),
    summary: asString(payload.summary),
    control_action: asString(payload.control_action),
    step_id: asString(payload.step_id),
    status: asString(payload.status),
    policy_context: toPolicyContext(payload),
  };
}
