import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { previewProjectRuntime } from "../project-init.mjs";
import { listFlowProjections } from "./flow-projections.mjs";
import { buildOnboardingSummary } from "./onboarding-summary.mjs";
import { createProjectContext, rekeyProjectContext } from "./project-context.mjs";
import { createWorkspaceRegistryStore } from "./workspace-registry-store.mjs";

/**
 * @param {unknown} value
 * @returns {string | undefined}
 */
function optionalString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * @param {string} value
 * @returns {string}
 */
function shortHash(value) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 8);
}

/**
 * @param {string} char
 * @returns {boolean}
 */
function isProjectIdChar(char) {
  return (
    (char >= "a" && char <= "z")
    || (char >= "0" && char <= "9")
    || char === "."
    || char === "_"
    || char === "-"
  );
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeId(value) {
  let normalized = "";
  let previousWasReplacement = false;
  for (const char of value.toLowerCase()) {
    if (isProjectIdChar(char)) {
      normalized += char;
      previousWasReplacement = false;
      continue;
    }
    if (!previousWasReplacement) {
      normalized += "-";
      previousWasReplacement = true;
    }
  }
  let start = 0;
  let end = normalized.length;
  while (start < end && normalized[start] === "-") {
    start += 1;
  }
  while (end > start && normalized[end - 1] === "-") {
    end -= 1;
  }
  return normalized.slice(start, end) || "project";
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef: string,
 *   projectProfile?: string,
 *   runtimeRoot?: string,
 * }} runtimeOptions
 * @param {ReturnType<typeof previewProjectRuntime>} preview
 */
function readActiveFlowSummary(runtimeOptions, preview) {
  if (!preview.stateExists) {
    return {
      status: "not-initialized",
      selected_flow_id: null,
      active_flow_count: 0,
      completed_flow_count: 0,
    };
  }

  try {
    const flowPayload = listFlowProjections(runtimeOptions);
    return {
      status: flowPayload.active_flow_ids.length > 0
        ? "active-flow"
        : flowPayload.completed_flow_ids.length > 0
          ? "completed-only"
          : "no-flows",
      selected_flow_id: flowPayload.selected_flow_id,
      active_flow_count: flowPayload.active_flow_ids.length,
      completed_flow_count: flowPayload.completed_flow_ids.length,
    };
  } catch (error) {
    return {
      status: "unreadable",
      selected_flow_id: null,
      active_flow_count: 0,
      completed_flow_count: 0,
      blocker: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * @param {{ runtimeRoot: string, projectId: string }} preview
 * @returns {string[]}
 */
function detectProfileMismatchCandidateProjectIds(preview) {
  const projectsRoot = path.join(preview.runtimeRoot, "projects");
  if (!fs.existsSync(projectsRoot)) return [];
  try {
    return fs.readdirSync(projectsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((projectId) => projectId !== preview.projectId)
      .filter((projectId) => (
        fs.existsSync(path.join(projectsRoot, projectId, "state", "project-init-state.json"))
        || fs.existsSync(path.join(projectsRoot, projectId, "reports", "onboarding-report.json"))
      ))
      .slice(0, 8);
  } catch {
    return [];
  }
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef: string,
 *   projectProfile?: string,
 *   runtimeRoot?: string,
 *   label?: string,
 * }} input
 */
/**
 * @param {ReturnType<typeof createProjectContext>} context
 * @param {Map<string, ReturnType<typeof createProjectContext>>} contexts
 * @returns {string}
 */
function resolveRegistryProjectId(context, contexts) {
  if (!contexts.has(context.projectId)) {
    return context.projectId;
  }

  const base = normalizeId(path.basename(context.projectRoot)) || normalizeId(context.runtimeProjectId);
  const suffix = shortHash([
    context.projectRoot,
    context.runtimeRoot,
    context.runtimeProjectId,
    projectProfileIdentity(context),
  ].join("\0"));
  let candidate = `${base}-${suffix}`;
  let collision = 1;
  while (contexts.has(candidate)) {
    collision += 1;
    candidate = `${base}-${suffix}-${collision}`;
  }
  return candidate;
}

/**
 * @param {ReturnType<typeof createProjectContext>} context
 * @returns {string}
 */
function projectProfileIdentity(context) {
  return context.canonicalProfilePath;
}

/**
 * @param {ReturnType<typeof createProjectContext>} left
 * @param {ReturnType<typeof createProjectContext>} right
 * @returns {boolean}
 */
function isSameRegisteredTarget(left, right) {
  return (
    left.projectRoot === right.projectRoot
    && left.runtimeRoot === right.runtimeRoot
    && projectProfileIdentity(left) === projectProfileIdentity(right)
  );
}

/**
 * @param {ReturnType<typeof createProjectContext>} context
 */
export function summarizeProjectContext(context) {
  const preview = previewProjectRuntime(context.runtimeOptions);
  const activeFlowSummary = readActiveFlowSummary(context.runtimeOptions, preview);
  const onboardingSummary = buildOnboardingSummary(preview);
  const profileMismatchCandidateProjectIds = preview.stateExists
    ? []
    : detectProfileMismatchCandidateProjectIds(preview);
  const profileMismatchBlocker = profileMismatchCandidateProjectIds.length > 0
    ? `Runtime root already contains AOR evidence for '${profileMismatchCandidateProjectIds[0]}'. Add this project with the matching project profile before initializing a new runtime.`
    : null;
  const blockers = [
    ...(Array.isArray(onboardingSummary.blockers) ? onboardingSummary.blockers : []),
    ...(profileMismatchBlocker ? [profileMismatchBlocker] : []),
    ...(activeFlowSummary.blocker ? [activeFlowSummary.blocker] : []),
  ];
  return {
    project_id: context.projectId,
    runtime_project_id: preview.projectId,
    label: context.label,
    display_name: preview.displayName,
    project_ref: context.projectRoot,
    project_profile_ref: context.canonicalProfilePath,
    project_profile_source: preview.projectProfileSource,
    runtime_root: context.runtimeRoot,
    onboarding_summary: {
      ...onboardingSummary,
      ...(profileMismatchCandidateProjectIds.length > 0
        ? { profile_mismatch_candidate_project_ids: profileMismatchCandidateProjectIds }
        : {}),
      blockers,
    },
    active_flow_summary: activeFlowSummary,
    read_only: true,
  };
}

/**
 * @param {{
 *   cwd?: string,
 *   projects: Array<{
 *     projectRef: string,
 *     projectProfile?: string,
 *     runtimeRoot?: string,
 *     label?: string,
 *     bindings?: unknown[],
 *   }>,
 *   persistence?: { mode: "ephemeral" | "persistent", root?: string },
 * }} options
 */
export function createLocalProjectRegistry(options) {
  const cwd = options.cwd ?? process.cwd();
  const contexts = new Map();
  const inputs = new Map();
  const store = options.persistence?.mode === "persistent"
    ? createWorkspaceRegistryStore({ root: options.persistence.root })
    : null;
  const stored = store?.read() ?? { revision: 0, projects: [], selected_project_id: null };
  let registryRevision = stored.revision;
  let defaultProjectId = null;

  function persist() {
    if (!store) return;
    const next = store.update(registryRevision, (document) => ({
      ...document,
      selected_project_id: null,
      projects: [...inputs.entries()].map(([projectId, input]) => ({
        project_id: projectId,
        project_ref: input.projectRef,
        project_profile: input.projectProfile ?? null,
        runtime_root: input.runtimeRoot ?? null,
        label: input.label ?? null,
        bindings: Array.isArray(input.bindings) ? input.bindings : [],
      })),
    }));
    registryRevision = next.revision;
  }

  /**
   * @param {{
   *   projectRef: string,
   *   projectProfile?: string,
   *   runtimeRoot?: string,
   *   label?: string,
   * }} input
   */
  function addProject(input, settings = {}) {
    const nextContext = createProjectContext({ ...input, cwd });
    const existing = [...contexts.values()].find((context) => isSameRegisteredTarget(context, nextContext));
    let selectedProjectId;
    if (existing) {
      contexts.set(existing.projectId, rekeyProjectContext(existing, existing.projectId, optionalString(input.label) ?? existing.label));
      inputs.set(existing.projectId, { ...inputs.get(existing.projectId), ...input });
      if (settings.select !== false) defaultProjectId ??= existing.projectId;
      selectedProjectId = existing.projectId;
    } else {
      const registryProjectId = resolveRegistryProjectId(nextContext, contexts);
      const context = rekeyProjectContext(nextContext, registryProjectId);
      contexts.set(context.projectId, context);
      inputs.set(context.projectId, { ...input, projectRef: context.projectRoot });
      if (settings.select !== false) defaultProjectId ??= context.projectId;
      selectedProjectId = context.projectId;
    }
    if (settings.persist !== false) persist();
    return contexts.get(selectedProjectId);
  }

  for (const project of stored.projects) {
    if (typeof project.project_ref !== "string") continue;
    addProject({
      projectRef: project.project_ref,
      projectProfile: optionalString(project.project_profile),
      runtimeRoot: optionalString(project.runtime_root),
      label: optionalString(project.label),
      bindings: Array.isArray(project.bindings) ? project.bindings : [],
    }, { persist: false, select: false });
  }
  for (const project of options.projects) {
    addProject(project, { persist: true, select: true });
  }

  return {
    get defaultProjectId() {
      return defaultProjectId;
    },
    get revision() {
      return registryRevision;
    },
    get persistent() {
      return store !== null;
    },
    listContexts() {
      return [...contexts.values()];
    },
    getContext(projectId) {
      return contexts.get(projectId) ?? null;
    },
    addProject,
    getProjectInput(projectId) {
      return inputs.get(projectId) ?? null;
    },
    summarize() {
      return {
        workspace_id: "default",
        revision: registryRevision,
        selected_project_id: defaultProjectId,
        default_project_id: defaultProjectId,
        projects: [...contexts.values()].map((context) => summarizeProjectContext(context)),
        read_only: true,
      };
    },
  };
}
