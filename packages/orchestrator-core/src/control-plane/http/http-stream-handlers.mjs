import { asString, readQueryInteger } from "./http-utils.mjs";
import { toHistoryEvent } from "./http-presenters.mjs";
import { writeSseEvent } from "./http-sse.mjs";
import { openRunEventStream } from "../live-event-stream.mjs";
import { CONTROL_PLANE_LIMITS, resolveBoundedInteger } from "../control-plane-limits.mjs";

/**
 * @param {{
 *   params: Record<string, string>,
 *   request: import("node:http").IncomingMessage,
 *   requestUrl: URL,
 *   response: import("node:http").ServerResponse,
 *   runtimeOptions: { cwd?: string, projectRef: string, runtimeRoot?: string, redactionPolicy?: unknown },
 * }} options
 */
export function handleRunEventStream({ params, request, requestUrl, response, runtimeOptions }) {
  const runId = params.runId;
  const afterEventId =
    asString(requestUrl.searchParams.get("after_event_id")) ?? asString(requestUrl.searchParams.get("afterEventId"));
  const requestedReplay = readQueryInteger(requestUrl.searchParams, "max_replay") ?? readQueryInteger(requestUrl.searchParams, "maxReplay");
  const maxReplay = resolveBoundedInteger(requestedReplay, CONTROL_PLANE_LIMITS.sse_replay);

  const stream = openRunEventStream({
    ...runtimeOptions,
    runId,
    afterEventId,
    maxReplay,
    redactionPolicy: runtimeOptions.redactionPolicy,
  });

  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  });

  writeSseEvent(response, {
    event: "stream.meta",
    data: {
      protocol: stream.protocol,
      backpressure: stream.backpressure,
      log_file: stream.log_file,
      run_id: runId,
    },
  });

  for (const replayEvent of stream.replay_events) {
    const payload = toHistoryEvent(replayEvent);
    writeSseEvent(response, {
      event: "live-run-event",
      id: payload.event_id,
      data: payload,
    });
  }

  let unsubscribe = () => {};
  unsubscribe = stream.subscribe((event) => {
    const payload = toHistoryEvent(event);
    const writable = writeSseEvent(response, {
      event: "live-run-event",
      id: payload.event_id,
      data: payload,
    });
    if (!writable) {
      unsubscribe();
      response.end();
    }
  });

  const onClose = () => {
    unsubscribe();
    request.off("close", onClose);
  };
  request.on("close", onClose);
}
