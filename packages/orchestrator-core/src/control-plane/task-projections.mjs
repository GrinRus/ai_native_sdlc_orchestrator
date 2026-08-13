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

function flowRunIds(flow) {
  const candidates = [
    flow.closure_state?.source_run_id,
    ...(Array.isArray(flow.evidence_refs) ? flow.evidence_refs : []),
  ];
  return [...new Set(candidates.flatMap((value) => {
    const text = asString(value);
    if (!text) return [];
    if (text.startsWith("run.")) return [text];
    const match = text.match(/^run:\/\/([^/]+)$/u);
    return match ? [match[1]] : [];
  }))];
}

function taskAttentionItems(flow) {
  const blockers = asStringArray(flow.blockers);
  const qualityBlockers = asStringArray(flow.active_quality_gate?.blockers);
  return [...new Set([...blockers, ...qualityBlockers])].map((summary, index) => ({
    item_id: `${flow.flow_id}.attention.${index + 1}`,
    consequence: summary,
    state: "needs-attention",
    evidence_refs: asStringArray(flow.active_quality_gate?.evidence_refs).slice(0, 5),
  }));
}

function taskReviewProjection(flow) {
  const closure = flow.closure_state ?? {};
  const status = asString(closure.review_status) ?? (flow.status === "completed" ? "unknown" : "pending");
  return {
    status,
    verification_status: asString(closure.verification_status) ?? "unknown",
    delivery_status: asString(closure.delivery_status) ?? "unknown",
    changed_paths: asStringArray(flow.changed_paths),
    evidence_refs: asStringArray(flow.evidence_refs),
    read_only: true,
  };
}

function taskCompletionProjection(flow) {
  const closure = flow.closure_state ?? {};
  const reviewStatus = asString(closure.review_status);
  const verificationStatus = asString(closure.verification_status);
  const deliveryStatus = asString(closure.delivery_status);
  const pass = new Set(["pass", "passed", "approved", "complete", "completed", "ready"]);
  const evidenceComplete = flow.status === "completed" && pass.has(reviewStatus) && pass.has(verificationStatus) && pass.has(deliveryStatus);
  return {
    status: flow.status === "completed" ? (evidenceComplete ? "complete" : "blocked") : "incomplete",
    immutable: flow.status === "completed",
    verification_status: verificationStatus ?? "unknown",
    delivery_status: deliveryStatus ?? "unknown",
    evidence_refs: asStringArray(flow.evidence_refs),
    follow_up_eligible: flow.status === "completed",
  };
}

function intentTaskRef(projectId, submissionId) {
  return `evidence://projects/${projectId}/inputs/${submissionId}/submission.json`;
}

function projectIntentTask({ projectId, entry }) {
  const submission = entry?.submission ?? {};
  const normalization = entry?.normalization ?? {};
  const submissionId = asString(submission.submission_id);
  if (!submissionId) return null;
  const status = submission.status === "blocked"
    ? "attention"
    : submission.status === "prepared"
      ? "prepared"
      : "draft";
  const title = asString(normalization.title) ?? asString(submission.request_text) ?? "Untitled task";
  const sourceItems = asStringArray(submission.attachments?.map((attachment) => attachment?.sha256)).map((digest, index) => {
    const attachment = submission.attachments[index] ?? {};
    return {
      schema_version: 1,
      source_id: `${submissionId}.source.${index + 1}`,
      kind: "upload-snapshot",
      ref: null,
      immutable: true,
      stale: false,
      digest,
      preview: {
        kind: "markdown-source",
        filename: asString(attachment.original_name),
        media_type: asString(attachment.media_type),
        byte_length: Number.isInteger(attachment.byte_length) ? attachment.byte_length : null,
      },
    };
  });
  if (submission.request_text) {
    sourceItems.push({
      schema_version: 1,
      source_id: `${submissionId}.source.inline`,
      kind: "inline-text",
      ref: null,
      immutable: true,
      stale: false,
      digest: crypto.createHash("sha256").update(String(submission.request_text), "utf8").digest("hex"),
      preview: { kind: "inline-text", text: String(submission.request_text).slice(0, 500) },
    });
  }
  for (const source of Array.isArray(submission.markdown_sources) ? submission.markdown_sources : []) {
    const sourceId = asString(source.source_id);
    const digest = asString(source.digest);
    const relativePath = asString(source.project_relative_path);
    if (!sourceId || !digest || !relativePath) continue;
    sourceItems.push({
      schema_version: 1,
      source_id: sourceId,
      kind: "repository-markdown",
      ref: null,
      immutable: true,
      stale: source.stale === true,
      digest,
      preview: {
        kind: "markdown-source",
        project_relative_path: relativePath,
        pinned_base_revision: asString(source.pinned_base_revision),
        media_type: asString(source.media_type) ?? "text/markdown",
        byte_length: Number.isInteger(source.byte_length) ? source.byte_length : null,
        sanitized_markdown: asString(source.preview?.sanitized_markdown) ?? "",
      },
    });
  }
  const intentRef = intentTaskRef(projectId, submissionId);
  return {
    task_id: taskId(projectId, `intent.${submissionId}`),
    project_id: projectId,
    display_title: title,
    work_type: asString(normalization.work_type),
    status,
    status_detail: asString(submission.status) ?? "submitted",
    intent_submission_ref: intentRef,
    mission_id: null,
    flow_id: null,
    run_ids: [],
    lineage: {
      intent_submission_ref: intentRef,
      intent_submission_id: submissionId,
      mission_id: null,
      flow_id: null,
    },
    source_items: sourceItems,
    attention_items: status === "attention" ? [{ item_id: `${submissionId}.attention.1`, consequence: "Intent preparation is blocked.", state: "needs-attention", evidence_refs: asStringArray(submission.normalization_refs) }] : [],
    review: { status: status === "prepared" ? "pending" : "not-ready", verification_status: "unknown", delivery_status: "unknown", changed_paths: [], evidence_refs: asStringArray(submission.normalization_refs), read_only: true },
    completion: { status: "incomplete", immutable: false, verification_status: "unknown", delivery_status: "unknown", evidence_refs: asStringArray(submission.normalization_refs), follow_up_eligible: false },
    revision: Number.isInteger(normalization.revision) ? normalization.revision : null,
    lifecycle_path: {
      path_id: "intent",
      owner: "runtime",
      steps: [{ id: "prepare", label: "Prepare", state: status === "prepared" ? "completed" : "current" }],
    },
    current_step: status === "prepared" ? "confirm" : "prepare",
    current_step_label: status === "prepared" ? "Ready for review" : "Draft",
    attention_count: status === "attention" ? 1 : 0,
    blocker_count: status === "attention" ? 1 : 0,
    evidence_refs: asStringArray(submission.normalization_refs),
    primary_action: {
      action_id: status === "prepared" ? "intent.review" : "intent.resume",
      operator_control: status === "prepared" ? "Review prepared task" : "Resume task preparation",
      reason: status === "attention" ? "Resolve the recorded preparation blocker." : "Continue the intent-first task flow.",
      available: true,
    },
    runner_selection: {
      schema_version: 1,
      source: "project-default",
      route_id: asString(normalization.provider?.route_id),
      readiness: status === "attention" ? "blocked" : status === "prepared" ? "ready" : "unknown",
      requested_model: null,
      effective_model: null,
      requested_reasoning_effort: null,
      effective_reasoning_effort: null,
      unavailable_reason: status === "attention" ? "Intent preparation is blocked." : null,
      recovery_action: status === "attention" ? "Revise or retry the intent preparation." : "Review the prepared task before confirmation.",
    },
    updated_at: asString(submission.updated_at) ?? asString(submission.created_at),
    completed_read_only: false,
    read_only: true,
    draft: status !== "prepared",
  };
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
    run_ids: flowRunIds(flow),
    lineage: {
      intent_submission_ref: flow.intake_packet_ref,
      mission_id: flow.mission_id,
      flow_id: flow.flow_id,
    },
    source_items: taskSourceItems(flow),
    attention_items: taskAttentionItems(flow),
    review: taskReviewProjection(flow),
    completion: taskCompletionProjection(flow),
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
  const flowTasks = flows.flows.map((flow) => projectTaskFromFlow({ projectId: flows.project_id, flow }));
  const intentTasks = Array.isArray(options.intentSubmissions)
    ? options.intentSubmissions.map((entry) => projectIntentTask({ projectId: flows.project_id, entry })).filter(Boolean)
    : [];
  const tasks = [...intentTasks, ...flowTasks];
  return {
    project_id: flows.project_id,
    selected_task_id: tasks.find((task) => task.flow_id === flows.selected_flow_id)?.task_id ?? tasks[0]?.task_id ?? null,
    active_task_ids: tasks.filter((task) => ["draft", "prepared", "active", "attention"].includes(task.status)).map((task) => task.task_id),
    prepared_task_ids: tasks.filter((task) => task.status === "prepared").map((task) => task.task_id),
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
