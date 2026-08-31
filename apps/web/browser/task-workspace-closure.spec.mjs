import fs from "node:fs";

import { expect, test } from "@playwright/test";

import { readHarnessState } from "./harness.mjs";

const closure = JSON.parse(fs.readFileSync(new URL("./fixtures/task-workspace-closure.json", import.meta.url), "utf8"));
const w70AssetRoot = new URL("../../../docs/product/assets/w70-task-workspace-console/", import.meta.url);
const updateUiEvidence = process.env.AOR_UPDATE_W70_UI_EVIDENCE === "1";

async function blockExternalNetwork(page, appUrl) {
  const allowedOrigin = new URL(appUrl).origin;
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === allowedOrigin || url.protocol === "data:" || url.protocol === "blob:") return route.continue();
    return route.abort("blockedbyclient");
  });
}

async function collectContrastSamples(page, screen, samples) {
  return page.evaluate(({ screen: sampleScreen, samples: requestedSamples }) => {
    const parseColor = (value) => {
      const match = String(value).match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)/u);
      return match ? { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), a: match[4] === undefined ? 1 : Number(match[4]) } : null;
    };
    const composite = (foreground, background) => {
      const alpha = foreground.a + background.a * (1 - foreground.a);
      if (alpha === 0) return { r: 255, g: 255, b: 255, a: 1 };
      return {
        r: (foreground.r * foreground.a + background.r * background.a * (1 - foreground.a)) / alpha,
        g: (foreground.g * foreground.a + background.g * background.a * (1 - foreground.a)) / alpha,
        b: (foreground.b * foreground.a + background.b * background.a * (1 - foreground.a)) / alpha,
        a: alpha,
      };
    };
    const backgroundFor = (element) => {
      const layers = [];
      for (let current = element; current; current = current.parentElement) {
        const color = parseColor(window.getComputedStyle(current).backgroundColor);
        if (color && color.a > 0) layers.push(color);
      }
      return layers.reverse().reduce((background, layer) => composite(layer, background), { r: 255, g: 255, b: 255, a: 1 });
    };
    const luminance = ({ r, g, b }) => {
      const channel = (value) => {
        const normalized = value / 255;
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };
    const ratio = (left, right) => {
      const first = luminance(left);
      const second = luminance(right);
      return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
    };
    return requestedSamples.map(({ label, selector }) => {
      const element = [...document.querySelectorAll(selector)].find((candidate) => {
        const rect = candidate.getBoundingClientRect();
        const style = window.getComputedStyle(candidate);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      });
      if (!element) return { screen: sampleScreen, label, selector, status: "missing" };
      const style = window.getComputedStyle(element);
      const background = backgroundFor(element);
      const parsedText = parseColor(style.color);
      const text = parsedText ? composite(parsedText, background) : null;
      const fontSize = Number.parseFloat(style.fontSize) || 0;
      const fontWeight = Number.parseInt(style.fontWeight, 10) || 400;
      const largeText = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);
      const requiredRatio = largeText ? 3 : 4.5;
      const numericRatio = text ? Number(ratio(text, background).toFixed(2)) : 0;
      return { screen: sampleScreen, label, selector, status: numericRatio >= requiredRatio ? "pass" : "fail", ratio: numericRatio, required_ratio: requiredRatio, font_size: fontSize, font_weight: fontWeight, foreground: style.color, background: `rgb(${Math.round(background.r)}, ${Math.round(background.g)}, ${Math.round(background.b)})` };
    });
  }, { screen, samples });
}

async function captureMobileEvidence(page, testInfo, name, filename) {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".task-workspace-shell")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const screenshot = await page.screenshot({ fullPage: false });
  await testInfo.attach(name, { body: screenshot, contentType: "image/png" });
  if (updateUiEvidence) {
    fs.mkdirSync(new URL("mobile/", w70AssetRoot), { recursive: true });
    fs.writeFileSync(new URL(`mobile/${filename}`, w70AssetRoot), screenshot);
  }
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

test("clean installed project opens Task Workspace without a legacy surface override", async ({ page }) => {
  const state = readHarnessState();
  await blockExternalNetwork(page, state.app_url);
  await page.goto(`${state.app_url}?surface=flow&flow=retired&console=quiet-cockpit`);
  await expect(page.locator(".task-workspace-shell")).toBeVisible();
  await expect(page.locator(".task-workspace__breadcrumb h1")).toHaveText("Tasks");
  await expect(page.getByRole("heading", { name: "No tasks yet" })).toBeVisible();
  await expect(page.getByRole("button", { name: "New task", exact: true })).toBeVisible();
  await expect(page.getByText("Quiet Cockpit", { exact: true })).toHaveCount(0);
  await expect(page.getByText("New Flow", { exact: true })).toHaveCount(0);
  await expect(page).not.toHaveURL(/surface=|flow=|console=/u);
  expect(fs.existsSync(state.runtime_root), "clean Task Workspace load created repository-local runtime state").toBe(false);
});

test("W70-S08 installed Task Workspace closure covers sources, recovery, review, and immutable completion", async ({ page }, testInfo) => {
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
    { ...base, task_id: `${base.task_id}.complete-proof`, display_title: "Completed proof task", status: "completed", status_detail: "completed", completed_read_only: true, completion: { status: "complete", verification_status: "pass", delivery_status: "pass", patch_ref: "evidence://delivery/closure.patch", digest: "e".repeat(64), evidence_refs: ["evidence://completion/closure"], follow_up_eligible: true } },
  ];
  let offline = false;
  let actionPayloads = [];
  await page.route(new RegExp(`/api/projects/${state.project_id}/state$`, "u"), (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ project_id: state.project_id, initialized: true, state: "ready", onboarding_summary: { initialized: true, state_exists: true } }) }));
  await page.route(new RegExp(`/api/projects/${state.project_id}/tasks(?:\\?.*)?$`, "u"), (route) => offline ? route.abort("failed") : route.fulfill({ contentType: "application/json", body: JSON.stringify({ project_id: state.project_id, selected_task_id: tasks[0].task_id, tasks, read_only: true }) }));
  await page.route(new RegExp(`/api/projects/${state.project_id}/tasks/.+/review(?:\\?.*)?$`, "u"), (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ schema_version: 1, task_id: `${base.task_id}.review`, project_id: state.project_id, availability: "available", files: [{ path: "docs/task.md", kind: "markdown", additions: 2, deletions: 1, diff_available: true, truncated: false }], selected_path: "docs/task.md", selected_file: { path: "docs/task.md", kind: "markdown", additions: 2, deletions: 1, diff_available: true, truncated: false, hunks: [{ old_start: 1, old_lines: 1, new_start: 1, new_lines: 2, rows: [{ kind: "deletion", old_line: 1, new_line: null, text: "Old bounded behavior." }, { kind: "addition", old_line: null, new_line: 1, text: "New deterministic behavior." }] }], rendered: { before: "Old bounded behavior.", after: "New deterministic behavior.", sanitized: true, partial: true }, source_ref: "evidence://review/task.patch" }, evidence_refs: ["evidence://review/task.patch"], freshness: { status: "current", updated_at: "2026-08-21T00:00:00.000Z" }, read_only: true }) }));
  await page.route(new RegExp(`/api/projects/${state.project_id}/tasks/.+/actions$`, "u"), async (route) => {
    const payload = route.request().postDataJSON();
    actionPayloads.push(payload);
    await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ action: payload.action, readback: { durable: true, task_id: tasks.at(-1).task_id, new_intent_submission_id: "intent.follow-up" } }) });
  });

  await page.setViewportSize({ width: 1586, height: 992 });
  await page.goto(state.app_url);
  await expect(page.locator(".task-workspace__breadcrumb h1")).toHaveText("Tasks");
  await captureMobileEvidence(page, testInfo, "w70-mobile-tasks-home-390x844", "01-tasks-home-390x844.png");
  await expect(page.locator(".task-inline-mobile-detail")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Ready", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Completed", exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1586, height: 992 });
  for (const entry of closure.scenarios.filter(({ id }) => ["text-only", "upload-markdown", "repository-markdown", "stale-source", "runner-unavailable", "failure"].includes(id))) {
    await expect(page.getByText(entry.id === "text-only" ? "Text-only draft" : entry.id === "upload-markdown" ? "Uploaded Markdown" : entry.id === "repository-markdown" ? "Repository Markdown" : entry.id === "stale-source" ? "Stale source" : entry.id === "runner-unavailable" ? "Unavailable runner" : "Failed task")).toBeVisible();
  }
  await page.getByRole("button", { name: "Unavailable runner" }).click();
  await expect(page.getByRole("heading", { name: "Attention" })).toBeVisible();
  await captureMobileEvidence(page, testInfo, "w70-mobile-attention-390x844", "06-attention-390x844.png");
  await page.setViewportSize({ width: 1586, height: 992 });
  await page.getByRole("button", { name: "Tasks", exact: true }).first().click();
  await page.getByRole("button", { name: "Repository Markdown" }).click();
  await expect(page.getByRole("heading", { name: "Prepared Task", exact: true })).toBeVisible();
  await captureMobileEvidence(page, testInfo, "w70-mobile-prepared-task-390x844", "04-prepared-task-390x844.png");
  await page.setViewportSize({ width: 1586, height: 992 });
  await page.getByRole("button", { name: "Edit task", exact: true }).click();
  await expect(page.getByRole("heading", { name: "New Task" })).toBeVisible();
  const runnerField = page.locator(".task-run-field--runner");
  const runnerReadiness = runnerField.locator(".task-readiness");
  const [runnerFieldBox, runnerReadinessBox] = await Promise.all([runnerField.boundingBox(), runnerReadiness.boundingBox()]);
  expect(runnerFieldBox).not.toBeNull();
  expect(runnerReadinessBox).not.toBeNull();
  expect(runnerReadinessBox.x + runnerReadinessBox.width).toBeLessThanOrEqual(runnerFieldBox.x + runnerFieldBox.width + 1);
  const contrastReport = await collectContrastSamples(page, "new-task", [
    { label: "screen heading", selector: ".task-workspace__breadcrumb h1" },
    { label: "section heading", selector: ".task-form-section h2" },
    { label: "runner readiness", selector: ".task-readiness" },
    { label: "safety note", selector: ".task-safety" },
    { label: "provider note", selector: ".task-provider-note" },
  ]);
  await captureMobileEvidence(page, testInfo, "w70-mobile-new-task-390x844", "02-new-task-390x844.png");
  await page.getByRole("button", { name: "Add Markdown", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Markdown Sources" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add 1 source", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Close Markdown Sources", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Add Markdown source" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add Markdown", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Add Markdown", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Markdown Sources" })).toBeVisible();
  await captureMobileEvidence(page, testInfo, "w70-mobile-markdown-sources-390x844", "03-markdown-sources-390x844.png");
  const repositorySourceRow = page.locator(".task-source-row--detailed").filter({ hasText: "docs/task.md" });
  await expect(repositorySourceRow.getByText("Repository reference", { exact: true })).toHaveCount(1);
  await expect(repositorySourceRow.locator(".task-source-row__digest")).toHaveAttribute("title", "c".repeat(64));
  await page.getByRole("tab", { name: "Upload snapshot", exact: true }).click();
  await page.getByLabel("Upload Markdown").setInputFiles({ name: "notes.md", mimeType: "text/markdown", buffer: Buffer.from("# Uploaded\n<script>alert('blocked')</script>") });
  await expect(page.locator(".task-markdown-preview")).toContainText("# Uploaded");
  await expect(page.locator(".task-markdown-preview")).not.toContainText("alert");
  await page.getByRole("tab", { name: "Repository file", exact: true }).click();
  await page.getByLabel("Project-relative Markdown path").fill("docs/task.md");
  await page.getByLabel("Pinned base revision").fill("abc123");

  await page.getByRole("button", { name: "Close Markdown Sources", exact: true }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Review task" }).click();
  await expect(page.getByRole("heading", { name: "Active Task Workspace" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Activity", exact: true })).toBeVisible();
  await captureMobileEvidence(page, testInfo, "w70-mobile-active-task-390x844", "05-active-task-390x844.png");
  const mobileActiveActions = await page.locator(".task-active-heading .task-inline-actions").boundingBox();
  expect(mobileActiveActions).not.toBeNull();
  expect(mobileActiveActions.x).toBeLessThan(170);
  await page.setViewportSize({ width: 1586, height: 992 });
  await page.getByRole("tab", { name: /Changes/u }).click();
  await expect(page.getByRole("heading", { name: "Review Changes" })).toBeVisible();
  await expect(page.locator(".task-diff")).toContainText("Old bounded behavior.");
  await expect(page.locator(".task-diff")).toContainText("New deterministic behavior.");
  await page.getByRole("tab", { name: "Rendered" }).click();
  await expect(page.locator(".task-rendered-comparison")).toContainText("New deterministic behavior.");
  const approveButton = page.getByRole("button", { name: "Approve changes", exact: true });
  await expect(approveButton).toBeDisabled();
  await expect(page.getByText("Approve changes is available after verification, reference integrity, and review evidence all pass.", { exact: true })).toBeVisible();
  const approveBox = await approveButton.boundingBox();
  expect(approveBox).not.toBeNull();
  expect(approveBox.y).toBeGreaterThanOrEqual(0);
  expect(approveBox.y + approveBox.height).toBeLessThanOrEqual(992);
  contrastReport.push(...await collectContrastSamples(page, "review-changes", [
    { label: "task title", selector: ".task-context-title h2" },
    { label: "tasks navigation", selector: ".task-context-back" },
    { label: "review status", selector: ".task-context-status--review" },
    { label: "changed file", selector: ".task-review-files button.is-selected span" },
    { label: "rendered diff", selector: ".task-rendered-comparison pre" },
    { label: "primary approval", selector: ".task-review-layout .task-screen-footer [data-variant='primary']" },
  ]));

  await captureMobileEvidence(page, testInfo, "w70-mobile-review-390x844", "07-review-changes-390x844.png");
  const contextBackButton = page.locator(".task-context-back");
  await contextBackButton.focus();
  await expect(contextBackButton).toBeFocused();
  await contextBackButton.click();
  await expect(page.getByRole("heading", { name: "Tasks" })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("project")).toBe(state.project_id);
  expect(new URL(page.url()).searchParams.has("task")).toBe(false);
  expect(new URL(page.url()).searchParams.has("surface")).toBe(false);

  const directReviewUrl = new URL(state.app_url);
  directReviewUrl.searchParams.set("task", `${base.task_id}.review`);
  await page.setViewportSize({ width: 1586, height: 992 });
  await page.goto(directReviewUrl.href);
  await expect(page.getByRole("heading", { name: "Active Task Workspace" })).toBeVisible();
  await page.getByRole("tab", { name: /Changes/u }).click();
  await expect(page.getByRole("heading", { name: "Review Changes" })).toBeVisible();
  await page.locator(".task-context-back").click();
  await expect(page.getByRole("heading", { name: "Tasks" })).toBeVisible();
  expect(new URL(page.url()).searchParams.has("task")).toBe(false);

  const directCompletionUrl = new URL(state.app_url);
  directCompletionUrl.searchParams.set("task", `${base.task_id}.completed`);
  await page.goto(directCompletionUrl.href);
  await expect(page.getByRole("alert")).toContainText("Closure evidence is not complete.");
  await expect(page.getByRole("heading", { name: "Task completed" })).toHaveCount(0);

  const directProofUrl = new URL(state.app_url);
  directProofUrl.searchParams.set("task", `${base.task_id}.complete-proof`);
  await page.goto(directProofUrl.href);
  await expect(page.getByRole("heading", { name: "Completion & Evidence" })).toBeVisible();
  contrastReport.push(...await collectContrastSamples(page, "completion-evidence", [
    { label: "task title", selector: ".task-context-title h2" },
    { label: "completion status", selector: ".task-context-status--complete" },
    { label: "completion summary", selector: ".task-completion-summary > header p" },
    { label: "delivery success", selector: ".task-delivery-success" },
    { label: "follow-up action", selector: ".task-complete-inspector [data-variant='primary']" },
  ]));
  await captureMobileEvidence(page, testInfo, "w70-mobile-completion-390x844", "08-completion-evidence-390x844.png");
  await page.getByRole("button", { name: "Closure details", exact: true }).click();
  await page.getByRole("button", { name: "Back to tasks", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Tasks" })).toBeVisible();
  expect(new URL(page.url()).searchParams.has("task")).toBe(false);

  expect(contrastReport.filter((sample) => sample.status !== "pass")).toEqual([]);
  const contrastEvidence = Buffer.from(`${JSON.stringify({ schema_version: 1, standard: "WCAG 2.2 AA", method: "computed foreground/background relative luminance", samples: contrastReport }, null, 2)}\n`);
  await testInfo.attach("w70-task-workspace-numeric-contrast", {
    body: contrastEvidence,
    contentType: "application/json",
  });
  if (updateUiEvidence) fs.writeFileSync(new URL("task-workspace-contrast-report.json", w70AssetRoot), contrastEvidence);

  await page.getByRole("button", { name: "Completed task" }).click();
  await page.getByRole("button", { name: "Evidence", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Review Changes" })).toBeVisible();

  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  offline = true;
  await page.reload();
  await expect(page.getByText(/Tasks are temporarily unavailable|Task data is partially available/u)).toBeVisible();
});

test("Task Workspace creates a server-owned prepared Task before exposing Start", async ({ page }) => {
  const state = readHarnessState();
  await blockExternalNetwork(page, state.app_url);
  const submissionId = "intent.browser-task-create";
  const preparedTask = taskFixture(state, {
    task_id: `task.${state.project_id}.intent.${submissionId}`,
    display_title: "Server prepared task",
    status: "prepared",
    status_detail: "prepared",
    flow_id: null,
    mission_id: null,
    lineage: { intent_submission_id: submissionId, intent_submission_ref: `evidence://intent/${submissionId}`, mission_id: null, flow_id: null },
    intent_submission_ref: `evidence://intent/${submissionId}`,
    primary_action: { action_id: "confirm", operator_control: "Start task", reason: "Prepared and ready", available: true },
    revision: 1,
    normalization: { outcome: "Make the task creation path durable." },
    lifecycle_path: { owner: "runtime", steps: [{ id: "prepare", label: "Prepare", state: "completed" }] },
  });
  let tasks = [];
  let submissionPayload = null;
  let actionPayload = null;
  await page.route(new RegExp(`/api/projects/${state.project_id}/state$`, "u"), (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ project_id: state.project_id, initialized: true, state: "ready", onboarding_summary: { initialized: true, state_exists: true } }) }));
  await page.route(new RegExp(`/api/projects/${state.project_id}/tasks(?:\\?.*)?$`, "u"), (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ project_id: state.project_id, selected_task_id: tasks[0]?.task_id ?? null, tasks, read_only: true }) }));
  await page.route(new RegExp(`/api/projects/${state.project_id}/intent-submissions$`, "u"), async (route) => {
    if (route.request().method() === "POST") {
      submissionPayload = route.request().postDataJSON();
      tasks = [preparedTask];
      await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ submission: { submission_id: submissionId, status: "prepared", request_text: submissionPayload.request_text }, normalization: preparedTask.normalization }) });
      return;
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ project_id: state.project_id, submissions: [], read_only: true }) });
  });
  await page.route(new RegExp(`/api/projects/${state.project_id}/tasks/.+/actions$`, "u"), async (route) => {
    actionPayload = route.request().postDataJSON();
    tasks = [{ ...preparedTask, status: "active", status_detail: "active", primary_action: { action_id: "review", operator_control: "Review changes", reason: "Review the recorded result", available: true } }];
    await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ action: actionPayload.action, confirmation: { flow_id: "flow.browser-task-create" }, readback: { durable: true, task_id: preparedTask.task_id, flow_id: "flow.browser-task-create" } }) });
  });

  await page.goto(state.app_url);
  await expect(page.locator(".task-workspace__breadcrumb h1")).toHaveText("Tasks");
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await page.getByLabel("Task outcome").fill("Make the task creation path durable.");
  await page.getByRole("button", { name: "Prepare task", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Prepared Task", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start task", exact: true })).toBeEnabled();
  expect(submissionPayload).toMatchObject({ request_text: "Make the task creation path durable.", attachments: [], markdown_sources: [], auto_prepare: true });
  await page.getByRole("button", { name: "Start task", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Active Task Workspace" })).toBeVisible();
  expect(actionPayload).toEqual({ action: "confirm", expected_revision: 1 });
});
