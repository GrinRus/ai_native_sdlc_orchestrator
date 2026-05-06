import { readQueryInteger, sendJson } from "./http-utils.mjs";
import {
  listDeliveryManifests,
  listMultirepoCoordinationStatuses,
  listPacketArtifacts,
  listPromotionDecisions,
  listQualityArtifacts,
  listRuns,
  listStepResults,
  readPlannerMetrics,
  readProjectState,
  readRunEventHistory,
  readRunPolicyHistory,
  readStrategicSnapshot,
} from "./read-surface.mjs";

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
      sendJson(response, 200, listPacketArtifacts(runtimeOptions));
      return;
    case "step-results":
      sendJson(response, 200, listStepResults(runtimeOptions));
      return;
    case "quality-artifacts":
      sendJson(response, 200, listQualityArtifacts(runtimeOptions));
      return;
    case "delivery-manifests":
      sendJson(response, 200, listDeliveryManifests(runtimeOptions));
      return;
    case "promotion-decisions":
      sendJson(response, 200, listPromotionDecisions(runtimeOptions));
      return;
    case "strategic-snapshot":
      sendJson(response, 200, readStrategicSnapshot(runtimeOptions));
      return;
    case "planner-metrics":
      sendJson(response, 200, readPlannerMetrics(runtimeOptions));
      return;
    case "multirepo-coordination":
      sendJson(response, 200, listMultirepoCoordinationStatuses(runtimeOptions));
      return;
    case "runs":
      sendJson(response, 200, listRuns(runtimeOptions));
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
