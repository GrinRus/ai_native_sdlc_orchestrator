import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

function wait(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function readOwner(lockDirectory) {
  try {
    return JSON.parse(fs.readFileSync(path.join(lockDirectory, "owner.json"), "utf8"));
  } catch {
    return null;
  }
}

export function acquireFileLock(lockDirectory, options = {}) {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const staleAfterMs = options.staleAfterMs ?? 60_000;
  const retryMs = options.retryMs ?? 5;
  const startedAt = Date.now();
  const owner = {
    lock_id: crypto.randomUUID(),
    pid: process.pid,
    hostname: os.hostname(),
    acquired_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + staleAfterMs).toISOString(),
  };
  fs.mkdirSync(path.dirname(lockDirectory), { recursive: true });
  while (true) {
    try {
      fs.mkdirSync(lockDirectory);
      fs.writeFileSync(path.join(lockDirectory, "owner.json"), `${JSON.stringify(owner)}\n`, { encoding: "utf8", flag: "wx" });
      return { lockDirectory, owner };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const currentOwner = readOwner(lockDirectory);
      let expiresAt = Date.parse(currentOwner?.expires_at ?? "");
      if (!Number.isFinite(expiresAt)) {
        try {
          expiresAt = fs.statSync(lockDirectory).mtimeMs + staleAfterMs;
        } catch (statError) {
          if (statError?.code === "ENOENT") continue;
          throw statError;
        }
      }
      if (Number.isFinite(expiresAt) && expiresAt < Date.now()) {
        try {
          const staleDirectory = `${lockDirectory}.stale-${crypto.randomUUID()}`;
          fs.renameSync(lockDirectory, staleDirectory);
          fs.rmSync(staleDirectory, { recursive: true, force: true });
          continue;
        } catch (staleError) {
          if (!["ENOENT", "EEXIST"].includes(staleError?.code)) throw staleError;
        }
      }
      if (Date.now() - startedAt >= timeoutMs) {
        const conflict = new Error(`Timed out acquiring lock '${lockDirectory}'.`);
        conflict.code = "file-lock-timeout";
        conflict.lock_owner = currentOwner;
        throw conflict;
      }
      wait(retryMs);
    }
  }
}

export function releaseFileLock(lock) {
  const currentOwner = readOwner(lock.lockDirectory);
  if (currentOwner?.lock_id !== lock.owner.lock_id) {
    const conflict = new Error(`Lock ownership changed before release for '${lock.lockDirectory}'.`);
    conflict.code = "file-lock-owner-conflict";
    throw conflict;
  }
  fs.rmSync(lock.lockDirectory, { recursive: true, force: true });
}

export function withFileLock(lockDirectory, callback, options) {
  const lock = acquireFileLock(lockDirectory, options);
  try {
    return callback(lock);
  } finally {
    releaseFileLock(lock);
  }
}

export function writeJsonAtomic(
  filePath,
  document,
  { faultInjectionBoundary, directoryMode = 0o700, fileMode = 0o600 } = {},
) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: directoryMode });
  const temporaryPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${crypto.randomUUID()}.tmp`);
  try {
    if (faultInjectionBoundary === "before-write") {
      const error = new StateTransactionError("state-transaction-fault-injected", "Injected state transaction failure before write.", { boundary: faultInjectionBoundary, state_file: filePath });
      throw error;
    }
    fs.writeFileSync(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: fileMode,
    });
    if (faultInjectionBoundary === "after-write" || faultInjectionBoundary === "before-rename") {
      const error = new StateTransactionError("state-transaction-fault-injected", "Injected state transaction failure before rename.", { boundary: faultInjectionBoundary, state_file: filePath });
      throw error;
    }
    fs.renameSync(temporaryPath, filePath);
    if (faultInjectionBoundary === "after-rename") {
      throw new StateTransactionError("state-transaction-fault-injected", "Injected state transaction failure after rename.", { boundary: faultInjectionBoundary, state_file: filePath });
    }
  } catch (error) {
    if (error?.code !== "state-transaction-fault-injected") {
      try { fs.rmSync(temporaryPath, { force: true }); } catch { /* preserve the original persistence error */ }
    }
    throw error;
  }
}

export class StateTransactionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "StateTransactionError";
    this.code = code;
    Object.assign(this, details);
  }
}

/**
 * Read a JSON state document without treating corruption as an empty state.
 * The unreadable document is moved aside so recovery tooling can inspect it.
 */
export function readJsonState(filePath, { quarantine = true } = {}) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new TypeError("state document must be a JSON object");
    }
    return parsed;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    let recoveryRef = null;
    if (quarantine && fs.existsSync(filePath)) {
      recoveryRef = `${filePath}.corrupt-${crypto.randomUUID()}`;
      try {
        fs.renameSync(filePath, recoveryRef);
      } catch {
        recoveryRef = null;
      }
    }
    throw new StateTransactionError(
      "state-corrupt",
      `State file '${filePath}' is corrupt and requires recovery.`,
      { state_file: filePath, recovery_ref: recoveryRef, cause: error },
    );
  }
}

/**
 * Execute one lock-scoped JSON state transition and persist it atomically.
 * Callers own the domain fields; this helper owns serialization, locking, and
 * optimistic revision fencing.
 */
export function updateJsonState(filePath, updater, options = {}) {
  const revisionField = options.revisionField ?? "revision";
  const lockDirectory = options.lockDirectory ?? `${filePath}.lock`;
  return withFileLock(lockDirectory, () => {
    const current = fs.existsSync(filePath)
      ? readJsonState(filePath, { quarantine: options.quarantine !== false })
      : (options.fallback ?? null);
    const currentRevision = Number.isInteger(current?.[revisionField]) ? current[revisionField] : 0;
    if (options.expectedRevision !== undefined && options.expectedRevision !== currentRevision) {
      throw new StateTransactionError(
        "state-revision-conflict",
        `State revision conflict for '${filePath}': expected ${options.expectedRevision}, current ${currentRevision}.`,
        { state_file: filePath, expected_revision: options.expectedRevision, current_revision: currentRevision },
      );
    }
    const next = updater(current, { currentRevision });
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      throw new StateTransactionError("state-transition-invalid", "State transaction updater must return an object.", { state_file: filePath });
    }
    const persisted = { ...next };
    if (options.incrementRevision !== false) persisted[revisionField] = currentRevision + 1;
    writeJsonAtomic(filePath, persisted, { faultInjectionBoundary: options.faultInjectionBoundary });
    return persisted;
  }, options);
}
