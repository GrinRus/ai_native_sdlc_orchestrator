import crypto from "node:crypto";

import { validatePublicId } from "../../../contracts/src/index.mjs";

function normalizePrefix(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

/**
 * Preserve a readable generated ID when valid, otherwise return a stable
 * content-addressed ID. Use only for producer-owned derived identities; input
 * public IDs must continue to fail closed at their ingress boundary.
 *
 * @param {string} kind
 * @param {string} candidate
 * @returns {string}
 */
export function boundedDerivedId(kind, candidate) {
  if (validatePublicId(candidate).ok) return candidate;

  const prefix = normalizePrefix(kind) || "derived-id";
  const digest = crypto.createHash("sha256").update(candidate).digest("hex").slice(0, 32);
  return `${prefix.slice(0, 94)}-${digest}`;
}
