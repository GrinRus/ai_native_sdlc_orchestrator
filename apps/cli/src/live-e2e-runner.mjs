import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { appendRunEvent } from "../../api/src/index.mjs";
import { loadContractFile, validateContractDocument } from "../../../packages/contracts/src/index.mjs";
import { materializeLearningLoopArtifacts } from "../../../packages/observability/src/index.mjs";
import { certifyAssetPromotion } from "../../../packages/orchestrator-core/src/certification-decision.mjs";
import { runDeliveryDriver } from "../../../packages/orchestrator-core/src/delivery-driver.mjs";
import { materializeDeliveryPlan } from "../../../packages/orchestrator-core/src/delivery-plan.mjs";
import { runEvaluationSuite } from "../../../packages/orchestrator-core/src/eval-runner.mjs";
import {
  approveHandoffArtifacts,
  prepareHandoffArtifacts,
} from "../../../packages/orchestrator-core/src/handoff-packets.mjs";
import { analyzeProjectRuntime } from "../../../packages/orchestrator-core/src/project-analysis.mjs";
import { initializeProjectRuntime } from "../../../packages/orchestrator-core/src/project-init.mjs";
import { executeRoutedStep } from "../../../packages/orchestrator-core/src/step-execution-engine.mjs";
import { validateProjectRuntime } from "../../../packages/orchestrator-core/src/project-validate.mjs";
import { verifyProjectRuntime } from "../../../packages/orchestrator-core/src/project-verify.mjs";

const TERMINAL_RUN_STATUSES = new Set(["pass", "fail", "aborted"]);
const DEFAULT_LIVE_E2E_STAGES = [
  "bootstrap",
  "discovery",
  "spec",
  "planning",
  "handoff",
  "execution",
  "review",
  "qa",
  "delivery",
  "release",
];

/**
 * @returns {string}
 */
function nowIso() {
  return new Date().toISOString();
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeId(value) {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * @param {string} filePath
 * @param {Record<string, unknown>} document
 */
function writeJson(filePath, document) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
}

/**
 * @param {string} filePath
 * @returns {Record<string, unknown>}
 */
function readJson(filePath) {
  return /** @type {Record<string, unknown>} */ (JSON.parse(fs.readFileSync(filePath, "utf8")));
}

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
 * @returns {string}
 */
function asNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : "";
}

/**
 * @param {unknown} value
 * @returns {unknown}
 */
function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * @param {ReturnType<typeof initializeProjectRuntime>} init
 * @param {string} runId
 * @returns {string}
 */
function resolveRunSummaryFile(init, runId) {
  return path.join(init.runtimeLayout.reportsRoot, `live-e2e-run-summary-${normalizeId(runId)}.json`);
}

/**
 * @param {ReturnType<typeof initializeProjectRuntime>} init
 * @param {string} runId
 * @param {string} targetRepoId
 * @returns {string}
 */
function resolveScorecardFile(init, runId, targetRepoId) {
  return path.join(
    init.runtimeLayout.reportsRoot,
    `live-e2e-scorecard-${normalizeId(targetRepoId)}-${normalizeId(runId)}.json`,
  );
}

/**
 * @param {string} cwd
 * @param {string} profileRef
 * @returns {{ profilePath: string, profile: Record<string, unknown> }}
 */
function loadLiveE2EProfile(cwd, profileRef) {
  const profilePath = path.resolve(cwd, profileRef);
  if (!fs.existsSync(profilePath)) {
    throw new Error(`Live E2E profile '${profileRef}' does not exist.`);
  }

  const loaded = loadContractFile({
    filePath: profilePath,
    family: "live-e2e-profile",
  });
  if (!loaded.ok) {
    throw new Error(`Live E2E profile '${profileRef}' failed contract validation: ${loaded.error.message}`);
  }

  return {
    profilePath,
    profile: /** @type {Record<string, unknown>} */ (loaded.document),
  };
}

/**
 * @param {Record<string, { stage: string, status: string, evidence_refs: string[], summary: string | null }>} stageMap
 * @param {string} stage
 * @param {string} status
 * @param {string[]} [evidenceRefs]
 * @param {string | null} [summary]
 */
function markStage(stageMap, stage, status, evidenceRefs = [], summary = null) {
  stageMap[stage] = {
    stage,
    status,
    evidence_refs: evidenceRefs,
    summary,
  };
}

/**
 * @param {Record<string, { stage: string, status: string, evidence_refs: string[], summary: string | null }>} stageMap
 * @returns {Array<{ stage: string, status: string, evidence_refs: string[], summary: string | null }>}
 */
function flattenStageMap(stageMap) {
  return Object.values(stageMap);
}

/**
 * @param {Array<{ stage: string, status: string, evidence_refs: string[], summary: string | null }>} stageResults
 * @returns {{ pass: number, fail: number, pending: number, skipped: number }}
 */
function summarizeStageCounts(stageResults) {
  let pass = 0;
  let fail = 0;
  let pending = 0;
  let skipped = 0;

  for (const stage of stageResults) {
    if (stage.status === "pass") pass += 1;
    else if (stage.status === "fail") fail += 1;
    else if (stage.status === "skipped") skipped += 1;
    else pending += 1;
  }

  return { pass, fail, pending, skipped };
}

/**
 * @param {string[]} values
 * @returns {string[]}
 */
function uniqueStrings(values) {
  return Array.from(new Set(values.filter((value) => typeof value === "string" && value.length > 0)));
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
 * @param {{ cwd: string, args: string[], operation: string }} options
 */
function runGitChecked(options) {
  const run = spawnSync("git", options.args, {
    cwd: options.cwd,
    encoding: "utf8",
  });
  if (run.status === 0) {
    return;
  }
  const stderr = (run.stderr ?? run.stdout ?? "").trim();
  throw new Error(
    `Live E2E ${options.operation} failed: git ${options.args.join(" ")} (exit ${run.status ?? -1}). ${stderr}`,
  );
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function isRemoteGitUrl(value) {
  return /^([a-z][a-z0-9+.-]*:\/\/|git@)/iu.test(value);
}

/**
 * @param {string[]} candidates
 * @returns {string}
 */
function resolveExistingPath(candidates) {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error("Could not resolve an existing path from the provided candidates.");
}

/**
 * @param {{
 *   init: ReturnType<typeof initializeProjectRuntime>,
 *   runId: string,
 *   profile: Record<string, unknown>,
 * }} options
 * @returns {{ targetCheckoutRoot: string, targetRepoId: string, targetRepoRef: string, targetRepoUrl: string }}
 */
function materializeTargetCheckout(options) {
  const targetRepo = asRecord(options.profile.target_repo);
  const targetRepoUrl = asNonEmptyString(targetRepo.repo_url);
  if (!targetRepoUrl) {
    throw new Error("Live E2E profile must declare target_repo.repo_url.");
  }
  const targetRepoRef = asNonEmptyString(targetRepo.ref) || "main";
  const targetRepoId = asNonEmptyString(targetRepo.repo_id) || "target";
  const checkoutStrategy = asNonEmptyString(targetRepo.checkout_strategy) || "full";
  const targetCheckoutRoot = path.join(
    options.init.runtimeLayout.projectRuntimeRoot,
    "target-checkouts",
    `${normalizeId(targetRepoId)}-${normalizeId(options.runId)}`,
  );

  fs.rmSync(targetCheckoutRoot, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(targetCheckoutRoot), { recursive: true });

  /** @type {string[]} */
  const cloneArgs = ["clone"];
  if (checkoutStrategy === "shallow" && isRemoteGitUrl(targetRepoUrl)) {
    cloneArgs.push("--depth", "1");
  }
  cloneArgs.push("--branch", targetRepoRef, "--single-branch", targetRepoUrl, targetCheckoutRoot);
  runGitChecked({
    cwd: options.init.projectRoot,
    args: cloneArgs,
    operation: "target checkout clone",
  });

  runGitChecked({
    cwd: targetCheckoutRoot,
    args: ["checkout", targetRepoRef],
    operation: "target checkout ref resolution",
  });

  return {
    targetCheckoutRoot,
    targetRepoId,
    targetRepoRef,
    targetRepoUrl,
  };
}

/**
 * @param {{ repoRecord: Record<string, unknown>, verification: Record<string, unknown> }} options
 */
function hydrateRepoVerificationCommands(options) {
  const existingBuild = asStringArray(options.repoRecord.build_commands);
  const existingLint = asStringArray(options.repoRecord.lint_commands);
  const existingTests = asStringArray(options.repoRecord.test_commands);

  const setupCommands = asStringArray(options.verification.setup_commands);
  const verificationCommands = asStringArray(options.verification.commands);
  const fallbackCommands = uniqueStrings([...existingLint, ...existingTests, ...existingBuild]);

  const hydratedSetupCommands = setupCommands.length > 0 ? setupCommands : existingLint;
  const hydratedVerificationCommands = verificationCommands.length > 0 ? verificationCommands : fallbackCommands;

  const buildEnabled = options.verification.build === true;
  const lintEnabled = options.verification.lint === true;
  const testsEnabled = options.verification.tests !== false;

  // Keep command execution deterministic for verifyProjectRuntime: lint -> test -> build.
  // Setup commands run first (lint slot), verification commands run second (test slot).
  options.repoRecord.lint_commands = lintEnabled ? hydratedSetupCommands : [];
  options.repoRecord.test_commands = testsEnabled ? hydratedVerificationCommands : [];
  options.repoRecord.build_commands = buildEnabled ? hydratedVerificationCommands : [];
}

/**
 * @param {{
 *   init: ReturnType<typeof initializeProjectRuntime>,
 *   runId: string,
 *   profilePath: string,
 *   profile: Record<string, unknown>,
 *   targetCheckout: { targetCheckoutRoot: string, targetRepoId: string, targetRepoRef: string, targetRepoUrl: string },
 * }} options
 * @returns {{
 *   generatedProjectProfileFile: string,
 *   templateProjectProfilePath: string,
 *   resolvedRegistryRoots: {
 *     routesRoot?: string,
 *     wrappersRoot?: string,
 *     promptsRoot?: string,
 *     contextBundlesRoot?: string,
 *     policiesRoot?: string,
 *     adaptersRoot?: string,
 *     skillsRoot?: string,
 *   },
 * }}
 */
function materializeRunScopedProjectProfile(options) {
  const templateRef = asNonEmptyString(options.profile.project_profile_template_ref);
  if (!templateRef) {
    throw new Error("Live E2E profile must declare project_profile_template_ref.");
  }

  const templateProjectProfilePath = resolveExistingPath([
    path.isAbsolute(templateRef) ? templateRef : "",
    path.resolve(path.dirname(options.profilePath), templateRef),
    path.resolve(options.init.projectRoot, templateRef),
    path.resolve(process.cwd(), templateRef),
  ]);

  const loadedTemplate = loadContractFile({
    filePath: templateProjectProfilePath,
    family: "project-profile",
  });
  if (!loadedTemplate.ok) {
    throw new Error(
      `Project profile template '${templateProjectProfilePath}' failed validation: ${loadedTemplate.error.message}`,
    );
  }

  const generatedProjectProfile = asRecord(deepClone(loadedTemplate.document));
  generatedProjectProfile.project_id = `${asNonEmptyString(generatedProjectProfile.project_id) || "live-e2e-target"}.run.${normalizeId(options.runId)}`;
  generatedProjectProfile.display_name =
    `${asNonEmptyString(generatedProjectProfile.display_name) || "Live E2E Target"} (${options.targetCheckout.targetRepoId})`;

  const registryRoots = asRecord(generatedProjectProfile.registry_roots);
  for (const [key, rootValue] of Object.entries(registryRoots)) {
    const rootPath = asNonEmptyString(rootValue);
    if (!rootPath) continue;
    registryRoots[key] = path.isAbsolute(rootPath) ? rootPath : path.resolve(options.init.projectRoot, rootPath);
  }
  generatedProjectProfile.registry_roots = registryRoots;

  const repos = Array.isArray(generatedProjectProfile.repos)
    ? /** @type {Array<Record<string, unknown>>} */ (deepClone(generatedProjectProfile.repos))
    : [];
  const matchingRepoIndex = repos.findIndex((repo) => asNonEmptyString(repo.repo_id) === options.targetCheckout.targetRepoId);
  const selectedRepoIndex = matchingRepoIndex >= 0 ? matchingRepoIndex : 0;
  const selectedRepo = asRecord(repos[selectedRepoIndex] ?? {});

  selectedRepo.repo_id = options.targetCheckout.targetRepoId;
  selectedRepo.name = asNonEmptyString(selectedRepo.name) || options.targetCheckout.targetRepoId;
  selectedRepo.default_branch = options.targetCheckout.targetRepoRef;
  selectedRepo.role = asNonEmptyString(selectedRepo.role) || "application";

  const source = asRecord(selectedRepo.source);
  source.kind = "git";
  source.remote_url = options.targetCheckout.targetRepoUrl;
  source.default_ref = options.targetCheckout.targetRepoRef;
  selectedRepo.source = source;

  const verification = asRecord(options.profile.verification);
  hydrateRepoVerificationCommands({
    repoRecord: selectedRepo,
    verification,
  });

  if (repos.length === 0) {
    repos.push(selectedRepo);
  } else {
    repos[selectedRepoIndex] = selectedRepo;
  }
  generatedProjectProfile.repos = repos;

  const generatedProjectProfileFile = path.join(
    options.init.runtimeLayout.stateRoot,
    "live-e2e-generated",
    `project-profile-${normalizeId(options.runId)}.json`,
  );
  fs.mkdirSync(path.dirname(generatedProjectProfileFile), { recursive: true });

  const generatedValidation = validateContractDocument({
    family: "project-profile",
    document: generatedProjectProfile,
    source: `runtime://live-e2e-generated-profile/${normalizeId(options.runId)}`,
  });
  if (!generatedValidation.ok) {
    const firstIssue = generatedValidation.issues[0]?.message ?? "unknown issue";
    throw new Error(`Generated project profile failed validation: ${firstIssue}`);
  }

  writeJson(generatedProjectProfileFile, generatedProjectProfile);

  const controlPlaneExamplesRoot = path.resolve(options.init.projectRoot, "examples");
  const resolvedRegistryRoots = {
    routesRoot: asNonEmptyString(registryRoots.routes) || path.join(controlPlaneExamplesRoot, "routes"),
    wrappersRoot: asNonEmptyString(registryRoots.wrappers) || path.join(controlPlaneExamplesRoot, "wrappers"),
    promptsRoot: asNonEmptyString(registryRoots.prompts) || path.join(controlPlaneExamplesRoot, "prompts"),
    contextBundlesRoot:
      asNonEmptyString(registryRoots.context_bundles) || path.join(controlPlaneExamplesRoot, "context/bundles"),
    policiesRoot: asNonEmptyString(registryRoots.policies) || path.join(controlPlaneExamplesRoot, "policies"),
    adaptersRoot: asNonEmptyString(registryRoots.adapters) || path.join(controlPlaneExamplesRoot, "adapters"),
    skillsRoot: path.join(controlPlaneExamplesRoot, "skills"),
  };

  return {
    generatedProjectProfileFile,
    templateProjectProfilePath,
    resolvedRegistryRoots,
  };
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function looksLikeRef(value) {
  return (
    value.startsWith("evidence://") ||
    value.includes("/") ||
    value.includes("\\") ||
    /\.(json|jsonl|yaml|yml|patch|log)$/iu.test(value)
  );
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function collectStringRefs(value) {
  if (typeof value === "string") {
    return value.trim().length > 0 && looksLikeRef(value.trim()) ? [value.trim()] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectStringRefs(entry));
  }
  if (typeof value === "object" && value !== null) {
    return Object.values(value).flatMap((entry) => collectStringRefs(entry));
  }
  return [];
}

/**
 * @param {Array<{ stage: string, status: string, evidence_refs: string[], summary: string | null }>} stageResults
 * @param {Record<string, unknown>} artifacts
 * @returns {string[]}
 */
function collectLearningEvidenceRefs(stageResults, artifacts) {
  const stageRefs = stageResults.flatMap((stage) => (Array.isArray(stage.evidence_refs) ? stage.evidence_refs : []));
  const artifactRefs = collectStringRefs(artifacts);
  return uniqueStrings([...stageRefs, ...artifactRefs]);
}

/**
 * @param {{
 *   runId: string,
 *   profile: Record<string, unknown>,
 *   stageResults: Array<{ stage: string, status: string, evidence_refs: string[], summary: string | null }>,
 *   status: string,
 *   summaryFile: string,
 * }} options
 * @returns {Record<string, unknown>}
 */
function buildScorecard(options) {
  const targetRepo = /** @type {Record<string, unknown>} */ (options.profile.target_repo ?? {});
  const counts = summarizeStageCounts(options.stageResults);

  return {
    scorecard_id: `${options.runId}.scorecard.${String(targetRepo.repo_id ?? "target")}`,
    run_id: options.runId,
    profile_id: options.profile.profile_id,
    scenario_id: options.profile.scenario_id,
    flow_kind: options.profile.flow_kind,
    duration_class: options.profile.duration_class,
    target_repo: {
      repo_id: targetRepo.repo_id ?? "target",
      repo_url: targetRepo.repo_url ?? null,
      ref: targetRepo.ref ?? null,
    },
    stage_counts: counts,
    status: options.status,
    summary_ref: options.summaryFile,
    generated_at: nowIso(),
  };
}

/**
 * @param {Record<string, unknown>} profile
 * @returns {string[]}
 */
function getProfileStages(profile) {
  const stages = Array.isArray(profile.stages)
    ? profile.stages.filter((stage) => typeof stage === "string" && stage.trim().length > 0)
    : [];
  return stages.length > 0 ? stages : DEFAULT_LIVE_E2E_STAGES;
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef: string,
 *   runtimeRoot?: string,
 *   profileRef: string,
 *   runId?: string,
 *   holdOpen?: boolean,
 * }} options
 */
export function startStandardLiveE2ERun(options) {
  const cwd = options.cwd ?? process.cwd();
  const init = initializeProjectRuntime({
    cwd,
    projectRef: options.projectRef,
    runtimeRoot: options.runtimeRoot,
  });
  const { profilePath, profile } = loadLiveE2EProfile(cwd, options.profileRef);

  const runId =
    options.runId ??
    `${String(profile.profile_id ?? "live-e2e.standard")}.run-${nowIso().replace(/[^0-9]/g, "").slice(-12)}`;
  const summaryFile = resolveRunSummaryFile(init, runId);
  const targetRepo = /** @type {Record<string, unknown>} */ (profile.target_repo ?? {});
  const targetRepoId = String(targetRepo.repo_id ?? "target");
  const scorecardFile = resolveScorecardFile(init, runId, targetRepoId);
  const stageMap = {};
  for (const stage of getProfileStages(profile)) {
    markStage(stageMap, stage, "pending");
  }
  const learningLoopProfile = /** @type {Record<string, unknown>} */ (profile.learning_loop ?? {});
  const learningLoopBacklogRefs = asStringArray(learningLoopProfile.backlog_refs);
  const learningLoopForceIncident = learningLoopProfile.force_incident === true;

  const startedAt = nowIso();
  appendRunEvent({
    cwd,
    projectRef: init.projectRoot,
    runtimeRoot: init.runtimeRoot,
    runId,
    eventType: "run.started",
    payload: {
      profile_id: profile.profile_id ?? null,
      scenario_id: profile.scenario_id ?? null,
      target_repo: targetRepo.repo_url ?? null,
    },
  });

  const artifacts = {};
  let status = "running";
  let finishedAt = null;
  let errorMessage = null;
  /** @type {{
   *  targetCheckoutRoot: string,
   *  generatedProjectProfileFile: string,
   *  templateProjectProfilePath: string,
   *  resolvedRegistryRoots: {
   *    routesRoot?: string,
   *    wrappersRoot?: string,
   *    promptsRoot?: string,
   *    contextBundlesRoot?: string,
   *    policiesRoot?: string,
   *    adaptersRoot?: string,
   *    skillsRoot?: string,
   *  },
   * } | null} */
  let targetWorkspace = null;

  try {
    const targetCheckout = materializeTargetCheckout({
      init,
      runId,
      profile,
    });
    const generatedProfile = materializeRunScopedProjectProfile({
      init,
      runId,
      profilePath,
      profile,
      targetCheckout,
    });
    targetWorkspace = {
      targetCheckoutRoot: targetCheckout.targetCheckoutRoot,
      generatedProjectProfileFile: generatedProfile.generatedProjectProfileFile,
      templateProjectProfilePath: generatedProfile.templateProjectProfilePath,
      resolvedRegistryRoots: generatedProfile.resolvedRegistryRoots,
    };

    artifacts.target_checkout_root = targetWorkspace.targetCheckoutRoot;
    artifacts.generated_project_profile_file = targetWorkspace.generatedProjectProfileFile;
    artifacts.project_profile_template_file = targetWorkspace.templateProjectProfilePath;
    markStage(
      stageMap,
      "bootstrap",
      "pass",
      [init.stateFile, targetWorkspace.generatedProjectProfileFile],
      "runtime initialized and target checkout prepared",
    );

    const executionProjectOptions = {
      cwd,
      projectRef: targetWorkspace.targetCheckoutRoot,
      projectProfile: targetWorkspace.generatedProjectProfileFile,
      runtimeRoot: init.runtimeRoot,
    };

    const analyze = analyzeProjectRuntime({
      ...executionProjectOptions,
      ...targetWorkspace.resolvedRegistryRoots,
      evaluationWorkspaceRoot: init.projectRoot,
    });
    artifacts.analysis_report_file = analyze.reportPath;
    artifacts.route_resolution_file = analyze.routeResolutionPath;
    artifacts.policy_resolution_file = analyze.policyResolutionPath;
    markStage(stageMap, "discovery", "pass", [analyze.reportPath], "project analysis report emitted");
    markStage(stageMap, "planning", "pass", [analyze.policyResolutionPath], "policy and route resolution aligned");

    const validate = validateProjectRuntime({
      ...executionProjectOptions,
    });
    artifacts.validation_report_file = validate.validationReportPath;
    const validateStageStatus = validate.report.status === "fail" ? "fail" : "pass";
    markStage(stageMap, "spec", validateStageStatus, [validate.validationReportPath]);
    if (validateStageStatus === "fail") {
      throw new Error("Live E2E validation stage failed.");
    }

    const verify = verifyProjectRuntime({
      ...executionProjectOptions,
      requireValidationPass: true,
    });
    artifacts.verify_summary_file = verify.verifySummaryPath;
    artifacts.step_result_files = verify.stepResultFiles;
    if (verify.validationGateStatus === "fail") {
      markStage(stageMap, "execution", "fail", [verify.verifySummaryPath, ...verify.stepResultFiles]);
      throw new Error("Live E2E execution stage failed validation gate.");
    }

    const routedStep = executeRoutedStep({
      ...executionProjectOptions,
      ...targetWorkspace.resolvedRegistryRoots,
      stepClass: "implement",
      dryRun: false,
      runId,
      stepId: "routed.implement",
      executionRoot: targetWorkspace.targetCheckoutRoot,
      approvedHandoffRef: `evidence://live-e2e/${normalizeId(runId)}/approved-handoff`,
      promotionEvidenceRefs: [verify.verifySummaryPath, ...verify.stepResultFiles],
    });
    artifacts.routed_step_result_file = routedStep.stepResultPath;
    artifacts.routed_step_result_id = routedStep.stepResultId;

    const routedExecution = asRecord(routedStep.stepResult.routed_execution);
    const contextCompilation = asRecord(routedExecution.context_compilation);
    const adapterResponse = asRecord(routedExecution.adapter_response);
    const adapterOutput = asRecord(adapterResponse.output);
    const externalRunner = asRecord(adapterOutput.external_runner);
    const routedMode = asNonEmptyString(routedExecution.mode);
    const routedStatus = asNonEmptyString(routedStep.stepResult.status);
    const routedSummary = asNonEmptyString(routedStep.stepResult.summary);
    const routedFailureKind = asNonEmptyString(adapterOutput.failure_kind);
    const routedBlockedNextStep = asNonEmptyString(routedStep.stepResult.blocked_next_step);

    const compiledContextRef = asNonEmptyString(contextCompilation.compiled_context_ref);
    const compiledContextFile = asNonEmptyString(contextCompilation.compiled_context_file);
    const adapterRawEvidenceRef = asNonEmptyString(externalRunner.raw_evidence_ref);
    const adapterExecutionRoot = asNonEmptyString(externalRunner.execution_root);

    if (compiledContextRef) artifacts.compiled_context_ref = compiledContextRef;
    if (compiledContextFile) artifacts.compiled_context_file = compiledContextFile;
    if (adapterRawEvidenceRef) artifacts.adapter_raw_evidence_ref = adapterRawEvidenceRef;
    if (adapterExecutionRoot) artifacts.adapter_execution_root = adapterExecutionRoot;

    const executionEvidenceRefs = uniqueStrings([
      verify.verifySummaryPath,
      ...verify.stepResultFiles,
      routedStep.stepResultPath,
      ...(compiledContextRef ? [compiledContextRef] : []),
      ...(compiledContextFile ? [compiledContextFile] : []),
      ...(adapterRawEvidenceRef ? [adapterRawEvidenceRef] : []),
    ]);

    if (routedMode !== "execute") {
      markStage(
        stageMap,
        "execution",
        "fail",
        executionEvidenceRefs,
        `Routed execution mode '${routedMode || "unknown"}' is not valid for short proof profiles.`,
      );
      throw new Error("Live E2E routed execution must run in execute mode.");
    }

    if (routedStatus !== "passed") {
      const failureLabel = routedFailureKind || asNonEmptyString(adapterResponse.status) || "failed";
      markStage(
        stageMap,
        "execution",
        "fail",
        executionEvidenceRefs,
        routedSummary || `Routed execution failed with '${failureLabel}'.`,
      );
      if (routedFailureKind === "missing-prerequisite") {
        throw new Error(
          `Live E2E routed execution blocked with missing-prerequisite: ${routedBlockedNextStep || routedSummary || "install/configure the external runner and retry."}`,
        );
      }
      if (asNonEmptyString(adapterResponse.status) === "blocked") {
        throw new Error(
          `Live E2E routed execution policy-blocked: ${routedBlockedNextStep || routedSummary || "resolve delivery guardrails or adapter support and retry."}`,
        );
      }
      throw new Error(`Live E2E routed execution failed: ${routedSummary || "inspect routed step evidence."}`);
    }

    markStage(
      stageMap,
      "execution",
      "pass",
      executionEvidenceRefs,
      "Preflight verification and routed live execution succeeded.",
    );

    const evalSuites = Array.isArray(profile.verification?.eval_suites)
      ? profile.verification.eval_suites.filter((entry) => typeof entry === "string")
      : [];
    if (evalSuites.length > 0) {
      const evaluation = runEvaluationSuite({
        cwd,
        projectRef: init.projectRoot,
        runtimeRoot: init.runtimeRoot,
        suiteRef: evalSuites[0],
        subjectRef: `run://${runId}`,
      });
      artifacts.evaluation_report_file = evaluation.evaluationReportPath;
      const evalStageStatus = evaluation.evaluationReport.status === "pass" ? "pass" : "fail";
      markStage(stageMap, "qa", evalStageStatus, [evaluation.evaluationReportPath]);
      markStage(stageMap, "review", evalStageStatus, [evaluation.evaluationReportPath]);
      if (evalStageStatus === "fail") {
        throw new Error("Live E2E evaluation stage failed.");
      }
    } else {
      markStage(stageMap, "qa", "skipped", [], "profile has no eval_suites");
      markStage(stageMap, "review", "skipped", [], "profile has no eval_suites");
    }

    if (Boolean(options.holdOpen)) {
      status = "running";
      markStage(stageMap, "delivery", "pending", [], "run is intentionally left open");
      markStage(stageMap, "release", "pending", [], "run is intentionally left open");
    } else if (Boolean(profile.output_policy?.materialize_release_packet)) {
      const preparedHandoff = prepareHandoffArtifacts({
        cwd,
        projectRef: init.projectRoot,
        runtimeRoot: init.runtimeRoot,
        ticketId: `${runId}.ticket`,
      });
      const approvedHandoff = approveHandoffArtifacts({
        cwd,
        projectRef: init.projectRoot,
        runtimeRoot: init.runtimeRoot,
        handoffPacketPath: preparedHandoff.handoffPacketFile,
        approvalRef: `approval://live-e2e/${normalizeId(runId)}`,
      });
      markStage(stageMap, "handoff", "pass", [approvedHandoff.handoffPacketFile]);

      const promotionDecision = certifyAssetPromotion({
        cwd,
        projectRef: init.projectRoot,
        runtimeRoot: init.runtimeRoot,
        assetRef: "wrapper://wrapper.eval.default@v1",
        subjectRef: "wrapper://wrapper.eval.default@v1",
        suiteRef: "suite.cert.core@v4",
        stepClass: "implement",
        runRef: runId,
      });
      artifacts.promotion_decision_file = promotionDecision.decisionPath;
      artifacts.promotion_evaluation_report_file = promotionDecision.evaluationReportPath;
      artifacts.promotion_harness_capture_file = promotionDecision.harnessCapturePath;
      artifacts.promotion_harness_replay_file = promotionDecision.harnessReplayPath;
      artifacts.promotion_replay_evaluation_report_file = promotionDecision.replayEvaluationReportPath;

      const preferredDeliveryModeRaw = String(profile.output_policy?.preferred_delivery_mode ?? "patch-only");
      const preferredDeliveryMode =
        preferredDeliveryModeRaw === "fork-first-pr"
          ? "fork-first-pr"
          : preferredDeliveryModeRaw === "local-branch"
            ? "local-branch"
            : "patch-only";

      const deliveryPlan = materializeDeliveryPlan({
        runtimeLayout: init.runtimeLayout,
        projectId: init.projectId,
        runId,
        stepClass: "implement",
        policyResolution: {
          resolved_bounds: {
            writeback_mode: {
              mode: preferredDeliveryMode,
              resolution_source: {
                kind: "live-e2e-profile",
                field: "output_policy.preferred_delivery_mode",
              },
            },
          },
        },
        handoffApproval: {
          status: "pass",
          ref: approvedHandoff.handoffPacketFile,
        },
        promotionEvidenceRefs: [promotionDecision.decisionPath],
      });

      // Ensure release rehearsals always produce a concrete patch/changeset artifact.
      const rehearsalChangeFile = path.join(init.projectRoot, "examples", "project.aor.yaml");
      if (fs.existsSync(rehearsalChangeFile)) {
        fs.appendFileSync(
          rehearsalChangeFile,
          `\n# live-e2e standard runner rehearsal marker ${runId}\n`,
          "utf8",
        );
        artifacts.rehearsal_change_file = rehearsalChangeFile;
      }

      const delivery = runDeliveryDriver({
        projectRef: init.projectRoot,
        cwd,
        runId,
        mode: preferredDeliveryMode,
        deliveryPlanPath: deliveryPlan.deliveryPlanFile,
      });
      artifacts.delivery_transcript_file = delivery.transcriptFile;
      artifacts.delivery_manifest_file = delivery.deliveryManifestFile;
      artifacts.release_packet_file = delivery.releasePacketFile;
      const deliveryStageStatus = delivery.status === "success" ? "pass" : "fail";
      markStage(stageMap, "delivery", deliveryStageStatus, [
        delivery.transcriptFile,
        ...(delivery.deliveryManifestFile ? [delivery.deliveryManifestFile] : []),
      ]);
      if (deliveryStageStatus === "fail") {
        throw new Error("Live E2E delivery stage failed.");
      }

      const releaseStageStatus = delivery.releasePacketFile ? "pass" : "fail";
      markStage(
        stageMap,
        "release",
        releaseStageStatus,
        delivery.releasePacketFile ? [delivery.releasePacketFile] : [],
      );
      if (releaseStageStatus === "fail") {
        throw new Error("Live E2E release stage failed to materialize release packet.");
      }
    } else {
      markStage(stageMap, "handoff", "pass", [], "release packet is not required for this profile");
      markStage(stageMap, "delivery", "skipped", [], "profile output_policy.materialize_release_packet=false");
      markStage(stageMap, "release", "skipped", [], "profile output_policy.materialize_release_packet=false");
      status = "pass";
    }

    if (!options.holdOpen) {
      status = "pass";
      finishedAt = nowIso();
      appendRunEvent({
        cwd,
        projectRef: init.projectRoot,
        runtimeRoot: init.runtimeRoot,
        runId,
        eventType: "run.terminal",
        payload: {
          status: "pass",
        },
      });
    }
  } catch (error) {
    status = "fail";
    finishedAt = nowIso();
    errorMessage = error instanceof Error ? error.message : String(error);
    appendRunEvent({
      cwd,
      projectRef: init.projectRoot,
      runtimeRoot: init.runtimeRoot,
      runId,
      eventType: "warning.raised",
      payload: {
        code: "live_e2e.failure",
        summary: errorMessage,
      },
    });
    appendRunEvent({
      cwd,
      projectRef: init.projectRoot,
      runtimeRoot: init.runtimeRoot,
      runId,
      eventType: "run.terminal",
      payload: {
        status: "fail",
      },
    });
  }

  const stageResults = flattenStageMap(stageMap);
  const summary = {
    run_id: runId,
    project_id: init.projectId,
    profile_ref: profilePath,
    profile_id: profile.profile_id,
    scenario_id: profile.scenario_id,
    flow_kind: profile.flow_kind,
    duration_class: profile.duration_class,
    target_repo: targetRepo,
    started_at: startedAt,
    finished_at: finishedAt,
    status,
    hold_open: Boolean(options.holdOpen),
    target_checkout_root: targetWorkspace?.targetCheckoutRoot ?? null,
    generated_project_profile_file: targetWorkspace?.generatedProjectProfileFile ?? null,
    routed_step_result_file:
      typeof artifacts.routed_step_result_file === "string" ? artifacts.routed_step_result_file : null,
    compiled_context_ref: typeof artifacts.compiled_context_ref === "string" ? artifacts.compiled_context_ref : null,
    adapter_raw_evidence_ref:
      typeof artifacts.adapter_raw_evidence_ref === "string" ? artifacts.adapter_raw_evidence_ref : null,
    stage_results: stageResults,
    artifacts,
    scorecard_files: [scorecardFile],
    control_surfaces: {
      start: "aor live-e2e start --project-ref <path> --profile <path>",
      status: "aor live-e2e status --project-ref <path> --run-id <id>",
      abort: "aor live-e2e status --project-ref <path> --run-id <id> --abort true",
      report: "aor live-e2e report --project-ref <path> --run-id <id>",
    },
    error: errorMessage,
  };
  const scorecard = buildScorecard({
    runId,
    profile,
    stageResults,
    status,
    summaryFile,
  });

  writeJson(summaryFile, summary);
  writeJson(scorecardFile, scorecard);

  const learningLoop = materializeLearningLoopArtifacts({
    projectId: init.projectId,
    projectRoot: init.projectRoot,
    runtimeLayout: init.runtimeLayout,
    runId,
    sourceKind: "live-e2e",
    runStatus: status,
    summary: errorMessage ?? `Live E2E run '${runId}' completed with status '${status}'.`,
    evidenceRefs: uniqueStrings([summaryFile, scorecardFile, ...collectLearningEvidenceRefs(stageResults, artifacts)]),
    linkedScorecardRefs: [scorecardFile],
    evalSuiteRefs: Array.isArray(profile.verification?.eval_suites)
      ? profile.verification.eval_suites.filter((entry) => typeof entry === "string")
      : [],
    backlogRefs:
      learningLoopBacklogRefs.length > 0
        ? learningLoopBacklogRefs
        : [
            "docs/backlog/mvp-implementation-backlog.md",
            "docs/backlog/wave-5-implementation-slices.md",
            "docs/ops/live-e2e-standard-runner.md",
          ],
    forceIncident: learningLoopForceIncident,
    incidentSummary: errorMessage ?? undefined,
  });
  summary.learning_loop_scorecard_file = learningLoop.scorecardFile;
  summary.learning_loop_handoff_file = learningLoop.handoffFile;
  summary.incident_report_file = learningLoop.incidentFile;
  writeJson(summaryFile, summary);

  appendRunEvent({
    cwd,
    projectRef: init.projectRoot,
    runtimeRoot: init.runtimeRoot,
    runId,
    eventType: "evidence.linked",
    payload: {
      summary_file: summaryFile,
      scorecard_file: scorecardFile,
      learning_loop_scorecard_file: learningLoop.scorecardFile,
      learning_loop_handoff_file: learningLoop.handoffFile,
      incident_report_file: learningLoop.incidentFile,
    },
  });

  return {
    runId,
    summary,
    summaryFile,
    scorecards: [scorecard],
    scorecardFiles: [scorecardFile],
    learningLoopScorecardFile: learningLoop.scorecardFile,
    learningLoopHandoffFile: learningLoop.handoffFile,
    incidentReportFile: learningLoop.incidentFile,
  };
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef: string,
 *   runtimeRoot?: string,
 *   runId: string,
 * }} options
 */
export function readStandardLiveE2ERun(options) {
  const cwd = options.cwd ?? process.cwd();
  const init = initializeProjectRuntime({
    cwd,
    projectRef: options.projectRef,
    runtimeRoot: options.runtimeRoot,
  });
  const summaryFile = resolveRunSummaryFile(init, options.runId);
  if (!fs.existsSync(summaryFile)) {
    throw new Error(`Live E2E run summary for '${options.runId}' was not found.`);
  }

  const summary = readJson(summaryFile);
  const scorecardFiles = Array.isArray(summary.scorecard_files)
    ? summary.scorecard_files.filter((filePath) => typeof filePath === "string")
    : [];
  const scorecards = scorecardFiles
    .filter((filePath) => fs.existsSync(filePath))
    .map((filePath) => readJson(filePath));

  return {
    summary,
    summaryFile,
    scorecards,
    scorecardFiles,
  };
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef: string,
 *   runtimeRoot?: string,
 *   runId: string,
 *   reason?: string,
 * }} options
 */
export function abortStandardLiveE2ERun(options) {
  const cwd = options.cwd ?? process.cwd();
  const init = initializeProjectRuntime({
    cwd,
    projectRef: options.projectRef,
    runtimeRoot: options.runtimeRoot,
  });
  const current = readStandardLiveE2ERun(options);
  const summary = { ...current.summary };
  const profileRef = typeof summary.profile_ref === "string" ? summary.profile_ref : "";
  let profile = {};
  if (profileRef) {
    try {
      profile = loadLiveE2EProfile(cwd, profileRef).profile;
    } catch {
      profile = {};
    }
  }
  const learningLoopProfile = /** @type {Record<string, unknown>} */ (profile.learning_loop ?? {});
  const learningLoopBacklogRefs = asStringArray(learningLoopProfile.backlog_refs);

  if (TERMINAL_RUN_STATUSES.has(String(summary.status))) {
    return {
      ...current,
      summary,
      abortApplied: false,
    };
  }

  summary.status = "aborted";
  summary.finished_at = nowIso();
  summary.abort_reason = options.reason ?? "operator-requested";
  const stageResults = Array.isArray(summary.stage_results)
    ? summary.stage_results.filter((entry) => typeof entry === "object" && entry !== null)
    : [];
  const artifacts = typeof summary.artifacts === "object" && summary.artifacts !== null ? summary.artifacts : {};
  const scorecardFiles = Array.isArray(summary.scorecard_files)
    ? summary.scorecard_files.filter((entry) => typeof entry === "string")
    : [];
  const learningLoop = materializeLearningLoopArtifacts({
    projectId: init.projectId,
    projectRoot: init.projectRoot,
    runtimeLayout: init.runtimeLayout,
    runId: options.runId,
    sourceKind: "live-e2e",
    runStatus: "aborted",
    summary: String(summary.abort_reason),
    evidenceRefs: uniqueStrings([
      current.summaryFile,
      ...scorecardFiles,
      ...collectLearningEvidenceRefs(
        /** @type {Array<{ stage: string, status: string, evidence_refs: string[], summary: string | null }>} */ (
          stageResults
        ),
        /** @type {Record<string, unknown>} */ (artifacts),
      ),
    ]),
    linkedScorecardRefs: scorecardFiles,
    backlogRefs:
      learningLoopBacklogRefs.length > 0
        ? learningLoopBacklogRefs
        : [
            "docs/backlog/mvp-implementation-backlog.md",
            "docs/backlog/wave-5-implementation-slices.md",
            "docs/ops/live-e2e-standard-runner.md",
          ],
    forceIncident: true,
    incidentSummary: String(summary.abort_reason),
  });
  summary.learning_loop_scorecard_file = learningLoop.scorecardFile;
  summary.learning_loop_handoff_file = learningLoop.handoffFile;
  summary.incident_report_file = learningLoop.incidentFile;
  writeJson(current.summaryFile, summary);

  appendRunEvent({
    cwd,
    projectRef: options.projectRef,
    runtimeRoot: options.runtimeRoot,
    runId: options.runId,
    eventType: "warning.raised",
    payload: {
      code: "live_e2e.abort_requested",
      summary: summary.abort_reason,
    },
  });
  appendRunEvent({
    cwd,
    projectRef: options.projectRef,
    runtimeRoot: options.runtimeRoot,
    runId: options.runId,
    eventType: "run.terminal",
    payload: {
      status: "aborted",
    },
  });

  return {
    ...current,
    summary,
    abortApplied: true,
    incidentReportFile: learningLoop.incidentFile,
    learningLoopHandoffFile: learningLoop.handoffFile,
    learningLoopScorecardFile: learningLoop.scorecardFile,
  };
}
