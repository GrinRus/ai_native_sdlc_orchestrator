import {
  createAdapterResponseEnvelope,
  createLiveAdapter,
  createMockAdapter,
} from "../../adapter-sdk/src/index.mjs";

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function asRecord(value) {
  return typeof value === "object" && value !== null ? /** @type {Record<string, unknown>} */ (value) : {};
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function asString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
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
 * @param {Record<string, unknown> | null} adapterResolution
 * @returns {string}
 */
function resolveSelectedAdapterId(adapterResolution) {
  return typeof (/** @type {any} */ (adapterResolution))?.adapter?.adapter_id === "string"
    ? /** @type {any} */ (adapterResolution).adapter.adapter_id
    : "none";
}

/**
 * @param {string | null} failureKind
 * @returns {string}
 */
function resolveAdapterFailureNextStep(failureKind) {
  if (failureKind === "missing-command" || failureKind === "missing-live-runtime") {
    return "Install/configure external runner prerequisites for the selected adapter or use '--routed-dry-run-step'.";
  }
  if (failureKind === "auth-failed") {
    return "Authenticate the selected external runner CLI in the current runner auth mode, then retry live execution.";
  }
  if (failureKind === "permission-mode-blocked") {
    return "Adjust external runner permission mode or run policy, then retry live execution.";
  }
  return "Inspect adapter response evidence/tool traces, fix external runner execution, then retry live execution.";
}

function canonicalFailureClass(failureKind) {
  if (failureKind === "external-runner-timeout") return "provider-timeout";
  if (failureKind === "rate-limit") return "rate-limit";
  if (failureKind === "external-runner-failed" || failureKind === "runner-crash") return "runner-crash";
  if (failureKind === "auth-failed") return "auth-failure";
  return failureKind ?? "runtime-failed";
}

function withRouteAttemptEvidence(response, attempts, transitions, fallbackExhausted) {
  const output = asRecord(response.output);
  return {
    ...response,
    output: {
      ...output,
      route_attempts: attempts,
      fallback_transitions: transitions,
      fallback_exhausted: fallbackExhausted,
    },
  };
}

/**
 * @param {{
 *   dryRun: boolean,
 *   requestedStepClass: string,
 *   adapterResolution: Record<string, unknown> | null,
 *   adapterRequest: Record<string, unknown>,
 *   deliveryPlan: Record<string, unknown> | null,
 *   runtimeEvidenceRoot: string,
 *   projectRoot: string,
 *   executionRoot: string,
 * }} options
 * @returns {{
 *   adapterResponse: Record<string, unknown>,
 *   status: "passed" | "failed",
 *   summary: string,
 *   blockedNextStep: string | null,
 * }}
 */
export function invokeStepAdapterForStep(options) {
  const selectedAdapterId = resolveSelectedAdapterId(options.adapterResolution);

  if (options.dryRun) {
    const mockAdapter = createMockAdapter();
    return {
      adapterResponse: mockAdapter.execute(/** @type {any} */ (options.adapterRequest)),
      status: "passed",
      summary: `Routed dry-run for step '${options.requestedStepClass}' completed with selected adapter '${selectedAdapterId}' and mock execution.`,
      blockedNextStep: null,
    };
  }

  const plan = asRecord(options.deliveryPlan);
  const planReady = plan.status === "ready" && plan.execution_allowed === true;
  const blockingReasons = asStringArray(plan.blocking_reasons);

  if (!planReady) {
    const summary =
      blockingReasons.length > 0
        ? `Routed live execution blocked by delivery guardrails: ${blockingReasons.join(", ")}.`
        : `Routed live execution blocked for step '${options.requestedStepClass}': delivery plan is not ready.`;
    return {
      status: "failed",
      summary,
      blockedNextStep:
        "Provide approved handoff and promotion evidence (or use '--routed-dry-run-step') before live execution.",
      adapterResponse: createAdapterResponseEnvelope({
        request_id: String(options.adapterRequest.request_id),
        adapter_id: selectedAdapterId,
        status: "blocked",
        summary,
        output: {
          mode: "execute",
          blocked: true,
          blocking_reasons: blockingReasons,
          delivery_plan_status: asString(plan.status) ?? "unknown",
        },
      }),
    };
  }

  try {
    const resolution = asRecord(options.adapterResolution);
    const configuredCandidates = Array.isArray(resolution.execution_candidates)
      ? resolution.execution_candidates.map((candidate) => asRecord(candidate))
      : [];
    const candidates = configuredCandidates.length > 0
      ? configuredCandidates
      : [{
          candidate_index: 0,
          kind: "primary",
          adapter_id: selectedAdapterId,
          provider: null,
          requested_model: null,
          effective_model: null,
          model_source: "not-applicable",
          profile: asRecord(asRecord(resolution.adapter).profile),
        }];
    const policyProfile = asRecord(asRecord(asRecord(options.adapterRequest.policy_bundle).policy).profile);
    const retryOn = asStringArray(asRecord(policyProfile.retry).on);
    const attempts = [];
    const transitions = [];
    let adapterResponse = null;
    let attemptedFallback = false;

    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      const adapterId = asString(candidate.adapter_id) ?? "none";
      const route = {
        ...asRecord(options.adapterRequest.route),
        active_candidate_index: candidate.candidate_index,
        active_candidate_kind: asString(candidate.kind),
        active_provider: asString(candidate.provider),
        requested_model: asString(candidate.requested_model),
        effective_model: asString(candidate.effective_model),
        model_source: asString(candidate.model_source) ?? "not-applicable",
      };
      const liveAdapter = createLiveAdapter({
        adapterId,
        adapterProfile: asRecord(candidate.profile),
        runtimeEvidenceRoot: options.runtimeEvidenceRoot,
        projectRoot: options.projectRoot,
        executionRoot: options.executionRoot,
      });
      adapterResponse = liveAdapter.execute(/** @type {any} */ ({ ...options.adapterRequest, route }));
      const output = asRecord(adapterResponse.output);
      const failureKind = asString(output.failure_kind);
      const failureClass = adapterResponse.status === "success" ? "none" : canonicalFailureClass(failureKind);
      attempts.push({
        attempt: index + 1,
        candidate_index: candidate.candidate_index,
        candidate_kind: asString(candidate.kind),
        provider: asString(candidate.provider),
        adapter: adapterId,
        requested_model: asString(candidate.requested_model),
        effective_model: asString(candidate.effective_model),
        model_source: asString(candidate.model_source),
        status: adapterResponse.status,
        failure_kind: failureKind,
        failure_class: failureClass,
        evidence_refs: asStringArray(adapterResponse.evidence_refs),
      });
      if (adapterResponse.status === "success") break;
      const next = candidates[index + 1];
      if (!next || !retryOn.includes(failureClass)) break;
      attemptedFallback = true;
      transitions.push({
        from_candidate_index: candidate.candidate_index,
        to_candidate_index: next.candidate_index,
        failure_class: failureClass,
        policy_ref: asString(asRecord(options.adapterRequest.route).route_profile?.retry_policy_ref)
          ?? asString(asRecord(options.adapterRequest.route).retry_policy_ref),
        decision: "fallback",
      });
    }

    if (!adapterResponse) throw new Error("Adapter negotiation produced no executable candidate.");
    const finalOutput = asRecord(adapterResponse.output);
    const finalFailureKind = asString(finalOutput.failure_kind);
    const fallbackExhausted = attemptedFallback && adapterResponse.status !== "success";
    adapterResponse = withRouteAttemptEvidence(adapterResponse, attempts, transitions, fallbackExhausted);
    if (adapterResponse.status === "success") {
      const finalAttempt = attempts[attempts.length - 1];
      return {
        adapterResponse,
        status: "passed",
        summary: `Routed live execution for step '${options.requestedStepClass}' completed with adapter '${String(finalAttempt.adapter)}'.`,
        blockedNextStep: null,
      };
    }
    return {
      adapterResponse,
      status: "failed",
      summary:
        asString(adapterResponse.summary) ??
        `Routed live execution for step '${options.requestedStepClass}' completed.`,
      blockedNextStep: fallbackExhausted
        ? "Inspect exhausted primary/fallback route evidence and select a compatible approved route."
        : resolveAdapterFailureNextStep(finalFailureKind),
    };
  } catch (error) {
    const summary = error instanceof Error ? error.message : String(error);
    return {
      status: "failed",
      summary,
      blockedNextStep: "Select a supported live adapter or use '--routed-dry-run-step'.",
      adapterResponse: createAdapterResponseEnvelope({
        request_id: String(options.adapterRequest.request_id),
        adapter_id: selectedAdapterId,
        status: "blocked",
        summary,
        output: {
          mode: "execute",
          blocked: true,
          failure_kind: "adapter-not-supported",
        },
      }),
    };
  }
}
