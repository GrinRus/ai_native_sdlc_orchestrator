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
  handleProjectTopologyAction,
  handleExecutionProfileAction,
  handleRunControlAction,
  handleUiLifecycleAction,
} from "./http-mutation-handlers.mjs";
import { readProjectTopology } from "../topology-management.mjs";
import { readExecutionProfile } from "../execution-profile.mjs";
import { handleReadRoute } from "./http-read-handlers.mjs";
import { matchControlPlaneRoute } from "./http-router.mjs";
import { handleRunEventStream } from "./http-stream-handlers.mjs";
import {
  MAX_MUTATION_BODY_BYTES,
  asPositiveInteger,
  asString,
  attachResponseRedactionPolicy,
  sendError,
  sendJson,
} from "./http-utils.mjs";
import { createLocalProjectRegistry, summarizeProjectContext } from "../local-project-registry.mjs";

const LOCAL_TRUSTED_HOSTS = new Set(["127.0.0.1", "::1"]);

function listenerAuthority(host, port) {
  return `${host.includes(":") ? `[${host}]` : host}:${port}`;
}

function hasBrowserFetchMetadata(request) {
  return ["sec-fetch-site", "sec-fetch-dest", "sec-fetch-user"].some((name) => request.headers[name] !== undefined);
}

function isJsonMediaType(value) {
  const mediaType = asString(Array.isArray(value) ? value[0] : value)?.split(";", 1)[0]?.trim().toLowerCase();
  return mediaType === "application/json" || /^application\/[a-z0-9!#$&^_.+-]+\+json$/u.test(mediaType ?? "");
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef?: string,
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
 *   workspaceRegistry?: { mode: "ephemeral" | "persistent", root?: string },
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
 *     consoleExperience?: "legacy" | "quiet-cockpit",
 *   },
 * }} options
 */
export function createControlPlaneHttpServer(options) {
  const host = asString(options.host) ?? "127.0.0.1";
  const securityMode = asString(options.auth?.mode ?? options.auth?.security_mode) ?? "local-trusted";
  if (securityMode === "local-trusted" && !LOCAL_TRUSTED_HOSTS.has(host)) {
    throw new Error("Local-trusted control-plane bind must use literal loopback host '127.0.0.1' or '::1'.");
  }
  const requestedPort = asPositiveInteger(options.port);
  const port = requestedPort ?? 0;
  const projectInputs = Array.isArray(options.projects)
    ? options.projects
    : asString(options.projectRef) ? [{
        projectRef: options.projectRef,
        projectProfile: options.projectProfile,
        runtimeRoot: options.runtimeRoot,
      }] : [];
  const registry = createLocalProjectRegistry({
    cwd: options.cwd,
    projects: projectInputs,
    persistence: options.workspaceRegistry,
  });
  const defaultContext = registry.getContext(registry.defaultProjectId);
  const defaultSummary = defaultContext ? summarizeProjectContext(defaultContext) : null;
  const projectId = defaultSummary?.project_id ?? null;
  const projectProfileRef = defaultSummary?.project_profile_ref ?? null;
  const appStaticRoot = asString(options.app?.staticRoot);
  const appConsoleExperience = asString(options.app?.consoleExperience) ?? "legacy";
  if (!["legacy", "quiet-cockpit"].includes(appConsoleExperience)) {
    throw new Error("AOR app console experience must be 'legacy' or 'quiet-cockpit'.");
  }
  const appIndexFile = appStaticRoot ? path.join(appStaticRoot, "index.html") : null;
  if (appStaticRoot && !fs.existsSync(appIndexFile ?? "")) {
    throw new Error(`AOR app static bundle is missing at '${appStaticRoot}'. Run the web build before launching the app.`);
  }
  const authPolicy = normalizeAuthPolicy(options.auth, projectId ?? "*");
  let canonicalAuthority = null;
  let canonicalOrigin = null;

  const server = http.createServer(async (request, response) => {
    try {
      attachResponseRedactionPolicy(response, authPolicy.redactionPolicy);
      if (!canonicalAuthority || !canonicalOrigin) {
        sendError(response, 503, "listener_not_ready", "Control-plane listener authority is not ready.");
        return;
      }
      if (request.headers.host !== canonicalAuthority) {
        sendError(response, 400, "invalid_host", "Host header must match the canonical loopback listener authority.");
        return;
      }
      const requestUrl = new URL(request.url ?? "/", canonicalOrigin);
      const method = request.method ?? "GET";

      if (method !== "GET" && method !== "POST") {
        response.setHeader("allow", "GET, POST");
        sendError(response, 405, "method_not_allowed", "Detached control-plane supports only GET and POST.");
        return;
      }

      if (method === "POST") {
        const origin = asString(request.headers.origin);
        if ((origin && origin !== canonicalOrigin) || (!origin && hasBrowserFetchMetadata(request))) {
          sendError(response, 403, "cross_origin_mutation_denied", "Browser mutations must use the exact local app listener origin.");
          return;
        }
        if (!isJsonMediaType(request.headers["content-type"])) {
          sendError(response, 415, "unsupported_media_type", "Mutation requests require application/json or application/*+json.");
          return;
        }
        const contentLength = asString(request.headers["content-length"]);
        if (contentLength) {
          if (!/^\d+$/u.test(contentLength)) {
            sendError(response, 400, "invalid_content_length", "Content-Length must be a non-negative integer.");
            return;
          }
          if (Number(contentLength) > MAX_MUTATION_BODY_BYTES) {
            sendError(response, 413, "request_body_too_large", "Request body exceeds the 1 MiB limit.");
            return;
          }
        }
      }

      if (appStaticRoot && method === "GET") {
        const served = serveAppRoute({
          requestUrl,
          response,
          staticRoot: appStaticRoot,
          registry,
          packageVersion: asString(options.app?.packageVersion) ?? "0.0.0",
          consoleExperience: appConsoleExperience,
          baseUrl: canonicalOrigin,
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

      const workspaceRoute = route.id === "project-index" || route.id === "project-actions";
      const routeProjectId = asString(params.projectId) ?? projectId ?? "*";
      const context = workspaceRoute ? null : registry.getContext(routeProjectId);
      if (!workspaceRoute && !context) {
        sendError(response, 404, "project_not_found", "Requested project id does not match any registered local project.");
        return;
      }
      const runtimeOptionsWithSecurity = context ? {
        ...context.runtimeOptions,
        redactionPolicy: authPolicy.redactionPolicy,
      } : null;

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
        if (route.id === "project-topology" || route.id === "project-topology-validation") {
          const topology = readProjectTopology({ registry, projectId: routeProjectId });
          sendJson(response, 200, route.id === "project-topology" ? topology : {
            project_id: topology.project_id,
            revision: topology.revision,
            validation: topology.latest_validation,
            read_only: true,
          });
          return;
        }
        if (route.id === "execution-profile") {
          sendJson(response, 200, readExecutionProfile({ registry, projectId: routeProjectId }));
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
      if (route.id === "project-topology-actions") {
        await handleProjectTopologyAction({ request, response, params, registry });
        return;
      }
      if (route.id === "execution-profile-actions") {
        await handleExecutionProfileAction({ request, response, params, registry });
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
      canonicalAuthority = listenerAuthority(host, resolvedPort);
      canonicalOrigin = `http://${canonicalAuthority}`;
      const baseUrl = canonicalOrigin;
      resolve({
        server,
        host,
        port: resolvedPort,
        baseUrl,
        projectId,
        projectProfileRef,
        projectRef: defaultSummary?.project_ref ?? null,
        runtimeRoot: defaultSummary?.runtime_root ?? null,
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
 *   consoleExperience: "legacy" | "quiet-cockpit",
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
    sendJson(options.response, 200, {
      app: "aor-operator-console",
      version: options.packageVersion,
      console_experience: options.consoleExperience,
      project_id: defaultProject?.project_id,
      default_project_id: workspace.default_project_id,
      projects: workspace.projects.map((project) => ({ project_id: project.project_id, label: project.label })),
      api_base_url: options.baseUrl,
      control_plane: options.baseUrl,
    });
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
