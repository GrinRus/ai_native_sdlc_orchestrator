import crypto from "node:crypto";
import childProcess from "node:child_process";
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
