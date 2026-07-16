import { isPlainObject, issue } from "./utils.mjs";

const UNIT_ARRAY_FIELDS = [
  "repository_scope",
  "component_scope",
  "workspace_mounts",
  "conflict_keys",
  "command_locks",
  "verification_gates",
  "criteria_coverage",
];

const PLAN_FIELDS = [
  "dag_version",
  "dag_digest",
  "source_plan_refs",
  "impacted_scope",
  "non_run_tasks",
  "integration_gates",
  "validation_findings",
  "concurrency_summary",
  "risks",
  "approval",
];

export function validateExecutionPlanV2(document, source) {
  if (document.schema_version !== 2) return [];
  const issues = [];
  for (const field of PLAN_FIELDS) {
    if (document[field] === undefined) {
      issues.push(issue({
        code: "required_field_missing",
        source,
        field,
        expected: "present for execution-plan v2",
        actual: "missing",
        message: `Missing required execution-plan v2 field '${field}'.`,
      }));
    }
  }
  for (const [index, unit] of (Array.isArray(document.execution_units) ? document.execution_units : []).entries()) {
    if (!isPlainObject(unit)) continue;
    for (const field of UNIT_ARRAY_FIELDS) {
      if (!Array.isArray(unit[field])) {
        issues.push(issue({
          code: "field_type_mismatch",
          source,
          field: `execution_units[${index}].${field}`,
          expected: "array",
          actual: typeof unit[field],
          message: `Execution-plan v2 unit field '${field}' must be an array.`,
        }));
      }
    }
    if (!isPlainObject(unit.concurrency) || !["parallel-candidate", "serialized"].includes(unit.concurrency.classification)) {
      issues.push(issue({
        code: "enum_value_invalid",
        source,
        field: `execution_units[${index}].concurrency`,
        expected: "parallel-candidate|serialized",
        actual: typeof unit.concurrency,
        message: "Execution unit concurrency classification is required.",
      }));
    }
  }
  return issues;
}
