import crypto from "node:crypto";
import { listFlowProjections } from "./flow-projections.mjs";

function asString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asStringArray(value) {
  return Array.isArray(value)
    ? value.filter((entry) => typeof entry === "string" && entry.trim()).map((entry) => entry.trim())
    : [];
}

function normalizeId(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "") || "task";
}

function taskId(projectId, flowId) {
  return `task.${normalizeId(projectId)}.${normalizeId(flowId)}`;
}

function taskStatus(flow) {
  if (flow.status === "completed") return "completed";
  if (flow.status === "blocked") return "attention";
  return "active";
}

function taskSourceItems(flow) {
  return asStringArray([flow.intake_packet_ref, flow.intake_body_ref]).map((ref, index) => ({
    schema_version: 1,
    source_id: `${flow.flow_id}.source.${index + 1}`,
    kind: "inline-text",
    ref,
    immutable: true,
    stale: false,
    digest: crypto.createHash("sha256").update(ref).digest("hex"),
    preview: { kind: "reference", source_ref: ref },
  }));
}

/**
 * Project the existing runtime-owned Flow into the public Task Workspace read
 * model. This module owns presentation identity only; lifecycle and mutations
 * remain owned by intent, Mission, Flow, and Runtime Harness services.
 */
export function projectTaskFromFlow({ projectId, flow }) {
  const id = taskId(projectId, flow.flow_id);
  const status = taskStatus(flow);
  return {
    task_id: id,
    project_id: projectId,
    display_title: flow.display_title,
    work_type: flow.work_type,
    status,
    status_detail: flow.status,
    intent_submission_ref: flow.intake_packet_ref,
    mission_id: flow.mission_id,
    flow_id: flow.flow_id,
    lineage: {
      intent_submission_ref: flow.intake_packet_ref,
      mission_id: flow.mission_id,
      flow_id: flow.flow_id,
    },
    source_items: taskSourceItems(flow),
    lifecycle_path: flow.lifecycle_path ?? { path_id: null, owner: "runtime", steps: [] },
    current_step: flow.current_step,
    current_step_label: flow.current_step_label,
    attention_count: Number.isInteger(flow.attention_count) ? flow.attention_count : 0,
    blocker_count: Number.isInteger(flow.blocker_count) ? flow.blocker_count : 0,
    evidence_refs: asStringArray(flow.evidence_refs),
    primary_action: flow.primary_action ?? {
      action_id: null,
      operator_control: null,
      reason: null,
      available: false,
    },
    runner_selection: {
      schema_version: 1,
      source: "project-default",
      route_id: null,
      readiness: "unknown",
      requested_model: null,
      effective_model: null,
      requested_reasoning_effort: null,
      effective_reasoning_effort: null,
      unavailable_reason: null,
      recovery_action: "Open execution settings to inspect approved routes.",
    },
    updated_at: flow.updated_at ?? null,
    completed_read_only: status === "completed",
    read_only: true,
  };
}

export function listTaskProjections(options = {}) {
  const flows = listFlowProjections(options);
  const tasks = flows.flows.map((flow) => projectTaskFromFlow({ projectId: flows.project_id, flow }));
  return {
    project_id: flows.project_id,
    selected_task_id: tasks.find((task) => task.flow_id === flows.selected_flow_id)?.task_id ?? tasks[0]?.task_id ?? null,
    active_task_ids: tasks.filter((task) => ["active", "attention"].includes(task.status)).map((task) => task.task_id),
    completed_task_ids: tasks.filter((task) => task.status === "completed").map((task) => task.task_id),
    tasks,
    generated_from: {
      read_model: "control-plane.task-projections",
      owner: "runtime.flow-projections",
    },
    read_only: true,
  };
}

export function readTaskProjection(options = {}) {
  const taskIdValue = asString(options.taskId);
  if (!taskIdValue) return null;
  return listTaskProjections(options).tasks.find((task) => task.task_id === taskIdValue) ?? null;
}
