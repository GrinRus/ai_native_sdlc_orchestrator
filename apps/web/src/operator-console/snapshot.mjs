import {
  listDeliveryManifests,
  listPacketArtifacts,
  listPromotionDecisions,
  listQualityArtifacts,
  readNextActionReport,
  readFinanceMonitoringSnapshot,
  readRunEventHistory,
  readRunPolicyHistory,
  listRuns,
  listStepResults,
  readStrategicSnapshot,
  readUiLifecycleState,
  readProjectState,
} from "../../../api/src/index.mjs";
import { LIFECYCLE_COMMANDS, asArray, asRecord, asString } from "./shared.mjs";
import { readControlPlaneJson, resolveControlPlaneUrl } from "./transport.mjs";
import {
  collectRunnerInteractions,
  collectRuntimePermissionDecisions,
  filterArtifactsByRunId,
  filterPacketsByRunId,
  filterStepResultsByLinkedRunId,
  listLinkedSiblingStepResults,
  selectRunId,
  uniqueArtifactEntries,
} from "./read-model.mjs";
import { withGuidedLifecycle } from "./guided-lifecycle.mjs";

/**
 * @param {{
 *   cwd?: string,
 *   projectRef: string,
 *   runtimeRoot?: string,
 *   runId?: string,
 *   controlPlane?: string,
 *   controlPlaneAuthToken?: string,
 *   readOnly?: boolean,
 * }} options
 */
export async function buildOperatorConsoleSnapshot(options) {
  const uiLifecycle = readUiLifecycleState(options);
  const requestedControlPlane = asString(options.controlPlane);
  const controlPlaneAuthToken = asString(options.controlPlaneAuthToken) ?? undefined;
  const connectedControlPlane = resolveControlPlaneUrl({
    requestedControlPlane,
    uiLifecycleState: uiLifecycle.state,
  });
  const strategicSnapshot = readStrategicSnapshot(options);
  const financeMonitoring = readFinanceMonitoringSnapshot(options);

  if (!connectedControlPlane) {
    const state = readProjectState(options);
    const runs = listRuns(options).sort((left, right) => left.run_id.localeCompare(right.run_id));
    const packets = listPacketArtifacts(options);
    const stepResults = listStepResults(options);
    const qualityArtifacts = listQualityArtifacts(options);
    const deliveryManifests = listDeliveryManifests(options);
    const promotionDecisions = listPromotionDecisions(options);
    const nextActionReport = readNextActionReport(options);
    const selectedRunId = selectRunId(runs, options.runId);
    const selectedRunEventHistory = selectedRunId
      ? readRunEventHistory({
          ...options,
          runId: selectedRunId,
          limit: 50,
        })
      : null;
    const selectedRunPolicyHistory = selectedRunId
      ? readRunPolicyHistory({
          ...options,
          runId: selectedRunId,
          limit: 100,
        })
      : null;

    const linkedSiblingStepResults = listLinkedSiblingStepResults(state, selectedRunId);
    const visibleStepResults = uniqueArtifactEntries([...stepResults, ...linkedSiblingStepResults]);
    const selectedStepResults = filterArtifactsByRunId(visibleStepResults, selectedRunId);
    const selectedLinkedStepResults = filterStepResultsByLinkedRunId(visibleStepResults, selectedRunId);
    return withGuidedLifecycle({
      project: state,
      ui_lifecycle: uiLifecycle.state,
      ui_lifecycle_state_file: uiLifecycle.stateFile,
      runs,
      selected_run_id: selectedRunId,
      packet_artifacts: packets,
      step_results: visibleStepResults,
      quality_artifacts: qualityArtifacts,
      delivery_manifests: deliveryManifests,
      promotion_decisions: promotionDecisions,
      next_action_report: nextActionReport,
      strategic_snapshot: strategicSnapshot,
      finance_monitoring: financeMonitoring,
      run_detail: {
        packet_artifacts: filterPacketsByRunId(packets, selectedRunId),
        step_results: selectedStepResults,
        interactions: collectRunnerInteractions(selectedLinkedStepResults),
        runtime_permission_decisions: collectRuntimePermissionDecisions(selectedLinkedStepResults),
        quality_artifacts: filterArtifactsByRunId(qualityArtifacts, selectedRunId),
        delivery_manifests: filterArtifactsByRunId(deliveryManifests, selectedRunId),
        promotion_decisions: filterArtifactsByRunId(promotionDecisions, selectedRunId),
        event_history: selectedRunEventHistory,
        policy_history: selectedRunPolicyHistory,
      },
      api_ui_contract_alignment: {
        binding_mode: "module-in-process",
        control_plane: null,
        read_model: [
          "GET /api/projects/:projectId/state",
          "GET /api/projects/:projectId/runs",
          "GET /api/projects/:projectId/packets",
          "GET /api/projects/:projectId/step-results",
          "GET /api/projects/:projectId/quality-artifacts",
          "GET /api/projects/:projectId/delivery-manifests",
          "GET /api/projects/:projectId/promotion-decisions",
          "GET /api/projects/:projectId/strategic-snapshot",
          "GET /api/projects/:projectId/planner-metrics",
          "GET /api/projects/:projectId/finance-monitoring",
          "GET /api/projects/:projectId/next-action-report",
          "GET /api/projects/:projectId/runs/:runId/events/history",
          "GET /api/projects/:projectId/runs/:runId/policy-history",
        ],
        mutation_model: [
          "MODULE run-control.apply (start|pause|resume|steer|cancel)",
          "MODULE ui-lifecycle.attach",
          "MODULE ui-lifecycle.detach",
          "MODULE lifecycle-command.apply",
          "MODULE interaction-answer.submit",
        ],
        lifecycle_commands: LIFECYCLE_COMMANDS,
        mutation_error_shapes: ["run_control.blocked", "lifecycle_command.blocked", "interaction.continuation_blocked", "invalid_payload"],
        live_stream: "GET /api/projects/:projectId/runs/:runId/events",
        event_contract_family: "live-run-event",
      },
    }, { readOnly: options.readOnly === true });
  }

  const projectState = readProjectState(options);
  const projectId = projectState.project_id;

  const [state, runsRaw, packetsRaw, stepResultsRaw, qualityRaw, deliveryRaw, promotionRaw, strategicRaw, financeRaw, nextActionRaw] =
    await Promise.all([
      readControlPlaneJson({
        controlPlane: connectedControlPlane,
        pathname: `/api/projects/${encodeURIComponent(projectId)}/state`,
        authToken: controlPlaneAuthToken,
      }),
      readControlPlaneJson({
        controlPlane: connectedControlPlane,
        pathname: `/api/projects/${encodeURIComponent(projectId)}/runs`,
        authToken: controlPlaneAuthToken,
      }),
      readControlPlaneJson({
        controlPlane: connectedControlPlane,
        pathname: `/api/projects/${encodeURIComponent(projectId)}/packets`,
        authToken: controlPlaneAuthToken,
      }),
      readControlPlaneJson({
        controlPlane: connectedControlPlane,
        pathname: `/api/projects/${encodeURIComponent(projectId)}/step-results`,
        authToken: controlPlaneAuthToken,
      }),
      readControlPlaneJson({
        controlPlane: connectedControlPlane,
        pathname: `/api/projects/${encodeURIComponent(projectId)}/quality-artifacts`,
        authToken: controlPlaneAuthToken,
      }),
      readControlPlaneJson({
        controlPlane: connectedControlPlane,
        pathname: `/api/projects/${encodeURIComponent(projectId)}/delivery-manifests`,
        authToken: controlPlaneAuthToken,
      }),
      readControlPlaneJson({
        controlPlane: connectedControlPlane,
        pathname: `/api/projects/${encodeURIComponent(projectId)}/promotion-decisions`,
        authToken: controlPlaneAuthToken,
      }),
      readControlPlaneJson({
        controlPlane: connectedControlPlane,
        pathname: `/api/projects/${encodeURIComponent(projectId)}/strategic-snapshot`,
        authToken: controlPlaneAuthToken,
      }).catch(() => strategicSnapshot),
      readControlPlaneJson({
        controlPlane: connectedControlPlane,
        pathname: `/api/projects/${encodeURIComponent(projectId)}/finance-monitoring`,
        authToken: controlPlaneAuthToken,
      }).catch(() => readFinanceMonitoringSnapshot(options)),
      readControlPlaneJson({
        controlPlane: connectedControlPlane,
        pathname: `/api/projects/${encodeURIComponent(projectId)}/next-action-report`,
        authToken: controlPlaneAuthToken,
      }).catch(() => readNextActionReport(options)),
    ]);

  const runs = asArray(runsRaw).sort((left, right) => {
    const leftId = asString(asRecord(left).run_id) ?? "";
    const rightId = asString(asRecord(right).run_id) ?? "";
    return leftId.localeCompare(rightId);
  });
  const packets = /** @type {Array<{ family: string, document: Record<string, unknown> }>} */ (asArray(packetsRaw));
  const stepResults = /** @type {Array<{ document: Record<string, unknown> }>} */ (asArray(stepResultsRaw));
  const qualityArtifacts = /** @type {Array<{ document: Record<string, unknown> }>} */ (asArray(qualityRaw));
  const deliveryManifests = /** @type {Array<{ document: Record<string, unknown> }>} */ (asArray(deliveryRaw));
  const promotionDecisions = /** @type {Array<{ document: Record<string, unknown> }>} */ (asArray(promotionRaw));

  const selectedRunId = selectRunId(/** @type {Array<{ run_id: string }>} */ (runs), options.runId);
  const [selectedRunEventHistory, selectedRunPolicyHistory] = selectedRunId
    ? await Promise.all([
        readControlPlaneJson({
          controlPlane: connectedControlPlane,
          pathname: `/api/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(selectedRunId)}/events/history`,
          query: { limit: 50 },
          authToken: controlPlaneAuthToken,
        }),
        readControlPlaneJson({
          controlPlane: connectedControlPlane,
          pathname: `/api/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(selectedRunId)}/policy-history`,
          query: { limit: 100 },
          authToken: controlPlaneAuthToken,
        }),
      ])
    : [null, null];

  const linkedSiblingStepResults = listLinkedSiblingStepResults(asRecord(state), selectedRunId);
  const visibleStepResults = uniqueArtifactEntries([...stepResults, ...linkedSiblingStepResults]);
  const selectedStepResults = filterArtifactsByRunId(visibleStepResults, selectedRunId);
  const selectedLinkedStepResults = filterStepResultsByLinkedRunId(visibleStepResults, selectedRunId);
  return withGuidedLifecycle({
    project: state,
    ui_lifecycle: uiLifecycle.state,
    ui_lifecycle_state_file: uiLifecycle.stateFile,
    runs,
    selected_run_id: selectedRunId,
    packet_artifacts: packets,
    step_results: visibleStepResults,
    quality_artifacts: qualityArtifacts,
    delivery_manifests: deliveryManifests,
    promotion_decisions: promotionDecisions,
    next_action_report: nextActionRaw,
    strategic_snapshot: strategicRaw,
    finance_monitoring: financeRaw,
    run_detail: {
      packet_artifacts: filterPacketsByRunId(packets, selectedRunId),
      step_results: selectedStepResults,
      interactions: collectRunnerInteractions(selectedLinkedStepResults),
      runtime_permission_decisions: collectRuntimePermissionDecisions(selectedLinkedStepResults),
      quality_artifacts: filterArtifactsByRunId(qualityArtifacts, selectedRunId),
      delivery_manifests: filterArtifactsByRunId(deliveryManifests, selectedRunId),
      promotion_decisions: filterArtifactsByRunId(promotionDecisions, selectedRunId),
      event_history: selectedRunEventHistory,
      policy_history: selectedRunPolicyHistory,
    },
    api_ui_contract_alignment: {
      binding_mode: "detached-http-sse",
      control_plane: connectedControlPlane,
      read_model: [
        "GET /api/projects/:projectId/state",
        "GET /api/projects/:projectId/runs",
        "GET /api/projects/:projectId/packets",
        "GET /api/projects/:projectId/step-results",
        "GET /api/projects/:projectId/quality-artifacts",
        "GET /api/projects/:projectId/delivery-manifests",
        "GET /api/projects/:projectId/promotion-decisions",
        "GET /api/projects/:projectId/strategic-snapshot",
        "GET /api/projects/:projectId/planner-metrics",
        "GET /api/projects/:projectId/finance-monitoring",
        "GET /api/projects/:projectId/next-action-report",
        "GET /api/projects/:projectId/runs/:runId/events/history",
        "GET /api/projects/:projectId/runs/:runId/policy-history",
      ],
      mutation_model: [
        "POST /api/projects/:projectId/run-control/actions",
        "POST /api/projects/:projectId/ui-lifecycle/actions",
        "POST /api/projects/:projectId/lifecycle-command/actions",
        "POST /api/projects/:projectId/interactions/answers",
      ],
      lifecycle_commands: LIFECYCLE_COMMANDS,
      mutation_error_shapes: [
        "invalid_json",
        "invalid_payload",
        "invalid_run_control_action",
        "invalid_lifecycle_command",
        "run_control.blocked",
        "lifecycle_command.blocked",
        "interaction.continuation_blocked",
      ],
      auth_mode: "optional-bearer-token",
      live_stream: "GET /api/projects/:projectId/runs/:runId/events",
      event_contract_family: "live-run-event",
    },
  }, { readOnly: options.readOnly === true });
}
