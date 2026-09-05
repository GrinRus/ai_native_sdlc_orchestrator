import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

import { deriveManagedRepositoryId, deriveWorkspaceProjectId, normalizeRepositoryIdentity, sanitizeGitUrl } from "../aor-home.mjs";
import { initializeProjectRuntime } from "../project-init.mjs";
import { applyTopologyAction } from "./topology-management.mjs";
import { inspectRepositoryBinding } from "./topology-discovery.mjs";
import { discoverTopologyProposals } from "./topology-discovery.mjs";
import { removeCanonicalContainedPath } from "../shared/canonical-paths.mjs";

const jobs = new Map();

function now() {
  return new Date().toISOString();
}

function inspectGitRoot(root) {
  const absolute = fs.realpathSync.native(path.resolve(root));
  if (!fs.statSync(absolute).isDirectory()) throw new Error("Local project source must be a directory.");
  const inside = spawnSync("git", ["-C", absolute, "rev-parse", "--show-toplevel"], { encoding: "utf8", timeout: 5_000 });
  if (inside.status !== 0) throw new Error("Local project source must be a Git repository.");
  return fs.realpathSync.native(inside.stdout.trim());
}

function writeJob(root, job) {
  const dir = path.join(root, "workspace", "connection-jobs");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const target = path.join(dir, `${job.job_id}.json`);
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(job, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, target);
}

function updateJob(root, job, patch) {
  Object.assign(job, patch, { updated_at: now() });
  jobs.set(job.job_id, structuredClone(job));
  writeJob(root, job);
}

function inspectPublishedClone(root, expectedUrl = null) {
  const projectRoot = inspectGitRoot(root);
  const remote = spawnSync("git", ["-C", projectRoot, "remote", "get-url", "origin"], { encoding: "utf8", timeout: 5_000 });
  const head = spawnSync("git", ["-C", projectRoot, "rev-parse", "--verify", "HEAD"], { encoding: "utf8", timeout: 5_000 });
  if (remote.status !== 0 || !remote.stdout.trim()) throw new Error("Managed Git checkout has no readable origin remote.");
  if (head.status !== 0 || !head.stdout.trim()) throw new Error("Managed Git checkout has no readable HEAD commit.");
  const resolvedExpected = expectedUrl
    ? spawnSync("git", ["ls-remote", "--get-url", expectedUrl], { encoding: "utf8", timeout: 5_000 })
    : null;
  const expectedIdentity = resolvedExpected?.status === 0 && resolvedExpected.stdout.trim()
    ? resolvedExpected.stdout.trim()
    : expectedUrl;
  if (expectedIdentity && normalizeRepositoryIdentity(remote.stdout) !== normalizeRepositoryIdentity(expectedIdentity)) {
    throw new Error("Managed Git checkout origin does not match the requested source URL.");
  }
  return { projectRoot, remote: remote.stdout.trim(), head: head.stdout.trim() };
}

function sourceSummary(projectRoot, repositoryId = null) {
  const proposals = discoverTopologyProposals({ projectRoot });
  return {
    repository_id: repositoryId ?? "main",
    stable_mount: "repos/main",
    topology: proposals.components.length > 1 ? "monorepo" : "single-repo",
    components: proposals.components,
    verification_suggestions: proposals.command_groups,
  };
}

function publicSource(source) {
  return source.kind === "git"
    ? { kind: "git", clone_source: source.clone_source, repository_id: source.repository_id }
    : source;
}

function cloneRepository(url, destination, temporary, onProgress = () => {}) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(temporary), { recursive: true, mode: 0o700 });
    fs.rmSync(temporary, { recursive: true, force: true });
    onProgress({ stage: "cloning", percent: 20, message: "Cloning repository with system Git." });
    const child = spawn("git", ["clone", "--progress", "--", url, temporary], {
      stdio: ["ignore", "ignore", "pipe"],
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    let errorText = "";
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) child.kill("SIGTERM");
    }, 10 * 60_000);
    timeout.unref?.();
    child.stderr.on("data", (chunk) => { errorText += String(chunk).slice(0, 8_192); });
    child.once("error", (error) => {
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code !== 0) {
        fs.rmSync(temporary, { recursive: true, force: true });
        reject(new Error(errorText.trim() || `git clone exited with ${code}`));
        return;
      }
      onProgress({ stage: "verifying", percent: 75, message: "Verifying origin remote and HEAD." });
      inspectPublishedClone(temporary, url);
      fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
      if (fs.existsSync(destination)) {
        fs.rmSync(temporary, { recursive: true, force: true });
      } else {
        fs.renameSync(temporary, destination);
      }
      onProgress({ stage: "publishing", percent: 90, message: "Publishing managed checkout atomically." });
      resolve(destination);
    });
  });
}

function cloneRepositorySync(url, destination, temporary) {
  fs.mkdirSync(path.dirname(temporary), { recursive: true, mode: 0o700 });
  fs.rmSync(temporary, { recursive: true, force: true });
  const result = spawnSync("git", ["clone", "--", url, temporary], { encoding: "utf8", timeout: 10 * 60_000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
  if (result.status !== 0) {
    fs.rmSync(temporary, { recursive: true, force: true });
    throw new Error(result.stderr?.trim() || `git clone exited with ${result.status}`);
  }
  inspectPublishedClone(temporary, url);
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  if (fs.existsSync(destination)) fs.rmSync(temporary, { recursive: true, force: true });
  else fs.renameSync(temporary, destination);
  return destination;
}

export function resolveProjectSourceSync({ storageRoot, source }) {
  if (source?.kind === "local") {
    const projectRoot = inspectGitRoot(source.path);
    return {
      projectRoot,
      persistedSource: { kind: "local", local_path: projectRoot },
      summary: sourceSummary(projectRoot),
    };
  }
  if (source?.kind === "git") {
    const url = sanitizeGitUrl(source.url);
    const repositoryId = deriveManagedRepositoryId(url);
    const destination = path.join(storageRoot, "repositories", repositoryId, "checkout");
    const temporary = path.join(storageRoot, "tmp", `${repositoryId}-${crypto.randomUUID()}`);
    const projectRoot = inspectPublishedClone(cloneRepositorySync(url, destination, temporary), url).projectRoot;
    return {
      projectRoot,
      persistedSource: { kind: "git", clone_source: url, local_path: projectRoot, repository_id: repositoryId },
      summary: sourceSummary(projectRoot, repositoryId),
    };
  }
  throw new Error("Project source kind must be 'local' or 'git'.");
}

export function connectProjectSourceSync({ registry, source, label }) {
  const { projectRoot, persistedSource, summary } = resolveProjectSourceSync({ storageRoot: registry.storageRoot, source });
  const context = registry.addProject({ projectRef: projectRoot, label, source: persistedSource });
  return { context, source: publicSource(persistedSource), source_summary: summary };
}

export function readProjectConnectionJob(aorHome, jobId) {
  if (!/^project-connection-[0-9a-f-]{36}$/u.test(String(jobId))) return null;
  const inMemory = jobs.get(jobId);
  if (inMemory) return structuredClone(inMemory);
  const file = path.join(aorHome, "workspace", "connection-jobs", `${jobId}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function disconnectProject({ registry, projectId }) {
  const context = registry.getContext(projectId);
  if (!context) throw new Error(`Project '${projectId}' was not found.`);
  registry.removeProject(projectId);
  return { project_id: projectId, disconnected: true, data_preserved: fs.existsSync(context.projectRuntimeRoot) };
}

export function deleteProjectData({ registry, projectId, confirmation }) {
  if (confirmation !== projectId) throw new Error(`Confirm deletion by supplying confirmation '${projectId}'.`);
  const context = registry.getContext(projectId);
  if (!context) throw new Error(`Project '${projectId}' was not found.`);
  const summary = registry.summarize().projects.find((project) => project.project_id === projectId);
  if ((summary?.active_flow_summary?.active_flow_count ?? 0) > 0) {
    const error = new Error("AOR project data cannot be deleted while a Flow is active.");
    error.code = "project_data.active_flow_conflict";
    throw error;
  }
  const input = registry.getProjectInput(projectId) ?? {};
  const repositoryId = input.source?.kind === "git" ? input.source.repository_id : null;
  const repositoryShared = repositoryId && registry.listContexts().some((candidate) => (
    candidate.projectId !== projectId && registry.getProjectInput(candidate.projectId)?.source?.repository_id === repositoryId
  ));
  registry.removeProject(projectId);
  const storageRoot = fs.realpathSync.native(registry.storageRoot);
  const runtimeRemoval = removeCanonicalContainedPath({ root: storageRoot, target: context.projectRuntimeRoot });
  if (!runtimeRemoval.ok) throw new Error(`Project runtime cleanup refused its owned root (${runtimeRemoval.reason}).`);
  if (repositoryId && !repositoryShared) {
    const repositoryRemoval = removeCanonicalContainedPath({ root: storageRoot, target: path.join(storageRoot, "repositories", repositoryId) });
    if (!repositoryRemoval.ok) throw new Error(`Managed repository cleanup refused its owned root (${repositoryRemoval.reason}).`);
  }
  return { project_id: projectId, disconnected: true, data_deleted: true, repository_preserved: !repositoryId || repositoryShared };
}

export function refreshProjectSource({ registry, projectId }) {
  const context = registry.getContext(projectId);
  if (!context) throw new Error(`Project '${projectId}' was not found.`);
  const root = inspectGitRoot(context.projectRoot);
  const input = registry.getProjectInput(projectId) ?? {};
  let fetch = { attempted: false, status: "not-managed" };
  if (input.source?.kind === "git") {
    const result = spawnSync("git", ["-C", root, "fetch", "--prune", "origin"], { encoding: "utf8", timeout: 10 * 60_000 });
    fetch = result.status === 0
      ? { attempted: true, status: "succeeded" }
      : { attempted: true, status: "failed", error: result.stderr?.trim() || `git fetch exited with ${result.status}` };
    if (fetch.status === "failed") {
      const error = new Error(`Managed source refresh failed: ${fetch.error}`);
      error.code = "project_source.refresh_failed";
      throw error;
    }
  }
  const head = spawnSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8", timeout: 5_000 });
  return { project_id: projectId, project_ref: root, head: head.status === 0 ? head.stdout.trim() : null, fetch, source_summary: sourceSummary(root, input.source?.repository_id ?? null), refreshed: true };
}

export function connectAdditionalRepository({ registry, projectId, source, label }) {
  const context = registry.getContext(projectId);
  if (!context) throw new Error(`Project '${projectId}' was not found.`);
  initializeProjectRuntime(context.runtimeOptions);
  const resolved = resolveProjectSourceSync({ storageRoot: registry.storageRoot, source });
  const repositoryId = resolved.persistedSource.repository_id
    ?? deriveWorkspaceProjectId({ projectRoot: resolved.projectRoot });
  const repoId = repositoryId === "main" ? `repo-${repositoryId}` : repositoryId;
  const mount = `repos/${repoId}`;
  const currentTopology = applyTopologyAction({
    registry,
    projectId,
    expectedRevision: registry.revision,
    action: "add",
    family: "repository",
    payload: {
      repo_id: repoId,
      name: label?.trim() || path.basename(resolved.projectRoot),
      source: { kind: "local", root: "." },
      workspace_mount: mount,
      role: "application",
    },
  });
  const inspection = inspectRepositoryBinding(resolved.projectRoot);
  const rebound = applyTopologyAction({
    registry,
    projectId,
    expectedRevision: registry.revision,
    action: "rebind",
    family: "binding",
    payload: {
      repo_id: repoId,
      local_path: resolved.projectRoot,
      base_ref: inspection.resolved_ref ?? null,
      source: resolved.persistedSource,
    },
  });
  return {
    project_id: projectId,
    repository_id: repoId,
    stable_mount: mount,
    source: publicSource(resolved.persistedSource),
    source_summary: { ...resolved.summary, repository_id: repoId, stable_mount: mount },
    topology: rebound.topology,
    validation: rebound.validation,
    revision_event: currentTopology.revision_event,
  };
}

export function createProjectConnectionJob({ registry, source, label }) {
  const aorHome = registry.storageRoot;
  const kind = source?.kind;
  if (kind !== "local" && kind !== "git") throw new Error("Project source kind must be 'local' or 'git'.");
  const job = {
    job_id: `project-connection-${crypto.randomUUID()}`,
    status: "queued",
    source: kind === "git" ? { kind, url: sanitizeGitUrl(source.url) } : { kind, path: path.resolve(String(source.path ?? "")) },
    project_id: null,
    error: null,
    progress: { stage: "queued", percent: 0, message: "Connection job is queued." },
    created_at: now(),
    updated_at: now(),
  };
  jobs.set(job.job_id, structuredClone(job));
  writeJob(aorHome, job);
  setImmediate(async () => {
    updateJob(aorHome, job, { status: "running", progress: { stage: "validating", percent: 5, message: "Validating project source." } });
    try {
      let projectRoot;
      let persistedSource;
      if (kind === "local") {
        projectRoot = inspectGitRoot(source.path);
        persistedSource = { kind: "local", local_path: projectRoot };
        updateJob(aorHome, job, { progress: { stage: "inspecting", percent: 70, message: "Inspecting repository topology and verification commands." } });
      } else {
        const url = sanitizeGitUrl(source.url);
        const repositoryId = deriveManagedRepositoryId(url);
        const destination = path.join(aorHome, "repositories", repositoryId, "checkout");
        const temporary = path.join(aorHome, "tmp", `${repositoryId}-${crypto.randomUUID()}`);
        projectRoot = await cloneRepository(url, destination, temporary, (progress) => updateJob(aorHome, job, { progress }));
        projectRoot = inspectPublishedClone(projectRoot, url).projectRoot;
        persistedSource = { kind: "git", clone_source: url, local_path: projectRoot, repository_id: repositoryId };
      }
      const context = registry.addProject({ projectRef: projectRoot, label, source: persistedSource });
      const summary = sourceSummary(projectRoot, persistedSource.repository_id ?? null);
      updateJob(aorHome, job, { status: "succeeded", project_id: context.projectId, source: publicSource(persistedSource), source_summary: summary, progress: { stage: "complete", percent: 100, message: "Project source connected." } });
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).replaceAll(aorHome, "<AOR_HOME>");
      updateJob(aorHome, job, { status: "failed", error: message, progress: { stage: "failed", percent: job.progress?.percent ?? 0, message: "Project connection failed. Fix the source or authentication and retry." } });
    }
  });
  return structuredClone(job);
}
