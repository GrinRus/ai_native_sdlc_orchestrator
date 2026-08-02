function record(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}

function strings(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string" && entry.trim()) : [];
}

function prefix(sourceRoot, changedPath) {
  return sourceRoot === "." ? changedPath : `${sourceRoot.replace(/\/+$/u, "")}/${changedPath}`;
}

export function executeIndependentRepositoryDeliveries(options) {
  const results = new Map();
  const commands = [];
  const changedPaths = [];
  const diffStats = { files: [], totals: { files: 0, added: 0, deleted: 0 } };
  for (const target of options.targets) {
    const authorization = record(options.authorizations[target.repo_id]);
    const headBefore = options.readHead(target.repoRoot);
    try {
      if (options.mode !== "no-write") {
        if (Object.keys(authorization).length === 0) {
          throw new Error(`Repository '${target.repo_id}' has no exact diff authorization.`);
        }
        options.assertDiff(target.repoRoot, authorization);
      }
      const result = options.runMode({
        ...options.modeOptions,
        mode: options.mode,
        executionRoot: target.repoRoot,
        runId: `${options.runId}-${target.repo_id}`,
        gitHeadBefore: headBefore,
        branchName: options.branchName ? `${options.branchName}-${target.repo_id}` : undefined,
        expectedChangedPaths: strings(record(authorization.changes).all_paths),
      });
      const prefixedPaths = result.changedPaths.map((entry) => prefix(target.sourceRoot, entry));
      results.set(target.repo_id, {
        status: "success",
        ...result,
        changedPaths: prefixedPaths,
        headBefore,
        headAfter: options.readHead(target.repoRoot),
      });
      commands.push(...result.commands.map((command) => `[${target.repo_id}] ${command}`));
      changedPaths.push(...prefixedPaths);
      diffStats.files.push(...result.diffStats.files.map((entry) => ({ ...entry, path: prefix(target.sourceRoot, entry.path) })));
      diffStats.totals.files += result.diffStats.totals.files;
      diffStats.totals.added += result.diffStats.totals.added;
      diffStats.totals.deleted += result.diffStats.totals.deleted;
    } catch (error) {
      results.set(target.repo_id, {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        commands: [],
        changedPaths: [],
        diffStats: { files: [], totals: { files: 0, added: 0, deleted: 0 } },
        outputs: {},
        headBefore,
        headAfter: options.readHead(target.repoRoot),
      });
    }
  }
  const failed = [...results.entries()].filter(([, result]) => result.status === "failed");
  return {
    results,
    commands,
    changedPaths,
    diffStats,
    outputs: {
      repository_outputs: Object.fromEntries([...results.entries()].map(([repoId, result]) => [repoId, result.outputs])),
    },
    status: failed.length > 0 ? "failed" : "success",
    errorMessage: failed.length > 0
      ? failed.map(([repoId, result]) => `${repoId}: ${result.error}`).join("; ")
      : null,
    recoverySteps: failed.length > 0
      ? ["Inspect each repository transaction in the delivery transcript; retain successful outputs and retry only failed repositories."]
      : null,
  };
}

export function resolveIndependentRepositoryTargets(repositories, executionRoot) {
  const targets = repositories.map((repo) => {
    const sourceRoot = repo.source_root ?? ".";
    const repoRoot = path.isAbsolute(sourceRoot) ? sourceRoot : path.resolve(executionRoot, sourceRoot);
    return { ...repo, sourceRoot, repoRoot };
  });
  const independent = targets.filter((target) => {
    if (!fs.existsSync(target.repoRoot)) return false;
    const resolved = fs.realpathSync(target.repoRoot);
    const result = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: resolved, encoding: "utf8" });
    return result.status === 0 && fs.realpathSync(result.stdout.trim()) === resolved;
  });
  const enabled = repositories.length > 1
    && repositories.every((repo) => typeof repo.source_root === "string" && repo.source_root.length > 0)
    && independent.length === repositories.length
    && new Set(independent.map((repo) => fs.realpathSync(repo.repoRoot))).size === repositories.length;
  return { targets: independent, enabled };
}

export function collectRepositoryOutputRefs(outputs, projectRoot, toEvidenceRef) {
  const refs = [];
  for (const repositoryOutput of Object.values(record(outputs.repository_outputs))) {
    const output = record(repositoryOutput);
    if (typeof output.patch_file === "string") refs.push(toEvidenceRef(projectRoot, output.patch_file));
    if (typeof output.api_intent_file === "string") refs.push(toEvidenceRef(projectRoot, output.api_intent_file));
  }
  return refs;
}
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
