import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { loadContractFile, validateContractDocument } from "../../contracts/src/index.mjs";

import { initializeProjectRuntime } from "./project-init.mjs";
import {
  collectMissionChangeEvidence,
  isTransientBackupPath,
  matchesScopePattern,
} from "./shared/mission-scope.mjs";

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value)
    : {};
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function asString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function asStringArray(value) {
  return Array.isArray(value)
    ? value.filter((entry) => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim())
    : [];
}

/**
 * @param {string[]} values
 * @returns {string[]}
 */
function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))];
}

/**
 * @param {string} candidate
 * @returns {boolean}
 */
function isTestSourcePath(candidate) {
  const normalized = candidate.replace(/\\/g, "/");
  const fileName = path.posix.basename(normalized);
  const segments = normalized.split("/");
  const testDirectoryIndex = segments.findIndex((segment) => ["test", "tests", "spec"].includes(segment));
  const hasConventionalTestDirectory =
    testDirectoryIndex === 0 ||
    (testDirectoryIndex === 1 && segments[0] === "src") ||
    (testDirectoryIndex === 2 && ["apps", "packages", "libs", "services"].includes(segments[0])) ||
    (testDirectoryIndex === 3 &&
      ["apps", "packages", "libs", "services"].includes(segments[0]) &&
      segments[2] === "src");
  return (
    /\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)$/u.test(normalized) &&
    (/(?:^|\/)__tests__\//u.test(normalized) ||
      /\.(?:test|spec)\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)$/u.test(fileName) ||
      hasConventionalTestDirectory)
  );
}

/**
 * @param {string} command
 * @returns {boolean}
 */
function isBroadTestCommand(command) {
  const normalized = command.trim();
  if (/(?:^|\s)(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test(?:\s|$)/u.test(normalized)) {
    return true;
  }
  if (/(?:^|\s)(?:npm|pnpm|yarn|bun)\s+run\s+test:[^\s]+(?:\s|$)/u.test(normalized)) {
    return true;
  }
  if (/(?:^|\s)(?:python3?|uv\s+run\s+python)\s+-m\s+pytest(?:\s|$)/u.test(normalized)) {
    return true;
  }
  if (/(?:^|\s)(?:uv\s+run\s+)?pytest(?:\s|$)/u.test(normalized)) {
    return true;
  }
  if (/(?:^|\s)(?:npx\s+)?ava(?:\s|$)/u.test(normalized) && !/(?:^|\s)(?:test|tests|spec|__tests__)\/[^\s]+/u.test(normalized)) {
    return true;
  }
  return false;
}

/**
 * @param {string} value
 * @returns {string}
 */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * @param {string} projectRoot
 * @param {string} changedPath
 * @returns {{ packageName: string | null, packageDir: string | null }}
 */
function findNearestPackageContext(projectRoot, changedPath) {
  const normalizedProjectRoot = path.resolve(projectRoot);
  const absolutePath = path.resolve(normalizedProjectRoot, changedPath);
  let currentDir = fs.statSync(absolutePath, { throwIfNoEntry: false })?.isDirectory()
    ? absolutePath
    : path.dirname(absolutePath);
  while (currentDir.startsWith(normalizedProjectRoot)) {
    const packageJsonPath = path.join(currentDir, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = readJson(packageJsonPath);
      const packageName = asString(packageJson.name);
      const packageDir = path.relative(normalizedProjectRoot, currentDir).replace(/\\/g, "/");
      return {
        packageName,
        packageDir: packageDir === "" ? "." : packageDir,
      };
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }
  return { packageName: null, packageDir: null };
}

/**
 * @param {string} command
 * @param {{ packageName: string | null, packageDir: string | null }} packageContext
 * @returns {boolean}
 */
function testCommandCoversChangedPackage(command, packageContext) {
  const normalizedCommand = command.replace(/\\/g, "/");
  const packageName = packageContext.packageName;
  const packageDir = packageContext.packageDir;
  if (packageName) {
    const escapedPackageName = escapeRegExp(packageName);
    if (new RegExp(`(?:^|\\s)yarn\\s+workspace\\s+${escapedPackageName}(?:\\s|$)`, "u").test(normalizedCommand)) {
      return true;
    }
    if (new RegExp(`(?:^|\\s)(?:pnpm|npm)\\s+[^\\n]*--workspace(?:=|\\s+)${escapedPackageName}(?:\\s|$)`, "u").test(normalizedCommand)) {
      return true;
    }
    if (new RegExp(`(?:^|\\s)pnpm\\s+[^\\n]*(?:--filter|-F)(?:=|\\s+)${escapedPackageName}(?:\\s|$)`, "u").test(normalizedCommand)) {
      return true;
    }
  }
  if (packageDir && packageDir !== ".") {
    const escapedPackageDir = escapeRegExp(packageDir);
    if (new RegExp(`(?:^|\\s)(?:pnpm\\s+[^\\n]*(?:--filter|-F)|npm\\s+[^\\n]*--workspace)(?:=|\\s+)\\.?/?${escapedPackageDir}(?:\\s|$)`, "u").test(normalizedCommand)) {
      return true;
    }
  }
  return false;
}

/**
 * @param {string} command
 * @param {string} changedPath
 * @param {string} projectRoot
 * @returns {string | null}
 */
function describeTestCommandCoverage(command, changedPath, projectRoot) {
  if (isBroadTestCommand(command)) {
    return "broad-repo-test-command";
  }
  const normalizedCommand = command.replace(/\\/g, "/");
  const normalizedPath = changedPath.replace(/\\/g, "/");
  if (normalizedCommand.includes(normalizedPath) || normalizedCommand.includes(`./${normalizedPath}`)) {
    return "explicit-test-path";
  }
  if (normalizedCommand.includes(path.posix.basename(normalizedPath))) {
    return "explicit-test-file-name";
  }
  if (testCommandCoversChangedPackage(command, findNearestPackageContext(projectRoot, changedPath))) {
    return "workspace-or-package-scoped-test-command";
  }
  return null;
}

/**
 * @param {Record<string, unknown> | null} verifySummary
 * @param {string[]} changedPaths
 * @param {string} projectRoot
 * @returns {{ changedTestPaths: string[], coveredTestPaths: string[], uncoveredTestPaths: string[], testCommands: string[], coveringCommands: string[], coverageReason: string }}
 */
function findChangedTestVerificationGaps(verifySummary, changedPaths, projectRoot) {
  const changedTestPaths = changedPaths.filter((candidate) => isTestSourcePath(candidate));
  const testCommands = collectVerifySummaryTestCommands(verifySummary, projectRoot);
  if (changedTestPaths.length === 0) {
    return {
      changedTestPaths,
      coveredTestPaths: [],
      uncoveredTestPaths: [],
      testCommands,
      coveringCommands: [],
      coverageReason: "no-changed-test-paths",
    };
  }
  if (testCommands.length === 0) {
    return {
      changedTestPaths,
      coveredTestPaths: [],
      uncoveredTestPaths: changedTestPaths,
      testCommands,
      coveringCommands: [],
      coverageReason: "no-primary-test-commands-recorded",
    };
  }
  /** @type {string[]} */
  const coveredTestPaths = [];
  /** @type {string[]} */
  const uncoveredTestPaths = [];
  /** @type {string[]} */
  const coveringCommands = [];
  /** @type {string[]} */
  const coverageReasons = [];
  for (const changedPath of changedTestPaths) {
    const covering = testCommands
      .map((command) => ({
        command,
        reason: describeTestCommandCoverage(command, changedPath, projectRoot),
      }))
      .find((candidate) => candidate.reason !== null);
    if (covering) {
      coveredTestPaths.push(changedPath);
      coveringCommands.push(covering.command);
      coverageReasons.push(/** @type {string} */ (covering.reason));
    } else {
      uncoveredTestPaths.push(changedPath);
    }
  }
  return {
    changedTestPaths,
    coveredTestPaths,
    uncoveredTestPaths,
    testCommands,
    coveringCommands: uniqueStrings(coveringCommands),
    coverageReason:
      uncoveredTestPaths.length > 0
        ? "some-changed-test-paths-not-covered"
        : uniqueStrings(coverageReasons).join(",") || "covered",
  };
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeId(value) {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * @param {string} projectRoot
 * @param {string} filePath
 * @returns {string}
 */
function toEvidenceRef(projectRoot, filePath) {
  return `evidence://${path.relative(projectRoot, filePath).replace(/\\/g, "/")}`;
}

/**
 * @param {string} filePath
 * @returns {Record<string, unknown>}
 */
function readJson(filePath) {
  return /** @type {Record<string, unknown>} */ (JSON.parse(fs.readFileSync(filePath, "utf8")));
}

/**
 * @param {string} projectRoot
 * @param {string} ref
 * @returns {string | null}
 */
function resolveArtifactPath(projectRoot, ref) {
  if (path.isAbsolute(ref)) return ref;
  if (ref.startsWith("evidence://")) {
    const relativeRef = ref.slice("evidence://".length);
    return path.resolve(projectRoot, relativeRef);
  }
  return path.resolve(projectRoot, ref);
}

/**
 * @param {string} projectRoot
 * @param {string} ref
 * @returns {Record<string, unknown> | null}
 */
function readArtifactRef(projectRoot, ref) {
  const filePath = resolveArtifactPath(projectRoot, ref);
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    return readJson(filePath);
  } catch {
    return null;
  }
}

/**
 * @param {Record<string, unknown> | null} verifySummary
 * @param {string} projectRoot
 * @returns {string[]}
 */
function collectVerifySummaryTestCommands(verifySummary, projectRoot) {
  const summary = asRecord(verifySummary);
  const commandOverrides = asRecord(summary.command_overrides);
  const commands = [...asStringArray(commandOverrides.test_commands)];
  const groups = Array.isArray(summary.command_groups) ? summary.command_groups : [];
  for (const entry of groups) {
    const group = asRecord(entry);
    if (asString(group.role) !== "test") continue;
    commands.push(...asStringArray(group.commands));
    for (const ref of asStringArray(group.step_result_refs)) {
      const stepResult = readArtifactRef(projectRoot, ref);
      const command = asString(stepResult?.command);
      if (command) commands.push(command);
    }
  }
  if (commands.length > 0) return uniqueStrings(commands);

  for (const ref of asStringArray(summary.step_result_refs)) {
    const stepResult = readArtifactRef(projectRoot, ref);
    const commandKind = asString(stepResult?.command_kind);
    const commandGroupRole = asString(stepResult?.command_group_role);
    if (commandKind !== "test" && commandGroupRole !== "test") continue;
    const command = asString(stepResult?.command);
    if (command) commands.push(command);
  }
  return uniqueStrings(commands);
}

/**
 * @param {string} dirPath
 * @returns {string[]}
 */
function listJsonFiles(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }
  return fs
    .readdirSync(dirPath)
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => path.join(dirPath, entry))
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
}

/**
 * @param {string} projectRoot
 * @param {string} filePath
 * @param {import("../../contracts/src/index.d.ts").ContractFamily} family
 */
function loadContractDocument(projectRoot, filePath, family) {
  const loaded = loadContractFile({ filePath, family });
  if (!loaded.ok) {
    return null;
  }
  return {
    file: filePath,
    artifact_ref: toEvidenceRef(projectRoot, filePath),
    document: asRecord(loaded.document),
  };
}

/**
 * @param {string} projectRoot
 * @param {string} artifactsRoot
 */
function loadPacketArtifacts(projectRoot, artifactsRoot) {
  const files = listJsonFiles(artifactsRoot);
  return files
    .map((filePath) => {
      if (path.basename(filePath).startsWith("wave-ticket-")) {
        return loadContractDocument(projectRoot, filePath, "wave-ticket");
      }
      if (path.basename(filePath).includes(".handoff.")) {
        return loadContractDocument(projectRoot, filePath, "handoff-packet");
      }
      if (path.basename(filePath).includes(".artifact.")) {
        return loadContractDocument(projectRoot, filePath, "artifact-packet");
      }
      if (path.basename(filePath).startsWith("delivery-manifest-")) {
        return loadContractDocument(projectRoot, filePath, "delivery-manifest");
      }
      if (path.basename(filePath).startsWith("release-packet-")) {
        return loadContractDocument(projectRoot, filePath, "release-packet");
      }
      return null;
    })
    .filter(Boolean);
}

/**
 * @param {string} projectRoot
 * @param {string} reportsRoot
 */
function loadStepResults(projectRoot, reportsRoot) {
  return listJsonFiles(reportsRoot)
    .filter((filePath) => path.basename(filePath).startsWith("step-result-"))
    .map((filePath) => loadContractDocument(projectRoot, filePath, "step-result"))
    .filter(Boolean);
}

/**
 * @param {string} projectRoot
 * @param {string} reportsRoot
 */
function loadOptionalQualityArtifact(projectRoot, reportsRoot, fileName, family) {
  const filePath = path.join(reportsRoot, fileName);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return loadContractDocument(projectRoot, filePath, family);
}

/**
 * @param {string} projectRoot
 * @param {string[]} changedPaths
 * @returns {{ addedLines: number, deletedLines: number, touchedLines: number }}
 */
function summarizeDiffBudget(projectRoot, changedPaths) {
  if (changedPaths.length === 0) {
    return {
      addedLines: 0,
      deletedLines: 0,
      touchedLines: 0,
    };
  }

  const run = spawnSync("git", ["diff", "--numstat", "--", ...changedPaths], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  if (run.status !== 0) {
    return {
      addedLines: 0,
      deletedLines: 0,
      touchedLines: 0,
    };
  }

  let addedLines = 0;
  let deletedLines = 0;
  for (const line of (run.stdout ?? "").split(/\r?\n/u)) {
    if (!line.trim()) {
      continue;
    }
    const [added, deleted] = line.split(/\t/u);
    const addedValue = Number.parseInt(added, 10);
    const deletedValue = Number.parseInt(deleted, 10);
    if (Number.isFinite(addedValue)) {
      addedLines += addedValue;
    }
    if (Number.isFinite(deletedValue)) {
      deletedLines += deletedValue;
    }
  }

  return {
    addedLines,
    deletedLines,
    touchedLines: addedLines + deletedLines,
  };
}

/**
 * @param {string} line
 * @returns {number | null}
 */
function parseTapPlan(line) {
  const match = /\bt\.plan\((\d+)\)/u.exec(line);
  if (!match) return null;
  const value = Number.parseInt(match[1], 10);
  return Number.isFinite(value) ? value : null;
}

/**
 * @param {string} line
 * @returns {boolean}
 */
function isAssertionLine(line) {
  return /\bt\.(?:assert|deepEqual|false|is|like|not|notDeepEqual|notRegex|notThrows|regex|snapshot|throws|true)\s*\(/u.test(
    line,
  );
}

/**
 * @param {string} projectRoot
 * @param {string[]} changedPaths
 * @returns {Array<{ path: string, type: "plan-lowered" | "assertion-removed", summary: string }>}
 */
function detectTestWeakening(projectRoot, changedPaths) {
  const testPaths = changedPaths.filter((candidate) =>
    /(?:^|\/)(?:test|tests)\/.*\.(?:[cm]?[jt]s|tsx?)$/u.test(candidate),
  );
  if (testPaths.length === 0) return [];
  const run = spawnSync("git", ["diff", "--unified=0", "--", ...testPaths], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  if (run.status !== 0) return [];

  /** @type {Array<{ path: string, type: "plan-lowered" | "assertion-removed", summary: string }>} */
  const findings = [];
  let currentPath = "";
  /** @type {Map<string, { removedPlans: number[], addedPlans: number[], removedAssertions: string[], addedAssertions: string[] }>} */
  const perFile = new Map();
  const stateFor = (filePath) => {
    if (!perFile.has(filePath)) {
      perFile.set(filePath, {
        removedPlans: [],
        addedPlans: [],
        removedAssertions: [],
        addedAssertions: [],
      });
    }
    return /** @type {{ removedPlans: number[], addedPlans: number[], removedAssertions: string[], addedAssertions: string[] }} */ (
      perFile.get(filePath)
    );
  };

  for (const line of (run.stdout ?? "").split(/\r?\n/u)) {
    if (line.startsWith("+++ b/")) {
      currentPath = line.slice("+++ b/".length).trim();
      continue;
    }
    if (!currentPath || line.startsWith("---") || line.startsWith("+++") || line.startsWith("@@")) {
      continue;
    }
    const state = stateFor(currentPath);
    if (line.startsWith("-")) {
      const body = line.slice(1);
      const plan = parseTapPlan(body);
      if (plan !== null) state.removedPlans.push(plan);
      if (isAssertionLine(body)) state.removedAssertions.push(body.trim());
    } else if (line.startsWith("+")) {
      const body = line.slice(1);
      const plan = parseTapPlan(body);
      if (plan !== null) state.addedPlans.push(plan);
      if (isAssertionLine(body)) state.addedAssertions.push(body.trim());
    }
  }

  for (const [filePath, state] of perFile) {
    if (
      state.removedPlans.length > 0 &&
      state.addedPlans.length > 0 &&
      Math.max(...state.removedPlans) > Math.min(...state.addedPlans)
    ) {
      findings.push({
        path: filePath,
        type: "plan-lowered",
        summary: `Test plan count was lowered in '${filePath}', which may weaken regression coverage.`,
      });
    }
    const addedAssertionSet = new Set(state.addedAssertions.map((line) => line.replace(/\s+/gu, " ")));
    const removedWithoutReplacement = state.removedAssertions.filter(
      (line) => !addedAssertionSet.has(line.replace(/\s+/gu, " ")),
    );
    if (removedWithoutReplacement.length > 0 && state.addedAssertions.length < state.removedAssertions.length) {
      findings.push({
        path: filePath,
        type: "assertion-removed",
        summary: `Test assertions were removed from '${filePath}' without equivalent replacement.`,
      });
    }
  }

  return findings;
}

/**
 * @param {{
 *   findings: Array<Record<string, unknown>>,
 *   severity: "warn" | "fail",
 *   category: string,
 *   summary: string,
 *   evidenceRefs?: string[],
 * }} options
 */
function pushFinding(options) {
  options.findings.push({
    finding_id: `${options.category}.${String(options.findings.length + 1).padStart(2, "0")}`,
    severity: options.severity,
    category: options.category,
    summary: options.summary,
    evidence_refs: uniqueStrings(options.evidenceRefs ?? []),
  });
}

/**
 * @param {Array<Record<string, unknown>>} findings
 * @returns {"pass" | "warn" | "fail"}
 */
function summarizeFindings(findings) {
  if (findings.some((finding) => finding.severity === "fail")) {
    return "fail";
  }
  if (findings.length > 0) {
    return "warn";
  }
  return "pass";
}

/**
 * @param {Record<string, unknown>} handoffPacket
 * @returns {boolean}
 */
function isApprovedHandoffPacket(handoffPacket) {
  const approvalState = asRecord(handoffPacket.approval_state);
  return asString(handoffPacket.status) === "approved" || asString(approvalState.state) === "approved";
}

/**
 * @param {Record<string, unknown> | null | undefined} handoffPacket
 * @returns {string[]}
 */
function resolveApprovedHandoffAllowedPaths(handoffPacket) {
  if (!handoffPacket || !isApprovedHandoffPacket(handoffPacket)) {
    return [];
  }
  const allowedPaths = asStringArray(handoffPacket.allowed_paths);
  if (allowedPaths.some((entry) => entry === "**" || entry === "**/*")) {
    return [];
  }
  return allowedPaths;
}

/**
 * @param {string} changedPath
 * @param {string[]} allowedPaths
 * @returns {boolean}
 */
function isChangedPathInsideApprovedScope(changedPath, allowedPaths) {
  return allowedPaths.length === 0 || allowedPaths.some((pattern) => matchesScopePattern(pattern, changedPath));
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef?: string,
 *   projectProfile?: string,
 *   runtimeRoot?: string,
 *   runId: string,
 *   executionRoot?: string | null,
 * }} options
 */
export function materializeReviewReport(options) {
  const init = initializeProjectRuntime(options);
  const evidenceRoot = asString(options.executionRoot)
    ? path.resolve(init.projectRoot, /** @type {string} */ (options.executionRoot))
    : init.projectRoot;
  const packetArtifacts = loadPacketArtifacts(init.projectRoot, init.runtimeLayout.artifactsRoot);
  const stepResults = loadStepResults(init.projectRoot, init.runtimeLayout.reportsRoot);
  const analysisReport = loadOptionalQualityArtifact(
    init.projectRoot,
    init.runtimeLayout.reportsRoot,
    "project-analysis-report.json",
    "project-analysis-report",
  );
  const preferredVerifySummaryPath = path.join(init.runtimeLayout.reportsRoot, "verify-summary-post-run-primary.json");
  const verifySummaryPath = fs.existsSync(preferredVerifySummaryPath)
    ? preferredVerifySummaryPath
    : path.join(init.runtimeLayout.reportsRoot, "verify-summary.json");
  const verifySummary = fs.existsSync(verifySummaryPath) ? readJson(verifySummaryPath) : null;

  const intakePacket =
    packetArtifacts.find((artifact) => artifact.document.packet_type === "intake-request") ?? null;
  const intakePacketBody =
    intakePacket && typeof intakePacket.document.body_ref === "string" && fs.existsSync(intakePacket.document.body_ref)
      ? readJson(intakePacket.document.body_ref)
      : {};
  const missionTraceability = asRecord(intakePacketBody.mission_traceability);
  const featureRequest = asRecord(intakePacketBody.feature_request);
  const requestDocument = asRecord(featureRequest.request_document);
  const missionId = asString(missionTraceability.mission_id);
  const scenarioFamily =
    asString(missionTraceability.scenario_family) ?? asString(requestDocument.scenario_family);
  const providerVariantId =
    asString(missionTraceability.provider_variant_id) ?? asString(requestDocument.provider_variant_id);
  const featureSize = asString(missionTraceability.feature_size) ?? asString(requestDocument.feature_size);
  const matrixCell =
    asRecord(missionTraceability.matrix_cell).cell_id || Object.keys(asRecord(missionTraceability.matrix_cell)).length > 0
      ? asRecord(missionTraceability.matrix_cell)
      : asRecord(requestDocument.matrix_cell);
  const coverageFollowUp =
    asRecord(missionTraceability.coverage_follow_up).current_cell_required !== undefined ||
    Object.keys(asRecord(missionTraceability.coverage_follow_up)).length > 0
      ? asRecord(missionTraceability.coverage_follow_up)
      : asRecord(requestDocument.coverage_follow_up);

  const latestSpecStep =
    stepResults.find((artifact) => asString(artifact.document.step_id)?.includes("spec") === true) ?? null;
  const latestHandoffPacket =
    packetArtifacts.find((artifact) => Object.prototype.hasOwnProperty.call(artifact.document, "approval_state")) ?? null;
  const executionStepResults = stepResults.filter((artifact) => asString(artifact.document.run_id) === options.runId);
  const implementStep =
    executionStepResults.find((artifact) => asString(asRecord(artifact.document.routed_execution).mode) !== null) ?? null;
  const deliveryManifest =
    packetArtifacts.find(
      (artifact) => artifact.document.run_id === options.runId && path.basename(artifact.file).startsWith("delivery-manifest-"),
    ) ?? null;
  const releasePacket =
    packetArtifacts.find(
      (artifact) => artifact.document.run_id === options.runId && path.basename(artifact.file).startsWith("release-packet-"),
    ) ?? null;

  /** @type {Array<Record<string, unknown>>} */
  const featureTraceabilityFindings = [];
  if (!intakePacket) {
    pushFinding({
      findings: featureTraceabilityFindings,
      severity: "fail",
      category: "feature-traceability",
      summary: "No intake-request artifact-packet is present for review traceability.",
    });
  }
  if (!missionId) {
    pushFinding({
      findings: featureTraceabilityFindings,
      severity: "warn",
      category: "feature-traceability",
      summary: "Mission id is missing from the intake packet body.",
      evidenceRefs: intakePacket ? [intakePacket.artifact_ref] : [],
    });
  }
  const analysisFeatureTraceability = asRecord(asRecord(analysisReport?.document).feature_traceability);
  if (!analysisReport) {
    pushFinding({
      findings: featureTraceabilityFindings,
      severity: "fail",
      category: "feature-traceability",
      summary: "Project analysis report is missing for review traceability.",
    });
  } else if (missionId && asString(analysisFeatureTraceability.mission_id) !== missionId) {
    pushFinding({
      findings: featureTraceabilityFindings,
      severity: "fail",
      category: "feature-traceability",
      summary: "Discovery analysis does not preserve the selected mission id.",
      evidenceRefs: [analysisReport.artifact_ref],
    });
  }
  if (scenarioFamily && asString(analysisFeatureTraceability.scenario_family) !== scenarioFamily) {
    pushFinding({
      findings: featureTraceabilityFindings,
      severity: "fail",
      category: "feature-traceability",
      summary: "Discovery analysis does not preserve the selected scenario family.",
      evidenceRefs: analysisReport ? [analysisReport.artifact_ref] : [],
    });
  }
  if (providerVariantId && asString(analysisFeatureTraceability.provider_variant_id) !== providerVariantId) {
    pushFinding({
      findings: featureTraceabilityFindings,
      severity: "fail",
      category: "feature-traceability",
      summary: "Discovery analysis does not preserve the selected provider variant.",
      evidenceRefs: analysisReport ? [analysisReport.artifact_ref] : [],
    });
  }
  if (featureSize && asString(analysisFeatureTraceability.feature_size) !== featureSize) {
    pushFinding({
      findings: featureTraceabilityFindings,
      severity: "fail",
      category: "feature-traceability",
      summary: "Discovery analysis does not preserve the selected feature size.",
      evidenceRefs: analysisReport ? [analysisReport.artifact_ref] : [],
    });
  }

  /** @type {Array<Record<string, unknown>>} */
  const discoveryFindings = [];
  if (!latestSpecStep) {
    pushFinding({
      findings: discoveryFindings,
      severity: "fail",
      category: "discovery-quality",
      summary: "No spec step-result is available to prove discovery-to-spec closure.",
    });
  } else {
    const specFeatureTraceability = asRecord(asRecord(latestSpecStep.document.routed_execution).feature_traceability);
    if (missionId && asString(specFeatureTraceability.mission_id) !== missionId) {
      pushFinding({
        findings: discoveryFindings,
        severity: "fail",
        category: "discovery-quality",
        summary: "Spec step-result is not traceable to the selected feature mission.",
        evidenceRefs: [latestSpecStep.artifact_ref],
      });
    }
    if (scenarioFamily && asString(specFeatureTraceability.scenario_family) !== scenarioFamily) {
      pushFinding({
        findings: discoveryFindings,
        severity: "fail",
        category: "discovery-quality",
        summary: "Spec step-result is not traceable to the selected scenario family.",
        evidenceRefs: [latestSpecStep.artifact_ref],
      });
    }
    if (providerVariantId && asString(specFeatureTraceability.provider_variant_id) !== providerVariantId) {
      pushFinding({
        findings: discoveryFindings,
        severity: "fail",
        category: "discovery-quality",
        summary: "Spec step-result is not traceable to the selected provider variant.",
        evidenceRefs: [latestSpecStep.artifact_ref],
      });
    }
  }
  if (!latestHandoffPacket) {
    pushFinding({
      findings: discoveryFindings,
      severity: "fail",
      category: "discovery-quality",
      summary: "No handoff packet is available for review.",
    });
  } else {
    const handoffFeatureTraceability = asRecord(latestHandoffPacket.document.feature_traceability);
    if (missionId && asString(handoffFeatureTraceability.mission_id) !== missionId) {
      pushFinding({
        findings: discoveryFindings,
        severity: "warn",
        category: "discovery-quality",
        summary: "Handoff packet does not explicitly preserve the selected mission id.",
        evidenceRefs: [latestHandoffPacket.artifact_ref],
      });
    }
  }

  /** @type {Array<Record<string, unknown>>} */
  const artifactFindings = [];
  if (!verifySummary || verifySummary.status !== "passed") {
    pushFinding({
      findings: artifactFindings,
      severity: "fail",
      category: "artifact-quality",
      summary: "Verify-summary is missing or did not pass, so build/lint/test linkage is incomplete.",
      evidenceRefs: fs.existsSync(verifySummaryPath) ? [toEvidenceRef(init.projectRoot, verifySummaryPath)] : [],
    });
  }
  if (executionStepResults.length === 0) {
    pushFinding({
      findings: artifactFindings,
      severity: "fail",
      category: "artifact-quality",
      summary: `No execution step-result is linked to run '${options.runId}'.`,
    });
  }
  if (implementStep) {
    const routedExecution = asRecord(implementStep.document.routed_execution);
    const contextCompilation = asRecord(routedExecution.context_compilation);
    if (!asString(contextCompilation.compiled_context_ref)) {
      pushFinding({
        findings: artifactFindings,
        severity: "warn",
        category: "artifact-quality",
        summary: "Execution step-result is missing compiled-context linkage.",
        evidenceRefs: [implementStep.artifact_ref],
      });
    }
  }
  if (deliveryManifest) {
    const repoDeliveries = Array.isArray(deliveryManifest.document.repo_deliveries) ? deliveryManifest.document.repo_deliveries : [];
    const firstRepoDelivery = asRecord(repoDeliveries[0]);
    const deliveryRepoRoot = asString(firstRepoDelivery.repo_root);
    if (deliveryRepoRoot && path.resolve(deliveryRepoRoot) !== path.resolve(evidenceRoot)) {
      pushFinding({
        findings: artifactFindings,
        severity: "fail",
        category: "artifact-quality",
        summary: "Delivery manifest repo root is not anchored to the target checkout.",
        evidenceRefs: [deliveryManifest.artifact_ref],
      });
    }
  }
  if (releasePacket && !asString(releasePacket.document.delivery_manifest_ref)) {
    pushFinding({
      findings: artifactFindings,
      severity: "fail",
      category: "artifact-quality",
      summary: "Release packet is missing delivery-manifest lineage.",
      evidenceRefs: [releasePacket.artifact_ref],
    });
  }

  /** @type {Array<Record<string, unknown>>} */
  const codeFindings = [];
  const changeEvidence = collectMissionChangeEvidence({
    projectRoot: init.projectRoot,
    artifactsRoot: init.runtimeLayout.artifactsRoot,
    evidenceRoot,
  });
  const ignoredInputFiles = new Set(changeEvidence.ignoredInputFiles);
  const transientChangedPaths = changeEvidence.nonBootstrapChangedPaths.filter(
    (changedPath) => !ignoredInputFiles.has(changedPath) && isTransientBackupPath(changedPath),
  );
  const rawChangedPaths = changeEvidence.changedPaths;
  const codeChangedPaths = changeEvidence.meaningfulChangedPaths;
  const changedTestVerification = findChangedTestVerificationGaps(verifySummary, codeChangedPaths, evidenceRoot);
  const approvedHandoffAllowedPaths = resolveApprovedHandoffAllowedPaths(latestHandoffPacket?.document);
  if (!changeEvidence.gitStatusAvailable) {
    pushFinding({
      findings: codeFindings,
      severity: "fail",
      category: "code-quality",
      summary: `Git status was unavailable for review evidence root '${changeEvidence.gitStatusRoot}'.`,
      evidenceRefs: implementStep ? [implementStep.artifact_ref] : [],
    });
  }
  if (changedTestVerification.uncoveredTestPaths.length > 0) {
    const commandSummary =
      changedTestVerification.testCommands.length > 0
        ? changedTestVerification.testCommands.join("; ")
        : "no primary test command was recorded";
    pushFinding({
      findings: artifactFindings,
      severity: "warn",
      category: "artifact-quality",
      summary: `Primary verification did not explicitly exercise changed test file(s): ${changedTestVerification.uncoveredTestPaths.join(", ")}. Recorded primary test command(s): ${commandSummary}.`,
      evidenceRefs: fs.existsSync(verifySummaryPath) ? [toEvidenceRef(init.projectRoot, verifySummaryPath)] : [],
    });
  }
  if (approvedHandoffAllowedPaths.length > 0) {
    const outOfScopeChangedPaths = codeChangedPaths.filter(
      (changedPath) => !isChangedPathInsideApprovedScope(changedPath, approvedHandoffAllowedPaths),
    );
    if (outOfScopeChangedPaths.length > 0) {
      pushFinding({
        findings: codeFindings,
        severity: "fail",
        category: "code-quality",
        summary: `Changed path(s) outside approved handoff scope: ${outOfScopeChangedPaths.join(", ")}. Approved scope: ${approvedHandoffAllowedPaths.join(", ")}.`,
        evidenceRefs: latestHandoffPacket ? [latestHandoffPacket.artifact_ref] : [],
      });
    }
  }
  if (codeChangedPaths.length === 0) {
    pushFinding({
      findings: codeFindings,
      severity: "fail",
      category: "code-quality",
      summary: "No non-bootstrap changed paths were detected for the strict code-changing reviewed run.",
      evidenceRefs: implementStep ? [implementStep.artifact_ref] : [],
    });
  }
  for (const changedPath of transientChangedPaths) {
    pushFinding({
      findings: codeFindings,
      severity: "warn",
      category: "code-quality",
      summary: `Changed path '${changedPath}' appears to be a backup or transient editor artifact.`,
    });
  }
  for (const changedPath of codeChangedPaths) {
    if (
      changedPath.startsWith("docs/backlog/") ||
      changedPath.startsWith(".agents/")
    ) {
      pushFinding({
        findings: codeFindings,
        severity: "fail",
        category: "code-quality",
        summary: `Changed path '${changedPath}' leaks into control-plane-only content.`,
      });
    }
  }
  for (const weakening of detectTestWeakening(evidenceRoot, codeChangedPaths)) {
    pushFinding({
      findings: codeFindings,
      severity: "warn",
      category: "code-quality",
      summary: weakening.summary,
      evidenceRefs: [toEvidenceRef(init.projectRoot, path.join(evidenceRoot, weakening.path))],
    });
  }

  /** @type {Array<Record<string, unknown>>} */
  const featureSizeFindings = [];
  const declaredSizeBudget =
    Object.keys(asRecord(requestDocument.size_budget)).length > 0
      ? asRecord(requestDocument.size_budget)
      : asRecord(requestDocument.change_budget);
  const diffBudget = summarizeDiffBudget(evidenceRoot, codeChangedPaths);
  const maxChangedFiles =
    typeof declaredSizeBudget.max_changed_files === "number" ? declaredSizeBudget.max_changed_files : null;
  const maxAddedLines =
    typeof declaredSizeBudget.max_added_lines === "number" ? declaredSizeBudget.max_added_lines : null;
  const maxTouchedLines =
    typeof declaredSizeBudget.max_touched_lines === "number" ? declaredSizeBudget.max_touched_lines : null;
  if (featureSize && !["small", "medium", "large", "xlarge"].includes(featureSize)) {
    pushFinding({
      findings: featureSizeFindings,
      severity: "warn",
      category: "feature-size-fit",
      summary: `Declared feature size '${featureSize}' is outside the shared small/medium/large/xlarge taxonomy.`,
      evidenceRefs: intakePacket ? [intakePacket.artifact_ref] : [],
    });
  }
  if (maxChangedFiles !== null && codeChangedPaths.length > maxChangedFiles) {
    pushFinding({
      findings: featureSizeFindings,
      severity: "fail",
      category: "feature-size-fit",
      summary: `Changed ${codeChangedPaths.length} files, which exceeds the declared size budget of ${maxChangedFiles}.`,
      evidenceRefs: implementStep ? [implementStep.artifact_ref] : [],
    });
  }
  if (maxAddedLines !== null && diffBudget.addedLines > maxAddedLines) {
    pushFinding({
      findings: featureSizeFindings,
      severity: "fail",
      category: "feature-size-fit",
      summary: `Added ${diffBudget.addedLines} lines, which exceeds the declared size budget of ${maxAddedLines}.`,
      evidenceRefs: implementStep ? [implementStep.artifact_ref] : [],
    });
  }
  if (maxTouchedLines !== null && diffBudget.touchedLines > maxTouchedLines) {
    pushFinding({
      findings: featureSizeFindings,
      severity: "fail",
      category: "feature-size-fit",
      summary: `Touched ${diffBudget.touchedLines} lines, which exceeds the declared size budget of ${maxTouchedLines}.`,
      evidenceRefs: implementStep ? [implementStep.artifact_ref] : [],
    });
  }

  /** @type {Array<Record<string, unknown>>} */
  const providerTraceabilityFindings = [];
  const implementRoutedExecution = implementStep ? asRecord(implementStep.document.routed_execution) : {};
  const implementRouteResolution = asRecord(implementRoutedExecution.route_resolution);
  const implementRouteProfile = asRecord(implementRouteResolution.route_profile);
  const implementPrimary = asRecord(implementRouteProfile.primary);
  const adapterResolution = asRecord(implementRoutedExecution.adapter_resolution);
  const adapter = asRecord(adapterResolution.adapter);
  const actualProvider = asString(implementPrimary.provider);
  const actualAdapterId = asString(adapter.adapter_id);
  if (!implementStep) {
    pushFinding({
      findings: providerTraceabilityFindings,
      severity: "fail",
      category: "provider-traceability",
      summary: "No execution step-result is available to prove provider traceability.",
    });
  } else {
    if (!actualProvider) {
      pushFinding({
        findings: providerTraceabilityFindings,
        severity: "fail",
        category: "provider-traceability",
        summary: "Execution step-result does not record the actual provider path.",
        evidenceRefs: [implementStep.artifact_ref],
      });
    }
    if (!actualAdapterId) {
      pushFinding({
        findings: providerTraceabilityFindings,
        severity: "fail",
        category: "provider-traceability",
        summary: "Execution step-result does not record the actual adapter path.",
        evidenceRefs: [implementStep.artifact_ref],
      });
    }
    const requestedProvider = asString(asRecord(requestDocument.provider_variant).provider);
    const requestedAdapter = asString(asRecord(requestDocument.provider_variant).primary_adapter);
    if (requestedProvider && actualProvider && requestedProvider !== actualProvider) {
      pushFinding({
        findings: providerTraceabilityFindings,
        severity: "fail",
        category: "provider-traceability",
        summary: `Execution used provider '${actualProvider}' instead of requested '${requestedProvider}'.`,
        evidenceRefs: [implementStep.artifact_ref],
      });
    }
    if (requestedAdapter && actualAdapterId && requestedAdapter !== actualAdapterId) {
      pushFinding({
        findings: providerTraceabilityFindings,
        severity: "fail",
        category: "provider-traceability",
        summary: `Execution used adapter '${actualAdapterId}' instead of requested '${requestedAdapter}'.`,
        evidenceRefs: [implementStep.artifact_ref],
      });
    }
  }

  const allFindings = [
    ...featureTraceabilityFindings,
    ...discoveryFindings,
    ...artifactFindings,
    ...codeFindings,
    ...featureSizeFindings,
    ...providerTraceabilityFindings,
  ];
  const overallStatus = summarizeFindings(allFindings);
  const reviewRecommendation =
    overallStatus === "fail" ? "repair" : overallStatus === "warn" ? "required-human-review" : "proceed";
  const evidenceRefs = uniqueStrings([
    ...(intakePacket ? [intakePacket.artifact_ref] : []),
    ...(analysisReport ? [analysisReport.artifact_ref] : []),
    ...(latestSpecStep ? [latestSpecStep.artifact_ref] : []),
    ...(latestHandoffPacket ? [latestHandoffPacket.artifact_ref] : []),
    ...executionStepResults.map((artifact) => artifact.artifact_ref),
    ...(deliveryManifest ? [deliveryManifest.artifact_ref] : []),
    ...(releasePacket ? [releasePacket.artifact_ref] : []),
    ...(fs.existsSync(verifySummaryPath) ? [toEvidenceRef(init.projectRoot, verifySummaryPath)] : []),
  ]);
  const reviewReport = {
    review_report_id: `${options.runId}.review-report.v1`,
    project_id: init.projectId,
    run_id: options.runId,
    generated_at: new Date().toISOString(),
    overall_status: overallStatus,
    review_recommendation: reviewRecommendation,
    feature_traceability: {
      status: summarizeFindings(featureTraceabilityFindings),
      mission_id: missionId,
      input_packet_ref: intakePacket?.artifact_ref ?? null,
      request_title: asString(featureRequest.title),
      request_brief: asString(featureRequest.brief),
      scenario_family: scenarioFamily,
      provider_variant_id: providerVariantId,
      feature_size: featureSize,
      matrix_cell: Object.keys(matrixCell).length > 0 ? matrixCell : {},
      coverage_follow_up: Object.keys(coverageFollowUp).length > 0 ? coverageFollowUp : {},
    },
    discovery_quality: {
      status: summarizeFindings(discoveryFindings),
      analysis_report_ref: analysisReport?.artifact_ref ?? null,
      spec_step_result_ref: latestSpecStep?.artifact_ref ?? null,
      handoff_packet_ref: latestHandoffPacket?.artifact_ref ?? null,
      findings: discoveryFindings,
    },
    artifact_quality: {
      status: summarizeFindings(artifactFindings),
      verify_summary_ref: fs.existsSync(verifySummaryPath) ? toEvidenceRef(init.projectRoot, verifySummaryPath) : null,
      execution_step_result_refs: executionStepResults.map((artifact) => artifact.artifact_ref),
      delivery_manifest_ref: deliveryManifest?.artifact_ref ?? null,
      release_packet_ref: releasePacket?.artifact_ref ?? null,
      verification_coverage: {
        changed_test_paths: changedTestVerification.changedTestPaths,
        covered_test_paths: changedTestVerification.coveredTestPaths,
        uncovered_test_paths: changedTestVerification.uncoveredTestPaths,
        covering_commands: changedTestVerification.coveringCommands,
        recorded_test_commands: changedTestVerification.testCommands,
        coverage_reason: changedTestVerification.coverageReason,
      },
      findings: artifactFindings,
    },
    code_quality: {
      status: summarizeFindings(codeFindings),
      changed_paths: codeChangedPaths,
      target_checkout_root: evidenceRoot,
      git_status_available: changeEvidence.gitStatusAvailable,
      changed_path_diagnostics: {
        git_status_root: changeEvidence.gitStatusRoot,
        raw_changed_paths: rawChangedPaths,
        non_bootstrap_changed_paths: changeEvidence.nonBootstrapChangedPaths,
        non_input_changed_paths: changeEvidence.nonInputChangedPaths,
        meaningful_changed_paths: changeEvidence.meaningfulChangedPaths,
        runner_owned_state_paths: changeEvidence.runnerOwnedStatePaths,
        ignored_input_files: changeEvidence.ignoredInputFiles,
      },
      findings: codeFindings,
    },
    feature_size_fit: {
      status: summarizeFindings(featureSizeFindings),
      feature_size: featureSize,
      size_budget: declaredSizeBudget,
      actual_change: {
        changed_files: codeChangedPaths.length,
        added_lines: diffBudget.addedLines,
        deleted_lines: diffBudget.deletedLines,
        touched_lines: diffBudget.touchedLines,
      },
      findings: featureSizeFindings,
    },
    provider_traceability: {
      status: summarizeFindings(providerTraceabilityFindings),
      provider_variant_id: providerVariantId,
      requested_provider: asString(asRecord(requestDocument.provider_variant).provider),
      requested_adapter: asString(asRecord(requestDocument.provider_variant).primary_adapter),
      actual_provider: actualProvider,
      actual_adapter: actualAdapterId,
      route_id: asString(implementRouteResolution.resolved_route_id),
      route_profile_source: asString(implementRouteResolution.route_profile_source),
      findings: providerTraceabilityFindings,
    },
    findings: allFindings,
    evidence_refs: evidenceRefs,
  };

  const validation = validateContractDocument({
    family: "review-report",
    document: reviewReport,
    source: "runtime://review-report",
  });
  if (!validation.ok) {
    const issues = validation.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Generated review-report failed contract validation: ${issues}`);
  }

  const reviewReportFile = path.join(init.runtimeLayout.reportsRoot, `review-report-${normalizeId(options.runId)}.json`);
  fs.writeFileSync(reviewReportFile, `${JSON.stringify(reviewReport, null, 2)}\n`, "utf8");

  return {
    ...init,
    reviewReport,
    reviewReportFile,
  };
}
