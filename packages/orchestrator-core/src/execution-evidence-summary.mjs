const RUNNER_OWNED_STATE_PREFIXES = [".codex/", ".claude/", ".qwen/", ".opencode/"];
const RUNTIME_OWNED_PREFIXES = [".aor/"];
const RUNTIME_OWNED_FILES = new Set(["project.aor.yaml"]);
const RUNNING_PROVIDER_STATUSES = new Set(["starting", "running", "silent-running", "artifact-updated", "timeout-risk"]);
const BLOCKING_RUNTIME_DECISIONS = new Set(["block", "fail"]);

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
 * @param {string[]} values
 * @returns {string[]}
 */
function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))];
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizePath(value) {
  return value.replace(/\\/g, "/").replace(/^\.\//u, "");
}

/**
 * @param {string} candidate
 * @param {string} prefix
 * @returns {boolean}
 */
function pathMatchesPrefix(candidate, prefix) {
  const normalizedPath = normalizePath(candidate);
  const normalizedPrefix = normalizePath(prefix);
  if (!normalizedPrefix) return false;
  if (normalizedPrefix.endsWith("/")) return normalizedPath.startsWith(normalizedPrefix);
  return normalizedPath === normalizedPrefix || normalizedPath.startsWith(`${normalizedPrefix}/`);
}

/**
 * @param {string} candidate
 * @returns {boolean}
 */
function isRunnerOwnedStatePath(candidate) {
  return RUNNER_OWNED_STATE_PREFIXES.some((prefix) => pathMatchesPrefix(candidate, prefix));
}

/**
 * @param {string} candidate
 * @returns {boolean}
 */
function isRuntimeOwnedPath(candidate) {
  const normalized = normalizePath(candidate);
  if (RUNTIME_OWNED_FILES.has(normalized)) return true;
  return RUNTIME_OWNED_PREFIXES.some((prefix) => pathMatchesPrefix(normalized, prefix));
}

/**
 * @param {Record<string, unknown>} semantics
 * @returns {string[]}
 */
function changedPathsFromSemantics(semantics) {
  return uniqueStrings([
    ...asStringArray(semantics.changed_paths_after_step),
    ...asStringArray(semantics.changed_paths_during_step),
    ...asStringArray(semantics.changed_paths),
    ...asStringArray(semantics.changedPaths),
    ...asStringArray(semantics.non_bootstrap_changed_paths),
    ...asStringArray(semantics.nonBootstrapChangedPaths),
    ...asStringArray(semantics.meaningful_changed_paths),
    ...asStringArray(semantics.meaningfulChangedPaths),
  ].map(normalizePath));
}

/**
 * @param {Record<string, unknown>} semantics
 * @returns {string[]}
 */
function meaningfulPathsFromSemantics(semantics) {
  return uniqueStrings([
    ...asStringArray(semantics.meaningful_changed_paths),
    ...asStringArray(semantics.meaningfulChangedPaths),
  ].map(normalizePath));
}

/**
 * @param {Record<string, unknown>} semantics
 * @returns {string[]}
 */
function runnerOwnedPathsFromSemantics(semantics) {
  return uniqueStrings([
    ...asStringArray(semantics.runner_owned_state_paths),
    ...asStringArray(semantics.runner_owned_state_paths_during_step),
    ...asStringArray(semantics.runnerOwnedStatePaths),
  ].map(normalizePath));
}

/**
 * @param {Array<Record<string, unknown>>} stepResults
 * @returns {Array<Record<string, unknown>>}
 */
function collectStepDecisionDocuments(stepResults) {
  return stepResults.flatMap((stepResult) => {
    const document = asRecord(stepResult.document ?? stepResult);
    const decisions = asRecord(document).step_decisions;
    return Array.isArray(decisions) ? decisions.map(asRecord) : [document];
  });
}

/**
 * @param {Array<Record<string, unknown>>} runtimeHarnessReports
 * @returns {Array<Record<string, unknown>>}
 */
function collectRuntimeHarnessDecisions(runtimeHarnessReports) {
  return runtimeHarnessReports.flatMap((artifact) => {
    const document = asRecord(artifact.document ?? artifact);
    const decisions = Array.isArray(document.step_decisions) ? document.step_decisions.map(asRecord) : [];
    return decisions;
  });
}

/**
 * @param {Array<Record<string, unknown>>} reviewReports
 * @returns {string[]}
 */
function collectReviewChangedPaths(reviewReports) {
  return uniqueStrings(reviewReports.flatMap((artifact) => {
    const document = asRecord(artifact.document ?? artifact);
    return asStringArray(asRecord(document.code_quality).changed_paths).map(normalizePath);
  }));
}

/**
 * @param {Array<Record<string, unknown>>} deliveryManifests
 * @returns {{ changedPaths: string[], remoteWriteResults: string[] }}
 */
function collectDeliveryEvidence(deliveryManifests) {
  const changedPaths = [];
  const remoteWriteResults = [];
  for (const artifact of deliveryManifests) {
    const document = asRecord(artifact.document ?? artifact);
    const repoDeliveries = Array.isArray(document.repo_deliveries) ? document.repo_deliveries.map(asRecord) : [];
    for (const delivery of repoDeliveries) {
      changedPaths.push(...asStringArray(delivery.changed_paths).map(normalizePath));
      const result = asString(delivery.writeback_result) ?? asString(delivery.remote_write_result);
      if (result) remoteWriteResults.push(result);
    }
  }
  return {
    changedPaths: uniqueStrings(changedPaths),
    remoteWriteResults: uniqueStrings(remoteWriteResults),
  };
}

/**
 * @param {Array<Record<string, unknown>>} verificationReports
 * @returns {string | null}
 */
function resolveVerificationReportStatus(verificationReports) {
  const latestReport = asRecord(verificationReports.at(-1)?.document ?? verificationReports.at(-1));
  return asString(latestReport.status) ?? asString(latestReport.overall_status);
}

/**
 * @param {string} groupId
 * @param {string} label
 * @param {string[]} paths
 * @param {string} severity
 * @param {string} description
 */
function pathGroup(groupId, label, paths, severity, description) {
  return {
    group_id: groupId,
    label,
    status: paths.length > 0 ? "present" : "empty",
    severity,
    paths,
    count: paths.length,
    description,
  };
}

/**
 * @param {string | null} runtimeDecision
 * @param {string} providerStatus
 * @param {string} realCodeChangeStatus
 * @param {string[]} runnerOwnedPaths
 * @returns {string[]}
 */
function buildBlockers(runtimeDecision, providerStatus, realCodeChangeStatus, runnerOwnedPaths) {
  return uniqueStrings([
    runnerOwnedPaths.length > 0 ? "Runner-owned state appeared inside the target checkout." : "",
    BLOCKING_RUNTIME_DECISIONS.has(runtimeDecision ?? "") ? `Runtime Harness decision is '${runtimeDecision}'.` : "",
    providerStatus === "interrupted" ? "Provider execution was stopped or interrupted." : "",
    providerStatus === "failed" || providerStatus === "fail" ? "Provider execution failed." : "",
    realCodeChangeStatus === "fail" ? "No mission-relevant changed paths were observed." : "",
  ]);
}

/**
 * @param {Record<string, unknown> | null | undefined} providerStepStatus
 * @returns {string}
 */
function resolveProviderExecutionStatus(providerStepStatus) {
  const status = asString(asRecord(providerStepStatus).status);
  if (!status) return "unknown";
  if (RUNNING_PROVIDER_STATUSES.has(status)) return "running";
  if (status === "completed") return "pass";
  if (status === "interrupted") return "interrupted";
  if (status === "failed") return "fail";
  return status;
}

/**
 * @param {{
 *   runId?: string,
 *   stepResults?: Array<Record<string, unknown>>,
 *   runtimeHarnessReports?: Array<Record<string, unknown>>,
 *   verificationReports?: Array<Record<string, unknown>>,
 *   reviewReports?: Array<Record<string, unknown>>,
 *   deliveryManifests?: Array<Record<string, unknown>>,
 *   providerStepStatus?: Record<string, unknown> | null,
 *   requiredPathPrefixes?: string[],
 *   policyContext?: Record<string, unknown>,
 * }} options
 */
export function buildExecutionEvidenceSummary(options = {}) {
  const stepDecisions = [
    ...collectStepDecisionDocuments(options.stepResults ?? []),
    ...collectRuntimeHarnessDecisions(options.runtimeHarnessReports ?? []),
  ];
  const semanticsEntries = stepDecisions.map((entry) => asRecord(entry.mission_semantics));
  const deliveryEvidence = collectDeliveryEvidence(options.deliveryManifests ?? []);
  const allChangedPaths = uniqueStrings([
    ...semanticsEntries.flatMap(changedPathsFromSemantics),
    ...collectReviewChangedPaths(options.reviewReports ?? []),
    ...deliveryEvidence.changedPaths,
  ]);
  const runnerOwnedPaths = uniqueStrings([
    ...semanticsEntries.flatMap(runnerOwnedPathsFromSemantics),
    ...allChangedPaths.filter(isRunnerOwnedStatePath),
  ]);
  const runtimeOwnedPaths = uniqueStrings(allChangedPaths.filter(isRuntimeOwnedPath));
  const meaningfulPaths = uniqueStrings(semanticsEntries.flatMap(meaningfulPathsFromSemantics));
  const requiredPrefixes = uniqueStrings((options.requiredPathPrefixes ?? []).map(normalizePath));
  const missionRelevantPaths = requiredPrefixes.length > 0
    ? meaningfulPaths.filter((changedPath) => requiredPrefixes.some((prefix) => pathMatchesPrefix(changedPath, prefix)))
    : meaningfulPaths;
  const blockedPathSet = new Set([...runnerOwnedPaths, ...runtimeOwnedPaths, ...missionRelevantPaths]);
  const scratchOrUnrelatedPaths = allChangedPaths.filter((changedPath) => !blockedPathSet.has(changedPath));
  const latestStepDecision = stepDecisions.at(-1) ?? {};
  const latestRuntimeHarnessReport = (options.runtimeHarnessReports ?? []).at(-1) ?? {};
  const latestRuntimeHarnessDocument = asRecord(latestRuntimeHarnessReport.document ?? latestRuntimeHarnessReport);
  const runtimeDecision =
    asString(latestStepDecision.runtime_harness_decision) ??
    asString(asRecord(latestRuntimeHarnessDocument.run_decision).overall_decision) ??
    asString(latestRuntimeHarnessDocument.overall_decision);
  const postRunVerificationStatus =
    asString(latestStepDecision.verification_status) ??
    resolveVerificationReportStatus(options.verificationReports ?? []) ??
    "unknown";
  const providerExecutionStatus = resolveProviderExecutionStatus(options.providerStepStatus);
  const providerStepStatusRecord = asRecord(options.providerStepStatus);
  const providerInterruptionOwner =
    providerExecutionStatus === "interrupted" ? asString(providerStepStatusRecord.interruption_owner) : null;
  const providerInterruptionReason =
    providerExecutionStatus === "interrupted" ? asString(providerStepStatusRecord.interruption_reason) : null;
  const providerInterruptionStatus =
    providerExecutionStatus === "interrupted" ? asString(providerStepStatusRecord.interruption_status) : null;
  const realCodeChangeStatus =
    runnerOwnedPaths.length > 0
      ? "fail"
      : missionRelevantPaths.length > 0
        ? "pass"
        : "fail";
  const reviewReport = asRecord((options.reviewReports ?? []).at(-1)?.document ?? (options.reviewReports ?? []).at(-1));
  const reviewStatus =
    asString(reviewReport.overall_status) ?? asString(asRecord(reviewReport.code_quality).status) ?? "unknown";
  const deliveryManifest = asRecord((options.deliveryManifests ?? []).at(-1)?.document ?? (options.deliveryManifests ?? []).at(-1));
  const deliveryReadinessStatus = asString(deliveryManifest.status) ?? ((options.deliveryManifests ?? []).length > 0 ? "materialized" : "not_materialized");
  const noUpstreamWriteStatus = deliveryEvidence.remoteWriteResults.some((result) => /\b(?:push|pushed|remote|upstream)\b/iu.test(result))
    ? "fail"
    : "pass";
  const blockers = buildBlockers(runtimeDecision, providerExecutionStatus, realCodeChangeStatus, runnerOwnedPaths);
  const overallStatus = blockers.length > 0 ? "blocked" : realCodeChangeStatus === "pass" ? "pass" : "warn";
  const providerRunning = RUNNING_PROVIDER_STATUSES.has(asString(asRecord(options.providerStepStatus).status) ?? "");
  const interrupted = providerExecutionStatus === "interrupted";

  return {
    run_id: options.runId ?? null,
    status: overallStatus,
    provider_execution_status: providerExecutionStatus,
    provider_interruption_owner: providerInterruptionOwner,
    provider_interruption_reason: providerInterruptionReason,
    provider_interruption_status: providerInterruptionStatus,
    runtime_harness_decision: runtimeDecision ?? "unknown",
    real_code_change_status: realCodeChangeStatus,
    post_run_verification_status: postRunVerificationStatus,
    review_status: reviewStatus,
    delivery_readiness_status: deliveryReadinessStatus,
    no_upstream_write_status: noUpstreamWriteStatus,
    required_path_prefixes: requiredPrefixes,
    changed_path_groups: [
      pathGroup("mission-relevant", "Mission-relevant changes", missionRelevantPaths, missionRelevantPaths.length > 0 ? "success" : "warning", "Changed paths that satisfy implementation evidence for the selected mission."),
      pathGroup("runtime-owned", "Runtime-owned artifacts", runtimeOwnedPaths, runtimeOwnedPaths.length > 0 ? "info" : "info", "AOR runtime files are expected evidence, not target implementation changes."),
      pathGroup("runner-owned-leak", "Runner-owned state leaks", runnerOwnedPaths, runnerOwnedPaths.length > 0 ? "critical" : "success", "Provider-local state inside the target checkout blocks delivery proof."),
      pathGroup("scratch-unrelated", "Scratch or unrelated output", scratchOrUnrelatedPaths, scratchOrUnrelatedPaths.length > 0 ? "warning" : "info", "Changed paths that do not prove the selected mission by themselves."),
    ],
    blockers,
    actions: [
      {
        action_id: "stop_provider",
        label: "Stop provider",
        enabled: providerRunning,
        command_surface: "aor run cancel",
        reason: providerRunning ? "Provider is still running." : "No running provider step is visible.",
      },
      {
        action_id: "save_partial_evidence",
        label: "Save partial evidence",
        enabled: providerRunning || interrupted,
        command_surface: "aor run status --json",
        reason: providerRunning || interrupted ? "Preserve current public run-control evidence." : "No partial provider state is visible.",
      },
      {
        action_id: "diagnose_current_step",
        label: "Diagnose current step",
        enabled: blockers.length > 0 || interrupted,
        command_surface: "aor run status --json",
        reason: "Inspect current public run-control evidence before deciding the next bounded action.",
      },
      {
        action_id: "retry_public_step",
        label: "Retry public step",
        enabled: interrupted || BLOCKING_RUNTIME_DECISIONS.has(runtimeDecision ?? "") || runtimeDecision === "retry" || runtimeDecision === "repair",
        command_surface: "aor run steer --target-step <step>",
        reason: "Route the next attempt through public run-control scope and audit evidence.",
      },
    ],
  };
}
