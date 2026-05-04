import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * @param {{ cwd: string, args: string[] }} options
 */
export function runGitChecked(options) {
  const run = spawnSync("git", options.args, { cwd: options.cwd, encoding: "utf8" });
  if (run.status !== 0) {
    throw new Error(`git ${options.args.join(" ")} failed: ${(run.stderr ?? run.stdout ?? "").trim()}`);
  }
}

/**
 * @param {{ repoRoot: string, workspaceRoot: string }} options
 */
function initializeFixtureRepo(options) {
  fs.cpSync(path.join(options.workspaceRoot, "examples"), path.join(options.repoRoot, "examples"), { recursive: true });
  runGitChecked({ cwd: options.repoRoot, args: ["init"] });
  runGitChecked({ cwd: options.repoRoot, args: ["config", "user.email", "aor@example.com"] });
  runGitChecked({ cwd: options.repoRoot, args: ["config", "user.name", "AOR Test"] });
  runGitChecked({ cwd: options.repoRoot, args: ["add", "-A"] });
  runGitChecked({ cwd: options.repoRoot, args: ["commit", "-m", "initial"] });
}

/**
 * @template T
 * @param {{ prefix: string, workspaceRoot: string }} options
 * @param {(repoRoot: string) => T | Promise<T>} callback
 * @returns {T | Promise<T>}
 */
export function withTempRepo(options, callback) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), options.prefix));
  initializeFixtureRepo({ repoRoot, workspaceRoot: options.workspaceRoot });

  try {
    const result = callback(repoRoot);
    if (result && typeof /** @type {{ then?: unknown }} */ (result).then === "function") {
      return Promise.resolve(result).finally(() => fs.rmSync(repoRoot, { recursive: true, force: true }));
    }
    fs.rmSync(repoRoot, { recursive: true, force: true });
    return result;
  } catch (error) {
    fs.rmSync(repoRoot, { recursive: true, force: true });
    throw error;
  }
}
