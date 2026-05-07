import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const BOOTSTRAP_OWNED_PREFIXES = ["examples/", "context/", ".aor/"];
const BOOTSTRAP_OWNED_FILES = new Set(["project.aor.yaml"]);

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function asString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function asStringArray(value) {
  return Array.isArray(value)
    ? value.filter((entry) => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim())
    : [];
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value)
    : {};
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function uniqueStrings(value) {
  return [...new Set(asStringArray(value))];
}

/**
 * @param {string} filePath
 * @returns {Record<string, unknown> | null}
 */
function readJsonFile(filePath) {
  try {
    return /** @type {Record<string, unknown>} */ (JSON.parse(fs.readFileSync(filePath, "utf8")));
  } catch {
    return null;
  }
}

/**
 * @param {string} dirPath
 * @returns {string[]}
 */
function listJsonFiles(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }
  return fs
    .readdirSync(dirPath)
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => path.join(dirPath, entry))
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
}

/**
 * @param {string} root
 * @returns {{ available: boolean, changedPaths: string[] }}
 */
export function listChangedPaths(root) {
  if (!fs.existsSync(root)) {
    return { available: false, changedPaths: [] };
  }
  const run = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], {
    cwd: root,
    encoding: "utf8",
  });
  if (run.status !== 0) {
    return { available: false, changedPaths: [] };
  }
  const changedPaths = (run.stdout ?? "")
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0)
    .map((line) => line.slice(3).trim())
    .map((candidate) => {
      const renameParts = candidate.split(" -> ");
      return renameParts.length > 1 ? renameParts[renameParts.length - 1] : candidate;
    })
    .map((candidate) => candidate.replace(/\\/g, "/"));
  return { available: true, changedPaths };
}

/**
 * @param {string[]} changedPaths
 * @returns {string[]}
 */
export function filterNonBootstrapChangedPaths(changedPaths) {
  return changedPaths.filter((candidate) => {
    if (BOOTSTRAP_OWNED_FILES.has(candidate)) return false;
    return !BOOTSTRAP_OWNED_PREFIXES.some((prefix) => candidate === prefix.slice(0, -1) || candidate.startsWith(prefix));
  });
}

/**
 * @param {string} candidate
 * @returns {boolean}
 */
export function isTransientBackupPath(candidate) {
  const basename = path.posix.basename(candidate.replace(/\\/g, "/")).toLowerCase();
  return (
    basename.startsWith(".#") ||
    /(?:~|\.bak|\.backup|\.orig|\.rej|\.tmp|\.swp|\.swo|\.old)$/u.test(basename)
  );
}

/**
 * @param {string[]} changedPaths
 * @returns {string[]}
 */
export function filterMeaningfulCodeChangedPaths(changedPaths) {
  return changedPaths.filter((candidate) => !isTransientBackupPath(candidate));
}

/**
 * @param {string} pattern
 * @param {string} candidate
 * @returns {boolean}
 */
export function matchesScopePattern(pattern, candidate) {
  const normalizedPattern = pattern.replace(/\\/g, "/").replace(/^\.\//u, "");
  const normalizedCandidate = candidate.replace(/\\/g, "/").replace(/^\.\//u, "");
  if (normalizedPattern === "**" || normalizedPattern === "**/*") return true;
  if (normalizedPattern.endsWith("/**")) {
    const prefix = normalizedPattern.slice(0, -3);
    return normalizedCandidate === prefix || normalizedCandidate.startsWith(`${prefix}/`);
  }
  if (normalizedPattern.endsWith("/*")) {
    const prefix = normalizedPattern.slice(0, -1);
    return normalizedCandidate.startsWith(prefix) && !normalizedCandidate.slice(prefix.length).includes("/");
  }
  if (!normalizedPattern.includes("*")) {
    return normalizedCandidate === normalizedPattern;
  }
  const wildcardPrefix = normalizedPattern.slice(0, normalizedPattern.indexOf("*"));
  return normalizedCandidate.startsWith(wildcardPrefix);
}

/**
 * @param {string} projectRoot
 * @param {string | null} filePath
 * @returns {string | null}
 */
function resolveProjectRelativeFile(projectRoot, filePath) {
  if (!filePath) return null;
  const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(projectRoot, filePath);
  const relative = path.relative(projectRoot, resolved).replace(/\\/g, "/");
  return relative.startsWith("../") || relative === "" ? null : relative;
}

/**
 * @param {string} projectRoot
 * @param {string} artifactsRoot
 * @returns {{ ignoredInputFiles: string[], allowedPaths: string[], forbiddenPaths: string[] }}
 */
export function loadMissionScope(projectRoot, artifactsRoot) {
  const packetFiles = listJsonFiles(artifactsRoot).filter((filePath) => path.basename(filePath).includes(".artifact."));
  for (const packetFile of packetFiles) {
    const packet = readJsonFile(packetFile);
    if (asString(packet?.packet_type) !== "intake-request") continue;
    const bodyRef = asString(packet?.body_ref);
    if (!bodyRef || !fs.existsSync(bodyRef)) continue;
    const body = readJsonFile(bodyRef);
    const featureRequest = asRecord(body?.feature_request);
    const requestDocument = asRecord(featureRequest.request_document);
    const missionScope = asRecord(body?.mission_scope);
    const requestFile = resolveProjectRelativeFile(projectRoot, asString(featureRequest.request_file));
    const allowedPaths = uniqueStrings([
      ...asStringArray(missionScope.allowed_paths),
      ...asStringArray(featureRequest.allowed_paths),
      ...asStringArray(requestDocument.allowed_paths),
    ]);
    const forbiddenPaths = uniqueStrings([
      ...asStringArray(missionScope.forbidden_paths),
      ...asStringArray(featureRequest.forbidden_paths),
      ...asStringArray(requestDocument.forbidden_paths),
    ]);
    return {
      ignoredInputFiles: requestFile ? [requestFile] : [],
      allowedPaths,
      forbiddenPaths,
    };
  }
  return { ignoredInputFiles: [], allowedPaths: [], forbiddenPaths: [] };
}

/**
 * @param {string[]} changedPaths
 * @param {{ ignoredInputFiles: string[], allowedPaths: string[], forbiddenPaths: string[] }} missionScope
 */
export function resolveMissionScopedChanges(changedPaths, missionScope) {
  const ignoredInputFiles = new Set(missionScope.ignoredInputFiles);
  const scopeCandidates = changedPaths.filter(
    (changedPath) => !ignoredInputFiles.has(changedPath) && !isTransientBackupPath(changedPath),
  );
  const forbiddenChangedPaths = scopeCandidates.filter((changedPath) =>
    missionScope.forbiddenPaths.some((pattern) => matchesScopePattern(pattern, changedPath)),
  );
  const outOfScopeChangedPaths =
    missionScope.allowedPaths.length > 0
      ? scopeCandidates.filter(
          (changedPath) => !missionScope.allowedPaths.some((pattern) => matchesScopePattern(pattern, changedPath)),
        )
      : [];
  const missionScopedChangedPaths =
    missionScope.allowedPaths.length > 0
      ? scopeCandidates.filter((changedPath) =>
          missionScope.allowedPaths.some((pattern) => matchesScopePattern(pattern, changedPath)),
        )
      : scopeCandidates;
  return {
    ignoredInputFiles: missionScope.ignoredInputFiles,
    allowedPaths: missionScope.allowedPaths,
    forbiddenPaths: missionScope.forbiddenPaths,
    nonInputChangedPaths: scopeCandidates,
    missionScopedChangedPaths,
    forbiddenChangedPaths,
    outOfScopeChangedPaths,
    scopeViolationPaths: uniqueStrings([...forbiddenChangedPaths, ...outOfScopeChangedPaths]),
  };
}
