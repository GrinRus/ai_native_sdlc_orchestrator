#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  parse as parseYaml,
  stringify as stringifyYaml,
} from "../../packages/contracts/node_modules/yaml/dist/index.js";

import { classifyExternalRunnerFailure } from "../../packages/adapter-sdk/src/index.mjs";
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
  const runtimeArgs = asStringArray(externalRuntime.args);
  const timeoutMs = asPositiveInteger(externalRuntime.timeout_ms, 30000);
  const probeTimeoutMs = Math.min(timeoutMs, 30000);
  const envOverrides = asStringMap(externalRuntime.env);
  const runnerEnv = {
    ...options.env,
    ...envOverrides,
  };
  const runtimeReport = {
    runtime_mode: runtimeMode || null,
    live_baseline: liveBaseline,
    external_runtime: {
      command: runtimeCommand || null,
      args: runtimeArgs,
      timeout_ms: timeoutMs,
      auth_probe_timeout_ms: probeTimeoutMs,
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

  if (!options.authProbeRequired) {
    const report = {
      ...baseReport,
      ...runtimeReport,
      resolved_command: resolvedCommand,
      auth_probe: {
        enabled: false,
        status: "skipped",
        attempts: [],
      },
      summary: `Live adapter preflight passed for provider variant '${options.providerVariantId}' with auth probe skipped.`,
    };
    writeJson(reportFile, report);
    return {
      status: "pass",
      summary: asNonEmptyString(report.summary),
      report,
      reportFile,
    };
  }

  const buildProbeInput = (stepClass, objective) => `${JSON.stringify({
    request: {
      request_id: `live-adapter-preflight.${stepClass}`,
      run_id: options.runId,
      step_id: `live-adapter-preflight.${stepClass}`,
      step_class: stepClass,
      objective,
      non_interactive: true,
    },
    adapter: {
      adapter_id: adapterId,
      provider_variant_id: options.providerVariantId,
    },
  })}\n`;
  const runProbeAttempt = (kind, attempt, objective) => {
    const probe = spawnSync(resolvedCommand, runtimeArgs, {
      cwd: options.targetCheckoutRoot,
      env: runnerEnv,
      encoding: "utf8",
      input: buildProbeInput(kind, objective),
      timeout: probeTimeoutMs,
      maxBuffer: 1024 * 1024,
    });
    const probeError = probe.error instanceof Error ? probe.error : null;
    const probeTimedOut =
      probeError?.code === "ETIMEDOUT" || (probe.signal === "SIGTERM" && probe.status === null);
    const commandFailed = probeError !== null || probeTimedOut || probe.status !== 0;
    const semanticFailureKind = classifyExternalRunnerFailure({
      stdout: probe.stdout ?? "",
      stderr: probe.stderr ?? "",
      errorMessage: probeError?.message ?? null,
      defaultFailureKind: "none",
    });
    const failureKind =
      probeError?.code === "ENOENT"
        ? "missing-command"
        : probeTimedOut
          ? "external-runner-timeout"
          : commandFailed
            ? classifyExternalRunnerFailure({
                stdout: probe.stdout ?? "",
                stderr: probe.stderr ?? "",
                errorMessage: probeError?.message ?? null,
                defaultFailureKind: "external-runner-failed",
              })
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
      stdout_excerpt: (probe.stdout ?? "").slice(0, 4000),
      stderr_excerpt: (probe.stderr ?? "").slice(0, 4000),
    };
  };
  const authAttempts = [];
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
        auth_probe: {
          enabled: true,
          status: "pass",
          attempts: authAttempts,
          exit_code: finalAuthAttempt.exit_code,
          signal: finalAuthAttempt.signal,
          timed_out: false,
        },
        edit_readiness: {
          enabled: true,
          status: "fail",
          failure_kind: failureKind,
          attempts: [editReadiness],
        },
      },
    );
  }

  const report = {
    ...baseReport,
    ...runtimeReport,
    resolved_command: resolvedCommand,
    auth_probe: {
      enabled: true,
      status: "pass",
      attempts: authAttempts,
      exit_code: finalAuthAttempt.exit_code,
      signal: finalAuthAttempt.signal,
      timed_out: false,
    },
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
 * @param {{
 *   hostRoot: string,
 *   layout: ReturnType<typeof ensureRuntimeLayout>,
 *   runId: string,
 *   profilePath: string,
 *   profile: Record<string, unknown>,
 *   aorLaunch: ReturnType<typeof resolveAorLaunch>,
 *   examplesRoot: string,
 *   runnerAuthMode: "host" | "isolated",
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

  const artifacts = {
    host_runtime_root: options.layout.runtimeRoot,
    host_reports_root: options.layout.reportsRoot,
    session_root: sessionRoots.sessionRoot,
    aor_home: sessionRoots.aorHome,
    codex_home: sessionRoots.codexHome,
    codex_home_isolated: options.runnerAuthMode === "isolated",
    runner_auth_mode: proofRunnerEnvironment.runnerAuthMode,
    runner_auth_source: proofRunnerEnvironment.runnerAuthSource,
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
      commandResults.push(buildCommandDiagnostic(result));
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
 *   scenarioPolicyPath: string,
 *   scenarioPolicy: Record<string, unknown>,
 *   providerVariantPath: string,
 *   providerVariant: Record<string, unknown>,
 *   featureSize: string,
 *   matrixCell: Record<string, unknown>,
 *   coverageFollowUp: Record<string, unknown>,
 *   coverageTier: string,
 *   runnerAuthMode: "host" | "isolated",
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
      commandResults.push(buildCommandDiagnostic(result));
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
      "--routed-dry-run-step",
      "implement",
      ...(routeOverridesFlag ? ["--route-overrides", routeOverridesFlag] : []),
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
      ...(routeOverridesFlag ? ["--route-overrides", routeOverridesFlag] : []),
    ]);
    artifacts.routed_step_result_file = getStringField(runStart.payload, "routed_step_result_file");
    artifacts.routed_step_result_id = getStringField(runStart.payload, "routed_step_result_id");
    artifacts.runtime_harness_report_file = getStringField(runStart.payload, "runtime_harness_report_file");
    artifacts.runtime_harness_overall_decision = getStringField(runStart.payload, "runtime_harness_overall_decision");
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
    artifacts.runtime_harness_report_file =
      getStringField(reviewRun.payload, "runtime_harness_report_file") || artifacts.runtime_harness_report_file;
    artifacts.runtime_harness_overall_decision =
      getStringField(reviewRun.payload, "runtime_harness_overall_decision") ||
      artifacts.runtime_harness_overall_decision;
    const reviewReport = artifacts.review_report_file && fileExists(artifacts.review_report_file)
      ? readJson(artifacts.review_report_file)
      : {};
    const reviewOverallStatus = normalizeVerdictStatus(reviewReport.overall_status);
    const featureSizeFitStatus = normalizeVerdictStatus(asRecord(reviewReport.feature_size_fit).status);
    const providerExecutionStatus = normalizeVerdictStatus(asRecord(reviewReport.provider_traceability).status);
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
    artifacts.runtime_harness_report_file =
      getStringField(learningHandoff.payload, "runtime_harness_report_file") || artifacts.runtime_harness_report_file;
    artifacts.runtime_harness_overall_decision =
      getStringField(learningHandoff.payload, "runtime_harness_overall_decision") ||
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
    }

    const scenarioCoverage = evaluateScenarioCoverage({
      scenarioPolicy: options.scenarioPolicy,
      stageResults: flattenStageMap(stageMap),
      artifacts,
      auditPayload,
    });
    artifacts.scenario_coverage = scenarioCoverage;
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
      scenario_family: asNonEmptyString(options.profile.scenario_family) || null,
      provider_variant_id: asNonEmptyString(options.profile.provider_variant_id) || null,
      feature_size: options.featureSize,
      target_selection: "pass",
      feature_request_quality: artifacts.intake_artifact_packet_file && artifacts.feature_request_file ? "pass" : "fail",
      scenario_coverage_status: scenarioCoverage.status,
      provider_execution_status: providerExecutionStatus,
      discovery_quality: normalizeVerdictStatus(asRecord(reviewReport.discovery_quality).status),
      runtime_success:
        artifacts.routed_step_result_file &&
        artifacts.runtime_harness_report_file &&
        artifacts.runtime_harness_overall_decision === "pass"
          ? "pass"
          : "fail",
      runtime_harness_decision: artifacts.runtime_harness_overall_decision || "unknown",
      artifact_quality: normalizeVerdictStatus(asRecord(reviewReport.artifact_quality).status),
      code_quality: normalizeVerdictStatus(asRecord(reviewReport.code_quality).status),
      feature_size_fit_status: featureSizeFitStatus,
      delivery_release_quality: deliveryReleaseQuality,
      learning_loop_closure: learningLoopClosure,
      overall_verdict: "pass",
    };
    const verdictStatuses = [
      verdictMatrix.target_selection,
      verdictMatrix.feature_request_quality,
      verdictMatrix.scenario_coverage_status,
      verdictMatrix.discovery_quality,
      verdictMatrix.runtime_success,
      verdictMatrix.artifact_quality,
      verdictMatrix.code_quality,
      verdictMatrix.provider_execution_status,
      verdictMatrix.feature_size_fit_status,
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
    status: options.flowResult.status,
    scenario_coverage_status: verdictMatrix.scenario_coverage_status ?? null,
    provider_execution_status: verdictMatrix.provider_execution_status ?? null,
    feature_size_fit_status: verdictMatrix.feature_size_fit_status ?? null,
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
function writeProofRunnerArtifacts(options) {
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
    scenario_family: options.profile.scenario_family ?? null,
    provider_variant_id: options.profile.provider_variant_id ?? null,
    feature_size: options.flowResult.artifacts.feature_size ?? null,
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
    runtime_harness_report_file:
      typeof options.flowResult.artifacts.runtime_harness_report_file === "string"
        ? options.flowResult.artifacts.runtime_harness_report_file
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
        "node ./scripts/live-e2e/run-profile.mjs --project-ref <path> --profile <path> [--run-id <id>] [--runtime-root <path>] [--aor-bin <path>] [--examples-root <path>] [--catalog-root <path>] [--runner-auth-mode host|isolated]",
      public_cli_sequence: options.flowResult.commandResults.map((result) => result.command_surface).filter(Boolean),
      aor_bin: options.aorLaunch.binaryRef,
      examples_root: options.examplesRoot,
    },
    runner_auth_mode: asNonEmptyString(options.flowResult.artifacts.runner_auth_mode) || null,
    runner_auth_source: asNonEmptyString(options.flowResult.artifacts.runner_auth_source) || null,
    error:
      options.flowResult.status === "fail"
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
        "Usage: node ./scripts/live-e2e/run-profile.mjs --project-ref <path> --profile <path> [--run-id <id>] [--runtime-root <path>] [--aor-bin <path>] [--examples-root <path>] [--catalog-root <path>] [--runner-auth-mode host|isolated]",
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
  const catalogRootOverride = resolveOptionalStringFlag(flags["catalog-root"], "catalog-root");
  const runnerAuthMode = resolveRunnerAuthMode(resolveOptionalStringFlag(flags["runner-auth-mode"], "runner-auth-mode"));
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
