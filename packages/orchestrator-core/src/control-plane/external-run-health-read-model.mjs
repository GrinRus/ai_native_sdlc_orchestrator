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
const OPERATOR_DECISION_REGEX = new RegExp(`^${INTERNAL_RUNNER_PREFIX}-operator-decision-.+\\.json$`, "u");
const QUALITY_ASSESSMENT_REPORT_REGEX = new RegExp(`^${INTERNAL_RUNNER_PREFIX}-step-quality-assessment-report-.+\\.json$`, "u");
const DECISION_RUBRIC_REF_LIMIT = 5;
const DECISION_RUBRIC_CHECK_LIMIT = 5;

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
 * @param {string[]} values
 * @returns {string[]}
 */
function uniqueStrings(values) {
  const seen = new Set();
  const unique = [];
  for (const value of values) {
    const normalized = String(value ?? "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(normalized);
  }
  return unique;
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
 * @param {string} filePath
 * @returns {string}
 */
function comparableFilePath(filePath) {
  try {
    return fs.realpathSync.native(filePath);
  } catch {
    return path.resolve(filePath);
  }
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
  if (normalized.toLowerCase() === "qa") return "QA";
  return normalized
    .replace(/[-_]+/gu, " ")
    .replace(/\b\w/gu, (match) => match.toUpperCase());
}

/**
 * @param {string} value
 * @returns {string}
 */
function decisionRubricEvidenceLabel(value) {
  const normalized = path.basename(String(value ?? "")).toLowerCase();
  if (normalized.includes("agent-decision-request") || normalized.includes("operator-decision-request")) return "Decision request";
  if (normalized.includes("step-plan")) return "Step plan";
  if (normalized.includes("step-inspection")) return "Step inspection";
  if (normalized.includes("step-classification")) return "Step classification";
  if (normalized.includes("step-observation")) return "Step observation";
  if (normalized.includes("run-health")) return "Run health";
  return "Evidence artifact";
}

/**
 * @param {Record<string, unknown>} document
 * @returns {Record<string, unknown> | null}
 */
function sanitizeDecisionRubricSummary(document) {
  const rubric = asRecord(document.decision_rubric);
  const expectedResponse = asRecord(document.expected_response_shape);
  const deterministic = asRecord(document.deterministic_analysis);
  const requiredChecks = asStringArray(rubric.required_checks);
  const evidenceRefs = uniqueStrings([
    ...asStringArray(rubric.required_evidence_refs),
    ...asStringArray(expectedResponse.evidence_refs),
    ...asStringArray(expectedResponse.inspected_evidence_refs),
  ]);
  const actionOptions = uniqueStrings((asString(expectedResponse.action) ?? "")
    .split("|")
    .map((entry) => entry.trim()));
  if (requiredChecks.length === 0 && evidenceRefs.length === 0 && actionOptions.length === 0) return null;
  return {
    step_id: asString(document.step_id),
    required_check_count: requiredChecks.length,
    required_evidence_ref_count: evidenceRefs.length,
    required_checks: requiredChecks.slice(0, DECISION_RUBRIC_CHECK_LIMIT),
    evidence_refs: evidenceRefs.slice(0, DECISION_RUBRIC_REF_LIMIT).map((ref) => ({
      label: decisionRubricEvidenceLabel(ref),
      ref,
    })),
    evidence_ref_overflow_count: Math.max(0, evidenceRefs.length - DECISION_RUBRIC_REF_LIMIT),
    action_options: actionOptions,
    deterministic_status: asString(deterministic.status),
    recommended_action: asString(deterministic.recommendation),
    failure_class: asString(deterministic.failure_class),
  };
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
 * @param {string} reportsRoot
 * @param {string} runId
 * @param {string | null} currentStep
 * @param {Record<string, unknown>} pendingDecision
 * @returns {{ file: string, document: Record<string, unknown>, request: { file: string, document: Record<string, unknown> } | null } | null}
 */
function readMaterializedOperatorDecision(reportsRoot, runId, currentStep, pendingDecision) {
  const action = asString(pendingDecision.action);
  if (!action || action === "continue") return null;
  const candidates = listJsonFilesByFreshness(reportsRoot)
    .filter((filePath) => OPERATOR_DECISION_REGEX.test(path.basename(filePath)))
    .flatMap((filePath) => {
      const document = readJsonObject(filePath);
      if (!document) return [];
      if (asString(document.action) !== action) return [];
      const sourceRequestRef = asString(document.source_agent_decision_request_ref);
      const sourceRequest = sourceRequestRef ? readJsonObject(sourceRequestRef) : null;
      const sourceRunId = asString(sourceRequest?.run_id);
      if (sourceRunId && sourceRunId !== runId) return [];
      if (!sourceRunId && !path.basename(filePath).includes(runId)) return [];
      const decisionStep = asString(document.step_id) ?? asString(sourceRequest?.step_id);
      if (currentStep && decisionStep && decisionStep !== currentStep) return [];
      if (currentStep && !decisionStep && !path.basename(filePath).includes(currentStep)) return [];
      return [{
        file: filePath,
        document,
        request: sourceRequestRef && sourceRequest ? { file: sourceRequestRef, document: sourceRequest } : null,
      }];
    });
  return candidates[0] ?? null;
}

/**
 * @param {string} reportsRoot
 * @param {string} runId
 * @param {string | null} currentStep
 * @param {string | null} operatorDecisionRef
 * @returns {{ file: string, document: Record<string, unknown> } | null}
 */
function readLatestQualityAssessmentReport(reportsRoot, runId, currentStep, operatorDecisionRef) {
  const candidates = listJsonFilesByFreshness(reportsRoot)
    .filter((filePath) => QUALITY_ASSESSMENT_REPORT_REGEX.test(path.basename(filePath)))
    .flatMap((filePath) => {
      const document = readJsonObject(filePath);
      if (!document) return [];
      if (asString(document.run_id) !== runId) return [];
      if (currentStep && asString(document.step_id) !== currentStep) return [];
      const sourceOperatorDecisionFile = asString(document.source_operator_decision_file);
      if (
        operatorDecisionRef &&
        sourceOperatorDecisionFile &&
        comparableFilePath(sourceOperatorDecisionFile) !== comparableFilePath(operatorDecisionRef)
      ) {
        return [];
      }
      return [{ file: filePath, document }];
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
 * @param {{ file: string, document: Record<string, unknown> } | null} report
 * @returns {Record<string, unknown> | null}
 */
function sanitizeQualityAssessmentSummary(report) {
  if (!report) return null;
  const document = asRecord(report.document);
  const status = asString(document.status);
  const decision = asString(document.decision);
  const repairLineage = asRecord(document.repair_lineage);
  const summary = {
    report_ref: report.file,
    status,
    decision,
    public_repair_command: asString(repairLineage.public_repair_command),
    repair_instructions: asStringArray(document.repair_instructions),
    findings: asStringArray(document.findings).slice(0, 3),
  };
  return status || decision || summary.public_repair_command || summary.repair_instructions.length > 0
    ? summary
    : null;
}

/**
 * @param {Record<string, unknown>} pendingDecision
 * @param {{ file: string, document: Record<string, unknown> } | null} request
 * @param {{ operatorDecision?: { file: string, document: Record<string, unknown> } | null, qualityAssessmentReport?: { file: string, document: Record<string, unknown> } | null }} [options]
 * @returns {Record<string, unknown> | null}
 */
function sanitizePendingDecision(pendingDecision, request, options = {}) {
  const action = asString(pendingDecision.action);
  const reason = asString(pendingDecision.reason);
  const nextStep = asString(pendingDecision.next_step);
  const requestRef = request?.file ?? null;
  const expectedDecisionRef = asString(request?.document.operator_decision_expected_ref);
  const operatorDecision = options.operatorDecision ?? null;
  const operatorDecisionDocument = asRecord(operatorDecision?.document);
  const operatorDecisionRef = operatorDecision?.file ?? null;
  const qualityAssessment = sanitizeQualityAssessmentSummary(options.qualityAssessmentReport ?? null);
  if (!action && !reason && !nextStep && !requestRef && !expectedDecisionRef && !operatorDecisionRef && !qualityAssessment) return null;
  const sanitized = {
    action,
    reason,
    next_step: nextStep,
    request_ref: requestRef,
    expected_decision_ref: expectedDecisionRef,
  };
  const operatorDecisionStatus = asString(operatorDecisionDocument.status);
  if (operatorDecisionRef) sanitized.operator_decision_ref = operatorDecisionRef;
  if (operatorDecisionStatus) {
    sanitized.operator_decision_status = operatorDecisionStatus;
    sanitized.status = operatorDecisionStatus;
  }
  const semanticStatus = asString(asRecord(operatorDecisionDocument.semantic_analysis).status);
  if (semanticStatus) sanitized.semantic_status = semanticStatus;
  if (qualityAssessment) {
    sanitized.quality_assessment = qualityAssessment;
    sanitized.quality_assessment_status = qualityAssessment.status;
    sanitized.quality_assessment_decision = qualityAssessment.decision;
    sanitized.quality_assessment_report_ref = qualityAssessment.report_ref;
    sanitized.public_repair_command = qualityAssessment.public_repair_command;
  }
  const rubricSummary = request ? sanitizeDecisionRubricSummary(request.document) : null;
  if (rubricSummary) {
    sanitized.decision_rubric_summary = rubricSummary;
  }
  return sanitized;
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
 * @param {{ healthFile: string, observationFile: string | null, decisionRequest: { file: string, document: Record<string, unknown> } | null }}
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
  if (files.decisionRequest) {
    const pendingDecision = asRecord(projection.pending_decision);
    const action = asString(pendingDecision.action);
    const decisionStatus = asString(pendingDecision.operator_decision_status) ?? asString(pendingDecision.status) ?? "awaiting-decision";
    const description = decisionStatus === "accepted" && action && action !== "continue"
      ? `${stageLabel(currentStep)} ${action} decision was recorded; use linked repair or retry evidence before continuing.`
      : `${stageLabel(currentStep)} requires an accepted operator decision before the run can continue.`;
    const decisionSummary = buildArtifactDisplaySummary({
      file: files.decisionRequest.file,
      artifactRef: `run-health://operator-decision-request/${projection.run_id}/${currentStep ?? "current"}`,
      sourceRef: files.decisionRequest.file,
      rawRef: files.decisionRequest.file,
      type: "operator-request",
      stage: currentStep ?? "delivery",
      label: `${stageLabel(currentStep)} operator decision request`,
      description,
      status: decisionStatus,
      timestamp: asString(projection.generated_at),
    });
    const rubricSummary = sanitizeDecisionRubricSummary(files.decisionRequest.document);
    if (rubricSummary) {
      decisionSummary.decision_rubric_summary = rubricSummary;
    }
    summaries.push(decisionSummary);
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
      const controllerPendingDecision = asRecord(controller?.pending_decision);
      const pendingDecisionRequest = readPendingDecisionRequest(reportsRoot, runId, currentStep);
      const materializedOperatorDecision = pendingDecisionRequest
        ? null
        : readMaterializedOperatorDecision(reportsRoot, runId, currentStep, controllerPendingDecision);
      const decisionRequest = pendingDecisionRequest ?? materializedOperatorDecision?.request ?? null;
      const qualityAssessmentReport = readLatestQualityAssessmentReport(
        reportsRoot,
        runId,
        currentStep,
        materializedOperatorDecision?.file ?? null,
      );
      const lifecycle = asRecord(health.lifecycle_completion);
      const controllerHealth = asRecord(health.controller_health);
      const evidenceHealth = asRecord(health.evidence_health);
      const pendingDecision = sanitizePendingDecision(controllerPendingDecision, decisionRequest, {
        operatorDecision: materializedOperatorDecision,
        qualityAssessmentReport,
      });
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
          rejection_reason: asString(controllerHealth.rejection_reason),
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
        decisionRequest,
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
