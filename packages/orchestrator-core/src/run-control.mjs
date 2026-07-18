import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { validatePublicId } from "../../contracts/src/index.mjs";
import { redactSensitiveValue, withFileLock, writeJsonAtomic } from "../../observability/src/index.mjs";
import { mergeProviderStepStatus } from "./provider-step-status.mjs";
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

function requirePublicId(field, value) {
  const validation = validatePublicId(value);
  if (!validation.ok) {
    throw new Error(`Invalid ${field} ${JSON.stringify(value)} (${validation.value_class}). ${validation.migration}`);
  }
  return value;
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
  writeJsonAtomic(filePath, payload);
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
 * @returns {{ state: Record<string, unknown> | null, stateFile: string, source: "state-file" | "none" }}
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
 *   executionPlanRef?: string,
 *   executionUnitId?: string,
 *   taskRefs?: string[],
 *   preflightBlock?: { code?: string, message?: string, evidenceRefs?: string[] },
 *   redactionPolicy?: unknown,
 *   commandId?: string,
 *   expectedRevision?: number,
 *   initializedRuntime?: ReturnType<typeof initializeProjectRuntime>,
 * }} options
 */
function applyRunControlActionUnlocked(options) {
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
  requirePublicId("run_id", runId);

  const reason = asString(options.reason);
  const targetStep = asString(options.targetStep);
  const approvalRef = asString(options.approvalRef);
  const executionPlanRef = asString(options.executionPlanRef);
  const executionUnitId = asString(options.executionUnitId);
  const taskRefs = asStringArray(options.taskRefs);
  const init = options.initializedRuntime ?? initializeProjectRuntime({
    cwd,
    projectRef: options.projectRef,
    runtimeRoot: options.runtimeRoot,
  });
  const profile = loadProjectProfileForRuntime({ projectProfilePath: init.projectProfilePath }).document;

  const existingState = readExistingRunState(init, runId);
  const stateBefore = existingState.state;
  const previousSequenceRaw = stateBefore ? Number(stateBefore.action_sequence) : 0;
  const previousSequence = Number.isFinite(previousSequenceRaw) ? previousSequenceRaw : 0;
  if (options.expectedRevision !== undefined && options.expectedRevision !== previousSequence) {
    const conflict = new Error(
      `Run-control revision conflict for '${runId}': expected ${options.expectedRevision}, current ${previousSequence}.`,
    );
    conflict.code = "run-control-revision-conflict";
    conflict.expected_revision = options.expectedRevision;
    conflict.current_revision = previousSequence;
    throw conflict;
  }
  const transition = resolveTransition(action, normalizeStatus(asString(stateBefore?.status)));
  const guardrails = evaluateGuardrails(profile, action, approvalRef, targetStep);
  const preflightBlock = asRecord(options.preflightBlock);
  const preflightBlockedReason =
    action === "start" && asString(preflightBlock.code)
      ? {
          code: asString(preflightBlock.code) ?? "preflight.blocked",
          message: asString(preflightBlock.message) ?? "Run start preflight blocked execution.",
        }
      : null;
  const blockedReason = guardrails.blocked
    ? guardrails.blocked_reason
    : transition.allowed
      ? preflightBlockedReason
      : {
          code: transition.code ?? "transition.invalid",
          message: transition.message ?? "Transition is not allowed.",
        };
  const blocked = Boolean(blockedReason);

  const actionSequence = previousSequence + 1;
  const stateFile = existingState.stateFile;
  const auditFile = resolveRunControlAuditFile(init, runId, actionSequence);
  const auditId = `${runId}.run-control.${String(actionSequence).padStart(4, "0")}`;
  const eventTimestamp = nowIso();

  const auditRecord = /** @type {Record<string, unknown>} */ (redactSensitiveValue({
    audit_id: auditId,
    run_id: runId,
    action,
    applied: !blocked,
    command_id: options.commandId,
    expected_revision: options.expectedRevision ?? null,
    revision: actionSequence,
    blocked,
    blocked_reason: blockedReason,
    requested_scope: {
      target_step: targetStep,
      reason,
      execution_plan_ref: executionPlanRef,
      execution_unit_id: executionUnitId,
      task_refs: taskRefs,
    },
    transition: {
      from_status: normalizeStatus(asString(stateBefore?.status)),
      to_status: blocked ? normalizeStatus(asString(stateBefore?.status)) : transition.nextStatus,
      source: existingState.source,
    },
    guardrails: guardrails.decision,
    approval_ref: approvalRef,
    blocking_evidence_refs: asStringArray(preflightBlock.evidenceRefs),
    provider_interruption:
      action === "cancel" && !blocked
        ? {
            status: "operator-stopped",
            provider_step_status: "interrupted",
            reason: reason ?? "Run canceled by operator.",
          }
        : null,
    evidence_root: init.runtimeLayout.reportsRoot,
    state_file: stateFile,
    timestamp: eventTimestamp,
  }, options.redactionPolicy));
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

    const providerStepStatus =
      action === "cancel" && !blocked
        ? mergeProviderStepStatus(asRecord(stateBefore?.provider_step_status), {
            status: "interrupted",
            finished_at: eventTimestamp,
            last_artifact_update_at: eventTimestamp,
            interruption_owner: "operator",
            interruption_reason: reason ?? "Run canceled by operator.",
            interruption_status: "operator-stopped",
            recommended_action: "Provider was stopped by the operator; save partial evidence, then diagnose or retry the public step.",
          })
        : Object.keys(asRecord(stateBefore?.provider_step_status)).length > 0
          ? asRecord(stateBefore?.provider_step_status)
          : null;

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
      provider_step_status: providerStepStatus,
      execution_plan_ref: executionPlanRef ?? asString(stateBefore?.execution_plan_ref),
      execution_unit_id: executionUnitId ?? asString(stateBefore?.execution_unit_id),
      task_refs: taskRefs.length > 0 ? taskRefs : asStringArray(stateBefore?.task_refs),
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
    commandId: options.commandId,
    revision: actionSequence,
    state: stateAfter,
    stateFile,
    auditRecord,
    auditFile,
    blocked,
    blockedReason,
    guardrails: guardrails.decision,
    transition: auditRecord.transition,
    applied: !blocked,
    nextActions: blocked && !stateAfter ? ["run start"] : resolveNextActions(action, stateAfter),
  };
}

export function applyRunControlAction(options) {
  const cwd = options.cwd ?? process.cwd();
  const init = initializeProjectRuntime({
    cwd,
    projectRef: options.projectRef,
    projectProfile: options.projectProfile,
    runtimeRoot: options.runtimeRoot,
  });
  const runId = asString(options.runId) ?? (options.action === "start" ? `run-control-${Date.now()}` : null);
  if (!runId) throw new Error(`Run-control action '${options.action}' requires 'runId'.`);
  requirePublicId("run_id", runId);
  const commandId = asString(options.commandId) ?? `command-${crypto.randomUUID()}`;
  requirePublicId("command_id", commandId);
  if (options.expectedRevision !== undefined && (!Number.isInteger(options.expectedRevision) || options.expectedRevision < 0)) {
    const error = new Error("expectedRevision must be a non-negative integer.");
    error.code = "run-control-revision-invalid";
    throw error;
  }
  const lockDirectory = path.join(init.runtimeLayout.stateRoot, `run-control-${normalizeId(runId)}.lock`);
  return withFileLock(lockDirectory, () => {
    const commandDirectory = path.join(init.runtimeLayout.stateRoot, "run-control-commands", normalizeId(runId));
    const commandFile = path.join(commandDirectory, `${normalizeId(commandId)}.json`);
    const requestDigest = crypto.createHash("sha256").update(JSON.stringify({
      action: options.action,
      target_step: options.targetStep ?? null,
      reason: options.reason ?? null,
      approval_ref: options.approvalRef ?? null,
      expected_revision: options.expectedRevision ?? null,
    })).digest("hex");
    if (fs.existsSync(commandFile)) {
      const stored = readJson(commandFile);
      if (stored.request_digest !== requestDigest) {
        const conflict = new Error(`Run-control command '${commandId}' was reused with a different payload.`);
        conflict.code = "run-control-command-conflict";
        throw conflict;
      }
      return stored.result;
    }
    const result = applyRunControlActionUnlocked({
      ...options,
      cwd,
      runId,
      commandId,
      initializedRuntime: init,
    });
    writeJsonAtomic(commandFile, { command_id: commandId, request_digest: requestDigest, result });
    return result;
  });
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef: string,
 *   projectProfile?: string,
 *   runtimeRoot?: string,
 *   runId: string,
 * }} options
 */
export function readRunControlState(options) {
  requirePublicId("run_id", options.runId);
  const cwd = options.cwd ?? process.cwd();
  const init = initializeProjectRuntime({
    cwd,
    projectRef: options.projectRef,
    projectProfile: options.projectProfile,
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
