import { issue, isPlainObject } from "./utils.mjs";

const CATEGORIES = ["mutation", "workbench", "evidence", "copy", "refresh", "unavailable"];
const AVAILABILITY = ["ready", "blocked"];
const SURFACES = ["cockpit", "attention", "journey", "evidence"];

function requiredEnum(record, field, values, source, issues) {
  const key = field.split(".").at(-1);
  const value = record[key];
  if (typeof value !== "string" || !values.includes(value)) issues.push(issue({ code: typeof value === "string" ? "enum_value_invalid" : "field_type_mismatch", source, field, expected: values.join("|"), actual: typeof value, message: `Field '${field}' must be one of ${values.join(", ")}.` }));
}

export function validateOperatorControl(document, source) {
  const control = isPlainObject(document.primary_action) ? document.primary_action.operator_control : null;
  if (control === undefined || control === null) return [];
  if (!isPlainObject(control)) return [issue({ code: "field_type_mismatch", source, field: "primary_action.operator_control", expected: "object", actual: typeof control, message: "Field 'primary_action.operator_control' must be an object." })];
  const issues = [];
  requiredEnum(control, "primary_action.operator_control.category", CATEGORIES, source, issues);
  requiredEnum(control, "primary_action.operator_control.availability", AVAILABILITY, source, issues);
  if (typeof control.label !== "string" || !control.label.trim()) issues.push(issue({ code: "field_type_mismatch", source, field: "primary_action.operator_control.label", expected: "string", actual: typeof control.label, message: "Operator control label must be a non-empty string." }));
  if (typeof control.requires_confirmation !== "boolean") issues.push(issue({ code: "field_type_mismatch", source, field: "primary_action.operator_control.requires_confirmation", expected: "boolean", actual: typeof control.requires_confirmation, message: "Operator confirmation metadata must be boolean." }));
  if (control.target_surface !== null && !SURFACES.includes(control.target_surface)) requiredEnum(control, "primary_action.operator_control.target_surface", SURFACES, source, issues);
  if (control.operation !== null) {
    if (!isPlainObject(control.operation) || typeof control.operation.command !== "string" || !control.operation.command.trim() || !isPlainObject(control.operation.flags)) issues.push(issue({ code: "field_type_mismatch", source, field: "primary_action.operator_control.operation", expected: "{ command, flags } | null", actual: typeof control.operation, message: "Operator operation must contain a canonical command and flags object, or be null." }));
  }
  return issues;
}
