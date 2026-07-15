import http from "node:http";
import fs from "node:fs";
import path from "node:path";

import { authorizeRequest, normalizeAuthPolicy, sendAuthError } from "./http-auth.mjs";
import {
  handleInteractionAnswer,
  handleFlowPlanAction,
  handleLifecycleCommandAction,
  handleOperatorRequestAction,
  handleOperatorRequestCreate,
  handleProjectAction,
  handleRunControlAction,
  handleUiLifecycleAction,
} from "./http-mutation-handlers.mjs";
import { handleReadRoute } from "./http-read-handlers.mjs";
import { matchControlPlaneRoute } from "./http-router.mjs";
import { handleRunEventStream } from "./http-stream-handlers.mjs";
import { asPositiveInteger, asString, attachResponseRedactionPolicy, sendError, sendJson } from "./http-utils.mjs";
import { createLocalProjectRegistry, summarizeProjectContext } from "../local-project-registry.mjs";

/**
 * @param {{
 *   cwd?: string,
 *   projectRef: string,
 *   projectProfile?: string,
 *   runtimeRoot?: string,
 *   projects?: Array<{
 *     projectRef: string,
 *     projectProfile?: string,
 *     runtimeRoot?: string,
 *     label?: string,
 *   }>,
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
  const projectInputs = Array.isArray(options.projects) && options.projects.length > 0
    ? options.projects
    : [{
        projectRef: options.projectRef,
        projectProfile: options.projectProfile,
        runtimeRoot: options.runtimeRoot,
      }];
  const registry = createLocalProjectRegistry({
    cwd: options.cwd,
    projects: projectInputs,
  });
  const defaultContext = registry.getContext(registry.defaultProjectId);
  const defaultSummary = summarizeProjectContext(defaultContext);
  const projectId = defaultSummary.project_id;
  const projectProfileRef = defaultSummary.project_profile_ref;
  const appStaticRoot = asString(options.app?.staticRoot);
  const appIndexFile = appStaticRoot ? path.join(appStaticRoot, "index.html") : null;
  if (appStaticRoot && !fs.existsSync(appIndexFile ?? "")) {
    throw new Error(`AOR app static bundle is missing at '${appStaticRoot}'. Run the web build before launching the app.`);
  }
  const authPolicy = normalizeAuthPolicy(options.auth, projectId);

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
          registry,
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

      if (method !== route.method) {
        response.setHeader("allow", route.allow);
        sendError(response, 405, "method_not_allowed", route.methodMessage);
        return;
      }

      const routeProjectId = asString(params.projectId) ?? projectId;
      const context = route.id === "project-index" || route.id === "project-actions"
        ? defaultContext
        : registry.getContext(routeProjectId);
      if (!context) {
        sendError(response, 404, "project_not_found", "Requested project id does not match any registered local project.");
        return;
      }
      const runtimeOptionsWithSecurity = {
        ...context.runtimeOptions,
        redactionPolicy: authPolicy.redactionPolicy,
      };

      const decision = authorizeRequest({
        request,
        policy: authPolicy,
        projectId: routeProjectId,
        requiredPermission: route.permission,
      });
      if (!decision.allowed) {
        sendAuthError(response, decision);
        return;
      }

      if (route.kind === "read") {
        if (route.id === "project-index") {
          sendJson(response, 200, registry.summarize());
          return;
        }
        handleReadRoute({
          routeId: route.id,
          params,
          requestUrl,
          response,
          runtimeOptions: runtimeOptionsWithSecurity,
        });
        return;
      }

      if (route.id === "project-actions") {
        await handleProjectAction({ request, response, registry });
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

      if (route.id === "flow-plan-actions") {
        await handleFlowPlanAction({ request, response, params, runtimeOptions: runtimeOptionsWithSecurity });
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
        projectProfileRef,
        projectRef: defaultSummary.project_ref,
        runtimeRoot: defaultSummary.runtime_root,
        async close() {
          if (!server.listening) {
            return;
          }
          await new Promise((closeResolve, closeReject) => {
            const forceClose = setTimeout(() => server.closeAllConnections?.(), 250);
            forceClose.unref?.();
            server.close((error) => {
              clearTimeout(forceClose);
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
 *   registry: ReturnType<typeof createLocalProjectRegistry>,
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
    const workspace = options.registry.summarize();
    const defaultProject =
      workspace.projects.find((project) => project.project_id === workspace.default_project_id) ??
      workspace.projects[0];
    options.response.statusCode = 200;
    options.response.setHeader("content-type", "application/json; charset=utf-8");
    options.response.end(
      `${JSON.stringify(
        {
          app: "aor-operator-console",
          version: options.packageVersion,
          project_id: defaultProject?.project_id,
          default_project_id: workspace.default_project_id,
          projects: workspace.projects,
          project_profile_ref: defaultProject?.project_profile_ref,
          project_ref: defaultProject?.project_ref,
          runtime_root: defaultProject?.runtime_root,
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
