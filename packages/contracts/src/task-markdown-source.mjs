import { validateReferenceBinding } from "./canonical-values.mjs";

/** @param {unknown} value @returns {string | null} */
export function normalizeProjectRelativeMarkdownPath(value) {
  const source = String(value ?? "").trim();
  return validateReferenceBinding({ reference: source, base: "project-relative" }).ok ? source : null;
}

/** @param {unknown} value @returns {boolean} */
export function isValidPinnedGitRevision(value) {
  return !value || /^[0-9a-f]{40}$/iu.test(String(value));
}
