import fs from "node:fs";
import path from "node:path";

import { validateContractDocument } from "../../contracts/src/index.mjs";

const REVIEW_DECISION_REGEX = /^review-decision-.*\.json$/;
const REVIEW_DECISIONS = new Set(["approve", "hold", "request-repair"]);

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
 * @param {{
 *   decision: "approve" | "hold" | "request-repair",
 *   reviewReport: Record<string, unknown>,
 *   runtimeHarnessReport: Record<string, unknown>,
 * }} options
 * @returns {{ status: "pass" | "blocked", blocksDownstream: boolean, findings: string[] }}
 */
function evaluateDecisionGate(options) {
  const reviewStatus = asString(options.reviewReport.overall_status) ?? "unknown";
  const runtimeDecision = asString(options.runtimeHarnessReport.overall_decision) ?? "unknown";

  if (options.decision === "hold") {
    return {
      status: "blocked",
      blocksDownstream: true,
      findings: ["Review decision is hold; delivery and release approval is intentionally blocked."],
    };
  }

  if (options.decision === "request-repair") {
    return {
      status: "blocked",
      blocksDownstream: true,
      findings: ["Review decision requests repair before delivery or release approval."],
    };
  }

  const findings = [];
  if (reviewStatus !== "pass") {
    findings.push(`Cannot approve because review-report overall_status is '${reviewStatus}'.`);
  }
  if (runtimeDecision !== "pass") {
    findings.push(`Cannot approve because Runtime Harness overall_decision is '${runtimeDecision}'.`);
  }

  return {
    status: findings.length === 0 ? "pass" : "blocked",
    blocksDownstream: findings.length > 0,
    findings,
  };
}

/**
 * @param {{
 *   projectId: string,
 *   projectRoot: string,
 *   runtimeLayout: { reportsRoot?: string, reports_root?: string },
 *   runId: string,
 *   decision: "approve" | "hold" | "request-repair",
 *   deciderRef?: string | null,
 *   reason?: string | null,
 *   reviewReport: Record<string, unknown>,
 *   reviewReportRef: string,
 *   runtimeHarnessReport: Record<string, unknown>,
 *   runtimeHarnessReportRef: string,
 *   deliveryManifestRefs?: string[],
 *   learningHandoffRefs?: string[],
 *   evidenceRefs?: string[],
 *   timestamp?: string,
 * }} options
 */
export function materializeReviewDecision(options) {
  if (!REVIEW_DECISIONS.has(options.decision)) {
    throw new Error("Review decision must be approve, hold, or request-repair.");
  }

  const reportsRoot = resolveReportsRoot(options.runtimeLayout);
  if (!reportsRoot) {
    throw new Error("Review decision requires a runtime reports root.");
  }

  const reviewReportRef = toEvidenceRef(options.projectRoot, options.reviewReportRef);
  const runtimeHarnessReportRef = toEvidenceRef(options.projectRoot, options.runtimeHarnessReportRef);
  const deliveryManifestRefs = normalizeEvidenceRefs(options.projectRoot, asStringArray(options.deliveryManifestRefs));
  const learningHandoffRefs = normalizeEvidenceRefs(options.projectRoot, asStringArray(options.learningHandoffRefs));
  const reviewStatus = asString(options.reviewReport.overall_status) ?? "unknown";
  const reviewRecommendation = asString(options.reviewReport.review_recommendation) ?? "unknown";
  const runtimeDecision = asString(options.runtimeHarnessReport.overall_decision) ?? "unknown";
  const generatedAt = options.timestamp ?? nowIso();
  const gate = evaluateDecisionGate({
    decision: options.decision,
    reviewReport: options.reviewReport,
    runtimeHarnessReport: options.runtimeHarnessReport,
  });

  if (options.decision === "approve" && gate.status !== "pass") {
    throw new Error(gate.findings.join(" "));
  }

  const reviewFindings = asRecordArray(options.reviewReport.findings);
  const runtimeFindings = asRecordArray(options.runtimeHarnessReport.run_findings);
  const blockingFindings = [...reviewFindings, ...runtimeFindings]
    .filter((finding) => asString(finding.severity) === "fail")
    .map((finding) => ({
      summary: asString(finding.summary) ?? "Blocking review finding.",
      evidence_refs: asStringArray(finding.evidence_refs),
    }));
  const evidenceRefs = uniqueStrings([
    reviewReportRef,
    runtimeHarnessReportRef,
    ...deliveryManifestRefs,
    ...learningHandoffRefs,
    ...normalizeEvidenceRefs(options.projectRoot, asStringArray(options.evidenceRefs)),
  ]);
  const decisionId = `${options.runId}.review-decision.${options.decision}.${generatedAt.replace(/[:.]/g, "-")}`;
  const document = {
    decision_id: decisionId,
    project_id: options.projectId,
    run_id: options.runId,
    decision: options.decision,
    decider_ref: options.deciderRef ?? "operator://cli",
    reason:
      options.reason ??
      (options.decision === "approve"
        ? "Linked review and Runtime Harness evidence are passing."
        : `Operator selected '${options.decision}' for the linked review evidence.`),
    review_report_ref: reviewReportRef,
    runtime_harness_report_ref: runtimeHarnessReportRef,
    delivery_manifest_refs: deliveryManifestRefs,
    learning_handoff_refs: learningHandoffRefs,
    decision_basis: {
      review_overall_status: reviewStatus,
      review_recommendation: reviewRecommendation,
      runtime_harness_overall_decision: runtimeDecision,
      blocking_findings: blockingFindings,
    },
    delivery_gate: {
      status: gate.status,
      blocks_downstream: gate.blocksDownstream,
      required_downstream_decision: "approve",
      findings: gate.findings,
    },
    evidence_refs: evidenceRefs,
    decided_at: generatedAt,
  };

  const validation = validateContractDocument({
    family: "review-decision",
    document,
    source: "runtime://review-decision",
  });
  if (!validation.ok) {
    const issues = validation.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Generated review-decision failed contract validation: ${issues}`);
  }

  const decisionFile = path.join(
    reportsRoot,
    `review-decision-${normalizeId(options.runId)}-${normalizeId(options.decision)}-${generatedAt.replace(/[^0-9]/g, "").slice(-12)}.json`,
  );
  writeJson(decisionFile, document);

  return {
    decision: document,
    decisionFile,
    decisionRef: toEvidenceRef(options.projectRoot, decisionFile),
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
 * @param {{
 *   projectRoot: string,
 *   runtimeLayout: { reportsRoot?: string, reports_root?: string },
 *   runId?: string,
 * }} options
 */
export function listReviewDecisions(options) {
  const reportsRoot = resolveReportsRoot(options.runtimeLayout);
  if (!reportsRoot || !fs.existsSync(reportsRoot)) {
    return [];
  }
  const runId = typeof options.runId === "string" && options.runId.trim().length > 0 ? options.runId.trim() : null;
  const files = fs
    .readdirSync(reportsRoot)
    .filter((entry) => REVIEW_DECISION_REGEX.test(entry))
    .map((entry) => path.join(reportsRoot, entry))
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);

  /** @type {Array<{ file: string, artifact_ref: string, document: Record<string, unknown> }>} */
  const decisions = [];
  for (const filePath of files) {
    try {
      const document = /** @type {Record<string, unknown>} */ (JSON.parse(fs.readFileSync(filePath, "utf8")));
      const validation = validateContractDocument({
        family: "review-decision",
        document,
        source: `runtime://${path.basename(filePath)}`,
      });
      if (!validation.ok) continue;
      if (runId && document.run_id !== runId) continue;
      decisions.push({
        file: filePath,
        artifact_ref: toEvidenceRef(options.projectRoot, filePath),
        document,
      });
    } catch {
      // Ignore malformed or partially written decision files.
    }
  }

  return decisions;
}
