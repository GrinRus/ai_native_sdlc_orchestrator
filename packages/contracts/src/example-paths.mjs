import fs from "node:fs";
import path from "node:path";

import { EXAMPLE_FAMILY_RESOLUTION_RULES } from "./families.mjs";
import { normalizePath } from "./utils.mjs";

/**
 * @param {string} filePath
 * @returns {import("./index.d.ts").ContractFamily | null}
 */
export function inferFamilyFromExamplePath(filePath) {
  const absolutePath = normalizePath(path.resolve(filePath));
  const marker = "/examples/";
  const markerIndex = absolutePath.lastIndexOf(marker);
  const normalized = markerIndex >= 0 ? absolutePath.slice(markerIndex + 1) : normalizePath(filePath);
  for (const rule of EXAMPLE_FAMILY_RESOLUTION_RULES) {
    if (rule.regex.test(normalized)) {
      return rule.family;
    }
  }
  return null;
}

/**
 * @param {string} root
 * @returns {string[]}
 */
export function collectYamlFiles(root) {
  /** @type {string[]} */
  const files = [];
  /** @type {string[]} */
  const pending = [root];

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) {
      continue;
    }

    for (const dirent of fs.readdirSync(current, { withFileTypes: true })) {
      const childPath = path.join(current, dirent.name);
      if (dirent.isDirectory()) {
        pending.push(childPath);
        continue;
      }

      if (dirent.isFile() && /\.ya?ml$/i.test(dirent.name)) {
        files.push(childPath);
      }
    }
  }

  return files;
}
