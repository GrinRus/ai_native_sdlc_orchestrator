import crypto from "node:crypto";

import { issue } from "./utils.mjs";

export const PUBLIC_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/u;
export const PUBLIC_ID_FIELDS = Object.freeze([
  "artifact_id",
  "attempt_id",
  "event_id",
  "flow_id",
  "mission_id",
  "packet_id",
  "project_id",
  "run_id",
  "step_id",
]);
export const CANONICAL_REFERENCE_BASES = Object.freeze([
  "project-relative",
  "runtime-relative",
  "evidence-relative",
  "repository-bound",
]);

const PUBLIC_ID_FIELD_SET = new Set(PUBLIC_ID_FIELDS);
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;
const WINDOWS_DRIVE_PATTERN = /^[a-zA-Z]:/u;

function invalidResult(valueClass, migration) {
  return { ok: false, value_class: valueClass, migration };
}

export function validatePublicId(value) {
  if (typeof value !== "string") {
    return invalidResult("non-string", "Supply a lowercase ASCII identifier string.");
  }
  if (value.length < 1 || value.length > 128) {
    return invalidResult("length", "Choose an identifier between 1 and 128 characters.");
  }
  if (CONTROL_CHARACTER_PATTERN.test(value)) {
    return invalidResult("control-character", "Remove CR, LF, NUL, and other control characters.");
  }
  if (value.includes("/") || value.includes("\\")) {
    return invalidResult("path-separator", "Replace path-derived identifiers with an explicit lowercase ID.");
  }
  if (WINDOWS_DRIVE_PATTERN.test(value)) {
    return invalidResult("drive-form", "Use a project identifier, not a Windows drive path.");
  }
  if (value.includes("..")) {
    return invalidResult("dot-segment", "Replace consecutive dots; identifiers are not paths.");
  }
  if (!PUBLIC_ID_PATTERN.test(value)) {
    return invalidResult(
      /[^\x00-\x7f]/u.test(value) ? "non-ascii-or-lossy-normalization" : "grammar",
      "Choose a lowercase ASCII ID matching ^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$; do not normalize invalid input.",
    );
  }
  return { ok: true, value_class: "canonical", migration: null };
}

export function derivePublicId(components, fallbackPrefix) {
  if (!Array.isArray(components) || components.length === 0) {
    throw new TypeError("Derived public IDs require at least one component.");
  }
  for (const component of components) {
    const validation = validatePublicId(component);
    if (!validation.ok) {
      throw new TypeError(`Cannot derive a public ID from ${JSON.stringify(component)} (${validation.value_class}).`);
    }
  }
  const prefixValidation = validatePublicId(fallbackPrefix);
  if (!prefixValidation.ok || fallbackPrefix.length > 94) {
    throw new TypeError("Derived public ID fallback prefixes must be canonical and at most 94 characters.");
  }
  const readable = components.join(".");
  if (validatePublicId(readable).ok) return readable;
  return `${fallbackPrefix}-${crypto.createHash("sha256").update(readable).digest("hex").slice(0, 32)}`;
}

export function validateAllowedPathPattern(value) {
  if (typeof value !== "string") {
    return invalidResult("non-string", "Supply a project-relative POSIX path pattern string.");
  }
  if (value.length === 0) {
    return invalidResult("empty", "Use an empty allowed_paths array to deny all writes.");
  }
  if (CONTROL_CHARACTER_PATTERN.test(value)) {
    return invalidResult("control-character", "Remove CR, LF, NUL, and other control characters.");
  }
  if (value.startsWith("/") || WINDOWS_DRIVE_PATTERN.test(value)) {
    return invalidResult("absolute-or-drive-path", "Use a project-relative POSIX path pattern.");
  }
  if (value.includes("\\")) {
    return invalidResult("backslash", "Use forward slashes; backslashes are not normalized.");
  }
  if (value.includes("?") || value.includes("[") || value.includes("]")) {
    return invalidResult("unsupported-glob", "Use literal segments, *, or whole-segment ** only.");
  }
  const segments = value.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    return invalidResult("empty-or-dot-segment", "Remove empty, '.', and '..' path segments.");
  }
  if (segments.some((segment) => segment.includes("**") && segment !== "**")) {
    return invalidResult("invalid-recursive-wildcard", "Use ** only as a complete path segment.");
  }
  return {
    ok: true,
    value_class: value === "**" || value === "**/*" ? "unrestricted" : "bounded",
    migration: null,
  };
}

function matchesSegment(pattern, value) {
  const escaped = pattern.replace(/[.+^${}()|\\]/gu, "\\$&").replaceAll("*", "[^/]*");
  return new RegExp(`^${escaped}$`, "u").test(value);
}

export function matchesAllowedPath(pattern, candidate) {
  if (!validateAllowedPathPattern(pattern).ok || typeof candidate !== "string") return false;
  if (
    candidate.length === 0 ||
    candidate.startsWith("/") ||
    candidate.includes("\\") ||
    CONTROL_CHARACTER_PATTERN.test(candidate) ||
    WINDOWS_DRIVE_PATTERN.test(candidate)
  ) {
    return false;
  }
  const candidateSegments = candidate.split("/");
  if (candidateSegments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) return false;
  const patternSegments = pattern.split("/");

  function visit(patternIndex, candidateIndex) {
    if (patternIndex === patternSegments.length) return candidateIndex === candidateSegments.length;
    const patternSegment = patternSegments[patternIndex];
    if (patternSegment === "**") {
      for (let next = candidateIndex; next <= candidateSegments.length; next += 1) {
        if (visit(patternIndex + 1, next)) return true;
      }
      return false;
    }
    return (
      candidateIndex < candidateSegments.length &&
      matchesSegment(patternSegment, candidateSegments[candidateIndex]) &&
      visit(patternIndex + 1, candidateIndex + 1)
    );
  }

  return visit(0, 0);
}

export function classifyAllowedPaths(value) {
  if (value === undefined) return { ok: true, state: "absent", patterns: [] };
  if (!Array.isArray(value)) return { ok: false, state: "malformed", patterns: [] };
  const validations = value.map(validateAllowedPathPattern);
  if (validations.some((entry) => !entry.ok)) return { ok: false, state: "malformed", patterns: [] };
  if (value.length === 0) return { ok: true, state: "deny-all", patterns: [] };
  if (validations.some((entry) => entry.value_class === "unrestricted")) {
    return { ok: true, state: "unrestricted", patterns: [...value] };
  }
  return { ok: true, state: "bounded", patterns: [...value] };
}

export function validateReferenceBinding({ reference, base }) {
  if (!CANONICAL_REFERENCE_BASES.includes(base)) {
    return invalidResult("missing-or-unknown-base", `Declare one canonical base: ${CANONICAL_REFERENCE_BASES.join(", ")}.`);
  }
  if (typeof reference !== "string" || reference.length === 0) {
    return invalidResult("empty-reference", "Supply a non-empty reference owned by the declared base.");
  }
  if (base === "evidence-relative") {
    return reference.startsWith("evidence://")
      ? { ok: true, value_class: "evidence-uri", migration: null }
      : invalidResult("evidence-scheme", "Use an evidence:// reference for evidence-relative bindings.");
  }
  const pathValidation = validateAllowedPathPattern(reference);
  if (!pathValidation.ok || reference.includes("*")) {
    return invalidResult("non-canonical-relative-reference", "Use a literal relative POSIX path with the declared base.");
  }
  return { ok: true, value_class: base, migration: null };
}

export function validateCanonicalContractValues(document, source) {
  const issues = [];

  function visit(value, field) {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(entry, `${field}[${index}]`));
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, entry] of Object.entries(value)) {
      const entryField = field ? `${field}.${key}` : key;
      if ((PUBLIC_ID_FIELD_SET.has(key) || key.endsWith("_id")) && entry !== null) {
        const validation = validatePublicId(entry);
        if (!validation.ok) {
          issues.push(
            issue({
              code: "identifier_format_invalid",
              source,
              field: entryField,
              expected: "canonical lowercase ASCII public identifier",
              actual: `${validation.value_class}: ${JSON.stringify(entry)}`,
              message: `Field '${entryField}' rejects ${validation.value_class} identifier ${JSON.stringify(entry)}. ${validation.migration}`,
            }),
          );
        }
      }
      if (key.endsWith("_ids") && Array.isArray(entry)) {
        entry.forEach((identifier, index) => {
          const validation = validatePublicId(identifier);
          if (!validation.ok) {
            issues.push(
              issue({
                code: "identifier_format_invalid",
                source,
                field: `${entryField}[${index}]`,
                expected: "canonical lowercase ASCII public identifier",
                actual: `${validation.value_class}: ${JSON.stringify(identifier)}`,
                message: `Field '${entryField}[${index}]' rejects ${validation.value_class} identifier ${JSON.stringify(identifier)}. ${validation.migration}`,
              }),
            );
          }
        });
      }
      if ((key === "allowed_paths" || key === "forbidden_paths") && !Array.isArray(entry)) {
        issues.push(
          issue({
            code: "path_scope_invalid",
            source,
            field: entryField,
            expected: "array of canonical project-relative POSIX path patterns",
            actual: typeof entry,
            message: `Field '${entryField}' rejects malformed path scope ${JSON.stringify(entry)}. Supply an array; use [] to deny all writes.`,
          }),
        );
      }
      if ((key === "allowed_paths" || key === "forbidden_paths") && Array.isArray(entry)) {
        entry.forEach((pattern, index) => {
          const validation = validateAllowedPathPattern(pattern);
          if (!validation.ok) {
            issues.push(
              issue({
                code: "path_scope_invalid",
                source,
                field: `${entryField}[${index}]`,
                expected: "project-relative POSIX path pattern using literal segments, *, or **",
                actual: `${validation.value_class}: ${JSON.stringify(pattern)}`,
                message: `Field '${entryField}[${index}]' rejects ${validation.value_class} scope ${JSON.stringify(pattern)}. ${validation.migration}`,
              }),
            );
          }
        });
      }
      visit(entry, entryField);
    }
  }

  visit(document, "");
  return issues;
}
