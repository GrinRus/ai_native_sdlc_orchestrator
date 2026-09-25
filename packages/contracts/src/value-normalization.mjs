/** @param {unknown} value @returns {string | null} */
export function asString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/** @param {unknown} value @returns {string[]} */
export function asStringArray(value) {
  return Array.isArray(value)
    ? value.filter((entry) => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim())
    : [];
}

/** @param {unknown} value @returns {Record<string, unknown>} */
export function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value)
    : {};
}

/** @param {unknown} value @returns {Record<string, unknown>} */
export function asObject(value) {
  return typeof value === "object" && value !== null
    ? /** @type {Record<string, unknown>} */ (value)
    : {};
}

/** @param {unknown} value @returns {Array<Record<string, unknown>>} */
export function asRecordArray(value) {
  return Array.isArray(value)
    ? value.filter((entry) => typeof entry === "object" && entry !== null && !Array.isArray(entry))
    : [];
}

/** @param {unknown} value @returns {number | null} */
export function asFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** @param {unknown} value @returns {boolean} */
export function asBoolean(value) {
  return value === true;
}

/** @param {unknown[]} values @returns {string[]} */
export function uniqueNonEmptyStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))];
}

/** @param {unknown[]} values @returns {string[]} */
export function uniqueNonBlankStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim().length > 0))];
}

/** @param {unknown[]} values @returns {string[]} */
export function uniqueTrimmedStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim().length > 0).map((value) => value.trim()))];
}

/** @template T @param {T[]} values @returns {T[]} */
export function uniqueValues(values) {
  return [...new Set(values)];
}

export const asNumber = asFiniteNumber;

/** @template T @param {...(T | null | undefined)} values @returns {T | null | undefined} */
export function firstNonNullish(...values) {
  const selected = values.find((value) => value !== null && value !== undefined);
  return selected === undefined ? values.at(-1) : selected;
}
