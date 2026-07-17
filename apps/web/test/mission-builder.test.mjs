import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { legacyConsoleRequested, resolveConsoleExperience, retiredConsoleSearch } from "../src/console-experience.js";
import {
  EMPTY_MISSION_TEMPLATE,
  SAFE_MISSION_TEMPLATE,
  completedMissionOperation,
  createdMissionOperation,
  missionFlagsFromDraft,
  validateMissionDraft,
} from "../src/mission-model.js";

const here = path.dirname(fileURLToPath(import.meta.url));

test("retired legacy input normalizes to the single Quiet Cockpit renderer", () => {
  assert.equal(resolveConsoleExperience(), "quiet-cockpit");
  assert.equal(resolveConsoleExperience({ search: "?console=legacy", configDefault: "legacy" }), "quiet-cockpit");
  assert.equal(resolveConsoleExperience({ search: "?console=unknown", configDefault: "quiet-cockpit" }), "quiet-cockpit");
  assert.equal(legacyConsoleRequested("?console=legacy&mode=attention"), true);
  assert.equal(retiredConsoleSearch("?console=legacy&mode=attention"), "?console=quiet-cockpit&mode=attention");
});

test("SPA source has one renderer branch and a bounded legacy migration notice", () => {
  const source = fs.readFileSync(path.join(here, "../src/spa.jsx"), "utf8");
  assert.match(source, /Legacy console retired/u);
  assert.doesNotMatch(source, /Switch to legacy console|Switch to Quiet Cockpit/u);
  assert.doesNotMatch(source, /consoleExperience === "quiet-cockpit"/u);
  assert.doesNotMatch(source, /<StageRail|<MissionForm/u);
});

test("Mission validation separates structural validity from acknowledged incompleteness", () => {
  const invalid = validateMissionDraft(EMPTY_MISSION_TEMPLATE);
  assert.equal(invalid.structurallyValid, false);
  assert.equal(invalid.complete, false);
  assert.match(invalid.fieldErrors.title, /title/u);

  const complete = validateMissionDraft(SAFE_MISSION_TEMPLATE);
  assert.equal(complete.structurallyValid, true);
  assert.equal(complete.complete, true);

  const incomplete = { ...SAFE_MISSION_TEMPLATE, goals: "", acknowledgeIncomplete: true };
  assert.equal(validateMissionDraft(incomplete).complete, false);
  assert.doesNotThrow(() => missionFlagsFromDraft(incomplete));
  assert.throws(() => missionFlagsFromDraft({ ...incomplete, acknowledgeIncomplete: false }), /acknowledgement/u);
});

test("Mission flags preserve bounded scope and ordered local sources", () => {
  const draft = {
    ...SAFE_MISSION_TEMPLATE,
    allowedPaths: "apps/web/**\npackages/orchestrator-core/**",
    forbiddenPaths: "secrets/**",
    sourceRefs: [
      { sourceKind: "local-prd", ref: "docs/product/brief.md" },
      { sourceKind: "local-rfc", ref: "docs/architecture/decision.md" },
    ],
  };
  const flags = missionFlagsFromDraft(draft, { missionId: "guided-mission" });
  assert.deepEqual(flags["source-kind"], ["local-prd", "local-rfc"]);
  assert.deepEqual(flags["source-ref"], ["docs/product/brief.md", "docs/architecture/decision.md"]);
  assert.deepEqual(flags["allowed-path"], ["apps/web/**", "packages/orchestrator-core/**"]);
  assert.deepEqual(flags["forbidden-path"], ["secrets/**"]);
  assert.equal(flags["delivery-mode"], "no-write");

  assert.equal(validateMissionDraft({ ...draft, allowedPaths: "../outside" }).structurallyValid, false);
  assert.equal(validateMissionDraft({ ...draft, kpi: "INVALID KPI" }).structurallyValid, false);
});

test("Mission operation retries only next while retaining durable refs", () => {
  const created = createdMissionOperation({ lifecycle_command: {
    command_output: { mission_id: "guided-mission" },
    artifact_refs: ["artifact-packet:guided-mission"],
    evidence_refs: ["intake-request-body:guided-mission"],
  } });
  assert.equal(created.phase, "next-pending");
  const completed = completedMissionOperation(created, { lifecycle_command: { evidence_refs: ["next-action-report:guided-mission"] } }, { flow_id: "flow-guided" });
  assert.equal(completed.phase, "complete");
  assert.equal(completed.flowId, "flow-guided");
  assert.equal(completed.nextActionRef, "next-action-report:guided-mission");
});

test("Mission builder exposes accessible validation and durable recovery markers", () => {
  const source = fs.readFileSync(path.join(here, "../src/mission-builder.jsx"), "utf8");
  assert.match(source, /aria-label="Guided Mission intake"/u);
  assert.match(source, /aria-invalid/u);
  assert.match(source, /Resume first-flow creation/u);
  assert.match(source, /Retry only next-action resolution/u);
  assert.match(source, /Mission evidence is durable/u);
  assert.doesNotMatch(source, /localStorage|sessionStorage/u);
});
