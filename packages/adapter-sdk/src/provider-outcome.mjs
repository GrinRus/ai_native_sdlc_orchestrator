function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}

function rawProviderStatus(runnerPayload) {
  const payload = asRecord(runnerPayload);
  return String(
    payload.semantic_outcome ??
    payload.completion_status ??
    asRecord(payload.terminal_outcome).status ??
    asRecord(payload.outcome).status ??
    payload.status ??
    "",
  ).toLowerCase();
}

export function classifyProviderSemanticFailure(runnerPayload) {
  const status = rawProviderStatus(runnerPayload);
  if (["partial", "incomplete", "needs_fix", "needs-fix"].includes(status)) return "provider-partial-outcome";
  if (["fail", "failed", "blocked", "not_pass"].includes(status)) return "provider-semantic-failure";
  return "";
}

export function buildExternalExecutionOutcome(options) {
  const runnerPayload = asRecord(options.runnerPayload);
  const rawStatus = rawProviderStatus(runnerPayload);
  const providerStatus = ["pass", "passed", "success", "succeeded", "complete", "completed"].includes(rawStatus)
    ? "completed"
    : ["partial", "incomplete", "needs_fix", "needs-fix"].includes(rawStatus)
      ? "partial"
      : ["fail", "failed", "blocked", "not_pass"].includes(rawStatus)
        ? "failed"
        : "unknown";
  const rawVerificationStatus = String(
    runnerPayload.verification_status ??
    asRecord(runnerPayload.verification).status ??
    asRecord(runnerPayload.terminal_outcome).verification_status ??
    "",
  ).toLowerCase();
  const verificationStatus = ["pass", "passed", "success"].includes(rawVerificationStatus)
    ? "pass"
    : ["partial", "warn", "incomplete"].includes(rawVerificationStatus)
      ? "partial"
      : ["fail", "failed", "blocked"].includes(rawVerificationStatus)
        ? "fail"
        : "not-run";
  return {
    schema_version: 1,
    process: { exit_code: options.exitCode, signal: options.signal, timed_out: options.timedOut },
    transport: {
      status: options.interrupted
        ? "interrupted"
        : options.timedOut
          ? "timed-out"
          : options.invocationFailed
            ? "failed"
            : "completed",
    },
    provider: { status: providerStatus, raw_status: rawStatus || null },
    verification: { status: verificationStatus, raw_status: rawVerificationStatus || null },
  };
}
