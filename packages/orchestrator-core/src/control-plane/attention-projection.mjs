import { createHash } from "node:crypto";

import { readFlowEvidenceGraph, readFlowProjection } from "./flow-projections.mjs";
import { readNextActionReport } from "./read-artifact-readers.mjs";

const RELEVANT_FAMILY = /(interaction|decision|assessment|verification|quality-repair|policy|run-control|runtime-harness|review-report)/u;
const RESOLVED_STATUS = new Set(["accepted", "answered", "approve", "approved", "closed", "completed", "pass", "passed", "resolved", "succeeded", "success"]);
const RUNNING_STATUS = new Set(["active", "canceling", "running", "silent-running", "starting", "waiting-input"]);
const UPCOMING_STATUS = new Set(["planned", "pending", "queued", "upcoming"]);
const DANGER_STATUS = new Set(["blocked", "budget-exhausted", "deny", "denied", "error", "fail", "failed", "rejected"]);

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function strings(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string" && entry.trim()).map((entry) => entry.trim()) : [];
}

function normalizeStatus(value) {
  return (text(value) ?? "unknown").toLowerCase().replaceAll("_", "-");
}

function itemState(status) {
  if (RESOLVED_STATUS.has(status)) return "resolved";
  if (RUNNING_STATUS.has(status)) return "running";
  if (UPCOMING_STATUS.has(status)) return "upcoming";
  return "needs-attention";
}

function itemSeverity(status, state) {
  if (DANGER_STATUS.has(status)) return "danger";
  if (state === "needs-attention") return "warning";
  if (state === "running" || state === "upcoming") return "information";
  return "neutral";
}

function stableItemId(flowId, family, ref) {
  const digest = createHash("sha256").update(`${family}\0${ref}`).digest("hex").slice(0, 16);
  return `attention.${flowId}.${digest}`;
}

function sourceTimestamp(node) {
  const summary = node?.display_summary && typeof node.display_summary === "object" ? node.display_summary : {};
  return text(summary.timestamp) ?? text(node.updated_at) ?? text(node.created_at);
}

function actionForNode(node, nextAction) {
  const control = nextAction?.primary_action?.operator_control;
  if (!control || typeof control !== "object") return null;
  const refs = strings(nextAction?.primary_action?.evidence_refs);
  return refs.length === 0 || refs.includes(node.ref) ? structuredClone(control) : null;
}

function attentionItem(flowId, node, nextAction) {
  const family = text(node.family) ?? "evidence";
  const ref = text(node.ref) ?? text(node.node_id) ?? `${family}:unknown`;
  const status = normalizeStatus(node.status);
  const state = itemState(status);
  const timestamp = sourceTimestamp(node);
  return {
    item_id: stableItemId(flowId, family, ref),
    source_family: family,
    source_ref: ref,
    stage: text(node.stage),
    state,
    severity: itemSeverity(status, state),
    title: text(node.label) ?? family,
    consequence: text(node.summary) ?? `The ${family} source is ${status}.`,
    operator_control: actionForNode(node, nextAction),
    evidence_refs: [ref],
    created_at: timestamp,
    updated_at: timestamp,
  };
}

const STATE_ORDER = new Map(["needs-attention", "running", "upcoming", "resolved"].map((value, index) => [value, index]));
const SEVERITY_ORDER = new Map(["danger", "warning", "information", "neutral"].map((value, index) => [value, index]));

function compareItems(left, right) {
  const stateDelta = STATE_ORDER.get(left.state) - STATE_ORDER.get(right.state);
  if (stateDelta) return stateDelta;
  const severityDelta = SEVERITY_ORDER.get(left.severity) - SEVERITY_ORDER.get(right.severity);
  if (severityDelta) return severityDelta;
  const timeDelta = String(right.updated_at ?? "").localeCompare(String(left.updated_at ?? ""));
  return timeDelta || left.item_id.localeCompare(right.item_id);
}

export function readAttentionProjection(options) {
  const flow = readFlowProjection(options);
  if (!flow) return null;
  const graph = readFlowEvidenceGraph(options);
  const nextAction = readNextActionReport(options);
  const items = (graph?.nodes ?? [])
    .filter((node) => node?.family !== "flow" && RELEVANT_FAMILY.test(String(node?.family ?? "")))
    .map((node) => attentionItem(flow.flow_id, node, nextAction))
    .sort(compareItems);
  const latestSourceAt = items.map((item) => item.updated_at).filter(Boolean).sort().at(-1) ?? null;
  return {
    project_id: graph?.project_id ?? nextAction?.project_id ?? null,
    flow_id: flow.flow_id,
    initialized: true,
    read_only: true,
    freshness: items.some((item) => normalizeStatus(item.consequence).includes("stale")) ? "stale" : "current",
    latest_source_at: latestSourceAt,
    items,
  };
}
