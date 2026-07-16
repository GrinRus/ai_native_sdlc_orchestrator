import { redactSensitiveValue } from "../../../../observability/src/index.mjs";
import { createOperatorError } from "../operator-error.mjs";

const RESPONSE_REDACTION_POLICY = Symbol.for("aor.http.responseRedactionPolicy");

const JSON_HEADERS = Object.freeze({
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
});

export const MAX_MUTATION_BODY_BYTES = 1024 * 1024;
export const MUTATION_BODY_TIMEOUT_MS = 5000;

export class HttpRequestBodyError extends Error {
  constructor(code, message, statusCode) {
    super(message);
    this.name = "HttpRequestBodyError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

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
 * @param {unknown} policy
 */
export function attachResponseRedactionPolicy(response, policy) {
  response[RESPONSE_REDACTION_POLICY] = policy;
}

/**
 * @param {import("node:http").ServerResponse} response
 * @returns {unknown}
 */
export function getResponseRedactionPolicy(response) {
  return response[RESPONSE_REDACTION_POLICY];
}

/**
 * @param {import("node:http").ServerResponse} response
 * @param {number} statusCode
 * @param {Record<string, unknown> | Array<unknown>} payload
 */
export function sendJson(response, statusCode, payload) {
  const redactedPayload = redactSensitiveValue(payload, getResponseRedactionPolicy(response));
  response.writeHead(statusCode, JSON_HEADERS);
  response.end(`${JSON.stringify(redactedPayload, null, 2)}\n`);
}

/**
 * @param {import("node:http").ServerResponse} response
 * @param {number} statusCode
 * @param {string} code
 * @param {string} message
 */
export function sendError(response, statusCode, code, message) {
  sendJson(response, statusCode, {
    error: createOperatorError({ code, detail: message }),
  });
}

/**
 * @param {import("node:http").IncomingMessage} request
 * @returns {Promise<Record<string, unknown>>}
 */
export async function readJsonRequestBody(request) {
  const chunks = await new Promise((resolve, reject) => {
    /** @type {Array<Buffer>} */
    const bodyChunks = [];
    let byteLength = 0;
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      request.off("data", onData);
      request.off("end", onEnd);
      request.off("aborted", onAborted);
      request.off("error", onError);
      callback();
    };
    const rejectAndDrain = (error) => finish(() => {
      request.resume();
      reject(error);
    });
    const onData = (chunk) => {
      const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      byteLength += buffer.length;
      if (byteLength > MAX_MUTATION_BODY_BYTES) {
        rejectAndDrain(new HttpRequestBodyError("request_body_too_large", "Request body exceeds the 1 MiB limit.", 413));
        return;
      }
      bodyChunks.push(buffer);
    };
    const onEnd = () => finish(() => resolve(bodyChunks));
    const onAborted = () => finish(() => reject(new HttpRequestBodyError("request_body_aborted", "Request body was aborted before completion.", 400)));
    const onError = () => finish(() => reject(new HttpRequestBodyError("request_body_error", "Request body could not be read.", 400)));
    const timer = setTimeout(() => {
      rejectAndDrain(new HttpRequestBodyError("request_body_timeout", "Request body was not received within 5 seconds.", 408));
    }, MUTATION_BODY_TIMEOUT_MS);
    timer.unref?.();
    request.on("data", onData);
    request.once("end", onEnd);
    request.once("aborted", onAborted);
    request.once("error", onError);
  });

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
