#!/usr/bin/env node
import { createControlPlaneHttpServer } from "../src/index.mjs";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8080;

class UsageError extends Error {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(message);
    this.name = "UsageError";
  }
}

/**
 * @param {string[]} args
 * @returns {Record<string, string | true>}
 */
function parseFlags(args) {
  /** @type {Record<string, string | true>} */
  const flags = {};

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (!current.startsWith("--")) {
      throw new UsageError(`Unexpected argument '${current}'. Flags must use --name <value>.`);
    }

    const [rawName, inlineValue] = current.split("=", 2);
    const flagName = rawName.slice(2);
    if (!flagName) {
      throw new UsageError(`Invalid flag '${current}'.`);
    }
    if (Object.prototype.hasOwnProperty.call(flags, flagName)) {
      throw new UsageError(`Duplicate flag '--${flagName}'.`);
    }

    if (inlineValue !== undefined) {
      flags[flagName] = inlineValue;
      continue;
    }

    const next = args[index + 1];
    if (next && !next.startsWith("--")) {
      flags[flagName] = next;
      index += 1;
      continue;
    }

    flags[flagName] = true;
  }

  return flags;
}

/**
 * @param {string} flagName
 * @param {string | true | undefined} value
 * @returns {string | undefined}
 */
function optionalString(flagName, value) {
  if (value === undefined) return undefined;
  if (value === true) {
    throw new UsageError(`Flag '--${flagName}' requires a value.`);
  }
  if (value.trim().length === 0) {
    throw new UsageError(`Flag '--${flagName}' cannot be empty.`);
  }
  return value;
}

/**
 * @param {string} flagName
 * @param {string | true | undefined} value
 * @param {number} defaultValue
 * @returns {number}
 */
function optionalPort(flagName, value, defaultValue) {
  const raw = optionalString(flagName, value);
  if (raw === undefined) return defaultValue;
  if (!/^\d+$/.test(raw)) {
    throw new UsageError(`Flag '--${flagName}' must be a non-negative integer.`);
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(parsed) || parsed > 65535) {
    throw new UsageError(`Flag '--${flagName}' must be between 0 and 65535.`);
  }
  return parsed;
}

/**
 * @param {string} flagName
 * @param {string | true | undefined} value
 * @returns {boolean}
 */
function optionalBoolean(flagName, value) {
  if (value === undefined) return false;
  if (value === true || value === "true") return true;
  if (value === "false") return false;
  throw new UsageError(`Flag '--${flagName}' accepts only boolean values ('true' or 'false').`);
}

/**
 * @param {string | true | undefined} value
 * @returns {boolean}
 */
function jsonRequested(value) {
  return optionalBoolean("json", value);
}

/**
 * @param {Record<string, unknown>} summary
 * @param {{ json: boolean }} options
 */
function printSummary(summary, options) {
  if (options.json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }

  process.stdout.write(
    [
      "AOR detached control-plane smoke",
      `Status: ${String(summary.status)}`,
      `Base URL: ${String(summary.base_url)}`,
      `Project id: ${String(summary.project_id)}`,
      `State URL: ${String(summary.state_url)}`,
      `Serve: ${String(summary.serve)}`,
      "",
    ].join("\n"),
  );
}

/**
 * @param {{ close: () => Promise<void> }} transport
 */
function installShutdownHandlers(transport) {
  let closing = false;
  const closeAndExit = async () => {
    if (closing) return;
    closing = true;
    await transport.close();
    process.exit(0);
  };
  process.once("SIGINT", closeAndExit);
  process.once("SIGTERM", closeAndExit);
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const projectRef = optionalString("project-ref", flags["project-ref"]);
  if (!projectRef) {
    throw new UsageError("Missing required flag '--project-ref <path>'.");
  }

  const host = optionalString("host", flags.host) ?? DEFAULT_HOST;
  const port = optionalPort("port", flags.port, DEFAULT_PORT);
  const runtimeRoot = optionalString("runtime-root", flags["runtime-root"]);
  const serve = optionalBoolean("serve", flags.serve);
  const json = jsonRequested(flags.json);

  const transport = await createControlPlaneHttpServer({
    cwd: process.cwd(),
    projectRef,
    runtimeRoot,
    host,
    port,
  });

  const stateUrl = `${transport.baseUrl}/api/projects/${encodeURIComponent(transport.projectId)}/state`;
  try {
    const response = await fetch(stateUrl, { headers: { accept: "application/json" } });
    if (!response.ok) {
      throw new Error(`GET ${stateUrl} failed with HTTP ${response.status}.`);
    }
    await response.json();

    printSummary(
      {
        status: "ready",
        base_url: transport.baseUrl,
        project_id: transport.projectId,
        state_url: stateUrl,
        serve,
      },
      { json },
    );

    if (serve) {
      installShutdownHandlers(transport);
      return await new Promise(() => {});
    }
  } finally {
    if (!serve) {
      await transport.close();
    }
  }
}

main().catch((error) => {
  const prefix = error instanceof UsageError ? "Usage error" : "Control-plane smoke failed";
  process.stderr.write(`${prefix}: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
