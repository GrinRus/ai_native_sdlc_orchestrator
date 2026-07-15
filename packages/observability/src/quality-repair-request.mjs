import fs from "node:fs";
import path from "node:path";

import { derivePublicId, validateContractDocument } from "../../contracts/src/index.mjs";

const QUALITY_REPAIR_REQUEST_REGEX = /^quality-repair-request-.*\.json$/;
const QUALITY_REPAIR_STATUSES = new Set([
  "requested",
  "in-progress",
  "review-required",
  "qa-required",
  "budget-exhausted",
  "closed",
]);

/**
 * @returns {string}
 */
function nowIso() {
  return new Date().toISOString();
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeId(value) {
  const normalized = [];
  let previousWasDash = false;
  for (const character of value.toLowerCase()) {
    const code = character.charCodeAt(0);
    const allowed =
      (code >= 97 && code <= 122) ||
      (code >= 48 && code <= 57) ||
      character === "." ||
      character === "_" ||
      character === "-";
    const next = allowed ? character : "-";
    if (next === "-" && (previousWasDash || normalized.length === 0)) {
      previousWasDash = true;
      continue;
    }
    normalized.push(next);
    previousWasDash = next === "-";
  }
  while (normalized.at(-1) === "-") {
    normalized.pop();
  }
  return normalized.join("");
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value)
    : {};
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
 * @param {unknown[]} values
 * @returns {string[]}
 */
function uniqueStrings(values) {
  return Array.from(
    new Set(values.filter((value) => typeof value === "string" && value.trim().length > 0).map((value) => value.trim())),
  );
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function asNonNegativeInteger(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
}

/**
 * @param {string} projectRoot
 * @param {string} value
 * @returns {string}
 */
function toEvidenceRef(projectRoot, value) {
  if (value.startsWith("evidence://") || value.startsWith("packet://")) {
    return value;
  }
  if (path.isAbsolute(value)) {
    const relative = path.relative(projectRoot, value).replace(/\\/g, "/");
    if (relative.length > 0 && !relative.startsWith("../")) {
      return `evidence://${relative}`;
    }
  }
  return `evidence://${value.replace(/\\/g, "/")}`;
}

/**
 * @param {string} projectRoot
 * @param {unknown} refs
 * @returns {string[]}
 */
function normalizeEvidenceRefs(projectRoot, refs) {
  return uniqueStrings(asStringArray(refs).map((ref) => toEvidenceRef(projectRoot, ref)));
}

/**
 * @param {{ reportsRoot?: unknown, reports_root?: unknown }} runtimeLayout
 * @returns {string | null}
 */
function resolveReportsRoot(runtimeLayout) {
  if (typeof runtimeLayout.reportsRoot === "string" && runtimeLayout.reportsRoot.trim().length > 0) {
    return runtimeLayout.reportsRoot;
  }
  if (typeof runtimeLayout.reports_root === "string" && runtimeLayout.reports_root.trim().length > 0) {
    return runtimeLayout.reports_root;
  }
  return null;
}

/**
 * @param {string} filePath
 * @param {Record<string, unknown>} document
 */
function writeJson(filePath, document) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
}

/**
 * @param {string} status
 * @param {string} sourceStage
 * @returns {string[]}
 */
function defaultBlockers(status, sourceStage) {
  if (status === "closed") return [];
  if (status === "budget-exhausted") {
    return ["repair-budget-exhausted", "operator-approval-required-before-delivery"];
  }
  if (status === "qa-required") {
    return ["qa-closure-required-before-delivery"];
  }
  return [
    sourceStage === "qa"
      ? "delivery-blocked-until-post-repair-review-and-qa"
      : "delivery-blocked-until-post-repair-review",
  ];
}

/**
 * @param {Record<string, unknown>} request
 * @param {string} requestRef
 * @returns {Record<string, unknown>}
 */
export function buildQualityRepairLineage(request, requestRef) {
  const attemptBudget = asRecord(request.attempt_budget);
  return {
    request_ref: requestRef,
    cycle_id: asString(request.cycle_id) ?? "quality-cycle.unknown",
    source_stage: asString(request.source_stage) ?? "review",
    status: asString(request.status) ?? "requested",
    attempt_index: asNonNegativeInteger(attemptBudget.attempt_index) ?? 1,
    evidence_refs: uniqueStrings([requestRef, ...asStringArray(request.evidence_refs)]),
  };
}

/**
 * @param {{
 *   projectId: string,
 *   projectRoot: string,
 *   runtimeLayout: { reportsRoot?: string, reports_root?: string },
 *   runId: string,
 *   sourceStage?: string | null,
 *   sourceRef?: string | null,
 *   findingRefs?: string[],
 *   repairScope?: Record<string, unknown> | null,
 *   attemptBudget?: Record<string, unknown> | null,
 *   status?: string | null,
 *   blockers?: string[],
 *   evidenceRefs?: string[],
 *   createdAt?: string,
 *   updatedAt?: string | null,
 *   operatorOverrideRef?: string | null,
 * }} options
 */
export function materializeQualityRepairRequest(options) {
  const reportsRoot = resolveReportsRoot(options.runtimeLayout);
  if (!reportsRoot) {
    throw new Error("Quality repair request requires a runtime reports root.");
  }

  const sourceStage = asString(options.sourceStage) === "qa" ? "qa" : "review";
  const status = QUALITY_REPAIR_STATUSES.has(asString(options.status) ?? "")
    ? /** @type {string} */ (asString(options.status))
    : "requested";
  const generatedAt = options.createdAt ?? nowIso();
  const sourceRef = toEvidenceRef(
    options.projectRoot,
    asString(options.sourceRef) ?? `.aor/projects/${options.projectId}/reports/${sourceStage}-repair-source-${normalizeId(options.runId)}.json`,
  );
  const requestId = derivePublicId(
    [options.runId, "quality-repair-request", sourceStage, generatedAt.replace(/[:.]/g, "-").toLowerCase()],
    "quality-repair-request",
  );
  const attemptBudget = asRecord(options.attemptBudget);
  const maxAttempts = asNonNegativeInteger(attemptBudget.max_attempts) ?? 1;
  const attemptIndex = asNonNegativeInteger(attemptBudget.attempt_index) ?? 1;
  const remainingAttempts =
    asNonNegativeInteger(attemptBudget.remaining_attempts) ?? Math.max(maxAttempts - attemptIndex, 0);
  const evidenceRefs = uniqueStrings([
    sourceRef,
    ...normalizeEvidenceRefs(options.projectRoot, options.evidenceRefs),
  ]);
  const repairScope = asRecord(options.repairScope);
  const request = {
    request_id: requestId,
    project_id: options.projectId,
    run_id: options.runId,
    cycle_id: asString(repairScope.cycle_id) ?? `${options.runId}.quality-cycle.${sourceStage}.${attemptIndex}`,
    source_stage: sourceStage,
    source_ref: sourceRef,
    finding_refs: uniqueStrings(asStringArray(options.findingRefs)).length > 0
      ? uniqueStrings(asStringArray(options.findingRefs))
      : [`${requestId}.finding.unspecified`],
    repair_scope: {
      target_step: asString(repairScope.target_step) ?? "implement",
      requested_next_step: asString(repairScope.requested_next_step) ?? "execution",
      allowed_paths: asStringArray(repairScope.allowed_paths),
      verification_refs: normalizeEvidenceRefs(options.projectRoot, repairScope.verification_refs),
      required_evidence_refs: uniqueStrings([
        ...normalizeEvidenceRefs(options.projectRoot, repairScope.required_evidence_refs),
        ...evidenceRefs,
      ]),
      compiled_context_refs: asStringArray(repairScope.compiled_context_refs),
      reason: asString(repairScope.reason) ?? "Resolve the linked quality finding before delivery can continue.",
    },
    attempt_budget: {
      policy_ref: asString(attemptBudget.policy_ref) ?? `project-profile://${options.projectId}#quality_repair_policy`,
      max_attempts: maxAttempts,
      attempt_index: attemptIndex,
      remaining_attempts: remainingAttempts,
    },
    status,
    blockers: uniqueStrings(asStringArray(options.blockers)).length > 0
      ? uniqueStrings(asStringArray(options.blockers))
      : defaultBlockers(status, sourceStage),
    evidence_refs: evidenceRefs,
    status_history: [
      {
        status,
        changed_at: generatedAt,
        summary: status === "requested"
          ? `${sourceStage === "qa" ? "QA" : "Review"} requested a bounded repair cycle.`
          : `Quality repair request entered '${status}'.`,
        evidence_refs: evidenceRefs,
      },
    ],
    created_at: generatedAt,
    updated_at: options.updatedAt ?? generatedAt,
    operator_override_ref: asString(options.operatorOverrideRef),
  };

  const validation = validateContractDocument({
    family: "quality-repair-request",
    document: request,
    source: "runtime://quality-repair-request",
  });
  if (!validation.ok) {
    const issues = validation.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Generated quality-repair-request failed contract validation: ${issues}`);
  }

  const requestFile = path.join(
    reportsRoot,
    `quality-repair-request-${normalizeId(options.runId)}-${sourceStage}-${generatedAt.replace(/[^0-9]/g, "").slice(-12)}.json`,
  );
  writeJson(requestFile, request);
  const requestRef = toEvidenceRef(options.projectRoot, requestFile);

  return {
    request,
    requestFile,
    requestRef,
    lineage: buildQualityRepairLineage(request, requestRef),
  };
}

/**
 * @param {{
 *   projectRoot: string,
 *   runtimeLayout: { reportsRoot?: string, reports_root?: string },
 *   runId?: string,
 * }} options
 */
export function listQualityRepairRequests(options) {
  const reportsRoot = resolveReportsRoot(options.runtimeLayout);
  if (!reportsRoot || !fs.existsSync(reportsRoot)) {
    return [];
  }
  const runId = asString(options.runId);
  const files = fs
    .readdirSync(reportsRoot)
    .filter((entry) => QUALITY_REPAIR_REQUEST_REGEX.test(entry))
    .map((entry) => path.join(reportsRoot, entry))
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);

  /** @type {Array<{ file: string, artifact_ref: string, document: Record<string, unknown> }>} */
  const requests = [];
  for (const filePath of files) {
    try {
      const document = /** @type {Record<string, unknown>} */ (JSON.parse(fs.readFileSync(filePath, "utf8")));
      const validation = validateContractDocument({
        family: "quality-repair-request",
        document,
        source: `runtime://${path.basename(filePath)}`,
      });
      if (!validation.ok) continue;
      if (runId && document.run_id !== runId) continue;
      requests.push({
        file: filePath,
        artifact_ref: toEvidenceRef(options.projectRoot, filePath),
        document,
      });
    } catch {
      // Ignore malformed or partially written request files.
    }
  }
  return requests;
}

/**
 * @param {{
 *   projectRoot: string,
 *   runtimeLayout: { reportsRoot?: string, reports_root?: string },
 *   requestFile?: string,
 *   request?: Record<string, unknown>,
 *   requestId?: string,
 *   status: string,
 *   blockers?: string[],
 *   evidenceRefs?: string[],
 *   summary?: string,
 *   timestamp?: string,
 *   operatorOverrideRef?: string | null,
 * }} options
 */
export function updateQualityRepairRequest(options) {
  const reportsRoot = resolveReportsRoot(options.runtimeLayout);
  if (!reportsRoot) {
    throw new Error("Quality repair request update requires a runtime reports root.");
  }
  if (!QUALITY_REPAIR_STATUSES.has(options.status)) {
    throw new Error("Quality repair request status is not supported.");
  }

  let requestFile = asString(options.requestFile);
  let request = options.request ? { ...options.request } : null;
  if (!request || !requestFile) {
    const requestId = asString(options.requestId);
    const match = listQualityRepairRequests({
      projectRoot: options.projectRoot,
      runtimeLayout: options.runtimeLayout,
    }).find((entry) => !requestId || entry.document.request_id === requestId);
    if (!match) {
      throw new Error("Quality repair request update could not find a matching request.");
    }
    requestFile = match.file;
    request = { ...match.document };
  }

  const changedAt = options.timestamp ?? nowIso();
  const sourceStage = asString(request.source_stage) === "qa" ? "qa" : "review";
  const evidenceRefs = uniqueStrings([
    ...asStringArray(request.evidence_refs),
    ...normalizeEvidenceRefs(options.projectRoot, options.evidenceRefs),
  ]);
  request.status = options.status;
  request.blockers = uniqueStrings(asStringArray(options.blockers)).length > 0
    ? uniqueStrings(asStringArray(options.blockers))
    : defaultBlockers(options.status, sourceStage);
  request.evidence_refs = evidenceRefs;
  request.updated_at = changedAt;
  if (options.status === "closed") {
    request.closed_at = changedAt;
  }
  if (asString(options.operatorOverrideRef)) {
    request.operator_override_ref = asString(options.operatorOverrideRef);
  }
  request.status_history = [
    ...asRecordArray(request.status_history),
    {
      status: options.status,
      changed_at: changedAt,
      summary: options.summary ?? `Quality repair request entered '${options.status}'.`,
      evidence_refs: evidenceRefs,
    },
  ];

  const validation = validateContractDocument({
    family: "quality-repair-request",
    document: request,
    source: "runtime://quality-repair-request",
  });
  if (!validation.ok) {
    const issues = validation.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Updated quality-repair-request failed contract validation: ${issues}`);
  }

  writeJson(requestFile, request);
  const requestRef = toEvidenceRef(options.projectRoot, requestFile);
  return {
    request,
    requestFile,
    requestRef,
    lineage: buildQualityRepairLineage(request, requestRef),
  };
}

/**
 * @param {unknown} value
 * @returns {Array<Record<string, unknown>>}
 */
function asRecordArray(value) {
  return Array.isArray(value)
    ? value.filter((entry) => typeof entry === "object" && entry !== null && !Array.isArray(entry))
    : [];
}

/**
 * @param {Omit<Parameters<typeof updateQualityRepairRequest>[0], "status">} options
 */
export function closeQualityRepairRequest(options) {
  return updateQualityRepairRequest({
    ...options,
    status: "closed",
    blockers: [],
    summary: options.summary ?? "Quality repair request closed by refreshed review and QA evidence.",
  });
}
