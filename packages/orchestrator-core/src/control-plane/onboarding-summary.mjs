/**
 * @param {{
 *   stateExists: boolean,
 *   onboardingReportExists: boolean,
 * }} preview
 */
export function buildOnboardingSummary(preview) {
  const initialized = preview.onboardingReportExists;
  const status = initialized
    ? "initialized"
    : preview.stateExists
      ? "runtime-ready"
      : "not-initialized";
  return {
    status,
    initialized,
    state_exists: preview.stateExists,
    onboarding_report_exists: preview.onboardingReportExists,
    can_initialize: !initialized,
    recommended_action: initialized
      ? "start-or-select-flow"
      : preview.stateExists
        ? "run-project-init"
        : "initialize-runtime",
    blockers: [],
  };
}
