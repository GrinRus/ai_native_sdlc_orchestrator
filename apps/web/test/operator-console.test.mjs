import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentFilePath = fileURLToPath(import.meta.url);
const workspaceRoot = path.resolve(path.dirname(currentFilePath), "../../..");

/**
 * @param {(projectRoot: string) => void} callback
 */
function withTempProject(callback) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-web-app-smoke-"));
  try {
    callback(tempRoot);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

test("packaged SPA exposes installed-user guided mission controls", () => {
  const source = fs.readFileSync(path.join(workspaceRoot, "apps/web/src/spa.jsx"), "utf8");
  const css = fs.readFileSync(path.join(workspaceRoot, "apps/web/src/spa.css"), "utf8");

  for (const required of [
    "safe-walkthrough",
    "Create Mission Packet & Resolve Next Action",
    "Mission intake",
    "Flow selector",
    "Active flows",
    "Completed flows (read-only)",
    "Flow completed - evidence locked",
    "Start New Flow",
    "Create follow-up from learning handoff",
    "Duplicate mission settings",
    "follow-up-source-handoff-ref",
    "Evidence Graph",
    "Runtime Trace",
    "Next action",
    "Evidence artifacts",
    "No upstream writes",
    "/flows/selected",
    "/evidence-graph",
    "/runtime-trace",
    "lifecycle-command/actions",
    "operator-requests",
    "target_flow_id",
    "targetFlowId",
    "requestStageId",
    "sameFlow",
    "sameStage",
    "comparableEvidenceRef",
    "evidenceRefsMatch",
    "latestRequestForFlow",
    "flowScopedInteractions",
    "actionCommandLabel",
    "topbar-ask-button",
    "draft: newFlowDraft",
    "draftSurface",
    "currentStage = draftSurface ? \"mission\"",
    "Draft flow has no artifacts yet",
    "No visible artifacts yet",
    "workbenchEvidenceRows",
    "latestDecisionRequestFromEvidence",
    "selected flow or project-level live evidence",
    "New Flow Preview",
    "Completeness Checklist",
    "Cancel New Flow",
    "flow.new-draft-cancelled",
    "flowSelectionVersion",
    "selectionVersion",
    "selectionApplied",
    "refresh({ newFlowDraft: false, selectedFlowId: fallbackFlowId, selectionVersion: cancelSelectionVersion })",
    "delivery-mode-card",
    "request-intent-segment",
    "request-scope-card",
    "graph-flow-canvas",
    "graph-trace-row",
    "StageSpecificPanel",
    "Review Gate Matrix",
    "Delivery / Release Finalization",
    "Learning Closure / Start New Flow",
    "Interaction Detail",
    "Trace timeline",
    "Provider heartbeat",
    "provider_step_status",
    "Provider is still running",
    "No output or progress yet, provider still running",
    "Last progress",
    "Activity",
    "Output mode",
    "First-run wizard",
    "Project Context",
    "Runtime Readiness",
    "Project switcher",
    "Add local project",
    "Runtime root preview",
    "Add and initialize",
    "/api/projects/actions",
    "/runs",
    "graph-context-tabs",
    "selected-node-panel",
    "stage-specific-panel",
    "interactions-layout",
    "trace-timeline-strip",
    "Create and run request",
    "Create no-write inspection request",
    "Add at least one target ref",
    "Initialize Project Runtime",
    "First launch",
    "This does not create a flow",
    "if (!flow) return \"readiness\"",
    "newFlowDisabled",
    "Initialize the project runtime before starting a flow.",
    "flow.new-blocked",
    "setAddProjectDrawerOpen(false)",
    "activeProject?.runtime_root",
    "Create the first no-write mission packet, then resolve the first next action.",
    "No active flow",
    "Readiness prepares the runtime before a flow is created",
    "selectedStageRuntimeState",
    "Upcoming stage. The current recommended action remains scoped",
    "Recommended action context",
    "Expected outputs",
    "Command provenance",
    "Dry-run preview",
    "Flow inventory",
    "stage-status-badge",
    "operator-request.completed",
    "mission create",
    "next",
    "artifact_display_summaries: next.artifact_display_summaries",
    "artifact_display_summaries",
    "normalizeArtifactSummary",
    "artifactFilterMatches",
    "artifact-filter-bar",
    "filteredRows.find",
    "No evidence matches the selected filter.",
    "Copy raw ref",
    "Debug raw ref",
    "Evidence artifacts",
    "Operator Decision",
    "operatorDecisionRequestsForFlow",
    "supportedDecisionActionsFromRecord",
    "decisionHelperCommand",
    "shellArg",
    "requestRef ? shellArg(requestRef)",
    "Prepare corrected draft",
    "manual-live-e2e.mjs",
    "--prepare-decision",
    "Copy request ref",
    "copyFeedback",
    "Clipboard unavailable. Select and copy this value.",
    "Copy fallback value",
    "ref.copy-fallback",
    "awaiting-decision",
    '"exit-0"',
    "Execution Evidence",
    "executionEvidenceForFlow",
    "execution_evidence",
    "Provider execution",
    "Runtime Harness",
    "Real code change",
    "runner-owned-leak",
    "scratch-unrelated",
    "Stop provider",
    "Save partial evidence",
    "Diagnose current step",
    "Retry public step",
    "aor run cancel",
    "aor run status --run-id",
  ]) {
    assert.ok(source.includes(required), `SPA source should include '${required}'`);
  }
  assert.ok(css.includes(".app-shell"), "SPA CSS should define app shell layout");
  assert.ok(css.includes(".flow-selector"), "SPA CSS should define flow selector layout");
  assert.ok(css.includes(".flow-cockpit"), "SPA CSS should define flow-first cockpit layout");
  assert.ok(css.includes(".stage-rail"), "SPA CSS should define flow-scoped stage rail layout");
  assert.ok(css.includes(".provider-heartbeat-card"), "SPA CSS should define provider heartbeat cockpit layout");
  assert.ok(css.includes(".first-run-wizard"), "SPA CSS should define first-run wizard layout");
  assert.ok(css.includes(".project-switcher"), "SPA CSS should define project switcher layout");
  assert.match(css, /\.topbar\s*\{[\s\S]*?flex-wrap: wrap;/u, "SPA topbar should wrap instead of overlapping project and flow controls");
  assert.match(css, /\.project-switcher\s*\{[\s\S]*?flex: 0 0 560px;/u, "Project switcher should not shrink under the flow selector");
  assert.match(css, /\.flow-selector\s*\{[\s\S]*?flex: 0 0 360px;/u, "Flow selector should not intercept project switcher clicks");
  assert.ok(css.includes(".provider-heartbeat-rail"), "SPA CSS should define provider heartbeat stage rail layout");
  assert.ok(css.includes(".execution-evidence-panel"), "SPA CSS should define execution evidence panel layout");
  assert.ok(css.includes(".path-group-row.runner-owned-leak"), "SPA CSS should visibly distinguish runner-owned state leaks");
  assert.ok(css.includes(".execution-action-grid"), "SPA CSS should define public execution action controls");
  assert.ok(css.includes(".copy-feedback"), "SPA CSS should define copy fallback feedback layout");
  assert.ok(css.includes("grid-template-columns: repeat(auto-fit, minmax(150px, 1fr))"), "SPA CSS should keep the mobile stage rail within the viewport");
  assert.ok(css.includes(".stage-row .stage-copy strong"), "SPA CSS should allow mobile stage labels to wrap");
  assert.ok(css.includes("grid-template-columns: repeat(auto-fit, minmax(92px, 1fr))"), "SPA CSS should keep the mobile flow timeline within the viewport");
  assert.ok(css.includes(".timeline-step::before"), "SPA CSS should disable connector overflow for the mobile flow timeline");
  assert.ok(css.includes(".trace-table table"), "SPA CSS should make runtime trace tables responsive on mobile");
  assert.ok(css.includes(".right-rail"), "SPA CSS should define evidence rail layout");
});

test("web package no longer exports static operator snapshot modules", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(workspaceRoot, "apps/web/package.json"), "utf8"));
  const oldScriptName = `operator-console-${"smoke"}.mjs`;
  const oldEntryName = `operator-console${".mjs"}`;
  const oldSourceDir = `operator-${"console"}`;
  assert.deepEqual(manifest.exports, {});
  assert.equal(fs.existsSync(path.join(workspaceRoot, "apps/web/scripts", oldScriptName)), false);
  assert.equal(fs.existsSync(path.join(workspaceRoot, "apps/web/src", oldEntryName)), false);
  assert.equal(fs.existsSync(path.join(workspaceRoot, "apps/web/src", oldSourceDir)), false);
});

test("aor app smoke verifies the real flow-centric packaged SPA, config, and state routes", () => {
  withTempProject((projectRoot) => {
    fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
    const runtimeRoot = path.join(projectRoot, ".aor");
    const run = spawnSync(
      process.execPath,
      [
        path.join(workspaceRoot, "apps/cli/bin/aor.mjs"),
        "app",
        "--project-ref",
        projectRoot,
        "--runtime-root",
        runtimeRoot,
        "--smoke",
        "true",
        "--open",
        "false",
        "--json",
      ],
      {
        cwd: projectRoot,
        encoding: "utf8",
      },
    );
    assert.equal(run.status, 0, run.stderr);
    const payload = JSON.parse(run.stdout);
    assert.equal(payload.command, "app");
    assert.equal(payload.mode, "local-spa");
    assert.equal(payload.status, "smoke-pass");
    assert.equal(payload.html_loaded, true);
    assert.equal(payload.flow_selector_loaded, true);
    assert.equal(payload.new_flow_action_loaded, true);
    assert.equal(payload.first_run_wizard_loaded, true);
    assert.equal(payload.project_switcher_loaded, true);
    assert.equal(payload.config_project_id, payload.project_id);
    assert.equal(payload.config_default_project_id, payload.project_id);
    assert.equal(payload.project_index_default_project_id, payload.project_id);
    assert.equal(payload.project_index_count, 1);
    assert.equal(payload.state_project_id, payload.project_id);
    assert.equal(payload.runtime_root, runtimeRoot);
  });
});
