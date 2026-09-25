import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Task Workspace exposes all eight server-owned screens and safe Markdown preview", () => {
  const source = fs.readFileSync(path.join(root, "src/task-workspace.jsx"), "utf8");
  const runnerSource = fs.readFileSync(path.join(root, "src/task-runner-summary.jsx"), "utf8");
  const askAorSource = fs.readFileSync(path.join(root, "src/task-ask-aor-panel.jsx"), "utf8");
  const markdownSource = fs.readFileSync(path.join(root, "src/task-markdown-source-dialog.jsx"), "utf8");
  const dialogSource = fs.readFileSync(path.join(root, "src/dialog.jsx"), "utf8");
  for (const label of ["Tasks Home", "New Task", "Markdown Sources", "Prepared Task", "Active Task Workspace", "Attention", "Review Changes", "Completion & Evidence"]) {
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    assert.match(source, new RegExp(escapedLabel, "u"));
  }
  assert.match(markdownSource, /sanitizeMarkdown/u);
  assert.doesNotMatch(`${source}\n${markdownSource}`, /dangerouslySetInnerHTML/u);
  assert.match(source, /server-owned Task projection/u);
  assert.match(source, /Draft/u);
  assert.match(source, /Tasks are temporarily unavailable/u);
  assert.match(source, /setFocusedTaskId/u);
  assert.match(source, /onTaskAction/u);
  assert.match(askAorSource, /onTaskAction\?\.\(task, "request"/u);
  assert.match(source, /onReviewDecision/u);
  assert.match(source, /taskHasCompletionProof/u);
  assert.match(askAorSource, /Ask AOR/u);
  assert.match(source, /actionBusy/u);
  assert.match(source, /Start follow-up task/u);
  assert.match(source, /Task completed/u);
  assert.match(source, /task-rendered-comparison/u);
  assert.match(source, /Source diff/u);
  assert.match(source, /loadTaskReview/u);
  assert.match(source, /Diff unavailable/u);
  assert.match(source, /Binary change/u);
  assert.match(source, /task-inspector-drawer/u);
  assert.match(source, /lifecycle_path\?\.steps/u);
  assert.match(source, /task-context-header/u);
  assert.match(source, /task-context-tabs/u);
  assert.match(source, /pendingSource/u);
  assert.match(source, /Digest:/u);
  assert.match(markdownSource, /<Dialog/u);
  assert.match(dialogSource, /aria-modal="true"/u);
  assert.match(source, /approvedRunnerOptions/u);
  assert.match(source, /onSelectRunner/u);
  assert.match(runnerSource, /No approved execution route is published/u);
  assert.match(source, /item\.message \|\| item\.consequence/u);
  assert.match(source, /HelpDialog/u);
  assert.match(source, /setHelpOpen\(true\)/u);
  assert.doesNotMatch(source, /aria-label="Settings"/u);
  assert.doesNotMatch(source, /task-group-select/u);
});

test("web client reads bounded Task review evidence separately from the Task list", () => {
  const source = fs.readFileSync(path.join(root, "src/task-app.jsx"), "utf8");
  assert.match(source, /async function loadTaskReview/u);
  assert.match(source, /tasks\/\$\{encodeURIComponent\(taskId\)\}\/review/u);
  assert.match(source, /loadTaskReview=\{loadTaskReview\}/u);
  assert.match(source, /async function reviewTask/u);
  assert.match(source, /review decide/u);
  assert.match(source, /execution-profile/u);
  assert.match(source, /const revision = executionProfile\?\.revision/u);
  assert.match(source, /expected_revision: revision/u);
  assert.match(source, /liveRunIds/u);
  assert.match(source, /liveRunIds\.map/u);
  assert.match(source, /setSelectedTaskId\(taskId\)/u);
});

test("Task Workspace owns the full viewport without legacy project-settings chrome", () => {
  const source = fs.readFileSync(path.join(root, "src/task-app.jsx"), "utf8");
  assert.match(source, /data-app-surface="task-workspace"/u);
  assert.match(source, /<TaskWorkspace/u);
  assert.doesNotMatch(source, /QuietShell|FlowSelector|IntentOnboarding/u);
});

test("Command Desk queue keeps server identity and runner context visible", () => {
  const source = fs.readFileSync(path.join(root, "src/task-workspace.jsx"), "utf8");
  const styles = fs.readFileSync(path.join(root, "src/task-workspace.css"), "utf8");
  assert.match(source, /task-queue-header/u);
  assert.match(source, /taskIdLabel/u);
  assert.match(source, /taskRunnerLabel/u);
  assert.match(source, /task-list-row__status/u);
  assert.match(styles, /--aor-task-sidebar-bg/u);
  assert.match(styles, /@media \(max-width: 680px\)/u);
  assert.match(styles, /task-workspace__sidebar-footer/u);
});
