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
    const opener = page.getByRole("button", { name: /Add another AOR project/i }).first();
    await opener.click();
    const dialog = page.getByRole("dialog", { name: "Add another AOR project" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused();
    await expect.poll(() => page.locator("header.topbar").evaluate((element) => element.inert)).toBe(true);
    await dialog.getByLabel("Project path").fill("/tmp/aor-dialog-focus-fixture");
    const lastAction = dialog.getByRole("button", { name: "Add and initialize" });
    await lastAction.focus();
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(lastAction).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
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
});
