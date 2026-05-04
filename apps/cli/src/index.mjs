import { getCommandDefinition } from "./command-catalog.mjs";
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
 * @param {{ cwd?: string, stdout?: NodeJS.WriteStream, stderr?: NodeJS.WriteStream }} [options]
 * @returns {number}
 */
export function runCli(args, options = {}) {
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
