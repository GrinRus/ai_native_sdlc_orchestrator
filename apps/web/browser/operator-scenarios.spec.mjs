import { spawnSync } from "node:child_process";
import fs from "node:fs";

import { expect, test } from "@playwright/test";

import { readHarnessState } from "./harness.mjs";
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
