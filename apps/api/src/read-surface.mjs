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
const RUN_CONTROL_STATE_REGEX = /^run-control-state-.*\.json$/;

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
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function asNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function asString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * @param {unknown} startedAt
 * @param {unknown} finishedAt
 * @returns {number | null}
 */
function resolveDurationSeconds(startedAt, finishedAt) {
  if (typeof startedAt !== "string" || typeof finishedAt !== "string") {
    return null;
  }
  const startMs = Date.parse(startedAt);
  const finishMs = Date.parse(finishedAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(finishMs) || finishMs < startMs) {
    return null;
  }
  return Math.round(((finishMs - startMs) / 1000) * 1000) / 1000;
}

/**
 * @param {number[]} samples
 * @returns {{ samples: number, min: number | null, max: number | null, avg: number | null }}
 */
function summarizeSamples(samples) {
  if (samples.length === 0) {
    return {
      samples: 0,
      min: null,
      max: null,
      avg: null,
    };
  }

  const min = Math.min(...samples);
  const max = Math.max(...samples);
  const avg = samples.reduce((acc, value) => acc + value, 0) / samples.length;

  return {
    samples: samples.length,
    min: Math.round(min * 1000) / 1000,
    max: Math.round(max * 1000) / 1000,
    avg: Math.round(avg * 1000) / 1000,
  };
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
 * @returns {string[]}
 */
function listRunControlStateIds(options = {}) {
  const init = initializeProjectRuntime(options);
  const stateFiles = listJsonFiles(init.runtimeLayout.stateRoot).filter((filePath) =>
    RUN_CONTROL_STATE_REGEX.test(path.basename(filePath)),
  );

  /** @type {string[]} */
  const runIds = [];
  for (const filePath of stateFiles) {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (typeof parsed?.run_id === "string" && parsed.run_id.trim().length > 0) {
        runIds.push(parsed.run_id.trim());
      }
    } catch {
      // Ignore malformed runtime state snapshots.
    }
  }

  return runIds;
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
  const runControlStateIds = listRunControlStateIds(options);

  /**
   * @typedef {{
   *   run_id: string,
   *   packet_refs: string[],
   *   step_result_refs: string[],
   *   quality_refs: string[],
   *   finance_evidence: {
   *     route_ids: string[],
   *     wrapper_refs: string[],
   *     adapter_ids: string[],
   *     max_cost_usd: number | null,
   *     timeout_sec: number | null,
   *     max_cost_sources: string[],
   *     timeout_sources: string[],
   *     step_latency_samples_sec: number[],
   *     certification_latency_samples_sec: number[],
   *     baseline_pass_rate: number | null,
   *     candidate_pass_rate: number | null,
   *   },
   * }} RunSummaryEntry
   */

  /** @type {Map<string, RunSummaryEntry>} */
  const runMap = new Map();

  /**
   * @param {string} runId
   * @returns {RunSummaryEntry}
   */
  function ensureRun(runId) {
    if (!runMap.has(runId)) {
      runMap.set(runId, {
        run_id: runId,
        packet_refs: [],
        step_result_refs: [],
        quality_refs: [],
        finance_evidence: {
          route_ids: [],
          wrapper_refs: [],
          adapter_ids: [],
          max_cost_usd: null,
          timeout_sec: null,
          max_cost_sources: [],
          timeout_sources: [],
          step_latency_samples_sec: [],
          certification_latency_samples_sec: [],
          baseline_pass_rate: null,
          candidate_pass_rate: null,
        },
      });
    }
    return /** @type {RunSummaryEntry} */ (runMap.get(runId));
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

    const routedExecution = asRecord(stepResult.document.routed_execution);
    const routeResolution = asRecord(routedExecution.route_resolution);
    const assetResolution = asRecord(routedExecution.asset_resolution);
    const wrapperResolution = asRecord(assetResolution.wrapper);
    const adapterResolution = asRecord(routedExecution.adapter_resolution);
    const adapter = asRecord(adapterResolution.adapter);
    const policyResolution = asRecord(routedExecution.policy_resolution);
    const resolvedBounds = asRecord(policyResolution.resolved_bounds);
    const budget = asRecord(resolvedBounds.budget);

    const routeId = asString(routeResolution.resolved_route_id);
    if (routeId) run.finance_evidence.route_ids.push(routeId);
    const wrapperRef = asString(wrapperResolution.wrapper_ref);
    if (wrapperRef) run.finance_evidence.wrapper_refs.push(wrapperRef);
    const adapterId = asString(adapter.adapter_id);
    if (adapterId) run.finance_evidence.adapter_ids.push(adapterId);

    const maxCostUsd = asNumber(budget.max_cost_usd);
    if (maxCostUsd !== null) {
      run.finance_evidence.max_cost_usd =
        run.finance_evidence.max_cost_usd === null
          ? maxCostUsd
          : Math.max(run.finance_evidence.max_cost_usd, maxCostUsd);
    }
    const timeoutSec = asNumber(budget.timeout_sec);
    if (timeoutSec !== null) {
      run.finance_evidence.timeout_sec =
        run.finance_evidence.timeout_sec === null ? timeoutSec : Math.max(run.finance_evidence.timeout_sec, timeoutSec);
    }
    const maxCostSource = asString(budget.max_cost_source);
    if (maxCostSource) run.finance_evidence.max_cost_sources.push(maxCostSource);
    const timeoutSource = asString(budget.timeout_source);
    if (timeoutSource) run.finance_evidence.timeout_sources.push(timeoutSource);

    const stepLatencySec = resolveDurationSeconds(routedExecution.started_at, routedExecution.finished_at);
    if (stepLatencySec !== null) {
      run.finance_evidence.step_latency_samples_sec.push(stepLatencySec);
    }
  }

  for (const artifact of quality) {
    const runIds = [
      ...(typeof artifact.document.run_id === "string" ? [normalizeRunRef(artifact.document.run_id)] : []),
      ...asStringArray(artifact.document.linked_run_refs).map((runRef) => normalizeRunRef(runRef)),
    ];
    for (const runId of runIds) {
      const run = ensureRun(runId);
      run.quality_refs.push(artifact.artifact_ref);

      if (artifact.family !== "promotion-decision") {
        continue;
      }

      const evidenceSummary = asRecord(artifact.document.evidence_summary);
      const financeSignals = asRecord(evidenceSummary.finance_signals);
      const baselineComparison = asRecord(evidenceSummary.baseline_comparison);

      const captureLatency = asNumber(financeSignals.capture_latency_sec);
      if (captureLatency !== null) run.finance_evidence.certification_latency_samples_sec.push(captureLatency);
      const replayLatency = asNumber(financeSignals.replay_latency_sec);
      if (replayLatency !== null) run.finance_evidence.certification_latency_samples_sec.push(replayLatency);
      const totalLatency = asNumber(financeSignals.total_latency_sec);
      if (totalLatency !== null) run.finance_evidence.certification_latency_samples_sec.push(totalLatency);

      const baselinePassRate = asNumber(baselineComparison.baseline_pass_rate);
      if (baselinePassRate !== null) {
        run.finance_evidence.baseline_pass_rate = baselinePassRate;
      }
      const candidatePassRate = asNumber(baselineComparison.candidate_pass_rate);
      if (candidatePassRate !== null) {
        run.finance_evidence.candidate_pass_rate = candidatePassRate;
      }
    }
  }

  for (const runId of runControlStateIds) {
    ensureRun(normalizeRunRef(runId));
  }

  return [...runMap.values()].map((entry) => ({
    run_id: entry.run_id,
    packet_refs: Array.from(new Set(entry.packet_refs)),
    step_result_refs: Array.from(new Set(entry.step_result_refs)),
    quality_refs: Array.from(new Set(entry.quality_refs)),
    finance_evidence: {
      route_ids: Array.from(new Set(entry.finance_evidence.route_ids)),
      wrapper_refs: Array.from(new Set(entry.finance_evidence.wrapper_refs)),
      adapter_ids: Array.from(new Set(entry.finance_evidence.adapter_ids)),
      max_cost_usd: entry.finance_evidence.max_cost_usd,
      timeout_sec: entry.finance_evidence.timeout_sec,
      max_cost_sources: Array.from(new Set(entry.finance_evidence.max_cost_sources)),
      timeout_sources: Array.from(new Set(entry.finance_evidence.timeout_sources)),
      step_latency_sec: summarizeSamples(entry.finance_evidence.step_latency_samples_sec),
      certification_latency_sec: summarizeSamples(entry.finance_evidence.certification_latency_samples_sec),
      baseline_pass_rate: entry.finance_evidence.baseline_pass_rate,
      candidate_pass_rate: entry.finance_evidence.candidate_pass_rate,
    },
  }));
}
