import path from "node:path";

import { collectYamlFiles, inferFamilyFromExamplePath } from "./example-paths.mjs";
import { loadContractFile } from "./loader.mjs";

/**
 * @param {{ workspaceRoot?: string, examplesRoot?: string }} [options]
 * @returns {import("./index.d.ts").LoadedExampleContracts}
 */
export function loadExampleContracts(options = {}) {
  const workspaceRoot = path.resolve(options.workspaceRoot ?? process.cwd());
  const examplesRoot = path.resolve(workspaceRoot, options.examplesRoot ?? "examples");
  const files = collectYamlFiles(examplesRoot).sort();

  /** @type {import("./index.d.ts").LoadedContractFile[]} */
  const results = [];
  for (const filePath of files) {
    const family = inferFamilyFromExamplePath(filePath);
    results.push(loadContractFile({ filePath, family: family ?? undefined }));
  }

  const issues = results.flatMap((result) => result.validation.issues);
  return {
    ok: issues.length === 0,
    workspaceRoot,
    examplesRoot,
    results,
    issues,
  };
}
