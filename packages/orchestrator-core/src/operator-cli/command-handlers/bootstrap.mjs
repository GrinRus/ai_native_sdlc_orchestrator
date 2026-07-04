import fs from "node:fs";

import {
  CliUsageError,
  applyRunControlAction,
  appendRunEvent,
  attachUiLifecycle,
  detachUiLifecycle,
  listDeliveryManifests,
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
  runDeliveryDriver,
  materializeDeliveryPlan,
  normalizeDeliveryMode,
  runEvaluationSuite,
  replayHarnessCapture,
  applyIncidentRecertification,
  materializeLearningLoopArtifacts,
  resolveStepPolicyForStep,
  analyzeProjectRuntime,
  initializeProjectRuntime,
  validateProjectRuntime,
  planProjectVerification,
  verifyProjectRuntime,
  materializeIntakeArtifactPacket,
  materializeReviewReport,
  materializeRuntimeHarnessReport,
  executeRoutedStep,
  executeRuntimeHarnessControlledStep,
  ensureRequiredFlags,
  resolveOptionalStringFlag,
  resolveOptionalAssetModeFlag,
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

export const BOOTSTRAP_COMMANDS = Object.freeze([
  "project init",
  "intake create",
  "project analyze",
  "discovery run",
  "project validate",
  "project verify",
  "spec build",
  "handoff prepare",
  "wave create",
  "handoff approve"
]);

export const BOOTSTRAP_COMMAND_GROUP = Object.freeze({
  group_id: "bootstrap",
  commands: BOOTSTRAP_COMMANDS,
});

/**
 * @param {string | string[] | true | undefined} value
 * @returns {Array<{ kpi_id: string, name: string, target: string, measurement?: string }>}
 */
function resolveKpiFlags(value) {
  if (value === undefined) return [];
  if (value === true) {
    throw new CliUsageError("Flag '--kpi' requires a value.");
  }
  const values = Array.isArray(value) ? value : [value];
  return values.map((entry, index) => {
    const [kpiId, name, target, ...measurementParts] = entry.split(":").map((part) => part.trim());
    const measurement = measurementParts.join(":").trim();
    if (!kpiId || !name || !target) {
      throw new CliUsageError(
        `Flag '--kpi' value ${index + 1} must use 'kpi_id:name:target[:measurement]' format.`,
      );
    }
    return {
      kpi_id: kpiId,
      name,
      target,
      ...(measurement ? { measurement } : {}),
    };
  });
}

/**
 * @param {{ command: string, flags: Record<string, string | string[] | true>, cwd: string, outputState: Record<string, unknown> }} context
 * @returns {boolean}
 */
export function handleBootstrapCommand(context) {
  const { command, flags, cwd, outputState } = context;
  if (command === "project init") {
    const initResult = initializeProjectRuntime({
      cwd,
      projectRef: resolveOptionalStringFlag("project-ref", flags["project-ref"]),
      projectProfile: resolveOptionalStringFlag("project-profile", flags["project-profile"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
      assetMode: resolveOptionalAssetModeFlag(flags["asset-mode"]),
      materializeProjectProfile: resolveOptionalBooleanFlag(
        "materialize-project-profile",
        flags["materialize-project-profile"],
      ),
      bootstrapTemplate: resolveOptionalStringFlag("bootstrap-template", flags["bootstrap-template"]),
      materializeBootstrapAssets: resolveOptionalBooleanFlag(
        "materialize-bootstrap-assets",
        flags["materialize-bootstrap-assets"],
      ),
      repoBuildCommands: resolveOptionalStringListFlag("repo-build-command", flags["repo-build-command"]),
      repoLintCommands: resolveOptionalStringListFlag("repo-lint-command", flags["repo-lint-command"]),
      repoTestCommands: resolveOptionalStringListFlag("repo-test-command", flags["repo-test-command"]),
    });

    outputState.resolvedProjectRef = initResult.projectRoot;
    outputState.resolvedRuntimeRoot = initResult.runtimeRoot;
    outputState.runtimeLayout = initResult.runtimeLayout;
    outputState.runtimeStateFile = initResult.stateFile;
    outputState.projectProfileRef = initResult.projectProfileRef;
    outputState.artifactPacketId = initResult.artifactPacketId;
    outputState.artifactPacketFile = initResult.artifactPacketFile;
    outputState.artifactPacketBodyFile = initResult.artifactPacketBodyFile;
    outputState.onboardingReportId = initResult.onboardingReportId;
    outputState.onboardingReportFile = initResult.onboardingReportFile;
    outputState.assetMode = initResult.assetMode;
    outputState.registryRoots = initResult.registryRoots;
    outputState.bootstrapMaterializationStatus = initResult.bootstrapMaterializationStatus;
    outputState.materializedProjectProfileFile = initResult.materializedProjectProfileFile;
    outputState.materializedBootstrapAssetsRoot = initResult.materializedBootstrapAssetsRoot;
    outputState.bootstrapMaterializationIdempotent = initResult.bootstrapMaterializationIdempotent;
  } else if (command === "intake create") {
    ensureRequiredFlags(command, flags);
    const intakeResult = initializeProjectRuntime({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      projectProfile: resolveOptionalStringFlag("project-profile", flags["project-profile"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
    });

    outputState.resolvedProjectRef = intakeResult.projectRoot;
    outputState.resolvedRuntimeRoot = intakeResult.runtimeRoot;
    outputState.runtimeLayout = intakeResult.runtimeLayout;
    outputState.runtimeStateFile = intakeResult.stateFile;
    outputState.projectProfileRef = intakeResult.projectProfileRef;
    const requestFileInput = resolveOptionalStringFlag("request-file", flags["request-file"]);
    const requestFile = resolveOptionalRefOrPathFlag({
      cwd,
      projectRoot: intakeResult.projectRoot,
      flagValue: requestFileInput,
      flagName: "request-file",
    });
    if (requestFile && !fs.existsSync(requestFile)) {
      throw new CliUsageError(`Request file '${requestFileInput}' was not found.`);
    }
    const intakePacket = materializeIntakeArtifactPacket({
      projectId: intakeResult.projectId,
      projectRoot: intakeResult.projectRoot,
      projectProfileRef: intakeResult.projectProfileRef,
      runtimeLayout: intakeResult.runtimeLayout,
      command: "aor intake create",
      missionId: resolveOptionalStringFlag("mission-id", flags["mission-id"]) ?? null,
      requestTitle: resolveOptionalStringFlag("request-title", flags["request-title"]) ?? null,
      requestBrief: resolveOptionalStringFlag("request-brief", flags["request-brief"]) ?? null,
      requestConstraints: resolveOptionalCsvFlag("request-constraints", flags["request-constraints"]),
      goals: resolveOptionalStringListFlag("goal", flags.goal),
      kpis: resolveKpiFlags(flags.kpi),
      definitionOfDone: resolveOptionalStringListFlag("dod", flags.dod),
      requestFile: requestFile ?? null,
      sourceKind: resolveOptionalStringFlag("source-kind", flags["source-kind"]) ?? null,
      sourceRef: resolveOptionalStringFlag("source-ref", flags["source-ref"]) ?? null,
    });
    outputState.artifactPacketId = intakePacket.packet.packet_id;
    outputState.artifactPacketFile = intakePacket.packetFile;
    outputState.artifactPacketBodyFile = intakePacket.packetBodyFile;
    outputState.productIntake = intakePacket.packetBody.product_intake;
    outputState.productIntakeCompleteness = intakePacket.packetBody.product_intake_completeness;
    outputState.productIntakeSourceRefs = intakePacket.packetBody.product_intake.source_refs;
  } else if (command === "project analyze") {
    ensureRequiredFlags(command, flags);
    const routeOverrides = resolveRouteOverridesFlag(flags["route-overrides"]);
    const policyOverrides = resolvePolicyOverridesFlag(flags["policy-overrides"]);

    const analyzeResult = analyzeProjectRuntime({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      projectProfile: resolveOptionalStringFlag("project-profile", flags["project-profile"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
      routeOverrides,
      policyOverrides,
    });

    outputState.resolvedProjectRef = analyzeResult.projectRoot;
    outputState.resolvedRuntimeRoot = analyzeResult.runtimeRoot;
    outputState.runtimeLayout = analyzeResult.runtimeLayout;
    outputState.runtimeStateFile = analyzeResult.stateFile;
    outputState.projectProfileRef = analyzeResult.projectProfileRef;
    outputState.analysisReportId = analyzeResult.report.report_id;
    outputState.analysisReportFile = analyzeResult.reportPath;
    outputState.routeResolutionFile = analyzeResult.routeResolutionPath;
    outputState.routeResolutionSteps = analyzeResult.routeResolutionMatrix;
    outputState.assetResolutionFile = analyzeResult.assetResolutionPath;
    outputState.assetResolutionSteps = analyzeResult.assetResolutionMatrix;
    outputState.policyResolutionFile = analyzeResult.policyResolutionPath;
    outputState.policyResolutionSteps = analyzeResult.policyResolutionMatrix;
    outputState.evaluationRegistryFile = analyzeResult.evaluationRegistryPath;
    outputState.evaluationRegistrySuites = analyzeResult.evaluationRegistry.suites;
    outputState.evaluationRegistryDatasets = analyzeResult.evaluationRegistry.datasets;
    outputState.discoveryResearchReportId = analyzeResult.discoveryResearchReport.report_id;
    outputState.discoveryResearchReportFile = analyzeResult.discoveryResearchReportPath;
    outputState.discoveryResearchStatus = analyzeResult.discoveryResearchReport.status;
    outputState.discoveryResearchAdrReady = analyzeResult.discoveryResearchReport.status === "adr-ready";
    outputState.discoveryResearchOpenQuestions = analyzeResult.discoveryResearchReport.open_questions;
    outputState.discoveryCompletenessStatus = analyzeResult.report.discovery_completeness?.status ?? null;
    outputState.discoveryCompletenessBlocking = analyzeResult.report.discovery_completeness?.blocking ?? null;
    outputState.discoveryCompletenessChecks = analyzeResult.report.discovery_completeness?.checks ?? null;
    outputState.architectureTraceability = analyzeResult.report.architecture_traceability ?? null;
  } else if (command === "discovery run") {
    ensureRequiredFlags(command, flags);
    const routeOverrides = resolveRouteOverridesFlag(flags["route-overrides"]);
    const policyOverrides = resolvePolicyOverridesFlag(flags["policy-overrides"]);
    const inputPacketPath = resolveOptionalRefOrPathFlag({
      cwd,
      projectRoot: resolveProjectRef(/** @type {string} */ (flags["project-ref"]), cwd),
      flagValue: resolveOptionalStringFlag("input-packet", flags["input-packet"]),
      flagName: "input-packet",
    });
    if (inputPacketPath && !fs.existsSync(inputPacketPath)) {
      throw new CliUsageError(`Input packet '${resolveOptionalStringFlag("input-packet", flags["input-packet"])}' was not found.`);
    }

    const discoveryResult = analyzeProjectRuntime({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      projectProfile: resolveOptionalStringFlag("project-profile", flags["project-profile"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
      routeOverrides,
      policyOverrides,
      inputPacketPath,
    });

    outputState.resolvedProjectRef = discoveryResult.projectRoot;
    outputState.resolvedRuntimeRoot = discoveryResult.runtimeRoot;
    outputState.runtimeLayout = discoveryResult.runtimeLayout;
    outputState.runtimeStateFile = discoveryResult.stateFile;
    outputState.projectProfileRef = discoveryResult.projectProfileRef;
    outputState.analysisReportId = discoveryResult.report.report_id;
    outputState.analysisReportFile = discoveryResult.reportPath;
    outputState.routeResolutionFile = discoveryResult.routeResolutionPath;
    outputState.routeResolutionSteps = discoveryResult.routeResolutionMatrix;
    outputState.assetResolutionFile = discoveryResult.assetResolutionPath;
    outputState.assetResolutionSteps = discoveryResult.assetResolutionMatrix;
    outputState.policyResolutionFile = discoveryResult.policyResolutionPath;
    outputState.policyResolutionSteps = discoveryResult.policyResolutionMatrix;
    outputState.evaluationRegistryFile = discoveryResult.evaluationRegistryPath;
    outputState.evaluationRegistrySuites = discoveryResult.evaluationRegistry.suites;
    outputState.evaluationRegistryDatasets = discoveryResult.evaluationRegistry.datasets;
    outputState.discoveryResearchReportId = discoveryResult.discoveryResearchReport.report_id;
    outputState.discoveryResearchReportFile = discoveryResult.discoveryResearchReportPath;
    outputState.discoveryResearchStatus = discoveryResult.discoveryResearchReport.status;
    outputState.discoveryResearchAdrReady = discoveryResult.discoveryResearchReport.status === "adr-ready";
    outputState.discoveryResearchOpenQuestions = discoveryResult.discoveryResearchReport.open_questions;
    outputState.discoveryCompletenessStatus = discoveryResult.report.discovery_completeness?.status ?? null;
    outputState.discoveryCompletenessBlocking = discoveryResult.report.discovery_completeness?.blocking ?? null;
    outputState.discoveryCompletenessChecks = discoveryResult.report.discovery_completeness?.checks ?? null;
    outputState.architectureTraceability = discoveryResult.report.architecture_traceability ?? null;
  } else if (command === "project validate") {
    ensureRequiredFlags(command, flags);
    outputState.handoffGateEnforced = resolveOptionalBooleanFlag(
      "require-approved-handoff",
      flags["require-approved-handoff"],
    );

    const validateResult = validateProjectRuntime({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      projectProfile: resolveOptionalStringFlag("project-profile", flags["project-profile"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
      requireApprovedHandoff: outputState.handoffGateEnforced,
      handoffPacketPath: resolveOptionalStringFlag("handoff-packet", flags["handoff-packet"]),
    });

    outputState.resolvedProjectRef = validateResult.projectRoot;
    outputState.resolvedRuntimeRoot = validateResult.runtimeRoot;
    outputState.runtimeLayout = validateResult.runtimeLayout;
    outputState.runtimeStateFile = validateResult.stateFile;
    outputState.projectProfileRef = validateResult.projectProfileRef;
    outputState.validationReportId = validateResult.report.report_id;
    outputState.validationReportFile = validateResult.validationReportPath;
    outputState.validationStatus = validateResult.report.status;
    outputState.validationBlocking = validateResult.blocking;
    outputState.handoffGateStatus = validateResult.handoffGateStatus;
    outputState.handoffGateBlocking = validateResult.handoffGateBlocking;
    outputState.handoffPacketFile = validateResult.handoffPacketFile;
  } else if (command === "project verify") {
    ensureRequiredFlags(command, flags);
    const routeOverrides = resolveRouteOverridesFlag(flags["route-overrides"]);
    const policyOverrides = resolvePolicyOverridesFlag(flags["policy-overrides"]);
    const planOnly = resolveOptionalBooleanFlag("plan", flags.plan);

    outputState.validationGateEnforced = resolveOptionalBooleanFlag(
      "require-validation-pass",
      flags["require-validation-pass"],
    );
    outputState.verificationLabel = resolveOptionalStringFlag("verification-label", flags["verification-label"]) ?? "default";
    const routedDryRunStep = resolveOptionalStringFlag("routed-dry-run-step", flags["routed-dry-run-step"]);
    const routedLiveStep = resolveOptionalStringFlag("routed-live-step", flags["routed-live-step"]);
    if (routedDryRunStep && routedLiveStep) {
      throw new CliUsageError(
        "Flags '--routed-dry-run-step' and '--routed-live-step' are mutually exclusive.",
      );
    }
    if (planOnly && (routedDryRunStep || routedLiveStep)) {
      throw new CliUsageError("Flag '--plan' cannot be combined with routed step execution flags.");
    }

    if (planOnly) {
      const planResult = planProjectVerification({
        cwd,
        projectRef: /** @type {string} */ (flags["project-ref"]),
        projectProfile: resolveOptionalStringFlag("project-profile", flags["project-profile"]),
        runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
        requireValidationPass: outputState.validationGateEnforced,
        verificationLabel: outputState.verificationLabel,
        repoBuildCommands: resolveOptionalStringListFlag("repo-build-command", flags["repo-build-command"]),
        repoLintCommands: resolveOptionalStringListFlag("repo-lint-command", flags["repo-lint-command"]),
        repoTestCommands: resolveOptionalStringListFlag("repo-test-command", flags["repo-test-command"]),
      });

      outputState.resolvedProjectRef = planResult.projectRoot;
      outputState.resolvedRuntimeRoot = planResult.runtimeRoot;
      outputState.runtimeLayout = planResult.runtimeLayout;
      outputState.runtimeStateFile = planResult.stateFile;
      outputState.projectProfileRef = planResult.projectProfileRef;
      outputState.validationGateStatus = planResult.validationGateStatus;
      outputState.verificationPlanFile = planResult.verificationPlanPath;
      outputState.verificationPlan = planResult.verificationPlan;
      outputState.verificationPlanCommandGroups = planResult.verificationPlan.command_groups;
      outputState.verificationPlanDiscoveredCommandGroups = planResult.verificationPlan.discovered_command_groups;
      return true;
    }

    const verifyResult = verifyProjectRuntime({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      projectProfile: resolveOptionalStringFlag("project-profile", flags["project-profile"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
      requireValidationPass: outputState.validationGateEnforced,
      verificationLabel: outputState.verificationLabel,
      repoBuildCommands: resolveOptionalStringListFlag("repo-build-command", flags["repo-build-command"]),
      repoLintCommands: resolveOptionalStringListFlag("repo-lint-command", flags["repo-lint-command"]),
      repoTestCommands: resolveOptionalStringListFlag("repo-test-command", flags["repo-test-command"]),
      outputQualityBaselineFiles: resolveOptionalStringListFlag(
        "output-quality-baseline",
        flags["output-quality-baseline"],
      ),
    });

    outputState.resolvedProjectRef = verifyResult.projectRoot;
    outputState.resolvedRuntimeRoot = verifyResult.runtimeRoot;
    outputState.runtimeLayout = verifyResult.runtimeLayout;
    outputState.runtimeStateFile = verifyResult.stateFile;
    outputState.projectProfileRef = verifyResult.projectProfileRef;
    outputState.validationGateStatus = verifyResult.validationGateStatus;
    outputState.verifySummaryFile = verifyResult.verifySummaryPath;
    outputState.verifyStepResultFiles = verifyResult.stepResultFiles;

    const selectedRoutedStep = routedDryRunStep ?? routedLiveStep;
    if (selectedRoutedStep) {
      const routedExecutor = routedLiveStep ? executeRuntimeHarnessControlledStep : executeRoutedStep;
      const routedResult = routedExecutor({
        cwd,
        projectRef: /** @type {string} */ (flags["project-ref"]),
        projectProfile: resolveOptionalStringFlag("project-profile", flags["project-profile"]),
        runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
        stepClass: selectedRoutedStep,
        dryRun: routedDryRunStep ? true : false,
        approvedHandoffRef: resolveOptionalStringFlag("approved-handoff-ref", flags["approved-handoff-ref"]),
        promotionEvidenceRefs: resolveOptionalCsvFlag(
          "promotion-evidence-refs",
          flags["promotion-evidence-refs"],
        ),
        routeOverrides,
        policyOverrides,
      });

      outputState.routedStepResultId = routedResult.stepResultId;
      outputState.routedStepResultFile = routedResult.stepResultPath;
      outputState.verifyStepResultFiles = [...verifyResult.stepResultFiles, routedResult.stepResultPath];
    }
  } else if (command === "spec build") {
    ensureRequiredFlags(command, flags);
    const routeOverrides = resolveRouteOverridesFlag(flags["route-overrides"]);
    const policyOverrides = resolvePolicyOverridesFlag(flags["policy-overrides"]);

    const specResult = executeRoutedStep({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      projectProfile: resolveOptionalStringFlag("project-profile", flags["project-profile"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
      stepClass: "spec",
      dryRun: true,
      requireDiscoveryCompleteness: true,
      routeOverrides,
      policyOverrides,
    });

    outputState.resolvedProjectRef = specResult.projectRoot;
    outputState.resolvedRuntimeRoot = specResult.runtimeRoot;
    outputState.runtimeLayout = specResult.runtimeLayout;
    outputState.runtimeStateFile = specResult.stateFile;
    outputState.projectProfileRef = specResult.projectProfileRef;
    outputState.routedStepResultId = specResult.stepResultId;
    outputState.routedStepResultFile = specResult.stepResultPath;
    outputState.verifyStepResultFiles = [specResult.stepResultPath];
    outputState.discoveryCompletenessStatus = specResult.stepResult.routed_execution.discovery_completeness_gate?.status ?? null;
    outputState.discoveryCompletenessBlocking = specResult.stepResult.routed_execution.discovery_completeness_gate?.blocking ?? null;
    outputState.discoveryCompletenessChecks = specResult.stepResult.routed_execution.discovery_completeness_gate?.checks ?? null;
    outputState.discoveryResearchGate = specResult.stepResult.routed_execution.discovery_research_gate ?? null;
    outputState.discoveryResearchStatus = specResult.stepResult.routed_execution.discovery_research_gate?.status ?? null;
    outputState.discoveryResearchAdrReady = specResult.stepResult.routed_execution.discovery_research_gate?.adr_ready ?? null;
    outputState.discoveryResearchOpenQuestions = specResult.stepResult.routed_execution.discovery_research_gate?.open_questions ?? null;
    outputState.architectureTraceability = specResult.stepResult.routed_execution.architecture_traceability ?? null;
  } else if (command === "handoff prepare") {
    ensureRequiredFlags(command, flags);

    const prepareResult = prepareHandoffArtifacts({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      projectProfile: resolveOptionalStringFlag("project-profile", flags["project-profile"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
      ticketId: resolveOptionalStringFlag("ticket-id", flags["ticket-id"]),
      approvedArtifactPath: resolveOptionalStringFlag("approved-artifact", flags["approved-artifact"]),
    });

    outputState.resolvedProjectRef = prepareResult.projectRoot;
    outputState.resolvedRuntimeRoot = prepareResult.runtimeRoot;
    outputState.runtimeLayout = prepareResult.runtimeLayout;
    outputState.runtimeStateFile = prepareResult.stateFile;
    outputState.projectProfileRef = prepareResult.projectProfileRef;
    outputState.waveTicketId = prepareResult.waveTicket.ticket_id;
    outputState.waveTicketFile = prepareResult.waveTicketFile;
    outputState.handoffPacketId = prepareResult.handoffPacket.packet_id;
    outputState.handoffPacketFile = prepareResult.handoffPacketFile;
    outputState.handoffStatus = prepareResult.handoffPacket.status;
    outputState.handoffApprovalState = prepareResult.handoffPacket.approval_state;
  } else if (command === "wave create") {
    ensureRequiredFlags(command, flags);

    const waveResult = prepareHandoffArtifacts({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      projectProfile: resolveOptionalStringFlag("project-profile", flags["project-profile"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
      ticketId: resolveOptionalStringFlag("ticket-id", flags["ticket-id"]),
      approvedArtifactPath: resolveOptionalStringFlag("approved-artifact", flags["approved-artifact"]),
    });

    outputState.resolvedProjectRef = waveResult.projectRoot;
    outputState.resolvedRuntimeRoot = waveResult.runtimeRoot;
    outputState.runtimeLayout = waveResult.runtimeLayout;
    outputState.runtimeStateFile = waveResult.stateFile;
    outputState.projectProfileRef = waveResult.projectProfileRef;
    outputState.waveTicketId = waveResult.waveTicket.ticket_id;
    outputState.waveTicketFile = waveResult.waveTicketFile;
    outputState.handoffPacketId = waveResult.handoffPacket.packet_id;
    outputState.handoffPacketFile = waveResult.handoffPacketFile;
    outputState.handoffStatus = waveResult.handoffPacket.status;
    outputState.handoffApprovalState = waveResult.handoffPacket.approval_state;
  } else if (command === "handoff approve") {
    ensureRequiredFlags(command, flags);
    const approvalRef = resolveOptionalStringFlag("approval-ref", flags["approval-ref"]);
    if (!approvalRef) {
      throw new CliUsageError("Missing required flag '--approval-ref' for 'aor handoff approve'.");
    }

    const approveResult = approveHandoffArtifacts({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
      handoffPacketPath: resolveOptionalStringFlag("handoff-packet", flags["handoff-packet"]),
      approvalRef,
    });

    outputState.resolvedProjectRef = approveResult.projectRoot;
    outputState.resolvedRuntimeRoot = approveResult.runtimeRoot;
    outputState.runtimeLayout = approveResult.runtimeLayout;
    outputState.runtimeStateFile = approveResult.stateFile;
    outputState.projectProfileRef = approveResult.projectProfileRef;
    outputState.handoffPacketId = approveResult.handoffPacket.packet_id;
    outputState.handoffPacketFile = approveResult.handoffPacketFile;
    outputState.handoffStatus = approveResult.handoffPacket.status;
    outputState.handoffApprovalState = approveResult.handoffPacket.approval_state;

  } else {
    return false;
  }
  return true;
}
