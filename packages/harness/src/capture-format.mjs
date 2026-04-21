/**
 * @param {Record<string, unknown>} stepResult
 */
export function extractHarnessCompatibility(stepResult) {
  const routedExecution = /** @type {Record<string, unknown>} */ (stepResult.routed_execution ?? {});
  const routeResolution = /** @type {Record<string, unknown>} */ (routedExecution.route_resolution ?? {});
  const assetResolution = /** @type {Record<string, unknown>} */ (routedExecution.asset_resolution ?? {});
  const wrapperResolution = /** @type {Record<string, unknown>} */ (assetResolution.wrapper ?? {});
  const promptResolution = /** @type {Record<string, unknown>} */ (assetResolution.prompt_bundle ?? {});
  const policyResolution = /** @type {Record<string, unknown>} */ (routedExecution.policy_resolution ?? {});
  const policy = /** @type {Record<string, unknown>} */ (policyResolution.policy ?? {});
  const adapterResolution = /** @type {Record<string, unknown>} */ (routedExecution.adapter_resolution ?? {});
  const adapter = /** @type {Record<string, unknown>} */ (adapterResolution.adapter ?? {});

  return {
    step_class: typeof routeResolution.step_class === "string" ? routeResolution.step_class : null,
    route_id: typeof routeResolution.resolved_route_id === "string" ? routeResolution.resolved_route_id : null,
    wrapper_ref: typeof wrapperResolution.wrapper_ref === "string" ? wrapperResolution.wrapper_ref : null,
    prompt_bundle_ref:
      typeof promptResolution.prompt_bundle_ref === "string" ? promptResolution.prompt_bundle_ref : null,
    policy_id: typeof policy.policy_id === "string" ? policy.policy_id : null,
    adapter_id: typeof adapter.adapter_id === "string" ? adapter.adapter_id : null,
  };
}

/**
 * @param {{
 *   captureId: string,
 *   projectProfileRef: string,
 *   stepResultRef: string,
 *   evaluationReportRef: string,
 *   stepResult: Record<string, unknown>,
 *   evaluationReport: Record<string, unknown>,
 *   createdAt?: string,
 * }} options
 */
export function createHarnessCapture(options) {
  const compatibility = extractHarnessCompatibility(options.stepResult);
  const routedExecution = /** @type {Record<string, unknown>} */ (options.stepResult.routed_execution ?? {});
  const adapterResponse = /** @type {Record<string, unknown>} */ (routedExecution.adapter_response ?? {});

  return {
    capture_id: options.captureId,
    schema_version: 1,
    captured_at: options.createdAt ?? new Date().toISOString(),
    capture_kind: "harness-step-execution",
    project_profile_ref: options.projectProfileRef,
    subject_ref: options.evaluationReport.subject_ref,
    suite_ref: options.evaluationReport.suite_ref,
    dataset_ref: options.evaluationReport.dataset_ref,
    source_refs: {
      step_result_ref: options.stepResultRef,
      evaluation_report_ref: options.evaluationReportRef,
    },
    compatibility,
    trace: {
      step_input: routedExecution.adapter_request ?? null,
      selected_assets: {
        route_resolution: routedExecution.route_resolution ?? null,
        asset_resolution: routedExecution.asset_resolution ?? null,
        policy_resolution: routedExecution.policy_resolution ?? null,
        adapter_resolution: routedExecution.adapter_resolution ?? null,
      },
      tool_activity: Array.isArray(adapterResponse.tool_trace) ? adapterResponse.tool_trace : [],
      normalized_output: routedExecution.adapter_response ?? null,
    },
    scoring_snapshot: {
      status: options.evaluationReport.status,
      scorer_metadata: options.evaluationReport.scorer_metadata ?? [],
      grader_results: options.evaluationReport.grader_results ?? {},
      summary_metrics: options.evaluationReport.summary_metrics ?? {},
    },
    evidence_refs: [options.stepResultRef, options.evaluationReportRef],
  };
}

/**
 * @param {{ capture: Record<string, unknown>, currentStepResult: Record<string, unknown> }} options
 */
export function compareHarnessCompatibility(options) {
  const capturedCompatibility = /** @type {Record<string, unknown>} */ (options.capture.compatibility ?? {});
  const currentCompatibility = extractHarnessCompatibility(options.currentStepResult);
  const fields = [
    "step_class",
    "route_id",
    "wrapper_ref",
    "prompt_bundle_ref",
    "policy_id",
    "adapter_id",
  ];

  const mismatches = fields
    .map((field) => {
      const expected = capturedCompatibility[field];
      const actual = currentCompatibility[field];
      if (expected === actual) {
        return null;
      }
      return {
        field,
        expected: expected ?? null,
        actual: actual ?? null,
      };
    })
    .filter((entry) => entry !== null);

  return {
    compatible: mismatches.length === 0,
    mismatches,
    expected: capturedCompatibility,
    actual: currentCompatibility,
  };
}
