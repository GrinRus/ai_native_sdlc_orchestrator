#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { validateCriticalPathManifest } from "./critical-path-coverage-lib.mjs";

const root = process.cwd();
const manifestPath = path.join(root, "scripts/critical-path-coverage.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const findings = validateCriticalPathManifest(manifest, root);

const executed = [];
if (findings.length === 0 && process.env.AOR_RUN_CRITICAL_PATH_TESTS === "1") {
  for (const entry of manifest.paths) {
    const result = spawnSync(process.execPath, ["--test", entry.test], {
      cwd: root,
      encoding: "utf8",
      timeout: Number(process.env.AOR_CRITICAL_PATH_TIMEOUT_MS ?? 180_000),
    });
    executed.push({ id: entry.id, test: entry.test, status: result.status === 0 ? "pass" : "fail" });
    if (result.error || result.status !== 0) {
      findings.push(`${entry.id}: focused test failed (${result.error?.message ?? `exit ${result.status}`})`);
    }
  }
}

const report = {
  schema_version: 1,
  status: findings.length === 0 ? "pass" : "fail",
  paths: manifest.paths ?? [],
  executed,
  execution_mode: process.env.AOR_RUN_CRITICAL_PATH_TESTS === "1" ? "focused-tests" : "manifest-only",
  findings,
};
const reportPath = path.join(root, ".aor/quality/critical-path-coverage.json");
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
if (findings.length > 0) {
  console.error(findings.join("\n"));
  process.exit(1);
}
console.log(`critical-path coverage ok: ${executed.length} invariant paths have positive and negative focused evidence`);
