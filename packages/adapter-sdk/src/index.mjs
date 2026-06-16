import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

import { loadContractFile } from "../../contracts/src/index.mjs";
import { SUPPORTED_STEP_CLASSES } from "../../provider-routing/src/route-resolution.mjs";
import { resolveExternalRuntimePermissionPolicy } from "./permission-policy.mjs";

export { resolveExternalRuntimePermissionPolicy } from "./permission-policy.mjs";

const ADAPTER_RESPONSE_STATUSES = Object.freeze(["success", "failed", "blocked"]);
const EXTERNAL_REQUEST_TRANSPORTS = Object.freeze([
  "request-artifact",
  "stdin-json",
  "file-attachment",
  "argv-json",
  "none",
]);
const DEFAULT_CONTEXT_BUDGET_LIMIT_TOKENS = 180_000;
const CONTEXT_BUDGET_WARN_RATIO = 0.8;
const SHORT_EXECUTION_ROOT_MODES = Object.freeze(["short-symlink", "short_symlink"]);

const EXTERNAL_RUNTIME_SUPERVISOR_SOURCE = String.raw`
const { spawn } = require("node:child_process");
const fs = require("node:fs");

function emit(result) {
  process.stdout.write(JSON.stringify(result) + "\n");
}

function readOptions() {
  try {
    return JSON.parse(fs.readFileSync(0, "utf8"));
  } catch (error) {
    emit({
      status: null,
      signal: null,
      stdout: "",
      stderr: "",
      error_code: "SUPERVISOR_INPUT_INVALID",
      error_message: error instanceof Error ? error.message : String(error),
      timed_out: false,
    });
    process.exit(0);
  }
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

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
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + "\n", "utf8");
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

function appendBounded(current, chunk, maxBuffer) {
  const next = current + chunk;
  return next.length > maxBuffer ? next.slice(0, maxBuffer) : next;
}

function safeLabel(value, fallback) {
  const stringValue = asString(value);
  if (!stringValue) return fallback;
  const normalized = stringValue.replace(/[^A-Za-z0-9_.:-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized.length > 0 ? normalized.slice(0, 96) : fallback;
}

function outputModeFromArgs(args) {
  if (!Array.isArray(args)) return null;
  const index = args.findIndex((entry) => entry === "--output-format");
  return index >= 0 ? asString(args[index + 1]) : null;
}

function summarizeProgressEvent(record, observedAt) {
  const event = asObject(record);
  if (Object.keys(event).length === 0) return null;
  const systemPayload = asObject(event.systemPayload);
  const uiEvent = asObject(systemPayload.uiEvent);
  const streamEvent = asObject(event.event);
  const streamContentBlock = asObject(streamEvent.content_block);
  const streamEventType = asString(streamEvent.type);
  const eventName = asString(uiEvent["event.name"]) || asString(event.event_name) || streamEventType;
  const rawType = asString(event.type) || "json";
  const subtype = asString(event.subtype);
  const normalizedEventName = eventName ? eventName.replace(/^qwen-code\./, "") : null;
  const functionName =
    asString(uiEvent.function_name) ||
    asString(asObject(event.functionCall).name) ||
    asString(streamContentBlock.name) ||
    asString(event.tool_name) ||
    asString(event.name);
  const streamBlockType = asString(streamContentBlock.type);

  let kind = safeLabel(normalizedEventName || rawType, "json");
  let label = safeLabel(subtype || normalizedEventName || rawType, kind);
  if (kind === "tool_call" || rawType.includes("tool") || streamBlockType === "tool_use") {
    kind = "tool_call";
    label = safeLabel(functionName, "tool_call");
  } else if (kind === "api_response") {
    label = "api_response";
  } else if (rawType === "stream_event") {
    kind = safeLabel(streamEventType, "stream_event");
    label = safeLabel(functionName || streamBlockType || streamEventType, kind);
  } else if (rawType === "assistant") {
    kind = "assistant";
    label = "assistant-message";
  } else if (rawType === "result") {
    kind = "result";
    label = safeLabel(subtype || event.status, "result");
  } else if (rawType === "system" && subtype) {
    kind = "system";
    label = safeLabel(subtype, "system");
  }

  return {
    observed_at: observedAt,
    timestamp: asString(event.timestamp) || asString(uiEvent["event.timestamp"]) || null,
    kind,
    label,
    type: safeLabel(rawType, "json"),
    subtype: subtype ? safeLabel(subtype, "event") : null,
  };
}

function killProcessTree(child, signal) {
  if (!child || typeof child.pid !== "number") {
    return;
  }
  if (process.platform !== "win32") {
    try {
      process.kill(-child.pid, signal);
    } catch {}
  }
  try {
    child.kill(signal);
  } catch {}
}

const options = readOptions();
const timeoutMs = Number.isFinite(options.timeout_ms) && options.timeout_ms > 0 ? Math.floor(options.timeout_ms) : 30000;
const maxBuffer = Number.isFinite(options.max_buffer) && options.max_buffer > 0 ? Math.floor(options.max_buffer) : 10 * 1024 * 1024;
const outputMode = outputModeFromArgs(options.args);
let stdout = "";
let stderr = "";
let timedOut = false;
let interrupted = false;
let emitted = false;
let heartbeatTimer = null;
let interruptKillTimer = null;
let stdoutLineBuffer = "";
let providerProgressEventCount = 0;
const providerProgressEvents = [];
const heartbeatIntervalMs = Math.max(25, asNumber(asObject(options.provider_step_status).heartbeat_interval_ms) || 5000);

function recordProviderProgress(record) {
  const nowIso = new Date().toISOString();
  const event = summarizeProgressEvent(record, nowIso);
  if (!event) return;
  providerProgressEventCount += 1;
  providerProgressEvents.push(event);
  if (providerProgressEvents.length > 100) {
    providerProgressEvents.shift();
  }
  writeProviderStepStatus({
    status: "running",
    last_progress_at: nowIso,
    last_progress_kind: event.kind,
    last_progress_label: event.label,
    progress_event_count: providerProgressEventCount,
    output_mode: outputMode,
    recommended_action: "Provider stream progress observed; keep monitoring until the step completes.",
  });
}

function processStdoutProgressChunk(chunk) {
  if (outputMode !== "stream-json") return;
  stdoutLineBuffer += chunk;
  const lines = stdoutLineBuffer.split(/\r?\n/);
  stdoutLineBuffer = lines.pop() || "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      recordProviderProgress(JSON.parse(trimmed));
    } catch {}
  }
}

function flushStdoutProgressBuffer() {
  if (outputMode !== "stream-json") return;
  const trimmed = stdoutLineBuffer.trim();
  stdoutLineBuffer = "";
  if (!trimmed) return;
  try {
    recordProviderProgress(JSON.parse(trimmed));
  } catch {}
}

function finish(result) {
  if (emitted) {
    return;
  }
  emitted = true;
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (interruptKillTimer) {
    clearTimeout(interruptKillTimer);
    interruptKillTimer = null;
  }
  emit({ ...result, provider_progress_events: providerProgressEvents });
}

let child;
try {
  writeProviderStepStatus({ status: "running" });
  child = spawn(options.command, Array.isArray(options.args) ? options.args : [], {
    cwd: options.cwd,
    env: options.env,
    detached: process.platform !== "win32",
    stdio: ["pipe", "pipe", "pipe"],
  });
} catch (error) {
  writeProviderStepStatus({
    status: "failed",
    recommended_action: "Inspect provider spawn failure evidence.",
    finished_at: new Date().toISOString(),
  });
  finish({
    status: null,
    signal: null,
    stdout,
    stderr,
    error_code: error && typeof error.code === "string" ? error.code : "EXTERNAL_RUNTIME_SPAWN_FAILED",
    error_message: error instanceof Error ? error.message : String(error),
    timed_out: false,
  });
  process.exit(0);
}

heartbeatTimer = setInterval(() => {
  if (providerCancellationRequested()) {
    if (!interrupted) {
      interrupted = true;
      writeProviderStepStatus({
        status: "interrupted",
        interruption_owner: "operator",
        interruption_reason: "External runtime was interrupted by public run-control cancel.",
        interruption_status: "operator-stopped",
        recommended_action: "Provider was stopped by the operator; save partial evidence, then diagnose or retry the public step.",
        finished_at: new Date().toISOString(),
      });
      killProcessTree(child, "SIGTERM");
      interruptKillTimer = setTimeout(() => {
        killProcessTree(child, "SIGKILL");
      }, 1000);
    }
    return;
  }
  writeProviderStepStatus({ status: "running" });
}, heartbeatIntervalMs);

const timer = setTimeout(() => {
  timedOut = true;
  writeProviderStepStatus({
    status: "timeout-risk",
    recommended_action: "Provider budget was exhausted; stopping external runner.",
  });
  killProcessTree(child, "SIGKILL");
}, timeoutMs);

child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  stdout = appendBounded(stdout, chunk, maxBuffer);
  processStdoutProgressChunk(chunk);
  writeProviderStepStatus({ status: "running", last_output_at: new Date().toISOString() });
});
child.stderr.on("data", (chunk) => {
  stderr = appendBounded(stderr, chunk, maxBuffer);
  writeProviderStepStatus({ status: "running", last_output_at: new Date().toISOString() });
});
child.on("error", (error) => {
  clearTimeout(timer);
  writeProviderStepStatus({
    status: "failed",
    recommended_action: "Inspect provider process error evidence.",
    finished_at: new Date().toISOString(),
  });
  finish({
    status: null,
    signal: null,
    stdout,
    stderr,
    error_code: error && typeof error.code === "string" ? error.code : "EXTERNAL_RUNTIME_SPAWN_FAILED",
    error_message: error instanceof Error ? error.message : String(error),
    timed_out: timedOut,
  });
});
child.on("close", (status, signal) => {
  clearTimeout(timer);
  flushStdoutProgressBuffer();
  if (!interrupted && providerCancellationRequested()) {
    interrupted = true;
  }
  if (interruptKillTimer) {
    clearTimeout(interruptKillTimer);
    interruptKillTimer = null;
  }
  writeProviderStepStatus({
    status: interrupted ? "interrupted" : status === 0 && !timedOut ? "completed" : "failed",
    interruption_owner: interrupted ? "operator" : null,
    interruption_reason: interrupted ? "External runtime was interrupted by public run-control cancel." : null,
    interruption_status: interrupted ? "operator-stopped" : null,
    recommended_action:
      interrupted
        ? "Provider was stopped by the operator; save partial evidence, then diagnose or retry the public step."
        : status === 0 && !timedOut
          ? "Continue with post-run verification."
          : "Inspect provider evidence and failure summary.",
    finished_at: new Date().toISOString(),
  });
  finish({
    status,
    signal,
    stdout,
    stderr,
    error_code: interrupted ? "EINTERRUPTED" : timedOut ? "ETIMEDOUT" : null,
    error_message: interrupted
      ? "External runtime was interrupted by public run-control cancel."
      : timedOut
        ? "External runtime timed out after " + timeoutMs + "ms."
        : null,
    timed_out: timedOut,
  });
});

if (typeof options.input === "string") {
  child.stdin.end(options.input);
} else {
  child.stdin.end();
}
`;

export const STEP_LIFECYCLE_HOOKS = Object.freeze([
  "before_step",
  "invoke_adapter",
  "after_step",
  "on_retry",
  "on_repair",
  "on_escalation",
]);

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function asRecord(value) {
  return typeof value === "object" && value !== null ? /** @type {Record<string, unknown>} */ (value) : {};
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
 * @param {string} field
 * @param {unknown} value
 * @returns {string}
 */
function requireString(field, value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Adapter envelope field '${field}' must be a non-empty string.`);
  }
  return value.trim();
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function asOptionalString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isRunControlInterruptedStatus(value) {
  const status = asOptionalString(value);
  return status === "canceled" || status === "cancelled" || status === "interrupted";
}

/**
 * @param {Record<string, unknown>} providerStepStatus
 * @returns {Record<string, unknown>}
 */
function readProviderRunControlState(providerStepStatus) {
  const stateFile = asOptionalString(providerStepStatus.state_file);
  if (!stateFile) {
    return {};
  }
  try {
    return asRecord(JSON.parse(fs.readFileSync(stateFile, "utf8")));
  } catch {
    return {};
  }
}

/**
 * @param {Record<string, unknown>} runControlState
 * @returns {boolean}
 */
function isProviderRunControlInterrupted(runControlState) {
  return (
    isRunControlInterruptedStatus(runControlState.status) ||
    isRunControlInterruptedStatus(asRecord(runControlState.provider_step_status).status)
  );
}

/**
 * @param {Record<string, unknown>} providerStepStatus
 */
function markProviderRunControlInterrupted(providerStepStatus) {
  const stateFile = asOptionalString(providerStepStatus.state_file);
  if (!stateFile) {
    return;
  }
  const nowIso = new Date().toISOString();
  const state = readProviderRunControlState(providerStepStatus);
  const previous = asRecord(state.provider_step_status);
  state.provider_step_status = {
    ...previous,
    status: "interrupted",
    interruption_owner: asOptionalString(previous.interruption_owner) || "operator",
    interruption_reason:
      asOptionalString(previous.interruption_reason) || "External runtime was interrupted by public run-control cancel.",
    interruption_status: asOptionalString(previous.interruption_status) || "operator-stopped",
    recommended_action:
      asOptionalString(previous.recommended_action) ||
      "Provider was stopped by the operator; save partial evidence, then diagnose or retry the public step.",
    updated_at: nowIso,
    finished_at: asOptionalString(previous.finished_at) || nowIso,
  };
  state.updated_at = nowIso;
  try {
    fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  } catch {}
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function asPositiveInteger(value, fallback) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  const rounded = Math.floor(value);
  return rounded > 0 ? rounded : fallback;
}

/**
 * @param {Record<string, unknown>} externalRuntime
 * @param {boolean} requestViaStdin
 * @returns {string}
 */
function resolveRequestTransport(externalRuntime, requestViaStdin) {
  const configuredTransport = asOptionalString(externalRuntime.request_transport);
  if (configuredTransport) {
    return configuredTransport;
  }
  return requestViaStdin ? "stdin-json" : "none";
}

/**
 * @param {string} requestTransport
 * @returns {boolean}
 */
function isSupportedRequestTransport(requestTransport) {
  return EXTERNAL_REQUEST_TRANSPORTS.includes(requestTransport);
}

/**
 * @param {Record<string, unknown>} request
 * @param {number} fallback
 * @returns {number}
 */
function resolveRequestTimeoutMs(request, fallback) {
  const policyBundle = asRecord(request.policy_bundle);
  const resolvedBounds = asRecord(policyBundle.resolved_bounds);
  const budget = asRecord(resolvedBounds.budget);
  const timeoutSec = budget.timeout_sec;
  if (typeof timeoutSec !== "number" || !Number.isFinite(timeoutSec) || timeoutSec <= 0) {
    return fallback;
  }
  return Math.min(fallback, Math.max(1, Math.floor(timeoutSec * 1000)));
}

/**
 * @param {{ externalRuntime: Record<string, unknown>, timeoutMs: number }} options
 * @returns {string[]}
 */
export function resolveExternalRuntimeNativeTimeoutArgs(options) {
  const profile = asRecord(options.externalRuntime.native_timeout_arg);
  const flag = asOptionalString(profile.flag);
  if (!flag) {
    return [];
  }
  const reserveMs = asPositiveInteger(profile.reserve_ms, 0);
  const timeoutMs = Math.max(1000, Math.floor(options.timeoutMs) - reserveMs);
  const seconds = Math.max(1, Math.floor(timeoutMs / 1000));
  const format = asOptionalString(profile.format) ?? "seconds";
  const value = format === "duration-seconds" ? `${seconds}s` : String(seconds);
  return [flag, value];
}

/**
 * Some external runners derive local state paths from the current working
 * directory. Long live E2E run roots can exceed those runner limits even when
 * the target checkout itself is valid, so adapter profiles may opt into a
 * short symlink cwd while AOR keeps the canonical checkout as source of truth.
 *
 * @param {{ externalRuntime: Record<string, unknown>, executionRoot: string }} options
 * @returns {{
 *   executionRoot: string,
 *   canonicalExecutionRoot: string,
 *   mode: "direct" | "short-symlink",
 *   aliased: boolean,
 * }}
 */
export function resolveExternalRuntimeExecutionRoot(options) {
  const configuredMode = asOptionalString(options.externalRuntime.execution_root_mode);
  const shortModeRequested =
    options.externalRuntime.short_execution_root === true ||
    (configuredMode ? SHORT_EXECUTION_ROOT_MODES.includes(configuredMode) : false);
  const canonicalExecutionRoot = fs.realpathSync(options.executionRoot);
  if (!shortModeRequested) {
    return {
      executionRoot: options.executionRoot,
      canonicalExecutionRoot,
      mode: "direct",
      aliased: false,
    };
  }

  const configuredBase = asOptionalString(options.externalRuntime.short_execution_root_base);
  const baseRoot = configuredBase
    ? path.isAbsolute(configuredBase)
      ? configuredBase
      : path.resolve(process.cwd(), configuredBase)
    : path.join(os.tmpdir(), "aor-exec-root");
  fs.mkdirSync(baseRoot, { recursive: true });
  const digest = createHash("sha256").update(canonicalExecutionRoot).digest("hex").slice(0, 16);
  const aliasRoot = path.join(baseRoot, `x-${digest}`);
  if (fs.existsSync(aliasRoot)) {
    let pointsAtCanonical = false;
    try {
      pointsAtCanonical = fs.realpathSync(aliasRoot) === canonicalExecutionRoot;
    } catch {
      pointsAtCanonical = false;
    }
    if (!pointsAtCanonical) {
      fs.rmSync(aliasRoot, { recursive: true, force: true });
    }
  }
  if (!fs.existsSync(aliasRoot)) {
    fs.symlinkSync(canonicalExecutionRoot, aliasRoot, "dir");
  }

  return {
    executionRoot: aliasRoot,
    canonicalExecutionRoot,
    mode: "short-symlink",
    aliased: true,
  };
}

/**
 * @param {{
 *   command: string,
 *   args?: string[],
 *   cwd: string,
 *   env: NodeJS.ProcessEnv,
 *   input?: string,
 *   timeout: number,
 *   maxBuffer: number,
 *   providerStepStatus?: Record<string, unknown> | null,
 * }} options
 * @returns {{
 *   status: number | null,
 *   signal: string | null,
 *   stdout: string,
 *   stderr: string,
 *   error: Error | null,
 *   providerProgressEvents?: Array<Record<string, unknown>>,
 * }}
 */
export function runExternalRuntimeProcessSync(options) {
  const timeoutMs = asPositiveInteger(options.timeout, 30000);
  const maxBuffer = asPositiveInteger(options.maxBuffer, 10 * 1024 * 1024);
  const supervisorPayload = {
    command: options.command,
    args: Array.isArray(options.args) ? options.args : [],
    cwd: options.cwd,
    env: options.env,
    input: options.input,
    timeout_ms: timeoutMs,
    max_buffer: maxBuffer,
    provider_step_status: options.providerStepStatus ?? null,
  };
  const supervisor = spawnSync(process.execPath, ["-e", EXTERNAL_RUNTIME_SUPERVISOR_SOURCE], {
    cwd: options.cwd,
    env: process.env,
    encoding: "utf8",
    input: JSON.stringify(supervisorPayload),
    timeout: timeoutMs + 5000,
    killSignal: "SIGKILL",
    maxBuffer: Math.max(maxBuffer * 2 + 1024 * 1024, 1024 * 1024),
  });

  if (supervisor.error instanceof Error) {
    return {
      status: supervisor.status,
      signal: supervisor.signal,
      stdout: "",
      stderr: typeof supervisor.stderr === "string" ? supervisor.stderr : "",
      error: supervisor.error,
      providerProgressEvents: [],
    };
  }

  const supervisorStdout = typeof supervisor.stdout === "string" ? supervisor.stdout.trim() : "";
  try {
    const parsed = asRecord(JSON.parse(supervisorStdout));
    const errorCode = asOptionalString(parsed.error_code);
    const errorMessage = asOptionalString(parsed.error_message);
    const error = errorCode || errorMessage ? new Error(errorMessage ?? errorCode ?? "External runtime failed.") : null;
    if (error && errorCode) {
      Object.assign(error, { code: errorCode });
    }
    return {
      status: typeof parsed.status === "number" ? parsed.status : null,
      signal: asOptionalString(parsed.signal),
      stdout: typeof parsed.stdout === "string" ? parsed.stdout : "",
      stderr: typeof parsed.stderr === "string" ? parsed.stderr : "",
      error,
      providerProgressEvents: Array.isArray(parsed.provider_progress_events)
        ? parsed.provider_progress_events.map((event) => asRecord(event))
        : [],
    };
  } catch (error) {
    const parseError = error instanceof Error ? error : new Error(String(error));
    Object.assign(parseError, { code: "SUPERVISOR_RESULT_INVALID" });
    return {
      status: supervisor.status,
      signal: supervisor.signal,
      stdout: "",
      stderr: [typeof supervisor.stderr === "string" ? supervisor.stderr : "", supervisorStdout].filter(Boolean).join("\n"),
      error: parseError,
      providerProgressEvents: [],
    };
  }
}

/**
 * @param {unknown} value
 * @returns {Record<string, string>}
 */
function asStringMap(value) {
  const record = asRecord(value);
  const entries = Object.entries(record).filter(
    ([key, entry]) => typeof key === "string" && typeof entry === "string" && entry.trim().length > 0,
  );
  return Object.fromEntries(entries.map(([key, entry]) => [key, entry.trim()]));
}

/**
 * @param {unknown} value
 * @returns {Record<string, string>}
 */
function asEnvFromMap(value) {
  const record = asRecord(value);
  const entries = Object.entries(record).filter(
    ([key, entry]) =>
      typeof key === "string" &&
      key.trim().length > 0 &&
      typeof entry === "string" &&
      entry.trim().length > 0,
  );
  return Object.fromEntries(entries.map(([key, entry]) => [key.trim(), entry.trim()]));
}

/**
 * @param {unknown} value
 * @returns {value is string}
 */
function hasEnvValue(value) {
  return typeof value === "string" && value.length > 0;
}

/**
 * @param {{
 *   externalRuntime: Record<string, unknown>,
 *   baseEnv?: NodeJS.ProcessEnv,
 * }} options
 * @returns {{
 *   env: NodeJS.ProcessEnv,
 *   applied: Array<{ target: string, source: string }>,
 *   missing: Array<{ target: string, source: string }>,
 * }}
 */
export function resolveExternalRuntimeEnvironment(options) {
  const externalRuntime = asRecord(options.externalRuntime);
  const baseEnv = options.baseEnv ?? process.env;
  const envOverrides = asStringMap(externalRuntime.env);
  const envFrom = asEnvFromMap(externalRuntime.env_from);
  const env = {
    ...baseEnv,
    ...envOverrides,
  };
  const applied = [];
  const missing = [];
  for (const [target, source] of Object.entries(envFrom)) {
    if (hasEnvValue(env[target])) {
      continue;
    }
    const sourceValue = baseEnv[source];
    if (hasEnvValue(sourceValue)) {
      env[target] = sourceValue;
      applied.push({ target, source });
    } else {
      missing.push({ target, source });
    }
  }
  return { env, applied, missing };
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function stableJsonText(value) {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

/**
 * @param {string[]} args
 * @returns {string | null}
 */
function resolveOutputModeFromArgs(args) {
  const index = args.findIndex((entry) => entry === "--output-format");
  return index >= 0 ? asOptionalString(args[index + 1]) : null;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function safeProgressLabel(value) {
  const stringValue = asOptionalString(value);
  if (!stringValue) return null;
  const normalized = stringValue.replace(/[^A-Za-z0-9_.:-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized.length > 0 ? normalized.slice(0, 96) : null;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function hasNonEmptyPermissionDenials(value) {
  if (Array.isArray(value)) {
    return value.some((entry) => hasNonEmptyPermissionDenials(entry));
  }

  const record = asRecord(value);
  const entries = Object.entries(record);
  if (entries.length === 0) {
    return false;
  }

  const permissionDenials = record.permission_denials;
  if (Array.isArray(permissionDenials) && permissionDenials.length > 0) {
    return true;
  }

  return entries.some(([, entry]) => hasNonEmptyPermissionDenials(entry));
}

/**
 * @param {unknown} value
 * @returns {Array<Record<string, unknown>>}
 */
function collectPermissionDenials(value) {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectPermissionDenials(entry));
  }

  const record = asRecord(value);
  const entries = Object.entries(record);
  if (entries.length === 0) {
    return [];
  }

  const ownDenials = Array.isArray(record.permission_denials)
    ? record.permission_denials.filter((entry) => typeof entry === "object" && entry !== null).map((entry) => asRecord(entry))
    : [];
  return [...ownDenials, ...entries.flatMap(([, entry]) => collectPermissionDenials(entry))];
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function firstString(value) {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const resolved = firstString(entry);
      if (resolved) return resolved;
    }
  }
  return null;
}

/**
 * @param {Record<string, unknown>} toolInput
 * @returns {string | null}
 */
function resolvePermissionTarget(toolInput) {
  return (
    firstString(toolInput.file_path) ??
    firstString(toolInput.path) ??
    firstString(toolInput.paths) ??
    firstString(toolInput.pattern) ??
    firstString(toolInput.url) ??
    null
  );
}

/**
 * @param {Record<string, unknown>} toolInput
 * @returns {string | null}
 */
function resolvePermissionCommand(toolInput) {
  return firstString(toolInput.command) ?? firstString(toolInput.cmd) ?? firstString(toolInput.shell_command) ?? null;
}

/**
 * @param {string | null} toolName
 * @param {Record<string, unknown>} toolInput
 * @param {string} text
 * @returns {string}
 */
function inferPermissionOperationType(toolName, toolInput, text) {
  const combined = `${toolName ?? ""} ${stableJsonText(toolInput)} ${text}`.toLowerCase();
  if (/\b(?:bash|shell|terminal|exec|command)\b/u.test(combined) || resolvePermissionCommand(toolInput)) {
    return "shell_command";
  }
  if (/\b(?:grep|glob|search|find|ls|list)\b/u.test(combined)) {
    return "file_search";
  }
  if (/\b(?:stat)\b/u.test(combined)) {
    return "file_stat";
  }
  if (/\b(?:write|edit|multiedit|create|patch|modify)\b/u.test(combined)) {
    return "file_write";
  }
  if (/\b(?:read|open|cat)\b/u.test(combined)) {
    return "file_read";
  }
  if (/\b(?:fetch|web|http|network|curl|wget)\b/u.test(combined)) {
    return "network_access";
  }
  if (/\bmcp\b/u.test(combined)) {
    return "mcp_tool";
  }
  return "unknown";
}

/**
 * @param {string} text
 * @returns {string}
 */
function sanitizeSummary(text) {
  return text.replace(/\s+/gu, " ").trim().slice(0, 300);
}

/**
 * @param {{
 *   adapterId: string,
 *   runnerFamily: string | null,
 *   permissionMode: string,
 *   permissionModeSource: string,
 *   runnerPayload: Record<string, unknown>,
 *   runnerToolTraces: Array<Record<string, unknown>>,
 *   stdout: string,
 *   stderr: string,
 *   evidenceRefs: string[],
 * }} options
 * @returns {Record<string, unknown>}
 */
function buildRuntimePermissionRequest(options) {
  const denials = collectPermissionDenials(options.runnerPayload);
  denials.push(...collectPermissionDenials(options.runnerToolTraces));
  const firstDenial = denials[0] ?? {};
  const toolInput = asRecord(firstDenial.tool_input ?? firstDenial.input ?? firstDenial.arguments);
  const toolName =
    firstString(firstDenial.tool_name) ??
    firstString(firstDenial.name) ??
    firstString(firstDenial.tool) ??
    null;
  const combinedText = `${stableJsonText(options.runnerPayload)}\n${stableJsonText(options.runnerToolTraces)}\n${options.stdout}\n${options.stderr}`;
  const target = resolvePermissionTarget(toolInput);
  const command = resolvePermissionCommand(toolInput);
  const operationType = inferPermissionOperationType(toolName, toolInput, combinedText);
  const structured = denials.length > 0;

  return {
    interaction_type: "permission_request",
    adapter_id: options.adapterId,
    runner_family: options.runnerFamily,
    permission_mode: options.permissionMode,
    permission_mode_source: options.permissionModeSource,
    operation_type: operationType,
    tool_name: toolName,
    target,
    target_path: target,
    command,
    confidence: structured ? "high" : "medium",
    summary: structured
      ? `Runtime requested permission for ${toolName ?? operationType}.`
      : sanitizeSummary(options.stderr || options.stdout || "Runtime requested permission."),
    evidence_refs: options.evidenceRefs,
  };
}

/**
 * @param {string} text
 * @returns {string}
 */
function stripBenignInteractiveNegations(text) {
  return text
    .replace(/\bdo not ask (?:any )?(?:clarifying )?questions?\b/giu, "")
    .replace(/\bdon't ask (?:any )?(?:clarifying )?questions?\b/giu, "")
    .replace(/\bwithout (?:any )?(?:clarifying )?questions?\b/giu, "")
    .replace(/\bno (?:clarifying )?questions?(?:\s+or\s+interactive prompts?)?\b/giu, "")
    .replace(/\bno interactive prompts?\b/giu, "")
    .replace(/\bwithout (?:any )?interactive prompts?\b/giu, "")
    .replace(/\bavoid(?:ing)? (?:any )?interactive prompts?\b/giu, "");
}

/**
 * @param {string} combined
 * @returns {boolean}
 */
function hasInteractiveQuestionRequest(combined) {
  const normalized = stripBenignInteractiveNegations(combined);
  return (
    normalized.includes("askuserquestion") ||
    normalized.includes("ask user question") ||
    normalized.includes("clarifying question") ||
    normalized.includes("requires user input") ||
    normalized.includes("interactive prompt")
  );
}

/**
 * @param {{ stdout?: string, stderr?: string, errorMessage?: string | null, defaultFailureKind: string, ignoreAuthFailure?: boolean }} options
 * @returns {string}
 */
export function classifyExternalRunnerFailure(options) {
  const combined = `${options.stdout ?? ""}\n${options.stderr ?? ""}\n${options.errorMessage ?? ""}`.toLowerCase();
  if (
    combined.includes("prompt is too long") ||
    combined.includes("context window") ||
    /\binput\s+tokens?.{0,80}(?:exceed|exceeds|exceeded|too\s+large|too\s+long)\b/u.test(combined) ||
    combined.includes("maximum context")
  ) {
    return "compiled_context_budget_exceeded";
  }
  if (!options.ignoreAuthFailure && (
    /\b401\b/u.test(combined) ||
    combined.includes("unauthorized") ||
    combined.includes("not authenticated") ||
    /\bauthentication\s+(?:failed|failure|required|error|invalid|expired|missing|denied|transient)\b/u.test(combined) ||
    /\b(?:failed|failure|required|error|invalid|expired|missing|denied|transient)\s+authentication\b/u.test(combined) ||
    combined.includes("missing bearer") ||
    combined.includes("api key") ||
    combined.includes("apikey") ||
    combined.includes("setup-token") ||
    combined.includes("login required")
  )) {
    return "auth-failed";
  }
  if (hasInteractiveQuestionRequest(combined)) {
    return "interactive-question-requested";
  }
  if (
    combined.includes("edit denied") ||
    combined.includes("edit tool denied") ||
    combined.includes("tool denied: edit") ||
    combined.includes("denied tool edit")
  ) {
    return "edit-denied";
  }
  if (
    combined.includes("permission denial") ||
    combined.includes("tool_use_denied") ||
    combined.includes("tool use denied") ||
    combined.includes("tool denied") ||
    combined.includes("approval required for tool") ||
    combined.includes("approval is required for tool") ||
    combined.includes("requesting permission to use") ||
    combined.includes("grant permission to use") ||
    /\bpermissions?\s+(?:is\s+|are\s+)?required\s+for\s+(?:tool|edit|write|command)\b/u.test(combined) ||
    /\bpermission[- ]mode\s+(?:blocked|denied|requires|required)\b/u.test(combined) ||
    /\b(?:blocked|denied)\s+by\s+permission[- ]mode\b/u.test(combined) ||
    combined.includes("workspace trust") ||
    combined.includes("not trusted") ||
    /\brunner\s+sandbox\s+(?:blocked|denied|violation|requires|required)\b/u.test(combined) ||
    /\btool\s+sandbox\s+(?:blocked|denied|violation|requires|required)\b/u.test(combined)
  ) {
    return "permission-mode-blocked";
  }
  return options.defaultFailureKind;
}

/**
 * @param {{ runnerPayload?: Record<string, unknown>, runnerToolTraces?: Array<Record<string, unknown>> }} options
 * @returns {string}
 */
function classifyStructuredRunnerFailure(options) {
  const runnerPayload = asRecord(options.runnerPayload);
  if (hasNonEmptyPermissionDenials(runnerPayload) || hasNonEmptyPermissionDenials(options.runnerToolTraces)) {
    return "permission-mode-blocked";
  }

  const combined = stableJsonText({
    runnerPayload,
    runnerToolTraces: Array.isArray(options.runnerToolTraces) ? options.runnerToolTraces : [],
  }).toLowerCase();

  if (hasInteractiveQuestionRequest(combined)) {
    return "interactive-question-requested";
  }
  if (
    combined.includes("edit denied") ||
    combined.includes("edit tool denied") ||
    combined.includes("tool denied: edit") ||
    combined.includes("denied tool edit")
  ) {
    return "edit-denied";
  }
  if (
    combined.includes("tool_use_denied") ||
    combined.includes("tool use denied") ||
    combined.includes("tool denied") ||
    combined.includes("approval required for tool") ||
    combined.includes("approval is required for tool") ||
    combined.includes("requesting permission to use") ||
    combined.includes("grant permission to use") ||
    /\bpermissions?\s+(?:is\s+|are\s+)?required\s+for\s+(?:tool|edit|write|command)\b/u.test(combined) ||
    /\bpermission[- ]mode\s+(?:blocked|denied|requires|required)\b/u.test(combined) ||
    /\b(?:blocked|denied)\s+by\s+permission[- ]mode\b/u.test(combined) ||
    combined.includes("workspace trust") ||
    combined.includes("not trusted") ||
    /\brunner\s+sandbox\s+(?:blocked|denied|violation|requires|required)\b/u.test(combined) ||
    /\btool\s+sandbox\s+(?:blocked|denied|violation|requires|required)\b/u.test(combined)
  ) {
    return "permission-mode-blocked";
  }
  return "";
}

/**
 * @param {unknown} parsed
 * @returns {{ runnerPayload: Record<string, unknown>, runnerEvidenceRefs: string[], runnerToolTraces: Array<Record<string, unknown>> }}
 */
function extractRunnerOutput(parsed) {
  if (Array.isArray(parsed)) {
    const runnerEvidenceRefs = [];
    const runnerToolTraces = [];
    for (const record of parsed) {
      const extracted = extractRunnerOutput(record);
      runnerEvidenceRefs.push(...extracted.runnerEvidenceRefs);
      runnerToolTraces.push(...extracted.runnerToolTraces);
    }
    return {
      runnerPayload: {
        json_events: parsed,
      },
      runnerEvidenceRefs,
      runnerToolTraces,
    };
  }

  const parsedRecord = asRecord(parsed);
  const hasEnvelopeOutput = Object.prototype.hasOwnProperty.call(parsedRecord, "output");
  return {
    runnerPayload: hasEnvelopeOutput ? asRecord(parsedRecord.output) : parsedRecord,
    runnerEvidenceRefs: asStringArray(parsedRecord.evidence_refs),
    runnerToolTraces: Array.isArray(parsedRecord.tool_traces)
      ? parsedRecord.tool_traces.map((trace) => asRecord(trace))
      : [],
  };
}

/**
 * @param {string} stdout
 * @param {{ sanitizeJsonlEvents?: boolean, providerProgressEvents?: Array<Record<string, unknown>> }} [options]
 * @returns {{ runnerPayload: Record<string, unknown>, runnerEvidenceRefs: string[], runnerToolTraces: Array<Record<string, unknown>> }}
 */
function parseExternalRunnerStdout(stdout, options = {}) {
  const stdoutTrimmed = stdout.trim();
  if (stdoutTrimmed.length === 0) {
    return {
      runnerPayload: {},
      runnerEvidenceRefs: [],
      runnerToolTraces: [],
    };
  }

  try {
    return extractRunnerOutput(JSON.parse(stdoutTrimmed));
  } catch {
    // Continue below and try JSONL before preserving raw stdout.
  }

  const jsonlRecords = [];
  const lines = stdoutTrimmed.split(/\r?\n/u).filter((line) => line.trim().length > 0);
  let allJsonLines = lines.length > 0;
  for (const line of lines) {
    try {
      jsonlRecords.push(JSON.parse(line));
    } catch {
      allJsonLines = false;
      break;
    }
  }

  if (allJsonLines) {
    if (options.sanitizeJsonlEvents) {
      return {
        runnerPayload: {
          jsonl_event_count: jsonlRecords.length,
          provider_progress_events: Array.isArray(options.providerProgressEvents)
            ? options.providerProgressEvents.map((event) => ({
                observed_at: asOptionalString(asRecord(event).observed_at),
                timestamp: asOptionalString(asRecord(event).timestamp),
                kind: safeProgressLabel(asRecord(event).kind) ?? "json",
                label: safeProgressLabel(asRecord(event).label) ?? "event",
                type: safeProgressLabel(asRecord(event).type) ?? "json",
                subtype: safeProgressLabel(asRecord(event).subtype),
              }))
            : [],
        },
        runnerEvidenceRefs: [],
        runnerToolTraces: [],
      };
    }
    const runnerEvidenceRefs = [];
    const runnerToolTraces = [];
    for (const record of jsonlRecords) {
      const extracted = extractRunnerOutput(record);
      runnerEvidenceRefs.push(...extracted.runnerEvidenceRefs);
      runnerToolTraces.push(...extracted.runnerToolTraces);
    }
    return {
      runnerPayload: {
        jsonl_events: jsonlRecords,
      },
      runnerEvidenceRefs,
      runnerToolTraces,
    };
  }

  if (options.sanitizeJsonlEvents) {
    return {
      runnerPayload: {
        malformed_jsonl: true,
        raw_stdout_available_in_evidence: true,
        provider_progress_events: Array.isArray(options.providerProgressEvents)
          ? options.providerProgressEvents.map((event) => ({
              observed_at: asOptionalString(asRecord(event).observed_at),
              timestamp: asOptionalString(asRecord(event).timestamp),
              kind: safeProgressLabel(asRecord(event).kind) ?? "json",
              label: safeProgressLabel(asRecord(event).label) ?? "event",
              type: safeProgressLabel(asRecord(event).type) ?? "json",
              subtype: safeProgressLabel(asRecord(event).subtype),
            }))
          : [],
      },
      runnerEvidenceRefs: [],
      runnerToolTraces: [],
    };
  }

  return {
    runnerPayload: {
      raw_stdout: stdoutTrimmed,
    },
    runnerEvidenceRefs: [],
    runnerToolTraces: [],
  };
}

/**
 * @param {string | null} projectRoot
 * @param {string} filePath
 * @returns {string}
 */
function toEvidenceRef(projectRoot, filePath) {
  const normalizedPath = filePath.replace(/\\/g, "/");
  if (!projectRoot || !path.isAbsolute(projectRoot) || !path.isAbsolute(filePath)) {
    return `evidence://${normalizedPath}`;
  }

  const relative = path.relative(projectRoot, filePath).replace(/\\/g, "/");
  if (!relative || relative.startsWith("..")) {
    return `evidence://${normalizedPath}`;
  }
  return `evidence://${relative}`;
}

/**
 * @param {string} value
 * @param {number} maxLength
 */
function boundedEvidenceSegment(value, maxLength) {
  const normalized = [];
  let lastWasSeparator = true;

  for (const character of value.toLowerCase()) {
    const isAlphaNumeric =
      (character >= "a" && character <= "z") || (character >= "0" && character <= "9");
    if (isAlphaNumeric) {
      normalized.push(character);
      lastWasSeparator = false;
    } else if (!lastWasSeparator) {
      normalized.push("-");
      lastWasSeparator = true;
    }
  }

  if (normalized[normalized.length - 1] === "-") {
    normalized.pop();
  }

  return (normalized.length > 0 ? normalized.join("") : "unknown").slice(0, maxLength);
}

/**
 * @param {{ kind: "request" | "work-packet" | "raw", adapterId: string, evidenceToken: string, timestamp: number }} options
 */
function buildLiveAdapterEvidenceFileName(options) {
  const adapterSegment = boundedEvidenceSegment(options.adapterId, 40);
  const tokenSegment = boundedEvidenceSegment(options.evidenceToken, 32);
  const tokenHash = createHash("sha256").update(options.evidenceToken).digest("hex").slice(0, 16);
  return `adapter-live-${options.kind}-${adapterSegment}-${tokenSegment}-${tokenHash}-${options.timestamp}.json`;
}

/**
 * @param {string} text
 * @returns {{ bytes: number, chars: number, estimated_tokens: number }}
 */
function estimateContextText(text) {
  const chars = text.length;
  return {
    bytes: Buffer.byteLength(text, "utf8"),
    chars,
    estimated_tokens: Math.ceil(chars / 3),
  };
}

/**
 * @param {unknown} value
 * @returns {{ bytes: number, chars: number, estimated_tokens: number }}
 */
function estimateContextValue(value) {
  return estimateContextText(stableJsonText(value));
}

/**
 * @param {Array<{ source: string, value: unknown }>} sources
 * @returns {Array<{ source: string, bytes: number, chars: number, estimated_tokens: number }>}
 */
function buildContextSourceBreakdown(sources) {
  return sources.map((entry) => ({
    source: entry.source,
    ...estimateContextValue(entry.value),
  }));
}

/**
 * @param {Array<{ bytes: number, chars: number, estimated_tokens: number }>} entries
 * @returns {{ bytes: number, chars: number, estimated_tokens: number }}
 */
function sumContextEstimates(entries) {
  return entries.reduce(
    (acc, entry) => ({
      bytes: acc.bytes + entry.bytes,
      chars: acc.chars + entry.chars,
      estimated_tokens: acc.estimated_tokens + entry.estimated_tokens,
    }),
    { bytes: 0, chars: 0, estimated_tokens: 0 },
  );
}

/**
 * @param {number} estimatedTokens
 * @param {number | null} budgetLimitTokens
 * @returns {"pass" | "warn" | "fail" | "not_configured"}
 */
function classifyContextBudgetStatus(estimatedTokens, budgetLimitTokens) {
  if (!budgetLimitTokens || budgetLimitTokens <= 0) return "not_configured";
  if (estimatedTokens > budgetLimitTokens) return "fail";
  if (estimatedTokens >= budgetLimitTokens * CONTEXT_BUDGET_WARN_RATIO) return "warn";
  return "pass";
}

/**
 * @param {Record<string, unknown>} externalRuntime
 * @returns {number}
 */
function resolveContextBudgetLimitTokens(externalRuntime) {
  const contextBudget = asRecord(externalRuntime.context_budget);
  return asPositiveInteger(contextBudget.max_input_tokens, DEFAULT_CONTEXT_BUDGET_LIMIT_TOKENS);
}

/**
 * @param {string} template
 * @param {Record<string, string | null>} values
 * @returns {string}
 */
function renderRequestArtifactMessage(template, values) {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/gu, (_, key) => values[key] ?? "");
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function evidencePartFromRef(value) {
  const ref = asOptionalString(value);
  if (!ref) return null;
  const packetSeparator = ref.lastIndexOf("@");
  return packetSeparator >= 0 ? ref.slice(packetSeparator + 1) : ref;
}

/**
 * @param {string | null} projectRoot
 * @param {unknown} value
 * @returns {string | null}
 */
function localPathFromRef(projectRoot, value) {
  const ref = evidencePartFromRef(value);
  if (!ref) return null;
  if (path.isAbsolute(ref)) return ref;
  if (!ref.startsWith("evidence://")) return null;

  const evidencePath = ref.slice("evidence://".length);
  if (path.isAbsolute(evidencePath)) return evidencePath;
  if (!projectRoot || !path.isAbsolute(projectRoot)) return null;
  return path.resolve(projectRoot, evidencePath);
}

/**
 * @param {unknown} value
 * @param {string[]} output
 */
function collectAllowedPaths(value, output) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const entry of value) collectAllowedPaths(entry, output);
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (key === "allowed_paths" && Array.isArray(entry)) {
      output.push(...asStringArray(entry).map(pathHintToAllowedPath).filter(Boolean));
      continue;
    }
    if (key === "required_path_prefixes" && Array.isArray(entry)) {
      output.push(...asStringArray(entry).map(pathHintToAllowedPath).filter(Boolean));
      continue;
    }
    collectAllowedPaths(entry, output);
  }
}

/**
 * @param {string} value
 * @returns {string | null}
 */
function pathHintToAllowedPath(value) {
  const raw = value.trim();
  if (!raw) return null;
  const normalized = raw.replace(/\\/gu, "/").replace(/^\.\//u, "");
  if (normalized.includes("*")) return normalized;
  if (normalized.endsWith("/")) return `${normalized.replace(/\/+$/u, "")}/**`;
  const fileName = normalized.split("/").at(-1) ?? normalized;
  return fileName.includes(".") ? normalized : `${normalized.replace(/\/+$/u, "")}/**`;
}

/**
 * @param {unknown} value
 * @param {Array<{ role: string, evidence_ref: string, local_path: string, required: boolean, kind: string }>} output
 * @param {string | null} projectRoot
 */
function collectDeliveryPlanRefs(value, output, projectRoot) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const entry of value) collectDeliveryPlanRefs(entry, output, projectRoot);
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string" && /delivery-plan/iu.test(entry)) {
      const localPath = localPathFromRef(projectRoot, entry) ?? (path.isAbsolute(entry) ? entry : null);
      if (localPath) {
        output.push({
          role: "delivery_plan",
          evidence_ref: entry,
          local_path: localPath,
          required: false,
          kind: "delivery-plan",
        });
      }
      continue;
    }
    if (/delivery_plan_file|deliveryPlanFile/u.test(key) && typeof entry === "string") {
      const evidenceRef = toEvidenceRef(projectRoot, entry);
      const localPath = path.isAbsolute(entry) ? entry : localPathFromRef(projectRoot, evidenceRef);
      if (localPath) {
        output.push({
          role: "delivery_plan",
          evidence_ref: evidenceRef,
          local_path: localPath,
          required: false,
          kind: "delivery-plan",
        });
      }
      continue;
    }
    collectDeliveryPlanRefs(entry, output, projectRoot);
  }
}

/**
 * @param {Record<string, unknown>} envelope
 * @param {{
 *   projectRoot?: string | null,
 *   requestArtifactRef?: string | null,
 *   requestArtifactFile?: string | null,
 *   compiledContextRef?: string | null,
 * }} options
 * @returns {Array<{ role: string, evidence_ref: string, local_path: string, required: boolean, kind: string }>}
 */
function buildResolvedLocalRefs(envelope, options) {
  const projectRoot = asOptionalString(options.projectRoot);
  const context = asRecord(envelope.context);
  const refs = [];
  const seen = new Set();
  const addRef = (entry) => {
    const role = asOptionalString(entry.role);
    const evidenceRef = asOptionalString(entry.evidence_ref);
    const localPath = asOptionalString(entry.local_path);
    const kind = asOptionalString(entry.kind);
    if (!role || !evidenceRef || !localPath || !kind) return;
    const key = `${role}\n${evidenceRef}\n${localPath}`;
    if (seen.has(key)) return;
    seen.add(key);
    refs.push({
      role,
      evidence_ref: evidenceRef,
      local_path: localPath,
      required: entry.required === true,
      kind,
    });
  };

  if (options.requestArtifactRef && options.requestArtifactFile) {
    addRef({
      role: "full_request_artifact",
      evidence_ref: options.requestArtifactRef,
      local_path: options.requestArtifactFile,
      required: true,
      kind: "request-artifact",
    });
  }

  const compiledContextFile = asOptionalString(context.compiled_context_file);
  if (compiledContextFile) {
    addRef({
      role: "compiled_context",
      evidence_ref:
        asOptionalString(options.compiledContextRef) ||
        asOptionalString(context.compiled_context_ref) ||
        toEvidenceRef(projectRoot, compiledContextFile),
      local_path: compiledContextFile,
      required: true,
      kind: "compiled-context",
    });
  }

  const requiredPackets = Array.isArray(asRecord(asRecord(context.required_inputs_resolved).packets).required)
    ? asRecord(asRecord(context.required_inputs_resolved).packets).required
    : [];
  for (const packet of requiredPackets) {
    const record = asRecord(packet);
    const evidenceRef = asOptionalString(record.resolved_ref);
    const localPath = localPathFromRef(projectRoot, evidenceRef);
    if (!evidenceRef || !localPath) continue;
    addRef({
      role: asOptionalString(record.packet) || "input_packet",
      evidence_ref: evidenceRef,
      local_path: localPath,
      required: record.required !== false,
      kind: "input-packet",
    });
  }

  const deliveryRefs = [];
  collectDeliveryPlanRefs(envelope, deliveryRefs, projectRoot);
  for (const deliveryRef of deliveryRefs) addRef(deliveryRef);

  return refs;
}

/**
 * @param {Record<string, unknown>} envelope
 * @returns {Record<string, unknown>}
 */
function buildExecutionContract(envelope) {
  const allowedPathCandidates = [];
  collectAllowedPaths(envelope, allowedPathCandidates);
  const policyBundle = asRecord(envelope.policy_bundle);
  const resolvedBounds = asRecord(policyBundle.resolved_bounds);
  const commandConstraints = asRecord(resolvedBounds.command_constraints);
  const allowedCommands = asStringArray(commandConstraints.allowed_commands);
  return {
    mode: "execute-implementation",
    must_open_required_local_refs: true,
    expected_meaningful_change: {
      required: envelope.dry_run !== true && asOptionalString(envelope.step_class) === "implement",
      allowed_target_paths: [...new Set(allowedPathCandidates)],
      ignore_paths: [".aor/**"],
      no_op_forbidden: true,
    },
    target_checkout_write_policy: {
      direct_edits_allowed: true,
      upstream_write_allowed: false,
      delivery_materialization_downstream: true,
    },
    required_commands: allowedCommands,
    output_quality_policy: {
      warning_clean_required: true,
      applies_to: [
        "required_commands",
        "verification_expectations.primary_commands",
        "verification_expectations.diagnostic_commands",
      ],
      stderr_warning_tokens: ["ResourceWarning", "DeprecationWarning", "RuntimeWarning", "UnhandledPromiseRejectionWarning"],
      exit_zero_warning_output_is_failure: true,
      baseline_exception_requires_same_command_unchanged_baseline: true,
      required_runner_action:
        "Inspect stdout/stderr from primary and diagnostic verification. Fix warning-producing code or tests before final reporting.",
    },
    final_report: {
      required_sections: ["summary", "changed-files", "commands-run", "verification", "risks"],
      require_diff_or_patch_evidence: true,
      structured_output_is_final_report_only: true,
    },
    blocked_output: {
      allowed: true,
      required_fields: ["status", "reason", "evidence_refs"],
    },
  };
}

/**
 * @param {Record<string, unknown>} envelope
 * @param {{ adapterId: string, routeId: string, compiledContextRef: string | null, requestArtifactRef: string | null, requestArtifactFile?: string | null, projectRoot?: string | null }} options
 * @returns {Record<string, unknown>}
 */
function buildProviderWorkPacket(envelope, options) {
  const context = asRecord(envelope.context);
  const route = asRecord(envelope.route);
  const routeProfile = asRecord(route.route_profile);
  const assetBundle = asRecord(envelope.asset_bundle);
  const policyBundle = asRecord(envelope.policy_bundle);
  const policy = asRecord(policyBundle.policy);
  const resolvedBounds = asRecord(policyBundle.resolved_bounds);
  const adapterRequestRefs = [
    asOptionalString(options.requestArtifactRef),
    asOptionalString(context.compiled_context_ref),
    asOptionalString(context.compiled_context_file),
    ...asStringArray(context.packet_refs),
    ...asStringArray(context.context_bundle_refs),
    ...asStringArray(context.context_doc_refs),
    ...asStringArray(context.context_rule_refs),
    ...asStringArray(context.context_skill_refs),
    ...asStringArray(context.runtime_evidence_refs),
  ].filter(Boolean);

  return {
    packet_kind: "aor-provider-work-packet",
    version: 1,
    request_id: envelope.request_id,
    run_id: envelope.run_id,
    step_id: envelope.step_id,
    step_class: envelope.step_class,
    dry_run: envelope.dry_run,
    adapter_id: options.adapterId,
    route: {
      route_id: options.routeId,
      route_class: asOptionalString(routeProfile.route_class),
      provider: asOptionalString(asRecord(routeProfile.primary).provider),
    },
    asset_refs: {
      wrapper_ref: asOptionalString(asRecord(assetBundle.wrapper).wrapper_ref),
      prompt_bundle_ref: asOptionalString(asRecord(assetBundle.prompt_bundle).prompt_bundle_ref),
      context_bundle_refs: asStringArray(asRecord(assetBundle.context_bundles).bundle_refs),
    },
    policy: {
      policy_id: asOptionalString(policy.policy_id),
      resolved_bounds: {
        budget: asRecord(resolvedBounds.budget),
        writeback_mode: asRecord(resolvedBounds.writeback_mode),
        command_constraints: asRecord(resolvedBounds.command_constraints),
      },
    },
    input_packet_refs: asStringArray(envelope.input_packet_refs),
    resolved_local_refs: buildResolvedLocalRefs(envelope, options),
    execution_contract: buildExecutionContract(envelope),
    context: {
      compiled_context_ref: options.compiledContextRef,
      compiled_context_id: asOptionalString(context.compiled_context_id),
      compiled_context_fingerprint: asOptionalString(context.compiled_context_fingerprint),
      context_bundle_refs: asStringArray(context.context_bundle_refs),
      context_doc_refs: asStringArray(context.context_doc_refs),
      context_rule_refs: asStringArray(context.context_rule_refs),
      context_skill_refs: asStringArray(context.context_skill_refs),
      packet_refs: asStringArray(context.packet_refs),
      instruction_set: asRecord(context.instruction_set),
      required_inputs_resolved: asRecord(context.required_inputs_resolved),
      guardrails: asRecord(context.guardrails),
      skill_refs: asStringArray(context.skill_refs),
      provenance: {
        project_profile_path: asOptionalString(asRecord(context.provenance).project_profile_path),
        route_profile_source: asOptionalString(asRecord(context.provenance).route_profile_source),
        wrapper_profile_source: asOptionalString(asRecord(context.provenance).wrapper_profile_source),
        prompt_bundle_source: asOptionalString(asRecord(context.provenance).prompt_bundle_source),
        policy_profile_source: asOptionalString(asRecord(context.provenance).policy_profile_source),
        context_bundle_sources: asStringArray(asRecord(context.provenance).context_bundle_sources),
        skill_profile_sources: asStringArray(asRecord(context.provenance).skill_profile_sources),
        input_packet_refs: asStringArray(asRecord(context.provenance).input_packet_refs),
        runtime_evidence_refs: asStringArray(asRecord(context.provenance).runtime_evidence_refs),
      },
    },
    evidence_refs: [...new Set(adapterRequestRefs)],
    full_request_artifact_ref: options.requestArtifactRef,
    output_contract: {
      return_json: true,
      preserve_evidence_refs: true,
    },
  };
}

/**
 * @param {{
 *   runnerInput: Record<string, unknown>,
 *   providerWorkPacket: Record<string, unknown>,
 *   providerWorkPacketText: string,
 *   launcherPrompt: string,
 *   budgetLimitTokens: number,
 * }} options
 */
function buildContextBudgetReports(options) {
  const originalBreakdown = buildContextSourceBreakdown([
    { source: "request.route", value: asRecord(options.runnerInput.request).route },
    { source: "request.asset_bundle", value: asRecord(options.runnerInput.request).asset_bundle },
    { source: "request.policy_bundle", value: asRecord(options.runnerInput.request).policy_bundle },
    { source: "request.context", value: asRecord(options.runnerInput.request).context },
    { source: "request.input_packet_refs", value: asRecord(options.runnerInput.request).input_packet_refs },
    { source: "adapter", value: options.runnerInput.adapter },
  ]);
  const originalEstimate = sumContextEstimates(originalBreakdown);
  const launcherPromptEstimate = {
    source: "launcher_prompt",
    ...estimateContextText(options.launcherPrompt),
  };
  const providerPacketTextEstimate = estimateContextText(options.providerWorkPacketText);
  const finalBreakdown = [
    launcherPromptEstimate,
    ...buildContextSourceBreakdown([
      {
        source: "provider_work_packet.metadata",
        value: {
          packet_kind: options.providerWorkPacket.packet_kind,
          version: options.providerWorkPacket.version,
          request_id: options.providerWorkPacket.request_id,
          run_id: options.providerWorkPacket.run_id,
          step_id: options.providerWorkPacket.step_id,
          step_class: options.providerWorkPacket.step_class,
          dry_run: options.providerWorkPacket.dry_run,
          adapter_id: options.providerWorkPacket.adapter_id,
          full_request_artifact_ref: options.providerWorkPacket.full_request_artifact_ref,
          output_contract: options.providerWorkPacket.output_contract,
        },
      },
      { source: "provider_work_packet.route", value: options.providerWorkPacket.route },
      { source: "provider_work_packet.asset_refs", value: options.providerWorkPacket.asset_refs },
      { source: "provider_work_packet.policy", value: options.providerWorkPacket.policy },
      { source: "provider_work_packet.input_packet_refs", value: options.providerWorkPacket.input_packet_refs },
      { source: "provider_work_packet.resolved_local_refs", value: options.providerWorkPacket.resolved_local_refs },
      { source: "provider_work_packet.execution_contract", value: options.providerWorkPacket.execution_contract },
      { source: "provider_work_packet.context", value: options.providerWorkPacket.context },
      { source: "provider_work_packet.evidence_refs", value: options.providerWorkPacket.evidence_refs },
    ]),
  ];
  const exactFinalEstimate = sumContextEstimates([launcherPromptEstimate, providerPacketTextEstimate]);
  const componentEstimate = sumContextEstimates(finalBreakdown);
  const serializationOverhead = {
    source: "provider_work_packet.serialization_overhead",
    bytes: Math.max(0, exactFinalEstimate.bytes - componentEstimate.bytes),
    chars: Math.max(0, exactFinalEstimate.chars - componentEstimate.chars),
    estimated_tokens: Math.max(0, exactFinalEstimate.estimated_tokens - componentEstimate.estimated_tokens),
  };
  if (serializationOverhead.bytes > 0 || serializationOverhead.chars > 0 || serializationOverhead.estimated_tokens > 0) {
    finalBreakdown.push(serializationOverhead);
  }
  const finalEstimate = sumContextEstimates(finalBreakdown);
  const finalBudgetStatus = classifyContextBudgetStatus(
    finalEstimate.estimated_tokens,
    options.budgetLimitTokens,
  );
  return {
    budget_report: {
      ...finalEstimate,
      budget_limit_tokens: options.budgetLimitTokens,
      budget_status: finalBudgetStatus,
      source_breakdown: finalBreakdown,
    },
    compaction_report: {
      strategy: "deterministic-ref-summary",
      original_estimate: originalEstimate,
      final_estimate: finalEstimate,
      dropped_or_summarized_sources: [
        "request.route.full_profile",
        "request.asset_bundle.full_profiles",
        "request.policy_bundle.full_profile",
        "runtime_evidence_payloads",
        "historical_transcripts",
      ],
      mandatory_refs_preserved: asStringArray(options.providerWorkPacket.evidence_refs),
    },
    top_context_size_sources: [...finalBreakdown]
      .sort((left, right) => right.estimated_tokens - left.estimated_tokens)
      .slice(0, 5),
  };
}

/**
 * @param {string} stdout
 * @param {string} stderr
 * @param {string | null | undefined} errorMessage
 * @returns {string | null}
 */
function summarizeProviderPromptOverflow(stdout, stderr, errorMessage) {
  const combined = `${stdout}\n${stderr}\n${errorMessage ?? ""}`;
  if (
    /prompt\s+is\s+too\s+long/iu.test(combined) ||
    /context\s+window/iu.test(combined) ||
    /input\s+tokens?.{0,80}(?:exceed|exceeds|exceeded|too\s+large|too\s+long)/iu.test(combined) ||
    /maximum\s+context/iu.test(combined)
  ) {
    return sanitizeSummary(combined);
  }
  return null;
}

/**
 * @param {string} value
 * @returns {Record<string, unknown> | null}
 */
function parseMaybeFencedJsonObject(value) {
  const trimmed = value.trim();
  const candidates = [trimmed];
  const fencedMatch = /```(?:json)?\s*([\s\S]*?)\s*```/iu.exec(trimmed);
  if (fencedMatch) candidates.unshift(fencedMatch[1].trim());
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      const record = asRecord(parsed);
      if (Object.keys(record).length > 0) return record;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

/**
 * @param {Record<string, unknown>} runnerPayload
 * @returns {Record<string, unknown>}
 */
function extractProviderFinalReportObject(runnerPayload) {
  const resultText = asOptionalString(runnerPayload.result);
  if (resultText) {
    const parsedResult = parseMaybeFencedJsonObject(resultText);
    if (parsedResult) return parsedResult;
  }
  return runnerPayload;
}

/**
 * @param {Record<string, unknown>} record
 * @returns {boolean}
 */
function hasExecutionReportSignals(record) {
  const keys = new Set(Object.keys(record).map((key) => key.toLowerCase().replace(/-/gu, "_")));
  return (
    keys.has("changed_files") ||
    keys.has("commands_run") ||
    keys.has("verification") ||
    keys.has("diff") ||
    keys.has("patch")
  );
}

/**
 * @param {{ runnerPayload: Record<string, unknown>, stdout: string }} options
 * @returns {boolean}
 */
function isProviderWorkPacketEcho(options) {
  const finalReport = extractProviderFinalReportObject(options.runnerPayload);
  const keys = new Set(Object.keys(finalReport).map((key) => key.toLowerCase()));
  const looksLikePacketSummary =
    (keys.has("packet_identity") || asOptionalString(finalReport.packet_kind) === "aor-provider-work-packet") &&
    (keys.has("route_and_policy") || keys.has("route")) &&
    (keys.has("linked_refs_resolved") || keys.has("input_packet_refs") || keys.has("resolved_local_refs"));
  if (looksLikePacketSummary && !hasExecutionReportSignals(finalReport)) return true;

  const stdoutLower = options.stdout.toLowerCase();
  return (
    stdoutLower.includes("aor-provider-work-packet") &&
    stdoutLower.includes("packet_identity") &&
    stdoutLower.includes("route_and_policy") &&
    stdoutLower.includes("linked_refs_resolved") &&
    !/"changed[-_]files"\s*:/iu.test(options.stdout) &&
    !/"commands[-_]run"\s*:/iu.test(options.stdout)
  );
}

/**
 * @param {{
 *   adaptersRoot: string,
 * }} options
 * @returns {Map<string, { profile: Record<string, unknown>, source: string }>}
 */
export function buildAdapterRegistry(options) {
  if (!fs.existsSync(options.adaptersRoot)) {
    throw new Error(`Adapter registry root '${options.adaptersRoot}' does not exist.`);
  }

  const entries = fs
    .readdirSync(options.adaptersRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(yaml|yml)$/u.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  const registry = new Map();
  for (const filename of entries) {
    const source = path.join(options.adaptersRoot, filename);
    const loaded = loadContractFile({
      filePath: source,
      family: "adapter-capability-profile",
    });
    if (!loaded.ok) {
      throw new Error(`Adapter profile '${source}' failed contract validation.`);
    }

    const profile = asRecord(loaded.document);
    const adapterId = profile.adapter_id;
    if (typeof adapterId !== "string" || adapterId.trim().length === 0) {
      throw new Error(`Adapter profile '${source}' is missing adapter_id.`);
    }
    if (registry.has(adapterId)) {
      throw new Error(`Adapter id '${adapterId}' is declared more than once in adapter registry.`);
    }

    registry.set(adapterId, { profile, source });
  }

  return registry;
}

/**
 * @param {{
 *   routeResolution: {
 *     step_class: string,
 *     resolved_route_id: string,
 *     route_profile_source: string,
 *     route_profile: Record<string, unknown>,
 *   },
 *   adapterOverrides?: Record<string, string>,
 *   adaptersRoot: string,
 *   adapterRegistry: Map<string, { profile: Record<string, unknown>, source: string }>,
 * }} options
 */
function resolveAdapterForRouteWithRegistry(options) {
  const routeProfile = asRecord(options.routeResolution.route_profile);
  const primary = asRecord(routeProfile.primary);
  const requiredCapabilities = asStringArray(routeProfile.required_adapter_capabilities);

  const rawOverrides = asRecord(options.adapterOverrides ?? {});
  for (const key of Object.keys(rawOverrides)) {
    if (!SUPPORTED_STEP_CLASSES.includes(key)) {
      throw new Error(
        `Unknown adapter override '${key}'. Expected one of: ${SUPPORTED_STEP_CLASSES.join(", ")}.`,
      );
    }
  }

  const overrideValue = rawOverrides[options.routeResolution.step_class];
  const selectedFromOverride =
    typeof overrideValue === "string" && overrideValue.trim().length > 0 ? overrideValue.trim() : null;
  const selectedFromRoute =
    typeof primary.adapter === "string" && primary.adapter.trim().length > 0 ? primary.adapter.trim() : null;
  const resolvedAdapterId = selectedFromOverride ?? selectedFromRoute;

  if (!resolvedAdapterId || resolvedAdapterId === "none") {
    if (requiredCapabilities.length > 0) {
      throw new Error(
        `Adapter negotiation failed for step '${options.routeResolution.step_class}': route '${options.routeResolution.resolved_route_id}' requires capabilities [${requiredCapabilities.join(
          ", ",
        )}] but adapter source resolved to '${resolvedAdapterId ?? "none"}'.`,
      );
    }

    return {
      step_class: options.routeResolution.step_class,
      route_id: options.routeResolution.resolved_route_id,
      adapter: {
        adapter_id: "none",
        resolution_source: {
          kind: selectedFromOverride ? "step-override" : "route-primary",
          field: selectedFromOverride
            ? `adapter_overrides.${options.routeResolution.step_class}`
            : "route.primary.adapter",
        },
        profile_source: null,
        profile: null,
      },
      capability_check: {
        required: [],
        satisfied: [],
        missing: [],
        status: "not-required",
      },
      lifecycle_hooks: STEP_LIFECYCLE_HOOKS,
      provenance: {
        route_profile_source: options.routeResolution.route_profile_source,
        adapter_profile_source: null,
      },
    };
  }

  const adapterEntry = options.adapterRegistry.get(resolvedAdapterId);
  if (!adapterEntry) {
    throw new Error(
      `Adapter negotiation failed for step '${options.routeResolution.step_class}': adapter '${resolvedAdapterId}' is not present in adapter registry '${options.adaptersRoot}'.`,
    );
  }

  const capabilities = asRecord(adapterEntry.profile.capabilities);
  const missingCapabilities = requiredCapabilities.filter((capability) => capabilities[capability] !== true);
  if (missingCapabilities.length > 0) {
    throw new Error(
      `Adapter negotiation failed for step '${options.routeResolution.step_class}': adapter '${resolvedAdapterId}' is missing capabilities [${missingCapabilities.join(
        ", ",
      )}] required by route '${options.routeResolution.resolved_route_id}'.`,
    );
  }

  return {
    step_class: options.routeResolution.step_class,
    route_id: options.routeResolution.resolved_route_id,
    adapter: {
      adapter_id: resolvedAdapterId,
      resolution_source: {
        kind: selectedFromOverride ? "step-override" : "route-primary",
        field: selectedFromOverride
          ? `adapter_overrides.${options.routeResolution.step_class}`
          : "route.primary.adapter",
      },
      profile_source: adapterEntry.source,
      profile: {
        adapter_id: adapterEntry.profile.adapter_id,
        version: adapterEntry.profile.version,
        runner_family:
          typeof adapterEntry.profile.runner_family === "string" ? adapterEntry.profile.runner_family : null,
        capabilities,
        constraints: asRecord(adapterEntry.profile.constraints),
        execution: asRecord(adapterEntry.profile.execution),
      },
    },
    capability_check: {
      required: requiredCapabilities,
      satisfied: requiredCapabilities,
      missing: [],
      status: "pass",
    },
    lifecycle_hooks: STEP_LIFECYCLE_HOOKS,
    provenance: {
      route_profile_source: options.routeResolution.route_profile_source,
      adapter_profile_source: adapterEntry.source,
    },
  };
}

/**
 * @param {{
 *   routeResolution: {
 *     step_class: string,
 *     resolved_route_id: string,
 *     route_profile_source: string,
 *     route_profile: Record<string, unknown>,
 *   },
 *   adaptersRoot: string,
 *   adapterOverrides?: Record<string, string>,
 * }} options
 */
export function resolveAdapterForRoute(options) {
  const adapterRegistry = buildAdapterRegistry({
    adaptersRoot: options.adaptersRoot,
  });

  return resolveAdapterForRouteWithRegistry({
    ...options,
    adapterRegistry,
  });
}

/**
 * @param {{
 *   routeResolutionMatrix: Array<{
 *     step_class: string,
 *     resolved_route_id: string,
 *     route_profile_source: string,
 *     route_profile: Record<string, unknown>,
 *   }>,
 *   adaptersRoot: string,
 *   adapterOverrides?: Record<string, string>,
 * }} options
 */
export function resolveAdapterMatrix(options) {
  const adapterRegistry = buildAdapterRegistry({
    adaptersRoot: options.adaptersRoot,
  });

  return options.routeResolutionMatrix.map((routeResolution) =>
    resolveAdapterForRouteWithRegistry({
      routeResolution,
      adaptersRoot: options.adaptersRoot,
      adapterOverrides: options.adapterOverrides,
      adapterRegistry,
    }),
  );
}

/**
 * @param {{
 *   request_id: string,
 *   run_id: string,
 *   step_id: string,
 *   step_class: string,
 *   route: Record<string, unknown>,
 *   asset_bundle: Record<string, unknown>,
 *   policy_bundle: Record<string, unknown>,
 *   input_packet_refs?: string[],
 *   dry_run?: boolean,
 *   context?: Record<string, unknown>,
 * }} input
 */
export function createAdapterRequestEnvelope(input) {
  return {
    request_id: requireString("request_id", input.request_id),
    run_id: requireString("run_id", input.run_id),
    step_id: requireString("step_id", input.step_id),
    step_class: requireString("step_class", input.step_class),
    route: asRecord(input.route),
    asset_bundle: asRecord(input.asset_bundle),
    policy_bundle: asRecord(input.policy_bundle),
    feature_traceability: asRecord(input.feature_traceability),
    input_packet_refs: asStringArray(input.input_packet_refs),
    dry_run: Boolean(input.dry_run),
    context: asRecord(input.context),
    provider_step_status: asRecord(input.provider_step_status),
  };
}

/**
 * @param {{
 *   request_id: string,
 *   adapter_id: string,
 *   status: string,
 *   summary: string,
 *   output?: Record<string, unknown>,
 *   evidence_refs?: string[],
 *   tool_traces?: Array<Record<string, unknown>>,
 * }} input
 */
export function createAdapterResponseEnvelope(input) {
  const status = requireString("status", input.status);
  if (!ADAPTER_RESPONSE_STATUSES.includes(status)) {
    throw new Error(
      `Adapter envelope field 'status' must be one of: ${ADAPTER_RESPONSE_STATUSES.join(", ")}.`,
    );
  }

  return {
    request_id: requireString("request_id", input.request_id),
    adapter_id: requireString("adapter_id", input.adapter_id),
    status,
    summary: requireString("summary", input.summary),
    output: asRecord(input.output),
    evidence_refs: asStringArray(input.evidence_refs),
    tool_traces: Array.isArray(input.tool_traces) ? input.tool_traces.map((trace) => asRecord(trace)) : [],
  };
}

/**
 * @param {{ adapterId?: string }} [options]
 */
export function createMockAdapter(options = {}) {
  const adapterId =
    typeof options.adapterId === "string" && options.adapterId.trim().length > 0
      ? options.adapterId.trim()
      : "mock-runner";

  return {
    adapter_id: adapterId,
    lifecycle_hooks: STEP_LIFECYCLE_HOOKS,
    /**
     * @param {{
     *   request_id: string,
     *   run_id: string,
     *   step_id: string,
     *   step_class: string,
     *   route: Record<string, unknown>,
     *   asset_bundle: Record<string, unknown>,
     *   policy_bundle: Record<string, unknown>,
     *   input_packet_refs?: string[],
     *   dry_run?: boolean,
     *   context?: Record<string, unknown>,
     * }} request
     */
    execute(request) {
      const envelope = createAdapterRequestEnvelope(request);
      const route = asRecord(envelope.route);
      const routeId =
        typeof route.resolved_route_id === "string" && route.resolved_route_id.trim().length > 0
          ? route.resolved_route_id.trim()
          : "route.unknown";
      const deterministicSeed = `${envelope.step_id}:${envelope.step_class}:${routeId}:${envelope.dry_run ? "dry-run" : "execute"}`;
      const normalizedEvidenceToken = deterministicSeed.toLowerCase().replace(/[^a-z0-9]+/g, "-");

      return createAdapterResponseEnvelope({
        request_id: envelope.request_id,
        adapter_id: adapterId,
        status: "success",
        summary: `Mock adapter completed ${envelope.step_class}`,
        output: {
          deterministic_seed: deterministicSeed,
          mode: envelope.dry_run ? "dry-run" : "execute",
          route_id: routeId,
        },
        evidence_refs: [`evidence://mock-adapter/${normalizedEvidenceToken}`],
        tool_traces: [
          {
            phase: "invoke_adapter",
            kind: "mock-run",
            detail: `deterministic_seed=${deterministicSeed}`,
          },
        ],
      });
    },
  };
}

/**
 * @param {{
 *   adapterId: string,
 *   adapterProfile?: Record<string, unknown>,
 *   runtimeEvidenceRoot?: string,
 *   projectRoot?: string,
 *   executionRoot?: string,
 * }} options
 */
export function createLiveAdapter(options) {
  const adapterId = requireString("adapterId", options.adapterId);
  const adapterProfile = asRecord(options.adapterProfile);
  const runnerFamily = asOptionalString(adapterProfile.runner_family) ?? adapterId;
  const executionProfile = asRecord(adapterProfile.execution);
  const runtimeMode = asOptionalString(executionProfile.runtime_mode);
  const handler = asOptionalString(executionProfile.handler);
  const handlerKind = handler ?? `${adapterId}-external-runner`;
  const evidenceNamespace =
    asOptionalString(executionProfile.evidence_namespace) ?? `evidence://adapter-live/${adapterId}`;
  const externalRuntime = asRecord(executionProfile.external_runtime);
  const runtimeCommand = asOptionalString(externalRuntime.command);
  const requestViaStdin = externalRuntime.request_via_stdin !== false;
  const requestTransport = resolveRequestTransport(externalRuntime, requestViaStdin);
  const timeoutMs = asPositiveInteger(externalRuntime.timeout_ms, 30000);
  const runtimeEvidenceRoot = asOptionalString(options.runtimeEvidenceRoot);
  const projectRoot = asOptionalString(options.projectRoot);
  const requestedExecutionRoot = asOptionalString(options.executionRoot);
  const executionRoot = requestedExecutionRoot
    ? path.isAbsolute(requestedExecutionRoot)
      ? requestedExecutionRoot
      : path.resolve(process.cwd(), requestedExecutionRoot)
    : process.cwd();

  return {
    adapter_id: adapterId,
    lifecycle_hooks: STEP_LIFECYCLE_HOOKS,
    /**
     * @param {{
     *   request_id: string,
     *   run_id: string,
     *   step_id: string,
     *   step_class: string,
     *   route: Record<string, unknown>,
     *   asset_bundle: Record<string, unknown>,
     *   policy_bundle: Record<string, unknown>,
     *   input_packet_refs?: string[],
     *   dry_run?: boolean,
     *   context?: Record<string, unknown>,
     * }} request
     */
    execute(request) {
      const envelope = createAdapterRequestEnvelope(request);
      const route = asRecord(envelope.route);
      const routeId =
        typeof route.resolved_route_id === "string" && route.resolved_route_id.trim().length > 0
          ? route.resolved_route_id.trim()
          : "route.unknown";
      const context = asRecord(envelope.context);
      const compiledContextRef =
        typeof context.compiled_context_ref === "string" && context.compiled_context_ref.trim().length > 0
          ? context.compiled_context_ref.trim()
          : null;
      const invocationToken = `${envelope.run_id}:${envelope.step_id}:${envelope.request_id}:${Date.now()}`;
      const normalizedEvidenceToken = invocationToken.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const runtimeEnvironment = resolveExternalRuntimeEnvironment({
        externalRuntime,
        baseEnv: process.env,
      });
      const runnerEnv = runtimeEnvironment.env;
      const runtimeInvocation = resolveExternalRuntimePermissionPolicy({
        externalRuntime,
        requestedMode: asOptionalString(runnerEnv.AOR_RUNTIME_AGENT_PERMISSION_MODE),
      });

      if (runtimeMode !== "external-process") {
        return createAdapterResponseEnvelope({
          request_id: envelope.request_id,
          adapter_id: adapterId,
          status: "blocked",
          summary: `Adapter '${adapterId}' live runtime is misconfigured: execution.runtime_mode must be 'external-process'.`,
          output: {
            mode: "execute",
            blocked: true,
            route_id: routeId,
            provider_adapter: adapterId,
            compiled_context_ref: compiledContextRef,
            failure_kind: "missing-live-runtime",
            runtime_mode: runtimeMode,
            external_runner: {
              runtime_mode: runtimeMode,
              command: runtimeCommand,
              args: runtimeInvocation.args,
              permission_mode: runtimeInvocation.permissionMode,
              permission_mode_source: runtimeInvocation.source,
              execution_root: executionRoot,
            },
          },
          evidence_refs: [`${evidenceNamespace}/${normalizedEvidenceToken}`],
          tool_traces: [
            {
              phase: "invoke_adapter",
              kind: handlerKind,
              detail: "runtime_mode is not external-process",
            },
          ],
        });
      }

      if (!runtimeCommand) {
        return createAdapterResponseEnvelope({
          request_id: envelope.request_id,
          adapter_id: adapterId,
          status: "blocked",
          summary: `Adapter '${adapterId}' live runtime is missing execution.external_runtime.command.`,
          output: {
            mode: "execute",
            blocked: true,
            route_id: routeId,
            provider_adapter: adapterId,
            compiled_context_ref: compiledContextRef,
            failure_kind: "missing-live-runtime",
            external_runner: {
              runtime_mode: runtimeMode,
              command: runtimeCommand,
              args: runtimeInvocation.args,
              permission_mode: runtimeInvocation.permissionMode,
              permission_mode_source: runtimeInvocation.source,
              execution_root: executionRoot,
            },
          },
          evidence_refs: [`${evidenceNamespace}/${normalizedEvidenceToken}`],
          tool_traces: [
            {
              phase: "invoke_adapter",
              kind: handlerKind,
              detail: "external_runtime.command is missing",
            },
          ],
        });
      }

      if (!runtimeInvocation.ok) {
        return createAdapterResponseEnvelope({
          request_id: envelope.request_id,
          adapter_id: adapterId,
          status: "blocked",
          summary: `Adapter '${adapterId}' live runtime permission policy is invalid: ${runtimeInvocation.message}`,
          output: {
            mode: "execute",
            blocked: true,
            route_id: routeId,
            provider_adapter: adapterId,
            compiled_context_ref: compiledContextRef,
            failure_kind: runtimeInvocation.failureKind,
            external_runner: {
              runtime_mode: runtimeMode,
              command: runtimeCommand,
              args: runtimeInvocation.args,
              permission_mode: runtimeInvocation.permissionMode,
              permission_mode_source: runtimeInvocation.source,
              execution_root: executionRoot,
            },
          },
          evidence_refs: [`${evidenceNamespace}/${normalizedEvidenceToken}`],
          tool_traces: [
            {
              phase: "invoke_adapter",
              kind: handlerKind,
              detail: `permission_mode=${runtimeInvocation.permissionMode} invalid`,
            },
          ],
        });
      }

      if (!isSupportedRequestTransport(requestTransport)) {
        return createAdapterResponseEnvelope({
          request_id: envelope.request_id,
          adapter_id: adapterId,
          status: "blocked",
          summary: `Adapter '${adapterId}' live runtime request transport '${requestTransport}' is not supported.`,
          output: {
            mode: "execute",
            blocked: true,
            route_id: routeId,
            provider_adapter: adapterId,
            compiled_context_ref: compiledContextRef,
            failure_kind: "request-transport-invalid",
            external_runner: {
              runtime_mode: runtimeMode,
              command: runtimeCommand,
              args: runtimeInvocation.args,
              permission_mode: runtimeInvocation.permissionMode,
              permission_mode_source: runtimeInvocation.source,
              execution_root: executionRoot,
              request_transport: requestTransport,
            },
          },
          evidence_refs: [`${evidenceNamespace}/${normalizedEvidenceToken}`],
          tool_traces: [
            {
              phase: "invoke_adapter",
              kind: handlerKind,
              detail: `request_transport=${requestTransport} invalid`,
            },
          ],
        });
      }

      const executionRootBinding = resolveExternalRuntimeExecutionRoot({
        externalRuntime,
        executionRoot,
      });
      const runnerExecutionRoot = executionRootBinding.executionRoot;
      let runtimeArgs = [...runtimeInvocation.args];
      const requestTimeoutMs = resolveRequestTimeoutMs(envelope, timeoutMs);
      const startedAt = new Date().toISOString();
      const runnerInput = {
        request: envelope,
        adapter: {
          adapter_id: adapterId,
          route_id: routeId,
          compiled_context_ref: compiledContextRef,
          permission_mode: runtimeInvocation.permissionMode,
        },
      };
      const serializedRunnerInput = `${JSON.stringify(runnerInput)}\n`;
      runtimeArgs = [
        ...runtimeArgs,
        ...resolveExternalRuntimeNativeTimeoutArgs({
          externalRuntime,
          timeoutMs: requestTimeoutMs,
        }),
      ];
      const outputMode = resolveOutputModeFromArgs(runtimeArgs);
      const evidenceDir = runtimeEvidenceRoot
        ? path.isAbsolute(runtimeEvidenceRoot)
          ? runtimeEvidenceRoot
          : path.resolve(executionRoot, runtimeEvidenceRoot)
        : null;
      const requestArtifactDir = evidenceDir ?? path.join(executionRoot, ".aor", "adapter-requests");
      fs.mkdirSync(requestArtifactDir, { recursive: true });
      const requestArtifactFile = path.join(
        requestArtifactDir,
        buildLiveAdapterEvidenceFileName({
          kind: "request",
          adapterId,
          evidenceToken: normalizedEvidenceToken,
          timestamp: Date.now(),
        }),
      );
      fs.writeFileSync(requestArtifactFile, serializedRunnerInput, "utf8");
      const requestArtifactRef = toEvidenceRef(projectRoot, requestArtifactFile);

      const requestFileProfile = asRecord(externalRuntime.request_file);
      const providerWorkPacket = buildProviderWorkPacket(envelope, {
        adapterId,
        routeId,
        compiledContextRef,
        requestArtifactRef,
        requestArtifactFile,
        projectRoot,
      });
      const providerWorkPacketFile = path.join(
        requestArtifactDir,
        buildLiveAdapterEvidenceFileName({
          kind: "work-packet",
          adapterId,
          evidenceToken: normalizedEvidenceToken,
          timestamp: Date.now(),
        }),
      );
      const providerWorkPacketRef = toEvidenceRef(projectRoot, providerWorkPacketFile);
      if (Array.isArray(providerWorkPacket.resolved_local_refs)) {
        providerWorkPacket.resolved_local_refs = [
          ...providerWorkPacket.resolved_local_refs,
          {
            role: "provider_work_packet",
            evidence_ref: providerWorkPacketRef,
            local_path: providerWorkPacketFile,
            required: true,
            kind: "provider-work-packet",
          },
        ];
      }
      const defaultRequestArtifactMessage =
        "Execute the approved AOR implementation using the provider work packet at {provider_work_packet_path}. Read that JSON first, open every required resolved_local_refs[].local_path, make direct edits in the ephemeral target checkout when execution_contract.expected_meaningful_change.required is true, do not write upstream, run the requested verification commands when feasible, and enforce execution_contract.output_quality_policy by fixing warning-producing stdout/stderr from primary or diagnostic verification before final reporting. Return only a final implementation report with changed-files, commands-run, verification, and risks. Do not stop after summarizing the packet; if implementation is impossible, return a blocked report with reason and evidence refs.";
      const requestMessage = renderRequestArtifactMessage(
        asOptionalString(requestFileProfile.message) ?? defaultRequestArtifactMessage,
        {
          provider_work_packet_path: providerWorkPacketFile,
          provider_work_packet_ref: providerWorkPacketRef,
          request_artifact_ref: requestArtifactRef,
        },
      );
      const budgetLimitTokens = resolveContextBudgetLimitTokens(externalRuntime);
      const providerWorkPacketText = `${JSON.stringify(providerWorkPacket, null, 2)}\n`;
      const contextBudgetReports = buildContextBudgetReports({
        runnerInput,
        providerWorkPacket,
        providerWorkPacketText,
        launcherPrompt: requestMessage,
        budgetLimitTokens,
      });
      fs.writeFileSync(providerWorkPacketFile, providerWorkPacketText, "utf8");

      const writeRawEvidence = (record) => {
        const rawEvidenceRoot = evidenceDir ?? requestArtifactDir;
        fs.mkdirSync(rawEvidenceRoot, { recursive: true });
        const rawEvidenceFile = path.join(
          rawEvidenceRoot,
          buildLiveAdapterEvidenceFileName({
            kind: "raw",
            adapterId,
            evidenceToken: normalizedEvidenceToken,
            timestamp: Date.now(),
          }),
        );
        fs.writeFileSync(rawEvidenceFile, `${JSON.stringify(record, null, 2)}\n`, "utf8");
        return {
          rawEvidenceFile,
          rawEvidenceRef: toEvidenceRef(projectRoot, rawEvidenceFile),
        };
      };

      let requestInput = undefined;
      let requestFile = null;
      let requestFileRef = null;
      if (requestTransport === "stdin-json") {
        requestInput = serializedRunnerInput;
      } else if (requestTransport === "argv-json") {
        runtimeArgs = [...runtimeArgs, serializedRunnerInput.trim()];
      } else if (requestTransport === "request-artifact") {
        const requestFileArgument = asOptionalString(requestFileProfile.argument);
        requestFile = providerWorkPacketFile;
        requestFileRef = providerWorkPacketRef;
        runtimeArgs = requestFileArgument
          ? [...runtimeArgs, requestMessage, requestFileArgument, providerWorkPacketFile]
          : [...runtimeArgs, requestMessage];
      } else if (requestTransport === "file-attachment") {
        const requestMessage =
          asOptionalString(requestFileProfile.message) ?? "Follow the attached AOR adapter request JSON.";
        const requestFileArgument = asOptionalString(requestFileProfile.argument) ?? "--file";
        requestFile = requestArtifactFile;
        requestFileRef = requestArtifactRef;
        runtimeArgs = [...runtimeArgs, requestMessage, requestFileArgument, requestFile];
      }

      if (contextBudgetReports.budget_report.budget_status === "fail") {
        const finishedAt = new Date().toISOString();
        const rawEvidenceRecord = {
          adapter_id: adapterId,
          request_id: envelope.request_id,
          run_id: envelope.run_id,
          step_id: envelope.step_id,
          step_class: envelope.step_class,
          route_id: routeId,
          started_at: startedAt,
          finished_at: finishedAt,
          runtime: {
            mode: runtimeMode,
            command: runtimeCommand,
            args: runtimeArgs,
            timeout_ms: requestTimeoutMs,
            request_via_stdin: requestViaStdin,
            request_transport: requestTransport,
            request_file: requestFile,
            request_file_ref: requestFileRef,
            request_artifact_file: requestArtifactFile,
            request_artifact_ref: requestArtifactRef,
            provider_work_packet_file: providerWorkPacketFile,
            provider_work_packet_ref: providerWorkPacketRef,
            output_mode: outputMode,
            execution_root: runnerExecutionRoot,
            execution_root_mode: executionRootBinding.mode,
            canonical_execution_root: executionRootBinding.canonicalExecutionRoot,
            permission_mode: runtimeInvocation.permissionMode,
            permission_mode_source: runtimeInvocation.source,
            env_from_applied: runtimeEnvironment.applied,
            env_from_missing: runtimeEnvironment.missing,
          },
          process: {
            exit_code: null,
            signal: null,
            error_code: "COMPILED_CONTEXT_BUDGET_EXCEEDED",
            error_message: "Provider work packet exceeds configured context budget before provider invocation.",
            timed_out: false,
          },
          context_budget: {
            budget_report: contextBudgetReports.budget_report,
            compaction_report: contextBudgetReports.compaction_report,
            top_context_size_sources: contextBudgetReports.top_context_size_sources,
          },
          io: {
            stdout: "",
            stderr: "",
          },
          provider_progress_events: [],
        };
        const { rawEvidenceRef } = writeRawEvidence(rawEvidenceRecord);
        const evidenceRefs = [
          `${evidenceNamespace}/${normalizedEvidenceToken}`,
          requestArtifactRef,
          providerWorkPacketRef,
          rawEvidenceRef,
        ].filter(Boolean);
        return createAdapterResponseEnvelope({
          request_id: envelope.request_id,
          adapter_id: adapterId,
          status: "blocked",
          summary: `Provider work packet for adapter '${adapterId}' exceeds the configured context budget before provider invocation.`,
          output: {
            mode: "execute",
            blocked: true,
            route_id: routeId,
            provider_adapter: adapterId,
            compiled_context_ref: compiledContextRef,
            failure_kind: "compiled_context_budget_exceeded",
            external_runner: {
              runtime_mode: runtimeMode,
              command: runtimeCommand,
              args: runtimeArgs,
              execution_root: runnerExecutionRoot,
              execution_root_mode: executionRootBinding.mode,
              canonical_execution_root: executionRootBinding.canonicalExecutionRoot,
              timeout_ms: requestTimeoutMs,
              permission_mode: runtimeInvocation.permissionMode,
              permission_mode_source: runtimeInvocation.source,
              env_from_applied: runtimeEnvironment.applied,
              env_from_missing: runtimeEnvironment.missing,
              exit_code: null,
              signal: null,
              timed_out: false,
              request_transport: requestTransport,
              request_file_ref: requestFileRef,
              request_artifact_ref: requestArtifactRef,
              provider_work_packet_ref: providerWorkPacketRef,
              context_budget_status: contextBudgetReports.budget_report.budget_status,
              context_budget_failure_class: "compiled_context_budget_exceeded",
              top_context_size_sources: contextBudgetReports.top_context_size_sources,
              output_mode: outputMode,
              provider_progress_events: [],
              raw_evidence_ref: rawEvidenceRef,
            },
            context_budget: {
              budget_report: contextBudgetReports.budget_report,
              compaction_report: contextBudgetReports.compaction_report,
            },
          },
          evidence_refs: evidenceRefs,
          tool_traces: [
            {
              phase: "invoke_adapter",
              kind: handlerKind,
              detail: "provider work packet exceeded context budget before subprocess spawn",
            },
          ],
        });
      }

      const invocation = runExternalRuntimeProcessSync({
        command: runtimeCommand,
        args: runtimeArgs,
        cwd: runnerExecutionRoot,
        env: runnerEnv,
        input: requestInput,
        timeout: requestTimeoutMs,
        maxBuffer: 10 * 1024 * 1024,
        providerStepStatus: asRecord(envelope.provider_step_status),
      });
      const finishedAt = new Date().toISOString();

      const invocationError = invocation.error instanceof Error ? invocation.error : null;
      const durableProviderRunControlState = readProviderRunControlState(asRecord(envelope.provider_step_status));
      const invocationInterrupted =
        invocationError?.code === "EINTERRUPTED" || isProviderRunControlInterrupted(durableProviderRunControlState);
      if (invocationInterrupted) {
        markProviderRunControlInterrupted(asRecord(envelope.provider_step_status));
      }
      const invocationTimedOut =
        !invocationInterrupted &&
        (invocationError?.code === "ETIMEDOUT" ||
          ((invocation.signal === "SIGTERM" || invocation.signal === "SIGKILL") && invocation.status === null));
      const invocationFailed = invocationError !== null || invocation.status !== 0;
      const stdout = typeof invocation.stdout === "string" ? invocation.stdout : "";
      const stderr = typeof invocation.stderr === "string" ? invocation.stderr : "";
      const providerProgressEvents = Array.isArray(invocation.providerProgressEvents)
        ? invocation.providerProgressEvents.map((event) => asRecord(event))
        : [];
      const rawProviderErrorSummary = summarizeProviderPromptOverflow(
        stdout,
        stderr,
        invocationError?.message ?? null,
      );

      const rawEvidenceRecord = {
        adapter_id: adapterId,
        request_id: envelope.request_id,
        run_id: envelope.run_id,
        step_id: envelope.step_id,
        step_class: envelope.step_class,
        route_id: routeId,
        started_at: startedAt,
        finished_at: finishedAt,
        runtime: {
          mode: runtimeMode,
          command: runtimeCommand,
          args: runtimeArgs,
          timeout_ms: requestTimeoutMs,
          request_via_stdin: requestViaStdin,
          request_transport: requestTransport,
          request_file: requestFile,
          request_file_ref: requestFileRef,
          request_artifact_file: requestArtifactFile,
          request_artifact_ref: requestArtifactRef,
          provider_work_packet_file: providerWorkPacketFile,
          provider_work_packet_ref: providerWorkPacketRef,
          output_mode: outputMode,
          execution_root: runnerExecutionRoot,
          execution_root_mode: executionRootBinding.mode,
          canonical_execution_root: executionRootBinding.canonicalExecutionRoot,
          permission_mode: runtimeInvocation.permissionMode,
          permission_mode_source: runtimeInvocation.source,
          env_from_applied: runtimeEnvironment.applied,
          env_from_missing: runtimeEnvironment.missing,
        },
        process: {
          exit_code: invocation.status,
          signal: invocation.signal,
          error_code: invocationError?.code ?? null,
          error_message: invocationError?.message ?? null,
          timed_out: invocationTimedOut,
        },
        io: {
          stdout,
          stderr,
        },
        context_budget: {
          budget_report: contextBudgetReports.budget_report,
          compaction_report: contextBudgetReports.compaction_report,
          top_context_size_sources: contextBudgetReports.top_context_size_sources,
        },
        provider_progress_events: providerProgressEvents,
      };

      const { rawEvidenceRef } = writeRawEvidence(rawEvidenceRecord);

      const { runnerPayload, runnerEvidenceRefs, runnerToolTraces } = parseExternalRunnerStdout(stdout, {
        sanitizeJsonlEvents: runnerFamily === "qwen" && outputMode === "stream-json",
        providerProgressEvents,
      });

      const baseOutput = {
        mode: "execute",
        route_id: routeId,
        provider_adapter: adapterId,
        compiled_context_ref: compiledContextRef,
        external_runner: {
          runtime_mode: runtimeMode,
          command: runtimeCommand,
          args: runtimeArgs,
          execution_root: runnerExecutionRoot,
          execution_root_mode: executionRootBinding.mode,
          canonical_execution_root: executionRootBinding.canonicalExecutionRoot,
          timeout_ms: requestTimeoutMs,
          permission_mode: runtimeInvocation.permissionMode,
          permission_mode_source: runtimeInvocation.source,
          env_from_applied: runtimeEnvironment.applied,
          env_from_missing: runtimeEnvironment.missing,
          exit_code: invocation.status,
          signal: invocation.signal,
          timed_out: invocationTimedOut,
          request_transport: requestTransport,
          request_file_ref: requestFileRef,
          request_artifact_ref: requestArtifactRef,
          provider_work_packet_ref: providerWorkPacketRef,
          context_budget_status: contextBudgetReports.budget_report.budget_status,
          context_budget_failure_class:
            rawProviderErrorSummary || contextBudgetReports.budget_report.budget_status === "fail"
              ? "compiled_context_budget_exceeded"
              : null,
          top_context_size_sources: contextBudgetReports.top_context_size_sources,
          raw_provider_error_summary: rawProviderErrorSummary,
          output_mode: outputMode,
          provider_progress_events: providerProgressEvents,
          raw_evidence_ref: rawEvidenceRef,
        },
        context_budget: {
          budget_report: contextBudgetReports.budget_report,
          compaction_report: contextBudgetReports.compaction_report,
        },
        runner_output: runnerPayload,
      };

      const evidenceRefs = [
        `${evidenceNamespace}/${normalizedEvidenceToken}`,
        requestArtifactRef,
        providerWorkPacketRef,
        ...(rawEvidenceRef ? [rawEvidenceRef] : []),
        ...runnerEvidenceRefs,
      ];
      const toolTraces = [
        {
          phase: "invoke_adapter",
          kind: handlerKind,
          detail: `command=${runtimeCommand} exit_code=${invocation.status ?? "null"} signal=${invocation.signal ?? "none"}`,
        },
        ...runnerToolTraces,
      ];
      const withRuntimePermissionRequest = (output) => ({
        ...output,
        runtime_permission_request: buildRuntimePermissionRequest({
          adapterId,
          runnerFamily,
          permissionMode: runtimeInvocation.permissionMode,
          permissionModeSource: runtimeInvocation.source,
          runnerPayload,
          runnerToolTraces,
          stdout,
          stderr,
          evidenceRefs,
        }),
      });

      if (invocationTimedOut) {
        return createAdapterResponseEnvelope({
          request_id: envelope.request_id,
          adapter_id: adapterId,
          status: "failed",
          summary: `External runner command '${runtimeCommand}' timed out after ${requestTimeoutMs}ms for adapter '${adapterId}'.`,
          output: {
            ...baseOutput,
            failure_kind: "external-runner-timeout",
          },
          evidence_refs: evidenceRefs,
          tool_traces: toolTraces,
        });
      }

      if (invocationInterrupted) {
        return createAdapterResponseEnvelope({
          request_id: envelope.request_id,
          adapter_id: adapterId,
          status: "blocked",
          summary: `External runner command '${runtimeCommand}' was interrupted through public run-control for adapter '${adapterId}'.`,
          output: {
            ...baseOutput,
            blocked: true,
            failure_kind: "external-runner-interrupted",
          },
          evidence_refs: evidenceRefs,
          tool_traces: toolTraces,
        });
      }

      if (invocationError) {
        const missingCommand = invocationError.code === "ENOENT";
        const failureKind = missingCommand
          ? "missing-command"
          : classifyExternalRunnerFailure({
              stdout,
              stderr,
              errorMessage: invocationError.message,
              defaultFailureKind: "external-runner-failed",
            });
        const blocked =
          missingCommand ||
          failureKind === "auth-failed" ||
          failureKind === "permission-mode-blocked" ||
          failureKind === "edit-denied" ||
          failureKind === "compiled_context_budget_exceeded";
        return createAdapterResponseEnvelope({
          request_id: envelope.request_id,
          adapter_id: adapterId,
          status: blocked ? "blocked" : "failed",
          summary: missingCommand
            ? `External runner command '${runtimeCommand}' is not available on PATH for adapter '${adapterId}'.`
            : `External runner launch failed for adapter '${adapterId}': ${invocationError.message}.`,
          output: {
            ...(failureKind === "permission-mode-blocked" || failureKind === "edit-denied"
              ? withRuntimePermissionRequest(baseOutput)
              : baseOutput),
            blocked,
            failure_kind: failureKind,
          },
          evidence_refs: evidenceRefs,
          tool_traces: toolTraces,
        });
      }

      if (invocationFailed) {
        const failureKind =
          classifyStructuredRunnerFailure({ runnerPayload, runnerToolTraces }) ||
          classifyExternalRunnerFailure({
            stdout,
            stderr,
            defaultFailureKind: "external-runner-failed",
          });
        const blocked = [
          "auth-failed",
          "permission-mode-blocked",
          "edit-denied",
          "compiled_context_budget_exceeded",
        ].includes(failureKind);
        return createAdapterResponseEnvelope({
          request_id: envelope.request_id,
          adapter_id: adapterId,
          status: blocked ? "blocked" : "failed",
          summary: `External runner command '${runtimeCommand}' exited with code ${String(
            invocation.status ?? "null",
          )} for adapter '${adapterId}'.`,
          output: {
            ...(failureKind === "permission-mode-blocked" || failureKind === "edit-denied"
              ? withRuntimePermissionRequest(baseOutput)
              : baseOutput),
            blocked,
            failure_kind: failureKind,
          },
          evidence_refs: evidenceRefs,
          tool_traces: toolTraces,
        });
      }

      const semanticFailureKind =
        (isProviderWorkPacketEcho({ runnerPayload, stdout }) ? "provider_work_packet_not_executed" : "") ||
        classifyStructuredRunnerFailure({ runnerPayload, runnerToolTraces }) ||
        classifyExternalRunnerFailure({
          stdout,
          stderr,
          defaultFailureKind: "",
          ignoreAuthFailure: true,
        });
      if (semanticFailureKind) {
        const blocked = [
          "auth-failed",
          "permission-mode-blocked",
          "edit-denied",
          "interactive-question-requested",
          "compiled_context_budget_exceeded",
        ].includes(semanticFailureKind);
        return createAdapterResponseEnvelope({
          request_id: envelope.request_id,
          adapter_id: adapterId,
          status: blocked ? "blocked" : "failed",
          summary: `External runner command '${runtimeCommand}' completed but emitted '${semanticFailureKind}' evidence for adapter '${adapterId}'.`,
          output: {
            ...(semanticFailureKind === "permission-mode-blocked" || semanticFailureKind === "edit-denied"
              ? withRuntimePermissionRequest(baseOutput)
              : baseOutput),
            blocked,
            failure_kind: semanticFailureKind,
          },
          evidence_refs: evidenceRefs,
          tool_traces: toolTraces,
        });
      }

      return createAdapterResponseEnvelope({
        request_id: envelope.request_id,
        adapter_id: adapterId,
        status: "success",
        summary: `External runner '${runtimeCommand}' completed ${envelope.step_class}.`,
        output: baseOutput,
        evidence_refs: evidenceRefs,
        tool_traces: toolTraces,
      });
    },
  };
}
