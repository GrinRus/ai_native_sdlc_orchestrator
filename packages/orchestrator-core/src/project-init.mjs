import fs from "node:fs";
import path from "node:path";
import { stringify as stringifyYaml } from "yaml";

import { loadContractFile, validateContractDocument } from "../../contracts/src/index.mjs";
import { materializeBootstrapArtifactPacket } from "./artifact-store.mjs";

const DEFAULT_RUNTIME_ROOT = ".aor";
const DEFAULT_BOOTSTRAP_TEMPLATE_ID = "github-default";
const DEFAULT_PROFILE_CANDIDATES = [
  "project.aor.yaml",
  "examples/project.aor.yaml",
  "examples/project.github.aor.yaml",
];
const ASSET_MODES = new Set(["bundled", "materialized"]);
const DEFAULT_REGISTRY_ROOTS = Object.freeze({
  routes: "examples/routes",
  wrappers: "examples/wrappers",
  prompts: "examples/prompts",
  policies: "examples/policies",
  adapters: "examples/adapters",
  evaluation: "examples",
  skills: "examples/skills",
  context_docs: "examples/context/docs",
  context_rules: "examples/context/rules",
  context_skills: "examples/context/skills",
  context_bundles: "examples/context/bundles",
});

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeId(value) {
  let normalized = "";
  let pendingSeparator = false;
  for (const character of value.toLowerCase()) {
    const codePoint = character.codePointAt(0) ?? 0;
    const isLowerAscii = codePoint >= 97 && codePoint <= 122;
    const isDigit = codePoint >= 48 && codePoint <= 57;
    const isAllowedSymbol = character === "." || character === "_" || character === "-";
    if (isLowerAscii || isDigit || isAllowedSymbol) {
      if (pendingSeparator && normalized.length > 0) {
        normalized += "-";
      }
      normalized += character;
      pendingSeparator = false;
    } else if (normalized.length > 0) {
      pendingSeparator = true;
    }
  }
  while (normalized.endsWith("-")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value)
    : {};
}

/**
 * @param {string} projectRoot
 * @param {string} filePath
 * @returns {string}
 */
function toProjectRelativePath(projectRoot, filePath) {
  const relative = path.relative(projectRoot, filePath).replace(/\\/g, "/");
  if (relative && !relative.startsWith("../") && !path.isAbsolute(relative)) {
    return relative;
  }
  return filePath;
}

/**
 * @param {unknown} value
 * @param {"bundled" | "materialized"} fallback
 * @returns {"bundled" | "materialized"}
 */
function normalizeAssetMode(value, fallback) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return fallback;
  }
  const normalized = value.trim();
  if (!ASSET_MODES.has(normalized)) {
    throw new Error(`Unsupported asset mode '${value}'. Expected one of: bundled, materialized.`);
  }
  return /** @type {"bundled" | "materialized"} */ (normalized);
}

/**
 * @param {string} baseRoot
 * @returns {Record<string, string>}
 */
function registryRootsFromBase(baseRoot) {
  return {
    routes: path.join(baseRoot, "routes"),
    wrappers: path.join(baseRoot, "wrappers"),
    prompts: path.join(baseRoot, "prompts"),
    policies: path.join(baseRoot, "policies"),
    adapters: path.join(baseRoot, "adapters"),
    evaluation: baseRoot,
    skills: path.join(baseRoot, "skills"),
    context_docs: path.join(baseRoot, "context/docs"),
    context_rules: path.join(baseRoot, "context/rules"),
    context_skills: path.join(baseRoot, "context/skills"),
    context_bundles: path.join(baseRoot, "context/bundles"),
  };
}

/**
 * @param {Record<string, unknown>} profile
 * @param {{ projectRoot: string }} options
 * @returns {{ assetMode: "bundled" | "materialized", roots: Record<string, string> }}
 */
export function resolveProjectRegistryRoots(profile, options) {
  const assetMode = normalizeAssetMode(profile.asset_mode, "materialized");
  const declaredRoots = asRecord(profile.registry_roots);
  /** @type {Record<string, string>} */
  const roots = {};

  for (const [key, fallbackValue] of Object.entries(DEFAULT_REGISTRY_ROOTS)) {
    const declaredValue = declaredRoots[key];
    const selectedValue =
      typeof declaredValue === "string" && declaredValue.trim().length > 0
        ? declaredValue.trim()
        : fallbackValue;
    roots[key] = path.isAbsolute(selectedValue)
      ? selectedValue
      : path.resolve(options.projectRoot, selectedValue);
  }

  return { assetMode, roots };
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
 * @param {{ cwd?: string, projectRoot: string, projectProfile?: string }} options
 * @returns {string | null}
 */
function resolveOptionalProjectProfilePath(options) {
  if (typeof options.projectProfile === "string" && options.projectProfile.trim().length > 0) {
    return resolveProjectProfilePath(options);
  }

  for (const candidate of DEFAULT_PROFILE_CANDIDATES) {
    const resolved = path.resolve(options.projectRoot, candidate);
    if (fs.existsSync(resolved)) {
      return resolved;
    }
  }

  return null;
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
 *   bootstrapTemplate?: string,
 *   cwd: string,
 *   projectRoot: string,
 * }} options
 * @returns {{ templatePath: string, bundledExamplesRoot: string }}
 */
function resolveBootstrapTemplate(options) {
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

  return { templatePath, bundledExamplesRoot };
}

/**
 * @param {{
 *   cwd: string,
 *   projectRoot: string,
 *   bootstrapTemplate?: string,
 *   assetMode: "bundled" | "materialized",
 *   repoBuildCommands?: string[],
 *   repoLintCommands?: string[],
 *   repoTestCommands?: string[],
 * }} options
 * @returns {{ profile: Record<string, unknown>, templatePath: string, bundledExamplesRoot: string }}
 */
function createBootstrapProjectProfile(options) {
  const { templatePath, bundledExamplesRoot } = resolveBootstrapTemplate(options);
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
  profile.asset_mode = options.assetMode;
  profile.registry_roots =
    options.assetMode === "bundled"
      ? registryRootsFromBase(bundledExamplesRoot)
      : { ...DEFAULT_REGISTRY_ROOTS };
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

  const validation = validateContractDocument({
    family: "project-profile",
    document: profile,
    source: `generated://${options.assetMode}-project-profile`,
  });
  if (!validation.ok) {
    const issueSummary = validation.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Generated ${options.assetMode} project profile failed validation: ${issueSummary}`);
  }

  return { profile, templatePath, bundledExamplesRoot };
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

  const generated = createBootstrapProjectProfile({
    cwd: options.cwd,
    projectRoot: options.projectRoot,
    bootstrapTemplate: options.bootstrapTemplate,
    assetMode: "materialized",
    repoBuildCommands: options.repoBuildCommands,
    repoLintCommands: options.repoLintCommands,
    repoTestCommands: options.repoTestCommands,
  });
  const profile = generated.profile;
  const serialized = stringifyYaml(profile);
  fs.mkdirSync(path.dirname(explicitPath), { recursive: true });
  fs.writeFileSync(explicitPath, serialized, "utf8");

  return {
    projectProfilePath: explicitPath,
    materialized: true,
    idempotent: false,
    templatePath: generated.templatePath,
  };
}

/**
 * @param {{ sourceRoot: string, targetRoot: string }} options
 * @returns {string[]}
 */
function collectMissingBundledAssetPaths(options) {
  if (!fs.existsSync(options.sourceRoot)) {
    return [];
  }
  const missing = [];
  const visit = (sourcePath, relativePath) => {
    const targetPath = path.join(options.targetRoot, relativePath);
    if (!fs.existsSync(targetPath)) {
      missing.push(relativePath || ".");
      return;
    }
    const sourceStat = fs.statSync(sourcePath);
    if (!sourceStat.isDirectory()) {
      return;
    }
    for (const entry of fs.readdirSync(sourcePath)) {
      visit(path.join(sourcePath, entry), path.join(relativePath, entry));
    }
  };
  visit(options.sourceRoot, "");
  return missing;
}

/**
 * @param {{ sourceRoot: string, targetRoot: string }} options
 * @returns {boolean}
 */
function materializeBundledAssetTree(options) {
  const missingPaths = collectMissingBundledAssetPaths(options);
  if (missingPaths.length === 0) {
    return false;
  }
  fs.cpSync(options.sourceRoot, options.targetRoot, {
    recursive: true,
    force: false,
    errorOnExist: false,
  });
  return true;
}

/**
 * @param {{ projectRoot: string }} options
 * @returns {{ materializedRoot: string | null, materialized: boolean, idempotent: boolean, materializedPaths: string[] }}
 */
function ensureBootstrapAssets(options) {
  const bundledExamplesRoot = resolveBundledExamplesRoot();
  const targetExamplesRoot = path.join(options.projectRoot, "examples");
  const targetContextRoot = path.join(options.projectRoot, "context");
  let materialized = false;
  const materializedPaths = [];

  if (materializeBundledAssetTree({ sourceRoot: bundledExamplesRoot, targetRoot: targetExamplesRoot })) {
    materialized = true;
    materializedPaths.push(targetExamplesRoot);
  }

  const bundledContextRoot = path.join(bundledExamplesRoot, "context");
  if (materializeBundledAssetTree({ sourceRoot: bundledContextRoot, targetRoot: targetContextRoot })) {
    materialized = true;
    materializedPaths.push(targetContextRoot);
  }

  return {
    materializedRoot: fs.existsSync(targetExamplesRoot) ? targetExamplesRoot : null,
    materialized,
    idempotent: !materialized,
    materializedPaths,
  };
}

/**
 * @param {{ projectProfilePath: string, profileDocument: Record<string, unknown> }} options
 * @returns {{ projectProfilePath: string, document: Record<string, unknown>, projectId: string, displayName: string, runtimeRootFromProfile: string }}
 */
function resolveProjectProfileRuntimeMetadata(options) {
  const profileDocument = options.profileDocument;
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

  return resolveProjectProfileRuntimeMetadata({
    projectProfilePath: options.projectProfilePath,
    profileDocument: /** @type {Record<string, unknown>} */ (loaded.document),
  });
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
 * @param {{ projectRoot: string, filePaths: string[] }} options
 * @returns {string[]}
 */
function toProjectRelativePaths(options) {
  return options.filePaths
    .filter((filePath) => typeof filePath === "string" && filePath.length > 0)
    .map((filePath) => toProjectRelativePath(options.projectRoot, filePath));
}

/**
 * @param {{
 *   projectRoot: string,
 *   projectId: string,
 *   command: string,
 *   projectProfileRef: string,
 *   projectProfileSource: string,
 *   projectProfilePath: string,
 *   runtimeRoot: string,
 *   assetMode: "bundled" | "materialized",
 *   registryRoots: Record<string, string>,
 *   runtimeLayout: { stateRoot: string, reportsRoot: string },
 *   stateFile: string,
 *   artifactPacketFile: string,
 *   reportPath: string,
 *   existingProfileFound: boolean,
 *   targetRepoWrites: string[],
 *   runtimeWrites: string[],
 *   bootstrapAssetsMaterialized: boolean,
 *   profileMaterialized: boolean,
 *   repoTopology: string,
 * }} options
 * @returns {Record<string, unknown>}
 */
function createOnboardingReport(options) {
  const requiredRegistryRoots = [
    "routes",
    "wrappers",
    "prompts",
    "policies",
    "adapters",
    "evaluation",
    "context_bundles",
  ];
  const registryChecks = requiredRegistryRoots.map((key) => {
    const root = options.registryRoots[key];
    const exists = typeof root === "string" && fs.existsSync(root);
    return {
      check_id: `registry-root-${key}`,
      status: exists ? "pass" : "fail",
      summary: exists
        ? `Registry root '${key}' is available.`
        : `Registry root '${key}' is missing or not resolvable.`,
      path: root ?? null,
    };
  });
  const targetWriteBoundaryPass =
    options.assetMode !== "bundled" || (options.targetRepoWrites.length === 0 && !options.bootstrapAssetsMaterialized);
  const checks = [
    {
      check_id: "project-profile",
      status: "pass",
      summary:
        options.projectProfileSource === "bundled-generated"
          ? "Bundled project profile generated under runtime state."
          : "Project profile resolved for onboarding.",
      path: options.projectProfileRef,
    },
    ...registryChecks,
    {
      check_id: "target-write-boundary",
      status: targetWriteBoundaryPass ? "pass" : "fail",
      summary: targetWriteBoundaryPass
        ? "Onboarding write effects match the selected asset mode."
        : "Bundled onboarding attempted target-repo asset writes.",
    },
  ];
  const blockers = checks
    .filter((check) => check.status === "fail")
    .map((check) => ({
      code: check.check_id,
      summary: check.summary,
      next_command:
        check.check_id === "target-write-boundary"
          ? `aor onboard --project-ref ${options.projectRoot} --asset-mode materialized`
          : `aor onboard --project-ref ${options.projectRoot} --asset-mode ${options.assetMode}`,
    }));
  const status = blockers.length > 0 ? "blocked" : "ready";

  return {
    report_id: `${options.projectId}.onboarding.v1`,
    project_id: options.projectId,
    version: 1,
    generated_from: {
      command: options.command,
      project_root: options.projectRoot,
      selected_profile_ref: options.projectProfileRef,
      profile_source: options.projectProfileSource,
    },
    project_state: {
      project_root: options.projectRoot,
      runtime_root: options.runtimeRoot,
      project_profile_ref: options.projectProfileRef,
      project_profile_path: options.projectProfilePath,
      existing_profile_found: options.existingProfileFound,
      has_git: fs.existsSync(path.join(options.projectRoot, ".git")),
      has_package_json: fs.existsSync(path.join(options.projectRoot, "package.json")),
      repo_topology: options.repoTopology,
    },
    asset_mode: options.assetMode,
    registry_roots: options.registryRoots,
    readiness: {
      status,
      checks,
    },
    blockers,
    next_action: {
      command:
        status === "ready"
          ? `aor next --project-ref ${options.projectRoot}`
          : blockers[0]?.next_command ?? `aor doctor --project-ref ${options.projectRoot}`,
      reason:
        status === "ready"
          ? "Runtime bootstrap is ready for guided next-action resolution."
          : "Onboarding is blocked until the failed readiness checks pass.",
    },
    write_effects: {
      target_repo_writes: toProjectRelativePaths({ projectRoot: options.projectRoot, filePaths: options.targetRepoWrites }),
      runtime_writes: toProjectRelativePaths({ projectRoot: options.projectRoot, filePaths: options.runtimeWrites }),
      copied_example_registries: options.bootstrapAssetsMaterialized,
      materialized_profile: options.profileMaterialized,
    },
    status,
  };
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef?: string,
 *   projectProfile?: string,
 *   runtimeRoot?: string,
 *   assetMode?: "bundled" | "materialized",
 *   materializeProjectProfile?: boolean,
 *   bootstrapTemplate?: string,
 *   materializeBootstrapAssets?: boolean,
 *   repoBuildCommands?: string[],
 *   repoLintCommands?: string[],
 *   repoTestCommands?: string[],
 *   command?: string,
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
  const requestedAssetMode =
    typeof options.assetMode === "string" ? normalizeAssetMode(options.assetMode, "bundled") : null;
  if (
    requestedAssetMode === "bundled" &&
    (options.materializeProjectProfile === true || options.materializeBootstrapAssets === true)
  ) {
    throw new Error("Asset mode 'bundled' cannot be combined with materialization flags.");
  }
  const materializeProjectProfile =
    options.materializeProjectProfile === true || requestedAssetMode === "materialized";
  const materializeBootstrapAssets =
    options.materializeBootstrapAssets === true || requestedAssetMode === "materialized";

  let projectProfilePath;
  let projectProfileSource = "default-discovered";
  let generatedBundledProfile = null;
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
    projectProfileSource = materialized.materialized ? "materialized" : "existing-materialized";
    profileMaterialization = {
      materialized: materialized.materialized,
      idempotent: materialized.idempotent,
      templatePath: materialized.templatePath,
    };
  } else {
    projectProfilePath = resolveOptionalProjectProfilePath({
      cwd,
      projectRoot,
      projectProfile: options.projectProfile,
    });
    if (projectProfilePath) {
      projectProfileSource =
        typeof options.projectProfile === "string" && options.projectProfile.trim().length > 0
          ? "explicit"
          : "default-discovered";
    } else {
      generatedBundledProfile = createBootstrapProjectProfile({
        cwd,
        projectRoot,
        bootstrapTemplate:
          typeof options.bootstrapTemplate === "string" && options.bootstrapTemplate.trim().length > 0
            ? options.bootstrapTemplate.trim()
            : undefined,
        assetMode: "bundled",
        repoBuildCommands: Array.isArray(options.repoBuildCommands) ? options.repoBuildCommands : [],
        repoLintCommands: Array.isArray(options.repoLintCommands) ? options.repoLintCommands : [],
        repoTestCommands: Array.isArray(options.repoTestCommands) ? options.repoTestCommands : [],
      });
      projectProfileSource = "bundled-generated";
      projectProfilePath = "<generated-bundled-profile>";
    }
  }

  const bootstrapAssetsMaterialization = materializeBootstrapAssets
    ? ensureBootstrapAssets({ projectRoot })
    : {
        materializedRoot: null,
        materialized: false,
        idempotent: false,
        materializedPaths: [],
      };

  let loadedProfile = generatedBundledProfile
    ? resolveProjectProfileRuntimeMetadata({
        projectProfilePath,
        profileDocument: generatedBundledProfile.profile,
      })
    : loadProjectProfileForRuntime({ projectProfilePath });
  const runtimeRoot = resolveRuntimeRoot({
    projectRoot,
    runtimeRootOverride: options.runtimeRoot,
    runtimeRootFromProfile: loadedProfile.runtimeRootFromProfile,
  });

  const runtimeLayout = ensureRuntimeLayout({
    runtimeRoot,
    projectId: loadedProfile.projectId,
  });

  if (generatedBundledProfile) {
    projectProfilePath = path.join(runtimeLayout.stateRoot, "project.aor.yaml");
    fs.writeFileSync(projectProfilePath, stringifyYaml(generatedBundledProfile.profile), "utf8");
    loadedProfile = {
      ...loadedProfile,
      projectProfilePath,
    };
  }

  const registryResolution = resolveProjectRegistryRoots(loadedProfile.document, { projectRoot });
  const assetMode = registryResolution.assetMode;
  const projectProfileRef = toProjectRelativePath(projectRoot, projectProfilePath);
  const onboardingReportPath = path.join(runtimeLayout.reportsRoot, "onboarding-report.json");

  const state = {
    schema_version: 1,
    project_id: loadedProfile.projectId,
    display_name: loadedProfile.displayName,
    selected_profile_ref: projectProfileRef,
    project_root: projectRoot,
    runtime_root: runtimeRoot,
    asset_mode: assetMode,
    registry_roots: registryResolution.roots,
    onboarding_report_ref: toProjectRelativePath(projectRoot, onboardingReportPath),
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
    command: options.command ?? "aor project init",
  });

  const targetRepoWrites = [];
  if (profileMaterialization.materialized) {
    targetRepoWrites.push(projectProfilePath);
  }
  if (bootstrapAssetsMaterialization.materialized && bootstrapAssetsMaterialization.materializedRoot) {
    targetRepoWrites.push(...bootstrapAssetsMaterialization.materializedPaths);
  }
  const runtimeWrites = [
    generatedBundledProfile ? projectProfilePath : null,
    stateFile,
    artifactPacket.packetFile,
    artifactPacket.packetBodyFile,
    onboardingReportPath,
  ].filter((entry) => typeof entry === "string");
  const onboardingReport = createOnboardingReport({
    projectRoot,
    projectId: loadedProfile.projectId,
    command: options.command ?? "aor project init",
    projectProfileRef,
    projectProfileSource,
    projectProfilePath,
    runtimeRoot,
    assetMode,
    registryRoots: registryResolution.roots,
    runtimeLayout,
    stateFile,
    artifactPacketFile: artifactPacket.packetFile,
    reportPath: onboardingReportPath,
    existingProfileFound: projectProfileSource !== "bundled-generated" && !profileMaterialization.materialized,
    targetRepoWrites,
    runtimeWrites,
    bootstrapAssetsMaterialized: bootstrapAssetsMaterialization.materialized,
    profileMaterialized: profileMaterialization.materialized,
    repoTopology: typeof loadedProfile.document.repo_topology === "string" ? loadedProfile.document.repo_topology : "unknown",
  });
  const onboardingValidation = validateContractDocument({
    family: "onboarding-report",
    document: onboardingReport,
    source: "runtime://onboarding-report",
  });
  if (!onboardingValidation.ok) {
    const issueSummary = onboardingValidation.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Generated onboarding report failed contract validation: ${issueSummary}`);
  }
  fs.writeFileSync(onboardingReportPath, `${JSON.stringify(onboardingReport, null, 2)}\n`, "utf8");

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
    onboardingReport,
    onboardingReportFile: onboardingReportPath,
    onboardingReportId: onboardingReport.report_id,
    assetMode,
    registryRoots: registryResolution.roots,
    state,
    bootstrapMaterializationStatus:
      materializeProjectProfile || materializeBootstrapAssets
        ? profileMaterialization.materialized || bootstrapAssetsMaterialization.materialized
          ? "materialized"
          : "reused-existing"
        : projectProfileSource === "bundled-generated"
          ? "bundled"
          : "not-requested",
    materializedProjectProfileFile: materializeProjectProfile ? projectProfilePath : null,
    materializedBootstrapAssetsRoot: materializeBootstrapAssets ? bootstrapAssetsMaterialization.materializedRoot : null,
    bootstrapMaterializationIdempotent:
      materializeProjectProfile || materializeBootstrapAssets
        ? profileMaterialization.idempotent && bootstrapAssetsMaterialization.idempotent
        : null,
  };
}
