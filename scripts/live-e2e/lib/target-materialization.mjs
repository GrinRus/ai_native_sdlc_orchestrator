import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { stringify as stringifyYaml } from "yaml";
import { loadContractFile, validateContractDocument } from "../../../packages/contracts/src/index.mjs";

import {
  asNonEmptyString,
  asRecord,
  asStringArray,
  fileExists,
  normalizeId,
  readYamlDocument,
  writeJson,
} from "./common.mjs";

const DEFAULT_GENERATED_PROFILE_VERIFICATION_TIMEOUT_SEC = 1800;

const LIVE_E2E_STEP_POLICY_CLASSES = Object.freeze({
  discovery: "artifact",
  research: "artifact",
  spec: "artifact",
  planning: "planner",
  implement: "runner",
  review: "runner",
  qa: "runner",
  repair: "repair",
  eval: "eval",
  harness: "harness",
});
const LIVE_E2E_POLICY_SOURCE_FILES = Object.freeze({
  artifact: "step-artifact-default.yaml",
  planner: "step-planner-default.yaml",
  runner: "step-runner-default.yaml",
  repair: "step-repair-default.yaml",
  eval: "step-eval-default.yaml",
  harness: "step-harness-default.yaml",
});

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
export function materializeFeatureRequestFile(options) {
  const requestsRoot = path.join(options.targetCheckoutRoot, ".aor", "requests");
  fs.mkdirSync(requestsRoot, { recursive: true });
  const missionId = asNonEmptyString(options.mission.mission_id) || "feature-mission";
  const filePath = path.join(requestsRoot, `feature-request-${normalizeId(options.runId)}-${normalizeId(missionId)}.json`);
  const requestDocument = {
    mission_id: missionId,
    title: asNonEmptyString(options.mission.title) || missionId,
    brief: asNonEmptyString(options.mission.brief) || "Catalog-backed full-journey feature request.",
    goals: asStringArray(options.mission.goals),
    kpis: Array.isArray(options.mission.kpis)
      ? options.mission.kpis.filter((entry) => typeof entry === "object" && entry !== null && !Array.isArray(entry))
      : [],
    definition_of_done: asStringArray(options.mission.definition_of_done),
    expected_evidence: asStringArray(options.mission.expected_evidence),
    acceptance_checks: asStringArray(options.mission.acceptance_checks),
    change_evidence: asRecord(options.mission.change_evidence),
    post_run_quality: asRecord(options.mission.post_run_quality),
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
 *   layout: ReturnType<typeof ensureRuntimeLayout>,
 *   profile: Record<string, unknown>,
 *   runId: string,
 *   targetRepoId: string,
 * }} options
 */
function resolveTargetCheckoutRoot(options) {
  const livePolicy = asRecord(options.profile.live_e2e);
  const targetRepo = asRecord(options.profile.target_repo);
  const checkoutRootMode =
    asNonEmptyString(livePolicy.target_checkout_root_mode) || asNonEmptyString(targetRepo.checkout_root_mode);
  if (checkoutRootMode !== "short-physical") {
    return path.join(options.layout.targetCheckoutsRoot, `${normalizeId(options.targetRepoId)}-${normalizeId(options.runId)}`);
  }
  const digest = createHash("sha256")
    .update(`${options.runId}:${options.targetRepoId}`)
    .digest("hex")
    .slice(0, 16);
  return path.join(os.tmpdir(), "aor-target-checkouts", `x-${digest}`, normalizeId(options.targetRepoId));
}

/**
 * @param {{
 *   targetRoot: string,
 *   liveRoot: string,
 *   relativePath: string,
 * }} options
 */
/**
 * @param {{
 *   hostRoot: string,
 *   layout: ReturnType<typeof ensureRuntimeLayout>,
 *   runId: string,
 *   profile: Record<string, unknown>,
 *   reuseExistingCheckout?: boolean,
 * }}
 */
export function materializeTargetCheckout(options) {
  const targetRepo = asRecord(options.profile.target_repo);
  const targetRepoUrl = asNonEmptyString(targetRepo.repo_url);
  const targetRepoRef = asNonEmptyString(targetRepo.ref) || "main";
  const targetRepoId = asNonEmptyString(targetRepo.repo_id) || "target";
  const checkoutStrategy = asNonEmptyString(targetRepo.checkout_strategy) || "full";
  if (!targetRepoUrl) {
    throw new Error("Proof runner profile must declare target_repo.repo_url.");
  }

  const targetCheckoutRoot = resolveTargetCheckoutRoot({
    layout: options.layout,
    profile: options.profile,
    runId: options.runId,
    targetRepoId,
  });
  if (options.reuseExistingCheckout === true && fileExists(path.join(targetCheckoutRoot, ".git"))) {
    return {
      targetCheckoutRoot,
      targetRepoId,
      targetRepoRef,
      targetRepoUrl,
    };
  }
  fs.rmSync(targetCheckoutRoot, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(targetCheckoutRoot), { recursive: true });

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
 *   examplesRoot: string,
 *   generatedAssetsRoot: string,
 * }} options
 */
export function materializeHostLiveE2eAssets(options) {
  const assetsRoot = options.generatedAssetsRoot;
  fs.rmSync(assetsRoot, { recursive: true, force: true });
  fs.mkdirSync(assetsRoot, { recursive: true });
  fs.cpSync(options.examplesRoot, assetsRoot, { recursive: true });
  return {
    assetsRoot,
    routesRoot: path.join(assetsRoot, "routes"),
    contextRoot: path.join(assetsRoot, "context"),
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
  const testsEnabled = verification.tests !== false;

  repoRecord.build_commands = buildEnabled ? verificationCommands : [];
  repoRecord.lint_commands = setupCommands;
  repoRecord.test_commands = testsEnabled ? verificationCommands : [];
}

/**
 * @param {{
 *   catalogVerification: Record<string, unknown>,
 *   profileVerification: Record<string, unknown>,
 *   mission?: Record<string, unknown>,
 * }} options
 */
function resolveGeneratedProfileVerification(options) {
  const missionQuality = asRecord(asRecord(options.mission).post_run_quality);
  const catalogSetupCommands = asStringArray(options.catalogVerification.setup_commands);
  const profileSetupCommands = asStringArray(options.profileVerification.setup_commands);
  const catalogVerificationCommands = asStringArray(options.catalogVerification.commands);
  const profileVerificationCommands = asStringArray(options.profileVerification.commands);
  const missionPrimaryCommands = asStringArray(missionQuality.primary_commands);

  return {
    ...options.catalogVerification,
    ...options.profileVerification,
    setup_commands: profileSetupCommands.length > 0 ? profileSetupCommands : catalogSetupCommands,
    commands:
      profileVerificationCommands.length > 0
        ? profileVerificationCommands
        : missionPrimaryCommands.length > 0
          ? missionPrimaryCommands
          : catalogVerificationCommands,
  };
}

/**
 * @param {Record<string, unknown>} profile
 * @param {Record<string, unknown>} runtimeDefaults
 * @returns {number}
 */
function resolveGeneratedProfileVerificationTimeoutSec(profile, runtimeDefaults) {
  const livePolicy = asRecord(profile.live_e2e);
  const verification = asRecord(profile.verification);
  for (const candidate of [
    livePolicy.target_command_timeout_sec,
    verification.command_timeout_sec,
    runtimeDefaults.verification_command_timeout_sec,
  ]) {
    const value = Number(candidate);
    if (Number.isFinite(value) && value > 0) {
      return Math.floor(value);
    }
  }
  return DEFAULT_GENERATED_PROFILE_VERIFICATION_TIMEOUT_SEC;
}

/**
 * @param {string} value
 * @returns {string}
 */
export function normalizeDeliveryMode(value) {
  const normalized = value.trim().toLowerCase();
  const modes = ["no-write", "patch-only", "local-branch", "fork-first-pr"];
  if (modes.includes(normalized)) return normalized;
  throw new Error(`Unsupported delivery mode '${value}'. Expected one of: ${modes.join(", ")}.`);
}

/**
 * @param {{
 *   hostRoot: string,
 *   profilePath: string,
 *   profile: Record<string, unknown>,
 *   catalogEntry?: Record<string, unknown>,
 *   mission?: Record<string, unknown>,
 *   providerVariant?: Record<string, unknown>,
 *   runId: string,
 *   targetCheckout: ReturnType<typeof materializeTargetCheckout>,
 *   generatedAssetsRoot: string,
 * }} options
 */
export function materializeGeneratedProjectProfile(options) {
  const templateRef = asNonEmptyString(options.profile.project_profile_template_ref) || "examples/project.github.aor.yaml";

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
  hydrateRepoVerificationCommands(
    selectedRepo,
    resolveGeneratedProfileVerification({
      catalogVerification: asRecord(asRecord(options.catalogEntry).verification),
      profileVerification: asRecord(options.profile.verification),
      mission: asRecord(options.mission),
    }),
  );
  generatedProjectProfile.repos = [selectedRepo];

  const runtimeDefaults = asRecord(generatedProjectProfile.runtime_defaults);
  runtimeDefaults.runtime_root = ".aor";
  runtimeDefaults.workspace_mode = asNonEmptyString(asRecord(options.profile.runtime).mode) || "ephemeral";
  runtimeDefaults.verification_command_timeout_sec = resolveGeneratedProfileVerificationTimeoutSec(
    options.profile,
    runtimeDefaults,
  );
  generatedProjectProfile.runtime_defaults = runtimeDefaults;

  const registryRoots = asRecord(generatedProjectProfile.registry_roots);
  for (const [key, value] of Object.entries(registryRoots)) {
    if (typeof value !== "string" || value.trim().length === 0) {
      continue;
    }
    const relative = value.replace(/^examples\/?/u, "");
    registryRoots[key] = path.join(options.generatedAssetsRoot, relative);
  }
  generatedProjectProfile.registry_roots = registryRoots;

  const pinnedProvider = asNonEmptyString(asRecord(options.providerVariant).provider);
  const pinnedAdapter = asNonEmptyString(asRecord(options.providerVariant).primary_adapter);
  if (pinnedProvider) {
    generatedProjectProfile.allowed_providers = Array.from(new Set([
      ...asStringArray(generatedProjectProfile.allowed_providers),
      pinnedProvider,
    ]));
  }
  if (pinnedAdapter) {
    generatedProjectProfile.allowed_adapters = Array.from(new Set([
      ...asStringArray(generatedProjectProfile.allowed_adapters),
      pinnedAdapter,
    ]));
  }

  const writebackPolicy = asRecord(generatedProjectProfile.writeback_policy);
  writebackPolicy.default_delivery_mode = normalizeDeliveryMode(
    asNonEmptyString(asRecord(options.profile.output_policy).preferred_delivery_mode) || "patch-only",
  );
  generatedProjectProfile.writeback_policy = writebackPolicy;

  const generatedProjectProfileFile = path.join(options.generatedAssetsRoot, `project-${normalizeId(options.runId)}.aor.yaml`);
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
 * @param {unknown} value
 * @returns {number | null}
 */
function asNonNegativeInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : null;
}

/**
 * @param {Record<string, unknown>} policy
 * @returns {Record<string, unknown>}
 */
function clonePolicyDocument(policy) {
  return /** @type {Record<string, unknown>} */ (JSON.parse(JSON.stringify(policy)));
}

/**
 * @param {{
 *   routesRoot: string,
 *   providerVariant: Record<string, unknown>,
 *   providerVariantId: string,
 *   profile?: Record<string, unknown>,
 * }} options
 */
export function materializeProviderPinnedRouteOverrides(options) {
  const routesRoot = options.routesRoot;
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
    const stepTimeouts = asRecord(asRecord(options.profile).live_e2e).provider_step_timeouts_sec;
    const stepTimeoutSec = Number(asRecord(stepTimeouts)[step]);
    if (Number.isFinite(stepTimeoutSec) && stepTimeoutSec > 0) {
      const constraints = asRecord(pinnedRoute.constraints);
      constraints.timeout_sec = Math.floor(stepTimeoutSec);
      pinnedRoute.constraints = constraints;
    }

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
 * @param {{
 *   policiesRoot: string,
 *   providerVariantId: string,
 *   providerVariant?: Record<string, unknown>,
 *   profile?: Record<string, unknown>,
 * }} options
 */
export function materializeProviderPinnedPolicyOverrides(options) {
  const policiesRoot = options.policiesRoot;
  if (!fileExists(policiesRoot) || !fs.statSync(policiesRoot).isDirectory()) {
    throw new Error(`Policies root '${policiesRoot}' was not found for provider override materialization.`);
  }

  const livePolicy = asRecord(asRecord(options.profile).live_e2e);
  const retryLimits = asRecord(livePolicy.provider_step_retry_max_attempts);
  const repairLimits = asRecord(livePolicy.provider_step_repair_max_attempts);
  const explicitSteps = [...new Set([...Object.keys(retryLimits), ...Object.keys(repairLimits)])]
    .map((step) => asNonEmptyString(step))
    .filter(Boolean);
  const profileDeclaresAttemptPolicy = explicitSteps.length > 0;
  const providerRouteSteps = asStringArray(asRecord(options.providerVariant).route_override_policy?.steps);
  const steps = profileDeclaresAttemptPolicy
    ? explicitSteps
    : providerRouteSteps
        .map((step) => asNonEmptyString(step))
        .filter(Boolean);

  /** @type {Record<string, string>} */
  const policyOverrides = {};
  /** @type {string[]} */
  const policyFiles = [];

  for (const step of steps) {
    const stepClass = LIVE_E2E_STEP_POLICY_CLASSES[step];
    if (!stepClass) {
      continue;
    }
    const retryMaxAttempts = profileDeclaresAttemptPolicy ? asNonNegativeInteger(retryLimits[step]) : 0;
    const repairMaxAttempts = profileDeclaresAttemptPolicy ? asNonNegativeInteger(repairLimits[step]) : 0;
    if (retryMaxAttempts === null && repairMaxAttempts === null) {
      continue;
    }

    const sourceFile = LIVE_E2E_POLICY_SOURCE_FILES[stepClass];
    const sourcePath = path.join(policiesRoot, sourceFile);
    if (!fileExists(sourcePath)) {
      throw new Error(`Base step policy '${sourcePath}' was not found for provider override materialization.`);
    }
    const basePolicy = asRecord(readYamlDocument(sourcePath));
    const pinnedPolicy = clonePolicyDocument(basePolicy);
    const originalPolicyId = asNonEmptyString(basePolicy.policy_id) || `policy.step.${stepClass}.default`;
    pinnedPolicy.policy_id = `${originalPolicyId}.${normalizeId(options.providerVariantId)}.${normalizeId(step)}.bounded`;

    if (retryMaxAttempts !== null) {
      const retry = asRecord(pinnedPolicy.retry);
      retry.max_attempts = retryMaxAttempts;
      pinnedPolicy.retry = retry;
    }
    if (repairMaxAttempts !== null) {
      const repair = asRecord(pinnedPolicy.repair);
      repair.max_attempts = repairMaxAttempts;
      pinnedPolicy.repair = repair;
    }

    const validation = validateContractDocument({
      family: "step-policy-profile",
      document: pinnedPolicy,
      source: `runtime://provider-policy-override/${normalizeId(options.providerVariantId)}/${step}`,
    });
    if (!validation.ok) {
      const issues = validation.issues.map((issue) => issue.message).join("; ");
      throw new Error(`Generated provider-pinned policy for step '${step}' failed validation: ${issues}`);
    }

    const policyFile = path.join(policiesRoot, `${step}-${normalizeId(options.providerVariantId)}-policy.yaml`);
    fs.writeFileSync(policyFile, stringifyYaml(pinnedPolicy), "utf8");
    policyOverrides[step] = /** @type {string} */ (pinnedPolicy.policy_id);
    policyFiles.push(policyFile);
  }

  return {
    policyOverrides,
    policyFiles,
  };
}
