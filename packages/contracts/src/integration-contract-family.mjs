export const INTEGRATION_CONTRACT_FAMILIES = Object.freeze([{
  family: "integration-report",
  familyGroup: "execution-and-quality",
  sourceContract: "docs/contracts/integration-report.md",
  exampleGlob: "examples/reports/integration-report-*.yaml",
  status: "implemented",
  requiredFields: [
    "schema_version", "report_id", "project_id", "parent_run_id",
    "execution_plan_ref", "workspace_set_ref", "status", "revision",
    "source_attempts", "repository_results", "aggregate_gates",
    "stale_units", "repair_refs", "blockers", "evidence_refs",
    "created_at", "updated_at",
  ],
  fieldTypes: {
    schema_version: "number", report_id: "string", project_id: "string",
    parent_run_id: "string", execution_plan_ref: "string",
    workspace_set_ref: "string", status: "string", revision: "number",
    source_attempts: "array", repository_results: "array",
    aggregate_gates: "array", stale_units: "array", repair_refs: "array",
    blockers: "array", evidence_refs: "array", created_at: "string",
    updated_at: "string",
  },
  enumChecks: [{
    field: "status",
    allowedValues: ["pending", "applying", "verification-pending", "blocked", "repair-required", "passed"],
  }],
}]);

export const INTEGRATION_EXAMPLE_RULES = Object.freeze([
  { regex: /^examples\/reports\/integration-report-[^/]+\.ya?ml$/, family: "integration-report" },
]);
