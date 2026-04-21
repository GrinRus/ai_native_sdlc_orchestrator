import fs from "node:fs";
import path from "node:path";

import { getContractFamilyIndex } from "../../../packages/contracts/src/index.mjs";
import {
  approveHandoffArtifacts,
  prepareHandoffArtifacts,
} from "../../../packages/orchestrator-core/src/handoff-packets.mjs";
import { analyzeProjectRuntime } from "../../../packages/orchestrator-core/src/project-analysis.mjs";
import { initializeProjectRuntime } from "../../../packages/orchestrator-core/src/project-init.mjs";
import { validateProjectRuntime } from "../../../packages/orchestrator-core/src/project-validate.mjs";
import { verifyProjectRuntime } from "../../../packages/orchestrator-core/src/project-verify.mjs";
import { executeRoutedStep } from "../../../packages/orchestrator-core/src/step-execution-engine.mjs";

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
            "- --route-overrides accepts comma-separated step overrides like planning=route.plan.default.",
            "- --policy-overrides accepts comma-separated step overrides like planning=policy.step.planner.default.",
            "- Analyze emits route, asset, and policy resolution reports for downstream execution planning.",
          ]
      : definition.command === "project validate"
        ? [
            "- --project-ref must point to an existing directory.",
            "- --project-profile can override default profile discovery in project root.",
            `- --runtime-root defaults to '${RUNTIME_ROOT_DIRNAME}' from profile runtime defaults.`,
            "- Validation report status can be pass, warn, or fail.",
            "- --require-approved-handoff enforces approved handoff gate for execution-style readiness.",
          ]
      : definition.command === "project verify"
        ? [
            "- --project-ref must point to an existing directory.",
            "- --require-validation-pass enforces validation gate before verify can proceed.",
            "- --routed-dry-run-step executes one routed dry-run step and writes a durable step-result artifact.",
            `- --runtime-root defaults to '${RUNTIME_ROOT_DIRNAME}' under the resolved project ref.`,
          ]
      : definition.command === "handoff prepare"
        ? [
            "- --project-ref must point to an existing directory.",
            "- --approved-artifact defaults to bootstrap artifact packet under runtime artifacts root.",
            "- The generated handoff packet is pending approval until 'handoff approve' runs.",
          ]
      : definition.command === "handoff approve"
        ? [
            "- --approval-ref is required and becomes machine-checkable approval evidence.",
            "- --handoff-packet is optional and defaults to bootstrap handoff packet path.",
            "- Approval sets handoff status to approved for downstream execution validation gates.",
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
 * @param {string | true | undefined} value
 * @returns {Record<string, string> | undefined}
 */
function resolveRouteOverridesFlag(value) {
  if (value === undefined) return undefined;
  if (value === true) {
    throw new CliUsageError("Flag '--route-overrides' requires a value.");
  }

  /** @type {Record<string, string>} */
  const overrides = {};
  const pairs = value
    .split(",")
    .map((pair) => pair.trim())
    .filter((pair) => pair.length > 0);

  for (const pair of pairs) {
    const [step, routeId, remainder] = pair.split("=");
    if (!step || !routeId || remainder !== undefined) {
      throw new CliUsageError(
        `Invalid route override '${pair}'. Use '--route-overrides step=route_id[,step=route_id]'.`,
      );
    }

    const normalizedStep = step.trim();
    const normalizedRouteId = routeId.trim();
    if (normalizedStep.length === 0 || normalizedRouteId.length === 0) {
      throw new CliUsageError(
        `Invalid route override '${pair}'. Step and route_id must both be non-empty.`,
      );
    }
    if (Object.prototype.hasOwnProperty.call(overrides, normalizedStep)) {
      throw new CliUsageError(`Duplicate route override for step '${normalizedStep}'.`);
    }

    overrides[normalizedStep] = normalizedRouteId;
  }

  return overrides;
}

/**
 * @param {string | true | undefined} value
 * @returns {Record<string, string> | undefined}
 */
function resolvePolicyOverridesFlag(value) {
  if (value === undefined) return undefined;
  if (value === true) {
    throw new CliUsageError("Flag '--policy-overrides' requires a value.");
  }

  /** @type {Record<string, string>} */
  const overrides = {};
  const pairs = value
    .split(",")
    .map((pair) => pair.trim())
    .filter((pair) => pair.length > 0);

  for (const pair of pairs) {
    const [step, policyId, remainder] = pair.split("=");
    if (!step || !policyId || remainder !== undefined) {
      throw new CliUsageError(
        `Invalid policy override '${pair}'. Use '--policy-overrides step=policy_id[,step=policy_id]'.`,
      );
    }

    const normalizedStep = step.trim();
    const normalizedPolicyId = policyId.trim();
    if (normalizedStep.length === 0 || normalizedPolicyId.length === 0) {
      throw new CliUsageError(
        `Invalid policy override '${pair}'. Step and policy_id must both be non-empty.`,
      );
    }
    if (Object.prototype.hasOwnProperty.call(overrides, normalizedStep)) {
      throw new CliUsageError(`Duplicate policy override for step '${normalizedStep}'.`);
    }

    overrides[normalizedStep] = normalizedPolicyId;
  }

  return overrides;
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
  let routeResolutionFile = null;
  let routeResolutionSteps = null;
  let assetResolutionFile = null;
  let assetResolutionSteps = null;
  let policyResolutionFile = null;
  let policyResolutionSteps = null;
  let evaluationRegistryFile = null;
  let evaluationRegistrySuites = null;
  let evaluationRegistryDatasets = null;
  let validationReportId = null;
  let validationReportFile = null;
  let validationStatus = null;
  let validationBlocking = null;
  let validationGateEnforced = false;
  let validationGateStatus = null;
  let handoffGateEnforced = false;
  let handoffGateStatus = null;
  let handoffGateBlocking = null;
  let handoffPacketFile = null;
  let handoffPacketId = null;
  let handoffStatus = null;
  let handoffApprovalState = null;
  let waveTicketId = null;
  let waveTicketFile = null;
  let artifactPacketId = null;
  let artifactPacketFile = null;
  let verifySummaryFile = null;
  let verifyStepResultFiles = null;
  let routedStepResultId = null;
  let routedStepResultFile = null;

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
    artifactPacketId = initResult.artifactPacketId;
    artifactPacketFile = initResult.artifactPacketFile;
  } else if (command === "project analyze") {
    ensureRequiredFlags(command, flags);
    const routeOverrides = resolveRouteOverridesFlag(flags["route-overrides"]);
    const policyOverrides = resolvePolicyOverridesFlag(flags["policy-overrides"]);

    const analyzeResult = analyzeProjectRuntime({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      projectProfile: resolveOptionalStringFlag("project-profile", flags["project-profile"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
      routeOverrides,
      policyOverrides,
    });

    resolvedProjectRef = analyzeResult.projectRoot;
    resolvedRuntimeRoot = analyzeResult.runtimeRoot;
    runtimeLayout = analyzeResult.runtimeLayout;
    runtimeStateFile = analyzeResult.stateFile;
    projectProfileRef = analyzeResult.projectProfileRef;
    analysisReportId = analyzeResult.report.report_id;
    analysisReportFile = analyzeResult.reportPath;
    routeResolutionFile = analyzeResult.routeResolutionPath;
    routeResolutionSteps = analyzeResult.routeResolutionMatrix;
    assetResolutionFile = analyzeResult.assetResolutionPath;
    assetResolutionSteps = analyzeResult.assetResolutionMatrix;
    policyResolutionFile = analyzeResult.policyResolutionPath;
    policyResolutionSteps = analyzeResult.policyResolutionMatrix;
    evaluationRegistryFile = analyzeResult.evaluationRegistryPath;
    evaluationRegistrySuites = analyzeResult.evaluationRegistry.suites;
    evaluationRegistryDatasets = analyzeResult.evaluationRegistry.datasets;
  } else if (command === "project validate") {
    ensureRequiredFlags(command, flags);
    handoffGateEnforced = resolveOptionalBooleanFlag(
      "require-approved-handoff",
      flags["require-approved-handoff"],
    );

    const validateResult = validateProjectRuntime({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      projectProfile: resolveOptionalStringFlag("project-profile", flags["project-profile"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
      requireApprovedHandoff: handoffGateEnforced,
      handoffPacketPath: resolveOptionalStringFlag("handoff-packet", flags["handoff-packet"]),
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
    handoffGateStatus = validateResult.handoffGateStatus;
    handoffGateBlocking = validateResult.handoffGateBlocking;
    handoffPacketFile = validateResult.handoffPacketFile;
  } else if (command === "project verify") {
    ensureRequiredFlags(command, flags);

    validationGateEnforced = resolveOptionalBooleanFlag(
      "require-validation-pass",
      flags["require-validation-pass"],
    );

    const verifyResult = verifyProjectRuntime({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      projectProfile: resolveOptionalStringFlag("project-profile", flags["project-profile"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
      requireValidationPass: validationGateEnforced,
    });

    resolvedProjectRef = verifyResult.projectRoot;
    resolvedRuntimeRoot = verifyResult.runtimeRoot;
    runtimeLayout = verifyResult.runtimeLayout;
    runtimeStateFile = verifyResult.stateFile;
    projectProfileRef = verifyResult.projectProfileRef;
    validationGateStatus = verifyResult.validationGateStatus;
    verifySummaryFile = verifyResult.verifySummaryPath;
    verifyStepResultFiles = verifyResult.stepResultFiles;

    const routedDryRunStep = resolveOptionalStringFlag("routed-dry-run-step", flags["routed-dry-run-step"]);
    if (routedDryRunStep) {
      const routedResult = executeRoutedStep({
        cwd,
        projectRef: /** @type {string} */ (flags["project-ref"]),
        projectProfile: resolveOptionalStringFlag("project-profile", flags["project-profile"]),
        runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
        stepClass: routedDryRunStep,
        dryRun: true,
      });

      routedStepResultId = routedResult.stepResultId;
      routedStepResultFile = routedResult.stepResultPath;
      verifyStepResultFiles = [...verifyResult.stepResultFiles, routedResult.stepResultPath];
    }
  } else if (command === "handoff prepare") {
    ensureRequiredFlags(command, flags);

    const prepareResult = prepareHandoffArtifacts({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      projectProfile: resolveOptionalStringFlag("project-profile", flags["project-profile"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
      ticketId: resolveOptionalStringFlag("ticket-id", flags["ticket-id"]),
      approvedArtifactPath: resolveOptionalStringFlag("approved-artifact", flags["approved-artifact"]),
    });

    resolvedProjectRef = prepareResult.projectRoot;
    resolvedRuntimeRoot = prepareResult.runtimeRoot;
    runtimeLayout = prepareResult.runtimeLayout;
    runtimeStateFile = prepareResult.stateFile;
    projectProfileRef = prepareResult.projectProfileRef;
    waveTicketId = prepareResult.waveTicket.ticket_id;
    waveTicketFile = prepareResult.waveTicketFile;
    handoffPacketId = prepareResult.handoffPacket.packet_id;
    handoffPacketFile = prepareResult.handoffPacketFile;
    handoffStatus = prepareResult.handoffPacket.status;
    handoffApprovalState = prepareResult.handoffPacket.approval_state;
  } else if (command === "handoff approve") {
    ensureRequiredFlags(command, flags);
    const approvalRef = resolveOptionalStringFlag("approval-ref", flags["approval-ref"]);
    if (!approvalRef) {
      throw new CliUsageError("Missing required flag '--approval-ref' for 'aor handoff approve'.");
    }

    const approveResult = approveHandoffArtifacts({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
      handoffPacketPath: resolveOptionalStringFlag("handoff-packet", flags["handoff-packet"]),
      approvalRef,
    });

    resolvedProjectRef = approveResult.projectRoot;
    resolvedRuntimeRoot = approveResult.runtimeRoot;
    runtimeLayout = approveResult.runtimeLayout;
    runtimeStateFile = approveResult.stateFile;
    projectProfileRef = approveResult.projectProfileRef;
    handoffPacketId = approveResult.handoffPacket.packet_id;
    handoffPacketFile = approveResult.handoffPacketFile;
    handoffStatus = approveResult.handoffPacket.status;
    handoffApprovalState = approveResult.handoffPacket.approval_state;
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
    route_resolution_file: routeResolutionFile,
    route_resolution_steps: routeResolutionSteps,
    asset_resolution_file: assetResolutionFile,
    asset_resolution_steps: assetResolutionSteps,
    policy_resolution_file: policyResolutionFile,
    policy_resolution_steps: policyResolutionSteps,
    evaluation_registry_file: evaluationRegistryFile,
    evaluation_registry_suites: evaluationRegistrySuites,
    evaluation_registry_datasets: evaluationRegistryDatasets,
    validation_report_id: validationReportId,
    validation_report_file: validationReportFile,
    validation_status: validationStatus,
    validation_blocking: validationBlocking,
    validation_gate_enforced: validationGateEnforced,
    validation_gate_status: validationGateStatus,
    handoff_gate_enforced: handoffGateEnforced,
    handoff_gate_status: handoffGateStatus,
    handoff_gate_blocking: handoffGateBlocking,
    handoff_packet_id: handoffPacketId,
    handoff_packet_file: handoffPacketFile,
    handoff_status: handoffStatus,
    handoff_approval_state: handoffApprovalState,
    wave_ticket_id: waveTicketId,
    wave_ticket_file: waveTicketFile,
    artifact_packet_id: artifactPacketId,
    artifact_packet_file: artifactPacketFile,
    verify_summary_file: verifySummaryFile,
    step_result_files: verifyStepResultFiles,
    routed_step_result_id: routedStepResultId,
    routed_step_result_file: routedStepResultFile,
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
