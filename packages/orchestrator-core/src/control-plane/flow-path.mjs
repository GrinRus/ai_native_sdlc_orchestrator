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

function normalizedLifecycleStage(selectedStage, path) {
  const normalized = typeof selectedStage === "string" ? selectedStage.trim().toLowerCase() : "";
  if (path.some((step) => step.id === normalized)) return normalized;
  const alias = LIFECYCLE_STAGE_ALIASES[normalized];
  return path.some((step) => step.id === alias) ? alias : path[0]?.id ?? null;
}

export function buildLifecyclePath(workType, selectedStage, status, evidenceRefs = []) {
  const readOnly = ["analyze", "explain", "review"].includes(workType);
  const path = readOnly ? READ_ONLY_PATH : CHANGE_PATH;
  const currentStage = normalizedLifecycleStage(selectedStage, path);
  const currentIndex = Math.max(0, path.findIndex((step) => step.id === currentStage));
  const refs = Array.isArray(evidenceRefs) ? evidenceRefs.filter((ref) => typeof ref === "string" && ref.trim()) : [];
  const steps = path.map((step, index) => ({
    ...step,
    state: status === "completed"
      ? "completed"
      : index < currentIndex
        ? "completed"
        : index === currentIndex ? "current" : "upcoming",
    reason: null,
    evidence_refs: index === currentIndex ? refs.slice(0, 5) : [],
  }));
  return { path_id: readOnly ? "read-only" : "change", steps, owner: "runtime" };
}

const text = (value) => typeof value === "string" && value.trim() ? value.trim() : null;

export function buildFlowPresentation({ missionSettings, missionId, selectedStage, status, evidenceRefs, primaryAction, blockers, updatedAt }) {
  const settings = missionSettings && typeof missionSettings === "object" ? missionSettings : {};
  const action = primaryAction && typeof primaryAction === "object" ? primaryAction : {};
  const blockerList = Array.isArray(blockers) ? blockers : [];
  const lifecyclePath = buildLifecyclePath(settings.work_type, selectedStage, status, evidenceRefs);
  return {
    display_title: text(settings.title) ?? missionId,
    work_type: text(settings.work_type),
    current_step: lifecyclePath.steps.find((step) => step.state === "current")?.id ?? lifecyclePath.steps.at(-1)?.id ?? null,
    next_action_summary: text(action.reason) ?? text(action.command),
    attention_count: blockerList.length,
    blocker_count: blockerList.length,
    evidence_count: Array.isArray(evidenceRefs) ? evidenceRefs.length : 0,
    updated_at: updatedAt,
    lifecycle_path: lifecyclePath,
  };
}
