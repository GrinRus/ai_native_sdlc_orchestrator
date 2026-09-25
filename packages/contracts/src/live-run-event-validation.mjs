const INTERACTION_PERMISSION_DECISION_VALUES = ["approve_once", "deny", "approve_for_run"];

/**
 * @param {Record<string, Function>} validators
 * @returns {(document: Record<string, unknown>, source: string) => import("./index.d.ts").ContractValidationIssue[]}
 */
export function createLiveRunEventValidator(validators) {
  const {
    isPlainObject,
    validateNestedNumberField,
    validateUnsupportedNestedFields,
    validateOptionalObjectField,
    validateNestedEnumStringField,
    validateNestedStringField,
    validateOptionalStringArrayField,
    validateOptionalArrayField,
    validateEnumString,
    validateNestedBooleanField,
    interactionStatusValues,
    interactionTypeValues,
  } = validators;

  function validatePermissionRequest(record, source, issues) {
    const parentField = "payload.interaction.permission_request";
    for (const field of ["operation_type", "resource_type", "resource_label"]) {
      validateNestedStringField({ record, source, field: `${parentField}.${field}`, issues, required: false });
    }
    validateOptionalStringArrayField({ record, source, field: `${parentField}.capabilities`, issues });
    const allowedDecisions = validateOptionalArrayField({ record, source, field: `${parentField}.allowed_decisions`, issues });
    allowedDecisions?.forEach((decision, index) => {
      validateEnumString(decision, source, `${parentField}.allowed_decisions[${index}]`, INTERACTION_PERMISSION_DECISION_VALUES, issues);
    });
    validateUnsupportedNestedFields({
      record,
      source,
      parentField,
      fields: ["answer", "answer_text", "raw_answer", "canonical_resource", "command", "command_args", "target", "target_path"],
      issues,
    });
  }

  function validateContinuation(record, source, issues) {
    const parentField = "payload.interaction.continuation";
    validateNestedStringField({ record, source, field: `${parentField}.next_action`, issues, required: true });
    validateNestedStringField({ record, source, field: `${parentField}.reason_code`, issues, required: false });
  }

  function validateInteraction(record, source, issues) {
    const parentField = "payload.interaction";
    validateNestedEnumStringField({ record, source, field: `${parentField}.status`, allowedValues: interactionStatusValues, issues, required: true });
    validateNestedStringField({ record, source, field: `${parentField}.step_result_ref`, issues, required: false });
    validateNestedStringField({ record, source, field: `${parentField}.question_summary`, issues, required: false });
    validateNestedEnumStringField({ record, source, field: `${parentField}.interaction_type`, allowedValues: interactionTypeValues, issues, required: false });

    const permissionRequest = validateOptionalObjectField({ record, source, field: `${parentField}.permission_request`, issues });
    if (permissionRequest) validatePermissionRequest(permissionRequest, source, issues);
    validateNestedBooleanField({ record, source, field: `${parentField}.answer_required`, issues, required: false });
    validateOptionalStringArrayField({ record, source, field: `${parentField}.answer_audit_refs`, issues });

    const continuation = validateOptionalObjectField({ record, source, field: `${parentField}.continuation`, issues });
    if (continuation) validateContinuation(continuation, source, issues);
    validateUnsupportedNestedFields({ record, source, parentField, fields: ["answer", "answer_text", "raw_answer"], issues });
  }

  return function validateLiveRunEvent(document, source) {
    /** @type {import("./index.d.ts").ContractValidationIssue[]} */
    const issues = [];
    if (!isPlainObject(document.payload)) return issues;

    validateNestedNumberField({ record: document.payload, source, field: "payload.sequence", issues, required: true });
    validateUnsupportedNestedFields({
      record: document.payload,
      source,
      parentField: "payload",
      fields: ["answer", "answer_text", "raw_answer"],
      issues,
    });
    const interaction = validateOptionalObjectField({ record: document.payload, source, field: "payload.interaction", issues });
    if (interaction) validateInteraction(interaction, source, issues);
    return issues;
  };
}
