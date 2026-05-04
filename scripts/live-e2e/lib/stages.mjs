import path from "node:path";

import { asNonEmptyString, asStringArray, fileExists, nowIso, readJson, uniqueStrings } from "./common.mjs";

function resolveDurationSeconds(startedAt, finishedAt) {
  const startedMs = Date.parse(startedAt);
  const finishedMs = Date.parse(finishedAt);
  if (!Number.isFinite(startedMs) || !Number.isFinite(finishedMs) || finishedMs < startedMs) {
    return null;
  }
  return Math.round(((finishedMs - startedMs) / 1000) * 1000) / 1000;
}

export const DEFAULT_STAGES = Object.freeze([
  "bootstrap",
  "discovery",
  "spec",
  "planning",
  "handoff",
  "execution",
  "review",
  "qa",
  "delivery",
  "release",
]);

/**
 * @param {Record<string, unknown>} profile
 * @returns {string[]}
 */
export function getProfileStages(profile) {
  const stages = asStringArray(profile.stages);
  return stages.length > 0 ? stages : [...DEFAULT_STAGES];
}

/**
 * @param {string[]} stages
 * @returns {Record<string, { stage: string, status: string, evidence_refs: string[], summary: string | null, started_at: string | null, finished_at: string | null, duration_sec: number | null, failure_class: string | null, missing_evidence: string[], recommendation: string }>}
 */
export function createStageMap(stages) {
  /** @type {Record<string, { stage: string, status: string, evidence_refs: string[], summary: string | null, started_at: string | null, finished_at: string | null, duration_sec: number | null, failure_class: string | null, missing_evidence: string[], recommendation: string }>} */
  const map = {};
  for (const stage of stages) {
    map[stage] = {
      stage,
      status: "pending",
      evidence_refs: [],
      summary: null,
      started_at: null,
      finished_at: null,
      duration_sec: null,
      failure_class: null,
      missing_evidence: [],
      recommendation: "await-stage-execution",
    };
  }
  return map;
}

/**
 * @param {string[]} evidenceRefs
 * @returns {{ startedAt: string | null, finishedAt: string | null, durationSec: number | null }}
 */
export function resolveStageTimingFromEvidence(evidenceRefs) {
  const timings = evidenceRefs
    .filter((evidenceRef) => path.isAbsolute(evidenceRef) && fileExists(evidenceRef))
    .map((evidenceRef) => {
      try {
        const document = readJson(evidenceRef);
        return {
          startedAt: asNonEmptyString(document.started_at) || null,
          finishedAt: asNonEmptyString(document.finished_at) || null,
        };
      } catch {
        return { startedAt: null, finishedAt: null };
      }
    })
    .filter((timing) => timing.startedAt && timing.finishedAt);
  if (timings.length === 0) {
    return { startedAt: null, finishedAt: null, durationSec: null };
  }

  const startedAt = timings
    .map((timing) => /** @type {string} */ (timing.startedAt))
    .sort((left, right) => Date.parse(left) - Date.parse(right))[0];
  const finishedAt = timings
    .map((timing) => /** @type {string} */ (timing.finishedAt))
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0];
  return {
    startedAt,
    finishedAt,
    durationSec: resolveDurationSeconds(startedAt, finishedAt),
  };
}

/**
 * @param {string} status
 * @param {string | null} summary
 * @returns {string | null}
 */
export function classifyStageFailure(status, summary) {
  if (status !== "fail") return null;
  const normalized = (summary ?? "").toLowerCase();
  if (normalized.includes("permission")) return "permission-denied";
  if (normalized.includes("no-op") || normalized.includes("no non-bootstrap")) return "no-op";
  if (normalized.includes("adapter") || normalized.includes("runner")) return "adapter-failure";
  if (normalized.includes("handoff")) return "handoff-failed";
  if (normalized.includes("validation")) return "validation-failed";
  if (normalized.includes("delivery")) return "delivery-failed";
  if (normalized.includes("learning")) return "learning-closure-gap";
  if (normalized.includes("missing") || normalized.includes("did not materialize")) return "missing-evidence";
  return "stage-failed";
}

/**
 * @param {string} status
 * @param {string | null} failureClass
 * @returns {string}
 */
export function buildStageRecommendation(status, failureClass) {
  if (status === "pass") return "continue";
  if (status === "pending") return "await-stage-execution";
  if (failureClass === "permission-denied") return "inspect adapter permission evidence and runner auth mode";
  if (failureClass === "no-op") return "inspect Runtime Harness report and rerun implementation with meaningful changes";
  if (failureClass === "missing-evidence") return "inspect expected artifacts and rerun the failed public command";
  return "inspect stage evidence refs and command transcripts";
}

/**
 * @param {Record<string, { stage: string, status: string, evidence_refs: string[], summary: string | null, started_at: string | null, finished_at: string | null, duration_sec: number | null, failure_class: string | null, missing_evidence: string[], recommendation: string }>} stageMap
 * @param {string} stage
 * @param {string} status
 * @param {string[]} [evidenceRefs]
 * @param {string | null} [summary]
 */
export function markStage(stageMap, stage, status, evidenceRefs = [], summary = null) {
  const currentTime = nowIso();
  const timing = resolveStageTimingFromEvidence(evidenceRefs);
  const failureClass = classifyStageFailure(status, summary);
  const missingEvidence = status === "fail" && evidenceRefs.length === 0 ? ["stage-evidence"] : [];
  if (!stageMap[stage]) {
    stageMap[stage] = {
      stage,
      status,
      evidence_refs: uniqueStrings(evidenceRefs),
      summary,
      started_at: timing.startedAt ?? currentTime,
      finished_at: timing.finishedAt ?? currentTime,
      duration_sec: timing.durationSec ?? 0,
      failure_class: failureClass,
      missing_evidence: missingEvidence,
      recommendation: buildStageRecommendation(status, failureClass),
    };
    return;
  }
  stageMap[stage].status = status;
  stageMap[stage].evidence_refs = uniqueStrings(evidenceRefs);
  stageMap[stage].summary = summary;
  stageMap[stage].started_at = stageMap[stage].started_at ?? timing.startedAt ?? currentTime;
  stageMap[stage].finished_at = timing.finishedAt ?? currentTime;
  stageMap[stage].duration_sec =
    timing.durationSec ?? resolveDurationSeconds(stageMap[stage].started_at, stageMap[stage].finished_at) ?? 0;
  stageMap[stage].failure_class = failureClass;
  stageMap[stage].missing_evidence = missingEvidence;
  stageMap[stage].recommendation = buildStageRecommendation(status, failureClass);
}

/**
 * @param {Record<string, { stage: string, status: string, evidence_refs: string[], summary: string | null, started_at: string | null, finished_at: string | null, duration_sec: number | null, failure_class: string | null, missing_evidence: string[], recommendation: string }>} stageMap
 * @returns {Array<{ stage: string, status: string, evidence_refs: string[], summary: string | null, started_at: string | null, finished_at: string | null, duration_sec: number | null, failure_class: string | null, missing_evidence: string[], recommendation: string }>}
 */
export function flattenStageMap(stageMap) {
  return Object.values(stageMap);
}

/**
 * @param {Array<{ stage: string, status: string }>} stageResults
 */
export function summarizeStageCounts(stageResults) {
  let pass = 0;
  let fail = 0;
  let pending = 0;
  let skipped = 0;
  for (const stage of stageResults) {
    if (stage.status === "pass") pass += 1;
    else if (stage.status === "fail") fail += 1;
    else if (stage.status === "skipped") skipped += 1;
    else pending += 1;
  }
  return { pass, fail, pending, skipped };
}
