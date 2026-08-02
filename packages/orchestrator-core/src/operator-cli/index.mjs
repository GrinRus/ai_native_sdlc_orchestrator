import { getCommandDefinition } from "./command-catalog.mjs";
import { runAppCommand } from "./app-launcher.mjs";
import { openRunEventStream } from "../control-plane/live-event-stream.mjs";
import {
  CliUsageError,
  executeImplementedCommand,
  formatCommandHelp,
  formatTopLevelHelp,
  parseInvocation,
} from "./command-handler.mjs";

/**
 * @typedef {{
 *   exitCode: number,
 *   stdout: string,
 *   stderr: string,
 * }} CliResult
 */

/**
 * @param {string[]} args
 * @param {{ cwd?: string }} [options]
 * @returns {CliResult}
 */
export function invokeCli(args, options = {}) {
  const cwd = options.cwd ?? process.cwd();

  try {
    const invocation = parseInvocation(args);

    if (invocation.type === "top-help") {
      return {
        exitCode: 0,
        stdout: formatTopLevelHelp(),
        stderr: "",
      };
    }

    if (invocation.type === "command-help") {
      const definition = getCommandDefinition(invocation.command);
      if (!definition) {
        throw new CliUsageError(`Unknown command '${invocation.command}'.`);
      }

      if (definition.status !== "implemented") {
        return {
          exitCode: 0,
          stdout: `aor ${invocation.command}\nStatus: planned (not implemented yet)\n`,
          stderr: "",
        };
      }

      return {
        exitCode: 0,
        stdout: formatCommandHelp(definition),
        stderr: "",
      };
    }

    return executeImplementedCommand(invocation.command, invocation.flags, cwd);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      exitCode: 1,
      stdout: "",
      stderr: `${message}\n`,
    };
  }
}

/**
 * @param {string[]} args
 * @returns {boolean}
 */
function isAppLaunchInvocation(args) {
  if (args[0] !== "app") return false;
  return !args.slice(1).some((arg) => arg === "--help" || arg === "-h" || arg === "help");
}

function flagValue(args, name) {
  const index = args.indexOf(`--${name}`);
  if (index < 0) return undefined;
  const value = args[index + 1];
  return value && !value.startsWith("--") ? value : "true";
}

function isRunFollowInvocation(args) {
  return args[0] === "run" && args[1] === "status" && flagValue(args, "follow") !== undefined && flagValue(args, "follow") !== "false";
}

async function waitForFollowTerminal(args, options) {
  const projectRef = flagValue(args, "project-ref");
  const runId = flagValue(args, "run-id");
  if (!projectRef || !runId) return;
  const maxReplayRaw = Number(flagValue(args, "max-replay"));
  const stream = openRunEventStream({
    cwd: options.cwd ?? process.cwd(),
    projectRef,
    runtimeRoot: flagValue(args, "runtime-root"),
    runId,
    afterEventId: flagValue(args, "after-event-id"),
    maxReplay: Number.isInteger(maxReplayRaw) && maxReplayRaw >= 0 ? maxReplayRaw : undefined,
  });
  if (stream.cursor_terminal || stream.replay_events.some((event) => event.event_type === "run.terminal")) return;
  await new Promise((resolve) => {
    let unsubscribe = () => {};
    const finish = () => {
      unsubscribe();
      process.off("SIGINT", finish);
      resolve(undefined);
    };
    unsubscribe = stream.subscribe((event) => {
      if (event.event_type === "run.terminal") finish();
    });
    process.once("SIGINT", finish);
  });
}

/**
 * @param {string[]} args
 * @param {{ cwd?: string, stdout?: NodeJS.WriteStream, stderr?: NodeJS.WriteStream }} [options]
 * @returns {number | Promise<number>}
 */
export async function runCli(args, options = {}) {
  if (isAppLaunchInvocation(args)) {
    return runAppCommand(args.slice(1), options);
  }

  if (isRunFollowInvocation(args)) {
    await waitForFollowTerminal(args, options);
  }

  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;

  const result = invokeCli(args, options);

  if (result.stdout) {
    stdout.write(result.stdout);
  }
  if (result.stderr) {
    stderr.write(result.stderr);
  }

  return result.exitCode;
}
