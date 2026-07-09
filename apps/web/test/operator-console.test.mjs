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
    "ProjectSnapshotLoading",
    "Syncing project state",
    "Project state is loading.",
    "Active flows",
    "Completed flows (read-only)",
    "Flow completed - evidence locked",
    "Start New Flow",
    "Create follow-up from learning handoff",
    "Duplicate mission settings",
    "follow-up-source-handoff-ref",
    "Evidence Graph",
    "Runtime Trace",
    "EvidenceReadinessPath",
    "Readiness path",
    "needs flow evidence",
    "Refresh the selected flow after a lifecycle command",
    "Refresh run status or open Execution Evidence",
    "Next action",
    "Evidence artifacts",
    "qualityClosurePlan",
    "Quality closure path",
    "Quality closure still needs evidence",
    "Run-health is factual status",
    "Run or attach the outcome assessment",
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
    "actionOutcomeTitle",
    "actionOutcomeDetail",
    "What happens next",
    "Show CLI command",
    "Materialize discovery evidence",
    "topbar-ask-button",
    "draft: newFlowDraft",
    "draftSurface",
    "currentStage = draftSurface",
    "providerFocusStageId(providerStepStatus, externalRunHealth)",
    "spec: \"discovery\"",
    "handoff: \"discovery\"",
    "eval: \"review\"",
    "harness: \"review\"",
    "EXTERNAL_RUN_STEP_CONTEXT",
    "externalRunStepContext(externalRunHealth)",
    "Execution handoff readiness",
    "Approved handoff packet",
    "Planning -> Execution handoff",
    "Draft flow has no artifacts yet",
    "No visible artifacts yet",
    "workbenchEvidenceRows",
    "latestDecisionRequestFromEvidence",
    "selected flow or project-level live evidence",
    "compactVisibleValue",
    "CompactInlineValue",
    "CompactDetailValue",
    "shellQuoteCommandArg",
    "appendCommandFlag",
    "New Flow Preview",
    "Completeness Checklist",
    "Cancel New Flow",
    "flow.new-draft-cancelled",
    "flowSelectionVersion",
    "projectSnapshotLoaded",
    "snapshot-loading-grid",
    "selectionVersion",
    "selectionApplied",
    "selectionStillCurrent && !didChooseStage.current",
    "setSelectedStage(\"discovery\");",
    "refresh({ newFlowDraft: false, selectedFlowId: fallbackFlowId, selectionVersion: cancelSelectionVersion })",
    "ADVANCED_WORKBENCH_FOCUS_EVENT",
    "ADVANCED_WORKBENCH_TAB_IDS",
    "hasOpenDecisionRequest",
    "Decision Request",
    "openAdvancedWorkbench(workbenchAction.tabId)",
    "setSelectedTab(nextTab)",
    "preferredOperatorDecisionAction",
    "externalRunHealth?.pending_decision?.action",
    "setSelectedAction(preferredAction)",
    "operatorDecisionChecklistItems",
    "normalizeDecisionRubricSummary",
    "decisionRubricSummary",
    "Evidence rubric",
    "Required checks",
    "Required evidence",
    "Decision evidence rubric",
    "Decision checklist",
    "operatorDecisionRecordPlan",
    "Decision record",
    "Copy expected decision ref",
    "Decision record destination",
    "operatorDecisionHelperPlan",
    "operatorDecisionCorrectionPlan",
    "operator_decision_rejection_reason",
    "rejectionReason: normalized.rejection_reason",
    "Correction required",
    "Rejected decision correction plan",
    "Copy correction JSON",
    "Copy rejected reason",
    "Decision handoff",
    "Copy handoff JSON",
    "Copy action note",
    "Copy expected file ref",
    "Decision handoff bundle",
    "Selected action handoff",
    "operatorDecisionResumePath",
    "Resume path",
    "Decision resume path",
    "Copy decision file ref",
    "Resume after write",
    "Inspect the decision request",
    "Confirm evidence coverage",
    "Record selected action",
    "Refresh run status",
    "Record a diagnosis as a stop state; repair or retry must happen through public controls before continuation.",
    "externalRunHealth={externalRunHealth}",
    "delivery-mode-card",
    "request-intent-segment",
    "request-scope-card",
    "graph-flow-canvas",
    "StageSpecificPanel",
    "artifact-readiness-grid",
    "artifact_readiness",
    "qualityGateEvidenceRows",
    "gate?.evidence_summaries",
    "qualityGateRecoveryPlan",
    "Quality gate recovery path",
    "Recovery path",
    "Run repair implementation",
    "Delivery stays blocked",
    "Review Gate Matrix",
    "Delivery / Release Finalization",
    "Learning Closure / Start New Flow",
    "Interaction Detail",
    "Trace timeline",
    "Provider heartbeat",
    "provider_step_status",
    "activeProviderSupersedesExternalRunBlocker",
    "externalRunHealthHasMaterializedDecisionRequest",
    "externalRunHealthHasOpenDecisionRequest",
    "isProviderStepDisplayStatus",
    "providerStepSupersedesRunHealth",
    "displayExternalRunHealth(rawExternalRunHealth, providerStepStatus)",
    "providerWorkbenchFocus",
    "RUN_HEALTH_FIELD",
    "[\"run\", \"health\"].join(\"_\")",
    "resolveExternalRunHealth",
    "isBlockingExternalRunHealth",
    "externalRunFailureUserSummary",
    "externalRunHealthUserSummary",
    "acceptedExternalRunDiagnosis",
    "Diagnosis accepted for ${stepLabel}. Repair is required through public AOR controls",
    "isGenericExternalRunPendingDecisionReason",
    "product-change step quality was assessed from",
    "externalRunActionableDecisionUserSummary",
    "Target setup or target verification failed during the run.",
    "Retry the ${stepLabel} public step after reviewing the blocker.",
    "Run the ${stepLabel} repair path through public AOR controls before continuing.",
    "externalRunPendingDecisionUserReason",
    "externalRunHealthBlockers",
    "externalRunRecoveryPathActive",
    "externalRunRecoveryPathUserSummary",
    "externalRunExecutableRepairCommand",
    "materializedQualityRepairAction",
    "materializedQualityRepairSummary",
    "materializedQualityRepairCompletion",
    "materializedQualityRepairRunId",
    "completedQualityRepairAction",
    "verificationGroupFailureDetail",
    "firstFailedStepResultRef",
    "latestRequiredVerificationFailed",
    "verificationFailureSummary",
    "failed_step_result_refs",
    "failed_command_count",
    "isQualityRepairPrimaryAction",
    "Continue repair run",
    "Repair run completed",
    "Continue with post-run verification",
    "Verification failed after completed repair",
    "Post-run verification failed",
    "Repair failed verification",
    "Post-run verification repair path",
    "Repair implementation has completed. Rerun required verification before QA or delivery.",
    "Run the ${stepLabel} repair path through public AOR controls",
    'normalized.toLowerCase() === "qa"',
    "Review evidence did not connect the provider change to verification results.",
    "Accept the ${stepsLabel} operator decision",
    "missingRunHealthEvidenceSentence",
    "Run-health has ${count} unresolved evidence ${noun}",
    "Review and repair ${count} missing run-health evidence ${noun}",
    "Diagnosis moved ${stepLabel} into repair.",
    "Use the public repair path before QA, delivery, or continuation.",
    "Open the ${stepLabel} decision request",
    "record the operator diagnosis before continuing.",
    "externalRunPendingDecisionUserReason(externalRunHealth, pending)",
    "externalRunHasFailureSummary",
    "isControllerDecisionPendingRunHealth",
    "externalRunStepQualityAssessmentPendingSummary",
    "isStepQualityAssessmentPendingRunHealth",
    "externalRunHasSubstantiveFailureSummary",
    "externalRunContinuationDecisionCopy",
    "externalRunAttentionLabel",
    "externalRunDerivedEvidenceStatus",
    "externalRunRiskLevel",
    "externalRunWorkbenchAction",
    "Record the ${stepLabel} blocker decision before retrying or continuing.",
    "Open the ${stepLabel} decision request and record the operator decision before continuing.",
    "hasOpenDecisionRequest\n      ? { label: \"Decision Request\", icon: \"target\", tabId: \"decisions\" }",
    "${stepLabel} decision request",
    "${stepLabel} assessment request",
    "Assessment Evidence",
    "Decision Evidence",
    "Review Blocker",
    "Recovery Path",
    "Run assessment needed",
    "Assessment checks",
    "awaiting-assessment",
    "Recovery needed",
    "Recovery checks",
    "repair-required",
    "Review blocker",
    "Run decision needed",
    "Decision checks",
    "awaiting-decision",
    "Open ${stepLabel} blocker",
    "projectRunEvidenceSelectorLabel",
    "projectRunEvidenceStatus",
    "projectRunEvidenceIdentity",
    "blocker evidence",
    "Run evidence blocked",
    "Refresh Run Status",
    "Ask AOR needs a selectable flow",
    "Ask AOR needs a flow",
    "delivery_readiness_status: isBlockingExternalRunHealth(externalRunHealth)",
    "externalRunDerivedEvidenceStatus(externalRunHealth, \"blocked\")",
    "externalRunHealth={externalRunHealth}",
    "Provider is still running",
    "No output or progress has been observed yet; provider still running",
    "Provider progress was observed earlier",
    "Provider output was observed earlier",
    "Provider was stopped by the operator",
    "No streamed output captured",
    "No progress events captured",
    "Not reported",
    "providerLastOutputLabel",
    "providerActivityLabel",
    "providerCommandDisplayLabel",
    "Provider CLI session",
    "Review / QA gate ready",
    "Provider execution finished before a flow could be selected.",
    "Delivery artifacts are ready for final operator acceptance and closure.",
    "Inspect delivery artifacts and record the final operator decision before closure.",
    "providerStatusCopy(providerStepStatus, currentStage, verificationPrimary)",
    "providerCommandDetail(providerStepStatus, currentStage, verificationPrimary)",
    "Review QA gate evidence",
    "Provider execution is done. Inspect validation warnings, review findings, and QA evidence before deciding delivery readiness.",
    "Provider run in progress",
    "Live execution is running from project-level evidence before a flow can be selected.",
    "Monitor provider run",
    "Ask AOR needs a selectable flow; use run evidence controls for this blocker.",
    "Use the Decision Request workbench before asking for another flow action.",
    "projectLevelProviderFocus",
    "evidenceRows={providerWorkbenchFocus ? workbenchEvidenceRows : flowEvidenceRows}",
    "providerCommandDetail",
    "Raw runner label: external-provider-runner",
    "interruption_owner",
    "Interruption owner",
    "Interruption status",
    "isActiveProviderStepStatus",
    "isTerminalProviderStepStatus",
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
    "projectDisplayLabel",
    "runtimeRootLabel",
    "Show runtime root path details",
    "Copy runtime root path",
    "conciseArtifactLabel",
    "artifactActionLabel",
    "Open evidence artifact",
    "Copy raw ref for",
    "Attach as request target:",
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
    "Project profile",
    "projectProfile",
    "project_profile",
    "profile_mismatch_candidate_project_ids",
    "Profile mismatch detected",
    "Add Matching Project Profile",
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
    "Loading",
    "First launch",
    'onboarding.status === "not-initialized"',
    "onboarding.can_initialize === true",
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
    "ARTIFACT_REF_LABELS",
    "semanticArtifactTitleFromRef",
    "Next Action Report",
    "Provider Evidence",
    "Operator Decision Request",
    "filteredRows.find",
    "No evidence matches the selected filter.",
    "Copy raw ref",
    "Debug raw ref",
    "Evidence artifacts",
    "Operator Decision",
    "operatorDecisionRequestsForFlow",
    "operatorDecisionRequestsFromExternalRunHealth",
    "mergeOperatorDecisionRequests",
    "blockingExternalRunHealth",
    "providerFocusActive",
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
    "executionRecoveryPlan",
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
    "Run public repair command",
    "Run repair implementation",
    "Inspect completed repair run",
    "Repair is driven by failed post-run evidence",
    "Run repair from failed verification",
    "--project-profile",
    "--run-id",
    "nextAction={nextAction}",
    "repairCompletion={qualityRepairCompletion}",
    "Execution evidence recovery path",
    "Stabilize execution evidence first",
    "${stepLabel} repair path",
    "externalRunHealth={externalRunHealth}",
    "Next public control",
    "aor run cancel",
    "aor run status --run-id",
    "delivery-mode={selectedDeliveryMode}",
    "syncExpandedToViewport",
  ]) {
    assert.ok(source.includes(required), `SPA source should include '${required}'`);
  }
  assert.ok(css.includes(".app-shell"), "SPA CSS should define app shell layout");
  assert.ok(css.includes("--control-height: 40px"), "SPA CSS should define a desktop control height token");
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
  assert.ok(css.includes(".provider-heartbeat-action small"), "Provider heartbeat should demote raw runner labels to secondary debug copy");
  assert.ok(css.includes(".quality-gate-card"), "SPA CSS should define active quality gate layout");
  assert.ok(css.includes(".quality-gate-card.operator-hold"), "SPA CSS should distinguish exhausted repair budgets");
  assert.ok(css.includes(".verification-plan-card"), "SPA CSS should define compact verification plan layout");
  assert.ok(css.includes(".execution-evidence-panel"), "SPA CSS should define execution evidence panel layout");
  assert.ok(css.includes(".advanced-workbench-disclosure"), "SPA CSS should group active advanced surfaces behind one disclosure");
  assert.ok(css.includes(".advanced-workbench-tabs"), "SPA CSS should define active advanced workbench tabs");
  assert.ok(css.includes(".compact-inline-value"), "SPA CSS should define compact inline value layout");
  assert.ok(css.includes(".compact-detail-value"), "SPA CSS should define compact detail value layout");
  assert.ok(css.includes(".next-step-panel"), "Active cockpit should present the recommended action as an operator outcome");
  assert.ok(css.includes(".action-command-details"), "Active cockpit should keep raw lifecycle commands behind technical details");
  assert.match(css, /\.form-actions \.form-primary-action\s*\{[\s\S]*?min-height: var\(--control-height\);/u, "Safe first-flow submit action should stay in the first mission form action row");
  assert.match(css, /\.safe-template-summary\s*\{[\s\S]*?grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/u, "Safe first-flow summary should remain a compact information grid");
  assert.match(css, /\.mission-detail-fields summary\s*\{[\s\S]*?min-height: var\(--touch-control-height\);/u, "Mission detail disclosure should meet mobile touch target size");
  assert.match(css, /summary:focus-visible/u, "SPA CSS should expose keyboard focus on disclosure controls");
  assert.match(css, /\.debug-ref-details summary\s*\{[\s\S]*?min-height: var\(--control-height\);/u, "Debug disclosure controls should meet the shared target size");
  assert.match(css, /\.runtime-path-details summary\s*\{[\s\S]*?min-height: var\(--control-height\);/u, "Runtime path disclosure controls should meet the shared target size");
  assert.match(css, /\.artifact-filter-bar button\s*\{[\s\S]*?min-height: var\(--control-height\);[\s\S]*?min-width: var\(--control-height\);/u, "Artifact filters should meet the shared target size");
  assert.match(css, /\.artifact-summary-button\s*\{[\s\S]*?min-height: var\(--control-height\);/u, "Artifact summary rows should meet the shared target size");
  assert.match(css, /\.row-actions \.icon-button\s*\{[\s\S]*?width: var\(--control-height\);[\s\S]*?height: var\(--control-height\);/u, "Artifact row icon actions should meet the shared target size");
  assert.match(css, /\.first-run-wizard \.readiness-action\s*\{[\s\S]*?order: 1;/u, "First-run primary action should stay above supporting readiness details");
  assert.match(css, /\.first-run-wizard \.first-run-next-action-grid\s*\{[\s\S]*?order: 2;/u, "First-run next-action summary should follow the primary action");
  assert.ok(css.includes(".support-table-grid"), "SPA CSS should hide first-run support tables behind disclosure");
  assert.equal(
    source.includes("candidates.at(-1)"),
    false,
    "SPA should not show the last trace run when a stronger implementation execution evidence run exists",
  );
  assert.ok(css.includes(".path-group-row.runner-owned-leak"), "SPA CSS should visibly distinguish runner-owned state leaks");
  assert.ok(css.includes(".quality-closure-path"), "SPA CSS should define quality closure path layout");
  assert.match(css, /\.quality-closure-path ol\s*\{[\s\S]*?grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/u);
  assert.match(css, /\.quality-closure-path li\.blocked\s*\{/u);
  assert.ok(css.includes(".execution-recovery-path"), "SPA CSS should define execution recovery path layout");
  assert.match(css, /\.execution-recovery-path ol\s*\{[\s\S]*?grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/u);
  assert.match(css, /\.execution-recovery-path li\.ready\s*\{/u);
  assert.ok(css.includes(".decision-resume-path"), "SPA CSS should define operator decision resume path layout");
  assert.match(css, /\.decision-resume-path ol\s*\{[\s\S]*?grid-template-columns: repeat\(auto-fit, minmax\(148px, 1fr\)\);/u);
  assert.match(css, /\.decision-resume-path li\.blocked\s*\{/u);
  assert.match(css, /\.decision-resume-path button\s*\{[\s\S]*?min-height: var\(--control-height\);/u);
  assert.ok(css.includes(".evidence-readiness-path"), "SPA CSS should define graph and trace readiness path layout");
  assert.match(css, /\.evidence-readiness-path ol\s*\{[\s\S]*?grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/u);
  assert.match(css, /\.evidence-readiness-path li\.blocked\s*\{/u);
  assert.ok(css.includes(".execution-action-grid"), "SPA CSS should define public execution action controls");
  assert.ok(css.includes(".copy-feedback"), "SPA CSS should define copy fallback feedback layout");
  assert.ok(css.includes(".flow-active-mode .recommended-action .cockpit-actions"), "SPA CSS should place active mobile cockpit actions before stacked details");
  assert.match(
    css,
    /@media \(max-width: 860px\) \{[\s\S]*?\.flow-active-mode \.recommended-action \.cockpit-actions\s*\{[\s\S]*?display: grid;[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);[\s\S]*?width: 100%;/u,
    "Active mobile cockpit actions should use a bounded two-column grid",
  );
  assert.match(
    css,
    /\.flow-active-mode \.recommended-action \.cockpit-actions \.primary\s*\{[\s\S]*?grid-column: 1 \/ -1;[\s\S]*?width: 100%;/u,
    "Active mobile cockpit primary action should span the full action row",
  );
  assert.match(
    css,
    /\.flow-active-mode \.recommended-action \.cockpit-actions \.secondary\s*\{[\s\S]*?width: 100%;[\s\S]*?min-width: 0;/u,
    "Active mobile cockpit secondary actions should fit within the viewport",
  );
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
  assert.match(
    css,
    /@media \(max-width: 860px\) \{[\s\S]*?\.compact-inline-value > code,\s*\.compact-detail-value > span\s*\{[\s\S]*?white-space: normal;[\s\S]*?overflow-wrap: anywhere;/u,
    "SPA CSS should wrap compact command and path values on mobile",
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

test("project preview state keeps project-level live run evidence visible", () => {
  const source = fs.readFileSync(path.join(workspaceRoot, "apps/web/src/spa.jsx"), "utf8");

  assert.match(
    source,
    /if \(!shouldReadProjectState\) \{[\s\S]*?readJson\(`\/api\/projects\/\$\{encodeURIComponent\(effectiveProjectId\)\}\/runs`\)\.catch\(\(\) => \[\]\)/u,
    "Project preview/profile-mismatch state should still read project-level runs.",
  );
  assert.match(
    source,
    /setRuns\(Array\.isArray\(previewRunList\) \? previewRunList : \[\]\);/u,
    "Project preview/profile-mismatch state should preserve live run evidence for the operator console.",
  );
});

test("active quality gate blockers preserve structured recovery details", () => {
  const source = fs.readFileSync(path.join(workspaceRoot, "apps/web/src/spa.jsx"), "utf8");
  const css = fs.readFileSync(path.join(workspaceRoot, "apps/web/src/spa.css"), "utf8");

  assert.match(source, /normalizeQualityGateBlockerRow/u);
  assert.match(source, /normalizedBlockerField/u);
  assert.match(source, /qualityGateBlockerForActionContext/u);
  assert.match(source, /qualityGateEvidenceRows/u);
  assert.match(source, /qualityGateRecoveryPlan/u);
  assert.match(source, /"next_command"/u);
  assert.match(source, /record\.evidence_refs/u);
  assert.match(source, /gate\?\.evidence_summaries/u);
  assert.match(source, /Quality gate recovery path/u);
  assert.match(source, /Recovery path/u);
  assert.match(source, /Delivery stays blocked/u);
  assert.match(source, /quality-blocker-list/u);
  assert.match(source, /quality-blocker-meta/u);
  assert.match(css, /\.quality-recovery-path\s*\{/u);
  assert.match(css, /\.quality-recovery-path ol\s*\{/u);
  assert.match(css, /\.quality-recovery-path li\.active\s*\{/u);
  assert.doesNotMatch(
    source,
    /qualityGateBlockers\.map\(\(blocker\) => \(\{ code: blocker, summary: blocker \}\)\)/u,
    "Active quality gate blockers should not be collapsed into opaque string-only rows",
  );
  assert.match(css, /\.quality-blocker-list li\s*\{[\s\S]*?display: grid;/u);
  assert.match(css, /\.quality-blocker-meta\s*\{[\s\S]*?flex-wrap: wrap;/u);
  assert.match(css, /\.quality-blocker-meta code,\s*\.quality-blocker-meta em\s*\{[\s\S]*?overflow-wrap: anywhere;/u);
});

test("required verification failures surface as active cockpit blockers", () => {
  const source = fs.readFileSync(path.join(workspaceRoot, "apps/web/src/spa.jsx"), "utf8");
  const css = fs.readFileSync(path.join(workspaceRoot, "apps/web/src/spa.css"), "utf8");

  assert.match(source, /failedRequiredVerificationGroups/u);
  assert.match(source, /verificationFailureBlocker/u);
  assert.match(source, /verificationFailurePrimaryAction/u);
  assert.match(source, /verificationFailureRecoveryPlan/u);
  assert.match(source, /verificationGroupFailureDetail/u);
  assert.match(source, /firstFailedStepResultRef/u);
  assert.match(source, /latestRequiredVerificationFailed/u);
  assert.match(source, /verificationFailureSummary/u);
  assert.match(source, /failed_step_result_refs/u);
  assert.match(source, /Keep the failed verification step-result evidence linked below/u);
  assert.match(source, /evidenceRefLabel/u);
  assert.match(source, /<CompactInlineValue value=\{recoveryPlan\.evidenceRef\} kind="path" \/>/u);
  assert.match(source, /execution-recovery-evidence-ref/u);
  assert.match(source, /postRunVerificationStatus/u);
  assert.match(source, /executionStatusRows\(evidence, externalRunHealth, verificationPlan\)/u);
  assert.match(source, /heldActionIsCompletedRepair/u);
  assert.match(source, /Fix failed required verification, then rerun/u);
  assert.match(source, /Held downstream action/u);
  assert.match(source, /Verification rerun/u);
  assert.match(source, /VerificationFailureBanner/u);
  assert.match(source, /Required verification failed/u);
  assert.match(source, /Review is blocked by failed post-run evidence/u);
  assert.match(source, /Verification failed after completed repair/u);
  assert.match(source, /Failed verification evidence/u);
  assert.match(source, /Post-run verification failed/u);
  assert.match(source, /qualityGateVerificationFailureRecoveryPlan/u);
  assert.match(source, /qualityVerificationFailureActive/u);
  assert.match(source, /Repair failed verification/u);
  assert.match(source, /Required verification must pass before post-repair review/u);
  assert.match(source, /qualityGateSourceDetail/u);
  assert.match(source, /qualityGateAttemptDetail/u);
  assert.match(source, /Required verification must pass before the review rerun/u);
  assert.match(source, /No automatic repair attempts remain; use failed verification evidence before requesting more repair/u);
  assert.match(source, /qualityGateRepairAttemptsExhausted/u);
  assert.match(source, /verificationFailureRepairDecisionCommand/u);
  assert.match(source, /aor review decide --decision request-repair --repair-context-file <repair-context\.json>/u);
  assert.match(source, /Request repair with new evidence/u);
  assert.match(source, /repeated repair context without new evidence must stay blocked/u);
  assert.match(source, /Rerun required verification only after the next repair completes/u);
  assert.match(source, /Provider execution finished, but required verification failed/u);
  assert.match(source, /Repair failed verification before review, QA, delivery, or release/u);
  assert.match(source, /providerEvidenceStripSummary/u);
  assert.match(source, /counts\.missing > 0 \? `\$\{counts\.missing\} missing`/u);
  assert.match(source, /counts\.unreadable > 0 \? `\$\{counts\.unreadable\} unreadable`/u);
  assert.match(source, /providerEvidenceStripSummary\(providerEvidenceRows\)/u);
  assert.match(source, /label\.replace\(\/\\s\+missing\$\/iu, ""\)/u);
  assert.match(source, /run_id: evidence\?\.run_id \?\? externalRunHealth\?\.run_id/u);
  assert.doesNotMatch(source, /run_id: evidence\.run_id/u);
  assert.match(source, /headingRepeatsStatus\(heading, status\)/u);
  assert.match(source, /const showCockpitStatus = !headingRepeatsStatus\(cockpitTitle, cockpitStatus\)/u);
  assert.match(source, /\{showCockpitStatus \? <StatusPill state=\{cockpitStatus\} \/> : null\}/u);
  const recommendedActionRenderIndex = source.indexOf('<div className="recommended-action">');
  const providerHeartbeatRenderIndex = source.indexOf("{providerHeartbeatPanel}");
  assert.ok(recommendedActionRenderIndex >= 0, "Active cockpit should render the recommended action block.");
  assert.ok(providerHeartbeatRenderIndex >= 0, "Active cockpit should render provider heartbeat from a reusable panel.");
  assert.ok(
    recommendedActionRenderIndex < providerHeartbeatRenderIndex,
    "Provider heartbeat telemetry should stay below the primary recommended action.",
  );
  assert.match(source, /Verification failure recovery path/u);
  assert.match(source, /Fix failed verification first/u);
  assert.match(source, /Repair failed verification/u);
  assert.match(source, /AOR is holding the downstream action/u);
  assert.match(source, /Rerun required verification/u);
  assert.match(source, /<VerificationFailureBanner plan=\{verificationPlan\} failures=\{verificationFailures\} heldAction=\{resolverPrimary\} \/>/u);
  assert.match(source, /verificationBlockers = verificationFailures\.map\(\(group, index\) => verificationFailureBlocker\(group, index\)\)/u);
  assert.match(source, /verificationFailures\.length > 0\s*\? \[\.\.\.verificationBlockers, \.\.\.presentedActionBlockers\]/u);
  assert.match(source, /completedRepairActionActive/u);
  assert.match(source, /verificationFailurePrimaryAction\(verificationPlan, verificationFailures, resolverPrimary, qualityGate\)/u);
  assert.match(source, /verificationFailurePrimaryAction\(verificationPlan, verificationFailures, nextAction, gate\)/u);
  assert.match(source, /verificationFailurePrimaryAction\(verificationPlan, verificationFailures, nextPrimary, qualityGate\)/u);
  assert.match(source, /verificationPlan=\{verificationPlan\}/u);
  assert.match(source, /verificationFailures=\{verificationFailures\}/u);
  assert.match(css, /\.verification-hold-banner\s*\{[\s\S]*?grid-template-columns: 32px minmax\(0, 1fr\);/u);
  assert.match(css, /\.verification-recovery-path\s*\{/u);
  assert.match(css, /\.verification-recovery-path ol\s*\{[\s\S]*?grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/u);
  assert.match(css, /\.verification-recovery-path li\.active\s*\{/u);
  assert.match(css, /\.held-action-note\s*\{/u);
  assert.match(css, /\.execution-recovery-evidence-ref\s*\{/u);
  assert.match(css, /\.verification-hold-grid\s*\{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/u);
  assert.match(
    css,
    /@media \(max-width: 860px\) \{[\s\S]*?\.verification-recovery-path ol,[\s\S]*?\.verification-hold-grid,[\s\S]*?grid-template-columns: 1fr;/u,
    "Required verification failure cards should collapse on mobile",
  );
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
