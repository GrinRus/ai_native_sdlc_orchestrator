import path from "node:path";

import { asStringArray, uniqueTrimmedStrings } from "./shared/value-normalization.mjs";
import { getTaskActionDefinition } from "./control-plane/task-action-catalog.mjs";

const REGISTRY = Object.freeze({
  "discovery-run": ["mutation", "Create discovery evidence", "discovery run"],
  "spec-build": ["mutation", "Build specification evidence", "spec build"],
  "plan-create": ["mutation", "Create task plan", "plan create"],
  "review-run": ["mutation", "Run review checks", "review run"],
  "review-quality-repair": ["mutation", "Review repaired execution", "review run", ".repair"],
  "delivery-prepare": ["mutation", "Prepare no-write delivery evidence", "deliver prepare"],
  "release-prepare": ["mutation", "Prepare release evidence", "release prepare"],
  "learning-handoff": ["mutation", "Create learning handoff", "learning handoff"],
  "inspect-active-run": ["workbench", "Inspect active run", null],
  "inspect-quality-repair": ["refresh", "Refresh repair status", null],
  "review-decide": ["workbench", "Record review decision", null],
  "resolve-review-hold": ["workbench", "Review held decision", null],
  "handoff-approve": ["workbench", "Review and approve task plan", null],
  "start-new-flow": ["workbench", "Start follow-up Flow", null],
  "mission-create": ["workbench", "Create Mission evidence", null],
  "complete-mission-intake": ["workbench", "Complete Mission intake", null],
  "repair-mission-intake": ["workbench", "Repair Mission intake", null],
  "fix-onboarding": ["workbench", "Repair project setup", null],
  "fix-delivery-blockers": ["evidence", "Inspect delivery blockers", null],
  "repair-review-gate": ["workbench", "Review failed verification", null],
  "hold-exhausted-quality-repair": ["workbench", "Inspect exhausted repair", null],
  "run-review-repair": ["workbench", "Start review repair", null],
  "run-review-quality-repair": ["mutation", "Start review repair", "run start", ".repair", "implement"],
  "run-qa-quality-repair": ["mutation", "Start QA repair", "run start", ".repair", "implement"],
  "qa-quality-repair": ["mutation", "Run post-repair QA", "run start", ".repair.qa", "qa"],
});

function text(value) { return typeof value === "string" && value.trim() ? value.trim() : null; }

function isHandoffEvidenceRef(ref) {
  const normalized = ref.toLowerCase();
  return normalized.includes("handoff") && (normalized.includes("/artifacts/") || normalized.includes("artifact"));
}

function isPrioritizedPromotionEvidenceRef(ref) {
  const normalized = ref.toLowerCase();
  return normalized.includes("execution-readiness")
    || (normalized.includes("step-result") && normalized.includes("implement"))
    || normalized.startsWith("packet://spec@");
}

export function selectApprovedHandoffRef(evidenceRefs) {
  const candidates = evidenceRefs.filter((ref) => isHandoffEvidenceRef(ref));
  return candidates.find((ref) => path.isAbsolute(ref)) ?? candidates[0] ?? null;
}

export function selectPromotionEvidenceRefs(evidenceRefs, approvedHandoffRef) {
  const nonHandoffRefs = evidenceRefs.filter((ref) => ref !== approvedHandoffRef);
  const prioritized = nonHandoffRefs.filter((ref) => isPrioritizedPromotionEvidenceRef(ref));
  return (prioritized.length > 0 ? uniqueTrimmedStrings(prioritized) : uniqueTrimmedStrings(nonHandoffRefs)).slice(0, 6);
}

function runStartFlags(primaryAction, runId, runIdSuffix, targetStep) {
  const evidenceRefs = asStringArray(primaryAction.evidence_refs);
  const approvedHandoffRef = selectApprovedHandoffRef(evidenceRefs);
  return Object.fromEntries([
    ["run-id", `${runId}${runIdSuffix}`],
    ["target-step", targetStep],
    ["approved-handoff-ref", approvedHandoffRef],
    ["promotion-evidence-refs", selectPromotionEvidenceRefs(evidenceRefs, approvedHandoffRef).join(",")],
  ].filter(([, value]) => Boolean(value)));
}

export function operatorControlForAction(primaryAction, missionState, closureState) {
  const actionId = text(primaryAction.action_id);
  const definition = REGISTRY[actionId];
  if (!definition) return { category: "unavailable", label: "Action unavailable", availability: "blocked", operation: null, target_surface: null, requires_confirmation: false };
  const [category, label, command, runIdSuffix = "", runTargetStep = null] = definition;
  const runId = text(closureState.run_id);
  const flags = {};
  if (command === "discovery run" && text(missionState.intake_packet_ref)) flags["input-packet"] = missionState.intake_packet_ref;
  if (["review run", "learning handoff"].includes(command) && runId) flags["run-id"] = `${runId}${runIdSuffix}`;
  if (["deliver prepare", "release prepare"].includes(command)) { if (runId) flags["run-id"] = runId; flags.mode = text(missionState.delivery_mode) ?? "no-write"; }
  if (command === "run start") Object.assign(flags, runStartFlags(primaryAction, runId, runIdSuffix, runTargetStep));
  const operation = command && (!["review run", "learning handoff", "run start"].includes(command) || runId) ? { command, flags } : null;
  const requiresConfirmation = getTaskActionDefinition(actionId)?.requires_confirmation === true;
  return { category, label, availability: operation || category !== "mutation" ? "ready" : "blocked", operation, target_surface: category === "evidence" ? "evidence" : category === "workbench" ? "journey" : "cockpit", requires_confirmation: requiresConfirmation };
}
