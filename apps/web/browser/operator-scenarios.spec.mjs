import { expect, test } from "@playwright/test";

import { readHarnessState } from "./harness.mjs";
import { applyOperatorScenarioFixture, loadOperatorScenarioCatalog } from "./operator-scenario-loader.mjs";

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
