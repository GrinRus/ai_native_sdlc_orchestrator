import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const SHORT_EXECUTION_ROOT_MODES = Object.freeze(["short-symlink", "short_symlink"]);

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
 * @returns {boolean}
 */
function hasEnvValue(value) {
  return typeof value === "string" && value.length > 0;
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
 * @param {{ externalRuntime: Record<string, unknown>, executionRoot: string }} options
 * @returns {{ executionRoot: string, canonicalExecutionRoot: string, mode: "direct" | "short-symlink", aliased: boolean }}
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
 * @param {{ command: string, args?: string[], cwd: string, env: NodeJS.ProcessEnv, input?: string, timeout: number, maxBuffer: number }} options
 * @returns {{ status: number | null, signal: string | null, stdout: string, stderr: string, error: Error | null, providerProgressEvents: Array<Record<string, unknown>> }}
 */
export function runExternalRuntimeProcessSync(options) {
  const timeoutMs = asPositiveInteger(options.timeout, 30000);
  const maxBuffer = asPositiveInteger(options.maxBuffer, 10 * 1024 * 1024);
  const result = spawnSync(options.command, Array.isArray(options.args) ? options.args : [], {
    cwd: options.cwd,
    env: options.env,
    input: options.input,
    encoding: "utf8",
    timeout: timeoutMs,
    killSignal: "SIGKILL",
    maxBuffer,
  });
  return {
    status: result.status,
    signal: result.signal,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr : "",
    error: result.error instanceof Error ? result.error : null,
    providerProgressEvents: [],
  };
}

/**
 * @param {{ externalRuntime: Record<string, unknown>, baseEnv?: NodeJS.ProcessEnv }} options
 * @returns {{ env: NodeJS.ProcessEnv, applied: Array<{ target: string, source: string }>, missing: Array<{ target: string, source: string }> }}
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
 * @param {{ externalRuntime: Record<string, unknown>, requestedMode?: string | null }} options
 * @returns {{ ok: true, args: string[], permissionMode: string, source: string } | { ok: false, args: string[], permissionMode: string, source: string, failureKind: string, message: string }}
 */
export function resolveExternalRuntimePermissionPolicy(options) {
  const externalRuntime = asRecord(options.externalRuntime);
  const policy = asRecord(externalRuntime.permission_policy);
  const hasPolicy = Object.keys(policy).length > 0;
  if (!hasPolicy) {
    return {
      ok: false,
      args: [],
      permissionMode: "missing",
      source: "external_runtime.permission_policy",
      failureKind: "permission-policy-invalid",
      message: "External runtime permission_policy is required; legacy external_runtime.args is no longer supported.",
    };
  }

  const requestedMode = asOptionalString(options.requestedMode);
  const defaultMode = asOptionalString(policy.default_mode);
  const selectedMode = requestedMode ?? defaultMode;
  if (!selectedMode) {
    return {
      ok: false,
      args: [],
      permissionMode: "missing",
      source: "permission_policy.default_mode",
      failureKind: "permission-policy-invalid",
      message: "External runtime permission_policy.default_mode must select a declared non-empty mode.",
    };
  }

  const modes = asRecord(policy.modes);
  const modeProfile = asRecord(modes[selectedMode]);
  const modeArgs = asStringArray(modeProfile.args);
  if (modeArgs.length === 0) {
    return {
      ok: false,
      args: [],
      permissionMode: selectedMode,
      source: requestedMode ? "AOR_RUNTIME_AGENT_PERMISSION_MODE" : "permission_policy.default_mode",
      failureKind: "permission-policy-invalid",
      message: `External runtime permission policy mode '${selectedMode}' is not declared with non-empty args.`,
    };
  }

  return {
    ok: true,
    args: modeArgs,
    permissionMode: selectedMode,
    source: requestedMode ? "AOR_RUNTIME_AGENT_PERMISSION_MODE" : "permission_policy.default_mode",
  };
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
    return "provider_context_window_exceeded";
  }
  if (
    !options.ignoreAuthFailure &&
    (/\b401\b/u.test(combined) ||
      combined.includes("unauthorized") ||
      combined.includes("not authenticated") ||
      /\bauthentication\s+(?:failed|failure|required|error|invalid|expired|missing|denied|transient)\b/u.test(combined) ||
      /\b(?:failed|failure|required|error|invalid|expired|missing|denied|transient)\s+authentication\b/u.test(combined) ||
      combined.includes("missing bearer") ||
      combined.includes("api key") ||
      combined.includes("apikey") ||
      combined.includes("setup-token") ||
      combined.includes("login required"))
  ) {
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
