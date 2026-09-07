import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { normalizeId, writeJson } from "./common.mjs";

const DEPENDENCY_MANIFEST_NAMES = new Set([
  ".npmrc", ".pnpmfile.cjs", ".yarnrc", ".yarnrc.yml", "bun.lock", "bun.lockb",
  "npm-shrinkwrap.json", "package-lock.json", "package.json", "pnpm-lock.yaml",
  "pnpm-workspace.yaml", "yarn.lock",
]);
const IGNORED_DIRECTORY_NAMES = new Set([".aor", ".git", "node_modules", ".pnpm", ".yarn"]);
const NPM_LOCKFILE_NAMES = new Set(["package-lock.json", "npm-shrinkwrap.json"]);

function stableJsonValue(value) {
  if (Array.isArray(value)) return value.map((entry) => stableJsonValue(entry));
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => [key, stableJsonValue(entry)]));
}

function digestBytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function collectDependencyManifestFiles(root) {
  const files = [];
  const visit = (directory, relativeDirectory = "") => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.isDirectory() && IGNORED_DIRECTORY_NAMES.has(entry.name)) continue;
      const absolutePath = path.join(directory, entry.name);
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      if (entry.isDirectory()) { visit(absolutePath, relativePath); continue; }
      if (!DEPENDENCY_MANIFEST_NAMES.has(entry.name)) continue;
      if (entry.isSymbolicLink()) files.push({ path: relativePath, kind: "symlink", digest: digestBytes(Buffer.from(fs.readlinkSync(absolutePath))) });
      else if (entry.isFile()) files.push({ path: relativePath, kind: "file", digest: digestBytes(fs.readFileSync(absolutePath)) });
    }
  };
  visit(root);
  return files;
}

/** Compute a stable identity from the target revision, manifests, runtime, and effective commands. */
export function computeDependencySnapshot(options) {
  const payload = stableJsonValue({
    schema_version: 1,
    target: {
      repo_id: options.targetRepoId, ref: options.targetRepoRef, commit_sha: options.targetCommitSha,
      manifests: collectDependencyManifestFiles(options.targetCheckoutRoot),
    },
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    commands: {
      setup: Array.isArray(options.setupCommands) ? options.setupCommands : [],
      verification: Array.isArray(options.verificationCommands) ? options.verificationCommands : [],
    },
    dependency_resolution: resolveDependencyResolutionPolicy(options),
  });
  const digest = digestBytes(Buffer.from(JSON.stringify(payload)));
  return { algorithm: "sha256", hash: `sha256:${digest}`, digest, payload };
}

/** Materialize an auditable, content-addressed npm cache namespace. */
export function materializeDependencySnapshot(options) {
  const snapshot = computeDependencySnapshot(options);
  const cacheRoot = path.join(options.runtimeRoot, "dependency-cache", snapshot.digest.slice(0, 32), "npm");
  const markerFile = path.join(cacheRoot, ".aor-live-e2e-cache.json");
  const cacheReused = fs.existsSync(markerFile);
  fs.mkdirSync(cacheRoot, { recursive: true });
  writeJson(markerFile, { schema_version: 1, hash: snapshot.hash, target_commit_sha: options.targetCommitSha, updated_at: new Date().toISOString() });
  const report = {
    schema_version: 1, hash: snapshot.hash, algorithm: snapshot.algorithm, cache_root: cacheRoot,
    cache_reused: cacheReused, cache_policy: "stable-input-namespace-with-target-commit-resolution",
    target_repo_id: options.targetRepoId, target_repo_ref: options.targetRepoRef, target_commit_sha: options.targetCommitSha,
    target_commit_date: options.targetCommitDate, dependency_resolution: resolveDependencyResolutionPolicy(options),
    input: snapshot.payload,
  };
  const reportFile = path.join(options.reportsRoot, `live-e2e-dependency-snapshot-${normalizeId(options.runId)}.json`);
  writeJson(reportFile, report);
  return {
    ...snapshot, cacheRoot, cacheReused, report, reportFile,
    environment: {
      npm_config_cache: cacheRoot, AOR_LIVE_E2E_DEPENDENCY_SNAPSHOT_HASH: snapshot.hash,
      AOR_LIVE_E2E_DEPENDENCY_CACHE_ROOT: cacheRoot,
    },
  };
}

export function materializeAndAttachDependencySnapshot(options) {
  const snapshot = materializeDependencySnapshot({
    targetCheckoutRoot: options.targetCheckout.targetCheckoutRoot,
    targetRepoId: options.targetCheckout.targetRepoId, targetRepoRef: options.targetCheckout.targetRepoRef,
    targetCommitSha: options.targetCheckout.targetCommitSha, targetCommitDate: options.targetCheckout.targetCommitDate,
    setupCommands: options.setupCommands, verificationCommands: options.verificationCommands,
    runtimeRoot: options.runtimeRoot, reportsRoot: options.reportsRoot, runId: options.runId,
  });
  Object.assign(options.env, snapshot.environment);
  Object.assign(options.artifacts, {
    target_dependency_snapshot_hash: snapshot.hash, target_dependency_snapshot_file: snapshot.reportFile,
    target_dependency_cache_root: snapshot.cacheRoot, target_dependency_resolution: snapshot.report.dependency_resolution,
  });
  return snapshot;
}

/** Add target-date resolution only to unpinned npm installs; preserve lockfiles and explicit cutoffs. */
export function stabilizeDependencySetupCommand(command, options = {}) {
  const stabilized = command.replace(/\s+--prefer-offline\b/giu, " --prefer-online");
  const cutoff = resolveNpmDependencyCutoff(options.targetCommitDate);
  const root = options.targetCheckoutRoot;
  const eligible = Number(Boolean(cutoff)) * Number(typeof root === "string") * Number(!hasNpmLockfile(root)) * Number(!/\s--before(?:=|\s)/iu.test(stabilized));
  return [
    () => stabilized,
    () => stabilized.replace(/\bnpm\s+(?:install|i)\b/iu, (match) => `${match} --before=${cutoff}`),
  ][eligible]();
}

export function stabilizeDependencySetupCommands(commands, options = {}) {
  return commands.map((command) => stabilizeDependencySetupCommand(command, options));
}

export function resolveStabilizedSetupCommands(primary, fallback, options = {}) {
  const selected = Array.isArray(primary) && primary.length > 0 ? primary : fallback;
  return stabilizeDependencySetupCommands(Array.isArray(selected) ? selected : [], options);
}

export function resolveNpmDependencyCutoff(targetCommitDate) {
  const commitTime = Date.parse(targetCommitDate);
  return [
    () => null,
    () => new Date(commitTime + 24 * 60 * 60 * 1000).toISOString(),
  ][Number(Number.isFinite(commitTime))]();
}

function hasNpmLockfile(targetCheckoutRoot) {
  return Array.from(NPM_LOCKFILE_NAMES).some((name) => fs.existsSync(path.join(String(targetCheckoutRoot), name)));
}

function resolveDependencyResolutionPolicy(options) {
  const lockfilePresent = hasNpmLockfile(options.targetCheckoutRoot);
  const cutoff = resolveNpmDependencyCutoff(options.targetCommitDate);
  return {
    strategy: ["declared-command", "npm-before-target-commit", "lockfile", "lockfile"][Number(Boolean(cutoff)) + Number(lockfilePresent) * 2],
    target_commit_date: options.targetCommitDate,
    npm_cutoff: [cutoff, null][Number(lockfilePresent)],
    lockfile_present: lockfilePresent,
  };
}
