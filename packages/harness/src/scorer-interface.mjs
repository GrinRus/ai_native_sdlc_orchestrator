import { isDeepStrictEqual } from "node:util";

function roundToThree(value) {
  return Math.round(value * 1000) / 1000;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCritical(testCase) {
  return Array.isArray(testCase.tags) && testCase.tags.some((entry) => String(entry).toLowerCase() === "critical");
}

function decodePointerToken(token) {
  return token.replace(/~1/gu, "/").replace(/~0/gu, "~");
}

export function resolveJsonPointer(document, pointer) {
  if (pointer === "") return { found: true, value: document };
  if (typeof pointer !== "string" || !pointer.startsWith("/")) return { found: false, value: undefined };
  let cursor = document;
  for (const token of pointer.slice(1).split("/").map(decodePointerToken)) {
    if (Array.isArray(cursor)) {
      if (!/^(0|[1-9][0-9]*)$/u.test(token) || Number(token) >= cursor.length) return { found: false, value: undefined };
      cursor = cursor[Number(token)];
      continue;
    }
    if (!isRecord(cursor) || !Object.prototype.hasOwnProperty.call(cursor, token)) return { found: false, value: undefined };
    cursor = cursor[token];
  }
  return { found: true, value: cursor };
}

function contains(actual, expected) {
  if (typeof actual === "string" && typeof expected === "string") return actual.includes(expected);
  if (Array.isArray(actual)) return actual.some((entry) => isDeepStrictEqual(entry, expected));
  return false;
}

export function evaluateAssertions({ subject, input, expected }) {
  const assertions = Array.isArray(expected?.assertions) ? expected.assertions : [];
  return assertions.map((assertion) => {
    const target = assertion.target === "input" ? input : subject;
    const resolved = resolveJsonPointer(target, assertion.path);
    let passed = false;
    if (assertion.operator === "exists") passed = resolved.found;
    if (assertion.operator === "absent") passed = !resolved.found;
    if (assertion.operator === "equals") passed = resolved.found && isDeepStrictEqual(resolved.value, assertion.value);
    if (assertion.operator === "contains") passed = resolved.found && contains(resolved.value, assertion.value);
    return {
      assertion_id: assertion.assertion_id,
      target: assertion.target,
      path: assertion.path,
      operator: assertion.operator,
      status: passed ? "pass" : "fail",
      reason: passed ? "assertion_satisfied" : "assertion_not_satisfied",
    };
  });
}

export function createDeterministicFixtureJudge() {
  return ({ assertionOutcomes }) => ({
    status: assertionOutcomes.every((entry) => entry.status === "pass") ? "pass" : "fail",
    score: assertionOutcomes.length === 0 ? 0 : assertionOutcomes.filter((entry) => entry.status === "pass").length / assertionOutcomes.length,
    reason: "deterministic_fixture_judge",
  });
}

export function createDefaultScorerRegistry(options = {}) {
  const judge = options.judge ?? createDeterministicFixtureJudge();
  const registry = new Map();
  const deterministicCase = ({ resolvedCase, subjectSnapshot }) => {
    const testCase = resolvedCase.testCase ?? {};
    const caseId = typeof testCase.case_id === "string" ? testCase.case_id : "unknown-case";
    if (resolvedCase.status !== "resolved") {
      return { case_id: caseId, status: "fail", reason: resolvedCase.reason ?? "case_resolution_failed", score: 0, critical: isCritical(testCase), assertion_outcomes: [] };
    }
    const assertionOutcomes = evaluateAssertions({ subject: subjectSnapshot.content, input: resolvedCase.input.content, expected: resolvedCase.expected });
    const passed = assertionOutcomes.length > 0 && assertionOutcomes.every((entry) => entry.status === "pass");
    return { case_id: caseId, status: passed ? "pass" : "fail", reason: passed ? "all_assertions_satisfied" : "assertion_failed", score: passed ? 1 : 0, critical: isCritical(testCase), assertion_outcomes: assertionOutcomes };
  };

  registry.set("deterministic", {
    scorer_id: "deterministic",
    scorer_mode: "deterministic",
    scorer_impl: "harness.scorer.deterministic.v2",
    evaluateCase: deterministicCase,
  });
  registry.set("pairwise-judge", {
    scorer_id: "pairwise-judge",
    scorer_mode: "judge",
    scorer_impl: "harness.scorer.pairwise-judge.v2",
    evaluateCase: (context) => {
      const base = deterministicCase(context);
      if (context.resolvedCase.status !== "resolved") return { ...base, reason: "judge_case_resolution_failed" };
      const decision = judge({
        subject: context.subjectSnapshot.content,
        input: context.resolvedCase.input.content,
        expected: context.resolvedCase.expected,
        assertionOutcomes: base.assertion_outcomes,
        caseId: base.case_id,
        suiteRef: context.suiteRef,
      });
      const score = Number.isFinite(decision?.score) ? roundToThree(Math.max(0, Math.min(1, decision.score))) : 0;
      const status = decision?.status === "pass" ? "pass" : "fail";
      return { ...base, status, score, reason: typeof decision?.reason === "string" ? decision.reason : "judge_invalid_result" };
    },
  });
  return registry;
}

function runScorer(options) {
  const caseResults = options.resolvedCases.map((resolvedCase) => options.scorer.evaluateCase({ resolvedCase, subjectSnapshot: options.subjectSnapshot, subjectRef: options.subjectRef, subjectType: options.subjectType, suiteRef: options.suiteRef }));
  const passedCases = caseResults.filter((result) => result.status === "pass").length;
  const failedCases = caseResults.length - passedCases;
  return {
    scorer_id: options.scorer.scorer_id,
    scorer_mode: options.scorer.scorer_mode,
    scorer_impl: options.scorer.scorer_impl,
    status: failedCases === 0 && caseResults.length > 0 ? "pass" : "fail",
    evaluated_cases: caseResults.length,
    passed_cases: passedCases,
    failed_cases: failedCases,
    pass_rate: caseResults.length === 0 ? 0 : roundToThree(passedCases / caseResults.length),
    case_results: caseResults,
  };
}

export function scoreEvaluationSuite(options) {
  const scorerRegistry = options.scorerRegistry ?? createDefaultScorerRegistry({ judge: options.judge });
  const suiteRef = typeof options.suite.suite_id === "string" && typeof options.suite.version === "number" ? `${options.suite.suite_id}@v${options.suite.version}` : "unknown-suite";
  const suiteGraders = Array.isArray(options.suite.graders) ? options.suite.graders.filter((entry) => typeof entry === "string") : [];
  const resolvedCases = Array.isArray(options.resolvedCases) ? options.resolvedCases : [];
  const graderResults = {};
  const scorerMetadata = [];
  const missingScorers = [];
  for (const graderId of suiteGraders) {
    const scorer = scorerRegistry.get(graderId);
    if (!scorer) { missingScorers.push(graderId); continue; }
    graderResults[graderId] = runScorer({ scorer, resolvedCases, subjectSnapshot: options.subjectSnapshot, subjectRef: options.subjectRef, subjectType: options.subjectType, suiteRef });
    scorerMetadata.push({ scorer_id: scorer.scorer_id, scorer_mode: scorer.scorer_mode, scorer_impl: scorer.scorer_impl });
  }
  const graderResultList = Object.values(graderResults);
  const aggregatePassRate = graderResultList.length === 0 ? 0 : roundToThree(graderResultList.reduce((sum, entry) => sum + entry.pass_rate, 0) / graderResultList.length);
  let passedCases = 0;
  for (let index = 0; index < resolvedCases.length; index += 1) {
    if (graderResultList.length > 0 && graderResultList.every((entry) => entry.case_results[index]?.status === "pass")) passedCases += 1;
  }
  const failedCases = resolvedCases.length - passedCases;
  const thresholds = isRecord(options.suite.thresholds) ? options.suite.thresholds : {};
  const minPassRateThreshold = Number.isFinite(thresholds.min_pass_rate) ? thresholds.min_pass_rate : 1;
  const maxRegressionsThreshold = Number.isFinite(thresholds.max_regressions_introduced) ? thresholds.max_regressions_introduced : null;
  const thresholdChecks = [{ name: "min_pass_rate", expected: minPassRateThreshold, actual: aggregatePassRate, passed: aggregatePassRate >= minPassRateThreshold }];
  if (maxRegressionsThreshold !== null) thresholdChecks.push({ name: "max_regressions_introduced", expected: maxRegressionsThreshold, actual: failedCases, passed: failedCases <= maxRegressionsThreshold });
  const criticalRegressionFound = graderResultList.some((entry) => entry.case_results.some((result) => result.status === "fail" && result.critical === true));
  const blockingRules = Array.isArray(options.suite.blocking_rules) ? options.suite.blocking_rules : [];
  const blockingRuleHits = [];
  if (blockingRules.includes("any-critical-regression") && criticalRegressionFound) blockingRuleHits.push("any-critical-regression");
  if (blockingRules.includes("missing-traces") && resolvedCases.some((entry) => entry.status !== "resolved")) blockingRuleHits.push("missing-traces");
  const status = missingScorers.length === 0 && graderResultList.length > 0 && thresholdChecks.every((entry) => entry.passed) && blockingRuleHits.length === 0 ? "pass" : "fail";
  return { status, scorer_metadata: scorerMetadata, grader_results: graderResults, summary_metrics: { total_cases: resolvedCases.length, passed_cases: passedCases, failed_cases: failedCases, aggregate_pass_rate: aggregatePassRate, regressions_introduced: failedCases, threshold_checks: thresholdChecks, blocking_rule_hits: blockingRuleHits, missing_scorers: missingScorers } };
}
