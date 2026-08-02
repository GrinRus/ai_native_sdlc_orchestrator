const TYPED_EVIDENCE_FIELD = /(?:^|_)(?:ref|refs|file|files)$/u;
const KNOWN_EVIDENCE_GROUP = /(?:^|_)(?:artifact|artifacts|evidence)$/u;

/**
 * @param {string} value
 * @returns {boolean}
 */
function looksLikeEvidenceRef(value) {
  if (!value || /[\r\n]/u.test(value)) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(value)) return true;
  if (value.startsWith("/") || value.startsWith("./") || value.startsWith("../")) return true;
  if (/\s/u.test(value)) return false;
  return value.includes("/") || value.includes("\\") || /\.(?:json|jsonl|ya?ml|patch|log|txt|md)$/iu.test(value);
}

/**
 * @param {unknown} value
 * @param {{ declared?: boolean }} [context]
 * @returns {string[]}
 */
export function collectTypedEvidenceRefs(value, context = {}) {
  if (typeof value === "string") {
    const normalized = value.trim();
    return context.declared && looksLikeEvidenceRef(normalized) ? [normalized] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectTypedEvidenceRefs(entry, context));
  }
  if (typeof value !== "object" || value === null) return [];

  return Object.entries(value).flatMap(([field, entry]) => {
    const declared = TYPED_EVIDENCE_FIELD.test(field) || KNOWN_EVIDENCE_GROUP.test(field);
    return collectTypedEvidenceRefs(entry, { declared: context.declared || declared });
  });
}
