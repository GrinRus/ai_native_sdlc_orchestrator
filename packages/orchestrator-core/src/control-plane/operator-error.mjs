export const RECOVERY_ACTION_CATALOG = Object.freeze([
  "retry",
  "refresh",
  "inspect",
  "select_project",
  "rebind_repository",
  "configure_execution",
  "copy_command",
  "continue_in_terminal",
]);

const RETRYABLE_CODES = new Set(["transport_internal_error", "request_timeout", "run_job_conflict"]);

function titleFromCode(code) {
  return code.replace(/[._-]+/gu, " ").replace(/^\w/u, (value) => value.toUpperCase());
}

export function createOperatorError(options) {
  const code = String(options.code ?? "operator_error");
  const detail = String(options.detail ?? options.message ?? "The operation could not be completed.");
  const retryable = options.retryable ?? RETRYABLE_CODES.has(code);
  const recoveryActions = Array.isArray(options.recovery_actions)
    ? options.recovery_actions.filter((action) => RECOVERY_ACTION_CATALOG.includes(action.action))
    : [{ action: retryable ? "retry" : "inspect", payload: { resource: options.resource ?? null } }];
  return {
    code,
    title: String(options.title ?? titleFromCode(code)),
    detail,
    message: detail,
    operation: options.operation ?? null,
    phase: options.phase ?? "transport",
    resource: options.resource ?? null,
    consequence: options.consequence ?? "operation_not_completed",
    retryable,
    project_ref: options.project_ref ?? null,
    flow_ref: options.flow_ref ?? null,
    run_ref: options.run_ref ?? null,
    field_errors: Array.isArray(options.field_errors) ? options.field_errors : [],
    evidence_refs: Array.isArray(options.evidence_refs) ? options.evidence_refs : [],
    recovery_actions: recoveryActions,
  };
}
