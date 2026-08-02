import assert from "node:assert/strict";
import test from "node:test";

import { createDefaultScorerRegistry, scoreEvaluationSuite } from "../src/scorer-interface.mjs";

function resolvedCase(testCase, assertions) {
  return {
    status: "resolved",
    testCase,
    input: { family: "evaluation-case-input", case_id: testCase.case_id, version: 1, subject_type: "run", content: { prompt: "inspect" } },
    expected: { family: "evaluation-case-expected", case_id: testCase.case_id, version: 1, subject_type: "run", assertions },
  };
}

const passingSubject = { content: { run_id: "candidate-42", documents: [{ status: "pass" }] } };

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
    resolvedCases: dataset.cases.map((entry) => resolvedCase(entry, [{ assertion_id: `${entry.case_id}-documents`, target: "subject", path: "/documents", operator: "exists" }])),
    subjectSnapshot: passingSubject,
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
    resolvedCases: dataset.cases.map((entry) => resolvedCase(entry, [{ assertion_id: "judge-status", target: "subject", path: "/documents/0/status", operator: "equals", value: "pass" }])),
    subjectSnapshot: passingSubject,
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
    resolvedCases: [
      { status: "failed", reason: "missing expected artifact", testCase: dataset.cases[0], input: null, expected: null },
      resolvedCase(dataset.cases[1], [{ assertion_id: "wrapper-id", target: "subject", path: "/wrapper_id", operator: "exists" }]),
    ],
    subjectSnapshot: { content: { wrapper_id: "wrapper.eval.default" } },
  });

  assert.equal(scorecard.status, "fail");
  assert.ok(scorecard.summary_metrics.blocking_rule_hits.includes("any-critical-regression"));
  assert.ok(scorecard.summary_metrics.blocking_rule_hits.includes("missing-traces"));
  assert.ok(scorecard.summary_metrics.threshold_checks.some((check) => check.passed === false));
});

test("controlled subject mutation changes deterministic scorer verdict", () => {
  const suite = { suite_id: "suite.mutation", version: 1, graders: ["deterministic"], thresholds: { min_pass_rate: 1 }, blocking_rules: [] };
  const dataset = { cases: [{ case_id: "case-mutation", input_ref: "input", expected_ref: "expected" }] };
  const resolvedCases = [resolvedCase(dataset.cases[0], [{ assertion_id: "terminal-status", target: "subject", path: "/status", operator: "equals", value: "pass" }])];
  const passing = scoreEvaluationSuite({ suite, dataset, resolvedCases, subjectSnapshot: { content: { status: "pass" } }, subjectRef: "run://mutation", subjectType: "run" });
  const failing = scoreEvaluationSuite({ suite, dataset, resolvedCases, subjectSnapshot: { content: { status: "fail" } }, subjectRef: "run://mutation", subjectType: "run" });
  assert.equal(passing.status, "pass");
  assert.equal(failing.status, "fail");
});
