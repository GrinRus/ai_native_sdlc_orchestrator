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
  assert.match(source, /onTaskAction\?\.\(task, "request"/u);
  assert.match(source, /Ask AOR/u);
  assert.match(source, /actionBusy/u);
  assert.match(source, /Start follow-up task/u);
  assert.match(source, /Task completed/u);
  assert.match(source, /task-rendered-preview/u);
  assert.match(source, /Source diff/u);
  assert.match(source, /CONTEXT_LIFECYCLE/u);
  assert.match(source, /task-context-header/u);
  assert.match(source, /task-context-tabs/u);
  assert.match(source, /pendingSource/u);
  assert.match(source, /Digest:/u);
  assert.match(source, /aria-modal="true"/u);
});

test("web client reads the additive task projection without replacing intent mutations", () => {
  const source = fs.readFileSync(path.join(root, "src/control-plane-client.js"), "utf8");
  assert.match(source, /taskPayload:.*\/tasks/u);
  assert.match(source, /intentList:.*intent-submissions/u);
});

test("Task Workspace owns the full viewport without legacy project-settings chrome", () => {
  const source = fs.readFileSync(path.join(root, "src/spa.jsx"), "utf8");
  assert.match(source, /taskSurface \? "task-surface-active"/u);
  assert.match(source, /activeProjectDisplay && !taskSurface/u);
});
