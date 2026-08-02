import fs from "node:fs";
import path from "node:path";

import { validateContractDocument } from "../../contracts/src/index.mjs";

function record(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}

function records(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "object" && entry !== null) : [];
}

function strings(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string" && entry.trim()).map((entry) => entry.trim()) : [];
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function resolveExecutionUnitWorkspace(options) {
  if (!options.workspaceSetRef) {
    return { workspaceSet: null, workspaceSetFile: null, workspaceSetRef: null, repository: null, executionRoot: null };
  }
  const workspaceSetFile = options.resolveEvidencePath(options.projectRoot, options.workspaceSetRef);
  const workspaceSet = readJson(workspaceSetFile);
  const validation = validateContractDocument({ family: "workspace-set", document: workspaceSet, source: "runtime://run-workspace-set" });
  if (!validation.ok) {
    const error = new Error("Workspace set failed contract validation.");
    error.code = "workspace-set-invalid";
    error.validation = validation;
    throw error;
  }
  if (workspaceSet.status !== "ready" || workspaceSet.project_id !== options.projectId || (workspaceSet.conflicts ?? []).length > 0) {
    const error = new Error("Execution unit requires a ready, conflict-free workspace set owned by the same project.");
    error.code = "workspace-set-not-ready";
    throw error;
  }
  const repositoryScope = strings(options.unit.repository_scope ?? record(options.unit.scope).repo_ids);
  if (repositoryScope.length !== 1) {
    const error = new Error("A child execution unit must resolve to exactly one repository execution root.");
    error.code = "execution-unit-repository-scope-invalid";
    throw error;
  }
  const repository = records(workspaceSet.repositories).find((entry) => entry.repo_id === repositoryScope[0]) ?? null;
  if (!repository || typeof repository.execution_root !== "string") {
    const error = new Error(`Workspace set does not provide an execution root for repository '${repositoryScope[0]}'.`);
    error.code = "workspace-set-scope-mismatch";
    throw error;
  }
  const executionRoot = path.resolve(options.projectRoot, repository.execution_root);
  const workspaceRoot = path.resolve(options.projectRoot, workspaceSet.workspace_root);
  const relativeRoot = path.relative(workspaceRoot, executionRoot);
  if (!fs.existsSync(executionRoot) || relativeRoot === ".." || relativeRoot.startsWith(`..${path.sep}`) || path.isAbsolute(relativeRoot)) {
    const error = new Error("Workspace-set execution root is missing or outside its owned workspace root.");
    error.code = "workspace-set-execution-root-invalid";
    throw error;
  }
  const owner = readJson(path.resolve(options.projectRoot, workspaceSet.owner_marker));
  if (
    owner?.workspace_set_id !== workspaceSet.workspace_set_id
    || owner?.project_id !== workspaceSet.project_id
    || path.resolve(owner?.workspace_root ?? "") !== workspaceRoot
  ) {
    const error = new Error("Workspace-set owner marker does not match the execution root.");
    error.code = "workspace-set-owner-mismatch";
    throw error;
  }
  return {
    workspaceSet,
    workspaceSetFile,
    workspaceSetRef: options.evidenceRef(options.projectRoot, workspaceSetFile),
    repository,
    executionRoot,
  };
}
