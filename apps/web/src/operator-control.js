const CATEGORIES = new Set(["mutation", "workbench", "evidence", "copy", "refresh", "unavailable"]);
const SURFACES = new Set(["cockpit", "attention", "journey", "evidence"]);

const LEGACY_ACTION_REGISTRY = Object.freeze({
  "discovery-run": { category: "mutation", label: "Create discovery evidence", operation: { command: "discovery run", flags: {} } },
  "spec-build": { category: "mutation", label: "Build specification evidence", operation: { command: "spec build", flags: {} } },
  "plan-create": { category: "mutation", label: "Create task plan", operation: { command: "plan create", flags: {} } },
  "review-run": { category: "workbench", label: "Review execution evidence", operation: null, target_surface: "journey" },
  "review-decide": { category: "workbench", label: "Record review decision", operation: null, target_surface: "journey" },
  "inspect-active-run": { category: "workbench", label: "Inspect active run", operation: null, target_surface: "journey" },
  "start-new-flow": { category: "workbench", label: "Start follow-up Flow", operation: null, target_surface: "cockpit" },
  "fix-delivery-blockers": { category: "evidence", label: "Inspect delivery blockers", operation: null, target_surface: "evidence" },
});

function normalizeOperation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const command = typeof value.command === "string" ? value.command.trim() : "";
  const flags = value.flags && typeof value.flags === "object" && !Array.isArray(value.flags) ? value.flags : {};
  return command ? { command, flags } : null;
}

export function resolveOperatorControl(primaryAction) {
  const embedded = primaryAction?.operator_control;
  if (embedded && CATEGORIES.has(embedded.category) && typeof embedded.label === "string") {
    const operation = normalizeOperation(embedded.operation);
    return {
      category: embedded.category,
      label: embedded.label.trim(),
      availability: embedded.availability === "ready" ? "ready" : "blocked",
      operation,
      targetSurface: SURFACES.has(embedded.target_surface) ? embedded.target_surface : null,
      requiresConfirmation: embedded.requires_confirmation === true,
      source: "report",
    };
  }
  const legacy = LEGACY_ACTION_REGISTRY[primaryAction?.action_id];
  if (!legacy) return { category: "unavailable", label: "Action unavailable", availability: "blocked", operation: null, targetSurface: null, requiresConfirmation: false, source: "compatibility" };
  return { ...legacy, availability: "ready", targetSurface: legacy.target_surface ?? "cockpit", requiresConfirmation: false, source: "compatibility" };
}

export function operatorControlTargetTab(control) {
  if (control?.targetSurface === "evidence") return "evidence";
  if (control?.targetSurface === "attention") return "decisions";
  return "execution";
}
