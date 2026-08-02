import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import childProcess from "node:child_process";
import { fileURLToPath } from "node:url";
import { stringify as stringifyYaml } from "yaml";

import { loadContractFile, validateContractDocument, validatePublicId } from "../../contracts/src/index.mjs";
import { materializeBootstrapArtifactPacket } from "./artifact-store.mjs";
import { discoverVerificationCommandGroups } from "./stack-discovery.mjs";

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
function deriveGeneratedProjectId(projectRoot) {
  const projectName = path.basename(projectRoot);
  if (validatePublicId(projectName).ok) return projectName;
  const canonicalRoot = fs.realpathSync.native(projectRoot);
  const digest = crypto.createHash("sha256").update(canonicalRoot).digest("hex").slice(0, 16);
  return `project-${digest}`;
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
      return fs.realpathSync.native(current);
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
  if (options.projectProfile) {
    const projectCandidate = path.isAbsolute(options.projectProfile)
      ? options.projectProfile
      : path.resolve(options.projectRoot, options.projectProfile);
    if (fs.existsSync(projectCandidate)) {
      return projectCandidate;
    }

    throw new Error(
      `Project profile '${options.projectProfile}' was not found from canonical project root '${options.projectRoot}'. Relative profile paths never resolve from launcher cwd.`,
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
    if (!path.isAbsolute(override)) {
      throw new Error("AOR bootstrap asset-root overrides must be absolute; launcher cwd is not a reference base.");
    }
    return override;
  }
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../examples");
}

/**
 * @param {string} projectRoot
 * @returns {string}
 */
function detectDefaultBranch(projectRoot) {
  try {
    const branch = childProcess
      .execFileSync("git", ["-C", projectRoot, "symbolic-ref", "--quiet", "--short", "HEAD"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      })
      .trim();
    return branch || "main";
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
 * @param {{ buildCommands: string[], lintCommands: string[], testCommands: string[] }} verification
 * @returns {Array<Record<string, unknown>>}
 */
function buildDefaultVerificationCommandGroups(verification) {
  const groups = [
    {
      id: "baseline-build",
      role: "build",
      phase: "baseline",
      enforcement: "required",
      timeout_class: "build",
      commands: verification.buildCommands,
    },
    {
      id: "baseline-lint",
      role: "lint",
      phase: "baseline",
      enforcement: "required",
      timeout_class: "quick",
      commands: verification.lintCommands,
    },
    {
      id: "baseline-test",
      role: "test",
      phase: "baseline",
      enforcement: "required",
      timeout_class: "focused-test",
      commands: verification.testCommands,
    },
    {
      id: "post-change-build",
      role: "build",
      phase: "post-change",
      enforcement: "required",
      timeout_class: "build",
      commands: verification.buildCommands,
    },
    {
      id: "post-change-lint",
      role: "lint",
      phase: "post-change",
      enforcement: "required",
      timeout_class: "quick",
      commands: verification.lintCommands,
    },
    {
      id: "post-change-test",
      role: "test",
      phase: "post-change",
      enforcement: "required",
      timeout_class: "focused-test",
      commands: verification.testCommands,
    },
  ];
  return groups.filter((group) => Array.isArray(group.commands) && group.commands.length > 0);
}

/**
 * @param {{ buildCommands?: string[], lintCommands?: string[], testCommands?: string[] }} options
 * @returns {boolean}
 */
function hasVerificationCommandOverrides(options) {
  return [options.buildCommands, options.lintCommands, options.testCommands].some(
    (commands) => Array.isArray(commands) && commands.length > 0,
  );
}

/**
 * @param {string} value
 * @returns {string}
 */
function quoteShellPath(value) {
  return /^[A-Za-z0-9_./-]+$/u.test(value) ? value : `'${value.replace(/'/gu, "'\\''")}'`;
}

/**
 * @param {Record<string, unknown>} group
 * @param {string} command
 * @returns {string}
 */
function toLegacyRepoCommand(group, command) {
  const workingDir = typeof group.working_dir === "string" && group.working_dir.trim().length > 0
    ? group.working_dir.trim()
    : ".";
  return workingDir === "." ? command : `cd ${quoteShellPath(workingDir)} && ${command}`;
}

/**
 * @param {Array<Record<string, unknown>>} commandGroups
 * @param {string} role
 * @returns {string[]}
 */
function collectLegacyCommandsForRole(commandGroups, role) {
  const commands = [];
  const seen = new Set();
  for (const group of commandGroups) {
    if (group.role !== role || group.phase !== "post-change") continue;
    const groupCommands = Array.isArray(group.commands) ? group.commands : [];
    for (const command of groupCommands) {
      if (typeof command !== "string" || command.trim().length === 0) continue;
      const legacyCommand = toLegacyRepoCommand(group, command.trim());
      if (seen.has(legacyCommand)) continue;
      seen.add(legacyCommand);
      commands.push(legacyCommand);
    }
  }
  return commands;
}

/**
 * @param {ReturnType<typeof discoverVerificationCommandGroups>} discovery
 * @returns {Array<Record<string, unknown>>}
 */
function commandGroupsFromDiscovery(discovery) {
  return discovery.command_group_candidates
    .map((candidate) => asRecord(candidate.command_group))
    .filter((group) => Array.isArray(group.commands) && group.commands.length > 0);
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
      path.isAbsolute(bootstrapTemplate) ? bootstrapTemplate : path.resolve(options.projectRoot, bootstrapTemplate),
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
  const projectId = deriveGeneratedProjectId(options.projectRoot);
  const profile = /** @type {Record<string, unknown>} */ (JSON.parse(JSON.stringify(loaded.document)));
  profile.project_id = projectId;
  profile.display_name = projectName;
  profile.repo_topology = detectRepoTopology(options.projectRoot);
  profile.asset_mode = options.assetMode;
  profile.registry_roots =
    options.assetMode === "bundled"
      ? registryRootsFromBase(bundledExamplesRoot)
      : { ...DEFAULT_REGISTRY_ROOTS };

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
  const hasOverrides = hasVerificationCommandOverrides({
    buildCommands: options.repoBuildCommands,
    lintCommands: options.repoLintCommands,
    testCommands: options.repoTestCommands,
  });
  const verification = detectVerificationCommands(options.projectRoot, {
    buildCommands: options.repoBuildCommands,
    lintCommands: options.repoLintCommands,
    testCommands: options.repoTestCommands,
  });
  const stackDiscovery = hasOverrides
    ? null
    : discoverVerificationCommandGroups({
        projectRoot: options.projectRoot,
        repoId: String(primaryRepo.repo_id),
      });
  const generatedCommandGroups = hasOverrides
    ? buildDefaultVerificationCommandGroups(verification)
    : commandGroupsFromDiscovery(stackDiscovery);
  primaryRepo.build_commands = hasOverrides
    ? verification.buildCommands
    : collectLegacyCommandsForRole(generatedCommandGroups, "build");
  primaryRepo.lint_commands = hasOverrides
    ? verification.lintCommands
    : collectLegacyCommandsForRole(generatedCommandGroups, "lint");
  primaryRepo.test_commands = hasOverrides
    ? verification.testCommands
    : collectLegacyCommandsForRole(generatedCommandGroups, "test");
  profile.repos = [primaryRepo];
  profile.verification = {
    ...asRecord(profile.verification),
    command_groups: generatedCommandGroups,
    ...(!hasOverrides && stackDiscovery
      ? {
          discovery_outcomes: stackDiscovery.outcomes,
          discovery_suggestions: stackDiscovery.suggestions,
        }
      : {}),
  };

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

function createProjectAssetTransaction(projectRoot) {
  return { projectRoot, transactionId: crypto.randomUUID(), createdPaths: [], stagedPaths: [] };
}

function ensureTrackedDirectory(transaction, directory) {
  if (fs.existsSync(directory)) {
    if (!fs.statSync(directory).isDirectory()) throw new Error(`Expected directory '${directory}'.`);
    return;
  }
  const missing = [];
  let cursor = directory;
  while (!fs.existsSync(cursor)) {
    missing.unshift(cursor);
    cursor = path.dirname(cursor);
  }
  fs.mkdirSync(directory, { recursive: true });
  transaction.createdPaths.push(...missing);
}

function writeNewFileTransactionally(transaction, targetPath, content) {
  if (fs.existsSync(targetPath)) return false;
  ensureTrackedDirectory(transaction, path.dirname(targetPath));
  const stagedPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.aor-init-${transaction.transactionId}.tmp`,
  );
  transaction.stagedPaths.push(stagedPath);
  fs.writeFileSync(stagedPath, content, { encoding: "utf8", flag: "wx" });
  fs.renameSync(stagedPath, targetPath);
  transaction.stagedPaths = transaction.stagedPaths.filter((entry) => entry !== stagedPath);
  transaction.createdPaths.push(targetPath);
  return true;
}

function copyMissingAssetTree(transaction, sourceRoot, targetRoot) {
  if (!fs.existsSync(sourceRoot)) return false;
  let materialized = false;
  const visit = (sourcePath, targetPath) => {
    const stat = fs.lstatSync(sourcePath);
    if (stat.isSymbolicLink()) {
      throw new Error(`Bootstrap asset source '${sourcePath}' must not contain symbolic links.`);
    }
    if (stat.isDirectory()) {
      ensureTrackedDirectory(transaction, targetPath);
      for (const entry of fs.readdirSync(sourcePath)) {
        visit(path.join(sourcePath, entry), path.join(targetPath, entry));
      }
      return;
    }
    if (fs.existsSync(targetPath)) return;
    const stagedPath = path.join(
      path.dirname(targetPath),
      `.${path.basename(targetPath)}.aor-init-${transaction.transactionId}.tmp`,
    );
    transaction.stagedPaths.push(stagedPath);
    fs.copyFileSync(sourcePath, stagedPath, fs.constants.COPYFILE_EXCL);
    fs.renameSync(stagedPath, targetPath);
    transaction.stagedPaths = transaction.stagedPaths.filter((entry) => entry !== stagedPath);
    transaction.createdPaths.push(targetPath);
    materialized = true;
  };
  visit(sourceRoot, targetRoot);
  return materialized;
}

function rollbackProjectAssetTransaction(transaction) {
  for (const stagedPath of transaction.stagedPaths) {
    fs.rmSync(stagedPath, { force: true });
  }
  for (const createdPath of [...transaction.createdPaths].reverse()) {
    try {
      const stat = fs.lstatSync(createdPath);
      if (stat.isDirectory()) fs.rmdirSync(createdPath);
      else fs.rmSync(createdPath, { force: true });
    } catch (error) {
      if (error?.code !== "ENOENT" && error?.code !== "ENOTEMPTY") throw error;
    }
  }
}

function injectInitializationFailure(options, point) {
  if (options.failureInjectionPoint === point) {
    const error = new Error(`Injected project initialization failure at '${point}'.`);
    error.code = "AOR_INIT_FAILURE_INJECTION";
    throw error;
  }
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
  writeNewFileTransactionally(options.transaction, explicitPath, serialized);

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
  return copyMissingAssetTree(options.transaction, options.sourceRoot, options.targetRoot);
}

/**
 * @param {{ projectRoot: string }} options
 * @returns {{ materializedRoot: string | null, materialized: boolean, idempotent: boolean, materializedPaths: string[] }}
 */
function ensureBootstrapAssets(options) {
  const bundledExamplesRoot = resolveBundledExamplesRoot();
  const targetExamplesRoot = path.join(options.projectRoot, "examples");
  let materialized = false;
  const materializedPaths = [];

  if (materializeBundledAssetTree({
    transaction: options.transaction,
    sourceRoot: bundledExamplesRoot,
    targetRoot: targetExamplesRoot,
  })) {
    materialized = true;
    materializedPaths.push(targetExamplesRoot);
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
export function resolveRuntimeLayout(options) {
  const projectIdValidation = validatePublicId(options.projectId);
  if (!projectIdValidation.ok) {
    throw new Error(
      `Invalid project_id ${JSON.stringify(options.projectId)} (${projectIdValidation.value_class}). ${projectIdValidation.migration}`,
    );
  }
  const projectsRoot = path.join(options.runtimeRoot, "projects");
  const projectRuntimeRoot = path.join(projectsRoot, options.projectId);
  const artifactsRoot = path.join(projectRuntimeRoot, "artifacts");
  const reportsRoot = path.join(projectRuntimeRoot, "reports");
  const stateRoot = path.join(projectRuntimeRoot, "state");

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
 * @param {{ runtimeRoot: string, projectId: string }} options
 * @returns {{ runtimeRoot: string, projectsRoot: string, projectRuntimeRoot: string, artifactsRoot: string, reportsRoot: string, stateRoot: string }}
 */
export function ensureRuntimeLayout(options) {
  const layout = resolveRuntimeLayout(options);
  for (const dirPath of [
    options.runtimeRoot,
    layout.projectsRoot,
    layout.projectRuntimeRoot,
    layout.artifactsRoot,
    layout.reportsRoot,
    layout.stateRoot,
  ]) {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  return layout;
}

function isContainedPath(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

/** Canonicalize a runtime boundary before the first write. */
function canonicalizeRuntimeRoot(runtimeRoot) {
  const absolute = path.resolve(runtimeRoot);
  let cursor = absolute;
  const missing = [];
  while (!fs.existsSync(cursor)) {
    missing.unshift(path.basename(cursor));
    const parent = path.dirname(cursor);
    if (parent === cursor) throw new Error(`Cannot resolve runtime root '${runtimeRoot}'.`);
    cursor = parent;
  }
  const stat = fs.lstatSync(cursor);
  if (cursor === absolute && stat.isSymbolicLink()) {
    throw new Error(`Runtime root '${runtimeRoot}' must not be a symbolic link or junction.`);
  }
  const canonicalAncestor = fs.realpathSync.native(cursor);
  return path.join(canonicalAncestor, ...missing);
}

function createStagingRuntimeLayout(finalLayout) {
  fs.mkdirSync(finalLayout.projectsRoot, { recursive: true });
  const canonicalProjectsRoot = fs.realpathSync.native(finalLayout.projectsRoot);
  if (!isContainedPath(finalLayout.runtimeRoot, canonicalProjectsRoot)) {
    throw new Error(`Projects root '${finalLayout.projectsRoot}' escapes runtime boundary '${finalLayout.runtimeRoot}'.`);
  }
  const transactionId = crypto.randomUUID();
  const stagingProjectRuntimeRoot = path.join(
    canonicalProjectsRoot,
    `.${path.basename(finalLayout.projectRuntimeRoot)}.init-${transactionId}.tmp`,
  );
  const backupProjectRuntimeRoot = path.join(
    canonicalProjectsRoot,
    `.${path.basename(finalLayout.projectRuntimeRoot)}.init-${transactionId}.backup`,
  );
  fs.mkdirSync(stagingProjectRuntimeRoot, { recursive: false });
  const ownerMarker = path.join(stagingProjectRuntimeRoot, ".aor-init-owner.json");
  fs.writeFileSync(ownerMarker, `${JSON.stringify({ transaction_id: transactionId, project_id: path.basename(finalLayout.projectRuntimeRoot) })}\n`, "utf8");
  if (fs.existsSync(finalLayout.projectRuntimeRoot)) {
    for (const entry of fs.readdirSync(finalLayout.projectRuntimeRoot)) {
      fs.cpSync(
        path.join(finalLayout.projectRuntimeRoot, entry),
        path.join(stagingProjectRuntimeRoot, entry),
        { recursive: true, force: false, errorOnExist: false, preserveTimestamps: true },
      );
    }
  }
  const stagingLayout = {
    ...finalLayout,
    projectRuntimeRoot: stagingProjectRuntimeRoot,
    artifactsRoot: path.join(stagingProjectRuntimeRoot, "artifacts"),
    reportsRoot: path.join(stagingProjectRuntimeRoot, "reports"),
    stateRoot: path.join(stagingProjectRuntimeRoot, "state"),
  };
  for (const directory of [stagingLayout.artifactsRoot, stagingLayout.reportsRoot, stagingLayout.stateRoot]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  return { transactionId, stagingLayout, ownerMarker, backupProjectRuntimeRoot };
}

function cleanupOwnedStagingTree(transaction) {
  if (!fs.existsSync(transaction.ownerMarker)) return;
  const marker = JSON.parse(fs.readFileSync(transaction.ownerMarker, "utf8"));
  if (marker.transaction_id !== transaction.transactionId) return;
  fs.rmSync(transaction.stagingLayout.projectRuntimeRoot, { recursive: true, force: true });
}

function publishStagedRuntime(finalLayout, transaction, options = {}) {
  const hadExistingRuntime = fs.existsSync(finalLayout.projectRuntimeRoot);
  try {
    if (hadExistingRuntime) {
      fs.renameSync(finalLayout.projectRuntimeRoot, transaction.backupProjectRuntimeRoot);
      injectInitializationFailure(options, "after-backup-rename");
    }
    fs.renameSync(transaction.stagingLayout.projectRuntimeRoot, finalLayout.projectRuntimeRoot);
  } catch (error) {
    if (!fs.existsSync(finalLayout.projectRuntimeRoot) && fs.existsSync(transaction.backupProjectRuntimeRoot)) {
      fs.renameSync(transaction.backupProjectRuntimeRoot, finalLayout.projectRuntimeRoot);
    }
    if (error?.code === "EXDEV") {
      throw new Error("Runtime publication crossed a filesystem boundary; atomic initialization was refused.", {
        cause: error,
      });
    }
    throw error;
  }
  fs.rmSync(path.join(finalLayout.projectRuntimeRoot, path.basename(transaction.ownerMarker)), { force: true });
  if (hadExistingRuntime) {
    fs.rmSync(transaction.backupProjectRuntimeRoot, { recursive: true, force: true });
  }
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
  const projectAssetTransaction = createProjectAssetTransaction(projectRoot);
  try {

  let projectProfilePath;
  let projectProfileSource = "default-discovered";
  let generatedBundledProfile = null;
  /** @type {{ materialized: boolean, idempotent: boolean, templatePath: string | null }} */
  let profileMaterialization = { materialized: false, idempotent: false, templatePath: null };
  if (materializeProjectProfile) {
    const materialized = ensureMaterializedProjectProfile({
      transaction: projectAssetTransaction,
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
    injectInitializationFailure(options, "after-profile-materialization");
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
    ? ensureBootstrapAssets({ projectRoot, transaction: projectAssetTransaction })
    : {
        materializedRoot: null,
        materialized: false,
        idempotent: false,
        materializedPaths: [],
      };
  injectInitializationFailure(options, "after-asset-materialization");

  let loadedProfile = generatedBundledProfile
    ? resolveProjectProfileRuntimeMetadata({
        projectProfilePath,
        profileDocument: generatedBundledProfile.profile,
      })
    : loadProjectProfileForRuntime({ projectProfilePath });
  const runtimeRoot = canonicalizeRuntimeRoot(
    resolveRuntimeRoot({
      projectRoot,
      runtimeRootOverride: options.runtimeRoot,
      runtimeRootFromProfile: loadedProfile.runtimeRootFromProfile,
    }),
  );

  const runtimeLayout = resolveRuntimeLayout({
    runtimeRoot,
    projectId: loadedProfile.projectId,
  });
  if (fs.existsSync(runtimeLayout.projectRuntimeRoot) && fs.lstatSync(runtimeLayout.projectRuntimeRoot).isSymbolicLink()) {
    throw new Error(`Project runtime root '${runtimeLayout.projectRuntimeRoot}' must not be a symbolic link or junction.`);
  }
  const runtimeTransaction = createStagingRuntimeLayout(runtimeLayout);
  const stagingRuntimeLayout = runtimeTransaction.stagingLayout;
  try {
  injectInitializationFailure(options, "after-runtime-staging");

  if (generatedBundledProfile) {
    projectProfilePath = path.join(runtimeLayout.stateRoot, "project.aor.yaml");
    fs.writeFileSync(
      path.join(stagingRuntimeLayout.stateRoot, "project.aor.yaml"),
      stringifyYaml(generatedBundledProfile.profile),
      "utf8",
    );
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
  fs.writeFileSync(
    path.join(stagingRuntimeLayout.stateRoot, "project-init-state.json"),
    `${JSON.stringify(state, null, 2)}\n`,
    "utf8",
  );
  injectInitializationFailure(options, "after-state-write");

  const artifactPacket = materializeBootstrapArtifactPacket({
    projectId: loadedProfile.projectId,
    projectRoot,
    projectProfileRef: state.selected_profile_ref,
    runtimeLayout,
    outputRuntimeLayout: stagingRuntimeLayout,
    command: options.command ?? "aor project init",
  });
  injectInitializationFailure(options, "after-artifact-write");

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
  fs.writeFileSync(
    path.join(stagingRuntimeLayout.reportsRoot, "onboarding-report.json"),
    `${JSON.stringify(onboardingReport, null, 2)}\n`,
    "utf8",
  );
  injectInitializationFailure(options, "before-runtime-publish");
  publishStagedRuntime(runtimeLayout, runtimeTransaction, options);

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
  } catch (error) {
    cleanupOwnedStagingTree(runtimeTransaction);
    throw error;
  }
  } catch (error) {
    rollbackProjectAssetTransaction(projectAssetTransaction);
    throw error;
  }
}

/**
 * Resolve the local app project identity and runtime paths without creating
 * runtime directories or materializing generated profiles.
 *
 * @param {{
 *   cwd?: string,
 *   projectRef?: string,
 *   projectProfile?: string,
 *   runtimeRoot?: string,
 *   bootstrapTemplate?: string,
 *   repoBuildCommands?: string[],
 *   repoLintCommands?: string[],
 *   repoTestCommands?: string[],
 * }} options
 * @returns {{
 *   projectId: string,
 *   displayName: string,
 *   projectRoot: string,
 *   projectProfileRef: string,
 *   projectProfileSource: string,
 *   runtimeRoot: string,
 *   runtimeLayout: ReturnType<typeof resolveRuntimeLayout>,
 *   stateFile: string,
 *   onboardingReportFile: string,
 *   stateExists: boolean,
 *   onboardingReportExists: boolean,
 * }}
 */
export function previewProjectRuntime(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const projectRoot = discoverProjectRoot({ cwd, projectRef: options.projectRef });
  const projectProfilePath = resolveOptionalProjectProfilePath({
    cwd,
    projectRoot,
    projectProfile: options.projectProfile,
  });
  const generatedBundledProfile = projectProfilePath
    ? null
    : createBootstrapProjectProfile({
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
  const loadedProfile = generatedBundledProfile
    ? resolveProjectProfileRuntimeMetadata({
        projectProfilePath: "<generated-bundled-profile>",
        profileDocument: generatedBundledProfile.profile,
      })
    : loadProjectProfileForRuntime({ projectProfilePath });
  const runtimeRoot = resolveRuntimeRoot({
    projectRoot,
    runtimeRootOverride: options.runtimeRoot,
    runtimeRootFromProfile: loadedProfile.runtimeRootFromProfile,
  });
  const runtimeLayout = resolveRuntimeLayout({
    runtimeRoot,
    projectId: loadedProfile.projectId,
  });
  const stateFile = path.join(runtimeLayout.stateRoot, "project-init-state.json");
  const onboardingReportFile = path.join(runtimeLayout.reportsRoot, "onboarding-report.json");

  return {
    projectId: loadedProfile.projectId,
    displayName: loadedProfile.displayName,
    projectRoot,
    projectProfileRef: generatedBundledProfile
      ? "<generated-bundled-profile>"
      : toProjectRelativePath(projectRoot, loadedProfile.projectProfilePath),
    projectProfileSource: generatedBundledProfile
      ? "generated-bundled-preview"
      : typeof options.projectProfile === "string" && options.projectProfile.trim().length > 0
        ? "explicit"
        : "default-discovered",
    runtimeRoot,
    runtimeLayout,
    stateFile,
    onboardingReportFile,
    stateExists: fs.existsSync(stateFile),
    onboardingReportExists: fs.existsSync(onboardingReportFile),
  };
}
