import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  certifyAssetPromotion,
  resolveBaselineComparison,
  resolveCertificationDecisionStatus,
  resolveRegressionTriage,
} from "../src/certification-decision.mjs";
import { initializeProjectRuntime } from "../src/project-init.mjs";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const workspaceRoot = path.resolve(currentDir, "../../..");

/**
 * @param {(repoRoot: string) => void} callback
 */
function withTempRepo(callback) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-w3-s05-"));
  fs.mkdirSync(path.join(repoRoot, ".git"), { recursive: true });
  fs.cpSync(path.join(workspaceRoot, "examples"), path.join(repoRoot, "examples"), { recursive: true });

  try {
    callback(repoRoot);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
}

test("resolveCertificationDecisionStatus maps pass/hold/fail semantics deterministically", () => {
  assert.equal(
    resolveCertificationDecisionStatus({
      validationStatus: "pass",
      evaluationStatus: "pass",
      replayStatus: "pass",
      evidenceComplete: true,
      financeSignalsComplete: true,
      qualityGateRequired: true,
      baselineComparisonRequired: true,
      baselineComparisonComplete: true,
      freezeGuardrailStatus: "pass",
    }),
    "pass",
  );
  assert.equal(
    resolveCertificationDecisionStatus({
      validationStatus: "pass",
      evaluationStatus: "pass",
      replayStatus: "incompatible",
      evidenceComplete: true,
      financeSignalsComplete: true,
      qualityGateRequired: true,
      baselineComparisonRequired: true,
      baselineComparisonComplete: false,
      freezeGuardrailStatus: "pass",
    }),
    "hold",
  );
  assert.equal(
    resolveCertificationDecisionStatus({
      validationStatus: "pass",
      evaluationStatus: "pass",
      replayStatus: "fail",
      evidenceComplete: true,
      financeSignalsComplete: true,
      qualityGateRequired: true,
      baselineComparisonRequired: true,
      baselineComparisonComplete: true,
      freezeGuardrailStatus: "pass",
    }),
    "fail",
  );
  assert.equal(
    resolveCertificationDecisionStatus({
      validationStatus: "pass",
      evaluationStatus: "pass",
      replayStatus: "fail",
      evidenceComplete: true,
      financeSignalsComplete: true,
      qualityGateRequired: true,
      baselineComparisonRequired: true,
      baselineComparisonComplete: true,
      flakyDetected: true,
      freezeGuardrailStatus: "pass",
    }),
    "hold",
  );
  assert.equal(
    resolveCertificationDecisionStatus({
      validationStatus: "pass",
      evaluationStatus: "fail",
      replayStatus: "pass",
      evidenceComplete: true,
      financeSignalsComplete: true,
      qualityGateRequired: true,
      baselineComparisonRequired: true,
      baselineComparisonComplete: true,
      freezeGuardrailStatus: "pass",
    }),
    "fail",
  );
  assert.equal(
    resolveCertificationDecisionStatus({
      validationStatus: "pass",
      evaluationStatus: "pass",
      replayStatus: "pass",
      evidenceComplete: false,
      financeSignalsComplete: true,
      qualityGateRequired: true,
      baselineComparisonRequired: true,
      baselineComparisonComplete: true,
      freezeGuardrailStatus: "pass",
    }),
    "hold",
  );
  assert.equal(
    resolveCertificationDecisionStatus({
      validationStatus: "warn",
      evaluationStatus: "pass",
      replayStatus: "pass",
      evidenceComplete: true,
      financeSignalsComplete: true,
      qualityGateRequired: true,
      baselineComparisonRequired: true,
      baselineComparisonComplete: true,
      freezeGuardrailStatus: "pass",
    }),
    "hold",
  );
  assert.equal(
    resolveCertificationDecisionStatus({
      validationStatus: "pass",
      evaluationStatus: "pass",
      replayStatus: "pass",
      evidenceComplete: true,
      financeSignalsComplete: true,
      qualityGateRequired: true,
      baselineComparisonRequired: true,
      baselineComparisonComplete: false,
      freezeGuardrailStatus: "pass",
    }),
    "hold",
  );
  assert.equal(
    resolveCertificationDecisionStatus({
      validationStatus: "pass",
      evaluationStatus: "pass",
      replayStatus: "pass",
      evidenceComplete: true,
      financeSignalsComplete: true,
      qualityGateRequired: true,
      baselineComparisonRequired: true,
      baselineComparisonComplete: true,
      freezeGuardrailStatus: "hold",
    }),
    "hold",
  );
});

test("resolveBaselineComparison classifies flaky drift without escalation", () => {
  const baselineComparison = resolveBaselineComparison({
    evaluationStatus: "pass",
    replayStatus: "fail",
    captureResult: {
      evaluationReportPath: "runtime://reports/evaluation-report-suite.cert.core-v4.json",
    },
    replayResult: {
      replayReport: {
        baseline_snapshot: {
          status: "pass",
          aggregate_pass_rate: 1,
        },
        replay_snapshot: {
          aggregate_pass_rate: 0.99,
          comparable: false,
          evaluation_report_ref: "runtime://reports/evaluation-report-suite.cert.core-v4-replay.json",
        },
      },
    },
  });
  const triage = resolveRegressionTriage({
    baselineComparison,
    toChannel: "stable",
    replayStatus: "fail",
  });

  assert.equal(baselineComparison.pass_rate_delta, -0.01);
  assert.equal(baselineComparison.drift_detected, true);
  assert.equal(baselineComparison.drift_severity, "minor");
  assert.equal(baselineComparison.flaky_detected, true);
  assert.equal(baselineComparison.regression_detected, false);
  assert.equal(baselineComparison.triage_recommendation, "collect-replay-samples");
  assert.equal(baselineComparison.escalation_required, false);
  assert.equal(triage.regression_detected, false);
  assert.equal(triage.flaky_detected, true);
  assert.equal(triage.triage_recommendation, "collect-replay-samples");
});

test("resolveBaselineComparison escalates major drift regression", () => {
  const baselineComparison = resolveBaselineComparison({
    evaluationStatus: "pass",
    replayStatus: "fail",
    captureResult: {
      evaluationReportPath: "runtime://reports/evaluation-report-suite.cert.core-v4.json",
    },
    replayResult: {
      replayReport: {
        baseline_snapshot: {
          status: "pass",
          aggregate_pass_rate: 1,
        },
        replay_snapshot: {
          aggregate_pass_rate: 0.85,
          comparable: false,
          evaluation_report_ref: "runtime://reports/evaluation-report-suite.cert.core-v4-replay.json",
        },
      },
    },
  });
  const triage = resolveRegressionTriage({
    baselineComparison,
    toChannel: "stable",
    replayStatus: "fail",
  });

  assert.equal(baselineComparison.pass_rate_delta, -0.15);
  assert.equal(baselineComparison.drift_detected, true);
  assert.equal(baselineComparison.drift_severity, "major");
  assert.equal(baselineComparison.flaky_detected, false);
  assert.equal(baselineComparison.regression_detected, true);
  assert.equal(baselineComparison.triage_recommendation, "block-and-triage");
  assert.equal(baselineComparison.escalation_required, true);
  assert.equal(triage.regression_detected, true);
  assert.equal(triage.escalation_required, true);
});

test("certifyAssetPromotion combines eval and harness evidence into durable promotion decision", () => {
  withTempRepo((repoRoot) => {
    const result = certifyAssetPromotion({
      cwd: repoRoot,
      projectRef: repoRoot,
      assetRef: "wrapper://wrapper.eval.default@v1",
      subjectRef: "wrapper://wrapper.eval.default@v1",
      suiteRef: "suite.cert.core@v4",
      stepClass: "implement",
      fromChannel: "candidate",
      toChannel: "stable",
    });

    assert.equal(fs.existsSync(result.decisionPath), true);
    assert.equal(result.decision.subject_ref, "wrapper://wrapper.eval.default@v1");
    assert.equal(result.decision.from_channel, "candidate");
    assert.equal(result.decision.to_channel, "stable");
    assert.equal(result.decision.status, "pass");
    assert.ok(Array.isArray(result.decision.evidence_refs));
    assert.ok(result.decision.evidence_refs.length >= 5);
    assert.equal(result.decision.evidence_summary.deterministic_validation_status, "pass");
    assert.equal(result.decision.evidence_summary.evaluation_status, "pass");
    assert.equal(result.decision.evidence_summary.harness_replay_status, "pass");
    assert.equal(result.decision.evidence_summary.baseline_comparison.comparison_ready, true);
    assert.equal(result.decision.evidence_summary.baseline_comparison.pass_rate_delta, 0);
    assert.equal(result.decision.evidence_summary.baseline_comparison.drift_detected, false);
    assert.equal(result.decision.evidence_summary.baseline_comparison.flaky_detected, false);
    assert.equal(result.decision.evidence_summary.baseline_comparison.triage_recommendation, "promote");
    assert.equal(result.decision.evidence_summary.regression_triage.compared_metric, "aggregate_pass_rate");
    assert.equal(result.decision.evidence_summary.regression_triage.regression_detected, false);
    assert.equal(result.decision.evidence_summary.rollout_decision.action, "promote");
    assert.ok(Array.isArray(result.decision.evidence_summary.governance_checks));
    assert.equal(result.decision.evidence_summary.governance_checks.length >= 5, true);
    const regressionTriageCheck = result.decision.evidence_summary.governance_checks.find(
      (entry) => entry.check_id === "regression-triage",
    );
    assert.equal(regressionTriageCheck?.status, "pass");
    assert.equal(result.decision.evidence_summary.finance_signals.max_cost_usd > 0, true);
    assert.equal(result.decision.evidence_summary.finance_signals.timeout_sec > 0, true);
    assert.equal(result.decision.evidence_summary.finance_signals.capture_latency_sec >= 0, true);
    assert.equal(result.decision.evidence_summary.finance_signals.replay_latency_sec >= 0, true);
    assert.deepEqual(result.decision.evidence_summary.evidence_bar.required, [
      "validation-report",
      "evaluation-report",
      "harness-capture",
      "harness-replay",
      "finance-signals",
      "baseline-comparison",
      "regression-triage",
    ]);
  });
});

test("certifyAssetPromotion records context lifecycle comparison and provenance for context assets", () => {
  withTempRepo((repoRoot) => {
    const result = certifyAssetPromotion({
      cwd: repoRoot,
      projectRef: repoRoot,
      assetRef: "context-bundle://context.bundle.runner.foundation@v1",
      subjectRef: "wrapper://wrapper.eval.default@v1",
      suiteRef: "suite.cert.core@v4",
      stepClass: "implement",
      fromChannel: "candidate",
      toChannel: "stable",
    });

    assert.equal(result.decision.status, "pass");
    const lifecycle = result.decision.evidence_summary.context_lifecycle;
    assert.equal(lifecycle.context_asset_ref, "context-bundle://context.bundle.runner.foundation@v1");
    assert.equal(lifecycle.update_status, "initial");
    assert.equal(lifecycle.outdated, false);
    assert.equal(Array.isArray(lifecycle.immutable_provenance_refs), true);
    assert.equal(lifecycle.immutable_provenance_refs.length > 0, true);
    assert.equal(lifecycle.quality_comparison.comparison_ready, true);
    assert.equal(lifecycle.quality_comparison.with_context.evaluation_status, "pass");
    assert.equal(lifecycle.quality_comparison.without_context.evaluation_status, "pass");
    const contextComparisonCheck = result.decision.evidence_summary.governance_checks.find(
      (entry) => entry.check_id === "context-quality-comparison",
    );
    assert.equal(contextComparisonCheck?.status, "pass");
  });
});

test("certifyAssetPromotion holds context promotion when target context version is outdated", () => {
  withTempRepo((repoRoot) => {
    const init = initializeProjectRuntime({ projectRef: repoRoot, cwd: repoRoot });
    const seededDecisionPath = path.join(
      init.runtimeLayout.artifactsRoot,
      "promotion-decision-context-bundle-runner-foundation-v2-seed.json",
    );
    fs.writeFileSync(
      seededDecisionPath,
      `${JSON.stringify(
        {
          decision_id: "aor-core.promotion.context.bundle.runner.foundation.v2.seed",
          created_at: "2026-04-22T00:00:00.000Z",
          subject_ref: "context-bundle://context.bundle.runner.foundation@v2",
          from_channel: "candidate",
          to_channel: "stable",
          evidence_refs: ["runtime://reports/evaluation-report-seed.json"],
          evidence_summary: {
            reason: "seed context lifecycle history",
          },
          status: "pass",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const result = certifyAssetPromotion({
      cwd: repoRoot,
      projectRef: repoRoot,
      assetRef: "context-bundle://context.bundle.runner.foundation@v1",
      subjectRef: "wrapper://wrapper.eval.default@v1",
      suiteRef: "suite.cert.core@v4",
      stepClass: "implement",
      fromChannel: "candidate",
      toChannel: "stable",
    });

    assert.equal(result.decision.status, "hold");
    const lifecycle = result.decision.evidence_summary.context_lifecycle;
    assert.equal(lifecycle.outdated, true);
    assert.equal(lifecycle.update_status, "outdated");
    assert.equal(lifecycle.superseded_by_version, 2);
    const freshnessCheck = result.decision.evidence_summary.governance_checks.find(
      (entry) => entry.check_id === "context-update-freshness",
    );
    assert.equal(freshnessCheck?.status, "hold");
  });
});

test("certifyAssetPromotion blocks context promotion on critical findings via context security gate", () => {
  withTempRepo((repoRoot) => {
    const datasetPath = path.join(repoRoot, "examples/eval/dataset-wrapper-certification.yaml");
    const dataset = fs.readFileSync(datasetPath, "utf8");
    fs.writeFileSync(
      datasetPath,
      dataset
        .replace("      - evidence-discipline", "      - evidence-discipline\n      - critical")
        .replace(
          "expected_ref: evidence://datasets/wrapper-certification/CASE-WRAP-0023/expected.json",
          'expected_ref: ""',
        ),
      "utf8",
    );

    const result = certifyAssetPromotion({
      cwd: repoRoot,
      projectRef: repoRoot,
      assetRef: "context-bundle://context.bundle.runner.foundation@v1",
      subjectRef: "wrapper://wrapper.eval.default@v1",
      suiteRef: "suite.cert.core@v4",
      stepClass: "implement",
      fromChannel: "candidate",
      toChannel: "stable",
    });

    assert.equal(result.decision.status, "fail");
    const lifecycle = result.decision.evidence_summary.context_lifecycle;
    assert.equal(lifecycle.security_gate_status, "fail");
    assert.equal(lifecycle.security_findings.critical_count > 0, true);
    const securityGateCheck = result.decision.evidence_summary.governance_checks.find(
      (entry) => entry.check_id === "context-security-gate",
    );
    assert.equal(securityGateCheck?.status, "fail");
  });
});

test("certifyAssetPromotion reports fail status when evaluative evidence regresses", () => {
  withTempRepo((repoRoot) => {
    const datasetPath = path.join(repoRoot, "examples/eval/dataset-wrapper-certification.yaml");
    const dataset = fs.readFileSync(datasetPath, "utf8");
    fs.writeFileSync(
      datasetPath,
      dataset.replace(
        "expected_ref: evidence://datasets/wrapper-certification/CASE-WRAP-0023/expected.json",
        'expected_ref: ""',
      ),
      "utf8",
    );

    const result = certifyAssetPromotion({
      cwd: repoRoot,
      projectRef: repoRoot,
      assetRef: "wrapper://wrapper.eval.default@v1",
      subjectRef: "wrapper://wrapper.eval.default@v1",
      suiteRef: "suite.cert.core@v4",
      stepClass: "implement",
      fromChannel: "candidate",
      toChannel: "stable",
    });

    assert.equal(result.decision.status, "fail");
    assert.equal(result.decision.evidence_summary.evaluation_status, "fail");
    const evaluativeCheck = result.decision.evidence_summary.governance_checks.find(
      (entry) => entry.check_id === "evaluative-evidence",
    );
    assert.equal(evaluativeCheck.status, "fail");
  });
});

test("certifyAssetPromotion reports policy-blocked status when deterministic guardrails fail", () => {
  withTempRepo((repoRoot) => {
    const profilePath = path.join(repoRoot, "examples/project.aor.yaml");
    const profile = fs.readFileSync(profilePath, "utf8");
    fs.writeFileSync(profilePath, profile.replace("allow_direct_write: false", "allow_direct_write: true"), "utf8");

    const result = certifyAssetPromotion({
      cwd: repoRoot,
      projectRef: repoRoot,
      assetRef: "wrapper://wrapper.eval.default@v1",
      subjectRef: "wrapper://wrapper.eval.default@v1",
      suiteRef: "suite.cert.core@v4",
      stepClass: "implement",
      fromChannel: "candidate",
      toChannel: "stable",
    });

    assert.equal(result.decision.status, "fail");
    assert.equal(result.decision.evidence_summary.deterministic_validation_status, "fail");
    const policyGateCheck = result.decision.evidence_summary.governance_checks.find(
      (entry) => entry.check_id === "policy-quality-gate",
    );
    assert.equal(policyGateCheck.status, "fail");
  });
});

test("certifyAssetPromotion holds freeze transition without regression evidence", () => {
  withTempRepo((repoRoot) => {
    const result = certifyAssetPromotion({
      cwd: repoRoot,
      projectRef: repoRoot,
      assetRef: "wrapper://wrapper.eval.default@v1",
      subjectRef: "wrapper://wrapper.eval.default@v1",
      suiteRef: "suite.cert.core@v4",
      stepClass: "implement",
      fromChannel: "stable",
      toChannel: "frozen",
    });

    assert.equal(result.decision.status, "hold");
    assert.equal(result.decision.evidence_summary.rollout_decision.action, "hold");
    assert.equal(result.decision.evidence_summary.rollout_decision.freeze_guardrail_required, true);
    assert.equal(result.decision.evidence_summary.rollout_decision.freeze_guardrail_satisfied, false);
    const freezeGuardrailCheck = result.decision.evidence_summary.governance_checks.find(
      (entry) => entry.check_id === "freeze-channel-guardrail",
    );
    assert.equal(freezeGuardrailCheck.status, "hold");
  });
});

test("certifyAssetPromotion keeps freeze rollout action when regression evidence exists", () => {
  withTempRepo((repoRoot) => {
    const datasetPath = path.join(repoRoot, "examples/eval/dataset-wrapper-certification.yaml");
    const dataset = fs.readFileSync(datasetPath, "utf8");
    fs.writeFileSync(
      datasetPath,
      dataset.replace(
        "expected_ref: evidence://datasets/wrapper-certification/CASE-WRAP-0023/expected.json",
        'expected_ref: ""',
      ),
      "utf8",
    );

    const result = certifyAssetPromotion({
      cwd: repoRoot,
      projectRef: repoRoot,
      assetRef: "wrapper://wrapper.eval.default@v1",
      subjectRef: "wrapper://wrapper.eval.default@v1",
      suiteRef: "suite.cert.core@v4",
      stepClass: "implement",
      fromChannel: "stable",
      toChannel: "frozen",
    });

    assert.equal(result.decision.status, "fail");
    assert.equal(result.decision.evidence_summary.rollout_decision.action, "freeze");
    assert.equal(result.decision.evidence_summary.rollout_decision.freeze_guardrail_satisfied, true);
  });
});
