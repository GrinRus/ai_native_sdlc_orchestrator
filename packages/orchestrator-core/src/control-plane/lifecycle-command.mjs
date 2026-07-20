import fs from "node:fs";
import path from "node:path";

import { derivePublicId } from "../../../contracts/src/index.mjs";
import { getCommandDefinition } from "../operator-cli/command-catalog.mjs";
import { executeImplementedCommand } from "../operator-cli/command-handler.mjs";
import { startRunJob } from "../run-job.mjs";
import { createOperatorError } from "./operator-error.mjs";

const LIFECYCLE_COMMANDS = new Set([
  "project init",
  "intake create",
  "mission create",
  "next",
  "discovery run",
  "spec build",
  "plan create",
  "plan show",
  "plan diff",
  "plan revise",
  "plan approve",
  "plan status",
  "wave create",
  "handoff prepare",
  "handoff approve",
  "run start",
  "run pause",
  "run resume",
  "run steer",
  "run cancel",
  "run retry",
  "review run",
  "review decide",
  "repair close",
  "deliver prepare",
  "release prepare",
  "learning handoff",
]);

const SERVER_OWNED_FLAGS = new Set(["project-ref", "project_ref", "runtime-root", "runtime_root", "help"]);

function lifecycleError(code, detail, operation = null) {
  return createOperatorError({ code, detail, operation, phase: "lifecycle", consequence: "command_not_invoked" });
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
 * @returns {Record<string, unknown>}
 */
function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value)
    : {};
}

/**
 * @param {string} value
 * @returns {string}
 */
function toKebabFlag(value) {
  return value.trim().replace(/_/g, "-");
}

/**
 * @param {string} value
 * @returns {string}
 */
function toEvidenceRef(projectRef, value) {
  if (!path.isAbsolute(value)) {
    return value;
  }
  return `evidence://${path.relative(projectRef, value).replace(/\\/g, "/")}`;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function hasBlockingValue(value) {
  if (value === true) return true;
  if (Array.isArray(value)) return value.length > 0;
  return typeof value === "object" && value !== null && Object.keys(/** @type {Record<string, unknown>} */ (value)).length > 0;
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function asStringList(value) {
  if (typeof value === "string" && value.trim().length > 0) {
    return [value.trim()];
  }
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry) => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim());
}

/**
 * @param {Record<string, unknown>} commandOutput
 * @returns {{ blocked: boolean, blockingFields: string[], blockingReasons: string[] }}
 */
function detectBlockedOutput(commandOutput) {
  const blockingFields = Object.entries(commandOutput)
    .filter(([key, value]) => {
      const normalized = key.toLowerCase();
      return (
        (normalized.endsWith("_blocked") ||
          normalized.endsWith("_blocking") ||
          normalized === "delivery_blocking" ||
          normalized === "evaluation_blocking" ||
          normalized === "validation_blocking") &&
        hasBlockingValue(value)
      );
    })
    .map(([key]) => key);

  const blockingReasons = [
    ...asStringList(commandOutput.run_control_blocked_reason),
    ...asStringList(commandOutput.delivery_blocking_reasons),
    ...asStringList(commandOutput.evaluation_blocking),
    ...asStringList(commandOutput.validation_blocking),
    ...asStringList(commandOutput.discovery_completeness_blocking),
    ...asStringList(commandOutput.handoff_gate_blocking),
  ];

  return {
    blocked: blockingFields.length > 0,
    blockingFields,
    blockingReasons: Array.from(new Set(blockingReasons)),
  };
}

/**
 * @param {Record<string, unknown>} commandOutput
 * @returns {{ artifactRefs: string[], evidenceRefs: string[] }}
 */
function collectOutputRefs(commandOutput) {
  /** @type {string[]} */
  const artifactRefs = [];
  /** @type {string[]} */
  const evidenceRefs = [];

  for (const [key, value] of Object.entries(commandOutput)) {
    if (key.endsWith("_file")) {
      artifactRefs.push(...asStringList(value));
    } else if (key.endsWith("_files")) {
      artifactRefs.push(...asStringList(value));
    } else if (key.endsWith("_ref")) {
      evidenceRefs.push(...asStringList(value));
    } else if (key.endsWith("_refs")) {
      evidenceRefs.push(...asStringList(value));
    }
  }

  return {
    artifactRefs: Array.from(new Set(artifactRefs)),
    evidenceRefs: Array.from(new Set(evidenceRefs)),
  };
}

/**
 * @param {{ projectRef: string, stepResultFile: string, stepResult: Record<string, unknown> }} options
 * @returns {Record<string, unknown> | null}
 */
function buildInteractiveContinuation(options) {
  const requestedInteraction = asRecord(options.stepResult.requested_interaction);
  if (requestedInteraction.requested !== true) {
    return null;
  }

  const status = asString(requestedInteraction.status) ?? "requested";
  if (status === "answered" || status === "resumed") {
    return null;
  }

  return {
    requested: true,
    interaction_id: asString(requestedInteraction.interaction_id),
    interaction_status: status,
    question_summary: asString(requestedInteraction.prompt_summary) ?? asString(requestedInteraction.summary),
    step_result_file: options.stepResultFile,
    step_result_ref: toEvidenceRef(options.projectRef, options.stepResultFile),
    requested_interaction: requestedInteraction,
  };
}

/**
 * @param {{ projectRef: string, commandOutput: Record<string, unknown> }}
 * @returns {Record<string, unknown> | null}
 */
function resolveInteractiveContinuation(options) {
  const direct = buildInteractiveContinuation({
    projectRef: options.projectRef,
    stepResultFile: asString(options.commandOutput.routed_step_result_file) ?? "",
    stepResult: options.commandOutput,
  });
  if (direct) {
    return direct;
  }

  const stepResultFile = asString(options.commandOutput.routed_step_result_file);
  if (!stepResultFile || !fs.existsSync(stepResultFile)) {
    return null;
  }

  try {
    const stepResult = /** @type {Record<string, unknown>} */ (JSON.parse(fs.readFileSync(stepResultFile, "utf8")));
    return buildInteractiveContinuation({
      projectRef: options.projectRef,
      stepResultFile,
      stepResult,
    });
  } catch {
    return null;
  }
}

/**
 * @param {unknown} value
 * @returns {string | true | null}
 */
function normalizeFlagScalar(value) {
  if (value === true) return true;
  if (value === false) return "false";
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

/**
 * @param {Record<string, unknown>} flags
 * @returns {{ ok: true, cliFlags: Record<string, string | true | string[]>, args: string[] } | { ok: false, code: string, message: string }}
 */
function normalizeClientFlags(flags) {
  /** @type {Record<string, string | true | string[]>} */
  const cliFlags = {};
  /** @type {string[]} */
  const args = [];

  for (const [rawKey, rawValue] of Object.entries(flags)) {
    const flagName = toKebabFlag(rawKey);
    if (!flagName || SERVER_OWNED_FLAGS.has(flagName) || SERVER_OWNED_FLAGS.has(rawKey)) {
      return {
        ok: false,
        code: "invalid_lifecycle_flags",
        message: `Flag '${rawKey}' is controlled by the server and cannot be supplied by connected clients.`,
      };
    }

    if (Array.isArray(rawValue)) {
      /** @type {string[]} */
      const values = [];
      for (const entry of rawValue) {
        const scalar = normalizeFlagScalar(entry);
        if (typeof scalar !== "string" || scalar.trim().length === 0) {
          return {
            ok: false,
            code: "invalid_lifecycle_flags",
            message: `Flag '${rawKey}' must contain only non-empty scalar values.`,
          };
        }
        values.push(scalar);
        args.push(`--${flagName}`, scalar);
      }
      cliFlags[flagName] = values;
      continue;
    }

    const scalar = normalizeFlagScalar(rawValue);
    if (scalar === null) {
      return {
        ok: false,
        code: "invalid_lifecycle_flags",
        message: `Flag '${rawKey}' must be a string, number, boolean, or array of scalar values.`,
      };
    }

    cliFlags[flagName] = scalar;
    if (scalar === true) {
      args.push(`--${flagName}`);
    } else if (scalar.trim().length > 0) {
      args.push(`--${flagName}`, scalar);
    }
  }

  return { ok: true, cliFlags, args };
}

/**
 * @param {{ command: string, cliFlags: Record<string, string | true | string[]> }}
 * @returns {{ ok: true } | { ok: false, code: string, message: string }}
 */
function validateRequiredFlags({ command, cliFlags }) {
  const definition = getCommandDefinition(command);
  const requiredFlags = definition?.requiredFlags ?? [];
  for (const flag of requiredFlags) {
    if (flag === "project-ref") {
      continue;
    }
    const value = cliFlags[flag];
    const present =
      typeof value === "string"
        ? value.trim().length > 0
        : Array.isArray(value)
          ? value.some((entry) => entry.trim().length > 0)
          : value === true;
    if (!present) {
      return {
        ok: false,
        code: "invalid_lifecycle_flags",
        message: `Missing required flag '--${flag}' for lifecycle command '${command}'.`,
      };
    }
  }
  return { ok: true };
}

function validateCatalogFlags({ command, cliFlags }) {
  const definition = getCommandDefinition(command);
  const allowed = new Map((definition?.flags ?? []).map((flag) => [flag.name, flag]));
  for (const [name, value] of Object.entries(cliFlags)) {
    const flag = allowed.get(name);
    if (!flag) {
      return { ok: false, code: "invalid_lifecycle_flags", message: `Unknown flag '--${name}' for lifecycle command '${command}'.` };
    }
    if (Array.isArray(value) && flag.repeatable !== true) {
      return { ok: false, code: "invalid_lifecycle_flags", message: `Flag '--${name}' is not repeatable for lifecycle command '${command}'.` };
    }
  }
  return { ok: true };
}

/**
 * @param {string} stdout
 * @returns {Record<string, unknown> | null}
 */
function parseCommandOutput(stdout) {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed);
    return asRecord(parsed);
  } catch {
    return null;
  }
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef: string,
 *   runtimeRoot?: string,
 *   command: string,
 *   flags?: Record<string, unknown>,
 * }}
 */
export function runLifecycleCommand(options) {
  const command = asString(options.command);
  if (!command || !LIFECYCLE_COMMANDS.has(command)) {
    return {
      ok: false,
      statusCode: 400,
      error: lifecycleError("invalid_lifecycle_command", `Unsupported lifecycle command '${command ?? "missing"}'.`, command),
    };
  }

  const definition = getCommandDefinition(command);
  if (!definition || definition.status !== "implemented") {
    return {
      ok: false,
      statusCode: 400,
      error: lifecycleError("invalid_lifecycle_command", `Lifecycle command '${command}' is not implemented in the CLI catalog.`, command),
    };
  }

  const flagResult = normalizeClientFlags(asRecord(options.flags));
  if (!flagResult.ok) {
    return { ok: false, statusCode: 400, error: lifecycleError(flagResult.code, flagResult.message, command) };
  }

  const catalogResult = validateCatalogFlags({ command, cliFlags: flagResult.cliFlags });
  if (!catalogResult.ok) {
    return { ok: false, statusCode: 400, error: lifecycleError(catalogResult.code, catalogResult.message, command) };
  }

  const requiredResult = validateRequiredFlags({ command, cliFlags: flagResult.cliFlags });
  if (!requiredResult.ok) {
    return { ok: false, statusCode: 400, error: lifecycleError(requiredResult.code, requiredResult.message, command) };
  }

  const commandParts = command.split(" ");
  const executionFlags = {
    "project-ref": options.projectRef,
    ...(options.runtimeRoot ? { "runtime-root": options.runtimeRoot } : {}),
    ...(command === "next" && flagResult.cliFlags.json === undefined ? { json: true } : {}),
    ...flagResult.cliFlags,
  };
  const args = [
    ...commandParts,
    "--project-ref",
    options.projectRef,
    ...(options.runtimeRoot ? ["--runtime-root", options.runtimeRoot] : []),
    ...(command === "next" && flagResult.cliFlags.json === undefined ? ["--json"] : []),
    ...flagResult.args,
  ];
  if (command === "run start") {
    const runId = asString(flagResult.cliFlags["run-id"]);
    if (flagResult.cliFlags["workspace-set-ref"] && !runId) {
      return {
        ok: false,
        statusCode: 400,
        error: lifecycleError(
          "invalid_lifecycle_flags",
          "Parent run start requires '--run-id' to match the run-owned workspace set.",
          command,
        ),
      };
    }
    const acceptedRunId = runId ?? derivePublicId(["run", Date.now(), process.pid], "run");
    const workerArgs = runId ? args : [...args, "--run-id", acceptedRunId];
    const started = startRunJob({
      cwd: options.cwd ?? options.projectRef,
      projectRef: options.projectRef,
      runtimeRoot: options.runtimeRoot,
      runId: acceptedRunId,
      args: workerArgs,
    });
    const accepted = {
      command,
      args: workerArgs,
      exit_code: 0,
      stdout: "",
      stderr: "",
      command_output: {
        accepted: true,
        run_id: started.job.run_id,
        job_id: started.job.job_id,
        status: started.job.status,
        revision: started.job.revision,
        status_ref: started.job.status_ref,
        event_ref: started.job.event_ref,
      },
      artifact_refs: [started.file],
      evidence_refs: [started.job.status_ref, started.job.event_ref],
      blocked: false,
      blocked_reason: null,
      interactive_continuation: null,
      accepted: true,
      job: started.job,
    };
    return { ok: true, statusCode: 202, accepted: true, result: accepted };
  }
  let run;
  try {
    run = executeImplementedCommand(command, executionFlags, options.cwd ?? options.projectRef);
  } catch (error) {
    run = { exitCode: 1, stdout: "", stderr: `${error instanceof Error ? error.message : String(error)}\n` };
  }
  const exitCode = run.exitCode;
  const stdout = run.stdout ?? "";
  const stderr = run.stderr ?? "";
  const commandOutput = parseCommandOutput(stdout);
  const refs = commandOutput ? collectOutputRefs(commandOutput) : { artifactRefs: [], evidenceRefs: [] };
  const blocked = commandOutput ? detectBlockedOutput(commandOutput) : { blocked: false, blockingFields: [], blockingReasons: [] };
  const interactiveContinuation = commandOutput
    ? resolveInteractiveContinuation({ projectRef: options.projectRef, commandOutput })
    : null;

  const response = {
    command,
    args,
    exit_code: exitCode,
    stdout,
    stderr,
    command_output: commandOutput,
    artifact_refs: refs.artifactRefs,
    evidence_refs: refs.evidenceRefs,
    blocked: exitCode !== 0 || blocked.blocked || Boolean(interactiveContinuation),
    blocked_reason:
      interactiveContinuation
        ? {
            code: "lifecycle_command.interaction_required",
            message: "Lifecycle command produced a runner-requested interaction that must be answered before continuation.",
          }
        : exitCode !== 0
          ? {
              code: "lifecycle_command.failed",
              message: stderr.trim() || "Lifecycle command failed before producing a successful command output.",
            }
          : blocked.blocked
            ? {
                code: "lifecycle_command.blocked",
                message: "Lifecycle command reported a blocked runtime branch.",
                blocking_fields: blocked.blockingFields,
                blocking_reasons: blocked.blockingReasons,
              }
            : null,
    interactive_continuation: interactiveContinuation,
  };

  if (response.blocked) {
    const reason = /** @type {{ code?: string, message?: string }} */ (response.blocked_reason ?? {});
    return {
      ok: false,
      statusCode: 409,
      error: lifecycleError(reason.code ?? "lifecycle_command.blocked", reason.message ?? "Lifecycle command blocked.", command),
      result: response,
    };
  }

  return {
    ok: true,
    result: response,
  };
}
