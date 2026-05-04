import fs from "node:fs";
import path from "node:path";

import { validateContractDocument } from "../../contracts/src/index.mjs";

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
  fs.writeFileSync(stepResultPath, `${JSON.stringify(options.stepResult, null, 2)}\n`, "utf8");
  return stepResultPath;
}

/**
 * @param {{
 *   runtimeLayout: { reportsRoot: string },
 *   stepResultPath: string,
 *   stepResult: Record<string, unknown>,
 * }} options
 */
export function rewriteStepResult(options) {
  return writeStepResult({
    runtimeLayout: options.runtimeLayout,
    stepResultFileName: path.basename(options.stepResultPath),
    stepResult: options.stepResult,
  });
}
