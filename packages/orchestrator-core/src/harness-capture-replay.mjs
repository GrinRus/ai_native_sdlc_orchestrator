import fs from "node:fs";
import path from "node:path";

import { compareHarnessCompatibility, createHarnessCapture } from "../../harness/src/capture-format.mjs";

import { runEvaluationSuite } from "./eval-runner.mjs";
import { executeRoutedStep } from "./step-execution-engine.mjs";

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeForFileName(value) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+/, "").replace(/-+$/, "");
}

/**
 * @param {{ capturePath: string }} options
 * @returns {Record<string, unknown>}
 */
function loadHarnessCapture(options) {
  const capturePath = path.resolve(options.capturePath);
  if (!fs.existsSync(capturePath)) {
    throw new Error(`Harness capture file '${capturePath}' was not found.`);
  }

  const parsed = JSON.parse(fs.readFileSync(capturePath, "utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Harness capture file '${capturePath}' has invalid shape; expected object.`);
  }
  return /** @type {Record<string, unknown>} */ (parsed);
}

/**
 * @param {{
 *  cwd?: string,
 *  projectRef?: string,
 *  projectProfile?: string,
 *  runtimeRoot?: string,
 *  stepClass: string,
 *  suiteRef: string,
 *  subjectRef: string,
 *  subjectVersion?: string,
 * }} options
 */
export function captureHarnessReplayArtifact(options) {
  const stepResult = executeRoutedStep({
    cwd: options.cwd,
    projectRef: options.projectRef,
    projectProfile: options.projectProfile,
    runtimeRoot: options.runtimeRoot,
    stepClass: options.stepClass,
    dryRun: true,
  });

  const evalResult = runEvaluationSuite({
    cwd: options.cwd,
    projectRef: options.projectRef,
    projectProfile: options.projectProfile,
    runtimeRoot: options.runtimeRoot,
    suiteRef: options.suiteRef,
    subjectRef: options.subjectRef,
    subjectVersion: options.subjectVersion,
  });

  const captureId = `${stepResult.projectId}.harness.capture.${Date.now()}`;
  const capture = createHarnessCapture({
    captureId,
    projectProfileRef: stepResult.projectProfileRef,
    stepResultRef: stepResult.stepResultPath,
    evaluationReportRef: evalResult.evaluationReportPath,
    stepResult: stepResult.stepResult,
    evaluationReport: evalResult.evaluationReport,
  });

  const capturePath = path.join(
    stepResult.runtimeLayout.reportsRoot,
    `harness-capture-${normalizeForFileName(captureId)}.json`,
  );
  fs.writeFileSync(capturePath, `${JSON.stringify(capture, null, 2)}\n`, "utf8");

  return {
    ...stepResult,
    captureId,
    capture,
    capturePath,
    stepResultPath: stepResult.stepResultPath,
    evaluationReportPath: evalResult.evaluationReportPath,
  };
}

/**
 * @param {{
 *  cwd?: string,
 *  projectRef?: string,
 *  projectProfile?: string,
 *  runtimeRoot?: string,
 *  capturePath: string,
 * }} options
 */
export function replayHarnessCapture(options) {
  const capture = loadHarnessCapture({ capturePath: options.capturePath });
  const captureCompatibility = /** @type {Record<string, unknown>} */ (capture.compatibility ?? {});
  const stepClass = captureCompatibility.step_class;
  if (typeof stepClass !== "string" || stepClass.length === 0) {
    throw new Error("Harness capture is missing compatibility.step_class and cannot be replayed.");
  }

  const currentStep = executeRoutedStep({
    cwd: options.cwd,
    projectRef: options.projectRef,
    projectProfile: options.projectProfile,
    runtimeRoot: options.runtimeRoot,
    stepClass,
    dryRun: true,
  });

  const compatibility = compareHarnessCompatibility({
    capture,
    currentStepResult: currentStep.stepResult,
  });

  let replayEvaluationReportPath = null;
  let replayEvaluationReportId = null;
  let comparable = false;
  let replayStatus = "incompatible";
  let baselineStatus = null;
  let baselinePassRate = null;
  let replayPassRate = null;

  const scoringSnapshot = /** @type {Record<string, unknown>} */ (capture.scoring_snapshot ?? {});
  const baselineSummary = /** @type {Record<string, unknown>} */ (scoringSnapshot.summary_metrics ?? {});
  baselineStatus = typeof scoringSnapshot.status === "string" ? scoringSnapshot.status : null;
  baselinePassRate =
    typeof baselineSummary.aggregate_pass_rate === "number" ? baselineSummary.aggregate_pass_rate : null;

  if (compatibility.compatible) {
    const suiteRef = capture.suite_ref;
    const subjectRef = capture.subject_ref;
    if (typeof suiteRef !== "string" || typeof subjectRef !== "string") {
      throw new Error("Harness capture is missing suite_ref or subject_ref required for replay scoring.");
    }

    const replayEval = runEvaluationSuite({
      cwd: options.cwd,
      projectRef: options.projectRef,
      projectProfile: options.projectProfile,
      runtimeRoot: options.runtimeRoot,
      suiteRef,
      subjectRef,
    });

    replayEvaluationReportPath = replayEval.evaluationReportPath;
    replayEvaluationReportId = replayEval.evaluationReport.report_id;
    replayPassRate =
      typeof replayEval.evaluationReport.summary_metrics?.aggregate_pass_rate === "number"
        ? replayEval.evaluationReport.summary_metrics.aggregate_pass_rate
        : null;

    comparable =
      baselineStatus === replayEval.evaluationReport.status &&
      baselinePassRate !== null &&
      replayPassRate !== null &&
      baselinePassRate === replayPassRate;
    replayStatus = comparable ? "pass" : "fail";
  }

  const replayReport = {
    replay_id: `${currentStep.projectId}.harness.replay.${Date.now()}`,
    capture_id: capture.capture_id ?? null,
    status: replayStatus,
    compatibility: {
      compatible: compatibility.compatible,
      mismatches: compatibility.mismatches,
      expected: compatibility.expected,
      actual: compatibility.actual,
    },
    baseline_snapshot: {
      status: baselineStatus,
      aggregate_pass_rate: baselinePassRate,
    },
    replay_snapshot: {
      evaluation_report_id: replayEvaluationReportId,
      evaluation_report_ref: replayEvaluationReportPath,
      aggregate_pass_rate: replayPassRate,
      comparable,
    },
    blocked_next_step:
      compatibility.compatible === false
        ? "Refresh harness capture from current route/wrapper/policy/adapter versions and replay again."
        : null,
    evidence_refs: [path.resolve(options.capturePath), currentStep.stepResultPath, replayEvaluationReportPath].filter(
      (entry) => typeof entry === "string",
    ),
  };

  const replayReportPath = path.join(
    currentStep.runtimeLayout.reportsRoot,
    `harness-replay-${normalizeForFileName(String(replayReport.replay_id))}.json`,
  );
  fs.writeFileSync(replayReportPath, `${JSON.stringify(replayReport, null, 2)}\n`, "utf8");

  return {
    ...currentStep,
    replayReport,
    replayReportPath,
    replayEvaluationReportPath,
  };
}
