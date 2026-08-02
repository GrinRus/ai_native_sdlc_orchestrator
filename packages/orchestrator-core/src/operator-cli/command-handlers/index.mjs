import { BOOTSTRAP_COMMAND_GROUP, handleBootstrapCommand } from "./bootstrap.mjs";
import { DELIVERY_COMMAND_GROUP, handleDeliveryCommand } from "./delivery.mjs";
import { GUIDED_COMMAND_GROUP, handleGuidedCommand } from "./guided.mjs";
import { OPERATIONS_COMMAND_GROUP, handleOperationsCommand } from "./operations.mjs";
import { PLAN_COMMAND_GROUP, handlePlanCommand } from "./plan.mjs";
import { QUALITY_COMMAND_GROUP, handleQualityCommand } from "./quality.mjs";
import { REQUEST_COMMAND_GROUP, handleRequestCommand } from "./request.mjs";
import { RUN_CONTROL_COMMAND_GROUP, handleRunControlCommand } from "./run-control.mjs";
import { TOPOLOGY_COMMAND_GROUP, handleTopologyCommand } from "./topology.mjs";
import { ROUTE_COMMAND_GROUP, handleRouteCommand } from "./routes.mjs";

export const COMMAND_HANDLER_GROUPS = Object.freeze([
  GUIDED_COMMAND_GROUP,
  TOPOLOGY_COMMAND_GROUP,
  ROUTE_COMMAND_GROUP,
  BOOTSTRAP_COMMAND_GROUP,
  PLAN_COMMAND_GROUP,
  QUALITY_COMMAND_GROUP,
  RUN_CONTROL_COMMAND_GROUP,
  REQUEST_COMMAND_GROUP,
  DELIVERY_COMMAND_GROUP,
  OPERATIONS_COMMAND_GROUP,
]);

const COMMAND_TO_GROUP = new Map(
  COMMAND_HANDLER_GROUPS.flatMap((group) =>
    group.commands.map((command) => [command, group.group_id]),
  ),
);

const GROUP_HANDLERS = new Map([
  ["guided-first-run", handleGuidedCommand],
  ["project-topology", handleTopologyCommand],
  ["execution-routes", handleRouteCommand],
  ["bootstrap", handleBootstrapCommand],
  ["structured-plans", handlePlanCommand],
  ["quality", handleQualityCommand],
  ["run-control", handleRunControlCommand],
  ["operator-requests", handleRequestCommand],
  ["delivery", handleDeliveryCommand],
  ["operations", handleOperationsCommand],
]);

/**
 * @param {string} command
 * @returns {string | null}
 */
export function resolveCommandHandlerGroup(command) {
  return COMMAND_TO_GROUP.get(command) ?? null;
}

/**
 * @param {{ groupId: string, command: string, flags: Record<string, string | string[] | true>, cwd: string, outputState: Record<string, unknown> }} options
 * @returns {boolean}
 */
export function executeCommandHandlerGroup(options) {
  const handler = GROUP_HANDLERS.get(options.groupId);
  return handler ? handler(options) : false;
}
