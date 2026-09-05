import fs from "node:fs";
import path from "node:path";

import { validateReferenceBinding } from "../../../contracts/src/index.mjs";

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function resultForFailure(reason, migration) {
  return { ok: false, reason, migration };
}

function sameFile(left, right) {
  return left?.dev === right?.dev && left?.ino === right?.ino && left?.size === right?.size;
}

function canonicalizeExistingParent(candidate) {
  let cursor = path.resolve(candidate);
  const missing = [];
  while (true) {
    try {
      fs.lstatSync(cursor);
      return path.join(fs.realpathSync.native(cursor), ...missing.reverse());
    } catch (error) {
      if (error?.code !== "ENOENT") return null;
      const parent = path.dirname(cursor);
      if (parent === cursor) return null;
      missing.push(path.basename(cursor));
      cursor = parent;
    }
  }
}

/**
 * Resolve a literal relative path against an existing canonical boundary while
 * rejecting lexical traversal and symlink/junction escapes in every existing ancestor.
 *
 * @param {{ root: string, relativePath: string, base?: "project-relative" | "runtime-relative" | "repository-bound" }} options
 */
export function resolveCanonicalContainedPath(options) {
  const base = options.base ?? "project-relative";
  const referenceValidation = validateReferenceBinding({ reference: options.relativePath, base });
  if (!referenceValidation.ok) {
    return { ok: false, reason: referenceValidation.value_class, migration: referenceValidation.migration };
  }

  let canonicalRoot;
  try {
    canonicalRoot = fs.realpathSync.native(options.root);
  } catch {
    return { ok: false, reason: "boundary-missing", migration: "Create and canonicalize the declared boundary first." };
  }

  const lexicalTarget = path.resolve(canonicalRoot, ...options.relativePath.split("/"));
  if (!isWithin(canonicalRoot, lexicalTarget)) {
    return resultForFailure("lexical-escape", "Use a path contained by the declared boundary.");
  }

  let cursor = canonicalRoot;
  let existingAncestor = canonicalRoot;
  let resolvedPath = canonicalRoot;
  let finalStat = null;
  let finalExists = true;
  for (const segment of options.relativePath.split("/")) {
    cursor = path.join(cursor, segment);
    let stat;
    try {
      stat = fs.lstatSync(cursor);
    } catch (error) {
      if (error?.code === "ENOENT") {
        finalExists = false;
        break;
      }
      return resultForFailure("ancestor-inspection-failed", "Make every ancestor inspectable.");
    }
    try {
      const canonicalCursor = fs.realpathSync.native(cursor);
      if (!isWithin(canonicalRoot, canonicalCursor)) {
        return resultForFailure(
          stat.isSymbolicLink() ? "symlink-escape" : "canonical-escape",
          "Remove the escaping symlink or choose a path inside the declared boundary.",
        );
      }
      existingAncestor = canonicalCursor;
      resolvedPath = canonicalCursor;
      finalStat = stat;
      cursor = canonicalCursor;
    } catch {
      return resultForFailure("dangling-symlink", "Remove or repair the dangling symlink ancestor.");
    }
  }

  if (options.rejectFinalSymlink === true && finalStat?.isSymbolicLink()) {
    return resultForFailure("final-symlink", "Protected reads and ownership markers must name a regular, non-symlink entry.");
  }

  return {
    ok: true,
    reason: null,
    canonicalRoot,
    canonicalPath: lexicalTarget,
    resolvedPath: finalExists ? resolvedPath : lexicalTarget,
    relativePath: options.relativePath,
    existingAncestor,
    finalExists,
    finalStat,
  };
}

/**
 * Resolve and read one regular file without following a final symlink. The
 * descriptor identity is checked against a post-open lstat so a replacement
 * between validation and read cannot redirect the bytes outside the boundary.
 *
 * @param {{ root: string, relativePath: string, base?: "project-relative" | "runtime-relative" | "repository-bound", maxBytes?: number }} options
 */
export function readCanonicalContainedFile(options) {
  const resolution = resolveCanonicalContainedPath({
    ...options,
    rejectFinalSymlink: true,
  });
  if (!resolution.ok) return resolution;
  if (!resolution.finalExists) return resultForFailure("missing", "Create or select an existing file inside the declared boundary.");
  if (!resolution.finalStat?.isFile()) return resultForFailure("not-regular-file", "Protected reads accept regular files only.");

  const noFollow = fs.constants.O_NOFOLLOW ?? 0;
  let descriptor;
  try {
    descriptor = fs.openSync(resolution.canonicalPath, fs.constants.O_RDONLY | noFollow);
    const opened = fs.fstatSync(descriptor);
    const current = fs.lstatSync(resolution.canonicalPath);
    if (current.isSymbolicLink() || !sameFile(opened, current)) {
      return resultForFailure("file-identity-changed", "Retry after the protected file stops changing.");
    }
    const bytes = fs.readFileSync(descriptor);
    if (Number.isFinite(options.maxBytes) && bytes.length > options.maxBytes) {
      return resultForFailure("file-too-large", "Select a file within the bounded read size.");
    }
    return { ...resolution, ok: true, bytes };
  } catch (error) {
    return resultForFailure(error?.code === "ELOOP" ? "final-symlink" : "read-failed", "Make the protected file readable without changing its identity.");
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

/**
 * Remove a path only after canonical ownership and final-entry checks. The
 * root itself is never removable; a missing target is an idempotent success.
 *
 * @param {{ root: string, target: string }} options
 */
export function removeCanonicalContainedPath({ root, target }) {
  let canonicalRoot;
  try {
    canonicalRoot = fs.realpathSync.native(root);
  } catch {
    return resultForFailure("boundary-missing", "Create and canonicalize the declared boundary first.");
  }
  const absoluteTarget = path.resolve(target);
  const lexicalRoot = path.resolve(root);
  let relativePath;
  if (isWithin(lexicalRoot, absoluteTarget)) relativePath = path.relative(lexicalRoot, absoluteTarget);
  else {
    const canonicalTarget = canonicalizeExistingParent(absoluteTarget);
    if (!canonicalTarget || !isWithin(canonicalRoot, canonicalTarget)) return resultForFailure("lexical-escape", "Use a target contained by the declared boundary.");
    relativePath = path.relative(canonicalRoot, canonicalTarget);
  }
  relativePath = relativePath.split(path.sep).join("/");
  if (!relativePath || relativePath === ".") return resultForFailure("root-delete", "The canonical ownership root is never a deletion target.");
  const resolution = resolveCanonicalContainedPath({
    root: canonicalRoot,
    relativePath,
    base: "repository-bound",
    rejectFinalSymlink: true,
  });
  if (!resolution.ok && resolution.reason !== "missing") return resolution;
  if (!resolution.ok || !resolution.finalExists) return { ok: true, status: "missing", removed: false, resolution };
  try {
    fs.rmSync(resolution.canonicalPath, { recursive: true, force: true });
    return { ok: true, status: "deleted", removed: true, resolution };
  } catch (error) {
    return resultForFailure("delete-failed", error instanceof Error ? error.message : String(error));
  }
}

/** Copy a tree only after both source and destination are bound to canonical roots. */
export function copyCanonicalContainedPath({ sourceRoot, sourceRelativePath, targetRoot, targetRelativePath, options = {} }) {
  const source = resolveCanonicalContainedPath({ root: sourceRoot, relativePath: sourceRelativePath, base: "repository-bound" });
  if (!source.ok) return source;
  const target = resolveCanonicalContainedPath({ root: targetRoot, relativePath: targetRelativePath, base: "repository-bound", rejectFinalSymlink: true });
  if (!target.ok) return target;
  try {
    fs.cpSync(source.canonicalPath, target.canonicalPath, { dereference: false, verbatimSymlinks: true, ...options });
    return { ok: true, source, target };
  } catch (error) {
    return resultForFailure("copy-failed", error instanceof Error ? error.message : String(error));
  }
}
