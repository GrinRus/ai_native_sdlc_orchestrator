import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { loadContractFile, validateContractDocument } from "../../contracts/src/index.mjs";

import { initializeProjectRuntime } from "./project-init.mjs";
import { discoverVerificationCommandGroups } from "./stack-discovery.mjs";
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
const COMMAND_GROUP_ROLE_VALUES = Object.freeze(["setup", "build", "lint", "test", "typecheck", "e2e", "full-suite", "custom"]);
const COMMAND_GROUP_PHASE_VALUES = Object.freeze(["readiness", "baseline", "post-change", "diagnostic"]);
const COMMAND_GROUP_ENFORCEMENT_VALUES = Object.freeze(["required", "warn", "observe"]);
const COMMAND_GROUP_TIMEOUT_CLASS_VALUES = Object.freeze([
  "install",
  "build",
  "focused-test",
  "full-suite",
  "browser-e2e",
  "quick",
]);
const COMMAND_GROUP_TIMEOUT_CLASS_DEFAULT_MS = Object.freeze({
  install: 2 * 60 * 60 * 1000,
  build: 60 * 60 * 1000,
  "focused-test": 30 * 60 * 1000,
  "full-suite": 2 * 60 * 60 * 1000,
  "browser-e2e": 2 * 60 * 60 * 1000,
  quick: 10 * 60 * 1000,
});
const COMMAND_GROUP_OUTCOME_VALUES = Object.freeze(["no-tests", "missing-tool", "not-applicable", "broken-baseline"]);

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
 * @param {unknown} value
 * @returns {Array<Record<string, unknown>>}
 */
function asRecordArray(value) {
  return Array.isArray(value)
    ? value.filter((entry) => typeof entry === "object" && entry !== null && !Array.isArray(entry)).map((entry) => asRecord(entry))
    : [];
}

/**
 * @param {unknown} value
 * @returns {Array<Record<string, unknown>>}
 */
function normalizeToolRequirements(value) {
  return asRecordArray(value)
    .map((entry) => {
      const tool = typeof entry.tool === "string" && entry.tool.trim().length > 0 ? entry.tool.trim() : null;
      return tool ? { ...entry, tool } : null;
    })
    .filter((entry) => entry !== null);
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
 * @param {string} verificationLabel
 * @returns {"readiness" | "baseline" | "post-change" | "diagnostic"}
 */
function phaseFromVerificationLabel(verificationLabel) {
  const normalized = verificationLabel.toLowerCase();
  if (normalized.includes("baseline")) return "baseline";
  if (normalized.includes("diagnostic")) return "diagnostic";
  if (normalized.includes("post-run") || normalized.includes("post-change")) return "post-change";
  return "post-change";
}

/**
 * @param {string} role
 * @returns {"install" | "build" | "focused-test" | "full-suite" | "browser-e2e" | "quick"}
 */
function defaultTimeoutClassForRole(role) {
  if (role === "setup") return "install";
  if (role === "build" || role === "typecheck") return "build";
  if (role === "lint") return "quick";
  if (role === "e2e") return "browser-e2e";
  if (role === "full-suite") return "full-suite";
  return "focused-test";
}

/**
 * @param {string} value
 * @param {readonly string[]} allowed
 * @param {string} fallback
 * @returns {string}
 */
function normalizeEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

/**
 * @param {Record<string, unknown>} group
 * @param {number} index
 * @param {string} repoId
 * @param {string} source
 * @returns {{
 *   groupId: string,
 *   repoId: string,
 *   role: string,
 *   phase: string,
 *   enforcement: string,
 *   timeoutClass: string,
 *   workingDir: string,
 *   dependsOn: string[],
 *   skipPolicy: Record<string, unknown>,
 *   detectedFrom: string[],
 *   packageManager: string | null,
 *   toolRequirements: Array<Record<string, unknown>>,
 *   commandSource: string,
 *   commands: string[],
 * }}
 */
function normalizeProfileCommandGroup(group, index, repoId, source) {
  const role = normalizeEnum(String(group.role ?? ""), COMMAND_GROUP_ROLE_VALUES, "custom");
  const phase = normalizeEnum(String(group.phase ?? ""), COMMAND_GROUP_PHASE_VALUES, "post-change");
  const enforcement = normalizeEnum(String(group.enforcement ?? ""), COMMAND_GROUP_ENFORCEMENT_VALUES, "required");
  return {
    groupId:
      typeof group.id === "string" && group.id.trim().length > 0
        ? group.id.trim()
        : `${source}-command-group-${index + 1}`,
    repoId:
      typeof group.repo_id === "string" && group.repo_id.trim().length > 0
        ? group.repo_id.trim()
        : repoId,
    role,
    phase,
    enforcement,
    timeoutClass: normalizeEnum(
      String(group.timeout_class ?? ""),
      COMMAND_GROUP_TIMEOUT_CLASS_VALUES,
      defaultTimeoutClassForRole(role),
    ),
    workingDir:
      typeof group.working_dir === "string" && group.working_dir.trim().length > 0 ? group.working_dir.trim() : ".",
    dependsOn: asStringArray(group.depends_on),
    skipPolicy: asRecord(group.skip_policy),
    detectedFrom: asStringArray(group.detected_from),
    packageManager:
      typeof group.package_manager === "string" && group.package_manager.trim().length > 0
        ? group.package_manager.trim()
        : null,
    toolRequirements: normalizeToolRequirements(group.tool_requirements),
    commandSource: source,
    commands: asStringArray(group.commands),
  };
}

/**
 * @param {{
 *   id: string,
 *   repoId: string,
 *   role: "build" | "lint" | "test",
 *   phase: string,
 *   commands: string[],
 *   source: "project-profile" | "cli-override",
 * }} options
 * @returns {{
 *   groupId: string,
 *   repoId: string,
 *   role: string,
 *   phase: string,
 *   enforcement: string,
 *   timeoutClass: string,
 *   workingDir: string,
 *   dependsOn: string[],
 *   skipPolicy: Record<string, unknown>,
 *   detectedFrom: string[],
 *   packageManager: string | null,
 *   toolRequirements: Array<Record<string, unknown>>,
 *   commandSource: string,
 *   commands: string[],
 * }}
 */
function makeLegacyCommandGroup(options) {
  return {
    groupId: options.id,
    repoId: options.repoId,
    role: options.role,
    phase: options.phase,
    enforcement: "required",
    timeoutClass: defaultTimeoutClassForRole(options.role),
    workingDir: ".",
    dependsOn: [],
    skipPolicy: {},
    detectedFrom: [],
    packageManager: null,
    toolRequirements: [],
    commandSource: options.source,
    commands: asStringArray(options.commands),
  };
}

/**
 * @param {Record<string, unknown>} profile
 * @param {{ repoBuildCommands?: string[], repoLintCommands?: string[], repoTestCommands?: string[], verificationLabel?: string }} [overrides]
 * @returns {Array<{
 *   groupId: string,
 *   repoId: string,
 *   role: string,
 *   phase: string,
 *   enforcement: string,
 *   timeoutClass: string,
 *   commandSource: string,
 *   commands: string[],
 * }>}
 */
function collectVerificationCommandGroups(profile, overrides = {}) {
  const phase = phaseFromVerificationLabel(overrides.verificationLabel ?? "default");
  const overrideGroups = [
    { id: "cli-build", role: /** @type {"build"} */ ("build"), commands: asStringArray(overrides.repoBuildCommands) },
    { id: "cli-lint", role: /** @type {"lint"} */ ("lint"), commands: asStringArray(overrides.repoLintCommands) },
    { id: "cli-test", role: /** @type {"test"} */ ("test"), commands: asStringArray(overrides.repoTestCommands) },
  ];
  if (overrideGroups.some((group) => group.commands.length > 0)) {
    const repoId = resolvePrimaryRepoId(profile);
    return overrideGroups
      .filter((group) => group.commands.length > 0)
      .map((group) =>
        makeLegacyCommandGroup({
          id: group.id,
          repoId,
          role: group.role,
          phase,
          commands: group.commands,
          source: "cli-override",
        }),
      );
  }

  const verification = asRecord(profile.verification);
  const profileGroups = Array.isArray(verification.command_groups)
    ? verification.command_groups
        .filter((entry) => typeof entry === "object" && entry !== null && !Array.isArray(entry))
        .map((entry, index) =>
          normalizeProfileCommandGroup(
            /** @type {Record<string, unknown>} */ (entry),
            index,
            resolvePrimaryRepoId(profile),
            "project-profile",
          ),
        )
        .filter((group) => group.commands.length > 0)
    : [];
  if (profileGroups.length > 0) {
    return profileGroups.filter((group) => commandGroupAppliesToLabel(group, overrides.verificationLabel ?? "default"));
  }

  /** @type {Array<{ groupId: string, repoId: string, role: string, phase: string, enforcement: string, timeoutClass: string, commandSource: string, commands: string[] }>} */
  const groups = [];
  const repos = Array.isArray(profile.repos) ? profile.repos : [];

  for (const repo of repos) {
    const repoRecord = /** @type {Record<string, unknown>} */ (repo);
    const repoId = typeof repoRecord.repo_id === "string" ? repoRecord.repo_id : "unknown";
    for (const descriptor of [
      { field: "build_commands", role: /** @type {"build"} */ ("build") },
      { field: "lint_commands", role: /** @type {"lint"} */ ("lint") },
      { field: "test_commands", role: /** @type {"test"} */ ("test") },
    ]) {
      const commands = asStringArray(repoRecord[descriptor.field]);
      if (commands.length === 0) continue;
      groups.push(
        makeLegacyCommandGroup({
          id: `${repoId}-${descriptor.role}`,
          repoId,
          role: descriptor.role,
          phase,
          commands,
          source: "project-profile",
        }),
      );
    }
  }

  const seen = new Set();
  return groups
    .map((group) => ({
      ...group,
      commands: group.commands.filter((command) => {
        const marker = `${group.repoId}::${group.groupId}::${command}`;
        if (seen.has(marker)) return false;
        seen.add(marker);
        return true;
      }),
    }))
    .filter((group) => group.commands.length > 0);
}

/**
 * @param {{ reportsRoot: string }} runtimeLayout
 * @param {string} verificationLabel
 * @returns {string}
 */
function verificationPlanFileName(runtimeLayout, verificationLabel) {
  const verificationLabelFilePart = normalizeFilePart(verificationLabel);
  const fileName =
    verificationLabel === "default" ? "verification-plan.json" : `verification-plan-${verificationLabelFilePart}.json`;
  return path.join(runtimeLayout.reportsRoot, fileName);
}

/**
 * @param {{ reportsRoot: string }} runtimeLayout
 * @param {string} verificationLabel
 * @returns {string}
 */
function verifySummaryFileName(runtimeLayout, verificationLabel) {
  const verificationLabelFilePart = normalizeFilePart(verificationLabel);
  const fileName = verificationLabel === "default" ? "verify-summary.json" : `verify-summary-${verificationLabelFilePart}.json`;
  return path.join(runtimeLayout.reportsRoot, fileName);
}

/**
 * @param {string} filePath
 * @returns {Record<string, unknown> | null}
 */
function readJsonObject(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return asRecord(parsed);
  } catch {
    return null;
  }
}

/**
 * @param {string} reportsRoot
 * @param {RegExp} matcher
 * @returns {string[]}
 */
function listReportJsonFiles(reportsRoot, matcher) {
  if (!fs.existsSync(reportsRoot)) return [];
  return fs
    .readdirSync(reportsRoot)
    .filter((entry) => matcher.test(entry))
    .map((entry) => path.join(reportsRoot, entry))
    .sort((left, right) => {
      const leftStat = fs.statSync(left);
      const rightStat = fs.statSync(right);
      const mtimeDelta = rightStat.mtimeMs - leftStat.mtimeMs;
      if (mtimeDelta !== 0) return mtimeDelta;
      return path.basename(right).localeCompare(path.basename(left));
    });
}

/**
 * @param {{ reportsRoot: string }} runtimeLayout
 * @param {string} verificationLabel
 * @returns {{ summary: Record<string, unknown>, summaryPath: string } | null}
 */
function readLatestVerifySummary(runtimeLayout, verificationLabel) {
  const preferredPath = verifySummaryFileName(runtimeLayout, verificationLabel);
  const preferredSummary = readJsonObject(preferredPath);
  if (preferredSummary) return { summary: preferredSummary, summaryPath: preferredPath };

  for (const summaryPath of listReportJsonFiles(runtimeLayout.reportsRoot, /^verify-summary(?:-.+)?\.json$/u)) {
    const summary = readJsonObject(summaryPath);
    if (summary) return { summary, summaryPath };
  }
  return null;
}

/**
 * @param {unknown} value
 * @returns {Map<string, Record<string, unknown>>}
 */
function commandGroupStatusIndex(value) {
  const byId = new Map();
  const summary = asRecord(value);
  const groups = Array.isArray(summary.command_groups) ? summary.command_groups : [];
  for (const entry of groups) {
    const group = asRecord(entry);
    const id = typeof group.id === "string" && group.id.trim().length > 0 ? group.id.trim() : null;
    if (id) byId.set(id, group);
  }
  return byId;
}

/**
 * @param {ReturnType<typeof collectVerificationCommandGroups>[number]} group
 * @param {Record<string, unknown> | null} latestGroup
 * @param {Record<string, unknown>} profile
 * @param {number | null | undefined} commandTimeoutMs
 * @returns {Record<string, unknown>}
 */
function commandGroupPlanRow(group, latestGroup, profile, commandTimeoutMs) {
  const latestStatus =
    latestGroup && typeof latestGroup.status === "string" && latestGroup.status.trim().length > 0
      ? latestGroup.status.trim()
      : null;
  const skipOutcome =
    typeof group.skipPolicy.outcome === "string" && group.skipPolicy.outcome.trim().length > 0
      ? group.skipPolicy.outcome.trim()
      : null;
  return {
    id: group.groupId,
    repo_id: group.repoId,
    role: group.role,
    phase: group.phase,
    enforcement: group.enforcement,
    timeout_class: group.timeoutClass,
    command_timeout_ms: resolveVerificationCommandTimeoutMs(profile, commandTimeoutMs, group.timeoutClass),
    working_dir: group.workingDir,
    depends_on: group.dependsOn,
    command_source: group.commandSource,
    command_count: group.commands.length,
    commands: group.commands,
    status: latestStatus ?? "planned",
    last_result_status: latestStatus,
    outcome: typeof latestGroup?.outcome === "string" ? latestGroup.outcome : skipOutcome,
    step_result_refs: Array.isArray(latestGroup?.step_result_refs) ? latestGroup.step_result_refs : [],
    ...(Object.keys(group.skipPolicy).length > 0 ? { skip_policy: group.skipPolicy } : {}),
    ...(group.detectedFrom.length > 0 ? { detected_from: group.detectedFrom } : {}),
    ...(group.packageManager ? { package_manager: group.packageManager } : {}),
    ...(group.toolRequirements.length > 0 ? { tool_requirements: group.toolRequirements } : {}),
  };
}

/**
 * @param {Record<string, unknown>} candidate
 * @returns {Record<string, unknown>}
 */
function discoveryCandidatePlanRow(candidate) {
  const commandGroup = asRecord(candidate.command_group);
  const commands = asStringArray(commandGroup.commands);
  return {
    candidate_id:
      typeof candidate.candidate_id === "string" && candidate.candidate_id.trim().length > 0
        ? candidate.candidate_id.trim()
        : typeof commandGroup.id === "string"
          ? commandGroup.id
          : "command-group-candidate",
    confidence: typeof candidate.confidence === "string" ? candidate.confidence : "low",
    source_refs: asStringArray(candidate.source_refs),
    command_group: {
      id: typeof commandGroup.id === "string" ? commandGroup.id : null,
      repo_id: typeof commandGroup.repo_id === "string" ? commandGroup.repo_id : null,
      role: typeof commandGroup.role === "string" ? commandGroup.role : "custom",
      phase: typeof commandGroup.phase === "string" ? commandGroup.phase : "post-change",
      enforcement: typeof commandGroup.enforcement === "string" ? commandGroup.enforcement : "required",
      timeout_class: typeof commandGroup.timeout_class === "string" ? commandGroup.timeout_class : "focused-test",
      working_dir: typeof commandGroup.working_dir === "string" ? commandGroup.working_dir : ".",
      command_count: commands.length,
      commands,
      detected_from: asStringArray(commandGroup.detected_from),
      ...(typeof commandGroup.package_manager === "string" && commandGroup.package_manager.trim().length > 0
        ? { package_manager: commandGroup.package_manager.trim() }
        : {}),
      ...(normalizeToolRequirements(commandGroup.tool_requirements).length > 0
        ? { tool_requirements: normalizeToolRequirements(commandGroup.tool_requirements) }
        : {}),
    },
  };
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
 *  verificationCommandTimeoutMs?: number,
 * }} options
 */
export function planProjectVerification(options = {}) {
  const init = initializeProjectRuntime(options);

  const loadedProfile = loadContractFile({
    filePath: init.projectProfilePath,
    family: "project-profile",
  });

  if (!loadedProfile.ok) {
    throw new Error(`Project profile '${init.projectProfilePath}' failed contract validation.`);
  }

  const profile = /** @type {Record<string, unknown>} */ (loadedProfile.document);
  const verificationLabel =
    typeof options.verificationLabel === "string" && options.verificationLabel.trim().length > 0
      ? options.verificationLabel.trim()
      : "default";
  const validationGateStatus = options.requireValidationPass ? readValidationGateStatus(init.runtimeLayout) : null;
  const commandGroups = collectVerificationCommandGroups(profile, {
    repoBuildCommands: options.repoBuildCommands,
    repoLintCommands: options.repoLintCommands,
    repoTestCommands: options.repoTestCommands,
    verificationLabel,
  });
  const verifyCommands = flattenCommandGroups(commandGroups);
  const latestSummary = readLatestVerifySummary(init.runtimeLayout, verificationLabel);
  const latestGroups = commandGroupStatusIndex(latestSummary?.summary);
  const stackDiscovery = discoverVerificationCommandGroups({
    projectRoot: init.projectRoot,
    repoId: resolvePrimaryRepoId(profile),
  });
  const commandGroupRows = commandGroups.map((group) =>
    commandGroupPlanRow(group, latestGroups.get(group.groupId) ?? null, profile, options.verificationCommandTimeoutMs),
  );
  const discoveryCandidates = stackDiscovery.command_group_candidates.map((candidate) =>
    discoveryCandidatePlanRow(candidate),
  );
  const plan = {
    report_id: `${init.projectId}.verification-plan.${verificationLabel}.v1`,
    project_id: init.projectId,
    version: 1,
    generated_from: {
      command: "aor project verify --plan",
      project_root: init.projectRoot,
      project_profile_ref: init.projectProfileRef,
    },
    verification_label: verificationLabel,
    validation_gate_status: validationGateStatus,
    command_source: verifyCommands.some((command) => command.commandSource === "cli-override")
      ? "cli-override"
      : "project-profile",
    command_count: verifyCommands.length,
    command_groups: commandGroupRows,
    discovered_command_groups: discoveryCandidates,
    discovery_outcomes: stackDiscovery.outcomes,
    discovery_suggestions: stackDiscovery.suggestions,
    package_boundaries: stackDiscovery.package_boundaries,
    detections: stackDiscovery.detections,
    latest_verify_summary_ref: latestSummary?.summaryPath ?? null,
    latest_verify_status:
      typeof latestSummary?.summary.status === "string" ? latestSummary.summary.status : null,
    status: commandGroupRows.length > 0 ? "planned" : "no-tests",
  };

  const planPath = verificationPlanFileName(init.runtimeLayout, verificationLabel);
  fs.writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(init.runtimeLayout.reportsRoot, "verification-plan.json"), `${JSON.stringify(plan, null, 2)}\n`, "utf8");

  return {
    ...init,
    verificationLabel,
    verificationPlan: plan,
    verificationPlanPath: planPath,
    validationGateStatus,
  };
}

/**
 * @param {{ phase: string }} group
 * @param {string} verificationLabel
 * @returns {boolean}
 */
function commandGroupAppliesToLabel(group, verificationLabel) {
  if (group.phase === "readiness") return true;
  const selectedPhase = phaseFromVerificationLabel(verificationLabel);
  if (verificationLabel === "default") return true;
  return group.phase === selectedPhase;
}

/**
 * @param {ReturnType<typeof collectVerificationCommandGroups>} commandGroups
 * @returns {Array<{
 *   repoId: string,
 *   command: string,
 *   commandSource: string,
 *   commandKind: string,
 *   commandGroupId: string,
 *   commandGroupRole: string,
 *   commandGroupPhase: string,
 *   commandGroupEnforcement: string,
 *   commandGroupTimeoutClass: string,
 *   commandGroupWorkingDir: string,
 * }>}
 */
function flattenCommandGroups(commandGroups) {
  return commandGroups.flatMap((group) =>
    group.commands.map((command) => ({
      repoId: group.repoId,
      command,
      commandSource: group.commandSource,
      commandKind: group.role,
      commandGroupId: group.groupId,
      commandGroupRole: group.role,
      commandGroupPhase: group.phase,
      commandGroupEnforcement: group.enforcement,
      commandGroupTimeoutClass: group.timeoutClass,
      commandGroupWorkingDir: group.workingDir,
    })),
  );
}

/**
 * @param {string} executionRoot
 * @param {string} workingDir
 * @returns {{ ok: true, cwd: string, workingDir: string } | { ok: false, cwd: string, workingDir: string, reason: string }}
 */
function resolveCommandWorkingDir(executionRoot, workingDir) {
  const selectedWorkingDir = typeof workingDir === "string" && workingDir.trim().length > 0 ? workingDir.trim() : ".";
  const cwd = path.resolve(executionRoot, selectedWorkingDir);
  const relative = path.relative(executionRoot, cwd);
  const insideExecutionRoot = relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  if (!insideExecutionRoot) {
    return {
      ok: false,
      cwd,
      workingDir: selectedWorkingDir,
      reason: `working_dir '${selectedWorkingDir}' resolves outside the execution root`,
    };
  }
  if (!fs.existsSync(cwd)) {
    return {
      ok: false,
      cwd,
      workingDir: selectedWorkingDir,
      reason: `working_dir '${selectedWorkingDir}' does not exist in the execution root`,
    };
  }
  return { ok: true, cwd, workingDir: selectedWorkingDir };
}

/**
 * @param {unknown} value
 * @returns {"no-tests" | "missing-tool" | "not-applicable" | "broken-baseline"}
 */
function normalizeCommandGroupOutcome(value) {
  return typeof value === "string" && COMMAND_GROUP_OUTCOME_VALUES.includes(value)
    ? /** @type {"no-tests" | "missing-tool" | "not-applicable" | "broken-baseline"} */ (value)
    : "not-applicable";
}

/**
 * @param {Record<string, unknown>} group
 * @returns {"no-tests" | "missing-tool" | "not-applicable" | "broken-baseline"}
 */
function skippedOutcomeForGroup(group) {
  return normalizeCommandGroupOutcome(asRecord(group.skipPolicy).outcome);
}

/**
 * @param {string} phase
 * @returns {string}
 */
function phaseFailureLabel(phase) {
  if (phase === "baseline") return "Baseline";
  if (phase === "post-change") return "Post-change";
  if (phase === "readiness") return "Readiness";
  if (phase === "diagnostic") return "Diagnostic";
  return "Verification";
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
 * @param {string | null | undefined} timeoutClass
 * @returns {number}
 */
function resolveVerificationCommandTimeoutMs(profile, overrideMs, timeoutClass = null) {
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

  if (
    typeof timeoutClass === "string" &&
    Object.prototype.hasOwnProperty.call(COMMAND_GROUP_TIMEOUT_CLASS_DEFAULT_MS, timeoutClass)
  ) {
    return Math.max(
      COMMAND_GROUP_TIMEOUT_CLASS_DEFAULT_MS[/** @type {keyof typeof COMMAND_GROUP_TIMEOUT_CLASS_DEFAULT_MS} */ (timeoutClass)],
      MIN_VERIFICATION_COMMAND_TIMEOUT_MS,
    );
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
 *   commandGroupId?: string | null,
 *   commandGroupRole?: string | null,
 *   commandGroupPhase?: string | null,
 *   commandGroupEnforcement?: string | null,
 *   commandGroupTimeoutClass?: string | null,
 *   commandGroupOutcome?: string | null,
 *   enforcementResult?: string | null,
 *   verificationLabel?: string,
 *   missingPrerequisites?: string[],
 *   executionRoot?: string | null,
 *   workingDir?: string | null,
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
    working_dir: options.workingDir ?? null,
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
  for (const [field, value] of [
    ["command_group_id", options.commandGroupId],
    ["command_group_role", options.commandGroupRole],
    ["command_group_phase", options.commandGroupPhase],
    ["command_group_enforcement", options.commandGroupEnforcement],
    ["command_group_timeout_class", options.commandGroupTimeoutClass],
    ["command_group_outcome", options.commandGroupOutcome],
    ["enforcement_result", options.enforcementResult],
  ]) {
    if (typeof value === "string" && value.length > 0) {
      stepResult[field] = value;
    }
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
  const commandGroups = collectVerificationCommandGroups(profile, {
    repoBuildCommands: options.repoBuildCommands,
    repoLintCommands: options.repoLintCommands,
    repoTestCommands: options.repoTestCommands,
    verificationLabel,
  });
  const verifyCommands = flattenCommandGroups(commandGroups);
  const commandTimeoutValues = verifyCommands.map((command) =>
    resolveVerificationCommandTimeoutMs(profile, options.verificationCommandTimeoutMs, command.commandGroupTimeoutClass),
  );
  const summaryCommandTimeoutMs =
    commandTimeoutValues.length > 0 ? Math.max(...commandTimeoutValues) : resolveVerificationCommandTimeoutMs(profile, options.verificationCommandTimeoutMs);
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
    let commandOrdinal = 0;
    /** @type {Map<string, { blocking: boolean, status: string }>} */
    const groupExecution = new Map();

    for (const group of commandGroups) {
      const failedDependencies = group.dependsOn.filter((dependencyId) => groupExecution.get(dependencyId)?.blocking === true);
      if (failedDependencies.length > 0) {
        commandOrdinal += 1;
        const stepId = `verify.${verificationLabel}.command.${commandOrdinal}`;
        const transcriptPath = path.join(
          init.runtimeLayout.reportsRoot,
          `verify-command-${verificationLabelFilePart}-${commandOrdinal}.log`,
        );
        const commandTimeoutMs = resolveVerificationCommandTimeoutMs(
          profile,
          options.verificationCommandTimeoutMs,
          group.timeoutClass,
        );
        const outcome = skippedOutcomeForGroup(group);
        const enforcementResult =
          group.enforcement === "observe" ? "observe" : group.enforcement === "warn" ? "warn" : "fail";
        const summary = `Skipped command group '${group.groupId}' because dependency group(s) failed: ${failedDependencies.join(", ")}.`;
        const transcript = [
          `command_group_id: ${group.groupId}`,
          `command_source: ${group.commandSource}`,
          `command_kind: ${group.role}`,
          `verification_label: ${verificationLabel}`,
          `repo_scope: ${group.repoId}`,
          `working_dir: ${group.workingDir}`,
          `execution_root: ${workspaceIsolation.executionRoot}`,
          `execution_isolation_mode: ${workspaceIsolation.mode}`,
          `timeout_ms: ${commandTimeoutMs}`,
          "skipped: true",
          `skipped_dependencies: ${failedDependencies.join(",")}`,
          `command_group_outcome: ${outcome}`,
        ].join("\n");
        fs.writeFileSync(transcriptPath, `${transcript}\n`, "utf8");

        const { stepResult, stepResultPath } = materializeStepResult({
          runtimeLayout: init.runtimeLayout,
          runId,
          stepId,
          stepResultId: `${runId}.step.${commandOrdinal}`,
          status: "failed",
          summary,
          evidenceRefs: [transcriptPath],
          stepResultFileName:
            verificationLabel === "default"
              ? `step-result-${commandOrdinal}.json`
              : `step-result-${verificationLabelFilePart}-${commandOrdinal}.json`,
          blockedNextStep: `Rerun verify after dependency group(s) pass: ${failedDependencies.join(", ")}.`,
          repoScope: group.repoId,
          command: null,
          commandOwner: group.repoId,
          commandSource: group.commandSource,
          commandKind: group.role,
          commandGroupId: group.groupId,
          commandGroupRole: group.role,
          commandGroupPhase: group.phase,
          commandGroupEnforcement: group.enforcement,
          commandGroupTimeoutClass: group.timeoutClass,
          commandGroupOutcome: outcome,
          enforcementResult,
          verificationLabel,
          missingPrerequisites: [`depends_on failed: ${failedDependencies.join(", ")}`],
          executionRoot: workspaceIsolation.executionRoot,
          workingDir: group.workingDir,
          isolationMode: workspaceIsolation.mode,
          commandTimeoutMs,
        });
        stepResults.push(stepResult);
        stepResultFiles.push(stepResultPath);
        groupExecution.set(group.groupId, {
          blocking: group.enforcement === "required",
          status: "skipped",
        });
        continue;
      }

      let groupBlockingFailure = false;
      let groupFailed = false;

      for (const command of group.commands) {
        commandOrdinal += 1;
        const item = {
          repoId: group.repoId,
          command,
          commandSource: group.commandSource,
          commandKind: group.role,
          commandGroupId: group.groupId,
          commandGroupRole: group.role,
          commandGroupPhase: group.phase,
          commandGroupEnforcement: group.enforcement,
          commandGroupTimeoutClass: group.timeoutClass,
          commandGroupWorkingDir: group.workingDir,
        };
      const commandTimeoutMs = resolveVerificationCommandTimeoutMs(
        profile,
        options.verificationCommandTimeoutMs,
        item.commandGroupTimeoutClass,
      );
      const stepId = `verify.${verificationLabel}.command.${commandOrdinal}`;
      const transcriptPath = path.join(
        init.runtimeLayout.reportsRoot,
        `verify-command-${verificationLabelFilePart}-${commandOrdinal}.log`,
      );
      const workingDirResolution = resolveCommandWorkingDir(
        workspaceIsolation.executionRoot,
        item.commandGroupWorkingDir,
      );
      if (!workingDirResolution.ok) {
        const transcript = [
          `command: ${item.command}`,
          `command_source: ${item.commandSource}`,
          `command_kind: ${item.commandKind}`,
          `verification_label: ${verificationLabel}`,
          `repo_scope: ${item.repoId}`,
          `working_dir: ${workingDirResolution.workingDir}`,
          `command_cwd: ${workingDirResolution.cwd}`,
          `execution_root: ${workspaceIsolation.executionRoot}`,
          `execution_isolation_mode: ${workspaceIsolation.mode}`,
          `timeout_ms: ${commandTimeoutMs}`,
          `working_dir_error: ${workingDirResolution.reason}`,
        ].join("\n");
        fs.writeFileSync(transcriptPath, `${transcript}\n`, "utf8");
        const { stepResult, stepResultPath } = materializeStepResult({
          runtimeLayout: init.runtimeLayout,
          runId,
          stepId,
          stepResultId: `${runId}.step.${commandOrdinal}`,
          status: "failed",
          summary: `Verification command '${item.command}' failed before execution: ${workingDirResolution.reason}.`,
          evidenceRefs: [transcriptPath],
          stepResultFileName:
            verificationLabel === "default"
              ? `step-result-${commandOrdinal}.json`
              : `step-result-${verificationLabelFilePart}-${commandOrdinal}.json`,
          blockedNextStep: "Fix command_group.working_dir so it resolves inside the execution root, then rerun verify.",
          repoScope: item.repoId,
          command: item.command,
          commandOwner: item.repoId,
          commandSource: item.commandSource,
          commandKind: item.commandKind,
          commandGroupId: item.commandGroupId,
          commandGroupRole: item.commandGroupRole,
          commandGroupPhase: item.commandGroupPhase,
          commandGroupEnforcement: item.commandGroupEnforcement,
          commandGroupTimeoutClass: item.commandGroupTimeoutClass,
          enforcementResult:
            item.commandGroupEnforcement === "observe"
              ? "observe"
              : item.commandGroupEnforcement === "warn"
                ? "warn"
                : "fail",
          verificationLabel,
          missingPrerequisites: [workingDirResolution.reason],
          executionRoot: workspaceIsolation.executionRoot,
          workingDir: workingDirResolution.workingDir,
          isolationMode: workspaceIsolation.mode,
          commandTimeoutMs,
          timedOut: false,
          startedAt: null,
          finishedAt: null,
          durationMs: null,
          exitCode: null,
          signal: null,
          errorCode: null,
          outputExcerpt: {
            stdout_tail: "",
            stderr_tail: workingDirResolution.reason,
          },
        });
        stepResults.push(stepResult);
        stepResultFiles.push(stepResultPath);
        groupFailed = true;
        if (item.commandGroupEnforcement === "required") {
          groupBlockingFailure = true;
        }
        continue;
      }
      const startedAtMs = Date.now();
      const startedAt = new Date(startedAtMs).toISOString();
      const commandRun = spawnSync(item.command, {
        cwd: workingDirResolution.cwd,
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
        `working_dir: ${workingDirResolution.workingDir}`,
        `command_cwd: ${workingDirResolution.cwd}`,
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
      const enforcementResult =
        status === "passed"
          ? "pass"
          : item.commandGroupEnforcement === "observe"
            ? "observe"
            : item.commandGroupEnforcement === "warn"
              ? "warn"
              : "fail";
      const missingPrerequisites =
        status === "failed" && !timedOut && !hasOutputQualityFailure
          ? inferMissingPrerequisites(item.command, commandRun)
          : [];
      const commandGroupOutcome =
        status === "failed" && missingPrerequisites.length > 0
          ? "missing-tool"
          : status === "failed" && item.commandGroupPhase === "baseline" && item.commandGroupEnforcement === "required"
            ? "broken-baseline"
            : null;
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
            : `${phaseFailureLabel(item.commandGroupPhase)} verification command '${item.command}' failed with exit code ${commandRun.status ?? -1}.`;

      const { stepResult, stepResultPath } = materializeStepResult({
        runtimeLayout: init.runtimeLayout,
        runId,
        stepId,
        stepResultId: `${runId}.step.${commandOrdinal}`,
        status,
        summary,
        evidenceRefs: [transcriptPath],
        stepResultFileName:
          verificationLabel === "default"
            ? `step-result-${commandOrdinal}.json`
            : `step-result-${verificationLabelFilePart}-${commandOrdinal}.json`,
        blockedNextStep,
        repoScope: item.repoId,
        command: item.command,
        commandOwner: item.repoId,
        commandSource: item.commandSource,
        commandKind: item.commandKind,
        commandGroupId: item.commandGroupId,
        commandGroupRole: item.commandGroupRole,
        commandGroupPhase: item.commandGroupPhase,
        commandGroupEnforcement: item.commandGroupEnforcement,
        commandGroupTimeoutClass: item.commandGroupTimeoutClass,
        commandGroupOutcome,
        enforcementResult,
        verificationLabel,
        missingPrerequisites,
        executionRoot: workspaceIsolation.executionRoot,
        workingDir: workingDirResolution.workingDir,
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
        if (status === "failed") {
          groupFailed = true;
          if (item.commandGroupEnforcement === "required") {
            groupBlockingFailure = true;
          }
        }
      }

      groupExecution.set(group.groupId, {
        blocking: groupBlockingFailure,
        status: groupBlockingFailure ? "failed" : groupFailed ? "nonblocking-failure" : "passed",
      });
    }
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

  const requiredFailures = stepResults.filter(
    (result) => result.status === "failed" && result.command_group_enforcement !== "warn" && result.command_group_enforcement !== "observe",
  );
  const warningFailures = stepResults.filter(
    (result) => result.status === "failed" && result.command_group_enforcement === "warn",
  );
  const observedFailures = stepResults.filter(
    (result) => result.status === "failed" && result.command_group_enforcement === "observe",
  );
  const summaryStatus = requiredFailures.length > 0 ? "failed" : warningFailures.length > 0 ? "warn" : "passed";
  const cleanupResult = workspaceIsolation.finalize(summaryStatus === "passed" ? "success" : "failure");
  const commandGroupResults = commandGroups.map((group) => {
    const groupSteps = stepResults.filter((result) => result.command_group_id === group.groupId);
    const failedSteps = groupSteps.filter((result) => result.status === "failed");
    const skippedSteps = groupSteps.filter((result) => result.command_group_outcome === "not-applicable");
    const executableFailedSteps = failedSteps.filter((result) => result.command_group_outcome !== "not-applicable");
    const status =
      skippedSteps.length > 0 && executableFailedSteps.length === 0
        ? "skipped"
        : failedSteps.length === 0
        ? "passed"
        : group.enforcement === "observe"
          ? "observed"
          : group.enforcement === "warn"
            ? "warn"
            : "failed";
    return {
      id: group.groupId,
      repo_id: group.repoId,
      role: group.role,
      phase: group.phase,
      enforcement: group.enforcement,
      timeout_class: group.timeoutClass,
      working_dir: group.workingDir,
      depends_on: group.dependsOn,
      status,
      command_count: group.commands.length,
      failed_command_count: failedSteps.length,
      skipped_command_count: skippedSteps.length,
      outcome: typeof skippedSteps[0]?.command_group_outcome === "string" ? skippedSteps[0].command_group_outcome : null,
      step_result_refs: groupSteps
        .map((result) => stepResultFiles[stepResults.indexOf(result)] ?? null)
        .filter((entry) => typeof entry === "string" && entry.length > 0),
    };
  });
  const missingToolSteps = stepResults.filter((result) => result.command_group_outcome === "missing-tool");
  const skippedSteps = stepResults.filter((result) => result.command_group_outcome === "not-applicable");
  const brokenBaselineSteps = stepResults.filter((result) => result.command_group_outcome === "broken-baseline");
  const baselineFailures = stepResults.filter(
    (result) => result.status === "failed" && result.command_group_phase === "baseline",
  );
  const postChangeFailures = stepResults.filter(
    (result) => result.status === "failed" && result.command_group_phase === "post-change",
  );
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
    command_groups: commandGroupResults,
    command_group_policy: {
      roles: COMMAND_GROUP_ROLE_VALUES,
      phases: COMMAND_GROUP_PHASE_VALUES,
      enforcement: COMMAND_GROUP_ENFORCEMENT_VALUES,
      timeout_classes: COMMAND_GROUP_TIMEOUT_CLASS_VALUES,
      timeout_class_defaults_ms: COMMAND_GROUP_TIMEOUT_CLASS_DEFAULT_MS,
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
    command_timeout_ms: summaryCommandTimeoutMs,
    timed_out_commands: stepResults
      .filter((result) => result.timed_out === true)
      .map((result) => ({
        repo_scope: result.repo_scope ?? null,
        command: result.command ?? null,
        step_result_ref:
          stepResultFiles[stepResults.indexOf(result)] ?? null,
      })),
    missing_tool_commands: missingToolSteps.map((result) => ({
      repo_scope: result.repo_scope ?? null,
      command: result.command ?? null,
      command_group_id: result.command_group_id ?? null,
      step_result_ref: stepResultFiles[stepResults.indexOf(result)] ?? null,
      missing_prerequisites: Array.isArray(result.missing_prerequisites) ? result.missing_prerequisites : [],
    })),
    skipped_command_groups: skippedSteps.map((result) => ({
      repo_scope: result.repo_scope ?? null,
      command_group_id: result.command_group_id ?? null,
      depends_on: commandGroups.find((group) => group.groupId === result.command_group_id)?.dependsOn ?? [],
      step_result_ref: stepResultFiles[stepResults.indexOf(result)] ?? null,
      reason: result.summary ?? null,
    })),
    phase_summary: {
      baseline_failed_count: baselineFailures.length,
      post_change_failed_count: postChangeFailures.length,
      broken_baseline_count: brokenBaselineSteps.length,
      baseline_failed_step_result_refs: baselineFailures
        .map((result) => stepResultFiles[stepResults.indexOf(result)] ?? null)
        .filter((entry) => typeof entry === "string" && entry.length > 0),
      post_change_failed_step_result_refs: postChangeFailures
        .map((result) => stepResultFiles[stepResults.indexOf(result)] ?? null)
        .filter((entry) => typeof entry === "string" && entry.length > 0),
    },
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
    enforcement_summary: {
      required_failed_count: requiredFailures.length,
      warn_failed_count: warningFailures.length,
      observe_failed_count: observedFailures.length,
      required_failed_step_result_refs: requiredFailures
        .map((result) => stepResultFiles[stepResults.indexOf(result)] ?? null)
        .filter((entry) => typeof entry === "string" && entry.length > 0),
      warn_step_result_refs: warningFailures
        .map((result) => stepResultFiles[stepResults.indexOf(result)] ?? null)
        .filter((entry) => typeof entry === "string" && entry.length > 0),
      observe_step_result_refs: observedFailures
        .map((result) => stepResultFiles[stepResults.indexOf(result)] ?? null)
        .filter((entry) => typeof entry === "string" && entry.length > 0),
    },
    reusable_by: {
      bootstrap_rehearsal: true,
      quality_rehearsal: true,
      delivery_rehearsal: true,
      source_runbook: "docs/architecture/14-cli-command-catalog.md",
    },
    blocked_next_step:
      summaryStatus === "failed"
        ? brokenBaselineSteps.length > 0
          ? "Resolve failing baseline command groups before comparing post-change verification evidence."
          : postChangeFailures.length > 0
            ? "Inspect failed post-change step-result files, fix target changes or command prerequisites, then rerun verify."
            : "Inspect failed step-result files and fix missing prerequisites before rerunning verify."
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
