import { describeActualType, isPlainObject, issue } from "./utils.mjs";
import { matchesAllowedPath } from "./canonical-values.mjs";
import {
  validateCriterionCoverage,
  validateEvidenceOwnership,
  validateExecutionGroups,
  validateTaskDag,
} from "./structured-task-plan-checks.mjs";

export const STRUCTURED_TASK_MODEL_VERSION = 1;
export const PLAN_STATUS_VALUES = Object.freeze([
  "proposed",
  "revision-required",
  "revision-requested",
  "approved",
  "superseded",
]);
export const PLAN_SIZE_VALUES = Object.freeze(["small", "medium", "large", "xlarge"]);
export const TASK_TYPE_VALUES = Object.freeze([
  "analysis",
  "design",
  "implementation",
  "verification",
  "documentation",
  "integration",
  "review",
  "delivery",
  "custom",
]);
export const CRITERION_KIND_VALUES = Object.freeze(["goal", "kpi", "definition-of-done", "acceptance"]);

function asNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asStringArray(value) {
  return Array.isArray(value)
    ? value.filter((entry) => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim())
    : [];
}

function requireString(record, field, source, issues) {
  if (!(field in record)) {
    issues.push(issue({
      code: "required_field_missing",
      source,
      field,
      expected: "non-empty string",
      actual: "missing",
      message: `Missing required field '${field}'.`,
    }));
    return null;
  }
  const value = asNonEmptyString(record[field]);
  if (!value) {
    issues.push(issue({
      code: "field_type_mismatch",
      source,
      field,
      expected: "non-empty string",
      actual: describeActualType(record[field]),
      message: `Field '${field}' must be a non-empty string.`,
    }));
  }
  return value;
}

function requireArray(record, field, source, issues, { nonEmpty = false } = {}) {
  if (!Array.isArray(record[field])) {
    issues.push(issue({
      code: field in record ? "field_type_mismatch" : "required_field_missing",
      source,
      field,
      expected: nonEmpty ? "non-empty array" : "array",
      actual: field in record ? describeActualType(record[field]) : "missing",
      message: `Field '${field}' must be ${nonEmpty ? "a non-empty" : "an"} array.`,
    }));
    return [];
  }
  if (nonEmpty && record[field].length === 0) {
    issues.push(issue({
      code: "required_field_missing",
      source,
      field,
      expected: "non-empty array",
      actual: "empty",
      message: `Field '${field}' must contain at least one item.`,
    }));
  }
  return record[field];
}

function validateStringArray(record, field, source, issues, { nonEmpty = false } = {}) {
  const values = requireArray(record, field, source, issues, { nonEmpty });
  values.forEach((value, index) => {
    if (!asNonEmptyString(value)) {
      issues.push(issue({
        code: "field_type_mismatch",
        source,
        field: `${field}[${index}]`,
        expected: "non-empty string",
        actual: describeActualType(value),
        message: `Field '${field}[${index}]' must be a non-empty string.`,
      }));
    }
  });
  return asStringArray(values);
}

function validateEnum(record, field, allowedValues, source, issues) {
  const value = requireString(record, field, source, issues);
  if (value && !allowedValues.includes(value)) {
    issues.push(issue({
      code: "enum_value_invalid",
      source,
      field,
      expected: allowedValues.join("|"),
      actual: value,
      message: `Field '${field}' has unsupported value '${value}'.`,
    }));
  }
  return value;
}

function pathWithinAllowedScope(candidate, allowedPaths) {
  return allowedPaths.some((allowed) => matchesAllowedPath(allowed, candidate));
}

/**
 * Validate additive structured-task fields. Documents without
 * task_model_version are legacy compact records and are intentionally ignored.
 *
 * @param {Record<string, unknown>} document
 * @param {string} source
 * @returns {import("./index.d.ts").ContractValidationIssue[]}
 */
export function validateStructuredTaskPlan(document, source) {
  if (!("task_model_version" in document)) return [];

  /** @type {import("./index.d.ts").ContractValidationIssue[]} */
  const issues = [];
  if (document.task_model_version !== STRUCTURED_TASK_MODEL_VERSION) {
    issues.push(issue({
      code: "enum_value_invalid",
      source,
      field: "task_model_version",
      expected: String(STRUCTURED_TASK_MODEL_VERSION),
      actual: String(document.task_model_version),
      message: `Unsupported structured task model version '${String(document.task_model_version)}'.`,
    }));
  }

  requireString(document, "plan_id", source, issues);
  requireString(document, "plan_digest", source, issues);
  if (!Number.isInteger(document.plan_version) || Number(document.plan_version) < 1) {
    issues.push(issue({
      code: "field_type_mismatch",
      source,
      field: "plan_version",
      expected: "positive integer",
      actual: String(document.plan_version ?? "missing"),
      message: "Field 'plan_version' must be a positive integer.",
    }));
  }
  const planStatus = validateEnum(document, "plan_status", PLAN_STATUS_VALUES, source, issues);
  const planSize = validateEnum(document, "plan_size", PLAN_SIZE_VALUES, source, issues);
  if (!("previous_plan_ref" in document) || (document.previous_plan_ref !== null && !asNonEmptyString(document.previous_plan_ref))) {
    issues.push(issue({
      code: "field_type_mismatch",
      source,
      field: "previous_plan_ref",
      expected: "null or non-empty string",
      actual: "previous_plan_ref" in document ? describeActualType(document.previous_plan_ref) : "missing",
      message: "Field 'previous_plan_ref' must be present as null or a non-empty string.",
    }));
  }
  if (!isPlainObject(document.revision_summary)) {
    issues.push(issue({ code: "field_type_mismatch", source, field: "revision_summary", expected: "object", actual: describeActualType(document.revision_summary), message: "Field 'revision_summary' must be an object." }));
  }
  if (!isPlainObject(document.source_refs)) {
    issues.push(issue({ code: "field_type_mismatch", source, field: "source_refs", expected: "object", actual: describeActualType(document.source_refs), message: "Field 'source_refs' must be an object." }));
  }
  const criteria = requireArray(document, "criteria_catalog", source, issues, { nonEmpty: true });
  const tasks = requireArray(document, "local_tasks", source, issues, { nonEmpty: true });

  const minimumTasks = planSize === "small" ? 1 : 3;
  const maximumTasks = planSize === "small" ? 3 : 7;
  if (tasks.length < minimumTasks || tasks.length > maximumTasks) {
    issues.push(issue({
      code: "field_type_mismatch",
      source,
      field: "local_tasks",
      expected: `${minimumTasks}-${maximumTasks} tasks for plan_size=${planSize ?? "unknown"}`,
      actual: String(tasks.length),
      message: planSize === "xlarge" && tasks.length > 7
        ? "mission-split-required: xlarge plans must be split into independently acceptable outcomes."
        : `Plan size '${planSize ?? "unknown"}' requires ${minimumTasks}-${maximumTasks} tasks.`,
    }));
  }

  const criterionIds = new Set();
  criteria.forEach((entry, index) => {
    const field = `criteria_catalog[${index}]`;
    if (!isPlainObject(entry)) {
      issues.push(issue({ code: "field_type_mismatch", source, field, expected: "object", actual: describeActualType(entry), message: `Field '${field}' must be an object.` }));
      return;
    }
    const criterionId = requireString(entry, "criterion_id", source, issues)?.trim();
    validateEnum(entry, "kind", CRITERION_KIND_VALUES, source, issues);
    requireString(entry, "text", source, issues);
    requireString(entry, "source_ref", source, issues);
    if (criterionId) {
      if (criterionIds.has(criterionId)) {
        issues.push(issue({ code: "enum_value_invalid", source, field: `${field}.criterion_id`, expected: "unique criterion id", actual: criterionId, message: `Duplicate criterion id '${criterionId}'.` }));
      }
      criterionIds.add(criterionId);
    }
  });

  const taskIds = new Set();
  const dependencies = new Map();
  const referencedCriteria = new Set();
  const ownedEvidence = new Set();
  const groups = new Map();
  const planScope = isPlainObject(document.scope) ? document.scope : {};
  const planAllowedPaths = asStringArray(Object.keys(planScope).length > 0 ? planScope.allowed_paths : document.allowed_paths);
  const planRepoIds = new Set([
    ...asStringArray(planScope.repo_scopes),
    ...(Array.isArray(document.repo_scopes)
      ? document.repo_scopes.flatMap((entry) => typeof entry === "string" ? [entry] : isPlainObject(entry) ? asStringArray([entry.repo_id]) : [])
      : []),
  ]);
  const planComponentIds = new Set([
    ...asStringArray(planScope.component_ids),
    ...asStringArray(document.component_ids),
    ...(Array.isArray(document.repo_scopes)
      ? document.repo_scopes.flatMap((entry) => isPlainObject(entry) ? asStringArray(entry.component_ids) : [])
      : []),
  ]);
  if (planSize === "small" && planRepoIds.size > 1) {
    issues.push(issue({
      code: "enum_value_invalid",
      source,
      field: "plan_size",
      expected: "medium|large|xlarge for bounded multirepo scope",
      actual: "small",
      message: "Bounded multirepo plans cannot use plan_size=small.",
    }));
  }

  tasks.forEach((entry, index) => {
    const field = `local_tasks[${index}]`;
    if (!isPlainObject(entry)) {
      issues.push(issue({ code: "field_type_mismatch", source, field, expected: "object", actual: describeActualType(entry), message: `Field '${field}' must be an object.` }));
      return;
    }
    const taskId = requireString(entry, "task_id", source, issues);
    requireString(entry, "title", source, issues);
    validateEnum(entry, "type", TASK_TYPE_VALUES, source, issues);
    requireString(entry, "objective", source, issues);
    requireString(entry, "rationale", source, issues);
    const dependsOn = validateStringArray(entry, "depends_on", source, issues);
    validateStringArray(entry, "work_items", source, issues, { nonEmpty: true });
    const criteriaRefs = validateStringArray(entry, "criteria_refs", source, issues, { nonEmpty: true });
    const expectedEvidence = validateStringArray(entry, "expected_evidence", source, issues, { nonEmpty: true });
    validateStringArray(entry, "risks", source, issues);
    validateStringArray(entry, "stop_conditions", source, issues);

    const scope = entry.scope;
    let taskAllowedPaths = [];
    let taskForbiddenPaths = [];
    let repoIds = [];
    if (!isPlainObject(scope)) {
      issues.push(issue({ code: "field_type_mismatch", source, field: `${field}.scope`, expected: "object", actual: describeActualType(scope), message: `Field '${field}.scope' must be an object.` }));
    } else {
      repoIds = validateStringArray(scope, "repo_ids", source, issues, { nonEmpty: true });
      const componentIds = validateStringArray(scope, "component_ids", source, issues);
      taskAllowedPaths = validateStringArray(scope, "allowed_paths", source, issues, { nonEmpty: true });
      taskForbiddenPaths = validateStringArray(scope, "forbidden_paths", source, issues);
      for (const repoId of repoIds) {
        if (planRepoIds.size > 0 && !planRepoIds.has(repoId)) {
          issues.push(issue({ code: "enum_value_invalid", source, field: `${field}.scope.repo_ids`, expected: `subset of ${[...planRepoIds].join(",")}`, actual: repoId, message: `Task repository '${repoId}' widens the approved plan scope.` }));
        }
      }
      for (const componentId of componentIds) {
        if (planComponentIds.size > 0 && !planComponentIds.has(componentId)) {
          issues.push(issue({ code: "enum_value_invalid", source, field: `${field}.scope.component_ids`, expected: `subset of ${[...planComponentIds].join(",")}`, actual: componentId, message: `Task component '${componentId}' widens the approved plan scope.` }));
        }
      }
      for (const allowedPath of taskAllowedPaths) {
        if (planAllowedPaths.length > 0 && !pathWithinAllowedScope(allowedPath, planAllowedPaths)) {
          issues.push(issue({ code: "enum_value_invalid", source, field: `${field}.scope.allowed_paths`, expected: `subset of ${planAllowedPaths.join(",")}`, actual: allowedPath, message: `Task path '${allowedPath}' widens the approved plan scope.` }));
        }
      }
    }

    const verification = entry.verification;
    if (!isPlainObject(verification)) {
      issues.push(issue({ code: "field_type_mismatch", source, field: `${field}.verification`, expected: "object", actual: describeActualType(verification), message: `Field '${field}.verification' must be an object.` }));
    } else {
      const commandGroups = validateStringArray(verification, "command_group_refs", source, issues);
      const validators = validateStringArray(verification, "validators", source, issues);
      const manualChecks = validateStringArray(verification, "manual_checks", source, issues);
      const successConditions = validateStringArray(verification, "success_conditions", source, issues, { nonEmpty: true });
      if (commandGroups.length + validators.length + manualChecks.length === 0) {
        issues.push(issue({ code: "required_field_missing", source, field: `${field}.verification`, expected: "at least one command group, validator, or manual check", actual: "empty", message: `Task '${taskId ?? index}' has no executable or reviewable verification.` }));
      }
      if (successConditions.length === 0) {
        // The generic array validator already emits the precise finding.
      }
    }

    const executionHints = entry.execution_hints;
    if (!isPlainObject(executionHints)) {
      issues.push(issue({ code: "field_type_mismatch", source, field: `${field}.execution_hints`, expected: "object", actual: describeActualType(executionHints), message: `Field '${field}.execution_hints' must be an object.` }));
    } else {
      if (typeof executionHints.parallel_candidate !== "boolean") {
        issues.push(issue({ code: "field_type_mismatch", source, field: `${field}.execution_hints.parallel_candidate`, expected: "boolean", actual: describeActualType(executionHints.parallel_candidate), message: "Execution hint 'parallel_candidate' must be boolean." }));
      }
      const groupKey = asNonEmptyString(executionHints.group_key);
      const groupReason = asNonEmptyString(executionHints.group_reason);
      if (groupKey && !groupReason) {
        issues.push(issue({ code: "required_field_missing", source, field: `${field}.execution_hints.group_reason`, expected: "non-empty string when group_key is set", actual: "missing", message: `Task group '${groupKey}' requires a grouping reason.` }));
      }
      if (groupKey) {
        const group = groups.get(groupKey) ?? [];
        group.push({ field, taskId, repoIds, allowedPaths: taskAllowedPaths, forbiddenPaths: taskForbiddenPaths, dependsOn });
        groups.set(groupKey, group);
      }
    }

    if (taskId) {
      if (taskIds.has(taskId)) {
        issues.push(issue({ code: "enum_value_invalid", source, field: `${field}.task_id`, expected: "unique task id", actual: taskId, message: `Duplicate task id '${taskId}'.` }));
      }
      taskIds.add(taskId);
      dependencies.set(taskId, dependsOn);
    }
    criteriaRefs.forEach((criterionId) => referencedCriteria.add(criterionId));
    expectedEvidence.forEach((evidence) => ownedEvidence.add(evidence));
  });

  issues.push(...validateTaskDag({ taskIds, dependencies, source }));
  issues.push(...validateCriterionCoverage({ criterionIds, referencedCriteria, source }));
  issues.push(...validateEvidenceOwnership({
    expectedEvidence: asStringArray(document.expected_evidence),
    ownedEvidence,
    source,
  }));
  issues.push(...validateExecutionGroups({ groups, source }));

  if (planStatus === "revision-required" || planStatus === "revision-requested") {
    const readableDraftFields = new Set([
      "task_model_version",
      "plan_id",
      "plan_version",
      "plan_status",
      "plan_size",
    ]);
    return issues.filter((entry) => readableDraftFields.has(entry.field));
  }

  return issues;
}
