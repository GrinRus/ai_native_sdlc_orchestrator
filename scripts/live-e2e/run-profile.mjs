#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  parse as parseYaml,
  stringify as stringifyYaml,
} from "../../packages/contracts/node_modules/yaml/dist/index.js";

import {
  classifyExternalRunnerFailure,
  resolveExternalRuntimePermissionPolicy,
} from "../../packages/adapter-sdk/src/index.mjs";
import { loadContractFile, validateContractDocument } from "../../packages/contracts/src/index.mjs";

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
const LIVE_E2E_OBSERVATION_STEPS = Object.freeze([
  "discovery",
  "spec",
  "planning",
  "handoff",
  "execution",
  "review",
  "qa",
  "delivery",
]);
const LIVE_E2E_OBSERVATION_PRELUDE_STEPS = Object.freeze([
  "project-init",
  "intake-create",
  "project-analyze",
  "project-validate",
]);
const LIVE_E2E_OBSERVATION_EXCLUDED_STEPS = Object.freeze(["release", "learning"]);
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
 * @param {unknown} value
 * @returns {string[]}
 */
function asFindingStrings(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (typeof entry === "string") return entry.trim();
      const record = asRecord(entry);
      return (
        asNonEmptyString(record.summary) ||
        asNonEmptyString(record.message) ||
        asNonEmptyString(record.code) ||
        (Object.keys(record).length > 0 ? JSON.stringify(record) : "")
      );
    })
    .filter((entry) => entry.length > 0);
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function asPositiveInteger(value, fallback) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  const rounded = Math.floor(value);
  return rounded > 0 ? rounded : fallback;
}

/**
 * @param {unknown} value
 * @returns {Record<string, string>}
 */
function asStringMap(value) {
  const record = asRecord(value);
  const entries = Object.entries(record).filter(
    ([key, entry]) => typeof key === "string" && typeof entry === "string" && entry.trim().length > 0,
  );
  return Object.fromEntries(entries.map(([key, entry]) => [key, entry.trim()]));
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function hasNonEmptyPermissionDenials(value) {
  if (Array.isArray(value)) {
    return value.some((entry) => hasNonEmptyPermissionDenials(entry));
  }

  const record = asRecord(value);
  const entries = Object.entries(record);
  if (entries.length === 0) {
    return false;
  }

  const permissionDenials = record.permission_denials;
  if (Array.isArray(permissionDenials) && permissionDenials.length > 0) {
    return true;
  }

  return entries.some(([, entry]) => hasNonEmptyPermissionDenials(entry));
}

/**
 * @param {string} stdout
 * @returns {boolean}
 */
function stdoutHasStructuredPermissionDenials(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return false;
  }

  try {
    return hasNonEmptyPermissionDenials(JSON.parse(trimmed));
  } catch {
    // Try JSONL below.
  }

  const lines = trimmed.split(/\r?\n/u).filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return false;
  }

  for (const line of lines) {
    try {
      if (hasNonEmptyPermissionDenials(JSON.parse(line))) {
        return true;
      }
    } catch {
      return false;
    }
  }

  return false;
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
 * @param {string | null} value
 * @returns {"host" | "isolated"}
 */
function resolveRunnerAuthMode(value) {
  const normalized = value ? value.toLowerCase() : "host";
  if (normalized === "host") {
    return "host";
  }
  if (normalized === "isolated") {
    return "isolated";
  }
  throw new UsageError("Flag '--runner-auth-mode' must be either 'host' or 'isolated'.");
}

/**
 * @param {string | null} value
 * @returns {"full-bypass" | "restricted"}
 */
function resolveRuntimeAgentPermissionMode(value) {
  const normalized = value ? value.toLowerCase() : "full-bypass";
  if (normalized === "full-bypass") {
    return "full-bypass";
  }
  if (normalized === "restricted") {
    return "restricted";
  }
  throw new UsageError("Flag '--runtime-agent-permission-mode' must be either 'full-bypass' or 'restricted'.");
}

/**
 * @param {string} filePath
 * @returns {boolean}
 */
function fileExists(filePath) {
  return fs.existsSync(filePath);
}

/**
 * @param {string | null | undefined} evidenceRef
 * @param {string} projectRoot
 * @returns {boolean}
 */
function evidenceRefMaterialized(evidenceRef, projectRoot) {
  const ref = asNonEmptyString(evidenceRef);
  if (!ref) return false;
  if (path.isAbsolute(ref)) return fileExists(ref);
  if (!ref.startsWith("evidence://")) return false;
  const evidencePath = ref.slice("evidence://".length);
  if (!evidencePath) return false;
  const resolvedPath = path.isAbsolute(evidencePath) ? evidencePath : path.resolve(projectRoot, evidencePath);
  return fileExists(resolvedPath);
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
 * @param {{
 *   sessionRoots: ReturnType<typeof createSessionRoots>,
 *   runnerAuthMode: "host" | "isolated",
 * }} options
 * @returns {{ env: NodeJS.ProcessEnv, runnerAuthMode: string, runnerAuthSource: string }}
 */
function createProofRunnerEnvironment(options) {
  const env = {
    ...process.env,
    AOR_HOME: options.sessionRoots.aorHome,
    TMPDIR: options.sessionRoots.tmpRoot,
  };
  if (options.runnerAuthMode === "isolated") {
    env.CODEX_HOME = options.sessionRoots.codexHome;
  }
  return {
    env,
    runnerAuthMode: options.runnerAuthMode,
    runnerAuthSource: options.runnerAuthMode,
  };
}

/**
 * @param {{ hostRoot: string, profileRef: string }} options
 */
function loadProofRunnerProfile(options) {
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
  const loaded = loadContractFile({
    filePath,
    family: "live-e2e-target-catalog",
  });
  if (!loaded.ok) {
    const issues = loaded.validation.issues.map((issue) => issue.message).join("; ");
    throw new UsageError(`Target catalog '${options.targetCatalogId}' failed contract validation: ${issues}`);
  }
  return {
    filePath,
    entry: asRecord(loaded.document),
  };
}

/**
 * @param {{ catalogRoot: string, scenarioFamily: string }} options
 */
function loadCatalogScenarioPolicy(options) {
  const filePath = path.join(options.catalogRoot, "scenarios", `${normalizeId(options.scenarioFamily)}.yaml`);
  if (!fileExists(filePath)) {
    throw new UsageError(
      `Scenario policy '${options.scenarioFamily}' was not found under '${options.catalogRoot}/scenarios'.`,
    );
  }
  const loaded = loadContractFile({
    filePath,
    family: "live-e2e-scenario-policy",
  });
  if (!loaded.ok) {
    const issues = loaded.validation.issues.map((issue) => issue.message).join("; ");
    throw new UsageError(`Scenario policy '${options.scenarioFamily}' failed contract validation: ${issues}`);
  }
  return {
    filePath,
    entry: asRecord(loaded.document),
  };
}

/**
 * @param {{ catalogRoot: string, providerVariantId: string }} options
 */
function loadCatalogProviderVariant(options) {
  const filePath = path.join(options.catalogRoot, "providers", `${normalizeId(options.providerVariantId)}.yaml`);
  if (!fileExists(filePath)) {
    throw new UsageError(
      `Provider variant '${options.providerVariantId}' was not found under '${options.catalogRoot}/providers'.`,
    );
  }
  const loaded = loadContractFile({
    filePath,
    family: "live-e2e-provider-variant",
  });
  if (!loaded.ok) {
    const issues = loaded.validation.issues.map((issue) => issue.message).join("; ");
    throw new UsageError(`Provider variant '${options.providerVariantId}' failed contract validation: ${issues}`);
  }
  return {
    filePath,
    entry: asRecord(loaded.document),
  };
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function isFeatureSize(value) {
  return value === "small" || value === "medium" || value === "large";
}

/**
 * @param {Record<string, unknown>} catalogEntry
 * @param {string} featureMissionId
 * @param {string} scenarioFamily
 * @param {string} providerVariantId
 */
function resolveMatrixCell(catalogEntry, featureMissionId, scenarioFamily, providerVariantId) {
  const requiredCells = Array.isArray(catalogEntry.required_matrix_cells)
    ? /** @type {Array<Record<string, unknown>>} */ (catalogEntry.required_matrix_cells)
    : [];
  const matchingCell =
    requiredCells.find(
      (cell) =>
        asNonEmptyString(cell.feature_mission_id) === featureMissionId &&
        asNonEmptyString(cell.scenario_family) === scenarioFamily &&
        asNonEmptyString(cell.provider_variant_id) === providerVariantId,
    ) ?? null;
  const remainingRequiredCells = requiredCells.filter((cell) => cell !== matchingCell);
  return {
    coverageTier: matchingCell ? asNonEmptyString(matchingCell.coverage_tier) || "required" : "extended",
    currentCell: {
      cell_id:
        asNonEmptyString(asRecord(matchingCell ?? {}).cell_id) ||
        `${normalizeId(asNonEmptyString(catalogEntry.catalog_id) || "catalog")}.${normalizeId(scenarioFamily)}.${normalizeId(
          providerVariantId,
        )}`,
      target_catalog_id: asNonEmptyString(catalogEntry.catalog_id) || null,
      feature_mission_id: featureMissionId,
      scenario_family: scenarioFamily,
      provider_variant_id: providerVariantId,
      feature_size: null,
      coverage_tier: matchingCell ? asNonEmptyString(asRecord(matchingCell).coverage_tier) || "required" : "extended",
    },
    coverageFollowUp: {
      current_cell_required: matchingCell !== null,
      next_required_matrix_cell:
        remainingRequiredCells.length > 0
          ? {
              cell_id: asNonEmptyString(asRecord(remainingRequiredCells[0]).cell_id) || null,
              scenario_family: asNonEmptyString(asRecord(remainingRequiredCells[0]).scenario_family) || null,
              feature_size: asNonEmptyString(asRecord(remainingRequiredCells[0]).feature_size) || null,
              feature_mission_id: asNonEmptyString(asRecord(remainingRequiredCells[0]).feature_mission_id) || null,
              provider_variant_id: asNonEmptyString(asRecord(remainingRequiredCells[0]).provider_variant_id) || null,
            }
          : null,
      remaining_required_matrix_cells: remainingRequiredCells.map((cell) => ({
        cell_id: asNonEmptyString(cell.cell_id) || null,
        scenario_family: asNonEmptyString(cell.scenario_family) || null,
        feature_size: asNonEmptyString(cell.feature_size) || null,
        feature_mission_id: asNonEmptyString(cell.feature_mission_id) || null,
        provider_variant_id: asNonEmptyString(cell.provider_variant_id) || null,
      })),
    },
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
  const scenarioFamily = asNonEmptyString(options.profile.scenario_family);
  const providerVariantId = asNonEmptyString(options.profile.provider_variant_id);
  if (!targetCatalogId) {
    throw new UsageError("Full-journey profiles require target_catalog_id.");
  }
  if (!featureMissionId) {
    throw new UsageError("Full-journey profiles require feature_mission_id.");
  }
  if (!scenarioFamily) {
    throw new UsageError("Full-journey profiles require scenario_family.");
  }
  if (!providerVariantId) {
    throw new UsageError("Full-journey profiles require provider_variant_id.");
  }

  const catalogTarget = loadCatalogTarget({
    catalogRoot: options.catalogRoot,
    targetCatalogId,
  });
  const scenarioPolicy = loadCatalogScenarioPolicy({
    catalogRoot: options.catalogRoot,
    scenarioFamily,
  });
  const providerVariant = loadCatalogProviderVariant({
    catalogRoot: options.catalogRoot,
    providerVariantId,
  });
  const catalogEntry = asRecord(catalogTarget.entry);
  const missions = Array.isArray(catalogEntry.feature_missions)
    ? /** @type {Array<Record<string, unknown>>} */ (catalogEntry.feature_missions)
    : [];
  const mission = missions.find((candidate) => asNonEmptyString(candidate.mission_id) === featureMissionId);
  if (!mission) {
    throw new UsageError(`Feature mission '${featureMissionId}' was not found in catalog '${targetCatalogId}'.`);
  }
  const featureSize = asNonEmptyString(asRecord(mission).feature_size);
  if (!isFeatureSize(featureSize)) {
    throw new UsageError(
      `Feature mission '${featureMissionId}' in catalog '${targetCatalogId}' must declare feature_size as small, medium, or large.`,
    );
  }
  const supportedScenarios = asStringArray(asRecord(mission).supported_scenarios);
  if (supportedScenarios.length > 0 && !supportedScenarios.includes(scenarioFamily)) {
    throw new UsageError(
      `Scenario '${scenarioFamily}' is not allowed for mission '${featureMissionId}' in catalog '${targetCatalogId}'.`,
    );
  }
  const recommendedProviders = asStringArray(asRecord(mission).recommended_provider_variants);
  if (recommendedProviders.length > 0 && !recommendedProviders.includes(providerVariantId)) {
    throw new UsageError(
      `Provider variant '${providerVariantId}' is not allowed for mission '${featureMissionId}' in catalog '${targetCatalogId}'.`,
    );
  }
  const requiredStages = asStringArray(asRecord(scenarioPolicy.entry).required_stages);
  const declaredStages = getProfileStages(options.profile);
  const missingStages = requiredStages.filter((stage) => !declaredStages.includes(stage));
  if (missingStages.length > 0) {
    throw new UsageError(
      `Full-journey profile '${asNonEmptyString(options.profile.profile_id) || "unknown"}' is missing required stages for scenario '${scenarioFamily}': ${missingStages.join(", ")}.`,
    );
  }
  const releaseRequired = asRecord(scenarioPolicy.entry).release_required === true;
  if (releaseRequired && asRecord(options.profile.output_policy).materialize_release_packet !== true) {
    throw new UsageError(
      `Scenario '${scenarioFamily}' requires output_policy.materialize_release_packet=true.`,
    );
  }
  const matrixCell = resolveMatrixCell(catalogEntry, featureMissionId, scenarioFamily, providerVariantId);
  matrixCell.currentCell.feature_size = featureSize;

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
  resolvedProfile.scenario_policy_ref = scenarioPolicy.filePath;
  resolvedProfile.provider_variant_ref = providerVariant.filePath;
  return {
    resolvedProfile,
    catalogTargetPath: catalogTarget.filePath,
    catalogEntry,
    mission,
    scenarioPolicyPath: scenarioPolicy.filePath,
    scenarioPolicy: asRecord(scenarioPolicy.entry),
    providerVariantPath: providerVariant.filePath,
    providerVariant: asRecord(providerVariant.entry),
    featureSize,
    matrixCell: matrixCell.currentCell,
    coverageFollowUp: matrixCell.coverageFollowUp,
    coverageTier: matrixCell.coverageTier,
  };
}

/**
 * @param {{
 *   targetCheckoutRoot: string,
 *   mission: Record<string, unknown>,
 *   runId: string,
 *   scenarioFamily: string,
 *   providerVariantId: string,
 *   providerVariant: Record<string, unknown>,
 *   scenarioPolicy: Record<string, unknown>,
 *   featureSize: string,
 *   matrixCell: Record<string, unknown>,
 *   coverageFollowUp: Record<string, unknown>,
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
    scenario_family: options.scenarioFamily,
    provider_variant_id: options.providerVariantId,
    feature_size: options.featureSize,
    supported_scenarios: asStringArray(options.mission.supported_scenarios),
    recommended_provider_variants: asStringArray(options.mission.recommended_provider_variants),
    size_budget: asRecord(options.mission.size_budget),
    size_rationale: asNonEmptyString(options.mission.size_rationale) || null,
    change_budget: asRecord(options.mission.change_budget),
    provider_variant: {
      provider_variant_id: options.providerVariantId,
      provider: asNonEmptyString(options.providerVariant.provider) || null,
      primary_adapter: asNonEmptyString(options.providerVariant.primary_adapter) || null,
      route_override_policy: asRecord(options.providerVariant.route_override_policy),
    },
    scenario_policy: {
      scenario_family: options.scenarioFamily,
      required_stages: asStringArray(options.scenarioPolicy.required_stages),
      required_evidence: asStringArray(options.scenarioPolicy.required_evidence),
      delivery_mode_policy: asNonEmptyString(options.scenarioPolicy.delivery_mode_policy) || null,
      release_required: options.scenarioPolicy.release_required === true,
      incident_policy: asRecord(options.scenarioPolicy.incident_policy),
      governance_policy: asRecord(options.scenarioPolicy.governance_policy),
    },
    matrix_cell: options.matrixCell,
    coverage_follow_up: options.coverageFollowUp,
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
 * @returns {Record<string, { stage: string, status: string, evidence_refs: string[], summary: string | null, started_at: string | null, finished_at: string | null, duration_sec: number | null, failure_class: string | null, missing_evidence: string[], recommendation: string }>}
 */
function createStageMap(stages) {
  /** @type {Record<string, { stage: string, status: string, evidence_refs: string[], summary: string | null, started_at: string | null, finished_at: string | null, duration_sec: number | null, failure_class: string | null, missing_evidence: string[], recommendation: string }>} */
  const map = {};
  for (const stage of stages) {
    map[stage] = {
      stage,
      status: "pending",
      evidence_refs: [],
      summary: null,
      started_at: null,
      finished_at: null,
      duration_sec: null,
      failure_class: null,
      missing_evidence: [],
      recommendation: "await-stage-execution",
    };
  }
  return map;
}

/**
 * @param {string[]} evidenceRefs
 * @returns {{ startedAt: string | null, finishedAt: string | null, durationSec: number | null }}
 */
function resolveStageTimingFromEvidence(evidenceRefs) {
  const timings = evidenceRefs
    .filter((evidenceRef) => path.isAbsolute(evidenceRef) && fileExists(evidenceRef))
    .map((evidenceRef) => {
      try {
        const document = readJson(evidenceRef);
        return {
          startedAt: asNonEmptyString(document.started_at) || null,
          finishedAt: asNonEmptyString(document.finished_at) || null,
        };
      } catch {
        return { startedAt: null, finishedAt: null };
      }
    })
    .filter((timing) => timing.startedAt && timing.finishedAt);
  if (timings.length === 0) {
    return { startedAt: null, finishedAt: null, durationSec: null };
  }

  const startedAt = timings
    .map((timing) => /** @type {string} */ (timing.startedAt))
    .sort((left, right) => Date.parse(left) - Date.parse(right))[0];
  const finishedAt = timings
    .map((timing) => /** @type {string} */ (timing.finishedAt))
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0];
  return {
    startedAt,
    finishedAt,
    durationSec: resolveDurationSeconds(startedAt, finishedAt),
  };
}

/**
 * @param {string} status
 * @param {string | null} summary
 * @returns {string | null}
 */
function classifyStageFailure(status, summary) {
  if (status !== "fail") return null;
  const normalized = (summary ?? "").toLowerCase();
  if (normalized.includes("permission")) return "permission-denied";
  if (normalized.includes("no-op") || normalized.includes("no non-bootstrap")) return "no-op";
  if (normalized.includes("adapter") || normalized.includes("runner")) return "adapter-failure";
  if (normalized.includes("handoff")) return "handoff-failed";
  if (normalized.includes("validation")) return "validation-failed";
  if (normalized.includes("delivery")) return "delivery-failed";
  if (normalized.includes("learning")) return "learning-closure-gap";
  if (normalized.includes("missing") || normalized.includes("did not materialize")) return "missing-evidence";
  return "stage-failed";
}

/**
 * @param {string} status
 * @param {string | null} failureClass
 * @returns {string}
 */
function buildStageRecommendation(status, failureClass) {
  if (status === "pass") return "continue";
  if (status === "warn") return "continue_with_findings";
  if (status === "pending") return "await-stage-execution";
  if (failureClass === "permission-denied") return "inspect adapter permission evidence and runner auth mode";
  if (failureClass === "no-op") return "inspect Runtime Harness report and rerun implementation with meaningful changes";
  if (failureClass === "missing-evidence") return "inspect expected artifacts and rerun the failed public command";
  return "inspect stage evidence refs and command transcripts";
}

/**
 * @param {Record<string, { stage: string, status: string, evidence_refs: string[], summary: string | null, started_at: string | null, finished_at: string | null, duration_sec: number | null, failure_class: string | null, missing_evidence: string[], recommendation: string }>} stageMap
 * @param {string} stage
 * @param {string} status
 * @param {string[]} [evidenceRefs]
 * @param {string | null} [summary]
 */
function markStage(stageMap, stage, status, evidenceRefs = [], summary = null) {
  const currentTime = nowIso();
  const timing = resolveStageTimingFromEvidence(evidenceRefs);
  const failureClass = classifyStageFailure(status, summary);
  const missingEvidence = status === "fail" && evidenceRefs.length === 0 ? ["stage-evidence"] : [];
  if (!stageMap[stage]) {
    stageMap[stage] = {
      stage,
      status,
      evidence_refs: uniqueStrings(evidenceRefs),
      summary,
      started_at: timing.startedAt ?? currentTime,
      finished_at: timing.finishedAt ?? currentTime,
      duration_sec: timing.durationSec ?? 0,
      failure_class: failureClass,
      missing_evidence: missingEvidence,
      recommendation: buildStageRecommendation(status, failureClass),
    };
    return;
  }
  stageMap[stage].status = status;
  stageMap[stage].evidence_refs = uniqueStrings(evidenceRefs);
  stageMap[stage].summary = summary;
  stageMap[stage].started_at = stageMap[stage].started_at ?? timing.startedAt ?? currentTime;
  stageMap[stage].finished_at = timing.finishedAt ?? currentTime;
  stageMap[stage].duration_sec =
    timing.durationSec ?? resolveDurationSeconds(stageMap[stage].started_at, stageMap[stage].finished_at) ?? 0;
  stageMap[stage].failure_class = failureClass;
  stageMap[stage].missing_evidence = missingEvidence;
  stageMap[stage].recommendation = buildStageRecommendation(status, failureClass);
}

/**
 * @param {Record<string, { stage: string, status: string, evidence_refs: string[], summary: string | null, started_at: string | null, finished_at: string | null, duration_sec: number | null, failure_class: string | null, missing_evidence: string[], recommendation: string }>} stageMap
 * @returns {Array<{ stage: string, status: string, evidence_refs: string[], summary: string | null, started_at: string | null, finished_at: string | null, duration_sec: number | null, failure_class: string | null, missing_evidence: string[], recommendation: string }>}
 */
function flattenStageMap(stageMap) {
  return Object.values(stageMap);
}

/**
 * @param {Array<{ stage: string, status: string }>} stageResults
 */
function summarizeStageCounts(stageResults) {
  let pass = 0;
  let warn = 0;
  let fail = 0;
  let pending = 0;
  let skipped = 0;
  for (const stage of stageResults) {
    if (stage.status === "pass") pass += 1;
    else if (stage.status === "warn") warn += 1;
    else if (stage.status === "fail") fail += 1;
    else if (stage.status === "skipped") skipped += 1;
    else pending += 1;
  }
  return { pass, warn, fail, pending, skipped };
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
    throw new Error("Proof runner profile must declare target_repo.repo_url.");
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
    throw new Error("Proof runner profile must declare project_profile_template_ref.");
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
 * @param {Record<string, unknown>} route
 * @returns {Record<string, unknown>}
 */
function cloneRouteDocument(route) {
  return /** @type {Record<string, unknown>} */ (JSON.parse(JSON.stringify(route)));
}

/**
 * @param {{
 *   targetCheckoutRoot: string,
 *   providerVariant: Record<string, unknown>,
 *   providerVariantId: string,
 * }} options
 */
function materializeProviderPinnedRouteOverrides(options) {
  const routesRoot = path.join(options.targetCheckoutRoot, "examples", "routes");
  if (!fileExists(routesRoot) || !fs.statSync(routesRoot).isDirectory()) {
    throw new Error(`Routes root '${routesRoot}' was not found for provider override materialization.`);
  }
  const overrideSteps = asStringArray(asRecord(options.providerVariant.route_override_policy).steps);
  const pinnedProvider = asNonEmptyString(options.providerVariant.provider);
  const pinnedAdapter = asNonEmptyString(options.providerVariant.primary_adapter);
  if (!pinnedProvider || !pinnedAdapter) {
    throw new Error(`Provider variant '${options.providerVariantId}' must declare provider and primary_adapter.`);
  }

  /** @type {Record<string, string>} */
  const routeOverrides = {};
  /** @type {string[]} */
  const routeFiles = [];
  const routeSources = fs
    .readdirSync(routesRoot)
    .filter((entry) => entry.endsWith(".yaml") || entry.endsWith(".yml"))
    .map((entry) => path.join(routesRoot, entry));

  for (const routePath of routeSources) {
    const routeDocument = asRecord(readYamlDocument(routePath));
    const step = asNonEmptyString(routeDocument.step);
    if (!step || !overrideSteps.includes(step)) {
      continue;
    }

    const pinnedRoute = cloneRouteDocument(routeDocument);
    const originalRouteId = asNonEmptyString(routeDocument.route_id) || `route.${step}.default`;
    const primary = asRecord(pinnedRoute.primary);
    primary.provider = pinnedProvider;
    if (asNonEmptyString(primary.adapter) !== "none") {
      primary.adapter = pinnedAdapter;
    }
    pinnedRoute.primary = primary;
    pinnedRoute.fallback = [];
    pinnedRoute.route_id = `${originalRouteId}.${normalizeId(options.providerVariantId)}`;

    const validation = validateContractDocument({
      family: "provider-route-profile",
      document: pinnedRoute,
      source: `runtime://provider-route-override/${normalizeId(options.providerVariantId)}/${step}`,
    });
    if (!validation.ok) {
      const issues = validation.issues.map((issue) => issue.message).join("; ");
      throw new Error(`Generated provider-pinned route for step '${step}' failed validation: ${issues}`);
    }

    const routeFile = path.join(routesRoot, `${step}-${normalizeId(options.providerVariantId)}.yaml`);
    fs.writeFileSync(routeFile, stringifyYaml(pinnedRoute), "utf8");
    routeOverrides[step] = /** @type {string} */ (pinnedRoute.route_id);
    routeFiles.push(routeFile);
  }

  return {
    routeOverrides,
    routeFiles,
  };
}

/**
 * @param {Record<string, unknown>} profile
 * @returns {boolean}
 */
function resolveAuthProbeRequired(profile) {
  const liveAdapterPreflight = asRecord(profile.live_adapter_preflight);
  const liveExecution = asRecord(profile.live_execution);
  const internalPolicy = asRecord(profile.internal_policy);
  return (
    liveAdapterPreflight.auth_probe_required !== false &&
    liveExecution.auth_probe_required !== false &&
    internalPolicy.auth_probe_required !== false
  );
}

/**
 * @param {string} command
 * @param {NodeJS.ProcessEnv} env
 * @param {string} cwd
 * @returns {string | null}
 */
function resolveCommandForPreflight(command, env, cwd) {
  if (path.isAbsolute(command)) {
    try {
      fs.accessSync(command, fs.constants.X_OK);
      return command;
    } catch {
      return null;
    }
  }

  if (command.includes("/") || command.includes("\\")) {
    const candidate = path.resolve(cwd, command);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      return null;
    }
  }

  const pathValue = env.PATH ?? process.env.PATH ?? "";
  for (const dirPath of pathValue.split(path.delimiter).filter((entry) => entry.length > 0)) {
    const candidate = path.join(dirPath, command);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // Keep searching PATH.
    }
  }
  return null;
}

/**
 * @param {{
 *   targetCheckoutRoot: string,
 *   providerVariant: Record<string, unknown>,
 *   providerVariantId: string,
 *   coverageTier: string,
 *   env: NodeJS.ProcessEnv,
 *   runnerAuthMode: string,
 *   runnerAuthSource: string,
 *   runtimeAgentPermissionMode: string,
 *   authProbeRequired: boolean,
 *   runId: string,
 *   reportsRoot: string,
 * }} options
 * @returns {{ status: string, summary: string, report: Record<string, unknown>, reportFile: string }}
 */
function runLiveAdapterPreflight(options) {
  const adapterId = asNonEmptyString(options.providerVariant.primary_adapter);
  const provider = asNonEmptyString(options.providerVariant.provider);
  const providerCoverageTier = asNonEmptyString(options.providerVariant.coverage_tier);
  const requiredProvider = options.coverageTier === "required" || providerCoverageTier === "required";
  const adapterProfileFile = path.join(options.targetCheckoutRoot, "examples", "adapters", `${normalizeId(adapterId)}.yaml`);
  const reportFile = path.join(
    options.reportsRoot,
    `live-adapter-preflight-${normalizeId(options.runId)}-${normalizeId(options.providerVariantId)}.json`,
  );
  const baseReport = {
    status: "pass",
    run_id: options.runId,
    provider_variant_id: options.providerVariantId,
    provider,
    primary_adapter: adapterId || null,
    coverage_tier: options.coverageTier,
    provider_coverage_tier: providerCoverageTier || null,
    required_provider: requiredProvider,
    runner_auth_mode: options.runnerAuthMode,
    runner_auth_source: options.runnerAuthSource,
    runtime_agent_permission_mode: options.runtimeAgentPermissionMode,
    adapter_profile_file: adapterProfileFile,
    auth_probe: {
      enabled: options.authProbeRequired,
      status: options.authProbeRequired ? "pending" : "skipped",
      attempts: [],
    },
    edit_readiness: {
      enabled: false,
      status: "not_required",
    },
    permission_readiness: {
      enabled: false,
      status: "not_required",
    },
    checked_at: nowIso(),
  };
  const fail = (failureKind, summary, extra = {}) => {
    const report = {
      ...baseReport,
      ...extra,
      status: "fail",
      failure_kind: failureKind,
      summary,
    };
    writeJson(reportFile, report);
    return {
      status: "fail",
      summary,
      report,
      reportFile,
    };
  };

  if (!adapterId) {
    return fail("missing-live-runtime", `Provider variant '${options.providerVariantId}' does not declare primary_adapter.`);
  }
  if (!fileExists(adapterProfileFile)) {
    return fail(
      "missing-live-runtime",
      `Provider variant '${options.providerVariantId}' references adapter '${adapterId}', but its adapter profile was not found.`,
    );
  }

  const loaded = loadContractFile({
    filePath: adapterProfileFile,
    family: "adapter-capability-profile",
  });
  if (!loaded.ok) {
    const issues = loaded.validation.issues.map((issue) => issue.message).join("; ");
    return fail("missing-live-runtime", `Adapter profile '${adapterId}' failed contract validation: ${issues}`);
  }

  const adapterProfile = asRecord(loaded.document);
  const execution = asRecord(adapterProfile.execution);
  const externalRuntime = asRecord(execution.external_runtime);
  const runtimeMode = asNonEmptyString(execution.runtime_mode);
  const liveBaseline = execution.live_baseline === true;
  const runtimeCommand = asNonEmptyString(externalRuntime.command);
  const timeoutMs = asPositiveInteger(externalRuntime.timeout_ms, 30000);
  const probeTimeoutMs = asPositiveInteger(externalRuntime.preflight_timeout_ms, Math.min(timeoutMs, 120000));
  const envOverrides = asStringMap(externalRuntime.env);
  const runnerEnv = {
    ...options.env,
    ...envOverrides,
  };
  const requestedPermissionMode =
    asNonEmptyString(runnerEnv.AOR_RUNTIME_AGENT_PERMISSION_MODE) || options.runtimeAgentPermissionMode;
  const runtimeInvocation = resolveExternalRuntimePermissionPolicy({
    externalRuntime,
    requestedMode: requestedPermissionMode,
  });
  const runtimeReport = {
    runtime_mode: runtimeMode || null,
    live_baseline: liveBaseline,
    external_runtime: {
      command: runtimeCommand || null,
      args: runtimeInvocation.args,
      timeout_ms: timeoutMs,
      preflight_timeout_ms: probeTimeoutMs,
      auth_probe_timeout_ms: probeTimeoutMs,
      permission_mode: runtimeInvocation.permissionMode,
      permission_mode_source: runtimeInvocation.source,
    },
  };

  if (runtimeMode !== "external-process") {
    return fail(
      "missing-live-runtime",
      `Adapter '${adapterId}' live runtime is misconfigured: execution.runtime_mode must be 'external-process'.`,
      runtimeReport,
    );
  }
  if (!runtimeCommand) {
    return fail(
      "missing-live-runtime",
      `Adapter '${adapterId}' live runtime is missing execution.external_runtime.command.`,
      runtimeReport,
    );
  }
  if (!runtimeInvocation.ok) {
    return fail(
      runtimeInvocation.failureKind,
      `Adapter '${adapterId}' live runtime permission policy is invalid: ${runtimeInvocation.message}`,
      runtimeReport,
    );
  }
  if (requiredProvider && runtimeInvocation.permissionMode !== requestedPermissionMode) {
    return fail(
      "permission-policy-invalid",
      `Adapter '${adapterId}' did not report selected runtime-agent permission mode '${requestedPermissionMode}'.`,
      runtimeReport,
    );
  }
  if (requiredProvider && !liveBaseline) {
    return fail(
      "missing-live-runtime",
      `Required provider variant '${options.providerVariantId}' points at adapter '${adapterId}', but execution.live_baseline is not true.`,
      runtimeReport,
    );
  }

  const resolvedCommand = resolveCommandForPreflight(runtimeCommand, runnerEnv, options.targetCheckoutRoot);
  if (!resolvedCommand) {
    return fail(
      "missing-command",
      `External runner command '${runtimeCommand}' is not available on PATH for adapter '${adapterId}'.`,
      runtimeReport,
    );
  }

  const permissionProbeRoot = path.join(
    options.targetCheckoutRoot,
    ".aor",
    "live-e2e-preflight",
    normalizeId(options.runId),
  );
  const permissionNonceFile = path.join(permissionProbeRoot, "permission-nonce.txt");
  const permissionMarkerFile = path.join(permissionProbeRoot, "permission-marker.txt");
  const permissionMarkerContents = `permission-readiness:${options.runId}`;

  const buildProbeInput = (stepClass, objective, extraRequest = {}) => `${JSON.stringify({
    request: {
      request_id: `live-adapter-preflight.${stepClass}`,
      run_id: options.runId,
      step_id: `live-adapter-preflight.${stepClass}`,
      step_class: stepClass,
      objective,
      non_interactive: true,
      ...extraRequest,
    },
    adapter: {
      adapter_id: adapterId,
      provider_variant_id: options.providerVariantId,
      permission_mode: runtimeInvocation.permissionMode,
    },
  })}\n`;
  const runProbeAttempt = (kind, attempt, objective, extraRequest = {}) => {
    const probe = spawnSync(resolvedCommand, runtimeInvocation.args, {
      cwd: options.targetCheckoutRoot,
      env: runnerEnv,
      encoding: "utf8",
      input: buildProbeInput(kind, objective, extraRequest),
      timeout: probeTimeoutMs,
      maxBuffer: 1024 * 1024,
    });
    const probeError = probe.error instanceof Error ? probe.error : null;
    const probeTimedOut =
      probeError?.code === "ETIMEDOUT" || (probe.signal === "SIGTERM" && probe.status === null);
    const commandFailed = probeError !== null || probeTimedOut || probe.status !== 0;
    const stdout = probe.stdout ?? "";
    const stderr = probe.stderr ?? "";
    const structuredFailureKind = stdoutHasStructuredPermissionDenials(stdout) ? "permission-mode-blocked" : "none";
    const semanticFailureKind =
      structuredFailureKind !== "none"
        ? structuredFailureKind
        : classifyExternalRunnerFailure({
            stdout,
            stderr,
            errorMessage: probeError?.message ?? null,
            defaultFailureKind: "none",
          });
    const commandFailureKind = classifyExternalRunnerFailure({
      stdout,
      stderr,
      errorMessage: probeError?.message ?? null,
      defaultFailureKind: "external-runner-failed",
    });
    const failureKind =
      probeError?.code === "ENOENT"
        ? "missing-command"
        : structuredFailureKind !== "none"
          ? structuredFailureKind
          : commandFailed
            ? commandFailureKind !== "external-runner-failed"
              ? commandFailureKind
              : probeTimedOut
                ? "external-runner-timeout"
                : commandFailureKind
            : semanticFailureKind === "none"
              ? null
              : semanticFailureKind;
    return {
      attempt,
      kind,
      status: failureKind ? "fail" : "pass",
      exit_code: probe.status,
      signal: probe.signal,
      timed_out: probeTimedOut,
      failure_kind: failureKind,
      error_code: probeError?.code ?? null,
      stdout_excerpt: stdout.slice(0, 4000),
      stderr_excerpt: stderr.slice(0, 4000),
    };
  };
  const authAttempts = [];
  let authProbeReport = {
    enabled: false,
    status: "skipped",
    attempts: authAttempts,
  };
  if (options.authProbeRequired) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const attemptResult = runProbeAttempt(
        "preflight",
        attempt,
        "Confirm that the external runner can authenticate and complete a minimal non-interactive invocation.",
      );
      authAttempts.push(attemptResult);
      if (attemptResult.status === "pass") {
        break;
      }
      const retryable =
        attempt === 1 &&
        ["external-runner-timeout", "auth-failed", "external-runner-failed"].includes(
          asNonEmptyString(attemptResult.failure_kind) || "",
        );
      if (!retryable) {
        break;
      }
    }
    const finalAuthAttempt = authAttempts[authAttempts.length - 1];
    if (!finalAuthAttempt || finalAuthAttempt.status !== "pass") {
      const failureKind = asNonEmptyString(finalAuthAttempt?.failure_kind) || "external-runner-failed";
      return fail(
        failureKind,
        `Live adapter preflight failed for adapter '${adapterId}' before run start.`,
        {
          ...runtimeReport,
          resolved_command: resolvedCommand,
          auth_probe: {
            enabled: true,
            status: "fail",
            attempts: authAttempts,
            exit_code: finalAuthAttempt?.exit_code ?? null,
            signal: finalAuthAttempt?.signal ?? null,
            timed_out: finalAuthAttempt?.timed_out === true,
            failure_kind: failureKind,
            error_code: finalAuthAttempt?.error_code ?? null,
          },
        },
      );
    }
    authProbeReport = {
      enabled: true,
      status: "pass",
      attempts: authAttempts,
      exit_code: finalAuthAttempt.exit_code,
      signal: finalAuthAttempt.signal,
      timed_out: false,
    };
  }

  const editReadiness = requiredProvider
    ? runProbeAttempt(
        "preflight-edit-readiness",
        1,
        "Confirm that the external runner is allowed to perform bounded non-interactive edits in this isolated target checkout. Do not ask questions.",
      )
    : null;
  if (editReadiness && editReadiness.status !== "pass") {
    const failureKind = asNonEmptyString(editReadiness.failure_kind) || "permission-mode-blocked";
    return fail(
      failureKind,
      `Live adapter preflight failed edit-readiness for adapter '${adapterId}' before run start.`,
      {
        ...runtimeReport,
        resolved_command: resolvedCommand,
        auth_probe: authProbeReport,
        edit_readiness: {
          enabled: true,
          status: "fail",
          failure_kind: failureKind,
          attempts: [editReadiness],
        },
      },
    );
  }

  let permissionReadiness = null;
  if (requiredProvider) {
    fs.mkdirSync(permissionProbeRoot, { recursive: true });
    fs.writeFileSync(permissionNonceFile, `${permissionMarkerContents}\n`, "utf8");
    fs.rmSync(permissionMarkerFile, { force: true });
    permissionReadiness = runProbeAttempt(
      "preflight-permission-readiness",
      1,
      [
        "Confirm that the external runner can read a nonce file and write a marker file in the isolated runtime root.",
        `Read ${permissionNonceFile}.`,
        `Write exactly '${permissionMarkerContents}' to ${permissionMarkerFile}.`,
        "Do not ask questions.",
      ].join(" "),
      {
        permission_probe: {
          nonce_file: permissionNonceFile,
          marker_file: permissionMarkerFile,
          expected_marker_contents: permissionMarkerContents,
        },
      },
    );
    const markerContents = fileExists(permissionMarkerFile)
      ? fs.readFileSync(permissionMarkerFile, "utf8").trim()
      : "";
    const markerStatus =
      markerContents === permissionMarkerContents
        ? "present"
        : markerContents
          ? "unexpected-contents"
          : "missing";
    if (
      permissionReadiness.status === "fail" &&
      permissionReadiness.failure_kind === "external-runner-timeout" &&
      markerContents === permissionMarkerContents
    ) {
      permissionReadiness = {
        ...permissionReadiness,
        status: "pass",
        failure_kind: null,
        warning_kind: "post-marker-timeout",
        warnings: [
          {
            code: "post-marker-timeout",
            summary:
              "Permission readiness marker matched before the external runner timed out; access readiness passed, but runner completion was slow.",
          },
        ],
        marker_file: permissionMarkerFile,
        marker_status: markerStatus,
      };
    } else if (permissionReadiness.status === "pass" && markerContents !== permissionMarkerContents) {
      permissionReadiness = {
        ...permissionReadiness,
        status: "fail",
        failure_kind: "permission-mode-blocked",
        marker_file: permissionMarkerFile,
        marker_status: markerStatus,
      };
    } else {
      permissionReadiness = {
        ...permissionReadiness,
        marker_file: permissionMarkerFile,
        marker_status: markerStatus,
      };
    }
  }
  if (permissionReadiness && permissionReadiness.status !== "pass") {
    const failureKind = asNonEmptyString(permissionReadiness.failure_kind) || "permission-mode-blocked";
    return fail(
      failureKind,
      `Live adapter preflight failed permission-readiness for adapter '${adapterId}' before run start.`,
      {
        ...runtimeReport,
        resolved_command: resolvedCommand,
        auth_probe: authProbeReport,
        edit_readiness: editReadiness
          ? {
              enabled: true,
              status: "pass",
              attempts: [editReadiness],
            }
          : {
              enabled: false,
              status: "not_required",
            },
        permission_readiness: {
          enabled: true,
          status: "fail",
          failure_kind: failureKind,
          attempts: [permissionReadiness],
          nonce_file: permissionNonceFile,
          marker_file: permissionMarkerFile,
        },
      },
    );
  }

  const report = {
    ...baseReport,
    ...runtimeReport,
    resolved_command: resolvedCommand,
    auth_probe: authProbeReport,
    edit_readiness: editReadiness
      ? {
          enabled: true,
          status: "pass",
          attempts: [editReadiness],
        }
      : {
          enabled: false,
          status: "not_required",
        },
    permission_readiness: permissionReadiness
      ? {
          enabled: true,
          status: "pass",
          attempts: [permissionReadiness],
          nonce_file: permissionNonceFile,
          marker_file: permissionMarkerFile,
        }
      : {
          enabled: false,
          status: "not_required",
        },
    summary: `Live adapter preflight passed for provider variant '${options.providerVariantId}'.`,
  };
  writeJson(reportFile, report);
  return {
    status: "pass",
    summary: asNonEmptyString(report.summary),
    report,
    reportFile,
  };
}

/**
 * @param {Record<string, string>} routeOverrides
 * @returns {string | null}
 */
function serializeRouteOverrides(routeOverrides) {
  const pairs = Object.entries(routeOverrides)
    .filter(([, routeId]) => typeof routeId === "string" && routeId.length > 0)
    .map(([step, routeId]) => `${step}=${routeId}`);
  return pairs.length > 0 ? pairs.join(",") : null;
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
    label: options.label,
    ok: run.status === 0 && parsed !== null,
    exitCode: run.status ?? -1,
    stdout: run.stdout ?? "",
    stderr: run.stderr ?? "",
    payload: parsed,
    transcriptFile,
    startedAt,
    finishedAt,
    durationSec: resolveDurationSeconds(startedAt, finishedAt),
    commandSurface:
      options.args.length >= 2 ? `aor ${options.args[0]} ${options.args[1]}` : `aor ${options.args.join(" ")}`.trim(),
  };
}

/**
 * @param {string} startedAt
 * @param {string} finishedAt
 * @returns {number | null}
 */
function resolveDurationSeconds(startedAt, finishedAt) {
  const startedMs = Date.parse(startedAt);
  const finishedMs = Date.parse(finishedAt);
  if (!Number.isFinite(startedMs) || !Number.isFinite(finishedMs) || finishedMs < startedMs) {
    return null;
  }
  return Math.round(((finishedMs - startedMs) / 1000) * 1000) / 1000;
}

/**
 * @param {ReturnType<typeof runAorCommand>} result
 * @returns {Record<string, unknown>}
 */
function buildCommandDiagnostic(result) {
  return {
    label: result.label,
    command_surface: result.commandSurface,
    status: result.ok ? "pass" : "fail",
    exit_code: result.exitCode,
    started_at: result.startedAt,
    finished_at: result.finishedAt,
    duration_sec: result.durationSec,
    transcript_file: result.transcriptFile,
    artifact_refs: uniqueStrings(collectStringRefs(result.payload)),
    failure_class: result.ok ? null : "command-failed",
    missing_evidence: [],
    recommendation: result.ok ? "continue" : "inspect transcript and command stderr",
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
 * @param {string} status
 * @returns {"pass" | "warn" | "not_pass"}
 */
function toObservationStatus(status) {
  const normalized = asNonEmptyString(status).toLowerCase();
  if (normalized === "pass" || normalized === "passed" || normalized === "success") return "pass";
  if (normalized === "warn" || normalized === "warning" || normalized === "skipped") return "warn";
  return "not_pass";
}

/**
 * @param {"pass" | "warn" | "not_pass" | string} left
 * @param {"pass" | "warn" | "not_pass" | string} right
 * @returns {"pass" | "warn" | "not_pass"}
 */
function worstObservationStatus(left, right) {
  const statuses = [toObservationStatus(left), toObservationStatus(right)];
  if (statuses.includes("not_pass")) return "not_pass";
  if (statuses.includes("warn")) return "warn";
  return "pass";
}

/**
 * @param {string | null} filePath
 * @returns {Record<string, unknown>}
 */
function readJsonIfPresent(filePath) {
  const resolved = asNonEmptyString(filePath);
  return resolved && fileExists(resolved) ? asRecord(readJson(resolved)) : {};
}

/**
 * @param {Record<string, unknown>} artifacts
 * @returns {string[]}
 */
function collectDeliveryChangedPaths(artifacts) {
  const deliveryManifest = readJsonIfPresent(asNonEmptyString(artifacts.delivery_manifest_file));
  const deliveryPaths = Array.isArray(deliveryManifest.repo_deliveries)
    ? deliveryManifest.repo_deliveries.flatMap((entry) => asStringArray(asRecord(entry).changed_paths))
    : [];
  const reviewReport = readJsonIfPresent(asNonEmptyString(artifacts.review_report_file));
  const reviewPaths = asStringArray(asRecord(reviewReport.code_quality).changed_paths);
  return uniqueStrings([...deliveryPaths, ...reviewPaths]);
}

/**
 * @param {Record<string, unknown>} artifacts
 * @returns {{ status: "pass" | "warn" | "not_pass", delivery_manifest_ref: string | null, review_report_ref: string | null, post_delivery_check_refs: string[], changed_paths: string[], findings: string[] }}
 */
function buildCodeQualityObservation(artifacts) {
  const deliveryManifestRef = asNonEmptyString(artifacts.delivery_manifest_file) || null;
  const reviewReportRef = asNonEmptyString(artifacts.review_report_file) || null;
  const deliveryQualityGateStatus = asNonEmptyString(artifacts.delivery_quality_gate_status);
  const postDeliveryCheckRefs = uniqueStrings([
    asNonEmptyString(artifacts.post_run_verify_summary_file),
    asNonEmptyString(artifacts.post_run_diagnostic_verify_summary_file),
  ]);
  const reviewReport = readJsonIfPresent(reviewReportRef);
  const reviewCodeQuality = asRecord(reviewReport.code_quality);
  const findings = uniqueStrings([
    ...asFindingStrings(reviewCodeQuality.findings),
    ...(asNonEmptyString(artifacts.provider_execution_status) === "fail"
      ? ["provider execution evidence was not materialized"]
      : []),
    ...(asNonEmptyString(artifacts.real_code_change_status) === "fail" ? ["no mission-scoped code change observed"] : []),
    ...(asNonEmptyString(artifacts.post_run_verify_status) === "fail" ? ["post-delivery verification failed"] : []),
    ...(asNonEmptyString(artifacts.quality_gate_decision) === "fail" ? ["legacy quality gate decision failed"] : []),
    ...(["fail", "not_pass"].includes(deliveryQualityGateStatus)
      ? ["delivery quality gate produced observed findings"]
      : []),
    ...asStringArray(artifacts.delivery_quality_gate_findings),
  ]);
  const reviewCodeStatus = normalizeVerdictStatus(reviewCodeQuality.status);
  const status =
    !deliveryManifestRef
      ? "not_pass"
      : asNonEmptyString(artifacts.provider_execution_status) === "fail" ||
          asNonEmptyString(artifacts.real_code_change_status) === "fail" ||
          asNonEmptyString(artifacts.post_run_verify_status) === "fail" ||
          asNonEmptyString(artifacts.quality_gate_decision) === "fail" ||
          ["fail", "not_pass"].includes(deliveryQualityGateStatus) ||
          reviewCodeStatus === "fail"
        ? "not_pass"
        : findings.length > 0 || reviewCodeStatus === "warn"
          ? "warn"
          : "pass";
  return {
    status,
    delivery_manifest_ref: deliveryManifestRef,
    review_report_ref: reviewReportRef,
    post_delivery_check_refs: postDeliveryCheckRefs,
    changed_paths: collectDeliveryChangedPaths(artifacts),
    findings,
  };
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
 * @param {Record<string, unknown>} profile
 * @returns {"diagnostic" | "blocking"}
 */
function resolveBaselineGateMode(profile) {
  const mode = asNonEmptyString(asRecord(asRecord(profile.verification).baseline_gate).mode).toLowerCase();
  if (mode === "blocking") return "blocking";
  if (mode === "diagnostic") return "diagnostic";
  return asNonEmptyString(profile.journey_mode) === "full-journey" ? "diagnostic" : "blocking";
}

/**
 * @param {{ sourcePath: string | null, destinationRoot: string, runId: string, phase: string, index: number }} options
 * @returns {string | null}
 */
function preserveRuntimeFile(options) {
  const sourcePath = asNonEmptyString(options.sourcePath);
  if (!sourcePath || !fileExists(sourcePath)) return null;
  const destination = path.join(
    options.destinationRoot,
    `live-e2e-${normalizeId(options.phase)}-${normalizeId(options.runId)}-${String(options.index).padStart(2, "0")}-${path.basename(sourcePath)}`,
  );
  fs.copyFileSync(sourcePath, destination);
  return destination;
}

/**
 * @param {{ verifyPayload: Record<string, unknown>, summaryFile: string, reportsRoot: string, runId: string, phase: string }} options
 */
function preserveVerifyArtifacts(options) {
  /** @type {string[]} */
  const preservedFiles = [];
  let index = 1;
  const preserve = (filePath) => {
    const preserved = preserveRuntimeFile({
      sourcePath: asNonEmptyString(filePath),
      destinationRoot: options.reportsRoot,
      runId: options.runId,
      phase: options.phase,
      index,
    });
    index += 1;
    if (preserved) preservedFiles.push(preserved);
    return preserved;
  };

  const preservedSummaryFile = preserve(options.summaryFile);
  /** @type {string[]} */
  const preservedStepResultFiles = [];
  for (const stepResultFile of asStringArray(options.verifyPayload.step_result_files)) {
    const preservedStep = preserve(stepResultFile);
    if (preservedStep) preservedStepResultFiles.push(preservedStep);
    if (fileExists(stepResultFile)) {
      const stepResult = readJson(stepResultFile);
      for (const evidenceRef of asStringArray(asRecord(stepResult).evidence_refs)) {
        preserve(evidenceRef);
      }
    }
  }

  return {
    preserved_summary_file: preservedSummaryFile,
    preserved_step_result_files: preservedStepResultFiles,
    preserved_files: preservedFiles,
  };
}

/**
 * @param {{ verifySummary: Record<string, unknown>, verifyPayload: Record<string, unknown>, stepResultFiles: string[], setupCommands: string[], verificationCommands: string[], mode: "diagnostic" | "blocking" }} options
 */
function evaluateBaselineVerifyGate(options) {
  const failedSteps = options.stepResultFiles
    .filter((filePath) => fileExists(filePath))
    .map((filePath) => ({ filePath, document: asRecord(readJson(filePath)) }))
    .filter((entry) => asNonEmptyString(entry.document.status) === "failed");
  const routedStepResultFile = asNonEmptyString(options.verifyPayload.routed_step_result_file);
  const routedStepResult = routedStepResultFile && fileExists(routedStepResultFile)
    ? asRecord(readJson(routedStepResultFile))
    : {};
  const setupCommandSet = new Set(options.setupCommands);
  const verificationCommandSet = new Set(options.verificationCommands);
  const validationGateStatus = asNonEmptyString(options.verifySummary.validation_gate_status);
  /** @type {string[]} */
  const blockingReasons = [];
  /** @type {string[]} */
  const findings = [];
  /** @type {Array<Record<string, unknown>>} */
  const failedCommands = [];

  if (validationGateStatus && validationGateStatus !== "pass") {
    blockingReasons.push(`validation-gate-${validationGateStatus}`);
  }
  if (!routedStepResultFile || !fileExists(routedStepResultFile)) {
    blockingReasons.push("routed-dry-run-missing");
  } else if (asNonEmptyString(routedStepResult.status) !== "passed") {
    blockingReasons.push("routed-dry-run-failed");
  }

  for (const failedStep of failedSteps) {
    const command = asNonEmptyString(failedStep.document.command);
    const missingPrerequisites = asStringArray(failedStep.document.missing_prerequisites);
    const summary = asNonEmptyString(failedStep.document.summary) || "Verification step failed.";
    failedCommands.push({
      command,
      summary,
      missing_prerequisites: missingPrerequisites,
      step_result_file: failedStep.filePath,
    });
    if (missingPrerequisites.length > 0) {
      blockingReasons.push(`missing-prerequisite:${command || "unknown"}`);
    } else if (command && setupCommandSet.has(command)) {
      blockingReasons.push(`readiness-command-failed:${command}`);
    } else if (!command || !verificationCommandSet.has(command)) {
      blockingReasons.push(`unknown-verification-failure:${command || "unknown"}`);
    } else {
      findings.push(summary);
    }
  }

  if (blockingReasons.length > 0) {
    return {
      phase: "baseline_diagnostic",
      mode: options.mode,
      status: "fail",
      decision: "block",
      summary: blockingReasons[0],
      blocking_reasons: uniqueStrings(blockingReasons),
      findings,
      failed_commands: failedCommands,
      routed_step_result_file: routedStepResultFile || null,
    };
  }

  if (asNonEmptyString(options.verifySummary.status) === "failed") {
    return {
      phase: "baseline_diagnostic",
      mode: options.mode,
      status: options.mode === "blocking" ? "fail" : "warn",
      decision: options.mode === "blocking" ? "block" : "continue_with_warnings",
      summary:
        options.mode === "blocking"
          ? "Baseline verification failed in blocking mode."
          : "Baseline target verification failed, but readiness gates passed; continuing to provider execution.",
      blocking_reasons: options.mode === "blocking" ? ["baseline-verification-failed"] : [],
      findings,
      failed_commands: failedCommands,
      routed_step_result_file: routedStepResultFile || null,
    };
  }

  return {
    phase: "baseline_diagnostic",
    mode: options.mode,
    status: "pass",
    decision: "pass",
    summary: "Baseline readiness and target verification passed.",
    blocking_reasons: [],
    findings,
    failed_commands: failedCommands,
    routed_step_result_file: routedStepResultFile || null,
  };
}

/**
 * @param {Record<string, unknown>} mission
 * @param {Record<string, unknown>} catalogVerification
 * @returns {{ primaryCommands: string[], diagnosticCommands: string[], diagnosticFailureMode: "warn" | "fail" }}
 */
function resolvePostRunQualityPolicy(mission, catalogVerification) {
  const policy = hasObjectFields(asRecord(mission.post_run_quality))
    ? asRecord(mission.post_run_quality)
    : asRecord(mission.postRunQuality);
  const primaryCommands = asStringArray(policy.primary_commands);
  const diagnosticCommands = asStringArray(policy.diagnostic_commands);
  const diagnosticFailureMode = asNonEmptyString(policy.diagnostic_failure_mode) === "fail" ? "fail" : "warn";
  return {
    primaryCommands: primaryCommands.length > 0 ? primaryCommands : asStringArray(catalogVerification.commands),
    diagnosticCommands,
    diagnosticFailureMode,
  };
}

/**
 * @param {{ label: string, commands: string[] }} options
 * @returns {string[]}
 */
function buildVerifyOverrideArgs(options) {
  const lintCommands = options.commands.filter((command) => /\b(?:xo|eslint|biome|lint)\b/u.test(command));
  const buildCommands = options.commands.filter((command) => /\b(?:build|tsc)\b/u.test(command));
  const testCommands = options.commands.filter((command) => !lintCommands.includes(command) && !buildCommands.includes(command));
  return [
    "--verification-label",
    options.label,
    ...buildCommands.flatMap((entry) => ["--repo-build-command", entry]),
    ...lintCommands.flatMap((entry) => ["--repo-lint-command", entry]),
    ...testCommands.flatMap((entry) => ["--repo-test-command", entry]),
  ];
}

/**
 * @param {string | null | undefined} reportFile
 * @returns {boolean}
 */
function runtimeHarnessReportHasMissionScopedChanges(reportFile) {
  const resolvedReportFile = asNonEmptyString(reportFile);
  if (!resolvedReportFile || !fileExists(resolvedReportFile)) {
    return false;
  }
  const report = asRecord(readJson(resolvedReportFile));
  const stepDecisions = Array.isArray(report.step_decisions) ? report.step_decisions : [];
  return stepDecisions.some((entry) => {
    const semantics = asRecord(asRecord(entry).mission_semantics);
    return asStringArray(semantics.mission_scoped_changed_paths).length > 0;
  });
}

/**
 * @param {{ runId: string, reportsRoot: string, liveAdapterPreflightFile: string | null, validationReportFile: string | null, baselineGateDecision: Record<string, unknown>, baselineRoutedStepResultFile: string | null }}
 */
function writeExecutionReadinessDecision(options) {
  const decisionFile = path.join(
    options.reportsRoot,
    `live-e2e-execution-readiness-${normalizeId(options.runId)}.json`,
  );
  const decision = {
    run_id: options.runId,
    phase: "readiness",
    status: "pass",
    summary: "Execution readiness passed; baseline target verification is diagnostic evidence for full-journey live E2E.",
    live_adapter_preflight_file: options.liveAdapterPreflightFile,
    validation_report_file: options.validationReportFile,
    baseline_gate_decision: options.baselineGateDecision,
    baseline_routed_step_result_file: options.baselineRoutedStepResultFile,
    checked_at: nowIso(),
  };
  writeJson(decisionFile, decision);
  return { decisionFile, decision };
}

/**
 * @param {{
 *   scenarioPolicy: Record<string, unknown>,
 *   stageResults: Array<{ stage: string, status: string, evidence_refs: string[], summary: string | null }>,
 *   artifacts: Record<string, unknown>,
 *   auditPayload: Record<string, unknown>,
 * }} options
 */
function evaluateScenarioCoverage(options) {
  const requiredStages = asStringArray(options.scenarioPolicy.required_stages);
  const requiredEvidence = asStringArray(options.scenarioPolicy.required_evidence);
  const stageStatuses = new Map(
    options.stageResults.map((stageResult) => [stageResult.stage, asNonEmptyString(stageResult.status) || "unknown"]),
  );
  /** @type {string[]} */
  const findings = [];

  for (const stage of requiredStages) {
    const stageStatus = stageStatuses.get(stage) || "missing";
    if (stageStatus !== "pass") {
      findings.push(`Required scenario stage '${stage}' completed with status '${stageStatus}'.`);
    }
  }

  const hasAuditRuns =
    Boolean(options.artifacts.run_audit_file) ||
    Array.isArray(asRecord(options.auditPayload).run_audit_records) ||
    Array.isArray(asRecord(options.auditPayload).run_summaries);
  const evidencePresence = {
    "verify-summary": Boolean(options.artifacts.verify_summary_file),
    "routed-step-result": Boolean(options.artifacts.routed_step_result_file),
    "runtime-harness-report": Boolean(options.artifacts.runtime_harness_report_file),
    "review-report": Boolean(options.artifacts.review_report_file),
    "evaluation-report": Boolean(options.artifacts.evaluation_report_file),
    "delivery-manifest": Boolean(options.artifacts.delivery_manifest_file),
    "release-packet": Boolean(options.artifacts.release_packet_file),
    "audit-runs": hasAuditRuns,
    "learning-loop-scorecard": Boolean(options.artifacts.learning_loop_scorecard_file),
    "learning-loop-handoff": Boolean(options.artifacts.learning_loop_handoff_file),
  };

  for (const evidenceId of requiredEvidence) {
    if (evidencePresence[evidenceId] !== true) {
      findings.push(`Required scenario evidence '${evidenceId}' was not materialized.`);
    }
  }

  return {
    status: findings.length > 0 ? "fail" : "pass",
    required_stages: requiredStages,
    required_evidence: requiredEvidence,
    findings,
    summary:
      findings[0] ??
      `Scenario policy '${asNonEmptyString(options.scenarioPolicy.scenario_family) || "unknown"}' coverage passed.`,
  };
}

/**
 * @param {unknown} value
 * @returns {unknown}
 */
function sortJsonValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => sortJsonValue(entry));
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(/** @type {Record<string, unknown>} */ (value))
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortJsonValue(entry)]),
    );
  }
  return value;
}

/**
 * @param {unknown} left
 * @param {unknown} right
 * @returns {boolean}
 */
function jsonEquivalent(left, right) {
  return JSON.stringify(sortJsonValue(left)) === JSON.stringify(sortJsonValue(right));
}

/**
 * @param {Record<string, unknown>} value
 * @returns {boolean}
 */
function hasObjectFields(value) {
  return Object.keys(value).length > 0;
}

/**
 * @param {{
 *   label: string,
 *   field: string,
 *   expected: Record<string, unknown>,
 *   actual: Record<string, unknown>,
 *   findings: string[],
 * }} options
 */
function compareArtifactObject(options) {
  if (!hasObjectFields(options.actual)) {
    options.findings.push(`Artifact consistency mismatch: ${options.label}.${options.field} is missing.`);
    return;
  }
  if (!jsonEquivalent(options.actual, options.expected)) {
    options.findings.push(`Artifact consistency mismatch: ${options.label}.${options.field} differs from summary.`);
  }
}

/**
 * @param {{
 *   artifacts: Record<string, unknown>,
 *   reviewReport: Record<string, unknown>,
 *   auditPayload: Record<string, unknown>,
 *   runId: string,
 * }} options
 */
function evaluateArtifactConsistency(options) {
  /** @type {string[]} */
  const findings = [];
  const expectedMatrixCell = asRecord(options.artifacts.matrix_cell);
  const expectedCoverageFollowUp = asRecord(options.artifacts.coverage_follow_up);
  const reviewFeatureTraceability = asRecord(options.reviewReport.feature_traceability);
  const auditRecords = Array.isArray(options.auditPayload.run_audit_records)
    ? options.auditPayload.run_audit_records.map((record) => asRecord(record))
    : [];
  const auditRecord =
    auditRecords.find((record) => asNonEmptyString(record.run_id) === options.runId) || auditRecords[0] || {};
  const learningHandoffFile = asNonEmptyString(options.artifacts.learning_loop_handoff_file);
  const learningScorecardFile = asNonEmptyString(options.artifacts.learning_loop_scorecard_file);
  const learningHandoff = learningHandoffFile && fileExists(learningHandoffFile) ? readJson(learningHandoffFile) : {};
  const learningScorecard =
    learningScorecardFile && fileExists(learningScorecardFile) ? readJson(learningScorecardFile) : {};

  if (!hasObjectFields(expectedMatrixCell)) {
    findings.push("Artifact consistency mismatch: summary.matrix_cell is missing.");
  }
  if (!hasObjectFields(expectedCoverageFollowUp)) {
    findings.push("Artifact consistency mismatch: summary.coverage_follow_up is missing.");
  }

  if (hasObjectFields(expectedMatrixCell)) {
    compareArtifactObject({
      label: "review-report.feature_traceability",
      field: "matrix_cell",
      expected: expectedMatrixCell,
      actual: asRecord(reviewFeatureTraceability.matrix_cell),
      findings,
    });
    compareArtifactObject({
      label: "audit-runs.run_audit_records[0]",
      field: "matrix_cell",
      expected: expectedMatrixCell,
      actual: asRecord(auditRecord.matrix_cell),
      findings,
    });
    compareArtifactObject({
      label: "learning-loop-handoff",
      field: "matrix_cell",
      expected: expectedMatrixCell,
      actual: asRecord(learningHandoff.matrix_cell),
      findings,
    });
    compareArtifactObject({
      label: "learning-loop-scorecard",
      field: "matrix_cell",
      expected: expectedMatrixCell,
      actual: asRecord(learningScorecard.matrix_cell),
      findings,
    });
  }

  if (hasObjectFields(expectedCoverageFollowUp)) {
    compareArtifactObject({
      label: "review-report.feature_traceability",
      field: "coverage_follow_up",
      expected: expectedCoverageFollowUp,
      actual: asRecord(reviewFeatureTraceability.coverage_follow_up),
      findings,
    });
    compareArtifactObject({
      label: "audit-runs.run_audit_records[0]",
      field: "coverage_follow_up",
      expected: expectedCoverageFollowUp,
      actual: asRecord(auditRecord.coverage_follow_up),
      findings,
    });
    compareArtifactObject({
      label: "learning-loop-handoff",
      field: "coverage_follow_up",
      expected: expectedCoverageFollowUp,
      actual: asRecord(learningHandoff.coverage_follow_up),
      findings,
    });
    compareArtifactObject({
      label: "learning-loop-scorecard",
      field: "coverage_follow_up",
      expected: expectedCoverageFollowUp,
      actual: asRecord(learningScorecard.coverage_follow_up),
      findings,
    });
  }

  return {
    status: findings.length > 0 ? "fail" : "pass",
    findings,
    summary: findings[0] ?? "Full-journey artifact lineage is internally consistent.",
  };
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
 *   runnerAuthMode: "host" | "isolated",
 *   runtimeAgentPermissionMode: "full-bypass" | "restricted",
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
  const proofRunnerEnvironment = createProofRunnerEnvironment({
    sessionRoots,
    runnerAuthMode: options.runnerAuthMode,
  });
  const env = proofRunnerEnvironment.env;
  env.AOR_RUNTIME_AGENT_PERMISSION_MODE = options.runtimeAgentPermissionMode;

  const artifacts = {
    host_runtime_root: options.layout.runtimeRoot,
    host_reports_root: options.layout.reportsRoot,
    session_root: sessionRoots.sessionRoot,
    aor_home: sessionRoots.aorHome,
    codex_home: sessionRoots.codexHome,
    codex_home_isolated: options.runnerAuthMode === "isolated",
    runner_auth_mode: proofRunnerEnvironment.runnerAuthMode,
    runner_auth_source: proofRunnerEnvironment.runnerAuthSource,
    runtime_agent_permission_mode: options.runtimeAgentPermissionMode,
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
    const runCommand = (label, args, runOptions = {}) => {
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
      commandResults.push(buildCommandDiagnostic(result));
      if (!result.ok && !(runOptions.allowNonZeroWithPayload === true && result.payload)) {
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
      artifacts.execution_degraded === true ? "fail" : "pass",
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
          "warn",
          uniqueStrings([evalRun.transcriptFile, ...collectStringRefs(evalRun.payload)]),
          "Evaluation report produced observed findings.",
        );
      } else {
        markStage(
          stageMap,
          "qa",
          "pass",
          uniqueStrings([evalRun.transcriptFile, ...collectStringRefs(evalRun.payload)]),
          "Eval run passed.",
        );
      }
      if (evaluationStatus === "pass" && getHarnessCertification(options.profile) === null) {
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
          "warn",
          uniqueStrings([certify.transcriptFile, ...collectStringRefs(certify.payload)]),
          "Harness certification produced observed findings.",
        );
      } else {
        markStage(
          stageMap,
          "review",
          "pass",
          uniqueStrings([certify.transcriptFile, ...collectStringRefs(certify.payload)]),
          "Harness certification passed.",
        );
      }
    } else if (stageMap.review?.status === "pending") {
      markStage(stageMap, "review", "skipped", [], "Profile has no harness certification step.");
    }

    const deliverArgs = [
      "deliver",
      "prepare",
      ...commandBaseArgs,
      "--run-id",
      options.runId,
      "--step-class",
      "implement",
      "--mode",
      getPreferredDeliveryMode(options.profile),
      "--quality-gate-mode",
      "observe",
    ];
    if (artifacts.approved_handoff_packet_file) {
      deliverArgs.push("--approved-handoff-ref", /** @type {string} */ (artifacts.approved_handoff_packet_file));
    }
    if (promotionEvidenceRefs.length > 0) {
      deliverArgs.push("--promotion-evidence-refs", uniqueStrings(promotionEvidenceRefs).join(","));
    }
    const deliver = runCommand("deliver-prepare", deliverArgs, { allowNonZeroWithPayload: true });
    const deliveryRuntimeHarnessReportFile = getStringField(deliver.payload, "runtime_harness_report_file");
    Object.assign(artifacts, {
      delivery_plan_file: getStringField(deliver.payload, "delivery_plan_file"),
      delivery_manifest_file: getStringField(deliver.payload, "delivery_manifest_file"),
      delivery_transcript_file: getStringField(deliver.payload, "delivery_transcript_file"),
      delivery_mode: getStringField(deliver.payload, "delivery_mode"),
      delivery_quality_gate_mode: getStringField(deliver.payload, "delivery_quality_gate_mode"),
      delivery_quality_gate_status: getStringField(deliver.payload, "delivery_quality_gate_status"),
      delivery_quality_gate_findings: asStringArray(deliver.payload?.delivery_quality_gate_findings),
      delivery_runtime_harness_report_file: deliveryRuntimeHarnessReportFile,
      runtime_harness_report_file:
        asNonEmptyString(artifacts.runtime_harness_report_file) || deliveryRuntimeHarnessReportFile,
      delivery_blocking: deliver.payload?.delivery_blocking === true,
      delivery_blocking_reasons: asStringArray(deliver.payload?.delivery_blocking_reasons),
    });
    if (!artifacts.delivery_manifest_file) {
      markStage(
        stageMap,
        "delivery",
        "fail",
        uniqueStrings([deliver.transcriptFile, ...collectStringRefs(deliver.payload)]),
        "Delivery prepare did not materialize delivery evidence.",
      );
      throw new Error("Delivery prepare did not materialize delivery evidence.");
    }
    markStage(
      stageMap,
      "delivery",
      artifacts.delivery_blocking === true || artifacts.delivery_quality_gate_status === "not_pass" ? "warn" : "pass",
      uniqueStrings([deliver.transcriptFile, ...collectStringRefs(deliver.payload)]),
      artifacts.delivery_blocking === true || artifacts.delivery_quality_gate_status === "not_pass"
        ? "Delivery evidence materialized with observed quality findings."
        : "Delivery prepare materialized delivery evidence.",
    );
    markStage(stageMap, "release", "skipped", [], "Observation v1 ends at delivery.");

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
 *   scenarioPolicyPath: string,
 *   scenarioPolicy: Record<string, unknown>,
 *   providerVariantPath: string,
 *   providerVariant: Record<string, unknown>,
 *   featureSize: string,
 *   matrixCell: Record<string, unknown>,
 *   coverageFollowUp: Record<string, unknown>,
 *   coverageTier: string,
 *   runnerAuthMode: "host" | "isolated",
 *   runtimeAgentPermissionMode: "full-bypass" | "restricted",
 *   authProbeRequired: boolean,
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
  const proofRunnerEnvironment = createProofRunnerEnvironment({
    sessionRoots,
    runnerAuthMode: options.runnerAuthMode,
  });
  const env = proofRunnerEnvironment.env;
  env.AOR_RUNTIME_AGENT_PERMISSION_MODE = options.runtimeAgentPermissionMode;
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
    codex_home_isolated: options.runnerAuthMode === "isolated",
    runner_auth_mode: proofRunnerEnvironment.runnerAuthMode,
    runner_auth_source: proofRunnerEnvironment.runnerAuthSource,
    runtime_agent_permission_mode: options.runtimeAgentPermissionMode,
    target_catalog_file: options.catalogTargetPath,
    scenario_policy_file: options.scenarioPolicyPath,
    provider_variant_file: options.providerVariantPath,
    feature_mission_id: asNonEmptyString(options.mission.mission_id) || null,
    scenario_family: asNonEmptyString(options.profile.scenario_family) || null,
    provider_variant_id: asNonEmptyString(options.profile.provider_variant_id) || null,
    feature_size: options.featureSize,
    matrix_cell: options.matrixCell,
    coverage_follow_up: options.coverageFollowUp,
    coverage_tier: options.coverageTier,
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
    const runCommand = (label, args, runOptions = {}) => {
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
      commandResults.push(buildCommandDiagnostic(result));
      if (!result.ok && !(runOptions.allowNonZeroWithPayload === true && result.payload)) {
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
    const providerRoutes = materializeProviderPinnedRouteOverrides({
      targetCheckoutRoot: targetCheckout.targetCheckoutRoot,
      providerVariant: options.providerVariant,
      providerVariantId: asNonEmptyString(options.profile.provider_variant_id),
    });
    artifacts.provider_route_override_files = providerRoutes.routeFiles;
    artifacts.provider_route_overrides = providerRoutes.routeOverrides;
    const routeOverridesFlag = serializeRouteOverrides(providerRoutes.routeOverrides);
    const liveAdapterPreflight = runLiveAdapterPreflight({
      targetCheckoutRoot: targetCheckout.targetCheckoutRoot,
      providerVariant: options.providerVariant,
      providerVariantId: asNonEmptyString(options.profile.provider_variant_id),
      coverageTier: options.coverageTier,
      env,
      runnerAuthMode: proofRunnerEnvironment.runnerAuthMode,
      runnerAuthSource: proofRunnerEnvironment.runnerAuthSource,
      runtimeAgentPermissionMode: options.runtimeAgentPermissionMode,
      authProbeRequired: options.authProbeRequired,
      runId: options.runId,
      reportsRoot: options.layout.reportsRoot,
    });
    artifacts.live_adapter_preflight_file = liveAdapterPreflight.reportFile;
    artifacts.live_adapter_preflight = liveAdapterPreflight.report;
    if (liveAdapterPreflight.status !== "pass") {
      markStage(
        stageMap,
        "bootstrap",
        "fail",
        uniqueStrings([projectInit.transcriptFile, liveAdapterPreflight.reportFile, ...collectStringRefs(projectInit.payload)]),
        liveAdapterPreflight.summary,
      );
      throw new Error(liveAdapterPreflight.summary);
    }
    markStage(
      stageMap,
      "bootstrap",
      "pass",
      uniqueStrings([
        projectInit.transcriptFile,
        liveAdapterPreflight.reportFile,
        ...collectStringRefs(projectInit.payload),
        ...providerRoutes.routeFiles,
      ]),
      "Public bootstrap materialized project profile, packaged bootstrap assets, provider-pinned route overrides, and live adapter preflight.",
    );

    const featureRequest = materializeFeatureRequestFile({
      targetCheckoutRoot: targetCheckout.targetCheckoutRoot,
      mission: options.mission,
      runId: options.runId,
      scenarioFamily: asNonEmptyString(options.profile.scenario_family),
      providerVariantId: asNonEmptyString(options.profile.provider_variant_id),
      providerVariant: options.providerVariant,
      scenarioPolicy: options.scenarioPolicy,
      featureSize: options.featureSize,
      matrixCell: options.matrixCell,
      coverageFollowUp: options.coverageFollowUp,
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
      ...(routeOverridesFlag ? ["--route-overrides", routeOverridesFlag] : []),
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
      "--verification-label",
      "baseline-diagnostic",
      "--routed-dry-run-step",
      "implement",
      ...(routeOverridesFlag ? ["--route-overrides", routeOverridesFlag] : []),
    ]);
    const baselineVerifySummaryPath = getStringField(verifyPreflight.payload, "verify_summary_file");
    artifacts.baseline_verify_summary_file = baselineVerifySummaryPath;
    artifacts.verify_summary_file = baselineVerifySummaryPath;
    artifacts.baseline_verify_step_result_files = getStringArrayField(verifyPreflight.payload, "step_result_files");
    artifacts.preflight_step_result_files = artifacts.baseline_verify_step_result_files;
    artifacts.baseline_routed_dry_run_step_result_file = getStringField(
      verifyPreflight.payload,
      "routed_step_result_file",
    );
    if (
      internalTestHooks.drop_baseline_routed_dry_run_after_preflight === true &&
      typeof artifacts.baseline_routed_dry_run_step_result_file === "string"
    ) {
      fs.rmSync(artifacts.baseline_routed_dry_run_step_result_file, { force: true });
    }
    if (!baselineVerifySummaryPath || !fileExists(baselineVerifySummaryPath)) {
      markStage(
        stageMap,
        "execution",
        "fail",
        uniqueStrings([verifyPreflight.transcriptFile, ...collectStringRefs(verifyPreflight.payload)]),
        "Dry-run verify summary was not materialized.",
      );
      throw new Error("Dry-run verify summary was not materialized.");
    }
    const baselineVerifySummary = readJson(baselineVerifySummaryPath);
    const preservedBaseline = preserveVerifyArtifacts({
      verifyPayload: asRecord(verifyPreflight.payload),
      summaryFile: baselineVerifySummaryPath,
      reportsRoot: options.layout.reportsRoot,
      runId: options.runId,
      phase: "baseline-verify",
    });
    artifacts.baseline_verify_preserved_files = preservedBaseline.preserved_files;
    if (preservedBaseline.preserved_summary_file) {
      artifacts.baseline_verify_summary_file = preservedBaseline.preserved_summary_file;
    }
    if (preservedBaseline.preserved_step_result_files.length > 0) {
      artifacts.baseline_verify_step_result_files = preservedBaseline.preserved_step_result_files;
      artifacts.preflight_step_result_files = preservedBaseline.preserved_step_result_files;
    }
    const baselineGateMode = resolveBaselineGateMode(options.profile);
    const baselineGateDecision = evaluateBaselineVerifyGate({
      verifySummary: asRecord(baselineVerifySummary),
      verifyPayload: asRecord(verifyPreflight.payload),
      stepResultFiles: getStringArrayField(verifyPreflight.payload, "step_result_files"),
      setupCommands: repoLintCommands,
      verificationCommands: repoVerificationCommands,
      mode: baselineGateMode,
    });
    artifacts.baseline_verify_status = baselineGateDecision.status;
    artifacts.baseline_verify_gate_decision = baselineGateDecision;
    if (baselineGateDecision.decision === "block") {
      markStage(
        stageMap,
        "execution",
        "fail",
        uniqueStrings([
          verifyPreflight.transcriptFile,
          baselineVerifySummaryPath,
          ...asStringArray(artifacts.baseline_verify_preserved_files),
          ...collectStringRefs(verifyPreflight.payload),
        ]),
        asNonEmptyString(baselineGateDecision.summary) || "Baseline readiness failed before provider execution.",
      );
      throw new Error(asNonEmptyString(baselineGateDecision.summary) || "Baseline readiness failed before provider execution.");
    }
    const executionReadiness = writeExecutionReadinessDecision({
      runId: options.runId,
      reportsRoot: options.layout.reportsRoot,
      liveAdapterPreflightFile: asNonEmptyString(artifacts.live_adapter_preflight_file),
      validationReportFile: asNonEmptyString(artifacts.validation_report_file),
      baselineGateDecision,
      baselineRoutedStepResultFile: asNonEmptyString(artifacts.baseline_routed_dry_run_step_result_file),
    });
    artifacts.execution_readiness_file = executionReadiness.decisionFile;
    artifacts.execution_readiness = executionReadiness.decision;

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
      ...(routeOverridesFlag ? ["--route-overrides", routeOverridesFlag] : []),
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
      ...(routeOverridesFlag ? ["--route-overrides", routeOverridesFlag] : []),
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
      ...(artifacts.execution_readiness_file ? [/** @type {string} */ (artifacts.execution_readiness_file)] : []),
      ...(artifacts.baseline_routed_dry_run_step_result_file
        ? [/** @type {string} */ (artifacts.baseline_routed_dry_run_step_result_file)]
        : []),
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
      ...(routeOverridesFlag ? ["--route-overrides", routeOverridesFlag] : []),
    ]);
    artifacts.routed_step_result_file = getStringField(runStart.payload, "routed_step_result_file");
    artifacts.routed_step_result_id = getStringField(runStart.payload, "routed_step_result_id");
    artifacts.runtime_harness_report_file = getStringField(runStart.payload, "runtime_harness_report_file");
    artifacts.runtime_harness_overall_decision = getStringField(runStart.payload, "runtime_harness_overall_decision");
    if (artifacts.runtime_harness_report_file && fileExists(artifacts.runtime_harness_report_file)) {
      artifacts.runtime_harness_overall_decision =
        asNonEmptyString(asRecord(readJson(artifacts.runtime_harness_report_file)).overall_decision) ||
        artifacts.runtime_harness_overall_decision;
    }
    artifacts.run_start_runtime_harness_report_file = artifacts.runtime_harness_report_file;
    artifacts.run_start_runtime_harness_decision = artifacts.runtime_harness_overall_decision;
    artifacts.execution_degraded =
      asNonEmptyString(artifacts.run_start_runtime_harness_decision) !== "pass";
    artifacts.execution_degraded_reason =
      artifacts.execution_degraded === true
        ? `Runtime Harness decision '${asNonEmptyString(artifacts.run_start_runtime_harness_decision) || "unknown"}'.`
        : null;
    if (artifacts.routed_step_result_file && fileExists(artifacts.routed_step_result_file)) {
      const stepResult = readJson(artifacts.routed_step_result_file);
      const routedExecution = asRecord(stepResult.routed_execution);
      artifacts.compiled_context_ref = asNonEmptyString(asRecord(routedExecution.context_compilation).compiled_context_ref) || null;
      artifacts.compiled_context_file = asNonEmptyString(asRecord(routedExecution.context_compilation).compiled_context_file) || null;
      artifacts.adapter_raw_evidence_ref =
        asNonEmptyString(asRecord(asRecord(asRecord(routedExecution.adapter_response).output).external_runner).raw_evidence_ref) ||
        null;
      if (internalTestHooks.drop_adapter_raw_evidence_after_run_start === true) {
        const adapterResponse = asRecord(routedExecution.adapter_response);
        const adapterOutput = asRecord(adapterResponse.output);
        const externalRunner = asRecord(adapterOutput.external_runner);
        if (Object.prototype.hasOwnProperty.call(externalRunner, "raw_evidence_ref")) {
          delete externalRunner.raw_evidence_ref;
          adapterOutput.external_runner = externalRunner;
          adapterResponse.output = adapterOutput;
          routedExecution.adapter_response = adapterResponse;
          stepResult.routed_execution = routedExecution;
        }
        const topLevelExternalRunner = asRecord(stepResult.external_runner);
        if (Object.prototype.hasOwnProperty.call(topLevelExternalRunner, "raw_evidence_ref")) {
          delete topLevelExternalRunner.raw_evidence_ref;
          stepResult.external_runner = topLevelExternalRunner;
        }
        writeJson(artifacts.routed_step_result_file, stepResult);
        artifacts.adapter_raw_evidence_ref = null;
      }
      if (asNonEmptyString(stepResult.status) !== "passed") {
        artifacts.execution_degraded = true;
        artifacts.execution_degraded_reason = asNonEmptyString(stepResult.summary) || "Run start routed execution failed.";
        markStage(
          stageMap,
          "execution",
          "warn",
          uniqueStrings([
            verifyPreflight.transcriptFile,
            asNonEmptyString(artifacts.baseline_verify_summary_file),
            runStart.transcriptFile,
            artifacts.routed_step_result_file,
            ...collectStringRefs(stepResult),
          ]),
          asNonEmptyString(stepResult.summary) || "Run start routed execution failed.",
        );
      }
    } else {
      markStage(
        stageMap,
        "execution",
        "fail",
        uniqueStrings([runStart.transcriptFile, ...collectStringRefs(runStart.payload)]),
        "Run start did not materialize routed execution evidence.",
      );
      throw new Error("Run start did not materialize routed execution evidence.");
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

    const postRunQualityPolicy = resolvePostRunQualityPolicy(options.mission, catalogVerification);
    artifacts.post_run_quality_policy = postRunQualityPolicy;
    const postRunVerify = runCommand("project-verify-post-run-primary", [
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
      ...buildVerifyOverrideArgs({
        label: "post-run-primary",
        commands: postRunQualityPolicy.primaryCommands,
      }),
    ]);
    artifacts.post_run_verify_summary_file = getStringField(postRunVerify.payload, "verify_summary_file");
    artifacts.post_run_verify_step_result_files = getStringArrayField(postRunVerify.payload, "step_result_files");
    artifacts.post_run_primary_verify_summary_file = artifacts.post_run_verify_summary_file;
    artifacts.post_run_primary_verify_step_result_files = artifacts.post_run_verify_step_result_files;
    artifacts.verify_summary_file = artifacts.post_run_verify_summary_file;
    const postRunVerifySummaryPath = /** @type {string | null} */ (artifacts.post_run_verify_summary_file);
    if (!postRunVerifySummaryPath || !fileExists(postRunVerifySummaryPath)) {
      markStage(
        stageMap,
        "execution",
        "fail",
        uniqueStrings([postRunVerify.transcriptFile, ...collectStringRefs(postRunVerify.payload)]),
        "Post-run verify summary was not materialized.",
      );
      throw new Error("Post-run verify summary was not materialized.");
    }
    const postRunVerifySummary = readJson(postRunVerifySummaryPath);
    artifacts.post_run_verify_status = asNonEmptyString(postRunVerifySummary.status) === "passed" ? "pass" : "fail";
    const executionStageStatus =
      stageMap.execution?.status === "fail" ? "fail" : artifacts.execution_degraded === true ? "warn" : "pass";
    markStage(
      stageMap,
      "execution",
      executionStageStatus,
      uniqueStrings([
        verifyPreflight.transcriptFile,
        asNonEmptyString(artifacts.baseline_verify_summary_file),
        runStart.transcriptFile,
        runStatus.transcriptFile,
        postRunVerify.transcriptFile,
        postRunVerifySummaryPath,
        ...collectStringRefs(runStart.payload),
      ]),
      executionStageStatus === "warn"
        ? "Provider execution materialized degraded evidence; post-run verification completed for black-box quality reporting."
        : "Baseline diagnostics, run start, run status, and post-run verification completed through public execution lifecycle.",
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
    ], { allowNonZeroWithPayload: true });
    artifacts.review_report_file = getStringField(reviewRun.payload, "review_report_file");
    artifacts.latest_runtime_harness_report_file =
      getStringField(reviewRun.payload, "runtime_harness_report_file") || artifacts.runtime_harness_report_file;
    artifacts.latest_runtime_harness_decision =
      getStringField(reviewRun.payload, "runtime_harness_overall_decision") ||
      artifacts.run_start_runtime_harness_decision ||
      artifacts.runtime_harness_overall_decision;
    const reviewReport = artifacts.review_report_file && fileExists(artifacts.review_report_file)
      ? readJson(artifacts.review_report_file)
      : {};
    const reviewOverallStatus = normalizeVerdictStatus(reviewReport.overall_status);
    const featureSizeFitStatus = normalizeVerdictStatus(asRecord(reviewReport.feature_size_fit).status);
    markStage(
      stageMap,
      "review",
      reviewOverallStatus === "fail" ? "warn" : "pass",
      uniqueStrings([reviewRun.transcriptFile, ...collectStringRefs(reviewRun.payload)]),
      reviewOverallStatus === "fail" ? "Review report materialized observed findings." : "Review report materialized.",
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
      ], { allowNonZeroWithPayload: true });
      artifacts.evaluation_report_file = getStringField(evalRun.payload, "evaluation_report_file");
      const evaluationStatus = getStringField(evalRun.payload, "evaluation_status") || "unknown";
      markStage(
        stageMap,
        "qa",
        evaluationStatus === "pass" ? "pass" : "warn",
        uniqueStrings([evalRun.transcriptFile, ...collectStringRefs(evalRun.payload)]),
        evaluationStatus === "pass"
          ? "Evaluation report materialized."
          : "Evaluation report materialized observed findings.",
      );
    } else {
      markStage(stageMap, "qa", "skipped", [], "Profile has no eval suites.");
    }

    if (postRunQualityPolicy.diagnosticCommands.length > 0) {
      const postRunDiagnosticVerify = runCommand("project-verify-post-run-diagnostic", [
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
        ...buildVerifyOverrideArgs({
          label: "post-run-diagnostic",
          commands: postRunQualityPolicy.diagnosticCommands,
        }),
      ]);
      artifacts.post_run_diagnostic_verify_summary_file = getStringField(
        postRunDiagnosticVerify.payload,
        "verify_summary_file",
      );
      artifacts.post_run_diagnostic_verify_step_result_files = getStringArrayField(
        postRunDiagnosticVerify.payload,
        "step_result_files",
      );
      const diagnosticSummaryFile = asNonEmptyString(artifacts.post_run_diagnostic_verify_summary_file);
      const diagnosticSummary =
        diagnosticSummaryFile && fileExists(diagnosticSummaryFile) ? readJson(diagnosticSummaryFile) : {};
      const diagnosticPassed = asNonEmptyString(diagnosticSummary.status) === "passed";
      artifacts.post_run_diagnostic_status = diagnosticPassed ? "pass" : postRunQualityPolicy.diagnosticFailureMode;
      const preservedDiagnostic = diagnosticSummaryFile
        ? preserveVerifyArtifacts({
            verifyPayload: asRecord(postRunDiagnosticVerify.payload),
            summaryFile: diagnosticSummaryFile,
            reportsRoot: options.layout.reportsRoot,
            runId: options.runId,
            phase: "post-run-diagnostic-verify",
          })
        : { preserved_summary_file: null, preserved_step_result_files: [], preserved_files: [] };
      artifacts.post_run_diagnostic_verify_preserved_files = preservedDiagnostic.preserved_files;
      if (preservedDiagnostic.preserved_summary_file) {
        artifacts.post_run_diagnostic_verify_summary_file = preservedDiagnostic.preserved_summary_file;
      }
      if (preservedDiagnostic.preserved_step_result_files.length > 0) {
        artifacts.post_run_diagnostic_verify_step_result_files = preservedDiagnostic.preserved_step_result_files;
      }
    } else {
      artifacts.post_run_diagnostic_status = "pass";
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
      const promotionStatus = getStringField(certify.payload, "promotion_decision_status") || "unknown";
      if (artifacts.promotion_decision_file) {
        deliveryEvidenceRefs.push(artifacts.promotion_decision_file);
      }
      markStage(
        stageMap,
        "review",
        promotionStatus === "pass" ? "pass" : "warn",
        uniqueStrings([certify.transcriptFile, ...collectStringRefs(certify.payload)]),
        promotionStatus === "pass"
          ? "Harness certification passed."
          : "Harness certification produced observed findings.",
      );
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
        "--quality-gate-mode",
        "observe",
        ...(artifacts.approved_handoff_packet_file
          ? ["--approved-handoff-ref", /** @type {string} */ (artifacts.approved_handoff_packet_file)]
          : []),
        ...(deliveryEvidenceRefs.length > 0 ? ["--promotion-evidence-refs", deliveryEvidenceRefs.join(",")] : []),
      ], { allowNonZeroWithPayload: true });
    } catch (error) {
      const summary = error instanceof Error ? error.message : String(error);
      const lowerSummary = summary.toLowerCase();
      artifacts.delivery_blocking = true;
      artifacts.delivery_blocked_by_quality_gate =
        lowerSummary.includes("runtime harness") || lowerSummary.includes("quality gate");
      artifacts.delivery_blocking_reasons = [summary];
      markStage(
        stageMap,
        "delivery",
        "fail",
        [],
        artifacts.delivery_blocked_by_quality_gate === true
          ? "Delivery prepare was blocked by quality/runtime harness gate."
          : summary,
      );
    }
    if (!deliverPrepare) {
      throw new Error("Delivery prepare did not materialize delivery evidence.");
    }
    if (deliverPrepare) {
      const deliveryRuntimeHarnessReportFile = getStringField(deliverPrepare.payload, "runtime_harness_report_file");
      artifacts.delivery_manifest_file = getStringField(deliverPrepare.payload, "delivery_manifest_file");
      artifacts.delivery_plan_file = getStringField(deliverPrepare.payload, "delivery_plan_file");
      artifacts.delivery_transcript_file = getStringField(deliverPrepare.payload, "delivery_transcript_file");
      artifacts.delivery_runtime_harness_report_file = deliveryRuntimeHarnessReportFile;
      artifacts.runtime_harness_report_file =
        asNonEmptyString(artifacts.runtime_harness_report_file) || deliveryRuntimeHarnessReportFile;
      artifacts.delivery_quality_gate_mode = getStringField(deliverPrepare.payload, "delivery_quality_gate_mode");
      artifacts.delivery_quality_gate_status = getStringField(deliverPrepare.payload, "delivery_quality_gate_status");
      artifacts.delivery_quality_gate_findings = asStringArray(deliverPrepare.payload?.delivery_quality_gate_findings);
      if (internalTestHooks.block_delivery_prepare === true) {
        deliverPrepare.payload.delivery_blocking = true;
      }
      artifacts.delivery_blocking = deliverPrepare.payload?.delivery_blocking === true;
      artifacts.delivery_blocking_reasons = asStringArray(deliverPrepare.payload?.delivery_blocking_reasons);
      artifacts.delivery_blocked_by_quality_gate =
        artifacts.delivery_blocking === true &&
        artifacts.delivery_blocking_reasons.some((reason) =>
          /runtime harness|quality gate/iu.test(reason),
        );
      markStage(
        stageMap,
        "delivery",
        artifacts.delivery_manifest_file
          ? artifacts.delivery_blocking === true || artifacts.delivery_quality_gate_status === "not_pass"
            ? "warn"
            : "pass"
          : "fail",
        uniqueStrings([deliverPrepare.transcriptFile, ...collectStringRefs(deliverPrepare.payload)]),
        artifacts.delivery_manifest_file
          ? artifacts.delivery_blocking === true || artifacts.delivery_quality_gate_status === "not_pass"
            ? "Delivery evidence materialized with observed quality findings."
            : "Delivery prepare materialized delivery evidence."
          : "Delivery prepare did not materialize delivery evidence.",
      );
      if (!artifacts.delivery_manifest_file) {
        throw new Error("Delivery prepare did not materialize delivery evidence.");
      }
    }

    markStage(stageMap, "release", "skipped", [], "Observation v1 ends at delivery.");

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
    if (internalTestHooks.corrupt_audit_coverage_follow_up === true) {
      const auditRecords = Array.isArray(auditPayload.run_audit_records) ? auditPayload.run_audit_records : [];
      const auditRecord =
        auditRecords.map((record) => asRecord(record)).find((record) => asNonEmptyString(record.run_id) === options.runId) ||
        asRecord(auditRecords[0]);
      if (hasObjectFields(auditRecord)) {
        auditRecord.coverage_follow_up = {
          current_cell_required: false,
          remaining_required_matrix_cells: [],
        };
      }
    }

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
      artifacts.incident_report_file =
        getStringField(incidentOpen.payload, "incident_report_file") ||
        getStringField(incidentOpen.payload, "incident_file");
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
    artifacts.latest_runtime_harness_report_file =
      getStringField(learningHandoff.payload, "runtime_harness_report_file") ||
      artifacts.latest_runtime_harness_report_file ||
      artifacts.runtime_harness_report_file;
    artifacts.latest_runtime_harness_decision =
      getStringField(learningHandoff.payload, "runtime_harness_overall_decision") ||
      artifacts.latest_runtime_harness_decision ||
      artifacts.run_start_runtime_harness_decision ||
      artifacts.runtime_harness_overall_decision;
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
    if (internalTestHooks.corrupt_learning_scorecard_coverage_follow_up === true) {
      const learningScorecard = asRecord(readJson(artifacts.learning_loop_scorecard_file));
      learningScorecard.coverage_follow_up = {
        current_cell_required: false,
        remaining_required_matrix_cells: [],
      };
      writeJson(artifacts.learning_loop_scorecard_file, learningScorecard);
    }
    markStage(
      stageMap,
      "learning",
      "pass",
      uniqueStrings([learningHandoff.transcriptFile, ...collectStringRefs(learningHandoff.payload)]),
      "Public learning-loop closure artifacts materialized.",
    );

    if (internalTestHooks.drop_runtime_harness_report_outputs === true) {
      if (typeof artifacts.runtime_harness_report_file === "string") {
        try {
          fs.rmSync(artifacts.runtime_harness_report_file, { force: true });
        } catch {
          // Test hook only: scenario coverage below will fail on the missing proof artifact.
        }
      }
      artifacts.runtime_harness_report_file = null;
      artifacts.runtime_harness_overall_decision = null;
      artifacts.run_start_runtime_harness_report_file = null;
      artifacts.run_start_runtime_harness_decision = null;
    }

    const targetBaselineStatus = asNonEmptyString(artifacts.baseline_verify_status) || "fail";
    const postRunVerificationStatus = asNonEmptyString(artifacts.post_run_verify_status) || "fail";
    const postRunDiagnosticStatus = asNonEmptyString(artifacts.post_run_diagnostic_status) || "pass";
    const runtimeHarnessDecision =
      asNonEmptyString(artifacts.run_start_runtime_harness_decision) ||
      asNonEmptyString(artifacts.runtime_harness_overall_decision) ||
      "unknown";
    const latestRuntimeHarnessDecision =
      asNonEmptyString(artifacts.latest_runtime_harness_decision) || runtimeHarnessDecision;
    const realCodeChangeStatus = runtimeHarnessReportHasMissionScopedChanges(
      asNonEmptyString(artifacts.run_start_runtime_harness_report_file) ||
        asNonEmptyString(artifacts.runtime_harness_report_file),
    )
      ? "pass"
      : "fail";
    const providerExecutionProofStatus = evidenceRefMaterialized(
      asNonEmptyString(artifacts.adapter_raw_evidence_ref),
      targetCheckout.targetCheckoutRoot,
    )
      ? "pass"
      : "fail";
    artifacts.real_code_change_status = realCodeChangeStatus;
    artifacts.runtime_harness_decision = runtimeHarnessDecision;
    artifacts.run_start_runtime_harness_decision = runtimeHarnessDecision;
    artifacts.latest_runtime_harness_decision = latestRuntimeHarnessDecision;
    artifacts.provider_execution_status = providerExecutionProofStatus;
    artifacts.quality_gate_decision =
      postRunVerificationStatus === "pass" &&
      postRunDiagnosticStatus !== "fail" &&
      realCodeChangeStatus === "pass" &&
      reviewOverallStatus !== "fail"
        ? "pass"
        : "fail";

    const scenarioCoverage = evaluateScenarioCoverage({
      scenarioPolicy: options.scenarioPolicy,
      stageResults: flattenStageMap(stageMap),
      artifacts,
      auditPayload,
    });
    const artifactConsistency = evaluateArtifactConsistency({
      artifacts,
      reviewReport,
      auditPayload,
      runId: options.runId,
    });
    artifacts.artifact_consistency = artifactConsistency;
    if (artifactConsistency.status === "fail") {
      scenarioCoverage.status = "fail";
      scenarioCoverage.findings = uniqueStrings([
        ...asStringArray(scenarioCoverage.findings),
        ...artifactConsistency.findings,
      ]);
      scenarioCoverage.summary = artifactConsistency.summary;
    }
    artifacts.scenario_coverage = scenarioCoverage;
    const deliveryReleaseQuality =
      artifacts.delivery_blocking === true
        ? "fail"
        : asRecord(options.profile.output_policy).materialize_release_packet === true
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
      scenario_family: asNonEmptyString(options.profile.scenario_family) || null,
      provider_variant_id: asNonEmptyString(options.profile.provider_variant_id) || null,
      feature_size: options.featureSize,
      target_selection: "pass",
      feature_request_quality: artifacts.intake_artifact_packet_file && artifacts.feature_request_file ? "pass" : "fail",
      scenario_coverage_status: scenarioCoverage.status,
      provider_execution_status: providerExecutionProofStatus,
      target_baseline_status: targetBaselineStatus,
      real_code_change_status: realCodeChangeStatus,
      post_run_verification_status: postRunVerificationStatus,
      post_run_diagnostic_status: postRunDiagnosticStatus,
      discovery_quality: normalizeVerdictStatus(asRecord(reviewReport.discovery_quality).status),
      runtime_success:
        artifacts.routed_step_result_file &&
        artifacts.runtime_harness_report_file &&
        runtimeHarnessDecision === "pass"
          ? "pass"
          : "fail",
      runtime_harness_decision: runtimeHarnessDecision,
      run_start_runtime_harness_decision: runtimeHarnessDecision,
      latest_runtime_harness_decision: latestRuntimeHarnessDecision,
      artifact_quality:
        artifactConsistency.status === "fail"
          ? "fail"
          : normalizeVerdictStatus(asRecord(reviewReport.artifact_quality).status),
      code_quality: normalizeVerdictStatus(asRecord(reviewReport.code_quality).status),
      feature_size_fit_status: featureSizeFitStatus,
      delivery_release_quality: deliveryReleaseQuality,
      learning_loop_closure: learningLoopClosure,
      quality_gate_decision: artifacts.quality_gate_decision,
      overall_verdict: "pass",
    };
    const verdictStatuses = [
      verdictMatrix.target_selection,
      verdictMatrix.feature_request_quality,
      verdictMatrix.scenario_coverage_status,
      verdictMatrix.discovery_quality,
      verdictMatrix.runtime_success,
      verdictMatrix.target_baseline_status,
      verdictMatrix.real_code_change_status,
      verdictMatrix.post_run_verification_status,
      verdictMatrix.post_run_diagnostic_status,
      verdictMatrix.artifact_quality,
      verdictMatrix.code_quality,
      verdictMatrix.provider_execution_status,
      verdictMatrix.feature_size_fit_status,
      verdictMatrix.delivery_release_quality,
      verdictMatrix.learning_loop_closure,
      verdictMatrix.quality_gate_decision,
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
  const verdictMatrix =
    typeof options.flowResult.artifacts.verdict_matrix === "object" && options.flowResult.artifacts.verdict_matrix
      ? asRecord(options.flowResult.artifacts.verdict_matrix)
      : {};
  return {
    scorecard_id: `${options.runId}.scorecard.${asNonEmptyString(targetRepo.repo_id) || "target"}`,
    run_id: options.runId,
    profile_ref: options.profilePath,
    profile_id: options.profile.profile_id ?? null,
    scenario_id: options.profile.scenario_id ?? null,
    scenario_family: options.profile.scenario_family ?? null,
    target_catalog_id: options.profile.target_catalog_id ?? null,
    feature_mission_id: options.flowResult.artifacts.feature_mission_id ?? options.profile.feature_mission_id ?? null,
    provider_variant_id: options.profile.provider_variant_id ?? null,
    feature_size: options.flowResult.artifacts.feature_size ?? null,
    flow_kind: options.profile.flow_kind ?? null,
    duration_class: options.profile.duration_class ?? null,
    matrix_cell:
      typeof options.flowResult.artifacts.matrix_cell === "object" && options.flowResult.artifacts.matrix_cell
        ? options.flowResult.artifacts.matrix_cell
        : null,
    target_repo: {
      repo_id: targetRepo.repo_id ?? null,
      repo_url: targetRepo.repo_url ?? null,
      ref: targetRepo.ref ?? null,
    },
    stage_counts: summarizeStageCounts(options.flowResult.stageResults),
    status: asNonEmptyString(options.flowResult.artifacts.live_e2e_observation_overall_status) || options.flowResult.status,
    legacy_flow_status: options.flowResult.status,
    live_e2e_observation_report_file:
      asNonEmptyString(options.flowResult.artifacts.live_e2e_observation_report_file) || null,
    scenario_coverage_status: verdictMatrix.scenario_coverage_status ?? null,
    provider_execution_status: verdictMatrix.provider_execution_status ?? null,
    feature_size_fit_status: verdictMatrix.feature_size_fit_status ?? null,
    target_baseline_status: verdictMatrix.target_baseline_status ?? null,
    real_code_change_status: verdictMatrix.real_code_change_status ?? null,
    post_run_verification_status: verdictMatrix.post_run_verification_status ?? null,
    post_run_diagnostic_status: verdictMatrix.post_run_diagnostic_status ?? null,
    runtime_harness_decision: verdictMatrix.runtime_harness_decision ?? null,
    run_start_runtime_harness_decision:
      verdictMatrix.run_start_runtime_harness_decision ?? verdictMatrix.runtime_harness_decision ?? null,
    latest_runtime_harness_decision:
      verdictMatrix.latest_runtime_harness_decision ?? verdictMatrix.runtime_harness_decision ?? null,
    quality_gate_decision: verdictMatrix.quality_gate_decision ?? null,
    summary_ref: options.summaryFile,
    command_count: options.flowResult.commandResults.length,
    generated_at: nowIso(),
  };
}

/**
 * @param {string | null} filePath
 * @returns {Record<string, unknown>}
 */
function loadAgentJudgeDocument(filePath) {
  const resolved = asNonEmptyString(filePath);
  if (!resolved) return {};
  if (!fileExists(resolved)) {
    throw new UsageError(`Agent judge file '${resolved}' was not found.`);
  }
  return readJson(resolved);
}

/**
 * @param {Record<string, unknown>} judgeDocument
 * @returns {Map<string, Record<string, unknown>>}
 */
function indexAgentJudgeEntries(judgeDocument) {
  const entries = Array.isArray(judgeDocument.artifact_quality_matrix)
    ? judgeDocument.artifact_quality_matrix
    : Array.isArray(judgeDocument.steps)
      ? judgeDocument.steps
      : [];
  const indexed = new Map();
  for (const entry of entries) {
    const record = asRecord(entry);
    const step = asNonEmptyString(record.step);
    if (step) indexed.set(step, record);
  }
  return indexed;
}

/**
 * @param {string} step
 * @returns {string[]}
 */
function getObservationCommandLabelPriority(step) {
  if (step === "discovery") return ["discovery-run", "project-analyze"];
  if (step === "spec") return ["spec-build", "project-validate"];
  if (step === "planning") return ["wave-create", "handoff-prepare"];
  if (step === "handoff") return ["handoff-approve"];
  if (step === "execution") return ["run-start", "project-verify-routed-live"];
  if (step === "review") return ["review-run", "harness-certify", "eval-run"];
  if (step === "qa") return ["eval-run", "project-verify-post-run-primary"];
  if (step === "delivery") return ["deliver-prepare"];
  return [];
}

/**
 * @param {Array<Record<string, unknown>>} commandResults
 * @param {string[]} labels
 * @returns {Record<string, unknown> | undefined}
 */
function findCommandByPreferredLabel(commandResults, labels) {
  for (const label of labels) {
    const command = commandResults.find((entry) => asNonEmptyString(entry.label) === label);
    if (command) return command;
  }
  return undefined;
}

/**
 * @param {{ runId: string, flowResult: { stageResults: Array<Record<string, unknown>>, commandResults: Array<Record<string, unknown>>, artifacts: Record<string, unknown> } }} options
 */
function buildObservationStepMatrix(options) {
  return LIVE_E2E_OBSERVATION_STEPS.map((step) => {
    const stage = options.flowResult.stageResults.find((entry) => asNonEmptyString(entry.stage) === step) ?? {};
    const command = findCommandByPreferredLabel(
      options.flowResult.commandResults,
      getObservationCommandLabelPriority(step),
    );
    const artifactRefs = uniqueStrings([
      ...asStringArray(stage.evidence_refs),
      ...asStringArray(command?.artifact_refs),
    ]);
    const status = toObservationStatus(asNonEmptyString(stage.status) || asNonEmptyString(command?.status) || "not_pass");
    return {
      step,
      status,
      command_label: asNonEmptyString(command?.label) || null,
      command_surface: asNonEmptyString(command?.command_surface) || null,
      artifact_refs: artifactRefs,
      findings: uniqueStrings([
        ...(status === "pass" ? [] : [asNonEmptyString(stage.summary) || `${step} did not complete cleanly`]),
        ...asStringArray(stage.missing_evidence),
        ...asStringArray(command?.missing_evidence),
      ]),
    };
  });
}

/**
 * @param {{ stepMatrix: Array<Record<string, unknown>>, agentJudgeDocument: Record<string, unknown> }} options
 */
function buildArtifactQualityMatrix(options) {
  const judgeEntries = indexAgentJudgeEntries(options.agentJudgeDocument);
  const judgeProvided = judgeEntries.size > 0;
  return options.stepMatrix.map((stepEntry) => {
    const step = asNonEmptyString(stepEntry.step);
    const judgeEntry = judgeEntries.get(step);
    if (judgeEntry) {
      const status = toObservationStatus(asNonEmptyString(judgeEntry.status) || "warn");
      return {
        step,
        status,
        judge_source: asNonEmptyString(judgeEntry.judge_source) || "agent",
        artifact_refs: asStringArray(judgeEntry.artifact_refs).length > 0
          ? asStringArray(judgeEntry.artifact_refs)
          : asStringArray(stepEntry.artifact_refs),
        findings: asStringArray(judgeEntry.findings),
      };
    }
    return {
      step,
      status: "warn",
      judge_source: judgeProvided ? "agent-partial" : "agent-missing",
      artifact_refs: asStringArray(stepEntry.artifact_refs),
      findings: [judgeProvided ? "agent-judge-step-missing" : "agent-judge-not-provided"],
    };
  });
}

/**
 * @param {{ stepMatrix: Array<Record<string, unknown>>, artifactQualityMatrix: Array<Record<string, unknown>>, codeQuality: Record<string, unknown>, artifacts: Record<string, unknown> }}
 * @returns {"pass" | "warn" | "not_pass"}
 */
function resolveObservationOverallStatus(options) {
  const deliveryStep = options.stepMatrix.find((entry) => asNonEmptyString(entry.step) === "delivery") ?? {};
  const deliveryStatus = toObservationStatus(asNonEmptyString(deliveryStep.status) || "not_pass");
  const deliveryManifestFile = asNonEmptyString(options.artifacts.delivery_manifest_file);
  if (!deliveryManifestFile || deliveryStatus === "not_pass") {
    return "not_pass";
  }
  let overall = "pass";
  for (const entry of [...options.stepMatrix, ...options.artifactQualityMatrix, options.codeQuality]) {
    overall = worstObservationStatus(overall, asNonEmptyString(entry.status) || "pass");
  }
  return overall === "not_pass" ? "warn" : overall;
}

/**
 * @param {{ stepMatrix: Array<Record<string, unknown>> }}
 */
function buildContinuationDecisions(options) {
  return options.stepMatrix
    .filter((entry) => toObservationStatus(asNonEmptyString(entry.status)) !== "pass")
    .map((entry, index, entries) => {
      const step = asNonEmptyString(entry.step);
      const nextStep =
        LIVE_E2E_OBSERVATION_STEPS[LIVE_E2E_OBSERVATION_STEPS.indexOf(step) + 1] ||
        asNonEmptyString(entries[index + 1]?.step) ||
        null;
      return {
        step,
        decision: nextStep ? "continue_with_findings" : "stop_at_delivery",
        reason: asStringArray(entry.findings)[0] || `${step} completed with observed findings`,
        next_step: nextStep,
      };
    });
}

/**
 * @param {{ runId: string, profilePath: string, profile: Record<string, unknown>, flowResult: { stageResults: Array<Record<string, unknown>>, commandResults: Array<Record<string, unknown>>, artifacts: Record<string, unknown> }, summaryFile: string, agentJudgeDocument: Record<string, unknown> }}
 */
function buildObservationReport(options) {
  const stepMatrix = buildObservationStepMatrix({
    runId: options.runId,
    flowResult: options.flowResult,
  });
  const artifactQualityMatrix = buildArtifactQualityMatrix({
    stepMatrix,
    agentJudgeDocument: options.agentJudgeDocument,
  });
  const codeQuality = buildCodeQualityObservation(options.flowResult.artifacts);
  const overallStatus = resolveObservationOverallStatus({
    stepMatrix,
    artifactQualityMatrix,
    codeQuality,
    artifacts: options.flowResult.artifacts,
  });
  return {
    report_id: `${options.runId}.live-e2e-observation.v1`,
    run_id: options.runId,
    profile_id: asNonEmptyString(options.profile.profile_id) || "unknown-profile",
    flow_range: {
      start_step: "discovery",
      end_step: "delivery",
      included_steps: [...LIVE_E2E_OBSERVATION_STEPS],
      prelude_steps: [...LIVE_E2E_OBSERVATION_PRELUDE_STEPS],
      excluded_steps: [...LIVE_E2E_OBSERVATION_EXCLUDED_STEPS],
    },
    overall_status: overallStatus,
    step_matrix: stepMatrix,
    artifact_quality_matrix: artifactQualityMatrix,
    code_quality_after_delivery: codeQuality,
    continuation_decisions: buildContinuationDecisions({ stepMatrix }),
    evidence_refs: uniqueStrings([
      options.summaryFile,
      asNonEmptyString(options.flowResult.artifacts.delivery_manifest_file),
      asNonEmptyString(options.flowResult.artifacts.review_report_file),
      asNonEmptyString(options.flowResult.artifacts.runtime_harness_report_file),
      asNonEmptyString(options.flowResult.artifacts.evaluation_report_file),
    ]),
  };
}

/**
 * @param {{ runId: string, reportsRoot: string, stepMatrix: Array<Record<string, unknown>> }}
 */
function writeAgentArtifactReviewRequest(options) {
  const requestFile = path.join(
    options.reportsRoot,
    `live-e2e-agent-artifact-review-request-${normalizeId(options.runId)}.json`,
  );
  const request = {
    request_id: `${options.runId}.agent-artifact-review.v1`,
    run_id: options.runId,
    rubric: {
      statuses: ["pass", "warn", "not_pass"],
      criteria: [
        "traceability to feature request, mission, and previous step",
        "completeness for the step",
        "actionability for the next step",
        "consistency with neighboring artifacts",
        "absence of synthetic or no-op explanations that hide failure",
      ],
    },
    expected_response_shape: {
      artifact_quality_matrix: [
        {
          step: "discovery",
          status: "pass|warn|not_pass",
          judge_source: "agent",
          artifact_refs: [],
          findings: [],
        },
      ],
    },
    steps: options.stepMatrix.map((entry) => ({
      step: asNonEmptyString(entry.step),
      artifact_refs: asStringArray(entry.artifact_refs),
      observed_status: asNonEmptyString(entry.status),
    })),
  };
  writeJson(requestFile, request);
  return requestFile;
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
 *   agentJudgeFile: string | null,
 * }}
 */
function writeProofRunnerArtifacts(options) {
  const summaryFile = path.join(
    options.layout.reportsRoot,
    `live-e2e-run-summary-${normalizeId(options.runId)}.json`,
  );
  const scorecardFile = path.join(
    options.layout.reportsRoot,
    `live-e2e-scorecard-target-${normalizeId(options.runId)}.json`,
  );
  const agentJudgeDocument = loadAgentJudgeDocument(options.agentJudgeFile);
  const observationReport = buildObservationReport({
    runId: options.runId,
    profilePath: options.profilePath,
    profile: options.profile,
    flowResult: options.flowResult,
    summaryFile,
    agentJudgeDocument,
  });
  const observationValidation = validateContractDocument({
    family: "live-e2e-observation-report",
    document: observationReport,
    source: `runtime://live-e2e-observation/${options.runId}`,
  });
  if (!observationValidation.ok) {
    const issues = observationValidation.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Live E2E observation report failed contract validation: ${issues}`);
  }
  const observationReportFile = path.join(
    options.layout.reportsRoot,
    `live-e2e-observation-report-${normalizeId(options.runId)}.json`,
  );
  const agentArtifactReviewRequestFile = writeAgentArtifactReviewRequest({
    runId: options.runId,
    reportsRoot: options.layout.reportsRoot,
    stepMatrix: observationReport.step_matrix,
  });
  options.flowResult.artifacts.live_e2e_observation_report_file = observationReportFile;
  options.flowResult.artifacts.agent_artifact_review_request_file = agentArtifactReviewRequestFile;
  options.flowResult.artifacts.live_e2e_observation_overall_status = observationReport.overall_status;

  const summary = {
    run_id: options.runId,
    project_id: options.hostProjectId,
    profile_ref: options.profilePath,
    profile_id: options.profile.profile_id ?? null,
    scenario_id: options.profile.scenario_id ?? null,
    scenario_family: options.profile.scenario_family ?? null,
    target_catalog_id: options.profile.target_catalog_id ?? null,
    feature_mission_id: options.flowResult.artifacts.feature_mission_id ?? options.profile.feature_mission_id ?? null,
    provider_variant_id: options.profile.provider_variant_id ?? null,
    feature_size: options.flowResult.artifacts.feature_size ?? null,
    flow_kind: options.profile.flow_kind ?? null,
    duration_class: options.profile.duration_class ?? null,
    started_at: options.flowResult.startedAt,
    finished_at: options.flowResult.finishedAt,
    status: observationReport.overall_status,
    legacy_flow_status: options.flowResult.status,
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
    runtime_harness_report_file:
      typeof options.flowResult.artifacts.runtime_harness_report_file === "string"
        ? options.flowResult.artifacts.runtime_harness_report_file
        : null,
    baseline_verify_summary_file:
      typeof options.flowResult.artifacts.baseline_verify_summary_file === "string"
        ? options.flowResult.artifacts.baseline_verify_summary_file
        : null,
    baseline_verify_status: asNonEmptyString(options.flowResult.artifacts.baseline_verify_status) || null,
    baseline_verify_gate_decision:
      typeof options.flowResult.artifacts.baseline_verify_gate_decision === "object" &&
      options.flowResult.artifacts.baseline_verify_gate_decision
        ? options.flowResult.artifacts.baseline_verify_gate_decision
        : null,
    post_run_verify_summary_file:
      typeof options.flowResult.artifacts.post_run_verify_summary_file === "string"
        ? options.flowResult.artifacts.post_run_verify_summary_file
        : null,
    post_run_verify_status: asNonEmptyString(options.flowResult.artifacts.post_run_verify_status) || null,
    post_run_diagnostic_verify_summary_file:
      typeof options.flowResult.artifacts.post_run_diagnostic_verify_summary_file === "string"
        ? options.flowResult.artifacts.post_run_diagnostic_verify_summary_file
        : null,
    post_run_diagnostic_status: asNonEmptyString(options.flowResult.artifacts.post_run_diagnostic_status) || null,
    provider_execution_status: asNonEmptyString(options.flowResult.artifacts.provider_execution_status) || null,
    real_code_change_status: asNonEmptyString(options.flowResult.artifacts.real_code_change_status) || null,
    runtime_harness_decision: asNonEmptyString(options.flowResult.artifacts.runtime_harness_decision) || null,
    run_start_runtime_harness_decision:
      asNonEmptyString(options.flowResult.artifacts.run_start_runtime_harness_decision) || null,
    latest_runtime_harness_decision:
      asNonEmptyString(options.flowResult.artifacts.latest_runtime_harness_decision) || null,
    quality_gate_decision: asNonEmptyString(options.flowResult.artifacts.quality_gate_decision) || null,
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
    live_e2e_observation_report_file: observationReportFile,
    live_e2e_observation_overall_status: observationReport.overall_status,
    agent_artifact_review_request_file: agentArtifactReviewRequestFile,
    matrix_cell:
      typeof options.flowResult.artifacts.matrix_cell === "object" && options.flowResult.artifacts.matrix_cell
        ? options.flowResult.artifacts.matrix_cell
        : null,
    coverage_follow_up:
      typeof options.flowResult.artifacts.coverage_follow_up === "object" && options.flowResult.artifacts.coverage_follow_up
        ? options.flowResult.artifacts.coverage_follow_up
        : null,
    verdict_matrix:
      typeof options.flowResult.artifacts.verdict_matrix === "object" && options.flowResult.artifacts.verdict_matrix
        ? options.flowResult.artifacts.verdict_matrix
        : null,
    scorecard_files: [scorecardFile],
    control_surfaces: {
      installed_user_proof_runner:
        "node ./scripts/live-e2e/run-profile.mjs --project-ref <path> --profile <path> [--run-id <id>] [--runtime-root <path>] [--aor-bin <path>] [--examples-root <path>] [--catalog-root <path>] [--runner-auth-mode host|isolated] [--runtime-agent-permission-mode full-bypass|restricted] [--agent-judge-file <path>]",
      public_cli_sequence: options.flowResult.commandResults.map((result) => result.command_surface).filter(Boolean),
      aor_bin: options.aorLaunch.binaryRef,
      examples_root: options.examplesRoot,
    },
    runner_auth_mode: asNonEmptyString(options.flowResult.artifacts.runner_auth_mode) || null,
    runner_auth_source: asNonEmptyString(options.flowResult.artifacts.runner_auth_source) || null,
    runtime_agent_permission_mode: asNonEmptyString(options.flowResult.artifacts.runtime_agent_permission_mode) || null,
    error:
      observationReport.overall_status === "not_pass"
        ? options.flowResult.stageResults.find((stage) => stage.status === "fail")?.summary ||
          asNonEmptyString(asRecord(options.flowResult.artifacts.scenario_coverage).summary) ||
          "Installed-user rehearsal failed without a stage-level failure summary."
        : null,
  };
  const scorecard = buildScorecard({
    runId: options.runId,
    profilePath: options.profilePath,
    profile: options.profile,
    flowResult: options.flowResult,
    summaryFile,
  });

  writeJson(observationReportFile, observationReport);
  writeJson(summaryFile, summary);
  writeJson(scorecardFile, scorecard);

  let learningLoop = null;
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
        "Usage: node ./scripts/live-e2e/run-profile.mjs --project-ref <path> --profile <path> [--run-id <id>] [--runtime-root <path>] [--aor-bin <path>] [--examples-root <path>] [--catalog-root <path>] [--runner-auth-mode host|isolated] [--runtime-agent-permission-mode full-bypass|restricted] [--agent-judge-file <path>]",
        "",
        "Installed-user black-box proof runner.",
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
  const agentJudgeFile = resolveOptionalStringFlag(flags["agent-judge-file"], "agent-judge-file");
  const catalogRootOverride = resolveOptionalStringFlag(flags["catalog-root"], "catalog-root");
  const runnerAuthMode = resolveRunnerAuthMode(resolveOptionalStringFlag(flags["runner-auth-mode"], "runner-auth-mode"));
  const runtimeAgentPermissionMode = resolveRuntimeAgentPermissionMode(
    resolveOptionalStringFlag(flags["runtime-agent-permission-mode"], "runtime-agent-permission-mode"),
  );
  const explicitExamplesRoot =
    Object.prototype.hasOwnProperty.call(flags, "examples-root")
      ? resolveOptionalStringFlag(flags["examples-root"], "examples-root")
      : null;
  const { profilePath, profile: loadedProfile } = loadProofRunnerProfile({
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
          scenarioPolicyPath: fullJourneyResolution.scenarioPolicyPath,
          scenarioPolicy: fullJourneyResolution.scenarioPolicy,
          providerVariantPath: fullJourneyResolution.providerVariantPath,
          providerVariant: fullJourneyResolution.providerVariant,
          featureSize: fullJourneyResolution.featureSize,
          matrixCell: fullJourneyResolution.matrixCell,
          coverageFollowUp: fullJourneyResolution.coverageFollowUp,
          coverageTier: fullJourneyResolution.coverageTier,
          runnerAuthMode,
          runtimeAgentPermissionMode,
          authProbeRequired: resolveAuthProbeRequired(profile),
        })
      : executeInstalledUserFlow({
          hostRoot,
          layout,
          runId,
          profilePath,
          profile,
          aorLaunch,
          runnerAuthMode,
          runtimeAgentPermissionMode,
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
        runtime_agent_permission_mode: runtimeAgentPermissionMode,
      },
    };
  }

  const written = writeProofRunnerArtifacts({
    hostRoot,
    hostProjectId,
    layout,
    runId,
    profilePath,
    profile,
    flowResult,
    aorLaunch,
    examplesRoot,
    agentJudgeFile,
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        command: "scripts live-e2e run-profile",
        status: "ok",
        run_id: runId,
        live_e2e_run_status: written.summary.status,
        live_e2e_run_summary_file: written.summaryFile,
        live_e2e_observation_report_file: written.summary.live_e2e_observation_report_file,
        agent_artifact_review_request_file: written.summary.agent_artifact_review_request_file,
        live_e2e_scorecard_files: [written.scorecardFile],
        learning_loop_scorecard_file: written.learningLoop?.scorecardFile ?? null,
        learning_loop_handoff_file: written.learningLoop?.handoffFile ?? null,
        incident_report_file: written.learningLoop?.incidentFile ?? null,
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
