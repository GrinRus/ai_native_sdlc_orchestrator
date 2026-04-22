import fs from "node:fs";
import path from "node:path";

import { loadContractFile } from "../../../packages/contracts/src/index.mjs";
import { initializeProjectRuntime } from "../../../packages/orchestrator-core/src/project-init.mjs";

const ARTIFACT_PACKET_REGEX = /^[^.]+\.(artifact)\.[^.]+\.[^.]+\.json$/;
const WAVE_TICKET_REGEX = /^wave-ticket-.*\.json$/;
const HANDOFF_PACKET_REGEX = /^[^.]+\.handoff\..*\.json$/;
const DELIVERY_PLAN_REGEX = /^delivery-plan-.*\.json$/;
const DELIVERY_MANIFEST_REGEX = /^delivery-manifest-.*\.json$/;
const RELEASE_PACKET_REGEX = /^release-packet-.*\.json$/;
const PROMOTION_DECISION_REGEX = /^promotion-decision-.*\.json$/;
const STEP_RESULT_REGEX = /^step-result-.*\.json$/;
const VALIDATION_REPORT_REGEX = /^validation-report.*\.json$/;
const EVALUATION_REPORT_REGEX = /^evaluation-report.*\.json$/;
const INCIDENT_REPORT_REGEX = /^incident-report-.*\.json$/;

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
function toEvidenceRef(init, filePath) {
  return `evidence://${toPosix(path.relative(init.projectRoot, filePath))}`;
}

/**
 * @param {string} dirPath
 * @returns {string[]}
 */
function listJsonFiles(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  return fs
    .readdirSync(dirPath)
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => path.join(dirPath, entry))
    .sort((left, right) => {
      const leftStat = fs.statSync(left);
      const rightStat = fs.statSync(right);
      return rightStat.mtimeMs - leftStat.mtimeMs;
    });
}

/**
 * @param {{
 *   init: ReturnType<typeof initializeProjectRuntime>,
 *   files: string[],
 *   family: import("../../../packages/contracts/src/index.d.ts").ContractFamily,
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
  const files = listJsonFiles(init.runtimeLayout.artifactsRoot);

  return [
    ...loadContractDocuments({ init, files, family: "artifact-packet", matcher: ARTIFACT_PACKET_REGEX }),
    ...loadContractDocuments({ init, files, family: "wave-ticket", matcher: WAVE_TICKET_REGEX }),
    ...loadContractDocuments({ init, files, family: "handoff-packet", matcher: HANDOFF_PACKET_REGEX }),
    ...loadContractDocuments({ init, files, family: "delivery-plan", matcher: DELIVERY_PLAN_REGEX }),
    ...loadContractDocuments({ init, files, family: "delivery-manifest", matcher: DELIVERY_MANIFEST_REGEX }),
    ...loadContractDocuments({ init, files, family: "release-packet", matcher: RELEASE_PACKET_REGEX }),
  ];
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
  const files = listJsonFiles(init.runtimeLayout.reportsRoot);
  return loadContractDocuments({ init, files, family: "step-result", matcher: STEP_RESULT_REGEX });
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
  const files = listJsonFiles(init.runtimeLayout.artifactsRoot);
  return loadContractDocuments({ init, files, family: "promotion-decision", matcher: PROMOTION_DECISION_REGEX });
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
  const reportFiles = listJsonFiles(init.runtimeLayout.reportsRoot);

  return [
    ...loadContractDocuments({ init, files: reportFiles, family: "validation-report", matcher: VALIDATION_REPORT_REGEX }),
    ...loadContractDocuments({ init, files: reportFiles, family: "evaluation-report", matcher: EVALUATION_REPORT_REGEX }),
    ...loadContractDocuments({ init, files: reportFiles, family: "incident-report", matcher: INCIDENT_REPORT_REGEX }),
    ...listPromotionDecisions(options),
  ];
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function asStringArray(value) {
  return Array.isArray(value)
    ? value.filter((entry) => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim())
    : [];
}

/**
 * @param {string} runRef
 * @returns {string}
 */
function normalizeRunRef(runRef) {
  return runRef.startsWith("run://") ? runRef.slice("run://".length) : runRef;
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef?: string,
 *   projectProfile?: string,
 *   runtimeRoot?: string,
 * }} options
 */
export function listRuns(options = {}) {
  const packets = listPacketArtifacts(options);
  const stepResults = listStepResults(options);
  const quality = listQualityArtifacts(options);

  /** @type {Map<string, { run_id: string, packet_refs: string[], step_result_refs: string[], quality_refs: string[] }>} */
  const runMap = new Map();

  /**
   * @param {string} runId
   * @returns {{ run_id: string, packet_refs: string[], step_result_refs: string[], quality_refs: string[] }}
   */
  function ensureRun(runId) {
    if (!runMap.has(runId)) {
      runMap.set(runId, {
        run_id: runId,
        packet_refs: [],
        step_result_refs: [],
        quality_refs: [],
      });
    }
    return /** @type {{ run_id: string, packet_refs: string[], step_result_refs: string[], quality_refs: string[] }} */ (
      runMap.get(runId)
    );
  }

  for (const packet of packets) {
    const runRefs = asStringArray(packet.document.run_refs).map((runRef) => normalizeRunRef(runRef));
    for (const runRef of runRefs) {
      const run = ensureRun(runRef);
      run.packet_refs.push(packet.artifact_ref);
    }
  }

  for (const stepResult of stepResults) {
    const runId = typeof stepResult.document.run_id === "string" ? stepResult.document.run_id : null;
    if (!runId) continue;
    const run = ensureRun(normalizeRunRef(runId));
    run.step_result_refs.push(stepResult.artifact_ref);
  }

  for (const artifact of quality) {
    const runIds = [
      ...(typeof artifact.document.run_id === "string" ? [normalizeRunRef(artifact.document.run_id)] : []),
      ...asStringArray(artifact.document.linked_run_refs).map((runRef) => normalizeRunRef(runRef)),
    ];
    for (const runId of runIds) {
      const run = ensureRun(runId);
      run.quality_refs.push(artifact.artifact_ref);
    }
  }

  return [...runMap.values()].map((entry) => ({
    run_id: entry.run_id,
    packet_refs: Array.from(new Set(entry.packet_refs)),
    step_result_refs: Array.from(new Set(entry.step_result_refs)),
    quality_refs: Array.from(new Set(entry.quality_refs)),
  }));
}
