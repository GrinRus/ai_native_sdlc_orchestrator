const DEFAULT_REDACTION_TEXT = "[REDACTED]";
const SENSITIVE_KEY_PATTERN = /(?:^|[_-])(?:authorization|auth[_-]?token|api[_-]?key|cookie|credential|password|secret|token)(?:$|[_-])/iu;

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function asNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function asStringArray(value) {
  return Array.isArray(value)
    ? value.map((entry) => asNonEmptyString(entry)).filter((entry) => entry !== null)
    : [];
}

/**
 * @param {string} value
 * @returns {string}
 */
function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * @param {string[]} values
 * @returns {RegExp | null}
 */
function compileSecretPattern(values) {
  const normalized = [...new Set(values.map((value) => value.trim()).filter((value) => value.length >= 4))];
  if (normalized.length === 0) {
    return null;
  }
  return new RegExp(normalized.map(escapeRegex).join("|"), "gu");
}

/**
 * @param {unknown} value
 * @returns {{ enabled: boolean, replacement: string, secretValues: string[], sensitiveKeyPattern: RegExp }}
 */
export function normalizeRedactionPolicy(value = {}) {
  const record = typeof value === "object" && value !== null ? /** @type {Record<string, unknown>} */ (value) : {};
  const replacement = asNonEmptyString(record.replacement) ?? DEFAULT_REDACTION_TEXT;
  const secretValues = asStringArray(record.secretValues ?? record.secret_values);
  return {
    enabled: record.enabled !== false,
    replacement,
    secretValues,
    sensitiveKeyPattern: SENSITIVE_KEY_PATTERN,
  };
}

/**
 * @param {string} value
 * @param {ReturnType<typeof normalizeRedactionPolicy>} policy
 * @param {boolean} sensitiveKey
 * @returns {string}
 */
function redactString(value, policy, sensitiveKey) {
  if (!policy.enabled) {
    return value;
  }
  if (sensitiveKey) {
    return policy.replacement;
  }

  const secretPattern = compileSecretPattern(policy.secretValues);
  if (!secretPattern) {
    return value;
  }
  return value.replace(secretPattern, policy.replacement);
}

/**
 * @param {unknown} value
 * @param {unknown} policyInput
 * @param {{ sensitiveKey?: boolean, seen?: WeakSet<object> }} [options]
 * @returns {unknown}
 */
export function redactSensitiveValue(value, policyInput = {}, options = {}) {
  const policy = normalizeRedactionPolicy(policyInput);
  if (!policy.enabled) {
    return value;
  }

  if (typeof value === "string") {
    return redactString(value, policy, options.sensitiveKey === true);
  }
  if (Array.isArray(value)) {
    const seen = options.seen ?? new WeakSet();
    if (seen.has(value)) {
      return "[Circular]";
    }
    seen.add(value);
    const redactedArray = value.map((entry) =>
      redactSensitiveValue(entry, policy, {
        sensitiveKey: options.sensitiveKey === true,
        seen,
      }),
    );
    seen.delete(value);
    return redactedArray;
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }

  const seen = options.seen ?? new WeakSet();
  if (seen.has(value)) {
    return "[Circular]";
  }
  seen.add(value);

  /** @type {Record<string, unknown>} */
  const redacted = {};
  for (const [key, entry] of Object.entries(/** @type {Record<string, unknown>} */ (value))) {
    const keyIsSensitive = policy.sensitiveKeyPattern.test(key);
    policy.sensitiveKeyPattern.lastIndex = 0;
    redacted[key] = redactSensitiveValue(entry, policy, {
      sensitiveKey: keyIsSensitive,
      seen,
    });
  }
  seen.delete(value);
  return redacted;
}

/**
 * @param {string | undefined} value
 * @returns {string[]}
 */
export function parseRedactionSecretList(value) {
  const raw = asNonEmptyString(value);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return asStringArray(parsed);
    }
  } catch {
    // Fall back to comma/newline parsing.
  }
  return raw
    .split(/[\n,]/u)
    .map((entry) => entry.trim())
    .filter(Boolean);
}
