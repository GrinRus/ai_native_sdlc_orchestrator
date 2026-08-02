import fs from "node:fs";
import path from "node:path";

import { parse as parseYaml } from "yaml";

export class UsageError extends Error {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(message);
    this.name = "UsageError";
  }
}

/**
 * @returns {string}
 */
export function nowIso() {
  return new Date().toISOString();
}

/**
 * @param {string} value
 * @returns {string}
 */
export function normalizeId(value) {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

export function deriveRuntimeRunId(qualificationRunId, iteration = 1) {
  const base = normalizeId(qualificationRunId);
  return iteration === 1 ? base : `${base}.repair-${iteration}`;
}

/**
 * @param {string} filePath
 * @param {Record<string, unknown>} document
 */
export function writeJson(filePath, document) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
}

/**
 * @param {string} filePath
 * @returns {Record<string, unknown>}
 */
export function readJson(filePath) {
  return /** @type {Record<string, unknown>} */ (JSON.parse(fs.readFileSync(filePath, "utf8")));
}

/**
 * @param {string} filePath
 * @returns {Record<string, unknown>}
 */
export function readYamlDocument(filePath) {
  return /** @type {Record<string, unknown>} */ (parseYaml(fs.readFileSync(filePath, "utf8")));
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
export function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value)
    : {};
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function asNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : "";
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
 * @param {number} fallback
 * @returns {number}
 */
export function asPositiveInteger(value, fallback) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  const rounded = Math.floor(value);
  return rounded > 0 ? rounded : fallback;
}

/**
 * @param {unknown} value
 * @returns {Record<string, string>}
 */
export function asStringMap(value) {
  const record = asRecord(value);
  const entries = Object.entries(record).filter(
    ([key, entry]) => typeof key === "string" && typeof entry === "string" && entry.trim().length > 0,
  );
  return Object.fromEntries(entries.map(([key, entry]) => [key, entry.trim()]));
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function hasNonEmptyPermissionDenials(value) {
  if (Array.isArray(value)) {
    return value.some((entry) => hasNonEmptyPermissionDenials(entry));
  }

  const record = asRecord(value);
  const entries = Object.entries(record);
  if (entries.length === 0) {
    return false;
  }

  const permissionDenials = record.permission_denials;
  if (Array.isArray(permissionDenials) && permissionDenials.length > 0) {
    return true;
  }

  return entries.some(([, entry]) => hasNonEmptyPermissionDenials(entry));
}

/**
 * @param {string} stdout
 * @returns {boolean}
 */
export function stdoutHasStructuredPermissionDenials(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return false;
  }

  try {
    return hasNonEmptyPermissionDenials(JSON.parse(trimmed));
  } catch {
    // Try JSONL below.
  }

  const lines = trimmed.split(/\r?\n/u).filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return false;
  }

  for (const line of lines) {
    try {
      if (hasNonEmptyPermissionDenials(JSON.parse(line))) {
        return true;
      }
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * @param {string[]} values
 * @returns {string[]}
 */
export function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))];
}

/**
 * @param {string[]} args
 * @returns {Record<string, string | true>}
 */
export function parseFlags(args) {
  /** @type {Record<string, string | true>} */
  const flags = {};

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (!current.startsWith("--")) {
      throw new UsageError(`Unexpected argument '${current}'. Flags must use --name <value>.`);
    }

    const [rawName, inlineValue] = current.split("=", 2);
    const flagName = rawName.slice(2);
    if (!flagName) {
      throw new UsageError(`Invalid flag '${current}'.`);
    }
    if (Object.prototype.hasOwnProperty.call(flags, flagName)) {
      throw new UsageError(`Duplicate flag '--${flagName}'.`);
    }

    if (inlineValue !== undefined) {
      flags[flagName] = inlineValue;
      continue;
    }

    const next = args[index + 1];
    if (next && !next.startsWith("--")) {
      flags[flagName] = next;
      index += 1;
      continue;
    }

    flags[flagName] = true;
  }

  return flags;
}

/**
 * @param {string | true | undefined} value
 * @param {string} flagName
 * @returns {string | null}
 */
export function resolveOptionalStringFlag(value, flagName) {
  if (value === undefined) {
    return null;
  }
  if (value === true) {
    throw new UsageError(`Flag '--${flagName}' requires a value.`);
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new UsageError(`Flag '--${flagName}' cannot be empty.`);
  }
  return normalized;
}

/**
 * @param {string | true | undefined} value
 * @param {string} flagName
 * @returns {boolean}
 */
export function resolveOptionalBooleanFlag(value, flagName) {
  if (value === undefined) {
    return false;
  }
  if (value === true) {
    return true;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new UsageError(`Flag '--${flagName}' must be true or false.`);
}

/**
 * @param {string | null} value
 * @returns {"host" | "isolated"}
 */
export function resolveRunnerAuthMode(value) {
  const normalized = value ? value.toLowerCase() : "host";
  if (normalized === "host") {
    return "host";
  }
  if (normalized === "isolated") {
    return "isolated";
  }
  throw new UsageError("Flag '--runner-auth-mode' must be either 'host' or 'isolated'.");
}

/**
 * @param {string | null} value
 * @returns {"full-bypass" | "restricted"}
 */
export function resolveRuntimeAgentPermissionMode(value) {
  const normalized = value ? value.toLowerCase() : "full-bypass";
  if (normalized === "full-bypass") {
    return "full-bypass";
  }
  if (normalized === "restricted") {
    return "restricted";
  }
  throw new UsageError("Flag '--runtime-agent-permission-mode' must be either 'full-bypass' or 'restricted'.");
}

/**
 * @param {string | null} value
 * @returns {"fail-closed" | "ask-all" | "orchestrator-mediated"}
 */
export function resolveRuntimeAgentInteractionPolicy(value) {
  const normalized = value ? value.toLowerCase() : "fail-closed";
  if (normalized === "fail-closed" || normalized === "ask-all" || normalized === "orchestrator-mediated") {
    return normalized;
  }
  throw new UsageError(
    "Flag '--runtime-agent-interaction-policy' must be one of: fail-closed, ask-all, orchestrator-mediated.",
  );
}

/**
 * @param {string | null} value
 * @returns {"none" | "conservative" | "auto-edit" | "trusted-run"}
 */
export function resolveRuntimeAgentAutoApprovalProfile(value) {
  const normalized = value ? value.toLowerCase() : "none";
  if (normalized === "none" || normalized === "conservative" || normalized === "auto-edit" || normalized === "trusted-run") {
    return normalized;
  }
  throw new UsageError(
    "Flag '--runtime-agent-auto-approval-profile' must be one of: none, conservative, auto-edit, trusted-run.",
  );
}

/**
 * @param {string} filePath
 * @returns {boolean}
 */
export function fileExists(filePath) {
  return fs.existsSync(filePath);
}

/**
 * @param {string | null | undefined} evidenceRef
 * @param {string} projectRoot
 * @returns {boolean}
 */
export function evidenceRefMaterialized(evidenceRef, projectRoot) {
  const ref = asNonEmptyString(evidenceRef);
  if (!ref) return false;
  if (path.isAbsolute(ref)) return fileExists(ref);
  if (!ref.startsWith("evidence://")) return false;
  const evidencePath = ref.slice("evidence://".length);
  if (!evidencePath) return false;
  const resolvedPath = path.isAbsolute(evidencePath) ? evidencePath : path.resolve(projectRoot, evidencePath);
  return fileExists(resolvedPath);
}

/**
 * @param {string} filePath
 * @returns {string}
 */
export function requireDirectory(filePath) {
  const absolute = path.resolve(filePath);
  if (!fileExists(absolute)) {
    throw new UsageError(`Path '${filePath}' does not exist.`);
  }
  if (!fs.statSync(absolute).isDirectory()) {
    throw new UsageError(`Path '${filePath}' must be a directory.`);
  }
  return absolute;
}
