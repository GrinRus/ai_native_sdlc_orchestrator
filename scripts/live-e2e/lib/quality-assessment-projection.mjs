import { asNonEmptyString, asRecord, nowIso, uniqueStrings } from "./common.mjs";

const STATUS_VALUES = new Set(["pass", "warn", "fail", "not_evaluated"]);
const EVIDENCE_VALUES = new Set(["strong", "medium", "weak", "missing"]);

function buildCorrectionGuidance(issues, evidenceRefs) {
  return (Array.isArray(issues) ? issues : []).slice(0, 64).map((entry) => ({
    code: String(entry.code ?? "assessment-invalid"),
    field: String(entry.field ?? "assessment").slice(0, 160),
    summary: String(entry.summary ?? "Assessment requires correction.").slice(0, 320),
    retryable: entry.retryable !== false,
    suggested_repair_kind: ["output-contract", "evidence-reconciliation", "work-product"].includes(entry.suggested_repair_kind)
      ? entry.suggested_repair_kind
      : "output-contract",
    evidence_refs: (Array.isArray(evidenceRefs) ? evidenceRefs : []).filter((ref) => typeof ref === "string" && ref.startsWith("evidence://")).slice(0, 8),
  }));
}

function aggregate(statuses) {
  if (statuses.includes("fail")) return "fail";
  if (statuses.includes("not_evaluated")) return "not_evaluated";
  if (statuses.includes("warn")) return "warn";
  return "pass";
}

function collectRefs(value, refs = []) {
  if (typeof value === "string") return refs;
  if (Array.isArray(value)) {
    value.forEach((entry) => collectRefs(entry, refs));
    return refs;
  }
  const record = asRecord(value);
  for (const [key, entry] of Object.entries(record)) {
    if (/(?:_file|_ref|_refs|_files|evidence_refs|artifact_refs|screenshot_refs)$/iu.test(key)) {
      if (typeof entry === "string") refs.push(entry);
      if (Array.isArray(entry)) refs.push(...entry.filter((item) => typeof item === "string"));
      continue;
    }
    collectRefs(entry, refs);
  }
  return refs;
}

/**
 * Project model-authored quality dimensions into a controller-owned report.
 * @param {Record<string, unknown>} assessment
 * @param {{ requiredDimensions: string[], generatedAt?: string | null, controllerEvidenceRefs?: string[] }} options
 */
export function projectQualityAssessment(assessment, options) {
  const requiredDimensions = options.requiredDimensions;
  const runId = asNonEmptyString(assessment.run_id) || "live-e2e-run";
  const refs = uniqueStrings([
    ...(Array.isArray(options.controllerEvidenceRefs) ? options.controllerEvidenceRefs : []),
    asNonEmptyString(assessment.source_run_summary_file),
    asNonEmptyString(assessment.source_observation_report_file),
    asNonEmptyString(assessment.source_run_health_report_file),
    asNonEmptyString(assessment.assessment_request_file),
    ...collectRefs(assessment),
  ].filter(Boolean));
  const refSet = new Set(refs);
  const inputDimensions = asRecord(assessment.dimensions);
  const projectionIssues = [];
  const dimensions = {};
  for (const dimensionKey of requiredDimensions) {
    const input = asRecord(inputDimensions[dimensionKey]);
    let status = asNonEmptyString(input.status);
    const evidence = asNonEmptyString(input.evidence_strength);
    if (!STATUS_VALUES.has(status)) {
      status = "not_evaluated";
      projectionIssues.push({
        code: "assessment-dimension-invalid",
        field: `dimensions.${dimensionKey}.status`,
        summary: `Dimension '${dimensionKey}' must declare pass, warn, fail, or not_evaluated.`,
        suggested_repair_kind: "output-contract",
      });
    }
    const evidenceStrength = EVIDENCE_VALUES.has(evidence) ? evidence : status === "not_evaluated" ? "missing" : "weak";
    if (status === "not_evaluated" && evidenceStrength !== "missing") {
      projectionIssues.push({
        code: "assessment-dimension-evidence-mismatch",
        field: `dimensions.${dimensionKey}.evidence_strength`,
        summary: `Unevaluated dimension '${dimensionKey}' must use evidence_strength=missing.`,
        suggested_repair_kind: "evidence-reconciliation",
      });
    }
    const subdimensions = asRecord(input.subdimensions);
    const subStatuses = Object.values(subdimensions).map((entry) => asNonEmptyString(asRecord(entry).status)).filter((value) => STATUS_VALUES.has(value));
    if (subStatuses.length > 0) status = aggregate([status, ...subStatuses]);
    const inspected = uniqueStrings((Array.isArray(input.inspected_evidence_refs) ? input.inspected_evidence_refs : Array.isArray(input.evidence_refs) ? input.evidence_refs : [])
      .filter((ref) => refSet.size === 0 || refSet.has(ref)));
    const findings = Array.isArray(input.findings) ? [...input.findings] : [];
    if (status === "not_evaluated" && findings.length === 0) findings.push({ category: "evidence-gap", severity: "medium", summary: `Dimension '${dimensionKey}' was not evaluated because accepted evidence is missing.`, evidence_refs: [] });
    dimensions[dimensionKey] = {
      status,
      evidence_strength: evidenceStrength,
      inspected_evidence_refs: inspected,
      findings,
      recommended_followups: Array.isArray(input.recommended_followups) ? input.recommended_followups : [],
      ...(Object.keys(subdimensions).length > 0 ? { subdimensions } : {}),
    };
  }
  const statuses = requiredDimensions.map((key) => dimensions[key].status);
  const overallStatus = aggregate(statuses);
  const guidance = buildCorrectionGuidance(projectionIssues, refs);
  return {
    ...assessment,
    assessment_id: `${runId}.quality-assessment.projected.v1`,
    run_id: runId,
    profile_id: asNonEmptyString(assessment.profile_id) || "unknown-profile",
    generated_at: asNonEmptyString(options.generatedAt) || nowIso(),
    evaluator: { kind: "swe-agent", ref: asNonEmptyString(asRecord(assessment.evaluator).ref) || "aor://quality-assessment", mode: "aor-projected" },
    source_run_summary_file: asNonEmptyString(assessment.source_run_summary_file) || refs[0] || "runtime://reports/run-summary.json",
    source_observation_report_file: asNonEmptyString(assessment.source_observation_report_file) || null,
    source_run_health_report_file: asNonEmptyString(assessment.source_run_health_report_file) || null,
    overall_status: overallStatus,
    dimensions,
    gap_report: {
      not_evaluated_dimensions: requiredDimensions.filter((key) => dimensions[key].status === "not_evaluated"),
      weak_signal_dimensions: requiredDimensions.filter((key) => dimensions[key].evidence_strength === "weak"),
      strong_evidence_dimensions: requiredDimensions.filter((key) => dimensions[key].evidence_strength === "strong"),
    },
    findings: Array.isArray(assessment.findings) ? assessment.findings : [],
    recommended_followups: Array.isArray(assessment.recommended_followups) ? assessment.recommended_followups : [],
    evidence_refs: refs,
    qualification_verdict: overallStatus,
    correction_guidance: guidance,
    projection_issues: projectionIssues,
  };
}
