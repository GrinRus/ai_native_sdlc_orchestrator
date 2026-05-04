import { BOOTSTRAP_COMMAND_GROUP, handleBootstrapCommand } from "./bootstrap.mjs";
import { DELIVERY_COMMAND_GROUP, handleDeliveryCommand } from "./delivery.mjs";
import { OPERATIONS_COMMAND_GROUP, handleOperationsCommand } from "./operations.mjs";
import { QUALITY_COMMAND_GROUP, handleQualityCommand } from "./quality.mjs";
import { RUN_CONTROL_COMMAND_GROUP, handleRunControlCommand } from "./run-control.mjs";

export const COMMAND_HANDLER_GROUPS = Object.freeze([
  BOOTSTRAP_COMMAND_GROUP,
  QUALITY_COMMAND_GROUP,
  RUN_CONTROL_COMMAND_GROUP,
  DELIVERY_COMMAND_GROUP,
  OPERATIONS_COMMAND_GROUP,
]);

const COMMAND_TO_GROUP = new Map(
  COMMAND_HANDLER_GROUPS.flatMap((group) =>
    group.commands.map((command) => [command, group.group_id]),
  ),
);

const GROUP_HANDLERS = new Map([
  ["bootstrap", handleBootstrapCommand],
  ["quality", handleQualityCommand],
  ["run-control", handleRunControlCommand],
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
