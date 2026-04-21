export const RUNTIME_ROOT_DIRNAME = ".aor";

const COMMAND_DEFINITIONS = Object.freeze([
  {
    command: "project init",
    category: "project-bootstrap",
    status: "implemented",
    summary: "Discover project root, load profile, and initialize runtime-root layout.",
    inputs: [
      "--project-ref <path> (optional, defaults to cwd discovery)",
      "--project-profile <path> (optional)",
      "--runtime-root <path> (optional)",
      "--help",
    ],
    outputs: [
      "resolved_project_ref",
      "resolved_runtime_root",
      "project_profile_ref",
      "runtime_layout",
      "runtime_state_file",
      "contract_families",
      "command_catalog_alignment",
    ],
    requiredFlags: [],
    contractFamilies: ["project-profile"],
  },
  {
    command: "project analyze",
    category: "project-bootstrap",
    status: "implemented",
    summary: "Analyze repository facts and write durable project-analysis report.",
    inputs: [
      "--project-ref <path>",
      "--project-profile <path> (optional)",
      "--runtime-root <path> (optional)",
      "--help",
    ],
    outputs: [
      "resolved_project_ref",
      "resolved_runtime_root",
      "analysis_report_id",
      "analysis_report_file",
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
    summary: "Run deterministic validation checks and persist validation-report.",
    inputs: [
      "--project-ref <path>",
      "--project-profile <path> (optional)",
      "--runtime-root <path> (optional)",
      "--help",
    ],
    outputs: [
      "resolved_project_ref",
      "resolved_runtime_root",
      "validation_report_id",
      "validation_report_file",
      "validation_status",
      "validation_blocking",
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
    inputs: [
      "--project-ref <path>",
      "--project-profile <path> (optional)",
      "--runtime-root <path> (optional)",
      "--require-validation-pass (optional)",
      "--help",
    ],
    outputs: [
      "resolved_project_ref",
      "resolved_runtime_root",
      "validation_gate_enforced",
      "validation_gate_status",
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
