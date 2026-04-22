import fs from "node:fs";
import path from "node:path";

import { loadContractFile } from "../../contracts/src/index.mjs";
import {
  SUPPORTED_STEP_CLASSES,
  resolveRouteForStep,
} from "../../provider-routing/src/route-resolution.mjs";

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function asRecord(value) {
  return typeof value === "object" && value !== null ? /** @type {Record<string, unknown>} */ (value) : {};
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
 * @returns {number | null}
 */
function asNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function asString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * @param {Record<string, unknown>} projectProfile
 * @returns {string[]}
 */
function collectProjectCommandAllowlist(projectProfile) {
  const repos = Array.isArray(projectProfile.repos) ? projectProfile.repos : [];
  /** @type {string[]} */
  const commands = [];

  for (const repo of repos) {
    const repoRecord = asRecord(repo);
    commands.push(
      ...asStringArray(repoRecord.build_commands),
      ...asStringArray(repoRecord.test_commands),
      ...asStringArray(repoRecord.lint_commands),
    );
  }

  return [...new Set(commands)];
}

/**
 * @param {{
 *   policiesRoot: string,
 * }} options
 * @returns {Map<string, { profile: Record<string, unknown>, source: string }>}
 */
export function buildStepPolicyRegistry(options) {
  if (!fs.existsSync(options.policiesRoot)) {
    throw new Error(`Step policy registry root '${options.policiesRoot}' does not exist.`);
  }

  const entries = fs
    .readdirSync(options.policiesRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(yaml|yml)$/u.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  const registry = new Map();
  for (const filename of entries) {
    const source = path.join(options.policiesRoot, filename);
    const loaded = loadContractFile({
      filePath: source,
      family: "step-policy-profile",
    });
    if (!loaded.ok) {
      throw new Error(`Step policy profile '${source}' failed contract validation.`);
    }

    const profile = asRecord(loaded.document);
    const policyId = profile.policy_id;
    const stepClass = profile.step_class;

    if (typeof policyId !== "string" || policyId.trim().length === 0) {
      throw new Error(`Step policy profile '${source}' is missing policy_id.`);
    }
    if (typeof stepClass !== "string" || stepClass.trim().length === 0) {
      throw new Error(`Step policy profile '${source}' is missing step_class.`);
    }
    if (registry.has(policyId)) {
      throw new Error(`Policy id '${policyId}' is declared more than once in step policy registry.`);
    }

    registry.set(policyId, { profile, source });
  }

  return registry;
}

/**
 * @param {{
 *   projectProfilePath: string,
 *   routesRoot: string,
 *   policiesRoot: string,
 *   stepClass: string,
 *   routeOverrides?: Record<string, string>,
 *   policyOverrides?: Record<string, string>,
 *   policyRegistry: Map<string, { profile: Record<string, unknown>, source: string }>,
 * }} options
 */
function resolveStepPolicyForStepWithRegistry(options) {
  const routeResolution = resolveRouteForStep({
    projectProfilePath: options.projectProfilePath,
    routesRoot: options.routesRoot,
    stepClass: options.stepClass,
    stepOverrides: options.routeOverrides,
  });

  const loadedProfile = loadContractFile({
    filePath: options.projectProfilePath,
    family: "project-profile",
  });
  if (!loadedProfile.ok) {
    throw new Error(`Project profile '${options.projectProfilePath}' failed contract validation.`);
  }
  const projectProfile = asRecord(loadedProfile.document);
  const defaultStepPolicies = asRecord(projectProfile.default_step_policies);

  const rawPolicyOverrides = asRecord(options.policyOverrides ?? {});
  for (const key of Object.keys(rawPolicyOverrides)) {
    if (!SUPPORTED_STEP_CLASSES.includes(key)) {
      throw new Error(
        `Unknown policy override '${key}'. Expected one of: ${SUPPORTED_STEP_CLASSES.join(", ")}.`,
      );
    }
  }

  const routeClass = asString(routeResolution.route_profile.route_class);
  if (!routeClass) {
    throw new Error(
      `Policy resolution failed for step '${options.stepClass}': resolved route has no route_class.`,
    );
  }

  const overrideValue = asString(rawPolicyOverrides[options.stepClass]);
  const defaultValue = asString(defaultStepPolicies[routeClass]);
  const resolvedPolicyId = overrideValue ?? defaultValue;

  if (!resolvedPolicyId) {
    throw new Error(
      `Policy resolution failed for step '${options.stepClass}': missing source in policy override and default_step_policies.${routeClass}.`,
    );
  }

  const policyEntry = options.policyRegistry.get(resolvedPolicyId);
  if (!policyEntry) {
    const sourceField = overrideValue
      ? `policy_overrides.${options.stepClass}`
      : `default_step_policies.${routeClass}`;
    throw new Error(
      `Policy resolution failed for step '${options.stepClass}': '${resolvedPolicyId}' from ${sourceField} is not present in step policy registry '${options.policiesRoot}'.`,
    );
  }

  const policyStepClass = asString(policyEntry.profile.step_class);
  if (policyStepClass !== routeClass) {
    const sourceField = overrideValue
      ? `policy_overrides.${options.stepClass}`
      : `default_step_policies.${routeClass}`;
    throw new Error(
      `Policy resolution conflict for step '${options.stepClass}': ${sourceField} points to policy '${resolvedPolicyId}' with step_class '${String(policyStepClass)}', expected '${routeClass}'.`,
    );
  }

  const routeProfile = asRecord(routeResolution.route_profile);
  const routeConstraints = asRecord(routeProfile.constraints);
  const budgetPolicy = asRecord(projectProfile.budget_policy);
  const writebackPolicy = asRecord(projectProfile.writeback_policy);
  const approvalPolicy = asRecord(projectProfile.approval_policy);
  const securityPolicy = asRecord(projectProfile.security_policy);

  const maxCostFromRoute = asNumber(routeConstraints.max_cost_usd);
  const maxCostFromProject = asNumber(budgetPolicy.default_cost_limit_usd);
  const resolvedMaxCost = maxCostFromRoute ?? maxCostFromProject;
  if (resolvedMaxCost === null) {
    throw new Error(
      `Policy resolution failed for step '${options.stepClass}': missing budget source in route constraints and budget_policy.default_cost_limit_usd.`,
    );
  }

  const timeoutFromRoute = asNumber(routeConstraints.timeout_sec);
  const timeoutFromProject = asNumber(budgetPolicy.default_timeout_sec);
  const resolvedTimeout = timeoutFromRoute ?? timeoutFromProject;
  if (resolvedTimeout === null) {
    throw new Error(
      `Policy resolution failed for step '${options.stepClass}': missing timeout source in route constraints and budget_policy.default_timeout_sec.`,
    );
  }

  const retryProfile = asRecord(policyEntry.profile.retry);
  const retryMaxAttempts = asNumber(retryProfile.max_attempts);
  const retryOn = asStringArray(retryProfile.on);
  if (asString(routeProfile.retry_policy_ref) && retryMaxAttempts === null) {
    throw new Error(
      `Policy resolution conflict for step '${options.stepClass}': route '${routeResolution.resolved_route_id}' declares retry_policy_ref but policy '${resolvedPolicyId}' is missing retry.max_attempts.`,
    );
  }

  const repairProfile = asRecord(policyEntry.profile.repair);
  const repairMaxAttempts = asNumber(repairProfile.max_attempts);
  if (asString(routeProfile.repair_policy_ref) && repairMaxAttempts === null) {
    throw new Error(
      `Policy resolution conflict for step '${options.stepClass}': route '${routeResolution.resolved_route_id}' declares repair_policy_ref but policy '${resolvedPolicyId}' is missing repair.max_attempts.`,
    );
  }

  const policyCommandConstraints = asRecord(policyEntry.profile.command_constraints);
  const projectAllowedCommands = collectProjectCommandAllowlist(projectProfile);
  const routeAllowedCommands = asStringArray(routeConstraints.allowed_commands);
  const policyAllowedCommands = asStringArray(policyCommandConstraints.allowed_commands);

  let resolvedAllowedCommands = projectAllowedCommands;
  let commandResolutionSource = {
    kind: "project-default",
    field: "repos[*].{build_commands,test_commands,lint_commands}",
  };

  if (routeAllowedCommands.length > 0) {
    resolvedAllowedCommands = routeAllowedCommands;
    commandResolutionSource = {
      kind: "route-default",
      field: `route.constraints.allowed_commands (${routeResolution.resolved_route_id})`,
    };
  }

  if (policyAllowedCommands.length > 0) {
    resolvedAllowedCommands = policyAllowedCommands;
    commandResolutionSource = overrideValue
      ? {
          kind: "step-override",
          field: `policy_overrides.${options.stepClass} -> command_constraints.allowed_commands`,
        }
      : {
          kind: "project-default",
          field: `default_step_policies.${routeClass} -> command_constraints.allowed_commands`,
        };
  }

  const writebackOverride = asString(asRecord(policyEntry.profile.writeback_policy).mode);
  const writebackFromRoute = asString(routeConstraints.writeback_mode);
  const writebackFromProject = asString(writebackPolicy.default_delivery_mode);
  const resolvedWritebackMode = writebackOverride ?? writebackFromRoute ?? writebackFromProject;
  if (!resolvedWritebackMode) {
    throw new Error(
      `Policy resolution failed for step '${options.stepClass}': missing write-back mode in policy override, route constraints, and writeback_policy.default_delivery_mode.`,
    );
  }

  const allowDirectWriteFromRoute = routeConstraints.allow_direct_write;
  const allowDirectWriteFromProject = writebackPolicy.allow_direct_write;
  const resolvedAllowDirectWrite =
    typeof allowDirectWriteFromRoute === "boolean"
      ? allowDirectWriteFromRoute
      : typeof allowDirectWriteFromProject === "boolean"
        ? allowDirectWriteFromProject
        : false;

  const requireManifestFromRoute = routeConstraints.require_delivery_manifest;
  const requireManifestFromProject = writebackPolicy.require_delivery_manifest;
  const resolvedRequireDeliveryManifest =
    typeof requireManifestFromRoute === "boolean"
      ? requireManifestFromRoute
      : typeof requireManifestFromProject === "boolean"
        ? requireManifestFromProject
        : true;

  return {
    step_class: options.stepClass,
    route: {
      ...routeResolution,
    },
    policy: {
      policy_id: resolvedPolicyId,
      resolution_source: {
        kind: overrideValue ? "step-override" : "project-default",
        field: overrideValue
          ? `policy_overrides.${options.stepClass}`
          : `default_step_policies.${routeClass}`,
      },
      profile_source: policyEntry.source,
      profile: {
        policy_id: policyEntry.profile.policy_id,
        step_class: policyEntry.profile.step_class,
        pre_validators: asStringArray(policyEntry.profile.pre_validators),
        post_validators: asStringArray(policyEntry.profile.post_validators),
        quality_gate: asRecord(policyEntry.profile.quality_gate),
        retry: {
          max_attempts: retryMaxAttempts,
          on: retryOn,
        },
        repair: {
          max_attempts: repairMaxAttempts,
          on: asStringArray(repairProfile.on),
        },
        escalation: asRecord(policyEntry.profile.escalation),
        blocking_rules: asStringArray(policyEntry.profile.blocking_rules),
      },
    },
    resolved_bounds: {
      budget: {
        max_cost_usd: resolvedMaxCost,
        timeout_sec: resolvedTimeout,
        max_cost_source:
          maxCostFromRoute !== null
            ? `route.constraints.max_cost_usd (${routeResolution.resolved_route_id})`
            : "budget_policy.default_cost_limit_usd",
        timeout_source:
          timeoutFromRoute !== null
            ? `route.constraints.timeout_sec (${routeResolution.resolved_route_id})`
            : "budget_policy.default_timeout_sec",
      },
      retry: {
        max_attempts: retryMaxAttempts,
        on: retryOn,
        source: "step-policy-profile.retry",
      },
      command_constraints: {
        allowed_commands: resolvedAllowedCommands,
        resolution_source: commandResolutionSource,
      },
      writeback_mode: {
        mode: resolvedWritebackMode,
        allow_direct_write: resolvedAllowDirectWrite,
        require_delivery_manifest: resolvedRequireDeliveryManifest,
        resolution_source: writebackOverride
          ? {
              kind: overrideValue ? "step-override" : "project-default",
              field: overrideValue
                ? `policy_overrides.${options.stepClass} -> writeback_policy.mode`
                : `default_step_policies.${routeClass} -> writeback_policy.mode`,
            }
          : writebackFromRoute
            ? {
                kind: "route-default",
                field: `route.constraints.writeback_mode (${routeResolution.resolved_route_id})`,
              }
            : {
                kind: "project-default",
                field: "writeback_policy.default_delivery_mode",
              },
      },
    },
    guardrails: {
      approval_required: Boolean(approvalPolicy.required_for_execution),
      provider_allowlist_enforced: Boolean(securityPolicy.provider_allowlist_enforced),
      redact_secrets: Boolean(securityPolicy.redact_secrets),
      blocking_rules: asStringArray(policyEntry.profile.blocking_rules),
    },
    provenance: {
      project_profile_path: options.projectProfilePath,
      route_profile_source: routeResolution.route_profile_source,
      policy_profile_source: policyEntry.source,
    },
  };
}

/**
 * @param {{
 *   projectProfilePath: string,
 *   routesRoot: string,
 *   policiesRoot: string,
 *   stepClass: string,
 *   routeOverrides?: Record<string, string>,
 *   policyOverrides?: Record<string, string>,
 * }} options
 */
export function resolveStepPolicyForStep(options) {
  const policyRegistry = buildStepPolicyRegistry({
    policiesRoot: options.policiesRoot,
  });

  return resolveStepPolicyForStepWithRegistry({
    ...options,
    policyRegistry,
  });
}

/**
 * @param {{
 *   projectProfilePath: string,
 *   routesRoot: string,
 *   policiesRoot: string,
 *   routeOverrides?: Record<string, string>,
 *   policyOverrides?: Record<string, string>,
 * }} options
 */
export function resolveStepPolicyMatrix(options) {
  const policyRegistry = buildStepPolicyRegistry({
    policiesRoot: options.policiesRoot,
  });

  return SUPPORTED_STEP_CLASSES.map((stepClass) =>
    resolveStepPolicyForStepWithRegistry({
      ...options,
      stepClass,
      policyRegistry,
    }),
  );
}
