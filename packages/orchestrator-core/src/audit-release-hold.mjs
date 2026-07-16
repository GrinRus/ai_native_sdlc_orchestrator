export const AUDIT_RELEASE_HOLD_CODE = "audit_release_hold";
export const CURRENT_RELEASE_DISPOSITION = "cleared";

/**
 * Decide from resolved capabilities rather than provider names or credentials.
 *
 * @param {{ dryRun: boolean, externalRuntime: unknown, deliveryMode: string | null, releaseDisposition?: "audit-hold" | "cleared", unsafeDevelopmentOverride?: boolean }} options
 */
export function evaluateAuditReleaseHold(options) {
  const releaseDisposition = options.releaseDisposition ?? CURRENT_RELEASE_DISPOSITION;
  const externalRuntime =
    typeof options.externalRuntime === "object" && options.externalRuntime !== null && !Array.isArray(options.externalRuntime)
      ? options.externalRuntime
      : {};
  const holdApplies =
    releaseDisposition === "audit-hold" &&
    options.dryRun === false &&
    Object.keys(externalRuntime).length > 0 &&
    typeof options.deliveryMode === "string" &&
    options.deliveryMode !== "no-write";
  const overrideUsed = holdApplies && options.unsafeDevelopmentOverride === true;

  if (holdApplies && !overrideUsed) {
    return {
      allowed: false,
      hold_applies: true,
      override_used: false,
      code: AUDIT_RELEASE_HOLD_CODE,
      message:
        "External write-capable live execution is blocked by the active audit release hold; maintainer-only development probes require --unsafe-development-override true.",
    };
  }

  return {
    allowed: true,
    hold_applies: holdApplies,
    override_used: overrideUsed,
    code: null,
    message: null,
  };
}
