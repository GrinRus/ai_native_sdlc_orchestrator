import {
  asNonEmptyString,
  asRecord,
  asStringArray,
  fileExists,
  readJson,
  uniqueStrings,
} from "./common.mjs";
import { resolveProductionProofPolicy } from "./profile-catalog.mjs";

const PRODUCTION_PROOF_REQUIRED_VERDICT_FIELDS = Object.freeze([
  "target_selection",
  "feature_request_quality",
  "scenario_coverage_status",
  "provider_execution_status",
  "target_baseline_status",
  "real_code_change_status",
  "post_run_verification_status",
  "post_run_diagnostic_status",
  "discovery_quality",
  "runtime_success",
  "runtime_harness_decision",
  "run_start_runtime_harness_decision",
  "latest_runtime_harness_decision",
  "artifact_quality",
  "code_quality",
  "feature_size_fit_status",
  "delivery_release_quality",
  "learning_loop_closure",
  "quality_gate_decision",
  "overall_status",
]);

/**
 * @param {string | null | undefined} filePath
 * @returns {Record<string, unknown>}
 */
function readJsonIfPresent(filePath) {
  const resolved = asNonEmptyString(filePath);
  return resolved && fileExists(resolved) ? asRecord(readJson(resolved)) : {};
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isPassStatus(value) {
  return asNonEmptyString(value).toLowerCase() === "pass";
}

/**
 * @param {string | null | undefined} filePath
 * @returns {boolean}
 */
function evidenceFileExists(filePath) {
  const resolved = asNonEmptyString(filePath);
  return Boolean(resolved && fileExists(resolved));
}

/**
 * @param {Record<string, unknown>} profile
 * @returns {Record<string, unknown> | null}
 */
export function buildProductionProofSummary(profile) {
  const policy = resolveProductionProofPolicy(profile);
  if (policy.enabled !== true) {
    return null;
  }
  return {
    enabled: true,
    profile_status: asNonEmptyString(policy.profile_status),
    proof_scope: asNonEmptyString(policy.proof_scope),
    external_runner_mode: asNonEmptyString(policy.external_runner_mode),
    real_code_change_proof_required: policy.real_code_change_proof_required === true,
    real_code_change_proof_complete: policy.real_code_change_proof_complete === true,
    mock_runner_allowed: policy.mock_runner_allowed === true,
    no_upstream_write_required: policy.no_upstream_write_required === true,
    require_runner_auth: policy.require_runner_auth === true,
    require_permission_readiness: policy.require_permission_readiness === true,
    require_blocking_target_verification: policy.require_blocking_target_verification === true,
    required_failure_mode: asNonEmptyString(policy.required_failure_mode),
  };
}

/**
 * @param {Record<string, unknown>} verdictMatrix
 * @returns {{ ok: boolean, failed_fields: string[] }}
 */
function assessProductionProofVerdicts(verdictMatrix) {
  const failedFields = PRODUCTION_PROOF_REQUIRED_VERDICT_FIELDS.filter(
    (field) => !isPassStatus(verdictMatrix[field]),
  );
  return {
    ok: failedFields.length === 0,
    failed_fields: failedFields,
  };
}

/**
 * @param {Record<string, unknown>} artifacts
 * @returns {{ status: "pass" | "fail", delivery_manifest_file: string | null, changed_paths: string[], writeback_results: string[], target_head_unchanged: boolean, commit_refs: string[], findings: string[] }}
 */
function assessNoUpstreamWrite(artifacts) {
  const deliveryManifestFile = asNonEmptyString(artifacts.delivery_manifest_file) || null;
  const deliveryManifest = readJsonIfPresent(deliveryManifestFile);
  const repoDeliveries = Array.isArray(deliveryManifest.repo_deliveries) ? deliveryManifest.repo_deliveries : [];
  const findings = [];
  const changedPaths = [];
  const writebackResults = [];
  const commitRefs = [];
  let targetHeadUnchanged = true;

  if (!deliveryManifestFile || !fileExists(deliveryManifestFile)) {
    findings.push("delivery manifest is missing");
  }
  if (repoDeliveries.length === 0) {
    findings.push("delivery manifest has no repo deliveries");
  }

  for (const entry of repoDeliveries) {
    const delivery = asRecord(entry);
    changedPaths.push(...asStringArray(delivery.changed_paths));
    const writebackResult = asNonEmptyString(delivery.writeback_result);
    if (writebackResult) writebackResults.push(writebackResult);
    commitRefs.push(...asStringArray(delivery.commit_refs));
    const provenance = asRecord(delivery.checkout_provenance);
    const headBeforeCommit = asNonEmptyString(asRecord(provenance.head_before).commit);
    const headAfterCommit = asNonEmptyString(asRecord(provenance.head_after).commit);
    if (headBeforeCommit && headAfterCommit && headBeforeCommit !== headAfterCommit) {
      targetHeadUnchanged = false;
    }
  }

  if (commitRefs.length > 0) {
    findings.push("delivery manifest records commit refs");
  }
  if (!targetHeadUnchanged) {
    findings.push("target HEAD changed during patch-only proof");
  }
  if (writebackResults.some((result) => /\b(?:push|pushed|remote|upstream)\b/iu.test(result))) {
    findings.push("delivery manifest records a remote/upstream writeback result");
  }

  return {
    status: findings.length === 0 ? "pass" : "fail",
    delivery_manifest_file: deliveryManifestFile,
    changed_paths: uniqueStrings(changedPaths),
    writeback_results: uniqueStrings(writebackResults),
    target_head_unchanged: targetHeadUnchanged,
    commit_refs: uniqueStrings(commitRefs),
    findings,
  };
}

/**
 * @param {string | null | undefined} runtimeHarnessReportFile
 * @returns {{ status: "pass" | "fail", report_file: string | null, meaningful_changed_paths: string[], findings: string[] }}
 */
function assessRuntimeHarnessProof(runtimeHarnessReportFile) {
  const reportFile = asNonEmptyString(runtimeHarnessReportFile) || null;
  const findings = [];
  const report = readJsonIfPresent(reportFile);
  const stepDecisions = Array.isArray(report.step_decisions) ? report.step_decisions : [];
  const meaningfulChangedPaths = uniqueStrings(
    stepDecisions.flatMap((entry) => asStringArray(asRecord(asRecord(entry).mission_semantics).meaningful_changed_paths)),
  );

  if (!reportFile || !fileExists(reportFile)) {
    findings.push("Runtime Harness report is missing");
  }
  if (!isPassStatus(report.overall_decision)) {
    findings.push("Runtime Harness overall_decision is not pass");
  }
  if (meaningfulChangedPaths.length === 0) {
    findings.push("Runtime Harness has no meaningful changed paths");
  }

  return {
    status: findings.length === 0 ? "pass" : "fail",
    report_file: reportFile,
    meaningful_changed_paths: meaningfulChangedPaths,
    findings,
  };
}

/**
 * @param {string[]} expectedPaths
 * @param {string[]} actualPaths
 * @returns {string[]}
 */
function findMissingChangedPaths(expectedPaths, actualPaths) {
  const actualPathSet = new Set(actualPaths);
  return expectedPaths.filter((changedPath) => !actualPathSet.has(changedPath));
}

/**
 * @param {string | null | undefined} reviewReportFile
 * @returns {{ status: "pass" | "fail", report_file: string | null, changed_paths: string[], findings: string[] }}
 */
function assessReviewProof(reviewReportFile) {
  const reportFile = asNonEmptyString(reviewReportFile) || null;
  const findings = [];
  const report = readJsonIfPresent(reportFile);
  const changedPaths = asStringArray(asRecord(report.code_quality).changed_paths);

  if (!reportFile || !fileExists(reportFile)) {
    findings.push("review report is missing");
  }
  if (!isPassStatus(report.overall_status)) {
    findings.push("review overall_status is not pass");
  }
  for (const field of ["code_quality", "provider_traceability", "feature_size_fit"]) {
    if (!isPassStatus(asRecord(report[field]).status)) {
      findings.push(`review ${field}.status is not pass`);
    }
  }
  if (changedPaths.length === 0) {
    findings.push("review report has no changed paths");
  }

  return {
    status: findings.length === 0 ? "pass" : "fail",
    report_file: reportFile,
    changed_paths: uniqueStrings(changedPaths),
    findings,
  };
}

/**
 * @param {Record<string, unknown>} artifacts
 * @param {Record<string, unknown>} productionProof
 * @returns {{ status: "pass" | "fail", findings: string[] }}
 */
function assessProductionPreflight(artifacts, productionProof) {
  const preflight = asRecord(artifacts.live_adapter_preflight);
  const findings = [];
  if (!isPassStatus(preflight.status)) {
    findings.push("live adapter preflight did not pass");
  }
  if (productionProof.require_runner_auth === true && !isPassStatus(asRecord(preflight.auth_probe).status)) {
    findings.push("runner auth probe did not pass");
  }
  if (!isPassStatus(asRecord(preflight.edit_readiness).status)) {
    findings.push("edit readiness did not pass");
  }
  if (
    productionProof.require_permission_readiness === true &&
    !isPassStatus(asRecord(preflight.permission_readiness).status)
  ) {
    findings.push("permission readiness did not pass");
  }
  if (asNonEmptyString(productionProof.external_runner_mode) !== "real-external-process") {
    findings.push("external runner mode is not real-external-process");
  }
  if (productionProof.mock_runner_allowed === true) {
    findings.push("mock runner is allowed by production proof policy");
  }

  return {
    status: findings.length === 0 ? "pass" : "fail",
    findings,
  };
}

/**
 * @param {{
 *   productionProof: Record<string, unknown> | null,
 *   flowResult: {
 *     status: string,
 *     artifacts: Record<string, unknown>,
 *   },
 * }} options
 * @returns {Record<string, unknown> | null}
 */
export function applyProductionProofEvidence(options) {
  if (!options.productionProof) {
    return null;
  }

  const artifacts = options.flowResult.artifacts;
  const qualityJudgement = asRecord(artifacts.quality_judgement);
  const verdicts = assessProductionProofVerdicts(qualityJudgement);
  const runtimeHarness = assessRuntimeHarnessProof(
    asNonEmptyString(artifacts.latest_runtime_harness_report_file) || asNonEmptyString(artifacts.runtime_harness_report_file),
  );
  const review = assessReviewProof(artifacts.review_report_file);
  const noUpstreamWrite = assessNoUpstreamWrite(artifacts);
  const missingDeliveredRuntimeHarnessPaths = findMissingChangedPaths(
    runtimeHarness.meaningful_changed_paths,
    noUpstreamWrite.changed_paths,
  );
  const missingDeliveredReviewPaths = findMissingChangedPaths(review.changed_paths, noUpstreamWrite.changed_paths);
  const preflight = assessProductionPreflight(artifacts, options.productionProof);
  const changedPaths = uniqueStrings([
    ...runtimeHarness.meaningful_changed_paths,
    ...review.changed_paths,
    ...noUpstreamWrite.changed_paths,
  ]);
  const evidenceRefs = {
    live_adapter_preflight_file: asNonEmptyString(artifacts.live_adapter_preflight_file) || null,
    runtime_harness_report_file: runtimeHarness.report_file,
    review_report_file: review.report_file,
    delivery_manifest_file: noUpstreamWrite.delivery_manifest_file,
    post_run_verify_summary_file: asNonEmptyString(artifacts.post_run_verify_summary_file) || null,
    post_run_diagnostic_verify_summary_file: asNonEmptyString(artifacts.post_run_diagnostic_verify_summary_file) || null,
    adapter_raw_evidence_ref: asNonEmptyString(artifacts.adapter_raw_evidence_ref) || null,
    learning_loop_scorecard_file: asNonEmptyString(artifacts.learning_loop_scorecard_file) || null,
    learning_loop_handoff_file: asNonEmptyString(artifacts.learning_loop_handoff_file) || null,
  };
  const requiredEvidenceRefFields = [
    "live_adapter_preflight_file",
    "runtime_harness_report_file",
    "review_report_file",
    "delivery_manifest_file",
    "post_run_verify_summary_file",
    "learning_loop_scorecard_file",
    "learning_loop_handoff_file",
  ];
  const evidenceRefsExist = requiredEvidenceRefFields.every((field) => evidenceFileExists(evidenceRefs[field]));
  const findings = uniqueStrings([
    ...(isPassStatus(options.flowResult.status) ? [] : ["full-journey flow status is not pass"]),
    ...(verdicts.ok ? [] : verdicts.failed_fields.map((field) => `quality_judgement.${field} is not pass`)),
    ...preflight.findings,
    ...runtimeHarness.findings,
    ...review.findings,
    ...noUpstreamWrite.findings,
    ...missingDeliveredRuntimeHarnessPaths.map(
      (changedPath) => `delivery manifest omits Runtime Harness meaningful path: ${changedPath}`,
    ),
    ...missingDeliveredReviewPaths.map((changedPath) => `delivery manifest omits review changed path: ${changedPath}`),
    ...(changedPaths.length > 0 ? [] : ["no meaningful changed paths were recorded"]),
    ...(evidenceRefsExist ? [] : ["one or more required proof evidence files are missing"]),
  ]);
  const complete = findings.length === 0;

  return {
    ...options.productionProof,
    proof_scope: complete ? "full_code_changing_runtime" : options.productionProof.proof_scope,
    real_code_change_proof_complete: complete,
    evidence_status: complete ? "pass" : "pending",
    evidence_refs: evidenceRefs,
    changed_paths: changedPaths,
    target_verdicts: {
      status: verdicts.ok ? "pass" : "fail",
      required_fields: [...PRODUCTION_PROOF_REQUIRED_VERDICT_FIELDS],
      failed_fields: verdicts.failed_fields,
    },
    runtime_harness: {
      status: runtimeHarness.status,
      meaningful_changed_paths: runtimeHarness.meaningful_changed_paths,
    },
    review: {
      status: review.status,
      changed_paths: review.changed_paths,
    },
    no_upstream_write_assertion: noUpstreamWrite,
    delivery_integrity: {
      status:
        missingDeliveredRuntimeHarnessPaths.length === 0 && missingDeliveredReviewPaths.length === 0 ? "pass" : "fail",
      missing_runtime_harness_changed_paths: missingDeliveredRuntimeHarnessPaths,
      missing_review_changed_paths: missingDeliveredReviewPaths,
    },
    preflight: {
      status: preflight.status,
    },
    findings,
  };
}
