export const LIFECYCLE_COMMANDS = Object.freeze([
  "project init",
  "intake create",
  "mission create",
  "next",
  "discovery run",
  "spec build",
  "wave create",
  "handoff prepare",
  "handoff approve",
  "run start",
  "run pause",
  "run resume",
  "run steer",
  "run cancel",
  "review run",
  "review decide",
  "deliver prepare",
  "release prepare",
  "learning handoff",
]);

export const GUIDED_STAGE_DEFINITIONS = Object.freeze([
  {
    stage_id: "readiness",
    label: "Readiness",
    stage_keys: ["onboarding"],
    default_command: "project init",
  },
  {
    stage_id: "mission",
    label: "Mission",
    stage_keys: ["mission-intake"],
    default_command: "mission create",
  },
  {
    stage_id: "discovery-spec-plan",
    label: "Discovery, Spec, Plan",
    stage_keys: ["discovery", "spec-build", "planning"],
    default_command: "discovery run",
  },
  {
    stage_id: "execution",
    label: "Execution",
    stage_keys: ["run-active", "execution"],
    default_command: "run start",
  },
  {
    stage_id: "review-qa",
    label: "Review and QA",
    stage_keys: ["review", "qa"],
    default_command: "review run",
  },
  {
    stage_id: "delivery-release",
    label: "Delivery and Release",
    stage_keys: ["delivery", "release"],
    default_command: "deliver prepare",
  },
  {
    stage_id: "learning",
    label: "Learning",
    stage_keys: ["learning"],
    default_command: "learning handoff",
  },
]);

/**
 * @param {unknown} value
 * @returns {string | null}
 */
export function asString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
export function asNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * @param {unknown} value
 * @returns {Array<unknown>}
 */
export function asArray(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * @param {string} value
 * @returns {string}
 */
export function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * @param {string} runRef
 * @returns {string}
 */
export function normalizeRunRef(runRef) {
  return runRef.startsWith("run://") ? runRef.slice("run://".length) : runRef;
}

/**
 * @param {string} value
 * @returns {string}
 */
export function normalizeId(value) {
  const normalized = [];
  let previousWasReplacement = false;
  for (const char of value.toLowerCase()) {
    const code = char.charCodeAt(0);
    const allowed =
      (code >= 97 && code <= 122) ||
      (code >= 48 && code <= 57) ||
      char === "." ||
      char === "_" ||
      char === "-";
    if (allowed) {
      normalized.push(char);
      previousWasReplacement = false;
      continue;
    }
    if (!previousWasReplacement) {
      normalized.push("-");
      previousWasReplacement = true;
    }
  }

  let start = 0;
  let end = normalized.length;
  while (start < end && normalized[start] === "-") start += 1;
  while (end > start && normalized[end - 1] === "-") end -= 1;
  return normalized.slice(start, end).join("");
}

/**
 * @param {string | undefined} value
 * @returns {boolean}
 */
export function isRunTokenBoundary(value) {
  return value === undefined || value === "." || value === "_" || value === "-" || value === ":";
}

/**
 * @param {string} value
 * @param {string} runId
 * @returns {boolean}
 */
export function containsRunToken(value, runId) {
  const normalizedValue = normalizeId(value);
  const normalizedRunId = normalizeId(runId);
  if (!normalizedValue || !normalizedRunId) return false;
  if (normalizedValue === normalizedRunId) return true;
  let index = normalizedValue.indexOf(normalizedRunId);
  while (index !== -1) {
    const before = index === 0 ? undefined : normalizedValue[index - 1];
    const afterIndex = index + normalizedRunId.length;
    const after = afterIndex >= normalizedValue.length ? undefined : normalizedValue[afterIndex];
    if (isRunTokenBoundary(before) && isRunTokenBoundary(after)) {
      return true;
    }
    index = normalizedValue.indexOf(normalizedRunId, index + 1);
  }
  return false;
}

/**
 * @param {unknown[]} values
 * @returns {string[]}
 */
export function uniqueStrings(values) {
  return Array.from(
    new Set(values.filter((value) => typeof value === "string" && value.trim().length > 0).map((value) => value.trim())),
  );
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
export function asStringArray(value) {
  return Array.isArray(value)
    ? value.filter((entry) => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim())
    : [];
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
export function asRecord(value) {
  return typeof value === "object" && value !== null ? /** @type {Record<string, unknown>} */ (value) : {};
}

/**
 * @param {unknown} metric
 * @returns {string}
 */
export function formatPlannerMetric(metric) {
  const record = asRecord(metric);
  const value = typeof record.value === "number" ? record.value : null;
  const numerator = typeof record.numerator === "number" ? record.numerator : null;
  const denominator = typeof record.denominator === "number" ? record.denominator : null;
  if (value === null || denominator === null || denominator === 0) {
    return "no-data";
  }
  return `${Math.round(value * 100)}% (${numerator ?? 0}/${denominator})`;
}
