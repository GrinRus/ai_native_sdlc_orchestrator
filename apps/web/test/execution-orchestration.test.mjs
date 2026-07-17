import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { deliveryTransactionRows, executeOrchestrationCommand, integrationCommand, parentRunRows } from "../src/execution-orchestration-model.js";

const source = fs.readFileSync(new URL("../src/execution-orchestration.jsx", import.meta.url), "utf8");

test("execution workbench distinguishes parent, unit, attempt, integration, and delivery truth", () => {
  for (const label of ["Execution units", "Integration and recovery", "Coordinated delivery", "Attempts", "Changed paths"]) {
    assert.match(source, new RegExp(label, "u"));
  }
  assert.match(source, /Partial delivery is not success/u);
  assert.match(source, /Serialized:/u);
  assert.match(source, /aria-label/u);
});

test("execution projections stay flow scoped and partial delivery remains failed", () => {
  const parents = parentRunRows([
    { run_id: "parent-a", flow_id: "flow-a", parent_run: { parent_run_id: "parent-a", revision: 2 } },
    { run_id: "parent-b", flow_id: "flow-b", parent_run: { parent_run_id: "parent-b", revision: 1 } },
  ], "flow-a");
  assert.deepEqual(parents.map((entry) => entry.parent_run_id), ["parent-a"]);
  const transactions = deliveryTransactionRows([{ document: {
    manifest_id: "manifest-1",
    status: "failed",
    coordination_transaction: { status: "partial", failed_repo_ids: ["frontend"] },
    repo_deliveries: [{ repo_id: "backend", transaction_stage: "complete" }, { repo_id: "frontend", transaction_stage: "failed" }],
  } }]);
  assert.equal(transactions[0].partial, true);
  assert.equal(transactions[0].status, "partial");
});

test("recovery commands use revisioned canonical lifecycle operations", () => {
  const parent = { parent_run_id: "parent-a", revision: 4 };
  assert.deepEqual(integrationCommand("hold", parent), {
    command: "run integration",
    flags: { "parent-run-id": "parent-a", action: "hold", "command-id": "parent-a-hold-5", "expected-revision": 4 },
  });
  assert.deepEqual(integrationCommand("retry", parent, { execution_unit_id: "unit-a" }), {
    command: "run retry",
    flags: { "parent-run-id": "parent-a", "execution-unit-id": "unit-a", "command-id": "parent-a-retry-5", "expected-revision": 4 },
  });
});

test("orchestration mutations refresh durable state and release busy state", async () => {
  const events = [];
  await executeOrchestrationCommand({
    request: { command: "run integration", flags: { action: "verify" } },
    busy: false,
    runLifecycle: async (command, flags) => events.push([command, flags]),
    refresh: async (options) => events.push(["refresh", options]),
    setBusy: (value) => events.push(["busy", value]),
    setError: (value) => events.push(["error", value]),
  });
  assert.deepEqual(events, [
    ["busy", true], ["error", ""], ["run integration", { action: "verify" }],
    ["refresh", { silent: true }], ["busy", false],
  ]);
});
