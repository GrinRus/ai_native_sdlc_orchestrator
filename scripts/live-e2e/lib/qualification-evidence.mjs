import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { resolveEvidenceReference } from "../../../packages/contracts/src/evidence-reference.mjs";

const IDENTITY_FIELDS = Object.freeze([
  "source_commit",
  "target_commit",
  "profile_sha256",
  "proof_sha256",
  "cell_id",
  "provider_variant_id",
  "feature_size",
]);

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function digestHex(value) {
  const normalized = asNonEmptyString(value) || "";
  return normalized.startsWith("sha256:") ? normalized.slice("sha256:".length) : normalized;
}

function digestRef(value) {
  return `sha256:${value}`;
}

function isSha256(value) {
  return /^[0-9a-f]{64}$/u.test(digestHex(value));
}

function readJsonIfPossible(filePath) {
  if (!filePath || !/\.(?:json|jsonl|ya?ml)$/iu.test(filePath)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return asRecord(parsed);
  } catch {
    return {};
  }
}

function portableRef(reference, projectRoot) {
  const value = asNonEmptyString(reference);
  if (!value || value.startsWith("evidence://")) return value;
  if (path.isAbsolute(value) && projectRoot) {
    const relative = path.relative(path.resolve(projectRoot), value).replace(/\\/g, "/");
    if (relative && relative !== ".." && !relative.startsWith("../") && !path.isAbsolute(relative)) {
      return `evidence://${relative}`;
    }
  }
  return value;
}

/**
 * Normalize the immutable identity which gates qualification evidence.
 * Unknown fields are deliberately dropped so callers cannot smuggle mutable
 * runtime state into the freshness key.
 */
export function normalizeQualificationIdentity(value) {
  const record = asRecord(value);
  return Object.fromEntries(
    IDENTITY_FIELDS
      .map((field) => [field, asNonEmptyString(record[field])])
      .filter(([, entry]) => entry !== null),
  );
}

export function qualificationIdentityMismatches(actual, expected) {
  const left = normalizeQualificationIdentity(actual);
  const right = normalizeQualificationIdentity(expected);
  return Object.fromEntries(
    Object.entries(right)
      .filter(([field, value]) => left[field] !== value)
      .map(([field, value]) => [field, { expected: value, actual: left[field] ?? null }]),
  );
}

export function qualificationIdentityDigest(identity) {
  const normalized = normalizeQualificationIdentity(identity);
  const canonical = JSON.stringify(Object.fromEntries(Object.entries(normalized).sort(([a], [b]) => a.localeCompare(b))));
  return digestRef(crypto.createHash("sha256").update(canonical).digest("hex"));
}

/**
 * Resolve one qualification artifact through the shared AOR evidence owner.
 * The result is safe to place in a report: it contains a portable reference,
 * recomputed digest, ownership, retention and redaction metadata, never the
 * resolved local path.
 */
export function resolveQualificationEvidence(options = {}) {
  const reference = asNonEmptyString(options.reference);
  const projectRoot = asNonEmptyString(options.projectRoot) || process.cwd();
  const projectRuntimeRoot = asNonEmptyString(options.projectRuntimeRoot) || projectRoot;
  const workspaceProjectId = asNonEmptyString(options.workspaceProjectId) || undefined;
  const issues = [];
  if (!reference) return { ok: false, issues: ["qualification evidence reference is missing"], entry: null };

  let resolved;
  try {
    resolved = resolveEvidenceReference({
      projectRoot,
      projectRuntimeRoot,
      workspaceProjectId,
      reference,
      expectedDigest: isSha256(options.expectedDigest) ? digestHex(options.expectedDigest) : undefined,
    });
  } catch (error) {
    return {
      ok: false,
      issues: [error instanceof Error ? `${error.code || "evidence-resolution-failed"}: ${error.message}` : String(error)],
      entry: null,
    };
  }

  const document = readJsonIfPossible(resolved.filePath);
  const sidecarFile = `${resolved.filePath}.authority.json`;
  const sidecar = fs.existsSync(sidecarFile) ? readJsonIfPossible(sidecarFile) : {};
  const expectedIdentity = normalizeQualificationIdentity(options.expectedIdentity);
  const actualIdentity = normalizeQualificationIdentity({
    ...document,
    ...sidecar,
    source_commit: document.source_commit ?? document.commit_sha ?? sidecar.source_commit,
    target_commit: document.target_commit ?? sidecar.target_commit,
    profile_sha256: document.profile_sha256 ?? document.profile_digest ?? sidecar.profile_sha256,
    proof_sha256: document.proof_sha256 ?? document.adversarial_proof_sha256 ?? sidecar.proof_sha256,
    cell_id: document.cell_id ?? sidecar.cell_id,
    provider_variant_id: document.provider_variant_id ?? sidecar.provider_variant_id,
    feature_size: document.feature_size ?? sidecar.feature_size,
  });
  const identityToCheck = options.requireIdentityMetadata === true
    ? expectedIdentity
    : Object.fromEntries(Object.entries(expectedIdentity).filter(([field]) => actualIdentity[field] !== undefined));
  const mismatches = qualificationIdentityMismatches(actualIdentity, identityToCheck);
  for (const [field, mismatch] of Object.entries(mismatches)) {
    issues.push(`qualification evidence identity mismatch for '${field}': expected '${mismatch.expected}', got '${mismatch.actual ?? "missing"}'`);
  }

  const expectedRunId = asNonEmptyString(options.expectedRunId);
  const evidenceRunId = asNonEmptyString(document.run_id) || asNonEmptyString(sidecar.run_id);
  if (expectedRunId && evidenceRunId && evidenceRunId !== expectedRunId) {
    issues.push(`qualification evidence belongs to run '${evidenceRunId}', expected '${expectedRunId}'`);
  }
  if (expectedRunId && !evidenceRunId) issues.push("qualification evidence does not declare run ownership");

  const generatedAt = asNonEmptyString(document.generated_at) || asNonEmptyString(document.created_at) || asNonEmptyString(sidecar.generated_at);
  const reportGeneratedAt = Date.parse(asNonEmptyString(options.reportGeneratedAt) || "");
  const evidenceGeneratedAt = Date.parse(generatedAt || "");
  if (!Number.isFinite(evidenceGeneratedAt)) issues.push("qualification evidence freshness timestamp is missing or invalid");
  if (Number.isFinite(reportGeneratedAt) && Number.isFinite(evidenceGeneratedAt) && evidenceGeneratedAt > reportGeneratedAt) {
    issues.push("qualification evidence was generated after the qualification report");
  }

  const retention = asRecord(document.retention ?? sidecar.retention);
  const expiresAt = asNonEmptyString(retention.expires_at) || asNonEmptyString(sidecar.expires_at);
  if (expiresAt && Number.isFinite(reportGeneratedAt) && Date.parse(expiresAt) < reportGeneratedAt) {
    issues.push("qualification evidence retention expired before the report was generated");
  }
  const redaction = asRecord(document.redaction ?? sidecar.redaction);
  const redactionState = asNonEmptyString(redaction.state) || "unknown";
  if (options.requireRedaction === true && !["none", "redacted"].includes(redactionState)) {
    issues.push("qualification evidence redaction state is not explicit");
  }
  if (options.requirePortable !== false && path.isAbsolute(reference) && !portableRef(reference, projectRoot)?.startsWith("evidence://")) {
    issues.push("qualification evidence reference is not portable");
  }

  const expectedCellId = asNonEmptyString(options.expectedCellId);
  if (expectedCellId && actualIdentity.cell_id && actualIdentity.cell_id !== expectedCellId) {
    issues.push(`qualification evidence cell '${actualIdentity.cell_id}' does not match '${expectedCellId}'`);
  }

  const entry = {
    kind: asNonEmptyString(options.kind) || "qualification-evidence",
    ref: portableRef(reference, projectRoot),
    digest: digestRef(resolved.sha256),
    owner: asNonEmptyString(options.owner) || "aor",
    generated_at: generatedAt || new Date(fs.statSync(resolved.filePath).mtimeMs).toISOString(),
    run_id: evidenceRunId || expectedRunId || "unknown",
    qualification_identity: expectedIdentity,
    qualification_identity_digest: qualificationIdentityDigest(expectedIdentity),
    retention: {
      policy: asNonEmptyString(retention.policy) || "run-retained",
      expires_at: expiresAt || null,
    },
    redaction: { state: redactionState },
  };
  return { ok: issues.length === 0, issues, entry };
}

export const QUALIFICATION_IDENTITY_FIELDS = IDENTITY_FIELDS;
