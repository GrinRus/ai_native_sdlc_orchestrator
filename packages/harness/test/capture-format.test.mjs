import assert from "node:assert/strict";
import test from "node:test";

import {
  compareHarnessCompatibility,
  createHarnessCapture,
  extractHarnessCompatibility,
} from "../src/capture-format.mjs";

function fixtureStepResult() {
  return {
    step_result_id: "step-result-001",
    routed_execution: {
      route_resolution: {
        step_class: "implement",
        resolved_route_id: "route.implement.default",
      },
      asset_resolution: {
        wrapper: { wrapper_ref: "wrapper.runner.default@v3" },
        prompt_bundle: { prompt_bundle_ref: "prompt-bundle://prompt.runner.default@v2" },
      },
      policy_resolution: {
        policy: { policy_id: "policy.step.runner.default" },
      },
      adapter_resolution: {
        adapter: { adapter_id: "codex-cli" },
      },
      adapter_request: {
        request_id: "request-001",
      },
      adapter_response: {
        output_ref: "evidence://step-result/output.json",
        tool_trace: [{ tool: "bash", command: "pnpm test" }],
      },
    },
  };
}

function fixtureEvaluationReport() {
  return {
    subject_ref: "run://candidate-a",
    suite_ref: "suite.release.core@v1",
    dataset_ref: "dataset://run-regression@2026-04-20T08:00:00Z",
    status: "pass",
    scorer_metadata: [{ scorer_id: "deterministic", scorer_mode: "deterministic" }],
    grader_results: { deterministic: { status: "pass" } },
    summary_metrics: { aggregate_pass_rate: 1 },
  };
}

test("createHarnessCapture records step input, assets, tool activity, and normalized output", () => {
  const capture = createHarnessCapture({
    captureId: "capture-001",
    projectProfileRef: "examples/project.aor.yaml",
    stepResultRef: "runtime://step-result-001",
    evaluationReportRef: "runtime://evaluation-report-001",
    stepResult: fixtureStepResult(),
    evaluationReport: fixtureEvaluationReport(),
    createdAt: "2026-04-21T00:00:00.000Z",
  });

  assert.equal(capture.capture_id, "capture-001");
  assert.equal(capture.schema_version, 1);
  assert.equal(capture.compatibility.route_id, "route.implement.default");
  assert.equal(capture.trace.step_input.request_id, "request-001");
  assert.equal(capture.trace.selected_assets.asset_resolution.wrapper.wrapper_ref, "wrapper.runner.default@v3");
  assert.equal(capture.trace.tool_activity.length, 1);
  assert.equal(capture.trace.normalized_output.output_ref, "evidence://step-result/output.json");
  assert.equal(capture.scoring_snapshot.summary_metrics.aggregate_pass_rate, 1);
});

test("compareHarnessCompatibility passes when runtime assets match capture metadata", () => {
  const stepResult = fixtureStepResult();
  const capture = {
    compatibility: extractHarnessCompatibility(stepResult),
  };

  const comparison = compareHarnessCompatibility({
    capture,
    currentStepResult: stepResult,
  });

  assert.equal(comparison.compatible, true);
  assert.equal(comparison.mismatches.length, 0);
});

test("compareHarnessCompatibility reports explicit mismatch when runtime assets drift", () => {
  const stepResult = fixtureStepResult();
  const driftedStepResult = fixtureStepResult();
  driftedStepResult.routed_execution.asset_resolution.wrapper.wrapper_ref = "wrapper.runner.experimental@v99";

  const capture = {
    compatibility: extractHarnessCompatibility(stepResult),
  };
  const comparison = compareHarnessCompatibility({
    capture,
    currentStepResult: driftedStepResult,
  });

  assert.equal(comparison.compatible, false);
  assert.ok(comparison.mismatches.some((entry) => entry.field === "wrapper_ref"));
});
