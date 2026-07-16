import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { resolveAdapterForRoute } from "../../../adapter-sdk/src/index.mjs";
import { validateContractDocument } from "../../../contracts/src/index.mjs";
import {
  SUPPORTED_STEP_CLASSES,
  buildRouteRegistry,
  resolveRouteForStep,
} from "../../../provider-routing/src/route-resolution.mjs";
import { resolveProjectRegistryRoots } from "../project-init.mjs";

const STATUS_PRIORITY = [
  "policy-denied",
  "capability-mismatch",
  "model-unsupported",
  "auth-missing",
  "runner-missing",
  "stale",
  "unconfigured",
  "ready",
];

export class ExecutionProfileError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = "ExecutionProfileError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function readProfile(context) {
  if (!fs.existsSync(context.canonicalProfilePath)) return null;
  const raw = fs.readFileSync(context.canonicalProfilePath, "utf8");
  const profile = parseYaml(raw);
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    throw new ExecutionProfileError("execution-profile.profile-invalid", "Project profile must be a YAML mapping.", 409);
  }
  return { profile, raw };
}

function atomicWriteProfile(profilePath, profile) {
  const temporary = `${profilePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, stringifyYaml(profile), { mode: 0o600 });
  fs.renameSync(temporary, profilePath);
}

function executableAvailable(command, environment) {
  if (!command) return true;
  if (command.includes("/") || command.includes("\\")) {
    try {
      fs.accessSync(command, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }
  const pathValue = environment.PATH ?? environment.Path ?? "";
  const extensions = process.platform === "win32"
    ? String(environment.PATHEXT ?? ".EXE;.CMD;.BAT").split(";")
    : [""];
  return pathValue.split(path.delimiter).some((directory) => extensions.some((extension) => {
    try {
      fs.accessSync(path.join(directory, `${command}${extension}`), fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }));
}

function authReady(adapterId, input, environment) {
  if (adapterId === "none" || adapterId === "mock-runner") return true;
  const key = `AOR_AUTH_READY_${adapterId.replace(/[^a-z0-9]/giu, "_").toUpperCase()}`;
  if (environment[key] === "true") return true;
  if (environment[key] === "false") return false;
  return input.runnerReadiness?.[adapterId]?.auth_ready === true;
}

function classifyResolutionError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("model")) return { status: "model-unsupported", code: "execution.model-unsupported" };
  if (message.includes("capabilit")) return { status: "capability-mismatch", code: "execution.capability-mismatch" };
  return { status: "policy-denied", code: "execution.route-policy-denied" };
}

function resolveRouteRow({ context, registry, projectId, profile, step, environment, check }) {
  const roots = resolveProjectRegistryRoots(profile, { projectRoot: context.projectRoot }).roots;
  try {
    const route = resolveRouteForStep({
      projectProfilePath: context.canonicalProfilePath,
      routesRoot: roots.routes,
      stepClass: step,
    });
    const adapter = resolveAdapterForRoute({ routeResolution: route, adaptersRoot: roots.adapters });
    const adapterId = adapter.adapter.adapter_id;
    const provider = adapter.execution_candidates[0]?.provider ?? route.route_profile.primary.provider;
    const allowedAdapters = new Set(Array.isArray(profile.allowed_adapters) ? profile.allowed_adapters : []);
    const allowedProviders = new Set(Array.isArray(profile.allowed_providers) ? profile.allowed_providers : []);
    if ((adapterId !== "none" && !allowedAdapters.has(adapterId)) || (provider && !allowedProviders.has(provider))) {
      return {
        step,
        route_id: route.resolved_route_id,
        adapter: adapterId,
        runner: adapter.adapter.profile?.runner_family ?? null,
        provider: provider ?? null,
        requested_model: adapter.requested_model,
        effective_model: adapter.effective_model,
        model_source: adapter.model_source,
        required_capabilities: adapter.capability_check.required,
        fallback: { count: Math.max(0, adapter.execution_candidates.length - 1), route_ids: [] },
        readiness: "policy-denied",
        blocker_codes: ["execution.route-policy-denied"],
      };
    }
    const command = adapter.adapter.profile?.execution?.external_runtime?.command ?? null;
    const runnerAvailable = executableAvailable(command, environment);
    const authenticationReady = authReady(adapterId, registry.getProjectInput(projectId) ?? {}, environment);
    const readiness = !check
      ? "unconfigured"
      : !runnerAvailable ? "runner-missing"
        : !authenticationReady ? "auth-missing" : "ready";
    return {
      step,
      route_id: route.resolved_route_id,
      adapter: adapterId,
      runner: adapter.adapter.profile?.runner_family ?? null,
      provider: provider ?? null,
      requested_model: adapter.requested_model,
      effective_model: adapter.effective_model,
      model_source: adapter.model_source,
      required_capabilities: adapter.capability_check.required,
      fallback: { count: Math.max(0, adapter.execution_candidates.length - 1), route_ids: [] },
      readiness,
      runner_available: check ? runnerAvailable : null,
      auth_ready: check ? authenticationReady : null,
      blocker_codes: readiness === "ready" || readiness === "unconfigured" ? [] : [`execution.${readiness}`],
    };
  } catch (error) {
    const classified = classifyResolutionError(error);
    return {
      step,
      route_id: profile.default_route_profiles?.[step] ?? null,
      adapter: null,
      runner: null,
      provider: null,
      requested_model: null,
      effective_model: null,
      model_source: "unresolved",
      required_capabilities: [],
      fallback: { count: 0, route_ids: [] },
      readiness: classified.status,
      blocker_codes: [classified.code],
    };
  }
}

function overallStatus(rows) {
  return [...rows].sort((left, right) => STATUS_PRIORITY.indexOf(left.readiness) - STATUS_PRIORITY.indexOf(right.readiness))[0]?.readiness ?? "unconfigured";
}

export function readExecutionProfile({ registry, projectId, environment = process.env }) {
  const context = registry.getContext(projectId);
  if (!context) throw new ExecutionProfileError("project.not-found", `Project '${projectId}' is not registered.`, 404);
  const loaded = readProfile(context);
  if (!loaded) {
    return {
      profile_id: `execution-profile.${projectId}`,
      project_id: projectId,
      revision: registry.revision,
      initialized: false,
      routes: [],
      latest_readiness_ref: null,
      read_only: true,
    };
  }
  const input = registry.getProjectInput(projectId) ?? {};
  const report = input.latestExecutionReadiness ?? null;
  const latestByStep = new Map((report?.step_results ?? []).map((entry) => [entry.step, entry]));
  const stale = report && report.revision !== registry.revision;
  const defaults = loaded.profile.default_route_profiles ?? {};
  const routes = Object.keys(defaults).sort().map((step) => {
    const row = resolveRouteRow({ context, registry, projectId, profile: loaded.profile, step, environment, check: false });
    const latest = latestByStep.get(step);
    return {
      ...row,
      readiness: stale ? "stale" : latest?.status ?? row.readiness,
      blocker_codes: stale ? ["execution.readiness-stale"] : latest?.blocker_codes ?? row.blocker_codes,
    };
  });
  return {
    profile_id: `execution-profile.${projectId}`,
    project_id: projectId,
    revision: registry.revision,
    initialized: true,
    routes,
    latest_readiness_ref: report?.evidence_refs?.[0] ?? null,
    read_only: true,
  };
}

function assertMutable(registry, projectId, expectedRevision) {
  if (expectedRevision !== undefined && expectedRevision !== registry.revision) {
    throw new ExecutionProfileError("execution-profile.stale-revision", `Expected revision ${expectedRevision}, current ${registry.revision}.`, 409);
  }
  const summary = registry.summarize().projects.find((project) => project.project_id === projectId);
  if (summary?.active_flow_summary?.active_flow_count > 0) {
    throw new ExecutionProfileError("execution-profile.active-run-conflict", "Route changes are blocked while a project flow is active.", 409);
  }
}

export function applyExecutionProfileAction({
  registry,
  projectId,
  action,
  step,
  routeId,
  expectedRevision,
  environment = process.env,
}) {
  const context = registry.getContext(projectId);
  if (!context) throw new ExecutionProfileError("project.not-found", `Project '${projectId}' is not registered.`, 404);
  if (action === "check") {
    const loaded = readProfile(context);
    if (!loaded) throw new ExecutionProfileError("execution-profile.unconfigured", "Project profile is not configured.", 409);
    const selectedSteps = step ? [step] : Object.keys(loaded.profile.default_route_profiles ?? {}).sort();
    for (const selected of selectedSteps) {
      if (!SUPPORTED_STEP_CLASSES.includes(selected)) throw new ExecutionProfileError("execution-profile.unknown-step", `Unsupported step '${selected}'.`);
    }
    const rows = selectedSteps.map((selected) => resolveRouteRow({
      context,
      registry,
      projectId,
      profile: loaded.profile,
      step: selected,
      environment,
      check: true,
    }));
    const nextRevision = registry.revision + 1;
    const report = {
      report_id: `execution-readiness.${projectId}.revision-${nextRevision}`,
      project_id: projectId,
      revision: nextRevision,
      status: overallStatus(rows),
      checked_at: new Date().toISOString(),
      step_results: rows.map((row) => ({
        step: row.step,
        route_id: row.route_id,
        adapter: row.adapter,
        runner_available: row.runner_available,
        auth_ready: row.auth_ready,
        requested_model: row.requested_model,
        effective_model: row.effective_model,
        model_source: row.model_source,
        status: row.readiness,
        blocker_codes: row.blocker_codes,
      })),
      evidence_refs: [`evidence://workspace/execution-readiness/${projectId}/revision-${nextRevision}`],
    };
    const validation = validateContractDocument({ family: "execution-readiness-report", document: report, source: report.evidence_refs[0] });
    if (!validation.ok) throw new ExecutionProfileError("execution-profile.report-invalid", "Readiness report failed contract validation.", 500);
    registry.updateProject(projectId, registry.revision, (current) => ({
      ...current,
      latestExecutionReadiness: report,
      runnerReadiness: Object.fromEntries(rows.filter((row) => row.adapter).map((row) => [row.adapter, {
        runner_available: row.runner_available,
        auth_ready: row.auth_ready,
        checked_at: report.checked_at,
      }])),
    }));
    return { execution_profile: readExecutionProfile({ registry, projectId, environment }), readiness_report: report };
  }

  if (!["select", "reset"].includes(action)) {
    throw new ExecutionProfileError("execution-profile.invalid-action", `Unsupported execution-profile action '${action}'.`);
  }
  assertMutable(registry, projectId, expectedRevision);
  if (!step || !SUPPORTED_STEP_CLASSES.includes(step)) {
    throw new ExecutionProfileError("execution-profile.unknown-step", `Unsupported step '${step ?? "missing"}'.`);
  }
  const loaded = readProfile(context);
  if (!loaded) throw new ExecutionProfileError("execution-profile.unconfigured", "Project profile is not configured.", 409);
  loaded.profile.default_route_profiles ??= {};
  if (action === "select") {
    if (!routeId) throw new ExecutionProfileError("execution-profile.route-required", "Route select requires route_id.");
    const roots = resolveProjectRegistryRoots(loaded.profile, { projectRoot: context.projectRoot }).roots;
    const route = buildRouteRegistry({ routesRoot: roots.routes }).routeById.get(routeId);
    if (!route || route.step !== step) {
      throw new ExecutionProfileError("execution-profile.route-invalid", `Route '${routeId}' is not approved for step '${step}'.`, 409);
    }
    loaded.profile.default_route_profiles[step] = routeId;
  } else {
    delete loaded.profile.default_route_profiles[step];
  }
  const validation = validateContractDocument({ family: "project-profile", document: loaded.profile, source: context.canonicalProfilePath });
  if (!validation.ok) throw new ExecutionProfileError("execution-profile.profile-invalid", "Route mutation would make the project profile invalid.", 409);
  atomicWriteProfile(context.canonicalProfilePath, loaded.profile);
  try {
    registry.updateProject(projectId, registry.revision, (current) => ({
      ...current,
      latestExecutionReadiness: null,
      routeHistory: [...(current.routeHistory ?? []), {
        action,
        step,
        route_id: action === "select" ? routeId : null,
        occurred_at: new Date().toISOString(),
      }].slice(-100),
    }));
  } catch (error) {
    fs.writeFileSync(context.canonicalProfilePath, loaded.raw, { mode: 0o600 });
    throw error;
  }
  return { execution_profile: readExecutionProfile({ registry, projectId, environment }), readiness_report: null };
}
