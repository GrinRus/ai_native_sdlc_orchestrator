#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const manifestPath = path.join(root, "scripts/test-manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const coverage = manifest.gate_coverage ?? {};
const sourceExtensions = new Set(coverage.source_extensions ?? []);
const excluded = Array.isArray(coverage.exclusions) ? coverage.exclusions : [];
const now = Date.now();
const errors = [];
const normalize = (value) => String(value).replaceAll(path.sep, "/").replace(/^\.\//u, "");

for (const entry of excluded) {
  for (const field of ["path_prefix", "owner", "reason", "expires_at"]) {
    if (typeof entry?.[field] !== "string" || entry[field].trim() === "") errors.push(`Coverage exclusion requires ${field}.`);
  }
  if (entry?.expires_at && Date.parse(`${entry.expires_at}T23:59:59.999Z`) < now) {
    errors.push(`Coverage exclusion '${entry.path_prefix}' expired on ${entry.expires_at}.`);
  }
}

function gitFiles(args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.error || result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.error?.message ?? result.stderr}`);
  return result.stdout.split(/\r?\n/u).map(normalize).filter(Boolean);
}

const files = [...new Set([
  ...gitFiles(["ls-files", "--", "apps", "packages", "scripts"]),
  ...gitFiles(["ls-files", "--others", "--exclude-standard", "--", "apps", "packages", "scripts"]),
])].sort();
const sourceFiles = files.filter((file) => sourceExtensions.has(path.posix.extname(file)));
const excludedFiles = sourceFiles.filter((file) => excluded.some((entry) => file.startsWith(normalize(entry.path_prefix))));
const executableSourceFiles = sourceFiles.filter((file) => !excludedFiles.includes(file));
const lintTypecheck = executableSourceFiles;
const unitTests = files.filter((file) => file.endsWith(".test.mjs") && !file.startsWith("apps/web/browser/"));
const browserTests = files.filter((file) => file.startsWith("apps/web/browser/") && file.endsWith(".spec.mjs"));

const report = {
  schema_version: 1,
  status: errors.length === 0 ? "pass" : "fail",
  manifest_path: "scripts/test-manifest.json",
  source_files: lintTypecheck.map((file) => ({ file, checks: ["lint", "typecheck"] })),
  unit_tests: unitTests,
  browser_tests: browserTests,
  excluded_files: excludedFiles.map((file) => ({ file, ...excluded.find((entry) => file.startsWith(normalize(entry.path_prefix))) })),
  findings: errors,
};
const reportPath = path.join(root, ".aor/quality/gate-coverage.json");
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`gate coverage ok: ${lintTypecheck.length} source files, ${unitTests.length} unit tests, ${browserTests.length} browser tests, ${excludedFiles.length} excluded generated files`);
