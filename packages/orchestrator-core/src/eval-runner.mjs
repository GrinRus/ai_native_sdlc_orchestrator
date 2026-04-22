import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { loadContractFile, validateContractDocument } from "../../contracts/src/index.mjs";
import { scoreEvaluationSuite } from "../../harness/src/scorer-interface.mjs";

import { loadEvaluationRegistry, resolveSuiteWithDataset } from "./evaluation-registry.mjs";
import { initializeProjectRuntime } from "./project-init.mjs";

const SUPPORTED_SUBJECT_TYPES = new Set(["run", "wrapper", "route", "adapter"]);

/**
 * @param {string} value
 * @returns {string}
 */
function sanitizeForFileName(value) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+/, "").replace(/-+$/, "");
}

/**
 * @param {string} subjectRef
 * @returns {string}
 */
function inferSubjectType(subjectRef) {
  const markerIndex = subjectRef.indexOf("://");
  if (markerIndex <= 0) {
    throw new Error(
      `Invalid subject_ref '${subjectRef}'. Expected '<subject_type>://<target>' with subject_type in run|wrapper|route|adapter.`,
    );
  }

  const subjectType = subjectRef.slice(0, markerIndex);
  if (!SUPPORTED_SUBJECT_TYPES.has(subjectType)) {
    throw new Error(
      `Unsupported subject_type '${subjectType}' in subject_ref '${subjectRef}'. Expected run|wrapper|route|adapter.`,
    );
  }
  return subjectType;
}

/**
 * @param {Record<string, unknown>} profile
 * @returns {string | null}
 */
function resolveDefaultSuiteRef(profile) {
  const evalPolicy = /** @type {Record<string, unknown>} */ (profile.eval_policy ?? {});
  return typeof evalPolicy.default_release_suite_ref === "string"
    ? evalPolicy.default_release_suite_ref
    : null;
}

/**
 * @param {{
 *   projectRoot: string,
 *   suiteSource: string,
 *   datasetSource: string,
 * }} options
 * @returns {{ suite: Record<string, unknown>, dataset: Record<string, unknown> }}
 */
function loadSuiteDatasetDocuments(options) {
  const suitePath = path.resolve(options.projectRoot, options.suiteSource);
  const datasetPath = path.resolve(options.projectRoot, options.datasetSource);

  const loadedSuite = loadContractFile({ filePath: suitePath, family: "evaluation-suite" });
  if (!loadedSuite.ok) {
    throw new Error(`Evaluation suite '${suitePath}' failed contract validation.`);
  }
  const loadedDataset = loadContractFile({ filePath: datasetPath, family: "dataset" });
  if (!loadedDataset.ok) {
    throw new Error(`Dataset '${datasetPath}' failed contract validation.`);
  }

  return {
    suite: /** @type {Record<string, unknown>} */ (loadedSuite.document),
    dataset: /** @type {Record<string, unknown>} */ (loadedDataset.document),
  };
}

/**
 * @param {{
 *  cwd?: string,
 *  projectRef?: string,
 *  projectProfile?: string,
 *  runtimeRoot?: string,
 *  suiteRef?: string,
 *  subjectRef: string,
 *  subjectVersion?: string,
 * }} options
 */
export function runEvaluationSuite(options) {
  const init = initializeProjectRuntime(options);
  const loadedProfile = loadContractFile({
    filePath: init.projectProfilePath,
    family: "project-profile",
  });
  if (!loadedProfile.ok) {
    throw new Error(`Project profile '${init.projectProfilePath}' failed contract validation.`);
  }

  const profile = /** @type {Record<string, unknown>} */ (loadedProfile.document);
  const suiteRef = options.suiteRef ?? resolveDefaultSuiteRef(profile);
  if (!suiteRef) {
    throw new Error("No suite_ref provided and project profile has no eval_policy.default_release_suite_ref.");
  }

  const subjectRef = options.subjectRef;
  const subjectType = inferSubjectType(subjectRef);

  const evaluationRegistry = loadEvaluationRegistry({ workspaceRoot: init.projectRoot });
  if (!evaluationRegistry.ok) {
    const issueSummary = evaluationRegistry.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Evaluation registry checks failed: ${issueSummary}`);
  }

  const resolved = resolveSuiteWithDataset(evaluationRegistry, suiteRef);
  if (!resolved.dataset) {
    throw new Error(`Suite '${suiteRef}' is missing a resolved dataset.`);
  }

  if (resolved.suite.subject_type && resolved.suite.subject_type !== subjectType) {
    throw new Error(
      `Suite '${suiteRef}' subject_type '${resolved.suite.subject_type}' does not match subject_ref type '${subjectType}'.`,
    );
  }

  const documents = loadSuiteDatasetDocuments({
    projectRoot: init.projectRoot,
    suiteSource: resolved.suite.source,
    datasetSource: resolved.dataset.source,
  });

  const scorecard = scoreEvaluationSuite({
    suite: documents.suite,
    dataset: documents.dataset,
    subjectRef,
    subjectType,
  });

  const generatedAt = new Date().toISOString();
  const reportId = `${init.projectId}.evaluation.${sanitizeForFileName(suiteRef)}.${Date.now()}`;
  const subjectFingerprint = `sha256:${createHash("sha256")
    .update(`${subjectRef}|${options.subjectVersion ?? "none"}|${suiteRef}`)
    .digest("hex")}`;

  const report = {
    report_id: reportId,
    subject_ref: subjectRef,
    subject_type: subjectType,
    subject_fingerprint: subjectFingerprint,
    suite_ref: suiteRef,
    dataset_ref: resolved.dataset.dataset_ref,
    scorer_metadata: scorecard.scorer_metadata,
    grader_results: scorecard.grader_results,
    summary_metrics: {
      ...scorecard.summary_metrics,
      generated_at: generatedAt,
      suite_version: resolved.suite.version,
      subject_version: options.subjectVersion ?? null,
      comparison_key: `${subjectRef}::${suiteRef}`,
    },
    status: scorecard.status,
    evidence_refs: [
      init.projectProfilePath,
      path.resolve(init.projectRoot, resolved.suite.source),
      path.resolve(init.projectRoot, resolved.dataset.source),
      init.stateFile,
    ],
  };

  const reportValidation = validateContractDocument({
    family: "evaluation-report",
    document: report,
    source: "runtime://evaluation-report",
  });
  if (!reportValidation.ok) {
    const issueSummary = reportValidation.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Generated evaluation report failed contract validation: ${issueSummary}`);
  }

  const reportFileName = `evaluation-report-${sanitizeForFileName(suiteRef)}-${Date.now()}.json`;
  const reportPath = path.join(init.runtimeLayout.reportsRoot, reportFileName);
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  return {
    ...init,
    suiteRef,
    subjectRef,
    subjectType,
    evaluationReport: report,
    evaluationReportPath: reportPath,
    blocking: report.status !== "pass",
  };
}
