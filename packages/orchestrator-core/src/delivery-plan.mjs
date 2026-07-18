import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

import { validateContractDocument } from "../../contracts/src/index.mjs";

import { captureDeliveryDiff } from "./delivery-integrity.mjs";
import { runTransactionCoordinator } from "./verification-delivery-transactions.mjs";

export const CANONICAL_DELIVERY_MODES = Object.freeze([
  "no-write",
  "patch-only",
  "local-branch",
  "fork-first-pr",
]);

const DELIVERY_MODE_VALUES = new Set(CANONICAL_DELIVERY_MODES);
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
 * @returns {number | null}
 */
function asNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
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

function lockEvidenceRefs(refs, executionRoot, runtimeLayout) {
  if (!executionRoot) return [];
  return uniqueStrings(refs).map((ref) => {
    const candidate = ref.startsWith("evidence://") ? ref.slice("evidence://".length) : ref;
    const candidates = [path.isAbsolute(candidate) ? candidate : path.resolve(executionRoot, candidate)];
    if (candidate.startsWith("handoff/") && runtimeLayout?.artifactsRoot) {
      candidates.push(path.join(runtimeLayout.artifactsRoot, `handoff-${path.basename(candidate)}.json`));
    }
    if (candidate.startsWith("promotion/") && runtimeLayout?.reportsRoot) {
      candidates.push(path.join(runtimeLayout.reportsRoot, `promotion-${path.basename(candidate)}.json`));
    }
    const filePath = candidates.find((entry) => fs.existsSync(entry) && fs.lstatSync(entry).isFile());
    if (!filePath) {
      return { ref, status: "missing", sha256: null };
    }
    return {
      ref,
      resolved_path: filePath,
      status: "locked",
      sha256: createHash("sha256").update(fs.readFileSync(filePath)).digest("hex"),
    };
  });
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
  if (!DELIVERY_MODE_VALUES.has(mode)) {
    throw new Error(
      `Unsupported delivery mode '${mode}'. Expected one of: ${CANONICAL_DELIVERY_MODES.join(", ")}.`,
    );
  }
  return mode;
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
 *   runtimeLayout: { artifactsRoot: string, reportsRoot?: string },
 *   executionRoot?: string,
 *   authorizedDiff?: { baseline: { head_sha: string }, changes: Record<string, unknown> },
 *   evidenceLocks?: Array<{ ref: string, status: string, sha256: string | null }>,
 *   deliveryAuthorizationPhase?: boolean,
 *   projectId: string,
 *   runId: string,
 *   stepClass: string,
 *   policyResolution: Record<string, unknown>,
 *   handoffApproval?: { status?: string, ref?: string | null },
 *   promotionEvidenceRefs?: string[],
 *   coordinationRepos?: Array<{ repo_id?: string, role?: string, default_branch?: string, source_root?: string, source_kind?: string, source?: Record<string, unknown> }>,
 *   coordinationEvidenceRefs?: string[],
 *   coordinationLockEvidenceRefs?: string[],
 *   crossRepoValidationRefs?: string[],
 *   integrationReport?: { required?: boolean, status?: string, ref?: string | null, parentRunId?: string | null, executionPlanRef?: string | null, workspaceSetRef?: string | null },
 *   runtimeHarnessGate?: {
 *     required?: boolean,
 *     enforced?: boolean,
 *     status?: string,
 *     reportId?: string | null,
 *     reportRef?: string | null,
 *     overallDecision?: string | null,
 *     runDecision?: string | null,
 *     routedStepDecisionCount?: number,
 *     meaningfulChangedPaths?: string[],
 *     findings?: string[],
 *   },
 *   rerunOfRunRef?: string,
 *   rerunFailedStepRef?: string,
 *   rerunPacketBoundary?: string,
 * }} options
 * @returns {{
 *   deliveryPlan: Record<string, unknown>,
 *   deliveryPlanFile: string,
 * }}
 */
function executeDeliveryPlanTransaction(options) {
  const modeSource = resolveModeSource(asRecord(options.policyResolution));
  const governance = resolveGovernanceSource(asRecord(options.policyResolution));
  const canonicalMode = normalizeDeliveryMode(modeSource.resolvedMode);
  const nonReadOnlyMode = canonicalMode !== "no-write";
  const deliveryAuthorizationPhase = options.deliveryAuthorizationPhase !== false;
  const writebackAuthorizationRequired = nonReadOnlyMode && deliveryAuthorizationPhase && governance.decision === "allow";

  const handoffStatusRaw = asString(asRecord(options.handoffApproval ?? {}).status);
  const handoffRef = asString(asRecord(options.handoffApproval ?? {}).ref);
  const handoffStatus = handoffStatusRaw === "pass" ? "present" : "missing";

  const promotionEvidenceRefs = [...new Set(asStringArray(options.promotionEvidenceRefs ?? []))];
  const promotionStatus = promotionEvidenceRefs.length > 0 ? "present" : "missing";
  const runtimeHarnessGate = asRecord(options.runtimeHarnessGate ?? {});
  const runtimeHarnessRequired = nonReadOnlyMode && runtimeHarnessGate.required === true;
  const runtimeHarnessEnforced = runtimeHarnessRequired && runtimeHarnessGate.enforced === true;
  const runtimeHarnessStatus = runtimeHarnessRequired ? asString(runtimeHarnessGate.status) ?? "missing" : "not-required";
  const runtimeHarnessReportRef = asString(runtimeHarnessGate.reportRef);
  const runtimeHarnessPrecondition = {
    required: runtimeHarnessRequired,
    enforced: runtimeHarnessEnforced,
    status: runtimeHarnessStatus,
    report_id: asString(runtimeHarnessGate.reportId),
    report_ref: runtimeHarnessReportRef,
    overall_decision: asString(runtimeHarnessGate.overallDecision),
    run_decision: asString(runtimeHarnessGate.runDecision),
    routed_step_decision_count: asNumber(runtimeHarnessGate.routedStepDecisionCount) ?? 0,
    meaningful_changed_paths: uniqueStrings(asStringArray(runtimeHarnessGate.meaningfulChangedPaths)),
    findings: uniqueStrings(asStringArray(runtimeHarnessGate.findings)),
  };
  const coordinationRepos = Array.isArray(options.coordinationRepos)
    ? options.coordinationRepos
        .filter((repo) => typeof repo === "object" && repo !== null)
        .map((repo) => {
          const repoRecord = asRecord(repo);
          const source = asRecord(repoRecord.source);
          return {
            repo_id: asString(repoRecord.repo_id),
            role: asString(repoRecord.role),
            default_branch: asString(repoRecord.default_branch),
            source_root: asString(repoRecord.source_root) ?? asString(source.root),
            source_kind: asString(repoRecord.source_kind) ?? asString(source.kind),
          };
        })
        .filter((repo) => typeof repo.repo_id === "string")
    : [];
  const coordinationRepoIds = uniqueStrings(
    coordinationRepos.map((repo) => /** @type {string} */ (repo.repo_id)),
  );
  const coordinationLockEvidenceRefs = uniqueStrings(asStringArray(options.coordinationLockEvidenceRefs ?? []));
  const crossRepoValidationRefs = uniqueStrings(asStringArray(options.crossRepoValidationRefs ?? []));
  const coordinationEvidenceRefs = uniqueStrings([
    ...asStringArray(options.coordinationEvidenceRefs ?? []),
    ...coordinationLockEvidenceRefs,
    ...crossRepoValidationRefs,
  ]);
  const multiRepoRequired = coordinationRepoIds.length > 1;
  const coordinationStatus = multiRepoRequired
    ? coordinationEvidenceRefs.length > 0
      ? "present"
      : "missing"
    : "not-required";
  const integrationReport = asRecord(options.integrationReport ?? {});
  const integrationRequired = nonReadOnlyMode && (multiRepoRequired || integrationReport.required === true);
  const integrationRef = asString(integrationReport.ref);
  const integrationStatus = integrationRequired ? asString(integrationReport.status) ?? "missing" : "not-required";

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
  if (runtimeHarnessEnforced && runtimeHarnessStatus !== "pass") {
    blockingReasons.push("runtime-harness-gate-required");
  }
  if (nonReadOnlyMode && multiRepoRequired && coordinationStatus !== "present") {
    blockingReasons.push("multi-repo-coordination-evidence-required");
  }
  if (integrationRequired && (integrationStatus !== "passed" || !integrationRef)) {
    blockingReasons.push("integration-report-required");
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

  const evidenceRefs = [...new Set([
    ...(handoffRef ? [handoffRef] : []),
    ...promotionEvidenceRefs,
    ...(runtimeHarnessReportRef ? [runtimeHarnessReportRef] : []),
    ...(integrationRef ? [integrationRef] : []),
  ])];
  const planId = `${options.projectId}.delivery-plan.${normalizeForId(options.stepClass)}.${Date.now()}`;
  const createdAt = new Date().toISOString();
  const diffAuthorization = options.authorizedDiff ??
    (writebackAuthorizationRequired && options.executionRoot ? captureDeliveryDiff(options.executionRoot) : null);
  if (writebackAuthorizationRequired && diffAuthorization === null) {
    blockingReasons.push("exact-diff-authorization-required");
  }
  const evidenceLocks = options.evidenceLocks ?? lockEvidenceRefs(evidenceRefs, options.executionRoot, options.runtimeLayout);
  if (writebackAuthorizationRequired && (evidenceLocks.length !== evidenceRefs.length ||
      evidenceLocks.some((lock) => lock.status !== "locked" || !lock.sha256))) {
    blockingReasons.push("delivery-evidence-lock-required");
    blockingReasons.push(...evidenceLocks
      .filter((lock) => lock.status !== "locked" || !lock.sha256)
      .map((lock) => `delivery-evidence-unresolved:${lock.ref}`));
  }
  const finalExecutionAllowed = blockingReasons.length === 0;
  const finalWritebackAllowed = writebackAuthorizationRequired && finalExecutionAllowed;
  const targetEditsAllowed = nonReadOnlyMode && finalExecutionAllowed;
  const deliveryPlan = {
    schema_version: 2,
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
      runtime_harness: runtimeHarnessPrecondition,
      coordination_evidence: {
        required: nonReadOnlyMode && multiRepoRequired,
        status: nonReadOnlyMode && multiRepoRequired ? coordinationStatus : "not-required",
        refs: coordinationEvidenceRefs,
        lock_refs: coordinationLockEvidenceRefs,
        cross_repo_validation_refs: crossRepoValidationRefs,
      },
      integration: {
        required: integrationRequired,
        status: integrationStatus,
        report_ref: integrationRef,
        parent_run_id: asString(integrationReport.parentRunId),
        execution_plan_ref: asString(integrationReport.executionPlanRef),
        workspace_set_ref: asString(integrationReport.workspaceSetRef),
      },
    },
    governance,
    coordination: {
      required: multiRepoRequired,
      status: coordinationStatus,
      repo_ids: coordinationRepoIds,
      repos: coordinationRepos,
      evidence_refs: coordinationEvidenceRefs,
      lock_evidence_refs: coordinationLockEvidenceRefs,
      cross_repo_validation_refs: crossRepoValidationRefs,
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
    permissions: {
      execution_allowed: finalExecutionAllowed,
      artifact_materialization_allowed: finalWritebackAllowed,
      local_commit_allowed: finalWritebackAllowed && canonicalMode === "local-branch",
      fork_push_allowed: finalWritebackAllowed && canonicalMode === "fork-first-pr",
      direct_upstream_write_allowed: false,
    },
    diff_authorization: diffAuthorization,
    evidence_locks: evidenceLocks,
    execution_allowed: finalExecutionAllowed,
    writeback_allowed: finalWritebackAllowed,
    target_write_allowed: targetEditsAllowed,
    direct_edits_allowed: targetEditsAllowed,
    meaningful_change_required: targetEditsAllowed && options.stepClass === "implement",
    blocking_reasons: blockingReasons,
    status: finalExecutionAllowed ? "ready" : "blocked",
    evidence_refs: uniqueStrings([
      ...evidenceRefs,
      ...(runtimeHarnessReportRef ? [runtimeHarnessReportRef] : []),
      ...coordinationEvidenceRefs,
      ...(integrationRef ? [integrationRef] : []),
    ]),
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

export function materializeDeliveryPlan(options) {
  return runTransactionCoordinator(executeDeliveryPlanTransaction, options);
}
