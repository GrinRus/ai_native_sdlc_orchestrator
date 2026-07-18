import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { normalizeId, nowIso, writeJson } from "./common.mjs";

const SETUP_OUTPUT_LIMIT = 12_000;

function boundedSetupOutput(value) {
  const redacted = String(value ?? "")
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/giu, "$1[redacted]@")
    .replace(/\b([A-Z][A-Z0-9_]*(?:TOKEN|PASSWORD|SECRET|API_KEY))=\S+/gu, "$1=[redacted]");
  if (redacted.length <= SETUP_OUTPUT_LIMIT) return redacted;
  const half = Math.floor(SETUP_OUTPUT_LIMIT / 2);
  return `${redacted.slice(0, half)}\n...[bounded live E2E setup output]...\n${redacted.slice(-half)}`;
}

/**
 * Materialize declared dependencies in the disposable target checkout so
 * workspace isolation can copy them without granting provider network access.
 * The caller remains responsible for checking tracked checkout cleanliness.
 *
 * @param {{ targetCheckoutRoot: string, reportsRoot: string, runId: string,
 *   setupCommands: string[], env: NodeJS.ProcessEnv, timeoutMs: number | null }} options
 */
export function prepareProviderWorkspaceDependencies(options) {
  const startedAt = nowIso();
  const commandReports = options.setupCommands.map((command) => {
    const commandStartedAt = nowIso();
    const result = spawnSync("/bin/sh", ["-lc", command], {
      cwd: options.targetCheckoutRoot,
      env: options.env,
      encoding: "utf8",
      timeout: options.timeoutMs ?? undefined,
      maxBuffer: 16 * 1024 * 1024,
    });
    return {
      command,
      status: result.status === 0 && !result.error ? "pass" : "fail",
      exit_code: result.status ?? -1,
      signal: result.signal ?? null,
      timed_out: result.error?.code === "ETIMEDOUT",
      stdout: boundedSetupOutput(result.stdout),
      stderr: boundedSetupOutput(result.stderr || result.error?.message),
      started_at: commandStartedAt,
      finished_at: nowIso(),
    };
  });
  const status = options.setupCommands.length === 0
    ? "skipped"
    : commandReports.every((entry) => entry.status === "pass") ? "pass" : "fail";
  const report = {
    run_id: options.runId,
    status,
    purpose: "Materialize declared dependencies for the disposable provider workspace.",
    source_checkout_kind: "disposable-live-e2e-target",
    setup_commands: commandReports,
    dependency_roots: ["node_modules"].filter((entry) =>
      fs.existsSync(path.join(options.targetCheckoutRoot, entry))),
    summary: status === "pass"
      ? "Declared setup commands completed in the disposable target checkout."
      : status === "skipped"
        ? "No target setup commands were declared."
        : "A declared setup command failed before provider execution.",
    started_at: startedAt,
    finished_at: nowIso(),
  };
  const reportFile = path.join(options.reportsRoot,
    `live-e2e-provider-workspace-setup-${normalizeId(options.runId)}.json`);
  writeJson(reportFile, report);
  return { status, report, reportFile };
}

/**
 * @param {{ targetCheckoutRoot: string, reportsRoot: string, runId: string,
 *   setupCommands: string[], env: NodeJS.ProcessEnv, timeoutMs: number | null,
 *   artifacts: Record<string, unknown> }} options
 */
export function requireProviderWorkspaceDependencies(options) {
  const result = prepareProviderWorkspaceDependencies(options);
  options.artifacts.provider_workspace_setup_file = result.reportFile;
  options.artifacts.provider_workspace_setup = result.report;
  if (result.status === "fail") throw new Error(result.report.summary);
  return result.reportFile;
}
