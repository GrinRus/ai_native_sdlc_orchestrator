import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  TASK_ACTION_CATALOG,
  getTaskActionCatalog,
  getTaskActionDefinition,
  validateTaskActionPayload,
} from "../src/control-plane/task-action-catalog.mjs";

test("Task action catalog is unique, typed, and transport-neutral", () => {
  const ids = TASK_ACTION_CATALOG.map((entry) => entry.action_id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes("start"));
  assert.ok(ids.includes("discovery-run"));
  assert.ok(ids.includes("closure-complete"));
  for (const entry of getTaskActionCatalog()) {
    assert.match(entry.action_id, /^[a-z][a-z0-9.-]*$/u);
    assert.ok(["read", "mutate"].includes(entry.permission));
    assert.equal(typeof entry.dispatch, "string");
    assert.equal(typeof entry.payload, "object");
    for (const rule of Object.values(entry.payload)) {
      assert.ok(["integer", "string", "string[]"].includes(rule.type));
      assert.equal(typeof rule.required, "boolean");
    }
  }
});

test("catalog payload validation enforces CAS and required operator input", () => {
  assert.equal(validateTaskActionPayload("start", { action: "start", expected_revision: 3 }).ok, true);
  assert.equal(validateTaskActionPayload("start", { action: "start" }).ok, true);
  assert.equal(validateTaskActionPayload("start", { action: "start", expected_revision: -1 }).code, "task.invalid_payload");
  assert.equal(validateTaskActionPayload("request", { action: "request" }).code, "task.invalid_payload");
  assert.equal(validateTaskActionPayload("not-published", { action: "not-published" }).code, "task.unknown_action");
  assert.equal(getTaskActionDefinition("discovery-run").lifecycle_command, "discovery run");
});

test("OpenAPI Task action enum is generated from the published catalog surface", () => {
  const openapi = JSON.parse(fs.readFileSync(path.resolve("docs/contracts/control-plane-api.openapi.json"), "utf8"));
  const schema = openapi.components.schemas.TaskActionRequest;
  assert.deepEqual(new Set(schema.properties.action.enum), new Set(TASK_ACTION_CATALOG.map((entry) => entry.action_id)));
});
