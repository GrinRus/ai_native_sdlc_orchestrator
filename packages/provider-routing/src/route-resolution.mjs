import fs from "node:fs";
import path from "node:path";

import { loadContractFile } from "../../contracts/src/index.mjs";

const SUPPORTED_STEP_CLASSES = Object.freeze([
  "discovery",
  "research",
  "spec",
  "planning",
  "implement",
  "review",
  "qa",
  "repair",
  "eval",
  "harness",
]);

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function asRecord(value) {
  return typeof value === "object" && value !== null ? /** @type {Record<string, unknown>} */ (value) : {};
}

/**
 * @param {{
 *   routesRoot: string,
 * }} options
 * @returns {{ routeById: Map<string, Record<string, unknown>>, sourceById: Map<string, string> }}
 */
export function buildRouteRegistry(options) {
  if (!fs.existsSync(options.routesRoot)) {
    throw new Error(`Route registry root '${options.routesRoot}' does not exist.`);
  }

  const entries = fs
    .readdirSync(options.routesRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(yaml|yml)$/u.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  const routeById = new Map();
  const sourceById = new Map();

  for (const filename of entries) {
    const source = path.join(options.routesRoot, filename);
    const loaded = loadContractFile({
      filePath: source,
      family: "provider-route-profile",
    });
    if (!loaded.ok) {
      throw new Error(`Route file '${source}' failed contract validation.`);
    }

    const routeProfile = asRecord(loaded.document);
    const routeId = routeProfile.route_id;
    if (typeof routeId !== "string" || routeId.length === 0) {
      throw new Error(`Route file '${source}' is missing route_id.`);
    }
    if (routeById.has(routeId)) {
      throw new Error(`Route id '${routeId}' is declared more than once in route registry.`);
    }

    routeById.set(routeId, routeProfile);
    sourceById.set(routeId, source);
  }

  return {
    routeById,
    sourceById,
  };
}

/**
 * @param {{
 *   projectProfilePath: string,
 *   routesRoot: string,
 *   stepClass: string,
 *   stepOverrides?: Record<string, string>,
 * }} options
 * @returns {{
 *   step_class: string,
 *   resolved_route_id: string,
 *   resolution_source: {
 *     kind: "project-default" | "step-override",
 *     field: string,
 *   },
 *   route_profile_source: string,
 *   route_profile: {
 *     route_id: string,
 *     step: string,
 *     route_class: string,
 *     risk_tier: string,
 *     primary: {
 *       adapter: string | null,
 *       provider: string | null,
 *       model: string | null,
 *     },
 *     required_adapter_capabilities: string[],
 *     constraints: Record<string, unknown>,
 *     promotion_channel: string | null,
 *   },
 * }}
 */
export function resolveRouteForStep(options) {
  if (!SUPPORTED_STEP_CLASSES.includes(options.stepClass)) {
    throw new Error(
      `Unsupported step class '${options.stepClass}'. Expected one of: ${SUPPORTED_STEP_CLASSES.join(", ")}.`,
    );
  }

  const loadedProfile = loadContractFile({
    filePath: options.projectProfilePath,
    family: "project-profile",
  });
  if (!loadedProfile.ok) {
    throw new Error(`Project profile '${options.projectProfilePath}' failed contract validation.`);
  }

  const profile = asRecord(loadedProfile.document);
  const projectDefaults = asRecord(profile.default_route_profiles);
  const registry = buildRouteRegistry({ routesRoot: options.routesRoot });

  const rawOverrides = asRecord(options.stepOverrides ?? {});
  for (const key of Object.keys(rawOverrides)) {
    if (!SUPPORTED_STEP_CLASSES.includes(key)) {
      throw new Error(
        `Unknown step override '${key}'. Expected one of: ${SUPPORTED_STEP_CLASSES.join(", ")}.`,
      );
    }
  }

  const overrideValue = rawOverrides[options.stepClass];
  const selectedFromOverride =
    typeof overrideValue === "string" && overrideValue.trim().length > 0 ? overrideValue.trim() : null;
  const defaultValue = projectDefaults[options.stepClass];
  const selectedFromDefault =
    typeof defaultValue === "string" && defaultValue.trim().length > 0 ? defaultValue.trim() : null;
  const resolvedRouteId = selectedFromOverride ?? selectedFromDefault;

  if (!resolvedRouteId) {
    throw new Error(
      `Route resolution failed for step '${options.stepClass}': missing source in step override and default_route_profiles.${options.stepClass}.`,
    );
  }

  const routeProfile = registry.routeById.get(resolvedRouteId);
  if (!routeProfile) {
    const sourceField = selectedFromOverride
      ? `step_overrides.${options.stepClass}`
      : `default_route_profiles.${options.stepClass}`;
    throw new Error(
      `Route resolution failed for step '${options.stepClass}': '${resolvedRouteId}' from ${sourceField} is not present in route registry '${options.routesRoot}'.`,
    );
  }

  const routeStep = routeProfile.step;
  if (routeStep !== options.stepClass) {
    const sourceField = selectedFromOverride
      ? `step_overrides.${options.stepClass}`
      : `default_route_profiles.${options.stepClass}`;
    throw new Error(
      `Route resolution conflict for step '${options.stepClass}': ${sourceField} points to route '${resolvedRouteId}' with step '${String(routeStep)}'.`,
    );
  }

  const primary = asRecord(routeProfile.primary);
  const requiredCapabilities = Array.isArray(routeProfile.required_adapter_capabilities)
    ? routeProfile.required_adapter_capabilities.filter((capability) => typeof capability === "string")
    : [];

  return {
    step_class: options.stepClass,
    resolved_route_id: resolvedRouteId,
    resolution_source: {
      kind: selectedFromOverride ? "step-override" : "project-default",
      field: selectedFromOverride
        ? `step_overrides.${options.stepClass}`
        : `default_route_profiles.${options.stepClass}`,
    },
    route_profile_source: registry.sourceById.get(resolvedRouteId) ?? options.routesRoot,
    route_profile: {
      route_id: String(routeProfile.route_id ?? resolvedRouteId),
      step: String(routeProfile.step ?? options.stepClass),
      route_class: String(routeProfile.route_class ?? "unknown"),
      risk_tier: String(routeProfile.risk_tier ?? "unknown"),
      primary: {
        adapter: typeof primary.adapter === "string" ? primary.adapter : null,
        provider: typeof primary.provider === "string" ? primary.provider : null,
        model: typeof primary.model === "string" ? primary.model : null,
      },
      required_adapter_capabilities: requiredCapabilities,
      constraints: asRecord(routeProfile.constraints),
      promotion_channel:
        typeof routeProfile.promotion_channel === "string" ? routeProfile.promotion_channel : null,
    },
  };
}

/**
 * @param {{
 *   projectProfilePath: string,
 *   routesRoot: string,
 *   stepOverrides?: Record<string, string>,
 * }} options
 */
export function resolveRouteMatrix(options) {
  return SUPPORTED_STEP_CLASSES.map((stepClass) =>
    resolveRouteForStep({
      projectProfilePath: options.projectProfilePath,
      routesRoot: options.routesRoot,
      stepClass,
      stepOverrides: options.stepOverrides,
    }),
  );
}

export { SUPPORTED_STEP_CLASSES };
