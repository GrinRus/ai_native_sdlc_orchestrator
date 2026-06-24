import {
  CliUsageError,
  applyRunControlAction,
  appendRunEvent,
  attachUiLifecycle,
  detachUiLifecycle,
  listCompilerRevisionStatuses,
  listDeliveryManifests,
  listReviewDecisions,
  listPacketArtifacts,
  listPromotionDecisions,
  listQualityArtifacts,
  readRunControlState,
  readRunEventHistory,
  readRunPolicyHistory,
  listRuns,
  listStepResults,
  readStrategicSnapshot,
  openRunEventStream,
  readUiLifecycleState,
  readProjectState,
  loadContractFile,
  validateContractDocument,
  approveHandoffArtifacts,
  prepareHandoffArtifacts,
  certifyAssetPromotion,
  materializeCompilerRevisionStatus,
  runDeliveryDriver,
  materializeDeliveryPlan,
  normalizeDeliveryMode,
  runEvaluationSuite,
  replayHarnessCapture,
  applyIncidentRecertification,
  materializeLearningLoopArtifacts,
  materializeReviewDecision,
  resolveStepPolicyForStep,
  analyzeProjectRuntime,
  initializeProjectRuntime,
  validateProjectRuntime,
  verifyProjectRuntime,
  materializeIntakeArtifactPacket,
  materializeReviewReport,
  materializeRuntimeHarnessReport,
  executeRoutedStep,
  executeRuntimeHarnessControlledStep,
  ensureRequiredFlags,
  resolveOptionalStringFlag,
  resolveOptionalBooleanFlag,
  resolveOptionalIntegerFlag,
  resolveOptionalCsvFlag,
  resolveOptionalStringListFlag,
  uniqueStrings,
  readJson,
  writeJson,
  asStringArray,
  asPlainObject,
  normalizeForId,
  toRunRef,
  toEvidenceRef,
  evidenceRefExists,
  extractAdapterRawEvidenceRefs,
  resolveProviderExecutionStatus,
  resolveOptionalRefOrPathFlag,
  DEFAULT_LEARNING_BACKLOG_REFS,
  normalizeLearningRunStatus,
  isStrictRuntimeHarnessReport,
  runtimeHarnessReportHasMeaningfulPatch,
  assertRuntimeHarnessAllowsDelivery,
  finalizeRunControlState,
  normalizeRunRef,
  filterArtifactsByRunId,
  resolveRouteOverridesFlag,
  resolvePolicyOverridesFlag,
  resolveProjectRef,
  resolveRuntimeRoot
} from "../command-runtime.mjs";

export const QUALITY_COMMANDS = Object.freeze([
  "eval run",
  "harness replay",
  "asset promote",
  "asset freeze",
  "compiler revision",
  "harness certify",
  "review run",
  "review decide",
  "learning handoff"
]);

export const QUALITY_COMMAND_GROUP = Object.freeze({
  group_id: "quality",
  commands: QUALITY_COMMANDS,
});

/**
 * @param {Record<string, unknown>} outputState
 * @param {unknown} compilerRevisionStatus
 */
function assignCompilerRevisionOutput(outputState, compilerRevisionStatus) {
  if (
    typeof compilerRevisionStatus !== "object" ||
    compilerRevisionStatus === null ||
    !("report" in compilerRevisionStatus)
  ) {
    return;
  }
  const result = /** @type {{ report?: Record<string, unknown>, statusPath?: string, statusRef?: string, blocking?: boolean }} */ (
    compilerRevisionStatus
  );
  const report = result.report;
  if (!report) {
    return;
  }
  outputState.compilerRevisionStatusId = report.status_id;
  outputState.compilerRevisionStatusFile = result.statusPath ?? null;
  outputState.compilerRevisionStatusRef = result.statusRef ?? null;
  outputState.compilerRevisionRef = report.compiler_revision_ref;
  outputState.compilerRevisionLifecycleState = report.lifecycle_state;
  outputState.compilerRevisionStatus = report.status;
  outputState.compilerRevisionBlocking = result.blocking ?? false;
  outputState.compilerRevisionBlockingReasons = report.blocking_reasons;
  outputState.compilerRevisionCompatibility = report.compatibility;
  outputState.compilerRevisionDecisionHistory = report.decision_history;
}

/**
 * @param {{ command: string, flags: Record<string, string | string[] | true>, cwd: string, outputState: Record<string, unknown> }} context
 * @returns {boolean}
 */
export function handleQualityCommand(context) {
  const { command, flags, cwd, outputState } = context;
  if (command === "eval run") {
    ensureRequiredFlags(command, flags);

    const evalResult = runEvaluationSuite({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      projectProfile: resolveOptionalStringFlag("project-profile", flags["project-profile"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
      suiteRef: resolveOptionalStringFlag("suite-ref", flags["suite-ref"]),
      subjectRef: /** @type {string} */ (
        resolveOptionalStringFlag("subject-ref", flags["subject-ref"])
      ),
      subjectVersion: resolveOptionalStringFlag("subject-version", flags["subject-version"]),
    });

    outputState.resolvedProjectRef = evalResult.projectRoot;
    outputState.resolvedRuntimeRoot = evalResult.runtimeRoot;
    outputState.runtimeLayout = evalResult.runtimeLayout;
    outputState.runtimeStateFile = evalResult.stateFile;
    outputState.projectProfileRef = evalResult.projectProfileRef;
    outputState.evaluationReportId = evalResult.evaluationReport.report_id;
    outputState.evaluationReportFile = evalResult.evaluationReportPath;
    outputState.evaluationStatus = evalResult.evaluationReport.status;
    outputState.evaluationBlocking = evalResult.blocking;
    outputState.evaluationSuiteRef = evalResult.suiteRef;
    outputState.evaluationSubjectRef = evalResult.subjectRef;
  } else if (command === "harness replay") {
    ensureRequiredFlags(command, flags);

    const replayResult = replayHarnessCapture({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      projectProfile: resolveOptionalStringFlag("project-profile", flags["project-profile"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
      capturePath: /** @type {string} */ (resolveOptionalStringFlag("capture-file", flags["capture-file"])),
    });

    outputState.resolvedProjectRef = replayResult.projectRoot;
    outputState.resolvedRuntimeRoot = replayResult.runtimeRoot;
    outputState.runtimeLayout = replayResult.runtimeLayout;
    outputState.runtimeStateFile = replayResult.stateFile;
    outputState.projectProfileRef = replayResult.projectProfileRef;
    outputState.harnessReplayId = replayResult.replayReport.replay_id;
    outputState.harnessReplayFile = replayResult.replayReportPath;
    outputState.harnessReplayStatus = replayResult.replayReport.status;
    outputState.harnessReplayCompatible = replayResult.replayReport.compatibility.compatible === true;
    outputState.harnessReplayBlockedNextStep = replayResult.replayReport.blocked_next_step;
    outputState.harnessReplayEvidenceRefs = replayResult.replayReport.evidence_refs;
    outputState.harnessReplayEvaluationReportFile = replayResult.replayEvaluationReportPath;
  } else if (command === "asset promote") {
    ensureRequiredFlags(command, flags);

    const promoteResult = certifyAssetPromotion({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      projectProfile: resolveOptionalStringFlag("project-profile", flags["project-profile"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
      assetRef: /** @type {string} */ (resolveOptionalStringFlag("asset-ref", flags["asset-ref"])),
      subjectRef: /** @type {string} */ (resolveOptionalStringFlag("subject-ref", flags["subject-ref"])),
      suiteRef: resolveOptionalStringFlag("suite-ref", flags["suite-ref"]),
      stepClass: resolveOptionalStringFlag("step-class", flags["step-class"]),
      fromChannel: resolveOptionalStringFlag("from-channel", flags["from-channel"]) ?? "candidate",
      toChannel: resolveOptionalStringFlag("to-channel", flags["to-channel"]) ?? "stable",
    });

    outputState.resolvedProjectRef = promoteResult.projectRoot;
    outputState.resolvedRuntimeRoot = promoteResult.runtimeRoot;
    outputState.runtimeLayout = promoteResult.runtimeLayout;
    outputState.runtimeStateFile = promoteResult.stateFile;
    outputState.projectProfileRef = promoteResult.projectProfileRef;
    outputState.promotionDecisionId = promoteResult.decision.decision_id;
    outputState.promotionDecisionFile = promoteResult.decisionPath;
    outputState.promotionDecisionStatus = promoteResult.decision.status;
    outputState.promotionFromChannel = promoteResult.decision.from_channel ?? null;
    outputState.promotionToChannel = promoteResult.decision.to_channel ?? null;
    outputState.promotionRolloutAction =
      promoteResult.decision.evidence_summary?.rollout_decision?.action ?? null;
    outputState.promotionGovernanceChecks =
      promoteResult.decision.evidence_summary?.governance_checks ?? null;
    outputState.certificationEvaluationReportFile = promoteResult.evaluationReportPath;
    outputState.certificationHarnessCaptureFile = promoteResult.harnessCapturePath;
    outputState.certificationHarnessReplayFile = promoteResult.harnessReplayPath;
    assignCompilerRevisionOutput(outputState, promoteResult.compilerRevisionStatus);
  } else if (command === "asset freeze") {
    ensureRequiredFlags(command, flags);

    const freezeResult = certifyAssetPromotion({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      projectProfile: resolveOptionalStringFlag("project-profile", flags["project-profile"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
      assetRef: /** @type {string} */ (resolveOptionalStringFlag("asset-ref", flags["asset-ref"])),
      subjectRef: /** @type {string} */ (resolveOptionalStringFlag("subject-ref", flags["subject-ref"])),
      suiteRef: resolveOptionalStringFlag("suite-ref", flags["suite-ref"]),
      stepClass: resolveOptionalStringFlag("step-class", flags["step-class"]),
      fromChannel: resolveOptionalStringFlag("from-channel", flags["from-channel"]) ?? "stable",
      toChannel: "frozen",
    });

    outputState.resolvedProjectRef = freezeResult.projectRoot;
    outputState.resolvedRuntimeRoot = freezeResult.runtimeRoot;
    outputState.runtimeLayout = freezeResult.runtimeLayout;
    outputState.runtimeStateFile = freezeResult.stateFile;
    outputState.projectProfileRef = freezeResult.projectProfileRef;
    outputState.promotionDecisionId = freezeResult.decision.decision_id;
    outputState.promotionDecisionFile = freezeResult.decisionPath;
    outputState.promotionDecisionStatus = freezeResult.decision.status;
    outputState.promotionFromChannel = freezeResult.decision.from_channel ?? null;
    outputState.promotionToChannel = freezeResult.decision.to_channel ?? null;
    outputState.promotionRolloutAction =
      freezeResult.decision.evidence_summary?.rollout_decision?.action ?? null;
    outputState.promotionGovernanceChecks =
      freezeResult.decision.evidence_summary?.governance_checks ?? null;
    outputState.certificationEvaluationReportFile = freezeResult.evaluationReportPath;
    outputState.certificationHarnessCaptureFile = freezeResult.harnessCapturePath;
    outputState.certificationHarnessReplayFile = freezeResult.harnessReplayPath;
    assignCompilerRevisionOutput(outputState, freezeResult.compilerRevisionStatus);
  } else if (command === "compiler revision") {
    ensureRequiredFlags(command, flags);
    const action = /** @type {"inspect" | "promote" | "freeze" | "demote" | undefined} */ (
      resolveOptionalStringFlag("action", flags.action)
    );

    const statusResult = materializeCompilerRevisionStatus({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      projectProfile: resolveOptionalStringFlag("project-profile", flags["project-profile"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
      compilerRevisionRef: /** @type {string} */ (
        resolveOptionalStringFlag("compiler-revision-ref", flags["compiler-revision-ref"])
      ),
      action,
      promotionDecisionRef: resolveOptionalStringFlag("promotion-decision-ref", flags["promotion-decision-ref"]),
      compiledContextRefs: resolveOptionalCsvFlag("compiled-context-refs", flags["compiled-context-refs"]),
      evaluationRefs: resolveOptionalCsvFlag("evaluation-refs", flags["evaluation-refs"]),
      incidentRefs: resolveOptionalCsvFlag("incident-refs", flags["incident-refs"]),
      certificationEvidenceRefs: resolveOptionalCsvFlag(
        "certification-evidence-refs",
        flags["certification-evidence-refs"],
      ),
      compatibilityStatus: /** @type {"compatible" | "incompatible" | "unknown" | undefined} */ (
        resolveOptionalStringFlag("compatibility-status", flags["compatibility-status"])
      ),
    });

    outputState.resolvedProjectRef = statusResult.projectRoot;
    outputState.resolvedRuntimeRoot = statusResult.runtimeRoot;
    outputState.runtimeLayout = statusResult.runtimeLayout;
    outputState.runtimeStateFile = statusResult.stateFile;
    outputState.projectProfileRef = statusResult.projectProfileRef;
    outputState.compilerRevisionStatusId = statusResult.report.status_id;
    outputState.compilerRevisionStatusFile = statusResult.statusPath;
    outputState.compilerRevisionStatusRef = statusResult.statusRef;
    outputState.compilerRevisionRef = statusResult.report.compiler_revision_ref;
    outputState.compilerRevisionLifecycleState = statusResult.report.lifecycle_state;
    outputState.compilerRevisionStatus = statusResult.report.status;
    outputState.compilerRevisionBlocking = statusResult.blocking;
    outputState.compilerRevisionBlockingReasons = statusResult.report.blocking_reasons;
    outputState.compilerRevisionCompatibility = statusResult.report.compatibility;
    outputState.compilerRevisionDecisionHistory = statusResult.report.decision_history;
    outputState.compilerRevisionRecords = listCompilerRevisionStatuses({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      projectProfile: resolveOptionalStringFlag("project-profile", flags["project-profile"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
    });
    outputState.readOnly = (action ?? "inspect") === "inspect";
    outputState.futureControlHooks = [
      `asset promote --asset-ref ${statusResult.report.compiler_revision_ref} --subject-ref ${statusResult.report.compiler_revision_ref}`,
      `compiler revision --compiler-revision-ref ${statusResult.report.compiler_revision_ref} --action freeze --promotion-decision-ref <evidence://...>`,
      `evidence show --project-ref ${statusResult.projectRoot}`,
    ];
  } else if (command === "harness certify") {
    ensureRequiredFlags(command, flags);

    const certifyResult = certifyAssetPromotion({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      projectProfile: resolveOptionalStringFlag("project-profile", flags["project-profile"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
      assetRef: /** @type {string} */ (resolveOptionalStringFlag("asset-ref", flags["asset-ref"])),
      subjectRef: /** @type {string} */ (resolveOptionalStringFlag("subject-ref", flags["subject-ref"])),
      suiteRef: resolveOptionalStringFlag("suite-ref", flags["suite-ref"]),
      stepClass: resolveOptionalStringFlag("step-class", flags["step-class"]),
      fromChannel: resolveOptionalStringFlag("from-channel", flags["from-channel"]),
      toChannel: resolveOptionalStringFlag("to-channel", flags["to-channel"]),
    });

    outputState.resolvedProjectRef = certifyResult.projectRoot;
    outputState.resolvedRuntimeRoot = certifyResult.runtimeRoot;
    outputState.runtimeLayout = certifyResult.runtimeLayout;
    outputState.runtimeStateFile = certifyResult.stateFile;
    outputState.projectProfileRef = certifyResult.projectProfileRef;
    outputState.promotionDecisionId = certifyResult.decision.decision_id;
    outputState.promotionDecisionFile = certifyResult.decisionPath;
    outputState.promotionDecisionStatus = certifyResult.decision.status;
    outputState.certificationEvaluationReportFile = certifyResult.evaluationReportPath;
    outputState.certificationHarnessCaptureFile = certifyResult.harnessCapturePath;
    outputState.certificationHarnessReplayFile = certifyResult.harnessReplayPath;
    assignCompilerRevisionOutput(outputState, certifyResult.compilerRevisionStatus);

  } else if (command === "review run") {
    ensureRequiredFlags(command, flags);
    const runId = resolveOptionalStringFlag("run-id", flags["run-id"]);
    if (!runId) {
      throw new CliUsageError("Missing required flag '--run-id' for 'aor review run'.");
    }
    const executionRoot = resolveOptionalStringFlag("execution-root", flags["execution-root"]);

    const reviewResult = materializeReviewReport({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      projectProfile: resolveOptionalStringFlag("project-profile", flags["project-profile"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
      runId,
      executionRoot,
    });

    outputState.resolvedProjectRef = reviewResult.projectRoot;
    outputState.resolvedRuntimeRoot = reviewResult.runtimeRoot;
    outputState.runtimeLayout = reviewResult.runtimeLayout;
    outputState.runtimeStateFile = reviewResult.stateFile;
    outputState.projectProfileRef = reviewResult.projectProfileRef;
    outputState.reviewReportId = reviewResult.reviewReport.review_report_id;
    outputState.reviewReportFile = reviewResult.reviewReportFile;
    outputState.reviewOverallStatus = reviewResult.reviewReport.overall_status;
    outputState.reviewRecommendation = reviewResult.reviewReport.review_recommendation;
    outputState.reviewFeatureSizeFitStatus =
      typeof reviewResult.reviewReport.feature_size_fit === "object" && reviewResult.reviewReport.feature_size_fit
        ? reviewResult.reviewReport.feature_size_fit.status
        : null;
    outputState.reviewProviderTraceabilityStatus =
      typeof reviewResult.reviewReport.provider_traceability === "object" &&
      reviewResult.reviewReport.provider_traceability
        ? reviewResult.reviewReport.provider_traceability.status
        : null;
    const runtimeHarness = materializeRuntimeHarnessReport({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      projectProfile: resolveOptionalStringFlag("project-profile", flags["project-profile"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
      runId,
      executionRoot,
    });
    outputState.runtimeHarnessReportId = runtimeHarness.report.report_id;
    outputState.runtimeHarnessReportFile = runtimeHarness.reportPath;
    outputState.runtimeHarnessOverallDecision = runtimeHarness.report.overall_decision;
    outputState.readOnly = false;
    outputState.futureControlHooks = [
      `audit runs --run-id ${runId}`,
      `review decide --run-id ${runId} --decision approve`,
      `learning handoff --run-id ${runId}`,
      `evidence show --run-id ${runId}`,
    ];
  } else if (command === "review decide") {
    ensureRequiredFlags(command, flags);
    const runId = resolveOptionalStringFlag("run-id", flags["run-id"]);
    if (!runId) {
      throw new CliUsageError("Missing required flag '--run-id' for 'aor review decide'.");
    }
    const decision = resolveOptionalStringFlag("decision", flags.decision);
    if (decision !== "approve" && decision !== "hold" && decision !== "request-repair") {
      throw new CliUsageError("Flag '--decision' must be approve, hold, or request-repair.");
    }
    const executionRoot = resolveOptionalStringFlag("execution-root", flags["execution-root"]);

    const reviewResult = materializeReviewReport({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      projectProfile: resolveOptionalStringFlag("project-profile", flags["project-profile"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
      runId,
      executionRoot,
    });
    const runtimeHarness = materializeRuntimeHarnessReport({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      projectProfile: resolveOptionalStringFlag("project-profile", flags["project-profile"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
      runId,
      executionRoot,
    });
    const qualityArtifacts = listQualityArtifacts({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
    });
    const deliveryManifestRefs = listDeliveryManifests({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
    })
      .filter((artifact) => artifact.document.run_id === runId)
      .map((artifact) => artifact.artifact_ref);
    const learningHandoffRefs = qualityArtifacts
      .filter((artifact) => artifact.family === "learning-loop-handoff" && artifact.document.run_id === runId)
      .map((artifact) => artifact.artifact_ref);
    const priorDecisionRefs = listReviewDecisions({
      projectRoot: reviewResult.projectRoot,
      runtimeLayout: reviewResult.runtimeLayout,
      runId,
    }).map((entry) => entry.artifact_ref);
    const decisionResult = materializeReviewDecision({
      projectId: reviewResult.projectId,
      projectRoot: reviewResult.projectRoot,
      runtimeLayout: reviewResult.runtimeLayout,
      runId,
      decision,
      deciderRef: resolveOptionalStringFlag("decider-ref", flags["decider-ref"]),
      reason: resolveOptionalStringFlag("reason", flags.reason),
      reviewReport: reviewResult.reviewReport,
      reviewReportRef: reviewResult.reviewReportFile,
      runtimeHarnessReport: runtimeHarness.report,
      runtimeHarnessReportRef: runtimeHarness.reportPath,
      deliveryManifestRefs,
      learningHandoffRefs,
      evidenceRefs: priorDecisionRefs,
    });

    outputState.resolvedProjectRef = reviewResult.projectRoot;
    outputState.resolvedRuntimeRoot = reviewResult.runtimeRoot;
    outputState.runtimeLayout = reviewResult.runtimeLayout;
    outputState.runtimeStateFile = reviewResult.stateFile;
    outputState.projectProfileRef = reviewResult.projectProfileRef;
    outputState.reviewReportId = reviewResult.reviewReport.review_report_id;
    outputState.reviewReportFile = reviewResult.reviewReportFile;
    outputState.reviewOverallStatus = reviewResult.reviewReport.overall_status;
    outputState.reviewRecommendation = reviewResult.reviewReport.review_recommendation;
    outputState.runtimeHarnessReportId = runtimeHarness.report.report_id;
    outputState.runtimeHarnessReportFile = runtimeHarness.reportPath;
    outputState.runtimeHarnessOverallDecision = runtimeHarness.report.overall_decision;
    outputState.reviewDecisionId = decisionResult.decision.decision_id;
    outputState.reviewDecisionFile = decisionResult.decisionFile;
    outputState.reviewDecision = decisionResult.decision.decision;
    outputState.reviewDecisionGate =
      typeof decisionResult.decision.delivery_gate === "object" && decisionResult.decision.delivery_gate
        ? /** @type {{ status?: string }} */ (decisionResult.decision.delivery_gate).status ?? null
        : null;
    outputState.reviewDecisionReason = decisionResult.decision.reason;
    outputState.reviewDecisionEvidenceRefs = decisionResult.decision.evidence_refs;
    outputState.readOnly = false;
    outputState.futureControlHooks = [
      `deliver prepare --run-id ${runId} --require-review-decision`,
      `release prepare --run-id ${runId} --require-review-decision`,
      `evidence show --run-id ${runId}`,
    ];
  } else if (command === "learning handoff") {
    ensureRequiredFlags(command, flags);
    const runId = resolveOptionalStringFlag("run-id", flags["run-id"]);
    if (!runId) {
      throw new CliUsageError("Missing required flag '--run-id' for 'aor learning handoff'.");
    }
    const projectProfile = resolveOptionalStringFlag("project-profile", flags["project-profile"]);

    const projectState = readProjectState({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      projectProfile,
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
    });
    outputState.resolvedProjectRef = projectState.project_root;
    outputState.resolvedRuntimeRoot = projectState.runtime_root;
    outputState.runtimeLayout = projectState.runtime_layout;
    outputState.runtimeStateFile = projectState.state_file;
    outputState.projectProfileRef = projectState.project_profile_ref;

    const runState = readRunControlState({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      projectProfile,
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
      runId,
    });
    const runs = listRuns({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      projectProfile,
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
    });
    let runSummary = runs.find((entry) => entry.run_id === runId);
    if (!runSummary) {
      throw new CliUsageError(`Run '${runId}' was not found for learning handoff.`);
    }
    const runtimeHarness = materializeRuntimeHarnessReport({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      projectProfile,
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
      runId,
    });
    outputState.runtimeHarnessReportId = runtimeHarness.report.report_id;
    outputState.runtimeHarnessReportFile = runtimeHarness.reportPath;
    outputState.runtimeHarnessOverallDecision = runtimeHarness.report.overall_decision;
    runSummary =
      listRuns({
        cwd,
        projectRef: /** @type {string} */ (flags["project-ref"]),
        projectProfile,
        runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
      }).find((entry) => entry.run_id === runId) ?? runSummary;

    const qualityForRun = listQualityArtifacts({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      projectProfile,
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
    }).filter((artifact) => runSummary.quality_refs.includes(artifact.artifact_ref));
    const existingIncident =
      qualityForRun.find((artifact) => artifact.family === "incident-report") ?? null;
    const evalSuiteRefs = uniqueStrings(
      qualityForRun
        .filter((artifact) => artifact.family === "evaluation-report")
        .map((artifact) => (typeof artifact.document.suite_ref === "string" ? artifact.document.suite_ref : "")),
    );
    const reviewArtifact =
      qualityForRun.find((artifact) => artifact.family === "review-report") ?? null;
    const reviewDocument = asPlainObject(reviewArtifact?.document);
    outputState.reviewOverallStatus =
      typeof reviewDocument.overall_status === "string" ? reviewDocument.overall_status : outputState.reviewOverallStatus;
    outputState.reviewRecommendation =
      typeof reviewDocument.review_recommendation === "string"
        ? reviewDocument.review_recommendation
        : outputState.reviewRecommendation;
    const summary =
      outputState.reviewOverallStatus === "fail" || outputState.runtimeHarnessOverallDecision !== "pass"
        ? `Run '${runId}' requires follow-up before learning closure can be considered healthy.`
        : `Run '${runId}' completed public learning-loop handoff.`;
    const reviewFeatureTraceability = asPlainObject(reviewDocument.feature_traceability);
    const learningLoop = materializeLearningLoopArtifacts({
      projectId: projectState.project_id,
      projectRoot: projectState.project_root,
      runtimeLayout: { reportsRoot: projectState.runtime_layout.reports_root },
      runId,
      sourceKind: "cli-learning-handoff",
      runStatus: normalizeLearningRunStatus(
        typeof runState.state?.status === "string" ? runState.state.status : undefined,
      ),
      summary,
      evidenceRefs: uniqueStrings([
        ...runSummary.packet_refs,
        ...runSummary.step_result_refs,
        ...runSummary.quality_refs,
        runtimeHarness.reportRef,
      ]),
      linkedScorecardRefs: qualityForRun
        .filter((artifact) => artifact.family === "review-report")
        .map((artifact) => artifact.artifact_ref),
      evalSuiteRefs,
      backlogRefs: [...DEFAULT_LEARNING_BACKLOG_REFS],
      forceIncident: false,
      existingIncidentFile: existingIncident?.file,
      existingIncidentRef: existingIncident?.artifact_ref,
      matrixCell: asPlainObject(reviewFeatureTraceability.matrix_cell),
      coverageFollowUp: asPlainObject(reviewFeatureTraceability.coverage_follow_up),
    });
    outputState.learningLoopScorecardFile = learningLoop.scorecardFile;
    outputState.learningLoopHandoffFile = learningLoop.handoffFile;
    outputState.incidentReportFile = learningLoop.incidentFile ?? existingIncident?.file ?? null;
    outputState.readOnly = false;
    outputState.futureControlHooks = [
      `incident show --run-id ${runId}`,
      `audit runs --run-id ${runId}`,
      `evidence show --run-id ${runId}`,
    ];
  } else {
    return false;
  }
  return true;
}
