import { describeActualType, isPlainObject, issue } from "./utils.mjs";

function validateNumber(record, source, field, issues, required, allowNull = false) {
  const name = field.split(".").at(-1) ?? field;
  if (!(name in record)) {
    if (required) issues.push(issue({ code: "required_field_missing", source, field, expected: "present", actual: "missing", message: `Missing required field '${field}'.` }));
    return;
  }
  const value = record[name];
  if (allowNull && value === null) return;
  if (typeof value !== "number" || !Number.isFinite(value)) issues.push(issue({ code: "field_type_mismatch", source, field, expected: "number", actual: describeActualType(value), message: `Field '${field}' must be 'number'.` }));
}

export function validateContextBudgetEstimate(estimate, source, parentField, issues, options = {}) {
  for (const field of ["bytes", "chars", "estimated_tokens"]) validateNumber(estimate, source, `${parentField}.${field}`, issues, true);
  validateNumber(estimate, source, `${parentField}.budget_limit_tokens`, issues, options.requireBudgetLimit === true, true);
}

export function validateContextSizeSources(value, source, field, issues) {
  if (!Array.isArray(value)) {
    issues.push(issue({ code: value === undefined ? "required_field_missing" : "field_type_mismatch", source, field, expected: "array", actual: value === undefined ? "missing" : describeActualType(value), message: `Field '${field}' must be an array of context size source entries.` }));
    return;
  }
  value.forEach((entry, index) => {
    const entryField = `${field}[${index}]`;
    if (!isPlainObject(entry)) {
      issues.push(issue({ code: "field_type_mismatch", source, field: entryField, expected: "object", actual: describeActualType(entry), message: `Field '${entryField}' must be 'object'.` }));
      return;
    }
    const sourceField = `${entryField}.source`;
    if (!("source" in entry)) issues.push(issue({ code: "required_field_missing", source, field: sourceField, expected: "present", actual: "missing", message: `Missing required field '${sourceField}'.` }));
    else if (typeof entry.source !== "string") issues.push(issue({ code: "field_type_mismatch", source, field: sourceField, expected: "string", actual: describeActualType(entry.source), message: `Field '${sourceField}' must be 'string'.` }));
    for (const sizeField of ["bytes", "chars", "estimated_tokens"]) validateNumber(entry, source, `${entryField}.${sizeField}`, issues, true);
  });
}
