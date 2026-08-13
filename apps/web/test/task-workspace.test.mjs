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
  assert.match(source, /Draft/u);
  assert.match(source, /Tasks are temporarily unavailable/u);
  assert.match(source, /setFocusedTaskId/u);
  assert.match(source, /onTaskAction/u);
  assert.match(source, /Create durable request/u);
  assert.match(source, /Request retry/u);
  assert.match(source, /actionBusy/u);
  assert.match(source, /Start follow-up task/u);
  assert.match(source, /Partial verification or delivery cannot be shown as successful/u);
  assert.match(source, /Rendered Markdown/u);
  assert.match(source, /Source diff/u);
});

test("web client reads the additive task projection without replacing intent mutations", () => {
  const source = fs.readFileSync(path.join(root, "src/control-plane-client.js"), "utf8");
  assert.match(source, /taskPayload:.*\/tasks/u);
  assert.match(source, /intentList:.*intent-submissions/u);
});
