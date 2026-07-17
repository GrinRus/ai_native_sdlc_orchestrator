import assert from "node:assert/strict";
import test from "node:test";
import { operatorControlTargetTab, resolveOperatorControl } from "../src/operator-control.js";

test("embedded operator controls preserve structured operations without shell parsing", () => {
  const control = resolveOperatorControl({
    action_id: "discovery-run",
    command: "aor discovery run --input-packet 'unsafe shell text'",
    operator_control: {
      category: "mutation",
      label: "Create discovery evidence",
      availability: "ready",
      operation: { command: "discovery run", flags: { "input-packet": "evidence://intake.json" } },
      target_surface: "cockpit",
      requires_confirmation: false,
    },
  });
  assert.deepEqual(control.operation, { command: "discovery run", flags: { "input-packet": "evidence://intake.json" } });
  assert.equal(control.label, "Create discovery evidence");
  assert.equal(control.source, "report");
});

test("legacy controls use only the bounded action-id registry", () => {
  assert.equal(resolveOperatorControl({ action_id: "spec-build", command: "hostile command" }).operation.command, "spec build");
  const unknown = resolveOperatorControl({ action_id: "unknown", command: "aor discovery run" });
  assert.equal(unknown.availability, "blocked");
  assert.equal(unknown.operation, null);
  assert.equal(operatorControlTargetTab({ targetSurface: "evidence" }), "evidence");
});
