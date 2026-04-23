import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { loadContractFile, validateContractDocument } from "../../contracts/src/index.mjs";
import { materializeLearningLoopArtifacts } from "../../observability/src/index.mjs";

import { initializeProjectRuntime } from "./project-init.mjs";

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
 * @param {{ command: string, args: string[], cwd: string, env?: Record<string, string | undefined> }} options
 * @returns {{ stdout: string, stderr: string, status: number | null, error: Error | null }}
 */
function runCommand(options) {
  const run = spawnSync(options.command, options.args, {
    cwd: options.cwd,
    encoding: "utf8",
    env: options.env,
  });
  return {
    stdout: run.stdout ?? "",
    stderr: run.stderr ?? "",
    status: run.status,
    error: run.error instanceof Error ? run.error : null,
  };
}

/**
 * @param {{ command: string, args: string[], cwd: string, env?: Record<string, string | undefined> }} options
 * @returns {string}
 */
function runCommandChecked(options) {
  const run = runCommand(options);
  if (run.error) {
    throw new Error(`${options.command} failed to launch: ${run.error.message}`);
  }
  if (run.status !== 0) {
    throw new Error(
      `${options.command} ${options.args.join(" ")} failed (exit ${String(run.status)}): ${run.stderr.trim() || run.stdout.trim()}`,
    );
  }
  return run.stdout;
}

/**
 * @param {{ command: string, args: string[], cwd: string, env?: Record<string, string | undefined> }} options
 * @returns {Record<string, unknown>}
 */
function runCommandJsonChecked(options) {
  const stdout = runCommandChecked(options).trim();
  if (!stdout) {
    throw new Error(`${options.command} ${options.args.join(" ")} returned empty JSON response.`);
  }
  try {
    const parsed = JSON.parse(stdout);
    return asRecord(parsed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${options.command} ${options.args.join(" ")} returned invalid JSON payload: ${message}`,
    );
  }
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
 * @param {string} remoteUrl
 * @returns {{ host: string, owner: string, repo: string } | null}
 */
function parseGitHubRemote(remoteUrl) {
  const httpsMatch = remoteUrl.match(/^https:\/\/([^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (httpsMatch) {
    return {
      host: httpsMatch[1].toLowerCase(),
      owner: httpsMatch[2],
      repo: httpsMatch[3],
    };
  }

  const sshMatch = remoteUrl.match(/^git@([^:]+):([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (sshMatch) {
    return {
      host: sshMatch[1].toLowerCase(),
      owner: sshMatch[2],
      repo: sshMatch[3],
    };
  }

  return null;
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

  const writebackAllowed = deliveryPlan.writeback_allowed;
  if (writebackAllowed !== true) {
    throw new Error("Delivery plan does not allow write-back for this run.");
  }

  const mode = asString(deliveryPlan.delivery_mode);
  if (!mode || !SUPPORTED_DELIVERY_MODES.has(mode)) {
    throw new Error(
      `Delivery mode '${String(deliveryPlan.delivery_mode)}' is not supported in this slice. Expected one of: no-write, patch-only, local-branch, fork-first-pr.`,
    );
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
  const coordination = asRecord(deliveryPlan.coordination);
  const coordinationRepoIds = asStringArray(coordination.repo_ids);
  const coordinationEvidenceRefs = asStringArray(coordination.evidence_refs);
  const coordinationMetadata = {
    required: coordination.required === true,
    status: asString(coordination.status) ?? "not-required",
    repo_ids: coordinationRepoIds,
    evidence_refs: coordinationEvidenceRefs,
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
    if (rerunPreflightIssues.length > 0) {
      throw new Error(rerunPreflightIssues.join(" "));
    }

    if (mode === "no-write") {
      outputs = {
        no_write: true,
        summary: "No-write mode selected; delivery transcript, manifest, and release packet are materialized only.",
      };
    } else if (mode === "patch-only") {
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
    } else if (mode === "fork-first-pr") {
      commands.push("git remote get-url origin");
      const originUrl = runGitChecked({
        cwd: executionRoot,
        args: ["remote", "get-url", "origin"],
      }).trim();
      const parsedRemote = parseGitHubRemote(originUrl);
      if (!parsedRemote || parsedRemote.host !== "github.com") {
        throw new Error(
          `fork-first-pr mode expects GitHub origin remote; got '${originUrl || "<missing>"}'.`,
        );
      }

      const forkOwner = asString(options.forkOwner) ?? "aor-bot";
      const baseRef = asString(options.baseRef) ?? gitHeadBefore.branch;
      const headBranch = asString(options.branchName) ?? `aor/${normalizeForId(runId)}`;
      const commitMessage = asString(options.commitMessage) ?? `AOR delivery ${runId}`;
      const prTitle = asString(options.prTitle) ?? `AOR delivery ${runId}`;
      const prBody =
        asString(options.prBody) ??
        "Draft PR prepared by AOR fork-first delivery planning mode. No network write was executed in this run.";
      const enableNetworkWrite = options.enableNetworkWrite === true;
      const githubToken = Object.prototype.hasOwnProperty.call(options, "githubToken")
        ? asString(options.githubToken)
        : asString(process.env.GITHUB_TOKEN);
      const githubCliPath = asString(options.githubCliPath) ?? "gh";
      const forkRemoteUrl =
        asString(options.forkRemoteUrl) ?? `https://github.com/${forkOwner}/${parsedRemote.repo}.git`;

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

      const apiIntent = {
        mode: "fork-first-pr",
        network_mode: enableNetworkWrite ? "requested" : "stubbed",
        remote: {
          host: parsedRemote.host,
          upstream_repo: `${parsedRemote.owner}/${parsedRemote.repo}`,
          fork_repo: `${forkOwner}/${parsedRemote.repo}`,
        },
        branch: {
          base_ref: baseRef,
          head_ref: `refs/heads/${headBranch}`,
          head_branch: headBranch,
        },
        pr_draft: {
          title: prTitle,
          body: prBody,
          is_draft: true,
          base_repo: `${parsedRemote.owner}/${parsedRemote.repo}`,
          base_branch: baseRef,
          head_repo: `${forkOwner}/${parsedRemote.repo}`,
          head_branch: headBranch,
        },
        api_evidence: {
          fork_request: {
            method: "POST",
            path: `/repos/${parsedRemote.owner}/${parsedRemote.repo}/forks`,
            owner: forkOwner,
          },
          push_request: {
            method: "POST",
            path: `/repos/${forkOwner}/${parsedRemote.repo}/git/refs`,
            ref: `refs/heads/${headBranch}`,
          },
          pr_request: {
            method: "POST",
            path: `/repos/${parsedRemote.owner}/${parsedRemote.repo}/pulls`,
            draft: true,
          },
        },
        policy_guardrails: {
          public_repo_default: true,
          direct_upstream_write_allowed: false,
        },
      };
      const apiIntentFile = path.join(
        init.runtimeLayout.artifactsRoot,
        `fork-first-intent-${normalizeForId(runId)}-${Date.now()}.json`,
      );
      fs.writeFileSync(apiIntentFile, `${JSON.stringify(apiIntent, null, 2)}\n`, "utf8");

      /** @type {Record<string, unknown>} */
      const planningOutputs = {
        fork_target: apiIntent.remote,
        branch_ref: apiIntent.branch,
        pr_draft: apiIntent.pr_draft,
        api_intent_file: apiIntentFile,
        network_mode: "stubbed",
        network_write: {
          requested: enableNetworkWrite,
          executed: false,
        },
      };

      if (!enableNetworkWrite) {
        outputs = planningOutputs;
      } else {
        if (!githubToken) {
          throw new Error(
            "fork-first-pr network write requested but GitHub credentials are missing. Set GITHUB_TOKEN or pass githubToken option.",
          );
        }

        const githubEnv = {
          ...process.env,
          GITHUB_TOKEN: githubToken,
        };

        commands.push(`${githubCliPath} --version`);
        runCommandChecked({
          command: githubCliPath,
          args: ["--version"],
          cwd: executionRoot,
          env: githubEnv,
        });

        let forkState = "verified";
        /** @type {Record<string, unknown>} */
        let forkMetadata;
        commands.push(`${githubCliPath} api /repos/${forkOwner}/${parsedRemote.repo}`);
        try {
          forkMetadata = runCommandJsonChecked({
            command: githubCliPath,
            args: ["api", `/repos/${forkOwner}/${parsedRemote.repo}`],
            cwd: executionRoot,
            env: githubEnv,
          });
        } catch {
          const createForkArgs = ["api", "-X", "POST", `/repos/${parsedRemote.owner}/${parsedRemote.repo}/forks`];
          if (forkOwner !== parsedRemote.owner) {
            createForkArgs.push("-f", `organization=${forkOwner}`);
          }
          commands.push(`${githubCliPath} ${createForkArgs.join(" ")}`);
          forkMetadata = runCommandJsonChecked({
            command: githubCliPath,
            args: createForkArgs,
            cwd: executionRoot,
            env: githubEnv,
          });
          forkState = "created";
        }

        commands.push(`git checkout -B ${headBranch}`);
        runGitChecked({
          cwd: executionRoot,
          args: ["checkout", "-B", headBranch],
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
          throw new Error("Fork-first network delivery has no staged changes to commit.");
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

        commands.push(`git push ${forkRemoteUrl} HEAD:refs/heads/${headBranch} --force-with-lease`);
        runGitChecked({
          cwd: executionRoot,
          args: ["push", forkRemoteUrl, `HEAD:refs/heads/${headBranch}`, "--force-with-lease"],
        });

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

        const prCreateArgs = [
          "api",
          "-X",
          "POST",
          `/repos/${parsedRemote.owner}/${parsedRemote.repo}/pulls`,
          "-f",
          `title=${prTitle}`,
          "-f",
          `body=${prBody}`,
          "-f",
          `head=${forkOwner}:${headBranch}`,
          "-f",
          `base=${baseRef}`,
          "-F",
          "draft=true",
        ];
        commands.push(`${githubCliPath} ${prCreateArgs.join(" ")}`);
        const prResponse = runCommandJsonChecked({
          command: githubCliPath,
          args: prCreateArgs,
          cwd: executionRoot,
          env: githubEnv,
        });

        const prNumber = typeof prResponse.number === "number" ? prResponse.number : null;
        const prUrl = asString(prResponse.html_url);
        outputs = {
          ...planningOutputs,
          network_mode: "networked",
          commit_sha: commitSha,
          pr_draft: {
            ...asRecord(planningOutputs.pr_draft),
            number: prNumber,
            html_url: prUrl,
          },
          network_write: {
            requested: true,
            executed: true,
            fork_state: forkState,
            fork_repo_url: asString(forkMetadata.html_url),
            fork_full_name: asString(forkMetadata.full_name),
            pull_request_number: prNumber,
            pull_request_url: prUrl,
            push_remote: forkRemoteUrl,
            github_cli: githubCliPath,
          },
        };
      }
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

  const repoDelivery = {
    repo_id: "main",
    base_ref: gitHeadBefore.branch,
    head_ref: gitHeadAfter.branch,
    branch_name: typeof outputs.branch_name === "string" ? outputs.branch_name : null,
    changed_paths: changedPaths,
    diff_totals: diffStats.totals,
    commit_refs: typeof outputs.commit_sha === "string" ? [outputs.commit_sha] : [],
    writeback_result: writebackResult,
    coordination: {
      required: coordinationMetadata.required,
      status: coordinationMetadata.status,
      repo_ids: coordinationMetadata.repo_ids,
    },
  };
  if (mode === "fork-first-pr" && asRecord(outputs.pr_draft).title) {
    repoDelivery.pr_draft = {
      title: asRecord(outputs.pr_draft).title,
      base_repo: asRecord(outputs.pr_draft).base_repo,
      base_branch: asRecord(outputs.pr_draft).base_branch,
      head_repo: asRecord(outputs.pr_draft).head_repo,
      head_branch: asRecord(outputs.pr_draft).head_branch,
      is_draft: asRecord(outputs.pr_draft).is_draft,
    };
  }

  const deliveryManifest = {
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
    repo_deliveries: [repoDelivery],
    verification_refs: uniqueStrings([...deliveryPlanEvidenceRefs, transcriptRef]),
    approval_context: {
      approved_handoff: asRecord(asRecord(deliveryPlan.preconditions).approved_handoff),
      promotion_evidence: asRecord(asRecord(deliveryPlan.preconditions).promotion_evidence),
      coordination_evidence: asRecord(asRecord(deliveryPlan.preconditions).coordination_evidence),
      evidence_refs: deliveryPlanEvidenceRefs,
    },
    coordination: coordinationMetadata,
    rerun_recovery: rerunMetadata,
    evidence_root: init.runtimeLayout.reportsRoot,
    source_refs: {
      delivery_plan_ref: planRef,
      delivery_transcript_ref: transcriptRef,
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
    evidence_lineage: {
      handoff_refs: evidenceGroups.handoffRefs,
      promotion_refs: evidenceGroups.promotionRefs,
      execution_refs: executionRefs,
      coordination_refs: coordinationMetadata.evidence_refs,
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
