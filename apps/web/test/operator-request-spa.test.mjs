import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentFilePath = fileURLToPath(import.meta.url);
const webRoot = path.resolve(path.dirname(currentFilePath), "..");

test("operator console SPA exposes flow-first shell, Ask AOR drawer, evidence workbench, and interactions inbox", () => {
  const source = fs.readFileSync(path.join(webRoot, "src/spa.jsx"), "utf8");

  for (const stage of ["readiness", "mission", "discovery", "implement", "review", "delivery", "learning"]) {
    assert.match(source, new RegExp(`id: "${stage}"`, "u"));
  }

  assert.match(source, /Ask AOR/u);
  assert.match(source, /FlowSelector/u);
  assert.match(source, /One Recommended Action/u);
  assert.match(source, /EvidenceGraphPanel/u);
  assert.match(source, /RuntimeTracePanel/u);
  assert.match(source, /targetRefsMissing/u);
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
  assert.match(source, /currentStage = draftSurface \? "mission"/u);
  assert.match(source, /Draft flow has no artifacts yet/u);
  assert.match(source, /New Flow Preview/u);
  assert.match(source, /Completeness Checklist/u);
  assert.match(source, /request-intent-segment/u);
  assert.match(source, /graph-flow-canvas/u);
  assert.match(source, /graph-trace-row/u);
  assert.match(source, /StageSpecificPanel/u);
  assert.match(source, /Review Gate Matrix/u);
  assert.match(source, /Delivery \/ Release Finalization/u);
  assert.match(source, /Learning Closure \/ Start New Flow/u);
  assert.match(source, /graph-context-tabs/u);
  assert.match(source, /selected-node-panel/u);
  assert.match(source, /trace-timeline-strip/u);
  assert.match(source, /Interaction Detail/u);
  assert.match(source, /interactions-layout/u);
  assert.match(source, /READ_ONLY_INSPECTION_INTENTS/u);
  assert.match(source, /No upstream writes/u);
  assert.match(source, /Evidence & Documents/u);
  assert.match(source, /Interactions Inbox/u);
  assert.match(source, /operator-requests/u);
  assert.match(source, /interactions\/answers/u);
  assert.match(source, /Create and run request/u);
  assert.match(source, /Latest run/u);
  assert.match(source, /Attach as request target/u);
});
