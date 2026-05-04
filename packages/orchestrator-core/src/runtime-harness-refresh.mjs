import { materializeRuntimeHarnessReport } from "./runtime-harness-report.mjs";

/**
 * @param {{
 *   projectRoot: string,
 *   runtimeRoot: string,
 *   runId: string,
 * }} result
 */
export function refreshRuntimeHarnessReportForStep(result) {
  materializeRuntimeHarnessReport({
    projectRef: result.projectRoot,
    cwd: result.projectRoot,
    runtimeRoot: result.runtimeRoot,
    runId: result.runId,
  });
}
