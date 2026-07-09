import fs from "node:fs";
import path from "node:path";

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function asString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function asStringArray(value) {
  return Array.isArray(value)
    ? value.filter((entry) => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim())
    : [];
}

/**
 * @param {string} value
 * @returns {string}
 */
function toPosix(value) {
  return value.replace(/\\/g, "/");
}

/**
 * @param {string | null} value
 * @returns {string}
 */
function normalizeRef(value) {
  return typeof value === "string" ? toPosix(value.trim()) : "";
}

/**
 * @param {string} rawRef
 * @returns {string}
 */
function refBasename(rawRef) {
  const normalized = normalizeRef(rawRef)
    .replace(/^packet:\/\/[^@]+@/u, "")
    .replace(/^evidence:\/\//u, "")
    .replace(/^file:\/\//u, "");
  return path.posix.basename(normalized) || normalized || "artifact";
}

/**
 * @param {string} value
 * @returns {string}
 */
function titleFromSlug(value) {
  return value
    .replace(/\.json$/u, "")
    .replace(/[-_.]+/gu, " ")
    .replace(/\b\w/gu, (match) => match.toUpperCase())
    .trim();
}

const FAMILY_TYPE = Object.freeze({
  "artifact-packet": "packet",
  "wave-ticket": "planning",
  "handoff-packet": "handoff",
  "delivery-plan": "delivery-plan",
  "delivery-manifest": "delivery-manifest",
  "release-packet": "release-packet",
  "promotion-decision": "promotion-decision",
  "step-result": "routed-step-result",
  "validation-report": "verification",
  "evaluation-report": "evaluation",
  "review-report": "review-report",
  "review-decision": "review-decision",
  "quality-repair-request": "quality-repair-request",
  "runtime-harness-report": "runtime-harness-report",
  "multirepo-coordination-status": "delivery",
  "compiler-revision-status": "learning",
  "incident-report": "incident",
  "incident-backfill-proposal": "incident",
  "learning-loop-scorecard": "learning",
  "learning-loop-handoff": "learning-handoff",
  "run-control-audit": "command-trace",
  "run-control-state": "command-trace",
  "next-action-report": "next-action",
  "operator-request": "operator-request",
});

const FAMILY_STAGE = Object.freeze({
  "artifact-packet": "mission",
  "wave-ticket": "planning",
  "handoff-packet": "planning",
  "delivery-plan": "delivery",
  "delivery-manifest": "delivery",
  "release-packet": "delivery",
  "promotion-decision": "review",
  "step-result": "execution",
  "validation-report": "verification",
  "evaluation-report": "verification",
  "review-report": "review",
  "review-decision": "review",
  "quality-repair-request": "runtime-harness",
  "runtime-harness-report": "runtime-harness",
  "multirepo-coordination-status": "delivery",
  "compiler-revision-status": "learning",
  "incident-report": "delivery",
  "incident-backfill-proposal": "delivery",
  "learning-loop-scorecard": "learning",
  "learning-loop-handoff": "learning",
  "run-control-audit": "execution",
  "run-control-state": "execution",
  "next-action-report": "planning",
  "operator-request": "planning",
});

const FAMILY_LABEL = Object.freeze({
  "artifact-packet": "Artifact Packet",
  "wave-ticket": "Wave Ticket",
  "handoff-packet": "Handoff Packet",
  "delivery-plan": "Delivery Plan",
  "delivery-manifest": "Delivery Manifest",
  "release-packet": "Release Packet",
  "promotion-decision": "Promotion Decision",
  "step-result": "Routed Step Result",
  "validation-report": "Validation Report",
  "evaluation-report": "Evaluation Report",
  "review-report": "Review Report",
  "review-decision": "Review Decision",
  "quality-repair-request": "Repair Request",
  "runtime-harness-report": "Runtime Harness Report",
  "multirepo-coordination-status": "Multirepo Coordination Status",
  "compiler-revision-status": "Compiler Revision Status",
  "incident-report": "Incident Report",
  "incident-backfill-proposal": "Incident Backfill Proposal",
  "learning-loop-scorecard": "Learning Scorecard",
  "learning-loop-handoff": "Learning Handoff",
  "run-control-audit": "Command Trace",
  "run-control-state": "Run Control State",
  "next-action-report": "Next Action Report",
  "operator-request": "Operator Request",
});

const TYPE_LABEL = Object.freeze({
  packet: "Artifact Packet",
  planning: "Planning Artifact",
  handoff: "Handoff Packet",
  "delivery-plan": "Delivery Plan",
  "delivery-manifest": "Delivery Manifest",
  "release-packet": "Release Packet",
  "promotion-decision": "Promotion Decision",
  "routed-step-result": "Routed Step Result",
  verification: "Verification Summary",
  evaluation: "Evaluation Report",
  "review-report": "Review Report",
  "review-decision": "Review Decision",
  "quality-repair-request": "Repair Request",
  "runtime-harness-report": "Runtime Harness Report",
  delivery: "Delivery Artifact",
  learning: "Learning Artifact",
  "learning-handoff": "Learning Handoff",
  "command-trace": "Command Trace",
  "step-observation": "Step Observation",
  "next-action": "Next Action Report",
  "operator-request": "Operator Request",
  "provider-raw-evidence": "Provider Evidence",
  "target-diff": "Target Diff",
  evidence: "Evidence Artifact",
  file: "Evidence Artifact",
});

/**
 * @param {string | null} status
 * @returns {string}
 */
function severityForStatus(status) {
  const normalized = (status ?? "").toLowerCase();
  if (["fail", "failed", "not_pass", "blocked", "rejected", "error", "timeout", "missing", "unreadable"].includes(normalized)) {
    return "critical";
  }
  if (["warn", "warning", "hold", "repair", "partial", "stale", "pending", "waiting", "awaiting-decision"].includes(normalized)) {
    return "warning";
  }
  if (["pass", "passed", "ready", "complete", "completed", "success", "accepted", "approved", "submitted", "exit-0"].includes(normalized)) {
    return "success";
  }
  return "info";
}

/**
 * @param {string | null} family
 * @param {string} rawRef
 * @returns {string}
 */
function inferType(family, rawRef) {
  if (family && FAMILY_TYPE[family]) return FAMILY_TYPE[family];
  const normalized = normalizeRef(rawRef).toLowerCase();
  if (normalized.includes("next-action")) return "next-action";
  if (normalized.includes("command-trace") || normalized.includes("transcript")) return "command-trace";
  if (normalized.includes("step-observation") || normalized.includes("observation-report")) return "step-observation";
  if (normalized.includes("agent-decision-request") || normalized.includes("operator-decision-request")) return "operator-request";
  if (normalized.includes("runtime-harness-report")) return "runtime-harness-report";
  if (normalized.includes("quality-repair-request")) return "quality-repair-request";
  if (normalized.includes("step-result")) return "routed-step-result";
  if (normalized.includes("adapter-live") || (normalized.includes("provider") && (normalized.includes("raw") || normalized.includes("evidence")))) return "provider-raw-evidence";
  if (normalized.includes("verify-summary") || normalized.includes("verification-summary")) return "verification";
  if (normalized.includes("target-diff") || normalized.includes("diff-summary") || normalized.includes("target-cleanliness")) return "target-diff";
  if (normalized.includes("delivery-manifest")) return "delivery-manifest";
  if (normalized.includes("release-packet")) return "release-packet";
  if (normalized.includes("learning-loop-handoff")) return "learning-handoff";
  if (normalized.startsWith("packet://")) return "packet";
  if (normalized.startsWith("evidence://")) return "evidence";
  return "file";
}

/**
 * @param {string | null} family
 * @param {string} type
 * @param {string} rawRef
 * @returns {string}
 */
function inferStage(family, type, rawRef) {
  if (family && FAMILY_STAGE[family]) return FAMILY_STAGE[family];
  const normalized = normalizeRef(rawRef).toLowerCase();
  if (type === "next-action") return "planning";
  if (["provider-raw-evidence", "command-trace", "step-observation", "routed-step-result"].includes(type)) return "execution";
  if (["runtime-harness-report", "review-report", "review-decision", "quality-repair-request"].includes(type)) return "review";
  if (["verification", "target-diff"].includes(type)) return "verification";
  if (["delivery-manifest", "release-packet", "delivery"].includes(type)) return "delivery";
  if (["learning", "learning-handoff"].includes(type)) return "learning";
  if (normalized.includes("intake") || normalized.includes("mission")) return "mission";
  return "artifact";
}

/**
 * @param {Record<string, unknown>} document
 * @returns {string | null}
 */
function statusFromDocument(document) {
  return (
    asString(document.status) ??
    asString(document.overall_status) ??
    asString(document.overall_decision) ??
    asString(document.decision) ??
    asString(document.review_recommendation) ??
    asString(document.delivery_status) ??
    asString(document.release_status) ??
    null
  );
}

/**
 * @param {Record<string, unknown>} document
 * @returns {string | null}
 */
function timestampFromDocument(document) {
  return (
    asString(document.created_at) ??
    asString(document.updated_at) ??
    asString(document.decided_at) ??
    asString(document.finished_at) ??
    asString(document.started_at) ??
    null
  );
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function looksLikeTechnicalIdentifier(value) {
  const text = asString(value);
  if (!text) return false;
  return (
    text.length > 72 ||
    /(?:^\/|\.aor\/|evidence:\/\/|packet:\/\/|\.json$|run[._-]|\.v\d+$|[a-f0-9]{7,})/iu.test(text) ||
    /[a-z0-9]+[._-][a-z0-9]+[._-][a-z0-9]+[._-][a-z0-9]+/iu.test(text)
  );
}

/**
 * @param {unknown[]} values
 * @returns {string | null}
 */
function firstHumanLabel(values) {
  for (const value of values) {
    const label = asString(value);
    if (label && !looksLikeTechnicalIdentifier(label)) {
      return label;
    }
  }
  return null;
}

/**
 * @param {Record<string, unknown>} document
 * @param {string | null} family
 * @param {string} rawRef
 * @returns {string}
 */
function labelFromDocument(document, family, rawRef) {
  const explicitLabel = firstHumanLabel([document.title, document.name, document.label]);
  if (explicitLabel) return explicitLabel;

  if (family && FAMILY_LABEL[family]) return FAMILY_LABEL[family];

  const inferredType = inferType(family, rawRef);
  if (TYPE_LABEL[inferredType]) return TYPE_LABEL[inferredType];

  const documentIdentifier = firstHumanLabel([
    document.packet_id,
    document.request_id,
    document.step_result_id,
    document.report_id,
    document.review_report_id,
    document.decision_id,
    document.manifest_id,
    document.plan_id,
    document.handoff_id,
    document.scorecard_id,
    document.event_id,
  ]);
  return documentIdentifier ?? titleFromSlug(refBasename(rawRef));
}

/**
 * @param {Record<string, unknown>} document
 * @param {string} type
 * @param {string} status
 * @returns {string}
 */
function descriptionFromDocument(document, type, status) {
  const findings = asStringArray(document.findings);
  const runFindings = asStringArray(document.run_findings);
  return (
    asString(document.summary) ??
    asString(document.title) ??
    asString(document.request_summary) ??
    asString(document.reason) ??
    findings[0] ??
    runFindings[0] ??
    `${titleFromSlug(type)} artifact is ${status || "available"}.`
  );
}

/**
 * @param {string | null} filePath
 * @returns {string | null}
 */
function timestampFromFile(filePath) {
  if (!filePath) return null;
  try {
    return new Date(fs.statSync(filePath).mtimeMs).toISOString();
  } catch {
    return null;
  }
}

/**
 * @param {{
 *   family?: string | null,
 *   file?: string | null,
 *   artifactRef?: string | null,
 *   sourceRef?: string | null,
 *   rawRef?: string | null,
 *   document?: Record<string, unknown>,
 *   status?: string | null,
 *   stage?: string | null,
 *   type?: string | null,
 *   label?: string | null,
 *   description?: string | null,
 *   timestamp?: string | null,
 * }} options
 */
export function buildArtifactDisplaySummary(options) {
  const family = asString(options.family);
  const document = asRecord(options.document);
  const rawRef =
    asString(options.rawRef) ??
    asString(options.artifactRef) ??
    asString(options.sourceRef) ??
    asString(options.file) ??
    "artifact://unknown";
  const type = asString(options.type) ?? inferType(family, rawRef);
  const stage = asString(options.stage) ?? inferStage(family, type, rawRef);
  const status = asString(options.status) ?? statusFromDocument(document) ?? "ready";
  const label = asString(options.label) ?? labelFromDocument(document, family, rawRef);
  const description = asString(options.description) ?? descriptionFromDocument(document, type, status);
  const timestamp = asString(options.timestamp) ?? timestampFromDocument(document) ?? timestampFromFile(asString(options.file));
  const sourceRef = asString(options.sourceRef) ?? asString(options.artifactRef) ?? rawRef;

  return {
    type,
    stage,
    label,
    status,
    severity: severityForStatus(status),
    description,
    timestamp,
    source_ref: sourceRef,
    raw_ref: rawRef,
    actions: [
      {
        action_id: "copy_raw_ref",
        label: "Copy raw ref",
        kind: "debug",
      },
      {
        action_id: "inspect_debug",
        label: "Inspect debug details",
        kind: "debug",
      },
    ],
  };
}

/**
 * @param {string | null | undefined} rawRef
 * @param {{ reason?: string, stage?: string | null, type?: string | null }} [options]
 */
export function buildMissingArtifactDisplaySummary(rawRef, options = {}) {
  const ref = asString(rawRef) ?? "artifact://missing";
  const type = asString(options.type) ?? inferType(null, ref);
  return buildArtifactDisplaySummary({
    rawRef: ref,
    type,
    stage: asString(options.stage) ?? inferStage(null, type, ref),
    status: "missing",
    label: `${titleFromSlug(type)} missing`,
    description: asString(options.reason) ?? "Artifact ref is listed, but the current read model could not resolve it.",
  });
}

/**
 * @param {Array<Record<string, unknown> | null | undefined>} summaries
 * @returns {Array<Record<string, unknown>>}
 */
export function uniqueArtifactDisplaySummaries(summaries) {
  const seen = new Set();
  const unique = [];
  for (const summary of summaries) {
    const normalized = asRecord(summary);
    const rawRef = asString(normalized.raw_ref);
    if (!rawRef) continue;
    const key = normalizeRef(rawRef).toLowerCase();
    if (seen.has(key)) continue;
    unique.push(normalized);
    seen.add(key);
  }
  return unique;
}
