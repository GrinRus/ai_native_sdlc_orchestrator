import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { loadContractFile, validateContractDocument } from "../../contracts/src/index.mjs";

import { initializeProjectRuntime } from "./project-init.mjs";

const SUPPORTED_DELIVERY_MODES = new Set(["patch-only", "local-branch"]);

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
 * @param {string} output
 * @returns {string[]}
 */
function parseLineList(output) {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * @param {string} output
 * @returns {{ files: Array<{ path: string, added: number, deleted: number }>, totals: { files: number, added: number, deleted: number } }}
 */
function parseNumstat(output) {
  const files = output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [addedRaw = "0", deletedRaw = "0", filePath = ""] = line.split("\t");
      const added = /^\d+$/u.test(addedRaw) ? Number(addedRaw) : 0;
      const deleted = /^\d+$/u.test(deletedRaw) ? Number(deletedRaw) : 0;
      return {
        path: filePath,
        added,
        deleted,
      };
    })
    .filter((entry) => entry.path.length > 0);

  const totals = files.reduce(
    (acc, entry) => ({
      files: acc.files + 1,
      added: acc.added + entry.added,
      deleted: acc.deleted + entry.deleted,
    }),
    { files: 0, added: 0, deleted: 0 },
  );

  return {
    files,
    totals,
  };
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
 * @returns {"patch-only" | "local-branch"}
 */
function resolveDeliveryMode(deliveryPlan, requestedMode) {
  const status = asString(deliveryPlan.status);
  if (status !== "ready") {
    throw new Error(
      `Delivery plan status '${String(deliveryPlan.status)}' is not ready. Resolve blocking reasons before write-back.`,
    );
  }

  const writebackAllowed = deliveryPlan.writeback_allowed;
  if (writebackAllowed !== true) {
    throw new Error("Delivery plan does not allow write-back for this run.");
  }

  const mode = asString(deliveryPlan.delivery_mode);
  if (!mode || !SUPPORTED_DELIVERY_MODES.has(mode)) {
    throw new Error(
      `Delivery mode '${String(deliveryPlan.delivery_mode)}' is not supported in this slice. Expected one of: patch-only, local-branch.`,
    );
  }

  if (requestedMode && requestedMode !== mode) {
    throw new Error(`Requested delivery mode '${requestedMode}' does not match plan mode '${mode}'.`);
  }

  return /** @type {"patch-only" | "local-branch"} */ (mode);
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
 *  executionRoot?: string,
 *  deliveryPlanPath?: string,
 *  deliveryPlan?: Record<string, unknown>,
 * }} options
 */
export function runDeliveryDriver(options = {}) {
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

  const transcriptId = `${init.projectId}.delivery-transcript.${normalizeForId(mode)}.${Date.now()}`;
  const transcriptFile = path.join(
    init.runtimeLayout.reportsRoot,
    `delivery-transcript-${normalizeForId(mode)}-${normalizeForId(runId)}-${Date.now()}.json`,
  );

  const startedAt = new Date().toISOString();
  const gitHeadBefore = readGitHead(executionRoot);
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

  try {
    if (mode === "patch-only") {
      commands.push("git diff --binary HEAD");
      const patchBody = runGitChecked({
        cwd: executionRoot,
        args: ["diff", "--binary", "HEAD"],
      });
      const patchFile = path.join(
        init.runtimeLayout.artifactsRoot,
        `delivery-patch-${normalizeForId(runId)}-${Date.now()}.patch`,
      );
      fs.writeFileSync(patchFile, patchBody, "utf8");

      commands.push("git diff --name-only HEAD");
      changedPaths = parseLineList(
        runGitChecked({
          cwd: executionRoot,
          args: ["diff", "--name-only", "HEAD"],
        }),
      );

      commands.push("git diff --numstat HEAD");
      diffStats = parseNumstat(
        runGitChecked({
          cwd: executionRoot,
          args: ["diff", "--numstat", "HEAD"],
        }),
      );

      outputs = {
        patch_file: patchFile,
      };
    } else if (mode === "local-branch") {
      const branchName = asString(options.branchName) ?? `aor/${normalizeForId(runId)}`;
      const commitMessage = asString(options.commitMessage) ?? `AOR delivery ${runId}`;

      commands.push(`git checkout -B ${branchName}`);
      runGitChecked({
        cwd: executionRoot,
        args: ["checkout", "-B", branchName],
      });

      commands.push("git add -A");
      runGitChecked({
        cwd: executionRoot,
        args: ["add", "-A"],
      });

      commands.push("git diff --cached --quiet");
      const stagedDiff = runGit({
        cwd: executionRoot,
        args: ["diff", "--cached", "--quiet"],
      });
      if (stagedDiff.status === 0) {
        throw new Error("Local-branch delivery has no staged changes to commit.");
      }
      if (stagedDiff.status !== 1) {
        throw new Error(
          `git diff --cached --quiet failed with exit ${String(stagedDiff.status)}: ${stagedDiff.stderr.trim()}`,
        );
      }

      commands.push(`git commit -m ${JSON.stringify(commitMessage)} --no-verify`);
      runGitChecked({
        cwd: executionRoot,
        args: ["commit", "-m", commitMessage, "--no-verify"],
      });

      commands.push("git rev-parse HEAD");
      const commitSha = runGitChecked({
        cwd: executionRoot,
        args: ["rev-parse", "HEAD"],
      }).trim();

      commands.push("git show --name-only --pretty=format: HEAD");
      changedPaths = parseLineList(
        runGitChecked({
          cwd: executionRoot,
          args: ["show", "--name-only", "--pretty=format:", "HEAD"],
        }),
      );

      commands.push("git show --numstat --format= HEAD");
      diffStats = parseNumstat(
        runGitChecked({
          cwd: executionRoot,
          args: ["show", "--numstat", "--format=", "HEAD"],
        }),
      );

      outputs = {
        branch_name: branchName,
        commit_sha: commitSha,
        commit_message: commitMessage,
      };
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
    git: {
      head_before: gitHeadBefore,
      head_after: gitHeadAfter,
      commands,
    },
    changed_paths: changedPaths,
    diff_stats: diffStats,
    outputs,
    error: errorMessage,
    recovery_steps: recoverySteps,
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
    changedPaths,
    diffStats,
    outputs,
  };
}
