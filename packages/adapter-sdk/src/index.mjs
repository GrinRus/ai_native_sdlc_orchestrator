import fs from "node:fs";
import path from "node:path";

import { loadContractFile } from "../../contracts/src/index.mjs";
import { SUPPORTED_STEP_CLASSES } from "../../provider-routing/src/route-resolution.mjs";

const ADAPTER_RESPONSE_STATUSES = Object.freeze(["success", "failed", "blocked"]);

export const STEP_LIFECYCLE_HOOKS = Object.freeze([
  "before_step",
  "invoke_adapter",
  "after_step",
  "on_retry",
  "on_repair",
  "on_escalation",
]);

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
 * @param {string} field
 * @param {unknown} value
 * @returns {string}
 */
function requireString(field, value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Adapter envelope field '${field}' must be a non-empty string.`);
  }
  return value.trim();
}

/**
 * @param {Record<string, unknown>} context
 */
function assertCompiledContextShape(context) {
  const requiredObjectFields = [
    "instruction_set",
    "session_bootstrap",
    "required_inputs_resolved",
    "guardrails",
    "provenance",
  ];
  for (const field of requiredObjectFields) {
    const value = context[field];
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error(`Adapter envelope field 'context.${field}' must be an object.`);
    }
  }

  const fingerprint = context.compiled_context_fingerprint;
  if (typeof fingerprint !== "string" || fingerprint.trim().length === 0) {
    throw new Error(
      "Adapter envelope field 'context.compiled_context_fingerprint' must be a non-empty string.",
    );
  }
}

/**
 * @param {{
 *   adaptersRoot: string,
 * }} options
 * @returns {Map<string, { profile: Record<string, unknown>, source: string }>}
 */
export function buildAdapterRegistry(options) {
  if (!fs.existsSync(options.adaptersRoot)) {
    throw new Error(`Adapter registry root '${options.adaptersRoot}' does not exist.`);
  }

  const entries = fs
    .readdirSync(options.adaptersRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(yaml|yml)$/u.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  const registry = new Map();
  for (const filename of entries) {
    const source = path.join(options.adaptersRoot, filename);
    const loaded = loadContractFile({
      filePath: source,
      family: "adapter-capability-profile",
    });
    if (!loaded.ok) {
      throw new Error(`Adapter profile '${source}' failed contract validation.`);
    }

    const profile = asRecord(loaded.document);
    const adapterId = profile.adapter_id;
    if (typeof adapterId !== "string" || adapterId.trim().length === 0) {
      throw new Error(`Adapter profile '${source}' is missing adapter_id.`);
    }
    if (registry.has(adapterId)) {
      throw new Error(`Adapter id '${adapterId}' is declared more than once in adapter registry.`);
    }

    registry.set(adapterId, { profile, source });
  }

  return registry;
}

/**
 * @param {{
 *   routeResolution: {
 *     step_class: string,
 *     resolved_route_id: string,
 *     route_profile_source: string,
 *     route_profile: Record<string, unknown>,
 *   },
 *   adapterOverrides?: Record<string, string>,
 *   adaptersRoot: string,
 *   adapterRegistry: Map<string, { profile: Record<string, unknown>, source: string }>,
 * }} options
 */
function resolveAdapterForRouteWithRegistry(options) {
  const routeProfile = asRecord(options.routeResolution.route_profile);
  const primary = asRecord(routeProfile.primary);
  const requiredCapabilities = asStringArray(routeProfile.required_adapter_capabilities);

  const rawOverrides = asRecord(options.adapterOverrides ?? {});
  for (const key of Object.keys(rawOverrides)) {
    if (!SUPPORTED_STEP_CLASSES.includes(key)) {
      throw new Error(
        `Unknown adapter override '${key}'. Expected one of: ${SUPPORTED_STEP_CLASSES.join(", ")}.`,
      );
    }
  }

  const overrideValue = rawOverrides[options.routeResolution.step_class];
  const selectedFromOverride =
    typeof overrideValue === "string" && overrideValue.trim().length > 0 ? overrideValue.trim() : null;
  const selectedFromRoute =
    typeof primary.adapter === "string" && primary.adapter.trim().length > 0 ? primary.adapter.trim() : null;
  const resolvedAdapterId = selectedFromOverride ?? selectedFromRoute;

  if (!resolvedAdapterId || resolvedAdapterId === "none") {
    if (requiredCapabilities.length > 0) {
      throw new Error(
        `Adapter negotiation failed for step '${options.routeResolution.step_class}': route '${options.routeResolution.resolved_route_id}' requires capabilities [${requiredCapabilities.join(
          ", ",
        )}] but adapter source resolved to '${resolvedAdapterId ?? "none"}'.`,
      );
    }

    return {
      step_class: options.routeResolution.step_class,
      route_id: options.routeResolution.resolved_route_id,
      adapter: {
        adapter_id: "none",
        resolution_source: {
          kind: selectedFromOverride ? "step-override" : "route-primary",
          field: selectedFromOverride
            ? `adapter_overrides.${options.routeResolution.step_class}`
            : "route.primary.adapter",
        },
        profile_source: null,
        profile: null,
      },
      capability_check: {
        required: [],
        satisfied: [],
        missing: [],
        status: "not-required",
      },
      lifecycle_hooks: STEP_LIFECYCLE_HOOKS,
      provenance: {
        route_profile_source: options.routeResolution.route_profile_source,
        adapter_profile_source: null,
      },
    };
  }

  const adapterEntry = options.adapterRegistry.get(resolvedAdapterId);
  if (!adapterEntry) {
    throw new Error(
      `Adapter negotiation failed for step '${options.routeResolution.step_class}': adapter '${resolvedAdapterId}' is not present in adapter registry '${options.adaptersRoot}'.`,
    );
  }

  const capabilities = asRecord(adapterEntry.profile.capabilities);
  const missingCapabilities = requiredCapabilities.filter((capability) => capabilities[capability] !== true);
  if (missingCapabilities.length > 0) {
    throw new Error(
      `Adapter negotiation failed for step '${options.routeResolution.step_class}': adapter '${resolvedAdapterId}' is missing capabilities [${missingCapabilities.join(
        ", ",
      )}] required by route '${options.routeResolution.resolved_route_id}'.`,
    );
  }

  return {
    step_class: options.routeResolution.step_class,
    route_id: options.routeResolution.resolved_route_id,
    adapter: {
      adapter_id: resolvedAdapterId,
      resolution_source: {
        kind: selectedFromOverride ? "step-override" : "route-primary",
        field: selectedFromOverride
          ? `adapter_overrides.${options.routeResolution.step_class}`
          : "route.primary.adapter",
      },
      profile_source: adapterEntry.source,
      profile: {
        adapter_id: adapterEntry.profile.adapter_id,
        version: adapterEntry.profile.version,
        runner_family:
          typeof adapterEntry.profile.runner_family === "string" ? adapterEntry.profile.runner_family : null,
        capabilities,
        constraints: asRecord(adapterEntry.profile.constraints),
      },
    },
    capability_check: {
      required: requiredCapabilities,
      satisfied: requiredCapabilities,
      missing: [],
      status: "pass",
    },
    lifecycle_hooks: STEP_LIFECYCLE_HOOKS,
    provenance: {
      route_profile_source: options.routeResolution.route_profile_source,
      adapter_profile_source: adapterEntry.source,
    },
  };
}

/**
 * @param {{
 *   routeResolution: {
 *     step_class: string,
 *     resolved_route_id: string,
 *     route_profile_source: string,
 *     route_profile: Record<string, unknown>,
 *   },
 *   adaptersRoot: string,
 *   adapterOverrides?: Record<string, string>,
 * }} options
 */
export function resolveAdapterForRoute(options) {
  const adapterRegistry = buildAdapterRegistry({
    adaptersRoot: options.adaptersRoot,
  });

  return resolveAdapterForRouteWithRegistry({
    ...options,
    adapterRegistry,
  });
}

/**
 * @param {{
 *   routeResolutionMatrix: Array<{
 *     step_class: string,
 *     resolved_route_id: string,
 *     route_profile_source: string,
 *     route_profile: Record<string, unknown>,
 *   }>,
 *   adaptersRoot: string,
 *   adapterOverrides?: Record<string, string>,
 * }} options
 */
export function resolveAdapterMatrix(options) {
  const adapterRegistry = buildAdapterRegistry({
    adaptersRoot: options.adaptersRoot,
  });

  return options.routeResolutionMatrix.map((routeResolution) =>
    resolveAdapterForRouteWithRegistry({
      routeResolution,
      adaptersRoot: options.adaptersRoot,
      adapterOverrides: options.adapterOverrides,
      adapterRegistry,
    }),
  );
}

/**
 * @param {{
 *   request_id: string,
 *   run_id: string,
 *   step_id: string,
 *   step_class: string,
 *   route: Record<string, unknown>,
 *   asset_bundle: Record<string, unknown>,
 *   policy_bundle: Record<string, unknown>,
 *   input_packet_refs?: string[],
 *   dry_run?: boolean,
 *   context: Record<string, unknown>,
 * }} input
 */
export function createAdapterRequestEnvelope(input) {
  const context = asRecord(input.context);
  if (Object.keys(context).length === 0) {
    throw new Error("Adapter envelope field 'context' must be a non-empty object.");
  }
  assertCompiledContextShape(context);

  return {
    request_id: requireString("request_id", input.request_id),
    run_id: requireString("run_id", input.run_id),
    step_id: requireString("step_id", input.step_id),
    step_class: requireString("step_class", input.step_class),
    route: asRecord(input.route),
    asset_bundle: asRecord(input.asset_bundle),
    policy_bundle: asRecord(input.policy_bundle),
    input_packet_refs: asStringArray(input.input_packet_refs),
    dry_run: Boolean(input.dry_run),
    context,
  };
}

/**
 * @param {{
 *   request_id: string,
 *   adapter_id: string,
 *   status: string,
 *   summary: string,
 *   output?: Record<string, unknown>,
 *   evidence_refs?: string[],
 *   tool_traces?: Array<Record<string, unknown>>,
 * }} input
 */
export function createAdapterResponseEnvelope(input) {
  const status = requireString("status", input.status);
  if (!ADAPTER_RESPONSE_STATUSES.includes(status)) {
    throw new Error(
      `Adapter envelope field 'status' must be one of: ${ADAPTER_RESPONSE_STATUSES.join(", ")}.`,
    );
  }

  return {
    request_id: requireString("request_id", input.request_id),
    adapter_id: requireString("adapter_id", input.adapter_id),
    status,
    summary: requireString("summary", input.summary),
    output: asRecord(input.output),
    evidence_refs: asStringArray(input.evidence_refs),
    tool_traces: Array.isArray(input.tool_traces) ? input.tool_traces.map((trace) => asRecord(trace)) : [],
  };
}

/**
 * @param {{ adapterId?: string }} [options]
 */
export function createMockAdapter(options = {}) {
  const adapterId =
    typeof options.adapterId === "string" && options.adapterId.trim().length > 0
      ? options.adapterId.trim()
      : "mock-runner";

  return {
    adapter_id: adapterId,
    lifecycle_hooks: STEP_LIFECYCLE_HOOKS,
    /**
     * @param {{
     *   request_id: string,
     *   run_id: string,
     *   step_id: string,
     *   step_class: string,
     *   route: Record<string, unknown>,
     *   asset_bundle: Record<string, unknown>,
     *   policy_bundle: Record<string, unknown>,
     *   input_packet_refs?: string[],
     *   dry_run?: boolean,
     *   context: Record<string, unknown>,
     * }} request
     */
    execute(request) {
      const envelope = createAdapterRequestEnvelope(request);
      const route = asRecord(envelope.route);
      const routeId =
        typeof route.resolved_route_id === "string" && route.resolved_route_id.trim().length > 0
          ? route.resolved_route_id.trim()
          : "route.unknown";
      const deterministicSeed = `${envelope.step_id}:${envelope.step_class}:${routeId}:${envelope.dry_run ? "dry-run" : "execute"}`;
      const normalizedEvidenceToken = deterministicSeed.toLowerCase().replace(/[^a-z0-9]+/g, "-");

      return createAdapterResponseEnvelope({
        request_id: envelope.request_id,
        adapter_id: adapterId,
        status: "success",
        summary: `Mock adapter completed ${envelope.step_class}`,
        output: {
          deterministic_seed: deterministicSeed,
          mode: envelope.dry_run ? "dry-run" : "execute",
          route_id: routeId,
        },
        evidence_refs: [`evidence://mock-adapter/${normalizedEvidenceToken}`],
        tool_traces: [
          {
            phase: "invoke_adapter",
            kind: "mock-run",
            detail: `deterministic_seed=${deterministicSeed}`,
          },
        ],
      });
    },
  };
}
