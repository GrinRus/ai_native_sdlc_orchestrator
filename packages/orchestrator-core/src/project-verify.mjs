import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { loadContractFile, validateContractDocument } from "../../contracts/src/index.mjs";

import { initializeProjectRuntime } from "./project-init.mjs";

const NO_WRITE_PREFLIGHT_SEQUENCE = Object.freeze(["clone", "inspect", "analyze", "validate", "verify", "stop"]);

/**
 * @param {Record<string, unknown>} profile
 * @returns {Array<{ repoId: string, command: string }>}
 */
function collectVerifyCommands(profile) {
  /** @type {Array<{ repoId: string, command: string }>} */
  const commands = [];
  const repos = Array.isArray(profile.repos) ? profile.repos : [];

  for (const repo of repos) {
    const repoRecord = /** @type {Record<string, unknown>} */ (repo);
    const repoId = typeof repoRecord.repo_id === "string" ? repoRecord.repo_id : "unknown";

    for (const key of ["lint_commands", "test_commands", "build_commands"]) {
      const candidateList = repoRecord[key];
      if (!Array.isArray(candidateList)) continue;
      for (const command of candidateList) {
        if (typeof command === "string" && command.trim().length > 0) {
          commands.push({ repoId, command });
        }
      }
    }
  }

  const seen = new Set();
  return commands.filter((item) => {
    const marker = `${item.repoId}::${item.command}`;
    if (seen.has(marker)) return false;
    seen.add(marker);
    return true;
  });
}

/**
 * @param {Record<string, unknown>} profile
 * @returns {{
 *   writebackPolicy: Record<string, unknown>,
 *   runtimeDefaults: Record<string, unknown>,
 *   toolingPolicy: Record<string, unknown>,
 *   violations: Array<{
 *     stepSuffix: string,
 *     summary: string,
 *     blockedNextStep: string,
 *     missingPrerequisites: string[],
 *   }>,
 * }}
 */
function evaluatePreflightSafety(profile) {
  const writebackPolicy = /** @type {Record<string, unknown>} */ (profile.writeback_policy ?? {});
  const runtimeDefaults = /** @type {Record<string, unknown>} */ (profile.runtime_defaults ?? {});
  const toolingPolicy = /** @type {Record<string, unknown>} */ (profile.tooling_policy ?? {});
  /** @type {Array<{ stepSuffix: string, summary: string, blockedNextStep: string, missingPrerequisites: string[] }>} */
  const violations = [];

  if (writebackPolicy.allow_direct_write === true) {
    violations.push({
      stepSuffix: "writeback-safety",
      summary: "Verify blocked because writeback policy allows direct writes.",
      blockedNextStep: "Disable direct writes in writeback_policy and rerun verify.",
      missingPrerequisites: ["writeback_policy.allow_direct_write must be false for no-write preflight."],
    });
  }

  if (runtimeDefaults.workspace_mode !== "ephemeral") {
    violations.push({
      stepSuffix: "workspace-isolation",
      summary: "Verify blocked because runtime workspace isolation is not ephemeral.",
      blockedNextStep: "Set runtime_defaults.workspace_mode to 'ephemeral' and rerun verify.",
      missingPrerequisites: ["runtime_defaults.workspace_mode must be 'ephemeral' for no-write preflight."],
    });
  }

  if (toolingPolicy.network_mode !== "deny-by-default") {
    violations.push({
      stepSuffix: "network-default",
      summary: "Verify blocked because tooling network defaults are not deny-by-default.",
      blockedNextStep: "Set tooling_policy.network_mode to 'deny-by-default' and rerun verify.",
      missingPrerequisites: ["tooling_policy.network_mode must be 'deny-by-default' for no-write preflight."],
    });
  }

  return {
    writebackPolicy,
    runtimeDefaults,
    toolingPolicy,
    violations,
  };
}

/**
 * @param {string} command
 * @param {import("node:child_process").SpawnSyncReturns<string>} commandRun
 * @returns {string[]}
 */
function inferMissingPrerequisites(command, commandRun) {
  const combinedOutput = `${commandRun.stdout ?? ""}\n${commandRun.stderr ?? ""}`;
  const lower = combinedOutput.toLowerCase();
  const firstToken = command.trim().split(/\s+/)[0] ?? command.trim();
  /** @type {string[]} */
  const prerequisites = [];

  if (commandRun.error && typeof commandRun.error.message === "string") {
    prerequisites.push(`shell execution failed: ${commandRun.error.message}`);
  }

  if (commandRun.status === 127 || lower.includes("command not found")) {
    prerequisites.push(`command '${firstToken}' is not available in the verification environment`);
  }

  if (lower.includes("enoent") && lower.includes("package.json")) {
    prerequisites.push("package.json is required for the configured package-manager command");
  }

  if (lower.includes("pnpm: not found")) {
    prerequisites.push("pnpm must be installed or replaced by an available command in project profile");
  }

  if (lower.includes("npm: not found")) {
    prerequisites.push("npm must be installed or replaced by an available command in project profile");
  }

  if (lower.includes("yarn: not found")) {
    prerequisites.push("yarn must be installed or replaced by an available command in project profile");
  }

  return Array.from(new Set(prerequisites));
}

/**
 * @param {{
 *   runtimeLayout: { reportsRoot: string },
 *   runId: string,
 *   stepId: string,
 *   stepResultId: string,
 *   status: "passed" | "failed",
 *   summary: string,
 *   evidenceRefs: string[],
 *   stepResultFileName: string,
 *   blockedNextStep?: string | null,
 *   repoScope?: string | null,
 *   command?: string | null,
 *   commandOwner?: string,
 *   missingPrerequisites?: string[],
 * }} options
 * @returns {{ stepResultPath: string, stepResult: Record<string, unknown> }}
 */
function materializeStepResult(options) {
  const stepResult = {
    step_result_id: options.stepResultId,
    run_id: options.runId,
    step_id: options.stepId,
    step_class: "runner",
    status: options.status,
    summary: options.summary,
    evidence_refs: options.evidenceRefs,
    repo_scope: options.repoScope ?? null,
    command: options.command ?? null,
    command_owner: options.commandOwner ?? "profile",
    missing_prerequisites: options.missingPrerequisites ?? [],
    blocked_next_step: options.blockedNextStep ?? null,
  };

  const validation = validateContractDocument({
    family: "step-result",
    document: stepResult,
    source: "runtime://step-result",
  });
  if (!validation.ok) {
    throw new Error(`Step result '${options.stepId}' failed contract validation.`);
  }

  const stepResultPath = path.join(options.runtimeLayout.reportsRoot, options.stepResultFileName);
  fs.writeFileSync(stepResultPath, `${JSON.stringify(stepResult, null, 2)}\n`, "utf8");
  return { stepResult, stepResultPath };
}

/**
 * @param {{ reportsRoot: string }} runtimeLayout
 * @returns {string}
 */
function readValidationGateStatus(runtimeLayout) {
  const validationReportPath = path.join(runtimeLayout.reportsRoot, "validation-report.json");
  if (!fs.existsSync(validationReportPath)) {
    throw new Error(
      `Validation gate is enabled but '${validationReportPath}' was not found. Run 'aor project validate' first.`,
    );
  }
  const parsed = JSON.parse(fs.readFileSync(validationReportPath, "utf8"));
  const status = parsed.status;
  if (typeof status !== "string") {
    throw new Error(`Validation report '${validationReportPath}' has no status.`);
  }
  if (status === "fail") {
    throw new Error(`Validation gate blocked verify flow because '${validationReportPath}' has status 'fail'.`);
  }
  return status;
}

/**
 * @param {{
 *  cwd?: string,
 *  projectRef?: string,
 *  projectProfile?: string,
 *  runtimeRoot?: string,
 *  requireValidationPass?: boolean,
 * }} options
 */
export function verifyProjectRuntime(options = {}) {
  const init = initializeProjectRuntime(options);

  const loadedProfile = loadContractFile({
    filePath: init.projectProfilePath,
    family: "project-profile",
  });

  if (!loadedProfile.ok) {
    throw new Error(`Project profile '${init.projectProfilePath}' failed contract validation.`);
  }

  const profile = /** @type {Record<string, unknown>} */ (loadedProfile.document);
  const preflightSafety = evaluatePreflightSafety(profile);

  const validationGateStatus = options.requireValidationPass ? readValidationGateStatus(init.runtimeLayout) : null;

  const runId = `${init.projectId}.verify.v1`;
  const verifyCommands = collectVerifyCommands(profile);
  const stepResultFiles = [];
  /** @type {Array<Record<string, unknown>>} */
  const stepResults = [];

  if (preflightSafety.violations.length > 0) {
    for (const violation of preflightSafety.violations) {
      const stepId = `verify.preflight.${violation.stepSuffix}`;
      const { stepResult, stepResultPath } = materializeStepResult({
        runtimeLayout: init.runtimeLayout,
        runId,
        stepId,
        stepResultId: `${runId}.step.${violation.stepSuffix}`,
        status: "failed",
        summary: violation.summary,
        evidenceRefs: [init.projectProfilePath, init.stateFile],
        stepResultFileName: `step-result-${violation.stepSuffix}.json`,
        blockedNextStep: violation.blockedNextStep,
        commandOwner: "project-profile",
        missingPrerequisites: violation.missingPrerequisites,
      });
      stepResults.push(stepResult);
      stepResultFiles.push(stepResultPath);
    }
  } else {
    verifyCommands.forEach((item, index) => {
      const stepId = `verify.command.${index + 1}`;
      const transcriptPath = path.join(init.runtimeLayout.reportsRoot, `verify-command-${index + 1}.log`);
      const commandRun = spawnSync(item.command, {
        cwd: init.projectRoot,
        shell: true,
        encoding: "utf8",
      });

      const transcript = [
        `command: ${item.command}`,
        `repo_scope: ${item.repoId}`,
        `exit_code: ${commandRun.status ?? -1}`,
        "stdout:",
        commandRun.stdout ?? "",
        "stderr:",
        commandRun.stderr ?? "",
      ].join("\n");
      fs.writeFileSync(transcriptPath, `${transcript}\n`, "utf8");

      const status = commandRun.status === 0 ? "passed" : "failed";
      const missingPrerequisites = status === "failed" ? inferMissingPrerequisites(item.command, commandRun) : [];
      const blockedNextStep =
        status === "failed"
          ? missingPrerequisites.length > 0
            ? `Resolve missing prerequisites (${missingPrerequisites.join("; ")}), then rerun verify.`
            : "Inspect transcript, fix command prerequisites or command definition ownership, then rerun verify."
          : null;

      const summary =
        status === "passed"
          ? `Verification command '${item.command}' passed under owner '${item.repoId}'.`
          : missingPrerequisites.length > 0
            ? `Verification command '${item.command}' failed: missing prerequisite(s) detected.`
            : `Verification command '${item.command}' failed with exit code ${commandRun.status ?? -1}.`;

      const { stepResult, stepResultPath } = materializeStepResult({
        runtimeLayout: init.runtimeLayout,
        runId,
        stepId,
        stepResultId: `${runId}.step.${index + 1}`,
        status,
        summary,
        evidenceRefs: [transcriptPath],
        stepResultFileName: `step-result-${index + 1}.json`,
        blockedNextStep,
        repoScope: item.repoId,
        command: item.command,
        commandOwner: item.repoId,
        missingPrerequisites,
      });
      stepResults.push(stepResult);
      stepResultFiles.push(stepResultPath);
    });
  }

  if (stepResults.length === 0) {
    const { stepResult, stepResultPath } = materializeStepResult({
      runtimeLayout: init.runtimeLayout,
      runId,
      stepId: "verify.command.selection",
      stepResultId: `${runId}.step.no-commands`,
      status: "failed",
      summary: "No bounded verification commands were found in project profile repos[].",
      evidenceRefs: [init.projectProfilePath],
      stepResultFileName: "step-result-no-commands.json",
      blockedNextStep: "Define lint/test/build command lists in project profile repos[] and rerun verify.",
      commandOwner: "project-profile",
      missingPrerequisites: ["At least one bounded command is required in repos[].lint/test/build command lists."],
    });
    stepResults.push(stepResult);
    stepResultFiles.push(stepResultPath);
  }

  const summaryStatus = stepResults.some((result) => result.status === "failed") ? "failed" : "passed";
  const verifySummary = {
    run_id: runId,
    status: summaryStatus,
    validation_gate_status: validationGateStatus,
    preflight_safety: {
      mode: "no-write",
      sequence: NO_WRITE_PREFLIGHT_SEQUENCE,
      writeback_policy: {
        allow_direct_write: preflightSafety.writebackPolicy.allow_direct_write ?? false,
      },
      workspace_mode: preflightSafety.runtimeDefaults.workspace_mode ?? "unknown",
      network_mode: preflightSafety.toolingPolicy.network_mode ?? "unknown",
    },
    step_result_refs: stepResultFiles,
    command_owners: Array.from(
      new Set(
        stepResults
          .map((result) =>
            typeof result.command_owner === "string" && result.command_owner.length > 0 ? result.command_owner : null,
          )
          .filter((value) => value !== null),
      ),
    ),
    reusable_by: {
      bootstrap_rehearsal: true,
      quality_rehearsal: true,
      delivery_rehearsal: true,
      source_runbook: "docs/ops/live-e2e-no-write-preflight.md",
    },
    blocked_next_step:
      summaryStatus === "failed"
        ? "Inspect failed step-result files and fix missing prerequisites before rerunning verify."
        : null,
  };

  const verifySummaryPath = path.join(init.runtimeLayout.reportsRoot, "verify-summary.json");
  fs.writeFileSync(verifySummaryPath, `${JSON.stringify(verifySummary, null, 2)}\n`, "utf8");

  return {
    ...init,
    runId,
    verifySummary,
    verifySummaryPath,
    stepResults,
    stepResultFiles,
    validationGateStatus,
  };
}
