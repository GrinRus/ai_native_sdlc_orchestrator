export const TASK_CONTRACT_FAMILIES = Object.freeze([
  {
    family: "task-projection",
    familyGroup: "execution-and-quality",
    sourceContract: "docs/contracts/task-projection.md",
    exampleGlob: "examples/tasks/task-projection*.yaml",
    status: "implemented",
    requiredFields: [
      "schema_version", "task_id", "project_id", "display_title", "status",
      "intent_submission_ref", "mission_id", "flow_id", "run_ids", "lineage",
      "source_items", "attention_items", "review", "completion", "lifecycle_path",
      "runner_selection", "primary_action", "prepared_contract", "completed_read_only",
      "read_only",
    ],
    fieldTypes: {
      schema_version: "number", task_id: "string", project_id: "string", display_title: "string",
      status: "string",
      run_ids: "array", lineage: "object", source_items: "array", attention_items: "array",
      review: "object", completion: "object", lifecycle_path: "object", runner_selection: "object",
      primary_action: "object", prepared_contract: "object", completed_read_only: "boolean", read_only: "boolean",
    },
    enumChecks: [{ field: "status", allowedValues: ["draft", "prepared", "active", "attention", "completed"] }],
  },
  {
    family: "task-source-item",
    familyGroup: "core-packets-and-profiles",
    sourceContract: "docs/contracts/task-source-item.md",
    exampleGlob: "examples/tasks/task-source-item*.yaml",
    status: "implemented",
    requiredFields: ["schema_version", "source_id", "kind", "immutable", "stale", "digest", "preview"],
    fieldTypes: { schema_version: "number", source_id: "string", kind: "string", immutable: "boolean", stale: "boolean", digest: "string", preview: "object" },
    enumChecks: [{ field: "kind", allowedValues: ["upload-snapshot", "repository-markdown", "inline-text"] }],
  },
  {
    family: "task-runner-selection",
    familyGroup: "execution-and-quality",
    sourceContract: "docs/contracts/task-runner-selection.md",
    exampleGlob: "examples/tasks/task-runner-selection*.yaml",
    status: "implemented",
    requiredFields: ["schema_version", "source", "route_id", "readiness", "requested_model", "effective_model", "requested_reasoning_effort", "effective_reasoning_effort", "unavailable_reason", "recovery_action"],
    fieldTypes: { schema_version: "number", source: "string", readiness: "string", recovery_action: "string" },
    enumChecks: [
      { field: "source", allowedValues: ["project-default", "task-override"] },
      { field: "readiness", allowedValues: ["ready", "unknown", "stale", "unavailable", "blocked"] },
    ],
  },
  {
    family: "task-review",
    familyGroup: "execution-and-quality",
    sourceContract: "docs/contracts/task-review.md",
    exampleGlob: "examples/tasks/task-review*.yaml",
    status: "implemented",
    requiredFields: ["schema_version", "task_id", "project_id", "availability", "files", "selected_path", "selected_file", "evidence_refs", "freshness", "read_only"],
    fieldTypes: { schema_version: "number", task_id: "string", project_id: "string", availability: "string", files: "array", evidence_refs: "array", freshness: "object", read_only: "boolean" },
    enumChecks: [{ field: "availability", allowedValues: ["available", "empty", "binary", "truncated", "unavailable"] }],
  },
]);

export const TASK_EXAMPLE_RULES = Object.freeze([
  { regex: /^examples\/tasks\/task-projection[^/]*\.ya?ml$/, family: "task-projection" },
  { regex: /^examples\/tasks\/task-source-item[^/]*\.ya?ml$/, family: "task-source-item" },
  { regex: /^examples\/tasks\/task-runner-selection[^/]*\.ya?ml$/, family: "task-runner-selection" },
  { regex: /^examples\/tasks\/task-review[^/]*\.ya?ml$/, family: "task-review" },
]);
