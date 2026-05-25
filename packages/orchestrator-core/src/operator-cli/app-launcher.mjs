import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { attachUiLifecycle, detachUiLifecycle } from "../control-plane/ui-lifecycle.mjs";
import { createControlPlaneHttpServer } from "../control-plane/http/http-transport.mjs";

/**
 * @param {string | boolean | undefined} value
 * @param {boolean} defaultValue
 * @returns {boolean}
 */
function parseBooleanFlag(value, defaultValue) {
  if (value === undefined) return defaultValue;
  if (value === true) return true;
  if (value === false) return false;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error("Boolean flags accept only true or false.");
}

/**
 * @param {string | undefined} value
 * @returns {number | undefined}
 */
function parsePort(value) {
  if (value === undefined) return 0;
  if (!/^\d+$/u.test(value)) {
    throw new Error("Flag '--port' must be an integer from 0 to 65535.");
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
    throw new Error("Flag '--port' must be an integer from 0 to 65535.");
  }
  return parsed;
}

/**
 * @param {string | undefined} value
 * @returns {string}
 */
function parseHost(value) {
  const host = value ?? "127.0.0.1";
  if (host.trim() !== host || host.length === 0 || /\s/u.test(host) || host.includes("/")) {
    throw new Error("Flag '--host' must be a host name or IP address, not a URL or path.");
  }
  return host;
}

const APP_FLAGS = new Set(["project-ref", "runtime-root", "host", "port", "open", "json", "smoke"]);

/**
 * @param {string[]} args
 * @returns {Record<string, string | boolean>}
 */
function parseAppFlags(args) {
  /** @type {Record<string, string | boolean>} */
  const flags = {};
  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (!current.startsWith("--")) {
      throw new Error(`Unexpected argument '${current}'. Flags must use --name <value>.`);
    }
    const [rawName, inlineValue] = current.split("=", 2);
    const name = rawName.slice(2);
    if (!name) {
      throw new Error(`Invalid flag '${current}'.`);
    }
    if (!APP_FLAGS.has(name)) {
      throw new Error(`Unknown app flag '--${name}'.`);
    }
    if (Object.prototype.hasOwnProperty.call(flags, name)) {
      throw new Error(`Duplicate flag '--${name}'.`);
    }
    if (inlineValue !== undefined) {
      flags[name] = inlineValue;
      continue;
    }
    const next = args[index + 1];
    if (next && !next.startsWith("--")) {
      flags[name] = next;
      index += 1;
    } else {
      flags[name] = true;
    }
  }
  return flags;
}

/**
 * @param {Record<string, string | boolean>} flags
 * @param {string} name
 * @returns {string | undefined}
 */
function optionalString(flags, name) {
  const value = flags[name];
  if (value === undefined) return undefined;
  if (value === true || value === false) {
    throw new Error(`Flag '--${name}' requires a value.`);
  }
  return value;
}

/**
 * @returns {string}
 */
function repoRootFromModule() {
  const currentFile = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(currentFile), "../../../..");
}

/**
 * @param {string} root
 * @returns {string}
 */
function readPackageVersion(root) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    return typeof manifest.version === "string" ? manifest.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/**
 * @param {string} url
 */
function openBrowser(url) {
  const platform = process.platform;
  const command =
    platform === "darwin"
      ? "open"
      : platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

/**
 * @param {string} url
 */
async function getJson(url) {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`Smoke request failed (${response.status}) for ${url}.`);
  }
  return response.json();
}

/**
 * @param {string} url
 */
async function getText(url) {
  const response = await fetch(url, { headers: { accept: "text/html" } });
  if (!response.ok) {
    throw new Error(`Smoke request failed (${response.status}) for ${url}.`);
  }
  return response.text();
}

/**
 * @param {string[]} args
 * @param {{ cwd?: string, stdout?: NodeJS.WriteStream, stderr?: NodeJS.WriteStream }} [options]
 * @returns {Promise<number>}
 */
export async function runAppCommand(args, options = {}) {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  try {
    const flags = parseAppFlags(args);
    const cwd = options.cwd ?? process.cwd();
    const projectRef = path.resolve(cwd, optionalString(flags, "project-ref") ?? ".");
    if (!fs.existsSync(projectRef) || !fs.statSync(projectRef).isDirectory()) {
      throw new Error(`Project path '${projectRef}' does not exist or is not a directory.`);
    }

    const runtimeRootInput = optionalString(flags, "runtime-root");
    const host = parseHost(optionalString(flags, "host"));
    const port = parsePort(optionalString(flags, "port"));
    const open = parseBooleanFlag(flags.open, true);
    const json = parseBooleanFlag(flags.json, false);
    const smoke = parseBooleanFlag(flags.smoke, false);
    const packageRoot = repoRootFromModule();
    const staticRoot = path.join(packageRoot, "apps/web/dist");
    const packageVersion = readPackageVersion(packageRoot);

    const transport = await createControlPlaneHttpServer({
      cwd,
      projectRef,
      runtimeRoot: runtimeRootInput,
      host,
      port,
      app: {
        staticRoot,
        packageVersion,
      },
    });
    attachUiLifecycle({
      cwd,
      projectRef,
      runtimeRoot: runtimeRootInput,
      controlPlane: transport.baseUrl,
    });

    const stopLocalApp = async () => {
      detachUiLifecycle({
        cwd,
        projectRef,
        runtimeRoot: runtimeRootInput,
      });
      await transport.close();
    };

    const appUrl = `${transport.baseUrl}/`;
    const summary = {
      command: "app",
      mode: "local-spa",
      status: "running",
      app_url: appUrl,
      control_plane: transport.baseUrl,
      project_id: transport.projectId,
      project_ref: projectRef,
      runtime_root: runtimeRootInput ? path.resolve(cwd, runtimeRootInput) : path.join(projectRef, ".aor"),
      host: transport.host,
      port: transport.port,
      open,
      smoke,
    };

    if (smoke) {
      const html = await getText(appUrl);
      const config = await getJson(`${transport.baseUrl}/app-config.json`);
      const state = await getJson(`${transport.baseUrl}/api/projects/${encodeURIComponent(transport.projectId)}/state`);
      await stopLocalApp();
      stdout.write(
        `${JSON.stringify(
          {
            ...summary,
            status: "smoke-pass",
            html_loaded: html.includes("AOR Operator Console"),
            config_project_id: config.project_id,
            state_project_id: state.project_id,
          },
          null,
          2,
        )}\n`,
      );
      return 0;
    }

    if (json) {
      stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    } else {
      stdout.write(`AOR Operator Console: ${appUrl}\n`);
      stdout.write(`Project: ${projectRef}\n`);
      stdout.write("Press Ctrl+C to stop the local app server.\n");
    }
    if (open) {
      openBrowser(appUrl);
    }

    await new Promise((resolve) => {
      const stop = async () => {
        process.off("SIGINT", stop);
        process.off("SIGTERM", stop);
        await stopLocalApp();
        resolve(undefined);
      };
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
    });
    return 0;
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}
