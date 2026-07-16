import {
  CliUsageError,
  applyTopologyAction,
  createLocalProjectRegistry,
  ensureRequiredFlags,
  readProjectTopology,
  resolveOptionalIntegerFlag,
  resolveOptionalStringFlag,
  summarizeProjectContext,
} from "../command-runtime.mjs";

export const TOPOLOGY_COMMANDS = Object.freeze([
  "project list",
  "project add",
  "project import",
  "project repository",
  "project component",
  "project dependency",
  "project topology",
]);

export const TOPOLOGY_COMMAND_GROUP = Object.freeze({ group_id: "project-topology", commands: TOPOLOGY_COMMANDS });

function registry(cwd) {
  return createLocalProjectRegistry({ cwd, projects: [], persistence: { mode: "persistent" } });
}

function parseValue(flags) {
  const value = resolveOptionalStringFlag("value", flags.value);
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("mapping");
    return parsed;
  } catch {
    throw new CliUsageError("Flag '--value' must be a JSON object.");
  }
}

export function handleTopologyCommand({ command, flags, cwd, outputState }) {
  if (!TOPOLOGY_COMMANDS.includes(command)) return false;
  const workspace = registry(cwd);
  if (command === "project list") {
    outputState.workspace = workspace.summarize();
    return true;
  }
  if (command === "project add" || command === "project import") {
    ensureRequiredFlags(command, flags);
    const context = workspace.addProject({
      projectRef: /** @type {string} */ (flags["project-ref"]),
      projectProfile: resolveOptionalStringFlag("project-profile", flags["project-profile"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
      label: resolveOptionalStringFlag("label", flags.label),
    });
    outputState.project = summarizeProjectContext(context);
    outputState.workspace = workspace.summarize();
    return true;
  }
  ensureRequiredFlags(command, flags);
  const projectId = /** @type {string} */ (flags["project-id"]);
  const action = /** @type {string} */ (flags.action);
  if (action === "list" || action === "show") {
    outputState.topology = readProjectTopology({ registry: workspace, projectId });
    return true;
  }
  const family = command === "project repository"
    ? action === "rebind" ? "binding" : "repository"
    : command === "project component" ? "component"
      : command === "project dependency" ? "dependency" : "topology";
  const result = applyTopologyAction({
    registry: workspace,
    projectId,
    action,
    family,
    payload: parseValue(flags),
    expectedRevision: resolveOptionalIntegerFlag("expected-revision", flags["expected-revision"], { min: 0 }),
  });
  Object.assign(outputState, result);
  return true;
}
