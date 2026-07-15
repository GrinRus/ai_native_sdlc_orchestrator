import fs from "node:fs";
import path from "node:path";

import { validateReferenceBinding } from "../../../contracts/src/index.mjs";

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
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
    return { ok: false, reason: "lexical-escape", migration: "Use a path contained by the declared boundary." };
  }

  let cursor = canonicalRoot;
  let existingAncestor = canonicalRoot;
  for (const segment of options.relativePath.split("/")) {
    cursor = path.join(cursor, segment);
    let stat;
    try {
      stat = fs.lstatSync(cursor);
    } catch (error) {
      if (error?.code === "ENOENT") break;
      return { ok: false, reason: "ancestor-inspection-failed", migration: "Make every ancestor inspectable." };
    }
    try {
      const canonicalCursor = fs.realpathSync.native(cursor);
      if (!isWithin(canonicalRoot, canonicalCursor)) {
        return {
          ok: false,
          reason: stat.isSymbolicLink() ? "symlink-escape" : "canonical-escape",
          migration: "Remove the escaping symlink or choose a path inside the declared boundary.",
        };
      }
      existingAncestor = canonicalCursor;
      cursor = canonicalCursor;
    } catch {
      return { ok: false, reason: "dangling-symlink", migration: "Remove or repair the dangling symlink ancestor." };
    }
  }

  return {
    ok: true,
    reason: null,
    canonicalRoot,
    canonicalPath: lexicalTarget,
    relativePath: options.relativePath,
    existingAncestor,
  };
}
