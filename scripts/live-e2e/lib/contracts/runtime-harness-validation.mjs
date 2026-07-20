import { describeActualType, isPlainObject, issue } from "./utils.mjs";

export function validateRuntimeHarnessParentRelation(document, source) {
  const relation = document.parent_relation;
  if (relation === undefined) return [];
  if (!isPlainObject(relation)) return [issue({ code: "field_type_mismatch", source, field: "parent_relation", expected: "object", actual: describeActualType(relation), message: "Field 'parent_relation' must be 'object'." })];
  const issues = [];
  for (const field of ["parent_run_id", "execution_unit_id"]) {
    if (typeof relation[field] !== "string" || relation[field].trim().length === 0) issues.push(issue({ code: field in relation ? "field_type_mismatch" : "required_field_missing", source, field: `parent_relation.${field}`, expected: "non-empty string", actual: field in relation ? describeActualType(relation[field]) : "missing", message: `Field 'parent_relation.${field}' must be a non-empty string.` }));
  }
  if (!Array.isArray(relation.task_refs) || relation.task_refs.some((value) => typeof value !== "string" || value.trim().length === 0)) issues.push(issue({ code: "field_type_mismatch", source, field: "parent_relation.task_refs", expected: "array of non-empty strings", actual: describeActualType(relation.task_refs), message: "Field 'parent_relation.task_refs' must contain only non-empty strings." }));
  if (!Number.isInteger(relation.attempt) || relation.attempt < 1) issues.push(issue({ code: "field_type_mismatch", source, field: "parent_relation.attempt", expected: "positive integer", actual: describeActualType(relation.attempt), message: "Field 'parent_relation.attempt' must be a positive integer." }));
  return issues;
}
