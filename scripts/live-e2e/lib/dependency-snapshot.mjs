import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { normalizeId, writeJson } from "./common.mjs";

const DEPENDENCY_MANIFEST_NAMES = new Set([
  ".npmrc",
  ".pnpmfile.cjs",
  ".yarnrc",
  ".yarnrc.yml",
  "bun.lock",
  "bun.lockb",
  "npm-shrinkwrap.json",
  "package-lock.json",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "yarn.lock",
]);
const IGNORED_DIRECTORY_NAMES = new Set([".aor", ".git", "node_modules", ".pnpm", ".yarn"]);

function stableJsonValue(value) {
  if (Array.isArray(value)) return value.map((entry) => stableJsonValue(entry));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableJsonValue(entry)]),
    );
  }
  return value;
}

function digestBytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function collectDependencyManifestFiles(root) {
  const files = [];
  const visit = (directory, relativeDirectory = "") => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name))) {
      if (entry.isDirectory() && IGNORED_DIRECTORY_NAMES.has(entry.name)) continue;
      const absolutePath = path.join(directory, entry.name);
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        visit(absolutePath, relativePath);
        continue;
      }
      if (!DEPENDENCY_MANIFEST_NAMES.has(entry.name)) continue;
      if (entry.isSymbolicLink()) {
        files.push({ path: relativePath, kind: "symlink", digest: digestBytes(Buffer.from(fs.readlinkSync(absolutePath))) });
      } else if (entry.isFile()) {
        files.push({ path: relativePath, kind: "file", digest: digestBytes(fs.readFileSync(absolutePath)) });
      }
    }
  };
  visit(root);
  return files;
}

/**
 * Compute an input-only dependency identity. The run id is deliberately not
 * part of the payload: identical target commits and dependency manifests must
 * reuse the same isolated cache across resumptions and separate runs.
 *
 * @param {{ targetCheckoutRoot: string, targetRepoId: string, targetRepoRef: string,
 *   targetCommitSha: string, setupCommands?: string[], verificationCommands?: string[] }} options
 */
export function computeDependencySnapshot(options) {
  const payload = stableJsonValue({
    schema_version: 1,
    target: {
      repo_id: options.targetRepoId,
      ref: options.targetRepoRef,
      commit_sha: options.targetCommitSha,
      manifests: collectDependencyManifestFiles(options.targetCheckoutRoot),
    },
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    commands: {
      setup: Array.isArray(options.setupCommands) ? options.setupCommands : [],
      verification: Array.isArray(options.verificationCommands) ? options.verificationCommands : [],
    },
  });
  const digest = digestBytes(Buffer.from(JSON.stringify(payload)));
  return {
    algorithm: "sha256",
    hash: `sha256:${digest}`,
    digest,
    payload,
  };
}

/**
 * Materialize the stable cache namespace and an auditable snapshot report.
 * npm is pointed at this namespace by the caller. Keeping it outside the
 * target checkout prevents stale host cache metadata from crossing snapshots.
 *
 * @param {{ targetCheckoutRoot: string, targetRepoId: string, targetRepoRef: string,
 *   targetCommitSha: string, setupCommands?: string[], verificationCommands?: string[],
 *   runtimeRoot: string, reportsRoot: string, runId: string }} options
 */
export function materializeDependencySnapshot(options) {
  const snapshot = computeDependencySnapshot(options);
  const cacheNamespace = snapshot.digest.slice(0, 32);
  const cacheRoot = path.join(options.runtimeRoot, "dependency-cache", cacheNamespace, "npm");
  const markerFile = path.join(cacheRoot, ".aor-live-e2e-cache.json");
  const cacheReused = fs.existsSync(markerFile);
  fs.mkdirSync(cacheRoot, { recursive: true });
  writeJson(markerFile, {
    schema_version: 1,
    hash: snapshot.hash,
    target_commit_sha: options.targetCommitSha,
    updated_at: new Date().toISOString(),
  });
  const report = {
    schema_version: 1,
    hash: snapshot.hash,
    algorithm: snapshot.algorithm,
    cache_root: cacheRoot,
    cache_reused: cacheReused,
    cache_policy: "stable-input-namespace-with-online-resolution",
    target_repo_id: options.targetRepoId,
    target_repo_ref: options.targetRepoRef,
    target_commit_sha: options.targetCommitSha,
    input: snapshot.payload,
  };
  const reportFile = path.join(
    options.reportsRoot,
    `live-e2e-dependency-snapshot-${normalizeId(options.runId)}.json`,
  );
  writeJson(reportFile, report);
  return {
    ...snapshot,
    cacheRoot,
    cacheReused,
    report,
    reportFile,
    environment: {
      npm_config_cache: cacheRoot,
      AOR_LIVE_E2E_DEPENDENCY_SNAPSHOT_HASH: snapshot.hash,
      AOR_LIVE_E2E_DEPENDENCY_CACHE_ROOT: cacheRoot,
    },
  };
}

/**
 * @param {{ targetCheckout: { targetCheckoutRoot: string, targetRepoId: string,
 *   targetRepoRef: string, targetCommitSha: string }, setupCommands?: string[],
 *   verificationCommands?: string[], runtimeRoot: string, reportsRoot: string,
 *   runId: string, env: NodeJS.ProcessEnv, artifacts: Record<string, unknown> }} options
 */
export function materializeAndAttachDependencySnapshot(options) {
  const snapshot = materializeDependencySnapshot({
    targetCheckoutRoot: options.targetCheckout.targetCheckoutRoot,
    targetRepoId: options.targetCheckout.targetRepoId,
    targetRepoRef: options.targetCheckout.targetRepoRef,
    targetCommitSha: options.targetCheckout.targetCommitSha,
    setupCommands: options.setupCommands,
    verificationCommands: options.verificationCommands,
    runtimeRoot: options.runtimeRoot,
    reportsRoot: options.reportsRoot,
    runId: options.runId,
  });
  Object.assign(options.env, snapshot.environment);
  Object.assign(options.artifacts, {
    target_dependency_snapshot_hash: snapshot.hash,
    target_dependency_snapshot_file: snapshot.reportFile,
    target_dependency_cache_root: snapshot.cacheRoot,
  });
  return snapshot;
}

/**
 * `--prefer-offline` is unsafe with a shared npm cache: a stale package
 * manifest can advertise a parent package version before its companion
 * package metadata has arrived. The stable cache namespace makes reuse safe;
 * online preference keeps the first materialization self-healing.
 *
 * @param {string} command
 */
export function stabilizeDependencySetupCommand(command) {
  if (!/\bnpm\s+(?:install|i)\b/iu.test(command)) return command;
  return command.replace(/\s+--prefer-offline\b/giu, " --prefer-online");
}

/**
 * @param {string[]} commands
 */
export function stabilizeDependencySetupCommands(commands) {
  return commands.map((command) => stabilizeDependencySetupCommand(command));
}

export function resolveStabilizedSetupCommands(primary, fallback) {
  const selected = Array.isArray(primary) && primary.length > 0 ? primary : fallback;
  return stabilizeDependencySetupCommands(Array.isArray(selected) ? selected : []);
}
