import fs from "node:fs";
import path from "node:path";

/** @param {string} filePath @returns {Record<string, unknown> | null} */
export function readJsonFileOrNull(filePath) {
  try {
    return /** @type {Record<string, unknown>} */ (JSON.parse(fs.readFileSync(filePath, "utf8")));
  } catch {
    return null;
  }
}

/** @param {string} dirPath @returns {string[]} */
export function listJsonFilesByModificationTime(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  return fs.readdirSync(dirPath)
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => path.join(dirPath, entry))
    .sort((left, right) => {
      const delta = fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs;
      return delta || path.basename(right).localeCompare(path.basename(left));
    });
}
