export const EXECUTION_PLAN_STAGES = Object.freeze([
  "resolve-approved-plan", "group-tasks", "preserve-dependencies", "validate-scope", "persist-immutable-plan",
]);

export const TASK_PROGRESS_STAGES = Object.freeze([
  "read-evidence", "match-task-identity", "project-attempts", "evaluate-acceptance", "project-next-action",
]);

export function resolveTaskProgressStatus(signals) {
  if (signals.stale) return "stale";
  if (signals.failed || signals.blockingFindings > 0) return "failed";
  if (signals.running) return "in-progress";
  if (signals.adapterSucceeded) {
    return signals.evidenceComplete && signals.verificationPass && signals.criteriaSatisfied
      ? "complete"
      : "verification-pending";
  }
  return signals.dependenciesComplete ? "ready" : "blocked";
}

export function resolveOverallTaskProgressStatus(statuses) {
  if (statuses.every((status) => status === "complete")) return "complete";
  if (statuses.includes("failed")) return "failed";
  if (statuses.includes("stale")) return "stale";
  if (statuses.some((status) => status === "in-progress" || status === "verification-pending")) return "in-progress";
  if (statuses.includes("blocked")) return "blocked";
  return "planned";
}
