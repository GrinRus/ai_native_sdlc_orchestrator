import fs from "node:fs";
import path from "node:path";

import { prepareWorkspaceIsolation, resumeWorkspaceIsolation } from "./workspace-isolation.mjs";

/**
 * @param {{
 *   init: Record<string, any>,
 *   runtimeDefaults: Record<string, unknown>,
 *   executionRoot?: string,
 *   runId: string,
 * }} options
 */
export function resolveVerificationWorkspaceIsolation(options) {
  const requestedRoot = typeof options.executionRoot === "string" ? options.executionRoot.trim() : "";
  if (requestedRoot) {
    return {
      reused: true,
      isolation: resumeWorkspaceIsolation({
        projectRoot: options.init.projectRoot,
        projectRuntimeRoot: options.init.runtimeLayout.projectRuntimeRoot,
        runtimeDefaults: options.runtimeDefaults,
        executionRoot: path.isAbsolute(requestedRoot)
          ? requestedRoot
          : path.resolve(options.init.projectRoot, requestedRoot),
      }),
    };
  }
  return {
    reused: false,
    isolation: prepareWorkspaceIsolation({
      projectRoot: options.init.projectRoot,
      runtimeRoot: options.init.runtimeRoot,
      projectRuntimeRoot: options.init.runtimeLayout.projectRuntimeRoot,
      runtimeDefaults: options.runtimeDefaults,
      runId: options.runId,
    }),
  };
}

/**
 * @param {{ isolation: Record<string, any>, reused: boolean, outcome: "success" | "failure" }} options
 */
export function finalizeVerificationWorkspaceIsolation(options) {
  if (!options.reused) return options.isolation.finalize(options.outcome);
  return {
    outcome: options.outcome,
    action: "retain",
    status: "retained",
    performed: false,
    exists_after: fs.existsSync(options.isolation.executionRoot),
    error: null,
  };
}
