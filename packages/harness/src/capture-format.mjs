import { createHash } from "node:crypto";

function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object" && value !== null) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function digest(value) {
  return `sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}`;
}

export function extractHarnessCompatibility(stepResult, evaluationReport = null) {
  const routedExecution = asRecord(stepResult.routed_execution);
  const routeResolution = asRecord(routedExecution.route_resolution);
  const assetResolution = asRecord(routedExecution.asset_resolution);
  const wrapperResolution = asRecord(assetResolution.wrapper);
  const promptResolution = asRecord(assetResolution.prompt_bundle);
  const policyResolution = asRecord(routedExecution.policy_resolution);
  const policy = asRecord(policyResolution.policy);
  const adapterResolution = asRecord(routedExecution.adapter_resolution);
  const adapter = asRecord(adapterResolution.adapter);
  const contextCompilation = asRecord(routedExecution.context_compilation);
  const compiledArtifact = asRecord(contextCompilation.compiled_context_artifact);
  const contextDiagnostics = asRecord(contextCompilation.diagnostics);
  const report = asRecord(evaluationReport);
  const subjectSnapshot = asRecord(report.subject_snapshot);
  const caseResolution = Array.isArray(report.case_resolution) ? report.case_resolution : [];
  const adapterResponse = asRecord(routedExecution.adapter_response);
  const adapterOutput = asRecord(adapterResponse.output);
  const routeAttempts = Array.isArray(adapterOutput.route_attempts) ? adapterOutput.route_attempts : [];
  const invocation = routeAttempts.map((entry) => {
    const attempt = asRecord(entry);
    return {
      provider: attempt.provider ?? null,
      adapter_id: attempt.adapter_id ?? null,
      requested_model: attempt.requested_model ?? null,
      effective_model: attempt.effective_model ?? null,
      model_source: attempt.model_source ?? null,
      status: attempt.status ?? null,
      failure_kind: attempt.failure_kind ?? null,
    };
  });
  return {
    step_class: typeof routeResolution.step_class === "string" ? routeResolution.step_class : null,
    route_id: typeof routeResolution.resolved_route_id === "string" ? routeResolution.resolved_route_id : null,
    route_digest: digest(routeResolution),
    wrapper_ref: typeof wrapperResolution.wrapper_ref === "string" ? wrapperResolution.wrapper_ref : null,
    prompt_bundle_ref: typeof promptResolution.prompt_bundle_ref === "string" ? promptResolution.prompt_bundle_ref : null,
    policy_id: typeof policy.policy_id === "string" ? policy.policy_id : null,
    policy_digest: digest(policyResolution),
    adapter_id: typeof adapter.adapter_id === "string" ? adapter.adapter_id : null,
    adapter_digest: digest(adapterResolution),
    effective_model: typeof routeResolution.effective_model === "string" ? routeResolution.effective_model : null,
    invocation_digest: digest(invocation.length > 0 ? invocation : { adapter_id: adapter.adapter_id ?? null, effective_model: routeResolution.effective_model ?? null }),
    compiled_context_fingerprint: typeof compiledArtifact.fingerprint === "string" ? compiledArtifact.fingerprint : typeof contextDiagnostics.compiled_context_fingerprint === "string" ? contextDiagnostics.compiled_context_fingerprint : null,
    compiler_revision: compiledArtifact.compiler_revision ?? contextCompilation.compiler_revision ?? null,
    subject_digest: typeof subjectSnapshot.digest === "string" ? subjectSnapshot.digest : null,
    suite_digest: report.suite_ref ? digest({ suite_ref: report.suite_ref, suite_version: asRecord(report.summary_metrics).suite_version }) : null,
    dataset_digest: report.dataset_ref ? digest({ dataset_ref: report.dataset_ref, cases: caseResolution }) : null,
    case_digests: caseResolution.map((entry) => ({ case_id: entry.case_id, input_digest: entry.input_digest, expected_digest: entry.expected_digest })),
    environment: { platform: process.platform, arch: process.arch, node_major: Number(process.versions.node.split(".")[0]), node_version: process.versions.node },
  };
}

export function createHarnessCapture(options) {
  const compatibility = extractHarnessCompatibility(options.stepResult, options.evaluationReport);
  const routedExecution = asRecord(options.stepResult.routed_execution);
  const adapterResponse = asRecord(routedExecution.adapter_response);
  return {
    capture_id: options.captureId,
    schema_version: 2,
    captured_at: options.createdAt ?? new Date().toISOString(),
    capture_kind: "harness-step-execution",
    project_profile_ref: options.projectProfileRef,
    subject_ref: options.evaluationReport.subject_ref,
    suite_ref: options.evaluationReport.suite_ref,
    dataset_ref: options.evaluationReport.dataset_ref,
    source_refs: { step_result_ref: options.stepResultRef, evaluation_report_ref: options.evaluationReportRef },
    compatibility,
    trace: {
      step_input: routedExecution.adapter_request ?? null,
      selected_assets: { route_resolution: routedExecution.route_resolution ?? null, asset_resolution: routedExecution.asset_resolution ?? null, policy_resolution: routedExecution.policy_resolution ?? null, adapter_resolution: routedExecution.adapter_resolution ?? null },
      tool_activity: Array.isArray(adapterResponse.tool_trace) ? adapterResponse.tool_trace : [],
      normalized_output: routedExecution.adapter_response ?? null,
    },
    scoring_snapshot: { status: options.evaluationReport.status, scorer_metadata: options.evaluationReport.scorer_metadata ?? [], grader_results: options.evaluationReport.grader_results ?? {}, summary_metrics: options.evaluationReport.summary_metrics ?? {}, subject_snapshot: options.evaluationReport.subject_snapshot ?? null, case_resolution: options.evaluationReport.case_resolution ?? [] },
    evidence_refs: [options.stepResultRef, options.evaluationReportRef],
  };
}

export function compareHarnessCompatibility(options) {
  const schemaVersion = Number(options.capture.schema_version ?? 1);
  const captured = asRecord(options.capture.compatibility);
  const current = extractHarnessCompatibility(options.currentStepResult, options.currentEvaluationReport ?? null);
  if (schemaVersion !== 2) {
    return { compatible: false, mismatches: [{ field: "schema_version", expected: 2, actual: schemaVersion, reason: "legacy_capture_requires_refresh" }], expected: captured, actual: current };
  }
  const fields = ["step_class", "route_id", "route_digest", "wrapper_ref", "prompt_bundle_ref", "policy_id", "policy_digest", "adapter_id", "adapter_digest", "effective_model", "invocation_digest", "compiled_context_fingerprint", "compiler_revision"];
  if (options.currentEvaluationReport) fields.push("subject_digest", "suite_digest", "dataset_digest", "case_digests");
  const mismatches = [];
  for (const field of fields) {
    if (stableJson(captured[field] ?? null) !== stableJson(current[field] ?? null)) mismatches.push({ field, expected: captured[field] ?? null, actual: current[field] ?? null });
  }
  const expectedEnvironment = asRecord(captured.environment);
  const actualEnvironment = asRecord(current.environment);
  for (const field of ["platform", "arch", "node_major"]) {
    if (expectedEnvironment[field] !== actualEnvironment[field]) mismatches.push({ field: `environment.${field}`, expected: expectedEnvironment[field] ?? null, actual: actualEnvironment[field] ?? null });
  }
  return { compatible: mismatches.length === 0, mismatches, expected: captured, actual: current };
}
