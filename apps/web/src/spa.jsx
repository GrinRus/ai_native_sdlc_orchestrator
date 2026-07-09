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
  bootstrap: "readiness",
  readiness: "readiness",
  mission: "mission",
  onboarding: "readiness",
  "mission-intake": "mission",
  discovery: "discovery",
  research: "discovery",
  spec: "discovery",
  "spec-build": "discovery",
  plan: "discovery",
  planning: "discovery",
  handoff: "discovery",
  "run-active": "implement",
  execution: "implement",
  implement: "implement",
  validation: "review",
  review: "review",
  qa: "review",
  eval: "review",
  evaluation: "review",
  harness: "review",
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

const RUN_HEALTH_FIELD = ["run", "health"].join("_");

const ADVANCED_WORKBENCH_FOCUS_EVENT = "aor.advanced-workbench.focus";

const ADVANCED_WORKBENCH_TAB_IDS = new Set([
  "evidence",
  "execution",
  "graph",
  "trace",
  "interactions",
  "decisions",
]);

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

const EXTERNAL_RUN_STEP_CONTEXT = {
  discovery: {
    title: "Discovery evidence",
    description: "Project analysis, discovery research, and next-action evidence are checked before spec work starts.",
    expectedOutputs: ["Project analysis report", "Discovery research report", "Next-action report"],
    scope: "Mission -> Discovery",
    scopeDetail: "No upstream writes. The run is checking whether discovery evidence is ready for spec.",
    signals: [
      { label: "Discovery report", tokens: ["discovery-research-report"] },
      { label: "Project analysis", tokens: ["project-analysis-report"] },
      { label: "Next-action report", tokens: ["next-action-report"] },
    ],
  },
  spec: {
    title: "Spec evidence",
    description: "Feature-traceable spec evidence is checked before planning can continue.",
    expectedOutputs: ["Spec step result", "Traceable feature scope", "Next-action report"],
    scope: "Discovery -> Spec",
    scopeDetail: "No upstream writes. The run is checking whether the spec is ready for planning.",
    signals: [
      { label: "Spec step result", tokens: ["step-result", "spec"] },
      { label: "Discovery input", tokens: ["discovery-research-report"] },
      { label: "Next-action report", tokens: ["next-action-report"] },
    ],
  },
  planning: {
    title: "Planning evidence",
    description: "Wave-ticket and handoff-planning evidence are checked before the execution handoff.",
    expectedOutputs: ["Wave ticket", "Handoff packet", "Next-action report"],
    scope: "Spec -> Planning",
    scopeDetail: "No upstream writes. The run is checking whether implementation scope is bounded.",
    signals: [
      { label: "Wave ticket", tokens: ["wave-ticket"] },
      { label: "Handoff packet", tokens: ["handoff"] },
      { label: "Next-action report", tokens: ["next-action-report"] },
    ],
  },
  handoff: {
    title: "Execution handoff readiness",
    description: "Handoff packet and wave-ticket evidence are checked before controlled execution starts.",
    expectedOutputs: ["Approved handoff packet", "Wave ticket", "Execution scope evidence"],
    scope: "Planning -> Execution handoff",
    scopeDetail: "No upstream writes. The run is checking whether execution can start from approved planning evidence.",
    signals: [
      { label: "Handoff packet", tokens: ["handoff"] },
      { label: "Wave ticket", tokens: ["wave-ticket"] },
      { label: "Execution scope", tokens: ["delivery-plan", "next-action-report"] },
    ],
  },
  execution: {
    title: "Execution evidence",
    description: "Routed implementation evidence and Runtime Harness checks are inspected before review.",
    expectedOutputs: ["Routed step result", "Runtime Harness report", "Patch/proposal evidence"],
    scope: "Execution -> Review",
    scopeDetail: "Write-back remains bounded by policy; no upstream writes happen by default.",
    signals: [
      { label: "Step result", tokens: ["step-result"] },
      { label: "Runtime Harness", tokens: ["runtime-harness-report"] },
      { label: "Patch evidence", tokens: ["patch", "proposal"] },
    ],
  },
  review: {
    title: "Review evidence",
    description: "Validation, evaluation, and review decision evidence are checked before QA or delivery.",
    expectedOutputs: ["Validation report", "Evaluation report", "Review decision"],
    scope: "Review -> QA",
    scopeDetail: "Validation precedes evaluation; downstream delivery remains blocked until review is durable.",
    signals: [
      { label: "Validation report", tokens: ["validation-report"] },
      { label: "Evaluation report", tokens: ["evaluation-report"] },
      { label: "Review decision", tokens: ["review-decision"] },
    ],
  },
  qa: {
    title: "QA evidence",
    description: "QA and repair-loop evidence are checked before delivery preparation.",
    expectedOutputs: ["QA verdict", "Repair closure evidence", "Runtime Harness pass"],
    scope: "QA -> Delivery",
    scopeDetail: "Delivery stays gated until QA and any repair loop are closed.",
    signals: [
      { label: "QA evidence", tokens: ["qa", "quality"] },
      { label: "Repair closure", tokens: ["repair", "quality-repair-request"] },
      { label: "Runtime Harness", tokens: ["runtime-harness-report"] },
    ],
  },
  delivery: {
    title: "Delivery evidence",
    description: "Delivery manifest, release packet, and promotion guardrails are checked before closure.",
    expectedOutputs: ["Delivery manifest", "Release packet", "Promotion guardrails"],
    scope: "Delivery -> Release",
    scopeDetail: "Write-back remains policy-gated and explicit.",
    signals: [
      { label: "Delivery manifest", tokens: ["delivery-manifest"] },
      { label: "Release packet", tokens: ["release-packet"] },
      { label: "Promotion evidence", tokens: ["promotion", "certification"] },
    ],
  },
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

const ARTIFACT_REF_LABELS = [
  { tokens: ["next-action-report", "next-action"], label: "Next Action Report" },
  { tokens: ["project-analysis-report"], label: "Project Analysis Report" },
  { tokens: ["discovery-research-report"], label: "Discovery Research Report" },
  { tokens: ["wave-ticket"], label: "Wave Ticket" },
  { tokens: ["handoff-packet", "handoff.bootstrap"], label: "Handoff Packet" },
  { tokens: ["runtime-harness-report"], label: "Runtime Harness Report" },
  { tokens: ["quality-repair-request"], label: "Repair Request" },
  { tokens: ["quality-assessment-report"], label: "Quality Assessment Report" },
  { tokens: ["quality-assessment-request"], label: "Quality Assessment Request" },
  { tokens: ["review-decision"], label: "Review Decision" },
  { tokens: ["review-report"], label: "Review Report" },
  { tokens: ["validation-report"], label: "Validation Report" },
  { tokens: ["evaluation-report"], label: "Evaluation Report" },
  { tokens: ["verify-summary", "verification-summary"], label: "Verification Summary" },
  { tokens: ["verification-plan"], label: "Verification Plan" },
  { tokens: ["step-result"], label: "Routed Step Result" },
  { tokens: ["target-cleanliness"], label: "Target Cleanliness" },
  { tokens: ["target-diff", "diff-summary"], label: "Target Diff" },
  { tokens: ["delivery-manifest"], label: "Delivery Manifest" },
  { tokens: ["delivery-plan"], label: "Delivery Plan" },
  { tokens: ["release-packet"], label: "Release Packet" },
  { tokens: ["learning-loop-handoff"], label: "Learning Handoff" },
  { tokens: ["learning-loop-scorecard"], label: "Learning Scorecard" },
  { tokens: ["adapter-live", "provider-raw-evidence"], label: "Provider Evidence" },
  { tokens: ["compiled-context"], label: "Compiled Context" },
  { tokens: ["step-observation", "observation-report"], label: "Step Observation" },
  { tokens: ["agent-decision-request", "operator-decision-request"], label: "Operator Decision Request" },
  { tokens: ["operator-request"], label: "Operator Request" },
  { tokens: ["run-control-state"], label: "Run Control State" },
  { tokens: ["run-control-event", "command-trace"], label: "Command Trace" },
  { tokens: ["project-init-state"], label: "Project Runtime State" },
  { tokens: ["onboarding-report"], label: "Onboarding Report" },
];

const ARTIFACT_TYPE_LABELS = {
  "next-action": "Next Action Report",
  "runtime-harness-report": "Runtime Harness Report",
  "quality-repair-request": "Repair Request",
  "quality-assessment-report": "Quality Assessment Report",
  "quality-assessment-request": "Quality Assessment Request",
  "routed-step-result": "Routed Step Result",
  verification: "Verification Summary",
  evaluation: "Evaluation Report",
  "target-diff": "Target Diff",
  "delivery-manifest": "Delivery Manifest",
  "delivery-plan": "Delivery Plan",
  "release-packet": "Release Packet",
  "learning-handoff": "Learning Handoff",
  "provider-raw-evidence": "Provider Evidence",
  "command-trace": "Command Trace",
  "step-observation": "Step Observation",
  "operator-request": "Operator Request",
  packet: "Artifact Packet",
  evidence: "Evidence Artifact",
  file: "Evidence Artifact",
};

function semanticArtifactTitleFromRef(ref) {
  const normalized = String(ref ?? "")
    .replace(/^packet:\/\/[^@]+@/u, "")
    .replace(/^evidence:\/\//u, "")
    .toLowerCase();
  return ARTIFACT_REF_LABELS.find((entry) => entry.tokens.some((token) => normalized.includes(token)))?.label ?? null;
}

function titleFromRef(ref) {
  const semanticTitle = semanticArtifactTitleFromRef(ref);
  if (semanticTitle) return semanticTitle;
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

function humanizeToken(value) {
  return String(value ?? "")
    .replace(/[_./-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/\b\w/gu, (match) => match.toUpperCase());
}

function looksLikeTechnicalRef(value) {
  const text = String(value ?? "");
  return (
    text.length > 72 ||
    /(?:^\/|\.aor|evidence:\/\/|packet:\/\/|artifact\.|run-\d|\.json|\.[a-z0-9]{6,})/iu.test(text)
  );
}

function conciseArtifactLabel(row) {
  const label = String(row?.label ?? "").trim();
  const status = String(row?.status ?? "").toLowerCase();
  if (label && !looksLikeTechnicalRef(label)) {
    if (status === "missing") return label.replace(/\s+missing$/iu, "") || label;
    if (status === "unreadable") return label.replace(/\s+unreadable$/iu, "") || label;
    return label;
  }

  const semanticTitle = semanticArtifactTitleFromRef(row?.rawRef ?? row?.ref ?? row?.sourceRef ?? "");
  if (semanticTitle) return semanticTitle;

  const kindLabel = ARTIFACT_TYPE_LABELS[String(row?.kind ?? "").toLowerCase()];
  if (kindLabel) return kindLabel;

  const stage = humanizeToken(row?.stage);
  const kind = humanizeToken(row?.kind);
  if (status === "missing") return `${stage ? `${stage} ` : ""}Evidence Missing`.trim();
  if (stage && kind && stage.toLowerCase() !== kind.toLowerCase()) return `${stage} ${kind}`;
  return kind || stage || "Evidence Artifact";
}

function providerEvidenceStripSummary(rows) {
  const items = Array.isArray(rows) ? rows : [];
  if (items.length === 0) return "No linked refs";
  const counts = items.reduce(
    (current, row) => {
      const status = String(row?.status ?? "ready").toLowerCase();
      if (status === "missing") return { ...current, missing: current.missing + 1 };
      if (status === "unreadable") return { ...current, unreadable: current.unreadable + 1 };
      return { ...current, readable: current.readable + 1 };
    },
    { readable: 0, missing: 0, unreadable: 0 },
  );
  const parts = [
    counts.readable > 0 ? `${counts.readable} readable` : "",
    counts.missing > 0 ? `${counts.missing} missing` : "",
    counts.unreadable > 0 ? `${counts.unreadable} unreadable` : "",
  ].filter(Boolean);
  return `${parts.join(", ")} ref${items.length === 1 ? "" : "s"}`;
}

function artifactActionLabel(action, row) {
  const artifact = conciseArtifactLabel(row);
  if (action === "copy") return `Copy raw ref for ${artifact}`;
  if (action === "attach") return `Attach as request target: ${artifact}`;
  return `Open evidence artifact: ${artifact}`;
}

function graphNodeArtifactLabel(node) {
  return conciseArtifactLabel({
    label: node?.display_summary?.label ?? node?.label,
    kind: node?.display_summary?.type ?? node?.kind ?? node?.family,
    stage: node?.display_summary?.stage ?? node?.stage,
    status: node?.display_summary?.status ?? node?.status,
  });
}

function traceArtifactLabel(item) {
  return conciseArtifactLabel({
    label: item?.display_summary?.label ?? item?.summary,
    kind: item?.display_summary?.type ?? item?.kind ?? item?.event_type,
    stage: item?.display_summary?.stage ?? item?.stage,
    status: item?.display_summary?.status ?? item?.status,
  });
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
  if (value.includes("next-action")) return "next-action";
  if (value.includes("adapter-live") || (value.includes("provider") && (value.includes("raw") || value.includes("evidence")))) return "provider-raw-evidence";
  if (value.includes("agent-decision-request") || value.includes("operator-decision-request")) return "operator-request";
  if (value.includes("step-observation") || value.includes("observation-report")) return "step-observation";
  if (value.includes("runtime-harness-report")) return "runtime-harness-report";
  if (value.includes("quality-repair-request")) return "quality-repair-request";
  if (value.includes("quality-assessment-report")) return "quality-assessment-report";
  if (value.includes("quality-assessment-request")) return "quality-assessment-request";
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
  if (type === "next-action") return "planning";
  if (["provider-raw-evidence", "command-trace", "step-observation", "routed-step-result"].includes(type)) return "execution";
  if (["runtime-harness-report", "review-report", "review-decision", "quality-repair-request", "quality-assessment-report", "quality-assessment-request"].includes(type)) return "runtime-harness";
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
    decision_rubric_summary: raw.decision_rubric_summary ?? fallback.decision_rubric_summary ?? null,
    rejection_reason: raw.rejection_reason ?? raw.operator_decision_rejection_reason ?? fallback.rejectionReason ?? fallback.rejection_reason ?? "",
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
    decisionRubricSummary: normalized.decision_rubric_summary,
    rejectionReason: normalized.rejection_reason,
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

function artifactRowText(row) {
  return `${row?.ref ?? ""} ${row?.sourceRef ?? ""} ${row?.rawRef ?? ""} ${row?.label ?? ""} ${row?.kind ?? ""} ${row?.stage ?? ""} ${row?.summary ?? ""}`.toLowerCase();
}

function artifactRowsForTokens(rows, tokens) {
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const haystack = artifactRowText(row);
    return tokens.some((token) => haystack.includes(token));
  });
}

function qualityClosureStep(rows, options) {
  const matched = artifactRowsForTokens(rows, options.tokens);
  const first = matched[0] ?? null;
  return {
    id: options.id,
    label: options.label,
    status: matched.length > 0 ? "ready" : "blocked",
    title: matched.length > 0 ? `${matched.length} ${options.readyNoun}${matched.length === 1 ? "" : "s"}` : options.missingTitle,
    detail: matched.length > 0
      ? `${options.readyDetail} First visible artifact: ${first ? conciseArtifactLabel(first) : options.readyNoun}.`
      : options.missingDetail,
  };
}

function qualityClosurePlan(rows, context = {}) {
  const steps = [
    qualityClosureStep(rows, {
      id: "review",
      label: "Review / QA",
      tokens: ["review-report", "review-decision", "quality-repair", " qa ", "qa-", "-qa", " qa"],
      readyNoun: "review artifact",
      readyDetail: "Review or QA evidence is visible for outcome inspection.",
      missingTitle: "Review evidence missing",
      missingDetail: "Run review or QA before treating delivery as quality-closed.",
    }),
    qualityClosureStep(rows, {
      id: "verification",
      label: "Verification / Delivery",
      tokens: ["verify-summary", "verification", "validation-report", "evaluation-report", "runtime-harness-report", "delivery-plan", "delivery-manifest", "release-packet"],
      readyNoun: "gate artifact",
      readyDetail: "Deterministic gate or delivery evidence is visible.",
      missingTitle: "Gate evidence missing",
      missingDetail: "Run required verification, review, or delivery preparation before approval.",
    }),
    qualityClosureStep(rows, {
      id: "assessment",
      label: "Assessment",
      tokens: ["quality-assessment", "assessment-report", "assessment request"],
      readyNoun: "assessment artifact",
      readyDetail: "Assessment evidence is visible for quality judgement.",
      missingTitle: "Assessment evidence missing",
      missingDetail: "Run or attach the outcome assessment before claiming product-quality closure.",
    }),
  ];
  if (context?.publicRepairDecision) {
    const heldSteps = steps.map((step) => (
      step.id === "assessment"
        ? {
          ...step,
          status: "blocked",
          title: "Held until repair",
          detail: "Request repair with failed verification evidence, then rerun required verification before outcome assessment.",
        }
        : step
    ));
    return {
      status: "blocked",
      heading: "Quality closure is blocked by repair",
      detail: "The current safe step is the public repair decision; assessment comes after repair and required verification pass.",
      steps: heldSteps,
    };
  }
  const readyCount = steps.filter((step) => step.status === "ready").length;
  return {
    status: readyCount === steps.length ? "ready" : "blocked",
    heading: readyCount === steps.length ? "Quality closure evidence is visible" : "Quality closure still needs evidence",
    detail: "Run-health is factual status. Use review, verification, delivery, and assessment artifacts before judging outcome quality.",
    steps,
  };
}

function missionIdFromTitle(title) {
  const base = String(title ?? "flow").toLowerCase().replace(/[^a-z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "");
  return `${base || "flow"}-${Date.now().toString(36)}`;
}

function interactionKey(interaction) {
  return `${interaction.run_id ?? "run"}:${interaction.interaction_id ?? "interaction"}`;
}

function interactionDomId(interaction, suffix) {
  return `${interactionKey(interaction)}:${suffix}`.replace(/[^a-zA-Z0-9_-]/gu, "-");
}

function interactionAnswerChoiceLabel(answer) {
  const decision = String(answer?.decision ?? "").trim();
  const freeform = String(answer?.answer ?? "").trim();
  if (decision && freeform) return `${decision} with note`;
  if (decision) return decision;
  if (freeform) return "Free-form answer";
  return "Choose answer type or write a reason";
}

function interactionRecoveryPlan(interaction, answer) {
  const hasAnswer = Boolean(String(answer?.decision ?? "").trim() || String(answer?.answer ?? "").trim());
  return {
    promptSummary: interaction?.prompt_summary ?? "Runtime requested input",
    interactionType: interaction?.interaction_type ?? "runtime question",
    evidenceLabel: titleFromRef(interaction?.step_result_ref),
    answerChoice: interactionAnswerChoiceLabel(answer),
    submitState: hasAnswer ? "Ready to submit" : "Answer required",
    submitCopy: "Submit Answer writes an audit ref, refreshes run status, and lets the flow continue from public control-plane evidence.",
  };
}

function requestReadinessItems({ flow, completed, form, targetStep, flowMissing, targetRefsMissing, requestTextMissing, scopeMissing, readOnlyAllowed }) {
  const targetRefCount = splitRefs(form.targetRefs).length;
  const allowedPathCount = splitRefs(form.allowedPaths).length;
  return [
    {
      key: "flow",
      label: "Flow",
      ready: !flowMissing,
      title: flowMissing ? "Select active flow" : flowDisplayName(flow),
      detail: flowMissing ? "Ask AOR needs a selected active flow before it can create request evidence." : "The request will carry target_flow_id.",
    },
    {
      key: "request",
      label: "Request",
      ready: !requestTextMissing,
      title: requestTextMissing ? "Write request text" : "Request text ready",
      detail: requestTextMissing ? "Describe the analysis, proposal, validation, review, or repair question." : `Compiled into the ${targetStep} step.`,
    },
    {
      key: "targets",
      label: "Target refs",
      ready: !targetRefsMissing,
      title: targetRefsMissing ? "Attach evidence or file refs" : `${targetRefCount} target ref${targetRefCount === 1 ? "" : "s"}`,
      detail: targetRefsMissing ? "Add at least one ref so the request is auditable and flow-scoped." : "Targets define what AOR may inspect.",
    },
    {
      key: "scope",
      label: "Scope",
      ready: !scopeMissing,
      title: scopeMissing ? "Allowed paths required" : form.deliveryMode === "no-write" ? "No-write scope" : `${allowedPathCount} allowed path${allowedPathCount === 1 ? "" : "s"}`,
      detail: scopeMissing ? "Non-no-write requests need explicit allowed paths before submit." : "Bounded execution remains explicit.",
    },
    {
      key: "mode",
      label: "Mode",
      ready: readOnlyAllowed,
      title: readOnlyAllowed ? form.deliveryMode : "Use no-write inspection",
      detail: completed && !readOnlyAllowed ? "Completed flows only allow no-write analyze, explain, review, or validate requests." : "Delivery mode is compatible with the selected flow state.",
    },
  ];
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
  if (["blocked", "fail", "failed", "error", "critical", "interrupted", "recovery-needed", "repair-required"].includes(normalized)) return "danger";
  if (
    normalized.includes("blocked")
    || normalized.includes("failed")
    || normalized.includes("error")
    || normalized.includes("critical")
    || normalized.includes("recovery")
    || normalized.includes("repair")
  ) return "danger";
  return "warn";
}

function StatusPill({ state }) {
  return <span className={`status-pill ${statusTone(state)}`}>{state}</span>;
}

function headingRepeatsStatus(heading, status) {
  const title = String(heading ?? "").trim().toLowerCase();
  const value = String(status ?? "").trim().toLowerCase().replace(/[_-]+/gu, " ");
  if (!title || !value) return false;
  const normalizedStatus = value === "fail" ? "failed" : value;
  return title === normalizedStatus || title.endsWith(` ${normalizedStatus}`);
}

function groupStatusValue(group) {
  return group?.outcome ?? group?.status ?? group?.last_result_status ?? "planned";
}

function isFailedVerificationStatus(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "failed" || normalized === "fail" || normalized === "error" || normalized === "not_pass";
}

function failedRequiredVerificationGroups(verificationPlan) {
  const groups = Array.isArray(verificationPlan?.command_groups) ? verificationPlan.command_groups : [];
  return groups.filter((group) => {
    const enforcement = String(group?.enforcement ?? "").trim().toLowerCase();
    return enforcement === "required" && isFailedVerificationStatus(groupStatusValue(group));
  });
}

function verificationGroupTitle(group) {
  const role = group?.role ?? "verification";
  const phase = group?.phase ?? "post-change";
  return `${role} / ${phase}`;
}

function verificationGroupFailureDetail(group) {
  const failedCount = Number(group?.failed_command_count ?? 0);
  const commandCount = Number(group?.command_count ?? 0);
  if (failedCount > 0 && commandCount > 0) return `${failedCount} failed of ${commandCount} commands`;
  if (failedCount > 0) return `${failedCount} failed command${failedCount === 1 ? "" : "s"}`;
  return `${group?.id ?? "verification group"} / ${commandCount || 0} commands`;
}

function firstFailedStepResultRef(group) {
  const failedRefs = Array.isArray(group?.failed_step_result_refs) ? group.failed_step_result_refs : [];
  if (failedRefs.length > 0) return failedRefs[0];
  const refs = Array.isArray(group?.step_result_refs) ? group.step_result_refs : [];
  return refs[0] ?? "";
}

function latestRequiredVerificationFailed(plan, failures = null) {
  const failureRows = Array.isArray(failures) ? failures : failedRequiredVerificationGroups(plan);
  return failureRows.length > 0 && isFailedVerificationStatus(plan?.latest_verify_status ?? plan?.status);
}

function verificationFailureSummary(plan, failures) {
  if (!latestRequiredVerificationFailed(plan, failures)) return null;
  const firstFailure = failures[0];
  const detail = firstFailure ? verificationGroupFailureDetail(firstFailure) : "required verification failed";
  const blockedNextStep = firstFailure?.blocked_next_step;
  return blockedNextStep
    ? `Post-run verification failed: ${detail}. ${blockedNextStep}`
    : `Post-run verification failed: ${detail}. Inspect failed step-result evidence before repair, review, QA, or delivery.`;
}

function verificationFailureBlocker(group, index) {
  const title = verificationGroupTitle(group);
  return {
    code: group?.id ?? `required-verification-${index + 1}`,
    summary: `Required verification failed: ${title} (${verificationGroupFailureDetail(group)})`,
  };
}

function verificationFailureRerunCommand(plan) {
  const label = String(plan?.verification_label ?? "post-run-primary").trim() || "post-run-primary";
  return `aor project verify --verification-label ${label} (--project-ref, --runtime-root)`;
}

function verificationFailureRepairDecisionCommand() {
  return "aor review decide --decision request-repair --repair-context-file <repair-context.json> (--project-ref, --runtime-root, --run-id)";
}

function qualityGateRepairAttemptsExhausted(gate) {
  const remaining = Number(gate?.attempt_budget?.remaining_attempts);
  return Number.isFinite(remaining) && remaining <= 0;
}

function verificationFailurePrimaryAction(plan, failures, heldAction, qualityGate = null) {
  if (!Array.isArray(failures) || failures.length === 0) return null;
  const firstFailure = failures[0];
  const firstTitle = verificationGroupTitle(firstFailure);
  const failureCount = failures.length;
  const groupLabel = `${failureCount} required command group${failureCount === 1 ? "" : "s"}`;
  const summaryRef = plan?.latest_summary_ref ?? plan?.latest_summary_file;
  const failedRef = firstFailedStepResultRef(firstFailure);
  const evidenceCopy = summaryRef
    ? "Inspect the verify summary and failed step-result evidence"
    : "Inspect the failed step-result logs";
  const blockedNextStep = firstFailure?.blocked_next_step;
  const heldActionIsCompletedRepair = heldAction?.action_id === "quality-repair-run-completed";
  const repairAttemptsExhausted = qualityGateRepairAttemptsExhausted(qualityGate);
  if (repairAttemptsExhausted) {
    return {
      action_id: "request-repair-after-verification-failure",
      action_label: "Operator repair decision",
      command: verificationFailureRepairDecisionCommand(),
      dry_run_label: "Verification rerun after repair",
      dry_run_command: verificationFailureRerunCommand(plan),
      held_action_label: heldAction?.command && !heldActionIsCompletedRepair ? actionCommandTitle(heldAction) : null,
      reason: `${groupLabel} failed (${firstTitle}) and no automatic repair attempts remain. Prepare a new public request-repair decision only with the failed verification evidence and new repair context; rerun verification after that repair completes.`,
    };
  }
  return {
    action_id: "resolve-required-verification-failure",
    action_label: "Fix failed verification first",
    command: verificationFailureRerunCommand(plan),
    dry_run_label: "Verification rerun after fix",
    dry_run_command: verificationFailureRerunCommand(plan),
    held_action_label: heldAction?.command && !heldActionIsCompletedRepair ? actionCommandTitle(heldAction) : null,
    reason: `${groupLabel} failed (${firstTitle}). ${evidenceCopy}${failedRef ? ` (${compactVisibleValue(failedRef)})` : ""}. ${blockedNextStep ?? "Fix the target change or command prerequisite first, then rerun verification before review, QA, or delivery."}`,
  };
}

function publicRepairDecisionAction(nextAction, qualityGate = null, verificationPlan = null) {
  const verificationFailures = failedRequiredVerificationGroups(verificationPlan);
  const heldAction = nextAction?.primary_action && typeof nextAction.primary_action === "object"
    ? nextAction.primary_action
    : nextAction;
  const action = verificationFailurePrimaryAction(verificationPlan, verificationFailures, heldAction, qualityGate);
  return action?.action_id === "request-repair-after-verification-failure" ? action : null;
}

function verificationFailureRecoveryPlan(plan, failures, heldAction, qualityGate = null) {
  const firstFailure = Array.isArray(failures) ? failures[0] : null;
  const failureCount = Array.isArray(failures) ? failures.length : 0;
  const failedGroupLabel = `${failureCount} required command group${failureCount === 1 ? "" : "s"}`;
  const summaryRef = plan?.latest_summary_ref ?? plan?.latest_summary_file ?? "";
  const repairAttemptsExhausted = qualityGateRepairAttemptsExhausted(qualityGate);
  return {
    failedGroupLabel,
    firstFailureTitle: firstFailure ? verificationGroupTitle(firstFailure) : "Required verification",
    heldActionLabel: heldAction?.command ? actionCommandTitle(heldAction) : "Review, QA, or delivery",
    repairAttemptsExhausted,
    repairDecisionCommand: verificationFailureRepairDecisionCommand(),
    proofLabel: summaryRef ? "Verify summary" : "Verify summary pending",
    rerunCommand: verificationFailureRerunCommand(plan),
    summaryRef,
  };
}

function asProviderStepStatus(value) {
  return value && typeof value === "object" && !Array.isArray(value) && value.status ? value : null;
}

function asExternalRunHealth(value) {
  return value && typeof value === "object" && !Array.isArray(value) && value.status ? value : null;
}

function isActiveProviderStepStatus(status) {
  return Boolean(status && !["completed", "failed", "interrupted"].includes(status.status));
}

function isTerminalProviderStepStatus(status) {
  return Boolean(status && ["completed", "failed", "interrupted"].includes(status.status));
}

function isProviderStepDisplayStatus(status) {
  return isActiveProviderStepStatus(status) || isTerminalProviderStepStatus(status);
}

function isBlockingExternalRunHealth(health) {
  return Boolean(health && ["blocked", "fail", "failed", "not_pass"].includes(String(health.status ?? "").toLowerCase()));
}

function externalRunHealthHasMaterializedDecisionRequest(health) {
  const pending = health?.pending_decision && typeof health.pending_decision === "object" ? health.pending_decision : {};
  return Boolean(
    String(pending.request_ref ?? "").trim()
    || String(pending.expected_decision_ref ?? "").trim()
    || String(health?.agent_decision_request_ref ?? "").trim()
  );
}

function externalRunHealthHasOpenDecisionRequest(health) {
  if (!externalRunHealthHasMaterializedDecisionRequest(health)) return false;
  const pending = health?.pending_decision && typeof health.pending_decision === "object" ? health.pending_decision : {};
  const status = normalizeOperatorDecisionStatus(
    pending.status ?? pending.operator_decision_status ?? health?.resume_interaction_health?.status ?? "awaiting-decision",
    "awaiting-decision",
  );
  return isOpenOperatorDecisionStatus(status);
}

function activeProviderSupersedesExternalRunBlocker(health, status) {
  if (!isProviderStepDisplayStatus(status) || !isBlockingExternalRunHealth(health)) return false;
  if (isStepQualityAssessmentPendingRunHealth(health)) return false;
  const pending = health?.pending_decision && typeof health.pending_decision === "object" ? health.pending_decision : {};
  if (String(pending.action ?? "").trim() !== "continue") return false;
  if (isTerminalProviderStepStatus(status) && externalRunHealthHasMaterializedDecisionRequest(health)) return false;
  const currentStep = String(health?.current_step ?? health?.blocked_step_id ?? "").trim();
  const nextStep = String(pending.next_step ?? "").trim();
  if (!currentStep || !nextStep) return true;
  if (currentStep === nextStep) return true;
  return PROJECT_STAGE_TO_UI_STAGE[currentStep] === PROJECT_STAGE_TO_UI_STAGE[nextStep];
}

function displayExternalRunHealth(health, status) {
  if (!activeProviderSupersedesExternalRunBlocker(health, status)) return health;
  return {
    ...health,
    status: status?.status ?? "running",
    pending_decision: null,
    blockers: [],
    missing_operator_decision_steps: [],
    failure_summary: null,
    resume_interaction_health: {
      ...(health?.resume_interaction_health && typeof health.resume_interaction_health === "object"
        ? health.resume_interaction_health
        : {}),
      status: status?.status ?? "running",
      pending_decision_count: 0,
    },
  };
}

function externalRunStepLabel(step) {
  const normalized = String(step ?? "").trim();
  if (!normalized) return "Controller";
  if (normalized.toLowerCase() === "qa") return "QA";
  return normalized
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

const GENERIC_EXTERNAL_RUN_FAILURE_SUMMARIES = new Set([
  "Run artifacts declared a primary failure owner, phase, or class.",
  "Target setup or target verification failed during the run.",
]);

const EXTERNAL_RUN_PRIVATE_DISPLAY_LABEL = ["Live", "E2E"].join(" ");
const EXTERNAL_DECISION_OPERATOR_LABEL = ["Skill", "agent"].join("-");

const GENERIC_EXTERNAL_RUN_PENDING_DECISION_REASONS = new Set([
  `${EXTERNAL_DECISION_OPERATOR_LABEL} operator decision is required before continuation.`,
  `${EXTERNAL_DECISION_OPERATOR_LABEL} operator decision is required before the next public step.`,
]);

const EXTERNAL_RUN_FAILURE_CLASS_COPY = {
  compiled_context_budget_exceeded: "compiled context budget exceeded",
  guided_browser_task_proof_missing: "guided browser proof missing",
  "no-op": "no code change produced",
  post_run_diagnostic_failed: "post-run diagnostic failed",
  provider_context_window_exceeded: "provider context window exceeded",
  provider_work_packet_not_executed: "provider work packet was not executed",
  qa_repair_loop_exhausted: "QA repair loop exhausted",
  repeated_repair_context_without_new_evidence: "repeated repair context without new evidence",
  review_quality_not_approved: "review quality not approved",
  review_repair_loop_exhausted: "review repair loop exhausted",
  target_verification_failed: "target verification failed",
  verification_mapping_gap: "verification mapping gap",
};

function externalRunPhrase(value) {
  return String(value ?? "")
    .trim()
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ");
}

function externalRunFailureOwnerLabel(owner) {
  switch (String(owner ?? "").trim()) {
    case "aor":
      return "AOR";
    case "environment":
      return "Environment";
    case "operator":
      return "Operator";
    case "provider":
      return "Provider";
    case "target_repository":
      return "Target repository";
    default:
      return "Run";
  }
}

function externalRunFailureClassLabel(failureClass) {
  const normalized = String(failureClass ?? "").trim();
  return EXTERNAL_RUN_FAILURE_CLASS_COPY[normalized] ?? externalRunPhrase(normalized || "evidence blocker");
}

function isGenericExternalRunFailureSummary(summary) {
  const normalized = String(summary ?? "").trim();
  const lower = normalized.toLowerCase();
  return !normalized
    || GENERIC_EXTERNAL_RUN_FAILURE_SUMMARIES.has(normalized)
    || isStepQualityAssessmentCompletionSummary(normalized)
    || lower.includes(`${EXTERNAL_RUN_PRIVATE_DISPLAY_LABEL.toLowerCase()} observation is still in progress`)
    || lower.includes("requires a terminal controller decision");
}

function isStepQualityAssessmentCompletionSummary(summary) {
  const normalized = String(summary ?? "").trim();
  return /^[a-z0-9_-]+ product-change step[- ]quality was assessed from \d+ public evaluator input refs?\.$/iu.test(normalized);
}

function externalRunStepQualityAssessmentPendingSummary(health) {
  const pendingReason = typeof health?.pending_decision?.reason === "string" ? health.pending_decision.reason.trim() : "";
  const findingSummaries = Array.isArray(health?.run_findings)
    ? health.run_findings.map((finding) => typeof finding?.summary === "string" ? finding.summary.trim() : "")
    : [];
  return [pendingReason, ...findingSummaries].find((summary) => {
    const lower = summary.toLowerCase();
    return lower.includes("step-quality assessment")
      || lower.includes("step quality assessment")
      || lower.includes("evaluator-authored step-quality")
      || lower.includes("evaluator authored step quality");
  }) ?? "";
}

function isStepQualityAssessmentPendingRunHealth(health) {
  return Boolean(externalRunStepQualityAssessmentPendingSummary(health));
}

function isControllerDecisionPendingRunHealth(health) {
  if (isStepQualityAssessmentPendingRunHealth(health)) return false;
  const failure = health?.failure_summary && typeof health.failure_summary === "object" ? health.failure_summary : {};
  const failureClass = String(failure.class ?? "").trim();
  const failureOwner = String(failure.owner ?? "").trim();
  const failurePhase = String(failure.phase ?? "").trim();
  const rawSummary = typeof failure.summary === "string" ? failure.summary.trim() : "";
  return failureClass === "controller_incomplete"
    && failureOwner === "operator"
    && failurePhase === "controller_decision"
    && isGenericExternalRunFailureSummary(rawSummary);
}

function externalRunHealthRecoverySentences(health) {
  if (!health) return [];
  const missingDecisionSteps = Array.isArray(health.missing_operator_decision_steps)
    ? health.missing_operator_decision_steps
    : [];
  const missingEvidenceRefs = Array.isArray(health.missing_evidence_refs)
    ? health.missing_evidence_refs
    : [];
  const sentences = [];
  if (missingDecisionSteps.length > 0) {
    const stepsLabel = missingDecisionSteps.map(externalRunStepLabel).join(", ");
    sentences.push(acceptedExternalRunContinueDecision(health)
      ? externalRunContinuationDecisionCopy(health, stepsLabel)
      : externalRunHasSubstantiveFailureSummary(health)
      ? `Record the ${stepsLabel} blocker decision${missingDecisionSteps.length === 1 ? "" : "s"} before retrying or continuing.`
      : `Accept the ${stepsLabel} operator decision${missingDecisionSteps.length === 1 ? "" : "s"} before continuing.`);
  }
  if (missingEvidenceRefs.length > 0) {
    sentences.push(missingRunHealthEvidenceSentence(missingEvidenceRefs));
  }
  return sentences;
}

function missingRunHealthEvidenceSentence(missingEvidenceRefs) {
  const refs = Array.isArray(missingEvidenceRefs) ? missingEvidenceRefs : [];
  const count = refs.length || 1;
  const noun = count === 1 ? "reference" : "references";
  const syntheticCount = refs.filter((ref) => /^missing-ref-\d+$/u.test(String(ref ?? "").trim())).length;
  if (syntheticCount === count) {
    return `Run-health has ${count} unresolved evidence ${noun}; inspect the run-health report before continuing.`;
  }
  return `Review and repair ${count} missing run-health evidence ${noun} before continuing.`;
}

function externalRunFailureUserSummary(health) {
  const recoverySummary = externalRunRecoveryPathUserSummary(health);
  if (recoverySummary) return recoverySummary;
  if (acceptedExternalRunDiagnosis(health)) {
    return externalRunPendingDecisionUserReason(health);
  }
  const assessmentSummary = externalRunStepQualityAssessmentPendingSummary(health);
  if (assessmentSummary) return assessmentSummary;
  const failure = health?.failure_summary ?? {};
  const rawSummary = typeof failure.summary === "string" ? failure.summary.trim() : "";
  const actionableDecisionSummary = externalRunActionableDecisionUserSummary(health);
  if (actionableDecisionSummary && isGenericExternalRunFailureSummary(rawSummary)) {
    return actionableDecisionSummary;
  }
  if (!isGenericExternalRunFailureSummary(rawSummary)) return rawSummary;
  const phase = failure.phase ? externalRunStepLabel(failure.phase) : externalRunStepLabel(health?.current_step ?? health?.blocked_step_id);
  const owner = externalRunFailureOwnerLabel(failure.owner);
  const failureClass = String(failure.class ?? "").trim();
  if (failureClass === "verification_mapping_gap" && String(failure.phase ?? "") === "review") {
    return "Review evidence did not connect the provider change to verification results.";
  }
  if (failureClass === "controller_incomplete") {
    return externalRunPendingDecisionUserReason(health) ?? "Review the operator decision request before continuing.";
  }
  const classLabel = externalRunFailureClassLabel(failureClass);
  return `${phase} evidence is blocked by ${owner.toLowerCase()} ${classLabel}.`;
}

function externalRunHealthUserSummary(health) {
  return [...new Set([
    externalRunFailureUserSummary(health),
    ...externalRunHealthRecoverySentences(health),
  ].filter(Boolean))].join(" ");
}

function acceptedExternalRunDecisionStatus(pendingDecision) {
  const status = String(pendingDecision?.operator_decision_status ?? pendingDecision?.status ?? "").trim().toLowerCase();
  return status === "accepted" || status === "answered" || status === "completed" || status === "resolved";
}

function externalRunRepairCommand(pendingDecision) {
  return String(pendingDecision?.public_repair_command ?? pendingDecision?.quality_assessment?.public_repair_command ?? "").trim();
}

function acceptedExternalRunDiagnosis(health, pendingDecision = health?.pending_decision) {
  return String(pendingDecision?.action ?? "").trim() === "diagnose" && acceptedExternalRunDecisionStatus(pendingDecision);
}

function acceptedExternalRunContinueDecision(health, pendingDecision = health?.pending_decision) {
  return String(pendingDecision?.action ?? "").trim() === "continue" && acceptedExternalRunDecisionStatus(pendingDecision);
}

function externalRunHasFailureSummary(health) {
  const failure = health?.failure_summary && typeof health.failure_summary === "object" ? health.failure_summary : {};
  return Boolean(
    String(failure.summary ?? "").trim() ||
    String(failure.class ?? "").trim() ||
    String(failure.owner ?? "").trim() ||
    String(failure.phase ?? "").trim(),
  );
}

function externalRunHasSubstantiveFailureSummary(health) {
  return externalRunHasFailureSummary(health)
    && !isControllerDecisionPendingRunHealth(health)
    && !isStepQualityAssessmentPendingRunHealth(health);
}

function externalRunRecoveryPathActive(health, pendingDecision = health?.pending_decision) {
  if (!isBlockingExternalRunHealth(health)) return false;
  if (isStepQualityAssessmentPendingRunHealth(health) || isControllerDecisionPendingRunHealth(health)) return false;
  if (externalRunHealthHasOpenDecisionRequest(health)) return false;
  if (acceptedExternalRunDiagnosis(health, pendingDecision)) return true;

  const action = String(pendingDecision?.action ?? "").trim();
  const qualityAssessmentStatus = String(
    pendingDecision?.quality_assessment_status ??
    pendingDecision?.quality_assessment?.status ??
    "",
  ).trim();
  if (["request-repair", "request_repair", "retry", "retry_public_step"].includes(action)) return true;
  if (action === "diagnose" && (qualityAssessmentStatus === "request_repair" || externalRunRepairCommand(pendingDecision))) {
    return true;
  }

  const failure = health?.failure_summary && typeof health.failure_summary === "object" ? health.failure_summary : {};
  const failurePhase = String(failure.phase ?? "").trim();
  const failureClass = String(failure.class ?? "").trim();
  return externalRunHasSubstantiveFailureSummary(health)
    && (failurePhase === "target_verification" || failureClass === "target_verification_failed" || failureClass === "verification_mapping_gap");
}

function externalRunRecoveryPathUserSummary(health, pendingDecision = health?.pending_decision) {
  if (!externalRunRecoveryPathActive(health, pendingDecision)) return null;
  const stepLabel = externalRunStepLabel(health?.current_step ?? health?.blocked_step_id);
  const repairCommand = externalRunRepairCommand(pendingDecision);
  if (repairCommand) {
    return `Run the ${stepLabel} repair path through public AOR controls (${repairCommand}) before retrying or continuing.`;
  }
  const action = String(pendingDecision?.action ?? "").trim();
  if (action === "retry" || action === "retry_public_step") {
    return `Retry the ${stepLabel} public step after reviewing the blocker and preserving evidence.`;
  }
  return `Use the ${stepLabel} recovery path to fix failed verification, preserve evidence, and rerun required checks before continuing.`;
}

function externalRunExecutableRepairCommand(health, projectContext = null) {
  const repairCommand = externalRunRepairCommand(health?.pending_decision);
  if (!repairCommand) return "";
  let command = repairCommand;
  command = appendCommandFlag(command, "--project-ref", projectContext?.projectRef);
  command = appendCommandFlag(command, "--project-profile", projectContext?.projectProfileRef);
  command = appendCommandFlag(command, "--runtime-root", projectContext?.runtimeRoot);
  command = appendCommandFlag(command, "--run-id", health?.run_id);
  return command;
}

function shellCommandFlagValue(command, flag) {
  const normalizedFlag = String(flag ?? "").trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!normalizedFlag) return "";
  const match = String(command ?? "").match(new RegExp(`${normalizedFlag}\\s+(?:"([^"]*)"|'([^']*)'|(\\S+))`, "u"));
  return String(match?.[1] ?? match?.[2] ?? match?.[3] ?? "").trim();
}

function materializedQualityRepairRunId(nextAction) {
  const primary = nextAction?.primary_action && typeof nextAction.primary_action === "object"
    ? nextAction.primary_action
    : null;
  if (!isQualityRepairPrimaryAction(primary)) return "";
  return shellCommandFlagValue(primary.command, "--run-id");
}

function materializedQualityRepairCompletion(nextAction, runs = []) {
  const repairRunId = materializedQualityRepairRunId(nextAction);
  if (!repairRunId || !Array.isArray(runs)) return null;
  const run = runs.find((candidate) => String(candidate?.run_id ?? "").trim() === repairRunId);
  if (!run) return null;
  const runStatus = String(run?.run_control_state?.status ?? run?.status ?? "").trim().toLowerCase();
  const providerStatus = String(run?.provider_step_status?.status ?? run?.run_control_state?.provider_step_status?.status ?? "").trim().toLowerCase();
  const completed = runStatus === "completed" || providerStatus === "completed";
  if (!completed) return null;
  return {
    run,
    runId: repairRunId,
    runStatus,
    providerStatus,
    recommendedAction: String(run?.provider_step_status?.recommended_action ?? run?.run_control_state?.provider_step_status?.recommended_action ?? "").trim(),
  };
}

function completedQualityRepairAction(repairCompletion) {
  if (!repairCompletion?.runId) return null;
  const statusCommand = `aor run status --json --run-id ${shellQuoteCommandArg(repairCompletion.runId)}`;
  return {
    action_id: "quality-repair-run-completed",
    action_label: "Repair run completed",
    low_level_command: "run status",
    command: statusCommand,
    dry_run_label: "Completed repair status",
    dry_run_command: statusCommand,
    reason: repairCompletion.recommendedAction || "Repair implementation completed. Continue with post-run verification, then refresh run status.",
    completed_repair_run_id: repairCompletion.runId,
  };
}

function materializedQualityRepairAction(nextAction, repairCompletion = null) {
  const primary = nextAction?.primary_action && typeof nextAction.primary_action === "object"
    ? nextAction.primary_action
    : null;
  if (!primary) return null;
  const actionId = String(primary.action_id ?? "").trim();
  const projectStage = String(nextAction?.project_state?.stage ?? "").trim();
  const hasRepairLineage = Boolean(nextAction?.quality_repair_lineage ?? nextAction?.closure_state?.quality_repair);
  const isRepairAction = isQualityRepairPrimaryAction(primary)
    || projectStage === "repair";
  if (!hasRepairLineage && !isRepairAction) return null;
  const completedAction = completedQualityRepairAction(repairCompletion);
  if (completedAction) return completedAction;
  return {
    ...primary,
    action_label: primary.action_label ?? "Continue repair run",
    dry_run_label: primary.dry_run_label ?? "Repair next-action",
    dry_run_command: primary.dry_run_command ?? primary.command,
    reason: primary.reason ?? "Start the repair run from the latest next-action report, then refresh run status.",
  };
}

function isQualityRepairPrimaryAction(action) {
  const actionId = String(action?.action_id ?? "").trim();
  const command = String(action?.command ?? "").trim();
  return actionId === "quality-repair-run-completed"
    || /(^|-)quality-repair$/u.test(actionId)
    || /^run-.+-quality-repair$/u.test(actionId)
    || (/aor\s+run\s+start/u.test(command) && /\.repair(?:\s|$)/u.test(command));
}

function materializedQualityRepairSummary(nextAction, repairCompletion = null, verificationPlan = null) {
  const verificationFailures = failedRequiredVerificationGroups(verificationPlan);
  const failedVerificationSummary = verificationFailureSummary(verificationPlan, verificationFailures);
  if (repairCompletion?.runId && failedVerificationSummary) return failedVerificationSummary;
  if (repairCompletion?.runId) {
    return repairCompletion.recommendedAction
      ? `Repair run completed. ${repairCompletion.recommendedAction}`
      : "Repair run completed. Continue with post-run verification, then refresh run status.";
  }
  const repairAction = materializedQualityRepairAction(nextAction);
  if (!repairAction) return null;
  return repairAction.reason ?? "Repair request is recorded. Start the repair run from the latest next-action report, then refresh run status.";
}

function externalRunContinuationDecisionCopy(health, stepLabel, pendingDecision = health?.pending_decision) {
  if (acceptedExternalRunContinueDecision(health, pendingDecision)) {
    return `AOR has the ${stepLabel} continue decision. Refresh run status to confirm the controller moved to the next step before starting new work.`;
  }
  return externalRunHasSubstantiveFailureSummary(health)
    ? `Record the ${stepLabel} blocker decision before retrying or continuing.`
    : `Accept the ${stepLabel} operator decision before continuing.`;
}

function isGenericExternalRunPendingDecisionReason(reason) {
  const normalized = String(reason ?? "").trim();
  return GENERIC_EXTERNAL_RUN_PENDING_DECISION_REASONS.has(normalized)
    || isStepQualityAssessmentCompletionSummary(normalized);
}

function externalRunActionableDecisionUserSummary(health) {
  const pendingReason = externalRunPendingDecisionUserReason(health);
  if (pendingReason) return pendingReason;
  const missingDecisionSteps = Array.isArray(health?.missing_operator_decision_steps)
    ? health.missing_operator_decision_steps
    : [];
  if (missingDecisionSteps.length === 0) return null;
  const stepsLabel = missingDecisionSteps.map(externalRunStepLabel).join(", ");
  return externalRunHasSubstantiveFailureSummary(health)
    ? `Record the ${stepsLabel} blocker decision${missingDecisionSteps.length === 1 ? "" : "s"} before retrying or continuing.`
    : `Accept the ${stepsLabel} operator decision${missingDecisionSteps.length === 1 ? "" : "s"} before continuing.`;
}

function externalRunPendingDecisionUserReason(health, pendingDecision = health?.pending_decision) {
  if (!pendingDecision || typeof pendingDecision !== "object") return null;
  const rawReason = typeof pendingDecision.reason === "string" ? pendingDecision.reason.trim() : "";
  const action = String(pendingDecision.action ?? "").trim();
  if (!action) return null;
  const stepLabel = externalRunStepLabel(health?.current_step ?? health?.blocked_step_id);
  const qualityAssessmentStatus = String(pendingDecision.quality_assessment_status ?? "").trim().toLowerCase().replace(/_/gu, "-");
  const repairCommand = externalRunRepairCommand(pendingDecision);
  if (acceptedExternalRunDecisionStatus(pendingDecision) && action === "diagnose") {
    if (qualityAssessmentStatus === "request-repair") {
      return repairCommand
        ? `Diagnosis accepted for ${stepLabel}. Repair is required through public AOR controls (${repairCommand}) before retrying or continuing.`
        : `Diagnosis accepted for ${stepLabel}. Repair is required through public AOR controls before retrying or continuing.`;
    }
    return "Diagnosis accepted for " + stepLabel + ". Keep the run blocked until repair or retry evidence is recorded through public controls.";
  }
  if (acceptedExternalRunContinueDecision(health, pendingDecision)) {
    return externalRunContinuationDecisionCopy(health, stepLabel, pendingDecision);
  }
  if (action === "diagnose" && (qualityAssessmentStatus === "request-repair" || repairCommand)) {
    return `Diagnosis moved ${stepLabel} into repair. Use the public repair path before QA, delivery, or continuation.`;
  }
  if (rawReason && !isGenericExternalRunPendingDecisionReason(rawReason)) return rawReason;
  switch (action) {
    case "answer":
      return `Answer the ${stepLabel} operator question before continuing.`;
    case "block":
      if (isStepQualityAssessmentPendingRunHealth(health)) {
        return `Prepare the ${stepLabel} step-quality assessment before continuing.`;
      }
      return `Record the ${stepLabel} block decision before continuing.`;
    case "continue":
      return externalRunContinuationDecisionCopy(health, stepLabel, pendingDecision);
    case "diagnose":
      if (isControllerDecisionPendingRunHealth(health)) {
        return `Open the ${stepLabel} decision request and record the operator decision before continuing.`;
      }
      return `Open the ${stepLabel} decision request and record the operator diagnosis before continuing.`;
    case "frontend_interact":
      return `Complete the ${stepLabel} browser evidence check before continuing.`;
    case "request-repair":
    case "request_repair":
      return `Run the ${stepLabel} repair path through public AOR controls before continuing.`;
    case "retry":
    case "retry_public_step":
      return `Retry the ${stepLabel} public step after reviewing the blocker.`;
    default:
      return `Record the ${stepLabel} operator decision before continuing.`;
  }
}

function externalRunHealthBlockerSummary(health, blocker, index) {
  const failure = health?.failure_summary ?? {};
  const code = String(blocker?.code ?? "");
  const summary = typeof blocker?.summary === "string" ? blocker.summary.trim() : "";
  const isFailureBlocker = index === 0 && (
    code === String(failure.class ?? "") ||
    summary === String(failure.summary ?? "")
  );
  if (isFailureBlocker) return externalRunFailureUserSummary(health);
  const missingDecisionMatch = code.match(/^run_health\.(.+)\.operator_decision_missing$/u);
  if (missingDecisionMatch) {
    return externalRunContinuationDecisionCopy(health, externalRunStepLabel(missingDecisionMatch[1]));
  }
  const pendingDecisionMatch = code.match(/^run_health\.(.+)\.pending_(.+)$/u);
  if (pendingDecisionMatch) {
    const pendingDecision = {
      ...(health?.pending_decision ?? {}),
      action: pendingDecisionMatch[2],
      reason: summary,
    };
    return externalRunPendingDecisionUserReason({
      ...health,
      current_step: pendingDecisionMatch[1],
    }, pendingDecision) ?? (summary || code);
  }
  if (code === "run_health.missing_evidence") {
    const missingEvidenceRefs = Array.isArray(health?.missing_evidence_refs) ? health.missing_evidence_refs : [];
    return missingRunHealthEvidenceSentence(missingEvidenceRefs);
  }
  return summary || code;
}

function externalRunHealthBlockers(health) {
  if (!health) return [];
  const blockers = Array.isArray(health.blockers)
    ? health.blockers.filter((blocker) => blocker && typeof blocker === "object")
    : [];
  if (blockers.length > 0) {
    return blockers.map((blocker, index) => ({
      ...blocker,
      summary: externalRunHealthBlockerSummary(health, blocker, index),
    }));
  }
  const failureSummary = health.failure_summary ?? {};
  const hasFailureSummary = Boolean(
    failureSummary.summary ||
    failureSummary.class ||
    failureSummary.owner ||
    failureSummary.phase,
  );
  return hasFailureSummary
    ? [{
      code: failureSummary.class ?? "run_health_blocked",
      severity: "critical",
      summary: externalRunFailureUserSummary(health),
    }]
    : [];
}

function providerFocusStageId(status, externalRunHealth = null) {
  if (isBlockingExternalRunHealth(externalRunHealth)) {
    const step = externalRunHealth.current_step ?? externalRunHealth.blocked_step_id;
    return PROJECT_STAGE_TO_UI_STAGE[step] ?? "delivery";
  }
  if (!isTerminalProviderStepStatus(status)) return "implement";
  if (status?.status === "completed") return "review";
  return "implement";
}

function providerFocusTitle(status, externalRunHealth = null) {
  if (isBlockingExternalRunHealth(externalRunHealth)) {
    if (externalRunRecoveryPathActive(externalRunHealth)) {
      return `${externalRunStepLabel(externalRunHealth.current_step ?? externalRunHealth.blocked_step_id)} repair required`;
    }
    if (isStepQualityAssessmentPendingRunHealth(externalRunHealth)) {
      return `${externalRunStepLabel(externalRunHealth.current_step ?? externalRunHealth.blocked_step_id)} assessment needed`;
    }
    if (isControllerDecisionPendingRunHealth(externalRunHealth)) {
      const stepLabel = externalRunStepLabel(externalRunHealth.current_step ?? externalRunHealth.blocked_step_id);
      return acceptedExternalRunContinueDecision(externalRunHealth)
        ? `${stepLabel} decision recorded`
        : `${stepLabel} decision needed`;
    }
    return `${externalRunStepLabel(externalRunHealth.current_step ?? externalRunHealth.blocked_step_id)} blocked`;
  }
  if (status?.status === "completed") return "Review / QA gate ready";
  if (status?.status === "failed") return "Provider run failed";
  if (status?.status === "interrupted") return "Provider run interrupted";
  return "Provider run in progress";
}

function providerFocusDescription(status, externalRunHealth = null, nextAction = null, repairCompletion = null, verificationPlan = null) {
  if (isBlockingExternalRunHealth(externalRunHealth)) {
    return materializedQualityRepairSummary(nextAction, repairCompletion, verificationPlan) ?? externalRunHealthUserSummary(externalRunHealth);
  }
  if (status?.status === "completed") {
    return "Provider execution finished before a flow could be selected. Review validation, review, and QA evidence before delivery.";
  }
  if (status?.status === "failed") {
    return "Provider execution failed before a flow could be selected. Inspect evidence, then diagnose or retry through public controls.";
  }
  if (status?.status === "interrupted") {
    return "Provider execution was interrupted before a flow could be selected. Save partial evidence, then diagnose or retry through public controls.";
  }
  return "Live execution is running from project-level evidence before a flow can be selected.";
}

function providerFocusPrimaryAction(status, externalRunHealth = null, nextAction = null, repairCompletion = null) {
  if (isBlockingExternalRunHealth(externalRunHealth)) {
    if (externalRunRecoveryPathActive(externalRunHealth)) {
      const repairAction = materializedQualityRepairAction(nextAction, repairCompletion);
      if (repairAction) return repairAction;
    }
    const stepLabel = externalRunStepLabel(externalRunHealth.current_step ?? externalRunHealth.blocked_step_id);
    const pending = externalRunHealth.pending_decision ?? {};
    const pendingControllerDecision = isControllerDecisionPendingRunHealth(externalRunHealth);
    const pendingStepAssessment = isStepQualityAssessmentPendingRunHealth(externalRunHealth);
    const recordedContinueDecision = pendingControllerDecision && acceptedExternalRunContinueDecision(externalRunHealth, pending);
    return {
      action_label: pendingStepAssessment
        ? `${stepLabel} assessment request`
        : recordedContinueDecision
          ? `${stepLabel} decision recorded`
          : pendingControllerDecision
          ? `${stepLabel} decision request`
          : externalRunRecoveryPathActive(externalRunHealth, pending)
            ? `Open ${stepLabel} recovery path`
            : `Open ${stepLabel} blocker`,
      command: "aor run status --json",
      dry_run_label: "Run-health",
      dry_run_command: "aor run status --json",
      reason:
        externalRunPendingDecisionUserReason(externalRunHealth, pending) ??
        externalRunHealthUserSummary(externalRunHealth) ??
        (pendingStepAssessment
          ? `${stepLabel} is waiting for step-quality assessment evidence.`
          : recordedContinueDecision
          ? `AOR has the ${stepLabel} continue decision. Refresh run status to confirm the controller moved to the next step.`
          : pendingControllerDecision
          ? `${stepLabel} is waiting for an operator decision.`
          : `${stepLabel} is blocked by run-health evidence.`),
    };
  }
  if (status?.status === "completed") {
    return {
      action_label: "Review QA gate evidence",
      command: "aor run status --json",
      dry_run_label: "Quality gate preview",
      dry_run_command: "aor run status --json",
      reason: "Provider execution is done. Inspect validation warnings, review findings, and QA evidence before deciding delivery readiness.",
    };
  }
  if (status?.status === "failed") {
    return {
      action_label: "Inspect failed provider run",
      command: "aor run status --json",
      reason: providerStatusCopy(status),
    };
  }
  if (status?.status === "interrupted") {
    return {
      action_label: "Save partial evidence",
      command: "aor run status --json",
      reason: providerStatusCopy(status),
    };
  }
  return {
    action_label: "Monitor provider run",
    command: "aor run status --json",
    reason: providerStatusCopy(status),
  };
}

function projectRunEvidenceSelectorLabel(status, externalRunHealth = null) {
  if (isBlockingExternalRunHealth(externalRunHealth)) {
    if (isStepQualityAssessmentPendingRunHealth(externalRunHealth)) {
      return `${externalRunStepLabel(externalRunHealth.current_step ?? externalRunHealth.blocked_step_id)} assessment evidence`;
    }
    if (isControllerDecisionPendingRunHealth(externalRunHealth)) {
      return `${externalRunStepLabel(externalRunHealth.current_step ?? externalRunHealth.blocked_step_id)} decision evidence`;
    }
    if (externalRunRecoveryPathActive(externalRunHealth)) {
      return `${externalRunStepLabel(externalRunHealth.current_step ?? externalRunHealth.blocked_step_id)} recovery evidence`;
    }
    return `${externalRunStepLabel(externalRunHealth.current_step ?? externalRunHealth.blocked_step_id)} blocker evidence`;
  }
  if (externalRunHealth?.status) return "Run evidence";
  if (status) return "Provider run evidence";
  return "No active flow";
}

function projectRunEvidenceStatus(status, externalRunHealth = null) {
  if (isBlockingExternalRunHealth(externalRunHealth)) {
    if (isStepQualityAssessmentPendingRunHealth(externalRunHealth)) return "Run assessment needed";
    if (externalRunRecoveryPathActive(externalRunHealth)) return "Recovery needed";
    if (acceptedExternalRunContinueDecision(externalRunHealth)) return "Run decision recorded";
    return isControllerDecisionPendingRunHealth(externalRunHealth) ? "Run decision needed" : "Run evidence blocked";
  }
  if (externalRunHealth?.status) return `Run evidence ${externalRunHealth.status}`;
  if (status?.status) return `Provider ${status.status}`;
  return "No active flow";
}

function externalRunWorkbenchAction(health, hasOpenDecisionRequest = false) {
  if (isStepQualityAssessmentPendingRunHealth(health)) {
    return { label: "Assessment Evidence", icon: "target", tabId: "evidence" };
  }
  if (isControllerDecisionPendingRunHealth(health)) {
    return { label: hasOpenDecisionRequest ? "Decision Request" : "Decision Evidence", icon: "target", tabId: "decisions" };
  }
  if (isBlockingExternalRunHealth(health)) {
    if (externalRunRecoveryPathActive(health)) {
      return { label: "Recovery Path", icon: "target", tabId: "execution" };
    }
    return hasOpenDecisionRequest
      ? { label: "Decision Request", icon: "target", tabId: "decisions" }
      : { label: "Review Blocker", icon: "target", tabId: "execution" };
  }
  return hasOpenDecisionRequest
    ? { label: "Decision Request", icon: "target", tabId: "decisions" }
    : { label: "Workbench", icon: "target", tabId: "evidence" };
}

function externalRunNewFlowBlockedReason(health) {
  const stepLabel = externalRunStepLabel(health?.current_step ?? health?.blocked_step_id);
  if (isStepQualityAssessmentPendingRunHealth(health)) {
    return `Complete the current ${stepLabel} assessment before starting a new flow.`;
  }
  if (isControllerDecisionPendingRunHealth(health)) {
    if (acceptedExternalRunContinueDecision(health)) {
      return `Wait for the current ${stepLabel} decision to clear before starting a new flow.`;
    }
    return `Record the current ${stepLabel} decision before starting a new flow.`;
  }
  if (externalRunRecoveryPathActive(health)) {
    return "Resolve the current Recovery Path before starting a new flow.";
  }
  return `Resolve the current ${stepLabel} blocker before starting a new flow.`;
}

function externalRunAttentionLabel(health) {
  if (isStepQualityAssessmentPendingRunHealth(health)) return "Assessment checks";
  if (externalRunRecoveryPathActive(health)) return "Recovery checks";
  if (acceptedExternalRunContinueDecision(health)) return "Decision evidence";
  return isControllerDecisionPendingRunHealth(health) ? "Decision checks" : "Blockers";
}

function externalRunAttentionEmptyCopy(health) {
  if (isStepQualityAssessmentPendingRunHealth(health)) {
    return "No assessment checks for the visible next step.";
  }
  if (externalRunRecoveryPathActive(health)) {
    return "No recovery checks for the visible next step.";
  }
  return isControllerDecisionPendingRunHealth(health)
    ? "No decision checks for the visible next step."
    : "No blockers for the visible next step.";
}

function externalRunDerivedEvidenceStatus(health, fallback = "blocked") {
  if (isStepQualityAssessmentPendingRunHealth(health)) return "awaiting-assessment";
  if (externalRunRecoveryPathActive(health)) return "repair-required";
  if (acceptedExternalRunContinueDecision(health)) return "decision-recorded";
  return isControllerDecisionPendingRunHealth(health) ? "awaiting-decision" : fallback;
}

function externalRunRiskLevel(health, blockers, deliveryMode) {
  if (Array.isArray(blockers) && blockers.length > 0) {
    if (isStepQualityAssessmentPendingRunHealth(health)) return "Assessment needed";
    if (acceptedExternalRunContinueDecision(health)) return "Decision recorded";
    return isControllerDecisionPendingRunHealth(health) ? "Decision needed" : "Blocked";
  }
  if (deliveryMode === "read-only") return "Read-only";
  return deliveryMode === "no-write" ? "Low" : "Gated";
}

function projectRunEvidenceIdentity(status, externalRunHealth = null) {
  if (isBlockingExternalRunHealth(externalRunHealth)) {
    return providerFocusTitle(status, externalRunHealth);
  }
  return (
    status?.route_id ??
    status?.step_id ??
    externalRunHealth?.run_id ??
    "run evidence"
  );
}

function formatDurationMs(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "n/a";
  const totalSeconds = Math.floor(value / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function isProviderTerminalStatus(status) {
  return ["completed", "failed", "interrupted"].includes(String(status?.status ?? "").toLowerCase());
}

function formatProviderTimestamp(value, fallback = "No update yet") {
  if (typeof value !== "string" || value.trim().length === 0) return fallback;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Date(parsed).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function providerLastOutputLabel(status) {
  return formatProviderTimestamp(
    status?.last_output_at,
    isProviderTerminalStatus(status) ? "No streamed output captured" : "No update yet",
  );
}

function providerLastProgressLabel(status) {
  return formatProviderTimestamp(
    status?.last_progress_at,
    isProviderTerminalStatus(status) ? "No progress events captured" : "No update yet",
  );
}

function providerActivityLabel(status) {
  return (
    status?.last_progress_label ??
    status?.last_progress_kind ??
    (isProviderTerminalStatus(status) ? "No progress events captured" : "No progress yet")
  );
}

function providerOutputModeLabel(status) {
  return status?.output_mode ?? "Not reported";
}

function isDeliveryStageId(value) {
  return String(value ?? "").trim().toLowerCase() === "delivery";
}

function externalRunProviderGateCopy(health) {
  if (!isBlockingExternalRunHealth(health)) return "";
  const stepLabel = externalRunStepLabel(health?.current_step ?? health?.blocked_step_id);
  if (isStepQualityAssessmentPendingRunHealth(health)) {
    return `Provider execution finished, but ${stepLabel} is waiting for step-quality assessment evidence before review, QA, delivery, or release.`;
  }
  if (acceptedExternalRunContinueDecision(health)) {
    return `Provider execution finished and ${stepLabel} has a recorded continue decision. Refresh run status to confirm the controller advanced before verification, review, QA, delivery, or release.`;
  }
  if (isControllerDecisionPendingRunHealth(health)) {
    return `Provider execution finished, but ${stepLabel} is waiting for an operator decision before verification, review, QA, delivery, or release.`;
  }
  if (externalRunRecoveryPathActive(health)) {
    return `Provider execution finished, but ${stepLabel} recovery is still required before verification, review, QA, delivery, or release.`;
  }
  return `Provider execution finished, but ${stepLabel} run-health is blocked. Resolve the blocker before review, QA, delivery, or release.`;
}

function providerStatusCopy(status, stage = null, verificationFailureActive = false, externalRunHealth = null) {
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
  if (status.status === "completed") {
    const runGateCopy = externalRunProviderGateCopy(externalRunHealth);
    if (runGateCopy) return runGateCopy;
    if (verificationFailureActive) {
      return "Provider execution finished, but required verification failed. Repair the failed verification before review, QA, delivery, or release.";
    }
    return isDeliveryStageId(stage)
      ? "Provider execution finished. Delivery artifacts are ready for final operator acceptance and closure."
      : "Provider execution finished. Review validation, review, and QA evidence before delivery.";
  }
  if (status.status === "interrupted" && status.interruption_owner === "operator") {
    return status.interruption_reason
      ? `Provider was stopped by the operator: ${status.interruption_reason}`
      : "Provider was stopped by the operator. Save partial evidence, then diagnose or retry.";
  }
  if (status.status === "interrupted") return "Provider was stopped or interrupted. Save partial evidence, then diagnose or retry.";
  if (status.status === "failed") return "Provider failed. Inspect evidence before continuing.";
  return "Provider step is running.";
}

function isGenericProviderCommandLabel(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "" || normalized === "external-provider-runner";
}

function providerCommandDisplayLabel(status) {
  const label = String(status?.current_command_label ?? "").trim();
  if (!isGenericProviderCommandLabel(label)) return compactCommandLabel(label);
  if (status?.status === "completed") return "Provider CLI session completed";
  if (status?.status === "failed") return "Provider CLI session failed";
  if (status?.status === "interrupted") return "Provider CLI session interrupted";
  return "Provider CLI session";
}

function providerCommandDetail(status, stage = null, verificationFailureActive = false, externalRunHealth = null) {
  const rawLabel = String(status?.current_command_label ?? "").trim();
  if (!isGenericProviderCommandLabel(rawLabel)) return status?.recommended_action ?? "Track this command through provider evidence.";
  const adapter = status?.adapter ?? "configured provider adapter";
  if (status?.status === "completed") {
    const runGateCopy = externalRunProviderGateCopy(externalRunHealth);
    if (runGateCopy) return `The ${adapter} process finished, but the current run gate remains active. ${runGateCopy.replace(/^Provider execution finished, but\s*/u, "")}`;
    if (verificationFailureActive) {
      return `The ${adapter} process finished, but required verification failed. Repair failed verification before review, QA, delivery, or release.`;
    }
    return isDeliveryStageId(stage)
      ? `The ${adapter} process finished. Inspect delivery artifacts and record the final operator decision before closure.`
      : `The ${adapter} process finished. Continue with verification, review, or the next quality gate.`;
  }
  if (status?.status === "failed") return `The ${adapter} process failed. Inspect provider evidence before retrying or diagnosing.`;
  if (status?.status === "interrupted") return `The ${adapter} process was interrupted. Save partial evidence, then diagnose or retry through public controls.`;
  return `AOR is waiting on the ${adapter} process. Use Activity, Last output, and Last artifact to judge progress.`;
}

function resolveProviderStepStatus(projectState, runs) {
  const fromProject = asProviderStepStatus(projectState?.provider_step_status);
  const fromRuns = Array.isArray(runs)
    ? runs.map((run) => asProviderStepStatus(run.provider_step_status)).filter(Boolean)
    : [];
  return fromRuns.find((status) => isActiveProviderStepStatus(status)) ?? fromProject ?? fromRuns[0] ?? null;
}

function resolveExternalRunHealth(projectState, runs) {
  const fromProject = asExternalRunHealth(projectState?.[RUN_HEALTH_FIELD]);
  const fromRuns = Array.isArray(runs)
    ? runs.map((run) => asExternalRunHealth(run[RUN_HEALTH_FIELD])).filter(Boolean)
    : [];
  return fromRuns.find((health) => isBlockingExternalRunHealth(health)) ?? fromProject ?? fromRuns[0] ?? null;
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

function executionStatusRows(evidence, externalRunHealth = null, verificationPlan = null) {
  const verificationFailures = failedRequiredVerificationGroups(verificationPlan);
  const postRunVerificationStatus = latestRequiredVerificationFailed(verificationPlan, verificationFailures)
    ? "failed"
    : evidence?.post_run_verification_status ?? "unknown";
  const rows = [
    { label: "Provider execution", value: evidence?.provider_execution_status ?? "unknown" },
    { label: "Runtime Harness", value: evidence?.runtime_harness_decision ?? "unknown" },
    { label: "Real code change", value: evidence?.real_code_change_status ?? "unknown" },
    { label: "Post-run verification", value: postRunVerificationStatus },
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
  if (isBlockingExternalRunHealth(externalRunHealth)) {
    rows.unshift({
      label: "Run health",
      value: externalRunDerivedEvidenceStatus(externalRunHealth, externalRunHealth.status ?? "blocked"),
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

function executionRecoveryAction(actions, evidence) {
  const normalizedStatus = String(evidence?.provider_execution_status ?? evidence?.provider_step_status?.status ?? evidence?.status ?? "").toLowerCase();
  const actionList = Array.isArray(actions) ? actions : [];
  const priorities = normalizedStatus === "running" || normalizedStatus === "silent-running" || normalizedStatus === "timeout-risk"
    ? ["save_partial_evidence", "stop_provider", "diagnose_current_step", "retry_public_step"]
    : ["save_partial_evidence", "diagnose_current_step", "retry_public_step", "stop_provider"];
  return priorities
    .map((actionId) => actionList.find((action) => action.action_id === actionId))
    .find((action) => action?.enabled) ?? actionList.find((action) => action?.enabled) ?? actionList[0] ?? null;
}

function executionRecoveryPlan(evidence, providerEvidenceRows, blockers, actions, externalRunHealth = null, projectContext = null, latestNextAction = null, repairCompletion = null, verificationPlan = null, qualityGate = null) {
  if (externalRunRecoveryPathActive(externalRunHealth)) {
    const stepLabel = externalRunStepLabel(externalRunHealth.current_step ?? externalRunHealth.blocked_step_id);
    const healthBlockers = externalRunHealthBlockers(externalRunHealth);
    const verificationFailures = failedRequiredVerificationGroups(verificationPlan);
    const failedVerificationSummary = verificationFailureSummary(verificationPlan, verificationFailures);
    const verificationRecovery = failedVerificationSummary
      ? verificationFailureRecoveryPlan(verificationPlan, verificationFailures, latestNextAction, qualityGate)
      : null;
    const repairAction = materializedQualityRepairAction(latestNextAction, repairCompletion);
    const repairCommand = repairAction?.command
      || externalRunExecutableRepairCommand(externalRunHealth, projectContext)
      || externalRunRepairCommand(externalRunHealth.pending_decision);
    return {
      headingTitle: failedVerificationSummary ? "Post-run verification repair path" : `${stepLabel} repair path`,
      headingDetail: failedVerificationSummary
        ? verificationRecovery?.repairAttemptsExhausted
          ? "The repair run completed and required verification failed; no automatic repair attempts remain, so another repair needs an explicit public decision with new evidence."
          : "The repair run completed, but required verification failed; inspect failed verification evidence before continuing."
        : repairAction
        ? repairCompletion
          ? "Repair implementation has completed; preserve status and continue with post-run verification."
          : "Run the latest repair next-action before retrying or continuing the lifecycle."
        : repairCommand
        ? "Run the public repair command before retrying or continuing the lifecycle."
        : "Use public recovery controls before retrying or continuing the lifecycle.",
      stateTitle: failedVerificationSummary ? "Post-run verification failed" : `${stepLabel} repair required`,
      stateDetail:
        materializedQualityRepairSummary(latestNextAction, repairCompletion, verificationPlan) ??
        externalRunRecoveryPathUserSummary(externalRunHealth) ??
        externalRunHealthUserSummary(externalRunHealth) ??
        "Repair is required before delivery or release can continue.",
      evidenceTitle: failedVerificationSummary
        ? `${verificationFailures.length} failed verification group${verificationFailures.length === 1 ? "" : "s"}`
        : healthBlockers.length > 0
        ? `${healthBlockers.length} recovery check${healthBlockers.length === 1 ? "" : "s"}`
        : "Run-health recovery evidence",
      evidenceDetail: failedVerificationSummary
        ? "Keep the failed verification step-result evidence linked below; use it as repair context before requesting another repair."
        : repairAction
        ? repairCompletion
          ? "The completed repair run is preserved as public run evidence."
          : "Failed verification and repair evidence explain why this repair run is needed."
        : healthBlockers[0]?.summary ?? "Review run-health and verification evidence before applying repair.",
      evidenceRefLabel: failedVerificationSummary ? "Failed step-result evidence" : "",
      evidenceRef: failedVerificationSummary ? firstFailedStepResultRef(verificationFailures[0]) : "",
      actionTitle: failedVerificationSummary
        ? verificationRecovery?.repairAttemptsExhausted
          ? "Request repair with new evidence"
          : "Repair failed verification"
        : repairCompletion ? "Inspect completed repair run" : repairAction ? "Run repair implementation" : repairCommand ? "Run public repair command" : "Inspect recovery evidence",
      actionCommand: failedVerificationSummary
        ? verificationRecovery?.repairAttemptsExhausted
          ? verificationRecovery.repairDecisionCommand
          : verificationRecovery?.rerunCommand ?? verificationFailureRerunCommand(verificationPlan)
        : repairCommand || "aor run status --json",
      actionDetail: failedVerificationSummary
        ? verificationRecovery?.repairAttemptsExhausted
          ? "Use failed verification refs in the repair context. Rerun required verification only after the next repair completes."
          : "Fix the failed target change or command prerequisite first; use this verification command as the unlock check after repair."
        : repairCommand
        ? repairAction
          ? repairCompletion
            ? "Copy this status command, then continue with post-run verification."
            : "Copy this repair next-action command, then refresh run status."
          : "Copy this command into the public AOR repair path, then refresh run status."
        : "Inspect public run-health evidence before choosing retry or continuation.",
    };
  }
  const providerStatus = evidence?.provider_execution_status ?? evidence?.provider_step_status?.status ?? "unknown";
  const runStatus = evidence?.status ?? providerStatus;
  const blockerCount = Array.isArray(blockers) ? blockers.length : 0;
  const providerEvidenceCount = Array.isArray(providerEvidenceRows) ? providerEvidenceRows.length : 0;
  const nextAction = executionRecoveryAction(actions, evidence);
  const actionEnabled = nextAction?.enabled === true;
  return {
    headingTitle: "Stabilize execution evidence first",
    headingDetail: "Use public run controls to preserve evidence, diagnose blockers, or retry before treating delivery as safe.",
    stateTitle: `${providerStatus} / ${runStatus}`,
    stateDetail: blockerCount > 0
      ? `${blockerCount} blocker${blockerCount === 1 ? "" : "s"} must be cleared before delivery or release.`
      : "No blocking execution evidence is listed.",
    evidenceTitle: providerEvidenceCount > 0
      ? `${providerEvidenceCount} provider evidence ref${providerEvidenceCount === 1 ? "" : "s"}`
      : "No provider evidence linked yet",
    evidenceDetail: providerEvidenceCount > 0
      ? "Save or copy linked evidence before diagnosing or retrying."
      : "Refresh run status or save partial evidence before deciding.",
    actionTitle: nextAction?.label ?? EXECUTION_ACTION_LABELS[nextAction?.action_id] ?? "Public recovery action",
    actionCommand: actionEnabled ? executionActionCommand(nextAction, evidence) : "",
    actionDetail: actionEnabled
      ? "Use the public control-plane action before making delivery or release decisions."
      : nextAction?.reason ?? "No public recovery action is currently enabled.",
  };
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
    alert: (
      <>
        <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
        <path d="M12 9v4" />
        <path d="M12 17h.01" />
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
    deliveryMode: followUp ? "no-write" : settings.delivery_mode ?? flow?.writeback_policy?.mode ?? "no-write",
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

function actionDryRunPreview(action) {
  if (action?.dry_run_command) return action.dry_run_command;
  const command = actionCommandLabel(action);
  return command.includes("--dry-run") ? command : `${command} --dry-run`;
}

function actionOutcomeTitle(action, stage, { completed = false, providerFocusActive = false } = {}) {
  const explicitLabel = String(action?.action_label ?? "").trim();
  if (explicitLabel && !/^command$/iu.test(explicitLabel)) return explicitLabel;
  const command = actionCommandLabel(action).toLowerCase();
  if (completed) return "Inspect completed evidence";
  if (providerFocusActive || command.includes("run status")) return "Review run blocker";
  if (command.includes("project init")) return "Initialize local runtime";
  if (command.includes("mission create")) return "Create a no-write flow";
  if (command.includes("discovery")) return "Materialize discovery evidence";
  if (command.includes("spec")) return "Materialize spec evidence";
  if (command.includes("wave")) return "Plan the implementation wave";
  if (command.includes("run start") || command.includes("execution")) return "Start controlled execution";
  if (command.includes("review")) return "Run review and QA gate";
  if (command.includes("delivery")) return "Prepare delivery evidence";
  if (command.includes("release")) return "Prepare release evidence";
  if (command.includes("learning")) return "Close learning evidence";
  return stage?.label ? `Advance ${stage.label}` : "Resolve next action";
}

function actionOutcomeDetail(action, { completed = false, providerFocusActive = false } = {}) {
  const reason = String(action?.reason ?? "").trim();
  if (reason) return reason;
  if (completed) return "Review locked artifacts without mutating the completed flow.";
  if (providerFocusActive) return "Inspect the blocking run evidence, record the required operator decision, then refresh status.";
  return "AOR will run the selected lifecycle step through public control-plane commands.";
}

function externalRunStepContext(health) {
  const step = String(health?.current_step ?? health?.blocked_step_id ?? "").trim().toLowerCase();
  if (!step) return null;
  if (step === "implement" || step === "run-active") return EXTERNAL_RUN_STEP_CONTEXT.execution;
  if (step === "validation" || step === "eval" || step === "evaluation" || step === "harness") {
    return EXTERNAL_RUN_STEP_CONTEXT.review;
  }
  return EXTERNAL_RUN_STEP_CONTEXT[step] ?? null;
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

function externalRunEvidenceRefs(health) {
  const pending = health?.pending_decision && typeof health.pending_decision === "object" ? health.pending_decision : {};
  const rubric = pending.decision_rubric_summary && typeof pending.decision_rubric_summary === "object" ? pending.decision_rubric_summary : {};
  const rubricRefs = Array.isArray(rubric.evidence_refs)
    ? rubric.evidence_refs.map((entry) => (typeof entry === "string" ? entry : entry?.ref)).filter(Boolean)
    : [];
  return [
    health?.report_ref,
    health?.source_observation_report_ref,
    pending.request_ref,
    pending.expected_decision_ref,
    pending.operator_decision_ref,
    pending.quality_assessment_report_ref,
    health?.controller_health?.controller_state_ref,
    ...rubricRefs,
  ].filter((ref, index, refs) => typeof ref === "string" && ref.trim() && refs.indexOf(ref) === index);
}

function deterministicRunEvidenceStatus(health) {
  const pending = health?.pending_decision && typeof health.pending_decision === "object" ? health.pending_decision : {};
  const rubric = pending.decision_rubric_summary && typeof pending.decision_rubric_summary === "object" ? pending.decision_rubric_summary : {};
  return String(rubric.deterministic_status ?? health?.deterministic_analysis?.status ?? "").trim().toLowerCase();
}

function externalRunSignalState(signal, visibleEvidence, health) {
  const rows = (Array.isArray(visibleEvidence) ? visibleEvidence : []).filter((row) =>
    evidenceRefMatchesTokens(`${row.ref} ${row.rawRef} ${row.sourceRef} ${row.kind} ${row.label}`, signal.tokens),
  );
  if (rows.length > 0) {
    return {
      value: String(rows.length),
      tone: "ready",
      detail: `${rows.length} visible artifact${rows.length === 1 ? "" : "s"} in the workbench.`,
      title: rows.map((row) => row.rawRef ?? row.ref).filter(Boolean).join("\n"),
    };
  }
  const linkedRefs = externalRunEvidenceRefs(health).filter((ref) => evidenceRefMatchesTokens(ref, signal.tokens));
  if (linkedRefs.length > 0) {
    return {
      value: "linked",
      tone: "ready",
      detail: `${titleFromRef(linkedRefs[0])} is linked in run evidence.`,
      title: linkedRefs.join("\n"),
    };
  }
  const deterministicStatus = deterministicRunEvidenceStatus(health);
  if (deterministicStatus === "pass") {
    return {
      value: "ready",
      tone: "ready",
      detail: "Covered by passed run guardrails; inspect the decision request for refs.",
      title: "Deterministic run evidence passed.",
    };
  }
  if (deterministicStatus === "warn" || deterministicStatus === "warning") {
    return {
      value: "review",
      tone: "review",
      detail: "Guardrails warned; inspect the run evidence before continuing.",
      title: "Deterministic run evidence returned a warning.",
    };
  }
  return {
    value: "missing",
    tone: "missing",
    detail: "No visible or linked run evidence found for this signal.",
    title: "Run evidence not found.",
  };
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
    status: normalizeOperatorDecisionStatus(requestRow.status, "pending"),
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
  const refs = [
    row?.rawRef,
    row?.sourceRef,
    row?.ref,
    row?.displaySummary?.raw_ref,
    row?.displaySummary?.source_ref,
  ].filter(Boolean).join(" ");
  return isOperatorDecisionRequestRef(refs);
}

function isOperatorDecisionRequestRef(value) {
  const normalized = String(value ?? "").toLowerCase().replace(/_/gu, "-");
  return normalized.includes("agent-decision-request") || normalized.includes("operator-decision-request");
}

function normalizeOperatorDecisionStatus(status, fallback = "pending") {
  const normalized = String(status ?? "").trim().toLowerCase();
  if (!normalized || normalized === "ready" || normalized === "read") return fallback;
  return normalized;
}

function isOpenOperatorDecisionStatus(status) {
  const normalized = normalizeOperatorDecisionStatus(status, "missing");
  return !["accepted", "answered", "closed", "completed", "resolved", "pass"].includes(normalized);
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
  const traceRefs = traceItems
    .filter((item) => item.agent_decision_request_ref)
    .map((item) => ({
      ref: item.agent_decision_request_ref,
      label: item.display_summary?.label ?? item.summary ?? "Agent decision request",
      status: normalizeOperatorDecisionStatus(item.operator_decision_status ?? item.status, "missing"),
      rejectionReason: item.operator_decision_rejection_reason ?? item.rejection_reason ?? "",
      supportedActions: supportedDecisionActionsFromRecord(item),
      decisionRubricSummary: item.display_summary?.decision_rubric_summary ?? item.decision_rubric_summary ?? null,
    }))
    .filter((entry) => isOpenOperatorDecisionStatus(entry.status));
  const evidenceRefs = evidenceRows
    .filter((row) => isOperatorDecisionRequestRow(row))
    .map((row) => ({
      ref: row.rawRef ?? row.sourceRef ?? row.ref,
      label: row.label ?? "Agent decision request",
      status: normalizeOperatorDecisionStatus(row.status, "pending"),
      rejectionReason: row.rejectionReason ?? "",
      supportedActions: OPERATOR_DECISION_ACTIONS.map((action) => action.id),
      decisionRubricSummary: row.decisionRubricSummary ?? row.displaySummary?.decision_rubric_summary ?? null,
    }))
    .filter((entry) => isOpenOperatorDecisionStatus(entry.status));
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

function supportedDecisionActionsFromRubric(rubric) {
  const rawOptions = Array.isArray(rubric?.action_options) ? rubric.action_options : [];
  const supported = rawOptions
    .map((entry) => String(entry ?? "").trim())
    .filter((entry) => OPERATOR_DECISION_ACTIONS.some((action) => action.id === entry));
  return supported.length > 0 ? supported : OPERATOR_DECISION_ACTIONS.map((action) => action.id);
}

function operatorDecisionRequestsFromExternalRunHealth(externalRunHealth) {
  const pending = externalRunHealth?.pending_decision && typeof externalRunHealth.pending_decision === "object"
    ? externalRunHealth.pending_decision
    : null;
  const requestRef = typeof pending?.request_ref === "string" ? pending.request_ref.trim() : "";
  if (!requestRef) return [];
  const status = normalizeOperatorDecisionStatus(
    pending.status ?? externalRunHealth?.resume_interaction_health?.status ?? "awaiting-decision",
    "awaiting-decision",
  );
  if (!isOpenOperatorDecisionStatus(status)) return [];
  const stepLabel = externalRunStepLabel(externalRunHealth?.current_step ?? externalRunHealth?.blocked_step_id);
  return [{
    ref: requestRef,
    label: `${stepLabel} operator decision request`,
    status,
    rejectionReason: pending.rejection_reason ?? externalRunHealth?.controller_health?.rejection_reason ?? "",
    supportedActions: supportedDecisionActionsFromRubric(pending.decision_rubric_summary),
    decisionRubricSummary: pending.decision_rubric_summary ?? null,
  }];
}

function mergeOperatorDecisionRequests(...requestLists) {
  const seen = new Set();
  return requestLists
    .flat()
    .filter((entry) => entry?.ref)
    .filter((entry) => {
      const key = comparableEvidenceRef(entry.ref).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function FlowSelector({ flows, selectedFlowId, newFlowDraft, onSelectFlow, onNewFlow, newFlowDisabled = false, newFlowDisabledReason = "", providerStepStatus = null, externalRunHealth = null }) {
  const activeFlows = flows.filter((flow) => flow.status === "active");
  const completedFlows = flows.filter((flow) => flow.status === "completed");
  const value = newFlowDraft ? "__new__" : selectedFlowId ?? "";
  const projectLevelProviderFocus = !newFlowDraft && flows.length === 0 && Boolean(providerStepStatus || externalRunHealth);
  const newFlowTitle = newFlowDisabled
    ? newFlowDisabledReason || "Initialize the project runtime before starting a flow."
    : "Start a new flow";
  const newFlowAccessibleLabel = newFlowDisabled
    ? `${newFlowTitle} New Flow is unavailable.`
    : "Start a new flow";
  return (
    <div className="flow-selector">
      <label htmlFor="flow-selector-control">
        <span>Flow</span>
        <select id="flow-selector-control" name="flow-selector" value={value} aria-label="Flow selector" onChange={(event) => onSelectFlow(event.target.value)}>
          {newFlowDraft ? <option value="__new__">New flow draft</option> : null}
          {flows.length === 0 ? <option value="">{projectLevelProviderFocus ? projectRunEvidenceSelectorLabel(providerStepStatus, externalRunHealth) : "No active flow"}</option> : null}
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
        title={newFlowTitle}
        aria-label={newFlowAccessibleLabel}
      >
        <Icon name="plus" />
        New Flow
      </button>
    </div>
  );
}

function ProjectSnapshotLoading({ runtimeRoot }) {
  return (
    <section className="work-card project-snapshot-loading" aria-label="Project state loading">
      <div className="work-heading">
        <div>
          <span className="eyebrow">Loading project</span>
          <h2>Syncing project state</h2>
          <p>Reading active flow, run health, and evidence before showing the next action.</p>
        </div>
        <StatusPill state="loading" />
      </div>
      <div className="snapshot-loading-grid" aria-label="Project state loading checks">
        <div>
          <span>Runtime root</span>
          <strong><CompactInlineValue value={runtimeRoot} kind="path" /></strong>
        </div>
        <div>
          <span>Action state</span>
          <strong>Waiting for snapshot</strong>
        </div>
      </div>
    </section>
  );
}

function projectStatusLabel(project) {
  if (!project) return "Loading";
  const onboarding = project?.onboarding_summary ?? {};
  const flowSummary = project?.active_flow_summary ?? {};
  if (flowSummary.status === "active-flow") return "Active flow";
  if (flowSummary.status === "completed-only") return "Completed flows";
  if (onboarding.status === "initialized") return "Initialized";
  if (onboarding.status === "runtime-ready") return "Runtime ready";
  if (onboarding.status === "not-initialized" || onboarding.initialized === false || onboarding.state_exists === false || flowSummary.status === "not-initialized") {
    return onboarding.can_initialize === true ? "First launch" : "Loading";
  }
  return "Loading";
}

function shortPathLabel(value) {
  const text = String(value ?? "").trim();
  if (text.length <= 34) return text || "runtime pending";
  const parts = text.split(/[\\/]+/u).filter(Boolean);
  if (parts.length <= 2) return text;
  return `.../${parts.slice(-2).join("/")}`;
}

function conciseSlugLabel(value, fallback = "Local project") {
  const text = String(value ?? "").trim();
  if (!text) return fallback;
  const tail = text.split(/[\\/]+/u).filter(Boolean).pop() ?? text;
  const tokens = tail
    .split(/[._-]+/u)
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) return fallback;
  const firstDigitToken = tokens.findIndex((token) => /\d/u.test(token));
  const stableTokens = firstDigitToken >= 0
    ? tokens.slice(0, Math.max(2, firstDigitToken >= 3 ? firstDigitToken - 1 : firstDigitToken + 1))
    : tokens;
  const meaningfulTokens = stableTokens
    .filter((token) => !/^(tmp|target|checkout|checkouts|project|repo)$/iu.test(token))
    .slice(0, 3);
  const label = humanizeToken((meaningfulTokens.length > 0 ? meaningfulTokens : stableTokens.slice(0, 3)).join(" "));
  return label || fallback;
}

function projectDisplayLabel(project) {
  const rawLabel = String(project?.label ?? project?.display_name ?? project?.project_id ?? "").trim();
  if (rawLabel && !looksLikeTechnicalRef(rawLabel)) return rawLabel;
  return conciseSlugLabel(project?.project_ref ?? rawLabel, rawLabel ? "Local project" : "Project pending");
}

function compactCommandLabel(value) {
  const text = String(value ?? "").trim();
  if (!text) return "pending";
  const parts = text.split(/\s+/u).filter(Boolean);
  const commandPrefix = parts[0] === "aor" ? parts.slice(0, 3).join(" ") : parts.slice(0, 2).join(" ");
  const flagNames = ["--project-ref", "--project-profile", "--runtime-root", "--run-id", "--allowed-path", "--delivery-mode"]
    .filter((flag) => parts.includes(flag));
  if (flagNames.length > 0) return `${commandPrefix} (${flagNames.join(", ")})`;
  return text.length > 72 ? `${text.slice(0, 68)}...` : text;
}

function shellQuoteCommandArg(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (/^[A-Za-z0-9_./:@%+=,-]+$/u.test(text)) return text;
  return `'${text.replace(/'/gu, "'\"'\"'")}'`;
}

function commandHasFlag(command, flag) {
  const escaped = flag.replace(/[\\^$*+?.()|[\]{}]/gu, "\\$&");
  return new RegExp(`(?:^|\\s)${escaped}(?:\\s|=|$)`, "u").test(String(command ?? ""));
}

function appendCommandFlag(command, flag, value) {
  const quoted = shellQuoteCommandArg(value);
  if (!quoted || commandHasFlag(command, flag)) return command;
  return `${command} ${flag} ${quoted}`;
}

function compactVisibleValue(value, kind = "auto") {
  const text = String(value ?? "").trim();
  if (!text) return "pending";
  if (kind === "command" || /^aor\s+/u.test(text) || text.includes(" --project-ref ") || text.includes(" --runtime-root ")) {
    return compactCommandLabel(text);
  }
  if (kind === "path" || text.startsWith("/") || text.startsWith("~/") || /^[A-Za-z]:[\\/]/u.test(text)) {
    return shortPathLabel(text);
  }
  return text.length > 72 ? `${text.slice(0, 68)}...` : text;
}

function compactDisclosureLabel(value, kind = "auto") {
  const text = String(value ?? "").trim();
  const visible = compactVisibleValue(text, kind);
  const type = kind === "command" || /^aor\s+/u.test(text) || text.includes(" --project-ref ") || text.includes(" --runtime-root ")
    ? "command"
    : kind === "path" || text.startsWith("/") || text.startsWith("~/") || /^[A-Za-z]:[\\/]/u.test(text)
      ? "path"
      : "value";
  const context = visible && visible !== "pending" ? `: ${visible}` : "";
  return `Show full ${type}${context}`;
}

function CompactInlineValue({ value, kind = "auto", className = "" }) {
  const fullValue = String(value ?? "").trim();
  const label = compactVisibleValue(fullValue, kind);
  const truncated = fullValue.length > 0 && label !== fullValue;
  const disclosureLabel = compactDisclosureLabel(fullValue, kind);
  return (
    <span className={`compact-inline-value ${className}`.trim()} title={fullValue}>
      <code>{label}</code>
      {truncated ? (
        <details className="debug-ref-details compact-value-details">
          <summary aria-label={disclosureLabel} title={disclosureLabel}>Details</summary>
          <code>{fullValue}</code>
        </details>
      ) : null}
    </span>
  );
}

function CompactDetailValue({ value, copyValue = null, kind = "auto" }) {
  const fullValue = String(value ?? "").trim();
  const label = compactVisibleValue(fullValue, kind);
  const truncated = fullValue.length > 0 && label !== fullValue;
  const disclosureLabel = compactDisclosureLabel(fullValue, kind);
  return (
    <div className="compact-detail-value">
      <span title={fullValue}>{label}</span>
      {truncated && copyValue ? (
        <button className="secondary compact" type="button" onClick={() => copyValue(fullValue)}>
          Copy
        </button>
      ) : null}
      {truncated ? (
        <details className="debug-ref-details compact-value-details">
          <summary aria-label={disclosureLabel} title={disclosureLabel}>Debug full value</summary>
          <code>{fullValue}</code>
        </details>
      ) : null}
    </div>
  );
}

function projectWithObservedRuntime(project) {
  if (!project) return project;
  const onboarding = project.onboarding_summary ?? {};
  if (onboarding.initialized === true || onboarding.state_exists === true || onboarding.status === "initialized" || onboarding.status === "runtime-ready") {
    return project;
  }
  return {
    ...project,
    onboarding_summary: {
      ...onboarding,
      status: "initialized",
      initialized: true,
      state_exists: true,
      can_initialize: false,
      recommended_action: onboarding.recommended_action ?? "start-or-select-flow",
    },
  };
}

function ProjectSwitcher({ projects, activeProjectId, onSelectProject, onOpenAddProject, busy, activeRuntimeReady = false }) {
  const activeProjectBase = projects.find((project) => project.project_id === activeProjectId) ?? projects[0] ?? null;
  const activeProject = activeRuntimeReady ? projectWithObservedRuntime(activeProjectBase) : activeProjectBase;
  const displayProjects = activeRuntimeReady && activeProject
    ? projects.map((project) => (project.project_id === activeProject.project_id ? activeProject : project))
    : projects;
  const runtimeRoot = activeProject?.runtime_root ?? "runtime pending";
  const runtimeRootLabel = shortPathLabel(runtimeRoot);
  const activeProjectLabel = projectDisplayLabel(activeProject);
  const activeProjectRawLabel = activeProject?.label ?? activeProject?.display_name ?? activeProject?.project_id ?? "";
  const activeProjectTitle = activeProjectRawLabel && activeProjectRawLabel !== activeProjectLabel
    ? `${activeProjectLabel} (${activeProjectRawLabel})`
    : activeProjectRawLabel;
  return (
    <div className="project-switcher" aria-label="Project switcher">
      <label htmlFor="project-switcher-control">
        <span>Project switcher</span>
        <select
          id="project-switcher-control"
          name="project-switcher"
          aria-label="Project switcher"
          title={activeProjectTitle}
          value={activeProject?.project_id ?? ""}
          onChange={(event) => onSelectProject(event.target.value)}
          disabled={busy || displayProjects.length === 0}
        >
          {displayProjects.map((project) => (
            <option key={project.project_id} value={project.project_id} title={project.label ?? project.display_name ?? project.project_id}>
              {projectDisplayLabel(project)}
            </option>
          ))}
        </select>
      </label>
      <div className="project-switcher-meta">
        <StatusPill state={projectStatusLabel(activeProject)} />
        <details className="runtime-path-details">
          <summary aria-label="Show runtime root path details" title="Show runtime root path details">
            <code title={runtimeRoot}>{runtimeRootLabel}</code>
          </summary>
          <code className="runtime-path-full">{runtimeRoot}</code>
        </details>
      </div>
      <button className="utility-button compact" type="button" onClick={onOpenAddProject} disabled={busy}>
        <Icon name="folder" />Add local project
      </button>
    </div>
  );
}

function StageRail({ selectedStage, currentStage, onSelect, flow, newFlowDraft, providerStepStatus = null, externalRunHealth = null, repairCompletion = null, verificationPlan = null }) {
  const currentIndex = Math.max(0, STAGES.findIndex((stage) => stage.id === currentStage));
  const currentStageEntry = STAGES[currentIndex] ?? STAGES[0];
  const completed = isCompletedFlow(flow);
  const projectLevelProviderFocus = !flow && !newFlowDraft && Boolean(providerStepStatus || externalRunHealth);
  const blockingExternalRun = isBlockingExternalRunHealth(externalRunHealth);
  const firstRunFocus = (!flow && !projectLevelProviderFocus) || newFlowDraft;
  const verificationPrimary = latestRequiredVerificationFailed(verificationPlan);
  const railTitle = newFlowDraft
    ? "New flow draft"
    : flow
      ? flowDisplayName(flow)
      : projectLevelProviderFocus
        ? providerFocusTitle(providerStepStatus, externalRunHealth)
        : "No active flow";
  const railDescription = newFlowDraft
    ? "Draft mission settings are not durable evidence until submitted."
    : completed
      ? "Closed flow evidence is immutable and read-only."
        : flow
        ? "Navigation is scoped to the selected flow."
        : projectLevelProviderFocus
          ? providerFocusDescription(providerStepStatus, externalRunHealth, null, repairCompletion, verificationPlan)
          : "Readiness prepares the runtime before a flow is created.";
  return (
    <aside className={`stage-rail ${firstRunFocus ? "compact-first-run" : ""}`}>
      <div className="rail-title">
        <span>Flow stages</span>
        <strong>{newFlowDraft ? "Draft" : flow?.status ?? `${currentIndex + 1}/7`}</strong>
      </div>
      <div className="stage-progress-strip" aria-label="Compact stage progress">
        <span>{newFlowDraft ? "2/7" : `${currentIndex + 1}/7`}</span>
        <strong>{currentStageEntry.label}</strong>
        <em>{newFlowDraft ? "Mission draft" : currentStageEntry.hint}</em>
      </div>
      {providerStepStatus && !blockingExternalRun ? (
        <div className="provider-heartbeat-rail" aria-label="Provider step heartbeat">
          <div>
            <span>{providerStepStatus.provider ?? "Provider"}</span>
            <strong title={providerStepStatus.current_command_label ?? ""}>{providerCommandDisplayLabel(providerStepStatus)}</strong>
            <em>{providerStepStatus.adapter ?? providerStepStatus.route_id ?? "provider adapter"}</em>
          </div>
          <StatusPill state={providerStepStatus.status} />
          <p>{providerStatusCopy(providerStepStatus, currentStage, verificationPrimary, externalRunHealth)}</p>
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
              aria-current={current ? "step" : undefined}
              aria-pressed={active}
              aria-label={`${index + 1}. ${stage.label}. ${stage.hint}. ${statusLabel}${active ? ". Selected view" : ""}`}
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
  const safeTemplateMode = form.templateId === SAFE_TEMPLATE_ID && !followUpSourceHandoffRef;
  const missionSubmitLabel = followUpSourceHandoffRef ? "Create Follow-up Flow & Resolve Next Action" : "Create Flow & Resolve Next Action";
  const askDisabledReason = "Ask AOR requires a selected active flow";
  const learningHandoffReason = followUpSourceHandoffRef ? "Captured guidance attached" : "Available after completed flow";
  const selectedEvidenceReason = "Requires selected active flow";
  const missionDetailFields = (
    <>
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
    </>
  );

  return (
    <form className={`mission-form ${safeTemplateMode ? "summary-first" : ""}`} aria-label="Mission intake" onSubmit={submitMission}>
      <div className="form-header">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <div className="form-actions">
          {safeTemplateMode ? (
            <button className="primary form-primary-action" type="submit" disabled={busy}>
              {missionSubmitLabel}
              <Icon name="target" />
            </button>
          ) : null}
          {onCancel ? (
            <button className="secondary" type="button" onClick={onCancel} disabled={busy}>
              Cancel New Flow
            </button>
          ) : null}
          <button className="secondary" type="button" onClick={applyTemplate} disabled={busy}>
            Load template
          </button>
          <button className="secondary" type="button" onClick={onAsk} disabled={busy || askDisabled} title={askDisabled ? askDisabledReason : "Ask AOR for selected flow"} aria-label="Ask AOR for selected flow">
            <Icon name="target" />
            Ask AOR
          </button>
          {askDisabled ? <p className="form-action-reason">{askDisabledReason}</p> : null}
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
        <button className={`template-card ${followUpSourceHandoffRef ? "selected" : ""}`} type="button" title={learningHandoffReason} disabled>
          <Icon name="lock" />
          <span>From learning handoff</span>
          <p>{followUpSourceHandoffRef ? "Captured guidance attached" : "Available after completed flow"}</p>
          <p className="disabled-reason">{learningHandoffReason}</p>
        </button>
        <button className="template-card" type="button" title={selectedEvidenceReason} disabled>
          <Icon name="target" />
          <span>From selected evidence / ref</span>
          <p>Attach evidence after a flow exists</p>
          <p className="disabled-reason">{selectedEvidenceReason}</p>
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
      {safeTemplateMode ? (
        <>
          <section className="safe-template-summary" aria-label="Safe walkthrough summary">
            <div>
              <span>Prefilled title</span>
              <strong>{form.title}</strong>
              <p>{form.brief}</p>
            </div>
            <div>
              <span>Safety</span>
              <strong>{selectedDeliveryMode === "no-write" ? "No upstream writes" : selectedDeliveryMode}</strong>
              <p>
                <code>delivery-mode={selectedDeliveryMode}</code>
                {form.constraints ? ` / ${form.constraints}` : " / Local evidence first; no upstream writes by default."}
              </p>
            </div>
            <div>
              <span>Definition of Done</span>
              <strong>{splitLines(form.dod).length || 0} checks</strong>
              <p>{splitLines(form.dod).slice(0, 2).join("; ") || "Confirm evidence and next-action readiness."}</p>
            </div>
          </section>
          <details className="mission-detail-fields">
            <summary>Edit mission details</summary>
            <div className="mission-detail-grid">
              {missionDetailFields}
            </div>
          </details>
        </>
      ) : missionDetailFields}
      {!safeTemplateMode ? (
        <button className="primary" type="submit" disabled={busy}>
          {missionSubmitLabel}
          <Icon name="target" />
        </button>
      ) : null}
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

function ActionContextGrid({ stage, action, evidenceRefs, evidenceRows = [], blockers, deliveryMode, projectLevelProviderFocus = false, externalRunHealth = null }) {
  const runStepContext = projectLevelProviderFocus ? externalRunStepContext(externalRunHealth) : null;
  const expectedOutputs = runStepContext?.expectedOutputs ?? STAGE_EXPECTED_OUTPUTS[stage.id] ?? ["Evidence artifact", "Policy decision", "Next-action report"];
  const scopeTitle = runStepContext?.scope ?? STAGE_SCOPE_SUMMARY[stage.id] ?? stage.label;
  const scopeDetail = runStepContext?.scopeDetail ?? (
    deliveryMode === "no-write"
      ? "No upstream writes. Analysis and evidence only."
      : "Explicit allowed paths and review gates required."
  );
  const riskLevel = externalRunRiskLevel(projectLevelProviderFocus ? externalRunHealth : null, blockers, deliveryMode);
  const visibleEvidence = evidenceRefs.length > 0
    ? artifactRowsForRefs(evidenceRefs, evidenceRows, stage.id)
    : projectLevelProviderFocus
      ? evidenceRows
      : [];
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
        <strong>{scopeTitle}</strong>
        <p>{scopeDetail}</p>
      </div>
      <div>
        <span>Risk level</span>
        <strong>{riskLevel}</strong>
        <p>{blockers.length > 0 ? blockers[0]?.summary ?? blockers[0]?.code : "No blockers for this visible step."}</p>
      </div>
      <div>
        <span>Command provenance</span>
        <strong>AOR runtime</strong>
        <p>{projectLevelProviderFocus ? "Generated from project-level provider evidence and latest run-control state." : "Generated from selected-flow evidence and latest next-action state."}</p>
      </div>
      <div>
        <span>{action?.dry_run_label ?? "Dry-run preview"}</span>
        <CompactInlineValue value={actionDryRunPreview(action)} kind="command" />
        <p>{visibleEvidence.length} {projectLevelProviderFocus ? "project-level artifacts available for this visible run." : "selected-flow artifacts available before execution."}</p>
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

function qualityGateSourceDetail(gate, verificationFailureActive = false) {
  if (verificationFailureActive) {
    return "Required verification must pass before the review rerun.";
  }
  return gate?.source_stage === "qa" ? "QA rerun required after repair." : "Review rerun required after repair.";
}

function qualityGateAttemptDetail(gate, hold = false, verificationFailureActive = false) {
  if (hold) return "No automatic repair attempt remains.";
  const remaining = Number(gate?.attempt_budget?.remaining_attempts);
  if (Number.isFinite(remaining) && remaining <= 0) {
    return verificationFailureActive
      ? "No automatic repair attempts remain; use failed verification evidence before requesting more repair."
      : "No automatic repair attempts remain; continue through the required review gate.";
  }
  if (verificationFailureActive) {
    return "Repair budget is bounded; failed verification is the current gate.";
  }
  return "Repair attempt budget is still bounded.";
}

function normalizedBlockerField(record, keys) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function normalizeQualityGateBlockerRow(blocker, index) {
  if (typeof blocker === "string") {
    const summary = blocker.trim();
    if (!summary) return null;
    return {
      key: `${summary}-${index}`,
      summary,
      code: summary,
      nextCommand: "",
      evidenceRefs: [],
    };
  }
  if (!blocker || typeof blocker !== "object") return null;
  const record = blocker;
  const code = normalizedBlockerField(record, ["code", "reason_code", "blocker_id", "id"]);
  const summary = normalizedBlockerField(record, ["summary", "message", "reason"]) || code;
  const nextCommand = normalizedBlockerField(record, ["next_command", "command"]);
  const evidenceRefs = Array.isArray(record.evidence_refs)
    ? record.evidence_refs.filter(Boolean).map((ref) => String(ref))
    : [];
  const label = summary || code || nextCommand;
  if (!label && evidenceRefs.length === 0) return null;
  return {
    key: `${code || label || "quality-blocker"}-${index}`,
    summary: label || "Blocking evidence required",
    code,
    nextCommand,
    evidenceRefs,
  };
}

function qualityGateBlockerRows(gate) {
  return Array.isArray(gate?.blockers)
    ? gate.blockers.map((blocker, index) => normalizeQualityGateBlockerRow(blocker, index)).filter(Boolean)
    : [];
}

function qualityGateBlockerForActionContext(blocker) {
  return {
    code: blocker.code || blocker.summary,
    summary: blocker.summary,
    next_command: blocker.nextCommand,
    evidence_refs: blocker.evidenceRefs,
  };
}

function qualityGateEvidenceRows(gate, evidenceRows = []) {
  const rows = Array.isArray(evidenceRows) ? evidenceRows : [];
  const evidenceRefs = Array.isArray(gate?.evidence_refs) ? gate.evidence_refs : [];
  const summaries = Array.isArray(gate?.evidence_summaries) ? gate.evidence_summaries : [];
  const summaryRows = summaries.map((summary, index) => artifactRowFromSummary(summary, {
    ref: summary?.raw_ref ?? summary?.source_ref ?? `quality-gate-summary-${index}`,
    stage: "review",
  }));
  const rowForRef = (ref) => {
    return rows.find((row) => evidenceRefsMatch(row.ref, ref) || evidenceRefsMatch(row.sourceRef, ref))
      ?? summaryRows.find((row) => evidenceRefsMatch(row.ref, ref) || evidenceRefsMatch(row.sourceRef, ref))
      ?? missingArtifactRow(ref, "review");
  };
  return evidenceRefs.length > 0 ? evidenceRefs.map(rowForRef) : summaryRows;
}

function qualityGateVerificationFailureRecoveryPlan(verificationPlan, verificationFailures, gate = null) {
  const failures = Array.isArray(verificationFailures) ? verificationFailures : [];
  const firstFailure = failures[0];
  const failureCount = failures.length;
  const repairAttemptsExhausted = qualityGateRepairAttemptsExhausted(gate);
  return {
    currentStep: repairAttemptsExhausted ? "Request repair with new evidence" : "Repair failed verification",
    nextCommand: repairAttemptsExhausted ? verificationFailureRepairDecisionCommand() : verificationFailureRerunCommand(verificationPlan),
    evidenceStep: repairAttemptsExhausted
      ? "No automatic repair attempts remain."
      : `${failureCount} required command group${failureCount === 1 ? "" : "s"} failed.`,
    blockerStep: repairAttemptsExhausted
      ? "Use failed verification refs in a new repair context; repeated repair context without new evidence must stay blocked."
      : firstFailure?.blocked_next_step ?? "Inspect failed step-result evidence before review, QA, or delivery.",
    closureStep: "Required verification must pass before post-repair review, QA, or delivery.",
  };
}

function qualityGateRecoveryPlan(gate, blockers, evidenceCount) {
  const flowState = String(gate?.flow_state ?? gate?.status ?? "").trim();
  const sourceStage = String(gate?.source_stage ?? "").trim();
  const hold = gate?.operator_hold === true || flowState === "repair-cycle-exhausted";
  const nextAction = gate?.next_action ?? {};
  const currentStep = hold
    ? "Record explicit operator decision"
    : flowState === "review-required"
      ? "Run post-repair review"
      : flowState === "qa-required"
        ? "Run QA rerun"
        : flowState === "in-progress"
          ? "Wait for repair evidence"
          : "Run repair implementation";
  const closureStep = sourceStage === "qa"
    ? "Post-repair review and QA must pass before delivery."
    : "Post-repair review must pass before delivery; QA follows when in scope.";
  const evidenceStep = evidenceCount > 0
    ? `${evidenceCount} repair evidence summaries linked.`
    : "Repair request and source evidence are still being materialized.";
  const blockerStep = blockers.length > 0
    ? `${blockers.length} blocker${blockers.length === 1 ? "" : "s"} must be cleared.`
    : "No active blockers are listed beyond the gate state.";
  return {
    currentStep,
    nextCommand: actionCommandLabel(nextAction, hold ? "aor review decide" : "aor run start"),
    evidenceStep,
    blockerStep,
    closureStep,
  };
}

function QualityGatePanel({ gate, evidenceRows = [], verificationPlan = null, verificationFailures = [] }) {
  if (!gate) return null;
  const nextAction = gate.next_action ?? {};
  const blockers = qualityGateBlockerRows(gate);
  const evidence = qualityGateEvidenceRows(gate, evidenceRows).slice(0, 4);
  const sourceLabel = qualityGateSourceLabel(gate.source_stage);
  const hold = gate.operator_hold === true;
  const qualityVerificationFailureActive = latestRequiredVerificationFailed(verificationPlan, verificationFailures);
  const recoveryPlan = qualityVerificationFailureActive
    ? qualityGateVerificationFailureRecoveryPlan(verificationPlan, verificationFailures, gate)
    : qualityGateRecoveryPlan(gate, blockers, evidence.length);
  const displayedNextAction = qualityVerificationFailureActive
    ? verificationFailurePrimaryAction(verificationPlan, verificationFailures, nextAction, gate)
    : nextAction;
  return (
    <div className={`quality-gate-card ${gate.flow_state ?? "requested"} ${hold ? "operator-hold" : ""}`} aria-label="Active quality gate">
      <div className="quality-gate-heading">
        <div>
          <span>Active Quality Gate</span>
          <h3>{hold ? "Budget Exhausted Hold" : sourceLabel}</h3>
          <p>{qualityVerificationFailureActive
            ? "Required verification failed after the repair attempt; keep review, QA, and delivery blocked until it is repaired."
            : hold
            ? "Delivery and release stay blocked until an explicit operator decision is recorded."
            : "Repair must close through implementation, review, and required QA evidence before delivery."}</p>
        </div>
        <StatusPill state={qualityVerificationFailureActive ? "failed" : gate.status ?? gate.flow_state ?? "requested"} />
      </div>

      <div className="quality-recovery-path" aria-label="Quality gate recovery path">
        <div className="quality-recovery-heading">
          <span>Recovery path</span>
          <strong>{recoveryPlan.currentStep}</strong>
          <p>{qualityVerificationFailureActive
            ? "Use the failed verification evidence as the current repair input before running post-repair review."
            : hold
            ? "Automatic repair is exhausted; an operator must explicitly decide how to proceed."
            : "Keep delivery and release blocked until the repair loop proves closure."}</p>
        </div>
        <ol>
          <li className="active">
            <span>Now</span>
            <strong>{recoveryPlan.currentStep}</strong>
            <CompactInlineValue value={recoveryPlan.nextCommand} kind="command" />
          </li>
          <li>
            <span>Evidence</span>
            <strong>{recoveryPlan.evidenceStep}</strong>
            <p>{recoveryPlan.blockerStep}</p>
          </li>
          <li>
            <span>Exit condition</span>
            <strong>{gate.delivery_release_blocked ? "Delivery stays blocked" : "Delivery unblocked"}</strong>
            <p>{recoveryPlan.closureStep}</p>
          </li>
        </ol>
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
          <p>{qualityGateSourceDetail(gate, qualityVerificationFailureActive)}</p>
        </div>
        <div>
          <span>Attempt budget</span>
          <strong>{qualityGateAttemptLabel(gate)}</strong>
          <p>{qualityGateAttemptDetail(gate, hold, qualityVerificationFailureActive)}</p>
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
        <code title={displayedNextAction?.command ?? ""}>{actionCommandLabel(displayedNextAction, hold ? "aor review decide" : "aor run start")}</code>
        <p>{displayedNextAction?.reason ?? "Follow the resolver primary action for this repair state."}</p>
      </div>

      <div className="quality-gate-evidence">
        <div>
          <span>Blockers</span>
          {blockers.length > 0 ? (
            <ul className="quality-blocker-list">
              {blockers.slice(0, 4).map((blocker) => (
                <li key={blocker.key}>
                  <strong>{blocker.summary}</strong>
                  {blocker.code && blocker.code !== blocker.summary ? (
                    <div className="quality-blocker-meta">
                      <code>{blocker.code}</code>
                    </div>
                  ) : null}
                  {blocker.nextCommand || blocker.evidenceRefs.length > 0 ? (
                    <div className="quality-blocker-meta">
                      {blocker.nextCommand ? <code title={blocker.nextCommand}>{blocker.nextCommand}</code> : null}
                      {blocker.evidenceRefs.length > 0 ? <em>{blocker.evidenceRefs.length} evidence refs</em> : null}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p>No active blockers listed.</p>
          )}
        </div>
        <div>
          <span>Evidence summaries</span>
          {evidence.length > 0 ? (
            <ul>{evidence.map((row) => <li key={row.ref} title={row.rawRef}>{conciseArtifactLabel(row)}</li>)}</ul>
          ) : (
            <p>No readable repair evidence summaries yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function VerificationFailureBanner({ plan, failures = [], heldAction = null }) {
  if (failures.length === 0) return null;
  const recoveryPlan = verificationFailureRecoveryPlan(plan, failures, heldAction);
  const repairRunCompleted = heldAction?.action_id === "quality-repair-run-completed";
  const postRepairVerificationFailed = repairRunCompleted && latestRequiredVerificationFailed(plan, failures);
  const repairActionActive = isQualityRepairPrimaryAction(heldAction) && !postRepairVerificationFailed;
  return (
    <div className="verification-hold-banner" role="alert" aria-label="Required verification failure">
      <Icon name="alert" />
      <div className="verification-hold-content">
        <div className="verification-hold-heading">
          <div>
            <span>Required verification failed</span>
            <h3>{postRepairVerificationFailed ? "Verification failed after completed repair" : repairActionActive ? "Repair is driven by failed post-run evidence" : "Review is blocked by failed post-run evidence"}</h3>
          </div>
          <StatusPill state={plan?.latest_verify_status ?? "failed"} />
        </div>
        <p>{postRepairVerificationFailed
          ? "The completed repair remains evidence, but the latest required verification failed. Use the failed step-result evidence as the next repair input."
          : repairActionActive
          ? "Use the failed required command group as repair input, then rerun verification after the repair run."
          : "Resolve the failed required command group before treating review, QA, or delivery as low risk."}</p>
        <div className="verification-recovery-path" aria-label="Verification failure recovery path">
          <div className="verification-recovery-heading">
            <span>Recovery path</span>
            <strong>{postRepairVerificationFailed ? "Repair failed verification" : repairActionActive ? "Run repair from failed verification" : "Fix failed verification first"}</strong>
            <p>{postRepairVerificationFailed
              ? "Do not continue from the completed repair status; inspect failed step-result refs and start the next repair loop."
              : repairActionActive
              ? "AOR has already materialized a repair next-action; verification stays as the evidence to fix."
              : "AOR is holding the downstream action until required verification passes."}</p>
          </div>
          <ol>
            <li className="active">
              <span>Failed evidence</span>
              <strong>{recoveryPlan.failedGroupLabel}</strong>
              <p>{recoveryPlan.firstFailureTitle}</p>
            </li>
            <li>
              <span>Proof to inspect</span>
              <strong>{recoveryPlan.proofLabel}</strong>
              {recoveryPlan.summaryRef ? (
                <CompactInlineValue value={recoveryPlan.summaryRef} kind="path" />
              ) : (
                <p>Inspect failed step-result logs before retrying.</p>
              )}
            </li>
            <li>
              <span>{repairActionActive ? "Repair condition" : "Unlock condition"}</span>
              <strong>{postRepairVerificationFailed ? "Repair, then rerun verification" : repairRunCompleted ? "Repair completed; rerun verification" : repairActionActive ? "Repair, then rerun verification" : "Rerun required verification"}</strong>
              <CompactInlineValue value={repairActionActive ? actionCommandTitle(heldAction) : recoveryPlan.rerunCommand} kind="command" />
            </li>
          </ol>
        </div>
        <div className="verification-hold-grid">
          <div>
            <span>{postRepairVerificationFailed ? "Failed verification evidence" : repairRunCompleted ? "Completed repair status" : repairActionActive ? "Repair next action" : "Held downstream action"}</span>
            <strong>{postRepairVerificationFailed ? "Post-run verification failed" : recoveryPlan.heldActionLabel}</strong>
            <p>{postRepairVerificationFailed
              ? "Completed repair evidence is preserved, but the latest required verification must be repaired before QA or delivery."
              : repairRunCompleted
              ? "Repair implementation has completed. Rerun required verification before QA or delivery."
              : repairActionActive
              ? "Start this repair loop from the latest next-action report."
              : "Hidden until required verification returns to passing."}</p>
          </div>
          {failures.slice(0, 3).map((group, index) => (
            <div key={group.id ?? `${group.role}-${group.phase}-${index}`}>
              <span>{group.enforcement ?? "required"}</span>
              <strong>{verificationGroupTitle(group)}</strong>
              <p>{verificationGroupFailureDetail(group)}</p>
              {firstFailedStepResultRef(group) ? <CompactInlineValue value={firstFailedStepResultRef(group)} kind="path" /> : null}
              {group.blocked_next_step ? <p>{group.blocked_next_step}</p> : null}
              <StatusPill state={groupStatusValue(group)} />
            </div>
          ))}
          <div>
            <span>Evidence</span>
            <strong>{recoveryPlan.summaryRef ? "Verify summary" : "Summary pending"}</strong>
            <div className="verification-summary-ref">
              {recoveryPlan.summaryRef ? <CompactInlineValue value={recoveryPlan.summaryRef} kind="path" /> : "No verification summary ref available."}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StageSpecificPanel({ stage, completed, flow, evidenceRefs, evidenceRows = [], blockers, deliveryMode, artifactReadiness = null, projectLevelProviderFocus = false, externalRunHealth = null }) {
  const closureState = flow?.closure_state ?? {};
  const visibleEvidence = projectLevelProviderFocus && evidenceRefs.length === 0
    ? evidenceRows
    : artifactRowsForRefs(evidenceRefs, evidenceRows, stage.id);
  const runStepContext = projectLevelProviderFocus ? externalRunStepContext(externalRunHealth) : null;
  if (!completed && runStepContext) {
    const signals = Array.isArray(runStepContext.signals) ? runStepContext.signals : [];
    return (
      <div className="stage-specific-panel external-run-panel">
        <div className="panel-heading">
          <div>
            <h3>{runStepContext.title}</h3>
            <p>{runStepContext.description}</p>
          </div>
          <StatusPill state={externalRunDerivedEvidenceStatus(externalRunHealth, blockers.length > 0 ? "blocked" : "ready")} />
        </div>
        <div className="stage-signal-grid">
          {signals.map((signal) => {
            const state = externalRunSignalState(signal, visibleEvidence, externalRunHealth);
            return (
              <div key={signal.label} title={state.title}>
                <span>{signal.label}</span>
                <strong className={`signal-state ${state.tone}`}>{state.value}</strong>
                <p>{state.detail}</p>
              </div>
            );
          })}
        </div>
      </div>
    );
  }
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
            <p>{projectLevelProviderFocus ? "Provider status, runtime evidence, and recovery actions are shown from project-level run-control state." : "Runtime trace, permission requests, and requested interactions remain scoped to this flow."}</p>
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
  externalRunHealth = null,
  providerFocus = false,
  evidenceRows = [],
  repairCompletion = null,
}) {
  const projectLevelProviderFocus = !flow && Boolean(providerStepStatus || externalRunHealth);
  if (!flow && !projectLevelProviderFocus) {
    const projectRef = activeProject?.project_ref ?? config?.project_ref ?? "loading";
    const runtimeRoot = projectState?.runtime_root ?? activeProject?.runtime_root ?? config?.runtime_root ?? ".aor";
    const onboarding = projectState?.onboarding_summary ?? activeProject?.onboarding_summary ?? {};
    const stateReady = Boolean(projectState?.state_file) || onboarding.initialized === true || onboarding.state_exists === true;
    const profileMismatchProjectIds = Array.isArray(onboarding.profile_mismatch_candidate_project_ids)
      ? onboarding.profile_mismatch_candidate_project_ids.filter(Boolean)
      : [];
    const hasProfileMismatch = !stateReady && profileMismatchProjectIds.length > 0;
    const profileMismatchLabel = profileMismatchProjectIds.slice(0, 2).join(", ");
    const profileMismatchSuffix = profileMismatchProjectIds.length > 2 ? `, +${profileMismatchProjectIds.length - 2} more` : "";
    const profileMismatchCopy = profileMismatchLabel
      ? `Existing evidence is under ${profileMismatchLabel}${profileMismatchSuffix}. Add the matching project profile to attach it.`
      : "Add the matching project profile to attach existing runtime evidence.";
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
        status: stateReady ? "ready" : hasProfileMismatch ? "blocked" : "pending",
        detail: stateReady
          ? "Runtime state is reachable."
          : hasProfileMismatch
            ? "Runtime root has existing evidence for a different project profile."
            : "Runtime folders and state evidence are not initialized yet.",
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
              <CompactInlineValue value={step.code} />
            </div>
          ))}
          <div className="ready">
            <span className="check-dot" />
            <div>
              <strong>Runtime root policy</strong>
              <p>No-write safety and local control-plane defaults stay visible before any flow exists.</p>
            </div>
            <CompactInlineValue value={runtimeRoot} kind="path" />
          </div>
        </div>

        <div className="first-run-next-action-grid" aria-label="First-run next action and safety">
          <div>
            <span>Next action</span>
            <strong>{stateReady ? "Configure First Flow" : hasProfileMismatch ? "Add Matching Project Profile" : "Initialize Project Runtime"}</strong>
            <p>{stateReady ? "Open the safe walkthrough mission form and create the first no-write flow." : hasProfileMismatch ? profileMismatchCopy : "Prepare local runtime state before mission intake."}</p>
          </div>
          <div>
            <span>Blockers</span>
            <strong>{stateReady ? "None for safe template" : hasProfileMismatch ? "Profile mismatch detected" : "Runtime not initialized"}</strong>
            <p>{stateReady ? "First-flow setup is the only required next step." : hasProfileMismatch ? "Do not initialize over existing evidence; attach it with Project profile." : "AOR needs a local state file before flow evidence exists."}</p>
          </div>
          <div>
            <span>Safety</span>
            <strong>No upstream writes</strong>
            <p>First-run defaults keep execution in local evidence mode with <code>delivery-mode=no-write</code>.</p>
          </div>
          <div>
            <span>Runtime readiness</span>
            <strong>{stateReady ? "Runtime ready" : hasProfileMismatch ? "Profile required" : "Needs initialization"}</strong>
            <p>{stateReady ? "State evidence is reachable for this project." : hasProfileMismatch ? "Attach the matching project profile before initializing a new runtime." : "Initialize once, then configure the first flow."}</p>
          </div>
        </div>

        {!stateReady && hasProfileMismatch ? (
          <div className="readiness-action">
            <div>
              <Icon name="folder" />
              <div>
                <h3>Add Matching Project Profile</h3>
                <p>{profileMismatchCopy}</p>
              </div>
            </div>
            <button className="primary" type="button" onClick={onOpenAddProject ?? onRefresh} disabled={busy}>
              Add Local Project
            </button>
          </div>
        ) : !stateReady ? (
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
                <h3>Configure First Flow</h3>
                <p>Runtime is ready. Create a no-write mission packet and let AOR resolve the next action.</p>
              </div>
            </div>
            <button className="primary" type="button" onClick={onStartNewFlow} disabled={busy}>
              Configure First Flow
            </button>
          </div>
        )}

        <div className="flow-lifecycle-preview" aria-label="Flow lifecycle after readiness">
          <div className="complete"><span className="check-dot" /><strong>Initialize project</strong><p>Prepare runtime and policy</p></div>
          <div><span className="check-dot" /><strong>Configure first flow</strong><p>Create a new mission</p></div>
          <div><span className="check-dot" /><strong>Create mission packet</strong><p>Define intent and targets</p></div>
          <div><span className="check-dot" /><strong>Resolve next action</strong><p>Let AOR recommend the safest step</p></div>
        </div>
      </section>
    );
  }

  const completed = isCompletedFlow(flow);
  const blockingExternalRunHealth = !completed && isBlockingExternalRunHealth(externalRunHealth);
  const providerFocusActive = providerFocus || projectLevelProviderFocus || blockingExternalRunHealth;
  const followUpEligible = flow?.closure_state?.follow_up_eligible === true;
  const qualityGate = !completed && flow?.active_quality_gate ? flow.active_quality_gate : null;
  const qualityGateBlockers = qualityGateBlockerRows(qualityGate);
  const actionBlockers = blockingExternalRunHealth
    ? externalRunHealthBlockers(externalRunHealth)
    : qualityGate
    ? qualityGateBlockers.map((blocker) => qualityGateBlockerForActionContext(blocker))
    : providerFocusActive && externalRunHealth
      ? externalRunHealthBlockers(externalRunHealth)
    : Array.isArray(nextAction?.blockers) && !completed
      ? nextAction.blockers
      : [];
  const verificationPlan = projectState?.verification_plan ?? null;
  const verificationFailures = completed ? [] : failedRequiredVerificationGroups(verificationPlan);
  const repairNextActionSummary = providerFocusActive && externalRunRecoveryPathActive(externalRunHealth)
    ? materializedQualityRepairSummary(nextAction, repairCompletion, verificationPlan)
    : null;
  const presentedActionBlockers = repairNextActionSummary && actionBlockers.length > 0
    ? actionBlockers.map((blocker, index) => index === 0 ? { ...blocker, summary: repairNextActionSummary } : blocker)
    : actionBlockers;
  const verificationBlockers = verificationFailures.map((group, index) => verificationFailureBlocker(group, index));
  const blockers = verificationFailures.length > 0
    ? [...verificationBlockers, ...presentedActionBlockers]
    : [...presentedActionBlockers, ...verificationBlockers];
  const evidenceRefs = Array.isArray(flow?.evidence_refs) && flow.evidence_refs.length > 0
    ? flow.evidence_refs
    : Array.isArray(nextAction?.evidence_refs)
      ? nextAction.evidence_refs
      : [];
  const visibleEvidence = providerFocusActive
    ? evidenceRows
    : evidenceRefs.length > 0
    ? artifactRowsForRefs(evidenceRefs, evidenceRows, stage.id)
    : providerFocusActive
      ? evidenceRows
      : [];
  const deliveryMode =
    flow?.writeback_policy?.mode ??
    nextAction?.bounded_execution?.requested_delivery_mode ??
    nextAction?.mission_state?.delivery_mode ??
    "no-write";
  const displayedDeliveryMode = completed ? "read-only" : deliveryMode;
  const displayedSafetyStatus = completed
    ? "Completed evidence locked"
    : deliveryMode === "no-write"
      ? "No upstream writes"
      : "Explicit review required";
  const artifactReadiness = nextAction?.artifact_readiness ?? null;
  const resolverPrimary = providerFocusActive
    ? providerFocusPrimaryAction(providerStepStatus, externalRunHealth, nextAction, repairCompletion)
    : completed
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
  const completedRepairActionActive = resolverPrimary?.action_id === "quality-repair-run-completed";
  const verificationPrimary = completed || (isQualityRepairPrimaryAction(resolverPrimary) && !completedRepairActionActive)
    ? null
    : verificationFailurePrimaryAction(verificationPlan, verificationFailures, resolverPrimary, qualityGate);
  const nextPrimary = verificationPrimary ?? resolverPrimary;
  const hasOpenDecisionRequest = providerFocusActive && (
    externalRunHealthHasOpenDecisionRequest(externalRunHealth)
    || visibleEvidence.some((row) => {
      return isOperatorDecisionRequestRow(row) && isOpenOperatorDecisionStatus(row.status);
    })
  );
  const workbenchAction = verificationPrimary
    ? verificationPrimary.action_id === "request-repair-after-verification-failure"
      ? { label: "Repair Decision", icon: "target", tabId: "decisions" }
      : { label: "Recovery Path", icon: "target", tabId: "execution" }
    : externalRunWorkbenchAction(
      providerFocusActive ? externalRunHealth : null,
      hasOpenDecisionRequest,
    );
  const primaryActionButton = completed
    ? {
        label: "Inspect Evidence",
        icon: "eye",
        onClick: () => openAdvancedWorkbench("evidence"),
        disabled: busy,
      }
    : verificationPrimary
    ? {
      label: workbenchAction.label,
      icon: workbenchAction.icon,
      onClick: () => openAdvancedWorkbench(workbenchAction.tabId),
      disabled: busy,
    }
    : providerFocusActive
    ? {
      label: isBlockingExternalRunHealth(externalRunHealth) ? workbenchAction.label : "Refresh Run Status",
      icon: isBlockingExternalRunHealth(externalRunHealth) ? workbenchAction.icon : "refresh",
      onClick: isBlockingExternalRunHealth(externalRunHealth)
        ? () => openAdvancedWorkbench(workbenchAction.tabId)
        : onRefresh,
      disabled: busy,
    }
    : {
      label: "Resolve Next Action",
      icon: "play",
      onClick: onResolveNext,
      disabled: busy,
  };
  const actionStage = STAGES.find((candidate) => candidate.id === currentStage) ?? stage;
  const stageRuntimeState = selectedStageRuntimeState(stage, currentStage, completed);
  const stageRuntimeCopy = selectedStageRuntimeCopy(stage, actionStage, stageRuntimeState, completed);
  const cockpitVerificationFailureCopy = verificationFailureSummary(verificationPlan, verificationFailures);
  const cockpitTitle = verificationPrimary
    ? "Post-run verification failed"
    : providerFocusActive && isBlockingExternalRunHealth(externalRunHealth)
    ? providerFocusTitle(providerStepStatus, externalRunHealth)
    : completed ? "Learning / Closure" : stage.label;
  const cockpitStatus = verificationPrimary
    ? "failed"
    : providerFocusActive && isBlockingExternalRunHealth(externalRunHealth)
    ? externalRunDerivedEvidenceStatus(externalRunHealth)
    : stageRuntimeState;
  const cockpitCopy = cockpitVerificationFailureCopy
    ?? (providerFocusActive && isBlockingExternalRunHealth(externalRunHealth)
    ? providerFocusDescription(providerStepStatus, externalRunHealth, nextAction, repairCompletion, verificationPlan)
    : stageRuntimeCopy);
  const showCockpitStatus = !headingRepeatsStatus(cockpitTitle, cockpitStatus);
  const showCockpitHeadingAction = !providerFocusActive;
  const recommendedActionStatus = verificationPrimary
    ? "failed"
    : providerFocusActive && isBlockingExternalRunHealth(externalRunHealth)
      ? externalRunDerivedEvidenceStatus(externalRunHealth)
      : blockers.length > 0
        ? "blocked"
        : completed
          ? "read-only"
          : "ready";
  const projectRunIdentity = projectRunEvidenceIdentity(providerStepStatus, externalRunHealth);
  const projectRunStatus = projectRunEvidenceStatus(providerStepStatus, externalRunHealth);
  const actionOutcome = actionOutcomeTitle(nextPrimary, actionStage, { completed, providerFocusActive });
  const actionDetail = actionOutcomeDetail(nextPrimary, { completed, providerFocusActive });
  const actionCommand = actionCommandTitle(nextPrimary);
  const actionCommandDisclosureLabel = `Show recommended CLI command: ${compactVisibleValue(actionCommand, "command")}`;
  const openAdvancedWorkbench = (tabId = "evidence") => {
    if (typeof document === "undefined") return;
    const requestedTab = ADVANCED_WORKBENCH_TAB_IDS.has(tabId) ? tabId : "evidence";
    if (typeof window !== "undefined" && typeof window.dispatchEvent === "function" && typeof window.CustomEvent === "function") {
      window.dispatchEvent(new window.CustomEvent(ADVANCED_WORKBENCH_FOCUS_EVENT, { detail: { tabId: requestedTab } }));
    }
    const focusWorkbench = () => {
      const workbench = document.getElementById("flow-advanced-workbench");
      if (!workbench) return;
      workbench.scrollIntoView({ block: "start" });
      const summary = workbench.querySelector("summary");
      if (summary && typeof summary.focus === "function") summary.focus({ preventScroll: true });
    };
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(focusWorkbench);
    } else {
      focusWorkbench();
    }
  };
  const providerHeartbeatPanel = providerStepStatus ? (
    <div className={`provider-heartbeat-card ${providerStepStatus.status}`}>
      <div className="provider-heartbeat-header">
        <div>
          <span>Provider heartbeat</span>
          <h3>{providerStepStatus.provider ?? "External provider"}</h3>
        </div>
        <StatusPill state={providerStepStatus.status} />
      </div>
      <p>{providerStatusCopy(providerStepStatus, currentStage, verificationPrimary, externalRunHealth)}</p>
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
          <strong>{providerLastOutputLabel(providerStepStatus)}</strong>
        </div>
        <div>
          <span>Last progress</span>
          <strong>{providerLastProgressLabel(providerStepStatus)}</strong>
        </div>
        <div>
          <span>Activity</span>
          <strong>{providerActivityLabel(providerStepStatus)}</strong>
        </div>
        <div>
          <span>Last artifact</span>
          <strong>{formatProviderTimestamp(providerStepStatus.last_artifact_update_at)}</strong>
        </div>
        <div>
          <span>Output mode</span>
          <strong>{providerOutputModeLabel(providerStepStatus)}</strong>
        </div>
      </div>
      <div className="provider-heartbeat-action">
        <span title={providerStepStatus.current_command_label ?? ""}>{providerCommandDisplayLabel(providerStepStatus)}</span>
        <strong>{providerCommandDetail(providerStepStatus, currentStage, verificationPrimary, externalRunHealth)}</strong>
        {isGenericProviderCommandLabel(providerStepStatus.current_command_label) ? (
          <small>Raw runner label: external-provider-runner</small>
        ) : null}
      </div>
    </div>
  ) : null;

  return (
    <section className={`work-card flow-cockpit ${completed ? "read-only" : "active"}`}>
      <div className="work-heading">
        <div>
          <div className="heading-line">
            <h2>{cockpitTitle}</h2>
            {showCockpitStatus ? <StatusPill state={cockpitStatus} /> : null}
          </div>
          <p>{cockpitCopy}</p>
        </div>
        {showCockpitHeadingAction ? (
          <button className="secondary" type="button" onClick={onAsk}>
            <Icon name={completed ? "eye" : "target"} />
            {completed ? "Inspect" : "Ask AOR"}
          </button>
        ) : null}
      </div>

      <div className="recommended-action">
        <div className="action-header">
          <div>
            <h3>One Recommended Action</h3>
            <p>{completed ? "Inspect locked evidence before starting follow-up work" : "Single safest next step"}</p>
          </div>
          <StatusPill state={recommendedActionStatus} />
        </div>
        <div className="cockpit-actions">
          <button className="primary" type="button" onClick={primaryActionButton.onClick} disabled={primaryActionButton.disabled}>
            <Icon name={primaryActionButton.icon} />
            {primaryActionButton.label}
          </button>
          {completed ? (
            <button className="secondary workbench-jump" type="button" onClick={followUpEligible ? onCreateFollowUp : onStartNewFlow} disabled={busy}>
              <Icon name={followUpEligible ? "target" : "plus"} />
              {followUpEligible ? "Create Follow-up" : "Start New Flow"}
            </button>
          ) : !verificationPrimary && !isBlockingExternalRunHealth(externalRunHealth) ? (
            <button className="secondary workbench-jump" type="button" onClick={() => openAdvancedWorkbench(workbenchAction.tabId)}>
              <Icon name={workbenchAction.icon} />
              {workbenchAction.label}
            </button>
          ) : null}
          <button className="secondary" type="button" onClick={onRefresh} disabled={busy}>
            <Icon name="refresh" />
            {providerFocusActive ? "Refresh Run Status" : "Refresh"}
          </button>
        </div>
        <div className="action-grid">
          <div className="next-step-panel">
            <span>What happens next</span>
            <strong>{actionOutcome}</strong>
            <p>{actionDetail}</p>
            <details className="debug-ref-details action-command-details">
              <summary aria-label={actionCommandDisclosureLabel} title={actionCommandDisclosureLabel}>Show CLI command</summary>
              <CompactInlineValue value={actionCommand} kind="command" />
            </details>
            {nextPrimary.held_action_label ? (
              <div className="held-action-note">
                <span>Held downstream action</span>
                <CompactInlineValue value={nextPrimary.held_action_label} kind="command" className="held-action-value" />
              </div>
            ) : null}
          </div>
          <div>
            <span>Runtime root</span>
            <CompactInlineValue value={projectState?.runtime_root ?? activeProject?.runtime_root ?? config?.runtime_root ?? ".aor"} kind="path" />
          </div>
          <div>
            <span>Write-back mode</span>
            <code>{displayedDeliveryMode}</code>
          </div>
          <div>
            <span>Safety status</span>
            <strong>{displayedSafetyStatus}</strong>
          </div>
        </div>
      </div>

      {providerHeartbeatPanel}

      {!completed ? (
        <div className="active-flow-handoff" aria-label="Active flow status summary">
          <div>
            <span>{providerFocusActive ? "Run evidence" : "Active flow id"}</span>
            <strong title={providerFocusActive ? projectRunIdentity : flow?.flow_id ?? flow?.mission_id ?? ""}>
              {providerFocusActive
                ? projectRunIdentity
                : flow?.flow_id ?? flow?.mission_id ?? "active flow"}
            </strong>
          </div>
          <div>
            <span>Next action</span>
            <strong title={actionCommand}>{compactVisibleValue(actionCommand, "command")}</strong>
          </div>
          <div>
            <span>No-write safety</span>
            <strong>{deliveryMode === "no-write" ? "On" : "Explicit review"}</strong>
          </div>
          <div>
            <span>Evidence count</span>
            <strong>{visibleEvidence.length}</strong>
          </div>
        </div>
      ) : null}

      <FlowTimeline currentStage={currentStage} completed={completed} />

      <QualityGatePanel
        gate={qualityGate}
        evidenceRows={evidenceRows}
        verificationPlan={verificationPlan}
        verificationFailures={verificationFailures}
      />
      <VerificationFailureBanner plan={verificationPlan} failures={verificationFailures} heldAction={resolverPrimary} />

      {completed ? (
        <div className="flow-lock-banner">
          <Icon name="lock" />
          <div>
            <strong>Flow completed - evidence locked</strong>
            <p>{followUpEligible ? "Mutation controls are replaced by no-write inspection actions. Create a follow-up from the learning handoff to continue with closure guidance." : "Mutation controls are replaced by no-write inspection actions. Start New Flow to continue work."}</p>
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

      <ActionContextGrid
        stage={actionStage}
        action={nextPrimary}
        evidenceRefs={evidenceRefs}
        evidenceRows={evidenceRows}
        blockers={blockers}
        deliveryMode={displayedDeliveryMode}
        artifactReadiness={artifactReadiness}
        projectLevelProviderFocus={providerFocusActive}
        externalRunHealth={externalRunHealth}
      />

      <div className="flow-snapshot-grid">
        <div>
          <span>{providerFocusActive && externalRunHealth ? externalRunAttentionLabel(externalRunHealth) : "Blockers"}</span>
          <strong>{blockers.length}</strong>
          <p>{blockers.length === 0 ? externalRunAttentionEmptyCopy(externalRunHealth) : blockers[0]?.summary ?? blockers[0]?.code}</p>
        </div>
        <div>
          <span>Evidence artifacts</span>
          <strong>{visibleEvidence.length}</strong>
          <p title={visibleEvidence[0]?.rawRef ?? ""}>{visibleEvidence[0] ? conciseArtifactLabel(visibleEvidence[0]) : "No flow evidence yet."}</p>
        </div>
        <div>
          <span>{providerFocusActive ? "Run evidence" : "Flow ID"}</span>
          <strong>{providerFocusActive ? projectRunStatus : flow?.mission_id ?? "draft"}</strong>
          <p title={providerFocusActive ? projectRunIdentity : flow?.flow_id ?? ""}>
            {compactVisibleValue(providerFocusActive
              ? projectRunIdentity
              : flow?.flow_id ?? "Mission packet will create the flow identity.")}
          </p>
        </div>
      </div>

      <StageSpecificPanel
        stage={stage}
        completed={completed}
        flow={flow}
        evidenceRefs={evidenceRefs}
        evidenceRows={evidenceRows}
        blockers={blockers}
        deliveryMode={displayedDeliveryMode}
        projectLevelProviderFocus={providerFocusActive}
        externalRunHealth={externalRunHealth}
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

function RightRail({ nextAction, selectedFlow, projectState, config, activeProject = null, operatorRequests, flows = [], newFlowDraft = false, missionDraft = null, evidenceRows = [], providerStepStatus = null, externalRunHealth = null, providerFocus = false, repairCompletion = null }) {
  const completed = isCompletedFlow(selectedFlow);
  const projectLevelProviderFocus = !selectedFlow && !newFlowDraft && Boolean(providerStepStatus || externalRunHealth);
  const blockingExternalRunHealth = !completed && !newFlowDraft && isBlockingExternalRunHealth(externalRunHealth);
  const providerFocusActive = providerFocus || projectLevelProviderFocus || blockingExternalRunHealth;
  const activeFlows = flows.filter((flow) => flow.status === "active");
  const completedFlows = flows.filter((flow) => flow.status === "completed");
  const onboarding = projectState?.onboarding_summary ?? activeProject?.onboarding_summary ?? {};
  const runtimeReady = Boolean(projectState?.state_file) || onboarding.initialized === true || onboarding.state_exists === true;
  let nextPrimary = nextAction?.primary_action ?? {};
  if (providerFocusActive) {
    nextPrimary = providerFocusPrimaryAction(providerStepStatus, externalRunHealth, nextAction, repairCompletion);
  } else if (!selectedFlow && !newFlowDraft) {
    nextPrimary = projectLevelProviderFocus
      ? providerFocusPrimaryAction(providerStepStatus, externalRunHealth, nextAction, repairCompletion)
      : runtimeReady
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
  const verificationPlan = projectState?.verification_plan ?? null;
  const qualityGate = !completed && selectedFlow?.active_quality_gate ? selectedFlow.active_quality_gate : null;
  const verificationFailures = completed ? [] : failedRequiredVerificationGroups(verificationPlan);
  const completedRepairActionActive = nextPrimary?.action_id === "quality-repair-run-completed";
  const verificationPrimary = completed || (isQualityRepairPrimaryAction(nextPrimary) && !completedRepairActionActive)
    ? null
    : verificationFailurePrimaryAction(verificationPlan, verificationFailures, nextPrimary, qualityGate);
  nextPrimary = verificationPrimary ?? nextPrimary;
  const actionBlockers = providerFocusActive && externalRunHealth
    ? externalRunHealthBlockers(externalRunHealth)
    : Array.isArray(nextAction?.blockers) && !completed ? nextAction.blockers : [];
  const repairNextActionSummary = providerFocusActive && externalRunRecoveryPathActive(externalRunHealth)
    ? materializedQualityRepairSummary(nextAction, repairCompletion, verificationPlan)
    : null;
  const presentedActionBlockers = repairNextActionSummary && actionBlockers.length > 0
    ? actionBlockers.map((blocker, index) => index === 0 ? { ...blocker, summary: repairNextActionSummary } : blocker)
    : actionBlockers;
  const verificationBlockers = verificationFailures.map((group, index) => verificationFailureBlocker(group, index));
  const blockers = verificationFailures.length > 0
    ? [...verificationBlockers, ...presentedActionBlockers]
    : [...presentedActionBlockers, ...verificationBlockers];
  const evidenceRefs = Array.isArray(selectedFlow?.evidence_refs) && selectedFlow.evidence_refs.length > 0
    ? selectedFlow.evidence_refs
    : Array.isArray(nextAction?.evidence_refs)
      ? nextAction.evidence_refs
      : [];
  const visibleEvidence = providerFocusActive
    ? evidenceRows
    : evidenceRefs.length > 0
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
    (providerFocusActive || (!selectedFlow && !newFlowDraft) ? latestDecisionRequestFromEvidence(evidenceRows) : null);
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
        <h3>{providerFocusActive && externalRunHealth ? externalRunAttentionLabel(externalRunHealth) : "Blockers"} <span>{blockers.length}</span></h3>
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
              <strong>{conciseArtifactLabel(row)}</strong>
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
        <p><CompactInlineValue value={projectState?.runtime_root ?? activeProject?.runtime_root ?? config?.runtime_root ?? ".aor"} kind="path" /></p>
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
        ) : providerFocusActive ? (
          <div className="flow-inventory-row selected">
            <strong>{providerFocusTitle(providerStepStatus, externalRunHealth)}</strong>
            <span>{isBlockingExternalRunHealth(externalRunHealth) ? externalRunDerivedEvidenceStatus(externalRunHealth) : externalRunHealth?.status ?? providerStepStatus?.status}</span>
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

function EvidenceWorkbench({ rows, selectedRef, setSelectedRef, attachTarget, copyRef, qualityClosureContext = null }) {
  const [filter, setFilter] = useState("all");
  const qualityPlan = qualityClosurePlan(rows, qualityClosureContext);
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
      <div className="quality-closure-path" aria-label="Quality closure path">
        <div className="quality-closure-heading">
          <span>Quality closure</span>
          <strong>{qualityPlan.heading}</strong>
          <p>{qualityPlan.detail}</p>
        </div>
        <ol>
          {qualityPlan.steps.map((step) => (
            <li key={step.id} className={step.status}>
              <span>{step.label}</span>
              <strong>{step.title}</strong>
              <p>{step.detail}</p>
            </li>
          ))}
        </ol>
      </div>
      <div className="artifact-filter-bar" aria-label="Artifact filters">
        {ARTIFACT_FILTERS.map((entry) => (
          <button
            key={entry.id}
            className={filter === entry.id ? "selected" : ""}
            type="button"
            aria-pressed={filter === entry.id}
            onClick={() => setFilter(entry.id)}
          >
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
                      <button
                        className="artifact-summary-button"
                        type="button"
                        onClick={() => setSelectedRef(row.ref)}
                        title={row.label}
                        aria-label={artifactActionLabel("open", row)}
                      >
                        <strong>{conciseArtifactLabel(row)}</strong>
                        <span>{row.kind}</span>
                      </button>
                    </td>
                    <td><StatusPill state={row.status ?? "ready"} /></td>
                    <td className="row-actions">
                      <IconButton label={artifactActionLabel("copy", row)} onClick={() => copyRef(row.rawRef ?? row.ref)}><Icon name="copy" /></IconButton>
                      <IconButton label={artifactActionLabel("attach", row)} onClick={() => attachTarget(row.rawRef ?? row.ref)}><Icon name="target" /></IconButton>
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
              <strong title={selected.label}>{conciseArtifactLabel(selected)}</strong>
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
            const decisionFieldId = interactionDomId(selectedInteraction, "decision");
            const answerFieldId = interactionDomId(selectedInteraction, "answer");
            const recoveryPlan = interactionRecoveryPlan(selectedInteraction, answer);
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
                <div className="interaction-recovery-path" aria-label="Interaction answer recovery path">
                  <div className="interaction-recovery-heading">
                    <span>Answer path</span>
                    <strong>Resolve runtime question first</strong>
                    <p>The run stays paused until an audited answer is submitted for this interaction.</p>
                  </div>
                  <ol>
                    <li className="active">
                      <span>Runtime question</span>
                      <strong>{recoveryPlan.promptSummary}</strong>
                      <p>{recoveryPlan.interactionType}</p>
                    </li>
                    <li>
                      <span>Evidence to inspect</span>
                      <strong>{recoveryPlan.evidenceLabel}</strong>
                      <p>Inspect the step result before choosing an answer.</p>
                    </li>
                    <li className={canSend ? "ready" : ""}>
                      <span>Unlock condition</span>
                      <strong>{recoveryPlan.submitState}</strong>
                      <p>{recoveryPlan.submitCopy}</p>
                    </li>
                  </ol>
                </div>
                <div className="allowed-answer-types">
                  <span>Allowed answer types</span>
                  <strong>approve_once</strong>
                  <strong>approve_for_run</strong>
                  <strong>deny</strong>
                </div>
                <div className="interaction-row" aria-label="Submit runtime interaction answer">
                  <div>
                    <label htmlFor={decisionFieldId}>Answer type</label>
                    <select id={decisionFieldId} name="interaction-decision" value={answer.decision} onChange={(event) => setAnswers({ ...answers, [key]: { ...answer, decision: event.target.value } })}>
                      <option value="">Free-form answer</option>
                      <option value="approve_once">approve_once</option>
                      <option value="deny">deny</option>
                      <option value="approve_for_run">approve_for_run</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor={answerFieldId}>Answer or reason</label>
                    <input id={answerFieldId} name="interaction-answer" value={answer.answer} placeholder="Write the answer, reason, or approval note" onChange={(event) => setAnswers({ ...answers, [key]: { ...answer, answer: event.target.value } })} />
                    <span>{recoveryPlan.answerChoice}</span>
                  </div>
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

function preferredOperatorDecisionAction(externalRunHealth, supportedActions, selectedRequest = null) {
  const actions = Array.isArray(supportedActions) ? supportedActions : [];
  const requestStatus = normalizeOperatorDecisionStatus(selectedRequest?.status, "");
  const rubricRecommendedAction = String(selectedRequest?.decisionRubricSummary?.recommended_action ?? "").trim();
  if (requestStatus === "rejected" && actions.includes(rubricRecommendedAction)) return rubricRecommendedAction;
  if (isControllerDecisionPendingRunHealth(externalRunHealth) && actions.includes("continue")) return "continue";
  const pendingAction = String(externalRunHealth?.pending_decision?.action ?? "").trim();
  if (pendingAction && actions.includes(pendingAction)) return pendingAction;
  if (actions.includes("continue")) return "continue";
  return actions[0] ?? "continue";
}

function operatorDecisionActionOutcomeCopy(actionId) {
  switch (actionId) {
    case "continue":
      return "Continue only after the required checks pass or remain bounded warnings.";
    case "diagnose":
      return "Record a diagnosis as a stop state; repair or retry must happen through public controls before continuation.";
    case "block":
      return "Record a blocker decision when continuation is unsafe or evidence is incomplete.";
    case "retry_public_step":
      return "Retry the public step only after the blocker has been reviewed.";
    case "answer":
      return "Answer the operator question through the interaction surface before continuing.";
    case "frontend_interact":
      return "Complete the browser evidence check before continuing.";
    default:
      return "Record the selected action after the request evidence has been reviewed.";
  }
}

function operatorDecisionChecklistItems(selectedRequest, selectedActionEntry) {
  if (!selectedRequest) return [];
  const actionLabel = selectedActionEntry?.label ?? "selected action";
  return [
    {
      label: "Inspect the decision request",
      detail: "Copy or open the request ref before deciding.",
    },
    {
      label: "Confirm evidence coverage",
      detail: `Use the required evidence artifacts from the request rubric before recording ${actionLabel}.`,
    },
    {
      label: "Record selected action",
      detail: `${actionLabel}: ${operatorDecisionActionOutcomeCopy(selectedActionEntry?.id)}`,
    },
    {
      label: "Refresh run status",
      detail: "Confirm the blocker clears or remains actionable after the decision is recorded.",
    },
  ];
}

function normalizeDecisionRubricSummary(value) {
  const raw = value && typeof value === "object" ? value : null;
  if (!raw) return null;
  const requiredChecks = Array.isArray(raw.required_checks)
    ? raw.required_checks.filter((entry) => typeof entry === "string" && entry.trim().length > 0)
    : [];
  const evidenceRefs = Array.isArray(raw.evidence_refs)
    ? raw.evidence_refs
      .map((entry, index) => {
        const record = entry && typeof entry === "object" ? entry : {};
        const ref = typeof record.ref === "string" ? record.ref.trim() : "";
        if (!ref) return null;
        return {
          label: typeof record.label === "string" && record.label.trim() ? record.label.trim() : `Evidence ${index + 1}`,
          ref,
        };
      })
      .filter(Boolean)
    : [];
  const requiredCheckCount = Number.isFinite(Number(raw.required_check_count))
    ? Number(raw.required_check_count)
    : requiredChecks.length;
  const requiredEvidenceRefCount = Number.isFinite(Number(raw.required_evidence_ref_count))
    ? Number(raw.required_evidence_ref_count)
    : evidenceRefs.length;
  if (requiredCheckCount === 0 && requiredEvidenceRefCount === 0 && evidenceRefs.length === 0) return null;
  return {
    requiredCheckCount,
    requiredEvidenceRefCount,
    requiredChecks,
    evidenceRefs,
    evidenceRefOverflowCount: Number.isFinite(Number(raw.evidence_ref_overflow_count)) ? Number(raw.evidence_ref_overflow_count) : 0,
    deterministicStatus: typeof raw.deterministic_status === "string" ? raw.deterministic_status : "",
    recommendedAction: typeof raw.recommended_action === "string" ? raw.recommended_action : "",
    failureClass: typeof raw.failure_class === "string" ? raw.failure_class : "",
  };
}

function operatorDecisionRecordPlan(selectedRequest, selectedActionEntry, externalRunHealth) {
  if (!selectedRequest) return null;
  const pending = externalRunHealth?.pending_decision ?? {};
  const expectedDecisionRef = typeof pending.expected_decision_ref === "string" ? pending.expected_decision_ref.trim() : "";
  const requestRef = typeof pending.request_ref === "string" ? pending.request_ref.trim() : "";
  const matchesSelectedRequest = !requestRef || evidenceRefsMatch(requestRef, selectedRequest.ref);
  return {
    actionLabel: selectedActionEntry?.label ?? "Selected action",
    semanticStatus: selectedActionEntry?.semanticStatus ?? "pending",
    expectedDecisionRef: matchesSelectedRequest ? expectedDecisionRef : "",
  };
}

function operatorDecisionHelperFinding(actionId) {
  switch (actionId) {
    case "continue":
      return "Required public evidence refs were inspected.";
    case "diagnose":
      return "Required evidence was inspected and the blocker needs diagnosis.";
    case "block":
      return "Required evidence was inspected and continuation is unsafe.";
    case "retry_public_step":
      return "Required evidence was inspected before retrying the public step.";
    case "answer":
      return "Requested interaction evidence was inspected before answering.";
    case "frontend_interact":
      return "Browser evidence requirements were inspected before frontend interaction.";
    default:
      return "Required public evidence refs were inspected.";
  }
}

function operatorDecisionHelperPlan(selectedRequest, selectedActionEntry, decisionRecordPlan, externalRunHealth) {
  if (!selectedRequest) return null;
  const requestRef = String(selectedRequest.ref ?? "").trim();
  const actionId = selectedActionEntry?.id ?? "continue";
  const finding = operatorDecisionHelperFinding(actionId);
  const expectedDecisionRef = decisionRecordPlan?.expectedDecisionRef ?? "";
  const semanticStatus = selectedActionEntry?.semanticStatus ?? "pending";
  const handoff = {
    request_ref: requestRef,
    action: actionId,
    semantic_status: semanticStatus,
    finding,
    expected_decision_ref: expectedDecisionRef,
    inspected_evidence_refs: "auto-fill from decision rubric",
  };
  return {
    canPrepareFromRef: Boolean(requestRef),
    helperLabel: "Selected action handoff",
    requestRef,
    actionLabel: selectedActionEntry?.label ?? actionId,
    actionNote: `${selectedActionEntry?.label ?? actionId}: ${finding}`,
    handoffJson: JSON.stringify(handoff, null, 2),
    expectedDecisionRef,
    runId: String(externalRunHealth?.run_id ?? "").trim(),
  };
}

function operatorDecisionResumePath(selectedRequest, selectedActionEntry, decisionRecordPlan) {
  if (!selectedRequest) return [];
  const requestRef = String(selectedRequest.ref ?? "").trim();
  const expectedDecisionRef = String(decisionRecordPlan?.expectedDecisionRef ?? "").trim();
  const actionLabel = selectedActionEntry?.label ?? "Selected action";
  return [
    {
      label: "1. Inspect request",
      title: requestRef ? "Request is linked" : "Request ref missing",
      detail: requestRef
        ? "Open the decision request and inspect every required evidence item before choosing an action."
        : "The runtime has not exposed a decision request ref yet; refresh run status before recording an action.",
      status: requestRef ? "ready" : "blocked",
    },
    {
      label: "2. Record decision",
      title: expectedDecisionRef ? "Decision file ready" : "Decision file missing",
      detail: expectedDecisionRef
        ? `${actionLabel} must be written to the expected decision file after evidence coverage is complete.`
        : "The expected decision destination is unavailable; use the request handoff before continuing.",
      status: expectedDecisionRef ? "ready" : "blocked",
    },
    {
      label: "3. Resume run",
      title: expectedDecisionRef ? "Resume after write" : "Resolve destination first",
      detail: expectedDecisionRef
        ? "Resume the run with the completed decision artifact, then refresh this console to verify the blocker cleared."
        : "AOR needs a materialized decision artifact before the current run can move to the next step.",
      status: expectedDecisionRef ? "ready" : "blocked",
    },
  ];
}

function isRejectedOperatorDecision(selectedRequest) {
  const status = String(selectedRequest?.status ?? "").trim().toLowerCase();
  return status === "rejected" || Boolean(String(selectedRequest?.rejectionReason ?? "").trim());
}

function operatorDecisionCorrectionPlan(selectedRequest, selectedActionEntry, decisionRubric, decisionRecordPlan) {
  if (!isRejectedOperatorDecision(selectedRequest)) return null;
  const rejectionReason = String(selectedRequest?.rejectionReason ?? "").trim() || "The previous decision was rejected by validation.";
  const actionId = selectedActionEntry?.id ?? "continue";
  const actionLabel = selectedActionEntry?.label ?? actionId;
  const semanticStatus = selectedActionEntry?.semanticStatus ?? "pending";
  const expectedDecisionRef = decisionRecordPlan?.expectedDecisionRef ?? "";
  const requiredEvidenceRefCount = decisionRubric?.requiredEvidenceRefCount ?? 0;
  const requiredCheckCount = decisionRubric?.requiredCheckCount ?? 0;
  const correction = {
    request_ref: selectedRequest?.ref ?? "",
    replacement_action: actionId,
    semantic_status: semanticStatus,
    rejection_reason: rejectionReason,
    expected_decision_ref: expectedDecisionRef,
    required_evidence_ref_count: requiredEvidenceRefCount,
    required_check_count: requiredCheckCount,
  };
  return {
    rejectionReason,
    actionLabel,
    semanticStatus,
    expectedDecisionRef,
    requiredEvidenceRefCount,
    requiredCheckCount,
    correctionJson: JSON.stringify(correction, null, 2),
  };
}

function OperatorDecisionDrawer({ decisionRequests, copyRef, busy, externalRunHealth = null, publicRepairDecision = null }) {
  const selectedRequest = decisionRequests[0] ?? null;
  const hasPublicRepairDecision = !selectedRequest && Boolean(publicRepairDecision?.command);
  const supportedActions = selectedRequest?.supportedActions ?? OPERATOR_DECISION_ACTIONS.map((action) => action.id);
  const preferredAction = preferredOperatorDecisionAction(externalRunHealth, supportedActions, selectedRequest);
  const [selectedAction, setSelectedAction] = useState(preferredAction);
  const selectedActionEntry = OPERATOR_DECISION_ACTIONS.find((entry) => entry.id === selectedAction) ?? OPERATOR_DECISION_ACTIONS[0];
  const decisionChecklist = operatorDecisionChecklistItems(selectedRequest, selectedActionEntry);
  const decisionRubric = normalizeDecisionRubricSummary(selectedRequest?.decisionRubricSummary);
  const decisionRecordPlan = operatorDecisionRecordPlan(selectedRequest, selectedActionEntry, externalRunHealth);
  const decisionHelperPlan = operatorDecisionHelperPlan(selectedRequest, selectedActionEntry, decisionRecordPlan, externalRunHealth);
  const decisionResumePath = operatorDecisionResumePath(selectedRequest, selectedActionEntry, decisionRecordPlan);
  const decisionCorrectionPlan = operatorDecisionCorrectionPlan(selectedRequest, selectedActionEntry, decisionRubric, decisionRecordPlan);
  const rejectionReason = selectedRequest?.rejectionReason ?? "";
  useEffect(() => {
    setSelectedAction(preferredAction);
  }, [preferredAction, selectedRequest?.ref]);
  return (
    <section className="work-card operator-decision-drawer">
      <div className="work-heading compact-heading">
        <div>
          <h3>{hasPublicRepairDecision ? "Repair Decision" : "Operator Decision"}</h3>
          <p>{hasPublicRepairDecision ? "Prepare the public repair decision from failed verification evidence." : "Review the runtime decision request and choose the bounded operator action."}</p>
        </div>
        <StatusPill state={selectedRequest ? selectedRequest.status : hasPublicRepairDecision ? "repair needed" : "no request"} />
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
          {rejectionReason && !decisionCorrectionPlan ? (
            <div className="decision-rejection-copy">
              <span>Rejected decision reason</span>
              <strong>{rejectionReason}</strong>
            </div>
          ) : null}
          {decisionCorrectionPlan ? (
            <div className="decision-correction-plan" aria-label="Rejected decision correction plan">
              <div className="decision-correction-heading">
                <div>
                  <span>Correction required</span>
                  <strong>{decisionCorrectionPlan.actionLabel} / {decisionCorrectionPlan.semanticStatus}</strong>
                  <p>The previous decision was rejected. Reuse this request, fix the validation gap, and record a replacement action.</p>
                </div>
                <StatusPill state="rejected" />
              </div>
              <div className="decision-correction-grid">
                <div>
                  <span>Rejected reason</span>
                  <strong>{decisionCorrectionPlan.rejectionReason}</strong>
                </div>
                <div>
                  <span>Rubric coverage</span>
                  <strong>{decisionCorrectionPlan.requiredCheckCount} checks / {decisionCorrectionPlan.requiredEvidenceRefCount} refs</strong>
                </div>
                <div>
                  <span>Expected file</span>
                  <strong>{decisionCorrectionPlan.expectedDecisionRef ? "available" : "missing"}</strong>
                </div>
              </div>
              <div className="decision-correction-actions">
                <button className="secondary compact" type="button" onClick={() => copyRef(decisionCorrectionPlan.correctionJson)} disabled={busy}>
                  Copy correction JSON
                </button>
                <button className="secondary compact" type="button" onClick={() => copyRef(decisionCorrectionPlan.rejectionReason)} disabled={busy}>
                  Copy rejected reason
                </button>
              </div>
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
          {decisionResumePath.length > 0 ? (
            <div className="decision-resume-path" aria-label="Decision resume path">
              <div className="decision-resume-heading">
                <span>Resume path</span>
                <strong>{selectedActionEntry.label} before next step</strong>
                <p>The run is paused until the decision artifact is recorded and the status is refreshed.</p>
              </div>
              <ol>
                {decisionResumePath.map((item) => (
                  <li key={item.label} className={item.status}>
                    <span>{item.label}</span>
                    <strong>{item.title}</strong>
                    <p>{item.detail}</p>
                  </li>
                ))}
              </ol>
              {decisionRecordPlan?.expectedDecisionRef ? (
                <button className="secondary compact" type="button" onClick={() => copyRef(decisionRecordPlan.expectedDecisionRef)} disabled={busy} title={decisionRecordPlan.expectedDecisionRef}>
                  Copy decision file ref
                </button>
              ) : null}
            </div>
          ) : null}
          {decisionRubric ? (
            <div className="decision-rubric-summary" aria-label="Decision evidence rubric">
              <div className="decision-rubric-heading">
                <span>Evidence rubric</span>
                <strong>{decisionRubric.requiredCheckCount} checks / {decisionRubric.requiredEvidenceRefCount} refs</strong>
              </div>
              <div className="decision-rubric-facts">
                <div>
                  <span>Recommended action</span>
                  <strong>{decisionRubric.recommendedAction || selectedActionEntry.label}</strong>
                </div>
                <div>
                  <span>Deterministic status</span>
                  <strong>{decisionRubric.deterministicStatus || selectedActionEntry.semanticStatus}</strong>
                </div>
                {decisionRubric.failureClass ? (
                  <div>
                    <span>Failure class</span>
                    <strong>{decisionRubric.failureClass}</strong>
                  </div>
                ) : null}
              </div>
              <div className="decision-rubric-columns">
                <div>
                  <span>Required checks</span>
                  {decisionRubric.requiredChecks.length > 0 ? (
                    <ul>
                      {decisionRubric.requiredChecks.map((check) => <li key={check}>{check}</li>)}
                    </ul>
                  ) : (
                    <p>No explicit check labels provided.</p>
                  )}
                </div>
                <div>
                  <span>Required evidence</span>
                  {decisionRubric.evidenceRefs.length > 0 ? (
                    <div className="decision-evidence-ref-list">
                      {decisionRubric.evidenceRefs.map((entry) => (
                        <button className="secondary compact" type="button" key={entry.ref} onClick={() => copyRef(entry.ref)} disabled={busy} title={entry.ref}>
                          {entry.label}
                        </button>
                      ))}
                      {decisionRubric.evidenceRefOverflowCount > 0 ? <p>{decisionRubric.evidenceRefOverflowCount} more refs in request.</p> : null}
                    </div>
                  ) : (
                    <p>No explicit evidence refs provided.</p>
                  )}
                </div>
              </div>
            </div>
          ) : null}
          {decisionRecordPlan ? (
            <div className="decision-record-plan" aria-label="Decision record destination">
              <div>
                <span>Decision record</span>
                <strong>{decisionRecordPlan.actionLabel} / {decisionRecordPlan.semanticStatus}</strong>
                <p>Record this decision after the required evidence has been inspected, then refresh run status.</p>
              </div>
              {decisionRecordPlan.expectedDecisionRef ? (
                <button className="secondary compact" type="button" onClick={() => copyRef(decisionRecordPlan.expectedDecisionRef)} disabled={busy} title={decisionRecordPlan.expectedDecisionRef}>
                  Copy expected decision ref
                </button>
              ) : (
                <em>Expected decision ref is not available for this request.</em>
              )}
            </div>
          ) : null}
          {decisionHelperPlan ? (
            <div className="decision-helper-plan" aria-label="Decision handoff bundle">
              <div className="decision-helper-heading">
                <div>
                  <span>Decision handoff</span>
                  <strong>{decisionHelperPlan.helperLabel}</strong>
                  <p>Copy this bundle for the decision preparation step. AOR still validates evidence coverage before resume.</p>
                </div>
                {decisionHelperPlan.runId ? <code title={decisionHelperPlan.runId}>{shortPathLabel(decisionHelperPlan.runId)}</code> : null}
              </div>
              {decisionHelperPlan.canPrepareFromRef ? (
                <>
                  <div className="decision-helper-actions">
                    <button className="secondary compact" type="button" onClick={() => copyRef(decisionHelperPlan.handoffJson)} disabled={busy}>
                      Copy handoff JSON
                    </button>
                    <button className="secondary compact" type="button" onClick={() => copyRef(decisionHelperPlan.actionNote)} disabled={busy}>
                      Copy action note
                    </button>
                    {decisionHelperPlan.expectedDecisionRef ? (
                      <button className="secondary compact" type="button" onClick={() => copyRef(decisionHelperPlan.expectedDecisionRef)} disabled={busy}>
                        Copy expected file ref
                      </button>
                    ) : (
                      <em>Expected decision file appears when the request exposes it.</em>
                    )}
                  </div>
                  <details className="decision-helper-details">
                    <summary>Show handoff JSON</summary>
                    <div>
                      <span>Handoff</span>
                      <code>{decisionHelperPlan.handoffJson}</code>
                    </div>
                    {decisionHelperPlan.expectedDecisionRef ? (
                      <div>
                        <span>Expected file</span>
                        <code>{decisionHelperPlan.expectedDecisionRef}</code>
                      </div>
                    ) : null}
                  </details>
                </>
              ) : (
                <em>Open an agent decision request ref before preparing the selected action.</em>
              )}
            </div>
          ) : null}
          {decisionChecklist.length > 0 ? (
            <div className="decision-checklist" aria-label="Decision completion checklist">
              <span>Decision checklist</span>
              <ol>
                {decisionChecklist.map((item) => (
                  <li key={item.label}>
                    <strong>{item.label}</strong>
                    <p>{item.detail}</p>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
          <details className="debug-ref-details decision-debug">
            <summary>Debug raw request ref</summary>
            <code>{selectedRequest.ref}</code>
          </details>
        </>
      ) : hasPublicRepairDecision ? (
        <div className="public-repair-decision-plan" aria-label="Public repair decision plan">
          <div>
            <span>Decision source</span>
            <strong>Public repair decision required</strong>
            <p>No separate agent request file is pending for this repair loop. Use the command below with the failed verification evidence and new repair context.</p>
          </div>
          <div>
            <span>Repair decision</span>
            <strong>{publicRepairDecision.action_label ?? "Operator repair decision"}</strong>
            <CompactInlineValue value={publicRepairDecision.command} kind="command" />
            <p>{publicRepairDecision.reason}</p>
          </div>
          {publicRepairDecision.dry_run_command ? (
            <div>
              <span>{publicRepairDecision.dry_run_label ?? "Post-repair unlock check"}</span>
              <CompactInlineValue value={publicRepairDecision.dry_run_command} kind="command" />
              <p>Run this only after the next repair completes.</p>
            </div>
          ) : null}
          <div className="public-repair-decision-actions">
            <button className="secondary compact" type="button" onClick={() => copyRef(publicRepairDecision.command)} disabled={busy}>
              Copy repair decision command
            </button>
            {publicRepairDecision.dry_run_command ? (
              <button className="secondary compact" type="button" onClick={() => copyRef(publicRepairDecision.dry_run_command)} disabled={busy}>
                Copy post-repair check
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="empty-state">No pending agent decision request for this flow.</p>
      )}
    </section>
  );
}

function ExecutionEvidencePanel({ evidence, providerEvidenceRows, copyRef, busy, externalRunHealth = null, projectContext = null, nextAction = null, repairCompletion = null, verificationPlan = null, qualityGate = null }) {
  const hasVisibleExecutionEvidence = Boolean(evidence || externalRunHealth);
  const statusRows = executionStatusRows(evidence, externalRunHealth, verificationPlan);
  const pathGroups = Array.isArray(evidence?.changed_path_groups) ? evidence.changed_path_groups : [];
  const blockers = Array.isArray(evidence?.blockers) ? evidence.blockers : [];
  const actions = Array.isArray(evidence?.actions) ? evidence.actions : [];
  const recoveryPlan = hasVisibleExecutionEvidence
    ? executionRecoveryPlan(evidence, providerEvidenceRows, blockers, actions, externalRunHealth, projectContext, nextAction, repairCompletion, verificationPlan, qualityGate)
    : null;
  return (
    <section className="work-card execution-evidence-panel">
      <div className="work-heading compact-heading">
        <div>
          <h3>Execution Evidence</h3>
          <p>Provider status, Runtime Harness decision, diff relevance, verification, and public recovery controls.</p>
        </div>
        <StatusPill state={externalRunDerivedEvidenceStatus(externalRunHealth, evidence?.status ?? "no evidence")} />
      </div>
      {!hasVisibleExecutionEvidence ? (
        <p className="empty-state">No execution evidence visible yet.</p>
      ) : (
        <>
          <div className="execution-recovery-path" aria-label="Execution evidence recovery path">
            <div className="execution-recovery-heading">
              <span>Recovery path</span>
              <strong>{recoveryPlan.headingTitle}</strong>
              <p>{recoveryPlan.headingDetail}</p>
            </div>
            <ol>
              <li className={blockers.length > 0 ? "blocked" : "ready"}>
                <span>Current state</span>
                <strong>{recoveryPlan.stateTitle}</strong>
                <p>{recoveryPlan.stateDetail}</p>
              </li>
              <li className={recoveryPlan.actionCommand ? "ready" : "blocked"}>
                <span>Next public control</span>
                <strong>{recoveryPlan.actionTitle}</strong>
                {recoveryPlan.actionCommand ? <CompactInlineValue value={recoveryPlan.actionCommand} kind="command" /> : null}
                {recoveryPlan.actionDetail ? <p>{recoveryPlan.actionDetail}</p> : null}
              </li>
              <li>
                <span>Evidence to keep</span>
                <strong>{recoveryPlan.evidenceTitle}</strong>
                <p>{recoveryPlan.evidenceDetail}</p>
                {recoveryPlan.evidenceRef ? (
                  <div className="execution-recovery-evidence-ref">
                    <span>{recoveryPlan.evidenceRefLabel || "Evidence ref"}</span>
                    <CompactInlineValue value={recoveryPlan.evidenceRef} kind="path" />
                  </div>
                ) : null}
              </li>
            </ol>
          </div>
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
              <strong>{providerEvidenceStripSummary(providerEvidenceRows)}</strong>
            </div>
            {providerEvidenceRows.length > 0 ? providerEvidenceRows.slice(0, 4).map((row) => (
              <button className="artifact-chip-button" type="button" key={row.ref} onClick={() => copyRef(row.rawRef ?? row.ref)} disabled={busy}>
                <span title={row.label}>{conciseArtifactLabel(row)}</span>
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
            <code>{JSON.stringify({
              run_id: evidence?.run_id ?? externalRunHealth?.run_id ?? externalRunHealth?.blocked_run_id ?? null,
              status: evidence?.status ?? externalRunHealth?.status ?? null,
              required_path_prefixes: evidence?.required_path_prefixes ?? externalRunHealth?.required_path_prefixes ?? [],
            })}</code>
          </details>
        </>
      )}
    </section>
  );
}

function EvidenceReadinessPath({ label, scope, count, unit, readyDetail, missingDetail, nextReady, nextMissing }) {
  const hasEvidence = count > 0;
  return (
    <div className="evidence-readiness-path" aria-label={`${label} readiness path`}>
      <div className="evidence-readiness-heading">
        <span>Readiness path</span>
        <strong>{hasEvidence ? `${label} is ready to inspect` : `${label} needs flow evidence`}</strong>
        <p>{hasEvidence ? readyDetail : missingDetail}</p>
      </div>
      <ol>
        <li className="ready">
          <span>Scope</span>
          <strong>{scope}</strong>
          <p>Only selected-flow artifacts are shown here.</p>
        </li>
        <li className={hasEvidence ? "ready" : "blocked"}>
          <span>Evidence loaded</span>
          <strong>{count} {unit}{count === 1 ? "" : "s"}</strong>
          <p>{hasEvidence ? readyDetail : missingDetail}</p>
        </li>
        <li className={hasEvidence ? "ready" : "blocked"}>
          <span>Next check</span>
          <strong>{hasEvidence ? "Inspect linked evidence" : "Refresh or create evidence"}</strong>
          <p>{hasEvidence ? nextReady : nextMissing}</p>
        </li>
      </ol>
    </div>
  );
}

function EvidenceGraphPanel({ graph }) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];
  const selectedNode = nodes[nodes.length - 1] ?? nodes[0] ?? null;
  const completedFlowsReason = "Available after completed flow";
  const lineageReason = "Available after completed flow";
  const graphScope = graph?.flow_id ? `Flow ${graph.flow_id}` : "Selected flow";
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
        <button type="button" title={completedFlowsReason} disabled>Completed Flows</button>
        <button type="button" title={lineageReason} disabled>Cross-flow Lineage</button>
      </div>
      <p className="disabled-tab-reason">Completed Flows and Cross-flow Lineage are {completedFlowsReason.toLowerCase()}.</p>
      <EvidenceReadinessPath
        label="Evidence graph"
        scope={graphScope}
        count={nodes.length}
        unit="node"
        readyDetail={`Loaded selected-flow graph: ${nodes.length} node${nodes.length === 1 ? "" : "s"}, ${edges.length} edge${edges.length === 1 ? "" : "s"}.`}
        missingDetail="No selected-flow graph nodes are loaded yet."
        nextReady="Use node summaries to verify the packet chain before opening raw artifact refs."
        nextMissing="Refresh the selected flow after a lifecycle command, or create the first flow evidence before judging traceability."
      />
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
            <strong title={node.ref}>{graphNodeArtifactLabel(node)}</strong>
            <em>{node.display_summary?.status ?? node.status ?? "linked"}</em>
          </div>
        ))}
      </div>
      {nodes.length > 0 ? (
        <div className="graph-flow-canvas" aria-label="Selected flow evidence graph">
          {nodes.slice(0, 10).map((node, index) => (
            <div className="graph-flow-node" key={node.node_id ?? node.ref}>
              <span>{index + 1}</span>
              <strong title={node.ref}>{graphNodeArtifactLabel(node)}</strong>
              <em>{node.status ?? node.family ?? "linked"}</em>
            </div>
          ))}
        </div>
      ) : null}
      {selectedNode ? (
        <div className="selected-node-panel">
          <span>Selected node</span>
          <strong title={selectedNode.ref}>{graphNodeArtifactLabel(selectedNode)}</strong>
          <p>{selectedNode.display_summary?.description ?? selectedNode.summary ?? "Selected-flow evidence node."}</p>
        </div>
      ) : null}
    </section>
  );
}

function RuntimeTracePanel({ trace }) {
  const items = Array.isArray(trace?.trace_items) ? trace.trace_items : [];
  const traceScope = trace?.flow_id ? `Flow ${trace.flow_id}` : "Selected flow";
  return (
    <section className="work-card trace-panel">
      <div className="work-heading compact-heading">
        <div>
          <h3>Runtime Trace</h3>
          <p>Run events, step results, harness decisions, and delivery artifacts for this flow.</p>
        </div>
        <StatusPill state={`${items.length} items`} />
      </div>
      <EvidenceReadinessPath
        label="Runtime trace"
        scope={traceScope}
        count={items.length}
        unit="event"
        readyDetail={`Loaded runtime trace: ${items.length} flow-scoped event${items.length === 1 ? "" : "s"}.`}
        missingDetail="No flow-scoped runtime events are loaded yet."
        nextReady="Compare run events, step results, decisions, and delivery artifacts before judging outcome quality."
        nextMissing="Refresh run status or open Execution Evidence to preserve provider refs before deciding next action."
      />
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
                <td><span className="artifact-ref-label" title={item.ref ?? item.trace_id}>{traceArtifactLabel(item)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function defaultAdvancedWorkbenchOpen() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  return window.matchMedia("(min-width: 1181px)").matches;
}

function ActivityArtifactsTables({ activity, evidenceRows, draftSurface, className = "bottom-bar", copyValue = null }) {
  return (
    <section className={className}>
      <div className="activity-table">
        <h3>Activity / Events</h3>
        <table>
          <thead><tr><th>Event</th><th>Details</th></tr></thead>
          <tbody>
            {activity.length === 0 ? <tr><td colSpan="2">No activity yet</td></tr> : activity.map((entry) => (
              <tr key={entry.id}><td>{entry.label}</td><td><CompactDetailValue value={entry.detail} copyValue={copyValue} /></td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="activity-table">
        <h3>Artifacts (Recent)</h3>
        <table>
          <thead><tr><th>Artifact</th><th>Status</th></tr></thead>
          <tbody>
            {evidenceRows.length === 0 ? (
              <tr><td colSpan="2">{draftSurface ? "Draft flow has no artifacts yet" : "No visible artifacts yet"}</td></tr>
            ) : evidenceRows.slice(0, 5).map((row) => (
              <tr key={row.ref}>
                <td><span className="artifact-ref-label" title={row.rawRef ?? row.ref}>{conciseArtifactLabel(row)}</span></td>
                <td>{row.status ?? "ready"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function FlowAdvancedWorkbench({
  evidenceRows,
  selectedRef,
  setSelectedRef,
  attachTarget,
  copyRef,
  executionEvidence,
  providerEvidenceRows,
  evidenceGraph,
  runtimeTrace,
  interactions,
  answers,
  setAnswers,
  submitAnswer,
  decisionRequests,
  externalRunHealth,
  projectContext,
  nextAction,
  repairCompletion,
  verificationPlan,
  qualityGate,
  busy,
}) {
  const [expanded, setExpanded] = useState(defaultAdvancedWorkbenchOpen);
  const [selectedTab, setSelectedTab] = useState("evidence");

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.addEventListener !== "function") return undefined;
    const focusRequestedTab = (event) => {
      const requestedTab = typeof event.detail?.tabId === "string" ? event.detail.tabId : "evidence";
      const nextTab = ADVANCED_WORKBENCH_TAB_IDS.has(requestedTab) ? requestedTab : "evidence";
      setSelectedTab(nextTab);
      setExpanded(true);
    };
    window.addEventListener(ADVANCED_WORKBENCH_FOCUS_EVENT, focusRequestedTab);
    return () => window.removeEventListener(ADVANCED_WORKBENCH_FOCUS_EVENT, focusRequestedTab);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const media = window.matchMedia("(max-width: 1180px)");
    const syncExpandedToViewport = () => {
      setExpanded(!media.matches);
    };
    syncExpandedToViewport();
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", syncExpandedToViewport);
      return () => media.removeEventListener("change", syncExpandedToViewport);
    }
    media.addListener(syncExpandedToViewport);
    return () => media.removeListener(syncExpandedToViewport);
  }, []);

  const traceCount = Array.isArray(runtimeTrace?.trace_items) ? runtimeTrace.trace_items.length : 0;
  const graphCount = Array.isArray(evidenceGraph?.nodes) ? evidenceGraph.nodes.length : 0;
  const publicRepairDecision = decisionRequests.length === 0
    ? publicRepairDecisionAction(nextAction, qualityGate, verificationPlan)
    : null;
  const decisionTabLabel = publicRepairDecision ? "Repair Decision" : "Operator Decision";
  const decisionTabCount = publicRepairDecision && decisionRequests.length === 0 ? "needed" : decisionRequests.length;
  const tabs = [
    { id: "evidence", label: "Evidence / Documents", count: evidenceRows.length },
    { id: "execution", label: "Execution", count: executionEvidence ? 1 : 0 },
    { id: "graph", label: "Graph", count: graphCount },
    { id: "trace", label: "Runtime Trace", count: traceCount },
    { id: "interactions", label: "Interactions Inbox", count: interactions.length },
    { id: "decisions", label: decisionTabLabel, count: decisionTabCount },
  ];
  const selected = tabs.find((tab) => tab.id === selectedTab) ?? tabs[0];
  const panel =
    selected.id === "execution" ? (
      <ExecutionEvidencePanel
        evidence={executionEvidence}
        providerEvidenceRows={providerEvidenceRows}
        copyRef={copyRef}
        busy={busy}
        externalRunHealth={externalRunHealth}
        projectContext={projectContext}
        nextAction={nextAction}
        repairCompletion={repairCompletion}
        verificationPlan={verificationPlan}
        qualityGate={qualityGate}
      />
    ) : selected.id === "graph" ? (
      <EvidenceGraphPanel graph={evidenceGraph} />
    ) : selected.id === "trace" ? (
      <RuntimeTracePanel trace={runtimeTrace} />
    ) : selected.id === "interactions" ? (
      <InteractionsInbox interactions={interactions} answers={answers} setAnswers={setAnswers} submitAnswer={submitAnswer} busy={busy} />
    ) : selected.id === "decisions" ? (
      <OperatorDecisionDrawer
        decisionRequests={decisionRequests}
        copyRef={copyRef}
        busy={busy}
        externalRunHealth={externalRunHealth}
        publicRepairDecision={publicRepairDecision}
      />
    ) : (
      <EvidenceWorkbench
        rows={evidenceRows}
        selectedRef={selectedRef}
        setSelectedRef={setSelectedRef}
        attachTarget={attachTarget}
        copyRef={copyRef}
        qualityClosureContext={{ publicRepairDecision }}
      />
    );

  return (
    <section className="workbench-row advanced-workbench-row" id="flow-advanced-workbench">
      <details
        className="work-card advanced-workbench-disclosure"
        open={expanded}
        onToggle={(event) => setExpanded(event.currentTarget.open)}
      >
        <summary>
          <div>
            <h3>Advanced evidence workbench</h3>
            <p>Flow-scoped Evidence / Documents, Runtime Trace, Interactions Inbox, and decision surfaces stay grouped below the cockpit.</p>
          </div>
          <StatusPill state={expanded ? selected.label : `${evidenceRows.length} artifacts`} />
        </summary>
        {expanded ? (
          <>
            <div className="advanced-workbench-tabs" role="tablist" aria-label="Advanced flow-scoped surfaces">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  className={selected.id === tab.id ? "selected" : ""}
                  type="button"
                  role="tab"
                  aria-selected={selected.id === tab.id}
                  onClick={() => setSelectedTab(tab.id)}
                >
                  <span>{tab.label}</span>
                  <strong>{tab.count}</strong>
                </button>
              ))}
            </div>
            <div className="advanced-workbench-panel" role="tabpanel" aria-label={selected.label}>
              {panel}
            </div>
          </>
        ) : null}
      </details>
    </section>
  );
}

function AdvancedEvidenceDisclosure({ newFlowDraft, evidenceCount, interactionCount, decisionCount, activity = [], evidenceRows = [], flows = [], copyValue = null }) {
  return (
    <section className="workbench-row advanced-evidence-row">
      <details className="work-card advanced-evidence-disclosure">
        <summary>
          <div>
            <h3>Advanced evidence</h3>
            <p>{newFlowDraft ? "Draft flow has no runtime evidence yet." : "Debug surfaces appear after a selected flow has relevant data."}</p>
          </div>
          <StatusPill state={`${evidenceCount} artifacts`} />
        </summary>
        <div className="advanced-evidence-summary-grid">
          <div>
            <span>Execution Evidence</span>
            <strong>{evidenceCount > 0 ? "Available after flow evidence" : "Hidden until relevant"}</strong>
            <p>Provider execution, Runtime Harness, and verification details remain available once they exist.</p>
          </div>
          <div>
            <span>Evidence Graph</span>
            <strong>{evidenceCount} refs</strong>
            <p>Selected-flow graph and runtime trace are scoped to an active flow.</p>
          </div>
          <div>
            <span>Interactions Inbox</span>
            <strong>{interactionCount}</strong>
            <p>Runtime-initiated questions appear here after a flow requests input.</p>
          </div>
          <div>
            <span>Operator Decision</span>
            <strong>{decisionCount}</strong>
            <p>Bounded operator decisions are hidden until a runtime decision request exists.</p>
          </div>
          <div>
            <span>Flow Inventory</span>
            <strong>{flows.length}</strong>
            <p>Flow selection appears after a durable active or completed flow exists.</p>
          </div>
          <div>
            <span>Activity / Events</span>
            <strong>{activity.length}</strong>
            <p>Local UI activity stays available here without competing with first-run setup.</p>
          </div>
        </div>
        <ActivityArtifactsTables
          activity={activity}
          evidenceRows={evidenceRows}
          draftSurface={newFlowDraft}
          className="support-table-grid"
          copyValue={copyValue}
        />
      </details>
    </section>
  );
}

function AddProjectDrawer({ open, form, setForm, busy, result, onClose, onAdd, onAddAndInitialize }) {
  if (!open) return null;
  const projectPath = form.projectRef.trim();
  const runtimePreview = form.runtimeRoot.trim() || (projectPath ? `${projectPath.replace(/\/+$/u, "")}/.aor` : "<project>/.aor");
  const profilePreview = form.projectProfile.trim() || "Default discovery or generated bundled profile";
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
          <label>
            Project profile
            <input
              value={form.projectProfile}
              onChange={(event) => setForm({ ...form, projectProfile: event.target.value })}
              placeholder="Optional project.aor.yaml path"
            />
          </label>
          <div className="runtime-root-preview" aria-label="Runtime root preview">
            <span>Runtime root preview</span>
            <code>{runtimePreview}</code>
          </div>
          <div className="runtime-root-preview" aria-label="Project profile preview">
            <span>Project profile</span>
            <code>{profilePreview}</code>
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
  const requestTextMissing = form.requestText.trim().length === 0;
  const readOnlyAllowed = !completed || (form.deliveryMode === "no-write" && READ_ONLY_INSPECTION_INTENTS.has(form.intent));
  const deliveryModes = completed
    ? DELIVERY_MODE_OPTIONS.filter((option) => option.value === "no-write")
    : DELIVERY_MODE_OPTIONS;
  const readinessItems = requestReadinessItems({
    flow,
    completed,
    form,
    targetStep,
    flowMissing,
    targetRefsMissing,
    requestTextMissing,
    scopeMissing,
    readOnlyAllowed,
  });
  const readinessReady = readinessItems.every((item) => item.ready);
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
          <p>{flowMissing ? "Ask AOR requires a selected active flow." : completed ? "Read-only inspection only. Mutation requests are blocked by the control plane." : "Requests are scoped to the selected active flow."}</p>
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
        <div className="request-readiness-path" aria-label="Ask AOR request readiness">
          <div className="request-readiness-heading">
            <span>Request readiness</span>
            <strong>{readinessReady ? "Ready to create request evidence" : "Complete required fields first"}</strong>
            <p>{readinessReady ? "Submit will create the operator-request packet, run the selected step, refresh the flow, and keep audit refs visible." : "AOR keeps submission disabled until the flow, request, targets, scope, and mode are auditable."}</p>
          </div>
          <ol>
            {readinessItems.map((item) => (
              <li key={item.key} className={item.ready ? "ready" : "blocked"}>
                <span>{item.label}</span>
                <strong>{item.title}</strong>
                <p>{item.detail}</p>
              </li>
            ))}
          </ol>
        </div>
        <button className="primary drawer-submit" type="button" onClick={onRun} disabled={busy || flowMissing || targetRefsMissing || requestTextMissing || scopeMissing || !readOnlyAllowed}>
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
  const [projectSnapshotLoaded, setProjectSnapshotLoaded] = useState(false);
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
  const [addProjectForm, setAddProjectForm] = useState({ projectRef: "", label: "", runtimeRoot: "", projectProfile: "" });
  const [addProjectResult, setAddProjectResult] = useState(null);
  const [requestForm, setRequestForm] = useState(DEFAULT_REQUEST);
  const [requestResult, setRequestResult] = useState(null);
  const [selectedRef, setSelectedRef] = useState("");
  const [answers, setAnswers] = useState({});
  const [copyFeedback, setCopyFeedback] = useState(null);
  const didChooseStage = useRef(false);
  const didAutoSelectStage = useRef(false);
  const flowSelectionVersion = useRef(0);
  const requestDrawerOpenerRef = useRef(null);
  const pendingRequestDrawerFocusRestore = useRef(false);

  const apiProjectBase = useMemo(() => {
    const projectId = activeProjectId ?? config?.default_project_id ?? config?.project_id;
    if (!projectId) return null;
    return `/api/projects/${encodeURIComponent(projectId)}`;
  }, [activeProjectId, config]);

  const activeStage = STAGES.find((stage) => stage.id === selectedStage) ?? STAGES[1];
  const draftSurface = newFlowDraft;
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
  const activeProjectDisplay = activeProject && projectState?.onboarding_summary
    ? {
        ...activeProject,
        runtime_root: projectState.runtime_root ?? activeProject.runtime_root,
        onboarding_summary: projectState.onboarding_summary,
      }
    : activeProject;
  const projectOptionsForSwitcher = activeProjectDisplay
    ? projectOptions.map((project) => (
        project.project_id === activeProjectDisplay.project_id ? activeProjectDisplay : project
      ))
    : projectOptions;
  const activeProjectOnboarding = activeProjectDisplay?.onboarding_summary ?? {};
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
  const scopedWorkbenchEvidenceRows = useMemo(
    () => {
      if (draftSurface) return [];
      return selectedFlow?.flow_id ? flowEvidenceRows : evidenceRows;
    },
    [draftSurface, selectedFlow, flowEvidenceRows, evidenceRows],
  );
  const providerStepStatus = useMemo(
    () => resolveProviderStepStatus(projectState, runs),
    [projectState, runs],
  );
  const rawExternalRunHealth = useMemo(
    () => resolveExternalRunHealth(projectState, runs),
    [projectState, runs],
  );
  const providerStepSupersedesRunHealth = activeProviderSupersedesExternalRunBlocker(rawExternalRunHealth, providerStepStatus);
  const externalRunHealth = useMemo(
    () => displayExternalRunHealth(rawExternalRunHealth, providerStepStatus),
    [rawExternalRunHealth, providerStepStatus],
  );
  const qualityRepairCompletion = useMemo(
    () => materializedQualityRepairCompletion(nextAction, runs),
    [nextAction, runs],
  );
  const blockingExternalRunHealth = !draftSurface && isBlockingExternalRunHealth(externalRunHealth);
  const newFlowBlockedByRunHealthReason = blockingExternalRunHealth ? externalRunNewFlowBlockedReason(externalRunHealth) : "";
  const selectedFlowVerificationFailures = !draftSurface && selectedFlow && !isCompletedFlow(selectedFlow)
    ? failedRequiredVerificationGroups(projectState?.verification_plan)
    : [];
  const newFlowBlockedByVerificationReason = selectedFlowVerificationFailures.length > 0
    ? "Resolve the current failed verification Recovery Path before starting a new flow."
    : "";
  const activeProviderStep = !draftSurface && (
    isActiveProviderStepStatus(providerStepStatus)
    || providerStepSupersedesRunHealth
    || (!selectedFlow && isProviderStepDisplayStatus(providerStepStatus))
  );
  const workbenchEvidenceRows = useMemo(
    () => (blockingExternalRunHealth ? evidenceRows : scopedWorkbenchEvidenceRows),
    [blockingExternalRunHealth, evidenceRows, scopedWorkbenchEvidenceRows],
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
    return mergeOperatorDecisionRequests(
      operatorDecisionRequestsFromExternalRunHealth(externalRunHealth),
      operatorDecisionRequestsForFlow(selectedFlow, selectedFlowRuntimeTrace, workbenchEvidenceRows, { draft: draftSurface }),
    );
  }, [externalRunHealth, selectedFlow, selectedFlowRuntimeTrace, workbenchEvidenceRows, draftSurface]);
  const projectLevelProviderFocus = !draftSurface && !selectedFlow && Boolean(providerStepStatus || externalRunHealth);
  const providerWorkbenchFocus = projectLevelProviderFocus || blockingExternalRunHealth || activeProviderStep;
  const currentStage = draftSurface
    ? "mission"
    : providerWorkbenchFocus
      ? providerFocusStageId(providerStepStatus, externalRunHealth)
      : flowStageId(selectedFlow, nextAction, projectState);
  const executionEvidence = useMemo(() => {
    const flowExecutionEvidence = executionEvidenceForFlow(selectedFlow, runs, selectedFlowRuntimeTrace, { draft: draftSurface });
    if (flowExecutionEvidence || draftSurface || (selectedFlow?.flow_id && !activeProviderStep) || (!providerStepStatus && !externalRunHealth)) return flowExecutionEvidence;
    const healthBlockers = externalRunHealthBlockers(externalRunHealth);
    const healthFailurePhase = externalRunHealth?.failure_summary?.phase ?? null;
    const healthStatus = externalRunHealth?.status ?? "pending";
    return {
      run_id: externalRunHealth?.run_id ?? providerStepStatus?.route_id ?? providerStepStatus?.step_id ?? "provider-step",
      status: isBlockingExternalRunHealth(externalRunHealth)
        ? externalRunDerivedEvidenceStatus(externalRunHealth)
        : providerStepStatus?.status ?? healthStatus,
      provider_execution_status: providerStepStatus?.status ?? "unknown",
      runtime_harness_decision: "pending",
      real_code_change_status: "pending",
      post_run_verification_status: "pending",
      review_status: healthFailurePhase === "review" ? healthStatus : "pending",
      delivery_readiness_status: isBlockingExternalRunHealth(externalRunHealth)
        ? externalRunDerivedEvidenceStatus(externalRunHealth, "blocked")
        : "pending",
      no_upstream_write_status: "enforced",
      changed_path_groups: [],
      blockers: healthBlockers.map((blocker) => blocker.summary ?? blocker.code).filter(Boolean),
      actions: [],
      provider_step_status: providerStepStatus,
      [RUN_HEALTH_FIELD]: externalRunHealth,
    };
  }, [selectedFlow, runs, selectedFlowRuntimeTrace, draftSurface, activeProviderStep, providerStepStatus, externalRunHealth]);
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
    const statePreviewRoute = effectiveProjectId ? `/api/projects/${encodeURIComponent(effectiveProjectId)}/state` : null;
    const onboarding = selectedProject?.onboarding_summary ?? {};
    const needsStatePreview = statePreviewRoute && onboarding.initialized !== true && onboarding.state_exists !== true;
    const statePreview = needsStatePreview ? await readJson(statePreviewRoute).catch(() => null) : null;
    const statePreviewOnboarding = statePreview?.onboarding_summary ?? {};
    const projectsWithLiveState = statePreview?.onboarding_summary && effectiveProjectId
      ? projects.map((project) => (
          project.project_id === effectiveProjectId
            ? {
                ...project,
                runtime_root: statePreview.runtime_root ?? project.runtime_root,
                onboarding_summary: statePreview.onboarding_summary,
              }
            : project
        ))
      : projects;
    setProjectIndex({
      ...projectPayload,
      default_project_id: projectPayload.default_project_id ?? appConfig.default_project_id ?? appConfig.project_id,
      projects: projectsWithLiveState,
    });
    if (effectiveProjectId && activeProjectId !== effectiveProjectId) {
      setActiveProjectId(effectiveProjectId);
    }
    const shouldReadProjectState =
      onboarding.initialized === true
      || onboarding.state_exists === true
      || Boolean(statePreview?.state_file)
      || statePreviewOnboarding.initialized === true
      || statePreviewOnboarding.state_exists === true;
    if (!shouldReadProjectState) {
      const previewRunList = effectiveProjectId
        ? await readJson(`/api/projects/${encodeURIComponent(effectiveProjectId)}/runs`).catch(() => [])
        : [];
      const selectionStillCurrent = refreshSelectionVersion === flowSelectionVersion.current;
      setProjectState(null);
      setNextAction(null);
      setFlowList({ flows: [], selected_flow_id: null });
      setSelectedFlow(null);
      setSelectedFlowId(null);
      setPackets([]);
      setStepResults([]);
      setRuns(Array.isArray(previewRunList) ? previewRunList : []);
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
      setProjectSnapshotLoaded(true);
      return {
        projectState: null,
        nextAction: null,
        selectedFlow: null,
        selectionApplied: selectionStillCurrent,
      };
    }
    const base = `/api/projects/${encodeURIComponent(effectiveProjectId)}`;
    const [state, next, flowPayload, selectedFlowPayload, packetList, stepList, runList, requestList] = await Promise.all([
      statePreview ? Promise.resolve(statePreview) : readJson(`${base}/state`),
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
    setPackets(Array.isArray(packetList) ? packetList : []);
    setStepResults(Array.isArray(stepList) ? stepList : []);
    setRuns(Array.isArray(runList) ? runList : []);
    setOperatorRequests(Array.isArray(requestList) ? requestList : []);
    if (!draftMode && selectionStillCurrent) {
      setSelectedFlow(refreshedSelectedFlow);
      setSelectedFlowId(refreshedSelectedFlow?.flow_id ?? null);
      setProjectSnapshotLoaded(true);
      await loadFlowWorkbench(base, refreshedSelectedFlow);
    } else if (draftMode && selectionStillCurrent) {
      setProjectSnapshotLoaded(true);
      await loadFlowWorkbench(base, null);
    } else if (selectionStillCurrent) {
      setProjectSnapshotLoaded(true);
    }
    if (selectionStillCurrent && !didChooseStage.current) {
      setSelectedStage(draftMode ? "mission" : flowStageId(refreshedSelectedFlow, nextReport?.primary_action ? nextReport : null, state));
      didAutoSelectStage.current = true;
    }
    const activityFlow = selectionStillCurrent ? refreshedSelectedFlow : selectedFlow;
    if (!options.silent) {
      pushActivity("control-plane.connected", activityFlow?.flow_id ?? nextReport?.primary_action?.command ?? "state refreshed");
    }
    setProjectSnapshotLoaded(true);
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
    if ((!projectLevelProviderFocus && !blockingExternalRunHealth) || didChooseStage.current) return;
    setSelectedStage(providerFocusStageId(providerStepStatus, externalRunHealth));
    didAutoSelectStage.current = true;
  }, [projectLevelProviderFocus, blockingExternalRunHealth, providerStepStatus?.status, externalRunHealth?.status, externalRunHealth?.current_step]);

  useEffect(() => {
    const shouldResetScroll = newFlowDraft || Boolean(selectedFlowId);
    if (typeof window === "undefined" || !shouldResetScroll) return undefined;
    const frame = window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [newFlowDraft, selectedFlowId]);

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
    setProjectSnapshotLoaded(false);
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
          ...(addProjectForm.projectProfile.trim() ? { project_profile: addProjectForm.projectProfile.trim() } : {}),
        }),
      });
      const nextProjectId = payload.project?.project_id;
      setProjectIndex({
        default_project_id: payload.default_project_id,
        projects: Array.isArray(payload.projects) ? payload.projects : [],
      });
      let resultMessage = "Project added to this local app session.";
      setAddProjectForm({ projectRef: "", label: "", runtimeRoot: "", projectProfile: "" });
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
    if (blockingExternalRunHealth) {
      setSelectedStage(providerFocusStageId(providerStepStatus, externalRunHealth));
      focusAdvancedWorkbench(externalRunWorkbenchAction(
        externalRunHealth,
        operatorDecisionRequests.some((request) => isOpenOperatorDecisionStatus(request.status)),
      ).tabId);
      pushActivity("flow.new-blocked", newFlowBlockedByRunHealthReason || "Resolve the current run blocker before starting a new flow.");
      return;
    }
    if (newFlowBlockedByVerificationReason) {
      setSelectedStage(toUiStageId(nextAction?.project_state?.stage ?? selectedFlow?.selected_stage ?? "review"));
      focusAdvancedWorkbench("execution");
      pushActivity("flow.new-blocked", newFlowBlockedByVerificationReason);
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
    if (typeof document !== "undefined") {
      const opener = document.activeElement;
      if (opener && opener !== document.body && typeof opener.focus === "function") {
        requestDrawerOpenerRef.current = opener;
      }
    }
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

  function restoreRequestDrawerFocus() {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    const restore = (attempt = 0) => {
      const opener = requestDrawerOpenerRef.current;
      if (opener && opener.isConnected && typeof opener.focus === "function" && !opener.disabled) {
        opener.focus();
        requestDrawerOpenerRef.current = null;
        return;
      }
      if (opener && opener.isConnected && attempt < 6) {
        window.setTimeout(() => restore(attempt + 1), 50);
        return;
      }
      const fallback = document.querySelector(
        ".topbar-ask-button:not(:disabled), .flow-cockpit button.secondary:not(:disabled), .mission-form button[aria-label='Ask AOR for selected flow']:not(:disabled)",
      );
      if (fallback && typeof fallback.focus === "function") fallback.focus();
      requestDrawerOpenerRef.current = null;
    };
    window.setTimeout(() => restore(), 0);
  }

  function closeRequestDrawer({ clearResult = true, restoreFocus = true } = {}) {
    if (restoreFocus) pendingRequestDrawerFocusRestore.current = true;
    setRequestDrawerOpen(false);
    if (clearResult) setRequestResult(null);
  }

  useEffect(() => {
    if (!requestDrawerOpen) return undefined;
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRequestDrawer();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [requestDrawerOpen]);

  useEffect(() => {
    if (requestDrawerOpen || !pendingRequestDrawerFocusRestore.current) return;
    pendingRequestDrawerFocusRestore.current = false;
    restoreRequestDrawerFocus();
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
      setSelectedStage("discovery");
      setNewFlowDraft(false);
      setDraftSourceFlow(null);
      setDraftFollowUpHandoffRef(null);
      setSelectedFlowId(null);
      await refresh({ newFlowDraft: false, selectedFlowId: null });
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
      closeRequestDrawer({ clearResult: false });
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

  function focusAdvancedWorkbench(tabId = "evidence") {
    if (typeof document === "undefined") return;
    const requestedTab = ADVANCED_WORKBENCH_TAB_IDS.has(tabId) ? tabId : "evidence";
    if (typeof window !== "undefined" && typeof window.dispatchEvent === "function" && typeof window.CustomEvent === "function") {
      window.dispatchEvent(new window.CustomEvent(ADVANCED_WORKBENCH_FOCUS_EVENT, { detail: { tabId: requestedTab } }));
    }
    const focusWorkbench = () => {
      const workbench = document.getElementById("flow-advanced-workbench");
      if (!workbench) return;
      workbench.scrollIntoView({ block: "start" });
      const summary = workbench.querySelector("summary");
      if (summary && typeof summary.focus === "function") summary.focus({ preventScroll: true });
    };
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(focusWorkbench);
    } else {
      focusWorkbench();
    }
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
  const projectSnapshotPending = !projectSnapshotLoaded && !String(error ?? "").trim();
  const firstRunFocusMode = !projectSnapshotPending && (draftSurface || (!selectedFlow && !providerWorkbenchFocus));
  const topbarFlowStatus = blockingExternalRunHealth
    ? projectRunEvidenceStatus(providerStepStatus, externalRunHealth)
    : activeProviderStep
    ? projectRunEvidenceStatus(providerStepStatus, externalRunHealth)
    : projectSnapshotPending
    ? "Loading project"
    : draftSurface
    ? "Draft flow"
    : selectedFlow?.status ?? (projectLevelProviderFocus ? projectRunEvidenceStatus(providerStepStatus, externalRunHealth) : "No active flow");
  const topbarAskReason = projectSnapshotPending
    ? "Project state is loading."
    : blockingExternalRunHealth
    ? isStepQualityAssessmentPendingRunHealth(externalRunHealth)
      ? "Use the assessment evidence workbench before asking for another flow action."
      : acceptedExternalRunContinueDecision(externalRunHealth)
        ? "Review the recorded decision evidence and refresh run status before asking for another flow action."
      : isControllerDecisionPendingRunHealth(externalRunHealth)
        ? "Use the Decision Request workbench before asking for another flow action."
        : externalRunRecoveryPathActive(externalRunHealth)
          ? "Use the Recovery Path workbench before asking for another flow action."
          : "Review the run blocker evidence before asking for another flow action."
    : selectedFlow
    ? "Ask AOR for selected flow"
    : projectLevelProviderFocus
      ? "Ask AOR needs a selectable flow; use run evidence controls for this blocker."
      : "Ask AOR requires a selected active flow";
  const topbarAskLabel = projectSnapshotPending
    ? "Loading"
    : blockingExternalRunHealth
    ? isStepQualityAssessmentPendingRunHealth(externalRunHealth)
      ? "Assessment needed"
      : acceptedExternalRunContinueDecision(externalRunHealth)
        ? "Decision recorded"
      : isControllerDecisionPendingRunHealth(externalRunHealth)
        ? "Decision needed"
        : externalRunRecoveryPathActive(externalRunHealth)
          ? "Recovery needed"
          : "Review blocker"
    : selectedFlow
      ? "Ask AOR for selected flow"
      : projectLevelProviderFocus
        ? "Ask AOR needs a flow"
        : "Ask AOR for selected flow";
  const topbarRunWorkbenchAction = blockingExternalRunHealth
    ? externalRunWorkbenchAction(
      externalRunHealth,
      operatorDecisionRequests.some((request) => isOpenOperatorDecisionStatus(request.status)),
    )
    : null;
  const runtimeRoot = projectState?.runtime_root ?? activeProjectDisplay?.runtime_root ?? config?.runtime_root ?? ".aor";
  const activeProjectStatusRuntimeReady =
    activeProjectRuntimeReady ||
    providerWorkbenchFocus ||
    Boolean(providerStepStatus || externalRunHealth) ||
    (Array.isArray(runs) && runs.length > 0);
  const newFlowDisabledReason = projectSnapshotPending
    ? "Project state is loading."
    : busy
      ? "Wait for the current console action to finish before starting a new flow."
      : !activeProjectRuntimeReady
        ? "Initialize the project runtime before starting a flow."
        : newFlowBlockedByRunHealthReason || newFlowBlockedByVerificationReason;
  const newFlowDisabled = projectSnapshotPending || !activeProjectRuntimeReady || busy || Boolean(newFlowBlockedByRunHealthReason || newFlowBlockedByVerificationReason);

  return (
    <div className={`app-shell ${firstRunFocusMode ? "first-run-focus-mode" : "flow-active-mode"}`}>
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">A</div>
          <div>
            <strong>AOR Operator Console</strong>
            <span>v0.4.2</span>
          </div>
        </div>
        <ProjectSwitcher
          projects={projectOptionsForSwitcher}
          activeProjectId={activeProjectDisplay?.project_id ?? activeProjectId ?? config?.project_id}
          onSelectProject={selectProject}
          onOpenAddProject={openAddProjectDrawer}
          busy={busy}
          activeRuntimeReady={activeProjectStatusRuntimeReady}
        />
        <FlowSelector
          flows={flowOptions}
          selectedFlowId={selectedFlowId}
          newFlowDraft={draftSurface}
          onSelectFlow={selectFlow}
          onNewFlow={startNewFlow}
          newFlowDisabled={newFlowDisabled}
          newFlowDisabledReason={newFlowDisabledReason}
          providerStepStatus={providerStepStatus}
          externalRunHealth={externalRunHealth}
        />
        <div className="top-context runtime-context">
          <span>Runtime root</span>
          <code title={runtimeRoot}>{shortPathLabel(runtimeRoot)}</code>
        </div>
        <div className="topbar-status-strip" aria-label="Console status">
          <StatusPill state={topbarFlowStatus} />
          {providerStepStatus ? <StatusPill state={`Provider ${providerStepStatus.status}`} /> : null}
          <StatusPill state={config ? "connected" : "loading"} />
          <StatusPill state={deliveryMode === "no-write" ? "NO-WRITE SAFETY: ON" : deliveryMode} />
        </div>
        <div className="topbar-spacer" />
        <button
          className="utility-button topbar-ask-button"
          type="button"
          onClick={() => (blockingExternalRunHealth ? focusAdvancedWorkbench(topbarRunWorkbenchAction?.tabId ?? "evidence") : openRequestDrawer())}
          disabled={projectSnapshotPending || busy || (!selectedFlow && !blockingExternalRunHealth)}
          title={topbarAskReason}
          aria-label={topbarAskReason}
        >
          <Icon name="target" /><span className="action-label">{topbarAskLabel}</span>
        </button>
        <IconButton label="Refresh" onClick={() => refresh().catch((err) => setError(err.message))} disabled={busy}><Icon name="refresh" /></IconButton>
        <button className="utility-button runtime-copy-chip" type="button" title="Copy runtime root path" aria-label="Copy runtime root path" onClick={() => copyRef(runtimeRoot)}>
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
          externalRunHealth={externalRunHealth}
          repairCompletion={qualityRepairCompletion}
          verificationPlan={projectState?.verification_plan ?? null}
        />

      <main className="main">
        {error ? <div className="alert" role="alert">{error}</div> : null}
        {projectSnapshotPending ? (
          <ProjectSnapshotLoading runtimeRoot={runtimeRoot} />
        ) : draftSurface ? (
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
            activeProject={activeProjectDisplay}
            onOpenAddProject={openAddProjectDrawer}
            providerStepStatus={providerStepStatus}
            externalRunHealth={externalRunHealth}
            providerFocus={providerWorkbenchFocus}
            evidenceRows={providerWorkbenchFocus ? workbenchEvidenceRows : flowEvidenceRows}
            repairCompletion={qualityRepairCompletion}
          />
        )}
      </main>

      {!firstRunFocusMode ? (
        <RightRail
          nextAction={nextAction}
          selectedFlow={selectedFlow}
          projectState={projectState}
          config={config}
          activeProject={activeProjectDisplay}
          operatorRequests={operatorRequests}
          flows={flowOptions}
          evidenceRows={workbenchEvidenceRows}
          providerStepStatus={providerStepStatus}
          externalRunHealth={externalRunHealth}
          providerFocus={providerWorkbenchFocus}
          repairCompletion={qualityRepairCompletion}
        />
      ) : null}

      {firstRunFocusMode ? (
        <AdvancedEvidenceDisclosure
          newFlowDraft={draftSurface}
          evidenceCount={workbenchEvidenceRows.length}
          interactionCount={interactions.length}
          decisionCount={operatorDecisionRequests.length}
          activity={activity}
          evidenceRows={workbenchEvidenceRows}
          flows={flowOptions}
          copyValue={copyRef}
        />
      ) : (
        <FlowAdvancedWorkbench
          evidenceRows={workbenchEvidenceRows}
          selectedRef={selectedRef}
          setSelectedRef={setSelectedRef}
          attachTarget={attachTarget}
          copyRef={copyRef}
          executionEvidence={executionEvidence}
          providerEvidenceRows={providerEvidenceRows}
          evidenceGraph={selectedFlowEvidenceGraph}
          runtimeTrace={selectedFlowRuntimeTrace}
          interactions={interactions}
          answers={answers}
          setAnswers={setAnswers}
          submitAnswer={submitAnswer}
          decisionRequests={operatorDecisionRequests}
          externalRunHealth={externalRunHealth}
          projectContext={{
            projectRef: activeProjectDisplay?.project_root ?? projectState?.project_root ?? config?.project_root,
            projectProfileRef: activeProjectDisplay?.project_profile_ref ?? projectState?.project_profile_ref ?? config?.project_profile_ref,
            runtimeRoot,
          }}
          nextAction={nextAction}
          repairCompletion={qualityRepairCompletion}
          verificationPlan={projectState?.verification_plan ?? null}
          qualityGate={selectedFlow?.active_quality_gate ?? null}
          busy={busy}
        />
      )}

      {!firstRunFocusMode ? (
        <ActivityArtifactsTables
          activity={activity}
          evidenceRows={workbenchEvidenceRows}
          draftSurface={draftSurface}
          copyValue={copyRef}
        />
      ) : null}

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
