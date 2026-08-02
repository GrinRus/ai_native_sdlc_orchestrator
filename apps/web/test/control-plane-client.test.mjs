import assert from "node:assert/strict";
import test from "node:test";

import {
  OperatorError,
  createProjectGeneration,
  readControlPlaneJson,
  readResourceSnapshot,
} from "../src/control-plane-client.js";
import { EMPTY_PROJECT_SNAPSHOT, reduceProjectSnapshot } from "../src/project-snapshot.js";

test("control-plane client preserves structured OperatorError semantics", async () => {
  const fetchImpl = async () => new Response(JSON.stringify({
    error: {
      code: "project_state_unavailable",
      title: "Project state unavailable",
      detail: "The durable project state could not be read.",
      consequence: "Mutations are disabled.",
      retryable: true,
      evidence_refs: ["evidence://project/state"],
      recovery_actions: [{ action_id: "retry" }],
    },
  }), { status: 503 });
  await assert.rejects(
    readControlPlaneJson("/state", {}, fetchImpl),
    (error) => error instanceof OperatorError
      && error.title === "Project state unavailable"
      && error.consequence === "Mutations are disabled."
      && error.retryable
      && error.evidenceRefs.length === 1,
  );
});

test("project generation aborts old work and rejects stale revisions", () => {
  const generation = createProjectGeneration();
  const first = generation.begin();
  const second = generation.begin();
  assert.equal(first.signal.aborted, true);
  assert.equal(generation.isCurrent(first.revision), false);
  assert.equal(generation.isCurrent(second.revision), true);
});

test("partial snapshots retain last-known data and expose per-resource errors", async () => {
  const snapshot = await readResourceSnapshot({
    runs: async () => [{ run_id: "run-2" }],
    packets: async () => {
      throw new OperatorError({ code: "packets_unavailable", detail: "Packets unavailable" }, 503);
    },
  }, { packets: [{ packet_id: "packet-1" }] });
  assert.equal(snapshot.status, "partial");
  assert.deepEqual(snapshot.data.packets, [{ packet_id: "packet-1" }]);
  assert.deepEqual(snapshot.data.runs, [{ run_id: "run-2" }]);
  assert.equal(snapshot.errors.packets.code, "packets_unavailable");
});

test("snapshot reducer ignores responses from a previous project generation", () => {
  const current = reduceProjectSnapshot(EMPTY_PROJECT_SNAPSHOT, { type: "loading", generation: 2 });
  const stale = reduceProjectSnapshot(current, {
    type: "loaded",
    generation: 1,
    status: "connected",
    data: { projectId: "old-project" },
  });
  assert.equal(stale, current);
});
