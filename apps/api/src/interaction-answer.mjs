import fs from "node:fs";
import path from "node:path";

import { initializeProjectRuntime } from "../../../packages/orchestrator-core/src/project-init.mjs";

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
 * @param {{
 *   cwd?: string,
 *   projectRef: string,
 *   runtimeRoot?: string,
 *   runId: string,
 *   interactionId: string,
 *   answer: string,
 *   reason?: string,
 *   approvalRef?: string,
 *   answerEvidenceRef?: string,
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
  const answerAudit = {
    audit_id: auditId,
    created_at: timestamp,
    run_id: options.runId,
    interaction_id: options.interactionId,
    step_result_ref: match.artifactRef,
    step_result_file: match.file,
    answer_text: options.answer,
    answer_evidence_refs: answerEvidenceRefs,
    reason: options.reason ?? null,
    approval_ref: options.approvalRef ?? null,
    evidence_refs: uniqueStrings([match.artifactRef, ...answerEvidenceRefs]),
  };
  fs.writeFileSync(auditFile, `${JSON.stringify(answerAudit, null, 2)}\n`, "utf8");

  const previousAnswerRefs = asStringArray(match.requestedInteraction.answer_audit_refs);
  const questionSummary = asString(match.requestedInteraction.prompt_summary) ?? asString(match.requestedInteraction.summary);
  const blockedReason = {
    code: "continuation.runtime_boundary_unavailable",
    message: "Answer audit was accepted, but this runtime cannot yet resume from the recorded interaction boundary.",
  };
  const requestedInteraction = {
    ...match.requestedInteraction,
    interaction_id: options.interactionId,
    status: "blocked",
    answer_audit_refs: uniqueStrings([...previousAnswerRefs, answerAuditRef]),
    continuation: {
      next_action: "remain_blocked",
      reason_code: blockedReason.code,
      summary: blockedReason.message,
    },
  };
  const nextDocument = {
    ...match.document,
    requested_interaction: requestedInteraction,
    evidence_refs: uniqueStrings([...asStringArray(match.document.evidence_refs), answerAuditRef]),
  };
  fs.writeFileSync(match.file, `${JSON.stringify(nextDocument, null, 2)}\n`, "utf8");

  const evidenceEvent = appendRunEvent({
    cwd: options.cwd,
    projectRef: options.projectRef,
    runtimeRoot: options.runtimeRoot,
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
    runId: options.runId,
    eventType: "step.updated",
    payload: {
      interaction: {
        interaction_id: options.interactionId,
        status: "blocked",
        step_result_ref: match.artifactRef,
        question_summary: questionSummary,
        answer_required: false,
        answer_audit_refs: [answerAuditRef],
      },
      summary: blockedReason.message,
    },
  });
  const warningEvent = appendRunEvent({
    cwd: options.cwd,
    projectRef: options.projectRef,
    runtimeRoot: options.runtimeRoot,
    runId: options.runId,
    eventType: "warning.raised",
    payload: {
      code: blockedReason.code,
      interaction_id: options.interactionId,
      step_result_ref: match.artifactRef,
      answer_audit_ref: answerAuditRef,
      summary: blockedReason.message,
    },
  });

  return {
    runId: options.runId,
    interactionId: options.interactionId,
    interactionStatus: "blocked",
    answerAccepted: true,
    answerAuditFile: auditFile,
    answerAuditRef,
    stepResultFile: match.file,
    stepResultRef: match.artifactRef,
    runControlTransition: null,
    blocked: true,
    blockedReason,
    evidenceEvent: evidenceEvent.event,
    stepEvent: stepEvent.event,
    warningEvent: warningEvent.event,
    streamLogFile: warningEvent.logFile,
  };
}
