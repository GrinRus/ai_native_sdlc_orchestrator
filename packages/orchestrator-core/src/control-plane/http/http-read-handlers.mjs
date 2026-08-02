import { readQueryInteger, sendError, sendJson } from "./http-utils.mjs";
import { CONTROL_PLANE_LIMITS, resolveBoundedInteger } from "../control-plane-limits.mjs";
import { getTaskPlanStatus, showTaskPlan } from "../../task-plan-service.mjs";
import {
  listCompilerRevisionStatuses,
  listDeliveryManifests,
  listFlowProjections,
  listMultirepoCoordinationStatuses,
  listOperatorRequests,
  listPacketArtifacts,
  listPromotionDecisions,
  listQualityArtifacts,
  listRuns,
  readFinanceMonitoringSnapshot,
  readFlowEvidenceGraph,
  readFlowProjection,
  readFlowRuntimeTrace,
  readAttentionProjection,
  readNextActionReport,
  listStepResults,
  readPlannerMetrics,
  readProjectState,
  readRunEventHistory,
  readRunPolicyHistory,
  readSelectedFlowProjection,
  readStrategicSnapshot,
} from "../read-surface.mjs";

/**
 * @param {URLSearchParams} searchParams
 * @param {number} defaultLimit
 * @returns {number}
 */
function resolveReadModelLimit(searchParams, defaultLimit = CONTROL_PLANE_LIMITS.list.default) {
  const requestedLimit = readQueryInteger(searchParams, "limit");
  return resolveBoundedInteger(requestedLimit, { ...CONTROL_PLANE_LIMITS.list, default: defaultLimit });
}

/**
 * @param {{ cwd?: string, projectRef: string, runtimeRoot?: string, redactionPolicy?: unknown }} runtimeOptions
 * @param {URLSearchParams} searchParams
 */
function withReadModelLimit(runtimeOptions, searchParams) {
  return {
    ...runtimeOptions,
    limit: resolveReadModelLimit(searchParams),
  };
}

/**
 * @param {{
 *   routeId: string,
 *   params: Record<string, string>,
 *   requestUrl: URL,
 *   response: import("node:http").ServerResponse,
 *   runtimeOptions: { cwd?: string, projectRef: string, runtimeRoot?: string, redactionPolicy?: unknown },
 * }} options
 */
export function handleReadRoute({ routeId, params, requestUrl, response, runtimeOptions }) {
  switch (routeId) {
    case "project-state":
      sendJson(response, 200, readProjectState(runtimeOptions));
      return;
    case "packets":
      sendJson(response, 200, listPacketArtifacts(withReadModelLimit(runtimeOptions, requestUrl.searchParams)));
      return;
    case "step-results":
      sendJson(response, 200, listStepResults(withReadModelLimit(runtimeOptions, requestUrl.searchParams)));
      return;
    case "quality-artifacts":
      sendJson(response, 200, listQualityArtifacts(withReadModelLimit(runtimeOptions, requestUrl.searchParams)));
      return;
    case "delivery-manifests":
      sendJson(response, 200, listDeliveryManifests(withReadModelLimit(runtimeOptions, requestUrl.searchParams)));
      return;
    case "promotion-decisions":
      sendJson(response, 200, listPromotionDecisions(withReadModelLimit(runtimeOptions, requestUrl.searchParams)));
      return;
    case "strategic-snapshot":
      sendJson(response, 200, readStrategicSnapshot(withReadModelLimit(runtimeOptions, requestUrl.searchParams)));
      return;
    case "planner-metrics":
      sendJson(response, 200, readPlannerMetrics(withReadModelLimit(runtimeOptions, requestUrl.searchParams)));
      return;
    case "finance-monitoring":
      sendJson(response, 200, readFinanceMonitoringSnapshot(withReadModelLimit(runtimeOptions, requestUrl.searchParams)));
      return;
    case "next-action-report":
      sendJson(response, 200, readNextActionReport(withReadModelLimit(runtimeOptions, requestUrl.searchParams)));
      return;
    case "flows":
      sendJson(response, 200, listFlowProjections(withReadModelLimit(runtimeOptions, requestUrl.searchParams)));
      return;
    case "selected-flow":
      sendJson(response, 200, readSelectedFlowProjection(runtimeOptions));
      return;
    case "flow-evidence-graph": {
      const graph = readFlowEvidenceGraph({
        ...withReadModelLimit(runtimeOptions, requestUrl.searchParams),
        flowId: params.flowId,
      });
      if (!graph) {
        sendError(response, 404, "flow.not_found", `Flow '${params.flowId}' was not found.`);
        return;
      }
      sendJson(response, 200, graph);
      return;
    }
    case "flow-runtime-trace": {
      const trace = readFlowRuntimeTrace({
        ...withReadModelLimit(runtimeOptions, requestUrl.searchParams),
        flowId: params.flowId,
      });
      if (!trace) {
        sendError(response, 404, "flow.not_found", `Flow '${params.flowId}' was not found.`);
        return;
      }
      sendJson(response, 200, trace);
      return;
    }
    case "flow-attention": {
      const attention = readAttentionProjection({
        ...withReadModelLimit(runtimeOptions, requestUrl.searchParams),
        flowId: params.flowId,
      });
      if (!attention) {
        sendError(response, 404, "flow.not_found", `Flow '${params.flowId}' was not found.`);
        return;
      }
      sendJson(response, 200, attention);
      return;
    }
    case "flow-plan":
    case "flow-plan-progress": {
      const flow = readFlowProjection({ ...runtimeOptions, flowId: params.flowId });
      if (!flow) {
        sendError(response, 404, "flow.not_found", `Flow '${params.flowId}' was not found.`);
        return;
      }
      try {
        const result = routeId === "flow-plan"
          ? showTaskPlan({ ...runtimeOptions, flowId: params.flowId, planRef: requestUrl.searchParams.get("plan_ref") ?? undefined })
          : getTaskPlanStatus({ ...runtimeOptions, flowId: params.flowId, planRef: requestUrl.searchParams.get("plan_ref") ?? undefined });
        sendJson(response, 200, routeId === "flow-plan"
          ? {
              flow_id: params.flowId,
              plan_ref: result.planRef,
              plan: result.plan,
              handoff_packet: result.handoffPacket,
              read_only: true,
            }
          : {
              flow_id: params.flowId,
              plan_ref: result.planRef,
              plan: result.plan,
              execution_plan: result.executionPlan,
              task_progress: result.taskProgress,
              read_only: true,
            });
      } catch (error) {
        const code = typeof error?.code === "string" ? error.code : "plan-read-failed";
        sendError(response, code === "plan-flow-mismatch" ? 409 : 404, code, error instanceof Error ? error.message : String(error));
      }
      return;
    }
    case "flow-detail": {
      const flow = readFlowProjection({
        ...runtimeOptions,
        flowId: params.flowId,
      });
      if (!flow) {
        sendError(response, 404, "flow.not_found", `Flow '${params.flowId}' was not found.`);
        return;
      }
      sendJson(response, 200, flow);
      return;
    }
    case "operator-requests":
      sendJson(response, 200, listOperatorRequests(withReadModelLimit(runtimeOptions, requestUrl.searchParams)));
      return;
    case "multirepo-coordination":
      sendJson(response, 200, listMultirepoCoordinationStatuses(withReadModelLimit(runtimeOptions, requestUrl.searchParams)));
      return;
    case "compiler-revisions":
      sendJson(response, 200, listCompilerRevisionStatuses(withReadModelLimit(runtimeOptions, requestUrl.searchParams)));
      return;
    case "runs":
      sendJson(response, 200, listRuns(withReadModelLimit(runtimeOptions, requestUrl.searchParams)));
      return;
    case "event-history":
      sendJson(
        response,
        200,
        readRunEventHistory({
          ...runtimeOptions,
          runId: params.runId,
          limit: readQueryInteger(requestUrl.searchParams, "limit"),
        }),
      );
      return;
    case "policy-history":
      sendJson(
        response,
        200,
        readRunPolicyHistory({
          ...runtimeOptions,
          runId: params.runId,
          limit: readQueryInteger(requestUrl.searchParams, "limit"),
        }),
      );
      return;
    default:
      throw new Error(`Unsupported read route '${routeId}'.`);
  }
}
