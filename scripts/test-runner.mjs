#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  discoverTestExecutionPlan,
  readGitHead,
  writeTestExecutionReport,
} from "./test-discovery.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const standardTimeoutMs = Number(process.env.AOR_TEST_GROUP_TIMEOUT_MS ?? 8 * 60 * 1000);
const privateTimeoutMs = Number(process.env.AOR_LIVE_E2E_TEST_SUITE_TIMEOUT_MS ?? 20 * 60 * 1000);
const privateContextFile = path.join(os.tmpdir(), `aor-live-e2e-test-context-${process.pid}`);
const startedAt = new Date().toISOString();
const plan = discoverTestExecutionPlan(root);

if (!plan.ok) {
  for (const error of plan.errors) console.error(error);
  process.exit(1);
}

const report = {
  schema_version: 1,
  status: "running",
  git_head: readGitHead(root),
  node_version: process.version,
  manifest_path: plan.manifest_path,
  manifest_digest: plan.manifest_digest,
  started_at: startedAt,
  finished_at: null,
  discovered_files: plan.candidates,
  excluded_files: plan.excluded,
  groups: [],
  executed_files: [],
  duplicate_files: [],
  missing_files: [...plan.candidates],
};

function persistReport() {
  writeTestExecutionReport(root, plan.report_path, report);
}

function runCommand(label, command, args, options = {}) {
  const groupStarted = Date.now();
  const run = spawnSync(command, args, {
    cwd: root,
    env: options.env ?? process.env,
    stdio: "inherit",
    timeout: options.timeout,
    killSignal: "SIGKILL",
  });
  if (run.status !== 0) {
    const timeout = run.error?.code === "ETIMEDOUT";
    const error = new Error(`${label} failed${timeout ? ` after timeout ${options.timeout}ms` : ""}.`);
    error.durationMs = Date.now() - groupStarted;
    throw error;
  }
  return Date.now() - groupStarted;
}

function refreshExecutionAccounting() {
  const executions = report.groups.flatMap((group) => group.files);
  report.executed_files = [...new Set(executions)].sort();
  report.duplicate_files = [...new Set(executions.filter((file, index) => executions.indexOf(file) !== index))].sort();
  report.missing_files = plan.candidates.filter(
    (file) => !report.executed_files.includes(file) && !plan.excluded.some((entry) => entry.path === file),
  );
}

persistReport();

try {
  runCommand("repository integrity checks", process.execPath, ["./scripts/test.mjs"], {
    env: { ...process.env, AOR_TEST_INTEGRITY_ONLY: "1" },
    timeout: standardTimeoutMs,
  });
  runCommand("web dist freshness", process.execPath, ["./scripts/web-dist-freshness.mjs", "check"], {
    timeout: standardTimeoutMs,
  });

  for (const group of plan.groups) {
    const timeout = group.timeout_class === "private-proof-harness" ? privateTimeoutMs : standardTimeoutMs;
    fs.rmSync(privateContextFile, { force: true });
    try {
      const durationMs = runCommand(
        `test group '${group.group_id}'`,
        process.execPath,
        ["--test", ...group.files.map((file) => path.join(root, file))],
        {
          timeout,
          env:
            group.timeout_class === "private-proof-harness"
              ? { ...process.env, AOR_PROOF_RUNNER_TEST_CONTEXT_FILE: privateContextFile }
              : process.env,
        },
      );
      report.groups.push({
        group_id: group.group_id,
        timeout_class: group.timeout_class,
        status: "pass",
        duration_ms: durationMs,
        files: group.files,
      });
      refreshExecutionAccounting();
      persistReport();
    } catch (error) {
      report.groups.push({
        group_id: group.group_id,
        timeout_class: group.timeout_class,
        status: "fail",
        duration_ms: Number(error?.durationMs ?? 0),
        files: group.files,
      });
      throw error;
    }
  }

  runCommand("reference integrity", process.execPath, ["./scripts/reference-integrity.mjs"], {
    timeout: standardTimeoutMs,
  });
  refreshExecutionAccounting();
  if (report.duplicate_files.length > 0 || report.missing_files.length > 0) {
    throw new Error(
      `Test execution accounting failed: duplicate=${report.duplicate_files.join(",")}; missing=${report.missing_files.join(",")}.`,
    );
  }
  report.status = "pass";
  report.finished_at = new Date().toISOString();
  persistReport();
  console.log(`test execution manifest ok: ${report.executed_files.length}/${plan.candidate_count} tracked tests executed once`);
} catch (error) {
  refreshExecutionAccounting();
  report.status = "fail";
  report.finished_at = new Date().toISOString();
  report.failure = error instanceof Error ? error.message : String(error);
  persistReport();
  console.error(report.failure);
  process.exit(1);
} finally {
  fs.rmSync(privateContextFile, { force: true });
}
