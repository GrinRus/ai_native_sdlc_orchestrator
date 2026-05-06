import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

import { CONTRACT_FAMILY_INDEX, INTAKE_SOURCE_KIND_VALUES, LIVE_E2E_OBSERVATION_STATUS_VALUES } from "./families.mjs";
import { inferFamilyFromExamplePath } from "./example-paths.mjs";
import { cloneJson, describeActualType, isExpectedType, isPlainObject, issue } from "./utils.mjs";

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

  if (family === "live-e2e-observation-report") {
    issues.push(...validateLiveE2EObservationReport(document, source));
  }

  if (family === "intake-request-body") {
    issues.push(...validateIntakeRequestBody(document, source));
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
function validateIntakeRequestBody(document, source) {
  /** @type {import("./index.d.ts").ContractValidationIssue[]} */
  const issues = [];
  const productIntake = isPlainObject(document.product_intake) ? document.product_intake : {};
  const completeness = isPlainObject(document.product_intake_completeness) ? document.product_intake_completeness : {};

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
 * @param {{ record: Record<string, unknown>, source: string, field: string, issues: import("./index.d.ts").ContractValidationIssue[] }} options
 */
function validateNestedArrayField(options) {
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
 * @param {Record<string, unknown>} document
 * @param {string} source
 * @returns {import("./index.d.ts").ContractValidationIssue[]}
 */
function validateLiveE2EObservationReport(document, source) {
  /** @type {import("./index.d.ts").ContractValidationIssue[]} */
  const issues = [];
  const codeQuality = isPlainObject(document.code_quality_after_delivery)
    ? document.code_quality_after_delivery
    : {};
  validateObservationStatusField({
    value: codeQuality.status,
    source,
    field: "code_quality_after_delivery.status",
    issues,
  });
  validateObservationMatrixStatuses({
    entries: document.step_matrix,
    source,
    field: "step_matrix",
    issues,
  });
  validateObservationMatrixStatuses({
    entries: document.artifact_quality_matrix,
    source,
    field: "artifact_quality_matrix",
    issues,
  });
  return issues;
}

/**
 * @param {{ entries: unknown, source: string, field: string, issues: import("./index.d.ts").ContractValidationIssue[] }} options
 */
function validateObservationMatrixStatuses(options) {
  if (!Array.isArray(options.entries)) return;
  options.entries.forEach((entry, index) => {
    const record = isPlainObject(entry) ? entry : {};
    validateObservationStatusField({
      value: record.status,
      source: options.source,
      field: `${options.field}[${index}].status`,
      issues: options.issues,
    });
  });
}

/**
 * @param {{ value: unknown, source: string, field: string, issues: import("./index.d.ts").ContractValidationIssue[] }} options
 */
function validateObservationStatusField(options) {
  if (typeof options.value !== "string") {
    options.issues.push(
      issue({
        code: options.value === undefined ? "required_field_missing" : "field_type_mismatch",
        source: options.source,
        field: options.field,
        expected: options.value === undefined ? "present" : "string",
        actual: options.value === undefined ? "missing" : describeActualType(options.value),
        message: `Field '${options.field}' must use live E2E observation status pass|warn|not_pass.`,
      }),
    );
    return;
  }
  if (!LIVE_E2E_OBSERVATION_STATUS_VALUES.includes(options.value)) {
    options.issues.push(
      issue({
        code: "enum_value_invalid",
        source: options.source,
        field: options.field,
        expected: LIVE_E2E_OBSERVATION_STATUS_VALUES.join("|"),
        actual: options.value,
        message: `Field '${options.field}' has unsupported value '${options.value}'.`,
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
