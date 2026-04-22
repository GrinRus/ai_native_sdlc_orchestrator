import { applyRunControlAction as applyRunControlActionCore, readRunControlState as readRunControlStateCore } from "../../../packages/orchestrator-core/src/run-control.mjs";

import { appendRunEvent } from "./live-event-stream.mjs";

/**
 * @param {string} action
 * @param {boolean} blocked
 * @returns {"run.started" | "run.terminal" | "step.updated" | "warning.raised"}
 */
function resolveLiveEventType(action, blocked) {
  if (blocked) {
    return "warning.raised";
  }

  if (action === "start") {
    return "run.started";
  }

  if (action === "cancel") {
    return "run.terminal";
  }

  return "step.updated";
}

/**
 * @param {ReturnType<typeof applyRunControlActionCore>} result
 * @returns {Record<string, unknown>}
 */
function buildPrimaryPayload(result) {
  if (result.blocked) {
    return {
      code: result.blockedReason?.code ?? "run_control.blocked",
      summary: result.blockedReason?.message ?? "Run-control action blocked by guardrail.",
      control_action: result.action,
      blocked: true,
      audit_id: result.auditRecord.audit_id,
    };
  }

  if (result.action === "start") {
    return {
      status: result.state?.status ?? "running",
      control_action: result.action,
      summary: "Run-control lifecycle started.",
      audit_id: result.auditRecord.audit_id,
    };
  }

  if (result.action === "cancel") {
    return {
      status: result.state?.status ?? "canceled",
      control_action: result.action,
      summary: "Run-control lifecycle canceled.",
      audit_id: result.auditRecord.audit_id,
    };
  }

  return {
    step_id: "run.control",
    status: result.state?.status ?? null,
    control_action: result.action,
    target_step: result.state?.current_step ?? null,
    summary: `Run-control action '${result.action}' applied.`,
    audit_id: result.auditRecord.audit_id,
  };
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef: string,
 *   runtimeRoot?: string,
 *   runId?: string,
 *   action: "start" | "pause" | "resume" | "steer" | "cancel",
 *   targetStep?: string,
 *   reason?: string,
 *   approvalRef?: string,
 * }} options
 */
export function applyRunControlAction(options) {
  const result = applyRunControlActionCore(options);
  const primaryEventType = resolveLiveEventType(result.action, result.blocked);
  const primaryEvent = appendRunEvent({
    cwd: options.cwd,
    projectRef: options.projectRef,
    runtimeRoot: options.runtimeRoot,
    runId: result.runId,
    eventType: primaryEventType,
    payload: buildPrimaryPayload(result),
  });

  const evidenceEvent = appendRunEvent({
    cwd: options.cwd,
    projectRef: options.projectRef,
    runtimeRoot: options.runtimeRoot,
    runId: result.runId,
    eventType: "evidence.linked",
    payload: {
      control_action: result.action,
      control_audit_file: result.auditFile,
      control_state_file: result.stateFile,
      blocked: result.blocked,
      evidence_root: result.runtimeLayout.reportsRoot,
    },
  });

  return {
    ...result,
    primaryEvent: primaryEvent.event,
    evidenceEvent: evidenceEvent.event,
    streamLogFile: evidenceEvent.logFile,
  };
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef: string,
 *   runtimeRoot?: string,
 *   runId: string,
 * }} options
 */
export function readRunControlState(options) {
  return readRunControlStateCore(options);
}
