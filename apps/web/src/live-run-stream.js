export function subscribeToLiveRunEvents({
  eventSourceUrl,
  onEvent,
  EventSourceImpl = globalThis.EventSource,
  scheduleRetry = (callback, delay) => globalThis.setTimeout(callback, delay),
  cancelRetry = (handle) => globalThis.clearTimeout(handle),
  retryDelayMs = 1000,
}) {
  let closed = false;
  let cursor = "";
  let source = null;
  let retryHandle = null;

  const connect = () => {
    if (closed) return;
    const query = new URLSearchParams({ maxReplay: "0" });
    if (cursor) query.set("after_event_id", cursor);
    const nextSource = new EventSourceImpl(`${eventSourceUrl}?${query}`);
    source = nextSource;
    const consume = (event) => {
      if (event.lastEventId) cursor = event.lastEventId;
      onEvent(event);
    };
    nextSource.addEventListener("live-run-event", consume);
    nextSource.addEventListener("message", consume);
    nextSource.onerror = () => {
      nextSource.close();
      if (source === nextSource) source = null;
      if (closed || retryHandle !== null) return;
      retryHandle = scheduleRetry(() => {
        retryHandle = null;
        connect();
      }, retryDelayMs);
    };
  };

  connect();
  return () => {
    if (closed) return;
    closed = true;
    if (retryHandle !== null) {
      cancelRetry(retryHandle);
      retryHandle = null;
    }
    source?.close();
    source = null;
  };
}
