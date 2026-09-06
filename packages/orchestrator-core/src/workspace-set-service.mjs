import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { loadContractFile, validatePublicId } from "../../contracts/src/index.mjs";
import { resolveLogicalEvidenceRef, toLogicalEvidenceRef } from "./aor-home.mjs";
import {
  captureRepositoryGitEvidence,
  provisionWorkspaceSet,
} from "./workspace-set-provisioner.mjs";
import { initializeProjectRuntime, loadProjectProfileForRuntime, previewProjectRuntime } from "./project-init.mjs";
import { applyIntegrationToParent, integrateParentRun } from "./integration-service.mjs";

function string(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function validateId(value, label) {
  if (!validatePublicId(value).ok) throw new Error(`${label} '${value}' is not a valid public identifier.`);
}

function gitValue(root, args) {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8", timeout: 10_000 });
  return result.status === 0 ? result.stdout.trim() : null;
}

function repositoryBinding(bindings, repoId) {
  return bindings.find((candidate) => candidate && candidate.repo_id === repoId) ?? null;
}

function profileRepositories(profile, projectRoot, bindings) {
  const repositories = Array.isArray(profile.repos) ? profile.repos : [];
  if (repositories.length === 0) throw new Error("Project profile must declare at least one repository before workspace provisioning.");
  return repositories.map((raw) => {
    const repository = object(raw);
    const repoId = string(repository.repo_id ?? repository.repository_id ?? repository.id);
    if (!repoId) throw new Error("Every project profile repository must declare repo_id.");
    const source = object(repository.source);
    const binding = repositoryBinding(bindings, repoId);
    const sourceRoot = string(binding?.local_path)
      ?? (string(source.root) ? path.resolve(projectRoot, source.root) : path.resolve(projectRoot, String(repository.workspace_mount ?? `repos/${repoId}`)));
    const mountPath = string(repository.workspace_mount)
      ?? (string(source.root) ? source.root : `repos/${repoId}`);
    const baseRef = string(binding?.base_ref)
      ?? string(repository.base_ref)
      ?? string(repository.default_branch)
      ?? string(source.default_ref)
      ?? "HEAD";
    const resolvedIdentity = string(binding?.resolved_identity)
      ?? string(source.remote_url)
      ?? string(source.clone_source)
      ?? sourceRoot;
    const bindingRevision = Number.isInteger(binding?.revision) ? binding.revision : 1;
    return {
      repoId,
      mountPath,
      sourceRoot,
      baseRef,
      bindingRef: binding?.binding_id ? `binding://${binding.binding_id}#${repoId}` : undefined,
      resolvedIdentity,
      accessMode: string(repository.access_mode) ?? "read-only",
      writeScope: Array.isArray(repository.write_scope) ? repository.write_scope : [],
      dirtyPolicy: string(repository.dirty_policy) ?? "reject",
      strategy: string(repository.provisioning_strategy) ?? "detached-worktree",
      bindingRevision,
    };
  });
}

function resolveRepositoryCommits(repositories) {
  return repositories.map((repository) => {
    const sourceRoot = fs.realpathSync.native(repository.sourceRoot);
    if (gitValue(sourceRoot, ["rev-parse", "--is-inside-work-tree"]) !== "true") {
      throw new Error(`Repository '${repository.repoId}' is not an available Git checkout.`);
    }
    const status = gitValue(sourceRoot, ["status", "--porcelain=v1", "--untracked-files=all"]);
    if (repository.dirtyPolicy === "reject" && status) {
      throw new Error(`Repository '${repository.repoId}' is dirty and dirtyPolicy=reject.`);
    }
    const resolvedCommit = gitValue(sourceRoot, ["rev-parse", "--verify", `${repository.baseRef}^{commit}`]);
    if (!resolvedCommit) throw new Error(`Repository '${repository.repoId}' base ref '${repository.baseRef}' cannot be resolved.`);
    return { ...repository, sourceRoot, resolvedCommit };
  });
}

function dryRunManifest({ init, projectRoot, projectId, runId, workspaceSetId, bindingRef, repositories, cleanupPolicy }) {
  const resolved = resolveRepositoryCommits(repositories);
  return {
    schema_version: 2,
    workspace_set_id: workspaceSetId,
    workspace_set_ref: `evidence://projects/${init.workspaceProjectId}/reports/workspace-set.${runId}.json`,
    project_id: projectId,
    run_id: runId,
    binding_ref: bindingRef,
    status: "planned",
    workspace_root: path.join(init.runtimeLayout.projectRuntimeRoot, "workspace-sets", runId),
    owner_marker: path.join(init.runtimeLayout.projectRuntimeRoot, "workspace-sets", runId, ".aor-workspace-set-owner.json"),
    repositories: resolved.map((repository) => ({
      repo_id: repository.repoId,
      mount_path: repository.mountPath,
      binding_ref: repository.bindingRef ?? bindingRef,
      base_ref: repository.baseRef,
      resolved_commit: repository.resolvedCommit,
      resolved_identity: repository.resolvedIdentity,
      access_mode: repository.accessMode,
      write_scope: repository.writeScope,
      provisioning: { strategy: repository.strategy, state: "planned" },
      execution_root: path.join(init.runtimeLayout.projectRuntimeRoot, "workspace-sets", runId, repository.mountPath),
      git_evidence: { baseline: captureRepositoryGitEvidence(repository.sourceRoot), final: null },
    })),
    conflicts: [],
    cleanup: { policy: cleanupPolicy, state: "pending" },
    evidence_refs: [`evidence://projects/${init.workspaceProjectId}/reports/workspace-set.${runId}.json`],
    dry_run: true,
    project_root: projectRoot,
  };
}

/**
 * Resolve a project profile and local bindings into the low-level workspace
 * set provisioner. This is the shared public service used by CLI and HTTP.
 */
export function provisionProjectWorkspaceSet(options) {
  const runId = string(options.runId);
  if (!runId) throw new Error("Workspace provisioning requires runId.");
  validateId(runId, "run_id");

  const init = initializeProjectRuntime({
    cwd: options.cwd,
    projectRef: options.projectRef,
    projectProfile: options.projectProfile,
    runtimeRoot: options.runtimeRoot,
    command: options.command ?? "aor workspace provision",
  });
  const profile = loadProjectProfileForRuntime({ projectProfilePath: init.projectProfilePath });
  const projectId = string(options.projectId) ?? profile.projectId;
  validateId(projectId, "project_id");
  const bindings = Array.isArray(options.bindings) ? options.bindings : [];
  const candidates = profileRepositories(profile.document, init.projectRoot, bindings);
  const bindingRef = string(options.bindingRef)
    ?? (bindings.find((binding) => string(binding?.binding_id))
      ? `binding://${string(bindings.find((binding) => string(binding?.binding_id))?.binding_id)}@r${bindings.find((binding) => string(binding?.binding_id))?.revision ?? 1}`
      : `binding://project/${projectId}@r1`);
  const cleanupPolicy = object(options.cleanupPolicy);
  const policy = {
    on_success: string(cleanupPolicy.on_success) ?? "delete",
    on_abort: string(cleanupPolicy.on_abort) ?? "delete",
    on_failure: string(cleanupPolicy.on_failure) ?? "retain",
  };
  const workspaceSetId = string(options.workspaceSetId) ?? `workspace-set.${projectId}.${runId}`;
  validateId(workspaceSetId, "workspace_set_id");
  const existingFile = path.join(init.runtimeLayout.reportsRoot, `workspace-set.${runId}.json`);
  if (fs.existsSync(existingFile)) {
    const existing = loadContractFile({ filePath: existingFile, family: "workspace-set" });
    if (existing.ok && existing.document.project_id === projectId && existing.document.run_id === runId && existing.document.workspace_set_id === workspaceSetId && existing.document.status === "ready") {
      return { init, workspaceSet: existing.document, workspaceSetFile: existingFile, dryRun: false, idempotent: true };
    }
  }
  if (options.dryRun === true) {
    return {
      init,
      workspaceSet: dryRunManifest({ init, projectRoot: init.projectRoot, projectId, runId, workspaceSetId, bindingRef, repositories: candidates, cleanupPolicy: policy }),
      workspaceSetFile: path.join(init.runtimeLayout.reportsRoot, `workspace-set.${runId}.json`),
      dryRun: true,
      idempotent: false,
    };
  }
  const repositories = resolveRepositoryCommits(candidates);
  const workspaceSet = provisionWorkspaceSet({
    projectRuntimeRoot: init.runtimeLayout.projectRuntimeRoot,
    projectId,
    runId,
    workspaceSetId,
    bindingRef,
    deliveryCapable: options.deliveryCapable === true,
    cleanupPolicy: policy,
    repositories,
  });
  // The low-level provisioner is intentionally runtime-root agnostic and
  // emits a relative evidence URI. Public callers need the canonical central
  // AOR Home binding so the same ref is resolvable by CLI and HTTP transports.
  const canonicalRef = `evidence://projects/${init.workspaceProjectId}/reports/workspace-set.${runId}.json`;
  workspaceSet.workspace_set_ref = canonicalRef;
  workspaceSet.evidence_refs = [canonicalRef];
  fs.writeFileSync(path.join(init.runtimeLayout.reportsRoot, `workspace-set.${runId}.json`), `${JSON.stringify(workspaceSet, null, 2)}\n`, "utf8");
  return {
    init,
    workspaceSet,
    workspaceSetFile: path.join(init.runtimeLayout.reportsRoot, `workspace-set.${runId}.json`),
    dryRun: false,
    idempotent: false,
  };
}

export function readProjectWorkspaceSet(options) {
  const preview = previewProjectRuntime(options);
  const file = path.join(preview.runtimeLayout.reportsRoot, `workspace-set.${options.runId}.json`);
  if (!fs.existsSync(file)) return { file, workspaceSet: null };
  const loaded = loadContractFile({ filePath: file, family: "workspace-set" });
  if (!loaded.ok) throw new Error(loaded.validation.issues.map((issue) => issue.message).join("; "));
  return { file, workspaceSet: loaded.document };
}

function resolveOwnedRef(init, reference) {
  const value = string(reference);
  if (!value) throw new Error("Integration requires an execution-plan or workspace-set reference.");
  const resolved = resolveLogicalEvidenceRef({
    projectRoot: init.projectRoot,
    projectRuntimeRoot: init.runtimeLayout.projectRuntimeRoot,
    workspaceProjectId: init.workspaceProjectId,
    reference: value,
  });
  if (!fs.existsSync(resolved)) throw new Error(`Referenced integration artifact '${value}' was not found.`);
  return resolved;
}

function readChildOutputs(init, references) {
  return references.flatMap((reference) => {
    const file = resolveOwnedRef(init, reference);
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(parsed) ? parsed : [parsed];
  });
}

/**
 * Materialize authoritative integration from public child-output evidence and
 * apply it to the parent run under the caller's CAS revision.
 */
export function materializeParentIntegration(options) {
  const parentRunId = string(options.parentRunId);
  validateId(parentRunId, "parent_run_id");
  const init = initializeProjectRuntime({
    cwd: options.cwd,
    projectRef: options.projectRef,
    projectProfile: options.projectProfile,
    runtimeRoot: options.runtimeRoot,
    command: options.command ?? "aor run integration --action materialize",
  });
  const parentPath = path.join(init.runtimeLayout.stateRoot, "parent-runs", `parent-run-${parentRunId}.json`);
  if (!fs.existsSync(parentPath)) throw new Error(`Parent run '${parentRunId}' was not found.`);
  const parent = JSON.parse(fs.readFileSync(parentPath, "utf8"));
  if (parent.project_id !== init.projectId) throw new Error("Parent run does not belong to the selected project.");
  const executionPlanRef = string(options.executionPlanRef) ?? string(parent.execution_plan_ref);
  const workspaceSetRef = string(options.workspaceSetRef) ?? string(parent.workspace_set_ref);
  const planFile = resolveOwnedRef(init, executionPlanRef);
  const workspaceSetFile = resolveOwnedRef(init, workspaceSetRef);
  const plan = loadContractFile({ filePath: planFile, family: "execution-plan" });
  const workspaceSet = loadContractFile({ filePath: workspaceSetFile, family: "workspace-set" });
  if (!plan.ok) throw new Error(plan.validation.issues.map((issue) => issue.message).join("; "));
  if (!workspaceSet.ok) throw new Error(workspaceSet.validation.issues.map((issue) => issue.message).join("; "));
  if (workspaceSet.document.project_id !== init.projectId || workspaceSet.document.run_id !== parentRunId) {
    throw new Error("Workspace set does not belong to the selected project and parent run.");
  }
  if (parent.integration_report_ref && (!Array.isArray(options.childOutputRefs) || options.childOutputRefs.length === 0)) {
    const existingFile = resolveOwnedRef(init, parent.integration_report_ref);
    const existing = loadContractFile({ filePath: existingFile, family: "integration-report" });
    if (existing.ok) return { init, parent, parentFile: parentPath, report: existing.document, reportFile: existingFile, idempotent: true };
  }
  const childOutputRefs = Array.isArray(options.childOutputRefs) ? options.childOutputRefs : [];
  const childOutputs = readChildOutputs(init, childOutputRefs);
  const integration = integrateParentRun({
    projectRoot: init.projectRoot,
    projectId: init.projectId,
    parentRunId,
    executionPlanRef,
    workspaceSetRef,
    workspaceSet: workspaceSet.document,
    parent,
    runtimeLayout: init.runtimeLayout,
    childOutputs,
    aggregateGates: Array.isArray(plan.document.integration_gates) ? plan.document.integration_gates : [],
  });
  const reportRef = toLogicalEvidenceRef({ projectRoot: init.projectRoot, filePath: integration.reportFile, workspaceProjectId: init.workspaceProjectId });
  const appliedParent = applyIntegrationToParent({
    parentFile: parentPath,
    expectedRevision: options.expectedRevision,
    reportFile: integration.reportFile,
    integrationReportRef: reportRef,
  });
  return {
    init,
    parent: appliedParent,
    parentFile: parentPath,
    report: integration.report,
    reportFile: integration.reportFile,
    reportRef,
    authorityFile: integration.authorityFile,
    idempotent: false,
  };
}

export function workspaceSetDigest(workspaceSet) {
  return crypto.createHash("sha256").update(JSON.stringify(workspaceSet)).digest("hex");
}
