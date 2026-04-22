import assert from "node:assert/strict";
import test from "node:test";

import { createDefaultScorerRegistry, scoreEvaluationSuite } from "../src/scorer-interface.mjs";

test("scoreEvaluationSuite supports deterministic scoring through one interface", () => {
  const suite = {
    suite_id: "suite.release.core",
    version: 1,
    subject_type: "run",
    graders: ["deterministic"],
    thresholds: {
      min_pass_rate: 1,
      max_regressions_introduced: 0,
    },
    blocking_rules: ["any-critical-regression"],
  };
  const dataset = {
    cases: [
      {
        case_id: "CASE-001",
        input_ref: "evidence://case-001/input.json",
        expected_ref: "evidence://case-001/expected.json",
        tags: ["regression"],
      },
      {
        case_id: "CASE-002",
        input_ref: "evidence://case-002/input.json",
        expected_ref: "evidence://case-002/expected.json",
        tags: ["release"],
      },
    ],
  };

  const scorecard = scoreEvaluationSuite({
    suite,
    dataset,
    subjectRef: "run://candidate-42",
    subjectType: "run",
  });

  assert.equal(scorecard.status, "pass");
  assert.equal(scorecard.scorer_metadata.length, 1);
  assert.equal(scorecard.scorer_metadata[0].scorer_id, "deterministic");
  assert.equal(scorecard.grader_results.deterministic.status, "pass");
  assert.equal(scorecard.summary_metrics.total_cases, 2);
  assert.equal(scorecard.summary_metrics.aggregate_pass_rate, 1);
});

test("scoreEvaluationSuite supports judge scoring and keeps deterministic output", () => {
  const suite = {
    suite_id: "suite.regress.long",
    version: 1,
    subject_type: "run",
    graders: ["pairwise-judge"],
    thresholds: {
      min_pass_rate: 0.7,
    },
    blocking_rules: [],
  };
  const dataset = {
    cases: [
      {
        case_id: "CASE-101",
        input_ref: "evidence://case-101/input.json",
        expected_ref: "evidence://case-101/expected.json",
      },
    ],
  };

  const scorecard = scoreEvaluationSuite({
    suite,
    dataset,
    subjectRef: "run://candidate-43",
    subjectType: "run",
    scorerRegistry: createDefaultScorerRegistry(),
  });

  assert.equal(scorecard.status, "pass");
  assert.equal(scorecard.scorer_metadata.length, 1);
  assert.equal(scorecard.scorer_metadata[0].scorer_mode, "judge");
  assert.equal(scorecard.grader_results["pairwise-judge"].status, "pass");
});

test("scoreEvaluationSuite supports mixed scorers and explicit composite failure", () => {
  const suite = {
    suite_id: "suite.cert.core",
    version: 4,
    subject_type: "wrapper",
    graders: ["deterministic", "pairwise-judge"],
    thresholds: {
      min_pass_rate: 0.9,
      max_regressions_introduced: 0,
    },
    blocking_rules: ["any-critical-regression", "missing-traces"],
  };
  const dataset = {
    cases: [
      {
        case_id: "CASE-WRAP-01",
        input_ref: "evidence://case-wrap-01/input.json",
        tags: ["critical"],
      },
      {
        case_id: "CASE-WRAP-02",
        input_ref: "evidence://case-wrap-02/input.json",
        expected_ref: "evidence://case-wrap-02/expected.json",
      },
    ],
  };

  const scorecard = scoreEvaluationSuite({
    suite,
    dataset,
    subjectRef: "wrapper://wrapper.eval.default@v1",
    subjectType: "wrapper",
  });

  assert.equal(scorecard.status, "fail");
  assert.ok(scorecard.summary_metrics.blocking_rule_hits.includes("any-critical-regression"));
  assert.ok(scorecard.summary_metrics.blocking_rule_hits.includes("missing-traces"));
  assert.ok(scorecard.summary_metrics.threshold_checks.some((check) => check.passed === false));
});
