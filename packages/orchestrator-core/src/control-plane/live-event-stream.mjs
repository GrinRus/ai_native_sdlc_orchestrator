import path from "node:path";

import {
  appendLiveRunEvent,
  listLiveRunEvents,
  openLiveRunEventStream,
} from "../../../observability/src/index.mjs";
import { initializeProjectRuntime } from "../project-init.mjs";

/**
 * @param {string} runId
 * @returns {string}
 */
function normalizeRunId(runId) {
  return runId.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * @param {{
 *   runtimeLayout: { reportsRoot: string },
 *   runId: string,
 * }} options
 * @returns {string}
 */
function resolveRunEventLogFile(options) {
  return path.join(options.runtimeLayout.reportsRoot, `live-run-events-${normalizeRunId(options.runId)}.jsonl`);
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef?: string,
 *   projectProfile?: string,
 *   runtimeRoot?: string,
 *   runId: string,
 *   eventType: string,
 *   payload: Record<string, unknown>,
 *   timestamp?: string,
 *   redactionPolicy?: unknown,
 *   requestKey?: string,
 * }} options
 */
export function appendRunEvent(options) {
  const init = initializeProjectRuntime(options);
  const logFile = resolveRunEventLogFile({
    runtimeLayout: init.runtimeLayout,
    runId: options.runId,
  });
  const event = appendLiveRunEvent({
    logFile,
    runId: options.runId,
    eventType: options.eventType,
    payload: options.payload,
    timestamp: options.timestamp,
    redactionPolicy: options.redactionPolicy,
    requestKey: options.requestKey,
  });

  return {
    event,
    logFile,
  };
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef?: string,
 *   projectProfile?: string,
 *   runtimeRoot?: string,
 *   runId: string,
 * }} options
 */
export function readRunEvents(options) {
  const init = initializeProjectRuntime(options);
  const logFile = resolveRunEventLogFile({
    runtimeLayout: init.runtimeLayout,
    runId: options.runId,
  });
  return listLiveRunEvents({
    logFile,
    runId: options.runId,
  });
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef?: string,
 *   projectProfile?: string,
 *   runtimeRoot?: string,
 *   runId: string,
 *   afterEventId?: string,
 *   maxReplay?: number,
 *   redactionPolicy?: unknown,
 * }} options
 */
export function openRunEventStream(options) {
  const init = initializeProjectRuntime(options);
  const logFile = resolveRunEventLogFile({
    runtimeLayout: init.runtimeLayout,
    runId: options.runId,
  });
  const stream = openLiveRunEventStream({
    logFile,
    runId: options.runId,
    afterEventId: options.afterEventId,
    maxReplay: options.maxReplay,
    redactionPolicy: options.redactionPolicy,
  });

  return {
    ...stream,
    log_file: logFile,
  };
}
