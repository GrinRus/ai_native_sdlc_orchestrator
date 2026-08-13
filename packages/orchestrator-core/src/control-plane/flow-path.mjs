const READ_ONLY_PATH = Object.freeze([
  { id: "discovery", label: "Discover" },
  { id: "review", label: "Verify" },
  { id: "learning", label: "Learn" },
]);

const CHANGE_PATH = Object.freeze([
  { id: "discovery", label: "Discover" },
  { id: "spec", label: "Define" },
  { id: "planning", label: "Plan" },
  { id: "implement", label: "Execute" },
  { id: "review", label: "Verify" },
  { id: "delivery", label: "Deliver" },
  { id: "learning", label: "Learn" },
]);

const LIFECYCLE_STAGE_ALIASES = Object.freeze({
  bootstrap: "discovery",
  readiness: "discovery",
  mission: "discovery",
  onboarding: "discovery",
  "mission-intake": "discovery",
  research: "discovery",
  "spec-build": "spec",
  plan: "planning",
  handoff: "planning",
  "run-active": "implement",
  execution: "implement",
  validation: "review",
  qa: "review",
  eval: "review",
  evaluation: "review",
  harness: "review",
  repair: "review",
  release: "delivery",
});

const STEP_STATES = new Set(["completed", "current", "upcoming", "blocked", "skipped"]);

function normalizedLifecycleStage(selectedStage, path) {
  const normalized = typeof selectedStage === "string" ? selectedStage.trim().toLowerCase() : "";
  if (path.some((step) => step.id === normalized)) return normalized;
  const alias = LIFECYCLE_STAGE_ALIASES[normalized];
  return path.some((step) => step.id === alias) ? alias : path[0]?.id ?? null;
}

function normalizedRuntimePath(runtimePath, path, fallbackState, fallbackRefs) {
  const runtimeSteps = Array.isArray(runtimePath?.steps) ? runtimePath.steps : [];
  if (runtimeSteps.length === 0) return null;
  const byId = new Map(runtimeSteps.map((step) => [String(step?.id ?? "").trim(), step]));
  return path.map((step) => {
    const runtimeStep = byId.get(step.id);
    if (!runtimeStep) return { ...step, state: "upcoming", reason: null, evidence_refs: [] };
    const state = STEP_STATES.has(runtimeStep.state) ? runtimeStep.state : fallbackState;
    return {
      ...step,
      ...(typeof runtimeStep.label === "string" && runtimeStep.label.trim() ? { label: runtimeStep.label.trim() } : {}),
      state,
      reason: typeof runtimeStep.reason === "string" && runtimeStep.reason.trim() ? runtimeStep.reason.trim() : null,
      evidence_refs: Array.isArray(runtimeStep.evidence_refs)
        ? runtimeStep.evidence_refs.filter((ref) => typeof ref === "string" && ref.trim()).slice(0, 5)
        : fallbackRefs,
    };
  });
}

export function buildLifecyclePath(workType, selectedStage, status, evidenceRefs = [], runtimePath = null, blockers = []) {
  const readOnly = ["analyze", "explain", "review"].includes(workType);
  const path = readOnly ? READ_ONLY_PATH : CHANGE_PATH;
  const currentStage = normalizedLifecycleStage(selectedStage, path);
  const currentIndex = Math.max(0, path.findIndex((step) => step.id === currentStage));
  const refs = Array.isArray(evidenceRefs) ? evidenceRefs.filter((ref) => typeof ref === "string" && ref.trim()) : [];
  const fallbackState = status === "blocked" || (Array.isArray(blockers) && blockers.length > 0) ? "blocked" : "current";
  const runtimeSteps = normalizedRuntimePath(runtimePath, path, fallbackState, refs.slice(0, 5));
  const steps = runtimeSteps ?? path.map((step, index) => ({
    ...step,
    state: status === "completed"
      ? "completed"
      : index < currentIndex
        ? "completed"
        : index === currentIndex ? fallbackState : "upcoming",
    reason: null,
    evidence_refs: index === currentIndex ? refs.slice(0, 5) : [],
  }));
  return { path_id: readOnly ? "read-only" : "change", steps, owner: "runtime" };
}

const text = (value) => typeof value === "string" && value.trim() ? value.trim() : null;

export function buildFlowPresentation({ missionSettings, missionId, selectedStage, status, evidenceRefs, primaryAction, blockers, attentionCount, runtimeLifecyclePath, updatedAt }) {
  const settings = missionSettings && typeof missionSettings === "object" ? missionSettings : {};
  const action = primaryAction && typeof primaryAction === "object" ? primaryAction : {};
  const blockerList = Array.isArray(blockers) ? blockers : [];
  const lifecyclePath = buildLifecyclePath(settings.work_type, selectedStage, status, evidenceRefs, runtimeLifecyclePath, blockerList);
  const currentStep = lifecyclePath.steps.find((step) => ["current", "blocked"].includes(step.state)) ?? lifecyclePath.steps.find((step) => step.state === "upcoming") ?? lifecyclePath.steps.at(-1);
  return {
    display_title: text(settings.title) ?? missionId,
    work_type: text(settings.work_type),
    current_step: currentStep?.id ?? null,
    current_step_label: currentStep?.label ?? null,
    next_action_summary: text(action.reason) ?? text(action.command),
    primary_action: { action_id: text(action.action_id), operator_control: text(action.operator_control) ?? text(action.command), reason: text(action.reason), available: status !== "completed" && Boolean(text(action.action_id) || text(action.command)) },
    attention_count: Number.isInteger(attentionCount) && attentionCount >= 0 ? attentionCount : blockerList.length,
    blocker_count: blockerList.length,
    evidence_count: Array.isArray(evidenceRefs) ? evidenceRefs.length : 0,
    updated_at: updatedAt,
    lifecycle_path: lifecyclePath,
  };
}
