import path from "node:path";

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
export function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @param {import("./index.d.ts").ContractFieldType} expectedType
 * @returns {boolean}
 */
export function isExpectedType(value, expectedType) {
  switch (expectedType) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "array":
      return Array.isArray(value);
    case "object":
      return isPlainObject(value);
    default:
      return false;
  }
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function describeActualType(value) {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  return typeof value;
}

/**
 * @param {{ code: import("./index.d.ts").ContractValidationIssueCode, source: string, field?: string, expected?: string, actual?: string, message: string }} params
 * @returns {import("./index.d.ts").ContractValidationIssue}
 */
export function issue({ code, source, field = null, expected = null, actual = null, message }) {
  return {
    code,
    source,
    field,
    expected,
    actual,
    message,
  };
}

/**
 * @template T
 * @param {T} value
 * @returns {T}
 */
export function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * @param {string} input
 * @returns {string}
 */
export function normalizePath(input) {
  return input.split(path.sep).join("/");
}
