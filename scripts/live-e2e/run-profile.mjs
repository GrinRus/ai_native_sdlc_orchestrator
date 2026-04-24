#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  parse as parseYaml,
  stringify as stringifyYaml,
} from "../../packages/contracts/node_modules/yaml/dist/index.js";

import { loadContractFile, validateContractDocument } from "../../packages/contracts/src/index.mjs";
import { materializeLearningLoopArtifacts } from "../../packages/observability/src/index.mjs";

const DEFAULT_STAGES = Object.freeze([
  "bootstrap",
  "discovery",
  "spec",
  "planning",
  "handoff",
  "execution",
  "review",
  "qa",
  "delivery",
  "release",
]);
const DEFAULT_BACKLOG_REFS = Object.freeze([
  "docs/backlog/mvp-implementation-backlog.md",
  "docs/backlog/mvp-roadmap.md",
  "docs/ops/live-e2e-standard-runner.md",
]);

class UsageError extends Error {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(message);
    this.name = "UsageError";
  }
}

/**
 * @returns {string}
 */
function nowIso() {
  return new Date().toISOString();
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeId(value) {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * @param {string} filePath
 * @param {Record<string, unknown>} document
 */
function writeJson(filePath, document) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
}

/**
 * @param {string} filePath
 * @returns {Record<string, unknown>}
 */
function readJson(filePath) {
  return /** @type {Record<string, unknown>} */ (JSON.parse(fs.readFileSync(filePath, "utf8")));
}

/**
 * @param {string} filePath
 * @returns {Record<string, unknown>}
 */
function readYamlDocument(filePath) {
  return /** @type {Record<string, unknown>} */ (parseYaml(fs.readFileSync(filePath, "utf8")));
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
 * @param {unknown} value
 * @returns {string}
 */
function asNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : "";
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function asStringArray(value) {
  return Array.isArray(value)
    ? value.filter((entry) => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim())
    : [];
}

/**
 * @param {string[]} values
 * @returns {string[]}
 */
function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))];
}

/**
 * @param {string[]} args
 * @returns {Record<string, string | true>}
 */
function parseFlags(args) {
  /** @type {Record<string, string | true>} */
  const flags = {};

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (!current.startsWith("--")) {
      throw new UsageError(`Unexpected argument '${current}'. Flags must use --name <value>.`);
    }

    const [rawName, inlineValue] = current.split("=", 2);
    const flagName = rawName.slice(2);
    if (!flagName) {
      throw new UsageError(`Invalid flag '${current}'.`);
    }
    if (Object.prototype.hasOwnProperty.call(flags, flagName)) {
      throw new UsageError(`Duplicate flag '--${flagName}'.`);
    }

    if (inlineValue !== undefined) {
      flags[flagName] = inlineValue;
      continue;
    }

    const next = args[index + 1];
    if (next && !next.startsWith("--")) {
      flags[flagName] = next;
      index += 1;
      continue;
    }

    flags[flagName] = true;
  }

  return flags;
}

/**
 * @param {string | true | undefined} value
 * @param {string} flagName
 * @returns {string | null}
 */
function resolveOptionalStringFlag(value, flagName) {
  if (value === undefined) {
    return null;
  }
  if (value === true) {
    throw new UsageError(`Flag '--${flagName}' requires a value.`);
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new UsageError(`Flag '--${flagName}' cannot be empty.`);
  }
  return normalized;
}

/**
 * @param {string | true | undefined} value
 * @param {string} flagName
 * @returns {boolean}
 */
function resolveOptionalBooleanFlag(value, flagName) {
  if (value === undefined) {
    return false;
  }
  if (value === true) {
    return true;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new UsageError(`Flag '--${flagName}' must be true or false.`);
}

/**
 * @param {string} filePath
 * @returns {boolean}
 */
function fileExists(filePath) {
  return fs.existsSync(filePath);
}

/**
 * @param {string} filePath
 * @returns {string}
 */
function requireDirectory(filePath) {
  const absolute = path.resolve(filePath);
  if (!fileExists(absolute)) {
    throw new UsageError(`Path '${filePath}' does not exist.`);
  }
  if (!fs.statSync(absolute).isDirectory()) {
    throw new UsageError(`Path '${filePath}' must be a directory.`);
  }
  return absolute;
}

/**
 * @param {string} hostRoot
 * @returns {string}
 */
function discoverHostProjectId(hostRoot) {
  const candidates = [
    path.join(hostRoot, "project.aor.yaml"),
    path.join(hostRoot, "examples/project.aor.yaml"),
    path.join(hostRoot, "examples/project.github.aor.yaml"),
  ];

  for (const candidate of candidates) {
    if (!fileExists(candidate)) {
      continue;
    }
    const loaded = loadContractFile({
      filePath: candidate,
      family: "project-profile",
    });
    if (!loaded.ok) {
      continue;
    }
    const document = asRecord(loaded.document);
    const projectId = asNonEmptyString(document.project_id);
    if (projectId) {
      return projectId;
    }
  }

  return normalizeId(path.basename(hostRoot)) || "aor";
}

/**
 * @param {{ hostRoot: string, runtimeRootOverride: string | null, hostProjectId: string }} options
 * @returns {{
 *   runtimeRoot: string,
 *   projectRuntimeRoot: string,
 *   reportsRoot: string,
 *   stateRoot: string,
 *   targetCheckoutsRoot: string,
 *   sessionsRoot: string,
 * }}
 */
function ensureRuntimeLayout(options) {
  const runtimeRoot = options.runtimeRootOverride
    ? path.isAbsolute(options.runtimeRootOverride)
      ? options.runtimeRootOverride
      : path.resolve(options.hostRoot, options.runtimeRootOverride)
    : path.join(options.hostRoot, ".aor");
  const projectRuntimeRoot = path.join(runtimeRoot, "projects", options.hostProjectId);
  const reportsRoot = path.join(projectRuntimeRoot, "reports");
  const stateRoot = path.join(projectRuntimeRoot, "state");
  const targetCheckoutsRoot = path.join(projectRuntimeRoot, "target-checkouts");
  const sessionsRoot = path.join(projectRuntimeRoot, "sessions");

  for (const dirPath of [runtimeRoot, projectRuntimeRoot, reportsRoot, stateRoot, targetCheckoutsRoot, sessionsRoot]) {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  return {
    runtimeRoot,
    projectRuntimeRoot,
    reportsRoot,
    stateRoot,
    targetCheckoutsRoot,
    sessionsRoot,
  };
}

/**
 * @param {{
 *   sessionsRoot: string,
 *   runId: string,
 * }} options
 */
function createSessionRoots(options) {
  const sessionRoot = path.join(options.sessionsRoot, normalizeId(options.runId));
  const aorHome = path.join(sessionRoot, "aor-home");
  const codexHome = path.join(sessionRoot, "codex-home");
  const tmpRoot = path.join(sessionRoot, "tmp");
  for (const dirPath of [sessionRoot, aorHome, codexHome, tmpRoot]) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  return {
    sessionRoot,
    aorHome,
    codexHome,
    tmpRoot,
  };
}

/**
 * @param {{ hostRoot: string, profileRef: string }} options
 */
function loadHarnessProfile(options) {
  const candidates = [
    path.resolve(process.cwd(), options.profileRef),
    path.resolve(options.hostRoot, options.profileRef),
  ];

  for (const candidate of candidates) {
    if (fileExists(candidate)) {
      return {
        profilePath: candidate,
        profile: readYamlDocument(candidate),
      };
    }
  }

  throw new UsageError(`Profile '${options.profileRef}' was not found from cwd or host project root.`);
}

/**
 * @param {{ hostRoot: string, catalogRootOverride: string | null }} options
 * @returns {string}
 */
function resolveCatalogRoot(options) {
  const candidate = options.catalogRootOverride
    ? path.isAbsolute(options.catalogRootOverride)
      ? options.catalogRootOverride
      : path.resolve(options.hostRoot, options.catalogRootOverride)
    : path.join(options.hostRoot, "scripts/live-e2e/catalog");
  if (!fileExists(candidate) || !fs.statSync(candidate).isDirectory()) {
    throw new UsageError(`Catalog root '${candidate}' was not found.`);
  }
  return candidate;
}

/**
 * @param {{ catalogRoot: string, targetCatalogId: string }} options
 */
function loadCatalogTarget(options) {
  const filePath = path.join(options.catalogRoot, "targets", `${normalizeId(options.targetCatalogId)}.yaml`);
  if (!fileExists(filePath)) {
    throw new UsageError(`Target catalog '${options.targetCatalogId}' was not found under '${options.catalogRoot}/targets'.`);
  }
  return {
    filePath,
    entry: readYamlDocument(filePath),
  };
}

/**
 * @param {Record<string, unknown>} profile
 * @returns {boolean}
 */
function isFullJourneyProfile(profile) {
  return asNonEmptyString(profile.journey_mode) === "full-journey" || asNonEmptyString(profile.target_catalog_id).length > 0;
}

/**
 * @param {{
 *   profile: Record<string, unknown>,
 *   catalogRoot: string,
 * }} options
 */
function resolveFullJourneyProfile(options) {
  const rawTargetRepo = asRecord(options.profile.target_repo);
  if (asNonEmptyString(rawTargetRepo.repo_url)) {
    throw new UsageError("Full-journey profiles must resolve target repos from target_catalog_id, not raw target_repo.repo_url.");
  }

  const targetCatalogId = asNonEmptyString(options.profile.target_catalog_id);
  const featureMissionId = asNonEmptyString(options.profile.feature_mission_id);
  if (!targetCatalogId) {
    throw new UsageError("Full-journey profiles require target_catalog_id.");
  }
  if (!featureMissionId) {
    throw new UsageError("Full-journey profiles require feature_mission_id.");
  }

  const catalogTarget = loadCatalogTarget({
    catalogRoot: options.catalogRoot,
    targetCatalogId,
  });
  const catalogEntry = asRecord(catalogTarget.entry);
  const missions = Array.isArray(catalogEntry.feature_missions)
    ? /** @type {Array<Record<string, unknown>>} */ (catalogEntry.feature_missions)
    : [];
  const mission = missions.find((candidate) => asNonEmptyString(candidate.mission_id) === featureMissionId);
  if (!mission) {
    throw new UsageError(`Feature mission '${featureMissionId}' was not found in catalog '${targetCatalogId}'.`);
  }

  const resolvedProfile = /** @type {Record<string, unknown>} */ (JSON.parse(JSON.stringify(options.profile)));
  resolvedProfile.target_repo = asRecord(JSON.parse(JSON.stringify(asRecord(catalogEntry.repo))));
  resolvedProfile.verification = {
    ...asRecord(catalogEntry.verification),
    ...asRecord(options.profile.verification),
  };
  resolvedProfile.output_policy = {
    ...asRecord(catalogEntry.safety_defaults),
    ...asRecord(options.profile.output_policy),
  };
  resolvedProfile.target_catalog_ref = catalogTarget.filePath;
  resolvedProfile.feature_mission_ref = `${catalogTarget.filePath}#${featureMissionId}`;
  return {
    resolvedProfile,
    catalogTargetPath: catalogTarget.filePath,
    catalogEntry,
    mission,
  };
}

/**
 * @param {{
 *   targetCheckoutRoot: string,
 *   mission: Record<string, unknown>,
 *   runId: string,
 * }} options
 */
function materializeFeatureRequestFile(options) {
  const requestsRoot = path.join(options.targetCheckoutRoot, ".aor", "requests");
  fs.mkdirSync(requestsRoot, { recursive: true });
  const missionId = asNonEmptyString(options.mission.mission_id) || "feature-mission";
  const filePath = path.join(requestsRoot, `feature-request-${normalizeId(options.runId)}-${normalizeId(missionId)}.json`);
  const requestDocument = {
    mission_id: missionId,
    title: asNonEmptyString(options.mission.title) || missionId,
    brief: asNonEmptyString(options.mission.brief) || "Catalog-backed full-journey feature request.",
    allowed_paths: asStringArray(options.mission.allowed_paths),
    forbidden_paths: asStringArray(options.mission.forbidden_paths),
    expected_evidence: asStringArray(options.mission.expected_evidence),
    acceptance_checks: asStringArray(options.mission.acceptance_checks),
    change_budget: asRecord(options.mission.change_budget),
  };
  writeJson(filePath, requestDocument);
  return {
    requestFile: filePath,
    requestDocument,
  };
}

/**
 * @param {Record<string, unknown>} profile
 * @returns {string[]}
 */
function getProfileStages(profile) {
  const stages = asStringArray(profile.stages);
  return stages.length > 0 ? stages : [...DEFAULT_STAGES];
}

/**
 * @param {string[]} stages
 * @returns {Record<string, { stage: string, status: string, evidence_refs: string[], summary: string | null }>}
 */
function createStageMap(stages) {
  /** @type {Record<string, { stage: string, status: string, evidence_refs: string[], summary: string | null }>} */
  const map = {};
  for (const stage of stages) {
    map[stage] = {
      stage,
      status: "pending",
      evidence_refs: [],
      summary: null,
    };
  }
  return map;
}

/**
 * @param {Record<string, { stage: string, status: string, evidence_refs: string[], summary: string | null }>} stageMap
 * @param {string} stage
 * @param {string} status
 * @param {string[]} [evidenceRefs]
 * @param {string | null} [summary]
 */
function markStage(stageMap, stage, status, evidenceRefs = [], summary = null) {
  if (!stageMap[stage]) {
    stageMap[stage] = {
      stage,
      status,
      evidence_refs: uniqueStrings(evidenceRefs),
      summary,
    };
    return;
  }
  stageMap[stage].status = status;
  stageMap[stage].evidence_refs = uniqueStrings(evidenceRefs);
  stageMap[stage].summary = summary;
}

/**
 * @param {Record<string, { stage: string, status: string, evidence_refs: string[], summary: string | null }>} stageMap
 * @returns {Array<{ stage: string, status: string, evidence_refs: string[], summary: string | null }>}
 */
function flattenStageMap(stageMap) {
  return Object.values(stageMap);
}

/**
 * @param {Array<{ stage: string, status: string, evidence_refs: string[], summary: string | null }>} stageResults
 */
function summarizeStageCounts(stageResults) {
  let pass = 0;
  let fail = 0;
  let pending = 0;
  let skipped = 0;
  for (const stage of stageResults) {
    if (stage.status === "pass") pass += 1;
    else if (stage.status === "fail") fail += 1;
    else if (stage.status === "skipped") skipped += 1;
    else pending += 1;
  }
  return { pass, fail, pending, skipped };
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function isRemoteGitUrl(value) {
  return /^([a-z][a-z0-9+.-]*:\/\/|git@)/iu.test(value);
}

/**
 * @param {{ cwd: string, args: string[], operation: string }} options
 */
function runGitChecked(options) {
  const run = spawnSync("git", options.args, {
    cwd: options.cwd,
    encoding: "utf8",
  });
  if (run.status === 0) {
    return;
  }
  const stderr = (run.stderr ?? run.stdout ?? "").trim();
  throw new Error(
    `Installed-user rehearsal ${options.operation} failed: git ${options.args.join(" ")} (exit ${run.status ?? -1}). ${stderr}`,
  );
}

/**
 * @param {{
 *   targetRoot: string,
 *   liveRoot: string,
 *   relativePath: string,
 * }} options
 */
function backupPathIfExists(options) {
  const candidate = path.join(options.targetRoot, options.relativePath);
  if (!fileExists(candidate)) {
    return null;
  }
  const backupPath = path.join(options.liveRoot, options.relativePath.replace(/[\\/]/g, "-"));
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.renameSync(candidate, backupPath);
  return backupPath;
}

/**
 * @param {{
 *   hostRoot: string,
 *   layout: ReturnType<typeof ensureRuntimeLayout>,
 *   runId: string,
 *   profile: Record<string, unknown>,
 * }}
 */
function materializeTargetCheckout(options) {
  const targetRepo = asRecord(options.profile.target_repo);
  const targetRepoUrl = asNonEmptyString(targetRepo.repo_url);
  const targetRepoRef = asNonEmptyString(targetRepo.ref) || "main";
  const targetRepoId = asNonEmptyString(targetRepo.repo_id) || "target";
  const checkoutStrategy = asNonEmptyString(targetRepo.checkout_strategy) || "full";
  if (!targetRepoUrl) {
    throw new Error("Harness profile must declare target_repo.repo_url.");
  }

  const targetCheckoutRoot = path.join(
    options.layout.targetCheckoutsRoot,
    `${normalizeId(targetRepoId)}-${normalizeId(options.runId)}`,
  );
  fs.rmSync(targetCheckoutRoot, { recursive: true, force: true });

  /** @type {string[]} */
  const cloneArgs = ["clone"];
  if (checkoutStrategy === "shallow" && isRemoteGitUrl(targetRepoUrl)) {
    cloneArgs.push("--depth", "1");
  }
  cloneArgs.push("--branch", targetRepoRef, "--single-branch", targetRepoUrl, targetCheckoutRoot);
  runGitChecked({
    cwd: options.hostRoot,
    args: cloneArgs,
    operation: "target checkout clone",
  });
  runGitChecked({
    cwd: targetCheckoutRoot,
    args: ["checkout", targetRepoRef],
    operation: "target checkout ref resolution",
  });

  return {
    targetCheckoutRoot,
    targetRepoId,
    targetRepoRef,
    targetRepoUrl,
  };
}

/**
 * @param {{
 *   hostRoot: string,
 *   examplesRoot: string,
 *   targetCheckoutRoot: string,
 * }} options
 */
function materializeTargetAssets(options) {
  const liveRoot = path.join(options.targetCheckoutRoot, ".aor-live-e2e");
  fs.mkdirSync(liveRoot, { recursive: true });
  backupPathIfExists({
    targetRoot: options.targetCheckoutRoot,
    liveRoot,
    relativePath: "examples",
  });
  backupPathIfExists({
    targetRoot: options.targetCheckoutRoot,
    liveRoot,
    relativePath: "project.aor.yaml",
  });
  backupPathIfExists({
    targetRoot: options.targetCheckoutRoot,
    liveRoot,
    relativePath: "context",
  });
  fs.cpSync(options.examplesRoot, path.join(options.targetCheckoutRoot, "examples"), { recursive: true });
  const examplesContextRoot = path.join(options.examplesRoot, "context");
  if (fileExists(examplesContextRoot)) {
    fs.cpSync(examplesContextRoot, path.join(options.targetCheckoutRoot, "context"), { recursive: true });
  }
  return {
    liveRoot,
    copiedExamplesRoot: path.join(options.targetCheckoutRoot, "examples"),
    copiedContextRoot: fileExists(examplesContextRoot) ? path.join(options.targetCheckoutRoot, "context") : null,
  };
}

/**
 * @param {Record<string, unknown>} repoRecord
 * @param {Record<string, unknown>} verification
 */
function hydrateRepoVerificationCommands(repoRecord, verification) {
  const setupCommands = asStringArray(verification.setup_commands);
  const verificationCommands = asStringArray(verification.commands);
  const buildEnabled = verification.build === true;
  const lintEnabled = verification.lint === true;
  const testsEnabled = verification.tests !== false;

  repoRecord.build_commands = buildEnabled ? verificationCommands : [];
  repoRecord.lint_commands = lintEnabled ? setupCommands : [];
  repoRecord.test_commands = testsEnabled ? verificationCommands : [];
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeDeliveryMode(value) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "patch") return "patch-only";
  if (normalized === "pull-request") return "fork-first-pr";
  if (normalized === "patch-only") return "patch-only";
  if (normalized === "local-branch") return "local-branch";
  if (normalized === "fork-first-pr") return "fork-first-pr";
  return "no-write";
}

/**
 * @param {{
 *   hostRoot: string,
 *   profilePath: string,
 *   profile: Record<string, unknown>,
 *   runId: string,
 *   targetCheckout: ReturnType<typeof materializeTargetCheckout>,
 * }} options
 */
function materializeGeneratedProjectProfile(options) {
  const templateRef = asNonEmptyString(options.profile.project_profile_template_ref);
  if (!templateRef) {
    throw new Error("Harness profile must declare project_profile_template_ref.");
  }

  const candidates = [
    path.resolve(path.dirname(options.profilePath), templateRef),
    path.resolve(options.hostRoot, templateRef),
    path.resolve(process.cwd(), templateRef),
  ];
  const templateProjectProfilePath = candidates.find((candidate) => fileExists(candidate));
  if (!templateProjectProfilePath) {
    throw new Error(`Project profile template '${templateRef}' was not found.`);
  }

  const loadedTemplate = loadContractFile({
    filePath: templateProjectProfilePath,
    family: "project-profile",
  });
  if (!loadedTemplate.ok) {
    const issues = loadedTemplate.validation.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Project profile template '${templateProjectProfilePath}' failed validation: ${issues}`);
  }

  const generatedProjectProfile = asRecord(JSON.parse(JSON.stringify(loadedTemplate.document)));
  generatedProjectProfile.project_id =
    `${asNonEmptyString(generatedProjectProfile.project_id) || "installed-user-target"}.run.${normalizeId(options.runId)}`;
  generatedProjectProfile.display_name =
    `${asNonEmptyString(generatedProjectProfile.display_name) || "Installed User Target"} (${options.targetCheckout.targetRepoId})`;
  delete generatedProjectProfile.live_e2e_defaults;

  const repos = Array.isArray(generatedProjectProfile.repos)
    ? /** @type {Array<Record<string, unknown>>} */ (JSON.parse(JSON.stringify(generatedProjectProfile.repos)))
    : [];
  const selectedRepo = asRecord(repos[0] ?? {});
  selectedRepo.repo_id = options.targetCheckout.targetRepoId;
  selectedRepo.name = options.targetCheckout.targetRepoId;
  selectedRepo.default_branch = options.targetCheckout.targetRepoRef;
  selectedRepo.role = asNonEmptyString(selectedRepo.role) || "application";
  selectedRepo.source = {
    kind: "local",
    root: ".",
  };
  hydrateRepoVerificationCommands(selectedRepo, asRecord(options.profile.verification));
  generatedProjectProfile.repos = [selectedRepo];

  const runtimeDefaults = asRecord(generatedProjectProfile.runtime_defaults);
  runtimeDefaults.runtime_root = ".aor";
  runtimeDefaults.workspace_mode = asNonEmptyString(asRecord(options.profile.runtime).mode) || "ephemeral";
  generatedProjectProfile.runtime_defaults = runtimeDefaults;

  const writebackPolicy = asRecord(generatedProjectProfile.writeback_policy);
  writebackPolicy.default_delivery_mode = normalizeDeliveryMode(
    asNonEmptyString(asRecord(options.profile.output_policy).preferred_delivery_mode) || "patch-only",
  );
  generatedProjectProfile.writeback_policy = writebackPolicy;

  const generatedProjectProfileFile = path.join(options.targetCheckout.targetCheckoutRoot, "project.aor.yaml");
  const validation = validateContractDocument({
    family: "project-profile",
    document: generatedProjectProfile,
    source: `runtime://installed-user-profile/${normalizeId(options.runId)}`,
  });
  if (!validation.ok) {
    const issues = validation.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Generated project profile failed validation: ${issues}`);
  }

  fs.writeFileSync(generatedProjectProfileFile, stringifyYaml(generatedProjectProfile), "utf8");

  return {
    generatedProjectProfileFile,
    templateProjectProfilePath,
  };
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function looksLikeEvidenceRef(value) {
  return (
    value.startsWith("evidence://") ||
    value.startsWith("compiled-context://") ||
    value.includes("/") ||
    value.includes("\\") ||
    /\.(json|jsonl|yaml|yml|patch|log)$/iu.test(value)
  );
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function collectStringRefs(value) {
  if (typeof value === "string") {
    return looksLikeEvidenceRef(value.trim()) ? [value.trim()] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectStringRefs(entry));
  }
  if (typeof value === "object" && value !== null) {
    return Object.values(value).flatMap((entry) => collectStringRefs(entry));
  }
  return [];
}

/**
 * @param {string} label
 * @returns {string}
 */
function normalizeLabel(label) {
  return label.replace(/[^a-z0-9]+/giu, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

/**
 * @param {{ hostRoot: string, aorBinOverride: string | null }} options
 */
function resolveAorLaunch(options) {
  const selected = options.aorBinOverride
    ? path.isAbsolute(options.aorBinOverride)
      ? options.aorBinOverride
      : path.resolve(options.hostRoot, options.aorBinOverride)
    : path.join(options.hostRoot, "apps/cli/bin/aor.mjs");
  const extension = path.extname(selected).toLowerCase();
  if (extension === ".js" || extension === ".mjs" || extension === ".cjs") {
    return {
      command: process.execPath,
      argsPrefix: [selected],
      binaryRef: selected,
    };
  }
  return {
    command: selected,
    argsPrefix: [],
    binaryRef: selected,
  };
}

/**
 * @param {{
 *   launch: ReturnType<typeof resolveAorLaunch>,
 *   cwd: string,
 *   args: string[],
 *   env: NodeJS.ProcessEnv,
 *   transcriptsRoot: string,
 *   label: string,
 *   index: number,
 * }}
 */
function runAorCommand(options) {
  const startedAt = nowIso();
  const run = spawnSync(options.launch.command, [...options.launch.argsPrefix, ...options.args], {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
  });
  const finishedAt = nowIso();
  const transcriptFile = path.join(
    options.transcriptsRoot,
    `${String(options.index).padStart(2, "0")}-${normalizeLabel(options.label)}.json`,
  );
  /** @type {Record<string, unknown> | null} */
  let parsed = null;
  if ((run.stdout ?? "").trim().length > 0) {
    try {
      parsed = /** @type {Record<string, unknown>} */ (JSON.parse(run.stdout));
    } catch {
      parsed = null;
    }
  }
  const transcript = {
    label: options.label,
    cwd: options.cwd,
    command: options.launch.command,
    args: [...options.launch.argsPrefix, ...options.args],
    exit_code: run.status ?? -1,
    stdout: run.stdout ?? "",
    stderr: run.stderr ?? "",
    parsed_json: parsed,
    started_at: startedAt,
    finished_at: finishedAt,
  };
  writeJson(transcriptFile, transcript);
  return {
    ok: run.status === 0 && parsed !== null,
    exitCode: run.status ?? -1,
    stdout: run.stdout ?? "",
    stderr: run.stderr ?? "",
    payload: parsed,
    transcriptFile,
    commandSurface:
      options.args.length >= 2 ? `aor ${options.args[0]} ${options.args[1]}` : `aor ${options.args.join(" ")}`.trim(),
  };
}

/**
 * @param {Record<string, unknown> | null} payload
 * @param {string} field
 * @returns {string | null}
 */
function getStringField(payload, field) {
  if (!payload) return null;
  const value = payload[field];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/**
 * @param {Record<string, unknown> | null} payload
 * @param {string} field
 * @returns {string[]}
 */
function getStringArrayField(payload, field) {
  if (!payload) return [];
  return asStringArray(payload[field]);
}

/**
 * @param {Record<string, unknown>} profile
 * @returns {string[]}
 */
function getBacklogRefs(profile) {
  const learningLoop = asRecord(profile.learning_loop);
  const refs = asStringArray(learningLoop.backlog_refs);
  return refs.length > 0 ? refs : [...DEFAULT_BACKLOG_REFS];
}

/**
 * @param {Record<string, unknown>} profile
 */
function shouldIncludeApprovedHandoff(profile) {
  const liveExecution = asRecord(profile.live_execution);
  if (liveExecution.include_approved_handoff === false) {
    return false;
  }
  return true;
}

/**
 * @param {Record<string, unknown>} profile
 */
function shouldIncludePromotionEvidence(profile) {
  const liveExecution = asRecord(profile.live_execution);
  if (liveExecution.include_promotion_evidence === false) {
    return false;
  }
  return true;
}

/**
 * @param {Record<string, unknown>} profile
 */
function getHarnessCertification(profile) {
  const harness = asRecord(asRecord(profile.verification).harness);
  if (harness.enabled !== true) {
    return null;
  }
  return {
    assetRef: asNonEmptyString(harness.asset_ref) || "wrapper://wrapper.eval.default@v1",
    subjectRef: asNonEmptyString(harness.subject_ref) || "wrapper://wrapper.eval.default@v1",
    suiteRef: asNonEmptyString(harness.suite_ref) || "suite.cert.core@v4",
    stepClass: asNonEmptyString(harness.step_class) || "implement",
  };
}

/**
 * @param {Record<string, unknown>} profile
 * @returns {string}
 */
function getPreferredDeliveryMode(profile) {
  return normalizeDeliveryMode(
    asNonEmptyString(asRecord(profile.output_policy).preferred_delivery_mode) || "patch-only",
  );
}

/**
 * @param {Record<string, unknown>} profile
 * @returns {string[]}
 */
function getEvalSuites(profile) {
  return asStringArray(asRecord(profile.verification).eval_suites);
}

/**
 * @param {unknown} value
 * @returns {"pass" | "warn" | "fail"}
 */
function normalizeVerdictStatus(value) {
  const normalized = asNonEmptyString(value).toLowerCase();
  if (normalized === "fail") return "fail";
  if (normalized === "warn") return "warn";
  return "pass";
}

/**
 * @param {{
 *   hostRoot: string,
 *   layout: ReturnType<typeof ensureRuntimeLayout>,
 *   runId: string,
 *   profilePath: string,
 *   profile: Record<string, unknown>,
 *   aorLaunch: ReturnType<typeof resolveAorLaunch>,
 *   examplesRoot: string,
 * }}
 */
function executeInstalledUserFlow(options) {
  const stageMap = createStageMap(getProfileStages(options.profile));
  const commandResults = [];
  const transcriptsRoot = path.join(options.layout.reportsRoot, `live-e2e-command-traces-${normalizeId(options.runId)}`);
  fs.mkdirSync(transcriptsRoot, { recursive: true });
  const sessionRoots = createSessionRoots({
    sessionsRoot: options.layout.sessionsRoot,
    runId: options.runId,
  });
  const env = {
    ...process.env,
    AOR_HOME: sessionRoots.aorHome,
    CODEX_HOME: sessionRoots.codexHome,
    TMPDIR: sessionRoots.tmpRoot,
  };

  const artifacts = {
    host_runtime_root: options.layout.runtimeRoot,
    host_reports_root: options.layout.reportsRoot,
    session_root: sessionRoots.sessionRoot,
    aor_home: sessionRoots.aorHome,
    codex_home: sessionRoots.codexHome,
  };
  const startedAt = nowIso();
  try {
    const targetCheckout = materializeTargetCheckout({
      hostRoot: options.hostRoot,
      layout: options.layout,
      runId: options.runId,
      profile: options.profile,
    });
    artifacts.target_checkout_root = targetCheckout.targetCheckoutRoot;
    artifacts.target_repo_ref = targetCheckout.targetRepoRef;
    artifacts.target_repo_url = targetCheckout.targetRepoUrl;

    const targetAssets = materializeTargetAssets({
      hostRoot: options.hostRoot,
      examplesRoot: options.examplesRoot,
      targetCheckoutRoot: targetCheckout.targetCheckoutRoot,
    });
    artifacts.target_examples_root = targetAssets.copiedExamplesRoot;
    artifacts.target_context_root = targetAssets.copiedContextRoot;

    const generatedProfile = materializeGeneratedProjectProfile({
      hostRoot: options.hostRoot,
      profilePath: options.profilePath,
      profile: options.profile,
      runId: options.runId,
      targetCheckout,
    });
    artifacts.generated_project_profile_file = generatedProfile.generatedProjectProfileFile;
    artifacts.project_profile_template_file = generatedProfile.templateProjectProfilePath;
    markStage(
      stageMap,
      "bootstrap",
      "pass",
      [generatedProfile.generatedProjectProfileFile],
      "Target checkout cloned and AOR assets materialized.",
    );

    const commandBaseArgs = ["--project-ref", ".", "--project-profile", "./project.aor.yaml"];
    let commandIndex = 1;
    const runCommand = (label, args) => {
      const result = runAorCommand({
        launch: options.aorLaunch,
        cwd: targetCheckout.targetCheckoutRoot,
        args,
        env,
        transcriptsRoot,
        label,
        index: commandIndex,
      });
      commandIndex += 1;
      commandResults.push({
        label,
        command_surface: result.commandSurface,
        exit_code: result.exitCode,
        transcript_file: result.transcriptFile,
      });
      if (!result.ok) {
        const stderr = result.stderr.trim() || result.stdout.trim() || "command failed";
        throw new Error(`Public CLI command '${label}' failed: ${stderr}`);
      }
      return result;
    };

    const analyze = runCommand("project-analyze", ["project", "analyze", ...commandBaseArgs]);
    Object.assign(artifacts, {
      analysis_report_file: getStringField(analyze.payload, "analysis_report_file"),
      route_resolution_file: getStringField(analyze.payload, "route_resolution_file"),
      asset_resolution_file: getStringField(analyze.payload, "asset_resolution_file"),
      policy_resolution_file: getStringField(analyze.payload, "policy_resolution_file"),
      evaluation_registry_file: getStringField(analyze.payload, "evaluation_registry_file"),
    });
    markStage(
      stageMap,
      "discovery",
      "pass",
      uniqueStrings([analyze.transcriptFile, ...collectStringRefs(analyze.payload)]),
      "Project analysis completed through the public CLI.",
    );

    const validate = runCommand("project-validate", ["project", "validate", ...commandBaseArgs]);
    artifacts.validation_report_file = getStringField(validate.payload, "validation_report_file");
    const validationStatus = getStringField(validate.payload, "validation_status") || "unknown";
    if (validationStatus === "fail") {
      markStage(
        stageMap,
        "spec",
        "fail",
        uniqueStrings([validate.transcriptFile, ...collectStringRefs(validate.payload)]),
        "Project validation failed.",
      );
      throw new Error("Project validation failed.");
    }
    markStage(
      stageMap,
      "spec",
      "pass",
      uniqueStrings([validate.transcriptFile, ...collectStringRefs(validate.payload)]),
      "Project validation completed.",
    );

    const handoffPrepare = runCommand("handoff-prepare", [
      "handoff",
      "prepare",
      ...commandBaseArgs,
      "--ticket-id",
      `${options.runId}.ticket`,
    ]);
    artifacts.handoff_packet_file = getStringField(handoffPrepare.payload, "handoff_packet_file");
    artifacts.wave_ticket_file = getStringField(handoffPrepare.payload, "wave_ticket_file");
    markStage(
      stageMap,
      "planning",
      "pass",
      uniqueStrings([handoffPrepare.transcriptFile, ...collectStringRefs(handoffPrepare.payload)]),
      "Handoff packet prepared through the public CLI.",
    );

    const handoffApprove = runCommand("handoff-approve", [
      "handoff",
      "approve",
      "--project-ref",
      ".",
      "--handoff-packet",
      /** @type {string} */ (artifacts.handoff_packet_file),
      "--approval-ref",
      `approval://installed-user-live-e2e/${normalizeId(options.runId)}`,
    ]);
    artifacts.approved_handoff_packet_file = getStringField(handoffApprove.payload, "handoff_packet_file");
    markStage(
      stageMap,
      "handoff",
      "pass",
      uniqueStrings([handoffApprove.transcriptFile, ...collectStringRefs(handoffApprove.payload)]),
      "Handoff packet approved.",
    );

    const verifyPreflight = runCommand("project-verify-preflight", [
      "project",
      "verify",
      ...commandBaseArgs,
      "--require-validation-pass",
      "true",
    ]);
    artifacts.verify_summary_file = getStringField(verifyPreflight.payload, "verify_summary_file");
    artifacts.preflight_step_result_files = getStringArrayField(verifyPreflight.payload, "step_result_files");
    const verifySummaryPath = /** @type {string} */ (artifacts.verify_summary_file);
    if (!verifySummaryPath || !fileExists(verifySummaryPath)) {
      throw new Error("Preflight verify summary was not materialized.");
    }
    const verifySummary = readJson(verifySummaryPath);
    if (verifySummary.status === "failed") {
      markStage(
        stageMap,
        "execution",
        "fail",
        uniqueStrings([verifyPreflight.transcriptFile, verifySummaryPath, ...collectStringRefs(verifyPreflight.payload)]),
        "Preflight verify failed before live execution.",
      );
      throw new Error("Preflight verify failed before live execution.");
    }

    const promotionRefsForLiveExecution = shouldIncludePromotionEvidence(options.profile)
      ? uniqueStrings([verifySummaryPath, ...asStringArray(artifacts.preflight_step_result_files)])
      : [];
    const routedLiveArgs = [
      "project",
      "verify",
      ...commandBaseArgs,
      "--require-validation-pass",
      "true",
      "--routed-live-step",
      "implement",
    ];
    if (shouldIncludeApprovedHandoff(options.profile) && artifacts.approved_handoff_packet_file) {
      routedLiveArgs.push("--approved-handoff-ref", /** @type {string} */ (artifacts.approved_handoff_packet_file));
    }
    if (promotionRefsForLiveExecution.length > 0) {
      routedLiveArgs.push("--promotion-evidence-refs", promotionRefsForLiveExecution.join(","));
    }
    const routedLive = runCommand("project-verify-routed-live", routedLiveArgs);
    artifacts.routed_verify_summary_file = getStringField(routedLive.payload, "verify_summary_file");
    artifacts.routed_step_result_file = getStringField(routedLive.payload, "routed_step_result_file");
    artifacts.routed_step_result_id = getStringField(routedLive.payload, "routed_step_result_id");
    const routedStepResultPath = /** @type {string} */ (artifacts.routed_step_result_file);
    if (!routedStepResultPath || !fileExists(routedStepResultPath)) {
      throw new Error("Routed live step-result was not materialized.");
    }
    const routedStepResult = readJson(routedStepResultPath);
    const routedExecution = asRecord(routedStepResult.routed_execution);
    const adapterResponse = asRecord(routedExecution.adapter_response);
    const adapterOutput = asRecord(adapterResponse.output);
    artifacts.compiled_context_ref = asNonEmptyString(asRecord(routedExecution.context_compilation).compiled_context_ref) || null;
    artifacts.compiled_context_file = asNonEmptyString(asRecord(routedExecution.context_compilation).compiled_context_file) || null;
    artifacts.adapter_raw_evidence_ref = asNonEmptyString(asRecord(adapterOutput.external_runner).raw_evidence_ref) || null;
    const routedStatus = asNonEmptyString(routedStepResult.status);
    if (routedStatus !== "passed") {
      const failureSummary =
        asNonEmptyString(routedStepResult.summary) ||
        asNonEmptyString(adapterResponse.summary) ||
        "Routed live execution failed.";
      markStage(
        stageMap,
        "execution",
        "fail",
        uniqueStrings([routedLive.transcriptFile, routedStepResultPath, ...collectStringRefs(routedStepResult)]),
        failureSummary,
      );
      throw new Error(failureSummary);
    }
    markStage(
      stageMap,
      "execution",
      "pass",
      uniqueStrings([
        verifyPreflight.transcriptFile,
        verifySummaryPath,
        routedLive.transcriptFile,
        routedStepResultPath,
        ...collectStringRefs(routedStepResult),
      ]),
      "Preflight verify and routed live execution passed.",
    );

    /** @type {string[]} */
    const promotionEvidenceRefs = [routedStepResultPath];

    const evalSuites = getEvalSuites(options.profile);
    if (evalSuites.length > 0) {
      const evalRun = runCommand("eval-run", [
        "eval",
        "run",
        ...commandBaseArgs,
        "--suite-ref",
        evalSuites[0],
        "--subject-ref",
        `run://${options.runId}`,
      ]);
      artifacts.evaluation_report_file = getStringField(evalRun.payload, "evaluation_report_file");
      const evaluationStatus = getStringField(evalRun.payload, "evaluation_status") || "unknown";
      if (artifacts.evaluation_report_file) {
        promotionEvidenceRefs.push(/** @type {string} */ (artifacts.evaluation_report_file));
      }
      if (evaluationStatus !== "pass") {
        markStage(
          stageMap,
          "qa",
          "fail",
          uniqueStrings([evalRun.transcriptFile, ...collectStringRefs(evalRun.payload)]),
          "Evaluation report failed.",
        );
        throw new Error("Evaluation report failed.");
      }
      markStage(
        stageMap,
        "qa",
        "pass",
        uniqueStrings([evalRun.transcriptFile, ...collectStringRefs(evalRun.payload)]),
        "Eval run passed.",
      );
      if (getHarnessCertification(options.profile) === null) {
        markStage(
          stageMap,
          "review",
          "pass",
          uniqueStrings([evalRun.transcriptFile, ...collectStringRefs(evalRun.payload)]),
          "Review reused evaluation evidence.",
        );
      }
    } else {
      markStage(stageMap, "qa", "skipped", [], "Profile has no eval suites.");
    }

    const harnessCertification = getHarnessCertification(options.profile);
    if (harnessCertification) {
      const certify = runCommand("harness-certify", [
        "harness",
        "certify",
        ...commandBaseArgs,
        "--asset-ref",
        harnessCertification.assetRef,
        "--subject-ref",
        harnessCertification.subjectRef,
        "--suite-ref",
        harnessCertification.suiteRef,
        "--step-class",
        harnessCertification.stepClass,
      ]);
      artifacts.promotion_decision_file = getStringField(certify.payload, "promotion_decision_file");
      artifacts.certification_evaluation_report_file = getStringField(certify.payload, "certification_evaluation_report_file");
      artifacts.certification_harness_capture_file = getStringField(certify.payload, "certification_harness_capture_file");
      artifacts.certification_harness_replay_file = getStringField(certify.payload, "certification_harness_replay_file");
      const promotionStatus = getStringField(certify.payload, "promotion_decision_status") || "unknown";
      if (artifacts.promotion_decision_file) {
        promotionEvidenceRefs.push(/** @type {string} */ (artifacts.promotion_decision_file));
      }
      if (promotionStatus !== "pass") {
        markStage(
          stageMap,
          "review",
          "fail",
          uniqueStrings([certify.transcriptFile, ...collectStringRefs(certify.payload)]),
          "Harness certification did not pass.",
        );
        throw new Error("Harness certification did not pass.");
      }
      markStage(
        stageMap,
        "review",
        "pass",
        uniqueStrings([certify.transcriptFile, ...collectStringRefs(certify.payload)]),
        "Harness certification passed.",
      );
    } else if (stageMap.review?.status === "pending") {
      markStage(stageMap, "review", "skipped", [], "Profile has no harness certification step.");
    }

    if (asRecord(options.profile.output_policy).materialize_release_packet === true) {
      const releaseArgs = [
        "release",
        "prepare",
        ...commandBaseArgs,
        "--run-id",
        options.runId,
        "--step-class",
        "implement",
        "--mode",
        getPreferredDeliveryMode(options.profile),
      ];
      if (artifacts.approved_handoff_packet_file) {
        releaseArgs.push("--approved-handoff-ref", /** @type {string} */ (artifacts.approved_handoff_packet_file));
      }
      if (promotionEvidenceRefs.length > 0) {
        releaseArgs.push("--promotion-evidence-refs", uniqueStrings(promotionEvidenceRefs).join(","));
      }
      const release = runCommand("release-prepare", releaseArgs);
      Object.assign(artifacts, {
        delivery_plan_file: getStringField(release.payload, "delivery_plan_file"),
        delivery_manifest_file: getStringField(release.payload, "delivery_manifest_file"),
        release_packet_file: getStringField(release.payload, "release_packet_file"),
        delivery_transcript_file: getStringField(release.payload, "delivery_transcript_file"),
        delivery_mode: getStringField(release.payload, "delivery_mode"),
        release_packet_status: getStringField(release.payload, "release_packet_status"),
      });
      if (release.payload?.delivery_blocking === true || !artifacts.release_packet_file) {
        markStage(
          stageMap,
          "delivery",
          "fail",
          uniqueStrings([release.transcriptFile, ...collectStringRefs(release.payload)]),
          "Release prepare was blocked.",
        );
        markStage(
          stageMap,
          "release",
          "fail",
          uniqueStrings([release.transcriptFile, ...collectStringRefs(release.payload)]),
          "Release packet was not materialized.",
        );
        throw new Error("Release prepare was blocked.");
      }
      markStage(
        stageMap,
        "delivery",
        "pass",
        uniqueStrings([release.transcriptFile, ...collectStringRefs(release.payload)]),
        "Delivery artifacts were materialized through release prepare.",
      );
      markStage(
        stageMap,
        "release",
        "pass",
        uniqueStrings([release.transcriptFile, ...collectStringRefs(release.payload)]),
        "Release packet was materialized.",
      );
    } else {
      markStage(stageMap, "delivery", "skipped", [], "Profile does not request release-packet materialization.");
      markStage(stageMap, "release", "skipped", [], "Profile does not request release-packet materialization.");
    }

    return {
      startedAt,
      finishedAt: nowIso(),
      status: "pass",
      stageResults: flattenStageMap(stageMap),
      commandResults,
      artifacts,
      sessionRoots,
    };
  } catch (error) {
    const summary = error instanceof Error ? error.message : String(error);
    if (!flattenStageMap(stageMap).some((stage) => stage.status === "fail")) {
      const fallbackStage = flattenStageMap(stageMap).find((stage) => stage.status === "pending")?.stage ?? "bootstrap";
      markStage(stageMap, fallbackStage, "fail", [], summary);
    }
    return {
      startedAt,
      finishedAt: nowIso(),
      status: "fail",
      stageResults: flattenStageMap(stageMap),
      commandResults,
      artifacts,
      sessionRoots,
    };
  }
}

/**
 * @param {{
 *   hostRoot: string,
 *   layout: ReturnType<typeof ensureRuntimeLayout>,
 *   runId: string,
 *   profilePath: string,
 *   profile: Record<string, unknown>,
 *   aorLaunch: ReturnType<typeof resolveAorLaunch>,
 *   examplesRoot: string,
 *   examplesRootOverride: string | null,
 *   catalogTargetPath: string,
 *   catalogEntry: Record<string, unknown>,
 *   mission: Record<string, unknown>,
 * }} options
 */
function executeFullJourneyFlow(options) {
  const stageMap = createStageMap(getProfileStages(options.profile));
  const commandResults = [];
  const transcriptsRoot = path.join(options.layout.reportsRoot, `live-e2e-command-traces-${normalizeId(options.runId)}`);
  fs.mkdirSync(transcriptsRoot, { recursive: true });
  const sessionRoots = createSessionRoots({
    sessionsRoot: options.layout.sessionsRoot,
    runId: options.runId,
  });
  const env = {
    ...process.env,
    AOR_HOME: sessionRoots.aorHome,
    CODEX_HOME: sessionRoots.codexHome,
    TMPDIR: sessionRoots.tmpRoot,
  };
  if (options.examplesRootOverride) {
    env.AOR_BOOTSTRAP_ASSETS_ROOT = options.examplesRootOverride;
    env.AOR_EXAMPLES_ROOT = options.examplesRootOverride;
  }

  const artifacts = {
    host_runtime_root: options.layout.runtimeRoot,
    host_reports_root: options.layout.reportsRoot,
    session_root: sessionRoots.sessionRoot,
    aor_home: sessionRoots.aorHome,
    codex_home: sessionRoots.codexHome,
    target_catalog_file: options.catalogTargetPath,
    feature_mission_id: asNonEmptyString(options.mission.mission_id) || null,
  };
  const startedAt = nowIso();
  const internalTestHooks = asRecord(options.profile.internal_test_hooks);

  try {
    const targetCheckout = materializeTargetCheckout({
      hostRoot: options.hostRoot,
      layout: options.layout,
      runId: options.runId,
      profile: options.profile,
    });
    artifacts.target_checkout_root = targetCheckout.targetCheckoutRoot;
    artifacts.target_repo_ref = targetCheckout.targetRepoRef;
    artifacts.target_repo_url = targetCheckout.targetRepoUrl;

    let commandIndex = 1;
    const runCommand = (label, args) => {
      const result = runAorCommand({
        launch: options.aorLaunch,
        cwd: targetCheckout.targetCheckoutRoot,
        args,
        env,
        transcriptsRoot,
        label,
        index: commandIndex,
      });
      commandIndex += 1;
      commandResults.push({
        label,
        command_surface: result.commandSurface,
        exit_code: result.exitCode,
        transcript_file: result.transcriptFile,
      });
      if (!result.ok) {
        const stderr = result.stderr.trim() || result.stdout.trim() || "command failed";
        throw new Error(`Public CLI command '${label}' failed: ${stderr}`);
      }
      return result;
    };

    const bootstrapTemplate = asNonEmptyString(options.profile.bootstrap_template) || "github-default";
    const catalogVerification = asRecord(options.catalogEntry.verification);
    const repoLintCommands = asStringArray(catalogVerification.setup_commands);
    const repoVerificationCommands = asStringArray(catalogVerification.commands);
    const projectInit = runCommand("project-init", [
      "project",
      "init",
      "--project-ref",
      ".",
      "--runtime-root",
      ".aor",
      "--materialize-project-profile",
      "--bootstrap-template",
      bootstrapTemplate,
      "--materialize-bootstrap-assets",
      ...repoVerificationCommands.flatMap((entry) => ["--repo-build-command", entry]),
      ...repoLintCommands.flatMap((entry) => ["--repo-lint-command", entry]),
      ...repoVerificationCommands.flatMap((entry) => ["--repo-test-command", entry]),
    ]);
    artifacts.generated_project_profile_file = getStringField(projectInit.payload, "materialized_project_profile_file");
    artifacts.target_examples_root = getStringField(projectInit.payload, "materialized_bootstrap_assets_root");
    artifacts.bootstrap_artifact_packet_file = getStringField(projectInit.payload, "artifact_packet_file");
    markStage(
      stageMap,
      "bootstrap",
      "pass",
      uniqueStrings([projectInit.transcriptFile, ...collectStringRefs(projectInit.payload)]),
      "Public bootstrap materialized project profile and packaged bootstrap assets.",
    );

    const featureRequest = materializeFeatureRequestFile({
      targetCheckoutRoot: targetCheckout.targetCheckoutRoot,
      mission: options.mission,
      runId: options.runId,
    });
    artifacts.feature_request_file = featureRequest.requestFile;

    const intakeCreate = runCommand("intake-create", [
      "intake",
      "create",
      "--project-ref",
      ".",
      "--runtime-root",
      ".aor",
      "--request-file",
      featureRequest.requestFile,
      "--mission-id",
      asNonEmptyString(options.mission.mission_id),
      "--request-title",
      asNonEmptyString(featureRequest.requestDocument.title),
      "--request-brief",
      asNonEmptyString(featureRequest.requestDocument.brief),
      ...asStringArray(options.mission.acceptance_checks).flatMap((entry) => ["--request-constraints", entry]),
    ]);
    artifacts.intake_artifact_packet_file = getStringField(intakeCreate.payload, "artifact_packet_file");
    artifacts.intake_artifact_packet_body_file = getStringField(intakeCreate.payload, "artifact_packet_body_file");

    const analyze = runCommand("project-analyze", [
      "project",
      "analyze",
      "--project-ref",
      ".",
      "--project-profile",
      "./project.aor.yaml",
      "--runtime-root",
      ".aor",
    ]);
    artifacts.analysis_report_file = getStringField(analyze.payload, "analysis_report_file");

    const validate = runCommand("project-validate", [
      "project",
      "validate",
      "--project-ref",
      ".",
      "--project-profile",
      "./project.aor.yaml",
      "--runtime-root",
      ".aor",
    ]);
    artifacts.validation_report_file = getStringField(validate.payload, "validation_report_file");

    const verifyPreflight = runCommand("project-verify-preflight", [
      "project",
      "verify",
      "--project-ref",
      ".",
      "--project-profile",
      "./project.aor.yaml",
      "--runtime-root",
      ".aor",
      "--require-validation-pass",
      "true",
      "--routed-dry-run-step",
      "implement",
    ]);
    artifacts.verify_summary_file = getStringField(verifyPreflight.payload, "verify_summary_file");
    artifacts.preflight_step_result_files = getStringArrayField(verifyPreflight.payload, "step_result_files");
    const verifySummaryPath = /** @type {string | null} */ (artifacts.verify_summary_file);
    if (!verifySummaryPath || !fileExists(verifySummaryPath)) {
      markStage(
        stageMap,
        "execution",
        "fail",
        uniqueStrings([verifyPreflight.transcriptFile, ...collectStringRefs(verifyPreflight.payload)]),
        "Dry-run verify summary was not materialized.",
      );
      throw new Error("Dry-run verify summary was not materialized.");
    }
    const verifySummary = readJson(verifySummaryPath);
    if (verifySummary.status === "failed") {
      markStage(
        stageMap,
        "execution",
        "fail",
        uniqueStrings([verifyPreflight.transcriptFile, verifySummaryPath, ...collectStringRefs(verifyPreflight.payload)]),
        "Dry-run verify failed before feature-driven discovery planning.",
      );
      throw new Error("Dry-run verify failed before feature-driven discovery planning.");
    }

    const discovery = runCommand("discovery-run", [
      "discovery",
      "run",
      "--project-ref",
      ".",
      "--project-profile",
      "./project.aor.yaml",
      "--runtime-root",
      ".aor",
      "--input-packet",
      /** @type {string} */ (artifacts.intake_artifact_packet_file),
    ]);
    artifacts.discovery_analysis_report_file = getStringField(discovery.payload, "analysis_report_file");
    markStage(
      stageMap,
      "discovery",
      "pass",
      uniqueStrings([
        analyze.transcriptFile,
        validate.transcriptFile,
        discovery.transcriptFile,
        ...collectStringRefs(discovery.payload),
      ]),
      "Feature-driven discovery completed from catalog-backed intake request.",
    );

    const specBuild = runCommand("spec-build", [
      "spec",
      "build",
      "--project-ref",
      ".",
      "--project-profile",
      "./project.aor.yaml",
      "--runtime-root",
      ".aor",
    ]);
    artifacts.spec_step_result_file = getStringField(specBuild.payload, "routed_step_result_file");
    if (internalTestHooks.drop_spec_step_result_after_spec_build === true && artifacts.spec_step_result_file) {
      try {
        fs.rmSync(artifacts.spec_step_result_file, { force: true });
      } catch {
        // ignore test-only cleanup failure and let the artifact check below fail deterministically
      }
    }
    if (!artifacts.spec_step_result_file || !fileExists(artifacts.spec_step_result_file)) {
      markStage(
        stageMap,
        "spec",
        "fail",
        uniqueStrings([specBuild.transcriptFile, ...collectStringRefs(specBuild.payload)]),
        "Spec build did not materialize a routed step-result artifact.",
      );
      throw new Error("Spec build did not materialize a routed step-result artifact.");
    }
    markStage(
      stageMap,
      "spec",
      "pass",
      uniqueStrings([specBuild.transcriptFile, ...collectStringRefs(specBuild.payload)]),
      "Spec build produced feature-traceable dry-run evidence.",
    );

    const waveCreate = runCommand("wave-create", [
      "wave",
      "create",
      "--project-ref",
      ".",
      "--project-profile",
      "./project.aor.yaml",
      "--runtime-root",
      ".aor",
    ]);
    artifacts.wave_ticket_file = getStringField(waveCreate.payload, "wave_ticket_file");
    artifacts.handoff_packet_file = getStringField(waveCreate.payload, "handoff_packet_file");
    markStage(
      stageMap,
      "planning",
      "pass",
      uniqueStrings([waveCreate.transcriptFile, ...collectStringRefs(waveCreate.payload)]),
      "Wave and handoff packets were materialized from the public planning flow.",
    );

    const handoffApprove = runCommand("handoff-approve", [
      "handoff",
      "approve",
      "--project-ref",
      ".",
      "--runtime-root",
      ".aor",
      "--handoff-packet",
      /** @type {string} */ (artifacts.handoff_packet_file),
      "--approval-ref",
      `approval://live-e2e/full-journey/${normalizeId(options.runId)}`,
    ]);
    artifacts.approved_handoff_packet_file = getStringField(handoffApprove.payload, "handoff_packet_file");
    if (internalTestHooks.block_approved_handoff_validation === true) {
      markStage(
        stageMap,
        "handoff",
        "fail",
        uniqueStrings([handoffApprove.transcriptFile, ...collectStringRefs(handoffApprove.payload)]),
        "Approved handoff validation was blocked by internal test hook.",
      );
      throw new Error("Approved handoff validation was blocked by internal test hook.");
    }
    let validateApproved;
    try {
      validateApproved = runCommand("project-validate-approved-handoff", [
        "project",
        "validate",
        "--project-ref",
        ".",
        "--project-profile",
        "./project.aor.yaml",
        "--runtime-root",
        ".aor",
        "--require-approved-handoff",
        "--handoff-packet",
        /** @type {string} */ (artifacts.approved_handoff_packet_file),
      ]);
    } catch (error) {
      const summary = error instanceof Error ? error.message : String(error);
      markStage(
        stageMap,
        "handoff",
        "fail",
        uniqueStrings([handoffApprove.transcriptFile]),
        summary,
      );
      throw error;
    }
    artifacts.approved_validation_report_file = getStringField(validateApproved.payload, "validation_report_file");
    markStage(
      stageMap,
      "handoff",
      "pass",
      uniqueStrings([handoffApprove.transcriptFile, validateApproved.transcriptFile, ...collectStringRefs(handoffApprove.payload)]),
      "Approved handoff validated for execution start.",
    );

    const promotionEvidenceRefs = uniqueStrings([
      ...(verifySummaryPath ? [verifySummaryPath] : []),
      ...asStringArray(artifacts.preflight_step_result_files),
    ]);

    const runStart = runCommand("run-start", [
      "run",
      "start",
      "--project-ref",
      ".",
      "--project-profile",
      "./project.aor.yaml",
      "--runtime-root",
      ".aor",
      "--run-id",
      options.runId,
      "--target-step",
      "implement",
      "--require-validation-pass",
      "true",
      ...(artifacts.approved_handoff_packet_file
        ? ["--approved-handoff-ref", /** @type {string} */ (artifacts.approved_handoff_packet_file)]
        : []),
      ...(promotionEvidenceRefs.length > 0
        ? ["--promotion-evidence-refs", promotionEvidenceRefs.join(",")]
        : []),
    ]);
    artifacts.routed_step_result_file = getStringField(runStart.payload, "routed_step_result_file");
    artifacts.routed_step_result_id = getStringField(runStart.payload, "routed_step_result_id");
    if (artifacts.routed_step_result_file && fileExists(artifacts.routed_step_result_file)) {
      const stepResult = readJson(artifacts.routed_step_result_file);
      const routedExecution = asRecord(stepResult.routed_execution);
      artifacts.compiled_context_ref = asNonEmptyString(asRecord(routedExecution.context_compilation).compiled_context_ref) || null;
      artifacts.compiled_context_file = asNonEmptyString(asRecord(routedExecution.context_compilation).compiled_context_file) || null;
      artifacts.adapter_raw_evidence_ref =
        asNonEmptyString(asRecord(asRecord(asRecord(routedExecution.adapter_response).output).external_runner).raw_evidence_ref) ||
        null;
      if (asNonEmptyString(stepResult.status) !== "passed") {
        markStage(
          stageMap,
          "execution",
          "fail",
          uniqueStrings([
            verifyPreflight.transcriptFile,
            verifySummaryPath,
            runStart.transcriptFile,
            artifacts.routed_step_result_file,
            ...collectStringRefs(stepResult),
          ]),
          asNonEmptyString(stepResult.summary) || "Run start routed execution failed.",
        );
        throw new Error(asNonEmptyString(stepResult.summary) || "Run start routed execution failed.");
      }
    }
    const runStatus = runCommand("run-status", [
      "run",
      "status",
      "--project-ref",
      ".",
      "--runtime-root",
      ".aor",
      "--run-id",
      options.runId,
    ]);
    artifacts.run_status_snapshot_file = runStatus.transcriptFile;
    markStage(
      stageMap,
      "execution",
      "pass",
      uniqueStrings([
        verifyPreflight.transcriptFile,
        verifySummaryPath,
        runStart.transcriptFile,
        runStatus.transcriptFile,
        ...collectStringRefs(runStart.payload),
      ]),
      "Dry-run verify, run start, and run status completed through public execution lifecycle.",
    );

    const reviewRun = runCommand("review-run", [
      "review",
      "run",
      "--project-ref",
      ".",
      "--project-profile",
      "./project.aor.yaml",
      "--runtime-root",
      ".aor",
      "--run-id",
      options.runId,
    ]);
    artifacts.review_report_file = getStringField(reviewRun.payload, "review_report_file");
    const reviewReport = artifacts.review_report_file && fileExists(artifacts.review_report_file)
      ? readJson(artifacts.review_report_file)
      : {};
    const reviewOverallStatus = normalizeVerdictStatus(reviewReport.overall_status);
    markStage(
      stageMap,
      "review",
      reviewOverallStatus === "fail" ? "fail" : "pass",
      uniqueStrings([reviewRun.transcriptFile, ...collectStringRefs(reviewRun.payload)]),
      reviewOverallStatus === "fail" ? "Review report failed." : "Review report materialized.",
    );

    const evalSuites = getEvalSuites(options.profile);
    if (evalSuites.length > 0) {
      const evalRun = runCommand("eval-run", [
        "eval",
        "run",
        "--project-ref",
        ".",
        "--project-profile",
        "./project.aor.yaml",
        "--runtime-root",
        ".aor",
        "--suite-ref",
        evalSuites[0],
        "--subject-ref",
        `run://${options.runId}`,
      ]);
      artifacts.evaluation_report_file = getStringField(evalRun.payload, "evaluation_report_file");
      markStage(
        stageMap,
        "qa",
        getStringField(evalRun.payload, "evaluation_status") === "pass" ? "pass" : "fail",
        uniqueStrings([evalRun.transcriptFile, ...collectStringRefs(evalRun.payload)]),
        "Evaluation report materialized.",
      );
      if (getStringField(evalRun.payload, "evaluation_status") !== "pass") {
        throw new Error("Evaluation report failed.");
      }
    } else {
      markStage(stageMap, "qa", "skipped", [], "Profile has no eval suites.");
    }

    const harnessCertification = getHarnessCertification(options.profile);
    /** @type {string[]} */
    const deliveryEvidenceRefs = uniqueStrings([
      ...(artifacts.routed_step_result_file ? [artifacts.routed_step_result_file] : []),
      ...(artifacts.evaluation_report_file ? [artifacts.evaluation_report_file] : []),
    ]);
    if (harnessCertification) {
      const certify = runCommand("harness-certify", [
        "harness",
        "certify",
        "--project-ref",
        ".",
        "--project-profile",
        "./project.aor.yaml",
        "--runtime-root",
        ".aor",
        "--asset-ref",
        harnessCertification.assetRef,
        "--subject-ref",
        harnessCertification.subjectRef,
        "--suite-ref",
        harnessCertification.suiteRef,
        "--step-class",
        harnessCertification.stepClass,
      ]);
      artifacts.promotion_decision_file = getStringField(certify.payload, "promotion_decision_file");
      if (artifacts.promotion_decision_file) {
        deliveryEvidenceRefs.push(artifacts.promotion_decision_file);
      }
      if (getStringField(certify.payload, "promotion_decision_status") !== "pass") {
        throw new Error("Harness certification did not pass.");
      }
    }

    let deliverPrepare;
    try {
      deliverPrepare = runCommand("deliver-prepare", [
        "deliver",
        "prepare",
        "--project-ref",
        ".",
        "--project-profile",
        "./project.aor.yaml",
        "--runtime-root",
        ".aor",
        "--run-id",
        options.runId,
        "--step-class",
        "implement",
        "--mode",
        getPreferredDeliveryMode(options.profile),
        ...(artifacts.approved_handoff_packet_file
          ? ["--approved-handoff-ref", /** @type {string} */ (artifacts.approved_handoff_packet_file)]
          : []),
        ...(deliveryEvidenceRefs.length > 0 ? ["--promotion-evidence-refs", deliveryEvidenceRefs.join(",")] : []),
      ]);
    } catch (error) {
      const summary = error instanceof Error ? error.message : String(error);
      markStage(stageMap, "delivery", "fail", [], summary);
      throw error;
    }
    artifacts.delivery_manifest_file = getStringField(deliverPrepare.payload, "delivery_manifest_file");
    artifacts.delivery_plan_file = getStringField(deliverPrepare.payload, "delivery_plan_file");
    artifacts.delivery_transcript_file = getStringField(deliverPrepare.payload, "delivery_transcript_file");
    if (internalTestHooks.block_delivery_prepare === true) {
      deliverPrepare.payload.delivery_blocking = true;
    }
    markStage(
      stageMap,
      "delivery",
      deliverPrepare.payload?.delivery_blocking === true ? "fail" : "pass",
      uniqueStrings([deliverPrepare.transcriptFile, ...collectStringRefs(deliverPrepare.payload)]),
      deliverPrepare.payload?.delivery_blocking === true
        ? "Delivery prepare was blocked."
        : "Delivery prepare materialized delivery evidence.",
    );
    if (deliverPrepare.payload?.delivery_blocking === true) {
      throw new Error("Delivery prepare was blocked.");
    }

    if (asRecord(options.profile.output_policy).materialize_release_packet === true) {
      const releasePrepare = runCommand("release-prepare", [
        "release",
        "prepare",
        "--project-ref",
        ".",
        "--project-profile",
        "./project.aor.yaml",
        "--runtime-root",
        ".aor",
        "--run-id",
        options.runId,
        "--step-class",
        "implement",
        "--mode",
        getPreferredDeliveryMode(options.profile),
        ...(artifacts.approved_handoff_packet_file
          ? ["--approved-handoff-ref", /** @type {string} */ (artifacts.approved_handoff_packet_file)]
          : []),
        ...(deliveryEvidenceRefs.length > 0 ? ["--promotion-evidence-refs", deliveryEvidenceRefs.join(",")] : []),
      ]);
      artifacts.release_packet_file = getStringField(releasePrepare.payload, "release_packet_file");
      if (!artifacts.release_packet_file) {
        markStage(
          stageMap,
          "release",
          "fail",
          uniqueStrings([releasePrepare.transcriptFile, ...collectStringRefs(releasePrepare.payload)]),
          "Release prepare did not materialize release packet.",
        );
        throw new Error("Release prepare did not materialize release packet.");
      }
      markStage(
        stageMap,
        "release",
        "pass",
        uniqueStrings([releasePrepare.transcriptFile, ...collectStringRefs(releasePrepare.payload)]),
        "Release prepare materialized release packet evidence.",
      );
    } else {
      markStage(stageMap, "release", "skipped", [], "Profile does not request release packet materialization.");
    }

    const auditRuns = runCommand("audit-runs", [
      "audit",
      "runs",
      "--project-ref",
      ".",
      "--runtime-root",
      ".aor",
      "--run-id",
      options.runId,
    ]);
    artifacts.run_audit_file = auditRuns.transcriptFile;
    const auditPayload = asRecord(auditRuns.payload);

    let incidentOpen = null;
    if (reviewOverallStatus === "fail") {
      incidentOpen = runCommand("incident-open", [
        "incident",
        "open",
        "--project-ref",
        ".",
        "--runtime-root",
        ".aor",
        "--run-id",
        options.runId,
        "--summary",
        "Full-journey review verdict failed.",
      ]);
      artifacts.incident_report_file = getStringField(incidentOpen.payload, "incident_file");
    }

    let learningHandoff;
    try {
      learningHandoff = runCommand("learning-handoff", [
        "learning",
        "handoff",
        "--project-ref",
        ".",
        "--runtime-root",
        ".aor",
        "--run-id",
        options.runId,
      ]);
    } catch (error) {
      const summary = error instanceof Error ? error.message : String(error);
      markStage(stageMap, "learning", "fail", [], summary);
      throw error;
    }
    if (internalTestHooks.drop_learning_handoff_outputs === true) {
      delete learningHandoff.payload.learning_loop_handoff_file;
    }
    artifacts.learning_loop_scorecard_file = getStringField(learningHandoff.payload, "learning_loop_scorecard_file");
    artifacts.learning_loop_handoff_file = getStringField(learningHandoff.payload, "learning_loop_handoff_file");
    artifacts.incident_report_file =
      getStringField(learningHandoff.payload, "incident_report_file") ||
      getStringField(learningHandoff.payload, "incident_file") ||
      artifacts.incident_report_file ||
      null;
    if (!artifacts.learning_loop_scorecard_file || !artifacts.learning_loop_handoff_file) {
      markStage(
        stageMap,
        "learning",
        "fail",
        uniqueStrings([learningHandoff.transcriptFile, ...collectStringRefs(learningHandoff.payload)]),
        "Learning handoff did not materialize the required public closure artifacts.",
      );
      throw new Error("Learning handoff did not materialize the required public closure artifacts.");
    }

    const deliveryReleaseQuality =
      asRecord(options.profile.output_policy).materialize_release_packet === true
        ? artifacts.release_packet_file
          ? "pass"
          : "fail"
        : artifacts.delivery_manifest_file
          ? "pass"
          : "warn";
    const learningLoopClosure =
      artifacts.learning_loop_scorecard_file && artifacts.learning_loop_handoff_file && auditPayload.run_audit_records
        ? "pass"
        : "fail";
    const verdictMatrix = {
      target_selection: "pass",
      feature_request_quality: artifacts.intake_artifact_packet_file && artifacts.feature_request_file ? "pass" : "fail",
      discovery_quality: normalizeVerdictStatus(asRecord(reviewReport.discovery_quality).status),
      runtime_success: artifacts.routed_step_result_file ? "pass" : "fail",
      artifact_quality: normalizeVerdictStatus(asRecord(reviewReport.artifact_quality).status),
      code_quality: normalizeVerdictStatus(asRecord(reviewReport.code_quality).status),
      delivery_release_quality: deliveryReleaseQuality,
      learning_loop_closure: learningLoopClosure,
      overall_verdict: "pass",
    };
    const verdictStatuses = [
      verdictMatrix.target_selection,
      verdictMatrix.feature_request_quality,
      verdictMatrix.discovery_quality,
      verdictMatrix.runtime_success,
      verdictMatrix.artifact_quality,
      verdictMatrix.code_quality,
      verdictMatrix.delivery_release_quality,
      verdictMatrix.learning_loop_closure,
    ];
    verdictMatrix.overall_verdict = verdictStatuses.includes("fail")
      ? "fail"
      : verdictStatuses.includes("warn")
        ? "pass_with_findings"
        : "pass";
    artifacts.verdict_matrix = verdictMatrix;

    return {
      startedAt,
      finishedAt: nowIso(),
      status: verdictMatrix.overall_verdict === "fail" ? "fail" : "pass",
      stageResults: flattenStageMap(stageMap),
      commandResults,
      artifacts,
      sessionRoots,
    };
  } catch (error) {
    const summary = error instanceof Error ? error.message : String(error);
    if (!flattenStageMap(stageMap).some((stage) => stage.status === "fail")) {
      const fallbackStage = flattenStageMap(stageMap).find((stage) => stage.status === "pending")?.stage ?? "bootstrap";
      markStage(stageMap, fallbackStage, "fail", [], summary);
    }
    return {
      startedAt,
      finishedAt: nowIso(),
      status: "fail",
      stageResults: flattenStageMap(stageMap),
      commandResults,
      artifacts,
      sessionRoots,
    };
  }
}

/**
 * @param {{
 *   runId: string,
 *   profilePath: string,
 *   profile: Record<string, unknown>,
 *   flowResult: ReturnType<typeof executeInstalledUserFlow> | {
 *     startedAt: string,
 *     finishedAt: string | null,
 *     status: string,
 *     stageResults: Array<{ stage: string, status: string, evidence_refs: string[], summary: string | null }>,
 *     commandResults: Array<Record<string, unknown>>,
 *     artifacts: Record<string, unknown>,
 *   },
 *   summaryFile: string,
 * }} options
 */
function buildScorecard(options) {
  const targetRepo = asRecord(options.profile.target_repo);
  return {
    scorecard_id: `${options.runId}.scorecard.${asNonEmptyString(targetRepo.repo_id) || "target"}`,
    run_id: options.runId,
    profile_ref: options.profilePath,
    profile_id: options.profile.profile_id ?? null,
    scenario_id: options.profile.scenario_id ?? null,
    flow_kind: options.profile.flow_kind ?? null,
    duration_class: options.profile.duration_class ?? null,
    target_repo: {
      repo_id: targetRepo.repo_id ?? null,
      repo_url: targetRepo.repo_url ?? null,
      ref: targetRepo.ref ?? null,
    },
    stage_counts: summarizeStageCounts(options.flowResult.stageResults),
    status: options.flowResult.status,
    summary_ref: options.summaryFile,
    command_count: options.flowResult.commandResults.length,
    generated_at: nowIso(),
  };
}

/**
 * @param {{
 *   hostRoot: string,
 *   hostProjectId: string,
 *   layout: ReturnType<typeof ensureRuntimeLayout>,
 *   runId: string,
 *   profilePath: string,
 *   profile: Record<string, unknown>,
 *   flowResult: ReturnType<typeof executeInstalledUserFlow> | {
 *     startedAt: string,
 *     finishedAt: string | null,
 *     status: string,
 *     stageResults: Array<{ stage: string, status: string, evidence_refs: string[], summary: string | null }>,
 *     commandResults: Array<Record<string, unknown>>,
 *     artifacts: Record<string, unknown>,
 *   },
 *   aorLaunch: ReturnType<typeof resolveAorLaunch>,
 *   examplesRoot: string | null,
 * }}
 */
function writeHarnessArtifacts(options) {
  const summaryFile = path.join(
    options.layout.reportsRoot,
    `live-e2e-run-summary-${normalizeId(options.runId)}.json`,
  );
  const scorecardFile = path.join(
    options.layout.reportsRoot,
    `live-e2e-scorecard-target-${normalizeId(options.runId)}.json`,
  );
  const summary = {
    run_id: options.runId,
    project_id: options.hostProjectId,
    profile_ref: options.profilePath,
    profile_id: options.profile.profile_id ?? null,
    scenario_id: options.profile.scenario_id ?? null,
    flow_kind: options.profile.flow_kind ?? null,
    duration_class: options.profile.duration_class ?? null,
    started_at: options.flowResult.startedAt,
    finished_at: options.flowResult.finishedAt,
    status: options.flowResult.status,
    target_repo: asRecord(options.profile.target_repo),
    target_checkout_root:
      typeof options.flowResult.artifacts.target_checkout_root === "string"
        ? options.flowResult.artifacts.target_checkout_root
        : null,
    generated_project_profile_file:
      typeof options.flowResult.artifacts.generated_project_profile_file === "string"
        ? options.flowResult.artifacts.generated_project_profile_file
        : null,
    routed_step_result_file:
      typeof options.flowResult.artifacts.routed_step_result_file === "string"
        ? options.flowResult.artifacts.routed_step_result_file
        : null,
    compiled_context_ref:
      typeof options.flowResult.artifacts.compiled_context_ref === "string"
        ? options.flowResult.artifacts.compiled_context_ref
        : null,
    adapter_raw_evidence_ref:
      typeof options.flowResult.artifacts.adapter_raw_evidence_ref === "string"
        ? options.flowResult.artifacts.adapter_raw_evidence_ref
        : null,
    stage_results: options.flowResult.stageResults,
    command_results: options.flowResult.commandResults,
    artifacts: options.flowResult.artifacts,
    verdict_matrix:
      typeof options.flowResult.artifacts.verdict_matrix === "object" && options.flowResult.artifacts.verdict_matrix
        ? options.flowResult.artifacts.verdict_matrix
        : null,
    scorecard_files: [scorecardFile],
    control_surfaces: {
      internal_harness:
        "node ./scripts/live-e2e/run-profile.mjs --project-ref <path> --profile <path> [--run-id <id>] [--runtime-root <path>] [--aor-bin <path>] [--examples-root <path>] [--catalog-root <path>]",
      public_cli_sequence: options.flowResult.commandResults.map((result) => result.command_surface).filter(Boolean),
      aor_bin: options.aorLaunch.binaryRef,
      examples_root: options.examplesRoot,
    },
    error: options.flowResult.status === "fail" ? options.flowResult.stageResults.find((stage) => stage.status === "fail")?.summary ?? null : null,
  };
  const scorecard = buildScorecard({
    runId: options.runId,
    profilePath: options.profilePath,
    profile: options.profile,
    flowResult: options.flowResult,
    summaryFile,
  });

  writeJson(summaryFile, summary);
  writeJson(scorecardFile, scorecard);

  let learningLoop;
  const publicLearningScorecard = asNonEmptyString(options.flowResult.artifacts.learning_loop_scorecard_file);
  const publicLearningHandoff = asNonEmptyString(options.flowResult.artifacts.learning_loop_handoff_file);
  const publicIncidentFile = asNonEmptyString(options.flowResult.artifacts.incident_report_file);
  if (publicLearningScorecard && publicLearningHandoff) {
    learningLoop = {
      scorecardFile: publicLearningScorecard,
      handoffFile: publicLearningHandoff,
      incidentFile: publicIncidentFile || null,
    };
    summary.learning_loop_scorecard_file = publicLearningScorecard;
    summary.learning_loop_handoff_file = publicLearningHandoff;
    summary.incident_report_file = publicIncidentFile || null;
    writeJson(summaryFile, summary);
  } else {
    learningLoop = materializeLearningLoopArtifacts({
      projectId: options.hostProjectId,
      projectRoot: options.hostRoot,
      runtimeLayout: { reportsRoot: options.layout.reportsRoot },
      runId: options.runId,
      sourceKind: "live-e2e",
      runStatus: options.flowResult.status,
      summary:
        options.flowResult.status === "pass"
          ? `Installed-user rehearsal '${options.runId}' completed successfully.`
          : summary.error ?? `Installed-user rehearsal '${options.runId}' failed.`,
      evidenceRefs: uniqueStrings([summaryFile, scorecardFile, ...collectStringRefs(options.flowResult.artifacts)]),
      linkedScorecardRefs: [scorecardFile],
      evalSuiteRefs: getEvalSuites(options.profile),
      backlogRefs: getBacklogRefs(options.profile),
      forceIncident: asRecord(options.profile.learning_loop).force_incident === true,
      incidentSummary: summary.error ?? undefined,
    });
    summary.learning_loop_scorecard_file = learningLoop.scorecardFile;
    summary.learning_loop_handoff_file = learningLoop.handoffFile;
    summary.incident_report_file = learningLoop.incidentFile;
    writeJson(summaryFile, summary);
  }

  return {
    summary,
    summaryFile,
    scorecard,
    scorecardFile,
    learningLoop,
  };
}

/**
 * @param {string[]} rawArgs
 */
function runCli(rawArgs) {
  if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
    process.stdout.write(
      [
        "Usage: node ./scripts/live-e2e/run-profile.mjs --project-ref <path> --profile <path> [--run-id <id>] [--runtime-root <path>] [--aor-bin <path>] [--examples-root <path>] [--catalog-root <path>]",
        "",
        "Internal black-box installed-user rehearsal harness.",
      ].join("\n"),
    );
    return 0;
  }

  const flags = parseFlags(rawArgs);
  const hostRoot = requireDirectory(
    resolveOptionalStringFlag(flags["project-ref"], "project-ref") ??
      (() => {
        throw new UsageError("Flag '--project-ref' is required.");
      })(),
  );
  const profileRef =
    resolveOptionalStringFlag(flags.profile, "profile") ??
    (() => {
      throw new UsageError("Flag '--profile' is required.");
    })();
  const runtimeRoot = resolveOptionalStringFlag(flags["runtime-root"], "runtime-root");
  const aorBin = resolveOptionalStringFlag(flags["aor-bin"], "aor-bin");
  const catalogRootOverride = resolveOptionalStringFlag(flags["catalog-root"], "catalog-root");
  const explicitExamplesRoot =
    Object.prototype.hasOwnProperty.call(flags, "examples-root")
      ? resolveOptionalStringFlag(flags["examples-root"], "examples-root")
      : null;
  const { profilePath, profile: loadedProfile } = loadHarnessProfile({
    hostRoot,
    profileRef,
  });
  const catalogRoot = resolveCatalogRoot({
    hostRoot,
    catalogRootOverride,
  });
  const fullJourneyResolution = isFullJourneyProfile(loadedProfile)
    ? resolveFullJourneyProfile({
        profile: loadedProfile,
        catalogRoot,
      })
    : null;
  const profile = fullJourneyResolution?.resolvedProfile ?? loadedProfile;
  const examplesRoot = explicitExamplesRoot
    ? requireDirectory(explicitExamplesRoot)
    : fullJourneyResolution
      ? null
      : requireDirectory(path.join(hostRoot, "examples"));
  const hostProjectId = discoverHostProjectId(hostRoot);
  const layout = ensureRuntimeLayout({
    hostRoot,
    runtimeRootOverride: runtimeRoot,
    hostProjectId,
  });
  const runId =
    resolveOptionalStringFlag(flags["run-id"], "run-id") ??
    `${asNonEmptyString(profile.profile_id) || "live-e2e"}.run-${nowIso().replace(/[^0-9]/g, "").slice(-12)}`;
  const aorLaunch = resolveAorLaunch({
    hostRoot,
    aorBinOverride: aorBin,
  });

  /** @type {{
   *   startedAt: string,
   *   finishedAt: string | null,
   *   status: string,
   *   stageResults: Array<{ stage: string, status: string, evidence_refs: string[], summary: string | null }>,
   *   commandResults: Array<Record<string, unknown>>,
   *   artifacts: Record<string, unknown>,
   * }} */
  let flowResult;

  try {
    flowResult = fullJourneyResolution
      ? executeFullJourneyFlow({
          hostRoot,
          layout,
          runId,
          profilePath,
          profile,
          aorLaunch,
          examplesRoot: examplesRoot ?? path.join(hostRoot, "examples"),
          examplesRootOverride: explicitExamplesRoot && examplesRoot ? examplesRoot : null,
          catalogTargetPath: fullJourneyResolution.catalogTargetPath,
          catalogEntry: fullJourneyResolution.catalogEntry,
          mission: fullJourneyResolution.mission,
        })
      : executeInstalledUserFlow({
          hostRoot,
          layout,
          runId,
          profilePath,
          profile,
          aorLaunch,
          examplesRoot:
            examplesRoot ??
            (() => {
              throw new UsageError("Bounded rehearsal requires bootstrap assets under '--examples-root' or '<project-ref>/examples'.");
            })(),
        });
  } catch (error) {
    flowResult = {
      startedAt: nowIso(),
      finishedAt: nowIso(),
      status: "fail",
      stageResults: [
        {
          stage: "bootstrap",
          status: "fail",
          evidence_refs: [],
          summary: error instanceof Error ? error.message : String(error),
        },
      ],
      commandResults: [],
      artifacts: {
        host_runtime_root: layout.runtimeRoot,
        host_reports_root: layout.reportsRoot,
      },
    };
  }

  const written = writeHarnessArtifacts({
    hostRoot,
    hostProjectId,
    layout,
    runId,
    profilePath,
    profile,
    flowResult,
    aorLaunch,
    examplesRoot,
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        command: "scripts live-e2e run-profile",
        status: "ok",
        run_id: runId,
        live_e2e_run_status: written.summary.status,
        live_e2e_run_summary_file: written.summaryFile,
        live_e2e_scorecard_files: [written.scorecardFile],
        learning_loop_scorecard_file: written.learningLoop.scorecardFile,
        learning_loop_handoff_file: written.learningLoop.handoffFile,
        incident_report_file: written.learningLoop.incidentFile,
      },
      null,
      2,
    )}\n`,
  );
  return 0;
}

try {
  process.exitCode = runCli(process.argv.slice(2));
} catch (error) {
  if (error instanceof UsageError) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  } else {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
