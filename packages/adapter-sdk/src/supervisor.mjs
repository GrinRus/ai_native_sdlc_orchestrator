import { spawnSync } from "node:child_process";

function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}

function asOptionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asPositiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export function runSupervisedProcessSync(options) {
  const timeoutMs = asPositiveInteger(options.timeout, 30000);
  const maxBuffer = asPositiveInteger(options.maxBuffer, 10 * 1024 * 1024);
  const payload = {
    command: options.command,
    args: Array.isArray(options.args) ? options.args : [],
    cwd: options.cwd,
    env: options.env,
    input: options.input,
    timeout_ms: timeoutMs,
    max_buffer: maxBuffer,
    provider_step_status: options.providerStepStatus ?? null,
  };
  const supervisor = spawnSync(process.execPath, ["-e", options.supervisorSource], {
    cwd: options.cwd,
    env: process.env,
    encoding: "utf8",
    input: JSON.stringify(payload),
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
  const stdout = typeof supervisor.stdout === "string" ? supervisor.stdout.trim() : "";
  try {
    const parsed = asRecord(JSON.parse(stdout));
    const errorCode = asOptionalString(parsed.error_code);
    const errorMessage = asOptionalString(parsed.error_message);
    const error = errorCode || errorMessage ? new Error(errorMessage ?? errorCode ?? "External runtime failed.") : null;
    if (error && errorCode) Object.assign(error, { code: errorCode });
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
  } catch (cause) {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    Object.assign(error, { code: "SUPERVISOR_RESULT_INVALID" });
    return {
      status: supervisor.status,
      signal: supervisor.signal,
      stdout: "",
      stderr: [typeof supervisor.stderr === "string" ? supervisor.stderr : "", stdout].filter(Boolean).join("\n"),
      error,
      providerProgressEvents: [],
    };
  }
}
