import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = JSON.parse(fs.readFileSync(path.join(root, "browser/fixtures/task-workspace-closure.json"), "utf8"));
const source = fs.readFileSync(path.join(root, "src/task-workspace.jsx"), "utf8");

test("W70-S08 closure fixture covers every source, lifecycle, and recovery branch locally", () => {
  assert.equal(fixture.provider_execution, "prohibited");
  assert.equal(fixture.upstream_write, "prohibited");
  assert.equal(fixture.screens.length, 8);
  assert.deepEqual(fixture.scenarios.map((entry) => entry.id), [
    "text-only", "upload-markdown", "repository-markdown", "stale-source", "runner-unavailable", "attention",
    "failure", "review", "completion", "reload", "offline", "accessibility",
  ]);
  for (const field of ["viewports", "accessibility", "recovery"]) assert.ok(fixture[field].length > 0);
  assert.deepEqual(fixture.closure_requirements, {
    no_runtime_state_commit: true,
    no_credentials: true,
    no_private_paths: true,
    no_upstream_write: true,
    historical_v2_counts_for_acceptance: false,
  });
});

test("Task Workspace source and runner states remain query-safe and fail closed", () => {
  for (const marker of ["Upload Markdown", "Repository Markdown", "stale", "runner_selection", "No provider process is started"]) {
    assert.match(source, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "iu"));
  }
  assert.doesNotMatch(source, /process\.env|authorization:|private_path|raw_provider/iu);
});
