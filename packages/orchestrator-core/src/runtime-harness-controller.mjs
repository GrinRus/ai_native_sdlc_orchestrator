import path from "node:path";

import { validateContractDocument } from "../../contracts/src/index.mjs";

import { initializeProjectRuntime } from "./project-init.mjs";
import { materializeRuntimeHarnessReport } from "./runtime-harness-report.mjs";
import { executeRuntimeHarnessControlledStep } from "./step-execution-engine.mjs";

const CONTROLLER_ID = "runtime-harness-run-controller";
const CONTROLLER_VERSION = "v1";

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
 * @param {unknown} value
 * @returns {string | null}
 */
function asString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
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
 * @param {string[]} values
 * @returns {string[]}
 */
function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))];
}

/**
 * @param {string} projectRoot
 * @param {string} filePath
 * @returns {string}
 */
function toEvidenceRef(projectRoot, filePath) {
  return `evidence://${path.relative(projectRoot, filePath).replace(/\\/g, "/")}`;
}

/**
 * @param {unknown} startedAt
 * @param {unknown} finishedAt
 * @returns {number | null}
 */
function resolveDurationSeconds(startedAt, finishedAt) {
  if (typeof startedAt !== "string" || typeof finishedAt !== "string") {
    return null;
  }
  const startedMs = Date.parse(startedAt);
  const finishedMs = Date.parse(finishedAt);
  if (!Number.isFinite(startedMs) || !Number.isFinite(finishedMs) || finishedMs < startedMs) {
    return null;
  }
  return Math.round(((finishedMs - startedMs) / 1000) * 1000) / 1000;
}

/**
 * @param {{
 *   runId: string,
 *   sequence: number,
 *   stage: "prepare" | "execute" | "classify" | "validate" | "retry" | "repair" | "escalate" | "verify" | "close" | "block",
 *   status: "pass" | "fail" | "blocked" | "skipped",
 *   decision: "pass" | "retry" | "repair" | "escalate" | "block" | "fail",
 *   summary: string,
 *   startedAt: string,
 *   finishedAt?: string,
 *   evidenceRefs?: string[],
 * }} options
 */
function buildTransition(options) {
  const stageSuffix = `${options.stage}.${String(options.sequence).padStart(3, "0")}`;
  const finishedAt = options.finishedAt ?? new Date().toISOString();
  return {
    transition_id: `${options.runId}.transition.${stageSuffix}`,
    stage: options.stage,
    status: options.status,
    runtime_harness_decision: options.decision,
    summary: options.summary,
    started_at: options.startedAt,
    finished_at: finishedAt,
    duration_sec: resolveDurationSeconds(options.startedAt, finishedAt),
    evidence_refs: uniqueStrings(options.evidenceRefs ?? []),
  };
}

/**
 * @param {Record<string, unknown>} stepResult
 * @returns {"pass" | "retry" | "repair" | "escalate" | "block" | "fail"}
 */
function resolveStepDecision(stepResult) {
  const decision = asString(stepResult.runtime_harness_decision);
  if (
    decision === "pass" ||
    decision === "retry" ||
    decision === "repair" ||
    decision === "escalate" ||
    decision === "block" ||
    decision === "fail"
  ) {
    return decision;
  }
  return asString(stepResult.status) === "passed" ? "pass" : "fail";
}

/**
 * @param {Record<string, unknown>} stepResult
 * @returns {"closed" | "blocked" | "failed"}
 */
function resolveTerminalStatus(stepResult) {
  const stepDecision = resolveStepDecision(stepResult);
  if (stepDecision === "pass") return "closed";
  if (stepDecision === "block" || stepDecision === "repair" || stepDecision === "retry" || stepDecision === "escalate") {
    return "blocked";
  }
  return "failed";
}

/**
 * @param {Record<string, unknown>} stepResult
 * @returns {"pass" | "fail" | "blocked"}
 */
function statusForDecision(stepResult) {
  const stepDecision = resolveStepDecision(stepResult);
  if (stepDecision === "pass") return "pass";
  if (stepDecision === "fail") return "fail";
  return "blocked";
}

/**
 * @param {Record<string, unknown>} stepResult
 * @returns {"retry" | "repair" | "escalate" | null}
 */
function resolveActionStage(stepResult) {
  const repairStatus = asString(stepResult.repair_status);
  const attempts = Array.isArray(stepResult.repair_attempts) ? stepResult.repair_attempts.map((entry) => asRecord(entry)) : [];
  const lastPolicyAction = attempts
    .map((attempt) => asString(attempt.policy_action))
    .filter((action) => action === "retry" || action === "repair" || action === "escalate")
    .at(-1);
  if (lastPolicyAction === "retry" || lastPolicyAction === "repair" || lastPolicyAction === "escalate") {
    return lastPolicyAction;
  }
  if (repairStatus === "succeeded_after_retry") return "retry";
  if (repairStatus === "succeeded_after_repair" || repairStatus === "exhausted" || repairStatus === "pending") {
    return "repair";
  }
  return null;
}

/**
 * @param {{
 *   stepResult: Record<string, unknown>,
 *   stepResultRef: string,
 *   stepResultPath: string,
 *   transitions: Array<Record<string, unknown>>,
 *   runId: string,
 *   startedAt: string,
 * }} options
 */
function buildControllerEvidence(options) {
  const terminalStatus = resolveTerminalStatus(options.stepResult);
  const stepDecision = resolveStepDecision(options.stepResult);
  const failureClass = asString(options.stepResult.failure_class);
  const repairStatus = asString(options.stepResult.repair_status);
  const summary =
    terminalStatus === "closed"
      ? "Runtime Harness closed the run with pass evidence."
      : terminalStatus === "blocked"
        ? `Runtime Harness blocked the run with decision '${stepDecision}'.`
        : `Runtime Harness failed the run with failure class '${failureClass ?? "unknown"}'.`;
  const terminalStage = terminalStatus === "closed" ? "close" : "block";
  const terminalTransition = buildTransition({
    runId: options.runId,
    sequence: options.transitions.length + 1,
    stage: terminalStage,
    status: terminalStatus === "closed" ? "pass" : terminalStatus === "blocked" ? "blocked" : "fail",
    decision: stepDecision,
    summary,
    startedAt: new Date().toISOString(),
    evidenceRefs: [options.stepResultRef],
  });
  const runTransitions = [...options.transitions, terminalTransition];
  const finishedAt = asString(terminalTransition.finished_at) ?? new Date().toISOString();
  const runController = {
    controller_id: CONTROLLER_ID,
    controller_version: CONTROLLER_VERSION,
    status: terminalStatus,
    started_at: options.startedAt,
    finished_at: finishedAt,
    transition_count: runTransitions.length,
    terminal_transition_id: terminalTransition.transition_id,
  };
  const runDecision = {
    overall_decision: stepDecision,
    terminal_status: terminalStatus,
    failure_class: failureClass,
    repair_status: repairStatus,
    summary,
    evidence_refs: uniqueStrings([options.stepResultRef, ...asStringArray(options.stepResult.evidence_refs)]),
  };
  return {
    runController,
    runTransitions,
    runDecision,
  };
}

/**
 * Execute a run through the run-level Runtime Harness controller.
 *
 * This controller owns run-stage evidence while delegating routed step work to
 * the existing step engine. The step engine remains responsible for adapter
 * invocation and bounded retry/repair mechanics.
 *
 * @param {Parameters<typeof executeRuntimeHarnessControlledStep>[0]} options
 * @returns {ReturnType<typeof executeRuntimeHarnessControlledStep> & {
 *   runtimeHarness: ReturnType<typeof materializeRuntimeHarnessReport>,
 *   runController: {
 *     runController: Record<string, unknown>,
 *     runTransitions: Array<Record<string, unknown>>,
 *     runDecision: Record<string, unknown>,
 *   },
 * }}
 */
export function executeRuntimeHarnessRun(options) {
  const startedAt = new Date().toISOString();
  const runId = options.runId ?? "runtime-harness-run";
  /** @type {Array<Record<string, unknown>>} */
  const transitions = [];

  const prepareStartedAt = new Date().toISOString();
  const init = initializeProjectRuntime(options);
  transitions.push(
    buildTransition({
      runId,
      sequence: transitions.length + 1,
      stage: "prepare",
      status: "pass",
      decision: "pass",
      summary: "Runtime Harness prepared project runtime state for run-level control.",
      startedAt: prepareStartedAt,
      evidenceRefs: [init.projectProfilePath],
    }),
  );

  const executeStartedAt = new Date().toISOString();
  const routedExecution = executeRuntimeHarnessControlledStep({
    ...options,
    runId,
  });
  const stepResultRef = toEvidenceRef(routedExecution.projectRoot, routedExecution.stepResultPath);
  const stepDecision = resolveStepDecision(routedExecution.stepResult);
  transitions.push(
    buildTransition({
      runId,
      sequence: transitions.length + 1,
      stage: "execute",
      status: statusForDecision(routedExecution.stepResult),
      decision: stepDecision,
      summary: "Runtime Harness delegated routed step execution to the step engine.",
      startedAt: executeStartedAt,
      evidenceRefs: [stepResultRef],
    }),
  );

  const classifyStartedAt = new Date().toISOString();
  transitions.push(
    buildTransition({
      runId,
      sequence: transitions.length + 1,
      stage: "classify",
      status: statusForDecision(routedExecution.stepResult),
      decision: stepDecision,
      summary: `Runtime Harness classified step outcome as '${asString(routedExecution.stepResult.failure_class) ?? "unknown"}'.`,
      startedAt: classifyStartedAt,
      evidenceRefs: [stepResultRef],
    }),
  );

  const validateStartedAt = new Date().toISOString();
  transitions.push(
    buildTransition({
      runId,
      sequence: transitions.length + 1,
      stage: "validate",
      status: statusForDecision(routedExecution.stepResult),
      decision: stepDecision,
      summary: "Runtime Harness validated mission semantics for the routed step.",
      startedAt: validateStartedAt,
      evidenceRefs: [stepResultRef],
    }),
  );

  const actionStage = resolveActionStage(routedExecution.stepResult);
  if (actionStage) {
    const actionStartedAt = new Date().toISOString();
    transitions.push(
      buildTransition({
        runId,
        sequence: transitions.length + 1,
        stage: actionStage,
        status: statusForDecision(routedExecution.stepResult),
        decision: actionStage,
        summary: `Runtime Harness recorded bounded ${actionStage} policy evidence.`,
        startedAt: actionStartedAt,
        evidenceRefs: [stepResultRef, ...asStringArray(routedExecution.stepResult.evidence_refs)],
      }),
    );
  }

  const verifyStartedAt = new Date().toISOString();
  transitions.push(
    buildTransition({
      runId,
      sequence: transitions.length + 1,
      stage: "verify",
      status: "pass",
      decision: stepDecision,
      summary: "Runtime Harness verified report contract generation inputs.",
      startedAt: verifyStartedAt,
      evidenceRefs: [stepResultRef],
    }),
  );

  const controllerEvidence = buildControllerEvidence({
    stepResult: routedExecution.stepResult,
    stepResultRef,
    stepResultPath: routedExecution.stepResultPath,
    transitions,
    runId,
    startedAt,
  });
  const runtimeHarness = materializeRuntimeHarnessReport({
    projectRef: routedExecution.projectRoot,
    cwd: routedExecution.projectRoot,
    projectProfile: options.projectProfile,
    runtimeRoot: routedExecution.runtimeRoot,
    runId,
    executionRoot: asString(options.executionRoot),
    runController: controllerEvidence.runController,
    runTransitions: controllerEvidence.runTransitions,
    runDecision: controllerEvidence.runDecision,
  });
  const validation = validateContractDocument({
    family: "runtime-harness-report",
    document: runtimeHarness.report,
    source: "runtime://runtime-harness-run-controller",
  });
  if (!validation.ok) {
    const issueSummary = validation.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Run-level Runtime Harness report failed contract validation: ${issueSummary}`);
  }

  return {
    ...routedExecution,
    runtimeHarness,
    runController: controllerEvidence,
  };
}
