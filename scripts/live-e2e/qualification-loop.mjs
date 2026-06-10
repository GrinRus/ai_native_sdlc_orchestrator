#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  UsageError,
  asNonEmptyString,
  asRecord,
  asStringArray,
  normalizeId,
  nowIso,
  parseFlags,
  readJson,
  requireDirectory,
  resolveOptionalStringFlag,
  writeJson,
} from "./lib/common.mjs";
import {
  isFullJourneyProfile,
  loadProofRunnerProfile,
  normalizeFeatureSize,
  resolveCatalogRoot,
  resolveFullJourneyProfile,
} from "./lib/profile-catalog.mjs";
import {
  DEFAULT_PROVIDER_QUALIFICATION_PROVIDERS,
  buildProviderQualificationMatrix,
  extractQualificationFailureContext,
} from "./lib/provider-qualification-matrix.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const RUN_PROFILE_SCRIPT = path.join(SCRIPT_DIR, "run-profile.mjs");
const QUALIFYING_FEATURE_SIZES = new Set(["medium", "large"]);
const REQUIRED_PROVIDER_COUNTS = Object.freeze({
  "openai-primary": 2,
  "anthropic-primary": 2,
  "open-code-primary": 1,
});

/**
 * @param {string} cwd
 * @param {string[]} args
 * @returns {string}
 */
function runGitOutput(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new UsageError(`Unable to read git ${args.join(" ")} from '${cwd}': ${detail || "command failed"}.`);
  }
  return result.stdout.trim();
}

/**
 * @param {string} cwd
 * @param {string} ancestor
 * @param {string} descendant
 * @returns {boolean}
 */
function isGitAncestor(cwd, ancestor, descendant) {
  const result = spawnSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
    cwd,
    encoding: "utf8",
  });
  return result.status === 0;
}

/**
 * @param {string[]} rawArgs
 * @param {string} flagName
 */
function hasFlag(rawArgs, flagName) {
  return rawArgs.some((entry) => entry === `--${flagName}` || entry.startsWith(`--${flagName}=`));
}

/**
 * @param {string[]} rawArgs
 * @param {string} flagName
 */
function removeStringFlag(rawArgs, flagName) {
  const output = [];
  const prefix = `--${flagName}=`;
  for (let index = 0; index < rawArgs.length; index += 1) {
    if (rawArgs[index] === `--${flagName}`) {
      index += 1;
      continue;
    }
    if (rawArgs[index].startsWith(prefix)) {
      continue;
    }
    output.push(rawArgs[index]);
  }
  return output;
}

/**
 * @param {{
 *   profile: Record<string, unknown>,
 *   fullJourney: Record<string, unknown> | null,
 *   featureSize: string,
 * }}
 */
function buildExpectedSummaryIdentity(options) {
  const matrixCell = asRecord(options.fullJourney?.matrixCell);
  return {
    profile_id: asNonEmptyString(options.profile.profile_id),
    target_catalog_id: asNonEmptyString(matrixCell.target_catalog_id) || asNonEmptyString(options.profile.target_catalog_id),
    feature_mission_id: asNonEmptyString(matrixCell.feature_mission_id) || asNonEmptyString(options.profile.feature_mission_id),
    scenario_family: asNonEmptyString(matrixCell.scenario_family) || asNonEmptyString(options.profile.scenario_family),
    provider_variant_id: asNonEmptyString(matrixCell.provider_variant_id) || asNonEmptyString(options.profile.provider_variant_id),
    feature_size: options.featureSize,
  };
}

/**
 * @param {Record<string, unknown>} summary
 * @param {Record<string, string>} expected
 */
function assertRecordedSummaryMatchesProfile(summary, expected) {
  for (const [field, expectedValue] of Object.entries(expected)) {
    const actualValue = asNonEmptyString(summary[field]);
    if (!expectedValue) continue;
    if (!actualValue) {
      throw new UsageError(`Recorded run summary is missing '${field}', required to match the selected profile.`);
    }
    if (actualValue !== expectedValue) {
      throw new UsageError(
        `Recorded run summary '${field}' mismatch: expected '${expectedValue}' from selected profile, received '${actualValue}'.`,
      );
    }
  }
}

/**
 * @param {Record<string, unknown>} summary
 * @param {string} hostRoot
 */
function assertRecordedSummaryBelongsToCurrentGitLineage(summary, hostRoot) {
  const summaryCommit = asNonEmptyString(summary.commit_sha);
  if (!summaryCommit) {
    throw new UsageError("Recorded run summary is missing commit_sha; rerun live E2E with current run-profile metadata.");
  }
  if (!/^[0-9a-f]{40}$/iu.test(summaryCommit)) {
    throw new UsageError(`Recorded run summary commit_sha '${summaryCommit}' is not a full git commit SHA.`);
  }
  const headCommit = runGitOutput(hostRoot, ["rev-parse", "HEAD"]);
  if (!isGitAncestor(hostRoot, summaryCommit, headCommit)) {
    throw new UsageError(
      `Recorded run summary commit_sha '${summaryCommit}' is not an ancestor of current HEAD '${headCommit}'.`,
    );
  }
  const summaryBranch = asNonEmptyString(summary.branch_name);
  if (summaryBranch) {
    const currentBranch = runGitOutput(hostRoot, ["branch", "--show-current"]);
    if (currentBranch && summaryBranch !== currentBranch) {
      throw new UsageError(
        `Recorded run summary branch_name mismatch: expected current branch '${currentBranch}', received '${summaryBranch}'.`,
      );
    }
  }
}

/**
 * @param {string} summaryFile
 * @param {string} fileRef
 */
function resolveSummaryRelativePath(summaryFile, fileRef) {
  return path.isAbsolute(fileRef) ? fileRef : path.resolve(path.dirname(summaryFile), fileRef);
}

/**
 * @param {Record<string, unknown>} summary
 * @param {Record<string, unknown>} observationReport
 * @returns {"passed" | "needs_fix" | "blocked"}
 */
function classifyQualification(summary, observationReport) {
  if (asNonEmptyString(observationReport.report_status) === "in_progress") {
    return "blocked";
  }
  const canonical = asRecord(summary.canonical_status);
  const qualityJudgement = asRecord(summary.quality_judgement);
  const finalAnalysis = asRecord(observationReport.final_analysis);
  const stageResults = Array.isArray(summary.stage_results) ? summary.stage_results.map((entry) => asRecord(entry)) : [];
  const blockedStage = stageResults.find((entry) => {
    const stage = asNonEmptyString(entry.stage);
    const status = asNonEmptyString(entry.status);
    const summaryText = asNonEmptyString(entry.summary).toLowerCase();
    return (
      status === "fail" &&
      (["bootstrap", "install"].includes(stage) ||
        summaryText.includes("auth") ||
        summaryText.includes("permission") ||
        summaryText.includes("provider") ||
        summaryText.includes("safety"))
    );
  });
  if (blockedStage) return "blocked";
  if (
    asNonEmptyString(summary.status) === "pass" &&
    asNonEmptyString(canonical.acceptance_status) === "pass" &&
    asNonEmptyString(qualityJudgement.overall_status) !== "fail" &&
    asNonEmptyString(finalAnalysis.status) === "pass"
  ) {
    return "passed";
  }
  return "needs_fix";
}

/**
 * @param {{ summary: Record<string, unknown>, observationReport: Record<string, unknown>, status: "passed" | "needs_fix" | "blocked" }}
 */
function buildAnalysis(options) {
  const qualityJudgement = asRecord(options.summary.quality_judgement);
  const runnerQualitySummary = asRecord(options.summary.runner_quality_summary);
  const stepJournal = Array.isArray(options.observationReport.step_journal)
    ? options.observationReport.step_journal.map((entry) => asRecord(entry))
    : [];
  const failingSteps = stepJournal
    .filter((entry) => {
      const verdict = asNonEmptyString(entry.final_step_verdict);
      return verdict && verdict !== "pass" && verdict !== "resumed";
    })
    .map((entry) => ({
      step_id: asNonEmptyString(entry.step_id),
      step_instance_id: asNonEmptyString(entry.step_instance_id) || asNonEmptyString(entry.step_id),
      iteration: typeof entry.iteration === "number" ? entry.iteration : null,
      verdict: asNonEmptyString(entry.final_step_verdict),
      decision: asNonEmptyString(asRecord(entry.decision).action) || null,
      evidence_refs: asStringArray(entry.artifact_refs),
      observation_ref: asNonEmptyString(entry.observation_ref) || null,
    }));
  const qualityDrops = [
    ["target_baseline_status", qualityJudgement.target_baseline_status],
    ["real_code_change_status", qualityJudgement.real_code_change_status],
    ["post_run_verification_status", qualityJudgement.post_run_verification_status],
    ["provider_execution_status", qualityJudgement.provider_execution_status],
    ["quality_gate_decision", qualityJudgement.quality_gate_decision],
    ["mission_satisfaction", runnerQualitySummary.mission_satisfaction],
  ]
    .filter(([, value]) => asNonEmptyString(value) && !["pass", "warn", "accept"].includes(asNonEmptyString(value)))
    .map(([field, value]) => ({ field, value }));
  const failure_context = extractQualificationFailureContext({
    ...options.summary,
    status: options.status,
  });
  return {
    analysis_id: `${asNonEmptyString(options.summary.run_id) || "live-e2e"}.qualification-analysis.v1`,
    run_id: asNonEmptyString(options.summary.run_id) || null,
    status: options.status,
    provider_variant_id: asNonEmptyString(options.summary.provider_variant_id) || null,
    target_catalog_id: asNonEmptyString(options.summary.target_catalog_id) || null,
    feature_mission_id: asNonEmptyString(options.summary.feature_mission_id) || null,
    feature_size: asNonEmptyString(options.summary.feature_size) || null,
    commit_sha: asNonEmptyString(options.summary.commit_sha) || null,
    branch_name: asNonEmptyString(options.summary.branch_name) || null,
    failing_steps: failingSteps,
    quality_drops: qualityDrops,
    failure_context,
    evidence_refs: [
      asNonEmptyString(options.summary.live_e2e_observation_report_file),
      asNonEmptyString(options.summary.review_report_file),
      asNonEmptyString(options.summary.latest_runtime_harness_report_file),
      asNonEmptyString(options.summary.post_run_verify_summary_file),
    ].filter(Boolean),
    recommended_fix_scope:
      options.status === "passed"
        ? "none"
        : qualityDrops.length > 0
          ? "Inspect failing quality dimensions and patch AOR runtime or live E2E flow before rerunning from a fresh isolated workspace."
          : "Inspect failing step evidence refs and patch the first public flow break before rerunning.",
    generated_at: nowIso(),
  };
}

/**
 * @param {{ qualificationSetFile: string, analysis: Record<string, unknown>, summary: Record<string, unknown> }}
 */
function updateQualificationSet(options) {
  const existing = options.qualificationSetFile && path.isAbsolute(options.qualificationSetFile) && fs.existsSync(options.qualificationSetFile)
    ? asRecord(readJson(options.qualificationSetFile))
    : {};
  const attempts = Array.isArray(existing.attempts) ? existing.attempts.map((entry) => asRecord(entry)) : [];
  const attempt = {
    run_id: asNonEmptyString(options.summary.run_id) || null,
    status: asNonEmptyString(options.analysis.status),
    provider_variant_id: asNonEmptyString(options.summary.provider_variant_id) || null,
    target_catalog_id: asNonEmptyString(options.summary.target_catalog_id) || null,
    feature_mission_id: asNonEmptyString(options.summary.feature_mission_id) || null,
    feature_size: asNonEmptyString(options.summary.feature_size) || null,
    commit_sha: asNonEmptyString(options.summary.commit_sha) || null,
    branch_name: asNonEmptyString(options.summary.branch_name) || null,
    summary_ref: asNonEmptyString(options.summary.summary_ref) || null,
    observation_report_ref: asNonEmptyString(options.summary.live_e2e_observation_report_file) || null,
    analysis_ref: asNonEmptyString(options.analysis.analysis_file) || null,
    failure_owner: asNonEmptyString(asRecord(options.analysis.failure_context).failure_owner) || null,
    failure_phase: asNonEmptyString(asRecord(options.analysis.failure_context).failure_phase) || null,
    failure_class: asNonEmptyString(asRecord(options.analysis.failure_context).failure_class) || null,
    blocker_reason: asNonEmptyString(asRecord(options.analysis.failure_context).blocker_reason) || null,
    evidence_refs: asStringArray(asRecord(options.analysis.failure_context).evidence_refs),
    recorded_at: nowIso(),
  };
  const runId = asNonEmptyString(attempt.run_id);
  const existingAttemptIndex = runId
    ? attempts.findIndex((entry) => asNonEmptyString(entry.run_id) === runId)
    : -1;
  if (existingAttemptIndex >= 0) {
    attempts[existingAttemptIndex] = attempt;
  } else {
    attempts.push(attempt);
  }
  const passing = attempts.filter((entry) => asNonEmptyString(entry.status) === "passed");
  const provider_counts = Object.fromEntries(
    Object.keys(REQUIRED_PROVIDER_COUNTS).map((provider) => [
      provider,
      passing.filter((entry) => asNonEmptyString(entry.provider_variant_id) === provider).length,
    ]),
  );
  const missing_provider_requirements = Object.entries(REQUIRED_PROVIDER_COUNTS)
    .filter(([provider, count]) => Number(provider_counts[provider]) < count)
    .map(([provider, count]) => ({
      provider_variant_id: provider,
      required: count,
      actual: Number(provider_counts[provider]) || 0,
    }));
  const qualification_status =
    passing.length >= 5 && missing_provider_requirements.length === 0 ? "passed" : "incomplete";
  const document = {
    qualification_report_id: "live-e2e.final-qualification.v1",
    required_provider_counts: REQUIRED_PROVIDER_COUNTS,
    qualification_status,
    passing_run_count: passing.length,
    provider_counts,
    missing_provider_requirements,
    provider_qualification_matrix: buildProviderQualificationMatrix({
      scope: "live-e2e-final-qualification-set",
      providers: DEFAULT_PROVIDER_QUALIFICATION_PROVIDERS,
      attempts,
      requiredProviderCounts: REQUIRED_PROVIDER_COUNTS,
      releaseBlockingProviderIds: [],
    }),
    attempts,
    updated_at: nowIso(),
  };
  writeJson(options.qualificationSetFile, document);
  return document;
}

/**
 * @param {{
 *   summaryFile: string,
 *   observationFile: string | null,
 *   qualificationSetFile: string | null,
 *   recordedExistingRun: boolean,
 *   expectedIdentity: Record<string, string>,
 *   hostRoot: string,
 * }}
 */
function recordQualificationResult(options) {
  const summaryFile = path.resolve(options.summaryFile);
  const summary = asRecord(readJson(summaryFile));
  assertRecordedSummaryMatchesProfile(summary, options.expectedIdentity);
  assertRecordedSummaryBelongsToCurrentGitLineage(summary, options.hostRoot);
  const observationFileRef = options.observationFile || asNonEmptyString(summary.live_e2e_observation_report_file);
  if (!observationFileRef) {
    throw new UsageError("--record-run-summary-file requires --record-observation-report-file when the summary omits live_e2e_observation_report_file.");
  }
  const observationFile = resolveSummaryRelativePath(summaryFile, observationFileRef);
  const observationReport = asRecord(readJson(observationFile));
  const featureSize = normalizeFeatureSize(summary.feature_size);
  if (!QUALIFYING_FEATURE_SIZES.has(featureSize)) {
    throw new UsageError(
      `Qualification loop requires recorded summary feature_size medium or large; xlarge is manual-only. Received '${featureSize || "unknown"}'.`,
    );
  }
  const status = classifyQualification(summary, observationReport);
  const analysis = buildAnalysis({
    summary,
    observationReport,
    status,
  });
  const analysisFile = path.join(
    path.dirname(summaryFile),
    `live-e2e-qualification-analysis-${normalizeId(asNonEmptyString(summary.run_id) || "run")}.json`,
  );
  analysis.analysis_file = analysisFile;
  writeJson(analysisFile, analysis);
  const qualificationSet = options.qualificationSetFile
    ? updateQualificationSet({
        qualificationSetFile: path.resolve(options.qualificationSetFile),
        analysis,
        summary: {
          ...summary,
          summary_ref: summaryFile,
          live_e2e_observation_report_file: observationFile,
        },
      })
    : null;
  process.stdout.write(
    `${JSON.stringify(
      {
        command: "scripts live-e2e qualification-loop",
        status,
        run_id: asNonEmptyString(summary.run_id) || null,
        recorded_existing_run: options.recordedExistingRun,
        qualification_analysis_file: analysisFile,
        qualification_set_file: options.qualificationSetFile ? path.resolve(options.qualificationSetFile) : null,
        qualification_set_status: asNonEmptyString(asRecord(qualificationSet).qualification_status) || null,
        live_e2e_run_summary_file: summaryFile,
        live_e2e_observation_report_file: observationFile,
      },
      null,
      2,
    )}\n`,
  );
  if (status === "passed") return 0;
  if (status === "needs_fix") return 2;
  return 3;
}

/**
 * @param {string[]} rawArgs
 */
function runCli(rawArgs) {
  if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
    process.stdout.write(
      [
        "Usage: node ./scripts/live-e2e/qualification-loop.mjs --project-ref <path> --profile <path> [--qualification-set-file <path>] [run-profile flags...]",
        "       node ./scripts/live-e2e/qualification-loop.mjs --project-ref <path> --profile <path> --record-run-summary-file <path> [--record-observation-report-file <path>] [--qualification-set-file <path>]",
        "",
        "Runs one medium or large live E2E profile and writes a qualification analysis for the launching agent.",
      ].join("\n"),
    );
    return 0;
  }
  const flags = parseFlags(rawArgs);
  const qualificationSetFile = resolveOptionalStringFlag(flags["qualification-set-file"], "qualification-set-file");
  const recordRunSummaryFile = resolveOptionalStringFlag(flags["record-run-summary-file"], "record-run-summary-file");
  const recordObservationReportFile = resolveOptionalStringFlag(
    flags["record-observation-report-file"],
    "record-observation-report-file",
  );
  let runProfileArgs = qualificationSetFile ? removeStringFlag(rawArgs, "qualification-set-file") : rawArgs;
  runProfileArgs = recordRunSummaryFile ? removeStringFlag(runProfileArgs, "record-run-summary-file") : runProfileArgs;
  runProfileArgs = recordObservationReportFile
    ? removeStringFlag(runProfileArgs, "record-observation-report-file")
    : runProfileArgs;
  const hostRoot = requireDirectory(
    resolveOptionalStringFlag(flags["project-ref"], "project-ref") ??
      (() => {
        throw new UsageError("Flag '--project-ref' is required.");
      })(),
  );
  const profileRef =
    resolveOptionalStringFlag(flags.profile, "profile") ??
    (() => {
      throw new UsageError("Flag '--profile' is required.");
    })();
  if (hasFlag(rawArgs, "controller-mode")) {
    throw new UsageError("qualification-loop owns controller mode; omit --controller-mode.");
  }
  const catalogRoot = resolveCatalogRoot({
    hostRoot,
    catalogRootOverride: resolveOptionalStringFlag(flags["catalog-root"], "catalog-root"),
  });
  const loaded = loadProofRunnerProfile({
    hostRoot,
    profileRef,
  });
  const fullJourney = isFullJourneyProfile(loaded.profile)
    ? resolveFullJourneyProfile({
        profile: loaded.profile,
        catalogRoot,
      })
    : null;
  const featureSize =
    normalizeFeatureSize(fullJourney?.featureSize) ||
    normalizeFeatureSize(loaded.profile.feature_size) ||
    normalizeFeatureSize(asRecord(loaded.profile.matrix_cell).feature_size);
  if (!QUALIFYING_FEATURE_SIZES.has(featureSize)) {
    throw new UsageError(
      `Qualification loop requires feature_size medium or large; xlarge is manual-only. Received '${featureSize || "unknown"}'.`,
    );
  }
  if (recordRunSummaryFile) {
    return recordQualificationResult({
      summaryFile: recordRunSummaryFile,
      observationFile: recordObservationReportFile,
      qualificationSetFile: qualificationSetFile ? path.resolve(qualificationSetFile) : null,
      recordedExistingRun: true,
      expectedIdentity: buildExpectedSummaryIdentity({
        profile: loaded.profile,
        fullJourney,
        featureSize,
      }),
      hostRoot,
    });
  }

  const child = spawnSync(process.execPath, [RUN_PROFILE_SCRIPT, ...runProfileArgs, "--controller-mode", "auto"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (child.stderr) process.stderr.write(child.stderr);
  if (child.status !== 0) {
    if (child.stdout) process.stdout.write(child.stdout);
    return child.status ?? 1;
  }
  const output = asRecord(JSON.parse(child.stdout));
  const summaryFile = asNonEmptyString(output.live_e2e_run_summary_file);
  const observationFile = asNonEmptyString(output.live_e2e_observation_report_file);
  const summary = summaryFile ? asRecord(readJson(summaryFile)) : {};
  const observationReport = observationFile ? asRecord(readJson(observationFile)) : {};
  const status = classifyQualification(summary, observationReport);
  const analysis = buildAnalysis({
    summary,
    observationReport,
    status,
  });
  const analysisFile = path.join(
    path.dirname(summaryFile || process.cwd()),
    `live-e2e-qualification-analysis-${normalizeId(asNonEmptyString(summary.run_id) || "run")}.json`,
  );
  analysis.analysis_file = analysisFile;
  writeJson(analysisFile, analysis);
  const qualificationSet = qualificationSetFile
    ? updateQualificationSet({
        qualificationSetFile: path.resolve(qualificationSetFile),
        analysis,
        summary: {
          ...summary,
          summary_ref: summaryFile,
        },
      })
    : null;
  process.stdout.write(
    `${JSON.stringify(
      {
        command: "scripts live-e2e qualification-loop",
        status,
        run_id: asNonEmptyString(summary.run_id) || asNonEmptyString(output.run_id) || null,
        qualification_analysis_file: analysisFile,
        qualification_set_file: qualificationSetFile ? path.resolve(qualificationSetFile) : null,
        qualification_set_status: asNonEmptyString(asRecord(qualificationSet).qualification_status) || null,
        live_e2e_run_summary_file: summaryFile || null,
        live_e2e_observation_report_file: observationFile || null,
      },
      null,
      2,
    )}\n`,
  );
  if (status === "passed") return 0;
  if (status === "needs_fix") return 2;
  return 3;
}

try {
  process.exitCode = runCli(process.argv.slice(2));
} catch (error) {
  if (error instanceof UsageError) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  } else {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
