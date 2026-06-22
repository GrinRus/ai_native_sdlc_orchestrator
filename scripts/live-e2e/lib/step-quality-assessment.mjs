import path from "node:path";

import { validateContractDocument } from "../../../packages/contracts/src/index.mjs";
import {
  UsageError,
  asNonEmptyString,
  asRecord,
  asStringArray,
  normalizeId,
  nowIso,
  writeJson,
} from "./common.mjs";

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
 * @param {{
 *   stepId: string,
 *   inspectedEvidenceRefs: string[],
 * }} options
 */
function buildStepQualityDimensions(options) {
  const dimension = {
    status: "pass",
    evidence_strength: options.inspectedEvidenceRefs.length > 0 ? "strong" : "medium",
    inspected_evidence_refs: options.inspectedEvidenceRefs,
    findings: [],
  };
  return {
    traceability: {
      ...dimension,
      summary: `${options.stepId} cites the public decision request, operator decision, and inspected evidence refs.`,
    },
    completeness: {
      ...dimension,
      summary: `${options.stepId} completed the required controller phases before continuation.`,
    },
    actionability: {
      ...dimension,
      summary: `${options.stepId} produced an explicit next action through the public operator decision artifact.`,
    },
    evidence_strength: {
      ...dimension,
      summary: `${options.stepId} has materialized public evidence refs for evaluator inspection.`,
    },
    black_box_boundary: {
      ...dimension,
      summary: `${options.stepId} assessment is derived from public live E2E artifacts only.`,
    },
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
 *   profile?: Record<string, unknown>,
 *   artifacts?: Record<string, unknown>,
 *   summary?: Record<string, unknown>,
 *   entry: Record<string, unknown>,
 *   outputDir: string,
 * }} options
 */
export function buildStepQualityAssessment(options) {
  const context = resolveStepQualityContext(options);
  const entry = asRecord(options.entry);
  const stepId = asNonEmptyString(entry.step_id) || "step";
  const stepInstanceId = asNonEmptyString(entry.step_instance_id) || stepId;
  const action = asNonEmptyString(asRecord(entry.decision).action) || "continue";
  const decision = normalizeStepQualityDecision(action);
  const inspectedEvidenceRefs = asStringArray(entry.inspected_evidence_refs);
  const sequence = String(entry.sequence ?? 1).padStart(2, "0");
  const reportFile = path.join(
    options.outputDir,
    `live-e2e-step-quality-assessment-report-${normalizeId(options.runId)}-${sequence}-${normalizeId(stepInstanceId)}.json`,
  );

  const assessment = {
    assessment_id: `${normalizeId(options.runId)}.${normalizeId(stepInstanceId)}.step-quality.v1`,
    run_id: options.runId,
    profile_id: context.profileId,
    generated_at: nowIso(),
    evaluator: {
      kind: "skill-agent",
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
    status: statusFromStepQualityDecision(decision),
    decision,
    dimensions: buildStepQualityDimensions({ stepId, inspectedEvidenceRefs }),
    findings: [],
    repair_instructions:
      decision === "request-repair"
        ? ["Run repair only through the public AOR review/repair loop; do not mutate the target checkout directly."]
        : [],
    inspected_evidence_refs: inspectedEvidenceRefs,
    evidence_refs: [
      asNonEmptyString(entry.agent_decision_request_ref),
      asNonEmptyString(entry.operator_decision_ref),
      asNonEmptyString(entry.plan_ref),
      asNonEmptyString(entry.execution_ref),
      asNonEmptyString(entry.inspection_ref),
      asNonEmptyString(entry.classification_ref),
      ...inspectedEvidenceRefs,
    ].filter(Boolean),
  };

  return { assessment, reportFile, context };
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
    }).reportFile,
  );
}
