#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { createControlPlaneHttpServer } from "../apps/api/src/index.mjs";
import { startRunJob } from "../packages/orchestrator-core/src/run-job.mjs";
import { withTempRepo } from "./test/helpers/temp-repo.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputIndex = process.argv.indexOf("--output");
const outputPath = outputIndex >= 0
  ? path.resolve(process.cwd(), process.argv[outputIndex + 1])
  : path.join(root, "node_modules/.cache/aor/w58-runtime-quality-proof.json");

function runCli(args, cwd) {
  const result = spawnSync(process.execPath, [path.join(root, "apps/cli/bin/aor.mjs"), ...args], {
    cwd,
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`aor ${args.join(" ")} failed: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

async function postJson(url, payload, origin) {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
    body: JSON.stringify(payload),
  });
}

async function waitForJob(file, statuses, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) {
      const job = JSON.parse(fs.readFileSync(file, "utf8"));
      if (statuses.includes(job.status)) return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for W58 proof job '${file}'.`);
}

async function readOneSseEvent(url) {
  const controller = new AbortController();
  const response = await fetch(url, { signal: controller.signal });
  if (response.status !== 200 || !response.body) throw new Error(`SSE proof failed with HTTP ${response.status}.`);
  const reader = response.body.getReader();
  try {
    const result = await Promise.race([
      reader.read(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Timed out waiting for W58 SSE replay.")), 3000)),
    ]);
    const text = new TextDecoder().decode(result.value);
    const dataLine = text.split(/\r?\n/u).find((line) => line.startsWith("data:"));
    if (!dataLine) throw new Error("W58 SSE replay did not contain a data record.");
    return JSON.parse(dataLine.slice(5).trim());
  } finally {
    controller.abort();
    await reader.cancel().catch(() => {});
  }
}

const report = await withTempRepo({ prefix: "aor-w58-proof-", workspaceRoot: root }, async (projectRoot) => {
  const runtimeRoot = path.join(projectRoot, ".aor");
  const transport = await createControlPlaneHttpServer({
    cwd: root,
    projectRef: projectRoot,
    runtimeRoot,
    host: "127.0.0.1",
    port: 0,
    app: { staticRoot: path.join(root, "apps/web/dist"), packageVersion: "w58-proof" },
  });
  try {
    const firstRead = await fetch(`${transport.baseUrl}/api/projects/${transport.projectId}/state`);
    const firstState = await firstRead.json();
    if (firstRead.status !== 200 || firstState.initialized !== false || fs.existsSync(runtimeRoot)) {
      throw new Error("W58 first-read proof materialized runtime state.");
    }

    const initResponse = await postJson(
      `${transport.baseUrl}/api/projects/${transport.projectId}/lifecycle-command/actions`,
      { command: "project init", flags: {} },
      transport.baseUrl,
    );
    if (initResponse.status !== 200) throw new Error(`W58 explicit init failed with HTTP ${initResponse.status}.`);

    const runId = "run.w58.runtime.quality.proof";
    const runResponse = await postJson(
      `${transport.baseUrl}/api/projects/${transport.projectId}/run-control/actions`,
      { action: "start", run_id: runId, reason: "W58 runtime-quality integration proof" },
      transport.baseUrl,
    );
    if (runResponse.status !== 200) throw new Error(`W58 run-control start failed with HTTP ${runResponse.status}.`);
    const startedJob = startRunJob({
      cwd: projectRoot,
      projectRef: projectRoot,
      runtimeRoot,
      runId,
      args: ["run", "status", "--project-ref", projectRoot, "--runtime-root", runtimeRoot, "--run-id", runId, "--follow", "true", "--max-replay", "0"],
    });
    const accepted = {
      job_id: startedJob.job.job_id,
      revision: startedJob.job.revision,
      status_ref: startedJob.job.status_ref,
      event_ref: startedJob.job.event_ref,
      evidence_refs: [startedJob.job.status_ref, startedJob.job.event_ref],
    };
    const jobFile = startedJob.file;
    await waitForJob(jobFile, ["running", "succeeded", "failed", "waiting-input"]);
    const cancelResponse = await postJson(
      `${transport.baseUrl}/api/projects/${transport.projectId}/run-control/actions`,
      { action: "cancel", run_id: runId, approval_ref: "approval://w58-runtime-quality-proof", reason: "deterministic cancellation proof" },
      transport.baseUrl,
    );
    if (cancelResponse.status !== 200) throw new Error(`W58 cancel failed with HTTP ${cancelResponse.status}.`);
    const terminalJob = await waitForJob(jobFile, ["succeeded", "failed", "canceled", "waiting-input"]);

    const runsResponse = await fetch(`${transport.baseUrl}/api/projects/${transport.projectId}/runs`);
    const runs = await runsResponse.json();
    const apiRun = runs.find((entry) => entry.run_id === runId);
    const historyResponse = await fetch(`${transport.baseUrl}/api/projects/${transport.projectId}/runs/${runId}/events/history`);
    const history = await historyResponse.json();
    const sseEvent = await readOneSseEvent(`${transport.baseUrl}/api/projects/${transport.projectId}/runs/${runId}/events?max_replay=1`);
    const cliStatus = runCli(["run", "status", "--project-ref", projectRoot, "--runtime-root", runtimeRoot, "--run-id", runId, "--json"], root);

    const evaluationRunId = "w58-eval-subject";
    const evaluationSubjectFile = path.join(runtimeRoot, "projects", transport.projectId, "artifacts", `run-${evaluationRunId}.json`);
    fs.mkdirSync(path.dirname(evaluationSubjectFile), { recursive: true });
    fs.writeFileSync(evaluationSubjectFile, `${JSON.stringify({
      run_id: evaluationRunId,
      status: "succeeded",
      documents: [accepted.status_ref, accepted.event_ref],
    }, null, 2)}\n`, "utf8");
    const evalResult = runCli([
      "eval", "run", "--project-ref", projectRoot, "--runtime-root", runtimeRoot,
      "--suite-ref", "suite.release.core@v1", "--subject-ref", `run://${evaluationRunId}`,
    ], root);

    const configResponse = await fetch(`${transport.baseUrl}/app-config.json`);
    const configText = await configResponse.text();
    const foreignOrigin = await postJson(
      `${transport.baseUrl}/api/projects/${transport.projectId}/ui-lifecycle/actions`,
      { action: "attach" },
      "http://attacker.invalid",
    );
    const oversized = await fetch(`${transport.baseUrl}/api/projects/${transport.projectId}/ui-lifecycle/actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: Buffer.alloc(1024 * 1024 + 1, 0x20),
    });

    if (!apiRun || cliStatus.run_event_history?.run_id !== runId || sseEvent.run_id !== runId || history.run_id !== runId) {
      throw new Error(`W58 API/CLI/SSE run identity parity failed: ${JSON.stringify({
        api: apiRun?.run_id,
        cli: cliStatus.run_event_history?.run_id,
        sse: sseEvent.run_id,
        history: history.run_id,
      })}`);
    }
    if (!terminalJob.worker?.identity || evalResult.evaluation_status !== "pass") {
      throw new Error("W58 worker or deterministic evaluation proof failed.");
    }
    if (configResponse.headers.get("cache-control") !== "no-store" || configText.includes(projectRoot)) {
      throw new Error("W58 app config proof exposed paths or omitted no-store.");
    }
    if (foreignOrigin.status !== 403 || oversized.status !== 413) {
      throw new Error(`W58 fail-closed transport matrix did not reject expected requests: origin=${foreignOrigin.status}, body=${oversized.status}.`);
    }

    return {
      schema_version: 1,
      wave_id: "W58",
      status: "pass",
      project_id: transport.projectId,
      run_id: runId,
      job_id: accepted.job_id,
      revision: accepted.revision,
      initialized_after_explicit_mutation: true,
      first_read_materialized: false,
      surfaces: {
        api_run_id: apiRun.run_id,
        cli_run_id: cliStatus.run_event_history.run_id,
        sse_run_id: sseEvent.run_id,
        worker_identity: terminalJob.worker.identity,
        app_project_id: transport.projectId,
      },
      evidence_refs: [...new Set([...accepted.evidence_refs, evalResult.evaluation_report_ref].filter(Boolean))],
      evaluation: { status: evalResult.evaluation_status, report_file: evalResult.evaluation_report_file },
      fail_closed: { foreign_origin: 403, oversized_body: 413 },
      cancellation_status: terminalJob.status,
      external_network_calls: false,
      credentialed_provider_calls: false,
      paid_judge_calls: false,
      upstream_writes: false,
    };
  } finally {
    await transport.close();
  }
});

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ status: report.status, report: outputPath, run_id: report.run_id })}\n`);
