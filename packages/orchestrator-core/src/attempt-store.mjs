import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { withFileLock, writeJsonAtomic } from "../../observability/src/index.mjs";

function digest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function readLedger(file) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : { schema_version: 1, next_attempt: 1, requests: {} };
}

function locations(stateRoot, identity) {
  const scope = digest(identity);
  const root = path.join(stateRoot, "step-attempts");
  return { ledgerFile: path.join(root, `${scope}.json`), lockDirectory: path.join(root, `${scope}.lock`) };
}

export function reserveStepAttempt(options) {
  const identity = { run_id: options.runId, step_id: options.stepId, step_class: options.stepClass };
  const requestKey = options.requestKey ?? `attempt-${crypto.randomUUID()}`;
  const requestDigest = digest({ identity, request_key: requestKey });
  const { ledgerFile, lockDirectory } = locations(options.stateRoot, identity);
  return withFileLock(lockDirectory, () => {
    const ledger = readLedger(ledgerFile);
    const existing = ledger.requests[requestKey];
    if (existing) {
      if (existing.request_digest !== requestDigest) {
        const error = new Error(`Attempt request '${requestKey}' conflicts with its reserved identity.`);
        error.code = "step-attempt-request-conflict";
        throw error;
      }
      if (existing.status === "completed") return { ...existing, replay: true };
      if (Date.parse(existing.lease_expires_at) > Date.now()) {
        const error = new Error(`Attempt request '${requestKey}' is already in progress.`);
        error.code = "step-attempt-in-progress";
        throw error;
      }
      existing.lease_expires_at = new Date(Date.now() + (options.leaseMs ?? 300_000)).toISOString();
      existing.revision += 1;
      writeJsonAtomic(ledgerFile, ledger);
      return { ...existing, replay: false, recovered: true };
    }
    const attempt = ledger.next_attempt;
    ledger.next_attempt += 1;
    ledger.requests[requestKey] = {
      request_key: requestKey,
      request_digest: requestDigest,
      attempt,
      status: "reserved",
      revision: 0,
      reserved_at: new Date().toISOString(),
      lease_expires_at: new Date(Date.now() + (options.leaseMs ?? 300_000)).toISOString(),
    };
    writeJsonAtomic(ledgerFile, ledger);
    return { ...ledger.requests[requestKey], replay: false };
  });
}

export function completeStepAttempt(options) {
  const identity = { run_id: options.runId, step_id: options.stepId, step_class: options.stepClass };
  const { ledgerFile, lockDirectory } = locations(options.stateRoot, identity);
  return withFileLock(lockDirectory, () => {
    const ledger = readLedger(ledgerFile);
    const reservation = ledger.requests[options.requestKey];
    if (!reservation || reservation.attempt !== options.attempt) {
      const error = new Error(`Attempt ${options.attempt} is not reserved by '${options.requestKey}'.`);
      error.code = "step-attempt-reservation-conflict";
      throw error;
    }
    if (reservation.status === "completed") return reservation.result;
    if (reservation.revision !== options.expectedRevision) {
      const error = new Error(`Attempt ${options.attempt} revision conflict.`);
      error.code = "step-attempt-revision-conflict";
      throw error;
    }
    reservation.status = "completed";
    reservation.revision += 1;
    reservation.completed_at = new Date().toISOString();
    reservation.result = options.result;
    writeJsonAtomic(ledgerFile, ledger);
    return reservation.result;
  });
}
