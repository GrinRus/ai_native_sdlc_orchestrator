import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readRunControlState } from "./control-plane/run-control.mjs";
import { readRunJobFile, startRunJob, updateRunJobFile } from "./run-job.mjs";
import { classifyRunJobTerminalStatus } from "./run-job-status.mjs";
import { advanceParentForChildRun } from "./parent-run-scheduler.mjs";

const jobFile = process.argv[2];
const claimToken = process.argv[3];
if (!jobFile) process.exit(2);
let job = readRunJobFile(jobFile);
if (!job || !claimToken || job.worker?.claim_token !== claimToken) process.exit(2);
const fencingToken = job.worker.fencing_token;
const leaseMs = 10_000;

function recordWorkerFailure(error) {
  try {
    const current = readRunJobFile(jobFile);
    if (!current || ["succeeded", "failed", "canceled"].includes(current.status)) return;
    const message = error instanceof Error ? error.message : String(error);
    updateRunJobFile(jobFile, {
      status: "failed",
      heartbeat_at: new Date().toISOString(),
      terminal_at: new Date().toISOString(),
      terminal_evidence_refs: [current.status_ref, current.event_ref],
      worker_result: { exit_code: 1, signal: null, stdout_tail: "", stderr_tail: message.slice(-32768) },
    }, current.revision, fencingToken);
  } catch {
    // A later recovery probe can classify a worker that failed during persistence.
  }
}

process.on("uncaughtException", (error) => {
  recordWorkerFailure(error);
  process.exit(1);
});
process.on("unhandledRejection", (error) => {
  recordWorkerFailure(error);
  process.exit(1);
});

job = updateRunJobFile(jobFile, {
  status: "running",
  started_at: new Date().toISOString(),
  heartbeat_at: new Date().toISOString(),
  worker: {
    ...job.worker,
    pid: process.pid,
    identity: `node-worker-${process.pid}`,
    lease_expires_at: new Date(Date.now() + leaseMs).toISOString(),
  },
}, job.revision, fencingToken);

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
child.on("error", (error) => {
  recordWorkerFailure(error);
  process.exit(1);
});

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
      job = updateRunJobFile(jobFile, {
        status: "paused", heartbeat_at: new Date().toISOString(),
        worker: { ...current.worker, lease_expires_at: new Date(Date.now() + leaseMs).toISOString() },
      }, current.revision, fencingToken);
    } else if (stopped && control?.state?.status === "running" && process.platform !== "win32") {
      signalGroup("SIGCONT");
      stopped = false;
      job = updateRunJobFile(jobFile, {
        status: "running", heartbeat_at: new Date().toISOString(),
        worker: { ...current.worker, lease_expires_at: new Date(Date.now() + leaseMs).toISOString() },
      }, current.revision, fencingToken);
    } else if (current.status === "running") {
      job = updateRunJobFile(jobFile, {
        heartbeat_at: new Date().toISOString(),
        worker: { ...current.worker, lease_expires_at: new Date(Date.now() + leaseMs).toISOString() },
      }, current.revision, fencingToken);
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
  const status = classifyRunJobTerminalStatus({
    currentStatus: current.status, signal, exitCode: code, commandOutput,
  });
  const waitingInput = status === "waiting-input";
  const canceled = status === "canceled";
  const terminalJob = updateRunJobFile(jobFile, {
    status,
    heartbeat_at: new Date().toISOString(),
    terminal_at: ["succeeded", "failed", "canceled"].includes(status) ? new Date().toISOString() : null,
    terminal_evidence_refs: [current.status_ref, current.event_ref],
    worker_result: { exit_code: code, signal, stdout_tail: stdout, stderr_tail: stderr },
  }, current.revision, fencingToken);
  if (["succeeded", "failed", "canceled"].includes(status)) {
    try {
      const replaceFlag = (args, flag, value) => {
        const next = [...args];
        const index = next.indexOf(flag);
        if (index >= 0) next[index + 1] = value;
        else next.push(flag, value);
        return next;
      };
      advanceParentForChildRun({
        stateRoot: path.dirname(path.dirname(jobFile)),
        childRunId: current.run_id,
        status,
        evidenceRefs: terminalJob.terminal_evidence_refs,
        startChild: (reservation) => {
          let args = replaceFlag(request.args, "--run-id", reservation.child_run_id);
          args = replaceFlag(args, "--execution-unit-id", reservation.execution_unit_id);
          const next = startRunJob({
            cwd: request.cwd,
            projectRef: request.project_ref,
            runtimeRoot: request.runtime_root,
            runId: reservation.child_run_id,
            args,
          });
          return {
            ...reservation,
            job_id: next.job.job_id,
            job_status: next.job.status,
            status_ref: next.job.status_ref,
            event_ref: next.job.event_ref,
          };
        },
      });
    } catch (error) {
      const latest = readRunJobFile(jobFile);
      if (latest) {
        updateRunJobFile(jobFile, {
          parent_advance_error: {
            code: error?.code ?? "parent-advance-failed",
            detail: error instanceof Error ? error.message : String(error),
          },
        }, latest.revision, fencingToken);
      }
    }
  }
  process.exit(code === 0 || waitingInput || canceled ? 0 : 1);
});
