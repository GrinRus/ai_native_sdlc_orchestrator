import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { CONTRACT_FAMILY_INDEX, INTAKE_SOURCE_KIND_VALUES } from "./families.mjs";
import { validateCanonicalContractValues } from "./canonical-values.mjs";
import { inferFamilyFromExamplePath } from "./example-paths.mjs";
import { cloneJson, describeActualType, isExpectedType, isPlainObject, issue } from "./utils.mjs";
import { validateStructuredTaskPlan } from "./structured-task-plan.mjs";
import { normalizeProjectTopology, validateProjectBinding, validateProjectTopology, validateWorkspaceSet } from "./project-topology.mjs";
import { validateExecutionPlanV2 } from "./execution-plan-validation.mjs";
const DELIVERY_MODE_VALUES = ["no-write", "patch-only", "local-branch", "fork-first-pr"];
const INTERACTION_STATUS_VALUES = ["requested", "answered", "resumed", "resume_failed", "blocked"];
const INTERACTION_TYPE_VALUES = ["permission_request", "clarification_question", "auth_required"];
const LEARNING_LOOP_SCENARIO_VALUES = ["regress", "release", "repair", "governance"];
const LEARNING_LOOP_PROVIDER_VARIANT_VALUES = ["openai-primary", "anthropic-primary", "open-code-primary", "qwen-primary"];
const COMPILED_CONTEXT_BUDGET_STATUS_VALUES = ["pass", "warn", "fail", "not_configured"];
const EXTERNAL_REQUEST_TRANSPORT_VALUES = ["request-artifact", "stdin-json", "file-attachment", "argv-json", "none"];
const STDIN_JSON_SCOPE_VALUES = ["test-only", "small-only"];
const VALIDATION_STATUS_VALUES = ["pass", "warn", "fail", "blocked"];
const REVIEW_STATUS_VALUES = ["pass", "warn", "fail"];
const QUALITY_REPAIR_SOURCE_STAGE_VALUES = ["review", "qa"];
const QUALITY_REPAIR_STATUS_VALUES = [
  "requested",
  "in-progress",
  "review-required",
  "qa-required",
  "budget-exhausted",
  "closed",
];
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
const VERIFICATION_COMMAND_GROUP_ROLE_VALUES = ["setup", "build", "lint", "test", "typecheck", "e2e", "full-suite", "custom"];
const VERIFICATION_COMMAND_GROUP_PHASE_VALUES = ["readiness", "baseline", "post-change", "diagnostic"];
const VERIFICATION_COMMAND_GROUP_ENFORCEMENT_VALUES = ["required", "warn", "observe"];
const VERIFICATION_COMMAND_GROUP_TIMEOUT_CLASS_VALUES = [
  "install",
  "build",
  "focused-test",
  "full-suite",
  "browser-e2e",
  "quick",
];
const VERIFICATION_COMMAND_GROUP_OUTCOME_VALUES = ["no-tests", "missing-tool", "not-applicable", "broken-baseline"];
const ARTIFACT_READINESS_STATUS_VALUES = [
  "pending",
  "complete",
  "adr-ready",
  "ready",
  "incomplete",
  "blocked",
  "stale",
];
const ARTIFACT_READINESS_STAGE_KEYS = ["mission", "discovery", "research", "spec", "planning"];
const EXECUTION_PLAN_STATUS_VALUES = ["ready", "blocked", "superseded", "complete"];
const TASK_PROGRESS_OVERALL_STATUS_VALUES = ["planned", "in-progress", "blocked", "failed", "stale", "complete"];
const TASK_PROGRESS_STATUS_VALUES = [
  "planned",
  "ready",
  "blocked",
  "in-progress",
  "verification-pending",
  "failed",
  "stale",
  "complete",
];
const privateCommandGroupField = (...parts) => parts.join("_");
const PRIVATE_PROOF_HARNESS_COMMAND_GROUP_FIELDS = [
  privateCommandGroupField("live", "e2e", "profile"),
  privateCommandGroupField("live", "e2e", "profile", "ref"),
  privateCommandGroupField("target", "matrix", "cell"),
  privateCommandGroupField("target", "readiness"),
  privateCommandGroupField("run", "health"),
  privateCommandGroupField("step", "quality"),
  privateCommandGroupField("diagnostic", "health"),
];
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
  issues.push(...validateCanonicalContractValues(document, source));

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

  if (family === "adapter-capability-profile") {
    issues.push(...validateAdapterCapabilityProfile(document, source));
  }

  if (family === "project-profile") issues.push(...validateProjectProfile(document, source));
  if (family === "project-binding") issues.push(...validateProjectBinding(document, source));
  if (family === "workspace-set") issues.push(...validateWorkspaceSet(document, source));

  if (family === "next-action-report") {
    issues.push(...validateNextActionReport(document, source));
  }

  if (family === "wave-ticket") {
    issues.push(...validateWaveTicket(document, source));
  }

  if (family === "handoff-packet") {
    issues.push(...validateHandoffPacket(document, source));
  }

  if (family === "execution-plan") {
    issues.push(...validateExecutionPlan(document, source));
  }

  if (family === "task-progress-report") {
    issues.push(...validateTaskProgressReport(document, source));
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

  if (family === "evaluation-case-expected") {
    issues.push(...validateEvaluationCaseExpected(document, source));
  }

  if (family === "review-report") {
    issues.push(...validateReviewReport(document, source));
  }

  if (family === "review-decision") {
    issues.push(...validateReviewDecision(document, source));
  }

  if (family === "quality-repair-request") {
    issues.push(...validateQualityRepairRequest(document, source));
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
function validateEvaluationCaseExpected(document, source) {
  const issues = [];
  const assertions = Array.isArray(document.assertions) ? document.assertions : [];
  if (assertions.length === 0 || assertions.length > 100) {
    issues.push(issue({
      code: "field_type_mismatch",
      source,
      field: "assertions",
      expected: "array with 1..100 entries",
      actual: String(assertions.length),
      message: "Evaluation expected assertions must contain between 1 and 100 entries.",
    }));
  }
  const ids = new Set();
  assertions.forEach((raw, index) => {
    if (!isPlainObject(raw)) {
      issues.push(issue({ code: "field_type_mismatch", source, field: `assertions.${index}`, expected: "object", actual: describeActualType(raw), message: "Evaluation assertion must be an object." }));
      return;
    }
    const assertionId = raw.assertion_id;
    if (typeof assertionId !== "string" || !assertionId || ids.has(assertionId)) {
      issues.push(issue({ code: "identifier_format_invalid", source, field: `assertions.${index}.assertion_id`, expected: "unique non-empty string", actual: String(assertionId), message: "Evaluation assertion_id must be unique and non-empty." }));
    } else {
      ids.add(assertionId);
    }
    if (raw.target !== "subject" && raw.target !== "input") {
      issues.push(issue({ code: "enum_value_invalid", source, field: `assertions.${index}.target`, expected: "subject|input", actual: String(raw.target), message: "Evaluation assertion target must be subject or input." }));
    }
    const operator = raw.operator;
    if (!["equals", "contains", "exists", "absent"].includes(String(operator))) {
      issues.push(issue({ code: "enum_value_invalid", source, field: `assertions.${index}.operator`, expected: "equals|contains|exists|absent", actual: String(operator), message: "Evaluation assertion operator is unsupported." }));
    }
    const pointer = raw.path;
    const depth = typeof pointer === "string" && pointer !== "" ? pointer.split("/").length - 1 : 0;
    if (typeof pointer !== "string" || (pointer !== "" && !pointer.startsWith("/")) || depth > 64) {
      issues.push(issue({ code: "field_type_mismatch", source, field: `assertions.${index}.path`, expected: "RFC 6901 JSON Pointer with depth <= 64", actual: String(pointer), message: "Evaluation assertion path must be a bounded RFC 6901 JSON Pointer." }));
    }
    if ((operator === "equals" || operator === "contains") && !("value" in raw)) {
      issues.push(issue({ code: "required_field_missing", source, field: `assertions.${index}.value`, expected: "present", actual: "missing", message: `Evaluation assertion '${String(operator)}' requires value.` }));
    }
  });
  return issues;
}

/**
 * @param {Record<string, unknown>} document
 * @param {string} source
 * @returns {import("./index.d.ts").ContractValidationIssue[]}
 */
function validateProjectProfile(document, source) {
  /** @type {import("./index.d.ts").ContractValidationIssue[]} */
  const issues = [];
  validateProjectTopology(normalizeProjectTopology(document), source, issues);
  const verification = validateOptionalObjectField({
    record: document,
    source,
    field: "verification",
    issues,
  });
  if (verification) {
    validateVerificationCommandGroups(verification, source, "verification.command_groups", issues, false);
  }
  const readinessPolicy = validateOptionalObjectField({
    record: document,
    source,
    field: "artifact_readiness_policy",
    issues,
  });
  if (readinessPolicy) {
    const researchPolicy = validateOptionalObjectField({
      record: readinessPolicy,
      source,
      field: "artifact_readiness_policy.research",
      issues,
    });
    if (researchPolicy) {
      validateNestedBooleanField({
        record: researchPolicy,
        source,
        field: "artifact_readiness_policy.research.allow_incomplete_for_spec",
        issues,
        required: false,
      });
      validateNestedStringField({
        record: researchPolicy,
        source,
        field: "artifact_readiness_policy.research.reason",
        issues,
        required: false,
      });
    }
  }
  const repairPolicy = validateOptionalObjectField({
    record: document,
    source,
    field: "quality_repair_policy",
    issues,
  });
  if (repairPolicy) {
    validateNestedStringField({
      record: repairPolicy,
      source,
      field: "quality_repair_policy.policy_ref",
      issues,
      required: false,
    });
    validateNestedNumberField({
      record: repairPolicy,
      source,
      field: "quality_repair_policy.max_attempts_per_cycle",
      issues,
      required: false,
    });
    for (const field of [
      "requires_review_after_repair",
      "requires_qa_after_passing_review",
      "budget_exhausted_requires_operator_approval",
      "blocks_delivery_while_open",
    ]) {
      validateNestedBooleanField({
        record: repairPolicy,
        source,
        field: `quality_repair_policy.${field}`,
        issues,
        required: false,
      });
    }
    validateOptionalStringArrayField({
      record: repairPolicy,
      source,
      field: "quality_repair_policy.qa_in_scope_stages",
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
function validateNextActionReport(document, source) {
  /** @type {import("./index.d.ts").ContractValidationIssue[]} */
  const issues = [];
  validateQualityRepairLineage({
    record: document,
    source,
    field: "quality_repair_lineage",
    issues,
  });
  const readiness = validateOptionalObjectField({
    record: document,
    source,
    field: "artifact_readiness",
    issues,
  });
  if (!readiness) return issues;

  const policy = validateOptionalObjectField({
    record: readiness,
    source,
    field: "artifact_readiness.policy",
    issues,
  });
  if (policy) {
    validateNestedEnumStringField({
      record: policy,
      source,
      field: "artifact_readiness.policy.mode",
      allowedValues: ["strict", "soft"],
      issues,
      required: true,
    });
    validateNestedBooleanField({
      record: policy,
      source,
      field: "artifact_readiness.policy.allow_incomplete_research_for_spec",
      issues,
      required: true,
    });
    validateNestedNullableStringField({
      record: policy,
      source,
      field: "artifact_readiness.policy.reason",
      issues,
      required: true,
    });
  }

  const stages = validateOptionalObjectField({
    record: readiness,
    source,
    field: "artifact_readiness.stages",
    issues,
  });
  if (!stages) return issues;

  for (const stageKey of ARTIFACT_READINESS_STAGE_KEYS) {
    const stage = validateOptionalObjectField({
      record: stages,
      source,
      field: `artifact_readiness.stages.${stageKey}`,
      issues,
    });
    if (!stage) continue;
    validateNestedEnumStringField({
      record: stage,
      source,
      field: `artifact_readiness.stages.${stageKey}.status`,
      allowedValues: ARTIFACT_READINESS_STATUS_VALUES,
      issues,
      required: true,
    });
    validateNestedNullableStringField({
      record: stage,
      source,
      field: `artifact_readiness.stages.${stageKey}.evidence_ref`,
      issues,
      required: true,
    });
    validateNestedStringField({
      record: stage,
      source,
      field: `artifact_readiness.stages.${stageKey}.reason`,
      issues,
      required: true,
    });
    validateOptionalStringArrayField({
      record: stage,
      source,
      field: `artifact_readiness.stages.${stageKey}.blocked_reasons`,
      issues,
    });
    validateOptionalStringArrayField({
      record: stage,
      source,
      field: `artifact_readiness.stages.${stageKey}.stale_reasons`,
      issues,
    });
    validateOptionalStringArrayField({
      record: stage,
      source,
      field: `artifact_readiness.stages.${stageKey}.required_evidence_refs`,
      issues,
    });
    validateOptionalObjectField({
      record: stage,
      source,
      field: `artifact_readiness.stages.${stageKey}.soft_decision`,
      issues,
      allowNull: true,
    });
  }
  return issues;
}

/**
 * @param {Record<string, unknown>} document
 * @param {string} source
 * @returns {import("./index.d.ts").ContractValidationIssue[]}
 */
function validateWaveTicket(document, source) {
  /** @type {import("./index.d.ts").ContractValidationIssue[]} */
  const issues = [];
  const verificationPlan = validateOptionalObjectField({
    record: document,
    source,
    field: "verification_plan",
    issues,
  });
  if (verificationPlan) {
    validateVerificationCommandGroups(verificationPlan, source, "verification_plan.command_groups", issues, false);
  }
  issues.push(...validateStructuredTaskPlan(document, source));
  return issues;
}

/**
 * @param {Record<string, unknown>} document
 * @param {string} source
 * @returns {import("./index.d.ts").ContractValidationIssue[]}
 */
function validateHandoffPacket(document, source) {
  /** @type {import("./index.d.ts").ContractValidationIssue[]} */
  const issues = [];
  const verificationPlan = validateOptionalObjectField({
    record: document,
    source,
    field: "verification_plan",
    issues,
  });
  if (verificationPlan) {
    validateVerificationCommandGroups(verificationPlan, source, "verification_plan.command_groups", issues, false);
  }
  issues.push(...validateStructuredTaskPlan(document, source));
  return issues;
}

function validateExecutionPlan(document, source) {
  const issues = [];
  if (!EXECUTION_PLAN_STATUS_VALUES.includes(document.status)) return issues;
  const units = Array.isArray(document.execution_units) ? document.execution_units : [];
  const unitIds = new Set();
  units.forEach((unit, index) => {
    const field = `execution_units[${index}]`;
    if (!isPlainObject(unit)) return;
    validateNestedStringField({ record: unit, source, field: `${field}.unit_id`, issues, required: true });
    validateNestedArrayField({ record: unit, source, field: `${field}.task_refs`, issues, required: true });
    validateNestedArrayField({ record: unit, source, field: `${field}.depends_on`, issues, required: true });
    if (!isPlainObject(unit.scope)) {
      issues.push(issue({ code: "field_type_mismatch", source, field: `${field}.scope`, expected: "object", actual: describeActualType(unit.scope), message: `Field '${field}.scope' must be an object.` }));
    }
    validateNestedArrayField({ record: unit, source, field: `${field}.required_evidence`, issues, required: true });
    validateNestedArrayField({ record: unit, source, field: `${field}.integration_requirements`, issues, required: true });
    if (typeof unit.parallel_candidate !== "boolean") {
      issues.push(issue({ code: "field_type_mismatch", source, field: `${field}.parallel_candidate`, expected: "boolean", actual: describeActualType(unit.parallel_candidate), message: `Field '${field}.parallel_candidate' must be boolean.` }));
    }
    if (typeof unit.unit_id === "string") {
      if (unitIds.has(unit.unit_id)) {
        issues.push(issue({ code: "enum_value_invalid", source, field: `${field}.unit_id`, expected: "unique unit id", actual: unit.unit_id, message: `Duplicate execution unit id '${unit.unit_id}'.` }));
      }
      unitIds.add(unit.unit_id);
    }
  });
  for (const [index, unit] of units.entries()) {
    if (!isPlainObject(unit)) continue;
    for (const dependency of Array.isArray(unit.depends_on) ? unit.depends_on : []) {
      if (typeof dependency === "string" && !unitIds.has(dependency)) {
        issues.push(issue({ code: "enum_value_invalid", source, field: `execution_units[${index}].depends_on`, expected: "known unit id", actual: dependency, message: `Execution unit depends on unknown unit '${dependency}'.` }));
      }
    }
  }
  issues.push(...validateExecutionPlanV2(document, source));
  return issues;
}

function validateTaskProgressReport(document, source) {
  const issues = [];
  if (!TASK_PROGRESS_OVERALL_STATUS_VALUES.includes(document.overall_status)) return issues;
  const tasks = Array.isArray(document.tasks) ? document.tasks : [];
  const taskIds = new Set();
  tasks.forEach((task, index) => {
    const field = `tasks[${index}]`;
    if (!isPlainObject(task)) return;
    validateNestedStringField({ record: task, source, field: `${field}.task_id`, issues, required: true });
    validateNestedStringField({ record: task, source, field: `${field}.task_digest`, issues, required: true });
    validateNestedEnumStringField({ record: task, source, field: `${field}.status`, allowedValues: TASK_PROGRESS_STATUS_VALUES, issues, required: true });
    for (const arrayField of ["execution_unit_refs", "attempt_refs", "evidence_refs", "blocking_findings"]) {
      validateNestedArrayField({ record: task, source, field: `${field}.${arrayField}`, issues, required: true });
    }
    if (typeof task.task_id === "string") {
      if (taskIds.has(task.task_id)) {
        issues.push(issue({ code: "enum_value_invalid", source, field: `${field}.task_id`, expected: "unique task id", actual: task.task_id, message: `Duplicate task progress id '${task.task_id}'.` }));
      }
      taskIds.add(task.task_id);
    }
  });
  return issues;
}

/**
 * @param {Record<string, unknown>} record
 * @param {string} source
 * @param {string} field
 * @param {import("./index.d.ts").ContractValidationIssue[]} issues
 * @param {boolean} required
 */
function validateVerificationCommandGroups(record, source, field, issues, required) {
  const commandGroups = validateOptionalArrayField({
    record,
    source,
    field,
  });
  if (!commandGroups) {
    if (required) {
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
    }
    return;
  }

  commandGroups.forEach((entry, index) => {
    const entryField = `${field}[${index}]`;
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

    validateNestedStringField({ record: entry, source, field: `${entryField}.id`, issues, required: true });
    validateUnsupportedNestedFields({
      record: entry,
      source,
      parentField: entryField,
      fields: PRIVATE_PROOF_HARNESS_COMMAND_GROUP_FIELDS,
      issues,
    });
    validateNestedEnumStringField({
      record: entry,
      source,
      field: `${entryField}.role`,
      allowedValues: VERIFICATION_COMMAND_GROUP_ROLE_VALUES,
      issues,
      required: true,
    });
    validateNestedEnumStringField({
      record: entry,
      source,
      field: `${entryField}.phase`,
      allowedValues: VERIFICATION_COMMAND_GROUP_PHASE_VALUES,
      issues,
      required: true,
    });
    validateNestedEnumStringField({
      record: entry,
      source,
      field: `${entryField}.enforcement`,
      allowedValues: VERIFICATION_COMMAND_GROUP_ENFORCEMENT_VALUES,
      issues,
      required: true,
    });
    validateNestedEnumStringField({
      record: entry,
      source,
      field: `${entryField}.timeout_class`,
      allowedValues: VERIFICATION_COMMAND_GROUP_TIMEOUT_CLASS_VALUES,
      issues,
      required: true,
    });
    validateNestedArrayField({
      record: entry,
      source,
      field: `${entryField}.commands`,
      issues,
      required: true,
    });
    validateStringArrayItems({
      values: entry.commands,
      source,
      field: `${entryField}.commands`,
      issues,
    });
    if (Array.isArray(entry.commands) && entry.commands.length === 0) {
      issues.push(
        issue({
          code: "required_field_missing",
          source,
          field: `${entryField}.commands`,
          expected: "non-empty array",
          actual: "empty",
          message: `Field '${entryField}.commands' must contain at least one command.`,
        }),
      );
    }

    for (const optionalStringField of ["repo_id", "working_dir", "package_manager"]) {
      validateNestedStringField({
        record: entry,
        source,
        field: `${entryField}.${optionalStringField}`,
        issues,
        required: false,
      });
    }
    for (const optionalStringArrayField of ["depends_on", "detected_from"]) {
      validateOptionalStringArrayField({
        record: entry,
        source,
        field: `${entryField}.${optionalStringArrayField}`,
        issues,
      });
    }
    const toolRequirements = validateOptionalArrayField({
      record: entry,
      source,
      field: `${entryField}.tool_requirements`,
      issues,
    });
    if (toolRequirements) {
      toolRequirements.forEach((toolRequirement, toolIndex) => {
        const toolField = `${entryField}.tool_requirements[${toolIndex}]`;
        if (!isPlainObject(toolRequirement)) {
          issues.push(
            issue({
              code: "field_type_mismatch",
              source,
              field: toolField,
              expected: "object",
              actual: describeActualType(toolRequirement),
              message: `Field '${toolField}' must be 'object'.`,
            }),
          );
          return;
        }
        validateNestedStringField({
          record: toolRequirement,
          source,
          field: `${toolField}.tool`,
          issues,
          required: true,
        });
        for (const optionalToolStringField of ["version_range", "install_hint"]) {
          validateNestedStringField({
            record: toolRequirement,
            source,
            field: `${toolField}.${optionalToolStringField}`,
            issues,
            required: false,
          });
        }
      });
    }
    const skipPolicy = validateOptionalObjectField({
      record: entry,
      source,
      field: `${entryField}.skip_policy`,
      issues,
    });
    if (skipPolicy) {
      validateNestedEnumStringField({
        record: skipPolicy,
        source,
        field: `${entryField}.skip_policy.outcome`,
        allowedValues: VERIFICATION_COMMAND_GROUP_OUTCOME_VALUES,
        issues,
        required: false,
      });
      for (const optionalSkipStringField of ["applies_when", "reason"]) {
        validateNestedStringField({
          record: skipPolicy,
          source,
          field: `${entryField}.skip_policy.${optionalSkipStringField}`,
          issues,
          required: false,
        });
      }
    }
  });
}

/**
 * @param {Record<string, unknown>} document
 * @param {string} source
 * @returns {import("./index.d.ts").ContractValidationIssue[]}
 */
function validateRuntimeHarnessReport(document, source) {
  /** @type {import("./index.d.ts").ContractValidationIssue[]} */
  const issues = [];
  validateQualityRepairLineage({
    record: document,
    source,
    field: "quality_repair_lineage",
    issues,
  });

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
  validateNestedStringField({ record: document, source, field: "default_model", issues, required: false });
  validateOptionalStringArrayField({ record: document, source, field: "supported_models", issues });
  if (document.model_aliases !== undefined) {
    if (!isPlainObject(document.model_aliases)) {
      issues.push(issue({ code: "field_type_mismatch", source, field: "model_aliases", expected: "object", actual: describeActualType(document.model_aliases), message: "model_aliases must be an object." }));
    } else {
      for (const [alias, model] of Object.entries(document.model_aliases)) {
        if (typeof model !== "string" || model.length === 0) {
          issues.push(issue({ code: "field_type_mismatch", source, field: `model_aliases.${alias}`, expected: "string", actual: describeActualType(model), message: `model_aliases.${alias} must name a concrete model.` }));
        }
      }
    }
  }
  const execution = isPlainObject(document.execution) ? document.execution : null;
  if (!execution) return issues;
  const externalRuntime = validateOptionalObjectField({
    record: execution,
    source,
    field: "execution.external_runtime",
    issues,
  });
  if (!externalRuntime) return issues;

  validateOptionalStringArrayField({
    record: externalRuntime,
    source,
    field: "execution.external_runtime.default_args",
    issues,
  });
  const modelArgument = validateOptionalObjectField({ record: externalRuntime, source, field: "execution.external_runtime.model_argument", issues });
  if (modelArgument) {
    validateNestedStringField({ record: modelArgument, source, field: "execution.external_runtime.model_argument.flag", issues, required: true });
    validateNestedArrayField({ record: modelArgument, source, field: "execution.external_runtime.model_argument.prefix_args", issues, required: false });
  }

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
  if (Array.isArray(document.effective_assets)) {
    document.effective_assets.forEach((value, index) => {
      const field = `effective_assets[${index}]`;
      if (!isPlainObject(value)) {
        issues.push(issue({ code: "field_type_mismatch", source, field, expected: "object", actual: describeActualType(value), message: `${field} must be an object.` }));
        return;
      }
      for (const name of ["canonical_id", "reference", "family", "digest", "source_root", "source", "provenance", "delivery_mode", "content"]) {
        validateNestedStringField({ record: value, source, field: `${field}.${name}`, issues, required: true });
      }
      validateNestedNumberField({ record: value, source, field: `${field}.order`, issues, required: true });
      validateNestedArrayField({ record: value, source, field: `${field}.deduplicated_provenance`, issues, required: true });
      if (typeof value.digest === "string" && !/^sha256:[a-f0-9]{64}$/u.test(value.digest)) {
        issues.push(issue({ code: "enum_value_invalid", source, field: `${field}.digest`, expected: "sha256:<64 lowercase hex>", actual: value.digest, message: `${field}.digest must be a canonical SHA-256 digest.` }));
      }
      if (value.order !== index) {
        issues.push(issue({ code: "enum_value_invalid", source, field: `${field}.order`, expected: String(index), actual: String(value.order), message: `${field}.order must match effective asset order.` }));
      }
      if (value.delivery_mode !== "inline" && value.delivery_mode !== "attachment") {
        issues.push(issue({ code: "enum_value_invalid", source, field: `${field}.delivery_mode`, expected: "inline|attachment", actual: String(value.delivery_mode), message: `${field}.delivery_mode is unsupported.` }));
      }
    });
  }
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
  validateQualityRepairLineage({
    record: document,
    source,
    field: "quality_repair_lineage",
    issues,
  });
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

  validateNestedStringField({
    record: document,
    source,
    field: "command_group_id",
    issues,
    required: false,
  });
  validateNestedEnumStringField({
    record: document,
    source,
    field: "command_group_role",
    allowedValues: VERIFICATION_COMMAND_GROUP_ROLE_VALUES,
    issues,
    required: false,
  });
  validateNestedEnumStringField({
    record: document,
    source,
    field: "command_group_phase",
    allowedValues: VERIFICATION_COMMAND_GROUP_PHASE_VALUES,
    issues,
    required: false,
  });
  validateNestedEnumStringField({
    record: document,
    source,
    field: "command_group_enforcement",
    allowedValues: VERIFICATION_COMMAND_GROUP_ENFORCEMENT_VALUES,
    issues,
    required: false,
  });
  validateNestedEnumStringField({
    record: document,
    source,
    field: "command_group_timeout_class",
    allowedValues: VERIFICATION_COMMAND_GROUP_TIMEOUT_CLASS_VALUES,
    issues,
    required: false,
  });
  validateNestedEnumStringField({
    record: document,
    source,
    field: "enforcement_result",
    allowedValues: ["pass", "fail", "warn", "observe"],
    issues,
    required: false,
  });
  validateNestedEnumStringField({
    record: document,
    source,
    field: "command_group_outcome",
    allowedValues: VERIFICATION_COMMAND_GROUP_OUTCOME_VALUES,
    issues,
    required: false,
  });
  validateNestedEnumStringField({
    record: document,
    source,
    field: "baseline_failure_status",
    allowedValues: ["pre_existing"],
    issues,
    required: false,
  });
  validateOptionalStringArrayField({
    record: document,
    source,
    field: "baseline_failure_evidence_refs",
    issues,
  });

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
  validateQualityRepairLineage({
    record: document,
    source,
    field: "quality_repair_lineage",
    issues,
  });

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
 * @param {{ repairContext: Record<string, unknown>, source: string, issues: import("./index.d.ts").ContractValidationIssue[], requireNonEmpty: boolean }} options
 */
function validateRepairContextFindingDetails(options) {
  validateNestedArrayField({
    record: options.repairContext,
    source: options.source,
    field: "repair_context.unresolved_finding_details",
    issues: options.issues,
    required: true,
  });
  const details = options.repairContext.unresolved_finding_details;
  if (!Array.isArray(details)) return;
  if (options.requireNonEmpty && details.length === 0) {
    options.issues.push(
      issue({
        code: "required_field_missing",
        source: options.source,
        field: "repair_context.unresolved_finding_details",
        expected: "non-empty array",
        actual: "empty",
        message: "Review repair decisions must preserve structured unresolved finding details.",
      }),
    );
    return;
  }

  details.forEach((entry, index) => {
    if (!isPlainObject(entry)) {
      options.issues.push(
        issue({
          code: "field_type_mismatch",
          source: options.source,
          field: `repair_context.unresolved_finding_details[${index}]`,
          expected: "object",
          actual: describeActualType(entry),
          message: "Repair finding details must be objects.",
        }),
      );
      return;
    }

    for (const field of ["finding_id", "category", "severity", "summary", "resolution_requirement"]) {
      validateNestedStringField({
        record: entry,
        source: options.source,
        field: `repair_context.unresolved_finding_details[${index}].${field}`,
        issues: options.issues,
        required: true,
      });
      if (typeof entry[field] === "string" && entry[field].trim().length === 0) {
        options.issues.push(
          issue({
            code: "required_field_missing",
            source: options.source,
            field: `repair_context.unresolved_finding_details[${index}].${field}`,
            expected: "non-empty string",
            actual: "empty",
            message: `Repair finding detail '${field}' must be non-empty.`,
          }),
        );
      }
    }

    validateNestedArrayField({
      record: entry,
      source: options.source,
      field: `repair_context.unresolved_finding_details[${index}].evidence_refs`,
      issues: options.issues,
      required: true,
    });
    validateStringArrayItems({
      values: entry.evidence_refs,
      source: options.source,
      field: `repair_context.unresolved_finding_details[${index}].evidence_refs`,
      issues: options.issues,
    });
    if (options.requireNonEmpty && (!Array.isArray(entry.evidence_refs) || entry.evidence_refs.length === 0)) {
      options.issues.push(
        issue({
          code: "required_field_missing",
          source: options.source,
          field: `repair_context.unresolved_finding_details[${index}].evidence_refs`,
          expected: "non-empty array",
          actual: "empty",
          message: "Repair finding details must preserve evidence refs for request-repair decisions.",
        }),
      );
    }
    validateVerificationFailureDetails({
      entries: entry.verification_failure_details,
      source: options.source,
      field: `repair_context.unresolved_finding_details[${index}].verification_failure_details`,
      issues: options.issues,
    });
  });
}

/**
 * @param {Record<string, unknown>} document
 * @param {string} source
 * @returns {import("./index.d.ts").ContractValidationIssue[]}
 */
function validateReviewDecision(document, source) {
  /** @type {import("./index.d.ts").ContractValidationIssue[]} */
  const issues = [];
  validateNestedStringField({
    record: document,
    source,
    field: "quality_repair_request_ref",
    issues,
    required: false,
  });
  validateQualityRepairLineage({
    record: document,
    source,
    field: "quality_repair_lineage",
    issues,
  });
  const repairContext = validateRequiredObjectField({
    record: document,
    source,
    field: "repair_context",
    issues,
  });
  if (!repairContext) return issues;

  validateNestedStringField({
    record: repairContext,
    source,
    field: "repair_context.source_phase",
    issues,
    required: true,
  });
  validateNestedNumberField({
    record: repairContext,
    source,
    field: "repair_context.cycle_iteration",
    issues,
    required: true,
  });
  for (const field of [
    "unresolved_findings",
    "meaningful_changed_paths",
    "verification_refs",
    "previous_repair_decision_refs",
    "new_context_since_previous",
  ]) {
    validateNestedArrayField({
      record: repairContext,
      source,
      field: `repair_context.${field}`,
      issues,
      required: true,
    });
    validateStringArrayItems({
      values: repairContext[field],
      source,
      field: `repair_context.${field}`,
      issues,
    });
  }
  validateRepairContextFindingDetails({
    repairContext,
    source,
    issues,
    requireNonEmpty: document.decision === "request-repair",
  });
  validateNestedStringField({
    record: repairContext,
    source,
    field: "repair_context.context_fingerprint",
    issues,
    required: true,
  });
  validateNestedStringField({
    record: repairContext,
    source,
    field: "repair_context.verification_status",
    issues,
    required: true,
  });
  validateNestedStringField({
    record: repairContext,
    source,
    field: "repair_context.stop_reason",
    issues,
    required: true,
  });
  validateNestedStringField({
    record: repairContext,
    source,
    field: "repair_context.requested_next_step",
    issues,
    required: true,
  });

  if (document.decision !== "request-repair") return issues;

  if (!["review", "qa", "post-run-primary", "post-run-diagnostic"].includes(String(repairContext.source_phase))) {
    issues.push(
      issue({
        code: "enum_value_invalid",
        source,
        field: "repair_context.source_phase",
        expected: "review|qa|post-run-primary|post-run-diagnostic",
        actual:
          typeof repairContext.source_phase === "string"
            ? repairContext.source_phase
            : describeActualType(repairContext.source_phase),
        message: "Review repair decisions must identify the source phase that requested repair.",
      }),
    );
  }
  if (
    typeof repairContext.cycle_iteration !== "number" ||
    !Number.isInteger(repairContext.cycle_iteration) ||
    repairContext.cycle_iteration < 1
  ) {
    issues.push(
      issue({
        code: "field_type_mismatch",
        source,
        field: "repair_context.cycle_iteration",
        expected: "positive integer",
        actual: describeActualType(repairContext.cycle_iteration),
        message: "Review repair decisions must identify a positive quality-cycle iteration.",
      }),
    );
  }
  if (!Array.isArray(repairContext.unresolved_findings) || repairContext.unresolved_findings.length === 0) {
    issues.push(
      issue({
        code: "required_field_missing",
        source,
        field: "repair_context.unresolved_findings",
        expected: "non-empty array",
        actual: "empty",
        message: "Review repair decisions must preserve unresolved findings.",
      }),
    );
  }
  if (!Array.isArray(repairContext.verification_refs) || repairContext.verification_refs.length === 0) {
    issues.push(
      issue({
        code: "required_field_missing",
        source,
        field: "repair_context.verification_refs",
        expected: "non-empty array",
        actual: "empty",
        message: "Review repair decisions must preserve verification evidence refs.",
      }),
    );
  }
  if (typeof repairContext.context_fingerprint !== "string" || repairContext.context_fingerprint.trim().length === 0) {
    issues.push(
      issue({
        code: "required_field_missing",
        source,
        field: "repair_context.context_fingerprint",
        expected: "non-empty string",
        actual: describeActualType(repairContext.context_fingerprint),
        message: "Review repair decisions must preserve a deterministic repair-context fingerprint.",
      }),
    );
  }
	  if (
	    Array.isArray(repairContext.previous_repair_decision_refs) &&
	    repairContext.previous_repair_decision_refs.length > 0 &&
	    (!Array.isArray(repairContext.new_context_since_previous) ||
	      repairContext.new_context_since_previous.length === 0)
	  ) {
	    issues.push(
	      issue({
	        code: "required_field_missing",
	        source,
	        field: "repair_context.new_context_since_previous",
	        expected: "non-empty array when previous repair decisions exist",
	        actual: Array.isArray(repairContext.new_context_since_previous) ? "empty" : describeActualType(repairContext.new_context_since_previous),
	        message: "Repeated repair decisions must identify new actionable context since the previous repair.",
	      }),
	    );
	  }
	  if (typeof repairContext.stop_reason !== "string" || repairContext.stop_reason.trim().length === 0) {
    issues.push(
      issue({
        code: "required_field_missing",
        source,
        field: "repair_context.stop_reason",
        expected: "non-empty string",
        actual: describeActualType(repairContext.stop_reason),
        message: "Review repair decisions must preserve the stop reason.",
      }),
    );
  }
  if (repairContext.requested_next_step !== "execution") {
    issues.push(
      issue({
        code: "enum_value_invalid",
        source,
        field: "repair_context.requested_next_step",
        expected: "execution",
        actual: String(repairContext.requested_next_step),
        message: "Public repair decisions must route back to execution.",
      }),
    );
  }

  return issues;
}

/**
 * @param {Record<string, unknown>} document
 * @param {string} source
 * @returns {import("./index.d.ts").ContractValidationIssue[]}
 */
function validateQualityRepairRequest(document, source) {
  /** @type {import("./index.d.ts").ContractValidationIssue[]} */
  const issues = [];

  validateStringArrayItems({ values: document.finding_refs, source, field: "finding_refs", issues });
  validateStringArrayItems({ values: document.blockers, source, field: "blockers", issues });
  validateStringArrayItems({ values: document.evidence_refs, source, field: "evidence_refs", issues });

  const repairScope = validateRequiredObjectField({
    record: document,
    source,
    field: "repair_scope",
    issues,
  });
  if (repairScope) {
    for (const field of ["target_step", "requested_next_step", "reason"]) {
      validateNestedStringField({
        record: repairScope,
        source,
        field: `repair_scope.${field}`,
        issues,
        required: false,
      });
    }
    for (const field of ["allowed_paths", "verification_refs", "required_evidence_refs", "compiled_context_refs"]) {
      validateOptionalStringArrayField({
        record: repairScope,
        source,
        field: `repair_scope.${field}`,
        issues,
      });
    }
  }

  const attemptBudget = validateRequiredObjectField({
    record: document,
    source,
    field: "attempt_budget",
    issues,
  });
  if (attemptBudget) {
    validateNestedStringField({
      record: attemptBudget,
      source,
      field: "attempt_budget.policy_ref",
      issues,
      required: true,
    });
    for (const field of ["max_attempts", "attempt_index", "remaining_attempts"]) {
      validateNestedNumberField({
        record: attemptBudget,
        source,
        field: `attempt_budget.${field}`,
        issues,
        required: true,
      });
    }
  }

  const statusHistory = validateOptionalArrayField({
    record: document,
    source,
    field: "status_history",
    issues,
  });
  if (statusHistory) {
    statusHistory.forEach((entry, index) => {
      const entryField = `status_history[${index}]`;
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
        allowedValues: QUALITY_REPAIR_STATUS_VALUES,
        issues,
        required: true,
      });
      validateNestedStringField({
        record: entry,
        source,
        field: `${entryField}.changed_at`,
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
      validateOptionalStringArrayField({
        record: entry,
        source,
        field: `${entryField}.evidence_refs`,
        issues,
      });
    });
  }

  for (const field of ["updated_at", "closed_at", "operator_override_ref"]) {
    validateNestedNullableStringField({
      record: document,
      source,
      field,
      issues,
      required: false,
    });
  }

  return issues;
}

/**
 * @param {{ record: Record<string, unknown>, source: string, field: string, issues: import("./index.d.ts").ContractValidationIssue[] }} options
 */
function validateQualityRepairLineage(options) {
  const lineage = validateOptionalObjectField({
    record: options.record,
    source: options.source,
    field: options.field,
    issues: options.issues,
  });
  if (!lineage) return;

  validateNestedStringField({
    record: lineage,
    source: options.source,
    field: `${options.field}.request_ref`,
    issues: options.issues,
    required: true,
  });
  validateNestedStringField({
    record: lineage,
    source: options.source,
    field: `${options.field}.cycle_id`,
    issues: options.issues,
    required: true,
  });
  validateNestedEnumStringField({
    record: lineage,
    source: options.source,
    field: `${options.field}.source_stage`,
    allowedValues: QUALITY_REPAIR_SOURCE_STAGE_VALUES,
    issues: options.issues,
    required: true,
  });
  validateNestedEnumStringField({
    record: lineage,
    source: options.source,
    field: `${options.field}.status`,
    allowedValues: QUALITY_REPAIR_STATUS_VALUES,
    issues: options.issues,
    required: true,
  });
  validateNestedNumberField({
    record: lineage,
    source: options.source,
    field: `${options.field}.attempt_index`,
    issues: options.issues,
    required: false,
  });
  validateOptionalStringArrayField({
    record: lineage,
    source: options.source,
    field: `${options.field}.evidence_refs`,
    issues: options.issues,
  });
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
  const verificationCoverage = validateOptionalObjectField({
    record: value,
    source,
    field: "artifact_quality.verification_coverage",
    issues,
  });
  if (!verificationCoverage) {
    if (!Object.prototype.hasOwnProperty.call(value, "verification_coverage")) {
      issues.push(
        issue({
          code: "required_field_missing",
          source,
          field: "artifact_quality.verification_coverage",
          expected: "object",
          actual: "missing",
          message: "Field 'artifact_quality.verification_coverage' is required for review report verification mapping evidence.",
        }),
      );
    }
    return;
  }
  for (const field of [
    "changed_test_paths",
    "covered_test_paths",
    "uncovered_test_paths",
    "covering_commands",
    "recorded_test_commands",
  ]) {
    if (!Object.prototype.hasOwnProperty.call(verificationCoverage, field)) {
      issues.push(
        issue({
          code: "required_field_missing",
          source,
          field: `artifact_quality.verification_coverage.${field}`,
          expected: "array",
          actual: "missing",
          message: `Field 'artifact_quality.verification_coverage.${field}' is required for review report verification mapping evidence.`,
        }),
      );
    }
    validateOptionalStringArrayField({
      record: verificationCoverage,
      source,
      field: `artifact_quality.verification_coverage.${field}`,
      issues,
    });
  }
  validateNestedStringField({
    record: verificationCoverage,
    source,
    field: "artifact_quality.verification_coverage.coverage_reason",
    issues,
    required: true,
  });
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
    validateVerificationFailureDetails({
      entries: entry.verification_failure_details,
      source: options.source,
      field: `${options.field}[${index}].verification_failure_details`,
      issues: options.issues,
    });
  });
}

/**
 * @param {{ entries: unknown, source: string, field: string, issues: import("./index.d.ts").ContractValidationIssue[] }} options
 */
function validateVerificationFailureDetails(options) {
  if (options.entries === undefined) return;
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
    const field = `${options.field}[${index}]`;
    if (!isPlainObject(entry)) {
      options.issues.push(
        issue({
          code: "field_type_mismatch",
          source: options.source,
          field,
          expected: "object",
          actual: describeActualType(entry),
          message: `Field '${field}' must be 'object'.`,
        }),
      );
      return;
    }

    for (const detailField of ["command", "role", "enforcement", "timeout_class", "failure_summary"]) {
      validateNestedStringField({
        record: entry,
        source: options.source,
        field: `${field}.${detailField}`,
        issues: options.issues,
        required: true,
      });
    }
    for (const detailField of [
      "command_group_id",
      "phase",
      "enforcement_result",
      "outcome",
      "signal",
      "error_code",
      "working_dir",
      "repo_scope",
      "stdout_excerpt",
      "stderr_excerpt",
    ]) {
      validateNestedNullableStringField({
        record: entry,
        source: options.source,
        field: `${field}.${detailField}`,
        issues: options.issues,
        required: false,
      });
    }
    validateNestedNumberField({
      record: entry,
      source: options.source,
      field: `${field}.exit_code`,
      issues: options.issues,
      required: false,
      allowNull: true,
    });
    validateNestedNumberField({
      record: entry,
      source: options.source,
      field: `${field}.command_timeout_ms`,
      issues: options.issues,
      required: false,
      allowNull: true,
    });
    validateNestedBooleanField({
      record: entry,
      source: options.source,
      field: `${field}.timed_out`,
      issues: options.issues,
      required: false,
    });
    validateNestedArrayField({
      record: entry,
      source: options.source,
      field: `${field}.evidence_refs`,
      issues: options.issues,
      required: true,
    });
    validateStringArrayItems({
      values: entry.evidence_refs,
      source: options.source,
      field: `${field}.evidence_refs`,
      issues: options.issues,
    });
    if (!Array.isArray(entry.evidence_refs) || entry.evidence_refs.length === 0) {
      options.issues.push(
        issue({
          code: "required_field_missing",
          source: options.source,
          field: `${field}.evidence_refs`,
          expected: "non-empty array",
          actual: Array.isArray(entry.evidence_refs) ? "empty" : describeActualType(entry.evidence_refs),
          message: "Verification failure details must preserve evidence refs.",
        }),
      );
    }
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
    allowedValues: LEARNING_LOOP_SCENARIO_VALUES,
    issues,
    required: false,
  });
  validateNestedEnumStringField({
    record: matrixCell,
    source,
    field: `${parentField}.provider_variant_id`,
    allowedValues: LEARNING_LOOP_PROVIDER_VARIANT_VALUES,
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
