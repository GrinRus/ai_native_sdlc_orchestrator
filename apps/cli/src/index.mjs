import fs from "node:fs";
import path from "node:path";

import { getContractFamilyIndex } from "../../../packages/contracts/src/index.mjs";
import { analyzeProjectRuntime } from "../../../packages/orchestrator-core/src/project-analysis.mjs";
import { initializeProjectRuntime } from "../../../packages/orchestrator-core/src/project-init.mjs";
import { validateProjectRuntime } from "../../../packages/orchestrator-core/src/project-validate.mjs";

import {
  RUNTIME_ROOT_DIRNAME,
  getCommandDefinition,
  getImplementedCommands,
  getPlannedCommands,
} from "./command-catalog.mjs";

class CliUsageError extends Error {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(message);
    this.name = "CliUsageError";
  }
}

/**
 * @typedef {{
 *   exitCode: number,
 *   stdout: string,
 *   stderr: string,
 * }} CliResult
 */

/**
 * @param {string} value
 * @returns {boolean}
 */
function isHelpFlag(value) {
  return value === "-h" || value === "--help" || value === "help";
}

/**
 * @param {string[]} args
 * @returns {Record<string, string | true>}
 */
function parseFlags(args) {
  /** @type {Record<string, string | true>} */
  const flags = {};

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (!current.startsWith("--")) {
      throw new CliUsageError(`Unexpected argument '${current}'. Flags must use --name <value>.`);
    }

    const [rawName, inlineValue] = current.split("=", 2);
    const flagName = rawName.slice(2);

    if (!flagName) {
      throw new CliUsageError(`Invalid flag '${current}'.`);
    }

    if (Object.prototype.hasOwnProperty.call(flags, flagName)) {
      throw new CliUsageError(`Duplicate flag '--${flagName}'.`);
    }

    if (inlineValue !== undefined) {
      flags[flagName] = inlineValue;
      continue;
    }

    const next = args[index + 1];
    if (next && !next.startsWith("--")) {
      flags[flagName] = next;
      index += 1;
      continue;
    }

    flags[flagName] = true;
  }

  return flags;
}

/**
 * @param {{ command: string, summary?: string, inputs?: string[], outputs?: string[], contractFamilies?: string[] }} definition
 * @returns {string}
 */
function formatCommandHelp(definition) {
  const notes =
    definition.command === "project init"
      ? [
          "- --project-ref is optional. When omitted, the command discovers repo root from cwd.",
          "- --project-profile can override default profile discovery in project root.",
          `- --runtime-root defaults to '${RUNTIME_ROOT_DIRNAME}' from profile runtime defaults.`,
        ]
      : definition.command === "project analyze"
        ? [
            "- --project-ref must point to an existing directory.",
            "- --project-profile can override default profile discovery in project root.",
            `- --runtime-root defaults to '${RUNTIME_ROOT_DIRNAME}' from profile runtime defaults.`,
          ]
      : definition.command === "project validate"
        ? [
            "- --project-ref must point to an existing directory.",
            "- --project-profile can override default profile discovery in project root.",
            `- --runtime-root defaults to '${RUNTIME_ROOT_DIRNAME}' from profile runtime defaults.`,
            "- Validation report status can be pass, warn, or fail.",
          ]
      : definition.command === "project verify"
        ? [
            "- --project-ref must point to an existing directory.",
            "- --require-validation-pass enforces validation gate before verify can proceed.",
            `- --runtime-root defaults to '${RUNTIME_ROOT_DIRNAME}' under the resolved project ref.`,
          ]
      : [
          "- --project-ref must point to an existing directory.",
          `- --runtime-root defaults to '${RUNTIME_ROOT_DIRNAME}' under the resolved project ref.`,
        ];

  const lines = [
    `aor ${definition.command}`,
    definition.summary ?? "No summary available.",
    "",
    "Status: implemented in bootstrap shell (W1-S01)",
    `Inputs: ${(definition.inputs ?? []).join(", ")}`,
    `Outputs: ${(definition.outputs ?? []).join(", ")}`,
    `Contract families: ${(definition.contractFamilies ?? []).join(", ") || "none"}`,
    "",
    "Notes:",
    ...notes,
  ];

  return `${lines.join("\n")}\n`;
}

/**
 * @returns {string}
 */
function formatTopLevelHelp() {
  const implementedLines = getImplementedCommands().map(
    (definition) => `  - aor ${definition.command}`,
  );
  const plannedLines = getPlannedCommands().map((definition) => `  - aor ${definition.command}`);

  const lines = [
    "AOR CLI command surface",
    "",
    "Implemented bootstrap commands (W1-S01):",
    ...implementedLines,
    "",
    "Planned commands (not implemented yet):",
    ...plannedLines,
    "",
    "Use 'aor <group> <command> --help' for implemented command contracts.",
  ];

  return `${lines.join("\n")}\n`;
}

/**
 * @param {string} command
 * @param {Record<string, string | true>} flags
 */
function ensureRequiredFlags(command, flags) {
  const definition = getCommandDefinition(command);
  const requiredFlags = definition?.requiredFlags ?? [];

  for (const required of requiredFlags) {
    const value = flags[required];
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new CliUsageError(`Missing required flag '--${required}' for 'aor ${command}'.`);
    }
  }
}

/**
 * @param {string} flagName
 * @param {string | true | undefined} value
 * @returns {string | undefined}
 */
function resolveOptionalStringFlag(flagName, value) {
  if (value === undefined) return undefined;
  if (value === true) {
    throw new CliUsageError(`Flag '--${flagName}' requires a value.`);
  }
  if (value.trim().length === 0) {
    throw new CliUsageError(`Flag '--${flagName}' cannot be empty.`);
  }
  return value;
}

/**
 * @param {string} flagName
 * @param {string | true | undefined} value
 * @returns {boolean}
 */
function resolveOptionalBooleanFlag(flagName, value) {
  if (value === undefined) return false;
  if (value === true) return true;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new CliUsageError(`Flag '--${flagName}' accepts only boolean values ('true' or 'false').`);
}

/**
 * @param {string} reportPath
 * @returns {string}
 */
function readValidationReportStatus(reportPath) {
  if (!fs.existsSync(reportPath)) {
    throw new CliUsageError(
      `Validation gate requires '${reportPath}', but no validation report was found. Run 'aor project validate' first.`,
    );
  }

  const parsed = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  const status = parsed.status;

  if (typeof status !== "string") {
    throw new CliUsageError(`Validation report '${reportPath}' is missing a valid status field.`);
  }

  return status;
}

/**
 * @param {string} projectRef
 * @param {string} cwd
 * @returns {string}
 */
function resolveProjectRef(projectRef, cwd) {
  const resolved = path.resolve(cwd, projectRef);
  if (!fs.existsSync(resolved)) {
    throw new CliUsageError(`Invalid --project-ref '${projectRef}': path does not exist.`);
  }

  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) {
    throw new CliUsageError(`Invalid --project-ref '${projectRef}': expected a directory.`);
  }

  return resolved;
}

/**
 * @param {string | true | undefined} runtimeRootFlag
 * @param {string} projectRoot
 * @returns {string}
 */
function resolveRuntimeRoot(runtimeRootFlag, projectRoot) {
  if (runtimeRootFlag === true) {
    throw new CliUsageError("Flag '--runtime-root' requires a value.");
  }

  if (!runtimeRootFlag) {
    return path.join(projectRoot, RUNTIME_ROOT_DIRNAME);
  }

  return path.isAbsolute(runtimeRootFlag)
    ? runtimeRootFlag
    : path.resolve(projectRoot, runtimeRootFlag);
}

/**
 * @param {string[]} args
 * @returns {{ type: "top-help" } | { type: "command-help", command: string } | { type: "execute", command: string, flags: Record<string, string | true> }}
 */
function parseInvocation(args) {
  if (args.length === 0 || isHelpFlag(args[0])) {
    return { type: "top-help" };
  }

  const [group, verb, ...rest] = args;
  if (!verb || isHelpFlag(verb)) {
    throw new CliUsageError("Command must be '<group> <command>'. Use '--help' for catalog output.");
  }

  const command = `${group} ${verb}`;
  const definition = getCommandDefinition(command);
  if (!definition) {
    throw new CliUsageError(`Unknown command '${command}'. Use '--help' to see available commands.`);
  }

  const flags = parseFlags(rest);

  if (flags.help === true) {
    return { type: "command-help", command };
  }

  return { type: "execute", command, flags };
}

/**
 * @param {string} command
 * @param {Record<string, string | true>} flags
 * @param {string} cwd
 * @returns {CliResult}
 */
function executeImplementedCommand(command, flags, cwd) {
  const definition = getCommandDefinition(command);
  if (!definition) {
    throw new CliUsageError(`Unknown command '${command}'.`);
  }

  if (definition.status !== "implemented") {
    throw new CliUsageError(`Command 'aor ${command}' is planned and not implemented yet.`);
  }

  let resolvedProjectRef = null;
  let resolvedRuntimeRoot = null;
  let runtimeLayout = null;
  let runtimeStateFile = null;
  let projectProfileRef = null;
  let analysisReportId = null;
  let analysisReportFile = null;
  let validationReportId = null;
  let validationReportFile = null;
  let validationStatus = null;
  let validationBlocking = null;
  let validationGateEnforced = false;
  let validationGateStatus = null;

  if (command === "project init") {
    const initResult = initializeProjectRuntime({
      cwd,
      projectRef: resolveOptionalStringFlag("project-ref", flags["project-ref"]),
      projectProfile: resolveOptionalStringFlag("project-profile", flags["project-profile"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
    });

    resolvedProjectRef = initResult.projectRoot;
    resolvedRuntimeRoot = initResult.runtimeRoot;
    runtimeLayout = initResult.runtimeLayout;
    runtimeStateFile = initResult.stateFile;
    projectProfileRef = initResult.projectProfileRef;
  } else if (command === "project analyze") {
    ensureRequiredFlags(command, flags);

    const analyzeResult = analyzeProjectRuntime({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      projectProfile: resolveOptionalStringFlag("project-profile", flags["project-profile"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
    });

    resolvedProjectRef = analyzeResult.projectRoot;
    resolvedRuntimeRoot = analyzeResult.runtimeRoot;
    runtimeLayout = analyzeResult.runtimeLayout;
    runtimeStateFile = analyzeResult.stateFile;
    projectProfileRef = analyzeResult.projectProfileRef;
    analysisReportId = analyzeResult.report.report_id;
    analysisReportFile = analyzeResult.reportPath;
  } else if (command === "project validate") {
    ensureRequiredFlags(command, flags);

    const validateResult = validateProjectRuntime({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      projectProfile: resolveOptionalStringFlag("project-profile", flags["project-profile"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
    });

    resolvedProjectRef = validateResult.projectRoot;
    resolvedRuntimeRoot = validateResult.runtimeRoot;
    runtimeLayout = validateResult.runtimeLayout;
    runtimeStateFile = validateResult.stateFile;
    projectProfileRef = validateResult.projectProfileRef;
    validationReportId = validateResult.report.report_id;
    validationReportFile = validateResult.validationReportPath;
    validationStatus = validateResult.report.status;
    validationBlocking = validateResult.blocking;
  } else if (command === "project verify") {
    ensureRequiredFlags(command, flags);

    const verifyInit = initializeProjectRuntime({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      projectProfile: resolveOptionalStringFlag("project-profile", flags["project-profile"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
    });

    resolvedProjectRef = verifyInit.projectRoot;
    resolvedRuntimeRoot = verifyInit.runtimeRoot;
    runtimeLayout = verifyInit.runtimeLayout;
    runtimeStateFile = verifyInit.stateFile;
    projectProfileRef = verifyInit.projectProfileRef;

    validationGateEnforced = resolveOptionalBooleanFlag(
      "require-validation-pass",
      flags["require-validation-pass"],
    );

    if (validationGateEnforced) {
      const gateReportPath = path.join(verifyInit.runtimeLayout.reportsRoot, "validation-report.json");
      validationGateStatus = readValidationReportStatus(gateReportPath);

      if (validationGateStatus === "fail") {
        throw new CliUsageError(
          `Validation gate blocked verify flow because '${gateReportPath}' has status 'fail'.`,
        );
      }
    }
  } else {
    ensureRequiredFlags(command, flags);

    const projectRefInput = /** @type {string} */ (flags["project-ref"]);
    resolvedProjectRef = resolveProjectRef(projectRefInput, cwd);
    resolvedRuntimeRoot = resolveRuntimeRoot(flags["runtime-root"], resolvedProjectRef);
  }

  const contractIndex = getContractFamilyIndex();
  const resolvedFamilies = (definition.contractFamilies ?? []).map((family) => {
    const entry = contractIndex.find((candidate) => candidate.family === family);
    if (!entry) {
      throw new CliUsageError(`Contract family '${family}' is missing from the contract loader index.`);
    }

    return {
      family: entry.family,
      group: entry.familyGroup,
      source_contract: entry.sourceContract,
      status: entry.status,
    };
  });

  const output = {
    command,
    status: "implemented",
    resolved_project_ref: resolvedProjectRef,
    resolved_runtime_root: resolvedRuntimeRoot,
    project_profile_ref: projectProfileRef,
    runtime_layout: runtimeLayout,
    runtime_state_file: runtimeStateFile,
    analysis_report_id: analysisReportId,
    analysis_report_file: analysisReportFile,
    validation_report_id: validationReportId,
    validation_report_file: validationReportFile,
    validation_status: validationStatus,
    validation_blocking: validationBlocking,
    validation_gate_enforced: validationGateEnforced,
    validation_gate_status: validationGateStatus,
    contract_families: resolvedFamilies,
    command_catalog_alignment: "docs/architecture/14-cli-command-catalog.md",
  };

  return {
    exitCode: 0,
    stdout: `${JSON.stringify(output, null, 2)}\n`,
    stderr: "",
  };
}

/**
 * @param {string[]} args
 * @param {{ cwd?: string }} [options]
 * @returns {CliResult}
 */
export function invokeCli(args, options = {}) {
  const cwd = options.cwd ?? process.cwd();

  try {
    const invocation = parseInvocation(args);

    if (invocation.type === "top-help") {
      return {
        exitCode: 0,
        stdout: formatTopLevelHelp(),
        stderr: "",
      };
    }

    if (invocation.type === "command-help") {
      const definition = getCommandDefinition(invocation.command);
      if (!definition) {
        throw new CliUsageError(`Unknown command '${invocation.command}'.`);
      }

      if (definition.status !== "implemented") {
        return {
          exitCode: 0,
          stdout: `aor ${invocation.command}\nStatus: planned (not implemented yet)\n`,
          stderr: "",
        };
      }

      return {
        exitCode: 0,
        stdout: formatCommandHelp(definition),
        stderr: "",
      };
    }

    return executeImplementedCommand(invocation.command, invocation.flags, cwd);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      exitCode: 1,
      stdout: "",
      stderr: `${message}\n`,
    };
  }
}

/**
 * @param {string[]} args
 * @param {{ cwd?: string, stdout?: NodeJS.WriteStream, stderr?: NodeJS.WriteStream }} [options]
 * @returns {number}
 */
export function runCli(args, options = {}) {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;

  const result = invokeCli(args, options);

  if (result.stdout) {
    stdout.write(result.stdout);
  }
  if (result.stderr) {
    stderr.write(result.stderr);
  }

  return result.exitCode;
}
