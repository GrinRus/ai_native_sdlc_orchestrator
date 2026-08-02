import fs from "node:fs";
import path from "node:path";

import { validateContractDocument } from "../../contracts/src/index.mjs";
import { withFileLock, writeJsonAtomic } from "../../observability/src/index.mjs";

/**
 * @param {{
 *   runtimeLayout: { reportsRoot: string },
 *   stepResultFileName: string,
 *   stepResult: Record<string, unknown>,
 * }} options
 */
export function writeStepResult(options) {
  const validation = validateContractDocument({
    family: "step-result",
    document: options.stepResult,
    source: "runtime://step-result",
  });
  if (!validation.ok) {
    const messages = validation.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Routed step-result failed contract validation: ${messages}`);
  }

  const stepResultPath = path.join(options.runtimeLayout.reportsRoot, options.stepResultFileName);
  const serialized = `${JSON.stringify(options.stepResult, null, 2)}\n`;
  try {
    fs.writeFileSync(stepResultPath, serialized, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (error?.code !== "EEXIST" || fs.readFileSync(stepResultPath, "utf8") !== serialized) {
      const conflict = new Error(`Step result '${stepResultPath}' already exists with different content.`);
      conflict.code = "step-result-create-conflict";
      throw conflict;
    }
  }
  return stepResultPath;
}

/**
 * @param {{
 *   runtimeLayout: { reportsRoot: string },
 *   stepResultPath: string,
 *   stepResult: Record<string, unknown>,
 *   expectedRevision?: number,
 * }} options
 */
export function rewriteStepResult(options) {
  const revisionFile = `${options.stepResultPath}.revision.json`;
  return withFileLock(`${options.stepResultPath}.lock`, () => {
    const revision = fs.existsSync(revisionFile) ? JSON.parse(fs.readFileSync(revisionFile, "utf8")).revision : 0;
    if (options.expectedRevision !== undefined && options.expectedRevision !== revision) {
      const conflict = new Error(`Step result revision conflict: expected ${options.expectedRevision}, current ${revision}.`);
      conflict.code = "step-result-revision-conflict";
      throw conflict;
    }
    const validation = validateContractDocument({
      family: "step-result",
      document: options.stepResult,
      source: "runtime://step-result",
    });
    if (!validation.ok) throw new Error(`Routed step-result failed contract validation: ${validation.issues.map((issue) => issue.message).join("; ")}`);
    writeJsonAtomic(options.stepResultPath, options.stepResult);
    writeJsonAtomic(revisionFile, { revision: revision + 1, updated_at: new Date().toISOString() });
    return options.stepResultPath;
  });
}
