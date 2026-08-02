import { describeActualType, isPlainObject, issue } from "./utils.mjs";

const DIMENSION_KEYS = [
  "public_lifecycle",
  "run_health",
  "diagnostic_verification",
  "final_assessment",
  "changed_paths",
  "checkout_integrity",
  "delivery_safety",
];
const STATUS_VALUES = ["pass", "warn", "blocked", "fail"];

function invalid(options) {
  return issue({
    code: options.code,
    source: options.source,
    field: options.field,
    expected: options.expected,
    actual: options.actual,
    message: options.message,
  });
}

function requireString(record, field, displayField, source, issues) {
  if (typeof record[field] !== "string" || record[field].length === 0) {
    issues.push(invalid({
      code: record[field] === undefined ? "required_field_missing" : "field_type_mismatch",
      source,
      field: displayField,
      expected: "non-empty string",
      actual: record[field] === undefined ? "missing" : describeActualType(record[field]),
      message: `Field '${displayField}' must be a non-empty string.`,
    }));
  }
}

/**
 * @param {Record<string, unknown>} document
 * @param {string} source
 */
export function validateQualificationCellReport(document, source) {
  const issues = [];
  if (document.schema_version !== 1) {
    issues.push(invalid({
      code: "enum_value_invalid", source, field: "schema_version", expected: "1",
      actual: String(document.schema_version), message: "Qualification cell report schema_version must be 1.",
    }));
  }
  if (!["openai-primary", "anthropic-primary"].includes(document.provider_variant_id)) {
    issues.push(invalid({
      code: "enum_value_invalid", source, field: "provider_variant_id",
      expected: "openai-primary|anthropic-primary", actual: String(document.provider_variant_id),
      message: "Qualification provider must be one of the two required primary providers.",
    }));
  }
  if (!["medium", "large"].includes(document.feature_size)) {
    issues.push(invalid({
      code: "enum_value_invalid", source, field: "feature_size", expected: "medium|large",
      actual: String(document.feature_size), message: "Qualification feature size must be medium or large.",
    }));
  }
  const expectedCellId = `${document.provider_variant_id}.${document.feature_size}`;
  if (document.cell_id !== expectedCellId) {
    issues.push(invalid({
      code: "qualification_cell_identity_mismatch", source, field: "cell_id", expected: expectedCellId,
      actual: String(document.cell_id), message: "Qualification cell_id must be the exact provider and size pair.",
    }));
  }
  const dimensions = isPlainObject(document.dimensions) ? document.dimensions : {};
  for (const key of DIMENSION_KEYS) {
    const dimension = isPlainObject(dimensions[key]) ? dimensions[key] : null;
    if (!dimension) {
      issues.push(invalid({
        code: dimensions[key] === undefined ? "required_field_missing" : "field_type_mismatch",
        source, field: `dimensions.${key}`, expected: "object",
        actual: dimensions[key] === undefined ? "missing" : describeActualType(dimensions[key]),
        message: `Qualification dimension '${key}' is required.`,
      }));
      continue;
    }
    if (!STATUS_VALUES.includes(dimension.status)) {
      issues.push(invalid({
        code: "enum_value_invalid", source, field: `dimensions.${key}.status`,
        expected: STATUS_VALUES.join("|"), actual: String(dimension.status),
        message: `Qualification dimension '${key}' has an unsupported status.`,
      }));
    }
    if (!Array.isArray(dimension.evidence_refs) || dimension.evidence_refs.some((ref) => typeof ref !== "string")) {
      issues.push(invalid({
        code: "field_type_mismatch", source, field: `dimensions.${key}.evidence_refs`,
        expected: "string array", actual: describeActualType(dimension.evidence_refs),
        message: `Qualification dimension '${key}' must cite a string evidence-ref array.`,
      }));
    }
  }
  for (const field of ["observations", "positive_evidence", "warnings", "blocking_findings"]) {
    for (const [index, entry] of (Array.isArray(document[field]) ? document[field] : []).entries()) {
      if (!isPlainObject(entry)) {
        issues.push(invalid({
          code: "field_type_mismatch", source, field: `${field}[${index}]`, expected: "object",
          actual: describeActualType(entry), message: `Taxonomy entry '${field}[${index}]' must be an object.`,
        }));
      }
    }
  }
  for (const [index, entry] of (Array.isArray(document.evidence) ? document.evidence : []).entries()) {
    if (!isPlainObject(entry)) continue;
    for (const field of ["kind", "ref", "digest", "owner", "generated_at", "run_id"]) {
      requireString(entry, field, `evidence[${index}].${field}`, source, issues);
    }
    if (typeof entry.digest === "string" && !/^sha256:[0-9a-f]{64}$/u.test(entry.digest)) {
      issues.push(invalid({
        code: "qualification_evidence_digest_invalid", source, field: `evidence[${index}].digest`,
        expected: "sha256:<64 lowercase hex characters>", actual: entry.digest,
        message: "Qualification evidence must be content-addressed with SHA-256.",
      }));
    }
    if (entry.run_id !== document.run_id) {
      issues.push(invalid({
        code: "qualification_evidence_wrong_run", source, field: `evidence[${index}].run_id`,
        expected: String(document.run_id), actual: String(entry.run_id),
        message: "Qualification evidence must belong to the exact qualified run.",
      }));
    }
    const evidenceTime = Date.parse(String(entry.generated_at));
    const reportTime = Date.parse(String(document.generated_at));
    if (!Number.isFinite(evidenceTime) || !Number.isFinite(reportTime) || evidenceTime > reportTime) {
      issues.push(invalid({
        code: "qualification_evidence_freshness_invalid", source, field: `evidence[${index}].generated_at`,
        expected: "valid timestamp not newer than report", actual: String(entry.generated_at),
        message: "Qualification evidence freshness must be provable within the report chronology.",
      }));
    }
  }
  if (typeof document.commit_sha === "string" && !/^[0-9a-f]{40}$/u.test(document.commit_sha)) {
    issues.push(invalid({
      code: "qualification_commit_invalid", source, field: "commit_sha",
      expected: "full 40-character git commit SHA", actual: document.commit_sha,
      message: "Qualification cells must pin one full immutable commit identity.",
    }));
  }
  if (document.status === "pass") {
    for (const key of DIMENSION_KEYS) {
      if (isPlainObject(dimensions[key]) && dimensions[key].status !== "pass") {
        issues.push(invalid({
          code: "qualification_pass_contradiction", source, field: `dimensions.${key}.status`,
          expected: "pass", actual: String(dimensions[key].status),
          message: "A passing qualification cell requires every independent dimension to pass.",
        }));
      }
    }
    if (Array.isArray(document.blocking_findings) && document.blocking_findings.length > 0) {
      issues.push(invalid({
        code: "qualification_pass_contradiction", source, field: "blocking_findings",
        expected: "empty array", actual: `${document.blocking_findings.length} entries`,
        message: "A passing qualification cell cannot retain blocking findings.",
      }));
    }
  }
  return issues;
}
