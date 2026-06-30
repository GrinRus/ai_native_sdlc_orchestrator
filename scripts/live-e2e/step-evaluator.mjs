#!/usr/bin/env node
import { spawnSync } from "node:child_process";
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
  readYamlDocument,
  readJson,
  resolveOptionalStringFlag,
} from "./lib/common.mjs";
import { prepareOperatorDecisionArtifact } from "./lib/decision-helper.mjs";
import { writeStepQualityAssessmentReports as writeStepQualityAssessmentReportsForEntries } from "./lib/step-quality-assessment.mjs";

const CURRENT_FILE = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(CURRENT_FILE);
const RUN_PROFILE_SCRIPT = path.join(SCRIPT_DIR, "run-profile.mjs");
const REQUIRED_PHASES = Object.freeze(["plan", "execute", "inspect", "classify", "decide", "persist"]);

/**
 * @param {string} status
 * @returns {"pass" | "warn" | "not_pass" | "blocked" | "interaction_required" | "resumed"}
 */
function normalizeObservationStatus(status) {
  const normalized = asNonEmptyString(status).toLowerCase();
  if (normalized === "pass" || normalized === "passed" || normalized === "success") return "pass";
  if (normalized === "warn" || normalized === "warning" || normalized === "skipped") return "warn";
  if (normalized === "blocked" || normalized === "block") return "blocked";
  if (normalized === "interaction_required" || normalized === "interactive" || normalized === "requested") {
    return "interaction_required";
  }
  if (normalized === "resumed") return "resumed";
  return "not_pass";
}

/**
 * @param {Record<string, unknown>} report
 * @returns {Record<string, unknown>}
 */
function findPendingOperatorDecisionEntry(report) {
  const stepJournal = Array.isArray(report.step_journal) ? report.step_journal.map((entry) => asRecord(entry)) : [];
  return (
    stepJournal
      .filter(
        (entry) =>
          asNonEmptyString(entry.operator_decision_status) === "missing" &&
          Boolean(asNonEmptyString(entry.agent_decision_request_ref)),
      )
      .sort((left, right) => (Number(right.sequence) || 0) - (Number(left.sequence) || 0))[0] ?? {}
  );
}

/**
 * @param {Record<string, unknown>} report
 * @returns {Record<string, unknown> | null}
 */
export function preparePendingOperatorDecision(report) {
  const entry = findPendingOperatorDecisionEntry(report);
  const requestFile = asNonEmptyString(entry.agent_decision_request_ref);
  if (!requestFile) return null;
  const stepId = asNonEmptyString(entry.step_id) || "step";
  const deterministicStatus = normalizeObservationStatus(asNonEmptyString(asRecord(entry.deterministic_analysis).status));
  const canContinue = ["pass", "warn", "resumed"].includes(deterministicStatus);
  return prepareOperatorDecisionArtifact({
    requestFile,
    action: canContinue ? "continue" : "block",
    semanticStatus: canContinue ? deterministicStatus : "blocked",
    findings: canContinue
      ? [`${stepId} public evidence passed deterministic inspection before continuation.`]
      : [
          `${stepId} deterministic evidence produced status '${deterministicStatus}'.`,
          "Step evaluator blocked continuation through the public operator decision artifact boundary.",
        ],
    operatorNote: canContinue
      ? "Step evaluator accepted the public step evidence through the operator decision artifact boundary."
      : "Step evaluator preserved the non-pass public evidence as a terminal classified blocker.",
    reason: canContinue
      ? null
      : `Step evaluator blocked '${stepId}' after deterministic status '${deterministicStatus}'.`,
    write: true,
  });
}

/**
 * @param {Record<string, unknown>} report
 * @param {Record<string, unknown>} state
 * @returns {string[]}
 */
function validateControllerEvidence(report, state) {
  const issues = [];
  const stepJournal = Array.isArray(report.step_journal) ? report.step_journal.map((entry) => asRecord(entry)) : [];
  const operatorContext = asRecord(report.operator_context);
  if (asNonEmptyString(operatorContext.operator_kind) !== "skill-agent") {
    issues.push("operator_context.operator_kind must be skill-agent");
  }
  if (asNonEmptyString(operatorContext.decision_policy) !== "required") {
    issues.push("operator_context.decision_policy must be required");
  }
  if (asNonEmptyString(operatorContext.answer_policy) !== "agent-public-control-plane") {
    issues.push("operator_context.answer_policy must be agent-public-control-plane");
  }
  if (stepJournal.length === 0) {
    issues.push("step_journal must contain at least one online controller observation");
  }
  const frontendInteractions = Array.isArray(report.frontend_interactions)
    ? report.frontend_interactions.map((entry) => asRecord(entry))
    : [];
  for (const entry of frontendInteractions) {
    const interactionId = asNonEmptyString(entry.interaction_id) || asNonEmptyString(entry.step_id) || "frontend";
    for (const field of ["html_ref", "dom_snapshot_ref", "accessibility_summary_ref"]) {
      if (!asNonEmptyString(entry[field])) {
        issues.push(`${interactionId} missing ${field}`);
      }
    }
    if (asStringArray(entry.evidence_refs).length === 0) {
      issues.push(`${interactionId} missing AOR operator UI evidence_refs`);
    }
    if (asStringArray(entry.screenshot_refs).length === 0 && asStringArray(entry.visual_guardrail_refs).length === 0) {
      issues.push(`${interactionId} missing screenshot or visual guardrail refs`);
    }
    if (!["pass", "warn"].includes(asNonEmptyString(asRecord(entry.task_outcome).status))) {
      issues.push(`${interactionId} task_outcome did not pass or warn`);
    }
  }
  const phaseHistory = Array.isArray(state.phase_history) ? state.phase_history.map((entry) => asRecord(entry)) : [];
  for (const entry of stepJournal) {
    const stepId = asNonEmptyString(entry.step_id);
    if (!stepId) {
      issues.push("step_journal entry is missing step_id");
      continue;
    }
    for (const field of ["plan", "deterministic_analysis", "semantic_analysis", "decision"]) {
      if (Object.keys(asRecord(entry[field])).length === 0) {
        issues.push(`${stepId} missing ${field}`);
      }
    }
    if (typeof entry.iteration !== "number" || entry.iteration < 1) {
      issues.push(`${stepId} missing positive iteration`);
    }
    for (const field of ["plan_ref", "execution_ref", "inspection_ref", "classification_ref"]) {
      if (!asNonEmptyString(entry[field])) {
        issues.push(`${stepId} missing ${field}`);
      }
    }
    if (!asNonEmptyString(entry.agent_decision_request_ref)) {
      issues.push(`${stepId} missing agent_decision_request_ref`);
    }
    if (asNonEmptyString(entry.operator_decision_status) !== "accepted") {
      issues.push(`${stepId} missing accepted skill-agent operator decision`);
    }
    if (!asNonEmptyString(entry.operator_decision_ref)) {
      issues.push(`${stepId} missing operator_decision_ref`);
    }
    if (asStringArray(entry.inspected_evidence_refs).length === 0) {
      issues.push(`${stepId} missing inspected_evidence_refs`);
    }
    if (asNonEmptyString(asRecord(entry.semantic_analysis).judge_source) !== "skill-agent") {
      issues.push(`${stepId} semantic_analysis.judge_source must be skill-agent`);
    }
    for (const phase of REQUIRED_PHASES) {
      const phaseFound = phaseHistory.some(
        (historyEntry) => asNonEmptyString(historyEntry.step_id) === stepId && asNonEmptyString(historyEntry.phase) === phase,
      );
      if (!phaseFound) {
        issues.push(`${stepId} missing controller phase evidence '${phase}'`);
      }
    }
  }
  return issues;
}

/**
 * @param {{
 *   runProfileOutput: Record<string, unknown>,
 *   report: Record<string, unknown>,
 *   state?: Record<string, unknown>,
 *   summary: Record<string, unknown>,
 *   outputDir: string,
 * }} options
 * @returns {string[]}
 */
function writeStepQualityAssessmentReports(options) {
  const stepJournal = Array.isArray(options.report.step_journal)
    ? options.report.step_journal.map((entry) => asRecord(entry))
    : [];
  const pendingStepQuality = asRecord(options.state?.pending_step_quality_assessment);
  const pendingStepInstanceId = asNonEmptyString(pendingStepQuality.step_instance_id);
  const pendingEntries = pendingStepInstanceId
    ? stepJournal.filter((entry) => asNonEmptyString(entry.step_instance_id) === pendingStepInstanceId)
    : stepJournal;
  const runId = asNonEmptyString(options.summary.run_id) || asNonEmptyString(options.runProfileOutput.run_id) || "live-e2e-run";
  return writeStepQualityAssessmentReportsForEntries({
    runId,
    summary: options.summary,
    entries: pendingEntries,
    outputDir: options.outputDir,
  });
}

/**
 * @param {Record<string, unknown>} state
 * @returns {boolean}
 */
function hasPendingStepQualityAssessment(state) {
  return asNonEmptyString(asRecord(state.pending_step_quality_assessment).status) === "awaiting-assessment";
}

/**
 * @param {Record<string, unknown>} state
 * @returns {boolean}
 */
export function hasPendingIncludedControllerStep(state) {
  const currentStep = asNonEmptyString(state.current_step);
  if (!currentStep) return false;
  const includedSteps = asStringArray(state.included_steps);
  if (includedSteps.length === 0 || !includedSteps.includes(currentStep)) return false;
  return !asStringArray(state.completed_steps).includes(currentStep);
}

/**
 * @param {Record<string, unknown>} report
 * @param {Record<string, unknown>} state
 * @returns {boolean}
 */
export function shouldAwaitFirstControllerObservation(report, state) {
  const stepJournal = Array.isArray(report.step_journal) ? report.step_journal : [];
  return hasPendingIncludedControllerStep(state) && stepJournal.length === 0;
}

/**
 * @param {string} profileRef
 * @returns {string}
 */
function resolveProfileIdForGeneratedRunId(profileRef) {
  const resolvedProfileRef = asNonEmptyString(profileRef);
  if (!resolvedProfileRef) return "live-e2e.step-evaluator";
  try {
    const profilePath = path.isAbsolute(resolvedProfileRef)
      ? resolvedProfileRef
      : path.resolve(process.cwd(), resolvedProfileRef);
    return asNonEmptyString(readYamlDocument(profilePath).profile_id) || "live-e2e.step-evaluator";
  } catch {
    return normalizeId(path.basename(resolvedProfileRef, path.extname(resolvedProfileRef))) || "live-e2e.step-evaluator";
  }
}

/**
 * @param {string[]} rawArgs
 * @returns {string[]}
 */
export function resolveEvaluatorRunProfileArgs(rawArgs) {
  const flags = parseFlags(rawArgs);
  resolveOptionalStringFlag(flags["run-id"], "run-id");
  const profileRef = resolveOptionalStringFlag(flags.profile, "profile");
  if (Object.prototype.hasOwnProperty.call(flags, "run-id")) {
    return [...rawArgs];
  }

  const profileId = resolveProfileIdForGeneratedRunId(profileRef || "");
  const generatedRunId = `${normalizeId(profileId)}.run-${nowIso().replace(/[^0-9]/g, "").slice(-12)}`;
  return [...rawArgs, "--run-id", generatedRunId];
}


/**
 * @param {string[]} rawArgs
 */
function runCli(rawArgs) {
  if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
    process.stdout.write(
      [
        "Usage: node ./scripts/live-e2e/step-evaluator.mjs --project-ref <path> --profile <path> [run-profile flags...]",
        "",
        "Runs the live E2E step controller in evaluator mode and fails closed on missing phase evidence.",
      ].join("\n"),
    );
    return 0;
  }

  const flags = parseFlags(rawArgs);
  if (!resolveOptionalStringFlag(flags["project-ref"], "project-ref")) {
    throw new UsageError("Flag '--project-ref' is required.");
  }
  if (!resolveOptionalStringFlag(flags.profile, "profile")) {
    throw new UsageError("Flag '--profile' is required.");
  }
  if (Object.prototype.hasOwnProperty.call(flags, "controller-mode")) {
    throw new UsageError("step-evaluator owns --controller-mode; omit it from evaluator invocations.");
  }
  const runProfileArgs = resolveEvaluatorRunProfileArgs(rawArgs);

  /** @type {Record<string, unknown>} */
  let runProfileOutput = {};
  /** @type {Record<string, unknown>} */
  let report = {};
  /** @type {Record<string, unknown>} */
  let state = {};
  /** @type {Record<string, unknown>} */
  let summary = {};
  let observationReportFile = "";
  let controllerStateFile = "";
  let runSummaryFile = "";
  let stepQualityAssessmentReportFiles = [];
  let operatorDecisionFiles = [];
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    const child = spawnSync(process.execPath, [RUN_PROFILE_SCRIPT, ...runProfileArgs, "--controller-mode", "evaluator"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    if (child.stderr) process.stderr.write(child.stderr);
    if (child.status !== 0) {
      if (child.stdout) process.stdout.write(child.stdout);
      return child.status ?? 1;
    }

    runProfileOutput = JSON.parse(child.stdout);
    observationReportFile = asNonEmptyString(runProfileOutput.live_e2e_observation_report_file);
    controllerStateFile = asNonEmptyString(runProfileOutput.live_e2e_controller_state_file);
    runSummaryFile = asNonEmptyString(runProfileOutput.live_e2e_run_summary_file);
    report = observationReportFile ? readJson(observationReportFile) : {};
    state = controllerStateFile ? readJson(controllerStateFile) : {};
    summary = runSummaryFile ? readJson(runSummaryFile) : {};
    const pendingIncludedControllerStep = hasPendingIncludedControllerStep(state);
    const preparedOperatorDecision = preparePendingOperatorDecision(report);
    if (preparedOperatorDecision) {
      if (asNonEmptyString(preparedOperatorDecision.status) === "rejected") {
        process.stderr.write(
          `Step evaluator failed closed: operator decision draft was rejected for ${asNonEmptyString(preparedOperatorDecision.request_ref) || "request"}.\n`,
        );
        return 1;
      }
      operatorDecisionFiles = [
        ...operatorDecisionFiles,
        asNonEmptyString(preparedOperatorDecision.output_ref),
      ].filter(Boolean);
      continue;
    }
    if (shouldAwaitFirstControllerObservation(report, state)) {
      continue;
    }
    const issues = validateControllerEvidence(report, state);
    if (issues.length > 0) {
      process.stderr.write(`Step evaluator failed closed: ${issues.join("; ")}\n`);
      return 1;
    }
    if (!hasPendingStepQualityAssessment(state)) {
      stepQualityAssessmentReportFiles = asStringArray(runProfileOutput.live_e2e_step_quality_assessment_report_files);
      if (pendingIncludedControllerStep) {
        continue;
      }
      break;
    }
    const writtenReports = writeStepQualityAssessmentReports({
      runProfileOutput,
      report,
      state,
      summary,
      outputDir: observationReportFile ? path.dirname(observationReportFile) : process.cwd(),
    });
    stepQualityAssessmentReportFiles = [...stepQualityAssessmentReportFiles, ...writtenReports];
  }

  if (hasPendingStepQualityAssessment(state)) {
    process.stderr.write("Step evaluator failed closed: pending step-quality assessment did not resolve after 20 attempts.\n");
    return 1;
  }
  stepQualityAssessmentReportFiles = [
    ...new Set([
      ...stepQualityAssessmentReportFiles,
      ...asStringArray(runProfileOutput.live_e2e_step_quality_assessment_report_files),
    ]),
  ];

  const pendingDecision = asRecord(state.pending_decision);
  const action = asNonEmptyString(pendingDecision.action) || "unknown";
  const unresolvedAction = action === "continue" ? null : action;
  const overallStatus = asNonEmptyString(report.overall_status) || "not_pass";
  const terminalFailure = ["not_pass", "blocked", "interaction_required"].includes(overallStatus);
  process.stdout.write(
    `${JSON.stringify(
      {
        command: "scripts live-e2e step-evaluator",
        status: terminalFailure ? "failed" : unresolvedAction ? "stopped" : "ok",
        run_id: runProfileOutput.run_id,
        overall_status: overallStatus,
        unresolved_action: unresolvedAction,
        controller_completed_steps: asStringArray(state.completed_steps),
        aor_installation_proof_file: asNonEmptyString(runProfileOutput.aor_installation_proof_file) || null,
        live_e2e_controller_state_file: controllerStateFile || null,
        live_e2e_observation_report_file: observationReportFile || null,
        live_e2e_operator_decision_files: operatorDecisionFiles,
        live_e2e_step_quality_assessment_request_files: asStringArray(
          runProfileOutput.live_e2e_step_quality_assessment_request_files,
        ),
        live_e2e_step_quality_assessment_report_files: stepQualityAssessmentReportFiles,
        live_e2e_step_observation_files: Array.isArray(runProfileOutput.live_e2e_step_observation_files)
          ? runProfileOutput.live_e2e_step_observation_files
          : [],
      },
      null,
      2,
    )}\n`,
  );
  return unresolvedAction || terminalFailure ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === CURRENT_FILE) {
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
}
