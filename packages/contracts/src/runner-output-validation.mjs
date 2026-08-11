import { describeActualType, isPlainObject, issue } from "./utils.mjs";

const PARSE_STATUS_VALUES = ["valid", "missing", "malformed", "ambiguous", "unsupported"];
export const RUNNER_OUTPUT_MODE_VALUES = Object.freeze(["structured-json", "stream-json", "jsonl-terminal-event"]);
const FAILURE_CLASS_BY_KIND = Object.freeze({
  "runner-output-missing": "schema-mismatch",
  "runner-output-malformed": "schema-mismatch",
  "runner-output-ambiguous": "schema-mismatch",
  "runner-output-unsupported": "schema-mismatch",
  "runner-result-partial": "incomplete-result",
  "runner-evidence-missing": "missing-evidence",
  "runner-verification-missing": "verification-missing",
  "runner-verification-contradiction": "verification-contradiction",
  "runner-validation-command-failed": "validation-commands-failed",
});
const FORBIDDEN_KEYS = new Set([
  "prompt", "prompts", "credentials", "credential", "password", "token", "api_key",
  "tool_arguments", "tool_args", "transcript", "transcripts", "runner_home", "runner-home",
  "local_runner_home", "local-runner-home", "environment_values", "env_values",
]);

function nestedString(record, field, source, issues, required = false) {
  if (!(field in record)) {
    if (required) issues.push(issue({ code: "required_field_missing", source, field, expected: "string", actual: "missing", message: `Missing required field '${field}'.` }));
    return;
  }
  if (typeof record[field] !== "string") issues.push(issue({ code: "field_type_mismatch", source, field, expected: "string", actual: describeActualType(record[field]), message: `Field '${field}' must be 'string'.` }));
}

function nestedEnum(record, field, allowed, source, issues, required = false) {
  nestedString(record, field, source, issues, required);
  if (typeof record[field] === "string" && !allowed.includes(record[field])) {
    issues.push(issue({ code: "enum_value_invalid", source, field, expected: allowed.join("|"), actual: record[field], message: `Field '${field}' has unsupported value '${record[field]}'.` }));
  }
}

function nestedNumber(record, field, source, issues, required = false) {
  if (!(field in record)) {
    if (required) issues.push(issue({ code: "required_field_missing", source, field, expected: "number", actual: "missing", message: `Missing required field '${field}'.` }));
    return;
  }
  if (typeof record[field] !== "number" || !Number.isFinite(record[field])) issues.push(issue({ code: "field_type_mismatch", source, field, expected: "number", actual: describeActualType(record[field]), message: `Field '${field}' must be 'number'.` }));
}

function optionalObject(record, field, source, issues, allowNull = false) {
  if (!(field in record)) return null;
  if (allowNull && record[field] === null) return null;
  if (!isPlainObject(record[field])) {
    issues.push(issue({ code: "field_type_mismatch", source, field, expected: allowNull ? "object|null" : "object", actual: describeActualType(record[field]), message: `Field '${field}' must be an object${allowNull ? " or null" : ""}.` }));
    return null;
  }
  return record[field];
}

function optionalStringArray(record, field, source, issues) {
  if (!(field in record)) return null;
  if (!Array.isArray(record[field])) {
    issues.push(issue({ code: "field_type_mismatch", source, field, expected: "array", actual: describeActualType(record[field]), message: `Field '${field}' must be 'array'.` }));
    return null;
  }
  record[field].forEach((entry, index) => {
    if (typeof entry === "string") return;
    issues.push(issue({ code: "field_type_mismatch", source, field: `${field}[${index}]`, expected: "string", actual: describeActualType(entry), message: `Field '${field}[${index}]' must be 'string'.` }));
  });
  return record[field];
}

function collectForbidden(value, prefix, source, issues) {
  if (!isPlainObject(value)) return;
  for (const [key, nested] of Object.entries(value)) {
    const normalized = key.toLowerCase().replace(/-/gu, "_");
    const field = prefix ? `${prefix}.${key}` : key;
    if (FORBIDDEN_KEYS.has(key) || FORBIDDEN_KEYS.has(normalized)) {
      issues.push(issue({ code: "unsupported_field_present", source, field, expected: "query-safe field omitted", actual: "present", message: `Runner output cannot expose '${field}'.` }));
      continue;
    }
    if (isPlainObject(nested)) collectForbidden(nested, field, source, issues);
    if (Array.isArray(nested)) nested.forEach((entry, index) => isPlainObject(entry) && collectForbidden(entry, `${field}[${index}]`, source, issues));
  }
}

export function validateRunnerOutputEnvelope(document, source) {
  const issues = [];
  if (document.schema_version !== 1) issues.push(issue({ code: "enum_value_invalid", source, field: "schema_version", expected: "1", actual: String(document.schema_version), message: "runner-output-envelope must use schema_version=1." }));
  if (typeof document.requested_schema_ref !== "string" || !/^[A-Za-z0-9._-]+@v\d+$/u.test(document.requested_schema_ref)) issues.push(issue({ code: "field_type_mismatch", source, field: "requested_schema_ref", expected: "<family>@v<integer>", actual: describeActualType(document.requested_schema_ref), message: "requested_schema_ref must name exactly one versioned candidate family." }));
  if (typeof document.parse_status === "string" && !PARSE_STATUS_VALUES.includes(document.parse_status)) issues.push(issue({ code: "enum_value_invalid", source, field: "parse_status", expected: PARSE_STATUS_VALUES.join("|"), actual: document.parse_status, message: `parse_status '${document.parse_status}' is not supported.` }));

  const candidate = document.candidate;
  if (candidate !== null && !isPlainObject(candidate)) issues.push(issue({ code: "field_type_mismatch", source, field: "candidate", expected: "object|null", actual: describeActualType(candidate), message: "candidate must contain one object or null." }));
  if (document.parse_status === "valid" && !isPlainObject(candidate)) issues.push(issue({ code: "field_type_mismatch", source, field: "candidate", expected: "exactly one object when parse_status=valid", actual: describeActualType(candidate), message: "A valid envelope must contain exactly one candidate object." }));
  if (document.parse_status !== "valid" && candidate !== null) issues.push(issue({ code: "unsupported_field_present", source, field: "candidate", expected: "null when parse_status is not valid", actual: "object", message: "Non-valid parse statuses cannot carry an accepted candidate." }));
  if (isPlainObject(candidate)) {
    const bytes = Buffer.byteLength(JSON.stringify(candidate), "utf8");
    if (bytes > 65536) issues.push(issue({ code: "field_type_mismatch", source, field: "candidate", expected: "UTF-8 JSON <= 65536 bytes", actual: `${bytes} bytes`, message: "candidate exceeds the strict query-safe size bound." }));
    collectForbidden(candidate, "candidate", source, issues);
  }

  const normalizedIssues = Array.isArray(document.normalized_issues) ? document.normalized_issues : [];
  if (normalizedIssues.length > 64) issues.push(issue({ code: "field_type_mismatch", source, field: "normalized_issues", expected: "array with at most 64 entries", actual: String(normalizedIssues.length), message: "normalized_issues is bounded to 64 entries." }));
  normalizedIssues.forEach((entry, index) => {
    const field = `normalized_issues[${index}]`;
    if (!isPlainObject(entry)) {
      issues.push(issue({ code: "field_type_mismatch", source, field, expected: "object", actual: describeActualType(entry), message: "Each normalized issue must be an object." }));
      return;
    }
    for (const name of ["issue_code", "failure_kind", "failure_class", "summary"]) nestedString(entry, name, source, issues, true);
    const expectedClass = FAILURE_CLASS_BY_KIND[entry.failure_kind];
    if (!expectedClass) issues.push(issue({ code: "enum_value_invalid", source, field: `${field}.failure_kind`, expected: Object.keys(FAILURE_CLASS_BY_KIND).join("|"), actual: String(entry.failure_kind), message: "Unknown runner failure kinds fail closed." }));
    else if (entry.failure_class !== expectedClass) issues.push(issue({ code: "enum_value_invalid", source, field: `${field}.failure_class`, expected: expectedClass, actual: String(entry.failure_class), message: `failure_class must map uniquely from '${entry.failure_kind}'.` }));
    optionalStringArray(entry, "evidence_refs", source, issues);
    collectForbidden(entry, field, source, issues);
  });
  if (typeof document.raw_evidence_ref !== "string" || !document.raw_evidence_ref.startsWith("evidence://")) issues.push(issue({ code: "field_type_mismatch", source, field: "raw_evidence_ref", expected: "evidence:// reference", actual: describeActualType(document.raw_evidence_ref), message: "raw_evidence_ref must point to immutable evidence." }));
  if (document.query_safe !== true) issues.push(issue({ code: "enum_value_invalid", source, field: "query_safe", expected: "true", actual: String(document.query_safe), message: "runner-output-envelope must be query-safe." }));
  return issues;
}

export function validateRunnerFinalReport(document, source) {
  const issues = [];
  if (document.schema_version !== 1) issues.push(issue({ code: "enum_value_invalid", source, field: "schema_version", expected: "1", actual: String(document.schema_version), message: "runner-final-report must use schema_version=1." }));
  nestedEnum(document, "status", ["blocked", "completed", "partial"], source, issues, true);
  nestedString(document, "summary", source, issues, true);
  if (!("changed_files" in document)) issues.push(issue({ code: "required_field_missing", source, field: "changed_files", expected: "array", actual: "missing", message: "Missing required field 'changed_files'." }));
  else if (!Array.isArray(document.changed_files)) issues.push(issue({ code: "field_type_mismatch", source, field: "changed_files", expected: "array", actual: describeActualType(document.changed_files), message: "Field 'changed_files' must be 'array'." }));
  if (!("command_result_claims" in document)) issues.push(issue({ code: "required_field_missing", source, field: "command_result_claims", expected: "array", actual: "missing", message: "Missing required field 'command_result_claims'." }));
  else if (!Array.isArray(document.command_result_claims)) issues.push(issue({ code: "field_type_mismatch", source, field: "command_result_claims", expected: "array", actual: describeActualType(document.command_result_claims), message: "Field 'command_result_claims' must be 'array'." }));
  if (!("verification" in document)) issues.push(issue({ code: "required_field_missing", source, field: "verification", expected: "object", actual: "missing", message: "Missing required field 'verification'." }));
  else if (!isPlainObject(document.verification)) issues.push(issue({ code: "field_type_mismatch", source, field: "verification", expected: "object", actual: describeActualType(document.verification), message: "Field 'verification' must be 'object'." }));
  if (!("risks" in document)) issues.push(issue({ code: "required_field_missing", source, field: "risks", expected: "array", actual: "missing", message: "Missing required field 'risks'." }));
  else if (!Array.isArray(document.risks)) issues.push(issue({ code: "field_type_mismatch", source, field: "risks", expected: "array", actual: describeActualType(document.risks), message: "Field 'risks' must be 'array'." }));
  if (document.repair_closure === undefined) issues.push(issue({ code: "required_field_missing", source, field: "repair_closure", expected: "object|null", actual: "missing", message: "repair_closure must be present, even when null." }));
  else if (document.repair_closure !== null && !isPlainObject(document.repair_closure)) issues.push(issue({ code: "field_type_mismatch", source, field: "repair_closure", expected: "object|null", actual: describeActualType(document.repair_closure), message: "repair_closure must be an object or null." }));
  for (const field of ["public_ids", "report_id", "run_id", "step_id", "timestamp", "timestamps", "created_at", "updated_at", "evidence_refs", "validation_status", "aggregate_status", "qualification_verdict"]) {
    if (field in document) issues.push(issue({ code: "unsupported_field_present", source, field, expected: "field omitted from model-authored candidate", actual: "present", message: `Runner final-report candidates cannot author '${field}'.` }));
  }
  collectForbidden(document, "", source, issues);
  return issues;
}

export function validateProviderWorkPacket(document, source) {
  const issues = [];
  if (document.packet_kind !== "aor-provider-work-packet") issues.push(issue({ code: "enum_value_invalid", source, field: "packet_kind", expected: "aor-provider-work-packet", actual: String(document.packet_kind), message: "Strict provider packets must use the AOR packet kind." }));
  if (document.version !== 3) issues.push(issue({ code: "enum_value_invalid", source, field: "version", expected: "3", actual: String(document.version), message: "This contract family validates provider work-packet v3 only." }));
  const output = optionalObject(document, "output_contract", source, issues);
  if (!output) return issues;
  nestedString(output, "schema_ref", source, issues, true);
  if (typeof output.schema_ref === "string" && !/^[A-Za-z0-9._-]+@v\d+$/u.test(output.schema_ref)) issues.push(issue({ code: "field_type_mismatch", source, field: "output_contract.schema_ref", expected: "<family>@v<integer>", actual: output.schema_ref, message: "output_contract.schema_ref must be one exact versioned candidate family." }));
  nestedEnum(output, "output_mode", RUNNER_OUTPUT_MODE_VALUES, source, issues, true);
  nestedString(output, "candidate_rule", source, issues, true);
  if (output.candidate_rule !== "exactly-one-candidate") issues.push(issue({ code: "enum_value_invalid", source, field: "output_contract.candidate_rule", expected: "exactly-one-candidate", actual: String(output.candidate_rule), message: "Strict packets require exactly one candidate." }));
  nestedNumber(output, "max_candidate_bytes", source, issues, true);
  if (output.max_candidate_bytes !== 65536) issues.push(issue({ code: "enum_value_invalid", source, field: "output_contract.max_candidate_bytes", expected: "65536", actual: String(output.max_candidate_bytes), message: "Strict candidate output is bounded to 65,536 bytes." }));
  const sections = optionalStringArray(output, "required_sections", source, issues);
  if (!("required_sections" in output)) issues.push(issue({ code: "required_field_missing", source, field: "output_contract.required_sections", expected: "array", actual: "missing", message: "Missing required field 'output_contract.required_sections'." }));
  if (sections && new Set(sections).size !== sections.length) issues.push(issue({ code: "field_type_mismatch", source, field: "output_contract.required_sections", expected: "unique section names", actual: "duplicate entries", message: "required_sections must be unique." }));
  const statuses = optionalStringArray(output, "status_vocabulary", source, issues);
  if (!("status_vocabulary" in output)) issues.push(issue({ code: "required_field_missing", source, field: "output_contract.status_vocabulary", expected: "array", actual: "missing", message: "Missing required field 'output_contract.status_vocabulary'." }));
  if (statuses && JSON.stringify([...statuses].sort()) !== JSON.stringify(["blocked", "completed", "partial"])) issues.push(issue({ code: "field_type_mismatch", source, field: "output_contract.status_vocabulary", expected: "blocked|completed|partial", actual: statuses.join("|"), message: "runner-final-report status vocabulary must be complete and exact." }));
  const commands = Array.isArray(output.required_commands) ? output.required_commands : [];
  if (!("required_commands" in output)) issues.push(issue({ code: "required_field_missing", source, field: "output_contract.required_commands", expected: "array", actual: "missing", message: "Missing required field 'output_contract.required_commands'." }));
  const ids = [];
  const values = [];
  commands.forEach((entry, index) => {
    const field = `output_contract.required_commands[${index}]`;
    if (!isPlainObject(entry)) {
      issues.push(issue({ code: "field_type_mismatch", source, field, expected: "object", actual: describeActualType(entry), message: "Required command entries must be objects." }));
      return;
    }
    nestedString(entry, "command_id", source, issues, true);
    nestedString(entry, "command", source, issues, true);
    if (typeof entry.command_id === "string") {
      ids.push(entry.command_id);
      if (!/^aor\.command\.[a-z0-9][a-z0-9._-]*$/u.test(entry.command_id)) issues.push(issue({ code: "field_type_mismatch", source, field: `${field}.command_id`, expected: "aor.command.<environment>.<stable-name>", actual: entry.command_id, message: "required command identities must be AOR-owned and environment-qualified." }));
    }
    if (typeof entry.command === "string") values.push(entry.command);
  });
  if (new Set(ids).size !== ids.length || new Set(values).size !== values.length) issues.push(issue({ code: "field_type_mismatch", source, field: "output_contract.required_commands", expected: "unique command_id and command pairs", actual: "duplicate entries", message: "Required commands must map one-to-one." }));
  const execution = isPlainObject(document.execution_contract) ? document.execution_contract : null;
  const controllerCommands = execution && Array.isArray(execution.required_commands) ? execution.required_commands.filter((value) => typeof value === "string") : [];
  if (JSON.stringify([...controllerCommands].sort()) !== JSON.stringify([...values].sort())) issues.push(issue({ code: "field_type_mismatch", source, field: "output_contract.required_commands", expected: "one-to-one match with execution_contract.required_commands", actual: "command set mismatch", message: "Provider packet command identities must map to controller-owned commands." }));
  return issues;
}

export function validateExecutionOutcome(value, source) {
  const issues = [];
  if (value === undefined) return issues;
  if (!isPlainObject(value)) {
    issues.push(issue({ code: "field_type_mismatch", source, field: "execution_outcome", expected: "object", actual: describeActualType(value), message: "execution_outcome must be an object when present." }));
    return issues;
  }
  if (value.schema_version !== 1) issues.push(issue({ code: "enum_value_invalid", source, field: "execution_outcome.schema_version", expected: "1", actual: String(value.schema_version), message: "execution_outcome must use schema_version=1." }));
  const statuses = {
    process: ["completed", "failed", "blocked", "unknown"], transport: ["completed", "failed", "blocked", "unknown"],
    provider: ["completed", "partial", "failed", "blocked", "unknown"], parsing: PARSE_STATUS_VALUES,
    candidate: ["accepted", "rejected", "missing", "ambiguous"], validation: ["pass", "warn", "fail", "blocked"],
    verification: ["pass", "warn", "fail", "missing", "blocked"], mission: ["satisfied", "not_satisfied", "not_applicable", "unknown"],
  };
  for (const [field, allowed] of Object.entries(statuses)) {
    if (!(field in value)) {
      issues.push(issue({ code: "required_field_missing", source, field: `execution_outcome.${field}`, expected: "object", actual: "missing", message: `execution_outcome.${field} is required when execution_outcome is present.` }));
      continue;
    }
    const member = optionalObject(value, field, source, issues);
    if (member) nestedEnum(member, "status", allowed, source, issues, true);
  }
  return issues;
}
