import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import test from "node:test";

import {
  applySliceStateTransition,
  computeStateSyncChanges,
  getSlicePlan,
  loadBacklogModel,
  parseMasterBacklog,
  selectNextSlice,
  summarizeStates,
} from "../slice-cycle-lib.mjs";

function buildSyntheticModel(defs, order) {
  const slices = new Map();
  for (const def of defs) {
    slices.set(def.sliceId, {
      sliceId: def.sliceId,
      title: def.title ?? def.sliceId,
      epic: def.epic ?? "EPIC-X",
      state: def.state,
      hardDependencies: def.hardDependencies ?? [],
      externalBlocker: def.externalBlocker ?? null,
      waveFile: def.waveFile ?? "docs/backlog/wave-0-implementation-slices.md",
      localTasks: [],
      acceptanceCriteria: [],
      doneEvidence: [],
      outOfScope: [],
    });
  }

  const orderIndex = new Map(order.map((sliceId, index) => [sliceId, index]));
  return {
    rootDir: process.cwd(),
    order,
    orderIndex,
    slices,
  };
}

test("parseMasterBacklog extracts slices and states", () => {
  const backlogContent = fs.readFileSync(
    path.join(process.cwd(), "docs/backlog/mvp-implementation-backlog.md"),
    "utf8",
  );
  const parsed = parseMasterBacklog(backlogContent);

  assert.ok(parsed.size > 0, "expected non-empty master backlog map");
  assert.ok([...parsed.values()].every((slice) => typeof slice.state === "string"));
});

test("loadBacklogModel and summarizeStates stay coherent", () => {
  const model = loadBacklogModel(process.cwd());
  const summary = summarizeStates(model);
  assert.equal(summary.total, model.slices.size);
  assert.equal(summary.total, summary.ready + summary.blocked + summary.active + summary.done);
});

test("loadBacklogModel supports multi-digit wave ids", () => {
  const model = loadBacklogModel(process.cwd());
  assert.equal(model.slices.has("W10-S01"), true);
  assert.equal(model.slices.has("W10-S05"), true);
  assert.equal(model.slices.has("W11-S05"), true);
});

test("selectNextSlice prefers earliest ready slice in topological order", () => {
  const model = buildSyntheticModel(
    [
      { sliceId: "W0-S01", state: "ready" },
      { sliceId: "W0-S02", state: "ready", hardDependencies: ["W0-S01"] },
      { sliceId: "W0-S03", state: "blocked", hardDependencies: ["W0-S02"] },
    ],
    ["W0-S01", "W0-S02", "W0-S03"],
  );

  const selection = selectNextSlice(model);
  assert.equal(selection.mode, "ready");
  assert.equal(selection.slice?.sliceId, "W0-S01");
});

test("selectNextSlice returns earliest unfinished unblocker when no ready slices", () => {
  const model = buildSyntheticModel(
    [
      { sliceId: "W0-S01", state: "blocked" },
      { sliceId: "W0-S02", state: "blocked", hardDependencies: ["W0-S01"] },
      { sliceId: "W0-S03", state: "blocked", hardDependencies: ["W0-S02"] },
    ],
    ["W0-S01", "W0-S02", "W0-S03"],
  );

  const selection = selectNextSlice(model);
  assert.equal(selection.mode, "unblocker");
  assert.equal(selection.slice?.sliceId, "W0-S01");
  assert.equal(selection.blockedTarget?.sliceId, "W0-S01");
});

test("computeStateSyncChanges promotes/degrades ready and blocked states from dependency truth", () => {
  const model = buildSyntheticModel(
    [
      { sliceId: "W0-S01", state: "done" },
      { sliceId: "W0-S02", state: "blocked", hardDependencies: ["W0-S01"] },
      { sliceId: "W0-S03", state: "ready", hardDependencies: ["W0-S02"] },
      { sliceId: "W0-S04", state: "active", hardDependencies: ["W0-S03"] },
    ],
    ["W0-S01", "W0-S02", "W0-S03", "W0-S04"],
  );

  const changes = computeStateSyncChanges(model);
  assert.deepEqual(
    changes.map((change) => ({ sliceId: change.sliceId, nextState: change.nextState })),
    [
      { sliceId: "W0-S02", nextState: "ready" },
      { sliceId: "W0-S03", nextState: "blocked" },
    ],
  );
});

test("computeStateSyncChanges preserves blocked slices with explicit external blockers", () => {
  const model = buildSyntheticModel(
    [
      { sliceId: "W15-S03", state: "done" },
      {
        sliceId: "W15-S04",
        state: "blocked",
        hardDependencies: ["W15-S03"],
        externalBlocker: "External runner credentials are unavailable.",
      },
    ],
    ["W15-S03", "W15-S04"],
  );

  assert.deepEqual(computeStateSyncChanges(model), []);
});

test("computeStateSyncChanges degrades ready slices with explicit external blockers", () => {
  const model = buildSyntheticModel(
    [
      { sliceId: "W15-S03", state: "done" },
      {
        sliceId: "W15-S04",
        state: "ready",
        hardDependencies: ["W15-S03"],
        externalBlocker: "External runner credentials are unavailable.",
      },
    ],
    ["W15-S03", "W15-S04"],
  );

  assert.deepEqual(
    computeStateSyncChanges(model).map((change) => ({
      sliceId: change.sliceId,
      currentState: change.currentState,
      nextState: change.nextState,
    })),
    [{ sliceId: "W15-S04", currentState: "ready", nextState: "blocked" }],
  );
});

test("applySliceStateTransition requires force to bypass an explicit external blocker", () => {
  const model = loadBacklogModel(process.cwd());
  assert.throws(
    () => applySliceStateTransition(model, "W15-S04", "done"),
    /Cannot set W15-S04 to done: external blocker remains:/,
  );
});

test("getSlicePlan returns local tasks and acceptance criteria for documented slice", () => {
  const model = loadBacklogModel(process.cwd());

  const candidate = [...model.slices.values()].find(
    (slice) => slice.localTasks.length > 0 && slice.acceptanceCriteria.length > 0,
  );

  assert.ok(candidate, "expected at least one documented slice with plan sections");

  const plan = getSlicePlan(model, candidate.sliceId);
  assert.ok(plan.localTasks.length > 0);
  assert.ok(plan.acceptanceCriteria.length > 0);
  assert.ok(plan.doneEvidence.length > 0);
});
