import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import {
  createAdapterRequestEnvelope,
  createAdapterResponseEnvelope,
  createLiveAdapter,
  createMockAdapter,
  resolveAdapterForRoute,
} from "../../adapter-sdk/src/index.mjs";
import { validateContractDocument } from "../../contracts/src/index.mjs";
import { resolveRouteForStep } from "../../provider-routing/src/route-resolution.mjs";

import { resolveAssetBundleForStep } from "./asset-loader.mjs";
import { compileStepContext } from "./context-compiler.mjs";
import { materializeDeliveryPlan } from "./delivery-plan.mjs";
import { initializeProjectRuntime } from "./project-init.mjs";
import { analyzeProjectRuntime } from "./project-analysis.mjs";
import {
  classifyRuntimeStepOutcome,
  materializeRuntimeHarnessReport,
  resolveRuntimeMissionProfile,
  synthesizeRepairAttempts,
} from "./runtime-harness-report.mjs";
import { resolveStepPolicyForStep } from "./policy-resolution.mjs";

const STEP_CLASS_TO_RESULT_CLASS = Object.freeze({
  discovery: "artifact",
  research: "artifact",
  spec: "artifact",
  planning: "planner",
  implement: "runner",
  review: "runner",
  qa: "runner",
  repair: "repair",
  eval: "eval",
  harness: "harness",
});
const STEP_ARCHITECTURE_DOC_REFS = Object.freeze([
  "docs/architecture/04-system-of-record-and-core-entities.md",
  "docs/architecture/12-orchestrator-operating-model.md",
  "docs/architecture/14-cli-command-catalog.md",
]);
const STEP_ARCHITECTURE_CONTRACT_REFS = Object.freeze([
  "docs/contracts/project-analysis-report.md",
  "docs/contracts/step-result.md",
  "docs/contracts/wave-ticket.md",
  "docs/contracts/handoff-packet.md",
]);
const BOOTSTRAP_OWNED_PREFIXES = ["examples/", "context/", ".aor/"];
const BOOTSTRAP_OWNED_FILES = new Set(["project.aor.yaml"]);

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
 * @param {unknown} value
 * @returns {string | null}
 */
function asString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * @param {string} value
 * @returns {string}
 */
function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeRefSuffix(value) {
  return value.replace(/[^a-zA-Z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "");
}

const STEP_RESULT_FILE_REGEX = /^step-result-.*\.json$/u;

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function asRecord(value) {
  return typeof value === "object" && value !== null ? /** @type {Record<string, unknown>} */ (value) : {};
}

/**
 * @param {unknown} value
 * @returns {Array<Record<string, unknown>>}
 */
function asRecordArray(value) {
  return Array.isArray(value)
    ? value.filter((entry) => typeof entry === "object" && entry !== null && !Array.isArray(entry))
    : [];
}

/**
 * @param {string} filePath
 * @returns {Record<string, unknown> | null}
 */
function readJsonFile(filePath) {
  try {
    return /** @type {Record<string, unknown>} */ (JSON.parse(fs.readFileSync(filePath, "utf8")));
  } catch {
    return null;
  }
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function uniqueStrings(value) {
  return [...new Set(asStringArray(value))];
}

/**
 * @param {unknown} startedAt
 * @param {unknown} finishedAt
 * @returns {number | null}
 */
function resolveDurationSeconds(startedAt, finishedAt) {
  if (typeof startedAt !== "string" || typeof finishedAt !== "string") {
    return null;
  }
  const startedMs = Date.parse(startedAt);
  const finishedMs = Date.parse(finishedAt);
  if (!Number.isFinite(startedMs) || !Number.isFinite(finishedMs) || finishedMs < startedMs) {
    return null;
  }
  return Math.round(((finishedMs - startedMs) / 1000) * 1000) / 1000;
}

/**
 * @param {string} root
 * @returns {{ available: boolean, changedPaths: string[] }}
 */
function listChangedPaths(root) {
  if (!fs.existsSync(root)) {
    return { available: false, changedPaths: [] };
  }
  const run = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], {
    cwd: root,
    encoding: "utf8",
  });
  if (run.status !== 0) {
    return { available: false, changedPaths: [] };
  }
  const changedPaths = (run.stdout ?? "")
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0)
    .map((line) => line.slice(3).trim())
    .map((candidate) => {
      const renameParts = candidate.split(" -> ");
      return renameParts.length > 1 ? renameParts[renameParts.length - 1] : candidate;
    })
    .map((candidate) => candidate.replace(/\\/g, "/"));
  return { available: true, changedPaths };
}

/**
 * @param {string[]} changedPaths
 * @returns {string[]}
 */
function filterNonBootstrapChangedPaths(changedPaths) {
  return changedPaths.filter((candidate) => {
    if (BOOTSTRAP_OWNED_FILES.has(candidate)) return false;
    return !BOOTSTRAP_OWNED_PREFIXES.some((prefix) => candidate === prefix.slice(0, -1) || candidate.startsWith(prefix));
  });
}

/**
 * @param {string} pattern
 * @param {string} candidate
 * @returns {boolean}
 */
function matchesScopePattern(pattern, candidate) {
  const normalizedPattern = pattern.replace(/\\/g, "/");
  const normalizedCandidate = candidate.replace(/\\/g, "/");
  if (normalizedPattern === "**" || normalizedPattern === "**/*") return true;
  if (normalizedPattern.endsWith("/**")) {
    const prefix = normalizedPattern.slice(0, -3);
    return normalizedCandidate === prefix || normalizedCandidate.startsWith(`${prefix}/`);
  }
  if (normalizedPattern.endsWith("/*")) {
    const prefix = normalizedPattern.slice(0, -1);
    return normalizedCandidate.startsWith(prefix) && !normalizedCandidate.slice(prefix.length).includes("/");
  }
  if (!normalizedPattern.includes("*")) {
    return normalizedCandidate === normalizedPattern;
  }
  const wildcardPrefix = normalizedPattern.slice(0, normalizedPattern.indexOf("*"));
  return normalizedCandidate.startsWith(wildcardPrefix);
}

/**
 * @param {string} projectRoot
 * @param {string | null} filePath
 * @returns {string | null}
 */
function resolveProjectRelativeFile(projectRoot, filePath) {
  if (!filePath) return null;
  const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(projectRoot, filePath);
  const relative = path.relative(projectRoot, resolved).replace(/\\/g, "/");
  return relative.startsWith("../") || relative === "" ? null : relative;
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
 * @param {string} artifactsRoot
 * @returns {{ ignoredInputFiles: string[], allowedPaths: string[], forbiddenPaths: string[] }}
 */
function loadMissionScope(projectRoot, artifactsRoot) {
  const packetFiles = listJsonFiles(artifactsRoot).filter((filePath) => path.basename(filePath).includes(".artifact."));
  for (const packetFile of packetFiles) {
    const packet = readJsonFile(packetFile);
    if (asString(packet?.packet_type) !== "intake-request") continue;
    const bodyRef = asString(packet?.body_ref);
    if (!bodyRef || !fs.existsSync(bodyRef)) continue;
    const body = readJsonFile(bodyRef);
    const featureRequest = asRecord(body?.feature_request);
    const requestDocument = asRecord(featureRequest.request_document);
    const requestFile = resolveProjectRelativeFile(projectRoot, asString(featureRequest.request_file));
    return {
      ignoredInputFiles: requestFile ? [requestFile] : [],
      allowedPaths: asStringArray(requestDocument.allowed_paths),
      forbiddenPaths: asStringArray(requestDocument.forbidden_paths),
    };
  }
  return { ignoredInputFiles: [], allowedPaths: [], forbiddenPaths: [] };
}

/**
 * @param {string[]} changedPaths
 * @param {{ ignoredInputFiles: string[], allowedPaths: string[], forbiddenPaths: string[] }} missionScope
 */
function resolveMissionScopedChanges(changedPaths, missionScope) {
  const ignoredInputFiles = new Set(missionScope.ignoredInputFiles);
  const scopeCandidates = changedPaths.filter((changedPath) => !ignoredInputFiles.has(changedPath));
  const forbiddenChangedPaths = scopeCandidates.filter((changedPath) =>
    missionScope.forbiddenPaths.some((pattern) => matchesScopePattern(pattern, changedPath)),
  );
  const outOfScopeChangedPaths =
    missionScope.allowedPaths.length > 0
      ? scopeCandidates.filter(
          (changedPath) => !missionScope.allowedPaths.some((pattern) => matchesScopePattern(pattern, changedPath)),
        )
      : [];
  const missionScopedChangedPaths =
    missionScope.allowedPaths.length > 0
      ? scopeCandidates.filter((changedPath) =>
          missionScope.allowedPaths.some((pattern) => matchesScopePattern(pattern, changedPath)),
        )
      : scopeCandidates;
  return {
    ignoredInputFiles: missionScope.ignoredInputFiles,
    allowedPaths: missionScope.allowedPaths,
    forbiddenPaths: missionScope.forbiddenPaths,
    nonInputChangedPaths: scopeCandidates,
    missionScopedChangedPaths,
    forbiddenChangedPaths,
    outOfScopeChangedPaths,
    scopeViolationPaths: uniqueStrings([...forbiddenChangedPaths, ...outOfScopeChangedPaths]),
  };
}

/**
 * @param {string[]} before
 * @param {string[]} after
 * @returns {string[]}
 */
function diffChangedPaths(before, after) {
  const beforeSet = new Set(before);
  return after.filter((changedPath) => !beforeSet.has(changedPath));
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
 * @param {string} projectId
 * @param {string} runId
 * @param {string} stepId
 * @param {string} stepClass
 * @param {string} promptBundleRef
 * @param {number} attempt
 * @returns {string}
 */
function buildCompiledContextId(projectId, runId, stepId, stepClass, promptBundleRef, attempt) {
  const promptMatch = /^prompt-bundle:\/\/([^@]+)@v\d+$/u.exec(promptBundleRef);
  const promptSuffix = normalizeRefSuffix(promptMatch?.[1] ?? promptBundleRef);
  const runSuffix = normalizeRefSuffix(runId) || "run";
  const stepSuffix = normalizeRefSuffix(stepId) || "step";
  const classSuffix = normalizeRefSuffix(stepClass) || "step";
  return `compiled-context.${projectId}.${runSuffix}.${stepSuffix}.${classSuffix}.attempt.${attempt}.${promptSuffix || "default"}`;
}

/**
 * @param {{
 *   runtimeLayout: { reportsRoot: string },
 *   compiledContextArtifact: Record<string, unknown>,
 *   artifactFileName: string,
 * }} options
 */
function writeCompiledContextArtifact(options) {
  const validation = validateContractDocument({
    family: "compiled-context-artifact",
    document: options.compiledContextArtifact,
    source: "runtime://compiled-context-artifact",
  });
  if (!validation.ok) {
    const messages = validation.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Compiled-context artifact failed contract validation: ${messages}`);
  }

  const artifactPath = path.join(options.runtimeLayout.reportsRoot, options.artifactFileName);
  fs.writeFileSync(artifactPath, `${JSON.stringify(options.compiledContextArtifact, null, 2)}\n`, "utf8");
  return artifactPath;
}

/**
 * @param {{ reportsRoot: string }} runtimeLayout
 * @returns {Record<string, unknown> | null}
 */
function readLatestAnalysisFeatureTraceability(runtimeLayout) {
  const reportPath = path.join(runtimeLayout.reportsRoot, "project-analysis-report.json");
  if (!fs.existsSync(reportPath)) {
    return null;
  }
  try {
    const report = /** @type {Record<string, unknown>} */ (JSON.parse(fs.readFileSync(reportPath, "utf8")));
    const featureTraceability = asRecord(report.feature_traceability);
    return Object.keys(featureTraceability).length > 0 ? featureTraceability : null;
  } catch {
    return null;
  }
}

/**
 * @param {{
 *   reportsRoot: string,
 *   runId: string,
 *   stepId: string,
 *   stepClass: string,
 * }} options
 * @returns {number}
 */
function resolveStepExecutionAttempt(options) {
  if (!fs.existsSync(options.reportsRoot)) {
    return 1;
  }

  const reportFiles = fs.readdirSync(options.reportsRoot).filter((entry) => STEP_RESULT_FILE_REGEX.test(entry));
  let highestAttempt = 0;

  for (const reportFile of reportFiles) {
    const reportPath = path.join(options.reportsRoot, reportFile);
    /** @type {Record<string, unknown>} */
    let stepResultDoc;
    try {
      const raw = fs.readFileSync(reportPath, "utf8");
      const parsed = JSON.parse(raw);
      stepResultDoc = asRecord(parsed);
    } catch {
      continue;
    }

    if (stepResultDoc.run_id !== options.runId || stepResultDoc.step_id !== options.stepId) {
      continue;
    }

    const selectedStep = asRecord(asRecord(asRecord(stepResultDoc.routed_execution).architecture_traceability).selected_step);
    if (typeof selectedStep.step_class === "string" && selectedStep.step_class !== options.stepClass) {
      continue;
    }

    let detectedAttempt = 1;
    if (typeof stepResultDoc.step_result_id === "string") {
      const explicitAttempt = /\.attempt\.(\d+)$/u.exec(stepResultDoc.step_result_id);
      if (explicitAttempt) {
        const parsedAttempt = Number.parseInt(explicitAttempt[1], 10);
        if (Number.isFinite(parsedAttempt) && parsedAttempt > 0) {
          detectedAttempt = parsedAttempt;
        }
      }
    }

    if (detectedAttempt > highestAttempt) {
      highestAttempt = detectedAttempt;
    }
  }

  return highestAttempt + 1;
}

/**
 * @param {Record<string, unknown>} assetResolution
 * @returns {string[]}
 */
function resolveSyntheticPacketRefs(assetResolution) {
  const promptBundle = asRecord(assetResolution.prompt_bundle);
  const promptProfile = asRecord(promptBundle.profile);
  const requiredInputs = asRecord(promptProfile.required_inputs);
  const packets = asRecord(requiredInputs.packets);
  return uniqueStrings(packets.required).map((packetName) => `packet://${packetName}`);
}

/**
 * @param {{
 *   runtimeLayout: { reportsRoot: string },
 *   stepResultFileName: string,
 *   stepResult: Record<string, unknown>,
 * }} options
 */
function writeStepResult(options) {
  const validation = validateContractDocument({
    family: "step-result",
    document: options.stepResult,
    source: "runtime://step-result",
  });
  if (!validation.ok) {
    const messages = validation.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Routed step-result failed contract validation: ${messages}`);
  }

  const stepResultPath = path.join(options.runtimeLayout.reportsRoot, options.stepResultFileName);
  fs.writeFileSync(stepResultPath, `${JSON.stringify(options.stepResult, null, 2)}\n`, "utf8");
  return stepResultPath;
}

/**
 * @param {{
 *   runtimeLayout: ReturnType<typeof initializeProjectRuntime>["runtimeLayout"],
 *   stepResultPath: string,
 *   stepResult: Record<string, unknown>,
 * }} options
 */
function rewriteStepResult(options) {
  return writeStepResult({
    runtimeLayout: options.runtimeLayout,
    stepResultFileName: path.basename(options.stepResultPath),
    stepResult: options.stepResult,
  });
}

/**
 * @param {Record<string, unknown>} stepResult
 * @returns {"pass" | "retry" | "repair" | "escalate" | "block" | "fail"}
 */
function resolveRuntimeHarnessDecision(stepResult) {
  const decision = asString(stepResult.runtime_harness_decision);
  if (
    decision === "pass" ||
    decision === "retry" ||
    decision === "repair" ||
    decision === "escalate" ||
    decision === "block" ||
    decision === "fail"
  ) {
    return decision;
  }
  return asString(stepResult.status) === "passed" ? "pass" : "repair";
}

/**
 * @param {Record<string, unknown>} stepResult
 * @param {"retry" | "repair" | "escalate"} action
 * @returns {number}
 */
function resolveActionBudget(stepResult, action) {
  const pendingAttempt = asRecordArray(stepResult.repair_attempts).find(
    (attempt) => asString(attempt.policy_action) === action || asString(attempt.runtime_harness_decision) === action,
  );
  const policyBudget = asRecord(pendingAttempt?.policy_budget);
  const maxAttempts = typeof policyBudget.max_attempts === "number" && Number.isFinite(policyBudget.max_attempts)
    ? Math.max(0, Math.floor(policyBudget.max_attempts))
    : null;
  if (maxAttempts !== null) {
    return maxAttempts;
  }
  return action === "escalate" ? 0 : 1;
}

/**
 * @param {ReturnType<typeof executeRoutedStep>} result
 * @param {Array<Record<string, unknown>>} attempts
 * @param {"pending" | "not_required" | "succeeded_after_retry" | "succeeded_after_repair" | "exhausted" | "blocked"} status
 */
function persistRuntimeHarnessAttemptLedger(result, attempts, status) {
  result.stepResult.repair_attempts = attempts;
  result.stepResult.repair_status = status;
  rewriteStepResult({
    runtimeLayout: result.runtimeLayout,
    stepResultPath: result.stepResultPath,
    stepResult: result.stepResult,
  });
}

/**
 * @param {{
 *   result: ReturnType<typeof executeRoutedStep>,
 *   attempts: Array<Record<string, unknown>>,
 *   action: "retry" | "repair",
 *   exhausted: boolean,
 * }} options
 */
function persistExhaustedRuntimeDecision(options) {
  const finalDecision = options.exhausted ? "block" : "escalate";
  const attempts = options.attempts.map((attempt, index) =>
    options.exhausted && index === options.attempts.length - 1
      ? {
          ...attempt,
          status: "exhausted",
          result: "exhausted",
          exhausted_budget: true,
        }
      : attempt,
  );
  options.result.stepResult.status = "failed";
  options.result.stepResult.mission_outcome = "not_satisfied";
  options.result.stepResult.runtime_harness_decision = finalDecision;
  options.result.stepResult.repair_status = options.exhausted ? "exhausted" : "blocked";
  options.result.stepResult.summary = `Runtime Harness ${options.action} budget exhausted for failure class '${asString(options.result.stepResult.failure_class) ?? "unknown"}'.`;
  const routedExecution = asRecord(options.result.stepResult.routed_execution);
  routedExecution.blocked_next_step =
    "Inspect Runtime Harness repair ledger and address unresolved failure evidence before continuing delivery.";
  options.result.stepResult.routed_execution = routedExecution;
  options.result.stepResult.repair_attempts = attempts;
  rewriteStepResult({
    runtimeLayout: options.result.runtimeLayout,
    stepResultPath: options.result.stepResultPath,
    stepResult: options.result.stepResult,
  });
}

/**
 * @param {ReturnType<typeof executeRoutedStep>} result
 */
function refreshRuntimeHarnessReportForStep(result) {
  materializeRuntimeHarnessReport({
    projectRef: result.projectRoot,
    cwd: result.projectRoot,
    runtimeRoot: result.runtimeRoot,
    runId: result.runId,
  });
}

/**
 * @param {{
 *   result: ReturnType<typeof executeRoutedStep>,
 *   attempt: number,
 *   inputEvidenceRefs: string[],
 * }} options
 * @returns {{ repairInputFile: string, repairInputRef: string }}
 */
function writeRuntimeRepairInput(options) {
  const runtimeHarness = materializeRuntimeHarnessReport({
    projectRef: options.result.projectRoot,
    cwd: options.result.projectRoot,
    runtimeRoot: options.result.runtimeRoot,
    runId: options.result.runId,
  });
  const routedExecution = asRecord(options.result.stepResult.routed_execution);
  const adapterResponse = asRecord(routedExecution.adapter_response);
  const adapterOutput = asRecord(adapterResponse.output);
  const repairInputFile = path.join(
    options.result.runtimeLayout.reportsRoot,
    `runtime-harness-repair-input-${normalizeRefSuffix(options.result.runId)}-${normalizeRefSuffix(options.result.stepId)}-attempt-${options.attempt}.json`,
  );
  const repairInput = {
    repair_input_id: `${options.result.runId}.${options.result.stepId}.repair-input.${options.attempt}`,
    run_id: options.result.runId,
    failed_step_id: options.result.stepId,
    failed_step_result_ref: toEvidenceRef(options.result.projectRoot, options.result.stepResultPath),
    failed_step_result_file: options.result.stepResultPath,
    attempt: options.attempt,
    created_at: new Date().toISOString(),
    previous_findings: [
      {
        failure_class: asString(options.result.stepResult.failure_class) ?? "unknown",
        runtime_harness_decision: asString(options.result.stepResult.runtime_harness_decision) ?? "unknown",
        mission_outcome: asString(options.result.stepResult.mission_outcome) ?? "unknown",
        summary: asString(options.result.stepResult.summary) ?? "Runtime Harness repair trigger.",
      },
    ],
    failed_transcript_refs: uniqueStrings([
      asString(asRecord(adapterOutput.external_runner).raw_evidence_ref) ?? "",
      ...asStringArray(adapterResponse.evidence_refs),
      ...asStringArray(options.result.stepResult.evidence_refs),
    ]),
    diff_status: asRecord(options.result.stepResult.mission_semantics),
    adapter_evidence: {
      status: asString(adapterResponse.status),
      failure_kind: asString(adapterOutput.failure_kind),
      summary: asString(adapterResponse.summary),
      evidence_refs: asStringArray(adapterResponse.evidence_refs),
      tool_traces: Array.isArray(adapterResponse.tool_traces) ? adapterResponse.tool_traces : [],
      output: adapterOutput,
    },
    validator_findings: {
      discovery_completeness_gate: asRecord(routedExecution.discovery_completeness_gate),
      verification: asRecord(options.result.stepResult.verification),
    },
    runtime_harness_report_ref: runtimeHarness.reportRef,
    runtime_harness_report_file: runtimeHarness.reportPath,
    runtime_findings: Array.isArray(runtimeHarness.report.run_findings) ? runtimeHarness.report.run_findings : [],
    input_evidence_refs: uniqueStrings(options.inputEvidenceRefs),
  };
  fs.writeFileSync(repairInputFile, `${JSON.stringify(repairInput, null, 2)}\n`, "utf8");
  return {
    repairInputFile,
    repairInputRef: toEvidenceRef(options.result.projectRoot, repairInputFile),
  };
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef?: string,
 *   projectProfile?: string,
 *   runtimeRoot?: string,
 *   stepClass: string,
 *   dryRun?: boolean,
 *   runId?: string,
 *   stepId?: string,
 *   routeOverrides?: Record<string, string>,
 *   wrapperOverrides?: Record<string, string>,
 *   promptBundleOverrides?: Record<string, string>,
 *   contextBundleOverrides?: Record<string, string[]>,
 *   policyOverrides?: Record<string, string>,
 *   adapterOverrides?: Record<string, string>,
 *   routesRoot?: string,
 *   wrappersRoot?: string,
 *   promptsRoot?: string,
 *   contextBundlesRoot?: string,
 *   policiesRoot?: string,
 *   adaptersRoot?: string,
 *   skillsRoot?: string,
 *   executionRoot?: string,
 *   requireDiscoveryCompleteness?: boolean,
 *   approvedHandoffRef?: string,
 *   promotionEvidenceRefs?: string[],
 *   coordinationEvidenceRefs?: string[],
 *   runtimeEvidenceRefs?: string[],
 * }} options
 */
export function executeRoutedStep(options) {
  const init = initializeProjectRuntime(options);

  const routesRoot = options.routesRoot
    ? path.isAbsolute(options.routesRoot)
      ? options.routesRoot
      : path.resolve(init.projectRoot, options.routesRoot)
    : path.join(init.projectRoot, "examples/routes");
  const wrappersRoot = options.wrappersRoot
    ? path.isAbsolute(options.wrappersRoot)
      ? options.wrappersRoot
      : path.resolve(init.projectRoot, options.wrappersRoot)
    : path.join(init.projectRoot, "examples/wrappers");
  const promptsRoot = options.promptsRoot
    ? path.isAbsolute(options.promptsRoot)
      ? options.promptsRoot
      : path.resolve(init.projectRoot, options.promptsRoot)
    : path.join(init.projectRoot, "examples/prompts");
  const contextBundlesRoot = options.contextBundlesRoot
    ? path.isAbsolute(options.contextBundlesRoot)
      ? options.contextBundlesRoot
      : path.resolve(init.projectRoot, options.contextBundlesRoot)
    : path.join(init.projectRoot, "examples/context/bundles");
  const policiesRoot = options.policiesRoot
    ? path.isAbsolute(options.policiesRoot)
      ? options.policiesRoot
      : path.resolve(init.projectRoot, options.policiesRoot)
    : path.join(init.projectRoot, "examples/policies");
  const adaptersRoot = options.adaptersRoot
    ? path.isAbsolute(options.adaptersRoot)
      ? options.adaptersRoot
      : path.resolve(init.projectRoot, options.adaptersRoot)
    : path.join(init.projectRoot, "examples/adapters");
  const skillsRoot = options.skillsRoot
    ? path.isAbsolute(options.skillsRoot)
      ? options.skillsRoot
      : path.resolve(init.projectRoot, options.skillsRoot)
    : path.join(init.projectRoot, "examples/skills");
  const executionRoot = options.executionRoot
    ? path.isAbsolute(options.executionRoot)
      ? options.executionRoot
      : path.resolve(init.projectRoot, options.executionRoot)
    : init.projectRoot;
  const changedPathStatusBefore = listChangedPaths(executionRoot);

  const requestedStepClass = options.stepClass;
  const resultStepClass = STEP_CLASS_TO_RESULT_CLASS[requestedStepClass] ?? "runner";
  const runId = options.runId ?? `${init.projectId}.routed-execution.v1`;
  const stepId = options.stepId ?? `routed.${requestedStepClass}`;
  const executionAttempt = resolveStepExecutionAttempt({
    reportsRoot: init.runtimeLayout.reportsRoot,
    runId,
    stepId,
    stepClass: requestedStepClass,
  });
  const stepResultIdBase = `${runId}.step.${requestedStepClass}`;
  const stepResultId = executionAttempt > 1 ? `${stepResultIdBase}.attempt.${executionAttempt}` : stepResultIdBase;
  const runScopeSuffix = normalizeRefSuffix(runId) || "run";
  const stepScopeSuffix = normalizeRefSuffix(stepId) || "step";
  const classScopeSuffix = normalizeRefSuffix(requestedStepClass) || "step";
  const scopedArtifactSuffix = `${runScopeSuffix}.${stepScopeSuffix}.${classScopeSuffix}.attempt.${executionAttempt}`;
  const stepResultFileName = `step-result-routed-${scopedArtifactSuffix}.json`;
  const compiledContextFileName = `compiled-context-${scopedArtifactSuffix}.json`;
  const dryRun = options.dryRun !== false;

  const startedAt = new Date().toISOString();

  /** @type {Record<string, unknown> | null} */
  let routeResolution = null;
  /** @type {Record<string, unknown> | null} */
  let assetResolution = null;
  /** @type {Record<string, unknown> | null} */
  let policyResolution = null;
  /** @type {Record<string, unknown> | null} */
  let adapterResolution = null;
  /** @type {{ deliveryPlan: Record<string, unknown>, deliveryPlanFile: string } | null} */
  let deliveryPlanResult = null;
  /** @type {Record<string, unknown> | null} */
  let adapterRequest = null;
  /** @type {Record<string, unknown> | null} */
  let adapterResponse = null;
  /** @type {Record<string, unknown> | null} */
  let compiledContextArtifact = null;
  /** @type {Record<string, unknown> | null} */
  let contextCompilation = null;
  /** @type {Record<string, unknown> | null} */
  let featureTraceability = null;
  /** @type {string | null} */
  let compiledContextRef = null;
  /** @type {string | null} */
  let compiledContextArtifactPath = null;
  /** @type {string[]} */
  let evidenceRefs = uniqueStrings([init.projectProfilePath, ...asStringArray(options.runtimeEvidenceRefs)]);
  /** @type {"passed" | "failed"} */
  let status = "passed";
  let summary = dryRun
    ? `Routed step '${requestedStepClass}' completed in dry-run mode.`
    : `Routed live execution for step '${requestedStepClass}' completed.`;
  /** @type {string | null} */
  let blockedNextStep = null;
  /** @type {{
   *   status: "pass" | "fail",
   *   blocking: boolean,
   *   analysis_report_id: string,
   *   analysis_report_file: string,
   *   checks: Array<{ check_id: string, status: "pass" | "fail", blocking: boolean, summary: string, expected: unknown, actual: unknown }>,
   * } | null} */
  let discoveryCompletenessGate = null;
  /** @type {{
   *   architecture_doc_refs: string[],
   *   contract_refs: string[],
   *   planning_artifact_families: string[],
   *   step_linkage: Array<{ step_class: string, route_id: string | null, wrapper_ref: string | null, prompt_bundle_ref: string | null, policy_id: string | null }>,
   *   evaluation_refs: { suite_refs: string[], dataset_refs: string[] },
   * } | null} */
  let discoveryArchitectureTraceability = null;

  if (requestedStepClass === "spec" && options.requireDiscoveryCompleteness !== false) {
    const discoveryResult = analyzeProjectRuntime({
      cwd: options.cwd,
      projectRef: options.projectRef,
      projectProfile: options.projectProfile,
      runtimeRoot: options.runtimeRoot,
      routeOverrides: options.routeOverrides,
      policyOverrides: options.policyOverrides,
      adapterOverrides: options.adapterOverrides,
      routesRoot: options.routesRoot,
      wrappersRoot: options.wrappersRoot,
      promptsRoot: options.promptsRoot,
      policiesRoot: options.policiesRoot,
      adaptersRoot: options.adaptersRoot,
    });
    const completeness = discoveryResult.report.discovery_completeness;
    const architectureTraceability = discoveryResult.report.architecture_traceability;

    if (
      typeof completeness !== "object" ||
      completeness === null ||
      !Array.isArray(completeness.checks) ||
      typeof completeness.status !== "string"
    ) {
      throw new Error(
        "Project analysis report is missing discovery_completeness; run 'aor discovery run' to regenerate analysis outputs.",
      );
    }

    discoveryCompletenessGate = {
      status: completeness.status === "pass" ? "pass" : "fail",
      blocking: Boolean(completeness.blocking),
      analysis_report_id: discoveryResult.report.report_id,
      analysis_report_file: discoveryResult.reportPath,
      checks: completeness.checks
        .filter((check) => typeof check === "object" && check !== null)
        .map((check) => ({
          check_id: typeof check.check_id === "string" ? check.check_id : "unknown",
          status: check.status === "pass" ? "pass" : "fail",
          blocking: Boolean(check.blocking),
          summary: typeof check.summary === "string" ? check.summary : "Discovery completeness check",
          expected: Object.prototype.hasOwnProperty.call(check, "expected") ? check.expected : null,
          actual: Object.prototype.hasOwnProperty.call(check, "actual") ? check.actual : null,
        })),
    };
    if (typeof architectureTraceability === "object" && architectureTraceability !== null) {
      discoveryArchitectureTraceability = {
        architecture_doc_refs: Array.isArray(architectureTraceability.architecture_doc_refs)
          ? architectureTraceability.architecture_doc_refs.filter((entry) => typeof entry === "string")
          : [],
        contract_refs: Array.isArray(architectureTraceability.contract_refs)
          ? architectureTraceability.contract_refs.filter((entry) => typeof entry === "string")
          : [],
        planning_artifact_families: Array.isArray(architectureTraceability.planning_artifact_families)
          ? architectureTraceability.planning_artifact_families.filter((entry) => typeof entry === "string")
          : [],
        step_linkage: Array.isArray(architectureTraceability.step_linkage)
          ? architectureTraceability.step_linkage
              .filter((entry) => typeof entry === "object" && entry !== null)
              .map((entry) => ({
                step_class: typeof entry.step_class === "string" ? entry.step_class : "unknown",
                route_id: typeof entry.route_id === "string" ? entry.route_id : null,
                wrapper_ref: typeof entry.wrapper_ref === "string" ? entry.wrapper_ref : null,
                prompt_bundle_ref: typeof entry.prompt_bundle_ref === "string" ? entry.prompt_bundle_ref : null,
                policy_id: typeof entry.policy_id === "string" ? entry.policy_id : null,
              }))
          : [],
        evaluation_refs:
          typeof architectureTraceability.evaluation_refs === "object" && architectureTraceability.evaluation_refs
            ? {
                suite_refs: Array.isArray(architectureTraceability.evaluation_refs.suite_refs)
                  ? architectureTraceability.evaluation_refs.suite_refs.filter((entry) => typeof entry === "string")
                  : [],
                dataset_refs: Array.isArray(architectureTraceability.evaluation_refs.dataset_refs)
                  ? architectureTraceability.evaluation_refs.dataset_refs.filter((entry) => typeof entry === "string")
                  : [],
              }
            : { suite_refs: [], dataset_refs: [] },
      };
    }

    if (discoveryCompletenessGate.blocking) {
      status = "failed";
      summary =
        "Spec build blocked by discovery completeness checks. Run 'aor discovery run' and resolve failed checks before planning handoff.";
      blockedNextStep = "Re-run discovery and close failing completeness checks before executing spec build.";
      evidenceRefs = uniqueStrings([
        init.projectProfilePath,
        discoveryResult.reportPath,
        ...asStringArray(options.runtimeEvidenceRefs),
      ]);
    }
    featureTraceability = asRecord(discoveryResult.report.feature_traceability);
  }

  if (!discoveryCompletenessGate?.blocking) {
    try {
      routeResolution = resolveRouteForStep({
        projectProfilePath: init.projectProfilePath,
        routesRoot,
        stepClass: requestedStepClass,
        stepOverrides: options.routeOverrides,
      });

      assetResolution = resolveAssetBundleForStep({
        projectProfilePath: init.projectProfilePath,
        routesRoot,
        wrappersRoot,
        promptsRoot,
        contextBundlesRoot,
        stepClass: requestedStepClass,
        routeOverrides: options.routeOverrides,
        wrapperOverrides: options.wrapperOverrides,
        promptBundleOverrides: options.promptBundleOverrides,
        contextBundleOverrides: options.contextBundleOverrides,
      });

      policyResolution = resolveStepPolicyForStep({
        projectProfilePath: init.projectProfilePath,
        routesRoot,
        policiesRoot,
        stepClass: requestedStepClass,
        routeOverrides: options.routeOverrides,
        policyOverrides: options.policyOverrides,
      });
      const approvedHandoffRef = asString(options.approvedHandoffRef);
      deliveryPlanResult = materializeDeliveryPlan({
        runtimeLayout: init.runtimeLayout,
        projectId: init.projectId,
        runId,
        stepClass: requestedStepClass,
        policyResolution: /** @type {Record<string, unknown>} */ (policyResolution),
        handoffApproval: approvedHandoffRef
          ? {
              status: "pass",
              ref: approvedHandoffRef,
            }
          : undefined,
        promotionEvidenceRefs: asStringArray(options.promotionEvidenceRefs),
        coordinationEvidenceRefs: asStringArray(options.coordinationEvidenceRefs),
      });

      adapterResolution = resolveAdapterForRoute({
        routeResolution: /** @type {any} */ (routeResolution),
        adaptersRoot,
        adapterOverrides: options.adapterOverrides,
      });
      const syntheticPacketRefs = resolveSyntheticPacketRefs(/** @type {Record<string, unknown>} */ (assetResolution));
      const compiled = compileStepContext({
        projectRoot: init.projectRoot,
        projectProfilePath: init.projectProfilePath,
        stepClass: requestedStepClass,
        routeResolution: /** @type {Record<string, unknown>} */ (routeResolution),
        assetResolution: /** @type {Record<string, unknown>} */ (assetResolution),
        policyResolution: /** @type {Record<string, unknown>} */ (policyResolution),
        inputPacketRefs: syntheticPacketRefs,
        runtimeEvidenceRefs: evidenceRefs,
        skillsRoot,
      });
      contextCompilation = compiled.context_compilation;

      const promptBundleRef = String(
        asRecord(asRecord(assetResolution).prompt_bundle).prompt_bundle_ref ?? "prompt-bundle://unknown@v1",
      );
      const contextBundles = asRecord(asRecord(assetResolution).context_bundles);
      const expandedRefs = asRecord(contextBundles.expanded_refs);
      const compiledContextId = buildCompiledContextId(
        init.projectId,
        runId,
        stepId,
        requestedStepClass,
        promptBundleRef,
        executionAttempt,
      );
      compiledContextArtifact = {
        compiled_context_id: compiledContextId,
        version: 1,
        step: requestedStepClass,
        prompt_bundle_ref: promptBundleRef,
        context_bundle_refs: uniqueStrings(contextBundles.bundle_refs),
        context_doc_refs: uniqueStrings(expandedRefs.context_doc_refs),
        context_rule_refs: uniqueStrings(expandedRefs.context_rule_refs),
        context_skill_refs: uniqueStrings(expandedRefs.context_skill_refs),
        packet_refs: uniqueStrings(compiled.context_compilation.resolved_input_packet_refs),
        hashes: {
          prompt_hash: `sha256:${sha256Hex(promptBundleRef)}`,
          context_hash: `sha256:${String(compiled.context_compilation.compiled_context_fingerprint ?? "")}`,
        },
        provenance: {
          compiler_revision_ref: "compiler://runtime-context-compiler@v1",
          project_profile_ref: init.projectProfilePath,
          route_profile_ref: asRecord(routeResolution).resolved_route_id ?? null,
          wrapper_profile_ref: asRecord(asRecord(assetResolution).wrapper).wrapper_ref ?? null,
          generated_at: new Date().toISOString(),
        },
      };
      compiledContextArtifactPath = writeCompiledContextArtifact({
        runtimeLayout: init.runtimeLayout,
        compiledContextArtifact,
        artifactFileName: compiledContextFileName,
      });
      compiledContextRef = `compiled-context://${compiledContextId}`;

      adapterRequest = createAdapterRequestEnvelope({
        request_id: `${stepResultId}.request`,
        run_id: runId,
        step_id: stepId,
        step_class: requestedStepClass,
        route: routeResolution,
        asset_bundle: assetResolution,
        policy_bundle: policyResolution,
        input_packet_refs: uniqueStrings(compiled.context_compilation.resolved_input_packet_refs),
        dry_run: dryRun,
        context: {
          compiled_context_ref: compiledContextRef,
          compiled_context_id: compiledContextId,
          compiled_context_fingerprint: compiled.context_compilation.compiled_context_fingerprint,
          context_bundle_refs: compiledContextArtifact.context_bundle_refs,
          context_doc_refs: compiledContextArtifact.context_doc_refs,
          context_rule_refs: compiledContextArtifact.context_rule_refs,
          context_skill_refs: compiledContextArtifact.context_skill_refs,
          packet_refs: compiledContextArtifact.packet_refs,
          instruction_set: compiled.compiled_context.instruction_set,
          required_inputs_resolved: compiled.compiled_context.required_inputs_resolved,
          guardrails: compiled.compiled_context.guardrails,
          skill_refs: compiled.compiled_context.skill_refs,
          provenance: compiled.compiled_context.provenance,
        },
      });

      const selectedAdapterId =
        typeof (/** @type {any} */ (adapterResolution))?.adapter?.adapter_id === "string"
          ? /** @type {any} */ (adapterResolution).adapter.adapter_id
          : "none";

      if (dryRun) {
        const mockAdapter = createMockAdapter();
        adapterResponse = mockAdapter.execute(/** @type {any} */ (adapterRequest));
        summary = `Routed dry-run for step '${requestedStepClass}' completed with selected adapter '${selectedAdapterId}' and mock execution.`;
      } else {
        const plan = asRecord(deliveryPlanResult?.deliveryPlan);
        const planReady = plan.status === "ready" && plan.writeback_allowed === true;
        const blockingReasons = asStringArray(plan.blocking_reasons);

        if (!planReady) {
          status = "failed";
          summary =
            blockingReasons.length > 0
              ? `Routed live execution blocked by delivery guardrails: ${blockingReasons.join(", ")}.`
              : `Routed live execution blocked for step '${requestedStepClass}': delivery plan is not ready.`;
          blockedNextStep =
            "Provide approved handoff and promotion evidence (or use '--routed-dry-run-step') before live execution.";
          adapterResponse = createAdapterResponseEnvelope({
            request_id: adapterRequest.request_id,
            adapter_id: selectedAdapterId,
            status: "blocked",
            summary,
            output: {
              mode: "execute",
              blocked: true,
              blocking_reasons: blockingReasons,
              delivery_plan_status: asString(plan.status) ?? "unknown",
            },
          });
        } else {
          try {
            const liveAdapter = createLiveAdapter({
              adapterId: selectedAdapterId,
              adapterProfile: asRecord(asRecord(/** @type {any} */ (adapterResolution).adapter).profile),
              runtimeEvidenceRoot: init.runtimeLayout.reportsRoot,
              projectRoot: init.projectRoot,
              executionRoot,
            });
            adapterResponse = liveAdapter.execute(/** @type {any} */ (adapterRequest));
            if (adapterResponse.status === "success") {
              summary = `Routed live execution for step '${requestedStepClass}' completed with adapter '${selectedAdapterId}'.`;
            } else {
              status = "failed";
              summary = asString(adapterResponse.summary) ?? summary;
              const adapterOutput = asRecord(adapterResponse.output);
              const failureKind = asString(adapterOutput.failure_kind);
              if (failureKind === "missing-command" || failureKind === "missing-live-runtime") {
                blockedNextStep =
                  "Install/configure external runner prerequisites for the selected adapter or use '--routed-dry-run-step'.";
              } else if (failureKind === "auth-failed") {
                blockedNextStep =
                  "Authenticate the selected external runner CLI in the current runner auth mode, then retry live execution.";
              } else if (failureKind === "permission-mode-blocked") {
                blockedNextStep =
                  "Adjust external runner permission mode or live E2E policy, then retry live execution.";
              } else {
                blockedNextStep =
                  "Inspect adapter response evidence/tool traces, fix external runner execution, then retry live execution.";
              }
            }
          } catch (error) {
            status = "failed";
            summary = error instanceof Error ? error.message : String(error);
            blockedNextStep = "Select a supported live adapter or use '--routed-dry-run-step'.";
            adapterResponse = createAdapterResponseEnvelope({
              request_id: adapterRequest.request_id,
              adapter_id: selectedAdapterId,
              status: "blocked",
              summary,
              output: {
                mode: "execute",
                blocked: true,
                failure_kind: "adapter-not-supported",
              },
            });
          }
        }
      }

      evidenceRefs = [
        ...new Set([
          init.projectProfilePath,
          ...asStringArray(options.runtimeEvidenceRefs),
          ...(deliveryPlanResult ? [deliveryPlanResult.deliveryPlanFile] : []),
          ...(compiledContextRef ? [compiledContextRef] : []),
          ...(compiledContextArtifactPath ? [compiledContextArtifactPath] : []),
          ...asStringArray(adapterResponse?.evidence_refs),
        ]),
      ];
      if (featureTraceability === null) {
        featureTraceability = readLatestAnalysisFeatureTraceability(init.runtimeLayout);
      }
    } catch (error) {
      status = "failed";
      summary = error instanceof Error ? error.message : String(error);
      blockedNextStep = dryRun
        ? "Fix routed resolution inputs (route/asset/policy/adapter) and retry dry-run."
        : "Fix routed resolution inputs (route/asset/policy/adapter) and retry live execution.";
    }
  }

  const finishedAt = new Date().toISOString();
  const changedPathStatusAfter = listChangedPaths(executionRoot);
  const changedPathsDuringStep =
    changedPathStatusBefore.available && changedPathStatusAfter.available
      ? diffChangedPaths(changedPathStatusBefore.changedPaths, changedPathStatusAfter.changedPaths)
      : [];
  const nonBootstrapChangedPaths = filterNonBootstrapChangedPaths(changedPathStatusAfter.changedPaths);
  const nonBootstrapChangedPathsDuringStep = filterNonBootstrapChangedPaths(changedPathsDuringStep);
  const missionScope = loadMissionScope(init.projectRoot, init.runtimeLayout.artifactsRoot);
  const missionProfile = resolveRuntimeMissionProfile(init.projectRoot, init.runtimeLayout.artifactsRoot);
  const missionScopedChanges = resolveMissionScopedChanges(nonBootstrapChangedPaths, missionScope);
  const strictCodeChangingNoop =
    !dryRun &&
    requestedStepClass === "implement" &&
    (missionProfile.missionType === "code-changing" || missionProfile.missionType === "release") &&
    changedPathStatusBefore.available &&
    changedPathStatusAfter.available;
  const stepResult = {
    step_result_id: stepResultId,
    run_id: runId,
    step_id: stepId,
    step_class: resultStepClass,
    status,
    summary,
    evidence_refs: evidenceRefs,
    routed_execution: {
      mode: dryRun ? "dry-run" : "execute",
      no_write_enforced: dryRun,
      started_at: startedAt,
      finished_at: finishedAt,
      route_resolution: routeResolution,
      asset_resolution: assetResolution,
      policy_resolution: policyResolution,
      delivery_plan: deliveryPlanResult
        ? {
            plan_id: deliveryPlanResult.deliveryPlan.plan_id,
            delivery_mode: deliveryPlanResult.deliveryPlan.delivery_mode,
            status: deliveryPlanResult.deliveryPlan.status,
            writeback_allowed: deliveryPlanResult.deliveryPlan.writeback_allowed,
            delivery_plan_file: deliveryPlanResult.deliveryPlanFile,
          }
        : null,
      adapter_resolution: adapterResolution,
      adapter_request: adapterRequest,
      adapter_response: adapterResponse,
      context_compilation: {
        compiled_context_ref: compiledContextRef,
        compiled_context_file: compiledContextArtifactPath,
        compiled_context_artifact: compiledContextArtifact,
        diagnostics: contextCompilation,
      },
      feature_traceability: featureTraceability,
      discovery_completeness_gate: discoveryCompletenessGate,
      architecture_traceability: {
        architecture_doc_refs: discoveryArchitectureTraceability?.architecture_doc_refs ?? [...STEP_ARCHITECTURE_DOC_REFS],
        contract_refs: discoveryArchitectureTraceability?.contract_refs ?? [...STEP_ARCHITECTURE_CONTRACT_REFS],
        planning_artifact_families: discoveryArchitectureTraceability?.planning_artifact_families ?? [
          "project-analysis-report",
          "step-result",
          "wave-ticket",
          "handoff-packet",
        ],
        step_linkage: discoveryArchitectureTraceability?.step_linkage ?? [],
        evaluation_refs: discoveryArchitectureTraceability?.evaluation_refs ?? {
          suite_refs: [],
          dataset_refs: [],
        },
        selected_step: {
          step_class: requestedStepClass,
          route_id:
            typeof (/** @type {any} */ (routeResolution))?.resolved_route_id === "string"
              ? /** @type {any} */ (routeResolution).resolved_route_id
              : null,
          wrapper_ref:
            typeof (/** @type {any} */ (assetResolution))?.wrapper?.wrapper_ref === "string"
              ? /** @type {any} */ (assetResolution).wrapper.wrapper_ref
              : null,
          prompt_bundle_ref:
            typeof (/** @type {any} */ (assetResolution))?.prompt_bundle?.prompt_bundle_ref === "string"
              ? /** @type {any} */ (assetResolution).prompt_bundle.prompt_bundle_ref
              : null,
          policy_id:
            typeof (/** @type {any} */ (policyResolution))?.policy?.policy_id === "string"
              ? /** @type {any} */ (policyResolution).policy.policy_id
              : null,
          adapter_id:
            typeof (/** @type {any} */ (adapterResolution))?.adapter?.adapter_id === "string"
              ? /** @type {any} */ (adapterResolution).adapter.adapter_id
              : null,
        },
      },
      blocked_next_step: blockedNextStep,
      evidence_root: init.runtimeLayout.reportsRoot,
    },
    mission_semantics: {
      git_status_available: changedPathStatusBefore.available && changedPathStatusAfter.available,
      git_status_root: executionRoot,
      changed_paths_before_step: changedPathStatusBefore.changedPaths,
      changed_paths_after_step: changedPathStatusAfter.changedPaths,
      changed_paths_during_step: changedPathsDuringStep,
      non_bootstrap_changed_paths: nonBootstrapChangedPaths,
      non_bootstrap_changed_paths_during_step: nonBootstrapChangedPathsDuringStep,
      non_input_changed_paths: missionScopedChanges.nonInputChangedPaths,
      mission_scoped_changed_paths: missionScopedChanges.missionScopedChangedPaths,
      ignored_input_files: missionScopedChanges.ignoredInputFiles,
      allowed_paths: missionScopedChanges.allowedPaths,
      forbidden_paths: missionScopedChanges.forbiddenPaths,
      forbidden_changed_paths: missionScopedChanges.forbiddenChangedPaths,
      out_of_scope_changed_paths: missionScopedChanges.outOfScopeChangedPaths,
      scope_violation_paths: missionScopedChanges.scopeViolationPaths,
      strict_code_changing_noop: strictCodeChangingNoop,
      mission_type: missionProfile.missionType,
      strictness_profile: missionProfile.strictnessProfile,
    },
  };
  const runtimeOutcome = classifyRuntimeStepOutcome(stepResult, {
    gitStatusAvailable: changedPathStatusBefore.available && changedPathStatusAfter.available,
    strictCodeChangingNoop,
    nonBootstrapChangedPaths,
    missionScopedChangedPaths: missionScopedChanges.missionScopedChangedPaths,
    scopeViolationPaths: missionScopedChanges.scopeViolationPaths,
  });
  stepResult.mission_outcome = runtimeOutcome.missionOutcome;
  stepResult.failure_class = runtimeOutcome.failureClass;
  stepResult.runtime_harness_decision = runtimeOutcome.decision;
  stepResult.repair_attempts = synthesizeRepairAttempts(
    stepResult,
    runtimeOutcome,
    toEvidenceRef(init.projectRoot, path.join(init.runtimeLayout.reportsRoot, stepResultFileName)),
  );
  stepResult.repair_status = runtimeOutcome.decision === "repair" ? "pending" : "not_required";
  stepResult.stage_timings = {
    started_at: startedAt,
    finished_at: finishedAt,
    duration_sec: resolveDurationSeconds(startedAt, finishedAt),
  };
  stepResult.permission_denials =
    runtimeOutcome.failureClass === "permission-mode-blocked" || runtimeOutcome.failureClass === "edit-denied"
      ? [
          {
            failure_class: runtimeOutcome.failureClass,
            summary,
            evidence_refs: evidenceRefs,
          },
        ]
      : [];
  stepResult.requested_interaction =
    runtimeOutcome.failureClass === "interactive-question-requested"
      ? {
          requested: true,
          summary,
          evidence_refs: evidenceRefs,
        }
      : null;

  const stepResultPath = writeStepResult({
    runtimeLayout: init.runtimeLayout,
    stepResultFileName,
    stepResult,
  });

  return {
    ...init,
    runId,
    stepId,
    stepResultId,
    stepResult,
    stepResultPath,
  };
}

/**
 * Execute a routed step through the AOR Runtime Harness controller.
 *
 * The one-shot `executeRoutedStep` surface remains the primitive that writes a
 * single routed step result. This controller is the normal runtime surface for
 * `run start`: it records the first decision, applies bounded retry/repair
 * policy, reruns the original step after repair, and blocks delivery semantics
 * when the policy budget is exhausted.
 *
 * @param {Parameters<typeof executeRoutedStep>[0]} options
 * @returns {ReturnType<typeof executeRoutedStep>}
 */
export function executeRuntimeHarnessControlledStep(options) {
  let current = executeRoutedStep(options);
  refreshRuntimeHarnessReportForStep(current);

  if (options.stepClass === "repair") {
    const repairDecision = resolveRuntimeHarnessDecision(current.stepResult);
    if (repairDecision !== "pass") {
      persistExhaustedRuntimeDecision({
        result: current,
        attempts: asRecordArray(current.stepResult.repair_attempts),
        action: "repair",
        exhausted: true,
      });
      refreshRuntimeHarnessReportForStep(current);
    }
    return current;
  }

  /** @type {Array<Record<string, unknown>>} */
  const executedAttempts = [];
  const counters = {
    retry: 0,
    repair: 0,
  };

  for (let loopIndex = 0; loopIndex < 20; loopIndex += 1) {
    const decision = resolveRuntimeHarnessDecision(current.stepResult);
    if (decision === "pass") {
      if (executedAttempts.length > 0) {
        persistRuntimeHarnessAttemptLedger(
          current,
          executedAttempts,
          executedAttempts.some((attempt) => asString(attempt.policy_action) === "repair")
            ? "succeeded_after_repair"
            : "succeeded_after_retry",
        );
        refreshRuntimeHarnessReportForStep(current);
      }
      return current;
    }
    if (decision === "fail" || decision === "block" || decision === "escalate") {
      if (asString(current.stepResult.status) === "passed") {
        current.stepResult.status = "failed";
        current.stepResult.summary = `Runtime Harness blocked step '${current.stepId}' with decision '${decision}' and failure class '${asString(current.stepResult.failure_class) ?? "unknown"}'.`;
        rewriteStepResult({
          runtimeLayout: current.runtimeLayout,
          stepResultPath: current.stepResultPath,
          stepResult: current.stepResult,
        });
        refreshRuntimeHarnessReportForStep(current);
      }
      return current;
    }
    if (decision !== "retry" && decision !== "repair") {
      return current;
    }

    const maxAttempts = resolveActionBudget(current.stepResult, decision);
    counters[decision] += 1;
    if (counters[decision] > maxAttempts) {
      const exhaustedAttempts = executedAttempts.map((attempt) => ({ ...attempt }));
      if (exhaustedAttempts.length > 0) {
        exhaustedAttempts[exhaustedAttempts.length - 1] = {
          ...exhaustedAttempts[exhaustedAttempts.length - 1],
          exhausted_budget: true,
        };
      }
      persistExhaustedRuntimeDecision({
        result: current,
        attempts: exhaustedAttempts,
        action: decision,
        exhausted: true,
      });
      refreshRuntimeHarnessReportForStep(current);
      return current;
    }

    const attemptStartedAt = new Date().toISOString();
    const baseEvidenceRefs = uniqueStrings([
      toEvidenceRef(current.projectRoot, current.stepResultPath),
      ...asStringArray(current.stepResult.evidence_refs),
    ]);

    if (decision === "retry") {
      const retried = executeRoutedStep(options);
      const attemptFinishedAt = new Date().toISOString();
      executedAttempts.push({
        attempt: executedAttempts.length + 1,
        status: resolveRuntimeHarnessDecision(retried.stepResult) === "pass" ? "pass" : "fail",
        trigger: asString(current.stepResult.failure_class) ?? "unknown",
        failure_class: asString(current.stepResult.failure_class) ?? "unknown",
        runtime_harness_decision: "retry",
        policy_action: "retry",
        started_at: attemptStartedAt,
        finished_at: attemptFinishedAt,
        duration_sec: resolveDurationSeconds(attemptStartedAt, attemptFinishedAt),
        input_evidence_refs: baseEvidenceRefs,
        output_evidence_refs: uniqueStrings([
          toEvidenceRef(retried.projectRoot, retried.stepResultPath),
          ...asStringArray(retried.stepResult.evidence_refs),
        ]),
        repair_route_ref: null,
        repair_compiled_context_ref: null,
        result: resolveRuntimeHarnessDecision(retried.stepResult) === "pass" ? "pass" : "fail",
        exhausted_budget: counters.retry >= maxAttempts && resolveRuntimeHarnessDecision(retried.stepResult) !== "pass",
        policy_budget: {
          max_attempts: maxAttempts,
        },
      });
      persistRuntimeHarnessAttemptLedger(retried, executedAttempts, "pending");
      current = retried;
      refreshRuntimeHarnessReportForStep(current);
      continue;
    }

    const repairStepId = `${current.stepId}.repair.${counters.repair}`;
    const repairInput = writeRuntimeRepairInput({
      result: current,
      attempt: counters.repair,
      inputEvidenceRefs: baseEvidenceRefs,
    });
    const repairInputEvidenceRefs = uniqueStrings([
      repairInput.repairInputRef,
      ...baseEvidenceRefs,
    ]);
    const repair = executeRoutedStep({
      ...options,
      stepClass: "repair",
      stepId: repairStepId,
      requireDiscoveryCompleteness: false,
      runtimeEvidenceRefs: repairInputEvidenceRefs,
    });
    const repairFinishedAt = new Date().toISOString();
    const repairDecision = resolveRuntimeHarnessDecision(repair.stepResult);
    const repairContext = asRecord(asRecord(repair.stepResult.routed_execution).context_compilation);
    const repairRouteResolution = asRecord(asRecord(repair.stepResult.routed_execution).route_resolution);
    const repairAttempt = {
      attempt: executedAttempts.length + 1,
      status: repairDecision === "pass" ? "pass" : "fail",
      trigger: asString(current.stepResult.failure_class) ?? "unknown",
      failure_class: asString(current.stepResult.failure_class) ?? "unknown",
      runtime_harness_decision: "repair",
      policy_action: "repair",
      started_at: attemptStartedAt,
      finished_at: repairFinishedAt,
      duration_sec: resolveDurationSeconds(attemptStartedAt, repairFinishedAt),
      input_evidence_refs: repairInputEvidenceRefs,
      output_evidence_refs: uniqueStrings([
        toEvidenceRef(repair.projectRoot, repair.stepResultPath),
        ...asStringArray(repair.stepResult.evidence_refs),
      ]),
      repair_route_ref: asString(repairRouteResolution.resolved_route_id)
        ? `route://${asString(repairRouteResolution.resolved_route_id)}`
        : null,
      repair_compiled_context_ref: asString(repairContext.compiled_context_ref),
      result: repairDecision === "pass" ? "pass" : "fail",
      exhausted_budget: false,
      policy_budget: {
        max_attempts: maxAttempts,
      },
    };
    executedAttempts.push(repairAttempt);
    persistRuntimeHarnessAttemptLedger(current, executedAttempts, "pending");
    refreshRuntimeHarnessReportForStep(repair);

    if (repairDecision !== "pass") {
      executedAttempts[executedAttempts.length - 1] = {
        ...repairAttempt,
        result: repairDecision === "block" ? "blocked" : "fail",
        exhausted_budget: counters.repair >= maxAttempts,
      };
      persistExhaustedRuntimeDecision({
        result: current,
        attempts: executedAttempts,
        action: "repair",
        exhausted: counters.repair >= maxAttempts,
      });
      refreshRuntimeHarnessReportForStep(current);
      return current;
    }

    const rerun = executeRoutedStep(options);
    persistRuntimeHarnessAttemptLedger(rerun, executedAttempts, "pending");
    current = rerun;
    refreshRuntimeHarnessReportForStep(current);
  }

  persistExhaustedRuntimeDecision({
    result: current,
    attempts: executedAttempts,
    action: "repair",
    exhausted: true,
  });
  refreshRuntimeHarnessReportForStep(current);
  return current;
}
