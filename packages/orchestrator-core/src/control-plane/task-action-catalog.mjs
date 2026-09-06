/**
 * Canonical server-owned Task/Flow action catalog.
 *
 * The catalog is intentionally transport-neutral. HTTP, CLI and browser
 * consumers use the same action id, payload contract and permission metadata;
 * transports never maintain a second allowlist.
 */

const entries = [
  { action_id: "confirm", category: "mutation", permission: "mutate", dispatch: "intent.confirm", payload: { expected_revision: { type: "integer", required: false, ui_required: true } }, requires_confirmation: false },
  { action_id: "start", category: "mutation", permission: "mutate", dispatch: "intent.start", payload: { expected_revision: { type: "integer", required: false, ui_required: true } }, requires_confirmation: false },
  { action_id: "pause", category: "mutation", permission: "mutate", dispatch: "run-control", payload: { expected_revision: { type: "integer", required: false }, reason: { type: "string", required: false } }, requires_confirmation: false },
  { action_id: "resume", category: "mutation", permission: "mutate", dispatch: "run-control", payload: { expected_revision: { type: "integer", required: false }, reason: { type: "string", required: false } }, requires_confirmation: false },
  { action_id: "steer", category: "mutation", permission: "mutate", dispatch: "run-control", payload: { expected_revision: { type: "integer", required: false }, reason: { type: "string", required: true } }, requires_confirmation: false },
  { action_id: "cancel", category: "mutation", permission: "mutate", dispatch: "run-control", payload: { expected_revision: { type: "integer", required: false }, reason: { type: "string", required: false } }, requires_confirmation: true },
  { action_id: "retry", category: "mutation", permission: "mutate", dispatch: "operator-request", payload: { request_text: { type: "string", required: false }, allowed_paths: { type: "string[]", required: false }, idempotency_key: { type: "string", required: false } }, requires_confirmation: false },
  { action_id: "request", category: "mutation", permission: "mutate", dispatch: "operator-request", payload: { request_text: { type: "string", required: true }, intent_type: { type: "string", required: false }, allowed_paths: { type: "string[]", required: false }, idempotency_key: { type: "string", required: false } }, requires_confirmation: false },
  { action_id: "follow-up", category: "mutation", permission: "mutate", dispatch: "follow-up", payload: { request_text: { type: "string", required: true } }, requires_confirmation: false },
  { action_id: "intent.resume", category: "mutation", permission: "mutate", dispatch: "intent.prepare", payload: {}, requires_confirmation: false },
  { action_id: "discovery-run", category: "mutation", permission: "mutate", dispatch: "lifecycle", lifecycle_command: "discovery run", payload: {}, requires_confirmation: false },
  { action_id: "spec-build", category: "mutation", permission: "mutate", dispatch: "lifecycle", lifecycle_command: "spec build", payload: {}, requires_confirmation: false },
  { action_id: "plan-create", category: "mutation", permission: "mutate", dispatch: "lifecycle", lifecycle_command: "plan create", payload: {}, requires_confirmation: false },
  { action_id: "review-run", category: "mutation", permission: "mutate", dispatch: "lifecycle", lifecycle_command: "review run", payload: {}, requires_confirmation: false },
  { action_id: "delivery-prepare", category: "mutation", permission: "mutate", dispatch: "lifecycle", lifecycle_command: "deliver prepare", payload: {}, requires_confirmation: true },
  { action_id: "release-prepare", category: "mutation", permission: "mutate", dispatch: "lifecycle", lifecycle_command: "release prepare", payload: {}, requires_confirmation: true },
  { action_id: "learning-handoff", category: "mutation", permission: "mutate", dispatch: "lifecycle", lifecycle_command: "learning handoff", payload: {}, requires_confirmation: true },
  { action_id: "mission-create", category: "mutation", permission: "mutate", dispatch: "lifecycle", lifecycle_command: "mission create", payload: {}, requires_confirmation: true },
  { action_id: "handoff-approve", category: "mutation", permission: "mutate", dispatch: "lifecycle", lifecycle_command: "handoff approve", payload: { approval_ref: { type: "string", required: true } }, requires_confirmation: true },
  { action_id: "review-decide", category: "mutation", permission: "mutate", dispatch: "lifecycle", lifecycle_command: "review decide", payload: { decision: { type: "string", required: true }, reason: { type: "string", required: false } }, requires_confirmation: true },
  { action_id: "inspect-active-run", category: "workbench", permission: "read", dispatch: "readback", payload: {}, requires_confirmation: false },
  { action_id: "inspect-quality-repair", category: "refresh", permission: "read", dispatch: "readback", payload: {}, requires_confirmation: false },
  { action_id: "fix-onboarding", category: "workbench", permission: "read", dispatch: "readback", payload: {}, requires_confirmation: false },
  { action_id: "fix-delivery-blockers", category: "evidence", permission: "read", dispatch: "readback", payload: {}, requires_confirmation: false },
  { action_id: "repair-mission-intake", category: "workbench", permission: "read", dispatch: "readback", payload: {}, requires_confirmation: false },
  { action_id: "repair-review-gate", category: "workbench", permission: "read", dispatch: "readback", payload: {}, requires_confirmation: false },
  { action_id: "resolve-review-hold", category: "workbench", permission: "read", dispatch: "readback", payload: {}, requires_confirmation: false },
  { action_id: "hold-exhausted-quality-repair", category: "workbench", permission: "read", dispatch: "readback", payload: {}, requires_confirmation: false },
  { action_id: "run-review-repair", category: "workbench", permission: "read", dispatch: "readback", payload: {}, requires_confirmation: true },
  { action_id: "run-review-quality-repair", category: "workbench", permission: "read", dispatch: "readback", payload: {}, requires_confirmation: true },
  { action_id: "run-qa-quality-repair", category: "workbench", permission: "read", dispatch: "readback", payload: {}, requires_confirmation: true },
  { action_id: "qa-quality-repair", category: "workbench", permission: "read", dispatch: "readback", payload: {}, requires_confirmation: false },
  { action_id: "start-new-flow", category: "workbench", permission: "read", dispatch: "readback", payload: {}, requires_confirmation: false },
  { action_id: "complete-mission-intake", category: "workbench", permission: "read", dispatch: "readback", payload: {}, requires_confirmation: false },
  { action_id: "closure-complete", category: "evidence", permission: "read", dispatch: "readback", payload: {}, requires_confirmation: false },
];

const CATALOG = Object.freeze(entries.map((entry) => Object.freeze({ ...entry, payload: Object.freeze({ ...entry.payload }) })));
const BY_ID = new Map(CATALOG.map((entry) => [entry.action_id, entry]));

export const TASK_ACTION_CATALOG = CATALOG;

export function getTaskActionCatalog() {
  return CATALOG.map((entry) => ({ ...entry, payload: { ...entry.payload } }));
}

export function getTaskActionDefinition(actionId) {
  return BY_ID.get(typeof actionId === "string" ? actionId.trim() : "") ?? null;
}

function validScalar(value, type) {
  if (type === "integer") return Number.isInteger(value) && value >= 0;
  if (type === "string") return typeof value === "string" && value.trim().length > 0;
  if (type === "string[]") return Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim().length > 0);
  return true;
}

export function validateTaskActionPayload(actionId, payload = {}) {
  const definition = getTaskActionDefinition(actionId);
  if (!definition) return { ok: false, code: "task.unknown_action", message: `Unknown Task action '${actionId ?? "missing"}'.`, definition: null, field_errors: [] };
  const value = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  const fieldErrors = [];
  for (const [field, rule] of Object.entries(definition.payload)) {
    if (rule.required && !validScalar(value[field], rule.type)) fieldErrors.push({ field, code: "required", message: `${field} is required for action '${definition.action_id}'.` });
    else if (value[field] !== undefined && !validScalar(value[field], rule.type)) fieldErrors.push({ field, code: "invalid", message: `${field} must be a non-negative integer, non-empty string, or string array as declared by the action catalog.` });
  }
  return fieldErrors.length > 0
    ? { ok: false, code: "task.invalid_payload", message: `Payload does not satisfy action '${definition.action_id}'.`, definition, field_errors: fieldErrors }
    : { ok: true, definition, field_errors: [] };
}
