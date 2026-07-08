import fs from "node:fs";
import path from "node:path";

import {
  buildArtifactDisplaySummary,
  uniqueArtifactDisplaySummaries,
} from "../artifact-display-summary.mjs";

const INTERNAL_RUNNER_PREFIX = ["live", "e2e"].join("-");
const RUN_HEALTH_REPORT_REGEX = new RegExp(`^${INTERNAL_RUNNER_PREFIX}-run-health-report-.+\\.json$`, "u");
const OBSERVATION_REPORT_REGEX = new RegExp(`^${INTERNAL_RUNNER_PREFIX}-observation-report-.+\\.json$`, "u");
const AGENT_DECISION_REQUEST_REGEX = new RegExp(`^${INTERNAL_RUNNER_PREFIX}-agent-decision-request-.+\\.json$`, "u");

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
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
 * @returns {number | null}
 */
function asNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
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
 * @param {string} filePath
 * @returns {Record<string, unknown> | null}
 */
function readJsonObject(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return asRecord(parsed);
  } catch {
    return null;
  }
}

/**
 * @param {string} dirPath
 * @returns {string[]}
 */
function listJsonFilesByFreshness(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  return fs.readdirSync(dirPath)
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => path.join(dirPath, entry))
    .sort((left, right) => {
      const leftStat = fs.statSync(left);
      const rightStat = fs.statSync(right);
      const mtimeDelta = rightStat.mtimeMs - leftStat.mtimeMs;
      return mtimeDelta !== 0 ? mtimeDelta : path.basename(right).localeCompare(path.basename(left));
    });
}

/**
 * @param {Set<string>} roots
 * @param {string | null | undefined} candidate
 */
function addExistingRoot(roots, candidate) {
  if (!candidate) return;
  const resolved = path.resolve(candidate);
  if (fs.existsSync(resolved)) {
    roots.add(resolved);
  }
}

/**
 * @param {{ projectRoot: string, runtimeLayout: { reportsRoot: string } }} init
 * @returns {string[]}
 */
function listExternalRunHealthReportRoots(init) {
  const roots = new Set();
  addExistingRoot(roots, init.runtimeLayout.reportsRoot);

  const projectRoot = path.resolve(init.projectRoot);
  const parent = path.dirname(projectRoot);
  if (path.basename(parent) === "target-checkouts") {
    addExistingRoot(roots, path.join(path.dirname(parent), "reports"));
  }

  return [...roots];
}

/**
 * @param {string | null} status
 * @returns {"critical" | "warning" | "info"}
 */
function severityForStatus(status) {
  if (["blocked", "fail", "failed", "not_pass"].includes(String(status ?? "").toLowerCase())) return "critical";
  if (["warn", "warning", "interaction_required"].includes(String(status ?? "").toLowerCase())) return "warning";
  return "info";
}

/**
 * @param {string | null} step
 * @returns {string}
 */
function stageLabel(step) {
  const normalized = String(step ?? "").trim();
  if (!normalized) return "Controller";
  return normalized
    .replace(/[-_]+/gu, " ")
    .replace(/\b\w/gu, (match) => match.toUpperCase());
}

/**
 * @param {string} reportsRoot
 * @param {string} runId
 * @param {string | null} currentStep
 * @returns {{ file: string, document: Record<string, unknown> } | null}
 */
function readPendingDecisionRequest(reportsRoot, runId, currentStep) {
  const candidates = listJsonFilesByFreshness(reportsRoot)
    .filter((filePath) => AGENT_DECISION_REQUEST_REGEX.test(path.basename(filePath)))
    .flatMap((filePath) => {
      const document = readJsonObject(filePath);
      if (!document) return [];
      if (asString(document.run_id) !== runId) return [];
      if (currentStep && asString(document.step_id) !== currentStep) return [];
      const expectedDecisionRef = asString(document.operator_decision_expected_ref);
      const decisionMaterialized = expectedDecisionRef ? fs.existsSync(expectedDecisionRef) : false;
      return decisionMaterialized ? [] : [{ file: filePath, document }];
    });
  return candidates[0] ?? null;
}

/**
 * @param {Record<string, unknown> | null} health
 * @param {Record<string, unknown> | null} controller
 * @returns {string | null}
 */
function resolveCurrentStep(health, controller) {
  const lifecycle = asRecord(health?.lifecycle_completion);
  return (
    asString(controller?.current_step) ??
    asString(lifecycle.blocked_step_id) ??
    asString(lifecycle.blocked_step_instance_id) ??
    asString(asRecord(controller?.pending_decision).next_step)
  );
}

/**
 * @param {Record<string, unknown>} failureSummary
 * @returns {Record<string, unknown> | null}
 */
function sanitizeFailureSummary(failureSummary) {
  const owner = asString(failureSummary.owner);
  const phase = asString(failureSummary.phase);
  const failureClass = asString(failureSummary.class);
  const summary = asString(failureSummary.summary);
  if (!owner && !phase && !failureClass && !summary) return null;
  return {
    owner,
    phase,
    class: failureClass,
    summary,
  };
}

/**
 * @param {Record<string, unknown>} resumeInteractionHealth
 * @returns {Record<string, unknown>}
 */
function sanitizeResumeInteractionHealth(resumeInteractionHealth) {
  return {
    status: asString(resumeInteractionHealth.status),
    pending_interaction_count: asNumber(resumeInteractionHealth.pending_interaction_count),
    pending_decision_count: asNumber(resumeInteractionHealth.pending_decision_count),
  };
}

/**
 * @param {Record<string, unknown>} pendingDecision
 * @param {{ file: string, document: Record<string, unknown> } | null} request
 * @returns {Record<string, unknown> | null}
 */
function sanitizePendingDecision(pendingDecision, request) {
  const action = asString(pendingDecision.action);
  const reason = asString(pendingDecision.reason);
  const nextStep = asString(pendingDecision.next_step);
  const requestRef = request?.file ?? null;
  const expectedDecisionRef = asString(request?.document.operator_decision_expected_ref);
  if (!action && !reason && !nextStep && !requestRef && !expectedDecisionRef) return null;
  return {
    action,
    reason,
    next_step: nextStep,
    request_ref: requestRef,
    expected_decision_ref: expectedDecisionRef,
  };
}

/**
 * @param {{
 *   status: string | null,
 *   currentStep: string | null,
 *   failureSummary: Record<string, unknown> | null,
 *   missingOperatorDecisionSteps: string[],
 *   missingEvidenceRefs: string[],
 *   pendingDecision: Record<string, unknown> | null,
 * }} input
 * @returns {Array<Record<string, unknown>>}
 */
function buildBlockers(input) {
  const blockers = [];
  if (input.failureSummary && ["blocked", "fail", "failed", "not_pass"].includes(String(input.status ?? "").toLowerCase())) {
    blockers.push({
      code: asString(input.failureSummary.class) ?? "run_health_blocked",
      severity: severityForStatus(input.status),
      summary: asString(input.failureSummary.summary) ?? "Run-health is blocked.",
    });
  }
  for (const step of input.missingOperatorDecisionSteps) {
    blockers.push({
      code: `run_health.${step}.operator_decision_missing`,
      severity: "critical",
      summary: `${stageLabel(step)} is waiting for an accepted operator decision.`,
    });
  }
  if (input.pendingDecision?.action) {
    blockers.push({
      code: `run_health.${input.currentStep ?? "current"}.pending_${input.pendingDecision.action}`,
      severity: "warning",
      summary:
        asString(input.pendingDecision.reason) ??
        `${stageLabel(input.currentStep)} is waiting for ${input.pendingDecision.action}.`,
    });
  }
  if (input.missingEvidenceRefs.length > 0) {
    blockers.push({
      code: "run_health.missing_evidence",
      severity: "critical",
      summary: `${input.missingEvidenceRefs.length} required run-health evidence ref${input.missingEvidenceRefs.length === 1 ? "" : "s"} missing.`,
    });
  }
  return blockers;
}

/**
 * @param {Record<string, unknown>} projection
 * @param {{ healthFile: string, observationFile: string | null, decisionRequestFile: string | null }}
 * @returns {Record<string, unknown>[]}
 */
function buildDisplaySummaries(projection, files) {
  const status = asString(projection.status) ?? "ready";
  const currentStep = asString(projection.current_step);
  const failureSummary = asRecord(projection.failure_summary);
  const summaries = [
    buildArtifactDisplaySummary({
      file: files.healthFile,
      artifactRef: `run-health://report/${projection.run_id}`,
      sourceRef: files.healthFile,
      rawRef: files.healthFile,
      type: "run-health",
      stage: currentStep ?? "delivery",
      label: "Run health",
      description:
        asString(failureSummary.summary) ??
        `${stageLabel(currentStep)} run-health is ${status}.`,
      status,
      timestamp: asString(projection.generated_at),
    }),
  ];
  if (files.observationFile) {
    summaries.push(buildArtifactDisplaySummary({
      file: files.observationFile,
      artifactRef: `run-health://observation/${projection.run_id}`,
      sourceRef: files.observationFile,
      rawRef: files.observationFile,
      type: "run-observation",
      stage: currentStep ?? "delivery",
      label: "Run observation",
      description: `${stageLabel(currentStep)} step journal is ${status}.`,
      status,
      timestamp: asString(projection.generated_at),
    }));
  }
  if (files.decisionRequestFile) {
    summaries.push(buildArtifactDisplaySummary({
      file: files.decisionRequestFile,
      artifactRef: `run-health://operator-decision-request/${projection.run_id}/${currentStep ?? "current"}`,
      sourceRef: files.decisionRequestFile,
      rawRef: files.decisionRequestFile,
      type: "operator-request",
      stage: currentStep ?? "delivery",
      label: `${stageLabel(currentStep)} operator decision request`,
      description: `${stageLabel(currentStep)} requires an accepted operator decision before the run can continue.`,
      status: "awaiting-decision",
      timestamp: asString(projection.generated_at),
    }));
  }
  return uniqueArtifactDisplaySummaries(summaries);
}

/**
 * @param {{ projectRoot: string, runtimeLayout: { reportsRoot: string } }} init
 * @param {{ limit?: number }} [options]
 * @returns {Array<Record<string, unknown>>}
 */
export function listExternalRunHealthProjectionsForRuntime(init, options = {}) {
  const entries = [];
  for (const reportsRoot of listExternalRunHealthReportRoots(init)) {
    for (const healthFile of listJsonFilesByFreshness(reportsRoot).filter((filePath) => RUN_HEALTH_REPORT_REGEX.test(path.basename(filePath)))) {
      const health = readJsonObject(healthFile);
      const runId = asString(health?.run_id);
      if (!health || !runId) continue;
      const controllerRef = asString(asRecord(health.controller_health).controller_state_ref);
      const controller = (controllerRef ? readJsonObject(controllerRef) : null)
        ?? readJsonObject(path.join(reportsRoot, `${INTERNAL_RUNNER_PREFIX}-controller-state-${runId}.json`));
      const observationRef = asString(health.source_observation_report_file);
      const observation = observationRef && OBSERVATION_REPORT_REGEX.test(path.basename(observationRef))
        ? readJsonObject(observationRef)
        : null;
      const currentStep = resolveCurrentStep(health, controller);
      const decisionRequest = readPendingDecisionRequest(reportsRoot, runId, currentStep);
      const lifecycle = asRecord(health.lifecycle_completion);
      const controllerHealth = asRecord(health.controller_health);
      const evidenceHealth = asRecord(health.evidence_health);
      const pendingDecision = sanitizePendingDecision(asRecord(controller?.pending_decision), decisionRequest);
      const failureSummary = sanitizeFailureSummary(asRecord(health.failure_summary));
      const missingOperatorDecisionSteps = Array.from(new Set([
        ...asStringArray(lifecycle.missing_operator_decision_steps),
        ...asStringArray(controllerHealth.missing_operator_decision_steps),
      ]));
      const missingEvidenceRefs = asStringArray(evidenceHealth.missing_evidence_refs);
      const status = asString(health.overall_status) ?? asString(observation?.overall_status);
      const projection = {
        run_id: runId,
        profile_id: asString(health.profile_id),
        status,
        report_status: asString(observation?.report_status),
        generated_at: asString(health.generated_at),
        current_step: currentStep,
        blocked_step_id: asString(lifecycle.blocked_step_id),
        pending_steps: asStringArray(lifecycle.pending_steps),
        completed_steps: asStringArray(controller?.completed_steps),
        missing_operator_decision_steps: missingOperatorDecisionSteps,
        missing_evidence_refs: missingEvidenceRefs,
        failure_summary: failureSummary,
        pending_decision: pendingDecision,
        resume_interaction_health: sanitizeResumeInteractionHealth(asRecord(health.resume_interaction_health)),
        controller_health: {
          status: asString(controllerHealth.status),
          controller_state_ref: controllerRef,
          missing_phase_evidence: asStringArray(controllerHealth.missing_phase_evidence),
          rejected_operator_decision_steps: asStringArray(controllerHealth.rejected_operator_decision_steps),
        },
        report_ref: healthFile,
        source_observation_report_ref: observationRef,
      };
      projection.blockers = buildBlockers({
        status,
        currentStep,
        failureSummary,
        missingOperatorDecisionSteps,
        missingEvidenceRefs,
        pendingDecision,
      });
      projection.artifact_display_summaries = buildDisplaySummaries(projection, {
        healthFile,
        observationFile: observationRef,
        decisionRequestFile: decisionRequest?.file ?? null,
      });
      entries.push({
        projection,
        timelineMs: Date.parse(String(projection.generated_at ?? "")) || fs.statSync(healthFile).mtimeMs,
      });
    }
  }

  const sorted = entries
    .sort((left, right) => right.timelineMs - left.timelineMs)
    .map((entry) => entry.projection);
  const limit = Number.isFinite(Number(options.limit)) && Number(options.limit) >= 0 ? Math.floor(Number(options.limit)) : null;
  return limit === null ? sorted : sorted.slice(0, limit);
}

/**
 * @param {{ projectRoot: string, runtimeLayout: { reportsRoot: string } }} init
 * @returns {Record<string, unknown> | null}
 */
export function readLatestExternalRunHealthProjectionForRuntime(init) {
  return listExternalRunHealthProjectionsForRuntime(init, { limit: 1 })[0] ?? null;
}

/**
 * @param {{ projectRoot: string, runtimeLayout: { reportsRoot: string } }} init
 * @param {{ limit?: number }} [options]
 * @returns {Array<Record<string, unknown>>}
 */
export function listExternalRunHealthArtifactDisplaySummariesForRuntime(init, options = {}) {
  const summaries = listExternalRunHealthProjectionsForRuntime(init, options)
    .flatMap((entry) => Array.isArray(entry.artifact_display_summaries) ? entry.artifact_display_summaries : []);
  return uniqueArtifactDisplaySummaries(summaries);
}
