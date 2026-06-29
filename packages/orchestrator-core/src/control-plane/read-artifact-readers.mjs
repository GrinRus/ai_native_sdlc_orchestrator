import fs from "node:fs";
import path from "node:path";

import { loadContractFile } from "../../../contracts/src/index.mjs";
import {
  buildArtifactDisplaySummary,
  uniqueArtifactDisplaySummaries,
} from "../artifact-display-summary.mjs";
import { normalizeProviderStepStatus } from "../provider-step-status.mjs";
import { initializeProjectRuntime, previewProjectRuntime } from "../project-init.mjs";
import { buildOnboardingSummary } from "./onboarding-summary.mjs";

const ARTIFACT_PACKET_REGEX = /^.+\.artifact\..+\.json$/;
const WAVE_TICKET_REGEX = /^wave-ticket-.*\.json$/;
const HANDOFF_PACKET_REGEX = /^[^.]+\.handoff\..*\.json$/;
const DELIVERY_PLAN_REGEX = /^delivery-plan-.*\.json$/;
const DELIVERY_MANIFEST_REGEX = /^delivery-manifest-.*\.json$/;
const RELEASE_PACKET_REGEX = /^release-packet-.*\.json$/;
const PROMOTION_DECISION_REGEX = /^promotion-decision-.*\.json$/;
const STEP_RESULT_REGEX = /^step-result-.*\.json$/;
const VALIDATION_REPORT_REGEX = /^validation-report.*\.json$/;
const EVALUATION_REPORT_REGEX = /^evaluation-report.*\.json$/;
const REVIEW_REPORT_REGEX = /^review-report.*\.json$/;
const REVIEW_DECISION_REGEX = /^review-decision-.*\.json$/;
const RUNTIME_HARNESS_REPORT_REGEX = /^runtime-harness-report.*\.json$/;
const MULTIREPO_COORDINATION_STATUS_REGEX = /^multirepo-coordination-status-.*\.json$/;
const COMPILER_REVISION_STATUS_REGEX = /^compiler-revision-status-.*\.json$/;
const INCIDENT_REPORT_REGEX = /^incident-report-.*\.json$/;
const INCIDENT_BACKFILL_PROPOSAL_REGEX = /^incident-backfill-proposal-.*\.json$/;
const LEARNING_LOOP_SCORECARD_REGEX = /^learning-loop-scorecard-.*\.json$/;
const LEARNING_LOOP_HANDOFF_REGEX = /^learning-loop-handoff-.*\.json$/;
const RUN_CONTROL_AUDIT_REGEX = /^run-control-event-.*\.json$/;
const RUN_CONTROL_STATE_REGEX = /^run-control-state-.*\.json$/;
const PROJECT_INIT_STATE_REGEX = /^project-init-state\.json$/;
const ARTIFACT_BODY_REGEX = /^.+\.artifact\..+\.body\.json$/;
const ONBOARDING_REPORT_REGEX = /^onboarding-report\.json$/;
const NEXT_ACTION_REPORT_REGEX = /^next-action-report.*\.json$/;
const OPERATOR_REQUEST_REGEX = /^operator-request-.*\.json$/;

/**
 * @param {unknown} value
 * @returns {number | undefined}
 */
function asNonNegativeInteger(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return undefined;
  }
  return Math.floor(parsed);
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function asString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * @template T
 * @param {T[]} entries
 * @param {unknown} limit
 * @returns {T[]}
 */
export function applyReadModelLimit(entries, limit) {
  const normalizedLimit = asNonNegativeInteger(limit);
  if (typeof normalizedLimit !== "number") {
    return entries;
  }
  return normalizedLimit === 0 ? [] : entries.slice(0, normalizedLimit);
}

/**
 * @param {string} value
 * @returns {string}
 */
function toPosix(value) {
  return value.replace(/\\/g, "/");
}

/**
 * @param {ReturnType<typeof initializeProjectRuntime>} init
 * @param {string} filePath
 * @returns {string}
 */
export function toEvidenceRef(init, filePath) {
  return `evidence://${toPosix(path.relative(init.projectRoot, filePath))}`;
}

/**
 * @param {{
 *   family: string,
 *   file: string,
 *   artifact_ref: string,
 *   document: Record<string, unknown>,
 * }} entry
 * @returns {Record<string, unknown>}
 */
function displaySummaryForEntry(entry) {
  return buildArtifactDisplaySummary({
    family: entry.family,
    file: entry.file,
    artifactRef: entry.artifact_ref,
    document: entry.document,
  });
}

/**
 * @template {{ family: string, file: string, artifact_ref: string, document: Record<string, unknown> }} T
 * @param {T} entry
 * @returns {T & { display_summary: Record<string, unknown>, artifact_display_summaries: Record<string, unknown>[] }}
 */
function withDisplaySummary(entry) {
  const displaySummary = displaySummaryForEntry(entry);
  return {
    ...entry,
    display_summary: displaySummary,
    artifact_display_summaries: [displaySummary],
  };
}

/**
 * @param {string} dirPath
 * @param {{ limit?: number }} [options]
 * @returns {string[]}
 */
export function listJsonFiles(dirPath, options = {}) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  const files = fs
    .readdirSync(dirPath)
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => path.join(dirPath, entry))
    .sort((left, right) => {
      const leftStat = fs.statSync(left);
      const rightStat = fs.statSync(right);
      const mtimeDelta = rightStat.mtimeMs - leftStat.mtimeMs;
      if (mtimeDelta !== 0) {
        return mtimeDelta;
      }
      return path.basename(right).localeCompare(path.basename(left));
    });

  return applyReadModelLimit(files, options.limit);
}

/**
 * @param {string[]} files
 * @returns {string[]}
 */
function sortFilesByFreshness(files) {
  return [...files].sort((left, right) => {
    const leftStat = fs.statSync(left);
    const rightStat = fs.statSync(right);
    const mtimeDelta = rightStat.mtimeMs - leftStat.mtimeMs;
    if (mtimeDelta !== 0) {
      return mtimeDelta;
    }
    return path.basename(right).localeCompare(path.basename(left));
  });
}

/**
 * @param {string} dirPath
 * @param {RegExp[]} matchers
 * @param {unknown} limit
 * @returns {string[]}
 */
function listMatchingJsonFiles(dirPath, matchers, limit) {
  const files = listJsonFiles(dirPath).filter((filePath) => {
    const basename = path.basename(filePath);
    return matchers.some((matcher) => matcher.test(basename));
  });
  return applyReadModelLimit(files, limit);
}

/**
 * @param {{
 *   init: ReturnType<typeof initializeProjectRuntime>,
 *   files: string[],
 *   family: import("../../../contracts/src/index.d.ts").ContractFamily,
 *   matcher: RegExp,
 * }} options
 * @returns {Array<{ family: string, file: string, artifact_ref: string, document: Record<string, unknown> }>}
 */
function loadContractDocuments(options) {
  /** @type {Array<{ family: string, file: string, artifact_ref: string, document: Record<string, unknown> }>} */
  const loaded = [];

  for (const filePath of options.files) {
    const name = path.basename(filePath);
    if (!options.matcher.test(name)) {
      continue;
    }

    const contract = loadContractFile({
      filePath,
      family: options.family,
    });
    if (!contract.ok) {
      continue;
    }

      loaded.push(withDisplaySummary({
        family: options.family,
        file: filePath,
        artifact_ref: toEvidenceRef(options.init, filePath),
        document: /** @type {Record<string, unknown>} */ (contract.document),
      }));
  }

  return loaded;
}

/**
 * @param {{ init: ReturnType<typeof initializeProjectRuntime>, files: string[], matcher: RegExp }}
 * @returns {Array<{ family: string, file: string, artifact_ref: string, document: Record<string, unknown> }>}
 */
function loadJsonDocuments(options) {
  /** @type {Array<{ family: string, file: string, artifact_ref: string, document: Record<string, unknown> }>} */
  const loaded = [];

  for (const filePath of options.files) {
    const name = path.basename(filePath);
    if (!options.matcher.test(name)) {
      continue;
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        continue;
      }
      loaded.push(withDisplaySummary({
        family: "run-control-audit",
        file: filePath,
        artifact_ref: toEvidenceRef(options.init, filePath),
        document: /** @type {Record<string, unknown>} */ (parsed),
      }));
    } catch {
      // Ignore malformed audit sidecars; contract-backed artifacts still load through validators.
    }
  }

  return loaded;
}

/**
 * @param {ReturnType<typeof initializeProjectRuntime>} init
 * @returns {string[]}
 */
function listRunControlStateFiles(init) {
  const rootStateFiles = listJsonFiles(init.runtimeLayout.stateRoot)
    .filter((filePath) => RUN_CONTROL_STATE_REGEX.test(path.basename(filePath)));
  const targetCheckoutsRoot = path.join(init.runtimeLayout.projectRuntimeRoot, "target-checkouts");
  if (!fs.existsSync(targetCheckoutsRoot)) {
    return rootStateFiles;
  }

  const nestedStateFiles = fs.readdirSync(targetCheckoutsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((checkoutEntry) => {
      const targetProjectsRoot = path.join(targetCheckoutsRoot, checkoutEntry.name, ".aor", "projects");
      if (!fs.existsSync(targetProjectsRoot)) return [];
      return fs.readdirSync(targetProjectsRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .flatMap((projectEntry) => {
          const targetStateRoot = path.join(targetProjectsRoot, projectEntry.name, "state");
          return listJsonFiles(targetStateRoot).filter((filePath) => RUN_CONTROL_STATE_REGEX.test(path.basename(filePath)));
        });
    });

  return sortFilesByFreshness([...rootStateFiles, ...nestedStateFiles]);
}

/**
 * @param {{
 *   init: ReturnType<typeof initializeProjectRuntime>,
 *   files: string[],
 *   matcher: RegExp,
 *   type: string,
 *   stage: string,
 *   fallbackLabel: string,
 *   fallbackDescription: string,
 * }} options
 * @returns {Array<Record<string, unknown>>}
 */
function loadReadableEvidenceSidecarSummaries(options) {
  /** @type {Array<Record<string, unknown>>} */
  const summaries = [];
  for (const filePath of options.files) {
    if (!options.matcher.test(path.basename(filePath))) continue;
    let document = {};
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        document = /** @type {Record<string, unknown>} */ (parsed);
      }
    } catch {
      document = {};
    }
    summaries.push(buildArtifactDisplaySummary({
      file: filePath,
      artifactRef: toEvidenceRef(options.init, filePath),
      document,
      type: options.type,
      stage: options.stage,
      label: asString(document.title) ?? asString(document.packet_id) ?? options.fallbackLabel,
      description: asString(document.summary) ?? options.fallbackDescription,
      status: "ready",
    }));
  }
  return summaries;
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef?: string,
 *   projectProfile?: string,
 *   runtimeRoot?: string,
 *   limit?: number,
 * }} options
 * @returns {Array<Record<string, unknown>>}
 */
function listReadableEvidenceSidecarSummaries(options = {}) {
  const init = initializeProjectRuntime(options);
  const summaries = [
    ...loadReadableEvidenceSidecarSummaries({
      init,
      files: listJsonFiles(init.runtimeLayout.stateRoot),
      matcher: PROJECT_INIT_STATE_REGEX,
      type: "runtime-state",
      stage: "readiness",
      fallbackLabel: "Project runtime state",
      fallbackDescription: "Runtime initialization state evidence.",
    }),
    ...loadReadableEvidenceSidecarSummaries({
      init,
      files: listJsonFiles(init.runtimeLayout.artifactsRoot),
      matcher: ARTIFACT_BODY_REGEX,
      type: "evidence",
      stage: "mission",
      fallbackLabel: "Mission intake body",
      fallbackDescription: "Mission intake body evidence.",
    }),
    ...loadReadableEvidenceSidecarSummaries({
      init,
      files: listJsonFiles(init.runtimeLayout.reportsRoot),
      matcher: ONBOARDING_REPORT_REGEX,
      type: "onboarding-report",
      stage: "readiness",
      fallbackLabel: "Onboarding report",
      fallbackDescription: "Runtime onboarding report evidence.",
    }),
  ];
  return applyReadModelLimit(summaries, options.limit);
}

/**
 * @param {ReturnType<typeof initializeProjectRuntime>} init
 * @returns {Record<string, unknown> | null}
 */
function readLatestProviderStepStatus(init) {
  const runControlStatuses = listRunControlStateFiles(init)
    .flatMap((filePath) => {
      try {
        const state = JSON.parse(fs.readFileSync(filePath, "utf8"));
        const normalized = normalizeProviderStepStatus(asRecord(state).provider_step_status);
        return normalized ? [{ status: normalized, updatedMs: fs.statSync(filePath).mtimeMs }] : [];
      } catch {
        return [];
      }
    });

  const statuses = runControlStatuses
    .sort((left, right) => {
      const leftUpdated = Date.parse(String(left.status.updated_at ?? "")) || left.updatedMs;
      const rightUpdated = Date.parse(String(right.status.updated_at ?? "")) || right.updatedMs;
      return rightUpdated - leftUpdated;
    });
  return statuses[0]?.status ?? null;
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef?: string,
 *   projectProfile?: string,
 *   runtimeRoot?: string,
 * }} options
 */
export function readProjectState(options = {}) {
  const preview = previewProjectRuntime({
    cwd: options.cwd,
    projectRef: options.projectRef,
    projectProfile: options.projectProfile,
    runtimeRoot: options.runtimeRoot,
  });
  if (!preview.stateExists) {
    return {
      project_id: preview.projectId,
      display_name: preview.displayName,
      project_root: preview.projectRoot,
      project_profile_ref: preview.projectProfileRef,
      runtime_root: preview.runtimeRoot,
      runtime_layout: preview.runtimeLayout,
      state_file: null,
      onboarding_summary: buildOnboardingSummary(preview),
      provider_step_status: null,
      artifact_display_summaries: [],
    };
  }
  const init = initializeProjectRuntime(options);
  const initializedPreview = previewProjectRuntime({
    cwd: options.cwd,
    projectRef: init.projectRoot,
    projectProfile: options.projectProfile,
    runtimeRoot: options.runtimeRoot,
  });
  return {
    project_id: init.projectId,
    display_name: init.displayName,
    project_root: init.projectRoot,
    project_profile_ref: init.projectProfileRef,
    runtime_root: init.runtimeRoot,
    runtime_layout: init.state.runtime_layout,
    state_file: init.stateFile,
    onboarding_summary: buildOnboardingSummary(initializedPreview),
    provider_step_status: readLatestProviderStepStatus(init),
    artifact_display_summaries: listArtifactDisplaySummaries({ ...options, limit: options.limit ?? 50 }),
  };
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef?: string,
 *   projectProfile?: string,
 *   runtimeRoot?: string,
 * }} options
 */
export function listPacketArtifacts(options = {}) {
  const init = initializeProjectRuntime(options);
  const files = listMatchingJsonFiles(
    init.runtimeLayout.artifactsRoot,
    [
      ARTIFACT_PACKET_REGEX,
      WAVE_TICKET_REGEX,
      HANDOFF_PACKET_REGEX,
      DELIVERY_PLAN_REGEX,
      DELIVERY_MANIFEST_REGEX,
      RELEASE_PACKET_REGEX,
    ],
    options.limit,
  );

  return applyReadModelLimit([
    ...loadContractDocuments({ init, files, family: "artifact-packet", matcher: ARTIFACT_PACKET_REGEX }),
    ...loadContractDocuments({ init, files, family: "wave-ticket", matcher: WAVE_TICKET_REGEX }),
    ...loadContractDocuments({ init, files, family: "handoff-packet", matcher: HANDOFF_PACKET_REGEX }),
    ...loadContractDocuments({ init, files, family: "delivery-plan", matcher: DELIVERY_PLAN_REGEX }),
    ...loadContractDocuments({ init, files, family: "delivery-manifest", matcher: DELIVERY_MANIFEST_REGEX }),
    ...loadContractDocuments({ init, files, family: "release-packet", matcher: RELEASE_PACKET_REGEX }),
  ], options.limit);
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef?: string,
 *   projectProfile?: string,
 *   runtimeRoot?: string,
 * }} options
 */
export function listStepResults(options = {}) {
  const init = initializeProjectRuntime(options);
  const files = listMatchingJsonFiles(init.runtimeLayout.reportsRoot, [STEP_RESULT_REGEX], options.limit);
  return applyReadModelLimit(
    loadContractDocuments({ init, files, family: "step-result", matcher: STEP_RESULT_REGEX }),
    options.limit,
  );
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef?: string,
 *   projectProfile?: string,
 *   runtimeRoot?: string,
 * }} options
 */
export function listDeliveryManifests(options = {}) {
  return listPacketArtifacts(options).filter((entry) => entry.family === "delivery-manifest");
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef?: string,
 *   projectProfile?: string,
 *   runtimeRoot?: string,
 * }} options
 */
export function listPromotionDecisions(options = {}) {
  const init = initializeProjectRuntime(options);
  const files = listMatchingJsonFiles(init.runtimeLayout.artifactsRoot, [PROMOTION_DECISION_REGEX], options.limit);
  return applyReadModelLimit(
    loadContractDocuments({ init, files, family: "promotion-decision", matcher: PROMOTION_DECISION_REGEX }),
    options.limit,
  );
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef?: string,
 *   projectProfile?: string,
 *   runtimeRoot?: string,
 * }} options
 */
export function listQualityArtifacts(options = {}) {
  const init = initializeProjectRuntime(options);
  const reportFiles = listMatchingJsonFiles(
    init.runtimeLayout.reportsRoot,
    [
      VALIDATION_REPORT_REGEX,
      EVALUATION_REPORT_REGEX,
      REVIEW_REPORT_REGEX,
      REVIEW_DECISION_REGEX,
      RUNTIME_HARNESS_REPORT_REGEX,
      MULTIREPO_COORDINATION_STATUS_REGEX,
      COMPILER_REVISION_STATUS_REGEX,
      INCIDENT_REPORT_REGEX,
      INCIDENT_BACKFILL_PROPOSAL_REGEX,
      LEARNING_LOOP_SCORECARD_REGEX,
      LEARNING_LOOP_HANDOFF_REGEX,
    ],
    options.limit,
  );

  return applyReadModelLimit([
    ...loadContractDocuments({ init, files: reportFiles, family: "validation-report", matcher: VALIDATION_REPORT_REGEX }),
    ...loadContractDocuments({ init, files: reportFiles, family: "evaluation-report", matcher: EVALUATION_REPORT_REGEX }),
    ...loadContractDocuments({ init, files: reportFiles, family: "review-report", matcher: REVIEW_REPORT_REGEX }),
    ...loadContractDocuments({ init, files: reportFiles, family: "review-decision", matcher: REVIEW_DECISION_REGEX }),
    ...loadContractDocuments({
      init,
      files: reportFiles,
      family: "runtime-harness-report",
      matcher: RUNTIME_HARNESS_REPORT_REGEX,
    }),
    ...loadContractDocuments({
      init,
      files: reportFiles,
      family: "multirepo-coordination-status",
      matcher: MULTIREPO_COORDINATION_STATUS_REGEX,
    }),
    ...loadContractDocuments({
      init,
      files: reportFiles,
      family: "compiler-revision-status",
      matcher: COMPILER_REVISION_STATUS_REGEX,
    }),
    ...loadContractDocuments({ init, files: reportFiles, family: "incident-report", matcher: INCIDENT_REPORT_REGEX }),
    ...loadContractDocuments({
      init,
      files: reportFiles,
      family: "incident-backfill-proposal",
      matcher: INCIDENT_BACKFILL_PROPOSAL_REGEX,
    }),
    ...loadContractDocuments({
      init,
      files: reportFiles,
      family: "learning-loop-scorecard",
      matcher: LEARNING_LOOP_SCORECARD_REGEX,
    }),
    ...loadContractDocuments({
      init,
      files: reportFiles,
      family: "learning-loop-handoff",
      matcher: LEARNING_LOOP_HANDOFF_REGEX,
    }),
    ...listPromotionDecisions(options),
  ], options.limit);
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef?: string,
 *   projectProfile?: string,
 *   runtimeRoot?: string,
 * }} options
 */
export function listMultirepoCoordinationStatuses(options = {}) {
  const init = initializeProjectRuntime(options);
  const reportFiles = listMatchingJsonFiles(init.runtimeLayout.reportsRoot, [MULTIREPO_COORDINATION_STATUS_REGEX], options.limit);
  return applyReadModelLimit(
    loadContractDocuments({
      init,
      files: reportFiles,
      family: "multirepo-coordination-status",
      matcher: MULTIREPO_COORDINATION_STATUS_REGEX,
    }),
    options.limit,
  );
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef?: string,
 *   projectProfile?: string,
 *   runtimeRoot?: string,
 * }} options
 */
export function listCompilerRevisionStatuses(options = {}) {
  const init = initializeProjectRuntime(options);
  const reportFiles = listMatchingJsonFiles(init.runtimeLayout.reportsRoot, [COMPILER_REVISION_STATUS_REGEX], options.limit);
  return applyReadModelLimit(
    loadContractDocuments({
      init,
      files: reportFiles,
      family: "compiler-revision-status",
      matcher: COMPILER_REVISION_STATUS_REGEX,
    }),
    options.limit,
  );
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef?: string,
 *   projectProfile?: string,
 *   runtimeRoot?: string,
 * }} options
 */
export function listRunControlAudits(options = {}) {
  const init = initializeProjectRuntime(options);
  const reportFiles = listMatchingJsonFiles(init.runtimeLayout.reportsRoot, [RUN_CONTROL_AUDIT_REGEX], options.limit);
  return applyReadModelLimit(loadJsonDocuments({ init, files: reportFiles, matcher: RUN_CONTROL_AUDIT_REGEX }), options.limit);
}

/**
 * @param {Record<string, unknown>} document
 * @returns {Record<string, unknown>}
 */
function sanitizeOperatorRequestDocument(document) {
  const sanitized = { ...document };
  delete sanitized.request_text;
  if (typeof sanitized.request_summary !== "string" || sanitized.request_summary.trim().length === 0) {
    const raw = typeof document.request_text === "string" ? document.request_text.replace(/\s+/gu, " ").trim() : "";
    sanitized.request_summary = raw.length > 220 ? `${raw.slice(0, 217)}...` : raw;
  }
  return sanitized;
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef?: string,
 *   projectProfile?: string,
 *   runtimeRoot?: string,
 * }} options
 */
export function listOperatorRequests(options = {}) {
  const init = initializeProjectRuntime(options);
  const reportFiles = listJsonFiles(init.runtimeLayout.reportsRoot);
  return loadContractDocuments({
    init,
    files: reportFiles,
    family: "operator-request",
    matcher: OPERATOR_REQUEST_REGEX,
  }).map((entry) => {
    const operatorRequestRef = `packet://operator-request@${entry.artifact_ref}`;
    const displaySummary = buildArtifactDisplaySummary({
      family: "operator-request",
      file: entry.file,
      artifactRef: operatorRequestRef,
      sourceRef: entry.artifact_ref,
      document: entry.document,
    });
    return {
      ...entry,
      operator_request_ref: operatorRequestRef,
      display_summary: displaySummary,
      artifact_display_summaries: [displaySummary],
      document: sanitizeOperatorRequestDocument(entry.document),
    };
  });
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef?: string,
 *   projectProfile?: string,
 *   runtimeRoot?: string,
 *   limit?: number,
 * }} options
 */
export function listArtifactDisplaySummaries(options = {}) {
  const nextActionReport = readNextActionReport(options);
  const summaries = [
    ...listPacketArtifacts(options).flatMap((entry) => entry.artifact_display_summaries ?? []),
    ...listReadableEvidenceSidecarSummaries(options),
    ...listStepResults(options).flatMap((entry) => entry.artifact_display_summaries ?? []),
    ...listQualityArtifacts(options).flatMap((entry) => entry.artifact_display_summaries ?? []),
    ...listOperatorRequests(options).flatMap((entry) => entry.artifact_display_summaries ?? []),
    ...(nextActionReport?.artifact_display_summaries ?? []),
  ];
  return applyReadModelLimit(uniqueArtifactDisplaySummaries(summaries), options.limit);
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef?: string,
 *   projectProfile?: string,
 *   runtimeRoot?: string,
 * }} options
 * @returns {{ family: string, file: string, artifact_ref: string, document: Record<string, unknown> } | null}
 */
export function readNextActionReport(options = {}) {
  const init = initializeProjectRuntime(options);
  const reportFiles = listMatchingJsonFiles(init.runtimeLayout.reportsRoot, [NEXT_ACTION_REPORT_REGEX], options.limit);
  return (
    loadContractDocuments({
      init,
      files: reportFiles,
      family: "next-action-report",
      matcher: NEXT_ACTION_REPORT_REGEX,
    })[0] ?? null
  );
}
