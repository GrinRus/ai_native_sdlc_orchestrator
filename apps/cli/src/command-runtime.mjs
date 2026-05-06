import fs from "node:fs";
import path from "node:path";

import { getCommandDefinition, RUNTIME_ROOT_DIRNAME } from "./command-catalog.mjs";

export {
  applyRunControlAction,
  appendRunEvent,
  attachUiLifecycle,
  detachUiLifecycle,
  listDeliveryManifests,
  listCompilerRevisionStatuses,
  listMultirepoCoordinationStatuses,
  listPacketArtifacts,
  listPromotionDecisions,
  listQualityArtifacts,
  listRunControlAudits,
  readFinanceMonitoringSnapshot,
  readRunControlState,
  readRunEventHistory,
  readRunPolicyHistory,
  listRuns,
  readPlannerMetrics,
  listStepResults,
  readStrategicSnapshot,
  openRunEventStream,
  readUiLifecycleState,
  readProjectState,
} from "../../api/src/index.mjs";
export {
  loadContractFile,
  validateContractDocument,
} from "../../../packages/contracts/src/index.mjs";
export {
  approveHandoffArtifacts,
  prepareHandoffArtifacts,
} from "../../../packages/orchestrator-core/src/handoff-packets.mjs";
export { certifyAssetPromotion } from "../../../packages/orchestrator-core/src/certification-decision.mjs";
export {
  materializeCompilerRevisionStatus,
  parseCompilerRevisionRef,
} from "../../../packages/orchestrator-core/src/compiler-revision.mjs";
export { runDeliveryDriver } from "../../../packages/orchestrator-core/src/delivery-driver.mjs";
export {
  materializeDeliveryPlan,
  normalizeDeliveryMode,
} from "../../../packages/orchestrator-core/src/delivery-plan.mjs";
export { materializeMultirepoCoordinationStatus } from "../../../packages/orchestrator-core/src/multirepo-coordination.mjs";
export { runEvaluationSuite } from "../../../packages/orchestrator-core/src/eval-runner.mjs";
export { replayHarnessCapture } from "../../../packages/orchestrator-core/src/harness-capture-replay.mjs";
export {
  applyIncidentRecertification,
  listReviewDecisions,
  materializeIncidentBackfillProposal,
  materializeLearningLoopArtifacts,
  materializeReviewDecision,
} from "../../../packages/observability/src/index.mjs";
export { resolveStepPolicyForStep } from "../../../packages/orchestrator-core/src/policy-resolution.mjs";
export { analyzeProjectRuntime } from "../../../packages/orchestrator-core/src/project-analysis.mjs";
export { initializeProjectRuntime } from "../../../packages/orchestrator-core/src/project-init.mjs";
export { validateProjectRuntime } from "../../../packages/orchestrator-core/src/project-validate.mjs";
export { verifyProjectRuntime } from "../../../packages/orchestrator-core/src/project-verify.mjs";
export { materializeIntakeArtifactPacket } from "../../../packages/orchestrator-core/src/artifact-store.mjs";
export { materializeReviewReport } from "../../../packages/orchestrator-core/src/review-run.mjs";
export { materializeRuntimeHarnessReport } from "../../../packages/orchestrator-core/src/runtime-harness-report.mjs";
export {
  executeRoutedStep,
  executeRuntimeHarnessControlledStep,
} from "../../../packages/orchestrator-core/src/step-execution-engine.mjs";
export { RUNTIME_ROOT_DIRNAME };

export class CliUsageError extends Error {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(message);
    this.name = "CliUsageError";
  }
}

export function ensureRequiredFlags(command, flags) {
  const definition = getCommandDefinition(command);
  const requiredFlags = definition?.requiredFlags ?? [];

  for (const required of requiredFlags) {
    const value = flags[required];
    const normalized =
      typeof value === "string"
        ? value.trim()
        : Array.isArray(value)
          ? value.find((entry) => typeof entry === "string" && entry.trim().length > 0)?.trim() ?? ""
          : "";
    if (normalized.length === 0) {
      throw new CliUsageError(`Missing required flag '--${required}' for 'aor ${command}'.`);
    }
  }
}

/**
 * @param {string} flagName
 * @param {string | string[] | true | undefined} value
 * @returns {string | undefined}
 */
export function resolveOptionalStringFlag(flagName, value) {
  if (value === undefined) return undefined;
  if (value === true) {
    throw new CliUsageError(`Flag '--${flagName}' requires a value.`);
  }
  if (Array.isArray(value)) {
    throw new CliUsageError(`Flag '--${flagName}' accepts only one value.`);
  }
  if (value.trim().length === 0) {
    throw new CliUsageError(`Flag '--${flagName}' cannot be empty.`);
  }
  return value;
}

/**
 * @param {string | string[] | true | undefined} value
 * @returns {"bundled" | "materialized" | undefined}
 */
export function resolveOptionalAssetModeFlag(value) {
  const assetMode = resolveOptionalStringFlag("asset-mode", value);
  if (assetMode === undefined) return undefined;
  if (assetMode !== "bundled" && assetMode !== "materialized") {
    throw new CliUsageError("Flag '--asset-mode' must be one of: bundled, materialized.");
  }
  return assetMode;
}

/**
 * @param {string} flagName
 * @param {string | string[] | true | undefined} value
 * @returns {boolean}
 */
export function resolveOptionalBooleanFlag(flagName, value) {
  if (value === undefined) return false;
  if (value === true) return true;
  if (Array.isArray(value)) {
    throw new CliUsageError(`Flag '--${flagName}' accepts only one value.`);
  }
  if (value === "true") return true;
  if (value === "false") return false;
  throw new CliUsageError(`Flag '--${flagName}' accepts only boolean values ('true' or 'false').`);
}

/**
 * @param {string} flagName
 * @param {string | string[] | true | undefined} value
 * @param {{ min?: number }} [options]
 * @returns {number | undefined}
 */
export function resolveOptionalIntegerFlag(flagName, value, options = {}) {
  if (value === undefined) return undefined;
  if (value === true) {
    throw new CliUsageError(`Flag '--${flagName}' requires a value.`);
  }
  if (Array.isArray(value)) {
    throw new CliUsageError(`Flag '--${flagName}' accepts only one value.`);
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
 * @param {string | string[] | true | undefined} value
 * @returns {string[]}
 */
export function resolveOptionalCsvFlag(flagName, value) {
  if (value === undefined) return [];
  if (value === true) {
    throw new CliUsageError(`Flag '--${flagName}' requires a value.`);
  }

  const values = Array.isArray(value) ? value : [value];
  const parsed = values
    .flatMap((entry) => entry.split(","))
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (parsed.length === 0) {
    throw new CliUsageError(`Flag '--${flagName}' cannot be empty.`);
  }

  return Array.from(new Set(parsed));
}

/**
 * @param {string} flagName
 * @param {string | string[] | true | undefined} value
 * @returns {string[]}
 */
export function resolveOptionalStringListFlag(flagName, value) {
  if (value === undefined) return [];
  if (value === true) {
    throw new CliUsageError(`Flag '--${flagName}' requires a value.`);
  }

  const values = Array.isArray(value) ? value : [value];
  const parsed = values.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  if (parsed.length === 0) {
    throw new CliUsageError(`Flag '--${flagName}' cannot be empty.`);
  }

  return Array.from(new Set(parsed));
}

/**
 * @param {string[]} values
 * @returns {string[]}
 */
export function uniqueStrings(values) {
  return Array.from(new Set(values.filter((value) => typeof value === "string" && value.length > 0)));
}

/**
 * @param {string} filePath
 * @returns {Record<string, unknown>}
 */
export function readJson(filePath) {
  return /** @type {Record<string, unknown>} */ (JSON.parse(fs.readFileSync(filePath, "utf8")));
}

/**
 * @param {string} filePath
 * @param {Record<string, unknown>} payload
 */
export function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
export function asStringArray(value) {
  return Array.isArray(value)
    ? value.filter((entry) => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim())
    : [];
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
export function asPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value)
    : {};
}

/**
 * @param {string} value
 * @returns {string}
 */
export function normalizeForId(value) {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * @param {string} runId
 * @returns {string}
 */
export function toRunRef(runId) {
  return runId.startsWith("run://") ? runId : `run://${runId}`;
}

/**
 * @param {string} projectRoot
 * @param {string} filePath
 * @returns {string}
 */
export function toEvidenceRef(projectRoot, filePath) {
  return `evidence://${path.relative(projectRoot, filePath).replace(/\\/g, "/")}`;
}

/**
 * @param {string} projectRoot
 * @param {string | null | undefined} evidenceRef
 * @returns {boolean}
 */
export function evidenceRefExists(projectRoot, evidenceRef) {
  if (typeof evidenceRef !== "string" || evidenceRef.trim().length === 0) {
    return false;
  }
  const normalized = evidenceRef.trim();
  if (path.isAbsolute(normalized)) {
    return fs.existsSync(normalized);
  }
  if (!normalized.startsWith("evidence://")) {
    return false;
  }
  const evidencePath = normalized.slice("evidence://".length);
  if (!evidencePath) {
    return false;
  }
  const resolved = path.isAbsolute(evidencePath)
    ? evidencePath
    : path.resolve(projectRoot, evidencePath);
  return fs.existsSync(resolved);
}

/**
 * @param {Record<string, unknown>} stepResult
 * @returns {string[]}
 */
export function extractAdapterRawEvidenceRefs(stepResult) {
  const routedExecution = asPlainObject(stepResult.routed_execution);
  const adapterResponse = asPlainObject(routedExecution.adapter_response);
  const adapterOutput = asPlainObject(adapterResponse.output);
  const externalRunner = asPlainObject(adapterOutput.external_runner);
  const topLevelExternalRunner = asPlainObject(stepResult.external_runner);
  return uniqueStrings([
    typeof externalRunner.raw_evidence_ref === "string" ? externalRunner.raw_evidence_ref : "",
    typeof topLevelExternalRunner.raw_evidence_ref === "string" ? topLevelExternalRunner.raw_evidence_ref : "",
  ]);
}

/**
 * @param {string} projectRoot
 * @param {Array<{ document: Record<string, unknown> }>} stepArtifacts
 * @returns {"pass" | "fail" | null}
 */
export function resolveProviderExecutionStatus(projectRoot, stepArtifacts) {
  if (stepArtifacts.length === 0) {
    return null;
  }
  return stepArtifacts.some((artifact) =>
    extractAdapterRawEvidenceRefs(artifact.document).some((ref) => evidenceRefExists(projectRoot, ref)),
  )
    ? "pass"
    : "fail";
}

/**
 * @param {{ cwd: string, projectRoot: string, flagValue: string | undefined, flagName: string }} options
 * @returns {string | undefined}
 */
export function resolveOptionalRefOrPathFlag(options) {
  if (!options.flagValue) {
    return undefined;
  }
  if (options.flagValue.startsWith("evidence://")) {
    return path.resolve(options.projectRoot, options.flagValue.slice("evidence://".length));
  }
  return path.isAbsolute(options.flagValue)
    ? options.flagValue
    : path.resolve(options.cwd, options.flagValue);
}

export const DEFAULT_LEARNING_BACKLOG_REFS = Object.freeze([
  "docs/backlog/mvp-implementation-backlog.md",
  "docs/backlog/mvp-roadmap.md",
  "docs/ops/live-e2e-standard-runner.md",
]);

/**
 * @param {string | null | undefined} status
 * @returns {"pass" | "fail" | "aborted" | "running" | "unknown"}
 */
export function normalizeLearningRunStatus(status) {
  const normalized = typeof status === "string" ? status.trim().toLowerCase() : "";
  if (normalized === "completed" || normalized === "pass" || normalized === "passed" || normalized === "success") {
    return "pass";
  }
  if (normalized === "failed" || normalized === "fail") {
    return "fail";
  }
  if (normalized === "canceled" || normalized === "cancelled" || normalized === "aborted") {
    return "aborted";
  }
  if (normalized === "running" || normalized === "paused") {
    return "running";
  }
  return "unknown";
}

/**
 * @param {Record<string, unknown>} report
 * @returns {boolean}
 */
export function isStrictRuntimeHarnessReport(report) {
  const strictnessProfile = typeof report.strictness_profile === "string" ? report.strictness_profile : "";
  const missionType = typeof report.mission_type === "string" ? report.mission_type : "";
  return (
    strictnessProfile === "strict-code-changing" ||
    strictnessProfile === "strict-release" ||
    missionType === "code-changing" ||
    missionType === "release"
  );
}

/**
 * @param {Record<string, unknown>} report
 * @returns {boolean}
 */
export function runtimeHarnessReportHasMeaningfulPatch(report) {
  const stepDecisions = Array.isArray(report.step_decisions) ? report.step_decisions : [];
  return stepDecisions.some((entry) => {
    const decision = asPlainObject(entry);
    const semantics = asPlainObject(decision.mission_semantics);
    return asStringArray(semantics.mission_scoped_changed_paths).length > 0;
  });
}

/**
 * @param {string | string[] | true | undefined} value
 * @returns {"strict" | "observe"}
 */
export function resolveQualityGateMode(value) {
  const mode = resolveOptionalStringFlag("quality-gate-mode", value) ?? "strict";
  if (mode === "strict" || mode === "observe") {
    return mode;
  }
  throw new CliUsageError("Flag '--quality-gate-mode' must be either 'strict' or 'observe'.");
}

/**
 * @param {{ report: Record<string, unknown>, command: string }} options
 * @returns {{ status: "pass" | "not_pass", findings: string[] }}
 */
export function evaluateRuntimeHarnessDeliveryGate(options) {
  if (!isStrictRuntimeHarnessReport(options.report)) {
    return { status: "pass", findings: [] };
  }
  const stepDecisions = Array.isArray(options.report.step_decisions) ? options.report.step_decisions : [];
  if (stepDecisions.length === 0) {
    return {
      status: "not_pass",
      findings: [
        `${options.command} blocked because Runtime Harness has no routed step decisions for a strict mission. Run 'aor run start' and close Runtime Harness findings before delivery or release.`,
      ],
    };
  }
  const overallDecision = typeof options.report.overall_decision === "string" ? options.report.overall_decision : "unknown";
  if (overallDecision !== "pass") {
    return {
      status: "not_pass",
      findings: [
        `${options.command} blocked by Runtime Harness decision '${overallDecision}'. Resolve runtime findings before delivery or release.`,
      ],
    };
  }
  if (!runtimeHarnessReportHasMeaningfulPatch(options.report)) {
    return {
      status: "not_pass",
      findings: [
        `${options.command} blocked because Runtime Harness found no meaningful mission-scoped patch for a strict mission.`,
      ],
    };
  }
  return { status: "pass", findings: [] };
}

/**
 * @param {{ report: Record<string, unknown>, command: string }} options
 */
export function assertRuntimeHarnessAllowsDelivery(options) {
  const gate = evaluateRuntimeHarnessDeliveryGate(options);
  if (gate.status !== "pass") {
    throw new CliUsageError(gate.findings[0] ?? `${options.command} blocked by Runtime Harness quality gate.`);
  }
}

/**
 * @param {{
 *   projectRoot: string,
 *   stateFile: string,
 *   previousState: Record<string, unknown> | null,
 *   stepStatus: string,
 *   targetStep: string,
 *   stepResultFile: string,
 * }} options
 * @returns {Record<string, unknown>}
 */
export function finalizeRunControlState(options) {
  const terminalStatus = options.stepStatus === "passed" ? "completed" : "failed";
  const previousAuditRefs = asStringArray(options.previousState?.audit_refs);
  const previousEvidenceRefs = asStringArray(options.previousState?.step_result_refs);
  const stepResultRef = toEvidenceRef(options.projectRoot, options.stepResultFile);
  const nextStepResultRefs = uniqueStrings([...previousEvidenceRefs, stepResultRef]);
  const nextState = {
    schema_version: 1,
    run_id: typeof options.previousState?.run_id === "string" ? options.previousState.run_id : null,
    status: terminalStatus,
    current_step: options.targetStep,
    last_action: "start",
    started_at:
      typeof options.previousState?.started_at === "string"
        ? options.previousState.started_at
        : new Date().toISOString(),
    updated_at: new Date().toISOString(),
    action_sequence:
      typeof options.previousState?.action_sequence === "number" && Number.isFinite(options.previousState.action_sequence)
        ? options.previousState.action_sequence
        : 1,
    approval_refs: asStringArray(options.previousState?.approval_refs),
    audit_refs: previousAuditRefs,
    step_result_refs: nextStepResultRefs,
    evidence_root:
      typeof options.previousState?.evidence_root === "string" ? options.previousState.evidence_root : path.dirname(options.stateFile),
  };
  writeJson(options.stateFile, nextState);
  return nextState;
}

/**
 * @param {string} runRef
 * @returns {string}
 */
export function normalizeRunRef(runRef) {
  return runRef.startsWith("run://") ? runRef.slice("run://".length) : runRef;
}

/**
 * @param {Array<{ document: Record<string, unknown> }>} artifacts
 * @param {string | undefined} runId
 * @returns {Array<{ document: Record<string, unknown> }>}
 */
export function filterArtifactsByRunId(artifacts, runId) {
  if (!runId) return artifacts;
  return artifacts.filter((artifact) => artifact.document.run_id === runId);
}

/**
 * @param {string | true | undefined} value
 * @returns {Record<string, string> | undefined}
 */
export function resolveRouteOverridesFlag(value) {
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
export function resolvePolicyOverridesFlag(value) {
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
export function resolveProjectRef(projectRef, cwd) {
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
export function resolveRuntimeRoot(runtimeRootFlag, projectRoot) {
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
