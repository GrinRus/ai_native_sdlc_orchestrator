import { asNonEmptyString, asRecord, fileExists, readJson } from "./common.mjs";

function sortJsonValue(value) {
  if (Array.isArray(value)) return value.map((entry) => sortJsonValue(entry));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortJsonValue(entry)]),
    );
  }
  return value;
}

function jsonEquivalent(left, right) {
  return JSON.stringify(sortJsonValue(left)) === JSON.stringify(sortJsonValue(right));
}

function hasObjectFields(value) {
  return Object.keys(value).length > 0;
}

function compareArtifactObject(options) {
  if (!hasObjectFields(options.actual)) {
    options.findings.push(`Artifact consistency mismatch: ${options.label}.${options.field} is missing.`);
    return;
  }
  if (!jsonEquivalent(options.actual, options.expected)) {
    options.findings.push(`Artifact consistency mismatch: ${options.label}.${options.field} differs from summary.`);
  }
}

/**
 * Compare matrix and coverage-follow-up fields across the review, audit, and
 * learning artifacts emitted by one full-journey run.
 *
 * @param {{ artifacts: Record<string, unknown>, reviewReport: Record<string, unknown>, auditPayload: Record<string, unknown>, runId: string }} options
 * @returns {{ status: "pass" | "fail", findings: string[], summary: string }}
 */
export function evaluateArtifactConsistency(options) {
  /** @type {string[]} */
  const findings = [];
  const expectedMatrixCell = asRecord(options.artifacts.matrix_cell);
  const expectedCoverageFollowUp = asRecord(options.artifacts.coverage_follow_up);
  const reviewFeatureTraceability = asRecord(options.reviewReport.feature_traceability);
  const auditRecords = Array.isArray(options.auditPayload.run_audit_records)
    ? options.auditPayload.run_audit_records.map((record) => asRecord(record))
    : [];
  const auditRecord = auditRecords.find((record) => asNonEmptyString(record.run_id) === options.runId) || auditRecords[0] || {};
  const learningHandoffFile = asNonEmptyString(options.artifacts.learning_loop_handoff_file);
  const learningScorecardFile = asNonEmptyString(options.artifacts.learning_loop_scorecard_file);
  const learningHandoff = learningHandoffFile && fileExists(learningHandoffFile) ? readJson(learningHandoffFile) : {};
  const learningScorecard = learningScorecardFile && fileExists(learningScorecardFile) ? readJson(learningScorecardFile) : {};

  if (!hasObjectFields(expectedMatrixCell)) findings.push("Artifact consistency mismatch: summary.matrix_cell is missing.");
  if (!hasObjectFields(expectedCoverageFollowUp)) findings.push("Artifact consistency mismatch: summary.coverage_follow_up is missing.");

  if (hasObjectFields(expectedMatrixCell)) {
    [
      ["review-report.feature_traceability", asRecord(reviewFeatureTraceability.matrix_cell)],
      ["audit-runs.run_audit_records[0]", asRecord(auditRecord.matrix_cell)],
      ["learning-loop-handoff", asRecord(learningHandoff.matrix_cell)],
      ["learning-loop-scorecard", asRecord(learningScorecard.matrix_cell)],
    ].forEach(([label, actual]) => {
      compareArtifactObject({ label, field: "matrix_cell", expected: expectedMatrixCell, actual, findings });
    });
  }
  if (hasObjectFields(expectedCoverageFollowUp)) {
    [
      ["review-report.feature_traceability", asRecord(reviewFeatureTraceability.coverage_follow_up)],
      ["audit-runs.run_audit_records[0]", asRecord(auditRecord.coverage_follow_up)],
      ["learning-loop-handoff", asRecord(learningHandoff.coverage_follow_up)],
      ["learning-loop-scorecard", asRecord(learningScorecard.coverage_follow_up)],
    ].forEach(([label, actual]) => {
      compareArtifactObject({ label, field: "coverage_follow_up", expected: expectedCoverageFollowUp, actual, findings });
    });
  }
  return {
    status: findings.length > 0 ? "fail" : "pass",
    findings,
    summary: findings[0] ?? "Full-journey artifact lineage is internally consistent.",
  };
}
