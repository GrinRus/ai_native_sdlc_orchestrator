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
const EXTERNAL_REQUEST_TRANSPORTS = Object.freeze(["stdin-json", "file-attachment", "argv-json", "none"]);
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

  state.provider_step_status = {
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
  state.updated_at = nowIso;
  try {
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
 * @param {{ kind: "request" | "raw", adapterId: string, evidenceToken: string, timestamp: number }} options
 */
function buildLiveAdapterEvidenceFileName(options) {
  const adapterSegment = boundedEvidenceSegment(options.adapterId, 40);
  const tokenSegment = boundedEvidenceSegment(options.evidenceToken, 32);
  const tokenHash = createHash("sha256").update(options.evidenceToken).digest("hex").slice(0, 16);
  return `adapter-live-${options.kind}-${adapterSegment}-${tokenSegment}-${tokenHash}-${options.timestamp}.json`;
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
      let requestInput = undefined;
      let requestFile = null;
      let requestFileRef = null;
      if (requestTransport === "stdin-json") {
        requestInput = serializedRunnerInput;
      } else if (requestTransport === "argv-json") {
        runtimeArgs = [...runtimeArgs, serializedRunnerInput.trim()];
      } else if (requestTransport === "file-attachment") {
        const requestFileProfile = asRecord(externalRuntime.request_file);
        const requestMessage =
          asOptionalString(requestFileProfile.message) ?? "Follow the attached AOR adapter request JSON.";
        const requestFileArgument = asOptionalString(requestFileProfile.argument) ?? "--file";
        const requestDir = evidenceDir ?? path.join(executionRoot, ".aor", "adapter-requests");
        fs.mkdirSync(requestDir, { recursive: true });
        requestFile = path.join(
          requestDir,
          buildLiveAdapterEvidenceFileName({
            kind: "request",
            adapterId,
            evidenceToken: normalizedEvidenceToken,
            timestamp: Date.now(),
          }),
        );
        fs.writeFileSync(requestFile, serializedRunnerInput, "utf8");
        requestFileRef = toEvidenceRef(projectRoot, requestFile);
        runtimeArgs = [...runtimeArgs, requestMessage, requestFileArgument, requestFile];
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
      const invocationInterrupted = invocationError?.code === "EINTERRUPTED";
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
        provider_progress_events: providerProgressEvents,
      };

      let rawEvidenceFile = null;
      let rawEvidenceRef = null;
      if (evidenceDir) {
        fs.mkdirSync(evidenceDir, { recursive: true });
        rawEvidenceFile = path.join(
          evidenceDir,
          buildLiveAdapterEvidenceFileName({
            kind: "raw",
            adapterId,
            evidenceToken: normalizedEvidenceToken,
            timestamp: Date.now(),
          }),
        );
        fs.writeFileSync(rawEvidenceFile, `${JSON.stringify(rawEvidenceRecord, null, 2)}\n`, "utf8");
        rawEvidenceRef = toEvidenceRef(projectRoot, rawEvidenceFile);
      }

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
          output_mode: outputMode,
          provider_progress_events: providerProgressEvents,
          raw_evidence_ref: rawEvidenceRef,
        },
        runner_output: runnerPayload,
      };

      const evidenceRefs = [
        `${evidenceNamespace}/${normalizedEvidenceToken}`,
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
          failureKind === "edit-denied";
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
        return createAdapterResponseEnvelope({
          request_id: envelope.request_id,
          adapter_id: adapterId,
          status:
            failureKind === "auth-failed" || failureKind === "permission-mode-blocked" || failureKind === "edit-denied"
              ? "blocked"
              : "failed",
          summary: `External runner command '${runtimeCommand}' exited with code ${String(
            invocation.status ?? "null",
          )} for adapter '${adapterId}'.`,
          output: {
            ...(failureKind === "permission-mode-blocked" || failureKind === "edit-denied"
              ? withRuntimePermissionRequest(baseOutput)
              : baseOutput),
            blocked:
              failureKind === "auth-failed" || failureKind === "permission-mode-blocked" || failureKind === "edit-denied",
            failure_kind: failureKind,
          },
          evidence_refs: evidenceRefs,
          tool_traces: toolTraces,
        });
      }

      const semanticFailureKind =
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
