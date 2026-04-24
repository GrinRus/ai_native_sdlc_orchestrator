import fs from "node:fs";
import path from "node:path";
import { stringify as stringifyYaml } from "../../contracts/node_modules/yaml/dist/index.js";

import { loadContractFile } from "../../contracts/src/index.mjs";
import { materializeBootstrapArtifactPacket } from "./artifact-store.mjs";

const DEFAULT_RUNTIME_ROOT = ".aor";
const DEFAULT_BOOTSTRAP_TEMPLATE_ID = "github-default";
const DEFAULT_PROFILE_CANDIDATES = [
  "project.aor.yaml",
  "examples/project.aor.yaml",
  "examples/project.github.aor.yaml",
];

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeId(value) {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

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
 * @returns {string}
 */
function resolveBundledExamplesRoot() {
  const override = process.env.AOR_BOOTSTRAP_ASSETS_ROOT ?? process.env.AOR_EXAMPLES_ROOT;
  if (typeof override === "string" && override.trim().length > 0) {
    return path.isAbsolute(override) ? override : path.resolve(process.cwd(), override);
  }
  return path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../examples");
}

/**
 * @param {string} projectRoot
 * @returns {string}
 */
function detectDefaultBranch(projectRoot) {
  const headPath = path.join(projectRoot, ".git", "HEAD");
  if (!fs.existsSync(headPath)) {
    return "main";
  }

  try {
    const head = fs.readFileSync(headPath, "utf8").trim();
    const match = head.match(/^ref:\s+refs\/heads\/(.+)$/u);
    return match ? match[1] : "main";
  } catch {
    return "main";
  }
}

/**
 * @param {string} projectRoot
 * @returns {"monorepo" | "single-repo"}
 */
function detectRepoTopology(projectRoot) {
  if (
    fs.existsSync(path.join(projectRoot, "pnpm-workspace.yaml")) ||
    fs.existsSync(path.join(projectRoot, "turbo.json")) ||
    fs.existsSync(path.join(projectRoot, "apps")) ||
    fs.existsSync(path.join(projectRoot, "packages"))
  ) {
    return "monorepo";
  }
  return "single-repo";
}

/**
 * @param {string} projectRoot
 * @param {{
 *   buildCommands?: string[],
 *   lintCommands?: string[],
 *   testCommands?: string[],
 * }} [overrides]
 * @returns {{ buildCommands: string[], lintCommands: string[], testCommands: string[] }}
 */
function detectVerificationCommands(projectRoot, overrides = {}) {
  /** @type {string[]} */
  const buildCommands = [];
  /** @type {string[]} */
  const lintCommands = [];
  /** @type {string[]} */
  const testCommands = [];

  const packageJsonPath = path.join(projectRoot, "package.json");
  if (fs.existsSync(packageJsonPath)) {
    try {
      const packageJson = /** @type {{ scripts?: Record<string, string> }} */ (
        JSON.parse(fs.readFileSync(packageJsonPath, "utf8"))
      );
      const scripts = typeof packageJson.scripts === "object" && packageJson.scripts ? packageJson.scripts : {};
      for (const [name] of Object.entries(scripts)) {
        const normalized = name.toLowerCase();
        if (
          normalized === "build" ||
          normalized.startsWith("build:") ||
          normalized.includes(":build") ||
          normalized.includes("typecheck")
        ) {
          buildCommands.push(`npm run ${name}`);
        }
        if (
          normalized === "lint" ||
          normalized.startsWith("lint:") ||
          normalized.includes(":lint") ||
          normalized.includes("codestyle")
        ) {
          lintCommands.push(`npm run ${name}`);
        }
        if (
          normalized === "test" ||
          normalized.startsWith("test:") ||
          normalized.includes(":test") ||
          normalized.includes("test-unit") ||
          normalized.includes("test-cover")
        ) {
          testCommands.push(`npm run ${name}`);
        }
      }
    } catch {
      // ignore malformed package.json and fall back to other repo signals
    }
  }

  const makefilePath = path.join(projectRoot, "Makefile");
  if (fs.existsSync(makefilePath)) {
    const makefile = fs.readFileSync(makefilePath, "utf8");
    if (/^build\s*:/mu.test(makefile)) buildCommands.push("make build");
    if (/^test\s*:/mu.test(makefile)) testCommands.push("make test");
    if (/^test-cover\s*:/mu.test(makefile)) testCommands.push("make test-cover");
    if (/^codestyle\s*:/mu.test(makefile)) lintCommands.push("make codestyle");
    if (/^lint\s*:/mu.test(makefile)) lintCommands.push("make lint");
  }

  return {
    buildCommands:
      Array.isArray(overrides.buildCommands) && overrides.buildCommands.length > 0
        ? [...new Set(overrides.buildCommands)]
        : [...new Set(buildCommands)],
    lintCommands:
      Array.isArray(overrides.lintCommands) && overrides.lintCommands.length > 0
        ? [...new Set(overrides.lintCommands)]
        : [...new Set(lintCommands)],
    testCommands:
      Array.isArray(overrides.testCommands) && overrides.testCommands.length > 0
        ? [...new Set(overrides.testCommands)]
        : [...new Set(testCommands)],
  };
}

/**
 * @param {{
 *   cwd: string,
 *   projectRoot: string,
 *   projectProfile?: string,
 *   bootstrapTemplate?: string,
 *   repoBuildCommands?: string[],
 *   repoLintCommands?: string[],
 *   repoTestCommands?: string[],
 * }} options
 * @returns {{ projectProfilePath: string, materialized: boolean, idempotent: boolean, templatePath: string | null }}
 */
function ensureMaterializedProjectProfile(options) {
  const explicitPath =
    typeof options.projectProfile === "string" && options.projectProfile.trim().length > 0
      ? path.isAbsolute(options.projectProfile)
        ? options.projectProfile
        : path.resolve(options.cwd, options.projectProfile)
      : path.join(options.projectRoot, "project.aor.yaml");
  if (fs.existsSync(explicitPath)) {
    return {
      projectProfilePath: explicitPath,
      materialized: false,
      idempotent: true,
      templatePath: null,
    };
  }

  const bundledExamplesRoot = resolveBundledExamplesRoot();
  const bootstrapTemplate = options.bootstrapTemplate ?? DEFAULT_BOOTSTRAP_TEMPLATE_ID;
  let templatePath = null;
  if (bootstrapTemplate === DEFAULT_BOOTSTRAP_TEMPLATE_ID) {
    templatePath = path.join(bundledExamplesRoot, "project.github.aor.yaml");
  } else {
    const candidates = [
      path.resolve(options.cwd, bootstrapTemplate),
      path.resolve(options.projectRoot, bootstrapTemplate),
      path.resolve(bundledExamplesRoot, bootstrapTemplate),
    ];
    templatePath = candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
  }
  if (!templatePath || !fs.existsSync(templatePath)) {
    throw new Error(`Bootstrap template '${bootstrapTemplate}' was not found.`);
  }

  const loaded = loadContractFile({
    filePath: templatePath,
    family: "project-profile",
  });
  if (!loaded.ok) {
    const issueSummary = loaded.validation.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Bootstrap template '${templatePath}' failed validation: ${issueSummary}`);
  }

  const projectName = path.basename(options.projectRoot);
  const projectId = normalizeId(projectName) || "target-project";
  const verification = detectVerificationCommands(options.projectRoot, {
    buildCommands: options.repoBuildCommands,
    lintCommands: options.repoLintCommands,
    testCommands: options.repoTestCommands,
  });
  const profile = /** @type {Record<string, unknown>} */ (JSON.parse(JSON.stringify(loaded.document)));
  profile.project_id = projectId;
  profile.display_name = projectName;
  profile.repo_topology = detectRepoTopology(options.projectRoot);
  delete profile.live_e2e_defaults;

  const repos = Array.isArray(profile.repos) && profile.repos.length > 0
    ? /** @type {Array<Record<string, unknown>>} */ (JSON.parse(JSON.stringify(profile.repos)))
    : [{}];
  const primaryRepo = repos[0];
  primaryRepo.repo_id = typeof primaryRepo.repo_id === "string" && primaryRepo.repo_id.trim().length > 0
    ? primaryRepo.repo_id
    : "main";
  primaryRepo.name = projectName;
  primaryRepo.default_branch = detectDefaultBranch(options.projectRoot);
  primaryRepo.role = typeof primaryRepo.role === "string" && primaryRepo.role.trim().length > 0
    ? primaryRepo.role
    : "application";
  primaryRepo.source = {
    kind: "local",
    root: ".",
  };
  primaryRepo.build_commands = verification.buildCommands;
  primaryRepo.lint_commands = verification.lintCommands;
  primaryRepo.test_commands = verification.testCommands;
  profile.repos = [primaryRepo];

  const serialized = stringifyYaml(profile);
  fs.mkdirSync(path.dirname(explicitPath), { recursive: true });
  fs.writeFileSync(explicitPath, serialized, "utf8");

  return {
    projectProfilePath: explicitPath,
    materialized: true,
    idempotent: false,
    templatePath,
  };
}

/**
 * @param {{ projectRoot: string }} options
 * @returns {{ materializedRoot: string | null, materialized: boolean, idempotent: boolean }}
 */
function ensureBootstrapAssets(options) {
  const bundledExamplesRoot = resolveBundledExamplesRoot();
  const targetExamplesRoot = path.join(options.projectRoot, "examples");
  const targetContextRoot = path.join(options.projectRoot, "context");
  let materialized = false;

  if (!fs.existsSync(targetExamplesRoot)) {
    fs.cpSync(bundledExamplesRoot, targetExamplesRoot, { recursive: true });
    materialized = true;
  }

  const bundledContextRoot = path.join(bundledExamplesRoot, "context");
  if (fs.existsSync(bundledContextRoot) && !fs.existsSync(targetContextRoot)) {
    fs.cpSync(bundledContextRoot, targetContextRoot, { recursive: true });
    materialized = true;
  }

  return {
    materializedRoot: fs.existsSync(targetExamplesRoot) ? targetExamplesRoot : null,
    materialized,
    idempotent: !materialized,
  };
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
 *   materializeProjectProfile?: boolean,
 *   bootstrapTemplate?: string,
 *   materializeBootstrapAssets?: boolean,
 *   repoBuildCommands?: string[],
 *   repoLintCommands?: string[],
 *   repoTestCommands?: string[],
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
 *   artifactPacketFile: string,
 *   artifactPacketBodyFile: string,
 *   artifactPacketId: string,
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
  const materializeProjectProfile = options.materializeProjectProfile === true;
  const materializeBootstrapAssets = options.materializeBootstrapAssets === true;

  let projectProfilePath;
  /** @type {{ materialized: boolean, idempotent: boolean, templatePath: string | null }} */
  let profileMaterialization = { materialized: false, idempotent: false, templatePath: null };
  if (materializeProjectProfile) {
    const materialized = ensureMaterializedProjectProfile({
      cwd,
      projectRoot,
      projectProfile: options.projectProfile,
      bootstrapTemplate:
        typeof options.bootstrapTemplate === "string" && options.bootstrapTemplate.trim().length > 0
          ? options.bootstrapTemplate.trim()
          : undefined,
      repoBuildCommands: Array.isArray(options.repoBuildCommands) ? options.repoBuildCommands : [],
      repoLintCommands: Array.isArray(options.repoLintCommands) ? options.repoLintCommands : [],
      repoTestCommands: Array.isArray(options.repoTestCommands) ? options.repoTestCommands : [],
    });
    projectProfilePath = materialized.projectProfilePath;
    profileMaterialization = {
      materialized: materialized.materialized,
      idempotent: materialized.idempotent,
      templatePath: materialized.templatePath,
    };
  } else {
    projectProfilePath = resolveProjectProfilePath({
      cwd,
      projectRoot,
      projectProfile: options.projectProfile,
    });
  }

  const bootstrapAssetsMaterialization = materializeBootstrapAssets
    ? ensureBootstrapAssets({ projectRoot })
    : {
        materializedRoot: null,
        materialized: false,
        idempotent: false,
      };

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
    bootstrap_materialization: {
      profile: {
        requested: materializeProjectProfile,
        materialized: profileMaterialization.materialized,
        idempotent: profileMaterialization.idempotent,
        template_ref: profileMaterialization.templatePath,
        command_overrides: {
          build_commands: Array.isArray(options.repoBuildCommands) ? options.repoBuildCommands : [],
          lint_commands: Array.isArray(options.repoLintCommands) ? options.repoLintCommands : [],
          test_commands: Array.isArray(options.repoTestCommands) ? options.repoTestCommands : [],
        },
      },
      assets: {
        requested: materializeBootstrapAssets,
        materialized: bootstrapAssetsMaterialization.materialized,
        idempotent: bootstrapAssetsMaterialization.idempotent,
        materialized_root: bootstrapAssetsMaterialization.materializedRoot,
      },
    },
  };

  const stateFile = path.join(runtimeLayout.stateRoot, "project-init-state.json");
  fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const artifactPacket = materializeBootstrapArtifactPacket({
    projectId: loadedProfile.projectId,
    projectRoot,
    projectProfileRef: state.selected_profile_ref,
    runtimeLayout,
    command: "aor project init",
  });

  return {
    projectRoot,
    projectProfilePath,
    projectProfileRef: state.selected_profile_ref,
    projectId: loadedProfile.projectId,
    displayName: loadedProfile.displayName,
    runtimeRoot,
    runtimeLayout,
    stateFile,
    artifactPacketFile: artifactPacket.packetFile,
    artifactPacketBodyFile: artifactPacket.packetBodyFile,
    artifactPacketId: artifactPacket.packet.packet_id,
    state,
    bootstrapMaterializationStatus:
      materializeProjectProfile || materializeBootstrapAssets
        ? profileMaterialization.materialized || bootstrapAssetsMaterialization.materialized
          ? "materialized"
          : "reused-existing"
        : "not-requested",
    materializedProjectProfileFile: materializeProjectProfile ? projectProfilePath : null,
    materializedBootstrapAssetsRoot: materializeBootstrapAssets ? bootstrapAssetsMaterialization.materializedRoot : null,
    bootstrapMaterializationIdempotent:
      materializeProjectProfile || materializeBootstrapAssets
        ? profileMaterialization.idempotent && bootstrapAssetsMaterialization.idempotent
        : null,
  };
}
