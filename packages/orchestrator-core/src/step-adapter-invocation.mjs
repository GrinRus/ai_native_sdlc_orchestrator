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
    const liveAdapter = createLiveAdapter({
      adapterId: selectedAdapterId,
      adapterProfile: asRecord(asRecord(/** @type {any} */ (options.adapterResolution).adapter).profile),
      runtimeEvidenceRoot: options.runtimeEvidenceRoot,
      projectRoot: options.projectRoot,
      executionRoot: options.executionRoot,
    });
    const adapterResponse = liveAdapter.execute(/** @type {any} */ (options.adapterRequest));
    if (adapterResponse.status === "success") {
      return {
        adapterResponse,
        status: "passed",
        summary: `Routed live execution for step '${options.requestedStepClass}' completed with adapter '${selectedAdapterId}'.`,
        blockedNextStep: null,
      };
    }

    const adapterOutput = asRecord(adapterResponse.output);
    const failureKind = asString(adapterOutput.failure_kind);
    return {
      adapterResponse,
      status: "failed",
      summary:
        asString(adapterResponse.summary) ??
        `Routed live execution for step '${options.requestedStepClass}' completed.`,
      blockedNextStep: resolveAdapterFailureNextStep(failureKind),
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
