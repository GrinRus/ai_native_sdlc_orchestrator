export const RUNTIME_ROOT_DIRNAME = ".aor";

const COMMAND_DEFINITIONS = Object.freeze([
  {
    command: "project init",
    category: "project-bootstrap",
    status: "implemented",
    summary: "Discover a project ref and resolve runtime-root conventions for bootstrap.",
    inputs: ["--project-ref <path>", "--runtime-root <path> (optional)", "--help"],
    outputs: [
      "resolved_project_ref",
      "resolved_runtime_root",
      "contract_families",
      "command_catalog_alignment",
    ],
    requiredFlags: ["project-ref"],
    contractFamilies: ["project-profile"],
  },
  {
    command: "project analyze",
    category: "project-bootstrap",
    status: "implemented",
    summary: "Validate command contract inputs for analysis bootstrap flow.",
    inputs: ["--project-ref <path>", "--runtime-root <path> (optional)", "--help"],
    outputs: [
      "resolved_project_ref",
      "resolved_runtime_root",
      "contract_families",
      "command_catalog_alignment",
    ],
    requiredFlags: ["project-ref"],
    contractFamilies: ["project-analysis-report"],
  },
  {
    command: "project validate",
    category: "project-bootstrap",
    status: "implemented",
    summary: "Validate command contract inputs for deterministic validation flow.",
    inputs: ["--project-ref <path>", "--runtime-root <path> (optional)", "--help"],
    outputs: [
      "resolved_project_ref",
      "resolved_runtime_root",
      "contract_families",
      "command_catalog_alignment",
    ],
    requiredFlags: ["project-ref"],
    contractFamilies: ["validation-report"],
  },
  {
    command: "project verify",
    category: "project-bootstrap",
    status: "implemented",
    summary: "Validate command contract inputs for bounded verify preflight flow.",
    inputs: ["--project-ref <path>", "--runtime-root <path> (optional)", "--help"],
    outputs: [
      "resolved_project_ref",
      "resolved_runtime_root",
      "contract_families",
      "command_catalog_alignment",
    ],
    requiredFlags: ["project-ref"],
    contractFamilies: ["step-result"],
  },
  { command: "intake create", category: "intake-and-planning", status: "planned" },
  { command: "discovery run", category: "intake-and-planning", status: "planned" },
  { command: "spec build", category: "intake-and-planning", status: "planned" },
  { command: "wave create", category: "intake-and-planning", status: "planned" },
  { command: "handoff prepare", category: "intake-and-planning", status: "planned" },
  { command: "handoff approve", category: "intake-and-planning", status: "planned" },
  { command: "run start", category: "execution-lifecycle", status: "planned" },
  { command: "run pause", category: "execution-lifecycle", status: "planned" },
  { command: "run resume", category: "execution-lifecycle", status: "planned" },
  { command: "run steer", category: "execution-lifecycle", status: "planned" },
  { command: "run cancel", category: "execution-lifecycle", status: "planned" },
  { command: "run status", category: "execution-lifecycle", status: "planned" },
  { command: "eval run", category: "quality-workflows", status: "planned" },
  { command: "harness replay", category: "quality-workflows", status: "planned" },
  { command: "harness certify", category: "quality-workflows", status: "planned" },
  { command: "asset promote", category: "quality-workflows", status: "planned" },
  { command: "asset freeze", category: "quality-workflows", status: "planned" },
  { command: "deliver prepare", category: "delivery-and-release", status: "planned" },
  { command: "release prepare", category: "delivery-and-release", status: "planned" },
  { command: "packet show", category: "delivery-and-release", status: "planned" },
  { command: "evidence show", category: "delivery-and-release", status: "planned" },
  { command: "incident open", category: "incidents-and-audit", status: "planned" },
  { command: "incident show", category: "incidents-and-audit", status: "planned" },
  { command: "audit runs", category: "incidents-and-audit", status: "planned" },
  { command: "live-e2e start", category: "live-e2e-and-ui", status: "planned" },
  { command: "live-e2e status", category: "live-e2e-and-ui", status: "planned" },
  { command: "live-e2e report", category: "live-e2e-and-ui", status: "planned" },
  { command: "ui attach", category: "live-e2e-and-ui", status: "planned" },
  { command: "ui detach", category: "live-e2e-and-ui", status: "planned" },
]);

export function getCliCommandCatalog() {
  return COMMAND_DEFINITIONS.map((definition) => ({ ...definition }));
}

export function getImplementedCommands() {
  return getCliCommandCatalog().filter((definition) => definition.status === "implemented");
}

export function getPlannedCommands() {
  return getCliCommandCatalog().filter((definition) => definition.status === "planned");
}

export function getCommandDefinition(command) {
  return getCliCommandCatalog().find((definition) => definition.command === command) ?? null;
}
