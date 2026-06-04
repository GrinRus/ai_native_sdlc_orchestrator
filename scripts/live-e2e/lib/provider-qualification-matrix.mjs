import { asNonEmptyString, asRecord, asStringArray, nowIso } from "./common.mjs";

export const PROVIDER_QUALIFICATION_STATUSES = Object.freeze(["qualified", "candidate", "blocked", "not-run"]);
export const FAILURE_OWNERS = Object.freeze(["aor", "target_repository", "provider", "environment", "operator"]);
export const FAILURE_PHASES = Object.freeze([
  "aor_install",
  "target_checkout",
  "target_setup",
  "target_verification",
  "provider_execution",
  "controller_decision",
  "ui_validation",
]);

export const DEFAULT_PROVIDER_QUALIFICATION_PROVIDERS = Object.freeze([
  {
    provider_variant_id: "openai-primary",
    provider: "openai",
    adapter: "codex-cli",
    coverage_tier: "required",
  },
  {
    provider_variant_id: "anthropic-primary",
    provider: "anthropic",
    adapter: "claude-code",
    coverage_tier: "required",
  },
  {
    provider_variant_id: "open-code-primary",
    provider: "open-code",
    adapter: "open-code",
    coverage_tier: "extended",
  },
  {
    provider_variant_id: "qwen-primary",
    provider: "qwen",
    adapter: "qwen-code",
    coverage_tier: "extended",
  },
]);

/**
 * @param {unknown} value
 * @param {readonly string[]} allowed
 * @returns {string | null}
 */
function allowedString(value, allowed) {
  const normalized = asNonEmptyString(value);
  return normalized && allowed.includes(normalized) ? normalized : null;
}

/**
 * @param {unknown} attempt
 * @returns {"passed" | "needs_fix" | "blocked" | "candidate" | "unknown"}
 */
export function normalizeQualificationAttemptStatus(attempt) {
  const raw = asNonEmptyString(asRecord(attempt).status);
  if (["pass", "passed", "qualified", "covered_pass"].includes(raw)) return "passed";
  if (["needs_fix", "needs-fix", "fail", "failed", "not_pass", "not-pass"].includes(raw)) return "needs_fix";
  if (["blocked", "provider_blocked", "environment_blocked", "target_setup_blocked", "target_verification_blocked"].includes(raw)) {
    return "blocked";
  }
  if (raw === "candidate" || raw === "warn" || raw === "covered_with_findings") return "candidate";
  return "unknown";
}

/**
 * @param {Record<string, unknown>} attempt
 * @returns {{ failure_owner: string | null, failure_phase: string | null, failure_class: string | null, blocker_reason: string | null, evidence_refs: string[] }}
 */
export function extractQualificationFailureContext(attempt) {
  const targetSetupStatus = asRecord(attempt.target_setup_status);
  const targetVerificationStatus = asRecord(attempt.target_verification_status);
  const providerStepStatus = asRecord(attempt.provider_step_status);
  const baselineGate = asRecord(attempt.baseline_verify_gate_decision);
  const status = normalizeQualificationAttemptStatus(attempt);

  const failureOwner =
    allowedString(attempt.failure_owner, FAILURE_OWNERS) ||
    allowedString(targetSetupStatus.failure_owner, FAILURE_OWNERS) ||
    allowedString(targetVerificationStatus.failure_owner, FAILURE_OWNERS) ||
    allowedString(baselineGate.failure_owner, FAILURE_OWNERS) ||
    (status === "needs_fix" ? "aor" : null);
  const failurePhase =
    allowedString(attempt.failure_phase, FAILURE_PHASES) ||
    allowedString(targetSetupStatus.failure_phase, FAILURE_PHASES) ||
    allowedString(targetVerificationStatus.failure_phase, FAILURE_PHASES) ||
    allowedString(baselineGate.failure_phase, FAILURE_PHASES) ||
    (asNonEmptyString(providerStepStatus.status) ? "provider_execution" : null) ||
    (status === "needs_fix" ? "ui_validation" : null);
  const failureClass =
    asNonEmptyString(attempt.failure_class) ||
    asNonEmptyString(attempt.blocker_class) ||
    asNonEmptyString(targetSetupStatus.failure_class) ||
    asNonEmptyString(targetVerificationStatus.failure_class) ||
    asNonEmptyString(baselineGate.failure_class) ||
    (status === "needs_fix" ? "aor_failure" : null);
  const blockerReason =
    asNonEmptyString(attempt.blocker_reason) ||
    asNonEmptyString(targetSetupStatus.blocker_reason) ||
    asNonEmptyString(targetVerificationStatus.blocker_reason) ||
    asNonEmptyString(attempt.public_observation) ||
    asNonEmptyString(attempt.summary) ||
    null;
  const evidenceRefs = [
    ...asStringArray(attempt.evidence_refs),
    asNonEmptyString(attempt.summary_ref),
    asNonEmptyString(attempt.observation_report_ref),
    asNonEmptyString(attempt.analysis_ref),
    asNonEmptyString(attempt.target_pre_execution_status_ref),
    asNonEmptyString(targetSetupStatus.evidence_ref),
    ...asStringArray(targetSetupStatus.evidence_refs),
    asNonEmptyString(targetVerificationStatus.evidence_ref),
    ...asStringArray(targetVerificationStatus.evidence_refs),
  ].filter(Boolean);

  return {
    failure_owner: failureOwner,
    failure_phase: failurePhase,
    failure_class: failureClass,
    blocker_reason: blockerReason,
    evidence_refs: [...new Set(evidenceRefs)],
  };
}

/**
 * @param {{
 *   providerVariantId: string,
 *   attempts: Array<Record<string, unknown>>,
 *   requiredPassCount?: number,
 * }} options
 * @returns {{ qualification_status: "qualified" | "candidate" | "blocked" | "not-run", passing_run_count: number, latest_attempt: Record<string, unknown> | null, failure_context: ReturnType<typeof extractQualificationFailureContext> }}
 */
export function classifyProviderQualification(options) {
  const providerAttempts = options.attempts.filter(
    (attempt) => asNonEmptyString(attempt.provider_variant_id) === options.providerVariantId,
  );
  const latestAttempt = providerAttempts.at(-1) ?? null;
  const passingRunCount = providerAttempts.filter((attempt) => normalizeQualificationAttemptStatus(attempt) === "passed").length;
  const requiredPassCount = Number.isFinite(Number(options.requiredPassCount))
    ? Math.max(0, Math.trunc(Number(options.requiredPassCount)))
    : 1;
  const latestStatus = latestAttempt ? normalizeQualificationAttemptStatus(latestAttempt) : "unknown";
  const failureContext = latestAttempt ? extractQualificationFailureContext(latestAttempt) : {
    failure_owner: null,
    failure_phase: null,
    failure_class: null,
    blocker_reason: null,
    evidence_refs: [],
  };

  if (passingRunCount >= Math.max(1, requiredPassCount)) {
    return {
      qualification_status: "qualified",
      passing_run_count: passingRunCount,
      latest_attempt: latestAttempt,
      failure_context: failureContext,
    };
  }
  if (providerAttempts.length === 0) {
    return {
      qualification_status: "not-run",
      passing_run_count: passingRunCount,
      latest_attempt: null,
      failure_context: failureContext,
    };
  }
  if (latestStatus === "blocked" || latestStatus === "needs_fix") {
    return {
      qualification_status: "blocked",
      passing_run_count: passingRunCount,
      latest_attempt: latestAttempt,
      failure_context: failureContext,
    };
  }
  return {
    qualification_status: "candidate",
    passing_run_count: passingRunCount,
    latest_attempt: latestAttempt,
    failure_context: failureContext,
  };
}

/**
 * @param {{
 *   providers?: Array<Record<string, unknown>>,
 *   attempts?: Array<Record<string, unknown>>,
 *   requiredProviderCounts?: Record<string, number>,
 *   releaseBlockingProviderIds?: string[],
 *   scope?: string,
 *   generatedAt?: string,
 * }} options
 */
export function buildProviderQualificationMatrix(options = {}) {
  const providers = (Array.isArray(options.providers) && options.providers.length > 0
    ? options.providers
    : DEFAULT_PROVIDER_QUALIFICATION_PROVIDERS
  ).map((entry) => asRecord(entry));
  const attempts = Array.isArray(options.attempts) ? options.attempts.map((entry) => asRecord(entry)) : [];
  const requiredProviderCounts = asRecord(options.requiredProviderCounts);
  const releaseBlockingProviderIds = new Set(asStringArray(options.releaseBlockingProviderIds));

  const providerCells = providers.map((provider) => {
    const providerVariantId = asNonEmptyString(provider.provider_variant_id);
    const requiredPassCount = Number(requiredProviderCounts[providerVariantId]) || 0;
    const classified = classifyProviderQualification({
      providerVariantId,
      attempts,
      requiredPassCount: requiredPassCount || 1,
    });
    const latestAttempt = classified.latest_attempt;
    const failureContext = classified.failure_context;
    const releaseBlocking = releaseBlockingProviderIds.has(providerVariantId);
    return {
      provider_variant_id: providerVariantId,
      provider: asNonEmptyString(provider.provider) || providerVariantId,
      adapter: asNonEmptyString(provider.adapter) || asNonEmptyString(provider.primary_adapter) || null,
      coverage_tier: asNonEmptyString(provider.coverage_tier) || "extended",
      qualification_status: classified.qualification_status,
      release_blocking: releaseBlocking,
      required_pass_count: requiredPassCount,
      passing_run_count: classified.passing_run_count,
      latest_run_id: asNonEmptyString(latestAttempt?.run_id) || null,
      latest_attempt_status: latestAttempt ? normalizeQualificationAttemptStatus(latestAttempt) : null,
      failure_owner: failureContext.failure_owner,
      failure_phase: failureContext.failure_phase,
      failure_class: failureContext.failure_class,
      blocker_reason: failureContext.blocker_reason,
      evidence_refs: failureContext.evidence_refs,
    };
  });

  const releaseBlockingFailures = providerCells.filter(
    (cell) => cell.release_blocking && cell.qualification_status !== "qualified",
  );
  return {
    matrix_id: "live-e2e.provider-qualification-matrix.v1",
    scope: asNonEmptyString(options.scope) || "optional-provider-qualification",
    statuses: PROVIDER_QUALIFICATION_STATUSES,
    failure_owners: FAILURE_OWNERS,
    failure_phases: FAILURE_PHASES,
    provider_cells: providerCells,
    release_blocking_provider_ids: [...releaseBlockingProviderIds],
    release_blocking_failures: releaseBlockingFailures.map((cell) => ({
      provider_variant_id: cell.provider_variant_id,
      qualification_status: cell.qualification_status,
      failure_owner: cell.failure_owner,
      failure_phase: cell.failure_phase,
    })),
    release_blocking_status: releaseBlockingFailures.length === 0 ? "pass" : "blocked",
    generated_at: asNonEmptyString(options.generatedAt) || nowIso(),
  };
}
