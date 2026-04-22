import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  certifyAssetPromotion,
  resolveCertificationDecisionStatus,
} from "../src/certification-decision.mjs";

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
    assert.equal(result.decision.evidence_summary.rollout_decision.action, "promote");
    assert.ok(Array.isArray(result.decision.evidence_summary.governance_checks));
    assert.equal(result.decision.evidence_summary.governance_checks.length >= 5, true);
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
    ]);
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
