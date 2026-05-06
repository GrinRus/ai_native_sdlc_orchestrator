export const PLANNER_METRIC_NAMES = Object.freeze([
  "clean_close_rate",
  "retry_rate",
  "repair_rate",
  "blocker_rate",
]);

const BLOCKING_RUNTIME_DECISIONS = new Set(["block", "fail", "escalate"]);
const RETRY_RUNTIME_DECISIONS = new Set(["retry"]);
const REPAIR_RUNTIME_DECISIONS = new Set(["repair"]);
const OPEN_INCIDENT_STATUSES = new Set(["open", "recertify", "hold"]);

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
 * @returns {Record<string, unknown>[]}
 */
function asRecordArray(value) {
  return Array.isArray(value) ? value.map(asRecord).filter((entry) => Object.keys(entry).length > 0) : [];
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
 * @returns {string | null}
 */
function normalizeRunId(value) {
  const raw = asString(value);
  if (!raw) return null;
  return raw.startsWith("run://") ? raw.slice("run://".length) : raw;
}

/**
 * @param {string[]} values
 * @returns {string[]}
 */
function uniqueSorted(values) {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0))).sort((left, right) =>
    left.localeCompare(right),
  );
}

/**
 * @param {Record<string, unknown>} document
 * @returns {string[]}
 */
function resolveDocumentRunIds(document) {
  return uniqueSorted([
    normalizeRunId(document.run_id),
    ...asStringArray(document.linked_run_refs).map(normalizeRunId),
    ...asStringArray(document.run_refs).map(normalizeRunId),
  ].filter((value) => typeof value === "string"));
}

/**
 * @param {unknown} document
 * @returns {string[]}
 */
function collectRuntimeDecisions(document) {
  const record = asRecord(document);
  const decisions = [];
  const overall = asString(record.overall_decision);
  if (overall) decisions.push(overall);

  for (const step of asRecordArray(record.step_decisions)) {
    const decision = asString(step.runtime_harness_decision);
    if (decision) decisions.push(decision);
  }

  return uniqueSorted(decisions);
}

/**
 * @param {unknown} document
 * @param {"retry" | "repair"} action
 * @returns {number}
 */
function countRuntimeAttempts(document, action) {
  const record = asRecord(document);
  let attempts = 0;
  for (const step of asRecordArray(record.step_decisions)) {
    for (const attempt of asRecordArray(step.repair_attempts)) {
      const policyAction = asString(attempt.policy_action);
      const decision = asString(attempt.runtime_harness_decision);
      const result = asString(attempt.result);
      if (policyAction === action || decision === action || result === `succeeded_after_${action}`) {
        attempts += 1;
      }
    }
  }
  return attempts;
}

/**
 * @param {Array<{ artifact_ref?: string, family?: string, document?: Record<string, unknown> }>} artifacts
 * @param {string} family
 */
function filterArtifacts(artifacts, family) {
  return artifacts.filter((artifact) => artifact.family === family);
}

/**
 * @param {Array<{ artifact_ref?: string, document?: Record<string, unknown> }>} artifacts
 * @returns {string[]}
 */
function artifactRefs(artifacts) {
  return uniqueSorted(artifacts.map((artifact) => asString(artifact.artifact_ref)).filter((value) => value));
}

/**
 * @param {Array<Record<string, unknown>>} audits
 */
function auditRefs(audits) {
  return uniqueSorted(
    audits
      .map((audit) => asString(audit.artifact_ref) ?? asString(audit.file) ?? asString(asRecord(audit.document).audit_id))
      .filter((value) => value),
  );
}

/**
 * @param {{ name: string, numeratorRunIds: string[], denominator: number }}
 */
function buildRateMetric({ name, numeratorRunIds, denominator }) {
  const numerator = uniqueSorted(numeratorRunIds).length;
  return {
    name,
    unit: "ratio",
    numerator,
    denominator,
    value: denominator === 0 ? null : Math.round((numerator / denominator) * 1000) / 1000,
    no_data: denominator === 0,
    evidence_run_ids: uniqueSorted(numeratorRunIds),
  };
}

/**
 * @param {{
 *   runId: string,
 *   runSummary: Record<string, unknown> | null,
 *   artifacts: Array<{ family?: string, artifact_ref?: string, document?: Record<string, unknown> }>,
 *   audits: Array<Record<string, unknown>>,
 * }}
 */
function classifyRun({ runId, runSummary, artifacts, audits }) {
  const reviewReports = filterArtifacts(artifacts, "review-report");
  const reviewDecisions = filterArtifacts(artifacts, "review-decision");
  const runtimeReports = filterArtifacts(artifacts, "runtime-harness-report");
  const incidents = filterArtifacts(artifacts, "incident-report");

  const reviewPassed = reviewReports.some((artifact) => asString(asRecord(artifact.document).overall_status) === "pass");
  const approvedDecision = reviewDecisions.some((artifact) => {
    const document = asRecord(artifact.document);
    const gate = asRecord(document.delivery_gate);
    return asString(document.decision) === "approve" && asString(gate.status) === "pass";
  });
  const heldOrRepairDecision = reviewDecisions.some((artifact) => {
    const decision = asString(asRecord(artifact.document).decision);
    return decision === "hold" || decision === "request-repair";
  });

  const runtimeDecisions = runtimeReports.flatMap((artifact) => collectRuntimeDecisions(artifact.document));
  const runtimePassed = runtimeReports.some((artifact) => asString(asRecord(artifact.document).overall_decision) === "pass");
  const retryAttemptCount = runtimeReports.reduce((count, artifact) => count + countRuntimeAttempts(artifact.document, "retry"), 0);
  const repairAttemptCount = runtimeReports.reduce(
    (count, artifact) => count + countRuntimeAttempts(artifact.document, "repair"),
    0,
  );

  const hasRetry =
    runtimeDecisions.some((decision) => RETRY_RUNTIME_DECISIONS.has(decision)) || retryAttemptCount > 0;
  const hasRepair =
    runtimeDecisions.some((decision) => REPAIR_RUNTIME_DECISIONS.has(decision)) ||
    repairAttemptCount > 0 ||
    reviewDecisions.some((artifact) => asString(asRecord(artifact.document).decision) === "request-repair");
  const hasRuntimeBlocker = runtimeDecisions.some((decision) => BLOCKING_RUNTIME_DECISIONS.has(decision));
  const hasOpenIncident = incidents.some((artifact) => {
    const status = asString(asRecord(artifact.document).status);
    return status ? OPEN_INCIDENT_STATUSES.has(status) : true;
  });
  const blockedAuditCount = audits.filter((audit) => asBoolean(asRecord(audit.document).blocked)).length;
  const hasBlocker = hasRuntimeBlocker || hasOpenIncident || blockedAuditCount > 0 || heldOrRepairDecision;
  const hasReviewEvidence = reviewReports.length > 0 || reviewDecisions.length > 0;
  const hasRuntimeEvidence = runtimeReports.length > 0;
  const hasCleanClose = (approvedDecision || reviewPassed) && runtimePassed && !hasRetry && !hasRepair && !hasBlocker;

  let classification = "partial";
  if (hasCleanClose) {
    classification = "clean-close";
  } else if (hasBlocker) {
    classification = "blocked";
  } else if (hasRepair) {
    classification = "repair";
  } else if (hasRetry) {
    classification = "retry";
  }

  const runEvidenceRefs = uniqueSorted([
    ...artifactRefs(artifacts),
    ...auditRefs(audits),
    ...asStringArray(runSummary?.packet_refs),
    ...asStringArray(runSummary?.step_result_refs),
    ...asStringArray(runSummary?.quality_refs),
  ]);

  return {
    run_id: runId,
    classification,
    no_data: false,
    signals: {
      clean_close: hasCleanClose,
      retry: hasRetry,
      repair: hasRepair,
      blocker: hasBlocker,
      review_evidence: hasReviewEvidence,
      runtime_evidence: hasRuntimeEvidence,
      open_incident: hasOpenIncident,
      blocked_audit_count: blockedAuditCount,
      retry_attempt_count: retryAttemptCount,
      repair_attempt_count: repairAttemptCount,
      runtime_decisions: uniqueSorted(runtimeDecisions),
    },
    evidence_refs: runEvidenceRefs,
  };
}

/**
 * @param {{
 *   projectId: string,
 *   generatedAt?: string,
 *   runSummaries?: Array<Record<string, unknown>>,
 *   qualityArtifacts?: Array<{ family?: string, artifact_ref?: string, document?: Record<string, unknown> }>,
 *   runControlAudits?: Array<Record<string, unknown>>,
 * }} options
 */
export function buildPlannerMetricsSnapshot(options) {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const runSummaries = options.runSummaries ?? [];
  const qualityArtifacts = options.qualityArtifacts ?? [];
  const runControlAudits = options.runControlAudits ?? [];
  const runIds = new Set();

  for (const run of runSummaries) {
    const runId = normalizeRunId(run.run_id);
    if (runId) runIds.add(runId);
  }
  for (const artifact of qualityArtifacts) {
    for (const runId of resolveDocumentRunIds(asRecord(artifact.document))) {
      runIds.add(runId);
    }
  }
  for (const audit of runControlAudits) {
    const runId = normalizeRunId(asRecord(audit.document).run_id);
    if (runId) runIds.add(runId);
  }

  const sortedRunIds = Array.from(runIds).sort((left, right) => left.localeCompare(right));
  const runSummaryById = new Map(runSummaries.map((run) => [normalizeRunId(run.run_id), run]).filter(([runId]) => runId));

  const artifactsByRunId = new Map(sortedRunIds.map((runId) => [runId, []]));
  for (const artifact of qualityArtifacts) {
    const document = asRecord(artifact.document);
    for (const runId of resolveDocumentRunIds(document)) {
      if (!artifactsByRunId.has(runId)) artifactsByRunId.set(runId, []);
      artifactsByRunId.get(runId)?.push(artifact);
    }
  }

  const auditsByRunId = new Map(sortedRunIds.map((runId) => [runId, []]));
  for (const audit of runControlAudits) {
    const runId = normalizeRunId(asRecord(audit.document).run_id);
    if (!runId) continue;
    if (!auditsByRunId.has(runId)) auditsByRunId.set(runId, []);
    auditsByRunId.get(runId)?.push(audit);
  }

  const runBreakdown = sortedRunIds.map((runId) =>
    classifyRun({
      runId,
      runSummary: runSummaryById.get(runId) ?? null,
      artifacts: artifactsByRunId.get(runId) ?? [],
      audits: auditsByRunId.get(runId) ?? [],
    }),
  );

  const denominator = runBreakdown.length;
  const cleanCloseRunIds = runBreakdown.filter((run) => run.signals.clean_close).map((run) => run.run_id);
  const retryRunIds = runBreakdown.filter((run) => run.signals.retry).map((run) => run.run_id);
  const repairRunIds = runBreakdown.filter((run) => run.signals.repair).map((run) => run.run_id);
  const blockerRunIds = runBreakdown.filter((run) => run.signals.blocker).map((run) => run.run_id);
  const partialRunIds = runBreakdown
    .filter((run) => !run.signals.review_evidence || !run.signals.runtime_evidence)
    .map((run) => run.run_id);

  return {
    schema_version: 1,
    snapshot_id: `${options.projectId}.planner-metrics.snapshot.v1`,
    project_id: options.projectId,
    generated_at: generatedAt,
    status: denominator === 0 ? "no-data" : partialRunIds.length > 0 ? "partial" : "ready",
    no_data: denominator === 0,
    metric_names: [...PLANNER_METRIC_NAMES],
    aggregation: {
      unit: "run",
      denominator,
      no_data_reason: denominator === 0 ? "No durable run, review, incident, or audit artifacts were found." : null,
      partial_run_ids: uniqueSorted(partialRunIds),
    },
    source_artifacts: {
      run_refs: sortedRunIds.map((runId) => `run://${runId}`),
      review_report_refs: artifactRefs(filterArtifacts(qualityArtifacts, "review-report")),
      review_decision_refs: artifactRefs(filterArtifacts(qualityArtifacts, "review-decision")),
      runtime_harness_report_refs: artifactRefs(filterArtifacts(qualityArtifacts, "runtime-harness-report")),
      incident_report_refs: artifactRefs(filterArtifacts(qualityArtifacts, "incident-report")),
      audit_refs: auditRefs(runControlAudits),
    },
    metrics: {
      clean_close_rate: buildRateMetric({
        name: "clean_close_rate",
        numeratorRunIds: cleanCloseRunIds,
        denominator,
      }),
      retry_rate: buildRateMetric({
        name: "retry_rate",
        numeratorRunIds: retryRunIds,
        denominator,
      }),
      repair_rate: buildRateMetric({
        name: "repair_rate",
        numeratorRunIds: repairRunIds,
        denominator,
      }),
      blocker_rate: buildRateMetric({
        name: "blocker_rate",
        numeratorRunIds: blockerRunIds,
        denominator,
      }),
    },
    run_breakdown: runBreakdown,
  };
}
