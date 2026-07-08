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
    "Create Flow & Resolve Next Action",
    "Create Follow-up Flow & Resolve Next Action",
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
    "Verification plan",
    "verification_plan",
    "group.outcome",
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
    "compactVisibleValue",
    "CompactInlineValue",
    "CompactDetailValue",
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
    "StageSpecificPanel",
    "artifact-readiness-grid",
    "artifact_readiness",
    "Review Gate Matrix",
    "Delivery / Release Finalization",
    "Learning Closure / Start New Flow",
    "Interaction Detail",
    "Trace timeline",
    "Provider heartbeat",
    "provider_step_status",
    "Provider is still running",
    "No output or progress has been observed yet; provider still running",
    "Provider progress was observed earlier",
    "Provider output was observed earlier",
    "Provider was stopped by the operator",
    "interruption_owner",
    "Interruption owner",
    "Interruption status",
    "isActiveProviderStepStatus",
    "window.setInterval(poll, 5000)",
    "silent: true",
    "Last progress",
    "Activity",
    "Output mode",
    "First-run wizard",
    "Project Context",
    "Runtime Readiness",
    "Configure First Flow",
    "First-flow setup is the only required next step.",
    "firstRunFocusMode",
    "first-run-focus-mode",
    "AdvancedEvidenceDisclosure",
    "Advanced evidence",
    "FlowAdvancedWorkbench",
    "Advanced evidence workbench",
    "advanced-workbench-tabs",
    "flow-advanced-workbench",
    "setExpanded(!media.matches)",
    "Workbench",
    "support-table-grid",
    "shortPathLabel",
    "runtimeRootLabel",
    "topbar-status-strip",
    "first-run-next-action-grid",
    "stage-progress-strip",
    "compact-first-run",
    "safe-template-summary",
    "form-primary-action",
    "Edit mission details",
    "active-flow-handoff",
    "Ask AOR for selected flow",
    "Ask AOR requires a selected active flow",
    "Available after completed flow",
    "Requires selected active flow",
    "runtime-path-details",
    "runtime-copy-chip",
    "Project switcher",
    'htmlFor="project-switcher-control"',
    'id="project-switcher-control"',
    'name="project-switcher"',
    'aria-label="Project switcher"',
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
    "requestDrawerOpenerRef",
    "pendingRequestDrawerFocusRestore",
    "restoreRequestDrawerFocus",
    "clearResult: false",
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
    'window.scrollTo({ top: 0, left: 0, behavior: "auto" })',
    "No active flow",
    'htmlFor="flow-selector-control"',
    'id="flow-selector-control"',
    'name="flow-selector"',
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
    "isOperatorDecisionRequestRef",
    "normalizeOperatorDecisionStatus",
    "isOpenOperatorDecisionStatus",
    "supportedDecisionActionsFromRecord",
    "isOperatorDecisionRequestRow",
    "Review the runtime decision request",
    "No pending agent decision request for this flow.",
    "agent_decision_request_ref",
    "aor run steer --run-id",
    "Copy request ref",
    "copyFeedback",
    "Clipboard unavailable. Select and copy this value.",
    "Copy fallback value",
    "ref.copy-fallback",
    "awaiting-decision",
    '"exit-0"',
    "Execution Evidence",
    "Active Quality Gate",
    "Budget Exhausted Hold",
    "active_quality_gate",
    "QualityGatePanel",
    "qualityGateSourceLabel",
    "qualityGateAttemptLabel",
    "delivery_release_blocked",
    "Next safe action",
    "executionEvidenceForFlow",
    "strongestExecutionEvidenceRun",
    "executionEvidenceScore",
    "selectedFlowRuntimeTrace",
    "flowRuntimeTrace?.flow_id !== selectedFlow.flow_id",
    "setFlowRuntimeTrace(null)",
    "setFlowEvidenceGraph(null)",
    "execution_evidence",
    'real_code_change_status === "pass"',
    'group.group_id === "mission-relevant"',
    'runId.includes(".verify.")',
    'runId.includes(".routed-execution.")',
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
    "delivery-mode={selectedDeliveryMode}",
    "syncExpandedToViewport",
  ]) {
    assert.ok(source.includes(required), `SPA source should include '${required}'`);
  }
  assert.ok(css.includes(".app-shell"), "SPA CSS should define app shell layout");
  assert.ok(css.includes("--control-height: 38px"), "SPA CSS should define a desktop control height token");
  assert.ok(css.includes("--touch-control-height: 44px"), "SPA CSS should define a mobile touch target token");
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
  assert.ok(css.includes(".quality-gate-card"), "SPA CSS should define active quality gate layout");
  assert.ok(css.includes(".quality-gate-card.operator-hold"), "SPA CSS should distinguish exhausted repair budgets");
  assert.ok(css.includes(".verification-plan-card"), "SPA CSS should define compact verification plan layout");
  assert.ok(css.includes(".execution-evidence-panel"), "SPA CSS should define execution evidence panel layout");
  assert.ok(css.includes(".advanced-workbench-disclosure"), "SPA CSS should group active advanced surfaces behind one disclosure");
  assert.ok(css.includes(".advanced-workbench-tabs"), "SPA CSS should define active advanced workbench tabs");
  assert.ok(css.includes(".compact-inline-value"), "SPA CSS should define compact inline value layout");
  assert.ok(css.includes(".compact-detail-value"), "SPA CSS should define compact detail value layout");
  assert.match(css, /\.form-actions \.form-primary-action\s*\{[\s\S]*?min-height: var\(--control-height\);/u, "Safe first-flow submit action should stay in the first mission form action row");
  assert.match(css, /\.safe-template-summary\s*\{[\s\S]*?grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/u, "Safe first-flow summary should remain a compact information grid");
  assert.match(css, /\.mission-detail-fields summary\s*\{[\s\S]*?min-height: var\(--touch-control-height\);/u, "Mission detail disclosure should meet mobile touch target size");
  assert.match(css, /summary:focus-visible/u, "SPA CSS should expose keyboard focus on disclosure controls");
  assert.match(css, /\.debug-ref-details summary\s*\{[\s\S]*?min-height: var\(--control-height\);/u, "Debug disclosure controls should meet the shared target size");
  assert.match(css, /\.runtime-path-details summary\s*\{[\s\S]*?min-height: var\(--control-height\);/u, "Runtime path disclosure controls should meet the shared target size");
  assert.match(css, /\.artifact-filter-bar button\s*\{[\s\S]*?min-height: var\(--control-height\);/u, "Artifact filters should meet the shared target size");
  assert.match(css, /\.row-actions \.icon-button\s*\{[\s\S]*?width: var\(--control-height\);[\s\S]*?height: var\(--control-height\);/u, "Artifact row icon actions should meet the shared target size");
  assert.ok(css.includes(".support-table-grid"), "SPA CSS should hide first-run support tables behind disclosure");
  assert.equal(
    source.includes("candidates.at(-1)"),
    false,
    "SPA should not show the last trace run when a stronger implementation execution evidence run exists",
  );
  assert.ok(css.includes(".path-group-row.runner-owned-leak"), "SPA CSS should visibly distinguish runner-owned state leaks");
  assert.ok(css.includes(".execution-action-grid"), "SPA CSS should define public execution action controls");
  assert.ok(css.includes(".copy-feedback"), "SPA CSS should define copy fallback feedback layout");
  assert.ok(css.includes(".flow-active-mode .recommended-action .cockpit-actions"), "SPA CSS should place active mobile cockpit actions before stacked details");
  assert.match(
    css,
    /@media \(max-width: 860px\) \{[\s\S]*?\.first-run-focus-mode \.topbar\s*\{[\s\S]*?display: grid;[\s\S]*?grid-template-columns: minmax\(0, 1fr\) max-content max-content;/u,
    "SPA CSS should compact first-run topbar into a two-action grid on mobile",
  );
  assert.match(
    css,
    /\.flow-active-mode \.advanced-workbench-row\s*\{[\s\S]*?grid-row: 3;/u,
    "Active advanced workbench should render before Activity / Events support tables on desktop",
  );
  assert.match(
    css,
    /\.flow-active-mode \.bottom-bar\s*\{[\s\S]*?grid-row: 4;/u,
    "Active Activity / Events support tables should follow the advanced workbench on desktop",
  );
  assert.ok(css.includes("grid-template-columns: repeat(auto-fit, minmax(150px, 1fr))"), "SPA CSS should keep the mobile stage rail within the viewport");
  assert.ok(css.includes(".stage-rail.compact-first-run .stage-progress-strip"), "SPA CSS should show a compact first-run stage progress strip on mobile");
  assert.ok(css.includes(".stage-rail.compact-first-run nav"), "SPA CSS should collapse the full stage rail behind the compact first-run strip on mobile");
  assert.ok(css.includes(".flow-active-mode .stage-rail .stage-progress-strip"), "SPA CSS should show a compact active-flow stage progress strip on tablet and mobile");
  assert.ok(css.includes(".flow-active-mode .topbar-ask-button .action-label"), "SPA CSS should collapse long active-flow topbar button copy on mobile");
  assert.ok(css.includes(".stage-row .stage-copy strong"), "SPA CSS should allow mobile stage labels to wrap");
  assert.match(
    css,
    /@media \(max-width: 860px\) \{[\s\S]*?\.project-switcher\s*\{[\s\S]*?grid-template-columns: 1fr;[\s\S]*?min-width: 0;/u,
    "SPA CSS should collapse the project switcher on mobile instead of creating horizontal scroll",
  );
  assert.match(
    css,
    /@media \(max-width: 860px\) \{[\s\S]*?\.project-switcher-meta code,\s*\.top-context code\s*\{[\s\S]*?white-space: normal;/u,
    "SPA CSS should wrap long runtime paths on mobile",
  );
  assert.match(
    css,
    /@media \(max-width: 860px\) \{[\s\S]*?\.first-run-focus-mode \.project-switcher-meta code,[\s\S]*?white-space: nowrap;/u,
    "SPA CSS should truncate long runtime paths in first-run mobile focus mode",
  );
  assert.match(
    css,
    /@media \(max-width: 860px\) \{[\s\S]*?\.first-run-next-action-grid,[\s\S]*?\.active-flow-handoff,[\s\S]*?\.advanced-evidence-summary-grid,[\s\S]*?grid-template-columns: 1fr;/u,
    "SPA CSS should collapse first-run focus grids on mobile",
  );
  assert.ok(css.includes("grid-template-columns: repeat(auto-fit, minmax(92px, 1fr))"), "SPA CSS should keep the mobile flow timeline within the viewport");
  assert.ok(css.includes(".timeline-step::before"), "SPA CSS should disable connector overflow for the mobile flow timeline");
  assert.match(
    css,
    /@media \(max-width: 860px\) \{[\s\S]*?\.graph-flow-node::after\s*\{[\s\S]*?display: none;/u,
    "SPA CSS should disable graph connector overflow on mobile",
  );
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
    assert.equal(payload.render_guard_status, "pass");
    assert.equal(payload.blank_root_regression_detected, false);
    assert.equal(payload.render_guard.root_element_present, true);
    assert.ok(payload.render_guard.module_script_count >= 1);
    assert.ok(payload.render_guard.stylesheet_count >= 1);
    assert.equal(payload.render_guard.app_shell_marker_present, true);
    assert.equal(payload.runtime_root, runtimeRoot);
  });
});
