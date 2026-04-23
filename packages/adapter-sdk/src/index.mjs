import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

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
 * @param {unknown} value
 * @returns {string | null}
 */
function asOptionalString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
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
 * @param {string | null} projectRoot
 * @param {string} filePath
 * @returns {string}
 */
function toEvidenceRef(projectRoot, filePath) {
  const normalizedPath = filePath.replace(/\\/g, "/");
  if (!projectRoot || !path.isAbsolute(projectRoot) || !path.isAbsolute(filePath)) {
    return `evidence://${normalizedPath}`;
  }

  const relative = path.relative(projectRoot, filePath).replace(/\\/g, "/");
  if (!relative || relative.startsWith("..")) {
    return `evidence://${normalizedPath}`;
  }
  return `evidence://${relative}`;
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
        execution: asRecord(adapterEntry.profile.execution),
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
 *   context?: Record<string, unknown>,
 * }} input
 */
export function createAdapterRequestEnvelope(input) {
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
    context: asRecord(input.context),
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
     *   context?: Record<string, unknown>,
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

/**
 * @param {{ adapterId: string }} options
 */
export function createLiveAdapter(options) {
  const adapterId = requireString("adapterId", options.adapterId);
  const adapterProfile = asRecord(options.adapterProfile);
  const executionProfile = asRecord(adapterProfile.execution);
  const runtimeMode = asOptionalString(executionProfile.runtime_mode);
  const handler = asOptionalString(executionProfile.handler);
  const evidenceNamespace =
    asOptionalString(executionProfile.evidence_namespace) ?? `evidence://adapter-live/${adapterId}`;
  const externalRuntime = asRecord(executionProfile.external_runtime);
  const runtimeCommand = asOptionalString(externalRuntime.command);
  const runtimeArgs = asStringArray(externalRuntime.args);
  const requestViaStdin = externalRuntime.request_via_stdin !== false;
  const timeoutMs = asPositiveInteger(externalRuntime.timeout_ms, 30000);
  const envOverrides = asStringMap(externalRuntime.env);
  const runtimeEvidenceRoot = asOptionalString(options.runtimeEvidenceRoot);
  const projectRoot = asOptionalString(options.projectRoot);

  if (adapterId !== "codex-cli") {
    throw new Error(
      `Live adapter '${adapterId}' is not supported in the current baseline. Supported adapters: codex-cli.`,
    );
  }

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
     *   context?: Record<string, unknown>,
     * }} request
     */
    execute(request) {
      const envelope = createAdapterRequestEnvelope(request);
      const route = asRecord(envelope.route);
      const routeId =
        typeof route.resolved_route_id === "string" && route.resolved_route_id.trim().length > 0
          ? route.resolved_route_id.trim()
          : "route.unknown";
      const context = asRecord(envelope.context);
      const compiledContextRef =
        typeof context.compiled_context_ref === "string" && context.compiled_context_ref.trim().length > 0
          ? context.compiled_context_ref.trim()
          : null;
      const invocationToken = `${envelope.run_id}:${envelope.step_id}:${envelope.request_id}:${Date.now()}`;
      const normalizedEvidenceToken = invocationToken.toLowerCase().replace(/[^a-z0-9]+/g, "-");

      if (runtimeMode !== "external-process") {
        return createAdapterResponseEnvelope({
          request_id: envelope.request_id,
          adapter_id: adapterId,
          status: "blocked",
          summary: `Adapter '${adapterId}' live runtime is misconfigured: execution.runtime_mode must be 'external-process'.`,
          output: {
            mode: "execute",
            blocked: true,
            route_id: routeId,
            provider_adapter: adapterId,
            compiled_context_ref: compiledContextRef,
            failure_kind: "missing-prerequisite",
            runtime_mode: runtimeMode,
          },
          evidence_refs: [`${evidenceNamespace}/${normalizedEvidenceToken}`],
          tool_traces: [
            {
              phase: "invoke_adapter",
              kind: handler ?? "codex-cli-external-runner",
              detail: "runtime_mode is not external-process",
            },
          ],
        });
      }

      if (!runtimeCommand) {
        return createAdapterResponseEnvelope({
          request_id: envelope.request_id,
          adapter_id: adapterId,
          status: "blocked",
          summary: `Adapter '${adapterId}' live runtime is missing execution.external_runtime.command.`,
          output: {
            mode: "execute",
            blocked: true,
            route_id: routeId,
            provider_adapter: adapterId,
            compiled_context_ref: compiledContextRef,
            failure_kind: "missing-prerequisite",
          },
          evidence_refs: [`${evidenceNamespace}/${normalizedEvidenceToken}`],
          tool_traces: [
            {
              phase: "invoke_adapter",
              kind: handler ?? "codex-cli-external-runner",
              detail: "external_runtime.command is missing",
            },
          ],
        });
      }

      const startedAt = new Date().toISOString();
      const runnerInput = {
        request: envelope,
        adapter: {
          adapter_id: adapterId,
          route_id: routeId,
          compiled_context_ref: compiledContextRef,
        },
      };

      const invocation = spawnSync(runtimeCommand, runtimeArgs, {
        cwd: process.cwd(),
        env: {
          ...process.env,
          ...envOverrides,
        },
        encoding: "utf8",
        input: requestViaStdin ? `${JSON.stringify(runnerInput)}\n` : undefined,
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
      });
      const finishedAt = new Date().toISOString();

      const invocationError = invocation.error instanceof Error ? invocation.error : null;
      const invocationTimedOut = invocation.signal === "SIGTERM" && invocation.status === null;
      const invocationFailed = invocationError !== null || invocation.status !== 0;
      const stdout = typeof invocation.stdout === "string" ? invocation.stdout : "";
      const stderr = typeof invocation.stderr === "string" ? invocation.stderr : "";

      const rawEvidenceRecord = {
        adapter_id: adapterId,
        request_id: envelope.request_id,
        run_id: envelope.run_id,
        step_id: envelope.step_id,
        step_class: envelope.step_class,
        route_id: routeId,
        started_at: startedAt,
        finished_at: finishedAt,
        runtime: {
          mode: runtimeMode,
          command: runtimeCommand,
          args: runtimeArgs,
          timeout_ms: timeoutMs,
          request_via_stdin: requestViaStdin,
        },
        process: {
          exit_code: invocation.status,
          signal: invocation.signal,
          error_code: invocationError?.code ?? null,
          error_message: invocationError?.message ?? null,
          timed_out: invocationTimedOut,
        },
        io: {
          stdout,
          stderr,
        },
      };

      let rawEvidenceFile = null;
      let rawEvidenceRef = null;
      if (runtimeEvidenceRoot) {
        const evidenceDir = path.isAbsolute(runtimeEvidenceRoot)
          ? runtimeEvidenceRoot
          : path.resolve(process.cwd(), runtimeEvidenceRoot);
        fs.mkdirSync(evidenceDir, { recursive: true });
        rawEvidenceFile = path.join(
          evidenceDir,
          `adapter-live-raw-${adapterId}-${normalizedEvidenceToken}-${Date.now()}.json`,
        );
        fs.writeFileSync(rawEvidenceFile, `${JSON.stringify(rawEvidenceRecord, null, 2)}\n`, "utf8");
        rawEvidenceRef = toEvidenceRef(projectRoot, rawEvidenceFile);
      }

      /** @type {Record<string, unknown>} */
      let runnerPayload = {};
      /** @type {string[]} */
      let runnerEvidenceRefs = [];
      /** @type {Array<Record<string, unknown>>} */
      let runnerToolTraces = [];
      const stdoutTrimmed = stdout.trim();
      if (stdoutTrimmed.length > 0) {
        try {
          const parsed = JSON.parse(stdoutTrimmed);
          const parsedRecord = asRecord(parsed);
          runnerPayload = asRecord(parsedRecord.output);
          runnerEvidenceRefs = asStringArray(parsedRecord.evidence_refs);
          runnerToolTraces = Array.isArray(parsedRecord.tool_traces)
            ? parsedRecord.tool_traces.map((trace) => asRecord(trace))
            : [];
        } catch {
          runnerPayload = {
            raw_stdout: stdoutTrimmed,
          };
        }
      }

      const baseOutput = {
        mode: "execute",
        route_id: routeId,
        provider_adapter: adapterId,
        compiled_context_ref: compiledContextRef,
        external_runner: {
          runtime_mode: runtimeMode,
          command: runtimeCommand,
          args: runtimeArgs,
          exit_code: invocation.status,
          signal: invocation.signal,
          timed_out: invocationTimedOut,
          raw_evidence_ref: rawEvidenceRef,
        },
        runner_output: runnerPayload,
      };

      const evidenceRefs = [
        `${evidenceNamespace}/${normalizedEvidenceToken}`,
        ...(rawEvidenceRef ? [rawEvidenceRef] : []),
        ...runnerEvidenceRefs,
      ];
      const toolTraces = [
        {
          phase: "invoke_adapter",
          kind: handler ?? "codex-cli-external-runner",
          detail: `command=${runtimeCommand} exit_code=${invocation.status ?? "null"} signal=${invocation.signal ?? "none"}`,
        },
        ...runnerToolTraces,
      ];

      if (invocationError) {
        const missingCommand = invocationError.code === "ENOENT";
        return createAdapterResponseEnvelope({
          request_id: envelope.request_id,
          adapter_id: adapterId,
          status: missingCommand ? "blocked" : "failed",
          summary: missingCommand
            ? `External runner command '${runtimeCommand}' is not available on PATH for adapter '${adapterId}'.`
            : `External runner launch failed for adapter '${adapterId}': ${invocationError.message}.`,
          output: {
            ...baseOutput,
            blocked: missingCommand,
            failure_kind: missingCommand ? "missing-prerequisite" : "external-runner-launch-failed",
          },
          evidence_refs: evidenceRefs,
          tool_traces: toolTraces,
        });
      }

      if (invocationTimedOut) {
        return createAdapterResponseEnvelope({
          request_id: envelope.request_id,
          adapter_id: adapterId,
          status: "failed",
          summary: `External runner command '${runtimeCommand}' timed out after ${timeoutMs}ms for adapter '${adapterId}'.`,
          output: {
            ...baseOutput,
            failure_kind: "external-runner-timeout",
          },
          evidence_refs: evidenceRefs,
          tool_traces: toolTraces,
        });
      }

      if (invocationFailed) {
        return createAdapterResponseEnvelope({
          request_id: envelope.request_id,
          adapter_id: adapterId,
          status: "failed",
          summary: `External runner command '${runtimeCommand}' exited with code ${String(
            invocation.status ?? "null",
          )} for adapter '${adapterId}'.`,
          output: {
            ...baseOutput,
            failure_kind: "external-runner-failed",
          },
          evidence_refs: evidenceRefs,
          tool_traces: toolTraces,
        });
      }

      return createAdapterResponseEnvelope({
        request_id: envelope.request_id,
        adapter_id: adapterId,
        status: "success",
        summary: `External runner '${runtimeCommand}' completed ${envelope.step_class}.`,
        output: baseOutput,
        evidence_refs: evidenceRefs,
        tool_traces: toolTraces,
      });
    },
  };
}
