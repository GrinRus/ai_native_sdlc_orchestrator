import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { legacyConsoleRequested, resolveConsoleExperience, retiredConsoleSearch } from "../src/console-experience.js";

const here = path.dirname(fileURLToPath(import.meta.url));

test("retired legacy input normalizes to the single Quiet Cockpit renderer", () => {
  assert.equal(resolveConsoleExperience(), "quiet-cockpit");
  assert.equal(resolveConsoleExperience({ search: "?console=legacy", configDefault: "legacy" }), "quiet-cockpit");
  assert.equal(resolveConsoleExperience({ search: "?console=unknown", configDefault: "quiet-cockpit" }), "quiet-cockpit");
  assert.equal(legacyConsoleRequested("?console=legacy&mode=attention"), true);
  assert.equal(retiredConsoleSearch("?console=legacy&mode=attention"), "?console=quiet-cockpit&mode=attention");
});

test("SPA source has one renderer branch and a bounded legacy migration notice", () => {
  const source = fs.readFileSync(path.join(here, "../src/spa.jsx"), "utf8");
  assert.match(source, /Legacy console retired/u);
  assert.doesNotMatch(source, /Switch to legacy console|Switch to Quiet Cockpit/u);
  assert.doesNotMatch(source, /consoleExperience === "quiet-cockpit"/u);
  assert.doesNotMatch(source, /<StageRail|<MissionForm/u);
});

test("Mission summary keeps durable evidence while the retired builder stays removed", () => {
  const source = fs.readFileSync(path.join(here, "../src/mission-builder.jsx"), "utf8");
  assert.match(source, /export function MissionDurableSummary/u);
  assert.doesNotMatch(source, /export function MissionBuilder/u);
  assert.doesNotMatch(source, /Guided Mission intake|aria-invalid|Resume first-flow creation/u);
  assert.match(source, /Mission evidence is durable/u);
  assert.doesNotMatch(source, /localStorage|sessionStorage/u);
});
