import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  completeChildRun,
  controlParentRun,
  retryParentUnit,
  scheduleParentRun,
  startParentRun,
  readParentRun,
} from "../src/parent-run-scheduler.mjs";
import { listRuns } from "../src/control-plane/read-surface.mjs";
import { runLifecycleCommand } from "../src/control-plane/lifecycle-command.mjs";
import { getCommandDefinition } from "../src/operator-cli/command-catalog.mjs";
import { validateRuntimeHarnessParentRelation } from "../../contracts/src/runtime-harness-validation.mjs";

const executionPlan = {
  execution_plan_id: "execution-plan-scheduler",
  project_id: "aor-core",
  dag_digest: "sha256:scheduler",
  impacted_scope: { repo_ids: ["main"] },
  status: "ready",
  approval: { invalidated: false },
  integration_gates: [{ gate_id: "integration" }],
  execution_units: [
    { unit_id: "unit-a", task_refs: ["task-a"], depends_on: [], conflict_keys: ["shared"] },
    { unit_id: "unit-b", task_refs: ["task-b"], depends_on: [], conflict_keys: ["shared"] },
    { unit_id: "unit-c", task_refs: ["task-c"], depends_on: ["unit-a"], conflict_keys: [] },
  ],
};

function workspaceSet(parentRunId, projectId = "aor-core") {
  return {
    workspace_set_id: `workspace-set-${parentRunId}`,
    project_id: projectId,
    run_id: parentRunId,
    status: "ready",
    conflicts: [],
    repositories: [{ repo_id: "main" }],
  };
}

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aor-parent-run-"));
  fs.mkdirSync(path.join(root, ".git"));
  fs.cpSync(path.resolve("examples"), path.join(root, "examples"), { recursive: true });
  return root;
}

test("parent scheduler starts only dependency-ready conflict-free units and requires integration closure", () => {
  const projectRef = project();
  const started = startParentRun({
    projectRef,
    cwd: projectRef,
    parentRunId: "parent-run-1",
    executionPlan,
    executionPlanRef: "evidence://execution-plan.json",
    workspaceSet: workspaceSet("parent-run-1"),
    workspaceSetRef: "evidence://workspace-set.json",
    maxConcurrency: 3,
  });
  const duplicate = startParentRun({
    projectRef,
    cwd: projectRef,
    parentRunId: "parent-run-1",
    executionPlan,
    executionPlanRef: "evidence://execution-plan.json",
    workspaceSet: workspaceSet("parent-run-1"),
    workspaceSetRef: "evidence://workspace-set.json",
    maxConcurrency: 3,
  });
  assert.equal(duplicate.idempotent, true);
  assert.throws(() => startParentRun({
    projectRef,
    cwd: projectRef,
    parentRunId: "parent-run-1",
    executionPlan,
    executionPlanRef: "evidence://execution-plan.json",
    workspaceSet: workspaceSet("parent-run-1"),
    workspaceSetRef: "evidence://workspace-set.json",
    maxConcurrency: 2,
  }), /different request/u);
  const first = scheduleParentRun({ parentFile: started.file });
  assert.equal(first.started.length, 1);
  assert.equal(first.started[0].execution_unit_id, "unit-a");
  const projections = listRuns({ cwd: projectRef, projectRef });
  assert.equal(projections.find((run) => run.run_id === "parent-run-1")?.parent_run?.status, "running");
  assert.equal(
    projections.find((run) => run.run_id === first.started[0].child_run_id)?.parent_relation?.execution_unit_id,
    "unit-a",
  );
  const afterA = completeChildRun({
    parentFile: started.file,
    executionUnitId: "unit-a",
    childRunId: first.started[0].child_run_id,
    status: "succeeded",
  });
  const second = scheduleParentRun({ parentFile: started.file, expectedRevision: afterA.revision });
  assert.deepEqual(second.started.map((entry) => entry.execution_unit_id), ["unit-b", "unit-c"]);
  const afterB = completeChildRun({ parentFile: started.file, executionUnitId: "unit-b", childRunId: second.started[0].child_run_id, status: "succeeded" });
  const afterC = completeChildRun({ parentFile: started.file, expectedRevision: afterB.revision, executionUnitId: "unit-c", childRunId: second.started[1].child_run_id, status: "succeeded" });
  assert.equal(afterC.status, "integration-pending");
});

test("parent read is non-materializing for an uninitialized project", () => {
  const projectRef = project();
  fs.rmSync(path.join(projectRef, ".aor"), { recursive: true, force: true });
  const result = readParentRun({ cwd: projectRef, projectRef, parentRunId: "parent-run-missing" });
  assert.equal(result.parent, null);
  assert.equal(fs.existsSync(path.join(projectRef, ".aor")), false);
});

test("CLI and lifecycle catalog expose typed parent start and retry controls", () => {
  const start = getCommandDefinition("run start");
  const retry = getCommandDefinition("run retry");
  assert.ok(start.flags.some((flag) => flag.name === "workspace-set-ref"));
  assert.ok(start.flags.some((flag) => flag.name === "max-concurrency" && flag.type === "integer"));
  assert.deepEqual(retry.requiredFlags, [
    "project-ref",
    "parent-run-id",
    "execution-unit-id",
    "command-id",
    "expected-revision",
  ]);
  const lifecycle = runLifecycleCommand({ projectRef: ".", command: "run retry", flags: {} });
  assert.equal(lifecycle.ok, false);
  assert.equal(lifecycle.error.code, "invalid_lifecycle_flags");
  const parentStart = runLifecycleCommand({
    projectRef: ".",
    command: "run start",
    flags: {
      execution_plan_ref: "evidence://plan.json",
      workspace_set_ref: "evidence://workspace-set.json",
    },
  });
  assert.equal(parentStart.ok, false);
  assert.match(parentStart.error.detail, /requires '--run-id'/u);
});

test("Runtime Harness parent relation validation fails closed on unstable attempt lineage", () => {
  const issues = validateRuntimeHarnessParentRelation({
    parent_relation: {
      parent_run_id: "parent-run-1",
      execution_unit_id: "unit-a",
      task_refs: ["task-a"],
      attempt: 0,
    },
  }, "fixture://runtime-harness");
  assert.equal(issues.length, 1);
  assert.equal(issues[0].field, "parent_relation.attempt");
});

test("parent commands are revisioned and retry preserves unit identity while adding attempts", () => {
  const projectRef = project();
  const started = startParentRun({
    projectRef,
    cwd: projectRef,
    parentRunId: "parent-run-2",
    executionPlan: { ...executionPlan, execution_units: [executionPlan.execution_units[0]], integration_gates: [] },
    executionPlanRef: "evidence://execution-plan.json",
    workspaceSet: workspaceSet("parent-run-2"),
    workspaceSetRef: "evidence://workspace-set.json",
  });
  const scheduled = scheduleParentRun({ parentFile: started.file });
  const failed = completeChildRun({
    parentFile: started.file,
    executionUnitId: "unit-a",
    childRunId: scheduled.started[0].child_run_id,
    status: "failed",
  });
  const retried = retryParentUnit({ parentFile: started.file, executionUnitId: "unit-a", commandId: "retry-1", expectedRevision: failed.revision });
  const duplicate = retryParentUnit({ parentFile: started.file, executionUnitId: "unit-a", commandId: "retry-1", expectedRevision: retried.revision });
  assert.equal(duplicate.units[0].status, "pending");
  assert.equal(duplicate.revision, retried.revision);
  const next = scheduleParentRun({ parentFile: started.file, expectedRevision: duplicate.revision });
  assert.equal(next.started[0].attempt, 2);
  assert.throws(() => controlParentRun({ parentFile: started.file, action: "pause", commandId: "pause-1", expectedRevision: 0 }), /revision conflict/u);
});

test("parent cancel propagates only to active children and budget exhaustion blocks new starts", () => {
  const projectRef = project();
  const started = startParentRun({
    projectRef,
    cwd: projectRef,
    parentRunId: "parent-run-3",
    executionPlan: { ...executionPlan, execution_units: executionPlan.execution_units.slice(0, 2), integration_gates: [] },
    executionPlanRef: "evidence://execution-plan.json",
    workspaceSet: workspaceSet("parent-run-3"),
    workspaceSetRef: "evidence://workspace-set.json",
    budgets: { max_child_starts: 1 },
  });
  const scheduled = scheduleParentRun({ parentFile: started.file });
  const controlled = [];
  const canceled = controlParentRun({
    parentFile: started.file,
    expectedRevision: scheduled.parent.revision,
    action: "cancel",
    commandId: "cancel-1",
    controlChild: (command) => controlled.push(command),
  });
  assert.equal(canceled.status, "canceling");
  assert.equal(controlled.length, 1);

  const capacityRun = startParentRun({
    projectRef,
    cwd: projectRef,
    parentRunId: "parent-run-4",
    executionPlan: {
      ...executionPlan,
      execution_units: [
        { unit_id: "unit-x", task_refs: ["task-x"], depends_on: [], conflict_keys: [] },
        { unit_id: "unit-y", task_refs: ["task-y"], depends_on: [], conflict_keys: [] },
      ],
      integration_gates: [],
    },
    executionPlanRef: "evidence://execution-plan.json",
    workspaceSet: workspaceSet("parent-run-4"),
    workspaceSetRef: "evidence://workspace-set.json",
    maxConcurrency: 3,
    capacity: { provider_slots: 1, tool_slots: 2 },
  });
  assert.equal(scheduleParentRun({ parentFile: capacityRun.file }).started.length, 1);
});
