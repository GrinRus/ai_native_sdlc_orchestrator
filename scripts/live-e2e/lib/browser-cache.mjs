import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  asNonEmptyString,
  fileExists,
  normalizeId,
  nowIso,
  writeJson,
} from "./common.mjs";

const BROWSER_CACHE_INPUT_FILES = Object.freeze([
  "package.json",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);

/**
 * Resolve a content-addressed browser cache namespace. The target checkout
 * path contains the run id and must not participate in the key: two runs of
 * the same target/revision should reuse the same Playwright binaries, while a
 * lockfile or platform change must produce a fresh namespace.
 *
 * @param {{ targetCheckoutRoot: string, targetRepoId?: string | null }} options
 * @returns {{ key: string, inputs: string[] }}
 */
export function deriveBrowserCacheKey(options) {
  const digest = createHash("sha256");
  const inputs = [];
  digest.update(`platform=${process.platform}\narch=${process.arch}\n`);
  const targetRepoId = asNonEmptyString(options.targetRepoId);
  if (targetRepoId) {
    digest.update(`target_repo_id=${targetRepoId}\n`);
    inputs.push(`target_repo_id:${targetRepoId}`);
  }
  let foundManifest = false;
  for (const relativePath of BROWSER_CACHE_INPUT_FILES) {
    const filePath = path.join(options.targetCheckoutRoot, relativePath);
    if (!fileExists(filePath)) continue;
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) continue;
    foundManifest = true;
    const content = fs.readFileSync(filePath);
    digest.update(`${relativePath}\0`);
    digest.update(content);
    inputs.push(`${relativePath}:${createHash("sha256").update(content).digest("hex")}`);
  }
  if (!foundManifest) {
    digest.update("manifest=missing\n");
    inputs.push("manifest:missing");
  }
  return { key: digest.digest("hex").slice(0, 32), inputs };
}

/**
 * @param {{ cacheRoot: string }} options
 * @returns {string[]}
 */
function listBrowserCacheEntries(options) {
  try {
    if (!fs.existsSync(options.cacheRoot)) return [];
    return fs.readdirSync(options.cacheRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^(?:chromium(?:_headless_shell)?|firefox|webkit|ffmpeg)-\d+$/u.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

/**
 * @param {{ targetCheckoutRoot: string, targetRepoId?: string | null, reportsRoot: string, runId: string, commands: string[], env: NodeJS.ProcessEnv, forceFailure?: boolean }} options
 */
export function prepareBrowserCachePreflight(options) {
  const reportFile = path.join(
    options.reportsRoot,
    `live-e2e-browser-cache-preflight-${normalizeId(options.runId)}.json`,
  );
  const required = options.commands.some((command) => /\bplaywright\b|ms-playwright|browserType\.launch/iu.test(command));
  const cacheIdentity = deriveBrowserCacheKey(options);
  const configuredCacheRoot = asNonEmptyString(options.env.AOR_LIVE_E2E_BROWSER_CACHE_ROOT) ||
    asNonEmptyString(process.env.AOR_LIVE_E2E_BROWSER_CACHE_ROOT);
  const cacheBase = configuredCacheRoot
    ? path.resolve(configuredCacheRoot)
    : path.join(os.tmpdir(), "aor-live-e2e-browser-cache");
  const cacheRoot = path.join(cacheBase, cacheIdentity.key);
  const cacheEntries = listBrowserCacheEntries({ cacheRoot });
  const cachePolicy = "content-addressed-manifest-v1";
  if (!required) {
    const report = {
      run_id: options.runId,
      status: "skipped",
      required: false,
      cache_root: cacheRoot,
      cache_policy: cachePolicy,
      cache_key: cacheIdentity.key,
      cache_inputs: cacheIdentity.inputs,
      cache_entries: cacheEntries,
      env_var: "PLAYWRIGHT_BROWSERS_PATH",
      summary: "No Playwright/browser cache preflight was required by declared target commands.",
      checked_at: nowIso(),
    };
    writeJson(reportFile, report);
    return { status: "skipped", report, reportFile };
  }

  try {
    if (options.forceFailure === true) {
      throw new Error("forced browser cache preflight failure");
    }
    fs.mkdirSync(cacheRoot, { recursive: true });
    const markerFile = path.join(cacheRoot, `.aor-cache-write-${normalizeId(options.runId)}.txt`);
    fs.writeFileSync(markerFile, `browser-cache-preflight:${options.runId}\n`, "utf8");
    fs.rmSync(markerFile, { force: true });
    options.env.PLAYWRIGHT_BROWSERS_PATH = cacheRoot;
    writeJson(path.join(cacheRoot, ".aor-browser-cache.json"), {
      schema_version: 1,
      cache_key: cacheIdentity.key,
      cache_inputs: cacheIdentity.inputs,
      target_repo_id: asNonEmptyString(options.targetRepoId) || null,
      platform: process.platform,
      arch: process.arch,
      updated_at: nowIso(),
    });
    const report = {
      run_id: options.runId,
      status: "pass",
      required: true,
      cache_root: cacheRoot,
      cache_policy: cachePolicy,
      cache_key: cacheIdentity.key,
      cache_inputs: cacheIdentity.inputs,
      cache_entries: listBrowserCacheEntries({ cacheRoot }),
      cache_reused: cacheEntries.length > 0,
      env_var: "PLAYWRIGHT_BROWSERS_PATH",
      summary: cacheEntries.length > 0
        ? "Content-addressed Playwright/browser cache is writable and already contains browser binaries."
        : "Content-addressed Playwright/browser cache is writable and ready for browser installation.",
      checked_at: nowIso(),
    };
    writeJson(reportFile, report);
    return { status: "pass", report, reportFile };
  } catch (error) {
    const summary = `Playwright/browser cache path is not writable: ${error instanceof Error ? error.message : String(error)}`;
    const report = {
      run_id: options.runId,
      status: "fail",
      required: true,
      cache_root: cacheRoot,
      cache_policy: cachePolicy,
      cache_key: cacheIdentity.key,
      cache_inputs: cacheIdentity.inputs,
      cache_entries: cacheEntries,
      env_var: "PLAYWRIGHT_BROWSERS_PATH",
      summary,
      checked_at: nowIso(),
    };
    writeJson(reportFile, report);
    return { status: "fail", report, reportFile };
  }
}
