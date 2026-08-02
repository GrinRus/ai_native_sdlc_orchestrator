import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../src/execution-setup.jsx", import.meta.url), "utf8");

test("Execution Setup uses approved route IDs and canonical readiness states", () => {
  assert.match(source, /approved_routes/u);
  assert.match(source, /Approved route preset/u);
  assert.doesNotMatch(source, /type=["']text["'][^>]*(provider|model)/iu);
  for (const status of [
    "runner-missing",
    "auth-missing",
    "model-unsupported",
    "capability-mismatch",
    "policy-denied",
    "stale",
  ]) {
    assert.match(source, new RegExp(status, "u"));
  }
  assert.match(source, /No provider process is started/u);
  assert.match(source, /Simulation/u);
});

test("Execution Setup keeps route mutation behind an accessible write preview", () => {
  assert.match(source, /Confirm execution route change/u);
  assert.match(source, /expected_revision|onAction/u);
  assert.match(source, /aria-live="polite"/u);
});
