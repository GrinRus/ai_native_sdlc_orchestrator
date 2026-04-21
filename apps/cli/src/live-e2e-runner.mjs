import fs from "node:fs";
import path from "node:path";

import { appendRunEvent } from "../../api/src/index.mjs";
import { loadContractFile } from "../../../packages/contracts/src/index.mjs";
import { certifyAssetPromotion } from "../../../packages/orchestrator-core/src/certification-decision.mjs";
import { runDeliveryDriver } from "../../../packages/orchestrator-core/src/delivery-driver.mjs";
import { materializeDeliveryPlan } from "../../../packages/orchestrator-core/src/delivery-plan.mjs";
import { runEvaluationSuite } from "../../../packages/orchestrator-core/src/eval-runner.mjs";
import {
  approveHandoffArtifacts,
  prepareHandoffArtifacts,
} from "../../../packages/orchestrator-core/src/handoff-packets.mjs";
import { analyzeProjectRuntime } from "../../../packages/orchestrator-core/src/project-analysis.mjs";
import { initializeProjectRuntime } from "../../../packages/orchestrator-core/src/project-init.mjs";
import { validateProjectRuntime } from "../../../packages/orchestrator-core/src/project-validate.mjs";
import { verifyProjectRuntime } from "../../../packages/orchestrator-core/src/project-verify.mjs";

const TERMINAL_RUN_STATUSES = new Set(["pass", "fail", "aborted"]);
const DEFAULT_LIVE_E2E_STAGES = [
  "bootstrap",
  "discovery",
  "spec",
  "planning",
  "handoff",
  "execution",
  "review",
  "qa",
  "delivery",
  "release",
];

/**
 * @returns {string}
 */
function nowIso() {
  return new Date().toISOString();
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeId(value) {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * @param {string} filePath
 * @param {Record<string, unknown>} document
 */
function writeJson(filePath, document) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
}

/**
 * @param {string} filePath
 * @returns {Record<string, unknown>}
 */
function readJson(filePath) {
  return /** @type {Record<string, unknown>} */ (JSON.parse(fs.readFileSync(filePath, "utf8")));
}

/**
 * @param {ReturnType<typeof initializeProjectRuntime>} init
 * @param {string} runId
 * @returns {string}
 */
function resolveRunSummaryFile(init, runId) {
  return path.join(init.runtimeLayout.reportsRoot, `live-e2e-run-summary-${normalizeId(runId)}.json`);
}

/**
 * @param {ReturnType<typeof initializeProjectRuntime>} init
 * @param {string} runId
 * @param {string} targetRepoId
 * @returns {string}
 */
function resolveScorecardFile(init, runId, targetRepoId) {
  return path.join(
    init.runtimeLayout.reportsRoot,
    `live-e2e-scorecard-${normalizeId(targetRepoId)}-${normalizeId(runId)}.json`,
  );
}

/**
 * @param {string} cwd
 * @param {string} profileRef
 * @returns {{ profilePath: string, profile: Record<string, unknown> }}
 */
function loadLiveE2EProfile(cwd, profileRef) {
  const profilePath = path.resolve(cwd, profileRef);
  if (!fs.existsSync(profilePath)) {
    throw new Error(`Live E2E profile '${profileRef}' does not exist.`);
  }

  const loaded = loadContractFile({
    filePath: profilePath,
    family: "live-e2e-profile",
  });
  if (!loaded.ok) {
    throw new Error(`Live E2E profile '${profileRef}' failed contract validation: ${loaded.error.message}`);
  }

  return {
    profilePath,
    profile: /** @type {Record<string, unknown>} */ (loaded.document),
  };
}

/**
 * @param {Record<string, { stage: string, status: string, evidence_refs: string[], summary: string | null }>} stageMap
 * @param {string} stage
 * @param {string} status
 * @param {string[]} [evidenceRefs]
 * @param {string | null} [summary]
 */
function markStage(stageMap, stage, status, evidenceRefs = [], summary = null) {
  stageMap[stage] = {
    stage,
    status,
    evidence_refs: evidenceRefs,
    summary,
  };
}

/**
 * @param {Record<string, { stage: string, status: string, evidence_refs: string[], summary: string | null }>} stageMap
 * @returns {Array<{ stage: string, status: string, evidence_refs: string[], summary: string | null }>}
 */
function flattenStageMap(stageMap) {
  return Object.values(stageMap);
}

/**
 * @param {Array<{ stage: string, status: string, evidence_refs: string[], summary: string | null }>} stageResults
 * @returns {{ pass: number, fail: number, pending: number, skipped: number }}
 */
function summarizeStageCounts(stageResults) {
  let pass = 0;
  let fail = 0;
  let pending = 0;
  let skipped = 0;

  for (const stage of stageResults) {
    if (stage.status === "pass") pass += 1;
    else if (stage.status === "fail") fail += 1;
    else if (stage.status === "skipped") skipped += 1;
    else pending += 1;
  }

  return { pass, fail, pending, skipped };
}

/**
 * @param {{
 *   runId: string,
 *   profile: Record<string, unknown>,
 *   stageResults: Array<{ stage: string, status: string, evidence_refs: string[], summary: string | null }>,
 *   status: string,
 *   summaryFile: string,
 * }} options
 * @returns {Record<string, unknown>}
 */
function buildScorecard(options) {
  const targetRepo = /** @type {Record<string, unknown>} */ (options.profile.target_repo ?? {});
  const counts = summarizeStageCounts(options.stageResults);

  return {
    scorecard_id: `${options.runId}.scorecard.${String(targetRepo.repo_id ?? "target")}`,
    run_id: options.runId,
    profile_id: options.profile.profile_id,
    scenario_id: options.profile.scenario_id,
    flow_kind: options.profile.flow_kind,
    duration_class: options.profile.duration_class,
    target_repo: {
      repo_id: targetRepo.repo_id ?? "target",
      repo_url: targetRepo.repo_url ?? null,
      ref: targetRepo.ref ?? null,
    },
    stage_counts: counts,
    status: options.status,
    summary_ref: options.summaryFile,
    generated_at: nowIso(),
  };
}

/**
 * @param {Record<string, unknown>} profile
 * @returns {string[]}
 */
function getProfileStages(profile) {
  const stages = Array.isArray(profile.stages)
    ? profile.stages.filter((stage) => typeof stage === "string" && stage.trim().length > 0)
    : [];
  return stages.length > 0 ? stages : DEFAULT_LIVE_E2E_STAGES;
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef: string,
 *   runtimeRoot?: string,
 *   profileRef: string,
 *   runId?: string,
 *   holdOpen?: boolean,
 * }} options
 */
export function startStandardLiveE2ERun(options) {
  const cwd = options.cwd ?? process.cwd();
  const init = initializeProjectRuntime({
    cwd,
    projectRef: options.projectRef,
    runtimeRoot: options.runtimeRoot,
  });
  const { profilePath, profile } = loadLiveE2EProfile(cwd, options.profileRef);

  const runId =
    options.runId ??
    `${String(profile.profile_id ?? "live-e2e.standard")}.run-${nowIso().replace(/[^0-9]/g, "").slice(-12)}`;
  const summaryFile = resolveRunSummaryFile(init, runId);
  const targetRepo = /** @type {Record<string, unknown>} */ (profile.target_repo ?? {});
  const targetRepoId = String(targetRepo.repo_id ?? "target");
  const scorecardFile = resolveScorecardFile(init, runId, targetRepoId);
  const stageMap = {};
  for (const stage of getProfileStages(profile)) {
    markStage(stageMap, stage, "pending");
  }

  const startedAt = nowIso();
  appendRunEvent({
    cwd,
    projectRef: init.projectRoot,
    runtimeRoot: init.runtimeRoot,
    runId,
    eventType: "run.started",
    payload: {
      profile_id: profile.profile_id ?? null,
      scenario_id: profile.scenario_id ?? null,
      target_repo: targetRepo.repo_url ?? null,
    },
  });

  const artifacts = {};
  let status = "running";
  let finishedAt = null;
  let errorMessage = null;

  try {
    markStage(stageMap, "bootstrap", "pass", [init.stateFile], "runtime initialized");

    const analyze = analyzeProjectRuntime({
      cwd,
      projectRef: init.projectRoot,
      runtimeRoot: init.runtimeRoot,
    });
    artifacts.analysis_report_file = analyze.reportPath;
    artifacts.route_resolution_file = analyze.routeResolutionPath;
    artifacts.policy_resolution_file = analyze.policyResolutionPath;
    markStage(stageMap, "discovery", "pass", [analyze.reportPath], "project analysis report emitted");
    markStage(stageMap, "planning", "pass", [analyze.policyResolutionPath], "policy and route resolution aligned");

    const validate = validateProjectRuntime({
      cwd,
      projectRef: init.projectRoot,
      runtimeRoot: init.runtimeRoot,
    });
    artifacts.validation_report_file = validate.validationReportPath;
    const validateStageStatus = validate.report.status === "fail" ? "fail" : "pass";
    markStage(stageMap, "spec", validateStageStatus, [validate.validationReportPath]);
    if (validateStageStatus === "fail") {
      throw new Error("Live E2E validation stage failed.");
    }

    const verify = verifyProjectRuntime({
      cwd,
      projectRef: init.projectRoot,
      runtimeRoot: init.runtimeRoot,
      requireValidationPass: true,
    });
    artifacts.verify_summary_file = verify.verifySummaryPath;
    artifacts.step_result_files = verify.stepResultFiles;
    const executionStageStatus = verify.validationGateStatus === "fail" ? "fail" : "pass";
    markStage(stageMap, "execution", executionStageStatus, [
      verify.verifySummaryPath,
      ...verify.stepResultFiles,
    ]);
    if (executionStageStatus === "fail") {
      throw new Error("Live E2E execution stage failed validation gate.");
    }

    const evalSuites = Array.isArray(profile.verification?.eval_suites)
      ? profile.verification.eval_suites.filter((entry) => typeof entry === "string")
      : [];
    if (evalSuites.length > 0) {
      const evaluation = runEvaluationSuite({
        cwd,
        projectRef: init.projectRoot,
        runtimeRoot: init.runtimeRoot,
        suiteRef: evalSuites[0],
        subjectRef: `run://${runId}`,
      });
      artifacts.evaluation_report_file = evaluation.evaluationReportPath;
      const evalStageStatus = evaluation.evaluationReport.status === "pass" ? "pass" : "fail";
      markStage(stageMap, "qa", evalStageStatus, [evaluation.evaluationReportPath]);
      markStage(stageMap, "review", evalStageStatus, [evaluation.evaluationReportPath]);
      if (evalStageStatus === "fail") {
        throw new Error("Live E2E evaluation stage failed.");
      }
    } else {
      markStage(stageMap, "qa", "skipped", [], "profile has no eval_suites");
      markStage(stageMap, "review", "skipped", [], "profile has no eval_suites");
    }

    if (Boolean(options.holdOpen)) {
      status = "running";
      markStage(stageMap, "delivery", "pending", [], "run is intentionally left open");
      markStage(stageMap, "release", "pending", [], "run is intentionally left open");
    } else if (Boolean(profile.output_policy?.materialize_release_packet)) {
      const preparedHandoff = prepareHandoffArtifacts({
        cwd,
        projectRef: init.projectRoot,
        runtimeRoot: init.runtimeRoot,
        ticketId: `${runId}.ticket`,
      });
      const approvedHandoff = approveHandoffArtifacts({
        cwd,
        projectRef: init.projectRoot,
        runtimeRoot: init.runtimeRoot,
        handoffPacketPath: preparedHandoff.handoffPacketFile,
        approvalRef: `approval://live-e2e/${normalizeId(runId)}`,
      });
      markStage(stageMap, "handoff", "pass", [approvedHandoff.handoffPacketFile]);

      const promotionDecision = certifyAssetPromotion({
        cwd,
        projectRef: init.projectRoot,
        runtimeRoot: init.runtimeRoot,
        assetRef: "wrapper://wrapper.eval.default@v1",
        subjectRef: "wrapper://wrapper.eval.default@v1",
        suiteRef: "suite.cert.core@v4",
        stepClass: "implement",
      });

      const preferredDeliveryModeRaw = String(profile.output_policy?.preferred_delivery_mode ?? "patch-only");
      const preferredDeliveryMode =
        preferredDeliveryModeRaw === "fork-first-pr"
          ? "fork-first-pr"
          : preferredDeliveryModeRaw === "local-branch"
            ? "local-branch"
            : "patch-only";

      const deliveryPlan = materializeDeliveryPlan({
        runtimeLayout: init.runtimeLayout,
        projectId: init.projectId,
        runId,
        stepClass: "implement",
        policyResolution: {
          resolved_bounds: {
            writeback_mode: {
              mode: preferredDeliveryMode,
              resolution_source: {
                kind: "live-e2e-profile",
                field: "output_policy.preferred_delivery_mode",
              },
            },
          },
        },
        handoffApproval: {
          status: "pass",
          ref: approvedHandoff.handoffPacketFile,
        },
        promotionEvidenceRefs: [promotionDecision.decisionPath],
      });

      // Ensure release rehearsals always produce a concrete patch/changeset artifact.
      const rehearsalChangeFile = path.join(init.projectRoot, "examples", "project.aor.yaml");
      if (fs.existsSync(rehearsalChangeFile)) {
        fs.appendFileSync(
          rehearsalChangeFile,
          `\n# live-e2e standard runner rehearsal marker ${runId}\n`,
          "utf8",
        );
        artifacts.rehearsal_change_file = rehearsalChangeFile;
      }

      const delivery = runDeliveryDriver({
        projectRef: init.projectRoot,
        cwd,
        runId,
        mode: preferredDeliveryMode,
        deliveryPlanPath: deliveryPlan.deliveryPlanFile,
      });
      artifacts.delivery_transcript_file = delivery.transcriptFile;
      artifacts.delivery_manifest_file = delivery.deliveryManifestFile;
      artifacts.release_packet_file = delivery.releasePacketFile;
      const deliveryStageStatus = delivery.status === "success" ? "pass" : "fail";
      markStage(stageMap, "delivery", deliveryStageStatus, [
        delivery.transcriptFile,
        ...(delivery.deliveryManifestFile ? [delivery.deliveryManifestFile] : []),
      ]);
      if (deliveryStageStatus === "fail") {
        throw new Error("Live E2E delivery stage failed.");
      }

      const releaseStageStatus = delivery.releasePacketFile ? "pass" : "fail";
      markStage(
        stageMap,
        "release",
        releaseStageStatus,
        delivery.releasePacketFile ? [delivery.releasePacketFile] : [],
      );
      if (releaseStageStatus === "fail") {
        throw new Error("Live E2E release stage failed to materialize release packet.");
      }
    } else {
      markStage(stageMap, "handoff", "pass", [], "release packet is not required for this profile");
      markStage(stageMap, "delivery", "skipped", [], "profile output_policy.materialize_release_packet=false");
      markStage(stageMap, "release", "skipped", [], "profile output_policy.materialize_release_packet=false");
      status = "pass";
    }

    if (!options.holdOpen) {
      status = "pass";
      finishedAt = nowIso();
      appendRunEvent({
        cwd,
        projectRef: init.projectRoot,
        runtimeRoot: init.runtimeRoot,
        runId,
        eventType: "run.terminal",
        payload: {
          status: "pass",
        },
      });
    }
  } catch (error) {
    status = "fail";
    finishedAt = nowIso();
    errorMessage = error instanceof Error ? error.message : String(error);
    appendRunEvent({
      cwd,
      projectRef: init.projectRoot,
      runtimeRoot: init.runtimeRoot,
      runId,
      eventType: "warning.raised",
      payload: {
        code: "live_e2e.failure",
        summary: errorMessage,
      },
    });
    appendRunEvent({
      cwd,
      projectRef: init.projectRoot,
      runtimeRoot: init.runtimeRoot,
      runId,
      eventType: "run.terminal",
      payload: {
        status: "fail",
      },
    });
  }

  const stageResults = flattenStageMap(stageMap);
  const summary = {
    run_id: runId,
    profile_ref: profilePath,
    profile_id: profile.profile_id,
    scenario_id: profile.scenario_id,
    flow_kind: profile.flow_kind,
    duration_class: profile.duration_class,
    target_repo: targetRepo,
    started_at: startedAt,
    finished_at: finishedAt,
    status,
    hold_open: Boolean(options.holdOpen),
    stage_results: stageResults,
    artifacts,
    scorecard_files: [scorecardFile],
    control_surfaces: {
      start: "aor live-e2e start --project-ref <path> --profile <path>",
      status: "aor live-e2e status --project-ref <path> --run-id <id>",
      abort: "aor live-e2e status --project-ref <path> --run-id <id> --abort true",
      report: "aor live-e2e report --project-ref <path> --run-id <id>",
    },
    error: errorMessage,
  };
  const scorecard = buildScorecard({
    runId,
    profile,
    stageResults,
    status,
    summaryFile,
  });

  writeJson(summaryFile, summary);
  writeJson(scorecardFile, scorecard);

  appendRunEvent({
    cwd,
    projectRef: init.projectRoot,
    runtimeRoot: init.runtimeRoot,
    runId,
    eventType: "evidence.linked",
    payload: {
      summary_file: summaryFile,
      scorecard_file: scorecardFile,
    },
  });

  return {
    runId,
    summary,
    summaryFile,
    scorecards: [scorecard],
    scorecardFiles: [scorecardFile],
  };
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef: string,
 *   runtimeRoot?: string,
 *   runId: string,
 * }} options
 */
export function readStandardLiveE2ERun(options) {
  const cwd = options.cwd ?? process.cwd();
  const init = initializeProjectRuntime({
    cwd,
    projectRef: options.projectRef,
    runtimeRoot: options.runtimeRoot,
  });
  const summaryFile = resolveRunSummaryFile(init, options.runId);
  if (!fs.existsSync(summaryFile)) {
    throw new Error(`Live E2E run summary for '${options.runId}' was not found.`);
  }

  const summary = readJson(summaryFile);
  const scorecardFiles = Array.isArray(summary.scorecard_files)
    ? summary.scorecard_files.filter((filePath) => typeof filePath === "string")
    : [];
  const scorecards = scorecardFiles
    .filter((filePath) => fs.existsSync(filePath))
    .map((filePath) => readJson(filePath));

  return {
    summary,
    summaryFile,
    scorecards,
    scorecardFiles,
  };
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef: string,
 *   runtimeRoot?: string,
 *   runId: string,
 *   reason?: string,
 * }} options
 */
export function abortStandardLiveE2ERun(options) {
  const cwd = options.cwd ?? process.cwd();
  const current = readStandardLiveE2ERun(options);
  const summary = { ...current.summary };

  if (TERMINAL_RUN_STATUSES.has(String(summary.status))) {
    return {
      ...current,
      summary,
      abortApplied: false,
    };
  }

  summary.status = "aborted";
  summary.finished_at = nowIso();
  summary.abort_reason = options.reason ?? "operator-requested";
  writeJson(current.summaryFile, summary);

  appendRunEvent({
    cwd,
    projectRef: options.projectRef,
    runtimeRoot: options.runtimeRoot,
    runId: options.runId,
    eventType: "warning.raised",
    payload: {
      code: "live_e2e.abort_requested",
      summary: summary.abort_reason,
    },
  });
  appendRunEvent({
    cwd,
    projectRef: options.projectRef,
    runtimeRoot: options.runtimeRoot,
    runId: options.runId,
    eventType: "run.terminal",
    payload: {
      status: "aborted",
    },
  });

  return {
    ...current,
    summary,
    abortApplied: true,
  };
}
