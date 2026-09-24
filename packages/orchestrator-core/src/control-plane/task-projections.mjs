import crypto from "node:crypto";
import { listFlowProjections } from "./flow-projections.mjs";
import { readExecutionProfile } from "./execution-profile.mjs";
import { getTaskActionDefinition } from "./task-action-catalog.mjs";

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

function publicAction(action, status) {
  const actionId = asString(action?.action_id);
  const definition = actionId ? getTaskActionDefinition(actionId) : null;
  const operatorControl = action?.operator_control && typeof action.operator_control === "object" && !Array.isArray(action.operator_control)
    ? { ...action.operator_control }
    : asString(action?.operator_control);
  return {
    action_id: actionId,
    operator_control: operatorControl,
    reason: asString(action?.reason),
    available: status !== "completed" && action?.available !== false && Boolean(actionId),
    permission: definition?.permission ?? "read",
    category: definition?.category ?? "unavailable",
    requires_confirmation: definition?.requires_confirmation === true,
    payload: definition?.payload ?? {},
  };
}

const WORK_TYPE_TO_STEP = Object.freeze({
  analyze: "discovery",
  explain: "research",
  review: "review",
  "document-change": "implement",
  "code-change": "implement",
});

function approvedExecutionSelection({ executionProfile, workType, step, override = null, selectionRevision = 0 }) {
  const overrideRouteId = asString(override?.route_id);
  const selectedStep = asString(override?.step) ?? step ?? WORK_TYPE_TO_STEP[workType] ?? null;
  const row = Array.isArray(executionProfile?.routes)
    ? executionProfile.routes.find((candidate) => candidate?.step === selectedStep)
    : null;
  const overrideOption = overrideRouteId ? row?.approved_routes?.find((candidate) => candidate?.route_id === overrideRouteId) : null;
  const selected = overrideRouteId ? overrideOption : row;
  const routeId = overrideRouteId ?? asString(row?.route_id);
  const approved = routeId && !/^route\.intake-normalize\./u.test(routeId) ? routeId : null;
  const readinessStates = new Set(["ready", "stale", "unavailable", "blocked", "unconfigured", "runner-missing", "auth-missing", "model-unsupported", "capability-mismatch", "policy-denied"]);
  const readinessRevision = Number.isInteger(selected?.readiness_revision) ? selected.readiness_revision : null;
  const readinessCurrent = Number.isInteger(executionProfile?.revision) && readinessRevision === executionProfile.revision;
  const readiness = overrideRouteId && !overrideOption
    ? "policy-denied"
    : selected?.readiness === "ready" && !readinessCurrent
      ? "stale"
      : readinessStates.has(selected?.readiness) ? selected.readiness : "unknown";
  return {
    schema_version: 1,
    source: overrideRouteId ? "task-override" : "project-default",
    selection_revision: Number.isInteger(selectionRevision) ? selectionRevision : 0,
    route_id: approved,
    step: selectedStep,
    readiness,
    requested_model: asString(selected?.requested_model),
    effective_model: asString(selected?.effective_model),
    requested_reasoning_effort: asString(selected?.requested_reasoning_effort),
    effective_reasoning_effort: asString(selected?.effective_reasoning_effort),
    unavailable_reason: overrideRouteId && !overrideOption
      ? "The task override is no longer an approved route for this step."
      : approved ? (readiness === "ready" ? null : `Execution route readiness is ${readiness}.`) : "No approved execution route is selected for this Task.",
    recovery_action: overrideRouteId && !overrideOption
      ? "Reset to the project default or select another approved route."
      : approved ? "Check this exact execution route before starting this Task." : "Select an approved project execution route before starting this Task.",
    readiness_revision: readinessRevision,
  };
}

function preparedContract({ normalization, executionProfile, workType, scope, deliveryMode, status, step, override = null, selectionRevision = 0 }) {
  const selection = approvedExecutionSelection({ executionProfile, workType, step, override, selectionRevision });
  const mode = deliveryMode ?? asString(normalization?.delivery_mode) ?? "no-write";
  const writeCapable = mode !== "no-write";
  return {
    schema_version: 1,
    outcome: asString(normalization?.outcome),
    acceptance_criteria: asStringArray(normalization?.acceptance),
    scope: {
      allowed_paths: asStringArray(scope),
      forbidden_paths: [],
    },
    delivery_mode: mode,
    normalization_revision: Number.isInteger(normalization?.revision) ? normalization.revision : 0,
    approved_execution_route: selection,
    readiness_revision: selection.readiness_revision,
    write_effects: {
      mode,
      write_capable: writeCapable,
      target_write_allowed: writeCapable,
      upstream_writes_allowed: false,
      direct_edits_allowed: writeCapable,
    },
    state: status,
  };
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

function intentAttentionItem(submission, submissionId) {
  const blocker = submission?.blocker && typeof submission.blocker === "object" && !Array.isArray(submission.blocker)
    ? submission.blocker
    : {};
  const message = asString(blocker.message) ?? "Intent preparation is blocked.";
  const code = asString(blocker.code);
  return {
    item_id: `${submissionId}.attention.1`,
    consequence: message,
    ...(code ? { code } : {}),
    message,
    recovery_action: asString(blocker.recovery_action) ?? "Configure an approved runner and retry preparation.",
    state: "needs-attention",
    evidence_refs: asStringArray(submission.normalization_refs),
  };
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
  const deliveryManifestRef = asString(closure.delivery_manifest_ref);
  const patchRef = asString(closure.patch_ref);
  const digest = asString(closure.digest);
  const pass = new Set(["pass", "passed", "approved", "complete", "completed", "ready"]);
  const evidenceComplete = flow.status === "completed" && pass.has(reviewStatus) && pass.has(verificationStatus) && pass.has(deliveryStatus);
  return {
    status: flow.status === "completed" ? (evidenceComplete ? "complete" : "blocked") : "incomplete",
    immutable: flow.status === "completed",
    verification_status: verificationStatus ?? "unknown",
    delivery_status: deliveryStatus ?? "unknown",
    patch_ref: patchRef,
    digest,
    delivery_manifest_ref: deliveryManifestRef,
    evidence_refs: asStringArray(flow.evidence_refs),
    follow_up_eligible: flow.status === "completed",
  };
}

function intentTaskRef(projectId, submissionId) {
  return `evidence://projects/${projectId}/inputs/${submissionId}/submission.json`;
}

function projectIntentTask({ projectId, entry, executionProfile }) {
  const submission = entry?.submission ?? {};
  const normalization = entry?.normalization ?? {};
  // Once confirmation has materialized a Flow, the Flow-backed projection is
  // the canonical Task identity. Do not expose a second draft Task for the
  // same intent lineage after reload.
  if (submission.confirmation?.flow_id) return null;
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
  const selection = approvedExecutionSelection({ executionProfile, workType: asString(normalization.work_type), override: submission.execution_route_override, selectionRevision: submission.runner_selection_revision });
  const prepared = preparedContract({ normalization, executionProfile, workType: asString(normalization.work_type), scope: normalization.scope, deliveryMode: asString(normalization.delivery_mode), status, override: submission.execution_route_override, selectionRevision: submission.runner_selection_revision });
  const staleMarkdownSources = (Array.isArray(submission.markdown_sources) ? submission.markdown_sources : []).filter((source) => source?.stale === true);
  const sourceReadinessReason = staleMarkdownSources.length
    ? `Repository Markdown source changed after preparation: ${staleMarkdownSources.map((source) => source.project_relative_path).join(", ")}. Edit the Task and add the current file before starting.`
    : null;
  const startAvailable = status === "prepared"
    && staleMarkdownSources.length === 0
    && Boolean(selection.route_id)
    && selection.readiness === "ready"
    && Number.isInteger(executionProfile?.revision)
    && selection.readiness_revision === executionProfile.revision;
  const attentionItem = status === "attention" ? intentAttentionItem(submission, submissionId) : null;
  return {
    schema_version: 1,
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
      normalization_revision: Number.isInteger(normalization.revision) ? normalization.revision : null,
      mission_id: null,
      flow_id: null,
      run_ids: [],
    },
    source_items: sourceItems,
    attention_items: attentionItem ? [attentionItem] : [],
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
    primary_action: publicAction({
      action_id: status === "prepared" ? "start" : "intent.resume",
      operator_control: status === "prepared" ? "Start task" : "Resume task preparation",
      reason: status === "prepared"
        ? (startAvailable ? "Prepared task is ready for revision-checked start." : sourceReadinessReason ?? selection.unavailable_reason)
        : status === "attention" ? attentionItem.message : "Continue the intent-first task flow.",
      available: status === "prepared" ? startAvailable : true,
    }, status),
    runner_selection: {
      ...selection,
      readiness: status === "attention" ? "blocked" : selection.readiness,
      unavailable_reason: status === "attention" ? attentionItem.message : selection.unavailable_reason,
      recovery_action: status === "attention" ? attentionItem.recovery_action : selection.recovery_action,
    },
    prepared_contract: prepared,
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
export function projectTaskFromFlow({ projectId, flow, executionProfile, intentSubmission = null }) {
  const id = taskId(projectId, flow.flow_id);
  const status = taskStatus(flow);
  const latestNormalization = intentSubmission?.normalization;
  const normalization = Number.isInteger(flow.normalization_revision)
    && latestNormalization?.revision === flow.normalization_revision
    ? latestNormalization
    : null;
  const selection = approvedExecutionSelection({
    executionProfile,
    workType: asString(flow.work_type),
    step: asString(flow.current_step),
    override: intentSubmission?.submission?.execution_route_override,
    selectionRevision: intentSubmission?.submission?.runner_selection_revision,
  });
  return {
    schema_version: 1,
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
      intent_submission_id: asString(flow.intent_submission_id),
      normalization_revision: Number.isInteger(flow.normalization_revision) ? flow.normalization_revision : null,
      mission_id: flow.mission_id,
      flow_id: flow.flow_id,
      run_ids: flowRunIds(flow),
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
    primary_action: publicAction(flow.primary_action ?? {
      action_id: null,
      operator_control: null,
      reason: null,
      available: false,
    }, status),
    runner_selection: selection,
    prepared_contract: preparedContract({
      normalization,
      executionProfile,
      workType: asString(flow.work_type),
      scope: normalization?.scope ?? [],
      deliveryMode: asString(normalization?.delivery_mode) ?? asString(flow.writeback_policy?.mode),
      status,
      step: asString(flow.current_step),
      override: intentSubmission?.submission?.execution_route_override,
      selectionRevision: intentSubmission?.submission?.runner_selection_revision,
    }),
    updated_at: flow.updated_at ?? null,
    completed_read_only: status === "completed",
    read_only: true,
  };
}

export function listTaskProjections(options = {}) {
  const flows = listFlowProjections(options);
  let executionProfile = options.executionProfile ?? null;
  if (!executionProfile && options.registry && options.projectId) {
    try {
      executionProfile = readExecutionProfile({ registry: options.registry, projectId: options.projectId });
    } catch {
      executionProfile = null;
    }
  }
  const intentEntries = Array.isArray(options.intentSubmissions) ? options.intentSubmissions : [];
  const intentByFlow = new Map(intentEntries
    .filter((entry) => asString(entry?.submission?.confirmation?.flow_id))
    .map((entry) => [entry.submission.confirmation.flow_id, entry]));
  const flowTasks = flows.flows.map((flow) => projectTaskFromFlow({
    projectId: flows.project_id,
    flow,
    executionProfile,
    intentSubmission: intentByFlow.get(flow.flow_id) ?? null,
  }));
  const intentTasks = intentEntries.length
    ? intentEntries.map((entry) => projectIntentTask({ projectId: flows.project_id, entry, executionProfile })).filter(Boolean)
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
