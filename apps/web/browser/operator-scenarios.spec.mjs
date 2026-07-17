import { spawnSync } from "node:child_process";
import fs from "node:fs";

import { expect, test } from "@playwright/test";

import { readHarnessState } from "./harness.mjs";
import { loadGoldenLifecycle } from "./golden-lifecycle-loader.mjs";
import { applyOperatorScenarioFixture, loadOperatorAcceptanceFixtures, loadOperatorScenarioCatalog } from "./operator-scenario-loader.mjs";

const viewport = { desktop: { width: 1440, height: 900 }, tablet: { width: 900, height: 1100 }, mobile: { width: 390, height: 844 } };

test("operator scenario catalog loads through the disposable installed SPA", async ({ page }) => {
  const state = readHarnessState();
  const catalog = loadOperatorScenarioCatalog();
  const allowedOrigin = new URL(state.app_url).origin;
  const externalRequests = [];
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === allowedOrigin || ["data:", "blob:"].includes(url.protocol)) return route.continue();
    externalRequests.push(url.href);
    return route.abort("blockedbyclient");
  });

  for (const scenario of catalog.scenarios) {
    await page.setViewportSize(viewport[scenario.coverage.viewports[0]]);
    await page.goto(`${state.app_url}?operator-scenario=${scenario.id}`);
    await expect(page.locator("main")).toBeVisible();
    const loaded = await applyOperatorScenarioFixture(page, scenario);
    expect(loaded.id).toBe(scenario.id);
    expect(loaded.authoritative_evidence.length).toBeGreaterThan(0);
    if (scenario.coverage.keyboard) {
      await page.keyboard.press("Tab");
      await expect(page.locator(":focus")).toBeVisible();
    }
  }
  expect(externalRequests).toEqual([]);
});

test("installed Quiet Cockpit passes the blocking shell acceptance matrix", async ({ page }) => {
  const state = readHarnessState();
  const manifest = loadOperatorAcceptanceFixtures();
  expect(state.installed_bin).toContain("node_modules/@grinrus/aor/apps/cli/bin/aor.mjs");
  expect(state.package_name).toBe("@grinrus/aor");

  await page.goto(state.app_url);
  await expect(page.locator('[data-console-experience="legacy"]')).toBeVisible();
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const viewport of manifest.viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto(`${state.app_url}?console=quiet-cockpit`);
    await expect(page.locator('[data-console-experience="quiet-cockpit"]')).toBeVisible();
    await expect(page.getByRole("region", { name: "Quiet Cockpit navigation" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.keyboard.press("Tab");
    await expect(page.locator(":focus")).toBeVisible();
  }
  await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  expect(fs.readdirSync(state.launcher_root)).toEqual([]);
  const status = spawnSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: state.project_root, encoding: "utf8" });
  expect(status.status).toBe(0);
  expect(status.stdout.split("\n").filter(Boolean).every((line) => line.slice(3).startsWith(".aor/"))).toBe(true);
  const remotes = spawnSync("git", ["remote", "-v"], { cwd: state.project_root, encoding: "utf8" });
  expect(remotes.status).toBe(0);
  expect(remotes.stdout).toBe("");
});

test("installed Quiet Cockpit executes the canonical no-write lifecycle with durable readback", async ({ page }) => {
  test.setTimeout(120_000);
  const state = readHarnessState();
  const journey = loadGoldenLifecycle();
  const flow = { flow_id: `flow.${state.project_id}.golden`, status: "active", selected_stage: "readiness", evidence_refs: [] };
  let transitionIndex = 0;
  let pendingAdvance = false;
  let staleInjected = false;
  const attempts = [];
  const durableRefs = new Map();
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

  await page.route(new RegExp(`/api/projects/${state.project_id}/state$`, "u"), (route) => json(route, { project_id: state.project_id, initialized: true, state: "ready", stage: journey.transitions[Math.min(transitionIndex, journey.transitions.length - 1)].stage, runtime_root: state.runtime_root, state_file: `${state.runtime_root}/project-state.json`, onboarding_summary: { initialized: true, state_exists: true } }));
  await page.route(new RegExp(`/api/projects/${state.project_id}/flows$`, "u"), (route) => json(route, { flows: [flow], selected_flow_id: flow.flow_id }));
  await page.route("**/flows/selected", (route) => json(route, { ...flow, selected_stage: journey.transitions[Math.min(transitionIndex, journey.transitions.length - 1)].stage }));
  await page.route("**/next-action-report", (route) => {
    const transition = journey.transitions[Math.min(transitionIndex, journey.transitions.length - 1)];
    json(route, { status: "ready", project_state: { stage: transition.stage, runtime_root: state.runtime_root }, blockers: [], primary_action: { action_id: transition.transition_id, command: transition.command, reason: transition.recovery, evidence_refs: [...durableRefs.values()], operator_control: { category: "mutation", label: transition.label, availability: "ready", operation: { command: transition.command, flags: transition.flags }, target_surface: "cockpit", requires_confirmation: false } } });
  });
  await page.route(new RegExp(`/api/projects/${state.project_id}/(packets|step-results|runs|delivery-manifests|operator-requests)$`, "u"), (route) => json(route, []));
  await page.route("**/evidence-graph", (route) => json(route, { flow_id: flow.flow_id, nodes: [], edges: [], isolation: { mode: "selected-flow-only" } }));
  await page.route("**/runtime-trace", (route) => json(route, { flow_id: flow.flow_id, events: [] }));
  await page.route("**/attention", (route) => json(route, { project_id: state.project_id, flow_id: flow.flow_id, initialized: true, read_only: true, freshness: "current", latest_source_at: null, items: [] }));
  await page.route("**/plan/progress", (route) => json(route, { task_progress: { tasks: [] } }));
  await page.route("**/plan", (route) => json(route, { plan_ref: null, plan: null }));
  await page.route("**/lifecycle-command/actions", (route) => {
    const payload = route.request().postDataJSON();
    const transition = journey.transitions[Math.min(transitionIndex, journey.transitions.length - 1)];
    attempts.push({ transition_id: transition.transition_id, command: payload.command });
    if (payload.command === "next") {
      if (pendingAdvance) { transitionIndex += 1; pendingAdvance = false; }
      return json(route, { lifecycle_command: { command: "next", blocked: false, artifact_refs: [], evidence_refs: [] } });
    }
    expect(payload).toEqual({ command: transition.command, flags: transition.flags });
    if (transition.transition_id === "approval" && !staleInjected) {
      staleInjected = true;
      return json(route, { error: { code: "plan.stale_revision", title: "Plan revision changed", detail: "Refresh the approved revision and retry.", operation: "handoff approve", phase: "validation", retryable: true, field_errors: [], evidence_refs: [], recovery_actions: [] } }, 409);
    }
    const ref = `evidence://golden/${transition.transition_id}.json`;
    durableRefs.set(transition.transition_id, ref);
    pendingAdvance = true;
    return json(route, { lifecycle_command: { command: transition.command, blocked: false, artifact_refs: [ref], evidence_refs: [] } });
  });

  await page.goto(`${state.app_url}?console=quiet-cockpit`);
  for (const [index, transition] of journey.transitions.entries()) {
    const action = page.getByRole("button", { name: transition.label, exact: true });
    await expect(action).toBeVisible();
    await action.click();
    if (transition.transition_id === "approval") {
      await expect(page.getByText(`${transition.label} failed`, { exact: false })).toBeVisible();
      await action.click();
    }
    await expect(page.getByText(`${transition.label} completed`, { exact: false })).toBeVisible();
    expect(durableRefs.get(transition.transition_id)).toBe(`evidence://golden/${transition.transition_id}.json`);
    if ([3, 8, 12].includes(index)) await page.reload();
  }
  expect(durableRefs.size).toBe(journey.transitions.length);
  expect(new Set(durableRefs.values()).size).toBe(journey.transitions.length);
  expect(attempts.filter((entry) => entry.command !== "next")).toHaveLength(journey.transitions.length + 1);
  expect(journey.external_network || journey.target_source_writes || journey.upstream_writes).toBe(false);
});
