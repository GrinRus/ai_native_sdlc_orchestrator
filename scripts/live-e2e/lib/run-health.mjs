import { asNonEmptyString, asRecord } from "./common.mjs";

const POST_RUN_DIAGNOSTIC_INTENT = "post-run-diagnostic";

function commandCompleted(diagnostic, diagnosticFailureMode) {
  if (
    asNonEmptyString(diagnostic.diagnostic_intent) === POST_RUN_DIAGNOSTIC_INTENT &&
    diagnosticFailureMode === "warn"
  ) {
    return true;
  }
  return ["pass", "warn", "interaction_required", "resumed"].includes(asNonEmptyString(diagnostic.status)) ||
    diagnostic.accepted_nonzero_payload === true;
}

/**
 * Keep explicit warning diagnostics in diagnostic health without also
 * classifying them as failed public control-plane commands.
 *
 * @param {{ flowResult: { commandResults: Array<Record<string, unknown>>, artifacts: Record<string, unknown> }, observationReport?: Record<string, unknown> }} options
 * @returns {Record<string, unknown>}
 */
export function buildCommandHealth(options) {
  const policy = asRecord(options.flowResult.artifacts.post_run_quality_policy);
  const declaredMode = asNonEmptyString(policy.diagnosticFailureMode) || asNonEmptyString(policy.diagnostic_failure_mode);
  const diagnosticFailureMode = declaredMode === "warn" || declaredMode === "fail" ? declaredMode : null;
  const commandResults = options.flowResult.commandResults.length > 0
    ? options.flowResult.commandResults
    : Array.isArray(options.observationReport?.step_journal)
      ? options.observationReport.step_journal
          .map((entry) => asRecord(entry))
          .filter((entry) => asNonEmptyString(entry.transcript_ref))
          .map((entry) => {
            const analysis = asRecord(entry.deterministic_analysis);
            const status = asNonEmptyString(analysis.status);
            return {
              command_surface: asNonEmptyString(entry.public_surface) || asNonEmptyString(entry.step_id) || "unknown",
              status: ["pass", "warn", "interaction_required", "resumed"].includes(status) ? status : "fail",
              exit_code: typeof analysis.exit_code === "number" ? analysis.exit_code : null,
              transcript_ref: asNonEmptyString(entry.transcript_ref),
              summary: asNonEmptyString(asRecord(entry.stage_result).summary) || asNonEmptyString(entry.step_id) || null,
            };
          })
      : [];
  const failedCommands = commandResults
    .filter((entry) => !commandCompleted(entry, diagnosticFailureMode))
    .map((entry) => ({
      command_surface: asNonEmptyString(entry.command_surface) || asNonEmptyString(entry.command) || "unknown",
      diagnostic_intent: asNonEmptyString(entry.diagnostic_intent) || null,
      status: asNonEmptyString(entry.status) || "unknown",
      exit_code: typeof entry.exit_code === "number" ? entry.exit_code : null,
      transcript_ref: asNonEmptyString(entry.transcript_ref) || null,
      summary: asNonEmptyString(entry.summary) || asNonEmptyString(entry.stderr) || "Public command did not complete.",
    }));
  return {
    status: failedCommands.length === 0 ? "pass" : "fail",
    command_count: commandResults.length,
    failed_command_count: failedCommands.length,
    failed_commands: failedCommands,
  };
}
