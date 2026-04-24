import fs from "node:fs";
import path from "node:path";

import { validateContractDocument } from "../../contracts/src/index.mjs";

const INCIDENT_REPORT_REGEX = /^incident-report-.*\.json$/;
const DEFAULT_BACKLOG_REFS = Object.freeze([
  "docs/backlog/mvp-implementation-backlog.md",
  "docs/backlog/mvp-roadmap.md",
  "docs/ops/live-e2e-standard-runner.md",
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
 *   existingIncidentFile?: string,
 *   existingIncidentRef?: string,
 *   matrixCell?: Record<string, unknown> | null,
 *   coverageFollowUp?: Record<string, unknown> | null,
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
    matrix_cell:
      options.matrixCell && typeof options.matrixCell === "object" && !Array.isArray(options.matrixCell)
        ? options.matrixCell
        : {},
    generated_at: generatedAt,
  };
  const scorecardFile = path.join(
    options.runtimeLayout.reportsRoot,
    `learning-loop-scorecard-${normalizeId(options.sourceKind)}-${normalizeId(options.runId)}.json`,
  );
  const scorecardValidation = validateContractDocument({
    family: "learning-loop-scorecard",
    document: scorecard,
    source: "runtime://learning-loop-scorecard",
  });
  if (!scorecardValidation.ok) {
    const issues = scorecardValidation.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Generated learning-loop-scorecard failed contract validation: ${issues}`);
  }
  writeJson(scorecardFile, scorecard);
  const scorecardRef = toEvidenceRef(options.projectRoot, scorecardFile);

  const shouldCreateIncident =
    options.forceIncident === true ||
    (options.forceIncident !== false && (runStatus === "fail" || runStatus === "aborted"));

  let incident = null;
  let incidentFile =
    typeof options.existingIncidentFile === "string" && options.existingIncidentFile.trim().length > 0
      ? options.existingIncidentFile.trim()
      : null;
  let incidentRef =
    typeof options.existingIncidentRef === "string" && options.existingIncidentRef.trim().length > 0
      ? toEvidenceRef(options.projectRoot, options.existingIncidentRef.trim())
      : incidentFile
        ? toEvidenceRef(options.projectRoot, incidentFile)
        : null;

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
    matrix_cell:
      options.matrixCell && typeof options.matrixCell === "object" && !Array.isArray(options.matrixCell)
        ? options.matrixCell
        : {},
    coverage_follow_up:
      options.coverageFollowUp && typeof options.coverageFollowUp === "object" && !Array.isArray(options.coverageFollowUp)
        ? options.coverageFollowUp
        : {
            current_cell_required: false,
            next_required_matrix_cell: null,
            remaining_required_matrix_cells: [],
          },
    next_actions: [
      "Review learning-loop artifacts and incident context.",
      "Map follow-up work into docs/backlog/mvp-implementation-backlog.md and the owning wave slice.",
      "Update eval suites or harness captures before re-enabling risky write-back paths.",
    ],
    generated_at: generatedAt,
  };
  const handoffValidation = validateContractDocument({
    family: "learning-loop-handoff",
    document: handoff,
    source: "runtime://learning-loop-handoff",
  });
  if (!handoffValidation.ok) {
    const issues = handoffValidation.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Generated learning-loop-handoff failed contract validation: ${issues}`);
  }
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
 *   financeEvidenceRefs?: string[],
 *   qualityEvidenceRefs?: string[],
 *   financeEvidenceRoot?: string,
 *   qualityEvidenceRoot?: string,
 *   platformRecertification?: {
 *     linkage_status?: string,
 *     rollback_required?: boolean,
 *     rollout_action?: string,
 *     promotion_decision_ref?: string,
 *     from_channel?: string,
 *     to_channel?: string,
 *   },
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
  const financeEvidenceRefs = normalizeEvidenceRefs(options.projectRoot, asStringArray(options.financeEvidenceRefs));
  const qualityEvidenceRefs = normalizeEvidenceRefs(options.projectRoot, asStringArray(options.qualityEvidenceRefs));
  const financeEvidenceRoot =
    typeof options.financeEvidenceRoot === "string" && options.financeEvidenceRoot.trim().length > 0
      ? options.financeEvidenceRoot
      : evidenceRoot;
  const qualityEvidenceRoot =
    typeof options.qualityEvidenceRoot === "string" && options.qualityEvidenceRoot.trim().length > 0
      ? options.qualityEvidenceRoot
      : evidenceRoot;
  const linkedAssetRefs = normalizeEvidenceRefs(options.projectRoot, [
    ...asStringArray(target.document.linked_asset_refs),
    ...normalizedEvidenceRefs,
    ...financeEvidenceRefs,
    ...qualityEvidenceRefs,
  ]);
  const platformRecertification =
    options.platformRecertification &&
    typeof options.platformRecertification === "object" &&
    !Array.isArray(options.platformRecertification)
      ? {
          linkage_status:
            typeof options.platformRecertification.linkage_status === "string"
              ? options.platformRecertification.linkage_status
              : null,
          rollback_required: options.platformRecertification.rollback_required === true,
          rollout_action:
            typeof options.platformRecertification.rollout_action === "string"
              ? options.platformRecertification.rollout_action
              : null,
          promotion_decision_ref:
            typeof options.platformRecertification.promotion_decision_ref === "string"
              ? options.platformRecertification.promotion_decision_ref
              : options.promotionDecisionRef ?? null,
          from_channel:
            typeof options.platformRecertification.from_channel === "string"
              ? options.platformRecertification.from_channel
              : null,
          to_channel:
            typeof options.platformRecertification.to_channel === "string"
              ? options.platformRecertification.to_channel
              : null,
        }
      : null;
  const recertification = {
    decision: options.decision,
    from_status: fromStatus,
    to_status: options.nextStatus,
    run_ref: options.runRef ?? null,
    promotion_decision_ref: options.promotionDecisionRef ?? null,
    promotion_decision_status: options.promotionDecisionStatus ?? null,
    evidence_refs: linkedAssetRefs,
    evidence_root: evidenceRoot,
    finance_evidence_refs: financeEvidenceRefs,
    quality_evidence_refs: qualityEvidenceRefs,
    finance_evidence_root: financeEvidenceRoot,
    quality_evidence_root: qualityEvidenceRoot,
    platform_recertification: platformRecertification,
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
