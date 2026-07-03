import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const workspaceRoot = path.resolve(currentDir, "../../..");
const scannedRoots = [
  path.join(workspaceRoot, "packages"),
  path.join(workspaceRoot, "apps"),
];
const sourceFilePattern = /\.(?:mjs|js|ts|tsx|json)$/u;
const forbiddenPatterns = [
  /scripts\/live-e2e/u,
  /\blive_e2e\w*/u,
  /\blive-e2e\b/u,
  /\btarget_readiness\b/u,
  /\bdiagnostic_health\b/u,
  /\bstep_quality\b/u,
];

/**
 * @param {string} root
 * @returns {string[]}
 */
function collectProductionSourceFiles(root) {
  /** @type {string[]} */
  const files = [];
  /** @type {string[]} */
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || !fs.existsSync(current)) continue;
    for (const dirent of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, dirent.name);
      if (dirent.isDirectory()) {
        if (["test", "fixtures", "node_modules", "dist"].includes(dirent.name)) continue;
        pending.push(entryPath);
        continue;
      }
      if (!dirent.isFile() || !sourceFilePattern.test(dirent.name)) continue;
      if (!entryPath.includes(`${path.sep}src${path.sep}`) && !entryPath.includes(`${path.sep}bin${path.sep}`)) continue;
      files.push(entryPath);
    }
  }
  return files;
}

test("AOR production source does not import or emit live E2E harness fields", () => {
  const violations = [];
  for (const root of scannedRoots) {
    for (const filePath of collectProductionSourceFiles(root)) {
      const content = fs.readFileSync(filePath, "utf8");
      for (const pattern of forbiddenPatterns) {
        if (pattern.test(content)) {
          violations.push(`${path.relative(workspaceRoot, filePath)} matched ${pattern}`);
        }
      }
    }
  }

  assert.deepEqual(violations, []);
});
