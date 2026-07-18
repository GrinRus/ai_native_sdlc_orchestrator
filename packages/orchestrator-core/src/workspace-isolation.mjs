import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { validatePublicId } from "../../contracts/src/index.mjs";

const SUPPORTED_WORKSPACE_MODES = new Set(["ephemeral", "workspace-clone", "worktree"]);
const SUPPORTED_CLEANUP_ACTIONS = new Set(["delete", "retain", "none"]);

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeWorkspaceMode(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : "ephemeral";
}

export function isSupportedWorkspaceMode(value) {
  return SUPPORTED_WORKSPACE_MODES.has(value);
}

function defaultCleanupPolicy() {
  return { on_success: "delete", on_abort: "delete", on_failure: "retain" };
}

function resolveCleanupPolicy(runtimeDefaults) {
  const defaults = defaultCleanupPolicy();
  const configured = runtimeDefaults.workspace_cleanup;
  if (!isPlainObject(configured)) return defaults;
  function action(value, fallback) {
    return typeof value === "string" && SUPPORTED_CLEANUP_ACTIONS.has(value) ? value : fallback;
  }
  return {
    on_success: action(configured.on_success, defaults.on_success),
    on_abort: action(configured.on_abort, defaults.on_abort),
    on_failure: action(configured.on_failure, defaults.on_failure),
  };
}

function isPathInsideRoot(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

function canonicalDirectory(candidate, label) {
  const stat = fs.lstatSync(candidate);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a real directory, not a symlink or junction.`);
  }
  return fs.realpathSync.native(candidate);
}

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

export function inspectGitCheckout(root) {
  const canonicalRoot = canonicalDirectory(root, "Checkout root");
  if (gitValue(canonicalRoot, ["rev-parse", "--is-inside-work-tree"]) !== "true") return null;
  const topLevel = gitValue(canonicalRoot, ["rev-parse", "--show-toplevel"]);
  const gitDirValue = gitValue(canonicalRoot, ["rev-parse", "--absolute-git-dir"]);
  const commonDirValue = gitValue(canonicalRoot, ["rev-parse", "--git-common-dir"]);
  if (!topLevel || !gitDirValue || !commonDirValue) return null;
  const gitDir = fs.realpathSync.native(path.resolve(canonicalRoot, gitDirValue));
  const commonDirCandidate = path.isAbsolute(commonDirValue)
    ? commonDirValue
    : path.resolve(canonicalRoot, commonDirValue);
  const commonDir = fs.realpathSync.native(commonDirCandidate);
  return {
    root: fs.realpathSync.native(topLevel),
    git_dir: gitDir,
    common_dir: commonDir,
    head: gitValue(canonicalRoot, ["rev-parse", "--verify", "HEAD"]),
    symbolic_head: gitValue(canonicalRoot, ["symbolic-ref", "-q", "HEAD"]),
  };
}

function digestFile(filePath) {
  const hash = crypto.createHash("sha256");
  if (!fs.existsSync(filePath)) return null;
  const stat = fs.lstatSync(filePath);
  hash.update(stat.isSymbolicLink() ? `link:${fs.readlinkSync(filePath)}` : fs.readFileSync(filePath));
  return hash.digest("hex");
}

function digestCheckoutFiles(root, gitArgs) {
  const result = runGit(root, gitArgs, true);
  if (result.status !== 0) return null;
  const files = result.stdout.split("\0").filter(Boolean).sort();
  const hash = crypto.createHash("sha256");
  for (const relativePath of files) {
    hash.update(relativePath);
    hash.update("\0");
    const filePath = path.join(root, relativePath);
    const stat = fs.lstatSync(filePath);
    hash.update(stat.isSymbolicLink() ? `link:${fs.readlinkSync(filePath)}` : fs.readFileSync(filePath));
    hash.update("\0");
  }
  return { count: files.length, digest: hash.digest("hex") };
}

function digestNonGitTree(root) {
  const hash = crypto.createHash("sha256");
  let count = 0;
  function visit(directory, prefix = "") {
    for (const entry of fs.readdirSync(directory).sort()) {
      if (!prefix && (entry === ".aor" || entry === ".git")) continue;
      const relativePath = prefix ? `${prefix}/${entry}` : entry;
      const filePath = path.join(directory, entry);
      const stat = fs.lstatSync(filePath);
      hash.update(relativePath);
      hash.update("\0");
      if (stat.isSymbolicLink()) hash.update(`link:${fs.readlinkSync(filePath)}`);
      else if (stat.isDirectory()) visit(filePath, relativePath);
      else if (stat.isFile()) {
        hash.update(fs.readFileSync(filePath));
        count += 1;
      }
      hash.update("\0");
    }
  }
  visit(root);
  return { count, digest: hash.digest("hex") };
}

export function captureCheckoutSnapshot(root) {
  if (!fs.existsSync(root)) {
    return { root: path.resolve(root), git_available: false, missing: true };
  }
  const git = inspectGitCheckout(root);
  if (!git) {
    const canonicalRoot = canonicalDirectory(root, "Checkout root");
    return { root: canonicalRoot, git_available: false, filesystem: digestNonGitTree(canonicalRoot) };
  }
  const indexPathValue = gitValue(git.root, ["rev-parse", "--git-path", "index"]);
  const indexPath = indexPathValue
    ? path.isAbsolute(indexPathValue)
      ? indexPathValue
      : path.resolve(git.root, indexPathValue)
    : null;
  const projectPathspec = ["--", ".", ":(exclude).aor/**"];
  const status = runGit(
    git.root,
    ["status", "--porcelain=v1", "-z", "--untracked-files=all", ...projectPathspec],
    true,
  ).stdout ?? "";
  return {
    root: git.root,
    git_available: true,
    head: git.head,
    symbolic_head: git.symbolic_head,
    git_dir: git.git_dir,
    common_dir: git.common_dir,
    index_digest: indexPath ? digestFile(indexPath) : null,
    status_digest: crypto.createHash("sha256").update(status).digest("hex"),
    tracked: digestCheckoutFiles(git.root, ["ls-files", "-z", "--cached", ...projectPathspec]),
    untracked: digestCheckoutFiles(git.root, ["ls-files", "-z", "--others", "--exclude-standard", ...projectPathspec]),
  };
}

export function compareCheckoutSnapshots(before, after) {
  const fields = ["root", "git_available", "missing", "head", "symbolic_head", "git_dir", "common_dir", "index_digest", "status_digest", "tracked", "untracked", "filesystem"];
  const changed_fields = fields.filter((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]));
  return { unchanged: changed_fields.length === 0, changed_fields };
}

function isPythonVirtualEnvironmentRoot(candidate) {
  try {
    if (!fs.lstatSync(candidate).isDirectory()) return false;
  } catch {
    return false;
  }
  return fs.existsSync(path.join(candidate, "pyvenv.cfg")) &&
    (fs.existsSync(path.join(candidate, "bin", "python")) || fs.existsSync(path.join(candidate, "Scripts", "python.exe")));
}

function mirrorProjectTree(sourceRoot, targetRoot, runtimeRoot) {
  for (const entry of fs.readdirSync(targetRoot)) {
    if (entry !== ".git") fs.rmSync(path.join(targetRoot, entry), { recursive: true, force: true });
  }
  for (const entry of fs.readdirSync(sourceRoot)) {
    const sourceEntry = path.join(sourceRoot, entry);
    if (entry === ".git" || isPathInsideRoot(sourceEntry, runtimeRoot) || isPythonVirtualEnvironmentRoot(sourceEntry)) continue;
    fs.cpSync(sourceEntry, path.join(targetRoot, entry), {
      recursive: true,
      dereference: false,
      verbatimSymlinks: true,
      filter: (sourcePath) => !isPathInsideRoot(sourcePath, runtimeRoot) && !isPythonVirtualEnvironmentRoot(sourcePath),
    });
  }
}

function snapshotNonGitTree(sourceRoot, targetRoot, runtimeRoot) {
  fs.mkdirSync(targetRoot, { recursive: false });
  mirrorProjectTree(sourceRoot, targetRoot, runtimeRoot);
  runGit(targetRoot, ["init"]);
  return { strategy: "independent-snapshot", ref: "unborn", provisioning: "filesystem-snapshot-with-independent-git" };
}

function verifyIndependentGitDirs(sourceGit, executionRoot) {
  const executionGit = inspectGitCheckout(executionRoot);
  if (!executionGit || executionGit.git_dir === sourceGit?.git_dir || executionGit.root === sourceGit?.root) {
    throw new Error("Disposable workspace must use a distinct checkout root and Git directory.");
  }
  return executionGit;
}

function provisionGitWorkspace({ sourceRoot, executionRoot, requestedMode, sourceGit, runtimeRoot }) {
  if (!sourceGit?.head) return null;
  if (requestedMode !== "workspace-clone") {
    const worktree = runGit(sourceRoot, ["worktree", "add", "--detach", executionRoot, sourceGit.head], true);
    if (worktree.status === 0) {
      mirrorProjectTree(sourceRoot, executionRoot, runtimeRoot);
      return { strategy: "detached-worktree", ref: sourceGit.head, provisioning: "git-worktree" };
    }
    fs.rmSync(executionRoot, { recursive: true, force: true });
  }
  const clone = runGit(sourceRoot, ["clone", "--no-hardlinks", "--no-checkout", "--", sourceRoot, executionRoot], true);
  if (clone.status !== 0) {
    fs.rmSync(executionRoot, { recursive: true, force: true });
    return null;
  }
  runGit(executionRoot, ["checkout", "--detach", sourceGit.head]);
  mirrorProjectTree(sourceRoot, executionRoot, runtimeRoot);
  return { strategy: "independent-clone", ref: sourceGit.head, provisioning: "git-clone" };
}

function cleanupWorkspace({ executionRoot, sourceRoot, workspacesRoot, ownerMarker, strategy, action, outcome }) {
  if (action === "none" || action === "retain") {
    return { outcome, action, status: action === "retain" ? "retained" : "skipped", performed: false, exists_after: fs.existsSync(executionRoot), error: null };
  }
  try {
    const canonicalSource = fs.realpathSync.native(sourceRoot);
    const canonicalManagedRoot = fs.realpathSync.native(workspacesRoot);
    const lexicalExecution = path.resolve(executionRoot);
    if (lexicalExecution === canonicalSource || !isPathInsideRoot(lexicalExecution, canonicalManagedRoot)) {
      throw new Error("Refusing to delete a workspace outside the managed workspace root or equal to the primary checkout.");
    }
    const marker = JSON.parse(fs.readFileSync(ownerMarker, "utf8"));
    if (marker.execution_root !== lexicalExecution || marker.source_root !== canonicalSource) {
      throw new Error("Workspace owner marker does not match the cleanup target.");
    }
    if (fs.existsSync(executionRoot) && fs.lstatSync(executionRoot).isSymbolicLink()) {
      throw new Error("Refusing to follow a symlinked workspace during cleanup.");
    }
    if (strategy === "detached-worktree" && fs.existsSync(executionRoot)) {
      runGit(canonicalSource, ["worktree", "remove", "--force", executionRoot], true);
    }
    fs.rmSync(executionRoot, { recursive: true, force: true });
    fs.rmSync(ownerMarker, { force: true });
    return { outcome, action, status: "deleted", performed: true, exists_after: false, error: null };
  } catch (error) {
    return { outcome, action, status: "delete-failed", performed: false, exists_after: fs.existsSync(executionRoot), error: error instanceof Error ? error.message : String(error) };
  }
}

export function prepareWorkspaceIsolation(options) {
  const requestedMode = normalizeWorkspaceMode(options.runtimeDefaults.workspace_mode);
  const fallbackPolicy = defaultCleanupPolicy();
  if (!isSupportedWorkspaceMode(requestedMode)) {
    return {
      requestedMode,
      mode: "unsupported",
      sourceRoot: fs.realpathSync.native(options.projectRoot),
      executionRoot: null,
      checkout: { strategy: "none", ref: "none", source_git_dir: null, execution_git_dir: null },
      provisioning: "unsupported-mode",
      provisioned: false,
      cleanupPolicy: fallbackPolicy,
      cleanup: (outcome, action) => ({ outcome, action, status: "skipped", performed: false, exists_after: false, error: null }),
      finalize: (outcome) => ({ outcome, action: "none", status: "skipped", performed: false, exists_after: false, error: null }),
    };
  }
  const idValidation = validatePublicId(options.runId);
  if (!idValidation.ok) throw new Error(`Invalid run_id ${JSON.stringify(options.runId)} (${idValidation.value_class}). ${idValidation.migration}`);
  const sourceRoot = canonicalDirectory(options.projectRoot, "Primary checkout");
  const runtimeRootCandidate = path.isAbsolute(options.runtimeRoot)
    ? options.runtimeRoot
    : path.resolve(sourceRoot, options.runtimeRoot);
  const runtimeRoot = fs.existsSync(runtimeRootCandidate)
    ? fs.realpathSync.native(runtimeRootCandidate)
    : runtimeRootCandidate;
  const projectRuntimeRoot = canonicalDirectory(options.projectRuntimeRoot, "Project runtime root");
  const workspacesRoot = path.join(projectRuntimeRoot, "workspaces");
  fs.mkdirSync(workspacesRoot, { recursive: true });
  const canonicalWorkspacesRoot = canonicalDirectory(workspacesRoot, "Managed workspaces root");
  const workspaceId = `${requestedMode}-${options.runId}-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
  const executionRoot = path.join(canonicalWorkspacesRoot, workspaceId);
  const ownerMarker = path.join(canonicalWorkspacesRoot, `.${workspaceId}.owner.json`);
  const sourceGit = inspectGitCheckout(sourceRoot);
  let checkout = provisionGitWorkspace({ sourceRoot, executionRoot, requestedMode, sourceGit, runtimeRoot });
  if (!checkout) checkout = snapshotNonGitTree(sourceRoot, executionRoot, runtimeRoot);
  const canonicalExecutionRoot = canonicalDirectory(executionRoot, "Disposable execution root");
  if (canonicalExecutionRoot === sourceRoot || !isPathInsideRoot(canonicalExecutionRoot, canonicalWorkspacesRoot)) {
    throw new Error("Disposable execution root escaped the managed workspace boundary.");
  }
  const executionGit = sourceGit ? verifyIndependentGitDirs(sourceGit, canonicalExecutionRoot) : inspectGitCheckout(canonicalExecutionRoot);
  fs.writeFileSync(ownerMarker, `${JSON.stringify({ source_root: sourceRoot, execution_root: canonicalExecutionRoot, strategy: checkout.strategy, requested_mode: requestedMode }, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  const cleanupPolicy = resolveCleanupPolicy(options.runtimeDefaults);
  let finalized = null;
  const performCleanup = (outcome, action) => {
    if (finalized) return finalized;
    finalized = cleanupWorkspace({ executionRoot: canonicalExecutionRoot, sourceRoot, workspacesRoot: canonicalWorkspacesRoot, ownerMarker, strategy: checkout.strategy, action, outcome });
    return finalized;
  };
  return {
    requestedMode,
    mode: checkout.strategy === "detached-worktree" ? "worktree" : "workspace-clone",
    sourceRoot,
    executionRoot: canonicalExecutionRoot,
    checkout: { ...checkout, source_git_dir: sourceGit?.git_dir ?? null, execution_git_dir: executionGit?.git_dir ?? null },
    provisioning: checkout.provisioning,
    provisioned: true,
    cleanupPolicy,
    ownerMarker,
    cleanup: performCleanup,
    finalize: (outcome) => {
      const action = outcome === "success" ? cleanupPolicy.on_success : outcome === "abort" ? cleanupPolicy.on_abort : cleanupPolicy.on_failure;
      return performCleanup(outcome, action);
    },
  };
}

export function resumeWorkspaceIsolation(options) {
  const sourceRoot = canonicalDirectory(options.projectRoot, "Primary checkout");
  const projectRuntimeRoot = canonicalDirectory(options.projectRuntimeRoot, "Project runtime root");
  const workspacesRoot = canonicalDirectory(path.join(projectRuntimeRoot, "workspaces"), "Managed workspaces root");
  const executionRoot = canonicalDirectory(options.executionRoot, "Disposable execution root");
  if (executionRoot === sourceRoot || !isPathInsideRoot(executionRoot, workspacesRoot)) {
    throw new Error("Only an owned disposable workspace can be resumed.");
  }
  const workspaceId = path.basename(executionRoot);
  const ownerMarker = path.join(workspacesRoot, `.${workspaceId}.owner.json`);
  const marker = JSON.parse(fs.readFileSync(ownerMarker, "utf8"));
  if (marker.execution_root !== executionRoot || marker.source_root !== sourceRoot) {
    throw new Error("Disposable workspace owner marker does not match the requested source and execution roots.");
  }
  const sourceGit = inspectGitCheckout(sourceRoot);
  const executionGit = sourceGit ? verifyIndependentGitDirs(sourceGit, executionRoot) : inspectGitCheckout(executionRoot);
  const strategy = typeof marker.strategy === "string" ? marker.strategy : "independent-snapshot";
  const requestedMode = isSupportedWorkspaceMode(marker.requested_mode) ? marker.requested_mode : "ephemeral";
  const cleanupPolicy = resolveCleanupPolicy(options.runtimeDefaults);
  let finalized = null;
  const performCleanup = (outcome, action) => {
    if (finalized) return finalized;
    finalized = cleanupWorkspace({ executionRoot, sourceRoot, workspacesRoot, ownerMarker, strategy, action, outcome });
    return finalized;
  };
  return {
    requestedMode,
    mode: strategy === "detached-worktree" ? "worktree" : "workspace-clone",
    sourceRoot,
    executionRoot,
    checkout: {
      strategy,
      ref: executionGit?.head ?? "unborn",
      source_git_dir: sourceGit?.git_dir ?? null,
      execution_git_dir: executionGit?.git_dir ?? null,
    },
    provisioning: "resumed-owned-workspace",
    provisioned: true,
    cleanupPolicy,
    ownerMarker,
    cleanup: performCleanup,
    finalize: (outcome) => {
      const action = outcome === "success" ? cleanupPolicy.on_success : outcome === "abort" ? cleanupPolicy.on_abort : cleanupPolicy.on_failure;
      return performCleanup(outcome, action);
    },
  };
}
