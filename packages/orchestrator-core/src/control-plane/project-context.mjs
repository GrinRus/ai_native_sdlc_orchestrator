import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { previewProjectRuntime } from "../project-init.mjs";

function canonicalPath(value) {
  const absolute = path.resolve(value);
  const missing = [];
  let cursor = absolute;
  while (!fs.existsSync(cursor)) {
    missing.unshift(path.basename(cursor));
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  const existing = fs.existsSync(cursor) ? fs.realpathSync.native(cursor) : cursor;
  return path.join(existing, ...missing);
}

function freezeContext(value) {
  Object.freeze(value.runtimeOptions);
  return Object.freeze(value);
}

function registryIdentity(parts) {
  return crypto.createHash("sha256").update(parts.join("\0")).digest("hex");
}

export function createProjectContext(input) {
  const launcherCwd = canonicalPath(input.cwd ?? process.cwd());
  const preview = previewProjectRuntime({
    cwd: launcherCwd,
    projectRef: input.projectRef,
    projectProfile: input.projectProfile,
    runtimeRoot: input.runtimeRoot,
  });
  const projectRoot = canonicalPath(preview.projectRoot);
  const runtimeRoot = canonicalPath(preview.runtimeRoot);
  const projectRuntimeRoot = canonicalPath(preview.runtimeLayout.projectRuntimeRoot);
  const canonicalProfilePath = preview.projectProfileRef === "<generated-bundled-profile>"
    ? path.join(projectRuntimeRoot, "state", "project.aor.yaml")
    : canonicalPath(path.isAbsolute(preview.projectProfileRef)
      ? preview.projectProfileRef
      : path.resolve(projectRoot, preview.projectProfileRef));
  const identity = registryIdentity([projectRoot, runtimeRoot, canonicalProfilePath, preview.projectId]);
  return freezeContext({
    projectId: preview.projectId,
    runtimeProjectId: preview.projectId,
    label: typeof input.label === "string" && input.label.trim() ? input.label.trim() : preview.displayName,
    projectRoot,
    runtimeRoot,
    projectRuntimeRoot,
    canonicalProfilePath,
    registryIdentity: identity,
    launcherCwd,
    originalProjectRef: path.resolve(launcherCwd, input.projectRef),
    runtimeOptions: {
      cwd: projectRoot,
      projectRef: projectRoot,
      projectProfile: input.projectProfile ? canonicalProfilePath : undefined,
      runtimeRoot,
    },
  });
}

export function rekeyProjectContext(context, projectId, label = context.label) {
  return freezeContext({ ...context, projectId, label, runtimeOptions: { ...context.runtimeOptions } });
}

function isInside(base, candidate) {
  const relative = path.relative(base, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function resolveProjectContextReference(context, reference, baseKind) {
  let value = String(reference);
  if (value.startsWith("evidence://")) value = value.slice("evidence://".length);
  if (!value || path.isAbsolute(value) || value.includes("\\") || value.includes("\0")) {
    throw new Error(`Reference '${reference}' must be a canonical relative path.`);
  }
  const segments = value.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`Reference '${reference}' contains an invalid path segment.`);
  }
  const bases = {
    "project-relative": context.projectRoot,
    "runtime-relative": context.runtimeRoot,
    "evidence-relative": context.projectRuntimeRoot,
    "repository-bound": context.projectRoot,
  };
  const base = bases[baseKind];
  if (!base) throw new Error(`Unsupported project-context base '${baseKind}'.`);
  const candidate = canonicalPath(path.join(base, ...segments));
  if (!isInside(base, candidate)) throw new Error(`Reference '${reference}' escapes its ${baseKind} boundary.`);
  return candidate;
}
