function object(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}

function clone(value) {
  return structuredClone(value);
}

/**
 * Return the additive W61 topology read model while keeping legacy profiles
 * byte-compatible on disk. Legacy source.root is interpreted as the stable
 * workspace mount when workspace_mount is absent.
 */
export function normalizeProjectTopology(document) {
  const normalized = clone(document);
  normalized.components = Array.isArray(normalized.components) ? normalized.components : [];
  normalized.component_graph = Array.isArray(normalized.component_graph) ? normalized.component_graph : [];
  normalized.repos = Array.isArray(normalized.repos)
    ? normalized.repos.map((repository) => {
        const next = clone(object(repository));
        const source = object(next.source);
        if (next.workspace_mount === undefined) {
          next.workspace_mount = typeof source.root === "string"
            ? source.root
            : `repos/${String(next.repo_id ?? "repository")}`;
        }
        return next;
      })
    : [];
  return normalized;
}

function record(value) {
  return isPlainObject(value) ? value : null;
}

function string(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isPortablePath(value) {
  return typeof value === "string"
    && value.length > 0
    && !path.isAbsolute(value)
    && !value.includes("\\")
    && !value.split("/").some((segment) => segment === ".." || segment === "");
}

function pushTopologyIssue(issues, source, field, message, actual = "invalid") {
  issues.push(issue({
    code: "path_scope_invalid",
    source,
    field,
    expected: "canonical, repository-relative topology value",
    actual,
    message,
  }));
}

export function validateProjectTopology(document, source, issues) {
  const repositories = Array.isArray(document.repos) ? document.repos : [];
  const repositoryIds = new Set();
  const mounts = new Set();
  for (const [index, raw] of repositories.entries()) {
    const repository = record(raw);
    if (!repository) continue;
    const repoId = string(repository.repo_id);
    if (!repoId) continue;
    if (repositoryIds.has(repoId)) pushTopologyIssue(issues, source, `repos.${index}.repo_id`, `Repository id '${repoId}' is duplicated.`, repoId);
    repositoryIds.add(repoId);
    const mount = repository.workspace_mount;
    if (!isPortablePath(mount)) pushTopologyIssue(issues, source, `repos.${index}.workspace_mount`, "Repository workspace mount must be a portable relative path.", String(mount));
    else if (mounts.has(mount)) pushTopologyIssue(issues, source, `repos.${index}.workspace_mount`, `Workspace mount '${mount}' is duplicated.`, mount);
    else mounts.add(mount);
  }

  const componentIds = new Set();
  for (const [index, raw] of document.components.entries()) {
    const component = record(raw);
    if (!component) {
      pushTopologyIssue(issues, source, `components.${index}`, "Component must be an object.");
      continue;
    }
    const componentId = string(component.component_id);
    const repoId = string(component.repo_id);
    if (!componentId || componentIds.has(componentId)) pushTopologyIssue(issues, source, `components.${index}.component_id`, "Component id must be present and unique.", String(componentId));
    else componentIds.add(componentId);
    if (!repoId || !repositoryIds.has(repoId)) pushTopologyIssue(issues, source, `components.${index}.repo_id`, `Component repository '${repoId ?? "missing"}' is not declared.`, String(repoId));
    if (!isPortablePath(component.root)) pushTopologyIssue(issues, source, `components.${index}.root`, "Component root must be a portable repository-relative path.", String(component.root));
  }

  for (const [index, raw] of document.component_graph.entries()) {
    const edge = record(raw);
    if (!edge) continue;
    for (const key of ["from_component_id", "to_component_id"]) {
      if (!componentIds.has(String(edge[key]))) pushTopologyIssue(issues, source, `component_graph.${index}.${key}`, `Component graph reference '${String(edge[key])}' is unknown.`, String(edge[key]));
    }
  }
}

export function validateProjectBinding(document, source) {
  const issues = [];
  const repositories = Array.isArray(document.repositories) ? document.repositories : [];
  const repoIds = new Set();
  for (const [index, raw] of repositories.entries()) {
    const repository = record(raw);
    if (!repository) continue;
    const repoId = string(repository.repo_id);
    if (!repoId || repoIds.has(repoId)) pushTopologyIssue(issues, source, `repositories.${index}.repo_id`, "Binding repository id must be present and unique.", String(repoId));
    else repoIds.add(repoId);
    if (repository.local_path !== undefined && !path.isAbsolute(String(repository.local_path))) pushTopologyIssue(issues, source, `repositories.${index}.local_path`, "Machine-local checkout path must be absolute.", String(repository.local_path));
    if (/(token|password|secret|private_key|credential_value)/u.test(JSON.stringify(repository).toLowerCase())) {
      issues.push(issue({ code: "unsupported_field_present", source, field: `repositories.${index}`, expected: "redacted readiness summary only", actual: "secret-bearing field", message: "Project bindings must not persist credential values." }));
    }
  }
  return issues;
}

export function validateWorkspaceSet(document, source) {
  const issues = [];
  const repositories = Array.isArray(document.repositories) ? document.repositories : [];
  const mounts = new Set();
  const writableIdentities = new Map();
  for (const [index, raw] of repositories.entries()) {
    const repository = record(raw);
    if (!repository) continue;
    const mount = repository.mount_path;
    if (!isPortablePath(mount) || mounts.has(mount)) pushTopologyIssue(issues, source, `repositories.${index}.mount_path`, "Workspace-set mount paths must be unique portable relative paths.", String(mount));
    mounts.add(mount);
    const identity = string(repository.resolved_identity);
    if (identity && string(repository.access_mode) !== "read-only") {
      const scope = JSON.stringify(repository.write_scope ?? []);
      if (writableIdentities.get(identity) === scope) pushTopologyIssue(issues, source, `repositories.${index}.write_scope`, `Shared repository '${identity}' has an unsafe overlapping write scope.`, scope);
      writableIdentities.set(identity, scope);
    }
  }
  return issues;
}
import path from "node:path";

import { isPlainObject, issue } from "./utils.mjs";
