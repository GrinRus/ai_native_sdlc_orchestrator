import fs from "node:fs";

import { expect, test } from "@playwright/test";

import { readHarnessState } from "./harness.mjs";

const viewports = [
  { id: "desktop", width: 1440, height: 1000 },
  { id: "tablet", width: 900, height: 1100 },
  { id: "mobile", width: 390, height: 844 },
];

async function blockExternalNetwork(page, appUrl) {
  const allowedOrigin = new URL(appUrl).origin;
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === allowedOrigin || url.protocol === "data:" || url.protocol === "blob:") {
      await route.continue();
      return;
    }
    await route.abort("blockedbyclient");
  });
}

test.describe.serial("installed local operator console", () => {
  test("clean first load is non-materializing and responsive", async ({ page }) => {
    const state = readHarnessState();
    await blockExternalNetwork(page, state.app_url);
    const failures = [];
    page.on("console", (message) => {
      if (message.type() === "error") failures.push(`console: ${message.text()}`);
    });
    page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
    page.on("requestfailed", (request) => failures.push(`request: ${request.method()} ${request.url()}`));

    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.goto(state.app_url);
      await expect(page.getByRole("heading", { name: "What should AOR do?" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Prepare task" })).toBeVisible();
      await expect(page.locator("#project-switcher-control")).toBeVisible();
      const appConfig = await page.request.get(`${new URL(state.app_url).origin}/app-config.json`).then((response) => response.json());
      await expect(page.getByText(`v${appConfig.version}`)).toHaveText(`v${appConfig.version}`);
      expect(fs.existsSync(state.runtime_root), `${viewport.id} first load created runtime`).toBe(false);
    }
    expect(failures).toEqual([]);
  });

  test("Project Structure is readable without initialization", async ({ page }) => {
    const state = readHarnessState();
    await blockExternalNetwork(page, state.app_url);
    await page.goto(state.app_url);
    await expect(page.getByRole("heading", { name: "Project Structure" })).toBeVisible();
    await page.getByRole("tab", { name: "Repositories" }).click();
    await expect(page.getByRole("button", { name: "Connect repository" })).toBeVisible();
    await page.getByRole("tab", { name: "Validation" }).click();
    await expect(page.getByRole("button", { name: "Validate topology" })).toBeVisible();
    expect(fs.existsSync(state.runtime_root)).toBe(false);
  });

  test("Execution Setup selects only approved presets and keeps simulation truthful", async ({ page }) => {
    const state = readHarnessState();
    await blockExternalNetwork(page, state.app_url);
    const secretCanary = "aor-browser-secret-canary";
    let mutationCount = 0;
    const profile = {
      profile_id: `execution-profile.${state.project_id}`,
      project_id: state.project_id,
      revision: 7,
      initialized: true,
      read_only: true,
      latest_readiness_ref: null,
      routes: [{
        step: "implement",
        route_id: "route.implement.simulation",
        mode: "simulation",
        runner: "mock",
        adapter: "mock-runner",
        provider: "mock",
        requested_model: null,
        effective_model: null,
        model_source: "adapter-default",
        required_capabilities: [],
        fallback: { count: 0, route_ids: [] },
        qualification: "deterministic",
        readiness: "ready",
        blocker_codes: [],
        approved_routes: [
          {
            route_id: "route.implement.simulation",
            mode: "simulation",
            route_class: "deterministic",
            risk_tier: "low",
            provider: "mock",
            requested_model: null,
            required_capabilities: [],
            qualification: "deterministic",
          },
          {
            route_id: "route.implement.live",
            mode: "live",
            route_class: "coding",
            risk_tier: "medium",
            provider: "openai",
            requested_model: "coding-primary",
            required_capabilities: ["repo_write"],
            qualification: "project-approved",
          },
        ],
      }],
    };
    await page.route(new RegExp(`/api/projects/${state.project_id}/execution-profile$`, "u"), (route) => route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(profile),
    }));
    await page.route(new RegExp(`/api/projects/${state.project_id}/execution-profile/actions$`, "u"), async (route) => {
      mutationCount += 1;
      const request = route.request().postDataJSON();
      expect(request).toEqual({
        action: "select",
        step: "implement",
        route_id: "route.implement.live",
        expected_revision: 7,
      });
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          execution_profile: {
            ...profile,
            revision: 8,
            routes: [{ ...profile.routes[0], route_id: request.route_id, mode: "live", readiness: "stale" }],
          },
          readiness_report: null,
          diagnostic: secretCanary,
        }),
      });
    });
    await page.goto(state.app_url);
    await expect(page.getByRole("heading", { name: "Execution Setup" })).toBeVisible();
    await expect(page.getByText("Simulation", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Approved route preset")).toHaveCount(1);
    await expect(page.getByLabel(/provider/i)).toHaveCount(0);
    await expect(page.getByLabel(/model/i)).toHaveCount(0);
    await page.getByLabel("Approved route preset").selectOption("route.implement.live");
    await page.getByRole("button", { name: "Select route" }).click();
    const dialog = page.getByRole("dialog", { name: "Confirm execution route change" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("No provider process is started.")).toBeVisible();
    await dialog.getByRole("button", { name: "Confirm route change" }).click();
    await expect.poll(() => mutationCount).toBe(1);
    await expect(page.getByText(secretCanary)).toHaveCount(0);
  });

  test("intent preview supports attachments, revisions, and idempotent failed-start recovery", async ({ page }) => {
    const state = readHarnessState();
    await blockExternalNetwork(page, state.app_url);
    const submissionId = "intent.browser-proof";
    const actions = [];
    const submission = { submission_id: submissionId, status: "prepared", attachments: [{ original_name: "requirements.md" }] };
    let report = {
      status: "prepared", title: "Fix timeout handling", outcome: "Make authorization timeout behavior deterministic.",
      constraints: ["Do not change authentication semantics."], acceptance: ["Timeout behavior is covered by tests."],
      scope: ["src/auth/**"], work_type: "code-change", delivery_mode: "patch-only", open_questions: [],
      provider: { adapter_id: "claude-code" }, confidence: 0.91,
    };
    const base = new RegExp(`/api/projects/${state.project_id}/intent-submissions$`, "u");
    const item = new RegExp(`/api/projects/${state.project_id}/intent-submissions/${submissionId}$`, "u");
    const actionRoute = new RegExp(`/api/projects/${state.project_id}/intent-submissions/${submissionId}/actions$`, "u");
    await page.route(base, async (route) => {
      const payload = route.request().postDataJSON();
      expect(payload.request_text).toContain("timeout");
      expect(payload.attachments).toEqual([{ name: "requirements.md", content: "Acceptance from file" }]);
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ submission: { ...submission, status: "submitted" }, status_ref: `/api/projects/${state.project_id}/intent-submissions/${submissionId}` }) });
    });
    await page.route(item, (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ submission, normalization: report }) }));
    await page.route(actionRoute, async (route) => {
      const payload = route.request().postDataJSON();
      actions.push(payload.action);
      if (payload.action === "revise") {
        report = payload.normalization;
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ submission, report }) });
      } else if (payload.action === "confirm-and-start") {
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ retryable_start: true, flow_id: "flow.browser-proof" }) });
      } else {
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ retryable_start: false, flow_id: "flow.browser-proof" }) });
      }
    });
    await page.goto(state.app_url);
    await page.getByLabel("Request").fill("Fix the authorization timeout.");
    await page.getByLabel("Text attachments").setInputFiles({ name: "requirements.md", mimeType: "text/markdown", buffer: Buffer.from("Acceptance from file") });
    await page.getByRole("button", { name: "Prepare task" }).click();
    await expect(page.getByLabel("Task title")).toHaveValue("Fix timeout handling");
    await expect(page.getByText("patch-only", { exact: true })).toBeVisible();
    await expect(page.getByText("claude-code", { exact: true })).toBeVisible();
    await page.getByLabel("Task title").fill("Fix authorization timeout handling");
    await page.getByRole("button", { name: "Save revision" }).click();
    await expect.poll(() => report.title).toBe("Fix authorization timeout handling");
    await page.getByRole("button", { name: "Confirm and start" }).click();
    await expect(page.getByText("The Flow was created, but its first action did not start.")).toBeVisible();
    await page.getByRole("button", { name: "Retry start" }).click();
    await expect.poll(() => actions).toEqual(["revise", "confirm-and-start", "retry-start"]);
    expect(actions.filter((action) => action === "confirm-and-start")).toHaveLength(1);
    expect(fs.existsSync(state.runtime_root)).toBe(false);
  });

  test("text-only intent prepares a no-write review without attachments", async ({ page }) => {
    const state = readHarnessState();
    await blockExternalNetwork(page, state.app_url);
    const submissionId = "intent.browser-text-only";
    const submission = { submission_id: submissionId, status: "prepared", attachments: [] };
    const report = {
      status: "prepared", title: "Review authorization", outcome: "Explain authorization risks without changing code.",
      constraints: [], acceptance: ["Risks and recommendations are listed."], scope: ["src/auth/**"],
      work_type: "review", delivery_mode: "no-write", assumptions: [], open_questions: [],
      provider: { adapter_id: "qwen-code" }, confidence: 0.88,
    };
    await page.route(new RegExp(`/api/projects/${state.project_id}/intent-submissions$`, "u"), async (route) => {
      expect(route.request().postDataJSON()).toEqual({ request_text: "Review authorization risks.", attachments: [] });
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ submission: { ...submission, status: "submitted" }, status_ref: `/api/projects/${state.project_id}/intent-submissions/${submissionId}` }) });
    });
    await page.route(new RegExp(`/api/projects/${state.project_id}/intent-submissions/${submissionId}$`, "u"), (route) => route.fulfill({
      contentType: "application/json", body: JSON.stringify({ submission, normalization: report }),
    }));
    await page.goto(state.app_url);
    await page.getByLabel("Request").fill("Review authorization risks.");
    await page.getByRole("button", { name: "Prepare task" }).click();
    await expect(page.getByLabel("Task title")).toHaveValue("Review authorization");
    await expect(page.getByText("no-write", { exact: true })).toBeVisible();
    await expect(page.getByText("qwen-code", { exact: true })).toBeVisible();
  });

  test("Quiet Cockpit lifecycle navigation reflows without hiding state", async ({ page }) => {
    test.setTimeout(90_000);
    const state = readHarnessState(); await blockExternalNetwork(page, state.app_url);
    for (const viewport of [{ width: 320, height: 700 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1024, height: 768 }, { width: 1180, height: 900 }, { width: 1181, height: 900 }, { width: 1440, height: 900 }]) {
      await page.setViewportSize(viewport); await page.goto(state.app_url);
      await expect(page.getByRole("region", { name: "Quiet Cockpit navigation" })).toBeVisible();
      await expect(page.getByText("Current lifecycle stage", { exact: true })).toBeVisible();
      await page.getByRole("tab", { name: "Evidence", exact: true }).click();
      if (viewport.width <= 768) await page.getByLabel("View lifecycle stage").selectOption("review");
      else { await page.getByRole("button", { name: "Review / QA" }).focus(); await page.keyboard.press("Enter"); }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    }
  });

  test("Quiet Cockpit keeps multiple attention drafts and flow-scoped Journey and Evidence", async ({ page }) => {
    const state = readHarnessState(); await blockExternalNetwork(page, state.app_url);
    const flow = { flow_id: `flow.${state.project_id}.attention-proof`, status: "active", selected_stage: "execution", evidence_refs: [] };
    await page.route(new RegExp(`/api/projects/${state.project_id}/state$`, "u"), (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ project_id: state.project_id, initialized: true, state: "ready", stage: "execution", runtime_root: state.runtime_root, state_file: `${state.runtime_root}/project-state.json`, onboarding_summary: { initialized: true, state_exists: true } }) }));
    await page.route(new RegExp(`/api/projects/${state.project_id}/flows$`, "u"), (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ flows: [flow], selected_flow_id: flow.flow_id }) }));
    await page.route("**/flows/selected", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(flow) }));
    await page.route(new RegExp(`/api/projects/${state.project_id}/flows/.+/attention$`, "u"), (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ project_id: state.project_id, flow_id: `flow.${state.project_id}.safe-walkthrough`, initialized: true, read_only: true, freshness: "current", latest_source_at: "2026-07-17T00:00:00.000Z", items: [{ item_id: "attention.interaction.one", source_family: "interaction-request", source_ref: "evidence://interaction-one", stage: "execution", state: "needs-attention", severity: "warning", title: "Answer implementation question", consequence: "Execution is waiting for operator input.", operator_control: null, evidence_refs: ["evidence://interaction-one"], created_at: "2026-07-17T00:00:00.000Z", updated_at: "2026-07-17T00:00:00.000Z" }, { item_id: "attention.decision.two", source_family: "review-decision", source_ref: "evidence://decision-two", stage: "review", state: "needs-attention", severity: "danger", title: "Review failed verification", consequence: "Delivery remains blocked.", operator_control: null, evidence_refs: ["evidence://decision-two"], created_at: "2026-07-17T00:01:00.000Z", updated_at: "2026-07-17T00:01:00.000Z" }] }) }));
    await page.goto(state.app_url);
    await page.getByRole("tab", { name: "Attention" }).click();
    await expect(page.getByRole("region", { name: "Attention queue" })).toBeVisible();
    await page.getByRole("button", { name: /Answer implementation question/u }).click(); await page.getByLabel("Operator draft").fill("first draft");
    await page.getByRole("button", { name: /Review failed verification/u }).click(); await page.getByLabel("Operator draft").fill("second draft");
    await page.getByRole("button", { name: /Answer implementation question/u }).click(); await expect(page.getByLabel("Operator draft")).toHaveValue("first draft");
    await page.getByRole("tab", { name: "Journey" }).click(); await expect(page.getByRole("region", { name: "Journey" })).toBeVisible();
    await page.getByRole("tab", { name: "Evidence" }).click(); await expect(page.getByRole("region", { name: "Evidence" })).toBeVisible();
  });

  test("source chooser preserves project state and keyboard modal behavior", async ({ page }) => {
    const state = readHarnessState();
    await blockExternalNetwork(page, state.app_url);
    const sources = [];
    await page.route("**/api/projects/actions", async (route) => {
      const payload = route.request().postDataJSON();
      sources.push(payload.source);
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({ job: { job_id: `job-${sources.length}`, status: "failed", error: "fixture connection failure" } }),
      });
    });
    await page.goto(state.app_url);
    await expect(page.locator("#project-switcher-control")).toBeVisible();
    await expect(page.getByRole("heading", { name: "What should AOR do?" })).toBeVisible();
    const opener = page.getByRole("button", { name: /Add AOR Project/i }).first();
    await opener.click();
    const dialog = page.getByRole("dialog", { name: /Connect project|Add AOR Project/u });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused();
    await expect.poll(() => page.locator("header.topbar").evaluate((element) => element.inert)).toBe(true);
    await dialog.getByLabel("Absolute folder path").fill("/tmp/aor-dialog-focus-fixture");
    const connectAction = dialog.getByRole("button", { name: "Connect code" });
    await connectAction.focus();
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(connectAction).toBeFocused();
    await connectAction.click();
    await expect(dialog.getByRole("status")).toContainText("fixture connection failure");
    await dialog.getByLabel("Source").selectOption("git");
    await dialog.getByLabel("HTTPS or SSH Git URL").fill("git@example.invalid:repository.git");
    await connectAction.click();
    await expect.poll(() => sources).toEqual([
      { kind: "local", path: "/tmp/aor-dialog-focus-fixture" },
      { kind: "git", url: "git@example.invalid:repository.git" },
    ]);
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toBeHidden();
    const discardDialog = page.getByRole("dialog", { name: "Discard project draft?" });
    await expect(discardDialog).toBeVisible();
    await discardDialog.getByRole("button", { name: "Discard draft" }).click();
    await expect(discardDialog).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test("durable event delivery refreshes browser state", async ({ page }) => {
    const state = readHarnessState();
    await blockExternalNetwork(page, state.app_url);
    let eventStreamOpened = false;
    let stateReads = 0;
    await page.route(new RegExp(`/api/projects/${state.project_id}/state$`, "u"), async (route) => {
      stateReads += 1;
      await route.continue();
    });
    await page.route(new RegExp(`/api/projects/${state.project_id}/runs$`, "u"), async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify([{ run_id: "browser-live-run", status: "running" }]),
      });
    });
    await page.route("**/runs/browser-live-run/events?*", async (route) => {
      eventStreamOpened = true;
      // Let the initial project snapshot settle before the durable event asks
      // the client to refresh it. This keeps the fixture independent of CI I/O.
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await route.fulfill({
        contentType: "text/event-stream",
        body: 'id: browser-live-run:1\ndata: {"event_type":"run.progress"}\n\n',
      });
    });
    await page.goto(state.app_url);
    await expect.poll(() => eventStreamOpened).toBe(true);
    await expect.poll(() => stateReads).toBeGreaterThan(1);
  });

  test("multiple runtime interactions are independently selectable", async ({ page }) => {
    const state = readHarnessState();
    await blockExternalNetwork(page, state.app_url);
    const flow = {
      flow_id: "browser-flow",
      status: "active",
      selected_stage: "execution",
      evidence_refs: ["step-result://interaction-one", "step-result://interaction-two"],
    };
    await page.route(new RegExp(`/api/projects/${state.project_id}/state$`, "u"), (route) => route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ project_id: state.project_id, initialized: true, state: "ready", stage: "execution", onboarding_summary: { initialized: true, state_exists: true }, storage: { kind: "aor-home", server_owned: true } }),
    }));
    await page.route(new RegExp(`/api/projects/${state.project_id}/flows(?:\\?.*)?$`, "u"), async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ flows: [flow], selected_flow_id: flow.flow_id }),
      });
    });
    await page.route("**/flows/selected", async (route) => {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(flow) });
    });
    await page.route("**/step-results", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify([
          {
            artifact_ref: "step-result://interaction-one",
            document: {
              run_id: "run-one",
              requested_interaction: {
                requested: true,
                status: "requested",
                interaction_id: "interaction-one",
                prompt_summary: "Choose the first answer",
              },
            },
          },
          {
            artifact_ref: "step-result://interaction-two",
            document: {
              run_id: "run-two",
              requested_interaction: {
                requested: true,
                status: "requested",
                interaction_id: "interaction-two",
                prompt_summary: "Choose the second answer",
              },
            },
          },
        ]),
      });
    });
    await page.goto(state.app_url);
    await page.locator("#flow-advanced-workbench > .advanced-workbench-disclosure").evaluate((element) => {
      element.open = true;
      element.dispatchEvent(new Event("toggle"));
    });
    await page.getByRole("tab", { name: /Interactions/ }).click();
    await page.getByRole("button", { name: /Choose the second answer/ }).click();
    await expect(page.getByText("interaction-two", { exact: true })).toBeVisible();
  });

  test("structured plan task details remain keyboard accessible at mobile width", async ({ page }) => {
    const state = readHarnessState();
    await blockExternalNetwork(page, state.app_url);
    await page.setViewportSize({ width: 390, height: 844 });
    const flow = { flow_id: "plan-proof-flow", status: "active", selected_stage: "planning", evidence_refs: [] };
    await page.route(new RegExp(`/api/projects/${state.project_id}/state$`, "u"), (route) => route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ project_id: state.project_id, initialized: true, state: "ready", stage: "planning", onboarding_summary: { initialized: true, state_exists: true }, storage: { kind: "aor-home", server_owned: true } }),
    }));
    await page.route(new RegExp(`/api/projects/${state.project_id}/flows(?:\\?.*)?$`, "u"), (route) => route.fulfill({
      contentType: "application/json", body: JSON.stringify({ flows: [flow], selected_flow_id: flow.flow_id }),
    }));
    await page.route("**/flows/selected", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(flow) }));
    await page.route("**/flows/plan-proof-flow/plan", (route) => route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        plan_ref: "evidence://artifacts/wave-ticket-plan-proof.json",
        plan: {
          plan_id: "plan.browser-proof", plan_version: 2, plan_status: "approved",
          local_tasks: [{
            task_id: "task.browser-proof", title: "Verify structured planning", type: "verification",
            objective: "Prove task detail access.", rationale: "Operators need inspectable evidence.",
            scope: { repo_ids: ["main"], component_ids: [], allowed_paths: ["apps/web/**"], forbidden_paths: [] },
            depends_on: [], work_items: ["Inspect the task."], criteria_refs: ["acceptance.browser"],
            verification: { command_group_refs: ["test-web-browser"], validators: [], manual_checks: [], success_conditions: ["Dialog is accessible."] },
            expected_evidence: ["browser-proof"], risks: [], stop_conditions: [],
            execution_hints: { group_key: null, group_reason: null, parallel_candidate: false },
          }],
          criteria_catalog: [{ criterion_id: "acceptance.browser", kind: "acceptance", text: "Plan detail is accessible.", source_ref: "packet://proof" }],
          revision_summary: { reason: "Approved proof revision.", material_change: true },
        },
        handoff_packet: { approval_state: { state: "approved" } },
      }),
    }));
    await page.route("**/flows/plan-proof-flow/plan/progress", (route) => route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ task_progress: { tasks: [{ task_id: "task.browser-proof", status: "verification-pending", attempt_refs: ["run.proof.1"], evidence_refs: [], blocking_findings: [], next_action: "Run browser proof." }] } }),
    }));
    await page.goto(state.app_url);
    const task = page.getByRole("button", { name: "Verify structured planning" });
    await expect(task).toBeVisible();
    await task.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Verify structured planning" });
    await expect(dialog.getByText("run.proof.1")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(task).toBeFocused();
  });
});
