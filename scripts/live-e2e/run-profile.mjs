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
  isManualOnlyFeatureSize,
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
    task_outcome: {
      status: "pass",
      checked_tasks: uniqueStrings([
        ...asStringArray(asRecord(webSmoke.task_outcome).checked_tasks),
        ...asStringArray(proofOutcome.checked_tasks),
      ]),
      findings: asStringArray(proofOutcome.findings),
    },
    ux_findings: uniqueStrings([...asStringArray(webSmoke.ux_findings), ...asStringArray(proof.ux_findings)]),
    agent_verdict_ref:
      asNonEmptyString(proof.agent_verdict_ref) ||
      asNonEmptyString(webSmoke.agent_verdict_ref),
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
    target_pre_execution_status:
      typeof options.flowResult.artifacts.target_pre_execution_status === "object" &&
      options.flowResult.artifacts.target_pre_execution_status
        ? options.flowResult.artifacts.target_pre_execution_status
        : null,
    failure_owner: asNonEmptyString(options.flowResult.artifacts.failure_owner) || null,
    failure_phase: asNonEmptyString(options.flowResult.artifacts.failure_phase) || null,
    failure_class: asNonEmptyString(options.flowResult.artifacts.failure_class) || null,
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
  const webSmoke = mergeBrowserTaskProofIntoWebSmoke(artifacts, asRecord(artifacts.guided_web_smoke));
  const summaryFile = asNonEmptyString(artifacts.guided_web_smoke_summary_file);
  const htmlFile =
    asNonEmptyString(webSmoke.rendered_html_file) ||
    asNonEmptyString(artifacts.guided_web_smoke_html_file);
  const domSnapshotFile =
    asNonEmptyString(webSmoke.dom_snapshot_file) ||
    asNonEmptyString(artifacts.guided_web_dom_snapshot_file);
  const accessibilitySummaryFile =
    asNonEmptyString(webSmoke.accessibility_summary_file) ||
    asNonEmptyString(artifacts.guided_web_accessibility_summary_file);
  const visualGuardrailFile =
    asNonEmptyString(webSmoke.visual_guardrail_file) ||
    asNonEmptyString(artifacts.guided_web_visual_guardrail_file);
  const browserTaskProofRequestFile = asNonEmptyString(artifacts.guided_browser_task_proof_request_file);
  const browserTaskProofFile =
    asNonEmptyString(webSmoke.browser_task_proof_file) ||
    asNonEmptyString(artifacts.guided_browser_task_proof_file);
  const screenshotRefs = uniqueStrings([
    ...asStringArray(artifacts.guided_web_screenshot_files),
    ...asStringArray(webSmoke.screenshot_files),
    ...asStringArray(webSmoke.screenshot_refs),
  ]);
  if (
    !summaryFile &&
    !htmlFile &&
    !domSnapshotFile &&
    !visualGuardrailFile &&
    !browserTaskProofFile &&
    screenshotRefs.length === 0
  ) return [];
  const taskOutcome = asRecord(webSmoke.task_outcome);
  const status = toObservationStatus(asNonEmptyString(taskOutcome.status) || "pass");
  const learningVerdict = stepJournal.find(
    (entry) =>
      asNonEmptyString(asRecord(entry).step_id) === "learning" &&
      asNonEmptyString(asRecord(entry).operator_decision_status) === "accepted" &&
      asNonEmptyString(asRecord(asRecord(entry).semantic_analysis).judge_source) === "skill-agent",
  );
  const agentVerdictRef =
    asNonEmptyString(webSmoke.agent_verdict_ref) ||
    asNonEmptyString(asRecord(learningVerdict).operator_decision_ref) ||
    null;
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
        browserTaskProofRequestFile,
        browserTaskProofFile,
        ...screenshotRefs,
      ]),
      html_ref: htmlFile || asNonEmptyString(webSmoke.html_ref) || null,
      screenshot_refs: screenshotRefs,
      visual_guardrail_refs: uniqueStrings([visualGuardrailFile]),
      browser_task_proof_ref: browserTaskProofFile || null,
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
  const direct = asRecord(artifacts.provider_step_status);
  if (Object.keys(direct).length > 0) return direct;

  const controllerEntries = Array.isArray(artifacts.live_e2e_step_journal_entries)
    ? artifacts.live_e2e_step_journal_entries.map((entry) => asRecord(entry))
    : [];
  for (let index = controllerEntries.length - 1; index >= 0; index -= 1) {
    const providerStepStatus = asRecord(controllerEntries[index].provider_step_status);
    if (Object.keys(providerStepStatus).length > 0) return providerStepStatus;
  }

  const commandResults = Array.isArray(artifacts.command_results)
    ? artifacts.command_results.map((entry) => asRecord(entry))
    : [];
  for (let index = commandResults.length - 1; index >= 0; index -= 1) {
    const providerStepStatus = asRecord(commandResults[index].provider_step_status);
    if (Object.keys(providerStepStatus).length > 0) return providerStepStatus;
  }

  return {};
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
    const currentPresent =
      typeof current === "string"
        ? current.length > 0
        : typeof current === "object" && current
          ? Object.keys(asRecord(current)).length > 0
          : current !== null && current !== undefined;
    const candidatePresent =
      typeof candidate === "string"
        ? candidate.length > 0
        : typeof candidate === "object" && candidate
          ? Object.keys(asRecord(candidate)).length > 0
          : candidate !== null && candidate !== undefined;
    if (!currentPresent && candidatePresent) {
      artifacts[key] = candidate;
    }
  };

  for (const key of [
    "target_checkout_root",
    "target_pre_execution_status_file",
    "target_pre_execution_status",
    "target_setup_status",
    "target_verification_status_detail",
    "failure_owner",
    "failure_phase",
    "failure_class",
    "baseline_verify_status",
    "baseline_verify_summary_file",
    "baseline_verify_gate_decision",
    "execution_readiness_file",
    "target_cleanliness_before_execution_file",
    "target_cleanliness_before_execution",
    "routed_step_result_file",
    "runtime_harness_report_file",
    "latest_runtime_harness_report_file",
    "delivery_runtime_harness_report_file",
    "run_start_runtime_harness_report_file",
    "runtime_harness_decision",
    "latest_runtime_harness_decision",
    "run_start_runtime_harness_decision",
    "runtime_harness_overall_decision",
    "adapter_raw_evidence_ref",
    "provider_execution_status",
    "real_code_change_status",
    "code_quality_status",
    "review_report_file",
    "evaluation_report_file",
    "post_run_verify_summary_file",
    "post_run_verify_status",
    "post_run_diagnostic_verify_summary_file",
    "post_run_diagnostic_status",
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
    "matrix_cell",
    "coverage_follow_up",
  ]) {
    copyIfMissing(key);
  }

  const latestProviderStepStatus = latestProviderStepStatusFromArtifacts(artifacts);
  if (Object.keys(latestProviderStepStatus).length > 0) {
    artifacts.provider_step_status = latestProviderStepStatus;
    const providerClassification = classifyProviderStepStatus(latestProviderStepStatus);
    if (!asNonEmptyString(artifacts.provider_execution_status)) {
      artifacts.provider_execution_status = providerClassification.provider_execution_status;
    }
    if (!asNonEmptyString(artifacts.failure_owner) && providerClassification.failure_owner) {
      artifacts.failure_owner = providerClassification.failure_owner;
      artifacts.failure_phase = providerClassification.failure_phase;
      artifacts.failure_class = providerClassification.failure_class;
    }
  }
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
  let status = "pass";
  for (const step of journalEntries) {
    status = worstObservationStatus(status, asNonEmptyString(step.final_step_verdict) || "not_pass");
  }
  if (failingStages.length > 0) {
    status = worstObservationStatus(status, "not_pass");
  }
  const findings = uniqueStrings([
    ...journalEntries.flatMap((entry) => asStringArray(asRecord(entry.semantic_analysis).findings)),
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
    target_setup_status:
      typeof options.flowResult.artifacts.target_setup_status === "object" && options.flowResult.artifacts.target_setup_status
        ? options.flowResult.artifacts.target_setup_status
        : null,
    target_verification_status:
      typeof options.flowResult.artifacts.target_verification_status_detail === "object" &&
      options.flowResult.artifacts.target_verification_status_detail
        ? options.flowResult.artifacts.target_verification_status_detail
        : null,
    provider_step_status:
      typeof options.flowResult.artifacts.provider_step_status === "object" && options.flowResult.artifacts.provider_step_status
        ? options.flowResult.artifacts.provider_step_status
        : null,
    provider_execution_status: asNonEmptyString(options.flowResult.artifacts.provider_execution_status) || null,
    failure_owner: asNonEmptyString(options.flowResult.artifacts.failure_owner) || null,
    failure_phase: asNonEmptyString(options.flowResult.artifacts.failure_phase) || null,
    failure_class: asNonEmptyString(options.flowResult.artifacts.failure_class) || null,
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
 * @param {Record<string, unknown>} diagnostic
 * @returns {boolean}
 */
function commandCompletedForRunHealth(diagnostic) {
  return asNonEmptyString(diagnostic.status) === "pass" || diagnostic.accepted_nonzero_payload === true;
}

/**
 * @param {{ flowResult: { commandResults: Array<Record<string, unknown>> } }} options
 * @returns {Record<string, unknown>}
 */
function buildCommandHealth(options) {
  const failedCommands = options.flowResult.commandResults
    .filter((entry) => !commandCompletedForRunHealth(entry))
    .map((entry) => ({
      command_surface: asNonEmptyString(entry.command_surface) || asNonEmptyString(entry.command) || "unknown",
      status: asNonEmptyString(entry.status) || "unknown",
      exit_code: typeof entry.exit_code === "number" ? entry.exit_code : null,
      transcript_ref: asNonEmptyString(entry.transcript_ref) || null,
      summary: asNonEmptyString(entry.summary) || asNonEmptyString(entry.stderr) || "Public command did not complete.",
    }));
  return {
    status: failedCommands.length === 0 ? "pass" : "fail",
    command_count: options.flowResult.commandResults.length,
    failed_command_count: failedCommands.length,
    failed_commands: failedCommands,
  };
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
  const providerExecutionStatus =
    asNonEmptyString(artifacts.provider_execution_status) ||
    asNonEmptyString(providerStepStatus.status) ||
    "not_attempted";
  const status =
    providerExecutionStatus === "pass" ||
    providerExecutionStatus === "completed" ||
    providerExecutionStatus === "not_attempted"
      ? "pass"
      : providerExecutionStatus === "interrupted"
        ? "blocked"
        : "fail";
  return {
    status,
    provider_execution_status: providerExecutionStatus,
    provider_step_status: Object.keys(providerStepStatus).length > 0 ? providerStepStatus : null,
    adapter_raw_evidence_ref: asNonEmptyString(artifacts.adapter_raw_evidence_ref) || null,
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
  const verificationStatus =
    asNonEmptyString(targetVerificationStatus.status) ||
    asNonEmptyString(artifacts.post_run_verify_status) ||
    "not_attempted";
  const status = [setupStatus, verificationStatus].includes("fail")
    ? "fail"
    : [setupStatus, verificationStatus].includes("blocked")
      ? "blocked"
      : "pass";
  return {
    status,
    target_setup_status: setupStatus,
    target_verification_status: verificationStatus,
    failure_owner: asNonEmptyString(artifacts.failure_owner) || null,
    failure_phase: asNonEmptyString(artifacts.failure_phase) || null,
    failure_class: asNonEmptyString(artifacts.failure_class) || null,
  };
}

/**
 * @param {{ observationReport: Record<string, unknown>, stepObservationFiles: string[] }} options
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
  return {
    status: missingEvidenceRefs.length === 0 ? "pass" : "warn",
    missing_evidence_refs: missingEvidenceRefs,
    weak_evidence_refs: [],
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
 *   targetEnvironmentHealth: Record<string, unknown>,
 *   evidenceHealth: Record<string, unknown>,
 *   resumeInteractionHealth: Record<string, unknown>,
 *   lifecycleCompletion: Record<string, unknown>,
 *   artifacts: Record<string, unknown>,
 * }} options
 * @returns {Record<string, unknown>}
 */
function resolveRunHealthFailure(options) {
  const declaredOwner = asNonEmptyString(options.artifacts.failure_owner);
  const declaredPhase = asNonEmptyString(options.artifacts.failure_phase);
  const declaredClass = asNonEmptyString(options.artifacts.failure_class);
  if (declaredOwner || declaredPhase || declaredClass) {
    return {
      owner: declaredOwner || "unknown",
      phase: declaredPhase || "unknown",
      class: declaredClass || "declared_failure",
      summary: "Run artifacts declared a primary failure owner, phase, or class.",
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
  if (asNonEmptyString(options.commandHealth.status) === "fail") {
    return {
      owner: "aor",
      phase: "unknown",
      class: "public_command_failed",
      summary: "One or more public live E2E commands failed.",
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
    return {
      owner: "target_repository",
      phase:
        asNonEmptyString(options.targetEnvironmentHealth.target_setup_status) === "fail"
          ? "target_setup"
          : "target_verification",
      class: "target_environment_failed",
      summary: "Target setup or target verification failed during the run.",
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
    owner: null,
    phase: null,
    class: null,
    summary: null,
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
  const commandHealth = buildCommandHealth({ flowResult: options.flowResult });
  const controllerHealth = buildControllerHealth({ observationReport: options.observationReport });
  const providerHealth = buildProviderHealth(options.flowResult.artifacts);
  const targetEnvironmentHealth = buildTargetEnvironmentHealth(options.flowResult.artifacts);
  const evidenceHealth = buildEvidenceHealth({
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
    asNonEmptyString(resumeInteractionHealth.status) === "blocked";
  const hasFailedRun =
    observationStatus === "not_pass" ||
    asNonEmptyString(commandHealth.status) === "fail" ||
    asNonEmptyString(providerHealth.status) === "fail" ||
    asNonEmptyString(targetEnvironmentHealth.status) === "fail";
  const overallStatus = hasBlockingRunControl
    ? "blocked"
    : hasFailedRun
      ? "fail"
      : asNonEmptyString(lifecycleCompletion.continuation_status) !== "complete"
        ? "blocked"
        : observationStatus === "warn" || asNonEmptyString(evidenceHealth.status) === "warn"
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
          targetEnvironmentHealth,
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
    ...asStringArray(controllerHealth.missing_operator_decision_steps).map((step) => `Missing operator decision for ${step}.`),
    ...asStringArray(evidenceHealth.missing_evidence_refs).map((ref) => `Missing evidence ref: ${ref}.`),
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
    target_environment_health: targetEnvironmentHealth,
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
  hydrateFlowArtifactsFromControllerState(options.flowResult.artifacts);
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
  observationReport.evidence_refs = uniqueStrings([
    ...asStringArray(observationReport.evidence_refs),
    ...stepObservationFiles,
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
  const productionProof = applyProductionProofEvidence({
    productionProof: productionProofPolicy,
    flowResult: options.flowResult,
  });
  if (productionProof) {
    options.flowResult.artifacts.production_proof = productionProof;
  }
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
    target_pre_execution_status_file:
      typeof options.flowResult.artifacts.target_pre_execution_status_file === "string"
        ? options.flowResult.artifacts.target_pre_execution_status_file
        : null,
    target_pre_execution_status:
      typeof options.flowResult.artifacts.target_pre_execution_status === "object" &&
      options.flowResult.artifacts.target_pre_execution_status
        ? options.flowResult.artifacts.target_pre_execution_status
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
    failure_owner: asNonEmptyString(options.flowResult.artifacts.failure_owner) || null,
    failure_phase: asNonEmptyString(options.flowResult.artifacts.failure_phase) || null,
    failure_class: asNonEmptyString(options.flowResult.artifacts.failure_class) || null,
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
    runHealthReport,
    runHealthReportFile,
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
        live_e2e_run_health_status: written.runHealthReport.overall_status,
        live_e2e_run_summary_file: written.summaryFile,
        live_e2e_run_health_report_file: written.runHealthReportFile,
        live_e2e_observation_report_file: written.summary.live_e2e_observation_report_file,
        aor_installation_proof_file: written.summary.aor_installation_proof_file,
        live_e2e_controller_state_file: written.summary.live_e2e_controller_state_file,
        live_e2e_step_observation_files: written.summary.live_e2e_step_observation_files,
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
