export const PROVIDER_STEP_STATUS_SUPERVISION_SOURCE = String.raw`
function isCanceledStatus(value) {
  const status = asString(value);
  return status === "canceled" || status === "cancelled" || status === "interrupted";
}

function parseIsoMs(value) {
  const stringValue = asString(value);
  if (!stringValue) return null;
  const parsed = Date.parse(stringValue);
  return Number.isFinite(parsed) ? parsed : null;
}

function writeProviderStepStatus(patch = {}) {
  const providerConfig = asObject(options.provider_step_status);
  const stateFile = asString(providerConfig.state_file);
  if (!stateFile) return;

  const now = new Date();
  const nowIso = now.toISOString();
  let state = {};
  try {
    state = asObject(JSON.parse(fs.readFileSync(stateFile, "utf8")));
  } catch {
    state = {};
  }
  const previous = asObject(state.provider_step_status);
  const startedAt = asString(previous.started_at) || asString(providerConfig.started_at) || nowIso;
  const startedMs = parseIsoMs(startedAt) || now.getTime();
  const timeoutBudgetMs = asNumber(previous.timeout_budget_ms) || asNumber(providerConfig.timeout_budget_ms) || timeoutMs;
  const elapsedMs = Math.max(0, Math.floor(now.getTime() - startedMs));
  const remainingBudgetMs = Math.max(0, Math.floor(timeoutBudgetMs - elapsedMs));
  const lastOutputAt = asString(patch.last_output_at) || asString(previous.last_output_at) || null;
  const lastArtifactUpdateAt =
    asString(patch.last_artifact_update_at) || asString(previous.last_artifact_update_at) || null;
  const lastProgressAt = asString(patch.last_progress_at) || asString(previous.last_progress_at) || null;
  const progressEventCount =
    asNumber(patch.progress_event_count) !== null
      ? Math.max(0, Math.floor(asNumber(patch.progress_event_count)))
      : asNumber(previous.progress_event_count) !== null
        ? Math.max(0, Math.floor(asNumber(previous.progress_event_count)))
        : null;
  const lastActivityMs = Math.max(parseIsoMs(lastOutputAt) || startedMs, parseIsoMs(lastArtifactUpdateAt) || startedMs);
  const lastObservedActivityMs = Math.max(lastActivityMs, parseIsoMs(lastProgressAt) || startedMs);
  const silentMs = Math.max(0, Math.floor(now.getTime() - lastObservedActivityMs));
  const timeoutRiskThreshold = Math.min(60000, Math.max(5000, Math.floor(timeoutBudgetMs * 0.1)));
  const terminalStatus = patch.status === "completed" || patch.status === "failed" || patch.status === "interrupted";
  let status = asString(patch.status) || asString(previous.status) || "running";
  if (!terminalStatus) {
    if (remainingBudgetMs <= timeoutRiskThreshold) {
      status = "timeout-risk";
    } else if (silentMs >= 60000) {
      status = "silent-running";
    } else {
      status = "running";
    }
  }

  const nextProviderStepStatus = {
    provider: asString(providerConfig.provider) || asString(previous.provider),
    adapter: asString(providerConfig.adapter) || asString(previous.adapter),
    route_id: asString(providerConfig.route_id) || asString(previous.route_id),
    step_id: asString(providerConfig.step_id) || asString(previous.step_id),
    status,
    elapsed_ms: elapsedMs,
    timeout_budget_ms: timeoutBudgetMs,
    remaining_budget_ms: remainingBudgetMs,
    last_output_at: lastOutputAt,
    last_artifact_update_at: lastArtifactUpdateAt,
    last_progress_at: lastProgressAt,
    last_progress_kind: asString(patch.last_progress_kind) || asString(previous.last_progress_kind) || null,
    last_progress_label: asString(patch.last_progress_label) || asString(previous.last_progress_label) || null,
    progress_event_count: progressEventCount,
    output_mode: asString(patch.output_mode) || asString(previous.output_mode) || null,
    interruption_owner: asString(patch.interruption_owner) || asString(previous.interruption_owner) || null,
    interruption_reason: asString(patch.interruption_reason) || asString(previous.interruption_reason) || null,
    interruption_status: asString(patch.interruption_status) || asString(previous.interruption_status) || null,
    session_budget:
      Object.keys(asObject(patch.session_budget)).length > 0
        ? asObject(patch.session_budget)
        : Object.keys(asObject(previous.session_budget)).length > 0
          ? asObject(previous.session_budget)
          : null,
    current_command_label:
      asString(providerConfig.current_command_label) || asString(previous.current_command_label) || "external-provider-runner",
    recommended_action:
      asString(patch.recommended_action) ||
      (status === "timeout-risk"
        ? "Check provider progress or stop before budget is exhausted."
        : status === "silent-running"
          ? "No output yet; provider is still running."
          : lastProgressAt
            ? "Provider stream progress observed; keep monitoring until the step completes."
          : status === "failed"
            ? "Inspect provider evidence and failure summary."
            : status === "completed"
              ? "Continue with post-run verification."
              : "Provider is still running."),
    started_at: startedAt,
    updated_at: nowIso,
    finished_at: asString(patch.finished_at) || asString(previous.finished_at) || null,
  };
  state.provider_step_status = nextProviderStepStatus;
  state.updated_at = nowIso;
  try {
    const latestState = asObject(JSON.parse(fs.readFileSync(stateFile, "utf8")));
    const latestProviderStatus = asString(asObject(latestState.provider_step_status).status);
    const nextStatus = asString(nextProviderStepStatus.status);
    if (isCanceledStatus(latestState.status)) {
      state = { ...latestState, provider_step_status: nextProviderStepStatus, updated_at: nowIso };
    }
    if (latestProviderStatus === "interrupted" && nextStatus !== "interrupted") {
      const latestProviderStepStatus = asObject(latestState.provider_step_status);
      state.provider_step_status = {
        ...nextProviderStepStatus,
        status: "interrupted",
        interruption_owner:
          asString(latestProviderStepStatus.interruption_owner) || nextProviderStepStatus.interruption_owner,
        interruption_reason:
          asString(latestProviderStepStatus.interruption_reason) || nextProviderStepStatus.interruption_reason,
        interruption_status:
          asString(latestProviderStepStatus.interruption_status) || nextProviderStepStatus.interruption_status,
        recommended_action:
          asString(latestProviderStepStatus.recommended_action) ||
          "Provider was stopped by the operator; save partial evidence, then diagnose or retry the public step.",
      };
    }
    const tempStateFile =
      stateFile + ".provider-" + String(process.pid) + "-" + String(Date.now()) + ".tmp";
    try {
      fs.writeFileSync(tempStateFile, JSON.stringify(state, null, 2) + "\n", "utf8");
      fs.renameSync(tempStateFile, stateFile);
    } finally {
      try {
        fs.unlinkSync(tempStateFile);
      } catch {}
    }
  } catch {}
}

function readProviderStepState() {
  const providerConfig = asObject(options.provider_step_status);
  const stateFile = asString(providerConfig.state_file);
  if (!stateFile) return {};
  try {
    return asObject(JSON.parse(fs.readFileSync(stateFile, "utf8")));
  } catch {
    return {};
  }
}

function providerCancellationRequested() {
  const state = readProviderStepState();
  const stateStatus = asString(state.status);
  const providerStatus = asString(asObject(state.provider_step_status).status);
  return (
    stateStatus === "canceled" ||
    stateStatus === "cancelled" ||
    stateStatus === "interrupted" ||
    providerStatus === "interrupted"
  );
}
`;
