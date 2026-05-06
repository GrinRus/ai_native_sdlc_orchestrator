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
  materializeLearningLoopArtifacts,
  resolveStepPolicyForStep,
  analyzeProjectRuntime,
  initializeProjectRuntime,
  validateProjectRuntime,
  verifyProjectRuntime,
  materializeIntakeArtifactPacket,
  materializeReviewReport,
  materializeRuntimeHarnessReport,
  materializeMultirepoCoordinationStatus,
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
  evaluateRuntimeHarnessDeliveryGate,
  resolveQualityGateMode,
  assertRuntimeHarnessAllowsDelivery,
  finalizeRunControlState,
  normalizeRunRef,
  filterArtifactsByRunId,
  resolveRouteOverridesFlag,
  resolvePolicyOverridesFlag,
  resolveProjectRef,
  resolveRuntimeRoot
} from "../command-runtime.mjs";

export const DELIVERY_COMMANDS = Object.freeze([
  "deliver prepare",
  "release prepare",
  "multirepo lock"
]);

export const DELIVERY_COMMAND_GROUP = Object.freeze({
  group_id: "delivery",
  commands: DELIVERY_COMMANDS,
});

/**
 * @param {{ command: string, flags: Record<string, string | string[] | true>, cwd: string, outputState: Record<string, unknown> }} context
 * @returns {boolean}
 */
export function handleDeliveryCommand(context) {
  const { command, flags, cwd, outputState } = context;
  if (command === "multirepo lock") {
    ensureRequiredFlags(command, flags);
    const action = resolveOptionalStringFlag("action", flags.action) ?? "inspect";
    if (!["acquire", "release", "inspect"].includes(action)) {
      throw new CliUsageError("Flag '--action' must be one of: acquire, release, inspect.");
    }
    const repoIds = resolveOptionalCsvFlag("repo-ids", flags["repo-ids"]);
    const pathGlobs = resolveOptionalCsvFlag("path-globs", flags["path-globs"]);
    const durationMinutes = resolveOptionalIntegerFlag("duration-minutes", flags["duration-minutes"], { min: 1 });
    if (action === "acquire" && !flags["owner-ref"]) {
      throw new CliUsageError("Flag '--owner-ref' is required for 'aor multirepo lock --action acquire'.");
    }
    if (action === "acquire" && repoIds.length === 0) {
      throw new CliUsageError("Flag '--repo-ids' is required for 'aor multirepo lock --action acquire'.");
    }
    if (action === "release" && !flags["lock-id"]) {
      throw new CliUsageError("Flag '--lock-id' is required for 'aor multirepo lock --action release'.");
    }

    const coordination = materializeMultirepoCoordinationStatus({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      projectProfile: resolveOptionalStringFlag("project-profile", flags["project-profile"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
      action: /** @type {"acquire" | "release" | "inspect"} */ (action),
      runId: resolveOptionalStringFlag("run-id", flags["run-id"]),
      ownerRef: resolveOptionalStringFlag("owner-ref", flags["owner-ref"]),
      repoIds,
      pathGlobs: pathGlobs.length > 0 ? pathGlobs : undefined,
      durationMinutes,
      lockId: resolveOptionalStringFlag("lock-id", flags["lock-id"]),
      releaseEvidenceRefs: resolveOptionalCsvFlag("release-evidence-refs", flags["release-evidence-refs"]),
      repoValidationRefs: resolveOptionalCsvFlag("repo-validation-refs", flags["repo-validation-refs"]),
      failedRepoIds: resolveOptionalCsvFlag("failed-repo-ids", flags["failed-repo-ids"]),
      integrationValidationRefs: resolveOptionalCsvFlag(
        "integration-validation-refs",
        flags["integration-validation-refs"],
      ),
    });

    outputState.resolvedProjectRef = coordination.projectRoot;
    outputState.resolvedRuntimeRoot = coordination.runtimeRoot;
    outputState.runtimeLayout = coordination.runtimeLayout;
    outputState.runtimeStateFile = coordination.stateFile;
    outputState.projectProfileRef = coordination.projectProfileRef;
    outputState.multirepoCoordinationId =
      typeof coordination.report.status_id === "string" ? coordination.report.status_id : null;
    outputState.multirepoCoordinationFile = coordination.statusPath;
    outputState.multirepoCoordinationRef = coordination.statusRef;
    outputState.multirepoCoordinationStatus =
      typeof coordination.report.status === "string" ? coordination.report.status : null;
    outputState.multirepoCoordinationBlocking = coordination.blocking;
    outputState.multirepoCoordinationBlockingReasons = Array.isArray(coordination.report.blocking_reasons)
      ? coordination.report.blocking_reasons
      : [];
    outputState.multirepoLockState =
      typeof coordination.report.lock_state === "object" && coordination.report.lock_state
        ? coordination.report.lock_state
        : null;
    outputState.multirepoCrossRepoValidation =
      typeof coordination.report.cross_repo_validation === "object" && coordination.report.cross_repo_validation
        ? coordination.report.cross_repo_validation
        : null;
    outputState.multirepoCoordinationRecords = [coordination.report];
    outputState.readOnly = action === "inspect";
    outputState.futureControlHooks = [
      `deliver prepare --coordination-evidence-refs ${coordination.statusRef}`,
      `deliver prepare --coordination-lock-evidence-refs ${coordination.statusRef}`,
      "delivery manifests preserve multirepo lock and cross-repo validation refs",
    ];
  } else if (command === "deliver prepare" || command === "release prepare") {
    ensureRequiredFlags(command, flags);
    const routeOverrides = resolveRouteOverridesFlag(flags["route-overrides"]);
    const policyOverrides = resolvePolicyOverridesFlag(flags["policy-overrides"]);
    const deliveryQualityGateMode =
      command === "deliver prepare" ? resolveQualityGateMode(flags["quality-gate-mode"]) : "strict";
    if (command === "release prepare" && flags["quality-gate-mode"] !== undefined) {
      throw new CliUsageError("Flag '--quality-gate-mode' is only valid for 'aor deliver prepare'.");
    }

    const init = initializeProjectRuntime({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      projectProfile: resolveOptionalStringFlag("project-profile", flags["project-profile"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
    });
    outputState.resolvedProjectRef = init.projectRoot;
    outputState.resolvedRuntimeRoot = init.runtimeRoot;
    outputState.runtimeLayout = init.runtimeLayout;
    outputState.runtimeStateFile = init.stateFile;
    outputState.projectProfileRef = init.projectProfileRef;

    const stepClass = resolveOptionalStringFlag("step-class", flags["step-class"]) ?? "implement";
    const runId =
      resolveOptionalStringFlag("run-id", flags["run-id"]) ??
      `${init.projectId}.${command === "deliver prepare" ? "delivery" : "release"}.prepare.v1`;
    const runtimeHarness = materializeRuntimeHarnessReport({
      cwd,
      projectRef: /** @type {string} */ (flags["project-ref"]),
      projectProfile: resolveOptionalStringFlag("project-profile", flags["project-profile"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
      runId,
    });
    outputState.runtimeHarnessReportId = runtimeHarness.report.report_id;
    outputState.runtimeHarnessReportFile = runtimeHarness.reportPath;
    outputState.runtimeHarnessOverallDecision = runtimeHarness.report.overall_decision;
    const runtimeHarnessDeliveryGate = evaluateRuntimeHarnessDeliveryGate({
      report: runtimeHarness.report,
      command,
    });
    outputState.deliveryQualityGateMode = deliveryQualityGateMode;
    outputState.deliveryQualityGateStatus = runtimeHarnessDeliveryGate.status;
    outputState.deliveryQualityGateFindings = runtimeHarnessDeliveryGate.findings;
    if (deliveryQualityGateMode === "strict") {
      assertRuntimeHarnessAllowsDelivery({
        report: runtimeHarness.report,
        command,
      });
    }
    const reviewDecisionRequired = resolveOptionalBooleanFlag(
      "require-review-decision",
      flags["require-review-decision"],
    );
    outputState.reviewDecisionGate = reviewDecisionRequired ? "required" : "not_required";
    if (reviewDecisionRequired) {
      const reviewDecisions = listQualityArtifacts({
        cwd,
        projectRef: /** @type {string} */ (flags["project-ref"]),
        runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
      })
        .filter((artifact) => artifact.family === "review-decision" && artifact.document.run_id === runId)
        .sort((left, right) => {
          const leftMs =
            typeof left.document.decided_at === "string" ? Date.parse(left.document.decided_at) : Number.NEGATIVE_INFINITY;
          const rightMs =
            typeof right.document.decided_at === "string" ? Date.parse(right.document.decided_at) : Number.NEGATIVE_INFINITY;
          const decidedAtDelta = (Number.isFinite(rightMs) ? rightMs : Number.NEGATIVE_INFINITY) -
            (Number.isFinite(leftMs) ? leftMs : Number.NEGATIVE_INFINITY);
          if (decidedAtDelta !== 0) return decidedAtDelta;
          return fs.statSync(right.file).mtimeMs - fs.statSync(left.file).mtimeMs;
        });
      const latestDecision = reviewDecisions[0] ?? null;
      if (!latestDecision) {
        throw new CliUsageError(
          `${command} requires an approved review decision for run '${runId}'. Run 'aor review decide --run-id ${runId} --decision approve' before delivery or release.`,
        );
      }
      const reviewDecision = typeof latestDecision.document.decision === "string" ? latestDecision.document.decision : null;
      const reviewDecisionGate =
        typeof latestDecision.document.delivery_gate === "object" && latestDecision.document.delivery_gate
          ? /** @type {{ status?: unknown, blocks_downstream?: unknown }} */ (latestDecision.document.delivery_gate)
          : {};
      outputState.reviewDecisionId =
        typeof latestDecision.document.decision_id === "string" ? latestDecision.document.decision_id : null;
      outputState.reviewDecisionFile = latestDecision.file;
      outputState.reviewDecision = reviewDecision;
      outputState.reviewDecisionGate =
        typeof reviewDecisionGate.status === "string" ? reviewDecisionGate.status : outputState.reviewDecisionGate;
      outputState.reviewDecisionReason =
        typeof latestDecision.document.reason === "string" ? latestDecision.document.reason : null;
      if (
        reviewDecision !== "approve" ||
        reviewDecisionGate.status !== "pass" ||
        reviewDecisionGate.blocks_downstream === true
      ) {
        throw new CliUsageError(
          `${command} requires review decision 'approve'; latest decision for run '${runId}' is '${reviewDecision ?? "unknown"}'.`,
        );
      }
    }
    const resolvedPolicy = resolveStepPolicyForStep({
      projectProfilePath: init.projectProfilePath,
      routesRoot: path.join(init.projectRoot, "examples/routes"),
      policiesRoot: path.join(init.projectRoot, "examples/policies"),
      stepClass,
      routeOverrides,
      policyOverrides,
    });
    const requestedMode = resolveOptionalStringFlag("mode", flags.mode);
    if (requestedMode) {
      const canonicalMode = normalizeDeliveryMode(requestedMode);
      resolvedPolicy.resolved_bounds.writeback_mode.mode = canonicalMode;
      resolvedPolicy.resolved_bounds.writeback_mode.resolution_source = {
        kind: "step-override",
        field: "--mode",
      };
    }

    const approvedHandoffRef = resolveOptionalStringFlag(
      "approved-handoff-ref",
      flags["approved-handoff-ref"],
    );
    const promotionEvidenceRefs = resolveOptionalCsvFlag(
      "promotion-evidence-refs",
      flags["promotion-evidence-refs"],
    );
    const coordinationEvidenceRefs = resolveOptionalCsvFlag(
      "coordination-evidence-refs",
      flags["coordination-evidence-refs"],
    );
    const coordinationLockEvidenceRefs = resolveOptionalCsvFlag(
      "coordination-lock-evidence-refs",
      flags["coordination-lock-evidence-refs"],
    );
    const crossRepoValidationRefs = resolveOptionalCsvFlag(
      "cross-repo-validation-refs",
      flags["cross-repo-validation-refs"],
    );
    const rerunOfRunId = resolveOptionalStringFlag("rerun-of-run-id", flags["rerun-of-run-id"]);
    const rerunFailedStep = resolveOptionalStringFlag("rerun-failed-step", flags["rerun-failed-step"]);
    const rerunPacketBoundary = resolveOptionalStringFlag(
      "rerun-packet-boundary",
      flags["rerun-packet-boundary"],
    );
    const loadedProjectProfile = loadContractFile({
      filePath: init.projectProfilePath,
      family: "project-profile",
    });
    if (!loadedProjectProfile.ok) {
      const issues = loadedProjectProfile.validation.issues.map((issue) => issue.message).join("; ");
      throw new CliUsageError(`Project profile '${init.projectProfilePath}' failed validation: ${issues}`);
    }
    const coordinationRepos = Array.isArray(loadedProjectProfile.document.repos)
      ? loadedProjectProfile.document.repos
          .filter((repo) => typeof repo === "object" && repo !== null)
          .map((repo) => {
            const repoRecord = /** @type {Record<string, unknown>} */ (repo);
            const sourceRecord =
              typeof repoRecord.source === "object" && repoRecord.source
                ? /** @type {Record<string, unknown>} */ (repoRecord.source)
                : {};
            return {
              repo_id: typeof repoRecord.repo_id === "string" ? repoRecord.repo_id : null,
              role: typeof repoRecord.role === "string" ? repoRecord.role : null,
              default_branch: typeof repoRecord.default_branch === "string" ? repoRecord.default_branch : null,
              source_root: typeof sourceRecord.root === "string" ? sourceRecord.root : null,
              source_kind: typeof sourceRecord.kind === "string" ? sourceRecord.kind : null,
            };
          })
          .filter((repo) => typeof repo.repo_id === "string")
      : [];
    const planResult = materializeDeliveryPlan({
      runtimeLayout: init.runtimeLayout,
      projectId: init.projectId,
      runId,
      stepClass,
      policyResolution: resolvedPolicy,
      handoffApproval: approvedHandoffRef
        ? {
            status: "pass",
            ref: approvedHandoffRef,
          }
        : {
          status: "missing",
          ref: null,
        },
      promotionEvidenceRefs,
      coordinationRepos,
      coordinationEvidenceRefs,
      coordinationLockEvidenceRefs,
      crossRepoValidationRefs,
      rerunOfRunRef: rerunOfRunId ? toRunRef(rerunOfRunId) : undefined,
      rerunFailedStepRef: rerunFailedStep ?? undefined,
      rerunPacketBoundary: rerunPacketBoundary ?? undefined,
    });

    outputState.deliveryPlanId =
      typeof planResult.deliveryPlan.plan_id === "string" ? planResult.deliveryPlan.plan_id : null;
    outputState.deliveryPlanFile = planResult.deliveryPlanFile;
    outputState.deliveryPlanStatus =
      typeof planResult.deliveryPlan.status === "string" ? planResult.deliveryPlan.status : null;
    outputState.deliveryMode =
      typeof planResult.deliveryPlan.delivery_mode === "string" ? planResult.deliveryPlan.delivery_mode : null;
    outputState.deliveryBlocking = outputState.deliveryPlanStatus !== "ready";
    outputState.deliveryBlockingReasons = Array.isArray(planResult.deliveryPlan.blocking_reasons)
      ? planResult.deliveryPlan.blocking_reasons
          .filter((reason) => typeof reason === "string" && reason.trim().length > 0)
          .map((reason) => reason.trim())
      : [];
    if (deliveryQualityGateMode === "observe" && runtimeHarnessDeliveryGate.findings.length > 0) {
      outputState.deliveryBlockingReasons = Array.from(
        new Set([...outputState.deliveryBlockingReasons, ...runtimeHarnessDeliveryGate.findings]),
      );
    }
    outputState.deliveryGovernanceDecision =
      typeof planResult.deliveryPlan.governance === "object" && planResult.deliveryPlan.governance
        ? planResult.deliveryPlan.governance
        : null;
    outputState.deliveryCoordination =
      typeof planResult.deliveryPlan.coordination === "object" && planResult.deliveryPlan.coordination
        ? planResult.deliveryPlan.coordination
        : null;
    outputState.deliveryRerunRecovery =
      typeof planResult.deliveryPlan.rerun_recovery === "object" && planResult.deliveryPlan.rerun_recovery
        ? planResult.deliveryPlan.rerun_recovery
        : null;

    if (command === "release prepare" && outputState.deliveryPlanStatus !== "ready") {
      const reasons = outputState.deliveryBlockingReasons.length > 0
        ? outputState.deliveryBlockingReasons.join(", ")
        : "delivery-plan-blocked";
      throw new CliUsageError(`Release preconditions failed: ${reasons}.`);
    }

    const deliveryResult = runDeliveryDriver({
      projectRef: init.projectRoot,
      cwd,
      runtimeRoot: init.runtimeRoot,
      runId,
      stepId: command === "deliver prepare" ? "deliver.prepare" : "release.prepare",
      mode: outputState.deliveryMode ?? undefined,
      branchName: resolveOptionalStringFlag("branch-name", flags["branch-name"]),
      commitMessage: resolveOptionalStringFlag("commit-message", flags["commit-message"]),
      forkOwner: resolveOptionalStringFlag("fork-owner", flags["fork-owner"]),
      forkRemoteUrl: resolveOptionalStringFlag("fork-remote-url", flags["fork-remote-url"]),
      baseRef: resolveOptionalStringFlag("base-ref", flags["base-ref"]),
      prTitle: resolveOptionalStringFlag("pr-title", flags["pr-title"]),
      prBody: resolveOptionalStringFlag("pr-body", flags["pr-body"]),
      enableNetworkWrite: resolveOptionalBooleanFlag("network-write", flags["network-write"]),
      ticketId: resolveOptionalStringFlag("ticket-id", flags["ticket-id"]),
      deliveryPlanPath: planResult.deliveryPlanFile,
    });

    outputState.deliveryBlocking = deliveryResult.blocking;
    outputState.deliveryTranscriptFile = deliveryResult.transcriptFile;
    outputState.deliveryManifestId =
      typeof deliveryResult.deliveryManifest.manifest_id === "string"
        ? deliveryResult.deliveryManifest.manifest_id
        : null;
    outputState.deliveryManifestFile = deliveryResult.deliveryManifestFile;
    outputState.releasePacketId =
      typeof deliveryResult.releasePacket.packet_id === "string" ? deliveryResult.releasePacket.packet_id : null;
    outputState.releasePacketFile = deliveryResult.releasePacketFile;
    outputState.releasePacketStatus =
      typeof deliveryResult.releasePacket.status === "string" ? deliveryResult.releasePacket.status : null;
    const repoDeliveries = Array.isArray(deliveryResult.deliveryManifest.repo_deliveries)
      ? deliveryResult.deliveryManifest.repo_deliveries
      : [];
    const firstRepoDelivery = repoDeliveries.length > 0 && typeof repoDeliveries[0] === "object" ? repoDeliveries[0] : null;
    if (firstRepoDelivery && typeof firstRepoDelivery.writeback_result === "string") {
      outputState.deliveryWritebackResult = firstRepoDelivery.writeback_result;
    }
    outputState.deliveryCoordination =
      typeof deliveryResult.deliveryManifest.coordination === "object" && deliveryResult.deliveryManifest.coordination
        ? deliveryResult.deliveryManifest.coordination
        : outputState.deliveryCoordination;
    outputState.deliveryRerunRecovery =
      typeof deliveryResult.deliveryManifest.rerun_recovery === "object" && deliveryResult.deliveryManifest.rerun_recovery
        ? deliveryResult.deliveryManifest.rerun_recovery
        : outputState.deliveryRerunRecovery;
    outputState.readOnly = false;
    outputState.futureControlHooks = [
      "packet show --family delivery-manifest",
      "packet show --family release-packet",
      `evidence show --run-id ${runId}`,
    ];
  } else {
    return false;
  }
  return true;
}
