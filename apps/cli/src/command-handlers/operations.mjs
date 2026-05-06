import fs from "node:fs";
import path from "node:path";

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
  materializeIncidentBackfillProposal,
  materializeLearningLoopArtifacts,
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

export const OPERATIONS_COMMANDS = Object.freeze([
  "packet show",
  "evidence show",
  "incident open",
  "incident backfill",
  "incident recertify",
  "incident show",
  "audit runs"
]);

export const OPERATIONS_COMMAND_GROUP = Object.freeze({
  group_id: "operations",
  commands: OPERATIONS_COMMANDS,
});

/**
 * @param {{ command: string, flags: Record<string, string | string[] | true>, cwd: string, outputState: Record<string, unknown> }} context
 * @returns {boolean}
 */
export function handleOperationsCommand(context) {
  const { command, flags, cwd, outputState } = context;
  if (command === "packet show") {
    ensureRequiredFlags(command, flags);
    const family = resolveOptionalStringFlag("family", flags.family) ?? "all";
    const limit = resolveOptionalIntegerFlag("limit", flags.limit, { min: 1 });
    const supportedFamilies = new Set([
      "artifact-packet",
      "wave-ticket",
      "handoff-packet",
      "delivery-plan",
      "delivery-manifest",
      "release-packet",
    ]);

    if (family !== "all" && !supportedFamilies.has(family)) {
      throw new CliUsageError(
        "Flag '--family' must be one of artifact-packet, wave-ticket, handoff-packet, delivery-plan, delivery-manifest, release-packet, or all.",
      );
    }

    const projectState = readProjectState({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
    });
    outputState.resolvedProjectRef = projectState.project_root;
    outputState.resolvedRuntimeRoot = projectState.runtime_root;
    outputState.runtimeLayout = projectState.runtime_layout;
    outputState.runtimeStateFile = projectState.state_file;
    outputState.projectProfileRef = projectState.project_profile_ref;

    const packets = listPacketArtifacts({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
    });
    const familyFiltered = family === "all" ? packets : packets.filter((packet) => packet.family === family);
    outputState.packetArtifacts = typeof limit === "number" ? familyFiltered.slice(0, limit) : familyFiltered;
    outputState.selectedFamily = family;
    outputState.readOnly = true;
    outputState.futureControlHooks = ["deliver prepare", "release prepare"];
  } else if (command === "evidence show") {
    ensureRequiredFlags(command, flags);
    const runId = resolveOptionalStringFlag("run-id", flags["run-id"]);

    const projectState = readProjectState({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
    });
    outputState.resolvedProjectRef = projectState.project_root;
    outputState.resolvedRuntimeRoot = projectState.runtime_root;
    outputState.runtimeLayout = projectState.runtime_layout;
    outputState.runtimeStateFile = projectState.state_file;
    outputState.projectProfileRef = projectState.project_profile_ref;

    outputState.stepResults = filterArtifactsByRunId(
      listStepResults({
        cwd,
        projectRef: /** @type {string} */ (flags["project-ref"]),
        runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
      }),
      runId,
    );
    outputState.qualityArtifacts = filterArtifactsByRunId(
      listQualityArtifacts({
        cwd,
        projectRef: /** @type {string} */ (flags["project-ref"]),
        runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
      }),
      runId,
    );
    outputState.deliveryManifests = filterArtifactsByRunId(
      listDeliveryManifests({
        cwd,
        projectRef: /** @type {string} */ (flags["project-ref"]),
        runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
      }),
      runId,
    );
    outputState.promotionDecisions = filterArtifactsByRunId(
      listPromotionDecisions({
        cwd,
        projectRef: /** @type {string} */ (flags["project-ref"]),
        runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
      }),
      runId,
    );
    outputState.readOnly = true;
    outputState.futureControlHooks = ["incident open", "incident show", "audit runs"];
  } else if (command === "incident open") {
    ensureRequiredFlags(command, flags);
    const runId = /** @type {string} */ (resolveOptionalStringFlag("run-id", flags["run-id"]));
    const summary = /** @type {string} */ (resolveOptionalStringFlag("summary", flags.summary));
    const severity = resolveOptionalStringFlag("severity", flags.severity) ?? "high";
    const statusValue = resolveOptionalStringFlag("status", flags.status) ?? "open";
    const explicitLinkedAssetRefs = resolveOptionalCsvFlag("linked-asset-refs", flags["linked-asset-refs"]);

    const projectState = readProjectState({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
    });
    outputState.resolvedProjectRef = projectState.project_root;
    outputState.resolvedRuntimeRoot = projectState.runtime_root;
    outputState.runtimeLayout = projectState.runtime_layout;
    outputState.runtimeStateFile = projectState.state_file;
    outputState.projectProfileRef = projectState.project_profile_ref;

    const runSummariesForIncident = listRuns({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
    });
    const runSummary = runSummariesForIncident.find((entry) => entry.run_id === runId);
    if (!runSummary) {
      throw new CliUsageError(`Run '${runId}' is not present in runtime evidence. Use 'aor run status --run-id ${runId}'.`);
    }

    const qualityForRun = listQualityArtifacts({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
    }).filter((artifact) => runSummary.quality_refs.includes(artifact.artifact_ref));

    const linkedEvalSuiteRefs = uniqueStrings(
      qualityForRun
        .filter((artifact) => artifact.family === "evaluation-report")
        .map((artifact) => (typeof artifact.document.suite_ref === "string" ? artifact.document.suite_ref : "")),
    );
    const linkedHarnessCaptureRefs = uniqueStrings(
      qualityForRun
        .filter((artifact) => artifact.family === "promotion-decision")
        .flatMap((artifact) => asStringArray(artifact.document.evidence_refs))
        .filter((ref) => ref.includes("harness-capture")),
    );

    const linkedAssetRefs = uniqueStrings([
      ...runSummary.packet_refs,
      ...runSummary.step_result_refs,
      ...runSummary.quality_refs,
      ...explicitLinkedAssetRefs,
    ]);
    const incidentRun = toRunRef(runId);
    const generatedIncidentId = `${projectState.project_id}.incident.${normalizeForId(runId)}.${Date.now()}`;
    const incidentDocument = {
      incident_id: generatedIncidentId,
      project_id: projectState.project_id,
      severity,
      summary,
      linked_run_refs: [incidentRun],
      linked_asset_refs: linkedAssetRefs,
      status: statusValue,
      linked_eval_suite_refs: linkedEvalSuiteRefs,
      linked_harness_capture_refs: linkedHarnessCaptureRefs,
      linked_backlog_refs: ["docs/backlog/mvp-implementation-backlog.md", "docs/backlog/wave-6-implementation-slices.md"],
      evidence_root: projectState.runtime_layout.reports_root,
      created_at: new Date().toISOString(),
    };
    const incidentValidation = validateContractDocument({
      family: "incident-report",
      document: incidentDocument,
      source: "runtime://incident-report-open",
    });
    if (!incidentValidation.ok) {
      const issues = incidentValidation.issues.map((issue) => issue.message).join("; ");
      throw new CliUsageError(`Generated incident-report failed contract validation: ${issues}`);
    }

    const generatedIncidentFile = path.join(
      projectState.runtime_layout.reports_root,
      `incident-report-${normalizeForId(generatedIncidentId)}.json`,
    );
    fs.writeFileSync(generatedIncidentFile, `${JSON.stringify(incidentDocument, null, 2)}\n`, "utf8");

    outputState.incidentId = incidentDocument.incident_id;
    outputState.incidentReportFile = generatedIncidentFile;
    outputState.incidentStatus = incidentDocument.status;
    outputState.incidentRunRef = incidentRun;
    outputState.incidentLinkedAssetRefs = incidentDocument.linked_asset_refs;
    outputState.auditEvidenceRefs = linkedAssetRefs;
    outputState.readOnly = false;
    outputState.futureControlHooks = [
      `incident show --incident-id ${incidentDocument.incident_id}`,
      `incident backfill --incident-id ${incidentDocument.incident_id}`,
      `incident recertify --incident-id ${incidentDocument.incident_id} --decision recertify`,
      `audit runs --run-id ${runId}`,
      `evidence show --run-id ${runId}`,
    ];
  } else if (command === "incident backfill") {
    ensureRequiredFlags(command, flags);
    const incidentIdValue = /** @type {string} */ (resolveOptionalStringFlag("incident-id", flags["incident-id"]));
    const suiteRefInput = resolveOptionalStringFlag("suite-ref", flags["suite-ref"]);
    const caseIdInput = resolveOptionalStringFlag("case-id", flags["case-id"]);
    const proposalState = resolveOptionalStringFlag("proposal-state", flags["proposal-state"]) ?? "proposed";
    if (!["proposed", "approved", "rejected"].includes(proposalState)) {
      throw new CliUsageError("Flag '--proposal-state' must be one of proposed, approved, or rejected.");
    }

    const projectState = readProjectState({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
    });
    outputState.resolvedProjectRef = projectState.project_root;
    outputState.resolvedRuntimeRoot = projectState.runtime_root;
    outputState.runtimeLayout = projectState.runtime_layout;
    outputState.runtimeStateFile = projectState.state_file;
    outputState.projectProfileRef = projectState.project_profile_ref;

    const qualityArtifactList = listQualityArtifacts({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
    });
    const incidentArtifact = qualityArtifactList
      .filter((artifact) => artifact.family === "incident-report")
      .find((artifact) => artifact.document.incident_id === incidentIdValue);
    if (!incidentArtifact) {
      throw new CliUsageError(`Incident '${incidentIdValue}' was not found.`);
    }

    const linkedAssetRefs = asStringArray(incidentArtifact.document.linked_asset_refs);
    if (linkedAssetRefs.length === 0) {
      throw new CliUsageError(`Incident '${incidentIdValue}' has no linked asset refs for dataset backfill.`);
    }

    const analysis = analyzeProjectRuntime({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
    });
    const preferredSuite =
      suiteRefInput ??
      analysis.evaluationRegistry.suites.find((suite) => suite.suite_ref === "suite.regress.short@v1")?.suite_ref ??
      analysis.evaluationRegistry.suites[0]?.suite_ref ??
      null;
    const suite = preferredSuite
      ? analysis.evaluationRegistry.suites.find((candidate) => candidate.suite_ref === preferredSuite)
      : null;
    if (!suite) {
      throw new CliUsageError(
        suiteRefInput
          ? `Evaluation suite '${suiteRefInput}' was not found in the project registry.`
          : "No evaluation suite is available for incident backfill.",
      );
    }
    if (!suite.dataset_ref) {
      throw new CliUsageError(`Evaluation suite '${suite.suite_ref}' does not declare a dataset_ref.`);
    }
    const dataset = analysis.evaluationRegistry.datasets.find((candidate) => candidate.dataset_ref === suite.dataset_ref);
    if (!dataset) {
      throw new CliUsageError(`Dataset '${suite.dataset_ref}' for suite '${suite.suite_ref}' was not found.`);
    }

    const linkedRunRefs = asStringArray(incidentArtifact.document.linked_run_refs);
    const firstRunRef = linkedRunRefs[0] ?? null;
    const runId = firstRunRef ? normalizeRunRef(firstRunRef) : null;
    const learningHandoff = qualityArtifactList
      .filter((artifact) => artifact.family === "learning-loop-handoff")
      .find((artifact) => {
        if (artifact.document.incident_ref === incidentArtifact.artifact_ref) return true;
        return runId && artifact.document.run_id === runId;
      });
    const scorecardRefs = qualityArtifactList
      .filter((artifact) => artifact.family === "learning-loop-scorecard")
      .filter((artifact) => !runId || artifact.document.run_id === runId)
      .map((artifact) => artifact.artifact_ref);

    const proposalResult = materializeIncidentBackfillProposal({
      projectId: projectState.project_id,
      projectRoot: projectState.project_root,
      runtimeLayout: { reportsRoot: projectState.runtime_layout.reports_root },
      incidentRef: incidentArtifact.artifact_ref,
      incident: incidentArtifact.document,
      suiteRef: suite.suite_ref,
      datasetRef: suite.dataset_ref,
      subjectType: dataset.subject_type ?? suite.subject_type,
      learningHandoffRef: learningHandoff?.artifact_ref ?? null,
      scorecardRefs,
      evidenceRefs: linkedAssetRefs,
      proposedCaseId: caseIdInput,
      proposalState: /** @type {"proposed" | "approved" | "rejected"} */ (proposalState),
    });

    outputState.incidentId = incidentIdValue;
    outputState.incidentReportFile = incidentArtifact.file;
    outputState.incidentStatus =
      typeof incidentArtifact.document.status === "string" ? incidentArtifact.document.status : null;
    outputState.incidentRunRef = firstRunRef;
    outputState.incidentLinkedAssetRefs = linkedAssetRefs;
    outputState.learningLoopHandoffFile = learningHandoff?.file ?? null;
    outputState.incidentBackfillProposalId = proposalResult.proposal.proposal_id;
    outputState.incidentBackfillProposalFile = proposalResult.proposalFile;
    outputState.incidentBackfillProposalState = proposalResult.proposal.proposal_state;
    outputState.incidentBackfillSuiteRef = proposalResult.proposal.target.suite_ref;
    outputState.incidentBackfillDatasetRef = proposalResult.proposal.target.dataset_ref;
    outputState.incidentBackfillCaseIds = proposalResult.proposal.proposed_cases.map((entry) => entry.case_id);
    outputState.incidentBackfillReviewRequired = proposalResult.proposal.mutation_policy.requires_review === true;
    outputState.auditEvidenceRefs = proposalResult.proposal.evidence_refs;
    outputState.readOnly = false;
    outputState.futureControlHooks = [
      `incident show --incident-id ${incidentIdValue}`,
      `evidence show${runId ? ` --run-id ${runId}` : ""}`,
      `eval run --suite-ref ${suite.suite_ref} --subject-ref run://${runId ?? "<run-id>"}`,
    ];
  } else if (command === "incident recertify") {
    ensureRequiredFlags(command, flags);
    const incidentIdValue = /** @type {string} */ (resolveOptionalStringFlag("incident-id", flags["incident-id"]));
    const decisionInput = (resolveOptionalStringFlag("decision", flags.decision) ?? "recertify").toLowerCase();
    const decision = decisionInput === "reenable" ? "re-enable" : decisionInput;
    const reason = resolveOptionalStringFlag("reason", flags.reason);
    const promotionRef = resolveOptionalStringFlag("promotion-ref", flags["promotion-ref"]);
    const explicitRunId = resolveOptionalStringFlag("run-id", flags["run-id"]);

    if (!["recertify", "hold", "re-enable"].includes(decision)) {
      throw new CliUsageError("Flag '--decision' must be one of recertify, hold, or re-enable.");
    }

    const projectState = readProjectState({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
    });
    outputState.resolvedProjectRef = projectState.project_root;
    outputState.resolvedRuntimeRoot = projectState.runtime_root;
    outputState.runtimeLayout = projectState.runtime_layout;
    outputState.runtimeStateFile = projectState.state_file;
    outputState.projectProfileRef = projectState.project_profile_ref;

    const qualityArtifactList = listQualityArtifacts({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
    });
    const incidents = qualityArtifactList.filter((artifact) => artifact.family === "incident-report");
    const incidentArtifact = incidents.find((artifact) => artifact.document.incident_id === incidentIdValue);
    if (!incidentArtifact) {
      throw new CliUsageError(`Incident '${incidentIdValue}' was not found.`);
    }

    const linkedRunRefs = asStringArray(incidentArtifact.document.linked_run_refs);
    const incidentRun = linkedRunRefs.length > 0 ? linkedRunRefs[0] : explicitRunId ? toRunRef(explicitRunId) : null;
    if (explicitRunId && incidentRun && normalizeRunRef(incidentRun) !== explicitRunId) {
      throw new CliUsageError(
        `Incident '${incidentIdValue}' is linked to '${incidentRun}', not '${toRunRef(explicitRunId)}'.`,
      );
    }
    const runId = incidentRun ? normalizeRunRef(incidentRun) : null;
    const runSummariesForIncident = runId
      ? listRuns({
          cwd,
          projectRef: /** @type {string} */ (flags["project-ref"]),
          runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
        })
      : [];
    const runSummaryForIncident = runId
      ? runSummariesForIncident.find((entry) => entry.run_id === runId) ?? null
      : null;

    const promotions = qualityArtifactList.filter((artifact) => artifact.family === "promotion-decision");
    let promotionArtifact = null;
    if (promotionRef) {
      promotionArtifact = promotions.find((artifact) => artifact.artifact_ref === promotionRef) ?? null;
      if (!promotionArtifact) {
        throw new CliUsageError(`Promotion decision '${promotionRef}' was not found.`);
      }
    } else if (runSummaryForIncident) {
      const linkedPromotionRefs = runSummaryForIncident.quality_refs.filter((ref) =>
        ref.includes("promotion-decision"),
      );
      promotionArtifact =
        promotions.find((artifact) => linkedPromotionRefs.includes(artifact.artifact_ref)) ?? null;
    }

    const promotionStatus =
      promotionArtifact && typeof promotionArtifact.document.status === "string"
        ? promotionArtifact.document.status
        : null;
    const rolloutDecision =
      promotionArtifact &&
      typeof promotionArtifact.document.rollout_decision === "object" &&
      promotionArtifact.document.rollout_decision !== null &&
      !Array.isArray(promotionArtifact.document.rollout_decision)
        ? promotionArtifact.document.rollout_decision
        : null;
    const requestedTransition =
      rolloutDecision &&
      typeof rolloutDecision.requested_transition === "object" &&
      rolloutDecision.requested_transition !== null &&
      !Array.isArray(rolloutDecision.requested_transition)
        ? rolloutDecision.requested_transition
        : null;
    const platformRolloutAction =
      rolloutDecision && typeof rolloutDecision.action === "string" ? rolloutDecision.action : null;
    const platformFromChannel =
      requestedTransition && typeof requestedTransition.from_channel === "string"
        ? requestedTransition.from_channel
        : promotionArtifact && typeof promotionArtifact.document.from_channel === "string"
          ? promotionArtifact.document.from_channel
          : null;
    const platformToChannel =
      requestedTransition && typeof requestedTransition.to_channel === "string"
        ? requestedTransition.to_channel
        : promotionArtifact && typeof promotionArtifact.document.to_channel === "string"
          ? promotionArtifact.document.to_channel
          : null;
    const rollbackRequired = platformRolloutAction === "freeze" || platformRolloutAction === "demote";
    const platformLinkage = promotionArtifact ? (rollbackRequired ? "rollback" : "linked") : "unlinked";

    let nextStatus = decision === "re-enable" ? "re-enabled" : decision;
    if (decision === "re-enable") {
      if (!promotionArtifact) {
        throw new CliUsageError(
          "Re-enable is blocked: no run-linked promotion decision was found. Provide --promotion-ref with pass evidence.",
        );
      }
      if (promotionStatus !== "pass") {
        throw new CliUsageError(
          `Re-enable is blocked: promotion decision '${promotionArtifact.artifact_ref}' has status '${promotionStatus ?? "unknown"}' (requires pass).`,
        );
      }
      outputState.incidentRecertificationGate = rollbackRequired ? "rollback" : "allow";
    } else if (decision === "recertify") {
      outputState.incidentRecertificationGate = rollbackRequired ? "rollback" : promotionStatus === "pass" ? "allow" : "hold";
    } else {
      outputState.incidentRecertificationGate = rollbackRequired ? "rollback" : "hold";
    }

    if (outputState.incidentRecertificationGate === "rollback") {
      nextStatus = "hold";
    }

    const financeEvidenceRefs = uniqueStrings([
      ...(runSummaryForIncident
        ? [...runSummaryForIncident.step_result_refs, ...runSummaryForIncident.packet_refs]
        : []),
      ...(promotionArtifact ? asStringArray(promotionArtifact.document.evidence_refs) : []),
    ]);
    const qualityEvidenceRefs = uniqueStrings([
      incidentArtifact.artifact_ref,
      ...(runSummaryForIncident ? runSummaryForIncident.quality_refs : []),
      ...(promotionArtifact
        ? [promotionArtifact.artifact_ref, ...asStringArray(promotionArtifact.document.evidence_refs)]
        : []),
    ]);
    const linkedEvidenceRefs = uniqueStrings([
      ...asStringArray(incidentArtifact.document.linked_asset_refs),
      ...financeEvidenceRefs,
      ...qualityEvidenceRefs,
    ]);
    const recertificationReason =
      reason ??
      (outputState.incidentRecertificationGate === "rollback"
        ? `Platform rollout action '${platformRolloutAction ?? "unknown"}' requires rollback-safe hold.`
        : undefined);

    const recertified = applyIncidentRecertification({
      projectRoot: projectState.project_root,
      runtimeLayout: projectState.runtime_layout,
      incidentId: incidentIdValue,
      decision: /** @type {"recertify" | "hold" | "re-enable"} */ (decision),
      nextStatus,
      runRef: incidentRun ?? undefined,
      reason: recertificationReason,
      promotionDecisionRef: promotionArtifact?.artifact_ref,
      promotionDecisionStatus: promotionStatus ?? undefined,
      evidenceRefs: linkedEvidenceRefs,
      financeEvidenceRefs,
      qualityEvidenceRefs,
      financeEvidenceRoot: projectState.runtime_layout.reports_root,
      qualityEvidenceRoot: projectState.runtime_layout.reports_root,
      platformRecertification: promotionArtifact
        ? {
            linkage_status: platformLinkage,
            rollback_required: rollbackRequired,
            rollout_action: platformRolloutAction ?? undefined,
            promotion_decision_ref: promotionArtifact.artifact_ref,
            from_channel: platformFromChannel ?? undefined,
            to_channel: platformToChannel ?? undefined,
          }
        : undefined,
    });

    outputState.incidentId = incidentIdValue;
    outputState.incidentReportFile = recertified.incidentFile;
    outputState.incidentStatus =
      typeof recertified.incident.status === "string" ? recertified.incident.status : nextStatus;
    outputState.incidentRunRef = incidentRun;
    outputState.incidentLinkedAssetRefs = asStringArray(recertified.incident.linked_asset_refs);
    outputState.incidentRecertificationDecision = decision;
    outputState.incidentRecertificationFromStatus =
      typeof recertified.recertification.from_status === "string"
        ? recertified.recertification.from_status
        : null;
    outputState.incidentRecertificationToStatus =
      typeof recertified.recertification.to_status === "string"
        ? recertified.recertification.to_status
        : nextStatus;
    outputState.incidentRecertificationPromotionRef = promotionArtifact?.artifact_ref ?? null;
    outputState.incidentRecertificationPlatformAction =
      recertified.recertification &&
      typeof recertified.recertification.platform_recertification === "object" &&
      recertified.recertification.platform_recertification !== null &&
      !Array.isArray(recertified.recertification.platform_recertification) &&
      typeof recertified.recertification.platform_recertification.rollout_action === "string"
        ? recertified.recertification.platform_recertification.rollout_action
        : null;
    outputState.incidentRecertificationPlatformLinkage =
      recertified.recertification &&
      typeof recertified.recertification.platform_recertification === "object" &&
      recertified.recertification.platform_recertification !== null &&
      !Array.isArray(recertified.recertification.platform_recertification) &&
      typeof recertified.recertification.platform_recertification.linkage_status === "string"
        ? recertified.recertification.platform_recertification.linkage_status
        : null;
    outputState.incidentRecertificationRollbackRequired =
      recertified.recertification &&
      typeof recertified.recertification.platform_recertification === "object" &&
      recertified.recertification.platform_recertification !== null &&
      !Array.isArray(recertified.recertification.platform_recertification)
        ? recertified.recertification.platform_recertification.rollback_required === true
        : null;
    outputState.incidentRecertificationFinanceEvidenceRefs = asStringArray(
      recertified.recertification.finance_evidence_refs,
    );
    outputState.incidentRecertificationQualityEvidenceRefs = asStringArray(
      recertified.recertification.quality_evidence_refs,
    );
    outputState.incidentRecertificationFinanceEvidenceRoot =
      typeof recertified.recertification.finance_evidence_root === "string"
        ? recertified.recertification.finance_evidence_root
        : null;
    outputState.incidentRecertificationQualityEvidenceRoot =
      typeof recertified.recertification.quality_evidence_root === "string"
        ? recertified.recertification.quality_evidence_root
        : null;
    outputState.auditEvidenceRefs = linkedEvidenceRefs;
    outputState.readOnly = false;
    outputState.futureControlHooks = runId
      ? [
          `incident show --incident-id ${incidentIdValue}`,
          `audit runs --run-id ${runId}`,
          `evidence show --run-id ${runId}`,
        ]
      : [`incident show --incident-id ${incidentIdValue}`, "audit runs"];
  } else if (command === "incident show") {
    ensureRequiredFlags(command, flags);
    const incidentIdFilter = resolveOptionalStringFlag("incident-id", flags["incident-id"]);
    const runIdFilter = resolveOptionalStringFlag("run-id", flags["run-id"]);
    const limit = resolveOptionalIntegerFlag("limit", flags.limit, { min: 1 });

    const projectState = readProjectState({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
    });
    outputState.resolvedProjectRef = projectState.project_root;
    outputState.resolvedRuntimeRoot = projectState.runtime_root;
    outputState.runtimeLayout = projectState.runtime_layout;
    outputState.runtimeStateFile = projectState.state_file;
    outputState.projectProfileRef = projectState.project_profile_ref;

    const qualityArtifacts = listQualityArtifacts({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
    });
    const incidents = qualityArtifacts.filter((artifact) => artifact.family === "incident-report");
    const backfillProposals = qualityArtifacts.filter((artifact) => artifact.family === "incident-backfill-proposal");

    const runRefFilter = runIdFilter ? toRunRef(runIdFilter) : null;
    const incidentMatches = incidents
      .filter((artifact) =>
        !incidentIdFilter || artifact.document.incident_id === incidentIdFilter,
      )
      .filter((artifact) => {
        if (!runRefFilter) return true;
        const refs = asStringArray(artifact.document.linked_run_refs);
        return refs.includes(runRefFilter) || refs.includes(runIdFilter ?? "");
      });

    if (incidentIdFilter && incidentMatches.length === 0) {
      throw new CliUsageError(`Incident '${incidentIdFilter}' was not found.`);
    }
    if (runIdFilter && incidentMatches.length === 0) {
      throw new CliUsageError(`No incident records are linked to run '${runIdFilter}'.`);
    }

    const boundedMatches = typeof limit === "number" ? incidentMatches.slice(0, limit) : incidentMatches;
    outputState.incidentRecords = boundedMatches.map((artifact) => ({
      incident_id:
        typeof artifact.document.incident_id === "string" ? artifact.document.incident_id : null,
      incident_ref: artifact.artifact_ref,
      incident_report_file: artifact.file,
      status: typeof artifact.document.status === "string" ? artifact.document.status : null,
      severity: typeof artifact.document.severity === "string" ? artifact.document.severity : null,
      summary: typeof artifact.document.summary === "string" ? artifact.document.summary : null,
      linked_run_refs: asStringArray(artifact.document.linked_run_refs),
      linked_asset_refs: asStringArray(artifact.document.linked_asset_refs),
      linked_backlog_refs: asStringArray(artifact.document.linked_backlog_refs),
      backfill_proposal_refs: backfillProposals
        .filter((proposal) => {
          const sourceArtifacts = asPlainObject(proposal.document.source_artifacts);
          return sourceArtifacts.incident_ref === artifact.artifact_ref || sourceArtifacts.incident_id === artifact.document.incident_id;
        })
        .map((proposal) => proposal.artifact_ref),
      recertification:
        typeof artifact.document.recertification === "object" &&
        artifact.document.recertification !== null &&
        !Array.isArray(artifact.document.recertification)
          ? artifact.document.recertification
          : null,
      recertification_updated_at:
        typeof artifact.document.recertification_updated_at === "string"
          ? artifact.document.recertification_updated_at
          : null,
      created_at: typeof artifact.document.created_at === "string" ? artifact.document.created_at : null,
    }));
    outputState.auditEvidenceRefs = uniqueStrings(outputState.incidentRecords.flatMap((record) => record.linked_asset_refs));
    outputState.readOnly = true;
    outputState.futureControlHooks = runIdFilter
      ? [
          `audit runs --run-id ${runIdFilter}`,
          "incident recertify --incident-id <id> --decision recertify",
        ]
      : [
          "audit runs",
          "incident open --run-id <id> --summary <text>",
          "incident recertify --incident-id <id> --decision recertify",
        ];
  } else if (command === "audit runs") {
    ensureRequiredFlags(command, flags);
    const runIdFilter = resolveOptionalStringFlag("run-id", flags["run-id"]);
    const limit = resolveOptionalIntegerFlag("limit", flags.limit, { min: 1 });

    const projectState = readProjectState({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
    });
    outputState.resolvedProjectRef = projectState.project_root;
    outputState.resolvedRuntimeRoot = projectState.runtime_root;
    outputState.runtimeLayout = projectState.runtime_layout;
    outputState.runtimeStateFile = projectState.state_file;
    outputState.projectProfileRef = projectState.project_profile_ref;

    const runsForAudit = listRuns({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
    });
    const scopedRuns = runIdFilter
      ? runsForAudit.filter((run) => run.run_id === runIdFilter)
      : runsForAudit;

    if (runIdFilter && scopedRuns.length === 0) {
      throw new CliUsageError(`Run '${runIdFilter}' was not found for audit output.`);
    }

    const qualityArtifactList = listQualityArtifacts({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
    });
    const stepArtifacts = listStepResults({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
    });
    const incidents = qualityArtifactList.filter((artifact) => artifact.family === "incident-report");
    const promotions = qualityArtifactList.filter((artifact) => artifact.family === "promotion-decision");

    const runAuditSource = scopedRuns.map((run) => {
      const runRef = toRunRef(run.run_id);
      const incidentMatches = incidents.filter((artifact) => {
        const refs = asStringArray(artifact.document.linked_run_refs);
        return refs.includes(runRef) || refs.includes(run.run_id);
      });
      const incidentRefs = uniqueStrings([
        ...run.quality_refs.filter((ref) => ref.includes("incident-report")),
        ...incidentMatches.map((artifact) => artifact.artifact_ref),
      ]);
      const promotionRefs = uniqueStrings([
        ...run.quality_refs.filter((ref) => ref.includes("promotion-decision")),
        ...promotions
          .filter((artifact) => artifact.artifact_ref && run.quality_refs.includes(artifact.artifact_ref))
          .map((artifact) => artifact.artifact_ref),
      ]);
      const scorecardRefs = uniqueStrings(
        [
          ...run.quality_refs.filter((ref) => ref.includes("learning-loop-scorecard")),
          ...incidentMatches
            .flatMap((artifact) => asStringArray(artifact.document.linked_asset_refs))
            .filter((ref) => ref.includes("learning-loop-scorecard")),
        ],
      );
      const evidenceRefs = uniqueStrings([
        ...run.packet_refs,
        ...run.step_result_refs,
        ...run.quality_refs,
        ...incidentMatches.flatMap((artifact) => asStringArray(artifact.document.linked_asset_refs)),
      ]);
      const reviewArtifact =
        qualityArtifactList.find(
          (artifact) => artifact.family === "review-report" && run.quality_refs.includes(artifact.artifact_ref),
        ) ?? null;
      const reviewDocument = asPlainObject(reviewArtifact?.document);
      const reviewFeatureTraceability = asPlainObject(reviewDocument.feature_traceability);
      const reviewFeatureSizeFit = asPlainObject(reviewDocument.feature_size_fit);
      const learningHandoffArtifact =
        qualityArtifactList.find(
          (artifact) => artifact.family === "learning-loop-handoff" && run.quality_refs.includes(artifact.artifact_ref),
        ) ?? null;
      const learningHandoffDocument = asPlainObject(learningHandoffArtifact?.document);
      const reviewCoverageFollowUp = asPlainObject(reviewFeatureTraceability.coverage_follow_up);
      const learningCoverageFollowUp = asPlainObject(learningHandoffDocument.coverage_follow_up);
      const runStepArtifacts = stepArtifacts.filter((artifact) => run.step_result_refs.includes(artifact.artifact_ref));
      const providerExecutionStatus = resolveProviderExecutionStatus(projectState.project_root, runStepArtifacts);

      return {
        run_id: run.run_id,
        run_ref: runRef,
        packet_refs: run.packet_refs,
        step_result_refs: run.step_result_refs,
        quality_refs: run.quality_refs,
        finance_evidence: run.finance_evidence,
        incident_refs: incidentRefs,
        promotion_refs: promotionRefs,
        scorecard_refs: scorecardRefs,
        evidence_refs: evidenceRefs,
        evidence_root: projectState.runtime_layout.reports_root,
        scenario_family:
          typeof reviewFeatureTraceability.scenario_family === "string"
            ? reviewFeatureTraceability.scenario_family
            : null,
        provider_variant_id:
          typeof reviewFeatureTraceability.provider_variant_id === "string"
            ? reviewFeatureTraceability.provider_variant_id
            : null,
        feature_size:
          typeof reviewFeatureTraceability.feature_size === "string"
            ? reviewFeatureTraceability.feature_size
            : null,
        matrix_cell:
          Object.keys(asPlainObject(learningHandoffDocument.matrix_cell)).length > 0
            ? asPlainObject(learningHandoffDocument.matrix_cell)
            : asPlainObject(reviewFeatureTraceability.matrix_cell),
        coverage_follow_up:
          Object.keys(reviewCoverageFollowUp).length > 0 ? reviewCoverageFollowUp : learningCoverageFollowUp,
        provider_execution_status: providerExecutionStatus,
        feature_size_fit_status:
          typeof reviewFeatureSizeFit.status === "string" ? reviewFeatureSizeFit.status : null,
      };
    });

    outputState.runAuditRecords = typeof limit === "number" ? runAuditSource.slice(0, limit) : runAuditSource;
    outputState.auditEvidenceRefs = uniqueStrings(outputState.runAuditRecords.flatMap((record) => record.evidence_refs));
    outputState.readOnly = true;
    outputState.futureControlHooks = runIdFilter
      ? [
          `incident open --run-id ${runIdFilter} --summary <text>`,
          `incident show --run-id ${runIdFilter}`,
          "incident recertify --incident-id <id> --decision recertify",
        ]
      : [
          "incident open --run-id <id> --summary <text>",
          "incident show --run-id <id>",
          "incident recertify --incident-id <id> --decision recertify",
        ];
  } else {
    return false;
  }
  return true;
}
