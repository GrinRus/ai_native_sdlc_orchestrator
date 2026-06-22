import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

import {
  CONTRACT_FAMILY_INDEX,
  INTAKE_SOURCE_KIND_VALUES,
  LIVE_E2E_OBSERVATION_STATUS_VALUES,
} from "./families.mjs";
import { inferFamilyFromExamplePath } from "./example-paths.mjs";
import { cloneJson, describeActualType, isExpectedType, isPlainObject, issue } from "./utils.mjs";

const DELIVERY_MODE_VALUES = ["no-write", "patch-only", "local-branch", "fork-first-pr"];
const INTERACTION_STATUS_VALUES = ["requested", "answered", "resumed", "resume_failed", "blocked"];
const INTERACTION_TYPE_VALUES = ["permission_request", "clarification_question", "auth_required"];
const LIVE_E2E_SCENARIO_VALUES = ["regress", "release", "repair", "governance"];
const LIVE_E2E_PROVIDER_VARIANT_VALUES = ["openai-primary", "anthropic-primary", "open-code-primary", "qwen-primary"];
const LIVE_E2E_FEATURE_SIZE_VALUES = ["small", "medium", "large", "xlarge"];
const LIVE_E2E_MISSION_CLASS_VALUES = ["flow-regression", "product-change"];
const LIVE_E2E_REQUIRED_SETUP_STEPS = ["install", "target_checkout", "project_bootstrap", "intake", "readiness"];
const LIVE_E2E_RUN_HEALTH_STATUS_VALUES = ["pass", "warn", "fail", "blocked"];
const LIVE_E2E_RUN_FAILURE_OWNER_VALUES = [
  "aor",
  "target_repository",
  "provider",
  "environment",
  "operator",
  "unknown",
];
const LIVE_E2E_RUN_FAILURE_PHASE_VALUES = [
  "aor_install",
  "target_checkout",
  "project_bootstrap",
  "intake",
  "readiness",
  "target_setup",
  "target_verification",
  "provider_execution",
  "review",
  "controller_decision",
  "ui_validation",
  "delivery",
  "release",
  "learning",
  "summary_write",
  "unknown",
];
const COMPILED_CONTEXT_BUDGET_STATUS_VALUES = ["pass", "warn", "fail", "not_configured"];
const EXTERNAL_REQUEST_TRANSPORT_VALUES = ["request-artifact", "stdin-json", "file-attachment", "argv-json", "none"];
const STDIN_JSON_SCOPE_VALUES = ["test-only", "small-only"];
const LIVE_E2E_QUALITY_DIMENSION_KEYS = [
  "artifact_content_quality",
  "implementation_correctness",
  "implementation_completeness",
  "code_maintainability",
  "test_adequacy",
  "security_review",
  "performance_regression_risk",
  "verification_quality",
  "delivery_safety",
  "aor_operator_ui_ux_quality",
  "aor_operator_accessibility_quality",
  "evidence_strength",
  "acceptance_criteria_traceability",
];
const LIVE_E2E_LEGACY_QUALITY_DIMENSION_KEYS = ["ui_ux_quality", "accessibility_quality", "target_ui_ux_quality"];
const LIVE_E2E_AOR_OPERATOR_UI_SUBDIMENSION_KEYS = [
  "task_success",
  "flow_navigation_clarity",
  "next_action_clarity",
  "blocker_and_error_understandability",
  "recovery_affordance",
  "state_feedback_loading_empty_error",
  "visual_stability_responsiveness",
  "raw_json_independence",
];
const LIVE_E2E_AOR_OPERATOR_ACCESSIBILITY_SUBDIMENSION_KEYS = [
  "keyboard_navigation",
  "focus_order",
  "contrast_and_readability",
  "semantic_structure",
  "screen_reader_labels",
  "accessible_error_feedback",
];
const LIVE_E2E_DIAGNOSTIC_FAILURE_MODE_VALUES = ["warn", "fail"];
const LIVE_E2E_AOR_OPERATOR_UI_QUALITY_SUBDIMENSION_KEYS = {
  aor_operator_ui_ux_quality: LIVE_E2E_AOR_OPERATOR_UI_SUBDIMENSION_KEYS,
  aor_operator_accessibility_quality: LIVE_E2E_AOR_OPERATOR_ACCESSIBILITY_SUBDIMENSION_KEYS,
};
const LIVE_E2E_QUALITY_ASSESSMENT_STATUS_VALUES = ["pass", "warn", "fail", "not_evaluated"];
const LIVE_E2E_QUALITY_EVIDENCE_STRENGTH_VALUES = ["strong", "medium", "weak", "missing"];
const LIVE_E2E_STEP_QUALITY_STATUS_VALUES = ["accepted", "request_repair", "retry", "blocked"];
const LIVE_E2E_STEP_QUALITY_DECISION_VALUES = ["continue", "request-repair", "retry", "block"];
const LIVE_E2E_STEP_QUALITY_DIMENSION_KEYS = [
  "traceability",
  "completeness",
  "actionability",
  "evidence_strength",
  "black_box_boundary",
];
const LIVE_E2E_MISSION_SIZE_BUDGETS = {
  small: { max_changed_files: 16, max_added_lines: 900 },
  medium: { max_changed_files: 32, max_added_lines: 2200 },
  large: { max_changed_files: 64, max_added_lines: 4500 },
  xlarge: { max_changed_files: 100, max_added_lines: 10000 },
};
const LIVE_E2E_QUALITY_FINDING_CATEGORY_VALUES = [
  "artifact-content",
  "implementation-correctness",
  "test-adequacy",
  "security",
  "performance",
  "ui-ux",
  "accessibility",
  "evidence-gap",
  "acceptance-traceability",
  "follow-up-needed",
];
const VALIDATION_STATUS_VALUES = ["pass", "warn", "fail", "blocked"];
const REVIEW_STATUS_VALUES = ["pass", "warn", "fail"];
const RUNTIME_HARNESS_DECISION_VALUES = ["pass", "retry", "repair", "escalate", "block", "fail"];
const RUNTIME_HARNESS_RUN_CONTROLLER_STATUS_VALUES = ["running", "closed", "blocked", "failed"];
const RUNTIME_HARNESS_RUN_TRANSITION_STAGE_VALUES = [
  "prepare",
  "execute",
  "classify",
  "validate",
  "retry",
  "repair",
  "escalate",
  "verify",
  "close",
  "block",
];
const RUNTIME_HARNESS_RUN_TRANSITION_STATUS_VALUES = ["pass", "fail", "blocked", "skipped"];
const RUNTIME_HARNESS_RUN_TERMINAL_STATUS_VALUES = ["closed", "blocked", "failed"];
const INCIDENT_RECERTIFICATION_DECISION_VALUES = ["recertify", "hold", "re-enable"];
const PLATFORM_RECERTIFICATION_LINKAGE_VALUES = ["linked", "rollback", "unlinked"];
const PLATFORM_ROLLOUT_ACTION_VALUES = ["promote", "hold", "reject", "freeze", "demote"];

/**
 * @returns {import("./index.d.ts").ContractFamilyIndexEntry[]}
 */
export function getContractFamilyIndex() {
  return cloneJson(CONTRACT_FAMILY_INDEX);
}

/**
 * @param {{ family: import("./index.d.ts").ContractFamily, document: unknown, source?: string }} options
 * @returns {import("./index.d.ts").ContractValidationResult}
 */
export function validateContractDocument({ family, document, source = "<in-memory>" }) {
  const entry = CONTRACT_FAMILY_INDEX.find((candidate) => candidate.family === family);
  if (!entry) {
    return {
      ok: false,
      family,
      source,
      issues: [
        issue({
          code: "unknown_contract_family",
          source,
          expected: "known contract family",
          actual: String(family),
          message: `Unknown contract family '${family}'.`,
        }),
      ],
    };
  }

  if (entry.status !== "implemented") {
    return {
      ok: false,
      family,
      source,
      issues: [
        issue({
          code: "contract_family_limitation",
          source,
          expected: "implemented contract family",
          actual: entry.status,
          message: entry.limitation ?? "This contract family is intentionally not machine-loadable yet.",
        }),
      ],
    };
  }

  if (!isPlainObject(document)) {
    return {
      ok: false,
      family,
      source,
      issues: [
        issue({
          code: "document_type_invalid",
          source,
          expected: "object",
          actual: describeActualType(document),
          message: "Contract document must be a YAML mapping (object).",
        }),
      ],
    };
  }

  /** @type {import("./index.d.ts").ContractValidationIssue[]} */
  const issues = [];

  for (const field of entry.requiredFields) {
    if (!(field in document)) {
      issues.push(
        issue({
          code: "required_field_missing",
          source,
          field,
          expected: "present",
          actual: "missing",
          message: `Missing required field '${field}'.`,
        }),
      );
      continue;
    }

    const expectedType = entry.fieldTypes[field];
    if (!expectedType) {
      continue;
    }

    const value = document[field];
    if (!isExpectedType(value, expectedType)) {
      issues.push(
        issue({
          code: "field_type_mismatch",
          source,
          field,
          expected: expectedType,
          actual: describeActualType(value),
          message: `Field '${field}' must be '${expectedType}'.`,
        }),
      );
    }
  }

  for (const field of entry.forbiddenFields ?? []) {
    if (!(field in document)) {
      continue;
    }

    issues.push(
      issue({
        code: "unsupported_field_present",
        source,
        field,
        expected: "field omitted",
        actual: "present",
        message: `Field '${field}' is not supported in the current contract shape.`,
      }),
    );
  }

  for (const enumCheck of entry.enumChecks) {
    const value = document[enumCheck.field];
    if (typeof value !== "string") {
      continue;
    }

    if (!enumCheck.allowedValues.includes(value)) {
      issues.push(
        issue({
          code: "enum_value_invalid",
          source,
          field: enumCheck.field,
          expected: enumCheck.allowedValues.join("|"),
          actual: value,
          message: `Field '${enumCheck.field}' has unsupported value '${value}'.`,
        }),
      );
    }
  }

  if (family === "live-e2e-observation-report") {
    issues.push(...validateLiveE2EObservationReport(document, source));
  }

  if (family === "live-e2e-run-health-report") {
    issues.push(...validateLiveE2ERunHealthReport(document, source));
  }

  if (family === "live-e2e-quality-assessment-report") {
    issues.push(...validateLiveE2EQualityAssessmentReport(document, source));
  }

  if (family === "live-e2e-step-quality-assessment-report") {
    issues.push(...validateLiveE2EStepQualityAssessmentReport(document, source));
  }

  if (family === "live-e2e-target-catalog") {
    issues.push(...validateLiveE2ETargetCatalog(document, source));
  }

  if (family === "adapter-capability-profile") {
    issues.push(...validateAdapterCapabilityProfile(document, source));
  }

  if (family === "compiled-context-artifact") {
    issues.push(...validateCompiledContextArtifact(document, source));
  }

  if (family === "intake-request-body") {
    issues.push(...validateIntakeRequestBody(document, source));
  }

  if (family === "artifact-packet") {
    issues.push(...validateArtifactPacket(document, source));
  }

  if (family === "step-result") {
    issues.push(...validateStepResult(document, source));
  }

  if (family === "validation-report") {
    issues.push(...validateValidationReport(document, source));
  }

  if (family === "review-report") {
    issues.push(...validateReviewReport(document, source));
  }

  if (family === "live-run-event") {
    issues.push(...validateLiveRunEvent(document, source));
  }

  if (family === "incident-report") {
    issues.push(...validateIncidentReport(document, source));
  }

  if (family === "learning-loop-scorecard") {
    issues.push(...validateLearningLoopScorecard(document, source));
  }

  if (family === "learning-loop-handoff") {
    issues.push(...validateLearningLoopHandoff(document, source));
  }

  if (family === "runtime-harness-report") {
    issues.push(...validateRuntimeHarnessReport(document, source));
  }

  return {
    ok: issues.length === 0,
    family,
    source,
    issues,
  };
}

/**
 * @param {Record<string, unknown>} document
 * @param {string} source
 * @returns {import("./index.d.ts").ContractValidationIssue[]}
 */
function validateRuntimeHarnessReport(document, source) {
  /** @type {import("./index.d.ts").ContractValidationIssue[]} */
  const issues = [];

  const runController = validateOptionalObjectField({
    record: document,
    source,
    field: "run_controller",
    issues,
  });
  if (runController) {
    for (const field of ["controller_id", "controller_version", "started_at", "finished_at", "terminal_transition_id"]) {
      validateNestedStringField({
        record: runController,
        source,
        field: `run_controller.${field}`,
        issues,
        required: true,
      });
    }
    validateNestedEnumStringField({
      record: runController,
      source,
      field: "run_controller.status",
      allowedValues: RUNTIME_HARNESS_RUN_CONTROLLER_STATUS_VALUES,
      issues,
      required: true,
    });
    validateNestedNumberField({
      record: runController,
      source,
      field: "run_controller.transition_count",
      issues,
      required: true,
    });
  }

  const runTransitions = validateOptionalArrayField({
    record: document,
    source,
    field: "run_transitions",
    issues,
  });
  if (runTransitions) {
    runTransitions.forEach((entry, index) => {
      if (!isPlainObject(entry)) {
        issues.push(
          issue({
            code: "field_type_mismatch",
            source,
            field: `run_transitions[${index}]`,
            expected: "object",
            actual: describeActualType(entry),
            message: `Field 'run_transitions[${index}]' must be 'object'.`,
          }),
        );
        return;
      }

      for (const field of ["transition_id", "summary", "started_at", "finished_at"]) {
        validateNestedStringField({
          record: entry,
          source,
          field: `run_transitions[${index}].${field}`,
          issues,
          required: true,
        });
      }
      validateNestedEnumStringField({
        record: entry,
        source,
        field: `run_transitions[${index}].stage`,
        allowedValues: RUNTIME_HARNESS_RUN_TRANSITION_STAGE_VALUES,
        issues,
        required: true,
      });
      validateNestedEnumStringField({
        record: entry,
        source,
        field: `run_transitions[${index}].status`,
        allowedValues: RUNTIME_HARNESS_RUN_TRANSITION_STATUS_VALUES,
        issues,
        required: true,
      });
      validateNestedEnumStringField({
        record: entry,
        source,
        field: `run_transitions[${index}].runtime_harness_decision`,
        allowedValues: RUNTIME_HARNESS_DECISION_VALUES,
        issues,
        required: true,
      });
      validateNestedArrayField({
        record: entry,
        source,
        field: `run_transitions[${index}].evidence_refs`,
        issues,
      });
      validateStringArrayItems({
        values: entry.evidence_refs,
        source,
        field: `run_transitions[${index}].evidence_refs`,
        issues,
      });
    });
  }

  const runDecision = validateOptionalObjectField({
    record: document,
    source,
    field: "run_decision",
    issues,
  });
  if (runDecision) {
    validateNestedEnumStringField({
      record: runDecision,
      source,
      field: "run_decision.overall_decision",
      allowedValues: RUNTIME_HARNESS_DECISION_VALUES,
      issues,
      required: true,
    });
    validateNestedEnumStringField({
      record: runDecision,
      source,
      field: "run_decision.terminal_status",
      allowedValues: RUNTIME_HARNESS_RUN_TERMINAL_STATUS_VALUES,
      issues,
      required: true,
    });
    validateNestedNullableStringField({
      record: runDecision,
      source,
      field: "run_decision.failure_class",
      issues,
      required: true,
    });
    validateNestedNullableStringField({
      record: runDecision,
      source,
      field: "run_decision.repair_status",
      issues,
      required: true,
    });
    validateNestedStringField({
      record: runDecision,
      source,
      field: "run_decision.summary",
      issues,
      required: true,
    });
    validateNestedArrayField({
      record: runDecision,
      source,
      field: "run_decision.evidence_refs",
      issues,
    });
    validateStringArrayItems({
      values: runDecision.evidence_refs,
      source,
      field: "run_decision.evidence_refs",
      issues,
    });
  }

  const runtimePermissionSummary = validateOptionalObjectField({
    record: document,
    source,
    field: "runtime_permission_summary",
    issues,
  });
  if (runtimePermissionSummary) {
    validateNestedNumberField({
      record: runtimePermissionSummary,
      source,
      field: "runtime_permission_summary.total",
      issues,
      required: false,
    });
    validateOptionalObjectField({
      record: runtimePermissionSummary,
      source,
      field: "runtime_permission_summary.decision_counts",
      issues,
    });
    for (const field of [
      "permission_modes",
      "interaction_policies",
      "auto_approval_profiles",
      "approval_scopes",
      "approval_resume_modes",
      "continuation_strategies",
      "audit_refs",
      "grant_refs",
    ]) {
      validateOptionalStringArrayField({
        record: runtimePermissionSummary,
        source,
        field: `runtime_permission_summary.${field}`,
        issues,
      });
    }
  }

  const runtimePermissionDecisions = validateOptionalArrayField({
    record: document,
    source,
    field: "runtime_permission_decisions",
    issues,
  });
  if (runtimePermissionDecisions) {
    runtimePermissionDecisions.forEach((entry, index) => {
      const fieldPrefix = `runtime_permission_decisions[${index}]`;
      if (!isPlainObject(entry)) {
        issues.push(
          issue({
            code: "field_type_mismatch",
            source,
            field: fieldPrefix,
            expected: "object",
            actual: describeActualType(entry),
            message: `Field '${fieldPrefix}' must be 'object'.`,
          }),
        );
        return;
      }
      validateNestedStringField({
        record: entry,
        source,
        field: `${fieldPrefix}.decision`,
        issues,
        required: false,
      });
      validateNestedStringField({
        record: entry,
        source,
        field: `${fieldPrefix}.operation_type`,
        issues,
        required: false,
      });
      validateOptionalStringArrayField({
        record: entry,
        source,
        field: `${fieldPrefix}.evidence_refs`,
        issues,
      });
    });
  }

  return issues;
}

/**
 * @param {Record<string, unknown>} document
 * @param {string} source
 * @returns {import("./index.d.ts").ContractValidationIssue[]}
 */
function validateArtifactPacket(document, source) {
  /** @type {import("./index.d.ts").ContractValidationIssue[]} */
  const issues = [];

  validateOptionalStringArrayField({ record: document, source, field: "evidence_refs", issues });

  const invocationContext = validateOptionalObjectField({
    record: document,
    source,
    field: "invocation_context",
    issues,
  });
  if (invocationContext) {
    for (const field of ["command", "project_root", "project_profile_ref"]) {
      validateNestedStringField({
        record: invocationContext,
        source,
        field: `invocation_context.${field}`,
        issues,
        required: true,
      });
    }
    validateNestedNullableStringField({
      record: invocationContext,
      source,
      field: "invocation_context.mission_id",
      issues,
      required: false,
    });
  }

  return issues;
}

/**
 * @param {Record<string, unknown>} document
 * @param {string} source
 * @returns {import("./index.d.ts").ContractValidationIssue[]}
 */
function validateAdapterCapabilityProfile(document, source) {
  /** @type {import("./index.d.ts").ContractValidationIssue[]} */
  const issues = [];
  const execution = isPlainObject(document.execution) ? document.execution : null;
  if (!execution) return issues;
  const externalRuntime = validateOptionalObjectField({
    record: execution,
    source,
    field: "execution.external_runtime",
    issues,
  });
  if (!externalRuntime) return issues;

  const requestTransport =
    typeof externalRuntime.request_transport === "string" && externalRuntime.request_transport.length > 0
      ? externalRuntime.request_transport
      : externalRuntime.request_via_stdin === false
        ? "none"
        : "stdin-json";
  validateEnumString(
    requestTransport,
    source,
    "execution.external_runtime.request_transport",
    EXTERNAL_REQUEST_TRANSPORT_VALUES,
    issues,
  );

  const runtimeMode = typeof execution.runtime_mode === "string" ? execution.runtime_mode : null;
  if (runtimeMode === "external-process" && requestTransport === "stdin-json") {
    const scope = externalRuntime.stdin_json_scope;
    if (typeof scope !== "string" || !STDIN_JSON_SCOPE_VALUES.includes(scope)) {
      issues.push(
        issue({
          code: "required_field_missing",
          source,
          field: "execution.external_runtime.stdin_json_scope",
          expected: STDIN_JSON_SCOPE_VALUES.join("|"),
          actual: scope === undefined ? "missing" : describeActualType(scope),
          message:
            "External-process adapters using stdin-json must declare stdin_json_scope as test-only or small-only.",
        }),
      );
    }
  }

  if (requestTransport === "request-artifact") {
    const requestFile = validateOptionalObjectField({
      record: externalRuntime,
      source,
      field: "execution.external_runtime.request_file",
      issues,
    });
    if (requestFile) {
      validateNestedStringField({
        record: requestFile,
        source,
        field: "execution.external_runtime.request_file.mode",
        issues,
        required: false,
      });
      validateNestedStringField({
        record: requestFile,
        source,
        field: "execution.external_runtime.request_file.message",
        issues,
        required: false,
      });
      validateNestedStringField({
        record: requestFile,
        source,
        field: "execution.external_runtime.request_file.argument",
        issues,
        required: false,
      });
    }
  }

  return issues;
}

/**
 * @param {Record<string, unknown>} estimate
 * @param {string} source
 * @param {string} parentField
 * @param {import("./index.d.ts").ContractValidationIssue[]} issues
 * @param {{ requireBudgetLimit?: boolean }} [options]
 */
function validateContextBudgetEstimate(estimate, source, parentField, issues, options = {}) {
  for (const field of ["bytes", "chars", "estimated_tokens"]) {
    validateNestedNumberField({
      record: estimate,
      source,
      field: `${parentField}.${field}`,
      issues,
      required: true,
    });
  }
  validateNestedNumberField({
    record: estimate,
    source,
    field: `${parentField}.budget_limit_tokens`,
    issues,
    required: options.requireBudgetLimit === true,
    allowNull: true,
  });
}

/**
 * @param {unknown} value
 * @param {string} source
 * @param {string} field
 * @param {import("./index.d.ts").ContractValidationIssue[]} issues
 */
function validateContextSizeSources(value, source, field, issues) {
  if (!Array.isArray(value)) {
    issues.push(
      issue({
        code: value === undefined ? "required_field_missing" : "field_type_mismatch",
        source,
        field,
        expected: "array",
        actual: value === undefined ? "missing" : describeActualType(value),
        message: `Field '${field}' must be an array of context size source entries.`,
      }),
    );
    return;
  }
  value.forEach((entry, index) => {
    if (!isPlainObject(entry)) {
      issues.push(
        issue({
          code: "field_type_mismatch",
          source,
          field: `${field}[${index}]`,
          expected: "object",
          actual: describeActualType(entry),
          message: `Field '${field}[${index}]' must be 'object'.`,
        }),
      );
      return;
    }
    validateNestedStringField({
      record: entry,
      source,
      field: `${field}[${index}].source`,
      issues,
      required: true,
    });
    for (const sizeField of ["bytes", "chars", "estimated_tokens"]) {
      validateNestedNumberField({
        record: entry,
        source,
        field: `${field}[${index}].${sizeField}`,
        issues,
        required: true,
      });
    }
  });
}

/**
 * @param {Record<string, unknown>} document
 * @param {string} source
 * @returns {import("./index.d.ts").ContractValidationIssue[]}
 */
function validateCompiledContextArtifact(document, source) {
  /** @type {import("./index.d.ts").ContractValidationIssue[]} */
  const issues = [];
  const budgetReport = isPlainObject(document.budget_report) ? document.budget_report : {};
  validateContextBudgetEstimate(budgetReport, source, "budget_report", issues, { requireBudgetLimit: true });
  validateEnumString(
    budgetReport.budget_status,
    source,
    "budget_report.budget_status",
    COMPILED_CONTEXT_BUDGET_STATUS_VALUES,
    issues,
  );
  validateContextSizeSources(budgetReport.source_breakdown, source, "budget_report.source_breakdown", issues);

  const compactionReport = isPlainObject(document.compaction_report) ? document.compaction_report : {};
  validateNestedStringField({
    record: compactionReport,
    source,
    field: "compaction_report.strategy",
    issues,
    required: true,
  });
  const originalEstimate = isPlainObject(compactionReport.original_estimate)
    ? compactionReport.original_estimate
    : {};
  validateContextBudgetEstimate(originalEstimate, source, "compaction_report.original_estimate", issues);
  const finalEstimate = isPlainObject(compactionReport.final_estimate) ? compactionReport.final_estimate : {};
  validateContextBudgetEstimate(finalEstimate, source, "compaction_report.final_estimate", issues);
  validateOptionalStringArrayField({
    record: compactionReport,
    source,
    field: "compaction_report.dropped_or_summarized_sources",
    issues,
  });
  validateOptionalStringArrayField({
    record: compactionReport,
    source,
    field: "compaction_report.mandatory_refs_preserved",
    issues,
  });
  return issues;
}

/**
 * @param {Record<string, unknown>} document
 * @param {string} source
 * @returns {import("./index.d.ts").ContractValidationIssue[]}
 */
function validateStepResult(document, source) {
  /** @type {import("./index.d.ts").ContractValidationIssue[]} */
  const issues = [];

  validateStringArrayItems({ values: document.evidence_refs, source, field: "evidence_refs", issues });
  validateNestedEnumStringField({
    record: document,
    source,
    field: "runtime_harness_decision",
    allowedValues: RUNTIME_HARNESS_DECISION_VALUES,
    issues,
    required: false,
  });

  const requestedInteraction = validateOptionalObjectField({
    record: document,
    source,
    field: "requested_interaction",
    issues,
    allowNull: true,
  });
  if (requestedInteraction) {
    validateNestedBooleanField({
      record: requestedInteraction,
      source,
      field: "requested_interaction.requested",
      issues,
      required: true,
    });
    validateNestedEnumStringField({
      record: requestedInteraction,
      source,
      field: "requested_interaction.status",
      allowedValues: INTERACTION_STATUS_VALUES,
      issues,
      required: false,
    });
    validateNestedEnumStringField({
      record: requestedInteraction,
      source,
      field: "requested_interaction.interaction_type",
      allowedValues: INTERACTION_TYPE_VALUES,
      issues,
      required: false,
    });
    validateNestedStringField({
      record: requestedInteraction,
      source,
      field: "requested_interaction.interaction_id",
      issues,
      required: false,
    });
    validateNestedStringField({
      record: requestedInteraction,
      source,
      field: "requested_interaction.prompt_summary",
      issues,
      required: false,
    });
    validateNestedStringField({
      record: requestedInteraction,
      source,
      field: "requested_interaction.summary",
      issues,
      required: false,
    });
    for (const field of ["question_evidence_refs", "evidence_refs", "answer_audit_refs"]) {
      validateOptionalStringArrayField({
        record: requestedInteraction,
        source,
        field: `requested_interaction.${field}`,
        issues,
      });
    }
    validateUnsupportedNestedFields({
      record: requestedInteraction,
      source,
      parentField: "requested_interaction",
      fields: ["answer", "answer_text", "raw_answer"],
      issues,
    });
    const runtimePermissionRequest = validateOptionalObjectField({
      record: requestedInteraction,
      source,
      field: "requested_interaction.runtime_permission_request",
      issues,
    });
    if (runtimePermissionRequest) {
      validateNestedStringField({
        record: runtimePermissionRequest,
        source,
        field: "requested_interaction.runtime_permission_request.operation_type",
        issues,
        required: false,
      });
      validateOptionalStringArrayField({
        record: runtimePermissionRequest,
        source,
        field: "requested_interaction.runtime_permission_request.evidence_refs",
        issues,
      });
    }
    validateOptionalObjectField({
      record: requestedInteraction,
      source,
      field: "requested_interaction.runtime_permission_decision",
      issues,
    });

    const continuation = validateOptionalObjectField({
      record: requestedInteraction,
      source,
      field: "requested_interaction.continuation",
      issues,
    });
    if (continuation) {
      validateNestedStringField({
        record: continuation,
        source,
        field: "requested_interaction.continuation.next_action",
        issues,
        required: true,
      });
      validateNestedStringField({
        record: continuation,
        source,
        field: "requested_interaction.continuation.reason_code",
        issues,
        required: false,
      });
    }

    const stateHistory = validateOptionalArrayField({
      record: requestedInteraction,
      source,
      field: "requested_interaction.state_history",
      issues,
    });
    if (stateHistory) {
      stateHistory.forEach((entry, index) => {
        const entryField = `requested_interaction.state_history[${index}]`;
        if (!isPlainObject(entry)) {
          issues.push(
            issue({
              code: "field_type_mismatch",
              source,
              field: entryField,
              expected: "object",
              actual: describeActualType(entry),
              message: `Field '${entryField}' must be 'object'.`,
            }),
          );
          return;
        }

        validateNestedEnumStringField({
          record: entry,
          source,
          field: `${entryField}.status`,
          allowedValues: INTERACTION_STATUS_VALUES,
          issues,
          required: true,
        });
        validateNestedStringField({
          record: entry,
          source,
          field: `${entryField}.timestamp`,
          issues,
          required: false,
        });
        validateNestedStringField({
          record: entry,
          source,
          field: `${entryField}.summary`,
          issues,
          required: false,
        });
        for (const field of ["evidence_refs", "answer_audit_refs"]) {
          validateOptionalStringArrayField({
            record: entry,
            source,
            field: `${entryField}.${field}`,
            issues,
          });
        }
        validateUnsupportedNestedFields({
          record: entry,
          source,
          parentField: entryField,
          fields: ["answer", "answer_text", "raw_answer"],
          issues,
        });

        const entryContinuation = validateOptionalObjectField({
          record: entry,
          source,
          field: `${entryField}.continuation`,
          issues,
        });
        if (entryContinuation) {
          validateNestedStringField({
            record: entryContinuation,
            source,
            field: `${entryField}.continuation.next_action`,
            issues,
            required: true,
          });
          validateNestedStringField({
            record: entryContinuation,
            source,
            field: `${entryField}.continuation.reason_code`,
            issues,
            required: false,
          });
        }
      });
    }
  }

  const externalRunner = validateOptionalObjectField({
    record: document,
    source,
    field: "external_runner",
    issues,
  });
  if (externalRunner) {
    for (const field of ["runtime_mode", "command"]) {
      validateNestedStringField({
        record: externalRunner,
        source,
        field: `external_runner.${field}`,
        issues,
        required: true,
      });
    }
    validateNestedStringField({
      record: externalRunner,
      source,
      field: "external_runner.raw_evidence_ref",
      issues,
      required: false,
    });
    for (const field of ["request_artifact_ref", "provider_work_packet_ref", "context_budget_status"]) {
      validateNestedStringField({
        record: externalRunner,
        source,
        field: `external_runner.${field}`,
        issues,
        required: false,
      });
    }
    for (const field of ["context_budget_failure_class", "raw_provider_error_summary"]) {
      validateNestedNullableStringField({
        record: externalRunner,
        source,
        field: `external_runner.${field}`,
        issues,
        required: false,
      });
    }
    if ("top_context_size_sources" in externalRunner) {
      validateContextSizeSources(
        externalRunner.top_context_size_sources,
        source,
        "external_runner.top_context_size_sources",
        issues,
      );
    }
    validateNestedNumberField({
      record: externalRunner,
      source,
      field: "external_runner.exit_code",
      issues,
      required: false,
      allowNull: true,
    });
    validateNestedBooleanField({
      record: externalRunner,
      source,
      field: "external_runner.timed_out",
      issues,
      required: false,
    });
  }

  const repairAttempts = validateOptionalArrayField({
    record: document,
    source,
    field: "repair_attempts",
    issues,
  });
  if (repairAttempts) {
    repairAttempts.forEach((entry, index) => {
      if (!isPlainObject(entry)) {
        issues.push(
          issue({
            code: "field_type_mismatch",
            source,
            field: `repair_attempts[${index}]`,
            expected: "object",
            actual: describeActualType(entry),
            message: `Field 'repair_attempts[${index}]' must be 'object'.`,
          }),
        );
        return;
      }

      validateNestedNumberField({
        record: entry,
        source,
        field: `repair_attempts[${index}].attempt`,
        issues,
        required: true,
      });
      validateNestedStringField({
        record: entry,
        source,
        field: `repair_attempts[${index}].trigger`,
        issues,
        required: true,
      });
      validateNestedStringField({
        record: entry,
        source,
        field: `repair_attempts[${index}].result`,
        issues,
        required: true,
      });
      validateNestedArrayField({
        record: entry,
        source,
        field: `repair_attempts[${index}].input_evidence_refs`,
        issues,
      });
      validateStringArrayItems({
        values: entry.input_evidence_refs,
        source,
        field: `repair_attempts[${index}].input_evidence_refs`,
        issues,
      });
    });
  }

  const outputQualityFindings = validateOptionalArrayField({
    record: document,
    source,
    field: "output_quality_findings",
    issues,
  });
  if (outputQualityFindings) {
    outputQualityFindings.forEach((entry, index) => {
      const entryField = `output_quality_findings[${index}]`;
      if (!isPlainObject(entry)) {
        issues.push(
          issue({
            code: "field_type_mismatch",
            source,
            field: entryField,
            expected: "object",
            actual: describeActualType(entry),
            message: `Field '${entryField}' must be 'object'.`,
          }),
        );
        return;
      }

      for (const field of ["rule_id", "source", "severity", "summary"]) {
        validateNestedStringField({
          record: entry,
          source,
          field: `${entryField}.${field}`,
          issues,
          required: true,
        });
      }
      validateNestedStringField({
        record: entry,
        source,
        field: `${entryField}.excerpt`,
        issues,
        required: false,
      });
      validateNestedStringField({
        record: entry,
        source,
        field: `${entryField}.baseline_status`,
        issues,
        required: false,
      });
      validateNestedArrayField({
        record: entry,
        source,
        field: `${entryField}.baseline_evidence_refs`,
        issues,
        required: false,
      });
      validateStringArrayItems({
        values: entry.baseline_evidence_refs,
        source,
        field: `${entryField}.baseline_evidence_refs`,
        issues,
      });
    });
  }

  const missionSemantics = validateOptionalObjectField({
    record: document,
    source,
    field: "mission_semantics",
    issues,
  });
  if (missionSemantics) {
    for (const legacyField of ["allowed_paths", "forbidden_paths", "mission_scoped_changed_paths", "scope_violation_paths"]) {
      if (Object.prototype.hasOwnProperty.call(missionSemantics, legacyField)) {
        issues.push(
          issue({
            code: "forbidden_field_present",
            source,
            field: `mission_semantics.${legacyField}`,
            expected: "absent",
            actual: "present",
            message: `Field 'mission_semantics.${legacyField}' is legacy path-scope evidence and must not be emitted.`,
          }),
        );
      }
    }
    for (const field of [
      "changed_paths",
      "meaningful_changed_paths",
      "non_bootstrap_changed_paths",
      "runner_owned_state_paths",
      "runner_owned_state_paths_during_step",
      "ignored_request_input_files",
    ]) {
      validateOptionalStringArrayField({
        record: missionSemantics,
        source,
        field: `mission_semantics.${field}`,
        issues,
      });
    }
  }

  return issues;
}

/**
 * @param {Record<string, unknown>} document
 * @param {string} source
 * @returns {import("./index.d.ts").ContractValidationIssue[]}
 */
function validateValidationReport(document, source) {
  /** @type {import("./index.d.ts").ContractValidationIssue[]} */
  const issues = [];

  validateStringArrayItems({ values: document.evidence_refs, source, field: "evidence_refs", issues });
  validateNestedEnumStringField({
    record: document,
    source,
    field: "status",
    allowedValues: VALIDATION_STATUS_VALUES,
    issues,
    required: true,
  });

  if (Array.isArray(document.validators)) {
    document.validators.forEach((entry, index) => {
      if (typeof entry === "string") {
        return;
      }
      if (!isPlainObject(entry)) {
        issues.push(
          issue({
            code: "field_type_mismatch",
            source,
            field: `validators[${index}]`,
            expected: "object",
            actual: describeActualType(entry),
            message: `Field 'validators[${index}]' must be 'object'.`,
          }),
        );
        return;
      }

      for (const field of ["validator_id", "status", "summary"]) {
        validateNestedStringField({
          record: entry,
          source,
          field: `validators[${index}].${field}`,
          issues,
          required: true,
        });
      }
      validateNestedEnumStringField({
        record: entry,
        source,
        field: `validators[${index}].status`,
        allowedValues: VALIDATION_STATUS_VALUES,
        issues,
        required: true,
      });
      validateOptionalStringArrayField({
        record: entry,
        source,
        field: `validators[${index}].evidence_refs`,
        issues,
      });
      validateOptionalObjectField({
        record: entry,
        source,
        field: `validators[${index}].details`,
        issues,
      });
    });
  }

  return issues;
}

/**
 * @param {Record<string, unknown>} document
 * @param {string} source
 * @returns {import("./index.d.ts").ContractValidationIssue[]}
 */
function validateReviewReport(document, source) {
  /** @type {import("./index.d.ts").ContractValidationIssue[]} */
  const issues = [];

  validateStringArrayItems({ values: document.evidence_refs, source, field: "evidence_refs", issues });

  validateFeatureTraceability(document.feature_traceability, source, issues);
  validateReviewQualitySection(document.discovery_quality, source, "discovery_quality", issues);
  validateReviewArtifactQuality(document.artifact_quality, source, issues);
  validateReviewCodeQuality(document.code_quality, source, issues);
  validateReviewFeatureSizeFit(document.feature_size_fit, source, issues);
  validateReviewProviderTraceability(document.provider_traceability, source, issues);
  validateReviewFindings({ entries: document.findings, source, field: "findings", issues });

  return issues;
}

/**
 * @param {unknown} value
 * @param {string} source
 * @param {import("./index.d.ts").ContractValidationIssue[]} issues
 */
function validateFeatureTraceability(value, source, issues) {
  if (!isPlainObject(value)) return;

  validateNestedEnumStringField({
    record: value,
    source,
    field: "feature_traceability.status",
    allowedValues: REVIEW_STATUS_VALUES,
    issues,
    required: false,
  });
  for (const field of [
    "mission_id",
    "input_packet_ref",
    "request_title",
    "request_brief",
    "scenario_family",
    "provider_variant_id",
    "feature_size",
  ]) {
    validateNestedStringField({
      record: value,
      source,
      field: `feature_traceability.${field}`,
      issues,
      required: false,
    });
  }
  validateOptionalStringArrayField({
    record: value,
    source,
    field: "feature_traceability.required_path_prefixes",
    issues,
  });

  const matrixCell = validateOptionalObjectField({
    record: value,
    source,
    field: "feature_traceability.matrix_cell",
    issues,
  });
  if (matrixCell) {
    validateMatrixCell(matrixCell, source, "feature_traceability.matrix_cell", issues);
  }

  const coverageFollowUp = validateOptionalObjectField({
    record: value,
    source,
    field: "feature_traceability.coverage_follow_up",
    issues,
    allowNull: true,
  });
  if (coverageFollowUp) {
    validateCoverageFollowUp(coverageFollowUp, source, "feature_traceability.coverage_follow_up", issues);
  }
}

/**
 * @param {unknown} value
 * @param {string} source
 * @param {string} field
 * @param {import("./index.d.ts").ContractValidationIssue[]} issues
 */
function validateReviewQualitySection(value, source, field, issues) {
  if (!isPlainObject(value)) return;

  validateNestedEnumStringField({
    record: value,
    source,
    field: `${field}.status`,
    allowedValues: REVIEW_STATUS_VALUES,
    issues,
    required: false,
  });
  validateReviewFindings({ entries: value.findings, source, field: `${field}.findings`, issues, required: false });
}

/**
 * @param {unknown} value
 * @param {string} source
 * @param {import("./index.d.ts").ContractValidationIssue[]} issues
 */
function validateReviewArtifactQuality(value, source, issues) {
  if (!isPlainObject(value)) return;

  validateReviewQualitySection(value, source, "artifact_quality", issues);
  validateOptionalStringArrayField({
    record: value,
    source,
    field: "artifact_quality.execution_step_result_refs",
    issues,
  });
  for (const field of ["verify_summary_ref", "delivery_manifest_ref", "release_packet_ref"]) {
    validateNestedNullableStringField({
      record: value,
      source,
      field: `artifact_quality.${field}`,
      issues,
      required: false,
    });
  }
}

/**
 * @param {unknown} value
 * @param {string} source
 * @param {import("./index.d.ts").ContractValidationIssue[]} issues
 */
function validateReviewCodeQuality(value, source, issues) {
  if (!isPlainObject(value)) return;

  validateReviewQualitySection(value, source, "code_quality", issues);
  for (const legacyField of ["allowed_paths", "forbidden_paths"]) {
    if (Object.prototype.hasOwnProperty.call(value, legacyField)) {
      issues.push(
        issue({
          code: "forbidden_field_present",
          source,
          field: `code_quality.${legacyField}`,
          expected: "absent",
          actual: "present",
          message: `Field 'code_quality.${legacyField}' is legacy path-scope evidence and must not be emitted.`,
        }),
      );
    }
  }
  for (const field of ["changed_paths"]) {
    validateOptionalStringArrayField({
      record: value,
      source,
      field: `code_quality.${field}`,
      issues,
    });
  }
}

/**
 * @param {unknown} value
 * @param {string} source
 * @param {import("./index.d.ts").ContractValidationIssue[]} issues
 */
function validateReviewFeatureSizeFit(value, source, issues) {
  if (!isPlainObject(value)) return;

  validateReviewQualitySection(value, source, "feature_size_fit", issues);
  validateNestedStringField({
    record: value,
    source,
    field: "feature_size_fit.feature_size",
    issues,
    required: false,
  });
  validateOptionalObjectField({
    record: value,
    source,
    field: "feature_size_fit.size_budget",
    issues,
  });
  validateOptionalObjectField({
    record: value,
    source,
    field: "feature_size_fit.actual_change",
    issues,
  });
}

/**
 * @param {unknown} value
 * @param {string} source
 * @param {import("./index.d.ts").ContractValidationIssue[]} issues
 */
function validateReviewProviderTraceability(value, source, issues) {
  if (!isPlainObject(value)) return;

  validateReviewQualitySection(value, source, "provider_traceability", issues);
  for (const field of [
    "provider_variant_id",
    "requested_provider",
    "requested_adapter",
    "actual_provider",
    "actual_adapter",
    "route_id",
    "route_profile_source",
  ]) {
    validateNestedNullableStringField({
      record: value,
      source,
      field: `provider_traceability.${field}`,
      issues,
      required: false,
    });
  }
}

/**
 * @param {{ entries: unknown, source: string, field: string, issues: import("./index.d.ts").ContractValidationIssue[], required?: boolean }} options
 */
function validateReviewFindings(options) {
  if (options.entries === undefined) {
    if (options.required ?? true) {
      options.issues.push(
        issue({
          code: "required_field_missing",
          source: options.source,
          field: options.field,
          expected: "present",
          actual: "missing",
          message: `Missing required field '${options.field}'.`,
        }),
      );
    }
    return;
  }
  if (!Array.isArray(options.entries)) {
    options.issues.push(
      issue({
        code: "field_type_mismatch",
        source: options.source,
        field: options.field,
        expected: "array",
        actual: describeActualType(options.entries),
        message: `Field '${options.field}' must be 'array'.`,
      }),
    );
    return;
  }

  options.entries.forEach((entry, index) => {
    if (!isPlainObject(entry)) {
      options.issues.push(
        issue({
          code: "field_type_mismatch",
          source: options.source,
          field: `${options.field}[${index}]`,
          expected: "object",
          actual: describeActualType(entry),
          message: `Field '${options.field}[${index}]' must be 'object'.`,
        }),
      );
      return;
    }

    for (const field of ["finding_id", "severity", "category", "summary"]) {
      validateNestedStringField({
        record: entry,
        source: options.source,
        field: `${options.field}[${index}].${field}`,
        issues: options.issues,
        required: true,
      });
    }
    validateNestedArrayField({
      record: entry,
      source: options.source,
      field: `${options.field}[${index}].evidence_refs`,
      issues: options.issues,
    });
    validateStringArrayItems({
      values: entry.evidence_refs,
      source: options.source,
      field: `${options.field}[${index}].evidence_refs`,
      issues: options.issues,
    });
  });
}

/**
 * @param {Record<string, unknown>} document
 * @param {string} source
 * @returns {import("./index.d.ts").ContractValidationIssue[]}
 */
function validateLiveRunEvent(document, source) {
  /** @type {import("./index.d.ts").ContractValidationIssue[]} */
  const issues = [];
  if (!isPlainObject(document.payload)) {
    return issues;
  }

  validateNestedNumberField({
    record: document.payload,
    source,
    field: "payload.sequence",
    issues,
    required: true,
  });
  validateUnsupportedNestedFields({
    record: document.payload,
    source,
    parentField: "payload",
    fields: ["answer", "answer_text", "raw_answer"],
    issues,
  });

  const interaction = validateOptionalObjectField({
    record: document.payload,
    source,
    field: "payload.interaction",
    issues,
  });
  if (interaction) {
    validateNestedEnumStringField({
      record: interaction,
      source,
      field: "payload.interaction.status",
      allowedValues: INTERACTION_STATUS_VALUES,
      issues,
      required: true,
    });
    validateNestedStringField({
      record: interaction,
      source,
      field: "payload.interaction.step_result_ref",
      issues,
      required: false,
    });
    validateNestedStringField({
      record: interaction,
      source,
      field: "payload.interaction.question_summary",
      issues,
      required: false,
    });
    validateNestedBooleanField({
      record: interaction,
      source,
      field: "payload.interaction.answer_required",
      issues,
      required: false,
    });
    validateOptionalStringArrayField({
      record: interaction,
      source,
      field: "payload.interaction.answer_audit_refs",
      issues,
    });
    const continuation = validateOptionalObjectField({
      record: interaction,
      source,
      field: "payload.interaction.continuation",
      issues,
    });
    if (continuation) {
      validateNestedStringField({
        record: continuation,
        source,
        field: "payload.interaction.continuation.next_action",
        issues,
        required: true,
      });
      validateNestedStringField({
        record: continuation,
        source,
        field: "payload.interaction.continuation.reason_code",
        issues,
        required: false,
      });
    }
    validateUnsupportedNestedFields({
      record: interaction,
      source,
      parentField: "payload.interaction",
      fields: ["answer", "answer_text", "raw_answer"],
      issues,
    });
  }

  return issues;
}

/**
 * @param {Record<string, unknown>} document
 * @param {string} source
 * @returns {import("./index.d.ts").ContractValidationIssue[]}
 */
function validateIncidentReport(document, source) {
  /** @type {import("./index.d.ts").ContractValidationIssue[]} */
  const issues = [];

  for (const field of [
    "linked_run_refs",
    "linked_asset_refs",
    "linked_eval_suite_refs",
    "linked_harness_capture_refs",
    "linked_backlog_refs",
  ]) {
    validateOptionalStringArrayField({ record: document, source, field, issues });
  }

  const recertification = validateOptionalObjectField({
    record: document,
    source,
    field: "recertification",
    issues,
  });
  if (recertification) {
    validateNestedEnumStringField({
      record: recertification,
      source,
      field: "recertification.decision",
      allowedValues: INCIDENT_RECERTIFICATION_DECISION_VALUES,
      issues,
      required: true,
    });
    for (const field of ["from_status", "to_status", "run_ref", "evidence_root"]) {
      validateNestedStringField({
        record: recertification,
        source,
        field: `recertification.${field}`,
        issues,
        required: true,
      });
    }
    for (const field of ["evidence_refs", "finance_evidence_refs", "quality_evidence_refs"]) {
      validateOptionalStringArrayField({
        record: recertification,
        source,
        field: `recertification.${field}`,
        issues,
      });
    }

    const platformRecertification = validateOptionalObjectField({
      record: recertification,
      source,
      field: "recertification.platform_recertification",
      issues,
    });
    if (platformRecertification) {
      validateNestedEnumStringField({
        record: platformRecertification,
        source,
        field: "recertification.platform_recertification.linkage_status",
        allowedValues: PLATFORM_RECERTIFICATION_LINKAGE_VALUES,
        issues,
        required: true,
      });
      validateNestedBooleanField({
        record: platformRecertification,
        source,
        field: "recertification.platform_recertification.rollback_required",
        issues,
        required: true,
      });
      if (platformRecertification.rollout_action !== null) {
        validateNestedEnumStringField({
          record: platformRecertification,
          source,
          field: "recertification.platform_recertification.rollout_action",
          allowedValues: PLATFORM_ROLLOUT_ACTION_VALUES,
          issues,
          required: false,
        });
      }
    }
  }

  return issues;
}

/**
 * @param {Record<string, unknown>} document
 * @param {string} source
 * @returns {import("./index.d.ts").ContractValidationIssue[]}
 */
function validateLearningLoopScorecard(document, source) {
  /** @type {import("./index.d.ts").ContractValidationIssue[]} */
  const issues = [];

  for (const field of [
    "evidence_refs",
    "linked_scorecard_refs",
    "linked_eval_suite_refs",
    "linked_harness_capture_refs",
    "linked_backlog_refs",
  ]) {
    validateOptionalStringArrayField({ record: document, source, field, issues });
  }
  if (isPlainObject(document.matrix_cell)) {
    validateMatrixCell(document.matrix_cell, source, "matrix_cell", issues);
  }
  if (isPlainObject(document.coverage_follow_up)) {
    validateCoverageFollowUp(document.coverage_follow_up, source, "coverage_follow_up", issues);
  }

  return issues;
}

/**
 * @param {Record<string, unknown>} document
 * @param {string} source
 * @returns {import("./index.d.ts").ContractValidationIssue[]}
 */
function validateLearningLoopHandoff(document, source) {
  /** @type {import("./index.d.ts").ContractValidationIssue[]} */
  const issues = [];

  for (const field of ["backlog_refs", "quality_refs", "evidence_refs", "next_actions"]) {
    validateOptionalStringArrayField({ record: document, source, field, issues });
  }
  validateNestedNullableStringField({
    record: document,
    source,
    field: "incident_ref",
    issues,
    required: true,
  });
  if (isPlainObject(document.matrix_cell)) {
    validateMatrixCell(document.matrix_cell, source, "matrix_cell", issues);
  }
  if (isPlainObject(document.coverage_follow_up)) {
    validateCoverageFollowUp(document.coverage_follow_up, source, "coverage_follow_up", issues);
  }

  return issues;
}

/**
 * @param {Record<string, unknown>} matrixCell
 * @param {string} source
 * @param {string} parentField
 * @param {import("./index.d.ts").ContractValidationIssue[]} issues
 */
function validateMatrixCell(matrixCell, source, parentField, issues) {
  for (const field of ["cell_id", "target_catalog_id", "feature_mission_id", "feature_size", "coverage_tier"]) {
    validateNestedStringField({
      record: matrixCell,
      source,
      field: `${parentField}.${field}`,
      issues,
      required: false,
    });
  }
  validateNestedEnumStringField({
    record: matrixCell,
    source,
    field: `${parentField}.scenario_family`,
    allowedValues: LIVE_E2E_SCENARIO_VALUES,
    issues,
    required: false,
  });
  validateNestedEnumStringField({
    record: matrixCell,
    source,
    field: `${parentField}.provider_variant_id`,
    allowedValues: LIVE_E2E_PROVIDER_VARIANT_VALUES,
    issues,
    required: false,
  });
}

/**
 * @param {Record<string, unknown>} coverageFollowUp
 * @param {string} source
 * @param {string} parentField
 * @param {import("./index.d.ts").ContractValidationIssue[]} issues
 */
function validateCoverageFollowUp(coverageFollowUp, source, parentField, issues) {
  validateNestedBooleanField({
    record: coverageFollowUp,
    source,
    field: `${parentField}.current_cell_required`,
    issues,
    required: false,
  });

  const nextCell = validateOptionalObjectField({
    record: coverageFollowUp,
    source,
    field: `${parentField}.next_required_matrix_cell`,
    issues,
    allowNull: true,
  });
  if (nextCell) {
    validateMatrixCell(nextCell, source, `${parentField}.next_required_matrix_cell`, issues);
  }

  const remainingCells = validateOptionalArrayField({
    record: coverageFollowUp,
    source,
    field: `${parentField}.remaining_required_matrix_cells`,
    issues,
  });
  if (!remainingCells) return;

  remainingCells.forEach((entry, index) => {
    if (!isPlainObject(entry)) {
      issues.push(
        issue({
          code: "field_type_mismatch",
          source,
          field: `${parentField}.remaining_required_matrix_cells[${index}]`,
          expected: "object",
          actual: describeActualType(entry),
          message: `Field '${parentField}.remaining_required_matrix_cells[${index}]' must be 'object'.`,
        }),
      );
      return;
    }
    validateMatrixCell(entry, source, `${parentField}.remaining_required_matrix_cells[${index}]`, issues);
  });
}

/**
 * @param {{ record: Record<string, unknown>, source: string, field: string, issues: import("./index.d.ts").ContractValidationIssue[] }} options
 * @returns {Record<string, unknown> | null}
 */
function validateRequiredObjectField(options) {
  const fieldName = options.field.split(".").at(-1) ?? options.field;
  if (!(fieldName in options.record)) {
    options.issues.push(
      issue({
        code: "required_field_missing",
        source: options.source,
        field: options.field,
        expected: "present",
        actual: "missing",
        message: `Missing required field '${options.field}'.`,
      }),
    );
    return null;
  }
  const value = options.record[fieldName];
  if (!isPlainObject(value)) {
    options.issues.push(
      issue({
        code: "field_type_mismatch",
        source: options.source,
        field: options.field,
        expected: "object",
        actual: describeActualType(value),
        message: `Field '${options.field}' must be 'object'.`,
      }),
    );
    return null;
  }
  return value;
}

/**
 * @param {{
 *   mission: Record<string, unknown>,
 *   source: string,
 *   parentField: string,
 *   budgetField: string,
 *   featureSize: string,
 *   issues: import("./index.d.ts").ContractValidationIssue[],
 * }} options
 */
function validateMissionBudget(options) {
  const budget = validateRequiredObjectField({
    record: options.mission,
    source: options.source,
    field: `${options.parentField}.${options.budgetField}`,
    issues: options.issues,
  });
  if (!budget) return;
  const expectedBudget = LIVE_E2E_MISSION_SIZE_BUDGETS[options.featureSize];
  for (const budgetKey of ["max_changed_files", "max_added_lines"]) {
    validateNestedNumberField({
      record: budget,
      source: options.source,
      field: `${options.parentField}.${options.budgetField}.${budgetKey}`,
      issues: options.issues,
      required: true,
    });
    const value = budget[budgetKey];
    if (!expectedBudget || typeof value !== "number" || !Number.isFinite(value)) {
      continue;
    }
    if (value < expectedBudget[budgetKey]) {
      options.issues.push(
        issue({
          code: "enum_value_invalid",
          source: options.source,
          field: `${options.parentField}.${options.budgetField}.${budgetKey}`,
          expected: `>=${expectedBudget[budgetKey]}`,
          actual: String(value),
          message: `Field '${options.parentField}.${options.budgetField}.${budgetKey}' must be at least ${expectedBudget[budgetKey]} for feature_size=${options.featureSize}.`,
        }),
      );
    }
  }
}

/**
 * @param {{
 *   record: Record<string, unknown>,
 *   source: string,
 *   parentField: string,
 *   issues: import("./index.d.ts").ContractValidationIssue[],
 * }} options
 */
function validateAgentVisibleRequest(options) {
  const request = validateRequiredObjectField({
    record: options.record,
    source: options.source,
    field: `${options.parentField}.agent_visible_request`,
    issues: options.issues,
  });
  if (!request) return;
  validateNestedStringField({
    record: request,
    source: options.source,
    field: `${options.parentField}.agent_visible_request.user_problem`,
    issues: options.issues,
    required: true,
  });
  validateNestedStringField({
    record: request,
    source: options.source,
    field: `${options.parentField}.agent_visible_request.desired_outcome`,
    issues: options.issues,
    required: true,
  });
  for (const field of ["constraints", "non_goals"]) {
    validateNestedArrayField({
      record: request,
      source: options.source,
      field: `${options.parentField}.agent_visible_request.${field}`,
      issues: options.issues,
    });
    validateStringArrayItems({
      values: request[field],
      source: options.source,
      field: `${options.parentField}.agent_visible_request.${field}`,
      issues: options.issues,
    });
  }
}

/**
 * @param {{
 *   record: Record<string, unknown>,
 *   source: string,
 *   parentField: string,
 *   featureSize: string,
 *   missionClass: string,
 *   issues: import("./index.d.ts").ContractValidationIssue[],
 * }} options
 */
function validateEvaluatorRubric(options) {
  const rubric = validateRequiredObjectField({
    record: options.record,
    source: options.source,
    field: `${options.parentField}.evaluator_rubric`,
    issues: options.issues,
  });
  if (!rubric) return;
  validateNestedStringField({
    record: rubric,
    source: options.source,
    field: `${options.parentField}.evaluator_rubric.quality_gate`,
    issues: options.issues,
    required: true,
  });
  validateNestedBooleanField({
    record: rubric,
    source: options.source,
    field: `${options.parentField}.evaluator_rubric.step_quality_required`,
    issues: options.issues,
    required: true,
  });
  for (const field of ["step_quality_dimensions", "evidence_expectations"]) {
    validateNestedArrayField({
      record: rubric,
      source: options.source,
      field: `${options.parentField}.evaluator_rubric.${field}`,
      issues: options.issues,
    });
    validateStringArrayItems({
      values: rubric[field],
      source: options.source,
      field: `${options.parentField}.evaluator_rubric.${field}`,
      issues: options.issues,
    });
  }
  if (options.missionClass === "product-change" && options.featureSize !== "small" && rubric.step_quality_required !== true) {
    options.issues.push(
      issue({
        code: "enum_value_invalid",
        source: options.source,
        field: `${options.parentField}.evaluator_rubric.step_quality_required`,
        expected: "true",
        actual: String(rubric.step_quality_required),
        message: `Product-change feature_size=${options.featureSize} missions require accepted step-quality assessment before continuation.`,
      }),
    );
  }
}

/**
 * @param {{
 *   record: Record<string, unknown>,
 *   source: string,
 *   parentField: string,
 *   issues: import("./index.d.ts").ContractValidationIssue[],
 * }} options
 */
function validateFinalCodeRubric(options) {
  const rubric = validateRequiredObjectField({
    record: options.record,
    source: options.source,
    field: `${options.parentField}.final_code_rubric`,
    issues: options.issues,
  });
  if (!rubric) return;
  validateNestedStringField({
    record: rubric,
    source: options.source,
    field: `${options.parentField}.final_code_rubric.quality_gate`,
    issues: options.issues,
    required: true,
  });
  for (const field of ["required_changed_surfaces", "acceptance_dimensions"]) {
    validateNestedArrayField({
      record: rubric,
      source: options.source,
      field: `${options.parentField}.final_code_rubric.${field}`,
      issues: options.issues,
    });
    validateStringArrayItems({
      values: rubric[field],
      source: options.source,
      field: `${options.parentField}.final_code_rubric.${field}`,
      issues: options.issues,
    });
  }
}

/**
 * @param {{
 *   cell: Record<string, unknown>,
 *   source: string,
 *   parentField: string,
 *   missionById: Map<string, Record<string, unknown>>,
 *   issues: import("./index.d.ts").ContractValidationIssue[],
 * }} options
 */
function validateTargetMatrixCell(options) {
  for (const field of ["cell_id", "feature_mission_id", "feature_size", "coverage_tier"]) {
    validateNestedStringField({
      record: options.cell,
      source: options.source,
      field: `${options.parentField}.${field}`,
      issues: options.issues,
      required: true,
    });
  }
  validateNestedEnumStringField({
    record: options.cell,
    source: options.source,
    field: `${options.parentField}.scenario_family`,
    allowedValues: LIVE_E2E_SCENARIO_VALUES,
    issues: options.issues,
    required: true,
  });
  validateNestedEnumStringField({
    record: options.cell,
    source: options.source,
    field: `${options.parentField}.provider_variant_id`,
    allowedValues: LIVE_E2E_PROVIDER_VARIANT_VALUES,
    issues: options.issues,
    required: true,
  });
  validateNestedEnumStringField({
    record: options.cell,
    source: options.source,
    field: `${options.parentField}.feature_size`,
    allowedValues: LIVE_E2E_FEATURE_SIZE_VALUES,
    issues: options.issues,
    required: true,
  });
  const missionId = typeof options.cell.feature_mission_id === "string" ? options.cell.feature_mission_id : "";
  const featureSize = typeof options.cell.feature_size === "string" ? options.cell.feature_size : "";
  const mission = options.missionById.get(missionId);
  if (!mission) {
    options.issues.push(
      issue({
        code: "required_field_missing",
        source: options.source,
        field: `${options.parentField}.feature_mission_id`,
        expected: "existing feature_missions[].mission_id",
        actual: missionId || "missing",
        message: `Field '${options.parentField}.feature_mission_id' must reference an existing feature mission.`,
      }),
    );
  } else if (featureSize && mission.feature_size !== featureSize) {
    options.issues.push(
      issue({
        code: "enum_value_invalid",
        source: options.source,
        field: `${options.parentField}.feature_size`,
        expected: String(mission.feature_size),
        actual: featureSize,
        message: `Field '${options.parentField}.feature_size' must match referenced mission '${missionId}'.`,
      }),
    );
  }
  const coverageTier = typeof options.cell.coverage_tier === "string" ? options.cell.coverage_tier : "required";
  if (featureSize === "xlarge" && coverageTier === "required") {
    options.issues.push(
      issue({
        code: "enum_value_invalid",
        source: options.source,
        field: `${options.parentField}.coverage_tier`,
        expected: "manual|extended",
        actual: "required",
        message: "feature_size=xlarge is manual or overnight only and must not be required coverage.",
      }),
    );
  }
}

/**
 * @param {Record<string, unknown>} document
 * @param {string} source
 * @returns {import("./index.d.ts").ContractValidationIssue[]}
 */
function validateLiveE2ETargetCatalog(document, source) {
  /** @type {import("./index.d.ts").ContractValidationIssue[]} */
  const issues = [];
  const missions = Array.isArray(document.feature_missions) ? document.feature_missions : [];
  /** @type {Map<string, Record<string, unknown>>} */
  const missionById = new Map();

  missions.forEach((entry, index) => {
    const parentField = `feature_missions[${index}]`;
    if (!isPlainObject(entry)) {
      issues.push(
        issue({
          code: "field_type_mismatch",
          source,
          field: parentField,
          expected: "object",
          actual: describeActualType(entry),
          message: `Field '${parentField}' must be 'object'.`,
        }),
      );
      return;
    }

    for (const field of ["mission_id", "title", "brief", "feature_size", "mission_class"]) {
      validateNestedStringField({
        record: entry,
        source,
        field: `${parentField}.${field}`,
        issues,
        required: true,
      });
    }
    validateNestedEnumStringField({
      record: entry,
      source,
      field: `${parentField}.feature_size`,
      allowedValues: LIVE_E2E_FEATURE_SIZE_VALUES,
      issues,
      required: true,
    });
    validateNestedEnumStringField({
      record: entry,
      source,
      field: `${parentField}.mission_class`,
      allowedValues: LIVE_E2E_MISSION_CLASS_VALUES,
      issues,
      required: true,
    });
    validateUnsupportedNestedFields({
      record: entry,
      source,
      parentField,
      fields: ["allowed_paths", "forbidden_paths"],
      issues,
    });

    const missionId = typeof entry.mission_id === "string" ? entry.mission_id : "";
    if (missionId) {
      missionById.set(missionId, entry);
    }
    const featureSize = typeof entry.feature_size === "string" ? entry.feature_size : "";
    const missionClass = typeof entry.mission_class === "string" ? entry.mission_class : "";
    if (featureSize === "small" && missionClass !== "flow-regression") {
      issues.push(
        issue({
          code: "enum_value_invalid",
          source,
          field: `${parentField}.mission_class`,
          expected: "flow-regression",
          actual: missionClass || "missing",
          message: "feature_size=small is reserved for flow-regression canary missions.",
        }),
      );
    }
    if (["medium", "large", "xlarge"].includes(featureSize) && missionClass !== "product-change") {
      issues.push(
        issue({
          code: "enum_value_invalid",
          source,
          field: `${parentField}.mission_class`,
          expected: "product-change",
          actual: missionClass || "missing",
          message: `feature_size=${featureSize} missions must be product-change missions.`,
        }),
      );
    }

    validateAgentVisibleRequest({ record: entry, source, parentField, issues });
    validateEvaluatorRubric({ record: entry, source, parentField, featureSize, missionClass, issues });
    validateFinalCodeRubric({ record: entry, source, parentField, issues });
    if (LIVE_E2E_FEATURE_SIZE_VALUES.includes(featureSize)) {
      validateMissionBudget({ mission: entry, source, parentField, budgetField: "size_budget", featureSize, issues });
      validateMissionBudget({ mission: entry, source, parentField, budgetField: "change_budget", featureSize, issues });
    }
  });

  for (const matrixField of ["required_matrix_cells", "manual_matrix_cells"]) {
    const cells = Array.isArray(document[matrixField]) ? document[matrixField] : [];
    cells.forEach((entry, index) => {
      const parentField = `${matrixField}[${index}]`;
      if (!isPlainObject(entry)) {
        issues.push(
          issue({
            code: "field_type_mismatch",
            source,
            field: parentField,
            expected: "object",
            actual: describeActualType(entry),
            message: `Field '${parentField}' must be 'object'.`,
          }),
        );
        return;
      }
      validateTargetMatrixCell({ cell: entry, source, parentField, missionById, issues });
    });
  }

  const comparisonPairs = Array.isArray(document.provider_comparison_pairs) ? document.provider_comparison_pairs : [];
  comparisonPairs.forEach((entry, index) => {
    if (!isPlainObject(entry)) return;
    validateNestedEnumStringField({
      record: entry,
      source,
      field: `provider_comparison_pairs[${index}].feature_size`,
      allowedValues: LIVE_E2E_FEATURE_SIZE_VALUES,
      issues,
      required: false,
    });
  });

  return issues;
}

/**
 * @param {Record<string, unknown>} document
 * @param {string} source
 * @returns {import("./index.d.ts").ContractValidationIssue[]}
 */
function validateLiveE2EStepQualityAssessmentReport(document, source) {
  /** @type {import("./index.d.ts").ContractValidationIssue[]} */
  const issues = [];
  const evaluator = isPlainObject(document.evaluator) ? document.evaluator : {};
  for (const field of ["kind", "mode", "responsibility"]) {
    validateNestedStringField({
      record: evaluator,
      source,
      field: `evaluator.${field}`,
      issues,
      required: true,
    });
  }
  validateNestedEnumStringField({
    record: document,
    source,
    field: "feature_size",
    allowedValues: LIVE_E2E_FEATURE_SIZE_VALUES,
    issues,
    required: true,
  });
  validateNestedEnumStringField({
    record: document,
    source,
    field: "mission_class",
    allowedValues: LIVE_E2E_MISSION_CLASS_VALUES,
    issues,
    required: true,
  });
  validateNestedEnumStringField({
    record: document,
    source,
    field: "status",
    allowedValues: LIVE_E2E_STEP_QUALITY_STATUS_VALUES,
    issues,
    required: true,
  });
  validateNestedEnumStringField({
    record: document,
    source,
    field: "decision",
    allowedValues: LIVE_E2E_STEP_QUALITY_DECISION_VALUES,
    issues,
    required: true,
  });
  validateStringArrayItems({
    values: document.inspected_evidence_refs,
    source,
    field: "inspected_evidence_refs",
    issues,
  });
  for (const field of ["findings", "repair_instructions", "evidence_refs"]) {
    validateStringArrayItems({
      values: document[field],
      source,
      field,
      issues,
    });
  }
  if (Array.isArray(document.inspected_evidence_refs) && document.inspected_evidence_refs.length === 0) {
    issues.push(
      issue({
        code: "required_field_missing",
        source,
        field: "inspected_evidence_refs",
        expected: "non-empty array",
        actual: "empty",
        message: "Step quality assessment must cite inspected public evidence refs.",
      }),
    );
  }
  if (Array.isArray(document.evidence_refs) && document.evidence_refs.length === 0) {
    issues.push(
      issue({
        code: "required_field_missing",
        source,
        field: "evidence_refs",
        expected: "non-empty array",
        actual: "empty",
        message: "Step quality assessment must cite materialized public evidence refs.",
      }),
    );
  }

  if (document.feature_size === "small" && document.mission_class !== "flow-regression") {
    issues.push(
      issue({
        code: "enum_value_invalid",
        source,
        field: "mission_class",
        expected: "flow-regression",
        actual: String(document.mission_class),
        message: "feature_size=small step assessments are canary-only flow-regression evidence.",
      }),
    );
  }
  if (["medium", "large", "xlarge"].includes(String(document.feature_size)) && document.mission_class !== "product-change") {
    issues.push(
      issue({
        code: "enum_value_invalid",
        source,
        field: "mission_class",
        expected: "product-change",
        actual: String(document.mission_class),
        message: "medium+ step assessments must belong to product-change missions.",
      }),
    );
  }
  if (document.status === "accepted" && document.decision !== "continue") {
    issues.push(
      issue({
        code: "enum_value_invalid",
        source,
        field: "decision",
        expected: "continue",
        actual: String(document.decision),
        message: "Accepted step quality assessments must make decision=continue.",
      }),
    );
  }

  const dimensions = isPlainObject(document.dimensions) ? document.dimensions : {};
  for (const dimensionKey of LIVE_E2E_STEP_QUALITY_DIMENSION_KEYS) {
    const dimension = dimensions[dimensionKey];
    const field = `dimensions.${dimensionKey}`;
    if (!isPlainObject(dimension)) {
      issues.push(
        issue({
          code: "required_field_missing",
          source,
          field,
          expected: "object",
          actual: describeActualType(dimension),
          message: `Missing required field '${field}'.`,
        }),
      );
      continue;
    }
    validateNestedEnumStringField({
      record: dimension,
      source,
      field: `${field}.status`,
      allowedValues: ["pass", "warn", "fail", "not_evaluated"],
      issues,
      required: true,
    });
    validateNestedEnumStringField({
      record: dimension,
      source,
      field: `${field}.evidence_strength`,
      allowedValues: LIVE_E2E_QUALITY_EVIDENCE_STRENGTH_VALUES,
      issues,
      required: true,
    });
    validateNestedArrayField({
      record: dimension,
      source,
      field: `${field}.inspected_evidence_refs`,
      issues,
    });
    validateStringArrayItems({
      values: dimension.inspected_evidence_refs,
      source,
      field: `${field}.inspected_evidence_refs`,
      issues,
    });
    validateNestedArrayField({
      record: dimension,
      source,
      field: `${field}.findings`,
      issues,
    });
    validateStringArrayItems({
      values: dimension.findings,
      source,
      field: `${field}.findings`,
      issues,
    });
    if (document.status === "accepted" && (dimension.status !== "pass" || !["strong", "medium"].includes(String(dimension.evidence_strength)))) {
      issues.push(
        issue({
          code: "enum_value_invalid",
          source,
          field,
          expected: "status=pass with evidence_strength=strong|medium",
          actual: `status=${String(dimension.status)}, evidence_strength=${String(dimension.evidence_strength)}`,
          message: "Accepted step quality assessments require passing dimensions with medium or strong evidence.",
        }),
      );
    }
  }

  return issues;
}

/**
 * @param {Record<string, unknown>} document
 * @param {string} source
 * @returns {import("./index.d.ts").ContractValidationIssue[]}
 */
function validateIntakeRequestBody(document, source) {
  /** @type {import("./index.d.ts").ContractValidationIssue[]} */
  const issues = [];
  const productIntake = isPlainObject(document.product_intake) ? document.product_intake : {};
  const completeness = isPlainObject(document.product_intake_completeness) ? document.product_intake_completeness : {};
  const missionScope = isPlainObject(document.mission_scope) ? document.mission_scope : {};

  for (const field of ["goals", "constraints", "kpis", "definition_of_done", "source_refs"]) {
    validateNestedArrayField({
      record: productIntake,
      source,
      field: `product_intake.${field}`,
      issues,
    });
  }

  validateNestedStringField({
    record: completeness,
    source,
    field: "product_intake_completeness.status",
    issues,
    required: true,
  });
  validateNestedArrayField({
    record: completeness,
    source,
    field: "product_intake_completeness.missing_fields",
    issues,
  });
  validateNestedArrayField({
    record: missionScope,
    source,
    field: "mission_scope.allowed_paths",
    issues,
  });
  validateNestedArrayField({
    record: missionScope,
    source,
    field: "mission_scope.forbidden_paths",
    issues,
  });
  validateNestedStringField({
    record: missionScope,
    source,
    field: "mission_scope.delivery_mode",
    issues,
    required: true,
  });

  validateStringArrayItems({
    values: productIntake.goals,
    source,
    field: "product_intake.goals",
    issues,
  });
  validateStringArrayItems({
    values: productIntake.constraints,
    source,
    field: "product_intake.constraints",
    issues,
  });
  validateStringArrayItems({
    values: productIntake.definition_of_done,
    source,
    field: "product_intake.definition_of_done",
    issues,
  });
  validateStringArrayItems({
    values: completeness.missing_fields,
    source,
    field: "product_intake_completeness.missing_fields",
    issues,
  });

  if (typeof completeness.status === "string" && !["complete", "incomplete"].includes(completeness.status)) {
    issues.push(
      issue({
        code: "enum_value_invalid",
        source,
        field: "product_intake_completeness.status",
        expected: "complete|incomplete",
        actual: completeness.status,
        message: "Field 'product_intake_completeness.status' has unsupported value.",
      }),
    );
  }

  if (typeof missionScope.delivery_mode === "string" && !DELIVERY_MODE_VALUES.includes(missionScope.delivery_mode)) {
    issues.push(
      issue({
        code: "enum_value_invalid",
        source,
        field: "mission_scope.delivery_mode",
        expected: DELIVERY_MODE_VALUES.join("|"),
        actual: missionScope.delivery_mode,
        message: "Field 'mission_scope.delivery_mode' has unsupported value.",
      }),
    );
  }

  if (Array.isArray(productIntake.kpis)) {
    productIntake.kpis.forEach((entry, index) => {
      const record = isPlainObject(entry) ? entry : {};
      if (!isPlainObject(entry)) {
        issues.push(
          issue({
            code: "field_type_mismatch",
            source,
            field: `product_intake.kpis[${index}]`,
            expected: "object",
            actual: describeActualType(entry),
            message: `Field 'product_intake.kpis[${index}]' must be 'object'.`,
          }),
        );
        return;
      }

      for (const field of ["kpi_id", "name", "target"]) {
        validateNestedStringField({
          record,
          source,
          field: `product_intake.kpis[${index}].${field}`,
          issues,
          required: true,
        });
      }
      validateNestedStringField({
        record,
        source,
        field: `product_intake.kpis[${index}].measurement`,
        issues,
        required: false,
      });
    });
  }

  if (Array.isArray(productIntake.source_refs)) {
    productIntake.source_refs.forEach((entry, index) => {
      const record = isPlainObject(entry) ? entry : {};
      if (!isPlainObject(entry)) {
        issues.push(
          issue({
            code: "field_type_mismatch",
            source,
            field: `product_intake.source_refs[${index}]`,
            expected: "object",
            actual: describeActualType(entry),
            message: `Field 'product_intake.source_refs[${index}]' must be 'object'.`,
          }),
        );
        return;
      }

      for (const field of ["source_id", "source_kind", "title", "ref"]) {
        validateNestedStringField({
          record,
          source,
          field: `product_intake.source_refs[${index}].${field}`,
          issues,
          required: true,
        });
      }

      const sourceKind = record.source_kind;
      if (typeof sourceKind === "string" && !INTAKE_SOURCE_KIND_VALUES.includes(sourceKind)) {
        issues.push(
          issue({
            code: "enum_value_invalid",
            source,
            field: `product_intake.source_refs[${index}].source_kind`,
            expected: INTAKE_SOURCE_KIND_VALUES.join("|"),
            actual: sourceKind,
            message: `Field 'product_intake.source_refs[${index}].source_kind' must use a local intake source kind; external SaaS connectors are out of scope.`,
          }),
        );
      }
    });
  }

  return issues;
}

/**
 * @param {{ record: Record<string, unknown>, source: string, field: string, issues: import("./index.d.ts").ContractValidationIssue[], required?: boolean }} options
 */
function validateNestedArrayField(options) {
  const fieldName = options.field.split(".").at(-1) ?? options.field;
  if (!(fieldName in options.record)) {
    if (options.required ?? true) {
      options.issues.push(
        issue({
          code: "required_field_missing",
          source: options.source,
          field: options.field,
          expected: "present",
          actual: "missing",
          message: `Missing required field '${options.field}'.`,
        }),
      );
    }
    return;
  }

  const value = options.record[fieldName];
  if (!Array.isArray(value)) {
    options.issues.push(
      issue({
        code: "field_type_mismatch",
        source: options.source,
        field: options.field,
        expected: "array",
        actual: describeActualType(value),
        message: `Field '${options.field}' must be 'array'.`,
      }),
    );
  }
}

/**
 * @param {{ record: Record<string, unknown>, source: string, field: string, issues: import("./index.d.ts").ContractValidationIssue[], allowNull?: boolean }} options
 * @returns {unknown[] | null}
 */
function validateOptionalArrayField(options) {
  const fieldName = options.field.split(".").at(-1) ?? options.field;
  if (!(fieldName in options.record)) {
    return null;
  }
  const value = options.record[fieldName];
  if (options.allowNull && value === null) {
    return null;
  }
  if (!Array.isArray(value)) {
    options.issues.push(
      issue({
        code: "field_type_mismatch",
        source: options.source,
        field: options.field,
        expected: "array",
        actual: describeActualType(value),
        message: `Field '${options.field}' must be 'array'.`,
      }),
    );
    return null;
  }
  return value;
}

/**
 * @param {{ record: Record<string, unknown>, source: string, field: string, issues: import("./index.d.ts").ContractValidationIssue[], allowNull?: boolean }} options
 */
function validateOptionalStringArrayField(options) {
  const values = validateOptionalArrayField(options);
  if (!values) return;
  validateStringArrayItems({
    values,
    source: options.source,
    field: options.field,
    issues: options.issues,
  });
}

/**
 * @param {{ record: Record<string, unknown>, source: string, field: string, issues: import("./index.d.ts").ContractValidationIssue[], allowNull?: boolean }} options
 * @returns {Record<string, unknown> | null}
 */
function validateOptionalObjectField(options) {
  const fieldName = options.field.split(".").at(-1) ?? options.field;
  if (!(fieldName in options.record)) {
    return null;
  }
  const value = options.record[fieldName];
  if (options.allowNull && value === null) {
    return null;
  }
  if (!isPlainObject(value)) {
    options.issues.push(
      issue({
        code: "field_type_mismatch",
        source: options.source,
        field: options.field,
        expected: "object",
        actual: describeActualType(value),
        message: `Field '${options.field}' must be 'object'.`,
      }),
    );
    return null;
  }
  return value;
}

/**
 * @param {{ record: Record<string, unknown>, source: string, field: string, issues: import("./index.d.ts").ContractValidationIssue[], required: boolean }} options
 */
function validateNestedStringField(options) {
  const fieldName = options.field.split(".").at(-1) ?? options.field;
  if (!(fieldName in options.record)) {
    if (options.required) {
      options.issues.push(
        issue({
          code: "required_field_missing",
          source: options.source,
          field: options.field,
          expected: "present",
          actual: "missing",
          message: `Missing required field '${options.field}'.`,
        }),
      );
    }
    return;
  }

  const value = options.record[fieldName];
  if (typeof value !== "string") {
    options.issues.push(
      issue({
        code: "field_type_mismatch",
        source: options.source,
        field: options.field,
        expected: "string",
        actual: describeActualType(value),
        message: `Field '${options.field}' must be 'string'.`,
      }),
    );
  }
}

/**
 * @param {{ record: Record<string, unknown>, source: string, field: string, issues: import("./index.d.ts").ContractValidationIssue[], required: boolean }} options
 */
function validateNestedNullableStringField(options) {
  const fieldName = options.field.split(".").at(-1) ?? options.field;
  if (!(fieldName in options.record)) {
    if (options.required) {
      options.issues.push(
        issue({
          code: "required_field_missing",
          source: options.source,
          field: options.field,
          expected: "present",
          actual: "missing",
          message: `Missing required field '${options.field}'.`,
        }),
      );
    }
    return;
  }

  const value = options.record[fieldName];
  if (value !== null && typeof value !== "string") {
    options.issues.push(
      issue({
        code: "field_type_mismatch",
        source: options.source,
        field: options.field,
        expected: "string|null",
        actual: describeActualType(value),
        message: `Field '${options.field}' must be 'string|null'.`,
      }),
    );
  }
}

/**
 * @param {{ record: Record<string, unknown>, source: string, field: string, issues: import("./index.d.ts").ContractValidationIssue[], required: boolean, allowNull?: boolean }} options
 */
function validateNestedNumberField(options) {
  const fieldName = options.field.split(".").at(-1) ?? options.field;
  if (!(fieldName in options.record)) {
    if (options.required) {
      options.issues.push(
        issue({
          code: "required_field_missing",
          source: options.source,
          field: options.field,
          expected: "present",
          actual: "missing",
          message: `Missing required field '${options.field}'.`,
        }),
      );
    }
    return;
  }

  const value = options.record[fieldName];
  if (options.allowNull && value === null) {
    return;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    options.issues.push(
      issue({
        code: "field_type_mismatch",
        source: options.source,
        field: options.field,
        expected: "number",
        actual: describeActualType(value),
        message: `Field '${options.field}' must be 'number'.`,
      }),
    );
  }
}

/**
 * @param {{ record: Record<string, unknown>, source: string, field: string, issues: import("./index.d.ts").ContractValidationIssue[], required: boolean }} options
 */
function validateNestedBooleanField(options) {
  const fieldName = options.field.split(".").at(-1) ?? options.field;
  if (!(fieldName in options.record)) {
    if (options.required) {
      options.issues.push(
        issue({
          code: "required_field_missing",
          source: options.source,
          field: options.field,
          expected: "present",
          actual: "missing",
          message: `Missing required field '${options.field}'.`,
        }),
      );
    }
    return;
  }

  const value = options.record[fieldName];
  if (typeof value !== "boolean") {
    options.issues.push(
      issue({
        code: "field_type_mismatch",
        source: options.source,
        field: options.field,
        expected: "boolean",
        actual: describeActualType(value),
        message: `Field '${options.field}' must be 'boolean'.`,
      }),
    );
  }
}

/**
 * @param {{ record: Record<string, unknown>, source: string, field: string, allowedValues: string[], issues: import("./index.d.ts").ContractValidationIssue[], required: boolean }} options
 */
function validateNestedEnumStringField(options) {
  validateNestedStringField(options);
  const fieldName = options.field.split(".").at(-1) ?? options.field;
  const value = options.record[fieldName];
  if (typeof value === "string" && !options.allowedValues.includes(value)) {
    options.issues.push(
      issue({
        code: "enum_value_invalid",
        source: options.source,
        field: options.field,
        expected: options.allowedValues.join("|"),
        actual: value,
        message: `Field '${options.field}' has unsupported value '${value}'.`,
      }),
    );
  }
}

/**
 * @param {{ record: Record<string, unknown>, source: string, parentField: string, fields: string[], issues: import("./index.d.ts").ContractValidationIssue[] }} options
 */
function validateUnsupportedNestedFields(options) {
  for (const field of options.fields) {
    if (!(field in options.record)) continue;
    const nestedField = `${options.parentField}.${field}`;
    options.issues.push(
      issue({
        code: "unsupported_field_present",
        source: options.source,
        field: nestedField,
        expected: "field omitted",
        actual: "present",
        message: `Field '${nestedField}' is not supported in the current contract shape.`,
      }),
    );
  }
}

/**
 * @param {{ values: unknown, source: string, field: string, issues: import("./index.d.ts").ContractValidationIssue[] }} options
 */
function validateStringArrayItems(options) {
  if (!Array.isArray(options.values)) return;
  options.values.forEach((value, index) => {
    if (typeof value === "string") return;
    options.issues.push(
      issue({
        code: "field_type_mismatch",
        source: options.source,
        field: `${options.field}[${index}]`,
        expected: "string",
        actual: describeActualType(value),
        message: `Field '${options.field}[${index}]' must be 'string'.`,
      }),
    );
  });
}

/**
 * @param {Record<string, unknown>} document
 * @param {string} source
 * @returns {import("./index.d.ts").ContractValidationIssue[]}
 */
function validateLiveE2EObservationReport(document, source) {
  /** @type {import("./index.d.ts").ContractValidationIssue[]} */
  const issues = [];
  const reportStatus = typeof document.report_status === "string" ? document.report_status : "final";
  if (!["final", "in_progress"].includes(reportStatus)) {
    issues.push(
      issue({
        code: "enum_value_invalid",
        source,
        field: "report_status",
        expected: "final|in_progress",
        actual: String(reportStatus),
        message: "Field 'report_status' must describe whether the live E2E report is final or waiting for operator resume.",
      }),
    );
  }
  const installation = isPlainObject(document.aor_installation) ? document.aor_installation : {};
  if (Object.keys(installation).length === 0) {
    issues.push(
      issue({
        code: "required_field_missing",
        source,
        field: "aor_installation",
        expected: "non-empty object",
        actual: "missing",
        message: "Field 'aor_installation' is required for installed-user live E2E reports.",
      }),
    );
  }
  if (typeof document.aor_installation_proof_file !== "string" || document.aor_installation_proof_file.length === 0) {
    issues.push(
      issue({
        code: document.aor_installation_proof_file === undefined ? "required_field_missing" : "field_type_mismatch",
        source,
        field: "aor_installation_proof_file",
        expected: document.aor_installation_proof_file === undefined ? "present" : "string",
        actual: document.aor_installation_proof_file === undefined ? "missing" : describeActualType(document.aor_installation_proof_file),
        message: "Field 'aor_installation_proof_file' is required for installed-user live E2E reports.",
      }),
    );
  }
  const operatorContext = isPlainObject(document.operator_context) ? document.operator_context : {};
  for (const [field, expectedValues] of [
    ["operator_kind", ["skill-agent"]],
    ["decision_policy", ["required"]],
    ["answer_policy", ["agent-public-control-plane"]],
    ["target_write_policy", ["aor-runtime-only-before-execution"]],
  ]) {
    const value = operatorContext[field];
    if (typeof value !== "string" || !expectedValues.includes(value)) {
      issues.push(
        issue({
          code: value === undefined ? "required_field_missing" : "enum_value_invalid",
          source,
          field: `operator_context.${field}`,
          expected: expectedValues.join("|"),
          actual: value === undefined ? "missing" : String(value),
          message: `Field 'operator_context.${field}' must declare the live E2E operator policy.`,
        }),
      );
    }
  }
  if (typeof operatorContext.operator_ref !== "string" || operatorContext.operator_ref.length === 0) {
    issues.push(
      issue({
        code: operatorContext.operator_ref === undefined ? "required_field_missing" : "field_type_mismatch",
        source,
        field: "operator_context.operator_ref",
        expected: "non-empty string",
        actual: operatorContext.operator_ref === undefined ? "missing" : describeActualType(operatorContext.operator_ref),
        message: "Field 'operator_context.operator_ref' must identify the live E2E operator.",
      }),
    );
  }
  const finalAnalysis = isPlainObject(document.final_analysis)
    ? document.final_analysis
    : {};
  validateUnsupportedNestedFields({
    record: finalAnalysis,
    source,
    parentField: "final_analysis",
    fields: ["code_quality", "artifact_quality", "quality_judgement", "runner_quality_summary"],
    issues,
  });
  validateObservationStatusField({
    value: finalAnalysis.status,
    source,
    field: "final_analysis.status",
    issues,
  });
  validateObservationStepJournal({
    entries: document.step_journal,
    operatorContext,
    reportStatus,
    source,
    issues,
  });
  validateObservationFlowRange({
    value: document.flow_range,
    source,
    issues,
  });
  validateObservationSetupJournal({
    entries: document.setup_journal,
    source,
    issues,
  });
  validateObservationFrontendInteractions({
    entries: document.frontend_interactions,
    source,
    issues,
  });
  return issues;
}

/**
 * @param {unknown} value
 * @param {string} source
 * @param {string} field
 * @param {string[]} allowedValues
 * @param {import("./index.d.ts").ContractValidationIssue[]} issues
 */
function validateEnumString(value, source, field, allowedValues, issues) {
  if (typeof value !== "string" || value.length === 0) {
    issues.push(
      issue({
        code: value === undefined ? "required_field_missing" : "field_type_mismatch",
        source,
        field,
        expected: "non-empty string",
        actual: value === undefined ? "missing" : describeActualType(value),
        message: `Field '${field}' must be a non-empty string.`,
      }),
    );
    return;
  }
  if (!allowedValues.includes(value)) {
    issues.push(
      issue({
        code: "enum_value_invalid",
        source,
        field,
        expected: allowedValues.join("|"),
        actual: value,
        message: `Field '${field}' has unsupported value '${value}'.`,
      }),
    );
  }
}

/**
 * @param {Record<string, unknown>} document
 * @param {string} source
 * @returns {import("./index.d.ts").ContractValidationIssue[]}
 */
function validateLiveE2ERunHealthReport(document, source) {
  /** @type {import("./index.d.ts").ContractValidationIssue[]} */
  const issues = [];
  validateEnumString(document.overall_status, source, "overall_status", LIVE_E2E_RUN_HEALTH_STATUS_VALUES, issues);
  validateStringArrayItems({ values: document.evidence_refs, source, field: "evidence_refs", issues });

  for (const field of [
    "lifecycle_completion",
    "command_health",
    "controller_health",
    "provider_health",
    "target_environment_health",
    "diagnostic_health",
    "evidence_health",
    "failure_summary",
    "resume_interaction_health",
  ]) {
    if (!isPlainObject(document[field])) {
      issues.push(
        issue({
          code: document[field] === undefined ? "required_field_missing" : "field_type_mismatch",
          source,
          field,
          expected: "object",
          actual: document[field] === undefined ? "missing" : describeActualType(document[field]),
          message: `Field '${field}' is required for factual run-health reporting.`,
        }),
      );
    }
  }

  const providerHealth = isPlainObject(document.provider_health) ? document.provider_health : {};
  for (const field of ["request_artifact_ref", "provider_work_packet_ref", "context_budget_status"]) {
    validateNestedNullableStringField({
      record: providerHealth,
      source,
      field: `provider_health.${field}`,
      issues,
      required: false,
    });
  }
  for (const field of ["context_budget_failure_class", "raw_provider_error_summary"]) {
    validateNestedNullableStringField({
      record: providerHealth,
      source,
      field: `provider_health.${field}`,
      issues,
      required: false,
    });
  }
  if ("top_context_size_sources" in providerHealth) {
    validateContextSizeSources(
      providerHealth.top_context_size_sources,
      source,
      "provider_health.top_context_size_sources",
      issues,
    );
  }

  validateLiveE2EDiagnosticHealth(document.diagnostic_health, source, issues);

  const failureSummary = isPlainObject(document.failure_summary) ? document.failure_summary : {};
  const terminalStatus = typeof document.overall_status === "string" ? document.overall_status : "fail";
  if (terminalStatus === "pass") {
    for (const field of ["owner", "phase"]) {
      const value = failureSummary[field];
      if (value !== null && value !== undefined) {
        issues.push(
          issue({
            code: "enum_value_invalid",
            source,
            field: `failure_summary.${field}`,
            expected: "null when overall_status=pass",
            actual: String(value),
            message: `Field 'failure_summary.${field}' must be null for passing run-health reports.`,
          }),
        );
      }
    }
  } else {
    validateEnumString(failureSummary.owner, source, "failure_summary.owner", LIVE_E2E_RUN_FAILURE_OWNER_VALUES, issues);
    validateEnumString(failureSummary.phase, source, "failure_summary.phase", LIVE_E2E_RUN_FAILURE_PHASE_VALUES, issues);
    if (typeof failureSummary.class !== "string" || failureSummary.class.length === 0) {
      issues.push(
        issue({
          code: failureSummary.class === undefined ? "required_field_missing" : "field_type_mismatch",
          source,
          field: "failure_summary.class",
          expected: "non-empty string",
          actual: failureSummary.class === undefined ? "missing" : describeActualType(failureSummary.class),
          message: "Field 'failure_summary.class' must classify a non-passing run-health report.",
        }),
      );
    }
  }

  const diagnosticHealth = isPlainObject(document.diagnostic_health) ? document.diagnostic_health : {};
  if (diagnosticHealth.status === "warn" && terminalStatus === "pass") {
    issues.push(
      issue({
        code: "enum_value_invalid",
        source,
        field: "overall_status",
        expected: "warn when diagnostic_health.status=warn",
        actual: String(document.overall_status),
        message: "Run-health cannot pass while diagnostic_health records a factual warning.",
      }),
    );
  }
  if (diagnosticHealth.status === "fail") {
    for (const [field, expected] of [
      ["owner", "target_repository"],
      ["phase", "target_verification"],
      ["class", "post_run_diagnostic_failed"],
    ]) {
      if (failureSummary[field] !== expected) {
        issues.push(
          issue({
            code: "enum_value_invalid",
            source,
            field: `failure_summary.${field}`,
            expected,
            actual: String(failureSummary[field]),
            message: `Diagnostic failure reports must classify failure_summary.${field} as '${expected}'.`,
          }),
        );
      }
    }
  }

  if (Array.isArray(document.run_findings)) {
    document.run_findings.forEach((entry, index) => {
      const record = isPlainObject(entry) ? entry : {};
      for (const field of ["category", "severity", "summary"]) {
        const value = record[field];
        if (typeof value !== "string" || value.length === 0) {
          issues.push(
            issue({
              code: value === undefined ? "required_field_missing" : "field_type_mismatch",
              source,
              field: `run_findings[${index}].${field}`,
              expected: "non-empty string",
              actual: value === undefined ? "missing" : describeActualType(value),
              message: `Field 'run_findings[${index}].${field}' is required for actionable run-health findings.`,
            }),
          );
        }
      }
      validateStringArrayItems({
        values: record.evidence_refs,
        source,
        field: `run_findings[${index}].evidence_refs`,
        issues,
      });
    });
  }

  return issues;
}

/**
 * @param {unknown} value
 * @param {string} source
 * @param {import("./index.d.ts").ContractValidationIssue[]} issues
 */
function validateLiveE2EDiagnosticHealth(value, source, issues) {
  const diagnosticHealth = isPlainObject(value) ? value : {};
  validateEnumString(
    diagnosticHealth.status,
    source,
    "diagnostic_health.status",
    LIVE_E2E_RUN_HEALTH_STATUS_VALUES,
    issues,
  );
  if (
    diagnosticHealth.diagnostic_failure_mode !== null &&
    diagnosticHealth.diagnostic_failure_mode !== undefined
  ) {
    validateEnumString(
      diagnosticHealth.diagnostic_failure_mode,
      source,
      "diagnostic_health.diagnostic_failure_mode",
      LIVE_E2E_DIAGNOSTIC_FAILURE_MODE_VALUES,
      issues,
    );
  }
  if (
    diagnosticHealth.post_run_diagnostic_status !== null &&
    diagnosticHealth.post_run_diagnostic_status !== undefined
  ) {
    validateEnumString(
      diagnosticHealth.post_run_diagnostic_status,
      source,
      "diagnostic_health.post_run_diagnostic_status",
      LIVE_E2E_RUN_HEALTH_STATUS_VALUES,
      issues,
    );
  }
  validateNestedNullableStringField({
    record: diagnosticHealth,
    source,
    field: "diagnostic_health.post_run_diagnostic_verify_summary_file",
    issues,
    required: true,
  });
  for (const field of ["timed_out_command_count", "failed_command_count"]) {
    validateNestedNumberField({
      record: diagnosticHealth,
      source,
      field: `diagnostic_health.${field}`,
      issues,
      required: true,
    });
  }
  for (const field of ["timed_out_commands", "failed_commands", "evidence_refs"]) {
    validateNestedArrayField({
      record: diagnosticHealth,
      source,
      field: `diagnostic_health.${field}`,
      issues,
      required: true,
    });
  }
  validateStringArrayItems({
    values: diagnosticHealth.evidence_refs,
    source,
    field: "diagnostic_health.evidence_refs",
    issues,
  });
}

/**
 * @param {Record<string, unknown>} document
 * @param {string} source
 * @returns {import("./index.d.ts").ContractValidationIssue[]}
 */
function validateLiveE2EQualityAssessmentReport(document, source) {
  /** @type {import("./index.d.ts").ContractValidationIssue[]} */
  const issues = [];
  validateEnumString(document.overall_status, source, "overall_status", LIVE_E2E_QUALITY_ASSESSMENT_STATUS_VALUES, issues);
  validateStringArrayItems({ values: document.evidence_refs, source, field: "evidence_refs", issues });
  validateStringArrayItems({ values: document.recommended_followups, source, field: "recommended_followups", issues });

  const evaluator = isPlainObject(document.evaluator) ? document.evaluator : {};
  validateEnumString(evaluator.kind, source, "evaluator.kind", ["swe-agent"], issues);
  if (typeof evaluator.ref !== "string" || evaluator.ref.length === 0) {
    issues.push(
      issue({
        code: evaluator.ref === undefined ? "required_field_missing" : "field_type_mismatch",
        source,
        field: "evaluator.ref",
        expected: "non-empty string",
        actual: evaluator.ref === undefined ? "missing" : describeActualType(evaluator.ref),
        message: "Field 'evaluator.ref' must identify the assessing SWE agent.",
      }),
    );
  }

  const dimensions = isPlainObject(document.dimensions) ? document.dimensions : {};
  validateUnsupportedNestedFields({
    record: dimensions,
    source,
    parentField: "dimensions",
    fields: LIVE_E2E_LEGACY_QUALITY_DIMENSION_KEYS,
    issues,
  });
  const expectedGapDimensions = {
    not_evaluated_dimensions: [],
    weak_signal_dimensions: [],
    strong_evidence_dimensions: [],
  };
  for (const dimensionKey of LIVE_E2E_QUALITY_DIMENSION_KEYS) {
    const dimension = isPlainObject(dimensions[dimensionKey]) ? dimensions[dimensionKey] : null;
    if (!dimension) {
      issues.push(
        issue({
          code: dimensions[dimensionKey] === undefined ? "required_field_missing" : "field_type_mismatch",
          source,
          field: `dimensions.${dimensionKey}`,
          expected: "object",
          actual: dimensions[dimensionKey] === undefined ? "missing" : describeActualType(dimensions[dimensionKey]),
          message: `Quality assessment must include dimension '${dimensionKey}'.`,
        }),
      );
      continue;
    }
    validateEnumString(
      dimension.status,
      source,
      `dimensions.${dimensionKey}.status`,
      LIVE_E2E_QUALITY_ASSESSMENT_STATUS_VALUES,
      issues,
    );
    validateEnumString(
      dimension.evidence_strength,
      source,
      `dimensions.${dimensionKey}.evidence_strength`,
      LIVE_E2E_QUALITY_EVIDENCE_STRENGTH_VALUES,
      issues,
    );
    const inspectedRefs = Array.isArray(dimension.inspected_evidence_refs) ? dimension.inspected_evidence_refs : [];
    if (!Array.isArray(dimension.inspected_evidence_refs)) {
      issues.push(
        issue({
          code: dimension.inspected_evidence_refs === undefined ? "required_field_missing" : "field_type_mismatch",
          source,
          field: `dimensions.${dimensionKey}.inspected_evidence_refs`,
          expected: "array",
          actual:
            dimension.inspected_evidence_refs === undefined
              ? "missing"
              : describeActualType(dimension.inspected_evidence_refs),
          message: `Dimension '${dimensionKey}' must list inspected evidence refs, even when empty for not_evaluated.`,
        }),
      );
    } else {
      validateStringArrayItems({
        values: dimension.inspected_evidence_refs,
        source,
        field: `dimensions.${dimensionKey}.inspected_evidence_refs`,
        issues,
      });
    }
    const findings = Array.isArray(dimension.findings) ? dimension.findings : [];
    if (!Array.isArray(dimension.findings)) {
      issues.push(
        issue({
          code: dimension.findings === undefined ? "required_field_missing" : "field_type_mismatch",
          source,
          field: `dimensions.${dimensionKey}.findings`,
          expected: "array",
          actual: dimension.findings === undefined ? "missing" : describeActualType(dimension.findings),
          message: `Dimension '${dimensionKey}' must include structured findings.`,
        }),
      );
    } else {
      validateAssessmentFindings(
        dimension.findings,
        source,
        `dimensions.${dimensionKey}.findings`,
        issues,
      );
    }
    if (dimension.status === "not_evaluated") {
      if (dimension.evidence_strength !== "missing") {
        issues.push(
          issue({
            code: "enum_value_invalid",
            source,
            field: `dimensions.${dimensionKey}.evidence_strength`,
            expected: "missing when status=not_evaluated",
            actual: String(dimension.evidence_strength),
            message: "A not_evaluated dimension must declare missing evidence strength.",
          }),
        );
      }
      if (findings.length === 0) {
        issues.push(
          issue({
            code: "required_field_missing",
            source,
            field: `dimensions.${dimensionKey}.findings`,
            expected: "finding explaining not_evaluated",
            actual: "empty array",
            message: "A not_evaluated dimension must include a finding explaining why it was not evaluated.",
          }),
        );
      }
    } else if (inspectedRefs.length === 0) {
      issues.push(
        issue({
          code: "required_field_missing",
          source,
          field: `dimensions.${dimensionKey}.inspected_evidence_refs`,
          expected: "non-empty string array",
          actual: "empty array",
          message: `Dimension '${dimensionKey}' must cite inspected evidence unless it is not_evaluated.`,
        }),
      );
    }
    if (dimension.evidence_strength === "missing" && dimension.status !== "not_evaluated") {
      issues.push(
        issue({
          code: "enum_value_invalid",
          source,
          field: `dimensions.${dimensionKey}.status`,
          expected: "not_evaluated when evidence_strength=missing",
          actual: String(dimension.status),
          message: "Missing evidence strength cannot be reported as an evaluated dimension.",
        }),
      );
    }
    if (dimension.status === "not_evaluated") {
      expectedGapDimensions.not_evaluated_dimensions.push(dimensionKey);
    }
    if (dimension.evidence_strength === "weak") {
      expectedGapDimensions.weak_signal_dimensions.push(dimensionKey);
    }
    if (dimension.evidence_strength === "strong") {
      expectedGapDimensions.strong_evidence_dimensions.push(dimensionKey);
    }
    if (!Array.isArray(dimension.recommended_followups)) {
      issues.push(
        issue({
          code: dimension.recommended_followups === undefined ? "required_field_missing" : "field_type_mismatch",
          source,
          field: `dimensions.${dimensionKey}.recommended_followups`,
          expected: "array",
          actual:
            dimension.recommended_followups === undefined
              ? "missing"
              : describeActualType(dimension.recommended_followups),
          message: `Dimension '${dimensionKey}' must include recommended_followups[].`,
        }),
      );
    } else {
      validateStringArrayItems({
        values: dimension.recommended_followups,
        source,
        field: `dimensions.${dimensionKey}.recommended_followups`,
        issues,
      });
    }
    const requiredSubdimensions = LIVE_E2E_AOR_OPERATOR_UI_QUALITY_SUBDIMENSION_KEYS[dimensionKey];
    if (requiredSubdimensions) {
      validateQualityAssessmentSubdimensions({
        dimensionKey,
        dimension,
        requiredSubdimensions,
        source,
        issues,
      });
    }
  }

  validateAssessmentFindings(document.findings, source, "findings", issues);
  const gapReport = isPlainObject(document.gap_report) ? document.gap_report : {};
  for (const field of ["not_evaluated_dimensions", "weak_signal_dimensions", "strong_evidence_dimensions"]) {
    if (!Array.isArray(gapReport[field])) {
      issues.push(
        issue({
          code: gapReport[field] === undefined ? "required_field_missing" : "field_type_mismatch",
          source,
          field: `gap_report.${field}`,
          expected: "array",
          actual: gapReport[field] === undefined ? "missing" : describeActualType(gapReport[field]),
          message: `Field 'gap_report.${field}' must be an array of dimension keys.`,
        }),
      );
      continue;
    }
    validateStringArrayItems({ values: gapReport[field], source, field: `gap_report.${field}`, issues });
    validateQualityGapDimensionSet({
      values: gapReport[field],
      expectedValues: expectedGapDimensions[field],
      source,
      field: `gap_report.${field}`,
      issues,
    });
  }
  return issues;
}

/**
 * @param {{
 *   dimensionKey: string,
 *   dimension: Record<string, unknown>,
 *   requiredSubdimensions: string[],
 *   source: string,
 *   issues: import("./index.d.ts").ContractValidationIssue[],
 * }} options
 */
function validateQualityAssessmentSubdimensions(options) {
  const subdimensions = isPlainObject(options.dimension.subdimensions)
    ? options.dimension.subdimensions
    : null;
  if (!subdimensions) {
    options.issues.push(
      issue({
        code: options.dimension.subdimensions === undefined ? "required_field_missing" : "field_type_mismatch",
        source: options.source,
        field: `dimensions.${options.dimensionKey}.subdimensions`,
        expected: "object",
        actual:
          options.dimension.subdimensions === undefined
            ? "missing"
            : describeActualType(options.dimension.subdimensions),
        message: `Dimension '${options.dimensionKey}' must include AOR operator UI/UX subdimensions.`,
      }),
    );
    return;
  }
  for (const subdimensionKey of options.requiredSubdimensions) {
    const fieldPrefix = `dimensions.${options.dimensionKey}.subdimensions.${subdimensionKey}`;
    const subdimension = isPlainObject(subdimensions[subdimensionKey]) ? subdimensions[subdimensionKey] : null;
    if (!subdimension) {
      options.issues.push(
        issue({
          code: subdimensions[subdimensionKey] === undefined ? "required_field_missing" : "field_type_mismatch",
          source: options.source,
          field: fieldPrefix,
          expected: "object",
          actual:
            subdimensions[subdimensionKey] === undefined
              ? "missing"
              : describeActualType(subdimensions[subdimensionKey]),
          message: `AOR operator UI/UX assessment must include subdimension '${subdimensionKey}'.`,
        }),
      );
      continue;
    }
    validateEnumString(
      subdimension.status,
      options.source,
      `${fieldPrefix}.status`,
      LIVE_E2E_QUALITY_ASSESSMENT_STATUS_VALUES,
      options.issues,
    );
    validateEnumString(
      subdimension.evidence_strength,
      options.source,
      `${fieldPrefix}.evidence_strength`,
      LIVE_E2E_QUALITY_EVIDENCE_STRENGTH_VALUES,
      options.issues,
    );
    const evidenceRefs = Array.isArray(subdimension.evidence_refs) ? subdimension.evidence_refs : [];
    if (!Array.isArray(subdimension.evidence_refs)) {
      options.issues.push(
        issue({
          code: subdimension.evidence_refs === undefined ? "required_field_missing" : "field_type_mismatch",
          source: options.source,
          field: `${fieldPrefix}.evidence_refs`,
          expected: "array",
          actual:
            subdimension.evidence_refs === undefined
              ? "missing"
              : describeActualType(subdimension.evidence_refs),
          message: `AOR operator UI/UX subdimension '${subdimensionKey}' must list evidence refs.`,
        }),
      );
    } else {
      validateStringArrayItems({
        values: subdimension.evidence_refs,
        source: options.source,
        field: `${fieldPrefix}.evidence_refs`,
        issues: options.issues,
      });
    }
    const findings = Array.isArray(subdimension.findings) ? subdimension.findings : [];
    if (!Array.isArray(subdimension.findings)) {
      options.issues.push(
        issue({
          code: subdimension.findings === undefined ? "required_field_missing" : "field_type_mismatch",
          source: options.source,
          field: `${fieldPrefix}.findings`,
          expected: "array",
          actual:
            subdimension.findings === undefined
              ? "missing"
              : describeActualType(subdimension.findings),
          message: `AOR operator UI/UX subdimension '${subdimensionKey}' must include findings.`,
        }),
      );
    } else {
      validateAssessmentFindings(subdimension.findings, options.source, `${fieldPrefix}.findings`, options.issues);
    }
    if (subdimension.status === "not_evaluated") {
      if (subdimension.evidence_strength !== "missing") {
        options.issues.push(
          issue({
            code: "enum_value_invalid",
            source: options.source,
            field: `${fieldPrefix}.evidence_strength`,
            expected: "missing when status=not_evaluated",
            actual: String(subdimension.evidence_strength),
            message: "A not_evaluated AOR operator UI/UX subdimension must declare missing evidence strength.",
          }),
        );
      }
      if (findings.length === 0) {
        options.issues.push(
          issue({
            code: "required_field_missing",
            source: options.source,
            field: `${fieldPrefix}.findings`,
            expected: "finding explaining not_evaluated",
            actual: "empty array",
            message: "A not_evaluated AOR operator UI/UX subdimension must include a finding explaining the gap.",
          }),
        );
      }
    } else if (evidenceRefs.length === 0) {
      options.issues.push(
        issue({
          code: "required_field_missing",
          source: options.source,
          field: `${fieldPrefix}.evidence_refs`,
          expected: "non-empty string array",
          actual: "empty array",
          message: `AOR operator UI/UX subdimension '${subdimensionKey}' must cite evidence unless it is not_evaluated.`,
        }),
      );
    }
    if (subdimension.evidence_strength === "missing" && subdimension.status !== "not_evaluated") {
      options.issues.push(
        issue({
          code: "enum_value_invalid",
          source: options.source,
          field: `${fieldPrefix}.status`,
          expected: "not_evaluated when evidence_strength=missing",
          actual: String(subdimension.status),
          message: "Missing evidence strength cannot be reported as an evaluated AOR operator UI/UX subdimension.",
        }),
      );
    }
  }
}

/**
 * @param {{ values: unknown, expectedValues: string[], source: string, field: string, issues: import("./index.d.ts").ContractValidationIssue[] }} options
 */
function validateQualityGapDimensionSet(options) {
  const values = Array.isArray(options.values) ? options.values.filter((value) => typeof value === "string") : [];
  const actualSet = new Set(values);
  const expectedSet = new Set(options.expectedValues);
  values.forEach((value, index) => {
    if (!LIVE_E2E_QUALITY_DIMENSION_KEYS.includes(value)) {
      options.issues.push(
        issue({
          code: "enum_value_invalid",
          source: options.source,
          field: `${options.field}[${index}]`,
          expected: LIVE_E2E_QUALITY_DIMENSION_KEYS.join("|"),
          actual: value,
          message: `Gap report field '${options.field}' contains unknown dimension '${value}'.`,
        }),
      );
      return;
    }
    if (!expectedSet.has(value)) {
      options.issues.push(
        issue({
          code: "enum_value_invalid",
          source: options.source,
          field: `${options.field}[${index}]`,
          expected: options.expectedValues.length > 0 ? options.expectedValues.join("|") : "empty array",
          actual: value,
          message: `Gap report field '${options.field}' contains dimension '${value}' that does not match its dimension status or evidence strength.`,
        }),
      );
    }
  });
  for (const expectedValue of options.expectedValues) {
    if (!actualSet.has(expectedValue)) {
      options.issues.push(
        issue({
          code: "required_field_missing",
          source: options.source,
          field: options.field,
          expected: `include ${expectedValue}`,
          actual: values.length > 0 ? values.join(",") : "empty array",
          message: `Gap report field '${options.field}' must include dimension '${expectedValue}'.`,
        }),
      );
    }
  }
}

/**
 * @param {unknown} findings
 * @param {string} source
 * @param {string} fieldPrefix
 * @param {import("./index.d.ts").ContractValidationIssue[]} issues
 */
function validateAssessmentFindings(findings, source, fieldPrefix, issues) {
  if (!Array.isArray(findings)) return;
  findings.forEach((entry, index) => {
    const record = isPlainObject(entry) ? entry : {};
    validateEnumString(
      record.category,
      source,
      `${fieldPrefix}[${index}].category`,
      LIVE_E2E_QUALITY_FINDING_CATEGORY_VALUES,
      issues,
    );
    for (const field of ["severity", "summary"]) {
      const value = record[field];
      if (typeof value !== "string" || value.length === 0) {
        issues.push(
          issue({
            code: value === undefined ? "required_field_missing" : "field_type_mismatch",
            source,
            field: `${fieldPrefix}[${index}].${field}`,
            expected: "non-empty string",
            actual: value === undefined ? "missing" : describeActualType(value),
            message: `Assessment finding field '${fieldPrefix}[${index}].${field}' is required.`,
          }),
        );
      }
    }
    validateStringArrayItems({
      values: record.evidence_refs,
      source,
      field: `${fieldPrefix}[${index}].evidence_refs`,
      issues,
    });
  });
}

/**
 * @param {{ entries: unknown, source: string, issues: import("./index.d.ts").ContractValidationIssue[] }} options
 */
function validateObservationFrontendInteractions(options) {
  if (!Array.isArray(options.entries)) return;
  options.entries.forEach((entry, index) => {
    const record = isPlainObject(entry) ? entry : {};
    for (const [field, expectedType] of [
      ["step_id", "string"],
      ["surface", "string"],
      ["evidence_refs", "array"],
      ["html_ref", "string"],
      ["screenshot_refs", "array"],
      ["dom_snapshot_ref", "string"],
      ["accessibility_summary_ref", "string"],
      ["accessibility_checks", "array"],
      ["task_outcome", "object"],
      ["ux_findings", "array"],
      ["status", "string"],
      ["summary", "string"],
    ]) {
      const value = record[field];
      if (!isExpectedType(value, expectedType)) {
        options.issues.push(
          issue({
            code: value === undefined ? "required_field_missing" : "field_type_mismatch",
            source: options.source,
            field: `frontend_interactions[${index}].${field}`,
            expected: value === undefined ? "present" : expectedType,
            actual: value === undefined ? "missing" : describeActualType(value),
            message: `Field 'frontend_interactions[${index}].${field}' is required for UI/UX live E2E evidence.`,
          }),
        );
      }
    }
    validateUnsupportedNestedFields({
      record,
      source: options.source,
      parentField: `frontend_interactions[${index}]`,
      fields: ["agent_verdict_ref"],
      issues: options.issues,
    });
    if (
      record.operator_decision_ref !== undefined &&
      record.operator_decision_ref !== null &&
      typeof record.operator_decision_ref !== "string"
    ) {
      options.issues.push(
        issue({
          code: "field_type_mismatch",
          source: options.source,
          field: `frontend_interactions[${index}].operator_decision_ref`,
          expected: "string",
          actual: describeActualType(record.operator_decision_ref),
          message: `Field 'frontend_interactions[${index}].operator_decision_ref' must be a string when present.`,
        }),
      );
    }
    validateStringArrayItems({
      values: record.evidence_refs,
      source: options.source,
      field: `frontend_interactions[${index}].evidence_refs`,
      issues: options.issues,
    });
    validateStringArrayItems({
      values: record.screenshot_refs,
      source: options.source,
      field: `frontend_interactions[${index}].screenshot_refs`,
      issues: options.issues,
    });
    validateStringArrayItems({
      values: record.ux_findings,
      source: options.source,
      field: `frontend_interactions[${index}].ux_findings`,
      issues: options.issues,
    });
    validateObservationAccessibilityChecks({
      entries: record.accessibility_checks,
      parentField: `frontend_interactions[${index}].accessibility_checks`,
      source: options.source,
      issues: options.issues,
    });
    validateObservationStatusField({
      value: record.status,
      source: options.source,
      field: `frontend_interactions[${index}].status`,
      issues: options.issues,
    });
    const taskOutcome = isPlainObject(record.task_outcome) ? record.task_outcome : {};
    validateObservationStatusField({
      value: taskOutcome.status,
      source: options.source,
      field: `frontend_interactions[${index}].task_outcome.status`,
      issues: options.issues,
    });
  });
}

/**
 * @param {{ entries: unknown, parentField: string, source: string, issues: import("./index.d.ts").ContractValidationIssue[] }} options
 */
function validateObservationAccessibilityChecks(options) {
  if (!Array.isArray(options.entries)) return;
  const checksById = new Map();
  options.entries.forEach((entry, index) => {
    const record = isPlainObject(entry) ? entry : {};
    const fieldPrefix = `${options.parentField}[${index}]`;
    for (const [field, expectedType] of [
      ["check_id", "string"],
      ["status", "string"],
      ["evidence_refs", "array"],
      ["findings", "array"],
    ]) {
      const value = record[field];
      if (!isExpectedType(value, expectedType)) {
        options.issues.push(
          issue({
            code: value === undefined ? "required_field_missing" : "field_type_mismatch",
            source: options.source,
            field: `${fieldPrefix}.${field}`,
            expected: value === undefined ? "present" : expectedType,
            actual: value === undefined ? "missing" : describeActualType(value),
            message: `Field '${fieldPrefix}.${field}' is required for AOR operator accessibility evidence.`,
          }),
        );
      }
    }
    if (typeof record.check_id === "string") {
      checksById.set(record.check_id, record);
      if (!LIVE_E2E_AOR_OPERATOR_ACCESSIBILITY_SUBDIMENSION_KEYS.includes(record.check_id)) {
        options.issues.push(
          issue({
            code: "enum_value_invalid",
            source: options.source,
            field: `${fieldPrefix}.check_id`,
            expected: LIVE_E2E_AOR_OPERATOR_ACCESSIBILITY_SUBDIMENSION_KEYS.join("|"),
            actual: record.check_id,
            message: `AOR operator accessibility check '${record.check_id}' is not supported.`,
          }),
        );
      }
    }
    validateObservationStatusField({
      value: record.status,
      source: options.source,
      field: `${fieldPrefix}.status`,
      issues: options.issues,
    });
    validateStringArrayItems({
      values: record.evidence_refs,
      source: options.source,
      field: `${fieldPrefix}.evidence_refs`,
      issues: options.issues,
    });
    validateStringArrayItems({
      values: record.findings,
      source: options.source,
      field: `${fieldPrefix}.findings`,
      issues: options.issues,
    });
  });
  LIVE_E2E_AOR_OPERATOR_ACCESSIBILITY_SUBDIMENSION_KEYS.forEach((checkId) => {
    if (!checksById.has(checkId)) {
      options.issues.push(
        issue({
          code: "required_field_missing",
          source: options.source,
          field: `${options.parentField}.${checkId}`,
          expected: "present",
          actual: "missing",
          message: `AOR operator accessibility evidence must include '${checkId}'.`,
        }),
      );
    }
  });
}

/**
 * @param {{ value: unknown, source: string, issues: import("./index.d.ts").ContractValidationIssue[] }} options
 */
function validateObservationFlowRange(options) {
  const flowRange = isPlainObject(options.value) ? options.value : {};
  const preludeSteps = flowRange.prelude_steps;
  if (!Array.isArray(preludeSteps)) {
    options.issues.push(
      issue({
        code: preludeSteps === undefined ? "required_field_missing" : "field_type_mismatch",
        source: options.source,
        field: "flow_range.prelude_steps",
        expected: preludeSteps === undefined ? "present" : "array",
        actual: preludeSteps === undefined ? "missing" : describeActualType(preludeSteps),
        message: "Field 'flow_range.prelude_steps' must include the ordered live E2E setup prelude.",
      }),
    );
    return;
  }
  LIVE_E2E_REQUIRED_SETUP_STEPS.forEach((expectedStepId, index) => {
    const actualStepId = preludeSteps[index];
    if (actualStepId !== expectedStepId) {
      options.issues.push(
        issue({
          code: actualStepId === undefined ? "required_field_missing" : "enum_value_invalid",
          source: options.source,
          field: `flow_range.prelude_steps[${index}]`,
          expected: expectedStepId,
          actual: actualStepId === undefined ? "missing" : String(actualStepId),
          message: `Field 'flow_range.prelude_steps[${index}]' must be '${expectedStepId}'.`,
        }),
      );
    }
  });
}

/**
 * @param {{ entries: unknown, source: string, issues: import("./index.d.ts").ContractValidationIssue[] }} options
 */
function validateObservationSetupJournal(options) {
  if (!Array.isArray(options.entries)) return;
  if (options.entries.length === 0) {
    options.issues.push(
      issue({
        code: "required_field_missing",
        source: options.source,
        field: "setup_journal",
        expected: "at least one setup observation",
        actual: "empty array",
        message: "Field 'setup_journal' must include installed-user setup/prelude evidence.",
      }),
    );
    return;
  }
  LIVE_E2E_REQUIRED_SETUP_STEPS.forEach((expectedStepId, index) => {
    const entry = options.entries[index];
    if (entry === undefined) {
      options.issues.push(
        issue({
          code: "required_field_missing",
          source: options.source,
          field: `setup_journal[${index}]`,
          expected: expectedStepId,
          actual: "missing",
          message: `Field 'setup_journal[${index}]' must include required live E2E setup step '${expectedStepId}'.`,
        }),
      );
      return;
    }
    const record = isPlainObject(entry) ? entry : {};
    if (record.step_id !== expectedStepId) {
      options.issues.push(
        issue({
          code: typeof record.step_id === "string" ? "enum_value_invalid" : "field_type_mismatch",
          source: options.source,
          field: `setup_journal[${index}].step_id`,
          expected: expectedStepId,
          actual: record.step_id === undefined ? "missing" : String(record.step_id),
          message: `Field 'setup_journal[${index}].step_id' must be '${expectedStepId}'.`,
        }),
      );
    }
  });
  options.entries.forEach((entry, index) => {
    const record = isPlainObject(entry) ? entry : {};
    for (const [field, expectedType] of [
      ["step_id", "string"],
      ["status", "string"],
      ["evidence_refs", "array"],
      ["summary", "string"],
    ]) {
      const value = record[field];
      if (!isExpectedType(value, expectedType)) {
        options.issues.push(
          issue({
            code: value === undefined ? "required_field_missing" : "field_type_mismatch",
            source: options.source,
            field: `setup_journal[${index}].${field}`,
            expected: value === undefined ? "present" : expectedType,
            actual: value === undefined ? "missing" : describeActualType(value),
            message: `Field 'setup_journal[${index}].${field}' is required for live E2E setup evidence.`,
          }),
        );
      }
    }
    validateStringArrayItems({
      values: record.evidence_refs,
      source: options.source,
      field: `setup_journal[${index}].evidence_refs`,
      issues: options.issues,
    });
    validateObservationStatusField({
      value: record.status,
      source: options.source,
      field: `setup_journal[${index}].status`,
      issues: options.issues,
    });
  });
}

/**
 * @param {{ entries: unknown, operatorContext?: Record<string, unknown>, reportStatus?: string, source: string, issues: import("./index.d.ts").ContractValidationIssue[] }} options
 */
function validateObservationStepJournal(options) {
  if (!Array.isArray(options.entries)) return;
  const operatorKind = typeof options.operatorContext?.operator_kind === "string" ? options.operatorContext.operator_kind : null;
  const decisionPolicy = typeof options.operatorContext?.decision_policy === "string" ? options.operatorContext.decision_policy : null;
  const finalReport = options.reportStatus !== "in_progress";
  options.entries.forEach((entry, index) => {
    const record = isPlainObject(entry) ? entry : {};
    const plan = isPlainObject(record.plan) ? record.plan : null;
    if (typeof record.iteration !== "number" || !Number.isInteger(record.iteration) || record.iteration < 1) {
      options.issues.push(
        issue({
          code: record.iteration === undefined ? "required_field_missing" : "field_type_mismatch",
          source: options.source,
          field: `step_journal[${index}].iteration`,
          expected: record.iteration === undefined ? "present" : "positive integer",
          actual: record.iteration === undefined ? "missing" : describeActualType(record.iteration),
          message: `Field 'step_journal[${index}].iteration' is required for repeated online live E2E step observations.`,
        }),
      );
    }
    for (const field of ["plan_ref", "execution_ref", "inspection_ref", "classification_ref"]) {
      const value = record[field];
      if (typeof value !== "string" || value.length === 0) {
        options.issues.push(
          issue({
            code: value === undefined ? "required_field_missing" : "field_type_mismatch",
            source: options.source,
            field: `step_journal[${index}].${field}`,
            expected: "non-empty string",
            actual: value === undefined ? "missing" : describeActualType(value),
            message: `Field 'step_journal[${index}].${field}' is required for online live E2E step evidence references.`,
          }),
        );
      }
    }
    if (!plan) {
      options.issues.push(
        issue({
          code: record.plan === undefined ? "required_field_missing" : "field_type_mismatch",
          source: options.source,
          field: `step_journal[${index}].plan`,
          expected: record.plan === undefined ? "present" : "object",
          actual: record.plan === undefined ? "missing" : describeActualType(record.plan),
          message: `Field 'step_journal[${index}].plan' is required for online live E2E step-controller reports.`,
        }),
      );
    } else {
      for (const field of [
        "objective",
        "public_surface",
        "command_labels",
        "expected_artifacts",
        "inspection_sources",
        "safety_constraints",
      ]) {
        const value = plan[field];
        const expectedType = field === "objective" || field === "public_surface" ? "string" : "array";
        if (!isExpectedType(value, expectedType)) {
          options.issues.push(
            issue({
              code: value === undefined ? "required_field_missing" : "field_type_mismatch",
              source: options.source,
              field: `step_journal[${index}].plan.${field}`,
              expected: value === undefined ? "present" : expectedType,
              actual: value === undefined ? "missing" : describeActualType(value),
              message: `Field 'step_journal[${index}].plan.${field}' is required for online live E2E step planning.`,
            }),
          );
        }
      }
    }
    validateObservationStatusField({
      value: record.final_step_verdict,
      source: options.source,
      field: `step_journal[${index}].final_step_verdict`,
      issues: options.issues,
    });
    const deterministicAnalysis = isPlainObject(record.deterministic_analysis)
      ? record.deterministic_analysis
      : {};
    validateObservationStatusField({
      value: deterministicAnalysis.status,
      source: options.source,
      field: `step_journal[${index}].deterministic_analysis.status`,
      issues: options.issues,
    });
    const semanticAnalysis = isPlainObject(record.semantic_analysis)
      ? record.semantic_analysis
      : {};
    validateObservationStatusField({
      value: semanticAnalysis.status,
      source: options.source,
      field: `step_journal[${index}].semantic_analysis.status`,
      issues: options.issues,
    });
    for (const field of ["agent_decision_request_ref", "operator_decision_status"]) {
      const value = record[field];
      if (typeof value !== "string" || value.length === 0) {
        options.issues.push(
          issue({
            code: value === undefined ? "required_field_missing" : "field_type_mismatch",
            source: options.source,
            field: `step_journal[${index}].${field}`,
            expected: "non-empty string",
            actual: value === undefined ? "missing" : describeActualType(value),
            message: `Field 'step_journal[${index}].${field}' is required for agent-operated live E2E decisions.`,
          }),
        );
      }
    }
    const decisionStatus = record.operator_decision_status;
    if (
      typeof decisionStatus === "string" &&
      !["accepted", "missing", "rejected"].includes(decisionStatus)
    ) {
      options.issues.push(
        issue({
          code: "enum_value_invalid",
          source: options.source,
          field: `step_journal[${index}].operator_decision_status`,
          expected: "accepted|missing|rejected",
          actual: decisionStatus,
          message: "Field 'operator_decision_status' must describe the operator decision state.",
        }),
      );
    }
    if (decisionStatus === "accepted" && typeof record.operator_decision_ref !== "string") {
      options.issues.push(
        issue({
          code: "required_field_missing",
          source: options.source,
          field: `step_journal[${index}].operator_decision_ref`,
          expected: "string",
          actual: record.operator_decision_ref === undefined ? "missing" : describeActualType(record.operator_decision_ref),
          message: "Accepted live E2E operator decisions must carry 'operator_decision_ref'.",
        }),
      );
    }
    if (decisionStatus === "accepted") {
      const inspectedRefs = Array.isArray(record.inspected_evidence_refs) ? record.inspected_evidence_refs : [];
      if (inspectedRefs.length === 0) {
        options.issues.push(
          issue({
            code: record.inspected_evidence_refs === undefined ? "required_field_missing" : "array_empty",
            source: options.source,
            field: `step_journal[${index}].inspected_evidence_refs`,
            expected: "non-empty string array",
            actual:
              record.inspected_evidence_refs === undefined
                ? "missing"
                : describeActualType(record.inspected_evidence_refs),
            message: "Accepted live E2E operator decisions must list inspected evidence refs.",
          }),
        );
      } else {
        validateStringArrayItems({
          values: record.inspected_evidence_refs,
          source: options.source,
          field: `step_journal[${index}].inspected_evidence_refs`,
          issues: options.issues,
        });
      }
    }
    if (operatorKind === "skill-agent" && decisionPolicy === "required" && finalReport) {
      if (decisionStatus !== "accepted") {
        options.issues.push(
          issue({
            code: "enum_value_invalid",
            source: options.source,
            field: `step_journal[${index}].operator_decision_status`,
            expected: "accepted",
            actual: decisionStatus === undefined ? "missing" : String(decisionStatus),
            message: "Skill-agent live E2E reports require accepted operator decisions for each step.",
          }),
        );
      }
      if (semanticAnalysis.judge_source !== "skill-agent") {
        options.issues.push(
          issue({
            code: "enum_value_invalid",
            source: options.source,
            field: `step_journal[${index}].semantic_analysis.judge_source`,
            expected: "skill-agent",
            actual: semanticAnalysis.judge_source === undefined ? "missing" : String(semanticAnalysis.judge_source),
            message: "Acceptance live E2E semantic analysis must come from the skill-agent operator.",
          }),
        );
      }
    }
  });
}

/**
 * @param {{ value: unknown, source: string, field: string, issues: import("./index.d.ts").ContractValidationIssue[] }} options
 */
function validateObservationStatusField(options) {
  if (typeof options.value !== "string") {
    options.issues.push(
      issue({
        code: options.value === undefined ? "required_field_missing" : "field_type_mismatch",
        source: options.source,
        field: options.field,
        expected: options.value === undefined ? "present" : "string",
        actual: options.value === undefined ? "missing" : describeActualType(options.value),
        message: `Field '${options.field}' must use a supported live E2E observation status.`,
      }),
    );
    return;
  }
  if (!LIVE_E2E_OBSERVATION_STATUS_VALUES.includes(options.value)) {
    options.issues.push(
      issue({
        code: "enum_value_invalid",
        source: options.source,
        field: options.field,
        expected: LIVE_E2E_OBSERVATION_STATUS_VALUES.join("|"),
        actual: options.value,
        message: `Field '${options.field}' has unsupported value '${options.value}'.`,
      }),
    );
  }
}

/**
 * @param {{ filePath: string, family?: import("./index.d.ts").ContractFamily }} options
 * @returns {import("./index.d.ts").LoadedContractFile}
 */
export function loadContractFile({ filePath, family }) {
  const source = path.resolve(filePath);
  const raw = fs.readFileSync(source, "utf8");

  /** @type {unknown} */
  let document;
  try {
    document = parseYaml(raw);
  } catch (error) {
    const parseMessage = error instanceof Error ? error.message : String(error);
    const parseValidation = {
      ok: false,
      family: family ?? null,
      source,
      issues: [
        issue({
          code: "yaml_parse_error",
          source,
          expected: "valid YAML",
          actual: "parse error",
          message: parseMessage,
        }),
      ],
    };

    return {
      ok: false,
      family: family ?? null,
      source,
      document: null,
      validation: parseValidation,
    };
  }

  const resolvedFamily = family ?? inferFamilyFromExamplePath(source);
  if (!resolvedFamily) {
    const unresolvedValidation = {
      ok: false,
      family: null,
      source,
      issues: [
        issue({
          code: "unknown_contract_family",
          source,
          expected: "supported example path",
          actual: "unmapped file path",
          message: "Could not infer contract family from file path. Provide the family explicitly.",
        }),
      ],
    };

    return {
      ok: false,
      family: null,
      source,
      document,
      validation: unresolvedValidation,
    };
  }

  const validation = validateContractDocument({ family: resolvedFamily, document, source });
  return {
    ok: validation.ok,
    family: resolvedFamily,
    source,
    document,
    validation,
  };
}
