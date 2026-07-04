import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import "./spa.css";

const STAGES = [
  { id: "readiness", label: "Readiness", command: "project init", hint: "Environment and guardrails" },
  { id: "mission", label: "Mission", command: "mission create", hint: "Intent and outcomes" },
  { id: "discovery", label: "Discovery / Spec / Plan", command: "discovery run", hint: "Understand and plan" },
  { id: "implement", label: "Execution", command: "run start", hint: "Implement and integrate" },
  { id: "review", label: "Review / QA", command: "review run", hint: "Validate and verify" },
  { id: "delivery", label: "Delivery / Release", command: "deliver prepare", hint: "Package and ship" },
  { id: "learning", label: "Learning", command: "learning handoff", hint: "Retro and improve" },
];

const PROJECT_STAGE_TO_UI_STAGE = {
  onboarding: "readiness",
  "mission-intake": "mission",
  discovery: "discovery",
  "spec-build": "discovery",
  planning: "discovery",
  "run-active": "implement",
  execution: "implement",
  implement: "implement",
  review: "review",
  qa: "review",
  repair: "review",
  delivery: "delivery",
  release: "delivery",
  learning: "learning",
};

const ARTIFACT_READINESS_ROWS = [
  { id: "mission", label: "Mission" },
  { id: "discovery", label: "Discovery" },
  { id: "research", label: "Research" },
  { id: "spec", label: "Spec" },
  { id: "planning", label: "Planning" },
];

const STAGE_TO_TARGET_STEP = {
  readiness: "discovery",
  mission: "discovery",
  discovery: "discovery",
  implement: "implement",
  review: "review",
  delivery: "implement",
  learning: "review",
};

const READ_ONLY_INSPECTION_INTENTS = new Set(["analyze", "explain", "review", "validate"]);

const SAFE_TEMPLATE_ID = "safe-walkthrough";

const SAFE_TEMPLATE = {
  templateId: SAFE_TEMPLATE_ID,
  title: "First AOR walkthrough",
  brief: "Inspect this repository and recommend the next safe SDLC step.",
  goals: "Produce bounded next-action evidence for this project.",
  constraints: "No upstream writes, no source file edits, no external runner execution.",
  kpi: "first-run-ready:First run readiness:ready:status",
  dod: "A next-action report exists under .aor and no project files were edited.",
  deliveryMode: "no-write",
  allowedPaths: "",
};

const EMPTY_TEMPLATE = {
  ...SAFE_TEMPLATE,
  templateId: "blank-mission",
  title: "",
  brief: "",
  goals: "",
  constraints: "",
  kpi: "",
  dod: "",
  allowedPaths: "",
};

const DEFAULT_REQUEST = {
  intent: "analyze",
  requestText: "",
  targetRefs: "",
  allowedPaths: "",
  deliveryMode: "no-write",
  targetStep: "",
  requestStageId: "",
  targetFlowId: "",
};

const DELIVERY_MODE_OPTIONS = [
  { value: "no-write", label: "No-Write (Safe)", summary: "Analyze and recommend only.", risk: "Low", icon: "shield" },
  { value: "patch-only", label: "Patch-Only (Gated)", summary: "Apply patch to working tree only.", risk: "Low", icon: "lock" },
  { value: "local-branch", label: "Local Branch (Gated)", summary: "Create local branch via VCS.", risk: "Medium", icon: "target" },
  { value: "fork-first-pr", label: "Fork-First PR (Gated)", summary: "Create fork and open PR.", risk: "Medium", icon: "target" },
];

const REQUEST_INTENT_OPTIONS = [
  { value: "analyze", label: "Analyze", readOnly: true },
  { value: "explain", label: "Explain", readOnly: true },
  { value: "plan", label: "Plan", readOnly: false },
  { value: "repair", label: "Repair", readOnly: false },
  { value: "validate", label: "Validate", readOnly: true },
  { value: "review", label: "Review", readOnly: true },
  { value: "revise-document", label: "Revise Doc", readOnly: false },
  { value: "create-document", label: "Create Doc", readOnly: false },
  { value: "implement", label: "Implement", readOnly: false },
];

const OPERATOR_DECISION_ACTIONS = [
  { id: "continue", label: "Continue", semanticStatus: "pass" },
  { id: "diagnose", label: "Diagnose", semanticStatus: "not_pass" },
  { id: "block", label: "Block", semanticStatus: "blocked" },
  { id: "retry_public_step", label: "Retry public step", semanticStatus: "warn" },
  { id: "answer", label: "Answer", semanticStatus: "interaction_required" },
  { id: "frontend_interact", label: "Frontend interact", semanticStatus: "interaction_required" },
];

const EXECUTION_PATH_GROUP_LABELS = {
  "mission-relevant": "Mission-relevant changes",
  "runtime-owned": "Runtime-owned artifacts",
  "runner-owned-leak": "Runner-owned state leaks",
  "scratch-unrelated": "Scratch or unrelated output",
};

const EXECUTION_ACTION_LABELS = {
  stop_provider: "Stop provider",
  save_partial_evidence: "Save partial evidence",
  diagnose_current_step: "Diagnose current step",
  retry_public_step: "Retry public step",
};

const REVIEW_GATE_ROWS = [
  { label: "Runtime Harness Report", tokens: ["runtime-harness-report", "REP-RTH"] },
  { label: "Validation Report", tokens: ["validation-report", "REP-VAL", "VAL-"] },
  { label: "Evaluation Report", tokens: ["evaluation-report", "REP-EVAL", "EVAL-"] },
  { label: "Review Decision", tokens: ["review-decision", "DEC-REV"] },
  { label: "Delivery Gate Readiness", tokens: ["delivery-plan", "delivery-manifest", "GATE-READY"] },
];

const DELIVERY_CHECK_ROWS = [
  { label: "Approved review handoff", tokens: ["review-decision", "DEC-REV"] },
  { label: "Runtime Harness pass", tokens: ["runtime-harness-report", "REP-RTH"] },
  { label: "Delivery manifest", tokens: ["delivery-manifest", "DLV-", "manifest"] },
  { label: "Release packet", tokens: ["release-packet", "PKT-REL"] },
  { label: "Learning handoff", tokens: ["learning-loop-handoff", "LEARN-HND"] },
];

const STAGE_EXPECTED_OUTPUTS = {
  readiness: ["Runtime policy verified", "Project state initialized", "No-write defaults visible"],
  mission: ["Mission packet", "Intake body", "First next-action report"],
  discovery: ["Dependency graph", "Evidence inventory", "Discovery report"],
  implement: ["Routed step result", "Runtime Harness report", "Patch/proposal evidence"],
  review: ["Validation report", "Evaluation report", "Review decision"],
  delivery: ["Delivery manifest", "Release packet", "Promotion guardrails"],
  learning: ["Learning handoff", "Closure summary", "Follow-up source ref"],
};

const STAGE_SCOPE_SUMMARY = {
  readiness: "Runtime setup only",
  mission: "Mission -> Discovery",
  discovery: "Discovery -> Spec -> Plan",
  implement: "Execution -> Review",
  review: "Review -> Delivery",
  delivery: "Delivery -> Release",
  learning: "Learning -> New Flow",
};

function splitLines(value) {
  return value
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function splitRefs(value) {
  return value
    .split(/[,\n]/u)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function comparableEvidenceRef(ref) {
  return String(ref ?? "")
    .replace(/^packet:\/\/operator-request@/u, "")
    .replace(/^evidence:\/\//u, "")
    .replace(/^\.aor\/projects\/[^/]+\//u, "");
}

function evidenceRefsMatch(left, right) {
  if (!left || !right) return false;
  if (left === right) return true;
  const normalizedLeft = comparableEvidenceRef(left);
  const normalizedRight = comparableEvidenceRef(right);
  return (
    normalizedLeft === normalizedRight ||
    normalizedLeft.endsWith(normalizedRight) ||
    normalizedRight.endsWith(normalizedLeft)
  );
}

const ARTIFACT_FILTERS = [
  { id: "all", label: "All" },
  { id: "failed", label: "Failed" },
  { id: "warnings", label: "Warnings" },
  { id: "provider", label: "Provider" },
  { id: "runtime-harness", label: "Runtime Harness" },
  { id: "verification", label: "Verification" },
  { id: "diff", label: "Diff" },
  { id: "delivery", label: "Delivery" },
  { id: "learning", label: "Learning" },
];

function titleFromRef(ref) {
  const clean = String(ref ?? "artifact")
    .replace(/^packet:\/\/[^@]+@/u, "")
    .replace(/^evidence:\/\//u, "")
    .split("/")
    .pop()
    ?.replace(/\.json$/u, "")
    .replace(/[-_.]+/gu, " ")
    .trim();
  return clean ? clean.replace(/\b\w/gu, (match) => match.toUpperCase()) : "Artifact";
}

function artifactSeverityForStatus(status) {
  const normalized = String(status ?? "").toLowerCase();
  if (["fail", "failed", "not_pass", "blocked", "rejected", "error", "timeout", "missing", "unreadable"].includes(normalized)) return "critical";
  if (["warn", "warning", "hold", "repair", "partial", "stale", "pending", "waiting", "awaiting-decision"].includes(normalized)) return "warning";
  if (["pass", "passed", "ready", "complete", "completed", "success", "accepted", "approved", "submitted", "exit-0"].includes(normalized)) return "success";
  return "info";
}

function artifactTypeForRef(ref) {
  const value = String(ref ?? "").toLowerCase();
  if (value.includes("provider") && (value.includes("raw") || value.includes("evidence"))) return "provider-raw-evidence";
  if (value.includes("runtime-harness-report")) return "runtime-harness-report";
  if (value.includes("quality-repair-request")) return "quality-repair-request";
  if (value.includes("step-result")) return "routed-step-result";
  if (value.includes("verify-summary") || value.includes("validation-report") || value.includes("evaluation-report")) return "verification";
  if (value.includes("target-diff") || value.includes("diff") || value.includes("target-cleanliness")) return "target-diff";
  if (value.includes("delivery-manifest") || value.includes("delivery-plan")) return "delivery-manifest";
  if (value.includes("release-packet")) return "release-packet";
  if (value.includes("learning-loop")) return "learning-handoff";
  if (value.startsWith("packet://")) return "packet";
  if (value.startsWith("evidence://")) return "evidence";
  return "file";
}

function artifactStageForType(type, fallbackStage = "artifact") {
  if (["provider-raw-evidence", "command-trace", "step-observation", "routed-step-result"].includes(type)) return "execution";
  if (["runtime-harness-report", "review-report", "review-decision", "quality-repair-request"].includes(type)) return "runtime-harness";
  if (["verification", "target-diff"].includes(type)) return "verification";
  if (["delivery-manifest", "release-packet"].includes(type)) return "delivery";
  if (["learning", "learning-handoff"].includes(type)) return "learning";
  return fallbackStage;
}

function normalizeArtifactSummary(value, fallbackRef = "", fallback = {}) {
  const raw = value && typeof value === "object" ? value : {};
  const rawRef = raw.raw_ref ?? fallbackRef;
  const type = raw.type ?? artifactTypeForRef(rawRef);
  const status = raw.status ?? fallback.status ?? "ready";
  return {
    type,
    stage: raw.stage ?? fallback.stage ?? artifactStageForType(type, fallback.stage ?? "artifact"),
    label: raw.label ?? titleFromRef(rawRef),
    status,
    severity: raw.severity ?? artifactSeverityForStatus(status),
    description: raw.description ?? fallback.description ?? "Evidence artifact available through the control-plane read model.",
    timestamp: raw.timestamp ?? null,
    source_ref: raw.source_ref ?? rawRef,
    raw_ref: rawRef,
    actions: Array.isArray(raw.actions) ? raw.actions : [{ action_id: "copy_raw_ref", label: "Copy raw ref", kind: "debug" }],
  };
}

function artifactRowFromSummary(summary, overrides = {}) {
  const normalized = normalizeArtifactSummary(summary, overrides.ref, overrides);
  return {
    kind: normalized.type,
    ref: normalized.raw_ref,
    rawRef: normalized.raw_ref,
    sourceRef: normalized.source_ref,
    label: normalized.label,
    status: normalized.status,
    severity: normalized.severity,
    stage: normalized.stage,
    summary: normalized.description,
    timestamp: normalized.timestamp,
    actions: normalized.actions,
    displaySummary: normalized,
    targetFlowId: overrides.targetFlowId,
  };
}

function missingArtifactRow(ref, stage = "artifact") {
  return artifactRowFromSummary(
    {
      type: artifactTypeForRef(ref),
      stage,
      label: `${titleFromRef(ref)} missing`,
      status: "missing",
      severity: "critical",
      description: "This ref is linked to the selected flow, but no readable artifact is available in the current read model.",
      raw_ref: ref,
    },
    { ref },
  );
}

function artifactFilterMatches(row, filterId) {
  if (filterId === "all") return true;
  const haystack = `${row.kind} ${row.stage} ${row.status} ${row.severity} ${row.label}`.toLowerCase();
  if (filterId === "failed") return row.severity === "critical" || ["fail", "failed", "blocked", "missing", "not_pass"].includes(String(row.status).toLowerCase());
  if (filterId === "warnings") return row.severity === "warning";
  if (filterId === "provider") return haystack.includes("provider");
  if (filterId === "runtime-harness") return haystack.includes("runtime-harness");
  if (filterId === "verification") return haystack.includes("verification") || haystack.includes("validation") || haystack.includes("evaluation");
  if (filterId === "diff") return haystack.includes("diff") || haystack.includes("cleanliness");
  if (filterId === "delivery") return haystack.includes("delivery") || haystack.includes("release");
  if (filterId === "learning") return haystack.includes("learning");
  return true;
}

function artifactRowsForRefs(refs, rows, stage = "artifact") {
  return (Array.isArray(refs) ? refs : []).map((ref) => {
    return rows.find((row) => evidenceRefsMatch(row.ref, ref) || evidenceRefsMatch(row.sourceRef, ref)) ?? missingArtifactRow(ref, stage);
  });
}

function evidenceRowForTokens(rows, tokens) {
  return (Array.isArray(rows) ? rows : []).find((row) =>
    tokens.some((token) => `${row.ref} ${row.sourceRef} ${row.label} ${row.kind}`.toLowerCase().includes(token.toLowerCase())),
  ) ?? null;
}

function missionIdFromTitle(title) {
  const base = String(title ?? "flow").toLowerCase().replace(/[^a-z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "");
  return `${base || "flow"}-${Date.now().toString(36)}`;
}

function interactionKey(interaction) {
  return `${interaction.run_id ?? "run"}:${interaction.interaction_id ?? "interaction"}`;
}

async function readJson(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      ...(options.headers ?? {}),
    },
    ...options,
  });
  const raw = await response.text();
  const payload = raw.trim().length > 0 ? JSON.parse(raw) : {};
  if (!response.ok) {
    const message = payload?.error?.message ?? response.statusText;
    throw new Error(message);
  }
  return payload;
}

function resolveUiStageId(nextAction) {
  const projectStage = nextAction?.project_state?.stage;
  return PROJECT_STAGE_TO_UI_STAGE[projectStage] ?? null;
}

function statusTone(state) {
  const normalized = String(state ?? "").toLowerCase();
  if (["connected", "ready", "pass", "complete", "completed", "active", "isolated", "no-write", "detached", "enforced", "read-only"].includes(normalized)) return "safe";
  if (normalized.includes("connected") || normalized.includes("active") || normalized.includes("safe")) return "safe";
  if (normalized.includes("completed") || normalized.includes("enforced")) return "safe";
  if (["blocked", "fail", "failed", "error", "critical", "interrupted"].includes(normalized)) return "danger";
  if (normalized.includes("blocked") || normalized.includes("failed") || normalized.includes("error") || normalized.includes("critical")) return "danger";
  return "warn";
}

function StatusPill({ state }) {
  return <span className={`status-pill ${statusTone(state)}`}>{state}</span>;
}

function asProviderStepStatus(value) {
  return value && typeof value === "object" && !Array.isArray(value) && value.status ? value : null;
}

function isActiveProviderStepStatus(status) {
  return Boolean(status && !["completed", "failed", "interrupted"].includes(status.status));
}

function formatDurationMs(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "n/a";
  const totalSeconds = Math.floor(value / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function formatProviderTimestamp(value) {
  if (typeof value !== "string" || value.trim().length === 0) return "No update yet";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Date(parsed).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function providerStatusCopy(status) {
  if (!status) return "No active provider step.";
  const progressLabel = status.last_progress_label ?? status.last_progress_kind ?? "stream event";
  if (status.status === "silent-running" && status.last_progress_at) {
    return `Provider progress was observed earlier (${progressLabel}), but there is no recent output or progress.`;
  }
  if (status.status === "silent-running" && status.last_output_at) {
    return "Provider output was observed earlier, but there is no recent output or progress.";
  }
  if (status.status === "silent-running") return "No output or progress has been observed yet; provider still running.";
  if (status.status === "timeout-risk" && status.last_progress_at) return `Provider activity is visible (${progressLabel}), but the step is close to the timeout budget.`;
  if (status.status === "timeout-risk") return "Provider is still running and close to the timeout budget.";
  if (status.last_progress_at) return `Provider activity observed: ${progressLabel}.`;
  if (status.last_output_at) return "Provider output observed; step is still running.";
  if (status.status === "artifact-updated") return "Provider is running and evidence was updated.";
  if (status.status === "completed") return "Provider completed. Continue with verification evidence.";
  if (status.status === "interrupted" && status.interruption_owner === "operator") {
    return status.interruption_reason
      ? `Provider was stopped by the operator: ${status.interruption_reason}`
      : "Provider was stopped by the operator. Save partial evidence, then diagnose or retry.";
  }
  if (status.status === "interrupted") return "Provider was stopped or interrupted. Save partial evidence, then diagnose or retry.";
  if (status.status === "failed") return "Provider failed. Inspect evidence before continuing.";
  return "Provider step is running.";
}

function resolveProviderStepStatus(projectState, runs) {
  const fromProject = asProviderStepStatus(projectState?.provider_step_status);
  const fromRuns = Array.isArray(runs)
    ? runs.map((run) => asProviderStepStatus(run.provider_step_status)).filter(Boolean)
    : [];
  return fromRuns.find((status) => isActiveProviderStepStatus(status)) ?? fromProject ?? fromRuns[0] ?? null;
}

function executionEvidenceForFlow(selectedFlow, runs, runtimeTrace, { draft = false } = {}) {
  if (draft || !selectedFlow?.flow_id) return null;
  const traceRunIds = new Set([
    ...(Array.isArray(runtimeTrace?.run_ids) ? runtimeTrace.run_ids : []),
    ...(Array.isArray(runtimeTrace?.trace_items)
      ? runtimeTrace.trace_items.flatMap((item) => (Array.isArray(item.run_ids) ? item.run_ids : []))
      : []),
  ].filter(Boolean));
  if (traceRunIds.size === 0) return null;
  const candidates = (Array.isArray(runs) ? runs : []).filter((run) => traceRunIds.has(run.run_id) && run.execution_evidence);
  const selectedRun = candidates.find((run) => run.provider_step_status?.status && !["completed", "failed", "interrupted"].includes(run.provider_step_status.status))
    ?? strongestExecutionEvidenceRun(candidates)
    ?? null;
  return selectedRun?.execution_evidence
    ? { ...selectedRun.execution_evidence, run_id: selectedRun.run_id, provider_step_status: selectedRun.provider_step_status ?? null }
    : null;
}

function strongestExecutionEvidenceRun(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  return candidates.reduce((best, run, index) => {
    if (!run?.execution_evidence) return best;
    const candidate = { run, score: executionEvidenceScore(run, index) };
    return !best || candidate.score > best.score ? candidate : best;
  }, null)?.run ?? null;
}

function executionEvidenceScore(run, index) {
  const evidence = run?.execution_evidence ?? {};
  const missionRelevant = Array.isArray(evidence.changed_path_groups)
    ? evidence.changed_path_groups.find((group) => group.group_id === "mission-relevant")
    : null;
  const missionPathCount = Array.isArray(missionRelevant?.paths) ? missionRelevant.paths.length : 0;
  let score = index;
  if (evidence.status === "pass") score += 1000;
  if (evidence.real_code_change_status === "pass") score += 800;
  if (missionPathCount > 0) score += 600 + Math.min(missionPathCount, 20);
  if (evidence.runtime_harness_decision === "pass") score += 300;
  if (evidence.review_status === "pass") score += 200;
  if (evidence.post_run_verification_status === "pass") score += 100;
  if (Array.isArray(evidence.blockers) && evidence.blockers.length > 0) score -= 500;
  const runId = String(run?.run_id ?? "");
  if (runId.includes(".verify.")) score -= 200;
  if (runId.includes(".routed-execution.")) score -= 100;
  return score;
}

function executionStatusRows(evidence) {
  const rows = [
    { label: "Provider execution", value: evidence?.provider_execution_status ?? "unknown" },
    { label: "Runtime Harness", value: evidence?.runtime_harness_decision ?? "unknown" },
    { label: "Real code change", value: evidence?.real_code_change_status ?? "unknown" },
    { label: "Post-run verification", value: evidence?.post_run_verification_status ?? "unknown" },
    { label: "Review", value: evidence?.review_status ?? "unknown" },
    { label: "Delivery readiness", value: evidence?.delivery_readiness_status ?? "unknown" },
    { label: "No upstream writes", value: evidence?.no_upstream_write_status ?? "unknown" },
  ];
  if (evidence?.provider_interruption_owner || evidence?.provider_step_status?.interruption_owner) {
    rows.splice(1, 0, {
      label: "Interruption owner",
      value:
        evidence.provider_interruption_owner ??
        evidence.provider_step_status?.interruption_owner ??
        "unknown",
    });
  }
  if (evidence?.provider_interruption_status || evidence?.provider_step_status?.interruption_status) {
    rows.splice(2, 0, {
      label: "Interruption status",
      value:
        evidence.provider_interruption_status ??
        evidence.provider_step_status?.interruption_status ??
        "unknown",
    });
  }
  return rows;
}

function executionActionCommand(action, evidence) {
  const runId = evidence?.run_id ?? "<run-id>";
  if (action.action_id === "stop_provider") {
    return `aor run cancel --run-id ${runId} --approval-ref approval://operator/${runId}/stop`;
  }
  if (action.action_id === "save_partial_evidence") {
    return `aor run status --run-id ${runId} --json`;
  }
  if (action.action_id === "diagnose_current_step") {
    return `aor run status --run-id ${runId} --json`;
  }
  if (action.action_id === "retry_public_step") {
    return `aor run steer --run-id ${runId} --target-step <step>`;
  }
  return action.command_surface ?? "public control-plane action";
}

function selectedStageRuntimeState(stage, currentStage, completed) {
  if (completed) return "Completed";
  if (stage.id === currentStage) return "Active";
  const stageIndex = STAGES.findIndex((candidate) => candidate.id === stage.id);
  const currentIndex = STAGES.findIndex((candidate) => candidate.id === currentStage);
  if (stageIndex >= 0 && currentIndex >= 0 && stageIndex < currentIndex) return "Complete";
  return "Pending";
}

function selectedStageRuntimeCopy(stage, actionStage, state, completed) {
  if (completed) return "Completed artifacts are immutable, read-only evidence.";
  if (state === "Active") return stage.hint;
  if (state === "Complete") return "Completed stage evidence is available for this selected flow.";
  return `Upcoming stage. The current recommended action remains scoped to ${actionStage.label}.`;
}

function Icon({ name }) {
  const paths = {
    refresh: (
      <>
        <path d="M20 12a8 8 0 0 1-13.66 5.66" />
        <path d="M4 12A8 8 0 0 1 17.66 6.34" />
        <path d="M17 2v5h5" />
        <path d="M7 22v-5H2" />
      </>
    ),
    folder: <path d="M3 7h6l2 2h10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />,
    target: (
      <>
        <circle cx="12" cy="12" r="8" />
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
      </>
    ),
    plus: (
      <>
        <path d="M12 5v14" />
        <path d="M5 12h14" />
      </>
    ),
    play: <path d="m8 5 11 7-11 7V5Z" />,
    copy: (
      <>
        <rect x="9" y="9" width="11" height="11" rx="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
      </>
    ),
    close: (
      <>
        <path d="M18 6 6 18" />
        <path d="m6 6 12 12" />
      </>
    ),
    lock: (
      <>
        <rect x="5" y="11" width="14" height="10" rx="2" />
        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      </>
    ),
    shield: (
      <>
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
        <path d="m9 12 2 2 4-4" />
      </>
    ),
    eye: (
      <>
        <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
  };
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      {paths[name] ?? null}
    </svg>
  );
}

function IconButton({ label, children, onClick, disabled = false }) {
  return (
    <button className="icon-button" type="button" onClick={onClick} title={label} aria-label={label} disabled={disabled}>
      {children}
    </button>
  );
}

function Field({ label, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function missionChecklistItems(form) {
  return [
    { label: "Mission Title", complete: String(form?.title ?? "").trim().length > 0 },
    { label: "Mission Brief", complete: String(form?.brief ?? "").trim().length > 0 },
    { label: "Goals", complete: splitLines(form?.goals ?? "").length > 0 },
    { label: "KPI", complete: splitLines(form?.kpi ?? "").length > 0 },
    { label: "Definition of Done", complete: splitLines(form?.dod ?? "").length > 0 },
    { label: "Delivery Mode", complete: String(form?.deliveryMode ?? "").trim().length > 0 },
  ];
}

function flowDisplayName(flow) {
  if (!flow) return "New flow draft";
  return flow.mission_id ?? flow.flow_id ?? "selected flow";
}

function isCompletedFlow(flow) {
  return flow?.completed_read_only === true || flow?.status === "completed";
}

function formatKpiForForm(kpi) {
  if (!kpi || typeof kpi !== "object") return "";
  return [kpi.kpi_id, kpi.name, kpi.target, kpi.measurement].filter(Boolean).join(":");
}

function formFromFlowSettings(flow, { followUp = false } = {}) {
  const settings = flow?.mission_settings ?? {};
  const title = settings.title ?? flowDisplayName(flow);
  return {
    templateId: followUp ? "follow-up-from-closure" : "duplicate-mission-settings",
    title: followUp ? `${title} follow-up` : title,
    brief:
      settings.brief ??
      (followUp ? `Continue from completed flow ${flowDisplayName(flow)}.` : "Duplicate mission settings into a fresh flow."),
    goals: Array.isArray(settings.goals) ? settings.goals.join("\n") : "",
    constraints: Array.isArray(settings.constraints) ? settings.constraints.join("\n") : "",
    kpi: Array.isArray(settings.kpis) ? settings.kpis.map(formatKpiForForm).filter(Boolean).join("\n") : "",
    dod: Array.isArray(settings.definition_of_done) ? settings.definition_of_done.join("\n") : "",
    deliveryMode: settings.delivery_mode ?? flow?.writeback_policy?.mode ?? "no-write",
    allowedPaths: Array.isArray(settings.allowed_paths) ? settings.allowed_paths.join(",") : "",
  };
}

function toUiStageId(stageId) {
  return PROJECT_STAGE_TO_UI_STAGE[stageId] ?? stageId ?? "mission";
}

function actionCommandLabel(action, fallback = "Run aor next") {
  const lowLevelCommand = String(action?.low_level_command ?? "").trim();
  if (lowLevelCommand) {
    return lowLevelCommand.startsWith("aor ") ? lowLevelCommand : `aor ${lowLevelCommand}`;
  }
  return action?.command ?? fallback;
}

function actionCommandTitle(action) {
  return action?.command ?? actionCommandLabel(action);
}

function flowStageId(flow, nextAction, projectState) {
  if (flow?.selected_stage) return toUiStageId(flow.selected_stage);
  if (!flow) return "readiness";
  return resolveUiStageId(nextAction) ?? (projectState?.state_file ? "mission" : "readiness");
}

function evidenceRefMatchesTokens(ref, tokens) {
  const normalized = comparableEvidenceRef(ref).toLowerCase();
  return tokens.some((token) => normalized.includes(token.toLowerCase()));
}

function evidenceRefForTokens(refs, tokens) {
  return (Array.isArray(refs) ? refs : []).find((ref) => evidenceRefMatchesTokens(ref, tokens)) ?? null;
}

function evidenceGateStatus(refs, tokens, fallback = "Pending") {
  return evidenceRefForTokens(refs, tokens) ? "Ready" : fallback;
}

function evidenceRowsForFlow(flow, rows, { draft = false } = {}) {
  if (draft) return [];
  if (!flow?.flow_id) return [];
  const evidenceRefs = Array.isArray(flow.evidence_refs) ? flow.evidence_refs : [];
  const byRef = new Map(rows.map((row) => [row.ref, row]));
  const scopedRows = rows.filter((row) => {
    return row.targetFlowId === flow.flow_id || evidenceRefs.some((ref) => evidenceRefsMatch(row.ref, ref) || evidenceRefsMatch(row.sourceRef, ref));
  });
  const merged = evidenceRefs.map((ref) => {
    const matchedRow = byRef.get(ref) ?? rows.find((row) => evidenceRefsMatch(row.ref, ref) || evidenceRefsMatch(row.sourceRef, ref));
    return matchedRow ? { ...matchedRow, ref: matchedRow.ref, sourceRef: ref } : missingArtifactRow(ref, flow.selected_stage ?? "artifact");
  });
  const seenRefs = new Set(merged.map((row) => comparableEvidenceRef(row.ref)));
  for (const row of scopedRows) {
    const normalizedRef = comparableEvidenceRef(row.ref);
    if (!seenRefs.has(normalizedRef)) {
      merged.push(row);
      seenRefs.add(normalizedRef);
    }
  }
  return merged;
}

function latestRequestForFlow(operatorRequests, selectedFlow, { draft = false } = {}) {
  if (draft) return null;
  if (!selectedFlow?.flow_id) return null;
  return operatorRequests.find((request) => request.document?.target_flow_id === selectedFlow.flow_id)?.document ?? null;
}

function latestDecisionRequestFromEvidence(evidenceRows) {
  const requestRow = (Array.isArray(evidenceRows) ? evidenceRows : [])
    .find((row) => isOperatorDecisionRequestRow(row));
  if (!requestRow) return null;
  return {
    request_summary: requestRow.label ?? "Operator decision request",
    status: requestRow.status ?? "pending",
  };
}

function flowScopedInteractions(stepResults, selectedFlow, runtimeTrace, { draft = false } = {}) {
  if (draft) return [];
  if (!selectedFlow?.flow_id) return [];
  const flowRefs = new Set(Array.isArray(selectedFlow?.evidence_refs) ? selectedFlow.evidence_refs : []);
  const flowRunIds = new Set(
    (Array.isArray(runtimeTrace?.trace_items) ? runtimeTrace.trace_items : [])
      .flatMap((item) => (Array.isArray(item.run_ids) ? item.run_ids : []))
      .filter(Boolean),
  );
  return stepResults
    .map((step) => {
      const requested = step.document?.requested_interaction;
      if (!requested?.requested) return null;
      const status = requested.status ?? "requested";
      if (status !== "requested" && status !== "blocked") return null;
      return {
        run_id: step.document?.run_id,
        interaction_id: requested.interaction_id,
        prompt_summary: requested.prompt_summary ?? requested.summary,
        step_result_ref: step.artifact_ref ?? step.file,
        interaction_type: requested.interaction_type,
      };
    })
    .filter(Boolean)
    .filter((interaction) => {
      const matchesFlowRef = Array.from(flowRefs).some((ref) => evidenceRefsMatch(interaction.step_result_ref, ref));
      return matchesFlowRef || flowRunIds.has(interaction.run_id);
    });
}

function isOperatorDecisionRequestRow(row) {
  const type = String(row?.kind ?? row?.type ?? row?.displaySummary?.type ?? "").toLowerCase();
  return type === "operator-decision-request";
}

function supportedDecisionActionsFromRecord(record) {
  const rawShapeAction = String(record?.expected_response_shape?.action ?? record?.action ?? "");
  const supported = rawShapeAction
    .split("|")
    .map((entry) => entry.trim())
    .filter((entry) => OPERATOR_DECISION_ACTIONS.some((action) => action.id === entry));
  return supported.length > 0 ? supported : OPERATOR_DECISION_ACTIONS.map((action) => action.id);
}

function operatorDecisionRequestsForFlow(selectedFlow, runtimeTrace, evidenceRows, { draft = false } = {}) {
  if (draft) return [];
  const traceItems = selectedFlow?.flow_id && Array.isArray(runtimeTrace?.trace_items) ? runtimeTrace.trace_items : [];
  const traceRefs = traceItems.flatMap((item) => {
    const refs = [
      item.agent_decision_request_ref,
      item.display_summary?.raw_ref,
      item.display_summary?.source_ref,
      item.ref,
    ].filter(Boolean);
    return refs.map((ref) => ({
      ref,
      label: item.display_summary?.label ?? item.summary ?? "Agent decision request",
      status: item.operator_decision_status ?? item.status ?? "pending",
      rejectionReason: item.operator_decision_rejection_reason ?? item.rejection_reason ?? "",
      supportedActions: supportedDecisionActionsFromRecord(item),
    }));
  });
  const evidenceRefs = evidenceRows
    .filter((row) => isOperatorDecisionRequestRow(row))
    .map((row) => ({
      ref: row.rawRef ?? row.sourceRef ?? row.ref,
      label: row.label ?? "Agent decision request",
      status: row.status ?? "pending",
      rejectionReason: row.rejectionReason ?? "",
      supportedActions: OPERATOR_DECISION_ACTIONS.map((action) => action.id),
    }));
  const seen = new Set();
  return [...traceRefs, ...evidenceRefs]
    .filter((entry) => entry.ref)
    .filter((entry) => {
      const key = comparableEvidenceRef(entry.ref).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function FlowSelector({ flows, selectedFlowId, newFlowDraft, onSelectFlow, onNewFlow, newFlowDisabled = false }) {
  const activeFlows = flows.filter((flow) => flow.status === "active");
  const completedFlows = flows.filter((flow) => flow.status === "completed");
  const value = newFlowDraft ? "__new__" : selectedFlowId ?? "";
  return (
    <div className="flow-selector">
      <label htmlFor="flow-selector-control">
        <span>Flow</span>
        <select id="flow-selector-control" name="flow-selector" value={value} aria-label="Flow selector" onChange={(event) => onSelectFlow(event.target.value)}>
          {newFlowDraft ? <option value="__new__">New flow draft</option> : null}
          {flows.length === 0 ? <option value="">No active flow</option> : null}
          {activeFlows.length > 0 ? (
            <optgroup label="Active flows">
              {activeFlows.map((flow) => (
                <option key={flow.flow_id} value={flow.flow_id}>
                  {flowDisplayName(flow)} - Active
                </option>
              ))}
            </optgroup>
          ) : null}
          {completedFlows.length > 0 ? (
            <optgroup label="Completed flows (read-only)">
              {completedFlows.map((flow) => (
                <option key={flow.flow_id} value={flow.flow_id}>
                  {flowDisplayName(flow)} - Completed
                </option>
              ))}
            </optgroup>
          ) : null}
        </select>
      </label>
      <button
        className="secondary new-flow-button"
        type="button"
        onClick={onNewFlow}
        disabled={newFlowDisabled}
        title={newFlowDisabled ? "Initialize the project runtime before starting a flow." : undefined}
      >
        <Icon name="plus" />
        New Flow
      </button>
    </div>
  );
}

function projectStatusLabel(project) {
  const onboarding = project?.onboarding_summary ?? {};
  const flowSummary = project?.active_flow_summary ?? {};
  if (flowSummary.status === "active-flow") return "Active flow";
  if (flowSummary.status === "completed-only") return "Completed flows";
  if (onboarding.status === "initialized") return "Initialized";
  if (onboarding.status === "runtime-ready") return "Runtime ready";
  return "First launch";
}

function ProjectSwitcher({ projects, activeProjectId, onSelectProject, onOpenAddProject, busy }) {
  const activeProject = projects.find((project) => project.project_id === activeProjectId) ?? projects[0] ?? null;
  return (
    <div className="project-switcher" aria-label="Project switcher">
      <label htmlFor="project-switcher-control">
        <span>Project switcher</span>
        <select
          id="project-switcher-control"
          name="project-switcher"
          value={activeProject?.project_id ?? ""}
          onChange={(event) => onSelectProject(event.target.value)}
          disabled={busy || projects.length === 0}
        >
          {projects.map((project) => (
            <option key={project.project_id} value={project.project_id}>
              {project.label ?? project.display_name ?? project.project_id}
            </option>
          ))}
        </select>
      </label>
      <div className="project-switcher-meta">
        <StatusPill state={projectStatusLabel(activeProject)} />
        <code title={activeProject?.runtime_root ?? ""}>{activeProject?.runtime_root ?? "runtime pending"}</code>
      </div>
      <button className="utility-button compact" type="button" onClick={onOpenAddProject} disabled={busy}>
        <Icon name="folder" />Add local project
      </button>
    </div>
  );
}

function StageRail({ selectedStage, currentStage, onSelect, flow, newFlowDraft, providerStepStatus = null }) {
  const currentIndex = Math.max(0, STAGES.findIndex((stage) => stage.id === currentStage));
  const completed = isCompletedFlow(flow);
  const railTitle = newFlowDraft ? "New flow draft" : flow ? flowDisplayName(flow) : "No active flow";
  const railDescription = newFlowDraft
    ? "Draft mission settings are not durable evidence until submitted."
    : completed
      ? "Closed flow evidence is immutable and read-only."
      : flow
        ? "Navigation is scoped to the selected flow."
        : "Readiness prepares the runtime before a flow is created.";
  return (
    <aside className="stage-rail">
      <div className="rail-title">
        <span>Flow stages</span>
        <strong>{newFlowDraft ? "Draft" : flow?.status ?? `${currentIndex + 1}/7`}</strong>
      </div>
      {providerStepStatus ? (
        <div className="provider-heartbeat-rail" aria-label="Provider step heartbeat">
          <div>
            <span>{providerStepStatus.provider ?? "Provider"}</span>
            <strong>{providerStepStatus.adapter ?? providerStepStatus.route_id ?? "external runner"}</strong>
          </div>
          <StatusPill state={providerStepStatus.status} />
          <p>{providerStatusCopy(providerStepStatus)}</p>
          <small>
            {formatDurationMs(providerStepStatus.elapsed_ms)}
            {providerStepStatus.timeout_budget_ms ? ` / ${formatDurationMs(providerStepStatus.timeout_budget_ms)}` : ""}
          </small>
        </div>
      ) : null}
      <nav aria-label="AOR flow stages">
        {STAGES.map((stage, index) => {
          const active = selectedStage === stage.id;
          const done = completed ? index <= currentIndex : index < currentIndex;
          const current = currentStage === stage.id;
          const statusLabel = newFlowDraft
            ? current
              ? "Current"
              : done
                ? "Complete"
                : "Pending"
            : !flow && current
              ? "Current"
            : completed
              ? "Complete"
              : current
                ? "Active"
                : done
                  ? "Complete"
                  : "Pending";
          return (
            <button
              key={stage.id}
              className={`stage-row ${active ? "active" : ""} ${done ? "done" : ""} ${current ? "current" : ""}`}
              type="button"
              onClick={() => onSelect(stage.id)}
            >
              <span className="stage-index">{index + 1}</span>
              <span className="stage-copy">
                <strong>{stage.label}</strong>
                <em>{stage.hint}</em>
              </span>
              <span className={`stage-status-badge ${statusLabel.toLowerCase()}`}>{statusLabel}</span>
              <span className="stage-dot" />
            </button>
          );
        })}
      </nav>
      <div className="rail-note">
        <strong>{railTitle}</strong>
        <p>{railDescription}</p>
      </div>
    </aside>
  );
}

function MissionForm({ form, setForm, busy, submitMission, applyTemplate, onAsk, onCancel = null, askDisabled = false, title = "Start New Flow", description = "Create a fresh mission/intake packet, then let AOR resolve the first next action.", followUpSourceHandoffRef = null }) {
  const selectedDeliveryMode = form.deliveryMode || "no-write";

  return (
    <form className="mission-form" aria-label="Mission intake" onSubmit={submitMission}>
      <div className="form-header">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <div className="form-actions">
          {onCancel ? (
            <button className="secondary" type="button" onClick={onCancel} disabled={busy}>
              Cancel New Flow
            </button>
          ) : null}
          <button className="secondary" type="button" onClick={applyTemplate} disabled={busy}>
            Load template
          </button>
          <button className="secondary" type="button" onClick={onAsk} disabled={busy || askDisabled}>
            <Icon name="target" />
            Ask AOR
          </button>
        </div>
      </div>
      <div className="template-grid" aria-label="New flow templates">
        <button className={`template-card ${form.templateId === "blank-mission" ? "selected" : ""}`} type="button" onClick={() => setForm(EMPTY_TEMPLATE)} disabled={busy}>
          <Icon name="plus" />
          <span>Blank mission</span>
          <p>Start from scratch</p>
        </button>
        <button className={`template-card ${form.templateId === SAFE_TEMPLATE_ID ? "selected" : ""}`} type="button" onClick={applyTemplate} disabled={busy}>
          <Icon name="shield" />
          <span>Safe walkthrough template</span>
          <p>Guided, best-practice path</p>
        </button>
        <button className={`template-card ${followUpSourceHandoffRef ? "selected" : ""}`} type="button" disabled>
          <Icon name="lock" />
          <span>From learning handoff</span>
          <p>{followUpSourceHandoffRef ? "Captured guidance attached" : "Available from closed flows"}</p>
        </button>
        <button className="template-card" type="button" disabled>
          <Icon name="target" />
          <span>From selected evidence / ref</span>
          <p>Attach evidence after a flow exists</p>
        </button>
      </div>
      {followUpSourceHandoffRef ? (
        <div className="follow-up-lineage">
          <Icon name="lock" />
          <div>
            <span>Follow-up source handoff</span>
            <code>{followUpSourceHandoffRef}</code>
          </div>
        </div>
      ) : null}
      <Field label="Title">
        <input name="mission-title" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
      </Field>
      <Field label="Brief">
        <textarea name="mission-brief" value={form.brief} onChange={(event) => setForm({ ...form, brief: event.target.value })} />
      </Field>
      <Field label="Goals">
        <textarea name="mission-goals" value={form.goals} onChange={(event) => setForm({ ...form, goals: event.target.value })} />
      </Field>
      <Field label="Constraints">
        <textarea name="mission-constraints" value={form.constraints} onChange={(event) => setForm({ ...form, constraints: event.target.value })} />
      </Field>
      <div className="form-grid">
        <Field label="KPI">
          <textarea name="mission-kpi" className="compact-textarea" value={form.kpi} onChange={(event) => setForm({ ...form, kpi: event.target.value })} />
        </Field>
        <Field label="Definition of Done">
          <textarea name="mission-dod" className="compact-textarea" value={form.dod} onChange={(event) => setForm({ ...form, dod: event.target.value })} />
        </Field>
      </div>
      <div className="form-grid compact">
        <Field label="Allowed paths">
          <input name="mission-allowed-paths" value={form.allowedPaths} placeholder="apps/web/**, docs/**" onChange={(event) => setForm({ ...form, allowedPaths: event.target.value })} />
        </Field>
      </div>
      <div className="field">
        <span>Delivery Mode</span>
        <div className="delivery-mode-grid" role="radiogroup" aria-label="Delivery mode">
          {DELIVERY_MODE_OPTIONS.map((option) => (
            <button
              key={option.value}
              className={`delivery-mode-card ${selectedDeliveryMode === option.value ? "selected" : ""}`}
              type="button"
              role="radio"
              aria-checked={selectedDeliveryMode === option.value}
              onClick={() => setForm({ ...form, deliveryMode: option.value })}
              disabled={busy}
            >
              <Icon name={option.icon} />
              <strong>{option.label}</strong>
              <p>{option.summary}</p>
              <span>Risk: {option.risk}</span>
            </button>
          ))}
        </div>
      </div>
      <button className="primary" type="submit" disabled={busy}>
        {followUpSourceHandoffRef ? "Create Follow-up Mission & Resolve Next Action" : "Create Mission Packet & Resolve Next Action"}
        <Icon name="target" />
      </button>
    </form>
  );
}

function FlowTimeline({ currentStage, completed }) {
  const currentIndex = Math.max(0, STAGES.findIndex((stage) => stage.id === currentStage));
  return (
    <div className="flow-timeline" aria-label="Flow lifecycle">
      {STAGES.map((stage, index) => {
        const done = completed ? index <= currentIndex : index < currentIndex;
        const current = currentStage === stage.id;
        return (
          <div key={stage.id} className={`timeline-step ${done ? "done" : ""} ${current ? "current" : ""}`}>
            <span>{index + 1}</span>
            <strong>{stage.label}</strong>
            <em>{done ? "Complete" : current ? "Active" : "Pending"}</em>
          </div>
        );
      })}
    </div>
  );
}

function ActionContextGrid({ stage, action, evidenceRefs, evidenceRows = [], blockers, deliveryMode }) {
  const expectedOutputs = STAGE_EXPECTED_OUTPUTS[stage.id] ?? ["Evidence artifact", "Policy decision", "Next-action report"];
  const command = actionCommandLabel(action);
  const riskLevel = blockers.length > 0 ? "Blocked" : deliveryMode === "no-write" ? "Low" : "Gated";
  const visibleEvidence = artifactRowsForRefs(evidenceRefs, evidenceRows, stage.id);
  return (
    <div className="action-detail-grid" aria-label="Recommended action context">
      <div>
        <span>Expected outputs</span>
        <ul>
          {expectedOutputs.map((output) => (
            <li key={output}><span className="check-dot complete-dot" />{output}</li>
          ))}
        </ul>
      </div>
      <div>
        <span>Scope</span>
        <strong>{STAGE_SCOPE_SUMMARY[stage.id] ?? stage.label}</strong>
        <p>{deliveryMode === "no-write" ? "No upstream writes. Analysis and evidence only." : "Explicit allowed paths and review gates required."}</p>
      </div>
      <div>
        <span>Risk level</span>
        <strong>{riskLevel}</strong>
        <p>{blockers.length > 0 ? blockers[0]?.summary ?? blockers[0]?.code : "No blockers for this visible step."}</p>
      </div>
      <div>
        <span>Command provenance</span>
        <strong>AOR runtime</strong>
        <p>Generated from selected-flow evidence and latest next-action state.</p>
      </div>
      <div>
        <span>Dry-run preview</span>
        <code>{command.includes("--dry-run") ? command : `${command} --dry-run`}</code>
        <p>{visibleEvidence.length} selected-flow artifacts available before execution.</p>
      </div>
    </div>
  );
}

function qualityGateSourceLabel(sourceStage) {
  if (sourceStage === "qa") return "QA-origin repair";
  if (sourceStage === "review") return "Review-origin repair";
  return "Quality repair";
}

function qualityGateAttemptLabel(gate) {
  const budget = gate?.attempt_budget ?? {};
  const attempt = budget.attempt_index ?? "?";
  const max = budget.max_attempts ?? "?";
  const remaining = budget.remaining_attempts ?? "?";
  return `${attempt}/${max} (${remaining} remaining)`;
}

function qualityGateBlockerRows(gate) {
  return Array.isArray(gate?.blockers) ? gate.blockers.filter(Boolean) : [];
}

function QualityGatePanel({ gate, evidenceRows = [] }) {
  if (!gate) return null;
  const nextAction = gate.next_action ?? {};
  const evidenceRefs = Array.isArray(gate.evidence_refs) ? gate.evidence_refs : [];
  const evidence = artifactRowsForRefs(evidenceRefs, evidenceRows, "review").slice(0, 4);
  const blockers = qualityGateBlockerRows(gate);
  const sourceLabel = qualityGateSourceLabel(gate.source_stage);
  const hold = gate.operator_hold === true;
  return (
    <div className={`quality-gate-card ${gate.flow_state ?? "requested"} ${hold ? "operator-hold" : ""}`} aria-label="Active quality gate">
      <div className="quality-gate-heading">
        <div>
          <span>Active Quality Gate</span>
          <h3>{hold ? "Budget Exhausted Hold" : sourceLabel}</h3>
          <p>{hold ? "Delivery and release stay blocked until an explicit operator decision is recorded." : "Repair must close through implementation, review, and required QA evidence before delivery."}</p>
        </div>
        <StatusPill state={gate.status ?? gate.flow_state ?? "requested"} />
      </div>

      <div className="quality-gate-grid">
        <div>
          <span>Request</span>
          <strong title={gate.request_ref ?? ""}>{titleFromRef(gate.request_ref)}</strong>
          <p>{gate.request_id ?? gate.request_ref ?? "request ref pending"}</p>
        </div>
        <div>
          <span>Cycle</span>
          <strong>{gate.cycle_id ?? "quality cycle"}</strong>
          <p>{gate.flow_state ?? "repair requested"}</p>
        </div>
        <div>
          <span>Source stage</span>
          <strong>{sourceLabel}</strong>
          <p>{gate.source_stage === "qa" ? "QA rerun required after repair." : "Review rerun required after repair."}</p>
        </div>
        <div>
          <span>Attempt budget</span>
          <strong>{qualityGateAttemptLabel(gate)}</strong>
          <p>{hold ? "No automatic repair attempt remains." : "Repair attempt budget is still bounded."}</p>
        </div>
        <div>
          <span>Delivery / release</span>
          <strong>{gate.delivery_release_blocked ? "Blocked" : "Unblocked"}</strong>
          <p>{gate.delivery_release_blocked ? "Unsafe delivery and release actions are hidden behind the quality gate." : "Quality repair no longer blocks downstream actions."}</p>
        </div>
        <div>
          <span>Findings</span>
          <strong>{Array.isArray(gate.finding_refs) ? gate.finding_refs.length : 0}</strong>
          <p>{Array.isArray(gate.finding_refs) && gate.finding_refs[0] ? gate.finding_refs[0] : "No finding refs captured."}</p>
        </div>
      </div>

      <div className="quality-next-action">
        <span>Next safe action</span>
        <code title={nextAction.command ?? ""}>{actionCommandLabel(nextAction, hold ? "aor review decide" : "aor run start")}</code>
        <p>{nextAction.reason ?? "Follow the resolver primary action for this repair state."}</p>
      </div>

      <div className="quality-gate-evidence">
        <div>
          <span>Blockers</span>
          {blockers.length > 0 ? (
            <ul>{blockers.slice(0, 4).map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>
          ) : (
            <p>No active blockers listed.</p>
          )}
        </div>
        <div>
          <span>Evidence summaries</span>
          {evidence.length > 0 ? (
            <ul>{evidence.map((row) => <li key={row.ref} title={row.rawRef}>{row.label}</li>)}</ul>
          ) : (
            <p>No readable repair evidence summaries yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function StageSpecificPanel({ stage, completed, flow, evidenceRefs, evidenceRows = [], blockers, deliveryMode, artifactReadiness = null }) {
  const closureState = flow?.closure_state ?? {};
  const visibleEvidence = artifactRowsForRefs(evidenceRefs, evidenceRows, stage.id);
  if (completed || stage.id === "learning") {
    const sourceHandoffRefs = Array.isArray(closureState.source_learning_handoff_refs)
      ? closureState.source_learning_handoff_refs
      : [];
    const handoffRef =
      closureState.recommended_follow_up_source_handoff_ref ??
      sourceHandoffRefs[0] ??
      evidenceRefForTokens(evidenceRefs, ["learning-loop-handoff", "LEARN-HND"]);
    const handoffRow = handoffRef ? artifactRowsForRefs([handoffRef], evidenceRows, "learning")[0] : null;
    return (
      <div className="stage-specific-panel learning-panel">
        <div className="panel-heading">
          <div>
            <h3>Learning Closure / Start New Flow</h3>
            <p>Completed evidence stays locked; new work starts from fresh mission evidence.</p>
          </div>
          <StatusPill state={completed ? "read-only" : "active"} />
        </div>
        <div className="closure-state-grid">
          <div>
            <span>Closure state</span>
            <strong>{completed ? "Flow Closed" : "Awaiting closure"}</strong>
            <p>{completed ? "Immutable evidence chain is available for audit." : "Learning evidence will appear after release closure."}</p>
          </div>
          <div>
            <span>Follow-up source</span>
            <strong>{handoffRef ? "Available" : "Not captured yet"}</strong>
            <p title={handoffRef ?? ""}>{handoffRow?.label ?? "Learning handoff pending"}</p>
          </div>
          <div>
            <span>New-flow path</span>
            <strong>Runtime-owned</strong>
            <p><code>mission create</code> writes fresh intake evidence, then <code>next</code> resolves the first step.</p>
          </div>
        </div>
      </div>
    );
  }

  if (stage.id === "review") {
    return (
      <div className="stage-specific-panel review-gate-panel">
        <div className="panel-heading">
          <div>
            <h3>Review Gate Matrix</h3>
            <p>Validation precedes evaluation; downstream delivery remains gated by durable review evidence.</p>
          </div>
          <StatusPill state={blockers.length > 0 ? "blocked" : "ready"} />
        </div>
        <div className="stage-table-wrap">
          <table>
            <thead>
              <tr><th>Gate</th><th>Status</th><th>Evidence ref</th></tr>
            </thead>
            <tbody>
              {REVIEW_GATE_ROWS.map((row) => {
                const evidenceRow = evidenceRowForTokens(visibleEvidence, row.tokens);
                return (
                  <tr key={row.label}>
                    <td>{row.label}</td>
                    <td>{evidenceRow ? evidenceRow.status ?? "Ready" : "Pending"}</td>
                    <td><span className="artifact-ref-label" title={evidenceRow?.rawRef ?? ""}>{evidenceRow?.label ?? "Awaiting evidence"}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (stage.id === "delivery") {
    return (
      <div className="stage-specific-panel delivery-panel">
        <div className="panel-heading">
          <div>
            <h3>Delivery / Release Finalization</h3>
            <p>Write-back remains policy-gated; no upstream writes are implied by the web console.</p>
          </div>
          <StatusPill state={deliveryMode === "no-write" ? "no-write" : deliveryMode} />
        </div>
        <div className="delivery-readiness-grid">
          {DELIVERY_CHECK_ROWS.map((row) => {
            const evidenceRow = evidenceRowForTokens(visibleEvidence, row.tokens);
            return (
              <div key={row.label} className={evidenceRow ? "ready" : "pending"}>
                <span className="check-dot" />
                <strong>{row.label}</strong>
                <p title={evidenceRow?.rawRef ?? ""}>{evidenceRow?.label ?? "Pending"}</p>
              </div>
            );
          })}
        </div>
        <div className="delivery-mode-grid readonly">
          {DELIVERY_MODE_OPTIONS.map((option) => (
            <div key={option.value} className={`delivery-mode-card ${deliveryMode === option.value ? "selected" : ""}`}>
              <Icon name={option.icon} />
              <strong>{option.label}</strong>
              <p>{option.summary}</p>
              <span>Risk: {option.risk}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (stage.id === "implement") {
    return (
      <div className="stage-specific-panel execution-panel">
        <div className="panel-heading">
          <div>
            <h3>Execution Boundary</h3>
            <p>Runtime trace, permission requests, and requested interactions remain scoped to this flow.</p>
          </div>
          <StatusPill state={evidenceGateStatus(evidenceRefs, ["step-result", "run"], "waiting")} />
        </div>
        <div className="stage-signal-grid">
          <div><span>Runtime evidence</span><strong>{visibleEvidence.filter((row) => evidenceRefMatchesTokens(`${row.ref} ${row.kind}`, ["step-result", "runtime-harness-report"])).length}</strong></div>
          <div><span>Open blockers</span><strong>{blockers.length}</strong></div>
          <div><span>Write-back mode</span><strong>{deliveryMode}</strong></div>
        </div>
      </div>
    );
  }

  if (stage.id === "discovery") {
    const readinessStages = artifactReadiness?.stages ?? {};
    return (
      <div className="stage-specific-panel discovery-panel">
        <div className="panel-heading">
          <div>
            <h3>Discovery / Spec / Plan Evidence</h3>
            <p>Planning evidence is read from the selected flow, then used to justify the single next action.</p>
          </div>
          <StatusPill state={evidenceGateStatus(evidenceRefs, ["next-action-report"], "waiting")} />
        </div>
        <div className="stage-signal-grid">
          <div><span>Next-action artifacts</span><strong>{visibleEvidence.filter((row) => evidenceRefMatchesTokens(`${row.ref} ${row.kind}`, ["next-action-report"])).length}</strong></div>
          <div><span>Mission artifacts</span><strong>{visibleEvidence.filter((row) => evidenceRefMatchesTokens(`${row.ref} ${row.kind} ${row.label}`, ["intake", "mission"])).length}</strong></div>
          <div><span>Scope policy</span><strong>{deliveryMode === "no-write" ? "No upstream writes" : "Explicit paths required"}</strong></div>
        </div>
        {artifactReadiness ? (
          <div className="artifact-readiness-grid" aria-label="Artifact readiness">
            {ARTIFACT_READINESS_ROWS.map((row) => {
              const readiness = readinessStages[row.id] ?? {};
              const status = readiness.status ?? "pending";
              const reason = readiness.stale_reasons?.[0] ?? readiness.blocked_reasons?.[0] ?? readiness.reason ?? "Awaiting evidence";
              return (
                <div key={row.id} className={status}>
                  <span>{row.label}</span>
                  <strong>{status}</strong>
                  <p>{reason}</p>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    );
  }

  return null;
}

function FlowCockpit({
  flow,
  stage,
  currentStage,
  nextAction,
  projectState,
  config,
  busy,
  onResolveNext,
  onRefresh,
  onAsk,
  onStartNewFlow,
  onCreateFollowUp,
  onDuplicateMission,
  initializeProject,
  activeProject = null,
  onOpenAddProject = null,
  providerStepStatus = null,
  evidenceRows = [],
}) {
  if (!flow) {
    const projectRef = activeProject?.project_ref ?? config?.project_ref ?? "loading";
    const runtimeRoot = projectState?.runtime_root ?? activeProject?.runtime_root ?? config?.runtime_root ?? ".aor";
    const onboarding = projectState?.onboarding_summary ?? activeProject?.onboarding_summary ?? {};
    const stateReady = Boolean(projectState?.state_file) || onboarding.initialized === true || onboarding.state_exists === true;
    const flowReady = false;
    const wizardStatus = stateReady ? "Runtime ready" : "First launch";
    const wizardSteps = [
      {
        label: "Project Context",
        status: projectRef && projectRef !== "loading" ? "ready" : "pending",
        detail: "Confirm the target repository and runtime root before AOR writes local evidence.",
        code: projectRef,
      },
      {
        label: "Runtime Readiness",
        status: stateReady ? "ready" : "pending",
        detail: stateReady ? "Runtime state is reachable." : "Runtime folders and state evidence are not initialized yet.",
        code: projectState?.state_file ?? "state file pending",
      },
      {
        label: "First Flow",
        status: flowReady ? "ready" : "pending",
        detail: "Create the first no-write mission packet from the safe walkthrough template.",
        code: flowReady ? "mission evidence visible" : "mission intake pending",
      },
      {
        label: "Next Action",
        status: nextAction?.primary_action ? "ready" : "pending",
        detail: "Refresh next action and land in the active flow cockpit.",
        code: nextAction?.primary_action?.command ?? "next pending",
      },
    ];
    return (
      <section className="work-card stage-work readiness-cockpit first-run-wizard" aria-label="First-run wizard">
        <div className="work-heading">
          <div>
            <div className="heading-line">
              <h2>First-run wizard</h2>
              <StatusPill state={wizardStatus} />
            </div>
            <p>Readiness prepares the runtime before a flow is created. Validate project context, initialize explicitly, then create the first flow.</p>
          </div>
          <div className="wizard-heading-actions">
            {onOpenAddProject ? (
              <button className="secondary" type="button" onClick={onOpenAddProject} disabled={busy}>
                <Icon name="folder" />
                Add local project
              </button>
            ) : null}
            <button className="secondary" type="button" onClick={onRefresh} disabled={busy}>
              <Icon name="refresh" />
              Refresh readiness
            </button>
          </div>
        </div>

        <div className="readiness-check-list">
          {wizardSteps.map((step) => (
            <div key={step.label} className={step.status}>
              <span className="check-dot" />
              <div>
                <strong>{step.label}</strong>
                <p>{step.detail}</p>
              </div>
              <code>{step.code}</code>
            </div>
          ))}
          <div className="ready">
            <span className="check-dot" />
            <div>
              <strong>Runtime root policy</strong>
              <p>No-write safety and local control-plane defaults stay visible before any flow exists.</p>
            </div>
            <code>{runtimeRoot}</code>
          </div>
        </div>

        {!stateReady ? (
          <div className="readiness-action">
            <div>
              <Icon name="play" />
              <div>
                <h3>Initialize Project Runtime</h3>
                <p>This does not create a flow. It prepares local runtime evidence and safety controls.</p>
              </div>
            </div>
            <button className="primary" type="button" onClick={initializeProject} disabled={busy}>
              Initialize Project Runtime
            </button>
          </div>
        ) : (
          <div className="readiness-action">
            <div>
              <Icon name="plus" />
              <div>
                <h3>Start First Flow</h3>
                <p>Runtime is ready. Create a no-write mission packet and let AOR resolve the next action.</p>
              </div>
            </div>
            <button className="primary" type="button" onClick={onStartNewFlow} disabled={busy}>
              Start First Flow
            </button>
          </div>
        )}

        <div className="flow-lifecycle-preview" aria-label="Flow lifecycle after readiness">
          <div className="complete"><span className="check-dot" /><strong>Initialize project</strong><p>Prepare runtime and policy</p></div>
          <div><span className="check-dot" /><strong>Start first flow</strong><p>Create a new mission</p></div>
          <div><span className="check-dot" /><strong>Create mission packet</strong><p>Define intent and targets</p></div>
          <div><span className="check-dot" /><strong>Resolve next action</strong><p>Let AOR recommend the safest step</p></div>
        </div>
      </section>
    );
  }

  const completed = isCompletedFlow(flow);
  const followUpEligible = flow?.closure_state?.follow_up_eligible === true;
  const qualityGate = !completed && flow?.active_quality_gate ? flow.active_quality_gate : null;
  const qualityGateBlockers = qualityGateBlockerRows(qualityGate);
  const blockers = qualityGate
    ? qualityGateBlockers.map((blocker) => ({ code: blocker, summary: blocker }))
    : Array.isArray(nextAction?.blockers) && !completed
      ? nextAction.blockers
      : [];
  const evidenceRefs = Array.isArray(flow?.evidence_refs) && flow.evidence_refs.length > 0
    ? flow.evidence_refs
    : Array.isArray(nextAction?.evidence_refs)
      ? nextAction.evidence_refs
      : [];
  const visibleEvidence = artifactRowsForRefs(evidenceRefs, evidenceRows, stage.id);
  const deliveryMode =
    flow?.writeback_policy?.mode ??
    nextAction?.bounded_execution?.requested_delivery_mode ??
    nextAction?.mission_state?.delivery_mode ??
    "no-write";
  const artifactReadiness = nextAction?.artifact_readiness ?? null;
  const nextPrimary = completed
    ? nextAction?.primary_action?.action_id === "start-new-flow"
      ? nextAction.primary_action
      : {
        command: "read-only evidence inspection",
        reason: "This flow is closed. Its evidence chain remains available for audit and follow-up planning.",
      }
    : qualityGate?.next_action?.command
      ? qualityGate.next_action
    : nextAction?.primary_action ?? {
        command: "aor next",
        reason: "Resolve the next deterministic action for the selected flow.",
      };
  const actionStage = STAGES.find((candidate) => candidate.id === currentStage) ?? stage;
  const stageRuntimeState = selectedStageRuntimeState(stage, currentStage, completed);
  const stageRuntimeCopy = selectedStageRuntimeCopy(stage, actionStage, stageRuntimeState, completed);

  return (
    <section className={`work-card flow-cockpit ${completed ? "read-only" : "active"}`}>
      <div className="work-heading">
        <div>
          <div className="heading-line">
            <h2>{completed ? "Learning / Closure" : stage.label}</h2>
            <StatusPill state={stageRuntimeState} />
          </div>
          <p>{stageRuntimeCopy}</p>
        </div>
        <button className="secondary" type="button" onClick={onAsk}>
          <Icon name={completed ? "eye" : "target"} />
          {completed ? "Inspect" : "Ask AOR"}
        </button>
      </div>

      {providerStepStatus ? (
        <div className={`provider-heartbeat-card ${providerStepStatus.status}`}>
          <div className="provider-heartbeat-header">
            <div>
              <span>Provider heartbeat</span>
              <h3>{providerStepStatus.provider ?? "External provider"}</h3>
            </div>
            <StatusPill state={providerStepStatus.status} />
          </div>
          <p>{providerStatusCopy(providerStepStatus)}</p>
          <div className="provider-heartbeat-grid">
            <div>
              <span>Adapter</span>
              <strong>{providerStepStatus.adapter ?? "unknown"}</strong>
            </div>
            <div>
              <span>Route</span>
              <strong>{providerStepStatus.route_id ?? "unknown"}</strong>
            </div>
            <div>
              <span>Elapsed / budget</span>
              <strong>
                {formatDurationMs(providerStepStatus.elapsed_ms)}
                {providerStepStatus.timeout_budget_ms ? ` / ${formatDurationMs(providerStepStatus.timeout_budget_ms)}` : ""}
              </strong>
            </div>
            <div>
              <span>Remaining</span>
              <strong>{formatDurationMs(providerStepStatus.remaining_budget_ms)}</strong>
            </div>
            <div>
              <span>Last output</span>
              <strong>{formatProviderTimestamp(providerStepStatus.last_output_at)}</strong>
            </div>
            <div>
              <span>Last progress</span>
              <strong>{formatProviderTimestamp(providerStepStatus.last_progress_at)}</strong>
            </div>
            <div>
              <span>Activity</span>
              <strong>{providerStepStatus.last_progress_label ?? providerStepStatus.last_progress_kind ?? "No progress yet"}</strong>
            </div>
            <div>
              <span>Last artifact</span>
              <strong>{formatProviderTimestamp(providerStepStatus.last_artifact_update_at)}</strong>
            </div>
            <div>
              <span>Output mode</span>
              <strong>{providerStepStatus.output_mode ?? "unknown"}</strong>
            </div>
          </div>
          <div className="provider-heartbeat-action">
            <span>{providerStepStatus.current_command_label ?? "external-provider-runner"}</span>
            <strong>{providerStepStatus.recommended_action ?? "Provider is still running."}</strong>
          </div>
        </div>
      ) : null}

      <FlowTimeline currentStage={currentStage} completed={completed} />

      <QualityGatePanel gate={qualityGate} evidenceRows={evidenceRows} />

      {completed ? (
        <div className="flow-lock-banner">
          <Icon name="lock" />
          <div>
            <strong>Flow completed - evidence locked</strong>
            <p>Mutation controls are replaced by no-write inspection actions. Start New Flow to continue work.</p>
          </div>
          <div className="closure-actions">
            <button className="primary" type="button" onClick={onStartNewFlow} disabled={busy}>
              <Icon name="plus" />
              Start New Flow
            </button>
            <button className="secondary" type="button" onClick={onCreateFollowUp} disabled={busy || !followUpEligible}>
              Create follow-up from learning handoff
            </button>
            <button className="secondary" type="button" onClick={onDuplicateMission} disabled={busy}>
              Duplicate mission settings
            </button>
          </div>
        </div>
      ) : null}

      <div className="recommended-action">
        <div className="action-header">
          <div>
            <h3>One Recommended Action</h3>
            <p>{completed ? "Single read-only action" : "Single safest next step"}</p>
          </div>
          <StatusPill state={blockers.length > 0 ? "blocked" : completed ? "read-only" : "ready"} />
        </div>
        <div className="action-grid">
          <div className="command-panel">
            <span>Command</span>
            <code title={actionCommandTitle(nextPrimary)}>{actionCommandLabel(nextPrimary)}</code>
            <p>{nextPrimary.reason}</p>
          </div>
          <div>
            <span>Runtime root</span>
            <code>{projectState?.runtime_root ?? activeProject?.runtime_root ?? config?.runtime_root ?? ".aor"}</code>
          </div>
          <div>
            <span>Write-back mode</span>
            <code>{deliveryMode}</code>
          </div>
          <div>
            <span>Safety status</span>
            <strong>{deliveryMode === "no-write" ? "No upstream writes" : "Explicit review required"}</strong>
          </div>
        </div>
        <div className="cockpit-actions">
          <button className="primary" type="button" onClick={onResolveNext} disabled={busy || completed}>
            <Icon name="play" />
            Resolve Next Action
          </button>
          <button className="secondary" type="button" onClick={onRefresh} disabled={busy}>
            <Icon name="refresh" />
            Refresh
          </button>
        </div>
      </div>

      <ActionContextGrid
        stage={actionStage}
        action={nextPrimary}
        evidenceRefs={evidenceRefs}
        evidenceRows={evidenceRows}
        blockers={blockers}
        deliveryMode={deliveryMode}
        artifactReadiness={artifactReadiness}
      />

      <div className="flow-snapshot-grid">
        <div>
          <span>Blockers</span>
          <strong>{blockers.length}</strong>
          <p>{blockers.length === 0 ? "No blockers for the visible next step." : blockers[0]?.summary ?? blockers[0]?.code}</p>
        </div>
        <div>
          <span>Evidence artifacts</span>
          <strong>{visibleEvidence.length}</strong>
          <p title={visibleEvidence[0]?.rawRef ?? ""}>{visibleEvidence[0]?.label ?? "No flow evidence yet."}</p>
        </div>
        <div>
          <span>Flow ID</span>
          <strong>{flow?.mission_id ?? "draft"}</strong>
          <p>{flow?.flow_id ?? "Mission packet will create the flow identity."}</p>
        </div>
      </div>

      <StageSpecificPanel
        stage={stage}
        completed={completed}
        flow={flow}
        evidenceRefs={evidenceRefs}
        evidenceRows={evidenceRows}
        blockers={blockers}
        deliveryMode={deliveryMode}
      />
    </section>
  );
}

function DraftFlowRail({ form }) {
  const checklist = missionChecklistItems(form ?? SAFE_TEMPLATE);
  const completeCount = checklist.filter((item) => item.complete).length;
  return (
    <>
      <section className="rail-card draft-preview-card">
        <h3>New Flow Preview <span>{completeCount}/{checklist.length}</span></h3>
        <ul>
          <li><Icon name="folder" /> Mission/Intake Packet <span>Draft</span></li>
          <li><Icon name="target" /> Next-Action Report <span>Planned</span></li>
          <li><Icon name="target" /> Operator Request <span>If needed</span></li>
          <li><Icon name="shield" /> Runtime-Harness Report <span>Planned</span></li>
        </ul>
      </section>
      <section className="rail-card completeness-card">
        <h3>Completeness Checklist <span>{checklist.length - completeCount} left</span></h3>
        <ul>
          {checklist.map((item) => (
            <li key={item.label} className={item.complete ? "complete" : "missing"}>
              <span className="check-dot" />
              {item.label}
            </li>
          ))}
        </ul>
      </section>
      <section className="rail-card safety-preview-card">
        <h3>Safety Preview</h3>
        <ul>
          <li className="complete"><span className="check-dot" /> No upstream writes <strong>Enforced</strong></li>
          <li className="complete"><span className="check-dot" /> PII redaction <strong>Enabled</strong></li>
          <li className="complete"><span className="check-dot" /> Explicit scope <strong>Required</strong></li>
        </ul>
      </section>
    </>
  );
}

function RightRail({ nextAction, selectedFlow, projectState, config, activeProject = null, operatorRequests, flows = [], newFlowDraft = false, missionDraft = null, evidenceRows = [] }) {
  const completed = isCompletedFlow(selectedFlow);
  const activeFlows = flows.filter((flow) => flow.status === "active");
  const completedFlows = flows.filter((flow) => flow.status === "completed");
  const onboarding = projectState?.onboarding_summary ?? activeProject?.onboarding_summary ?? {};
  const runtimeReady = Boolean(projectState?.state_file) || onboarding.initialized === true || onboarding.state_exists === true;
  let nextPrimary = nextAction?.primary_action ?? {};
  if (!selectedFlow && !newFlowDraft) {
    nextPrimary = runtimeReady
      ? {
        low_level_command: "mission create",
        command: "aor mission create",
        reason: "Create the first no-write mission packet, then resolve the first next action.",
      }
      : {
        low_level_command: "project init",
        command: "aor project init",
        reason: "Prepare the local runtime and safety controls. This does not create a flow.",
      };
  } else if (newFlowDraft) {
    nextPrimary = {
      low_level_command: "mission create",
      command: "aor mission create",
      reason: "Submit the mission form to create a new flow, then resolve the first next action.",
    };
  } else if (completed && nextAction?.primary_action?.action_id !== "start-new-flow") {
    nextPrimary = { command: "read-only evidence inspection", reason: "Completed flow evidence remains inspectable." };
  }
  const blockers = Array.isArray(nextAction?.blockers) && !completed ? nextAction.blockers : [];
  const evidenceRefs = Array.isArray(selectedFlow?.evidence_refs) && selectedFlow.evidence_refs.length > 0
    ? selectedFlow.evidence_refs
    : Array.isArray(nextAction?.evidence_refs)
      ? nextAction.evidence_refs
      : [];
  const visibleEvidence = evidenceRefs.length > 0
    ? artifactRowsForRefs(evidenceRefs, evidenceRows, selectedFlow?.selected_stage ?? "artifact")
    : (!selectedFlow && !newFlowDraft ? evidenceRows : []);
  const deliveryMode =
    selectedFlow?.writeback_policy?.mode ??
    nextAction?.bounded_execution?.requested_delivery_mode ??
    nextAction?.mission_state?.delivery_mode ??
    "no-write";
  const artifactReadiness = nextAction?.artifact_readiness ?? null;
  const artifactReadinessStages = artifactReadiness?.stages ?? {};
  const latestRequest =
    latestRequestForFlow(operatorRequests, selectedFlow, { draft: newFlowDraft }) ??
    (!selectedFlow && !newFlowDraft ? latestDecisionRequestFromEvidence(evidenceRows) : null);
  const verificationPlan = projectState?.verification_plan ?? null;
  const verificationGroups = Array.isArray(verificationPlan?.command_groups) ? verificationPlan.command_groups : [];

  return (
    <aside className="right-rail">
      <section className="rail-card next-card">
        <h3>Next action <span>{newFlowDraft ? "draft" : completed ? "read-only" : "single step"}</span></h3>
        <p className="command" title={actionCommandTitle(nextPrimary)}>{actionCommandLabel(nextPrimary)}</p>
        <p>{nextPrimary.reason ?? "No next-action report has been materialized yet."}</p>
      </section>
      {newFlowDraft ? <DraftFlowRail form={missionDraft} /> : null}
      <section className="rail-card">
        <h3>Blockers <span>{blockers.length}</span></h3>
        <ul>
          {blockers.length === 0 ? <li>None</li> : blockers.slice(0, 4).map((blocker, index) => <li key={`${blocker.code}-${index}`}>{blocker.summary ?? blocker.code}</li>)}
        </ul>
      </section>
      {artifactReadiness ? (
        <section className="rail-card artifact-readiness-card">
          <h3>Artifact readiness <span>{artifactReadiness.policy?.mode ?? "strict"}</span></h3>
          <ul>
            {ARTIFACT_READINESS_ROWS.map((row) => {
              const readiness = artifactReadinessStages[row.id] ?? {};
              return <li key={row.id}><strong>{row.label}</strong><span>{readiness.status ?? "pending"}</span></li>;
            })}
          </ul>
        </section>
      ) : null}
      <section className="rail-card">
        <h3>Evidence artifacts <span>{visibleEvidence.length}</span></h3>
        <div className="artifact-chip-list">
          {visibleEvidence.length === 0 ? (
            <span className="artifact-empty">No artifacts yet</span>
          ) : visibleEvidence.slice(0, 4).map((row) => (
            <span className={`artifact-chip ${row.severity}`} key={row.ref} title={row.rawRef}>
              <strong>{row.label}</strong>
              <em>{row.type ?? row.kind} / {row.status ?? "ready"}</em>
            </span>
          ))}
        </div>
      </section>
      <section className="rail-card verification-plan-card">
        <h3>Verification plan <span>{verificationGroups.length}</span></h3>
        {verificationGroups.length === 0 ? (
          <p>No verification command groups planned yet.</p>
        ) : (
          <>
            <div className="verification-plan-summary">
              <StatusPill state={verificationPlan.latest_verify_status ?? verificationPlan.status ?? "planned"} />
              <span>{verificationPlan.verification_label ?? "default"}</span>
            </div>
            <ul>
              {verificationGroups.slice(0, 5).map((group) => (
                <li key={group.id ?? `${group.role}-${group.phase}`}>
                  <div>
                    <strong>{group.role ?? "custom"}</strong>
                    <span>{group.phase ?? "post-change"} / {group.enforcement ?? "required"}{group.outcome ? ` / ${group.outcome}` : ""}</span>
                  </div>
                  <StatusPill state={group.outcome ?? group.status ?? group.last_result_status ?? "planned"} />
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
      <section className="rail-card">
        <h3>Runtime root</h3>
        <p><code>{projectState?.runtime_root ?? activeProject?.runtime_root ?? config?.runtime_root ?? ".aor"}</code></p>
        <div className="meter"><span /></div>
      </section>
      <section className="rail-card">
        <h3>Safety status</h3>
        <StatusPill state={deliveryMode === "no-write" ? "enforced" : deliveryMode} />
        <p>AOR will not write to upstream remotes by default.</p>
      </section>
      <section className="rail-card">
        <h3>Latest request</h3>
        {latestRequest ? (
          <>
            <p className="command">{latestRequest.request_summary}</p>
            <StatusPill state={latestRequest.status} />
          </>
        ) : (
          <p>No operator request yet.</p>
        )}
      </section>
      <section className="rail-card flow-inventory-card">
        <h3>Flow inventory <span>{flows.length}</span></h3>
        {newFlowDraft ? (
          <div className="flow-inventory-row selected">
            <strong>New flow draft</strong>
            <span>Draft</span>
          </div>
        ) : null}
        {selectedFlow ? (
          <div className="flow-inventory-row selected">
            <strong>{flowDisplayName(selectedFlow)}</strong>
            <span>{completed ? "Completed" : "Active"}</span>
          </div>
        ) : (
          <p>No active flow selected.</p>
        )}
        <div className="flow-inventory-counts">
          <span>Active {activeFlows.length}</span>
          <span>Completed {completedFlows.length}</span>
        </div>
      </section>
    </aside>
  );
}

function EvidenceWorkbench({ rows, selectedRef, setSelectedRef, attachTarget, copyRef }) {
  const [filter, setFilter] = useState("all");
  const filteredRows = rows.filter((row) => artifactFilterMatches(row, filter));
  const selected = filteredRows.find((row) => row.ref === selectedRef) ?? filteredRows[0] ?? null;
  const groupedRows = filteredRows.reduce((groups, row) => {
    const stage = row.stage ?? "artifact";
    if (!groups.has(stage)) groups.set(stage, []);
    groups.get(stage).push(row);
    return groups;
  }, new Map());
  return (
    <section className="work-card evidence-workbench">
      <div className="work-heading compact-heading">
        <div>
          <h3>Evidence & Documents</h3>
          <p>Grouped artifact summaries for the selected flow or project-level live evidence. Raw refs are available through debug actions.</p>
        </div>
      </div>
      <div className="artifact-filter-bar" aria-label="Artifact filters">
        {ARTIFACT_FILTERS.map((entry) => (
          <button key={entry.id} className={filter === entry.id ? "selected" : ""} type="button" onClick={() => setFilter(entry.id)}>
            {entry.label}
          </button>
        ))}
      </div>
      <div className="evidence-grid">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Stage</th>
                <th>Artifact</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            {[...groupedRows.entries()].length === 0 ? (
              <tbody>
                <tr><td colSpan="4">No evidence matches the selected filter.</td></tr>
              </tbody>
            ) : [...groupedRows.entries()].slice(0, 8).map(([stage, stageRows]) => (
              <tbody key={stage}>
                <tr className="artifact-stage-row"><td colSpan="4">{stage}</td></tr>
                {stageRows.slice(0, 12).map((row) => (
                  <tr key={`${row.kind}-${row.ref}`} className={selected?.ref === row.ref ? "selected" : ""}>
                    <td>{row.stage ?? "artifact"}</td>
                    <td>
                      <button className="artifact-summary-button" type="button" onClick={() => setSelectedRef(row.ref)}>
                        <strong>{row.label}</strong>
                        <span>{row.kind}</span>
                      </button>
                    </td>
                    <td><StatusPill state={row.status ?? "ready"} /></td>
                    <td className="row-actions">
                      <IconButton label="Copy raw ref" onClick={() => copyRef(row.rawRef ?? row.ref)}><Icon name="copy" /></IconButton>
                      <IconButton label="Attach as request target" onClick={() => attachTarget(row.rawRef ?? row.ref)}><Icon name="target" /></IconButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
        <div className="preview-pane">
          <span>Preview</span>
          {selected ? (
            <>
              <strong>{selected.label}</strong>
              <div className="artifact-meta-line">
                <StatusPill state={selected.status ?? "ready"} />
                <em>{selected.stage ?? "artifact"} / {selected.kind}</em>
              </div>
              <p>{selected.summary}</p>
              <details className="debug-ref-details">
                <summary>Debug raw ref</summary>
                <code>{selected.rawRef ?? selected.ref}</code>
              </details>
            </>
          ) : (
            <p>{rows.length === 0 ? "Select evidence to preview." : "No evidence matches the selected filter."}</p>
          )}
        </div>
      </div>
    </section>
  );
}

function InteractionsInbox({ interactions, answers, setAnswers, submitAnswer, busy }) {
  const selectedInteraction = interactions[0] ?? null;
  return (
    <section className="work-card inbox">
      <div className="work-heading compact-heading">
        <div>
          <h3>Interactions Inbox</h3>
          <p>Answer runtime-initiated questions through audited continuation.</p>
        </div>
      </div>
      {interactions.length === 0 ? (
        <p className="empty-state">No requested interactions.</p>
      ) : (
        <div className="interactions-layout">
          <div className="interaction-list">
            {interactions.map((interaction) => (
              <div className="interaction-summary-row" key={interactionKey(interaction)}>
                <strong>{interaction.prompt_summary ?? "Runtime requested input"}</strong>
                <span>{interaction.run_id}</span>
                <span className="artifact-ref-label" title={interaction.step_result_ref}>{titleFromRef(interaction.step_result_ref)}</span>
              </div>
            ))}
          </div>
          {selectedInteraction ? (() => {
            const key = interactionKey(selectedInteraction);
            const answer = answers[key] ?? { answer: "", decision: "" };
            const canSend = (answer.answer ?? "").trim().length > 0 || (answer.decision ?? "").length > 0;
            return (
              <div className="interaction-detail-panel">
                <div className="panel-heading">
                  <div>
                    <h3>Interaction Detail</h3>
                    <p>Runtime-initiated request, separate from Ask AOR operator requests.</p>
                  </div>
                  <StatusPill state="Awaiting answer" />
                </div>
                <dl>
                  <dt>Run</dt>
                  <dd><code>{selectedInteraction.run_id}</code></dd>
                  <dt>Interaction</dt>
                  <dd><code>{selectedInteraction.interaction_id}</code></dd>
                  <dt>Evidence</dt>
                  <dd><span className="artifact-ref-label" title={selectedInteraction.step_result_ref}>{titleFromRef(selectedInteraction.step_result_ref)}</span></dd>
                </dl>
                <div className="allowed-answer-types">
                  <span>Allowed answer types</span>
                  <strong>approve_once</strong>
                  <strong>approve_for_run</strong>
                  <strong>deny</strong>
                </div>
                <div className="interaction-row">
                  <select name="interaction-decision" value={answer.decision} onChange={(event) => setAnswers({ ...answers, [key]: { ...answer, decision: event.target.value } })}>
                    <option value="">answer</option>
                    <option value="approve_once">approve_once</option>
                    <option value="deny">deny</option>
                    <option value="approve_for_run">approve_for_run</option>
                  </select>
                  <input name="interaction-answer" value={answer.answer} placeholder="Answer or reason" onChange={(event) => setAnswers({ ...answers, [key]: { ...answer, answer: event.target.value } })} />
                  <button className="secondary" type="button" onClick={() => submitAnswer(selectedInteraction)} disabled={busy || !canSend}>
                    Submit Answer
                  </button>
                </div>
              </div>
            );
          })() : null}
        </div>
      )}
    </section>
  );
}

function OperatorDecisionDrawer({ decisionRequests, copyRef, busy }) {
  const [selectedAction, setSelectedAction] = useState("continue");
  const selectedRequest = decisionRequests[0] ?? null;
  const selectedActionEntry = OPERATOR_DECISION_ACTIONS.find((entry) => entry.id === selectedAction) ?? OPERATOR_DECISION_ACTIONS[0];
  const supportedActions = selectedRequest?.supportedActions ?? OPERATOR_DECISION_ACTIONS.map((action) => action.id);
  const rejectionReason = selectedRequest?.rejectionReason ?? "";
  return (
    <section className="work-card operator-decision-drawer">
      <div className="work-heading compact-heading">
        <div>
          <h3>Operator Decision</h3>
          <p>Review the runtime decision request and choose the bounded operator action.</p>
        </div>
        <StatusPill state={selectedRequest ? selectedRequest.status : "no request"} />
      </div>
      {selectedRequest ? (
        <>
          <div className="decision-request-summary">
            <span>Decision request</span>
            <strong>{selectedRequest.label}</strong>
            <button className="secondary compact" type="button" onClick={() => copyRef(selectedRequest.ref)} disabled={busy}>
              Copy request ref
            </button>
          </div>
          {rejectionReason ? (
            <div className="decision-rejection-copy">
              <span>Rejected decision reason</span>
              <strong>{rejectionReason}</strong>
            </div>
          ) : null}
          <div className="decision-action-grid" role="group" aria-label="Operator decision actions">
            {OPERATOR_DECISION_ACTIONS.map((action) => (
              <button
                key={action.id}
                className={selectedAction === action.id ? "selected" : ""}
                type="button"
                onClick={() => setSelectedAction(action.id)}
                disabled={busy || !supportedActions.includes(action.id)}
              >
                {action.label}
              </button>
            ))}
          </div>
          <div className="decision-validation-preview">
            <div>
              <span>Semantic status</span>
              <strong>{selectedActionEntry.semanticStatus}</strong>
            </div>
            <div>
              <span>Supported actions</span>
              <strong>{supportedActions.length}</strong>
            </div>
            <div>
              <span>Inspected refs</span>
              <strong>Auto-filled from rubric</strong>
            </div>
            <div>
              <span>Frontend refs</span>
              <strong>Preserved when required</strong>
            </div>
          </div>
          <details className="debug-ref-details decision-debug">
            <summary>Debug raw request ref</summary>
            <code>{selectedRequest.ref}</code>
          </details>
        </>
      ) : (
        <p className="empty-state">No pending agent decision request for this flow.</p>
      )}
    </section>
  );
}

function ExecutionEvidencePanel({ evidence, providerEvidenceRows, copyRef, busy }) {
  const statusRows = executionStatusRows(evidence);
  const pathGroups = Array.isArray(evidence?.changed_path_groups) ? evidence.changed_path_groups : [];
  const blockers = Array.isArray(evidence?.blockers) ? evidence.blockers : [];
  const actions = Array.isArray(evidence?.actions) ? evidence.actions : [];
  return (
    <section className="work-card execution-evidence-panel">
      <div className="work-heading compact-heading">
        <div>
          <h3>Execution Evidence</h3>
          <p>Provider status, Runtime Harness decision, diff relevance, verification, and public recovery controls.</p>
        </div>
        <StatusPill state={evidence?.status ?? "no evidence"} />
      </div>
      {!evidence ? (
        <p className="empty-state">No execution evidence visible yet.</p>
      ) : (
        <>
          <div className="execution-status-grid">
            {statusRows.map((row) => (
              <div key={row.label}>
                <span>{row.label}</span>
                <StatusPill state={row.value} />
              </div>
            ))}
          </div>
          {blockers.length > 0 ? (
            <div className="execution-blockers" role="status">
              <span>Blocking evidence</span>
              <ul>{blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>
            </div>
          ) : null}
          <div className="path-group-grid">
            {pathGroups.map((group) => (
              <div className={`path-group-row ${group.group_id}`} key={group.group_id}>
                <div className="path-group-heading">
                  <div>
                    <span>{group.label ?? EXECUTION_PATH_GROUP_LABELS[group.group_id] ?? "Changed paths"}</span>
                    <strong>{group.count ?? 0} paths</strong>
                  </div>
                  <StatusPill state={group.severity ?? group.status} />
                </div>
                <p>{group.description}</p>
                {Array.isArray(group.paths) && group.paths.length > 0 ? (
                  <ul className="path-chip-list">
                    {group.paths.slice(0, 5).map((changedPath) => <li key={changedPath}>{changedPath}</li>)}
                    {group.paths.length > 5 ? <li>{group.paths.length - 5} more</li> : null}
                  </ul>
                ) : (
                  <em>No paths in this group.</em>
                )}
              </div>
            ))}
          </div>
          <div className="provider-evidence-strip">
            <div>
              <span>Provider raw evidence</span>
              <strong>{providerEvidenceRows.length} readable refs</strong>
            </div>
            {providerEvidenceRows.length > 0 ? providerEvidenceRows.slice(0, 4).map((row) => (
              <button className="artifact-chip-button" type="button" key={row.ref} onClick={() => copyRef(row.rawRef ?? row.ref)} disabled={busy}>
                <span>{row.label}</span>
                <em>{row.status ?? "ready"}</em>
              </button>
            )) : <p>No provider evidence refs linked yet.</p>}
          </div>
          <div className="execution-action-grid" aria-label="Execution evidence actions">
            {actions.map((action) => {
              const enabled = action.enabled;
              const command = executionActionCommand(action, evidence);
              return (
                <button
                  key={action.action_id}
                  className="secondary"
                  type="button"
                  onClick={() => copyRef(command)}
                  disabled={busy || !enabled}
                  title={enabled ? command : action.reason}
                >
                  <strong>{action.label ?? EXECUTION_ACTION_LABELS[action.action_id] ?? "Execution action"}</strong>
                  <span>{enabled ? command : action.reason}</span>
                </button>
              );
            })}
          </div>
          <details className="debug-ref-details execution-debug">
            <summary>Debug execution payload</summary>
            <code>{JSON.stringify({ run_id: evidence.run_id, status: evidence.status, required_path_prefixes: evidence.required_path_prefixes ?? [] })}</code>
          </details>
        </>
      )}
    </section>
  );
}

function EvidenceGraphPanel({ graph }) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];
  const selectedNode = nodes[nodes.length - 1] ?? nodes[0] ?? null;
  return (
    <section className="work-card graph-panel">
      <div className="work-heading compact-heading">
        <div>
          <h3>Evidence Graph</h3>
          <p>Selected-flow evidence only. Unrelated flow refs are excluded.</p>
        </div>
        <StatusPill state={graph?.isolation?.excludes_unrelated_flows ? "isolated" : "loading"} />
      </div>
      <div className="graph-context-tabs" aria-label="Evidence graph context">
        <button className="selected" type="button">Current Flow</button>
        <button type="button" disabled>Completed Flows</button>
        <button type="button" disabled>Cross-flow Lineage</button>
      </div>
      <div className="graph-summary">
        <div>
          <span>Nodes</span>
          <strong>{nodes.length}</strong>
        </div>
        <div>
          <span>Edges</span>
          <strong>{edges.length}</strong>
        </div>
        <div>
          <span>Mode</span>
          <strong>{graph?.isolation?.mode ?? "selected-flow-only"}</strong>
        </div>
      </div>
      <div className="graph-node-list">
        {nodes.length === 0 ? (
          <p className="empty-state">No flow graph loaded.</p>
        ) : nodes.slice(0, 8).map((node) => (
          <div className="graph-node" key={node.node_id ?? node.ref}>
            <span>{node.display_summary?.type ?? node.family ?? node.kind ?? "evidence"}</span>
            <strong title={node.ref}>{node.display_summary?.label ?? node.label ?? "Evidence artifact"}</strong>
            <em>{node.display_summary?.status ?? node.status ?? "linked"}</em>
          </div>
        ))}
      </div>
      {nodes.length > 0 ? (
        <div className="graph-flow-canvas" aria-label="Selected flow evidence graph">
          {nodes.slice(0, 10).map((node, index) => (
            <div className="graph-flow-node" key={node.node_id ?? node.ref}>
              <span>{index + 1}</span>
              <strong>{node.label ?? node.family ?? "Evidence"}</strong>
              <em>{node.status ?? node.family ?? "linked"}</em>
            </div>
          ))}
        </div>
      ) : null}
      {selectedNode ? (
        <div className="selected-node-panel">
          <span>Selected node</span>
          <strong title={selectedNode.ref}>{selectedNode.display_summary?.label ?? selectedNode.label ?? selectedNode.family ?? "Evidence"}</strong>
          <p>{selectedNode.display_summary?.description ?? selectedNode.summary ?? "Selected-flow evidence node."}</p>
        </div>
      ) : null}
    </section>
  );
}

function RuntimeTracePanel({ trace }) {
  const items = Array.isArray(trace?.trace_items) ? trace.trace_items : [];
  return (
    <section className="work-card trace-panel">
      <div className="work-heading compact-heading">
        <div>
          <h3>Runtime Trace</h3>
          <p>Run events, step results, harness decisions, and delivery artifacts for this flow.</p>
        </div>
        <StatusPill state={`${items.length} items`} />
      </div>
      <div className="trace-timeline-strip" aria-label="Trace timeline">
        {items.length === 0 ? (
          <span>No trace events yet</span>
        ) : items.slice(0, 8).map((item, index) => (
          <div className="trace-timeline-event" key={`${item.trace_id}-timeline`}>
            <span>{index + 1}</span>
            <strong>{item.event_type ?? item.kind}</strong>
            <em>{item.status ?? "read"}</em>
          </div>
        ))}
      </div>
      <div className="table-wrap trace-table">
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th>Run</th>
              <th>Status</th>
              <th>Artifact</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr><td colSpan="4">No runtime trace yet</td></tr>
            ) : items.slice(0, 10).map((item) => (
              <tr key={item.trace_id}>
                <td>{item.event_type ?? item.kind}</td>
                <td>{Array.isArray(item.run_ids) ? item.run_ids.join(", ") : ""}</td>
                <td>{item.status ?? "read"}</td>
                <td><span className="artifact-ref-label" title={item.ref ?? item.trace_id}>{item.display_summary?.label ?? item.summary ?? item.kind}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AddProjectDrawer({ open, form, setForm, busy, result, onClose, onAdd, onAddAndInitialize }) {
  if (!open) return null;
  const projectPath = form.projectRef.trim();
  const runtimePreview = form.runtimeRoot.trim() || (projectPath ? `${projectPath.replace(/\/+$/u, "")}/.aor` : "<project>/.aor");
  return (
    <div className="drawer-backdrop add-project-backdrop" role="presentation">
      <aside className="request-drawer add-project-drawer" aria-label="Add local project drawer">
        <div className="drawer-header">
          <div>
            <p className="eyebrow">Local workspace</p>
            <h2>Add local project</h2>
          </div>
          <button className="secondary compact" type="button" onClick={onClose}>Close</button>
        </div>
        <div className="request-scope-card">
          <label>
            Project path
            <input
              value={form.projectRef}
              onChange={(event) => setForm({ ...form, projectRef: event.target.value })}
              placeholder="/path/to/local-project"
            />
          </label>
          <label>
            Label
            <input
              value={form.label}
              onChange={(event) => setForm({ ...form, label: event.target.value })}
              placeholder="Optional display name"
            />
          </label>
          <label>
            Runtime root
            <input
              value={form.runtimeRoot}
              onChange={(event) => setForm({ ...form, runtimeRoot: event.target.value })}
              placeholder="Defaults to <project>/.aor"
            />
          </label>
          <div className="runtime-root-preview" aria-label="Runtime root preview">
            <span>Runtime root preview</span>
            <code>{runtimePreview}</code>
          </div>
        </div>
        {result ? (
          <div className={result.status === "error" ? "alert" : "success-note"} role="status">
            {result.message}
          </div>
        ) : null}
        <div className="drawer-actions">
          <button className="secondary drawer-submit" type="button" onClick={onAdd} disabled={busy || !projectPath}>
            Add project to workspace
          </button>
          <button className="primary drawer-submit" type="button" onClick={onAddAndInitialize} disabled={busy || !projectPath}>
            Add and initialize
          </button>
        </div>
      </aside>
    </div>
  );
}

function RequestDrawer({ open, stage, flow, form, setForm, busy, result, onClose, onRun }) {
  const drawerRef = useRef(null);

  useEffect(() => {
    if (open) {
      drawerRef.current?.focus();
    }
  }, [open]);

  if (!open) return null;
  const completed = isCompletedFlow(flow);
  const targetStep = form.targetStep || STAGE_TO_TARGET_STEP[stage.id] || "discovery";
  const scopeMissing = form.deliveryMode !== "no-write" && form.allowedPaths.trim().length === 0;
  const targetRefsMissing = splitRefs(form.targetRefs).length === 0;
  const flowMissing = !flow?.flow_id;
  const readOnlyAllowed = !completed || (form.deliveryMode === "no-write" && READ_ONLY_INSPECTION_INTENTS.has(form.intent));
  const deliveryModes = completed
    ? DELIVERY_MODE_OPTIONS.filter((option) => option.value === "no-write")
    : DELIVERY_MODE_OPTIONS;
  const requestPreview =
    flowMissing
      ? "Select an existing flow before creating an operator request."
      : targetRefsMissing
        ? "Add at least one target ref so the request is auditable and flow-scoped."
        : completed && !readOnlyAllowed
      ? "Completed flows are read-only. Use a no-write analyze, explain, review, or validate request, or start a new flow."
      : form.deliveryMode === "patch-only"
        ? `AOR will compile this request into the ${targetStep} step, run in no-silent-mutation mode, and create proposal plus patch evidence inside allowed paths.`
      : form.deliveryMode === "no-write"
        ? `AOR will compile this request into the ${targetStep} step and create no-write analysis/proposal evidence.`
        : `AOR will record the requested ${form.deliveryMode} mode, validate explicit scope, and create proposal evidence; v1 will not silently mutate files.`;
  return (
    <div className="drawer-backdrop" role="presentation">
      <aside
        ref={drawerRef}
        className="request-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="request-drawer-title"
        tabIndex="-1"
      >
        <div className="drawer-header">
          <div>
            <h2 id="request-drawer-title">Ask AOR</h2>
            <p>{flow ? `${flowDisplayName(flow)} / ${stage.label}` : stage.label}</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close request drawer"><Icon name="close" /></button>
        </div>
        <div className={`target-flow-card request-scope-card ${completed ? "read-only" : ""}`}>
          <span>Target flow</span>
          <strong>{flowDisplayName(flow)}</strong>
          <code>{flow?.flow_id ?? "new-flow-draft"}</code>
          <p>{flowMissing ? "Ask AOR requires a selected flow." : completed ? "Read-only inspection only. Mutation requests are blocked by the control plane." : "Requests are scoped to the selected active flow."}</p>
        </div>
        <div className="field">
          <span>Intent</span>
          <div className="request-intent-segment segmented-control" role="tablist" aria-label="Request intent">
            {REQUEST_INTENT_OPTIONS.map((option) => {
              const disabled = completed && !option.readOnly;
              return (
                <button
                  key={option.value}
                  className={form.intent === option.value ? "selected" : ""}
                  type="button"
                  role="tab"
                  aria-selected={form.intent === option.value}
                  onClick={() => setForm({ ...form, intent: option.value })}
                  disabled={disabled}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
        <Field label="Request">
          <textarea name="request-text" value={form.requestText} placeholder="Ask for analysis, explanation, proposal, patch, validation, or review." onChange={(event) => setForm({ ...form, requestText: event.target.value })} />
        </Field>
        <Field label="Target refs">
          <textarea name="request-target-refs" className="compact-textarea" value={form.targetRefs} placeholder="README.md, evidence://..., packet://..." onChange={(event) => setForm({ ...form, targetRefs: event.target.value })} />
        </Field>
        <Field label="Allowed paths">
          <input name="request-allowed-paths" value={form.allowedPaths} placeholder="docs/**, apps/web/**" onChange={(event) => setForm({ ...form, allowedPaths: event.target.value })} />
        </Field>
        <div className="field">
          <span>Delivery Mode</span>
          <div className="request-mode-grid" role="radiogroup" aria-label="Request delivery mode">
            {deliveryModes.map((option) => (
              <button
                key={option.value}
                className={`delivery-mode-card compact ${form.deliveryMode === option.value ? "selected" : ""}`}
                type="button"
                role="radio"
                aria-checked={form.deliveryMode === option.value}
                onClick={() => setForm({ ...form, deliveryMode: option.value })}
                disabled={busy}
              >
                <Icon name={option.icon} />
                <strong>{option.label}</strong>
                <p>{option.summary}</p>
              </button>
            ))}
          </div>
        </div>
        <div className="form-grid">
          <Field label="Target step">
            <select name="request-target-step" value={form.targetStep} onChange={(event) => setForm({ ...form, targetStep: event.target.value })}>
              <option value="">stage default</option>
              <option value="discovery">discovery</option>
              <option value="research">research</option>
              <option value="spec">spec</option>
              <option value="planning">planning</option>
              <option value="implement">implement</option>
              <option value="review">review</option>
              <option value="qa">qa</option>
              <option value="repair">repair</option>
            </select>
          </Field>
        </div>
        <div className="runtime-preview">
          <span>What runtime will do</span>
          <p>{scopeMissing ? `${requestPreview} Add allowed paths before running this non-no-write request.` : requestPreview}</p>
        </div>
        <button className="primary drawer-submit" type="button" onClick={onRun} disabled={busy || flowMissing || targetRefsMissing || form.requestText.trim().length === 0 || scopeMissing || !readOnlyAllowed}>
          <Icon name="play" />
          {completed ? "Create no-write inspection request" : "Create and run request"}
        </button>
        {result ? (
          <div className="run-result" role="status" aria-live="polite">
            <div className="run-result-header">
              <span>Latest run</span>
              <StatusPill state="completed" />
            </div>
            <dl>
              <dt>Run</dt>
              <dd><code>{result.run_id}</code></dd>
              <dt>Context</dt>
              <dd><code>{result.compiled_context_ref}</code></dd>
              <dt>Step result</dt>
              <dd><span className="artifact-ref-label" title={result.routed_step_result_ref ?? result.routed_step_result_file}>{titleFromRef(result.routed_step_result_ref ?? result.routed_step_result_file)}</span></dd>
              <dt>Next action</dt>
              <dd><span className="artifact-ref-label" title={result.next_action_report_ref ?? result.next_action_report_file}>{titleFromRef(result.next_action_report_ref ?? result.next_action_report_file)}</span></dd>
            </dl>
            <div className="result-ref-list">
              <span>Proposal refs</span>
              {result.proposal_refs?.length ? (
                <ul>{result.proposal_refs.map((ref) => <li key={ref}><span className="artifact-ref-label" title={ref}>{titleFromRef(ref)}</span></li>)}</ul>
              ) : (
                <p>No proposal refs returned.</p>
              )}
            </div>
            {result.patch_refs?.length ? (
              <div className="result-ref-list">
                <span>Patch refs</span>
                <ul>{result.patch_refs.map((ref) => <li key={ref}><span className="artifact-ref-label" title={ref}>{titleFromRef(ref)}</span></li>)}</ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </aside>
    </div>
  );
}

function App() {
  const [config, setConfig] = useState(null);
  const [projectIndex, setProjectIndex] = useState({ projects: [], default_project_id: null });
  const [activeProjectId, setActiveProjectId] = useState(null);
  const [projectState, setProjectState] = useState(null);
  const [nextAction, setNextAction] = useState(null);
  const [flowList, setFlowList] = useState({ flows: [], selected_flow_id: null });
  const [selectedFlow, setSelectedFlow] = useState(null);
  const [selectedFlowId, setSelectedFlowId] = useState(null);
  const [newFlowDraft, setNewFlowDraft] = useState(false);
  const [draftSourceFlow, setDraftSourceFlow] = useState(null);
  const [draftFollowUpHandoffRef, setDraftFollowUpHandoffRef] = useState(null);
  const [flowEvidenceGraph, setFlowEvidenceGraph] = useState(null);
  const [flowRuntimeTrace, setFlowRuntimeTrace] = useState(null);
  const [packets, setPackets] = useState([]);
  const [stepResults, setStepResults] = useState([]);
  const [runs, setRuns] = useState([]);
  const [operatorRequests, setOperatorRequests] = useState([]);
  const [activity, setActivity] = useState([]);
  const [selectedStage, setSelectedStage] = useState("readiness");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState(SAFE_TEMPLATE);
  const [requestDrawerOpen, setRequestDrawerOpen] = useState(false);
  const [addProjectDrawerOpen, setAddProjectDrawerOpen] = useState(false);
  const [addProjectForm, setAddProjectForm] = useState({ projectRef: "", label: "", runtimeRoot: "" });
  const [addProjectResult, setAddProjectResult] = useState(null);
  const [requestForm, setRequestForm] = useState(DEFAULT_REQUEST);
  const [requestResult, setRequestResult] = useState(null);
  const [selectedRef, setSelectedRef] = useState("");
  const [answers, setAnswers] = useState({});
  const [copyFeedback, setCopyFeedback] = useState(null);
  const didChooseStage = useRef(false);
  const didAutoSelectStage = useRef(false);
  const flowSelectionVersion = useRef(0);

  const apiProjectBase = useMemo(() => {
    const projectId = activeProjectId ?? config?.default_project_id ?? config?.project_id;
    if (!projectId) return null;
    return `/api/projects/${encodeURIComponent(projectId)}`;
  }, [activeProjectId, config]);

  const activeStage = STAGES.find((stage) => stage.id === selectedStage) ?? STAGES[1];
  const draftSurface = newFlowDraft;
  const currentStage = draftSurface ? "mission" : flowStageId(selectedFlow, nextAction, projectState);
  const flowOptions = Array.isArray(flowList?.flows) ? flowList.flows : [];
  const projectOptions = Array.isArray(projectIndex?.projects) && projectIndex.projects.length > 0
    ? projectIndex.projects
    : Array.isArray(config?.projects)
      ? config.projects
      : [];
  const activeProject = projectOptions.find((project) => project.project_id === activeProjectId) ??
    projectOptions.find((project) => project.project_id === config?.project_id) ??
    projectOptions[0] ??
    null;
  const activeProjectOnboarding = activeProject?.onboarding_summary ?? {};
  const activeProjectRuntimeReady =
    Boolean(projectState?.state_file)
    || activeProjectOnboarding.initialized === true
    || activeProjectOnboarding.state_exists === true;

  const evidenceRows = useMemo(() => {
    const fromSummary = (summary, overrides = {}) => artifactRowFromSummary(summary, overrides);
    const packetRows = packets.map((packet) => fromSummary(packet.display_summary, {
      ref: packet.artifact_ref ?? packet.file,
      type: packet.family ?? "packet",
      status: packet.document?.status,
      description: packet.document?.summary ?? packet.document?.title ?? "Packet artifact metadata.",
    }));
    const stepRows = stepResults.map((step) => fromSummary(step.display_summary, {
      ref: step.artifact_ref ?? step.file,
      type: "step-result",
      status: step.document?.status,
      description: step.document?.summary ?? "Step result metadata.",
    }));
    const requestRows = operatorRequests.map((request) => fromSummary(request.display_summary, {
      ref: request.operator_request_ref ?? request.artifact_ref ?? request.file,
      type: "operator-request",
      status: request.document?.status,
      description: request.document?.request_summary ?? "Operator request metadata.",
      targetFlowId: request.document?.target_flow_id,
    }));
    const stateRows = (Array.isArray(projectState?.artifact_display_summaries) ? projectState.artifact_display_summaries : [])
      .map((summary) => fromSummary(summary));
    const runRows = (Array.isArray(runs) ? runs : [])
      .flatMap((run) => Array.isArray(run.artifact_display_summaries) ? run.artifact_display_summaries : [])
      .map((summary) => fromSummary(summary));
    const flowRows = (Array.isArray(selectedFlow?.artifact_display_summaries) ? selectedFlow.artifact_display_summaries : [])
      .map((summary) => fromSummary(summary));
    const nextSummaryRows = (Array.isArray(nextAction?.artifact_display_summaries) ? nextAction.artifact_display_summaries : [])
      .map((summary) => fromSummary(summary));
    const nextRows = (Array.isArray(nextAction?.evidence_refs) ? nextAction.evidence_refs : []).map((ref) => ({
      kind: artifactTypeForRef(ref),
      ref,
      rawRef: ref,
      sourceRef: ref,
      label: "next-action evidence",
      status: "ready",
      severity: "success",
      stage: "planning",
      summary: "Evidence referenced by the latest next-action report.",
    }));
    const seen = new Set();
    return [...flowRows, ...requestRows, ...packetRows, ...stepRows, ...stateRows, ...runRows, ...nextSummaryRows, ...nextRows]
      .filter((row) => typeof row.ref === "string" && row.ref.length > 0)
      .filter((row) => {
        const key = comparableEvidenceRef(row.ref).toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }, [packets, stepResults, operatorRequests, projectState, runs, selectedFlow, nextAction]);

  const flowEvidenceRows = useMemo(
    () => evidenceRowsForFlow(selectedFlow, evidenceRows, { draft: draftSurface }),
    [selectedFlow, evidenceRows, draftSurface],
  );
  const selectedFlowRuntimeTrace = useMemo(() => {
    if (!selectedFlow?.flow_id || flowRuntimeTrace?.flow_id !== selectedFlow.flow_id) return null;
    return flowRuntimeTrace;
  }, [flowRuntimeTrace, selectedFlow?.flow_id]);
  const selectedFlowEvidenceGraph = useMemo(() => {
    if (!selectedFlow?.flow_id || flowEvidenceGraph?.flow_id !== selectedFlow.flow_id) return null;
    return flowEvidenceGraph;
  }, [flowEvidenceGraph, selectedFlow?.flow_id]);
  const workbenchEvidenceRows = useMemo(
    () => {
      if (draftSurface) return [];
      return selectedFlow?.flow_id ? flowEvidenceRows : evidenceRows;
    },
    [draftSurface, selectedFlow, flowEvidenceRows, evidenceRows],
  );

  useEffect(() => {
    if (workbenchEvidenceRows.length === 0) {
      if (selectedRef) setSelectedRef("");
      return;
    }
    if (!selectedRef || !workbenchEvidenceRows.some((row) => row.ref === selectedRef)) {
      setSelectedRef(workbenchEvidenceRows[0].ref);
    }
  }, [workbenchEvidenceRows, selectedRef]);

  const interactions = useMemo(() => {
    return flowScopedInteractions(stepResults, selectedFlow, selectedFlowRuntimeTrace, { draft: draftSurface });
  }, [stepResults, selectedFlow, selectedFlowRuntimeTrace, draftSurface]);
  const operatorDecisionRequests = useMemo(() => {
    return operatorDecisionRequestsForFlow(selectedFlow, selectedFlowRuntimeTrace, workbenchEvidenceRows, { draft: draftSurface });
  }, [selectedFlow, selectedFlowRuntimeTrace, workbenchEvidenceRows, draftSurface]);
  const providerStepStatus = useMemo(
    () => resolveProviderStepStatus(projectState, runs),
    [projectState, runs],
  );
  const executionEvidence = useMemo(() => {
    const flowExecutionEvidence = executionEvidenceForFlow(selectedFlow, runs, selectedFlowRuntimeTrace, { draft: draftSurface });
    if (flowExecutionEvidence || draftSurface || selectedFlow?.flow_id || !providerStepStatus) return flowExecutionEvidence;
    return {
      run_id: providerStepStatus.route_id ?? providerStepStatus.step_id ?? "provider-step",
      status: providerStepStatus.status,
      provider_execution_status: providerStepStatus.status,
      runtime_harness_decision: "pending",
      real_code_change_status: "pending",
      post_run_verification_status: "pending",
      review_status: "pending",
      delivery_readiness_status: "pending",
      no_upstream_write_status: "enforced",
      changed_path_groups: [],
      blockers: [],
      actions: [],
      provider_step_status: providerStepStatus,
    };
  }, [selectedFlow, runs, selectedFlowRuntimeTrace, draftSurface, providerStepStatus]);
  const providerEvidenceRows = useMemo(() => {
    return workbenchEvidenceRows.filter((row) => artifactFilterMatches(row, "provider"));
  }, [workbenchEvidenceRows]);

  function pushActivity(label, detail) {
    setActivity((current) => [{ id: `${Date.now()}-${Math.random()}`, label, detail }, ...current.slice(0, 9)]);
  }

  async function loadFlowWorkbench(base, flow) {
    if (!flow?.flow_id) {
      setFlowEvidenceGraph(null);
      setFlowRuntimeTrace(null);
      return;
    }
    const encodedFlowId = encodeURIComponent(flow.flow_id);
    const [graph, trace] = await Promise.all([
      readJson(`${base}/flows/${encodedFlowId}/evidence-graph`).catch(() => null),
      readJson(`${base}/flows/${encodedFlowId}/runtime-trace`).catch(() => null),
    ]);
    setFlowEvidenceGraph(graph);
    setFlowRuntimeTrace(trace);
  }

  async function refresh(options = {}) {
    if (!options.silent) setError("");
    const refreshSelectionVersion = options.selectionVersion ?? flowSelectionVersion.current;
    const appConfig = config ?? (await readJson("/app-config.json"));
    const projectPayload = await readJson("/api/projects").catch(() => ({
      default_project_id: appConfig.default_project_id ?? appConfig.project_id,
      projects: Array.isArray(appConfig.projects) ? appConfig.projects : [],
    }));
    setConfig(appConfig);
    const projects = Array.isArray(projectPayload.projects) && projectPayload.projects.length > 0
      ? projectPayload.projects
      : Array.isArray(appConfig.projects)
        ? appConfig.projects
        : [];
    const selectedProjectId =
      options.projectId ??
      activeProjectId ??
      projectPayload.default_project_id ??
      appConfig.default_project_id ??
      appConfig.project_id;
    const selectedProject = projects.find((project) => project.project_id === selectedProjectId) ?? projects[0] ?? null;
    const effectiveProjectId = selectedProject?.project_id ?? selectedProjectId;
    setProjectIndex({
      ...projectPayload,
      default_project_id: projectPayload.default_project_id ?? appConfig.default_project_id ?? appConfig.project_id,
      projects,
    });
    if (effectiveProjectId && activeProjectId !== effectiveProjectId) {
      setActiveProjectId(effectiveProjectId);
    }
    const onboarding = selectedProject?.onboarding_summary ?? {};
    const shouldReadProjectState = onboarding.initialized === true || onboarding.state_exists === true;
    if (!shouldReadProjectState) {
      const selectionStillCurrent = refreshSelectionVersion === flowSelectionVersion.current;
      setProjectState(null);
      setNextAction(null);
      setFlowList({ flows: [], selected_flow_id: null });
      setSelectedFlow(null);
      setSelectedFlowId(null);
      setPackets([]);
      setStepResults([]);
      setRuns([]);
      setOperatorRequests([]);
      setFlowEvidenceGraph(null);
      setFlowRuntimeTrace(null);
      if (selectionStillCurrent && !didChooseStage.current) {
        setSelectedStage("readiness");
        didAutoSelectStage.current = true;
      }
      if (!options.silent) {
        pushActivity("control-plane.project-preview", selectedProject?.label ?? selectedProject?.project_id ?? "project pending");
      }
      return {
        projectState: null,
        nextAction: null,
        selectedFlow: null,
        selectionApplied: selectionStillCurrent,
      };
    }
    const base = `/api/projects/${encodeURIComponent(effectiveProjectId)}`;
    const [state, next, flowPayload, selectedFlowPayload, packetList, stepList, runList, requestList] = await Promise.all([
      readJson(`${base}/state`),
      readJson(`${base}/next-action-report`).catch(() => null),
      readJson(`${base}/flows`).catch(() => ({ flows: [], selected_flow_id: null })),
      readJson(`${base}/flows/selected`).catch(() => null),
      readJson(`${base}/packets`).catch(() => []),
      readJson(`${base}/step-results`).catch(() => []),
      readJson(`${base}/runs`).catch(() => []),
      readJson(`${base}/operator-requests`).catch(() => []),
    ]);
    const nextReport = next?.document
      ? {
          ...next.document,
          artifact_ref: next.artifact_ref,
          display_summary: next.display_summary,
          artifact_display_summaries: next.artifact_display_summaries,
        }
      : next;
    const flows = Array.isArray(flowPayload?.flows) ? flowPayload.flows : [];
    const draftMode = typeof options.newFlowDraft === "boolean" ? options.newFlowDraft : newFlowDraft;
    const preferredSelectedFlowId = Object.prototype.hasOwnProperty.call(options, "selectedFlowId")
      ? options.selectedFlowId
      : selectedFlowId;
    const preferredFlowId = draftMode ? null : preferredSelectedFlowId ?? flowPayload?.selected_flow_id ?? selectedFlowPayload?.flow_id ?? null;
    const refreshedSelectedFlow =
      flows.find((flow) => flow.flow_id === preferredFlowId) ??
      flows.find((flow) => flow.flow_id === selectedFlowPayload?.flow_id) ??
      selectedFlowPayload ??
      flows[0] ??
      null;
    const selectionStillCurrent = refreshSelectionVersion === flowSelectionVersion.current;
    setProjectState(state);
    setNextAction(nextReport?.primary_action ? nextReport : null);
    setFlowList({ ...flowPayload, flows });
    if (!draftMode && selectionStillCurrent) {
      setSelectedFlow(refreshedSelectedFlow);
      setSelectedFlowId(refreshedSelectedFlow?.flow_id ?? null);
      await loadFlowWorkbench(base, refreshedSelectedFlow);
    } else if (draftMode && selectionStillCurrent) {
      await loadFlowWorkbench(base, null);
    }
    setPackets(Array.isArray(packetList) ? packetList : []);
    setStepResults(Array.isArray(stepList) ? stepList : []);
    setRuns(Array.isArray(runList) ? runList : []);
    setOperatorRequests(Array.isArray(requestList) ? requestList : []);
    if (selectionStillCurrent && !didAutoSelectStage.current && !didChooseStage.current) {
      setSelectedStage(draftMode ? "mission" : flowStageId(refreshedSelectedFlow, nextReport?.primary_action ? nextReport : null, state));
      didAutoSelectStage.current = true;
    }
    const activityFlow = selectionStillCurrent ? refreshedSelectedFlow : selectedFlow;
    if (!options.silent) {
      pushActivity("control-plane.connected", activityFlow?.flow_id ?? nextReport?.primary_action?.command ?? "state refreshed");
    }
    return {
      projectState: state,
      nextAction: nextReport?.primary_action ? nextReport : null,
      selectedFlow: selectionStillCurrent ? refreshedSelectedFlow : selectedFlow,
      selectionApplied: selectionStillCurrent,
    };
  }

  useEffect(() => {
    refresh().catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    if (!apiProjectBase || !isActiveProviderStepStatus(providerStepStatus)) return undefined;
    const poll = () => {
      refresh({ silent: true, selectionVersion: flowSelectionVersion.current }).catch((err) =>
        setError(err instanceof Error ? err.message : String(err)),
      );
    };
    const interval = window.setInterval(poll, 5000);
    return () => window.clearInterval(interval);
  }, [apiProjectBase, providerStepStatus?.status, providerStepStatus?.updated_at, providerStepStatus?.last_progress_at, providerStepStatus?.last_output_at]);

  function chooseStage(stageId) {
    didChooseStage.current = true;
    setSelectedStage(stageId);
  }

  function resetProjectScopedState() {
    flowSelectionVersion.current += 1;
    didChooseStage.current = false;
    didAutoSelectStage.current = false;
    setProjectState(null);
    setNextAction(null);
    setFlowList({ flows: [], selected_flow_id: null });
    setSelectedFlow(null);
    setSelectedFlowId(null);
    setNewFlowDraft(false);
    setDraftSourceFlow(null);
    setDraftFollowUpHandoffRef(null);
    setFlowEvidenceGraph(null);
    setFlowRuntimeTrace(null);
    setPackets([]);
    setStepResults([]);
    setRuns([]);
    setOperatorRequests([]);
    setSelectedRef("");
    setAnswers({});
    setActivity([]);
    setSelectedStage("readiness");
    setRequestDrawerOpen(false);
    setRequestResult(null);
  }

  async function selectProject(projectId) {
    if (!projectId || projectId === activeProjectId || busy) return;
    resetProjectScopedState();
    setActiveProjectId(projectId);
    try {
      await refresh({ projectId, selectionVersion: flowSelectionVersion.current });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function openAddProjectDrawer() {
    setAddProjectResult(null);
    setAddProjectDrawerOpen(true);
  }

  function closeAddProjectDrawer() {
    setAddProjectDrawerOpen(false);
    setAddProjectResult(null);
  }

  async function addLocalProject({ initializeAfterAdd = false } = {}) {
    if (busy || !addProjectForm.projectRef.trim()) return;
    setBusy(true);
    setError("");
    setAddProjectResult(null);
    try {
      const payload = await readJson("/api/projects/actions", {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          action: "add",
          project_ref: addProjectForm.projectRef.trim(),
          ...(addProjectForm.label.trim() ? { label: addProjectForm.label.trim() } : {}),
          ...(addProjectForm.runtimeRoot.trim() ? { runtime_root: addProjectForm.runtimeRoot.trim() } : {}),
        }),
      });
      const nextProjectId = payload.project?.project_id;
      setProjectIndex({
        default_project_id: payload.default_project_id,
        projects: Array.isArray(payload.projects) ? payload.projects : [],
      });
      let resultMessage = "Project added to this local app session.";
      setAddProjectForm({ projectRef: "", label: "", runtimeRoot: "" });
      if (nextProjectId) {
        resetProjectScopedState();
        setActiveProjectId(nextProjectId);
        if (initializeAfterAdd) {
          const projectBase = `/api/projects/${encodeURIComponent(nextProjectId)}`;
          await readJson(`${projectBase}/lifecycle-command/actions`, {
            method: "POST",
            headers: { "content-type": "application/json; charset=utf-8" },
            body: JSON.stringify({ command: "project init", flags: {} }),
          });
          resultMessage = "Project added and initialized. Create the first no-write flow next.";
          pushActivity("workspace.project-initialized", nextProjectId);
        }
        await refresh({ projectId: nextProjectId, selectionVersion: flowSelectionVersion.current });
      }
      setAddProjectResult({ status: "ok", message: resultMessage });
      setAddProjectDrawerOpen(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setAddProjectResult({ status: "error", message });
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  function startNewFlow({ sourceFlow = null, followUp = false, duplicate = false } = {}) {
    if (!activeProjectRuntimeReady) {
      setSelectedStage("readiness");
      pushActivity("flow.new-blocked", "Initialize the project runtime before starting a flow.");
      return;
    }
    flowSelectionVersion.current += 1;
    const sourceHandoffRef =
      followUp
        ? sourceFlow?.closure_state?.recommended_follow_up_source_handoff_ref ??
          sourceFlow?.closure_state?.source_learning_handoff_refs?.[0] ??
          null
        : null;
    setNewFlowDraft(true);
    setSelectedFlow(null);
    setSelectedFlowId(null);
    setDraftSourceFlow(sourceFlow);
    setDraftFollowUpHandoffRef(sourceHandoffRef);
    setFlowEvidenceGraph(null);
    setFlowRuntimeTrace(null);
    setSelectedStage("mission");
    setForm(sourceFlow && (followUp || duplicate) ? formFromFlowSettings(sourceFlow, { followUp }) : SAFE_TEMPLATE);
    setRequestDrawerOpen(false);
    pushActivity(
      followUp ? "flow.follow-up-draft" : duplicate ? "flow.duplicate-draft" : "flow.new-draft",
      sourceHandoffRef ?? "mission intake pending",
    );
  }

  async function cancelNewFlowDraft() {
    const fallbackFlow = selectedFlow ?? flowOptions.find((candidate) => candidate.status === "active") ?? flowOptions[0] ?? null;
    const fallbackFlowId = fallbackFlow?.flow_id ?? selectedFlowId ?? null;
    const cancelSelectionVersion = flowSelectionVersion.current + 1;
    flowSelectionVersion.current = cancelSelectionVersion;
    setBusy(true);
    setError("");
    setNewFlowDraft(false);
    setDraftSourceFlow(null);
    setDraftFollowUpHandoffRef(null);
    setSelectedFlow(fallbackFlow);
    setSelectedFlowId(fallbackFlow?.flow_id ?? null);
    setSelectedStage(flowStageId(fallbackFlow, nextAction, projectState));
    setRequestDrawerOpen(false);
    try {
      const refreshed = await refresh({ newFlowDraft: false, selectedFlowId: fallbackFlowId, selectionVersion: cancelSelectionVersion });
      if (refreshed?.selectionApplied) {
        setSelectedStage(flowStageId(refreshed?.selectedFlow, refreshed?.nextAction, refreshed?.projectState));
      }
      pushActivity("flow.new-draft-cancelled", refreshed?.selectedFlow?.flow_id ?? fallbackFlowId ?? "no active flow");
    } catch (err) {
      if (apiProjectBase && fallbackFlow) {
        loadFlowWorkbench(apiProjectBase, fallbackFlow).catch((workbenchErr) =>
          setError(workbenchErr instanceof Error ? workbenchErr.message : String(workbenchErr)),
        );
      }
      setError(err instanceof Error ? err.message : String(err));
      pushActivity("flow.new-draft-cancelled", fallbackFlow?.flow_id ?? "no active flow");
    } finally {
      setBusy(false);
    }
  }

  function selectFlow(flowId) {
    if (flowId === "__new__") {
      startNewFlow();
      return;
    }
    flowSelectionVersion.current += 1;
    const flow = flowOptions.find((candidate) => candidate.flow_id === flowId) ?? null;
    setNewFlowDraft(false);
    setDraftSourceFlow(null);
    setDraftFollowUpHandoffRef(null);
    setSelectedFlow(flow);
    setSelectedFlowId(flow?.flow_id ?? null);
    setFlowEvidenceGraph(null);
    setFlowRuntimeTrace(null);
    setSelectedStage(flowStageId(flow, nextAction, projectState));
    if (apiProjectBase) {
      loadFlowWorkbench(apiProjectBase, flow).catch((err) => setError(err instanceof Error ? err.message : String(err)));
    }
  }

  function openRequestDrawer(prefillRef = "") {
    const completed = isCompletedFlow(selectedFlow);
    const targetFlowId = selectedFlow?.flow_id ?? "";
    const sameFlow = requestForm.targetFlowId === targetFlowId;
    const sameStage = requestForm.requestStageId === activeStage.id;
    const defaultRequestText = `Analyze the ${activeStage.label} stage and recommend the next bounded action.`;
    const currentText = sameFlow && sameStage && requestForm.requestText ? requestForm.requestText : defaultRequestText;
    const defaultTargetStep = STAGE_TO_TARGET_STEP[activeStage.id] || "discovery";
    const defaultTargetRef =
      selectedFlow?.latest_next_action_report_ref ??
      selectedFlow?.intake_packet_ref ??
      selectedFlow?.evidence_refs?.[0] ??
      "";
    const refs = prefillRef
      ? Array.from(new Set([...(sameFlow ? splitRefs(requestForm.targetRefs) : []), prefillRef])).join("\n")
      : sameFlow && requestForm.targetRefs
        ? requestForm.targetRefs
        : defaultTargetRef;
    setRequestForm({
      ...requestForm,
      requestStageId: activeStage.id,
      targetFlowId,
      intent: completed && !READ_ONLY_INSPECTION_INTENTS.has(requestForm.intent) ? "analyze" : requestForm.intent,
      requestText: currentText,
      targetRefs: refs,
      deliveryMode: completed ? "no-write" : requestForm.deliveryMode,
      allowedPaths: completed ? "" : requestForm.allowedPaths,
      targetStep: sameFlow && sameStage && requestForm.targetStep ? requestForm.targetStep : defaultTargetStep,
    });
    setRequestResult(null);
    setRequestDrawerOpen(true);
  }

  function closeRequestDrawer() {
    setRequestDrawerOpen(false);
    setRequestResult(null);
  }

  useEffect(() => {
    if (!requestDrawerOpen) return undefined;
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        closeRequestDrawer();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [requestDrawerOpen]);

  async function runLifecycle(command, flags = {}) {
    if (!apiProjectBase) {
      setError("Control-plane configuration is still loading.");
      return null;
    }
    const payload = await readJson(`${apiProjectBase}/lifecycle-command/actions`, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ command, flags }),
    });
    pushActivity(`lifecycle.${command}`, payload.lifecycle_command?.blocked ? "blocked" : "accepted");
    return payload;
  }

  async function initializeProject() {
    if (busy) return;
    setBusy(true);
    try {
      await runLifecycle("project init");
      await runLifecycle("next", { json: true });
      await refresh();
      setSelectedStage("mission");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitMission(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const flags = {
        "mission-id": missionIdFromTitle(form.title),
        title: form.title,
        brief: form.brief,
        goal: splitLines(form.goals),
        constraint: splitLines(form.constraints),
        kpi: splitLines(form.kpi),
        dod: splitLines(form.dod),
        "delivery-mode": form.deliveryMode,
      };
      if (form.allowedPaths.trim()) {
        flags["allowed-path"] = form.allowedPaths;
      }
      if (draftFollowUpHandoffRef) {
        flags["follow-up-source-handoff-ref"] = draftFollowUpHandoffRef;
      }
      await runLifecycle("mission create", flags);
      await runLifecycle("next", { json: true });
      setNewFlowDraft(false);
      setDraftSourceFlow(null);
      setDraftFollowUpHandoffRef(null);
      setSelectedFlowId(null);
      await refresh({ newFlowDraft: false, selectedFlowId: null });
      setSelectedStage("discovery");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function resolveNextForSelectedFlow() {
    if (busy) return;
    setBusy(true);
    try {
      await runLifecycle("next", { json: true });
      const refreshed = await refresh();
      setSelectedStage(flowStageId(refreshed?.selectedFlow, refreshed?.nextAction, refreshed?.projectState));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function createAndRunRequest() {
    if (!apiProjectBase || busy) return;
    setBusy(true);
    setError("");
    try {
      const create = await readJson(`${apiProjectBase}/operator-requests`, {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          source_surface: "web",
          target_stage: activeStage.id,
          intent_type: requestForm.intent,
          request_text: requestForm.requestText,
          ...(selectedFlow?.flow_id ? { target_flow_id: selectedFlow.flow_id } : {}),
          target_refs: splitRefs(requestForm.targetRefs),
          allowed_paths: splitRefs(requestForm.allowedPaths),
          delivery_mode: requestForm.deliveryMode,
        }),
      });
      const request = create.operator_request;
      const run = await readJson(`${apiProjectBase}/operator-requests/${encodeURIComponent(request.request_id)}/actions`, {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          action: "run",
          request_ref: request.operator_request_ref,
          target_step: requestForm.targetStep || STAGE_TO_TARGET_STEP[activeStage.id] || "discovery",
        }),
      });
      pushActivity("operator-request.completed", run.operator_request_run?.compiled_context_ref ?? request.operator_request_ref);
      setRequestResult(run.operator_request_run ?? null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitAnswer(interaction) {
    if (!apiProjectBase || busy) return;
    const answer = answers[interactionKey(interaction)] ?? {};
    setBusy(true);
    try {
      await readJson(`${apiProjectBase}/interactions/answers`, {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          run_id: interaction.run_id,
          interaction_id: interaction.interaction_id,
          answer: answer.answer ?? "",
          decision: answer.decision || undefined,
          reason: answer.answer || answer.decision || "operator answered from web console",
        }),
      });
      pushActivity("interaction.answered", interaction.interaction_id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function attachTarget(ref) {
    openRequestDrawer(ref);
  }

  async function copyRef(ref) {
    const value = String(ref ?? "");
    if (!value) return;
    const clipboard = navigator.clipboard;
    if (clipboard && typeof clipboard.writeText === "function") {
      try {
        await clipboard.writeText(value);
        setCopyFeedback({ status: "copied", message: "Copied to clipboard.", value: "" });
        pushActivity("ref.copied", value);
        return;
      } catch {
        // Fall through to the visible manual-copy fallback below.
      }
    }
    setCopyFeedback({
      status: "manual",
      message: "Clipboard unavailable. Select and copy this value.",
      value,
    });
    pushActivity("ref.copy-fallback", value);
  }

  function dismissCopyFeedback() {
    setCopyFeedback(null);
  }

  function copyFeedbackClassName() {
    return `copy-feedback ${copyFeedback?.status === "manual" ? "manual" : "copied"}`;
  }

  const deliveryMode =
    selectedFlow?.writeback_policy?.mode ??
    nextAction?.bounded_execution?.requested_delivery_mode ??
    nextAction?.mission_state?.delivery_mode ??
    "no-write";

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">A</div>
          <div>
            <strong>AOR Operator Console</strong>
            <span>v0.4.2</span>
          </div>
        </div>
        <ProjectSwitcher
          projects={projectOptions}
          activeProjectId={activeProject?.project_id ?? activeProjectId ?? config?.project_id}
          onSelectProject={selectProject}
          onOpenAddProject={openAddProjectDrawer}
          busy={busy}
        />
        <FlowSelector
          flows={flowOptions}
          selectedFlowId={selectedFlowId}
          newFlowDraft={draftSurface}
          onSelectFlow={selectFlow}
          onNewFlow={startNewFlow}
          newFlowDisabled={!activeProjectRuntimeReady || busy}
        />
        <div className="top-context runtime-context">
          <span>Runtime root</span>
          <code>{projectState?.runtime_root ?? activeProject?.runtime_root ?? config?.runtime_root ?? ".aor"}</code>
        </div>
        <StatusPill state={draftSurface ? "Draft flow" : selectedFlow?.status ?? "No active flow"} />
        <div className="topbar-spacer" />
        <StatusPill state={config ? "connected" : "loading"} />
        <StatusPill state={deliveryMode === "no-write" ? "NO-WRITE SAFETY: ON" : deliveryMode} />
        <button className="utility-button topbar-ask-button" type="button" onClick={() => openRequestDrawer()} disabled={busy || !selectedFlow}>
          <Icon name="target" />Ask AOR
        </button>
        <IconButton label="Refresh" onClick={() => refresh().catch((err) => setError(err.message))} disabled={busy}><Icon name="refresh" /></IconButton>
        <button className="utility-button" type="button" onClick={() => copyRef(projectState?.runtime_root ?? activeProject?.runtime_root ?? config?.runtime_root ?? ".aor")}>
          <Icon name="folder" />Copy runtime path
        </button>
      </header>

      {copyFeedback ? (
        <section className={copyFeedbackClassName()} role="status" aria-live="polite">
          <div>
            <strong>{copyFeedback.message}</strong>
            {copyFeedback.value ? (
              <textarea
                aria-label="Copy fallback value"
                readOnly
                value={copyFeedback.value}
                onFocus={(event) => event.currentTarget.select()}
              />
            ) : null}
          </div>
          <button className="secondary compact" type="button" onClick={dismissCopyFeedback}>Dismiss</button>
        </section>
      ) : null}

      <StageRail
        selectedStage={selectedStage}
        currentStage={currentStage}
        onSelect={chooseStage}
        flow={selectedFlow}
        newFlowDraft={draftSurface}
        providerStepStatus={providerStepStatus}
      />

      <main className="main">
        {error ? <div className="alert" role="alert">{error}</div> : null}
        {draftSurface ? (
          <section className="work-card">
            <MissionForm
              form={form}
              setForm={setForm}
              busy={busy}
              submitMission={submitMission}
              applyTemplate={() => setForm(SAFE_TEMPLATE)}
              onAsk={() => openRequestDrawer()}
              onCancel={cancelNewFlowDraft}
              askDisabled={!selectedFlow}
              title={draftFollowUpHandoffRef ? "Create Follow-up Flow" : "Start New Flow"}
              description={
                draftSourceFlow
                  ? "Create fresh mission/intake evidence from completed-flow settings; the source flow remains read-only."
                  : "Create a fresh mission/intake packet, then let AOR resolve the first next action."
              }
              followUpSourceHandoffRef={draftFollowUpHandoffRef}
            />
          </section>
        ) : (
          <FlowCockpit
            flow={selectedFlow}
            stage={activeStage}
            currentStage={currentStage}
            busy={busy}
            nextAction={nextAction}
            projectState={projectState}
            config={config}
            onResolveNext={resolveNextForSelectedFlow}
            onRefresh={() => refresh().catch((err) => setError(err.message))}
            onAsk={() => openRequestDrawer()}
            onStartNewFlow={() => startNewFlow()}
            onCreateFollowUp={() => startNewFlow({ sourceFlow: selectedFlow, followUp: true })}
            onDuplicateMission={() => startNewFlow({ sourceFlow: selectedFlow, duplicate: true })}
            initializeProject={initializeProject}
            activeProject={activeProject}
            onOpenAddProject={openAddProjectDrawer}
            providerStepStatus={providerStepStatus}
            evidenceRows={flowEvidenceRows}
          />
        )}
      </main>

      <RightRail
        nextAction={draftSurface ? null : nextAction}
        selectedFlow={selectedFlow}
        projectState={projectState}
        config={config}
        activeProject={activeProject}
        operatorRequests={operatorRequests}
        flows={flowOptions}
        newFlowDraft={draftSurface}
        missionDraft={draftSurface ? form : null}
        evidenceRows={workbenchEvidenceRows}
      />

      <section className="bottom-bar">
        <div className="activity-table">
          <h3>Activity / Events</h3>
          <table>
            <thead><tr><th>Event</th><th>Details</th></tr></thead>
            <tbody>
              {activity.length === 0 ? <tr><td colSpan="2">No activity yet</td></tr> : activity.map((entry) => (
                <tr key={entry.id}><td>{entry.label}</td><td>{entry.detail}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="activity-table">
          <h3>Artifacts (Recent)</h3>
          <table>
            <thead><tr><th>Artifact</th><th>Status</th></tr></thead>
            <tbody>
              {workbenchEvidenceRows.length === 0 ? (
                <tr><td colSpan="2">{draftSurface ? "Draft flow has no artifacts yet" : "No visible artifacts yet"}</td></tr>
              ) : workbenchEvidenceRows.slice(0, 5).map((row) => (
                <tr key={row.ref}>
                  <td><span className="artifact-ref-label" title={row.rawRef ?? row.ref}>{row.label}</span></td>
                  <td>{row.status ?? "ready"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="workbench-row execution-evidence-row">
        <ExecutionEvidencePanel
          evidence={executionEvidence}
          providerEvidenceRows={providerEvidenceRows}
          copyRef={copyRef}
          busy={busy}
        />
      </section>

      <section className="workbench-row graph-trace-row">
        <EvidenceGraphPanel graph={selectedFlowEvidenceGraph} />
        <RuntimeTracePanel trace={selectedFlowRuntimeTrace} />
      </section>

      <section className="workbench-row secondary-workbench-row">
        <EvidenceWorkbench
          rows={workbenchEvidenceRows}
          selectedRef={selectedRef}
          setSelectedRef={setSelectedRef}
          attachTarget={attachTarget}
          copyRef={copyRef}
        />
        <div className="operator-side-stack">
          <InteractionsInbox
            interactions={interactions}
            answers={answers}
            setAnswers={setAnswers}
            submitAnswer={submitAnswer}
            busy={busy}
          />
          <OperatorDecisionDrawer
            decisionRequests={operatorDecisionRequests}
            copyRef={copyRef}
            busy={busy}
          />
        </div>
      </section>

      <RequestDrawer
        open={requestDrawerOpen}
        stage={activeStage}
        flow={selectedFlow}
        form={requestForm}
        setForm={setRequestForm}
        busy={busy}
        result={requestResult}
        onClose={closeRequestDrawer}
        onRun={createAndRunRequest}
      />
      <AddProjectDrawer
        open={addProjectDrawerOpen}
        form={addProjectForm}
        setForm={setAddProjectForm}
        busy={busy}
        result={addProjectResult}
        onClose={closeAddProjectDrawer}
        onAdd={() => addLocalProject()}
        onAddAndInitialize={() => addLocalProject({ initializeAfterAdd: true })}
      />
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
