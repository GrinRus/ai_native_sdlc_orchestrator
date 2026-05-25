import {
  CliUsageError,
  InteractionAnswerError,
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
  verifyProjectRuntime,
  materializeIntakeArtifactPacket,
  materializeReviewReport,
  executeRuntimeHarnessRun,
  submitInteractionAnswer,
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

export const RUN_CONTROL_COMMANDS = Object.freeze([
  "run start",
  "run pause",
  "run resume",
  "run steer",
  "run cancel",
  "run answer",
  "run status",
  "ui attach",
  "ui detach"
]);

export const RUN_CONTROL_COMMAND_GROUP = Object.freeze({
  group_id: "run-control",
  commands: RUN_CONTROL_COMMANDS,
});

/**
 * @param {{ command: string, flags: Record<string, string | string[] | true>, cwd: string, outputState: Record<string, unknown> }} context
 * @returns {boolean}
 */
export function handleRunControlCommand(context) {
  const { command, flags, cwd, outputState } = context;
  if (
    command === "run start" ||
    command === "run pause" ||
    command === "run resume" ||
    command === "run steer" ||
    command === "run cancel"
  ) {
    ensureRequiredFlags(command, flags);

    const runAction = /** @type {"start" | "pause" | "resume" | "steer" | "cancel"} */ (command.split(" ")[1]);
    const runId = resolveOptionalStringFlag("run-id", flags["run-id"]);
    const targetStep = resolveOptionalStringFlag("target-step", flags["target-step"]);
    const requireValidationPass =
      flags["require-validation-pass"] === undefined
        ? runAction === "start"
        : resolveOptionalBooleanFlag("require-validation-pass", flags["require-validation-pass"]);
    const approvedHandoffRef = resolveOptionalStringFlag("approved-handoff-ref", flags["approved-handoff-ref"]);
    const promotionEvidenceRefs = resolveOptionalCsvFlag(
      "promotion-evidence-refs",
      flags["promotion-evidence-refs"],
    );
    const routeOverrides = resolveRouteOverridesFlag(flags["route-overrides"]);
    const policyOverrides = resolvePolicyOverridesFlag(flags["policy-overrides"]);

    if (runAction !== "start" && runAction !== "steer" && targetStep) {
      throw new CliUsageError(`Flag '--target-step' is only valid for 'aor run start' or 'aor run steer'.`);
    }
    if (runAction !== "start" && flags["require-validation-pass"] !== undefined) {
      throw new CliUsageError(`Flag '--require-validation-pass' is only valid for 'aor run start'.`);
    }
    if (runAction !== "start" && approvedHandoffRef) {
      throw new CliUsageError(`Flag '--approved-handoff-ref' is only valid for 'aor run start'.`);
    }
    if (runAction !== "start" && promotionEvidenceRefs.length > 0) {
      throw new CliUsageError(`Flag '--promotion-evidence-refs' is only valid for 'aor run start'.`);
    }
    if (runAction !== "start" && flags["route-overrides"] !== undefined) {
      throw new CliUsageError(`Flag '--route-overrides' is only valid for 'aor run start'.`);
    }
    if (runAction !== "start" && flags["policy-overrides"] !== undefined) {
      throw new CliUsageError(`Flag '--policy-overrides' is only valid for 'aor run start'.`);
    }

    const controlResult = applyRunControlAction({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
      runId,
      action: runAction,
      targetStep,
      reason: resolveOptionalStringFlag("reason", flags.reason),
      approvalRef: resolveOptionalStringFlag("approval-ref", flags["approval-ref"]),
    });

    outputState.resolvedProjectRef = controlResult.projectRoot;
    outputState.resolvedRuntimeRoot = controlResult.runtimeRoot;
    outputState.runtimeLayout = controlResult.runtimeLayout;
    outputState.projectProfileRef = controlResult.projectProfileRef;
    outputState.runtimeStateFile = controlResult.stateFile;
    outputState.runControlAction = controlResult.action;
    outputState.runControlRunId = controlResult.runId;
    outputState.runControlState = controlResult.state;
    outputState.runControlStateFile = controlResult.stateFile;
    outputState.runControlAuditId = controlResult.auditRecord.audit_id;
    outputState.runControlAuditFile = controlResult.auditFile;
    outputState.runControlBlocked = controlResult.blocked;
    outputState.runControlGuardrails = controlResult.guardrails;
    outputState.runControlTransition = controlResult.transition;
    outputState.primaryEventId = controlResult.primaryEvent.event_id;
    outputState.evidenceEventId = controlResult.evidenceEvent.event_id;
    outputState.streamLogFile = controlResult.streamLogFile;
    outputState.readOnly = false;
    outputState.futureControlHooks = controlResult.nextActions;

    if (runAction === "start" && !controlResult.blocked) {
      if (requireValidationPass) {
        const validationGate = validateProjectRuntime({
          cwd,
          projectRef: /** @type {string} */ (flags["project-ref"]),
          runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
        });
        if (validationGate.report.status === "fail") {
          throw new CliUsageError("Run start requires a passing validation report before execution can begin.");
        }
      }

      const routedExecution = executeRuntimeHarnessRun({
        cwd,
        projectRef: /** @type {string} */ (flags["project-ref"]),
        projectProfile: resolveOptionalStringFlag("project-profile", flags["project-profile"]),
        runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
        stepClass: targetStep ?? "implement",
        dryRun: false,
        runId: controlResult.runId,
        stepId: `run.start.${targetStep ?? "implement"}`,
        requireDiscoveryCompleteness: true,
        approvedHandoffRef: approvedHandoffRef ?? undefined,
        promotionEvidenceRefs,
        routeOverrides,
        policyOverrides,
      });
      outputState.routedStepResultId = routedExecution.stepResult.step_result_id;
      outputState.routedStepResultFile = routedExecution.stepResultPath;
      outputState.runControlState = finalizeRunControlState({
        projectRoot: controlResult.projectRoot,
        stateFile: controlResult.stateFile,
        previousState:
          typeof controlResult.state === "object" && controlResult.state !== null ? controlResult.state : null,
        stepStatus: routedExecution.stepResult.status,
        targetStep: targetStep ?? "implement",
        stepResultFile: routedExecution.stepResultPath,
      });

      const requestedInteraction = asPlainObject(routedExecution.stepResult.requested_interaction);
      const interactionStatus =
        typeof requestedInteraction.status === "string" && requestedInteraction.status.trim().length > 0
          ? requestedInteraction.status.trim()
          : "requested";
      const interactionPayload =
        requestedInteraction.requested === true
          ? {
              interaction_id:
                typeof requestedInteraction.interaction_id === "string" ? requestedInteraction.interaction_id : null,
              status: interactionStatus,
              step_result_ref: toEvidenceRef(controlResult.projectRoot, routedExecution.stepResultPath),
              question_summary:
                typeof requestedInteraction.prompt_summary === "string"
                  ? requestedInteraction.prompt_summary
                  : typeof requestedInteraction.summary === "string"
                    ? requestedInteraction.summary
                    : null,
              answer_required: interactionStatus === "requested",
              answer_audit_refs: asStringArray(requestedInteraction.answer_audit_refs),
              continuation: asPlainObject(requestedInteraction.continuation),
            }
          : null;

      const stepEvent = appendRunEvent({
        cwd,
        projectRef: /** @type {string} */ (flags["project-ref"]),
        runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
        runId: controlResult.runId,
        eventType: "step.updated",
        payload: {
          step_id: routedExecution.stepResult.step_id,
          status: routedExecution.stepResult.status,
          summary: routedExecution.stepResult.summary,
          step_result_ref: toEvidenceRef(controlResult.projectRoot, routedExecution.stepResultPath),
          ...(interactionPayload ? { interaction: interactionPayload } : {}),
        },
      });
      const terminalEvent = appendRunEvent({
        cwd,
        projectRef: /** @type {string} */ (flags["project-ref"]),
        runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
        runId: controlResult.runId,
        eventType: "run.terminal",
        payload: {
          status: outputState.runControlState.status,
          summary:
            routedExecution.stepResult.status === "passed"
              ? "Run completed through routed execution."
              : routedExecution.stepResult.summary,
          step_result_ref: toEvidenceRef(controlResult.projectRoot, routedExecution.stepResultPath),
        },
      });
      outputState.evidenceEventId = stepEvent.event.event_id;
      outputState.primaryEventId = terminalEvent.event.event_id;
      outputState.streamLogFile = terminalEvent.logFile;
      const runtimeHarness = routedExecution.runtimeHarness;
      outputState.runtimeHarnessReportId = runtimeHarness.report.report_id;
      outputState.runtimeHarnessReportFile = runtimeHarness.reportPath;
      outputState.runtimeHarnessOverallDecision = runtimeHarness.report.overall_decision;
      outputState.futureControlHooks =
        outputState.runtimeHarnessOverallDecision === "pass"
          ? [
              "run status",
              `review run --run-id ${controlResult.runId}`,
              `audit runs --run-id ${controlResult.runId}`,
            ]
          : [
              `incident open --run-id ${controlResult.runId} --summary <text>`,
              `review run --run-id ${controlResult.runId}`,
              `audit runs --run-id ${controlResult.runId}`,
            ];
    }
  } else if (command === "run answer") {
    ensureRequiredFlags(command, flags);
    const answerEvidenceRef = resolveOptionalStringFlag("answer-evidence-ref", flags["answer-evidence-ref"]);
    const decision = resolveOptionalStringFlag("decision", flags.decision);
    const answer =
      flags.answer === undefined ? "" : (resolveOptionalStringFlag("answer", flags.answer) ?? "");
    if (answer.length === 0 && !answerEvidenceRef && !decision) {
      throw new CliUsageError(
        "Flag '--answer' is required unless '--answer-evidence-ref' points to durable evidence or '--decision' is supplied.",
      );
    }

    try {
      const answerResult = submitInteractionAnswer({
        cwd,
        projectRef: /** @type {string} */ (flags["project-ref"]),
        runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
        runId: /** @type {string} */ (resolveOptionalStringFlag("run-id", flags["run-id"])),
        interactionId: /** @type {string} */ (resolveOptionalStringFlag("interaction-id", flags["interaction-id"])),
        answer,
        decision,
        reason: resolveOptionalStringFlag("reason", flags.reason),
        approvalRef: resolveOptionalStringFlag("approval-ref", flags["approval-ref"]),
        answerEvidenceRef,
      });

      outputState.resolvedProjectRef = answerResult.projectRoot;
      outputState.resolvedRuntimeRoot = answerResult.runtimeRoot;
      outputState.runtimeLayout = answerResult.runtimeLayout;
      outputState.projectProfileRef = answerResult.projectProfileRef;
      outputState.interactionAnswer = {
        run_id: answerResult.runId,
        interaction_id: answerResult.interactionId,
        interaction_status: answerResult.interactionStatus,
        answer_accepted: answerResult.answerAccepted,
        decision: answerResult.decision,
        answer_audit_file: answerResult.answerAuditFile,
        answer_audit_ref: answerResult.answerAuditRef,
        step_result_file: answerResult.stepResultFile,
        step_result_ref: answerResult.stepResultRef,
        run_control_transition: answerResult.runControlTransition,
        blocked: answerResult.blocked,
        blocked_reason: answerResult.blockedReason,
        evidence_event_id: answerResult.evidenceEvent.event_id,
        step_event_id: answerResult.stepEvent.event_id,
        resumed_event_id: answerResult.resumedEvent?.event_id ?? null,
        blocked_event_id: answerResult.blockedEvent?.event_id ?? null,
        warning_event_id: answerResult.warningEvent?.event_id ?? null,
        stream_log_file: answerResult.streamLogFile,
      };
      outputState.streamLogFile = answerResult.streamLogFile;
      outputState.readOnly = false;
      outputState.futureControlHooks = answerResult.blocked
        ? [`incident open --run-id ${answerResult.runId} --summary <text>`, `run status --run-id ${answerResult.runId}`]
        : [`run status --run-id ${answerResult.runId}`, `review run --run-id ${answerResult.runId}`];
    } catch (error) {
      if (error instanceof InteractionAnswerError) {
        throw new CliUsageError(error.message);
      }
      throw error;
    }
  } else if (command === "run status") {
    ensureRequiredFlags(command, flags);
    const runId = resolveOptionalStringFlag("run-id", flags["run-id"]);
    const follow = resolveOptionalBooleanFlag("follow", flags.follow);
    const afterEventId = resolveOptionalStringFlag("after-event-id", flags["after-event-id"]);
    const maxReplay = resolveOptionalIntegerFlag("max-replay", flags["max-replay"], { min: 0 });

    if (afterEventId && !follow) {
      throw new CliUsageError("Flag '--after-event-id' can only be used with '--follow'.");
    }
    if (maxReplay !== undefined && !follow) {
      throw new CliUsageError("Flag '--max-replay' can only be used with '--follow'.");
    }
    if (follow && !runId) {
      throw new CliUsageError("Flag '--run-id' is required when '--follow' is enabled.");
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
    const uiState = readUiLifecycleState({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
    });
    outputState.uiLifecycleState = uiState.state;
    outputState.uiLifecycleStateFile = uiState.stateFile;
    outputState.uiLifecycleConnectionState =
      typeof uiState.state.connection_state === "string" ? uiState.state.connection_state : null;
    outputState.uiLifecycleHeadlessSafe = uiState.state.headless_safe === true;

    outputState.runSummaries = listRuns({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
    }).filter((summary) => !runId || summary.run_id === runId);
    outputState.strategicSnapshot = readStrategicSnapshot({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
    });
    if (runId) {
      outputState.runEventHistory = readRunEventHistory({
        cwd,
        projectRef: /** @type {string} */ (flags["project-ref"]),
        runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
        runId,
        limit: maxReplay ?? 50,
      });
      outputState.runPolicyHistory = readRunPolicyHistory({
        cwd,
        projectRef: /** @type {string} */ (flags["project-ref"]),
        runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
        runId,
      });
    }

    outputState.followMode = {
      enabled: follow,
      run_id: runId ?? null,
      source: follow ? "control-plane-live-run-event-stream" : "disabled",
    };

    if (follow) {
      const stream = openRunEventStream({
        cwd,
        projectRef: /** @type {string} */ (flags["project-ref"]),
        runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
        runId: /** @type {string} */ (runId),
        afterEventId,
        maxReplay,
      });
      outputState.streamProtocol = stream.protocol;
      outputState.streamBackpressure = stream.backpressure;
      outputState.replayEvents = stream.replay_events;
      outputState.followMode = {
        ...outputState.followMode,
        replay_count: stream.replay_events.length,
        stream_log_file: stream.log_file,
      };
      outputState.streamLogFile = stream.log_file;
    } else {
      outputState.replayEvents = [];
    }

    outputState.readOnly = true;
    outputState.futureControlHooks = ["run start", "run pause", "run resume", "run steer", "run cancel", "run answer"];

  } else if (command === "ui attach") {
    ensureRequiredFlags(command, flags);
    const uiAttachResult = attachUiLifecycle({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
      runId: resolveOptionalStringFlag("run-id", flags["run-id"]),
      controlPlane: resolveOptionalStringFlag("control-plane", flags["control-plane"]),
    });

    outputState.resolvedProjectRef = uiAttachResult.projectRoot;
    outputState.resolvedRuntimeRoot = uiAttachResult.runtimeRoot;
    outputState.runtimeLayout = uiAttachResult.runtimeLayout;
    outputState.runtimeStateFile = uiAttachResult.stateFile;
    outputState.projectProfileRef = uiAttachResult.projectProfileRef;
    outputState.uiLifecycleAction = uiAttachResult.action;
    outputState.uiLifecycleState = uiAttachResult.state;
    outputState.uiLifecycleStateFile = uiAttachResult.stateFile;
    outputState.uiLifecycleIdempotent = uiAttachResult.idempotent;
    outputState.uiLifecycleConnectionState =
      typeof uiAttachResult.state.connection_state === "string" ? uiAttachResult.state.connection_state : null;
    outputState.uiLifecycleHeadlessSafe = uiAttachResult.state.headless_safe === true;
    outputState.readOnly = false;
    outputState.futureControlHooks = ["ui detach", "run status --follow true"];
  } else if (command === "ui detach") {
    ensureRequiredFlags(command, flags);
    const uiDetachResult = detachUiLifecycle({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
      runId: resolveOptionalStringFlag("run-id", flags["run-id"]),
    });

    outputState.resolvedProjectRef = uiDetachResult.projectRoot;
    outputState.resolvedRuntimeRoot = uiDetachResult.runtimeRoot;
    outputState.runtimeLayout = uiDetachResult.runtimeLayout;
    outputState.runtimeStateFile = uiDetachResult.stateFile;
    outputState.projectProfileRef = uiDetachResult.projectProfileRef;
    outputState.uiLifecycleAction = uiDetachResult.action;
    outputState.uiLifecycleState = uiDetachResult.state;
    outputState.uiLifecycleStateFile = uiDetachResult.stateFile;
    outputState.uiLifecycleIdempotent = uiDetachResult.idempotent;
    outputState.uiLifecycleConnectionState =
      typeof uiDetachResult.state.connection_state === "string" ? uiDetachResult.state.connection_state : null;
    outputState.uiLifecycleHeadlessSafe = uiDetachResult.state.headless_safe === true;
    outputState.readOnly = false;
    outputState.futureControlHooks = ["ui attach", "run status --follow true"];
  } else {
    return false;
  }
  return true;
}
