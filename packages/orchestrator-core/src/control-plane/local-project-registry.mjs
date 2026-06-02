import crypto from "node:crypto";
import path from "node:path";

import { previewProjectRuntime } from "../project-init.mjs";
import { listFlowProjections } from "./flow-projections.mjs";
import { buildOnboardingSummary } from "./onboarding-summary.mjs";

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
 * @param {string} value
 * @returns {string}
 */
function normalizeId(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    || "project";
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
 * @param {{
 *   cwd?: string,
 *   projectRef: string,
 *   projectProfile?: string,
 *   runtimeRoot?: string,
 *   label?: string,
 * }} input
 */
function createProjectContext(input) {
  const cwd = input.cwd ?? process.cwd();
  const preview = previewProjectRuntime({
    cwd,
    projectRef: input.projectRef,
    projectProfile: input.projectProfile,
    runtimeRoot: input.runtimeRoot,
  });
  return {
    projectId: preview.projectId,
    runtimeProjectId: preview.projectId,
    label: optionalString(input.label) ?? preview.displayName,
    runtimeOptions: {
      cwd,
      projectRef: preview.projectRoot,
      projectProfile: input.projectProfile,
      runtimeRoot: input.runtimeRoot,
    },
    resolvedProjectRoot: preview.projectRoot,
    resolvedRuntimeRoot: preview.runtimeRoot,
    originalProjectRef: path.resolve(cwd, input.projectRef),
  };
}

/**
 * @param {ReturnType<typeof createProjectContext>} context
 * @param {Map<string, ReturnType<typeof createProjectContext>>} contexts
 * @returns {string}
 */
function resolveRegistryProjectId(context, contexts) {
  if (!contexts.has(context.projectId)) {
    return context.projectId;
  }

  const base = normalizeId(path.basename(context.resolvedProjectRoot)) || normalizeId(context.runtimeProjectId);
  const suffix = shortHash(`${context.resolvedProjectRoot}\0${context.resolvedRuntimeRoot}\0${context.runtimeProjectId}`);
  let candidate = `${base}-${suffix}`;
  let collision = 1;
  while (contexts.has(candidate)) {
    collision += 1;
    candidate = `${base}-${suffix}-${collision}`;
  }
  return candidate;
}

/**
 * @param {ReturnType<typeof createProjectContext>} left
 * @param {ReturnType<typeof createProjectContext>} right
 * @returns {boolean}
 */
function isSameRegisteredTarget(left, right) {
  return left.resolvedProjectRoot === right.resolvedProjectRoot && left.resolvedRuntimeRoot === right.resolvedRuntimeRoot;
}

/**
 * @param {ReturnType<typeof createProjectContext>} context
 */
export function summarizeProjectContext(context) {
  const preview = previewProjectRuntime(context.runtimeOptions);
  const activeFlowSummary = readActiveFlowSummary(context.runtimeOptions, preview);
  const onboardingSummary = buildOnboardingSummary(preview);
  const blockers = [
    ...(Array.isArray(onboardingSummary.blockers) ? onboardingSummary.blockers : []),
    ...(activeFlowSummary.blocker ? [activeFlowSummary.blocker] : []),
  ];
  return {
    project_id: context.projectId,
    runtime_project_id: preview.projectId,
    label: context.label,
    display_name: preview.displayName,
    project_ref: preview.projectRoot,
    project_profile_ref: preview.projectProfileRef,
    project_profile_source: preview.projectProfileSource,
    runtime_root: preview.runtimeRoot,
    onboarding_summary: {
      ...onboardingSummary,
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
 *   }>,
 * }} options
 */
export function createLocalProjectRegistry(options) {
  const cwd = options.cwd ?? process.cwd();
  const contexts = new Map();
  let defaultProjectId = null;

  /**
   * @param {{
   *   projectRef: string,
   *   projectProfile?: string,
   *   runtimeRoot?: string,
   *   label?: string,
   * }} input
   */
  function addProject(input) {
    const nextContext = createProjectContext({ ...input, cwd });
    const existing = [...contexts.values()].find((context) => isSameRegisteredTarget(context, nextContext));
    let selectedProjectId;
    if (existing) {
      contexts.set(existing.projectId, {
        ...existing,
        label: optionalString(input.label) ?? existing.label,
      });
      selectedProjectId = existing.projectId;
    } else {
      const registryProjectId = resolveRegistryProjectId(nextContext, contexts);
      const context = {
        ...nextContext,
        projectId: registryProjectId,
      };
      contexts.set(context.projectId, context);
      defaultProjectId ??= context.projectId;
      selectedProjectId = context.projectId;
    }
    return contexts.get(selectedProjectId);
  }

  for (const project of options.projects) {
    addProject(project);
  }

  if (!defaultProjectId) {
    throw new Error("At least one local project must be registered before starting the app server.");
  }

  return {
    get defaultProjectId() {
      return defaultProjectId;
    },
    listContexts() {
      return [...contexts.values()];
    },
    getContext(projectId) {
      return contexts.get(projectId) ?? null;
    },
    addProject,
    summarize() {
      return {
        default_project_id: defaultProjectId,
        projects: [...contexts.values()].map((context) => summarizeProjectContext(context)),
        read_only: true,
      };
    },
  };
}
