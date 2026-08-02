import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const DEFAULT_TEST_MANIFEST_PATH = "scripts/test-manifest.json";

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function digestTestManifest(manifest) {
  return crypto.createHash("sha256").update(stableJson(manifest)).digest("hex");
}

export function loadTestManifest(rootDir, manifestPath = DEFAULT_TEST_MANIFEST_PATH) {
  const absolutePath = path.isAbsolute(manifestPath) ? manifestPath : path.join(rootDir, manifestPath);
  return {
    path: absolutePath,
    relativePath: path.relative(rootDir, absolutePath).replaceAll(path.sep, "/"),
    document: JSON.parse(fs.readFileSync(absolutePath, "utf8")),
  };
}

export function listTrackedTestCandidates(rootDir) {
  const run = spawnSync("git", ["ls-files", "--", "*.test.mjs"], { cwd: rootDir, encoding: "utf8" });
  if (run.status !== 0) throw new Error(`Could not list tracked tests: ${run.stderr.trim()}`);
  return run.stdout.split(/\r?\n/u).map((entry) => entry.trim()).filter(Boolean).sort();
}

function validateExclusion(exclusion, now) {
  const errors = [];
  for (const field of ["path", "owner", "reason", "expires_at"]) {
    if (typeof exclusion?.[field] !== "string" || exclusion[field].trim().length === 0) {
      errors.push(`Test exclusion must declare non-empty ${field}.`);
    }
  }
  if (typeof exclusion?.expires_at === "string") {
    const expiry = Date.parse(`${exclusion.expires_at}T23:59:59.999Z`);
    if (!Number.isFinite(expiry)) errors.push(`Test exclusion '${exclusion.path}' has invalid expires_at.`);
    else if (expiry < now.getTime()) errors.push(`Test exclusion '${exclusion.path}' expired on ${exclusion.expires_at}.`);
  }
  return errors;
}

export function buildTestExecutionPlan({ rootDir, manifest, candidates, now = new Date() }) {
  const errors = [];
  const groups = Array.isArray(manifest.groups) ? manifest.groups : [];
  const exclusions = Array.isArray(manifest.exclusions) ? manifest.exclusions : [];
  const groupIds = new Set();
  const exclusionByPath = new Map();

  for (const group of groups) {
    if (typeof group.group_id !== "string" || group.group_id.length === 0) errors.push("Every test group needs group_id.");
    else if (groupIds.has(group.group_id)) errors.push(`Duplicate test group '${group.group_id}'.`);
    else groupIds.add(group.group_id);
    if (!Array.isArray(group.path_prefixes) || group.path_prefixes.length === 0) {
      errors.push(`Test group '${group.group_id}' needs path_prefixes.`);
    }
    if (!new Set(["standard", "private-proof-harness"]).has(group.timeout_class)) {
      errors.push(`Test group '${group.group_id}' has invalid timeout_class '${group.timeout_class}'.`);
    }
    if (group.test_concurrency !== undefined && (!Number.isInteger(group.test_concurrency) || group.test_concurrency < 1)) {
      errors.push(`Test group '${group.group_id}' has invalid test_concurrency '${group.test_concurrency}'.`);
    }
  }

  for (const exclusion of exclusions) {
    errors.push(...validateExclusion(exclusion, now));
    if (exclusionByPath.has(exclusion.path)) errors.push(`Duplicate test exclusion '${exclusion.path}'.`);
    exclusionByPath.set(exclusion.path, exclusion);
  }

  const plannedGroups = groups.map((group) => ({
    group_id: group.group_id,
    timeout_class: group.timeout_class,
    test_concurrency: group.test_concurrency,
    files: [],
  }));
  const plannedById = new Map(plannedGroups.map((group) => [group.group_id, group]));
  const excluded = [];

  for (const candidate of candidates) {
    const exclusion = exclusionByPath.get(candidate);
    const matches = groups.filter((group) => group.path_prefixes.some((prefix) => candidate.startsWith(prefix)));
    if (exclusion) {
      if (matches.length > 0) errors.push(`Excluded test '${candidate}' is also mapped to group(s): ${matches.map((g) => g.group_id).join(", ")}.`);
      excluded.push(exclusion);
      continue;
    }
    if (matches.length === 0) errors.push(`Tracked test '${candidate}' is not mapped to a test group.`);
    if (matches.length > 1) errors.push(`Tracked test '${candidate}' maps to multiple groups: ${matches.map((g) => g.group_id).join(", ")}.`);
    if (matches.length === 1) plannedById.get(matches[0].group_id).files.push(candidate);
  }

  for (const exclusionPath of exclusionByPath.keys()) {
    if (!candidates.includes(exclusionPath)) errors.push(`Test exclusion '${exclusionPath}' does not match a tracked test.`);
  }

  for (const group of plannedGroups) group.files.sort();
  return {
    ok: errors.length === 0,
    errors,
    candidate_count: candidates.length,
    excluded: excluded.sort((a, b) => a.path.localeCompare(b.path)),
    groups: plannedGroups.filter((group) => group.files.length > 0),
  };
}

export function discoverTestExecutionPlan(rootDir, manifestPath = DEFAULT_TEST_MANIFEST_PATH) {
  const loaded = loadTestManifest(rootDir, manifestPath);
  const candidates = listTrackedTestCandidates(rootDir);
  const plan = buildTestExecutionPlan({ rootDir, manifest: loaded.document, candidates });
  return {
    ...plan,
    candidates,
    manifest_path: loaded.relativePath,
    manifest_digest: digestTestManifest(loaded.document),
    report_path: loaded.document.report_path,
  };
}

export function readGitHead(rootDir) {
  const run = spawnSync("git", ["rev-parse", "HEAD"], { cwd: rootDir, encoding: "utf8" });
  if (run.status !== 0) throw new Error(`Could not resolve Git HEAD: ${run.stderr.trim()}`);
  return run.stdout.trim();
}

export function writeTestExecutionReport(rootDir, reportPath, report) {
  const absolutePath = path.isAbsolute(reportPath) ? reportPath : path.join(rootDir, reportPath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return absolutePath;
}

export function validateTestExecutionReport(rootDir, options = {}) {
  const plan = discoverTestExecutionPlan(rootDir, options.manifestPath);
  const reportPath = options.reportPath ?? plan.report_path;
  const absoluteReportPath = path.isAbsolute(reportPath) ? reportPath : path.join(rootDir, reportPath);
  const errors = [...plan.errors];
  if (!fs.existsSync(absoluteReportPath)) {
    errors.push(`Test execution report '${reportPath}' is missing; run pnpm test first.`);
    return { ok: false, errors, plan, report: null, report_path: reportPath };
  }

  let report = null;
  try {
    report = JSON.parse(fs.readFileSync(absoluteReportPath, "utf8"));
  } catch (error) {
    errors.push(`Test execution report '${reportPath}' is invalid JSON: ${error.message}`);
  }
  if (!report) return { ok: false, errors, plan, report: null, report_path: reportPath };

  if (report.status !== "pass") errors.push(`Test execution report status is '${report.status}', expected 'pass'.`);
  if (report.git_head !== readGitHead(rootDir)) errors.push("Test execution report does not match current Git HEAD.");
  if (report.manifest_digest !== plan.manifest_digest) errors.push("Test execution report does not match current manifest digest.");
  const discovered = Array.isArray(report.discovered_files) ? [...report.discovered_files].sort() : [];
  const executed = Array.isArray(report.executed_files) ? [...report.executed_files].sort() : [];
  const expected = plan.candidates.filter((file) => !plan.excluded.some((entry) => entry.path === file)).sort();
  const reportedGroups = Array.isArray(report.groups) ? report.groups : [];
  const groupExecutions = reportedGroups.flatMap((group) => (Array.isArray(group.files) ? group.files : []));
  const recomputedDuplicates = [...new Set(groupExecutions.filter((file, index) => groupExecutions.indexOf(file) !== index))];
  if (JSON.stringify(discovered) !== JSON.stringify(plan.candidates)) errors.push("Test report discovered_files differs from tracked candidates.");
  if (JSON.stringify(executed) !== JSON.stringify(expected)) errors.push("Test report executed_files does not cover every non-excluded candidate exactly once.");
  if (JSON.stringify([...new Set(groupExecutions)].sort()) !== JSON.stringify(expected)) {
    errors.push("Test report group execution does not cover every non-excluded candidate.");
  }
  if (reportedGroups.some((group) => group.status !== "pass")) errors.push("Test report contains a non-passing group.");
  if (recomputedDuplicates.length > 0) errors.push(`Test report groups duplicate: ${recomputedDuplicates.join(", ")}.`);
  if (Array.isArray(report.duplicate_files) && report.duplicate_files.length > 0) errors.push("Test report contains duplicate executions.");
  if (Array.isArray(report.missing_files) && report.missing_files.length > 0) errors.push("Test report contains missing executions.");

  return { ok: errors.length === 0, errors, plan, report, report_path: reportPath };
}
