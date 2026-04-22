import fs from "node:fs";
import path from "node:path";

import { validateContractDocument } from "../../contracts/src/index.mjs";

export const CANONICAL_DELIVERY_MODES = Object.freeze([
  "no-write",
  "patch-only",
  "local-branch",
  "fork-first-pr",
]);

const DELIVERY_MODE_ALIASES = Object.freeze({
  "no-write": "no-write",
  "read-only": "no-write",
  patch: "patch-only",
  "patch-only": "patch-only",
  "local-branch": "local-branch",
  branch: "local-branch",
  "fork-first-pr": "fork-first-pr",
  "fork-pr": "fork-first-pr",
  "pull-request": "fork-first-pr",
});
const RERUN_PACKET_BOUNDARIES = new Set(["delivery-manifest", "release-packet"]);

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function asRecord(value) {
  return typeof value === "object" && value !== null ? /** @type {Record<string, unknown>} */ (value) : {};
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
 * @param {string} value
 * @returns {string}
 */
function normalizeForId(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * @param {string} mode
 * @returns {string}
 */
export function normalizeDeliveryMode(mode) {
  const normalized = DELIVERY_MODE_ALIASES[mode];
  if (!normalized) {
    throw new Error(
      `Unsupported delivery mode '${mode}'. Expected one of: ${Object.keys(DELIVERY_MODE_ALIASES).sort().join(", ")}.`,
    );
  }
  return normalized;
}

/**
 * @param {Record<string, unknown>} policyResolution
 * @returns {{ resolvedMode: string, resolutionKind: string, resolutionField: string }}
 */
function resolveModeSource(policyResolution) {
  const resolvedBounds = asRecord(policyResolution.resolved_bounds);
  const writebackMode = asRecord(resolvedBounds.writeback_mode);
  const resolvedMode = asString(writebackMode.mode);
  if (!resolvedMode) {
    throw new Error("Delivery plan requires policy resolution with resolved_bounds.writeback_mode.mode.");
  }

  const resolutionSource = asRecord(writebackMode.resolution_source);
  const resolutionKind = asString(resolutionSource.kind) ?? "unknown";
  const resolutionField = asString(resolutionSource.field) ?? "unknown";

  return {
    resolvedMode,
    resolutionKind,
    resolutionField,
  };
}

/**
 * @param {Record<string, unknown>} policyResolution
 */
function resolveGovernanceSource(policyResolution) {
  const governance = asRecord(policyResolution.governance_decision);
  const decisionRaw = asString(governance.decision);
  const decision = decisionRaw === "deny" || decisionRaw === "escalate" ? decisionRaw : "allow";
  const riskTier = asString(governance.route_risk_tier) ?? "unknown";
  const highRiskDelivery = governance.high_risk_delivery === true;
  const reasons = Array.isArray(governance.reasons)
    ? governance.reasons
        .filter((entry) => typeof entry === "object" && entry !== null)
        .map((entry) => {
          const reason = asRecord(entry);
          const code = asString(reason.code) ?? "governance-unknown";
          const severityRaw = asString(reason.severity);
          const severity = severityRaw === "deny" || severityRaw === "escalate" ? severityRaw : "escalate";
          const message = asString(reason.message) ?? "Policy governance reason.";
          return { code, severity, message };
        })
    : [];

  return {
    decision,
    route_risk_tier: riskTier,
    high_risk_delivery: highRiskDelivery,
    reasons,
  };
}

/**
 * @param {{
 *   runtimeLayout: { artifactsRoot: string },
 *   projectId: string,
 *   runId: string,
 *   stepClass: string,
 *   policyResolution: Record<string, unknown>,
 *   handoffApproval?: { status?: string, ref?: string | null },
 *   promotionEvidenceRefs?: string[],
 *   coordinationRepos?: Array<{ repo_id?: string, role?: string, default_branch?: string }>,
 *   coordinationEvidenceRefs?: string[],
 *   rerunOfRunRef?: string,
 *   rerunFailedStepRef?: string,
 *   rerunPacketBoundary?: string,
 * }} options
 * @returns {{
 *   deliveryPlan: Record<string, unknown>,
 *   deliveryPlanFile: string,
 * }}
 */
export function materializeDeliveryPlan(options) {
  const modeSource = resolveModeSource(asRecord(options.policyResolution));
  const governance = resolveGovernanceSource(asRecord(options.policyResolution));
  const canonicalMode = normalizeDeliveryMode(modeSource.resolvedMode);
  const nonReadOnlyMode = canonicalMode !== "no-write";

  const handoffStatusRaw = asString(asRecord(options.handoffApproval ?? {}).status);
  const handoffRef = asString(asRecord(options.handoffApproval ?? {}).ref);
  const handoffStatus = handoffStatusRaw === "pass" ? "present" : "missing";

  const promotionEvidenceRefs = [...new Set(asStringArray(options.promotionEvidenceRefs ?? []))];
  const promotionStatus = promotionEvidenceRefs.length > 0 ? "present" : "missing";
  const coordinationRepos = Array.isArray(options.coordinationRepos)
    ? options.coordinationRepos
        .filter((repo) => typeof repo === "object" && repo !== null)
        .map((repo) => ({
          repo_id: asString(asRecord(repo).repo_id),
          role: asString(asRecord(repo).role),
          default_branch: asString(asRecord(repo).default_branch),
        }))
        .filter((repo) => typeof repo.repo_id === "string")
    : [];
  const coordinationRepoIds = uniqueStrings(
    coordinationRepos.map((repo) => /** @type {string} */ (repo.repo_id)),
  );
  const coordinationEvidenceRefs = uniqueStrings(asStringArray(options.coordinationEvidenceRefs ?? []));
  const multiRepoRequired = coordinationRepoIds.length > 1;
  const coordinationStatus = multiRepoRequired
    ? coordinationEvidenceRefs.length > 0
      ? "present"
      : "missing"
    : "not-required";

  const rerunOfRunRef = asString(options.rerunOfRunRef);
  const rerunFailedStepRef = asString(options.rerunFailedStepRef);
  const rerunPacketBoundaryInput = asString(options.rerunPacketBoundary);
  const rerunRequested = Boolean(rerunOfRunRef || rerunFailedStepRef || rerunPacketBoundaryInput);
  const rerunPacketBoundary = rerunPacketBoundaryInput ?? "delivery-manifest";
  /** @type {string[]} */
  const rerunBlockingReasons = [];
  if (rerunRequested && !rerunOfRunRef) {
    rerunBlockingReasons.push("rerun-run-ref-required");
  }
  if (rerunRequested && !rerunFailedStepRef) {
    rerunBlockingReasons.push("rerun-failed-step-required");
  }
  if (rerunRequested && !RERUN_PACKET_BOUNDARIES.has(rerunPacketBoundary)) {
    rerunBlockingReasons.push("rerun-packet-boundary-unsupported");
  }
  const rerunStatus = !rerunRequested ? "not-requested" : rerunBlockingReasons.length === 0 ? "ready" : "blocked";
  const rerunStrategy = !rerunRequested
    ? null
    : rerunPacketBoundary === "release-packet"
      ? "rebuild-release-packet"
      : "resume-failed-step";

  /** @type {string[]} */
  const blockingReasons = [];
  if (nonReadOnlyMode && handoffStatus !== "present") {
    blockingReasons.push("approved-handoff-required");
  }
  if (nonReadOnlyMode && promotionStatus !== "present") {
    blockingReasons.push("promotion-evidence-required");
  }
  if (nonReadOnlyMode && multiRepoRequired && coordinationStatus !== "present") {
    blockingReasons.push("multi-repo-coordination-evidence-required");
  }
  if (rerunStatus === "blocked") {
    blockingReasons.push(...rerunBlockingReasons);
  }
  if (nonReadOnlyMode && governance.decision === "deny") {
    blockingReasons.push(
      ...governance.reasons.filter((reason) => reason.severity === "deny").map((reason) => reason.code),
    );
  }
  if (nonReadOnlyMode && governance.decision === "escalate") {
    blockingReasons.push(
      ...governance.reasons.filter((reason) => reason.severity === "escalate").map((reason) => reason.code),
    );
  }
  if (
    nonReadOnlyMode &&
    (governance.decision === "deny" || governance.decision === "escalate") &&
    governance.reasons.length === 0
  ) {
    blockingReasons.push(
      governance.decision === "deny" ? "governance-deny-reason-missing" : "governance-escalation-reason-missing",
    );
  }

  const writebackAllowed = blockingReasons.length === 0;
  const status = writebackAllowed ? "ready" : "blocked";

  const evidenceRefs = [...new Set([...(handoffRef ? [handoffRef] : []), ...promotionEvidenceRefs])];
  const planId = `${options.projectId}.delivery-plan.${normalizeForId(options.stepClass)}.${Date.now()}`;
  const createdAt = new Date().toISOString();
  const deliveryPlan = {
    plan_id: planId,
    project_id: options.projectId,
    run_id: options.runId,
    step_class: options.stepClass,
    delivery_mode: canonicalMode,
    mode_source: {
      resolved_mode: modeSource.resolvedMode,
      canonical_mode: canonicalMode,
      resolution_kind: modeSource.resolutionKind,
      resolution_field: modeSource.resolutionField,
    },
    preconditions: {
      approved_handoff: {
        required: nonReadOnlyMode,
        status: nonReadOnlyMode ? handoffStatus : "not-required",
        ref: handoffRef,
      },
      promotion_evidence: {
        required: nonReadOnlyMode,
        status: nonReadOnlyMode ? promotionStatus : "not-required",
        refs: promotionEvidenceRefs,
      },
      coordination_evidence: {
        required: nonReadOnlyMode && multiRepoRequired,
        status: nonReadOnlyMode && multiRepoRequired ? coordinationStatus : "not-required",
        refs: coordinationEvidenceRefs,
      },
    },
    governance,
    coordination: {
      required: multiRepoRequired,
      status: coordinationStatus,
      repo_ids: coordinationRepoIds,
      repos: coordinationRepos,
      evidence_refs: coordinationEvidenceRefs,
    },
    rerun_recovery: {
      requested: rerunRequested,
      status: rerunStatus,
      rerun_of_run_ref: rerunOfRunRef,
      failed_step_ref: rerunFailedStepRef,
      packet_boundary: rerunPacketBoundary,
      strategy: rerunStrategy,
      blocking_reasons: rerunBlockingReasons,
    },
    writeback_allowed: writebackAllowed,
    blocking_reasons: blockingReasons,
    status,
    evidence_refs: uniqueStrings([...evidenceRefs, ...coordinationEvidenceRefs]),
    created_at: createdAt,
  };

  const validation = validateContractDocument({
    family: "delivery-plan",
    document: deliveryPlan,
    source: "runtime://delivery-plan",
  });
  if (!validation.ok) {
    const issues = validation.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Generated delivery plan failed contract validation: ${issues}`);
  }

  const deliveryPlanFile = path.join(
    options.runtimeLayout.artifactsRoot,
    `delivery-plan-${normalizeForId(options.stepClass)}-${Date.now()}.json`,
  );
  fs.writeFileSync(deliveryPlanFile, `${JSON.stringify(deliveryPlan, null, 2)}\n`, "utf8");

  return {
    deliveryPlan,
    deliveryPlanFile,
  };
}
