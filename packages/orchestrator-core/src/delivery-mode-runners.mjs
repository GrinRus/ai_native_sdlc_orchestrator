import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { runTransactionCoordinator } from "./verification-delivery-transactions.mjs";

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
 * @param {string} value
 * @returns {string}
 */
function normalizeRepoPath(value) {
  return value.trim().replace(/\\/g, "/").replace(/^\.\//u, "");
}

/**
 * @param {{ executionRoot: string, expectedChangedPaths?: string[] }} options
 * @returns {string[]}
 */
function resolveExpectedUntrackedPaths(options) {
  return Array.from(new Set(Array.isArray(options.expectedChangedPaths) ? options.expectedChangedPaths : []))
    .map(normalizeRepoPath)
    .filter((repoPath) => repoPath.length > 0)
    .filter((repoPath) => {
      const absolutePath = path.resolve(options.executionRoot, repoPath);
      const relative = path.relative(options.executionRoot, absolutePath);
      if (!relative || relative.startsWith("../")) {
        return false;
      }
      if (!fs.existsSync(absolutePath)) {
        return false;
      }

      const tracked = runGit({
        cwd: options.executionRoot,
        args: ["ls-files", "--error-unmatch", "--", repoPath],
      });
      return tracked.status !== 0;
    });
}

/**
 * @param {{ executionRoot: string, expectedChangedPaths?: string[], commands: string[] }} options
 * @returns {string[]}
 */
function stageExpectedUntrackedPaths(options) {
  const untrackedPaths = resolveExpectedUntrackedPaths(options);
  if (untrackedPaths.length === 0) {
    return [];
  }

  options.commands.push(`git add -N -- ${untrackedPaths.join(" ")}`);
  runGitChecked({
    cwd: options.executionRoot,
    args: ["add", "-N", "--", ...untrackedPaths],
  });
  return untrackedPaths;
}

/**
 * @param {{ executionRoot: string, intentToAddPaths: string[], commands: string[] }} options
 */
function resetIntentToAddPaths(options) {
  if (options.intentToAddPaths.length === 0) {
    return;
  }
  options.commands.push(`git reset -- ${options.intentToAddPaths.join(" ")}`);
  runGitChecked({
    cwd: options.executionRoot,
    args: ["reset", "--", ...options.intentToAddPaths],
  });
}

function stageAuthorizedPaths(options) {
  const paths = Array.from(new Set(options.expectedChangedPaths ?? [])).map(normalizeRepoPath).filter(Boolean);
  if (paths.length === 0) {
    throw new Error("Write-capable delivery requires an explicit non-empty authorized path set.");
  }
  const present = paths.filter((repoPath) => fs.existsSync(path.join(options.executionRoot, repoPath)));
  const deleted = paths.filter((repoPath) => !fs.existsSync(path.join(options.executionRoot, repoPath)));
  if (present.length > 0) {
    options.commands.push(`git add -- ${present.join(" ")}`);
    runGitChecked({ cwd: options.executionRoot, args: ["add", "--", ...present] });
  }
  if (deleted.length > 0) {
    options.commands.push(`git rm --ignore-unmatch -- ${deleted.join(" ")}`);
    runGitChecked({ cwd: options.executionRoot, args: ["rm", "--ignore-unmatch", "--", ...deleted] });
  }
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

  const sshUrlMatch = remoteUrl.match(/^ssh:\/\/(?:git@)?([^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (sshUrlMatch) {
    return { host: sshUrlMatch[1].toLowerCase(), owner: sshUrlMatch[2], repo: sshUrlMatch[3] };
  }

  return null;
}

/**
 * @returns {{ commands: string[], changedPaths: string[], diffStats: { files: Array<{ path: string, added: number, deleted: number }>, totals: { files: number, added: number, deleted: number } }, outputs: Record<string, unknown> }}
 */
export function runNoWriteDeliveryMode() {
  return {
    commands: [],
    changedPaths: [],
    diffStats: {
      files: [],
      totals: {
        files: 0,
        added: 0,
        deleted: 0,
      },
    },
    outputs: {
      no_write: true,
      summary: "No-write mode selected; delivery transcript, manifest, and release packet are materialized only.",
    },
  };
}

/**
 * @param {{ executionRoot: string, artifactsRoot: string, runId: string, expectedChangedPaths?: string[] }} options
 */
export function runPatchOnlyDeliveryMode(options) {
  const commands = [];
  const intentToAddPaths = stageExpectedUntrackedPaths({
    executionRoot: options.executionRoot,
    expectedChangedPaths: options.expectedChangedPaths,
    commands,
  });

  try {
    commands.push("git diff --binary HEAD");
    const patchBody = runGitChecked({
      cwd: options.executionRoot,
      args: ["diff", "--binary", "HEAD"],
    });
    const patchFile = path.join(
      options.artifactsRoot,
      `delivery-patch-${normalizeForId(options.runId)}-${Date.now()}.patch`,
    );
    fs.writeFileSync(patchFile, patchBody, "utf8");

    commands.push("git diff --name-only HEAD");
    const changedPaths = parseLineList(
      runGitChecked({
        cwd: options.executionRoot,
        args: ["diff", "--name-only", "HEAD"],
      }),
    );

    commands.push("git diff --numstat HEAD");
    const diffStats = parseNumstat(
      runGitChecked({
        cwd: options.executionRoot,
        args: ["diff", "--numstat", "HEAD"],
      }),
    );

    return {
      commands,
      changedPaths,
      diffStats,
      outputs: {
        patch_file: patchFile,
      },
    };
  } finally {
    resetIntentToAddPaths({
      executionRoot: options.executionRoot,
      intentToAddPaths,
      commands,
    });
  }
}

/**
 * @param {{ executionRoot: string, runId: string, branchName?: string, commitMessage?: string, expectedChangedPaths?: string[] }} options
 */
export function runLocalBranchDeliveryMode(options) {
  const commands = [];
  const branchName = asString(options.branchName) ?? `aor/${normalizeForId(options.runId)}`;
  const commitMessage = asString(options.commitMessage) ?? `AOR delivery ${options.runId}`;

  commands.push(`git checkout -B ${branchName}`);
  runGitChecked({
    cwd: options.executionRoot,
    args: ["checkout", "-B", branchName],
  });

  stageAuthorizedPaths({ executionRoot: options.executionRoot, expectedChangedPaths: options.expectedChangedPaths, commands });

  commands.push("git diff --cached --quiet");
  const stagedDiff = runGit({
    cwd: options.executionRoot,
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
    cwd: options.executionRoot,
    args: ["commit", "-m", commitMessage, "--no-verify"],
  });

  commands.push("git rev-parse HEAD");
  const commitSha = runGitChecked({
    cwd: options.executionRoot,
    args: ["rev-parse", "HEAD"],
  }).trim();

  commands.push("git show --name-only --pretty=format: HEAD");
  const changedPaths = parseLineList(
    runGitChecked({
      cwd: options.executionRoot,
      args: ["show", "--name-only", "--pretty=format:", "HEAD"],
    }),
  );

  commands.push("git show --numstat --format= HEAD");
  const diffStats = parseNumstat(
    runGitChecked({
      cwd: options.executionRoot,
      args: ["show", "--numstat", "--format=", "HEAD"],
    }),
  );

  return {
    commands,
    changedPaths,
    diffStats,
    outputs: {
      branch_name: branchName,
      commit_sha: commitSha,
      commit_message: commitMessage,
    },
  };
}

/**
 * @param {{
 *   executionRoot: string,
 *   artifactsRoot: string,
 *   runId: string,
 *   gitHeadBefore: { branch: string },
 *   forkOwner?: string,
 *   forkRemoteUrl?: string,
 *   baseRef?: string,
 *   branchName?: string,
 *   commitMessage?: string,
 *   prTitle?: string,
 *   prBody?: string,
 *   enableNetworkWrite?: boolean,
 *   githubToken?: string,
 *   githubCliPath?: string,
 *   expectedChangedPaths?: string[],
 * }} options
 */
function executeForkFirstPrDeliveryTransaction(options) {
  const commands = [];
  commands.push("git remote get-url origin");
  const originUrl = runGitChecked({
    cwd: options.executionRoot,
    args: ["remote", "get-url", "origin"],
  }).trim();
  const parsedRemote = parseGitHubRemote(originUrl);
  if (!parsedRemote || parsedRemote.host !== "github.com") {
    throw new Error(
      `fork-first-pr mode expects GitHub origin remote; got '${originUrl || "<missing>"}'.`,
    );
  }

  const forkOwner = asString(options.forkOwner) ?? "aor-bot";
  const baseRef = asString(options.baseRef) ?? options.gitHeadBefore.branch;
  const headBranch = asString(options.branchName) ?? `aor/${normalizeForId(options.runId)}`;
  const commitMessage = asString(options.commitMessage) ?? `AOR delivery ${options.runId}`;
  const prTitle = asString(options.prTitle) ?? `AOR delivery ${options.runId}`;
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
  const parsedForkRemote = parseGitHubRemote(forkRemoteUrl);
  const localForkRemote = path.isAbsolute(forkRemoteUrl) && fs.existsSync(forkRemoteUrl);
  if ((!parsedForkRemote && !localForkRemote) || (parsedForkRemote && parsedForkRemote.host !== parsedRemote.host) ||
      (parsedForkRemote && parsedForkRemote.owner.toLowerCase() === parsedRemote.owner.toLowerCase() &&
       parsedForkRemote.repo.toLowerCase() === parsedRemote.repo.toLowerCase())) {
    throw new Error("Fork remote must be a distinct repository on the verified upstream host.");
  }

  const intentToAddPaths = stageExpectedUntrackedPaths({
    executionRoot: options.executionRoot,
    expectedChangedPaths: options.expectedChangedPaths,
    commands,
  });
  let changedPaths;
  let diffStats;
  try {
    commands.push("git diff --name-only HEAD");
    changedPaths = parseLineList(
      runGitChecked({
        cwd: options.executionRoot,
        args: ["diff", "--name-only", "HEAD"],
      }),
    );

    commands.push("git diff --numstat HEAD");
    diffStats = parseNumstat(
      runGitChecked({
        cwd: options.executionRoot,
        args: ["diff", "--numstat", "HEAD"],
      }),
    );
  } finally {
    resetIntentToAddPaths({
      executionRoot: options.executionRoot,
      intentToAddPaths,
      commands,
    });
  }

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
    options.artifactsRoot,
    `fork-first-intent-${normalizeForId(options.runId)}-${Date.now()}.json`,
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
    return {
      commands,
      changedPaths,
      diffStats,
      outputs: planningOutputs,
    };
  }

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
    cwd: options.executionRoot,
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
      cwd: options.executionRoot,
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
      cwd: options.executionRoot,
      env: githubEnv,
    });
    forkState = "created";
  }
  const forkFullName = asString(forkMetadata.full_name);
  const forkParentFullName = asString(asRecord(forkMetadata.parent).full_name);
  const expectedForkFullName = `${forkOwner}/${parsedRemote.repo}`.toLowerCase();
  const expectedParentFullName = `${parsedRemote.owner}/${parsedRemote.repo}`.toLowerCase();
  if (forkFullName?.toLowerCase() !== expectedForkFullName || forkParentFullName?.toLowerCase() !== expectedParentFullName) {
    throw new Error("Fork repository metadata does not prove the requested fork identity and upstream parent.");
  }

  commands.push(`git checkout -B ${headBranch}`);
  runGitChecked({
    cwd: options.executionRoot,
    args: ["checkout", "-B", headBranch],
  });

  stageAuthorizedPaths({ executionRoot: options.executionRoot, expectedChangedPaths: options.expectedChangedPaths, commands });

  commands.push("git diff --cached --quiet");
  const stagedDiff = runGit({
    cwd: options.executionRoot,
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
    cwd: options.executionRoot,
    args: ["commit", "-m", commitMessage, "--no-verify"],
  });

  commands.push("git rev-parse HEAD");
  const commitSha = runGitChecked({
    cwd: options.executionRoot,
    args: ["rev-parse", "HEAD"],
  }).trim();

  commands.push(`git push ${forkRemoteUrl} HEAD:refs/heads/${headBranch} --force-with-lease`);
  runGitChecked({
    cwd: options.executionRoot,
    args: ["push", forkRemoteUrl, `HEAD:refs/heads/${headBranch}`, "--force-with-lease"],
  });

  commands.push("git show --name-only --pretty=format: HEAD");
  const networkChangedPaths = parseLineList(
    runGitChecked({
      cwd: options.executionRoot,
      args: ["show", "--name-only", "--pretty=format:", "HEAD"],
    }),
  );

  commands.push("git show --numstat --format= HEAD");
  const networkDiffStats = parseNumstat(
    runGitChecked({
      cwd: options.executionRoot,
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
    cwd: options.executionRoot,
    env: githubEnv,
  });

  const prNumber = typeof prResponse.number === "number" ? prResponse.number : null;
  const prUrl = asString(prResponse.html_url);
  return {
    commands,
    changedPaths: networkChangedPaths,
    diffStats: networkDiffStats,
    outputs: {
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
    },
  };
}

export function runForkFirstPrDeliveryMode(options) {
  return runTransactionCoordinator(executeForkFirstPrDeliveryTransaction, options);
}

/**
 * @param {{
 *   mode: "no-write" | "patch-only" | "local-branch" | "fork-first-pr",
 *   executionRoot: string,
 *   artifactsRoot: string,
 *   runId: string,
 *   gitHeadBefore: { branch: string },
 *   branchName?: string,
 *   commitMessage?: string,
 *   forkOwner?: string,
 *   forkRemoteUrl?: string,
 *   baseRef?: string,
 *   prTitle?: string,
 *   prBody?: string,
 *   enableNetworkWrite?: boolean,
 *   githubToken?: string,
 *   githubCliPath?: string,
 *   expectedChangedPaths?: string[],
 * }} options
 */
export function runDeliveryMode(options) {
  if (options.mode === "no-write") {
    return runNoWriteDeliveryMode();
  }
  if (options.mode === "patch-only") {
    return runPatchOnlyDeliveryMode(options);
  }
  if (options.mode === "local-branch") {
    return runLocalBranchDeliveryMode(options);
  }
  return runForkFirstPrDeliveryMode(options);
}
