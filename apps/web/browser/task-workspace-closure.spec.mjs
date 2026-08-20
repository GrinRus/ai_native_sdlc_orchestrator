import fs from "node:fs";

import { expect, test } from "@playwright/test";

import { readHarnessState } from "./harness.mjs";

const closure = JSON.parse(fs.readFileSync(new URL("./fixtures/task-workspace-closure.json", import.meta.url), "utf8"));

async function blockExternalNetwork(page, appUrl) {
  const allowedOrigin = new URL(appUrl).origin;
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === allowedOrigin || url.protocol === "data:" || url.protocol === "blob:") return route.continue();
    return route.abort("blockedbyclient");
  });
}

function taskFixture(state, overrides = {}) {
  return {
    task_id: `task.${state.project_id}.closure`, project_id: state.project_id,
    display_title: "Closure fixture task", work_type: "code-change", status: "active", status_detail: "active",
    intent_submission_ref: "evidence://intent/closure", mission_id: "mission.closure", flow_id: "flow.closure",
    lineage: { intent_submission_ref: "evidence://intent/closure", mission_id: "mission.closure", flow_id: "flow.closure" },
    source_items: [{ schema_version: 1, source_id: "source.inline", kind: "inline-text", immutable: true, stale: false, digest: "a".repeat(64), preview: { kind: "inline-text", text: "# Safe task" } }],
    attention_items: [], review: { verification_status: "pass", delivery_status: "pass", changed_paths: ["docs/task.md"] },
    completion: { status: "incomplete", verification_status: "pass", delivery_status: "pass", evidence_refs: ["evidence://closure"], follow_up_eligible: false },
    lifecycle_path: { owner: "runtime", steps: [{ id: "work", state: "current" }] }, current_step: "work", current_step_label: "Work",
    attention_count: 0, blocker_count: 0, evidence_refs: ["evidence://closure"],
    primary_action: { action_id: "task.start", operator_control: "Start", reason: "Ready", available: true },
    runner_selection: { schema_version: 1, source: "project-default", route_id: "route.implement.simulation", readiness: "ready", requested_model: null, effective_model: null, requested_reasoning_effort: null, effective_reasoning_effort: null, unavailable_reason: null, recovery_action: "Review the approved route." },
    run_ids: ["run.closure"], revision: 3, updated_at: "2026-08-13T00:00:00.000Z", completed_read_only: false, read_only: true,
    ...overrides,
  };
}

test("W70-S08 installed Task Workspace closure covers sources, recovery, review, and immutable completion", async ({ page }) => {
  test.setTimeout(120_000);
  const state = readHarnessState();
  await blockExternalNetwork(page, state.app_url);
  const base = taskFixture(state);
  const tasks = [
    { ...base, task_id: `${base.task_id}.draft`, display_title: "Text-only draft", status: "draft", status_detail: "submitted", flow_id: null, mission_id: null, runner_selection: { ...base.runner_selection, readiness: "unknown" } },
    { ...base, task_id: `${base.task_id}.upload`, display_title: "Uploaded Markdown", status: "prepared", source_items: [{ schema_version: 1, source_id: "source.upload", kind: "upload-snapshot", immutable: true, stale: false, digest: "b".repeat(64), preview: { filename: "notes.md", media_type: "text/markdown", byte_length: 12 } }] },
    { ...base, task_id: `${base.task_id}.repository`, display_title: "Repository Markdown", status: "prepared", source_items: [{ schema_version: 1, source_id: "source.repository", kind: "repository-markdown", immutable: true, stale: false, digest: "c".repeat(64), preview: { project_relative_path: "docs/task.md", pinned_base_revision: "abc123", sanitized_markdown: "# Repository source" } }] },
    { ...base, task_id: `${base.task_id}.stale`, display_title: "Stale source", status: "attention", status_detail: "blocked", attention_count: 1, blocker_count: 1, source_items: [{ schema_version: 1, source_id: "source.stale", kind: "repository-markdown", immutable: true, stale: true, digest: "d".repeat(64), preview: { project_relative_path: "docs/stale.md", pinned_base_revision: "def456", sanitized_markdown: "# Stale source" } }] },
    { ...base, task_id: `${base.task_id}.unavailable`, display_title: "Unavailable runner", status: "attention", status_detail: "blocked", attention_count: 1, blocker_count: 1, runner_selection: { ...base.runner_selection, readiness: "unavailable", unavailable_reason: "Approved route is unavailable in this local fixture.", recovery_action: "Choose another approved route." } },
    { ...base, task_id: `${base.task_id}.failure`, display_title: "Failed task", status: "attention", status_detail: "failed", attention_count: 1, blocker_count: 1 },
    { ...base, task_id: `${base.task_id}.review`, display_title: "Review task", status: "active", review: { verification_status: "pass", delivery_status: "pending", changed_paths: ["docs/task.md"], evidence_refs: ["evidence://review"] } },
    { ...base, task_id: `${base.task_id}.completed`, display_title: "Completed task", status: "completed", status_detail: "completed", completed_read_only: true, completion: { status: "blocked", verification_status: "partial", delivery_status: "pending", evidence_refs: ["evidence://partial"], follow_up_eligible: true } },
  ];
  let offline = false;
  let actionPayloads = [];
  await page.route(new RegExp(`/api/projects/${state.project_id}/state$`, "u"), (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ project_id: state.project_id, initialized: true, state: "ready", onboarding_summary: { initialized: true, state_exists: true } }) }));
  await page.route(new RegExp(`/api/projects/${state.project_id}/tasks(?:\\?.*)?$`, "u"), (route) => offline ? route.abort("failed") : route.fulfill({ contentType: "application/json", body: JSON.stringify({ project_id: state.project_id, selected_task_id: tasks[0].task_id, tasks, read_only: true }) }));
  await page.route(new RegExp(`/api/projects/${state.project_id}/tasks/.+/actions$`, "u"), async (route) => {
    const payload = route.request().postDataJSON();
    actionPayloads.push(payload);
    await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ action: payload.action, readback: { durable: true, task_id: tasks.at(-1).task_id, new_intent_submission_id: "intent.follow-up" } }) });
  });

  await page.goto(state.app_url);
  await expect(page.getByRole("heading", { name: "Tasks" })).toBeVisible();
  for (const entry of closure.scenarios.filter(({ id }) => ["text-only", "upload-markdown", "repository-markdown", "stale-source", "runner-unavailable", "failure"].includes(id))) {
    await expect(page.getByText(entry.id === "text-only" ? "Text-only draft" : entry.id === "upload-markdown" ? "Uploaded Markdown" : entry.id === "repository-markdown" ? "Repository Markdown" : entry.id === "stale-source" ? "Stale source" : entry.id === "runner-unavailable" ? "Unavailable runner" : "Failed task")).toBeVisible();
  }
  await page.getByRole("button", { name: "Unavailable runner" }).click();
  await expect(page.getByRole("heading", { name: "Prepared Task" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Runner readiness" })).toContainText("unavailable");
  await page.getByRole("button", { name: "Edit task", exact: true }).click();
  await expect(page.getByRole("heading", { name: "New Task" })).toBeVisible();
  await page.getByRole("button", { name: "Add Markdown", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Markdown Sources" })).toBeVisible();
  await page.getByRole("button", { name: "Upload snapshot", exact: true }).click();
  await page.getByLabel("Upload Markdown").setInputFiles({ name: "notes.md", mimeType: "text/markdown", buffer: Buffer.from("# Uploaded\n<script>alert('blocked')</script>") });
  await expect(page.locator(".task-markdown-preview")).toContainText("# Uploaded");
  await expect(page.locator(".task-markdown-preview")).not.toContainText("alert");
  await page.getByRole("button", { name: "Repository file", exact: true }).click();
  await page.getByLabel("Project-relative Markdown path").fill("docs/task.md");
  await page.getByLabel("Pinned base revision").fill("abc123");

  await page.getByRole("button", { name: "Close Markdown Sources", exact: true }).click();
  await expect(page.getByText(/No provider process is started/u)).toHaveCount(1);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Completed task" }).click();
  await page.getByRole("button", { name: "Evidence", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Completion & Evidence" })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("cannot be shown as successful");
  await page.getByRole("button", { name: "Start follow-up task" }).click();
  await expect.poll(() => actionPayloads.at(-1)?.action).toBe("follow-up");

  const contextBackButton = page.locator(".task-context-back");
  await contextBackButton.focus();
  await expect(contextBackButton).toBeFocused();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  offline = true;
  await page.reload();
  await expect(page.getByText(/Tasks are temporarily unavailable|Task data is partially available/u)).toBeVisible();
});
