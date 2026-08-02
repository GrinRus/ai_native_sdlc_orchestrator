function actualType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function finding(code, source, field, expected, actual, message) {
  return { code, source, field, expected, actual, message };
}

export function validateRuntimeHarnessParentRelation(document, source) {
  const relation = document.parent_relation;
  if (relation === undefined) return [];
  if (typeof relation !== "object" || relation === null || Array.isArray(relation)) {
    return [finding(
      "field_type_mismatch",
      source,
      "parent_relation",
      "object",
      actualType(relation),
      "Field 'parent_relation' must be 'object'.",
    )];
  }
  const issues = [];
  for (const field of ["parent_run_id", "execution_unit_id"]) {
    if (typeof relation[field] !== "string" || relation[field].trim().length === 0) {
      issues.push(finding(
        field in relation ? "field_type_mismatch" : "required_field_missing",
        source,
        `parent_relation.${field}`,
        "non-empty string",
        field in relation ? actualType(relation[field]) : "missing",
        `Field 'parent_relation.${field}' must be a non-empty string.`,
      ));
    }
  }
  if (!Array.isArray(relation.task_refs)) {
    issues.push(finding(
      "field_type_mismatch",
      source,
      "parent_relation.task_refs",
      "array of non-empty strings",
      actualType(relation.task_refs),
      "Field 'parent_relation.task_refs' must be an array of non-empty strings.",
    ));
  } else if (relation.task_refs.some((value) => typeof value !== "string" || value.trim().length === 0)) {
    issues.push(finding(
      "field_type_mismatch",
      source,
      "parent_relation.task_refs",
      "array of non-empty strings",
      "array with invalid item",
      "Field 'parent_relation.task_refs' must contain only non-empty strings.",
    ));
  }
  if (!Number.isInteger(relation.attempt) || relation.attempt < 1) {
    issues.push(finding(
      "field_type_mismatch",
      source,
      "parent_relation.attempt",
      "positive integer",
      actualType(relation.attempt),
      "Field 'parent_relation.attempt' must be a positive integer.",
    ));
  }
  return issues;
}
