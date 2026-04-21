import fs from "node:fs";
import path from "node:path";

const SUPPORTED_WORKSPACE_MODES = new Set(["ephemeral", "workspace-clone", "worktree"]);
const SUPPORTED_CLEANUP_ACTIONS = new Set(["delete", "retain", "none"]);

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeWorkspaceMode(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : "ephemeral";
}

/**
 * @param {string} value
 * @returns {boolean}
 */
export function isSupportedWorkspaceMode(value) {
  return SUPPORTED_WORKSPACE_MODES.has(value);
}

/**
 * @param {"ephemeral" | "workspace-clone" | "worktree"} mode
 * @returns {{ on_success: "delete" | "retain" | "none", on_abort: "delete" | "retain" | "none", on_failure: "delete" | "retain" | "none" }}
 */
function defaultCleanupPolicy(mode) {
  if (mode === "ephemeral") {
    return {
      on_success: "none",
      on_abort: "none",
      on_failure: "none",
    };
  }

  return {
    on_success: "delete",
    on_abort: "delete",
    on_failure: "retain",
  };
}

/**
 * @param {Record<string, unknown>} runtimeDefaults
 * @param {"ephemeral" | "workspace-clone" | "worktree"} mode
 * @returns {{ on_success: "delete" | "retain" | "none", on_abort: "delete" | "retain" | "none", on_failure: "delete" | "retain" | "none" }}
 */
function resolveCleanupPolicy(runtimeDefaults, mode) {
  const defaults = defaultCleanupPolicy(mode);
  const configured = /** @type {Record<string, unknown>} */ (runtimeDefaults.workspace_cleanup ?? {});
  if (!isPlainObject(configured)) {
    return defaults;
  }

  /**
   * @param {unknown} value
   * @param {"delete" | "retain" | "none"} fallback
   * @returns {"delete" | "retain" | "none"}
   */
  function cleanupAction(value, fallback) {
    if (typeof value !== "string" || !SUPPORTED_CLEANUP_ACTIONS.has(value)) {
      return fallback;
    }
    return /** @type {"delete" | "retain" | "none"} */ (value);
  }

  return {
    on_success: cleanupAction(configured.on_success, defaults.on_success),
    on_abort: cleanupAction(configured.on_abort, defaults.on_abort),
    on_failure: cleanupAction(configured.on_failure, defaults.on_failure),
  };
}

/**
 * @param {string} candidate
 * @param {string} root
 * @returns {boolean}
 */
function isPathInsideRoot(candidate, root) {
  const resolvedCandidate = path.resolve(candidate);
  const resolvedRoot = path.resolve(root);
  return (
    resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)
  );
}

/**
 * @param {{ sourceRoot: string, targetRoot: string, runtimeRoot: string }} options
 */
function cloneWorkspaceTree(options) {
  fs.rmSync(options.targetRoot, { recursive: true, force: true });
  fs.mkdirSync(options.targetRoot, { recursive: true });

  for (const entry of fs.readdirSync(options.sourceRoot)) {
    const sourceEntry = path.join(options.sourceRoot, entry);
    if (isPathInsideRoot(sourceEntry, options.runtimeRoot)) {
      continue;
    }

    fs.cpSync(sourceEntry, path.join(options.targetRoot, entry), {
      recursive: true,
      filter: (sourcePath) => !isPathInsideRoot(sourcePath, options.runtimeRoot),
    });
  }
}

/**
 * @param {string} runId
 * @returns {string}
 */
function toRunSlug(runId) {
  return runId.replace(/[^A-Za-z0-9._-]+/g, "-");
}

/**
 * @param {{
 *   mode: "ephemeral" | "workspace-clone" | "worktree",
 *   projectRoot: string,
 *   runtimeRoot: string,
 *   projectRuntimeRoot: string,
 *   runId: string,
 * }} options
 * @returns {{ executionRoot: string, provisioned: boolean, checkout: { strategy: string, ref: string }, provisioning: string }}
 */
function provisionWorkspace(options) {
  if (options.mode === "ephemeral") {
    return {
      executionRoot: options.projectRoot,
      provisioned: false,
      checkout: {
        strategy: "primary-checkout",
        ref: "local-working-copy",
      },
      provisioning: "in-place",
    };
  }

  const workspacesRoot = path.join(options.projectRuntimeRoot, "workspaces");
  const workspaceId = `${options.mode}-${toRunSlug(options.runId)}`;
  const executionRoot = path.join(workspacesRoot, workspaceId);
  cloneWorkspaceTree({
    sourceRoot: options.projectRoot,
    targetRoot: executionRoot,
    runtimeRoot: options.runtimeRoot,
  });

  return {
    executionRoot,
    provisioned: true,
    checkout: {
      strategy: options.mode,
      ref: "local-working-copy",
    },
    provisioning: "filesystem-copy",
  };
}

/**
 * @param {{ executionRoot: string, action: "delete" | "retain" | "none", outcome: "success" | "abort" | "failure" }} options
 * @returns {{ outcome: "success" | "abort" | "failure", action: "delete" | "retain" | "none", status: "deleted" | "retained" | "skipped" | "delete-failed", performed: boolean, exists_after: boolean, error: string | null }}
 */
function applyWorkspaceCleanup(options) {
  if (options.action === "none") {
    return {
      outcome: options.outcome,
      action: options.action,
      status: "skipped",
      performed: false,
      exists_after: fs.existsSync(options.executionRoot),
      error: null,
    };
  }

  if (options.action === "retain") {
    return {
      outcome: options.outcome,
      action: options.action,
      status: "retained",
      performed: false,
      exists_after: fs.existsSync(options.executionRoot),
      error: null,
    };
  }

  try {
    fs.rmSync(options.executionRoot, { recursive: true, force: true });
    return {
      outcome: options.outcome,
      action: options.action,
      status: "deleted",
      performed: true,
      exists_after: fs.existsSync(options.executionRoot),
      error: null,
    };
  } catch (error) {
    return {
      outcome: options.outcome,
      action: options.action,
      status: "delete-failed",
      performed: true,
      exists_after: fs.existsSync(options.executionRoot),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * @param {{
 *   projectRoot: string,
 *   runtimeRoot: string,
 *   projectRuntimeRoot: string,
 *   runtimeDefaults: Record<string, unknown>,
 *   runId: string,
 * }} options
 * @returns {{
 *   requestedMode: string,
 *   mode: "ephemeral" | "workspace-clone" | "worktree" | "unsupported",
 *   sourceRoot: string,
 *   executionRoot: string,
 *   checkout: { strategy: string, ref: string },
 *   provisioning: string,
 *   provisioned: boolean,
 *   cleanupPolicy: { on_success: "delete" | "retain" | "none", on_abort: "delete" | "retain" | "none", on_failure: "delete" | "retain" | "none" },
 *   finalize: (outcome: "success" | "abort" | "failure") => { outcome: "success" | "abort" | "failure", action: "delete" | "retain" | "none", status: "deleted" | "retained" | "skipped" | "delete-failed", performed: boolean, exists_after: boolean, error: string | null },
 * }}
 */
export function prepareWorkspaceIsolation(options) {
  const requestedMode = normalizeWorkspaceMode(options.runtimeDefaults.workspace_mode);
  if (!isSupportedWorkspaceMode(requestedMode)) {
    const fallbackPolicy = defaultCleanupPolicy("ephemeral");
    return {
      requestedMode,
      mode: "unsupported",
      sourceRoot: options.projectRoot,
      executionRoot: options.projectRoot,
      checkout: {
        strategy: "primary-checkout",
        ref: "local-working-copy",
      },
      provisioning: "unsupported-mode",
      provisioned: false,
      cleanupPolicy: fallbackPolicy,
      finalize: (outcome) => {
        const cleanupAction =
          outcome === "success"
            ? fallbackPolicy.on_success
            : outcome === "abort"
              ? fallbackPolicy.on_abort
              : fallbackPolicy.on_failure;
        return applyWorkspaceCleanup({
          executionRoot: options.projectRoot,
          action: cleanupAction,
          outcome,
        });
      },
    };
  }

  const mode = /** @type {"ephemeral" | "workspace-clone" | "worktree"} */ (requestedMode);
  const provisionedWorkspace = provisionWorkspace({
    mode,
    projectRoot: options.projectRoot,
    runtimeRoot: options.runtimeRoot,
    projectRuntimeRoot: options.projectRuntimeRoot,
    runId: options.runId,
  });
  const cleanupPolicy = resolveCleanupPolicy(options.runtimeDefaults, mode);

  return {
    requestedMode,
    mode,
    sourceRoot: options.projectRoot,
    executionRoot: provisionedWorkspace.executionRoot,
    checkout: provisionedWorkspace.checkout,
    provisioning: provisionedWorkspace.provisioning,
    provisioned: provisionedWorkspace.provisioned,
    cleanupPolicy,
    finalize: (outcome) => {
      const cleanupAction =
        outcome === "success"
          ? cleanupPolicy.on_success
          : outcome === "abort"
            ? cleanupPolicy.on_abort
            : cleanupPolicy.on_failure;
      return applyWorkspaceCleanup({
        executionRoot: provisionedWorkspace.executionRoot,
        action: cleanupAction,
        outcome,
      });
    },
  };
}
