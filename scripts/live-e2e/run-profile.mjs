#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

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
  resolveRuntimeAgentAutoApprovalProfile,
  resolveRuntimeAgentInteractionPolicy,
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
} from "./lib/profile-catalog.mjs";
import { executeFullJourneyFlow, executeInstalledUserFlow, prepareAorInstallationProof } from "./lib/flows.mjs";
import { resolveAuthProbeRequired } from "./lib/preflight.mjs";
import { applyProductionProofEvidence, buildProductionProofSummary } from "./lib/production-proof.mjs";
import {
  buildLiveE2eStepPlan,
  createLiveE2eStepController,
  getLiveE2eIncludedStepsForProfile,
  isLiveE2eControllerStopInProgress,
  resolveLiveE2eOperatorContext,
} from "./lib/step-controller.mjs";

const LIVE_E2E_OBSERVATION_PRELUDE_STEPS = Object.freeze([
  "install",
  "target_checkout",
  "project_bootstrap",
  "intake",
  "readiness",
]);
const OPERATOR_DECISION_REQUIRED_FINDING = "Skill-agent operator decision is required before the next public step.";
const LIVE_E2E_OPERATOR_ACTIONS = Object.freeze([
  "continue",
  "answer",
  "frontend_interact",
  "retry_public_step",
  "diagnose",
  "block",
]);

/**
 * @param {string} cwd
 * @param {string[]} args
 * @returns {string | null}
 */
function gitOutputOrNull(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() || null : null;
}

/**
 * @param {string} hostRoot
 */
function resolveHostSourceMetadata(hostRoot) {
  return {
    commit_sha: gitOutputOrNull(hostRoot, ["rev-parse", "HEAD"]),
    branch_name: gitOutputOrNull(hostRoot, ["branch", "--show-current"]),
  };
}
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
 * @returns {"pass" | "warn" | "not_pass" | "blocked" | "interaction_required" | "resumed"}
 */
function toObservationStatus(status) {
  const normalized = asNonEmptyString(status).toLowerCase();
  if (normalized === "pass" || normalized === "passed" || normalized === "success") return "pass";
  if (normalized === "warn" || normalized === "warning" || normalized === "skipped") return "warn";
  if (normalized === "blocked" || normalized === "block") return "blocked";
  if (normalized === "interaction_required" || normalized === "interactive" || normalized === "requested") {
    return "interaction_required";
  }
  if (normalized === "resumed") return "resumed";
  return "not_pass";
}

/**
 * @param {"pass" | "warn" | "not_pass" | "blocked" | "interaction_required" | "resumed" | string} left
 * @param {"pass" | "warn" | "not_pass" | "blocked" | "interaction_required" | "resumed" | string} right
 * @returns {"pass" | "warn" | "not_pass" | "blocked" | "interaction_required" | "resumed"}
 */
function worstObservationStatus(left, right) {
  const statuses = [toObservationStatus(left), toObservationStatus(right)];
  if (statuses.includes("blocked")) return "blocked";
  if (statuses.includes("interaction_required")) return "interaction_required";
  if (statuses.includes("not_pass")) return "not_pass";
  if (statuses.includes("warn")) return "warn";
  if (statuses.includes("resumed")) return "resumed";
  return "pass";
}

/**
 * Public implementation repair loops preserve every execution/review iteration
 * in the step journal. Final quality is judged from the latest observed loop
 * iteration so a repaired earlier review finding does not poison the final run.
 *
 * @param {Array<Record<string, unknown>>} stepJournal
 * @returns {Array<Record<string, unknown>>}
 */
function getQualityRelevantStepJournal(stepJournal) {
  const loopSteps = new Set(["execution", "review"]);
  const latestIterationByStep = new Map();
  for (const rawEntry of stepJournal) {
    const entry = asRecord(rawEntry);
    const step = asNonEmptyString(entry.step_id);
    if (!loopSteps.has(step)) continue;
    const iteration = Number(entry.iteration) || 1;
    latestIterationByStep.set(step, Math.max(latestIterationByStep.get(step) ?? 0, iteration));
  }
  return stepJournal.filter((rawEntry) => {
    const entry = asRecord(rawEntry);
    const step = asNonEmptyString(entry.step_id);
    if (!loopSteps.has(step)) return true;
    return (Number(entry.iteration) || 1) === (latestIterationByStep.get(step) ?? 1);
  });
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
 * @param {Record<string, unknown>} context
 * @returns {string[]}
 */
function evidenceRootCandidates(context = {}) {
  return uniqueStrings([
    asNonEmptyString(context.reportsRoot),
    asNonEmptyString(context.sourceRoot),
    asNonEmptyString(context.targetCheckoutRoot),
    ...asStringArray(context.extraRoots),
  ]).filter((root) => root && path.isAbsolute(root) && fileExists(root));
}

/**
 * @param {string} ref
 * @returns {boolean}
 */
function isMaterializedRelativeRef(ref) {
  return (
    ref.startsWith(".") ||
    ref.startsWith("apps/") ||
    ref.startsWith("docs/") ||
    ref.startsWith("examples/") ||
    ref.startsWith("packages/") ||
    ref.startsWith("scripts/") ||
    ref.includes("\\")
  );
}

/**
 * @param {string} evidenceRef
 * @param {Record<string, unknown>} context
 * @returns {boolean}
 */
function localEvidenceRefExists(evidenceRef, context = {}) {
  const ref = asNonEmptyString(evidenceRef);
  if (!ref) return true;
  if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(ref)) {
    if (!ref.startsWith("evidence://")) return true;
    const evidencePath = ref.slice("evidence://".length);
    if (!evidencePath) return false;
    if (path.isAbsolute(evidencePath)) return fileExists(evidencePath);
    const roots = evidenceRootCandidates(context);
    if (roots.some((root) => fileExists(path.resolve(root, evidencePath)))) return true;
    return !isMaterializedRelativeRef(evidencePath);
  }
  if (path.isAbsolute(ref)) return fileExists(ref);
  if (ref.startsWith(".") || ref.includes("/") || ref.includes("\\")) {
    const roots = evidenceRootCandidates(context);
    if (roots.some((root) => fileExists(path.resolve(root, ref)))) return true;
    return !isMaterializedRelativeRef(ref);
  }
  return true;
}

/**
 * @param {Array<Record<string, unknown>>} runtimePermissionDecisions
 * @returns {Record<string, unknown>}
 */
function buildRuntimePermissionSummary(runtimePermissionDecisions) {
  const decisionCounts = {};
  for (const decision of runtimePermissionDecisions) {
    const key = asNonEmptyString(decision.decision) || "unknown";
    decisionCounts[key] = (Number(decisionCounts[key]) || 0) + 1;
  }
  return {
    total: runtimePermissionDecisions.length,
    decision_counts: decisionCounts,
    permission_modes: uniqueStrings(runtimePermissionDecisions.map((decision) => asNonEmptyString(decision.permission_mode))),
    interaction_policies: uniqueStrings(
      runtimePermissionDecisions.map((decision) => asNonEmptyString(decision.interaction_policy)),
    ),
    auto_approval_profiles: uniqueStrings(
      runtimePermissionDecisions.map((decision) => asNonEmptyString(decision.auto_approval_profile)),
    ),
    approval_scopes: uniqueStrings(runtimePermissionDecisions.map((decision) => asNonEmptyString(decision.approval_scope))),
    approval_resume_modes: uniqueStrings(
      runtimePermissionDecisions.map((decision) => asNonEmptyString(decision.approval_resume_mode)),
    ),
    continuation_strategies: uniqueStrings(
      runtimePermissionDecisions.map((decision) => asNonEmptyString(decision.continuation_strategy)),
    ),
    audit_refs: uniqueStrings(runtimePermissionDecisions.map((decision) => asNonEmptyString(decision.audit_ref))),
    grant_refs: uniqueStrings(runtimePermissionDecisions.map((decision) => asNonEmptyString(decision.grant_ref))),
  };
}

/**
 * @param {string[]} reportFiles
 * @returns {{ report_file: string | null, summary: Record<string, unknown> | null, decisions: Array<Record<string, unknown>> }}
 */
function collectRuntimePermissionEvidence(reportFiles) {
  const reports = uniqueStrings(reportFiles.map((filePath) => asNonEmptyString(filePath))).map((filePath) => ({
    filePath,
    report: readJsonIfPresent(filePath),
  }));
  const decisions = [];
  const seenDecisionKeys = new Set();
  for (const { report } of reports) {
    const reportDecisions = Array.isArray(report.runtime_permission_decisions)
      ? report.runtime_permission_decisions.filter((entry) => typeof entry === "object" && entry !== null && !Array.isArray(entry))
      : [];
    for (const decision of reportDecisions) {
      const record = asRecord(decision);
      const key = [
        asNonEmptyString(record.step_result_ref),
        asNonEmptyString(record.audit_ref),
        asNonEmptyString(record.decision),
        asNonEmptyString(record.operation_type),
      ]
        .filter(Boolean)
        .join("|");
      if (key && seenDecisionKeys.has(key)) continue;
      if (key) seenDecisionKeys.add(key);
      decisions.push(record);
    }
  }
  if (decisions.length > 0) {
    return {
      report_file: reports.find(({ report }) => Array.isArray(report.runtime_permission_decisions) && report.runtime_permission_decisions.length > 0)?.filePath ?? null,
      summary: buildRuntimePermissionSummary(decisions),
      decisions,
    };
  }
  const summaryReport = reports.find(({ report }) => Object.keys(asRecord(report.runtime_permission_summary)).length > 0);
  return {
    report_file: summaryReport?.filePath ?? reports[0]?.filePath ?? null,
    summary: summaryReport ? asRecord(summaryReport.report.runtime_permission_summary) : null,
    decisions: [],
  };
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
  const deliveryBlocked = artifacts.delivery_blocking === true;
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
    ...(asNonEmptyString(artifacts.real_code_change_status) === "fail" ? ["no meaningful code change observed"] : []),
    ...(asNonEmptyString(artifacts.post_run_verify_status) === "fail" ? ["post-delivery verification failed"] : []),
    ...(asNonEmptyString(artifacts.quality_gate_decision) === "fail" ? ["quality gate decision failed"] : []),
    ...(deliveryBlocked ? ["delivery prepare was blocked"] : []),
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
          deliveryBlocked ||
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
 * @param {Record<string, unknown>} artifacts
 * @returns {string | null}
 */
function inferRuntimeHarnessDecision(artifacts) {
  const directDecision =
    asNonEmptyString(artifacts.runtime_harness_decision) ||
    asNonEmptyString(artifacts.run_start_runtime_harness_decision) ||
    asNonEmptyString(artifacts.latest_runtime_harness_decision) ||
    asNonEmptyString(artifacts.runtime_harness_overall_decision);
  if (directDecision) return directDecision;
  const reportFiles = uniqueStrings([
    asNonEmptyString(artifacts.latest_runtime_harness_report_file),
    asNonEmptyString(artifacts.delivery_runtime_harness_report_file),
    asNonEmptyString(artifacts.runtime_harness_report_file),
    asNonEmptyString(artifacts.run_start_runtime_harness_report_file),
  ]);
  for (const reportFile of reportFiles) {
    const decision = asNonEmptyString(readJsonIfPresent(reportFile).overall_decision);
    if (decision) return decision;
  }
  return null;
}

/**
 * @param {Record<string, unknown>} artifacts
 * @param {{ reportsRoot: string, sourceRoot: string, targetCheckoutRoot?: string }} context
 */
function normalizePreVerdictQualityArtifacts(artifacts, context) {
  const reviewReport = readJsonIfPresent(asNonEmptyString(artifacts.review_report_file));
  const reviewCodeStatus = normalizeVerdictStatus(asRecord(reviewReport.code_quality).status);
  const changedPaths = collectDeliveryChangedPaths(artifacts);
  const providerEvidenceMaterialized = localEvidenceRefExists(asNonEmptyString(artifacts.adapter_raw_evidence_ref), {
    reportsRoot: context.reportsRoot,
    sourceRoot: context.sourceRoot,
    targetCheckoutRoot: asNonEmptyString(context.targetCheckoutRoot),
  });
  if (!asNonEmptyString(artifacts.provider_execution_status) && asNonEmptyString(artifacts.adapter_raw_evidence_ref)) {
    artifacts.provider_execution_status = providerEvidenceMaterialized ? "pass" : "fail";
  }
  if (!asNonEmptyString(artifacts.real_code_change_status) && changedPaths.length > 0) {
    artifacts.real_code_change_status = "pass";
  }
  if (!asNonEmptyString(artifacts.code_quality_status) && Object.keys(asRecord(reviewReport.code_quality)).length > 0) {
    artifacts.code_quality_status = reviewCodeStatus;
  }
  const runtimeHarnessDecision = inferRuntimeHarnessDecision(artifacts);
  if (!asNonEmptyString(artifacts.runtime_harness_decision) && runtimeHarnessDecision) {
    artifacts.runtime_harness_decision = runtimeHarnessDecision;
  }
  if (!asNonEmptyString(artifacts.latest_runtime_harness_decision) && runtimeHarnessDecision) {
    artifacts.latest_runtime_harness_decision = runtimeHarnessDecision;
  }
  if (!asNonEmptyString(artifacts.run_start_runtime_harness_decision) && runtimeHarnessDecision) {
    artifacts.run_start_runtime_harness_decision = runtimeHarnessDecision;
  }
  const deliveryStatus = asNonEmptyString(artifacts.delivery_manifest_file) ? "materialized" : "not_materialized";
  const releaseStatus = asNonEmptyString(artifacts.release_status) || (asNonEmptyString(artifacts.release_packet_file) ? "pass" : "");
  const verificationPass = asNonEmptyString(artifacts.post_run_verify_status) === "pass";
  const diagnosticPass = asNonEmptyString(artifacts.post_run_diagnostic_status) !== "fail";
  const qualityInputsPass =
    asNonEmptyString(artifacts.provider_execution_status) === "pass" &&
    asNonEmptyString(artifacts.real_code_change_status) === "pass" &&
    ["pass", "warn"].includes(asNonEmptyString(artifacts.code_quality_status)) &&
    verificationPass &&
    diagnosticPass &&
    deliveryStatus === "materialized" &&
    (releaseStatus === "pass" || !releaseStatus);
  if (!asNonEmptyString(artifacts.quality_gate_decision) && qualityInputsPass) {
    artifacts.quality_gate_decision = "pass";
  }
  if (!asNonEmptyString(artifacts.artifact_quality_status) && qualityInputsPass) {
    artifacts.artifact_quality_status = "pass";
  }
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
  const qualityJudgement =
    typeof options.flowResult.artifacts.quality_judgement === "object" && options.flowResult.artifacts.quality_judgement
      ? asRecord(options.flowResult.artifacts.quality_judgement)
      : {};
  const canonicalStatus = asRecord(options.flowResult.artifacts.canonical_status);
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
    run_tier: asNonEmptyString(canonicalStatus.run_tier) || asNonEmptyString(options.flowResult.artifacts.run_tier) || null,
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
    canonical_status: Object.keys(canonicalStatus).length > 0 ? canonicalStatus : null,
    command_status: asNonEmptyString(canonicalStatus.command_status) || null,
    target_verification_status: asNonEmptyString(canonicalStatus.target_verification_status) || null,
    artifact_quality_status: asNonEmptyString(canonicalStatus.artifact_quality_status) || null,
    delivery_status: asNonEmptyString(canonicalStatus.delivery_status) || null,
    coverage_status: asNonEmptyString(canonicalStatus.coverage_status) || null,
    acceptance_status: asNonEmptyString(canonicalStatus.acceptance_status) || null,
    release_status: asNonEmptyString(canonicalStatus.release_status) || null,
    proof_eligible_tier:
      typeof canonicalStatus.proof_eligible_tier === "boolean" ? canonicalStatus.proof_eligible_tier : null,
    required_matrix_acceptance_closed:
      typeof canonicalStatus.required_matrix_acceptance_closed === "boolean"
        ? canonicalStatus.required_matrix_acceptance_closed
        : null,
    live_e2e_observation_report_file:
      asNonEmptyString(options.flowResult.artifacts.live_e2e_observation_report_file) || null,
    scenario_coverage_status: qualityJudgement.scenario_coverage_status ?? null,
    provider_execution_status: qualityJudgement.provider_execution_status ?? null,
    feature_size_fit_status: qualityJudgement.feature_size_fit_status ?? null,
    target_baseline_status: qualityJudgement.target_baseline_status ?? null,
    real_code_change_status: qualityJudgement.real_code_change_status ?? null,
    post_run_verification_status: qualityJudgement.post_run_verification_status ?? null,
    post_run_diagnostic_status: qualityJudgement.post_run_diagnostic_status ?? null,
    runtime_harness_decision: qualityJudgement.runtime_harness_decision ?? null,
    run_start_runtime_harness_decision:
      qualityJudgement.run_start_runtime_harness_decision ?? qualityJudgement.runtime_harness_decision ?? null,
    latest_runtime_harness_decision:
      qualityJudgement.latest_runtime_harness_decision ?? qualityJudgement.runtime_harness_decision ?? null,
    quality_gate_decision: qualityJudgement.quality_gate_decision ?? null,
    summary_ref: options.summaryFile,
    command_count: options.flowResult.commandResults.length,
    generated_at: nowIso(),
  };
}

/**
 * @param {Record<string, unknown>} profile
 * @returns {"delivery_default" | "full_lifecycle"}
 */
function resolveFlowRangePolicy(profile) {
  const policy = asNonEmptyString(asRecord(profile.live_e2e).flow_range_policy);
  return policy === "full_lifecycle" ? "full_lifecycle" : "delivery_default";
}

/**
 * @param {Record<string, unknown>} profile
 * @returns {string[]}
 */
function getIncludedStepsForProfile(profile) {
  return getLiveE2eIncludedStepsForProfile(profile);
}

/**
 * @param {string | null} value
 * @returns {"auto" | "manual" | "evaluator"}
 */
function resolveLiveE2eControllerMode(value) {
  const normalized = asNonEmptyString(value) || "auto";
  if (normalized === "auto" || normalized === "manual" || normalized === "evaluator") return normalized;
  throw new UsageError(`Unsupported --controller-mode '${normalized}'. Expected auto, manual, or evaluator.`);
}

/**
 * @param {string | null} value
 * @param {{ aorBin: string | null, profile: Record<string, unknown>, fullJourney: boolean }} options
 * @returns {"isolated" | "repo-local" | "provided-binary"}
 */
function resolveAorInstallMode(value, options) {
  if (options.aorBin) return "provided-binary";
  const explicit = asNonEmptyString(value);
  if (explicit) {
    if (explicit === "isolated" || explicit === "repo-local") return explicit;
    throw new UsageError(`Unsupported --aor-install-mode '${explicit}'. Expected isolated or repo-local.`);
  }
  const runTier = resolveSummaryRunTier(options.profile);
  const productionProofEnabled = asRecord(options.profile.production_proof).enabled === true;
  return options.fullJourney || runTier === "acceptance" || runTier === "production-proof" || productionProofEnabled
    ? "isolated"
    : "repo-local";
}

/**
 * @param {{ runId: string }} options
 */
function resolveDefaultIsolatedWorkspace(options) {
  return path.join(os.tmpdir(), "aor-live-e2e", normalizeId(options.runId));
}

/**
 * @param {{ mode: "isolated" | "repo-local" | "provided-binary", profile: Record<string, unknown> }} options
 */
function assertInstallModeAllowed(options) {
  if (options.mode !== "repo-local") return;
  const runTier = resolveSummaryRunTier(options.profile);
  const productionProofEnabled = asRecord(options.profile.production_proof).enabled === true;
  const internalTestHooks = asRecord(options.profile.internal_test_hooks);
  if (internalTestHooks.allow_repo_local_install_for_test === true) {
    return;
  }
  if (runTier === "acceptance" || runTier === "production-proof" || productionProofEnabled) {
    throw new UsageError(
      "Acceptance and production-proof live E2E runs require --aor-install-mode isolated unless an internal test hook explicitly allows repo-local install.",
    );
  }
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
  if (step === "delivery") return ["deliver-prepare", "delivery-harness-certify"];
  if (step === "release") return ["release-prepare"];
  if (step === "learning") return ["learning-handoff", "audit-runs"];
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
 * @param {Record<string, unknown>} command
 * @returns {Record<string, unknown> | null}
 */
function extractRequestedInteraction(command) {
  const continuation = asRecord(command.interactive_continuation);
  if (Object.keys(continuation).length === 0) return null;
  return continuation;
}

/**
 * @param {string} status
 * @returns {number}
 */
function observationSeverity(status) {
  const normalized = toObservationStatus(status);
  if (normalized === "blocked") return 5;
  if (normalized === "interaction_required") return 4;
  if (normalized === "not_pass") return 3;
  if (normalized === "warn") return 2;
  return 1;
}

/**
 * @param {Record<string, unknown>} stepEntry
 * @returns {string}
 */
function resolveStepDecisionAction(stepEntry) {
  const operatorDecisionStatus = asNonEmptyString(stepEntry.operator_decision_status);
  const declaredAction = asNonEmptyString(asRecord(stepEntry.decision).action);
  if (
    (operatorDecisionStatus === "accepted" || operatorDecisionStatus === "missing" || operatorDecisionStatus === "rejected") &&
    LIVE_E2E_OPERATOR_ACTIONS.includes(declaredAction)
  ) {
    return declaredAction;
  }
  if (stepEntry.requested_interaction) {
    const requestedInteraction = asRecord(stepEntry.requested_interaction);
    const interactionStatus =
      asNonEmptyString(requestedInteraction.interaction_status) || asNonEmptyString(requestedInteraction.status);
    if (interactionStatus === "resumed") {
      return asStringArray(requestedInteraction.answer_audit_refs).length > 0 ? "continue" : "block";
    }
    if (interactionStatus === "blocked" || interactionStatus === "resume_failed") return "block";
    return "answer";
  }
  const verdict = toObservationStatus(asNonEmptyString(stepEntry.final_step_verdict));
  if (verdict === "blocked") return "block";
  if (verdict === "interaction_required") return "answer";
  if (verdict === "not_pass") return "diagnose";
  if (verdict === "warn") return "continue";
  return "continue";
}

/**
 * @param {Record<string, unknown> | null} requestedInteraction
 * @param {string} deterministicFinalVerdict
 * @returns {"pass" | "warn" | "not_pass" | "blocked" | "interaction_required" | "resumed"}
 */
function resolveInteractiveFinalStepVerdict(requestedInteraction, deterministicFinalVerdict) {
  if (!requestedInteraction) return toObservationStatus(deterministicFinalVerdict);
  const interactionStatus =
    asNonEmptyString(requestedInteraction.interaction_status) || asNonEmptyString(requestedInteraction.status);
  if (interactionStatus === "resumed") {
    return asStringArray(requestedInteraction.answer_audit_refs).length > 0 ? "resumed" : "blocked";
  }
  if (interactionStatus === "blocked" || interactionStatus === "resume_failed") return "blocked";
  return "interaction_required";
}

/**
 * @param {Record<string, unknown>} artifacts
 * @param {Array<Record<string, unknown>>} stepJournal
 * @returns {Array<Record<string, unknown>>}
 */
function buildFrontendInteractions(artifacts, stepJournal = []) {
  const summaryFile = asNonEmptyString(artifacts.guided_web_smoke_summary_file);
  const htmlFile = asNonEmptyString(artifacts.guided_web_smoke_html_file);
  const domSnapshotFile = asNonEmptyString(artifacts.guided_web_dom_snapshot_file);
  const accessibilitySummaryFile = asNonEmptyString(artifacts.guided_web_accessibility_summary_file);
  const visualGuardrailFile = asNonEmptyString(artifacts.guided_web_visual_guardrail_file);
  const screenshotRefs = asStringArray(artifacts.guided_web_screenshot_files);
  if (!summaryFile && !htmlFile && !domSnapshotFile && !visualGuardrailFile && screenshotRefs.length === 0) return [];
  const webSmoke = asRecord(artifacts.guided_web_smoke);
  const taskOutcome = asRecord(webSmoke.task_outcome);
  const status = toObservationStatus(asNonEmptyString(taskOutcome.status) || "pass");
  const learningVerdict = stepJournal.find(
    (entry) =>
      asNonEmptyString(asRecord(entry).step_id) === "learning" &&
      asNonEmptyString(asRecord(entry).operator_decision_status) === "accepted" &&
      asNonEmptyString(asRecord(asRecord(entry).semantic_analysis).judge_source) === "skill-agent",
  );
  const agentVerdictRef = asNonEmptyString(asRecord(learningVerdict).operator_decision_ref) || null;
  const interactionStatus = agentVerdictRef ? status : "blocked";
  return [
    {
      step_id: "learning",
      interaction_id: "guided-web-smoke",
      surface: "web",
      evidence_refs: uniqueStrings([
        summaryFile,
        htmlFile,
        domSnapshotFile,
        accessibilitySummaryFile,
        visualGuardrailFile,
        ...screenshotRefs,
      ]),
      html_ref: htmlFile || asNonEmptyString(webSmoke.html_ref) || null,
      screenshot_refs: screenshotRefs,
      dom_snapshot_ref: domSnapshotFile || asNonEmptyString(webSmoke.dom_snapshot_ref) || null,
      accessibility_summary_ref: accessibilitySummaryFile || asNonEmptyString(webSmoke.accessibility_summary_ref) || null,
      task_outcome: {
        status,
        checked_tasks: asStringArray(taskOutcome.checked_tasks),
        findings: asStringArray(taskOutcome.findings),
      },
      ux_findings: asStringArray(webSmoke.ux_findings),
      agent_verdict_ref: agentVerdictRef,
      status: interactionStatus,
      summary: "Guided frontend smoke interaction completed through the installed-user web surface.",
    },
  ];
}

/**
 * @param {Record<string, unknown>} artifacts
 * @returns {Array<Record<string, unknown>>}
 */
function buildSetupJournal(artifacts) {
  const installation = asRecord(artifacts.aor_installation);
  const installationProofFile = asNonEmptyString(artifacts.aor_installation_proof_file);
  const installationStatus = toObservationStatus(asNonEmptyString(installation.status) || (installationProofFile ? "pass" : "not_pass"));
  const setupEntries = [
    {
      sequence: 1,
      step_id: "install",
      status: installationStatus,
      public_surface: asNonEmptyString(installation.source_channel) || "aor installation proof",
      evidence_refs: uniqueStrings([installationProofFile, ...asStringArray(installation.command_transcripts)]),
      summary: installationStatus === "pass"
        ? "AOR installation proof completed before public project flow execution."
        : installationProofFile
          ? "AOR installation proof failed before public project flow execution."
          : "AOR installation proof is missing.",
    },
    {
      sequence: 2,
      step_id: "target_checkout",
      status: asNonEmptyString(artifacts.target_checkout_root) ? "pass" : "not_pass",
      public_surface: "git clone or local target checkout materialization",
      evidence_refs: uniqueStrings([asNonEmptyString(artifacts.target_checkout_root), asNonEmptyString(artifacts.target_repo_ref)]),
      summary: asNonEmptyString(artifacts.target_checkout_root)
        ? "Target checkout was prepared for black-box execution."
        : "Target checkout evidence is missing.",
    },
    {
      sequence: 3,
      step_id: "project_bootstrap",
      status: asNonEmptyString(artifacts.generated_project_profile_file) ? "pass" : "not_pass",
      public_surface: "aor project init or bundled profile materialization",
      evidence_refs: uniqueStrings([
        asNonEmptyString(artifacts.generated_project_profile_file),
        asNonEmptyString(artifacts.bootstrap_artifact_packet_file),
        asNonEmptyString(artifacts.onboarding_report_file),
      ]),
      summary: asNonEmptyString(artifacts.generated_project_profile_file)
        ? "AOR project bootstrap evidence was materialized."
        : "AOR project bootstrap evidence is missing.",
    },
    {
      sequence: 4,
      step_id: "intake",
      status:
        asNonEmptyString(artifacts.intake_artifact_packet_file) || asNonEmptyString(artifacts.feature_request_file)
          ? "pass"
          : "warn",
      public_surface: "aor intake create or aor mission create",
      evidence_refs: uniqueStrings([
        asNonEmptyString(artifacts.feature_request_file),
        asNonEmptyString(artifacts.intake_artifact_packet_file),
        asNonEmptyString(artifacts.intake_artifact_packet_body_file),
      ]),
      summary:
        asNonEmptyString(artifacts.intake_artifact_packet_file) || asNonEmptyString(artifacts.feature_request_file)
          ? "Feature request or intake evidence was materialized."
          : "Bounded rehearsal did not use a catalog intake packet.",
    },
    {
      sequence: 5,
      step_id: "readiness",
      status:
        asNonEmptyString(artifacts.validation_report_file) ||
        asNonEmptyString(artifacts.baseline_verify_summary_file) ||
        asNonEmptyString(artifacts.verify_summary_file)
          ? "pass"
          : "not_pass",
      public_surface: "aor project validate and readiness verify",
      evidence_refs: uniqueStrings([
        asNonEmptyString(artifacts.validation_report_file),
        asNonEmptyString(artifacts.baseline_verify_summary_file),
        asNonEmptyString(artifacts.verify_summary_file),
        asNonEmptyString(artifacts.execution_readiness_file),
        asNonEmptyString(artifacts.live_adapter_preflight_file),
      ]),
      summary:
        asNonEmptyString(artifacts.validation_report_file) ||
        asNonEmptyString(artifacts.baseline_verify_summary_file) ||
        asNonEmptyString(artifacts.verify_summary_file)
          ? "Readiness validation evidence was materialized."
          : "Readiness validation evidence is missing.",
    },
  ];

  return setupEntries;
}

function buildStepJournal(options) {
  const controllerEntries = Array.isArray(options.flowResult.artifacts.live_e2e_step_journal_entries)
    ? options.flowResult.artifacts.live_e2e_step_journal_entries.map((entry) => asRecord(entry))
    : [];
  const frontendInteractions = buildFrontendInteractions(options.flowResult.artifacts);

  return controllerEntries.map((rawEntry, index) => {
    const step = asNonEmptyString(rawEntry.step_id) || asNonEmptyString(rawEntry.flow_stage) || `step-${index + 1}`;
    const stage = options.flowResult.stageResults.find((entry) => asNonEmptyString(entry.stage) === step) ?? {};
    const command = findCommandByPreferredLabel(options.flowResult.commandResults, getObservationCommandLabelPriority(step));
    const artifactRefs = uniqueStrings([...asStringArray(rawEntry.artifact_refs), ...asStringArray(stage.evidence_refs)]);
    const rawDecision = asRecord(rawEntry.decision);
    const rawOperatorAction = asNonEmptyString(rawDecision.action);
    const rawOperatorDecisionStatus = asNonEmptyString(rawEntry.operator_decision_status);
    const shouldPreserveOperatorAction =
      ["accepted", "missing", "rejected"].includes(rawOperatorDecisionStatus) &&
      LIVE_E2E_OPERATOR_ACTIONS.includes(rawOperatorAction);
    const deterministicAnalysis = asRecord(rawEntry.deterministic_analysis);
    const deterministicStatus = toObservationStatus(asNonEmptyString(deterministicAnalysis.status) || "not_pass");
    const rawSemanticAnalysis = asRecord(rawEntry.semantic_analysis);
    const semanticStatus = toObservationStatus(asNonEmptyString(rawSemanticAnalysis.status) || deterministicStatus);
    const semanticFindings = uniqueStrings(
      asStringArray(rawSemanticAnalysis.findings).filter(
        (finding) =>
          !(
            rawOperatorDecisionStatus === "accepted" &&
            semanticStatus === "pass" &&
            finding === OPERATOR_DECISION_REQUIRED_FINDING
          ),
      ),
    );
    const finalStepVerdict =
      observationSeverity(semanticStatus) > observationSeverity(deterministicStatus) ? semanticStatus : deterministicStatus;
    const requestedInteraction = asRecord(rawEntry.requested_interaction);
    const baseRequestedInteraction = Object.keys(requestedInteraction).length > 0
      ? requestedInteraction
      : command
        ? extractRequestedInteraction(command)
        : null;
    const normalizedRequestedInteraction = baseRequestedInteraction
      ? {
          ...baseRequestedInteraction,
          answer_audit_refs: uniqueStrings([
            ...asStringArray(baseRequestedInteraction.answer_audit_refs),
            ...asStringArray(asRecord(rawEntry.resume_result).evidence_refs),
          ]),
        }
      : null;
    const missingResumeAudit =
      normalizedRequestedInteraction &&
      (asNonEmptyString(normalizedRequestedInteraction.interaction_status) ||
        asNonEmptyString(normalizedRequestedInteraction.status)) === "resumed" &&
      asStringArray(normalizedRequestedInteraction.answer_audit_refs).length === 0;
    const frontendInteractionRefs =
      step === "learning"
        ? uniqueStrings([
            ...asStringArray(rawEntry.frontend_interaction_refs),
            ...frontendInteractions.flatMap((entry) => asStringArray(entry.evidence_refs)),
          ])
        : asStringArray(rawEntry.frontend_interaction_refs);
    const entry = {
      ...rawEntry,
      sequence: typeof rawEntry.sequence === "number" ? rawEntry.sequence : index + 1,
      step_id: step,
      flow_stage: step,
      plan:
        Object.keys(asRecord(rawEntry.plan)).length > 0
          ? asRecord(rawEntry.plan)
          : buildLiveE2eStepPlan(step, command),
      public_surface: asNonEmptyString(rawEntry.public_surface) || asNonEmptyString(command?.command_surface) || null,
      transcript_ref: asNonEmptyString(rawEntry.transcript_ref) || asNonEmptyString(command?.transcript_file) || null,
      artifact_refs: artifactRefs,
      started_at: asNonEmptyString(rawEntry.started_at) || asNonEmptyString(stage.started_at) || asNonEmptyString(command?.started_at) || null,
      finished_at:
        asNonEmptyString(rawEntry.finished_at) || asNonEmptyString(stage.finished_at) || asNonEmptyString(command?.finished_at) || null,
      duration_sec:
        typeof rawEntry.duration_sec === "number"
          ? rawEntry.duration_sec
          : typeof stage.duration_sec === "number"
          ? stage.duration_sec
          : typeof command?.duration_sec === "number"
            ? command.duration_sec
            : null,
      deterministic_analysis: {
        status: deterministicStatus,
        exit_code:
          typeof deterministicAnalysis.exit_code === "number"
            ? deterministicAnalysis.exit_code
            : typeof command?.exit_code === "number"
              ? command.exit_code
              : null,
        failure_class:
          asNonEmptyString(deterministicAnalysis.failure_class) ||
          asNonEmptyString(stage.failure_class) ||
          asNonEmptyString(command?.failure_class) ||
          null,
        missing_evidence: uniqueStrings([
          ...asStringArray(deterministicAnalysis.missing_evidence),
          ...asStringArray(stage.missing_evidence),
          ...asStringArray(command?.missing_evidence),
        ]),
        recommendation:
          asNonEmptyString(deterministicAnalysis.recommendation) ||
          asNonEmptyString(stage.recommendation) ||
          asNonEmptyString(command?.recommendation) ||
          "continue",
      },
      semantic_analysis: {
        status: semanticStatus,
        judge_source: asNonEmptyString(rawSemanticAnalysis.judge_source) || "deterministic-runner",
        findings: uniqueStrings([
          ...semanticFindings,
          ...(semanticStatus === "pass" ? [] : [asNonEmptyString(stage.summary) || `${step} did not complete cleanly`]),
        ]),
      },
      requested_interaction: normalizedRequestedInteraction,
      decision: {
        ...rawDecision,
        action: shouldPreserveOperatorAction
          ? rawOperatorAction
          : normalizedRequestedInteraction
            ? "answer"
            : finalStepVerdict === "not_pass"
              ? "diagnose"
              : "continue",
        reason:
          missingResumeAudit
            ? "Interaction resume is missing answer audit evidence."
            : normalizedRequestedInteraction
            ? "Public step requested operator or agent input through the control plane."
            : finalStepVerdict === "pass"
              ? "Public step completed with required evidence."
              : asNonEmptyString(asRecord(rawEntry.decision).reason) || asNonEmptyString(stage.summary) || `${step} completed with observed findings.`,
        next_step: asNonEmptyString(asRecord(rawEntry.decision).next_step) || asNonEmptyString(controllerEntries[index + 1]?.step_id) || null,
      },
      resume_result: normalizedRequestedInteraction
        ? {
            status:
              asNonEmptyString(asRecord(rawEntry.resume_result).status) ||
              asNonEmptyString(normalizedRequestedInteraction.interaction_status) ||
              "interaction_required",
            evidence_refs: uniqueStrings([
              ...asStringArray(asRecord(rawEntry.resume_result).evidence_refs),
              ...asStringArray(normalizedRequestedInteraction.answer_audit_refs),
            ]),
          }
        : null,
      frontend_interaction_refs: frontendInteractionRefs,
      final_step_verdict: resolveInteractiveFinalStepVerdict(normalizedRequestedInteraction, finalStepVerdict),
    };
    entry.decision.action = resolveStepDecisionAction(entry);
    return entry;
  });
}

/**
 * @param {{ stepJournal: Array<Record<string, unknown>>, stageResults: Array<Record<string, unknown>>, artifacts: Record<string, unknown> }}
 */
function buildFinalAnalysis(options) {
  const codeQuality = buildCodeQualityObservation(options.artifacts);
  const qualityRelevantStepJournal = getQualityRelevantStepJournal(options.stepJournal);
  const qualityRelevantStageIds = new Set(qualityRelevantStepJournal.map((entry) => asNonEmptyString(entry.step_id)).filter(Boolean));
  const failingStages = options.stageResults
    .filter((entry) => {
      const stage = asNonEmptyString(entry.stage);
      return (
        asNonEmptyString(entry.status) === "fail" &&
        (qualityRelevantStageIds.has(stage) || ["bootstrap", "install", ...LIVE_E2E_OBSERVATION_PRELUDE_STEPS].includes(stage))
      );
    })
    .map((entry) => ({
      stage: asNonEmptyString(entry.stage) || "unknown",
      summary: asNonEmptyString(entry.summary) || "Stage failed.",
      evidence_refs: asStringArray(entry.evidence_refs),
    }));
  const deliveryStatus = asNonEmptyString(options.artifacts.delivery_manifest_file)
    ? options.artifacts.delivery_blocking === true ||
      ["fail", "not_pass"].includes(asNonEmptyString(options.artifacts.delivery_quality_gate_status))
      ? "not_pass"
      : "pass"
    : "not_pass";
  const releaseStatus =
    asNonEmptyString(options.artifacts.release_status) === "pass"
      ? "pass"
      : asNonEmptyString(options.artifacts.release_status) === "skipped"
        ? "warn"
        : "not_pass";
  const learningStatus =
    asNonEmptyString(options.artifacts.learning_loop_scorecard_file) && asNonEmptyString(options.artifacts.learning_loop_handoff_file)
      ? "pass"
      : "not_pass";
  let status = codeQuality.status;
  for (const step of qualityRelevantStepJournal) {
    status = worstObservationStatus(status, asNonEmptyString(step.final_step_verdict) || "not_pass");
  }
  if (failingStages.length > 0) {
    status = worstObservationStatus(status, "not_pass");
  }
  const findings = uniqueStrings([
    ...asStringArray(codeQuality.findings),
    ...qualityRelevantStepJournal.flatMap((entry) => asStringArray(asRecord(entry.semantic_analysis).findings)),
    ...failingStages.map((entry) => `Stage '${entry.stage}' failed: ${entry.summary}`),
  ]);
  return {
    status,
    summary:
      status === "pass"
        ? "Live E2E step journal passed."
        : status === "warn"
          ? "Live E2E step journal completed with findings."
          : "Live E2E step journal did not pass.",
    findings,
    code_quality: {
      status: codeQuality.status,
      changed_paths: asStringArray(codeQuality.changed_paths),
      evidence_refs: uniqueStrings([
        asNonEmptyString(codeQuality.review_report_ref),
        ...asStringArray(codeQuality.post_delivery_check_refs),
      ]),
      findings: asStringArray(codeQuality.findings),
    },
    failed_stages: failingStages,
    delivery: {
      status: deliveryStatus,
      evidence_refs: uniqueStrings([asNonEmptyString(options.artifacts.delivery_manifest_file)]),
    },
    release: {
      status: releaseStatus,
      evidence_refs: uniqueStrings([asNonEmptyString(options.artifacts.release_packet_file)]),
    },
    learning: {
      status: learningStatus,
      evidence_refs: uniqueStrings([
        asNonEmptyString(options.artifacts.learning_loop_scorecard_file),
        asNonEmptyString(options.artifacts.learning_loop_handoff_file),
      ]),
    },
  };
}

/**
 * @param {Array<Record<string, unknown>>} stepJournal
 */
function buildInteractiveDecisions(stepJournal) {
  return stepJournal
    .filter((entry) => asNonEmptyString(asRecord(entry.decision).action) !== "continue")
    .map((entry) => {
      return {
        step_id: asNonEmptyString(entry.step_id),
        decision: asNonEmptyString(asRecord(entry.decision).action),
        reason: asNonEmptyString(asRecord(entry.decision).reason),
        answer_audit_refs: asStringArray(asRecord(entry.resume_result).evidence_refs),
        resume_result: entry.resume_result ?? null,
        next_step: asNonEmptyString(asRecord(entry.decision).next_step) || null,
      };
    });
}

function buildObservationReport(options) {
  const flowRangePolicy = resolveFlowRangePolicy(options.profile);
  const includedSteps = getIncludedStepsForProfile(options.profile);
  const excludedSteps =
    flowRangePolicy === "full_lifecycle"
      ? ["release", "learning"].filter((step) => !includedSteps.includes(step))
      : ["release", "learning"];
  const setupJournal = buildSetupJournal(options.flowResult.artifacts);
  const operatorContext = resolveLiveE2eOperatorContext(options.profile);
  const controllerStop = asRecord(options.flowResult.artifacts.live_e2e_controller_stop);
  const reportStatus = isLiveE2eControllerStopInProgress(controllerStop, includedSteps) ? "in_progress" : "final";
  const stepJournal = buildStepJournal({
    profile: options.profile,
    flowResult: options.flowResult,
  });
  const finalAnalysis = buildFinalAnalysis({
    stepJournal,
    stageResults: options.flowResult.stageResults,
    artifacts: options.flowResult.artifacts,
  });
  return {
    report_id: `${options.runId}.live-e2e-observation.v2`,
    run_id: options.runId,
    report_status: reportStatus,
    profile_id: asNonEmptyString(options.profile.profile_id) || "unknown-profile",
    operator_context: operatorContext,
    controller_state_ref: asNonEmptyString(options.flowResult.artifacts.live_e2e_controller_state_file),
    flow_range: {
      start_step: includedSteps[0],
      end_step: includedSteps[includedSteps.length - 1],
      included_steps: includedSteps,
      prelude_steps: [...LIVE_E2E_OBSERVATION_PRELUDE_STEPS],
      excluded_steps: excludedSteps,
    },
    flow_range_policy: flowRangePolicy,
    overall_status: asNonEmptyString(finalAnalysis.status) || "not_pass",
    aor_installation: asRecord(options.flowResult.artifacts.aor_installation),
    aor_installation_proof_file: asNonEmptyString(options.flowResult.artifacts.aor_installation_proof_file),
    setup_journal: setupJournal,
    step_journal: stepJournal,
    final_analysis: finalAnalysis,
    interactive_decisions: buildInteractiveDecisions(stepJournal),
    frontend_interactions: buildFrontendInteractions(options.flowResult.artifacts, stepJournal),
    evidence_refs: uniqueStrings([
      options.summaryFile,
      asNonEmptyString(options.flowResult.artifacts.live_e2e_controller_state_file),
      asNonEmptyString(options.flowResult.artifacts.aor_installation_proof_file),
      asNonEmptyString(options.flowResult.artifacts.delivery_manifest_file),
      asNonEmptyString(options.flowResult.artifacts.release_packet_file),
      asNonEmptyString(options.flowResult.artifacts.learning_loop_scorecard_file),
      asNonEmptyString(options.flowResult.artifacts.learning_loop_handoff_file),
      asNonEmptyString(options.flowResult.artifacts.review_report_file),
      asNonEmptyString(options.flowResult.artifacts.runtime_harness_report_file),
      asNonEmptyString(options.flowResult.artifacts.evaluation_report_file),
    ]),
  };
}

/**
 * @param {{
 *   runId: string,
 *   reportsRoot: string,
 *   sourceRoot?: string,
 *   targetCheckoutRoot?: string,
 *   observationReport: Record<string, unknown>,
 *   canonicalStatus?: Record<string, unknown>,
 *   runnerQualitySummary?: Record<string, unknown>,
 *   qualityJudgement?: Record<string, unknown>,
 *   flowResult?: Record<string, unknown>,
 * }}
 */
function resolveFinalSkillAgentVerdict(options) {
  const flowResult = asRecord(options.flowResult);
  const artifacts = asRecord(flowResult.artifacts);
  const canonicalStatus = asRecord(options.canonicalStatus);
  const runnerQualitySummary = asRecord(options.runnerQualitySummary);
  const qualityJudgement = asRecord(options.qualityJudgement);
  const stepJournal = Array.isArray(options.observationReport.step_journal)
    ? options.observationReport.step_journal.map((entry) => asRecord(entry))
    : [];
  const includedSteps = asStringArray(asRecord(options.observationReport.flow_range).included_steps);
  const acceptedSkillAgentSteps = stepJournal.filter(
    (entry) =>
      asNonEmptyString(entry.operator_decision_status) === "accepted" &&
      asNonEmptyString(asRecord(entry.semantic_analysis).judge_source) === "skill-agent",
  );
  const acceptedStepIds = new Set(acceptedSkillAgentSteps.map((entry) => asNonEmptyString(entry.step_id)).filter(Boolean));
  const missingSteps = includedSteps.filter((step) => !acceptedStepIds.has(step));
  const finalAnalysis = asRecord(options.observationReport.final_analysis);
  const finalAnalysisStatus = toObservationStatus(asNonEmptyString(finalAnalysis.status) || "not_pass");
  const frontendInteractions = Array.isArray(options.observationReport.frontend_interactions)
    ? options.observationReport.frontend_interactions.map((entry) => asRecord(entry))
    : [];
  const missingFrontendVerdicts = frontendInteractions
    .filter((entry) => {
      const status = toObservationStatus(asNonEmptyString(entry.status) || "not_pass");
      return status === "pass" && !asNonEmptyString(entry.agent_verdict_ref);
    })
    .map((entry) => asNonEmptyString(entry.interaction_id) || asNonEmptyString(entry.step_id) || "frontend-interaction");
  const failedFrontendInteractions = frontendInteractions
    .filter((entry) => !["pass", "warn"].includes(toObservationStatus(asNonEmptyString(entry.status) || "not_pass")))
    .map((entry) => asNonEmptyString(entry.interaction_id) || asNonEmptyString(entry.step_id) || "frontend-interaction");
  const expectedVerdictFile = path.join(
    options.reportsRoot,
    `live-e2e-final-skill-agent-verdict-${normalizeId(options.runId)}.json`,
  );
  const requestFile = path.join(
    options.reportsRoot,
    `live-e2e-final-skill-agent-verdict-request-${normalizeId(options.runId)}.json`,
  );
  const requiredEvidenceRefs = uniqueStrings([
    asNonEmptyString(options.observationReport.controller_state_ref),
    ...asStringArray(options.observationReport.evidence_refs),
    ...stepJournal.flatMap((entry) => [
      asNonEmptyString(entry.observation_ref),
      asNonEmptyString(entry.operator_decision_ref),
      ...asStringArray(entry.artifact_refs),
    ]),
    ...frontendInteractions.flatMap((entry) => asStringArray(entry.evidence_refs)),
  ]);
  const lifecycleCompleteness = buildLifecycleCompletenessSummary(options.observationReport);
  const lifecyclePendingSteps = asStringArray(lifecycleCompleteness.pending_steps);
  const lifecycleCompletenessStatus =
    lifecyclePendingSteps.length === 0 && missingSteps.length === 0
      ? "pass"
      : "blocked";
  const operatorDecisionStatus = missingSteps.length === 0 && acceptedSkillAgentSteps.length >= includedSteps.length
    ? "accepted"
    : "blocked";
  const providerExecutionStatus =
    asNonEmptyString(artifacts.provider_execution_status) ||
    asNonEmptyString(qualityJudgement.provider_execution_status) ||
    "not_attempted";
  const deliveryStatus =
    asNonEmptyString(canonicalStatus.delivery_status) ||
    asNonEmptyString(artifacts.delivery_status) ||
    "not_materialized";
  const releaseStatus =
    asNonEmptyString(canonicalStatus.release_status) || asNonEmptyString(artifacts.release_status) || "not_attempted";
  const artifactQualityStatus =
    asNonEmptyString(canonicalStatus.artifact_quality_status) ||
    asNonEmptyString(artifacts.artifact_quality_status) ||
    "not_attempted";
  const baselineVerifyStatus =
    asNonEmptyString(artifacts.baseline_verify_status) ||
    asNonEmptyString(qualityJudgement.target_baseline_status) ||
    "not_attempted";
  const postRunVerificationStatus =
    asNonEmptyString(artifacts.post_run_verify_status) ||
    asNonEmptyString(qualityJudgement.post_run_verification_status) ||
    "not_attempted";
  const postRunDiagnosticStatus =
    asNonEmptyString(artifacts.post_run_diagnostic_status) ||
    asNonEmptyString(qualityJudgement.post_run_diagnostic_status) ||
    "not_attempted";
  const realCodeChangeStatus =
    asNonEmptyString(artifacts.real_code_change_status) ||
    asNonEmptyString(qualityJudgement.real_code_change_status) ||
    "not_attempted";
  const deterministicRequestStatus =
    asNonEmptyString(canonicalStatus.acceptance_status) === "pass" &&
    lifecycleCompletenessStatus === "pass" &&
    operatorDecisionStatus === "accepted"
      ? "pass"
      : finalAnalysisStatus;
  const request = {
    request_id: `${options.runId}.final-skill-agent-verdict-request.v1`,
    run_id: options.runId,
    expected_verdict_file: expectedVerdictFile,
    final_skill_agent_verdict_expected_ref: expectedVerdictFile,
    required_judge_source: "skill-agent",
    current_deterministic_status: finalAnalysisStatus,
    deterministic_analysis: {
      status: deterministicRequestStatus,
      final_analysis_status: finalAnalysisStatus,
      self_pending_final_verdict: !fileExists(expectedVerdictFile),
    },
    required_steps: includedSteps,
    accepted_step_count: acceptedSkillAgentSteps.length,
    missing_skill_agent_steps: missingSteps,
    missing_frontend_agent_verdicts: missingFrontendVerdicts,
    failed_frontend_interactions: failedFrontendInteractions,
    lifecycle_completeness: lifecycleCompleteness,
    completion_summary: {
      lifecycle_completeness_status: lifecycleCompletenessStatus,
      operator_decision_status: operatorDecisionStatus,
      provider_execution_status: providerExecutionStatus,
      delivery_status: deliveryStatus,
      release_status: releaseStatus,
      artifact_quality_status: artifactQualityStatus,
      baseline_verify_status: baselineVerifyStatus,
      post_run_verification_status: postRunVerificationStatus,
      post_run_diagnostic_status: postRunDiagnosticStatus,
      real_code_change_status: realCodeChangeStatus,
      final_verdict_status: fileExists(expectedVerdictFile) ? "present" : "missing",
    },
    canonical_status: Object.keys(canonicalStatus).length > 0 ? canonicalStatus : {},
    runner_quality_summary: Object.keys(runnerQualitySummary).length > 0 ? runnerQualitySummary : {},
    quality_judgement: Object.keys(qualityJudgement).length > 0 ? qualityJudgement : {},
    stage_results: Array.isArray(flowResult.stageResults) ? flowResult.stageResults : [],
    adapter_raw_evidence_ref: asNonEmptyString(artifacts.adapter_raw_evidence_ref) || "not_attempted",
    current_artifact_status: {
      final_analysis_status: finalAnalysisStatus,
      frontend_interaction_count: frontendInteractions.length,
      accepted_step_count: acceptedSkillAgentSteps.length,
      missing_step_count: missingSteps.length,
      evidence_ref_count: requiredEvidenceRefs.length,
      provider_execution_status: providerExecutionStatus,
      delivery_status: deliveryStatus,
      release_status: releaseStatus,
      artifact_quality_status: artifactQualityStatus,
      baseline_verify_status: baselineVerifyStatus,
      post_run_verification_status: postRunVerificationStatus,
      post_run_diagnostic_status: postRunDiagnosticStatus,
      real_code_change_status: realCodeChangeStatus,
    },
    required_inspection: [
      "review the full observation report and step observations",
      "verify every included step has an accepted skill-agent decision",
      "verify deterministic classifications and command transcripts",
      "verify target diff, no-upstream-write evidence, and delivery artifacts",
      "verify UI/UX evidence for frontend-capable profiles",
      "emit a final verdict only from skill-agent judgement",
    ],
    required_evidence_refs: requiredEvidenceRefs,
    expected_response_shape: {
      verdict_id: `${options.runId}.final-skill-agent-verdict.v1`,
      run_id: options.runId,
      status: "pass|warn|not_pass|blocked",
      judge_source: "skill-agent",
      inspected_evidence_refs: requiredEvidenceRefs.slice(0, 8),
      findings: [],
      final_recommendation: "accept|accept_with_findings|reject",
      created_at: nowIso(),
    },
    created_at: nowIso(),
  };
  writeJson(requestFile, request);
  if (!fileExists(expectedVerdictFile)) {
    return {
      verdictFile: expectedVerdictFile,
      verdict: null,
      requestFile,
      missingFindings: [
        `Final skill-agent verdict is missing; write an accepted skill-agent verdict to ${expectedVerdictFile}.`,
      ],
    };
  }
  const verdict = asRecord(readJson(expectedVerdictFile));
  const inspectedRefs = asStringArray(verdict.inspected_evidence_refs);
  const evidenceRefs = uniqueStrings([...asStringArray(verdict.evidence_refs), ...inspectedRefs]);
  const invalidReasons = [];
  if (asNonEmptyString(verdict.judge_source) !== "skill-agent") {
    invalidReasons.push("final verdict judge_source must be skill-agent.");
  }
  if (inspectedRefs.length === 0) {
    invalidReasons.push("final verdict must include non-empty inspected_evidence_refs.");
  }
  if (evidenceRefs.length === 0) {
    invalidReasons.push("final verdict must reference inspected evidence.");
  }
  const missingMaterializedRefs = inspectedRefs.filter(
    (ref) =>
      !localEvidenceRefExists(ref, {
        reportsRoot: options.reportsRoot,
        sourceRoot: options.sourceRoot,
        targetCheckoutRoot: options.targetCheckoutRoot,
      }),
  );
  if (missingMaterializedRefs.length > 0) {
    invalidReasons.push(`final verdict cites missing local evidence refs: ${missingMaterializedRefs.join(", ")}.`);
  }
  return {
    verdictFile: expectedVerdictFile,
    verdict,
    requestFile,
    missingFindings: invalidReasons,
  };
}

/**
 * @param {Record<string, unknown>} profile
 * @returns {string}
 */
function resolveSummaryRunTier(profile) {
  const declared = asNonEmptyString(profile.run_tier);
  if (declared) return declared;
  if (asRecord(profile.production_proof).enabled === true) return "production-proof";
  if (asNonEmptyString(profile.journey_mode) === "full-journey" || asNonEmptyString(profile.target_catalog_id)) {
    return "acceptance";
  }
  return "bounded-live";
}

/**
 * @param {Record<string, unknown>} diagnostic
 * @returns {boolean}
 */
function commandCompletedForCanonicalStatus(diagnostic) {
  return asNonEmptyString(diagnostic.status) === "pass" || diagnostic.accepted_nonzero_payload === true;
}

/**
 * @param {{
 *   profile: Record<string, unknown>,
 *   flowResult: {
 *     status: string,
 *     commandResults: Array<Record<string, unknown>>,
 *     artifacts: Record<string, unknown>,
 *   },
 *   observationStatus: string,
 * }}
 */
function resolveSummaryCanonicalStatus(options) {
  const existing = asRecord(options.flowResult.artifacts.canonical_status);
  if (Object.keys(existing).length > 0) return existing;
  const qualityJudgement = asRecord(options.flowResult.artifacts.quality_judgement);
  const commandStatus =
    options.flowResult.commandResults.length > 0 &&
    options.flowResult.commandResults.every((entry) => commandCompletedForCanonicalStatus(entry))
      ? "pass"
      : "fail";
  const deliveryStatus = asNonEmptyString(options.flowResult.artifacts.delivery_manifest_file)
    ? options.flowResult.artifacts.delivery_blocking === true
      ? "blocked"
      : asNonEmptyString(options.flowResult.artifacts.delivery_quality_gate_status) === "not_pass"
        ? "degraded"
      : "materialized"
    : "not_materialized";
  const releaseRequired =
    asNonEmptyString(options.profile.scenario_family) === "release" && asStringArray(options.profile.stages).includes("release");
  const releaseStatus = releaseRequired
    ? asNonEmptyString(options.flowResult.artifacts.release_status) || "fail"
    : asNonEmptyString(options.flowResult.artifacts.release_status) || "not_attempted";
  const releaseMissing = releaseRequired && releaseStatus !== "pass";
  const allStageResultsPass =
    options.flowResult.stageResults.length > 0 &&
    options.flowResult.stageResults.every((entry) => asNonEmptyString(entry.status) === "pass");
  const blockedOnlyByFinalVerdict = options.observationStatus === "blocked" && allStageResultsPass;
  const effectiveObservationStatus = blockedOnlyByFinalVerdict ? "pass" : options.observationStatus;
  const acceptanceStatus =
    releaseMissing
      ? "fail"
      : deliveryStatus === "degraded" || deliveryStatus === "blocked"
        ? "fail"
      : effectiveObservationStatus === "pass"
      ? "pass"
      : effectiveObservationStatus === "warn" && deliveryStatus !== "not_materialized"
        ? "warn"
        : "fail";
  const runTier = resolveSummaryRunTier(options.profile);
  const proofEligibleTier = runTier === "acceptance" || runTier === "production-proof";
  const hasMatrixCell = Object.keys(asRecord(options.flowResult.artifacts.matrix_cell)).length > 0;
  const coverageStatus = !hasMatrixCell
    ? "not_attempted"
    : acceptanceStatus === "pass" && proofEligibleTier
      ? "covered_pass"
    : acceptanceStatus === "warn" && deliveryStatus !== "not_materialized"
      ? "covered_with_findings"
      : "attempted_failed";
  const blockedContinuation = effectiveObservationStatus === "blocked";
  const findings = uniqueStrings([
    ...(releaseMissing ? ["Required release stage did not materialize strict release-packet evidence."] : []),
    ...(blockedContinuation ? ["Live E2E controller stopped before full lifecycle completion."] : []),
  ]);
  return {
    command_status: commandStatus,
    target_verification_status: asNonEmptyString(options.flowResult.artifacts.post_run_verify_status) || "not_attempted",
    artifact_quality_status:
      asNonEmptyString(qualityJudgement.artifact_quality) ||
      asNonEmptyString(options.flowResult.artifacts.artifact_quality_status) ||
      "not_attempted",
    delivery_status: deliveryStatus,
    coverage_status: coverageStatus,
    acceptance_status: acceptanceStatus,
    run_tier: runTier,
    release_status: releaseStatus,
    proof_eligible_tier: proofEligibleTier,
    required_matrix_acceptance_closed: coverageStatus === "covered_pass" && proofEligibleTier,
    findings,
    summary:
      blockedContinuation
        ? "Live E2E continuation is blocked and acceptance is incomplete."
        : acceptanceStatus === "pass"
        ? "Live E2E acceptance evidence passed."
        : acceptanceStatus === "warn"
          ? "Live E2E completed with findings; required matrix acceptance is not closed."
          : "Live E2E did not meet acceptance requirements.",
  };
}

/**
 * @param {Record<string, unknown>} observationReport
 * @returns {Record<string, unknown>}
 */
function buildLifecycleCompletenessSummary(observationReport) {
  const includedSteps = asStringArray(asRecord(observationReport.flow_range).included_steps);
  const stepJournal = Array.isArray(observationReport.step_journal)
    ? observationReport.step_journal.map((entry) => asRecord(entry))
    : [];
  const acceptedStepIds = new Set(
    stepJournal
      .filter((entry) => asNonEmptyString(entry.operator_decision_status) === "accepted")
      .map((entry) => asNonEmptyString(entry.step_id))
      .filter(Boolean),
  );
  const pendingSteps = includedSteps.filter((step) => !acceptedStepIds.has(step));
  const blockedEntry =
    stepJournal.find((entry) => ["missing", "rejected"].includes(asNonEmptyString(entry.operator_decision_status))) ??
    stepJournal.find((entry) =>
      ["blocked", "not_pass", "interaction_required"].includes(toObservationStatus(asNonEmptyString(entry.final_step_verdict))),
    ) ??
    null;
  return {
    included_steps: includedSteps,
    included_step_count: includedSteps.length,
    observed_step_count: stepJournal.length,
    accepted_step_count: acceptedStepIds.size,
    pending_steps: pendingSteps,
    missing_operator_decision_steps: stepJournal
      .filter((entry) => asNonEmptyString(entry.operator_decision_status) !== "accepted")
      .map((entry) => asNonEmptyString(entry.step_id))
      .filter(Boolean),
    blocked_step_id: blockedEntry ? asNonEmptyString(blockedEntry.step_id) : null,
    blocked_step_instance_id: blockedEntry ? asNonEmptyString(blockedEntry.step_instance_id) : null,
    continuation_status:
      pendingSteps.length === 0 && asNonEmptyString(observationReport.overall_status) !== "blocked" ? "complete" : "blocked",
  };
}

/**
 * @param {{
 *   canonicalStatus: Record<string, unknown>,
 *   observationReport: Record<string, unknown>,
 *   flowResult: { artifacts: Record<string, unknown> },
 *   finalSkillAgentVerdict: Record<string, unknown>,
 * }}
 * @returns {Record<string, unknown>}
 */
function buildPartialRunnerQualitySummary(options) {
  const artifacts = options.flowResult.artifacts;
  const completeness = buildLifecycleCompletenessSummary(options.observationReport);
  return {
    summary_type: "partial",
    completion_status: asNonEmptyString(completeness.continuation_status),
    mission_satisfaction: asNonEmptyString(options.canonicalStatus.acceptance_status) === "pass" ? "pass" : "not_pass",
    implementation_relevance: asNonEmptyString(artifacts.real_code_change_status) || "not_attempted",
    diff_quality: asNonEmptyString(artifacts.code_quality_status) || "not_attempted",
    verification_interpretation:
      asNonEmptyString(options.canonicalStatus.target_verification_status) ||
      asNonEmptyString(artifacts.post_run_verify_status) ||
      "not_attempted",
    artifact_consistency: asNonEmptyString(options.canonicalStatus.artifact_quality_status) || "not_attempted",
    provider_execution_status: asNonEmptyString(artifacts.provider_execution_status) || "not_attempted",
    delivery_status: asNonEmptyString(options.canonicalStatus.delivery_status) || "not_attempted",
    release_status: asNonEmptyString(options.canonicalStatus.release_status) || "not_attempted",
    lifecycle_completeness: completeness,
    risk_findings: uniqueStrings([
      ...asStringArray(options.canonicalStatus.findings),
      ...asStringArray(asRecord(options.observationReport.final_analysis).findings),
      ...asStringArray(options.finalSkillAgentVerdict.missingFindings),
    ]),
    final_recommendation: asNonEmptyString(options.canonicalStatus.acceptance_status) === "pass" ? "accept" : "reject",
  };
}

/**
 * @param {{
 *   profile: Record<string, unknown>,
 *   canonicalStatus: Record<string, unknown>,
 *   runnerQualitySummary: Record<string, unknown>,
 *   flowResult: { artifacts: Record<string, unknown> },
 *   observationReport: Record<string, unknown>,
 * }}
 * @returns {Record<string, unknown>}
 */
function buildPartialQualityJudgement(options) {
  const artifacts = options.flowResult.artifacts;
  const stepJournal = Array.isArray(options.observationReport.step_journal)
    ? options.observationReport.step_journal.map((entry) => asRecord(entry))
    : [];
  const discoveryAccepted = stepJournal.some(
    (entry) =>
      asNonEmptyString(entry.step_id) === "discovery" &&
      asNonEmptyString(entry.operator_decision_status) === "accepted" &&
      ["pass", "warn", "resumed"].includes(toObservationStatus(asNonEmptyString(asRecord(entry.semantic_analysis).status))),
  );
  const deliveryStatus = asNonEmptyString(options.canonicalStatus.delivery_status);
  const releaseStatus = asNonEmptyString(options.canonicalStatus.release_status);
  return {
    judgement_type: "partial",
    scenario_family: asNonEmptyString(options.profile.scenario_family) || null,
    provider_variant_id: asNonEmptyString(options.profile.provider_variant_id) || null,
    feature_size: artifacts.feature_size ?? null,
    target_selection: asNonEmptyString(artifacts.target_checkout_root) ? "pass" : "not_attempted",
    feature_request_quality:
      asNonEmptyString(artifacts.feature_request_file) || asNonEmptyString(artifacts.intake_artifact_packet_file)
        ? "pass"
        : "not_attempted",
    scenario_coverage_status: asNonEmptyString(options.canonicalStatus.coverage_status) || "not_attempted",
    provider_execution_status: asNonEmptyString(artifacts.provider_execution_status) || "not_attempted",
    target_baseline_status:
      asNonEmptyString(artifacts.baseline_verify_status) ||
      asNonEmptyString(artifacts.target_baseline_status) ||
      "not_attempted",
    real_code_change_status: asNonEmptyString(artifacts.real_code_change_status) || "not_attempted",
    runner_quality_summary: options.runnerQualitySummary,
    post_run_verification_status:
      asNonEmptyString(artifacts.post_run_verify_status) ||
      asNonEmptyString(options.canonicalStatus.target_verification_status) ||
      "not_attempted",
    post_run_diagnostic_status: asNonEmptyString(artifacts.post_run_diagnostic_status) || "not_attempted",
    discovery_quality: discoveryAccepted ? "pass" : "not_attempted",
    runtime_success:
      asNonEmptyString(artifacts.routed_step_result_file) &&
      asNonEmptyString(artifacts.runtime_harness_report_file) &&
      asNonEmptyString(artifacts.provider_execution_status) === "pass"
        ? "pass"
        : "not_attempted",
    runtime_harness_decision: asNonEmptyString(artifacts.runtime_harness_decision) || "not_attempted",
    run_start_runtime_harness_decision: asNonEmptyString(artifacts.run_start_runtime_harness_decision) || "not_attempted",
    latest_runtime_harness_decision: asNonEmptyString(artifacts.latest_runtime_harness_decision) || "not_attempted",
    artifact_quality: asNonEmptyString(options.canonicalStatus.artifact_quality_status) || "not_attempted",
    code_quality: asNonEmptyString(artifacts.code_quality_status) || "not_attempted",
    feature_size_fit_status: asNonEmptyString(artifacts.feature_size_fit_status) || "not_attempted",
    delivery_release_quality:
      deliveryStatus === "materialized" && (releaseStatus === "pass" || releaseStatus === "not_attempted")
        ? "pass"
        : "not_attempted",
    learning_loop_closure:
      asNonEmptyString(artifacts.learning_loop_scorecard_file) && asNonEmptyString(artifacts.learning_loop_handoff_file)
        ? "pass"
        : "not_attempted",
    quality_gate_decision: asNonEmptyString(artifacts.quality_gate_decision) || "not_attempted",
    overall_status: asNonEmptyString(options.canonicalStatus.acceptance_status) === "pass" ? "pass" : "fail",
    summary: asNonEmptyString(options.canonicalStatus.summary) || "Partial quality judgement generated for an incomplete run.",
  };
}

/**
 * @param {{ runId: string, reportsRoot: string, stepJournal: Array<Record<string, unknown>> }}
 */
function writeAgentArtifactReviewRequest(options) {
  const requestFile = path.join(
    options.reportsRoot,
    `live-e2e-agent-artifact-review-request-${normalizeId(options.runId)}.json`,
  );
  const missingDecisionSteps = options.stepJournal
    .filter((entry) => asNonEmptyString(entry.operator_decision_status) !== "accepted")
    .map((entry) => asNonEmptyString(entry.step_id))
    .filter(Boolean);
  const requiredArtifactRefs = uniqueStrings(options.stepJournal.flatMap((entry) => asStringArray(entry.artifact_refs)));
  const missingArtifactSteps = options.stepJournal
    .filter((entry) => asStringArray(entry.artifact_refs).length === 0)
    .map((entry) => asNonEmptyString(entry.step_id))
    .filter(Boolean);
  const request = {
    request_id: `${options.runId}.agent-artifact-review.v1`,
    run_id: options.runId,
    required_review: {
      step_count: options.stepJournal.length,
      accepted_operator_decision_count: options.stepJournal.length - missingDecisionSteps.length,
      missing_operator_decision_steps: missingDecisionSteps,
      artifact_ref_count: requiredArtifactRefs.length,
      missing_artifact_steps: missingArtifactSteps,
    },
    required_artifacts: requiredArtifactRefs,
    missing_artifacts: missingArtifactSteps,
    rubric: {
      statuses: ["pass", "warn", "not_pass", "blocked", "interaction_required", "resumed"],
      criteria: [
        "traceability to feature request, mission, and previous step",
        "completeness for the step",
        "actionability for the next step",
        "consistency with neighboring artifacts",
        "absence of synthetic or no-op explanations that hide failure",
      ],
    },
    expected_response_shape: {
      step_journal: [
        {
          step_id: "discovery",
          semantic_analysis: {
            status: "pass|warn|not_pass|blocked|interaction_required|resumed",
            judge_source: "skill-agent",
            findings: [],
          },
          judge_source: "skill-agent",
          artifact_refs: [],
          findings: [],
        },
      ],
    },
    steps: options.stepJournal.map((entry) => ({
      step_id: asNonEmptyString(entry.step_id),
      step_instance_id: asNonEmptyString(entry.step_instance_id),
      flow_stage: asNonEmptyString(entry.flow_stage),
      artifact_refs: asStringArray(entry.artifact_refs),
      operator_decision_status: asNonEmptyString(entry.operator_decision_status),
      inspected_evidence_refs_count: asStringArray(entry.inspected_evidence_refs).length,
      semantic_status: asNonEmptyString(asRecord(entry.semantic_analysis).status),
      semantic_judge_source: asNonEmptyString(asRecord(entry.semantic_analysis).judge_source),
      observed_status: asNonEmptyString(entry.final_step_verdict),
      findings: uniqueStrings([
        ...asStringArray(asRecord(entry.deterministic_analysis).findings),
        ...asStringArray(asRecord(entry.semantic_analysis).findings),
      ]),
    })),
  };
  writeJson(requestFile, request);
  return requestFile;
}

/**
 * @param {{ runId: string, reportsRoot: string, stepJournal: Array<Record<string, unknown>> }}
 */
function writeStepObservationFiles(options) {
  const refs = [];
  for (const entry of options.stepJournal) {
    const existingRef = asNonEmptyString(entry.observation_ref);
    if (existingRef && fileExists(existingRef)) {
      refs.push(existingRef);
      continue;
    }
    const sequence = String(entry.sequence).padStart(2, "0");
    const file = path.join(
      options.reportsRoot,
      `live-e2e-step-observation-${normalizeId(options.runId)}-${sequence}-${normalizeId(asNonEmptyString(entry.step_id) || "step")}.json`,
    );
    entry.observation_ref = file;
    writeJson(file, entry);
    refs.push(file);
  }
  return refs;
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
 * }}
 */
export function writeProofRunnerArtifacts(options) {
  const summaryFile = path.join(
    options.layout.reportsRoot,
    `live-e2e-run-summary-${normalizeId(options.runId)}.json`,
  );
  const scorecardFile = path.join(
    options.layout.reportsRoot,
    `live-e2e-scorecard-target-${normalizeId(options.runId)}.json`,
  );
  const productionProofPolicy = buildProductionProofSummary(options.profile);
  normalizePreVerdictQualityArtifacts(options.flowResult.artifacts, {
    reportsRoot: options.layout.reportsRoot,
    sourceRoot: options.hostRoot,
    targetCheckoutRoot: asNonEmptyString(options.flowResult.artifacts.target_checkout_root),
  });
  const observationReport = buildObservationReport({
    runId: options.runId,
    profilePath: options.profilePath,
    profile: options.profile,
    flowResult: options.flowResult,
    summaryFile,
  });
  const stepObservationFiles = writeStepObservationFiles({
    runId: options.runId,
    reportsRoot: options.layout.reportsRoot,
    stepJournal: observationReport.step_journal,
  });
  const observationReportFile = path.join(
    options.layout.reportsRoot,
    `live-e2e-observation-report-${normalizeId(options.runId)}.json`,
  );
  const finalSkillAgentVerdict = resolveFinalSkillAgentVerdict({
    runId: options.runId,
    reportsRoot: options.layout.reportsRoot,
    sourceRoot: options.hostRoot,
    targetCheckoutRoot: asNonEmptyString(options.flowResult.artifacts.target_checkout_root),
    observationReport,
  });
  observationReport.final_skill_agent_verdict_request_file = finalSkillAgentVerdict.requestFile;
  if (finalSkillAgentVerdict.verdict) {
    observationReport.final_skill_agent_verdict_file = finalSkillAgentVerdict.verdictFile;
    observationReport.final_skill_agent_verdict = finalSkillAgentVerdict.verdict;
  } else {
    observationReport.report_status = "in_progress";
  }
  observationReport.evidence_refs = uniqueStrings([
    ...asStringArray(observationReport.evidence_refs),
    ...stepObservationFiles,
    finalSkillAgentVerdict.requestFile,
    finalSkillAgentVerdict.verdict ? finalSkillAgentVerdict.verdictFile : null,
  ]);
  const finalVerdictStatus =
    asStringArray(finalSkillAgentVerdict.missingFindings).length > 0
      ? "blocked"
      : finalSkillAgentVerdict.verdict
        ? toObservationStatus(asNonEmptyString(finalSkillAgentVerdict.verdict.status))
        : "blocked";
  observationReport.overall_status = worstObservationStatus(observationReport.overall_status, finalVerdictStatus);
  observationReport.final_analysis = {
    ...asRecord(observationReport.final_analysis),
    status: worstObservationStatus(asNonEmptyString(asRecord(observationReport.final_analysis).status), finalVerdictStatus),
    findings: uniqueStrings([
      ...asStringArray(asRecord(observationReport.final_analysis).findings),
      ...asStringArray(asRecord(finalSkillAgentVerdict.verdict).findings),
      ...asStringArray(finalSkillAgentVerdict.missingFindings),
    ]),
  };
  const observationValidation = validateContractDocument({
    family: "live-e2e-observation-report",
    document: observationReport,
    source: `runtime://live-e2e-observation/${options.runId}`,
  });
  if (!observationValidation.ok) {
    const issues = observationValidation.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Live E2E observation report failed contract validation: ${issues}`);
  }
  const agentArtifactReviewRequestFile = writeAgentArtifactReviewRequest({
    runId: options.runId,
    reportsRoot: options.layout.reportsRoot,
    stepJournal: observationReport.step_journal,
  });
  options.flowResult.artifacts.live_e2e_observation_report_file = observationReportFile;
  options.flowResult.artifacts.live_e2e_step_observation_files = stepObservationFiles;
  options.flowResult.artifacts.final_skill_agent_verdict_request_file = finalSkillAgentVerdict.requestFile;
  options.flowResult.artifacts.final_skill_agent_verdict_file = finalSkillAgentVerdict.verdictFile;
  options.flowResult.artifacts.final_skill_agent_verdict = finalSkillAgentVerdict.verdict ?? null;
  options.flowResult.artifacts.agent_artifact_review_request_file = agentArtifactReviewRequestFile;
  options.flowResult.artifacts.live_e2e_observation_overall_status = observationReport.overall_status;
  const productionProof = applyProductionProofEvidence({
    productionProof: productionProofPolicy,
    flowResult: options.flowResult,
  });
  if (productionProof) {
    options.flowResult.artifacts.production_proof = productionProof;
  }
  const canonicalStatus = resolveSummaryCanonicalStatus({
    profile: options.profile,
    flowResult: options.flowResult,
    observationStatus: observationReport.overall_status,
  });
  options.flowResult.artifacts.canonical_status = canonicalStatus;
  options.flowResult.artifacts.command_status = canonicalStatus.command_status;
  options.flowResult.artifacts.target_verification_status = canonicalStatus.target_verification_status;
  options.flowResult.artifacts.artifact_quality_status = canonicalStatus.artifact_quality_status;
  options.flowResult.artifacts.delivery_status = canonicalStatus.delivery_status;
  options.flowResult.artifacts.coverage_status = canonicalStatus.coverage_status;
  options.flowResult.artifacts.acceptance_status = canonicalStatus.acceptance_status;
  options.flowResult.artifacts.run_tier = canonicalStatus.run_tier;
  options.flowResult.artifacts.release_status = canonicalStatus.release_status;
  options.flowResult.artifacts.proof_eligible_tier = canonicalStatus.proof_eligible_tier;
  options.flowResult.artifacts.required_matrix_acceptance_closed = canonicalStatus.required_matrix_acceptance_closed;
  if (
    !(
      typeof options.flowResult.artifacts.runner_quality_summary === "object" &&
      options.flowResult.artifacts.runner_quality_summary
    )
  ) {
    options.flowResult.artifacts.runner_quality_summary = buildPartialRunnerQualitySummary({
      canonicalStatus,
      observationReport,
      flowResult: options.flowResult,
      finalSkillAgentVerdict,
    });
  }
  if (
    !(
      typeof options.flowResult.artifacts.quality_judgement === "object" && options.flowResult.artifacts.quality_judgement
    )
  ) {
    options.flowResult.artifacts.quality_judgement = buildPartialQualityJudgement({
      profile: options.profile,
      canonicalStatus,
      runnerQualitySummary: asRecord(options.flowResult.artifacts.runner_quality_summary),
      flowResult: options.flowResult,
      observationReport,
    });
  }
  resolveFinalSkillAgentVerdict({
    runId: options.runId,
    reportsRoot: options.layout.reportsRoot,
    sourceRoot: options.hostRoot,
    targetCheckoutRoot: asNonEmptyString(options.flowResult.artifacts.target_checkout_root),
    observationReport,
    canonicalStatus,
    runnerQualitySummary: asRecord(options.flowResult.artifacts.runner_quality_summary),
    qualityJudgement: asRecord(options.flowResult.artifacts.quality_judgement),
    flowResult: options.flowResult,
  });
  const sourceMetadata = resolveHostSourceMetadata(options.hostRoot);
  const latestRuntimeHarnessReportFile =
    asNonEmptyString(productionProof?.evidence_refs?.runtime_harness_report_file) ||
    asNonEmptyString(options.flowResult.artifacts.latest_runtime_harness_report_file) ||
    asNonEmptyString(options.flowResult.artifacts.runtime_harness_report_file) ||
    asNonEmptyString(options.flowResult.artifacts.delivery_runtime_harness_report_file) ||
    asNonEmptyString(options.flowResult.artifacts.run_start_runtime_harness_report_file) ||
    null;
  const runtimePermissionEvidence = collectRuntimePermissionEvidence([
    asNonEmptyString(productionProof?.evidence_refs?.runtime_harness_report_file),
    asNonEmptyString(options.flowResult.artifacts.latest_runtime_harness_report_file),
    asNonEmptyString(options.flowResult.artifacts.runtime_harness_report_file),
    asNonEmptyString(options.flowResult.artifacts.delivery_runtime_harness_report_file),
    asNonEmptyString(options.flowResult.artifacts.run_start_runtime_harness_report_file),
  ]);
  const lifecycleCompleteness = buildLifecycleCompletenessSummary(observationReport);

  const summary = {
    run_id: options.runId,
    project_id: options.hostProjectId,
    commit_sha: sourceMetadata.commit_sha,
    branch_name: sourceMetadata.branch_name,
    profile_ref: options.profilePath,
    profile_id: options.profile.profile_id ?? null,
    scenario_id: options.profile.scenario_id ?? null,
    scenario_family: options.profile.scenario_family ?? null,
    target_catalog_id: options.profile.target_catalog_id ?? null,
    feature_mission_id: options.flowResult.artifacts.feature_mission_id ?? options.profile.feature_mission_id ?? null,
    provider_variant_id: options.profile.provider_variant_id ?? null,
    feature_size: options.flowResult.artifacts.feature_size ?? null,
    run_tier: canonicalStatus.run_tier,
    flow_kind: options.profile.flow_kind ?? null,
    duration_class: options.profile.duration_class ?? null,
    started_at: options.flowResult.startedAt,
    finished_at: options.flowResult.finishedAt,
    status: observationReport.overall_status,
    continuation_status: lifecycleCompleteness.continuation_status,
    blocked_step_id: lifecycleCompleteness.blocked_step_id,
    blocked_step_instance_id: lifecycleCompleteness.blocked_step_instance_id,
    lifecycle_completeness: lifecycleCompleteness,
    canonical_status: canonicalStatus,
    command_status: canonicalStatus.command_status,
    target_verification_status: canonicalStatus.target_verification_status,
    artifact_quality_status: canonicalStatus.artifact_quality_status,
    delivery_status: canonicalStatus.delivery_status,
    coverage_status: canonicalStatus.coverage_status,
    acceptance_status: canonicalStatus.acceptance_status,
    release_status: canonicalStatus.release_status,
    proof_eligible_tier: canonicalStatus.proof_eligible_tier,
    required_matrix_acceptance_closed: canonicalStatus.required_matrix_acceptance_closed,
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
    aor_installation:
      typeof options.flowResult.artifacts.aor_installation === "object" && options.flowResult.artifacts.aor_installation
        ? options.flowResult.artifacts.aor_installation
        : null,
    aor_installation_proof_file: asNonEmptyString(options.flowResult.artifacts.aor_installation_proof_file) || null,
    setup_journal: observationReport.setup_journal,
    guided_journey:
      typeof options.flowResult.artifacts.guided_journey_proof === "object" &&
      options.flowResult.artifacts.guided_journey_proof
        ? options.flowResult.artifacts.guided_journey_proof
        : null,
    live_e2e_observation_report_file: observationReportFile,
    live_e2e_controller_state_file: asNonEmptyString(options.flowResult.artifacts.live_e2e_controller_state_file) || null,
    live_e2e_step_observation_files: stepObservationFiles,
    live_e2e_observation_overall_status: observationReport.overall_status,
    operator_context: observationReport.operator_context,
    final_skill_agent_verdict_request_file: finalSkillAgentVerdict.requestFile,
    final_skill_agent_verdict_file: finalSkillAgentVerdict.verdictFile,
    final_skill_agent_verdict: finalSkillAgentVerdict.verdict ?? null,
    agent_artifact_review_request_file: agentArtifactReviewRequestFile,
    matrix_cell:
      typeof options.flowResult.artifacts.matrix_cell === "object" && options.flowResult.artifacts.matrix_cell
        ? options.flowResult.artifacts.matrix_cell
        : null,
    quality_judgement:
      typeof options.flowResult.artifacts.quality_judgement === "object" && options.flowResult.artifacts.quality_judgement
        ? options.flowResult.artifacts.quality_judgement
        : null,
    runner_quality_summary:
      typeof options.flowResult.artifacts.runner_quality_summary === "object" &&
      options.flowResult.artifacts.runner_quality_summary
        ? options.flowResult.artifacts.runner_quality_summary
        : null,
    production_proof: productionProof,
    proof_scope: productionProof?.proof_scope ?? null,
    external_runner_mode: productionProof?.external_runner_mode ?? null,
    real_code_change_proof_complete: productionProof?.real_code_change_proof_complete ?? null,
    production_proof_evidence_status: productionProof?.evidence_status ?? null,
    production_proof_evidence_refs: productionProof?.evidence_refs ?? null,
    no_upstream_write_assertion: productionProof?.no_upstream_write_assertion ?? null,
    delivery_manifest_file:
      productionProof?.evidence_refs?.delivery_manifest_file ??
      asNonEmptyString(options.flowResult.artifacts.delivery_manifest_file) ??
      null,
    review_report_file:
      productionProof?.evidence_refs?.review_report_file ??
      asNonEmptyString(options.flowResult.artifacts.review_report_file) ??
      null,
    latest_runtime_harness_report_file:
      latestRuntimeHarnessReportFile,
    runtime_permission_summary: runtimePermissionEvidence.summary,
    runtime_permission_decisions: runtimePermissionEvidence.decisions,
    coverage_follow_up:
      typeof options.flowResult.artifacts.coverage_follow_up === "object" && options.flowResult.artifacts.coverage_follow_up
        ? options.flowResult.artifacts.coverage_follow_up
        : null,
    scorecard_files: [scorecardFile],
    control_surfaces: {
      installed_user_proof_runner:
        "node ./scripts/live-e2e/run-profile.mjs --project-ref <path> --profile <path> [--run-id <id>] [--runtime-root <path>] [--aor-bin <path>] [--aor-install-mode isolated|repo-local] [--catalog-root <path>] [--runner-auth-mode host|isolated] [--runtime-agent-permission-mode full-bypass|restricted] [--runtime-agent-interaction-policy fail-closed|ask-all|orchestrator-mediated] [--runtime-agent-auto-approval-profile none|conservative|auto-edit|trusted-run] [--controller-mode auto|manual|evaluator]",
      manual_live_e2e:
        "node ./scripts/live-e2e/manual-live-e2e.mjs --project-ref <path> --profile <path> --run-id <id>",
      step_evaluator:
        "node ./scripts/live-e2e/step-evaluator.mjs --project-ref <path> --profile <path>",
      qualification_loop:
        "node ./scripts/live-e2e/qualification-loop.mjs --project-ref <path> --profile <path>",
      public_cli_sequence: options.flowResult.commandResults.map((result) => result.command_surface).filter(Boolean),
      aor_bin: options.aorLaunch.binaryRef,
      bootstrap_assets_root: path.join(options.hostRoot, "examples"),
    },
    runner_auth_mode: asNonEmptyString(options.flowResult.artifacts.runner_auth_mode) || null,
    runner_auth_source: asNonEmptyString(options.flowResult.artifacts.runner_auth_source) || null,
    runtime_agent_permission_mode: asNonEmptyString(options.flowResult.artifacts.runtime_agent_permission_mode) || null,
    runtime_agent_interaction_policy: asNonEmptyString(options.flowResult.artifacts.runtime_agent_interaction_policy) || null,
    runtime_agent_auto_approval_profile:
      asNonEmptyString(options.flowResult.artifacts.runtime_agent_auto_approval_profile) || null,
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
        "Usage: node ./scripts/live-e2e/run-profile.mjs --project-ref <path> --profile <path> [--run-id <id>] [--runtime-root <path>] [--aor-bin <path>] [--aor-install-mode isolated|repo-local] [--catalog-root <path>] [--runner-auth-mode host|isolated] [--runtime-agent-permission-mode full-bypass|restricted] [--runtime-agent-interaction-policy fail-closed|ask-all|orchestrator-mediated] [--runtime-agent-auto-approval-profile none|conservative|auto-edit|trusted-run] [--controller-mode auto|manual|evaluator]",
        "",
        "Installed-user black-box proof runner with online step-controller evaluation.",
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
  const requestedAorInstallMode = resolveOptionalStringFlag(flags["aor-install-mode"], "aor-install-mode");
  if (Object.prototype.hasOwnProperty.call(flags, "agent-judge-file")) {
    throw new UsageError("--agent-judge-file is no longer supported; live E2E requires skill-agent operator decisions.");
  }
  if (Object.prototype.hasOwnProperty.call(flags, "examples-root")) {
    throw new UsageError("--examples-root is no longer supported; live E2E uses packaged bootstrap assets only.");
  }
  const catalogRootOverride = resolveOptionalStringFlag(flags["catalog-root"], "catalog-root");
  const runnerAuthMode = resolveRunnerAuthMode(resolveOptionalStringFlag(flags["runner-auth-mode"], "runner-auth-mode"));
  const runtimeAgentPermissionMode = resolveRuntimeAgentPermissionMode(
    resolveOptionalStringFlag(flags["runtime-agent-permission-mode"], "runtime-agent-permission-mode"),
  );
  const runtimeAgentInteractionPolicy = resolveRuntimeAgentInteractionPolicy(
    resolveOptionalStringFlag(flags["runtime-agent-interaction-policy"], "runtime-agent-interaction-policy"),
  );
  const requestedAutoApprovalProfile = resolveOptionalStringFlag(
    flags["runtime-agent-auto-approval-profile"],
    "runtime-agent-auto-approval-profile",
  );
  const runtimeAgentAutoApprovalProfile = resolveRuntimeAgentAutoApprovalProfile(
    requestedAutoApprovalProfile ??
      (runtimeAgentInteractionPolicy === "orchestrator-mediated" ? "conservative" : null),
  );
  const controllerMode = resolveLiveE2eControllerMode(resolveOptionalStringFlag(flags["controller-mode"], "controller-mode"));
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
  const examplesRoot = requireDirectory(path.join(hostRoot, "examples"));
  const runId =
    resolveOptionalStringFlag(flags["run-id"], "run-id") ??
    `${asNonEmptyString(profile.profile_id) || "live-e2e"}.run-${nowIso().replace(/[^0-9]/g, "").slice(-12)}`;
  const aorInstallMode = resolveAorInstallMode(requestedAorInstallMode, {
    aorBin,
    profile,
    fullJourney: fullJourneyResolution !== null,
  });
  assertInstallModeAllowed({
    mode: aorInstallMode,
    profile,
  });
  const isolatedWorkspaceRoot = aorInstallMode === "isolated" ? resolveDefaultIsolatedWorkspace({ runId }) : null;
  const effectiveRuntimeRoot =
    runtimeRoot ?? (isolatedWorkspaceRoot ? path.join(isolatedWorkspaceRoot, "runtime") : null);
  const hostProjectId = discoverHostProjectId(hostRoot);
  const layout = ensureRuntimeLayout({
    hostRoot,
    runtimeRootOverride: effectiveRuntimeRoot,
    hostProjectId,
  });
  let aorInstallation;
  let installationFailure = null;
  try {
    aorInstallation = prepareAorInstallationProof({
      hostRoot,
      reportsRoot: layout.reportsRoot,
      runId,
      profile,
      aorBinOverride: aorBin,
      installMode: aorInstallMode,
      isolatedWorkspaceRoot,
      isolatedSourceRoot: isolatedWorkspaceRoot ? path.join(isolatedWorkspaceRoot, "aor-source") : null,
      runtimeRoot: layout.runtimeRoot,
    });
  } catch (error) {
    const failedInstallation = asRecord(asRecord(error).aorInstallation);
    if (Object.keys(failedInstallation).length === 0) {
      throw error;
    }
    aorInstallation = failedInstallation;
    installationFailure = error;
  }
  const aorLaunch = aorInstallation.launch;
  const stepController = createLiveE2eStepController({
    reportsRoot: layout.reportsRoot,
    runId,
    profile,
    mode: controllerMode,
    sourceRoot: asNonEmptyString(asRecord(aorInstallation.proof).installed_source_root) || hostRoot,
    targetCheckoutRoot: asNonEmptyString(asRecord(aorInstallation.proof).target_checkout_root),
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

  if (installationFailure) {
    flowResult = {
      startedAt: nowIso(),
      finishedAt: nowIso(),
      status: "fail",
      stageResults: [
        {
          stage: "install",
          status: "fail",
          evidence_refs: uniqueStrings([
            asNonEmptyString(aorInstallation.proofFile),
            ...asStringArray(asRecord(aorInstallation.proof).command_transcripts),
          ]),
          summary: installationFailure instanceof Error ? installationFailure.message : String(installationFailure),
        },
      ],
      commandResults: [],
      artifacts: {
        host_runtime_root: layout.runtimeRoot,
        host_reports_root: layout.reportsRoot,
        live_e2e_controller_state_file: stepController.stateFile,
        live_e2e_step_journal_entries: stepController.getStepJournal(),
        aor_installation: asRecord(aorInstallation.proof),
        aor_installation_proof_file: asNonEmptyString(aorInstallation.proofFile),
        live_e2e_setup_journal_entries: [asRecord(aorInstallation.setupEntry)],
        runtime_agent_permission_mode: runtimeAgentPermissionMode,
        runtime_agent_interaction_policy: runtimeAgentInteractionPolicy,
        runtime_agent_auto_approval_profile: runtimeAgentAutoApprovalProfile,
      },
    };
  } else {
    try {
      flowResult = fullJourneyResolution
        ? executeFullJourneyFlow({
            hostRoot,
            layout,
            runId,
            profilePath,
            profile,
            aorLaunch,
            examplesRoot,
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
            runtimeAgentInteractionPolicy,
            runtimeAgentAutoApprovalProfile,
            authProbeRequired: resolveAuthProbeRequired(profile),
            stepController,
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
            runtimeAgentInteractionPolicy,
            runtimeAgentAutoApprovalProfile,
            stepController,
            examplesRoot,
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
          live_e2e_controller_state_file: stepController.stateFile,
          live_e2e_step_journal_entries: stepController.getStepJournal(),
          aor_installation: aorInstallation.proof,
          aor_installation_proof_file: aorInstallation.proofFile,
          live_e2e_setup_journal_entries: [aorInstallation.setupEntry],
          runtime_agent_permission_mode: runtimeAgentPermissionMode,
          runtime_agent_interaction_policy: runtimeAgentInteractionPolicy,
          runtime_agent_auto_approval_profile: runtimeAgentAutoApprovalProfile,
        },
      };
    }
  }
  flowResult.artifacts.aor_installation = aorInstallation.proof;
  flowResult.artifacts.aor_installation_proof_file = aorInstallation.proofFile;
  flowResult.artifacts.live_e2e_setup_journal_entries = [aorInstallation.setupEntry];
  flowResult.artifacts.live_e2e_controller_state_file =
    asNonEmptyString(flowResult.artifacts.live_e2e_controller_state_file) || stepController.stateFile;
  if (!Array.isArray(flowResult.artifacts.live_e2e_step_journal_entries)) {
    flowResult.artifacts.live_e2e_step_journal_entries = stepController.getStepJournal();
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
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        command: "scripts live-e2e run-profile",
        status: "ok",
        run_id: runId,
        live_e2e_run_status: written.summary.status,
        acceptance_status: written.summary.acceptance_status,
        coverage_status: written.summary.coverage_status,
        live_e2e_run_summary_file: written.summaryFile,
        live_e2e_observation_report_file: written.summary.live_e2e_observation_report_file,
        aor_installation_proof_file: written.summary.aor_installation_proof_file,
        live_e2e_controller_state_file: written.summary.live_e2e_controller_state_file,
        live_e2e_step_observation_files: written.summary.live_e2e_step_observation_files,
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
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
}
