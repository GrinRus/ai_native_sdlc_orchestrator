import { asRecord } from "./common.mjs";

/**
 * Runtime selection is deliberately a tiny, query-safe contract. Keeping the
 * validation here makes private profile materialization fail before any target
 * checkout or provider process is touched.
 *
 * @param {Record<string, unknown>} options
 * @returns {{ model: string | null, reasoning_effort: string | null, source: string } | null}
 */
export function resolveRuntimeSelection(options) {
  const variant = asRecord(options.providerVariant);
  const profile = asRecord(options.profile);
  const profileSelection = resolveRuntimeSelectionRecord(profile.runtime_selection, "profile.runtime_selection");
  const variantSelection = resolveRuntimeSelectionRecord(variant.runtime_selection, "provider_variant.runtime_selection");
  const selection = Object.keys(profileSelection).length > 0 ? profileSelection : variantSelection;
  const model = normalizeRuntimeSelectionValue(selection.model, "model");
  const reasoningEffort = normalizeRuntimeSelectionValue(selection.reasoning_effort, "reasoning_effort");
  if (!model && !reasoningEffort) return null;
  return {
    model,
    reasoning_effort: reasoningEffort,
    source: Object.keys(profileSelection).length > 0 ? "profile" : "provider-variant",
  };
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {Record<string, unknown>}
 */
function resolveRuntimeSelectionRecord(value, field) {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object with optional model and reasoning_effort strings.`);
  }
  const record = /** @type {Record<string, unknown>} */ (value);
  const unknownKeys = Object.keys(record).filter((key) => !["model", "reasoning_effort"].includes(key));
  if (unknownKeys.length > 0) {
    throw new Error(`${field} contains unsupported fields: ${unknownKeys.join(", ")}.`);
  }
  return record;
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {string | null}
 */
function normalizeRuntimeSelectionValue(value, field) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.trim().length === 0 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`runtime_selection.${field} must be a non-empty control-character-free string when provided.`);
  }
  return value.trim();
}
