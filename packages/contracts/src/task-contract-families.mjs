export const TASK_CONTRACT_FAMILIES = Object.freeze([
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
  { regex: /^examples\/tasks\/task-source-item[^/]*\.ya?ml$/, family: "task-source-item" },
  { regex: /^examples\/tasks\/task-runner-selection[^/]*\.ya?ml$/, family: "task-runner-selection" },
  { regex: /^examples\/tasks\/task-review[^/]*\.ya?ml$/, family: "task-review" },
]);
