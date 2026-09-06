import crypto from "node:crypto";
import path from "node:path";

import { withFileLock } from "../../observability/src/index.mjs";

const REQUEST_TRANSACTION_LOCK = ".operator-request.transaction.lock";

function asString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim().length > 0))];
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * @param {{ projectId: string, targetStage: string, intentType: string, requestText: string, targetFlowId?: string | null, targetRefs: string[], allowedPaths: string[], deliveryMode: string, idempotencyKey?: string | null }} options
 * @returns {string}
 */
export function resolveOperatorRequestIdempotencyKey(options) {
  const explicit = asString(options.idempotencyKey);
  if (explicit) return explicit;
  const fingerprint = stableJson({
    project_id: options.projectId,
    target_stage: options.targetStage,
    intent_type: options.intentType,
    request_text: options.requestText,
    target_flow_id: options.targetFlowId ?? null,
    target_refs: options.targetRefs,
    allowed_paths: options.allowedPaths,
    delivery_mode: options.deliveryMode,
  });
  return `sha256:${crypto.createHash("sha256").update(fingerprint, "utf8").digest("hex")}`;
}

/**
 * @param {Record<string, unknown>} document
 * @param {{ projectId: string, targetStage: string, intentType: string, requestText: string, targetFlowId?: string | null, targetRefs: string[], allowedPaths: string[], deliveryMode: string }} options
 * @returns {boolean}
 */
export function operatorRequestInputsMatch(document, options) {
  const normalizeArray = (value) => uniqueStrings(value).sort();
  return (
    asString(document.project_id) === options.projectId &&
    asString(document.target_stage) === options.targetStage &&
    asString(document.intent_type) === options.intentType &&
    asString(document.request_text) === options.requestText &&
    (asString(document.target_flow_id) ?? null) === (options.targetFlowId ?? null) &&
    JSON.stringify(normalizeArray(Array.isArray(document.target_refs) ? document.target_refs : [])) === JSON.stringify(normalizeArray(options.targetRefs)) &&
    JSON.stringify(normalizeArray(Array.isArray(document.allowed_paths) ? document.allowed_paths : [])) === JSON.stringify(normalizeArray(options.allowedPaths)) &&
    (asString(document.delivery_mode) ?? "no-write") === options.deliveryMode
  );
}

/**
 * Serialize request creation and execution against the project reports
 * directory so duplicate submissions cannot race before a request exists.
 *
 * @param {Record<string, unknown>} init
 * @param {() => unknown} callback
 * @returns {unknown}
 */
export function withOperatorRequestTransaction(init, callback) {
  const reportsRoot = /** @type {string} */ (init.runtimeLayout?.reportsRoot);
  return withFileLock(path.join(reportsRoot, REQUEST_TRANSACTION_LOCK), callback, {
    staleAfterMs: 30 * 60 * 1000,
    timeoutMs: 30 * 60 * 1000,
  });
}
