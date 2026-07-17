import assert from "node:assert/strict";
import test from "node:test";

import { attentionRows, journeyRows } from "../src/quiet-modes-model.js";

test("attention rows preserve durable items and label transient read failures", () => {
  const rows = attentionRows({ items: [{ item_id: "attention.one", state: "running" }] }, {
    next: { title: "Next action unavailable", consequence: "Last-known state remains visible." },
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].transient_read_error, true);
  assert.equal(rows[0].state, "needs-attention");
  assert.equal(rows[1].item_id, "attention.one");
});

test("journey rows retain blocking task, run, and delivery truth", () => {
  const rows = journeyRows({ progress: { tasks: [{ task_id: "task.one", status: "blocked" }] } }, [{ run_id: "run.one", status: "failed" }], [{ manifest_id: "delivery.one", status: "partial" }]);
  assert.deepEqual(rows.map((row) => row.status), ["blocked", "failed", "partial"]);
});
