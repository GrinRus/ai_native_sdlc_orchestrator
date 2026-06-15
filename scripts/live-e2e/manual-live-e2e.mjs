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
  resolveOptionalBooleanFlag,
  resolveOptionalStringFlag,
} from "./lib/common.mjs";
import { prepareOperatorDecisionArtifact } from "./lib/decision-helper.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const RUN_PROFILE_SCRIPT = path.join(SCRIPT_DIR, "run-profile.mjs");

function providerStatusRank(providerStepStatus) {
  const status = asNonEmptyString(asRecord(providerStepStatus).status);
  if (["failed", "fail", "completed", "complete", "pass", "succeeded", "interrupted"].includes(status)) return 3;
  if (["timeout", "timed-out", "timeout-risk"].includes(status)) return 2;
  if (["running", "silent-running"].includes(status)) return 1;
  return 0;
}

function chooseProviderStepStatus(candidates) {
  return (
    candidates
      .map((entry) => asRecord(entry))
      .filter((entry) => Object.keys(entry).length > 0)
      .sort((left, right) => providerStatusRank(right) - providerStatusRank(left))[0] ?? {}
  );
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
 * @param {{ projectRef: string, runtimeRoot: string | null, runId: string }} options
 */
function resolveRuntimeCandidates(options) {
  const projectRoot = path.resolve(options.projectRef);
  return [
    options.runtimeRoot ? path.resolve(projectRoot, options.runtimeRoot) : null,
    path.join(os.tmpdir(), "aor-live-e2e", normalizeId(options.runId), "runtime"),
    path.join(projectRoot, ".aor"),
  ].filter(Boolean);
}

/**
 * @param {{ projectRef: string, runtimeRoot: string | null, runId: string, operatorDecisionFile: string }} options
 */
function installOperatorDecision(options) {
  const decisionFile = path.resolve(options.operatorDecisionFile);
  if (!fs.existsSync(decisionFile)) {
    throw new UsageError(`Operator decision file '${decisionFile}' was not found.`);
  }
  const runtimeCandidates = resolveRuntimeCandidates(options);
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
 * @param {{ projectRef: string | null, runtimeRoot: string | null, runId: string | null, requestRef: string | null }} options
 * @returns {string}
 */
function resolveDecisionPrepareRequestFile(options) {
  if (options.requestRef) return path.resolve(options.requestRef);
  if (!options.projectRef) {
    throw new UsageError("Flag '--project-ref' is required when --prepare-decision omits --request.");
  }
  if (!options.runId) {
    throw new UsageError("Flag '--run-id' is required when --prepare-decision omits --request.");
  }
  const runtimeCandidates = resolveRuntimeCandidates({
    projectRef: options.projectRef,
    runtimeRoot: options.runtimeRoot,
    runId: options.runId,
  });
  for (const runtimeRoot of runtimeCandidates) {
    const requestFile = findDecisionRequestFiles(runtimeRoot, options.runId)[0];
    if (requestFile) return requestFile;
  }
  throw new UsageError(`No pending live E2E operator decision request was found for run '${options.runId}'.`);
}

/**
 * @param {Record<string, string | true>} flags
 * @returns {number}
 */
function prepareDecisionCli(flags) {
  const action = resolveOptionalStringFlag(flags.action, "action");
  if (!action) {
    throw new UsageError("Flag '--action' is required with --prepare-decision.");
  }
  const projectRef = resolveOptionalStringFlag(flags["project-ref"], "project-ref");
  const runId = resolveOptionalStringFlag(flags["run-id"], "run-id");
  const runtimeRoot = resolveOptionalStringFlag(flags["runtime-root"], "runtime-root");
  const requestRef = resolveOptionalStringFlag(flags.request, "request");
  const outputFile = resolveOptionalStringFlag(flags.output, "output");
  const semanticStatus = resolveOptionalStringFlag(flags["semantic-status"], "semantic-status");
  const reason = resolveOptionalStringFlag(flags.reason, "reason");
  const finding = resolveOptionalStringFlag(flags.finding, "finding");
  const operatorNote = resolveOptionalStringFlag(flags["operator-note"], "operator-note");
  const dryRun = resolveOptionalBooleanFlag(flags["dry-run"], "dry-run");
  const requestFile = resolveDecisionPrepareRequestFile({
    projectRef,
    runtimeRoot,
    runId,
    requestRef,
  });
  const summary = prepareOperatorDecisionArtifact({
    requestFile,
    action,
    outputFile,
    semanticStatus,
    reason,
    findings: finding ? [finding] : [],
    operatorNote,
    write: !dryRun,
  });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  return 0;
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
        "Use --prepare-decision --request <agent_decision_request_ref> --action <action> to generate a decision artifact from the request rubric.",
        "Use --operator-decision-file <path> after a stop to install the skill-agent decision artifact before resuming.",
      ].join("\n"),
    );
    return 0;
  }

  const flags = parseFlags(rawArgs);
  if (Object.prototype.hasOwnProperty.call(flags, "prepare-decision")) {
    return prepareDecisionCli(flags);
  }
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
  let runProfileArgs = rawArgs;
  if (operatorDecisionFile) runProfileArgs = removeStringFlag(runProfileArgs, "operator-decision-file");
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
  const currentStep = asNonEmptyString(state.current_step);
  const pendingDecision = asRecord(state.pending_decision);
  const action = asNonEmptyString(pendingDecision.action) || "unknown";
  const stepObservations = Array.isArray(runProfileOutput.live_e2e_step_observation_files)
    ? runProfileOutput.live_e2e_step_observation_files
    : [];
  const latestObservationFile = stepObservations.at(-1);
  const latestObservation = latestObservationFile ? asRecord(readJson(latestObservationFile)) : {};
  const providerStepStatus = chooseProviderStepStatus([
    state.provider_step_status,
    latestObservation.provider_step_status,
  ]);
  const operatorDecisionStatus = asNonEmptyString(latestObservation.operator_decision_status) || null;
  const summaryFile = asNonEmptyString(runProfileOutput.live_e2e_run_summary_file);
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
        current_step: currentStep,
        completed_steps: Array.isArray(state.completed_steps) ? state.completed_steps : [],
        decision: Object.keys(pendingDecision).length > 0 ? pendingDecision : null,
        required_public_action: requiredPublicAction,
        agent_decision_request_ref: asNonEmptyString(latestObservation.agent_decision_request_ref) || null,
        operator_decision_ref: asNonEmptyString(latestObservation.operator_decision_ref) || null,
        installed_operator_decision_ref: installedOperatorDecisionRef,
        operator_decision_status: operatorDecisionStatus,
        provider_step_status: Object.keys(providerStepStatus).length > 0
          ? {
              provider: asNonEmptyString(providerStepStatus.provider) || null,
              adapter: asNonEmptyString(providerStepStatus.adapter) || null,
              route_id: asNonEmptyString(providerStepStatus.route_id) || null,
              step_id: asNonEmptyString(providerStepStatus.step_id) || null,
              status: asNonEmptyString(providerStepStatus.status) || null,
              elapsed_ms: typeof providerStepStatus.elapsed_ms === "number" ? providerStepStatus.elapsed_ms : null,
              timeout_budget_ms:
                typeof providerStepStatus.timeout_budget_ms === "number" ? providerStepStatus.timeout_budget_ms : null,
              remaining_budget_ms:
                typeof providerStepStatus.remaining_budget_ms === "number" ? providerStepStatus.remaining_budget_ms : null,
              last_output_at: asNonEmptyString(providerStepStatus.last_output_at) || null,
              last_artifact_update_at: asNonEmptyString(providerStepStatus.last_artifact_update_at) || null,
              current_command_label: asNonEmptyString(providerStepStatus.current_command_label) || null,
              recommended_action: asNonEmptyString(providerStepStatus.recommended_action) || null,
            }
          : null,
        aor_installation_proof_file: asNonEmptyString(runProfileOutput.aor_installation_proof_file) || null,
        live_e2e_run_summary_file: summaryFile || null,
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
