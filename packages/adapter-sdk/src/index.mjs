import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

import { loadContractFile } from "../../contracts/src/index.mjs";
import { SUPPORTED_STEP_CLASSES } from "../../provider-routing/src/route-resolution.mjs";
import { resolveExternalRuntimePermissionPolicy } from "./permission-policy.mjs";

export { resolveExternalRuntimePermissionPolicy } from "./permission-policy.mjs";

const ADAPTER_RESPONSE_STATUSES = Object.freeze(["success", "failed", "blocked"]);
const EXTERNAL_REQUEST_TRANSPORTS = Object.freeze(["stdin-json", "file-attachment", "argv-json", "none"]);

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

function appendBounded(current, chunk, maxBuffer) {
  const next = current + chunk;
  return next.length > maxBuffer ? next.slice(0, maxBuffer) : next;
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
let stdout = "";
let stderr = "";
let timedOut = false;
let emitted = false;

function finish(result) {
  if (emitted) {
    return;
  }
  emitted = true;
  emit(result);
}

let child;
try {
  child = spawn(options.command, Array.isArray(options.args) ? options.args : [], {
    cwd: options.cwd,
    env: options.env,
    detached: process.platform !== "win32",
    stdio: ["pipe", "pipe", "pipe"],
  });
} catch (error) {
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

const timer = setTimeout(() => {
  timedOut = true;
  killProcessTree(child, "SIGKILL");
}, timeoutMs);

child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  stdout = appendBounded(stdout, chunk, maxBuffer);
});
child.stderr.on("data", (chunk) => {
  stderr = appendBounded(stderr, chunk, maxBuffer);
});
child.on("error", (error) => {
  clearTimeout(timer);
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
  finish({
    status,
    signal,
    stdout,
    stderr,
    error_code: timedOut ? "ETIMEDOUT" : null,
    error_message: timedOut ? "External runtime timed out after " + timeoutMs + "ms." : null,
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
 * @param {{
 *   command: string,
 *   args?: string[],
 *   cwd: string,
 *   env: NodeJS.ProcessEnv,
 *   input?: string,
 *   timeout: number,
 *   maxBuffer: number,
 * }} options
 * @returns {{
 *   status: number | null,
 *   signal: string | null,
 *   stdout: string,
 *   stderr: string,
 *   error: Error | null,
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
    .replace(/\bwithout (?:any )?interactive prompts?\b/giu, "");
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
 * @returns {{ runnerPayload: Record<string, unknown>, runnerEvidenceRefs: string[], runnerToolTraces: Array<Record<string, unknown>> }}
 */
function parseExternalRunnerStdout(stdout) {
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
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return (normalized || "unknown").slice(0, maxLength);
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
  const envOverrides = asStringMap(externalRuntime.env);
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
      const runnerEnv = {
        ...process.env,
        ...envOverrides,
      };
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
        cwd: executionRoot,
        env: runnerEnv,
        input: requestInput,
        timeout: requestTimeoutMs,
        maxBuffer: 10 * 1024 * 1024,
      });
      const finishedAt = new Date().toISOString();

      const invocationError = invocation.error instanceof Error ? invocation.error : null;
      const invocationTimedOut =
        invocationError?.code === "ETIMEDOUT" ||
        ((invocation.signal === "SIGTERM" || invocation.signal === "SIGKILL") && invocation.status === null);
      const invocationFailed = invocationError !== null || invocation.status !== 0;
      const stdout = typeof invocation.stdout === "string" ? invocation.stdout : "";
      const stderr = typeof invocation.stderr === "string" ? invocation.stderr : "";

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
          execution_root: executionRoot,
          permission_mode: runtimeInvocation.permissionMode,
          permission_mode_source: runtimeInvocation.source,
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

      const { runnerPayload, runnerEvidenceRefs, runnerToolTraces } = parseExternalRunnerStdout(stdout);

      const baseOutput = {
        mode: "execute",
        route_id: routeId,
        provider_adapter: adapterId,
        compiled_context_ref: compiledContextRef,
        external_runner: {
          runtime_mode: runtimeMode,
          command: runtimeCommand,
          args: runtimeArgs,
          execution_root: executionRoot,
          timeout_ms: requestTimeoutMs,
          permission_mode: runtimeInvocation.permissionMode,
          permission_mode_source: runtimeInvocation.source,
          exit_code: invocation.status,
          signal: invocation.signal,
          timed_out: invocationTimedOut,
          request_transport: requestTransport,
          request_file_ref: requestFileRef,
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
        const blocked = missingCommand || failureKind === "auth-failed" || failureKind === "permission-mode-blocked";
        return createAdapterResponseEnvelope({
          request_id: envelope.request_id,
          adapter_id: adapterId,
          status: blocked ? "blocked" : "failed",
          summary: missingCommand
            ? `External runner command '${runtimeCommand}' is not available on PATH for adapter '${adapterId}'.`
            : `External runner launch failed for adapter '${adapterId}': ${invocationError.message}.`,
          output: {
            ...baseOutput,
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
          status: failureKind === "auth-failed" || failureKind === "permission-mode-blocked" ? "blocked" : "failed",
          summary: `External runner command '${runtimeCommand}' exited with code ${String(
            invocation.status ?? "null",
          )} for adapter '${adapterId}'.`,
          output: {
            ...baseOutput,
            blocked: failureKind === "auth-failed" || failureKind === "permission-mode-blocked",
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
            ...baseOutput,
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
