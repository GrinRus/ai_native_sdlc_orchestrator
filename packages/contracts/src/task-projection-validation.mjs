import { isPlainObject, issue } from "./utils.mjs";

const STATUS_VALUES = ["draft", "prepared", "active", "attention", "completed"];
const DELIVERY_MODES = ["no-write", "patch-only", "local-branch", "fork-first-pr"];
const ROUTE_STEPS = ["discovery", "research", "spec", "planning", "implement", "review", "qa", "repair", "eval", "harness"];
const ROUTE_SOURCES = ["project-default", "task-override"];
const READINESS_VALUES = ["ready", "unknown", "stale", "unavailable", "blocked"];

function requiredString(record, field, source, issues) {
  if (typeof record[field] !== "string" || !record[field].trim()) {
    issues.push(issue({ code: "field_type_mismatch", source, field, expected: "non-empty string", actual: typeof record[field], message: `Field '${field}' must be a non-empty string.` }));
    return false;
  }
  return true;
}

function requiredObject(record, field, source, issues) {
  if (!isPlainObject(record[field])) {
    issues.push(issue({ code: "field_type_mismatch", source, field, expected: "object", actual: Array.isArray(record[field]) ? "array" : typeof record[field], message: `Field '${field}' must be an object.` }));
    return null;
  }
  return record[field];
}

function requiredArray(record, field, source, issues) {
  if (!Array.isArray(record[field])) {
    issues.push(issue({ code: "field_type_mismatch", source, field, expected: "array", actual: typeof record[field], message: `Field '${field}' must be an array.` }));
    return false;
  }
  return true;
}

function enumField(record, field, values, source, issues, required = true) {
  if ((record[field] === undefined || record[field] === null) && !required) return;
  if (typeof record[field] !== "string" || !values.includes(record[field])) {
    issues.push(issue({ code: "enum_value_invalid", source, field, expected: values.join("|"), actual: String(record[field] ?? "missing"), message: `Field '${field}' must be one of ${values.join(", ")}.` }));
  }
}

/** @param {Record<string, unknown>} document @param {string} source */
export function validateTaskProjection(document, source) {
  const issues = [];
  if (document.schema_version !== 1) issues.push(issue({ code: "enum_value_invalid", source, field: "schema_version", expected: "1", actual: String(document.schema_version ?? "missing"), message: "Task projection schema_version must be 1." }));
  enumField(document, "status", STATUS_VALUES, source, issues);
  for (const field of ["task_id", "project_id", "display_title"]) requiredString(document, field, source, issues);
  if (document.read_only !== true) issues.push(issue({ code: "enum_value_invalid", source, field: "read_only", expected: "true", actual: String(document.read_only), message: "Task projections are read-only." }));
  const lineage = requiredObject(document, "lineage", source, issues);
  if (lineage) {
    if (lineage.task_id !== undefined && lineage.task_id !== document.task_id) issues.push(issue({ code: "enum_value_invalid", source, field: "lineage.task_id", expected: String(document.task_id), actual: String(lineage.task_id), message: "Task lineage task_id must match the projection identity." }));
    if (lineage.intent_submission_id !== null && lineage.intent_submission_id !== undefined) requiredString(lineage, "intent_submission_id", source, issues);
  }
  requiredArray(document, "run_ids", source, issues);
  const prepared = requiredObject(document, "prepared_contract", source, issues);
  if (!prepared) return issues;
  if (prepared.schema_version !== 1) issues.push(issue({ code: "enum_value_invalid", source, field: "prepared_contract.schema_version", expected: "1", actual: String(prepared.schema_version ?? "missing"), message: "Prepared contract schema_version must be 1." }));
  if (document.status === "prepared") requiredString(prepared, "outcome", source, issues);
  requiredArray(prepared, "acceptance_criteria", source, issues);
  const scope = requiredObject(prepared, "scope", source, issues);
  if (scope) {
    requiredArray(scope, "allowed_paths", source, issues);
    requiredArray(scope, "forbidden_paths", source, issues);
  }
  enumField(prepared, "delivery_mode", DELIVERY_MODES, source, issues);
  if (!Number.isInteger(prepared.normalization_revision) || prepared.normalization_revision < 0) issues.push(issue({ code: "field_type_mismatch", source, field: "prepared_contract.normalization_revision", expected: "non-negative integer", actual: String(prepared.normalization_revision ?? "missing"), message: "Prepared normalization revision must be a non-negative integer." }));
  const route = requiredObject(prepared, "approved_execution_route", source, issues);
  if (route) {
    if (document.status === "prepared") requiredString(route, "route_id", source, issues);
    else if (route.route_id !== null && route.route_id !== undefined) requiredString(route, "route_id", source, issues);
    if (typeof route.route_id === "string" && /^route\.intake-normalize\./u.test(route.route_id)) issues.push(issue({ code: "enum_value_invalid", source, field: "prepared_contract.approved_execution_route.route_id", expected: "approved execution route (not intake-normalize)", actual: route.route_id, message: "Intake-normalization routes cannot be published as approved execution routes." }));
    enumField(route, "step", ROUTE_STEPS, source, issues, document.status === "prepared");
    enumField(route, "source", ROUTE_SOURCES, source, issues);
    enumField(route, "readiness", READINESS_VALUES, source, issues);
  }
  if (!Number.isInteger(prepared.readiness_revision) || prepared.readiness_revision < 0) issues.push(issue({ code: "field_type_mismatch", source, field: "prepared_contract.readiness_revision", expected: "non-negative integer", actual: String(prepared.readiness_revision ?? "missing"), message: "Readiness revision must be a non-negative integer." }));
  const effects = requiredObject(prepared, "write_effects", source, issues);
  if (effects) {
    enumField(effects, "mode", DELIVERY_MODES, source, issues);
    for (const field of ["write_capable", "target_write_allowed", "upstream_writes_allowed", "direct_edits_allowed"]) {
      if (typeof effects[field] !== "boolean") issues.push(issue({ code: "field_type_mismatch", source, field: `prepared_contract.write_effects.${field}`, expected: "boolean", actual: typeof effects[field], message: `Write effect '${field}' must be boolean.` }));
    }
    if (effects.mode !== prepared.delivery_mode) issues.push(issue({ code: "enum_value_invalid", source, field: "prepared_contract.write_effects.mode", expected: String(prepared.delivery_mode), actual: String(effects.mode), message: "Write effects mode must match delivery_mode." }));
    if (prepared.delivery_mode === "no-write" && effects.write_capable === true) issues.push(issue({ code: "enum_value_invalid", source, field: "prepared_contract.write_effects.write_capable", expected: "false for no-write", actual: "true", message: "No-write preparation cannot be write-capable." }));
  }
  if (document.status === "prepared") {
    const action = requiredObject(document, "primary_action", source, issues);
    if (action && action.action_id !== "start") issues.push(issue({ code: "enum_value_invalid", source, field: "primary_action.action_id", expected: "start", actual: String(action.action_id ?? "missing"), message: "Prepared Task start is represented only by the canonical start action." }));
  }
  return issues;
}
