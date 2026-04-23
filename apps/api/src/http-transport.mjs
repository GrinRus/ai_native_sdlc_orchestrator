import http from "node:http";

import { openRunEventStream } from "./live-event-stream.mjs";
import { applyRunControlAction } from "./run-control.mjs";
import {
  listDeliveryManifests,
  listPacketArtifacts,
  listPromotionDecisions,
  listQualityArtifacts,
  listRuns,
  listStepResults,
  readProjectState,
  readRunEventHistory,
  readRunPolicyHistory,
  readStrategicSnapshot,
} from "./read-surface.mjs";
import { attachUiLifecycle, detachUiLifecycle } from "./ui-lifecycle.mjs";

const JSON_HEADERS = Object.freeze({
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
});
const RUN_CONTROL_ACTIONS = new Set(["start", "pause", "resume", "steer", "cancel"]);
const UI_LIFECYCLE_ACTIONS = new Set(["attach", "detach"]);

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function asString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function asPositiveInteger(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const normalized = Math.floor(parsed);
  return normalized >= 0 ? normalized : null;
}

/**
 * @param {http.ServerResponse} response
 * @param {number} statusCode
 * @param {Record<string, unknown> | Array<unknown>} payload
 */
function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, JSON_HEADERS);
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
}

/**
 * @param {http.ServerResponse} response
 * @param {number} statusCode
 * @param {string} code
 * @param {string} message
 */
function sendError(response, statusCode, code, message) {
  sendJson(response, statusCode, {
    error: {
      code,
      message,
    },
  });
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function asRecord(value) {
  return typeof value === "object" && value !== null ? /** @type {Record<string, unknown>} */ (value) : {};
}

/**
 * @param {http.IncomingMessage} request
 * @returns {Promise<Record<string, unknown>>}
 */
async function readJsonRequestBody(request) {
  /** @type {Array<Buffer>} */
  const chunks = [];
  for await (const chunk of request) {
    if (typeof chunk === "string") {
      chunks.push(Buffer.from(chunk));
    } else {
      chunks.push(chunk);
    }
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (raw.length === 0) {
    return {};
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("invalid_json");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("invalid_payload");
  }

  return /** @type {Record<string, unknown>} */ (parsed);
}

/**
 * @param {ReturnType<typeof applyRunControlAction>} result
 * @returns {Record<string, unknown>}
 */
function toRunControlResponse(result) {
  return {
    action: result.action,
    run_id: result.runId,
    blocked: result.blocked,
    blocked_reason: result.blockedReason ?? null,
    applied: result.applied,
    transition: result.transition,
    guardrails: result.guardrails,
    state: result.state,
    state_file: result.stateFile,
    audit_id: result.auditRecord.audit_id,
    audit_file: result.auditFile,
    primary_event_id: result.primaryEvent.event_id,
    evidence_event_id: result.evidenceEvent.event_id,
    stream_log_file: result.streamLogFile,
    next_actions: result.nextActions,
  };
}

/**
 * @param {ReturnType<typeof attachUiLifecycle> | ReturnType<typeof detachUiLifecycle>} result
 * @returns {Record<string, unknown>}
 */
function toUiLifecycleResponse(result) {
  return {
    action: result.action,
    idempotent: result.idempotent,
    connection_state: asString(result.state.connection_state) ?? "detached",
    headless_safe: result.state.headless_safe === true,
    state: result.state,
    state_file: result.stateFile,
  };
}

/**
 * @param {Record<string, unknown>} payload
 * @returns {Record<string, unknown> | null}
 */
function toPolicyContext(payload) {
  const policyContext = asRecord(payload.policy_context);
  if (Object.keys(policyContext).length === 0) {
    return null;
  }
  return {
    action: asString(policyContext.action),
    risk_tier: asString(policyContext.risk_tier),
    high_risk: policyContext.high_risk === true,
    approval_required: policyContext.approval_required === true,
    approval_ref_present: policyContext.approval_ref_present === true,
  };
}

/**
 * @param {Record<string, unknown>} event
 */
function toHistoryEvent(event) {
  const payload = asRecord(event.payload);
  return {
    event_id: asString(event.event_id) ?? "",
    timestamp: asString(event.timestamp),
    event_type: asString(event.event_type) ?? "unknown",
    sequence: asPositiveInteger(payload.sequence),
    summary: asString(payload.summary),
    control_action: asString(payload.control_action),
    step_id: asString(payload.step_id),
    status: asString(payload.status),
    policy_context: toPolicyContext(payload),
  };
}

/**
 * @param {http.ServerResponse} response
 * @param {{
 *   event: string,
 *   id?: string | null,
 *   data: Record<string, unknown>,
 * }} payload
 */
function writeSseEvent(response, payload) {
  if (asString(payload.id)) {
    response.write(`id: ${payload.id}\n`);
  }
  response.write(`event: ${payload.event}\n`);
  for (const line of JSON.stringify(payload.data).split("\n")) {
    response.write(`data: ${line}\n`);
  }
  response.write("\n");
}

/**
 * @param {URLSearchParams} params
 * @param {string} key
 * @returns {number | undefined}
 */
function readQueryInteger(params, key) {
  const raw = asString(params.get(key));
  if (!raw) return undefined;
  const parsed = asPositiveInteger(raw);
  return parsed === null ? undefined : parsed;
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef: string,
 *   runtimeRoot?: string,
 *   host?: string,
 *   port?: number,
 * }} options
 */
export function createControlPlaneHttpServer(options) {
  const host = asString(options.host) ?? "127.0.0.1";
  const requestedPort = asPositiveInteger(options.port);
  const port = requestedPort ?? 0;
  const runtimeOptions = {
    cwd: options.cwd,
    projectRef: options.projectRef,
    runtimeRoot: options.runtimeRoot,
  };
  const state = readProjectState(runtimeOptions);
  const projectId = state.project_id;

  const server = http.createServer(async (request, response) => {
    try {
      const baseOrigin = `http://${request.headers.host ?? `${host}:${port}`}`;
      const requestUrl = new URL(request.url ?? "/", baseOrigin);
      const method = request.method ?? "GET";

      /**
       * @param {RegExp} pattern
       * @returns {RegExpExecArray | null}
       */
      function matchPath(pattern) {
        return pattern.exec(requestUrl.pathname);
      }

      /**
       * @param {string} value
       * @returns {boolean}
       */
      function projectMatches(value) {
        return decodeURIComponent(value) === projectId;
      }

      if (method !== "GET" && method !== "POST") {
        response.setHeader("allow", "GET, POST");
        sendError(response, 405, "method_not_allowed", "Detached control-plane supports only GET and POST.");
        return;
      }

      const stateMatch = matchPath(/^\/api\/projects\/([^/]+)\/state$/u);
      if (stateMatch) {
        if (!projectMatches(stateMatch[1])) {
          sendError(response, 404, "project_not_found", "Requested project id does not match transport scope.");
          return;
        }
        if (method !== "GET") {
          response.setHeader("allow", "GET");
          sendError(response, 405, "method_not_allowed", "State route supports only GET.");
          return;
        }
        sendJson(response, 200, readProjectState(runtimeOptions));
        return;
      }

      const packetsMatch = matchPath(/^\/api\/projects\/([^/]+)\/packets$/u);
      if (packetsMatch) {
        if (!projectMatches(packetsMatch[1])) {
          sendError(response, 404, "project_not_found", "Requested project id does not match transport scope.");
          return;
        }
        if (method !== "GET") {
          response.setHeader("allow", "GET");
          sendError(response, 405, "method_not_allowed", "Packet route supports only GET.");
          return;
        }
        sendJson(response, 200, listPacketArtifacts(runtimeOptions));
        return;
      }

      const stepResultsMatch = matchPath(/^\/api\/projects\/([^/]+)\/step-results$/u);
      if (stepResultsMatch) {
        if (!projectMatches(stepResultsMatch[1])) {
          sendError(response, 404, "project_not_found", "Requested project id does not match transport scope.");
          return;
        }
        if (method !== "GET") {
          response.setHeader("allow", "GET");
          sendError(response, 405, "method_not_allowed", "Step-result route supports only GET.");
          return;
        }
        sendJson(response, 200, listStepResults(runtimeOptions));
        return;
      }

      const qualityArtifactsMatch = matchPath(/^\/api\/projects\/([^/]+)\/quality-artifacts$/u);
      if (qualityArtifactsMatch) {
        if (!projectMatches(qualityArtifactsMatch[1])) {
          sendError(response, 404, "project_not_found", "Requested project id does not match transport scope.");
          return;
        }
        if (method !== "GET") {
          response.setHeader("allow", "GET");
          sendError(response, 405, "method_not_allowed", "Quality route supports only GET.");
          return;
        }
        sendJson(response, 200, listQualityArtifacts(runtimeOptions));
        return;
      }

      const deliveryManifestsMatch = matchPath(/^\/api\/projects\/([^/]+)\/delivery-manifests$/u);
      if (deliveryManifestsMatch) {
        if (!projectMatches(deliveryManifestsMatch[1])) {
          sendError(response, 404, "project_not_found", "Requested project id does not match transport scope.");
          return;
        }
        if (method !== "GET") {
          response.setHeader("allow", "GET");
          sendError(response, 405, "method_not_allowed", "Delivery-manifest route supports only GET.");
          return;
        }
        sendJson(response, 200, listDeliveryManifests(runtimeOptions));
        return;
      }

      const promotionDecisionsMatch = matchPath(/^\/api\/projects\/([^/]+)\/promotion-decisions$/u);
      if (promotionDecisionsMatch) {
        if (!projectMatches(promotionDecisionsMatch[1])) {
          sendError(response, 404, "project_not_found", "Requested project id does not match transport scope.");
          return;
        }
        if (method !== "GET") {
          response.setHeader("allow", "GET");
          sendError(response, 405, "method_not_allowed", "Promotion-decision route supports only GET.");
          return;
        }
        sendJson(response, 200, listPromotionDecisions(runtimeOptions));
        return;
      }

      const strategicSnapshotMatch = matchPath(/^\/api\/projects\/([^/]+)\/strategic-snapshot$/u);
      if (strategicSnapshotMatch) {
        if (!projectMatches(strategicSnapshotMatch[1])) {
          sendError(response, 404, "project_not_found", "Requested project id does not match transport scope.");
          return;
        }
        if (method !== "GET") {
          response.setHeader("allow", "GET");
          sendError(response, 405, "method_not_allowed", "Strategic-snapshot route supports only GET.");
          return;
        }
        sendJson(response, 200, readStrategicSnapshot(runtimeOptions));
        return;
      }

      const runsMatch = matchPath(/^\/api\/projects\/([^/]+)\/runs$/u);
      if (runsMatch) {
        if (!projectMatches(runsMatch[1])) {
          sendError(response, 404, "project_not_found", "Requested project id does not match transport scope.");
          return;
        }
        if (method !== "GET") {
          response.setHeader("allow", "GET");
          sendError(response, 405, "method_not_allowed", "Run route supports only GET.");
          return;
        }
        sendJson(response, 200, listRuns(runtimeOptions));
        return;
      }

      const eventHistoryMatch = matchPath(/^\/api\/projects\/([^/]+)\/runs\/([^/]+)\/events\/history$/u);
      if (eventHistoryMatch) {
        if (!projectMatches(eventHistoryMatch[1])) {
          sendError(response, 404, "project_not_found", "Requested project id does not match transport scope.");
          return;
        }
        if (method !== "GET") {
          response.setHeader("allow", "GET");
          sendError(response, 405, "method_not_allowed", "Event-history route supports only GET.");
          return;
        }
        const runId = decodeURIComponent(eventHistoryMatch[2]);
        const limit = readQueryInteger(requestUrl.searchParams, "limit");
        sendJson(
          response,
          200,
          readRunEventHistory({
            ...runtimeOptions,
            runId,
            limit,
          }),
        );
        return;
      }

      const policyHistoryMatch = matchPath(/^\/api\/projects\/([^/]+)\/runs\/([^/]+)\/policy-history$/u);
      if (policyHistoryMatch) {
        if (!projectMatches(policyHistoryMatch[1])) {
          sendError(response, 404, "project_not_found", "Requested project id does not match transport scope.");
          return;
        }
        if (method !== "GET") {
          response.setHeader("allow", "GET");
          sendError(response, 405, "method_not_allowed", "Policy-history route supports only GET.");
          return;
        }
        const runId = decodeURIComponent(policyHistoryMatch[2]);
        const limit = readQueryInteger(requestUrl.searchParams, "limit");
        sendJson(
          response,
          200,
          readRunPolicyHistory({
            ...runtimeOptions,
            runId,
            limit,
          }),
        );
        return;
      }

      const streamMatch = matchPath(/^\/api\/projects\/([^/]+)\/runs\/([^/]+)\/events$/u);
      if (streamMatch) {
        if (!projectMatches(streamMatch[1])) {
          sendError(response, 404, "project_not_found", "Requested project id does not match transport scope.");
          return;
        }
        if (method !== "GET") {
          response.setHeader("allow", "GET");
          sendError(response, 405, "method_not_allowed", "Run-event stream route supports only GET.");
          return;
        }
        const runId = decodeURIComponent(streamMatch[2]);
        const afterEventId =
          asString(requestUrl.searchParams.get("after_event_id")) ?? asString(requestUrl.searchParams.get("afterEventId"));
        const maxReplay = readQueryInteger(requestUrl.searchParams, "max_replay")
          ?? readQueryInteger(requestUrl.searchParams, "maxReplay");

        const stream = openRunEventStream({
          ...runtimeOptions,
          runId,
          afterEventId,
          maxReplay,
        });

        response.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
        });

        writeSseEvent(response, {
          event: "stream.meta",
          data: {
            protocol: stream.protocol,
            backpressure: stream.backpressure,
            log_file: stream.log_file,
            run_id: runId,
          },
        });

        for (const replayEvent of stream.replay_events) {
          const payload = toHistoryEvent(replayEvent);
          writeSseEvent(response, {
            event: "live-run-event",
            id: payload.event_id,
            data: payload,
          });
        }

        const unsubscribe = stream.subscribe((event) => {
          const payload = toHistoryEvent(event);
          writeSseEvent(response, {
            event: "live-run-event",
            id: payload.event_id,
            data: payload,
          });
        });

        const onClose = () => {
          unsubscribe();
          request.off("close", onClose);
        };
        request.on("close", onClose);
        return;
      }

      const runControlActionMatch = matchPath(/^\/api\/projects\/([^/]+)\/run-control\/actions$/u);
      if (runControlActionMatch) {
        if (!projectMatches(runControlActionMatch[1])) {
          sendError(response, 404, "project_not_found", "Requested project id does not match transport scope.");
          return;
        }
        if (method !== "POST") {
          response.setHeader("allow", "POST");
          sendError(response, 405, "method_not_allowed", "Run-control mutation route supports only POST.");
          return;
        }

        let payload;
        try {
          payload = await readJsonRequestBody(request);
        } catch (error) {
          if (error instanceof Error && error.message === "invalid_json") {
            sendError(response, 400, "invalid_json", "Request body must be valid JSON.");
            return;
          }
          if (error instanceof Error && error.message === "invalid_payload") {
            sendError(response, 400, "invalid_payload", "Request body must be a JSON object.");
            return;
          }
          throw error;
        }

        const action = asString(payload.action);
        if (!action || !RUN_CONTROL_ACTIONS.has(action)) {
          sendError(
            response,
            400,
            "invalid_run_control_action",
            `Unsupported run-control action '${action ?? "missing"}'.`,
          );
          return;
        }

        const result = applyRunControlAction({
          ...runtimeOptions,
          action: /** @type {"start" | "pause" | "resume" | "steer" | "cancel"} */ (action),
          runId: asString(payload.run_id) ?? undefined,
          targetStep: asString(payload.target_step) ?? undefined,
          reason: asString(payload.reason) ?? undefined,
          approvalRef: asString(payload.approval_ref) ?? undefined,
        });
        const runControlPayload = toRunControlResponse(result);

        if (result.blocked) {
          sendJson(response, 409, {
            error: {
              code: result.blockedReason?.code ?? "run_control.blocked",
              message: result.blockedReason?.message ?? "Run-control action blocked by policy or lifecycle transition.",
            },
            run_control: runControlPayload,
          });
          return;
        }

        sendJson(response, 200, {
          run_control: runControlPayload,
        });
        return;
      }

      const uiLifecycleActionMatch = matchPath(/^\/api\/projects\/([^/]+)\/ui-lifecycle\/actions$/u);
      if (uiLifecycleActionMatch) {
        if (!projectMatches(uiLifecycleActionMatch[1])) {
          sendError(response, 404, "project_not_found", "Requested project id does not match transport scope.");
          return;
        }
        if (method !== "POST") {
          response.setHeader("allow", "POST");
          sendError(response, 405, "method_not_allowed", "UI lifecycle mutation route supports only POST.");
          return;
        }

        let payload;
        try {
          payload = await readJsonRequestBody(request);
        } catch (error) {
          if (error instanceof Error && error.message === "invalid_json") {
            sendError(response, 400, "invalid_json", "Request body must be valid JSON.");
            return;
          }
          if (error instanceof Error && error.message === "invalid_payload") {
            sendError(response, 400, "invalid_payload", "Request body must be a JSON object.");
            return;
          }
          throw error;
        }

        const action = asString(payload.action);
        if (!action || !UI_LIFECYCLE_ACTIONS.has(action)) {
          sendError(response, 400, "invalid_ui_lifecycle_action", `Unsupported ui-lifecycle action '${action ?? "missing"}'.`);
          return;
        }

        const result =
          action === "attach"
            ? attachUiLifecycle({
                ...runtimeOptions,
                runId: asString(payload.run_id) ?? undefined,
                controlPlane: asString(payload.control_plane) ?? undefined,
              })
            : detachUiLifecycle({
                ...runtimeOptions,
                runId: asString(payload.run_id) ?? undefined,
              });

        sendJson(response, 200, {
          ui_lifecycle: toUiLifecycleResponse(result),
        });
        return;
      }

      sendError(response, 404, "route_not_found", `Unsupported control-plane path '${requestUrl.pathname}'.`);
    } catch (error) {
      sendError(response, 500, "transport_internal_error", error instanceof Error ? error.message : String(error));
    }
  });

  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      const address = server.address();
      const resolvedPort = typeof address === "object" && address !== null ? address.port : port;
      const baseUrl = `http://${host}:${resolvedPort}`;
      resolve({
        server,
        host,
        port: resolvedPort,
        baseUrl,
        projectId,
        async close() {
          if (!server.listening) {
            return;
          }
          await new Promise((closeResolve, closeReject) => {
            server.close((error) => {
              if (error) {
                closeReject(error);
                return;
              }
              closeResolve(undefined);
            });
          });
        },
      });
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}
