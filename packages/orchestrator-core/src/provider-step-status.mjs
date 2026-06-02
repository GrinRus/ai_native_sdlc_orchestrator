const RUNNING_STATUSES = new Set(["starting", "running", "silent-running", "artifact-updated", "timeout-risk"]);
const TERMINAL_STATUSES = new Set(["completed", "interrupted", "failed"]);
const PROVIDER_STEP_STATUSES = new Set([...RUNNING_STATUSES, ...TERMINAL_STATUSES]);
const DEFAULT_SILENT_AFTER_MS = 60_000;

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function asString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function asNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function parseIsoMs(value) {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * @param {number} value
 * @returns {number}
 */
function nonNegativeInteger(value) {
  return Math.max(0, Math.floor(value));
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeStatus(value) {
  const status = asString(value);
  return status && PROVIDER_STEP_STATUSES.has(status) ? status : "starting";
}

/**
 * @param {Record<string, unknown>} input
 * @param {{ nowMs?: number, silentAfterMs?: number }} [options]
 * @returns {Record<string, unknown> | null}
 */
export function normalizeProviderStepStatus(input, options = {}) {
  const raw = asRecord(input);
  if (Object.keys(raw).length === 0) return null;

  const nowMs = Number.isFinite(options.nowMs) ? Math.floor(/** @type {number} */ (options.nowMs)) : Date.now();
  const silentAfterMs = Number.isFinite(options.silentAfterMs)
    ? Math.max(0, Math.floor(/** @type {number} */ (options.silentAfterMs)))
    : DEFAULT_SILENT_AFTER_MS;
  const startedAt = asString(raw.started_at) ?? asString(raw.updated_at) ?? new Date(nowMs).toISOString();
  const finishedAt = asString(raw.finished_at);
  const statusBase = normalizeStatus(raw.status);
  const terminal = TERMINAL_STATUSES.has(statusBase);
  const endMs = terminal ? parseIsoMs(finishedAt) ?? nowMs : nowMs;
  const startedMs = parseIsoMs(startedAt) ?? endMs;
  const elapsedMs = nonNegativeInteger(asNumber(raw.elapsed_ms) ?? endMs - startedMs);
  const rawTimeoutBudgetMs = asNumber(raw.timeout_budget_ms);
  const timeoutBudgetMs = rawTimeoutBudgetMs !== null ? nonNegativeInteger(rawTimeoutBudgetMs) : null;
  const rawRemainingBudgetMs = asNumber(raw.remaining_budget_ms);
  const remainingBudgetMs =
    timeoutBudgetMs !== null
      ? nonNegativeInteger(timeoutBudgetMs - elapsedMs)
      : rawRemainingBudgetMs !== null
        ? nonNegativeInteger(rawRemainingBudgetMs)
        : null;
  const lastOutputAt = asString(raw.last_output_at);
  const lastArtifactUpdateAt = asString(raw.last_artifact_update_at);
  const lastActivityMs = Math.max(
    parseIsoMs(lastOutputAt) ?? startedMs,
    parseIsoMs(lastArtifactUpdateAt) ?? startedMs,
  );
  const silentMs = nonNegativeInteger(nowMs - lastActivityMs);
  const timeoutRiskThreshold =
    timeoutBudgetMs !== null ? Math.min(60_000, Math.max(5_000, Math.floor(timeoutBudgetMs * 0.1))) : null;

  let status = statusBase;
  if (!terminal) {
    if (timeoutBudgetMs !== null && remainingBudgetMs !== null && remainingBudgetMs <= (timeoutRiskThreshold ?? 0)) {
      status = "timeout-risk";
    } else if (silentMs >= silentAfterMs) {
      status = "silent-running";
    } else if (lastArtifactUpdateAt && (parseIsoMs(lastArtifactUpdateAt) ?? 0) >= lastActivityMs) {
      status = "artifact-updated";
    } else if (status === "starting" && elapsedMs > 0) {
      status = "running";
    }
  }

  const recommendedAction =
    asString(raw.recommended_action) ??
    (status === "timeout-risk"
      ? "Check provider progress or stop before budget is exhausted."
      : status === "silent-running"
        ? "No output yet; keep monitoring or diagnose if budget risk increases."
        : status === "failed"
          ? "Inspect provider evidence and failure summary."
          : status === "interrupted"
            ? "Save partial evidence, then diagnose or retry the public step."
            : status === "completed"
              ? "Continue with post-run verification."
              : "Provider is still running.");

  return {
    provider: asString(raw.provider),
    adapter: asString(raw.adapter),
    route_id: asString(raw.route_id),
    step_id: asString(raw.step_id),
    status,
    elapsed_ms: elapsedMs,
    timeout_budget_ms: timeoutBudgetMs,
    remaining_budget_ms: remainingBudgetMs,
    last_output_at: lastOutputAt,
    last_artifact_update_at: lastArtifactUpdateAt,
    current_command_label: asString(raw.current_command_label) ?? "external-provider-runner",
    recommended_action: recommendedAction,
    started_at: startedAt,
    updated_at: asString(raw.updated_at) ?? new Date(nowMs).toISOString(),
    finished_at: finishedAt,
  };
}

/**
 * @param {Record<string, unknown> | null | undefined} previous
 * @param {Record<string, unknown>} patch
 * @param {{ nowMs?: number }} [options]
 * @returns {Record<string, unknown>}
 */
export function mergeProviderStepStatus(previous, patch, options = {}) {
  const nowMs = Number.isFinite(options.nowMs) ? Math.floor(/** @type {number} */ (options.nowMs)) : Date.now();
  const previousStatus = asRecord(previous);
  const timestamp = new Date(nowMs).toISOString();
  const merged = {
    ...previousStatus,
    ...asRecord(patch),
    started_at: asString(patch.started_at) ?? asString(previousStatus.started_at) ?? timestamp,
    updated_at: asString(patch.updated_at) ?? timestamp,
  };
  return /** @type {Record<string, unknown>} */ (normalizeProviderStepStatus(merged, { nowMs }) ?? merged);
}
