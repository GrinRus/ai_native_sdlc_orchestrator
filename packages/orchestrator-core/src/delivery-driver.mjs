import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { loadContractFile, validateContractDocument } from "../../contracts/src/index.mjs";
import { materializeLearningLoopArtifacts } from "../../observability/src/index.mjs";

import { runDeliveryMode } from "./delivery-mode-runners.mjs";
import { initializeProjectRuntime } from "./project-init.mjs";
import { classifyChangedPathsByRepo } from "./repo-scope.mjs";
import { assertExactDeliveryDiff } from "./delivery-integrity.mjs";
import { runTransactionCoordinator } from "./verification-delivery-transactions.mjs";

const SUPPORTED_DELIVERY_MODES = new Set(["no-write", "patch-only", "local-branch", "fork-first-pr"]);

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function asRecord(value) {
  return typeof value === "object" && value !== null ? /** @type {Record<string, unknown>} */ (value) : {};
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
  return Array.from(new Set(values.filter((value) => typeof value === "string" && value.length > 0)));
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeChangedPath(value) {
  return value.trim().replace(/\\/g, "/").replace(/^\.\//u, "");
}

/**
 * @param {string} value
 * @param {string} executionRoot
 * @returns {string | null}
 */
function normalizeExpectedChangedPath(value, executionRoot) {
  const normalized = normalizeChangedPath(value);
  if (!normalized) {
    return null;
  }
  if (!path.isAbsolute(normalized)) {
    return normalized;
  }

  const relative = path.relative(executionRoot, normalized).replace(/\\/g, "/");
  if (!relative || relative.startsWith("../")) {
    return normalized;
  }
  return normalizeChangedPath(relative);
}

/**
 * @param {Record<string, unknown>} deliveryPlan
 * @param {string} executionRoot
 * @returns {string[]}
 */
function resolveExpectedMeaningfulChangedPaths(deliveryPlan, executionRoot) {
  const runtimeHarness = asRecord(asRecord(deliveryPlan.preconditions).runtime_harness);
  return uniqueStrings(
    asStringArray(runtimeHarness.meaningful_changed_paths)
      .map((changedPath) => normalizeExpectedChangedPath(changedPath, executionRoot))
      .filter((changedPath) => typeof changedPath === "string"),
  );
}

/**
 * @param {{
 *   mode: string,
 *   expectedMeaningfulChangedPaths: string[],
 *   changedPaths: string[],
 * }} options
 * @returns {string[]}
 */
function findMissingExpectedChangedPaths(options) {
  if (options.mode === "no-write" || options.expectedMeaningfulChangedPaths.length === 0) {
    return [];
  }

  const changedPathSet = new Set(options.changedPaths.map((changedPath) => normalizeChangedPath(changedPath)));
  return options.expectedMeaningfulChangedPaths.filter((changedPath) => !changedPathSet.has(changedPath));
}

/**
 * @param {Record<string, unknown>} coordination
 * @param {string[]} repoIds
 * @returns {Array<{ repo_id: string, role: string | null, default_branch: string | null, source_root: string | null, source_kind: string | null }>}
 */
function resolveCoordinationRepos(coordination, repoIds) {
  const repos = Array.isArray(coordination.repos)
    ? coordination.repos
        .filter((entry) => typeof entry === "object" && entry !== null)
        .map((entry) => {
          const repo = asRecord(entry);
          return {
            repo_id: asString(repo.repo_id),
            role: asString(repo.role),
            default_branch: asString(repo.default_branch),
            source_root: asString(repo.source_root),
            source_kind: asString(repo.source_kind),
          };
        })
        .filter((repo) => typeof repo.repo_id === "string")
    : [];

  if (repos.length > 0) {
    return /** @type {Array<{ repo_id: string, role: string | null, default_branch: string | null, source_root: string | null, source_kind: string | null }>} */ (repos);
  }

  return repoIds.map((repoId) => ({
    repo_id: repoId,
    role: null,
    default_branch: null,
    source_root: repoId === "main" ? "." : null,
    source_kind: null,
  }));
}

/**
 * @param {{ files?: Array<{ path?: string, added?: number, deleted?: number }> }} diffStats
 * @param {string[]} changedPaths
 * @returns {{ files: number, added: number, deleted: number }}
 */
function summarizeDiffTotalsForPaths(diffStats, changedPaths) {
  const pathSet = new Set(changedPaths);
  const files = Array.isArray(diffStats.files)
    ? diffStats.files.filter((entry) => typeof entry.path === "string" && pathSet.has(entry.path))
    : [];

  return files.reduce(
    (acc, entry) => ({
      files: acc.files + 1,
      added: acc.added + (typeof entry.added === "number" ? entry.added : 0),
      deleted: acc.deleted + (typeof entry.deleted === "number" ? entry.deleted : 0),
    }),
    { files: 0, added: 0, deleted: 0 },
  );
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeForId(value) {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * @param {{ cwd: string, args: string[] }} options
 * @returns {{ stdout: string, stderr: string, status: number | null }}
 */
function runGit(options) {
  const run = spawnSync("git", options.args, {
    cwd: options.cwd,
    encoding: "utf8",
  });
  return {
    stdout: run.stdout ?? "",
    stderr: run.stderr ?? "",
    status: run.status,
  };
}

/**
 * @param {{ cwd: string, args: string[] }} options
 * @returns {string}
 */
function runGitChecked(options) {
  const run = runGit(options);
  if (run.status !== 0) {
    const command = `git ${options.args.join(" ")}`;
    throw new Error(`${command} failed (exit ${String(run.status)}): ${run.stderr.trim() || run.stdout.trim()}`);
  }
  return run.stdout;
}

/**
 * @param {string} cwd
 * @returns {{ branch: string, commit: string }}
 */
function readGitHead(cwd) {
  const branch = runGitChecked({ cwd, args: ["rev-parse", "--abbrev-ref", "HEAD"] }).trim();
  const commit = runGitChecked({ cwd, args: ["rev-parse", "HEAD"] }).trim();
  return {
    branch,
    commit,
  };
}

/**
 * @param {string} projectRoot
 * @param {string} filePath
 * @returns {string}
 */
function toEvidenceRef(projectRoot, filePath) {
  const relative = path.relative(projectRoot, filePath).replace(/\\/g, "/");
  if (!relative || relative.startsWith("../")) {
    return `evidence://${filePath}`;
  }
  return `evidence://${relative}`;
}

/**
 * @param {string[]} refs
 * @returns {{
 *   handoffRefs: string[],
 *   promotionRefs: string[],
 *   executionRefs: string[],
 *   otherRefs: string[],
 * }}
 */
function classifyEvidenceRefs(refs) {
  /** @type {string[]} */
  const handoffRefs = [];
  /** @type {string[]} */
  const promotionRefs = [];
  /** @type {string[]} */
  const executionRefs = [];
  /** @type {string[]} */
  const otherRefs = [];

  for (const ref of refs) {
    const normalized = ref.toLowerCase();
    if (normalized.includes("handoff")) {
      handoffRefs.push(ref);
      continue;
    }
    if (normalized.includes("promotion")) {
      promotionRefs.push(ref);
      continue;
    }
    if (normalized.includes("step-result") || normalized.includes("delivery-transcript")) {
      executionRefs.push(ref);
      continue;
    }
    otherRefs.push(ref);
  }

  return {
    handoffRefs: uniqueStrings(handoffRefs),
    promotionRefs: uniqueStrings(promotionRefs),
    executionRefs: uniqueStrings(executionRefs),
    otherRefs: uniqueStrings(otherRefs),
  };
}

function verifyLockedDeliveryEvidence(deliveryPlan, projectRoot) {
  const preconditions = asRecord(deliveryPlan.preconditions);
  const handoffRef = asString(asRecord(preconditions.approved_handoff).ref);
  const promotionRefs = asStringArray(asRecord(preconditions.promotion_evidence).refs);
  const runtimeHarness = asRecord(preconditions.runtime_harness);
  const runtimeHarnessRef = runtimeHarness.required === true && runtimeHarness.enforced === true
    ? asString(runtimeHarness.report_ref)
    : null;
  const locks = Array.isArray(deliveryPlan.evidence_locks) ? deliveryPlan.evidence_locks.map(asRecord) : [];
  for (const [ref, declaredFamily] of [
    ...(handoffRef ? [[handoffRef, "handoff-packet"]] : []),
    ...promotionRefs.map((ref) => [ref, null]),
    ...(runtimeHarnessRef ? [[runtimeHarnessRef, "runtime-harness-report"]] : []),
  ]) {
    const lock = locks.find((entry) => asString(entry.ref) === ref);
    if (!lock || asString(lock.status) !== "locked" || !asString(lock.sha256)) {
      throw new Error(`Delivery evidence '${ref}' is not locked by the plan.`);
    }
    const candidate = asString(lock.resolved_path) ??
      (ref.startsWith("evidence://") ? ref.slice("evidence://".length) : ref);
    const filePath = path.isAbsolute(candidate) ? candidate : path.resolve(projectRoot, candidate);
    const digest = createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
    if (digest !== lock.sha256) {
      throw new Error(`Delivery evidence '${ref}' changed after plan authorization.`);
    }
    const candidateFamilies = declaredFamily
      ? [declaredFamily]
      : ["promotion-decision", "review-decision", "evaluation-report", "step-result"];
    const loadedCandidates = candidateFamilies.map((family) => ({ family, loaded: loadContractFile({ filePath, family }) }));
    const match = loadedCandidates.find((entry) => entry.loaded.ok);
    if (!match) throw new Error(`Delivery evidence '${ref}' does not match an allowed authorization contract family.`);
    const { family, loaded } = match;
    const document = asRecord(loaded.document);
    if (family === "handoff-packet" && asString(document.project_id) !== asString(deliveryPlan.project_id)) {
      throw new Error(`Delivery handoff evidence '${ref}' belongs to a different project.`);
    }
    if (family === "handoff-packet" && asString(document.status) !== "approved") {
      throw new Error(`Delivery handoff evidence '${ref}' is not approved.`);
    }
    if (family === "promotion-decision" && asString(document.status) !== "pass") {
      throw new Error(`Delivery promotion evidence '${ref}' is not pass-level.`);
    }
    if (family === "review-decision" && (asString(document.decision) !== "approve" ||
        asString(asRecord(document.delivery_gate).status) !== "pass")) {
      throw new Error(`Delivery review evidence '${ref}' is not approved for delivery.`);
    }
    if (family === "evaluation-report" && (asString(document.status) !== "pass" ||
        asString(document.subject_ref) !== `run://${asString(deliveryPlan.run_id)}`)) {
      throw new Error(`Delivery evaluation evidence '${ref}' is not pass-level evidence for the requested run.`);
    }
    if (family === "step-result" && asString(document.status) !== "passed") {
      throw new Error(`Delivery step evidence '${ref}' is not pass-level.`);
    }
    if (family === "runtime-harness-report") {
      const runDecision = asRecord(document.run_decision);
      const missionLineage = asRecord(document.mission_lineage);
      const meaningfulPaths = (Array.isArray(document.step_decisions) ? document.step_decisions : [])
        .flatMap((step) => asStringArray(asRecord(asRecord(step).mission_semantics).meaningful_changed_paths));
      if (asString(document.project_id) !== asString(deliveryPlan.project_id) ||
          asString(document.run_id) !== asString(deliveryPlan.run_id) ||
          asString(document.overall_decision) !== "pass" || asString(runDecision.overall_decision) !== "pass" ||
          asString(runDecision.terminal_status) !== "closed" || !Array.isArray(document.step_decisions) ||
          document.step_decisions.length === 0 || asString(missionLineage.status) !== "resolved" ||
          asString(missionLineage.strictness_profile) === "unknown" || meaningfulPaths.length === 0) {
        throw new Error(`Delivery Runtime Harness evidence '${ref}' does not prove a pass-level run controller decision.`);
      }
    }
  }
}

/**
 * @param {{
 *   deliveryPlanPath?: string,
 *   deliveryPlan?: Record<string, unknown>,
 * }} options
 * @returns {{ deliveryPlan: Record<string, unknown>, deliveryPlanPath: string }}
 */
function loadDeliveryPlan(options) {
  if (options.deliveryPlanPath) {
    const loaded = loadContractFile({
      filePath: options.deliveryPlanPath,
      family: "delivery-plan",
    });
    if (!loaded.ok) {
      const issues = loaded.validation.issues.map((issue) => issue.message).join("; ");
      throw new Error(`Delivery plan '${options.deliveryPlanPath}' failed contract validation: ${issues}`);
    }

    return {
      deliveryPlan: asRecord(loaded.document),
      deliveryPlanPath: options.deliveryPlanPath,
    };
  }

  if (options.deliveryPlan) {
    const validation = validateContractDocument({
      family: "delivery-plan",
      document: options.deliveryPlan,
      source: "runtime://delivery-plan-input",
    });
    if (!validation.ok) {
      const issues = validation.issues.map((issue) => issue.message).join("; ");
      throw new Error(`Inline delivery plan failed contract validation: ${issues}`);
    }

    return {
      deliveryPlan: asRecord(options.deliveryPlan),
      deliveryPlanPath: "runtime://delivery-plan-input",
    };
  }

  throw new Error("Delivery driver requires '--delivery-plan' input (path or in-memory document).");
}

/**
 * @param {Record<string, unknown>} deliveryPlan
 * @param {string | undefined} requestedMode
 * @returns {"no-write" | "patch-only" | "local-branch" | "fork-first-pr"}
 */
function resolveDeliveryMode(deliveryPlan, requestedMode) {
  const status = asString(deliveryPlan.status);
  if (status !== "ready") {
    throw new Error(
      `Delivery plan status '${String(deliveryPlan.status)}' is not ready. Resolve blocking reasons before write-back.`,
    );
  }

  const mode = asString(deliveryPlan.delivery_mode);
  if (!mode || !SUPPORTED_DELIVERY_MODES.has(mode)) {
    throw new Error(
      `Delivery mode '${String(deliveryPlan.delivery_mode)}' is not supported in this slice. Expected one of: no-write, patch-only, local-branch, fork-first-pr.`,
    );
  }

  const schemaVersion = deliveryPlan.schema_version ?? 1;
  if (mode !== "no-write" && schemaVersion !== 2) {
    throw new Error("Write-capable delivery plan v1 is not supported; migrate the plan to schema_version 2.");
  }
  if (schemaVersion === 2) {
    const permissions = asRecord(deliveryPlan.permissions);
    if (permissions.execution_allowed !== true) {
      throw new Error("Delivery plan v2 does not grant execution permission.");
    }
    if (mode === "local-branch" && permissions.local_commit_allowed !== true) {
      throw new Error("Delivery plan v2 does not grant local commit permission.");
    }
    if (mode === "fork-first-pr" && permissions.fork_push_allowed !== true) {
      throw new Error("Delivery plan v2 does not grant fork push permission.");
    }
    if (permissions.direct_upstream_write_allowed === true) {
      throw new Error("Direct upstream writes are not supported by the W57 delivery boundary.");
    }
  }

  if (deliveryPlan.execution_allowed !== true) {
    throw new Error("Delivery plan does not allow execution for this run.");
  }
  if (mode !== "no-write" && deliveryPlan.writeback_allowed !== true) {
    throw new Error("Delivery plan does not allow write-back for this run.");
  }

  if (requestedMode && requestedMode !== mode) {
    throw new Error(`Requested delivery mode '${requestedMode}' does not match plan mode '${mode}'.`);
  }

  return /** @type {"no-write" | "patch-only" | "local-branch" | "fork-first-pr"} */ (mode);
}

/**
 * @param {{
 *  cwd?: string,
 *  projectRef?: string,
 *  projectProfile?: string,
 *  runtimeRoot?: string,
 *  runId?: string,
 *  stepId?: string,
 *  mode?: string,
  *  branchName?: string,
  *  commitMessage?: string,
 *  forkOwner?: string,
 *  forkRemoteUrl?: string,
 *  baseRef?: string,
 *  prTitle?: string,
 *  prBody?: string,
 *  enableNetworkWrite?: boolean,
 *  githubToken?: string,
 *  githubCliPath?: string,
 *  ticketId?: string,
 *  executionRoot?: string,
 *  deliveryPlanPath?: string,
 *  deliveryPlan?: Record<string, unknown>,
 * }} options
 */
function executeDeliveryDriverTransaction(options = {}) {
  const init = initializeProjectRuntime(options);
  const runId = options.runId ?? `${init.projectId}.delivery.v1`;
  const stepId = options.stepId ?? "delivery.apply";

  const executionRoot = options.executionRoot
    ? path.isAbsolute(options.executionRoot)
      ? options.executionRoot
      : path.resolve(init.projectRoot, options.executionRoot)
    : init.projectRoot;

  const { deliveryPlan, deliveryPlanPath } = loadDeliveryPlan({
    deliveryPlanPath: options.deliveryPlanPath,
    deliveryPlan: options.deliveryPlan,
  });
  const mode = resolveDeliveryMode(deliveryPlan, asString(options.mode) ?? undefined);
  if (asString(deliveryPlan.project_id) !== init.projectId) {
    throw new Error(`Delivery plan project '${String(deliveryPlan.project_id)}' does not own runtime project '${init.projectId}'.`);
  }
  if (asString(deliveryPlan.run_id) !== runId) {
    throw new Error(`Delivery plan run '${String(deliveryPlan.run_id)}' does not match requested run '${runId}'.`);
  }
  const planCreatedAt = Date.parse(asString(deliveryPlan.created_at) ?? "");
  const planAgeMs = Date.now() - planCreatedAt;
  if (!Number.isFinite(planCreatedAt) || planAgeMs < -300_000 || planAgeMs > 86_400_000) {
    throw new Error("Delivery plan is stale or has an invalid creation timestamp; create a fresh authorization plan.");
  }
  if (mode !== "no-write") {
    verifyLockedDeliveryEvidence(deliveryPlan, init.projectRoot);
  }
  const coordination = asRecord(deliveryPlan.coordination);
  const coordinationRepoIds = asStringArray(coordination.repo_ids);
  const coordinationEvidenceRefs = asStringArray(coordination.evidence_refs);
  const coordinationLockEvidenceRefs = asStringArray(coordination.lock_evidence_refs);
  const crossRepoValidationRefs = asStringArray(coordination.cross_repo_validation_refs);
  const coordinationRepos = resolveCoordinationRepos(coordination, coordinationRepoIds);
  const coordinationMetadata = {
    required: coordination.required === true,
    status: asString(coordination.status) ?? "not-required",
    repo_ids: coordinationRepoIds,
    repos: coordinationRepos,
    evidence_refs: coordinationEvidenceRefs,
    lock_evidence_refs: coordinationLockEvidenceRefs,
    cross_repo_validation_refs: crossRepoValidationRefs,
  };
  const rerunRecovery = asRecord(deliveryPlan.rerun_recovery);
  const rerunMetadata = {
    requested: rerunRecovery.requested === true,
    status: asString(rerunRecovery.status) ?? "not-requested",
    rerun_of_run_ref: asString(rerunRecovery.rerun_of_run_ref),
    failed_step_ref: asString(rerunRecovery.failed_step_ref),
    packet_boundary: asString(rerunRecovery.packet_boundary) ?? "delivery-manifest",
    strategy: asString(rerunRecovery.strategy),
    blocking_reasons: asStringArray(rerunRecovery.blocking_reasons),
  };
  /** @type {string[]} */
  const rerunPreflightIssues = [];
  if (rerunMetadata.requested && rerunMetadata.status !== "ready") {
    const reasons = rerunMetadata.blocking_reasons.length > 0
      ? rerunMetadata.blocking_reasons.join(", ")
      : "rerun-context-blocked";
    rerunPreflightIssues.push(`Delivery plan rerun recovery is blocked: ${reasons}.`);
  }
  if (rerunMetadata.requested && rerunMetadata.failed_step_ref && rerunMetadata.failed_step_ref !== stepId) {
    rerunPreflightIssues.push(
      `Delivery plan rerun failed_step_ref '${rerunMetadata.failed_step_ref}' does not match executing step '${stepId}'.`,
    );
  }

  const transcriptId = `${init.projectId}.delivery-transcript.${normalizeForId(mode)}.${Date.now()}`;
  const transcriptFile = path.join(
    init.runtimeLayout.reportsRoot,
    `delivery-transcript-${normalizeForId(mode)}-${normalizeForId(runId)}-${Date.now()}.json`,
  );

  const startedAt = new Date().toISOString();
  const gitHeadBefore = readGitHead(executionRoot);
  const expectedMeaningfulChangedPaths = resolveExpectedMeaningfulChangedPaths(deliveryPlan, executionRoot);
  const authorizedChangedPaths = asStringArray(
    asRecord(asRecord(deliveryPlan.diff_authorization).changes).all_paths,
  );
  /** @type {string[]} */
  const commands = [];
  /** @type {string[]} */
  let changedPaths = [];
  let diffStats = {
    files: [],
    totals: {
      files: 0,
      added: 0,
      deleted: 0,
    },
  };
  /** @type {Record<string, unknown>} */
  let outputs = {};
  /** @type {"success" | "failed"} */
  let status = "success";
  /** @type {string | null} */
  let errorMessage = null;
  /** @type {string[] | null} */
  let recoverySteps = null;
  /** @type {string[]} */
  let missingExpectedChangedPaths = [];

  try {
    if (rerunPreflightIssues.length > 0) {
      throw new Error(rerunPreflightIssues.join(" "));
    }

    if (mode !== "no-write") {
      assertExactDeliveryDiff(executionRoot, asRecord(deliveryPlan.diff_authorization));
    }

    const modeResult = runDeliveryMode({
      mode,
      executionRoot,
      artifactsRoot: init.runtimeLayout.artifactsRoot,
      runId,
      gitHeadBefore,
      branchName: options.branchName,
      commitMessage: options.commitMessage,
      forkOwner: options.forkOwner,
      forkRemoteUrl: options.forkRemoteUrl,
      baseRef: options.baseRef,
      prTitle: options.prTitle,
      prBody: options.prBody,
      enableNetworkWrite: options.enableNetworkWrite,
      githubToken: options.githubToken,
      githubCliPath: options.githubCliPath,
      expectedChangedPaths: authorizedChangedPaths,
    });
    commands.push(...modeResult.commands);
    changedPaths = modeResult.changedPaths;
    diffStats = modeResult.diffStats;
    outputs = modeResult.outputs;
    missingExpectedChangedPaths = findMissingExpectedChangedPaths({
      mode,
      expectedMeaningfulChangedPaths,
      changedPaths,
    });
    if (missingExpectedChangedPaths.length > 0) {
      throw new Error(
        `Delivery current diff is missing Runtime Harness meaningful changed path(s): ${missingExpectedChangedPaths.join(", ")}.`,
      );
    }
  } catch (error) {
    status = "failed";
    errorMessage = error instanceof Error ? error.message : String(error);
    recoverySteps =
      mode === "local-branch"
        ? [
            `git checkout ${gitHeadBefore.branch}`,
            "Inspect the delivery transcript and fix git state in the isolated checkout before retrying.",
            "If a temporary branch was created, delete it only after confirming no data is needed.",
          ]
        : mode === "fork-first-pr"
          ? [
              "Inspect fork_target, branch_ref, and pr_draft metadata in transcript outputs.",
              "Validate GitHub credentials and permissions before executing real network write-back.",
              "Retry fork-first planning with explicit --fork-owner / --base-ref overrides if required.",
            ]
        : [
            "Inspect the delivery transcript and working tree diff.",
            "Fix patch generation prerequisites, then rerun patch-only delivery.",
          ];
  }

  const finishedAt = new Date().toISOString();
  const gitHeadAfter = readGitHead(executionRoot);

  const transcript = {
    transcript_id: transcriptId,
    project_id: init.projectId,
    run_id: runId,
    step_id: stepId,
    mode,
    status,
    started_at: startedAt,
    finished_at: finishedAt,
    execution_root: executionRoot,
    delivery_plan_ref: deliveryPlanPath,
    ownership: {
      source_run_id: asString(deliveryPlan.run_id),
      source_step_class: asString(deliveryPlan.step_class),
    },
    coordination: coordinationMetadata,
    recovery_scope: rerunMetadata,
    git: {
      head_before: gitHeadBefore,
      head_after: gitHeadAfter,
      commands,
    },
    changed_paths: changedPaths,
    diff_stats: diffStats,
    delivery_integrity: {
      authorized_changed_paths: authorizedChangedPaths,
      expected_meaningful_changed_paths: expectedMeaningfulChangedPaths,
      missing_expected_changed_paths: missingExpectedChangedPaths,
    },
    outputs,
    error: errorMessage,
    recovery_steps: recoverySteps,
  };
  fs.writeFileSync(transcriptFile, `${JSON.stringify(transcript, null, 2)}\n`, "utf8");

  const ticketId = asString(options.ticketId) ?? `${init.projectId}.wave.${normalizeForId(runId)}`;
  const deliveryPlanEvidenceRefs = uniqueStrings(asStringArray(deliveryPlan.evidence_refs));
  const planRef =
    deliveryPlanPath.startsWith("runtime://") || !path.isAbsolute(deliveryPlanPath)
      ? deliveryPlanPath
      : toEvidenceRef(init.projectRoot, deliveryPlanPath);
  const transcriptRef = toEvidenceRef(init.projectRoot, transcriptFile);
  const executionRootRef = toEvidenceRef(init.projectRoot, executionRoot);

  /** @type {string[]} */
  const deliveryOutputRefs = [];
  if (typeof outputs.patch_file === "string") {
    deliveryOutputRefs.push(toEvidenceRef(init.projectRoot, outputs.patch_file));
  }
  if (typeof outputs.api_intent_file === "string") {
    deliveryOutputRefs.push(toEvidenceRef(init.projectRoot, outputs.api_intent_file));
  }

  const writebackResult =
    status === "success"
      ? mode === "no-write"
        ? "no-write-confirmed"
        : mode === "patch-only"
        ? "patch-materialized"
        : mode === "local-branch"
          ? "local-branch-committed"
          : asString(outputs.network_mode) === "networked"
            ? "fork-pr-draft-created"
            : "fork-pr-planned"
      : "failed";

  const deliveryRepos =
    coordinationRepos.length > 0
      ? coordinationRepos
      : [
          {
            repo_id: "main",
            role: "application",
            default_branch: gitHeadBefore.branch,
            source_root: ".",
            source_kind: "local",
          },
        ];
  const changedPathsByRepo = classifyChangedPathsByRepo(changedPaths, deliveryRepos);
  const prDraft = asRecord(outputs.pr_draft);
  const repoDeliveries = deliveryRepos.map((repo) => {
    const sourceRoot = asString(repo.source_root) ?? ".";
    const repoRoot =
      sourceRoot === "."
        ? executionRoot
        : path.isAbsolute(sourceRoot)
          ? sourceRoot
          : path.resolve(executionRoot, sourceRoot);
    const repoChangedPaths = changedPathsByRepo.get(repo.repo_id) ?? [];
    const repoDelivery = {
      repo_id: repo.repo_id,
      role: repo.role,
      source_kind: repo.source_kind,
      source_root: sourceRoot,
      repo_root: repoRoot,
      repo_root_ref: toEvidenceRef(init.projectRoot, repoRoot),
      checkout_provenance: {
        head_before: gitHeadBefore,
        head_after: gitHeadAfter,
      },
      base_ref: repo.default_branch ?? gitHeadBefore.branch,
      head_ref: gitHeadAfter.branch,
      branch_name: typeof outputs.branch_name === "string" ? outputs.branch_name : null,
      changed_paths: repoChangedPaths,
      diff_totals: summarizeDiffTotalsForPaths(diffStats, repoChangedPaths),
      commit_refs: typeof outputs.commit_sha === "string" ? [outputs.commit_sha] : [],
      writeback_result: writebackResult,
      transaction_stage: status === "success" ? "complete" : "failed",
      failed_step: status === "success" ? null : stepId,
      rollback_refs: [],
      recovery_action: status === "success" ? null : "inspect-delivery-transcript",
      coordination: {
        required: coordinationMetadata.required,
        status: coordinationMetadata.status,
        repo_ids: coordinationMetadata.repo_ids,
        evidence_refs: coordinationMetadata.evidence_refs,
        lock_evidence_refs: coordinationMetadata.lock_evidence_refs,
        cross_repo_validation_refs: coordinationMetadata.cross_repo_validation_refs,
      },
    };

    if (mode === "fork-first-pr" && prDraft.title) {
      repoDelivery.pr_draft = {
        title: prDraft.title,
        base_repo: prDraft.base_repo,
        base_branch: prDraft.base_branch,
        head_repo: prDraft.head_repo,
        head_branch: prDraft.head_branch,
        is_draft: prDraft.is_draft,
      };
    }

    return repoDelivery;
  });

  const deliveryManifest = {
    schema_version: 2,
    manifest_id: `${init.projectId}.delivery-manifest.${normalizeForId(mode)}.${Date.now()}`,
    project_id: init.projectId,
    ticket_id: ticketId,
    run_refs: uniqueStrings([runId, asString(deliveryPlan.run_id) ?? ""]),
    step_ref: stepId,
    delivery_mode: mode,
    writeback_policy: {
      mode,
      mode_source: asRecord(deliveryPlan.mode_source),
      writeback_allowed: deliveryPlan.writeback_allowed === true,
      blocking_reasons: asStringArray(deliveryPlan.blocking_reasons),
      network_mode: asString(outputs.network_mode) ?? "local",
    },
    repo_deliveries: repoDeliveries,
    verification_refs: uniqueStrings([...deliveryPlanEvidenceRefs, transcriptRef]),
    approval_context: {
      approved_handoff: asRecord(asRecord(deliveryPlan.preconditions).approved_handoff),
      promotion_evidence: asRecord(asRecord(deliveryPlan.preconditions).promotion_evidence),
      runtime_harness: asRecord(asRecord(deliveryPlan.preconditions).runtime_harness),
      coordination_evidence: asRecord(asRecord(deliveryPlan.preconditions).coordination_evidence),
      integration: asRecord(asRecord(deliveryPlan.preconditions).integration),
      evidence_refs: deliveryPlanEvidenceRefs,
    },
    coordination: coordinationMetadata,
    coordination_transaction: {
      transaction_id: `${init.projectId}.delivery-transaction.${normalizeForId(runId)}`,
      status: status === "success" ? "complete" : repoDeliveries.some((repo) => repo.writeback_result !== "failed") ? "partial" : "blocked",
      repo_ids: repoDeliveries.map((repo) => repo.repo_id),
      completed_repo_ids: repoDeliveries.filter((repo) => repo.writeback_result !== "failed").map((repo) => repo.repo_id),
      failed_repo_ids: repoDeliveries.filter((repo) => repo.writeback_result === "failed").map((repo) => repo.repo_id),
      integration_report_ref: asString(asRecord(asRecord(deliveryPlan.preconditions).integration).report_ref),
      lock_evidence_refs: coordinationMetadata.lock_evidence_refs,
      rollback_refs: uniqueStrings(repoDeliveries.flatMap((repo) => asStringArray(repo.rollback_refs))),
    },
    rerun_recovery: rerunMetadata,
    evidence_root: init.runtimeLayout.reportsRoot,
    source_refs: {
      delivery_plan_ref: planRef,
      delivery_transcript_ref: transcriptRef,
      delivery_execution_root: executionRoot,
      delivery_execution_root_ref: executionRootRef,
      delivery_output_refs: uniqueStrings(deliveryOutputRefs),
    },
    status: status === "success" ? "submitted" : "failed",
    created_at: finishedAt,
  };
  const manifestValidation = validateContractDocument({
    family: "delivery-manifest",
    document: deliveryManifest,
    source: "runtime://delivery-manifest",
  });
  if (!manifestValidation.ok) {
    const issues = manifestValidation.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Generated delivery manifest failed contract validation: ${issues}`);
  }

  const deliveryManifestFile = path.join(
    init.runtimeLayout.artifactsRoot,
    `delivery-manifest-${normalizeForId(mode)}-${normalizeForId(runId)}-${Date.now()}.json`,
  );
  fs.writeFileSync(deliveryManifestFile, `${JSON.stringify(deliveryManifest, null, 2)}\n`, "utf8");
  const deliveryManifestRef = toEvidenceRef(init.projectRoot, deliveryManifestFile);

  const evidenceGroups = classifyEvidenceRefs(deliveryPlanEvidenceRefs);
  const executionRefs = uniqueStrings([planRef, transcriptRef, ...evidenceGroups.executionRefs]);
  const releasePacket = {
    packet_id: `${init.projectId}.release-packet.${normalizeForId(mode)}.${Date.now()}`,
    project_id: init.projectId,
    ticket_id: ticketId,
    run_refs: uniqueStrings([runId, asString(deliveryPlan.run_id) ?? ""]),
    change_summary: `Delivery mode '${mode}' produced ${diffStats.totals.files} changed file(s), +${diffStats.totals.added}/-${diffStats.totals.deleted}.`,
    verification_refs: uniqueStrings([...deliveryManifest.verification_refs, deliveryManifestRef]),
    delivery_manifest_ref: deliveryManifestRef,
    source_provenance: {
      delivery_execution_root: executionRoot,
      delivery_execution_root_ref: executionRootRef,
      delivery_transcript_ref: transcriptRef,
    },
    evidence_lineage: {
      handoff_refs: evidenceGroups.handoffRefs,
      promotion_refs: evidenceGroups.promotionRefs,
      execution_refs: executionRefs,
      coordination_refs: coordinationMetadata.evidence_refs,
      coordination_lock_refs: coordinationMetadata.lock_evidence_refs,
      cross_repo_validation_refs: coordinationMetadata.cross_repo_validation_refs,
      rerun_refs: rerunMetadata.rerun_of_run_ref ? [rerunMetadata.rerun_of_run_ref] : [],
      delivery_output_refs: uniqueStrings([deliveryManifestRef, ...deliveryOutputRefs]),
    },
    coordination: coordinationMetadata,
    rerun_recovery: rerunMetadata,
    status: status === "success" ? "ready-for-close" : "blocked",
    created_at: finishedAt,
  };
  if (status === "failed") {
    releasePacket.residual_risks = [errorMessage ?? "Delivery execution failed before write-back completed."];
    releasePacket.rollback_notes = "Inspect delivery transcript and restore repository state before retry.";
  }

  const releaseValidation = validateContractDocument({
    family: "release-packet",
    document: releasePacket,
    source: "runtime://release-packet",
  });
  if (!releaseValidation.ok) {
    const issues = releaseValidation.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Generated release packet failed contract validation: ${issues}`);
  }

  const releasePacketFile = path.join(
    init.runtimeLayout.artifactsRoot,
    `release-packet-${normalizeForId(mode)}-${normalizeForId(runId)}-${Date.now()}.json`,
  );
  fs.writeFileSync(releasePacketFile, `${JSON.stringify(releasePacket, null, 2)}\n`, "utf8");

  transcript.outputs = {
    ...asRecord(transcript.outputs),
    delivery_manifest_file: deliveryManifestFile,
    release_packet_file: releasePacketFile,
  };

  const learningLoop = materializeLearningLoopArtifacts({
    projectId: init.projectId,
    projectRoot: init.projectRoot,
    runtimeLayout: init.runtimeLayout,
    runId,
    sourceKind: "delivery",
    runStatus: status,
    summary:
      status === "failed"
        ? errorMessage ?? releasePacket.change_summary
        : releasePacket.change_summary,
    evidenceRefs: uniqueStrings([
      deliveryPlanPath,
      transcriptFile,
      deliveryManifestFile,
      releasePacketFile,
      ...deliveryManifest.verification_refs,
      ...deliveryOutputRefs,
    ]),
    backlogRefs: [
      "docs/backlog/mvp-implementation-backlog.md",
      "docs/backlog/wave-5-implementation-slices.md",
    ],
    incidentSummary: status === "failed" ? errorMessage ?? undefined : undefined,
  });

  transcript.outputs = {
    ...asRecord(transcript.outputs),
    learning_loop_scorecard_file: learningLoop.scorecardFile,
    learning_loop_handoff_file: learningLoop.handoffFile,
    incident_report_file: learningLoop.incidentFile,
  };
  fs.writeFileSync(transcriptFile, `${JSON.stringify(transcript, null, 2)}\n`, "utf8");

  return {
    ...init,
    runId,
    stepId,
    mode,
    status,
    blocking: status === "failed",
    deliveryPlan,
    deliveryPlanPath,
    transcript,
    transcriptFile,
    deliveryManifest,
    deliveryManifestFile,
    releasePacket,
    releasePacketFile,
    learningLoopScorecard: learningLoop.scorecard,
    learningLoopScorecardFile: learningLoop.scorecardFile,
    incidentReport: learningLoop.incident,
    incidentReportFile: learningLoop.incidentFile,
    learningLoopHandoff: learningLoop.handoff,
    learningLoopHandoffFile: learningLoop.handoffFile,
    changedPaths,
    diffStats,
    outputs,
  };
}

export function runDeliveryDriver(options = {}) {
  return runTransactionCoordinator(executeDeliveryDriverTransaction, options);
}
