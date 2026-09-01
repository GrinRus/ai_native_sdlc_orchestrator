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
  assert.match(source, /name="Refresh", exact=True/u);
  assert.match(source, /name="Refresh setup", exact=True/u);
  assert.match(source, /def resolve_refresh_button\(\):/u);
  assert.match(source, /details\.project-settings-disclosure/u);
  assert.match(source, /:scope > summary/u);
  assert.match(source, /settings\.get_attribute\("open"\)/u);
  assert.match(source, /reconnect_readiness = wait_for_ready\(\)/u);
  assert.match(source, /error_feedback_observed/u);
  assert.match(source, /"recovered": error_recovered/u);
  assert.ok(
    source.indexOf("page.wait_for_timeout(1500)") <
      source.indexOf('get_by_role("button", name="Refresh setup", exact=True)'),
    "the post-reconnect DOM must settle before the refresh control is resolved",
  );
});

test("guided browser collector separates handled optional 404 noise from unexpected console errors", () => {
  const source = guidedBrowserTaskCollectorPythonSource();
  assert.match(source, /observed_optional_404_console/u);
  assert.match(source, /if injection_active\["value"\]/u);
});

test("guided browser collector waits for ready project state before every viewport screenshot", () => {
  const source = guidedBrowserTaskCollectorPythonSource();
  assert.match(source, /def wait_for_ready\(\):/u);
  const viewportReload = source.indexOf('page.reload(wait_until="domcontentloaded", timeout=timeout_ms)\n            viewport_readiness = wait_for_ready()');
  const viewportCapture = source.indexOf('page.screenshot(path=viewport_screenshot, full_page=True)');
  assert.ok(viewportReload >= 0, "viewport reload should wait for durable project readiness");
  assert.ok(viewportReload < viewportCapture, "readiness must be checked before the viewport screenshot");
  assert.match(source, /viewport_readiness\.get\("status"\) != "pass"/u);
});

test("guided browser collector proves the canonical Task Workspace before responsive captures", () => {
  const source = guidedBrowserTaskCollectorPythonSource();
  const taskWorkspaceProbe = source.indexOf('page.get_by_role("button", name="New task", exact=True)');
  const taskWorkspaceCapture = source.indexOf('page.screenshot(path=task_workspace_screenshot, full_page=True)');
  const viewportReload = source.indexOf('page.reload(wait_until="domcontentloaded", timeout=timeout_ms)\n            viewport_readiness = wait_for_ready()');
  assert.ok(taskWorkspaceProbe >= 0, "collector should enter the canonical Task Workspace from Project Home");
  assert.ok(taskWorkspaceCapture > taskWorkspaceProbe, "collector should capture the Task Workspace after entering it");
  assert.ok(viewportReload > taskWorkspaceCapture, "responsive captures should run after the Task Workspace assertion");
  assert.match(source, /post_reload_readiness = wait_for_ready\(\)/u);
  assert.match(source, /get_by_role\("heading", name="New Task", exact=True\)/u);
  assert.match(source, /get_by_role\("heading", name="Prepared Task", exact=True\)/u);
  assert.match(source, /"task_workspace_probe": task_workspace_probe/u);
  assert.doesNotMatch(source, /Continue Flow|flow-cockpit|cockpit_probe/u);
});
