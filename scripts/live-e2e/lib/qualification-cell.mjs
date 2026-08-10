import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateContractDocument } from "./contracts/index.mjs";
import { asNonEmptyString, asRecord, asStringArray, nowIso, readJson, uniqueStrings } from "./common.mjs";

const SCRIPT_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const QUALITY_ASSESSMENT_SCRIPT = path.join(SCRIPT_ROOT, "quality-assessment.mjs");
const DIMENSION_KEYS = Object.freeze([
  "public_lifecycle",
  "run_health",
  "diagnostic_verification",
  "final_assessment",
  "changed_paths",
  "checkout_integrity",
  "delivery_safety",
]);

export const REQUIRED_QUALIFICATION_CELLS = Object.freeze([
  Object.freeze({ cell_id: "openai-primary.medium", provider_variant_id: "openai-primary", feature_size: "medium" }),
  Object.freeze({ cell_id: "openai-primary.large", provider_variant_id: "openai-primary", feature_size: "large" }),
]);

function digestFile(file) {
  return `sha256:${crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")}`;
}

function fileEvidence(kind, file, owner, runId) {
  if (!file || !fs.existsSync(file)) return null;
  const document = asRecord(readJson(file));
  return {
    kind,
    ref: file,
    digest: digestFile(file),
    owner,
    generated_at: asNonEmptyString(document.generated_at) || asNonEmptyString(document.created_at) || fs.statSync(file).mtime.toISOString(),
    run_id: asNonEmptyString(document.run_id) || runId,
  };
}

function dimension(status, refs = []) {
  return { status, evidence_refs: uniqueStrings(refs.filter(Boolean)) };
}

function finding(code, owner, phase, failureClass, summary, evidenceRefs = []) {
  return {
    code,
    owner,
    phase,
    class: failureClass,
    summary,
    evidence_refs: uniqueStrings(evidenceRefs.filter(Boolean)),
  };
}

function assessFinalAssessment(assessmentFile, runId) {
  if (!assessmentFile || !fs.existsSync(assessmentFile)) {
    return { status: "blocked", issues: ["Final assessment is missing."], document: {} };
  }
  const document = asRecord(readJson(assessmentFile));
  const gate = spawnSync(
    process.execPath,
    [QUALITY_ASSESSMENT_SCRIPT, "gate", "--policy", "all-pass", "--assessment-report-file", assessmentFile],
    { encoding: "utf8" },
  );
  let output = {};
  try {
    output = asRecord(JSON.parse(gate.stdout));
  } catch {
    output = {};
  }
  const issues = [
    ...asStringArray(output.missing_local_refs),
    ...(Array.isArray(output.contract_issues)
      ? output.contract_issues.map((entry) => asNonEmptyString(asRecord(entry).message)).filter(Boolean)
      : []),
    ...(Array.isArray(output.gate_issues)
      ? output.gate_issues.map((entry) => asNonEmptyString(asRecord(entry).message)).filter(Boolean)
      : []),
  ];
  if (asNonEmptyString(document.run_id) !== runId) issues.push("Final assessment belongs to a different run.");
  return { status: gate.status === 0 && issues.length === 0 ? "pass" : "blocked", issues, document };
}

function resolveRef(summaryFile, ref) {
  if (!ref) return null;
  return path.isAbsolute(ref) ? ref : path.resolve(path.dirname(summaryFile), ref);
}

/**
 * Build one fail-closed qualification cell from immutable evidence files.
 *
 * @param {{ summaryFile: string, observationFile?: string | null, runHealthFile?: string | null, assessmentFile?: string | null, generatedAt?: string }} options
 */
export function buildQualificationCellReport(options) {
  const summaryFile = path.resolve(options.summaryFile);
  const summary = asRecord(readJson(summaryFile));
  const runId = asNonEmptyString(summary.run_id);
  const providerVariantId = asNonEmptyString(summary.provider_variant_id);
  const featureSize = asNonEmptyString(summary.feature_size);
  const observationFile = resolveRef(
    summaryFile,
    options.observationFile || asNonEmptyString(summary.live_e2e_observation_report_file),
  );
  const runHealthFile = resolveRef(
    summaryFile,
    options.runHealthFile || asNonEmptyString(summary.live_e2e_run_health_report_file),
  );
  const assessmentFile = resolveRef(summaryFile, options.assessmentFile);
  const observation = observationFile && fs.existsSync(observationFile) ? asRecord(readJson(observationFile)) : {};
  const runHealth = runHealthFile && fs.existsSync(runHealthFile) ? asRecord(readJson(runHealthFile)) : {};
  const assessment = assessFinalAssessment(assessmentFile, runId);
  const noUpstreamWrite = asRecord(summary.no_upstream_write_assertion);
  const productionProof = asRecord(summary.production_proof);
  const changedPaths = asStringArray(summary.meaningful_changed_paths).filter((entry) => !entry.startsWith(".aor/"));
  const blockingFindings = [];
  const dimensions = {
    public_lifecycle: dimension(
      asNonEmptyString(summary.status) === "pass" &&
        asNonEmptyString(observation.report_status) !== "in_progress" &&
        asNonEmptyString(asRecord(observation.final_analysis).status) === "pass"
        ? "pass"
        : "blocked",
      [observationFile],
    ),
    run_health: dimension(asNonEmptyString(runHealth.overall_status) === "pass" ? "pass" : "blocked", [runHealthFile]),
    diagnostic_verification: dimension(
      asNonEmptyString(summary.post_run_diagnostic_status) === "pass" &&
        asNonEmptyString(summary.post_run_verify_status) === "pass"
        ? "pass"
        : "blocked",
      [asNonEmptyString(summary.post_run_verify_summary_file), asNonEmptyString(summary.post_run_diagnostic_verify_summary_file)],
    ),
    final_assessment: dimension(assessment.status, [assessmentFile]),
    changed_paths: dimension(
      changedPaths.length > 0 &&
        asNonEmptyString(asRecord(productionProof.delivery_integrity).status) === "pass"
        ? "pass"
        : "blocked",
      [asNonEmptyString(summary.delivery_manifest_file)],
    ),
    checkout_integrity: dimension(
      noUpstreamWrite.target_head_unchanged === true && asStringArray(noUpstreamWrite.commit_refs).length === 0
        ? "pass"
        : "blocked",
      [asNonEmptyString(summary.delivery_manifest_file)],
    ),
    delivery_safety: dimension(
      asNonEmptyString(noUpstreamWrite.status) === "pass" &&
        asRecord(summary.production_proof).real_code_change_proof_complete === true
        ? "pass"
        : "blocked",
      [asNonEmptyString(summary.delivery_manifest_file)],
    ),
  };
  for (const [key, value] of Object.entries(dimensions)) {
    if (value.status !== "pass") {
      blockingFindings.push(finding(
        `qualification.${key}.not_pass`,
        key === "final_assessment" ? "evaluator" : "aor",
        key,
        `${key}_not_pass`,
        key === "final_assessment" && assessment.issues.length > 0
          ? assessment.issues.join(" ")
          : `Qualification dimension '${key}' did not pass.`,
        value.evidence_refs,
      ));
    }
  }
  const evidence = [
    fileEvidence("run-summary", summaryFile, "aor", runId),
    fileEvidence("observation", observationFile, "aor", runId),
    fileEvidence("run-health", runHealthFile, "aor", runId),
    fileEvidence("final-assessment", assessmentFile, "evaluator", runId),
  ].filter(Boolean);
  const report = {
    schema_version: 1,
    report_id: `${runId || "unknown"}.qualification-cell.v1`,
    cell_id: `${providerVariantId}.${featureSize}`,
    run_id: runId,
    provider_variant_id: providerVariantId,
    feature_size: featureSize,
    commit_sha: asNonEmptyString(summary.commit_sha),
    generated_at: options.generatedAt || nowIso(),
    status: blockingFindings.length === 0 ? "pass" : "blocked",
    dimensions,
    observations: [],
    positive_evidence: Object.entries(dimensions)
      .filter(([, value]) => value.status === "pass")
      .map(([key, value]) => ({ summary: `Qualification dimension '${key}' passed.`, evidence_refs: value.evidence_refs })),
    warnings: [],
    blocking_findings: blockingFindings,
    evidence,
  };
  return {
    report,
    validation: validateContractDocument({
      family: "live-e2e-qualification-cell-report",
      document: report,
      source: options.summaryFile,
    }),
  };
}

/**
 * @param {Array<Record<string, unknown>>} reports
 */
export function evaluateQualificationMatrix(reports) {
  const byCell = new Map(reports.map((report) => [asNonEmptyString(report.cell_id), report]));
  const commitShas = uniqueStrings(reports.map((report) => asNonEmptyString(report.commit_sha)).filter(Boolean));
  const cells = REQUIRED_QUALIFICATION_CELLS.map((required) => {
    const report = asRecord(byCell.get(required.cell_id));
    return {
      ...required,
      run_id: asNonEmptyString(report.run_id) || null,
      commit_sha: asNonEmptyString(report.commit_sha) || null,
      status: asNonEmptyString(report.status) || "missing",
    };
  });
  const missingOrFailed = cells.filter((cell) => cell.status !== "pass");
  return {
    matrix_id: "live-e2e.required-provider-qualification-matrix.v1",
    required_cells: cells,
    commit_sha: commitShas.length === 1 ? commitShas[0] : null,
    status: missingOrFailed.length === 0 && commitShas.length === 1 ? "pass" : "blocked",
    blocking_findings: [
      ...missingOrFailed.map((cell) => ({
        code: "qualification.required_cell_not_pass",
        cell_id: cell.cell_id,
        status: cell.status,
      })),
      ...(commitShas.length === 1 ? [] : [{ code: "qualification.commit_set_mismatch", commit_shas: commitShas }]),
    ],
    generated_at: nowIso(),
  };
}
