import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { loadContractFile } from "../../../packages/contracts/src/index.mjs";

import {
  UsageError,
  asNonEmptyString,
  asRecord,
  asStringArray,
  fileExists,
  normalizeId,
  readYamlDocument,
} from "./common.mjs";
import { getProfileStages } from "./stages.mjs";

export const DEFAULT_BACKLOG_REFS = Object.freeze([
  "docs/backlog/mvp-implementation-backlog.md",
  "docs/backlog/mvp-roadmap.md",
  "docs/ops/live-e2e-standard-runner.md",
]);


/**
 * @param {string} hostRoot
 * @returns {string}
 */
export function discoverHostProjectId(hostRoot) {
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
export function ensureRuntimeLayout(options) {
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
export function createSessionRoots(options) {
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
export function createProofRunnerEnvironment(options) {
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
export function loadProofRunnerProfile(options) {
  const candidates = [
    path.resolve(process.cwd(), options.profileRef),
    path.resolve(options.hostRoot, options.profileRef),
  ];

  for (const candidate of candidates) {
    if (fileExists(candidate)) {
      const profile = readYamlDocument(candidate);
      assertLiveE2ePolicy(profile, candidate);
      return {
        profilePath: candidate,
        profile,
      };
    }
  }

  throw new UsageError(`Profile '${options.profileRef}' was not found from cwd or host project root.`);
}

/**
 * @param {Record<string, unknown>} profile
 * @param {string} source
 */
function assertLiveE2ePolicy(profile, source) {
  const profileId = asNonEmptyString(profile.profile_id) || path.basename(source);
  const policy = asRecord(profile.live_e2e);
  const flowRangePolicy = asNonEmptyString(policy.flow_range_policy);
  const installationPolicy = asNonEmptyString(policy.installation_policy);
  const interactionCapability = asNonEmptyString(policy.interaction_capability);
  const frontendCapability = asNonEmptyString(policy.frontend_capability);
  const safetyPolicy = asNonEmptyString(policy.safety_policy);
  const operatorMode = asNonEmptyString(policy.operator_mode);
  const agentDecisionPolicy = asNonEmptyString(policy.agent_decision_policy);
  const interactionAnswerPolicy = asNonEmptyString(policy.interaction_answer_policy);
  const targetWritePolicy = asNonEmptyString(policy.target_write_policy);
  const internalTestHooks = asRecord(profile.internal_test_hooks);
  const implementationLoop = asRecord(profile.implementation_loop);
  const acceptanceLike =
    internalTestHooks.allow_deterministic_operator_for_test !== true &&
    (["acceptance", "production-proof"].includes(asNonEmptyString(profile.run_tier)) ||
      asRecord(profile.production_proof).enabled === true ||
      asNonEmptyString(profile.journey_mode) === "full-journey" ||
      Boolean(asNonEmptyString(profile.target_catalog_id)));
  const problems = [];

  if (!["delivery_default", "full_lifecycle"].includes(flowRangePolicy)) {
    problems.push("live_e2e.flow_range_policy must be delivery_default or full_lifecycle");
  }
  if (!["source-install-required", "provided-binary-required"].includes(installationPolicy)) {
    problems.push("live_e2e.installation_policy must be source-install-required or provided-binary-required");
  }
  if (!["public-control-plane"].includes(interactionCapability)) {
    problems.push("live_e2e.interaction_capability must be public-control-plane");
  }
  if (!["none", "guided-app-smoke"].includes(frontendCapability)) {
    problems.push("live_e2e.frontend_capability must be none or guided-app-smoke");
  }
  if (!["no-upstream-write"].includes(safetyPolicy)) {
    problems.push("live_e2e.safety_policy must be no-upstream-write");
  }
  if (!["skill-agent", "deterministic-fixture"].includes(operatorMode)) {
    problems.push("live_e2e.operator_mode must be skill-agent or deterministic-fixture");
  }
  if (!["required", "optional"].includes(agentDecisionPolicy)) {
    problems.push("live_e2e.agent_decision_policy must be required or optional");
  }
  if (!["agent-required", "deterministic-fixture"].includes(interactionAnswerPolicy)) {
    problems.push("live_e2e.interaction_answer_policy must be agent-required or deterministic-fixture");
  }
  if (targetWritePolicy !== "aor-runtime-only-before-execution") {
    problems.push("live_e2e.target_write_policy must be aor-runtime-only-before-execution");
  }
  if (acceptanceLike) {
    if (operatorMode !== "skill-agent") {
      problems.push("acceptance/production-proof profiles must use live_e2e.operator_mode=skill-agent");
    }
    if (agentDecisionPolicy !== "required") {
      problems.push("acceptance/production-proof profiles must use live_e2e.agent_decision_policy=required");
    }
    if (interactionAnswerPolicy !== "agent-required") {
      problems.push("acceptance/production-proof profiles must use live_e2e.interaction_answer_policy=agent-required");
    }
    if (implementationLoop.enabled !== true) {
      problems.push("acceptance/production-proof profiles must enable implementation_loop.enabled=true");
    }
    if (!Number.isInteger(implementationLoop.max_iterations) || Number(implementationLoop.max_iterations) < 1) {
      problems.push("acceptance/production-proof profiles must declare implementation_loop.max_iterations >= 1");
    }
  }

  if (problems.length > 0) {
    throw new UsageError(`Live E2E profile '${profileId}' is missing black-box step-loop policy: ${problems.join("; ")}.`);
  }
}

/**
 * @param {{ hostRoot: string, catalogRootOverride: string | null }} options
 * @returns {string}
 */
export function resolveCatalogRoot(options) {
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
export function loadCatalogTarget(options) {
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
export function loadCatalogScenarioPolicy(options) {
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
export function loadCatalogProviderVariant(options) {
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
  return value === "small" || value === "medium" || value === "large" || value === "xl";
}

/**
 * @param {Record<string, unknown>} profile
 * @returns {Record<string, unknown>}
 */
export function resolveProductionProofPolicy(profile) {
  const productionProof = asRecord(profile.production_proof);
  if (productionProof.enabled !== true) {
    return {
      enabled: false,
    };
  }
  return {
    enabled: true,
    profile_status: asNonEmptyString(productionProof.profile_status) || "candidate",
    proof_scope: asNonEmptyString(productionProof.proof_scope) || "full_code_changing_runtime_candidate",
    external_runner_mode: asNonEmptyString(productionProof.external_runner_mode) || "real-external-process",
    real_code_change_proof_required: productionProof.real_code_change_proof_required !== false,
    real_code_change_proof_complete: productionProof.real_code_change_proof_complete === true,
    mock_runner_allowed: productionProof.mock_runner_allowed === true,
    no_upstream_write_required: productionProof.no_upstream_write_required !== false,
    require_runner_auth: productionProof.require_runner_auth !== false,
    require_permission_readiness: productionProof.require_permission_readiness !== false,
    require_blocking_target_verification: productionProof.require_blocking_target_verification !== false,
    required_failure_mode: asNonEmptyString(productionProof.required_failure_mode) || "fail-closed",
  };
}

/**
 * @param {unknown} value
 */
function hasStrings(value) {
  return asStringArray(value).length > 0;
}

/**
 * @param {Record<string, unknown>} resolvedProfile
 * @param {Record<string, unknown>} proofPolicy
 */
function assertProductionProofReadiness(resolvedProfile, proofPolicy) {
  if (proofPolicy.enabled !== true) {
    return;
  }

  const profileId = asNonEmptyString(resolvedProfile.profile_id) || "production-proof-profile";
  const verification = asRecord(resolvedProfile.verification);
  const outputPolicy = asRecord(resolvedProfile.output_policy);
  const baselineGateMode = asNonEmptyString(asRecord(verification.baseline_gate).mode).toLowerCase();
  const preferredDeliveryMode = asNonEmptyString(outputPolicy.preferred_delivery_mode).toLowerCase();
  const allowedProductionDeliveryModes = ["patch-only", "local-branch"];
  const problems = [];

  if (asNonEmptyString(proofPolicy.external_runner_mode) !== "real-external-process") {
    problems.push("production_proof.external_runner_mode must be 'real-external-process'");
  }
  if (asNonEmptyString(proofPolicy.required_failure_mode) !== "fail-closed") {
    problems.push("production_proof.required_failure_mode must be 'fail-closed'");
  }
  if (proofPolicy.real_code_change_proof_required !== true) {
    problems.push("production_proof.real_code_change_proof_required must stay true for production-proof profiles");
  }
  if (proofPolicy.mock_runner_allowed === true) {
    problems.push("production_proof.mock_runner_allowed must stay false for production-proof profiles");
  }
  if (proofPolicy.require_runner_auth !== true) {
    problems.push("production_proof.require_runner_auth must stay true for production-proof profiles");
  }
  if (proofPolicy.require_runner_auth === true && resolvedProfile.live_adapter_preflight?.auth_probe_required === false) {
    problems.push("live_adapter_preflight.auth_probe_required cannot be false for production-proof profiles");
  }
  if (proofPolicy.require_permission_readiness !== true) {
    problems.push("production_proof.require_permission_readiness must stay true for production-proof profiles");
  }
  if (proofPolicy.no_upstream_write_required !== true) {
    problems.push("production_proof.no_upstream_write_required must stay true for production-proof profiles");
  }
  if (proofPolicy.no_upstream_write_required === true && outputPolicy.write_back_to_remote !== false) {
    problems.push("output_policy.write_back_to_remote must be false for production-proof profiles");
  }
  if (!allowedProductionDeliveryModes.includes(preferredDeliveryMode)) {
    problems.push(
      `output_policy.preferred_delivery_mode must be one of ${allowedProductionDeliveryModes.join(", ")} for production-proof profiles`,
    );
  }
  if (proofPolicy.require_blocking_target_verification !== true) {
    problems.push("production_proof.require_blocking_target_verification must stay true for production-proof profiles");
  }
  if (proofPolicy.require_blocking_target_verification === true && baselineGateMode !== "blocking") {
    problems.push("verification.baseline_gate.mode must be 'blocking' for production-proof profiles");
  }
  if (!hasStrings(verification.setup_commands)) {
    problems.push("verification.setup_commands must declare at least one target readiness command");
  }
  if (!hasStrings(verification.commands)) {
    problems.push("verification.commands must declare at least one target verification command");
  }

  if (problems.length > 0) {
    throw new UsageError(`Production proof profile '${profileId}' is not fail-closed: ${problems.join("; ")}.`);
  }
}

/**
 * @param {Record<string, unknown>} catalogEntry
 * @param {string} featureMissionId
 * @param {string} scenarioFamily
 * @param {string} providerVariantId
 */
function resolveMatrixCell(catalogEntry, featureMissionId, scenarioFamily, providerVariantId) {
  const trackedCells = Array.isArray(catalogEntry.required_matrix_cells)
    ? /** @type {Array<Record<string, unknown>>} */ (catalogEntry.required_matrix_cells)
    : [];
  const requiredCells = trackedCells.filter((cell) => (asNonEmptyString(cell.coverage_tier) || "required") === "required");
  const matchingCell =
    trackedCells.find(
      (cell) =>
        asNonEmptyString(cell.feature_mission_id) === featureMissionId &&
        asNonEmptyString(cell.scenario_family) === scenarioFamily &&
        asNonEmptyString(cell.provider_variant_id) === providerVariantId,
    ) ?? null;
  const remainingRequiredCells = requiredCells.filter((cell) => cell !== matchingCell);
  const matchingCellCoverageTier = matchingCell ? asNonEmptyString(matchingCell.coverage_tier) || "required" : "extended";
  return {
    coverageTier: matchingCellCoverageTier,
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
      coverage_tier: matchingCellCoverageTier,
    },
    coverageFollowUp: {
      current_cell_required: matchingCellCoverageTier === "required",
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
export function isFullJourneyProfile(profile) {
  return asNonEmptyString(profile.journey_mode) === "full-journey" || asNonEmptyString(profile.target_catalog_id).length > 0;
}

/**
 * @param {{
 *   profile: Record<string, unknown>,
 *   catalogRoot: string,
 * }} options
 */
export function resolveFullJourneyProfile(options) {
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
      `Feature mission '${featureMissionId}' in catalog '${targetCatalogId}' must declare feature_size as small, medium, large, or xl.`,
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
  const productionProofPolicy = resolveProductionProofPolicy(resolvedProfile);
  resolvedProfile.production_proof = productionProofPolicy;
  assertProductionProofReadiness(resolvedProfile, productionProofPolicy);
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
