import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentFilePath = fileURLToPath(import.meta.url);
const webRoot = path.resolve(path.dirname(currentFilePath), "..");

test("packaging-only marker smoke exposes flow-first shell, Ask AOR drawer, evidence workbench, and interactions inbox", () => {
  const source = fs.readFileSync(path.join(webRoot, "src/spa.jsx"), "utf8");
  const css = fs.readFileSync(path.join(webRoot, "src/spa.css"), "utf8");
  const stageSubtitleRule = css.match(/\.stage-copy em\s*\{[\s\S]*?\}/u)?.[0] ?? "";

  for (const stage of ["readiness", "mission", "discovery", "implement", "review", "delivery", "learning"]) {
    assert.match(source, new RegExp(`id: "${stage}"`, "u"));
  }

  assert.match(source, /Ask AOR/u);
  assert.match(source, /Ask AOR for selected flow/u);
  assert.match(source, /Ask AOR requires a selected active flow/u);
  assert.match(source, /FlowSelector/u);
  assert.match(source, /One Recommended Action/u);
  assert.match(source, /EvidenceGraphPanel/u);
  assert.match(source, /RuntimeTracePanel/u);
  assert.match(source, /EvidenceReadinessPath/u);
  assert.match(source, /Refresh the selected flow after a lifecycle command/u);
  assert.match(source, /Refresh run status or open Execution Evidence/u);
  assert.match(source, /targetRefsMissing/u);
  assert.match(source, /requestReadinessItems/u);
  assert.match(source, /Ask AOR request readiness/u);
  assert.match(source, /Complete required fields first/u);
  assert.match(source, /Ready to create request evidence/u);
  assert.match(source, /draftFollowUpHandoffRef/u);
  assert.match(source, /follow-up-source-handoff-ref/u);
  assert.match(source, /Create follow-up from learning handoff/u);
  assert.match(source, /completed_read_only/u);
  assert.match(source, /target_flow_id/u);
  assert.match(source, /targetFlowId/u);
  assert.match(source, /requestStageId/u);
  assert.match(source, /sameFlow/u);
  assert.match(source, /sameStage/u);
  assert.match(source, /comparableEvidenceRef/u);
  assert.match(source, /evidenceRefsMatch/u);
  assert.match(source, /latestRequestForFlow/u);
  assert.match(source, /flowScopedInteractions/u);
  assert.match(source, /actionCommandLabel/u);
  assert.match(source, /topbar-ask-button/u);
  assert.match(source, /draft: newFlowDraft/u);
  assert.match(source, /draftSurface/u);
  assert.match(source, /currentStage = draftSurface\s*\?\s*"mission"/u);
  assert.match(source, /Draft flow has no artifacts yet/u);
  assert.match(source, /New Flow Preview/u);
  assert.match(source, /Completeness Checklist/u);
  assert.match(source, /flowSelectionVersion/u);
  assert.match(source, /selectionApplied/u);
  assert.match(source, /refresh\(\{ newFlowDraft: false, selectedFlowId: fallbackFlowId, selectionVersion: cancelSelectionVersion \}\)/u);
  assert.match(source, /request-intent-segment/u);
  assert.match(source, /request-scope-card/u);
  assert.match(source, /graph-flow-canvas/u);
  assert.match(source, /StageSpecificPanel/u);
  assert.match(source, /artifact-readiness-grid/u);
  assert.match(source, /artifact_readiness/u);
  assert.match(source, /Review Gate Matrix/u);
  assert.match(source, /Delivery \/ Release Finalization/u);
  assert.match(source, /Learning Closure \/ Start New Flow/u);
  assert.match(source, /graph-context-tabs/u);
  assert.match(source, /selected-node-panel/u);
  assert.match(source, /trace-timeline-strip/u);
  assert.match(source, /Initialize Project Runtime/u);
  assert.match(source, /Configure First Flow/u);
  assert.match(source, /First-run wizard/u);
  assert.match(source, /firstRunFocusMode/u);
  assert.match(source, /AdvancedEvidenceDisclosure/u);
  assert.match(source, /Advanced evidence/u);
  assert.match(source, /FlowAdvancedWorkbench/u);
  assert.match(source, /Advanced evidence workbench/u);
  assert.match(source, /advanced-workbench-tabs/u);
  assert.match(source, /support-table-grid/u);
  assert.match(source, /shortPathLabel/u);
  assert.match(source, /compactVisibleValue/u);
  assert.match(source, /Show runtime root path details/u);
  assert.match(source, /Copy runtime root path/u);
  assert.match(source, /conciseArtifactLabel/u);
  assert.match(source, /artifactActionLabel/u);
  assert.match(source, /Open evidence artifact/u);
  assert.match(source, /Copy raw ref for/u);
  assert.match(source, /Attach as request target:/u);
  assert.match(source, /CompactInlineValue/u);
  assert.match(source, /CompactDetailValue/u);
  assert.match(source, /topbar-status-strip/u);
  assert.match(source, /first-run-next-action-grid/u);
  assert.match(source, /stage-progress-strip/u);
  assert.match(source, /compact-first-run/u);
  assert.match(source, /safe-template-summary/u);
  assert.match(source, /Edit mission details/u);
  assert.match(source, /active-flow-handoff/u);
  assert.match(source, /Project Context/u);
  assert.match(source, /Runtime Readiness/u);
  assert.match(source, /Project switcher/u);
  assert.match(source, /activeProjectDisplay/u);
  assert.match(source, /projectOptionsForSwitcher/u);
  assert.match(source, /statePreviewRoute/u);
  assert.match(source, /projectsWithLiveState/u);
  assert.match(source, /projectWithObservedRuntime/u);
  assert.match(source, /activeRuntimeReady/u);
  assert.match(source, /activeProjectStatusRuntimeReady/u);
  assert.match(source, /externalRunSignalState/u);
  assert.match(source, /deterministicRunEvidenceStatus/u);
  assert.match(source, /signal-state/u);
  assert.match(source, /Add another AOR project/u);
  assert.match(source, /Runtime root preview/u);
  assert.match(source, /Project profile/u);
  assert.match(source, /project_profile/u);
  assert.match(source, /Add and initialize/u);
  assert.match(source, /No active flow/u);
  assert.match(source, /Readiness prepares the runtime before a flow is created/u);
  assert.match(source, /selectedStageRuntimeState/u);
  assert.match(source, /Upcoming stage\. The current recommended action remains scoped/u);
  assert.match(source, /Recommended action context/u);
  assert.match(source, /Command provenance/u);
  assert.match(source, /Flow inventory/u);
  assert.match(source, /stage-status-badge/u);
  assert.match(source, /Interaction Detail/u);
  assert.match(source, /interactionRecoveryPlan/u);
  assert.match(source, /Interaction answer recovery path/u);
  assert.match(source, /Resolve runtime question first/u);
  assert.match(source, /Submit Answer writes an audit ref/u);
  assert.match(source, /interactions-layout/u);
  assert.match(source, /Submit runtime interaction answer/u);
  assert.match(source, /htmlFor=\{decisionFieldId\}/u);
  assert.match(source, /htmlFor=\{answerFieldId\}/u);
  assert.match(source, /READ_ONLY_INSPECTION_INTENTS/u);
  assert.match(source, /No upstream writes/u);
  assert.match(source, /Create Flow & Resolve Next Action/u);
  assert.match(source, /Available after completed flow/u);
  assert.match(source, /Requires selected active flow/u);
  assert.match(source, /Evidence & Documents/u);
  assert.match(source, /qualityClosurePlan/u);
  assert.match(source, /Quality closure path/u);
  assert.match(source, /Run-health is factual status/u);
  assert.match(source, /Verification plan/u);
  assert.match(source, /verification_plan/u);
  assert.match(source, /group\.outcome/u);
  assert.match(source, /Interactions Inbox/u);
  assert.match(source, /Operator Decision/u);
  assert.match(source, /operatorDecisionRequestsForFlow/u);
  assert.match(source, /isOperatorDecisionRequestRef/u);
  assert.match(source, /normalizeOperatorDecisionStatus/u);
  assert.match(source, /isOpenOperatorDecisionStatus/u);
  assert.match(source, /supportedDecisionActionsFromRecord/u);
  assert.match(source, /isOperatorDecisionRequestRow/u);
  assert.match(source, /No pending agent decision request for this flow\./u);
  assert.match(source, /agent_decision_request_ref/u);
  assert.doesNotMatch(source, new RegExp(["manual", "live", "e2e"].join("-"), "u"));
  assert.match(source, /Execution Evidence/u);
  assert.match(source, /executionEvidenceForFlow/u);
  assert.match(source, /execution_evidence/u);
  assert.match(source, /Provider execution/u);
  assert.match(source, /Interruption owner/u);
  assert.match(source, /Interruption status/u);
  assert.match(source, /Real code change/u);
  assert.match(source, /runner-owned-leak/u);
  assert.match(source, /scratch-unrelated/u);
  assert.match(source, /Stop provider/u);
  assert.match(source, /Save partial evidence/u);
  assert.match(source, /Diagnose current step/u);
  assert.match(source, /Retry public step/u);
  assert.match(source, /aor run cancel/u);
  assert.match(source, /operator-requests/u);
  assert.match(source, /interactions\/answers/u);
  assert.match(source, /Create and run request/u);
  assert.match(source, /requestDrawerOpenerRef/u);
  assert.match(source, /pendingRequestDrawerFocusRestore/u);
  assert.match(source, /restoreRequestDrawerFocus/u);
  assert.match(source, /clearResult: false/u);
  assert.match(source, /syncExpandedToViewport/u);
  assert.match(source, /Latest run/u);
  assert.match(source, /Attach as request target/u);
  assert.match(css, /button:focus-visible/u);
  assert.match(css, /--control-height: 40px/u);
  assert.match(css, /--touch-control-height: 44px/u);
  assert.match(css, /\.flow-active-mode \.stage-rail \.stage-progress-strip/u);
  assert.match(stageSubtitleRule, /white-space: normal/u);
  assert.doesNotMatch(stageSubtitleRule, /text-overflow:\s*ellipsis/u);
  assert.match(css, /\.advanced-workbench-disclosure/u);
  assert.match(css, /\.advanced-workbench-tabs/u);
  assert.match(css, /\.request-readiness-path\s*\{/u);
  assert.match(css, /\.request-readiness-path ol\s*\{[\s\S]*?grid-template-columns: repeat\(5, minmax\(0, 1fr\)\);/u);
  assert.match(css, /\.request-readiness-path li\.ready\s*\{/u);
  assert.match(css, /\.interaction-recovery-path\s*\{/u);
  assert.match(css, /\.interaction-recovery-path ol\s*\{[\s\S]*?grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/u);
  assert.match(css, /\.evidence-readiness-path\s*\{/u);
  assert.match(css, /\.evidence-readiness-path ol\s*\{[\s\S]*?grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/u);
  assert.match(css, /\.quality-closure-path\s*\{/u);
  assert.match(css, /\.quality-closure-path ol\s*\{[\s\S]*?grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/u);
  assert.match(css, /\.interaction-row label\s*\{/u);
  assert.match(css, /\.compact-inline-value/u);
  assert.match(css, /\.compact-detail-value/u);
  assert.match(css, /\.flow-active-mode \.recommended-action \.cockpit-actions/u);
  assert.match(css, /\.flow-active-mode \.recommended-action \.cockpit-actions \.primary\s*\{[\s\S]*?grid-column: 1 \/ -1;/u);
  assert.match(css, /\.first-run-wizard \.readiness-action\s*\{[\s\S]*?order: 1;/u);
  assert.match(css, /\.verification-plan-card/u);
  assert.match(
    css,
    /@media \(max-width: 860px\) \{[\s\S]*?\.interaction-recovery-path ol,[\s\S]*?\.interaction-row,[\s\S]*?grid-template-columns: 1fr;/u,
    "Runtime interaction answer path should collapse on mobile",
  );
  assert.match(
    css,
    /@media \(max-width: 860px\) \{[\s\S]*?\.evidence-readiness-path ol,[\s\S]*?grid-template-columns: 1fr;/u,
    "Graph and trace readiness path should collapse on mobile",
  );
  assert.match(
    css,
    /@media \(max-width: 860px\) \{[\s\S]*?\.quality-closure-path ol,[\s\S]*?grid-template-columns: 1fr;/u,
    "Quality closure path should collapse on mobile",
  );
  assert.match(
    css,
    /@media \(max-width: 860px\) \{[\s\S]*?\.request-readiness-path ol,[\s\S]*?grid-template-columns: 1fr;/u,
    "Ask AOR request readiness should collapse on mobile",
  );
  assert.match(css, /\.decision-action-grid button:focus-visible/u);
  assert.match(css, /\.execution-action-grid button:focus-visible/u);
  assert.match(css, /\.flow-active-mode \.advanced-workbench-row\s*\{[\s\S]*?grid-row: 3;/u);
});
