import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Task Workspace exposes all eight server-owned screens and safe Markdown preview", () => {
  const source = fs.readFileSync(path.join(root, "src/task-workspace.jsx"), "utf8");
  for (const label of ["Tasks Home", "New Task", "Markdown Sources", "Prepared Task", "Active Task Workspace", "Attention", "Review Changes", "Completion & Evidence"]) {
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    assert.match(source, new RegExp(escapedLabel, "u"));
  }
  assert.match(source, /sanitizeMarkdown/u);
  assert.doesNotMatch(source, /dangerouslySetInnerHTML/u);
  assert.match(source, /server-owned Task projection/u);
});

test("web client reads the additive task projection without replacing intent mutations", () => {
  const source = fs.readFileSync(path.join(root, "src/control-plane-client.js"), "utf8");
  assert.match(source, /taskPayload:.*\/tasks/u);
  assert.match(source, /intentList:.*intent-submissions/u);
});
