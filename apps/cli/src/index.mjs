import fs from "node:fs";
import path from "node:path";

import {
  applyRunControlAction,
  attachUiLifecycle,
  detachUiLifecycle,
  listDeliveryManifests,
  listPacketArtifacts,
  listPromotionDecisions,
  listQualityArtifacts,
  listRuns,
  listStepResults,
  readStrategicSnapshot,
  openRunEventStream,
  readUiLifecycleState,
  readProjectState,
} from "../../api/src/index.mjs";
import { getContractFamilyIndex, validateContractDocument } from "../../../packages/contracts/src/index.mjs";
import {
  approveHandoffArtifacts,
  prepareHandoffArtifacts,
} from "../../../packages/orchestrator-core/src/handoff-packets.mjs";
import { certifyAssetPromotion } from "../../../packages/orchestrator-core/src/certification-decision.mjs";
import { runDeliveryDriver } from "../../../packages/orchestrator-core/src/delivery-driver.mjs";
import {
  materializeDeliveryPlan,
  normalizeDeliveryMode,
} from "../../../packages/orchestrator-core/src/delivery-plan.mjs";
import { runEvaluationSuite } from "../../../packages/orchestrator-core/src/eval-runner.mjs";
import { applyIncidentRecertification } from "../../../packages/observability/src/index.mjs";
import { resolveStepPolicyForStep } from "../../../packages/orchestrator-core/src/policy-resolution.mjs";
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
import {
  abortStandardLiveE2ERun,
  readStandardLiveE2ERun,
  startStandardLiveE2ERun,
} from "./live-e2e-runner.mjs";

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
  const statusLine =
    definition.command === "eval run"
      ? "Status: implemented in quality shell (W3-S03)"
      : definition.command === "harness certify"
        ? "Status: implemented in quality shell (W3-S05)"
      : definition.command === "intake create" ||
            definition.command === "discovery run" ||
            definition.command === "spec build" ||
            definition.command === "wave create"
          ? "Status: implemented in intake and planning shell (W6-S02)"
        : definition.command === "run start" ||
            definition.command === "run pause" ||
            definition.command === "run resume" ||
            definition.command === "run steer" ||
            definition.command === "run cancel"
          ? "Status: implemented in run-control shell (W6-S03)"
        : definition.command === "run status" ||
            definition.command === "packet show" ||
            definition.command === "evidence show"
          ? "Status: implemented in operator shell (W5-S03)"
        : definition.command === "deliver prepare" || definition.command === "release prepare"
          ? "Status: implemented in delivery/release shell (W6-S05)"
        : definition.command === "incident recertify"
          ? "Status: implemented in incident recertification shell (W7-S03)"
        : definition.command === "incident open" ||
            definition.command === "incident show" ||
            definition.command === "audit runs"
          ? "Status: implemented in incident/audit shell (W6-S06)"
        : definition.command === "ui attach" || definition.command === "ui detach"
          ? "Status: implemented in UI lifecycle shell (W6-S04)"
          : definition.command === "live-e2e start" ||
              definition.command === "live-e2e status" ||
              definition.command === "live-e2e report"
            ? "Status: implemented in live E2E shell (W5-S05)"
          : "Status: implemented in bootstrap shell (W1-S01)";
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
      : definition.command === "eval run"
        ? [
            "- --project-ref must point to an existing directory.",
            "- --subject-ref is required and must use '<subject_type>://<target>' format.",
            "- --suite-ref is optional and falls back to eval_policy.default_release_suite_ref.",
            "- Eval run is offline and independent from delivery automation.",
            `- --runtime-root defaults to '${RUNTIME_ROOT_DIRNAME}' under the resolved project ref.`,
          ]
      : definition.command === "harness certify"
        ? [
            "- --asset-ref is the asset being promoted (for example wrapper://..., route://..., prompt-bundle://...).",
            "- --subject-ref defines the eval/harness subject family used to produce evidence.",
            "- Certification combines validation report + eval report + harness capture + harness replay into one promotion-decision.",
            "- Stable/frozen/demoted transitions require baseline-comparison evidence.",
            "- Freeze transitions require explicit regression evidence before rollout action becomes 'freeze'.",
            "- Status semantics are pass, hold, or fail.",
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
        : definition.command === "intake create"
          ? [
              "- --project-ref must point to an existing directory.",
              "- Intake create initializes runtime layout and writes the bootstrap artifact-packet.",
              `- --runtime-root defaults to '${RUNTIME_ROOT_DIRNAME}' under the resolved project ref.`,
            ]
          : definition.command === "discovery run"
            ? [
                "- --project-ref must point to an existing directory.",
                "- Discovery run materializes project-analysis plus route/asset/policy/eval registry reports.",
                "- --route-overrides and --policy-overrides accept comma-separated step overrides.",
              ]
            : definition.command === "spec build"
              ? [
                  "- --project-ref must point to an existing directory.",
                  "- Spec build runs routed dry-run step execution for step_class 'spec'.",
                  "- Output includes a durable step-result artifact under runtime reports.",
                ]
              : definition.command === "wave create"
                ? [
                    "- --project-ref must point to an existing directory.",
                    "- Wave create writes wave-ticket and pending handoff-packet artifacts.",
                    "- Use 'aor handoff approve' to promote approval_state before execution-style flows.",
                  ]
          : definition.command === "run start"
            ? [
                "- Starts one deterministic run-control lifecycle and emits live-run events.",
                "- --run-id is optional; when omitted, CLI generates a bounded run id.",
                "- High-risk guardrails still apply when policy requires approval evidence.",
              ]
            : definition.command === "run pause"
              ? [
                  "- Pause transitions only from running state; repeated pause attempts are blocked.",
                  "- Command writes durable control audit evidence even when blocked.",
                  "- Use run resume, run steer, or run cancel for next control actions.",
                ]
              : definition.command === "run resume"
                ? [
                    "- Resume transitions only from paused state; resume on running run is blocked.",
                    "- Command writes durable control audit evidence even when blocked.",
                    "- Use run status --follow for live stream observation after resume.",
                  ]
                : definition.command === "run steer"
                  ? [
                      "- --target-step is required to keep control scope explicit and auditable.",
                      "- High-risk steer requires --approval-ref when policy guardrails demand approval.",
                      "- Successful steer keeps deterministic status while recording target_step intent.",
                    ]
                  : definition.command === "run cancel"
                    ? [
                        "- Cancel transitions only from running or paused state.",
                        "- High-risk cancel requires --approval-ref when policy guardrails demand approval.",
                        "- Command emits terminal control-plane event and durable control audit evidence.",
                      ]
          : definition.command === "run status"
            ? [
                "- This command is read-only. It does not mutate run state.",
                "- --follow=true requires --run-id and reuses the shared live-run event stream protocol.",
                "- Use run start/pause/resume/steer/cancel for bounded control actions.",
              ]
      : definition.command === "packet show"
            ? [
                "- This command is read-only and resolves packet artifacts through the API read surface.",
                "- --family filters contract families (artifact-packet, wave-ticket, handoff-packet, delivery-plan, delivery-manifest, release-packet).",
                "- Use deliver/release prepare to materialize policy-bounded delivery and release artifacts.",
              ]
            : definition.command === "deliver prepare"
              ? [
                  "- Delivery prepare resolves policy bounds and materializes a delivery-plan before driver execution.",
                  "- --mode supports aliases (read-only -> no-write, patch -> patch-only, branch -> local-branch, fork-pr -> fork-first-pr).",
                  "- Non-no-write modes require approved handoff and promotion evidence refs to pass guardrails.",
                ]
              : definition.command === "release prepare"
                ? [
                    "- Release prepare enforces release preconditions before delivery/release artifact materialization.",
                    "- If preconditions are blocked, the command fails with explicit blocking reasons.",
                    "- Successful execution links delivery-manifest and release-packet outputs for audit lineage.",
                  ]
            : definition.command === "evidence show"
              ? [
                  "- This command is read-only and aggregates step, quality, and delivery evidence.",
                  "- --run-id scopes results to one run when contracts include run_id.",
                  "- Use incident open/show and audit runs for incident and run-centric audit actions.",
                ]
              : definition.command === "incident open"
                ? [
                    "- Incident open writes one contract-valid incident-report under runtime reports.",
                    "- --run-id and --summary are required to preserve explicit operator intent and run lineage.",
                    "- Command links run packet, step, quality, and explicit linked-asset refs into one incident record.",
                  ]
                : definition.command === "incident recertify"
                  ? [
                      "- Incident recertify updates one incident-report with recertify/hold/re-enable transitions.",
                      "- Re-enable requires explicit promotion evidence with status=pass.",
                      "- Recertification updates preserve run-linked and promotion-linked evidence refs.",
                    ]
                : definition.command === "incident show"
                  ? [
                      "- Incident show is read-only and supports lookup by --incident-id or --run-id.",
                      "- --limit bounds output size for operator review sessions.",
                      "- Empty result sets are valid when no incident record matches the filter.",
                    ]
                  : definition.command === "audit runs"
                    ? [
                        "- Audit runs is read-only and emits run-centric snapshots for packet, step, quality, and finance evidence refs.",
                        "- Use --run-id to scope one run or --limit for bounded list output.",
                        "- Audit output highlights incident/promotion lineage plus cost/latency signals for traceable governance follow-up.",
                      ]
              : definition.command === "live-e2e start"
                ? [
                    "- This command starts one standard profile run and emits durable run summary + scorecard artifacts.",
                    "- --hold-open=true leaves the run in running state for explicit abort and status rehearsal.",
                    "- Start/observe/abort surfaces stay bounded to the same control-plane model.",
                  ]
                : definition.command === "live-e2e status"
                  ? [
                      "- By default this command is read-only status/report for one run summary.",
                      "- --abort=true issues a bounded abort request for a non-terminal run.",
                      "- Abort uses the same live-run-event contract and does not require web UI attachment.",
                    ]
                : definition.command === "live-e2e report"
                  ? [
                      "- This command is read-only and returns run summary plus per-target scorecards.",
                      "- Report output is durable and sourced from runtime report artifacts.",
                      "- Use status --abort for intervention; report itself is observation-only.",
                    ]
                  : definition.command === "ui attach"
                    ? [
                        "- Attach records explicit UI lifecycle state in runtime state artifacts.",
                        "- --control-plane is optional; omit it to record disconnected/read-model mode.",
                        "- Repeating the same attach input is idempotent and reports ui_lifecycle_idempotent=true.",
                      ]
                    : definition.command === "ui detach"
                      ? [
                          "- Detach never stops active workflows and preserves headless CLI/API operation.",
                          "- Repeating detach on an already detached state is idempotent.",
                          "- Detached lifecycle state remains visible through operator surfaces.",
                        ]
      : [
          "- --project-ref must point to an existing directory.",
          `- --runtime-root defaults to '${RUNTIME_ROOT_DIRNAME}' under the resolved project ref.`,
        ];

  const lines = [
    `aor ${definition.command}`,
    definition.summary ?? "No summary available.",
    "",
    statusLine,
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
    "Implemented commands:",
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
 * @param {string} flagName
 * @param {string | true | undefined} value
 * @param {{ min?: number }} [options]
 * @returns {number | undefined}
 */
function resolveOptionalIntegerFlag(flagName, value, options = {}) {
  if (value === undefined) return undefined;
  if (value === true) {
    throw new CliUsageError(`Flag '--${flagName}' requires a value.`);
  }
  if (!/^-?\d+$/.test(value)) {
    throw new CliUsageError(`Flag '--${flagName}' must be an integer.`);
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new CliUsageError(`Flag '--${flagName}' must be an integer.`);
  }

  if (options.min !== undefined && parsed < options.min) {
    throw new CliUsageError(`Flag '--${flagName}' must be >= ${options.min}.`);
  }

  return parsed;
}

/**
 * @param {string} flagName
 * @param {string | true | undefined} value
 * @returns {string[]}
 */
function resolveOptionalCsvFlag(flagName, value) {
  if (value === undefined) return [];
  if (value === true) {
    throw new CliUsageError(`Flag '--${flagName}' requires a value.`);
  }

  const parsed = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (parsed.length === 0) {
    throw new CliUsageError(`Flag '--${flagName}' cannot be empty.`);
  }

  return Array.from(new Set(parsed));
}

/**
 * @param {string[]} values
 * @returns {string[]}
 */
function uniqueStrings(values) {
  return Array.from(new Set(values.filter((value) => typeof value === "string" && value.length > 0)));
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
 * @param {string} value
 * @returns {string}
 */
function normalizeForId(value) {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * @param {string} runId
 * @returns {string}
 */
function toRunRef(runId) {
  return runId.startsWith("run://") ? runId : `run://${runId}`;
}

/**
 * @param {string} runRef
 * @returns {string}
 */
function normalizeRunRef(runRef) {
  return runRef.startsWith("run://") ? runRef.slice("run://".length) : runRef;
}

/**
 * @param {Array<{ document: Record<string, unknown> }>} artifacts
 * @param {string | undefined} runId
 * @returns {Array<{ document: Record<string, unknown> }>}
 */
function filterArtifactsByRunId(artifacts, runId) {
  if (!runId) return artifacts;
  return artifacts.filter((artifact) => artifact.document.run_id === runId);
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
  let evaluationReportId = null;
  let evaluationReportFile = null;
  let evaluationStatus = null;
  let evaluationBlocking = null;
  let evaluationSuiteRef = null;
  let evaluationSubjectRef = null;
  let promotionDecisionId = null;
  let promotionDecisionFile = null;
  let promotionDecisionStatus = null;
  let certificationEvaluationReportFile = null;
  let certificationHarnessCaptureFile = null;
  let certificationHarnessReplayFile = null;
  let runSummaries = null;
  let strategicSnapshot = null;
  let followMode = null;
  let streamProtocol = null;
  let streamBackpressure = null;
  let replayEvents = null;
  let packetArtifacts = null;
  let selectedFamily = null;
  let stepResults = null;
  let qualityArtifacts = null;
  let deliveryManifests = null;
  let promotionDecisions = null;
  let readOnly = null;
  let futureControlHooks = null;
  let liveE2EProfileRef = null;
  let liveE2ERunId = null;
  let liveE2ERunStatus = null;
  let liveE2ERunSummaryFile = null;
  let liveE2EScorecardFiles = null;
  let liveE2EScorecards = null;
  let liveE2EAbortApplied = null;
  let liveE2EAbortSupported = null;
  let runControlAction = null;
  let runControlRunId = null;
  let runControlState = null;
  let runControlStateFile = null;
  let runControlAuditId = null;
  let runControlAuditFile = null;
  let runControlBlocked = null;
  let runControlGuardrails = null;
  let runControlTransition = null;
  let primaryEventId = null;
  let evidenceEventId = null;
  let streamLogFile = null;
  let uiLifecycleAction = null;
  let uiLifecycleState = null;
  let uiLifecycleStateFile = null;
  let uiLifecycleIdempotent = null;
  let uiLifecycleConnectionState = null;
  let uiLifecycleHeadlessSafe = null;
  let deliveryPlanId = null;
  let deliveryPlanFile = null;
  let deliveryPlanStatus = null;
  let deliveryMode = null;
  let deliveryBlocking = null;
  let deliveryBlockingReasons = null;
  let deliveryTranscriptFile = null;
  let deliveryManifestId = null;
  let deliveryManifestFile = null;
  let releasePacketId = null;
  let releasePacketFile = null;
  let releasePacketStatus = null;
  let deliveryWritebackResult = null;
  let incidentId = null;
  let incidentFile = null;
  let incidentStatus = null;
  let incidentRunRef = null;
  let incidentLinkedAssetRefs = null;
  let incidentRecertificationDecision = null;
  let incidentRecertificationFromStatus = null;
  let incidentRecertificationToStatus = null;
  let incidentRecertificationPromotionRef = null;
  let incidentRecertificationGate = null;
  let incidentRecords = null;
  let runAuditRecords = null;
  let auditEvidenceRefs = null;

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
  } else if (command === "intake create") {
    ensureRequiredFlags(command, flags);
    const intakeResult = initializeProjectRuntime({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      projectProfile: resolveOptionalStringFlag("project-profile", flags["project-profile"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
    });

    resolvedProjectRef = intakeResult.projectRoot;
    resolvedRuntimeRoot = intakeResult.runtimeRoot;
    runtimeLayout = intakeResult.runtimeLayout;
    runtimeStateFile = intakeResult.stateFile;
    projectProfileRef = intakeResult.projectProfileRef;
    artifactPacketId = intakeResult.artifactPacketId;
    artifactPacketFile = intakeResult.artifactPacketFile;
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
  } else if (command === "discovery run") {
    ensureRequiredFlags(command, flags);
    const routeOverrides = resolveRouteOverridesFlag(flags["route-overrides"]);
    const policyOverrides = resolvePolicyOverridesFlag(flags["policy-overrides"]);

    const discoveryResult = analyzeProjectRuntime({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      projectProfile: resolveOptionalStringFlag("project-profile", flags["project-profile"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
      routeOverrides,
      policyOverrides,
    });

    resolvedProjectRef = discoveryResult.projectRoot;
    resolvedRuntimeRoot = discoveryResult.runtimeRoot;
    runtimeLayout = discoveryResult.runtimeLayout;
    runtimeStateFile = discoveryResult.stateFile;
    projectProfileRef = discoveryResult.projectProfileRef;
    analysisReportId = discoveryResult.report.report_id;
    analysisReportFile = discoveryResult.reportPath;
    routeResolutionFile = discoveryResult.routeResolutionPath;
    routeResolutionSteps = discoveryResult.routeResolutionMatrix;
    assetResolutionFile = discoveryResult.assetResolutionPath;
    assetResolutionSteps = discoveryResult.assetResolutionMatrix;
    policyResolutionFile = discoveryResult.policyResolutionPath;
    policyResolutionSteps = discoveryResult.policyResolutionMatrix;
    evaluationRegistryFile = discoveryResult.evaluationRegistryPath;
    evaluationRegistrySuites = discoveryResult.evaluationRegistry.suites;
    evaluationRegistryDatasets = discoveryResult.evaluationRegistry.datasets;
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
  } else if (command === "spec build") {
    ensureRequiredFlags(command, flags);
    const routeOverrides = resolveRouteOverridesFlag(flags["route-overrides"]);
    const policyOverrides = resolvePolicyOverridesFlag(flags["policy-overrides"]);

    const specResult = executeRoutedStep({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      projectProfile: resolveOptionalStringFlag("project-profile", flags["project-profile"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
      stepClass: "spec",
      dryRun: true,
      routeOverrides,
      policyOverrides,
    });

    resolvedProjectRef = specResult.projectRoot;
    resolvedRuntimeRoot = specResult.runtimeRoot;
    runtimeLayout = specResult.runtimeLayout;
    runtimeStateFile = specResult.stateFile;
    projectProfileRef = specResult.projectProfileRef;
    routedStepResultId = specResult.stepResultId;
    routedStepResultFile = specResult.stepResultPath;
    verifyStepResultFiles = [specResult.stepResultPath];
  } else if (command === "eval run") {
    ensureRequiredFlags(command, flags);

    const evalResult = runEvaluationSuite({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      projectProfile: resolveOptionalStringFlag("project-profile", flags["project-profile"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
      suiteRef: resolveOptionalStringFlag("suite-ref", flags["suite-ref"]),
      subjectRef: /** @type {string} */ (
        resolveOptionalStringFlag("subject-ref", flags["subject-ref"])
      ),
      subjectVersion: resolveOptionalStringFlag("subject-version", flags["subject-version"]),
    });

    resolvedProjectRef = evalResult.projectRoot;
    resolvedRuntimeRoot = evalResult.runtimeRoot;
    runtimeLayout = evalResult.runtimeLayout;
    runtimeStateFile = evalResult.stateFile;
    projectProfileRef = evalResult.projectProfileRef;
    evaluationReportId = evalResult.evaluationReport.report_id;
    evaluationReportFile = evalResult.evaluationReportPath;
    evaluationStatus = evalResult.evaluationReport.status;
    evaluationBlocking = evalResult.blocking;
    evaluationSuiteRef = evalResult.suiteRef;
    evaluationSubjectRef = evalResult.subjectRef;
  } else if (command === "harness certify") {
    ensureRequiredFlags(command, flags);

    const certifyResult = certifyAssetPromotion({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      projectProfile: resolveOptionalStringFlag("project-profile", flags["project-profile"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
      assetRef: /** @type {string} */ (resolveOptionalStringFlag("asset-ref", flags["asset-ref"])),
      subjectRef: /** @type {string} */ (resolveOptionalStringFlag("subject-ref", flags["subject-ref"])),
      suiteRef: resolveOptionalStringFlag("suite-ref", flags["suite-ref"]),
      stepClass: resolveOptionalStringFlag("step-class", flags["step-class"]),
      fromChannel: resolveOptionalStringFlag("from-channel", flags["from-channel"]),
      toChannel: resolveOptionalStringFlag("to-channel", flags["to-channel"]),
    });

    resolvedProjectRef = certifyResult.projectRoot;
    resolvedRuntimeRoot = certifyResult.runtimeRoot;
    runtimeLayout = certifyResult.runtimeLayout;
    runtimeStateFile = certifyResult.stateFile;
    projectProfileRef = certifyResult.projectProfileRef;
    promotionDecisionId = certifyResult.decision.decision_id;
    promotionDecisionFile = certifyResult.decisionPath;
    promotionDecisionStatus = certifyResult.decision.status;
    certificationEvaluationReportFile = certifyResult.evaluationReportPath;
    certificationHarnessCaptureFile = certifyResult.harnessCapturePath;
    certificationHarnessReplayFile = certifyResult.harnessReplayPath;
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
  } else if (command === "wave create") {
    ensureRequiredFlags(command, flags);

    const waveResult = prepareHandoffArtifacts({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      projectProfile: resolveOptionalStringFlag("project-profile", flags["project-profile"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
      ticketId: resolveOptionalStringFlag("ticket-id", flags["ticket-id"]),
      approvedArtifactPath: resolveOptionalStringFlag("approved-artifact", flags["approved-artifact"]),
    });

    resolvedProjectRef = waveResult.projectRoot;
    resolvedRuntimeRoot = waveResult.runtimeRoot;
    runtimeLayout = waveResult.runtimeLayout;
    runtimeStateFile = waveResult.stateFile;
    projectProfileRef = waveResult.projectProfileRef;
    waveTicketId = waveResult.waveTicket.ticket_id;
    waveTicketFile = waveResult.waveTicketFile;
    handoffPacketId = waveResult.handoffPacket.packet_id;
    handoffPacketFile = waveResult.handoffPacketFile;
    handoffStatus = waveResult.handoffPacket.status;
    handoffApprovalState = waveResult.handoffPacket.approval_state;
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
  } else if (
    command === "run start" ||
    command === "run pause" ||
    command === "run resume" ||
    command === "run steer" ||
    command === "run cancel"
  ) {
    ensureRequiredFlags(command, flags);

    const runAction = /** @type {"start" | "pause" | "resume" | "steer" | "cancel"} */ (command.split(" ")[1]);
    const runId = resolveOptionalStringFlag("run-id", flags["run-id"]);
    const targetStep = resolveOptionalStringFlag("target-step", flags["target-step"]);

    if (runAction !== "steer" && targetStep) {
      throw new CliUsageError(`Flag '--target-step' is only valid for 'aor run steer'.`);
    }

    const controlResult = applyRunControlAction({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
      runId,
      action: runAction,
      targetStep,
      reason: resolveOptionalStringFlag("reason", flags.reason),
      approvalRef: resolveOptionalStringFlag("approval-ref", flags["approval-ref"]),
    });

    resolvedProjectRef = controlResult.projectRoot;
    resolvedRuntimeRoot = controlResult.runtimeRoot;
    runtimeLayout = controlResult.runtimeLayout;
    projectProfileRef = controlResult.projectProfileRef;
    runtimeStateFile = controlResult.stateFile;
    runControlAction = controlResult.action;
    runControlRunId = controlResult.runId;
    runControlState = controlResult.state;
    runControlStateFile = controlResult.stateFile;
    runControlAuditId = controlResult.auditRecord.audit_id;
    runControlAuditFile = controlResult.auditFile;
    runControlBlocked = controlResult.blocked;
    runControlGuardrails = controlResult.guardrails;
    runControlTransition = controlResult.transition;
    primaryEventId = controlResult.primaryEvent.event_id;
    evidenceEventId = controlResult.evidenceEvent.event_id;
    streamLogFile = controlResult.streamLogFile;
    readOnly = false;
    futureControlHooks = controlResult.nextActions;
  } else if (command === "run status") {
    ensureRequiredFlags(command, flags);
    const runId = resolveOptionalStringFlag("run-id", flags["run-id"]);
    const follow = resolveOptionalBooleanFlag("follow", flags.follow);
    const afterEventId = resolveOptionalStringFlag("after-event-id", flags["after-event-id"]);
    const maxReplay = resolveOptionalIntegerFlag("max-replay", flags["max-replay"], { min: 0 });

    if (afterEventId && !follow) {
      throw new CliUsageError("Flag '--after-event-id' can only be used with '--follow'.");
    }
    if (maxReplay !== undefined && !follow) {
      throw new CliUsageError("Flag '--max-replay' can only be used with '--follow'.");
    }
    if (follow && !runId) {
      throw new CliUsageError("Flag '--run-id' is required when '--follow' is enabled.");
    }

    const projectState = readProjectState({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
    });
    resolvedProjectRef = projectState.project_root;
    resolvedRuntimeRoot = projectState.runtime_root;
    runtimeLayout = projectState.runtime_layout;
    runtimeStateFile = projectState.state_file;
    projectProfileRef = projectState.project_profile_ref;
    const uiState = readUiLifecycleState({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
    });
    uiLifecycleState = uiState.state;
    uiLifecycleStateFile = uiState.stateFile;
    uiLifecycleConnectionState =
      typeof uiState.state.connection_state === "string" ? uiState.state.connection_state : null;
    uiLifecycleHeadlessSafe = uiState.state.headless_safe === true;

    runSummaries = listRuns({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
    }).filter((summary) => !runId || summary.run_id === runId);
    strategicSnapshot = readStrategicSnapshot({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
    });

    followMode = {
      enabled: follow,
      run_id: runId ?? null,
      source: follow ? "control-plane-live-run-event-stream" : "disabled",
    };

    if (follow) {
      const stream = openRunEventStream({
        cwd,
        projectRef: /** @type {string} */ (flags["project-ref"]),
        runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
        runId: /** @type {string} */ (runId),
        afterEventId,
        maxReplay,
      });
      streamProtocol = stream.protocol;
      streamBackpressure = stream.backpressure;
      replayEvents = stream.replay_events;
      followMode = {
        ...followMode,
        replay_count: stream.replay_events.length,
        stream_log_file: stream.log_file,
      };
      streamLogFile = stream.log_file;
    } else {
      replayEvents = [];
    }

    readOnly = true;
    futureControlHooks = ["run start", "run pause", "run resume", "run steer", "run cancel"];
  } else if (command === "deliver prepare" || command === "release prepare") {
    ensureRequiredFlags(command, flags);
    const routeOverrides = resolveRouteOverridesFlag(flags["route-overrides"]);
    const policyOverrides = resolvePolicyOverridesFlag(flags["policy-overrides"]);

    const init = initializeProjectRuntime({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      projectProfile: resolveOptionalStringFlag("project-profile", flags["project-profile"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
    });
    resolvedProjectRef = init.projectRoot;
    resolvedRuntimeRoot = init.runtimeRoot;
    runtimeLayout = init.runtimeLayout;
    runtimeStateFile = init.stateFile;
    projectProfileRef = init.projectProfileRef;

    const stepClass = resolveOptionalStringFlag("step-class", flags["step-class"]) ?? "implement";
    const runId =
      resolveOptionalStringFlag("run-id", flags["run-id"]) ??
      `${init.projectId}.${command === "deliver prepare" ? "delivery" : "release"}.prepare.v1`;
    const resolvedPolicy = resolveStepPolicyForStep({
      projectProfilePath: init.projectProfilePath,
      routesRoot: path.join(init.projectRoot, "examples/routes"),
      policiesRoot: path.join(init.projectRoot, "examples/policies"),
      stepClass,
      routeOverrides,
      policyOverrides,
    });
    const requestedMode = resolveOptionalStringFlag("mode", flags.mode);
    if (requestedMode) {
      const canonicalMode = normalizeDeliveryMode(requestedMode);
      resolvedPolicy.resolved_bounds.writeback_mode.mode = canonicalMode;
      resolvedPolicy.resolved_bounds.writeback_mode.resolution_source = {
        kind: "step-override",
        field: "--mode",
      };
    }

    const approvedHandoffRef = resolveOptionalStringFlag(
      "approved-handoff-ref",
      flags["approved-handoff-ref"],
    );
    const promotionEvidenceRefs = resolveOptionalCsvFlag(
      "promotion-evidence-refs",
      flags["promotion-evidence-refs"],
    );
    const planResult = materializeDeliveryPlan({
      runtimeLayout: init.runtimeLayout,
      projectId: init.projectId,
      runId,
      stepClass,
      policyResolution: resolvedPolicy,
      handoffApproval: approvedHandoffRef
        ? {
            status: "pass",
            ref: approvedHandoffRef,
          }
        : {
            status: "missing",
            ref: null,
          },
      promotionEvidenceRefs,
    });

    deliveryPlanId =
      typeof planResult.deliveryPlan.plan_id === "string" ? planResult.deliveryPlan.plan_id : null;
    deliveryPlanFile = planResult.deliveryPlanFile;
    deliveryPlanStatus =
      typeof planResult.deliveryPlan.status === "string" ? planResult.deliveryPlan.status : null;
    deliveryMode =
      typeof planResult.deliveryPlan.delivery_mode === "string" ? planResult.deliveryPlan.delivery_mode : null;
    deliveryBlocking = deliveryPlanStatus !== "ready";
    deliveryBlockingReasons = Array.isArray(planResult.deliveryPlan.blocking_reasons)
      ? planResult.deliveryPlan.blocking_reasons
          .filter((reason) => typeof reason === "string" && reason.trim().length > 0)
          .map((reason) => reason.trim())
      : [];

    if (command === "release prepare" && deliveryPlanStatus !== "ready") {
      const reasons = deliveryBlockingReasons.length > 0
        ? deliveryBlockingReasons.join(", ")
        : "delivery-plan-blocked";
      throw new CliUsageError(`Release preconditions failed: ${reasons}.`);
    }

    const deliveryResult = runDeliveryDriver({
      projectRef: init.projectRoot,
      cwd,
      runtimeRoot: init.runtimeRoot,
      runId,
      stepId: command === "deliver prepare" ? "deliver.prepare" : "release.prepare",
      mode: deliveryMode ?? undefined,
      branchName: resolveOptionalStringFlag("branch-name", flags["branch-name"]),
      commitMessage: resolveOptionalStringFlag("commit-message", flags["commit-message"]),
      forkOwner: resolveOptionalStringFlag("fork-owner", flags["fork-owner"]),
      baseRef: resolveOptionalStringFlag("base-ref", flags["base-ref"]),
      prTitle: resolveOptionalStringFlag("pr-title", flags["pr-title"]),
      prBody: resolveOptionalStringFlag("pr-body", flags["pr-body"]),
      ticketId: resolveOptionalStringFlag("ticket-id", flags["ticket-id"]),
      deliveryPlanPath: planResult.deliveryPlanFile,
    });

    deliveryBlocking = deliveryResult.blocking;
    deliveryTranscriptFile = deliveryResult.transcriptFile;
    deliveryManifestId =
      typeof deliveryResult.deliveryManifest.manifest_id === "string"
        ? deliveryResult.deliveryManifest.manifest_id
        : null;
    deliveryManifestFile = deliveryResult.deliveryManifestFile;
    releasePacketId =
      typeof deliveryResult.releasePacket.packet_id === "string" ? deliveryResult.releasePacket.packet_id : null;
    releasePacketFile = deliveryResult.releasePacketFile;
    releasePacketStatus =
      typeof deliveryResult.releasePacket.status === "string" ? deliveryResult.releasePacket.status : null;
    const repoDeliveries = Array.isArray(deliveryResult.deliveryManifest.repo_deliveries)
      ? deliveryResult.deliveryManifest.repo_deliveries
      : [];
    const firstRepoDelivery = repoDeliveries.length > 0 && typeof repoDeliveries[0] === "object" ? repoDeliveries[0] : null;
    if (firstRepoDelivery && typeof firstRepoDelivery.writeback_result === "string") {
      deliveryWritebackResult = firstRepoDelivery.writeback_result;
    }
    readOnly = false;
    futureControlHooks = [
      "packet show --family delivery-manifest",
      "packet show --family release-packet",
      `evidence show --run-id ${runId}`,
    ];
  } else if (command === "packet show") {
    ensureRequiredFlags(command, flags);
    const family = resolveOptionalStringFlag("family", flags.family) ?? "all";
    const limit = resolveOptionalIntegerFlag("limit", flags.limit, { min: 1 });
    const supportedFamilies = new Set([
      "artifact-packet",
      "wave-ticket",
      "handoff-packet",
      "delivery-plan",
      "delivery-manifest",
      "release-packet",
    ]);

    if (family !== "all" && !supportedFamilies.has(family)) {
      throw new CliUsageError(
        "Flag '--family' must be one of artifact-packet, wave-ticket, handoff-packet, delivery-plan, delivery-manifest, release-packet, or all.",
      );
    }

    const projectState = readProjectState({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
    });
    resolvedProjectRef = projectState.project_root;
    resolvedRuntimeRoot = projectState.runtime_root;
    runtimeLayout = projectState.runtime_layout;
    runtimeStateFile = projectState.state_file;
    projectProfileRef = projectState.project_profile_ref;

    const packets = listPacketArtifacts({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
    });
    const familyFiltered = family === "all" ? packets : packets.filter((packet) => packet.family === family);
    packetArtifacts = typeof limit === "number" ? familyFiltered.slice(0, limit) : familyFiltered;
    selectedFamily = family;
    readOnly = true;
    futureControlHooks = ["deliver prepare", "release prepare"];
  } else if (command === "evidence show") {
    ensureRequiredFlags(command, flags);
    const runId = resolveOptionalStringFlag("run-id", flags["run-id"]);

    const projectState = readProjectState({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
    });
    resolvedProjectRef = projectState.project_root;
    resolvedRuntimeRoot = projectState.runtime_root;
    runtimeLayout = projectState.runtime_layout;
    runtimeStateFile = projectState.state_file;
    projectProfileRef = projectState.project_profile_ref;

    stepResults = filterArtifactsByRunId(
      listStepResults({
        cwd,
        projectRef: /** @type {string} */ (flags["project-ref"]),
        runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
      }),
      runId,
    );
    qualityArtifacts = filterArtifactsByRunId(
      listQualityArtifacts({
        cwd,
        projectRef: /** @type {string} */ (flags["project-ref"]),
        runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
      }),
      runId,
    );
    deliveryManifests = filterArtifactsByRunId(
      listDeliveryManifests({
        cwd,
        projectRef: /** @type {string} */ (flags["project-ref"]),
        runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
      }),
      runId,
    );
    promotionDecisions = filterArtifactsByRunId(
      listPromotionDecisions({
        cwd,
        projectRef: /** @type {string} */ (flags["project-ref"]),
        runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
      }),
      runId,
    );
    readOnly = true;
    futureControlHooks = ["incident open", "incident show", "audit runs"];
  } else if (command === "incident open") {
    ensureRequiredFlags(command, flags);
    const runId = /** @type {string} */ (resolveOptionalStringFlag("run-id", flags["run-id"]));
    const summary = /** @type {string} */ (resolveOptionalStringFlag("summary", flags.summary));
    const severity = resolveOptionalStringFlag("severity", flags.severity) ?? "high";
    const statusValue = resolveOptionalStringFlag("status", flags.status) ?? "open";
    const explicitLinkedAssetRefs = resolveOptionalCsvFlag("linked-asset-refs", flags["linked-asset-refs"]);

    const projectState = readProjectState({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
    });
    resolvedProjectRef = projectState.project_root;
    resolvedRuntimeRoot = projectState.runtime_root;
    runtimeLayout = projectState.runtime_layout;
    runtimeStateFile = projectState.state_file;
    projectProfileRef = projectState.project_profile_ref;

    const runSummariesForIncident = listRuns({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
    });
    const runSummary = runSummariesForIncident.find((entry) => entry.run_id === runId);
    if (!runSummary) {
      throw new CliUsageError(`Run '${runId}' is not present in runtime evidence. Use 'aor run status --run-id ${runId}'.`);
    }

    const qualityForRun = listQualityArtifacts({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
    }).filter((artifact) => runSummary.quality_refs.includes(artifact.artifact_ref));

    const linkedEvalSuiteRefs = uniqueStrings(
      qualityForRun
        .filter((artifact) => artifact.family === "evaluation-report")
        .map((artifact) => (typeof artifact.document.suite_ref === "string" ? artifact.document.suite_ref : "")),
    );
    const linkedHarnessCaptureRefs = uniqueStrings(
      qualityForRun
        .filter((artifact) => artifact.family === "promotion-decision")
        .flatMap((artifact) => asStringArray(artifact.document.evidence_refs))
        .filter((ref) => ref.includes("harness-capture")),
    );

    const linkedAssetRefs = uniqueStrings([
      ...runSummary.packet_refs,
      ...runSummary.step_result_refs,
      ...runSummary.quality_refs,
      ...explicitLinkedAssetRefs,
    ]);
    const incidentRun = toRunRef(runId);
    const generatedIncidentId = `${projectState.project_id}.incident.${normalizeForId(runId)}.${Date.now()}`;
    const incidentDocument = {
      incident_id: generatedIncidentId,
      project_id: projectState.project_id,
      severity,
      summary,
      linked_run_refs: [incidentRun],
      linked_asset_refs: linkedAssetRefs,
      status: statusValue,
      linked_eval_suite_refs: linkedEvalSuiteRefs,
      linked_harness_capture_refs: linkedHarnessCaptureRefs,
      linked_backlog_refs: ["docs/backlog/mvp-implementation-backlog.md", "docs/backlog/wave-6-implementation-slices.md"],
      evidence_root: projectState.runtime_layout.reports_root,
      created_at: new Date().toISOString(),
    };
    const incidentValidation = validateContractDocument({
      family: "incident-report",
      document: incidentDocument,
      source: "runtime://incident-report-open",
    });
    if (!incidentValidation.ok) {
      const issues = incidentValidation.issues.map((issue) => issue.message).join("; ");
      throw new CliUsageError(`Generated incident-report failed contract validation: ${issues}`);
    }

    const generatedIncidentFile = path.join(
      projectState.runtime_layout.reports_root,
      `incident-report-${normalizeForId(generatedIncidentId)}.json`,
    );
    fs.writeFileSync(generatedIncidentFile, `${JSON.stringify(incidentDocument, null, 2)}\n`, "utf8");

    incidentId = incidentDocument.incident_id;
    incidentFile = generatedIncidentFile;
    incidentStatus = incidentDocument.status;
    incidentRunRef = incidentRun;
    incidentLinkedAssetRefs = incidentDocument.linked_asset_refs;
    auditEvidenceRefs = linkedAssetRefs;
    readOnly = false;
    futureControlHooks = [
      `incident show --incident-id ${incidentDocument.incident_id}`,
      `incident recertify --incident-id ${incidentDocument.incident_id} --decision recertify`,
      `audit runs --run-id ${runId}`,
      `evidence show --run-id ${runId}`,
    ];
  } else if (command === "incident recertify") {
    ensureRequiredFlags(command, flags);
    const incidentIdValue = /** @type {string} */ (resolveOptionalStringFlag("incident-id", flags["incident-id"]));
    const decisionInput = (resolveOptionalStringFlag("decision", flags.decision) ?? "recertify").toLowerCase();
    const decision = decisionInput === "reenable" ? "re-enable" : decisionInput;
    const reason = resolveOptionalStringFlag("reason", flags.reason);
    const promotionRef = resolveOptionalStringFlag("promotion-ref", flags["promotion-ref"]);
    const explicitRunId = resolveOptionalStringFlag("run-id", flags["run-id"]);

    if (!["recertify", "hold", "re-enable"].includes(decision)) {
      throw new CliUsageError("Flag '--decision' must be one of recertify, hold, or re-enable.");
    }

    const projectState = readProjectState({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
    });
    resolvedProjectRef = projectState.project_root;
    resolvedRuntimeRoot = projectState.runtime_root;
    runtimeLayout = projectState.runtime_layout;
    runtimeStateFile = projectState.state_file;
    projectProfileRef = projectState.project_profile_ref;

    const qualityArtifacts = listQualityArtifacts({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
    });
    const incidents = qualityArtifacts.filter((artifact) => artifact.family === "incident-report");
    const incidentArtifact = incidents.find((artifact) => artifact.document.incident_id === incidentIdValue);
    if (!incidentArtifact) {
      throw new CliUsageError(`Incident '${incidentIdValue}' was not found.`);
    }

    const linkedRunRefs = asStringArray(incidentArtifact.document.linked_run_refs);
    const incidentRun = linkedRunRefs.length > 0 ? linkedRunRefs[0] : explicitRunId ? toRunRef(explicitRunId) : null;
    if (explicitRunId && incidentRun && normalizeRunRef(incidentRun) !== explicitRunId) {
      throw new CliUsageError(
        `Incident '${incidentIdValue}' is linked to '${incidentRun}', not '${toRunRef(explicitRunId)}'.`,
      );
    }
    const runId = incidentRun ? normalizeRunRef(incidentRun) : null;

    const promotions = qualityArtifacts.filter((artifact) => artifact.family === "promotion-decision");
    let promotionArtifact = null;
    if (promotionRef) {
      promotionArtifact = promotions.find((artifact) => artifact.artifact_ref === promotionRef) ?? null;
      if (!promotionArtifact) {
        throw new CliUsageError(`Promotion decision '${promotionRef}' was not found.`);
      }
    } else if (runId) {
      const runSummaries = listRuns({
        cwd,
        projectRef: /** @type {string} */ (flags["project-ref"]),
        runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
      });
      const runSummary = runSummaries.find((entry) => entry.run_id === runId);
      const linkedPromotionRefs = runSummary
        ? runSummary.quality_refs.filter((ref) => ref.includes("promotion-decision"))
        : [];
      promotionArtifact =
        promotions.find((artifact) => linkedPromotionRefs.includes(artifact.artifact_ref)) ?? null;
    }

    const promotionStatus =
      promotionArtifact && typeof promotionArtifact.document.status === "string"
        ? promotionArtifact.document.status
        : null;

    if (decision === "re-enable") {
      if (!promotionArtifact) {
        throw new CliUsageError(
          "Re-enable is blocked: no run-linked promotion decision was found. Provide --promotion-ref with pass evidence.",
        );
      }
      if (promotionStatus !== "pass") {
        throw new CliUsageError(
          `Re-enable is blocked: promotion decision '${promotionArtifact.artifact_ref}' has status '${promotionStatus ?? "unknown"}' (requires pass).`,
        );
      }
      incidentRecertificationGate = "allow";
    } else if (decision === "recertify") {
      incidentRecertificationGate = promotionStatus === "pass" ? "allow" : "hold";
    } else {
      incidentRecertificationGate = "hold";
    }

    const nextStatus = decision === "re-enable" ? "re-enabled" : decision;
    const linkedEvidenceRefs = uniqueStrings([
      ...asStringArray(incidentArtifact.document.linked_asset_refs),
      ...(promotionArtifact
        ? [promotionArtifact.artifact_ref, ...asStringArray(promotionArtifact.document.evidence_refs)]
        : []),
    ]);

    const recertified = applyIncidentRecertification({
      projectRoot: projectState.project_root,
      runtimeLayout: projectState.runtime_layout,
      incidentId: incidentIdValue,
      decision: /** @type {"recertify" | "hold" | "re-enable"} */ (decision),
      nextStatus,
      runRef: incidentRun ?? undefined,
      reason: reason ?? undefined,
      promotionDecisionRef: promotionArtifact?.artifact_ref,
      promotionDecisionStatus: promotionStatus ?? undefined,
      evidenceRefs: linkedEvidenceRefs,
    });

    incidentId = incidentIdValue;
    incidentFile = recertified.incidentFile;
    incidentStatus =
      typeof recertified.incident.status === "string" ? recertified.incident.status : nextStatus;
    incidentRunRef = incidentRun;
    incidentLinkedAssetRefs = asStringArray(recertified.incident.linked_asset_refs);
    incidentRecertificationDecision = decision;
    incidentRecertificationFromStatus =
      typeof recertified.recertification.from_status === "string"
        ? recertified.recertification.from_status
        : null;
    incidentRecertificationToStatus =
      typeof recertified.recertification.to_status === "string"
        ? recertified.recertification.to_status
        : nextStatus;
    incidentRecertificationPromotionRef = promotionArtifact?.artifact_ref ?? null;
    auditEvidenceRefs = linkedEvidenceRefs;
    readOnly = false;
    futureControlHooks = runId
      ? [
          `incident show --incident-id ${incidentIdValue}`,
          `audit runs --run-id ${runId}`,
          `evidence show --run-id ${runId}`,
        ]
      : [`incident show --incident-id ${incidentIdValue}`, "audit runs"];
  } else if (command === "incident show") {
    ensureRequiredFlags(command, flags);
    const incidentIdFilter = resolveOptionalStringFlag("incident-id", flags["incident-id"]);
    const runIdFilter = resolveOptionalStringFlag("run-id", flags["run-id"]);
    const limit = resolveOptionalIntegerFlag("limit", flags.limit, { min: 1 });

    const projectState = readProjectState({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
    });
    resolvedProjectRef = projectState.project_root;
    resolvedRuntimeRoot = projectState.runtime_root;
    runtimeLayout = projectState.runtime_layout;
    runtimeStateFile = projectState.state_file;
    projectProfileRef = projectState.project_profile_ref;

    const incidents = listQualityArtifacts({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
    }).filter((artifact) => artifact.family === "incident-report");

    const runRefFilter = runIdFilter ? toRunRef(runIdFilter) : null;
    const incidentMatches = incidents
      .filter((artifact) =>
        !incidentIdFilter || artifact.document.incident_id === incidentIdFilter,
      )
      .filter((artifact) => {
        if (!runRefFilter) return true;
        const refs = asStringArray(artifact.document.linked_run_refs);
        return refs.includes(runRefFilter) || refs.includes(runIdFilter ?? "");
      });

    if (incidentIdFilter && incidentMatches.length === 0) {
      throw new CliUsageError(`Incident '${incidentIdFilter}' was not found.`);
    }
    if (runIdFilter && incidentMatches.length === 0) {
      throw new CliUsageError(`No incident records are linked to run '${runIdFilter}'.`);
    }

    const boundedMatches = typeof limit === "number" ? incidentMatches.slice(0, limit) : incidentMatches;
    incidentRecords = boundedMatches.map((artifact) => ({
      incident_id:
        typeof artifact.document.incident_id === "string" ? artifact.document.incident_id : null,
      incident_ref: artifact.artifact_ref,
      incident_file: artifact.file,
      status: typeof artifact.document.status === "string" ? artifact.document.status : null,
      severity: typeof artifact.document.severity === "string" ? artifact.document.severity : null,
      summary: typeof artifact.document.summary === "string" ? artifact.document.summary : null,
      linked_run_refs: asStringArray(artifact.document.linked_run_refs),
      linked_asset_refs: asStringArray(artifact.document.linked_asset_refs),
      linked_backlog_refs: asStringArray(artifact.document.linked_backlog_refs),
      created_at: typeof artifact.document.created_at === "string" ? artifact.document.created_at : null,
    }));
    auditEvidenceRefs = uniqueStrings(incidentRecords.flatMap((record) => record.linked_asset_refs));
    readOnly = true;
    futureControlHooks = runIdFilter
      ? [
          `audit runs --run-id ${runIdFilter}`,
          "incident recertify --incident-id <id> --decision recertify",
        ]
      : [
          "audit runs",
          "incident open --run-id <id> --summary <text>",
          "incident recertify --incident-id <id> --decision recertify",
        ];
  } else if (command === "audit runs") {
    ensureRequiredFlags(command, flags);
    const runIdFilter = resolveOptionalStringFlag("run-id", flags["run-id"]);
    const limit = resolveOptionalIntegerFlag("limit", flags.limit, { min: 1 });

    const projectState = readProjectState({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
    });
    resolvedProjectRef = projectState.project_root;
    resolvedRuntimeRoot = projectState.runtime_root;
    runtimeLayout = projectState.runtime_layout;
    runtimeStateFile = projectState.state_file;
    projectProfileRef = projectState.project_profile_ref;

    const runsForAudit = listRuns({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
    });
    const scopedRuns = runIdFilter
      ? runsForAudit.filter((run) => run.run_id === runIdFilter)
      : runsForAudit;

    if (runIdFilter && scopedRuns.length === 0) {
      throw new CliUsageError(`Run '${runIdFilter}' was not found for audit output.`);
    }

    const qualityArtifacts = listQualityArtifacts({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
    });
    const incidents = qualityArtifacts.filter((artifact) => artifact.family === "incident-report");
    const promotions = qualityArtifacts.filter((artifact) => artifact.family === "promotion-decision");

    const runAuditSource = scopedRuns.map((run) => {
      const runRef = toRunRef(run.run_id);
      const incidentMatches = incidents.filter((artifact) => {
        const refs = asStringArray(artifact.document.linked_run_refs);
        return refs.includes(runRef) || refs.includes(run.run_id);
      });
      const incidentRefs = uniqueStrings([
        ...run.quality_refs.filter((ref) => ref.includes("incident-report")),
        ...incidentMatches.map((artifact) => artifact.artifact_ref),
      ]);
      const promotionRefs = uniqueStrings([
        ...run.quality_refs.filter((ref) => ref.includes("promotion-decision")),
        ...promotions
          .filter((artifact) => artifact.artifact_ref && run.quality_refs.includes(artifact.artifact_ref))
          .map((artifact) => artifact.artifact_ref),
      ]);
      const scorecardRefs = uniqueStrings(
        incidentMatches
          .flatMap((artifact) => asStringArray(artifact.document.linked_asset_refs))
          .filter((ref) => ref.includes("learning-loop-scorecard")),
      );
      const evidenceRefs = uniqueStrings([
        ...run.packet_refs,
        ...run.step_result_refs,
        ...run.quality_refs,
        ...incidentMatches.flatMap((artifact) => asStringArray(artifact.document.linked_asset_refs)),
      ]);

      return {
        run_id: run.run_id,
        run_ref: runRef,
        packet_refs: run.packet_refs,
        step_result_refs: run.step_result_refs,
        quality_refs: run.quality_refs,
        finance_evidence: run.finance_evidence,
        incident_refs: incidentRefs,
        promotion_refs: promotionRefs,
        scorecard_refs: scorecardRefs,
        evidence_refs: evidenceRefs,
        evidence_root: projectState.runtime_layout.reports_root,
      };
    });

    runAuditRecords = typeof limit === "number" ? runAuditSource.slice(0, limit) : runAuditSource;
    auditEvidenceRefs = uniqueStrings(runAuditRecords.flatMap((record) => record.evidence_refs));
    readOnly = true;
    futureControlHooks = runIdFilter
      ? [
          `incident open --run-id ${runIdFilter} --summary <text>`,
          `incident show --run-id ${runIdFilter}`,
          "incident recertify --incident-id <id> --decision recertify",
        ]
      : [
          "incident open --run-id <id> --summary <text>",
          "incident show --run-id <id>",
          "incident recertify --incident-id <id> --decision recertify",
        ];
  } else if (command === "live-e2e start") {
    ensureRequiredFlags(command, flags);
    const holdOpen = resolveOptionalBooleanFlag("hold-open", flags["hold-open"]);
    const profileRef = /** @type {string} */ (
      resolveOptionalStringFlag("profile", flags.profile)
    );

    const started = startStandardLiveE2ERun({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
      profileRef,
      runId: resolveOptionalStringFlag("run-id", flags["run-id"]),
      holdOpen,
    });

    const projectState = readProjectState({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
    });
    resolvedProjectRef = projectState.project_root;
    resolvedRuntimeRoot = projectState.runtime_root;
    runtimeLayout = projectState.runtime_layout;
    runtimeStateFile = projectState.state_file;
    projectProfileRef = projectState.project_profile_ref;

    liveE2EProfileRef = profileRef;
    liveE2ERunId = started.runId;
    liveE2ERunStatus = started.summary.status;
    liveE2ERunSummaryFile = started.summaryFile;
    liveE2EScorecardFiles = started.scorecardFiles;
    liveE2EScorecards = started.scorecards;
    liveE2EAbortSupported = true;
    readOnly = false;
    futureControlHooks = ["live-e2e status --abort true", "live-e2e report", "ui attach", "ui detach"];
  } else if (command === "live-e2e status") {
    ensureRequiredFlags(command, flags);
    const abortRequested = resolveOptionalBooleanFlag("abort", flags.abort);
    const runId = /** @type {string} */ (resolveOptionalStringFlag("run-id", flags["run-id"]));
    const reason = resolveOptionalStringFlag("reason", flags.reason);

    const statusResult = abortRequested
      ? abortStandardLiveE2ERun({
          cwd,
          projectRef: /** @type {string} */ (flags["project-ref"]),
          runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
          runId,
          reason,
        })
      : readStandardLiveE2ERun({
          cwd,
          projectRef: /** @type {string} */ (flags["project-ref"]),
          runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
          runId,
        });

    const projectState = readProjectState({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
    });
    resolvedProjectRef = projectState.project_root;
    resolvedRuntimeRoot = projectState.runtime_root;
    runtimeLayout = projectState.runtime_layout;
    runtimeStateFile = projectState.state_file;
    projectProfileRef = projectState.project_profile_ref;

    liveE2ERunId = runId;
    liveE2ERunStatus = statusResult.summary.status;
    liveE2ERunSummaryFile = statusResult.summaryFile;
    liveE2EScorecardFiles = statusResult.scorecardFiles;
    liveE2EScorecards = statusResult.scorecards;
    liveE2EAbortApplied = "abortApplied" in statusResult ? statusResult.abortApplied : false;
    liveE2EAbortSupported = true;
    readOnly = !abortRequested;
    futureControlHooks = abortRequested
      ? ["live-e2e report", "ui attach", "ui detach"]
      : ["live-e2e status --abort true", "live-e2e report", "ui attach", "ui detach"];
  } else if (command === "live-e2e report") {
    ensureRequiredFlags(command, flags);
    const runId = /** @type {string} */ (resolveOptionalStringFlag("run-id", flags["run-id"]));
    const reportResult = readStandardLiveE2ERun({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
      runId,
    });

    const projectState = readProjectState({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
    });
    resolvedProjectRef = projectState.project_root;
    resolvedRuntimeRoot = projectState.runtime_root;
    runtimeLayout = projectState.runtime_layout;
    runtimeStateFile = projectState.state_file;
    projectProfileRef = projectState.project_profile_ref;

    liveE2ERunId = runId;
    liveE2ERunStatus = reportResult.summary.status;
    liveE2ERunSummaryFile = reportResult.summaryFile;
    liveE2EScorecardFiles = reportResult.scorecardFiles;
    liveE2EScorecards = reportResult.scorecards;
    liveE2EAbortSupported = true;
    readOnly = true;
    futureControlHooks = ["live-e2e status --abort true", "ui attach", "ui detach"];
  } else if (command === "ui attach") {
    ensureRequiredFlags(command, flags);
    const uiAttachResult = attachUiLifecycle({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
      runId: resolveOptionalStringFlag("run-id", flags["run-id"]),
      controlPlane: resolveOptionalStringFlag("control-plane", flags["control-plane"]),
    });

    resolvedProjectRef = uiAttachResult.projectRoot;
    resolvedRuntimeRoot = uiAttachResult.runtimeRoot;
    runtimeLayout = uiAttachResult.runtimeLayout;
    runtimeStateFile = uiAttachResult.stateFile;
    projectProfileRef = uiAttachResult.projectProfileRef;
    uiLifecycleAction = uiAttachResult.action;
    uiLifecycleState = uiAttachResult.state;
    uiLifecycleStateFile = uiAttachResult.stateFile;
    uiLifecycleIdempotent = uiAttachResult.idempotent;
    uiLifecycleConnectionState =
      typeof uiAttachResult.state.connection_state === "string" ? uiAttachResult.state.connection_state : null;
    uiLifecycleHeadlessSafe = uiAttachResult.state.headless_safe === true;
    readOnly = false;
    futureControlHooks = ["ui detach", "run status --follow true"];
  } else if (command === "ui detach") {
    ensureRequiredFlags(command, flags);
    const uiDetachResult = detachUiLifecycle({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
      runId: resolveOptionalStringFlag("run-id", flags["run-id"]),
    });

    resolvedProjectRef = uiDetachResult.projectRoot;
    resolvedRuntimeRoot = uiDetachResult.runtimeRoot;
    runtimeLayout = uiDetachResult.runtimeLayout;
    runtimeStateFile = uiDetachResult.stateFile;
    projectProfileRef = uiDetachResult.projectProfileRef;
    uiLifecycleAction = uiDetachResult.action;
    uiLifecycleState = uiDetachResult.state;
    uiLifecycleStateFile = uiDetachResult.stateFile;
    uiLifecycleIdempotent = uiDetachResult.idempotent;
    uiLifecycleConnectionState =
      typeof uiDetachResult.state.connection_state === "string" ? uiDetachResult.state.connection_state : null;
    uiLifecycleHeadlessSafe = uiDetachResult.state.headless_safe === true;
    readOnly = false;
    futureControlHooks = ["ui attach", "run status --follow true"];
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
    evaluation_report_id: evaluationReportId,
    evaluation_report_file: evaluationReportFile,
    evaluation_status: evaluationStatus,
    evaluation_blocking: evaluationBlocking,
    evaluation_suite_ref: evaluationSuiteRef,
    evaluation_subject_ref: evaluationSubjectRef,
    promotion_decision_id: promotionDecisionId,
    promotion_decision_file: promotionDecisionFile,
    promotion_decision_status: promotionDecisionStatus,
    certification_evaluation_report_file: certificationEvaluationReportFile,
    certification_harness_capture_file: certificationHarnessCaptureFile,
    certification_harness_replay_file: certificationHarnessReplayFile,
    run_control_action: runControlAction,
    run_control_run_id: runControlRunId,
    run_control_state: runControlState,
    run_control_state_file: runControlStateFile,
    run_control_audit_id: runControlAuditId,
    run_control_audit_file: runControlAuditFile,
    run_control_blocked: runControlBlocked,
    run_control_guardrails: runControlGuardrails,
    run_control_transition: runControlTransition,
    primary_event_id: primaryEventId,
    evidence_event_id: evidenceEventId,
    ui_lifecycle_action: uiLifecycleAction,
    ui_lifecycle_state: uiLifecycleState,
    ui_lifecycle_state_file: uiLifecycleStateFile,
    ui_lifecycle_idempotent: uiLifecycleIdempotent,
    ui_lifecycle_connection_state: uiLifecycleConnectionState,
    ui_lifecycle_headless_safe: uiLifecycleHeadlessSafe,
    delivery_plan_id: deliveryPlanId,
    delivery_plan_file: deliveryPlanFile,
    delivery_plan_status: deliveryPlanStatus,
    delivery_mode: deliveryMode,
    delivery_blocking: deliveryBlocking,
    delivery_blocking_reasons: deliveryBlockingReasons,
    delivery_transcript_file: deliveryTranscriptFile,
    delivery_manifest_id: deliveryManifestId,
    delivery_manifest_file: deliveryManifestFile,
    release_packet_id: releasePacketId,
    release_packet_file: releasePacketFile,
    release_packet_status: releasePacketStatus,
    delivery_writeback_result: deliveryWritebackResult,
    incident_id: incidentId,
    incident_file: incidentFile,
    incident_status: incidentStatus,
    incident_run_ref: incidentRunRef,
    incident_linked_asset_refs: incidentLinkedAssetRefs,
    incident_recertification_decision: incidentRecertificationDecision,
    incident_recertification_from_status: incidentRecertificationFromStatus,
    incident_recertification_to_status: incidentRecertificationToStatus,
    incident_recertification_promotion_ref: incidentRecertificationPromotionRef,
    incident_recertification_gate: incidentRecertificationGate,
    incident_records: incidentRecords,
    run_audit_records: runAuditRecords,
    audit_evidence_refs: auditEvidenceRefs,
    run_summaries: runSummaries,
    strategic_snapshot: strategicSnapshot,
    follow_mode: followMode,
    stream_protocol: streamProtocol,
    stream_backpressure: streamBackpressure,
    stream_log_file: streamLogFile,
    replay_events: replayEvents,
    packet_artifacts: packetArtifacts,
    selected_family: selectedFamily,
    step_results: stepResults,
    quality_artifacts: qualityArtifacts,
    delivery_manifests: deliveryManifests,
    promotion_decisions: promotionDecisions,
    read_only: readOnly,
    future_control_hooks: futureControlHooks,
    live_e2e_profile_ref: liveE2EProfileRef,
    live_e2e_run_id: liveE2ERunId,
    live_e2e_run_status: liveE2ERunStatus,
    live_e2e_run_summary_file: liveE2ERunSummaryFile,
    live_e2e_scorecard_files: liveE2EScorecardFiles,
    live_e2e_scorecards: liveE2EScorecards,
    live_e2e_abort_applied: liveE2EAbortApplied,
    live_e2e_abort_supported: liveE2EAbortSupported,
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
