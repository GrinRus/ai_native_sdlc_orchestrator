import {
  GUIDED_STAGE_DEFINITIONS,
  LIFECYCLE_COMMANDS,
  asArray,
  asNumber,
  asRecord,
  asString,
  asStringArray,
  uniqueStrings,
} from "./shared.mjs";
import { stepResultLinksRun } from "./read-model.mjs";

/**
 * @param {Record<string, unknown> | null | undefined} report
 * @returns {string | null}
 */
function resolveNextActionStageId(report) {
  const stage = asString(asRecord(asRecord(report).project_state).stage);
  if (!stage) return null;
  for (const stageDefinition of GUIDED_STAGE_DEFINITIONS) {
    if (stageDefinition.stage_keys.includes(stage)) {
      return stageDefinition.stage_id;
    }
  }
  return null;
}

/**
 * @param {Record<string, unknown> | null | undefined} report
 * @param {string} stageId
 * @returns {Record<string, unknown>}
 */
function resolveClosureStageState(report, stageId) {
  const closureState = asRecord(asRecord(report).closure_state);
  if (stageId === "review-qa") return asRecord(closureState.review);
  if (stageId === "delivery-release") return asRecord(closureState.delivery);
  if (stageId === "learning") return asRecord(closureState.learning);
  return {};
}

/**
 * @param {Record<string, unknown> | null | undefined} report
 * @returns {Record<string, unknown>}
 */
function buildClosureSafetyGates(report) {
  const closureState = asRecord(asRecord(report).closure_state);
  const review = asRecord(closureState.review);
  const delivery = asRecord(closureState.delivery);
  const learning = asRecord(closureState.learning);
  return {
    run_id: asString(closureState.run_id),
    review_decision: asString(review.decision),
    review_status: asString(review.status),
    delivery_gate_status: asString(review.delivery_gate_status),
    blocks_downstream: review.blocks_downstream === true,
    required_review_evidence_refs: asStringArray(review.required_evidence_refs),
    delivery_status: asString(delivery.status),
    delivery_blocked_reasons: asStringArray(delivery.blocked_reasons),
    release_packet_status: asString(delivery.release_packet_status),
    learning_status: asString(learning.status),
  };
}

/**
 * @param {Record<string, unknown>} primaryAction
 * @returns {string | null}
 */
function resolveMutationCommand(primaryAction) {
  const actionId = asString(primaryAction.action_id);
  if (actionId === "mission-create" || actionId === "complete-mission-intake" || actionId === "repair-mission-intake") {
    return "mission create";
  }
  const lowLevelCommand = asString(primaryAction.low_level_command);
  if (lowLevelCommand && LIFECYCLE_COMMANDS.includes(lowLevelCommand)) {
    return lowLevelCommand;
  }
  return null;
}

/**
 * @param {{
 *   command: string | null,
 *   bindingMode: string,
 *   readOnly: boolean,
 * }} options
 */
export function buildGuidedMutationDescriptor(options) {
  if (options.readOnly) {
    return {
      available: false,
      command: options.command,
      transport: "read-only",
      endpoint: null,
      unavailable_reason: "The console was opened in read-only mode; runtime evidence is still visible.",
    };
  }
  if (!options.command || !LIFECYCLE_COMMANDS.includes(options.command)) {
    return {
      available: false,
      command: options.command,
      transport: "read-only",
      endpoint: null,
      unavailable_reason: "The current next action is an inspection or external command, not a lifecycle mutation.",
    };
  }
  return {
    available: true,
    command: options.command,
    transport: options.bindingMode === "detached-http-sse" ? "control-plane" : "module-runtime",
    endpoint:
      options.bindingMode === "detached-http-sse"
        ? "POST /api/projects/:projectId/lifecycle-command/actions"
        : "MODULE lifecycle-command.apply",
    unavailable_reason: null,
  };
}

/**
 * @param {Array<{ family?: string, artifact_ref?: string, file?: string, document: Record<string, unknown> }>} entries
 * @param {(entry: { family?: string, artifact_ref?: string, file?: string, document: Record<string, unknown> }) => boolean} predicate
 * @returns {string[]}
 */
function evidenceRefsFor(entries, predicate) {
  return uniqueStrings(
    entries
      .filter(predicate)
      .flatMap((entry) => [
        asString(entry.artifact_ref),
        asString(entry.file),
        ...asArray(entry.document.evidence_refs),
        ...asArray(entry.document.verification_refs),
        ...asArray(entry.document.source_refs),
      ]),
  );
}

/**
 * @param {{
 *   stageId: string,
 *   snapshot: Record<string, unknown>,
 *   nextActionReport: Record<string, unknown> | null,
 * }} options
 * @returns {string[]}
 */
function collectGuidedStageEvidence(options) {
  const snapshot = options.snapshot;
  const packets = /** @type {Array<{ family?: string, artifact_ref?: string, file?: string, document: Record<string, unknown> }>} */ (
    asArray(snapshot.packet_artifacts)
  );
  const stepResults = /** @type {Array<{ family?: string, artifact_ref?: string, file?: string, document: Record<string, unknown> }>} */ (
    asArray(snapshot.step_results)
  );
  const qualityArtifacts = /** @type {Array<{ family?: string, artifact_ref?: string, file?: string, document: Record<string, unknown> }>} */ (
    asArray(snapshot.quality_artifacts)
  );
  const deliveryManifests = /** @type {Array<{ family?: string, artifact_ref?: string, file?: string, document: Record<string, unknown> }>} */ (
    asArray(snapshot.delivery_manifests)
  );
  const promotionDecisions = /** @type {Array<{ family?: string, artifact_ref?: string, file?: string, document: Record<string, unknown> }>} */ (
    asArray(snapshot.promotion_decisions)
  );
  const nextActionEvidence = asStringArray(asRecord(options.nextActionReport).evidence_refs);
  const missionState = asRecord(asRecord(options.nextActionReport).mission_state);
  const closureState = asRecord(asRecord(options.nextActionReport).closure_state);
  const reviewClosure = asRecord(closureState.review);
  const deliveryClosure = asRecord(closureState.delivery);
  const learningClosure = asRecord(closureState.learning);
  const closureEvidence = asStringArray(closureState.evidence_chain);

  if (options.stageId === "readiness") {
    return uniqueStrings([
      asString(asRecord(snapshot.project).state_file),
      asString(asRecord(asRecord(options.nextActionReport).project_state).onboarding_report_ref),
      ...nextActionEvidence,
    ]);
  }

  if (options.stageId === "mission") {
    return uniqueStrings([
      asString(missionState.intake_packet_ref),
      asString(missionState.intake_body_ref),
      ...evidenceRefsFor(packets, (entry) => entry.document.packet_type === "intake-request"),
      ...nextActionEvidence,
    ]);
  }

  if (options.stageId === "discovery-spec-plan") {
    return uniqueStrings([
      ...evidenceRefsFor(stepResults, (entry) =>
        ["discovery", "spec", "planner", "planning"].includes(asString(entry.document.step_class) ?? ""),
      ),
      ...nextActionEvidence,
    ]);
  }

  if (options.stageId === "execution") {
    return uniqueStrings([
      ...evidenceRefsFor(stepResults, (entry) => stepResultLinksRun(entry.document, asString(snapshot.selected_run_id))),
      ...asArray(asRecord(asRecord(snapshot.run_detail).event_history).events).map((event) => asString(asRecord(event).event_id)),
      ...nextActionEvidence,
    ]);
  }

  if (options.stageId === "review-qa") {
    return uniqueStrings([
      asString(reviewClosure.review_report_ref),
      asString(reviewClosure.runtime_harness_report_ref),
      asString(reviewClosure.decision_ref),
      ...asStringArray(reviewClosure.required_evidence_refs),
      ...evidenceRefsFor(qualityArtifacts, (entry) =>
        ["review-report", "review-decision", "runtime-harness-report", "evaluation-report", "validation-report"].includes(
          asString(entry.family) ?? "",
        ),
      ),
      ...closureEvidence,
      ...nextActionEvidence,
    ]);
  }

  if (options.stageId === "delivery-release") {
    return uniqueStrings([
      asString(deliveryClosure.delivery_plan_ref),
      asString(deliveryClosure.delivery_manifest_ref),
      asString(deliveryClosure.release_packet_ref),
      ...evidenceRefsFor(packets, (entry) =>
        ["delivery-plan", "delivery-manifest", "release-packet"].includes(asString(entry.family) ?? ""),
      ),
      ...evidenceRefsFor(deliveryManifests, () => true),
      ...closureEvidence,
      ...nextActionEvidence,
    ]);
  }

  if (options.stageId === "learning") {
    return uniqueStrings([
      asString(learningClosure.scorecard_ref),
      asString(learningClosure.handoff_ref),
      ...asStringArray(learningClosure.linked_evidence_refs),
      ...evidenceRefsFor(qualityArtifacts, (entry) =>
        ["learning-loop-scorecard", "learning-loop-handoff", "incident-report", "incident-backfill-proposal"].includes(
          asString(entry.family) ?? "",
        ),
      ),
      ...evidenceRefsFor(promotionDecisions, () => true),
      ...closureEvidence,
      ...nextActionEvidence,
    ]);
  }

  return nextActionEvidence;
}

/**
 * @param {{
 *   stageId: string,
 *   snapshot: Record<string, unknown>,
 *   nextActionReport: Record<string, unknown> | null,
 * }} options
 * @returns {boolean}
 */
function isGuidedStageDone(options) {
  const snapshot = options.snapshot;
  const packets = /** @type {Array<{ family?: string, document: Record<string, unknown> }>} */ (asArray(snapshot.packet_artifacts));
  const stepResults = /** @type {Array<{ family?: string, document: Record<string, unknown> }>} */ (asArray(snapshot.step_results));
  const qualityArtifacts = /** @type {Array<{ family?: string, document: Record<string, unknown> }>} */ (asArray(snapshot.quality_artifacts));
  const deliveryManifests = /** @type {Array<{ family?: string, document: Record<string, unknown> }>} */ (
    asArray(snapshot.delivery_manifests)
  );
  const nextReport = asRecord(options.nextActionReport);
  const closureState = asRecord(nextReport.closure_state);
  const reviewClosure = asRecord(closureState.review);
  const deliveryClosure = asRecord(closureState.delivery);
  const learningClosure = asRecord(closureState.learning);

  if (options.stageId === "readiness") {
    return asString(asRecord(nextReport.project_state).onboarding_report_ref) !== null || asString(asRecord(snapshot.project).state_file) !== null;
  }
  if (options.stageId === "mission") {
    const missionState = asRecord(nextReport.mission_state);
    return (
      asString(missionState.completeness_status) === "complete" ||
      packets.some((entry) => entry.document.packet_type === "intake-request")
    );
  }
  if (options.stageId === "discovery-spec-plan") {
    return stepResults.some((entry) =>
      ["discovery", "spec", "planner", "planning"].includes(asString(entry.document.step_class) ?? ""),
    );
  }
  if (options.stageId === "execution") {
    return stepResults.some((entry) => stepResultLinksRun(entry.document, asString(snapshot.selected_run_id)));
  }
  if (options.stageId === "review-qa") {
    return (
      asString(reviewClosure.status) === "approved" ||
      asString(reviewClosure.status) === "held" ||
      asString(reviewClosure.status) === "repair-requested" ||
      qualityArtifacts.some((entry) =>
        ["review-report", "review-decision", "runtime-harness-report", "evaluation-report"].includes(asString(entry.family) ?? ""),
      )
    );
  }
  if (options.stageId === "delivery-release") {
    return (
      ["delivery-plan-ready", "delivery-prepared", "release-ready"].includes(asString(deliveryClosure.status) ?? "") ||
      deliveryManifests.length > 0 ||
      packets.some((entry) => ["delivery-plan", "delivery-manifest", "release-packet"].includes(asString(entry.family) ?? ""))
    );
  }
  if (options.stageId === "learning") {
    return (
      asString(learningClosure.status) === "handoff-complete" ||
      qualityArtifacts.some((entry) =>
        ["learning-loop-scorecard", "learning-loop-handoff"].includes(asString(entry.family) ?? ""),
      )
    );
  }
  return false;
}

/**
 * @param {{
 *   snapshot: Record<string, unknown>,
 *   readOnly?: boolean,
 * }} options
 */
export function buildGuidedLifecycle(options) {
  const snapshot = options.snapshot;
  const nextActionEntry = asRecord(snapshot.next_action_report);
  const nextActionReport = Object.keys(nextActionEntry).length > 0 ? asRecord(nextActionEntry.document) : null;
  const primaryAction = asRecord(asRecord(nextActionReport).primary_action);
  const activeStageId = resolveNextActionStageId(nextActionReport) ?? "mission";
  const bindingMode = asString(asRecord(snapshot.api_ui_contract_alignment).binding_mode) ?? "module-in-process";
  const readOnly = options.readOnly === true;
  const selectedRunId = asString(snapshot.selected_run_id);
  const eventHistory = asRecord(asRecord(snapshot.run_detail).event_history);
  const policyHistory = asRecord(asRecord(snapshot.run_detail).policy_history);
  const nextActionStatus = asString(asRecord(nextActionReport).status);
  const mutationCommand = Object.keys(primaryAction).length > 0 ? resolveMutationCommand(primaryAction) : "next";
  const currentNextAction =
    Object.keys(primaryAction).length > 0
      ? {
          action_id: asString(primaryAction.action_id) ?? "unknown",
          command: asString(primaryAction.command) ?? "aor next",
          reason: asString(primaryAction.reason) ?? "Inspect the durable next-action report.",
          low_level_command: asString(primaryAction.low_level_command) ?? mutationCommand,
          evidence_refs: asStringArray(primaryAction.evidence_refs),
          mutation: buildGuidedMutationDescriptor({
            command: mutationCommand,
            bindingMode,
            readOnly,
          }),
        }
      : {
          action_id: "refresh-next-action",
          command: `aor next --project-ref ${String(asRecord(snapshot.project).project_root ?? ".")}`,
          reason: "No durable next-action-report is available for the console snapshot.",
          low_level_command: "next",
          evidence_refs: uniqueStrings([asString(asRecord(snapshot.project).state_file)]),
          mutation: buildGuidedMutationDescriptor({
            command: "next",
            bindingMode,
            readOnly,
          }),
        };

  const stages = GUIDED_STAGE_DEFINITIONS.map((stageDefinition) => {
    const done = isGuidedStageDone({
      stageId: stageDefinition.stage_id,
      snapshot,
      nextActionReport,
    });
    const current = stageDefinition.stage_id === activeStageId;
    const status = current
      ? nextActionStatus === "blocked"
        ? "blocked"
        : stageDefinition.stage_id === "execution" && selectedRunId
          ? "active"
          : "ready"
      : done
        ? "done"
        : "pending";
    const blockers = current ? asArray(asRecord(nextActionReport).blockers) : [];
    const stageNextAction = current
      ? currentNextAction
      : {
          action_id: status === "done" ? `inspect-${stageDefinition.stage_id}` : `wait-for-${stageDefinition.stage_id}`,
          command:
            status === "done"
              ? `Inspect ${stageDefinition.label.toLowerCase()} evidence in the console.`
              : "Complete the current guided stage first.",
          reason:
            status === "done"
              ? "Stage evidence already exists in durable runtime artifacts."
              : "Guided lifecycle order is derived from the current next-action report.",
          low_level_command: stageDefinition.default_command,
          evidence_refs: [],
          mutation: buildGuidedMutationDescriptor({
            command: null,
            bindingMode,
            readOnly: true,
          }),
        };

    return {
      stage_id: stageDefinition.stage_id,
      label: stageDefinition.label,
      status,
      closure_state: resolveClosureStageState(nextActionReport, stageDefinition.stage_id),
      safety_gates: buildClosureSafetyGates(nextActionReport),
      evidence_refs: collectGuidedStageEvidence({
        stageId: stageDefinition.stage_id,
        snapshot,
        nextActionReport,
      }),
      blockers,
      policy_state: {
        selected_run_id: selectedRunId,
        policy_history_entries: asNumber(policyHistory.entry_count) ?? asArray(policyHistory.entries).length,
      },
      logs_events: {
        selected_run_id: selectedRunId,
        event_history_entries: asNumber(eventHistory.total_events) ?? asArray(eventHistory.events).length,
        live_stream: asString(asRecord(snapshot.api_ui_contract_alignment).live_stream),
      },
      next_action: stageNextAction,
    };
  });

  const blocked = stages.some((stage) => stage.status === "blocked");
  const connectionState = asString(asRecord(snapshot.ui_lifecycle).connection_state) ?? "detached";

  return {
    stage_model_version: 1,
    current_stage_id: activeStageId,
    state: readOnly ? "read_only" : blocked ? "blocked" : connectionState,
    read_only: readOnly,
    mutation_transport: {
      binding_mode: bindingMode,
      available: !readOnly,
      lifecycle_endpoint:
        bindingMode === "detached-http-sse"
          ? "POST /api/projects/:projectId/lifecycle-command/actions"
          : "MODULE lifecycle-command.apply",
      headless_safe: asRecord(snapshot.ui_lifecycle).headless_safe === true,
    },
    next_action_report_ref: asString(nextActionEntry.artifact_ref) ?? asString(nextActionEntry.file),
    closure_state: asRecord(asRecord(nextActionReport).closure_state),
    stages,
  };
}

/**
 * @param {Record<string, unknown>} snapshot
 * @param {{ readOnly?: boolean }} options
 */
export function withGuidedLifecycle(snapshot, options = {}) {
  return {
    ...snapshot,
    guided_lifecycle: buildGuidedLifecycle({
      snapshot,
      readOnly: options.readOnly,
    }),
  };
}
