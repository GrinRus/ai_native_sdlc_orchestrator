#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultManifestPath = "scripts/bootstrap-remediation-manifest.json";
const defaultReportPath = ".aor/quality/bootstrap-remediation-gate.json";
const sourceExtensions = new Set([".css", ".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const checkIds = new Set(["lint", "typecheck", "test"]);

function normalizePath(value) {
  return String(value).replaceAll(path.sep, "/").replace(/^\.\//u, "");
}

function readJson(rootDir, file) {
  return JSON.parse(fs.readFileSync(path.join(rootDir, file), "utf8"));
}

function runGit(rootDir, args) {
  const result = spawnSync("git", args, { cwd: rootDir, encoding: "utf8" });
  if (result.error) throw new Error(`git ${args.join(" ")} could not start: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed with exit ${result.status}: ${(result.stderr ?? "").trim()}`);
  }
  return (result.stdout ?? "")
    .split(/\r?\n/u)
    .map((entry) => normalizePath(entry.trim()))
    .filter(Boolean);
}

function refExists(rootDir, ref) {
  const result = spawnSync("git", ["rev-parse", "--verify", ref], { cwd: rootDir, encoding: "utf8" });
  return !result.error && result.status === 0;
}

export function resolveBaseRef(rootDir, requestedRef = "origin/main") {
  if (requestedRef && refExists(rootDir, requestedRef)) return requestedRef;
  if (refExists(rootDir, "HEAD^")) return "HEAD^";
  return null;
}

export function collectChangedFiles(rootDir, baseRef = "origin/main") {
  const files = new Set();
  const resolvedBase = resolveBaseRef(rootDir, baseRef);
  if (resolvedBase) {
    for (const file of runGit(rootDir, ["diff", "--name-only", "--diff-filter=ACMR", `${resolvedBase}...HEAD`])) files.add(file);
  }
  for (const args of [
    ["diff", "--name-only", "--diff-filter=ACMR"],
    ["diff", "--cached", "--name-only", "--diff-filter=ACMR"],
    ["ls-files", "--others", "--exclude-standard"],
  ]) {
    for (const file of runGit(rootDir, args)) files.add(file);
  }
  return [...files].sort();
}

function matchesFileClass(file, fileClass) {
  const prefixes = Array.isArray(fileClass.path_prefixes) ? fileClass.path_prefixes : [];
  if (prefixes.length > 0 && !prefixes.some((prefix) => file.startsWith(normalizePath(prefix)))) return false;
  if (Array.isArray(fileClass.exclude_suffixes) && fileClass.exclude_suffixes.some((suffix) => file.endsWith(String(suffix)))) return false;
  if (Array.isArray(fileClass.suffixes) && fileClass.suffixes.length > 0) {
    return fileClass.suffixes.some((suffix) => file.endsWith(String(suffix)));
  }
  if (Array.isArray(fileClass.extensions) && fileClass.extensions.length > 0) {
    return fileClass.extensions.includes(path.posix.extname(file));
  }
  return false;
}

export function buildChangedFileExecutionPlan({ changedFiles, manifest }) {
  const errors = [];
  const classes = Array.isArray(manifest?.file_classes) ? manifest.file_classes : [];
  const ignoredPrefixes = Array.isArray(manifest?.ignored_path_prefixes)
    ? manifest.ignored_path_prefixes.map(normalizePath)
    : [];
  const executableFiles = changedFiles
    .map(normalizePath)
    .filter((file) => sourceExtensions.has(path.posix.extname(file)))
    .filter((file) => !ignoredPrefixes.some((prefix) => file.startsWith(prefix)))
    .sort();
  const filePlans = [];
  const checks = new Map();

  for (const file of executableFiles) {
    const matchingClasses = classes.filter((fileClass) => matchesFileClass(file, fileClass));
    if (matchingClasses.length === 0) {
      errors.push(`Changed source/test file '${file}' is not covered by bootstrap-remediation-manifest.json.`);
      continue;
    }
    if (matchingClasses.length > 1) {
      errors.push(`Changed source/test file '${file}' matches multiple file classes: ${matchingClasses.map((entry) => entry.class_id).join(", ")}.`);
      continue;
    }
    const requiredChecks = Array.isArray(matchingClasses[0].required_checks)
      ? [...new Set(matchingClasses[0].required_checks)]
      : [];
    const invalidChecks = requiredChecks.filter((checkId) => !checkIds.has(checkId));
    if (invalidChecks.length > 0) {
      errors.push(`File class '${matchingClasses[0].class_id}' declares unknown checks: ${invalidChecks.join(", ")}.`);
      continue;
    }
    if (requiredChecks.length === 0) {
      errors.push(`File class '${matchingClasses[0].class_id}' must declare required_checks.`);
      continue;
    }
    filePlans.push({ file, class_id: matchingClasses[0].class_id, required_checks: requiredChecks });
    for (const checkId of requiredChecks) {
      if (!checks.has(checkId)) checks.set(checkId, new Set());
      checks.get(checkId).add(file);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    changed_files: changedFiles.map(normalizePath).sort(),
    executable_files: executableFiles,
    files: filePlans,
    checks: [...checks.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([check_id, files]) => ({ check_id, files: [...files].sort() })),
  };
}

function classifyProcessResult(result, timeoutMs) {
  const errorCode = result?.error?.code;
  if (errorCode === "ETIMEDOUT") return { ok: false, failure_type: "timeout", message: `timed out after ${timeoutMs}ms` };
  if (result?.error) return { ok: false, failure_type: "spawn_error", message: result.error.message };
  if (result?.signal) return { ok: false, failure_type: "signal", message: `terminated by ${result.signal}` };
  if (result?.status !== 0) return { ok: false, failure_type: "exit", message: `exited with status ${result?.status ?? "unknown"}` };
  return { ok: true, failure_type: null, message: "completed successfully" };
}

/**
 * @param {{ label: string, command: string, args?: string[], cwd?: string, env?: Record<string, string | undefined>, timeoutMs?: number, runner?: (command: string, args: string[], options: Record<string, unknown>) => any }} options
 */
export function runCheckedCommand({
  label,
  command,
  args = [],
  cwd,
  env = process.env,
  timeoutMs = 120_000,
  runner = spawnSync,
}) {
  let result;
  try {
    result = runner(command, args, {
      cwd,
      env,
      encoding: "utf8",
      timeout: timeoutMs,
      killSignal: "SIGKILL",
      stdio: "pipe",
    });
  } catch (error) {
    return {
      label,
      command: [command, ...args],
      ok: false,
      failure_type: "spawn_error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
  const classification = classifyProcessResult(result, timeoutMs);
  return {
    label,
    command: [command, ...args],
    ...classification,
    exit_code: result?.status ?? null,
    signal: result?.signal ?? null,
    stderr: String(result?.stderr ?? "").trim(),
    stdout: String(result?.stdout ?? "").trim(),
  };
}

function commandForCheck(checkId, files, rootDir) {
  if (checkId === "lint") return { command: "pnpm", args: ["exec", "eslint", "--no-warn-ignored", ...files] };
  if (checkId === "typecheck") return { command: "pnpm", args: ["typecheck"] };
  if (checkId === "test") return { command: process.execPath, args: ["--test", ...files.map((file) => path.join(rootDir, file))] };
  throw new Error(`Unsupported bootstrap check '${checkId}'.`);
}

/**
 * @param {{ rootDir?: string, baseRef?: string, manifestPath?: string, reportPath?: string, timeoutMs?: number, runner?: (command: string, args: string[], options: Record<string, unknown>) => any }} options
 */
export function runBootstrapRemediationGate({
  rootDir = defaultRoot,
  baseRef = "origin/main",
  manifestPath = defaultManifestPath,
  reportPath = defaultReportPath,
  timeoutMs = 120_000,
  runner = spawnSync,
} = {}) {
  const manifest = readJson(rootDir, manifestPath);
  const changedFiles = collectChangedFiles(rootDir, baseRef);
  const plan = buildChangedFileExecutionPlan({ changedFiles, manifest });
  const checks = [];
  if (plan.ok) {
    for (const check of plan.checks) {
      const executable = commandForCheck(check.check_id, check.files, rootDir);
      checks.push(
        runCheckedCommand({
          label: check.check_id,
          ...executable,
          cwd: rootDir,
          timeoutMs,
          runner,
        }),
      );
    }
  }
  const failures = [...plan.errors, ...checks.filter((check) => !check.ok).map((check) => `${check.label}: ${check.failure_type}: ${check.message}`)];
  const result = {
    schema_version: 1,
    status: failures.length === 0 ? "pass" : "fail",
    base_ref: resolveBaseRef(rootDir, baseRef),
    changed_files: plan.changed_files,
    executable_files: plan.executable_files,
    file_execution: plan.files,
    checks,
    failures,
  };
  const absoluteReportPath = path.isAbsolute(reportPath) ? reportPath : path.join(rootDir, reportPath);
  fs.mkdirSync(path.dirname(absoluteReportPath), { recursive: true });
  fs.writeFileSync(absoluteReportPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return result;
}

function main() {
  const result = runBootstrapRemediationGate();
  if (result.status === "pass") {
    console.log(`bootstrap remediation gate passed: ${result.executable_files.length} changed source/test files accounted for`);
    for (const check of result.checks) console.log(`- ${check.label}: ${check.message}`);
    return;
  }
  console.error("bootstrap remediation gate failed:");
  for (const failure of result.failures) console.error(`- ${failure}`);
  process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) main();
