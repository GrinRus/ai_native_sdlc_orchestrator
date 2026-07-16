export const NEXT_ACTION_PROJECTION_STAGES = Object.freeze([
  "collect-evidence", "project-closure", "project-artifact-readiness", "select-blockers", "select-safe-action", "assemble-report",
]);
export const RUN_READ_PROJECTION_STAGES = Object.freeze([
  "read-artifacts", "filter-project-flow", "project-health-status", "sort", "paginate",
]);
export const CERTIFICATION_PROJECTION_STAGES = Object.freeze([
  "validate-prerequisites", "aggregate-evidence", "apply-policy", "project-score", "persist-decision",
]);

export function runProjectionCoordinator(service, options) {
  return service(options);
}
