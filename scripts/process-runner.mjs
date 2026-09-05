import { spawnSync } from "node:child_process";
import process from "node:process";

export const DEFAULT_PROCESS_TIMEOUT_MS = 120_000;

export function nonInteractiveEnvironment(environment = process.env) {
  return {
    ...environment,
    CI: environment.CI ?? "true",
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "Never",
    NPM_CONFIG_YES: "true",
  };
}

export function classifyProcessResult(result, timeoutMs) {
  const errorCode = result?.error?.code;
  if (errorCode === "ETIMEDOUT") {
    return { ok: false, failure_type: "timeout", message: `timed out after ${timeoutMs}ms` };
  }
  if (result?.error) return { ok: false, failure_type: "spawn_error", message: result.error.message };
  if (result?.signal) return { ok: false, failure_type: "signal", message: `terminated by ${result.signal}` };
  if (result?.status !== 0) return { ok: false, failure_type: "exit", message: `exited with status ${result?.status ?? "unknown"}` };
  return { ok: true, failure_type: null, message: "completed successfully" };
}

/**
 * @param {{ label: string, command: string, args?: string[], cwd?: string, env?: NodeJS.ProcessEnv, timeoutMs?: number, runner?: Function, stdio?: import("node:child_process").StdioOptions }} options
 */
export function runCheckedProcess({
  label,
  command,
  args = [],
  cwd = process.cwd(),
  env = process.env,
  timeoutMs = DEFAULT_PROCESS_TIMEOUT_MS,
  runner = spawnSync,
  stdio = "pipe",
}) {
  const startedAt = Date.now();
  let result;
  try {
    result = runner(command, args, {
      cwd,
      env: nonInteractiveEnvironment(env),
      encoding: "utf8",
      timeout: timeoutMs,
      killSignal: "SIGKILL",
      stdio,
    });
  } catch (error) {
    return {
      label,
      command: [command, ...args],
      ok: false,
      failure_type: "spawn_error",
      message: error instanceof Error ? error.message : String(error),
      exit_code: null,
      signal: null,
      stdout: "",
      stderr: "",
      duration_ms: Date.now() - startedAt,
    };
  }
  const classification = classifyProcessResult(result, timeoutMs);
  return {
    label,
    command: [command, ...args],
    ...classification,
    exit_code: result?.status ?? null,
    signal: result?.signal ?? null,
    stdout: String(result?.stdout ?? "").trim(),
    stderr: String(result?.stderr ?? "").trim(),
    duration_ms: Date.now() - startedAt,
  };
}

export function assertProcessSuccess(result) {
  if (result.ok) return result;
  const output = [result.stderr, result.stdout].filter(Boolean).join("\n");
  throw new Error(`${result.label} failed (${result.failure_type}): ${result.message}${output ? `\n${output}` : ""}`);
}
