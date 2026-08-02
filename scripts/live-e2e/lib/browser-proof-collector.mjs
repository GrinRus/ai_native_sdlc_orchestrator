import { spawnSync } from "node:child_process";
import fs from "node:fs";

/**
 * @param {{
 *   pythonBin: string,
 *   collectorScriptFile: string,
 *   payload: Record<string, unknown>,
 *   env: NodeJS.ProcessEnv,
 *   proofFile: string,
 * }} options
 */
export function runGuidedBrowserTaskCollector(options) {
  const attempts = [];
  let result = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    result = spawnSync(options.pythonBin, [options.collectorScriptFile, JSON.stringify(options.payload)], {
      encoding: "utf8",
      env: options.env,
      timeout: 45_000,
    });
    attempts.push({
      attempt,
      status: result.status,
      signal: result.signal,
      proof_materialized: fs.existsSync(options.proofFile),
    });
    if (result.status === 0 && fs.existsSync(options.proofFile)) break;
  }
  if (!result) throw new Error("Guided browser task proof collector did not execute.");
  return { result, attempts };
}
