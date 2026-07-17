const REGISTRY = Object.freeze({
  "discovery-run": ["mutation", "Create discovery evidence", "discovery run"],
  "spec-build": ["mutation", "Build specification evidence", "spec build"],
  "plan-create": ["mutation", "Create task plan", "plan create"],
  "review-run": ["mutation", "Run review checks", "review run"],
  "review-quality-repair": ["mutation", "Review repaired execution", "review run"],
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
  "run-review-quality-repair": ["workbench", "Start review repair", null],
  "run-qa-quality-repair": ["workbench", "Start QA repair", null],
  "qa-quality-repair": ["workbench", "Run post-repair QA", null],
});

function text(value) { return typeof value === "string" && value.trim() ? value.trim() : null; }

export function operatorControlForAction(primaryAction, missionState, closureState) {
  const definition = REGISTRY[text(primaryAction.action_id)];
  if (!definition) return { category: "unavailable", label: "Action unavailable", availability: "blocked", operation: null, target_surface: null, requires_confirmation: false };
  const [category, label, command] = definition;
  const runId = text(closureState.run_id);
  const flags = {};
  if (command === "discovery run" && text(missionState.intake_packet_ref)) flags["input-packet"] = missionState.intake_packet_ref;
  if (["review run", "learning handoff"].includes(command) && runId) flags["run-id"] = runId;
  if (["deliver prepare", "release prepare"].includes(command)) { if (runId) flags["run-id"] = runId; flags.mode = text(missionState.delivery_mode) ?? "no-write"; }
  const operation = command && (!['review run', 'learning handoff'].includes(command) || runId) ? { command, flags } : null;
  return { category, label, availability: operation || category !== "mutation" ? "ready" : "blocked", operation, target_surface: category === "evidence" ? "evidence" : category === "workbench" ? "journey" : "cockpit", requires_confirmation: ["deliver prepare", "release prepare", "learning handoff"].includes(command) };
}
