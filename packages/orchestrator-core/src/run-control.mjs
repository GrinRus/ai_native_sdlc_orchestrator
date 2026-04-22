import fs from "node:fs";
import path from "node:path";

import { initializeProjectRuntime, loadProjectProfileForRuntime } from "./project-init.mjs";

const RUN_CONTROL_ACTIONS = new Set(["start", "pause", "resume", "steer", "cancel"]);
const HIGH_RISK_ACTIONS = new Set(["steer", "cancel"]);
const TERMINAL_STATUSES = new Set(["canceled", "cancelled", "completed", "failed", "pass", "fail", "aborted"]);
const ACTION_RISK_TIERS = {
  start: "low",
  pause: "medium",
  resume: "medium",
  steer: "high",
  cancel: "high",
};

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
 * @param {unknown} value
 * @returns {boolean}
 */
function asBoolean(value) {
  return value === true;
}

/**
 * @param {string} projectRoot
 * @param {string} filePath
 * @returns {string}
 */
function toEvidenceRef(projectRoot, filePath) {
  return `evidence://${path.relative(projectRoot, filePath).replace(/\\/g, "/")}`;
}

/**
 * @param {string} filePath
 * @returns {Record<string, unknown>}
 */
function readJson(filePath) {
  return /** @type {Record<string, unknown>} */ (JSON.parse(fs.readFileSync(filePath, "utf8")));
}

/**
 * @param {string} filePath
 * @param {Record<string, unknown>} payload
 */
function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

/**
 * @param {ReturnType<typeof initializeProjectRuntime>} init
 * @param {string} runId
 * @returns {string}
 */
function resolveRunControlStateFile(init, runId) {
  return path.join(init.runtimeLayout.stateRoot, `run-control-state-${normalizeId(runId)}.json`);
}

/**
 * @param {ReturnType<typeof initializeProjectRuntime>} init
 * @param {string} runId
 * @returns {string}
 */
function resolveLiveE2ESummaryFile(init, runId) {
  return path.join(init.runtimeLayout.reportsRoot, `live-e2e-run-summary-${normalizeId(runId)}.json`);
}

/**
 * @param {ReturnType<typeof initializeProjectRuntime>} init
 * @param {string} runId
 * @param {number} sequence
 * @returns {string}
 */
function resolveRunControlAuditFile(init, runId, sequence) {
  return path.join(
    init.runtimeLayout.reportsRoot,
    `run-control-event-${normalizeId(runId)}-${String(sequence).padStart(4, "0")}.json`,
  );
}

/**
 * @param {string | null} status
 * @returns {string | null}
 */
function normalizeStatus(status) {
  if (!status) return null;
  if (status === "cancelled") return "canceled";
  return status;
}

/**
 * @param {string} action
 * @param {string | null} status
 * @returns {{ allowed: boolean, nextStatus: string | null, code: string | null, message: string | null }}
 */
function resolveTransition(action, status) {
  const normalized = normalizeStatus(status);

  if (!normalized) {
    if (action === "start") {
      return {
        allowed: true,
        nextStatus: "running",
        code: null,
        message: null,
      };
    }

    return {
      allowed: false,
      nextStatus: null,
      code: "run.not_found",
      message: "Run-control state does not exist. Start a run before applying control transitions.",
    };
  }

  if (TERMINAL_STATUSES.has(normalized)) {
    return {
      allowed: false,
      nextStatus: normalized,
      code: "transition.terminal",
      message: `Run '${normalized}' is terminal; control transition '${action}' is not allowed.`,
    };
  }

  if (action === "start") {
    return {
      allowed: false,
      nextStatus: normalized,
      code: "transition.already_started",
      message: "Run has already been started.",
    };
  }

  if (normalized === "running") {
    if (action === "pause") {
      return { allowed: true, nextStatus: "paused", code: null, message: null };
    }
    if (action === "resume") {
      return {
        allowed: false,
        nextStatus: normalized,
        code: "transition.invalid",
        message: "Run is already running; resume is invalid.",
      };
    }
    if (action === "steer") {
      return { allowed: true, nextStatus: "running", code: null, message: null };
    }
    if (action === "cancel") {
      return { allowed: true, nextStatus: "canceled", code: null, message: null };
    }
  }

  if (normalized === "paused") {
    if (action === "resume") {
      return { allowed: true, nextStatus: "running", code: null, message: null };
    }
    if (action === "pause") {
      return {
        allowed: false,
        nextStatus: normalized,
        code: "transition.invalid",
        message: "Run is already paused; pause is invalid.",
      };
    }
    if (action === "steer") {
      return { allowed: true, nextStatus: "paused", code: null, message: null };
    }
    if (action === "cancel") {
      return { allowed: true, nextStatus: "canceled", code: null, message: null };
    }
  }

  return {
    allowed: false,
    nextStatus: normalized,
    code: "transition.invalid",
    message: `Control action '${action}' is invalid from status '${normalized}'.`,
  };
}

/**
 * @param {Record<string, unknown>} profile
 * @param {string} action
 * @param {string | null} approvalRef
 * @param {string | null} targetStep
 * @returns {{
 *   blocked: boolean,
 *   blocked_reason: { code: string, message: string } | null,
 *   decision: {
 *     action: string,
 *     risk_tier: string,
 *     high_risk: boolean,
 *     approval_required: boolean,
 *     approval_ref: string | null,
 *     target_step: string | null,
 *     policy_sources: {
 *       approval_policy_required_for_execution: boolean,
 *       risk_tier_requires_human_approval: boolean,
 *     },
 *   },
 * }}
 */
function evaluateGuardrails(profile, action, approvalRef, targetStep) {
  const approvalPolicy = asRecord(profile.approval_policy);
  const riskTiers = asRecord(profile.risk_tiers);
  const riskTier = ACTION_RISK_TIERS[action] ?? "medium";
  const riskTierPolicy = asRecord(riskTiers[riskTier]);
  const approvalFromPolicy = asBoolean(approvalPolicy.required_for_execution);
  const approvalFromRiskTier = asBoolean(riskTierPolicy.require_human_approval);
  const highRisk = HIGH_RISK_ACTIONS.has(action);
  const approvalRequired = highRisk && (approvalFromPolicy || approvalFromRiskTier);

  if (action === "steer" && !targetStep) {
    return {
      blocked: true,
      blocked_reason: {
        code: "scope.target_step_required",
        message: "Steer requires '--target-step' to stay in explicit scope.",
      },
      decision: {
        action,
        risk_tier: riskTier,
        high_risk: highRisk,
        approval_required: approvalRequired,
        approval_ref: approvalRef,
        target_step: targetStep,
        policy_sources: {
          approval_policy_required_for_execution: approvalFromPolicy,
          risk_tier_requires_human_approval: approvalFromRiskTier,
        },
      },
    };
  }

  if (approvalRequired && !approvalRef) {
    return {
      blocked: true,
      blocked_reason: {
        code: "approval.required",
        message: `Control action '${action}' requires '--approval-ref' by policy guardrail.`,
      },
      decision: {
        action,
        risk_tier: riskTier,
        high_risk: highRisk,
        approval_required: approvalRequired,
        approval_ref: approvalRef,
        target_step: targetStep,
        policy_sources: {
          approval_policy_required_for_execution: approvalFromPolicy,
          risk_tier_requires_human_approval: approvalFromRiskTier,
        },
      },
    };
  }

  return {
    blocked: false,
    blocked_reason: null,
    decision: {
      action,
      risk_tier: riskTier,
      high_risk: highRisk,
      approval_required: approvalRequired,
      approval_ref: approvalRef,
      target_step: targetStep,
      policy_sources: {
        approval_policy_required_for_execution: approvalFromPolicy,
        risk_tier_requires_human_approval: approvalFromRiskTier,
      },
    },
  };
}

/**
 * @param {ReturnType<typeof initializeProjectRuntime>} init
 * @param {string} runId
 * @returns {{ state: Record<string, unknown> | null, stateFile: string, source: "state-file" | "live-e2e-summary" | "none" }}
 */
function readExistingRunState(init, runId) {
  const stateFile = resolveRunControlStateFile(init, runId);
  if (fs.existsSync(stateFile)) {
    return {
      state: readJson(stateFile),
      stateFile,
      source: "state-file",
    };
  }

  const summaryFile = resolveLiveE2ESummaryFile(init, runId);
  if (fs.existsSync(summaryFile)) {
    const summary = readJson(summaryFile);
    return {
      state: {
        schema_version: 1,
        run_id: runId,
        status: normalizeStatus(asString(summary.status) ?? "running") ?? "running",
        current_step: null,
        last_action: "live-e2e.import",
        started_at: asString(summary.started_at),
        updated_at: asString(summary.finished_at) ?? asString(summary.started_at) ?? nowIso(),
        action_sequence: 0,
        approval_refs: [],
        audit_refs: [],
        evidence_root: init.runtimeLayout.reportsRoot,
      },
      stateFile,
      source: "live-e2e-summary",
    };
  }

  return {
    state: null,
    stateFile,
    source: "none",
  };
}

/**
 * @param {string} action
 * @param {Record<string, unknown> | null} state
 * @returns {string[]}
 */
function resolveNextActions(action, state) {
  if (!state) {
    return action === "start" ? ["run pause", "run steer", "run cancel"] : ["run start"];
  }

  const status = normalizeStatus(asString(state.status));
  if (!status) {
    return ["run start"];
  }
  if (status === "running") {
    return ["run pause", "run steer", "run cancel", "run status --follow true"];
  }
  if (status === "paused") {
    return ["run resume", "run steer", "run cancel", "run status --follow true"];
  }
  return ["run status"];
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef: string,
 *   runtimeRoot?: string,
 *   runId?: string,
 *   action: "start" | "pause" | "resume" | "steer" | "cancel",
 *   targetStep?: string,
 *   reason?: string,
 *   approvalRef?: string,
 * }} options
 */
export function applyRunControlAction(options) {
  const cwd = options.cwd ?? process.cwd();
  const action = options.action;
  if (!RUN_CONTROL_ACTIONS.has(action)) {
    throw new Error(
      `Unsupported run-control action '${action}'. Expected one of: ${[...RUN_CONTROL_ACTIONS].join(", ")}.`,
    );
  }

  const generatedRunId = `run-control-${new Date().toISOString().replace(/[^0-9]/g, "").slice(-12)}`;
  const runId = asString(options.runId) ?? (action === "start" ? generatedRunId : null);
  if (!runId) {
    throw new Error(`Run-control action '${action}' requires 'runId'.`);
  }

  const reason = asString(options.reason);
  const targetStep = asString(options.targetStep);
  const approvalRef = asString(options.approvalRef);
  const init = initializeProjectRuntime({
    cwd,
    projectRef: options.projectRef,
    runtimeRoot: options.runtimeRoot,
  });
  const profile = loadProjectProfileForRuntime({ projectProfilePath: init.projectProfilePath }).document;

  const existingState = readExistingRunState(init, runId);
  const stateBefore = existingState.state;
  const transition = resolveTransition(action, normalizeStatus(asString(stateBefore?.status)));
  const guardrails = evaluateGuardrails(profile, action, approvalRef, targetStep);
  const blockedReason = guardrails.blocked
    ? guardrails.blocked_reason
    : transition.allowed
      ? null
      : {
          code: transition.code ?? "transition.invalid",
          message: transition.message ?? "Transition is not allowed.",
        };
  const blocked = Boolean(blockedReason);

  const previousSequenceRaw = stateBefore ? Number(stateBefore.action_sequence) : 0;
  const previousSequence = Number.isFinite(previousSequenceRaw) ? previousSequenceRaw : 0;
  const actionSequence = previousSequence + 1;
  const stateFile = existingState.stateFile;
  const auditFile = resolveRunControlAuditFile(init, runId, actionSequence);
  const auditId = `${runId}.run-control.${String(actionSequence).padStart(4, "0")}`;
  const eventTimestamp = nowIso();

  const auditRecord = {
    audit_id: auditId,
    run_id: runId,
    action,
    applied: !blocked,
    blocked,
    blocked_reason: blockedReason,
    requested_scope: {
      target_step: targetStep,
      reason,
    },
    transition: {
      from_status: normalizeStatus(asString(stateBefore?.status)),
      to_status: blocked ? normalizeStatus(asString(stateBefore?.status)) : transition.nextStatus,
      source: existingState.source,
    },
    guardrails: guardrails.decision,
    approval_ref: approvalRef,
    evidence_root: init.runtimeLayout.reportsRoot,
    state_file: stateFile,
    timestamp: eventTimestamp,
  };
  writeJson(auditFile, auditRecord);

  let stateAfter = stateBefore;
  if (!blocked || stateBefore) {
    const nextStatus = blocked
      ? normalizeStatus(asString(stateBefore?.status))
      : normalizeStatus(transition.nextStatus) ?? "running";
    const approvalRefs = stateBefore
      ? asStringArray(stateBefore.approval_refs)
      : approvalRef
        ? [approvalRef]
        : [];
    if (approvalRef && !approvalRefs.includes(approvalRef)) {
      approvalRefs.push(approvalRef);
    }

    const auditRefs = stateBefore ? asStringArray(stateBefore.audit_refs) : [];
    const auditRef = toEvidenceRef(init.projectRoot, auditFile);
    if (!auditRefs.includes(auditRef)) {
      auditRefs.push(auditRef);
    }

    stateAfter = {
      schema_version: 1,
      run_id: runId,
      status: nextStatus,
      current_step: targetStep ?? (stateBefore ? asString(stateBefore.current_step) : null),
      last_action: action,
      started_at:
        asString(stateBefore?.started_at) ??
        (action === "start" && !blocked ? eventTimestamp : asString(stateBefore?.updated_at) ?? eventTimestamp),
      updated_at: eventTimestamp,
      action_sequence: actionSequence,
      approval_refs: approvalRefs,
      audit_refs: auditRefs,
      evidence_root: init.runtimeLayout.reportsRoot,
    };

    writeJson(stateFile, stateAfter);
  }

  return {
    projectRoot: init.projectRoot,
    projectProfileRef: init.projectProfileRef,
    runtimeRoot: init.runtimeRoot,
    runtimeLayout: init.runtimeLayout,
    runId,
    action,
    state: stateAfter,
    stateFile,
    auditRecord,
    auditFile,
    blocked,
    blockedReason,
    guardrails: guardrails.decision,
    transition: auditRecord.transition,
    applied: !blocked,
    nextActions: resolveNextActions(action, stateAfter),
  };
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef: string,
 *   runtimeRoot?: string,
 *   runId: string,
 * }} options
 */
export function readRunControlState(options) {
  const cwd = options.cwd ?? process.cwd();
  const init = initializeProjectRuntime({
    cwd,
    projectRef: options.projectRef,
    runtimeRoot: options.runtimeRoot,
  });
  const runId = options.runId;
  const stateFile = resolveRunControlStateFile(init, runId);
  const state = fs.existsSync(stateFile) ? readJson(stateFile) : null;

  return {
    projectRoot: init.projectRoot,
    projectProfileRef: init.projectProfileRef,
    runtimeRoot: init.runtimeRoot,
    runtimeLayout: init.runtimeLayout,
    runId,
    state,
    stateFile,
  };
}
