import fs from "node:fs";
import path from "node:path";

import { loadContractFile } from "../../contracts/src/index.mjs";

const DEFAULT_RUNTIME_ROOT = ".aor";
const DEFAULT_PROFILE_CANDIDATES = [
  "project.aor.yaml",
  "examples/project.aor.yaml",
  "examples/project.github.aor.yaml",
];

/**
 * @param {{ cwd?: string, projectRef?: string }} options
 * @returns {string}
 */
export function discoverProjectRoot(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const startRef = options.projectRef ? path.resolve(cwd, options.projectRef) : cwd;

  if (!fs.existsSync(startRef)) {
    throw new Error(`Invalid project reference '${options.projectRef ?? startRef}': path does not exist.`);
  }

  const startStats = fs.statSync(startRef);
  if (!startStats.isDirectory()) {
    throw new Error(`Invalid project reference '${options.projectRef ?? startRef}': expected a directory.`);
  }

  let current = startRef;
  while (true) {
    const gitDir = path.join(current, ".git");
    if (fs.existsSync(gitDir)) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  throw new Error(
    `Could not discover repository root from '${startRef}'. Ensure the target is inside a Git repository or pass --project-ref explicitly.`,
  );
}

/**
 * @param {{ cwd?: string, projectRoot: string, projectProfile?: string }} options
 * @returns {string}
 */
export function resolveProjectProfilePath(options) {
  const cwd = options.cwd ?? process.cwd();

  if (options.projectProfile) {
    const cwdCandidate = path.resolve(cwd, options.projectProfile);
    if (fs.existsSync(cwdCandidate)) {
      return cwdCandidate;
    }

    const projectCandidate = path.resolve(options.projectRoot, options.projectProfile);
    if (fs.existsSync(projectCandidate)) {
      return projectCandidate;
    }

    throw new Error(
      `Project profile '${options.projectProfile}' was not found from cwd '${cwd}' or project root '${options.projectRoot}'.`,
    );
  }

  for (const candidate of DEFAULT_PROFILE_CANDIDATES) {
    const resolved = path.resolve(options.projectRoot, candidate);
    if (fs.existsSync(resolved)) {
      return resolved;
    }
  }

  throw new Error(
    `Could not locate a project profile under '${options.projectRoot}'. Expected one of: ${DEFAULT_PROFILE_CANDIDATES.join(", ")}.`,
  );
}

/**
 * @param {{ projectProfilePath: string }} options
 * @returns {{ projectProfilePath: string, document: Record<string, unknown>, projectId: string, displayName: string, runtimeRootFromProfile: string }}
 */
export function loadProjectProfileForRuntime(options) {
  const loaded = loadContractFile({
    filePath: options.projectProfilePath,
    family: "project-profile",
  });

  if (!loaded.ok) {
    const issueSummary = loaded.validation.issues.map((issue) => issue.message).join("; ");
    throw new Error(
      `Project profile '${options.projectProfilePath}' failed validation: ${issueSummary || "unknown validation issue"}.`,
    );
  }

  const profileDocument = /** @type {Record<string, unknown>} */ (loaded.document);
  const projectId = profileDocument.project_id;
  const displayName = profileDocument.display_name;
  const runtimeDefaults = /** @type {Record<string, unknown>} */ (profileDocument.runtime_defaults ?? {});
  const runtimeRootFromProfile =
    typeof runtimeDefaults.runtime_root === "string" && runtimeDefaults.runtime_root.trim().length > 0
      ? runtimeDefaults.runtime_root
      : DEFAULT_RUNTIME_ROOT;

  if (typeof projectId !== "string" || projectId.trim().length === 0) {
    throw new Error(`Project profile '${options.projectProfilePath}' is missing a valid 'project_id'.`);
  }

  if (typeof displayName !== "string" || displayName.trim().length === 0) {
    throw new Error(`Project profile '${options.projectProfilePath}' is missing a valid 'display_name'.`);
  }

  return {
    projectProfilePath: options.projectProfilePath,
    document: profileDocument,
    projectId,
    displayName,
    runtimeRootFromProfile,
  };
}

/**
 * @param {{ projectRoot: string, runtimeRootOverride?: string, runtimeRootFromProfile: string }} options
 * @returns {string}
 */
export function resolveRuntimeRoot(options) {
  const selectedRuntimeRoot = options.runtimeRootOverride ?? options.runtimeRootFromProfile;

  return path.isAbsolute(selectedRuntimeRoot)
    ? selectedRuntimeRoot
    : path.resolve(options.projectRoot, selectedRuntimeRoot);
}

/**
 * @param {{ runtimeRoot: string, projectId: string }} options
 * @returns {{ runtimeRoot: string, projectsRoot: string, projectRuntimeRoot: string, artifactsRoot: string, reportsRoot: string, stateRoot: string }}
 */
export function ensureRuntimeLayout(options) {
  const projectsRoot = path.join(options.runtimeRoot, "projects");
  const projectRuntimeRoot = path.join(projectsRoot, options.projectId);
  const artifactsRoot = path.join(projectRuntimeRoot, "artifacts");
  const reportsRoot = path.join(projectRuntimeRoot, "reports");
  const stateRoot = path.join(projectRuntimeRoot, "state");

  for (const dirPath of [
    options.runtimeRoot,
    projectsRoot,
    projectRuntimeRoot,
    artifactsRoot,
    reportsRoot,
    stateRoot,
  ]) {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  return {
    runtimeRoot: options.runtimeRoot,
    projectsRoot,
    projectRuntimeRoot,
    artifactsRoot,
    reportsRoot,
    stateRoot,
  };
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef?: string,
 *   projectProfile?: string,
 *   runtimeRoot?: string,
 * }} options
 * @returns {{
 *   projectRoot: string,
 *   projectProfilePath: string,
 *   projectProfileRef: string,
 *   projectId: string,
 *   displayName: string,
 *   runtimeRoot: string,
 *   runtimeLayout: {
 *     runtimeRoot: string,
 *     projectsRoot: string,
 *     projectRuntimeRoot: string,
 *     artifactsRoot: string,
 *     reportsRoot: string,
 *     stateRoot: string,
 *   },
 *   stateFile: string,
 *   state: {
 *     schema_version: number,
 *     project_id: string,
 *     display_name: string,
 *     selected_profile_ref: string,
 *     project_root: string,
 *     runtime_root: string,
 *     runtime_layout: {
 *       project_runtime_root: string,
 *       artifacts_root: string,
 *       reports_root: string,
 *       state_root: string,
 *     },
 *   },
 * }}
 */
export function initializeProjectRuntime(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const projectRoot = discoverProjectRoot({ cwd, projectRef: options.projectRef });
  const projectProfilePath = resolveProjectProfilePath({
    cwd,
    projectRoot,
    projectProfile: options.projectProfile,
  });

  const loadedProfile = loadProjectProfileForRuntime({ projectProfilePath });
  const runtimeRoot = resolveRuntimeRoot({
    projectRoot,
    runtimeRootOverride: options.runtimeRoot,
    runtimeRootFromProfile: loadedProfile.runtimeRootFromProfile,
  });

  const runtimeLayout = ensureRuntimeLayout({
    runtimeRoot,
    projectId: loadedProfile.projectId,
  });

  const state = {
    schema_version: 1,
    project_id: loadedProfile.projectId,
    display_name: loadedProfile.displayName,
    selected_profile_ref: path.relative(projectRoot, projectProfilePath),
    project_root: projectRoot,
    runtime_root: runtimeRoot,
    runtime_layout: {
      project_runtime_root: runtimeLayout.projectRuntimeRoot,
      artifacts_root: runtimeLayout.artifactsRoot,
      reports_root: runtimeLayout.reportsRoot,
      state_root: runtimeLayout.stateRoot,
    },
  };

  const stateFile = path.join(runtimeLayout.stateRoot, "project-init-state.json");
  fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  return {
    projectRoot,
    projectProfilePath,
    projectProfileRef: state.selected_profile_ref,
    projectId: loadedProfile.projectId,
    displayName: loadedProfile.displayName,
    runtimeRoot,
    runtimeLayout,
    stateFile,
    state,
  };
}
