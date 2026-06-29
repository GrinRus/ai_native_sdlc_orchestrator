import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { loadContractFile, validateContractDocument } from "../../contracts/src/index.mjs";

import { initializeProjectRuntime } from "./project-init.mjs";
import { isSupportedWorkspaceMode, prepareWorkspaceIsolation } from "./workspace-isolation.mjs";

const NO_WRITE_PREFLIGHT_SEQUENCE = Object.freeze(["clone", "inspect", "analyze", "validate", "verify", "stop"]);
const DEFAULT_VERIFICATION_COMMAND_TIMEOUT_MS = 10 * 60 * 1000;
const MIN_VERIFICATION_COMMAND_TIMEOUT_MS = 1000;
const COMMAND_OUTPUT_MAX_BUFFER = 20 * 1024 * 1024;
const COMMAND_OUTPUT_EXCERPT_LINES = 40;
const OUTPUT_QUALITY_EXCERPT_MAX_LENGTH = 500;
const OUTPUT_QUALITY_WARNING_PATTERNS = Object.freeze([
  {
    ruleId: "stderr-language-warning",
    source: "stderr",
    severity: "error",
    pattern:
      /\b(?:BytesWarning|DeprecationWarning|EncodingWarning|FutureWarning|ImportWarning|PendingDeprecationWarning|ResourceWarning|RuntimeWarning|SyntaxWarning|UserWarning|Warning):/u,
    summary: "Verification command emitted warning output on stderr.",
  },
]);
const OUTPUT_QUALITY_BASELINE_STATUS_PRE_EXISTING = "pre_existing";

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? /** @type {Record<string, unknown>} */ (value) : {};
}

/**
 * @param {Record<string, unknown>} profile
 * @returns {Array<{ repoId: string, command: string }>}
 */
function asStringArray(value) {
  return Array.isArray(value)
    ? value.filter((entry) => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim())
    : [];
}

/**
 * @param {Record<string, unknown>} profile
 * @returns {string}
 */
function resolvePrimaryRepoId(profile) {
  const repos = Array.isArray(profile.repos) ? profile.repos : [];
  const firstRepo = repos.length > 0 ? /** @type {Record<string, unknown>} */ (repos[0]) : {};
  return typeof firstRepo.repo_id === "string" && firstRepo.repo_id.trim().length > 0 ? firstRepo.repo_id.trim() : "main";
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeFilePart(value) {
  const normalized = value.toLowerCase().replace(/[^a-z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "");
  return normalized.length > 0 ? normalized : "default";
}

/**
 * @param {Record<string, unknown>} profile
 * @param {{ repoBuildCommands?: string[], repoLintCommands?: string[], repoTestCommands?: string[] }} [overrides]
 * @returns {Array<{ repoId: string, command: string, commandSource: "project-profile" | "cli-override", commandKind: "lint" | "test" | "build" }>}
 */
function collectVerifyCommands(profile, overrides = {}) {
  const overrideGroups = [
    { kind: /** @type {"lint"} */ ("lint"), commands: asStringArray(overrides.repoLintCommands) },
    { kind: /** @type {"test"} */ ("test"), commands: asStringArray(overrides.repoTestCommands) },
    { kind: /** @type {"build"} */ ("build"), commands: asStringArray(overrides.repoBuildCommands) },
  ];
  if (overrideGroups.some((group) => group.commands.length > 0)) {
    const repoId = resolvePrimaryRepoId(profile);
    return overrideGroups.flatMap((group) =>
      group.commands.map((command) => ({
        repoId,
        command,
        commandSource: /** @type {"cli-override"} */ ("cli-override"),
        commandKind: group.kind,
      })),
    );
  }

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
          commands.push({
            repoId,
            command: command.trim(),
            commandSource: /** @type {"project-profile"} */ ("project-profile"),
            commandKind:
              key === "lint_commands"
                ? /** @type {"lint"} */ ("lint")
                : key === "test_commands"
                  ? /** @type {"test"} */ ("test")
                  : /** @type {"build"} */ ("build"),
          });
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

  const requestedWorkspaceMode =
    typeof runtimeDefaults.workspace_mode === "string" ? runtimeDefaults.workspace_mode : "ephemeral";
  if (!isSupportedWorkspaceMode(requestedWorkspaceMode)) {
    violations.push({
      stepSuffix: "workspace-isolation",
      summary: `Verify blocked because runtime workspace isolation mode '${requestedWorkspaceMode}' is unsupported.`,
      blockedNextStep:
        "Set runtime_defaults.workspace_mode to one of: ephemeral, workspace-clone, worktree; then rerun verify.",
      missingPrerequisites: [
        "runtime_defaults.workspace_mode must be one of: ephemeral, workspace-clone, worktree.",
      ],
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
 * @returns {NodeJS.ProcessEnv}
 */
function buildVerificationCommandEnv() {
  const env = { ...process.env };
  delete env.NODE_COMPILE_CACHE;
  env.NODE_DISABLE_COMPILE_CACHE = "1";
  return env;
}

/**
 * @param {string | null | undefined} value
 * @returns {string}
 */
function excerptOutputTail(value) {
  const text = typeof value === "string" ? value : "";
  return text.split(/\r?\n/u).slice(-COMMAND_OUTPUT_EXCERPT_LINES).join("\n");
}

/**
 * @param {string} text
 * @param {RegExp} pattern
 * @returns {string}
 */
function excerptFirstMatchingLine(text, pattern) {
  const line = text.split(/\r?\n/u).find((entry) => pattern.test(entry)) ?? text;
  return line.length > OUTPUT_QUALITY_EXCERPT_MAX_LENGTH
    ? `${line.slice(0, OUTPUT_QUALITY_EXCERPT_MAX_LENGTH)}...`
    : line;
}

/**
 * @param {import("node:child_process").SpawnSyncReturns<string>} commandRun
 * @returns {Array<{ rule_id: string, source: string, severity: string, summary: string, excerpt: string }>}
 */
function detectOutputQualityFindings(commandRun) {
  const stderr = typeof commandRun.stderr === "string" ? commandRun.stderr : "";
  /** @type {Array<{ rule_id: string, source: string, severity: string, summary: string, excerpt: string }>} */
  const findings = [];

  for (const rule of OUTPUT_QUALITY_WARNING_PATTERNS) {
    if (rule.pattern.test(stderr)) {
      findings.push({
        rule_id: rule.ruleId,
        source: rule.source,
        severity: rule.severity,
        summary: rule.summary,
        excerpt: excerptFirstMatchingLine(stderr, rule.pattern),
      });
    }
  }

  return findings;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeOutputQualityExcerpt(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/gu, " ") : "";
}

/**
 * @param {unknown} finding
 * @returns {string | null}
 */
function outputQualityFindingKey(finding) {
  const record = asRecord(finding);
  const ruleId = typeof record.rule_id === "string" ? record.rule_id.trim() : "";
  const source = typeof record.source === "string" ? record.source.trim() : "";
  const excerpt = normalizeOutputQualityExcerpt(record.excerpt);
  const warningMatch = /\b([A-Za-z]+Warning|Warning):/u.exec(excerpt);
  if (ruleId && source && warningMatch) {
    return `${ruleId}::${source}::${warningMatch[1]}`;
  }
  if (ruleId && source && excerpt) {
    return `${ruleId}::${source}::${excerpt.slice(0, 160)}`;
  }
  return null;
}

/**
 * @param {unknown} value
 * @param {string} cwd
 * @returns {string[]}
 */
function resolveOutputQualityBaselineFiles(value, cwd) {
  return asStringArray(value).map((entry) => (path.isAbsolute(entry) ? entry : path.resolve(cwd, entry)));
}

/**
 * @param {string[]} baselineFiles
 * @returns {Map<string, string[]>}
 */
function collectOutputQualityBaselineIndex(baselineFiles) {
  /** @type {Map<string, string[]>} */
  const baselineIndex = new Map();
  for (const baselineFile of baselineFiles) {
    if (!fs.existsSync(baselineFile)) {
      throw new Error(`Output quality baseline file '${baselineFile}' was not found.`);
    }
    const parsed = JSON.parse(fs.readFileSync(baselineFile, "utf8"));
    const record = asRecord(parsed);
    /** @type {unknown[]} */
    const findingGroups = [];
    const summaryFailedCommands = Array.isArray(record.output_quality_failed_commands)
      ? record.output_quality_failed_commands
      : [];
    const summaryObservedCommands = Array.isArray(record.output_quality_observed_commands)
      ? record.output_quality_observed_commands
      : [];
    for (const entry of [...summaryFailedCommands, ...summaryObservedCommands]) {
      const findings = asRecord(entry).findings;
      if (Array.isArray(findings)) {
        findingGroups.push(...findings);
      }
    }
    const directFindings = record.output_quality_findings;
    if (Array.isArray(directFindings)) {
      findingGroups.push(...directFindings);
    }

    for (const finding of findingGroups) {
      const key = outputQualityFindingKey(finding);
      if (!key) continue;
      const refs = baselineIndex.get(key) ?? [];
      refs.push(baselineFile);
      baselineIndex.set(key, Array.from(new Set(refs)));
    }
  }
  return baselineIndex;
}

/**
 * @param {Array<{ rule_id: string, source: string, severity: string, summary: string, excerpt: string }>} findings
 * @param {Map<string, string[]>} baselineIndex
 * @returns {Array<{ rule_id: string, source: string, severity: string, summary: string, excerpt: string, baseline_status?: string, baseline_evidence_refs?: string[] }>}
 */
function annotateOutputQualityFindings(findings, baselineIndex) {
  return findings.map((finding) => {
    const key = outputQualityFindingKey(finding);
    const baselineRefs = key ? baselineIndex.get(key) ?? [] : [];
    return baselineRefs.length > 0
      ? {
          ...finding,
          baseline_status: OUTPUT_QUALITY_BASELINE_STATUS_PRE_EXISTING,
          baseline_evidence_refs: baselineRefs,
        }
      : finding;
  });
}

/**
 * @param {unknown} finding
 * @returns {boolean}
 */
function isPreExistingOutputQualityFinding(finding) {
  return asRecord(finding).baseline_status === OUTPUT_QUALITY_BASELINE_STATUS_PRE_EXISTING;
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function secondsToTimeoutMs(value) {
  if (!Number.isFinite(value) || Number(value) <= 0) {
    return null;
  }

  const milliseconds = Math.floor(Number(value) * 1000);
  return Math.max(milliseconds, MIN_VERIFICATION_COMMAND_TIMEOUT_MS);
}

/**
 * @param {Record<string, unknown>} profile
 * @param {number | null | undefined} overrideMs
 * @returns {number}
 */
function resolveVerificationCommandTimeoutMs(profile, overrideMs) {
  if (Number.isFinite(overrideMs) && Number(overrideMs) > 0) {
    return Math.max(Math.floor(Number(overrideMs)), MIN_VERIFICATION_COMMAND_TIMEOUT_MS);
  }

  const runtimeDefaults = asRecord(profile.runtime_defaults);
  const budgetPolicy = asRecord(profile.budget_policy);
  const explicitProfileTimeout =
    secondsToTimeoutMs(runtimeDefaults.verification_command_timeout_sec) ??
    secondsToTimeoutMs(budgetPolicy.verification_command_timeout_sec);
  if (explicitProfileTimeout !== null) {
    return explicitProfileTimeout;
  }

  const budgetDefaultTimeout = secondsToTimeoutMs(budgetPolicy.default_timeout_sec);
  if (budgetDefaultTimeout !== null) {
    return Math.min(budgetDefaultTimeout, DEFAULT_VERIFICATION_COMMAND_TIMEOUT_MS);
  }

  return DEFAULT_VERIFICATION_COMMAND_TIMEOUT_MS;
}

/**
 * @param {import("node:child_process").SpawnSyncReturns<string>} commandRun
 * @returns {boolean}
 */
function commandTimedOut(commandRun) {
  const error = /** @type {{ code?: unknown } | undefined} */ (commandRun.error);
  return error?.code === "ETIMEDOUT";
}

/**
 * @param {number | undefined} pid
 */
function terminateTimedOutProcessGroup(pid) {
  if (process.platform === "win32" || !Number.isInteger(pid) || Number(pid) <= 0) {
    return;
  }

  for (const signal of ["SIGTERM", "SIGKILL"]) {
    try {
      process.kill(-Number(pid), signal);
    } catch {
      continue;
    }
  }
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
 *   commandSource?: string,
 *   commandKind?: string,
 *   verificationLabel?: string,
 *   missingPrerequisites?: string[],
 *   executionRoot?: string | null,
 *   isolationMode?: string | null,
 *   commandTimeoutMs?: number | null,
 *   timedOut?: boolean,
 *   startedAt?: string | null,
 *   finishedAt?: string | null,
 *   durationMs?: number | null,
 *   exitCode?: number | null,
 *   signal?: string | null,
 *   errorCode?: string | null,
 *   outputExcerpt?: { stdout_tail: string, stderr_tail: string } | null,
 *   outputQualityFindings?: Array<{
 *     rule_id: string,
 *     source: string,
 *     severity: string,
 *     summary: string,
 *     excerpt: string,
 *     baseline_status?: string,
 *     baseline_evidence_refs?: string[],
 *   }>,
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
    command_source: options.commandSource ?? "project-profile",
    command_kind: options.commandKind ?? null,
    verification_label: options.verificationLabel ?? "default",
    missing_prerequisites: options.missingPrerequisites ?? [],
    blocked_next_step: options.blockedNextStep ?? null,
    execution_root: options.executionRoot ?? null,
    execution_isolation_mode: options.isolationMode ?? null,
  };
  if (typeof options.commandTimeoutMs === "number") {
    stepResult.command_timeout_ms = options.commandTimeoutMs;
  }
  if (typeof options.timedOut === "boolean") {
    stepResult.timed_out = options.timedOut;
  }
  if (typeof options.startedAt === "string") {
    stepResult.started_at = options.startedAt;
  }
  if (typeof options.finishedAt === "string") {
    stepResult.finished_at = options.finishedAt;
  }
  if (typeof options.durationMs === "number") {
    stepResult.duration_ms = options.durationMs;
  }
  if (Object.hasOwn(options, "exitCode")) {
    stepResult.exit_code = options.exitCode ?? null;
  }
  if (Object.hasOwn(options, "signal")) {
    stepResult.signal = options.signal ?? null;
  }
  if (Object.hasOwn(options, "errorCode")) {
    stepResult.error_code = options.errorCode ?? null;
  }
  if (options.outputExcerpt && typeof options.outputExcerpt === "object") {
    stepResult.output_excerpt = options.outputExcerpt;
  }
  if (Array.isArray(options.outputQualityFindings) && options.outputQualityFindings.length > 0) {
    stepResult.output_quality_findings = options.outputQualityFindings;
  }

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
 *  verificationLabel?: string,
 *  repoBuildCommands?: string[],
 *  repoLintCommands?: string[],
 *  repoTestCommands?: string[],
 *  outputQualityBaselineFiles?: string[],
 *  verificationCommandTimeoutMs?: number,
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

  const verificationLabel =
    typeof options.verificationLabel === "string" && options.verificationLabel.trim().length > 0
      ? options.verificationLabel.trim()
      : "default";
  const verificationLabelFilePart = normalizeFilePart(verificationLabel);
  const outputQualityBaselineFiles = resolveOutputQualityBaselineFiles(
    options.outputQualityBaselineFiles,
    options.cwd ?? process.cwd(),
  );
  const outputQualityBaselineIndex = collectOutputQualityBaselineIndex(outputQualityBaselineFiles);
  const runId = `${init.projectId}.verify.${verificationLabel}.v1`;
  const workspaceIsolation = prepareWorkspaceIsolation({
    projectRoot: init.projectRoot,
    runtimeRoot: init.runtimeRoot,
    projectRuntimeRoot: init.runtimeLayout.projectRuntimeRoot,
    runtimeDefaults: preflightSafety.runtimeDefaults,
    runId,
  });
  const verifyCommands = collectVerifyCommands(profile, {
    repoBuildCommands: options.repoBuildCommands,
    repoLintCommands: options.repoLintCommands,
    repoTestCommands: options.repoTestCommands,
  });
  const commandTimeoutMs = resolveVerificationCommandTimeoutMs(profile, options.verificationCommandTimeoutMs);
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
        stepResultFileName:
          verificationLabel === "default"
            ? `step-result-${violation.stepSuffix}.json`
            : `step-result-${verificationLabelFilePart}-${violation.stepSuffix}.json`,
        blockedNextStep: violation.blockedNextStep,
        commandOwner: "project-profile",
        commandSource: "project-profile",
        commandKind: "preflight",
        verificationLabel,
        missingPrerequisites: violation.missingPrerequisites,
        executionRoot: workspaceIsolation.executionRoot,
        isolationMode: workspaceIsolation.mode,
      });
      stepResults.push(stepResult);
      stepResultFiles.push(stepResultPath);
    }
  } else {
    verifyCommands.forEach((item, index) => {
      const stepId = `verify.${verificationLabel}.command.${index + 1}`;
      const transcriptPath = path.join(
        init.runtimeLayout.reportsRoot,
        `verify-command-${verificationLabelFilePart}-${index + 1}.log`,
      );
      const startedAtMs = Date.now();
      const startedAt = new Date(startedAtMs).toISOString();
      const commandRun = spawnSync(item.command, {
        cwd: workspaceIsolation.executionRoot,
        shell: true,
        encoding: "utf8",
        env: buildVerificationCommandEnv(),
        timeout: commandTimeoutMs,
        killSignal: "SIGKILL",
        detached: process.platform !== "win32",
        maxBuffer: COMMAND_OUTPUT_MAX_BUFFER,
      });
      const finishedAtMs = Date.now();
      const finishedAt = new Date(finishedAtMs).toISOString();
      const durationMs = Math.max(0, finishedAtMs - startedAtMs);
      const timedOut = commandTimedOut(commandRun);
      if (timedOut) {
        terminateTimedOutProcessGroup(commandRun.pid);
      }
      const exitCode = typeof commandRun.status === "number" ? commandRun.status : null;
      const signal = typeof commandRun.signal === "string" && commandRun.signal.length > 0 ? commandRun.signal : null;
      const commandError = /** @type {{ code?: unknown } | undefined} */ (commandRun.error);
      const errorCode = typeof commandError?.code === "string" ? commandError.code : null;
      const outputQualityFindings =
        exitCode === 0 && !timedOut
          ? annotateOutputQualityFindings(detectOutputQualityFindings(commandRun), outputQualityBaselineIndex)
          : [];
      const outputQualityFailureFindings = outputQualityFindings.filter(
        (finding) => !isPreExistingOutputQualityFinding(finding),
      );
      const hasOutputQualityFailure = outputQualityFailureFindings.length > 0;
      const hasPreExistingOutputQualityFindings =
        outputQualityFindings.length > 0 && outputQualityFailureFindings.length === 0;

      const transcript = [
        `command: ${item.command}`,
        `command_source: ${item.commandSource}`,
        `command_kind: ${item.commandKind}`,
        `verification_label: ${verificationLabel}`,
        `repo_scope: ${item.repoId}`,
        `execution_root: ${workspaceIsolation.executionRoot}`,
        `execution_isolation_mode: ${workspaceIsolation.mode}`,
        `timeout_ms: ${commandTimeoutMs}`,
        `timed_out: ${timedOut}`,
        "node_compile_cache: disabled",
        `started_at: ${startedAt}`,
        `finished_at: ${finishedAt}`,
        `duration_ms: ${durationMs}`,
        `exit_code: ${exitCode ?? -1}`,
        `signal: ${signal ?? ""}`,
        `error_code: ${errorCode ?? ""}`,
        "stdout:",
        commandRun.stdout ?? "",
        "stderr:",
        commandRun.stderr ?? "",
      ].join("\n");
      fs.writeFileSync(transcriptPath, `${transcript}\n`, "utf8");

      const status = commandRun.status === 0 && !timedOut && !hasOutputQualityFailure ? "passed" : "failed";
      const missingPrerequisites =
        status === "failed" && !timedOut && !hasOutputQualityFailure
          ? inferMissingPrerequisites(item.command, commandRun)
          : [];
      const blockedNextStep =
        status === "failed"
          ? timedOut
            ? "Inspect transcript, reduce command scope or target hang risk, or raise runtime_defaults.verification_command_timeout_sec before rerunning verify."
            : hasOutputQualityFailure
              ? "Inspect stderr warning output, remove or explicitly resolve warning-producing test/code behavior, then rerun verify."
              : missingPrerequisites.length > 0
                ? `Resolve missing prerequisites (${missingPrerequisites.join("; ")}), then rerun verify.`
                : "Inspect transcript, fix command prerequisites or command definition ownership, then rerun verify."
          : null;

      const summary =
        status === "passed"
          ? hasPreExistingOutputQualityFindings
            ? `Verification command '${item.command}' passed; warning output matched baseline diagnostic evidence.`
            : `Verification command '${item.command}' passed under owner '${item.repoId}'.`
          : timedOut
            ? `Verification command '${item.command}' timed out after ${commandTimeoutMs}ms.`
            : hasOutputQualityFailure
              ? `Verification command '${item.command}' exited 0 but emitted warning output on stderr.`
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
        stepResultFileName:
          verificationLabel === "default"
            ? `step-result-${index + 1}.json`
            : `step-result-${verificationLabelFilePart}-${index + 1}.json`,
        blockedNextStep,
        repoScope: item.repoId,
        command: item.command,
        commandOwner: item.repoId,
        commandSource: item.commandSource,
        commandKind: item.commandKind,
        verificationLabel,
        missingPrerequisites,
        executionRoot: workspaceIsolation.executionRoot,
        isolationMode: workspaceIsolation.mode,
        commandTimeoutMs,
        timedOut,
        startedAt,
        finishedAt,
        durationMs,
        exitCode,
        signal,
        errorCode,
        outputExcerpt: {
          stdout_tail: excerptOutputTail(commandRun.stdout),
          stderr_tail: excerptOutputTail(commandRun.stderr),
        },
        outputQualityFindings,
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
      stepResultFileName:
        verificationLabel === "default"
          ? "step-result-no-commands.json"
          : `step-result-${verificationLabelFilePart}-no-commands.json`,
      blockedNextStep: "Define lint/test/build command lists in project profile repos[] and rerun verify.",
      commandOwner: "project-profile",
      commandSource: "project-profile",
      commandKind: "selection",
      verificationLabel,
      missingPrerequisites: ["At least one bounded command is required in repos[].lint/test/build command lists."],
      executionRoot: workspaceIsolation.executionRoot,
      isolationMode: workspaceIsolation.mode,
    });
    stepResults.push(stepResult);
    stepResultFiles.push(stepResultPath);
  }

  const summaryStatus = stepResults.some((result) => result.status === "failed") ? "failed" : "passed";
  const cleanupResult = workspaceIsolation.finalize(summaryStatus === "passed" ? "success" : "failure");
  const verifySummary = {
    run_id: runId,
    verification_label: verificationLabel,
    status: summaryStatus,
    validation_gate_status: validationGateStatus,
    command_source: verifyCommands.some((command) => command.commandSource === "cli-override")
      ? "cli-override"
      : "project-profile",
    command_overrides: {
      build_commands: asStringArray(options.repoBuildCommands),
      lint_commands: asStringArray(options.repoLintCommands),
      test_commands: asStringArray(options.repoTestCommands),
    },
    preflight_safety: {
      mode: "no-write",
      sequence: NO_WRITE_PREFLIGHT_SEQUENCE,
      writeback_policy: {
        allow_direct_write: preflightSafety.writebackPolicy.allow_direct_write ?? false,
      },
      workspace_mode:
        typeof preflightSafety.runtimeDefaults.workspace_mode === "string"
          ? preflightSafety.runtimeDefaults.workspace_mode
          : "ephemeral",
      network_mode: preflightSafety.toolingPolicy.network_mode ?? "unknown",
    },
    execution_isolation: {
      requested_mode: workspaceIsolation.requestedMode,
      mode: workspaceIsolation.mode,
      source_root: workspaceIsolation.sourceRoot,
      execution_root: workspaceIsolation.executionRoot,
      checkout: workspaceIsolation.checkout,
      provisioning: workspaceIsolation.provisioning,
      provisioned: workspaceIsolation.provisioned,
      cleanup_policy: workspaceIsolation.cleanupPolicy,
      cleanup: cleanupResult,
    },
    step_result_refs: stepResultFiles,
    command_timeout_ms: commandTimeoutMs,
    timed_out_commands: stepResults
      .filter((result) => result.timed_out === true)
      .map((result) => ({
        repo_scope: result.repo_scope ?? null,
        command: result.command ?? null,
        step_result_ref:
          stepResultFiles[stepResults.indexOf(result)] ?? null,
      })),
    output_quality_failed_commands: stepResults
      .filter((result) =>
        Array.isArray(result.output_quality_findings) &&
        result.output_quality_findings.some((finding) => !isPreExistingOutputQualityFinding(finding)),
      )
      .map((result) => ({
        repo_scope: result.repo_scope ?? null,
        command: result.command ?? null,
        step_result_ref: stepResultFiles[stepResults.indexOf(result)] ?? null,
        findings: result.output_quality_findings.filter((finding) => !isPreExistingOutputQualityFinding(finding)),
      })),
    output_quality_observed_commands: stepResults
      .filter((result) => Array.isArray(result.output_quality_findings) && result.output_quality_findings.length > 0)
      .map((result) => ({
        repo_scope: result.repo_scope ?? null,
        command: result.command ?? null,
        step_result_ref: stepResultFiles[stepResults.indexOf(result)] ?? null,
        findings: result.output_quality_findings,
      })),
    output_quality_baseline_files: outputQualityBaselineFiles,
    output_quality_baseline_matches: stepResults
      .filter((result) =>
        Array.isArray(result.output_quality_findings) &&
        result.output_quality_findings.some((finding) => isPreExistingOutputQualityFinding(finding)),
      )
      .map((result) => ({
        repo_scope: result.repo_scope ?? null,
        command: result.command ?? null,
        step_result_ref: stepResultFiles[stepResults.indexOf(result)] ?? null,
        findings: result.output_quality_findings.filter((finding) => isPreExistingOutputQualityFinding(finding)),
      })),
    output_quality_warning_patterns: OUTPUT_QUALITY_WARNING_PATTERNS.map((rule) => ({
      rule_id: rule.ruleId,
      source: rule.source,
      severity: rule.severity,
      summary: rule.summary,
    })),
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
      source_runbook: "docs/architecture/14-cli-command-catalog.md",
    },
    blocked_next_step:
      summaryStatus === "failed"
        ? "Inspect failed step-result files and fix missing prerequisites before rerunning verify."
        : null,
  };

  const verifySummaryFileName =
    verificationLabel === "default" ? "verify-summary.json" : `verify-summary-${verificationLabelFilePart}.json`;
  const verifySummaryPath = path.join(init.runtimeLayout.reportsRoot, verifySummaryFileName);
  fs.writeFileSync(verifySummaryPath, `${JSON.stringify(verifySummary, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(init.runtimeLayout.reportsRoot, "verify-summary.json"), `${JSON.stringify(verifySummary, null, 2)}\n`, "utf8");

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
