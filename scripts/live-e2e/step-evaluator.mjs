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
  parseFlags,
  readJson,
  resolveOptionalStringFlag,
} from "./lib/common.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const RUN_PROFILE_SCRIPT = path.join(SCRIPT_DIR, "run-profile.mjs");
const REQUIRED_PHASES = Object.freeze(["plan", "execute", "inspect", "classify", "decide", "persist"]);

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
      issues.push(`${interactionId} missing frontend evidence_refs`);
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

  const child = spawnSync(process.execPath, [RUN_PROFILE_SCRIPT, ...rawArgs, "--controller-mode", "evaluator"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (child.stderr) process.stderr.write(child.stderr);
  if (child.status !== 0) {
    if (child.stdout) process.stdout.write(child.stdout);
    return child.status ?? 1;
  }

  const runProfileOutput = JSON.parse(child.stdout);
  const observationReportFile = asNonEmptyString(runProfileOutput.live_e2e_observation_report_file);
  const controllerStateFile = asNonEmptyString(runProfileOutput.live_e2e_controller_state_file);
  const report = observationReportFile ? readJson(observationReportFile) : {};
  const state = controllerStateFile ? readJson(controllerStateFile) : {};
  const issues = validateControllerEvidence(report, state);
  if (issues.length > 0) {
    process.stderr.write(`Step evaluator failed closed: ${issues.join("; ")}\n`);
    return 1;
  }

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
