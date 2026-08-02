import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { validatePublicId } from "../../contracts/src/index.mjs";

const OWNER_FILE = ".aor-workspace-set-owner.json";
const SCRATCH_ROOTS = new Set([".aor", ".codex", ".claude", ".qwen", ".opencode"]);

function runGit(cwd, args, allowFailure = false) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`Git command failed in '${cwd}': git ${args.join(" ")} (${(result.stderr || result.stdout || "unknown error").trim()})`);
  }
  return result;
}

function gitValue(cwd, args) {
  const result = runGit(cwd, args, true);
  return result.status === 0 ? result.stdout.trim() : null;
}

function inside(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

function portableMount(value) {
  return typeof value === "string" && value.length > 0 && !path.isAbsolute(value) && !value.includes("\\")
    && !value.split("/").some((segment) => segment === "" || segment === "." || segment === "..");
}

function validateId(value, label) {
  const result = validatePublicId(value);
  if (!result.ok) throw new Error(`${label} is invalid (${result.value_class}). ${result.migration}`);
}

function atomicJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  fs.renameSync(temporary, filePath);
}

function parseStatus(buffer) {
  const tokens = buffer.split("\0");
  const entries = [];
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const token = tokens[index];
    if (!token) continue;
    const status = token.slice(0, 2);
    const firstPath = token.slice(3);
    const entry = { status, path: firstPath };
    if (status.includes("R") || status.includes("C")) entry.original_path = tokens[++index];
    entries.push(entry);
  }
  return entries;
}

export function captureRepositoryGitEvidence(repositoryRoot) {
  const head = gitValue(repositoryRoot, ["rev-parse", "--verify", "HEAD"]);
  if (!head) throw new Error(`Repository '${repositoryRoot}' has no resolvable HEAD.`);
  const status = runGit(repositoryRoot, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignored=matching"], true);
  if (status.status !== 0) throw new Error(`Cannot inspect Git status for '${repositoryRoot}'.`);
  const statusEntries = parseStatus(status.stdout);
  const changed = new Set();
  const untracked = new Set();
  const ignoredScratch = new Set();
  for (const entry of statusEntries) {
    const paths = [entry.original_path, entry.path].filter(Boolean);
    if (entry.status === "!!") {
      for (const relativePath of paths) {
        if (SCRATCH_ROOTS.has(relativePath.split("/")[0])) ignoredScratch.add(relativePath);
      }
      continue;
    }
    for (const relativePath of paths) changed.add(relativePath);
    if (entry.status === "??") for (const relativePath of paths) untracked.add(relativePath);
  }
  return {
    head,
    status_entries: statusEntries,
    changed_paths: [...changed].sort(),
    untracked_paths: [...untracked].sort(),
    ignored_scratch_paths: [...ignoredScratch].sort(),
  };
}

function validateRepositories(repositories, deliveryCapable) {
  if (!Array.isArray(repositories) || repositories.length === 0) throw new Error("Workspace set requires at least one repository.");
  const repoIds = new Set();
  const mounts = new Set();
  const writableScopes = new Map();
  return repositories.map((repository) => {
    validateId(repository.repoId, "repo_id");
    if (repoIds.has(repository.repoId)) throw new Error(`Duplicate repository id '${repository.repoId}'.`);
    repoIds.add(repository.repoId);
    if (!portableMount(repository.mountPath) || mounts.has(repository.mountPath)) throw new Error(`Mount '${repository.mountPath}' must be unique and portable.`);
    mounts.add(repository.mountPath);
    const sourceRoot = fs.realpathSync.native(repository.sourceRoot);
    if (gitValue(sourceRoot, ["rev-parse", "--is-inside-work-tree"]) !== "true") throw new Error(`Repository '${repository.repoId}' is not an available Git checkout.`);
    const dirty = parseStatus(runGit(sourceRoot, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]).stdout);
    if ((repository.dirtyPolicy ?? "reject") === "reject" && dirty.length > 0) throw new Error(`Repository '${repository.repoId}' is dirty and dirtyPolicy=reject.`);
    const baseRef = repository.baseRef ?? "HEAD";
    const resolvedCommit = gitValue(sourceRoot, ["rev-parse", "--verify", `${baseRef}^{commit}`]);
    if (!resolvedCommit) throw new Error(`Repository '${repository.repoId}' base ref '${baseRef}' cannot be resolved.`);
    const accessMode = repository.accessMode ?? "read-only";
    if (deliveryCapable && accessMode === "primary-checkout") throw new Error(`Delivery-capable repository '${repository.repoId}' cannot use the primary checkout.`);
    const identity = repository.resolvedIdentity ?? sourceRoot;
    if (accessMode !== "read-only") {
      const scope = JSON.stringify([...(repository.writeScope ?? [])].sort());
      const existing = writableScopes.get(identity);
      if (existing?.has(scope)) throw new Error(`Shared repository '${identity}' has an overlapping write scope.`);
      const scopes = existing ?? new Set();
      scopes.add(scope);
      writableScopes.set(identity, scopes);
    }
    return { ...repository, sourceRoot, baseRef, resolvedCommit, accessMode, identity };
  });
}

function provisionRepository(repository, executionRoot) {
  fs.mkdirSync(path.dirname(executionRoot), { recursive: true });
  const preferred = repository.strategy ?? "detached-worktree";
  if (preferred === "detached-worktree") {
    const result = runGit(repository.sourceRoot, ["worktree", "add", "--detach", executionRoot, repository.resolvedCommit], true);
    if (result.status === 0) return "detached-worktree";
    fs.rmSync(executionRoot, { recursive: true, force: true });
  }
  const clone = runGit(repository.sourceRoot, ["clone", "--no-hardlinks", "--no-checkout", "--", repository.sourceRoot, executionRoot], true);
  if (clone.status !== 0) throw new Error(`Failed to provision repository '${repository.repoId}' by worktree or clone.`);
  runGit(executionRoot, ["checkout", "--detach", repository.resolvedCommit]);
  return "independent-clone";
}

function removeRepository(repository) {
  if (!fs.existsSync(repository.execution_root)) return;
  if (repository.provisioning.strategy === "detached-worktree") {
    runGit(repository.source_root, ["worktree", "remove", "--force", repository.execution_root], true);
  }
  fs.rmSync(repository.execution_root, { recursive: true, force: true });
}

export function provisionWorkspaceSet(options) {
  validateId(options.workspaceSetId, "workspace_set_id");
  validateId(options.projectId, "project_id");
  validateId(options.runId, "run_id");
  const repositories = validateRepositories(options.repositories, options.deliveryCapable === true);
  const projectRuntimeRoot = fs.realpathSync.native(options.projectRuntimeRoot);
  const setsRoot = path.join(projectRuntimeRoot, "workspace-sets");
  fs.mkdirSync(setsRoot, { recursive: true });
  const workspaceRoot = path.join(setsRoot, options.runId);
  const ownerMarker = path.join(workspaceRoot, OWNER_FILE);
  const reportPath = options.reportPath ?? path.join(projectRuntimeRoot, "reports", `workspace-set.${options.runId}.json`);
  if (fs.existsSync(workspaceRoot)) throw new Error(`Workspace set root already exists for run '${options.runId}'.`);
  fs.mkdirSync(workspaceRoot, { recursive: false });
  fs.writeFileSync(ownerMarker, `${JSON.stringify({ workspace_set_id: options.workspaceSetId, project_id: options.projectId, run_id: options.runId, workspace_root: workspaceRoot }, null, 2)}\n`, { flag: "wx" });
  const provisioned = [];
  try {
    for (const [index, repository] of repositories.entries()) {
      if (options.failAfterRepository === index) throw new Error(`Injected provisioning failure before repository '${repository.repoId}'.`);
      const executionRoot = path.join(workspaceRoot, repository.mountPath);
      const strategy = provisionRepository(repository, executionRoot);
      const actualCommit = gitValue(executionRoot, ["rev-parse", "--verify", "HEAD"]);
      if (actualCommit !== repository.resolvedCommit) throw new Error(`Repository '${repository.repoId}' checkout commit drifted during provisioning.`);
      provisioned.push({
        repo_id: repository.repoId,
        mount_path: repository.mountPath,
        binding_ref: repository.bindingRef ?? options.bindingRef,
        base_ref: repository.baseRef,
        resolved_commit: repository.resolvedCommit,
        resolved_identity: repository.identity,
        access_mode: repository.accessMode,
        write_scope: repository.writeScope ?? [],
        source_root: repository.sourceRoot,
        execution_root: executionRoot,
        provisioning: { strategy, state: "ready" },
        git_evidence: { baseline: captureRepositoryGitEvidence(executionRoot), final: null },
      });
    }
    const relativeReport = path.relative(projectRuntimeRoot, reportPath).split(path.sep).join("/");
    const manifest = {
      schema_version: 2,
      workspace_set_id: options.workspaceSetId,
      workspace_set_ref: `evidence://${relativeReport}`,
      project_id: options.projectId,
      run_id: options.runId,
      binding_ref: options.bindingRef,
      status: "ready",
      workspace_root: workspaceRoot,
      owner_marker: ownerMarker,
      repositories: provisioned,
      conflicts: [],
      cleanup: {
        policy: options.cleanupPolicy ?? { on_success: "delete", on_abort: "delete", on_failure: "retain" },
        state: "pending",
      },
      evidence_refs: [`evidence://${relativeReport}`],
    };
    atomicJson(reportPath, manifest);
    return manifest;
  } catch (error) {
    for (const repository of [...provisioned].reverse()) removeRepository(repository);
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
    const relativeReport = path.relative(projectRuntimeRoot, reportPath).split(path.sep).join("/");
    const failure = {
      schema_version: 2,
      workspace_set_id: options.workspaceSetId,
      project_id: options.projectId,
      run_id: options.runId,
      binding_ref: options.bindingRef,
      status: "failed",
      workspace_root: workspaceRoot,
      owner_marker: ownerMarker,
      repositories: provisioned.map((repository) => ({ ...repository, provisioning: { ...repository.provisioning, state: "cleaned" } })),
      conflicts: [{ code: "workspace-provisioning-failed", detail: error instanceof Error ? error.message : String(error) }],
      cleanup: { policy: options.cleanupPolicy ?? { on_success: "delete", on_abort: "delete", on_failure: "retain" }, state: "deleted" },
      evidence_refs: [`evidence://${relativeReport}`],
    };
    atomicJson(reportPath, failure);
    const wrapped = new Error(failure.conflicts[0].detail);
    wrapped.workspaceSetFailure = failure;
    throw wrapped;
  }
}

export function finalizeWorkspaceSet(manifest, outcome) {
  const action = outcome === "success"
    ? manifest.cleanup.policy.on_success
    : outcome === "abort"
      ? manifest.cleanup.policy.on_abort
      : manifest.cleanup.policy.on_failure;
  if (["deleted", "retained"].includes(manifest.cleanup.state)) return manifest;
  if (action === "retain" || action === "none") {
    manifest.cleanup.state = "retained";
    return manifest;
  }
  const marker = JSON.parse(fs.readFileSync(manifest.owner_marker, "utf8"));
  if (marker.workspace_set_id !== manifest.workspace_set_id || marker.workspace_root !== manifest.workspace_root || !inside(manifest.workspace_root, path.dirname(manifest.workspace_root))) {
    throw new Error("Workspace-set owner marker does not match cleanup target.");
  }
  for (const repository of [...manifest.repositories].reverse()) removeRepository(repository);
  fs.rmSync(manifest.workspace_root, { recursive: true, force: true });
  manifest.cleanup.state = "deleted";
  return manifest;
}

export function collectWorkspaceSetChanges(manifest) {
  for (const repository of manifest.repositories) {
    repository.git_evidence.final = captureRepositoryGitEvidence(repository.execution_root);
  }
  return manifest;
}

export function projectWorkspaceSetProvenance(manifest) {
  return {
    workspace_set_ref: manifest.workspace_set_ref,
    workspace_root: manifest.workspace_root,
    repository_map: Object.fromEntries(manifest.repositories.map((repository) => [repository.repo_id, {
      mount_path: repository.mount_path,
      execution_root: repository.execution_root,
      base_commit: repository.resolved_commit,
      access_mode: repository.access_mode,
    }])),
    cleanup_state: manifest.cleanup.state,
  };
}
