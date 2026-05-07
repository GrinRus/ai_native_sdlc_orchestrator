import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

import { CONTRACT_FAMILY_INDEX, INTAKE_SOURCE_KIND_VALUES, LIVE_E2E_OBSERVATION_STATUS_VALUES } from "./families.mjs";
import { inferFamilyFromExamplePath } from "./example-paths.mjs";
import { cloneJson, describeActualType, isExpectedType, isPlainObject, issue } from "./utils.mjs";

const DELIVERY_MODE_VALUES = ["no-write", "patch-only", "local-branch", "fork-first-pr"];
const INTERACTION_STATUS_VALUES = ["requested", "answered", "resumed", "blocked"];
const LIVE_E2E_SCENARIO_VALUES = ["regress", "release", "repair", "governance"];
const LIVE_E2E_PROVIDER_VARIANT_VALUES = ["openai-primary", "anthropic-primary", "open-code-primary"];
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

  const missionSemantics = validateOptionalObjectField({
    record: document,
    source,
    field: "mission_semantics",
    issues,
  });
  if (missionSemantics) {
    for (const field of [
      "changed_paths",
      "allowed_paths",
      "forbidden_paths",
      "mission_scoped_changed_paths",
      "scope_violation_paths",
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
  for (const field of ["changed_paths", "allowed_paths", "forbidden_paths"]) {
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
  const codeQuality = isPlainObject(document.code_quality_after_delivery)
    ? document.code_quality_after_delivery
    : {};
  validateObservationStatusField({
    value: codeQuality.status,
    source,
    field: "code_quality_after_delivery.status",
    issues,
  });
  validateObservationMatrixStatuses({
    entries: document.step_matrix,
    source,
    field: "step_matrix",
    issues,
  });
  validateObservationMatrixStatuses({
    entries: document.artifact_quality_matrix,
    source,
    field: "artifact_quality_matrix",
    issues,
  });
  return issues;
}

/**
 * @param {{ entries: unknown, source: string, field: string, issues: import("./index.d.ts").ContractValidationIssue[] }} options
 */
function validateObservationMatrixStatuses(options) {
  if (!Array.isArray(options.entries)) return;
  options.entries.forEach((entry, index) => {
    const record = isPlainObject(entry) ? entry : {};
    validateObservationStatusField({
      value: record.status,
      source: options.source,
      field: `${options.field}[${index}].status`,
      issues: options.issues,
    });
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
        message: `Field '${options.field}' must use live E2E observation status pass|warn|not_pass.`,
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
