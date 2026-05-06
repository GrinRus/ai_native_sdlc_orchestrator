import fs from "node:fs";
import path from "node:path";

import { validateContractDocument } from "../../contracts/src/index.mjs";
import { initializeProjectRuntime } from "./project-init.mjs";

const ACTIONS = new Set(["inspect", "promote", "freeze", "demote"]);
const COMPATIBILITY_STATUSES = new Set(["compatible", "incompatible", "unknown"]);
const PROMOTION_DECISION_REGEX = /^promotion-decision-.*\.json$/u;
const COMPILER_REVISION_STATUS_REGEX = /^compiler-revision-status-.*\.json$/u;

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
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeForId(value) {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * @param {string[]} values
 * @returns {string[]}
 */
function uniqueStrings(values) {
  return [...new Set(values.filter((entry) => typeof entry === "string" && entry.trim().length > 0))];
}

/**
 * @param {ReturnType<typeof initializeProjectRuntime>} init
 * @param {string} filePath
 * @returns {string}
 */
function toEvidenceRef(init, filePath) {
  return `evidence://${path.relative(init.projectRoot, filePath).replace(/\\/gu, "/")}`;
}

/**
 * @param {string} dirPath
 * @param {RegExp} matcher
 * @returns {string[]}
 */
function listMatchingJsonFiles(dirPath, matcher) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }
  return fs
    .readdirSync(dirPath)
    .filter((entry) => matcher.test(entry))
    .map((entry) => path.join(dirPath, entry))
    .sort();
}

/**
 * @param {string} filePath
 * @returns {Record<string, unknown> | null}
 */
function readJsonObject(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * @param {string} value
 * @returns {{ compiler_revision_ref: string, source_ref: string, revision_id: string, version: number | null, compiler_family: string }}
 */
export function parseCompilerRevisionRef(value) {
  const raw = asString(value);
  if (!raw) {
    throw new Error("compiler revision ref is required.");
  }

  const sourceRef = raw;
  const withoutScheme = raw.replace(/^compiler(?:-revision)?:\/\//u, "");
  const atVersionMatch = /^(.+)@v(\d+)$/u.exec(withoutScheme);
  const dashVersionMatch = /^(.+)-v(\d+)$/u.exec(withoutScheme);
  const match = atVersionMatch ?? dashVersionMatch;
  const revisionId = match ? match[1] : withoutScheme;
  const version = match ? Number.parseInt(match[2], 10) : null;
  const compilerFamily = revisionId.includes("context") ? "runtime-context" : revisionId.split(/[._-]/u)[0] || "compiler";
  const normalizedRef = version !== null
    ? `compiler-revision://${revisionId}@v${version}`
    : `compiler-revision://${revisionId}`;

  return {
    compiler_revision_ref: normalizedRef,
    source_ref: sourceRef,
    revision_id: revisionId,
    version: Number.isFinite(version) ? version : null,
    compiler_family: compilerFamily,
  };
}

/**
 * @param {string} action
 * @param {string | null} fallback
 * @returns {"candidate" | "stable" | "frozen" | "demoted" | "blocked"}
 */
function resolveLifecycleState(action, fallback) {
  if (action === "promote") return "stable";
  if (action === "freeze") return "frozen";
  if (action === "demote") return "demoted";
  if (fallback === "stable" || fallback === "frozen" || fallback === "demoted" || fallback === "blocked") {
    return fallback;
  }
  return "candidate";
}

/**
 * @param {Record<string, unknown>} decision
 * @returns {string | null}
 */
function resolveDecisionLifecycleState(decision) {
  const toChannel = asString(decision.to_channel);
  if (toChannel === "stable" || toChannel === "frozen" || toChannel === "demoted") {
    return toChannel;
  }
  return asString(asRecord(asRecord(decision.evidence_summary).compiler_revision_lifecycle).lifecycle_state);
}

/**
 * @param {{
 *   init: ReturnType<typeof initializeProjectRuntime>,
 *   compilerRevisionRef: string,
 * }} options
 */
function collectDecisionHistory(options) {
  const history = [];
  const promotionFiles = listMatchingJsonFiles(options.init.runtimeLayout.artifactsRoot, PROMOTION_DECISION_REGEX);
  for (const filePath of promotionFiles) {
    const document = readJsonObject(filePath);
    if (!document) continue;
    const evidenceSummary = asRecord(document.evidence_summary);
    const compilerLifecycle = asRecord(evidenceSummary.compiler_revision_lifecycle);
    const subjectRef = asString(document.subject_ref);
    const compilerRef = asString(compilerLifecycle.compiler_revision_ref);
    if (subjectRef !== options.compilerRevisionRef && compilerRef !== options.compilerRevisionRef) {
      continue;
    }

    history.push({
      history_id: asString(document.decision_id) ?? path.basename(filePath, ".json"),
      history_ref: toEvidenceRef(options.init, filePath),
      history_kind: "promotion-decision",
      lifecycle_state: resolveDecisionLifecycleState(document),
      status: asString(document.status),
      created_at: asString(document.created_at) ?? new Date(fs.statSync(filePath).mtimeMs).toISOString(),
    });
  }

  const statusFiles = listMatchingJsonFiles(options.init.runtimeLayout.reportsRoot, COMPILER_REVISION_STATUS_REGEX);
  for (const filePath of statusFiles) {
    const document = readJsonObject(filePath);
    if (!document || asString(document.compiler_revision_ref) !== options.compilerRevisionRef) {
      continue;
    }
    history.push({
      history_id: asString(document.status_id) ?? path.basename(filePath, ".json"),
      history_ref: toEvidenceRef(options.init, filePath),
      history_kind: "compiler-revision-status",
      lifecycle_state: asString(document.lifecycle_state),
      status: asString(document.status),
      created_at: asString(document.created_at) ?? new Date(fs.statSync(filePath).mtimeMs).toISOString(),
    });
  }

  return history.sort((left, right) => String(left.created_at).localeCompare(String(right.created_at)));
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef?: string,
 *   projectProfile?: string,
 *   runtimeRoot?: string,
 *   compilerRevisionRef: string,
 *   action?: "inspect" | "promote" | "freeze" | "demote",
 *   promotionDecisionRef?: string,
 *   compiledContextRefs?: string[],
 *   evaluationRefs?: string[],
 *   incidentRefs?: string[],
 *   certificationEvidenceRefs?: string[],
 *   compatibilityStatus?: "compatible" | "incompatible" | "unknown",
 *   now?: string,
 * }} options
 */
export function materializeCompilerRevisionStatus(options) {
  const init = initializeProjectRuntime(options);
  const action = options.action ?? "inspect";
  if (!ACTIONS.has(action)) {
    throw new Error(`Invalid compiler revision action '${action}'. Expected one of: ${[...ACTIONS].join(", ")}.`);
  }

  const parsed = parseCompilerRevisionRef(options.compilerRevisionRef);
  const compatibilityStatus = COMPATIBILITY_STATUSES.has(options.compatibilityStatus ?? "")
    ? /** @type {"compatible" | "incompatible" | "unknown"} */ (options.compatibilityStatus)
    : "unknown";
  const promotionDecisionRefs = uniqueStrings([options.promotionDecisionRef ?? ""]);
  const compiledContextRefs = uniqueStrings(options.compiledContextRefs ?? []);
  const evaluationRefs = uniqueStrings(options.evaluationRefs ?? []);
  const incidentRefs = uniqueStrings(options.incidentRefs ?? []);
  const certificationEvidenceRefs = uniqueStrings([
    ...promotionDecisionRefs,
    ...(options.certificationEvidenceRefs ?? []),
  ]);
  const previousHistory = collectDecisionHistory({
    init,
    compilerRevisionRef: parsed.compiler_revision_ref,
  });
  const latestLifecycleState =
    previousHistory.length > 0 ? asString(previousHistory[previousHistory.length - 1].lifecycle_state) : null;
  const blockingReasons = [];
  if (action !== "inspect" && promotionDecisionRefs.length === 0) {
    blockingReasons.push("promotion-decision-required");
  }
  if (compatibilityStatus === "incompatible") {
    blockingReasons.push("compiler-revision-incompatible");
  }

  const lifecycleState = blockingReasons.length > 0
    ? "blocked"
    : resolveLifecycleState(action, latestLifecycleState);
  const createdAt = options.now ?? new Date().toISOString();
  const statusId = `compiler-revision-status-${normalizeForId(parsed.revision_id)}-${Date.parse(createdAt) || Date.now()}`;
  const statusReport = {
    status_id: statusId,
    project_id: init.projectId,
    compiler_revision_ref: parsed.compiler_revision_ref,
    compiler_revision: {
      revision_id: parsed.revision_id,
      version: parsed.version,
      source_ref: parsed.source_ref,
      compiler_family: parsed.compiler_family,
      provenance_refs: uniqueStrings([...compiledContextRefs, ...certificationEvidenceRefs]),
    },
    lifecycle_state: lifecycleState,
    compatibility: {
      status: compatibilityStatus,
      compiled_context_refs: compiledContextRefs,
      evaluation_refs: evaluationRefs,
      incident_refs: incidentRefs,
      certification_evidence_refs: certificationEvidenceRefs,
    },
    decision_history: previousHistory,
    evidence_links: {
      promotion_decision_refs: promotionDecisionRefs,
      compiled_context_refs: compiledContextRefs,
      evaluation_refs: evaluationRefs,
      incident_refs: incidentRefs,
      certification_evidence_refs: certificationEvidenceRefs,
    },
    status: blockingReasons.length > 0 ? "blocked" : "ready",
    blocking_reasons: blockingReasons,
    created_at: createdAt,
  };

  const validation = validateContractDocument({
    family: "compiler-revision-status",
    document: statusReport,
    source: "runtime://compiler-revision-status",
  });
  if (!validation.ok) {
    const issueSummary = validation.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Generated compiler revision status failed contract validation: ${issueSummary}`);
  }

  const statusPath = path.join(init.runtimeLayout.reportsRoot, `${statusId}.json`);
  fs.writeFileSync(statusPath, `${JSON.stringify(statusReport, null, 2)}\n`, "utf8");
  const statusRef = toEvidenceRef(init, statusPath);

  return {
    ...init,
    report: statusReport,
    statusPath,
    statusRef,
    blocking: blockingReasons.length > 0,
  };
}
