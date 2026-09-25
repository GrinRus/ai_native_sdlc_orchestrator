import { asRecord, asString, asStringArray } from "../shared/value-normalization.mjs";
const PERMISSION_DECISIONS = ["approve_once", "deny", "approve_for_run"];
const INTERACTION_TYPES = ["permission_request", "clarification_question", "auth_required"];
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/u;

function safeIdentifier(value) {
  const candidate = asString(value);
  return candidate && SAFE_IDENTIFIER.test(candidate) ? candidate : null;
}

function safeResourceLabel(request) {
  const relative = asString(request.relative_resource);
  if (relative && !relative.startsWith("/") && !relative.startsWith("\\") && !/^[A-Za-z]:[\\/]/u.test(relative) && !relative.split(/[\\/]+/u).includes("..")) {
    return relative.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/gu, "").slice(0, 240) || null;
  }

  if (asString(request.resource_type) === "network") {
    try {
      const url = new URL(asString(request.canonical_resource) ?? "");
      if (["http:", "https:"].includes(url.protocol)) return url.host.slice(0, 240) || null;
    } catch {
      return null;
    }
  }

  if (asString(request.resource_type) === "process") {
    const parser = asRecord(request.command_parser);
    const executable = safeIdentifier(parser.executable);
    const subcommand = safeIdentifier(parser.subcommand);
    if (parser.parsed === true && executable) return [executable, subcommand].filter(Boolean).join(" ").slice(0, 240);
  }
  return null;
}

function permissionSummary(interaction) {
  const request = asRecord(interaction.runtime_permission_request);
  const capabilities = Object.entries(asRecord(request.capabilities))
    .filter(([name, enabled]) => enabled === true && /^[a-z][a-z0-9_]{0,63}$/u.test(name))
    .map(([name]) => name)
    .sort();
  const resourceLabel = safeResourceLabel(request);
  const operationType = safeIdentifier(request.operation_type);
  const resourceType = safeIdentifier(request.resource_type);
  const allowedDecisions = asStringArray(interaction.allowed_decisions).filter((value) => PERMISSION_DECISIONS.includes(value));
  return {
    ...(operationType ? { operation_type: operationType } : {}),
    ...(resourceType ? { resource_type: resourceType } : {}),
    ...(resourceLabel ? { resource_label: resourceLabel } : {}),
    capabilities,
    allowed_decisions: allowedDecisions,
  };
}

export function toRequestedInteractionEventSummary(value, stepResultRef) {
  const interaction = asRecord(value);
  const status = asString(interaction.status) ?? "requested";
  const candidateType = asString(interaction.interaction_type);
  const interactionType = INTERACTION_TYPES.includes(candidateType) ? candidateType : null;
  const continuation = asRecord(interaction.continuation);
  return {
    interaction_id: asString(interaction.interaction_id),
    status,
    step_result_ref: stepResultRef,
    question_summary: asString(interaction.prompt_summary) ?? asString(interaction.summary),
    ...(interactionType ? { interaction_type: interactionType } : {}),
    ...(interactionType === "permission_request" ? { permission_request: permissionSummary(interaction) } : {}),
    answer_required: status === "requested",
    answer_audit_refs: asStringArray(interaction.answer_audit_refs),
    continuation: {
      ...(asString(continuation.next_action) ? { next_action: asString(continuation.next_action) } : {}),
      ...(asString(continuation.reason_code) ? { reason_code: asString(continuation.reason_code) } : {}),
    },
  };
}

export function toInteractionHistorySummary(value) {
  const interaction = asRecord(value);
  const continuation = asRecord(interaction.continuation);
  const permissionRequest = asRecord(interaction.permission_request);
  return {
    interaction_id: asString(interaction.interaction_id),
    status: asString(interaction.status),
    step_result_ref: asString(interaction.step_result_ref),
    question_summary: asString(interaction.question_summary),
    interaction_type: INTERACTION_TYPES.includes(asString(interaction.interaction_type)) ? asString(interaction.interaction_type) : null,
    permission_request:
      Object.keys(permissionRequest).length > 0
        ? {
            operation_type: asString(permissionRequest.operation_type),
            resource_type: asString(permissionRequest.resource_type),
            resource_label: asString(permissionRequest.resource_label),
            capabilities: asStringArray(permissionRequest.capabilities),
            allowed_decisions: asStringArray(permissionRequest.allowed_decisions).filter((value) => PERMISSION_DECISIONS.includes(value)),
          }
        : null,
    answer_required: interaction.answer_required === true,
    answer_audit_refs: asStringArray(interaction.answer_audit_refs),
    continuation:
      Object.keys(continuation).length > 0
        ? {
            next_action: asString(continuation.next_action),
            reason_code: asString(continuation.reason_code),
          }
        : null,
  };
}
