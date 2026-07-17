import fs from "node:fs";

import { expect, test } from "@playwright/test";

import { readHarnessState } from "./harness.mjs";

const viewports = [
  { id: "desktop", width: 1440, height: 1000 },
  { id: "tablet", width: 900, height: 1100 },
  { id: "mobile", width: 390, height: 844 },
];

async function blockExternalNetwork(page, appUrl) {
  const allowedOrigin = new URL(appUrl).origin;
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === allowedOrigin || url.protocol === "data:" || url.protocol === "blob:") {
      await route.continue();
      return;
    }
    await route.abort("blockedbyclient");
  });
}

test.describe.serial("installed local operator console", () => {
  test("clean first load is non-materializing and responsive", async ({ page }) => {
    const state = readHarnessState();
    await blockExternalNetwork(page, state.app_url);
    const failures = [];
    page.on("console", (message) => {
      if (message.type() === "error") failures.push(`console: ${message.text()}`);
    });
    page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
    page.on("requestfailed", (request) => failures.push(`request: ${request.method()} ${request.url()}`));

    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.goto(state.app_url);
      await expect(page.getByText("Initialize Project Runtime").first()).toBeVisible();
      await expect(page.locator("#project-switcher-control")).toBeVisible();
      const appConfig = await page.request.get(`${new URL(state.app_url).origin}/app-config.json`).then((response) => response.json());
      await expect(page.getByText(`v${appConfig.version}`)).toHaveText(`v${appConfig.version}`);
      expect(fs.existsSync(state.runtime_root), `${viewport.id} first load created runtime`).toBe(false);
    }
    expect(failures).toEqual([]);
  });

  test("Project Structure is readable without initialization", async ({ page }) => {
    const state = readHarnessState();
    await blockExternalNetwork(page, state.app_url);
    await page.goto(state.app_url);
    await expect(page.getByRole("heading", { name: "Project Structure" })).toBeVisible();
    await page.getByRole("tab", { name: "Repositories" }).click();
    await expect(page.getByRole("button", { name: "Add repository" })).toBeVisible();
    await page.getByRole("tab", { name: "Validation" }).click();
    await expect(page.getByRole("button", { name: "Validate topology" })).toBeVisible();
    expect(fs.existsSync(state.runtime_root)).toBe(false);
  });

  test("Execution Setup selects only approved presets and keeps simulation truthful", async ({ page }) => {
    const state = readHarnessState();
    await blockExternalNetwork(page, state.app_url);
    const secretCanary = "aor-browser-secret-canary";
    let mutationCount = 0;
    const profile = {
      profile_id: `execution-profile.${state.project_id}`,
      project_id: state.project_id,
      revision: 7,
      initialized: true,
      read_only: true,
      latest_readiness_ref: null,
      routes: [{
        step: "implement",
        route_id: "route.implement.simulation",
        mode: "simulation",
        runner: "mock",
        adapter: "mock-runner",
        provider: "mock",
        requested_model: null,
        effective_model: null,
        model_source: "adapter-default",
        required_capabilities: [],
        fallback: { count: 0, route_ids: [] },
        qualification: "deterministic",
        readiness: "ready",
        blocker_codes: [],
        approved_routes: [
          {
            route_id: "route.implement.simulation",
            mode: "simulation",
            route_class: "deterministic",
            risk_tier: "low",
            provider: "mock",
            requested_model: null,
            required_capabilities: [],
            qualification: "deterministic",
          },
          {
            route_id: "route.implement.live",
            mode: "live",
            route_class: "coding",
            risk_tier: "medium",
            provider: "openai",
            requested_model: "coding-primary",
            required_capabilities: ["repo_write"],
            qualification: "project-approved",
          },
        ],
      }],
    };
    await page.route(new RegExp(`/api/projects/${state.project_id}/execution-profile$`, "u"), (route) => route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(profile),
    }));
    await page.route(new RegExp(`/api/projects/${state.project_id}/execution-profile/actions$`, "u"), async (route) => {
      mutationCount += 1;
      const request = route.request().postDataJSON();
      expect(request).toEqual({
        action: "select",
        step: "implement",
        route_id: "route.implement.live",
        expected_revision: 7,
      });
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          execution_profile: {
            ...profile,
            revision: 8,
            routes: [{ ...profile.routes[0], route_id: request.route_id, mode: "live", readiness: "stale" }],
          },
          readiness_report: null,
          diagnostic: secretCanary,
        }),
      });
    });
    await page.goto(state.app_url);
    await expect(page.getByRole("heading", { name: "Execution Setup" })).toBeVisible();
    await expect(page.getByText("Simulation", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Approved route preset")).toHaveCount(1);
    await expect(page.getByLabel(/provider/i)).toHaveCount(0);
    await expect(page.getByLabel(/model/i)).toHaveCount(0);
    await page.getByLabel("Approved route preset").selectOption("route.implement.live");
    await page.getByRole("button", { name: "Select route" }).click();
    const dialog = page.getByRole("dialog", { name: "Confirm execution route change" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("No provider process is started.")).toBeVisible();
    await dialog.getByRole("button", { name: "Confirm route change" }).click();
    await expect.poll(() => mutationCount).toBe(1);
    await expect(page.getByText(secretCanary)).toHaveCount(0);
  });

  test("explicit initialization has durable readback and truthful action semantics", async ({ page }) => {
    const state = readHarnessState();
    await blockExternalNetwork(page, state.app_url);
    await page.goto(state.app_url);
    const action = page.getByRole("button", { name: "Initialize Project Runtime" });
    await expect(action).toBeVisible();
    await action.click();
    await expect(page.getByText("Configure First Flow").first()).toBeVisible();
    const stateResponse = await page.request.get(
      `${new URL(state.app_url).origin}/api/projects/${encodeURIComponent(state.project_id)}/state`,
    );
    const projectState = await stateResponse.json();
    expect(projectState.initialized).toBe(true);
    expect(fs.existsSync(projectState.state_file)).toBe(true);
    await page.reload();
    await expect(page.getByText("Configure First Flow").first()).toBeVisible();
  });

  test("opt-in Quiet Cockpit creates one structured Mission and restores durable refs", async ({ page }) => {
    const state = readHarnessState();
    await blockExternalNetwork(page, state.app_url);
    const lifecycleCommands = [];
    page.on("request", (request) => {
      if (!request.url().endsWith("/lifecycle-command/actions") || request.method() !== "POST") return;
      lifecycleCommands.push(request.postDataJSON()?.command);
    });
    await page.goto(`${state.app_url}?console=quiet-cockpit`);
    await expect(page.locator('[data-console-experience="quiet-cockpit"]')).toBeVisible();
    await page.getByRole("button", { name: "Configure First Flow" }).click();
    await expect(page.getByRole("form", { name: "Guided Mission intake" })).toBeVisible();

    await page.getByRole("button", { name: "Clear form" }).click();
    await page.getByRole("button", { name: "Create Mission evidence" }).click();
    await expect(page.getByLabel("Mission title")).toBeFocused();
    expect(lifecycleCommands).toEqual([]);

    await page.getByRole("button", { name: "Load safe walkthrough" }).click();
    await page.getByRole("button", { name: "Create Mission evidence" }).click();
    await expect.poll(() => lifecycleCommands).toEqual(["mission create", "next"]);
    await expect(page.getByText("Mission evidence is durable.")).toBeVisible();
    await page.reload();
    await expect(page.getByText("Mission evidence is durable.")).toBeVisible();
    expect(lifecycleCommands.filter((command) => command === "mission create")).toHaveLength(1);
    await page.getByRole("button", { name: "Create discovery evidence" }).click();
    await expect.poll(() => lifecycleCommands.slice(-2)).toEqual(["discovery run", "next"]);
    await expect(page.getByText(/Create discovery evidence completed/u)).toBeVisible();
  });

  test("Quiet Cockpit lifecycle navigation reflows without hiding state", async ({ page }) => {
    test.setTimeout(90_000);
    const state = readHarnessState(); await blockExternalNetwork(page, state.app_url);
    for (const viewport of [{ width: 320, height: 700 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1024, height: 768 }, { width: 1180, height: 900 }, { width: 1181, height: 900 }, { width: 1440, height: 900 }]) {
      await page.setViewportSize(viewport); await page.goto(`${state.app_url}?console=quiet-cockpit`);
      await expect(page.getByRole("region", { name: "Quiet Cockpit navigation" })).toBeVisible();
      await expect(page.getByText("Current lifecycle stage", { exact: true })).toBeVisible();
      await page.getByRole("tab", { name: "Evidence", exact: true }).click();
      await page.getByRole("button", { name: "Review / QA" }).focus(); await page.keyboard.press("Enter");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    }
  });

  test("partial endpoint failure preserves project state and keyboard modal behavior", async ({ page }) => {
    const state = readHarnessState();
    await blockExternalNetwork(page, state.app_url);
    await page.route("**/next-action-report", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "fixture_partial_failure",
            title: "Next action unavailable",
            detail: "The fixture intentionally failed this resource.",
            consequence: "Existing project state remains visible.",
            retryable: true,
            recovery_actions: [{ action_id: "retry", label: "Retry" }],
          },
        }),
      });
    });
    await page.goto(state.app_url);
    await expect(page.locator("#project-switcher-control")).toBeVisible();
    await expect(page.getByText("Some live resources are unavailable.")).toBeVisible();
    await expect(page.getByText(/Existing project state remains visible/)).toBeVisible();
    const opener = page.getByRole("button", { name: /Add AOR Project/i }).first();
    await opener.click();
    const dialog = page.getByRole("dialog", { name: "Add AOR Project" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused();
    await expect.poll(() => page.locator("header.topbar").evaluate((element) => element.inert)).toBe(true);
    await dialog.getByLabel("Project path").fill("/tmp/aor-dialog-focus-fixture");
    for (let step = 0; step < 5; step += 1) await dialog.getByRole("button", { name: "Continue" }).click();
    const lastAction = dialog.getByRole("button", { name: "Confirm writes and initialize" });
    await lastAction.focus();
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(lastAction).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    const discardDialog = page.getByRole("dialog", { name: "Discard project draft?" });
    await expect(discardDialog).toBeVisible();
    await discardDialog.getByRole("button", { name: "Discard draft" }).click();
    await expect(discardDialog).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test("durable event delivery refreshes browser state", async ({ page }) => {
    const state = readHarnessState();
    await blockExternalNetwork(page, state.app_url);
    let eventStreamOpened = false;
    let stateReads = 0;
    await page.route(new RegExp(`/api/projects/${state.project_id}/state$`, "u"), async (route) => {
      stateReads += 1;
      await route.continue();
    });
    await page.route(new RegExp(`/api/projects/${state.project_id}/runs$`, "u"), async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify([{ run_id: "browser-live-run", status: "running" }]),
      });
    });
    await page.route("**/runs/browser-live-run/events?*", async (route) => {
      eventStreamOpened = true;
      await route.fulfill({
        contentType: "text/event-stream",
        body: 'id: browser-live-run:1\ndata: {"event_type":"run.progress"}\n\n',
      });
    });
    await page.goto(state.app_url);
    await expect.poll(() => eventStreamOpened).toBe(true);
    await expect.poll(() => stateReads).toBeGreaterThan(1);
  });

  test("multiple runtime interactions are independently selectable", async ({ page }) => {
    const state = readHarnessState();
    await blockExternalNetwork(page, state.app_url);
    const flow = {
      flow_id: "browser-flow",
      status: "active",
      selected_stage: "execution",
      evidence_refs: ["step-result://interaction-one", "step-result://interaction-two"],
    };
    await page.route(new RegExp(`/api/projects/${state.project_id}/flows$`, "u"), async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ flows: [flow], selected_flow_id: flow.flow_id }),
      });
    });
    await page.route("**/flows/selected", async (route) => {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(flow) });
    });
    await page.route("**/step-results", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify([
          {
            artifact_ref: "step-result://interaction-one",
            document: {
              run_id: "run-one",
              requested_interaction: {
                requested: true,
                status: "requested",
                interaction_id: "interaction-one",
                prompt_summary: "Choose the first answer",
              },
            },
          },
          {
            artifact_ref: "step-result://interaction-two",
            document: {
              run_id: "run-two",
              requested_interaction: {
                requested: true,
                status: "requested",
                interaction_id: "interaction-two",
                prompt_summary: "Choose the second answer",
              },
            },
          },
        ]),
      });
    });
    await page.goto(state.app_url);
    await page.locator("#flow-advanced-workbench details").evaluate((element) => {
      element.open = true;
      element.dispatchEvent(new Event("toggle"));
    });
    await page.getByRole("tab", { name: /Interactions/ }).click();
    await page.getByRole("button", { name: /Choose the second answer/ }).click();
    await expect(page.getByText("interaction-two", { exact: true })).toBeVisible();
  });

  test("structured plan task details remain keyboard accessible at mobile width", async ({ page }) => {
    const state = readHarnessState();
    await blockExternalNetwork(page, state.app_url);
    await page.setViewportSize({ width: 390, height: 844 });
    const flow = { flow_id: "plan-proof-flow", status: "active", selected_stage: "planning", evidence_refs: [] };
    await page.route(new RegExp(`/api/projects/${state.project_id}/flows$`, "u"), (route) => route.fulfill({
      contentType: "application/json", body: JSON.stringify({ flows: [flow], selected_flow_id: flow.flow_id }),
    }));
    await page.route("**/flows/selected", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(flow) }));
    await page.route("**/flows/plan-proof-flow/plan", (route) => route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        plan_ref: "evidence://artifacts/wave-ticket-plan-proof.json",
        plan: {
          plan_id: "plan.browser-proof", plan_version: 2, plan_status: "approved",
          local_tasks: [{
            task_id: "task.browser-proof", title: "Verify structured planning", type: "verification",
            objective: "Prove task detail access.", rationale: "Operators need inspectable evidence.",
            scope: { repo_ids: ["main"], component_ids: [], allowed_paths: ["apps/web/**"], forbidden_paths: [] },
            depends_on: [], work_items: ["Inspect the task."], criteria_refs: ["acceptance.browser"],
            verification: { command_group_refs: ["test-web-browser"], validators: [], manual_checks: [], success_conditions: ["Dialog is accessible."] },
            expected_evidence: ["browser-proof"], risks: [], stop_conditions: [],
            execution_hints: { group_key: null, group_reason: null, parallel_candidate: false },
          }],
          criteria_catalog: [{ criterion_id: "acceptance.browser", kind: "acceptance", text: "Plan detail is accessible.", source_ref: "packet://proof" }],
          revision_summary: { reason: "Approved proof revision.", material_change: true },
        },
        handoff_packet: { approval_state: { state: "approved" } },
      }),
    }));
    await page.route("**/flows/plan-proof-flow/plan/progress", (route) => route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ task_progress: { tasks: [{ task_id: "task.browser-proof", status: "verification-pending", attempt_refs: ["run.proof.1"], evidence_refs: [], blocking_findings: [], next_action: "Run browser proof." }] } }),
    }));
    await page.goto(state.app_url);
    const task = page.getByRole("button", { name: "Verify structured planning" });
    await expect(task).toBeVisible();
    await task.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Verify structured planning" });
    await expect(dialog.getByText("run.proof.1")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(task).toBeFocused();
  });
});
