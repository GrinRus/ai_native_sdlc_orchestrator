import path from "node:path";

import { validateContractDocument } from "./contracts/index.mjs";
import {
  UsageError,
  asNonEmptyString,
  asRecord,
  asStringArray,
  fileExists,
  normalizeId,
  nowIso,
  readJson,
  uniqueStrings,
  writeJson,
} from "./common.mjs";

export const STEP_QUALITY_RUBRIC_VERSION = "live-e2e-step-quality.v1";
const BASE_STEP_QUALITY_DIMENSIONS = Object.freeze([
  "traceability",
  "completeness",
  "actionability",
  "evidence_strength",
  "black_box_boundary",
]);
const PRODUCT_EXECUTION_STEP_QUALITY_DIMENSIONS = Object.freeze([
  "mission_relevance",
  "verification_relevance",
  "repair_necessity",
]);
const PRODUCT_QA_STEP_QUALITY_DIMENSIONS = Object.freeze([
  "verification_relevance",
  "regression_signal_quality",
  "mission_relevance",
  "repair_necessity",
]);

/**
 * @param {string} action
 * @returns {"continue" | "request-repair" | "retry" | "block"}
 */
export function normalizeStepQualityDecision(action) {
  if (action === "request-repair" || action === "repair") return "request-repair";
  if (action === "retry" || action === "retry_public_step") return "retry";
  if (action === "block" || action === "diagnose") return "block";
  return "continue";
}

/**
 * @param {"continue" | "request-repair" | "retry" | "block"} decision
 * @returns {"accepted" | "request_repair" | "retry" | "blocked"}
 */
export function statusFromStepQualityDecision(decision) {
  if (decision === "request-repair") return "request_repair";
  if (decision === "retry") return "retry";
  if (decision === "block") return "blocked";
  return "accepted";
}

/**
 * @param {{
 *   featureSize?: string,
 *   missionClass?: string,
 * }} options
 */
export function requiresAcceptedProductStepQuality(options) {
  return (
    options.missionClass === "product-change" &&
    ["medium", "large", "xlarge"].includes(asNonEmptyString(options.featureSize))
  );
}

/**
 * @param {string} stepId
 * @param {boolean} productQualityRequired
 * @returns {string[]}
 */
function requiredStepQualityDimensions(stepId, productQualityRequired) {
  if (!productQualityRequired) return [...BASE_STEP_QUALITY_DIMENSIONS];
  if (["execution", "review"].includes(stepId)) {
    return [...BASE_STEP_QUALITY_DIMENSIONS, ...PRODUCT_EXECUTION_STEP_QUALITY_DIMENSIONS];
  }
  if (stepId === "qa") {
    return [...BASE_STEP_QUALITY_DIMENSIONS, ...PRODUCT_QA_STEP_QUALITY_DIMENSIONS];
  }
  return [...BASE_STEP_QUALITY_DIMENSIONS];
}

/**
 * @param {{
 *   stepId: string,
 *   inspectedEvidenceRefs: string[],
 *   productQualityRequired?: boolean,
 * }} options
 */
function buildStepQualityDimensions(options) {
  const refs = options.inspectedEvidenceRefs;
  const dimension = {
    status: "pass",
    evidence_strength: refs.length > 0 ? "strong" : "medium",
    inspected_evidence_refs: refs,
  };
  const findingSuffix = options.productQualityRequired
    ? "from evaluator-inspected public evidence"
    : "from lightweight flow-health evidence";
  /** @type {Record<string, Record<string, unknown>>} */
  const dimensions = {
    traceability: {
      ...dimension,
      summary: `${options.stepId} cites the public decision request, operator decision, and inspected evidence refs.`,
      findings: [`${options.stepId} traceability is supported ${findingSuffix}.`],
    },
    completeness: {
      ...dimension,
      summary: `${options.stepId} completed the required controller phases before continuation.`,
      findings: [`${options.stepId} completeness is supported ${findingSuffix}.`],
    },
    actionability: {
      ...dimension,
      summary: `${options.stepId} produced an explicit next action through the public operator decision artifact.`,
      findings: [`${options.stepId} actionability is supported ${findingSuffix}.`],
    },
    evidence_strength: {
      ...dimension,
      summary: `${options.stepId} has materialized public evidence refs for evaluator inspection.`,
      findings: [`${options.stepId} evidence strength is supported ${findingSuffix}.`],
    },
    black_box_boundary: {
      ...dimension,
      summary: `${options.stepId} assessment is derived from public live E2E artifacts only.`,
      findings: [`${options.stepId} black-box boundary is supported ${findingSuffix}.`],
    },
  };
  if (options.productQualityRequired && ["execution", "review"].includes(options.stepId)) {
    const stepLabel = options.stepId === "execution" ? "Execution" : "Review";
    dimensions.mission_relevance = {
      ...dimension,
      summary: `${stepLabel} evidence was checked for mission-relevant target changes before continuation.`,
      findings: [
        `${options.stepId} mission relevance was assessed from changed-path, verification, review, and observation refs.`,
      ],
    };
    dimensions.verification_relevance = {
      ...dimension,
      summary: `${stepLabel} verification evidence was checked against the observed target change surface.`,
      findings: [
        `${options.stepId} verification relevance was assessed before allowing the public lifecycle to continue.`,
      ],
    };
    dimensions.repair_necessity = {
      ...dimension,
      summary: `${stepLabel} next action was checked for continue versus public repair routing.`,
      findings: [
        `${options.stepId} repair necessity was assessed through the public operator decision and review evidence.`,
      ],
	    };
	  }
	  if (options.productQualityRequired && options.stepId === "qa") {
	    dimensions.verification_relevance = {
	      ...dimension,
	      summary: "QA verification evidence was checked against the final reviewed target change surface.",
	      findings: [
	        "qa verification relevance was assessed from evaluation, diagnostic verification, review, and changed-path evidence refs.",
	      ],
	    };
	    dimensions.regression_signal_quality = {
	      ...dimension,
	      summary: "QA evidence was checked for a meaningful regression signal rather than command completion alone.",
	      findings: [
	        "qa regression signal quality was assessed from public evaluation and diagnostic verification artifacts.",
	      ],
	    };
	    dimensions.mission_relevance = {
	      ...dimension,
	      summary: "QA evidence was checked for relevance to the catalog mission and final changed paths.",
	      findings: [
	        "qa mission relevance was assessed from mission, changed-path, review, and verification evidence.",
	      ],
	    };
	    dimensions.repair_necessity = {
	      ...dimension,
	      summary: "QA findings were checked for continue versus public QA-origin repair routing.",
	      findings: [
	        "qa repair necessity was assessed before delivery using public evaluator and diagnostic evidence.",
	      ],
	    };
	  }
	  return dimensions;
	}

/**
 * @param {Record<string, unknown>} artifacts
 * @returns {Record<string, unknown>}
 */
function buildQualityCycleContext(artifacts) {
  return {
    evaluation_status: asNonEmptyString(artifacts.evaluation_status) || "unknown",
    evaluation_report_ref: asNonEmptyString(artifacts.evaluation_report_file),
    diagnostic_verification_status: asNonEmptyString(artifacts.post_run_diagnostic_status) || "unknown",
    diagnostic_verification_refs: uniqueStrings([
      asNonEmptyString(artifacts.post_run_diagnostic_verify_summary_file),
      ...asStringArray(artifacts.post_run_diagnostic_verify_step_result_files),
    ]),
    primary_verification_status: asNonEmptyString(artifacts.post_run_verify_status) || "unknown",
    primary_verification_ref: asNonEmptyString(artifacts.post_run_verify_summary_file),
    review_report_ref: asNonEmptyString(artifacts.review_report_file),
    review_decision_refs: uniqueStrings([
      asNonEmptyString(artifacts.review_decision_file),
      ...asStringArray(artifacts.review_repair_decision_files),
    ]),
    meaningful_changed_paths: uniqueStrings(asStringArray(artifacts.meaningful_changed_paths)),
    repair_necessity:
      asNonEmptyString(artifacts.post_run_diagnostic_status) === "fail" ||
      asNonEmptyString(artifacts.evaluation_status) === "fail"
        ? "qa-origin-repair-required"
        : "continue-when-review-and-qa-pass",
  };
}

/**
 * @param {{
 *   profile?: Record<string, unknown>,
 *   artifacts?: Record<string, unknown>,
 *   summary?: Record<string, unknown>,
 * }} options
 */
export function resolveStepQualityContext(options = {}) {
  const profile = asRecord(options.profile);
  const artifacts = asRecord(options.artifacts);
  const summary = asRecord(options.summary);
  const featureSize =
    asNonEmptyString(artifacts.feature_size) ||
    asNonEmptyString(profile.feature_size) ||
    asNonEmptyString(summary.feature_size) ||
    "small";
  const missionClass =
    asNonEmptyString(artifacts.mission_class) ||
    asNonEmptyString(profile.mission_class) ||
    asNonEmptyString(summary.mission_class) ||
    (featureSize === "small" ? "flow-regression" : "product-change");

  return {
    profileId:
      asNonEmptyString(summary.profile_id) ||
      asNonEmptyString(profile.profile_id) ||
      "unknown-profile",
    targetCatalogId:
      asNonEmptyString(artifacts.target_catalog_id) ||
      asNonEmptyString(summary.target_catalog_id) ||
      asNonEmptyString(profile.target_catalog_id) ||
      "unknown-target",
    featureMissionId:
      asNonEmptyString(artifacts.feature_mission_id) ||
      asNonEmptyString(summary.feature_mission_id) ||
      asNonEmptyString(profile.feature_mission_id) ||
      "unknown-mission",
    featureSize,
    missionClass,
  };
}

/**
 * @param {{
 *   runId: string,
 *   entry: Record<string, unknown>,
 *   outputDir: string,
 *   requestFile?: string,
 *   reportFile?: string,
 * }} options
 */
export function resolveStepQualityFiles(options) {
  const entry = asRecord(options.entry);
  const stepId = asNonEmptyString(entry.step_id) || "step";
  const stepInstanceId = asNonEmptyString(entry.step_instance_id) || stepId;
  const sequence = String(entry.sequence ?? 1).padStart(2, "0");
  const stem = `${normalizeId(options.runId)}-${sequence}-${normalizeId(stepInstanceId)}`;
  return {
    requestFile:
      asNonEmptyString(options.requestFile) ||
      path.join(options.outputDir, `live-e2e-step-quality-assessment-request-${stem}.json`),
    reportFile:
      asNonEmptyString(options.reportFile) ||
      path.join(options.outputDir, `live-e2e-step-quality-assessment-report-${stem}.json`),
  };
}

/**
 * @param {Record<string, unknown>} entry
 */
function collectStepQualityEvidenceRefs(entry) {
  return uniqueStrings([
    asNonEmptyString(entry.agent_decision_request_ref),
    asNonEmptyString(entry.operator_decision_ref),
    asNonEmptyString(entry.plan_ref),
    asNonEmptyString(entry.execution_ref),
    asNonEmptyString(entry.inspection_ref),
    asNonEmptyString(entry.classification_ref),
    ...asStringArray(entry.inspected_evidence_refs),
    ...asStringArray(entry.artifact_refs),
    asNonEmptyString(entry.transcript_ref),
  ]);
}

/**
 * @param {{
 *   runId: string,
 *   profile?: Record<string, unknown>,
 *   artifacts?: Record<string, unknown>,
 *   summary?: Record<string, unknown>,
 *   entry: Record<string, unknown>,
 *   outputDir: string,
 * }} options
 */
export function buildStepQualityAssessmentRequest(options) {
  const context = resolveStepQualityContext(options);
  const entry = asRecord(options.entry);
  const stepId = asNonEmptyString(entry.step_id) || "step";
  const files = resolveStepQualityFiles(options);
  const productQualityRequired = requiresAcceptedProductStepQuality(context);
  const evidenceRefs = collectStepQualityEvidenceRefs(entry);
  const evaluatorMode = productQualityRequired ? "product-step-quality" : "flow-health";
  const requestedAssessmentMethod = productQualityRequired ? "external-skill-agent" : "flow-health-automatic";
	  const request = {
    request_id: `${normalizeId(options.runId)}.${normalizeId(asNonEmptyString(entry.step_instance_id) || stepId)}.step-quality-request.v1`,
    run_id: options.runId,
    profile_id: context.profileId,
    generated_at: nowIso(),
    evaluator: {
      kind: "skill-agent",
      ref: "skill://live-e2e-runner",
      mode: evaluatorMode,
      responsibility: productQualityRequired
        ? "Assess product-change step quality from public artifacts before continuation."
        : "Confirm the live E2E flow step has public evidence before canary continuation.",
    },
    target_catalog_id: context.targetCatalogId,
    feature_mission_id: context.featureMissionId,
    feature_size: context.featureSize,
    mission_class: context.missionClass,
    step_id: stepId,
    step_name: asNonEmptyString(entry.step_name) || stepId,
    step_iteration: typeof entry.iteration === "number" ? entry.iteration : 1,
    source_agent_decision_request_file: asNonEmptyString(entry.agent_decision_request_ref),
    source_operator_decision_file: asNonEmptyString(entry.operator_decision_ref),
    requested_assessment_method: requestedAssessmentMethod,
    rubric_version: STEP_QUALITY_RUBRIC_VERSION,
	    rubric: {
	      required_dimensions: requiredStepQualityDimensions(stepId, productQualityRequired),
      continuation_rule: productQualityRequired
        ? "Continue only after a linked accepted evaluator-authored step-quality report."
        : "Continue after lightweight flow-health evidence is materialized.",
      repair_boundary:
        "Repair decisions must route through public AOR review/repair commands and must not mutate the target checkout directly.",
    },
	    evaluator_input_refs: evidenceRefs,
	    expected_assessment_report_file: files.reportFile,
	    evidence_refs: evidenceRefs,
	  };
	  if (productQualityRequired && stepId === "qa") {
	    request.quality_cycle_context = buildQualityCycleContext(asRecord(options.artifacts));
	  }
	  return { request, requestFile: files.requestFile, reportFile: files.reportFile, context };
	}

/**
 * @param {{
 *   runId: string,
 *   profile?: Record<string, unknown>,
 *   artifacts?: Record<string, unknown>,
 *   summary?: Record<string, unknown>,
 *   entry: Record<string, unknown>,
 *   outputDir: string,
 * }} options
 */
export function writeStepQualityAssessmentRequest(options) {
  const built = buildStepQualityAssessmentRequest(options);
  const validation = validateContractDocument({
    family: "live-e2e-step-quality-assessment-request",
    document: built.request,
    source: built.requestFile,
  });
  if (!validation.ok) {
    const validationIssues = validation.issues.map((entry) => entry.message).join("; ");
    throw new UsageError(
      `Step quality assessment request for '${asNonEmptyString(options.entry.step_id) || "step"}' failed contract validation: ${validationIssues}`,
    );
  }
  writeJson(built.requestFile, built.request);
  return built;
}

/**
 * @param {{
 *   runId: string,
 *   profile?: Record<string, unknown>,
 *   artifacts?: Record<string, unknown>,
 *   summary?: Record<string, unknown>,
 *   entry: Record<string, unknown>,
 *   outputDir: string,
 *   assessmentRequestFile?: string,
 *   assessmentRequest?: Record<string, unknown>,
 *   assessmentMethod?: string,
 *   evaluatorOutputRef?: string,
 *   assessmentDecision?: string,
 * }} options
 */
export function buildStepQualityAssessment(options) {
  const context = resolveStepQualityContext(options);
  const entry = asRecord(options.entry);
  const stepId = asNonEmptyString(entry.step_id) || "step";
  const stepInstanceId = asNonEmptyString(entry.step_instance_id) || stepId;
  const candidateDecision = asRecord(entry.step_quality_candidate_decision);
  const action =
    asNonEmptyString(options.assessmentDecision) ||
    asNonEmptyString(candidateDecision.action) ||
    asNonEmptyString(asRecord(entry.decision).action) ||
    "continue";
  const decision = normalizeStepQualityDecision(action);
  const inspectedEvidenceRefs = asStringArray(entry.inspected_evidence_refs);
  const productQualityRequired = requiresAcceptedProductStepQuality(context);
  const files = resolveStepQualityFiles(options);
  const assessmentRequest = asRecord(options.assessmentRequest);
  const evaluatorInputRefs = uniqueStrings([
    ...asStringArray(options.assessmentRequest?.evaluator_input_refs),
    ...asStringArray(assessmentRequest.evaluator_input_refs),
    ...collectStepQualityEvidenceRefs(entry),
  ]);
  const assessmentMethod =
    asNonEmptyString(options.assessmentMethod) ||
    asNonEmptyString(assessmentRequest.requested_assessment_method) ||
    (productQualityRequired ? "external-skill-agent" : "flow-health-automatic");
  const sourceAssessmentRequestFile =
    asNonEmptyString(options.assessmentRequestFile) ||
    asNonEmptyString(entry.step_quality_assessment_request_ref) ||
    asNonEmptyString(assessmentRequest.request_file);
  const topLevelFindings = [
    productQualityRequired
      ? `${stepId} product-change step quality was assessed from ${evaluatorInputRefs.length} public evaluator input refs.`
      : `${stepId} small canary flow-health evidence is present.`,
  ];
	  if (productQualityRequired && ["execution", "review"].includes(stepId)) {
	    topLevelFindings.push(
	      `${stepId} assessment covered mission relevance, verification relevance, and repair necessity before continuation.`,
	    );
	  }
	  if (productQualityRequired && stepId === "qa") {
	    topLevelFindings.push(
	      "qa assessment covered verification relevance, regression signal quality, mission relevance, and repair necessity before delivery.",
	    );
	  }

  const assessment = {
    assessment_id: `${normalizeId(options.runId)}.${normalizeId(stepInstanceId)}.step-quality.v1`,
    run_id: options.runId,
    profile_id: context.profileId,
    generated_at: nowIso(),
    evaluator: {
      kind: "skill-agent",
      ref: "skill://live-e2e-runner",
      mode: context.featureSize === "small" ? "flow-health" : "product-step-quality",
      responsibility:
        context.featureSize === "small"
          ? "Confirm the live E2E flow step has public evidence before canary continuation."
          : "Assess product-change step quality from public artifacts before continuation.",
    },
    target_catalog_id: context.targetCatalogId,
    feature_mission_id: context.featureMissionId,
    feature_size: context.featureSize,
    mission_class: context.missionClass,
    step_id: stepId,
    step_name: asNonEmptyString(entry.step_name) || stepId,
    step_iteration: typeof entry.iteration === "number" ? entry.iteration : 1,
    source_agent_decision_request_file: asNonEmptyString(entry.agent_decision_request_ref),
    source_operator_decision_file: asNonEmptyString(entry.operator_decision_ref),
    source_assessment_request_file: sourceAssessmentRequestFile,
    assessment_method: assessmentMethod,
    rubric_version: STEP_QUALITY_RUBRIC_VERSION,
    evaluator_input_refs: evaluatorInputRefs,
    evaluator_output_ref:
      asNonEmptyString(options.evaluatorOutputRef) ||
      files.reportFile ||
      asNonEmptyString(entry.operator_decision_ref) ||
      sourceAssessmentRequestFile,
    status: statusFromStepQualityDecision(decision),
    decision,
    dimensions: buildStepQualityDimensions({ stepId, inspectedEvidenceRefs, productQualityRequired }),
    findings: topLevelFindings,
    repair_instructions:
      decision === "request-repair"
        ? ["Run repair only through the public AOR review/repair loop; do not mutate the target checkout directly."]
        : [],
    repair_lineage: {
      source_assessment_request_file: sourceAssessmentRequestFile,
      source_operator_decision_file: asNonEmptyString(entry.operator_decision_ref),
      step_iteration: typeof entry.iteration === "number" ? entry.iteration : 1,
      public_repair_command:
        decision === "request-repair" ? "aor review decide --decision request-repair" : null,
    },
    inspected_evidence_refs: inspectedEvidenceRefs,
    evidence_refs: [
      sourceAssessmentRequestFile,
      asNonEmptyString(entry.agent_decision_request_ref),
      asNonEmptyString(entry.operator_decision_ref),
      asNonEmptyString(entry.plan_ref),
      asNonEmptyString(entry.execution_ref),
      asNonEmptyString(entry.inspection_ref),
      asNonEmptyString(entry.classification_ref),
      ...inspectedEvidenceRefs,
    ].filter(Boolean),
  };

  return { assessment, reportFile: files.reportFile, context };
}

/**
 * @param {{
 *   runId: string,
 *   profile?: Record<string, unknown>,
 *   artifacts?: Record<string, unknown>,
 *   summary?: Record<string, unknown>,
 *   entry: Record<string, unknown>,
 *   outputDir: string,
 * }} options
 */
export function writeStepQualityAssessmentReport(options) {
  const built = buildStepQualityAssessment(options);
  const validation = validateContractDocument({
    family: "live-e2e-step-quality-assessment-report",
    document: built.assessment,
    source: built.reportFile,
  });
  if (!validation.ok) {
    const validationIssues = validation.issues.map((entry) => entry.message).join("; ");
    throw new UsageError(
      `Step quality assessment for '${asNonEmptyString(options.entry.step_id) || "step"}' failed contract validation: ${validationIssues}`,
    );
  }
  writeJson(built.reportFile, built.assessment);
  return built;
}

/**
 * @param {{
 *   requestFile: string,
 *   decision: string,
 *   write?: boolean,
 * }} options
 */
export function prepareManualStepQualityAssessmentArtifact(options) {
  const requestFile = asNonEmptyString(options.requestFile);
  if (!requestFile || !fileExists(requestFile)) {
    throw new UsageError(`Step-quality assessment request '${requestFile}' was not found.`);
  }
  const request = asRecord(readJson(requestFile));
  const expectedReportFile = asNonEmptyString(request.expected_assessment_report_file);
  if (!expectedReportFile) {
    throw new UsageError(`Step-quality assessment request '${requestFile}' does not declare expected_assessment_report_file.`);
  }
  const operatorDecisionFile = asNonEmptyString(request.source_operator_decision_file);
  if (!operatorDecisionFile || !fileExists(operatorDecisionFile)) {
    throw new UsageError(
      `Step-quality assessment request '${requestFile}' does not link a materialized source_operator_decision_file.`,
    );
  }
  const operatorDecision = asRecord(readJson(operatorDecisionFile));
  const inspectedEvidenceRefs = uniqueStrings([
    ...asStringArray(operatorDecision.inspected_evidence_refs),
    ...asStringArray(request.evaluator_input_refs),
  ]);
  if (inspectedEvidenceRefs.length === 0) {
    throw new UsageError(`Step-quality assessment request '${requestFile}' has no public evidence refs to inspect.`);
  }
  const stepId = asNonEmptyString(request.step_id) || "step";
  const stepIteration = typeof request.step_iteration === "number" ? request.step_iteration : 1;
  const entry = {
    sequence: stepIteration,
    step_id: stepId,
    step_instance_id: stepIteration > 1 ? `${stepId}#${stepIteration}` : stepId,
    step_name: asNonEmptyString(request.step_name) || stepId,
    iteration: stepIteration,
    agent_decision_request_ref: asNonEmptyString(request.source_agent_decision_request_file),
    operator_decision_ref: operatorDecisionFile,
    inspected_evidence_refs: inspectedEvidenceRefs,
    artifact_refs: asStringArray(request.evidence_refs),
    decision: {
      action: normalizeStepQualityDecision(options.decision),
      reason:
        asNonEmptyString(operatorDecision.reason) ||
        "Manual skill-agent step-quality assessment prepared from public live E2E artifacts.",
    },
    step_quality_candidate_decision: {
      action: normalizeStepQualityDecision(options.decision),
    },
    step_quality_assessment_request_ref: requestFile,
  };
  const profile = {
    profile_id: asNonEmptyString(request.profile_id),
    target_catalog_id: asNonEmptyString(request.target_catalog_id),
    feature_mission_id: asNonEmptyString(request.feature_mission_id),
    feature_size: asNonEmptyString(request.feature_size),
    mission_class: asNonEmptyString(request.mission_class),
  };
  const artifacts = {
    target_catalog_id: asNonEmptyString(request.target_catalog_id),
    feature_mission_id: asNonEmptyString(request.feature_mission_id),
    feature_size: asNonEmptyString(request.feature_size),
    mission_class: asNonEmptyString(request.mission_class),
  };
  const built = buildStepQualityAssessment({
    runId: asNonEmptyString(request.run_id),
    profile,
    artifacts,
    entry,
    outputDir: path.dirname(expectedReportFile),
    assessmentRequestFile: requestFile,
    assessmentRequest: request,
    assessmentMethod: "manual-skill-agent",
    evaluatorOutputRef: requestFile,
    assessmentDecision: normalizeStepQualityDecision(options.decision),
    reportFile: expectedReportFile,
  });
  const validation = validateContractDocument({
    family: "live-e2e-step-quality-assessment-report",
    document: built.assessment,
    source: built.reportFile,
  });
  if (!validation.ok) {
    const validationIssues = validation.issues.map((entry) => entry.message).join("; ");
    throw new UsageError(`Step-quality assessment for '${stepId}' failed contract validation: ${validationIssues}`);
  }
  if (options.write !== false) {
    writeJson(built.reportFile, built.assessment);
  }
  return {
    status: options.write === false ? "preview" : "written",
    request_file: requestFile,
    report_file: built.reportFile,
    decision: built.assessment.decision,
    assessment_status: built.assessment.status,
    assessment_method: built.assessment.assessment_method,
    inspected_evidence_refs: inspectedEvidenceRefs,
    evidence_refs: asStringArray(built.assessment.evidence_refs),
  };
}

/**
 * @param {{
 *   reportFile: string,
 *   requestFile?: string,
 * }} options
 */
export function readStepQualityAssessmentReport(options) {
  const reportFile = asNonEmptyString(options.reportFile);
  if (!reportFile || !fileExists(reportFile)) return null;
  const assessment = asRecord(readJson(reportFile));
  const requestFile = asNonEmptyString(options.requestFile);
  if (requestFile && asNonEmptyString(assessment.source_assessment_request_file) !== requestFile) {
    throw new UsageError(
      `Step quality assessment report '${reportFile}' is not linked to request '${requestFile}'.`,
    );
  }
  const validation = validateContractDocument({
    family: "live-e2e-step-quality-assessment-report",
    document: assessment,
    source: reportFile,
  });
  if (!validation.ok) {
    const validationIssues = validation.issues.map((entry) => entry.message).join("; ");
    throw new UsageError(`Step quality assessment report '${reportFile}' failed contract validation: ${validationIssues}`);
  }
  return { assessment, reportFile };
}

/**
 * @param {{
 *   runId: string,
 *   profile?: Record<string, unknown>,
 *   artifacts?: Record<string, unknown>,
 *   summary?: Record<string, unknown>,
 *   entries: Record<string, unknown>[],
 *   outputDir: string,
 * }} options
 */
export function writeStepQualityAssessmentReports(options) {
  return options.entries.map((entry) =>
    writeStepQualityAssessmentReport({
      runId: options.runId,
      profile: options.profile,
      artifacts: options.artifacts,
      summary: options.summary,
      entry,
      outputDir: options.outputDir,
      assessmentRequestFile: asNonEmptyString(entry.step_quality_assessment_request_ref),
      assessmentMethod: "external-skill-agent",
    }).reportFile,
  );
}
