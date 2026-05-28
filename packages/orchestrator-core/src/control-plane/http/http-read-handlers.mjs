import { readQueryInteger, sendError, sendJson } from "./http-utils.mjs";
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
  readFlowProjection,
  readNextActionReport,
  listStepResults,
  readPlannerMetrics,
  readProjectState,
  readRunEventHistory,
  readRunPolicyHistory,
  readSelectedFlowProjection,
  readStrategicSnapshot,
} from "../read-surface.mjs";

const DEFAULT_READ_MODEL_LIMIT = 200;
const MAX_READ_MODEL_LIMIT = 1000;

/**
 * @param {URLSearchParams} searchParams
 * @param {number} defaultLimit
 * @returns {number}
 */
function resolveReadModelLimit(searchParams, defaultLimit = DEFAULT_READ_MODEL_LIMIT) {
  const requestedLimit = readQueryInteger(searchParams, "limit");
  const limit = typeof requestedLimit === "number" ? requestedLimit : defaultLimit;
  return Math.min(limit, MAX_READ_MODEL_LIMIT);
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
