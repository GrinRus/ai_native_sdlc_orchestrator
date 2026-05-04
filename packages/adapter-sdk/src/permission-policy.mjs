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
 * @returns {string | null}
 */
function asOptionalString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * @param {{ externalRuntime: Record<string, unknown>, requestedMode?: string | null }} options
 * @returns {{ ok: true, args: string[], permissionMode: string, source: string } | { ok: false, args: string[], permissionMode: string, source: string, failureKind: string, message: string }}
 */
export function resolveExternalRuntimePermissionPolicy(options) {
  const externalRuntime = asRecord(options.externalRuntime);
  const policy = asRecord(externalRuntime.permission_policy);
  const hasPolicy = Object.keys(policy).length > 0;
  if (!hasPolicy) {
    return {
      ok: false,
      args: [],
      permissionMode: "missing",
      source: "external_runtime.permission_policy",
      failureKind: "permission-policy-invalid",
      message: "External runtime permission_policy is required; legacy external_runtime.args is no longer supported.",
    };
  }

  const requestedMode = asOptionalString(options.requestedMode);
  const defaultMode = asOptionalString(policy.default_mode);
  const selectedMode = requestedMode ?? defaultMode;
  if (!selectedMode) {
    return {
      ok: false,
      args: [],
      permissionMode: "missing",
      source: "permission_policy.default_mode",
      failureKind: "permission-policy-invalid",
      message: "External runtime permission_policy.default_mode must select a declared non-empty mode.",
    };
  }

  const modes = asRecord(policy.modes);
  const modeProfile = asRecord(modes[selectedMode]);
  const modeArgs = asStringArray(modeProfile.args);
  if (modeArgs.length === 0) {
    return {
      ok: false,
      args: [],
      permissionMode: selectedMode,
      source: requestedMode ? "AOR_RUNTIME_AGENT_PERMISSION_MODE" : "permission_policy.default_mode",
      failureKind: "permission-policy-invalid",
      message: `External runtime permission policy mode '${selectedMode}' is not declared with non-empty args.`,
    };
  }

  return {
    ok: true,
    args: modeArgs,
    permissionMode: selectedMode,
    source: requestedMode ? "AOR_RUNTIME_AGENT_PERMISSION_MODE" : "permission_policy.default_mode",
  };
}
