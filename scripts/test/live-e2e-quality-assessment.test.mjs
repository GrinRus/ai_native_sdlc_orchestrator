import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const scriptPath = path.join(repoRoot, "scripts", "live-e2e", "quality-assessment.mjs");

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "aor-live-e2e-quality-assessment-"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function touch(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, "{}\n", "utf8");
  return filePath;
}

function runQualityAssessment(args) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

const requiredDimensions = Object.freeze([
  "artifact_content_quality",
  "implementation_correctness",
  "implementation_completeness",
  "code_maintainability",
  "test_adequacy",
  "security_review",
  "performance_regression_risk",
  "verification_quality",
  "delivery_safety",
  "aor_operator_ui_ux_quality",
  "aor_operator_accessibility_quality",
  "evidence_strength",
  "acceptance_criteria_traceability",
]);

const aorOperatorUiSubdimensions = Object.freeze([
  "task_success",
  "flow_navigation_clarity",
  "next_action_clarity",
  "blocker_and_error_understandability",
  "recovery_affordance",
  "state_feedback_loading_empty_error",
  "visual_stability_responsiveness",
  "raw_json_independence",
]);

const aorOperatorAccessibilitySubdimensions = Object.freeze([
  "keyboard_navigation",
  "focus_order",
  "contrast_and_readability",
  "semantic_structure",
  "screen_reader_labels",
  "accessible_error_feedback",
]);

function buildUiSubdimensions(keys, evidenceFile, category) {
  return Object.fromEntries(
    keys.map((key) => [
      key,
      {
        status: "pass",
        evidence_strength: "strong",
        evidence_refs: [evidenceFile],
        findings: [
          {
            category,
            severity: "low",
            summary: `${key} was inspected through AOR operator UI evidence.`,
            evidence_refs: [evidenceFile],
          },
        ],
      },
    ]),
  );
}

function buildAssessmentReport(options) {
  const dimensions = Object.fromEntries(
    requiredDimensions.map((dimension) => [
      dimension,
      {
        status: "pass",
        evidence_strength: "strong",
        inspected_evidence_refs: [options.evidenceFile],
        findings: [],
        recommended_followups: [],
      },
    ]),
  );
  dimensions.aor_operator_ui_ux_quality.subdimensions = buildUiSubdimensions(
    aorOperatorUiSubdimensions,
    options.evidenceFile,
    "ui-ux",
  );
  dimensions.aor_operator_accessibility_quality.subdimensions = buildUiSubdimensions(
    aorOperatorAccessibilitySubdimensions,
    options.evidenceFile,
    "accessibility",
  );
  if (options.allPass !== true) {
    dimensions.security_review = {
      status: "not_evaluated",
      evidence_strength: "missing",
      inspected_evidence_refs: [],
      findings: [
        {
          category: "security",
          severity: "medium",
          summary: "No dedicated security evidence was produced.",
          evidence_refs: [],
        },
      ],
      recommended_followups: ["Run a dedicated security inspection when security-sensitive changes exist."],
    };
  }
  return {
    assessment_id: "live-e2e.test.quality-assessment.v1",
    run_id: "live-e2e.test.run",
    profile_id: "live-e2e.full-journey.test",
    generated_at: "2026-06-13T00:00:00.000Z",
    evaluator: {
      kind: "swe-agent",
      ref: "skill://live-e2e-runner",
      mode: "post-run-freeform",
    },
    source_run_summary_file: options.summaryFile,
    source_observation_report_file: options.observationFile,
    source_run_health_report_file: options.runHealthFile,
    assessment_request_file: options.requestFile,
    overall_status: options.allPass === true ? "pass" : "warn",
    dimensions,
    gap_report: {
      not_evaluated_dimensions: options.allPass === true ? [] : ["security_review"],
      weak_signal_dimensions: [],
      strong_evidence_dimensions: options.allPass === true
        ? requiredDimensions
        : requiredDimensions.filter((dimension) => dimension !== "security_review"),
    },
    findings: options.allPass === true
      ? []
      : [
          {
            category: "evidence-gap",
            severity: "medium",
            summary: "Security was not evaluated because no direct evidence was available.",
            evidence_refs: [options.requestFile],
          },
        ],
    recommended_followups: options.allPass === true
      ? []
      : ["Attach security evidence when the change touches sensitive surfaces."],
    evidence_refs: [options.summaryFile, options.observationFile, options.runHealthFile, options.requestFile],
  };
}

test("quality assessment prepare builds a SWE assessment request from full flow evidence", () => {
  const tempRoot = makeTempRoot();
  const reportsRoot = path.join(tempRoot, "reports");
  const observationFile = path.join(reportsRoot, "live-e2e-observation-report-live-e2e.test.run.json");
  const runHealthFile = path.join(reportsRoot, "live-e2e-run-health-report-live-e2e.test.run.json");
  const reviewFile = touch(path.join(reportsRoot, "review-report-live-e2e.test.run.json"));
  const verifyFile = touch(path.join(reportsRoot, "post-run-verify-summary-live-e2e.test.run.json"));
  const diagnosticVerifyFile = touch(path.join(reportsRoot, "post-run-diagnostic-verify-summary-live-e2e.test.run.json"));
  const diagnosticStepResultFile = touch(path.join(reportsRoot, "step-result-post-run-diagnostic-live-e2e.test.run.json"));
  const browserProofFile = touch(path.join(reportsRoot, "browser-task-proof-live-e2e.test.run.json"));
  const featureRequestFile = touch(path.join(reportsRoot, "feature-request-live-e2e.test.run.json"));
  const intakeArtifactPacketFile = touch(path.join(reportsRoot, "intake-artifact-packet-live-e2e.test.run.json"));
  const specStepResultFile = touch(path.join(reportsRoot, "step-result-spec-live-e2e.test.run.json"));
  const handoffPacketFile = touch(path.join(reportsRoot, "handoff-packet-live-e2e.test.run.json"));
  const executionReadinessFile = touch(path.join(reportsRoot, "live-e2e-execution-readiness-live-e2e.test.run.json"));
  const summaryFile = path.join(reportsRoot, "live-e2e-run-summary-live-e2e.test.run.json");
  writeJson(observationFile, {
    overall_status: "pass",
    report_status: "final",
    frontend_interactions: [
      {
        interaction_id: "guided-web-smoke",
        evidence_refs: [browserProofFile],
        screenshot_refs: [],
      },
    ],
  });
  writeJson(runHealthFile, {
    overall_status: "pass",
    evidence_refs: [observationFile],
  });
  writeJson(summaryFile, {
    run_id: "live-e2e.test.run",
    profile_id: "live-e2e.full-journey.test",
    target_catalog_id: "target.nextjs",
    feature_mission_id: "mission.ui",
    scenario_family: "regress",
    provider_variant_id: "openai-primary",
    feature_size: "medium",
    live_e2e_observation_report_file: observationFile,
    live_e2e_observation_overall_status: "pass",
    live_e2e_run_health_report_file: runHealthFile,
    review_report_file: reviewFile,
    post_run_verify_summary_file: verifyFile,
    post_run_diagnostic_verify_summary_file: diagnosticVerifyFile,
    post_run_diagnostic_verify_step_result_files: [diagnosticStepResultFile],
    guided_browser_task_proof_file: browserProofFile,
    feature_request_file: featureRequestFile,
    intake_artifact_packet_file: intakeArtifactPacketFile,
    spec_step_result_file: specStepResultFile,
    approved_handoff_packet_file: handoffPacketFile,
    execution_readiness_file: executionReadinessFile,
  });

  const result = runQualityAssessment(["prepare", "--run-summary-file", summaryFile]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "ok");
  assert.equal(fs.existsSync(output.assessment_request_file), true);
  const request = JSON.parse(fs.readFileSync(output.assessment_request_file, "utf8"));
  assert.deepEqual(request.required_dimensions, requiredDimensions);
  assert.equal(request.evaluator.kind, "swe-agent");
  assert.equal(request.run_identity.run_health_status, "pass");
  assert.ok(request.dimension_rubric.artifact_content_quality.includes("KPI/DoD traceability"));
  assert.ok(request.dimension_rubric.code_maintainability.includes("architecture boundary fit"));
  assert.ok(request.dimension_rubric.aor_operator_ui_ux_quality.includes("AOR installed-user task success"));
  assert.ok(request.dimension_rubric.aor_operator_ui_ux_subdimensions.includes("raw_json_independence"));
  assert.equal(JSON.stringify(request.dimension_rubric).includes(["target", "product", "UI"].join(" ")), false);
  assert.ok(request.evidence_refs.review_eval_harness.includes(reviewFile));
  assert.ok(request.evidence_refs.aor_operator_ui.includes(browserProofFile));
  assert.ok(request.evidence_refs.review_eval_harness.includes(diagnosticVerifyFile));
  assert.ok(request.evidence_refs.review_eval_harness.includes(diagnosticStepResultFile));
  assert.ok(
    request.quality_report_requirements.some((entry) =>
      /aor_operator_accessibility_quality requires browser-task proof/u.test(entry),
    ),
  );
  assert.ok(request.evidence_refs.acceptance_kpi_dod.includes(featureRequestFile));
  assert.ok(request.evidence_refs.acceptance_kpi_dod.includes(intakeArtifactPacketFile));
  assert.ok(request.evidence_refs.acceptance_kpi_dod.includes(specStepResultFile));
  assert.ok(request.evidence_refs.acceptance_kpi_dod.includes(handoffPacketFile));
  assert.ok(request.evidence_refs.acceptance_kpi_dod.includes(executionReadinessFile));
});

test("quality assessment prepare backfills acceptance evidence from nested summary refs", () => {
  const tempRoot = makeTempRoot();
  const reportsRoot = path.join(tempRoot, "reports");
  const observationFile = path.join(reportsRoot, "live-e2e-observation-report-live-e2e.test.run.json");
  const runHealthFile = path.join(reportsRoot, "live-e2e-run-health-report-live-e2e.test.run.json");
  const nestedFeatureRequestFile = touch(path.join(reportsRoot, "feature-request-live-e2e.test.run.json"));
  const nestedHandoffFile = touch(path.join(reportsRoot, "handoff-packet-live-e2e.test.run.json"));
  const summaryFile = path.join(reportsRoot, "live-e2e-run-summary-live-e2e.test.run.json");
  writeJson(observationFile, {
    overall_status: "pass",
    report_status: "final",
  });
  writeJson(runHealthFile, {
    overall_status: "pass",
    evidence_refs: [observationFile],
  });
  writeJson(summaryFile, {
    run_id: "live-e2e.test.run",
    profile_id: "live-e2e.full-journey.test",
    live_e2e_observation_report_file: observationFile,
    live_e2e_observation_overall_status: "pass",
    live_e2e_run_health_report_file: runHealthFile,
    artifacts: {
      feature_request_file: nestedFeatureRequestFile,
      approved_handoff_packet_file: nestedHandoffFile,
    },
  });

  const result = runQualityAssessment(["prepare", "--run-summary-file", summaryFile]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  const request = JSON.parse(fs.readFileSync(output.assessment_request_file, "utf8"));
  assert.ok(request.evidence_refs.acceptance_kpi_dod.includes(nestedFeatureRequestFile));
  assert.ok(request.evidence_refs.acceptance_kpi_dod.includes(nestedHandoffFile));
});

test("quality assessment prepare rejects incomplete context-budget blocked runs", () => {
  const tempRoot = makeTempRoot();
  const reportsRoot = path.join(tempRoot, "reports");
  const observationFile = path.join(reportsRoot, "live-e2e-observation-report-live-e2e.test.run.json");
  const runHealthFile = path.join(reportsRoot, "live-e2e-run-health-report-live-e2e.test.run.json");
  const summaryFile = path.join(reportsRoot, "live-e2e-run-summary-live-e2e.test.run.json");
  writeJson(observationFile, {
    overall_status: "blocked",
    report_status: "final",
  });
  writeJson(runHealthFile, {
    overall_status: "blocked",
    provider_health: {
      context_budget_status: "fail",
      context_budget_failure_class: "compiled_context_budget_exceeded",
    },
    failure_summary: {
      owner: "aor",
      phase: "provider_execution",
      class: "compiled_context_budget_exceeded",
      summary: "Provider work packet exceeded the deterministic context budget.",
    },
    evidence_refs: [observationFile],
  });
  writeJson(summaryFile, {
    run_id: "live-e2e.test.run",
    profile_id: "live-e2e.full-journey.test",
    live_e2e_observation_report_file: observationFile,
    live_e2e_observation_overall_status: "blocked",
    live_e2e_run_health_report_file: runHealthFile,
    live_e2e_run_health_overall_status: "blocked",
    context_budget_failure_class: "compiled_context_budget_exceeded",
  });

  const result = runQualityAssessment(["prepare", "--run-summary-file", summaryFile]);
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /completed full flow/u);
  assert.match(result.stderr, /compiled_context_budget_exceeded/u);
  assert.equal(
    fs.existsSync(path.join(reportsRoot, "live-e2e-quality-assessment-request-live-e2e.test.run.json")),
    false,
  );
});

test("quality assessment validate accepts structured free-form SWE assessment", () => {
  const tempRoot = makeTempRoot();
  const reportsRoot = path.join(tempRoot, "reports");
  const evidenceFile = touch(path.join(reportsRoot, "review-report-live-e2e.test.run.json"));
  const summaryFile = touch(path.join(reportsRoot, "live-e2e-run-summary-live-e2e.test.run.json"));
  const observationFile = touch(path.join(reportsRoot, "live-e2e-observation-report-live-e2e.test.run.json"));
  const runHealthFile = touch(path.join(reportsRoot, "live-e2e-run-health-report-live-e2e.test.run.json"));
  const requestFile = touch(path.join(reportsRoot, "live-e2e-quality-assessment-request-live-e2e.test.run.json"));
  const assessmentFile = path.join(reportsRoot, "live-e2e-quality-assessment-report-live-e2e.test.run.json");
  writeJson(
    assessmentFile,
    buildAssessmentReport({
      evidenceFile,
      summaryFile,
      observationFile,
      runHealthFile,
      requestFile,
    }),
  );

  const result = runQualityAssessment(["validate", "--assessment-report-file", assessmentFile]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "ok");
  assert.equal(output.contract_validation_ok, true);
  assert.equal(output.missing_local_refs.length, 0);
});

test("quality assessment validate does not treat free-form file names as local evidence refs", () => {
  const tempRoot = makeTempRoot();
  const reportsRoot = path.join(tempRoot, "reports");
  const evidenceFile = touch(path.join(reportsRoot, "review-report-live-e2e.test.run.json"));
  const summaryFile = touch(path.join(reportsRoot, "live-e2e-run-summary-live-e2e.test.run.json"));
  const observationFile = touch(path.join(reportsRoot, "live-e2e-observation-report-live-e2e.test.run.json"));
  const runHealthFile = touch(path.join(reportsRoot, "live-e2e-run-health-report-live-e2e.test.run.json"));
  const requestFile = touch(path.join(reportsRoot, "live-e2e-quality-assessment-request-live-e2e.test.run.json"));
  const assessmentFile = path.join(reportsRoot, "live-e2e-quality-assessment-report-live-e2e.test.run.json");
  const report = buildAssessmentReport({
    evidenceFile,
    summaryFile,
    observationFile,
    runHealthFile,
    requestFile,
  });
  report.findings.push({
    category: "follow-up-needed",
    severity: "low",
    summary: "Mention README.md in release notes, but do not treat it as inspected evidence.",
    evidence_refs: [requestFile],
  });
  report.recommended_followups.push("Clarify README.md wording if this mission graduates from rehearsal to release.");
  writeJson(assessmentFile, report);

  const result = runQualityAssessment(["validate", "--assessment-report-file", assessmentFile]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "ok");
  assert.equal(output.missing_local_refs.some((entry) => entry.ref.endsWith("README.md")), false);
});

test("quality assessment validate fails when inspected local evidence is missing", () => {
  const tempRoot = makeTempRoot();
  const reportsRoot = path.join(tempRoot, "reports");
  const evidenceFile = path.join(reportsRoot, "missing-review-report-live-e2e.test.run.json");
  const summaryFile = touch(path.join(reportsRoot, "live-e2e-run-summary-live-e2e.test.run.json"));
  const observationFile = touch(path.join(reportsRoot, "live-e2e-observation-report-live-e2e.test.run.json"));
  const runHealthFile = touch(path.join(reportsRoot, "live-e2e-run-health-report-live-e2e.test.run.json"));
  const requestFile = touch(path.join(reportsRoot, "live-e2e-quality-assessment-request-live-e2e.test.run.json"));
  const assessmentFile = path.join(reportsRoot, "live-e2e-quality-assessment-report-live-e2e.test.run.json");
  writeJson(
    assessmentFile,
    buildAssessmentReport({
      evidenceFile,
      summaryFile,
      observationFile,
      runHealthFile,
      requestFile,
    }),
  );

  const result = runQualityAssessment(["validate", "--assessment-report-file", assessmentFile]);
  assert.equal(result.status, 1, result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "fail");
  assert.ok(output.missing_local_refs.some((entry) => entry.ref === evidenceFile));
});

test("quality assessment all-pass gate accepts fully passing assessment with target change", () => {
  const tempRoot = makeTempRoot();
  const reportsRoot = path.join(tempRoot, "reports");
  const evidenceFile = touch(path.join(reportsRoot, "review-report-live-e2e.test.run.json"));
  const summaryFile = path.join(reportsRoot, "live-e2e-run-summary-live-e2e.test.run.json");
  const observationFile = touch(path.join(reportsRoot, "live-e2e-observation-report-live-e2e.test.run.json"));
  const runHealthFile = touch(path.join(reportsRoot, "live-e2e-run-health-report-live-e2e.test.run.json"));
  const requestFile = touch(path.join(reportsRoot, "live-e2e-quality-assessment-request-live-e2e.test.run.json"));
  const assessmentFile = path.join(reportsRoot, "live-e2e-quality-assessment-report-live-e2e.test.run.json");
  writeJson(summaryFile, {
    run_id: "live-e2e.test.run",
    meaningful_changed_paths: ["source/index.ts", "test/index.test.ts"],
  });
  writeJson(
    assessmentFile,
    buildAssessmentReport({
      evidenceFile,
      summaryFile,
      observationFile,
      runHealthFile,
      requestFile,
      allPass: true,
    }),
  );

  const result = runQualityAssessment(["gate", "--policy", "all-pass", "--assessment-report-file", assessmentFile]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "ok");
  assert.equal(output.gate_issue_count, 0);
});

test("quality assessment all-pass gate rejects warning, missing evidence, and missing target change", () => {
  const tempRoot = makeTempRoot();
  const reportsRoot = path.join(tempRoot, "reports");
  const evidenceFile = touch(path.join(reportsRoot, "review-report-live-e2e.test.run.json"));
  const summaryFile = path.join(reportsRoot, "live-e2e-run-summary-live-e2e.test.run.json");
  const observationFile = touch(path.join(reportsRoot, "live-e2e-observation-report-live-e2e.test.run.json"));
  const runHealthFile = touch(path.join(reportsRoot, "live-e2e-run-health-report-live-e2e.test.run.json"));
  const requestFile = touch(path.join(reportsRoot, "live-e2e-quality-assessment-request-live-e2e.test.run.json"));
  const assessmentFile = path.join(reportsRoot, "live-e2e-quality-assessment-report-live-e2e.test.run.json");
  writeJson(summaryFile, {
    run_id: "live-e2e.test.run",
    meaningful_changed_paths: [".aor/projects/test/report.json"],
    post_run_diagnostic_status: "warn",
  });
  const report = buildAssessmentReport({
    evidenceFile,
    summaryFile,
    observationFile,
    runHealthFile,
    requestFile,
  });
  report.dimensions.code_maintainability.evidence_strength = "weak";
  report.gap_report.weak_signal_dimensions = ["code_maintainability"];
  report.gap_report.strong_evidence_dimensions = report.gap_report.strong_evidence_dimensions.filter(
    (dimension) => dimension !== "code_maintainability",
  );
  report.findings.push({
    category: "follow-up-needed",
    severity: "high",
    summary: "High-severity follow-up remains unresolved.",
    evidence_refs: [requestFile],
  });
  report.dimensions.aor_operator_ui_ux_quality.subdimensions.task_success.findings.push({
    category: "ui-ux",
    severity: "major",
    summary: "A major AOR operator task-success issue remains unresolved.",
    evidence_refs: [evidenceFile],
  });
  writeJson(assessmentFile, report);

  const result = runQualityAssessment(["gate", "--policy", "all-pass", "--assessment-report-file", assessmentFile]);
  assert.equal(result.status, 1, result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "fail");
  assert.ok(output.gate_issues.some((issue) => issue.code === "overall_status_not_pass"));
  assert.ok(output.gate_issues.some((issue) => issue.code === "dimension_status_not_pass"));
  assert.ok(output.gate_issues.some((issue) => issue.code === "dimension_evidence_strength_too_weak"));
  assert.ok(output.gate_issues.some((issue) => issue.code === "gap_report_not_empty"));
  assert.ok(output.gate_issues.some((issue) => issue.code === "blocking_finding_present"));
  assert.ok(
    output.gate_issues.some(
      (issue) => issue.code === "blocking_finding_present" && issue.field.startsWith("subdimension_findings"),
    ),
  );
  assert.ok(output.gate_issues.some((issue) => issue.code === "meaningful_target_change_missing"));
  assert.ok(output.gate_issues.some((issue) => issue.code === "post_run_diagnostic_not_pass"));
});
