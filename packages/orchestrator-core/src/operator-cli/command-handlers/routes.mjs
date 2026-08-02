import {
  applyExecutionProfileAction,
  createLocalProjectRegistry,
  ensureRequiredFlags,
  readExecutionProfile,
  resolveOptionalIntegerFlag,
  resolveOptionalStringFlag,
} from "../command-runtime.mjs";

export const ROUTE_COMMANDS = Object.freeze(["route show", "route select", "route reset", "route check"]);
export const ROUTE_COMMAND_GROUP = Object.freeze({ group_id: "execution-routes", commands: ROUTE_COMMANDS });

function registry(cwd) {
  return createLocalProjectRegistry({ cwd, projects: [], persistence: { mode: "persistent" } });
}

export function handleRouteCommand({ command, flags, cwd, outputState }) {
  if (!ROUTE_COMMANDS.includes(command)) return false;
  ensureRequiredFlags(command, flags);
  const workspace = registry(cwd);
  const projectId = /** @type {string} */ (flags["project-id"]);
  if (command === "route show") {
    outputState.executionProfile = readExecutionProfile({ registry: workspace, projectId });
    return true;
  }
  const action = command.split(" ")[1];
  const result = applyExecutionProfileAction({
    registry: workspace,
    projectId,
    action,
    step: resolveOptionalStringFlag("step", flags.step),
    routeId: resolveOptionalStringFlag("route", flags.route),
    expectedRevision: resolveOptionalIntegerFlag("expected-revision", flags["expected-revision"], { min: 0 }),
  });
  outputState.executionProfile = result.execution_profile;
  outputState.executionReadinessReport = result.readiness_report;
  return true;
}
