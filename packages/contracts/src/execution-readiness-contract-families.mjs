const READINESS_STATES = [
  "unconfigured",
  "runner-missing",
  "auth-missing",
  "model-unsupported",
  "capability-mismatch",
  "policy-denied",
  "ready",
  "stale",
];

export const EXECUTION_READINESS_CONTRACT_FAMILIES = Object.freeze([
  {
    family: "execution-profile",
    familyGroup: "core-packets-and-profiles",
    sourceContract: "docs/contracts/execution-profile.md",
    exampleGlob: "examples/execution/execution-profile*.yaml",
    status: "implemented",
    forbiddenFields: ["credential", "credentials", "token", "environment", "auth_value"],
    requiredFields: ["profile_id", "project_id", "revision", "initialized", "routes", "read_only"],
    fieldTypes: {
      profile_id: "string",
      project_id: "string",
      revision: "number",
      initialized: "boolean",
      routes: "array",
      latest_readiness_ref: "string",
      read_only: "boolean",
    },
    enumChecks: [],
  },
  {
    family: "execution-readiness-report",
    familyGroup: "execution-and-quality",
    sourceContract: "docs/contracts/execution-readiness-report.md",
    exampleGlob: "examples/execution/execution-readiness-report*.yaml",
    status: "implemented",
    forbiddenFields: ["credential", "credentials", "token", "environment", "auth_value"],
    requiredFields: ["report_id", "project_id", "revision", "status", "checked_at", "step_results", "evidence_refs"],
    fieldTypes: {
      report_id: "string",
      project_id: "string",
      revision: "number",
      status: "string",
      checked_at: "string",
      step_results: "array",
      evidence_refs: "array",
    },
    enumChecks: [{ field: "status", allowedValues: READINESS_STATES }],
  },
]);

export const EXECUTION_READINESS_EXAMPLE_RULES = Object.freeze([
  { regex: /^examples\/execution\/execution-profile[^/]*\.ya?ml$/u, family: "execution-profile" },
  { regex: /^examples\/execution\/execution-readiness-report[^/]*\.ya?ml$/u, family: "execution-readiness-report" },
]);

export { READINESS_STATES as EXECUTION_READINESS_STATES };
