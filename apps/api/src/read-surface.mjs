import fs from "node:fs";
import path from "node:path";

import { loadContractFile } from "../../../packages/contracts/src/index.mjs";
import { initializeProjectRuntime } from "../../../packages/orchestrator-core/src/project-init.mjs";
import { readRunEvents } from "./live-event-stream.mjs";

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
const MASTER_BACKLOG_FILE = path.join("docs", "backlog", "mvp-implementation-backlog.md");

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
 * @returns {boolean}
 */
function asBoolean(value) {
  return value === true;
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
 * @param {unknown} value
 * @returns {Array<{ code: string, severity: string, message: string }>}
 */
function toGovernanceReasons(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry) => typeof entry === "object" && entry !== null)
    .map((entry) => {
      const reason = asRecord(entry);
      const code = asString(reason.code) ?? "governance-unknown";
      const severity = asString(reason.severity) ?? "unknown";
      const message = asString(reason.message) ?? "No governance message provided.";
      return { code, severity, message };
    });
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function toTimelineMs(value) {
  if (typeof value !== "string") {
    return Number.POSITIVE_INFINITY;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

/**
 * @param {string} markdown
 * @returns {Array<{ slice_id: string, wave_id: string, state: "ready" | "blocked" | "active" | "done" }>}
 */
function parseBacklogRows(markdown) {
  const linePattern = /^\|\s*(W\d+-S\d+)\s*\|(?:[^|]*\|){2}\s*(ready|blocked|active|done)\s*\|/i;
  /** @type {Array<{ slice_id: string, wave_id: string, state: "ready" | "blocked" | "active" | "done" }>} */
  const rows = [];

  for (const rawLine of markdown.split(/\r?\n/)) {
    const match = rawLine.match(linePattern);
    if (!match) {
      continue;
    }
    const sliceId = match[1];
    rows.push({
      slice_id: sliceId,
      wave_id: sliceId.split("-")[0],
      state: /** @type {"ready" | "blocked" | "active" | "done"} */ (match[2].toLowerCase()),
    });
  }

  return rows;
}

/**
 * @param {Array<{ wave_id: string, state: "ready" | "blocked" | "active" | "done" }>} rows
 */
function summarizeWaveProgress(rows) {
  /** @type {Map<string, { total: number, done: number, ready: number, blocked: number, active: number }>} */
  const waveMap = new Map();

  for (const row of rows) {
    if (!waveMap.has(row.wave_id)) {
      waveMap.set(row.wave_id, {
        total: 0,
        done: 0,
        ready: 0,
        blocked: 0,
        active: 0,
      });
    }
    const wave = /** @type {{ total: number, done: number, ready: number, blocked: number, active: number }} */ (
      waveMap.get(row.wave_id)
    );
    wave.total += 1;
    wave[row.state] += 1;
  }

  return [...waveMap.entries()]
    .sort((left, right) => Number.parseInt(left[0].slice(1), 10) - Number.parseInt(right[0].slice(1), 10))
    .map(([waveId, summary]) => ({
      wave_id: waveId,
      total_slices: summary.total,
      done_slices: summary.done,
      ready_slices: summary.ready,
      blocked_slices: summary.blocked,
      active_slices: summary.active,
      completion_ratio: summary.total > 0 ? Math.round((summary.done / summary.total) * 1000) / 1000 : 0,
    }));
}

/**
 * @param {{
 *   run_id: string,
 *   packet_refs: string[],
 *   quality_refs: string[],
 *   finance_evidence: { baseline_pass_rate: number | null, candidate_pass_rate: number | null },
 * }} run
 */
function classifyRunRisk(run) {
  const hasIncident = run.quality_refs.some((ref) => ref.includes("incident-report"));
  const baseline = run.finance_evidence.baseline_pass_rate;
  const candidate = run.finance_evidence.candidate_pass_rate;
  const hasRegression = baseline !== null && candidate !== null && candidate < baseline;

  if (hasIncident || hasRegression) {
    return {
      level: "high",
      hasIncident,
      hasRegression,
    };
  }

  if (run.quality_refs.length === 0 || run.packet_refs.length === 0) {
    return {
      level: "medium",
      hasIncident: false,
      hasRegression: false,
    };
  }

  return {
    level: "low",
    hasIncident: false,
    hasRegression: false,
  };
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
 *   policy_context: {
 *     route_ids: string[],
 *     policy_ids: string[],
 *     writeback_modes: string[],
 *     governance_decisions: string[],
 *     governance_reason_codes: string[],
 *     approval_required: boolean,
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
        policy_context: {
          route_ids: [],
          policy_ids: [],
          writeback_modes: [],
          governance_decisions: [],
          governance_reason_codes: [],
          approval_required: false,
        },
      });
    }
    return /** @type {RunSummaryEntry} */ (runMap.get(runId));
  }

  for (const packet of packets) {
    const runRefs = [
      ...asStringArray(packet.document.run_refs).map((runRef) => normalizeRunRef(runRef)),
      ...(typeof packet.document.run_id === "string" ? [normalizeRunRef(packet.document.run_id)] : []),
    ];
    for (const runRef of runRefs) {
      const run = ensureRun(runRef);
      run.packet_refs.push(packet.artifact_ref);

      if (packet.family !== "delivery-plan") {
        continue;
      }

      const governance = asRecord(packet.document.governance);
      const decision = asString(governance.decision);
      if (decision) {
        run.policy_context.governance_decisions.push(decision);
      }
      const reasons = toGovernanceReasons(governance.reasons);
      for (const reason of reasons) {
        run.policy_context.governance_reason_codes.push(reason.code);
      }
      const mode = asString(packet.document.delivery_mode);
      if (mode) {
        run.policy_context.writeback_modes.push(mode);
      }

      const approvedHandoff = asRecord(asRecord(packet.document.preconditions).approved_handoff);
      if (asBoolean(approvedHandoff.required)) {
        run.policy_context.approval_required = true;
      }
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
    if (routeId) {
      run.finance_evidence.route_ids.push(routeId);
      run.policy_context.route_ids.push(routeId);
    }
    const wrapperRef = asString(wrapperResolution.wrapper_ref);
    if (wrapperRef) run.finance_evidence.wrapper_refs.push(wrapperRef);
    const adapterId = asString(adapter.adapter_id);
    if (adapterId) run.finance_evidence.adapter_ids.push(adapterId);
    const policyId = asString(asRecord(policyResolution.policy).policy_id);
    if (policyId) run.policy_context.policy_ids.push(policyId);
    const writebackMode = asString(asRecord(resolvedBounds.writeback_mode).mode);
    if (writebackMode) run.policy_context.writeback_modes.push(writebackMode);
    const governanceDecision = asString(asRecord(policyResolution.governance_decision).decision);
    if (governanceDecision) run.policy_context.governance_decisions.push(governanceDecision);
    const governanceReasons = toGovernanceReasons(asRecord(policyResolution.governance_decision).reasons);
    for (const reason of governanceReasons) {
      run.policy_context.governance_reason_codes.push(reason.code);
    }
    if (asBoolean(asRecord(policyResolution.guardrails).approval_required)) {
      run.policy_context.approval_required = true;
    }

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
    policy_context: {
      route_ids: Array.from(new Set(entry.policy_context.route_ids)),
      policy_ids: Array.from(new Set(entry.policy_context.policy_ids)),
      writeback_modes: Array.from(new Set(entry.policy_context.writeback_modes)),
      governance_decisions: Array.from(new Set(entry.policy_context.governance_decisions)),
      governance_reason_codes: Array.from(new Set(entry.policy_context.governance_reason_codes)),
      approval_required: entry.policy_context.approval_required,
    },
  }));
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef?: string,
 *   projectProfile?: string,
 *   runtimeRoot?: string,
 *   runId: string,
 *   limit?: number,
 * }} options
 */
export function readRunEventHistory(options) {
  const runId = asString(options.runId);
  if (!runId) {
    throw new Error("readRunEventHistory requires runId.");
  }

  const normalizedRunId = normalizeRunRef(runId);
  const limitRaw = asNumber(options.limit);
  const limit = limitRaw !== null && limitRaw >= 0 ? Math.floor(limitRaw) : 50;
  const events = readRunEvents({
    cwd: options.cwd,
    projectRef: options.projectRef,
    projectProfile: options.projectProfile,
    runtimeRoot: options.runtimeRoot,
    runId: normalizedRunId,
  });

  const mappedEvents = events.map((event) => {
    const payload = asRecord(event.payload);
    const policyContext = asRecord(payload.policy_context);
    return {
      event_id: asString(event.event_id) ?? "",
      timestamp: asString(event.timestamp) ?? null,
      event_type: asString(event.event_type) ?? "unknown",
      sequence: asNumber(payload.sequence),
      summary: asString(payload.summary),
      control_action: asString(payload.control_action),
      step_id: asString(payload.step_id),
      status: asString(payload.status),
      policy_context:
        Object.keys(policyContext).length > 0
          ? {
              action: asString(policyContext.action),
              risk_tier: asString(policyContext.risk_tier),
              high_risk: asBoolean(policyContext.high_risk),
              approval_required: asBoolean(policyContext.approval_required),
              approval_ref_present: asBoolean(policyContext.approval_ref_present),
            }
          : null,
    };
  });

  return {
    run_id: normalizedRunId,
    total_events: mappedEvents.length,
    events: limit === 0 ? [] : mappedEvents.slice(-limit),
  };
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef?: string,
 *   projectProfile?: string,
 *   runtimeRoot?: string,
 *   runId: string,
 *   limit?: number,
 * }} options
 */
export function readRunPolicyHistory(options) {
  const runId = asString(options.runId);
  if (!runId) {
    throw new Error("readRunPolicyHistory requires runId.");
  }

  const normalizedRunId = normalizeRunRef(runId);
  const limitRaw = asNumber(options.limit);
  const limit = limitRaw !== null && limitRaw >= 0 ? Math.floor(limitRaw) : 200;

  /** @type {Array<{ timeline_ms: number, artifact_ref: string, entry: Record<string, unknown> }>} */
  const timelineEntries = [];

  for (const stepResult of listStepResults(options)) {
    const stepRunId = asString(stepResult.document.run_id);
    if (!stepRunId || normalizeRunRef(stepRunId) !== normalizedRunId) {
      continue;
    }

    const routedExecution = asRecord(stepResult.document.routed_execution);
    const policyResolution = asRecord(routedExecution.policy_resolution);
    const routeResolution = asRecord(routedExecution.route_resolution);
    const resolvedBounds = asRecord(policyResolution.resolved_bounds);
    const governance = asRecord(policyResolution.governance_decision);
    const governanceReasons = toGovernanceReasons(governance.reasons);
    const timelineAt =
      asString(routedExecution.finished_at) ?? asString(routedExecution.started_at) ?? asString(stepResult.document.created_at);

    timelineEntries.push({
      timeline_ms: toTimelineMs(timelineAt),
      artifact_ref: stepResult.artifact_ref,
      entry: {
        source: "step-result",
        artifact_ref: stepResult.artifact_ref,
        step_result_id: asString(stepResult.document.step_result_id),
        step_id: asString(stepResult.document.step_id),
        step_class: asString(stepResult.document.step_class),
        status: asString(stepResult.document.status),
        summary: asString(stepResult.document.summary),
        timeline_at: timelineAt,
        route_id: asString(routeResolution.resolved_route_id),
        policy_id: asString(asRecord(policyResolution.policy).policy_id),
        writeback_mode: asString(asRecord(resolvedBounds.writeback_mode).mode),
        approval_required: asBoolean(asRecord(policyResolution.guardrails).approval_required),
        governance_decision: asString(governance.decision),
        governance_reasons: governanceReasons,
      },
    });
  }

  for (const packet of listPacketArtifacts(options)) {
    if (packet.family !== "delivery-plan") {
      continue;
    }
    const packetRunId = asString(packet.document.run_id);
    if (!packetRunId || normalizeRunRef(packetRunId) !== normalizedRunId) {
      continue;
    }

    const governance = asRecord(packet.document.governance);
    const governanceReasons = toGovernanceReasons(governance.reasons);
    const timelineAt = asString(packet.document.created_at);

    timelineEntries.push({
      timeline_ms: toTimelineMs(timelineAt),
      artifact_ref: packet.artifact_ref,
      entry: {
        source: "delivery-plan",
        artifact_ref: packet.artifact_ref,
        plan_id: asString(packet.document.plan_id),
        step_class: asString(packet.document.step_class),
        status: asString(packet.document.status),
        timeline_at: timelineAt,
        writeback_mode: asString(packet.document.delivery_mode),
        governance_decision: asString(governance.decision),
        governance_reasons: governanceReasons,
      },
    });
  }

  const sorted = timelineEntries
    .sort((left, right) => {
      if (left.timeline_ms !== right.timeline_ms) {
        return left.timeline_ms - right.timeline_ms;
      }
      return left.artifact_ref.localeCompare(right.artifact_ref);
    })
    .map((entry) => entry.entry);

  return {
    run_id: normalizedRunId,
    entry_count: sorted.length,
    entries: limit === 0 ? [] : sorted.slice(-limit),
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
export function readStrategicSnapshot(options = {}) {
  const init = initializeProjectRuntime(options);
  const backlogPath = path.join(init.projectRoot, MASTER_BACKLOG_FILE);
  const backlogRows =
    fs.existsSync(backlogPath) && fs.statSync(backlogPath).isFile()
      ? parseBacklogRows(fs.readFileSync(backlogPath, "utf8"))
      : [];
  const waveProgress = summarizeWaveProgress(backlogRows);
  const runs = listRuns(options);

  const highRiskRunIds = [];
  const mediumRiskRunIds = [];
  const lowRiskRunIds = [];
  let incidentLinkedRuns = 0;
  let regressionRuns = 0;

  for (const run of runs) {
    const risk = classifyRunRisk(run);
    if (risk.hasIncident) {
      incidentLinkedRuns += 1;
    }
    if (risk.hasRegression) {
      regressionRuns += 1;
    }
    if (risk.level === "high") {
      highRiskRunIds.push(run.run_id);
    } else if (risk.level === "medium") {
      mediumRiskRunIds.push(run.run_id);
    } else {
      lowRiskRunIds.push(run.run_id);
    }
  }

  return {
    generated_at: new Date().toISOString(),
    wave_snapshot: {
      source_backlog_ref: MASTER_BACKLOG_FILE,
      total_slices: backlogRows.length,
      state_totals: {
        done: backlogRows.filter((row) => row.state === "done").length,
        ready: backlogRows.filter((row) => row.state === "ready").length,
        blocked: backlogRows.filter((row) => row.state === "blocked").length,
        active: backlogRows.filter((row) => row.state === "active").length,
      },
      waves: waveProgress,
    },
    risk_snapshot: {
      run_count: runs.length,
      level_totals: {
        high: highRiskRunIds.length,
        medium: mediumRiskRunIds.length,
        low: lowRiskRunIds.length,
      },
      high_risk_run_ids: highRiskRunIds,
      medium_risk_run_ids: mediumRiskRunIds,
      low_risk_run_ids: lowRiskRunIds,
      signal_totals: {
        incident_linked_runs: incidentLinkedRuns,
        regression_runs: regressionRuns,
      },
    },
  };
}
