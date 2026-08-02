export const FINANCE_MONITORING_DIMENSION_NAMES = Object.freeze([
  "project",
  "route",
  "bundle",
  "compiler_revision",
  "adapter",
]);

const MONITORING_EVIDENCE_CLASSES = Object.freeze([
  "production_monitoring",
  "offline_certification",
  "rehearsal",
]);

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
 * @returns {number | null}
 */
function asNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
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
 * @param {unknown} summary
 * @returns {{ samples: number, min: number | null, max: number | null, avg: number | null }}
 */
function normalizeSampleSummary(summary) {
  const record = asRecord(summary);
  const samplesRaw = asNumber(record.samples);
  const samples = samplesRaw === null ? 0 : Math.max(0, Math.floor(samplesRaw));
  return {
    samples,
    min: samples > 0 ? asNumber(record.min) : null,
    max: samples > 0 ? asNumber(record.max) : null,
    avg: samples > 0 ? asNumber(record.avg) : null,
  };
}

/**
 * @param {Array<{ samples: number, min: number | null, max: number | null, avg: number | null }>} summaries
 * @returns {{ samples: number, min: number | null, max: number | null, avg: number | null }}
 */
function combineSampleSummaries(summaries) {
  const populated = summaries.filter((entry) => entry.samples > 0);
  if (populated.length === 0) {
    return {
      samples: 0,
      min: null,
      max: null,
      avg: null,
    };
  }

  const samples = populated.reduce((total, entry) => total + entry.samples, 0);
  const weightedSum = populated.reduce((total, entry) => total + (entry.avg ?? 0) * entry.samples, 0);
  const minValues = populated.map((entry) => entry.min).filter((value) => typeof value === "number");
  const maxValues = populated.map((entry) => entry.max).filter((value) => typeof value === "number");
  return {
    samples,
    min: minValues.length > 0 ? Math.min(...minValues) : null,
    max: maxValues.length > 0 ? Math.max(...maxValues) : null,
    avg: Math.round((weightedSum / samples) * 1000) / 1000,
  };
}

/**
 * @param {number[]} values
 * @returns {{ unit: "usd", samples: number, total: number | null, min: number | null, max: number | null, avg: number | null }}
 */
function summarizeCost(values) {
  if (values.length === 0) {
    return {
      unit: "usd",
      samples: 0,
      total: null,
      min: null,
      max: null,
      avg: null,
    };
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    unit: "usd",
    samples: values.length,
    total: Math.round(total * 1000) / 1000,
    min: Math.min(...values),
    max: Math.max(...values),
    avg: Math.round((total / values.length) * 1000) / 1000,
  };
}

/**
 * @param {Record<string, unknown>} run
 */
function resolveRunFinance(run) {
  const finance = asRecord(run.finance_evidence);
  return {
    costLimitUsd: asNumber(finance.max_cost_usd),
    stepLatency: normalizeSampleSummary(finance.step_latency_sec),
    certificationLatency: normalizeSampleSummary(finance.certification_latency_sec),
    routeIds: asStringArray(finance.route_ids),
    promptBundleRefs: asStringArray(finance.prompt_bundle_refs),
    contextBundleRefs: asStringArray(finance.context_bundle_refs),
    compilerRevisionRefs: asStringArray(finance.compiler_revision_refs),
    adapterIds: asStringArray(finance.adapter_ids),
    evidenceRefs: uniqueSorted([
      ...asStringArray(run.step_result_refs),
      ...asStringArray(run.quality_refs),
      ...asStringArray(run.packet_refs),
    ]),
  };
}

/**
 * @param {Record<string, unknown>} event
 * @returns {"production_monitoring" | "offline_certification" | "rehearsal" | null}
 */
function classifyMonitoringEvent(event) {
  const payload = asRecord(event.payload);
  const rawScope =
    asString(payload.evidence_scope) ??
    asString(payload.monitoring_scope) ??
    asString(payload.execution_scope) ??
    asString(payload.scope) ??
    asString(payload.source);
  if (!rawScope) {
    return null;
  }

  const scope = rawScope.toLowerCase();
  if (scope === "production" || scope === "production-monitoring" || scope === "production_monitoring") {
    return "production_monitoring";
  }
  if (scope === "offline-certification" || scope === "offline_certification" || scope === "certification") {
    return "offline_certification";
  }
  if (scope === "rehearsal") {
    return "rehearsal";
  }
  return null;
}

/**
 * @param {Record<string, unknown>} event
 * @returns {string}
 */
function eventRef(event) {
  const eventId = asString(event.event_id) ?? "unknown";
  return `live-run-event://${eventId}`;
}

/**
 * @param {Record<string, unknown>[]} runSummaries
 * @param {Record<string, unknown>[]} liveRunEvents
 */
function buildEvidenceClassSummary(runSummaries, liveRunEvents) {
  /** @type {Record<string, { evidence_class: string, status: string, run_ids: string[], evidence_refs: string[], event_count: number }>} */
  const classes = {};
  for (const evidenceClass of MONITORING_EVIDENCE_CLASSES) {
    classes[evidenceClass] = {
      evidence_class: evidenceClass,
      status: "no-data",
      run_ids: [],
      evidence_refs: [],
      event_count: 0,
    };
  }

  for (const run of runSummaries) {
    const runId = asString(run.run_id);
    if (!runId) continue;
    const finance = resolveRunFinance(run);
    const offlineRefs = finance.evidenceRefs.filter(
      (ref) =>
        ref.includes("promotion-decision") ||
        ref.includes("evaluation-report") ||
        ref.includes("runtime-harness-report") ||
        ref.includes("compiler-revision-status"),
    );
    if (offlineRefs.length > 0 || finance.certificationLatency.samples > 0) {
      classes.offline_certification.run_ids.push(runId);
      classes.offline_certification.evidence_refs.push(...offlineRefs);
    }
    const rehearsalRefs = finance.evidenceRefs.filter((ref) => ref.includes("rehearsal"));
    if (rehearsalRefs.length > 0) {
      classes.rehearsal.run_ids.push(runId);
      classes.rehearsal.evidence_refs.push(...rehearsalRefs);
    }
  }

  for (const event of liveRunEvents) {
    const evidenceClass = classifyMonitoringEvent(event);
    if (!evidenceClass) continue;
    const runId = asString(event.run_id);
    if (runId) classes[evidenceClass].run_ids.push(runId);
    classes[evidenceClass].evidence_refs.push(eventRef(event));
    classes[evidenceClass].event_count += 1;
  }

  for (const summary of Object.values(classes)) {
    summary.run_ids = uniqueSorted(summary.run_ids);
    summary.evidence_refs = uniqueSorted(summary.evidence_refs);
    summary.status = summary.evidence_refs.length > 0 || summary.event_count > 0 ? "ready" : "no-data";
  }

  return classes;
}

/**
 * @param {{
 *   dimension: string,
 *   key: string,
 *   runIds: string[],
 *   costs: number[],
 *   stepLatencies: Array<{ samples: number, min: number | null, max: number | null, avg: number | null }>,
 *   certificationLatencies: Array<{ samples: number, min: number | null, max: number | null, avg: number | null }>,
 *   evidenceRefs: string[],
 * }} group
 */
function serializeGroup(group) {
  return {
    dimension: group.dimension,
    key: group.key,
    run_count: uniqueSorted(group.runIds).length,
    run_ids: uniqueSorted(group.runIds),
    cost_limit_usd: summarizeCost(group.costs),
    step_latency_sec: combineSampleSummaries(group.stepLatencies),
    certification_latency_sec: combineSampleSummaries(group.certificationLatencies),
    evidence_refs: uniqueSorted(group.evidenceRefs),
  };
}

/**
 * @param {{
 *   projectId: string,
 *   runSummaries: Array<Record<string, unknown>>,
 * }}
 */
function buildDimensionGroups({ projectId, runSummaries }) {
  /** @type {Map<string, { dimension: string, key: string, runIds: string[], costs: number[], stepLatencies: Array<{ samples: number, min: number | null, max: number | null, avg: number | null }>, certificationLatencies: Array<{ samples: number, min: number | null, max: number | null, avg: number | null }>, evidenceRefs: string[] }>} */
  const groups = new Map();

  /**
   * @param {string} dimension
   * @param {string} key
   * @param {string} runId
   * @param {ReturnType<typeof resolveRunFinance>} finance
   */
  function addGroup(dimension, key, runId, finance) {
    const groupKey = `${dimension}:${key}`;
    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        dimension,
        key,
        runIds: [],
        costs: [],
        stepLatencies: [],
        certificationLatencies: [],
        evidenceRefs: [],
      });
    }
    const group = groups.get(groupKey);
    if (!group) return;
    group.runIds.push(runId);
    if (finance.costLimitUsd !== null) group.costs.push(finance.costLimitUsd);
    group.stepLatencies.push(finance.stepLatency);
    group.certificationLatencies.push(finance.certificationLatency);
    group.evidenceRefs.push(...finance.evidenceRefs);
  }

  for (const run of runSummaries) {
    const runId = asString(run.run_id);
    if (!runId) continue;
    const finance = resolveRunFinance(run);
    addGroup("project", projectId, runId, finance);
    for (const routeId of finance.routeIds) addGroup("route", routeId, runId, finance);
    for (const bundleRef of uniqueSorted([...finance.promptBundleRefs, ...finance.contextBundleRefs])) {
      addGroup("bundle", bundleRef, runId, finance);
    }
    for (const compilerRevisionRef of finance.compilerRevisionRefs) {
      addGroup("compiler_revision", compilerRevisionRef, runId, finance);
    }
    for (const adapterId of finance.adapterIds) addGroup("adapter", adapterId, runId, finance);
  }

  /** @type {Record<string, ReturnType<typeof serializeGroup>[]>} */
  const byDimension = {};
  for (const dimension of FINANCE_MONITORING_DIMENSION_NAMES) {
    byDimension[dimension] = [];
  }
  for (const group of groups.values()) {
    byDimension[group.dimension].push(serializeGroup(group));
  }
  for (const dimension of Object.keys(byDimension)) {
    byDimension[dimension].sort((left, right) => left.key.localeCompare(right.key));
  }
  return byDimension;
}

/**
 * @param {{
 *   projectId: string,
 *   generatedAt?: string,
 *   runSummaries?: Array<Record<string, unknown>>,
 *   liveRunEvents?: Array<Record<string, unknown>>,
 * }} options
 */
export function buildFinanceMonitoringSnapshot(options) {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const runSummaries = options.runSummaries ?? [];
  const liveRunEvents = options.liveRunEvents ?? [];
  const evidenceClasses = buildEvidenceClassSummary(runSummaries, liveRunEvents);
  const dimensionGroups = buildDimensionGroups({
    projectId: options.projectId,
    runSummaries,
  });
  /** @type {Map<string, string[]>} */
  const productionEventRefsByRunId = new Map();
  for (const event of liveRunEvents) {
    if (classifyMonitoringEvent(event) !== "production_monitoring") continue;
    const runId = asString(event.run_id);
    if (!runId) continue;
    if (!productionEventRefsByRunId.has(runId)) {
      productionEventRefsByRunId.set(runId, []);
    }
    productionEventRefsByRunId.get(runId)?.push(eventRef(event));
  }

  const runBreakdown = runSummaries
    .map((run) => {
      const runId = asString(run.run_id);
      if (!runId) return null;
      const finance = resolveRunFinance(run);
      const hasCost = finance.costLimitUsd !== null;
      const hasStepLatency = finance.stepLatency.samples > 0;
      const hasCertificationLatency = finance.certificationLatency.samples > 0;
      const hasDimension =
        finance.routeIds.length > 0 ||
        finance.promptBundleRefs.length > 0 ||
        finance.contextBundleRefs.length > 0 ||
        finance.compilerRevisionRefs.length > 0 ||
        finance.adapterIds.length > 0;
      const productionMonitoringRefs = uniqueSorted(productionEventRefsByRunId.get(runId) ?? []);
      const hasProductionMonitoring = productionMonitoringRefs.length > 0;
      const missingSignals = [
        hasCost ? null : "cost",
        hasStepLatency ? null : "step_latency",
        hasCertificationLatency ? null : "certification_latency",
        hasDimension ? null : "dimension",
        hasProductionMonitoring ? null : "production_monitoring",
      ].filter((value) => typeof value === "string");

      return {
        run_id: runId,
        telemetry_state: missingSignals.length === 0 ? "ready" : "partial-data",
        missing_signals: missingSignals,
        dimensions: {
          project_id: options.projectId,
          route_ids: finance.routeIds,
          prompt_bundle_refs: finance.promptBundleRefs,
          context_bundle_refs: finance.contextBundleRefs,
          compiler_revision_refs: finance.compilerRevisionRefs,
          adapter_ids: finance.adapterIds,
        },
        cost_limit_usd: finance.costLimitUsd,
        step_latency_sec: finance.stepLatency,
        certification_latency_sec: finance.certificationLatency,
        production_monitoring_evidence_refs: productionMonitoringRefs,
        evidence_refs: finance.evidenceRefs,
      };
    })
    .filter((entry) => entry !== null);

  const denominator = runBreakdown.length;
  const noData = denominator === 0;
  const partialRunIds = runBreakdown
    .filter((run) => run.telemetry_state !== "ready")
    .map((run) => run.run_id);
  const status = noData
    ? "no-data"
    : partialRunIds.length > 0 || evidenceClasses.production_monitoring.status === "no-data"
      ? "partial"
      : "ready";
  const telemetryState = noData ? "no-data" : status === "ready" ? "ready" : "partial-data";

  const sourceRefs = uniqueSorted(runBreakdown.flatMap((run) => run.evidence_refs));

  return {
    schema_version: 1,
    snapshot_id: `${options.projectId}.finance-monitoring.snapshot.v1`,
    project_id: options.projectId,
    generated_at: generatedAt,
    status,
    no_data: noData,
    telemetry_state: telemetryState,
    dimension_names: [...FINANCE_MONITORING_DIMENSION_NAMES],
    tenant_like_grouping: {
      grouping_key: "project_id",
      tenant_semantics: "not-production-saas-tenancy",
      note: "Project grouping is used for installed and bounded multirepo reporting without claiming hosted tenant isolation.",
    },
    aggregation: {
      unit: "run",
      denominator,
      no_data_reason: noData ? "No durable run evidence was found for finance or monitoring aggregation." : null,
      partial_run_ids: uniqueSorted(partialRunIds),
    },
    finance: {
      cost_signal: "policy_max_cost_usd_or_provider_reported_cost_when_available",
      latency_signal: "step_and_certification_latency_seconds",
      dimensions: dimensionGroups,
    },
    monitoring_loop: {
      evidence_classes: evidenceClasses,
      separation_rules: {
        production_monitoring_requires_explicit_scope: true,
        offline_certification_families: ["promotion-decision", "evaluation-report", "runtime-harness-report"],
        rehearsal_evidence_is_not_production_monitoring: true,
      },
    },
    source_artifacts: {
      run_refs: runBreakdown.map((run) => `run://${run.run_id}`),
      evidence_refs: sourceRefs,
      live_event_refs: uniqueSorted(liveRunEvents.map(eventRef)),
    },
    run_breakdown: runBreakdown,
  };
}
