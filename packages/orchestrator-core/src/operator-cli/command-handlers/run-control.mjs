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
  materializeTaskProgress,
  executeRuntimeHarnessRun,
  resolveExecutionUnitContext,
  controlParentRun,
  readParentRun,
  requestRunJobCancel,
  retryParentUnit,
  scheduleParentRun,
  startRunJob,
  startParentRun,
  applyIntegrationToParent,
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
  finalizeRunControlFailure,
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
  "run retry",
  "run integration",
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
 * @param {Record<string, unknown>} outputState
 * @param {ReturnType<typeof applyRunControlAction>} controlResult
 */
function populateRunControlOutputState(outputState, controlResult) {
  outputState.resolvedProjectRef = controlResult.projectRoot;
  outputState.resolvedRuntimeRoot = controlResult.runtimeRoot;
  outputState.runtimeLayout = controlResult.runtimeLayout;
  outputState.projectProfileRef = controlResult.projectProfileRef;
  outputState.runtimeStateFile = controlResult.stateFile;
  outputState.runControlAction = controlResult.action;
  outputState.runControlCommandId = controlResult.commandId;
  outputState.runControlRevision = controlResult.revision;
  outputState.runControlRunId = controlResult.runId;
  outputState.runControlState = controlResult.state;
  outputState.runControlStateFile = controlResult.stateFile;
  outputState.runControlAuditId = controlResult.auditRecord.audit_id;
  outputState.runControlAuditFile = controlResult.auditFile;
  outputState.runControlBlocked = controlResult.blocked;
  outputState.runControlBlockedReason = controlResult.blockedReason;
  outputState.runControlGuardrails = controlResult.guardrails;
  outputState.runControlTransition = controlResult.transition;
  outputState.primaryEventId = controlResult.primaryEvent.event_id;
  outputState.evidenceEventId = controlResult.evidenceEvent.event_id;
  outputState.streamLogFile = controlResult.streamLogFile;
  outputState.readOnly = false;
  outputState.futureControlHooks = controlResult.nextActions;
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * @param {{ command: string, flags: Record<string, string | string[] | true>, cwd: string, outputState: Record<string, unknown> }} context
 * @returns {boolean}
 */
export function handleRunControlCommand(context) {
  const { command, flags, cwd, outputState } = context;
  if (command === "run integration") {
    ensureRequiredFlags(command, flags);
    const projectRef = /** @type {string} */ (flags["project-ref"]);
    const runtimeRoot = resolveOptionalStringFlag("runtime-root", flags["runtime-root"]);
    const parentRunId = /** @type {string} */ (flags["parent-run-id"]);
    const action = /** @type {string} */ (flags.action);
    const current = readParentRun({ cwd, projectRef, runtimeRoot, parentRunId });
    if (!current.parent) throw new CliUsageError(`Parent run '${parentRunId}' was not found.`);
    outputState.resolvedProjectRef = current.init.projectRoot;
    outputState.resolvedRuntimeRoot = current.init.runtimeRoot;
    outputState.parentRunFile = current.file;
    if (action === "show") {
      outputState.parentRun = current.parent;
      outputState.readOnly = true;
      return true;
    }
    const commandId = resolveOptionalStringFlag("command-id", flags["command-id"]);
    const expectedRevision = resolveOptionalIntegerFlag("expected-revision", flags["expected-revision"], { min: 0 });
    if (!commandId || expectedRevision === null) throw new CliUsageError("Integration mutations require '--command-id' and '--expected-revision'.");
    if (action === "apply" || action === "verify") {
      const reportFile = resolveOptionalStringFlag("integration-report-file", flags["integration-report-file"]);
      if (!reportFile) throw new CliUsageError(`Integration action '${action}' requires '--integration-report-file'.`);
      const report = readJson(path.resolve(cwd, reportFile));
      const validation = validateContractDocument({ family: "integration-report", document: report, source: reportFile });
      if (!validation.ok || report.project_id !== current.init.projectId || report.parent_run_id !== parentRunId) {
        throw new CliUsageError("Integration report is invalid or owned by another project/parent run.");
      }
      const reportRef = toEvidenceRef(current.init.projectRoot, path.resolve(cwd, reportFile));
      outputState.parentRun = applyIntegrationToParent({
        parentFile: current.file, expectedRevision, report, integrationReportRef: reportRef,
      });
      outputState.integrationReport = report;
    } else if (action === "hold") {
      outputState.parentRun = controlParentRun({ parentFile: current.file, expectedRevision, action: "pause", commandId });
    } else if (action === "resume") {
      outputState.parentRun = controlParentRun({ parentFile: current.file, expectedRevision, action: "resume", commandId });
    } else if (action === "repair") {
      const repairRef = resolveOptionalStringFlag("quality-repair-ref", flags["quality-repair-ref"]);
      if (!repairRef) throw new CliUsageError("Integration repair requires '--quality-repair-ref'.");
      const report = { ...current.parent, repair_refs: uniqueStrings([...(current.parent.repair_refs ?? []), repairRef]) };
      outputState.parentRun = applyIntegrationToParent({
        parentFile: current.file,
        expectedRevision,
        report: { aggregate_gates: report.integration_gates ?? [], stale_units: report.stale_units ?? [], repair_refs: report.repair_refs, status: "repair-required" },
        integrationReportRef: report.integration_report_ref ?? repairRef,
      });
    } else {
      throw new CliUsageError(`Unsupported integration action '${action}'.`);
    }
    outputState.readOnly = false;
    outputState.futureControlHooks = [`run integration --parent-run-id ${parentRunId} --action show`];
    return true;
  }
  if (command === "run retry") {
    ensureRequiredFlags(command, flags);
    const projectRef = /** @type {string} */ (flags["project-ref"]);
    const runtimeRoot = resolveOptionalStringFlag("runtime-root", flags["runtime-root"]);
    const parentRunId = /** @type {string} */ (flags["parent-run-id"]);
    const executionUnitId = /** @type {string} */ (flags["execution-unit-id"]);
    const commandId = /** @type {string} */ (flags["command-id"]);
    const expectedRevision = resolveOptionalIntegerFlag("expected-revision", flags["expected-revision"], { min: 0 });
    const current = readParentRun({ cwd, projectRef, runtimeRoot, parentRunId });
    if (!current.parent) throw new CliUsageError(`Parent run '${parentRunId}' was not found.`);
    const parent = retryParentUnit({
      parentFile: current.file,
      executionUnitId,
      commandId,
      expectedRevision,
    });
    outputState.resolvedProjectRef = current.init.projectRoot;
    outputState.resolvedRuntimeRoot = current.init.runtimeRoot;
    outputState.parentRun = parent;
    outputState.parentRunFile = current.file;
    const retryEvent = appendRunEvent({
      cwd,
      projectRef,
      runtimeRoot,
      runId: parentRunId,
      eventType: "parent.unit.retry-requested",
      requestKey: commandId,
      payload: { execution_unit_id: executionUnitId, revision: parent.revision },
    });
    outputState.primaryEventId = retryEvent.event.event_id;
    outputState.streamLogFile = retryEvent.logFile;
    outputState.readOnly = false;
    outputState.futureControlHooks = [`run status --run-id ${parentRunId}`];
    return true;
  }
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
    const executionPlanRef = resolveOptionalStringFlag("execution-plan-ref", flags["execution-plan-ref"]);
    const executionUnitId = resolveOptionalStringFlag("execution-unit-id", flags["execution-unit-id"]);
    const workspaceSetRef = resolveOptionalStringFlag("workspace-set-ref", flags["workspace-set-ref"]);
    const maxConcurrency = resolveOptionalIntegerFlag("max-concurrency", flags["max-concurrency"], { min: 1 });
    const maxChildStarts = resolveOptionalIntegerFlag("max-child-starts", flags["max-child-starts"], { min: 1 });
    const promotionEvidenceRefs = resolveOptionalCsvFlag(
      "promotion-evidence-refs",
      flags["promotion-evidence-refs"],
    );
    const routeOverrides = resolveRouteOverridesFlag(flags["route-overrides"]);
    const policyOverrides = resolvePolicyOverridesFlag(flags["policy-overrides"]);
    const projectRef = /** @type {string} */ (flags["project-ref"]);
    const runtimeRoot = resolveOptionalStringFlag("runtime-root", flags["runtime-root"]);
    const reason = resolveOptionalStringFlag("reason", flags.reason);
    const approvalRef = resolveOptionalStringFlag("approval-ref", flags["approval-ref"]);
    const commandId = resolveOptionalStringFlag("command-id", flags["command-id"]);
    const expectedRevision = resolveOptionalIntegerFlag("expected-revision", flags["expected-revision"], { min: 0 });
    const unsafeDevelopmentOverride = resolveOptionalBooleanFlag(
      "unsafe-development-override",
      flags["unsafe-development-override"],
    );

    if (runAction !== "start" && runAction !== "steer" && targetStep) {
      throw new CliUsageError(`Flag '--target-step' is only valid for 'aor run start' or 'aor run steer'.`);
    }
    if (runAction !== "start" && flags["require-validation-pass"] !== undefined) {
      throw new CliUsageError(`Flag '--require-validation-pass' is only valid for 'aor run start'.`);
    }
    if (runAction !== "start" && approvedHandoffRef) {
      throw new CliUsageError(`Flag '--approved-handoff-ref' is only valid for 'aor run start'.`);
    }
    if (runAction !== "start" && (executionPlanRef || executionUnitId || workspaceSetRef)) {
      throw new CliUsageError(
        "Flags '--execution-plan-ref', '--execution-unit-id', and '--workspace-set-ref' are only valid for 'aor run start'.",
      );
    }
    if (runAction !== "start" && (maxConcurrency !== undefined || maxChildStarts !== undefined)) {
      throw new CliUsageError("Flags '--max-concurrency' and '--max-child-starts' are only valid for 'aor run start'.");
    }
    const childStart = runAction === "start" && Boolean(executionPlanRef && executionUnitId && !workspaceSetRef);
    const parentStart = runAction === "start" && Boolean(executionPlanRef && workspaceSetRef && !executionUnitId);
    if (
      runAction === "start" &&
      (executionPlanRef || executionUnitId || workspaceSetRef) &&
      !childStart &&
      !parentStart
    ) {
      throw new CliUsageError(
        "Use '--execution-plan-ref' with either '--execution-unit-id' for one child run or '--workspace-set-ref' for one parent run.",
      );
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

    let executionContext = null;
    if (childStart) {
      try {
        executionContext = resolveExecutionUnitContext({
          cwd,
          projectRef,
          runtimeRoot,
          executionPlanRef,
          executionUnitId,
        });
      } catch (error) {
        throw new CliUsageError(errorMessage(error));
      }
    }

    if (runAction !== "start" && runId && (runAction === "pause" || runAction === "resume" || runAction === "cancel")) {
      const currentParent = readParentRun({ cwd, projectRef, runtimeRoot, parentRunId: runId });
      if (currentParent.parent) {
        if (!commandId) throw new CliUsageError(`Flag '--command-id' is required for parent run ${runAction}.`);
        if (expectedRevision === undefined) {
          throw new CliUsageError(`Flag '--expected-revision' is required for parent run ${runAction}.`);
        }
        const parent = controlParentRun({
          parentFile: currentParent.file,
          action: runAction,
          commandId,
          expectedRevision,
          controlChild: ({ action, childRunId }) => {
            applyRunControlAction({
              cwd,
              projectRef,
              runtimeRoot,
              runId: childRunId,
              action,
              commandId: `${commandId}-${childRunId}`,
            });
            if (action === "cancel") {
              requestRunJobCancel({ cwd, projectRef, runtimeRoot, runId: childRunId });
            }
          },
        });
        outputState.resolvedProjectRef = currentParent.init.projectRoot;
        outputState.resolvedRuntimeRoot = currentParent.init.runtimeRoot;
        outputState.parentRun = parent;
        outputState.parentRunFile = currentParent.file;
        const parentEvent = appendRunEvent({
          cwd,
          projectRef,
          runtimeRoot,
          runId,
          eventType: `parent.${runAction}`,
          requestKey: commandId,
          payload: { status: parent.status, revision: parent.revision },
        });
        outputState.primaryEventId = parentEvent.event.event_id;
        outputState.streamLogFile = parentEvent.logFile;
        outputState.readOnly = false;
        outputState.futureControlHooks = [`run status --run-id ${runId}`];
        return true;
      }
    }

    if (runAction === "start" && requireValidationPass) {
      const existingRun = runId
        ? readRunControlState({
            cwd,
            projectRef,
            runtimeRoot,
            runId,
          })
        : null;
      const existingStatus =
        typeof existingRun?.state?.status === "string" && existingRun.state.status.trim().length > 0
          ? existingRun.state.status.trim()
          : null;

      if (!existingStatus) {
        let validationGate = null;
        try {
          validationGate = validateProjectRuntime({
            cwd,
            projectRef,
            runtimeRoot,
          });
        } catch (error) {
          const controlResult = applyRunControlAction({
            cwd,
            projectRef,
            runtimeRoot,
            runId,
            action: runAction,
            targetStep,
            reason,
            approvalRef,
            commandId,
            expectedRevision,
            preflightBlock: {
              code: "validation.error",
              message: `Run start validation preflight failed before durable start transition: ${errorMessage(error)}`,
            },
          });
          populateRunControlOutputState(outputState, controlResult);
          return true;
        }

        if (validationGate.report.status === "fail") {
          const controlResult = applyRunControlAction({
            cwd,
            projectRef,
            runtimeRoot,
            runId,
            action: runAction,
            targetStep,
            reason,
            approvalRef,
            commandId,
            expectedRevision,
            preflightBlock: {
              code: "validation.failed",
              message: "Run start requires a passing validation report before execution can begin.",
              evidenceRefs: [validationGate.validationReportPath],
            },
          });
          populateRunControlOutputState(outputState, controlResult);
          return true;
        }
      }
    }

    if (parentStart) {
      const projectRoot = resolveProjectRef(projectRef, cwd);
      const executionPlanPath = resolveOptionalRefOrPathFlag({
        cwd,
        projectRoot,
        flagName: "execution-plan-ref",
        flagValue: executionPlanRef,
      });
      const loadedPlan = loadContractFile({
        filePath: /** @type {string} */ (executionPlanPath),
        family: "execution-plan",
      });
      if (!loadedPlan.ok) {
        const issues = loadedPlan.validation.issues.map((issue) => issue.message).join("; ");
        throw new CliUsageError(`Execution plan '${executionPlanRef}' failed validation: ${issues}`);
      }
      const workspaceSetPath = resolveOptionalRefOrPathFlag({
        cwd,
        projectRoot: workspaceSetRef.startsWith("evidence://") &&
          !workspaceSetRef.slice("evidence://".length).startsWith(".aor/")
          ? /** @type {{ projectRuntimeRoot: string }} */ (
              readProjectState({ cwd, projectRef, runtimeRoot }).runtime_layout
            ).projectRuntimeRoot
          : projectRoot,
        flagName: "workspace-set-ref",
        flagValue: workspaceSetRef,
      });
      const loadedWorkspaceSet = loadContractFile({
        filePath: /** @type {string} */ (workspaceSetPath),
        family: "workspace-set",
      });
      if (!loadedWorkspaceSet.ok) {
        const issues = loadedWorkspaceSet.validation.issues.map((issue) => issue.message).join("; ");
        throw new CliUsageError(`Workspace set '${workspaceSetRef}' failed validation: ${issues}`);
      }
      const started = startParentRun({
        cwd,
        projectRef,
        runtimeRoot,
        parentRunId: runId,
        executionPlan: loadedPlan.document,
        executionPlanRef,
        workspaceSet: loadedWorkspaceSet.document,
        workspaceSetRef,
        maxConcurrency,
        budgets: maxChildStarts === undefined ? undefined : { max_child_starts: maxChildStarts },
      });
      const scheduled = scheduleParentRun({
        parentFile: started.file,
        startChild: (child) => {
          const childArgs = [
            "run",
            "start",
            "--project-ref",
            started.init.projectRoot,
            "--run-id",
            child.child_run_id,
            "--execution-plan-ref",
            executionPlanRef,
            "--execution-unit-id",
            child.execution_unit_id,
            "--require-validation-pass",
            "false",
            ...(runtimeRoot ? ["--runtime-root", runtimeRoot] : []),
          ];
          const job = startRunJob({
            cwd: started.init.projectRoot,
            projectRef: started.init.projectRoot,
            runtimeRoot,
            runId: child.child_run_id,
            args: childArgs,
          });
          return {
            ...child,
            job_id: job.job.job_id,
            job_status: job.job.status,
            status_ref: job.job.status_ref,
            event_ref: job.job.event_ref,
          };
        },
      });
      outputState.resolvedProjectRef = started.init.projectRoot;
      outputState.resolvedRuntimeRoot = started.init.runtimeRoot;
      outputState.parentRun = scheduled.parent;
      outputState.parentRunFile = started.file;
      outputState.scheduledChildren = scheduled.started;
      const parentEvent = appendRunEvent({
        cwd,
        projectRef,
        runtimeRoot,
        runId: scheduled.parent.parent_run_id,
        eventType: "parent.started",
        requestKey: commandId ?? `parent-start-${scheduled.parent.request_digest}`,
        payload: {
          revision: scheduled.parent.revision,
          execution_plan_ref: executionPlanRef,
          workspace_set_ref: workspaceSetRef,
          scheduled_children: scheduled.started,
        },
      });
      outputState.primaryEventId = parentEvent.event.event_id;
      outputState.streamLogFile = parentEvent.logFile;
      outputState.readOnly = false;
      outputState.futureControlHooks = [
        `run status --run-id ${scheduled.parent.parent_run_id}`,
        `run pause --run-id ${scheduled.parent.parent_run_id} --command-id <id> --expected-revision ${scheduled.parent.revision}`,
      ];
      return true;
    }

    const controlResult = applyRunControlAction({
      cwd,
      projectRef,
      runtimeRoot,
      runId,
      action: runAction,
      targetStep,
      reason,
      approvalRef,
      commandId,
      expectedRevision,
      executionPlanRef: executionContext?.executionPlanRef,
      executionUnitId: executionContext?.executionUnitId,
      taskRefs: executionContext?.taskRefs,
    });

    populateRunControlOutputState(outputState, controlResult);

    if (runAction === "start" && !controlResult.blocked) {
      let routedExecution;
      try {
        routedExecution = executeRuntimeHarnessRun({
          cwd,
          projectRef,
          projectProfile: resolveOptionalStringFlag("project-profile", flags["project-profile"]),
          runtimeRoot,
          stepClass: targetStep ?? "implement",
          dryRun: false,
          runId: controlResult.runId,
          stepId: `run.start.${targetStep ?? "implement"}`,
          requireDiscoveryCompleteness: true,
          approvedHandoffRef: approvedHandoffRef ?? undefined,
          promotionEvidenceRefs,
          routeOverrides,
          policyOverrides,
          providerStepStatusStateFile: controlResult.stateFile,
          executionPlanRef: executionContext?.executionPlanRef,
          executionUnitId: executionContext?.executionUnitId,
          taskRefs: executionContext?.taskRefs,
          planDigest: executionContext?.planDigest,
          taskDigests: executionContext?.taskDigests,
          unsafeDevelopmentOverride,
        });
      } catch (error) {
        const message = errorMessage(error);
        outputState.runControlState = finalizeRunControlFailure({
          stateFile: controlResult.stateFile,
          previousState:
            typeof controlResult.state === "object" && controlResult.state !== null ? controlResult.state : null,
          targetStep: targetStep ?? "implement",
          failureCode: "runtime_execution.error",
          failureSummary: message,
        });
        const terminalEvent = appendRunEvent({
          cwd,
          projectRef,
          runtimeRoot,
          runId: controlResult.runId,
          eventType: "run.terminal",
          payload: {
            status: "failed",
            summary: `Run start failed after durable start transition: ${message}`,
            failure_code: "runtime_execution.error",
          },
        });
        outputState.primaryEventId = terminalEvent.event.event_id;
        outputState.streamLogFile = terminalEvent.logFile;
        outputState.futureControlHooks = [
          `incident open --run-id ${controlResult.runId} --summary <text>`,
          `run status --run-id ${controlResult.runId}`,
        ];
        throw new CliUsageError(`Run start failed after durable start transition: ${message}`);
      }
      outputState.routedStepResultId = routedExecution.stepResult.step_result_id;
      outputState.unsafeDevelopmentOverride = unsafeDevelopmentOverride;
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
        projectRef,
        runtimeRoot,
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
        projectRef,
        runtimeRoot,
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
      if (executionContext) {
        const progress = materializeTaskProgress({
          cwd,
          projectRef,
          runtimeRoot,
          planRef: executionContext.planFile,
        });
        outputState.executionPlan = progress.executionPlan;
        outputState.executionPlanFile = progress.executionPlanFile;
        outputState.taskProgress = progress.taskProgress;
        outputState.taskProgressFile = progress.taskProgressFile;
      }
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
    if (runId) {
      const parent = readParentRun({
        cwd,
        projectRef: /** @type {string} */ (flags["project-ref"]),
        runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
        parentRunId: runId,
      });
      outputState.parentRun = parent.parent;
      outputState.parentRunFile = parent.parent ? parent.file : null;
    }
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
