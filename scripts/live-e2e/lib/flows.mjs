import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  asNonEmptyString,
  asRecord,
  asStringArray,
  evidenceRefMaterialized,
  fileExists,
  normalizeId,
  nowIso,
  readJson,
  uniqueStrings,
  writeJson,
} from "./common.mjs";
import {
  closeQualityRepairRequest,
  listQualityRepairRequests,
} from "../../../packages/observability/src/index.mjs";
import { createStageMap, flattenStageMap, getProfileStages, markStage as markStageRaw } from "./stages.mjs";
import {
  buildLiveE2eStepInstanceId,
  isLiveE2eControllerStop,
  resolveLiveE2eCommandStep,
} from "./step-controller.mjs";
import { DEFAULT_BACKLOG_REFS, createProofRunnerEnvironment, createSessionRoots } from "./profile-catalog.mjs";
import {
  buildGuidedJourneyProof,
  isGuidedJourneyEnabled,
  writeValidatedGuidedJourneyProof,
} from "./guided-proof.mjs";
import {
  materializeFeatureRequestFile,
  materializeGeneratedProjectProfile,
  materializeHostLiveE2eAssets,
  materializeProviderPinnedPolicyOverrides,
  materializeProviderPinnedRouteOverrides,
  materializeTargetCheckout,
  normalizeDeliveryMode,
} from "./target-materialization.mjs";
import { resolveAuthProbeRequired, runLiveAdapterPreflight } from "./preflight.mjs";
import { collectMissionChangeEvidence } from "./mission-scope.mjs";

const MIN_LIVE_E2E_AOR_COMMAND_TIMEOUT_MS = 30_000;
const LIVE_E2E_AOR_COMMAND_TIMEOUT_OVERHEAD_MS = 60_000;
const AOR_OPERATOR_ACCESSIBILITY_CHECK_IDS = Object.freeze([
  "keyboard_navigation",
  "focus_order",
  "contrast_and_readability",
  "semantic_structure",
  "screen_reader_labels",
  "accessible_error_feedback",
]);

/**
 * @param {Record<string, string>} routeOverrides
 * @returns {string | null}
 */
function serializeRouteOverrides(routeOverrides) {
  const pairs = Object.entries(routeOverrides)
    .filter(([, routeId]) => typeof routeId === "string" && routeId.length > 0)
    .map(([step, routeId]) => `${step}=${routeId}`);
  return pairs.length > 0 ? pairs.join(",") : null;
}

/**
 * @param {Record<string, string>} policyOverrides
 * @returns {string | null}
 */
function serializePolicyOverrides(policyOverrides) {
  const pairs = Object.entries(policyOverrides)
    .filter(([, policyId]) => typeof policyId === "string" && policyId.length > 0)
    .map(([step, policyId]) => `${step}=${policyId}`);
  return pairs.length > 0 ? pairs.join(",") : null;
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function looksLikeEvidenceRef(value) {
  return (
    value.startsWith("evidence://") ||
    value.startsWith("compiled-context://") ||
    value.startsWith("packet://") ||
    value.includes("/") ||
    value.includes("\\") ||
    /\.(json|jsonl|yaml|yml|patch|log)$/iu.test(value)
  );
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function collectStringRefs(value) {
  if (typeof value === "string") {
    return looksLikeEvidenceRef(value.trim()) ? [value.trim()] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectStringRefs(entry));
  }
  if (typeof value === "object" && value !== null) {
    return Object.values(value).flatMap((entry) => collectStringRefs(entry));
  }
  return [];
}

/**
 * @param {unknown} value
 * @returns {Array<Record<string, unknown>>}
 */
function collectFindingRecords(value) {
  if (typeof value === "string" && value.trim().length > 0) return [{ summary: value.trim() }];
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (typeof entry === "string") return { summary: entry.trim() };
      return asRecord(entry);
    })
    .filter((entry) => Object.keys(entry).length > 0);
}

/**
 * @param {unknown} value
 * @returns {Array<Record<string, unknown>>}
 */
function asRecordList(value) {
  return Array.isArray(value)
    ? value.filter((entry) => typeof entry === "object" && entry !== null && !Array.isArray(entry)).map(asRecord)
    : [];
}

/**
 * @param {Record<string, unknown>} reviewReport
 * @returns {Array<Record<string, unknown>>}
 */
function collectReviewFindingRecords(reviewReport) {
  return [
    ...collectFindingRecords(reviewReport.blocking_findings),
    ...collectFindingRecords(reviewReport.findings),
    ...collectFindingRecords(reviewReport.recommended_followups),
    ...collectFindingRecords(asRecord(reviewReport.discovery_quality).findings),
    ...collectFindingRecords(asRecord(reviewReport.artifact_quality).findings),
    ...collectFindingRecords(asRecord(reviewReport.code_quality).findings),
    ...collectFindingRecords(asRecord(reviewReport.feature_size_fit).findings),
    ...collectFindingRecords(asRecord(reviewReport.provider_traceability).findings),
  ];
}

/**
 * @param {Record<string, unknown>} reviewReport
 * @returns {string[]}
 */
function collectReviewFindingSummaries(reviewReport) {
  return uniqueStrings([
    ...collectReviewFindingRecords(reviewReport)
      .map((finding) =>
        asNonEmptyString(finding.summary) ||
        asNonEmptyString(finding.message) ||
        asNonEmptyString(finding.finding) ||
        asNonEmptyString(finding.reason) ||
        asNonEmptyString(finding.title),
      )
      .filter(Boolean),
  ]).slice(0, 12);
}

/**
 * @param {Record<string, unknown>} finding
 * @returns {string}
 */
function reviewFindingSummary(finding) {
  return (
    asNonEmptyString(finding.summary) ||
    asNonEmptyString(finding.message) ||
    asNonEmptyString(finding.finding) ||
    asNonEmptyString(finding.reason) ||
    asNonEmptyString(finding.title) ||
    "Review finding requires repair."
  );
}

/**
 * @param {Record<string, unknown>} finding
 * @param {number} index
 * @returns {string}
 */
function reviewFindingId(finding, index) {
  const explicitId =
    asNonEmptyString(finding.finding_id) ||
    asNonEmptyString(finding.id) ||
    asNonEmptyString(finding.code) ||
    asNonEmptyString(finding.rule_id);
  if (explicitId) return explicitId;
  const category = asNonEmptyString(finding.category) || "review-finding";
  return `${category}.${shortHash(`${category}\n${reviewFindingSummary(finding)}\n${index}`)}`;
}

/**
 * @param {Record<string, unknown>} finding
 * @returns {string}
 */
function resolutionRequirementForFinding(finding) {
  const category = asNonEmptyString(finding.category).toLowerCase();
  const summary = reviewFindingSummary(finding).toLowerCase();
  if (
    category === "code-quality" &&
    (summary.includes("coverage") ||
      summary.includes("assertion") ||
      summary.includes("plan") ||
      summary.includes("weaken"))
  ) {
    return "Restore the weakened assertion or plan coverage, or add equivalent stronger coverage, and include final diff and verification evidence that proves this finding is resolved.";
  }
  if (isVerificationMappingFinding(finding)) {
    return "Map the changed test paths to primary verification evidence, or provide fresh verification evidence that makes the mapping warning stale.";
  }
  return "Address this finding directly in the next implementation iteration, or provide fresh public evidence that the finding is stale or already resolved.";
}

/**
 * @param {unknown} value
 * @returns {Array<Record<string, unknown>>}
 */
function normalizeVerificationFailureDetails(value) {
  return asRecordList(value).map((entry) => {
    const normalized = { ...entry };
    normalized.evidence_refs = asStringArray(entry.evidence_refs);
    return normalized;
  });
}

/**
 * @param {Record<string, unknown>} reviewReport
 * @returns {Array<Record<string, unknown>>}
 */
export function collectReviewFindingDetails(reviewReport) {
  const seen = new Set();
  const details = [];
  for (const [index, finding] of collectReviewFindingRecords(reviewReport).entries()) {
    const findingId = reviewFindingId(finding, index);
    const summary = reviewFindingSummary(finding);
    const dedupeKey = `${findingId}\n${summary}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const verificationFailureDetails = normalizeVerificationFailureDetails(finding.verification_failure_details);
    const detail = {
      finding_id: findingId,
      category: asNonEmptyString(finding.category) || "review",
      severity: asNonEmptyString(finding.severity) || "blocking",
      summary,
      evidence_refs: uniqueStrings([
        ...asStringArray(finding.evidence_refs),
        ...asStringArray(finding.evidenceRefs),
        ...verificationFailureDetails.flatMap((entry) => asStringArray(entry.evidence_refs)),
      ]),
      resolution_requirement: resolutionRequirementForFinding(finding),
    };
    if (verificationFailureDetails.length > 0) {
      detail.verification_failure_details = verificationFailureDetails;
    }
    details.push(detail);
    if (details.length >= 12) break;
  }
  return details;
}

/**
 * @param {Record<string, unknown>} finding
 * @returns {boolean}
 */
function isVerificationMappingFinding(finding) {
  const category = asNonEmptyString(finding.category).toLowerCase();
  const summary = [
    finding.summary,
    finding.message,
    finding.finding,
    finding.reason,
    finding.title,
  ]
    .map((value) => asNonEmptyString(value))
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
  return (
    category === "artifact-quality" &&
    summary.includes("primary verification") &&
    (summary.includes("changed test file") || summary.includes("verification"))
  );
}

/**
 * @param {Record<string, unknown>} finding
 * @returns {boolean}
 */
function reviewFindingRequiresImplementationChange(finding) {
  const severity = asNonEmptyString(finding.severity).toLowerCase();
  const category = asNonEmptyString(finding.category).toLowerCase();
  if (isVerificationMappingFinding(finding)) return false;
  if (severity === "fail" || severity === "blocking") return true;
  return ["code-quality", "feature-size-fit", "provider-traceability"].includes(category);
}

/**
 * @param {Record<string, unknown>} reviewReport
 * @param {"pass" | "warn" | "fail"} reviewOverallStatus
 * @returns {boolean}
 */
function reviewRequiresActionableRepair(reviewReport, reviewOverallStatus) {
  const recommendation = asNonEmptyString(reviewReport.review_recommendation);
  if (recommendation === "repair" || reviewOverallStatus === "fail") return true;
  const findings = collectReviewFindingRecords(reviewReport);
  return findings.some((finding) => reviewFindingRequiresImplementationChange(finding));
}

/**
 * @param {Record<string, unknown>} proofExpectations
 * @returns {Record<string, unknown> | null}
 */
export function resolveAcceptanceRepairDrill(proofExpectations) {
  const drill = asRecord(proofExpectations.acceptance_repair_drill);
  const sourcePhase = asNonEmptyString(drill.source_phase);
  if (!["review", "qa"].includes(sourcePhase)) return null;
  return {
    source_phase: sourcePhase,
    trigger: asNonEmptyString(drill.trigger) || "when-no-organic-repair",
    finding_id:
      asNonEmptyString(drill.finding_id) ||
      `w45.acceptance.${sourcePhase}.repair-drill`,
    summary:
      asNonEmptyString(drill.summary) ||
      `W45 acceptance drill requests ${sourcePhase}-origin public repair evidence.`,
    resolution_requirement:
      asNonEmptyString(drill.resolution_requirement) ||
      "Complete one bounded public repair execution, then provide refreshed review and QA evidence before delivery.",
  };
}

/**
 * @param {{
 *   drill: Record<string, unknown> | null,
 *   iteration: number,
 *   sourcePhase: string,
 *   currentRepairSource: string | null,
 *   stageStatus: string,
 *   secondaryStatus?: string,
 *   priorRepairDecisionFiles: string[],
 * }} options
 * @returns {Record<string, unknown> | null}
 */
export function resolveActiveAcceptanceRepairDrill(options) {
  if (!options.drill) return null;
  if (options.iteration !== 1) return null;
  if (asNonEmptyString(options.drill.source_phase) !== options.sourcePhase) return null;
  if (options.currentRepairSource) return null;
  if (options.stageStatus !== "pass") return null;
  if (options.secondaryStatus && options.secondaryStatus !== "pass") return null;
  if (options.priorRepairDecisionFiles.length > 0) return null;
  return options.drill;
}

/**
 * @param {{
 *   drill: Record<string, unknown>,
 *   sourcePhase: string,
 *   iteration: number,
 *   evidenceRefs: string[],
 * }} options
 * @returns {Record<string, unknown>}
 */
export function buildAcceptanceRepairDrillFinding(options) {
  return {
    finding_id: asNonEmptyString(options.drill.finding_id),
    category: options.sourcePhase,
    severity: "blocking",
    summary: asNonEmptyString(options.drill.summary),
    evidence_refs: uniqueStrings(options.evidenceRefs),
    resolution_requirement: asNonEmptyString(options.drill.resolution_requirement),
    acceptance_drill: true,
    cycle_iteration: options.iteration,
  };
}

/**
 * @param {Record<string, unknown>} reviewReport
 * @returns {boolean}
 */
function reviewHasOnlyVerificationMappingFindings(reviewReport) {
  const findings = collectReviewFindingRecords(reviewReport);
  return findings.length > 0 && findings.every((finding) => isVerificationMappingFinding(finding));
}

/**
 * @param {{ reviewReport: Record<string, unknown>, artifacts: Record<string, unknown> }} options
 * @returns {string}
 */
function classifyNonRepairReviewBlocker(options) {
  if (
    reviewHasOnlyVerificationMappingFindings(options.reviewReport) &&
    asNonEmptyString(options.artifacts.post_run_verify_status) === "pass"
  ) {
    return "verification_mapping_gap";
  }
  if (asNonEmptyString(options.artifacts.post_run_verify_status) === "pass") {
    return "acceptable_residual_risk_not_recognized";
  }
  return "review_quality_not_approved";
}

/**
 * @param {{ repairSource: string | null, pendingRepairContext: Record<string, unknown>, artifacts: Record<string, unknown>, newRepairContextSignals?: string[] }} options
 * @returns {string}
 */
function classifyRepeatedRepairContextBlocker(options) {
  const findingsText = asStringArray(options.pendingRepairContext.unresolved_findings).join("\n").toLowerCase();
  const verificationStatus = asNonEmptyString(options.pendingRepairContext.verification_status);
  const changedPaths = asStringArray(options.pendingRepairContext.meaningful_changed_paths);
  const newSignals = asStringArray(options.newRepairContextSignals);
  if (
    verificationStatus === "pass" &&
    findingsText.includes("primary verification") &&
    findingsText.includes("changed test file")
  ) {
    return "verification_mapping_gap";
  }
  if (verificationStatus === "pass" && /stale|no longer supported|not supported by current evidence/u.test(findingsText)) {
    return "review_finding_stale";
  }
  if (
    options.repairSource === "review" &&
    verificationStatus === "pass" &&
    changedPaths.length > 0 &&
    /acceptable residual risk|residual risk/u.test(findingsText)
  ) {
    return "acceptable_residual_risk_not_recognized";
  }
  if (
    changedPaths.length === 0 ||
    newSignals.length === 0 ||
    asStringArray(options.artifacts.latest_repair_context_new_signals).length === 0
  ) {
    return "provider_did_not_address_finding";
  }
  return "repeated_repair_context_without_new_evidence";
}

/**
 * @param {string} filePath
 * @returns {string}
 */
function canonicalEvidencePath(filePath) {
  try {
    return fs.realpathSync.native(filePath);
  } catch {
    return path.resolve(filePath);
  }
}

/**
 * @param {string} projectRoot
 * @param {string} filePath
 * @returns {string}
 */
function toProjectEvidenceRef(projectRoot, filePath) {
  return `evidence://${path
    .relative(canonicalEvidencePath(projectRoot), canonicalEvidencePath(filePath))
    .replace(/\\/g, "/")}`;
}

/**
 * @param {Record<string, unknown>} stepResult
 * @param {Record<string, unknown>} adapterOutput
 * @returns {{ owner: string, phase: string, class: string } | null}
 */
function classifyProviderExecutionFailure(stepResult, adapterOutput) {
  const failureKind = asNonEmptyString(adapterOutput.failure_kind);
  const stepFailureClass = asNonEmptyString(stepResult.failure_class);
  const failureClass = failureKind || stepFailureClass;
  if (!failureClass || ["none", "pass", "passed", "completed", "succeeded"].includes(failureClass)) {
    return null;
  }
  if (failureClass === "compiled_context_budget_exceeded") {
    return {
      owner: "aor",
      phase: "provider_execution",
      class: "compiled_context_budget_exceeded",
    };
  }
  if (failureClass === "provider_context_window_exceeded") {
    return {
      owner: "provider",
      phase: "provider_execution",
      class: "provider_context_window_exceeded",
    };
  }
  if (failureClass === "provider_work_packet_not_executed") {
    return {
      owner: "provider",
      phase: "provider_execution",
      class: "provider_work_packet_not_executed",
    };
  }
  if (failureClass === "no-op") {
    return {
      owner: "provider",
      phase: "provider_execution",
      class: "no-op",
    };
  }
  return {
    owner: "provider",
    phase: "provider_execution",
    class: failureClass,
  };
}

/**
 * @param {Record<string, unknown>} artifacts
 * @param {Record<string, unknown>} stepResult
 * @param {Record<string, unknown>} adapterOutput
 */
function applyProviderExecutionFailure(artifacts, stepResult, adapterOutput) {
  const classification = classifyProviderExecutionFailure(stepResult, adapterOutput);
  if (!classification) {
    return;
  }
  artifacts.failure_owner = classification.owner;
  artifacts.failure_phase = classification.phase;
  artifacts.failure_class = classification.class;
}

/**
 * @param {string} projectRoot
 * @param {string} packetName
 * @param {string | null | undefined} filePath
 * @returns {string | null}
 */
function toPacketEvidenceRef(projectRoot, packetName, filePath) {
  const concreteFilePath = asNonEmptyString(filePath);
  if (!concreteFilePath) {
    return null;
  }
  const sourceRef = path.isAbsolute(concreteFilePath)
    ? toProjectEvidenceRef(projectRoot, concreteFilePath)
    : concreteFilePath;
  return `packet://${packetName}@${sourceRef}`;
}

/**
 * @param {string} label
 * @returns {string}
 */
function normalizeLabel(label) {
  return label.replace(/[^a-z0-9]+/giu, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

/**
 * @param {string[]} args
 * @returns {string[]}
 */
function redactSensitiveCommandArgs(args) {
  const redacted = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    redacted.push(arg);
    if (arg === "--answer" && index + 1 < args.length) {
      redacted.push("[redacted-live-e2e-answer]");
      index += 1;
    }
  }
  return redacted;
}

/**
 * @param {{ hostRoot: string, aorBinOverride: string | null }} options
 */
export function resolveAorLaunch(options) {
  const selected = options.aorBinOverride
    ? path.isAbsolute(options.aorBinOverride)
      ? options.aorBinOverride
      : path.resolve(options.hostRoot, options.aorBinOverride)
    : path.join(options.hostRoot, "apps/cli/bin/aor.mjs");
  const extension = path.extname(selected).toLowerCase();
  if (extension === ".js" || extension === ".mjs" || extension === ".cjs") {
    return {
      command: process.execPath,
      argsPrefix: [selected],
      binaryRef: selected,
    };
  }
  return {
    command: selected,
    argsPrefix: [],
    binaryRef: selected,
  };
}

/**
 * @param {string} value
 * @returns {string}
 */
function shellSingleQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/**
 * @param {{
 *   cwd: string,
 *   command: string,
 *   args: string[],
 *   transcriptFile: string,
 * }} options
 */
function runInstallProofCommand(options) {
  const startedAt = nowIso();
  const run = spawnSync(options.command, options.args, {
    cwd: options.cwd,
    encoding: "utf8",
  });
  const transcript = {
    command: options.command,
    args: options.args,
    cwd: options.cwd,
    status: run.status === 0 ? "pass" : "fail",
    exit_code: run.status ?? -1,
    stdout: run.stdout ?? "",
    stderr: run.stderr ?? (run.error instanceof Error ? run.error.message : ""),
    started_at: startedAt,
    finished_at: nowIso(),
  };
  writeJson(options.transcriptFile, transcript);
  return transcript;
}

/**
 * @param {{ launcherRef: string, installRoot: string }} options
 * @returns {{ status: "pass" | "fail", transcriptFile: string }}
 */
function verifyCachedAorLauncher(options) {
  const transcriptFile = path.join(options.installRoot, "00-cached-aor-project-init-help.json");
  const transcript = runInstallProofCommand({
    cwd: path.dirname(options.launcherRef),
    command: options.launcherRef,
    args: ["project", "init", "--help"],
    transcriptFile,
  });
  return {
    status: asNonEmptyString(transcript.status) === "pass" ? "pass" : "fail",
    transcriptFile,
  };
}

const ISOLATED_SOURCE_SKIP_NAMES = new Set([
  ".aor",
  ".git",
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
]);

/**
 * @param {{ sourceRoot: string, destinationRoot: string }} options
 */
function copyAorSourceCheckout(options) {
  fs.rmSync(options.destinationRoot, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(options.destinationRoot), { recursive: true });
  fs.cpSync(options.sourceRoot, options.destinationRoot, {
    recursive: true,
    filter: (sourcePath) => {
      const relative = path.relative(options.sourceRoot, sourcePath);
      if (!relative) return true;
      return !relative.split(path.sep).some((part) => ISOLATED_SOURCE_SKIP_NAMES.has(part));
    },
  });
}

/**
 * @param {{
 *   hostRoot: string,
 *   reportsRoot: string,
 *   runId: string,
 *   profile: Record<string, unknown>,
 *   aorBinOverride: string | null,
 *   installMode?: "isolated" | "repo-local" | "provided-binary",
 *   isolatedWorkspaceRoot?: string | null,
 *   isolatedSourceRoot?: string | null,
 *   runtimeRoot?: string | null,
 * }}
 */
export function prepareAorInstallationProof(options) {
  const policy = asRecord(options.profile.live_e2e);
  const declaredPolicy = asNonEmptyString(policy.installation_policy);
  const effectivePolicy = options.aorBinOverride ? "provided-binary-required" : declaredPolicy || "source-install-required";
  const installMode =
    options.aorBinOverride || options.installMode === "provided-binary"
      ? "provided-binary"
      : options.installMode === "isolated"
      ? "isolated"
      : "repo-local";
  if (!["source-install-required", "provided-binary-required"].includes(effectivePolicy)) {
    throw new Error(
      `Unsupported live_e2e.installation_policy '${declaredPolicy}'. Expected source-install-required or provided-binary-required.`,
    );
  }
  if (effectivePolicy === "provided-binary-required" && !options.aorBinOverride) {
    throw new Error("live_e2e.installation_policy=provided-binary-required requires --aor-bin.");
  }

  const normalizedRunId = normalizeId(options.runId);
  const installRoot = path.join(options.reportsRoot, `live-e2e-aor-install-${normalizedRunId}`);
  const proofFile = path.join(options.reportsRoot, `live-e2e-aor-installation-proof-${normalizedRunId}.json`);
  const currentSourceCommit = gitHeadOrNull(options.hostRoot);
  if (fileExists(proofFile)) {
    const cachedProof = asRecord(readJson(proofFile));
    const launcherRef = asNonEmptyString(cachedProof.launcher_ref);
    const cachedSourceCommit = asNonEmptyString(cachedProof.source_commit_sha);
    const cachedInstallMode = asNonEmptyString(cachedProof.install_mode);
    const sourceCommitMatches = !currentSourceCommit || !cachedSourceCommit || currentSourceCommit === cachedSourceCommit;
    const cacheLooksReusable =
      asNonEmptyString(cachedProof.status) === "pass" && sourceCommitMatches && launcherRef && fileExists(launcherRef);
    const cachedLauncherSmoke = cacheLooksReusable ? verifyCachedAorLauncher({ launcherRef, installRoot }) : null;
    if (cacheLooksReusable && cachedLauncherSmoke?.status === "pass") {
      const cachedProofWithReuse = {
        ...cachedProof,
        reused_for_manual_resume: true,
        reused_at: nowIso(),
        cached_launcher_smoke_file: cachedLauncherSmoke.transcriptFile,
      };
      writeJson(proofFile, cachedProofWithReuse);
      const setupEntry = {
        sequence: 1,
        step_id: "install",
        status: "pass",
        public_surface:
          cachedInstallMode === "provided-binary" ? "provided aor binary" : "cached pnpm source install",
        evidence_refs: uniqueStrings([
          proofFile,
          ...asStringArray(cachedProof.command_transcripts),
          cachedLauncherSmoke.transcriptFile,
        ]),
        summary: "AOR installation proof was reused for manual resume because the source proof remained valid.",
      };
      return {
        launch: {
          command: launcherRef,
          argsPrefix: [],
          binaryRef: launcherRef,
        },
        proof: cachedProofWithReuse,
        proofFile,
        setupEntry,
      };
    }
  }
  fs.mkdirSync(installRoot, { recursive: true });
  const commandTranscripts = [];
  const commandSummaries = [];
  let installCwd = options.hostRoot;
  const addCommand = (label, command, args) => {
    const transcriptFile = path.join(installRoot, `${String(commandTranscripts.length + 1).padStart(2, "0")}-${label}.json`);
    const transcript = runInstallProofCommand({
      cwd: installCwd,
      command,
      args,
      transcriptFile,
    });
    commandTranscripts.push(transcriptFile);
    commandSummaries.push({
      label,
      command,
      args,
      status: asNonEmptyString(transcript.status),
      exit_code: typeof transcript.exit_code === "number" ? transcript.exit_code : null,
      started_at: asNonEmptyString(transcript.started_at) || null,
      finished_at: asNonEmptyString(transcript.finished_at) || null,
      transcript_file: transcriptFile,
    });
    return transcript;
  };

  /** @type {ReturnType<typeof resolveAorLaunch>} */
  let launch;
  let launcherRef = null;
  if (effectivePolicy === "source-install-required" && installMode === "isolated") {
    const isolatedSourceRoot = asNonEmptyString(options.isolatedSourceRoot);
    if (!isolatedSourceRoot) {
      throw new Error("Isolated AOR source install requires isolatedSourceRoot.");
    }
    copyAorSourceCheckout({
      sourceRoot: options.hostRoot,
      destinationRoot: isolatedSourceRoot,
    });
    installCwd = isolatedSourceRoot;
  }

  if (effectivePolicy === "source-install-required") {
    addCommand("corepack-enable", "corepack", ["enable"]);
    addCommand("pnpm-install-frozen-lockfile-force", "pnpm", ["install", "--frozen-lockfile", "--force"]);
    addCommand("pnpm-build", "pnpm", ["build"]);
    addCommand("pnpm-aor-help", "pnpm", ["aor", "--help"]);
    addCommand("pnpm-aor-project-init-help", "pnpm", ["aor", "project", "init", "--help"]);
    addCommand("pnpm-aor-intake-create-help", "pnpm", ["aor", "intake", "create", "--help"]);
    const launcherScript = path.join(installRoot, "aor-session-launcher.sh");
    fs.writeFileSync(
      launcherScript,
      [
        "#!/bin/sh",
        `exec ${shellSingleQuote(process.execPath)} ${shellSingleQuote(path.join(installCwd, "apps/cli/bin/aor.mjs"))} "$@"`,
        "",
      ].join("\n"),
      "utf8",
    );
    fs.chmodSync(launcherScript, 0o755);
    launcherRef = launcherScript;
    launch = {
      command: launcherScript,
      argsPrefix: [],
      binaryRef: launcherScript,
    };
  } else {
    launch = resolveAorLaunch({
      hostRoot: options.hostRoot,
      aorBinOverride: options.aorBinOverride,
    });
    addCommand("provided-aor-help", launch.command, [...launch.argsPrefix, "--help"]);
    launcherRef = launch.binaryRef;
  }

  const failedCommands = commandSummaries.filter((entry) => asNonEmptyString(entry.status) === "fail");
  const proof = {
    status: failedCommands.length === 0 ? "pass" : "fail",
    declared_policy: declaredPolicy || null,
    effective_policy: effectivePolicy,
    install_mode: installMode,
    source_channel: effectivePolicy === "source-install-required" ? "source-only-alpha" : "provided-binary",
    workspace_root: options.isolatedWorkspaceRoot ?? null,
    runtime_root: options.runtimeRoot ?? null,
    original_source_root: options.hostRoot,
    source_commit_sha: currentSourceCommit,
    installed_source_root: effectivePolicy === "source-install-required" ? installCwd : null,
    launcher_ref: launcherRef,
    command_transcripts: commandTranscripts,
    commands: commandSummaries,
    started_at: asNonEmptyString(asRecord(commandSummaries[0]).started_at) || null,
    finished_at: nowIso(),
  };
  writeJson(proofFile, proof);
  const setupEntry = {
    sequence: 1,
    step_id: "install",
    status: proof.status,
    public_surface: effectivePolicy === "source-install-required" ? "pnpm source install" : "provided aor binary",
    evidence_refs: uniqueStrings([proofFile, ...commandTranscripts]),
    summary:
      proof.status !== "pass"
        ? "AOR installation proof failed before live E2E execution."
        : effectivePolicy === "source-install-required"
        ? "AOR source-only install channel was verified before live E2E execution."
        : "Provided AOR binary was verified before live E2E execution.",
  };
  const installationResult = {
    launch,
    proof,
    proofFile,
    setupEntry,
  };
  if (proof.status !== "pass") {
    const failure = new Error(`AOR installation proof failed; inspect ${proofFile}.`);
    failure.aorInstallation = installationResult;
    throw failure;
  }
  return installationResult;
}

/**
 * @param {{
 *   launch: ReturnType<typeof resolveAorLaunch>,
 *   cwd: string,
 *   args: string[],
 *   env: NodeJS.ProcessEnv,
 *   transcriptsRoot: string,
 *   label: string,
 *   index: number,
 *   timeoutMs?: number | null,
 * }}
 */
function runAorCommand(options) {
  const rawArgs = [...options.launch.argsPrefix, ...options.args];
  const startedAt = nowIso();
  const run = spawnSync(options.launch.command, rawArgs, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    timeout:
      typeof options.timeoutMs === "number" && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
        ? Math.max(Math.floor(options.timeoutMs), MIN_LIVE_E2E_AOR_COMMAND_TIMEOUT_MS)
        : undefined,
    killSignal: "SIGKILL",
    detached: process.platform !== "win32",
  });
  const timedOut = commandTimedOut(run);
  if (timedOut) {
    terminateTimedOutProcessGroup(run.pid);
  }
  const finishedAt = nowIso();
  const transcriptFile = path.join(
    options.transcriptsRoot,
    `${String(options.index).padStart(2, "0")}-${normalizeLabel(options.label)}.json`,
  );
  /** @type {Record<string, unknown> | null} */
  let parsed = null;
  if ((run.stdout ?? "").trim().length > 0) {
    try {
      parsed = /** @type {Record<string, unknown>} */ (JSON.parse(run.stdout));
    } catch {
      parsed = null;
    }
  }
  const transcript = {
    label: options.label,
    cwd: options.cwd,
    command: options.launch.command,
    args: redactSensitiveCommandArgs(rawArgs),
    exit_code: run.status ?? -1,
    signal: run.signal ?? null,
    timed_out: timedOut,
    timeout_ms:
      typeof options.timeoutMs === "number" && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
        ? Math.max(Math.floor(options.timeoutMs), MIN_LIVE_E2E_AOR_COMMAND_TIMEOUT_MS)
        : null,
    error_code: /** @type {{ code?: unknown } | undefined} */ (run.error)?.code ?? null,
    stdout: run.stdout ?? "",
    stderr: run.stderr ?? (run.error instanceof Error ? run.error.message : ""),
    parsed_json: parsed,
    started_at: startedAt,
    finished_at: finishedAt,
  };
  writeJson(transcriptFile, transcript);
  return {
    label: options.label,
    ok: run.status === 0 && parsed !== null && !timedOut,
    exitCode: run.status ?? -1,
    stdout: run.stdout ?? "",
    stderr: run.stderr ?? (run.error instanceof Error ? run.error.message : ""),
    payload: parsed,
    transcriptFile,
    startedAt,
    finishedAt,
    durationSec: resolveDurationSeconds(startedAt, finishedAt),
    commandSurface: resolveCommandSurface(options.args),
    timedOut,
    timeoutMs:
      typeof options.timeoutMs === "number" && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
        ? Math.max(Math.floor(options.timeoutMs), MIN_LIVE_E2E_AOR_COMMAND_TIMEOUT_MS)
        : null,
  };
}

/**
 * @param {import("node:child_process").SpawnSyncReturns<string>} commandRun
 * @returns {boolean}
 */
function commandTimedOut(commandRun) {
  const error = /** @type {{ code?: unknown } | undefined} */ (commandRun.error);
  return error?.code === "ETIMEDOUT";
}

/**
 * @param {number | undefined} pid
 */
function terminateTimedOutProcessGroup(pid) {
  if (process.platform === "win32" || !Number.isInteger(pid) || Number(pid) <= 0) {
    return;
  }

  for (const signal of ["SIGTERM", "SIGKILL"]) {
    try {
      process.kill(-Number(pid), signal);
    } catch {
      continue;
    }
  }
}

/**
 * @param {string[]} args
 */
function resolveCommandSurface(args) {
  return args.length >= 2 && !args[1].startsWith("--") && args[1] !== "."
    ? `aor ${args[0]} ${args[1]}`
    : `aor ${args[0]}`.trim();
}

/**
 * @param {string} startedAt
 * @param {string} finishedAt
 * @returns {number | null}
 */
function resolveDurationSeconds(startedAt, finishedAt) {
  const startedMs = Date.parse(startedAt);
  const finishedMs = Date.parse(finishedAt);
  if (!Number.isFinite(startedMs) || !Number.isFinite(finishedMs) || finishedMs < startedMs) {
    return null;
  }
  return Math.round(((finishedMs - startedMs) / 1000) * 1000) / 1000;
}

const POST_RUN_DIAGNOSTIC_INTENT = "post-run-diagnostic";

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizeDiagnosticIntent(value) {
  const normalized = asNonEmptyString(value).toLowerCase().replace(/_/gu, "-");
  if (normalized === POST_RUN_DIAGNOSTIC_INTENT) return POST_RUN_DIAGNOSTIC_INTENT;
  return null;
}

/**
 * @param {ReturnType<typeof runAorCommand>} result
 * @param {{ diagnosticIntent?: unknown, diagnostic_intent?: unknown }} [options]
 * @returns {Record<string, unknown>}
 */
function buildCommandDiagnostic(result, options = {}) {
  const payload = asRecord(result.payload);
  const lifecycleCommand = asRecord(payload.lifecycle_command);
  const commandOutput = asRecord(lifecycleCommand.command_output);
  const runControlState = asRecord(payload.run_control_state);
  const providerStepStatus = asRecord(runControlState.provider_step_status);
  const diagnosticIntent =
    normalizeDiagnosticIntent(options.diagnosticIntent) || normalizeDiagnosticIntent(options.diagnostic_intent);
  const isDiagnosticCommand = Boolean(diagnosticIntent);
  const interactiveContinuation =
    asRecord(payload.interactive_continuation).requested === true
      ? asRecord(payload.interactive_continuation)
      : asRecord(lifecycleCommand.interactive_continuation).requested === true
        ? asRecord(lifecycleCommand.interactive_continuation)
          : asRecord(commandOutput.interactive_continuation).requested === true
            ? asRecord(commandOutput.interactive_continuation)
            : null;
  const diagnostic = {
    label: result.label,
    diagnostic_intent: diagnosticIntent,
    command_surface: result.commandSurface,
    status: result.ok ? "pass" : "fail",
    exit_code: result.exitCode,
    started_at: result.startedAt,
    finished_at: result.finishedAt,
    duration_sec: result.durationSec,
    timed_out: result.timedOut,
    timeout_budget_ms: result.timeoutMs,
    transcript_file: result.transcriptFile,
    artifact_refs: uniqueStrings(collectStringRefs(result.payload)),
    failure_class: result.ok
      ? null
      : result.timedOut && isDiagnosticCommand
        ? "diagnostic-command-timeout"
        : result.timedOut
          ? "aor-command-timeout"
          : "command-failed",
    failure_owner: result.ok ? null : isDiagnosticCommand ? "target_repository" : "aor",
    failure_phase: result.ok ? null : resolveFailurePhaseForCommandLabel(result.label),
    missing_evidence: [],
    recommendation: result.ok
      ? "continue"
      : result.timedOut && isDiagnosticCommand
        ? "bounded diagnostic cleanup completed; inspect transcript stdout/stderr and keep product acceptance gated"
        : result.timedOut
        ? "inspect AOR command transcript and target setup status before judging provider quality"
        : "inspect transcript and command stderr",
    interactive_continuation: interactiveContinuation,
    provider_step_status: Object.keys(providerStepStatus).length > 0 ? providerStepStatus : null,
  };
  if (!diagnosticIntent) delete diagnostic.diagnostic_intent;
  return diagnostic;
}

/**
 * @param {string} label
 * @returns {"aor_install" | "target_checkout" | "target_setup" | "target_verification" | "provider_execution" | "controller_decision" | "ui_validation"}
 */
function resolveFailurePhaseForCommandLabel(label) {
  if (label.includes("verify")) return "target_verification";
  if (label.includes("app") || label.includes("web")) return "ui_validation";
  if (label.includes("run-start") || label.includes("request-run")) return "provider_execution";
  if (label.includes("decision") || label.includes("next")) return "controller_decision";
  if (label.includes("init") || label.includes("doctor") || label.includes("onboard")) return "aor_install";
  return "controller_decision";
}

/**
 * @param {Record<string, unknown>} diagnostic
 * @param {string} label
 * @param {number} iteration
 */
function annotateCommandDiagnosticStep(diagnostic, label, iteration) {
  const step = resolveLiveE2eCommandStep(label);
  if (!step) return;
  const normalizedIteration = Number(iteration) || 1;
  diagnostic.step_id = step;
  diagnostic.step_instance_id = buildLiveE2eStepInstanceId(step, normalizedIteration);
  diagnostic.iteration = normalizedIteration;
}

/**
 * @param {Record<string, unknown>} diagnostic
 * @returns {ReturnType<typeof runAorCommand> | null}
 */
function buildCachedCommandResult(diagnostic) {
  const transcriptFile = asNonEmptyString(diagnostic.transcript_file);
  if (!transcriptFile || !fileExists(transcriptFile)) return null;
  const transcript = asRecord(readJson(transcriptFile));
  return {
    label: asNonEmptyString(diagnostic.label),
    ok: commandCompletedForRun(diagnostic),
    exitCode: typeof diagnostic.exit_code === "number" ? diagnostic.exit_code : 0,
    stdout: asNonEmptyString(transcript.stdout),
    stderr: asNonEmptyString(transcript.stderr),
    payload: asRecord(transcript.parsed_json),
    transcriptFile,
    startedAt: asNonEmptyString(diagnostic.started_at) || asNonEmptyString(transcript.started_at) || nowIso(),
    finishedAt: asNonEmptyString(diagnostic.finished_at) || asNonEmptyString(transcript.finished_at) || nowIso(),
    durationSec:
      typeof diagnostic.duration_sec === "number"
        ? diagnostic.duration_sec
        : resolveDurationSeconds(asNonEmptyString(transcript.started_at), asNonEmptyString(transcript.finished_at)),
    commandSurface: asNonEmptyString(diagnostic.command_surface) || "cached public AOR command",
  };
}

/**
 * @param {Record<string, unknown>} artifacts
 * @param {unknown} stepController
 */
function hydrateControllerArtifacts(artifacts, stepController) {
  const snapshot = asRecord(asRecord(stepController?.getState?.()).artifacts_snapshot);
  Object.assign(artifacts, snapshot);
}

/**
 * @param {unknown} stepController
 * @param {string} step
 * @param {number} [iteration]
 * @returns {boolean}
 */
function controllerObservedStep(stepController, step, iteration = 1) {
  const journal =
    typeof stepController?.getStepJournal === "function"
      ? stepController.getStepJournal().map((entry) => asRecord(entry))
      : [];
  return journal.some(
    (entry) => asNonEmptyString(entry.step_id) === step && (Number(entry.iteration) || 1) === iteration,
  );
}

/**
 * @param {Record<string, unknown>} artifacts
 * @param {string} diagnosticFailureMode
 * @returns {ReturnType<typeof buildCachedCommandResult> | null}
 */
function buildCachedPostRunDiagnosticVerifyResult(artifacts, diagnosticFailureMode) {
  const summaryFile = asNonEmptyString(artifacts.post_run_diagnostic_verify_summary_file);
  if (!summaryFile || !fileExists(summaryFile)) return null;

  const summary = asRecord(readJson(summaryFile));
  const transcriptFile = asNonEmptyString(artifacts.post_run_diagnostic_transcript_file) || summaryFile;
  const stepResultFiles = uniqueStrings([
    ...asStringArray(artifacts.post_run_diagnostic_verify_step_result_files),
    ...asStringArray(summary.step_result_files),
    ...asStringArray(summary.step_result_refs),
  ]);
  const diagnosticPassed = asNonEmptyString(summary.status) === "passed";
  artifacts.post_run_diagnostic_status =
    asNonEmptyString(artifacts.post_run_diagnostic_status) ||
    (diagnosticPassed ? "pass" : asNonEmptyString(diagnosticFailureMode) || "warn");
  artifacts.post_run_diagnostic_verify_step_result_files = stepResultFiles;
  artifacts.post_run_diagnostic_reused_after_resume = true;

  return {
    ok: true,
    exitCode: 0,
    stdout: "",
    stderr: "",
    payload: {
      verify_summary_file: summaryFile,
      step_result_files: stepResultFiles,
    },
    transcriptFile,
    startedAt: nowIso(),
    finishedAt: nowIso(),
    durationSec: 0,
    commandSurface: "cached post-run diagnostic verification",
  };
}

/**
 * @param {Record<string, unknown>} diagnostic
 * @returns {boolean}
 */
function commandCompletedForRun(diagnostic) {
  return asNonEmptyString(diagnostic.status) === "pass" || diagnostic.accepted_nonzero_payload === true;
}

/**
 * @param {Record<string, unknown> | null} payload
 * @param {string} field
 * @returns {string | null}
 */
function getStringField(payload, field) {
  if (!payload) return null;
  const value = payload[field];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/**
 * @param {Record<string, unknown> | null} payload
 * @param {string} field
 * @returns {string[]}
 */
function getStringArrayField(payload, field) {
  if (!payload) return [];
  return asStringArray(payload[field]);
}

/**
 * @param {Record<string, unknown>} profile
 * @returns {string[]}
 */
function getBacklogRefs(profile) {
  const learningLoop = asRecord(profile.learning_loop);
  const refs = asStringArray(learningLoop.backlog_refs);
  return refs.length > 0 ? refs : [...DEFAULT_BACKLOG_REFS];
}

/**
 * @param {Record<string, unknown>} profile
 */
function shouldIncludeApprovedHandoff(profile) {
  const liveExecution = asRecord(profile.live_execution);
  if (liveExecution.include_approved_handoff === false) {
    return false;
  }
  return true;
}

/**
 * @param {Record<string, unknown>} profile
 */
function shouldIncludePromotionEvidence(profile) {
  const liveExecution = asRecord(profile.live_execution);
  if (liveExecution.include_promotion_evidence === false) {
    return false;
  }
  return true;
}

/**
 * @param {Record<string, unknown>} profile
 */
function getHarnessCertification(profile) {
  const harness = asRecord(asRecord(profile.verification).harness);
  if (harness.enabled !== true) {
    return null;
  }
  return {
    assetRef: asNonEmptyString(harness.asset_ref) || "wrapper://wrapper.eval.default@v1",
    subjectRef: asNonEmptyString(harness.subject_ref) || "wrapper://wrapper.eval.default@v1",
    suiteRef: asNonEmptyString(harness.suite_ref) || "suite.cert.core@v4",
    stepClass: asNonEmptyString(harness.step_class) || "implement",
  };
}

/**
 * @param {Record<string, unknown>} profile
 * @returns {string}
 */
function getPreferredDeliveryMode(profile) {
  return normalizeDeliveryMode(
    asNonEmptyString(asRecord(profile.output_policy).preferred_delivery_mode) || "patch-only",
  );
}

/**
 * @param {Record<string, unknown>} profile
 * @returns {string[]}
 */
function getEvalSuites(profile) {
  return asStringArray(asRecord(profile.verification).eval_suites);
}

/**
 * @param {Record<string, unknown>} profile
 */
function resolveImplementationLoopPolicy(profile) {
  const loop = asRecord(profile.implementation_loop);
  const runTier = asNonEmptyString(profile.run_tier);
  const acceptanceLike =
    asNonEmptyString(profile.journey_mode) === "full-journey" ||
    runTier === "acceptance" ||
    runTier === "production-proof" ||
    asRecord(profile.production_proof).enabled === true;
  const enabled = typeof loop.enabled === "boolean" ? loop.enabled : acceptanceLike;
  const maxIterations =
    Number.isInteger(loop.max_iterations) && Number(loop.max_iterations) > 0
      ? Number(loop.max_iterations)
      : enabled
      ? 3
      : 1;
  return {
    enabled,
    maxIterations,
    reviewRepairActions: asStringArray(loop.review_repair_actions).length > 0
      ? asStringArray(loop.review_repair_actions)
      : ["request-repair", "repair", "failed-quality-findings"],
    cycleSteps: asStringArray(loop.cycle_steps).length > 0
      ? asStringArray(loop.cycle_steps)
      : ["execution", "review"],
    repairSources: asStringArray(loop.repair_sources).length > 0
      ? asStringArray(loop.repair_sources)
      : ["review", "post-run-primary"],
    stopOnBlockingReview: loop.stop_on_blocking_review !== false,
    proofExpectations: asRecord(loop.proof_expectations),
    acceptanceRepairDrill: resolveAcceptanceRepairDrill(asRecord(loop.proof_expectations)),
  };
}

/**
 * @param {{ cwd: string, args: string[] }} options
 * @returns {string | null}
 */
function runGitOutput(options) {
  const result = spawnSync("git", options.args, {
    cwd: options.cwd,
    encoding: "utf8",
  });
  if (result.status !== 0) return null;
  return (result.stdout ?? "").trim();
}

/**
 * @param {string} targetCheckoutRoot
 * @returns {string[]}
 */
function collectTargetGitStatusWithoutRuntime(targetCheckoutRoot) {
  const result = spawnSync(
    "git",
    [
      "status",
      "--short",
      "--untracked-files=all",
      "--",
      ".",
      ":(exclude).aor",
      ":(exclude).aor/**",
    ],
    {
      cwd: targetCheckoutRoot,
      encoding: "utf8",
    },
  );
  if (result.status !== 0) {
    return [`git-status-failed: ${(result.stderr ?? result.stdout ?? "").trim()}`];
  }
  return (result.stdout ?? "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * @param {string[]} statusLines
 * @returns {string[]}
 */
function trackedTargetStatusLines(statusLines) {
  return statusLines.filter((line) => !line.startsWith("?? "));
}

/**
 * @param {{ targetCheckoutRoot: string, reportsRoot: string, runId: string, phase: string }} options
 */
function writeTargetCleanlinessReport(options) {
  const statusLines = collectTargetGitStatusWithoutRuntime(options.targetCheckoutRoot);
  const trackedLines = trackedTargetStatusLines(statusLines);
  const report = {
    run_id: options.runId,
    phase: options.phase,
    status: trackedLines.length === 0 ? "pass" : "fail",
    target_git_status_without_runtime: statusLines,
    tracked_status_without_runtime: trackedLines,
    summary:
      trackedLines.length === 0
        ? "Target checkout has no tracked setup changes outside .aor."
        : "Target setup changed tracked files outside .aor before agent execution.",
    checked_at: nowIso(),
  };
  const reportFile = path.join(
    options.reportsRoot,
    `live-e2e-target-cleanliness-${normalizeId(options.runId)}-${normalizeId(options.phase)}.json`,
  );
  writeJson(reportFile, report);
  return { report, reportFile };
}

/**
 * @param {unknown} value
 * @returns {Array<{ kpi_id: string, name: string, target: string, measurement?: string }>}
 */
function normalizeMissionKpis(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry, index) => {
      const record = asRecord(entry);
      const kpiId = asNonEmptyString(record.kpi_id) || `mission-kpi-${index + 1}`;
      const name = asNonEmptyString(record.name) || asNonEmptyString(record.label) || `Mission KPI ${index + 1}`;
      const target = asNonEmptyString(record.target) || asNonEmptyString(record.threshold);
      if (!target) return null;
      const measurement = asNonEmptyString(record.measurement);
      return {
        kpi_id: kpiId,
        name,
        target,
        ...(measurement ? { measurement } : {}),
      };
    })
    .filter(Boolean);
}

/**
 * @param {{
 *   mission: Record<string, unknown>,
 *   featureRequest: ReturnType<typeof materializeFeatureRequestFile>,
 *   profile: Record<string, unknown>,
 *   projectProfileFile: string,
 *   missionIdOverride?: string | null,
 *   titleOverride?: string | null,
 *   briefOverride?: string | null,
 *   deliveryModeOverride?: string | null,
 *   sourceRefOverride?: string | null,
 *   followUpSourceHandoffRef?: string | null,
 * }}
 * @returns {string[]}
 */
function buildGuidedMissionCreateArgs(options) {
  const missionId = asNonEmptyString(options.missionIdOverride) || asNonEmptyString(options.mission.mission_id);
  const title =
    asNonEmptyString(options.titleOverride) ||
    asNonEmptyString(options.featureRequest.requestDocument.title) ||
    missionId ||
    "Guided mission";
  const agentVisibleRequest = asRecord(options.mission.agent_visible_request);
  const brief =
    asNonEmptyString(options.briefOverride) ||
    asNonEmptyString(agentVisibleRequest.user_problem) ||
    asNonEmptyString(options.featureRequest.requestDocument.brief) ||
    asNonEmptyString(options.mission.brief) ||
    "Prepare one bounded guided mission request.";
  const desiredOutcome = asNonEmptyString(agentVisibleRequest.desired_outcome);
  const goals = uniqueStrings([...(desiredOutcome ? [desiredOutcome] : []), ...asStringArray(options.mission.goals)]);
  const constraints = uniqueStrings([
    ...asStringArray(agentVisibleRequest.constraints),
    ...asStringArray(agentVisibleRequest.non_goals).map((entry) => `Non-goal: ${entry}`),
    ...asStringArray(options.mission.acceptance_checks),
  ]);
  const definitionOfDone =
    asStringArray(options.mission.definition_of_done).length > 0
      ? asStringArray(options.mission.definition_of_done)
      : asStringArray(options.mission.expected_evidence).map((entry) => `Materialize ${entry} evidence.`);
  const kpis = normalizeMissionKpis(options.mission.kpis);
  const effectiveKpis =
    kpis.length > 0
      ? kpis
      : [
          {
            kpi_id: "guided-proof-artifacts",
            name: "Guided proof artifacts",
            target: "All required proof artifacts are materialized",
            measurement: "installed-user guided proof validation",
          },
        ];

  return [
    "mission",
    "create",
    "--project-ref",
    ".",
    "--project-profile",
    options.projectProfileFile,
    "--runtime-root",
    ".aor",
    "--request-file",
    options.featureRequest.requestFile,
    ...(missionId ? ["--mission-id", missionId] : []),
    "--title",
    title,
    "--brief",
    brief,
    "--delivery-mode",
    asNonEmptyString(options.deliveryModeOverride) || getPreferredDeliveryMode(options.profile),
    "--source-kind",
    "local-note",
    "--source-ref",
    asNonEmptyString(options.sourceRefOverride) || options.featureRequest.requestFile,
    ...(asNonEmptyString(options.followUpSourceHandoffRef)
      ? ["--follow-up-source-handoff-ref", asNonEmptyString(options.followUpSourceHandoffRef)]
      : []),
    ...((goals.length > 0 ? goals : [brief]).flatMap((entry) => ["--goal", entry])),
    ...constraints.flatMap((entry) => ["--constraint", entry]),
    ...((definitionOfDone.length > 0 ? definitionOfDone : constraints).flatMap((entry) => ["--dod", entry])),
    ...effectiveKpis.flatMap((entry) => [
      "--kpi",
      `${entry.kpi_id}:${entry.name}:${entry.target}${entry.measurement ? `:${entry.measurement}` : ""}`,
    ]),
  ];
}

/**
 * @param {string} targetCheckoutRoot
 * @param {string | null | undefined} value
 * @returns {string | null}
 */
function resolveTargetEvidencePath(targetCheckoutRoot, value) {
  const ref = asNonEmptyString(value);
  if (!ref) return null;
  if (path.isAbsolute(ref)) return ref;
  if (ref.startsWith("evidence://")) {
    const evidencePath = ref.slice("evidence://".length);
    return evidencePath ? path.resolve(targetCheckoutRoot, evidencePath) : null;
  }
  return path.resolve(targetCheckoutRoot, ref);
}

/**
 * @param {string} targetCheckoutRoot
 * @param {string | null | undefined} packetFile
 * @returns {{ flowId: string | null, projectId: string | null, missionId: string | null }}
 */
function resolveFlowIdentityFromPacket(targetCheckoutRoot, packetFile) {
  const resolvedPacketFile = resolveTargetEvidencePath(targetCheckoutRoot, packetFile);
  if (!resolvedPacketFile || !fileExists(resolvedPacketFile)) {
    return { flowId: null, projectId: null, missionId: null };
  }
  const packet = asRecord(readJson(resolvedPacketFile));
  const packetId = asNonEmptyString(packet.packet_id);
  const marker = ".artifact.intake.";
  const markerIndex = packetId.indexOf(marker);
  const projectId = markerIndex > 0 ? packetId.slice(0, markerIndex) : null;
  const invocationContext = asRecord(packet.invocation_context);
  const packetMissionId =
    asNonEmptyString(invocationContext.mission_id) ||
    (markerIndex > 0 ? packetId.slice(markerIndex + marker.length).replace(/\.v\d+$/u, "") : "");
  const normalizedMissionId = normalizeId(packetMissionId);
  return {
    flowId: projectId && normalizedMissionId ? `flow.${projectId}.${normalizedMissionId}` : null,
    projectId,
    missionId: packetMissionId || null,
  };
}

/**
 * @param {string | null | undefined} reportFile
 * @returns {Record<string, unknown>}
 */
function readReportDocument(reportFile) {
  const ref = asNonEmptyString(reportFile);
  if (!ref || !fileExists(ref)) return {};
  return asRecord(readJson(ref));
}

/**
 * @param {string} targetRoot
 * @param {{ projectId: string | null, missionId: string | null }} identity
 * @returns {string | null}
 */
export function archivedNextActionReportForMission(targetRoot, identity) {
  const projectId = asNonEmptyString(identity.projectId);
  const missionId = normalizeId(asNonEmptyString(identity.missionId) || "");
  if (!projectId || !missionId) return null;
  const reportFile = path.join(targetRoot, ".aor", "projects", projectId, "reports", `next-action-report-${missionId}.json`);
  return fileExists(reportFile) ? reportFile : null;
}

/**
 * @param {Record<string, unknown>} report
 * @returns {boolean}
 */
export function nextActionReportClosesFlow(report) {
  const closureState = asRecord(report.closure_state);
  const learningState = asRecord(closureState.learning);
  const primaryAction = asRecord(report.primary_action);
  return (
    asNonEmptyString(learningState.status) === "handoff-complete" ||
    asNonEmptyString(primaryAction.action_id) === "start-new-flow" ||
    asNonEmptyString(primaryAction.action_id) === "closure-complete"
  );
}

/**
 * @param {string | null | undefined} requestFile
 * @returns {Record<string, unknown>}
 */
function readOperatorRequestDocument(requestFile) {
  const ref = asNonEmptyString(requestFile);
  if (!ref || !fileExists(ref)) return {};
  const payload = asRecord(readJson(ref));
  return asRecord(payload.operator_request ?? payload);
}

/**
 * @param {{
 *   aorLaunch: ReturnType<typeof resolveAorLaunch>,
 *   targetCheckoutRoot: string,
 *   runId: string,
 *   reportsRoot: string,
 *   env: NodeJS.ProcessEnv,
 *   projectProfileFile?: string,
 * }}
 */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * @param {string} filePath
 * @returns {Record<string, unknown>}
 */
function tryReadJsonFile(filePath) {
  try {
    return asRecord(JSON.parse(fs.readFileSync(filePath, "utf8")));
  } catch {
    return {};
  }
}

/**
 * @param {{
 *   aorLaunch: ReturnType<typeof resolveAorLaunch>,
 *   targetCheckoutRoot: string,
 *   reportsRoot: string,
 *   runId: string,
 *   env: NodeJS.ProcessEnv,
 *   projectProfileFile?: string,
 * }}
 * @returns {Record<string, unknown>}
 */
function startGuidedBrowserTaskAppSurface(options) {
  const stdoutFile = path.join(
    options.reportsRoot,
    `installed-user-guided-browser-task-app-${normalizeId(options.runId)}.stdout.json`,
  );
  const stderrFile = path.join(
    options.reportsRoot,
    `installed-user-guided-browser-task-app-${normalizeId(options.runId)}.stderr.log`,
  );
  const stdoutFd = fs.openSync(stdoutFile, "w");
  const stderrFd = fs.openSync(stderrFile, "w");
  let child;
  try {
    child = spawn(
      options.aorLaunch.command,
      [
        ...options.aorLaunch.argsPrefix,
        "app",
        "--project-ref",
        ".",
        ...(asNonEmptyString(options.projectProfileFile)
          ? ["--project-profile", asNonEmptyString(options.projectProfileFile)]
          : []),
        "--runtime-root",
        ".aor",
        "--open",
        "false",
        "--json",
      ],
      {
        cwd: options.targetCheckoutRoot,
        detached: true,
        env: options.env,
        stdio: ["ignore", stdoutFd, stderrFd],
      },
    );
    child.unref();
  } finally {
    fs.closeSync(stdoutFd);
    fs.closeSync(stderrFd);
  }

  const startedAt = nowIso();
  let launchSummary = {};
  for (let attempt = 0; attempt < 50; attempt += 1) {
    launchSummary = tryReadJsonFile(stdoutFile);
    if (asNonEmptyString(launchSummary.app_url) && asNonEmptyString(launchSummary.control_plane)) break;
    sleepSync(100);
  }

  const stderr = fileExists(stderrFile) ? fs.readFileSync(stderrFile, "utf8").trim() : "";
  const status =
    asNonEmptyString(launchSummary.app_url) && asNonEmptyString(launchSummary.control_plane)
      ? "running"
      : "launch_failed";
  return {
    kind: "guided-browser-task-app-surface",
    status,
    started_at: startedAt,
    pid: child?.pid ?? null,
    app_url: asNonEmptyString(launchSummary.app_url) || null,
    control_plane: asNonEmptyString(launchSummary.control_plane) || null,
    project_id: asNonEmptyString(launchSummary.project_id) || null,
    stdout_file: stdoutFile,
    stderr_file: stderrFile,
    stderr_summary: stderr ? stderr.slice(0, 1000) : null,
    launch_summary: launchSummary,
  };
}

/**
 * @param {string} command
 * @param {Record<string, string | undefined>} env
 * @returns {string | null}
 */
function resolveExecutableOnPath(command, env = process.env) {
  const value = asNonEmptyString(command);
  if (!value) return null;
  if (value.includes("/") || value.includes("\\")) return fileExists(value) ? value : null;
  const pathValue = asNonEmptyString(env.PATH) || asNonEmptyString(process.env.PATH);
  for (const dir of pathValue.split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(dir, value);
    if (fileExists(candidate)) return candidate;
  }
  return null;
}

/**
 * @param {string} executable
 * @param {Record<string, string | undefined>} env
 * @returns {string | null}
 */
function resolveShebangInterpreter(executable, env = process.env) {
  if (!fileExists(executable)) return null;
  try {
    const firstLine = fs.readFileSync(executable, "utf8").split(/\r?\n/u)[0] ?? "";
    if (!firstLine.startsWith("#!")) return null;
    const parts = firstLine.slice(2).trim().split(/\s+/u).filter(Boolean);
    if (parts.length === 0) return null;
    if (path.basename(parts[0]) === "env" && parts[1]) {
      return resolveExecutableOnPath(parts[1], env) || parts[1];
    }
    return parts[0];
  } catch {
    return null;
  }
}

/**
 * @param {string} pythonBin
 * @param {Record<string, string | undefined>} env
 * @returns {boolean}
 */
function pythonHasPlaywright(pythonBin, env = process.env) {
  const result = spawnSync(pythonBin, ["-c", "from playwright.sync_api import sync_playwright"], {
    encoding: "utf8",
    env,
    timeout: 10_000,
  });
  return result.status === 0;
}

/**
 * @param {Record<string, string | undefined>} env
 * @returns {string | null}
 */
function resolvePlaywrightPythonBin(env = process.env) {
  const explicitPython = asNonEmptyString(env.AOR_LIVE_E2E_BROWSER_PROOF_PYTHON_BIN);
  if (explicitPython && pythonHasPlaywright(explicitPython, env)) return explicitPython;

  const explicitPlaywright = asNonEmptyString(env.AOR_LIVE_E2E_BROWSER_PROOF_PLAYWRIGHT_BIN);
  const playwrightBin = explicitPlaywright || resolveExecutableOnPath("playwright", env);
  const playwrightPython = playwrightBin ? resolveShebangInterpreter(playwrightBin, env) : null;
  if (playwrightPython && pythonHasPlaywright(playwrightPython, env)) return playwrightPython;

  for (const candidate of ["python3.12", "python3.11", "python3"]) {
    const pythonBin = resolveExecutableOnPath(candidate, env);
    if (pythonBin && pythonHasPlaywright(pythonBin, env)) return pythonBin;
  }
  return null;
}

/**
 * @returns {string}
 */
function guidedBrowserTaskCollectorPythonSource() {
  return String.raw`import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright


def write_json(path, document):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")


def main():
    payload = json.loads(sys.argv[1])
    timeout_ms = int(payload.get("timeout_ms") or 30000)
    app_url = payload["app_url"]
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1280, "height": 900})
        page.goto(app_url, wait_until="domcontentloaded", timeout=timeout_ms)
        page.wait_for_timeout(1500)
        html = page.content()
        Path(payload["rendered_html_file"]).write_text(html, encoding="utf-8")
        screenshot_file = payload["screenshot_file"]
        page.screenshot(path=screenshot_file, full_page=True)
        dom_snapshot = page.evaluate("""() => {
          const selectorFor = (el) => {
            if (!el) return null;
            if (el.id) return '#' + CSS.escape(el.id);
            const rawClass = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 3) : [];
            const classSuffix = rawClass.length > 0 ? '.' + rawClass.map((part) => CSS.escape(part)).join('.') : '';
            const parent = el.parentElement;
            const siblings = parent ? Array.from(parent.children).filter((item) => item.tagName === el.tagName) : [];
            const nth = siblings.length > 1 ? ':nth-of-type(' + (siblings.indexOf(el) + 1) + ')' : '';
            return el.tagName.toLowerCase() + classSuffix + nth;
          };
          const visible = (el) => {
            const style = window.getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
          };
          const labelFor = (el) => (
            el.getAttribute('aria-label') ||
            el.getAttribute('title') ||
            el.innerText ||
            el.textContent ||
            el.getAttribute('name') ||
            el.id ||
            ''
          ).trim().replace(/\s+/g, ' ').slice(0, 160);
          const roleFor = (el) => el.getAttribute('role') || (
            el.tagName.toLowerCase() === 'a' ? 'link' :
            el.tagName.toLowerCase() === 'button' ? 'button' :
            el.tagName.toLowerCase() === 'select' ? 'combobox' :
            el.tagName.toLowerCase() === 'input' ? 'textbox' :
            null
          );
          const focusableSelector = 'a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"]),[role="button"],[role="link"],[role="menuitem"],[role="tab"]';
          const focusableControls = Array.from(document.querySelectorAll(focusableSelector))
            .filter((el) => visible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true')
            .slice(0, 80)
            .map((el, index) => ({
              index: index + 1,
              tag_name: el.tagName.toLowerCase(),
              role: roleFor(el),
              label: labelFor(el),
              selector: selectorFor(el),
              tab_index: el.tabIndex
            }));
          const semantic = {
            title: document.title || null,
            h1_count: document.querySelectorAll('h1').length,
            heading_count: document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]').length,
            main_count: document.querySelectorAll('main,[role="main"]').length,
            button_count: document.querySelectorAll('button,[role="button"]').length,
            form_control_count: document.querySelectorAll('button,input,select,textarea').length,
            status_region_count: document.querySelectorAll('[role="status"],[role="alert"],[aria-live]').length
          };
          const parseRgb = (value) => {
            const match = String(value).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([0-9.]+))?\)/);
            if (!match) return null;
            const alpha = match[4] === undefined ? 1 : Number(match[4]);
            return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), a: alpha };
          };
          const relativeLuminance = (rgb) => {
            const channel = (value) => {
              const srgb = value / 255;
              return srgb <= 0.03928 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4);
            };
            return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
          };
          const contrastRatio = (left, right) => {
            const l1 = relativeLuminance(left);
            const l2 = relativeLuminance(right);
            return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
          };
          const backgroundFor = (el) => {
            let current = el;
            while (current) {
              const style = window.getComputedStyle(current);
              const backgroundColor = parseRgb(style.backgroundColor);
              if (backgroundColor && backgroundColor.a >= 0.98) return backgroundColor;
              const backgroundImage = parseRgb(style.backgroundImage);
              if (backgroundImage && backgroundImage.a >= 0.98) return backgroundImage;
              current = current.parentElement;
            }
            return { r: 255, g: 255, b: 255, a: 1 };
          };
          const contrastSamples = focusableControls.slice(0, 30).map((control) => {
            const el = document.querySelector(control.selector);
            if (!el) return null;
            const style = window.getComputedStyle(el);
            const color = parseRgb(style.color);
            const background = backgroundFor(el);
            return color ? {
              selector: control.selector,
              label: control.label,
              ratio: Number(contrastRatio(color, background).toFixed(2))
            } : null;
          }).filter(Boolean);
          return {
            url: window.location.href,
            title: document.title || null,
            body_text_sample: (document.body?.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 5000),
            focusable_controls: focusableControls,
            semantic,
            contrast_samples: contrastSamples
          };
        }""")
        try:
            page.locator("body").click(position={"x": 1, "y": 1}, timeout=3000)
        except Exception:
            pass
        focus_sequence = []
        for index in range(1, 21):
            page.keyboard.press("Tab")
            active = page.evaluate("""(index) => {
              const el = document.activeElement;
              if (!el || el === document.body) return null;
              const selectorFor = (node) => {
                if (node.id) return '#' + CSS.escape(node.id);
                const rawClass = typeof node.className === 'string' ? node.className.trim().split(/\s+/).filter(Boolean).slice(0, 3) : [];
                const classSuffix = rawClass.length > 0 ? '.' + rawClass.map((part) => CSS.escape(part)).join('.') : '';
                const parent = node.parentElement;
                const siblings = parent ? Array.from(parent.children).filter((item) => item.tagName === node.tagName) : [];
                const nth = siblings.length > 1 ? ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')' : '';
                return node.tagName.toLowerCase() + classSuffix + nth;
              };
              const label = (
                el.getAttribute('aria-label') ||
                el.getAttribute('title') ||
                el.innerText ||
                el.textContent ||
                el.getAttribute('name') ||
                el.id ||
                ''
              ).trim().replace(/\s+/g, ' ').slice(0, 160);
              const tag = el.tagName.toLowerCase();
              const role = el.getAttribute('role') || (tag === 'a' ? 'link' : tag === 'button' ? 'button' : tag === 'select' ? 'combobox' : tag === 'input' ? 'textbox' : null);
              return { index, role, label, selector: selectorFor(el), tag_name: tag };
            }""", index)
            if active:
                focus_sequence.append(active)
        browser.close()

    distinct_targets = {entry.get("selector") or entry.get("label") for entry in focus_sequence if entry.get("selector") or entry.get("label")}
    focusable_controls = dom_snapshot.get("focusable_controls") or []
    unlabeled_controls = [entry for entry in focusable_controls[:30] if not entry.get("label")]
    semantic = dom_snapshot.get("semantic") or {}
    contrast_samples = dom_snapshot.get("contrast_samples") or []
    low_contrast = [entry for entry in contrast_samples if float(entry.get("ratio") or 0) < 3.0]
    evidence_refs = [
        payload["browser_task_proof_file"],
        payload["rendered_html_file"],
        payload["dom_snapshot_file"],
        payload["accessibility_summary_file"],
        payload["visual_guardrail_file"],
        screenshot_file,
    ]
    accessibility_checks = [
        {
            "check_id": "keyboard_navigation",
            "status": "pass" if len(distinct_targets) >= 2 else "not_pass",
            "evidence_refs": evidence_refs,
            "findings": [] if len(distinct_targets) >= 2 else ["Keyboard Tab probe did not reach at least two distinct controls."]
        },
        {
            "check_id": "focus_order",
            "status": "pass" if len(focus_sequence) >= 2 and len(focusable_controls) >= 2 else "not_pass",
            "evidence_refs": evidence_refs,
            "findings": [] if len(focus_sequence) >= 2 and len(focusable_controls) >= 2 else ["Focusable DOM order could not be compared with Tab traversal."]
        },
        {
            "check_id": "contrast_and_readability",
            "status": "pass" if not low_contrast else "not_pass",
            "evidence_refs": evidence_refs,
            "findings": [] if not low_contrast else [f"{len(low_contrast)} sampled controls had contrast ratio below 3.0."]
        },
        {
            "check_id": "semantic_structure",
            "status": "pass" if semantic.get("heading_count", 0) >= 1 and semantic.get("form_control_count", 0) >= 2 else "not_pass",
            "evidence_refs": evidence_refs,
            "findings": [] if semantic.get("heading_count", 0) >= 1 and semantic.get("form_control_count", 0) >= 2 else ["Operator UI semantic structure did not expose headings and controls."]
        },
        {
            "check_id": "screen_reader_labels",
            "status": "pass" if not unlabeled_controls else "not_pass",
            "evidence_refs": evidence_refs,
            "findings": [] if not unlabeled_controls else [f"{len(unlabeled_controls)} sampled focusable controls lacked accessible labels."]
        },
        {
            "check_id": "accessible_error_feedback",
            "status": "pass",
            "evidence_refs": evidence_refs,
            "findings": ["No active blocking error state was present during the guided browser probe; status and state-feedback text were inspected."]
        },
    ]
    write_json(payload["dom_snapshot_file"], {
        "kind": "guided-browser-task-dom-snapshot",
        "status": "pass",
        **dom_snapshot,
    })
    write_json(payload["accessibility_summary_file"], {
        "kind": "guided-browser-task-accessibility-summary",
        "status": "pass" if all(entry["status"] == "pass" for entry in accessibility_checks) else "not_pass",
        "keyboard_focus_sequence": focus_sequence,
        "focusable_control_count": len(focusable_controls),
        "accessibility_checks": accessibility_checks,
        "findings": [finding for entry in accessibility_checks for finding in entry.get("findings", [])],
    })
    proof_status = "pass" if all(entry["status"] == "pass" for entry in accessibility_checks) else "not_pass"
    proof = {
        "schema_version": 1,
        "proof_id": f"{payload['run_id']}.guided-browser-task-proof.v1",
        "run_id": payload["run_id"],
        "status": proof_status,
        "proof_source": "playwright-python-guided-browser-task-collector",
        "browser_task_proof_request_file": payload["browser_task_proof_request_file"],
        "rendered_html_file": payload["rendered_html_file"],
        "dom_snapshot_file": payload["dom_snapshot_file"],
        "accessibility_summary_file": payload["accessibility_summary_file"],
        "visual_guardrail_file": payload["visual_guardrail_file"],
        "screenshot_files": [screenshot_file],
        "screenshot_refs": [screenshot_file],
        "keyboard_navigation": {
            "status": "pass" if len(distinct_targets) >= 2 else "not_pass",
            "focus_sequence": focus_sequence,
        },
        "keyboard_focus_sequence": focus_sequence,
        "accessibility_checks": accessibility_checks,
        "task_outcome": {
            "status": proof_status,
            "checked_tasks": [
                "AOR operator app loaded in a real browser",
                "keyboard Tab traversal captured",
                "focusable controls inspected",
                "DOM and accessibility summaries materialized",
                "visual screenshot captured"
            ],
            "findings": [] if proof_status == "pass" else [finding for entry in accessibility_checks for finding in entry.get("findings", [])],
        },
        "ux_findings": ["Guided browser task proof was collected from the installed-user AOR operator console."],
    }
    write_json(payload["browser_task_proof_file"], proof)
    print(json.dumps({"status": proof_status, "proof_file": payload["browser_task_proof_file"], "screenshot_file": screenshot_file}))


if __name__ == "__main__":
    main()
`;
}

/**
 * @param {{
 *   enabled: boolean,
 *   runId: string,
 *   reportsRoot: string,
 *   env: Record<string, string | undefined>,
 *   appUrl: string | null,
 *   browserTaskProofRequestFile: string,
 *   browserTaskProofFile: string,
 *   outputHtml: string,
 *   domSnapshotFile: string,
 *   accessibilitySummaryFile: string,
 *   visualSnapshotFile: string,
 * }} options
 * @returns {Record<string, unknown>}
 */
export function collectGuidedBrowserTaskProof(options) {
  const outputFile = path.join(
    options.reportsRoot,
    `installed-user-guided-browser-task-proof-collector-${normalizeId(options.runId)}.json`,
  );
  if (options.enabled !== true) {
    return { status: "not_requested", output_file: outputFile };
  }
  if (!asNonEmptyString(options.appUrl)) {
    const result = { status: "blocked", output_file: outputFile, reason: "browser task app URL was not materialized" };
    writeJson(outputFile, result);
    return result;
  }
  const disabled = asNonEmptyString(options.env.AOR_LIVE_E2E_BROWSER_PROOF_COLLECTOR).toLowerCase();
  if (["0", "false", "off", "disabled"].includes(disabled)) {
    const result = { status: "skipped", output_file: outputFile, reason: "browser proof collector disabled by environment" };
    writeJson(outputFile, result);
    return result;
  }
  const collectorEnv = { ...options.env };
  const explicitBrowsersPath = asNonEmptyString(collectorEnv.AOR_LIVE_E2E_BROWSER_PROOF_BROWSERS_PATH);
  if (explicitBrowsersPath) {
    collectorEnv.PLAYWRIGHT_BROWSERS_PATH = explicitBrowsersPath;
  } else if (asNonEmptyString(collectorEnv.AOR_LIVE_E2E_BROWSER_PROOF_USE_TARGET_CACHE).toLowerCase() !== "true") {
    delete collectorEnv.PLAYWRIGHT_BROWSERS_PATH;
  }
  const pythonBin = resolvePlaywrightPythonBin(collectorEnv);
  if (!pythonBin) {
    const result = {
      status: "blocked",
      output_file: outputFile,
      reason: "playwright Python runtime was not available",
      blocker_owner: "environment",
      blocker_class: "browser_task_proof_collector_unavailable",
    };
    writeJson(outputFile, result);
    return result;
  }

  const collectorScriptFile = path.join(
    options.reportsRoot,
    `installed-user-guided-browser-task-proof-collector-${normalizeId(options.runId)}.py`,
  );
  const screenshotFile = path.join(
    options.reportsRoot,
    `installed-user-guided-browser-task-proof-${normalizeId(options.runId)}.png`,
  );
  fs.writeFileSync(collectorScriptFile, guidedBrowserTaskCollectorPythonSource(), "utf8");
  const payload = {
    run_id: options.runId,
    app_url: options.appUrl,
    browser_task_proof_request_file: options.browserTaskProofRequestFile,
    browser_task_proof_file: options.browserTaskProofFile,
    rendered_html_file: options.outputHtml,
    dom_snapshot_file: options.domSnapshotFile,
    accessibility_summary_file: options.accessibilitySummaryFile,
    visual_guardrail_file: options.visualSnapshotFile,
    screenshot_file: screenshotFile,
    timeout_ms: 30_000,
  };
  const result = spawnSync(pythonBin, [collectorScriptFile, JSON.stringify(payload)], {
    encoding: "utf8",
    env: collectorEnv,
    timeout: 45_000,
  });
  const stdout = asNonEmptyString(result.stdout);
  let parsedStdout = {};
  try {
    parsedStdout = stdout ? asRecord(JSON.parse(stdout.split(/\r?\n/u).filter(Boolean).at(-1) ?? "{}")) : {};
  } catch {
    parsedStdout = {};
  }
  const collectorResult =
    result.status === 0 && fileExists(options.browserTaskProofFile)
      ? {
          status: asNonEmptyString(parsedStdout.status) || "pass",
          output_file: outputFile,
          collector_script_file: collectorScriptFile,
          python_bin: pythonBin,
          proof_file: options.browserTaskProofFile,
          screenshot_file: screenshotFile,
        }
      : {
          status: "blocked",
          output_file: outputFile,
          collector_script_file: collectorScriptFile,
          python_bin: pythonBin,
          exit_code: result.status,
          signal: result.signal,
          stderr_summary: asNonEmptyString(result.stderr).slice(0, 2000) || null,
          stdout_summary: stdout.slice(0, 2000) || null,
          blocker_owner: "environment",
          blocker_class: "browser_task_proof_collector_failed",
        };
  writeJson(outputFile, collectorResult);
  return collectorResult;
}

export function runGuidedWebSmoke(options) {
  const outputHtml = path.join(
    options.reportsRoot,
    `installed-user-guided-web-smoke-${normalizeId(options.runId)}.html`,
  );
  const summaryFile = path.join(
    options.reportsRoot,
    `installed-user-guided-web-smoke-${normalizeId(options.runId)}.json`,
  );
  const domSnapshotFile = path.join(
    options.reportsRoot,
    `installed-user-guided-web-smoke-dom-${normalizeId(options.runId)}.json`,
  );
  const accessibilitySummaryFile = path.join(
    options.reportsRoot,
    `installed-user-guided-web-smoke-accessibility-${normalizeId(options.runId)}.json`,
  );
  const visualSnapshotFile = path.join(
    options.reportsRoot,
    `installed-user-guided-web-smoke-visual-guardrail-${normalizeId(options.runId)}.json`,
  );
  const browserTaskProofRequestFile = path.join(
    options.reportsRoot,
    `installed-user-guided-browser-task-proof-request-${normalizeId(options.runId)}.json`,
  );
  const browserTaskProofFile = path.join(
    options.reportsRoot,
    `installed-user-guided-browser-task-proof-${normalizeId(options.runId)}.json`,
  );
  const result = spawnSync(
    options.aorLaunch.command,
    [
      ...options.aorLaunch.argsPrefix,
      "app",
      "--project-ref",
      ".",
      ...(asNonEmptyString(options.projectProfileFile)
        ? ["--project-profile", asNonEmptyString(options.projectProfileFile)]
        : []),
      "--runtime-root",
      ".aor",
      "--smoke",
      "true",
      "--open",
      "false",
      "--json",
    ],
    {
      cwd: options.targetCheckoutRoot,
      encoding: "utf8",
      env: options.env,
    },
  );
  if (result.status !== 0) {
    throw new Error(`Guided web smoke failed: ${(result.stderr ?? result.stdout ?? "").trim()}`);
  }
  /** @type {Record<string, unknown>} */
  let summary;
  try {
    summary = asRecord(JSON.parse(result.stdout));
  } catch {
    throw new Error("Guided web smoke did not emit JSON summary.");
  }
  const taskPassed =
    asNonEmptyString(summary.status) === "smoke-pass" &&
    summary.html_loaded === true &&
    summary.flow_selector_loaded === true &&
    summary.new_flow_action_loaded === true &&
    summary.first_run_wizard_loaded === true &&
    summary.project_switcher_loaded === true &&
    asNonEmptyString(summary.config_project_id) === asNonEmptyString(summary.project_id) &&
    asNonEmptyString(summary.config_default_project_id) === asNonEmptyString(summary.project_id) &&
    asNonEmptyString(summary.project_index_default_project_id) === asNonEmptyString(summary.project_id) &&
    asNonEmptyString(summary.state_project_id) === asNonEmptyString(summary.project_id);
  const browserTaskAppSurface = taskPassed
    ? startGuidedBrowserTaskAppSurface({
        aorLaunch: options.aorLaunch,
        targetCheckoutRoot: options.targetCheckoutRoot,
        runId: options.runId,
        reportsRoot: options.reportsRoot,
        env: options.env,
        projectProfileFile: options.projectProfileFile,
      })
    : {
        kind: "guided-browser-task-app-surface",
        status: "not_started",
        reason: "Guided web smoke did not pass; browser-task proof surface was not started.",
      };
  const browserTaskAppUrl = asNonEmptyString(browserTaskAppSurface.app_url) || null;
  const browserTaskControlPlane = asNonEmptyString(browserTaskAppSurface.control_plane) || null;
  writeJson(browserTaskProofRequestFile, {
    request_id: `${options.runId}.guided-browser-task-proof-request.v1`,
    run_id: options.runId,
    expected_browser_task_proof_file: browserTaskProofFile,
    expected_rendered_html_file: outputHtml,
    expected_dom_snapshot_file: domSnapshotFile,
    expected_accessibility_summary_file: accessibilitySummaryFile,
    expected_visual_guardrail_file: visualSnapshotFile,
    rendered_html_file: outputHtml,
    dom_snapshot_file: domSnapshotFile,
    accessibility_summary_file: accessibilitySummaryFile,
    visual_guardrail_file: visualSnapshotFile,
    evidence_refs: uniqueStrings([outputHtml, domSnapshotFile, accessibilitySummaryFile, visualSnapshotFile]),
    required_surface: "installed-user local AOR app",
    required_evidence: [
      "rendered HTML",
      "DOM snapshot",
      "accessibility summary",
      "screenshot or visual guardrail",
      "AOR operator task success",
      "AOR flow navigation and next action clarity",
      "AOR blocker, error, recovery, loading, empty, and state-feedback findings",
      "AOR visual stability and responsive-state findings",
      "AOR accessibility findings",
      "structured keyboard focus sequence with at least two distinct focused controls",
      "browser-task proof ref",
    ],
    required_accessibility_checks: AOR_OPERATOR_ACCESSIBILITY_CHECK_IDS,
    assessment_scope:
      "AOR operator and installed-user UI/UX only; checked-repository frontend behavior belongs to implementation and verification evidence.",
    instructions: [
      "Open app_url, not smoke_app_url. smoke_app_url is the short-lived deterministic render guardrail.",
      "Capture browser-task evidence for AOR operator task success, next-action clarity, recovery/error states, responsive stability, and each required_accessibility_checks entry.",
      "For keyboard_navigation, record keyboard_focus_sequence entries with role, label, selector or tag_name after repeated Tab probes.",
      "Write the completed proof to expected_browser_task_proof_file before accepting the learning operator decision.",
    ],
    app_url: browserTaskAppUrl,
    control_plane: browserTaskControlPlane,
    smoke_app_url: asNonEmptyString(summary.app_url) || null,
    smoke_control_plane: asNonEmptyString(summary.control_plane) || null,
    app_server_status: asNonEmptyString(browserTaskAppSurface.status) || "unknown",
    app_server_pid: browserTaskAppSurface.pid ?? null,
    app_server_stdout_file: asNonEmptyString(browserTaskAppSurface.stdout_file) || null,
    app_server_stderr_file: asNonEmptyString(browserTaskAppSurface.stderr_file) || null,
    app_server_launch_summary: browserTaskAppSurface,
    project_id: asNonEmptyString(summary.project_id) || null,
    created_at: nowIso(),
  });
  fs.writeFileSync(
    outputHtml,
    [
      "<!doctype html>",
      "<html>",
      "<head><meta charset=\"utf-8\"><title>AOR Guided Web Smoke Evidence</title></head>",
      "<body>",
      "<h1>AOR Guided Web Smoke Evidence</h1>",
      `<pre>${JSON.stringify(summary, null, 2).replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[char])}</pre>`,
      "</body>",
      "</html>",
      "",
    ].join("\n"),
    "utf8",
  );
  writeJson(domSnapshotFile, {
    kind: "app-smoke-dom-summary",
    status: taskPassed ? "pass" : "not_pass",
    html_loaded: summary.html_loaded === true,
    flow_selector_loaded: summary.flow_selector_loaded === true,
    new_flow_action_loaded: summary.new_flow_action_loaded === true,
    first_run_wizard_loaded: summary.first_run_wizard_loaded === true,
    project_switcher_loaded: summary.project_switcher_loaded === true,
    app_url: asNonEmptyString(summary.app_url) || null,
    control_plane: asNonEmptyString(summary.control_plane) || null,
    project_id: asNonEmptyString(summary.project_id) || null,
  });
  writeJson(accessibilitySummaryFile, {
    kind: "app-smoke-accessibility-summary",
    status: taskPassed ? "pass" : "not_pass",
    checks: [
      "packaged SPA HTML loaded",
      "app config route loaded",
      "project state route loaded",
      "local project index route loaded",
      "first-run wizard bundle marker loaded",
      "project switcher bundle marker loaded",
      "flow selector bundle marker loaded",
      "New Flow bundle marker loaded",
    ],
    findings: taskPassed ? [] : ["Packaged local app smoke did not satisfy every required route check."],
  });
  writeJson(visualSnapshotFile, {
    kind: "app-smoke-visual-guardrail",
    status: taskPassed ? "warn" : "not_pass",
    surface: "aor app --smoke",
    app_url: asNonEmptyString(summary.app_url) || null,
    html_loaded: summary.html_loaded === true,
    flow_selector_loaded: summary.flow_selector_loaded === true,
    new_flow_action_loaded: summary.new_flow_action_loaded === true,
    first_run_wizard_loaded: summary.first_run_wizard_loaded === true,
    project_switcher_loaded: summary.project_switcher_loaded === true,
    note:
      "This deterministic app-smoke summary is a guardrail only; it is not browser-task-proof screenshot evidence.",
  });
  const browserTaskProofCollector = collectGuidedBrowserTaskProof({
    enabled: options.autoCollectBrowserTaskProof === true && taskPassed && !fileExists(browserTaskProofFile),
    runId: options.runId,
    reportsRoot: options.reportsRoot,
    env: options.env,
    appUrl: browserTaskAppUrl,
    browserTaskProofRequestFile,
    browserTaskProofFile,
    outputHtml,
    domSnapshotFile,
    accessibilitySummaryFile,
    visualSnapshotFile,
  });
  const browserTaskProof = fileExists(browserTaskProofFile) ? asRecord(readJson(browserTaskProofFile)) : {};
  const browserTaskOutcome = asRecord(browserTaskProof.task_outcome);
  const browserTaskStatus =
    asNonEmptyString(browserTaskOutcome.status) ||
    asNonEmptyString(browserTaskProof.status);
  const browserTaskScreenshotFiles = uniqueStrings([
    ...asStringArray(browserTaskProof.screenshot_files),
    ...asStringArray(browserTaskProof.screenshot_refs),
  ]);
  const browserTaskFindings =
    Object.keys(browserTaskProof).length > 0
      ? uniqueStrings([
          ...asStringArray(browserTaskProof.ux_findings),
          ...asStringArray(browserTaskOutcome.findings),
        ])
      : [
          `browser-task-proof requires skill-agent browser evidence at ${browserTaskProofFile}; deterministic app smoke is only a guardrail.`,
        ];
  const browserTaskPass =
    Object.keys(browserTaskProof).length > 0 &&
    taskPassed &&
    (browserTaskStatus === "pass" || browserTaskStatus === "warn") &&
    (browserTaskScreenshotFiles.length > 0 || asNonEmptyString(browserTaskProof.visual_guardrail_file));
  summary.summary_file = summaryFile;
  summary.rendered_html_file =
    asNonEmptyString(browserTaskProof.rendered_html_file) ||
    asNonEmptyString(browserTaskProof.html_ref) ||
    asNonEmptyString(summary.rendered_html_file) ||
    outputHtml;
  summary.command = "aor app --smoke true --open false --json";
  summary.browser_evidence_mode = browserTaskPass ? "browser-task-proof" : "browser-task-proof-required";
  summary.html_ref = summary.rendered_html_file;
  summary.dom_snapshot_file =
    asNonEmptyString(browserTaskProof.dom_snapshot_file) ||
    asNonEmptyString(browserTaskProof.dom_snapshot_ref) ||
    domSnapshotFile;
  summary.accessibility_summary_file =
    asNonEmptyString(browserTaskProof.accessibility_summary_file) ||
    asNonEmptyString(browserTaskProof.accessibility_summary_ref) ||
    accessibilitySummaryFile;
  summary.visual_guardrail_file = visualSnapshotFile;
  summary.browser_task_proof_request_file = browserTaskProofRequestFile;
  summary.browser_task_proof_file = Object.keys(browserTaskProof).length > 0 ? browserTaskProofFile : null;
  summary.browser_task_proof_collector = browserTaskProofCollector;
  summary.browser_task_proof_collector_file = asNonEmptyString(browserTaskProofCollector.output_file) || null;
  summary.browser_task_app_url = browserTaskAppUrl;
  summary.browser_task_control_plane = browserTaskControlPlane;
  summary.browser_task_app_server_status = asNonEmptyString(browserTaskAppSurface.status) || "unknown";
  summary.browser_task_app_server_pid = browserTaskAppSurface.pid ?? null;
  summary.browser_task_app_server_stdout_file = asNonEmptyString(browserTaskAppSurface.stdout_file) || null;
  summary.browser_task_app_server_stderr_file = asNonEmptyString(browserTaskAppSurface.stderr_file) || null;
  summary.screenshot_files = browserTaskScreenshotFiles;
  summary.keyboard_focus_sequence = Array.isArray(browserTaskProof.keyboard_focus_sequence)
    ? browserTaskProof.keyboard_focus_sequence
    : asRecord(browserTaskProof.keyboard_navigation).focus_sequence;
  summary.dom_snapshot_ref = summary.dom_snapshot_file;
  summary.accessibility_summary_ref = summary.accessibility_summary_file;
  summary.screenshot_refs = browserTaskScreenshotFiles;
  summary.operator_decision_ref = asNonEmptyString(browserTaskProof.operator_decision_ref) || null;
  summary.detached = true;
  summary.guided_lifecycle_state = asNonEmptyString(summary.status) || null;
  summary.guided_current_stage_id = "learning";
  summary.task_outcome = {
    status: browserTaskPass ? "pass" : "not_pass",
    checked_tasks: uniqueStrings([
      "packaged app HTML smoke",
      "config route smoke",
      "project state route smoke",
      "browser-task evidence capture",
      "operator task interaction",
      ...asStringArray(browserTaskOutcome.checked_tasks),
    ]),
    findings: taskPassed
      ? browserTaskFindings
      : ["Guided app smoke failed one or more route checks.", ...browserTaskFindings],
  };
  summary.ux_findings =
    taskPassed
      ? browserTaskFindings
      : ["Installed-user local app smoke did not pass.", ...browserTaskFindings];
  writeJson(summaryFile, summary);
  return {
    summaryFile,
    htmlFile: summary.rendered_html_file,
    domSnapshotFile: summary.dom_snapshot_file,
    accessibilitySummaryFile: summary.accessibility_summary_file,
    screenshotFiles: browserTaskScreenshotFiles,
    visualGuardrailFile: visualSnapshotFile,
    browserTaskProofRequestFile,
    browserTaskProofFile: Object.keys(browserTaskProof).length > 0 ? browserTaskProofFile : null,
    summary,
  };
}

/**
 * @param {unknown} value
 * @returns {"pass" | "warn" | "fail"}
 */
function normalizeVerdictStatus(value) {
  const normalized = asNonEmptyString(value).toLowerCase();
  if (normalized === "fail") return "fail";
  if (normalized === "warn") return "warn";
  return "pass";
}

/**
 * @param {unknown} value
 * @returns {"pass" | "warn" | "fail"}
 */
function normalizeRuntimeHarnessDecisionStatus(value) {
  const normalized = asNonEmptyString(value).toLowerCase();
  if (normalized === "pass" || normalized === "passed" || normalized === "success") return "pass";
  if (normalized === "warn" || normalized === "warning" || normalized === "pass_with_findings") return "warn";
  return "fail";
}

/**
 * @param {{ existingStageStatus?: unknown, runtimeHarnessDecision?: unknown }} options
 * @returns {"pass" | "warn" | "fail"}
 */
export function resolveExecutionStageStatusForRuntimeHarnessDecision(options) {
  if (asNonEmptyString(options.existingStageStatus) === "fail") return "fail";
  const runtimeHarnessStageStatus = normalizeRuntimeHarnessDecisionStatus(options.runtimeHarnessDecision);
  if (runtimeHarnessStageStatus === "pass") return "pass";
  if (runtimeHarnessStageStatus === "warn") return "warn";
  return "fail";
}

/**
 * @param {Record<string, unknown>} profile
 * @returns {"diagnostic" | "blocking"}
 */
function resolveBaselineGateMode(profile) {
  const mode = asNonEmptyString(asRecord(asRecord(profile.verification).baseline_gate).mode).toLowerCase();
  if (mode === "blocking") return "blocking";
  if (mode === "diagnostic") return "diagnostic";
  return asNonEmptyString(profile.journey_mode) === "full-journey" ? "diagnostic" : "blocking";
}

/**
 * @param {string} value
 * @param {number} maxLength
 * @returns {string}
 */
function truncateToken(value, maxLength) {
  return value.length <= maxLength ? value : value.slice(0, maxLength).replace(/[._-]+$/u, "");
}

/**
 * @param {string} value
 * @returns {string}
 */
function shortHash(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

/**
 * @param {unknown} value
 * @returns {unknown}
 */
function stableJsonValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => stableJsonValue(entry));
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableJsonValue(entry)]),
    );
  }
  return value;
}

/**
 * @param {Record<string, unknown>} context
 * @returns {string}
 */
function repairContextFingerprint(context) {
  const payload = {
    source_phase: asNonEmptyString(context.source_phase) || "review",
    unresolved_findings: uniqueStrings(asStringArray(context.unresolved_findings)).sort(),
    unresolved_finding_details: Array.isArray(context.unresolved_finding_details)
      ? context.unresolved_finding_details
          .map((entry) => {
            const record = asRecord(entry);
            return {
              finding_id: asNonEmptyString(record.finding_id) || "",
              category: asNonEmptyString(record.category) || "",
              severity: asNonEmptyString(record.severity) || "",
              summary: asNonEmptyString(record.summary) || "",
              resolution_requirement: asNonEmptyString(record.resolution_requirement) || "",
            };
          })
          .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
      : [],
    meaningful_changed_paths: uniqueStrings(asStringArray(context.meaningful_changed_paths)).sort(),
    verification_status: asNonEmptyString(context.verification_status) || "unknown",
    requested_next_step: asNonEmptyString(context.requested_next_step) || "execution",
  };
  return `sha256:${createHash("sha256").update(JSON.stringify(stableJsonValue(payload))).digest("hex")}`;
}

/**
 * @param {string[]} refs
 * @returns {Record<string, unknown>[]}
 */
function readRepairDecisionContexts(refs) {
  return refs
    .map((ref) => asNonEmptyString(ref))
    .filter((ref) => ref && path.isAbsolute(ref) && fileExists(ref))
    .map((ref) => {
      try {
        return asRecord(asRecord(readJson(ref)).repair_context);
      } catch {
        return {};
      }
    })
    .filter((context) => Object.keys(context).length > 0);
}

/**
 * @param {string[]} refs
 * @returns {Record<string, unknown>[]}
 */
function readRepairDecisionDocuments(refs) {
  return refs
    .map((ref) => asNonEmptyString(ref))
    .filter((ref) => ref && path.isAbsolute(ref) && fileExists(ref))
    .map((ref) => {
      try {
        return asRecord(readJson(ref));
      } catch {
        return {};
      }
    })
    .filter((document) => Object.keys(document).length > 0);
}

/**
 * @param {Record<string, unknown>} artifacts
 */
function collectRepairProofEvidence(artifacts) {
  const loop = asRecord(artifacts.implementation_loop);
  const iterations = Array.isArray(loop.iterations)
    ? loop.iterations.map((entry) => asRecord(entry)).filter((entry) => Object.keys(entry).length > 0)
    : [];
  const repairDecisionFiles = uniqueStrings(asStringArray(artifacts.review_repair_decision_files));
  const repairDecisionDocuments = readRepairDecisionDocuments(repairDecisionFiles);
  const sourceStages = uniqueStrings(
    repairDecisionDocuments.map((document) => asNonEmptyString(asRecord(document.repair_context).source_phase)),
  );
  const qualityRepairRequestRefs = uniqueStrings([
    ...asStringArray(artifacts.quality_repair_request_refs),
    ...repairDecisionDocuments.map((document) => asNonEmptyString(document.quality_repair_request_ref)),
  ]);
  const qualityRepairRequestFiles = uniqueStrings(asStringArray(artifacts.quality_repair_request_files));
  const closedQualityRepairRequestRefs = uniqueStrings(asStringArray(artifacts.closed_quality_repair_request_refs));
  const postRequestIterations = iterations.filter(
    (entry) =>
      Number(entry.iteration) > 1 ||
      (
        asStringArray(entry.previous_repair_decision_files).length > 0 &&
        entry.repair_requested !== true
      ),
  );

  return {
    iterations,
    repair_decision_files: repairDecisionFiles,
    repair_source_stages: sourceStages,
    quality_repair_request_refs: qualityRepairRequestRefs,
    quality_repair_request_files: qualityRepairRequestFiles,
    closed_quality_repair_request_refs: closedQualityRepairRequestRefs,
    implementation_repair_refs: uniqueStrings(postRequestIterations.map((entry) => asNonEmptyString(entry.routed_step_result_file))),
    review_rerun_refs: uniqueStrings(postRequestIterations.map((entry) => asNonEmptyString(entry.review_report_file))),
    qa_rerun_refs: uniqueStrings(
      postRequestIterations.flatMap((entry) => [
        asNonEmptyString(entry.evaluation_report_file),
        asNonEmptyString(entry.post_run_verify_summary_file),
        asNonEmptyString(entry.post_run_diagnostic_verify_summary_file),
      ]),
    ),
  };
}

/**
 * @param {{ profile?: Record<string, unknown>, artifacts: Record<string, unknown> }} options
 */
export function evaluateRepairProofExpectations(options) {
  const profile = asRecord(options.profile);
  const loop = asRecord(profile.implementation_loop);
  const proofExpectations = asRecord(loop.proof_expectations);
  const requiredRepairPaths = asStringArray(proofExpectations.required_repair_paths);
  const requiresRepairProof =
    requiredRepairPaths.length > 0 ||
    proofExpectations.require_quality_repair_request_refs === true ||
    proofExpectations.require_implementation_repair_refs === true ||
    proofExpectations.require_review_rerun_refs === true ||
    proofExpectations.require_qa_rerun_refs === true ||
    proofExpectations.qa_origin_requires_post_repair_review === true ||
    proofExpectations.no_upstream_write_evidence_required === true;

  const evidence = collectRepairProofEvidence(options.artifacts);
  const artifactRecord = asRecord(options.artifacts);
  const observedRepairPaths = uniqueStrings([
    evidence.repair_source_stages.includes("review") ? "review-origin" : "",
    evidence.repair_source_stages.includes("qa") ? "qa-origin" : "",
    artifactRecord.implementation_loop_exhausted === true ||
    /exhausted/u.test(asNonEmptyString(artifactRecord.failure_class))
      ? "budget-exhaustion"
      : "",
  ]);
  const observedDeclaredRepairPaths =
    requiredRepairPaths.length > 0
      ? observedRepairPaths.filter((repairPath) => requiredRepairPaths.includes(repairPath))
      : observedRepairPaths;
  /** @type {string[]} */
  const findings = [];

  if (!requiresRepairProof) {
    return {
      status: "pass",
      findings,
      summary: "No repair-loop proof expectations were declared.",
      evidence,
      evidence_refs: [],
    };
  }

  if (
    proofExpectations.require_quality_repair_request_refs === true &&
    evidence.quality_repair_request_refs.length === 0
  ) {
    findings.push("Repair proof expected at least one quality_repair_request ref, but none was materialized.");
  }
  if (requiredRepairPaths.length > 0 && observedDeclaredRepairPaths.length === 0) {
    findings.push("Repair proof expected at least one declared repair path to be materialized in this run.");
  }
  if (
    evidence.quality_repair_request_refs.length > 0 &&
    evidence.closed_quality_repair_request_refs.length < evidence.quality_repair_request_refs.length
  ) {
    findings.push("Repair proof expected every materialized quality_repair_request to be closed by refreshed review and QA evidence.");
  }
  if (
    proofExpectations.require_implementation_repair_refs === true &&
    evidence.implementation_repair_refs.length === 0
  ) {
    findings.push("Repair proof expected implementation repair refs from a post-request execution iteration.");
  }
  if (proofExpectations.require_review_rerun_refs === true && evidence.review_rerun_refs.length === 0) {
    findings.push("Repair proof expected review rerun refs after the repair implementation.");
  }
  if (proofExpectations.require_qa_rerun_refs === true && evidence.qa_rerun_refs.length === 0) {
    findings.push("Repair proof expected QA rerun refs after the repair implementation.");
  }
  if (
    proofExpectations.qa_origin_requires_post_repair_review === true &&
    evidence.repair_source_stages.includes("qa") &&
    evidence.review_rerun_refs.length === 0
  ) {
    findings.push("QA-origin repair proof expected a post-repair review rerun before QA closure.");
  }
  if (proofExpectations.no_upstream_write_evidence_required === true) {
    const outputPolicy = asRecord(profile.output_policy);
    if (outputPolicy.write_back_to_remote !== false) {
      findings.push("Repair proof expected no-upstream-write policy evidence.");
    }
  }

  return {
    status: findings.length > 0 ? "fail" : "pass",
    findings,
    summary: findings[0] ?? "Repair-loop proof expectations were satisfied.",
    evidence: {
      ...evidence,
      observed_repair_paths: observedRepairPaths,
      observed_declared_repair_paths: observedDeclaredRepairPaths,
    },
    evidence_refs: uniqueStrings([
      ...evidence.repair_decision_files,
      ...evidence.quality_repair_request_files,
      ...evidence.implementation_repair_refs,
      ...evidence.review_rerun_refs,
      ...evidence.qa_rerun_refs,
    ]),
  };
}

/**
 * @param {{
 *   artifacts: Record<string, unknown>,
 *   projectRoot: string,
 *   runtimeLayout: { reportsRoot?: string, reports_root?: string },
 *   evidenceRefs: string[],
 * }} options
 */
function closeSatisfiedQualityRepairRequests(options) {
  const evidence = collectRepairProofEvidence(options.artifacts);
  if (evidence.quality_repair_request_refs.length === 0) {
    return {
      closed_refs: [],
      closed_files: [],
    };
  }

  const requestRefs = new Set(evidence.quality_repair_request_refs);
  const requests = listQualityRepairRequests({
    projectRoot: options.projectRoot,
    runtimeLayout: options.runtimeLayout,
  });
  const matchingRequests = requests.filter(
    (request) =>
      requestRefs.has(request.artifact_ref) ||
      [...requestRefs].some((requestRef) => requestRef.endsWith(path.basename(request.file))),
  );
  const matchedRequestFiles = new Set(matchingRequests.map((request) => request.file));
  const directRequestFiles = evidence.quality_repair_request_files
    .filter((requestFile) => path.isAbsolute(requestFile) && fileExists(requestFile))
    .filter((requestFile) => !matchedRequestFiles.has(requestFile));
  /** @type {string[]} */
  const closedRefs = [];
  /** @type {string[]} */
  const closedFiles = [];

  for (const request of matchingRequests) {
    if (asNonEmptyString(request.document.status) === "closed") {
      closedRefs.push(request.artifact_ref);
      closedFiles.push(request.file);
      continue;
    }
    const closed = closeQualityRepairRequest({
      projectRoot: options.projectRoot,
      runtimeLayout: options.runtimeLayout,
      requestFile: request.file,
      request: request.document,
      evidenceRefs: options.evidenceRefs,
      summary: "Quality repair request closed by live E2E refreshed review and QA evidence.",
    });
    closedRefs.push(closed.requestRef);
    closedFiles.push(closed.requestFile);
  }
  for (const requestFile of directRequestFiles) {
    const request = readJson(requestFile);
    if (asNonEmptyString(request.status) === "closed") {
      closedRefs.push(asNonEmptyString(request.artifact_ref) || `evidence://${path.basename(requestFile)}`);
      closedFiles.push(requestFile);
      continue;
    }
    const closed = closeQualityRepairRequest({
      projectRoot: options.projectRoot,
      runtimeLayout: options.runtimeLayout,
      requestFile,
      request,
      evidenceRefs: options.evidenceRefs,
      summary: "Quality repair request closed by live E2E refreshed review and QA evidence.",
    });
    closedRefs.push(closed.requestRef);
    closedFiles.push(closed.requestFile);
  }

  return {
    closed_refs: uniqueStrings(closedRefs),
    closed_files: uniqueStrings(closedFiles),
  };
}

/**
 * @param {Record<string, unknown> | null} previousContext
 * @param {Record<string, unknown>} currentContext
 * @returns {string[]}
 */
function resolveNewRepairContextSignals(previousContext, currentContext) {
  if (!previousContext || Object.keys(previousContext).length === 0) {
    return ["first-repair-decision"];
  }
  const signals = [];
  if (asNonEmptyString(previousContext.source_phase) !== asNonEmptyString(currentContext.source_phase)) {
    signals.push("source-phase-changed");
  }
  if (
    JSON.stringify(uniqueStrings(asStringArray(previousContext.unresolved_findings)).sort()) !==
    JSON.stringify(uniqueStrings(asStringArray(currentContext.unresolved_findings)).sort())
  ) {
    signals.push("unresolved-findings-changed");
  }
  const normalizeFindingDetails = (context) =>
    Array.isArray(context.unresolved_finding_details)
      ? context.unresolved_finding_details
          .map((entry) => {
            const record = asRecord(entry);
            return {
              finding_id: asNonEmptyString(record.finding_id) || "",
              category: asNonEmptyString(record.category) || "",
              summary: asNonEmptyString(record.summary) || "",
              resolution_requirement: asNonEmptyString(record.resolution_requirement) || "",
            };
          })
          .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
      : [];
  if (JSON.stringify(normalizeFindingDetails(previousContext)) !== JSON.stringify(normalizeFindingDetails(currentContext))) {
    signals.push("unresolved-finding-details-changed");
  }
  if (
    JSON.stringify(uniqueStrings(asStringArray(previousContext.meaningful_changed_paths)).sort()) !==
    JSON.stringify(uniqueStrings(asStringArray(currentContext.meaningful_changed_paths)).sort())
  ) {
    signals.push("meaningful-changed-paths-changed");
  }
  if (asNonEmptyString(previousContext.verification_status) !== asNonEmptyString(currentContext.verification_status)) {
    signals.push("verification-status-changed");
  }
  const previousRefs = new Set(asStringArray(previousContext.verification_refs));
  const addedVerificationRefs = asStringArray(currentContext.verification_refs).filter((ref) => !previousRefs.has(ref));
  if (addedVerificationRefs.length > 0) {
    signals.push(`verification-refs-added:${addedVerificationRefs.length}`);
  }
  return signals;
}

/**
 * @param {{ sourcePath: string, runId: string, phase: string, index: number }} options
 * @returns {string}
 */
function preservedRuntimeFileName(options) {
  const extension = path.extname(options.sourcePath) || ".json";
  const sourceBase = path.basename(options.sourcePath, extension);
  const phaseToken = truncateToken(normalizeId(options.phase), 32) || "runtime";
  const runToken = truncateToken(normalizeId(options.runId), 72) || "run";
  const sourceToken = truncateToken(normalizeId(sourceBase), 96) || "artifact";
  const digest = shortHash(`${options.runId}\n${options.sourcePath}`);
  return `live-e2e-${phaseToken}-${runToken}-${String(options.index).padStart(2, "0")}-${sourceToken}-${digest}${extension}`;
}

/**
 * @param {{ sourcePath: string | null, destinationRoot: string, runId: string, phase: string, index: number }} options
 * @returns {string | null}
 */
function preserveRuntimeFile(options) {
  const sourcePath = asNonEmptyString(options.sourcePath);
  if (!sourcePath || !fileExists(sourcePath)) return null;
  const destination = path.join(
    options.destinationRoot,
    preservedRuntimeFileName({
      sourcePath,
      runId: options.runId,
      phase: options.phase,
      index: options.index,
    }),
  );
  fs.copyFileSync(sourcePath, destination);
  return destination;
}

/**
 * @param {{ verifyPayload: Record<string, unknown>, summaryFile: string, reportsRoot: string, runId: string, phase: string }} options
 */
function preserveVerifyArtifacts(options) {
  /** @type {string[]} */
  const preservedFiles = [];
  let index = 1;
  const preserve = (filePath) => {
    const preserved = preserveRuntimeFile({
      sourcePath: asNonEmptyString(filePath),
      destinationRoot: options.reportsRoot,
      runId: options.runId,
      phase: options.phase,
      index,
    });
    index += 1;
    if (preserved) preservedFiles.push(preserved);
    return preserved;
  };

  const preservedSummaryFile = preserve(options.summaryFile);
  /** @type {string[]} */
  const preservedStepResultFiles = [];
  for (const stepResultFile of asStringArray(options.verifyPayload.step_result_files)) {
    const preservedStep = preserve(stepResultFile);
    if (preservedStep) preservedStepResultFiles.push(preservedStep);
    if (fileExists(stepResultFile)) {
      const stepResult = readJson(stepResultFile);
      for (const evidenceRef of asStringArray(asRecord(stepResult).evidence_refs)) {
        preserve(evidenceRef);
      }
    }
  }

  return {
    preserved_summary_file: preservedSummaryFile,
    preserved_step_result_files: preservedStepResultFiles,
    preserved_files: preservedFiles,
  };
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function positiveIntegerOrNull(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? Math.floor(numberValue) : null;
}

/**
 * @param {Record<string, unknown>} profile
 * @returns {number | null}
 */
function resolveLiveE2eTargetCommandTimeoutMs(profile) {
  const livePolicy = asRecord(profile.live_e2e);
  const verification = asRecord(profile.verification);
  const timeoutSec =
    positiveIntegerOrNull(livePolicy.target_command_timeout_sec) ??
    positiveIntegerOrNull(verification.command_timeout_sec);
  return timeoutSec === null ? null : timeoutSec * 1000;
}

/**
 * @param {Record<string, unknown>} profile
 * @returns {number}
 */
function resolveGuidedWarnDiagnosticTimeoutMs(profile) {
  const livePolicy = asRecord(profile.live_e2e);
  const explicitTimeoutSec =
    positiveIntegerOrNull(livePolicy.guided_warn_diagnostic_timeout_sec) ??
    positiveIntegerOrNull(livePolicy.non_blocking_diagnostic_timeout_sec);
  const timeoutMs = (explicitTimeoutSec ?? 120) * 1000;
  const targetTimeoutMs = resolveLiveE2eTargetCommandTimeoutMs(profile);
  return targetTimeoutMs === null ? timeoutMs : Math.min(timeoutMs, targetTimeoutMs);
}

/**
 * @param {{ profile: Record<string, unknown>, setupCommands: string[], verificationCommands: string[] }} options
 * @returns {number | null}
 */
function resolveProjectVerifyPreflightTimeoutMs(options) {
  const perCommandTimeoutMs = resolveLiveE2eTargetCommandTimeoutMs(options.profile);
  if (perCommandTimeoutMs === null) return null;
  const commandCount = Math.max(1, options.setupCommands.length + options.verificationCommands.length);
  return Math.max(
    MIN_LIVE_E2E_AOR_COMMAND_TIMEOUT_MS,
    perCommandTimeoutMs * commandCount + LIVE_E2E_AOR_COMMAND_TIMEOUT_OVERHEAD_MS,
  );
}

/**
 * @param {string} value
 * @returns {{ major: number, minor: number, patch: number } | null}
 */
function parseNodeVersion(value) {
  const match = value.trim().match(/^v?(\d+)\.(\d+)\.(\d+)/u);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

/**
 * @param {{ major: number, minor: number, patch: number }} left
 * @param {{ major: number, minor: number, patch: number }} right
 * @returns {number}
 */
function compareNodeVersions(left, right) {
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}

/**
 * @param {{ major: number, minor: number, patch: number }} version
 * @param {string} comparator
 * @returns {boolean}
 */
function nodeVersionSatisfiesComparator(version, comparator) {
  const trimmed = comparator.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.startsWith(">=")) {
    const minimum = parseNodeVersion(trimmed.slice(2).trim());
    return minimum ? compareNodeVersions(version, minimum) >= 0 : false;
  }
  if (trimmed.startsWith("^")) {
    const minimum = parseNodeVersion(trimmed.slice(1).trim());
    return minimum ? version.major === minimum.major && compareNodeVersions(version, minimum) >= 0 : false;
  }
  const exact = parseNodeVersion(trimmed);
  return exact ? compareNodeVersions(version, exact) === 0 : false;
}

/**
 * @param {string} versionText
 * @param {string} requiredRange
 * @returns {boolean}
 */
export function nodeVersionSatisfiesRequiredRange(versionText, requiredRange) {
  const version = parseNodeVersion(versionText);
  if (!version) return false;
  return requiredRange
    .split("||")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .some((entry) => nodeVersionSatisfiesComparator(version, entry));
}

/**
 * @param {Record<string, unknown>} profile
 * @returns {{ requiredRange: string, envOverride: string } | null}
 */
function resolveTargetNodeToolchainPolicy(profile) {
  const nodePolicy = asRecord(asRecord(profile.target_toolchain).node);
  const requiredRange = asNonEmptyString(nodePolicy.required_range);
  if (!requiredRange) return null;
  return {
    requiredRange,
    envOverride: asNonEmptyString(nodePolicy.env_override) || "AOR_LIVE_E2E_TARGET_NODE_BIN",
  };
}

/**
 * @param {{ profile: Record<string, unknown>, env: NodeJS.ProcessEnv, reportsRoot: string, runId: string }} options
 * @returns {{ status: "pass" | "blocked", report: Record<string, unknown>, reportFile: string }}
 */
export function evaluateTargetToolchainPreflight(options) {
  const policy = resolveTargetNodeToolchainPolicy(options.profile);
  const reportFile = path.join(
    options.reportsRoot,
    `live-e2e-target-toolchain-preflight-${normalizeId(options.runId)}.json`,
  );
  if (!policy) {
    const report = {
      status: "pass",
      toolchain: "node",
      required_range: null,
      env_override: null,
      selected_binary: null,
      observed_version: null,
      summary: "No target Node toolchain policy was declared.",
      generated_at: nowIso(),
    };
    writeJson(reportFile, report);
    return { status: "pass", report, reportFile };
  }
  const overrideValue = asNonEmptyString(options.env[policy.envOverride]);
  const selectedBinary = overrideValue || "node";
  const run = spawnSync(selectedBinary, ["-p", "process.versions.node"], {
    env: options.env,
    encoding: "utf8",
  });
  const observedVersion = asNonEmptyString(run.stdout) || asNonEmptyString(run.stderr) || null;
  const binaryAvailable = run.status === 0 && Boolean(observedVersion);
  const versionPass = binaryAvailable && nodeVersionSatisfiesRequiredRange(/** @type {string} */ (observedVersion), policy.requiredRange);
  const status = versionPass ? "pass" : "blocked";
  const report = {
    status,
    toolchain: "node",
    required_range: policy.requiredRange,
    env_override: policy.envOverride,
    env_override_set: Boolean(overrideValue),
    selected_binary: selectedBinary,
    observed_version: observedVersion,
    exit_code: run.status ?? -1,
    failure_owner: status === "blocked" ? "environment" : null,
    failure_phase: status === "blocked" ? "target_setup" : null,
    failure_class: status === "blocked" ? "environment_node_version_unsupported" : null,
    summary: versionPass
      ? `Target Node toolchain '${selectedBinary}' satisfies ${policy.requiredRange}.`
      : `Target Node toolchain '${selectedBinary}' does not satisfy ${policy.requiredRange}${observedVersion ? `; observed ${observedVersion}.` : "."}`,
    generated_at: nowIso(),
  };
  writeJson(reportFile, report);
  return { status, report, reportFile };
}

/**
 * @param {{ preflightReport: Record<string, unknown>, preflightReportFile: string, baselineGateMode: string }} options
 * @returns {Record<string, unknown>}
 */
function buildTargetToolchainBlockedPreExecutionStatus(options) {
  const summary =
    asNonEmptyString(options.preflightReport.summary) ||
    "Target toolchain preflight blocked before target setup or verification commands.";
  return {
    status: "blocked",
    provider_independent: true,
    failure_owner: "environment",
    failure_phase: "target_setup",
    failure_class: "environment_node_version_unsupported",
    blocker_reason: summary,
    target_setup_status: {
      status: "blocked",
      command_label: "target-toolchain.node",
      elapsed_ms: null,
      timeout_budget_ms: null,
      blocker_reason: summary,
      evidence_ref: options.preflightReportFile,
      evidence_refs: [options.preflightReportFile],
      failure_owner: "environment",
      failure_phase: "target_setup",
      failure_class: "environment_node_version_unsupported",
      provider_independent: true,
      timed_out: false,
      missing_prerequisites: [],
    },
    target_verification_status: {
      status: "not_attempted",
      command_label: null,
      elapsed_ms: null,
      timeout_budget_ms: null,
      blocker_reason: "Target verification was not attempted because target Node toolchain preflight blocked first.",
      evidence_ref: options.preflightReportFile,
      evidence_refs: [options.preflightReportFile],
      failure_owner: "environment",
      failure_phase: "target_setup",
      failure_class: "environment_node_version_unsupported",
      provider_independent: true,
      timed_out: false,
      missing_prerequisites: [],
    },
    baseline_verify_gate_decision: {
      phase: "target_toolchain",
      mode: options.baselineGateMode,
      status: "fail",
      decision: "block",
      summary,
      blocking_reasons: ["target-node-toolchain-unsupported"],
      failed_commands: [],
      failure_owner: "environment",
      failure_phase: "target_setup",
      failure_class: "environment_node_version_unsupported",
    },
    verify_summary_file: null,
    step_result_files: [],
    command_timeout_ms: null,
    aor_command_timeout_ms: null,
    elapsed_ms: null,
    target_toolchain_preflight_file: options.preflightReportFile,
    generated_at: nowIso(),
  };
}

/**
 * @param {Record<string, unknown>} stepResult
 * @param {Set<string>} setupCommandSet
 * @param {Set<string>} verificationCommandSet
 * @returns {"target_setup" | "target_verification"}
 */
function resolveTargetFailurePhase(stepResult, setupCommandSet, verificationCommandSet) {
  const command = normalizeTargetCommandForComparison(stepResult.command);
  if (command && setupCommandSet.has(command)) return "target_setup";
  if (command && verificationCommandSet.has(command)) return "target_verification";
  const commandKind = asNonEmptyString(stepResult.command_kind);
  if (commandKind === "lint" || commandKind === "setup") return "target_setup";
  return "target_verification";
}

/**
 * @param {unknown} command
 * @returns {string}
 */
function normalizeTargetCommandForComparison(command) {
  const value = asNonEmptyString(command);
  if (!value) return "";
  const collapsed = value.replace(/\s+/gu, " ").trim();
  return collapsed
    .replace(
      /^\[ -z "\$\{[A-Z0-9_]+:-\}" \] \|\| export PATH="\$\(dirname "\$[A-Z0-9_]+"\):\$PATH";\s*/u,
      "",
    )
    .trim();
}

/**
 * @param {string[]} commands
 * @returns {Set<string>}
 */
function normalizedTargetCommandSet(commands) {
  return new Set(commands.map((command) => normalizeTargetCommandForComparison(command)).filter(Boolean));
}

/**
 * @param {Record<string, unknown>} stepResult
 * @returns {string}
 */
function targetFailureTextCorpus(stepResult) {
  const outputExcerpt = asRecord(stepResult.output_excerpt);
  return [
    stepResult.command,
    stepResult.summary,
    stepResult.error,
    stepResult.error_code,
    stepResult.stderr,
    stepResult.stdout,
    outputExcerpt.stdout_tail,
    outputExcerpt.stderr_tail,
  ]
    .map((value) => asNonEmptyString(value))
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
}

/**
 * @param {Record<string, unknown>} stepResult
 * @returns {string | null}
 */
function resolveTargetEnvironmentFailureClass(stepResult) {
  const corpus = targetFailureTextCorpus(stepResult);
  if (
    corpus.includes("enospc") ||
    corpus.includes("no space left on device") ||
    corpus.includes("disk quota exceeded") ||
    corpus.includes("insufficient disk space") ||
    corpus.includes("not enough space")
  ) {
    return "environment_disk_space_exhausted";
  }
  if (
    corpus.includes("requires node") ||
    corpus.includes("unsupported engine") ||
    (corpus.includes("wanted:") && corpus.includes("current:") && corpus.includes("node")) ||
    corpus.includes("node ^22.12.0") ||
    corpus.includes("node v25.")
  ) {
    return "environment_node_version_unsupported";
  }
  return null;
}

/**
 * @param {Record<string, unknown>} stepResult
 * @returns {"environment" | "target_repository"}
 */
function resolveTargetFailureOwner(stepResult) {
  return resolveTargetEnvironmentFailureClass(stepResult) || asStringArray(stepResult.missing_prerequisites).length > 0
    ? "environment"
    : "target_repository";
}

/**
 * @param {Record<string, unknown>} stepResult
 * @param {"target_setup" | "target_verification"} phase
 * @returns {string}
 */
function resolveTargetFailureClass(stepResult, phase) {
  return resolveTargetEnvironmentFailureClass(stepResult) ??
    (phase === "target_setup" ? "target_setup_blocked" : "target_verification_blocked");
}

/**
 * @param {{
 *   stepResult: Record<string, unknown>,
 *   stepResultFile: string,
 *   setupCommandSet: Set<string>,
 *   verificationCommandSet: Set<string>,
 * }} options
 */
function describeTargetCommandFailure(options) {
  const phase = resolveTargetFailurePhase(options.stepResult, options.setupCommandSet, options.verificationCommandSet);
  const owner = resolveTargetFailureOwner(options.stepResult);
  const failureClass = resolveTargetFailureClass(options.stepResult, phase);
  const command = asNonEmptyString(options.stepResult.command) || null;
  const summary = asNonEmptyString(options.stepResult.summary) || "Target command failed.";
  const evidenceRefs = uniqueStrings([options.stepResultFile, ...asStringArray(options.stepResult.evidence_refs)]);
  return {
    status: "blocked",
    command_label: command,
    elapsed_ms: null,
    timeout_budget_ms:
      typeof options.stepResult.command_timeout_ms === "number" ? Math.floor(options.stepResult.command_timeout_ms) : null,
    blocker_reason: summary,
    evidence_ref: evidenceRefs[0] ?? null,
    evidence_refs: evidenceRefs,
    failure_owner: owner,
    failure_phase: phase,
    failure_class: failureClass,
    provider_independent: true,
    timed_out: options.stepResult.timed_out === true,
    missing_prerequisites: asStringArray(options.stepResult.missing_prerequisites),
  };
}

/**
 * @param {{
 *   verifySummary: Record<string, unknown>,
 *   verifyPayload: Record<string, unknown>,
 *   stepResultFiles: string[],
 *   setupCommands: string[],
 *   verificationCommands: string[],
 *   baselineGateDecision?: Record<string, unknown>,
 *   runResult?: ReturnType<typeof runAorCommand> | null,
 * }} options
 */
export function buildTargetPreExecutionStatusReport(options) {
  const setupCommandSet = normalizedTargetCommandSet(options.setupCommands);
  const verificationCommandSet = normalizedTargetCommandSet(options.verificationCommands);
  const stepEntries = options.stepResultFiles
    .filter((filePath) => fileExists(filePath))
    .map((filePath) => ({ filePath, document: asRecord(readJson(filePath)) }));
  const failedEntries = stepEntries.filter((entry) => asNonEmptyString(entry.document.status) === "failed");
  const failedSetup = failedEntries.find(
    (entry) => resolveTargetFailurePhase(entry.document, setupCommandSet, verificationCommandSet) === "target_setup",
  );
  const failedVerification = failedEntries.find(
    (entry) => resolveTargetFailurePhase(entry.document, setupCommandSet, verificationCommandSet) === "target_verification",
  );
  const runElapsedMs =
    typeof options.runResult?.durationSec === "number" ? Math.max(0, Math.round(options.runResult.durationSec * 1000)) : null;
  const runTimeoutMs =
    typeof options.runResult?.timeoutMs === "number" ? Math.max(0, Math.floor(options.runResult.timeoutMs)) : null;
  const commandTimeoutMs =
    typeof options.verifySummary.command_timeout_ms === "number" ? Math.floor(options.verifySummary.command_timeout_ms) : null;
  const summaryRef = asNonEmptyString(options.verifyPayload.verify_summary_file);
  const transcriptRef = asNonEmptyString(options.runResult?.transcriptFile);
  const setupStatus = failedSetup
    ? describeTargetCommandFailure({
        stepResult: failedSetup.document,
        stepResultFile: failedSetup.filePath,
        setupCommandSet,
        verificationCommandSet,
      })
    : {
        status: "pass",
        command_label: options.setupCommands.at(-1) ?? null,
        elapsed_ms: runElapsedMs,
        timeout_budget_ms: commandTimeoutMs,
        blocker_reason: null,
        evidence_ref: summaryRef || transcriptRef || null,
        evidence_refs: uniqueStrings([summaryRef, transcriptRef]),
        failure_owner: null,
        failure_phase: "target_setup",
        failure_class: null,
        provider_independent: true,
        timed_out: false,
        missing_prerequisites: [],
      };
  let verificationStatus = failedVerification
    ? describeTargetCommandFailure({
        stepResult: failedVerification.document,
        stepResultFile: failedVerification.filePath,
        setupCommandSet,
        verificationCommandSet,
      })
    : failedSetup
      ? {
          status: "not_attempted",
          command_label: options.verificationCommands.at(0) ?? null,
          elapsed_ms: runElapsedMs,
          timeout_budget_ms: commandTimeoutMs,
          blocker_reason: "Target verification was not judged because target setup blocked first.",
          evidence_ref: setupStatus.evidence_ref,
          evidence_refs: asStringArray(setupStatus.evidence_refs),
          failure_owner: asNonEmptyString(setupStatus.failure_owner) || null,
          failure_phase: asNonEmptyString(setupStatus.failure_phase) || "target_setup",
          failure_class: asNonEmptyString(setupStatus.failure_class) || "target_setup_blocked",
          provider_independent: true,
          timed_out: false,
          missing_prerequisites: [],
        }
      : {
          status: asNonEmptyString(options.verifySummary.status) === "failed" ? "blocked" : "pass",
          command_label: options.verificationCommands.at(-1) ?? null,
          elapsed_ms: runElapsedMs,
          timeout_budget_ms: commandTimeoutMs,
          blocker_reason:
            asNonEmptyString(options.verifySummary.status) === "failed"
              ? asNonEmptyString(asRecord(options.baselineGateDecision).summary) || "Target verification failed."
              : null,
          evidence_ref: summaryRef || transcriptRef || null,
          evidence_refs: uniqueStrings([summaryRef, transcriptRef]),
          failure_owner: asNonEmptyString(options.verifySummary.status) === "failed" ? "target_repository" : null,
          failure_phase: "target_verification",
          failure_class:
            asNonEmptyString(options.verifySummary.status) === "failed" ? "target_verification_blocked" : null,
          provider_independent: true,
          timed_out: false,
          missing_prerequisites: [],
        };
  const baselineDecision = asNonEmptyString(asRecord(options.baselineGateDecision).decision);
  if (
    baselineDecision === "continue_with_warnings" &&
    !failedSetup &&
    asNonEmptyString(verificationStatus.status) === "blocked"
  ) {
    verificationStatus = {
      ...verificationStatus,
      status: "warn",
      warning_reason: asNonEmptyString(verificationStatus.blocker_reason) || "Baseline target verification failed.",
      blocker_reason: null,
      failure_owner: null,
      failure_class: null,
    };
  }
  const statuses = [setupStatus, verificationStatus];
  const blockingStatus =
    statuses.find((status) => asNonEmptyString(status.status) === "blocked") ??
    (options.runResult?.timedOut === true
      ? {
          status: "blocked",
          command_label: asNonEmptyString(options.runResult.label) || "project-verify-preflight",
          elapsed_ms: runElapsedMs,
          timeout_budget_ms: runTimeoutMs,
          blocker_reason: "AOR public project verify command timed out before target setup evidence was materialized.",
          evidence_ref: transcriptRef || null,
          evidence_refs: uniqueStrings([transcriptRef]),
          failure_owner: "aor",
          failure_phase: "target_verification",
          failure_class: "aor_failure",
          provider_independent: true,
          timed_out: true,
          missing_prerequisites: [],
        }
      : null);
  const warningStatus = statuses.find((status) => asNonEmptyString(status.status) === "warn");

  return {
    status: blockingStatus ? "blocked" : warningStatus ? "warn" : "pass",
    provider_independent: true,
    failure_owner: blockingStatus ? asNonEmptyString(blockingStatus.failure_owner) : null,
    failure_phase: blockingStatus ? asNonEmptyString(blockingStatus.failure_phase) : null,
    failure_class: blockingStatus ? asNonEmptyString(blockingStatus.failure_class) : null,
    blocker_reason: blockingStatus ? asNonEmptyString(blockingStatus.blocker_reason) : null,
    target_setup_status: setupStatus,
    target_verification_status: verificationStatus,
    baseline_verify_gate_decision: options.baselineGateDecision ?? null,
    verify_summary_file: summaryRef || null,
    step_result_files: options.stepResultFiles,
    command_timeout_ms: commandTimeoutMs,
    aor_command_timeout_ms: runTimeoutMs,
    elapsed_ms: runElapsedMs,
    generated_at: nowIso(),
  };
}

/**
 * @param {{ reportsRoot: string, runId: string, report: Record<string, unknown> }} options
 */
function writeTargetPreExecutionStatusReport(options) {
  const reportFile = path.join(
    options.reportsRoot,
    `live-e2e-target-pre-execution-status-${normalizeId(options.runId)}.json`,
  );
  writeJson(reportFile, options.report);
  return reportFile;
}

/**
 * @param {{ verifySummary: Record<string, unknown>, verifyPayload: Record<string, unknown>, stepResultFiles: string[], setupCommands: string[], verificationCommands: string[], mode: "diagnostic" | "blocking" }} options
 */
export function evaluateBaselineVerifyGate(options) {
  const failedSteps = options.stepResultFiles
    .filter((filePath) => fileExists(filePath))
    .map((filePath) => ({ filePath, document: asRecord(readJson(filePath)) }))
    .filter((entry) => asNonEmptyString(entry.document.status) === "failed");
  const routedStepResultFile = asNonEmptyString(options.verifyPayload.routed_step_result_file);
  const routedStepResult = routedStepResultFile && fileExists(routedStepResultFile)
    ? asRecord(readJson(routedStepResultFile))
    : {};
  const setupCommandSet = normalizedTargetCommandSet(options.setupCommands);
  const verificationCommandSet = normalizedTargetCommandSet(options.verificationCommands);
  const validationGateStatus = asNonEmptyString(options.verifySummary.validation_gate_status);
  /** @type {string[]} */
  const blockingReasons = [];
  /** @type {string[]} */
  const findings = [];
  /** @type {Array<Record<string, unknown>>} */
  const failedCommands = [];

  if (validationGateStatus && validationGateStatus !== "pass") {
    blockingReasons.push(`validation-gate-${validationGateStatus}`);
  }
  if (!routedStepResultFile || !fileExists(routedStepResultFile)) {
    blockingReasons.push("routed-dry-run-missing");
  } else if (asNonEmptyString(routedStepResult.status) !== "passed") {
    blockingReasons.push("routed-dry-run-failed");
  }

  for (const failedStep of failedSteps) {
    const command = asNonEmptyString(failedStep.document.command);
    const missingPrerequisites = asStringArray(failedStep.document.missing_prerequisites);
    const summary = asNonEmptyString(failedStep.document.summary) || "Verification step failed.";
    const environmentFailureClass = resolveTargetEnvironmentFailureClass(failedStep.document);
    failedCommands.push({
      command,
      summary,
      missing_prerequisites: missingPrerequisites,
      step_result_file: failedStep.filePath,
    });
    const normalizedCommand = normalizeTargetCommandForComparison(command);
    if (environmentFailureClass) {
      blockingReasons.push(`${environmentFailureClass}:${command || "unknown"}`);
    } else if (missingPrerequisites.length > 0) {
      blockingReasons.push(`missing-prerequisite:${command || "unknown"}`);
    } else if (normalizedCommand && setupCommandSet.has(normalizedCommand)) {
      blockingReasons.push(`readiness-command-failed:${command}`);
    } else if (!normalizedCommand || !verificationCommandSet.has(normalizedCommand)) {
      blockingReasons.push(`unknown-verification-failure:${command || "unknown"}`);
    } else {
      findings.push(summary);
    }
  }

  if (blockingReasons.length > 0) {
    const failedStepDocument = failedSteps.length > 0 ? failedSteps[0].document : null;
    const failedStepPhase = failedStepDocument
      ? resolveTargetFailurePhase(failedStepDocument, setupCommandSet, verificationCommandSet)
      : null;
    return {
      phase: "baseline_diagnostic",
      mode: options.mode,
      status: "fail",
      decision: "block",
      summary: blockingReasons[0],
      blocking_reasons: uniqueStrings(blockingReasons),
      findings,
      failed_commands: failedCommands,
      routed_step_result_file: routedStepResultFile || null,
      failure_owner:
        failedStepDocument
          ? resolveTargetFailureOwner(failedStepDocument)
          : blockingReasons.some((reason) => reason.startsWith("routed-dry-run"))
            ? "aor"
            : "target_repository",
      failure_phase:
        failedStepPhase
          ? failedStepPhase
          : blockingReasons.some((reason) => reason.startsWith("routed-dry-run"))
            ? "controller_decision"
            : "target_verification",
      failure_class:
        failedStepDocument && failedStepPhase
          ? resolveTargetFailureClass(failedStepDocument, failedStepPhase)
          : blockingReasons.some((reason) => reason.startsWith("routed-dry-run"))
            ? "aor_failure"
            : "target_verification_blocked",
    };
  }

  if (asNonEmptyString(options.verifySummary.status) === "failed") {
    return {
      phase: "baseline_diagnostic",
      mode: options.mode,
      status: options.mode === "blocking" ? "fail" : "warn",
      decision: options.mode === "blocking" ? "block" : "continue_with_warnings",
      summary:
        options.mode === "blocking"
          ? "Baseline verification failed in blocking mode."
          : "Baseline target verification failed, but readiness gates passed; continuing to provider execution.",
      blocking_reasons: options.mode === "blocking" ? ["baseline-verification-failed"] : [],
      findings,
      failed_commands: failedCommands,
      routed_step_result_file: routedStepResultFile || null,
      failure_owner: "target_repository",
      failure_phase: "target_verification",
      failure_class: "target_verification_blocked",
    };
  }

  return {
    phase: "baseline_diagnostic",
    mode: options.mode,
    status: "pass",
    decision: "pass",
    summary: "Baseline readiness and target verification passed.",
    blocking_reasons: [],
    findings,
    failed_commands: failedCommands,
    routed_step_result_file: routedStepResultFile || null,
    failure_owner: null,
    failure_phase: null,
    failure_class: null,
  };
}

/**
 * @param {Record<string, unknown>} mission
 * @param {Record<string, unknown>} catalogVerification
 * @returns {{ primaryCommands: string[], diagnosticCommands: string[], diagnosticFailureMode: "warn" | "fail" }}
 */
function resolvePostRunQualityPolicy(mission, catalogVerification) {
  const policy = hasObjectFields(asRecord(mission.post_run_quality))
    ? asRecord(mission.post_run_quality)
    : asRecord(mission.postRunQuality);
  const primaryCommands = asStringArray(policy.primary_commands);
  const diagnosticCommands = asStringArray(policy.diagnostic_commands);
  const diagnosticFailureMode = asNonEmptyString(policy.diagnostic_failure_mode) === "fail" ? "fail" : "warn";
  return {
    primaryCommands: primaryCommands.length > 0 ? primaryCommands : asStringArray(catalogVerification.commands),
    diagnosticCommands,
    diagnosticFailureMode,
  };
}

/**
 * @param {Record<string, unknown>} profile
 * @returns {"readme-smoke" | "bounded-live" | "full-journey-observation" | "acceptance" | "production-proof"}
 */
function resolveRunTier(profile) {
  const declared = asNonEmptyString(profile.run_tier);
  if (
    declared === "readme-smoke" ||
    declared === "bounded-live" ||
    declared === "full-journey-observation" ||
    declared === "acceptance" ||
    declared === "production-proof"
  ) {
    return declared;
  }
  if (asRecord(profile.production_proof).enabled === true) {
    return "production-proof";
  }
  if (asNonEmptyString(profile.journey_mode) === "full-journey" || asNonEmptyString(profile.target_catalog_id)) {
    return "acceptance";
  }
  return "bounded-live";
}

/**
 * @param {string} featureSize
 * @returns {boolean}
 */
function requiresStrictMissionIntake(featureSize) {
  return featureSize === "medium" || featureSize === "large" || featureSize === "xlarge";
}

/**
 * @param {{
 *   mission: Record<string, unknown>,
 *   featureSize: string,
 *   scenarioFamily: string,
 *   postRunQualityPolicy: ReturnType<typeof resolvePostRunQualityPolicy>,
 * }}
 */
function evaluateMissionIntakeQuality(options) {
  const strictRequired = requiresStrictMissionIntake(options.featureSize);
  /** @type {string[]} */
  const missingFields = [];
  const hasKpis = normalizeMissionKpis(options.mission.kpis).length > 0;
  const checks = [
    ["goals", asStringArray(options.mission.goals).length > 0],
    ["kpis", hasKpis],
    ["definition_of_done", asStringArray(options.mission.definition_of_done).length > 0],
    ["expected_evidence", asStringArray(options.mission.expected_evidence).length > 0],
    ["post_run_quality.primary_commands", options.postRunQualityPolicy.primaryCommands.length > 0],
  ];
  for (const [field, present] of checks) {
    if (!present) missingFields.push(String(field));
  }
  const findings = strictRequired
    ? missingFields.map((field) => `Medium+ mission intake is missing '${field}'.`)
    : [];
  const status = strictRequired && missingFields.length > 0 ? "fail" : "pass";
  return {
    phase: "feature_intake",
    scenario_family: options.scenarioFamily,
    feature_size: options.featureSize,
    strict_required: strictRequired,
    status,
    missing_fields: missingFields,
    findings,
    summary:
      status === "pass"
        ? strictRequired
          ? "Medium+ mission intake has goals, KPIs, Definition of Done, expected evidence, and primary verification commands."
          : "Small mission intake strictness is not required."
        : `Medium+ mission intake is incomplete: ${missingFields.join(", ")}.`,
  };
}

/**
 * @param {{ mission: Record<string, unknown>, featureRequest: ReturnType<typeof materializeFeatureRequestFile>, profile: Record<string, unknown>, projectProfileFile: string }}
 * @returns {string[]}
 */
function buildIntakeCreateArgs(options) {
  const missionId = asNonEmptyString(options.mission.mission_id);
  const title = asNonEmptyString(options.featureRequest.requestDocument.title) || missionId || "Feature mission";
  const agentVisibleRequest = asRecord(options.mission.agent_visible_request);
  const brief =
    asNonEmptyString(agentVisibleRequest.user_problem) ||
    asNonEmptyString(options.featureRequest.requestDocument.brief) ||
    asNonEmptyString(options.mission.brief) ||
    "Prepare one bounded catalog mission request.";
  const desiredOutcome = asNonEmptyString(agentVisibleRequest.desired_outcome);
  const goals = uniqueStrings([...(desiredOutcome ? [desiredOutcome] : []), ...asStringArray(options.mission.goals)]);
  const constraints = uniqueStrings([
    ...asStringArray(agentVisibleRequest.constraints),
    ...asStringArray(agentVisibleRequest.non_goals).map((entry) => `Non-goal: ${entry}`),
    ...asStringArray(options.mission.acceptance_checks),
  ]);
  const definitionOfDone =
    asStringArray(options.mission.definition_of_done).length > 0
      ? asStringArray(options.mission.definition_of_done)
      : asStringArray(options.mission.expected_evidence).map((entry) => `Materialize ${entry} evidence.`);
  const kpis = normalizeMissionKpis(options.mission.kpis);
  const effectiveKpis =
    kpis.length > 0
      ? kpis
      : [
          {
            kpi_id: "mission-evidence",
            name: "Mission evidence",
            target: "Required mission evidence is materialized",
            measurement: "live E2E runner summary",
          },
        ];

  return [
    "intake",
    "create",
    "--project-ref",
    ".",
    "--project-profile",
    options.projectProfileFile,
    "--runtime-root",
    ".aor",
    "--request-file",
    options.featureRequest.requestFile,
    "--mission-id",
    missionId,
    "--request-title",
    title,
    "--request-brief",
    brief,
    ...constraints.flatMap((entry) => ["--request-constraints", entry]),
    ...((goals.length > 0 ? goals : [brief]).flatMap((entry) => ["--goal", entry])),
    ...((definitionOfDone.length > 0 ? definitionOfDone : constraints).flatMap((entry) => ["--dod", entry])),
    ...effectiveKpis.flatMap((entry) => [
      "--kpi",
      `${entry.kpi_id}:${entry.name}:${entry.target}${entry.measurement ? `:${entry.measurement}` : ""}`,
    ]),
  ];
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeChangedPath(value) {
  return value.replace(/\\/g, "/").replace(/^\.\//u, "");
}

/**
 * @param {Record<string, unknown>} mission
 * @returns {string[]}
 */
function missionRequiredChangePathPrefixes(mission) {
  const changeEvidence = asRecord(mission.change_evidence);
  return uniqueStrings(asStringArray(changeEvidence.required_path_prefixes).map(normalizeChangedPath));
}

/**
 * @param {string} changedPath
 * @param {string} prefix
 * @returns {boolean}
 */
function changedPathMatchesRequiredPrefix(changedPath, prefix) {
  const normalizedPath = normalizeChangedPath(changedPath);
  const normalizedPrefix = normalizeChangedPath(prefix);
  if (!normalizedPrefix) return false;
  if (normalizedPrefix.endsWith("/")) {
    return normalizedPath.startsWith(normalizedPrefix);
  }
  return normalizedPath === normalizedPrefix || normalizedPath.startsWith(`${normalizedPrefix}/`);
}

/**
 * @param {string | null | undefined} reportFile
 * @returns {string[]}
 */
export function collectRuntimeHarnessChangedPaths(reportFile) {
  const resolvedReportFile = asNonEmptyString(reportFile);
  if (!resolvedReportFile || !fileExists(resolvedReportFile)) {
    return [];
  }
  const report = asRecord(readJson(resolvedReportFile));
  const stepDecisions = Array.isArray(report.step_decisions) ? report.step_decisions : [];
  return uniqueStrings(stepDecisions.flatMap((entry) => {
    const semantics = asRecord(asRecord(entry).mission_semantics);
    return asStringArray(semantics.meaningful_changed_paths).map(normalizeChangedPath);
  }));
}

/**
 * @param {string | null | undefined} reportFile
 * @returns {string[]}
 */
export function collectReviewChangedPaths(reportFile) {
  const resolvedReportFile = asNonEmptyString(reportFile);
  if (!resolvedReportFile || !fileExists(resolvedReportFile)) {
    return [];
  }
  const report = asRecord(readJson(resolvedReportFile));
  const codeQuality = asRecord(report.code_quality);
  const diagnostics = asRecord(codeQuality.changed_path_diagnostics);
  return uniqueStrings([
    ...asStringArray(codeQuality.changed_paths),
    ...asStringArray(diagnostics.meaningful_changed_paths),
  ].map(normalizeChangedPath));
}

/**
 * @param {string[]} changedPaths
 * @param {Record<string, unknown>} [mission]
 * @returns {boolean}
 */
export function changedPathsHaveMissionRelevantChanges(changedPaths, mission = {}) {
  const normalizedChangedPaths = uniqueStrings(changedPaths.map(normalizeChangedPath)).filter(Boolean);
  if (normalizedChangedPaths.length === 0) {
    return false;
  }
  const requiredPrefixes = missionRequiredChangePathPrefixes(mission);
  if (requiredPrefixes.length === 0) {
    return true;
  }
  return normalizedChangedPaths.some((changedPath) =>
    requiredPrefixes.some((prefix) => changedPathMatchesRequiredPrefix(changedPath, prefix)),
  );
}

/**
 * @param {string | null | undefined} targetCheckoutRoot
 * @returns {ReturnType<typeof collectMissionChangeEvidence> | null}
 */
export function collectCanonicalTargetChangeEvidence(targetCheckoutRoot) {
  const root = asNonEmptyString(targetCheckoutRoot);
  if (!root || !fs.existsSync(root)) {
    return null;
  }
  return collectMissionChangeEvidence({
    projectRoot: root,
    evidenceRoot: root,
    artifactsRoot: path.join(root, ".aor/artifacts"),
  });
}

/**
 * @param {string[]} changedPaths
 * @param {{ targetCheckoutRoot?: string | null }} options
 * @returns {string[]}
 */
export function reconcileSummaryMeaningfulChangedPaths(changedPaths, options = {}) {
  const candidates = uniqueStrings(changedPaths.map(normalizeChangedPath)).filter(Boolean);
  const canonicalEvidence = collectCanonicalTargetChangeEvidence(options.targetCheckoutRoot);
  if (!canonicalEvidence?.gitStatusAvailable) {
    return candidates;
  }
  const canonicalMeaningfulPaths = uniqueStrings(
    canonicalEvidence.meaningfulChangedPaths.map(normalizeChangedPath),
  ).filter(Boolean);
  if (canonicalMeaningfulPaths.length === 0) {
    return [];
  }
  const candidateSet = new Set(candidates);
  const intersection = canonicalMeaningfulPaths.filter((candidate) => candidateSet.has(candidate));
  return intersection.length > 0 ? intersection : canonicalMeaningfulPaths;
}

/**
 * @param {string | null | undefined} reportFile
 * @param {Record<string, unknown>} [mission]
 * @returns {boolean}
 */
export function runtimeHarnessReportHasMissionRelevantChanges(reportFile, mission = {}) {
  return changedPathsHaveMissionRelevantChanges(collectRuntimeHarnessChangedPaths(reportFile), mission);
}

/**
 * @param {{ runId: string, reportsRoot: string, liveAdapterPreflightFile: string | null, validationReportFile: string | null, baselineGateDecision: Record<string, unknown>, baselineRoutedStepResultFile: string | null }}
 */
function writeExecutionReadinessDecision(options) {
  const decisionFile = path.join(
    options.reportsRoot,
    `live-e2e-execution-readiness-${normalizeId(options.runId)}.json`,
  );
  const decision = {
    run_id: options.runId,
    phase: "readiness",
    status: "pass",
    summary: "Execution readiness passed; baseline target verification is diagnostic evidence for full-journey live E2E.",
    live_adapter_preflight_file: options.liveAdapterPreflightFile,
    validation_report_file: options.validationReportFile,
    baseline_gate_decision: options.baselineGateDecision,
    baseline_routed_step_result_file: options.baselineRoutedStepResultFile,
    checked_at: nowIso(),
  };
  writeJson(decisionFile, decision);
  return { decisionFile, decision };
}

/**
 * @param {string[]} commands
 * @returns {boolean}
 */
function commandsRequirePlaywrightCache(commands) {
  return commands.some((command) => /\bplaywright\b|ms-playwright|browserType\.launch/iu.test(command));
}

/**
 * @param {{ targetCheckoutRoot: string, reportsRoot: string, runId: string, commands: string[], env: NodeJS.ProcessEnv, forceFailure?: boolean }}
 */
function prepareBrowserCachePreflight(options) {
  const reportFile = path.join(
    options.reportsRoot,
    `live-e2e-browser-cache-preflight-${normalizeId(options.runId)}.json`,
  );
  const required = commandsRequirePlaywrightCache(options.commands);
  const cacheRoot = path.join(options.targetCheckoutRoot, ".aor", "cache", "ms-playwright");
  if (!required) {
    const report = {
      run_id: options.runId,
      status: "skipped",
      required: false,
      cache_root: cacheRoot,
      env_var: "PLAYWRIGHT_BROWSERS_PATH",
      summary: "No Playwright/browser cache preflight was required by declared target commands.",
      checked_at: nowIso(),
    };
    writeJson(reportFile, report);
    return { status: "skipped", report, reportFile };
  }

  try {
    if (options.forceFailure === true) {
      throw new Error("forced browser cache preflight failure");
    }
    fs.mkdirSync(cacheRoot, { recursive: true });
    const markerFile = path.join(cacheRoot, `.aor-cache-write-${normalizeId(options.runId)}.txt`);
    fs.writeFileSync(markerFile, `browser-cache-preflight:${options.runId}\n`, "utf8");
    fs.rmSync(markerFile, { force: true });
    options.env.PLAYWRIGHT_BROWSERS_PATH = cacheRoot;
    const report = {
      run_id: options.runId,
      status: "pass",
      required: true,
      cache_root: cacheRoot,
      env_var: "PLAYWRIGHT_BROWSERS_PATH",
      summary: "Playwright/browser cache path is target-local and writable before provider execution.",
      checked_at: nowIso(),
    };
    writeJson(reportFile, report);
    return { status: "pass", report, reportFile };
  } catch (error) {
    const summary = `Playwright/browser cache path is not writable: ${error instanceof Error ? error.message : String(error)}`;
    const report = {
      run_id: options.runId,
      status: "fail",
      required: true,
      cache_root: cacheRoot,
      env_var: "PLAYWRIGHT_BROWSERS_PATH",
      summary,
      checked_at: nowIso(),
    };
    writeJson(reportFile, report);
    return { status: "fail", report, reportFile };
  }
}

/**
 * @param {{
 *   scenarioPolicy: Record<string, unknown>,
 *   stageResults: Array<{ stage: string, status: string, evidence_refs: string[], summary: string | null }>,
 *   artifacts: Record<string, unknown>,
 *   auditPayload: Record<string, unknown>,
 * }} options
 */
function evaluateScenarioCoverage(options) {
  const requiredStages = asStringArray(options.scenarioPolicy.required_stages);
  const requiredEvidence = asStringArray(options.scenarioPolicy.required_evidence);
  const stageStatuses = new Map(
    options.stageResults.map((stageResult) => [stageResult.stage, asNonEmptyString(stageResult.status) || "unknown"]),
  );
  /** @type {string[]} */
  const findings = [];

  for (const stage of requiredStages) {
    const stageStatus = stageStatuses.get(stage) || "missing";
    if (stageStatus !== "pass") {
      findings.push(`Required scenario stage '${stage}' completed with status '${stageStatus}'.`);
    }
  }

  const hasAuditRuns =
    Boolean(options.artifacts.run_audit_file) ||
    Array.isArray(asRecord(options.auditPayload).run_audit_records) ||
    Array.isArray(asRecord(options.auditPayload).run_summaries);
  const evidencePresence = {
    "verify-summary": Boolean(options.artifacts.verify_summary_file),
    "routed-step-result": Boolean(options.artifacts.routed_step_result_file),
    "runtime-harness-report": Boolean(options.artifacts.runtime_harness_report_file),
    "review-report": Boolean(options.artifacts.review_report_file),
    "evaluation-report": Boolean(options.artifacts.evaluation_report_file),
    "delivery-manifest": Boolean(options.artifacts.delivery_manifest_file),
    "release-packet": Boolean(options.artifacts.release_packet_file),
    "audit-runs": hasAuditRuns,
    "learning-loop-scorecard": Boolean(options.artifacts.learning_loop_scorecard_file),
    "learning-loop-handoff": Boolean(options.artifacts.learning_loop_handoff_file),
  };

  for (const evidenceId of requiredEvidence) {
    if (evidencePresence[evidenceId] !== true) {
      findings.push(`Required scenario evidence '${evidenceId}' was not materialized.`);
    }
  }

  return {
    status: findings.length > 0 ? "fail" : "pass",
    required_stages: requiredStages,
    required_evidence: requiredEvidence,
    findings,
    summary:
      findings[0] ??
      `Scenario policy '${asNonEmptyString(options.scenarioPolicy.scenario_family) || "unknown"}' coverage passed.`,
  };
}

/**
 * @param {unknown} value
 * @returns {unknown}
 */
function sortJsonValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => sortJsonValue(entry));
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(/** @type {Record<string, unknown>} */ (value))
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortJsonValue(entry)]),
    );
  }
  return value;
}

/**
 * @param {unknown} left
 * @param {unknown} right
 * @returns {boolean}
 */
function jsonEquivalent(left, right) {
  return JSON.stringify(sortJsonValue(left)) === JSON.stringify(sortJsonValue(right));
}

/**
 * @param {string} cwd
 * @returns {string | null}
 */
function gitHeadOrNull(cwd) {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() || null : null;
}

/**
 * @param {Record<string, unknown>} value
 * @returns {boolean}
 */
function hasObjectFields(value) {
  return Object.keys(value).length > 0;
}

/**
 * @param {string} value
 * @returns {string | null}
 */
function localJsonPath(value) {
  if (!value || value.startsWith("evidence://") || value.startsWith("packet://") || value.startsWith("compiled-context://")) {
    return null;
  }
  return value;
}

/**
 * @param {Record<string, unknown>} stepResult
 * @returns {boolean}
 */
function isExitZeroWarningOutputFailure(stepResult) {
  const summary = asNonEmptyString(stepResult.summary);
  return (
    asNonEmptyString(stepResult.status) === "failed" &&
    stepResult.exit_code === 0 &&
    /emitted warning output on stderr/iu.test(summary)
  );
}

/**
 * @param {Record<string, unknown>} summary
 * @returns {boolean}
 */
function verifySummaryFailedOnlyForWarningOutput(summary) {
  const outputQualityFailures = Array.isArray(summary.output_quality_failed_commands)
    ? summary.output_quality_failed_commands
    : [];
  const timedOutCommands = Array.isArray(summary.timed_out_commands) ? summary.timed_out_commands : [];
  const stepResultRefs = asStringArray(summary.step_result_refs);
  if (
    asNonEmptyString(summary.status) !== "failed" ||
    outputQualityFailures.length === 0 ||
    timedOutCommands.length > 0 ||
    stepResultRefs.length === 0
  ) {
    return false;
  }
  const stepResults = stepResultRefs
    .map((ref) => localJsonPath(ref))
    .filter((ref) => ref && fileExists(/** @type {string} */ (ref)))
    .map((ref) => readJson(/** @type {string} */ (ref)));
  if (stepResults.length !== stepResultRefs.length) return false;
  const failedStepResults = stepResults.filter((stepResult) => asNonEmptyString(stepResult.status) === "failed");
  return (
    failedStepResults.length === outputQualityFailures.length &&
    failedStepResults.length > 0 &&
    failedStepResults.every((stepResult) => isExitZeroWarningOutputFailure(stepResult))
  );
}

/**
 * @param {Record<string, unknown>} artifacts
 * @param {string} observedStatus
 * @returns {string}
 */
function resolveEffectiveTargetBaselineStatus(artifacts, observedStatus) {
  if (observedStatus !== "warn") return observedStatus;
  const baselineSummaryFile = localJsonPath(asNonEmptyString(artifacts.baseline_verify_summary_file));
  const postRunSummaryFile = localJsonPath(asNonEmptyString(artifacts.post_run_verify_summary_file));
  if (!baselineSummaryFile || !postRunSummaryFile || !fileExists(baselineSummaryFile) || !fileExists(postRunSummaryFile)) {
    return observedStatus;
  }
  const baselineSummary = readJson(baselineSummaryFile);
  const postRunSummary = readJson(postRunSummaryFile);
  const postRunOutputQualityFailures = Array.isArray(postRunSummary.output_quality_failed_commands)
    ? postRunSummary.output_quality_failed_commands
    : [];
  return verifySummaryFailedOnlyForWarningOutput(baselineSummary) &&
    asNonEmptyString(postRunSummary.status) === "passed" &&
    postRunOutputQualityFailures.length === 0
    ? "pass"
    : observedStatus;
}

/**
 * @param {{
 *   label: string,
 *   field: string,
 *   expected: Record<string, unknown>,
 *   actual: Record<string, unknown>,
 *   findings: string[],
 * }} options
 */
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
 * @param {{
 *   artifacts: Record<string, unknown>,
 *   reviewReport: Record<string, unknown>,
 *   auditPayload: Record<string, unknown>,
 *   runId: string,
 * }} options
 */
function evaluateArtifactConsistency(options) {
  /** @type {string[]} */
  const findings = [];
  const expectedMatrixCell = asRecord(options.artifacts.matrix_cell);
  const expectedCoverageFollowUp = asRecord(options.artifacts.coverage_follow_up);
  const reviewFeatureTraceability = asRecord(options.reviewReport.feature_traceability);
  const auditRecords = Array.isArray(options.auditPayload.run_audit_records)
    ? options.auditPayload.run_audit_records.map((record) => asRecord(record))
    : [];
  const auditRecord =
    auditRecords.find((record) => asNonEmptyString(record.run_id) === options.runId) || auditRecords[0] || {};
  const learningHandoffFile = asNonEmptyString(options.artifacts.learning_loop_handoff_file);
  const learningScorecardFile = asNonEmptyString(options.artifacts.learning_loop_scorecard_file);
  const learningHandoff = learningHandoffFile && fileExists(learningHandoffFile) ? readJson(learningHandoffFile) : {};
  const learningScorecard =
    learningScorecardFile && fileExists(learningScorecardFile) ? readJson(learningScorecardFile) : {};

  if (!hasObjectFields(expectedMatrixCell)) {
    findings.push("Artifact consistency mismatch: summary.matrix_cell is missing.");
  }
  if (!hasObjectFields(expectedCoverageFollowUp)) {
    findings.push("Artifact consistency mismatch: summary.coverage_follow_up is missing.");
  }

  if (hasObjectFields(expectedMatrixCell)) {
    compareArtifactObject({
      label: "review-report.feature_traceability",
      field: "matrix_cell",
      expected: expectedMatrixCell,
      actual: asRecord(reviewFeatureTraceability.matrix_cell),
      findings,
    });
    compareArtifactObject({
      label: "audit-runs.run_audit_records[0]",
      field: "matrix_cell",
      expected: expectedMatrixCell,
      actual: asRecord(auditRecord.matrix_cell),
      findings,
    });
    compareArtifactObject({
      label: "learning-loop-handoff",
      field: "matrix_cell",
      expected: expectedMatrixCell,
      actual: asRecord(learningHandoff.matrix_cell),
      findings,
    });
    compareArtifactObject({
      label: "learning-loop-scorecard",
      field: "matrix_cell",
      expected: expectedMatrixCell,
      actual: asRecord(learningScorecard.matrix_cell),
      findings,
    });
  }

  if (hasObjectFields(expectedCoverageFollowUp)) {
    compareArtifactObject({
      label: "review-report.feature_traceability",
      field: "coverage_follow_up",
      expected: expectedCoverageFollowUp,
      actual: asRecord(reviewFeatureTraceability.coverage_follow_up),
      findings,
    });
    compareArtifactObject({
      label: "audit-runs.run_audit_records[0]",
      field: "coverage_follow_up",
      expected: expectedCoverageFollowUp,
      actual: asRecord(auditRecord.coverage_follow_up),
      findings,
    });
    compareArtifactObject({
      label: "learning-loop-handoff",
      field: "coverage_follow_up",
      expected: expectedCoverageFollowUp,
      actual: asRecord(learningHandoff.coverage_follow_up),
      findings,
    });
    compareArtifactObject({
      label: "learning-loop-scorecard",
      field: "coverage_follow_up",
      expected: expectedCoverageFollowUp,
      actual: asRecord(learningScorecard.coverage_follow_up),
      findings,
    });
  }

  return {
    status: findings.length > 0 ? "fail" : "pass",
    findings,
    summary: findings[0] ?? "Full-journey artifact lineage is internally consistent.",
  };
}

/**
 * @param {{
 *   hostRoot: string,
 *   layout: ReturnType<typeof ensureRuntimeLayout>,
 *   runId: string,
 *   profilePath: string,
 *   profile: Record<string, unknown>,
 *   aorLaunch: ReturnType<typeof resolveAorLaunch>,
 *   examplesRoot: string,
 *   runnerAuthMode: "host" | "isolated",
 *   runtimeAgentPermissionMode: "full-bypass" | "restricted",
 *   runtimeAgentInteractionPolicy: "fail-closed" | "ask-all" | "orchestrator-mediated",
 *   runtimeAgentAutoApprovalProfile: "none" | "conservative" | "auto-edit" | "trusted-run",
 *   stepController?: ReturnType<import("./step-controller.mjs").createLiveE2eStepController>,
 * }}
 */
export function executeInstalledUserFlow(options) {
  const stageMap = createStageMap(getProfileStages(options.profile));
  const commandResults = [];
  const transcriptsRoot = path.join(options.layout.reportsRoot, `live-e2e-command-traces-${normalizeId(options.runId)}`);
  fs.mkdirSync(transcriptsRoot, { recursive: true });
  const sessionRoots = createSessionRoots({
    sessionsRoot: options.layout.sessionsRoot,
    runId: options.runId,
  });
  const proofRunnerEnvironment = createProofRunnerEnvironment({
    sessionRoots,
    runnerAuthMode: options.runnerAuthMode,
  });
  const env = proofRunnerEnvironment.env;
  env.AOR_RUNTIME_AGENT_PERMISSION_MODE = options.runtimeAgentPermissionMode;
  env.AOR_RUNTIME_AGENT_INTERACTION_POLICY = options.runtimeAgentInteractionPolicy;
  env.AOR_RUNTIME_AGENT_AUTO_APPROVAL_PROFILE = options.runtimeAgentAutoApprovalProfile;

  const artifacts = {
    host_runtime_root: options.layout.runtimeRoot,
    host_reports_root: options.layout.reportsRoot,
    session_root: sessionRoots.sessionRoot,
    aor_home: sessionRoots.aorHome,
    codex_home: sessionRoots.codexHome,
    tmp_root: sessionRoots.tmpRoot,
    codex_home_isolated: options.runnerAuthMode === "isolated",
    runner_auth_mode: proofRunnerEnvironment.runnerAuthMode,
    runner_auth_source: proofRunnerEnvironment.runnerAuthSource,
    runtime_agent_permission_mode: options.runtimeAgentPermissionMode,
    runtime_agent_interaction_policy: options.runtimeAgentInteractionPolicy,
    runtime_agent_auto_approval_profile: options.runtimeAgentAutoApprovalProfile,
    run_tier: resolveRunTier(options.profile),
  };
  hydrateControllerArtifacts(artifacts, options.stepController);
  const markStage = (currentStageMap, stage, status, evidenceRefs = [], summary = null, observeOptions = {}) => {
    markStageRaw(currentStageMap, stage, status, evidenceRefs, summary);
    if (currentStageMap === stageMap) {
      options.stepController?.observeStage({
        stage,
        stageResult: currentStageMap[stage],
        commandResults,
        artifacts,
        ...observeOptions,
      });
    }
  };
  const startedAt = nowIso();
  try {
    const targetCheckout = materializeTargetCheckout({
      hostRoot: options.hostRoot,
      layout: options.layout,
      runId: options.runId,
      profile: options.profile,
      reuseExistingCheckout: options.stepController?.hasPersistedProgress?.() === true,
    });
    artifacts.target_checkout_root = targetCheckout.targetCheckoutRoot;
    artifacts.target_repo_ref = targetCheckout.targetRepoRef;
    artifacts.target_repo_url = targetCheckout.targetRepoUrl;
    const installedBrowserCachePreflight = prepareBrowserCachePreflight({
      targetCheckoutRoot: targetCheckout.targetCheckoutRoot,
      reportsRoot: options.layout.reportsRoot,
      runId: options.runId,
      commands: uniqueStrings([
        ...asStringArray(asRecord(options.profile.verification).setup_commands),
        ...asStringArray(asRecord(options.profile.verification).commands),
      ]),
      env,
    });
    artifacts.browser_cache_preflight_file = installedBrowserCachePreflight.reportFile;
    artifacts.browser_cache_preflight = installedBrowserCachePreflight.report;
    if (installedBrowserCachePreflight.status === "fail") {
      markStage(
        stageMap,
        "bootstrap",
        "fail",
        [installedBrowserCachePreflight.reportFile],
        asNonEmptyString(installedBrowserCachePreflight.report.summary) || "Browser cache preflight failed.",
      );
      throw new Error(asNonEmptyString(installedBrowserCachePreflight.report.summary) || "Browser cache preflight failed.");
    }

    const hostAssets = materializeHostLiveE2eAssets({
      examplesRoot: options.examplesRoot,
      generatedAssetsRoot: path.join(options.layout.stateRoot, "live-e2e-assets", normalizeId(options.runId)),
    });
    artifacts.host_live_e2e_assets_root = hostAssets.assetsRoot;

    const generatedProfile = materializeGeneratedProjectProfile({
      hostRoot: options.hostRoot,
      profilePath: options.profilePath,
      profile: options.profile,
      catalogEntry: options.catalogEntry,
      mission: options.mission,
      providerVariant: options.providerVariant,
      runId: options.runId,
      targetCheckout,
      generatedAssetsRoot: hostAssets.assetsRoot,
    });
    artifacts.generated_project_profile_file = generatedProfile.generatedProjectProfileFile;
    artifacts.project_profile_template_file = generatedProfile.templateProjectProfilePath;
    markStage(
      stageMap,
      "bootstrap",
      "pass",
      [generatedProfile.generatedProjectProfileFile],
      "Target checkout cloned and host-side live E2E project profile prepared.",
    );

    const commandBaseArgs = [
      "--project-ref",
      ".",
      "--project-profile",
      generatedProfile.generatedProjectProfileFile,
      "--runtime-root",
      ".aor",
    ];
    let commandIndex = 1;
    const runCommand = (label, args, runOptions = {}) => {
      const iteration = Number(runOptions.iteration) || 1;
      if (options.stepController?.shouldUseCachedCommand?.(label, iteration) === true) {
        const cachedDiagnostic = asRecord(options.stepController.getCachedCommandResult(label, iteration));
        const cachedResult = buildCachedCommandResult(cachedDiagnostic);
        if (cachedResult) {
          commandIndex += 1;
          if (
            !commandResults.some(
              (entry) =>
                asNonEmptyString(entry.label) === label &&
                (Number(entry.iteration) || 1) === iteration &&
                asNonEmptyString(entry.step_instance_id) === asNonEmptyString(cachedDiagnostic.step_instance_id),
            )
          ) {
            commandResults.push(cachedDiagnostic);
          }
          return cachedResult;
        }
      }
      if (runOptions.suppressControllerPlan !== true) {
        options.stepController?.planCommand?.({
          label,
          commandSurface: resolveCommandSurface(args),
          iteration,
        });
      }
      const result = runAorCommand({
        launch: options.aorLaunch,
        cwd: targetCheckout.targetCheckoutRoot,
        args,
        env,
        transcriptsRoot,
        label,
        index: commandIndex,
      });
      commandIndex += 1;
      const diagnostic = buildCommandDiagnostic(result, runOptions);
      annotateCommandDiagnosticStep(diagnostic, label, iteration);
      if (!result.ok && runOptions.allowNonZeroWithPayload === true && result.payload) {
        diagnostic.accepted_nonzero_payload = true;
        diagnostic.failure_class = "nonzero-with-readable-payload";
        diagnostic.recommendation = "inspect payload quality fields";
      }
      commandResults.push(diagnostic);
      if (!result.ok && !(runOptions.allowNonZeroWithPayload === true && result.payload)) {
        const stderr = result.stderr.trim() || result.stdout.trim() || "command failed";
        throw new Error(`Public CLI command '${label}' failed: ${stderr}`);
      }
      return result;
    };

    const analyze = runCommand("project-analyze", ["project", "analyze", ...commandBaseArgs]);
    Object.assign(artifacts, {
      analysis_report_file: getStringField(analyze.payload, "analysis_report_file"),
      route_resolution_file: getStringField(analyze.payload, "route_resolution_file"),
      asset_resolution_file: getStringField(analyze.payload, "asset_resolution_file"),
      policy_resolution_file: getStringField(analyze.payload, "policy_resolution_file"),
      evaluation_registry_file: getStringField(analyze.payload, "evaluation_registry_file"),
    });
    markStage(
      stageMap,
      "discovery",
      "pass",
      uniqueStrings([analyze.transcriptFile, ...collectStringRefs(analyze.payload)]),
      "Project analysis completed through the public CLI.",
    );

    const validate = runCommand("project-validate", ["project", "validate", ...commandBaseArgs]);
    artifacts.validation_report_file = getStringField(validate.payload, "validation_report_file");
    const validationStatus = getStringField(validate.payload, "validation_status") || "unknown";
    if (validationStatus === "fail") {
      markStage(
        stageMap,
        "spec",
        "fail",
        uniqueStrings([validate.transcriptFile, ...collectStringRefs(validate.payload)]),
        "Project validation failed.",
      );
      throw new Error("Project validation failed.");
    }
    markStage(
      stageMap,
      "spec",
      "pass",
      uniqueStrings([validate.transcriptFile, ...collectStringRefs(validate.payload)]),
      "Project validation completed.",
    );

    const handoffPrepare = runCommand("handoff-prepare", [
      "handoff",
      "prepare",
      ...commandBaseArgs,
      "--ticket-id",
      `${options.runId}.ticket`,
    ]);
    artifacts.handoff_packet_file = getStringField(handoffPrepare.payload, "handoff_packet_file");
    artifacts.wave_ticket_file = getStringField(handoffPrepare.payload, "wave_ticket_file");
    markStage(
      stageMap,
      "planning",
      "pass",
      uniqueStrings([handoffPrepare.transcriptFile, ...collectStringRefs(handoffPrepare.payload)]),
      "Handoff packet prepared through the public CLI.",
    );

    const handoffApprove = runCommand("handoff-approve", [
      "handoff",
      "approve",
      "--project-ref",
      ".",
      "--handoff-packet",
      /** @type {string} */ (artifacts.handoff_packet_file),
      "--approval-ref",
      `approval://installed-user-live-e2e/${normalizeId(options.runId)}`,
    ]);
    artifacts.approved_handoff_packet_file = getStringField(handoffApprove.payload, "handoff_packet_file");
    markStage(
      stageMap,
      "handoff",
      "pass",
      uniqueStrings([handoffApprove.transcriptFile, ...collectStringRefs(handoffApprove.payload)]),
      "Handoff packet approved.",
    );

    const executionAlreadyObserved = controllerObservedStep(options.stepController, "execution");
    const cachedPreflightSummaryPath = asNonEmptyString(artifacts.verify_summary_file);
    const hasReusablePreExecutionReadiness =
      cachedPreflightSummaryPath &&
      fileExists(cachedPreflightSummaryPath) &&
      asNonEmptyString(artifacts.target_cleanliness_before_execution_file) &&
      fileExists(asNonEmptyString(artifacts.target_cleanliness_before_execution_file));
    if (executionAlreadyObserved && !hasReusablePreExecutionReadiness) {
      const summary = "Observed execution cannot resume without preserved pre-execution readiness evidence.";
      markStageRaw(stageMap, "execution", "fail", [], summary);
      throw new Error(summary);
    }
    let verifySummaryPath = /** @type {string | null} */ (cachedPreflightSummaryPath || null);
    /** @type {string[]} */
    let preflightEvidenceRefs = uniqueStrings([
      verifySummaryPath,
      ...asStringArray(artifacts.preflight_step_result_files),
      asNonEmptyString(artifacts.target_cleanliness_before_execution_file),
    ]);
    if (!hasReusablePreExecutionReadiness) {
      const verifyPreflight = runCommand("project-verify-preflight", [
        "project",
        "verify",
        ...commandBaseArgs,
        "--require-validation-pass",
        "true",
      ]);
      artifacts.verify_summary_file = getStringField(verifyPreflight.payload, "verify_summary_file");
      artifacts.preflight_step_result_files = getStringArrayField(verifyPreflight.payload, "step_result_files");
      verifySummaryPath = /** @type {string} */ (artifacts.verify_summary_file);
      if (!verifySummaryPath || !fileExists(verifySummaryPath)) {
        throw new Error("Preflight verify summary was not materialized.");
      }
      const verifySummary = readJson(verifySummaryPath);
      if (verifySummary.status === "failed") {
        markStage(
          stageMap,
          "execution",
          "fail",
          uniqueStrings([verifyPreflight.transcriptFile, verifySummaryPath, ...collectStringRefs(verifyPreflight.payload)]),
          "Preflight verify failed before live execution.",
        );
        throw new Error("Preflight verify failed before live execution.");
      }
      const targetCleanliness = writeTargetCleanlinessReport({
        targetCheckoutRoot: targetCheckout.targetCheckoutRoot,
        reportsRoot: options.layout.reportsRoot,
        runId: options.runId,
        phase: "before-execution",
      });
      artifacts.target_cleanliness_before_execution_file = targetCleanliness.reportFile;
      artifacts.target_cleanliness_before_execution = targetCleanliness.report;
      if (targetCleanliness.report.status !== "pass") {
        markStage(
          stageMap,
          "execution",
          "fail",
          [targetCleanliness.reportFile],
          asNonEmptyString(targetCleanliness.report.summary) || "Target setup changed tracked files before execution.",
        );
        throw new Error(asNonEmptyString(targetCleanliness.report.summary) || "Target setup changed tracked files before execution.");
      }
      preflightEvidenceRefs = uniqueStrings([
        verifyPreflight.transcriptFile,
        verifySummaryPath,
        ...collectStringRefs(verifyPreflight.payload),
        targetCleanliness.reportFile,
      ]);
    } else {
      artifacts.pre_execution_readiness_reused_after_resume = true;
    }

    const promotionRefsForLiveExecution = shouldIncludePromotionEvidence(options.profile)
      ? uniqueStrings([verifySummaryPath, ...asStringArray(artifacts.preflight_step_result_files)])
      : [];
    const routedLiveArgs = [
      "project",
      "verify",
      ...commandBaseArgs,
      "--require-validation-pass",
      "true",
      "--routed-live-step",
      "implement",
    ];
    if (shouldIncludeApprovedHandoff(options.profile) && artifacts.approved_handoff_packet_file) {
      routedLiveArgs.push("--approved-handoff-ref", /** @type {string} */ (artifacts.approved_handoff_packet_file));
    }
    if (promotionRefsForLiveExecution.length > 0) {
      routedLiveArgs.push("--promotion-evidence-refs", promotionRefsForLiveExecution.join(","));
    }
    const routedLive = runCommand("project-verify-routed-live", routedLiveArgs);
    artifacts.routed_verify_summary_file = getStringField(routedLive.payload, "verify_summary_file");
    artifacts.routed_step_result_file = getStringField(routedLive.payload, "routed_step_result_file");
    artifacts.routed_step_result_id = getStringField(routedLive.payload, "routed_step_result_id");
    const routedStepResultPath = /** @type {string} */ (artifacts.routed_step_result_file);
    if (!routedStepResultPath || !fileExists(routedStepResultPath)) {
      throw new Error("Routed live step-result was not materialized.");
    }
    const routedStepResult = readJson(routedStepResultPath);
    const routedExecution = asRecord(routedStepResult.routed_execution);
    const adapterResponse = asRecord(routedExecution.adapter_response);
    const adapterOutput = asRecord(adapterResponse.output);
    artifacts.compiled_context_ref = asNonEmptyString(asRecord(routedExecution.context_compilation).compiled_context_ref) || null;
    artifacts.compiled_context_file = asNonEmptyString(asRecord(routedExecution.context_compilation).compiled_context_file) || null;
    const externalRunner = asRecord(adapterOutput.external_runner);
    artifacts.adapter_raw_evidence_ref = asNonEmptyString(externalRunner.raw_evidence_ref) || null;
    artifacts.request_artifact_ref = asNonEmptyString(externalRunner.request_artifact_ref) || null;
    artifacts.provider_work_packet_ref = asNonEmptyString(externalRunner.provider_work_packet_ref) || null;
    artifacts.context_budget_status = asNonEmptyString(externalRunner.context_budget_status) || null;
    artifacts.context_budget_failure_class = asNonEmptyString(externalRunner.context_budget_failure_class) || null;
    artifacts.raw_provider_error_summary = asNonEmptyString(externalRunner.raw_provider_error_summary) || null;
    artifacts.top_context_size_sources = Array.isArray(externalRunner.top_context_size_sources)
      ? externalRunner.top_context_size_sources
      : [];
    applyProviderExecutionFailure(artifacts, routedStepResult, adapterOutput);
    const routedStatus = asNonEmptyString(routedStepResult.status);
    if (routedStatus !== "passed") {
      const failureSummary =
        asNonEmptyString(routedStepResult.summary) ||
        asNonEmptyString(adapterResponse.summary) ||
        "Routed live execution failed.";
      markStage(
        stageMap,
        "execution",
        "fail",
        uniqueStrings([routedLive.transcriptFile, routedStepResultPath, ...collectStringRefs(routedStepResult)]),
        failureSummary,
      );
      throw new Error(failureSummary);
    }
    markStage(
      stageMap,
      "execution",
      artifacts.execution_degraded === true ? "fail" : "pass",
      uniqueStrings([
        ...preflightEvidenceRefs,
        routedLive.transcriptFile,
        routedStepResultPath,
        ...collectStringRefs(routedStepResult),
      ]),
      "Preflight verify and routed live execution passed.",
    );

    /** @type {string[]} */
    const promotionEvidenceRefs = [routedStepResultPath];

    const evalSuites = getEvalSuites(options.profile);
    if (evalSuites.length > 0) {
      const evalRun = runCommand("eval-run", [
        "eval",
        "run",
        ...commandBaseArgs,
        "--suite-ref",
        evalSuites[0],
        "--subject-ref",
        `run://${options.runId}`,
      ]);
      artifacts.evaluation_report_file = getStringField(evalRun.payload, "evaluation_report_file");
      const evaluationStatus = getStringField(evalRun.payload, "evaluation_status") || "unknown";
      if (artifacts.evaluation_report_file) {
        promotionEvidenceRefs.push(/** @type {string} */ (artifacts.evaluation_report_file));
      }
      if (evaluationStatus !== "pass") {
        markStage(
          stageMap,
          "qa",
          "fail",
          uniqueStrings([evalRun.transcriptFile, ...collectStringRefs(evalRun.payload)]),
          "Evaluation report failed.",
        );
        throw new Error("Evaluation report failed.");
      }
      markStage(
        stageMap,
        "qa",
        "pass",
        uniqueStrings([evalRun.transcriptFile, ...collectStringRefs(evalRun.payload)]),
        "Eval run passed.",
      );
      if (getHarnessCertification(options.profile) === null) {
        markStage(
          stageMap,
          "review",
          "pass",
          uniqueStrings([evalRun.transcriptFile, ...collectStringRefs(evalRun.payload)]),
          "Review reused evaluation evidence.",
        );
      }
    } else {
      markStage(stageMap, "qa", "skipped", [], "Profile has no eval suites.");
    }

    const harnessCertification = getHarnessCertification(options.profile);
    if (harnessCertification) {
      const certify = runCommand("harness-certify", [
        "harness",
        "certify",
        ...commandBaseArgs,
        "--asset-ref",
        harnessCertification.assetRef,
        "--subject-ref",
        harnessCertification.subjectRef,
        "--suite-ref",
        harnessCertification.suiteRef,
        "--step-class",
        harnessCertification.stepClass,
      ]);
      artifacts.promotion_decision_file = getStringField(certify.payload, "promotion_decision_file");
      artifacts.certification_evaluation_report_file = getStringField(certify.payload, "certification_evaluation_report_file");
      artifacts.certification_harness_capture_file = getStringField(certify.payload, "certification_harness_capture_file");
      artifacts.certification_harness_replay_file = getStringField(certify.payload, "certification_harness_replay_file");
      const promotionStatus = getStringField(certify.payload, "promotion_decision_status") || "unknown";
      if (artifacts.promotion_decision_file) {
        promotionEvidenceRefs.push(/** @type {string} */ (artifacts.promotion_decision_file));
      }
      if (promotionStatus !== "pass") {
        markStage(
          stageMap,
          "review",
          "fail",
          uniqueStrings([certify.transcriptFile, ...collectStringRefs(certify.payload)]),
          "Harness certification did not pass.",
        );
        throw new Error("Harness certification did not pass.");
      }
      markStage(
        stageMap,
        "review",
        "pass",
        uniqueStrings([certify.transcriptFile, ...collectStringRefs(certify.payload)]),
        "Harness certification passed.",
      );
    } else if (stageMap.review?.status === "pending") {
      markStage(stageMap, "review", "skipped", [], "Profile has no harness certification step.");
    }

    const deliverArgs = [
      "deliver",
      "prepare",
      ...commandBaseArgs,
      "--run-id",
      options.runId,
      "--step-class",
      "implement",
      "--mode",
      getPreferredDeliveryMode(options.profile),
      "--quality-gate-mode",
      "observe",
    ];
    if (artifacts.approved_handoff_packet_file) {
      deliverArgs.push("--approved-handoff-ref", /** @type {string} */ (artifacts.approved_handoff_packet_file));
    }
    if (promotionEvidenceRefs.length > 0) {
      deliverArgs.push("--promotion-evidence-refs", uniqueStrings(promotionEvidenceRefs).join(","));
    }
    const deliver = runCommand("deliver-prepare", deliverArgs, { allowNonZeroWithPayload: true });
    const deliveryRuntimeHarnessReportFile = getStringField(deliver.payload, "runtime_harness_report_file");
    Object.assign(artifacts, {
      delivery_plan_file: getStringField(deliver.payload, "delivery_plan_file"),
      delivery_manifest_file: getStringField(deliver.payload, "delivery_manifest_file"),
      delivery_transcript_file: getStringField(deliver.payload, "delivery_transcript_file"),
      delivery_mode: getStringField(deliver.payload, "delivery_mode"),
      delivery_quality_gate_mode: getStringField(deliver.payload, "delivery_quality_gate_mode"),
      delivery_quality_gate_status: getStringField(deliver.payload, "delivery_quality_gate_status"),
      delivery_quality_gate_findings: asStringArray(deliver.payload?.delivery_quality_gate_findings),
      delivery_runtime_harness_report_file: deliveryRuntimeHarnessReportFile,
      runtime_harness_report_file:
        asNonEmptyString(artifacts.runtime_harness_report_file) || deliveryRuntimeHarnessReportFile,
      delivery_blocking: deliver.payload?.delivery_blocking === true,
      delivery_blocking_reasons: asStringArray(deliver.payload?.delivery_blocking_reasons),
    });
    if (!artifacts.delivery_manifest_file) {
      markStage(
        stageMap,
        "delivery",
        "fail",
        uniqueStrings([deliver.transcriptFile, ...collectStringRefs(deliver.payload)]),
        "Delivery prepare did not materialize delivery evidence.",
      );
      throw new Error("Delivery prepare did not materialize delivery evidence.");
    }
    markStage(
      stageMap,
      "delivery",
      artifacts.delivery_blocking === true || artifacts.delivery_quality_gate_status === "not_pass" ? "warn" : "pass",
      uniqueStrings([deliver.transcriptFile, ...collectStringRefs(deliver.payload)]),
      artifacts.delivery_blocking === true || artifacts.delivery_quality_gate_status === "not_pass"
        ? "Delivery evidence materialized with observed quality findings."
        : "Delivery prepare materialized delivery evidence.",
    );
    if (asNonEmptyString(asRecord(options.profile.live_e2e).flow_range_policy) === "full_lifecycle") {
      const releasePrepare = runCommand("release-prepare", [
        "release",
        "prepare",
        ...commandBaseArgs,
        "--run-id",
        options.runId,
        "--step-class",
        "implement",
        "--mode",
        getPreferredDeliveryMode(options.profile),
        ...(artifacts.approved_handoff_packet_file
          ? ["--approved-handoff-ref", /** @type {string} */ (artifacts.approved_handoff_packet_file)]
          : []),
        ...(promotionEvidenceRefs.length > 0 ? ["--promotion-evidence-refs", uniqueStrings(promotionEvidenceRefs).join(",")] : []),
      ], { allowNonZeroWithPayload: true });
      artifacts.release_delivery_manifest_file = getStringField(releasePrepare.payload, "delivery_manifest_file");
      artifacts.release_delivery_transcript_file = getStringField(releasePrepare.payload, "delivery_transcript_file");
      artifacts.release_packet_file = getStringField(releasePrepare.payload, "release_packet_file");
      artifacts.release_packet_status = getStringField(releasePrepare.payload, "release_packet_status");
      artifacts.release_prepare_transcript_file = releasePrepare.transcriptFile;
      artifacts.release_status = artifacts.release_packet_file ? "pass" : "fail";
      markStage(
        stageMap,
        "release",
        artifacts.release_status,
        uniqueStrings([releasePrepare.transcriptFile, ...collectStringRefs(releasePrepare.payload)]),
        artifacts.release_packet_file
          ? "Release prepare materialized release packet evidence for the bounded full-lifecycle profile."
          : "Release prepare did not materialize release packet evidence.",
      );
      if (!artifacts.release_packet_file) {
        throw new Error("Release prepare did not materialize release packet evidence.");
      }

      const auditRuns = runCommand("audit-runs", [
        "audit",
        "runs",
        "--project-ref",
        ".",
        "--project-profile",
        generatedProfile.generatedProjectProfileFile,
        "--runtime-root",
        ".aor",
        "--run-id",
        options.runId,
      ]);
      artifacts.run_audit_file = auditRuns.transcriptFile;

      const learningHandoff = runCommand("learning-handoff", [
        "learning",
        "handoff",
        "--project-ref",
        ".",
        "--project-profile",
        generatedProfile.generatedProjectProfileFile,
        "--runtime-root",
        ".aor",
        "--run-id",
        options.runId,
      ]);
      artifacts.learning_loop_scorecard_file = getStringField(learningHandoff.payload, "learning_loop_scorecard_file");
      artifacts.learning_loop_handoff_file = getStringField(learningHandoff.payload, "learning_loop_handoff_file");
      artifacts.latest_runtime_harness_report_file =
        getStringField(learningHandoff.payload, "runtime_harness_report_file") ||
        artifacts.latest_runtime_harness_report_file ||
        artifacts.runtime_harness_report_file;
      artifacts.latest_runtime_harness_decision =
        getStringField(learningHandoff.payload, "runtime_harness_overall_decision") ||
        artifacts.latest_runtime_harness_decision ||
        artifacts.runtime_harness_overall_decision;
      if (!artifacts.learning_loop_scorecard_file || !artifacts.learning_loop_handoff_file) {
        markStage(
          stageMap,
          "learning",
          "fail",
          uniqueStrings([learningHandoff.transcriptFile, ...collectStringRefs(learningHandoff.payload)]),
          "Learning handoff did not materialize the required public closure artifacts.",
        );
        throw new Error("Learning handoff did not materialize the required public closure artifacts.");
      }
      markStage(
        stageMap,
        "learning",
        "pass",
        uniqueStrings([auditRuns.transcriptFile, learningHandoff.transcriptFile, ...collectStringRefs(learningHandoff.payload)]),
        "Public audit and learning-loop closure artifacts materialized for the bounded full-lifecycle profile.",
      );
    } else {
      artifacts.release_status = "skipped";
      markStage(stageMap, "release", "skipped", [], "Delivery-default flow range excludes release.");
    }

    return {
      startedAt,
      finishedAt: nowIso(),
      status: "pass",
      stageResults: flattenStageMap(stageMap),
      commandResults,
      artifacts,
      sessionRoots,
    };
  } catch (error) {
    if (isLiveE2eControllerStop(error)) {
      artifacts.live_e2e_controller_stop = {
        reason: error.message,
        decision: asRecord(error.decision),
        state: asRecord(error.state),
      };
      return {
        startedAt,
        finishedAt: nowIso(),
        status: asNonEmptyString(asRecord(error.decision).action) === "continue" ? "pass" : "fail",
        stageResults: flattenStageMap(stageMap),
        commandResults,
        artifacts,
        sessionRoots,
      };
    }
    const summary = error instanceof Error ? error.message : String(error);
    if (!flattenStageMap(stageMap).some((stage) => stage.status === "fail")) {
      const fallbackStage = flattenStageMap(stageMap).find((stage) => stage.status === "pending")?.stage ?? "bootstrap";
      markStageRaw(stageMap, fallbackStage, "fail", [], summary);
      try {
        options.stepController?.observeStage({
          stage: fallbackStage,
          stageResult: stageMap[fallbackStage],
          commandResults,
          artifacts,
        });
      } catch (controllerError) {
        if (!isLiveE2eControllerStop(controllerError)) throw controllerError;
      }
    }
    return {
      startedAt,
      finishedAt: nowIso(),
      status: "fail",
      stageResults: flattenStageMap(stageMap),
      commandResults,
      artifacts,
      sessionRoots,
    };
  }
}

/**
 * @param {{
 *   hostRoot: string,
 *   layout: ReturnType<typeof ensureRuntimeLayout>,
 *   runId: string,
 *   profilePath: string,
 *   profile: Record<string, unknown>,
 *   aorLaunch: ReturnType<typeof resolveAorLaunch>,
 *   examplesRoot: string,
 *   catalogTargetPath: string,
 *   catalogEntry: Record<string, unknown>,
 *   mission: Record<string, unknown>,
 *   scenarioPolicyPath: string,
 *   scenarioPolicy: Record<string, unknown>,
 *   providerVariantPath: string,
 *   providerVariant: Record<string, unknown>,
 *   featureSize: string,
 *   matrixCell: Record<string, unknown>,
 *   coverageFollowUp: Record<string, unknown>,
 *   coverageTier: string,
 *   runnerAuthMode: "host" | "isolated",
 *   runtimeAgentPermissionMode: "full-bypass" | "restricted",
 *   runtimeAgentInteractionPolicy: "fail-closed" | "ask-all" | "orchestrator-mediated",
 *   runtimeAgentAutoApprovalProfile: "none" | "conservative" | "auto-edit" | "trusted-run",
 *   authProbeRequired: boolean,
 *   stepController?: ReturnType<import("./step-controller.mjs").createLiveE2eStepController>,
 * }} options
 */
export function executeFullJourneyFlow(options) {
  const stageMap = createStageMap(getProfileStages(options.profile));
  const commandResults = [];
  const transcriptsRoot = path.join(options.layout.reportsRoot, `live-e2e-command-traces-${normalizeId(options.runId)}`);
  fs.mkdirSync(transcriptsRoot, { recursive: true });
  const sessionRoots = createSessionRoots({
    sessionsRoot: options.layout.sessionsRoot,
    runId: options.runId,
  });
  const proofRunnerEnvironment = createProofRunnerEnvironment({
    sessionRoots,
    runnerAuthMode: options.runnerAuthMode,
  });
  const env = proofRunnerEnvironment.env;
  env.AOR_RUNTIME_AGENT_PERMISSION_MODE = options.runtimeAgentPermissionMode;
  env.AOR_RUNTIME_AGENT_INTERACTION_POLICY = options.runtimeAgentInteractionPolicy;
  env.AOR_RUNTIME_AGENT_AUTO_APPROVAL_PROFILE = options.runtimeAgentAutoApprovalProfile;

  const artifacts = {
    host_runtime_root: options.layout.runtimeRoot,
    host_reports_root: options.layout.reportsRoot,
    session_root: sessionRoots.sessionRoot,
    aor_home: sessionRoots.aorHome,
    codex_home: sessionRoots.codexHome,
    tmp_root: sessionRoots.tmpRoot,
    codex_home_isolated: options.runnerAuthMode === "isolated",
    runner_auth_mode: proofRunnerEnvironment.runnerAuthMode,
    runner_auth_source: proofRunnerEnvironment.runnerAuthSource,
    runtime_agent_permission_mode: options.runtimeAgentPermissionMode,
    runtime_agent_interaction_policy: options.runtimeAgentInteractionPolicy,
    runtime_agent_auto_approval_profile: options.runtimeAgentAutoApprovalProfile,
    target_catalog_file: options.catalogTargetPath,
    scenario_policy_file: options.scenarioPolicyPath,
    provider_variant_file: options.providerVariantPath,
    feature_mission_id: asNonEmptyString(options.mission.mission_id) || null,
    scenario_family: asNonEmptyString(options.profile.scenario_family) || null,
    provider_variant_id: asNonEmptyString(options.profile.provider_variant_id) || null,
    feature_size: options.featureSize,
    mission_class: asNonEmptyString(options.mission.mission_class) || null,
    run_tier: resolveRunTier(options.profile),
    matrix_cell: options.matrixCell,
    coverage_follow_up: options.coverageFollowUp,
    coverage_tier: options.coverageTier,
    production_proof: asRecord(options.profile.production_proof),
  };
  hydrateControllerArtifacts(artifacts, options.stepController);
  const markStage = (currentStageMap, stage, status, evidenceRefs = [], summary = null, observeOptions = {}) => {
    markStageRaw(currentStageMap, stage, status, evidenceRefs, summary);
    if (currentStageMap === stageMap) {
      options.stepController?.observeStage({
        stage,
        stageResult: currentStageMap[stage],
        commandResults,
        artifacts,
        ...observeOptions,
      });
    }
  };
  const startedAt = nowIso();
  const internalTestHooks = asRecord(options.profile.internal_test_hooks);
  const guidedJourneyEnabled = isGuidedJourneyEnabled(options.profile);
  let targetHeadBefore = null;

  try {
    const targetCheckout = materializeTargetCheckout({
      hostRoot: options.hostRoot,
      layout: options.layout,
      runId: options.runId,
      profile: options.profile,
      reuseExistingCheckout: options.stepController?.hasPersistedProgress?.() === true,
    });
    artifacts.target_checkout_root = targetCheckout.targetCheckoutRoot;
    artifacts.target_repo_ref = targetCheckout.targetRepoRef;
    artifacts.target_repo_url = targetCheckout.targetRepoUrl;
    artifacts.guided_journey_enabled = guidedJourneyEnabled;
    targetHeadBefore = runGitOutput({
      cwd: targetCheckout.targetCheckoutRoot,
      args: ["rev-parse", "HEAD"],
    });
    const catalogVerification = asRecord(options.catalogEntry.verification);
    const resolvedVerification = {
      ...catalogVerification,
      ...asRecord(options.profile.verification),
    };
    const repoLintCommands = asStringArray(resolvedVerification.setup_commands);
    const repoVerificationCommands = asStringArray(resolvedVerification.commands);
    const postRunQualityPolicy = resolvePostRunQualityPolicy(options.mission, catalogVerification);
    artifacts.post_run_quality_policy = postRunQualityPolicy;
    const browserCachePreflight = prepareBrowserCachePreflight({
      targetCheckoutRoot: targetCheckout.targetCheckoutRoot,
      reportsRoot: options.layout.reportsRoot,
      runId: options.runId,
      commands: uniqueStrings([
        ...repoLintCommands,
        ...repoVerificationCommands,
        ...postRunQualityPolicy.primaryCommands,
        ...postRunQualityPolicy.diagnosticCommands,
      ]),
      env,
      forceFailure: internalTestHooks.force_browser_cache_preflight_failure === true,
    });
    artifacts.browser_cache_preflight_file = browserCachePreflight.reportFile;
    artifacts.browser_cache_preflight = browserCachePreflight.report;
    if (browserCachePreflight.status === "fail") {
      markStage(
        stageMap,
        "bootstrap",
        "fail",
        [browserCachePreflight.reportFile],
        asNonEmptyString(browserCachePreflight.report.summary) || "Browser cache preflight failed.",
      );
      throw new Error(asNonEmptyString(browserCachePreflight.report.summary) || "Browser cache preflight failed.");
    }

    let commandIndex = 1;
    const runCommand = (label, args, runOptions = {}) => {
      const iteration = Number(runOptions.iteration) || 1;
      if (options.stepController?.shouldUseCachedCommand?.(label, iteration) === true) {
        const cachedDiagnostic = asRecord(options.stepController.getCachedCommandResult(label, iteration));
        const cachedResult = buildCachedCommandResult(cachedDiagnostic);
        if (cachedResult) {
          commandIndex += 1;
          if (
            !commandResults.some(
              (entry) =>
                asNonEmptyString(entry.label) === label &&
                (Number(entry.iteration) || 1) === iteration &&
                asNonEmptyString(entry.step_instance_id) === asNonEmptyString(cachedDiagnostic.step_instance_id),
            )
          ) {
            commandResults.push(cachedDiagnostic);
          }
          return cachedResult;
        }
      }
      if (runOptions.suppressControllerPlan !== true) {
        options.stepController?.planCommand?.({
          label,
          commandSurface: resolveCommandSurface(args),
          iteration,
        });
      }
      const result = runAorCommand({
        launch: options.aorLaunch,
        cwd: targetCheckout.targetCheckoutRoot,
        args,
        env,
        transcriptsRoot,
        label,
        index: commandIndex,
        timeoutMs:
          typeof runOptions.timeoutMs === "number" && Number.isFinite(runOptions.timeoutMs)
            ? Number(runOptions.timeoutMs)
            : null,
      });
      commandIndex += 1;
      const diagnostic = buildCommandDiagnostic(result, runOptions);
      annotateCommandDiagnosticStep(diagnostic, label, iteration);
      if (!result.ok && runOptions.allowNonZeroWithPayload === true && result.payload) {
        diagnostic.accepted_nonzero_payload = true;
        diagnostic.failure_class = "nonzero-with-readable-payload";
        diagnostic.recommendation = "inspect payload quality fields";
      }
      commandResults.push(diagnostic);
      if (!result.ok && runOptions.allowFailureResult === true) {
        diagnostic.accepted_failure_result = true;
        return result;
      }
      if (!result.ok && !(runOptions.allowNonZeroWithPayload === true && result.payload)) {
        const stderr = result.stderr.trim() || result.stdout.trim() || "command failed";
        throw new Error(`Public CLI command '${label}' failed: ${stderr}`);
      }
      return result;
    };
    const recordArtifactReadinessSnapshot = (checkpoint) => {
      const existingSnapshot = Array.isArray(artifacts.artifact_readiness_snapshots)
        ? artifacts.artifact_readiness_snapshots
            .map((entry) => asRecord(entry))
            .find((entry) => asNonEmptyString(entry.checkpoint) === checkpoint)
        : null;
      if (existingSnapshot) {
        const existingReportFile = asNonEmptyString(existingSnapshot.next_action_report_file);
        const existingTranscriptFile = asNonEmptyString(existingSnapshot.transcript_file);
        if (existingReportFile) {
          artifacts.next_action_report_file = existingReportFile;
          artifacts[`artifact_readiness_next_after_${checkpoint}_report_file`] = existingReportFile;
        }
        if (existingTranscriptFile) {
          artifacts[`artifact_readiness_next_after_${checkpoint}_transcript_file`] = existingTranscriptFile;
        }
        return existingSnapshot;
      }
      const label = `artifact-readiness-next-after-${checkpoint}`;
      const next = runCommand(label, [
        "next",
        "--project-ref",
        ".",
        "--project-profile",
        generatedProfile.generatedProjectProfileFile,
        "--runtime-root",
        ".aor",
        "--json",
      ]);
      const reportFile = getStringField(next.payload, "next_action_report_file");
      const snapshot = {
        checkpoint,
        command_label: label,
        transcript_file: next.transcriptFile,
        next_action_report_file: reportFile,
        next_action_status: getStringField(next.payload, "next_action_status"),
        next_action_primary: getStringField(next.payload, "next_action_primary"),
        next_action_blockers: asStringArray(next.payload?.next_action_blockers),
        artifact_readiness: asRecord(next.payload?.next_action_artifact_readiness),
        evidence_refs: uniqueStrings([next.transcriptFile, reportFile, ...collectStringRefs(next.payload)]),
      };
      artifacts.artifact_readiness_snapshots = [
        ...(Array.isArray(artifacts.artifact_readiness_snapshots) ? artifacts.artifact_readiness_snapshots : []),
        snapshot,
      ];
      artifacts.next_action_report_files = uniqueStrings([
        ...(Array.isArray(artifacts.next_action_report_files) ? artifacts.next_action_report_files : []),
        reportFile,
      ]);
      artifacts.next_action_report_file = reportFile;
      artifacts[`artifact_readiness_next_after_${checkpoint}_report_file`] = reportFile;
      artifacts[`artifact_readiness_next_after_${checkpoint}_transcript_file`] = next.transcriptFile;
      return snapshot;
    };
    const runPostRunDiagnosticVerify = (runOptions = {}) => {
      const iteration = Number(runOptions.iteration) || 1;
      const cachedPostRunDiagnosticVerify =
        options.stepController?.hasPersistedProgress?.() === true
          ? buildCachedPostRunDiagnosticVerifyResult(
              artifacts,
              asNonEmptyString(postRunQualityPolicy.diagnosticFailureMode),
            )
          : null;
      if (cachedPostRunDiagnosticVerify) return cachedPostRunDiagnosticVerify;

      const postRunDiagnosticVerify = runCommand("project-verify-post-run-diagnostic", [
        "project",
        "verify",
        "--project-ref",
        ".",
        "--project-profile",
        generatedProfile.generatedProjectProfileFile,
        "--runtime-root",
        ".aor",
        "--require-validation-pass",
        "true",
        "--verification-label",
        "post-run-diagnostic",
        ...(asNonEmptyString(artifacts.baseline_verify_summary_file)
          ? ["--output-quality-baseline", /** @type {string} */ (artifacts.baseline_verify_summary_file)]
          : []),
      ], {
        iteration,
        diagnosticIntent: POST_RUN_DIAGNOSTIC_INTENT,
        timeoutMs:
          typeof runOptions.timeoutMs === "number" && Number.isFinite(runOptions.timeoutMs)
            ? Number(runOptions.timeoutMs)
            : null,
        allowFailureResult: runOptions.allowFailureResult === true,
      });
      artifacts.post_run_diagnostic_transcript_file = postRunDiagnosticVerify.transcriptFile;
      artifacts.post_run_diagnostic_verify_summary_file = getStringField(
        postRunDiagnosticVerify.payload,
        "verify_summary_file",
      );
      artifacts.post_run_diagnostic_verify_step_result_files = getStringArrayField(
        postRunDiagnosticVerify.payload,
        "step_result_files",
      );
      const diagnosticSummaryFile = asNonEmptyString(artifacts.post_run_diagnostic_verify_summary_file);
      const diagnosticSummary =
        diagnosticSummaryFile && fileExists(diagnosticSummaryFile) ? readJson(diagnosticSummaryFile) : {};
      const diagnosticPassed = asNonEmptyString(diagnosticSummary.status) === "passed";
      artifacts.post_run_diagnostic_status = diagnosticPassed ? "pass" : postRunQualityPolicy.diagnosticFailureMode;
      const preservedDiagnostic = diagnosticSummaryFile
        ? preserveVerifyArtifacts({
            verifyPayload: asRecord(postRunDiagnosticVerify.payload),
            summaryFile: diagnosticSummaryFile,
            reportsRoot: options.layout.reportsRoot,
            runId: options.runId,
            phase: `post-run-diagnostic-verify-${iteration}`,
          })
        : { preserved_summary_file: null, preserved_step_result_files: [], preserved_files: [] };
      artifacts.post_run_diagnostic_verify_preserved_files = preservedDiagnostic.preserved_files;
      if (preservedDiagnostic.preserved_summary_file) {
        artifacts.post_run_diagnostic_verify_summary_file = preservedDiagnostic.preserved_summary_file;
      }
      if (preservedDiagnostic.preserved_step_result_files.length > 0) {
        artifacts.post_run_diagnostic_verify_step_result_files = preservedDiagnostic.preserved_step_result_files;
      }
      return postRunDiagnosticVerify;
    };

    if (guidedJourneyEnabled) {
      const guidedDoctor = runCommand("guided-doctor", [
        "doctor",
        "--project-ref",
        ".",
        "--runtime-root",
        ".aor",
        "--json",
      ]);
      artifacts.guided_doctor_transcript_file = guidedDoctor.transcriptFile;

      const guidedOnboard = runCommand("guided-onboard", [
        "onboard",
        ".",
        "--runtime-root",
        ".aor",
        "--asset-mode",
        "bundled",
        "--json",
      ]);
      artifacts.onboarding_report_file = getStringField(guidedOnboard.payload, "onboarding_report_file");
      artifacts.guided_onboard_transcript_file = guidedOnboard.transcriptFile;

      const guidedApp = runCommand("guided-app", [
        "app",
        "--project-ref",
        ".",
        "--runtime-root",
        ".aor",
        "--smoke",
        "true",
        "--open",
        "false",
        "--json",
      ]);
      artifacts.guided_app_transcript_file = guidedApp.transcriptFile;

      const guidedNextBeforeMission = runCommand("guided-next-before-mission", [
        "next",
        "--project-ref",
        ".",
        "--runtime-root",
        ".aor",
        "--json",
      ]);
      artifacts.next_action_report_file = getStringField(guidedNextBeforeMission.payload, "next_action_report_file");
      artifacts.guided_next_before_mission_transcript_file = guidedNextBeforeMission.transcriptFile;
    }

    const hostAssets = materializeHostLiveE2eAssets({
      examplesRoot: options.examplesRoot,
      generatedAssetsRoot: path.join(options.layout.stateRoot, "live-e2e-assets", normalizeId(options.runId)),
    });
    artifacts.host_live_e2e_assets_root = hostAssets.assetsRoot;

    const generatedProfile = materializeGeneratedProjectProfile({
      hostRoot: options.hostRoot,
      profilePath: options.profilePath,
      profile: options.profile,
      catalogEntry: options.catalogEntry,
      mission: options.mission,
      providerVariant: options.providerVariant,
      runId: options.runId,
      targetCheckout,
      generatedAssetsRoot: hostAssets.assetsRoot,
    });
    artifacts.generated_project_profile_file = generatedProfile.generatedProjectProfileFile;
    artifacts.project_profile_template_file = generatedProfile.templateProjectProfilePath;

    const projectInit = runCommand("project-init", [
      "project",
      "init",
      "--project-ref",
      ".",
      "--project-profile",
      generatedProfile.generatedProjectProfileFile,
      "--runtime-root",
      ".aor",
      ...repoVerificationCommands.flatMap((entry) => ["--repo-build-command", entry]),
      ...repoLintCommands.flatMap((entry) => ["--repo-lint-command", entry]),
      ...repoVerificationCommands.flatMap((entry) => ["--repo-test-command", entry]),
    ]);
    artifacts.bootstrap_artifact_packet_file = getStringField(projectInit.payload, "artifact_packet_file");
    artifacts.project_init_transcript_file = projectInit.transcriptFile;
    const providerRoutes = materializeProviderPinnedRouteOverrides({
      routesRoot: hostAssets.routesRoot,
      providerVariant: options.providerVariant,
      providerVariantId: asNonEmptyString(options.profile.provider_variant_id),
      profile: options.profile,
    });
    artifacts.provider_route_override_files = providerRoutes.routeFiles;
    artifacts.provider_route_overrides = providerRoutes.routeOverrides;
    const routeOverridesFlag = serializeRouteOverrides(providerRoutes.routeOverrides);
    const providerPolicies = materializeProviderPinnedPolicyOverrides({
      policiesRoot: path.join(hostAssets.assetsRoot, "policies"),
      providerVariantId: asNonEmptyString(options.profile.provider_variant_id),
      providerVariant: options.providerVariant,
      profile: options.profile,
    });
    artifacts.provider_policy_override_files = providerPolicies.policyFiles;
    artifacts.provider_policy_overrides = providerPolicies.policyOverrides;
    const policyOverridesFlag = serializePolicyOverrides(providerPolicies.policyOverrides);
    const cachedLiveAdapterPreflight = asRecord(artifacts.live_adapter_preflight);
    const cachedLiveAdapterPreflightFile = asNonEmptyString(artifacts.live_adapter_preflight_file);
    const shouldReuseLiveAdapterPreflight =
      asNonEmptyString(cachedLiveAdapterPreflight.status) === "pass" &&
      cachedLiveAdapterPreflightFile.length > 0 &&
      fileExists(cachedLiveAdapterPreflightFile);
    const liveAdapterPreflight = shouldReuseLiveAdapterPreflight
      ? {
          status: "pass",
          summary:
            asNonEmptyString(cachedLiveAdapterPreflight.summary) ||
            "Live adapter preflight reused from earlier manual resume segment.",
          report: cachedLiveAdapterPreflight,
          reportFile: cachedLiveAdapterPreflightFile,
        }
      : runLiveAdapterPreflight({
          targetCheckoutRoot: targetCheckout.targetCheckoutRoot,
          adapterProfileRoot: path.join(hostAssets.assetsRoot, "adapters"),
          providerVariant: options.providerVariant,
          providerVariantId: asNonEmptyString(options.profile.provider_variant_id),
          coverageTier: options.coverageTier,
          env,
          runnerAuthMode: proofRunnerEnvironment.runnerAuthMode,
          runnerAuthSource: proofRunnerEnvironment.runnerAuthSource,
          runtimeAgentPermissionMode: options.runtimeAgentPermissionMode,
          runtimeAgentInteractionPolicy: options.runtimeAgentInteractionPolicy,
          runtimeAgentAutoApprovalProfile: options.runtimeAgentAutoApprovalProfile,
          authProbeRequired: options.authProbeRequired,
          permissionReadinessRequired: asRecord(options.profile.production_proof).require_permission_readiness === true,
          runId: options.runId,
          reportsRoot: options.layout.reportsRoot,
        });
    artifacts.live_adapter_preflight_file = liveAdapterPreflight.reportFile;
    artifacts.live_adapter_preflight = liveAdapterPreflight.report;
    if (shouldReuseLiveAdapterPreflight) {
      artifacts.live_adapter_preflight_reused_after_resume = true;
    }
    if (liveAdapterPreflight.status !== "pass") {
      markStage(
        stageMap,
        "bootstrap",
        liveAdapterPreflight.status === "interaction_required" ? "interaction_required" : "fail",
        uniqueStrings([projectInit.transcriptFile, liveAdapterPreflight.reportFile, ...collectStringRefs(projectInit.payload)]),
        liveAdapterPreflight.summary,
      );
      throw new Error(liveAdapterPreflight.summary);
    }
    markStage(
      stageMap,
      "bootstrap",
      "pass",
      uniqueStrings([
        projectInit.transcriptFile,
        liveAdapterPreflight.reportFile,
        browserCachePreflight.reportFile,
        ...collectStringRefs(projectInit.payload),
        ...providerRoutes.routeFiles,
        ...providerPolicies.policyFiles,
      ]),
      "Public bootstrap initialized target .aor while live E2E assets and provider-pinned routes stayed in host runtime state.",
    );

    const featureRequest = materializeFeatureRequestFile({
      targetCheckoutRoot: targetCheckout.targetCheckoutRoot,
      mission: options.mission,
      runId: options.runId,
      scenarioFamily: asNonEmptyString(options.profile.scenario_family),
      providerVariantId: asNonEmptyString(options.profile.provider_variant_id),
      providerVariant: options.providerVariant,
      scenarioPolicy: options.scenarioPolicy,
      featureSize: options.featureSize,
      matrixCell: options.matrixCell,
      coverageFollowUp: options.coverageFollowUp,
    });
    artifacts.feature_request_file = featureRequest.requestFile;

    const cachedIntakePacketFile = asNonEmptyString(artifacts.intake_artifact_packet_file);
    const cachedIntakePacketBodyFile = asNonEmptyString(artifacts.intake_artifact_packet_body_file);
    const canReuseIntake =
      options.stepController?.hasPersistedProgress?.() === true &&
      cachedIntakePacketFile &&
      cachedIntakePacketBodyFile &&
      fileExists(cachedIntakePacketFile) &&
      fileExists(cachedIntakePacketBodyFile);
    const intakeCreate = canReuseIntake
      ? {
          label: guidedJourneyEnabled ? "mission-create" : "intake-create",
          ok: true,
          exitCode: 0,
          stdout: "",
          stderr: "",
          payload: {
            artifact_packet_file: cachedIntakePacketFile,
            artifact_packet_body_file: cachedIntakePacketBodyFile,
          },
          transcriptFile:
            asNonEmptyString(artifacts.intake_create_transcript_file) ||
            asNonEmptyString(artifacts.guided_mission_create_transcript_file) ||
            "",
          startedAt: nowIso(),
          finishedAt: nowIso(),
          durationSec: 0,
          commandSurface: "cached intake create",
        }
      : guidedJourneyEnabled
        ? runCommand("mission-create", buildGuidedMissionCreateArgs({
            mission: options.mission,
            featureRequest,
            profile: options.profile,
            projectProfileFile: generatedProfile.generatedProjectProfileFile,
          }))
        : runCommand("intake-create", buildIntakeCreateArgs({
            mission: options.mission,
            featureRequest,
            profile: options.profile,
            projectProfileFile: generatedProfile.generatedProjectProfileFile,
          }));
    artifacts.intake_artifact_packet_file = getStringField(intakeCreate.payload, "artifact_packet_file");
    artifacts.intake_artifact_packet_body_file = getStringField(intakeCreate.payload, "artifact_packet_body_file");
    artifacts.intake_create_transcript_file = intakeCreate.transcriptFile;
    if (canReuseIntake) {
      artifacts.intake_reused_after_resume = true;
    }
    artifacts.intake_quality_gate = evaluateMissionIntakeQuality({
      mission: options.mission,
      featureSize: options.featureSize,
      scenarioFamily: asNonEmptyString(options.profile.scenario_family),
      postRunQualityPolicy,
    });
    if (guidedJourneyEnabled) {
      artifacts.guided_mission_create_transcript_file = intakeCreate.transcriptFile;
      const guidedNextAfterMission = runCommand("guided-next-after-mission", [
        "next",
        "--project-ref",
        ".",
        "--project-profile",
        generatedProfile.generatedProjectProfileFile,
        "--runtime-root",
        ".aor",
        "--json",
      ]);
      artifacts.next_action_report_file = getStringField(guidedNextAfterMission.payload, "next_action_report_file");
      artifacts.guided_next_after_mission_transcript_file = guidedNextAfterMission.transcriptFile;
    }
    recordArtifactReadinessSnapshot("mission");

    const analyze = runCommand("project-analyze", [
      "project",
      "analyze",
      "--project-ref",
      ".",
      "--project-profile",
      generatedProfile.generatedProjectProfileFile,
      "--runtime-root",
      ".aor",
      ...(routeOverridesFlag ? ["--route-overrides", routeOverridesFlag] : []),
      ...(policyOverridesFlag ? ["--policy-overrides", policyOverridesFlag] : []),
    ]);
    artifacts.analysis_report_file = getStringField(analyze.payload, "analysis_report_file");
    artifacts.route_resolution_file = getStringField(analyze.payload, "route_resolution_file");
    artifacts.asset_resolution_file = getStringField(analyze.payload, "asset_resolution_file");
    artifacts.policy_resolution_file = getStringField(analyze.payload, "policy_resolution_file");
    artifacts.evaluation_registry_file = getStringField(analyze.payload, "evaluation_registry_file");

    const validate = runCommand("project-validate", [
      "project",
      "validate",
      "--project-ref",
      ".",
      "--project-profile",
      generatedProfile.generatedProjectProfileFile,
      "--runtime-root",
      ".aor",
    ]);
    artifacts.validation_report_file = getStringField(validate.payload, "validation_report_file");

    const executionAlreadyObserved = controllerObservedStep(options.stepController, "execution");
    const cachedBaselineVerifySummaryPath = asNonEmptyString(artifacts.baseline_verify_summary_file);
    const cachedTargetCleanlinessFile = asNonEmptyString(artifacts.target_cleanliness_before_execution_file);
    const cachedExecutionReadinessFile = asNonEmptyString(artifacts.execution_readiness_file);
    let baselineVerifySummaryPath = /** @type {string | null} */ (cachedBaselineVerifySummaryPath || null);
    let baselineGateDecision = asRecord(artifacts.baseline_verify_gate_decision);
    /** @type {string[]} */
    let baselineEvidenceRefs = uniqueStrings([
      baselineVerifySummaryPath,
      ...asStringArray(artifacts.baseline_verify_preserved_files),
      ...asStringArray(artifacts.baseline_verify_step_result_files),
      cachedTargetCleanlinessFile,
      cachedExecutionReadinessFile,
      asNonEmptyString(artifacts.target_toolchain_preflight_file),
    ]);
    const hasReusablePreExecutionReadiness =
      baselineVerifySummaryPath &&
      fileExists(baselineVerifySummaryPath) &&
      Object.keys(baselineGateDecision).length > 0 &&
      cachedTargetCleanlinessFile &&
      fileExists(cachedTargetCleanlinessFile) &&
      cachedExecutionReadinessFile &&
      fileExists(cachedExecutionReadinessFile);
    if (executionAlreadyObserved && !hasReusablePreExecutionReadiness) {
      const summary = "Observed execution cannot resume without preserved pre-execution readiness evidence.";
      markStageRaw(stageMap, "execution", "fail", [], summary);
      throw new Error(summary);
    }
    if (!hasReusablePreExecutionReadiness) {
      const targetToolchainPolicy = resolveTargetNodeToolchainPolicy(options.profile);
      if (targetToolchainPolicy) {
        const targetToolchainPreflight = evaluateTargetToolchainPreflight({
          profile: options.profile,
          env,
          reportsRoot: options.layout.reportsRoot,
          runId: options.runId,
        });
        artifacts.target_toolchain_preflight_file = targetToolchainPreflight.reportFile;
        artifacts.target_toolchain_preflight = targetToolchainPreflight.report;
        baselineEvidenceRefs = uniqueStrings([...baselineEvidenceRefs, targetToolchainPreflight.reportFile]);
        if (targetToolchainPreflight.status === "blocked") {
          const targetPreExecutionStatus = buildTargetToolchainBlockedPreExecutionStatus({
            preflightReport: targetToolchainPreflight.report,
            preflightReportFile: targetToolchainPreflight.reportFile,
            baselineGateMode: resolveBaselineGateMode(options.profile),
          });
          const targetPreExecutionStatusFile = writeTargetPreExecutionStatusReport({
            reportsRoot: options.layout.reportsRoot,
            runId: options.runId,
            report: targetPreExecutionStatus,
          });
          artifacts.target_pre_execution_status_file = targetPreExecutionStatusFile;
          artifacts.target_pre_execution_status = targetPreExecutionStatus;
          artifacts.target_setup_status = targetPreExecutionStatus.target_setup_status;
          artifacts.target_verification_status_detail = targetPreExecutionStatus.target_verification_status;
          artifacts.baseline_verify_gate_decision = targetPreExecutionStatus.baseline_verify_gate_decision;
          artifacts.baseline_verify_status = "fail";
          artifacts.failure_owner = targetPreExecutionStatus.failure_owner;
          artifacts.failure_phase = targetPreExecutionStatus.failure_phase;
          artifacts.failure_class = targetPreExecutionStatus.failure_class;
          markStage(
            stageMap,
            "execution",
            "fail",
            [targetToolchainPreflight.reportFile, targetPreExecutionStatusFile],
            asNonEmptyString(targetPreExecutionStatus.blocker_reason) || "Target Node toolchain preflight blocked.",
          );
          throw new Error(
            asNonEmptyString(targetPreExecutionStatus.blocker_reason) || "Target Node toolchain preflight blocked.",
          );
        }
      }
      const verifyPreflight = runCommand(
        "project-verify-preflight",
        [
          "project",
          "verify",
          "--project-ref",
          ".",
          "--project-profile",
          generatedProfile.generatedProjectProfileFile,
          "--runtime-root",
          ".aor",
          "--require-validation-pass",
          "true",
          "--verification-label",
          "baseline-diagnostic",
          "--routed-dry-run-step",
          "implement",
          ...(routeOverridesFlag ? ["--route-overrides", routeOverridesFlag] : []),
          ...(policyOverridesFlag ? ["--policy-overrides", policyOverridesFlag] : []),
        ],
        {
          allowFailureResult: true,
          timeoutMs: resolveProjectVerifyPreflightTimeoutMs({
            profile: options.profile,
            setupCommands: repoLintCommands,
            verificationCommands: repoVerificationCommands,
          }),
        },
      );
      baselineVerifySummaryPath = getStringField(verifyPreflight.payload, "verify_summary_file");
      artifacts.baseline_verify_summary_file = baselineVerifySummaryPath;
      artifacts.verify_summary_file = baselineVerifySummaryPath;
      artifacts.baseline_verify_step_result_files = getStringArrayField(verifyPreflight.payload, "step_result_files");
      artifacts.preflight_step_result_files = artifacts.baseline_verify_step_result_files;
      artifacts.baseline_routed_dry_run_step_result_file = getStringField(
        verifyPreflight.payload,
        "routed_step_result_file",
      );
      if (
        internalTestHooks.drop_baseline_routed_dry_run_after_preflight === true &&
        typeof artifacts.baseline_routed_dry_run_step_result_file === "string"
      ) {
        fs.rmSync(artifacts.baseline_routed_dry_run_step_result_file, { force: true });
      }
      if (!baselineVerifySummaryPath || !fileExists(baselineVerifySummaryPath)) {
        const targetPreExecutionStatus = buildTargetPreExecutionStatusReport({
          verifySummary: {},
          verifyPayload: asRecord(verifyPreflight.payload),
          stepResultFiles: getStringArrayField(verifyPreflight.payload, "step_result_files"),
          setupCommands: repoLintCommands,
          verificationCommands: repoVerificationCommands,
          baselineGateDecision: {
            phase: "baseline_diagnostic",
            mode: resolveBaselineGateMode(options.profile),
            status: "fail",
            decision: "block",
            summary: verifyPreflight.timedOut
              ? "AOR public project verify command timed out before target setup evidence was materialized."
              : "Dry-run verify summary was not materialized.",
            blocking_reasons: [verifyPreflight.timedOut ? "aor-project-verify-timeout" : "verify-summary-missing"],
            failure_owner: "aor",
            failure_phase: "target_verification",
            failure_class: "aor_failure",
          },
          runResult: verifyPreflight,
        });
        const targetPreExecutionStatusFile = writeTargetPreExecutionStatusReport({
          reportsRoot: options.layout.reportsRoot,
          runId: options.runId,
          report: targetPreExecutionStatus,
        });
        artifacts.target_pre_execution_status_file = targetPreExecutionStatusFile;
        artifacts.target_pre_execution_status = targetPreExecutionStatus;
        artifacts.target_setup_status = targetPreExecutionStatus.target_setup_status;
        artifacts.target_verification_status_detail = targetPreExecutionStatus.target_verification_status;
        artifacts.failure_owner = targetPreExecutionStatus.failure_owner;
        artifacts.failure_phase = targetPreExecutionStatus.failure_phase;
        artifacts.failure_class = targetPreExecutionStatus.failure_class;
        markStage(
          stageMap,
          "execution",
          "fail",
          uniqueStrings([verifyPreflight.transcriptFile, targetPreExecutionStatusFile, ...collectStringRefs(verifyPreflight.payload)]),
          asNonEmptyString(targetPreExecutionStatus.blocker_reason) || "Dry-run verify summary was not materialized.",
        );
        throw new Error(asNonEmptyString(targetPreExecutionStatus.blocker_reason) || "Dry-run verify summary was not materialized.");
      }
      const baselineVerifySummary = readJson(baselineVerifySummaryPath);
      const preservedBaseline = preserveVerifyArtifacts({
        verifyPayload: asRecord(verifyPreflight.payload),
        summaryFile: baselineVerifySummaryPath,
        reportsRoot: options.layout.reportsRoot,
        runId: options.runId,
        phase: "baseline-verify",
      });
      artifacts.baseline_verify_preserved_files = preservedBaseline.preserved_files;
      if (preservedBaseline.preserved_summary_file) {
        artifacts.baseline_verify_summary_file = preservedBaseline.preserved_summary_file;
      }
      if (preservedBaseline.preserved_step_result_files.length > 0) {
        artifacts.baseline_verify_step_result_files = preservedBaseline.preserved_step_result_files;
        artifacts.preflight_step_result_files = preservedBaseline.preserved_step_result_files;
      }
      const baselineGateMode = resolveBaselineGateMode(options.profile);
      baselineGateDecision = evaluateBaselineVerifyGate({
        verifySummary: asRecord(baselineVerifySummary),
        verifyPayload: asRecord(verifyPreflight.payload),
        stepResultFiles: getStringArrayField(verifyPreflight.payload, "step_result_files"),
        setupCommands: repoLintCommands,
        verificationCommands: repoVerificationCommands,
        mode: baselineGateMode,
      });
      const targetPreExecutionStatus = buildTargetPreExecutionStatusReport({
        verifySummary: asRecord(baselineVerifySummary),
        verifyPayload: asRecord(verifyPreflight.payload),
        stepResultFiles: getStringArrayField(verifyPreflight.payload, "step_result_files"),
        setupCommands: repoLintCommands,
        verificationCommands: repoVerificationCommands,
        baselineGateDecision,
        runResult: verifyPreflight,
      });
      const targetPreExecutionStatusFile = writeTargetPreExecutionStatusReport({
        reportsRoot: options.layout.reportsRoot,
        runId: options.runId,
        report: targetPreExecutionStatus,
      });
      artifacts.target_pre_execution_status_file = targetPreExecutionStatusFile;
      artifacts.target_pre_execution_status = targetPreExecutionStatus;
      artifacts.target_setup_status = targetPreExecutionStatus.target_setup_status;
      artifacts.target_verification_status_detail = targetPreExecutionStatus.target_verification_status;
      artifacts.failure_owner = targetPreExecutionStatus.failure_owner;
      artifacts.failure_phase = targetPreExecutionStatus.failure_phase;
      artifacts.failure_class = targetPreExecutionStatus.failure_class;
      artifacts.baseline_verify_status = baselineGateDecision.status;
      artifacts.baseline_verify_gate_decision = baselineGateDecision;
      if (baselineGateDecision.decision === "block") {
        markStage(
          stageMap,
          "execution",
          "fail",
          uniqueStrings([
            verifyPreflight.transcriptFile,
            targetPreExecutionStatusFile,
            baselineVerifySummaryPath,
            ...asStringArray(artifacts.baseline_verify_preserved_files),
            ...collectStringRefs(verifyPreflight.payload),
          ]),
          asNonEmptyString(baselineGateDecision.summary) || "Baseline readiness failed before provider execution.",
        );
        throw new Error(asNonEmptyString(baselineGateDecision.summary) || "Baseline readiness failed before provider execution.");
      }
      const targetCleanliness = writeTargetCleanlinessReport({
        targetCheckoutRoot: targetCheckout.targetCheckoutRoot,
        reportsRoot: options.layout.reportsRoot,
        runId: options.runId,
        phase: "before-execution",
      });
      artifacts.target_cleanliness_before_execution_file = targetCleanliness.reportFile;
      artifacts.target_cleanliness_before_execution = targetCleanliness.report;
      if (targetCleanliness.report.status !== "pass") {
        markStage(
          stageMap,
          "execution",
          "fail",
          [targetCleanliness.reportFile],
          asNonEmptyString(targetCleanliness.report.summary) || "Target setup changed tracked files before execution.",
        );
        throw new Error(asNonEmptyString(targetCleanliness.report.summary) || "Target setup changed tracked files before execution.");
      }
      const executionReadiness = writeExecutionReadinessDecision({
        runId: options.runId,
        reportsRoot: options.layout.reportsRoot,
        liveAdapterPreflightFile: asNonEmptyString(artifacts.live_adapter_preflight_file),
        validationReportFile: asNonEmptyString(artifacts.validation_report_file),
        baselineGateDecision,
        baselineRoutedStepResultFile: asNonEmptyString(artifacts.baseline_routed_dry_run_step_result_file),
      });
      artifacts.execution_readiness_file = executionReadiness.decisionFile;
      artifacts.execution_readiness = executionReadiness.decision;
      baselineEvidenceRefs = uniqueStrings([
        verifyPreflight.transcriptFile,
        baselineVerifySummaryPath,
        ...asStringArray(artifacts.baseline_verify_preserved_files),
        ...collectStringRefs(verifyPreflight.payload),
        targetCleanliness.reportFile,
        executionReadiness.decisionFile,
        asNonEmptyString(artifacts.target_pre_execution_status_file),
      ]);
    } else {
      artifacts.pre_execution_readiness_reused_after_resume = true;
    }

    const discovery = runCommand("discovery-run", [
      "discovery",
      "run",
      "--project-ref",
      ".",
      "--project-profile",
      generatedProfile.generatedProjectProfileFile,
      "--runtime-root",
      ".aor",
      "--input-packet",
      /** @type {string} */ (artifacts.intake_artifact_packet_file),
      ...(routeOverridesFlag ? ["--route-overrides", routeOverridesFlag] : []),
      ...(policyOverridesFlag ? ["--policy-overrides", policyOverridesFlag] : []),
    ]);
    artifacts.discovery_analysis_report_file = getStringField(discovery.payload, "analysis_report_file");
    artifacts.discovery_research_report_file = getStringField(discovery.payload, "discovery_research_report_file");
    artifacts.discovery_research_status = getStringField(discovery.payload, "discovery_research_status");
    artifacts.discovery_research_adr_ready = discovery.payload?.discovery_research_adr_ready === true;
    const discoveryReadinessSnapshot = recordArtifactReadinessSnapshot("discovery");
    markStage(
      stageMap,
      "discovery",
      "pass",
      uniqueStrings([
        analyze.transcriptFile,
        validate.transcriptFile,
        discovery.transcriptFile,
        ...collectStringRefs(discovery.payload),
        ...asStringArray(discoveryReadinessSnapshot.evidence_refs),
      ]),
      "Feature-driven discovery completed from catalog-backed intake request.",
    );

    const specBuild = runCommand("spec-build", [
      "spec",
      "build",
      "--project-ref",
      ".",
      "--project-profile",
      generatedProfile.generatedProjectProfileFile,
      "--runtime-root",
      ".aor",
      ...(routeOverridesFlag ? ["--route-overrides", routeOverridesFlag] : []),
      ...(policyOverridesFlag ? ["--policy-overrides", policyOverridesFlag] : []),
    ]);
    artifacts.spec_step_result_file = getStringField(specBuild.payload, "routed_step_result_file");
    if (internalTestHooks.drop_spec_step_result_after_spec_build === true && artifacts.spec_step_result_file) {
      try {
        fs.rmSync(artifacts.spec_step_result_file, { force: true });
      } catch {
        // ignore test-only cleanup failure and let the artifact check below fail deterministically
      }
    }
    if (!artifacts.spec_step_result_file || !fileExists(artifacts.spec_step_result_file)) {
      markStage(
        stageMap,
        "spec",
        "fail",
        uniqueStrings([specBuild.transcriptFile, ...collectStringRefs(specBuild.payload)]),
        "Spec build did not materialize a routed step-result artifact.",
      );
      throw new Error("Spec build did not materialize a routed step-result artifact.");
    }
    const specReadinessSnapshot = recordArtifactReadinessSnapshot("spec");
    markStage(
      stageMap,
      "spec",
      "pass",
      uniqueStrings([
        specBuild.transcriptFile,
        ...collectStringRefs(specBuild.payload),
        ...asStringArray(specReadinessSnapshot.evidence_refs),
      ]),
      "Spec build produced feature-traceable dry-run evidence.",
    );

    const waveCreate = runCommand("wave-create", [
      "wave",
      "create",
      "--project-ref",
      ".",
      "--project-profile",
      generatedProfile.generatedProjectProfileFile,
      "--runtime-root",
      ".aor",
    ]);
    artifacts.wave_ticket_file = getStringField(waveCreate.payload, "wave_ticket_file");
    artifacts.handoff_packet_file = getStringField(waveCreate.payload, "handoff_packet_file");
    artifacts.handoff_status = getStringField(waveCreate.payload, "handoff_status");
    const planningReadinessSnapshot = recordArtifactReadinessSnapshot("planning");
    markStage(
      stageMap,
      "planning",
      "pass",
      uniqueStrings([
        waveCreate.transcriptFile,
        ...collectStringRefs(waveCreate.payload),
        ...asStringArray(planningReadinessSnapshot.evidence_refs),
      ]),
      "Wave and handoff packets were materialized from the public planning flow.",
    );

    const handoffApprove = runCommand("handoff-approve", [
      "handoff",
      "approve",
      "--project-ref",
      ".",
      "--runtime-root",
      ".aor",
      "--handoff-packet",
      /** @type {string} */ (artifacts.handoff_packet_file),
      "--approval-ref",
      `approval://live-e2e/full-journey/${normalizeId(options.runId)}`,
    ]);
    artifacts.approved_handoff_packet_file = getStringField(handoffApprove.payload, "handoff_packet_file");
    if (internalTestHooks.block_approved_handoff_validation === true) {
      markStage(
        stageMap,
        "handoff",
        "fail",
        uniqueStrings([handoffApprove.transcriptFile, ...collectStringRefs(handoffApprove.payload)]),
        "Approved handoff validation was blocked by internal test hook.",
      );
      throw new Error("Approved handoff validation was blocked by internal test hook.");
    }
    let validateApproved;
    try {
      validateApproved = runCommand("project-validate-approved-handoff", [
        "project",
        "validate",
        "--project-ref",
        ".",
        "--project-profile",
        generatedProfile.generatedProjectProfileFile,
        "--runtime-root",
        ".aor",
        "--require-approved-handoff",
        "--handoff-packet",
        /** @type {string} */ (artifacts.approved_handoff_packet_file),
      ]);
    } catch (error) {
      const summary = error instanceof Error ? error.message : String(error);
      markStage(
        stageMap,
        "handoff",
        "fail",
        uniqueStrings([handoffApprove.transcriptFile]),
        summary,
      );
      throw error;
    }
    artifacts.approved_validation_report_file = getStringField(validateApproved.payload, "validation_report_file");
    markStage(
      stageMap,
      "handoff",
      "pass",
      uniqueStrings([handoffApprove.transcriptFile, validateApproved.transcriptFile, ...collectStringRefs(handoffApprove.payload)]),
      "Approved handoff validated for execution start.",
    );

    const specPacketEvidenceRef = toPacketEvidenceRef(
      targetCheckout.targetCheckoutRoot,
      "spec",
      asNonEmptyString(artifacts.spec_step_result_file),
    );
    const promotionEvidenceRefs = uniqueStrings([
      ...(artifacts.execution_readiness_file ? [/** @type {string} */ (artifacts.execution_readiness_file)] : []),
      ...(artifacts.baseline_routed_dry_run_step_result_file
        ? [/** @type {string} */ (artifacts.baseline_routed_dry_run_step_result_file)]
        : []),
      ...(specPacketEvidenceRef ? [specPacketEvidenceRef] : []),
    ]);

    const implementationLoopPolicy = resolveImplementationLoopPolicy(options.profile);
    artifacts.implementation_loop = {
      enabled: implementationLoopPolicy.enabled,
      max_iterations: implementationLoopPolicy.maxIterations,
      review_repair_actions: implementationLoopPolicy.reviewRepairActions,
      cycle_steps: implementationLoopPolicy.cycleSteps,
      repair_sources: implementationLoopPolicy.repairSources,
      proof_expectations: implementationLoopPolicy.proofExpectations,
      acceptance_repair_drill: implementationLoopPolicy.acceptanceRepairDrill,
      iterations: [],
    };
    let reviewReport = {};
    let reviewOverallStatus = "fail";
    let qaOverallStatus = "skipped";
    let featureSizeFitStatus = "fail";
    let latestPromotionEvidenceRefs = [...promotionEvidenceRefs];
    let latestImplementationRunId = options.runId;
    const evalSuites = getEvalSuites(options.profile);
    for (let iteration = 1; iteration <= implementationLoopPolicy.maxIterations; iteration += 1) {
      const iterationRunId = iteration === 1 ? options.runId : `${options.runId}.repair-${iteration}`;
      latestImplementationRunId = iterationRunId;
      artifacts.latest_implementation_run_id = iterationRunId;
      const runStart = runCommand("run-start", [
        "run",
        "start",
        "--project-ref",
        ".",
        "--project-profile",
        generatedProfile.generatedProjectProfileFile,
        "--runtime-root",
        ".aor",
        "--run-id",
        iterationRunId,
        "--target-step",
        "implement",
        "--require-validation-pass",
        "true",
        ...(artifacts.approved_handoff_packet_file
          ? ["--approved-handoff-ref", /** @type {string} */ (artifacts.approved_handoff_packet_file)]
          : []),
        ...(latestPromotionEvidenceRefs.length > 0
          ? ["--promotion-evidence-refs", latestPromotionEvidenceRefs.join(",")]
          : []),
        ...(routeOverridesFlag ? ["--route-overrides", routeOverridesFlag] : []),
        ...(policyOverridesFlag ? ["--policy-overrides", policyOverridesFlag] : []),
      ], { iteration });
      artifacts.routed_step_result_file = getStringField(runStart.payload, "routed_step_result_file");
      artifacts.routed_step_result_id = getStringField(runStart.payload, "routed_step_result_id");
      artifacts.runtime_harness_report_file = getStringField(runStart.payload, "runtime_harness_report_file");
      artifacts.runtime_harness_overall_decision = getStringField(runStart.payload, "runtime_harness_overall_decision");
      if (artifacts.runtime_harness_report_file && fileExists(artifacts.runtime_harness_report_file)) {
        artifacts.runtime_harness_overall_decision =
          asNonEmptyString(asRecord(readJson(artifacts.runtime_harness_report_file)).overall_decision) ||
          artifacts.runtime_harness_overall_decision;
      }
      artifacts.run_start_runtime_harness_report_file = artifacts.runtime_harness_report_file;
      artifacts.run_start_runtime_harness_decision = artifacts.runtime_harness_overall_decision;
      artifacts.execution_degraded = asNonEmptyString(artifacts.run_start_runtime_harness_decision) !== "pass";
      artifacts.execution_degraded_reason =
        artifacts.execution_degraded === true
          ? `Runtime Harness decision '${asNonEmptyString(artifacts.run_start_runtime_harness_decision) || "unknown"}'.`
          : null;
      if (artifacts.routed_step_result_file && fileExists(artifacts.routed_step_result_file)) {
        const stepResult = readJson(artifacts.routed_step_result_file);
        const routedExecution = asRecord(stepResult.routed_execution);
        artifacts.compiled_context_ref = asNonEmptyString(asRecord(routedExecution.context_compilation).compiled_context_ref) || null;
        artifacts.compiled_context_file = asNonEmptyString(asRecord(routedExecution.context_compilation).compiled_context_file) || null;
        const adapterOutput = asRecord(asRecord(routedExecution.adapter_response).output);
        const externalRunner = asRecord(adapterOutput.external_runner);
        artifacts.adapter_raw_evidence_ref = asNonEmptyString(externalRunner.raw_evidence_ref) || null;
        artifacts.request_artifact_ref = asNonEmptyString(externalRunner.request_artifact_ref) || null;
        artifacts.provider_work_packet_ref = asNonEmptyString(externalRunner.provider_work_packet_ref) || null;
        artifacts.context_budget_status = asNonEmptyString(externalRunner.context_budget_status) || null;
        artifacts.context_budget_failure_class = asNonEmptyString(externalRunner.context_budget_failure_class) || null;
        artifacts.raw_provider_error_summary = asNonEmptyString(externalRunner.raw_provider_error_summary) || null;
        artifacts.top_context_size_sources = Array.isArray(externalRunner.top_context_size_sources)
          ? externalRunner.top_context_size_sources
          : [];
        applyProviderExecutionFailure(artifacts, stepResult, adapterOutput);
        if (internalTestHooks.drop_adapter_raw_evidence_after_run_start === true) {
          const adapterResponse = asRecord(routedExecution.adapter_response);
          const adapterOutput = asRecord(adapterResponse.output);
          const externalRunner = asRecord(adapterOutput.external_runner);
          if (Object.prototype.hasOwnProperty.call(externalRunner, "raw_evidence_ref")) {
            delete externalRunner.raw_evidence_ref;
            adapterOutput.external_runner = externalRunner;
            adapterResponse.output = adapterOutput;
            routedExecution.adapter_response = adapterResponse;
            stepResult.routed_execution = routedExecution;
          }
          const topLevelExternalRunner = asRecord(stepResult.external_runner);
          if (Object.prototype.hasOwnProperty.call(topLevelExternalRunner, "raw_evidence_ref")) {
            delete topLevelExternalRunner.raw_evidence_ref;
            stepResult.external_runner = topLevelExternalRunner;
          }
          writeJson(artifacts.routed_step_result_file, stepResult);
          artifacts.adapter_raw_evidence_ref = null;
        }
        if (asNonEmptyString(stepResult.status) !== "passed") {
          artifacts.execution_degraded = true;
          artifacts.execution_degraded_reason = asNonEmptyString(stepResult.summary) || "Run start routed execution failed.";
        }
      } else {
        markStage(
          stageMap,
          "execution",
          "fail",
          uniqueStrings([runStart.transcriptFile, ...collectStringRefs(runStart.payload)]),
          "Run start did not materialize routed execution evidence.",
          { iteration },
        );
        throw new Error("Run start did not materialize routed execution evidence.");
      }
      const runStatus = runCommand("run-status", [
        "run",
        "status",
        "--project-ref",
        ".",
        "--runtime-root",
        ".aor",
        "--run-id",
        latestImplementationRunId,
      ], { iteration, suppressControllerPlan: true });
      artifacts.run_status_snapshot_file = runStatus.transcriptFile;

      const postRunVerify = runCommand("project-verify-post-run-primary", [
        "project",
        "verify",
        "--project-ref",
        ".",
        "--project-profile",
        generatedProfile.generatedProjectProfileFile,
        "--runtime-root",
        ".aor",
        "--require-validation-pass",
        "true",
        "--verification-label",
        "post-run-primary",
        ...(asNonEmptyString(artifacts.baseline_verify_summary_file)
          ? ["--output-quality-baseline", /** @type {string} */ (artifacts.baseline_verify_summary_file)]
          : []),
      ], { iteration, suppressControllerPlan: true });
      artifacts.post_run_verify_summary_file = getStringField(postRunVerify.payload, "verify_summary_file");
      artifacts.post_run_verify_step_result_files = getStringArrayField(postRunVerify.payload, "step_result_files");
      artifacts.post_run_primary_verify_summary_file = artifacts.post_run_verify_summary_file;
      artifacts.post_run_primary_verify_step_result_files = artifacts.post_run_verify_step_result_files;
      artifacts.verify_summary_file = artifacts.post_run_verify_summary_file;
      const postRunVerifySummaryPath = /** @type {string | null} */ (artifacts.post_run_verify_summary_file);
      if (!postRunVerifySummaryPath || !fileExists(postRunVerifySummaryPath)) {
        markStage(
          stageMap,
          "execution",
          "fail",
          uniqueStrings([postRunVerify.transcriptFile, ...collectStringRefs(postRunVerify.payload)]),
          "Post-run verify summary was not materialized.",
          { iteration },
        );
        throw new Error("Post-run verify summary was not materialized.");
      }
      const postRunVerifySummary = readJson(postRunVerifySummaryPath);
      artifacts.post_run_verify_status = asNonEmptyString(postRunVerifySummary.status) === "passed" ? "pass" : "fail";
      const runtimeHarnessStageStatus = normalizeRuntimeHarnessDecisionStatus(artifacts.run_start_runtime_harness_decision);
      const executionStageStatus = resolveExecutionStageStatusForRuntimeHarnessDecision({
        existingStageStatus: stageMap.execution?.status,
        runtimeHarnessDecision: artifacts.run_start_runtime_harness_decision,
      });
      const executionStageSummary =
        executionStageStatus === "fail" && runtimeHarnessStageStatus === "fail"
          ? `Runtime Harness blocked execution with decision '${asNonEmptyString(artifacts.run_start_runtime_harness_decision) || "unknown"}'.`
          : executionStageStatus === "fail"
          ? "Execution health evidence failed before post-run quality could be judged."
          : executionStageStatus === "warn"
            ? "Runtime Harness recorded execution findings; outcome quality must be assessed after the run from linked evidence."
            : "Baseline diagnostics, run start, run status, and post-run verification completed through public execution lifecycle.";
      markStage(
        stageMap,
        "execution",
        executionStageStatus,
        uniqueStrings([
          ...baselineEvidenceRefs,
          asNonEmptyString(artifacts.baseline_verify_summary_file),
          runStart.transcriptFile,
          runStatus.transcriptFile,
          postRunVerify.transcriptFile,
          postRunVerifySummaryPath,
          ...collectStringRefs(runStart.payload),
        ]),
        executionStageSummary,
        { iteration },
      );

      const reviewRun = runCommand("review-run", [
        "review",
        "run",
        "--project-ref",
        ".",
        "--project-profile",
        generatedProfile.generatedProjectProfileFile,
        "--runtime-root",
        ".aor",
        "--run-id",
        latestImplementationRunId,
        "--execution-root",
        targetCheckout.targetCheckoutRoot,
      ], { allowNonZeroWithPayload: true, iteration });
      artifacts.review_report_file = getStringField(reviewRun.payload, "review_report_file");
      artifacts.latest_runtime_harness_report_file =
        getStringField(reviewRun.payload, "runtime_harness_report_file") || artifacts.runtime_harness_report_file;
      artifacts.latest_runtime_harness_decision =
        getStringField(reviewRun.payload, "runtime_harness_overall_decision") ||
        artifacts.run_start_runtime_harness_decision ||
        artifacts.runtime_harness_overall_decision;
      reviewReport = artifacts.review_report_file && fileExists(artifacts.review_report_file)
        ? readJson(artifacts.review_report_file)
        : {};
      reviewOverallStatus = normalizeVerdictStatus(reviewReport.overall_status);
      featureSizeFitStatus = normalizeVerdictStatus(asRecord(reviewReport.feature_size_fit).status);
      const reviewRepairActions = new Set(implementationLoopPolicy.reviewRepairActions);
      const repairSources = new Set(implementationLoopPolicy.repairSources);
      const reviewNeedsRepair = reviewRequiresActionableRepair(reviewReport, reviewOverallStatus);
      const reviewHasNonRepairWarnings = reviewOverallStatus === "warn" && !reviewNeedsRepair;
      const primaryNeedsRepair = artifacts.post_run_verify_status === "fail";
      let repairSource = reviewNeedsRepair && repairSources.has("review")
        ? "review"
        : primaryNeedsRepair && repairSources.has("post-run-primary")
          ? "post-run-primary"
          : null;
      let activeAcceptanceRepairDrill = resolveActiveAcceptanceRepairDrill({
        drill: implementationLoopPolicy.acceptanceRepairDrill,
        iteration,
        sourcePhase: "review",
        currentRepairSource: repairSource,
        stageStatus: reviewOverallStatus,
        secondaryStatus: asNonEmptyString(artifacts.post_run_verify_status) || "unknown",
        priorRepairDecisionFiles: asStringArray(artifacts.review_repair_decision_files),
      });
      if (activeAcceptanceRepairDrill && repairSources.has("review")) {
        repairSource = "review";
        artifacts.acceptance_repair_drill_source = "review";
      }
      let repairNeeded =
        (repairSource === "review" && (reviewRepairActions.has("request-repair") || reviewRepairActions.has("repair"))) ||
        (repairSource === "post-run-primary" && reviewRepairActions.has("failed-quality-findings"));
      let canRepair =
        implementationLoopPolicy.enabled &&
        repairNeeded &&
        iteration < implementationLoopPolicy.maxIterations &&
        !(implementationLoopPolicy.stopOnBlockingReview && runtimeHarnessStageStatus === "fail");
      if (
        repairNeeded &&
        implementationLoopPolicy.enabled &&
        implementationLoopPolicy.stopOnBlockingReview &&
        runtimeHarnessStageStatus === "fail"
      ) {
        artifacts.implementation_loop_blocked = true;
        artifacts.implementation_loop_blocked_reason =
          "Runtime Harness produced a blocking execution-health finding before public repair could continue.";
      }
      let terminalCycleFailure = !canRepair && (reviewNeedsRepair || primaryNeedsRepair);
      markStage(
        stageMap,
        "review",
        canRepair ? "warn" : terminalCycleFailure ? "fail" : reviewHasNonRepairWarnings ? "warn" : "pass",
        uniqueStrings([reviewRun.transcriptFile, ...collectStringRefs(reviewRun.payload)]),
        canRepair
          ? `Review requested public repair iteration ${iteration + 1}.`
          : terminalCycleFailure
            ? asNonEmptyString(artifacts.implementation_loop_failure_summary) ||
              "Implementation review or post-run verification did not pass."
            : reviewHasNonRepairWarnings
              ? "Review report materialized with non-repair warnings; continuing to QA."
              : "Review report materialized.",
        canRepair
          ? {
              iteration,
              decisionOverride: {
                action: "retry_public_step",
                reason: `Review or verification findings require public implementation iteration ${iteration + 1}.`,
                next_step: "execution",
              },
            }
          : { iteration },
      );
      const unresolvedReviewFindings = collectReviewFindingSummaries(reviewReport);
      const unresolvedReviewFindingDetails = collectReviewFindingDetails(reviewReport);
      let unresolvedRepairFindings = [...unresolvedReviewFindings];
      let unresolvedRepairFindingDetails = [...unresolvedReviewFindingDetails];
      let repairStopReason = null;
      let repairNecessity = repairSource ?? "none";
	      let qaEvidenceRefs = uniqueStrings([
	        postRunVerifySummaryPath,
	        asNonEmptyString(artifacts.review_report_file),
	        asNonEmptyString(artifacts.runtime_harness_report_file),
	        asNonEmptyString(artifacts.latest_runtime_harness_report_file),
	        ...asStringArray(artifacts.review_repair_decision_files),
	      ]);
      let qaEvaluationStatus = "skipped";
      let qaDiagnosticStatus = "not_run";

      if (!canRepair && !terminalCycleFailure && implementationLoopPolicy.cycleSteps.includes("qa")) {
        if (evalSuites.length > 0) {
          const evalRun = runCommand("eval-run", [
            "eval",
            "run",
            "--project-ref",
            ".",
            "--project-profile",
            generatedProfile.generatedProjectProfileFile,
            "--runtime-root",
            ".aor",
            "--suite-ref",
            evalSuites[0],
            "--subject-ref",
            `run://${latestImplementationRunId}`,
          ], { allowNonZeroWithPayload: true, iteration });
          artifacts.evaluation_report_file = getStringField(evalRun.payload, "evaluation_report_file");
          artifacts.evaluation_status = getStringField(evalRun.payload, "evaluation_status") === "pass" ? "pass" : "fail";
          qaEvaluationStatus = asNonEmptyString(artifacts.evaluation_status) || "fail";
          qaEvidenceRefs = uniqueStrings([evalRun.transcriptFile, ...collectStringRefs(evalRun.payload)]);
        } else {
          artifacts.evaluation_status = "skipped";
          qaEvaluationStatus = "skipped";
        }

        const deferGuidedWarnDiagnostic =
          guidedJourneyEnabled &&
          postRunQualityPolicy.diagnosticFailureMode === "warn" &&
          postRunQualityPolicy.diagnosticCommands.length > 0;
        if (postRunQualityPolicy.diagnosticCommands.length > 0 && !deferGuidedWarnDiagnostic) {
          const postRunDiagnosticVerify = runPostRunDiagnosticVerify({ iteration });
          qaDiagnosticStatus = asNonEmptyString(artifacts.post_run_diagnostic_status) || "fail";
          qaEvidenceRefs = uniqueStrings([
            ...qaEvidenceRefs,
            postRunDiagnosticVerify.transcriptFile,
            asNonEmptyString(artifacts.post_run_diagnostic_verify_summary_file),
            ...asStringArray(artifacts.post_run_diagnostic_verify_step_result_files),
          ]);
        } else if (deferGuidedWarnDiagnostic) {
          artifacts.post_run_diagnostic_status = "deferred";
          artifacts.post_run_diagnostic_deferred_until_guided_proof = true;
          qaDiagnosticStatus = "deferred";
          qaEvidenceRefs = uniqueStrings([
            ...qaEvidenceRefs,
            "diagnostic://post-run-diagnostic-deferred-until-guided-proof",
          ]);
        } else {
          artifacts.post_run_diagnostic_status = "pass";
          qaDiagnosticStatus = "pass";
        }

        const qaNeedsRepair = qaEvaluationStatus === "fail";
        const diagnosticNeedsRepair = qaDiagnosticStatus === "fail";
        repairSource = qaNeedsRepair && repairSources.has("qa")
          ? "qa"
          : diagnosticNeedsRepair && repairSources.has("post-run-diagnostic")
            ? "post-run-diagnostic"
            : null;
        activeAcceptanceRepairDrill = resolveActiveAcceptanceRepairDrill({
          drill: implementationLoopPolicy.acceptanceRepairDrill,
          iteration,
          sourcePhase: "qa",
          currentRepairSource: repairSource,
          stageStatus: qaEvaluationStatus,
          secondaryStatus: qaDiagnosticStatus,
          priorRepairDecisionFiles: asStringArray(artifacts.review_repair_decision_files),
        });
        if (activeAcceptanceRepairDrill && repairSources.has("qa")) {
          repairSource = "qa";
          artifacts.acceptance_repair_drill_source = "qa";
        }
        repairNeeded =
          (repairSource === "qa" && (reviewRepairActions.has("request-repair") || reviewRepairActions.has("repair"))) ||
          (repairSource === "post-run-diagnostic" && reviewRepairActions.has("failed-quality-findings"));
        canRepair =
          implementationLoopPolicy.enabled &&
          repairNeeded &&
          iteration < implementationLoopPolicy.maxIterations &&
          !(implementationLoopPolicy.stopOnBlockingReview && runtimeHarnessStageStatus === "fail");
        terminalCycleFailure = !canRepair && (qaNeedsRepair || diagnosticNeedsRepair);
        qaOverallStatus = canRepair ? "warn" : terminalCycleFailure ? "fail" : "pass";
        unresolvedRepairFindings = uniqueStrings([
          ...unresolvedRepairFindings,
          qaNeedsRepair ? `QA evaluation status '${qaEvaluationStatus}' did not pass.` : "",
          diagnosticNeedsRepair ? `Post-run diagnostic status '${qaDiagnosticStatus}' did not pass.` : "",
        ]);
        unresolvedRepairFindingDetails = [
          ...unresolvedRepairFindingDetails,
          ...(qaNeedsRepair
            ? [
                {
                  finding_id: `qa.${iteration}.evaluation-status`,
                  category: "qa",
                  severity: "blocking",
                  summary: `QA evaluation status '${qaEvaluationStatus}' did not pass.`,
                  evidence_refs: qaEvidenceRefs,
                  resolution_requirement:
                    "Repair the product change so the next QA evaluation passes, or provide fresh evidence that the QA finding is stale.",
                },
              ]
            : []),
          ...(diagnosticNeedsRepair
            ? [
                {
                  finding_id: `qa.${iteration}.post-run-diagnostic-status`,
                  category: "post-run-diagnostic",
                  severity: "blocking",
                  summary: `Post-run diagnostic status '${qaDiagnosticStatus}' did not pass.`,
                  evidence_refs: qaEvidenceRefs,
                  resolution_requirement:
                    "Repair the product change or diagnostic setup so post-run diagnostic verification passes, or provide fresh evidence that this diagnostic is non-blocking.",
                },
              ]
            : []),
        ];
        markStage(
          stageMap,
          "qa",
          qaOverallStatus,
          qaEvidenceRefs,
          canRepair
            ? `QA requested public repair iteration ${iteration + 1}.`
            : terminalCycleFailure
              ? "QA or post-run diagnostic evidence did not pass."
              : qaDiagnosticStatus === "deferred"
                ? "Evaluation passed; non-blocking diagnostic QA evidence was deferred until guided UI proof materializes."
                : "Evaluation and diagnostic QA evidence passed.",
          canRepair
            ? {
                iteration,
                decisionOverride: {
                  action: "retry_public_step",
                  reason: `QA or diagnostic findings require public implementation iteration ${iteration + 1}.`,
                  next_step: "execution",
                },
              }
            : { iteration },
        );
      } else if (!canRepair && !terminalCycleFailure) {
        qaOverallStatus = "skipped";
        artifacts.evaluation_status = "skipped";
        artifacts.post_run_diagnostic_status = "pass";
        markStage(stageMap, "qa", "skipped", [], "Profile quality-cycle policy excludes QA.", { iteration });
      }

      if (terminalCycleFailure) {
        const repairLoopExhausted = implementationLoopPolicy.enabled && iteration >= implementationLoopPolicy.maxIterations;
        const failureSource =
          repairSource ||
          (reviewNeedsRepair ? "review" : primaryNeedsRepair ? "post-run-primary" : qaOverallStatus === "fail" ? "qa" : "unknown");
        artifacts.failure_owner =
          asNonEmptyString(artifacts.failure_owner) ||
          (failureSource === "review" ? "provider" : "target_repository");
        artifacts.failure_phase =
          asNonEmptyString(artifacts.failure_phase) ||
          (failureSource === "review" ? "review" : failureSource === "qa" ? "qa" : "target_verification");
        artifacts.failure_class =
          asNonEmptyString(artifacts.failure_class) ||
          (repairLoopExhausted
            ? failureSource === "qa" || failureSource === "post-run-diagnostic"
              ? "qa_repair_loop_exhausted"
              : failureSource === "review"
                ? "review_repair_loop_exhausted"
                : "post_run_verification_failed"
            : failureSource === "review"
              ? "review_quality_not_approved"
              : failureSource === "qa"
                ? "qa_quality_not_approved"
                : "post_run_verification_failed");
        artifacts.implementation_loop_failure_summary =
          failureSource === "review"
            ? "Implementation quality cycle stopped because review did not pass."
            : failureSource === "qa"
              ? "Implementation quality cycle stopped because QA did not pass."
              : failureSource === "post-run-diagnostic"
                ? "Implementation quality cycle stopped because post-run diagnostic verification did not pass."
                : "Implementation quality cycle stopped because post-run primary verification did not pass.";
        repairStopReason = artifacts.implementation_loop_failure_summary;
      }
      if (canRepair) {
        repairStopReason =
          repairSource === "qa"
            ? "QA evidence requested another public implementation iteration."
            : repairSource === "post-run-diagnostic"
              ? "Post-run diagnostic verification requested another public implementation iteration."
              : repairSource === "post-run-primary"
                ? "Post-run primary verification requested another public implementation iteration."
                : "Review requested another public implementation iteration.";
        repairNecessity = repairSource ?? "review";
      }
      const repairChangedPaths = uniqueStrings([
        ...collectRuntimeHarnessChangedPaths(artifacts.runtime_harness_report_file),
        ...collectReviewChangedPaths(artifacts.review_report_file),
      ]);
      const repairVerificationRefs = uniqueStrings([
        postRunVerifySummaryPath,
        asNonEmptyString(artifacts.review_report_file),
        asNonEmptyString(artifacts.evaluation_report_file),
        asNonEmptyString(artifacts.post_run_diagnostic_verify_summary_file),
        ...asStringArray(artifacts.post_run_diagnostic_verify_step_result_files),
      ]);
      if (activeAcceptanceRepairDrill) {
        const drillFinding = buildAcceptanceRepairDrillFinding({
          drill: activeAcceptanceRepairDrill,
          sourcePhase: repairSource ?? asNonEmptyString(activeAcceptanceRepairDrill.source_phase) ?? "review",
          iteration,
          evidenceRefs: repairVerificationRefs,
        });
        unresolvedRepairFindings = uniqueStrings([
          ...unresolvedRepairFindings,
          asNonEmptyString(drillFinding.summary),
        ]);
        unresolvedRepairFindingDetails = [
          ...unresolvedRepairFindingDetails,
          drillFinding,
        ];
      }
      const previousRepairDecisionRefs = asStringArray(artifacts.review_repair_decision_files);
      const previousRepairContexts = readRepairDecisionContexts(previousRepairDecisionRefs);
      const previousRepairContext = previousRepairContexts.at(-1) ?? null;
      let pendingRepairContext = null;
      let pendingRepairContextFingerprint = null;
      let newRepairContextSignals = [];
      if (canRepair) {
        const repairFindingDetails = unresolvedRepairFindingDetails.map((entry, index) => {
          const record = asRecord(entry);
          const verificationFailureDetails = normalizeVerificationFailureDetails(record.verification_failure_details);
          const detail = {
            finding_id:
              asNonEmptyString(record.finding_id) ||
              `${repairSource ?? "review"}.${iteration}.finding-${index + 1}`,
            category: asNonEmptyString(record.category) || repairSource || "review",
            severity: asNonEmptyString(record.severity) || "blocking",
            summary: asNonEmptyString(record.summary) || "Repair was requested before delivery.",
            evidence_refs: uniqueStrings([
              ...asStringArray(record.evidence_refs),
              ...asStringArray(record.evidenceRefs),
              ...verificationFailureDetails.flatMap((findingDetail) => asStringArray(findingDetail.evidence_refs)),
              ...repairVerificationRefs,
            ]),
            resolution_requirement:
              asNonEmptyString(record.resolution_requirement) ||
              "Complete the requested repair through the next public execution iteration and include explicit closure evidence.",
          };
          if (verificationFailureDetails.length > 0) {
            detail.verification_failure_details = verificationFailureDetails;
          }
          return detail;
        });
        pendingRepairContext = {
          source_phase: repairSource ?? "review",
          cycle_iteration: iteration,
          unresolved_findings: unresolvedRepairFindings.length > 0
            ? unresolvedRepairFindings
            : ["Repair was requested before delivery."],
          unresolved_finding_details: repairFindingDetails.length > 0
            ? repairFindingDetails
            : [
                {
                  finding_id: `${repairSource ?? "review"}.${iteration}.unspecified-repair`,
                  category: repairSource ?? "review",
                  severity: "blocking",
                  summary: "Repair was requested before delivery.",
                  evidence_refs: repairVerificationRefs,
                  resolution_requirement:
                    "Complete the requested repair through the next public execution iteration and include explicit closure evidence.",
                },
              ],
          meaningful_changed_paths: repairChangedPaths,
          verification_status:
            repairSource === "qa"
              ? qaEvaluationStatus
              : repairSource === "post-run-diagnostic"
                ? qaDiagnosticStatus
                : asNonEmptyString(artifacts.post_run_verify_status) || "unknown",
          verification_refs: repairVerificationRefs,
          previous_repair_decision_refs: previousRepairDecisionRefs,
          stop_reason: repairStopReason || "Repair requested before delivery.",
          requested_next_step: "execution",
        };
        pendingRepairContextFingerprint = repairContextFingerprint(pendingRepairContext);
        newRepairContextSignals = resolveNewRepairContextSignals(previousRepairContext, pendingRepairContext);
        pendingRepairContext.context_fingerprint = pendingRepairContextFingerprint;
        pendingRepairContext.new_context_since_previous = newRepairContextSignals;
        const previousFingerprint = asNonEmptyString(asRecord(previousRepairContext).context_fingerprint);
        if (previousFingerprint && previousFingerprint === pendingRepairContextFingerprint && newRepairContextSignals.length === 0) {
          canRepair = false;
          terminalCycleFailure = true;
          artifacts.failure_owner = "provider";
          artifacts.failure_phase = repairSource === "qa" ? "qa" : repairSource === "post-run-diagnostic" ? "target_verification" : "review";
          artifacts.failure_class = classifyRepeatedRepairContextBlocker({
            repairSource,
            pendingRepairContext,
            artifacts,
            newRepairContextSignals,
          });
          artifacts.implementation_loop_failure_summary =
            "Implementation quality cycle stopped because repeated repair context had no new actionable evidence.";
          repairStopReason = artifacts.implementation_loop_failure_summary;
          markStage(
            stageMap,
            repairSource === "qa" || repairSource === "post-run-diagnostic" ? "qa" : "review",
            "fail",
            repairVerificationRefs,
            artifacts.implementation_loop_failure_summary,
            { iteration },
          );
        }
        artifacts.latest_repair_context_fingerprint = pendingRepairContextFingerprint;
        artifacts.latest_repair_context_new_signals = newRepairContextSignals;
      }
      const iterationRecord = {
        iteration,
        run_id: iterationRunId,
        routed_step_result_file: asNonEmptyString(artifacts.routed_step_result_file) || null,
        post_run_verify_summary_file: postRunVerifySummaryPath,
        review_report_file: asNonEmptyString(artifacts.review_report_file) || null,
        runtime_harness_report_file: asNonEmptyString(artifacts.runtime_harness_report_file) || null,
        runtime_harness_decision: asNonEmptyString(artifacts.runtime_harness_overall_decision) || null,
        review_status: reviewOverallStatus,
        review_recommendation: asNonEmptyString(reviewReport.review_recommendation) || null,
        feature_size_fit_status: featureSizeFitStatus,
        post_run_verify_status: asNonEmptyString(artifacts.post_run_verify_status),
        qa_status: qaOverallStatus,
        evaluation_status: qaEvaluationStatus,
        evaluation_report_file: asNonEmptyString(artifacts.evaluation_report_file) || null,
        post_run_diagnostic_verify_summary_file: asNonEmptyString(artifacts.post_run_diagnostic_verify_summary_file) || null,
        post_run_diagnostic_status: qaDiagnosticStatus,
        repair_source: repairSource,
        repair_necessity: repairNecessity,
        unresolved_review_findings: unresolvedReviewFindings,
        unresolved_review_finding_details: unresolvedReviewFindingDetails,
        unresolved_repair_findings: unresolvedRepairFindings,
        unresolved_repair_finding_details: unresolvedRepairFindingDetails,
        previous_repair_decision_files: previousRepairDecisionRefs,
        repair_context_fingerprint: pendingRepairContextFingerprint,
        new_context_since_previous: newRepairContextSignals,
        repair_stop_reason: repairStopReason,
        acceptance_repair_drill: activeAcceptanceRepairDrill
          ? {
              source_phase: asNonEmptyString(activeAcceptanceRepairDrill.source_phase),
              finding_id: asNonEmptyString(activeAcceptanceRepairDrill.finding_id),
            }
          : null,
        repair_requested: canRepair,
      };
      {
        const currentIterations = Array.isArray(asRecord(artifacts.implementation_loop).iterations)
          ? asRecord(artifacts.implementation_loop).iterations
          : [];
        asRecord(artifacts.implementation_loop).iterations = [...currentIterations, iterationRecord];
      }
      if (!canRepair) {
        if (
          (repairNeeded ||
            reviewOverallStatus === "fail" ||
            qaOverallStatus === "fail" ||
            artifacts.post_run_verify_status === "fail") &&
          implementationLoopPolicy.enabled &&
          iteration >= implementationLoopPolicy.maxIterations
        ) {
          artifacts.implementation_loop_exhausted = true;
        }
        break;
      }
	      const repairContextFile = path.join(
	        options.layout.reportsRoot,
	        `review-repair-context-${normalizeId(options.runId)}-${iteration}.json`,
	      );
	      writeJson(repairContextFile, asRecord(pendingRepairContext));
	      artifacts.latest_repair_context_file = repairContextFile;
	      const reviewRepairDecision = runCommand("review-decide-request-repair", [
	        "review",
        "decide",
        "--project-ref",
        ".",
        "--project-profile",
        generatedProfile.generatedProjectProfileFile,
        "--runtime-root",
        ".aor",
        "--run-id",
        latestImplementationRunId,
        "--execution-root",
        targetCheckout.targetCheckoutRoot,
        "--decision",
        "request-repair",
        "--decider-ref",
        "operator://live-e2e-step-controller",
	        "--repair-context-file",
	        repairContextFile,
        "--reason",
        [
          `Live E2E quality-cycle iteration ${iteration} requested public repair before delivery.`,
          `Repair necessity: ${repairNecessity}.`,
          unresolvedRepairFindings.length > 0
            ? `Unresolved findings: ${unresolvedRepairFindings.slice(0, 5).join(" | ")}.`
            : "Unresolved findings were not summarized by the quality cycle.",
          `Post-run verification status: ${asNonEmptyString(artifacts.post_run_verify_status) || "unknown"}.`,
          `QA status: ${qaOverallStatus}.`,
          `Runtime Harness decision: ${asNonEmptyString(artifacts.runtime_harness_overall_decision) || "unknown"}.`,
        ].join(" "),
      ], { allowNonZeroWithPayload: true, iteration });
      const reviewRepairDecisionFile = getStringField(reviewRepairDecision.payload, "review_decision_file");
      const qualityRepairRequestRef = getStringField(reviewRepairDecision.payload, "quality_repair_request_ref");
      const qualityRepairRequestFile = getStringField(reviewRepairDecision.payload, "quality_repair_request_file");
      artifacts.review_repair_decision_files = uniqueStrings([
        ...asStringArray(artifacts.review_repair_decision_files),
        reviewRepairDecisionFile,
      ]);
      artifacts.quality_repair_request_refs = uniqueStrings([
        ...asStringArray(artifacts.quality_repair_request_refs),
        qualityRepairRequestRef,
      ]);
      artifacts.quality_repair_request_files = uniqueStrings([
        ...asStringArray(artifacts.quality_repair_request_files),
        qualityRepairRequestFile,
      ]);
      const loopIterations = Array.isArray(asRecord(artifacts.implementation_loop).iterations)
        ? asRecord(artifacts.implementation_loop).iterations.map((entry) => asRecord(entry))
        : [];
      if (loopIterations.length > 0) {
        const lastIteration = {
          ...asRecord(loopIterations.at(-1)),
          repair_decision_file: reviewRepairDecisionFile,
          quality_repair_request_ref: qualityRepairRequestRef,
          quality_repair_request_file: qualityRepairRequestFile,
        };
        asRecord(artifacts.implementation_loop).iterations = [
          ...loopIterations.slice(0, -1),
          lastIteration,
        ];
      }
      latestPromotionEvidenceRefs = uniqueStrings([
        ...promotionEvidenceRefs,
        asNonEmptyString(artifacts.routed_step_result_file),
        postRunVerifySummaryPath,
        asNonEmptyString(artifacts.review_report_file),
        reviewRepairDecisionFile,
      ]);
    }
    {
      const loopIterations = Array.isArray(asRecord(artifacts.implementation_loop).iterations)
        ? asRecord(artifacts.implementation_loop).iterations
        : [];
      if (loopIterations.length >= implementationLoopPolicy.maxIterations) {
        const lastIteration = asRecord(loopIterations.at(-1));
        if (
          artifacts.implementation_loop_blocked === true ||
          lastIteration.repair_requested === true ||
          reviewOverallStatus !== "pass" ||
          qaOverallStatus === "fail" ||
          artifacts.post_run_verify_status === "fail"
        ) {
          artifacts.implementation_loop_exhausted = true;
        }
      }
    }
    if (artifacts.implementation_loop_blocked === true) {
      throw new Error("Implementation repair loop blocked by runtime health evidence before review and verification passed.");
    }
    if (artifacts.implementation_loop_exhausted === true) {
      throw new Error("Implementation quality cycle exhausted before review, QA, and verification passed.");
    }
    if (reviewOverallStatus !== "pass" && !reviewRequiresActionableRepair(reviewReport, reviewOverallStatus)) {
      artifacts.failure_owner = asNonEmptyString(artifacts.failure_owner) || "provider";
      artifacts.failure_phase = asNonEmptyString(artifacts.failure_phase) || "review";
      artifacts.failure_class =
        asNonEmptyString(artifacts.failure_class) ||
        classifyNonRepairReviewBlocker({
          reviewReport,
          artifacts,
        });
      artifacts.implementation_loop_failure_summary =
        asNonEmptyString(artifacts.implementation_loop_failure_summary) ||
        "Implementation quality cycle stopped on non-repair review evidence before delivery.";
      throw new Error(artifacts.implementation_loop_failure_summary);
    }
    if (reviewOverallStatus !== "pass" || qaOverallStatus === "fail" || artifacts.post_run_verify_status === "fail") {
      throw new Error("Implementation review, QA, or post-run verification failed before delivery.");
    }
    if (asStringArray(artifacts.review_repair_decision_files).length > 0) {
      const repairClosure = closeSatisfiedQualityRepairRequests({
        artifacts,
        projectRoot: targetCheckout.targetCheckoutRoot,
        runtimeLayout: options.layout,
        evidenceRefs: uniqueStrings([
          asNonEmptyString(artifacts.review_report_file),
          asNonEmptyString(artifacts.evaluation_report_file),
          asNonEmptyString(artifacts.post_run_verify_summary_file),
          asNonEmptyString(artifacts.post_run_diagnostic_verify_summary_file),
          ...asStringArray(artifacts.review_repair_decision_files),
        ]),
      });
      artifacts.closed_quality_repair_request_refs = uniqueStrings([
        ...asStringArray(artifacts.closed_quality_repair_request_refs),
        ...repairClosure.closed_refs,
      ]);
      artifacts.closed_quality_repair_request_files = uniqueStrings([
        ...asStringArray(artifacts.closed_quality_repair_request_files),
        ...repairClosure.closed_files,
      ]);
    }
    if (guidedJourneyEnabled) {
      const guidedNextAfterReview = runCommand("guided-next-after-review", [
        "next",
        "--project-ref",
        ".",
        "--project-profile",
        generatedProfile.generatedProjectProfileFile,
        "--runtime-root",
        ".aor",
        "--json",
      ]);
      artifacts.next_action_report_file = getStringField(guidedNextAfterReview.payload, "next_action_report_file");
      artifacts.guided_next_after_review_transcript_file = guidedNextAfterReview.transcriptFile;

      const reviewDecision = runCommand("review-decide-approve", [
        "review",
        "decide",
        "--project-ref",
        ".",
        "--project-profile",
        generatedProfile.generatedProjectProfileFile,
        "--runtime-root",
        ".aor",
        "--run-id",
        latestImplementationRunId,
        "--execution-root",
        targetCheckout.targetCheckoutRoot,
        "--decision",
        "approve",
        "--decider-ref",
        "operator://installed-user-guided-proof",
        "--reason",
        "Approved by installed-user guided proof after review evidence materialized.",
      ]);
      artifacts.review_decision_file = getStringField(reviewDecision.payload, "review_decision_file");
      artifacts.guided_review_decision_transcript_file = reviewDecision.transcriptFile;
    }

    const harnessCertification = getHarnessCertification(options.profile);
    /** @type {string[]} */
    const deliveryEvidenceRefs = uniqueStrings([
      ...(artifacts.routed_step_result_file ? [artifacts.routed_step_result_file] : []),
      ...(artifacts.evaluation_report_file ? [artifacts.evaluation_report_file] : []),
    ]);
    if (harnessCertification) {
      const certify = runCommand("delivery-harness-certify", [
        "harness",
        "certify",
        "--project-ref",
        ".",
        "--project-profile",
        generatedProfile.generatedProjectProfileFile,
        "--runtime-root",
        ".aor",
        "--asset-ref",
        harnessCertification.assetRef,
        "--subject-ref",
        harnessCertification.subjectRef,
        "--suite-ref",
        harnessCertification.suiteRef,
        "--step-class",
        harnessCertification.stepClass,
      ]);
      artifacts.promotion_decision_file = getStringField(certify.payload, "promotion_decision_file");
      if (artifacts.promotion_decision_file) {
        deliveryEvidenceRefs.push(artifacts.promotion_decision_file);
      }
      if (getStringField(certify.payload, "promotion_decision_status") !== "pass") {
        throw new Error("Harness certification did not pass.");
      }
    }

    let deliverPrepare;
    try {
      deliverPrepare = runCommand("deliver-prepare", [
        "deliver",
        "prepare",
        "--project-ref",
        ".",
        "--project-profile",
        generatedProfile.generatedProjectProfileFile,
        "--runtime-root",
        ".aor",
        "--run-id",
        latestImplementationRunId,
        "--step-class",
        "implement",
        "--mode",
        getPreferredDeliveryMode(options.profile),
        "--quality-gate-mode",
        "observe",
        ...(artifacts.approved_handoff_packet_file
          ? ["--approved-handoff-ref", /** @type {string} */ (artifacts.approved_handoff_packet_file)]
          : []),
        ...(deliveryEvidenceRefs.length > 0 ? ["--promotion-evidence-refs", deliveryEvidenceRefs.join(",")] : []),
        ...(guidedJourneyEnabled ? ["--require-review-decision"] : []),
      ], { allowNonZeroWithPayload: true });
    } catch (error) {
      const summary = error instanceof Error ? error.message : String(error);
      const lowerSummary = summary.toLowerCase();
      artifacts.delivery_blocking = true;
      artifacts.delivery_blocked_by_quality_gate =
        lowerSummary.includes("runtime harness") || lowerSummary.includes("quality gate");
      artifacts.delivery_blocking_reasons = [summary];
      markStage(
        stageMap,
        "delivery",
        "fail",
        [],
        artifacts.delivery_blocked_by_quality_gate === true
          ? "Delivery prepare was blocked by quality/runtime harness gate."
          : summary,
      );
    }
    if (!deliverPrepare) {
      throw new Error("Delivery prepare did not materialize delivery evidence.");
    }
    if (deliverPrepare) {
      const deliveryRuntimeHarnessReportFile = getStringField(deliverPrepare.payload, "runtime_harness_report_file");
      artifacts.delivery_manifest_file = getStringField(deliverPrepare.payload, "delivery_manifest_file");
      artifacts.delivery_plan_file = getStringField(deliverPrepare.payload, "delivery_plan_file");
      artifacts.delivery_transcript_file = getStringField(deliverPrepare.payload, "delivery_transcript_file");
      artifacts.delivery_runtime_harness_report_file = deliveryRuntimeHarnessReportFile;
      artifacts.runtime_harness_report_file =
        asNonEmptyString(artifacts.runtime_harness_report_file) || deliveryRuntimeHarnessReportFile;
      artifacts.delivery_quality_gate_mode = getStringField(deliverPrepare.payload, "delivery_quality_gate_mode");
      artifacts.delivery_quality_gate_status = getStringField(deliverPrepare.payload, "delivery_quality_gate_status");
      artifacts.delivery_quality_gate_findings = asStringArray(deliverPrepare.payload?.delivery_quality_gate_findings);
      if (internalTestHooks.block_delivery_prepare === true) {
        deliverPrepare.payload.delivery_blocking = true;
      }
      artifacts.delivery_blocking = deliverPrepare.payload?.delivery_blocking === true;
      artifacts.delivery_blocking_reasons = asStringArray(deliverPrepare.payload?.delivery_blocking_reasons);
      artifacts.delivery_blocked_by_quality_gate =
        artifacts.delivery_blocking === true &&
        artifacts.delivery_blocking_reasons.some((reason) =>
          /runtime harness|quality gate/iu.test(reason),
        );
      markStage(
        stageMap,
        "delivery",
        artifacts.delivery_manifest_file
          ? artifacts.delivery_blocking === true || artifacts.delivery_quality_gate_status === "not_pass"
            ? "warn"
            : "pass"
          : "fail",
        uniqueStrings([deliverPrepare.transcriptFile, ...collectStringRefs(deliverPrepare.payload)]),
        artifacts.delivery_manifest_file
          ? artifacts.delivery_blocking === true || artifacts.delivery_quality_gate_status === "not_pass"
            ? "Delivery evidence materialized with observed quality findings."
            : "Delivery prepare materialized delivery evidence."
          : "Delivery prepare did not materialize delivery evidence.",
      );
      if (!artifacts.delivery_manifest_file) {
        throw new Error("Delivery prepare did not materialize delivery evidence.");
      }
    }

    if (guidedJourneyEnabled) {
      const guidedNextAfterDelivery = runCommand("guided-next-after-delivery", [
        "next",
        "--project-ref",
        ".",
        "--project-profile",
        generatedProfile.generatedProjectProfileFile,
        "--runtime-root",
        ".aor",
        "--json",
      ]);
      artifacts.next_action_report_file = getStringField(guidedNextAfterDelivery.payload, "next_action_report_file");
      artifacts.guided_next_after_delivery_transcript_file = guidedNextAfterDelivery.transcriptFile;

      if (internalTestHooks.fail_release_prepare === true) {
        artifacts.release_status = "fail";
        markStage(stageMap, "release", "fail", [], "Release prepare failed before release-packet evidence materialized.");
        throw new Error("Release prepare did not materialize release-packet evidence.");
      }

      const releasePrepare = runCommand("release-prepare", [
        "release",
        "prepare",
        "--project-ref",
        ".",
        "--project-profile",
        generatedProfile.generatedProjectProfileFile,
        "--runtime-root",
        ".aor",
        "--run-id",
        latestImplementationRunId,
        "--step-class",
        "implement",
        "--mode",
        getPreferredDeliveryMode(options.profile),
        "--require-review-decision",
        ...(artifacts.approved_handoff_packet_file
          ? ["--approved-handoff-ref", /** @type {string} */ (artifacts.approved_handoff_packet_file)]
          : []),
        ...(deliveryEvidenceRefs.length > 0 ? ["--promotion-evidence-refs", deliveryEvidenceRefs.join(",")] : []),
      ], { allowNonZeroWithPayload: true });
      artifacts.release_delivery_manifest_file = getStringField(releasePrepare.payload, "delivery_manifest_file");
      artifacts.release_delivery_transcript_file = getStringField(releasePrepare.payload, "delivery_transcript_file");
      artifacts.release_packet_file = getStringField(releasePrepare.payload, "release_packet_file");
      artifacts.release_packet_status = getStringField(releasePrepare.payload, "release_packet_status");
      artifacts.guided_release_prepare_transcript_file = releasePrepare.transcriptFile;
      artifacts.release_status = artifacts.release_packet_file ? "pass" : "fail";
      markStage(
        stageMap,
        "release",
        artifacts.release_status,
        uniqueStrings([releasePrepare.transcriptFile, ...collectStringRefs(releasePrepare.payload)]),
        artifacts.release_packet_file
          ? "Release prepare materialized release packet evidence under the review gate."
          : "Release prepare did not materialize release packet evidence.",
      );
      if (!artifacts.release_packet_file) {
        throw new Error("Release prepare did not materialize release packet evidence.");
      }
    } else if (options.scenarioPolicy.release_required === true && getProfileStages(options.profile).includes("release")) {
      if (internalTestHooks.fail_release_prepare === true) {
        artifacts.release_status = "fail";
        markStage(stageMap, "release", "fail", [], "Release prepare failed before release-packet evidence materialized.");
        throw new Error("Release prepare did not materialize release-packet evidence.");
      }

      const releasePrepare = runCommand("release-prepare", [
        "release",
        "prepare",
        "--project-ref",
        ".",
        "--project-profile",
        generatedProfile.generatedProjectProfileFile,
        "--runtime-root",
        ".aor",
        "--run-id",
        latestImplementationRunId,
        "--step-class",
        "implement",
        "--mode",
        getPreferredDeliveryMode(options.profile),
        ...(artifacts.approved_handoff_packet_file
          ? ["--approved-handoff-ref", /** @type {string} */ (artifacts.approved_handoff_packet_file)]
          : []),
        ...(deliveryEvidenceRefs.length > 0 ? ["--promotion-evidence-refs", deliveryEvidenceRefs.join(",")] : []),
      ], { allowNonZeroWithPayload: true });
      artifacts.release_delivery_manifest_file = getStringField(releasePrepare.payload, "delivery_manifest_file");
      artifacts.release_delivery_transcript_file = getStringField(releasePrepare.payload, "delivery_transcript_file");
      artifacts.release_packet_file = getStringField(releasePrepare.payload, "release_packet_file");
      artifacts.release_packet_status = getStringField(releasePrepare.payload, "release_packet_status");
      artifacts.release_prepare_transcript_file = releasePrepare.transcriptFile;
      artifacts.release_status = artifacts.release_packet_file ? "pass" : "fail";
      markStage(
        stageMap,
        "release",
        artifacts.release_status,
        uniqueStrings([releasePrepare.transcriptFile, ...collectStringRefs(releasePrepare.payload)]),
        artifacts.release_packet_file
          ? "Release prepare materialized strict release-packet evidence."
          : "Release prepare did not materialize strict release-packet evidence.",
      );
    } else {
      artifacts.release_status = options.scenarioPolicy.release_required === true ? "fail" : "skipped";
      markStage(stageMap, "release", "skipped", [], "Delivery-default flow range excludes release.");
    }

    const auditRuns = runCommand("audit-runs", [
      "audit",
      "runs",
      "--project-ref",
      ".",
      "--project-profile",
      generatedProfile.generatedProjectProfileFile,
      "--runtime-root",
      ".aor",
      "--run-id",
      latestImplementationRunId,
    ]);
    artifacts.run_audit_file = auditRuns.transcriptFile;
    const auditPayload = asRecord(auditRuns.payload);
    if (internalTestHooks.corrupt_audit_coverage_follow_up === true) {
      const auditRecords = Array.isArray(auditPayload.run_audit_records) ? auditPayload.run_audit_records : [];
      const auditRecord =
        auditRecords.map((record) => asRecord(record)).find((record) => asNonEmptyString(record.run_id) === options.runId) ||
        asRecord(auditRecords[0]);
      if (hasObjectFields(auditRecord)) {
        auditRecord.coverage_follow_up = {
          current_cell_required: false,
          remaining_required_matrix_cells: [],
        };
      }
    }

    let incidentOpen = null;
    if (reviewOverallStatus === "fail") {
      incidentOpen = runCommand("incident-open", [
        "incident",
        "open",
        "--project-ref",
        ".",
        "--project-profile",
        generatedProfile.generatedProjectProfileFile,
        "--runtime-root",
        ".aor",
        "--run-id",
        latestImplementationRunId,
        "--summary",
        "Full-journey review verdict failed.",
      ]);
      artifacts.incident_report_file = getStringField(incidentOpen.payload, "incident_report_file");
    }

    let learningHandoff;
    try {
      learningHandoff = runCommand("learning-handoff", [
        "learning",
        "handoff",
        "--project-ref",
        ".",
        "--project-profile",
        generatedProfile.generatedProjectProfileFile,
        "--runtime-root",
        ".aor",
        "--run-id",
        latestImplementationRunId,
      ]);
    } catch (error) {
      const summary = error instanceof Error ? error.message : String(error);
      markStage(stageMap, "learning", "fail", [], summary);
      throw error;
    }
    if (internalTestHooks.drop_learning_handoff_outputs === true) {
      delete learningHandoff.payload.learning_loop_handoff_file;
    }
    artifacts.learning_loop_scorecard_file = getStringField(learningHandoff.payload, "learning_loop_scorecard_file");
    artifacts.learning_loop_handoff_file = getStringField(learningHandoff.payload, "learning_loop_handoff_file");
    artifacts.latest_runtime_harness_report_file =
      getStringField(learningHandoff.payload, "runtime_harness_report_file") ||
      artifacts.latest_runtime_harness_report_file ||
      artifacts.runtime_harness_report_file;
    artifacts.latest_runtime_harness_decision =
      getStringField(learningHandoff.payload, "runtime_harness_overall_decision") ||
      artifacts.latest_runtime_harness_decision ||
      artifacts.run_start_runtime_harness_decision ||
      artifacts.runtime_harness_overall_decision;
    artifacts.incident_report_file =
      getStringField(learningHandoff.payload, "incident_report_file") ||
      artifacts.incident_report_file ||
      null;
    if (!artifacts.learning_loop_scorecard_file || !artifacts.learning_loop_handoff_file) {
      markStage(
        stageMap,
        "learning",
        "fail",
        uniqueStrings([learningHandoff.transcriptFile, ...collectStringRefs(learningHandoff.payload)]),
        "Learning handoff did not materialize the required public closure artifacts.",
      );
      throw new Error("Learning handoff did not materialize the required public closure artifacts.");
    }
    if (internalTestHooks.corrupt_learning_scorecard_coverage_follow_up === true) {
      const learningScorecard = asRecord(readJson(artifacts.learning_loop_scorecard_file));
      learningScorecard.coverage_follow_up = {
        current_cell_required: false,
        remaining_required_matrix_cells: [],
      };
      writeJson(artifacts.learning_loop_scorecard_file, learningScorecard);
    }
    if (guidedJourneyEnabled) {
      const guidedNextAfterLearning = runCommand("guided-next-after-learning", [
        "next",
        "--project-ref",
        ".",
        "--project-profile",
        generatedProfile.generatedProjectProfileFile,
        "--runtime-root",
        ".aor",
        "--json",
      ]);
      artifacts.next_action_report_file = getStringField(guidedNextAfterLearning.payload, "next_action_report_file");
      artifacts.guided_next_after_learning_transcript_file = guidedNextAfterLearning.transcriptFile;
      const firstFlowIdentity = resolveFlowIdentityFromPacket(
        targetCheckout.targetCheckoutRoot,
        artifacts.intake_artifact_packet_file,
      );
      const completedFlowArchiveFile =
        archivedNextActionReportForMission(targetCheckout.targetCheckoutRoot, firstFlowIdentity);
      const genericCompletedFlowReportFile = asNonEmptyString(artifacts.next_action_report_file);
      const archivedCompletedFlowReport = readReportDocument(completedFlowArchiveFile);
      const genericCompletedFlowReport = readReportDocument(genericCompletedFlowReportFile);
      artifacts.completed_flow_next_action_report_file =
        nextActionReportClosesFlow(archivedCompletedFlowReport)
          ? completedFlowArchiveFile
          : nextActionReportClosesFlow(genericCompletedFlowReport)
            ? genericCompletedFlowReportFile
            : completedFlowArchiveFile || genericCompletedFlowReportFile;
      const completedNextActionReport = readReportDocument(artifacts.completed_flow_next_action_report_file);
      artifacts.first_flow_id = firstFlowIdentity.flowId;
      artifacts.first_flow_status = nextActionReportClosesFlow(completedNextActionReport) ? "completed" : "active";
      artifacts.completed_flow_read_only = artifacts.first_flow_status === "completed";
      artifacts.follow_up_source_handoff_ref = asNonEmptyString(artifacts.learning_loop_handoff_file);

      const followUpMissionId = `${asNonEmptyString(firstFlowIdentity.missionId) || "guided-flow"}-follow-up-${normalizeId(options.runId)}`;
      const followUpMissionCreate = runCommand("follow-up-mission-create", buildGuidedMissionCreateArgs({
        mission: options.mission,
        featureRequest,
        profile: options.profile,
        projectProfileFile: generatedProfile.generatedProjectProfileFile,
        missionIdOverride: followUpMissionId,
        titleOverride: `${asNonEmptyString(featureRequest.requestDocument.title) || followUpMissionId} follow-up`,
        briefOverride: "Start a fresh follow-up flow from the completed learning handoff while keeping the source flow read-only.",
        deliveryModeOverride: "no-write",
        sourceRefOverride: asNonEmptyString(artifacts.learning_loop_handoff_file),
        followUpSourceHandoffRef: asNonEmptyString(artifacts.follow_up_source_handoff_ref),
      }));
      artifacts.new_flow_mission_artifact_packet_file = getStringField(followUpMissionCreate.payload, "artifact_packet_file");
      artifacts.new_flow_mission_artifact_packet_body_file = getStringField(
        followUpMissionCreate.payload,
        "artifact_packet_body_file",
      );
      artifacts.guided_follow_up_mission_create_transcript_file = followUpMissionCreate.transcriptFile;
      const secondFlowIdentity = resolveFlowIdentityFromPacket(
        targetCheckout.targetCheckoutRoot,
        artifacts.new_flow_mission_artifact_packet_file,
      );
      artifacts.second_flow_id = secondFlowIdentity.flowId;
      if (!asNonEmptyString(artifacts.second_flow_id)) {
        throw new Error("Guided follow-up mission did not materialize a second flow id.");
      }

      const guidedNextAfterFollowUp = runCommand("guided-next-after-follow-up", [
        "next",
        "--project-ref",
        ".",
        "--project-profile",
        generatedProfile.generatedProjectProfileFile,
        "--runtime-root",
        ".aor",
        "--json",
      ]);
      artifacts.new_flow_next_action_report_file = getStringField(guidedNextAfterFollowUp.payload, "next_action_report_file");
      artifacts.guided_next_after_follow_up_transcript_file = guidedNextAfterFollowUp.transcriptFile;
      if (
        !asNonEmptyString(artifacts.new_flow_mission_artifact_packet_file) ||
        !asNonEmptyString(artifacts.new_flow_next_action_report_file)
      ) {
        throw new Error("Guided follow-up flow did not materialize fresh intake and next-action evidence.");
      }

      const flowTargetedRequest = runCommand("flow-targeted-request-create", [
        "request",
        "create",
        "--project-ref",
        ".",
        "--project-profile",
        generatedProfile.generatedProjectProfileFile,
        "--runtime-root",
        ".aor",
        "--stage",
        "discovery",
        "--intent",
        "analyze",
        "--request",
        "Inspect the fresh follow-up flow evidence and confirm the next action remains no-write.",
        "--target-flow-id",
        asNonEmptyString(artifacts.second_flow_id),
        "--target-ref",
        asNonEmptyString(artifacts.new_flow_mission_artifact_packet_file),
        "--target-ref",
        asNonEmptyString(artifacts.new_flow_next_action_report_file),
        "--delivery-mode",
        "no-write",
      ]);
      artifacts.flow_targeted_operator_request_file = getStringField(flowTargetedRequest.payload, "operator_request_file");
      artifacts.flow_targeted_operator_request_ref = getStringField(flowTargetedRequest.payload, "operator_request_ref");
      artifacts.flow_targeted_operator_request_id = getStringField(flowTargetedRequest.payload, "operator_request_id");
      artifacts.flow_targeted_operator_request_target_flow_id = asNonEmptyString(artifacts.second_flow_id);
      artifacts.flow_targeted_operator_request = readOperatorRequestDocument(artifacts.flow_targeted_operator_request_file);
      artifacts.guided_flow_targeted_request_transcript_file = flowTargetedRequest.transcriptFile;

      const webSmoke = runGuidedWebSmoke({
        aorLaunch: options.aorLaunch,
        targetCheckoutRoot: targetCheckout.targetCheckoutRoot,
        runId: options.runId,
        reportsRoot: options.layout.reportsRoot,
        env,
        projectProfileFile: generatedProfile.generatedProjectProfileFile,
        autoCollectBrowserTaskProof:
          asRecord(asRecord(options.profile.guided_journey).browser_task_proof).auto_collect === true,
      });
      artifacts.guided_web_smoke_summary_file = webSmoke.summaryFile;
      artifacts.guided_web_smoke_html_file = webSmoke.htmlFile;
      artifacts.guided_web_dom_snapshot_file = webSmoke.domSnapshotFile;
      artifacts.guided_web_accessibility_summary_file = webSmoke.accessibilitySummaryFile;
      artifacts.guided_web_screenshot_files = webSmoke.screenshotFiles;
      artifacts.guided_web_visual_guardrail_file = webSmoke.visualGuardrailFile;
      artifacts.guided_browser_task_proof_request_file = webSmoke.browserTaskProofRequestFile;
      artifacts.guided_browser_task_proof_file = webSmoke.browserTaskProofFile;
      artifacts.guided_web_smoke = webSmoke.summary;
      if (
        artifacts.post_run_diagnostic_deferred_until_guided_proof === true &&
        postRunQualityPolicy.diagnosticFailureMode === "warn" &&
        postRunQualityPolicy.diagnosticCommands.length > 0
      ) {
        const loopIterations = Array.isArray(asRecord(artifacts.implementation_loop).iterations)
          ? asRecord(artifacts.implementation_loop).iterations
          : [];
        const lastIteration = asRecord(loopIterations.at(-1));
        const deferredDiagnosticIteration = Number(lastIteration.iteration) || 1;
        const deferredDiagnosticTimeoutMs = resolveGuidedWarnDiagnosticTimeoutMs(options.profile);
        artifacts.post_run_diagnostic_deferred_timeout_ms = deferredDiagnosticTimeoutMs;
        const deferredDiagnostic = runPostRunDiagnosticVerify({
          iteration: deferredDiagnosticIteration,
          timeoutMs: deferredDiagnosticTimeoutMs,
          allowFailureResult: true,
        });
        artifacts.post_run_diagnostic_deferred_until_guided_proof = false;
        artifacts.post_run_diagnostic_deferred_after_guided_proof = true;
        artifacts.post_run_diagnostic_deferred_transcript_file = deferredDiagnostic.transcriptFile;
      }
    }
    markStage(
      stageMap,
      "learning",
      "pass",
      uniqueStrings([learningHandoff.transcriptFile, ...collectStringRefs(learningHandoff.payload)]),
      "Public learning-loop closure artifacts materialized.",
    );

    if (internalTestHooks.drop_runtime_harness_report_outputs === true) {
      if (typeof artifacts.runtime_harness_report_file === "string") {
        try {
          fs.rmSync(artifacts.runtime_harness_report_file, { force: true });
        } catch {
          // Test hook only: scenario coverage below will fail on the missing proof artifact.
        }
      }
      artifacts.runtime_harness_report_file = null;
      artifacts.runtime_harness_overall_decision = null;
      artifacts.latest_runtime_harness_report_file = null;
      artifacts.latest_runtime_harness_decision = null;
      artifacts.delivery_runtime_harness_report_file = null;
      artifacts.run_start_runtime_harness_report_file = null;
      artifacts.run_start_runtime_harness_decision = null;
    }

    if (guidedJourneyEnabled) {
      const targetHeadAfter = runGitOutput({
        cwd: targetCheckout.targetCheckoutRoot,
        args: ["rev-parse", "HEAD"],
      });
      const targetGitStatusWithoutRuntime = collectTargetGitStatusWithoutRuntime(targetCheckout.targetCheckoutRoot);
      artifacts.target_head_before = targetHeadBefore;
      artifacts.target_head_after = targetHeadAfter;
      artifacts.target_git_status_without_runtime = targetGitStatusWithoutRuntime;
      const guidedProof = buildGuidedJourneyProof({
        runId: options.runId,
        profile: options.profile,
        commandResults,
        artifacts,
        targetCheckoutRoot: targetCheckout.targetCheckoutRoot,
        reportsRoot: options.layout.reportsRoot,
        targetHeadBefore,
        targetHeadAfter,
        targetGitStatusWithoutRuntime,
      });
      const writtenProof = writeValidatedGuidedJourneyProof({
        proof: guidedProof,
        targetCheckoutRoot: targetCheckout.targetCheckoutRoot,
        reportsRoot: options.layout.reportsRoot,
        runId: options.runId,
      });
      artifacts.guided_journey_proof_file = writtenProof.proofFile;
      artifacts.guided_journey_proof = writtenProof.proof;
    }

    const targetBaselineObservedStatus = asNonEmptyString(artifacts.baseline_verify_status) || "fail";
    const postRunVerificationStatus = asNonEmptyString(artifacts.post_run_verify_status) || "fail";
    const postRunDiagnosticStatus = asNonEmptyString(artifacts.post_run_diagnostic_status) || "pass";
    const targetBaselineStatus = resolveEffectiveTargetBaselineStatus(artifacts, targetBaselineObservedStatus);
    const runtimeHarnessReportFiles = uniqueStrings([
      asNonEmptyString(artifacts.latest_runtime_harness_report_file),
      asNonEmptyString(artifacts.delivery_runtime_harness_report_file),
      asNonEmptyString(artifacts.runtime_harness_report_file),
      asNonEmptyString(artifacts.run_start_runtime_harness_report_file),
    ]);
    const meaningfulChangedPaths = reconcileSummaryMeaningfulChangedPaths(uniqueStrings([
      ...runtimeHarnessReportFiles.flatMap((reportFile) => collectRuntimeHarnessChangedPaths(reportFile)),
      ...collectReviewChangedPaths(artifacts.review_report_file),
    ]), { targetCheckoutRoot: targetCheckout.targetCheckoutRoot });
    const runtimeHarnessDecision =
      asNonEmptyString(artifacts.run_start_runtime_harness_decision) ||
      asNonEmptyString(artifacts.runtime_harness_overall_decision) ||
      "unknown";
    const latestRuntimeHarnessDecision =
      asNonEmptyString(artifacts.latest_runtime_harness_decision) || runtimeHarnessDecision;
    const realCodeChangeStatus = (
      runtimeHarnessReportFiles.some((reportFile) =>
        runtimeHarnessReportHasMissionRelevantChanges(reportFile, options.mission),
      ) || changedPathsHaveMissionRelevantChanges(collectReviewChangedPaths(artifacts.review_report_file), options.mission)
    )
      ? "pass"
      : "fail";
    const providerExecutionProofStatus = evidenceRefMaterialized(
      asNonEmptyString(artifacts.adapter_raw_evidence_ref),
      targetCheckout.targetCheckoutRoot,
    )
      ? "pass"
      : "fail";
    artifacts.real_code_change_status = realCodeChangeStatus;
    artifacts.meaningful_changed_paths = meaningfulChangedPaths;
    artifacts.runtime_harness_decision = runtimeHarnessDecision;
    artifacts.run_start_runtime_harness_decision = runtimeHarnessDecision;
    artifacts.latest_runtime_harness_decision = latestRuntimeHarnessDecision;
    artifacts.provider_execution_status = providerExecutionProofStatus;
    const artifactConsistency = evaluateArtifactConsistency({
      artifacts,
      reviewReport,
      auditPayload,
      runId: options.runId,
    });
    artifacts.artifact_consistency = artifactConsistency;
    const repairProofExpectations = evaluateRepairProofExpectations({
      profile: options.profile,
      artifacts,
    });
    artifacts.repair_proof_expectations = repairProofExpectations;
    if (repairProofExpectations.status === "fail") {
      markStage(
        stageMap,
        "delivery",
        "fail",
        asStringArray(repairProofExpectations.evidence_refs),
        repairProofExpectations.summary,
      );
    }
    const scenarioCoverage = evaluateScenarioCoverage({
      scenarioPolicy: options.scenarioPolicy,
      stageResults: flattenStageMap(stageMap),
      artifacts,
      auditPayload,
    });
    if (artifactConsistency.status === "fail") {
      scenarioCoverage.status = "fail";
      scenarioCoverage.findings = uniqueStrings([
        ...asStringArray(scenarioCoverage.findings),
        ...artifactConsistency.findings,
      ]);
      scenarioCoverage.summary = artifactConsistency.summary;
    }
    artifacts.scenario_coverage = scenarioCoverage;
    const releaseRequired = options.scenarioPolicy.release_required === true;
    const releaseMaterializationStatus =
      releaseRequired || asRecord(options.profile.output_policy).materialize_release_packet === true
        ? asNonEmptyString(artifacts.release_status) === "pass" && artifacts.release_packet_file
          ? "materialized"
          : "missing"
        : "not_required";
    const learningLoopMaterializationStatus =
      artifacts.learning_loop_scorecard_file && artifacts.learning_loop_handoff_file && auditPayload.run_audit_records
        ? "materialized"
        : "missing";
    const commandCompletionStatus =
      commandResults.length > 0 && commandResults.every((entry) => commandCompletedForRun(entry))
        ? "pass"
        : "fail";
    const stageCompletionStatus = flattenStageMap(stageMap).some((entry) => asNonEmptyString(entry.status) === "fail")
      ? "fail"
      : "pass";
    artifacts.full_flow_facts = {
      scenario_family: asNonEmptyString(options.profile.scenario_family) || null,
      provider_variant_id: asNonEmptyString(options.profile.provider_variant_id) || null,
      feature_size: options.featureSize,
      run_tier: asNonEmptyString(artifacts.run_tier) || resolveRunTier(options.profile),
      command_completion_status: commandCompletionStatus,
      stage_completion_status: stageCompletionStatus,
      provider_execution_status: providerExecutionProofStatus,
      target_baseline_observed_status: targetBaselineObservedStatus,
      target_baseline_status: targetBaselineStatus,
      post_run_verification_status: postRunVerificationStatus,
      post_run_diagnostic_status: postRunDiagnosticStatus,
      review_overall_status: reviewOverallStatus,
      feature_size_fit_status: featureSizeFitStatus,
      real_code_change_status: realCodeChangeStatus,
      meaningful_changed_paths: meaningfulChangedPaths,
      runtime_harness_decision: runtimeHarnessDecision,
      run_start_runtime_harness_decision: runtimeHarnessDecision,
      latest_runtime_harness_decision: latestRuntimeHarnessDecision,
      artifact_consistency_status: artifactConsistency.status,
      repair_proof_expectations_status: repairProofExpectations.status,
      scenario_coverage_state: scenarioCoverage.status,
      delivery_blocking: artifacts.delivery_blocking === true,
      delivery_manifest_file: asNonEmptyString(artifacts.delivery_manifest_file) || null,
      release_required: releaseRequired,
      release_materialization_status: releaseMaterializationStatus,
      learning_loop_materialization_status: learningLoopMaterializationStatus,
    };
    const flowStatus = commandCompletionStatus === "pass" && stageCompletionStatus === "pass" ? "pass" : "fail";

    return {
      startedAt,
      finishedAt: nowIso(),
      status: flowStatus,
      stageResults: flattenStageMap(stageMap),
      commandResults,
      artifacts,
      sessionRoots,
    };
  } catch (error) {
    if (isLiveE2eControllerStop(error)) {
      artifacts.live_e2e_controller_stop = {
        reason: error.message,
        decision: asRecord(error.decision),
        state: asRecord(error.state),
      };
      return {
        startedAt,
        finishedAt: nowIso(),
        status: asNonEmptyString(asRecord(error.decision).action) === "continue" ? "pass" : "fail",
        stageResults: flattenStageMap(stageMap),
        commandResults,
        artifacts,
        sessionRoots,
      };
    }
    const summary = error instanceof Error ? error.message : String(error);
    if (!flattenStageMap(stageMap).some((stage) => stage.status === "fail")) {
      const fallbackStage = flattenStageMap(stageMap).find((stage) => stage.status === "pending")?.stage ?? "bootstrap";
      markStageRaw(stageMap, fallbackStage, "fail", [], summary);
      try {
        options.stepController?.observeStage({
          stage: fallbackStage,
          stageResult: stageMap[fallbackStage],
          commandResults,
          artifacts,
        });
      } catch (controllerError) {
        if (!isLiveE2eControllerStop(controllerError)) throw controllerError;
      }
    }
    return {
      startedAt,
      finishedAt: nowIso(),
      status: "fail",
      stageResults: flattenStageMap(stageMap),
      commandResults,
      artifacts,
      sessionRoots,
    };
  }
}
