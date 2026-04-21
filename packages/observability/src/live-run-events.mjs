import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";

import { validateContractDocument } from "../../contracts/src/index.mjs";

const LIVE_RUN_EVENT_TYPES = new Set([
  "run.started",
  "step.updated",
  "evidence.linked",
  "warning.raised",
  "run.terminal",
]);

/** @type {Map<string, EventEmitter>} */
const EMITTERS = new Map();

/**
 * @param {string} logFile
 * @returns {EventEmitter}
 */
function getEmitter(logFile) {
  if (!EMITTERS.has(logFile)) {
    EMITTERS.set(logFile, new EventEmitter());
  }
  return /** @type {EventEmitter} */ (EMITTERS.get(logFile));
}

/**
 * @param {string} logFile
 */
function ensureLogDir(logFile) {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function toSequence(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * @param {Record<string, unknown>} event
 * @returns {number}
 */
function getEventSequence(event) {
  const payload = typeof event.payload === "object" && event.payload !== null ? event.payload : {};
  return toSequence(/** @type {Record<string, unknown>} */ (payload).sequence);
}

/**
 * @param {string} runId
 * @param {number} sequence
 * @returns {string}
 */
function buildEventId(runId, sequence) {
  return `${runId}.event.${String(sequence).padStart(6, "0")}`;
}

/**
 * @param {string} logFile
 * @returns {Record<string, unknown>[]}
 */
function readEventLog(logFile) {
  if (!fs.existsSync(logFile)) {
    return [];
  }

  const lines = fs.readFileSync(logFile, "utf8").split("\n").map((line) => line.trim());
  /** @type {Record<string, unknown>[]} */
  const events = [];
  for (const line of lines) {
    if (line.length === 0) continue;
    try {
      const parsed = JSON.parse(line);
      if (typeof parsed === "object" && parsed !== null) {
        events.push(/** @type {Record<string, unknown>} */ (parsed));
      }
    } catch {
      // Ignore malformed lines; contract validation happens on append.
    }
  }

  return events.sort((left, right) => getEventSequence(left) - getEventSequence(right));
}

/**
 * @param {{
 *   logFile: string,
 *   runId: string,
 *   eventType: string,
 *   payload: Record<string, unknown>,
 *   timestamp?: string,
 * }} options
 */
export function appendLiveRunEvent(options) {
  if (!LIVE_RUN_EVENT_TYPES.has(options.eventType)) {
    throw new Error(
      `Unsupported live-run event type '${options.eventType}'. Expected one of: ${[...LIVE_RUN_EVENT_TYPES].join(", ")}.`,
    );
  }

  ensureLogDir(options.logFile);
  const existing = readEventLog(options.logFile).filter((event) => event.run_id === options.runId);
  const nextSequence = existing.length === 0 ? 1 : getEventSequence(existing[existing.length - 1]) + 1;

  const event = {
    event_id: buildEventId(options.runId, nextSequence),
    run_id: options.runId,
    timestamp: options.timestamp ?? new Date().toISOString(),
    event_type: options.eventType,
    payload: {
      sequence: nextSequence,
      ...options.payload,
    },
  };

  const validation = validateContractDocument({
    family: "live-run-event",
    document: event,
    source: "runtime://live-run-event",
  });
  if (!validation.ok) {
    const issues = validation.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Generated live-run event failed contract validation: ${issues}`);
  }

  fs.appendFileSync(options.logFile, `${JSON.stringify(event)}\n`, "utf8");
  getEmitter(options.logFile).emit("event", event);

  return event;
}

/**
 * @param {{
 *   logFile: string,
 *   runId?: string,
 * }} options
 */
export function listLiveRunEvents(options) {
  const all = readEventLog(options.logFile);
  if (!options.runId) {
    return all;
  }
  return all.filter((event) => event.run_id === options.runId);
}

/**
 * @param {Record<string, unknown>[]} events
 * @param {string | undefined} afterEventId
 * @param {number} maxReplay
 * @returns {{ replayEvents: Record<string, unknown>[], afterSequence: number }}
 */
function resolveReplayWindow(events, afterEventId, maxReplay) {
  if (events.length === 0) {
    return { replayEvents: [], afterSequence: 0 };
  }

  if (!afterEventId) {
    const replayEvents = events.slice(-maxReplay);
    const afterSequence = replayEvents.length > 0 ? getEventSequence(replayEvents[replayEvents.length - 1]) : 0;
    return { replayEvents, afterSequence };
  }

  const anchorIndex = events.findIndex((event) => event.event_id === afterEventId);
  const replayEvents = anchorIndex >= 0 ? events.slice(anchorIndex + 1) : events.slice(-maxReplay);
  const afterSequence = anchorIndex >= 0 ? getEventSequence(events[anchorIndex]) : 0;
  return {
    replayEvents: replayEvents.slice(-maxReplay),
    afterSequence,
  };
}

/**
 * @param {{
 *   logFile: string,
 *   runId: string,
 *   afterEventId?: string,
 *   maxReplay?: number,
 * }} options
 */
export function openLiveRunEventStream(options) {
  const maxReplay = options.maxReplay ?? 200;
  const runEvents = listLiveRunEvents({
    logFile: options.logFile,
    runId: options.runId,
  });
  const replayWindow = resolveReplayWindow(runEvents, options.afterEventId, maxReplay);
  let lastSequence = replayWindow.afterSequence;
  if (replayWindow.replayEvents.length > 0) {
    lastSequence = getEventSequence(replayWindow.replayEvents[replayWindow.replayEvents.length - 1]);
  }

  const emitter = getEmitter(options.logFile);
  return {
    protocol: "sse",
    run_id: options.runId,
    reconnect_after_ms: 1000,
    backpressure: {
      policy: "bounded-replay-window",
      max_replay_events: maxReplay,
    },
    replay_events: replayWindow.replayEvents,
    /**
     * @param {(event: Record<string, unknown>) => void} handler
     * @returns {() => void}
     */
    subscribe(handler) {
      /**
       * @param {Record<string, unknown>} event
       */
      function onEvent(event) {
        if (event.run_id !== options.runId) return;
        const sequence = getEventSequence(event);
        if (sequence <= lastSequence) return;
        lastSequence = sequence;
        handler(event);
      }

      emitter.on("event", onEvent);
      return () => {
        emitter.off("event", onEvent);
      };
    },
  };
}
