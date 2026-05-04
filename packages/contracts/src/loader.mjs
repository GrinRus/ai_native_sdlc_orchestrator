import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

import { CONTRACT_FAMILY_INDEX } from "./families.mjs";
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

  return {
    ok: issues.length === 0,
    family,
    source,
    issues,
  };
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
