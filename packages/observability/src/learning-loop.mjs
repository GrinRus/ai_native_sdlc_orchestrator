import fs from "node:fs";
import path from "node:path";

import { validateContractDocument } from "../../contracts/src/index.mjs";

const INCIDENT_REPORT_REGEX = /^incident-report-.*\.json$/;
const DEFAULT_BACKLOG_REFS = Object.freeze([
  "docs/backlog/mvp-implementation-backlog.md",
  "docs/backlog/wave-5-implementation-slices.md",
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
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
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
 * @param {string[]} values
 * @returns {string[]}
 */
function uniqueStrings(values) {
  return Array.from(new Set(values.filter((value) => typeof value === "string" && value.length > 0)));
}

/**
 * @param {string} projectRoot
 * @param {string} value
 * @returns {string}
 */
function toEvidenceRef(projectRoot, value) {
  if (value.startsWith("evidence://")) {
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
 * @param {string[]} refs
 * @returns {string[]}
 */
function normalizeEvidenceRefs(projectRoot, refs) {
  return uniqueStrings(refs.map((ref) => toEvidenceRef(projectRoot, ref)));
}

/**
 * @param {string[]} refs
 * @returns {string[]}
 */
function collectHarnessCaptureRefs(refs) {
  return refs.filter((ref) => {
    const normalized = ref.toLowerCase();
    return normalized.includes("harness-capture") || normalized.includes("harness-replay");
  });
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeRunStatus(value) {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (raw === "success" || raw === "passed") return "pass";
  if (raw === "failed") return "fail";
  if (raw === "aborted") return "aborted";
  if (raw === "running") return "running";
  return raw.length > 0 ? raw : "unknown";
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
 * @param {string} candidate
 * @returns {string | null}
 */
function normalizeRunRef(candidate) {
  if (candidate.startsWith("run://")) {
    return candidate.slice("run://".length);
  }
  return candidate;
}

/**
 * @param {Record<string, unknown>} incident
 * @param {string} runId
 * @returns {boolean}
 */
function incidentLinksRun(incident, runId) {
  const linkedRuns = asStringArray(incident.linked_run_refs).map((ref) => normalizeRunRef(ref) ?? "");
  return linkedRuns.includes(runId);
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
 * @param {{
 *   projectId: string,
 *   projectRoot: string,
 *   runtimeLayout: { reportsRoot: string },
 *   runId: string,
 *   sourceKind: string,
 *   runStatus: string,
 *   summary?: string | null,
 *   evidenceRefs?: string[],
 *   linkedScorecardRefs?: string[],
 *   evalSuiteRefs?: string[],
 *   backlogRefs?: string[],
 *   incidentId?: string,
 *   incidentSeverity?: string,
 *   incidentSummary?: string,
 *   incidentStatus?: string,
 *   forceIncident?: boolean,
 *   timestamp?: string,
 * }} options
 */
export function materializeLearningLoopArtifacts(options) {
  const generatedAt = options.timestamp ?? nowIso();
  const runStatus = normalizeRunStatus(options.runStatus);
  const evidenceRefs = normalizeEvidenceRefs(options.projectRoot, asStringArray(options.evidenceRefs));
  const linkedScorecardRefs = normalizeEvidenceRefs(options.projectRoot, asStringArray(options.linkedScorecardRefs));
  const evalSuiteRefs = uniqueStrings(asStringArray(options.evalSuiteRefs));
  const backlogRefs = uniqueStrings([
    ...asStringArray(options.backlogRefs),
    ...(asStringArray(options.backlogRefs).length === 0 ? DEFAULT_BACKLOG_REFS : []),
  ]);
  const harnessRefs = uniqueStrings(collectHarnessCaptureRefs([...evidenceRefs, ...linkedScorecardRefs]));

  const scorecard = {
    scorecard_id: `${options.runId}.learning-loop.scorecard.v1`,
    project_id: options.projectId,
    run_id: options.runId,
    source_kind: options.sourceKind,
    status: runStatus,
    summary: options.summary ?? null,
    evidence_refs: evidenceRefs,
    linked_scorecard_refs: linkedScorecardRefs,
    linked_eval_suite_refs: evalSuiteRefs,
    linked_harness_capture_refs: harnessRefs,
    linked_backlog_refs: backlogRefs,
    generated_at: generatedAt,
  };
  const scorecardFile = path.join(
    options.runtimeLayout.reportsRoot,
    `learning-loop-scorecard-${normalizeId(options.sourceKind)}-${normalizeId(options.runId)}.json`,
  );
  writeJson(scorecardFile, scorecard);
  const scorecardRef = toEvidenceRef(options.projectRoot, scorecardFile);

  const shouldCreateIncident =
    options.forceIncident === true ||
    (options.forceIncident !== false && (runStatus === "fail" || runStatus === "aborted"));

  let incident = null;
  let incidentFile = null;
  let incidentRef = null;

  const incidentId =
    options.incidentId ??
    `${options.projectId}.incident.${normalizeId(options.runId)}.${generatedAt.replace(/[^0-9]/g, "").slice(-12)}`;
  const handoffFile = path.join(
    options.runtimeLayout.reportsRoot,
    shouldCreateIncident
      ? `learning-loop-handoff-${normalizeId(options.runId)}-${normalizeId(incidentId)}.json`
      : `learning-loop-handoff-${normalizeId(options.runId)}.json`,
  );
  const handoffRef = toEvidenceRef(options.projectRoot, handoffFile);

  if (shouldCreateIncident) {
    incident = {
      incident_id: incidentId,
      project_id: options.projectId,
      severity: options.incidentSeverity ?? (runStatus === "aborted" ? "medium" : "high"),
      summary: options.incidentSummary ?? options.summary ?? `Run '${options.runId}' ended with status '${runStatus}'.`,
      linked_run_refs: [`run://${options.runId}`],
      linked_asset_refs: uniqueStrings([...evidenceRefs, scorecardRef, ...linkedScorecardRefs]),
      status: options.incidentStatus ?? "open",
      linked_eval_suite_refs: evalSuiteRefs,
      linked_harness_capture_refs: harnessRefs,
      linked_backlog_refs: backlogRefs,
      evidence_root: options.runtimeLayout.reportsRoot,
      learning_handoff_ref: handoffRef,
      created_at: generatedAt,
    };

    const validation = validateContractDocument({
      family: "incident-report",
      document: incident,
      source: "runtime://incident-report",
    });
    if (!validation.ok) {
      const issues = validation.issues.map((issue) => issue.message).join("; ");
      throw new Error(`Generated incident-report failed contract validation: ${issues}`);
    }

    incidentFile = path.join(
      options.runtimeLayout.reportsRoot,
      `incident-report-${normalizeId(incidentId)}.json`,
    );
    writeJson(incidentFile, incident);
    incidentRef = toEvidenceRef(options.projectRoot, incidentFile);
  }

  const handoff = {
    handoff_id: `${options.runId}.learning-loop.handoff.v1`,
    project_id: options.projectId,
    run_id: options.runId,
    run_status: runStatus,
    source_kind: options.sourceKind,
    scorecard_ref: scorecardRef,
    incident_ref: incidentRef,
    backlog_refs: backlogRefs,
    quality_refs: evalSuiteRefs,
    evidence_refs: uniqueStrings([...evidenceRefs, scorecardRef, ...(incidentRef ? [incidentRef] : [])]),
    next_actions: [
      "Review learning-loop artifacts and incident context.",
      "Map follow-up work into docs/backlog/mvp-implementation-backlog.md and the owning wave slice.",
      "Update eval suites or harness captures before re-enabling risky write-back paths.",
    ],
    generated_at: generatedAt,
  };
  writeJson(handoffFile, handoff);

  return {
    scorecard,
    scorecardFile,
    scorecardRef,
    incident,
    incidentFile,
    incidentRef,
    handoff,
    handoffFile,
    handoffRef,
  };
}

/**
 * @param {{ projectRoot: string, runtimeLayout: { reportsRoot?: string, reports_root?: string }, runId?: string }} options
 */
export function listIncidentReports(options) {
  const reportsRoot = resolveReportsRoot(options.runtimeLayout);
  if (!reportsRoot || !fs.existsSync(reportsRoot)) {
    return [];
  }

  const runId = typeof options.runId === "string" && options.runId.trim().length > 0 ? options.runId.trim() : null;
  const files = fs
    .readdirSync(reportsRoot)
    .filter((entry) => INCIDENT_REPORT_REGEX.test(entry))
    .map((entry) => path.join(reportsRoot, entry))
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);

  /** @type {Array<{ file: string, artifact_ref: string, document: Record<string, unknown> }>} */
  const reports = [];
  for (const filePath of files) {
    try {
      const document = /** @type {Record<string, unknown>} */ (JSON.parse(fs.readFileSync(filePath, "utf8")));
      const validation = validateContractDocument({
        family: "incident-report",
        document,
        source: `runtime://${path.basename(filePath)}`,
      });
      if (!validation.ok) {
        continue;
      }
      if (runId && !incidentLinksRun(document, runId)) {
        continue;
      }
      reports.push({
        file: filePath,
        artifact_ref: toEvidenceRef(options.projectRoot, filePath),
        document,
      });
    } catch {
      // Ignore malformed or partially written files.
    }
  }

  return reports;
}

/**
 * @param {{
 *   projectRoot: string,
 *   runtimeLayout: { reportsRoot?: string, reports_root?: string },
 *   incidentId: string,
 *   decision: "recertify" | "hold" | "re-enable",
 *   nextStatus: string,
 *   runRef?: string,
 *   reason?: string,
 *   promotionDecisionRef?: string,
 *   promotionDecisionStatus?: string,
 *   evidenceRefs?: string[],
 *   timestamp?: string,
 * }} options
 */
export function applyIncidentRecertification(options) {
  const reports = listIncidentReports({
    projectRoot: options.projectRoot,
    runtimeLayout: options.runtimeLayout,
  });
  const target = reports.find((entry) => entry.document.incident_id === options.incidentId);
  if (!target) {
    throw new Error(`Incident '${options.incidentId}' was not found.`);
  }

  const updatedAt = options.timestamp ?? nowIso();
  const fromStatus = typeof target.document.status === "string" ? target.document.status : "open";
  const evidenceRoot = resolveReportsRoot(options.runtimeLayout) ?? options.projectRoot;
  const normalizedEvidenceRefs = normalizeEvidenceRefs(options.projectRoot, asStringArray(options.evidenceRefs));
  const linkedAssetRefs = normalizeEvidenceRefs(options.projectRoot, [
    ...asStringArray(target.document.linked_asset_refs),
    ...normalizedEvidenceRefs,
  ]);
  const recertification = {
    decision: options.decision,
    from_status: fromStatus,
    to_status: options.nextStatus,
    run_ref: options.runRef ?? null,
    promotion_decision_ref: options.promotionDecisionRef ?? null,
    promotion_decision_status: options.promotionDecisionStatus ?? null,
    evidence_refs: linkedAssetRefs,
    evidence_root: evidenceRoot,
    reason: options.reason ?? null,
    updated_at: updatedAt,
  };

  const updatedIncident = {
    ...target.document,
    status: options.nextStatus,
    linked_asset_refs: linkedAssetRefs,
    recertification,
    recertification_updated_at: updatedAt,
  };
  const validation = validateContractDocument({
    family: "incident-report",
    document: updatedIncident,
    source: "runtime://incident-report-recertify",
  });
  if (!validation.ok) {
    const issues = validation.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Generated incident recertification update failed contract validation: ${issues}`);
  }

  writeJson(target.file, updatedIncident);

  return {
    incident: updatedIncident,
    incidentFile: target.file,
    incidentRef: target.artifact_ref,
    recertification,
  };
}
