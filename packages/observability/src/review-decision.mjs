import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { validateContractDocument } from "../../contracts/src/index.mjs";
import { materializeQualityRepairRequest } from "./quality-repair-request.mjs";

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
 * @param {unknown} value
 * @returns {unknown}
 */
function stableJsonValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => stableJsonValue(entry));
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableJsonValue(entry)]),
    );
  }
  return value;
}

/**
 * @param {Record<string, unknown>} context
 * @returns {string}
 */
function fingerprintRepairContext(context) {
  const payload = {
    source_phase: asString(context.source_phase) ?? "review",
    unresolved_findings: uniqueStrings(asStringArray(context.unresolved_findings)).sort(),
    unresolved_finding_details: Array.isArray(context.unresolved_finding_details)
      ? context.unresolved_finding_details
          .map((entry) => {
            const record = typeof entry === "object" && entry !== null ? entry : {};
            return {
              finding_id: asString(record.finding_id) ?? "",
              category: asString(record.category) ?? "",
              severity: asString(record.severity) ?? "",
              summary: asString(record.summary) ?? "",
              resolution_requirement: asString(record.resolution_requirement) ?? "",
            };
          })
          .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
      : [],
    meaningful_changed_paths: uniqueStrings(asStringArray(context.meaningful_changed_paths)).sort(),
    verification_status: asString(context.verification_status) ?? "unknown",
    requested_next_step: asString(context.requested_next_step) ?? "execution",
  };
  return `sha256:${createHash("sha256").update(JSON.stringify(stableJsonValue(payload))).digest("hex")}`;
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
 *   decision: "approve" | "hold" | "request-repair",
 *   context?: Record<string, unknown> | null,
 *   defaultVerificationStatus: string,
 *   fallbackFindings?: string[],
 *   fallbackVerificationRefs?: string[],
 *   fallbackFindingDetails?: Array<Record<string, unknown>>,
 * }} options
 * @returns {Record<string, unknown>}
 */
function normalizeRepairContext(options) {
  const context =
    typeof options.context === "object" && options.context !== null && !Array.isArray(options.context)
      ? options.context
      : {};
  if (options.decision !== "request-repair") {
    return {
      source_phase: "none",
      cycle_iteration: 0,
      unresolved_findings: [],
      unresolved_finding_details: [],
      meaningful_changed_paths: [],
      verification_status: options.defaultVerificationStatus || "pass",
      verification_refs: [],
      previous_repair_decision_refs: [],
      context_fingerprint: "none",
      new_context_since_previous: [],
      stop_reason: "none",
      requested_next_step: "none",
    };
  }
  const fallbackFindings = asStringArray(options.fallbackFindings);
  const fallbackVerificationRefs = asStringArray(options.fallbackVerificationRefs);
  const fallbackFindingDetails = asRecordArray(options.fallbackFindingDetails);
  const contextDetails = Array.isArray(context.unresolved_finding_details)
    ? context.unresolved_finding_details
    : [];

  const normalized = {
    source_phase: asString(context.source_phase) ?? "review",
    cycle_iteration:
      typeof context.cycle_iteration === "number" && Number.isInteger(context.cycle_iteration)
        ? context.cycle_iteration
        : 1,
    unresolved_findings: asStringArray(context.unresolved_findings).length > 0
      ? asStringArray(context.unresolved_findings)
      : fallbackFindings,
    unresolved_finding_details: contextDetails.length > 0
      ? contextDetails
      : fallbackFindingDetails.length > 0
        ? fallbackFindingDetails
        : fallbackFindings.map((finding, index) => ({
            finding_id: `fallback.${index + 1}`,
            category: "review",
            severity: "blocking",
            summary: finding,
            evidence_refs: fallbackVerificationRefs,
            resolution_requirement:
              "Address this repair finding in the next public execution iteration or provide fresh evidence that it is stale.",
          })),
    meaningful_changed_paths: asStringArray(context.meaningful_changed_paths),
    verification_status: asString(context.verification_status) ?? options.defaultVerificationStatus ?? "unknown",
    verification_refs: asStringArray(context.verification_refs).length > 0
      ? asStringArray(context.verification_refs)
      : fallbackVerificationRefs,
    previous_repair_decision_refs: asStringArray(context.previous_repair_decision_refs),
    context_fingerprint: asString(context.context_fingerprint) ?? "",
    new_context_since_previous: asStringArray(context.new_context_since_previous),
    stop_reason: asString(context.stop_reason) ?? "Repair requested before delivery.",
    requested_next_step: asString(context.requested_next_step) ?? "execution",
  };
  normalized.context_fingerprint = normalized.context_fingerprint || fingerprintRepairContext(normalized);
  if (
    normalized.previous_repair_decision_refs.length === 0 &&
    normalized.new_context_since_previous.length === 0
  ) {
    normalized.new_context_since_previous = ["first-repair-decision"];
  }
  return normalized;
}

/**
 * @param {Record<string, unknown>} repairContext
 * @returns {string}
 */
function normalizeRepairSourceStage(repairContext) {
  return asString(repairContext.source_phase) === "qa" ? "qa" : "review";
}

/**
 * @param {Array<Record<string, unknown>>} findingDetails
 * @returns {string[]}
 */
function findingRefsFromDetails(findingDetails) {
  return uniqueStrings(
    findingDetails.flatMap((finding) => [
      asString(finding.finding_id),
      ...asStringArray(finding.evidence_refs),
    ]),
  );
}

/**
 * @param {{ findings: Array<Record<string, unknown>>, fallbackEvidenceRefs: string[] }} options
 * @returns {Array<Record<string, unknown>>}
 */
function buildFallbackRepairFindingDetails(options) {
  return options.findings
    .filter((finding) => asString(finding.severity) === "fail")
    .map((finding, index) => {
      const evidenceRefs = uniqueStrings([
        ...asStringArray(finding.evidence_refs),
        ...options.fallbackEvidenceRefs,
      ]);
      const detail = {
        finding_id: asString(finding.finding_id) ?? `fallback.${index + 1}`,
        category: asString(finding.category) ?? "review",
        severity: asString(finding.severity) ?? "blocking",
        summary: asString(finding.summary) ?? "Blocking review finding.",
        evidence_refs: evidenceRefs,
        resolution_requirement:
          asString(finding.resolution_requirement) ??
          "Address this repair finding in the next public execution iteration or provide fresh evidence that it is stale.",
      };
      const verificationFailureDetails = asRecordArray(finding.verification_failure_details);
      if (verificationFailureDetails.length > 0) {
        detail.verification_failure_details = verificationFailureDetails;
      }
      return detail;
    });
}

/**
 * @param {{
 *   projectId: string,
 *   projectRoot: string,
 *   runId: string,
 *   reviewReportRef: string,
 *   runtimeHarnessReportRef: string,
 *   repairContext: Record<string, unknown>,
 *   evidenceRefs: string[],
 *   generatedAt: string,
 * }}
 */
function buildQualityRepairRequestOptions(options) {
  const sourceStage = normalizeRepairSourceStage(options.repairContext);
  const findingDetails = asRecordArray(options.repairContext.unresolved_finding_details);
  const findingRefs = uniqueStrings([
    ...asStringArray(options.repairContext.unresolved_findings),
    ...findingRefsFromDetails(findingDetails),
  ]);
  const verificationRefs = normalizeEvidenceRefs(options.projectRoot, asStringArray(options.repairContext.verification_refs));
  const attemptIndex =
    typeof options.repairContext.cycle_iteration === "number" && Number.isInteger(options.repairContext.cycle_iteration)
      ? Math.max(options.repairContext.cycle_iteration, 1)
      : 1;
  const maxAttempts =
    typeof options.repairContext.max_attempts === "number" && Number.isInteger(options.repairContext.max_attempts)
      ? Math.max(options.repairContext.max_attempts, attemptIndex)
      : attemptIndex;

  return {
    projectId: options.projectId,
    projectRoot: options.projectRoot,
    runId: options.runId,
    sourceStage,
    sourceRef: sourceStage === "qa" ? options.runtimeHarnessReportRef : options.reviewReportRef,
    findingRefs,
    repairScope: {
      target_step: "implement",
      requested_next_step: asString(options.repairContext.requested_next_step) ?? "execution",
      allowed_paths: asStringArray(options.repairContext.meaningful_changed_paths),
      verification_refs: verificationRefs,
      required_evidence_refs: uniqueStrings([
        options.reviewReportRef,
        options.runtimeHarnessReportRef,
        ...verificationRefs,
      ]),
      reason: asString(options.repairContext.stop_reason) ?? "Resolve the linked repair findings before delivery.",
    },
    attemptBudget: {
      policy_ref: `project-profile://${options.projectId}#quality_repair_policy`,
      max_attempts: maxAttempts,
      attempt_index: attemptIndex,
      remaining_attempts: Math.max(maxAttempts - attemptIndex, 0),
    },
    evidenceRefs: options.evidenceRefs,
    createdAt: options.generatedAt,
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
 *   repairContext?: Record<string, unknown> | null,
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
  const repairContext = normalizeRepairContext({
    decision: options.decision,
    context: options.repairContext,
    defaultVerificationStatus: runtimeDecision === "pass" && reviewStatus === "pass" ? "pass" : "not_pass",
    fallbackFindingDetails: buildFallbackRepairFindingDetails({
      findings: [...reviewFindings, ...runtimeFindings],
      fallbackEvidenceRefs: evidenceRefs,
    }),
    fallbackFindings: uniqueStrings([
      ...blockingFindings.map((finding) => asString(finding.summary) ?? "Blocking review finding."),
      ...gate.findings,
      asString(options.reason) ?? "",
      "Operator requested public repair before delivery.",
    ]),
    fallbackVerificationRefs: evidenceRefs,
  });
  const qualityRepairResult = options.decision === "request-repair"
    ? materializeQualityRepairRequest({
        ...buildQualityRepairRequestOptions({
          projectId: options.projectId,
          projectRoot: options.projectRoot,
          runId: options.runId,
          reviewReportRef,
          runtimeHarnessReportRef,
          repairContext,
          evidenceRefs,
          generatedAt,
        }),
        runtimeLayout: options.runtimeLayout,
      })
    : null;
  const qualityRepairRef = qualityRepairResult?.requestRef ?? null;
  const qualityRepairLineage = qualityRepairResult?.lineage ?? null;
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
    repair_context: repairContext,
    delivery_gate: {
      status: gate.status,
      blocks_downstream: gate.blocksDownstream,
      required_downstream_decision: "approve",
      findings: gate.findings,
    },
    ...(qualityRepairRef ? { quality_repair_request_ref: qualityRepairRef } : {}),
    ...(qualityRepairLineage ? { quality_repair_lineage: qualityRepairLineage } : {}),
    evidence_refs: uniqueStrings([...evidenceRefs, qualityRepairRef]),
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
    ...(qualityRepairResult
      ? {
          qualityRepairRequest: qualityRepairResult.request,
          qualityRepairRequestFile: qualityRepairResult.requestFile,
          qualityRepairRequestRef: qualityRepairResult.requestRef,
        }
      : {}),
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
