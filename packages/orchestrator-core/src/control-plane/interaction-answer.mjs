import fs from "node:fs";
import path from "node:path";

import { redactSensitiveValue } from "../../../observability/src/index.mjs";
import { initializeProjectRuntime } from "../project-init.mjs";

import { appendRunEvent } from "./live-event-stream.mjs";
import { listStepResults, toEvidenceRef } from "./read-artifact-readers.mjs";

export class InteractionAnswerError extends Error {
  /**
   * @param {number} statusCode
   * @param {string} code
   * @param {string} message
   */
  constructor(statusCode, code, message) {
    super(message);
    this.name = "InteractionAnswerError";
    this.statusCode = statusCode;
    this.code = code;
  }
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
 * @returns {Record<string, unknown>}
 */
function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value)
    : {};
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function asStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((entry) => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim());
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeId(value) {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * @param {Record<string, unknown>} requestedInteraction
 * @returns {boolean}
 */
function isUnresolvedInteraction(requestedInteraction) {
  if (requestedInteraction.requested !== true) {
    return false;
  }
  const status = asString(requestedInteraction.status) ?? "requested";
  return status === "requested";
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef: string,
 *   runtimeRoot?: string,
 *   runId: string,
 *   interactionId: string,
 * }}
 * @returns {{ file: string, artifactRef: string, document: Record<string, unknown>, requestedInteraction: Record<string, unknown> } | null}
 */
function findUnresolvedInteraction(options) {
  const stepResults = listStepResults({
    cwd: options.cwd,
    projectRef: options.projectRef,
    runtimeRoot: options.runtimeRoot,
  });

  for (const stepResult of stepResults) {
    const document = stepResult.document;
    if (asString(document.run_id) !== options.runId) {
      continue;
    }

    const requestedInteraction = asRecord(document.requested_interaction);
    if (!isUnresolvedInteraction(requestedInteraction)) {
      continue;
    }

    if (asString(requestedInteraction.interaction_id) !== options.interactionId) {
      continue;
    }

    return {
      file: stepResult.file,
      artifactRef: stepResult.artifact_ref,
      document,
      requestedInteraction,
    };
  }

  return null;
}

/**
 * @param {string[]} values
 * @returns {string[]}
 */
function uniqueStrings(values) {
  return Array.from(new Set(values.filter((value) => typeof value === "string" && value.trim().length > 0)));
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
 * @param {unknown} value
 * @returns {Record<string, unknown> | null}
 */
function optionalRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value)
    : null;
}

/**
 * @param {unknown} value
 * @returns {"approve_once" | "approve_for_run" | "deny" | null}
 */
function normalizeOperatorDecision(value) {
  const normalized = asString(value);
  if (normalized === "approve_once" || normalized === "approve_for_run" || normalized === "deny") {
    return normalized;
  }
  return null;
}

/**
 * @param {string | null} decision
 * @returns {"user_approved" | "user_denied" | null}
 */
function runtimePermissionDecisionValue(decision) {
  if (decision === "approve_once" || decision === "approve_for_run") {
    return "user_approved";
  }
  if (decision === "deny") {
    return "user_denied";
  }
  return null;
}

/**
 * @param {{
 *   status: "requested" | "answered" | "resumed" | "resume_failed" | "blocked",
 *   timestamp: string,
 *   summary?: string | null,
 *   evidenceRefs?: string[],
 *   answerAuditRefs?: string[],
 *   continuation?: Record<string, unknown> | null,
 * }}
 * @returns {Record<string, unknown>}
 */
function buildInteractionStateEntry(options) {
  const entry = {
    status: options.status,
    timestamp: options.timestamp,
    summary: options.summary ?? null,
    evidence_refs: uniqueStrings(options.evidenceRefs ?? []),
    answer_audit_refs: uniqueStrings(options.answerAuditRefs ?? []),
  };
  if (options.continuation) {
    entry.continuation = options.continuation;
  }
  return entry;
}

/**
 * @param {{
 *   requestedInteraction: Record<string, unknown>,
 *   timestamp: string,
 *   questionSummary?: string | null,
 *   questionEvidenceRefs: string[],
 * }}
 * @returns {Array<Record<string, unknown>>}
 */
function resolveExistingStateHistory(options) {
  const existing = asRecordArray(options.requestedInteraction.state_history);
  if (existing.length > 0) {
    return existing;
  }

  return [
    buildInteractionStateEntry({
      status: "requested",
      timestamp: options.timestamp,
      summary: options.questionSummary ?? "Operator input requested.",
      evidenceRefs: options.questionEvidenceRefs,
      continuation: optionalRecord(options.requestedInteraction.continuation) ?? {
        next_action: "resume_from_boundary",
        reason_code: "operator-answer-required",
      },
    }),
  ];
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef: string,
 *   runtimeRoot?: string,
 *   runId: string,
 *   interactionId: string,
 *   answer: string,
 *   decision?: string,
 *   reason?: string,
 *   approvalRef?: string,
 *   answerEvidenceRef?: string,
 *   redactionPolicy?: unknown,
 * }}
 */
export function submitInteractionAnswer(options) {
  const match = findUnresolvedInteraction(options);
  if (!match) {
    throw new InteractionAnswerError(
      409,
      "interaction_answer.not_found",
      "No unresolved run-linked requested_interaction matched the supplied run_id and interaction_id.",
    );
  }

  const init = initializeProjectRuntime({
    cwd: options.cwd,
    projectRef: options.projectRef,
    runtimeRoot: options.runtimeRoot,
  });
  const timestamp = new Date().toISOString();
  const auditId = `interaction-answer-${normalizeId(options.runId)}-${normalizeId(options.interactionId)}-${Date.now()}`;
  const auditFile = path.join(init.runtimeLayout.reportsRoot, `${auditId}.json`);
  const answerAuditRef = toEvidenceRef(init, auditFile);
  const answerEvidenceRefs = uniqueStrings([options.answerEvidenceRef ?? ""]);
  const operatorDecision = normalizeOperatorDecision(options.decision);
  if (options.decision !== undefined && !operatorDecision) {
    throw new InteractionAnswerError(
      400,
      "interaction_answer.invalid_decision",
      "decision must be one of: approve_once, deny, approve_for_run.",
    );
  }
  const permissionInteraction = asString(match.requestedInteraction.interaction_type) === "permission_request";
  if (permissionInteraction && !operatorDecision) {
    throw new InteractionAnswerError(
      400,
      "interaction_answer.decision_required",
      "permission_request interactions require decision=approve_once, deny, or approve_for_run.",
    );
  }
  if (!permissionInteraction && operatorDecision) {
    throw new InteractionAnswerError(
      400,
      "interaction_answer.invalid_decision_context",
      "structured decisions are only valid for permission_request interactions.",
    );
  }
  const existingRuntimePermissionDecision = asRecord(match.requestedInteraction.runtime_permission_decision);
  const operatorRuntimePermissionDecision =
    permissionInteraction && operatorDecision
      ? {
          ...existingRuntimePermissionDecision,
          decision: runtimePermissionDecisionValue(operatorDecision),
          operator_decision: operatorDecision,
          approval_scope:
            operatorDecision === "deny"
              ? "none"
              : asString(existingRuntimePermissionDecision.approval_scope) ?? "step-coarse",
          approval_resume_mode:
            operatorDecision === "deny"
              ? null
              : asString(existingRuntimePermissionDecision.approval_resume_mode) ?? "full-bypass",
          audit_ref: answerAuditRef,
        }
      : null;
  const answerAudit = /** @type {Record<string, unknown>} */ (redactSensitiveValue({
    audit_id: auditId,
    created_at: timestamp,
    run_id: options.runId,
    interaction_id: options.interactionId,
    step_result_ref: match.artifactRef,
    step_result_file: match.file,
    answer_text: options.answer,
    decision: operatorDecision,
    answer_evidence_refs: answerEvidenceRefs,
    reason: options.reason ?? null,
    approval_ref: options.approvalRef ?? null,
    ...(permissionInteraction
      ? {
          runtime_permission_request: asRecord(match.requestedInteraction.runtime_permission_request),
          runtime_permission_decision: operatorRuntimePermissionDecision,
        }
      : {}),
    evidence_refs: uniqueStrings([match.artifactRef, ...answerEvidenceRefs]),
  }, options.redactionPolicy));
  fs.writeFileSync(auditFile, `${JSON.stringify(answerAudit, null, 2)}\n`, "utf8");

  const previousAnswerRefs = asStringArray(match.requestedInteraction.answer_audit_refs);
  const questionSummary = asString(match.requestedInteraction.prompt_summary) ?? asString(match.requestedInteraction.summary);
  const questionEvidenceRefs = uniqueStrings([
    ...asStringArray(match.requestedInteraction.question_evidence_refs),
    ...asStringArray(match.requestedInteraction.evidence_refs),
  ]);
  const requestedContinuation = asRecord(match.requestedInteraction.continuation);
  const canResume = !permissionInteraction && asString(requestedContinuation.next_action) === "resume_from_boundary";
  const blockedReason = canResume
    ? null
    : {
        code: permissionInteraction ? "continuation.reinvoke_required" : "continuation.resume_failed",
        message: permissionInteraction
          ? "Permission answer audit was accepted, but this runtime requires a step reinvocation before it can resume."
          : "Answer audit was accepted, but the recorded interaction boundary is not resumable.",
      };
  const previousHistory = resolveExistingStateHistory({
    requestedInteraction: match.requestedInteraction,
    timestamp,
    questionSummary,
    questionEvidenceRefs,
  });
  const answeredHistoryEntry = buildInteractionStateEntry({
    status: "answered",
    timestamp,
    summary: "Operator answer audit evidence accepted.",
    evidenceRefs: [answerAuditRef],
    answerAuditRefs: [answerAuditRef],
    continuation: {
      next_action: "resume_from_boundary",
      reason_code: "answer-accepted",
    },
  });
  const resumedHistoryEntry = buildInteractionStateEntry({
    status: canResume ? "resumed" : "resume_failed",
    timestamp,
    summary: canResume
      ? "Runtime resumed from the recorded interaction boundary after answer audit evidence was accepted."
      : blockedReason?.message,
    evidenceRefs: [answerAuditRef],
    answerAuditRefs: [answerAuditRef],
    continuation: {
      next_action: canResume ? "continue_run" : "remain_blocked",
      reason_code: canResume ? "answer-resumed" : blockedReason?.code,
      summary: canResume ? "Interaction answer resumed the recorded runtime boundary." : blockedReason?.message,
    },
  });
  const requestedInteraction = {
    ...match.requestedInteraction,
    interaction_id: options.interactionId,
    status: canResume ? "resumed" : "blocked",
    answer_audit_refs: uniqueStrings([...previousAnswerRefs, answerAuditRef]),
    ...(permissionInteraction
      ? {
          runtime_permission_decision: operatorRuntimePermissionDecision,
        }
      : {}),
    continuation: {
      next_action: canResume ? "continue_run" : "remain_blocked",
      reason_code: canResume ? "answer-resumed" : blockedReason?.code,
      summary: canResume ? "Interaction answer resumed the recorded runtime boundary." : blockedReason?.message,
    },
    state_history: [...previousHistory, answeredHistoryEntry, resumedHistoryEntry],
  };
  const nextDocument = {
    ...match.document,
    ...(canResume
      ? {
          status: asString(match.document.status) === "failed" ? "passed" : match.document.status,
          summary: "Operator answer accepted; runtime resumed from the recorded interaction boundary.",
          failure_class: asString(match.document.failure_class) === "interactive-question-requested" ? null : match.document.failure_class,
          runtime_harness_decision:
            asString(match.document.runtime_harness_decision) === "block" ? "pass" : match.document.runtime_harness_decision,
        }
      : {}),
    requested_interaction: requestedInteraction,
    ...(permissionInteraction
      ? {
          runtime_permission_decision: requestedInteraction.runtime_permission_decision,
        }
      : {}),
    evidence_refs: uniqueStrings([...asStringArray(match.document.evidence_refs), answerAuditRef]),
  };
  fs.writeFileSync(match.file, `${JSON.stringify(nextDocument, null, 2)}\n`, "utf8");

  const evidenceEvent = appendRunEvent({
    cwd: options.cwd,
    projectRef: options.projectRef,
    runtimeRoot: options.runtimeRoot,
    redactionPolicy: options.redactionPolicy,
    runId: options.runId,
    eventType: "evidence.linked",
    payload: {
      interaction_id: options.interactionId,
      answer_audit_ref: answerAuditRef,
      step_result_ref: match.artifactRef,
      answer_text_present: false,
      summary: "Operator answer audit evidence accepted.",
    },
  });
  const stepEvent = appendRunEvent({
    cwd: options.cwd,
    projectRef: options.projectRef,
    runtimeRoot: options.runtimeRoot,
    redactionPolicy: options.redactionPolicy,
    runId: options.runId,
    eventType: "step.updated",
    payload: {
      interaction: {
        interaction_id: options.interactionId,
        status: "answered",
        step_result_ref: match.artifactRef,
        question_summary: questionSummary,
        answer_required: false,
        answer_audit_refs: [answerAuditRef],
        continuation: {
          next_action: "resume_from_boundary",
          reason_code: "answer-accepted",
        },
      },
      summary: "Operator answer audit evidence accepted.",
    },
  });
  const resumedEvent = appendRunEvent({
    cwd: options.cwd,
    projectRef: options.projectRef,
    runtimeRoot: options.runtimeRoot,
    redactionPolicy: options.redactionPolicy,
    runId: options.runId,
    eventType: "step.updated",
    payload: {
      interaction: {
        interaction_id: options.interactionId,
        status: canResume ? "resumed" : "blocked",
        step_result_ref: match.artifactRef,
        question_summary: questionSummary,
        answer_required: false,
        answer_audit_refs: [answerAuditRef],
        continuation: {
          next_action: canResume ? "continue_run" : "remain_blocked",
          reason_code: canResume ? "answer-resumed" : blockedReason?.code,
        },
      },
      summary: canResume
        ? "Runtime resumed from the recorded interaction boundary."
        : blockedReason?.message,
    },
  });
  const warningEvent = blockedReason
    ? appendRunEvent({
        cwd: options.cwd,
        projectRef: options.projectRef,
        runtimeRoot: options.runtimeRoot,
        redactionPolicy: options.redactionPolicy,
        runId: options.runId,
        eventType: "warning.raised",
        payload: {
          code: blockedReason.code,
          interaction_id: options.interactionId,
          step_result_ref: match.artifactRef,
          answer_audit_ref: answerAuditRef,
          summary: blockedReason.message,
        },
      })
    : null;

  return {
    projectRoot: init.projectRoot,
    runtimeRoot: init.runtimeRoot,
    runtimeLayout: init.runtimeLayout,
    projectProfileRef: init.projectProfileRef,
    runId: options.runId,
    interactionId: options.interactionId,
    interactionStatus: canResume ? "resumed" : "blocked",
    answerAccepted: true,
    decision: operatorDecision,
    answerAuditFile: auditFile,
    answerAuditRef,
    stepResultFile: match.file,
    stepResultRef: match.artifactRef,
    runControlTransition: canResume
      ? {
          status: "resumed",
          transition: "interaction-answer-resume",
          step_result_ref: match.artifactRef,
          answer_audit_ref: answerAuditRef,
        }
      : null,
    blocked: !canResume,
    blockedReason,
    evidenceEvent: evidenceEvent.event,
    stepEvent: stepEvent.event,
    resumedEvent: resumedEvent.event,
    blockedEvent: canResume ? null : resumedEvent.event,
    warningEvent: warningEvent?.event ?? null,
    streamLogFile: (warningEvent ?? resumedEvent).logFile,
  };
}
