import { openRunEventStream } from "../../../api/src/index.mjs";
import { asArray, asNumber, asString } from "./shared.mjs";
import { openControlPlaneSseStream, readControlPlaneJson } from "./transport.mjs";
import { buildOperatorConsoleSnapshot } from "./snapshot.mjs";
import { renderOperatorConsoleHtml } from "./render.mjs";

/**
 * @param {{
 *   cwd?: string,
 *   projectRef: string,
 *   runtimeRoot?: string,
 *   runId?: string,
 *   follow?: boolean,
 *   afterEventId?: string,
 *   maxReplay?: number,
 *   controlPlane?: string,
 *   controlPlaneAuthToken?: string,
 * }} options
 */
export async function attachOperatorConsoleSession(options) {
  const snapshot = await buildOperatorConsoleSnapshot(options);
  const follow = Boolean(options.follow);
  const runId = options.runId ?? snapshot.selected_run_id;

  if (follow && !runId) {
    throw new Error("attachOperatorConsoleSession requires runId when follow mode is enabled.");
  }

  /** @type {Array<Record<string, unknown>>} */
  const liveEvents = [];
  /** @type {Set<(event: Record<string, unknown>) => void>} */
  const listeners = new Set();
  let unsubscribeStream = () => {};
  let streamProtocol = null;
  let streamBackpressure = null;
  let streamLogFile = null;
  /** @type {Promise<void> | null} */
  let streamDone = null;

  if (follow && runId) {
    if (snapshot.api_ui_contract_alignment.binding_mode === "detached-http-sse") {
      const controlPlane = asString(snapshot.api_ui_contract_alignment.control_plane);
      if (!controlPlane) {
        throw new Error("Connected mode is selected but no control-plane base URL is available.");
      }

      const maxReplay = asNumber(options.maxReplay);
      const replayLimit = maxReplay !== null ? Math.floor(maxReplay) : 50;
      const replay = await readControlPlaneJson({
        controlPlane,
        pathname: `/api/projects/${encodeURIComponent(snapshot.project.project_id)}/runs/${encodeURIComponent(runId)}/events/history`,
        query: { limit: replayLimit },
        authToken: asString(options.controlPlaneAuthToken) ?? undefined,
      });
      const replayEvents = asArray(replay.events);
      for (const event of replayEvents) {
        liveEvents.push(/** @type {Record<string, unknown>} */ (event));
      }
      const afterEventId = asString(options.afterEventId) ?? asString(replayEvents.at(-1)?.event_id);

      const stream = openControlPlaneSseStream({
        controlPlane,
        pathname: `/api/projects/${encodeURIComponent(snapshot.project.project_id)}/runs/${encodeURIComponent(runId)}/events`,
        query: {
          after_event_id: afterEventId ?? undefined,
          max_replay: replayLimit,
        },
        authToken: asString(options.controlPlaneAuthToken) ?? undefined,
        onEvent(event) {
          liveEvents.push(event);
          for (const listener of listeners) {
            listener(event);
          }
        },
      });
      streamProtocol = "sse";
      streamBackpressure = { policy: "bounded-replay-window" };
      streamDone = stream.done.catch(() => {});
      unsubscribeStream = () => {
        stream.close();
      };
    } else {
      const stream = openRunEventStream({
        cwd: options.cwd,
        projectRef: options.projectRef,
        runtimeRoot: options.runtimeRoot,
        runId,
        afterEventId: options.afterEventId,
        maxReplay: options.maxReplay,
      });
      streamProtocol = stream.protocol;
      streamBackpressure = stream.backpressure;
      streamLogFile = stream.log_file;
      for (const event of stream.replay_events) {
        liveEvents.push(event);
      }
      unsubscribeStream = stream.subscribe((event) => {
        liveEvents.push(event);
        for (const listener of listeners) {
          listener(event);
        }
      });
    }
  }

  return {
    mode: "detachable-web-console",
    follow_enabled: follow,
    stream_protocol: streamProtocol,
    stream_backpressure: streamBackpressure,
    stream_log_file: streamLogFile,
    replay_events: liveEvents,
    snapshot,
    onEvent(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async awaitStreamIdle() {
      if (streamDone) {
        await streamDone;
      }
    },
    render() {
      return renderOperatorConsoleHtml(snapshot, {
        streamProtocol,
        streamBackpressure,
        liveEventCount: liveEvents.length,
      });
    },
    detach() {
      unsubscribeStream();
      listeners.clear();
      return {
        detached: true,
        captured_event_count: liveEvents.length,
      };
    },
  };
}
