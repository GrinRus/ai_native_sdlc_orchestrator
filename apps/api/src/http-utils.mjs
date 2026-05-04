const JSON_HEADERS = Object.freeze({
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
});

/**
 * @param {unknown} value
 * @returns {string | null}
 */
export function asString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
export function asPositiveInteger(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const normalized = Math.floor(parsed);
  return normalized >= 0 ? normalized : null;
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
export function asRecord(value) {
  return typeof value === "object" && value !== null ? /** @type {Record<string, unknown>} */ (value) : {};
}

/**
 * @param {import("node:http").ServerResponse} response
 * @param {number} statusCode
 * @param {Record<string, unknown> | Array<unknown>} payload
 */
export function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, JSON_HEADERS);
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
}

/**
 * @param {import("node:http").ServerResponse} response
 * @param {number} statusCode
 * @param {string} code
 * @param {string} message
 */
export function sendError(response, statusCode, code, message) {
  sendJson(response, statusCode, {
    error: {
      code,
      message,
    },
  });
}

/**
 * @param {import("node:http").IncomingMessage} request
 * @returns {Promise<Record<string, unknown>>}
 */
export async function readJsonRequestBody(request) {
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
 * @param {URLSearchParams} params
 * @param {string} key
 * @returns {number | undefined}
 */
export function readQueryInteger(params, key) {
  const raw = asString(params.get(key));
  if (!raw) return undefined;
  const parsed = asPositiveInteger(raw);
  return parsed === null ? undefined : parsed;
}
