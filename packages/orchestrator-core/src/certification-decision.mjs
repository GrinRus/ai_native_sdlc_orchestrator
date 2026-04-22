import fs from "node:fs";
import path from "node:path";

import { validateContractDocument } from "../../contracts/src/index.mjs";

import { captureHarnessReplayArtifact, replayHarnessCapture } from "./harness-capture-replay.mjs";
import { initializeProjectRuntime } from "./project-init.mjs";

const PROMOTION_CHANNEL_VALUES = new Set(["draft", "candidate", "stable", "frozen", "demoted"]);

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeForId(value) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+/, "").replace(/-+$/, "");
}

/**
 * @param {{ channel: string, flagName: string }} options
 */
function assertPromotionChannel(options) {
  if (!PROMOTION_CHANNEL_VALUES.has(options.channel)) {
    throw new Error(
      `Invalid ${options.flagName} '${options.channel}'. Expected one of: ${[...PROMOTION_CHANNEL_VALUES].join(", ")}.`,
    );
  }
}

/**
 * @param {{ evaluationStatus: string | null, replayStatus: string | null }} options
 * @returns {"pass" | "hold" | "fail"}
 */
export function resolveCertificationDecisionStatus(options) {
  if (options.evaluationStatus !== "pass") {
    return "fail";
  }

  if (options.replayStatus === "pass") {
    return "pass";
  }

  if (options.replayStatus === "fail") {
    return "fail";
  }

  return "hold";
}

/**
 * @param {{
 *  cwd?: string,
 *  projectRef?: string,
 *  projectProfile?: string,
 *  runtimeRoot?: string,
 *  assetRef: string,
 *  subjectRef: string,
 *  suiteRef?: string,
 *  stepClass?: string,
 *  fromChannel?: string,
 *  toChannel?: string,
 * }} options
 */
export function certifyAssetPromotion(options) {
  const init = initializeProjectRuntime(options);
  const fromChannel = options.fromChannel ?? "candidate";
  const toChannel = options.toChannel ?? "stable";

  assertPromotionChannel({ channel: fromChannel, flagName: "--from-channel" });
  assertPromotionChannel({ channel: toChannel, flagName: "--to-channel" });

  const captureResult = captureHarnessReplayArtifact({
    cwd: options.cwd,
    projectRef: options.projectRef,
    projectProfile: options.projectProfile,
    runtimeRoot: options.runtimeRoot,
    stepClass: options.stepClass ?? "implement",
    suiteRef: options.suiteRef ?? "suite.release.core@v1",
    subjectRef: options.subjectRef,
  });

  const replayResult = replayHarnessCapture({
    cwd: options.cwd,
    projectRef: options.projectRef,
    projectProfile: options.projectProfile,
    runtimeRoot: options.runtimeRoot,
    capturePath: captureResult.capturePath,
  });

  const evaluationStatus =
    typeof captureResult.evaluationReport.status === "string" ? captureResult.evaluationReport.status : null;
  const replayStatus =
    typeof replayResult.replayReport.status === "string" ? replayResult.replayReport.status : null;
  const decisionStatus = resolveCertificationDecisionStatus({ evaluationStatus, replayStatus });

  const decisionId = `${init.projectId}.promotion.${normalizeForId(options.assetRef)}.${Date.now()}`;
  const decision = {
    decision_id: decisionId,
    subject_ref: options.assetRef,
    from_channel: fromChannel,
    to_channel: toChannel,
    evidence_refs: [
      captureResult.evaluationReportPath,
      captureResult.capturePath,
      replayResult.replayReportPath,
      replayResult.replayEvaluationReportPath,
    ].filter((entry) => typeof entry === "string"),
    evidence_summary: {
      asset_ref: options.assetRef,
      subject_ref: options.subjectRef,
      suite_ref: captureResult.evaluationReport.suite_ref,
      evaluation_report_ref: captureResult.evaluationReportPath,
      harness_capture_ref: captureResult.capturePath,
      harness_replay_ref: replayResult.replayReportPath,
      replay_evaluation_report_ref: replayResult.replayEvaluationReportPath,
      harness_replay_status: replayStatus,
      evaluation_status: evaluationStatus,
      evidence_bar: {
        required: ["evaluation-report", "harness-capture", "harness-replay"],
        satisfied: [
          "evaluation-report",
          "harness-capture",
          "harness-replay",
          replayResult.replayEvaluationReportPath ? "replay-evaluation-report" : null,
        ].filter((entry) => entry !== null),
      },
    },
    status: decisionStatus,
  };

  const decisionValidation = validateContractDocument({
    family: "promotion-decision",
    document: decision,
    source: "runtime://promotion-decision",
  });
  if (!decisionValidation.ok) {
    const issueSummary = decisionValidation.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Generated promotion decision failed contract validation: ${issueSummary}`);
  }

  const decisionPath = path.join(
    init.runtimeLayout.artifactsRoot,
    `promotion-decision-${normalizeForId(options.assetRef)}-${Date.now()}.json`,
  );
  fs.writeFileSync(decisionPath, `${JSON.stringify(decision, null, 2)}\n`, "utf8");

  return {
    ...init,
    decision,
    decisionPath,
    evaluationReportPath: captureResult.evaluationReportPath,
    harnessCapturePath: captureResult.capturePath,
    harnessReplayPath: replayResult.replayReportPath,
    replayEvaluationReportPath: replayResult.replayEvaluationReportPath,
  };
}
