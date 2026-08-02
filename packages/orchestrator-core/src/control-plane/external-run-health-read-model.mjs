import fs from "node:fs";
import path from "node:path";

import { loadContractFile } from "../../../contracts/src/index.mjs";
import {
  buildArtifactDisplaySummary,
  uniqueArtifactDisplaySummaries,
} from "../artifact-display-summary.mjs";

const EXTERNAL_RUN_PROJECTION_REGEX = /^external-run-projection-.+\.json$/u;

function listProjectionFiles(reportsRoot) {
  if (!fs.existsSync(reportsRoot)) return [];
  return fs.readdirSync(reportsRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && EXTERNAL_RUN_PROJECTION_REGEX.test(entry.name))
    .map((entry) => path.join(reportsRoot, entry.name));
}

function timeline(file, document) {
  const generatedAt = Date.parse(String(document.generated_at ?? ""));
  return Number.isFinite(generatedAt) ? generatedAt : fs.statSync(file).mtimeMs;
}

function sanitizeProjection(document) {
  const displaySummaries = document.artifact_display_summaries.map((summary) =>
    summary.raw_ref
      ? summary
      : buildArtifactDisplaySummary({
          artifactRef: summary.artifact_ref,
          type: summary.type,
          stage: summary.stage,
          label: summary.label,
          description: summary.description,
          status: summary.status,
          timestamp: summary.timestamp,
        }));
  return {
    run_id: document.run_id,
    profile_id: document.profile_id ?? null,
    status: document.status,
    report_status: document.report_status ?? null,
    generated_at: document.generated_at,
    current_step: document.current_step ?? null,
    blocked_step_id: document.blocked_step_id ?? null,
    pending_steps: document.pending_steps,
    completed_steps: document.completed_steps,
    missing_operator_decision_steps: document.missing_operator_decision_steps,
    missing_evidence_refs: document.missing_evidence_refs,
    failure_summary: document.failure_summary ?? null,
    pending_decision: document.pending_decision ?? null,
    resume_interaction_health: document.resume_interaction_health ?? {},
    controller_health: document.controller_health ?? {},
    blockers: document.blockers,
    artifact_display_summaries: displaySummaries,
    evidence_refs: document.evidence_refs,
  };
}

/**
 * Read generic ingress projections only from the selected project's canonical
 * report root. External controllers own adaptation into this public contract.
 *
 * @param {{ runtimeLayout: { reportsRoot: string } }} init
 * @param {{ limit?: number }} [options]
 * @returns {Array<Record<string, unknown>>}
 */
export function listExternalRunHealthProjectionsForRuntime(init, options = {}) {
  const projections = listProjectionFiles(init.runtimeLayout.reportsRoot)
    .flatMap((file) => {
      const loaded = loadContractFile({ filePath: file, family: "external-run-projection" });
      return loaded.ok ? [{ projection: sanitizeProjection(loaded.document), timeline: timeline(file, loaded.document) }] : [];
    })
    .sort((left, right) => right.timeline - left.timeline)
    .map((entry) => entry.projection);
  const limit = Number.isFinite(Number(options.limit)) && Number(options.limit) >= 0
    ? Math.floor(Number(options.limit))
    : null;
  return limit === null ? projections : projections.slice(0, limit);
}

export function readLatestExternalRunHealthProjectionForRuntime(init) {
  return listExternalRunHealthProjectionsForRuntime(init, { limit: 1 })[0] ?? null;
}

export function listExternalRunHealthArtifactDisplaySummariesForRuntime(init, options = {}) {
  return uniqueArtifactDisplaySummaries(
    listExternalRunHealthProjectionsForRuntime(init, options)
      .flatMap((entry) => Array.isArray(entry.artifact_display_summaries) ? entry.artifact_display_summaries : []),
  );
}
