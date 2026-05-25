const ROUTES = Object.freeze([
  {
    id: "project-state",
    pattern: /^\/api\/projects\/([^/]+)\/state$/u,
    method: "GET",
    allow: "GET",
    permission: "read",
    methodMessage: "State route supports only GET.",
    params: ["projectId"],
    kind: "read",
  },
  {
    id: "packets",
    pattern: /^\/api\/projects\/([^/]+)\/packets$/u,
    method: "GET",
    allow: "GET",
    permission: "read",
    methodMessage: "Packet route supports only GET.",
    params: ["projectId"],
    kind: "read",
  },
  {
    id: "step-results",
    pattern: /^\/api\/projects\/([^/]+)\/step-results$/u,
    method: "GET",
    allow: "GET",
    permission: "read",
    methodMessage: "Step-result route supports only GET.",
    params: ["projectId"],
    kind: "read",
  },
  {
    id: "quality-artifacts",
    pattern: /^\/api\/projects\/([^/]+)\/quality-artifacts$/u,
    method: "GET",
    allow: "GET",
    permission: "read",
    methodMessage: "Quality route supports only GET.",
    params: ["projectId"],
    kind: "read",
  },
  {
    id: "delivery-manifests",
    pattern: /^\/api\/projects\/([^/]+)\/delivery-manifests$/u,
    method: "GET",
    allow: "GET",
    permission: "read",
    methodMessage: "Delivery-manifest route supports only GET.",
    params: ["projectId"],
    kind: "read",
  },
  {
    id: "promotion-decisions",
    pattern: /^\/api\/projects\/([^/]+)\/promotion-decisions$/u,
    method: "GET",
    allow: "GET",
    permission: "read",
    methodMessage: "Promotion-decision route supports only GET.",
    params: ["projectId"],
    kind: "read",
  },
  {
    id: "strategic-snapshot",
    pattern: /^\/api\/projects\/([^/]+)\/strategic-snapshot$/u,
    method: "GET",
    allow: "GET",
    permission: "read",
    methodMessage: "Strategic-snapshot route supports only GET.",
    params: ["projectId"],
    kind: "read",
  },
  {
    id: "planner-metrics",
    pattern: /^\/api\/projects\/([^/]+)\/planner-metrics$/u,
    method: "GET",
    allow: "GET",
    permission: "read",
    methodMessage: "Planner-metrics route supports only GET.",
    params: ["projectId"],
    kind: "read",
  },
  {
    id: "finance-monitoring",
    pattern: /^\/api\/projects\/([^/]+)\/finance-monitoring$/u,
    method: "GET",
    allow: "GET",
    permission: "read",
    methodMessage: "Finance-monitoring route supports only GET.",
    params: ["projectId"],
    kind: "read",
  },
  {
    id: "next-action-report",
    pattern: /^\/api\/projects\/([^/]+)\/next-action-report$/u,
    method: "GET",
    allow: "GET",
    permission: "read",
    methodMessage: "Next-action report route supports only GET.",
    params: ["projectId"],
    kind: "read",
  },
  {
    id: "operator-requests",
    pattern: /^\/api\/projects\/([^/]+)\/operator-requests$/u,
    method: "GET",
    allow: "GET, POST",
    permission: "read",
    methodMessage: "Operator-request list route supports GET for reads and POST for creation.",
    params: ["projectId"],
    kind: "read",
  },
  {
    id: "multirepo-coordination",
    pattern: /^\/api\/projects\/([^/]+)\/multirepo-coordination$/u,
    method: "GET",
    allow: "GET",
    permission: "read",
    methodMessage: "Multirepo coordination route supports only GET.",
    params: ["projectId"],
    kind: "read",
  },
  {
    id: "compiler-revisions",
    pattern: /^\/api\/projects\/([^/]+)\/compiler-revisions$/u,
    method: "GET",
    allow: "GET",
    permission: "read",
    methodMessage: "Compiler-revision route supports only GET.",
    params: ["projectId"],
    kind: "read",
  },
  {
    id: "runs",
    pattern: /^\/api\/projects\/([^/]+)\/runs$/u,
    method: "GET",
    allow: "GET",
    permission: "read",
    methodMessage: "Run route supports only GET.",
    params: ["projectId"],
    kind: "read",
  },
  {
    id: "event-history",
    pattern: /^\/api\/projects\/([^/]+)\/runs\/([^/]+)\/events\/history$/u,
    method: "GET",
    allow: "GET",
    permission: "read",
    methodMessage: "Event-history route supports only GET.",
    params: ["projectId", "runId"],
    kind: "read",
  },
  {
    id: "policy-history",
    pattern: /^\/api\/projects\/([^/]+)\/runs\/([^/]+)\/policy-history$/u,
    method: "GET",
    allow: "GET",
    permission: "read",
    methodMessage: "Policy-history route supports only GET.",
    params: ["projectId", "runId"],
    kind: "read",
  },
  {
    id: "run-events",
    pattern: /^\/api\/projects\/([^/]+)\/runs\/([^/]+)\/events$/u,
    method: "GET",
    allow: "GET",
    permission: "read",
    methodMessage: "Run-event stream route supports only GET.",
    params: ["projectId", "runId"],
    kind: "stream",
  },
  {
    id: "run-control-actions",
    pattern: /^\/api\/projects\/([^/]+)\/run-control\/actions$/u,
    method: "POST",
    allow: "POST",
    permission: "mutate",
    methodMessage: "Run-control mutation route supports only POST.",
    params: ["projectId"],
    kind: "mutation",
  },
  {
    id: "operator-request-create",
    pattern: /^\/api\/projects\/([^/]+)\/operator-requests$/u,
    method: "POST",
    allow: "GET, POST",
    permission: "mutate",
    methodMessage: "Operator-request creation route supports GET for reads and POST for creation.",
    params: ["projectId"],
    kind: "mutation",
  },
  {
    id: "operator-request-actions",
    pattern: /^\/api\/projects\/([^/]+)\/operator-requests\/([^/]+)\/actions$/u,
    method: "POST",
    allow: "POST",
    permission: "mutate",
    methodMessage: "Operator-request action route supports only POST.",
    params: ["projectId", "requestId"],
    kind: "mutation",
  },
  {
    id: "ui-lifecycle-actions",
    pattern: /^\/api\/projects\/([^/]+)\/ui-lifecycle\/actions$/u,
    method: "POST",
    allow: "POST",
    permission: "mutate",
    methodMessage: "UI lifecycle mutation route supports only POST.",
    params: ["projectId"],
    kind: "mutation",
  },
  {
    id: "lifecycle-command-actions",
    pattern: /^\/api\/projects\/([^/]+)\/lifecycle-command\/actions$/u,
    method: "POST",
    allow: "POST",
    permission: "mutate",
    methodMessage: "Lifecycle command mutation route supports only POST.",
    params: ["projectId"],
    kind: "mutation",
  },
  {
    id: "interaction-answers",
    pattern: /^\/api\/projects\/([^/]+)\/interactions\/answers$/u,
    method: "POST",
    allow: "POST",
    permission: "mutate",
    methodMessage: "Interaction answer mutation route supports only POST.",
    params: ["projectId"],
    kind: "mutation",
  },
]);

const ROUTE_OPENAPI_PATHS = Object.freeze({
  "project-state": "/api/projects/{projectId}/state",
  packets: "/api/projects/{projectId}/packets",
  "step-results": "/api/projects/{projectId}/step-results",
  "quality-artifacts": "/api/projects/{projectId}/quality-artifacts",
  "delivery-manifests": "/api/projects/{projectId}/delivery-manifests",
  "promotion-decisions": "/api/projects/{projectId}/promotion-decisions",
  "strategic-snapshot": "/api/projects/{projectId}/strategic-snapshot",
  "planner-metrics": "/api/projects/{projectId}/planner-metrics",
  "finance-monitoring": "/api/projects/{projectId}/finance-monitoring",
  "next-action-report": "/api/projects/{projectId}/next-action-report",
  "operator-requests": "/api/projects/{projectId}/operator-requests",
  "multirepo-coordination": "/api/projects/{projectId}/multirepo-coordination",
  "compiler-revisions": "/api/projects/{projectId}/compiler-revisions",
  runs: "/api/projects/{projectId}/runs",
  "event-history": "/api/projects/{projectId}/runs/{runId}/events/history",
  "policy-history": "/api/projects/{projectId}/runs/{runId}/policy-history",
  "run-events": "/api/projects/{projectId}/runs/{runId}/events",
  "run-control-actions": "/api/projects/{projectId}/run-control/actions",
  "operator-request-create": "/api/projects/{projectId}/operator-requests",
  "operator-request-actions": "/api/projects/{projectId}/operator-requests/{requestId}/actions",
  "ui-lifecycle-actions": "/api/projects/{projectId}/ui-lifecycle/actions",
  "lifecycle-command-actions": "/api/projects/{projectId}/lifecycle-command/actions",
  "interaction-answers": "/api/projects/{projectId}/interactions/answers",
});

export function listControlPlaneRoutes() {
  return ROUTES.map((route) => ({
    id: route.id,
    method: route.method,
    path: ROUTE_OPENAPI_PATHS[route.id] ?? null,
    permission: route.permission,
    kind: route.kind,
    params: [...route.params],
  }));
}

/**
 * @param {string} pathname
 * @param {string} [method]
 * @returns {{ route: (typeof ROUTES)[number], params: Record<string, string> } | null}
 */
export function matchControlPlaneRoute(pathname, method) {
  /** @type {{ route: (typeof ROUTES)[number], params: Record<string, string> } | null} */
  let methodMismatch = null;
  for (const route of ROUTES) {
    const match = route.pattern.exec(pathname);
    if (!match) {
      continue;
    }
    const params = {};
    route.params.forEach((name, index) => {
      params[name] = decodeURIComponent(match[index + 1]);
    });
    const matched = { route, params };
    if (!method || route.method === method) {
      return matched;
    }
    methodMismatch ??= matched;
  }
  return methodMismatch;
}
