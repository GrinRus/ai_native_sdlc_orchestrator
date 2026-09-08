import assert from "node:assert/strict";
import test from "node:test";

import { guidedBrowserTaskCollectorPythonSource } from "../lib/browser-proof-python-source.mjs";

test("guided browser collector keeps dialog proof reachable across installed Task Workspace surfaces", () => {
  const source = guidedBrowserTaskCollectorPythonSource();
  assert.match(source, /chromium\.launch\(headless=True, args=\["--no-proxy-server"\]\)/u);
  assert.match(source, /add-project/u);
  assert.match(source, /get_by_role\("button", name="Add AOR Project", exact=True\)/u);
  assert.match(source, /probe_dialog\(page\.get_by_role\("button", name="Add Markdown", exact=True\), "task-sources"\)/u);
  assert.match(source, /dialog_probe\["focus_restored"\] = dialog_opener\.evaluate/u);
});

test("guided browser collector injects and recovers a real Task Workspace resource failure", () => {
  const source = guidedBrowserTaskCollectorPythonSource();
  assert.match(source, /resource_url = f"\{payload\['control_plane'\]\}\/api\/projects/u);
  assert.match(source, /\/tasks"/u);
  assert.match(source, /page\.route\(resource_url, abort_resource, times=1\)/u);
  assert.match(source, /name="Retry", exact=True/u);
  assert.match(source, /Tasks are temporarily unavailable\./u);
  assert.match(source, /error_feedback_observed/u);
  assert.match(source, /"recovered": error_recovered/u);
  assert.match(source, /page\.locator\("\.task-workspace__card"\)\.count\(\) >= 2/u);
  assert.match(source, /name="Needs decision", exact=False/u);
});

test("guided browser collector separates handled optional 404 noise from unexpected console errors", () => {
  const source = guidedBrowserTaskCollectorPythonSource();
  assert.match(source, /observed_optional_404_console/u);
  assert.match(source, /if injection_active\["value"\]/u);
});

test("guided browser collector waits for ready project state before every viewport screenshot", () => {
  const source = guidedBrowserTaskCollectorPythonSource();
  assert.match(source, /def wait_for_ready\(\):/u);
  assert.match(source, /def safe_reload\(\):/u);
  assert.match(source, /def wait_for_ready_with_retry\(\):/u);
  const viewportReload = source.indexOf('safe_reload()\n            viewport_readiness = wait_for_ready_with_retry()');
  const viewportCapture = source.indexOf('page.screenshot(path=viewport_screenshot, full_page=False)');
  assert.ok(viewportReload >= 0, "viewport reload should wait for durable project readiness");
  assert.ok(viewportReload < viewportCapture, "readiness must be checked before the viewport screenshot");
  assert.match(source, /viewport_readiness\.get\("status"\) != "pass"/u);
});

test("guided browser collector proves the canonical Task Workspace before responsive captures", () => {
  const source = guidedBrowserTaskCollectorPythonSource();
  const taskWorkspaceProbe = source.indexOf('page.get_by_role("button", name="New task", exact=True)');
  const taskWorkspaceCapture = source.indexOf('page.screenshot(path=task_workspace_screenshot, full_page=False)');
  const viewportReload = source.indexOf('safe_reload()\n            viewport_readiness = wait_for_ready_with_retry()');
  assert.ok(taskWorkspaceProbe >= 0, "collector should enter the canonical Task Workspace from Project Home");
  assert.ok(taskWorkspaceCapture > taskWorkspaceProbe, "collector should capture the Task Workspace after entering it");
  assert.ok(viewportReload > taskWorkspaceCapture, "responsive captures should run after the Task Workspace assertion");
  assert.match(source, /post_reload_readiness = wait_for_ready_with_retry\(\)/u);
  assert.match(source, /get_by_role\("heading", name="New Task", exact=True\)/u);
  assert.match(source, /get_by_role\("heading", name="Prepared Task", exact=True\)/u);
  assert.match(source, /"task_workspace_probe": task_workspace_probe/u);
  assert.doesNotMatch(source, /Continue Flow|flow-cockpit|cockpit_probe/u);
});
