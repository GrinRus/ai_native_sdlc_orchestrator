import assert from "node:assert/strict";
import test from "node:test";

import { guidedBrowserTaskCollectorPythonSource } from "../lib/browser-proof-python-source.mjs";

test("guided browser collector keeps dialog proof reachable while run controls block Ask AOR", () => {
  const source = guidedBrowserTaskCollectorPythonSource();
  assert.match(source, /add-project/u);
  assert.match(source, /get_by_role\("button", name="Add AOR Project", exact=True\)/u);
  assert.match(source, /dialog_probe\["focus_restored"\] = dialog_opener\.evaluate/u);
});

test("guided browser collector injects and recovers a real public resource failure", () => {
  const source = guidedBrowserTaskCollectorPythonSource();
  assert.match(source, /resource_url = f"\{payload\['control_plane'\]\}\/api\/projects/u);
  assert.match(source, /execution-profile/u);
  assert.match(source, /page\.route\(resource_url, abort_resource, times=1\)/u);
  assert.match(source, /name="Refresh setup", exact=True/u);
  assert.match(source, /error_feedback_observed/u);
  assert.match(source, /"recovered": error_recovered/u);
});

test("guided browser collector separates handled optional 404 noise from unexpected console errors", () => {
  const source = guidedBrowserTaskCollectorPythonSource();
  assert.match(source, /observed_optional_404_console/u);
  assert.match(source, /if injection_active\["value"\]/u);
});
