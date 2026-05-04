import { asRecord, asString, sendJson } from "./http-utils.mjs";

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function extractBearerToken(value) {
  const headerValue = Array.isArray(value) ? asString(value[0]) : asString(value);
  if (!headerValue) {
    return null;
  }
  const match = /^Bearer\s+(.+)$/iu.exec(headerValue);
  return match ? asString(match[1]) : null;
}

/**
 * @param {unknown} value
 * @param {string} projectId
 */
export function normalizeAuthPolicy(value, projectId) {
  const auth = asRecord(value);
  const enabled = auth.enabled === true;
  /** @type {Map<string, { tokenId: string, permissions: Set<string>, projectRefs: Set<string> }>} */
  const principals = new Map();

  const tokenEntries = Array.isArray(auth.tokens) ? auth.tokens : [];
  for (const entry of tokenEntries) {
    const tokenRecord = asRecord(entry);
    const token = asString(tokenRecord.token);
    if (!token) {
      continue;
    }
    const tokenId = asString(tokenRecord.token_id) ?? `token.${principals.size + 1}`;

    const permissions = new Set();
    const permissionEntries = Array.isArray(tokenRecord.permissions) ? tokenRecord.permissions : [];
    for (const permission of permissionEntries) {
      const normalized = asString(permission);
      if (normalized === "read" || normalized === "mutate") {
        permissions.add(normalized);
      }
    }
    if (permissions.size === 0) {
      permissions.add("read");
      permissions.add("mutate");
    }

    const projectRefs = new Set();
    const projectRefEntries = Array.isArray(tokenRecord.project_refs) ? tokenRecord.project_refs : [];
    for (const projectRefEntry of projectRefEntries) {
      const projectRef = asString(projectRefEntry);
      if (projectRef) {
        projectRefs.add(projectRef);
      }
    }
    if (projectRefs.size === 0) {
      projectRefs.add(projectId);
    }

    principals.set(token, {
      tokenId,
      permissions,
      projectRefs,
    });
  }

  return {
    enabled,
    principals,
  };
}

/**
 * @param {{
 *   request: import("node:http").IncomingMessage,
 *   policy: ReturnType<typeof normalizeAuthPolicy>,
 *   projectId: string,
 *   requiredPermission: "read" | "mutate",
 * }} options
 */
export function authorizeRequest(options) {
  if (!options.policy.enabled) {
    return {
      allowed: true,
    };
  }

  const token = extractBearerToken(options.request.headers.authorization);
  if (!token) {
    return {
      allowed: false,
      statusCode: 401,
      code: "auth.missing_credentials",
      message: "Authorization bearer token is required when detached transport auth is enabled.",
      requiredPermission: options.requiredPermission,
      projectId: options.projectId,
      tokenId: null,
    };
  }

  const principal = options.policy.principals.get(token);
  if (!principal) {
    return {
      allowed: false,
      statusCode: 401,
      code: "auth.invalid_token",
      message: "Authorization bearer token is not recognized by detached transport auth policy.",
      requiredPermission: options.requiredPermission,
      projectId: options.projectId,
      tokenId: null,
    };
  }

  if (!principal.projectRefs.has(options.projectId) && !principal.projectRefs.has("*")) {
    return {
      allowed: false,
      statusCode: 403,
      code: "auth.forbidden_project",
      message: `Token '${principal.tokenId}' is not authorized for project '${options.projectId}'.`,
      requiredPermission: options.requiredPermission,
      projectId: options.projectId,
      tokenId: principal.tokenId,
    };
  }

  if (!principal.permissions.has(options.requiredPermission)) {
    return {
      allowed: false,
      statusCode: 403,
      code: "auth.insufficient_permission",
      message: `Token '${principal.tokenId}' does not allow '${options.requiredPermission}' operations.`,
      requiredPermission: options.requiredPermission,
      projectId: options.projectId,
      tokenId: principal.tokenId,
    };
  }

  return {
    allowed: true,
    tokenId: principal.tokenId,
  };
}

/**
 * @param {import("node:http").ServerResponse} response
 * @param {{
 *   statusCode: number,
 *   code: string,
 *   message: string,
 *   requiredPermission: "read" | "mutate",
 *   projectId: string,
 *   tokenId: string | null,
 * }} decision
 */
export function sendAuthError(response, decision) {
  sendJson(response, decision.statusCode, {
    error: {
      code: decision.code,
      message: decision.message,
      auth: {
        required_permission: decision.requiredPermission,
        project_id: decision.projectId,
        token_id: decision.tokenId,
      },
    },
  });
}
