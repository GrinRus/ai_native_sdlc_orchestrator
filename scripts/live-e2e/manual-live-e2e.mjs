#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  UsageError,
  asNonEmptyString,
  asRecord,
  normalizeId,
  parseFlags,
  readJson,
  resolveOptionalStringFlag,
} from "./lib/common.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const RUN_PROFILE_SCRIPT = path.join(SCRIPT_DIR, "run-profile.mjs");

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
 * @param {string} root
 * @param {string} runId
 * @returns {string[]}
 */
function findDecisionRequestFiles(root, runId) {
  if (!root || !fs.existsSync(root)) return [];
  const results = [];
  const stack = [root];
  const prefix = `live-e2e-agent-decision-request-${normalizeId(runId)}`;
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const next = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(next);
      } else if (entry.isFile() && entry.name.startsWith(prefix) && entry.name.endsWith(".json")) {
        results.push(next);
      }
    }
  }
  return results.sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
}

/**
 * @param {{ projectRef: string, runtimeRoot: string | null, runId: string, operatorDecisionFile: string }} options
 */
function installOperatorDecision(options) {
  const decisionFile = path.resolve(options.operatorDecisionFile);
  if (!fs.existsSync(decisionFile)) {
    throw new UsageError(`Operator decision file '${decisionFile}' was not found.`);
  }
  const projectRoot = path.resolve(options.projectRef);
  const runtimeCandidates = [
    options.runtimeRoot ? path.resolve(projectRoot, options.runtimeRoot) : null,
    path.join(os.tmpdir(), "aor-live-e2e", normalizeId(options.runId), "runtime"),
    path.join(projectRoot, ".aor"),
  ].filter(Boolean);
  for (const runtimeRoot of runtimeCandidates) {
    const requestFile = findDecisionRequestFiles(runtimeRoot, options.runId)[0];
    if (!requestFile) continue;
    const request = asRecord(readJson(requestFile));
    const expectedRef = asNonEmptyString(request.operator_decision_expected_ref);
    if (!expectedRef) {
      throw new UsageError(`Decision request '${requestFile}' does not declare operator_decision_expected_ref.`);
    }
    fs.mkdirSync(path.dirname(expectedRef), { recursive: true });
    fs.copyFileSync(decisionFile, expectedRef);
    return expectedRef;
  }
  throw new UsageError(`No pending live E2E operator decision request was found for run '${options.runId}'.`);
}

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
        "Use --operator-decision-file <path> after a stop to install the skill-agent decision artifact before resuming.",
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
  const projectRef = /** @type {string} */ (resolveOptionalStringFlag(flags["project-ref"], "project-ref"));
  const runId = /** @type {string} */ (resolveOptionalStringFlag(flags["run-id"], "run-id"));
  const operatorDecisionFile = resolveOptionalStringFlag(flags["operator-decision-file"], "operator-decision-file");
  const runtimeRoot = resolveOptionalStringFlag(flags["runtime-root"], "runtime-root");
  const runProfileArgs = operatorDecisionFile ? removeStringFlag(rawArgs, "operator-decision-file") : rawArgs;
  let installedOperatorDecisionRef = null;
  if (operatorDecisionFile) {
    installedOperatorDecisionRef = installOperatorDecision({
      projectRef,
      runtimeRoot,
      runId,
      operatorDecisionFile,
    });
  }

  const child = spawnSync(process.execPath, [RUN_PROFILE_SCRIPT, ...runProfileArgs, "--controller-mode", "manual"], {
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
  const stepObservations = Array.isArray(runProfileOutput.live_e2e_step_observation_files)
    ? runProfileOutput.live_e2e_step_observation_files
    : [];
  const latestObservationFile = stepObservations.at(-1);
  const latestObservation = latestObservationFile ? asRecord(readJson(latestObservationFile)) : {};
  const operatorDecisionStatus = asNonEmptyString(latestObservation.operator_decision_status) || null;
  const requiredPublicAction =
    operatorDecisionStatus === "missing"
      ? "operator_decision"
      : action === "continue"
        ? null
        : action;
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
        installed_operator_decision_ref: installedOperatorDecisionRef,
        operator_decision_status: operatorDecisionStatus,
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
