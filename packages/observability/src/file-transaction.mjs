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

export function writeJsonAtomic(filePath, document) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${crypto.randomUUID()}.tmp`);
  fs.writeFileSync(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  fs.renameSync(temporaryPath, filePath);
}
