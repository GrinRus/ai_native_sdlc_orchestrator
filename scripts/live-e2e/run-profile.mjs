#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import os from "node:os";
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
} from "./lib/profile-catalog.mjs";
import { executeFullJourneyFlow, executeInstalledUserFlow, prepareAorInstallationProof } from "./lib/flows.mjs";
import { resolveAuthProbeRequired } from "./lib/preflight.mjs";
import { applyProductionProofEvidence, buildProductionProofSummary } from "./lib/production-proof.mjs";
import {
  buildLiveE2eStepPlan,
  createLiveE2eStepController,
  resolveLiveE2eOperatorContext,
} from "./lib/step-controller.mjs";

const LIVE_E2E_DELIVERY_STEPS = Object.freeze([
  "discovery",
  "spec",
  "planning",
  "handoff",
  "execution",
  "review",
  "qa",
  "delivery",
]);
const LIVE_E2E_FULL_LIFECYCLE_STEPS = Object.freeze([
  ...LIVE_E2E_DELIVERY_STEPS,
  "release",
  "learning",
]);
const LIVE_E2E_OBSERVATION_PRELUDE_STEPS = Object.freeze([
  "install",
  "target_checkout",
  "project_bootstrap",
  "intake",
  "readiness",
]);
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
 * @param {Record<string, unknown>} judgeDocument
 * @returns {Map<string, Record<string, unknown>>}
 */
function indexAgentJudgeEntries(judgeDocument) {
  const entries = Array.isArray(judgeDocument.step_journal)
    ? judgeDocument.step_journal
    : Array.isArray(judgeDocument.steps)
      ? judgeDocument.steps
      : [];
  const indexed = new Map();
  for (const entry of entries) {
    const record = asRecord(entry);
    const stepId = asNonEmptyString(record.step_id) || asNonEmptyString(record.step) || asNonEmptyString(record.flow_stage);
    if (stepId) indexed.set(stepId, record);
  }
  return indexed;
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
 * @param {"delivery_default" | "full_lifecycle"} policy
 * @returns {string[]}
 */
function getIncludedStepsForPolicy(policy) {
  return policy === "full_lifecycle" ? [...LIVE_E2E_FULL_LIFECYCLE_STEPS] : [...LIVE_E2E_DELIVERY_STEPS];
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
  if (
    internalTestHooks.allow_repo_local_install_for_test === true ||
    (internalTestHooks.allow_deterministic_operator_for_test === true && runTier !== "production-proof")
  ) {
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
  if (step === "delivery") return ["deliver-prepare"];
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
 * @returns {Array<Record<string, unknown>>}
 */
function buildFrontendInteractions(artifacts) {
  const summaryFile = asNonEmptyString(artifacts.guided_web_smoke_summary_file);
  const htmlFile = asNonEmptyString(artifacts.guided_web_smoke_html_file);
  if (!summaryFile && !htmlFile) return [];
  return [
    {
      step_id: "learning",
      interaction_id: "guided-web-smoke",
      surface: "web",
      evidence_refs: uniqueStrings([summaryFile, htmlFile]),
      status: "pass",
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

/**
 * @param {{ profile: Record<string, unknown>, flowResult: { stageResults: Array<Record<string, unknown>>, commandResults: Array<Record<string, unknown>>, artifacts: Record<string, unknown> }, agentJudgeDocument: Record<string, unknown> }}
 */
function buildStepJournal(options) {
  const controllerEntries = Array.isArray(options.flowResult.artifacts.live_e2e_step_journal_entries)
    ? options.flowResult.artifacts.live_e2e_step_journal_entries.map((entry) => asRecord(entry))
    : [];
  const judgeEntries = indexAgentJudgeEntries(options.agentJudgeDocument);
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
    const judgeEntry = judgeEntries.get(step) ?? judgeEntries.get(asNonEmptyString(command?.label));
    const semanticStatus = judgeEntry
      ? toObservationStatus(asNonEmptyString(asRecord(judgeEntry.semantic_analysis).status) || asNonEmptyString(judgeEntry.status))
      : toObservationStatus(asNonEmptyString(asRecord(rawEntry.semantic_analysis).status) || deterministicStatus);
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
        judge_source:
          asNonEmptyString(judgeEntry?.judge_source) ||
          asNonEmptyString(asRecord(judgeEntry?.semantic_analysis).judge_source) ||
          asNonEmptyString(asRecord(rawEntry.semantic_analysis).judge_source) ||
          "deterministic-runner",
        findings: uniqueStrings([
          ...asStringArray(asRecord(rawEntry.semantic_analysis).findings),
          ...asStringArray(judgeEntry?.findings),
          ...asStringArray(asRecord(judgeEntry?.semantic_analysis).findings),
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
 * @param {{ stepJournal: Array<Record<string, unknown>>, artifacts: Record<string, unknown> }}
 */
function buildFinalAnalysis(options) {
  const codeQuality = buildCodeQualityObservation(options.artifacts);
  const qualityRelevantStepJournal = getQualityRelevantStepJournal(options.stepJournal);
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
  const findings = uniqueStrings([
    ...asStringArray(codeQuality.findings),
    ...qualityRelevantStepJournal.flatMap((entry) => asStringArray(asRecord(entry.semantic_analysis).findings)),
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

/**
 * @param {{ runId: string, profilePath: string, profile: Record<string, unknown>, flowResult: { stageResults: Array<Record<string, unknown>>, commandResults: Array<Record<string, unknown>>, artifacts: Record<string, unknown> }, summaryFile: string, agentJudgeDocument: Record<string, unknown> }}
 */
function buildObservationReport(options) {
  const flowRangePolicy = resolveFlowRangePolicy(options.profile);
  const includedSteps = getIncludedStepsForPolicy(flowRangePolicy);
  const excludedSteps = flowRangePolicy === "full_lifecycle" ? [] : ["release", "learning"];
  const setupJournal = buildSetupJournal(options.flowResult.artifacts);
  const operatorContext = resolveLiveE2eOperatorContext(options.profile);
  const controllerStop = asRecord(options.flowResult.artifacts.live_e2e_controller_stop);
  const reportStatus = Object.keys(controllerStop).length > 0 ? "in_progress" : "final";
  const agentJudgeDocument =
    asNonEmptyString(operatorContext.operator_kind) === "skill-agent" ? {} : options.agentJudgeDocument;
  const stepJournal = buildStepJournal({
    profile: options.profile,
    flowResult: options.flowResult,
    agentJudgeDocument,
  });
  const finalAnalysis = buildFinalAnalysis({
    stepJournal,
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
    frontend_interactions: buildFrontendInteractions(options.flowResult.artifacts),
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
  const acceptanceStatus =
    releaseMissing
      ? "fail"
      : deliveryStatus === "degraded" || deliveryStatus === "blocked"
        ? "fail"
      : options.observationStatus === "pass"
      ? "pass"
      : options.observationStatus === "warn" && deliveryStatus !== "not_materialized"
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
  return {
    command_status: commandStatus,
    target_verification_status: asNonEmptyString(options.flowResult.artifacts.post_run_verify_status) || "not_attempted",
    artifact_quality_status: asNonEmptyString(qualityJudgement.artifact_quality) || "not_attempted",
    delivery_status: deliveryStatus,
    coverage_status: coverageStatus,
    acceptance_status: acceptanceStatus,
    run_tier: runTier,
    release_status: releaseStatus,
    proof_eligible_tier: proofEligibleTier,
    required_matrix_acceptance_closed: coverageStatus === "covered_pass" && proofEligibleTier,
    findings: releaseMissing ? ["Required release stage did not materialize strict release-packet evidence."] : [],
    summary:
      acceptanceStatus === "pass"
        ? "Live E2E acceptance evidence passed."
        : acceptanceStatus === "warn"
          ? "Live E2E completed with findings; required matrix acceptance is not closed."
          : "Live E2E did not meet acceptance requirements.",
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
  const request = {
    request_id: `${options.runId}.agent-artifact-review.v1`,
    run_id: options.runId,
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
            judge_source: "agent",
            findings: [],
          },
          judge_source: "agent",
          artifact_refs: [],
          findings: [],
        },
      ],
    },
    steps: options.stepJournal.map((entry) => ({
      step_id: asNonEmptyString(entry.step_id),
      flow_stage: asNonEmptyString(entry.flow_stage),
      artifact_refs: asStringArray(entry.artifact_refs),
      observed_status: asNonEmptyString(entry.final_step_verdict),
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
  const stepObservationFiles = writeStepObservationFiles({
    runId: options.runId,
    reportsRoot: options.layout.reportsRoot,
    stepJournal: observationReport.step_journal,
  });
  observationReport.evidence_refs = uniqueStrings([...asStringArray(observationReport.evidence_refs), ...stepObservationFiles]);
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
    stepJournal: observationReport.step_journal,
  });
  options.flowResult.artifacts.live_e2e_observation_report_file = observationReportFile;
  options.flowResult.artifacts.live_e2e_step_observation_files = stepObservationFiles;
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
  const sourceMetadata = resolveHostSourceMetadata(options.hostRoot);

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
    agent_artifact_review_request_file: agentArtifactReviewRequestFile,
    matrix_cell:
      typeof options.flowResult.artifacts.matrix_cell === "object" && options.flowResult.artifacts.matrix_cell
        ? options.flowResult.artifacts.matrix_cell
        : null,
    quality_judgement:
      typeof options.flowResult.artifacts.quality_judgement === "object" && options.flowResult.artifacts.quality_judgement
        ? options.flowResult.artifacts.quality_judgement
        : null,
    agent_operator_assessment:
      typeof options.flowResult.artifacts.agent_operator_assessment === "object" &&
      options.flowResult.artifacts.agent_operator_assessment
        ? options.flowResult.artifacts.agent_operator_assessment
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
      productionProof?.evidence_refs?.runtime_harness_report_file ??
      asNonEmptyString(options.flowResult.artifacts.latest_runtime_harness_report_file) ??
      asNonEmptyString(options.flowResult.artifacts.runtime_harness_report_file) ??
      null,
    coverage_follow_up:
      typeof options.flowResult.artifacts.coverage_follow_up === "object" && options.flowResult.artifacts.coverage_follow_up
        ? options.flowResult.artifacts.coverage_follow_up
        : null,
    scorecard_files: [scorecardFile],
    control_surfaces: {
      installed_user_proof_runner:
        "node ./scripts/live-e2e/run-profile.mjs --project-ref <path> --profile <path> [--run-id <id>] [--runtime-root <path>] [--aor-bin <path>] [--aor-install-mode isolated|repo-local] [--examples-root <path>] [--catalog-root <path>] [--runner-auth-mode host|isolated] [--runtime-agent-permission-mode full-bypass|restricted] [--agent-judge-file <path>] [--controller-mode auto|manual|evaluator]",
      manual_live_e2e:
        "node ./scripts/live-e2e/manual-live-e2e.mjs --project-ref <path> --profile <path> --run-id <id>",
      step_evaluator:
        "node ./scripts/live-e2e/step-evaluator.mjs --project-ref <path> --profile <path>",
      qualification_loop:
        "node ./scripts/live-e2e/qualification-loop.mjs --project-ref <path> --profile <path>",
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
        "Usage: node ./scripts/live-e2e/run-profile.mjs --project-ref <path> --profile <path> [--run-id <id>] [--runtime-root <path>] [--aor-bin <path>] [--aor-install-mode isolated|repo-local] [--examples-root <path>] [--catalog-root <path>] [--runner-auth-mode host|isolated] [--runtime-agent-permission-mode full-bypass|restricted] [--agent-judge-file <path>] [--controller-mode auto|manual|evaluator]",
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
  const agentJudgeFile = resolveOptionalStringFlag(flags["agent-judge-file"], "agent-judge-file");
  const catalogRootOverride = resolveOptionalStringFlag(flags["catalog-root"], "catalog-root");
  const runnerAuthMode = resolveRunnerAuthMode(resolveOptionalStringFlag(flags["runner-auth-mode"], "runner-auth-mode"));
  const runtimeAgentPermissionMode = resolveRuntimeAgentPermissionMode(
    resolveOptionalStringFlag(flags["runtime-agent-permission-mode"], "runtime-agent-permission-mode"),
  );
  const controllerMode = resolveLiveE2eControllerMode(resolveOptionalStringFlag(flags["controller-mode"], "controller-mode"));
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
            stepController,
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
          live_e2e_controller_state_file: stepController.stateFile,
          live_e2e_step_journal_entries: stepController.getStepJournal(),
          aor_installation: aorInstallation.proof,
          aor_installation_proof_file: aorInstallation.proofFile,
          live_e2e_setup_journal_entries: [aorInstallation.setupEntry],
          runtime_agent_permission_mode: runtimeAgentPermissionMode,
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
