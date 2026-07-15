import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readRunControlState } from "./control-plane/run-control.mjs";
import { readRunJobFile, updateRunJobFile } from "./run-job.mjs";

const jobFile = process.argv[2];
if (!jobFile) process.exit(2);
let job = readRunJobFile(jobFile);
if (!job) process.exit(2);

job = updateRunJobFile(jobFile, {
  status: "running",
  started_at: new Date().toISOString(),
  heartbeat_at: new Date().toISOString(),
  worker: { pid: process.pid, identity: `node-worker-${process.pid}` },
}, job.revision);

const request = job.worker_request;
const cliBin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../apps/cli/bin/aor.mjs");
const child = spawn(process.execPath, [cliBin, ...request.args], {
  cwd: request.cwd,
  detached: true,
  stdio: ["ignore", "pipe", "pipe"],
});
let stdout = "";
let stderr = "";
child.stdout.on("data", (chunk) => { stdout = `${stdout}${chunk}`.slice(-32768); });
child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-32768); });

let stopped = false;
let killTimer = null;
const signalGroup = (signal) => {
  try { process.kill(-child.pid, signal); } catch { try { child.kill(signal); } catch {} }
};
const monitor = setInterval(() => {
  const current = readRunJobFile(jobFile);
  if (!current) return;
  try {
    const control = readRunControlState({
      cwd: request.cwd,
      projectRef: request.project_ref,
      runtimeRoot: request.runtime_root,
      runId: current.run_id,
    });
    if (current.status === "canceling" || control?.state?.status === "canceled") {
      signalGroup("SIGTERM");
      if (!killTimer) {
        killTimer = setTimeout(() => signalGroup("SIGKILL"), 1000);
        killTimer.unref?.();
      }
    } else if (control?.state?.status === "paused" && !stopped && process.platform !== "win32") {
      signalGroup("SIGSTOP");
      stopped = true;
      job = updateRunJobFile(jobFile, { status: "paused", heartbeat_at: new Date().toISOString() }, current.revision);
    } else if (stopped && control?.state?.status === "running" && process.platform !== "win32") {
      signalGroup("SIGCONT");
      stopped = false;
      job = updateRunJobFile(jobFile, { status: "running", heartbeat_at: new Date().toISOString() }, current.revision);
    } else if (current.status === "running") {
      job = updateRunJobFile(jobFile, { heartbeat_at: new Date().toISOString() }, current.revision);
    }
  } catch {
    // The next bounded monitor tick retries state observation.
  }
}, 250);

child.on("exit", (code, signal) => {
  clearInterval(monitor);
  if (killTimer) clearTimeout(killTimer);
  const current = readRunJobFile(jobFile) ?? job;
  let commandOutput = null;
  try { commandOutput = JSON.parse(stdout.trim()); } catch {}
  const waitingInput = commandOutput?.requested_interaction?.requested === true;
  const canceled = current.status === "canceling" || signal === "SIGTERM" || signal === "SIGKILL";
  const status = canceled ? "canceled" : waitingInput ? "waiting-input" : code === 0 ? "succeeded" : "failed";
  updateRunJobFile(jobFile, {
    status,
    heartbeat_at: new Date().toISOString(),
    terminal_at: ["succeeded", "failed", "canceled"].includes(status) ? new Date().toISOString() : null,
    terminal_evidence_refs: [current.status_ref, current.event_ref],
    worker_result: { exit_code: code, signal, stdout_tail: stdout, stderr_tail: stderr },
  }, current.revision);
  process.exit(code === 0 || waitingInput || canceled ? 0 : 1);
});
