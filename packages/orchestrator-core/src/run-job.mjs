import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { derivePublicId, validateContractDocument, validatePublicId } from "../../contracts/src/index.mjs";
import { withFileLock, writeJsonAtomic } from "../../observability/src/file-transaction.mjs";
import { initializeProjectRuntime } from "./project-init.mjs";
import { createProjectReadContext } from "./control-plane/project-context.mjs";

export const RUN_JOB_STATUSES = Object.freeze([
  "queued", "running", "paused", "waiting-input", "canceling", "succeeded", "failed", "canceled",
]);

const TERMINAL_STATUSES = new Set(["succeeded", "failed", "canceled"]);
const DEFAULT_WORKER_LEASE_MS = 10_000;

function jobPath(runtimeLayout, jobId) {
  return path.join(runtimeLayout.stateRoot, "run-jobs", `run-job-${jobId}.json`);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function assertRunJob(job) {
  const validation = validateContractDocument({ family: "run-job", document: job, source: "runtime://run-job" });
  if (!validation.ok) throw new Error(`Run job contract validation failed: ${validation.issues.map((issue) => issue.message).join("; ")}`);
}

export function readRunJobFile(file) {
  return fs.existsSync(file) ? readJson(file) : null;
}

export function updateRunJobFile(file, update, expectedRevision, expectedFencingToken) {
  const lock = `${file}.lock`;
  return withFileLock(lock, () => {
    const current = readRunJobFile(file);
    if (!current) throw new Error(`Run job '${file}' does not exist.`);
    if (expectedRevision !== undefined && current.revision !== expectedRevision) {
      const error = new Error(`Run job revision conflict: expected ${expectedRevision}, found ${current.revision}.`);
      error.code = "run-job-revision-conflict";
      throw error;
    }
    if (expectedFencingToken !== undefined && current.worker?.fencing_token !== expectedFencingToken) {
      const error = new Error(`Run job fencing conflict: expected ${expectedFencingToken}, found ${current.worker?.fencing_token ?? "none"}.`);
      error.code = "run-job-fencing-conflict";
      throw error;
    }
    const next = {
      ...current,
      ...update,
      revision: current.revision + 1,
      updated_at: new Date().toISOString(),
    };
    if (!RUN_JOB_STATUSES.includes(next.status)) throw new Error(`Unsupported run job status '${next.status}'.`);
    assertRunJob(next);
    writeJsonAtomic(file, next);
    return next;
  });
}

function claimRunJobWorker(file, leaseMs = DEFAULT_WORKER_LEASE_MS) {
  return withFileLock(`${file}.lock`, () => {
    const current = readRunJobFile(file);
    if (!current) throw new Error(`Run job '${file}' does not exist.`);
    if (TERMINAL_STATUSES.has(current.status) || current.status === "waiting-input") {
      return { job: current, claimed: false };
    }
    const leaseActive = current.worker?.lease_expires_at && Date.parse(current.worker.lease_expires_at) > Date.now();
    if (current.worker && leaseActive) return { job: current, claimed: false };
    const fencingToken = (Number(current.worker?.fencing_token) || 0) + 1;
    const claimToken = crypto.randomUUID();
    const next = {
      ...current,
      revision: current.revision + 1,
      worker: {
        pid: 0,
        identity: `node-worker-claim-${claimToken}`,
        claim_token: claimToken,
        fencing_token: fencingToken,
        lease_expires_at: new Date(Date.now() + leaseMs).toISOString(),
      },
      updated_at: new Date().toISOString(),
    };
    assertRunJob(next);
    writeJsonAtomic(file, next);
    return { job: next, claimed: true, claimToken, fencingToken };
  });
}

export function reserveRunJob(options) {
  const init = options.initializedRuntime ?? initializeProjectRuntime(options);
  const runId = options.runId ?? derivePublicId(["run", Date.now(), crypto.randomUUID()], "run");
  const validation = validatePublicId(runId);
  if (!validation.ok) throw new Error(`Invalid run_id '${runId}' for run job.`);
  const jobId = derivePublicId([runId, "job"], "job");
  const file = jobPath(init.runtimeLayout, jobId);
  const requestDigest = crypto.createHash("sha256").update(JSON.stringify(options.args)).digest("hex");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const job = withFileLock(`${file}.lock`, () => {
    if (fs.existsSync(file)) {
      const existing = readJson(file);
      if (existing.request_digest !== requestDigest) {
        const error = new Error(`Run job '${jobId}' already exists with a different request.`);
        error.code = "run-job-request-conflict";
        throw error;
      }
      return existing;
    }
    const now = new Date().toISOString();
    const created = {
      schema_version: 1,
      job_id: jobId,
      run_id: runId,
      project_id: init.projectId,
      status: "queued",
      revision: 0,
      request_digest: requestDigest,
      worker: null,
      heartbeat_at: null,
      accepted_at: now,
      started_at: null,
      terminal_at: null,
      terminal_evidence_refs: [],
      status_ref: `evidence://${path.relative(init.projectRoot, file).replaceAll(path.sep, "/")}`,
      event_ref: `evidence://${path.relative(init.projectRoot, path.join(init.runtimeLayout.reportsRoot, `live-run-events-${runId}.jsonl`)).replaceAll(path.sep, "/")}`,
      worker_request: {
        cwd: init.projectRoot,
        project_ref: init.projectRoot,
        runtime_root: init.runtimeRoot,
        args: options.args,
      },
      created_at: now,
      updated_at: now,
    };
    assertRunJob(created);
    writeJsonAtomic(file, created);
    return created;
  });
  return { init, file, job };
}

export function spawnRunJobWorker(options) {
  const workerFile = new URL("./run-job-worker.mjs", import.meta.url);
  const child = spawn(process.execPath, [workerFile.pathname, options.jobFile, options.claimToken], {
    cwd: options.cwd,
    detached: true,
    stdio: "ignore",
  });
  const persistUnexpectedExit = (code, signal, error = null) => {
    try {
      const current = readRunJobFile(options.jobFile);
      if (!current || TERMINAL_STATUSES.has(current.status) || current.status === "waiting-input") return;
      updateRunJobFile(options.jobFile, {
        status: "failed",
        heartbeat_at: new Date().toISOString(),
        terminal_at: new Date().toISOString(),
        terminal_evidence_refs: [current.status_ref, current.event_ref],
        worker_result: {
          exit_code: Number.isInteger(code) ? code : 1,
          signal: signal ?? null,
          stdout_tail: "",
          stderr_tail: error instanceof Error ? error.message.slice(-32768) : "Run job worker exited before terminal persistence.",
        },
      }, current.revision, options.fencingToken);
    } catch {
      // The durable heartbeat remains available for stale-worker recovery.
    }
  };
  child.once("error", (error) => persistUnexpectedExit(1, null, error));
  child.once("exit", (code, signal) => persistUnexpectedExit(code, signal));
  child.unref();
  return child.pid;
}

function startRunJobInitialized(options, init) {
  const reserved = reserveRunJob({ ...options, initializedRuntime: init });
  const ownership = claimRunJobWorker(reserved.file, options.workerLeaseMs);
  if (!ownership.claimed) return { ...reserved, job: ownership.job, idempotent: true };
  try {
    spawnRunJobWorker({
      jobFile: reserved.file,
      cwd: reserved.init.projectRoot,
      claimToken: ownership.claimToken,
      fencingToken: ownership.fencingToken,
    });
  } catch (error) {
    const current = readRunJobFile(reserved.file);
    if (current) updateRunJobFile(reserved.file, {
      status: "failed",
      terminal_at: new Date().toISOString(),
      terminal_evidence_refs: [current.status_ref, current.event_ref],
      worker_result: { exit_code: 1, signal: null, stdout_tail: "", stderr_tail: String(error) },
    }, current.revision, ownership.fencingToken);
    throw error;
  }
  return { ...reserved, job: ownership.job, idempotent: false };
}

export function startRunJob(options) {
  if (options.initializedRuntime) return startRunJobInitialized(options, options.initializedRuntime);
  const projectRootHint = path.resolve(options.projectRef ?? options.cwd ?? process.cwd());
  const runtimeRootHint = options.runtimeRoot
    ? path.resolve(projectRootHint, options.runtimeRoot)
    : path.join(projectRootHint, ".aor");
  return withFileLock(`${runtimeRootHint}.run-job-operation.lock`, () => {
    const readContext = createProjectReadContext(options);
    const init = readContext.initialized
      ? {
          projectId: readContext.projectId,
          projectRoot: readContext.projectRoot,
          runtimeRoot: readContext.runtimeRoot,
          runtimeLayout: readContext.runtimeLayout,
        }
      : initializeProjectRuntime(options);
    return startRunJobInitialized(options, init);
  });
}

export function requestRunJobCancel(options) {
  const init = initializeProjectRuntime(options);
  const jobId = derivePublicId([options.runId, "job"], "job");
  const file = jobPath(init.runtimeLayout, jobId);
  const current = readRunJobFile(file);
  if (!current || TERMINAL_STATUSES.has(current.status)) return current;
  return updateRunJobFile(file, { status: "canceling" }, current.revision);
}

export function resumeRunJobAfterInput(options) {
  const init = initializeProjectRuntime(options);
  const jobId = derivePublicId([options.runId, "job"], "job");
  const file = jobPath(init.runtimeLayout, jobId);
  const current = readRunJobFile(file);
  if (!current) return null;
  if (current.status !== "waiting-input") {
    if (current.input_resume_count > 0 || current.worker) return { init, file, job: current, idempotent: true };
    return null;
  }
  const queued = updateRunJobFile(file, {
    status: "queued",
    worker: null,
    terminal_at: null,
    input_resume_count: (Number(current.input_resume_count) || 0) + 1,
    resumed_from_interaction_at: new Date().toISOString(),
  }, current.revision);
  return startRunJob({
    projectRef: current.worker_request.project_ref,
    cwd: current.worker_request.cwd,
    runtimeRoot: current.worker_request.runtime_root,
    runId: current.run_id,
    args: current.worker_request.args,
    initializedRuntime: init,
    queuedJob: queued,
  });
}
