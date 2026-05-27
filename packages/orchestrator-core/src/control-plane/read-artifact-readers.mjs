import fs from "node:fs";
import path from "node:path";

import { loadContractFile } from "../../../contracts/src/index.mjs";
import { initializeProjectRuntime } from "../project-init.mjs";

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

    loaded.push({
      family: options.family,
      file: filePath,
      artifact_ref: toEvidenceRef(options.init, filePath),
      document: /** @type {Record<string, unknown>} */ (contract.document),
    });
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
      loaded.push({
        family: "run-control-audit",
        file: filePath,
        artifact_ref: toEvidenceRef(options.init, filePath),
        document: /** @type {Record<string, unknown>} */ (parsed),
      });
    } catch {
      // Ignore malformed audit sidecars; contract-backed artifacts still load through validators.
    }
  }

  return loaded;
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
  const init = initializeProjectRuntime(options);
  return {
    project_id: init.projectId,
    display_name: init.displayName,
    project_root: init.projectRoot,
    project_profile_ref: init.projectProfileRef,
    runtime_root: init.runtimeRoot,
    runtime_layout: init.state.runtime_layout,
    state_file: init.stateFile,
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
  }).map((entry) => ({
    ...entry,
    operator_request_ref: `packet://operator-request@${entry.artifact_ref}`,
    document: sanitizeOperatorRequestDocument(entry.document),
  }));
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
