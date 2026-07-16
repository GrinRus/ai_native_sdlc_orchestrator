export const TOPOLOGY_CONTRACT_FAMILIES = Object.freeze([
  {
    family: "project-binding",
    familyGroup: "core-packets-and-profiles",
    sourceContract: "docs/contracts/project-binding.md",
    exampleGlob: "examples/bindings/*.yaml",
    status: "implemented",
    requiredFields: ["binding_id", "project_id", "profile_ref", "revision", "repositories"],
    fieldTypes: {
      binding_id: "string",
      project_id: "string",
      profile_ref: "string",
      revision: "number",
      repositories: "array",
    },
    enumChecks: [],
  },
  {
    family: "workspace-set",
    familyGroup: "execution-and-quality",
    sourceContract: "docs/contracts/workspace-set.md",
    exampleGlob: "examples/workspace-sets/*.yaml",
    status: "implemented",
    requiredFields: ["workspace_set_id", "project_id", "binding_ref", "status", "repositories", "conflicts"],
    fieldTypes: {
      workspace_set_id: "string",
      project_id: "string",
      binding_ref: "string",
      status: "string",
      repositories: "array",
      conflicts: "array",
    },
    enumChecks: [{ field: "status", allowedValues: ["planned", "ready", "blocked", "released"] }],
  },
]);

export const TOPOLOGY_EXAMPLE_RULES = Object.freeze([
  { regex: /^examples\/bindings\/[^/]+\.ya?ml$/, family: "project-binding" },
  { regex: /^examples\/workspace-sets\/[^/]+\.ya?ml$/, family: "workspace-set" },
]);
