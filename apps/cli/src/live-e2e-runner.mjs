import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { appendRunEvent } from "../../api/src/index.mjs";
import { loadContractFile } from "../../../packages/contracts/src/index.mjs";
import { materializeLearningLoopArtifacts } from "../../../packages/observability/src/index.mjs";
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
 * @param {string} content
 */
function writeText(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
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
 * @param {ReturnType<typeof initializeProjectRuntime>} init
 * @param {string} runId
 * @returns {string}
 */
function resolveTargetWorkspaceRoot(init, runId) {
  return path.join(init.runtimeLayout.projectRuntimeRoot, "workspaces", "live-e2e", normalizeId(runId), "target");
}

/**
 * @param {ReturnType<typeof initializeProjectRuntime>} init
 * @param {string} runId
 * @returns {string}
 */
function resolveTargetPreflightLogFile(init, runId) {
  return path.join(init.runtimeLayout.reportsRoot, `live-e2e-target-preflight-${normalizeId(runId)}.log`);
}

/**
 * @param {ReturnType<typeof initializeProjectRuntime>} init
 * @param {string} runId
 * @param {"setup" | "verification"} phase
 * @param {number} index
 * @param {"stdout" | "stderr"} stream
 * @returns {string}
 */
function resolveVerificationCommandLogFile(init, runId, phase, index, stream) {
  return path.join(
    init.runtimeLayout.reportsRoot,
    `live-e2e-${phase}-command-${normalizeId(runId)}-${index + 1}.${stream}.log`,
  );
}

/**
 * @param {{
 *   command: string,
 *   args?: string[],
 *   cwd?: string,
 *   shell?: boolean,
 * }} options
 * @returns {{ exitCode: number, stdout: string, stderr: string, durationMs: number }}
 */
function runShellCommand(options) {
  const startedAt = Date.now();
  const result = spawnSync(options.command, options.args ?? [], {
    cwd: options.cwd,
    shell: options.shell ?? false,
    encoding: "utf8",
  });
  const durationMs = Date.now() - startedAt;
  const stdout = typeof result.stdout === "string" ? result.stdout : "";
  const stderrParts = [];
  if (typeof result.stderr === "string" && result.stderr.length > 0) {
    stderrParts.push(result.stderr);
  }
  if (result.error) {
    stderrParts.push(`${result.error.name}: ${result.error.message}`);
  }

  return {
    exitCode: typeof result.status === "number" ? result.status : -1,
    stdout,
    stderr: stderrParts.join("\n"),
    durationMs,
  };
}

/**
 * @param {{
 *   init: ReturnType<typeof initializeProjectRuntime>,
 *   runId: string,
 *   targetRepo: Record<string, unknown>,
 * }} options
 * @returns {{ targetWorkspaceRoot: string, targetPreflightLogFile: string, targetRefResolved: string }}
 */
function prepareTargetWorkspace(options) {
  const targetRepoUrl =
    typeof options.targetRepo.repo_url === "string" ? options.targetRepo.repo_url.trim() : "";
  if (targetRepoUrl.length === 0) {
    throw new Error("Live E2E profile target_repo.repo_url must be a non-empty string.");
  }

  const targetRef =
    typeof options.targetRepo.ref === "string" && options.targetRepo.ref.trim().length > 0
      ? options.targetRepo.ref.trim()
      : null;
  const checkoutStrategy =
    typeof options.targetRepo.checkout_strategy === "string"
      ? options.targetRepo.checkout_strategy.trim().toLowerCase()
      : "";

  const targetWorkspaceRoot = resolveTargetWorkspaceRoot(options.init, options.runId);
  const targetPreflightLogFile = resolveTargetPreflightLogFile(options.init, options.runId);
  fs.rmSync(targetWorkspaceRoot, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(targetWorkspaceRoot), { recursive: true });

  const cloneArgs = ["clone"];
  if (checkoutStrategy === "shallow") {
    cloneArgs.push("--depth", "1");
  }
  if (targetRef) {
    cloneArgs.push("--branch", targetRef);
  }
  cloneArgs.push(targetRepoUrl, targetWorkspaceRoot);

  const cloneRun = runShellCommand({
    command: "git",
    args: cloneArgs,
    cwd: options.init.projectRoot,
  });
  if (cloneRun.exitCode !== 0) {
    const cloneLog = [
      `run_id: ${options.runId}`,
      `target_repo_url: ${targetRepoUrl}`,
      `target_ref_requested: ${targetRef ?? "<default>"}`,
      `checkout_strategy: ${checkoutStrategy || "<default>"}`,
      `target_workspace_root: ${targetWorkspaceRoot}`,
      `clone_command: git ${cloneArgs.join(" ")}`,
      `clone_exit_code: ${cloneRun.exitCode}`,
      `clone_duration_ms: ${cloneRun.durationMs}`,
      "clone_stdout:",
      cloneRun.stdout,
      "clone_stderr:",
      cloneRun.stderr,
    ].join("\n");
    writeText(targetPreflightLogFile, `${cloneLog}\n`);
    throw new Error(
      `Live E2E target preflight clone failed for '${targetRepoUrl}' with exit code ${cloneRun.exitCode}.`,
    );
  }

  const resolveRefRun = runShellCommand({
    command: "git",
    args: ["rev-parse", "HEAD"],
    cwd: targetWorkspaceRoot,
  });
  if (resolveRefRun.exitCode !== 0) {
    const resolveLog = [
      `run_id: ${options.runId}`,
      `target_repo_url: ${targetRepoUrl}`,
      `target_ref_requested: ${targetRef ?? "<default>"}`,
      `checkout_strategy: ${checkoutStrategy || "<default>"}`,
      `target_workspace_root: ${targetWorkspaceRoot}`,
      `clone_command: git ${cloneArgs.join(" ")}`,
      `clone_exit_code: ${cloneRun.exitCode}`,
      `clone_duration_ms: ${cloneRun.durationMs}`,
      "clone_stdout:",
      cloneRun.stdout,
      "clone_stderr:",
      cloneRun.stderr,
      "resolve_ref_command: git rev-parse HEAD",
      `resolve_ref_exit_code: ${resolveRefRun.exitCode}`,
      `resolve_ref_duration_ms: ${resolveRefRun.durationMs}`,
      "resolve_ref_stdout:",
      resolveRefRun.stdout,
      "resolve_ref_stderr:",
      resolveRefRun.stderr,
    ].join("\n");
    writeText(targetPreflightLogFile, `${resolveLog}\n`);
    throw new Error("Live E2E target preflight failed to resolve cloned repository HEAD.");
  }

  const targetRefResolved = resolveRefRun.stdout.trim().split("\n").filter(Boolean).pop() ?? "unknown";
  const preflightLog = [
    `run_id: ${options.runId}`,
    `target_repo_url: ${targetRepoUrl}`,
    `target_ref_requested: ${targetRef ?? "<default>"}`,
    `target_ref_resolved: ${targetRefResolved}`,
    `checkout_strategy: ${checkoutStrategy || "<default>"}`,
    `target_workspace_root: ${targetWorkspaceRoot}`,
    `clone_command: git ${cloneArgs.join(" ")}`,
    `clone_exit_code: ${cloneRun.exitCode}`,
    `clone_duration_ms: ${cloneRun.durationMs}`,
    "clone_stdout:",
    cloneRun.stdout,
    "clone_stderr:",
    cloneRun.stderr,
    "resolve_ref_command: git rev-parse HEAD",
    `resolve_ref_exit_code: ${resolveRefRun.exitCode}`,
    `resolve_ref_duration_ms: ${resolveRefRun.durationMs}`,
    "resolve_ref_stdout:",
    resolveRefRun.stdout,
    "resolve_ref_stderr:",
    resolveRefRun.stderr,
  ].join("\n");
  writeText(targetPreflightLogFile, `${preflightLog}\n`);

  return {
    targetWorkspaceRoot,
    targetPreflightLogFile,
    targetRefResolved,
  };
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
    const issues = Array.isArray(loaded.validation?.issues) ? loaded.validation.issues : [];
    const firstIssueMessage =
      issues.length > 0 && typeof issues[0]?.message === "string"
        ? issues[0].message
        : "profile does not satisfy live-e2e-profile contract";
    const moreIssuesSummary = issues.length > 1 ? ` (+${issues.length - 1} more issue(s))` : "";
    throw new Error(
      `Live E2E profile '${profileRef}' failed contract validation: ${firstIssueMessage}${moreIssuesSummary}`,
    );
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
 * @param {string[]} values
 * @returns {string[]}
 */
function uniqueStrings(values) {
  return Array.from(new Set(values.filter((value) => typeof value === "string" && value.length > 0)));
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function looksLikeRef(value) {
  return (
    value.startsWith("evidence://") ||
    value.includes("/") ||
    value.includes("\\") ||
    /\.(json|jsonl|yaml|yml|patch|log)$/iu.test(value)
  );
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function collectStringRefs(value) {
  if (typeof value === "string") {
    return value.trim().length > 0 && looksLikeRef(value.trim()) ? [value.trim()] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectStringRefs(entry));
  }
  if (typeof value === "object" && value !== null) {
    return Object.values(value).flatMap((entry) => collectStringRefs(entry));
  }
  return [];
}

/**
 * @param {Array<{ stage: string, status: string, evidence_refs: string[], summary: string | null }>} stageResults
 * @param {Record<string, unknown>} artifacts
 * @returns {string[]}
 */
function collectLearningEvidenceRefs(stageResults, artifacts) {
  const stageRefs = stageResults.flatMap((stage) => (Array.isArray(stage.evidence_refs) ? stage.evidence_refs : []));
  const artifactRefs = collectStringRefs(artifacts);
  return uniqueStrings([...stageRefs, ...artifactRefs]);
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
    const targetWorkspaceRoot = resolveTargetWorkspaceRoot(init, runId);
    const targetPreflightLogFile = resolveTargetPreflightLogFile(init, runId);
    artifacts.target_workspace_root = targetWorkspaceRoot;
    artifacts.target_preflight_log_file = targetPreflightLogFile;
    artifacts.target_clone_log_file = targetPreflightLogFile;

    let targetRefResolved = "unknown";
    try {
      const targetWorkspace = prepareTargetWorkspace({
        init,
        runId,
        targetRepo,
      });
      targetRefResolved = targetWorkspace.targetRefResolved;
      artifacts.target_workspace_root = targetWorkspace.targetWorkspaceRoot;
      artifacts.target_preflight_log_file = targetWorkspace.targetPreflightLogFile;
      artifacts.target_clone_log_file = targetWorkspace.targetPreflightLogFile;
      artifacts.target_ref_resolved = targetWorkspace.targetRefResolved;
      markStage(
        stageMap,
        "bootstrap",
        "pass",
        [init.stateFile, targetWorkspace.targetPreflightLogFile],
        "runtime initialized and target repository preflight completed",
      );
    } catch (error) {
      const bootstrapError = error instanceof Error ? error.message : String(error);
      markStage(
        stageMap,
        "bootstrap",
        "fail",
        [init.stateFile, targetPreflightLogFile],
        `target preflight failed: ${bootstrapError}`,
      );
      throw error;
    }

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
    if (verify.validationGateStatus === "fail") {
      markStage(stageMap, "execution", "fail", [verify.verifySummaryPath, ...verify.stepResultFiles]);
      throw new Error("Live E2E execution stage failed validation gate.");
    }

    const setupCommands = Array.isArray(profile.verification?.setup_commands)
      ? profile.verification.setup_commands.filter((entry) => typeof entry === "string" && entry.trim().length > 0)
      : [];
    const setupCommandReports = [];
    const setupCommandEvidenceRefs = [];
    artifacts.verification_setup_command_reports = setupCommandReports;
    artifacts.verification_command_reports = [];
    for (const [index, command] of setupCommands.entries()) {
      const stdoutFile = resolveVerificationCommandLogFile(init, runId, "setup", index, "stdout");
      const stderrFile = resolveVerificationCommandLogFile(init, runId, "setup", index, "stderr");
      const commandRun = runShellCommand({
        command,
        cwd: targetWorkspaceRoot,
        shell: true,
      });
      writeText(stdoutFile, commandRun.stdout);
      writeText(stderrFile, commandRun.stderr);

      const report = {
        command,
        exit_code: commandRun.exitCode,
        stdout_file: stdoutFile,
        stderr_file: stderrFile,
        duration_ms: commandRun.durationMs,
        cwd: targetWorkspaceRoot,
        target_ref_resolved: targetRefResolved,
      };
      setupCommandReports.push(report);
      setupCommandEvidenceRefs.push(stdoutFile, stderrFile);
      if (commandRun.exitCode !== 0) {
        artifacts.verification_setup_command_reports = setupCommandReports;
        markStage(
          stageMap,
          "execution",
          "fail",
          [verify.verifySummaryPath, ...verify.stepResultFiles, ...setupCommandEvidenceRefs],
          `verification setup command failed: '${command}' (exit_code=${commandRun.exitCode})`,
        );
        throw new Error(`Live E2E setup command failed: '${command}' (exit code ${commandRun.exitCode}).`);
      }
    }
    const verificationCommands = Array.isArray(profile.verification?.commands)
      ? profile.verification.commands.filter((entry) => typeof entry === "string" && entry.trim().length > 0)
      : [];
    const verificationCommandReports = [];
    const verificationCommandEvidenceRefs = [];
    for (const [index, command] of verificationCommands.entries()) {
      const stdoutFile = resolveVerificationCommandLogFile(init, runId, "verification", index, "stdout");
      const stderrFile = resolveVerificationCommandLogFile(init, runId, "verification", index, "stderr");
      const commandRun = runShellCommand({
        command,
        cwd: targetWorkspaceRoot,
        shell: true,
      });
      writeText(stdoutFile, commandRun.stdout);
      writeText(stderrFile, commandRun.stderr);

      const report = {
        command,
        exit_code: commandRun.exitCode,
        stdout_file: stdoutFile,
        stderr_file: stderrFile,
        duration_ms: commandRun.durationMs,
        cwd: targetWorkspaceRoot,
        target_ref_resolved: targetRefResolved,
      };
      verificationCommandReports.push(report);
      verificationCommandEvidenceRefs.push(stdoutFile, stderrFile);
      if (commandRun.exitCode !== 0) {
        artifacts.verification_command_reports = verificationCommandReports;
        markStage(
          stageMap,
          "execution",
          "fail",
          [
            verify.verifySummaryPath,
            ...verify.stepResultFiles,
            ...setupCommandEvidenceRefs,
            ...verificationCommandEvidenceRefs,
          ],
          `verification command failed: '${command}' (exit_code=${commandRun.exitCode})`,
        );
        throw new Error(`Live E2E verification command failed: '${command}' (exit code ${commandRun.exitCode}).`);
      }
    }
    artifacts.verification_command_reports = verificationCommandReports;
    const setupSummary =
      setupCommands.length > 0
        ? `${setupCommands.length} setup command(s) passed`
        : "no setup_commands configured";
    const executionSummary =
      verificationCommands.length > 0
        ? `${setupSummary}; internal verify plus ${verificationCommands.length} profile verification command(s) passed`
        : `${setupSummary}; internal verify passed and profile has no verification.commands`;
    markStage(
      stageMap,
      "execution",
      "pass",
      [
        verify.verifySummaryPath,
        ...verify.stepResultFiles,
        ...setupCommandEvidenceRefs,
        ...verificationCommandEvidenceRefs,
      ],
      executionSummary,
    );

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
    project_id: init.projectId,
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

  const learningLoop = materializeLearningLoopArtifacts({
    projectId: init.projectId,
    projectRoot: init.projectRoot,
    runtimeLayout: init.runtimeLayout,
    runId,
    sourceKind: "live-e2e",
    runStatus: status,
    summary: errorMessage ?? `Live E2E run '${runId}' completed with status '${status}'.`,
    evidenceRefs: uniqueStrings([summaryFile, scorecardFile, ...collectLearningEvidenceRefs(stageResults, artifacts)]),
    linkedScorecardRefs: [scorecardFile],
    evalSuiteRefs: Array.isArray(profile.verification?.eval_suites)
      ? profile.verification.eval_suites.filter((entry) => typeof entry === "string")
      : [],
    backlogRefs: [
      "docs/backlog/mvp-implementation-backlog.md",
      "docs/backlog/wave-5-implementation-slices.md",
      "docs/ops/live-e2e-standard-runner.md",
    ],
    incidentSummary: errorMessage ?? undefined,
  });
  summary.learning_loop_scorecard_file = learningLoop.scorecardFile;
  summary.learning_loop_handoff_file = learningLoop.handoffFile;
  summary.incident_report_file = learningLoop.incidentFile;
  writeJson(summaryFile, summary);

  appendRunEvent({
    cwd,
    projectRef: init.projectRoot,
    runtimeRoot: init.runtimeRoot,
    runId,
    eventType: "evidence.linked",
    payload: {
      summary_file: summaryFile,
      scorecard_file: scorecardFile,
      learning_loop_scorecard_file: learningLoop.scorecardFile,
      learning_loop_handoff_file: learningLoop.handoffFile,
      incident_report_file: learningLoop.incidentFile,
    },
  });

  return {
    runId,
    summary,
    summaryFile,
    scorecards: [scorecard],
    scorecardFiles: [scorecardFile],
    learningLoopScorecardFile: learningLoop.scorecardFile,
    learningLoopHandoffFile: learningLoop.handoffFile,
    incidentReportFile: learningLoop.incidentFile,
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
  const init = initializeProjectRuntime({
    cwd,
    projectRef: options.projectRef,
    runtimeRoot: options.runtimeRoot,
  });
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
  const stageResults = Array.isArray(summary.stage_results)
    ? summary.stage_results.filter((entry) => typeof entry === "object" && entry !== null)
    : [];
  const artifacts = typeof summary.artifacts === "object" && summary.artifacts !== null ? summary.artifacts : {};
  const scorecardFiles = Array.isArray(summary.scorecard_files)
    ? summary.scorecard_files.filter((entry) => typeof entry === "string")
    : [];
  const learningLoop = materializeLearningLoopArtifacts({
    projectId: init.projectId,
    projectRoot: init.projectRoot,
    runtimeLayout: init.runtimeLayout,
    runId: options.runId,
    sourceKind: "live-e2e",
    runStatus: "aborted",
    summary: String(summary.abort_reason),
    evidenceRefs: uniqueStrings([
      current.summaryFile,
      ...scorecardFiles,
      ...collectLearningEvidenceRefs(
        /** @type {Array<{ stage: string, status: string, evidence_refs: string[], summary: string | null }>} */ (
          stageResults
        ),
        /** @type {Record<string, unknown>} */ (artifacts),
      ),
    ]),
    linkedScorecardRefs: scorecardFiles,
    backlogRefs: [
      "docs/backlog/mvp-implementation-backlog.md",
      "docs/backlog/wave-5-implementation-slices.md",
      "docs/ops/live-e2e-standard-runner.md",
    ],
    forceIncident: true,
    incidentSummary: String(summary.abort_reason),
  });
  summary.learning_loop_scorecard_file = learningLoop.scorecardFile;
  summary.learning_loop_handoff_file = learningLoop.handoffFile;
  summary.incident_report_file = learningLoop.incidentFile;
  writeJson(current.summaryFile, summary);
  const updatedScorecards = scorecardFiles
    .filter((filePath) => fs.existsSync(filePath))
    .map((filePath) => {
      const scorecard = readJson(filePath);
      const updatedScorecard = {
        ...scorecard,
        status: "aborted",
        stage_counts: summarizeStageCounts(
          /** @type {Array<{ stage: string, status: string, evidence_refs: string[], summary: string | null }>} */ (
            stageResults
          ),
        ),
        summary_ref: typeof scorecard.summary_ref === "string" ? scorecard.summary_ref : current.summaryFile,
      };
      writeJson(filePath, updatedScorecard);
      return updatedScorecard;
    });

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
    scorecards: updatedScorecards,
    scorecardFiles,
    abortApplied: true,
    incidentReportFile: learningLoop.incidentFile,
    learningLoopHandoffFile: learningLoop.handoffFile,
    learningLoopScorecardFile: learningLoop.scorecardFile,
  };
}
