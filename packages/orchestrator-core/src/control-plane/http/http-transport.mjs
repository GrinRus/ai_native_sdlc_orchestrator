import http from "node:http";
import fs from "node:fs";
import path from "node:path";

import { authorizeRequest, normalizeAuthPolicy, sendAuthError } from "./http-auth.mjs";
import {
  handleInteractionAnswer,
  handleLifecycleCommandAction,
  handleOperatorRequestAction,
  handleOperatorRequestCreate,
  handleRunControlAction,
  handleUiLifecycleAction,
} from "./http-mutation-handlers.mjs";
import { handleReadRoute } from "./http-read-handlers.mjs";
import { matchControlPlaneRoute } from "./http-router.mjs";
import { handleRunEventStream } from "./http-stream-handlers.mjs";
import { asPositiveInteger, asString, attachResponseRedactionPolicy, sendError } from "./http-utils.mjs";
import { readProjectState } from "../read-surface.mjs";

/**
 * @param {{
 *   cwd?: string,
 *   projectRef: string,
 *   runtimeRoot?: string,
 *   host?: string,
 *   port?: number,
 *   auth?: {
 *     mode?: "local-trusted" | "production-hardened",
 *     enabled?: boolean,
 *     tokens?: Array<{
 *       token: string,
 *       token_id?: string,
 *       permissions?: Array<"read" | "mutate">,
 *       project_refs?: string[],
 *     }>,
 *     secret_values?: string[],
 *   },
 *   app?: {
 *     staticRoot?: string,
 *     packageVersion?: string,
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
  const appStaticRoot = asString(options.app?.staticRoot);
  const appIndexFile = appStaticRoot ? path.join(appStaticRoot, "index.html") : null;
  if (appStaticRoot && !fs.existsSync(appIndexFile ?? "")) {
    throw new Error(`AOR app static bundle is missing at '${appStaticRoot}'. Run the web build before launching the app.`);
  }
  const authPolicy = normalizeAuthPolicy(options.auth, projectId);
  const runtimeOptionsWithSecurity = {
    ...runtimeOptions,
    redactionPolicy: authPolicy.redactionPolicy,
  };

  const server = http.createServer(async (request, response) => {
    try {
      attachResponseRedactionPolicy(response, authPolicy.redactionPolicy);
      const baseOrigin = `http://${request.headers.host ?? `${host}:${port}`}`;
      const requestUrl = new URL(request.url ?? "/", baseOrigin);
      const method = request.method ?? "GET";

      if (method !== "GET" && method !== "POST") {
        response.setHeader("allow", "GET, POST");
        sendError(response, 405, "method_not_allowed", "Detached control-plane supports only GET and POST.");
        return;
      }

      if (appStaticRoot && method === "GET") {
        const served = serveAppRoute({
          requestUrl,
          response,
          staticRoot: appStaticRoot,
          projectState: state,
          packageVersion: asString(options.app?.packageVersion) ?? "0.0.0",
          baseUrl: `http://${request.headers.host ?? `${host}:${port}`}`,
        });
        if (served) {
          return;
        }
      }

      const matchedRoute = matchControlPlaneRoute(requestUrl.pathname, method);
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
          runtimeOptions: runtimeOptionsWithSecurity,
        });
        return;
      }

      if (route.kind === "stream") {
        handleRunEventStream({
          params,
          request,
          requestUrl,
          response,
          runtimeOptions: runtimeOptionsWithSecurity,
        });
        return;
      }

      if (route.id === "run-control-actions") {
        await handleRunControlAction({ request, response, runtimeOptions: runtimeOptionsWithSecurity });
        return;
      }

      if (route.id === "operator-request-create") {
        await handleOperatorRequestCreate({ request, response, runtimeOptions: runtimeOptionsWithSecurity });
        return;
      }

      if (route.id === "operator-request-actions") {
        await handleOperatorRequestAction({
          request,
          response,
          params,
          runtimeOptions: runtimeOptionsWithSecurity,
        });
        return;
      }

      if (route.id === "ui-lifecycle-actions") {
        await handleUiLifecycleAction({ request, response, runtimeOptions: runtimeOptionsWithSecurity });
        return;
      }

      if (route.id === "lifecycle-command-actions") {
        await handleLifecycleCommandAction({ request, response, runtimeOptions: runtimeOptionsWithSecurity });
        return;
      }

      if (route.id === "interaction-answers") {
        await handleInteractionAnswer({ request, response, runtimeOptions: runtimeOptionsWithSecurity });
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

/**
 * @param {string} filePath
 * @returns {string}
 */
function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  return "application/octet-stream";
}

/**
 * @param {{
 *   requestUrl: URL,
 *   response: import("node:http").ServerResponse,
 *   staticRoot: string,
 *   projectState: ReturnType<typeof readProjectState>,
 *   packageVersion: string,
 *   baseUrl: string,
 * }} options
 * @returns {boolean}
 */
function serveAppRoute(options) {
  const pathname = decodeURIComponent(options.requestUrl.pathname);
  if (pathname.startsWith("/api/")) {
    return false;
  }

  if (pathname === "/app-config.json") {
    options.response.statusCode = 200;
    options.response.setHeader("content-type", "application/json; charset=utf-8");
    options.response.end(
      `${JSON.stringify(
        {
          app: "aor-operator-console",
          version: options.packageVersion,
          project_id: options.projectState.project_id,
          project_ref: options.projectState.project_root,
          runtime_root: options.projectState.runtime_root,
          api_base_url: options.baseUrl,
          control_plane: options.baseUrl,
        },
        null,
        2,
      )}\n`,
    );
    return true;
  }

  const requestedRelative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/u, "");
  const requestedFile = path.resolve(options.staticRoot, requestedRelative);
  const staticRoot = path.resolve(options.staticRoot);
  const targetFile =
    requestedFile === staticRoot || requestedFile.startsWith(`${staticRoot}${path.sep}`)
      ? requestedFile
      : path.join(staticRoot, "index.html");
  const fileToServe = fs.existsSync(targetFile) && fs.statSync(targetFile).isFile()
    ? targetFile
    : path.join(staticRoot, "index.html");

  options.response.statusCode = 200;
  options.response.setHeader("content-type", contentTypeFor(fileToServe));
  fs.createReadStream(fileToServe).pipe(options.response);
  return true;
}
