import crypto from "node:crypto";
import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { validatePublicId } from "../../contracts/src/index.mjs";

export function resolveAorHome(options = {}) {
  const env = options.env ?? process.env;
  const home = options.home ?? os.homedir();
  return path.resolve(env.AOR_HOME?.trim() || path.join(home, ".aor"));
}

function normalizeSlug(value) {
  const input = String(value ?? "project").toLowerCase();
  let normalized = "";
  let pendingSeparator = false;
  for (const character of input) {
    const code = character.charCodeAt(0);
    const alphaNumeric = (code >= 97 && code <= 122) || (code >= 48 && code <= 57);
    const allowedPunctuation = character === "." || character === "_" || character === "-";
    if (alphaNumeric) {
      if (pendingSeparator && normalized.length > 0) normalized += "-";
      normalized += character;
      pendingSeparator = false;
    } else if (allowedPunctuation) {
      if (normalized.length > 0) {
        if (pendingSeparator) normalized += "-";
        normalized += character;
        pendingSeparator = false;
      }
    } else if (normalized.length > 0) {
      pendingSeparator = true;
    }
    if (normalized.length >= 80) break;
  }
  normalized = normalized.slice(0, 80);
  while (normalized.length > 0) {
    const code = normalized.charCodeAt(normalized.length - 1);
    if ((code >= 97 && code <= 122) || (code >= 48 && code <= 57)) break;
    normalized = normalized.slice(0, -1);
  }
  return validatePublicId(normalized).ok ? normalized : "project";
}

export function sanitizeGitUrl(value) {
  const input = String(value ?? "").trim();
  if (!input) throw new Error("Git URL is required.");
  if (/^https?:\/\/[^/@\s]+:[^/@\s]+@/iu.test(input) || /^https?:\/\/[^/@\s]+@/iu.test(input)) {
    throw new Error("Git URLs must not contain embedded credentials.");
  }
  if (/^https?:\/\//iu.test(input) || /^ssh:\/\//iu.test(input) || /^git@[^:]+:.+/u.test(input)) return input;
  throw new Error("Git URL must use HTTPS or SSH.");
}

export function normalizeRepositoryIdentity(value) {
  const normalized = String(value ?? "")
    .trim()
    .replace(/^https?:\/\//iu, "")
    .replace(/^ssh:\/\//iu, "")
    .replace(/^git@([^:]+):/iu, "$1/")
    .replace(/\.git$/iu, "")
    .replace(/\/+$/u, "")
    .toLowerCase();
  return normalized;
}

export function inspectGitIdentity(projectRoot) {
  const result = childProcess.spawnSync("git", ["-C", projectRoot, "config", "--get", "remote.origin.url"], {
    encoding: "utf8",
    timeout: 5_000,
  });
  return result.status === 0 ? normalizeRepositoryIdentity(result.stdout) : "";
}

export function deriveWorkspaceProjectId({ projectRoot, repositoryIdentity }) {
  const identity = normalizeRepositoryIdentity(repositoryIdentity) || inspectGitIdentity(projectRoot) || path.resolve(projectRoot);
  const slugSource = normalizeRepositoryIdentity(repositoryIdentity).split("/").at(-1) || path.basename(projectRoot);
  const digest = crypto.createHash("sha256").update(identity).digest("hex").slice(0, 8);
  return `${normalizeSlug(slugSource)}-${digest}`;
}

export function deriveManagedRepositoryId(gitUrl) {
  const sanitized = sanitizeGitUrl(gitUrl);
  const identity = normalizeRepositoryIdentity(sanitized);
  const slug = identity.split("/").at(-1) || "repository";
  const digest = crypto.createHash("sha256").update(identity).digest("hex").slice(0, 12);
  return `${normalizeSlug(slug)}-${digest}`;
}

export function toLogicalEvidenceRef({ projectRoot, filePath, workspaceProjectId }) {
  const absolute = path.resolve(filePath);
  const selectedId = workspaceProjectId ?? deriveWorkspaceProjectId({ projectRoot });
  const marker = `${path.sep}projects${path.sep}${selectedId}${path.sep}`;
  const markerIndex = absolute.indexOf(marker);
  if (markerIndex >= 0) {
    const relative = absolute.slice(markerIndex + marker.length).replace(/\\/g, "/");
    return `evidence://projects/${selectedId}/${relative}`;
  }
  return `evidence://${path.relative(projectRoot, absolute).replace(/\\/g, "/")}`;
}

export function resolveLogicalEvidenceRef({ projectRoot, projectRuntimeRoot, workspaceProjectId, reference }) {
  const prefix = `evidence://projects/${workspaceProjectId}/`;
  if (reference.startsWith(prefix)) return path.resolve(projectRuntimeRoot, reference.slice(prefix.length));
  const logical = reference.match(/^evidence:\/\/projects\/([^/]+)\/(.+)$/u);
  if (logical && projectRuntimeRoot) return path.resolve(projectRuntimeRoot, logical[2]);
  if (reference.startsWith("evidence://")) return path.resolve(projectRoot, reference.slice("evidence://".length));
  return path.isAbsolute(reference) ? reference : path.resolve(projectRoot, reference);
}

function containedBy(root, candidate) {
  const canonicalRoot = fs.existsSync(root) ? fs.realpathSync.native(root) : path.resolve(root);
  const canonicalCandidate = fs.existsSync(candidate) ? fs.realpathSync.native(candidate) : path.resolve(candidate);
  const relative = path.relative(canonicalRoot, canonicalCandidate);
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

function evidenceError(code, message) {
  return Object.assign(new Error(message), { code });
}

/**
 * Resolve an evidence URI against the owning project runtime and verify that
 * the resulting file cannot escape through traversal or symlinks. Legacy
 * evidence://relative refs remain readable, but are still rooted in the
 * supplied runtime/project boundaries.
 */
export function resolveEvidenceReference({ projectRoot, projectRuntimeRoot, workspaceProjectId, reference, expectedDigest, expectedBindings } = {}) {
  if (typeof reference !== "string" || reference.trim().length === 0) throw evidenceError("evidence-reference-invalid", "Evidence reference must be a non-empty string.");
  const value = reference.trim();
  if (value.includes("\\") || /[\u0000-\u001f\u007f]/u.test(value)) throw evidenceError("evidence-reference-invalid", `Evidence reference '${reference}' contains unsafe characters.`);
  let candidate;
  const projectMatch = value.match(/^evidence:\/\/projects\/([^/]+)\/(.+)$/u);
  if (projectMatch) {
    if (workspaceProjectId && projectMatch[1] !== workspaceProjectId) throw evidenceError("evidence-project-mismatch", `Evidence reference '${reference}' belongs to project '${projectMatch[1]}'.`);
    candidate = path.resolve(projectRuntimeRoot ?? projectRoot, projectMatch[2]);
  } else if (value.startsWith("evidence://")) {
    const relative = value.slice("evidence://".length);
    if (!relative || path.isAbsolute(relative)) throw evidenceError("evidence-reference-invalid", `Evidence reference '${reference}' is not a relative URI.`);
    const runtimeCandidate = path.resolve(projectRuntimeRoot ?? projectRoot, relative);
    const projectCandidate = path.resolve(projectRoot ?? projectRuntimeRoot ?? process.cwd(), relative);
    if (relative.split("/").includes("..")) {
      if (projectRoot && projectRuntimeRoot && containedBy(projectRuntimeRoot, projectCandidate) && fs.existsSync(projectCandidate)) candidate = projectCandidate;
      else throw evidenceError("evidence-reference-out-of-scope", `Evidence reference '${reference}' contains traversal outside the owning project.`);
    } else candidate = runtimeCandidate;
  } else if (path.isAbsolute(value)) {
    candidate = path.resolve(value);
  } else {
    candidate = path.resolve(projectRoot ?? projectRuntimeRoot ?? process.cwd(), value);
  }
  const roots = [projectRuntimeRoot, projectRoot].filter((root) => typeof root === "string").map((root) => path.resolve(root));
  if (roots.length === 0 || !roots.some((root) => containedBy(root, candidate))) throw evidenceError("evidence-reference-out-of-scope", `Evidence reference '${reference}' resolves outside the owning project.`);
  if (!fs.existsSync(candidate)) throw evidenceError("evidence-not-found", `Evidence reference '${reference}' does not resolve to a file.`);
  const stat = fs.lstatSync(candidate);
  if (!stat.isFile() || stat.isSymbolicLink()) throw evidenceError("evidence-reference-invalid", `Evidence reference '${reference}' must resolve to a regular file.`);
  const canonical = fs.realpathSync.native(candidate);
  if (!roots.some((root) => containedBy(root, canonical))) throw evidenceError("evidence-reference-out-of-scope", `Evidence reference '${reference}' escapes the owning project through a link.`);
  const bytes = fs.readFileSync(canonical);
  const digest = crypto.createHash("sha256").update(bytes).digest("hex");
  if (expectedDigest && digest !== expectedDigest) throw evidenceError("evidence-digest-mismatch", `Evidence reference '${reference}' changed after authorization.`);
  if (expectedBindings && typeof expectedBindings === "object") {
    let metadata = null;
    const sidecar = `${canonical}.authority.json`;
    if (fs.existsSync(sidecar)) {
      try { metadata = JSON.parse(fs.readFileSync(sidecar, "utf8")); } catch { throw evidenceError("evidence-binding-invalid", `Evidence authority sidecar for '${reference}' is malformed.`); }
    }
    if (!metadata) throw evidenceError("evidence-binding-missing", `Evidence authority sidecar for '${reference}' is missing.`);
    for (const [key, expected] of Object.entries(expectedBindings)) if (expected !== undefined && expected !== null && metadata[key] !== expected) throw evidenceError("evidence-binding-mismatch", `Evidence '${reference}' does not match binding '${key}'.`);
  }
  return { reference: value, filePath: canonical, bytes, sha256: digest };
}

/** Materialize immutable evidence bytes with a digest-addressed path and authority sidecar. */
export function storeEvidenceReference({ projectRuntimeRoot, workspaceProjectId, filename = "evidence.bin", bytes, bindings = {}, redaction = null } = {}) {
  if (!projectRuntimeRoot || !workspaceProjectId || (!Buffer.isBuffer(bytes) && typeof bytes !== "string")) throw evidenceError("evidence-store-invalid", "Evidence storage requires runtime root, project id, and bytes.");
  const safeName = path.basename(filename).replace(/[^a-zA-Z0-9._-]/gu, "-") || "evidence.bin";
  const data = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const digest = crypto.createHash("sha256").update(data).digest("hex");
  const directory = path.join(projectRuntimeRoot, "evidence", workspaceProjectId, digest);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const filePath = path.join(directory, safeName);
  if (fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath);
    if (crypto.createHash("sha256").update(existing).digest("hex") !== digest) throw evidenceError("evidence-digest-mismatch", `Evidence path '${filePath}' already contains different bytes.`);
  } else fs.writeFileSync(filePath, data, { mode: 0o600, flag: "wx" });
  const authority = { schema_version: 1, authority_kind: "aor-evidence-materialization", project_id: workspaceProjectId, file: filePath, sha256: digest, ...bindings, redaction };
  const authorityFile = `${filePath}.authority.json`;
  if (!fs.existsSync(authorityFile)) fs.writeFileSync(authorityFile, `${JSON.stringify(authority, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  return { filePath, authorityFile, reference: `evidence://projects/${workspaceProjectId}/evidence/${workspaceProjectId}/${digest}/${safeName}`, sha256: digest };
}
