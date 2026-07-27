import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { derivePublicId, validateContractDocument, validatePublicId } from "../../contracts/src/index.mjs";
import { redactSensitiveValue } from "./redaction.mjs";
import { withFileLock, writeJsonAtomic } from "./file-transaction.mjs";

const LIVE_RUN_EVENT_TYPES = new Set([
  "run.started",
  "parent.started",
  "parent.updated",
  "parent.terminal",
  "step.updated",
  "provider.heartbeat",
  "evidence.linked",
  "warning.raised",
  "run.terminal",
]);

const DEFAULT_MAX_REPLAY = 0;
const SERVER_MAX_REPLAY = 1000;
const JOURNAL_POLL_MS = 50;

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
  return derivePublicId([runId, "event", String(sequence).padStart(6, "0")], "event");
}

function readCursor(cursorFile, logFile, runId) {
  const events = readEventLog(logFile).filter((event) => event.run_id === runId);
  const journalSequence = events.length === 0 ? 0 : getEventSequence(events.at(-1));
  try {
    const cursor = JSON.parse(fs.readFileSync(cursorFile, "utf8"));
    if (cursor.run_id === runId && Number.isInteger(cursor.sequence) && cursor.sequence === journalSequence) return cursor.sequence;
  } catch {}
  return journalSequence;
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

function readEventLogTail(logFile, maxRecords) {
  if (!fs.existsSync(logFile) || maxRecords <= 0) return [];
  const descriptor = fs.openSync(logFile, "r");
  try {
    let position = fs.fstatSync(descriptor).size;
    let text = "";
    while (position > 0 && text.split("\n").filter(Boolean).length <= maxRecords) {
      const length = Math.min(64 * 1024, position);
      position -= length;
      const buffer = Buffer.alloc(length);
      fs.readSync(descriptor, buffer, 0, length, position);
      text = `${buffer.toString("utf8")}${text}`;
    }
    return text
      .split("\n")
      .filter(Boolean)
      .slice(-maxRecords)
      .flatMap((line) => {
        try {
          const event = JSON.parse(line);
          return typeof event === "object" && event !== null ? [event] : [];
        } catch {
          return [];
        }
      })
      .sort((left, right) => getEventSequence(left) - getEventSequence(right));
  } finally {
    fs.closeSync(descriptor);
  }
}

function appendLineDurable(logFile, line) {
  const descriptor = fs.openSync(logFile, "a");
  try {
    fs.writeSync(descriptor, line, null, "utf8");
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function runFaultHook(options, boundary) {
  if (options.faultInjectionBoundary === boundary) {
    const error = new Error(`Injected live-run-event crash at '${boundary}'.`);
    error.code = "event-append-fault-injected";
    throw error;
  }
}

function reconcileAppendTransaction(transactionFile, logFile, cursorFile) {
  if (!fs.existsSync(transactionFile)) return null;
  const transaction = JSON.parse(fs.readFileSync(transactionFile, "utf8"));
  const event = transaction.event;
  const alreadyAppended = readEventLog(logFile).some((entry) => entry.event_id === event.event_id);
  if (!alreadyAppended) appendLineDurable(logFile, `${JSON.stringify(event)}\n`);
  writeJsonAtomic(cursorFile, {
    run_id: event.run_id,
    sequence: getEventSequence(event),
    updated_at: new Date().toISOString(),
  });
  if (transaction.request_file) writeJsonAtomic(transaction.request_file, transaction.request_record);
  fs.rmSync(transactionFile, { force: true });
  return event;
}

/**
 * @param {{
 *   logFile: string,
 *   runId: string,
 *   eventType: string,
 *   payload: Record<string, unknown>,
 *   timestamp?: string,
 *   redactionPolicy?: unknown,
 *   requestKey?: string,
 *   faultInjectionBoundary?: "after-transaction" | "after-journal" | "after-cursor" | "after-request",
 * }} options
 */
export function appendLiveRunEvent(options) {
  if (!LIVE_RUN_EVENT_TYPES.has(options.eventType)) {
    throw new Error(
      `Unsupported live-run event type '${options.eventType}'. Expected one of: ${[...LIVE_RUN_EVENT_TYPES].join(", ")}.`,
    );
  }
  const runIdValidation = validatePublicId(options.runId);
  if (!runIdValidation.ok) {
    throw new Error(
      `Invalid run_id ${JSON.stringify(options.runId)} (${runIdValidation.value_class}). ${runIdValidation.migration}`,
    );
  }

  if (options.requestKey) {
    const requestKeyValidation = validatePublicId(options.requestKey);
    if (!requestKeyValidation.ok) {
      throw new Error(`Invalid request_key ${JSON.stringify(options.requestKey)} (${requestKeyValidation.value_class}).`);
    }
  }
  ensureLogDir(options.logFile);
  const redactedPayload = /** @type {Record<string, unknown>} */ (
    redactSensitiveValue(options.payload, options.redactionPolicy)
  );
  const cursorFile = `${options.logFile}.cursor.json`;
  const lockDirectory = `${options.logFile}.append.lock`;
  const transactionFile = `${options.logFile}.append-transaction.json`;
  const requestDigest = crypto
    .createHash("sha256")
    .update(JSON.stringify({ event_type: options.eventType, payload: redactedPayload, timestamp: options.timestamp ?? null }))
    .digest("hex");
  const event = withFileLock(lockDirectory, () => {
    reconcileAppendTransaction(transactionFile, options.logFile, cursorFile);
    const requestFile = options.requestKey
      ? `${options.logFile}.requests/${crypto.createHash("sha256").update(options.requestKey).digest("hex")}.json`
      : null;
    if (requestFile && fs.existsSync(requestFile)) {
      const existingRequest = JSON.parse(fs.readFileSync(requestFile, "utf8"));
      if (existingRequest.request_digest !== requestDigest) {
        const conflict = new Error(`Event request key '${options.requestKey}' was reused with a different payload.`);
        conflict.code = "event-request-conflict";
        throw conflict;
      }
      return existingRequest.event;
    }
    const nextSequence = readCursor(cursorFile, options.logFile, options.runId) + 1;
    const nextEvent = {
      event_id: buildEventId(options.runId, nextSequence),
      run_id: options.runId,
      timestamp: options.timestamp ?? new Date().toISOString(),
      event_type: options.eventType,
      payload: { sequence: nextSequence, ...redactedPayload },
      ...(options.requestKey ? { request_key: options.requestKey, request_digest: requestDigest } : {}),
    };
    const validation = validateContractDocument({
      family: "live-run-event",
      document: nextEvent,
      source: "runtime://live-run-event",
    });
    if (!validation.ok) {
      const issues = validation.issues.map((issue) => issue.message).join("; ");
      throw new Error(`Generated live-run event failed contract validation: ${issues}`);
    }
    const requestRecord = requestFile
      ? { request_key: options.requestKey, request_digest: requestDigest, event: nextEvent }
      : null;
    writeJsonAtomic(transactionFile, { event: nextEvent, request_file: requestFile, request_record: requestRecord });
    runFaultHook(options, "after-transaction");
    appendLineDurable(options.logFile, `${JSON.stringify(nextEvent)}\n`);
    runFaultHook(options, "after-journal");
    writeJsonAtomic(cursorFile, { run_id: options.runId, sequence: nextSequence, updated_at: new Date().toISOString() });
    runFaultHook(options, "after-cursor");
    if (requestFile) writeJsonAtomic(requestFile, requestRecord);
    runFaultHook(options, "after-request");
    fs.rmSync(transactionFile, { force: true });
    return nextEvent;
  });
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
  if (maxReplay === 0) {
    return {
      replayEvents: [],
      afterSequence: events.length === 0 ? 0 : getEventSequence(events.at(-1)),
    };
  }
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
 *   redactionPolicy?: unknown,
 * }} options
 */
export function openLiveRunEventStream(options) {
  const requestedReplay = Number.isInteger(options.maxReplay) && options.maxReplay >= 0
    ? options.maxReplay
    : DEFAULT_MAX_REPLAY;
  const maxReplay = Math.min(requestedReplay, SERVER_MAX_REPLAY);
  const initialJournalSize = fs.existsSync(options.logFile) ? fs.statSync(options.logFile).size : 0;
  const runEvents = readEventLogTail(options.logFile, Math.max(maxReplay + 1, 1))
    .filter((event) => event.run_id === options.runId);
  const replayWindow = resolveReplayWindow(runEvents, options.afterEventId, maxReplay);
  let lastSequence = replayWindow.afterSequence;
  if (replayWindow.replayEvents.length > 0) {
    lastSequence = getEventSequence(replayWindow.replayEvents[replayWindow.replayEvents.length - 1]);
  }

  return {
    protocol: "sse",
    run_id: options.runId,
    cursor_terminal: runEvents.at(-1)?.event_type === "run.terminal",
    reconnect_after_ms: 1000,
    backpressure: {
      policy: "bounded-replay-window",
      max_replay_events: maxReplay,
    },
    replay_events: replayWindow.replayEvents.map((event) =>
      /** @type {Record<string, unknown>} */ (redactSensitiveValue(event, options.redactionPolicy)),
    ),
    /**
     * @param {(event: Record<string, unknown>) => void} handler
     * @returns {() => void}
     */
    subscribe(handler) {
      let offset = initialJournalSize;
      let remainder = "";
      let closed = false;
      const poll = () => {
        if (closed || !fs.existsSync(options.logFile)) return;
        const size = fs.statSync(options.logFile).size;
        if (size < offset) {
          offset = 0;
          remainder = "";
        }
        if (size === offset) return;
        const length = size - offset;
        const descriptor = fs.openSync(options.logFile, "r");
        try {
          const buffer = Buffer.alloc(length);
          fs.readSync(descriptor, buffer, 0, length, offset);
          offset = size;
          const parts = `${remainder}${buffer.toString("utf8")}`.split("\n");
          remainder = parts.pop() ?? "";
          for (const line of parts) {
            if (!line.trim()) continue;
            try {
              const event = JSON.parse(line);
              if (event.run_id !== options.runId) continue;
              const sequence = getEventSequence(event);
              if (sequence <= lastSequence) continue;
              lastSequence = sequence;
              handler(/** @type {Record<string, unknown>} */ (redactSensitiveValue(event, options.redactionPolicy)));
            } catch {
              // A malformed journal line is ignored; appends are validated before write.
            }
          }
        } finally {
          fs.closeSync(descriptor);
        }
      };
      const interval = setInterval(poll, JOURNAL_POLL_MS);
      return () => {
        closed = true;
        clearInterval(interval);
      };
    },
  };
}
