#!/usr/bin/env node
import path from "node:path";
import process from "node:process";

import {
  UsageError,
  asNonEmptyString,
  asRecord,
  asStringArray,
  fileExists,
  normalizeId,
  nowIso,
  parseFlags,
  readJson,
  requireDirectory,
  resolveOptionalStringFlag,
  resolveRunnerAuthMode,
  resolveRuntimeAgentPermissionMode,
  uniqueStrings,
  writeJson,
} from "./lib/common.mjs";
import { summarizeStageCounts } from "./lib/stages.mjs";
import { validateContractDocument } from "../../packages/contracts/src/index.mjs";
import {
  discoverHostProjectId,
  ensureRuntimeLayout,
  isFullJourneyProfile,
  loadProofRunnerProfile,
  resolveCatalogRoot,
  resolveFullJourneyProfile,
  resolveProductionProofPolicy,
} from "./lib/profile-catalog.mjs";
import { executeFullJourneyFlow, executeInstalledUserFlow, resolveAorLaunch } from "./lib/flows.mjs";
import { resolveAuthProbeRequired } from "./lib/preflight.mjs";

const LIVE_E2E_OBSERVATION_STEPS = Object.freeze([
  "discovery",
  "spec",
  "planning",
  "handoff",
  "execution",
  "review",
  "qa",
  "delivery",
]);
const LIVE_E2E_OBSERVATION_PRELUDE_STEPS = Object.freeze([
  "project-init",
  "intake-create",
  "project-analyze",
  "project-validate",
]);
const LIVE_E2E_OBSERVATION_EXCLUDED_STEPS = Object.freeze(["release", "learning"]);
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
  "overall_verdict",
]);

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function asFindingStrings(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (typeof entry === "string") return entry.trim();
      const record = asRecord(entry);
      return (
        asNonEmptyString(record.summary) ||
        asNonEmptyString(record.message) ||
        asNonEmptyString(record.code) ||
        (Object.keys(record).length > 0 ? JSON.stringify(record) : "")
      );
    })
    .filter((entry) => entry.length > 0);
}

/**
 * @param {string} status
 * @returns {"pass" | "warn" | "not_pass"}
 */
function toObservationStatus(status) {
  const normalized = asNonEmptyString(status).toLowerCase();
  if (normalized === "pass" || normalized === "passed" || normalized === "success") return "pass";
  if (normalized === "warn" || normalized === "warning" || normalized === "skipped") return "warn";
  return "not_pass";
}

/**
 * @param {"pass" | "warn" | "not_pass" | string} left
 * @param {"pass" | "warn" | "not_pass" | string} right
 * @returns {"pass" | "warn" | "not_pass"}
 */
function worstObservationStatus(left, right) {
  const statuses = [toObservationStatus(left), toObservationStatus(right)];
  if (statuses.includes("not_pass")) return "not_pass";
  if (statuses.includes("warn")) return "warn";
  return "pass";
}

/**
 * @param {unknown} value
 * @returns {"pass" | "warn" | "fail"}
 */
function normalizeVerdictStatus(value) {
  const status = asNonEmptyString(value).toLowerCase();
  if (status === "pass" || status === "passed" || status === "success") return "pass";
  if (status === "warn" || status === "warning" || status === "pass_with_findings") return "warn";
  return "fail";
}

/**
 * @param {string | null} filePath
 * @returns {Record<string, unknown>}
 */
function readJsonIfPresent(filePath) {
  const resolved = asNonEmptyString(filePath);
  return resolved && fileExists(resolved) ? asRecord(readJson(resolved)) : {};
}

/**
 * @param {Record<string, unknown>} artifacts
 * @returns {string[]}
 */
function collectDeliveryChangedPaths(artifacts) {
  const deliveryManifest = readJsonIfPresent(asNonEmptyString(artifacts.delivery_manifest_file));
  const deliveryPaths = Array.isArray(deliveryManifest.repo_deliveries)
    ? deliveryManifest.repo_deliveries.flatMap((entry) => asStringArray(asRecord(entry).changed_paths))
    : [];
  const reviewReport = readJsonIfPresent(asNonEmptyString(artifacts.review_report_file));
  const reviewPaths = asStringArray(asRecord(reviewReport.code_quality).changed_paths);
  return uniqueStrings([...deliveryPaths, ...reviewPaths]);
}

/**
 * @param {Record<string, unknown>} artifacts
 * @returns {{ status: "pass" | "warn" | "not_pass", delivery_manifest_ref: string | null, review_report_ref: string | null, post_delivery_check_refs: string[], changed_paths: string[], findings: string[] }}
 */
function buildCodeQualityObservation(artifacts) {
  const deliveryManifestRef = asNonEmptyString(artifacts.delivery_manifest_file) || null;
  const reviewReportRef = asNonEmptyString(artifacts.review_report_file) || null;
  const deliveryQualityGateStatus = asNonEmptyString(artifacts.delivery_quality_gate_status);
  const postDeliveryCheckRefs = uniqueStrings([
    asNonEmptyString(artifacts.post_run_verify_summary_file),
    asNonEmptyString(artifacts.post_run_diagnostic_verify_summary_file),
  ]);
  const reviewReport = readJsonIfPresent(reviewReportRef);
  const reviewCodeQuality = asRecord(reviewReport.code_quality);
  const findings = uniqueStrings([
    ...asFindingStrings(reviewCodeQuality.findings),
    ...(asNonEmptyString(artifacts.provider_execution_status) === "fail"
      ? ["provider execution evidence was not materialized"]
      : []),
    ...(asNonEmptyString(artifacts.real_code_change_status) === "fail" ? ["no mission-scoped code change observed"] : []),
    ...(asNonEmptyString(artifacts.post_run_verify_status) === "fail" ? ["post-delivery verification failed"] : []),
    ...(asNonEmptyString(artifacts.quality_gate_decision) === "fail" ? ["legacy quality gate decision failed"] : []),
    ...(["fail", "not_pass"].includes(deliveryQualityGateStatus)
      ? ["delivery quality gate produced observed findings"]
      : []),
    ...asStringArray(artifacts.delivery_quality_gate_findings),
  ]);
  const reviewCodeStatus = normalizeVerdictStatus(reviewCodeQuality.status);
  const status =
    !deliveryManifestRef
      ? "not_pass"
      : asNonEmptyString(artifacts.provider_execution_status) === "fail" ||
          asNonEmptyString(artifacts.real_code_change_status) === "fail" ||
          asNonEmptyString(artifacts.post_run_verify_status) === "fail" ||
          asNonEmptyString(artifacts.quality_gate_decision) === "fail" ||
          ["fail", "not_pass"].includes(deliveryQualityGateStatus) ||
          reviewCodeStatus === "fail"
        ? "not_pass"
        : findings.length > 0 || reviewCodeStatus === "warn"
          ? "warn"
          : "pass";
  return {
    status,
    delivery_manifest_ref: deliveryManifestRef,
    review_report_ref: reviewReportRef,
    post_delivery_check_refs: postDeliveryCheckRefs,
    changed_paths: collectDeliveryChangedPaths(artifacts),
    findings,
  };
}

/**
 * @param {{
 *   runId: string,
 *   profilePath: string,
 *   profile: Record<string, unknown>,
 *   flowResult: ReturnType<typeof executeInstalledUserFlow> | {
 *     startedAt: string,
 *     finishedAt: string | null,
 *     status: string,
 *     stageResults: Array<{ stage: string, status: string, evidence_refs: string[], summary: string | null }>,
 *     commandResults: Array<Record<string, unknown>>,
 *     artifacts: Record<string, unknown>,
 *   },
 *   summaryFile: string,
 * }} options
 */
function buildScorecard(options) {
  const targetRepo = asRecord(options.profile.target_repo);
  const verdictMatrix =
    typeof options.flowResult.artifacts.verdict_matrix === "object" && options.flowResult.artifacts.verdict_matrix
      ? asRecord(options.flowResult.artifacts.verdict_matrix)
      : {};
  return {
    scorecard_id: `${options.runId}.scorecard.${asNonEmptyString(targetRepo.repo_id) || "target"}`,
    run_id: options.runId,
    profile_ref: options.profilePath,
    profile_id: options.profile.profile_id ?? null,
    scenario_id: options.profile.scenario_id ?? null,
    scenario_family: options.profile.scenario_family ?? null,
    target_catalog_id: options.profile.target_catalog_id ?? null,
    feature_mission_id: options.flowResult.artifacts.feature_mission_id ?? options.profile.feature_mission_id ?? null,
    provider_variant_id: options.profile.provider_variant_id ?? null,
    feature_size: options.flowResult.artifacts.feature_size ?? null,
    flow_kind: options.profile.flow_kind ?? null,
    duration_class: options.profile.duration_class ?? null,
    matrix_cell:
      typeof options.flowResult.artifacts.matrix_cell === "object" && options.flowResult.artifacts.matrix_cell
        ? options.flowResult.artifacts.matrix_cell
        : null,
    target_repo: {
      repo_id: targetRepo.repo_id ?? null,
      repo_url: targetRepo.repo_url ?? null,
      ref: targetRepo.ref ?? null,
    },
    stage_counts: summarizeStageCounts(options.flowResult.stageResults),
    status: asNonEmptyString(options.flowResult.artifacts.live_e2e_observation_overall_status) || options.flowResult.status,
    legacy_flow_status: options.flowResult.status,
    live_e2e_observation_report_file:
      asNonEmptyString(options.flowResult.artifacts.live_e2e_observation_report_file) || null,
    scenario_coverage_status: verdictMatrix.scenario_coverage_status ?? null,
    provider_execution_status: verdictMatrix.provider_execution_status ?? null,
    feature_size_fit_status: verdictMatrix.feature_size_fit_status ?? null,
    target_baseline_status: verdictMatrix.target_baseline_status ?? null,
    real_code_change_status: verdictMatrix.real_code_change_status ?? null,
    post_run_verification_status: verdictMatrix.post_run_verification_status ?? null,
    post_run_diagnostic_status: verdictMatrix.post_run_diagnostic_status ?? null,
    runtime_harness_decision: verdictMatrix.runtime_harness_decision ?? null,
    run_start_runtime_harness_decision:
      verdictMatrix.run_start_runtime_harness_decision ?? verdictMatrix.runtime_harness_decision ?? null,
    latest_runtime_harness_decision:
      verdictMatrix.latest_runtime_harness_decision ?? verdictMatrix.runtime_harness_decision ?? null,
    quality_gate_decision: verdictMatrix.quality_gate_decision ?? null,
    summary_ref: options.summaryFile,
    command_count: options.flowResult.commandResults.length,
    generated_at: nowIso(),
  };
}

/**
 * @param {string | null} filePath
 * @returns {Record<string, unknown>}
 */
function loadAgentJudgeDocument(filePath) {
  const resolved = asNonEmptyString(filePath);
  if (!resolved) return {};
  if (!fileExists(resolved)) {
    throw new UsageError(`Agent judge file '${resolved}' was not found.`);
  }
  return readJson(resolved);
}

/**
 * @param {Record<string, unknown>} profile
 */
function buildProductionProofSummary(profile) {
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
 * @returns {{ status: "pass" | "fail", report_file: string | null, mission_scoped_changed_paths: string[], findings: string[] }}
 */
function assessRuntimeHarnessProof(runtimeHarnessReportFile) {
  const reportFile = asNonEmptyString(runtimeHarnessReportFile) || null;
  const findings = [];
  const report = readJsonIfPresent(reportFile);
  const stepDecisions = Array.isArray(report.step_decisions) ? report.step_decisions : [];
  const missionScopedChangedPaths = uniqueStrings(
    stepDecisions.flatMap((entry) => asStringArray(asRecord(asRecord(entry).mission_semantics).mission_scoped_changed_paths)),
  );

  if (!reportFile || !fileExists(reportFile)) {
    findings.push("Runtime Harness report is missing");
  }
  if (!isPassStatus(report.overall_decision)) {
    findings.push("Runtime Harness overall_decision is not pass");
  }
  if (missionScopedChangedPaths.length === 0) {
    findings.push("Runtime Harness has no mission-scoped changed paths");
  }

  return {
    status: findings.length === 0 ? "pass" : "fail",
    report_file: reportFile,
    mission_scoped_changed_paths: missionScopedChangedPaths,
    findings,
  };
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
function applyProductionProofEvidence(options) {
  if (!options.productionProof) {
    return null;
  }

  const artifacts = options.flowResult.artifacts;
  const verdictMatrix = asRecord(artifacts.verdict_matrix);
  const verdicts = assessProductionProofVerdicts(verdictMatrix);
  const runtimeHarness = assessRuntimeHarnessProof(
    asNonEmptyString(artifacts.latest_runtime_harness_report_file) || asNonEmptyString(artifacts.runtime_harness_report_file),
  );
  const review = assessReviewProof(artifacts.review_report_file);
  const noUpstreamWrite = assessNoUpstreamWrite(artifacts);
  const preflight = assessProductionPreflight(artifacts, options.productionProof);
  const changedPaths = uniqueStrings([
    ...runtimeHarness.mission_scoped_changed_paths,
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
    ...(verdicts.ok ? [] : verdicts.failed_fields.map((field) => `verdict_matrix.${field} is not pass`)),
    ...preflight.findings,
    ...runtimeHarness.findings,
    ...review.findings,
    ...noUpstreamWrite.findings,
    ...(changedPaths.length > 0 ? [] : ["no meaningful mission-scoped changed paths were recorded"]),
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
      mission_scoped_changed_paths: runtimeHarness.mission_scoped_changed_paths,
    },
    review: {
      status: review.status,
      changed_paths: review.changed_paths,
    },
    no_upstream_write_assertion: noUpstreamWrite,
    preflight: {
      status: preflight.status,
    },
    findings,
  };
}

/**
 * @param {Record<string, unknown>} judgeDocument
 * @returns {Map<string, Record<string, unknown>>}
 */
function indexAgentJudgeEntries(judgeDocument) {
  const entries = Array.isArray(judgeDocument.artifact_quality_matrix)
    ? judgeDocument.artifact_quality_matrix
    : Array.isArray(judgeDocument.steps)
      ? judgeDocument.steps
      : [];
  const indexed = new Map();
  for (const entry of entries) {
    const record = asRecord(entry);
    const step = asNonEmptyString(record.step);
    if (step) indexed.set(step, record);
  }
  return indexed;
}

/**
 * @param {string} step
 * @returns {string[]}
 */
function getObservationCommandLabelPriority(step) {
  if (step === "discovery") return ["discovery-run", "project-analyze"];
  if (step === "spec") return ["spec-build", "project-validate"];
  if (step === "planning") return ["wave-create", "handoff-prepare"];
  if (step === "handoff") return ["handoff-approve"];
  if (step === "execution") return ["run-start", "project-verify-routed-live"];
  if (step === "review") return ["review-run", "harness-certify", "eval-run"];
  if (step === "qa") return ["eval-run", "project-verify-post-run-primary"];
  if (step === "delivery") return ["deliver-prepare"];
  return [];
}

/**
 * @param {Array<Record<string, unknown>>} commandResults
 * @param {string[]} labels
 * @returns {Record<string, unknown> | undefined}
 */
function findCommandByPreferredLabel(commandResults, labels) {
  for (const label of labels) {
    const command = commandResults.find((entry) => asNonEmptyString(entry.label) === label);
    if (command) return command;
  }
  return undefined;
}

/**
 * @param {{ runId: string, flowResult: { stageResults: Array<Record<string, unknown>>, commandResults: Array<Record<string, unknown>>, artifacts: Record<string, unknown> } }} options
 */
function buildObservationStepMatrix(options) {
  return LIVE_E2E_OBSERVATION_STEPS.map((step) => {
    const stage = options.flowResult.stageResults.find((entry) => asNonEmptyString(entry.stage) === step) ?? {};
    const command = findCommandByPreferredLabel(
      options.flowResult.commandResults,
      getObservationCommandLabelPriority(step),
    );
    const artifactRefs = uniqueStrings([
      ...asStringArray(stage.evidence_refs),
      ...asStringArray(command?.artifact_refs),
    ]);
    const status = toObservationStatus(asNonEmptyString(stage.status) || asNonEmptyString(command?.status) || "not_pass");
    return {
      step,
      status,
      command_label: asNonEmptyString(command?.label) || null,
      command_surface: asNonEmptyString(command?.command_surface) || null,
      artifact_refs: artifactRefs,
      findings: uniqueStrings([
        ...(status === "pass" ? [] : [asNonEmptyString(stage.summary) || `${step} did not complete cleanly`]),
        ...asStringArray(stage.missing_evidence),
        ...asStringArray(command?.missing_evidence),
      ]),
    };
  });
}

/**
 * @param {{ stepMatrix: Array<Record<string, unknown>>, agentJudgeDocument: Record<string, unknown> }} options
 */
function buildArtifactQualityMatrix(options) {
  const judgeEntries = indexAgentJudgeEntries(options.agentJudgeDocument);
  const judgeProvided = judgeEntries.size > 0;
  return options.stepMatrix.map((stepEntry) => {
    const step = asNonEmptyString(stepEntry.step);
    const judgeEntry = judgeEntries.get(step);
    if (judgeEntry) {
      const status = toObservationStatus(asNonEmptyString(judgeEntry.status) || "warn");
      return {
        step,
        status,
        judge_source: asNonEmptyString(judgeEntry.judge_source) || "agent",
        artifact_refs: asStringArray(judgeEntry.artifact_refs).length > 0
          ? asStringArray(judgeEntry.artifact_refs)
          : asStringArray(stepEntry.artifact_refs),
        findings: asStringArray(judgeEntry.findings),
      };
    }
    return {
      step,
      status: "warn",
      judge_source: judgeProvided ? "agent-partial" : "agent-missing",
      artifact_refs: asStringArray(stepEntry.artifact_refs),
      findings: [judgeProvided ? "agent-judge-step-missing" : "agent-judge-not-provided"],
    };
  });
}

/**
 * @param {{ stepMatrix: Array<Record<string, unknown>>, artifactQualityMatrix: Array<Record<string, unknown>>, codeQuality: Record<string, unknown>, artifacts: Record<string, unknown> }}
 * @returns {"pass" | "warn" | "not_pass"}
 */
function resolveObservationOverallStatus(options) {
  const deliveryStep = options.stepMatrix.find((entry) => asNonEmptyString(entry.step) === "delivery") ?? {};
  const deliveryStatus = toObservationStatus(asNonEmptyString(deliveryStep.status) || "not_pass");
  const deliveryManifestFile = asNonEmptyString(options.artifacts.delivery_manifest_file);
  if (!deliveryManifestFile || deliveryStatus === "not_pass") {
    return "not_pass";
  }
  let overall = "pass";
  for (const entry of [...options.stepMatrix, ...options.artifactQualityMatrix, options.codeQuality]) {
    overall = worstObservationStatus(overall, asNonEmptyString(entry.status) || "pass");
  }
  return overall === "not_pass" ? "warn" : overall;
}

/**
 * @param {{ stepMatrix: Array<Record<string, unknown>> }}
 */
function buildContinuationDecisions(options) {
  return options.stepMatrix
    .filter((entry) => toObservationStatus(asNonEmptyString(entry.status)) !== "pass")
    .map((entry, index, entries) => {
      const step = asNonEmptyString(entry.step);
      const nextStep =
        LIVE_E2E_OBSERVATION_STEPS[LIVE_E2E_OBSERVATION_STEPS.indexOf(step) + 1] ||
        asNonEmptyString(entries[index + 1]?.step) ||
        null;
      return {
        step,
        decision: nextStep ? "continue_with_findings" : "stop_at_delivery",
        reason: asStringArray(entry.findings)[0] || `${step} completed with observed findings`,
        next_step: nextStep,
      };
    });
}

/**
 * @param {{ runId: string, profilePath: string, profile: Record<string, unknown>, flowResult: { stageResults: Array<Record<string, unknown>>, commandResults: Array<Record<string, unknown>>, artifacts: Record<string, unknown> }, summaryFile: string, agentJudgeDocument: Record<string, unknown> }}
 */
function buildObservationReport(options) {
  const stepMatrix = buildObservationStepMatrix({
    runId: options.runId,
    flowResult: options.flowResult,
  });
  const artifactQualityMatrix = buildArtifactQualityMatrix({
    stepMatrix,
    agentJudgeDocument: options.agentJudgeDocument,
  });
  const codeQuality = buildCodeQualityObservation(options.flowResult.artifacts);
  const overallStatus = resolveObservationOverallStatus({
    stepMatrix,
    artifactQualityMatrix,
    codeQuality,
    artifacts: options.flowResult.artifacts,
  });
  return {
    report_id: `${options.runId}.live-e2e-observation.v1`,
    run_id: options.runId,
    profile_id: asNonEmptyString(options.profile.profile_id) || "unknown-profile",
    flow_range: {
      start_step: "discovery",
      end_step: "delivery",
      included_steps: [...LIVE_E2E_OBSERVATION_STEPS],
      prelude_steps: [...LIVE_E2E_OBSERVATION_PRELUDE_STEPS],
      excluded_steps: [...LIVE_E2E_OBSERVATION_EXCLUDED_STEPS],
    },
    overall_status: overallStatus,
    step_matrix: stepMatrix,
    artifact_quality_matrix: artifactQualityMatrix,
    code_quality_after_delivery: codeQuality,
    continuation_decisions: buildContinuationDecisions({ stepMatrix }),
    evidence_refs: uniqueStrings([
      options.summaryFile,
      asNonEmptyString(options.flowResult.artifacts.delivery_manifest_file),
      asNonEmptyString(options.flowResult.artifacts.review_report_file),
      asNonEmptyString(options.flowResult.artifacts.runtime_harness_report_file),
      asNonEmptyString(options.flowResult.artifacts.evaluation_report_file),
    ]),
  };
}

/**
 * @param {{ runId: string, reportsRoot: string, stepMatrix: Array<Record<string, unknown>> }}
 */
function writeAgentArtifactReviewRequest(options) {
  const requestFile = path.join(
    options.reportsRoot,
    `live-e2e-agent-artifact-review-request-${normalizeId(options.runId)}.json`,
  );
  const request = {
    request_id: `${options.runId}.agent-artifact-review.v1`,
    run_id: options.runId,
    rubric: {
      statuses: ["pass", "warn", "not_pass"],
      criteria: [
        "traceability to feature request, mission, and previous step",
        "completeness for the step",
        "actionability for the next step",
        "consistency with neighboring artifacts",
        "absence of synthetic or no-op explanations that hide failure",
      ],
    },
    expected_response_shape: {
      artifact_quality_matrix: [
        {
          step: "discovery",
          status: "pass|warn|not_pass",
          judge_source: "agent",
          artifact_refs: [],
          findings: [],
        },
      ],
    },
    steps: options.stepMatrix.map((entry) => ({
      step: asNonEmptyString(entry.step),
      artifact_refs: asStringArray(entry.artifact_refs),
      observed_status: asNonEmptyString(entry.status),
    })),
  };
  writeJson(requestFile, request);
  return requestFile;
}

/**
 * @param {{
 *   hostRoot: string,
 *   hostProjectId: string,
 *   layout: ReturnType<typeof ensureRuntimeLayout>,
 *   runId: string,
 *   profilePath: string,
 *   profile: Record<string, unknown>,
 *   flowResult: ReturnType<typeof executeInstalledUserFlow> | {
 *     startedAt: string,
 *     finishedAt: string | null,
 *     status: string,
 *     stageResults: Array<{ stage: string, status: string, evidence_refs: string[], summary: string | null }>,
 *     commandResults: Array<Record<string, unknown>>,
 *     artifacts: Record<string, unknown>,
 *   },
 *   aorLaunch: ReturnType<typeof resolveAorLaunch>,
 *   examplesRoot: string | null,
 *   agentJudgeFile: string | null,
 * }}
 */
function writeProofRunnerArtifacts(options) {
  const summaryFile = path.join(
    options.layout.reportsRoot,
    `live-e2e-run-summary-${normalizeId(options.runId)}.json`,
  );
  const scorecardFile = path.join(
    options.layout.reportsRoot,
    `live-e2e-scorecard-target-${normalizeId(options.runId)}.json`,
  );
  const agentJudgeDocument = loadAgentJudgeDocument(options.agentJudgeFile);
  const productionProofPolicy = buildProductionProofSummary(options.profile);
  const observationReport = buildObservationReport({
    runId: options.runId,
    profilePath: options.profilePath,
    profile: options.profile,
    flowResult: options.flowResult,
    summaryFile,
    agentJudgeDocument,
  });
  const observationValidation = validateContractDocument({
    family: "live-e2e-observation-report",
    document: observationReport,
    source: `runtime://live-e2e-observation/${options.runId}`,
  });
  if (!observationValidation.ok) {
    const issues = observationValidation.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Live E2E observation report failed contract validation: ${issues}`);
  }
  const observationReportFile = path.join(
    options.layout.reportsRoot,
    `live-e2e-observation-report-${normalizeId(options.runId)}.json`,
  );
  const agentArtifactReviewRequestFile = writeAgentArtifactReviewRequest({
    runId: options.runId,
    reportsRoot: options.layout.reportsRoot,
    stepMatrix: observationReport.step_matrix,
  });
  options.flowResult.artifacts.live_e2e_observation_report_file = observationReportFile;
  options.flowResult.artifacts.agent_artifact_review_request_file = agentArtifactReviewRequestFile;
  options.flowResult.artifacts.live_e2e_observation_overall_status = observationReport.overall_status;
  const productionProof = applyProductionProofEvidence({
    productionProof: productionProofPolicy,
    flowResult: options.flowResult,
  });
  if (productionProof) {
    options.flowResult.artifacts.production_proof = productionProof;
  }

  const summary = {
    run_id: options.runId,
    project_id: options.hostProjectId,
    profile_ref: options.profilePath,
    profile_id: options.profile.profile_id ?? null,
    scenario_id: options.profile.scenario_id ?? null,
    scenario_family: options.profile.scenario_family ?? null,
    target_catalog_id: options.profile.target_catalog_id ?? null,
    feature_mission_id: options.flowResult.artifacts.feature_mission_id ?? options.profile.feature_mission_id ?? null,
    provider_variant_id: options.profile.provider_variant_id ?? null,
    feature_size: options.flowResult.artifacts.feature_size ?? null,
    flow_kind: options.profile.flow_kind ?? null,
    duration_class: options.profile.duration_class ?? null,
    started_at: options.flowResult.startedAt,
    finished_at: options.flowResult.finishedAt,
    status: observationReport.overall_status,
    legacy_flow_status: options.flowResult.status,
    target_repo: asRecord(options.profile.target_repo),
    target_checkout_root:
      typeof options.flowResult.artifacts.target_checkout_root === "string"
        ? options.flowResult.artifacts.target_checkout_root
        : null,
    generated_project_profile_file:
      typeof options.flowResult.artifacts.generated_project_profile_file === "string"
        ? options.flowResult.artifacts.generated_project_profile_file
        : null,
    routed_step_result_file:
      typeof options.flowResult.artifacts.routed_step_result_file === "string"
        ? options.flowResult.artifacts.routed_step_result_file
        : null,
    runtime_harness_report_file:
      typeof options.flowResult.artifacts.runtime_harness_report_file === "string"
        ? options.flowResult.artifacts.runtime_harness_report_file
        : null,
    baseline_verify_summary_file:
      typeof options.flowResult.artifacts.baseline_verify_summary_file === "string"
        ? options.flowResult.artifacts.baseline_verify_summary_file
        : null,
    baseline_verify_status: asNonEmptyString(options.flowResult.artifacts.baseline_verify_status) || null,
    baseline_verify_gate_decision:
      typeof options.flowResult.artifacts.baseline_verify_gate_decision === "object" &&
      options.flowResult.artifacts.baseline_verify_gate_decision
        ? options.flowResult.artifacts.baseline_verify_gate_decision
        : null,
    post_run_verify_summary_file:
      typeof options.flowResult.artifacts.post_run_verify_summary_file === "string"
        ? options.flowResult.artifacts.post_run_verify_summary_file
        : null,
    post_run_verify_status: asNonEmptyString(options.flowResult.artifacts.post_run_verify_status) || null,
    post_run_diagnostic_verify_summary_file:
      typeof options.flowResult.artifacts.post_run_diagnostic_verify_summary_file === "string"
        ? options.flowResult.artifacts.post_run_diagnostic_verify_summary_file
        : null,
    post_run_diagnostic_status: asNonEmptyString(options.flowResult.artifacts.post_run_diagnostic_status) || null,
    provider_execution_status: asNonEmptyString(options.flowResult.artifacts.provider_execution_status) || null,
    real_code_change_status: asNonEmptyString(options.flowResult.artifacts.real_code_change_status) || null,
    runtime_harness_decision: asNonEmptyString(options.flowResult.artifacts.runtime_harness_decision) || null,
    run_start_runtime_harness_decision:
      asNonEmptyString(options.flowResult.artifacts.run_start_runtime_harness_decision) || null,
    latest_runtime_harness_decision:
      asNonEmptyString(options.flowResult.artifacts.latest_runtime_harness_decision) || null,
    quality_gate_decision: asNonEmptyString(options.flowResult.artifacts.quality_gate_decision) || null,
    compiled_context_ref:
      typeof options.flowResult.artifacts.compiled_context_ref === "string"
        ? options.flowResult.artifacts.compiled_context_ref
        : null,
    adapter_raw_evidence_ref:
      typeof options.flowResult.artifacts.adapter_raw_evidence_ref === "string"
        ? options.flowResult.artifacts.adapter_raw_evidence_ref
        : null,
    stage_results: options.flowResult.stageResults,
    command_results: options.flowResult.commandResults,
    artifacts: options.flowResult.artifacts,
    guided_journey:
      typeof options.flowResult.artifacts.guided_journey_proof === "object" &&
      options.flowResult.artifacts.guided_journey_proof
        ? options.flowResult.artifacts.guided_journey_proof
        : null,
    live_e2e_observation_report_file: observationReportFile,
    live_e2e_observation_overall_status: observationReport.overall_status,
    agent_artifact_review_request_file: agentArtifactReviewRequestFile,
    matrix_cell:
      typeof options.flowResult.artifacts.matrix_cell === "object" && options.flowResult.artifacts.matrix_cell
        ? options.flowResult.artifacts.matrix_cell
        : null,
    production_proof: productionProof,
    proof_scope: productionProof?.proof_scope ?? null,
    external_runner_mode: productionProof?.external_runner_mode ?? null,
    real_code_change_proof_complete: productionProof?.real_code_change_proof_complete ?? null,
    production_proof_evidence_status: productionProof?.evidence_status ?? null,
    production_proof_evidence_refs: productionProof?.evidence_refs ?? null,
    no_upstream_write_assertion: productionProof?.no_upstream_write_assertion ?? null,
    delivery_manifest_file: productionProof?.evidence_refs?.delivery_manifest_file ?? null,
    review_report_file: productionProof?.evidence_refs?.review_report_file ?? null,
    latest_runtime_harness_report_file: productionProof?.evidence_refs?.runtime_harness_report_file ?? null,
    coverage_follow_up:
      typeof options.flowResult.artifacts.coverage_follow_up === "object" && options.flowResult.artifacts.coverage_follow_up
        ? options.flowResult.artifacts.coverage_follow_up
        : null,
    verdict_matrix:
      typeof options.flowResult.artifacts.verdict_matrix === "object" && options.flowResult.artifacts.verdict_matrix
        ? options.flowResult.artifacts.verdict_matrix
        : null,
    scorecard_files: [scorecardFile],
    control_surfaces: {
      installed_user_proof_runner:
        "node ./scripts/live-e2e/run-profile.mjs --project-ref <path> --profile <path> [--run-id <id>] [--runtime-root <path>] [--aor-bin <path>] [--examples-root <path>] [--catalog-root <path>] [--runner-auth-mode host|isolated] [--runtime-agent-permission-mode full-bypass|restricted] [--agent-judge-file <path>]",
      public_cli_sequence: options.flowResult.commandResults.map((result) => result.command_surface).filter(Boolean),
      aor_bin: options.aorLaunch.binaryRef,
      examples_root: options.examplesRoot,
    },
    runner_auth_mode: asNonEmptyString(options.flowResult.artifacts.runner_auth_mode) || null,
    runner_auth_source: asNonEmptyString(options.flowResult.artifacts.runner_auth_source) || null,
    runtime_agent_permission_mode: asNonEmptyString(options.flowResult.artifacts.runtime_agent_permission_mode) || null,
    error:
      observationReport.overall_status === "not_pass"
        ? options.flowResult.stageResults.find((stage) => stage.status === "fail")?.summary ||
          asNonEmptyString(asRecord(options.flowResult.artifacts.scenario_coverage).summary) ||
          "Installed-user rehearsal failed without a stage-level failure summary."
        : null,
  };
  const scorecard = buildScorecard({
    runId: options.runId,
    profilePath: options.profilePath,
    profile: options.profile,
    flowResult: options.flowResult,
    summaryFile,
  });

  writeJson(observationReportFile, observationReport);
  writeJson(summaryFile, summary);
  writeJson(scorecardFile, scorecard);

  let learningLoop = null;
  const publicLearningScorecard = asNonEmptyString(options.flowResult.artifacts.learning_loop_scorecard_file);
  const publicLearningHandoff = asNonEmptyString(options.flowResult.artifacts.learning_loop_handoff_file);
  const publicIncidentFile = asNonEmptyString(options.flowResult.artifacts.incident_report_file);
  if (publicLearningScorecard && publicLearningHandoff) {
    learningLoop = {
      scorecardFile: publicLearningScorecard,
      handoffFile: publicLearningHandoff,
      incidentFile: publicIncidentFile || null,
    };
    summary.learning_loop_scorecard_file = publicLearningScorecard;
    summary.learning_loop_handoff_file = publicLearningHandoff;
    summary.incident_report_file = publicIncidentFile || null;
    writeJson(summaryFile, summary);
  }

  return {
    summary,
    summaryFile,
    scorecard,
    scorecardFile,
    learningLoop,
  };
}

/**
 * @param {string[]} rawArgs
 */
function runCli(rawArgs) {
  if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
    process.stdout.write(
      [
        "Usage: node ./scripts/live-e2e/run-profile.mjs --project-ref <path> --profile <path> [--run-id <id>] [--runtime-root <path>] [--aor-bin <path>] [--examples-root <path>] [--catalog-root <path>] [--runner-auth-mode host|isolated] [--runtime-agent-permission-mode full-bypass|restricted] [--agent-judge-file <path>]",
        "",
        "Installed-user black-box proof runner.",
      ].join("\n"),
    );
    return 0;
  }

  const flags = parseFlags(rawArgs);
  const hostRoot = requireDirectory(
    resolveOptionalStringFlag(flags["project-ref"], "project-ref") ??
      (() => {
        throw new UsageError("Flag '--project-ref' is required.");
      })(),
  );
  const profileRef =
    resolveOptionalStringFlag(flags.profile, "profile") ??
    (() => {
      throw new UsageError("Flag '--profile' is required.");
    })();
  const runtimeRoot = resolveOptionalStringFlag(flags["runtime-root"], "runtime-root");
  const aorBin = resolveOptionalStringFlag(flags["aor-bin"], "aor-bin");
  const agentJudgeFile = resolveOptionalStringFlag(flags["agent-judge-file"], "agent-judge-file");
  const catalogRootOverride = resolveOptionalStringFlag(flags["catalog-root"], "catalog-root");
  const runnerAuthMode = resolveRunnerAuthMode(resolveOptionalStringFlag(flags["runner-auth-mode"], "runner-auth-mode"));
  const runtimeAgentPermissionMode = resolveRuntimeAgentPermissionMode(
    resolveOptionalStringFlag(flags["runtime-agent-permission-mode"], "runtime-agent-permission-mode"),
  );
  const explicitExamplesRoot =
    Object.prototype.hasOwnProperty.call(flags, "examples-root")
      ? resolveOptionalStringFlag(flags["examples-root"], "examples-root")
      : null;
  const { profilePath, profile: loadedProfile } = loadProofRunnerProfile({
    hostRoot,
    profileRef,
  });
  const catalogRoot = resolveCatalogRoot({
    hostRoot,
    catalogRootOverride,
  });
  const fullJourneyResolution = isFullJourneyProfile(loadedProfile)
    ? resolveFullJourneyProfile({
        profile: loadedProfile,
        catalogRoot,
      })
    : null;
  const profile = fullJourneyResolution?.resolvedProfile ?? loadedProfile;
  const productionProof = fullJourneyResolution ? buildProductionProofSummary(profile) : null;
  if (productionProof && explicitExamplesRoot && productionProof.mock_runner_allowed !== true) {
    throw new UsageError(
      `Production proof profile '${asNonEmptyString(profile.profile_id) || profileRef}' cannot use --examples-root; packaged bootstrap assets are required to prevent deterministic mock injection.`,
    );
  }
  const examplesRoot = explicitExamplesRoot
    ? requireDirectory(explicitExamplesRoot)
    : fullJourneyResolution
      ? null
      : requireDirectory(path.join(hostRoot, "examples"));
  const hostProjectId = discoverHostProjectId(hostRoot);
  const layout = ensureRuntimeLayout({
    hostRoot,
    runtimeRootOverride: runtimeRoot,
    hostProjectId,
  });
  const runId =
    resolveOptionalStringFlag(flags["run-id"], "run-id") ??
    `${asNonEmptyString(profile.profile_id) || "live-e2e"}.run-${nowIso().replace(/[^0-9]/g, "").slice(-12)}`;
  const aorLaunch = resolveAorLaunch({
    hostRoot,
    aorBinOverride: aorBin,
  });

  /** @type {{
   *   startedAt: string,
   *   finishedAt: string | null,
   *   status: string,
   *   stageResults: Array<{ stage: string, status: string, evidence_refs: string[], summary: string | null }>,
   *   commandResults: Array<Record<string, unknown>>,
   *   artifacts: Record<string, unknown>,
   * }} */
  let flowResult;

  try {
    flowResult = fullJourneyResolution
      ? executeFullJourneyFlow({
          hostRoot,
          layout,
          runId,
          profilePath,
          profile,
          aorLaunch,
          examplesRoot: examplesRoot ?? path.join(hostRoot, "examples"),
          examplesRootOverride: explicitExamplesRoot && examplesRoot ? examplesRoot : null,
          catalogTargetPath: fullJourneyResolution.catalogTargetPath,
          catalogEntry: fullJourneyResolution.catalogEntry,
          mission: fullJourneyResolution.mission,
          scenarioPolicyPath: fullJourneyResolution.scenarioPolicyPath,
          scenarioPolicy: fullJourneyResolution.scenarioPolicy,
          providerVariantPath: fullJourneyResolution.providerVariantPath,
          providerVariant: fullJourneyResolution.providerVariant,
          featureSize: fullJourneyResolution.featureSize,
          matrixCell: fullJourneyResolution.matrixCell,
          coverageFollowUp: fullJourneyResolution.coverageFollowUp,
          coverageTier: fullJourneyResolution.coverageTier,
          runnerAuthMode,
          runtimeAgentPermissionMode,
          authProbeRequired: resolveAuthProbeRequired(profile),
        })
      : executeInstalledUserFlow({
          hostRoot,
          layout,
          runId,
          profilePath,
          profile,
          aorLaunch,
          runnerAuthMode,
          runtimeAgentPermissionMode,
          examplesRoot:
            examplesRoot ??
            (() => {
              throw new UsageError("Bounded rehearsal requires bootstrap assets under '--examples-root' or '<project-ref>/examples'.");
            })(),
        });
  } catch (error) {
    flowResult = {
      startedAt: nowIso(),
      finishedAt: nowIso(),
      status: "fail",
      stageResults: [
        {
          stage: "bootstrap",
          status: "fail",
          evidence_refs: [],
          summary: error instanceof Error ? error.message : String(error),
        },
      ],
      commandResults: [],
      artifacts: {
        host_runtime_root: layout.runtimeRoot,
        host_reports_root: layout.reportsRoot,
        runtime_agent_permission_mode: runtimeAgentPermissionMode,
      },
    };
  }

  const written = writeProofRunnerArtifacts({
    hostRoot,
    hostProjectId,
    layout,
    runId,
    profilePath,
    profile,
    flowResult,
    aorLaunch,
    examplesRoot,
    agentJudgeFile,
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        command: "scripts live-e2e run-profile",
        status: "ok",
        run_id: runId,
        live_e2e_run_status: written.summary.status,
        live_e2e_run_summary_file: written.summaryFile,
        live_e2e_observation_report_file: written.summary.live_e2e_observation_report_file,
        agent_artifact_review_request_file: written.summary.agent_artifact_review_request_file,
        live_e2e_scorecard_files: [written.scorecardFile],
        learning_loop_scorecard_file: written.learningLoop?.scorecardFile ?? null,
        learning_loop_handoff_file: written.learningLoop?.handoffFile ?? null,
        incident_report_file: written.learningLoop?.incidentFile ?? null,
      },
      null,
      2,
    )}\n`,
  );
  return 0;
}

try {
  process.exitCode = runCli(process.argv.slice(2));
} catch (error) {
  if (error instanceof UsageError) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  } else {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
