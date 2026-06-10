import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

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
 * @param {string | boolean | undefined} value
 * @returns {"off" | "full" | "compact"}
 */
function parseJsonFlag(value) {
  if (value === undefined || value === false || value === "false") return "off";
  if (value === true || value === "true" || value === "full") return "full";
  if (value === "compact") return "compact";
  throw new Error("Flag '--json' accepts boolean values or one of: full, compact.");
}

/**
 * @param {unknown} value
 * @returns {unknown}
 */
function compactJson(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => compactJson(entry)).filter((entry) => entry !== undefined);
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .map(([key, entry]) => [key, compactJson(entry)])
      .filter(([, entry]) => {
        if (entry === undefined || entry === null || entry === "") return false;
        if (Array.isArray(entry) && entry.length === 0) return false;
        if (entry && typeof entry === "object" && Object.keys(entry).length === 0) return false;
        return true;
      });
    return Object.fromEntries(entries);
  }
  return value;
}

/**
 * @param {Record<string, unknown>} payload
 * @param {"full" | "compact"} jsonMode
 * @returns {string}
 */
function formatJson(payload, jsonMode) {
  return JSON.stringify(jsonMode === "compact" ? compactJson(payload) : payload, null, 2);
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

const APP_FLAGS = new Set(["project-ref", "project-profile", "runtime-root", "host", "port", "open", "json", "smoke"]);

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
 * @param {string} html
 * @returns {{ scripts: string[], stylesheets: string[] }}
 */
function extractPackagedAssetRefs(html) {
  /** @type {string[]} */
  const scripts = [];
  /** @type {string[]} */
  const stylesheets = [];
  const attributePattern = /\b(?:src|href)=["']([^"']+)["']/giu;
  for (const match of html.matchAll(attributePattern)) {
    const ref = match[1];
    if (ref.startsWith("http://") || ref.startsWith("https://") || ref.startsWith("//")) continue;
    if (ref.endsWith(".js")) {
      scripts.push(ref);
    } else if (ref.endsWith(".css")) {
      stylesheets.push(ref);
    }
  }
  return {
    scripts: [...new Set(scripts)].sort(),
    stylesheets: [...new Set(stylesheets)].sort(),
  };
}

/**
 * @param {string} ref
 * @param {string} baseUrl
 * @returns {string}
 */
function resolveAssetUrl(ref, baseUrl) {
  return new URL(ref, baseUrl).href;
}

/**
 * @param {string} url
 * @returns {Promise<string>}
 */
async function getAssetText(url) {
  const response = await fetch(url, { headers: { accept: "text/javascript, text/css, text/plain" } });
  if (!response.ok) {
    throw new Error(`Smoke asset request failed (${response.status}) for ${url}.`);
  }
  return response.text();
}

/**
 * @param {{ html: string, appUrl: string }} input
 * @returns {Promise<Record<string, unknown>>}
 */
async function buildRenderGuard(input) {
  const assets = extractPackagedAssetRefs(input.html);
  const scriptTexts = await Promise.all(
    assets.scripts.map((ref) => getAssetText(resolveAssetUrl(ref, input.appUrl))),
  );
  const stylesheetTexts = await Promise.all(
    assets.stylesheets.map((ref) => getAssetText(resolveAssetUrl(ref, input.appUrl))),
  );
  const combinedScripts = scriptTexts.join("\n");
  const rootElementPresent = /\bid=["']root["']/u.test(input.html);
  const titlePresent = input.html.includes("AOR Operator Console");
  const appShellMarkerPresent =
    combinedScripts.includes("AOR Operator Console") && combinedScripts.includes("Mission intake");
  const blankRootRegressionDetected = /\bmissionStatus\b/u.test(combinedScripts);
  const findings = [];
  if (!rootElementPresent) findings.push("index.html does not expose the React root element");
  if (!titlePresent) findings.push("index.html does not expose the console title");
  if (assets.scripts.length === 0) findings.push("index.html does not reference a packaged script bundle");
  if (assets.stylesheets.length === 0) findings.push("index.html does not reference a packaged stylesheet");
  if (!appShellMarkerPresent) findings.push("packaged script bundle does not include operator console shell markers");
  if (blankRootRegressionDetected) findings.push("packaged script bundle still contains the missionStatus blank-root regression");

  return {
    status: findings.length === 0 ? "pass" : "fail",
    root_element_present: rootElementPresent,
    title_present: titlePresent,
    module_script_count: assets.scripts.length,
    stylesheet_count: assets.stylesheets.length,
    checked_script_refs: assets.scripts,
    checked_stylesheet_refs: assets.stylesheets,
    checked_script_bytes: scriptTexts.reduce((sum, text) => sum + text.length, 0),
    checked_stylesheet_bytes: stylesheetTexts.reduce((sum, text) => sum + text.length, 0),
    app_shell_marker_present: appShellMarkerPresent,
    blank_root_regression_detected: blankRootRegressionDetected,
    findings,
  };
}

/**
 * @param {string} staticRoot
 * @returns {string}
 */
function readPackagedSpaText(staticRoot) {
  /** @type {string[]} */
  const chunks = [];
  const visit = (currentPath) => {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
        continue;
      }
      if (!entry.isFile() || !/\.(?:html|js|css)$/u.test(entry.name)) {
        continue;
      }
      chunks.push(fs.readFileSync(entryPath, "utf8"));
    }
  };
  visit(staticRoot);
  return chunks.join("\n");
}

/**
 * @param {string} staticRoot
 * @param {string} html
 * @returns {{ htmlLoaded: boolean, flowSelectorLoaded: boolean, newFlowActionLoaded: boolean, wizardLoaded: boolean, projectSwitcherLoaded: boolean }}
 */
function inspectPackagedSpa(staticRoot, html) {
  const packagedText = `${html}\n${readPackagedSpaText(staticRoot)}`;
  return {
    htmlLoaded: html.includes("AOR Operator Console"),
    flowSelectorLoaded: packagedText.includes("Flow selector") && packagedText.includes("flow-selector"),
    newFlowActionLoaded: packagedText.includes("New Flow") && packagedText.includes("new-flow-button"),
    wizardLoaded: packagedText.includes("First-run wizard") && packagedText.includes("first-run-wizard"),
    projectSwitcherLoaded: packagedText.includes("Project switcher") && packagedText.includes("project-switcher"),
  };
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
    const projectProfile = optionalString(flags, "project-profile");
    if (!fs.existsSync(projectRef) || !fs.statSync(projectRef).isDirectory()) {
      throw new Error(`Project path '${projectRef}' does not exist or is not a directory.`);
    }

    const runtimeRootInput = optionalString(flags, "runtime-root");
    const host = parseHost(optionalString(flags, "host"));
    const port = parsePort(optionalString(flags, "port"));
    const open = parseBooleanFlag(flags.open, true);
    const jsonMode = parseJsonFlag(flags.json);
    const smoke = parseBooleanFlag(flags.smoke, false);
    const packageRoot = repoRootFromModule();
    const staticRoot = path.join(packageRoot, "apps/web/dist");
    const packageVersion = readPackageVersion(packageRoot);

    const transport = await createControlPlaneHttpServer({
      cwd,
      projectRef,
      projectProfile,
      runtimeRoot: runtimeRootInput,
      host,
      port,
      app: {
        staticRoot,
        packageVersion,
      },
    });
    const stopLocalApp = async () => {
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
      project_profile_ref: transport.projectProfileRef,
      project_ref: projectRef,
      runtime_root: transport.runtimeRoot ?? (runtimeRootInput ? path.resolve(cwd, runtimeRootInput) : path.join(projectRef, ".aor")),
      host: transport.host,
      port: transport.port,
      open,
      smoke,
    };

    if (smoke) {
      let smokePass = false;
      let smokeSummary = summary;
      try {
        const html = await getText(appUrl);
        const config = await getJson(`${transport.baseUrl}/app-config.json`);
        const projectIndex = await getJson(`${transport.baseUrl}/api/projects`);
        const state = await getJson(`${transport.baseUrl}/api/projects/${encodeURIComponent(transport.projectId)}/state`);
        const packagedSpa = inspectPackagedSpa(staticRoot, html);
        const renderGuard = await buildRenderGuard({ html, appUrl });
        const routeChecksPass =
          packagedSpa.htmlLoaded &&
          packagedSpa.flowSelectorLoaded &&
          packagedSpa.newFlowActionLoaded &&
          packagedSpa.wizardLoaded &&
          packagedSpa.projectSwitcherLoaded &&
          config.project_id === transport.projectId &&
          projectIndex.default_project_id === transport.projectId &&
          state.project_id === transport.projectId;
        smokePass = routeChecksPass && renderGuard.status === "pass";
        smokeSummary = {
          ...summary,
          status: smokePass ? "smoke-pass" : "smoke-fail",
          html_loaded: packagedSpa.htmlLoaded,
          flow_selector_loaded: packagedSpa.flowSelectorLoaded,
          new_flow_action_loaded: packagedSpa.newFlowActionLoaded,
          first_run_wizard_loaded: packagedSpa.wizardLoaded,
          project_switcher_loaded: packagedSpa.projectSwitcherLoaded,
          config_project_id: config.project_id,
          config_default_project_id: config.default_project_id,
          config_project_profile_ref: config.project_profile_ref,
          project_index_default_project_id: projectIndex.default_project_id,
          project_index_count: Array.isArray(projectIndex.projects) ? projectIndex.projects.length : 0,
          state_project_id: state.project_id,
          state_project_profile_ref: state.project_profile_ref,
          render_guard_status: renderGuard.status,
          blank_root_regression_detected: renderGuard.blank_root_regression_detected,
          render_guard: renderGuard,
        };
      } finally {
        await stopLocalApp();
      }
      stdout.write(`${formatJson(smokeSummary, jsonMode === "compact" ? "compact" : "full")}\n`);
      return smokePass ? 0 : 1;
    }

    if (jsonMode !== "off") {
      stdout.write(`${formatJson(summary, jsonMode)}\n`);
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
