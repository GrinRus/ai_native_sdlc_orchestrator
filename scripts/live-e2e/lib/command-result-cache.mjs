import { asNonEmptyString, asRecord } from "./common.mjs";
import { resolveLiveE2eCommandStep } from "./step-command-ownership.mjs";

/**
 * @param {Record<string, unknown>} command
 * @returns {string}
 */
function commandResultIdentity(command) {
  const label = asNonEmptyString(command.label);
  if (!label) return "";
  const step = asNonEmptyString(command.step_id) || resolveLiveE2eCommandStep(label);
  if (!step) return label;
  const iteration = Number(command.iteration) || 1;
  const stepInstanceId = asNonEmptyString(command.step_instance_id) || (iteration > 1 ? `${step}#${iteration}` : step);
  return `${label}\u0000${stepInstanceId}`;
}

/**
 * Merge a partial replay snapshot into the durable command history. A resumed
 * invocation often replays only the completed prefix; replacing the snapshot
 * would otherwise discard later repair iterations and execute the wrong next
 * lifecycle stage.
 *
 * @param {unknown} previous
 * @param {unknown} current
 * @returns {Array<Record<string, unknown>>}
 */
export function mergeLiveE2eCommandResults(previous, current) {
  const merged = [];
  const indexByIdentity = new Map();
  for (const value of [
    ...(Array.isArray(previous) ? previous : []),
    ...(Array.isArray(current) ? current : []),
  ]) {
    const command = asRecord(value);
    const identity = commandResultIdentity(command);
    if (!identity) {
      merged.push(command);
      continue;
    }
    const existingIndex = indexByIdentity.get(identity);
    if (existingIndex === undefined) {
      indexByIdentity.set(identity, merged.length);
      merged.push(command);
    } else {
      merged[existingIndex] = command;
    }
  }
  return merged;
}
