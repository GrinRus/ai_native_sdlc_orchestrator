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
  readYamlDocument,
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
import { validateContractDocument } from "./lib/contracts/index.mjs";
import {
  discoverHostProjectId,
  ensureRuntimeLayout,
  isFullJourneyProfile,
  isManualOnlyFeatureSize,
  loadProofRunnerProfile,
  resolveCatalogRoot,
  resolveFullJourneyProfile,
} from "./lib/profile-catalog.mjs";
import {
  changedPathsHaveMissionRelevantChanges, collectDeliveryManifestChangedPaths,
  collectReviewChangedPaths,
  collectRuntimeHarnessChangedPaths,
  executeFullJourneyFlow,
  executeInstalledUserFlow,
  prepareAorInstallationProof,
  reconcileSummaryMeaningfulChangedPaths,
  runtimeHarnessReportHasMissionRelevantChanges,
} from "./lib/flows.mjs";
import { resolveAuthProbeRequired } from "./lib/preflight.mjs";
import { applyProductionProofEvidence, buildProductionProofSummary } from "./lib/production-proof.mjs";
import { buildCommandHealth } from "./lib/run-health.mjs";
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
const AOR_OPERATOR_ACCESSIBILITY_CHECK_IDS = Object.freeze([
  "keyboard_navigation",
  "focus_order",
  "contrast_and_readability",
  "semantic_structure",
  "screen_reader_labels",
  "accessible_error_feedback",
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
 * @param {unknown} error
 * @returns {{ owner: string, phase: string, class: string }}
 */
function classifyEarlyFlowFailure(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/target checkout clone|git clone|unable to access|ssl_connect|could not resolve host|failed to connect|connection timed out/iu.test(message)) {
    return {
      owner: "environment",
      phase: "target_checkout",
      class: "target_checkout_unavailable",
    };
  }
  if (/target checkout ref resolution|pathspec|remote branch|not found in upstream/iu.test(message)) {
    return {
      owner: "target_repository",
      phase: "target_checkout",
      class: "target_ref_unavailable",
    };
  }
  if (/project init|project bootstrap|bootstrap profile|bootstrap asset/iu.test(message)) {
    return {
      owner: "aor",
      phase: "project_bootstrap",
      class: "project_bootstrap_failed",
    };
  }
  return {
    owner: "aor",
    phase: "project_bootstrap",
    class: "bootstrap_failed",
  };
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
 * @param {string | null} filePath
 * @returns {Record<string, unknown>}
 */
function readJsonIfPresent(filePath) {
  const resolved = asNonEmptyString(filePath);
  return resolved && fileExists(resolved) ? asRecord(readJson(resolved)) : {};
}

/**
 * @param {string | null} filePath
 * @returns {Record<string, unknown>}
 */
function readYamlIfPresent(filePath) {
  const resolved = asNonEmptyString(filePath);
  return resolved && fileExists(resolved) ? asRecord(readYamlDocument(resolved)) : {};
}

const ARTIFACT_READINESS_PROOF_STAGES = Object.freeze(["mission", "discovery", "research", "spec", "planning"]);
const ARTIFACT_LINEAGE_STEPS = Object.freeze(["discovery", "research", "spec", "planning"]);

/**
 * @param {Record<string, unknown>} readiness
 * @param {string} stage
 * @returns {Record<string, unknown>}
 */
function summarizeReadinessStage(readiness, stage) {
  const stageReadiness = asRecord(asRecord(readiness.stages)[stage]);
  return {
    status: asNonEmptyString(stageReadiness.status) || null,
    evidence_ref: asNonEmptyString(stageReadiness.evidence_ref) || null,
    reason: asNonEmptyString(stageReadiness.reason) || null,
    blocked_reasons: asStringArray(stageReadiness.blocked_reasons),
    stale_reasons: asStringArray(stageReadiness.stale_reasons),
    required_evidence_refs: asStringArray(stageReadiness.required_evidence_refs),
    soft_decision:
      typeof stageReadiness.soft_decision === "object" && stageReadiness.soft_decision
        ? asRecord(stageReadiness.soft_decision)
        : null,
  };
}

/**
 * @param {Record<string, unknown>} snapshot
 * @returns {Record<string, unknown>}
 */
function summarizeArtifactReadinessSnapshot(snapshot) {
  const reportFile = asNonEmptyString(snapshot.next_action_report_file);
  const report = readJsonIfPresent(reportFile);
  const snapshotReadiness = asRecord(snapshot.artifact_readiness);
  const reportReadiness = asRecord(report.artifact_readiness);
  const readiness = Object.keys(snapshotReadiness).length > 0 ? snapshotReadiness : reportReadiness;
  return {
    checkpoint: asNonEmptyString(snapshot.checkpoint) || null,
    command_label: asNonEmptyString(snapshot.command_label) || null,
    transcript_file: asNonEmptyString(snapshot.transcript_file) || null,
    next_action_report_file: reportFile || null,
    next_action_status:
      asNonEmptyString(snapshot.next_action_status) ||
      asNonEmptyString(report.next_action_status) ||
      null,
    next_action_primary:
      asNonEmptyString(snapshot.next_action_primary) ||
      asNonEmptyString(report.next_action_primary) ||
      null,
    policy: Object.keys(asRecord(readiness.policy)).length > 0 ? asRecord(readiness.policy) : null,
    stages: Object.fromEntries(
      ARTIFACT_READINESS_PROOF_STAGES.map((stage) => [stage, summarizeReadinessStage(readiness, stage)]),
    ),
    evidence_refs: uniqueStrings([
      reportFile,
      asNonEmptyString(snapshot.transcript_file),
      ...asStringArray(snapshot.evidence_refs),
    ]),
  };
}

/**
 * @param {unknown} value
 * @param {string} step
 * @returns {Record<string, unknown>}
 */
function findStepEntry(value, step) {
  return asRecord(
    Array.isArray(value)
      ? value.find((entry) => asNonEmptyString(asRecord(entry).step_class) === step)
      : null,
  );
}

/**
 * @param {{
 *   step: string,
 *   profile: Record<string, unknown>,
 *   analysisReport: Record<string, unknown>,
 *   specStepResult: Record<string, unknown>,
 * }} options
 * @returns {Record<string, unknown>}
 */
function summarizePromptLineageStep(options) {
  const assetEntry = findStepEntry(asRecord(options.analysisReport.asset_resolution).matrix, options.step);
  const architectureEntry = findStepEntry(
    asRecord(options.analysisReport.architecture_traceability).step_linkage,
    options.step,
  );
  const specRoutedExecution = asRecord(options.specStepResult.routed_execution);
  const specContextCompilation = asRecord(specRoutedExecution.context_compilation);
  const specCompiledContext = asRecord(specContextCompilation.compiled_context_artifact);
  const selectedSpecStep = asRecord(asRecord(specRoutedExecution.architecture_traceability).selected_step);
  const specSelected = options.step === "spec" ? selectedSpecStep : {};
  return {
    step: options.step,
    profile_prompt_bundle_ref: asNonEmptyString(asRecord(options.profile.default_prompt_bundles)[options.step]) || null,
    analysis_prompt_bundle_ref:
      asNonEmptyString(asRecord(assetEntry.prompt_bundle).prompt_bundle_ref) ||
      asNonEmptyString(architectureEntry.prompt_bundle_ref) ||
      null,
    wrapper_ref:
      asNonEmptyString(asRecord(assetEntry.wrapper).wrapper_ref) ||
      asNonEmptyString(architectureEntry.wrapper_ref) ||
      null,
    route_id:
      asNonEmptyString(asRecord(assetEntry.route).resolved_route_id) ||
      asNonEmptyString(architectureEntry.route_id) ||
      null,
    policy_id: asNonEmptyString(architectureEntry.policy_id) || null,
    selected_step_prompt_bundle_ref: asNonEmptyString(specSelected.prompt_bundle_ref) || null,
    compiled_context_ref:
      options.step === "spec" ? asNonEmptyString(specContextCompilation.compiled_context_ref) || null : null,
    compiled_context_file:
      options.step === "spec" ? asNonEmptyString(specContextCompilation.compiled_context_file) || null : null,
    compiled_context_prompt_bundle_ref:
      options.step === "spec" ? asNonEmptyString(specCompiledContext.prompt_bundle_ref) || null : null,
    required_input_refs:
      options.step === "spec"
        ? uniqueStrings([
            ...asStringArray(specCompiledContext.packet_refs),
            ...asStringArray(asRecord(specRoutedExecution.adapter_request).input_packet_refs),
          ])
        : [],
    context_bundle_refs:
      options.step === "spec" ? asStringArray(specCompiledContext.context_bundle_refs) : [],
    skill_refs:
      options.step === "spec" ? asStringArray(specCompiledContext.skill_refs) : [],
    provenance:
      options.step === "spec" && Object.keys(asRecord(specCompiledContext.provenance)).length > 0
        ? {
            compiler_revision_ref: asNonEmptyString(asRecord(specCompiledContext.provenance).compiler_revision_ref) || null,
            project_profile_ref: asNonEmptyString(asRecord(specCompiledContext.provenance).project_profile_ref) || null,
            route_profile_ref: asNonEmptyString(asRecord(specCompiledContext.provenance).route_profile_ref) || null,
            wrapper_profile_ref: asNonEmptyString(asRecord(specCompiledContext.provenance).wrapper_profile_ref) || null,
          }
        : null,
  };
}

/**
 * @param {Record<string, unknown>} discoveryResearch
 * @returns {Record<string, unknown>}
 */
function summarizeDiscoveryResearch(discoveryResearch) {
  const researchInputs = asRecord(discoveryResearch.research_inputs);
  return {
    status: asNonEmptyString(discoveryResearch.status) || null,
    adr_ready: discoveryResearch.adr_ready === true || asNonEmptyString(discoveryResearch.status) === "adr-ready",
    source_ref_count: asStringArray(researchInputs.source_refs).length,
    open_question_count: Array.isArray(discoveryResearch.open_questions)
      ? discoveryResearch.open_questions.length
      : 0,
    recommendation_count: Array.isArray(discoveryResearch.adr_ready_recommendations)
      ? discoveryResearch.adr_ready_recommendations.length
      : 0,
  };
}

/**
 * @param {{ artifacts: Record<string, unknown> }} options
 * @returns {Record<string, unknown>}
 */
export function buildArtifactReadinessProof(options) {
  const artifacts = options.artifacts;
  const snapshots = Array.isArray(artifacts.artifact_readiness_snapshots)
    ? artifacts.artifact_readiness_snapshots.map((entry) => asRecord(entry))
    : [];
  const seenSnapshotCheckpoints = new Set();
  const readinessSnapshots = snapshots
    .filter((snapshot) => {
      const checkpoint = asNonEmptyString(snapshot.checkpoint);
      if (!checkpoint) return true;
      if (seenSnapshotCheckpoints.has(checkpoint)) return false;
      seenSnapshotCheckpoints.add(checkpoint);
      return true;
    })
    .map((snapshot) => summarizeArtifactReadinessSnapshot(snapshot));
  const generatedProfileFile = asNonEmptyString(artifacts.generated_project_profile_file);
  const projectProfile = readYamlIfPresent(generatedProfileFile);
  const analysisReportFile =
    asNonEmptyString(artifacts.analysis_report_file) ||
    asNonEmptyString(artifacts.discovery_analysis_report_file);
  const analysisReport = readJsonIfPresent(analysisReportFile);
  const specStepResultFile = asNonEmptyString(artifacts.spec_step_result_file);
  const specStepResult = readJsonIfPresent(specStepResultFile);
  const discoveryResearchReportFile = asNonEmptyString(artifacts.discovery_research_report_file);
  const discoveryResearchReport = readJsonIfPresent(discoveryResearchReportFile);
  const promptLineageSteps = ARTIFACT_LINEAGE_STEPS.map((step) =>
    summarizePromptLineageStep({
      step,
      profile: projectProfile,
      analysisReport,
      specStepResult,
    }),
  );
  const evidenceRefs = uniqueStrings([
    ...readinessSnapshots.flatMap((snapshot) => asStringArray(snapshot.evidence_refs)),
    generatedProfileFile,
    analysisReportFile,
    discoveryResearchReportFile,
    specStepResultFile,
    asNonEmptyString(artifacts.wave_ticket_file),
    asNonEmptyString(artifacts.handoff_packet_file),
  ]);
  const hasReadiness = readinessSnapshots.length > 0;
  const hasPromptRefs = promptLineageSteps.some((entry) =>
    asNonEmptyString(entry.profile_prompt_bundle_ref) ||
    asNonEmptyString(entry.analysis_prompt_bundle_ref) ||
    asNonEmptyString(entry.compiled_context_prompt_bundle_ref),
  );
  return {
    proof_status: hasReadiness && hasPromptRefs ? "available" : hasReadiness || hasPromptRefs ? "partial" : "missing",
    summary:
      hasReadiness && hasPromptRefs
        ? "Artifact readiness snapshots and prompt lineage are available from public AOR reports."
        : "Artifact readiness proof is incomplete; inspect missing source refs before using this run for W44 acceptance.",
    next_action_report_files: uniqueStrings([
      ...asStringArray(artifacts.next_action_report_files),
      ...readinessSnapshots.map((snapshot) => asNonEmptyString(snapshot.next_action_report_file)),
    ]),
    readiness_snapshots: readinessSnapshots,
    prompt_lineage: {
      generated_project_profile_file: generatedProfileFile || null,
      analysis_report_file: analysisReportFile || null,
      spec_step_result_file: specStepResultFile || null,
      steps: promptLineageSteps,
    },
    discovery_research: {
      report_file: discoveryResearchReportFile || null,
      ...summarizeDiscoveryResearch(discoveryResearchReport),
    },
    planning: {
      wave_ticket_file: asNonEmptyString(artifacts.wave_ticket_file) || null,
      handoff_packet_file: asNonEmptyString(artifacts.handoff_packet_file) || null,
      handoff_status: asNonEmptyString(artifacts.handoff_status) || null,
    },
    evidence_refs: evidenceRefs,
  };
}

/**
 * @param {string | null} filePath
 * @returns {Record<string, unknown>}
 */
function summarizeDeliveryManifest(filePath) {
  const manifestFile = asNonEmptyString(filePath) || null;
  const manifest = readJsonIfPresent(manifestFile);
  const repoDeliveries = Array.isArray(manifest.repo_deliveries)
    ? manifest.repo_deliveries.map((entry) => asRecord(entry))
    : [];
  const summarizedDeliveries = repoDeliveries.map((entry) => {
    const changedPaths = asStringArray(entry.changed_paths);
    const commitRefs = asStringArray(entry.commit_refs);
    return {
      repo_id: asNonEmptyString(entry.repo_id) || null,
      role: asNonEmptyString(entry.role) || null,
      delivery_mode: asNonEmptyString(entry.delivery_mode) || asNonEmptyString(manifest.delivery_mode) || null,
      writeback_result: asNonEmptyString(entry.writeback_result) || null,
      changed_path_count: changedPaths.length,
      changed_paths: changedPaths,
      commit_ref_count: commitRefs.length,
      commit_refs: commitRefs,
      pr_ref: asNonEmptyString(entry.pr_ref) || null,
      patch_file: asNonEmptyString(entry.patch_file) || null,
    };
  });
  const changedPaths = uniqueStrings(summarizedDeliveries.flatMap((entry) => asStringArray(entry.changed_paths)));
  const writebackResults = uniqueStrings(summarizedDeliveries.map((entry) => asNonEmptyString(entry.writeback_result)));
  const commitRefs = uniqueStrings(summarizedDeliveries.flatMap((entry) => asStringArray(entry.commit_refs)));
  const writebackPolicy = asRecord(manifest.writeback_policy);
  const deliveryMode = asNonEmptyString(manifest.delivery_mode) || null;
  const writeBackToRemote =
    typeof writebackPolicy.allow_remote_push === "boolean"
      ? writebackPolicy.allow_remote_push
      : deliveryMode === "patch-only"
        ? false
        : null;
  const patchOnly =
    deliveryMode === "patch-only" ||
    (writebackResults.length > 0 && writebackResults.every((result) => result.startsWith("patch-")));
  return {
    delivery_manifest_file: manifestFile,
    manifest_status: Object.keys(manifest).length > 0 ? "present" : "missing",
    delivery_mode: deliveryMode,
    patch_only: patchOnly,
    write_back_to_remote: writeBackToRemote,
    repo_count: summarizedDeliveries.length,
    changed_path_count: changedPaths.length,
    changed_paths: changedPaths,
    writeback_results: writebackResults,
    commit_ref_count: commitRefs.length,
    commit_refs: commitRefs,
    no_upstream_write_evidence: {
      status: patchOnly && writeBackToRemote === false ? "pass" : "not_proven",
      delivery_mode: deliveryMode,
      write_back_to_remote: writeBackToRemote,
      writeback_results: writebackResults,
      commit_ref_count: commitRefs.length,
    },
    repo_deliveries: summarizedDeliveries,
  };
}

/**
 * @param {{ artifacts: Record<string, unknown>, scorecardFile: string | null, handoffFile: string | null }} options
 * @returns {Record<string, unknown>}
 */
function summarizeLearningHandoff(options) {
  const scorecardFile = asNonEmptyString(options.scorecardFile) || null;
  const handoffFile = asNonEmptyString(options.handoffFile) || null;
  const scorecard = readJsonIfPresent(scorecardFile);
  const handoff = readJsonIfPresent(handoffFile);
  const scorecardCoverageFollowUp = asRecord(scorecard.coverage_follow_up);
  const handoffCoverageFollowUp = asRecord(handoff.coverage_follow_up);
  const coverageFollowUp =
    Object.keys(handoffCoverageFollowUp).length > 0
      ? handoffCoverageFollowUp
      : Object.keys(scorecardCoverageFollowUp).length > 0
        ? scorecardCoverageFollowUp
        : asRecord(options.artifacts.coverage_follow_up);
  const remainingRequiredCells = Array.isArray(coverageFollowUp.remaining_required_matrix_cells)
    ? coverageFollowUp.remaining_required_matrix_cells.map((entry) => asRecord(entry))
    : [];
  return {
    scorecard_file: scorecardFile,
    handoff_file: handoffFile,
    scorecard_status: asNonEmptyString(scorecard.status) || null,
    handoff_run_status: asNonEmptyString(handoff.run_status) || null,
    evidence_refs: uniqueStrings([
      scorecardFile,
      handoffFile,
      ...asStringArray(scorecard.evidence_refs),
      ...asStringArray(handoff.evidence_refs),
      asNonEmptyString(options.artifacts.new_flow_next_action_report_file),
    ]),
    backlog_refs: uniqueStrings([
      ...asStringArray(scorecard.linked_backlog_refs),
      ...asStringArray(handoff.backlog_refs),
    ]),
    quality_refs: uniqueStrings([
      ...asStringArray(scorecard.linked_eval_suite_refs),
      ...asStringArray(handoff.quality_refs),
    ]),
    next_actions: asStringArray(handoff.next_actions),
    coverage_follow_up: Object.keys(coverageFollowUp).length > 0 ? coverageFollowUp : null,
    next_required_matrix_cell:
      typeof coverageFollowUp.next_required_matrix_cell === "object" && coverageFollowUp.next_required_matrix_cell
        ? coverageFollowUp.next_required_matrix_cell
        : null,
    remaining_required_matrix_cell_count: remainingRequiredCells.length,
    remaining_required_matrix_cells: remainingRequiredCells,
    new_flow_next_action_report_file: asNonEmptyString(options.artifacts.new_flow_next_action_report_file) || null,
  };
}

/**
 * @param {Record<string, unknown>} controllerState
 * @param {string[]} includedSteps
 * @returns {boolean}
 */
function isLiveE2eControllerStateInProgress(controllerState, includedSteps) {
  const state = asRecord(controllerState);
  if (Object.keys(state).length === 0) return false;

  const completedSteps = new Set(asStringArray(state.completed_steps));
  const allIncludedStepsCompleted =
    includedSteps.length > 0 && includedSteps.every((step) => completedSteps.has(step));
  const hasCurrentStep = Boolean(asNonEmptyString(state.current_step));
  const pendingDecision = asRecord(state.pending_decision);
  const pendingAction = asNonEmptyString(pendingDecision.action);
  const terminalPendingContinue =
    pendingAction === "continue" && !hasCurrentStep && allIncludedStepsCompleted;
  const hasPendingDecision = Object.keys(pendingDecision).length > 0 && !terminalPendingContinue;
  return hasCurrentStep || hasPendingDecision || !allIncludedStepsCompleted;
}

/**
 * @param {string} reportsRoot
 * @param {string} fileName
 * @returns {string | null}
 */
function existingReportFile(reportsRoot, fileName) {
  const file = path.join(reportsRoot, fileName);
  return fileExists(file) ? file : null;
}

/**
 * @param {{ layout: { reportsRoot: string }, runId: string, profile: Record<string, unknown> }} options
 * @returns {Record<string, unknown> | null}
 */
function loadExistingTerminalProofRunnerArtifacts(options) {
  const normalizedRunId = normalizeId(options.runId);
  const summaryFile = existingReportFile(options.layout.reportsRoot, `live-e2e-run-summary-${normalizedRunId}.json`);
  if (!summaryFile) return null;
  const summary = readJsonIfPresent(summaryFile);
  if (asNonEmptyString(summary.status) !== "pass") return null;

  const runHealthReportFile =
    asNonEmptyString(summary.live_e2e_run_health_report_file) ||
    existingReportFile(options.layout.reportsRoot, `live-e2e-run-health-report-${normalizedRunId}.json`);
  const runHealthReport = readJsonIfPresent(runHealthReportFile);
  if (asNonEmptyString(runHealthReport.overall_status) !== "pass") return null;

  const observationReportFile =
    asNonEmptyString(summary.live_e2e_observation_report_file) ||
    existingReportFile(options.layout.reportsRoot, `live-e2e-observation-report-${normalizedRunId}.json`);
  const observationReport = readJsonIfPresent(observationReportFile);
  if (
    asNonEmptyString(observationReport.report_status) !== "final" ||
    toObservationStatus(asNonEmptyString(observationReport.overall_status)) !== "pass"
  ) {
    return null;
  }

  const controllerStateFile = asNonEmptyString(summary.live_e2e_controller_state_file);
  const controllerState = readJsonIfPresent(controllerStateFile);
  if (isLiveE2eControllerStateInProgress(controllerState, getIncludedStepsForProfile(options.profile))) return null;

  return {
    summary,
    summaryFile,
    runHealthReport,
    runHealthReportFile,
    observationReport,
    observationReportFile,
  };
}

/**
 * @param {{ runId: string, existing: Record<string, unknown> }} options
 */
function writeExistingProofRunnerOutput(options) {
  const summary = asRecord(options.existing.summary);
  const runHealthReport = asRecord(options.existing.runHealthReport);
  process.stdout.write(
    `${JSON.stringify(
      {
        command: "scripts live-e2e run-profile",
        status: "ok",
        run_id: options.runId,
        live_e2e_run_status: asNonEmptyString(summary.status) || null,
        live_e2e_run_health_status: asNonEmptyString(runHealthReport.overall_status) || null,
        live_e2e_run_summary_file: asNonEmptyString(options.existing.summaryFile) || null,
        live_e2e_run_health_report_file: asNonEmptyString(options.existing.runHealthReportFile) || null,
        run_control_state_file: asNonEmptyString(summary.run_control_state_file) || null,
        live_e2e_observation_report_file:
          asNonEmptyString(summary.live_e2e_observation_report_file) ||
          asNonEmptyString(options.existing.observationReportFile) ||
          null,
        aor_installation_proof_file: asNonEmptyString(summary.aor_installation_proof_file) || null,
        live_e2e_controller_state_file: asNonEmptyString(summary.live_e2e_controller_state_file) || null,
        live_e2e_step_observation_files: asStringArray(summary.live_e2e_step_observation_files),
        live_e2e_step_quality_assessment_request_files: asStringArray(
          summary.live_e2e_step_quality_assessment_request_files,
        ),
        live_e2e_step_quality_assessment_report_files: asStringArray(
          summary.live_e2e_step_quality_assessment_report_files,
        ),
        live_e2e_scorecard_files: asStringArray(summary.scorecard_files),
        learning_loop_scorecard_file: asNonEmptyString(summary.learning_loop_scorecard_file) || null,
        learning_loop_handoff_file: asNonEmptyString(summary.learning_loop_handoff_file) || null,
        incident_report_file: asNonEmptyString(summary.incident_report_file) || null,
      },
      null,
      2,
    )}\n`,
  );
}

/**
 * Guided AOR UI smoke files are deterministic report artifacts. Manual resume
 * can rebuild final reports from durable controller state after those transient
 * artifact fields have been dropped, so hydrate them before observation and
 * run-health reports are written.
 *
 * @param {Record<string, unknown>} artifacts
 * @param {{ reportsRoot: string, runId: string }} options
 */
function hydrateGuidedUiArtifactGroup(artifacts, options) {
  const keys = guidedUiArtifactKeys(options.scope);
  const normalizedRunId = normalizeId(options.runId);
  const webSmokeSummaryFile =
    asNonEmptyString(artifacts[keys.summaryFile]) ||
    existingReportFile(options.reportsRoot, `installed-user-guided-web-smoke-${normalizedRunId}.json`);
  const webSmoke =
    Object.keys(asRecord(artifacts[keys.webSmoke])).length > 0
      ? asRecord(artifacts[keys.webSmoke])
      : readJsonIfPresent(webSmokeSummaryFile);
  if (webSmokeSummaryFile) artifacts[keys.summaryFile] = webSmokeSummaryFile;
  if (Object.keys(webSmoke).length > 0) {
    artifacts[keys.webSmoke] = webSmoke;
  }
  const htmlFile =
    asNonEmptyString(artifacts[keys.htmlFile]) ||
    asNonEmptyString(webSmoke.rendered_html_file) ||
    asNonEmptyString(webSmoke.html_ref) ||
    existingReportFile(options.reportsRoot, `installed-user-guided-web-smoke-${normalizedRunId}.html`);
  const domSnapshotFile =
    asNonEmptyString(artifacts[keys.domSnapshotFile]) ||
    asNonEmptyString(webSmoke.dom_snapshot_file) ||
    asNonEmptyString(webSmoke.dom_snapshot_ref) ||
    existingReportFile(options.reportsRoot, `installed-user-guided-web-smoke-dom-${normalizedRunId}.json`);
  const accessibilitySummaryFile =
    asNonEmptyString(artifacts[keys.accessibilitySummaryFile]) ||
    asNonEmptyString(webSmoke.accessibility_summary_file) ||
    asNonEmptyString(webSmoke.accessibility_summary_ref) ||
    existingReportFile(options.reportsRoot, `installed-user-guided-web-smoke-accessibility-${normalizedRunId}.json`);
  const visualGuardrailFile =
    asNonEmptyString(artifacts[keys.visualGuardrailFile]) ||
    asNonEmptyString(webSmoke.visual_guardrail_file) ||
    existingReportFile(options.reportsRoot, `installed-user-guided-web-smoke-visual-guardrail-${normalizedRunId}.json`);
  const browserTaskProofRequestFile =
    asNonEmptyString(artifacts[keys.browserTaskProofRequestFile]) ||
    asNonEmptyString(webSmoke.browser_task_proof_request_file) ||
    existingReportFile(options.reportsRoot, `installed-user-guided-browser-task-proof-request-${normalizedRunId}.json`);
  const browserTaskProofFile =
    asNonEmptyString(artifacts[keys.browserTaskProofFile]) ||
    asNonEmptyString(webSmoke.browser_task_proof_file) ||
    existingReportFile(options.reportsRoot, `installed-user-guided-browser-task-proof-${normalizedRunId}.json`);

  if (htmlFile) artifacts[keys.htmlFile] = htmlFile;
  if (domSnapshotFile) artifacts[keys.domSnapshotFile] = domSnapshotFile;
  if (accessibilitySummaryFile) artifacts[keys.accessibilitySummaryFile] = accessibilitySummaryFile;
  if (visualGuardrailFile) artifacts[keys.visualGuardrailFile] = visualGuardrailFile;
  if (browserTaskProofRequestFile) artifacts[keys.browserTaskProofRequestFile] = browserTaskProofRequestFile;
  if (browserTaskProofFile) artifacts[keys.browserTaskProofFile] = browserTaskProofFile;

  const scopedArtifacts = buildScopedGuidedUiArtifacts(artifacts, options.scope);
  const mergedWebSmoke = mergeBrowserTaskProofIntoWebSmoke(scopedArtifacts, asRecord(artifacts[keys.webSmoke]));
  if (Object.keys(mergedWebSmoke).length > 0) {
    artifacts[keys.webSmoke] = mergedWebSmoke;
    if (webSmokeSummaryFile) writeJson(webSmokeSummaryFile, mergedWebSmoke);
  }
}

function hydrateGuidedUiArtifactsFromReports(artifacts, options) {
  hydrateGuidedUiArtifactGroup(artifacts, {
    ...options,
    scope: "guided",
    runId: options.runId,
  });
  hydrateGuidedUiArtifactGroup(artifacts, {
    ...options,
    scope: "early",
    runId: `${options.runId}.early-ui`,
  });
}

/**
 * @param {number} pid
 * @returns {boolean}
 */
function terminateDetachedProcessGroup(pid) {
  if (process.platform === "win32" || !Number.isInteger(pid) || pid <= 0) return false;
  for (const target of [-pid, pid]) {
    try {
      process.kill(target, "SIGTERM");
      return true;
    } catch {
      // Try the direct child PID when process group termination is unavailable.
    }
  }
  return false;
}

/**
 * @param {Record<string, unknown>} artifacts
 * @param {Record<string, unknown>} runHealthReport
 * @returns {Record<string, unknown> | null}
 */
function cleanupGuidedBrowserTaskAppSurface(artifacts, runHealthReport) {
  const lifecycle = asRecord(runHealthReport.lifecycle_completion);
  if (asNonEmptyString(lifecycle.continuation_status) !== "complete") return null;
  const webSmoke = asRecord(artifacts.guided_web_smoke);
  const rawPid =
    artifacts.guided_browser_task_app_server_pid ??
    webSmoke.browser_task_app_server_pid ??
    webSmoke.app_server_pid;
  const pid = typeof rawPid === "number" ? rawPid : Number(rawPid);
  if (!Number.isInteger(pid) || pid <= 0) return null;
  const terminated = terminateDetachedProcessGroup(pid);
  return {
    status: terminated ? "terminated" : "not_running",
    pid,
    terminated_at: nowIso(),
  };
}

/**
 * @param {Record<string, unknown>} artifacts
 * @param {Record<string, unknown>} webSmoke
 * @returns {string}
 */
function resolveBrowserTaskProofFile(artifacts, webSmoke) {
  const directProofFile =
    asNonEmptyString(artifacts.guided_browser_task_proof_file) ||
    asNonEmptyString(webSmoke.browser_task_proof_file);
  if (directProofFile && fileExists(directProofFile)) return directProofFile;
  const requestFile =
    asNonEmptyString(artifacts.guided_browser_task_proof_request_file) ||
    asNonEmptyString(webSmoke.browser_task_proof_request_file);
  const request = readJsonIfPresent(requestFile);
  const expectedProofFile = asNonEmptyString(request.expected_browser_task_proof_file);
  return expectedProofFile && fileExists(expectedProofFile) ? expectedProofFile : directProofFile;
}

/**
 * @param {unknown} value
 * @param {string[]} fallbackEvidenceRefs
 * @returns {Array<{ check_id: string, status: string, evidence_refs: string[], findings: string[] }>}
 */
function normalizeAorOperatorAccessibilityChecks(value, fallbackEvidenceRefs = []) {
  const rawEntries = Array.isArray(value) ? value.map((entry) => asRecord(entry)) : [];
  return rawEntries
    .map((entry) => ({
      check_id: asNonEmptyString(entry.check_id) || asNonEmptyString(entry.id) || asNonEmptyString(entry.key),
      status: toObservationStatus(asNonEmptyString(entry.status) || "not_pass"),
      evidence_refs: uniqueStrings([...asStringArray(entry.evidence_refs), asNonEmptyString(entry.evidence_ref)]),
      findings: asStringArray(entry.findings),
    }))
    .filter((entry) => AOR_OPERATOR_ACCESSIBILITY_CHECK_IDS.includes(entry.check_id))
    .map((entry) => ({
      ...entry,
      evidence_refs: entry.evidence_refs.length > 0 ? entry.evidence_refs : uniqueStrings(fallbackEvidenceRefs),
    }));
}

/**
 * @param {unknown} value
 * @param {string[]} fallbackEvidenceRefs
 * @returns {Array<{ check_id: string, status: string, evidence_refs: string[], findings: string[] }>}
 */
function buildAorOperatorAccessibilityChecks(value, fallbackEvidenceRefs = []) {
  const normalized = normalizeAorOperatorAccessibilityChecks(value, fallbackEvidenceRefs);
  const byId = new Map(normalized.map((entry) => [entry.check_id, entry]));
  return AOR_OPERATOR_ACCESSIBILITY_CHECK_IDS.map((checkId) => {
    const existing = byId.get(checkId);
    if (existing) return existing;
    return {
      check_id: checkId,
      status: "not_pass",
      evidence_refs: [],
      findings: [`AOR operator accessibility check '${checkId}' was not materialized in browser-task proof.`],
    };
  });
}

/**
 * @param {unknown} value
 * @returns {Array<{ index: number, role: string | null, label: string | null, selector: string | null, tag_name: string | null }>}
 */
function normalizeKeyboardFocusSequence(value) {
  const entries = Array.isArray(value) ? value.map((entry) => asRecord(entry)) : [];
  return entries
    .map((entry, index) => ({
      index: Number.isFinite(Number(entry.index)) ? Number(entry.index) : index + 1,
      role: asNonEmptyString(entry.role) || null,
      label: asNonEmptyString(entry.label) || asNonEmptyString(entry.accessible_name) || asNonEmptyString(entry.text) || null,
      selector: asNonEmptyString(entry.selector) || null,
      tag_name: asNonEmptyString(entry.tag_name) || asNonEmptyString(entry.tagName) || null,
    }))
    .filter((entry) => entry.role || entry.label || entry.selector || entry.tag_name);
}

/**
 * @param {Record<string, unknown>} proof
 * @returns {string[]}
 */
function findAorOperatorAccessibilityCheckGaps(proof) {
  const checks = normalizeAorOperatorAccessibilityChecks(proof.accessibility_checks);
  const byId = new Map(checks.map((entry) => [entry.check_id, entry]));
  const gaps = AOR_OPERATOR_ACCESSIBILITY_CHECK_IDS.flatMap((checkId) => {
    const entry = byId.get(checkId);
    if (!entry) return [`browser-task-proof.accessibility_checks.${checkId}`];
    const checkGaps = [];
    if (entry.evidence_refs.length === 0) {
      checkGaps.push(`browser-task-proof.accessibility_checks.${checkId}.evidence_refs`);
    }
    if (entry.status !== "pass") {
      checkGaps.push(`browser-task-proof.accessibility_checks.${checkId}.status`);
    }
    return checkGaps;
  });
  const keyboardNavigation = asRecord(proof.keyboard_navigation);
  const keyboardFocusSequence = normalizeKeyboardFocusSequence(
    Array.isArray(proof.keyboard_focus_sequence) ? proof.keyboard_focus_sequence : keyboardNavigation.focus_sequence,
  );
  const distinctFocusTargets = new Set(
    keyboardFocusSequence.map((entry) => entry.selector || entry.label || `${entry.role ?? ""}:${entry.tag_name ?? ""}`),
  );
  if (keyboardFocusSequence.length < 2 || distinctFocusTargets.size < 2) {
    gaps.push("browser-task-proof.keyboard_focus_sequence");
  }
  return gaps;
}

/**
 * @param {Record<string, unknown>} artifacts
 * @param {Record<string, unknown>} webSmoke
 * @returns {Record<string, unknown>}
 */
function mergeBrowserTaskProofIntoWebSmoke(artifacts, webSmoke) {
  const browserTaskProofFile = resolveBrowserTaskProofFile(artifacts, webSmoke);
  if (!browserTaskProofFile || !fileExists(browserTaskProofFile)) return webSmoke;
  const proof = readJsonIfPresent(browserTaskProofFile);
  const proofOutcome = asRecord(proof.task_outcome);
  const proofStatus = asNonEmptyString(proofOutcome.status) || asNonEmptyString(proof.status);
  const screenshotFiles = uniqueStrings([
    ...asStringArray(webSmoke.screenshot_files),
    ...asStringArray(proof.screenshot_files),
    ...asStringArray(proof.screenshot_refs),
  ]);
  const proofHasVisualEvidence = screenshotFiles.length > 0 || Boolean(asNonEmptyString(proof.visual_guardrail_file));
  const proofPasses = (proofStatus === "pass" || proofStatus === "warn") && proofHasVisualEvidence;
  if (!proofPasses) return { ...webSmoke, browser_task_proof_file: browserTaskProofFile };
  const keyboardNavigation = asRecord(proof.keyboard_navigation);
  const keyboardFocusSequence = normalizeKeyboardFocusSequence(
    Array.isArray(proof.keyboard_focus_sequence) ? proof.keyboard_focus_sequence : keyboardNavigation.focus_sequence,
  );
  const proofEvidenceRefs = uniqueStrings([
    browserTaskProofFile,
    asNonEmptyString(proof.accessibility_summary_file),
    asNonEmptyString(proof.accessibility_summary_ref),
    asNonEmptyString(webSmoke.accessibility_summary_file),
    ...screenshotFiles,
  ]);
  const retainedWebSmokeUxFindings = asStringArray(webSmoke.ux_findings).filter(
    (finding) => !/browser-task-proof requires skill-agent browser evidence/iu.test(finding),
  );
  return {
    ...webSmoke,
    rendered_html_file:
      asNonEmptyString(proof.rendered_html_file) ||
      asNonEmptyString(proof.html_ref) ||
      asNonEmptyString(webSmoke.rendered_html_file),
    html_ref:
      asNonEmptyString(proof.html_ref) ||
      asNonEmptyString(proof.rendered_html_file) ||
      asNonEmptyString(webSmoke.html_ref),
    dom_snapshot_file:
      asNonEmptyString(proof.dom_snapshot_file) ||
      asNonEmptyString(proof.dom_snapshot_ref) ||
      asNonEmptyString(webSmoke.dom_snapshot_file),
    dom_snapshot_ref:
      asNonEmptyString(proof.dom_snapshot_ref) ||
      asNonEmptyString(proof.dom_snapshot_file) ||
      asNonEmptyString(webSmoke.dom_snapshot_ref),
    accessibility_summary_file:
      asNonEmptyString(proof.accessibility_summary_file) ||
      asNonEmptyString(proof.accessibility_summary_ref) ||
      asNonEmptyString(webSmoke.accessibility_summary_file),
    accessibility_summary_ref:
      asNonEmptyString(proof.accessibility_summary_ref) ||
      asNonEmptyString(proof.accessibility_summary_file) ||
      asNonEmptyString(webSmoke.accessibility_summary_ref),
    visual_guardrail_file:
      asNonEmptyString(proof.visual_guardrail_file) ||
      asNonEmptyString(webSmoke.visual_guardrail_file),
    browser_task_proof_file: browserTaskProofFile,
    screenshot_files: screenshotFiles,
    screenshot_refs: screenshotFiles,
    keyboard_focus_sequence: keyboardFocusSequence,
    accessibility_checks: buildAorOperatorAccessibilityChecks(proof.accessibility_checks, proofEvidenceRefs),
    task_outcome: {
      status: "pass",
      checked_tasks: uniqueStrings([
        ...asStringArray(asRecord(webSmoke.task_outcome).checked_tasks),
        ...asStringArray(proofOutcome.checked_tasks),
      ]),
      findings: asStringArray(proofOutcome.findings),
    },
    ux_findings: uniqueStrings([...retainedWebSmokeUxFindings, ...asStringArray(proof.ux_findings)]),
    operator_decision_ref:
      asNonEmptyString(proof.operator_decision_ref) ||
      asNonEmptyString(webSmoke.operator_decision_ref),
  };
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
  const targetReadiness = buildTargetReadiness(options.flowResult.artifacts);
  const failureFields = resolveTopLevelFailureFields(options.flowResult.artifacts, targetReadiness);
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
    mission_class: options.flowResult.artifacts.mission_class ?? null,
    run_tier: asNonEmptyString(options.flowResult.artifacts.run_tier) || resolveSummaryRunTier(options.profile),
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
    run_health_report_file: asNonEmptyString(options.flowResult.artifacts.live_e2e_run_health_report_file) || null,
    live_e2e_observation_report_file:
      asNonEmptyString(options.flowResult.artifacts.live_e2e_observation_report_file) || null,
    provider_execution_status: asNonEmptyString(options.flowResult.artifacts.provider_execution_status) || null,
    provider_step_status:
      typeof options.flowResult.artifacts.provider_step_status === "object" && options.flowResult.artifacts.provider_step_status
        ? options.flowResult.artifacts.provider_step_status
        : null,
    baseline_verify_status: asNonEmptyString(options.flowResult.artifacts.baseline_verify_status) || null,
    target_readiness: targetReadiness,
    target_pre_execution_status:
      typeof options.flowResult.artifacts.target_pre_execution_status === "object" &&
      options.flowResult.artifacts.target_pre_execution_status
        ? options.flowResult.artifacts.target_pre_execution_status
        : null,
    target_toolchain_preflight_file: asNonEmptyString(options.flowResult.artifacts.target_toolchain_preflight_file) || null,
    failure_owner: failureFields.owner,
    failure_phase: failureFields.phase,
    failure_class: failureFields.class,
    post_run_verify_status: asNonEmptyString(options.flowResult.artifacts.post_run_verify_status) || null,
    post_run_diagnostic_status: asNonEmptyString(options.flowResult.artifacts.post_run_diagnostic_status) || null,
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
  if (step === "planning") return ["plan-create", "wave-create", "handoff-prepare"];
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
 * @param {"guided" | "early"} scope
 * @returns {Record<string, string>}
 */
function guidedUiArtifactKeys(scope) {
  if (scope === "early") {
    return {
      webSmoke: "early_guided_web_smoke",
      summaryFile: "early_guided_web_smoke_summary_file",
      htmlFile: "early_guided_web_smoke_html_file",
      domSnapshotFile: "early_guided_web_dom_snapshot_file",
      accessibilitySummaryFile: "early_guided_web_accessibility_summary_file",
      visualGuardrailFile: "early_guided_web_visual_guardrail_file",
      screenshotFiles: "early_guided_web_screenshot_files",
      browserTaskProofRequestFile: "early_guided_browser_task_proof_request_file",
      browserTaskProofFile: "early_guided_browser_task_proof_file",
    };
  }
  return {
    webSmoke: "guided_web_smoke",
    summaryFile: "guided_web_smoke_summary_file",
    htmlFile: "guided_web_smoke_html_file",
    domSnapshotFile: "guided_web_dom_snapshot_file",
    accessibilitySummaryFile: "guided_web_accessibility_summary_file",
    visualGuardrailFile: "guided_web_visual_guardrail_file",
    screenshotFiles: "guided_web_screenshot_files",
    browserTaskProofRequestFile: "guided_browser_task_proof_request_file",
    browserTaskProofFile: "guided_browser_task_proof_file",
  };
}

/**
 * @param {Record<string, unknown>} artifacts
 * @param {"guided" | "early"} scope
 * @returns {Record<string, unknown>}
 */
function buildScopedGuidedUiArtifacts(artifacts, scope) {
  if (scope === "guided") return artifacts;
  const keys = guidedUiArtifactKeys(scope);
  return {
    ...artifacts,
    guided_web_smoke: artifacts[keys.webSmoke],
    guided_web_smoke_summary_file: artifacts[keys.summaryFile],
    guided_web_smoke_html_file: artifacts[keys.htmlFile],
    guided_web_dom_snapshot_file: artifacts[keys.domSnapshotFile],
    guided_web_accessibility_summary_file: artifacts[keys.accessibilitySummaryFile],
    guided_web_visual_guardrail_file: artifacts[keys.visualGuardrailFile],
    guided_web_screenshot_files: artifacts[keys.screenshotFiles],
    guided_browser_task_proof_request_file: artifacts[keys.browserTaskProofRequestFile],
    guided_browser_task_proof_file: artifacts[keys.browserTaskProofFile],
  };
}

/**
 * @param {{
 *   artifacts: Record<string, unknown>,
 *   stepJournal: Array<Record<string, unknown>>,
 *   scope: "guided" | "early",
 *   stepId: string,
 *   interactionId: string,
 *   requireOperatorDecision: boolean,
 *   summary: string,
 * }} options
 * @returns {Record<string, unknown> | null}
 */
function buildGuidedWebSmokeInteraction(options) {
  const keys = guidedUiArtifactKeys(options.scope);
  const scopedArtifacts = buildScopedGuidedUiArtifacts(options.artifacts, options.scope);
  const webSmoke = mergeBrowserTaskProofIntoWebSmoke(scopedArtifacts, asRecord(options.artifacts[keys.webSmoke]));
  const summaryFile =
    asNonEmptyString(options.artifacts[keys.summaryFile]) ||
    asNonEmptyString(webSmoke.summary_file);
  const htmlFile =
    asNonEmptyString(webSmoke.rendered_html_file) ||
    asNonEmptyString(options.artifacts[keys.htmlFile]);
  const domSnapshotFile =
    asNonEmptyString(webSmoke.dom_snapshot_file) ||
    asNonEmptyString(options.artifacts[keys.domSnapshotFile]);
  const accessibilitySummaryFile =
    asNonEmptyString(webSmoke.accessibility_summary_file) ||
    asNonEmptyString(options.artifacts[keys.accessibilitySummaryFile]);
  const visualGuardrailFile =
    asNonEmptyString(webSmoke.visual_guardrail_file) ||
    asNonEmptyString(options.artifacts[keys.visualGuardrailFile]);
  const browserTaskProofRequestFile =
    asNonEmptyString(options.artifacts[keys.browserTaskProofRequestFile]) ||
    asNonEmptyString(webSmoke.browser_task_proof_request_file);
  const browserTaskProofFile =
    asNonEmptyString(webSmoke.browser_task_proof_file) ||
    asNonEmptyString(options.artifacts[keys.browserTaskProofFile]);
  const screenshotRefs = uniqueStrings([
    ...asStringArray(options.artifacts[keys.screenshotFiles]),
    ...asStringArray(webSmoke.screenshot_files),
    ...asStringArray(webSmoke.screenshot_refs),
  ]);
  const accessibilityChecks = buildAorOperatorAccessibilityChecks(webSmoke.accessibility_checks, [
    accessibilitySummaryFile,
    browserTaskProofFile,
    ...screenshotRefs,
  ]);
  if (
    !summaryFile &&
    !htmlFile &&
    !domSnapshotFile &&
    !visualGuardrailFile &&
    !browserTaskProofFile &&
    screenshotRefs.length === 0
  ) return null;
  const taskOutcome = asRecord(webSmoke.task_outcome);
  const status = toObservationStatus(asNonEmptyString(taskOutcome.status) || "pass");
  const learningVerdict = options.requireOperatorDecision
    ? options.stepJournal.find(
        (entry) =>
          asNonEmptyString(asRecord(entry).step_id) === "learning" &&
          asNonEmptyString(asRecord(entry).operator_decision_status) === "accepted" &&
          asNonEmptyString(asRecord(asRecord(entry).semantic_analysis).judge_source) === "skill-agent",
      )
    : null;
  const operatorDecisionRef =
    asNonEmptyString(webSmoke.operator_decision_ref) ||
    asNonEmptyString(asRecord(learningVerdict).operator_decision_ref) ||
    null;
  const interactionStatus = options.requireOperatorDecision ? (operatorDecisionRef ? status : "blocked") : status;
  return {
    step_id: options.stepId,
    interaction_id: options.interactionId,
    surface: "web",
    evidence_refs: uniqueStrings([
      summaryFile,
      htmlFile,
      domSnapshotFile,
      accessibilitySummaryFile,
      visualGuardrailFile,
      browserTaskProofRequestFile,
      browserTaskProofFile,
      ...screenshotRefs,
    ]),
    html_ref: htmlFile || asNonEmptyString(webSmoke.html_ref) || null,
    screenshot_refs: screenshotRefs,
    keyboard_focus_sequence: normalizeKeyboardFocusSequence(webSmoke.keyboard_focus_sequence),
    visual_guardrail_refs: uniqueStrings([visualGuardrailFile]),
    browser_task_proof_ref: browserTaskProofFile || null,
    dom_snapshot_ref: domSnapshotFile || asNonEmptyString(webSmoke.dom_snapshot_ref) || null,
    accessibility_summary_ref: accessibilitySummaryFile || asNonEmptyString(webSmoke.accessibility_summary_ref) || null,
    accessibility_checks: accessibilityChecks,
    task_outcome: {
      status,
      checked_tasks: asStringArray(taskOutcome.checked_tasks),
      findings: asStringArray(taskOutcome.findings),
    },
    ux_findings: asStringArray(webSmoke.ux_findings),
    operator_decision_ref: operatorDecisionRef,
    status: interactionStatus,
    summary: options.summary,
  };
}

/**
 * @param {Record<string, unknown>} artifacts
 * @param {Array<Record<string, unknown>>} stepJournal
 * @returns {Array<Record<string, unknown>>}
 */
function buildFrontendInteractions(artifacts, stepJournal = []) {
  return [
    buildGuidedWebSmokeInteraction({
      artifacts,
      stepJournal,
      scope: "early",
      stepId: "mission",
      interactionId: "early-guided-ui-proof",
      requireOperatorDecision: false,
      summary: "Early guided AOR operator UI proof collected before the implementation loop.",
    }),
    buildGuidedWebSmokeInteraction({
      artifacts,
      stepJournal,
      scope: "guided",
      stepId: "learning",
      interactionId: "guided-web-smoke",
      requireOperatorDecision: true,
      summary: "Guided AOR operator UI interaction completed through the installed-user web surface.",
    }),
  ].filter(Boolean);
}

/**
 * @param {{
 *   profile: Record<string, unknown>,
 *   artifacts: Record<string, unknown>,
 *   frontendInteractions?: Array<Record<string, unknown>>,
 * }} options
 * @returns {Record<string, unknown>}
 */
function buildGuidedUiEvidence(options) {
  const required = expectsGuidedBrowserTaskProof(options.profile, options.artifacts);
  const webSmoke = mergeBrowserTaskProofIntoWebSmoke(options.artifacts, asRecord(options.artifacts.guided_web_smoke));
  const earlyKeys = guidedUiArtifactKeys("early");
  const earlyScopedArtifacts = buildScopedGuidedUiArtifacts(options.artifacts, "early");
  const earlyWebSmoke = mergeBrowserTaskProofIntoWebSmoke(
    earlyScopedArtifacts,
    asRecord(options.artifacts[earlyKeys.webSmoke]),
  );
  const frontendInteractions = Array.isArray(options.frontendInteractions)
    ? options.frontendInteractions.map((entry) => asRecord(entry))
    : [];
  const browserTaskProofFile =
    asNonEmptyString(options.artifacts.guided_browser_task_proof_file) ||
    asNonEmptyString(webSmoke.browser_task_proof_file);
  const browserTaskProofRequestFile =
    asNonEmptyString(options.artifacts.guided_browser_task_proof_request_file) ||
    asNonEmptyString(webSmoke.browser_task_proof_request_file);
  const renderedHtmlFile =
    asNonEmptyString(options.artifacts.guided_web_smoke_html_file) ||
    asNonEmptyString(webSmoke.rendered_html_file) ||
    asNonEmptyString(webSmoke.html_ref);
  const domSnapshotFile =
    asNonEmptyString(options.artifacts.guided_web_dom_snapshot_file) ||
    asNonEmptyString(webSmoke.dom_snapshot_file) ||
    asNonEmptyString(webSmoke.dom_snapshot_ref);
  const accessibilitySummaryFile =
    asNonEmptyString(options.artifacts.guided_web_accessibility_summary_file) ||
    asNonEmptyString(webSmoke.accessibility_summary_file) ||
    asNonEmptyString(webSmoke.accessibility_summary_ref);
  const visualGuardrailFile =
    asNonEmptyString(options.artifacts.guided_web_visual_guardrail_file) ||
    asNonEmptyString(webSmoke.visual_guardrail_file);
  const earlyBrowserTaskProofFile =
    asNonEmptyString(options.artifacts[earlyKeys.browserTaskProofFile]) ||
    asNonEmptyString(earlyWebSmoke.browser_task_proof_file);
  const earlyBrowserTaskProofRequestFile =
    asNonEmptyString(options.artifacts[earlyKeys.browserTaskProofRequestFile]) ||
    asNonEmptyString(earlyWebSmoke.browser_task_proof_request_file);
  const earlyRenderedHtmlFile =
    asNonEmptyString(options.artifacts[earlyKeys.htmlFile]) ||
    asNonEmptyString(earlyWebSmoke.rendered_html_file) ||
    asNonEmptyString(earlyWebSmoke.html_ref);
  const earlyDomSnapshotFile =
    asNonEmptyString(options.artifacts[earlyKeys.domSnapshotFile]) ||
    asNonEmptyString(earlyWebSmoke.dom_snapshot_file) ||
    asNonEmptyString(earlyWebSmoke.dom_snapshot_ref);
  const earlyAccessibilitySummaryFile =
    asNonEmptyString(options.artifacts[earlyKeys.accessibilitySummaryFile]) ||
    asNonEmptyString(earlyWebSmoke.accessibility_summary_file) ||
    asNonEmptyString(earlyWebSmoke.accessibility_summary_ref);
  const earlyVisualGuardrailFile =
    asNonEmptyString(options.artifacts[earlyKeys.visualGuardrailFile]) ||
    asNonEmptyString(earlyWebSmoke.visual_guardrail_file);
  const screenshotRefs = uniqueStrings([
    ...asStringArray(options.artifacts.guided_web_screenshot_files),
    ...asStringArray(webSmoke.screenshot_files),
    ...asStringArray(webSmoke.screenshot_refs),
  ]);
  const earlyScreenshotRefs = uniqueStrings([
    ...asStringArray(options.artifacts[earlyKeys.screenshotFiles]),
    ...asStringArray(earlyWebSmoke.screenshot_files),
    ...asStringArray(earlyWebSmoke.screenshot_refs),
  ]);
  const earlyEvidenceRefs = uniqueStrings([
    asNonEmptyString(options.artifacts[earlyKeys.summaryFile]),
    earlyRenderedHtmlFile,
    earlyDomSnapshotFile,
    earlyAccessibilitySummaryFile,
    earlyVisualGuardrailFile,
    earlyBrowserTaskProofRequestFile,
    earlyBrowserTaskProofFile,
    ...earlyScreenshotRefs,
  ]);
  const evidenceRefs = uniqueStrings([
    asNonEmptyString(options.artifacts.guided_web_smoke_summary_file),
    renderedHtmlFile,
    domSnapshotFile,
    accessibilitySummaryFile,
    visualGuardrailFile,
    browserTaskProofRequestFile,
    browserTaskProofFile,
    ...screenshotRefs,
    ...earlyEvidenceRefs,
    ...frontendInteractions.flatMap((entry) => asStringArray(entry.evidence_refs)),
  ]);
  const browserProofExists = Boolean(browserTaskProofFile && fileExists(browserTaskProofFile));
  const earlyBrowserProofExists = Boolean(earlyBrowserTaskProofFile && fileExists(earlyBrowserTaskProofFile));
  const proofGaps = required
    ? buildGuidedUiEvidenceGaps({
        profile: options.profile,
        artifacts: options.artifacts,
        observationReport: {
          frontend_interactions: frontendInteractions,
        },
      })
    : [];
  return {
    required,
    status: required ? (proofGaps.length === 0 ? "pass" : "blocked") : evidenceRefs.length > 0 ? "pass" : "not_requested",
    guided_web_smoke_summary_file: asNonEmptyString(options.artifacts.guided_web_smoke_summary_file) || null,
    guided_web_smoke_html_file: renderedHtmlFile || null,
    guided_web_dom_snapshot_file: domSnapshotFile || null,
    guided_web_accessibility_summary_file: accessibilitySummaryFile || null,
    guided_web_visual_guardrail_file: visualGuardrailFile || null,
    guided_browser_task_proof_request_file: browserTaskProofRequestFile || null,
    guided_browser_task_proof_file: browserTaskProofFile || null,
    browser_task_proof_present: browserProofExists,
    early_guided_web_smoke_summary_file: asNonEmptyString(options.artifacts[earlyKeys.summaryFile]) || null,
    early_guided_web_smoke_html_file: earlyRenderedHtmlFile || null,
    early_guided_web_dom_snapshot_file: earlyDomSnapshotFile || null,
    early_guided_web_accessibility_summary_file: earlyAccessibilitySummaryFile || null,
    early_guided_web_visual_guardrail_file: earlyVisualGuardrailFile || null,
    early_guided_browser_task_proof_request_file: earlyBrowserTaskProofRequestFile || null,
    early_guided_browser_task_proof_file: earlyBrowserTaskProofFile || null,
    early_browser_task_proof_present: earlyBrowserProofExists,
    early_screenshot_refs: earlyScreenshotRefs,
    early_keyboard_focus_sequence: earlyEvidenceRefs.length > 0
      ? normalizeKeyboardFocusSequence(earlyWebSmoke.keyboard_focus_sequence)
      : [],
    early_accessibility_checks: earlyEvidenceRefs.length > 0
      ? buildAorOperatorAccessibilityChecks(earlyWebSmoke.accessibility_checks, [
          earlyAccessibilitySummaryFile,
          earlyBrowserTaskProofFile,
          ...earlyScreenshotRefs,
        ])
      : [],
    early_evidence_refs: earlyEvidenceRefs,
    screenshot_refs: screenshotRefs,
    keyboard_focus_sequence: normalizeKeyboardFocusSequence(webSmoke.keyboard_focus_sequence),
    accessibility_checks: buildAorOperatorAccessibilityChecks(webSmoke.accessibility_checks, [
      accessibilitySummaryFile,
      browserTaskProofFile,
      ...screenshotRefs,
    ]),
    weak_evidence_refs: proofGaps,
    evidence_refs: evidenceRefs,
  };
}

/**
 * @param {Record<string, unknown>} profile
 * @param {Record<string, unknown>} artifacts
 * @returns {boolean}
 */
function expectsGuidedBrowserTaskProof(profile, artifacts) {
  const liveE2e = asRecord(profile.live_e2e);
  const guidedJourney = asRecord(profile.guided_journey);
  const browserTaskProof = asRecord(guidedJourney.browser_task_proof);
  return (
    asNonEmptyString(liveE2e.frontend_capability) === "browser-task-proof" ||
    asStringArray(guidedJourney.proof_requirements).includes("browser-task-proof") ||
    browserTaskProof.required === true ||
    Boolean(asNonEmptyString(artifacts.guided_browser_task_proof_request_file))
  );
}

/**
 * @param {{
 *   profile: Record<string, unknown>,
 *   artifacts: Record<string, unknown>,
 *   observationReport: Record<string, unknown>,
 * }} options
 * @returns {Array<string>}
 */
function buildGuidedUiEvidenceGaps(options) {
  if (!expectsGuidedBrowserTaskProof(options.profile, options.artifacts)) return [];
  const webSmoke = mergeBrowserTaskProofIntoWebSmoke(options.artifacts, asRecord(options.artifacts.guided_web_smoke));
  const gaps = [];
  const summaryFile =
    asNonEmptyString(options.artifacts.guided_web_smoke_summary_file) ||
    asNonEmptyString(webSmoke.summary_file);
  const browserTaskProofRequestFile =
    asNonEmptyString(options.artifacts.guided_browser_task_proof_request_file) ||
    asNonEmptyString(webSmoke.browser_task_proof_request_file);
  const browserTaskProofFile =
    asNonEmptyString(options.artifacts.guided_browser_task_proof_file) ||
    asNonEmptyString(webSmoke.browser_task_proof_file);
  const frontendInteractions = Array.isArray(options.observationReport.frontend_interactions)
    ? options.observationReport.frontend_interactions.map((entry) => asRecord(entry))
    : [];
  if (!summaryFile || !fileExists(summaryFile)) {
    gaps.push("guided-web-smoke-summary");
  }
  if (!browserTaskProofRequestFile || !fileExists(browserTaskProofRequestFile)) {
    gaps.push("guided-browser-task-proof-request");
  }
  if (!browserTaskProofFile || !fileExists(browserTaskProofFile)) {
    gaps.push("guided-browser-task-proof");
  } else {
    gaps.push(...findAorOperatorAccessibilityCheckGaps(readJsonIfPresent(browserTaskProofFile)));
  }
  const taskOutcome = asRecord(webSmoke.task_outcome);
  if (asNonEmptyString(taskOutcome.status) && asNonEmptyString(taskOutcome.status) !== "pass") {
    gaps.push("guided-web-smoke.task_outcome");
  }
  const fullGuidedInteraction = frontendInteractions.find(
    (interaction) => asNonEmptyString(interaction.interaction_id) === "guided-web-smoke",
  );
  if (!fullGuidedInteraction) {
    gaps.push("frontend_interactions.guided-web-smoke");
  }
  if (fullGuidedInteraction && asNonEmptyString(fullGuidedInteraction.status) !== "pass") {
    gaps.push("frontend_interactions.guided-web-smoke.status");
  }
  return uniqueStrings(gaps);
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
      status:
        asNonEmptyString(artifacts.project_init_transcript_file) ||
        asNonEmptyString(artifacts.generated_project_profile_file)
          ? "pass"
          : "not_pass",
      public_surface: "aor project init or bundled profile materialization",
      evidence_refs: uniqueStrings([
        asNonEmptyString(artifacts.project_init_transcript_file),
        asNonEmptyString(artifacts.generated_project_profile_file),
        asNonEmptyString(artifacts.bootstrap_artifact_packet_file),
        asNonEmptyString(artifacts.onboarding_report_file),
      ]),
      summary:
        asNonEmptyString(artifacts.project_init_transcript_file) ||
        asNonEmptyString(artifacts.generated_project_profile_file)
        ? "AOR project bootstrap evidence was materialized through public project init."
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
        asNonEmptyString(artifacts.target_toolchain_preflight_file),
        asNonEmptyString(artifacts.target_pre_execution_status_file),
        asNonEmptyString(artifacts.execution_readiness_file),
        asNonEmptyString(artifacts.live_adapter_preflight_file),
      ]),
      target_setup_status:
        typeof artifacts.target_setup_status === "object" && artifacts.target_setup_status
          ? artifacts.target_setup_status
          : null,
      target_verification_status:
        typeof artifacts.target_verification_status_detail === "object" && artifacts.target_verification_status_detail
          ? artifacts.target_verification_status_detail
          : null,
      failure_owner: asNonEmptyString(artifacts.failure_owner) || null,
      failure_phase: asNonEmptyString(artifacts.failure_phase) || null,
      failure_class: asNonEmptyString(artifacts.failure_class) || null,
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

function latestProviderStepStatusFromArtifacts(artifacts) {
  const candidates = [];
  const direct = asRecord(artifacts.provider_step_status);
  if (Object.keys(direct).length > 0) candidates.push(direct);

  const controllerEntries = Array.isArray(artifacts.live_e2e_step_journal_entries)
    ? artifacts.live_e2e_step_journal_entries.map((entry) => asRecord(entry))
    : [];
  for (let index = controllerEntries.length - 1; index >= 0; index -= 1) {
    const providerStepStatus = asRecord(controllerEntries[index].provider_step_status);
    if (Object.keys(providerStepStatus).length > 0) candidates.push(providerStepStatus);
  }

  const commandResults = Array.isArray(artifacts.command_results)
    ? artifacts.command_results.map((entry) => asRecord(entry))
    : [];
  for (let index = commandResults.length - 1; index >= 0; index -= 1) {
    const providerStepStatus = asRecord(commandResults[index].provider_step_status);
    if (Object.keys(providerStepStatus).length > 0) candidates.push(providerStepStatus);
  }

  candidates.sort((left, right) => providerStatusRank(right) - providerStatusRank(left));
  return candidates[0] ?? {};
}

function providerStatusRank(providerStepStatus) {
  const status = asNonEmptyString(asRecord(providerStepStatus).status);
  if (["failed", "fail", "completed", "complete", "pass", "succeeded", "interrupted"].includes(status)) return 3;
  if (["timeout", "timed-out", "timeout-risk"].includes(status)) return 2;
  if (["running", "silent-running"].includes(status)) return 1;
  return 0;
}

function isTransientProviderExecutionStatus(status) {
  return ["running", "silent-running", "timeout-risk"].includes(asNonEmptyString(status));
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function artifactValuePresent(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.length > 0;
  if (value && typeof value === "object") return Object.keys(asRecord(value)).length > 0;
  return value !== null && value !== undefined;
}

function classifyProviderStepStatus(providerStepStatus) {
  const status = asNonEmptyString(providerStepStatus.status);
  const interruptionOwner = asNonEmptyString(providerStepStatus.interruption_owner);
  const interruptionStatus = asNonEmptyString(providerStepStatus.interruption_status);
  const interruptionReason = asNonEmptyString(providerStepStatus.interruption_reason) ?? asNonEmptyString(providerStepStatus.recommended_action);
  if (!status || ["completed", "complete", "pass", "succeeded"].includes(status)) {
    return {
      provider_execution_status: status === "completed" || status === "complete" || status === "succeeded" ? "completed" : null,
      failure_owner: null,
      failure_phase: null,
      failure_class: null,
    };
  }

  if (status === "failed" || status === "fail") {
    return {
      provider_execution_status: "failed",
      failure_owner: "provider",
      failure_phase: "provider_execution",
      failure_class: "provider_failed",
    };
  }

  if (status === "interrupted") {
    const operatorStopped =
      interruptionOwner === "operator" ||
      interruptionStatus === "operator-stopped" ||
      /\boperator\b/iu.test(interruptionReason ?? "");
    return {
      provider_execution_status: "interrupted",
      failure_owner: operatorStopped ? "operator" : "provider",
      failure_phase: "provider_execution",
      failure_class: operatorStopped ? "operator_stopped" : "provider_blocked",
    };
  }

  if (["silent-running", "timeout-risk", "timeout", "timed-out"].includes(status)) {
    return {
      provider_execution_status: status === "timeout" || status === "timed-out" ? "timeout" : status,
      failure_owner: "provider",
      failure_phase: "provider_execution",
      failure_class: "provider_blocked",
    };
  }

  return {
    provider_execution_status: status,
    failure_owner: null,
    failure_phase: null,
    failure_class: null,
  };
}

function hydrateFlowArtifactsFromControllerState(artifacts) {
  const controllerStateFile = asNonEmptyString(artifacts.live_e2e_controller_state_file);
  const snapshot = asRecord(readJsonIfPresent(controllerStateFile)?.artifacts_snapshot);
  const copyIfMissing = (key) => {
    const current = artifacts[key];
    const candidate = snapshot[key];
    if (!artifactValuePresent(current) && artifactValuePresent(candidate)) {
      artifacts[key] = candidate;
    }
  };

  for (const key of [
    "target_checkout_root",
    "target_pre_execution_status_file",
    "target_pre_execution_status",
    "target_toolchain_preflight_file",
    "target_toolchain_preflight",
    "target_setup_status",
    "target_verification_status_detail",
    "failure_owner",
    "failure_phase",
    "failure_class",
    "baseline_verify_status",
    "baseline_verify_summary_file",
    "baseline_verify_gate_decision",
    "project_init_transcript_file",
    "execution_readiness_file",
    "target_cleanliness_before_execution_file",
    "target_cleanliness_before_execution",
    "feature_request_file",
    "intake_artifact_packet_file",
    "intake_artifact_packet_body_file",
    "analysis_report_file",
    "route_resolution_file",
    "asset_resolution_file",
    "policy_resolution_file",
    "evaluation_registry_file",
    "discovery_analysis_report_file",
    "discovery_research_report_file",
    "discovery_research_status",
    "discovery_research_adr_ready",
    "spec_step_result_file",
    "artifact_readiness_snapshots",
    "next_action_report_files",
    "next_action_report_file",
    "artifact_readiness_next_after_mission_report_file",
    "artifact_readiness_next_after_mission_transcript_file",
    "artifact_readiness_next_after_discovery_report_file",
    "artifact_readiness_next_after_discovery_transcript_file",
    "artifact_readiness_next_after_spec_report_file",
    "artifact_readiness_next_after_spec_transcript_file",
    "artifact_readiness_next_after_planning_report_file",
    "artifact_readiness_next_after_planning_transcript_file",
    "handoff_packet_file",
    "handoff_status",
    "approved_handoff_packet_file",
    "routed_step_result_file",
    "runtime_harness_report_file",
    "latest_runtime_harness_report_file",
    "delivery_runtime_harness_report_file",
    "run_start_runtime_harness_report_file",
    "runtime_harness_decision",
    "latest_runtime_harness_decision",
    "run_start_runtime_harness_decision",
    "runtime_harness_overall_decision",
    "meaningful_changed_paths",
    "adapter_raw_evidence_ref",
    "request_artifact_ref",
    "provider_work_packet_ref",
    "context_budget_status",
    "context_budget_failure_class",
    "raw_provider_error_summary",
    "top_context_size_sources",
    "provider_execution_status",
    "real_code_change_status",
    "code_quality_status",
    "review_report_file",
    "evaluation_report_file",
    "post_run_verify_summary_file",
    "post_run_verify_status",
    "post_run_quality_policy",
    "post_run_diagnostic_verify_summary_file",
    "post_run_diagnostic_verify_step_result_files",
    "post_run_diagnostic_transcript_file",
    "post_run_diagnostic_status",
    "guided_journey_enabled",
    "guided_web_smoke",
    "guided_web_smoke_summary_file",
    "guided_web_smoke_html_file",
    "guided_web_dom_snapshot_file",
    "guided_web_accessibility_summary_file",
    "guided_web_visual_guardrail_file",
    "guided_web_screenshot_files",
    "guided_browser_task_proof_request_file",
    "guided_browser_task_proof_file",
    "early_guided_web_smoke",
    "early_guided_web_smoke_summary_file",
    "early_guided_web_smoke_html_file",
    "early_guided_web_dom_snapshot_file",
    "early_guided_web_accessibility_summary_file",
    "early_guided_web_visual_guardrail_file",
    "early_guided_web_screenshot_files",
    "early_guided_browser_task_proof_request_file",
    "early_guided_browser_task_proof_file",
    "early_guided_browser_task_app_server_cleanup",
    "guided_journey_proof_file",
    "guided_journey_proof",
    "new_flow_mission_artifact_packet_file",
    "new_flow_mission_artifact_packet_body_file",
    "new_flow_next_action_report_file",
    "flow_targeted_operator_request_file",
    "delivery_plan_file",
    "delivery_manifest_file",
    "delivery_transcript_file",
    "delivery_quality_gate_status",
    "delivery_quality_gate_findings",
    "delivery_blocking",
    "release_packet_file",
    "release_delivery_manifest_file",
    "release_status",
    "learning_loop_scorecard_file",
    "learning_loop_handoff_file",
    "incident_report_file",
    "feature_mission_id",
    "feature_size",
    "mission_class",
    "live_e2e_step_quality_assessment_request_files",
    "live_e2e_step_quality_assessment_report_files",
    "matrix_cell",
    "coverage_follow_up",
  ]) {
    copyIfMissing(key);
  }

  const latestProviderStepStatus = latestProviderStepStatusFromArtifacts(artifacts);
  if (Object.keys(latestProviderStepStatus).length > 0) {
    artifacts.provider_step_status = latestProviderStepStatus;
    const providerClassification = classifyProviderStepStatus(latestProviderStepStatus);
    if (
      !asNonEmptyString(artifacts.provider_execution_status) ||
      isTransientProviderExecutionStatus(artifacts.provider_execution_status)
    ) {
      artifacts.provider_execution_status = providerClassification.provider_execution_status;
    }
    if (!asNonEmptyString(artifacts.failure_owner) && providerClassification.failure_owner) {
      artifacts.failure_owner = providerClassification.failure_owner;
      artifacts.failure_phase = providerClassification.failure_phase;
      artifacts.failure_class = providerClassification.failure_class;
    }
  }
}

function runtimeHarnessReportFilesForSummary(artifacts, productionProof = null) {
  return uniqueStrings([
    asNonEmptyString(asRecord(productionProof).evidence_refs?.runtime_harness_report_file),
    asNonEmptyString(artifacts.latest_runtime_harness_report_file),
    asNonEmptyString(artifacts.delivery_runtime_harness_report_file),
    asNonEmptyString(artifacts.runtime_harness_report_file),
    asNonEmptyString(artifacts.run_start_runtime_harness_report_file),
  ]);
}

function refreshRuntimeHarnessChangeEvidenceForSummary(artifacts, mission, productionProof = null) {
  const runtimeHarnessReportFiles = runtimeHarnessReportFilesForSummary(artifacts, productionProof);
  const reviewChangedPaths = collectReviewChangedPaths(artifacts.review_report_file);
  if (runtimeHarnessReportFiles.length === 0 && reviewChangedPaths.length === 0) {
    return;
  }
  const meaningfulChangedPaths = reconcileSummaryMeaningfulChangedPaths(uniqueStrings([
    ...runtimeHarnessReportFiles.flatMap((reportFile) => collectRuntimeHarnessChangedPaths(reportFile)),
    ...reviewChangedPaths,
  ]), { authorizedChangedPaths: collectDeliveryManifestChangedPaths(artifacts.delivery_manifest_file) });
  if (meaningfulChangedPaths.length > 0) {
    artifacts.meaningful_changed_paths = meaningfulChangedPaths;
  }
  artifacts.real_code_change_status = (
    runtimeHarnessReportFiles.some((reportFile) =>
      runtimeHarnessReportHasMissionRelevantChanges(reportFile, mission),
    ) || changedPathsHaveMissionRelevantChanges(reviewChangedPaths, mission)
  )
    ? "pass"
    : "fail";
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
  const journalEntries = getQualityRelevantStepJournal(options.stepJournal);
  const journalStageIds = new Set(journalEntries.map((entry) => asNonEmptyString(entry.step_id)).filter(Boolean));
  const acceptedStepIds = new Set(
    journalEntries
      .filter((entry) => asNonEmptyString(entry.operator_decision_status) === "accepted")
      .map((entry) => asNonEmptyString(entry.step_id))
      .filter(Boolean),
  );
  const pendingIncludedSteps = asStringArray(options.includedSteps).filter((step) => !acceptedStepIds.has(step));
  const failingStages = options.stageResults
    .filter((entry) => {
      const stage = asNonEmptyString(entry.stage);
      return (
        asNonEmptyString(entry.status) === "fail" &&
        (journalStageIds.has(stage) || ["bootstrap", "install", ...LIVE_E2E_OBSERVATION_PRELUDE_STEPS].includes(stage))
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
  const deliveryManifestSummary = summarizeDeliveryManifest(asNonEmptyString(options.artifacts.delivery_manifest_file));
  const learningHandoffSummary = summarizeLearningHandoff({
    artifacts: options.artifacts,
    scorecardFile: asNonEmptyString(options.artifacts.learning_loop_scorecard_file),
    handoffFile: asNonEmptyString(options.artifacts.learning_loop_handoff_file),
  });
  let status = "pass";
  for (const step of journalEntries) {
    status = worstObservationStatus(status, asNonEmptyString(step.final_step_verdict) || "not_pass");
  }
  if (failingStages.length > 0) {
    status = worstObservationStatus(status, "not_pass");
  }
  if (pendingIncludedSteps.length > 0 && ["pass", "warn"].includes(status)) {
    status = worstObservationStatus(status, "blocked");
  }
  const findings = uniqueStrings([
    ...journalEntries.flatMap((entry) => asStringArray(asRecord(entry.semantic_analysis).findings)),
    ...failingStages.map((entry) => `Stage '${entry.stage}' failed: ${entry.summary}`),
    ...pendingIncludedSteps.map((step) => `Declared live E2E step '${step}' was not observed with an accepted operator decision.`),
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
    failed_stages: failingStages,
    delivery: {
      status: deliveryStatus,
      ...deliveryManifestSummary,
      evidence_refs: uniqueStrings([asNonEmptyString(options.artifacts.delivery_manifest_file)]),
    },
    release: {
      status: releaseStatus,
      evidence_refs: uniqueStrings([asNonEmptyString(options.artifacts.release_packet_file)]),
    },
    learning: {
      status: learningStatus,
      ...learningHandoffSummary,
      evidence_refs: uniqueStrings([
        asNonEmptyString(options.artifacts.learning_loop_scorecard_file),
        asNonEmptyString(options.artifacts.learning_loop_handoff_file),
        ...asStringArray(learningHandoffSummary.evidence_refs),
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
  const controllerState = readJsonIfPresent(asNonEmptyString(options.flowResult.artifacts.live_e2e_controller_state_file));
  const controllerStateAvailable = Object.keys(controllerState).length > 0;
  const controllerStateInProgress = controllerStateAvailable
    ? isLiveE2eControllerStateInProgress(controllerState, includedSteps)
    : false;
  const controllerStopInProgress = !controllerStateAvailable
    ? isLiveE2eControllerStopInProgress(controllerStop, includedSteps)
    : false;
  const reportStatus =
    controllerStopInProgress || controllerStateInProgress ? "in_progress" : "final";
  const stepJournal = buildStepJournal({
    profile: options.profile,
    flowResult: options.flowResult,
  });
  const finalAnalysis = buildFinalAnalysis({
    stepJournal,
    stageResults: options.flowResult.stageResults,
    artifacts: options.flowResult.artifacts,
    includedSteps,
  });
  const frontendInteractions = buildFrontendInteractions(options.flowResult.artifacts, stepJournal);
  const guidedUiEvidence = buildGuidedUiEvidence({
    profile: options.profile,
    artifacts: options.flowResult.artifacts,
    frontendInteractions,
  });
  const targetReadiness = buildTargetReadiness(options.flowResult.artifacts);
  const failureFields = resolveTopLevelFailureFields(options.flowResult.artifacts, targetReadiness);
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
    target_readiness: targetReadiness,
    target_setup_status:
      typeof options.flowResult.artifacts.target_setup_status === "object" && options.flowResult.artifacts.target_setup_status
        ? options.flowResult.artifacts.target_setup_status
        : null,
    target_verification_status:
      typeof options.flowResult.artifacts.target_verification_status_detail === "object" &&
      options.flowResult.artifacts.target_verification_status_detail
        ? options.flowResult.artifacts.target_verification_status_detail
        : null,
    target_toolchain_preflight_file: asNonEmptyString(options.flowResult.artifacts.target_toolchain_preflight_file) || null,
    provider_step_status:
      typeof options.flowResult.artifacts.provider_step_status === "object" && options.flowResult.artifacts.provider_step_status
        ? options.flowResult.artifacts.provider_step_status
        : null,
    provider_execution_status: asNonEmptyString(options.flowResult.artifacts.provider_execution_status) || null,
    failure_owner: failureFields.owner,
    failure_phase: failureFields.phase,
    failure_class: failureFields.class,
    aor_installation: asRecord(options.flowResult.artifacts.aor_installation),
    aor_installation_proof_file: asNonEmptyString(options.flowResult.artifacts.aor_installation_proof_file),
    setup_journal: setupJournal,
    step_journal: stepJournal,
    final_analysis: finalAnalysis,
    interactive_decisions: buildInteractiveDecisions(stepJournal),
    frontend_interactions: frontendInteractions,
    guided_ui_evidence: guidedUiEvidence,
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
      asNonEmptyString(options.flowResult.artifacts.target_toolchain_preflight_file),
      ...asStringArray(targetReadiness.evidence_refs),
      ...asStringArray(guidedUiEvidence.evidence_refs),
    ]),
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
 * @param {{ observationReport: Record<string, unknown> }} options
 * @returns {Record<string, unknown>}
 */
function buildControllerHealth(options) {
  const completeness = buildLifecycleCompletenessSummary(options.observationReport);
  const stepJournal = Array.isArray(options.observationReport.step_journal)
    ? options.observationReport.step_journal.map((entry) => asRecord(entry))
    : [];
  const missingPhaseEvidence = stepJournal.flatMap((entry) => {
    const stepId = asNonEmptyString(entry.step_id) || "step";
    return ["plan_ref", "execution_ref", "inspection_ref", "classification_ref"]
      .filter((field) => !asNonEmptyString(entry[field]))
      .map((field) => `${stepId}.${field}`);
  });
  const rejectedDecisionSteps = stepJournal
    .filter((entry) => asNonEmptyString(entry.operator_decision_status) === "rejected")
    .map((entry) => asNonEmptyString(entry.step_id))
    .filter(Boolean);
  const missingDecisionSteps = asStringArray(completeness.missing_operator_decision_steps);
  return {
    status:
      missingPhaseEvidence.length === 0 &&
      missingDecisionSteps.length === 0 &&
      rejectedDecisionSteps.length === 0
        ? "pass"
        : "blocked",
    controller_state_ref: asNonEmptyString(options.observationReport.controller_state_ref) || null,
    missing_phase_evidence: missingPhaseEvidence,
    missing_operator_decision_steps: missingDecisionSteps,
    rejected_operator_decision_steps: rejectedDecisionSteps,
  };
}

/**
 * @param {Record<string, unknown>} artifacts
 * @returns {Record<string, unknown>}
 */
function buildProviderHealth(artifacts) {
  const providerStepStatus = asRecord(artifacts.provider_step_status);
  const contextBudgetStatus = asNonEmptyString(artifacts.context_budget_status);
  const contextBudgetFailureClass = asNonEmptyString(artifacts.context_budget_failure_class);
  const hasContextBudgetBlock =
    ["compiled_context_budget_exceeded", "provider_context_window_exceeded"].includes(contextBudgetFailureClass) ||
    contextBudgetStatus === "fail";
  const providerExecutionStatus =
    asNonEmptyString(artifacts.provider_execution_status) ||
    asNonEmptyString(providerStepStatus.status) ||
    (hasContextBudgetBlock ? "blocked" : null) ||
    "not_attempted";
  const hasProviderBlock = ["interrupted", "blocked", "provider_blocked", "permission-mode-blocked", "edit-denied"].includes(
    providerExecutionStatus,
  );
  const hasProviderPass = ["pass", "completed", "not_attempted"].includes(providerExecutionStatus);
  const status = hasContextBudgetBlock || hasProviderBlock ? "blocked" : hasProviderPass ? "pass" : "fail";
  return {
    status,
    provider_execution_status: providerExecutionStatus,
    provider_step_status: Object.keys(providerStepStatus).length > 0 ? providerStepStatus : null,
    adapter_raw_evidence_ref: asNonEmptyString(artifacts.adapter_raw_evidence_ref) || null,
    request_artifact_ref: asNonEmptyString(artifacts.request_artifact_ref) || null,
    provider_work_packet_ref: asNonEmptyString(artifacts.provider_work_packet_ref) || null,
    context_budget_status: contextBudgetStatus || null,
    context_budget_failure_class: contextBudgetFailureClass || null,
    top_context_size_sources: Array.isArray(artifacts.top_context_size_sources)
      ? artifacts.top_context_size_sources
      : [],
    raw_provider_error_summary: asNonEmptyString(artifacts.raw_provider_error_summary) || null,
  };
}

/**
 * @param {Record<string, unknown>} artifacts
 * @returns {Record<string, unknown>}
 */
function buildTargetEnvironmentHealth(artifacts) {
  const targetSetupStatus = asRecord(artifacts.target_setup_status);
  const targetVerificationStatus = asRecord(artifacts.target_verification_status_detail);
  const setupStatus = asNonEmptyString(targetSetupStatus.status) || "not_attempted";
  const postRunVerificationStatus = asNonEmptyString(artifacts.post_run_verify_status);
  const verificationStatus =
    postRunVerificationStatus ||
    asNonEmptyString(targetVerificationStatus.status) ||
    "not_attempted";
  const status = [setupStatus, verificationStatus].includes("fail")
    ? "fail"
    : [setupStatus, verificationStatus].includes("blocked")
      ? "blocked"
      : "pass";
  const inferredFailurePhase =
    status === "pass" ? null : setupStatus === "fail" || setupStatus === "blocked" ? "target_setup" : "target_verification";
  const inferredFailureClass =
    status === "pass"
      ? null
      : inferredFailurePhase === "target_setup"
        ? "target_setup_failed"
        : "target_verification_failed";
  const blockingTargetStatus =
    setupStatus === "fail" || setupStatus === "blocked"
      ? targetSetupStatus
      : verificationStatus === "fail" || verificationStatus === "blocked"
        ? targetVerificationStatus
        : {};
  const scopedDeclaredFailure =
    status === "pass" ? {} : targetScopedDeclaredFailureFromArtifacts(artifacts);
  return {
    status,
    target_setup_status: setupStatus,
    target_verification_status: verificationStatus,
    failure_owner:
      asNonEmptyString(blockingTargetStatus.failure_owner) ||
      asNonEmptyString(scopedDeclaredFailure.owner) ||
      (status === "pass" ? null : "target_repository"),
    failure_phase:
      asNonEmptyString(blockingTargetStatus.failure_phase) ||
      asNonEmptyString(scopedDeclaredFailure.phase) ||
      inferredFailurePhase,
    failure_class:
      asNonEmptyString(blockingTargetStatus.failure_class) ||
      asNonEmptyString(scopedDeclaredFailure.class) ||
      inferredFailureClass,
  };
}

/**
 * @param {Record<string, unknown>} artifacts
 * @returns {{ owner: string | null, phase: string | null, class: string | null }}
 */
function targetScopedDeclaredFailureFromArtifacts(artifacts) {
  const owner = asNonEmptyString(artifacts.failure_owner);
  const phase = asNonEmptyString(artifacts.failure_phase);
  const failureClass = asNonEmptyString(artifacts.failure_class);
  const targetScoped =
    owner === "target_repository" ||
    owner === "environment" ||
    phase === "target_readiness" ||
    phase === "target_setup" ||
    phase === "target_verification" ||
    failureClass.startsWith("target_") ||
    failureClass.startsWith("environment_");
  if (!targetScoped) {
    return { owner: null, phase: null, class: null };
  }
  return {
    owner: owner || null,
    phase: phase || null,
    class: failureClass || null,
  };
}

/**
 * @param {string} status
 * @param {string} setupStatus
 * @param {string} verificationStatus
 * @param {string} preExecutionStatus
 * @returns {{ owner: string, phase: string, class: string }}
 */
function inferTargetReadinessFailure(status, setupStatus, verificationStatus, preExecutionStatus) {
  const blocked = status === "blocked";
  if (setupStatus === "fail" || setupStatus === "blocked") {
    return {
      owner: setupStatus === "blocked" ? "environment" : "target_repository",
      phase: "target_setup",
      class: blocked ? "target_setup_blocked" : "target_setup_failed",
    };
  }
  if (verificationStatus === "fail" || verificationStatus === "blocked") {
    return {
      owner: "target_repository",
      phase: "target_verification",
      class: blocked ? "target_verification_blocked" : "target_verification_failed",
    };
  }
  if (preExecutionStatus === "fail" || preExecutionStatus === "blocked") {
    return {
      owner: "target_repository",
      phase: "target_verification",
      class: blocked ? "target_verification_blocked" : "target_verification_failed",
    };
  }
  return {
    owner: "target_repository",
    phase: "target_readiness",
    class: blocked ? "target_readiness_blocked" : "target_readiness_failed",
  };
}

/**
 * @param {Record<string, unknown>} targetReadiness
 * @returns {{ owner: string, phase: string, class: string, summary: string } | null}
 */
function targetReadinessPreExecutionFailure(targetReadiness) {
  const status = asNonEmptyString(targetReadiness.status);
  if (!["blocked", "fail"].includes(status) || targetReadiness.product_execution_started === true) {
    return null;
  }
  const owner = asNonEmptyString(targetReadiness.failure_owner) || "target_repository";
  const phase = asNonEmptyString(targetReadiness.failure_phase) || "target_readiness";
  const failureClass =
    asNonEmptyString(targetReadiness.failure_class) ||
    (status === "blocked" ? "target_readiness_blocked" : "target_readiness_failed");
  return {
    owner,
    phase,
    class: failureClass,
    summary:
      asNonEmptyString(targetReadiness.summary) ||
      "Target readiness blocked before product execution.",
  };
}

/**
 * @param {Record<string, unknown>} artifacts
 * @param {Record<string, unknown>} targetReadiness
 * @returns {{ owner: string | null, phase: string | null, class: string | null }}
 */
function resolveTopLevelFailureFields(artifacts, targetReadiness) {
  const readinessFailure = targetReadinessPreExecutionFailure(targetReadiness);
  if (readinessFailure) {
    return {
      owner: readinessFailure.owner,
      phase: readinessFailure.phase,
      class: readinessFailure.class,
    };
  }
  return {
    owner: asNonEmptyString(artifacts.failure_owner) || null,
    phase: asNonEmptyString(artifacts.failure_phase) || null,
    class: asNonEmptyString(artifacts.failure_class) || null,
  };
}

/**
 * @param {Record<string, unknown>} artifacts
 * @returns {Record<string, unknown>}
 */
function buildTargetReadiness(artifacts) {
  const targetPreExecutionStatus = asRecord(artifacts.target_pre_execution_status);
  const targetSetupStatus = asRecord(artifacts.target_setup_status);
  const targetVerificationStatus = asRecord(artifacts.target_verification_status_detail);
  const targetToolchainPreflight = asRecord(artifacts.target_toolchain_preflight);
  const baselineGateDecision = asRecord(artifacts.baseline_verify_gate_decision);
  const toolchainStatus = asNonEmptyString(targetToolchainPreflight.status) || "not_applicable";
  const setupStatus = asNonEmptyString(targetSetupStatus.status) || "not_attempted";
  const verificationStatus = asNonEmptyString(targetVerificationStatus.status) || "not_attempted";
  const preExecutionStatus =
    asNonEmptyString(targetPreExecutionStatus.status) ||
    asNonEmptyString(baselineGateDecision.status) ||
    (asNonEmptyString(artifacts.execution_readiness_file) ? "pass" : "not_attempted");
  const status =
    [preExecutionStatus, toolchainStatus, setupStatus, verificationStatus].includes("blocked")
      ? "blocked"
      : [preExecutionStatus, toolchainStatus, setupStatus, verificationStatus].includes("fail")
        ? "fail"
        : preExecutionStatus === "pass" ||
            asNonEmptyString(artifacts.execution_readiness_file) ||
            asNonEmptyString(artifacts.baseline_verify_summary_file)
          ? "pass"
          : "not_attempted";
  const blockingStatus =
    status === "blocked" || status === "fail"
      ? [targetPreExecutionStatus, targetSetupStatus, targetVerificationStatus, baselineGateDecision].find((entry) =>
          asNonEmptyString(asRecord(entry).failure_owner) ||
          asNonEmptyString(asRecord(entry).failure_phase) ||
          asNonEmptyString(asRecord(entry).failure_class),
        )
      : {};
  const productExecutionStarted =
    asNonEmptyString(artifacts.provider_execution_status) !== "" ||
    asNonEmptyString(artifacts.routed_step_result_file) !== "" ||
    asNonEmptyString(artifacts.run_start_runtime_harness_report_file) !== "";
  const scopedDeclaredFailure =
    status === "blocked" || status === "fail" ? targetScopedDeclaredFailureFromArtifacts(artifacts) : {};
  const inferredFailure =
    status === "blocked" || status === "fail"
      ? inferTargetReadinessFailure(status, setupStatus, verificationStatus, preExecutionStatus)
      : { owner: null, phase: null, class: null };
  const evidenceRefs = uniqueStrings([
    asNonEmptyString(artifacts.target_toolchain_preflight_file),
    asNonEmptyString(artifacts.target_pre_execution_status_file),
    asNonEmptyString(artifacts.baseline_verify_summary_file),
    asNonEmptyString(artifacts.verify_summary_file),
    asNonEmptyString(artifacts.execution_readiness_file),
    ...asStringArray(artifacts.baseline_verify_preserved_files),
    ...asStringArray(artifacts.baseline_verify_step_result_files),
  ]);
  return {
    phase: "target_readiness",
    status,
    target_toolchain_status: toolchainStatus,
    target_setup_status: setupStatus,
    target_verification_status: verificationStatus,
    target_toolchain_preflight_file: asNonEmptyString(artifacts.target_toolchain_preflight_file) || null,
    target_pre_execution_status_file: asNonEmptyString(artifacts.target_pre_execution_status_file) || null,
    baseline_verify_summary_file: asNonEmptyString(artifacts.baseline_verify_summary_file) || null,
    execution_readiness_file: asNonEmptyString(artifacts.execution_readiness_file) || null,
    failure_owner:
      asNonEmptyString(asRecord(blockingStatus).failure_owner) ||
      asNonEmptyString(scopedDeclaredFailure.owner) ||
      asNonEmptyString(inferredFailure.owner) ||
      null,
    failure_phase:
      asNonEmptyString(asRecord(blockingStatus).failure_phase) ||
      asNonEmptyString(scopedDeclaredFailure.phase) ||
      asNonEmptyString(inferredFailure.phase) ||
      null,
    failure_class:
      asNonEmptyString(asRecord(blockingStatus).failure_class) ||
      asNonEmptyString(scopedDeclaredFailure.class) ||
      asNonEmptyString(inferredFailure.class) ||
      null,
    product_execution_started: productExecutionStarted,
    evidence_refs: evidenceRefs,
    summary:
      status === "pass"
        ? "Target readiness passed before product execution."
        : status === "not_attempted"
          ? "Target readiness evidence was not attempted or not materialized."
          : asNonEmptyString(targetPreExecutionStatus.blocker_reason) ||
            asNonEmptyString(baselineGateDecision.summary) ||
            "Target readiness blocked before product execution.",
  };
}

/**
 * @param {unknown} value
 * @returns {"pass" | "warn" | "fail" | "blocked" | null}
 */
function toRunHealthStatusOrNull(value) {
  const normalized = asNonEmptyString(value).toLowerCase();
  if (normalized === "pass" || normalized === "passed" || normalized === "success") return "pass";
  if (normalized === "warn" || normalized === "warning") return "warn";
  if (normalized === "fail" || normalized === "failed" || normalized === "not_pass") return "fail";
  if (normalized === "blocked" || normalized === "block") return "blocked";
  return null;
}

const DIAGNOSTIC_COMMAND_FAILURE_OWNER = "target_repository";
const DIAGNOSTIC_COMMAND_FAILURE_PHASE = "target_verification";
const DIAGNOSTIC_COMMAND_FAILURE_CLASS = "post_run_diagnostic_failed";
const DIAGNOSTIC_COMMAND_TIMEOUT_CLASS = "post_run_diagnostic_timeout";
const POST_RUN_DIAGNOSTIC_INTENT = "post-run-diagnostic";

/**
 * @param {Record<string, unknown>} entry
 * @returns {string}
 */
function resolveDiagnosticIntent(entry) {
  return asNonEmptyString(entry.diagnostic_intent) || POST_RUN_DIAGNOSTIC_INTENT;
}

/**
 * @param {Record<string, unknown>} entry
 * @param {boolean} timedOut
 * @returns {string}
 */
function diagnosticCommandFailureClass(entry, timedOut) {
  return (
    asNonEmptyString(entry.failure_class) ||
    (timedOut ? DIAGNOSTIC_COMMAND_TIMEOUT_CLASS : DIAGNOSTIC_COMMAND_FAILURE_CLASS)
  );
}

/**
 * @param {Record<string, unknown>} stepResult
 * @param {string | null} stepResultRef
 * @returns {Record<string, unknown>}
 */
function summarizeDiagnosticCommand(stepResult, stepResultRef) {
  const timedOut = stepResult.timed_out === true;
  return {
    repo_scope: asNonEmptyString(stepResult.repo_scope) || null,
    command: asNonEmptyString(stepResult.command) || null,
    diagnostic_intent: resolveDiagnosticIntent(stepResult),
    status: asNonEmptyString(stepResult.status) || "unknown",
    timed_out: timedOut,
    failure_owner: asNonEmptyString(stepResult.failure_owner) || DIAGNOSTIC_COMMAND_FAILURE_OWNER,
    failure_phase: asNonEmptyString(stepResult.failure_phase) || DIAGNOSTIC_COMMAND_FAILURE_PHASE,
    failure_class: diagnosticCommandFailureClass(stepResult, timedOut),
    step_result_ref: stepResultRef,
    summary: asNonEmptyString(stepResult.summary) || null,
  };
}

/**
 * @param {Record<string, unknown>} entry
 * @param {{ timedOut?: boolean }} [options]
 * @returns {Record<string, unknown>}
 */
function summarizeDiagnosticSummaryCommand(entry, options = {}) {
  const timedOut = entry.timed_out === true || options.timedOut === true;
  return {
    repo_scope: asNonEmptyString(entry.repo_scope) || null,
    command: asNonEmptyString(entry.command) || null,
    diagnostic_intent: resolveDiagnosticIntent(entry),
    status: asNonEmptyString(entry.status) || "failed",
    timed_out: timedOut,
    failure_owner: asNonEmptyString(entry.failure_owner) || DIAGNOSTIC_COMMAND_FAILURE_OWNER,
    failure_phase: asNonEmptyString(entry.failure_phase) || DIAGNOSTIC_COMMAND_FAILURE_PHASE,
    failure_class: diagnosticCommandFailureClass(entry, timedOut),
    step_result_ref: asNonEmptyString(entry.step_result_ref) || null,
    summary: asNonEmptyString(entry.summary) || null,
  };
}

/**
 * @param {Record<string, unknown>} artifacts
 * @returns {Record<string, unknown>}
 */
function buildDiagnosticHealth(artifacts) {
  const policy = asRecord(artifacts.post_run_quality_policy);
  const diagnosticFailureMode =
    asNonEmptyString(policy.diagnosticFailureMode) ||
    asNonEmptyString(policy.diagnostic_failure_mode) ||
    null;
  const summaryFile = asNonEmptyString(artifacts.post_run_diagnostic_verify_summary_file);
  const transcriptFile = asNonEmptyString(artifacts.post_run_diagnostic_transcript_file);
  const transcript = readJsonIfPresent(transcriptFile);
  const summary = readJsonIfPresent(summaryFile);
  const summaryStatus = toRunHealthStatusOrNull(summary.status);
  const artifactStatus = toRunHealthStatusOrNull(artifacts.post_run_diagnostic_status);
  const inferredStatus =
    artifactStatus ||
    (summaryStatus === "pass"
      ? "pass"
      : summaryStatus
        ? diagnosticFailureMode === "fail"
          ? "fail"
          : "warn"
        : "pass");
  const status = inferredStatus === "fail" && diagnosticFailureMode !== "fail" ? "warn" : inferredStatus;
  const stepResultRefs = uniqueStrings([
    ...asStringArray(summary.step_result_refs),
    ...asStringArray(artifacts.post_run_diagnostic_verify_step_result_files),
  ]);
  const stepResultEntries = stepResultRefs.map((ref) => ({
    ref,
    stepResult: readJsonIfPresent(ref),
  }));
  const failedCommandsFromStepResults = stepResultEntries
    .filter(({ stepResult }) => asNonEmptyString(stepResult.status) === "failed")
    .map(({ ref, stepResult }) => summarizeDiagnosticCommand(stepResult, ref));
  const transcriptTimeoutCommands =
    transcript.timed_out === true
      ? [
          {
            repo_scope: null,
            command: asNonEmptyString(transcript.label) || asNonEmptyString(transcript.command) || "post-run diagnostic",
            diagnostic_intent: resolveDiagnosticIntent(transcript),
            status: "failed",
            timed_out: true,
            failure_owner: DIAGNOSTIC_COMMAND_FAILURE_OWNER,
            failure_phase: DIAGNOSTIC_COMMAND_FAILURE_PHASE,
            failure_class: DIAGNOSTIC_COMMAND_TIMEOUT_CLASS,
            step_result_ref: transcriptFile || null,
            summary: "Diagnostic command timed out after bounded cleanup; stdout/stderr are preserved in the transcript.",
          },
        ]
      : [];
  const timedOutCommands = uniqueDiagnosticCommands([
    ...(Array.isArray(summary.timed_out_commands)
      ? summary.timed_out_commands.map((entry) => summarizeDiagnosticSummaryCommand(asRecord(entry), { timedOut: true }))
      : failedCommandsFromStepResults.filter((entry) => entry.timed_out === true)),
    ...transcriptTimeoutCommands,
  ]);
  const outputQualityFailedCommands = Array.isArray(summary.output_quality_failed_commands)
    ? summary.output_quality_failed_commands.map((entry) => summarizeDiagnosticSummaryCommand(asRecord(entry)))
    : [];
  const failedCommands = uniqueDiagnosticCommands([
    ...failedCommandsFromStepResults,
    ...outputQualityFailedCommands,
    ...timedOutCommands,
  ]);
  const evidenceRefs = uniqueStrings([
    summaryFile,
    transcriptFile,
    ...stepResultRefs,
    ...timedOutCommands.map((entry) => asNonEmptyString(entry.step_result_ref)),
    ...failedCommands.map((entry) => asNonEmptyString(entry.step_result_ref)),
    ...asStringArray(artifacts.post_run_diagnostic_verify_preserved_files),
  ]);
  return {
    status,
    diagnostic_failure_mode: diagnosticFailureMode === "warn" || diagnosticFailureMode === "fail" ? diagnosticFailureMode : null,
    post_run_diagnostic_status: artifactStatus || (summaryStatus ? status : null),
    post_run_diagnostic_verify_summary_file: summaryFile || null,
    timed_out_command_count: timedOutCommands.length,
    failed_command_count: failedCommands.length,
    timed_out_commands: timedOutCommands,
    failed_commands: failedCommands,
    evidence_refs: evidenceRefs,
  };
}

/**
 * @param {Record<string, unknown>[]} entries
 * @returns {Record<string, unknown>[]}
 */
function uniqueDiagnosticCommands(entries) {
  const seen = new Set();
  const result = [];
  for (const entry of entries) {
    const key = [
      asNonEmptyString(entry.repo_scope),
      asNonEmptyString(entry.command),
      asNonEmptyString(entry.step_result_ref),
      asNonEmptyString(entry.status),
    ].join("::");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(entry);
  }
  return result;
}

/**
 * @param {{
 *   profile: Record<string, unknown>,
 *   artifacts: Record<string, unknown>,
 *   observationReport: Record<string, unknown>,
 *   stepObservationFiles: string[],
 * }} options
 * @returns {Record<string, unknown>}
 */
function buildEvidenceHealth(options) {
  const stepJournal = Array.isArray(options.observationReport.step_journal)
    ? options.observationReport.step_journal.map((entry) => asRecord(entry))
    : [];
  const rawRefs = [
    options.observationReport.controller_state_ref,
    ...asStringArray(options.observationReport.evidence_refs),
    ...options.stepObservationFiles,
    ...stepJournal.flatMap((entry) => [
      entry.plan_ref,
      entry.execution_ref,
      entry.inspection_ref,
      entry.classification_ref,
      entry.agent_decision_request_ref,
      entry.operator_decision_ref,
      ...asStringArray(entry.artifact_refs),
      ...asStringArray(entry.inspected_evidence_refs),
    ]),
  ];
  const missingEvidenceRefs = rawRefs
    .map((ref, index) => ({ ref: asNonEmptyString(ref), index }))
    .filter((entry) => !entry.ref)
    .map((entry) => `missing-ref-${entry.index}`);
  const guidedUiEvidenceGaps = buildGuidedUiEvidenceGaps({
    profile: options.profile,
    artifacts: options.artifacts,
    observationReport: options.observationReport,
  });
  const status =
    guidedUiEvidenceGaps.length > 0
      ? "blocked"
      : missingEvidenceRefs.length === 0
        ? "pass"
        : "warn";
  return {
    status,
    missing_evidence_refs: missingEvidenceRefs,
    weak_evidence_refs: guidedUiEvidenceGaps,
    evidence_ref_count: uniqueStrings(rawRefs.map((ref) => asNonEmptyString(ref))).length,
  };
}

/**
 * @param {Record<string, unknown>} observationReport
 * @returns {Record<string, unknown>}
 */
function buildResumeInteractionHealth(observationReport) {
  const stepJournal = Array.isArray(observationReport.step_journal)
    ? observationReport.step_journal.map((entry) => asRecord(entry))
    : [];
  const pendingInteractions = stepJournal.filter(
    (entry) => asNonEmptyString(asRecord(entry.requested_interaction).interaction_status) === "requested",
  );
  const pendingDecisions = stepJournal.filter((entry) => asNonEmptyString(entry.operator_decision_status) === "missing");
  const resumeIssues = stepJournal
    .filter((entry) => ["resume_failed", "blocked"].includes(asNonEmptyString(asRecord(entry.resume_result).status)))
    .map((entry) => asNonEmptyString(entry.step_id))
    .filter(Boolean);
  return {
    status: pendingInteractions.length === 0 && pendingDecisions.length === 0 && resumeIssues.length === 0 ? "pass" : "blocked",
    pending_interaction_count: pendingInteractions.length,
    pending_decision_count: pendingDecisions.length,
    resume_issues: resumeIssues,
  };
}

/**
 * @param {{
 *   observationReport: Record<string, unknown>,
 *   commandHealth: Record<string, unknown>,
 *   controllerHealth: Record<string, unknown>,
 *   providerHealth: Record<string, unknown>,
 *   targetReadiness: Record<string, unknown>,
 *   targetEnvironmentHealth: Record<string, unknown>,
 *   diagnosticHealth: Record<string, unknown>,
 *   evidenceHealth: Record<string, unknown>,
 *   resumeInteractionHealth: Record<string, unknown>,
 *   lifecycleCompletion: Record<string, unknown>,
 *   artifacts: Record<string, unknown>,
 * }} options
 * @returns {Record<string, unknown>}
 */
export function resolveRunHealthFailure(options) {
  const readinessFailure = targetReadinessPreExecutionFailure(options.targetReadiness);
  if (readinessFailure) {
    return readinessFailure;
  }
  const rawDeclaredClass = asNonEmptyString(options.artifacts.failure_class);
  const declaredClassIsNonFailure = ["none", "pass", "passed", "completed", "succeeded"].includes(rawDeclaredClass);
  const declaredOwner = declaredClassIsNonFailure ? "" : asNonEmptyString(options.artifacts.failure_owner);
  const declaredPhase = declaredClassIsNonFailure ? "" : asNonEmptyString(options.artifacts.failure_phase);
  const declaredClass = declaredClassIsNonFailure ? "" : rawDeclaredClass;
  if (declaredOwner || declaredPhase || declaredClass) {
    if (["compiled_context_budget_exceeded", "provider_context_window_exceeded"].includes(declaredClass)) {
      return {
        owner: declaredOwner || (declaredClass === "provider_context_window_exceeded" ? "provider" : "aor"),
        phase: declaredPhase || "provider_execution",
        class: declaredClass,
        summary:
          asNonEmptyString(options.artifacts.raw_provider_error_summary) ||
          (declaredClass === "provider_context_window_exceeded"
            ? "External runtime exhausted its provider conversation context during execution."
            : "Provider work packet exceeded the configured context budget before provider execution."),
      };
    }
    if (["provider_work_packet_not_executed", "no-op"].includes(declaredClass)) {
      return {
        owner: declaredOwner || "provider",
        phase: declaredPhase || "provider_execution",
        class: declaredClass,
        summary:
          declaredClass === "provider_work_packet_not_executed"
            ? "External runtime summarized the provider work packet instead of executing the implementation."
            : "Runtime Harness detected a strict code-changing no-op during provider execution.",
      };
    }
    return {
      owner: declaredOwner || "unknown",
      phase: declaredPhase || "unknown",
      class: declaredClass || "declared_failure",
      summary: "Run artifacts declared a primary failure owner, phase, or class.",
    };
  }
  const liveAdapterPreflight = asRecord(options.artifacts.live_adapter_preflight);
  const liveAdapterPreflightStatus = asNonEmptyString(liveAdapterPreflight.status);
  if (liveAdapterPreflightStatus && liveAdapterPreflightStatus !== "pass") {
    const failureKind = asNonEmptyString(liveAdapterPreflight.failure_kind) || "live_adapter_preflight_failed";
    return {
      owner: ["missing-command", "missing-live-runtime"].includes(failureKind) ? "environment" : "provider",
      phase: "readiness",
      class: failureKind,
      summary: asNonEmptyString(liveAdapterPreflight.summary) || "Live adapter preflight did not pass.",
    };
  }
  if (asNonEmptyString(options.providerHealth.status) !== "pass") {
    return {
      owner: "provider",
      phase: "provider_execution",
      class: asNonEmptyString(options.providerHealth.provider_execution_status) || "provider_execution_failed",
      summary: "Provider execution did not complete cleanly.",
    };
  }
  if (asNonEmptyString(options.targetEnvironmentHealth.status) !== "pass") {
    const targetOwner = asNonEmptyString(options.targetEnvironmentHealth.failure_owner);
    const targetPhase = asNonEmptyString(options.targetEnvironmentHealth.failure_phase);
    const targetClass = asNonEmptyString(options.targetEnvironmentHealth.failure_class);
    return {
      owner: targetOwner || "target_repository",
      phase:
        targetPhase ||
        (asNonEmptyString(options.targetEnvironmentHealth.target_setup_status) === "fail"
          ? "target_setup"
          : "target_verification"),
      class: targetClass || "target_environment_failed",
      summary: "Target setup or target verification failed during the run.",
    };
  }
  if (asNonEmptyString(options.commandHealth.status) === "fail") {
    const failedProjectBootstrap = (Array.isArray(options.commandHealth.failed_commands) ? options.commandHealth.failed_commands : []).some(
      (entry) => asNonEmptyString(asRecord(entry).command_surface) === "aor project init");
    return {
      owner: "aor", phase: failedProjectBootstrap ? "project_bootstrap" : "unknown",
      class: "public_command_failed", summary: failedProjectBootstrap ? "Public project bootstrap failed before live E2E controller execution." : "One or more public live E2E commands failed.",
    };
  }
  if (asNonEmptyString(options.observationReport.report_status) === "in_progress") {
    return {
      owner: "operator",
      phase: "controller_decision",
      class: "controller_incomplete",
      summary: "Live E2E observation is still in progress and requires a terminal controller decision.",
    };
  }
  if (asNonEmptyString(options.controllerHealth.status) !== "pass") {
    return {
      owner: "operator",
      phase: "controller_decision",
      class: "controller_incomplete",
      summary: "Live E2E controller did not complete every required continuation decision.",
    };
  }
  if (asNonEmptyString(options.resumeInteractionHealth.status) !== "pass") {
    return {
      owner: "operator",
      phase: "controller_decision",
      class: "resume_or_interaction_blocked",
      summary: "Run has pending or failed interaction/resume evidence.",
    };
  }
  if (asNonEmptyString(options.diagnosticHealth.status) === "fail") {
    return {
      owner: "target_repository",
      phase: "target_verification",
      class: "post_run_diagnostic_failed",
      summary: "Post-run diagnostic verification failed under diagnostic_failure_mode=fail.",
    };
  }
  if (
    asStringArray(options.evidenceHealth.weak_evidence_refs).some((ref) =>
      ref === "guided-browser-task-proof" || ref.startsWith("frontend_interactions.guided-web-smoke"),
    )
  ) {
    return {
      owner: "operator",
      phase: "ui_validation",
      class: "guided_browser_task_proof_missing",
      summary: "Guided AOR operator UI proof was required but browser-task evidence was missing or did not pass.",
    };
  }
  if (asNonEmptyString(options.evidenceHealth.status) !== "pass") {
    return {
      owner: "aor",
      phase: "summary_write",
      class: "missing_evidence",
      summary: "Run completed with missing factual evidence refs.",
    };
  }
  if (toObservationStatus(asNonEmptyString(options.observationReport.overall_status)) === "warn") {
    return {
      owner: "unknown",
      phase: "unknown",
      class: "run_completed_with_findings",
      summary: "Run completed with factual findings.",
    };
  }
  if (asNonEmptyString(options.diagnosticHealth.status) === "warn") {
    return {
      owner: "target_repository",
      phase: "target_verification",
      class: "post_run_diagnostic_warning",
      summary: "Post-run diagnostic verification recorded a non-blocking factual warning.",
    };
  }
  if (
    toObservationStatus(asNonEmptyString(options.observationReport.overall_status)) === "blocked" ||
    asNonEmptyString(options.lifecycleCompletion.continuation_status) !== "complete"
  ) {
    return {
      owner: "unknown",
      phase: "unknown",
      class: "lifecycle_incomplete",
      summary: "Run stopped before completing the declared lifecycle without a more specific owner classification.",
    };
  }
  return {
    owner: "aor",
    phase: "summary_write",
    class: "unclassified_run_health_failure",
    summary: "Run-health was non-passing without a more specific factual failure classification.",
  };
}

/**
 * @param {{
 *   runId: string,
 *   profile: Record<string, unknown>,
 *   summaryFile: string,
 *   observationReportFile: string,
 *   observationReport: Record<string, unknown>,
 *   flowResult: {
 *     commandResults: Array<Record<string, unknown>>,
 *     artifacts: Record<string, unknown>,
 *   },
 *   stepObservationFiles: string[],
 * }}
 * @returns {Record<string, unknown>}
 */
function buildRunHealthReport(options) {
  const lifecycleCompletion = buildLifecycleCompletenessSummary(options.observationReport);
  const commandHealth = buildCommandHealth({
    flowResult: options.flowResult,
    observationReport: options.observationReport,
  });
  const controllerHealth = buildControllerHealth({ observationReport: options.observationReport });
  const providerHealth = buildProviderHealth(options.flowResult.artifacts);
  const targetEnvironmentHealth = buildTargetEnvironmentHealth(options.flowResult.artifacts);
  const targetReadiness = buildTargetReadiness(options.flowResult.artifacts);
  const diagnosticHealth = buildDiagnosticHealth(options.flowResult.artifacts);
  const guidedUiEvidence = buildGuidedUiEvidence({
    profile: options.profile,
    artifacts: options.flowResult.artifacts,
    frontendInteractions: Array.isArray(options.observationReport.frontend_interactions)
      ? options.observationReport.frontend_interactions.map((entry) => asRecord(entry))
      : [],
  });
  const evidenceHealth = buildEvidenceHealth({
    profile: options.profile,
    artifacts: options.flowResult.artifacts,
    observationReport: options.observationReport,
    stepObservationFiles: options.stepObservationFiles,
  });
  const resumeInteractionHealth = buildResumeInteractionHealth(options.observationReport);
  const observationStatus = toObservationStatus(asNonEmptyString(options.observationReport.overall_status) || "not_pass");
  const hasBlockingRunControl =
    asNonEmptyString(options.observationReport.report_status) === "in_progress" ||
    observationStatus === "blocked" ||
    observationStatus === "interaction_required" ||
    asNonEmptyString(controllerHealth.status) === "blocked" ||
    asNonEmptyString(providerHealth.status) === "blocked" ||
    asNonEmptyString(targetReadiness.status) === "blocked" ||
    asNonEmptyString(targetEnvironmentHealth.status) === "blocked" ||
    asNonEmptyString(diagnosticHealth.status) === "blocked" ||
    asNonEmptyString(evidenceHealth.status) === "blocked" ||
    asNonEmptyString(resumeInteractionHealth.status) === "blocked";
  const hasFailedRun =
    observationStatus === "not_pass" ||
    asNonEmptyString(commandHealth.status) === "fail" ||
    asNonEmptyString(providerHealth.status) === "fail" ||
    asNonEmptyString(targetReadiness.status) === "fail" ||
    asNonEmptyString(targetEnvironmentHealth.status) === "fail" ||
    asNonEmptyString(diagnosticHealth.status) === "fail";
  const overallStatus = hasBlockingRunControl
    ? "blocked"
    : hasFailedRun
      ? "fail"
      : asNonEmptyString(lifecycleCompletion.continuation_status) !== "complete"
        ? "blocked"
        : observationStatus === "warn" ||
            asNonEmptyString(evidenceHealth.status) === "warn" ||
            asNonEmptyString(diagnosticHealth.status) === "warn"
          ? "warn"
          : "pass";
  const failureSummary =
    overallStatus === "pass"
      ? { owner: null, phase: null, class: null, summary: null }
      : resolveRunHealthFailure({
          observationReport: options.observationReport,
          commandHealth,
          controllerHealth,
          providerHealth,
          targetReadiness,
          targetEnvironmentHealth,
          diagnosticHealth,
          evidenceHealth,
          resumeInteractionHealth,
          lifecycleCompletion,
          artifacts: options.flowResult.artifacts,
        });
  const failedCommandFindings = Array.isArray(commandHealth.failed_commands)
    ? commandHealth.failed_commands.map((entry) => asNonEmptyString(asRecord(entry).summary)).filter(Boolean)
    : [];
  const runFindingSummaries = uniqueStrings([
    ...asStringArray(asRecord(options.observationReport.final_analysis).findings),
    ...failedCommandFindings,
    ...(Array.isArray(diagnosticHealth.failed_commands) ? diagnosticHealth.failed_commands : []).map(
      (entry) =>
        `Post-run diagnostic command '${asNonEmptyString(asRecord(entry).command) || "unknown"}' did not pass.`,
    ),
    ...(Array.isArray(diagnosticHealth.timed_out_commands) ? diagnosticHealth.timed_out_commands : []).map(
      (entry) =>
        `Post-run diagnostic command '${asNonEmptyString(asRecord(entry).command) || "unknown"}' timed out.`,
    ),
    ...asStringArray(controllerHealth.missing_operator_decision_steps).map((step) => `Missing operator decision for ${step}.`),
    ...asStringArray(evidenceHealth.missing_evidence_refs).map((ref) => `Missing evidence ref: ${ref}.`),
    ...asStringArray(evidenceHealth.weak_evidence_refs).map((ref) => `Weak or missing required evidence: ${ref}.`),
  ]);
  return {
    report_id: `${options.runId}.live-e2e-run-health.v1`,
    run_id: options.runId,
    profile_id: asNonEmptyString(options.profile.profile_id) || "unknown-profile",
    generated_at: nowIso(),
    source_run_summary_file: options.summaryFile,
    source_observation_report_file: options.observationReportFile,
    overall_status: overallStatus,
    lifecycle_completion: lifecycleCompletion,
    command_health: commandHealth,
    controller_health: controllerHealth,
    provider_health: providerHealth,
    target_readiness: targetReadiness,
    target_environment_health: targetEnvironmentHealth,
    diagnostic_health: diagnosticHealth,
    guided_ui_evidence: guidedUiEvidence,
    evidence_health: evidenceHealth,
    failure_summary: failureSummary,
    resume_interaction_health: resumeInteractionHealth,
    run_findings: runFindingSummaries.map((summary) => ({
      category: "run-health",
      severity: overallStatus === "pass" ? "info" : overallStatus === "warn" ? "medium" : "high",
      summary,
      evidence_refs: uniqueStrings([
        asNonEmptyString(options.observationReportFile),
        asNonEmptyString(options.observationReport.controller_state_ref),
      ]),
    })),
    evidence_refs: uniqueStrings([
      options.summaryFile,
      options.observationReportFile,
      asNonEmptyString(options.observationReport.controller_state_ref),
      ...options.stepObservationFiles,
      ...asStringArray(targetReadiness.evidence_refs),
      ...asStringArray(diagnosticHealth.evidence_refs),
      ...asStringArray(guidedUiEvidence.evidence_refs),
    ]),
  };
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
 * @param {Record<string, unknown>} summary
 * @returns {string}
 */
function resolveRunControlStatus(summary) {
  const providerStatus = asNonEmptyString(asRecord(summary.provider_step_status).status);
  if (["starting", "running", "silent-running", "artifact-updated", "timeout-risk"].includes(providerStatus)) {
    return "running";
  }
  const status = asNonEmptyString(summary.status);
  if (status === "pass") return "completed";
  if (status === "not_pass") return "failed";
  return status || "failed";
}

/**
 * @param {{
 *   layout: ReturnType<typeof ensureRuntimeLayout> | { reportsRoot: string, stateRoot?: string },
 *   runId: string,
 *   summary: Record<string, unknown>,
 * }} options
 * @returns {string}
 */
function writeAorRunControlState(options) {
  const stateRoot =
    asNonEmptyString(options.layout.stateRoot) ||
    path.join(path.dirname(options.layout.reportsRoot), "state");
  const controllerStateFile = asNonEmptyString(options.summary.live_e2e_controller_state_file);
  const controllerState = controllerStateFile && fileExists(controllerStateFile)
    ? asRecord(readJson(controllerStateFile))
    : {};
  const stateFile = path.join(
    stateRoot,
    `run-control-state-${normalizeId(options.runId)}.json`,
  );
  const evidenceRefs = uniqueStrings([
    asNonEmptyString(options.summary.live_e2e_run_summary_file),
    asNonEmptyString(options.summary.live_e2e_observation_report_file),
    asNonEmptyString(options.summary.live_e2e_run_health_report_file),
    asNonEmptyString(options.summary.live_e2e_controller_state_file),
    ...asStringArray(options.summary.live_e2e_step_observation_files),
    ...asStringArray(options.summary.scorecard_files),
  ]);
  const state = {
    schema_version: 1,
    run_id: options.runId,
    status: resolveRunControlStatus(options.summary),
    current_step:
      asNonEmptyString(controllerState.current_step) ||
      asNonEmptyString(options.summary.blocked_step_id) ||
      null,
    last_action: "external-runner-status",
    started_at: asNonEmptyString(options.summary.started_at) || null,
    updated_at:
      asNonEmptyString(options.summary.finished_at) ||
      asNonEmptyString(options.summary.started_at) ||
      nowIso(),
    action_sequence: 0,
    approval_refs: [],
    audit_refs: [],
    evidence_refs: evidenceRefs,
    evidence_root: options.layout.reportsRoot,
    provider_step_status:
      Object.keys(asRecord(options.summary.provider_step_status)).length > 0
        ? asRecord(options.summary.provider_step_status)
        : null,
  };
  writeJson(stateFile, state);
  return stateFile;
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
function writeProofRunnerArtifactsImplementation(options) {
  const summaryFile = path.join(
    options.layout.reportsRoot,
    `live-e2e-run-summary-${normalizeId(options.runId)}.json`,
  );
  const scorecardFile = path.join(
    options.layout.reportsRoot,
    `live-e2e-scorecard-target-${normalizeId(options.runId)}.json`,
  );
  const productionProofPolicy = buildProductionProofSummary(options.profile);
  hydrateFlowArtifactsFromControllerState(options.flowResult.artifacts);
  hydrateGuidedUiArtifactsFromReports(options.flowResult.artifacts, {
    reportsRoot: options.layout.reportsRoot,
    runId: options.runId,
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
  const stepQualityAssessmentReportFiles = uniqueStrings([
    ...asStringArray(options.flowResult.artifacts.live_e2e_step_quality_assessment_report_files),
    ...observationReport.step_journal
      .map((entry) => asNonEmptyString(asRecord(entry).step_quality_assessment_ref))
      .filter(Boolean),
  ]);
  const stepQualityAssessmentRequestFiles = uniqueStrings([
    ...asStringArray(options.flowResult.artifacts.live_e2e_step_quality_assessment_request_files),
    ...observationReport.step_journal
      .map((entry) => asNonEmptyString(asRecord(entry).step_quality_assessment_request_ref))
      .filter(Boolean),
  ]);
  const observationReportFile = path.join(
    options.layout.reportsRoot,
    `live-e2e-observation-report-${normalizeId(options.runId)}.json`,
  );
  observationReport.evidence_refs = uniqueStrings([
    ...asStringArray(observationReport.evidence_refs),
    ...stepObservationFiles,
    ...stepQualityAssessmentRequestFiles,
    ...stepQualityAssessmentReportFiles,
  ]);
  const observationValidation = validateContractDocument({
    family: "live-e2e-observation-report",
    document: observationReport,
    source: `runtime://live-e2e-observation/${options.runId}`,
  });
  if (!observationValidation.ok) {
    const issues = observationValidation.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Live E2E observation report failed contract validation: ${issues}`);
  }
  options.flowResult.artifacts.live_e2e_observation_report_file = observationReportFile;
  options.flowResult.artifacts.live_e2e_step_observation_files = stepObservationFiles;
  options.flowResult.artifacts.live_e2e_step_quality_assessment_request_files = stepQualityAssessmentRequestFiles;
  options.flowResult.artifacts.live_e2e_step_quality_assessment_report_files = stepQualityAssessmentReportFiles;
  options.flowResult.artifacts.live_e2e_observation_overall_status = observationReport.overall_status;
  const runHealthReportFile = path.join(
    options.layout.reportsRoot,
    `live-e2e-run-health-report-${normalizeId(options.runId)}.json`,
  );
  const runHealthReport = buildRunHealthReport({
    runId: options.runId,
    profile: options.profile,
    summaryFile,
    observationReportFile,
    observationReport,
    flowResult: options.flowResult,
    stepObservationFiles,
  });
  const runHealthValidation = validateContractDocument({
    family: "live-e2e-run-health-report",
    document: runHealthReport,
    source: `runtime://live-e2e-run-health/${options.runId}`,
  });
  if (!runHealthValidation.ok) {
    const issues = runHealthValidation.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Live E2E run-health report failed contract validation: ${issues}`);
  }
  options.flowResult.artifacts.live_e2e_run_health_report_file = runHealthReportFile;
  options.flowResult.artifacts.live_e2e_run_health_overall_status = runHealthReport.overall_status;
  const guidedBrowserTaskAppServerCleanup = cleanupGuidedBrowserTaskAppSurface(
    options.flowResult.artifacts,
    runHealthReport,
  );
  if (guidedBrowserTaskAppServerCleanup) {
    options.flowResult.artifacts.guided_browser_task_app_server_cleanup = guidedBrowserTaskAppServerCleanup;
  }
  const productionProof = applyProductionProofEvidence({
    productionProof: productionProofPolicy,
    flowResult: options.flowResult,
  });
  if (productionProof) {
    options.flowResult.artifacts.production_proof = productionProof;
  }
  refreshRuntimeHarnessChangeEvidenceForSummary(options.flowResult.artifacts, options.mission, productionProof);
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
  const summaryTargetReadiness = buildTargetReadiness(options.flowResult.artifacts);
  const summaryFailureFields = resolveTopLevelFailureFields(options.flowResult.artifacts, summaryTargetReadiness);
  const deliveryManifestFile =
    asNonEmptyString(productionProof?.evidence_refs?.delivery_manifest_file) ||
    asNonEmptyString(options.flowResult.artifacts.delivery_manifest_file) ||
    null;
  const deliveryManifestSummary = summarizeDeliveryManifest(deliveryManifestFile);
  const learningLoopScorecardFile = asNonEmptyString(options.flowResult.artifacts.learning_loop_scorecard_file) || null;
  const learningLoopHandoffFile = asNonEmptyString(options.flowResult.artifacts.learning_loop_handoff_file) || null;
  const learningHandoffSummary = summarizeLearningHandoff({
    artifacts: options.flowResult.artifacts,
    scorecardFile: learningLoopScorecardFile,
    handoffFile: learningLoopHandoffFile,
  });
  const artifactReadinessProof = buildArtifactReadinessProof({
    artifacts: options.flowResult.artifacts,
  });

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
    mission_class: options.flowResult.artifacts.mission_class ?? null,
    run_tier: resolveSummaryRunTier(options.profile),
    flow_kind: options.profile.flow_kind ?? null,
    duration_class: options.profile.duration_class ?? null,
    started_at: options.flowResult.startedAt,
    finished_at: options.flowResult.finishedAt,
    status: observationReport.overall_status,
    run_health_status: runHealthReport.overall_status,
    continuation_status: lifecycleCompleteness.continuation_status,
    blocked_step_id: lifecycleCompleteness.blocked_step_id,
    blocked_step_instance_id: lifecycleCompleteness.blocked_step_instance_id,
    lifecycle_completeness: lifecycleCompleteness,
    run_health: runHealthReport,
    command_health: runHealthReport.command_health,
    controller_health: runHealthReport.controller_health,
    evidence_health: runHealthReport.evidence_health,
    artifact_readiness_proof: artifactReadinessProof,
    failure_summary: runHealthReport.failure_summary,
    target_repo: asRecord(options.profile.target_repo),
    target_checkout_root:
      typeof options.flowResult.artifacts.target_checkout_root === "string"
        ? options.flowResult.artifacts.target_checkout_root
        : null,
    generated_project_profile_file:
      typeof options.flowResult.artifacts.generated_project_profile_file === "string"
        ? options.flowResult.artifacts.generated_project_profile_file
        : null,
    feature_request_file:
      typeof options.flowResult.artifacts.feature_request_file === "string"
        ? options.flowResult.artifacts.feature_request_file
        : null,
    intake_artifact_packet_file:
      typeof options.flowResult.artifacts.intake_artifact_packet_file === "string"
        ? options.flowResult.artifacts.intake_artifact_packet_file
        : null,
    intake_artifact_packet_body_file:
      typeof options.flowResult.artifacts.intake_artifact_packet_body_file === "string"
        ? options.flowResult.artifacts.intake_artifact_packet_body_file
        : null,
    discovery_analysis_report_file:
      typeof options.flowResult.artifacts.discovery_analysis_report_file === "string"
        ? options.flowResult.artifacts.discovery_analysis_report_file
        : null,
    spec_step_result_file:
      typeof options.flowResult.artifacts.spec_step_result_file === "string"
        ? options.flowResult.artifacts.spec_step_result_file
        : null,
    approved_handoff_packet_file:
      typeof options.flowResult.artifacts.approved_handoff_packet_file === "string"
        ? options.flowResult.artifacts.approved_handoff_packet_file
        : null,
    handoff_packet_file:
      typeof options.flowResult.artifacts.handoff_packet_file === "string"
        ? options.flowResult.artifacts.handoff_packet_file
        : null,
    project_init_transcript_file:
      typeof options.flowResult.artifacts.project_init_transcript_file === "string"
        ? options.flowResult.artifacts.project_init_transcript_file
        : null,
    execution_readiness_file:
      typeof options.flowResult.artifacts.execution_readiness_file === "string"
        ? options.flowResult.artifacts.execution_readiness_file
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
    target_readiness: summaryTargetReadiness,
    target_pre_execution_status_file:
      typeof options.flowResult.artifacts.target_pre_execution_status_file === "string"
        ? options.flowResult.artifacts.target_pre_execution_status_file
        : null,
    target_pre_execution_status:
      typeof options.flowResult.artifacts.target_pre_execution_status === "object" &&
      options.flowResult.artifacts.target_pre_execution_status
        ? options.flowResult.artifacts.target_pre_execution_status
        : null,
    target_toolchain_preflight_file:
      typeof options.flowResult.artifacts.target_toolchain_preflight_file === "string"
        ? options.flowResult.artifacts.target_toolchain_preflight_file
        : null,
    target_toolchain_preflight:
      typeof options.flowResult.artifacts.target_toolchain_preflight === "object" &&
      options.flowResult.artifacts.target_toolchain_preflight
        ? options.flowResult.artifacts.target_toolchain_preflight
        : null,
    target_setup_status:
      typeof options.flowResult.artifacts.target_setup_status === "object" && options.flowResult.artifacts.target_setup_status
        ? options.flowResult.artifacts.target_setup_status
        : null,
    target_verification_status_detail:
      typeof options.flowResult.artifacts.target_verification_status_detail === "object" &&
      options.flowResult.artifacts.target_verification_status_detail
        ? options.flowResult.artifacts.target_verification_status_detail
        : null,
    failure_owner: summaryFailureFields.owner,
    failure_phase: summaryFailureFields.phase,
    failure_class: summaryFailureFields.class,
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
    provider_step_status:
      typeof options.flowResult.artifacts.provider_step_status === "object" && options.flowResult.artifacts.provider_step_status
        ? options.flowResult.artifacts.provider_step_status
        : null,
    real_code_change_status: asNonEmptyString(options.flowResult.artifacts.real_code_change_status) || null,
    meaningful_changed_paths: Array.isArray(options.flowResult.artifacts.meaningful_changed_paths)
      ? options.flowResult.artifacts.meaningful_changed_paths
      : [],
    runtime_harness_decision: asNonEmptyString(options.flowResult.artifacts.runtime_harness_decision) || null,
    run_start_runtime_harness_decision:
      asNonEmptyString(options.flowResult.artifacts.run_start_runtime_harness_decision) || null,
    latest_runtime_harness_decision:
      asNonEmptyString(options.flowResult.artifacts.latest_runtime_harness_decision) || null,
    compiled_context_ref:
      typeof options.flowResult.artifacts.compiled_context_ref === "string"
        ? options.flowResult.artifacts.compiled_context_ref
        : null,
    adapter_raw_evidence_ref:
      typeof options.flowResult.artifacts.adapter_raw_evidence_ref === "string"
        ? options.flowResult.artifacts.adapter_raw_evidence_ref
        : null,
    request_artifact_ref:
      typeof options.flowResult.artifacts.request_artifact_ref === "string"
        ? options.flowResult.artifacts.request_artifact_ref
        : null,
    provider_work_packet_ref:
      typeof options.flowResult.artifacts.provider_work_packet_ref === "string"
        ? options.flowResult.artifacts.provider_work_packet_ref
        : null,
    context_budget_status: asNonEmptyString(options.flowResult.artifacts.context_budget_status) || null,
    context_budget_failure_class: asNonEmptyString(options.flowResult.artifacts.context_budget_failure_class) || null,
    raw_provider_error_summary: asNonEmptyString(options.flowResult.artifacts.raw_provider_error_summary) || null,
    top_context_size_sources: Array.isArray(options.flowResult.artifacts.top_context_size_sources)
      ? options.flowResult.artifacts.top_context_size_sources
      : [],
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
    guided_web_smoke_summary_file: asNonEmptyString(options.flowResult.artifacts.guided_web_smoke_summary_file) || null,
    guided_web_smoke_html_file: asNonEmptyString(options.flowResult.artifacts.guided_web_smoke_html_file) || null,
    guided_web_dom_snapshot_file: asNonEmptyString(options.flowResult.artifacts.guided_web_dom_snapshot_file) || null,
    guided_web_accessibility_summary_file:
      asNonEmptyString(options.flowResult.artifacts.guided_web_accessibility_summary_file) || null,
    guided_web_visual_guardrail_file:
      asNonEmptyString(options.flowResult.artifacts.guided_web_visual_guardrail_file) || null,
    guided_browser_task_proof_request_file:
      asNonEmptyString(options.flowResult.artifacts.guided_browser_task_proof_request_file) || null,
    guided_browser_task_proof_file: asNonEmptyString(options.flowResult.artifacts.guided_browser_task_proof_file) || null,
    guided_browser_task_app_server_cleanup:
      typeof options.flowResult.artifacts.guided_browser_task_app_server_cleanup === "object" &&
      options.flowResult.artifacts.guided_browser_task_app_server_cleanup
        ? options.flowResult.artifacts.guided_browser_task_app_server_cleanup
        : null,
    early_guided_web_smoke_summary_file:
      asNonEmptyString(options.flowResult.artifacts.early_guided_web_smoke_summary_file) || null,
    early_guided_web_smoke_html_file:
      asNonEmptyString(options.flowResult.artifacts.early_guided_web_smoke_html_file) || null,
    early_guided_web_dom_snapshot_file:
      asNonEmptyString(options.flowResult.artifacts.early_guided_web_dom_snapshot_file) || null,
    early_guided_web_accessibility_summary_file:
      asNonEmptyString(options.flowResult.artifacts.early_guided_web_accessibility_summary_file) || null,
    early_guided_web_visual_guardrail_file:
      asNonEmptyString(options.flowResult.artifacts.early_guided_web_visual_guardrail_file) || null,
    early_guided_browser_task_proof_request_file:
      asNonEmptyString(options.flowResult.artifacts.early_guided_browser_task_proof_request_file) || null,
    early_guided_browser_task_proof_file:
      asNonEmptyString(options.flowResult.artifacts.early_guided_browser_task_proof_file) || null,
    early_guided_browser_task_app_server_cleanup:
      typeof options.flowResult.artifacts.early_guided_browser_task_app_server_cleanup === "object" &&
      options.flowResult.artifacts.early_guided_browser_task_app_server_cleanup
        ? options.flowResult.artifacts.early_guided_browser_task_app_server_cleanup
        : null,
    guided_ui_evidence:
      typeof observationReport.guided_ui_evidence === "object" && observationReport.guided_ui_evidence
        ? observationReport.guided_ui_evidence
        : null,
    live_e2e_observation_report_file: observationReportFile,
    live_e2e_controller_state_file: asNonEmptyString(options.flowResult.artifacts.live_e2e_controller_state_file) || null,
    live_e2e_step_observation_files: stepObservationFiles,
    live_e2e_step_quality_assessment_request_files: stepQualityAssessmentRequestFiles,
    live_e2e_step_quality_assessment_report_files: stepQualityAssessmentReportFiles,
    live_e2e_observation_overall_status: observationReport.overall_status,
    live_e2e_run_health_report_file: runHealthReportFile,
    live_e2e_run_health_overall_status: runHealthReport.overall_status,
    operator_context: observationReport.operator_context,
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
    delivery_manifest_file: deliveryManifestFile,
    delivery_manifest_summary: deliveryManifestSummary,
    delivery_plan_file: asNonEmptyString(options.flowResult.artifacts.delivery_plan_file) || null,
    release_packet_file: asNonEmptyString(options.flowResult.artifacts.release_packet_file) || null,
    learning_loop_scorecard_file: learningLoopScorecardFile,
    learning_loop_handoff_file: learningLoopHandoffFile,
    learning_handoff_summary: learningHandoffSummary,
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
      quality_assessment_prepare:
        "node ./scripts/live-e2e/quality-assessment.mjs prepare --run-summary-file <live_e2e_run_summary_file>",
      quality_assessment_validate:
        "node ./scripts/live-e2e/quality-assessment.mjs validate --assessment-report-file <live_e2e_quality_assessment_report_file>",
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
  writeJson(runHealthReportFile, runHealthReport);
  writeJson(summaryFile, summary);
  writeJson(scorecardFile, scorecard);
  summary.live_e2e_run_summary_file = summaryFile;
  const runControlStateFile = writeAorRunControlState({
    layout: options.layout,
    runId: options.runId,
    summary,
  });
  summary.run_control_state_file = runControlStateFile;
  writeJson(summaryFile, summary);

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
    writeAorRunControlState({
      layout: options.layout,
      runId: options.runId,
      summary,
    });
    writeJson(summaryFile, summary);
  }

  return {
    summary,
    summaryFile,
    scorecard,
    scorecardFile,
    observationReport,
    observationReportFile,
    runHealthReport,
    runHealthReportFile,
    runControlStateFile,
    learningLoop,
  };
}

export function writeProofRunnerArtifacts(options) { return writeProofRunnerArtifactsImplementation(options); }

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
  if (fullJourneyResolution && isManualOnlyFeatureSize(fullJourneyResolution.featureSize) && controllerMode !== "manual") {
    throw new UsageError(
      `Profile '${asNonEmptyString(profile.profile_id) || profileRef}' targets feature_size=xlarge, which is manual-only. Use manual-live-e2e.mjs so each controller step is operator-inspected.`,
    );
  }
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
  const existingTerminalArtifacts = loadExistingTerminalProofRunnerArtifacts({ layout, runId, profile });
  if (existingTerminalArtifacts) {
    writeExistingProofRunnerOutput({
      runId,
      existing: existingTerminalArtifacts,
    });
    return 0;
  }
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
    const pendingOperatorDecision = stepController.applyPendingOperatorDecision?.();
    if (asRecord(pendingOperatorDecision).applied === true) {
      flowResult = {
        startedAt: nowIso(),
        finishedAt: nowIso(),
        status: "fail",
        stageResults: [],
        commandResults: [],
        artifacts: {
          host_runtime_root: layout.runtimeRoot,
          host_reports_root: layout.reportsRoot,
          live_e2e_controller_state_file: stepController.stateFile,
          live_e2e_step_journal_entries: stepController.getStepJournal(),
          live_e2e_controller_stop: {
            reason: `Live E2E controller applied pending operator decision '${asNonEmptyString(asRecord(pendingOperatorDecision).action)}'.`,
            state: asRecord(pendingOperatorDecision).state,
            decision: asRecord(pendingOperatorDecision).decision,
          },
          aor_installation: aorInstallation.proof,
          aor_installation_proof_file: aorInstallation.proofFile,
          live_e2e_setup_journal_entries: [aorInstallation.setupEntry],
          runtime_agent_permission_mode: runtimeAgentPermissionMode,
          runtime_agent_interaction_policy: runtimeAgentInteractionPolicy,
          runtime_agent_auto_approval_profile: runtimeAgentAutoApprovalProfile,
        },
      };
    } else {
      const persistedControllerStop = stepController.getPersistedControllerStop?.();
      if (asRecord(persistedControllerStop).persisted === true) {
        flowResult = {
          startedAt: nowIso(),
          finishedAt: nowIso(),
          status: "fail",
          stageResults: [],
          commandResults: [],
          artifacts: {
            host_runtime_root: layout.runtimeRoot,
            host_reports_root: layout.reportsRoot,
            live_e2e_controller_state_file: stepController.stateFile,
            live_e2e_step_journal_entries: stepController.getStepJournal(),
            live_e2e_controller_stop: {
              reason: `Live E2E controller resumed persisted decision '${asNonEmptyString(asRecord(persistedControllerStop).action)}'.`,
              state: asRecord(persistedControllerStop).state,
              decision: asRecord(persistedControllerStop).decision,
            },
            aor_installation: aorInstallation.proof,
            aor_installation_proof_file: aorInstallation.proofFile,
            live_e2e_setup_journal_entries: [aorInstallation.setupEntry],
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
          const classification = classifyEarlyFlowFailure(error);
          const errorMessage = error instanceof Error ? error.message : String(error);
          flowResult = {
            startedAt: nowIso(),
            finishedAt: nowIso(),
            status: "fail",
            stageResults: [
              {
                stage: "bootstrap",
                status: "fail",
                evidence_refs: [],
                summary: errorMessage,
                failure_owner: classification.owner,
                failure_phase: classification.phase,
                failure_class: classification.class,
              },
            ],
            commandResults: [],
            artifacts: {
              host_runtime_root: layout.runtimeRoot,
              host_reports_root: layout.reportsRoot,
              live_e2e_controller_state_file: stepController.stateFile,
              live_e2e_step_journal_entries: stepController.getStepJournal(),
              failure_owner: classification.owner,
              failure_phase: classification.phase,
              failure_class: classification.class,
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
    }
  }
  flowResult.artifacts.aor_installation = aorInstallation.proof;
  flowResult.artifacts.aor_installation_proof_file = aorInstallation.proofFile;
  flowResult.artifacts.live_e2e_setup_journal_entries = [aorInstallation.setupEntry];
  flowResult.artifacts.live_e2e_controller_state_file =
    asNonEmptyString(flowResult.artifacts.live_e2e_controller_state_file) || stepController.stateFile;
  flowResult.artifacts.live_e2e_step_journal_entries = stepController.getStepJournal();

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
        live_e2e_run_health_status: written.runHealthReport.overall_status,
        live_e2e_run_summary_file: written.summaryFile,
        live_e2e_run_health_report_file: written.runHealthReportFile,
        run_control_state_file: written.runControlStateFile,
        live_e2e_observation_report_file: written.summary.live_e2e_observation_report_file,
        aor_installation_proof_file: written.summary.aor_installation_proof_file,
        live_e2e_controller_state_file: written.summary.live_e2e_controller_state_file,
        live_e2e_step_observation_files: written.summary.live_e2e_step_observation_files,
        live_e2e_step_quality_assessment_request_files: written.summary.live_e2e_step_quality_assessment_request_files,
        live_e2e_step_quality_assessment_report_files: written.summary.live_e2e_step_quality_assessment_report_files,
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
