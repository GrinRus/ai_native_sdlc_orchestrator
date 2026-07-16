import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { validateContractDocument } from "../../../contracts/src/index.mjs";
import { inspectRepositoryBinding, discoverTopologyProposals } from "./topology-discovery.mjs";

export class TopologyManagementError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = "TopologyManagementError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function digest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function readProfile(context) {
  const profilePath = context.canonicalProfilePath;
  if (!fs.existsSync(profilePath)) {
    throw new TopologyManagementError("topology.profile_missing", `Project profile '${profilePath}' was not found.`, 409);
  }
  const raw = fs.readFileSync(profilePath, "utf8");
  const profile = parseYaml(raw);
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    throw new TopologyManagementError("topology.profile_invalid", "Project profile must be a YAML mapping.", 409);
  }
  profile.repos ??= [];
  profile.components ??= [];
  profile.component_graph ??= [];
  return { profilePath, profile, raw };
}

function atomicWriteProfile(profilePath, profile) {
  const temporary = `${profilePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, stringifyYaml(profile), { mode: 0o600 });
  fs.renameSync(temporary, profilePath);
}

function entityList(profile, family) {
  if (family === "repository") return profile.repos;
  if (family === "component") return profile.components;
  if (family === "dependency") return profile.component_graph;
  throw new TopologyManagementError("topology.invalid_family", `Unsupported topology family '${family}'.`);
}

function entityId(family, entity) {
  if (family === "repository") return entity.repo_id ?? entity.repository_id ?? entity.id;
  if (family === "component") return entity.component_id ?? entity.id;
  return entity.dependency_id ?? `${entity.from_component_id ?? entity.from ?? entity.source}->${entity.to_component_id ?? entity.to ?? entity.target}`;
}

function validateTopology(profile, bindings) {
  const findings = [];
  const contractValidation = validateContractDocument({
    family: "project-profile",
    document: profile,
    source: "workspace://project-topology",
  });
  findings.push(...contractValidation.issues.map((issue) => ({
    code: `topology.profile_${issue.code}`,
    severity: "block",
    resource: issue.path ?? "project-profile",
  })));
  const repositories = new Set(profile.repos.map((entry) => entityId("repository", entry)));
  const components = new Set();
  const mounts = new Set();
  for (const repository of profile.repos) {
    const mount = typeof repository.workspace_mount === "string"
      ? repository.workspace_mount
      : repository.workspace_mount?.mount_path ?? repository.mount_path ?? repository.source?.root;
    if (!mount || mounts.has(mount)) findings.push({ code: "topology.duplicate_or_missing_mount", severity: "block", resource: entityId("repository", repository) });
    mounts.add(mount);
  }
  for (const component of profile.components) {
    const id = entityId("component", component);
    if (!id || components.has(id)) findings.push({ code: "topology.duplicate_component", severity: "block", resource: id ?? null });
    components.add(id);
    const owner = component.repository_id ?? component.repo_id ?? component.owning_repository;
    if (!repositories.has(owner)) findings.push({ code: "topology.unknown_repository", severity: "block", resource: id ?? null });
  }
  for (const edge of profile.component_graph) {
    const source = edge.from_component_id ?? edge.from ?? edge.source;
    const target = edge.to_component_id ?? edge.to ?? edge.target;
    if (!components.has(source) || !components.has(target)) {
      findings.push({ code: "topology.unknown_dependency_component", severity: "block", resource: entityId("dependency", edge) });
    }
  }
  for (const binding of bindings) {
    const inspected = inspectRepositoryBinding(binding.local_path, binding.base_ref);
    if (inspected.status !== "available") {
      findings.push({ code: `topology.binding_${inspected.status}`, severity: inspected.status === "ref-drift" ? "warn" : "block", resource: binding.repo_id });
    }
  }
  return {
    status: findings.some((finding) => finding.severity === "block") ? "fail" : findings.length > 0 ? "warn" : "pass",
    blocking: findings.some((finding) => finding.severity === "block"),
    findings,
    recovery_actions: [...new Set(findings.map((finding) => (
      finding.code.includes("binding") ? "rebind_repository" : "inspect"
    )))],
  };
}

export function readProjectTopology({ registry, projectId }) {
  const context = registry.getContext(projectId);
  if (!context) throw new TopologyManagementError("project.not_found", `Project '${projectId}' is not registered.`, 404);
  const input = registry.getProjectInput(projectId) ?? {};
  const { profilePath, profile } = readProfile(context);
  const bindings = Array.isArray(input.bindings) ? input.bindings : [];
  return {
    project_id: projectId,
    revision: registry.revision,
    profile_ref: profilePath,
    profile_digest: digest(profile),
    repositories: profile.repos,
    components: profile.components,
    dependencies: profile.component_graph,
    bindings: bindings.map((binding) => ({ ...binding, inspection: inspectRepositoryBinding(binding.local_path, binding.base_ref) })),
    latest_validation: input.latestValidation ?? null,
    read_only: true,
  };
}

function mutateEntity(profile, family, action, payload) {
  const list = entityList(profile, family);
  const id = payload.id ?? payload.repo_id ?? payload.component_id ?? payload.dependency_id;
  const index = list.findIndex((entry) => entityId(family, entry) === id);
  if (action === "add" || action === "upsert") {
    if (action === "add" && index >= 0) throw new TopologyManagementError("topology.duplicate_id", `${family} '${id}' already exists.`, 409);
    if (index >= 0) list[index] = { ...list[index], ...payload };
    else list.push(payload);
  } else if (action === "update" || action === "disable") {
    if (index < 0) throw new TopologyManagementError("topology.unknown_ref", `${family} '${id}' was not found.`, 404);
    list[index] = action === "disable" ? { ...list[index], disabled: true } : { ...list[index], ...payload };
  } else if (action === "remove") {
    if (index < 0) throw new TopologyManagementError("topology.unknown_ref", `${family} '${id}' was not found.`, 404);
    list.splice(index, 1);
  } else {
    throw new TopologyManagementError("topology.invalid_action", `Unsupported ${family} action '${action}'.`);
  }
}

export function applyTopologyAction({ registry, projectId, expectedRevision, action, family, payload = {} }) {
  if (expectedRevision !== undefined && registry.revision !== expectedRevision) {
    throw new TopologyManagementError("topology.stale_revision", `Expected revision ${expectedRevision}, current ${registry.revision}.`, 409);
  }
  const context = registry.getContext(projectId);
  if (!context) throw new TopologyManagementError("project.not_found", `Project '${projectId}' is not registered.`, 404);
  const summary = registry.summarize().projects.find((project) => project.project_id === projectId);
  if (summary?.active_flow_summary?.active_flow_count > 0) {
    throw new TopologyManagementError("topology.active_run_conflict", "Topology mutation is blocked while a project flow is active.", 409);
  }
  const input = registry.getProjectInput(projectId) ?? {};
  const { profilePath, profile, raw } = readProfile(context);
  const beforeDigest = digest(profile);
  let validation;
  let nextBindings = input.bindings ?? [];
  let wroteProfile = false;
  if (action === "reanalyze") {
    return { topology: readProjectTopology({ registry, projectId }), proposals: discoverTopologyProposals({ projectRoot: context.projectRoot }) };
  }
  if (action === "validate") {
    validation = validateTopology(profile, input.bindings ?? []);
  } else if (family === "binding" && action === "rebind") {
    nextBindings = [...(input.bindings ?? [])];
    const index = nextBindings.findIndex((binding) => binding.repo_id === payload.repo_id);
    if (index >= 0) nextBindings[index] = { ...nextBindings[index], ...payload };
    else nextBindings.push(payload);
    validation = validateTopology(profile, nextBindings);
  } else {
    mutateEntity(profile, family, action, payload);
    validation = validateTopology(profile, input.bindings ?? []);
    if (validation.blocking) {
      throw new TopologyManagementError("topology.validation_failed", "Topology mutation would produce a blocking validation report.", 409);
    }
    atomicWriteProfile(profilePath, profile);
    wroteProfile = true;
  }
  const afterDigest = digest(profile);
  const event = {
    operation: `${family}.${action}`,
    before_digest: beforeDigest,
    after_digest: afterDigest,
    occurred_at: new Date().toISOString(),
    invalidated: ["execution-readiness", "workspace-set", ...(family === "binding" ? [] : ["plan-approval"])],
  };
  try {
    registry.updateProject(projectId, registry.revision, (current) => ({
      ...current,
      bindings: nextBindings,
      latestValidation: validation ?? validateTopology(profile, nextBindings),
      topologyHistory: [...(current.topologyHistory ?? []), event].slice(-100),
    }));
  } catch (error) {
    if (wroteProfile) fs.writeFileSync(profilePath, raw, { mode: 0o600 });
    throw error;
  }
  return { topology: readProjectTopology({ registry, projectId }), validation: validation ?? null, revision_event: event };
}
