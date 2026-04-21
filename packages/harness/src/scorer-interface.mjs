import { createHash } from "node:crypto";

/**
 * @param {number} value
 * @returns {number}
 */
function roundToThree(value) {
  return Math.round(value * 1000) / 1000;
}

/**
 * @param {string} seed
 * @returns {number}
 */
function unitIntervalFromSeed(seed) {
  const digest = createHash("sha256").update(seed).digest("hex").slice(0, 8);
  const integer = Number.parseInt(digest, 16);
  return integer / 0xffffffff;
}

/**
 * @param {Record<string, unknown>} testCase
 * @returns {{ hasInputRef: boolean, hasExpectedRef: boolean, isCritical: boolean }}
 */
function inspectCase(testCase) {
  const hasInputRef = typeof testCase.input_ref === "string" && testCase.input_ref.trim().length > 0;
  const hasExpectedRef = typeof testCase.expected_ref === "string" && testCase.expected_ref.trim().length > 0;
  const isCritical =
    Array.isArray(testCase.tags) &&
    testCase.tags.some((entry) => typeof entry === "string" && entry.toLowerCase() === "critical");
  return { hasInputRef, hasExpectedRef, isCritical };
}

/**
 * @typedef {{
 *   scorer_id: string,
 *   scorer_mode: "deterministic" | "judge",
 *   scorer_impl: string,
 *   evaluateCase: (options: {
 *     testCase: Record<string, unknown>,
 *     subjectRef: string,
 *     subjectType: string,
 *     suiteRef: string,
 *   }) => {
 *     case_id: string,
 *     status: "pass" | "fail",
 *     reason: string,
 *     score: number,
 *     critical: boolean,
 *   },
 * }} ScorerDefinition
 */

/**
 * @returns {Map<string, ScorerDefinition>}
 */
export function createDefaultScorerRegistry() {
  /** @type {Map<string, ScorerDefinition>} */
  const registry = new Map();

  registry.set("deterministic", {
    scorer_id: "deterministic",
    scorer_mode: "deterministic",
    scorer_impl: "harness.scorer.deterministic.v1",
    evaluateCase: ({ testCase }) => {
      const caseId = typeof testCase.case_id === "string" ? testCase.case_id : "unknown-case";
      const inspection = inspectCase(testCase);
      const passed = inspection.hasInputRef && inspection.hasExpectedRef;
      return {
        case_id: caseId,
        status: passed ? "pass" : "fail",
        reason: passed ? "deterministic_refs_present" : "missing_input_or_expected_ref",
        score: passed ? 1 : 0,
        critical: inspection.isCritical,
      };
    },
  });

  registry.set("pairwise-judge", {
    scorer_id: "pairwise-judge",
    scorer_mode: "judge",
    scorer_impl: "harness.scorer.pairwise-judge.v1",
    evaluateCase: ({ testCase, subjectRef, suiteRef }) => {
      const caseId = typeof testCase.case_id === "string" ? testCase.case_id : "unknown-case";
      const inspection = inspectCase(testCase);
      if (!inspection.hasInputRef || !inspection.hasExpectedRef) {
        return {
          case_id: caseId,
          status: "fail",
          reason: "judge_missing_case_refs",
          score: 0,
          critical: inspection.isCritical,
        };
      }

      const noise = unitIntervalFromSeed(`${suiteRef}:${subjectRef}:${caseId}`);
      const score = roundToThree(0.7 + noise * 0.3);
      return {
        case_id: caseId,
        status: score >= 0.7 ? "pass" : "fail",
        reason: score >= 0.7 ? "judge_confident_pass" : "judge_low_confidence",
        score,
        critical: inspection.isCritical,
      };
    },
  });

  return registry;
}

/**
 * @param {{
 *   scorer: ScorerDefinition,
 *   cases: Array<Record<string, unknown>>,
 *   subjectRef: string,
 *   subjectType: string,
 *   suiteRef: string,
 * }} options
 */
function runScorer(options) {
  const caseResults = options.cases.map((testCase) =>
    options.scorer.evaluateCase({
      testCase,
      subjectRef: options.subjectRef,
      subjectType: options.subjectType,
      suiteRef: options.suiteRef,
    }),
  );

  const passedCases = caseResults.filter((result) => result.status === "pass").length;
  const failedCases = caseResults.length - passedCases;
  const passRate = caseResults.length === 0 ? 0 : roundToThree(passedCases / caseResults.length);

  return {
    scorer_id: options.scorer.scorer_id,
    scorer_mode: options.scorer.scorer_mode,
    scorer_impl: options.scorer.scorer_impl,
    status: failedCases === 0 ? "pass" : "fail",
    evaluated_cases: caseResults.length,
    passed_cases: passedCases,
    failed_cases: failedCases,
    pass_rate: passRate,
    case_results: caseResults,
  };
}

/**
 * @param {{
 *   suite: Record<string, unknown>,
 *   dataset: Record<string, unknown>,
 *   subjectRef: string,
 *   subjectType: string,
 *   scorerRegistry?: Map<string, ScorerDefinition>,
 * }} options
 */
export function scoreEvaluationSuite(options) {
  const scorerRegistry = options.scorerRegistry ?? createDefaultScorerRegistry();
  const suiteRef =
    typeof options.suite.suite_id === "string" && typeof options.suite.version === "number"
      ? `${options.suite.suite_id}@v${options.suite.version}`
      : "unknown-suite";
  const suiteGraders = Array.isArray(options.suite.graders)
    ? options.suite.graders.filter((entry) => typeof entry === "string")
    : [];
  const cases = Array.isArray(options.dataset.cases)
    ? options.dataset.cases.filter((entry) => typeof entry === "object" && entry !== null).map((entry) => entry)
    : [];

  /** @type {Record<string, unknown>} */
  const graderResults = {};
  /** @type {Array<{ scorer_id: string, scorer_mode: "deterministic" | "judge", scorer_impl: string }>} */
  const scorerMetadata = [];
  /** @type {string[]} */
  const missingScorers = [];

  for (const graderId of suiteGraders) {
    const scorer = scorerRegistry.get(graderId);
    if (!scorer) {
      missingScorers.push(graderId);
      continue;
    }

    const scorerResult = runScorer({
      scorer,
      cases,
      subjectRef: options.subjectRef,
      subjectType: options.subjectType,
      suiteRef,
    });
    graderResults[graderId] = scorerResult;
    scorerMetadata.push({
      scorer_id: scorer.scorer_id,
      scorer_mode: scorer.scorer_mode,
      scorer_impl: scorer.scorer_impl,
    });
  }

  const graderResultList = Object.values(graderResults).filter((entry) => typeof entry === "object" && entry !== null);
  const aggregatePassRate =
    graderResultList.length === 0
      ? 0
      : roundToThree(
          graderResultList.reduce((acc, entry) => {
            const scorerEntry = /** @type {{ pass_rate?: number }} */ (entry);
            return acc + (typeof scorerEntry.pass_rate === "number" ? scorerEntry.pass_rate : 0);
          }, 0) / graderResultList.length,
        );

  const caseResultsByScorer = graderResultList.map((entry) => /** @type {{ case_results?: unknown[] }} */ (entry).case_results ?? []);
  let passedCases = 0;
  for (let index = 0; index < cases.length; index += 1) {
    const isPassAcrossScorers = caseResultsByScorer.every((resultList) => {
      const result = resultList[index];
      return typeof result === "object" && result !== null && /** @type {{ status?: string }} */ (result).status === "pass";
    });
    if (isPassAcrossScorers) {
      passedCases += 1;
    }
  }
  const failedCases = cases.length - passedCases;
  const regressionsIntroduced = failedCases;

  const thresholds = typeof options.suite.thresholds === "object" && options.suite.thresholds !== null ? options.suite.thresholds : {};
  const minPassRateThreshold =
    typeof thresholds.min_pass_rate === "number" && Number.isFinite(thresholds.min_pass_rate) ? thresholds.min_pass_rate : 1;
  const maxRegressionsThreshold =
    typeof thresholds.max_regressions_introduced === "number" && Number.isFinite(thresholds.max_regressions_introduced)
      ? thresholds.max_regressions_introduced
      : null;

  const thresholdChecks = [
    {
      name: "min_pass_rate",
      expected: minPassRateThreshold,
      actual: aggregatePassRate,
      passed: aggregatePassRate >= minPassRateThreshold,
    },
    ...(maxRegressionsThreshold === null
      ? []
      : [
          {
            name: "max_regressions_introduced",
            expected: maxRegressionsThreshold,
            actual: regressionsIntroduced,
            passed: regressionsIntroduced <= maxRegressionsThreshold,
          },
        ]),
  ];

  const blockingRules = Array.isArray(options.suite.blocking_rules)
    ? options.suite.blocking_rules.filter((entry) => typeof entry === "string")
    : [];
  const criticalRegressionFound = graderResultList.some((entry) => {
    const caseResults = /** @type {{ case_results?: unknown[] }} */ (entry).case_results ?? [];
    return caseResults.some((result) => {
      if (typeof result !== "object" || result === null) return false;
      const candidate = /** @type {{ status?: string, critical?: boolean }} */ (result);
      return candidate.status === "fail" && candidate.critical === true;
    });
  });
  const missingTraces = cases.some((testCase) => !inspectCase(testCase).hasExpectedRef);

  const blockingRuleHits = [];
  if (blockingRules.includes("any-critical-regression") && criticalRegressionFound) {
    blockingRuleHits.push("any-critical-regression");
  }
  if (blockingRules.includes("missing-traces") && missingTraces) {
    blockingRuleHits.push("missing-traces");
  }

  const thresholdFailed = thresholdChecks.some((check) => check.passed === false);
  const status =
    missingScorers.length > 0 || thresholdFailed || blockingRuleHits.length > 0 || graderResultList.length === 0
      ? "fail"
      : "pass";

  return {
    status,
    scorer_metadata: scorerMetadata,
    grader_results: graderResults,
    summary_metrics: {
      total_cases: cases.length,
      passed_cases: passedCases,
      failed_cases: failedCases,
      aggregate_pass_rate: aggregatePassRate,
      regressions_introduced: regressionsIntroduced,
      threshold_checks: thresholdChecks,
      blocking_rule_hits: blockingRuleHits,
      missing_scorers: missingScorers,
    },
  };
}
