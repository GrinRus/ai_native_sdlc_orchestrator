import path from "node:path";

import { resolveAorHome, resolveLogicalEvidenceRef } from "../aor-home.mjs";

export function resolveTaskInputPacketPath(reference, runtimeOptions, workspaceProjectId) {
  return resolveLogicalEvidenceRef({
    projectRoot: runtimeOptions.projectRef ?? runtimeOptions.cwd ?? process.cwd(),
    projectRuntimeRoot: path.join(runtimeOptions.runtimeRoot ?? resolveAorHome(), "projects", workspaceProjectId),
    workspaceProjectId,
    reference,
  });
}

export function prepareMissionIntakeLifecycleFlags(flags, payload, schema, runtimeOptions, workspaceProjectId) {
  if (typeof flags["request-file"] === "string") {
    flags["request-file"] = resolveTaskInputPacketPath(flags["request-file"], runtimeOptions, workspaceProjectId);
  }

  for (const [field, rule] of Object.entries(schema)) {
    const value = payload[field];
    if (typeof rule.lifecycle_flag !== "string" || typeof value !== "string" || !value.trim()) continue;
    const existing = Array.isArray(flags[rule.lifecycle_flag]) ? flags[rule.lifecycle_flag] : [];
    flags[rule.lifecycle_flag] = [...existing, value.trim()];
  }

  const name = payload.kpi_name;
  const target = payload.kpi_target;
  if (typeof name === "string" && typeof target === "string") {
    const measurement = typeof payload.kpi_measurement === "string" && payload.kpi_measurement.trim()
      ? `:${payload.kpi_measurement.trim()}`
      : "";
    flags.kpi = [...(Array.isArray(flags.kpi) ? flags.kpi : []), `aor-intake-kpi-1:${name.trim()}:${target.trim()}${measurement}`];
  }
}
