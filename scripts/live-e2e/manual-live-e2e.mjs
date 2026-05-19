#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { UsageError, asNonEmptyString, asRecord, parseFlags, readJson, resolveOptionalStringFlag } from "./lib/common.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const RUN_PROFILE_SCRIPT = path.join(SCRIPT_DIR, "run-profile.mjs");

/**
 * @param {string[]} rawArgs
 */
function runCli(rawArgs) {
  if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
    process.stdout.write(
      [
        "Usage: node ./scripts/live-e2e/manual-live-e2e.mjs --project-ref <path> --profile <path> --run-id <id> [run-profile flags...]",
        "",
        "Runs exactly one pending live E2E controller step through installed public project flow surfaces.",
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
  if (!resolveOptionalStringFlag(flags["run-id"], "run-id")) {
    throw new UsageError("Flag '--run-id' is required for manual live E2E resume semantics.");
  }
  if (Object.prototype.hasOwnProperty.call(flags, "controller-mode")) {
    throw new UsageError("manual-live-e2e owns --controller-mode; omit it from manual invocations.");
  }

  const child = spawnSync(process.execPath, [RUN_PROFILE_SCRIPT, ...rawArgs, "--controller-mode", "manual"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (child.stderr) process.stderr.write(child.stderr);
  if (child.status !== 0) {
    if (child.stdout) process.stdout.write(child.stdout);
    return child.status ?? 1;
  }

  const runProfileOutput = JSON.parse(child.stdout);
  const controllerStateFile = asNonEmptyString(runProfileOutput.live_e2e_controller_state_file);
  const state = controllerStateFile ? readJson(controllerStateFile) : {};
  const pendingDecision = asRecord(state.pending_decision);
  const action = asNonEmptyString(pendingDecision.action) || "unknown";
  const requiredPublicAction = action === "continue" ? null : action;
  const stepObservations = Array.isArray(runProfileOutput.live_e2e_step_observation_files)
    ? runProfileOutput.live_e2e_step_observation_files
    : [];
  const latestObservationFile = stepObservations.at(-1);
  const latestObservation = latestObservationFile ? asRecord(readJson(latestObservationFile)) : {};
  process.stdout.write(
    `${JSON.stringify(
      {
        command: "scripts live-e2e manual-live-e2e",
        status: child.status === 0 ? "ok" : "fail",
        run_id: runProfileOutput.run_id,
        current_step: state.current_step ?? null,
        completed_steps: Array.isArray(state.completed_steps) ? state.completed_steps : [],
        decision: Object.keys(pendingDecision).length > 0 ? pendingDecision : null,
        required_public_action: requiredPublicAction,
        agent_decision_request_ref: asNonEmptyString(latestObservation.agent_decision_request_ref) || null,
        operator_decision_ref: asNonEmptyString(latestObservation.operator_decision_ref) || null,
        operator_decision_status: asNonEmptyString(latestObservation.operator_decision_status) || null,
        aor_installation_proof_file: asNonEmptyString(runProfileOutput.aor_installation_proof_file) || null,
        live_e2e_controller_state_file: controllerStateFile || null,
        live_e2e_observation_report_file: asNonEmptyString(runProfileOutput.live_e2e_observation_report_file) || null,
        live_e2e_step_observation_files: stepObservations,
      },
      null,
      2,
    )}\n`,
  );
  return 0;
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
