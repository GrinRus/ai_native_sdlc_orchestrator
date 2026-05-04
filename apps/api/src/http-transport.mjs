import http from "node:http";

import { authorizeRequest, normalizeAuthPolicy, sendAuthError } from "./http-auth.mjs";
import { handleRunControlAction, handleUiLifecycleAction } from "./http-mutation-handlers.mjs";
import { handleReadRoute } from "./http-read-handlers.mjs";
import { matchControlPlaneRoute } from "./http-router.mjs";
import { handleRunEventStream } from "./http-stream-handlers.mjs";
import { asPositiveInteger, asString, sendError } from "./http-utils.mjs";
import { readProjectState } from "./read-surface.mjs";

/**
 * @param {{
 *   cwd?: string,
 *   projectRef: string,
 *   runtimeRoot?: string,
 *   host?: string,
 *   port?: number,
 *   auth?: {
 *     enabled?: boolean,
 *     tokens?: Array<{
 *       token: string,
 *       token_id?: string,
 *       permissions?: Array<"read" | "mutate">,
 *       project_refs?: string[],
 *     }>,
 *   },
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
  const authPolicy = normalizeAuthPolicy(options.auth, projectId);

  const server = http.createServer(async (request, response) => {
    try {
      const baseOrigin = `http://${request.headers.host ?? `${host}:${port}`}`;
      const requestUrl = new URL(request.url ?? "/", baseOrigin);
      const method = request.method ?? "GET";

      if (method !== "GET" && method !== "POST") {
        response.setHeader("allow", "GET, POST");
        sendError(response, 405, "method_not_allowed", "Detached control-plane supports only GET and POST.");
        return;
      }

      const matchedRoute = matchControlPlaneRoute(requestUrl.pathname);
      if (!matchedRoute) {
        sendError(response, 404, "route_not_found", `Unsupported control-plane path '${requestUrl.pathname}'.`);
        return;
      }

      const { route, params } = matchedRoute;
      if (params.projectId !== projectId) {
        sendError(response, 404, "project_not_found", "Requested project id does not match transport scope.");
        return;
      }

      if (method !== route.method) {
        response.setHeader("allow", route.allow);
        sendError(response, 405, "method_not_allowed", route.methodMessage);
        return;
      }

      const decision = authorizeRequest({
        request,
        policy: authPolicy,
        projectId,
        requiredPermission: route.permission,
      });
      if (!decision.allowed) {
        sendAuthError(response, decision);
        return;
      }

      if (route.kind === "read") {
        handleReadRoute({
          routeId: route.id,
          params,
          requestUrl,
          response,
          runtimeOptions,
        });
        return;
      }

      if (route.kind === "stream") {
        handleRunEventStream({
          params,
          request,
          requestUrl,
          response,
          runtimeOptions,
        });
        return;
      }

      if (route.id === "run-control-actions") {
        await handleRunControlAction({ request, response, runtimeOptions });
        return;
      }

      if (route.id === "ui-lifecycle-actions") {
        await handleUiLifecycleAction({ request, response, runtimeOptions });
        return;
      }

      throw new Error(`Unsupported control-plane route kind '${route.kind}'.`);
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
