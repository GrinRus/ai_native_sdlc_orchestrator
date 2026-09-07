import assert from "node:assert/strict";
import test from "node:test";

import {
  OperatorError,
  readControlPlaneJson,
} from "../src/control-plane-client.js";

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
