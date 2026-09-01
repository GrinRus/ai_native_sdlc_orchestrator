import assert from "node:assert/strict";
import test from "node:test";

import { subscribeToLiveRunEvents } from "../src/live-run-stream.js";

test("live-run stream preserves its cursor across retry and stops retry after cleanup", () => {
  const sources = [];
  const scheduled = new Map();
  let nextTimerId = 1;
  let lastScheduledCallback = null;
  const events = [];

  class FakeEventSource {
    constructor(url) {
      this.url = url;
      this.closed = false;
      this.listeners = new Map();
      sources.push(this);
    }

    addEventListener(type, listener) {
      this.listeners.set(type, listener);
    }

    emit(type, event) {
      this.listeners.get(type)?.(event);
    }

    close() {
      this.closed = true;
    }
  }

  const stop = subscribeToLiveRunEvents({
    eventSourceUrl: "/api/projects/project-a/runs/run-a/events",
    onEvent: (event) => events.push(event.lastEventId),
    EventSourceImpl: FakeEventSource,
    scheduleRetry: (callback) => {
      const timerId = nextTimerId;
      nextTimerId += 1;
      lastScheduledCallback = callback;
      scheduled.set(timerId, callback);
      return timerId;
    },
    cancelRetry: (timerId) => scheduled.delete(timerId),
  });

  assert.equal(sources.length, 1);
  sources[0].emit("live-run-event", { lastEventId: "event-1" });
  assert.deepEqual(events, ["event-1"]);

  sources[0].onerror();
  assert.equal(sources[0].closed, true);
  assert.equal(scheduled.size, 1);
  const [firstTimerId, firstRetry] = scheduled.entries().next().value;
  scheduled.delete(firstTimerId);
  firstRetry();

  assert.equal(sources.length, 2);
  assert.match(sources[1].url, /after_event_id=event-1/u);
  sources[1].onerror();
  assert.equal(scheduled.size, 1);
  stop();
  assert.equal(sources[1].closed, true);
  assert.equal(scheduled.size, 0);

  lastScheduledCallback();
  assert.equal(sources.length, 2, "a retry callback retained by the host must fail closed after cleanup");
});
