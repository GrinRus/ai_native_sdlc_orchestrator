import assert from "node:assert/strict";
import test from "node:test";

import { projectTaskFromFlow } from "../src/control-plane/task-projections.mjs";

const baseFlow = {
  flow_id: "flow.project-alpha.mission-1",
  display_title: "Ship a safe change",
  work_type: "change",
  status: "active",
  mission_id: "mission-1",
  intake_packet_ref: "evidence://projects/project-alpha/packets/intent.json",
  intake_body_ref: "evidence://projects/project-alpha/packets/intent.body.json",
  lifecycle_path: { path_id: "change", owner: "runtime", steps: [{ id: "discovery", state: "current" }] },
  current_step: "discovery",
  current_step_label: "Discover",
  attention_count: 2,
  blocker_count: 1,
  evidence_refs: ["evidence://projects/project-alpha/packets/intent.json"],
  primary_action: { action_id: "discovery-run", operator_control: "Run discovery", reason: "Ready", available: true },
  updated_at: "2026-08-13T10:00:00.000Z",
};

test("Task projection has stable lineage identity and delegates lifecycle to Flow", () => {
  const task = projectTaskFromFlow({ projectId: "project-alpha", flow: baseFlow });
  assert.equal(task.task_id, "task.project-alpha.flow.project-alpha.mission-1");
  assert.equal(task.status, "active");
  assert.deepEqual(task.lineage, {
    intent_submission_ref: baseFlow.intake_packet_ref,
    mission_id: "mission-1",
    flow_id: baseFlow.flow_id,
  });
  assert.equal(task.lifecycle_path.owner, "runtime");
  assert.equal(task.primary_action.operator_control, "Run discovery");
  assert.equal(task.read_only, true);
});

test("completed Flow projects to immutable completed Task without inventing a next action", () => {
  const task = projectTaskFromFlow({ projectId: "project-alpha", flow: {
    ...baseFlow,
    status: "completed",
    primary_action: { action_id: "closure-complete", operator_control: null, reason: "Closed", available: false },
  } });
  assert.equal(task.status, "completed");
  assert.equal(task.completed_read_only, true);
  assert.equal(task.primary_action.available, false);
});
