import fs from "node:fs";
import path from "node:path";

import { validateContractDocument } from "../../contracts/src/index.mjs";

import { captureHarnessReplayArtifact, replayHarnessCapture } from "./harness-capture-replay.mjs";
import { analyzeProjectRuntime } from "./project-analysis.mjs";
import { initializeProjectRuntime } from "./project-init.mjs";
import { validateProjectRuntime } from "./project-validate.mjs";

const PROMOTION_CHANNEL_VALUES = new Set(["draft", "candidate", "stable", "frozen", "demoted"]);
const FLAKY_PASS_RATE_DELTA_THRESHOLD = 0.02;
const MAJOR_DRIFT_DELTA_THRESHOLD = 0.1;
const CONTEXT_ASSET_REF_PATTERN = /^(context-(?:bundle|doc|rule|skill)):\/\/([^@]+)@v(\d+)$/u;
const DEFAULT_WITHOUT_CONTEXT_BUNDLE_REF = "context-bundle://context.bundle.runner.empty@v1";

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeForId(value) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+/, "").replace(/-+$/, "");
}

/**
 * @param {{ channel: string, flagName: string }} options
 */
function assertPromotionChannel(options) {
  if (!PROMOTION_CHANNEL_VALUES.has(options.channel)) {
    throw new Error(
      `Invalid ${options.flagName} '${options.channel}'. Expected one of: ${[...PROMOTION_CHANNEL_VALUES].join(", ")}.`,
    );
  }
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
 * @param {unknown} value
 * @returns {string | null}
 */
function asString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/**
 * @param {unknown} value
 * @returns {"pass" | "hold" | "fail"}
 */
function asCheckStatus(value) {
  return value === "pass" || value === "hold" || value === "fail" ? value : "hold";
}

/**
 * @param {unknown} subjectRef
 * @returns {{ kind: string, asset_id: string, version: number, normalized_ref: string, family_ref: string } | null}
 */
function parseContextAssetReference(subjectRef) {
  if (typeof subjectRef !== "string") {
    return null;
  }

  const match = CONTEXT_ASSET_REF_PATTERN.exec(subjectRef.trim());
  if (!match) {
    return null;
  }

  const kind = match[1];
  const assetId = match[2];
  const version = Number.parseInt(match[3], 10);
  if (!Number.isFinite(version)) {
    return null;
  }

  return {
    kind,
    asset_id: assetId,
    version,
    normalized_ref: `${kind}://${assetId}@v${version}`,
    family_ref: `${kind}://${assetId}`,
  };
}

/**
 * @param {unknown} filePath
 * @returns {Record<string, unknown> | null}
 */
function readJsonObject(filePath) {
  if (typeof filePath !== "string" || !fs.existsSync(filePath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * @param {{
 *   artifactsRoot: string,
 *   contextAsset: { kind: string, asset_id: string },
 * }} options
 */
function loadContextDecisionHistory(options) {
  if (!fs.existsSync(options.artifactsRoot)) {
    return [];
  }

  const files = fs
    .readdirSync(options.artifactsRoot)
    .filter((entry) => /^promotion-decision-.*\.json$/u.test(entry))
    .map((entry) => path.join(options.artifactsRoot, entry));

  const history = [];
  for (const filePath of files) {
    const parsed = readJsonObject(filePath);
    if (!parsed) {
      continue;
    }

    const subjectRef = asString(parsed.subject_ref);
    const parsedContextRef = parseContextAssetReference(subjectRef);
    if (!parsedContextRef) {
      continue;
    }

    if (parsedContextRef.kind !== options.contextAsset.kind || parsedContextRef.asset_id !== options.contextAsset.asset_id) {
      continue;
    }

    const fileStat = fs.statSync(filePath);
    const createdAt = asString(parsed.created_at) ?? new Date(fileStat.mtimeMs).toISOString();
    history.push({
      decision_id: asString(parsed.decision_id),
      decision_ref: filePath,
      subject_ref: parsedContextRef.normalized_ref,
      version: parsedContextRef.version,
      from_channel: asString(parsed.from_channel),
      to_channel: asString(parsed.to_channel),
      status: asString(parsed.status),
      created_at: createdAt,
      timeline_ms: Date.parse(createdAt),
    });
  }

  return history
    .sort((left, right) => {
      if (left.version !== right.version) {
        return left.version - right.version;
      }
      return left.timeline_ms - right.timeline_ms;
    })
    .map(({ timeline_ms: _timeline, ...entry }) => entry);
}

/**
 * @param {{ version: number, history: Array<{ version: number }> }} options
 */
function resolveContextUpdateStatus(options) {
  if (options.history.length === 0) {
    return {
      update_status: "initial",
      outdated: false,
      latest_known_version: null,
      superseded_by_version: null,
    };
  }

  const latestKnownVersion = options.history.reduce(
    (max, entry) => (entry.version > max ? entry.version : max),
    options.history[0].version,
  );

  if (options.version > latestKnownVersion) {
    return {
      update_status: "upgrade",
      outdated: false,
      latest_known_version: latestKnownVersion,
      superseded_by_version: null,
    };
  }

  if (options.version === latestKnownVersion) {
    return {
      update_status: "replay",
      outdated: false,
      latest_known_version: latestKnownVersion,
      superseded_by_version: null,
    };
  }

  return {
    update_status: "outdated",
    outdated: true,
    latest_known_version: latestKnownVersion,
    superseded_by_version: latestKnownVersion,
  };
}

/**
 * @param {{ stepResult: Record<string, unknown> }} options
 */
function extractCompiledContextProvenance(options) {
  const routedExecution = asRecord(options.stepResult.routed_execution);
  const contextCompilation = asRecord(routedExecution.context_compilation);
  const diagnostics = asRecord(contextCompilation.diagnostics);
  const fingerprint = asString(diagnostics.compiled_context_fingerprint);

  return [
    asString(contextCompilation.compiled_context_ref),
    asString(contextCompilation.compiled_context_file),
    ...(fingerprint ? [`sha256://${fingerprint}`] : []),
    ...asStringArray(asRecord(contextCompilation.compiled_context_artifact).context_bundle_refs),
  ].filter((entry) => typeof entry === "string");
}

/**
 * @param {{
 *   evaluationReport: Record<string, unknown>,
 * }} options
 */
function resolveEvaluationFindings(options) {
  const graderResults = asRecord(options.evaluationReport.grader_results);
  /** @type {Map<string, "high" | "critical">} */
  const findingsByCase = new Map();

  for (const graderResult of Object.values(graderResults)) {
    const resultRecord = asRecord(graderResult);
    const results = Array.isArray(resultRecord.case_results) ? resultRecord.case_results : [];
    for (const rawCase of results) {
      const caseRecord = asRecord(rawCase);
      if (asString(caseRecord.status) !== "fail") {
        continue;
      }
      const caseId = asString(caseRecord.case_id) ?? `unknown-${findingsByCase.size + 1}`;
      const severity = caseRecord.critical === true ? "critical" : "high";
      const previous = findingsByCase.get(caseId);
      if (!previous || previous === "high") {
        findingsByCase.set(caseId, severity);
      }
    }
  }

  const criticalCaseIds = [];
  const highCaseIds = [];
  for (const [caseId, severity] of findingsByCase.entries()) {
    if (severity === "critical") {
      criticalCaseIds.push(caseId);
    } else {
      highCaseIds.push(caseId);
    }
  }

  return {
    critical_count: criticalCaseIds.length,
    high_count: highCaseIds.length,
    critical_case_ids: criticalCaseIds,
    high_case_ids: highCaseIds,
  };
}

/**
 * @param {{
 *   withContextEvaluation: Record<string, unknown>,
 *   withoutContextEvaluation: Record<string, unknown>,
 *   withContextEvidence: { evaluation_report_ref: string | null, harness_capture_ref: string | null, harness_replay_ref: string | null },
 *   withoutContextEvidence: { evaluation_report_ref: string | null, harness_capture_ref: string | null, harness_replay_ref: string | null },
 * }} options
 */
function resolveContextQualityComparison(options) {
  const withContextSummary = asRecord(options.withContextEvaluation.summary_metrics);
  const withoutContextSummary = asRecord(options.withoutContextEvaluation.summary_metrics);
  const withContextStatus = asString(options.withContextEvaluation.status);
  const withoutContextStatus = asString(options.withoutContextEvaluation.status);
  const withContextPassRate = asNumber(withContextSummary.aggregate_pass_rate);
  const withoutContextPassRate = asNumber(withoutContextSummary.aggregate_pass_rate);

  const comparisonReady =
    withContextStatus !== null &&
    withoutContextStatus !== null &&
    withContextPassRate !== null &&
    withoutContextPassRate !== null;
  const passRateDelta =
    comparisonReady && withContextPassRate !== null && withoutContextPassRate !== null
      ? Math.round((withContextPassRate - withoutContextPassRate) * 1000) / 1000
      : null;

  return {
    comparison_ready: comparisonReady,
    with_context: {
      evaluation_status: withContextStatus,
      pass_rate: withContextPassRate,
      ...options.withContextEvidence,
    },
    without_context: {
      evaluation_status: withoutContextStatus,
      pass_rate: withoutContextPassRate,
      ...options.withoutContextEvidence,
    },
    pass_rate_delta: passRateDelta,
    recommendation:
      comparisonReady && passRateDelta !== null
        ? passRateDelta < 0
          ? "block-context-update"
          : passRateDelta === 0
            ? "manual-review"
            : "promote-context-update"
        : "collect-context-comparison-evidence",
    evidence_refs: [
      options.withContextEvidence.evaluation_report_ref,
      options.withContextEvidence.harness_capture_ref,
      options.withContextEvidence.harness_replay_ref,
      options.withoutContextEvidence.evaluation_report_ref,
      options.withoutContextEvidence.harness_capture_ref,
      options.withoutContextEvidence.harness_replay_ref,
    ].filter((entry) => typeof entry === "string"),
  };
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
 * @param {{
 *  captureResult: Record<string, unknown>,
 *  replayResult: Record<string, unknown>,
 * }} options
 */
function resolveGovernanceFinanceSignals(options) {
  const capture = asRecord(options.captureResult.capture);
  const captureTrace = asRecord(capture.trace);
  const selectedAssets = asRecord(captureTrace.selected_assets);
  const policyResolution = asRecord(selectedAssets.policy_resolution);
  const resolvedBounds = asRecord(policyResolution.resolved_bounds);
  const budget = asRecord(resolvedBounds.budget);
  const captureStepResult = asRecord(options.captureResult.stepResult);
  const captureExecution = asRecord(captureStepResult.routed_execution);
  const replayStepResult = asRecord(options.replayResult.stepResult);
  const replayExecution = asRecord(replayStepResult.routed_execution);

  const captureLatencySec = resolveDurationSeconds(captureExecution.started_at, captureExecution.finished_at);
  const replayLatencySec = resolveDurationSeconds(replayExecution.started_at, replayExecution.finished_at);
  const totalLatencySec =
    captureLatencySec !== null && replayLatencySec !== null
      ? Math.round((captureLatencySec + replayLatencySec) * 1000) / 1000
      : null;

  return {
    max_cost_usd: asNumber(budget.max_cost_usd),
    timeout_sec: asNumber(budget.timeout_sec),
    max_cost_source: asString(budget.max_cost_source),
    timeout_source: asString(budget.timeout_source),
    capture_latency_sec: captureLatencySec,
    replay_latency_sec: replayLatencySec,
    total_latency_sec: totalLatencySec,
  };
}

/**
 * @param {{
 *  evaluationStatus: string | null,
 *  replayStatus: string | null,
 *  captureResult: Record<string, unknown>,
 *  replayResult: Record<string, unknown>,
 * }} options
 */
export function resolveBaselineComparison(options) {
  const replayReport = asRecord(options.replayResult.replayReport);
  const baselineSnapshot = asRecord(replayReport.baseline_snapshot);
  const replaySnapshot = asRecord(replayReport.replay_snapshot);

  const baselineStatus = asString(baselineSnapshot.status);
  const baselinePassRate = asNumber(baselineSnapshot.aggregate_pass_rate);
  const candidateStatus = asString(options.evaluationStatus);
  const candidatePassRate = asNumber(replaySnapshot.aggregate_pass_rate);
  const comparable = replaySnapshot.comparable === true;

  const comparisonReady =
    baselineStatus !== null && baselinePassRate !== null && candidateStatus !== null && candidatePassRate !== null;
  const passRateDelta =
    comparisonReady && baselinePassRate !== null && candidatePassRate !== null
      ? Math.round((candidatePassRate - baselinePassRate) * 1000) / 1000
      : null;
  const driftDetected = passRateDelta !== null && passRateDelta < 0;
  const driftMagnitude = passRateDelta !== null ? Math.abs(passRateDelta) : null;
  const flakyDetected =
    driftDetected &&
    driftMagnitude !== null &&
    driftMagnitude > 0 &&
    driftMagnitude <= FLAKY_PASS_RATE_DELTA_THRESHOLD;
  const regressionDetected =
    options.replayStatus === "fail"
      ? comparisonReady
        ? driftDetected && !flakyDetected
        : true
      : driftDetected && !flakyDetected;
  const driftSeverity =
    driftDetected && driftMagnitude !== null
      ? driftMagnitude >= MAJOR_DRIFT_DELTA_THRESHOLD
        ? "major"
        : "minor"
      : "none";
  const triageRecommendation = regressionDetected
    ? "block-and-triage"
    : flakyDetected
      ? "collect-replay-samples"
      : comparisonReady
        ? "promote"
        : "complete-baseline-evidence";
  const escalationRequired = regressionDetected && driftSeverity === "major";

  return {
    baseline_status: baselineStatus,
    baseline_pass_rate: baselinePassRate,
    candidate_status: candidateStatus,
    candidate_pass_rate: candidatePassRate,
    pass_rate_delta: passRateDelta,
    comparable,
    comparison_ready: comparisonReady,
    drift_detected: driftDetected,
    drift_severity: driftSeverity,
    flaky_detected: flakyDetected,
    regression_detected: regressionDetected,
    triage_recommendation: triageRecommendation,
    escalation_required: escalationRequired,
    baseline_evaluation_report_ref: asString(options.captureResult.evaluationReportPath),
    replay_evaluation_report_ref: asString(replaySnapshot.evaluation_report_ref),
  };
}

/**
 * @param {{
 *  baselineComparison: Record<string, unknown>,
 *  toChannel: string,
 *  replayStatus: string | null,
 * }} options
 */
export function resolveRegressionTriage(options) {
  const baselineComparison = asRecord(options.baselineComparison);
  const passRateDelta = asNumber(baselineComparison.pass_rate_delta);
  const driftDetected = baselineComparison.drift_detected === true;
  const driftSeverity = asString(baselineComparison.drift_severity) ?? "none";
  const flakyDetected = baselineComparison.flaky_detected === true;
  const regressionDetected = baselineComparison.regression_detected === true;
  const triageRecommendation = asString(baselineComparison.triage_recommendation) ?? "complete-baseline-evidence";
  const escalationRequired = baselineComparison.escalation_required === true;

  return {
    compared_metric: "aggregate_pass_rate",
    pass_rate_delta: passRateDelta,
    drift_detected: driftDetected,
    drift_severity: driftSeverity,
    flaky_detected: flakyDetected,
    regression_detected: regressionDetected,
    triage_recommendation: triageRecommendation,
    escalation_required: escalationRequired,
    escalation_channel: options.toChannel,
    replay_status: options.replayStatus,
  };
}

/**
 * @param {{
 *  fromChannel: string,
 *  toChannel: string,
 *  decisionStatus: "pass" | "hold" | "fail",
 *  baselineComparisonRequired: boolean,
 *  baselineComparisonComplete: boolean,
 *  freezeGuardrailRequired: boolean,
 *  freezeGuardrailSatisfied: boolean,
 * }} options
 */
function resolveRolloutDecision(options) {
  const action =
    options.toChannel === "frozen"
      ? options.freezeGuardrailSatisfied
        ? "freeze"
        : "hold"
      : options.decisionStatus === "pass"
        ? options.toChannel === "stable"
          ? "promote"
          : options.toChannel === "demoted"
            ? "demote"
            : "promote"
        : options.decisionStatus === "hold"
          ? "hold"
          : "reject";

  return {
    action,
    requested_transition: {
      from_channel: options.fromChannel,
      to_channel: options.toChannel,
    },
    baseline_comparison_required: options.baselineComparisonRequired,
    baseline_comparison_complete: options.baselineComparisonComplete,
    freeze_guardrail_required: options.freezeGuardrailRequired,
    freeze_guardrail_satisfied: options.freezeGuardrailSatisfied,
  };
}

/**
 * @param {{
 *  validationStatus: string | null,
 *  evaluationStatus: string | null,
 *  replayStatus: string | null,
 *  evidenceComplete: boolean,
 *  financeSignalsComplete: boolean,
 *  qualityGateRequired: boolean,
 *  baselineComparisonRequired: boolean,
 *  baselineComparisonComplete: boolean,
 *  regressionDetected: boolean,
 *  flakyDetected: boolean,
 *  freezeGuardrailStatus: "pass" | "hold",
 *  missingEvidenceKinds: string[],
 *  contextAsset: boolean,
 *  contextProvenanceComplete: boolean,
 *  contextOutdated: boolean,
 *  contextSecurityGateStatus: "pass" | "hold" | "fail",
 *  contextSecuritySummary: string,
 *  contextQualityComparisonRequired: boolean,
 *  contextQualityComparisonComplete: boolean,
 * }} options
 * @returns {Array<{ check_id: string, status: "pass" | "hold" | "fail", summary: string }>}
 */
function buildGovernanceChecks(options) {
  const checks = [];
  const deterministicStatus =
    options.validationStatus === "fail" ? "fail" : options.validationStatus === "warn" ? "hold" : "pass";
  const replayCheckStatus =
    options.replayStatus === "pass"
      ? "pass"
      : options.replayStatus === "fail"
        ? options.flakyDetected
          ? "hold"
          : "fail"
        : "hold";

  checks.push({
    check_id: "deterministic-validation",
    status: deterministicStatus,
    summary:
      deterministicStatus === "pass"
        ? "Deterministic validation evidence is present and passing."
        : deterministicStatus === "hold"
          ? "Deterministic validation evidence is present but warning-level; governance stays on hold."
          : "Deterministic validation evidence failed and blocks governance promotion.",
  });

  checks.push({
    check_id: "evaluative-evidence",
    status: options.evaluationStatus === "pass" ? "pass" : "fail",
    summary:
      options.evaluationStatus === "pass"
        ? "Evaluation evidence passed suite thresholds."
        : "Evaluation evidence failed suite thresholds or was missing.",
  });

  checks.push({
    check_id: "harness-replay",
    status: replayCheckStatus,
    summary:
      replayCheckStatus === "pass"
        ? "Harness replay is compatible with baseline evidence."
        : replayCheckStatus === "hold" && options.replayStatus === "fail"
          ? "Harness replay drift is within flaky tolerance; collect replay samples before promotion."
          : options.replayStatus === "fail"
            ? "Harness replay introduced a regression against baseline evidence."
            : "Harness replay is not yet comparable with baseline evidence.",
  });

  checks.push({
    check_id: "evidence-completeness",
    status: options.evidenceComplete ? "pass" : "hold",
    summary: options.evidenceComplete
      ? "Required governance evidence files were materialized."
      : `Required governance evidence is incomplete: ${options.missingEvidenceKinds.join(", ")}.`,
  });

  checks.push({
    check_id: "finance-signals",
    status: options.financeSignalsComplete ? "pass" : "hold",
    summary: options.financeSignalsComplete
      ? "Cost and latency guardrail signals are present."
      : "Cost and latency guardrail signals are incomplete for governance review.",
  });

  checks.push({
    check_id: "regression-triage",
    status: options.regressionDetected ? "fail" : options.flakyDetected ? "hold" : "pass",
    summary: options.regressionDetected
      ? "Baseline drift requires regression triage before promotion."
      : options.flakyDetected
        ? "Baseline drift is within flaky tolerance; collect replay samples before promotion."
        : "Regression triage signals do not require escalation.",
  });

  checks.push({
    check_id: "baseline-comparison",
    status: options.baselineComparisonRequired ? (options.baselineComparisonComplete ? "pass" : "hold") : "pass",
    summary: options.baselineComparisonRequired
      ? options.baselineComparisonComplete
        ? "Baseline comparison evidence is present for channel transition."
        : "Baseline comparison evidence is required but incomplete."
      : "Baseline comparison evidence is optional for this channel transition.",
  });

  checks.push({
    check_id: "freeze-channel-guardrail",
    status: options.freezeGuardrailStatus,
    summary:
      options.freezeGuardrailStatus === "pass"
        ? "Freeze guardrail is satisfied for this transition."
        : "Freeze transition requires explicit regression evidence before channel freeze.",
  });

  if (options.contextAsset) {
    checks.push({
      check_id: "context-provenance",
      status: options.contextProvenanceComplete ? "pass" : "hold",
      summary: options.contextProvenanceComplete
        ? "Context promotion evidence includes immutable compiled-context provenance."
        : "Context promotion evidence is missing immutable compiled-context provenance.",
    });

    checks.push({
      check_id: "context-update-freshness",
      status: options.contextOutdated ? "hold" : "pass",
      summary: options.contextOutdated
        ? "Context update is outdated versus newer promoted context version history."
        : "Context update targets the latest known version lineage.",
    });

    checks.push({
      check_id: "context-security-gate",
      status: options.contextSecurityGateStatus,
      summary: options.contextSecuritySummary,
    });

    checks.push({
      check_id: "context-quality-comparison",
      status: options.contextQualityComparisonRequired
        ? options.contextQualityComparisonComplete
          ? "pass"
          : "hold"
        : "pass",
      summary: options.contextQualityComparisonRequired
        ? options.contextQualityComparisonComplete
          ? "With-context and without-context comparison evidence is present."
          : "With-context and without-context comparison evidence is required before context promotion."
        : "With-context and without-context comparison evidence is optional for this transition.",
    });
  }

  const hasFail = checks.some((entry) => entry.status === "fail");
  const hasHold = checks.some((entry) => entry.status === "hold");
  checks.push({
    check_id: "policy-quality-gate",
    status: options.qualityGateRequired ? (hasFail ? "fail" : hasHold ? "hold" : "pass") : "pass",
    summary: options.qualityGateRequired
      ? hasFail
        ? "Policy quality gate blocked by failing governance checks."
        : hasHold
          ? "Policy quality gate blocked until governance hold checks are resolved."
          : "Policy quality gate passed."
      : "Policy quality gate is not required for this step class.",
  });

  return checks;
}

/**
 * @param {{
 *  validationStatus?: string | null,
 *  evaluationStatus: string | null,
 *  replayStatus: string | null,
 *  evidenceComplete?: boolean,
 *  financeSignalsComplete?: boolean,
 *  qualityGateRequired?: boolean,
 *  baselineComparisonRequired?: boolean,
 *  baselineComparisonComplete?: boolean,
 *  flakyDetected?: boolean,
 *  freezeGuardrailStatus?: "pass" | "hold",
 * }} options
 * @returns {"pass" | "hold" | "fail"}
 */
export function resolveCertificationDecisionStatus(options) {
  const deterministicStatus =
    options.validationStatus === "fail" ? "fail" : options.validationStatus === "warn" ? "hold" : "pass";
  const evaluativeStatus = options.evaluationStatus === "pass" ? "pass" : "fail";
  const replayEvidenceStatus =
    options.replayStatus === "pass"
      ? "pass"
      : options.replayStatus === "fail"
        ? options.flakyDetected === true
          ? "hold"
          : "fail"
        : "hold";
  const evidenceStatus = options.evidenceComplete === false ? "hold" : "pass";
  const financeStatus = options.financeSignalsComplete === false ? "hold" : "pass";
  const baselineStatus =
    options.baselineComparisonRequired === true
      ? options.baselineComparisonComplete === true
        ? "pass"
        : "hold"
      : "pass";
  const freezeGuardrailStatus = options.freezeGuardrailStatus ?? "pass";
  const qualityGateRequired = options.qualityGateRequired !== false;

  const statuses = [
    deterministicStatus,
    evaluativeStatus,
    replayEvidenceStatus,
    evidenceStatus,
    financeStatus,
    baselineStatus,
    freezeGuardrailStatus,
  ];
  if (statuses.includes("fail")) {
    return "fail";
  }

  if (!qualityGateRequired) {
    return "pass";
  }

  if (statuses.includes("hold")) {
    return "hold";
  }

  return "pass";
}

/**
 * @param {{
 *  cwd?: string,
 *  projectRef?: string,
 *  projectProfile?: string,
 *  runtimeRoot?: string,
 *  assetRef: string,
 *  subjectRef: string,
 *  suiteRef?: string,
 *  stepClass?: string,
 *  fromChannel?: string,
 *  toChannel?: string,
 *  runRef?: string,
 *  withoutContextBundleRef?: string,
 * }} options
 */
export function certifyAssetPromotion(options) {
  const init = initializeProjectRuntime(options);
  const fromChannel = options.fromChannel ?? "candidate";
  const toChannel = options.toChannel ?? "stable";

  assertPromotionChannel({ channel: fromChannel, flagName: "--from-channel" });
  assertPromotionChannel({ channel: toChannel, flagName: "--to-channel" });

  const analysisResult = analyzeProjectRuntime({
    cwd: options.cwd,
    projectRef: options.projectRef,
    projectProfile: options.projectProfile,
    runtimeRoot: options.runtimeRoot,
  });

  const validationResult = validateProjectRuntime({
    cwd: options.cwd,
    projectRef: options.projectRef,
    projectProfile: options.projectProfile,
    runtimeRoot: options.runtimeRoot,
  });

  const stepClass = options.stepClass ?? "implement";
  const suiteRef = options.suiteRef ?? "suite.release.core@v1";
  const contextAsset = parseContextAssetReference(options.assetRef);
  const contextAssetEnabled = contextAsset !== null;

  const captureResult = captureHarnessReplayArtifact({
    cwd: options.cwd,
    projectRef: options.projectRef,
    projectProfile: options.projectProfile,
    runtimeRoot: options.runtimeRoot,
    stepClass,
    suiteRef,
    subjectRef: options.subjectRef,
  });

  const replayResult = replayHarnessCapture({
    cwd: options.cwd,
    projectRef: options.projectRef,
    projectProfile: options.projectProfile,
    runtimeRoot: options.runtimeRoot,
    capturePath: captureResult.capturePath,
  });

  /** @type {ReturnType<typeof captureHarnessReplayArtifact> | null} */
  let withoutContextCaptureResult = null;
  /** @type {ReturnType<typeof replayHarnessCapture> | null} */
  let withoutContextReplayResult = null;
  let withoutContextBundleRef = null;

  if (contextAssetEnabled) {
    withoutContextBundleRef = options.withoutContextBundleRef ?? DEFAULT_WITHOUT_CONTEXT_BUNDLE_REF;
    const contextBundleOverrides = {
      [stepClass]: [withoutContextBundleRef],
    };
    const withoutContextSubjectRef = `${options.subjectRef}::without-context`;

    withoutContextCaptureResult = captureHarnessReplayArtifact({
      cwd: options.cwd,
      projectRef: options.projectRef,
      projectProfile: options.projectProfile,
      runtimeRoot: options.runtimeRoot,
      stepClass,
      suiteRef,
      subjectRef: withoutContextSubjectRef,
      contextBundleOverrides,
    });

    withoutContextReplayResult = replayHarnessCapture({
      cwd: options.cwd,
      projectRef: options.projectRef,
      projectProfile: options.projectProfile,
      runtimeRoot: options.runtimeRoot,
      capturePath: withoutContextCaptureResult.capturePath,
      contextBundleOverrides,
    });
  }

  const evaluationStatus =
    typeof captureResult.evaluationReport.status === "string" ? captureResult.evaluationReport.status : null;
  const replayStatus =
    typeof replayResult.replayReport.status === "string" ? replayResult.replayReport.status : null;
  const validationStatus = typeof validationResult.report.status === "string" ? validationResult.report.status : null;
  const qualityGateRequired = Boolean(
    asRecord(
      asRecord(
        asRecord(asRecord(asRecord(captureResult.capture).trace).selected_assets).policy_resolution,
      ).policy,
    ).profile?.quality_gate?.required,
  );

  const evidenceChecks = [
    { kind: "validation-report", ref: validationResult.validationReportPath },
    { kind: "evaluation-report", ref: captureResult.evaluationReportPath },
    { kind: "harness-capture", ref: captureResult.capturePath },
    { kind: "harness-replay", ref: replayResult.replayReportPath },
    ...(contextAssetEnabled
      ? [
          { kind: "without-context-evaluation-report", ref: withoutContextCaptureResult?.evaluationReportPath ?? null },
          { kind: "without-context-harness-capture", ref: withoutContextCaptureResult?.capturePath ?? null },
          { kind: "without-context-harness-replay", ref: withoutContextReplayResult?.replayReportPath ?? null },
        ]
      : []),
  ];
  const missingEvidenceKinds = evidenceChecks
    .filter((entry) => typeof entry.ref !== "string" || !fs.existsSync(entry.ref))
    .map((entry) => entry.kind);
  const evidenceComplete = missingEvidenceKinds.length === 0;

  const financeSignals = resolveGovernanceFinanceSignals({
    captureResult: /** @type {Record<string, unknown>} */ (captureResult),
    replayResult: /** @type {Record<string, unknown>} */ (replayResult),
  });
  const baselineComparison = resolveBaselineComparison({
    evaluationStatus,
    replayStatus,
    captureResult: /** @type {Record<string, unknown>} */ (captureResult),
    replayResult: /** @type {Record<string, unknown>} */ (replayResult),
  });
  const baselineComparisonRequired =
    contextAssetEnabled || toChannel === "stable" || toChannel === "frozen" || toChannel === "demoted";
  const baselineComparisonComplete = baselineComparison.comparison_ready === true;

  const contextDecisionHistory = contextAsset
    ? loadContextDecisionHistory({
        artifactsRoot: init.runtimeLayout.artifactsRoot,
        contextAsset,
      })
    : [];
  const contextUpdateStatus = contextAsset
    ? resolveContextUpdateStatus({
        version: contextAsset.version,
        history: contextDecisionHistory,
      })
    : {
        update_status: null,
        outdated: false,
        latest_known_version: null,
        superseded_by_version: null,
      };
  const contextProvenanceRefs = contextAssetEnabled
    ? [
        ...extractCompiledContextProvenance({ stepResult: asRecord(captureResult.stepResult) }),
        ...extractCompiledContextProvenance({ stepResult: asRecord(replayResult.stepResult) }),
        ...(withoutContextCaptureResult
          ? extractCompiledContextProvenance({ stepResult: asRecord(withoutContextCaptureResult.stepResult) })
          : []),
        ...(withoutContextReplayResult
          ? extractCompiledContextProvenance({ stepResult: asRecord(withoutContextReplayResult.stepResult) })
          : []),
      ]
    : [];
  const uniqueContextProvenanceRefs = [...new Set(contextProvenanceRefs)];
  const contextProvenanceComplete = !contextAssetEnabled || uniqueContextProvenanceRefs.length > 0;

  const withContextFindings = resolveEvaluationFindings({
    evaluationReport: asRecord(captureResult.evaluationReport),
  });
  const withoutContextFindings =
    contextAssetEnabled && withoutContextCaptureResult
      ? resolveEvaluationFindings({
          evaluationReport: asRecord(withoutContextCaptureResult.evaluationReport),
        })
      : {
          critical_count: 0,
          high_count: 0,
          critical_case_ids: [],
          high_case_ids: [],
        };
  const contextCriticalFindings = withContextFindings.critical_count + withoutContextFindings.critical_count;
  const contextHighFindings = withContextFindings.high_count + withoutContextFindings.high_count;
  const contextSecurityGateStatus = contextAssetEnabled
    ? contextCriticalFindings > 0
      ? "fail"
      : contextHighFindings > 0
        ? "hold"
        : "pass"
    : "pass";
  const contextSecuritySummary =
    contextSecurityGateStatus === "fail"
      ? `Context security gate blocked by critical findings (critical=${contextCriticalFindings}, high=${contextHighFindings}).`
      : contextSecurityGateStatus === "hold"
        ? `Context security gate is on hold due to high findings (high=${contextHighFindings}).`
        : "Context security gate passed; no high/critical findings were detected.";

  const contextQualityComparisonRequired = contextAssetEnabled;
  const contextQualityComparison =
    contextAssetEnabled && withoutContextCaptureResult && withoutContextReplayResult
      ? resolveContextQualityComparison({
          withContextEvaluation: asRecord(captureResult.evaluationReport),
          withoutContextEvaluation: asRecord(withoutContextCaptureResult.evaluationReport),
          withContextEvidence: {
            evaluation_report_ref: asString(captureResult.evaluationReportPath),
            harness_capture_ref: asString(captureResult.capturePath),
            harness_replay_ref: asString(replayResult.replayReportPath),
          },
          withoutContextEvidence: {
            evaluation_report_ref: asString(withoutContextCaptureResult.evaluationReportPath),
            harness_capture_ref: asString(withoutContextCaptureResult.capturePath),
            harness_replay_ref: asString(withoutContextReplayResult.replayReportPath),
          },
        })
      : null;
  const contextQualityComparisonComplete =
    !contextQualityComparisonRequired || contextQualityComparison?.comparison_ready === true;

  const regressionTriage = resolveRegressionTriage({
    baselineComparison: baselineComparison,
    toChannel,
    replayStatus,
  });
  const freezeGuardrailRequired = toChannel === "frozen";
  const freezeGuardrailSatisfied =
    !freezeGuardrailRequired ||
    evaluationStatus !== "pass" ||
    baselineComparison.regression_detected === true;
  const freezeGuardrailStatus = freezeGuardrailSatisfied ? "pass" : "hold";
  const financeSignalsComplete =
    financeSignals.max_cost_usd !== null &&
    financeSignals.timeout_sec !== null &&
    financeSignals.capture_latency_sec !== null &&
    financeSignals.replay_latency_sec !== null;

  const governanceChecks = buildGovernanceChecks({
    validationStatus,
    evaluationStatus,
    replayStatus,
    evidenceComplete,
    financeSignalsComplete,
    qualityGateRequired,
    baselineComparisonRequired,
    baselineComparisonComplete,
    regressionDetected: baselineComparison.regression_detected === true,
    flakyDetected: baselineComparison.flaky_detected === true,
    freezeGuardrailStatus,
    missingEvidenceKinds,
    contextAsset: contextAssetEnabled,
    contextProvenanceComplete,
    contextOutdated: contextUpdateStatus.outdated === true,
    contextSecurityGateStatus: asCheckStatus(contextSecurityGateStatus),
    contextSecuritySummary,
    contextQualityComparisonRequired,
    contextQualityComparisonComplete,
  });
  let decisionStatus = resolveCertificationDecisionStatus({
    validationStatus,
    evaluationStatus,
    replayStatus,
    evidenceComplete,
    financeSignalsComplete,
    qualityGateRequired,
    baselineComparisonRequired,
    baselineComparisonComplete,
    flakyDetected: baselineComparison.flaky_detected === true,
    freezeGuardrailStatus,
  });
  if (contextAssetEnabled) {
    if (contextSecurityGateStatus === "fail") {
      decisionStatus = "fail";
    } else if (
      decisionStatus !== "fail" &&
      (contextUpdateStatus.outdated === true ||
        !contextProvenanceComplete ||
        !contextQualityComparisonComplete ||
        contextSecurityGateStatus === "hold")
    ) {
      decisionStatus = "hold";
    }
  }
  const rolloutDecision = resolveRolloutDecision({
    fromChannel,
    toChannel,
    decisionStatus,
    baselineComparisonRequired,
    baselineComparisonComplete,
    freezeGuardrailRequired,
    freezeGuardrailSatisfied,
  });

  const decisionId = `${init.projectId}.promotion.${normalizeForId(options.assetRef)}.${Date.now()}`;
  const decisionEvidenceRefs = [
    validationResult.validationReportPath,
    analysisResult.reportPath,
    captureResult.evaluationReportPath,
    captureResult.capturePath,
    replayResult.replayReportPath,
    replayResult.replayEvaluationReportPath,
    ...(contextQualityComparison ? contextQualityComparison.evidence_refs : []),
  ]
    .filter((entry) => typeof entry === "string")
    .filter((entry, index, values) => values.indexOf(entry) === index);

  const decision = {
    decision_id: decisionId,
    created_at: new Date().toISOString(),
    subject_ref: options.assetRef,
    run_id: options.runRef ?? null,
    linked_run_refs: options.runRef ? [`run://${options.runRef}`] : [],
    from_channel: fromChannel,
    to_channel: toChannel,
    evidence_refs: decisionEvidenceRefs,
    evidence_summary: {
      asset_ref: options.assetRef,
      subject_ref: options.subjectRef,
      suite_ref: captureResult.evaluationReport.suite_ref,
      evaluation_report_ref: captureResult.evaluationReportPath,
      harness_capture_ref: captureResult.capturePath,
      harness_replay_ref: replayResult.replayReportPath,
      replay_evaluation_report_ref: replayResult.replayEvaluationReportPath,
      deterministic_validation_report_ref: validationResult.validationReportPath,
      deterministic_validation_status: validationStatus,
      harness_replay_status: replayStatus,
      evaluation_status: evaluationStatus,
      baseline_comparison: baselineComparison,
      regression_triage: regressionTriage,
      rollout_decision: rolloutDecision,
      governance_checks: governanceChecks,
      finance_signals: financeSignals,
      ...(contextAsset
        ? {
            context_lifecycle: {
              context_asset_ref: contextAsset.normalized_ref,
              context_asset_family_ref: contextAsset.family_ref,
              context_asset_kind: contextAsset.kind,
              context_asset_version: contextAsset.version,
              update_status: contextUpdateStatus.update_status,
              outdated: contextUpdateStatus.outdated,
              latest_known_version: contextUpdateStatus.latest_known_version,
              superseded_by_version: contextUpdateStatus.superseded_by_version,
              security_gate_status: contextSecurityGateStatus,
              security_findings: {
                critical_count: contextCriticalFindings,
                high_count: contextHighFindings,
                critical_case_ids: [
                  ...withContextFindings.critical_case_ids,
                  ...withoutContextFindings.critical_case_ids,
                ],
                high_case_ids: [...withContextFindings.high_case_ids, ...withoutContextFindings.high_case_ids],
              },
              quality_comparison: contextQualityComparison,
              immutable_provenance_refs: uniqueContextProvenanceRefs,
              without_context_bundle_ref: withoutContextBundleRef,
              decision_trail: contextDecisionHistory.map((entry) => ({
                decision_id: entry.decision_id,
                decision_ref: entry.decision_ref,
                subject_ref: entry.subject_ref,
                version: entry.version,
                from_channel: entry.from_channel,
                to_channel: entry.to_channel,
                status: entry.status,
                created_at: entry.created_at,
              })),
            },
          }
        : {}),
      evidence_bar: {
        required: [
          "validation-report",
          "evaluation-report",
          "harness-capture",
          "harness-replay",
          "finance-signals",
          ...(baselineComparisonRequired ? ["baseline-comparison", "regression-triage"] : []),
          ...(freezeGuardrailRequired ? ["freeze-guardrail"] : []),
          ...(contextAssetEnabled
            ? ["context-provenance", "context-update-freshness", "context-security-gate", "context-quality-comparison"]
            : []),
        ],
        satisfied: [
          validationResult.validationReportPath ? "validation-report" : null,
          "evaluation-report",
          "harness-capture",
          "harness-replay",
          financeSignalsComplete ? "finance-signals" : null,
          baselineComparisonComplete ? "baseline-comparison" : null,
          baselineComparison.regression_detected === false && baselineComparison.flaky_detected === false
            ? "regression-triage"
            : null,
          freezeGuardrailSatisfied ? "freeze-guardrail" : null,
          replayResult.replayEvaluationReportPath ? "replay-evaluation-report" : null,
          contextProvenanceComplete ? "context-provenance" : null,
          contextUpdateStatus.outdated ? null : "context-update-freshness",
          contextSecurityGateStatus === "pass" ? "context-security-gate" : null,
          contextQualityComparisonComplete ? "context-quality-comparison" : null,
        ].filter((entry) => entry !== null),
      },
    },
    status: decisionStatus,
  };

  const decisionValidation = validateContractDocument({
    family: "promotion-decision",
    document: decision,
    source: "runtime://promotion-decision",
  });
  if (!decisionValidation.ok) {
    const issueSummary = decisionValidation.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Generated promotion decision failed contract validation: ${issueSummary}`);
  }

  const decisionPath = path.join(
    init.runtimeLayout.artifactsRoot,
    `promotion-decision-${normalizeForId(options.assetRef)}-${Date.now()}.json`,
  );
  fs.writeFileSync(decisionPath, `${JSON.stringify(decision, null, 2)}\n`, "utf8");

  return {
    ...init,
    decision,
    decisionPath,
    evaluationReportPath: captureResult.evaluationReportPath,
    harnessCapturePath: captureResult.capturePath,
    harnessReplayPath: replayResult.replayReportPath,
    replayEvaluationReportPath: replayResult.replayEvaluationReportPath,
    validationReportPath: validationResult.validationReportPath,
    analysisReportPath: analysisResult.reportPath,
    governanceChecks,
  };
}
