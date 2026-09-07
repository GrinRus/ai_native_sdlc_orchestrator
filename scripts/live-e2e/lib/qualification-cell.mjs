import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateContractDocument } from "./contracts/index.mjs";
import { asNonEmptyString, asRecord, asStringArray, nowIso, readJson, uniqueStrings } from "./common.mjs";
import { normalizeQualificationIdentity, resolveQualificationEvidence } from "./qualification-evidence.mjs";

const SCRIPT_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const QUALITY_ASSESSMENT_SCRIPT = path.join(SCRIPT_ROOT, "quality-assessment.mjs");

export const REQUIRED_QUALIFICATION_CELLS = Object.freeze([
  Object.freeze({ cell_id: "openai-primary.medium", provider_variant_id: "openai-primary", feature_size: "medium" }),
  Object.freeze({ cell_id: "openai-primary.large", provider_variant_id: "openai-primary", feature_size: "large" }),
  Object.freeze({ cell_id: "anthropic-primary.medium", provider_variant_id: "anthropic-primary", feature_size: "medium" }),
  Object.freeze({ cell_id: "anthropic-primary.large", provider_variant_id: "anthropic-primary", feature_size: "large" }),
]);

function fileEvidence(kind, file, owner, runId, options = {}) {
  if (!file || !fs.existsSync(file)) return { entry: null, issues: [`${kind} evidence is missing`] };
  const resolved = resolveQualificationEvidence({
    kind,
    reference: file,
    projectRoot: options.projectRoot,
    projectRuntimeRoot: options.projectRuntimeRoot,
    workspaceProjectId: options.workspaceProjectId,
    expectedRunId: runId,
    expectedIdentity: options.qualificationIdentity,
    expectedDigest: options.expectedDigest,
    reportGeneratedAt: options.reportGeneratedAt,
    requirePortable: options.requirePortable,
    requireRedaction: options.requireRedaction,
    owner,
  });
  return { entry: resolved.entry, issues: resolved.issues };
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
  const resolveInput = (value) => {
    if (!value) return null;
    return path.isAbsolute(value) ? value : path.resolve(path.dirname(summaryFile), value);
  };
  const observationFile = resolveInput(options.observationFile || asNonEmptyString(summary.live_e2e_observation_report_file));
  const runHealthFile = resolveInput(options.runHealthFile || asNonEmptyString(summary.live_e2e_run_health_report_file));
  const assessmentFile = resolveInput(options.assessmentFile);
  const projectRoot = path.resolve(options.projectRoot || path.dirname(summaryFile));
  const projectRuntimeRoot = path.resolve(options.projectRuntimeRoot || projectRoot);
  const qualificationIdentity = normalizeQualificationIdentity({
    ...asRecord(options.qualificationIdentity),
    source_commit: options.qualificationIdentity?.source_commit || summary.commit_sha,
    target_commit: options.qualificationIdentity?.target_commit || summary.target_commit,
    profile_sha256: options.qualificationIdentity?.profile_sha256 || summary.profile_sha256 || summary.profile_digest,
    proof_sha256: options.qualificationIdentity?.proof_sha256 || summary.proof_sha256 || summary.adversarial_proof_sha256,
    cell_id: options.qualificationIdentity?.cell_id || `${providerVariantId}.${featureSize}`,
    provider_variant_id: options.qualificationIdentity?.provider_variant_id || providerVariantId,
    feature_size: options.qualificationIdentity?.feature_size || featureSize,
  });
  const observation = observationFile && fs.existsSync(observationFile) ? asRecord(readJson(observationFile)) : {};
  const runHealth = runHealthFile && fs.existsSync(runHealthFile) ? asRecord(readJson(runHealthFile)) : {};
  const assessment = assessFinalAssessment(assessmentFile, runId);
  const noUpstreamWrite = asRecord(summary.no_upstream_write_assertion);
  const productionProof = asRecord(summary.production_proof);
  const changedPaths = asStringArray(summary.meaningful_changed_paths).filter((entry) => !entry.startsWith(".aor/"));
  const blockingFindings = [];
  const evidenceResults = [
    fileEvidence("observation", observationFile, "aor", runId, {
      projectRoot,
      projectRuntimeRoot,
      workspaceProjectId: options.workspaceProjectId || summary.project_id,
      qualificationIdentity,
      reportGeneratedAt: options.generatedAt || nowIso(),
      requirePortable: options.requirePortable,
    }),
    fileEvidence("run-health", runHealthFile, "aor", runId, {
      projectRoot,
      projectRuntimeRoot,
      workspaceProjectId: options.workspaceProjectId || summary.project_id,
      qualificationIdentity,
      reportGeneratedAt: options.generatedAt || nowIso(),
      requirePortable: options.requirePortable,
    }),
    fileEvidence("final-assessment", assessmentFile, "evaluator", runId, {
      projectRoot,
      projectRuntimeRoot,
      workspaceProjectId: options.workspaceProjectId || summary.project_id,
      qualificationIdentity,
      reportGeneratedAt: options.generatedAt || nowIso(),
      requirePortable: options.requirePortable,
    }),
  ];
  const evidenceIssues = evidenceResults.flatMap((result) => result.issues);
  const evidence = evidenceResults.map((result) => result.entry).filter(Boolean);
  const evidenceRefs = (kind) => evidence.filter((entry) => entry.kind === kind).map((entry) => entry.ref);
  const dimensions = {
    public_lifecycle: dimension(
      asNonEmptyString(summary.status) === "pass" &&
        asNonEmptyString(observation.report_status) !== "in_progress" &&
        asNonEmptyString(asRecord(observation.final_analysis).status) === "pass"
        ? "pass"
        : "blocked",
      evidenceRefs("observation"),
    ),
    run_health: dimension(asNonEmptyString(runHealth.overall_status) === "pass" ? "pass" : "blocked", evidenceRefs("run-health")),
    diagnostic_verification: dimension(
      asNonEmptyString(summary.post_run_diagnostic_status) === "pass" &&
        asNonEmptyString(summary.post_run_verify_status) === "pass"
        ? "pass"
        : "blocked",
      [asNonEmptyString(summary.post_run_verify_summary_file), asNonEmptyString(summary.post_run_diagnostic_verify_summary_file)],
    ),
    final_assessment: dimension(assessment.status, evidenceRefs("final-assessment")),
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
  for (const issue of evidenceIssues) {
    blockingFindings.push(finding(
      "qualification.evidence.unresolvable",
      "aor",
      "evidence",
      "evidence_resolution_failed",
      issue,
    ));
  }
  const summaryEvidence = fileEvidence("run-summary", summaryFile, "aor", runId, {
    projectRoot,
    projectRuntimeRoot,
    workspaceProjectId: options.workspaceProjectId || summary.project_id,
    qualificationIdentity,
    reportGeneratedAt: options.generatedAt || nowIso(),
    requirePortable: options.requirePortable,
  });
  if (summaryEvidence.entry) evidence.push(summaryEvidence.entry);
  for (const issue of summaryEvidence.issues) {
    blockingFindings.push(finding(
      "qualification.evidence.summary_unresolvable",
      "aor",
      "evidence",
      "evidence_resolution_failed",
      issue,
    ));
  }
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
    qualification_identity: qualificationIdentity,
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
 * @param {{ qualificationIdentity?: Record<string, unknown> }} [options]
 */
export function evaluateQualificationMatrix(reports, options = {}) {
  const byCell = new Map(reports.map((report) => [asNonEmptyString(report.cell_id), report]));
  const expectedIdentity = normalizeQualificationIdentity(options.qualificationIdentity);
  const identityMismatches = [];
  const commitShas = uniqueStrings(reports.map((report) => asNonEmptyString(report.commit_sha)).filter(Boolean));
  const cells = REQUIRED_QUALIFICATION_CELLS.map((required) => {
    const report = asRecord(byCell.get(required.cell_id));
    const actualIdentity = normalizeQualificationIdentity({
      ...report,
      source_commit: report.source_commit ?? report.commit_sha,
      profile_sha256: report.profile_sha256 ?? report.profile_digest,
      proof_sha256: report.proof_sha256 ?? report.adversarial_proof_sha256,
    });
    const mismatches = Object.keys(expectedIdentity).length > 0
      ? Object.keys(expectedIdentity).filter((field) => actualIdentity[field] !== expectedIdentity[field])
      : [];
    if (mismatches.length > 0) identityMismatches.push({ cell_id: required.cell_id, fields: mismatches });
    return {
      ...required,
      run_id: asNonEmptyString(report.run_id) || null,
      commit_sha: asNonEmptyString(report.commit_sha) || null,
      status: mismatches.length > 0 ? "stale" : asNonEmptyString(report.status) || "missing",
      freshness_status: mismatches.length > 0 ? "stale" : "current",
      invalidation_reason: mismatches.length > 0 ? "qualification identity changed; prior evidence is diagnostic-only" : null,
    };
  });
  const missingOrFailed = cells.filter((cell) => cell.status !== "pass");
  return {
    matrix_id: "live-e2e.required-provider-qualification-matrix.v1",
    required_cells: cells,
    commit_sha: commitShas.length === 1 ? commitShas[0] : null,
    qualification_identity: expectedIdentity,
    status: missingOrFailed.length === 0 && commitShas.length === 1 ? "pass" : "blocked",
    blocking_findings: [
      ...missingOrFailed.map((cell) => ({
        code: "qualification.required_cell_not_pass",
        cell_id: cell.cell_id,
        status: cell.status,
      })),
      ...(commitShas.length === 1 ? [] : [{ code: "qualification.commit_set_mismatch", commit_shas: commitShas }]),
      ...identityMismatches.map((entry) => ({
        code: "qualification.identity_stale",
        cell_id: entry.cell_id,
        fields: entry.fields,
        diagnostic_only: true,
      })),
    ],
    generated_at: nowIso(),
  };
}
