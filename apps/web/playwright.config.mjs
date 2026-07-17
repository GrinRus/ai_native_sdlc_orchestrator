import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export default defineConfig({
  testDir: path.join(root, "apps/web/browser"),
  testMatch: "**/*.spec.mjs",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  globalSetup: path.join(root, "apps/web/browser/global-setup.mjs"),
  globalTeardown: path.join(root, "apps/web/browser/global-teardown.mjs"),
  outputDir: path.join(root, ".aor/quality/w63/s07/playwright"),
  reporter: [["line"], ["json", { outputFile: path.join(root, ".aor/quality/w63/s07/playwright-report.json") }]],
  use: {
    browserName: "chromium",
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
});
