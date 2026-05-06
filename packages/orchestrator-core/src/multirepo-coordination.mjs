import fs from "node:fs";
import path from "node:path";

import { validateContractDocument } from "../../contracts/src/index.mjs";

import { initializeProjectRuntime } from "./project-init.mjs";

const LOCK_STATE_FILE = "multirepo-locks.json";
const LOCK_STATUS_VALUES = new Set(["active", "released", "conflict", "stale", "inspected"]);
const ACTION_VALUES = new Set(["acquire", "release", "inspect"]);

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value)
    : {};
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function asString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function asStringArray(value) {
  return Array.isArray(value)
    ? value.filter((entry) => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim())
    : [];
}

/**
 * @param {string[]} values
 * @returns {string[]}
 */
function uniqueStrings(values) {
  return Array.from(new Set(values.filter((value) => typeof value === "string" && value.length > 0)));
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeForId(value) {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * @param {Date | string | number | undefined} value
 * @returns {Date}
 */
function normalizeNow(value) {
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return new Date();
}

/**
 * @param {Date} date
 * @returns {string}
 */
function iso(date) {
  return date.toISOString();
}

/**
 * @param {string} projectRoot
 * @param {string} filePath
 * @returns {string}
 */
function toEvidenceRef(projectRoot, filePath) {
  return `evidence://${path.relative(projectRoot, filePath).replace(/\\/g, "/")}`;
}

/**
 * @param {string} glob
 * @returns {string}
 */
function normalizeGlob(glob) {
  const trimmed = glob.trim();
  return trimmed.length > 0 ? trimmed : "**";
}

/**
 * @param {string} glob
 * @returns {string}
 */
function globPrefix(glob) {
  if (glob === "**" || glob === "*") return "";
  if (glob.endsWith("/**")) return glob.slice(0, -3);
  if (glob.endsWith("*")) return glob.slice(0, -1);
  return glob;
}

/**
 * @param {string} left
 * @param {string} right
 * @returns {boolean}
 */
function globsOverlap(left, right) {
  if (left === "**" || right === "**" || left === "*" || right === "*") return true;
  if (left === right) return true;
  const leftPrefix = globPrefix(left);
  const rightPrefix = globPrefix(right);
  if (!leftPrefix || !rightPrefix) return true;
  return leftPrefix.startsWith(rightPrefix) || rightPrefix.startsWith(leftPrefix);
}

/**
 * @param {string[]} left
 * @param {string[]} right
 * @returns {boolean}
 */
function repoScopesOverlap(left, right) {
  const rightSet = new Set(right);
  return left.some((repoId) => rightSet.has(repoId));
}

/**
 * @param {string[]} left
 * @param {string[]} right
 * @returns {boolean}
 */
function pathScopesOverlap(left, right) {
  return left.some((leftGlob) => right.some((rightGlob) => globsOverlap(leftGlob, rightGlob)));
}

/**
 * @param {string} statePath
 * @returns {{ schema_version: number, locks: Array<Record<string, unknown>> }}
 */
function readLockStore(statePath) {
  if (!fs.existsSync(statePath)) {
    return { schema_version: 1, locks: [] };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, "utf8"));
    const record = asRecord(parsed);
    return {
      schema_version: 1,
      locks: Array.isArray(record.locks) ? record.locks.filter((entry) => typeof entry === "object" && entry) : [],
    };
  } catch {
    return { schema_version: 1, locks: [] };
  }
}

/**
 * @param {string} statePath
 * @param {{ schema_version: number, locks: Array<Record<string, unknown>> }} store
 */
function writeLockStore(statePath, store) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

/**
 * @param {Record<string, unknown>} lock
 * @param {Date} now
 * @returns {"active" | "released" | "stale"}
 */
function effectiveLockStatus(lock, now) {
  const rawStatus = asString(lock.status);
  if (rawStatus === "released") return "released";
  const expiresAt = asString(lock.expires_at);
  if (expiresAt && Date.parse(expiresAt) <= now.getTime()) return "stale";
  return "active";
}

/**
 * @param {Record<string, unknown>} lock
 * @param {Date} now
 * @returns {Record<string, unknown>}
 */
function normalizeStoredLock(lock, now) {
  const status = effectiveLockStatus(lock, now);
  return {
    lock_id: asString(lock.lock_id),
    owner_ref: asString(lock.owner_ref),
    run_id: asString(lock.run_id),
    repo_ids: asStringArray(lock.repo_ids),
    path_globs: asStringArray(lock.path_globs),
    acquired_at: asString(lock.acquired_at),
    expires_at: asString(lock.expires_at),
    released_at: asString(lock.released_at),
    release_evidence_refs: asStringArray(lock.release_evidence_refs),
    status,
  };
}

/**
 * @param {Record<string, unknown>} lock
 * @param {string} reason
 * @returns {Record<string, unknown>}
 */
function conflictRecord(lock, reason) {
  return {
    lock_id: asString(lock.lock_id),
    owner_ref: asString(lock.owner_ref),
    run_id: asString(lock.run_id),
    repo_ids: asStringArray(lock.repo_ids),
    path_globs: asStringArray(lock.path_globs),
    acquired_at: asString(lock.acquired_at),
    expires_at: asString(lock.expires_at),
    reason,
  };
}

/**
 * @param {unknown} value
 * @returns {Array<{ repo_id: string, ref: string }>}
 */
function normalizeRepoValidationRefs(value) {
  if (!Array.isArray(value)) return [];
  /** @type {Array<{ repo_id: string, ref: string }>} */
  const refs = [];
  for (const entry of value) {
    if (typeof entry === "string") {
      const [repoId, ...rest] = entry.split("=");
      const ref = rest.join("=");
      if (repoId?.trim() && ref?.trim()) {
        refs.push({ repo_id: repoId.trim(), ref: ref.trim() });
      }
      continue;
    }
    const record = asRecord(entry);
    const repoId = asString(record.repo_id);
    const ref = asString(record.ref);
    if (repoId && ref) {
      refs.push({ repo_id: repoId, ref });
    }
  }
  return refs;
}

/**
 * @param {{
 *   repoIds: string[],
 *   repoValidationRefs?: unknown,
 *   failedRepoIds?: string[],
 *   integrationValidationRefs?: string[],
 * }} options
 */
function buildCrossRepoValidation(options) {
  const repoIds = uniqueStrings(options.repoIds);
  if (repoIds.length <= 1) {
    return {
      status: "not-required",
      repos: repoIds.map((repoId) => ({ repo_id: repoId, status: "pass", validation_refs: [] })),
      missing_repo_ids: [],
      failed_repo_ids: [],
      integration_validation_refs: uniqueStrings(options.integrationValidationRefs ?? []),
    };
  }

  const failedRepoIds = new Set(uniqueStrings(options.failedRepoIds ?? []));
  const refsByRepo = new Map();
  for (const entry of normalizeRepoValidationRefs(options.repoValidationRefs)) {
    const current = refsByRepo.get(entry.repo_id) ?? [];
    current.push(entry.ref);
    refsByRepo.set(entry.repo_id, uniqueStrings(current));
  }

  const repos = repoIds.map((repoId) => {
    const validationRefs = refsByRepo.get(repoId) ?? [];
    const failed = failedRepoIds.has(repoId);
    return {
      repo_id: repoId,
      status: failed ? "fail" : validationRefs.length > 0 ? "pass" : "missing",
      validation_refs: validationRefs,
    };
  });
  const missingRepoIds = repos.filter((repo) => repo.status === "missing").map((repo) => repo.repo_id);
  const failed = repos.filter((repo) => repo.status === "fail").map((repo) => repo.repo_id);
  const status = failed.length > 0 ? "fail" : missingRepoIds.length > 0 ? "partial" : "pass";

  return {
    status,
    repos,
    missing_repo_ids: missingRepoIds,
    failed_repo_ids: failed,
    integration_validation_refs: uniqueStrings(options.integrationValidationRefs ?? []),
  };
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef?: string,
 *   projectProfile?: string,
 *   runtimeRoot?: string,
 *   action?: "acquire" | "release" | "inspect",
 *   runId?: string,
 *   ownerRef?: string,
 *   repoIds?: string[],
 *   pathGlobs?: string[],
 *   durationMinutes?: number,
 *   lockId?: string,
 *   releaseEvidenceRefs?: string[],
 *   repoValidationRefs?: unknown,
 *   failedRepoIds?: string[],
 *   integrationValidationRefs?: string[],
 *   now?: Date | string | number,
 * }} options
 */
export function materializeMultirepoCoordinationStatus(options = {}) {
  const init = initializeProjectRuntime({
    cwd: options.cwd,
    projectRef: options.projectRef,
    projectProfile: options.projectProfile,
    runtimeRoot: options.runtimeRoot,
  });
  const action = ACTION_VALUES.has(options.action ?? "inspect") ? options.action ?? "inspect" : "inspect";
  const now = normalizeNow(options.now);
  const createdAt = iso(now);
  const runId = asString(options.runId) ?? `${init.projectId}.multirepo.${action}.v1`;
  const ownerRef = asString(options.ownerRef);
  const repoIds = uniqueStrings(options.repoIds ?? []);
  const pathGlobs = uniqueStrings((options.pathGlobs ?? ["**"]).map(normalizeGlob));
  const durationMinutes =
    typeof options.durationMinutes === "number" && Number.isFinite(options.durationMinutes) && options.durationMinutes > 0
      ? Math.floor(options.durationMinutes)
      : 60;
  const requestedLockId =
    asString(options.lockId) ?? `lock.${normalizeForId(runId)}.${normalizeForId(repoIds.join("-") || "repo-scope")}`;
  const statePath = path.join(init.runtimeLayout.stateRoot, LOCK_STATE_FILE);
  const store = readLockStore(statePath);
  store.locks = store.locks.map((lock) => normalizeStoredLock(lock, now));

  /** @type {string[]} */
  const blockingReasons = [];
  /** @type {Record<string, unknown>[]} */
  let conflicts = [];
  /** @type {Record<string, unknown> | null} */
  let activeLock = null;
  /** @type {string | null} */
  let releasedAt = null;
  const releaseEvidenceRefs = uniqueStrings(options.releaseEvidenceRefs ?? []);

  if (action === "acquire") {
    if (!ownerRef) blockingReasons.push("lock-owner-required");
    if (repoIds.length === 0) blockingReasons.push("lock-repo-scope-required");
    const overlappingLocks = store.locks.filter((lock) => {
      const lockRepoIds = asStringArray(lock.repo_ids);
      const lockPathGlobs = asStringArray(lock.path_globs);
      const lockStatus = asString(lock.status);
      if (lockStatus === "released") return false;
      return repoScopesOverlap(repoIds, lockRepoIds) && pathScopesOverlap(pathGlobs, lockPathGlobs);
    });

    const staleLocks = overlappingLocks.filter((lock) => asString(lock.status) === "stale");
    const activeConflicts = overlappingLocks.filter((lock) => {
      const lockStatus = asString(lock.status);
      const sameOwnerRun = asString(lock.owner_ref) === ownerRef && asString(lock.run_id) === runId;
      return lockStatus === "active" && !sameOwnerRun;
    });
    if (staleLocks.length > 0) {
      blockingReasons.push("lock-stale");
      conflicts = staleLocks.map((lock) => conflictRecord(lock, "stale-lock-overlaps-requested-scope"));
    } else if (activeConflicts.length > 0) {
      blockingReasons.push("lock-conflict");
      conflicts = activeConflicts.map((lock) => conflictRecord(lock, "active-lock-overlaps-requested-scope"));
    }

    if (blockingReasons.length === 0) {
      const expiresAt = new Date(now.getTime() + durationMinutes * 60 * 1000);
      activeLock = {
        lock_id: requestedLockId,
        owner_ref: ownerRef,
        run_id: runId,
        repo_ids: repoIds,
        path_globs: pathGlobs,
        acquired_at: createdAt,
        expires_at: iso(expiresAt),
        released_at: null,
        release_evidence_refs: [],
        status: "active",
      };
      store.locks = [
        ...store.locks.filter((lock) => asString(lock.lock_id) !== requestedLockId),
        activeLock,
      ];
      writeLockStore(statePath, store);
    }
  } else if (action === "release") {
    const matchingLock = store.locks.find((lock) => asString(lock.lock_id) === requestedLockId);
    if (!matchingLock) {
      blockingReasons.push("lock-not-found");
    } else if (ownerRef && asString(matchingLock.owner_ref) !== ownerRef) {
      blockingReasons.push("lock-owner-mismatch");
      conflicts = [conflictRecord(matchingLock, "release-owner-does-not-match-lock-owner")];
    } else {
      releasedAt = createdAt;
      Object.assign(matchingLock, {
        status: "released",
        released_at: releasedAt,
        release_evidence_refs: releaseEvidenceRefs,
      });
      activeLock = matchingLock;
      writeLockStore(statePath, store);
    }
  }

  const inspectedLocks = store.locks
    .map((lock) => normalizeStoredLock(lock, now))
    .filter((lock) => {
      if (repoIds.length === 0) return true;
      return repoScopesOverlap(repoIds, asStringArray(lock.repo_ids));
    });
  const latestLock = activeLock ?? inspectedLocks.find((lock) => asString(lock.lock_id) === requestedLockId) ?? null;
  const lockStatus =
    action === "inspect"
      ? "inspected"
      : blockingReasons.includes("lock-conflict")
        ? "conflict"
        : blockingReasons.includes("lock-stale")
          ? "stale"
          : action === "release" && blockingReasons.length === 0
            ? "released"
            : latestLock
              ? asString(latestLock.status) ?? "active"
              : "inspected";
  if (!LOCK_STATUS_VALUES.has(lockStatus)) {
    throw new Error(`Unsupported lock status '${lockStatus}'.`);
  }

  const crossRepoValidation = buildCrossRepoValidation({
    repoIds,
    repoValidationRefs: options.repoValidationRefs,
    failedRepoIds: options.failedRepoIds,
    integrationValidationRefs: options.integrationValidationRefs,
  });
  if (crossRepoValidation.missing_repo_ids.length > 0) {
    blockingReasons.push("cross-repo-validation-missing");
  }
  if (crossRepoValidation.failed_repo_ids.length > 0) {
    blockingReasons.push("cross-repo-validation-failed");
  }

  const validationRefs = uniqueStrings([
    ...crossRepoValidation.repos.flatMap((repo) => repo.validation_refs),
    ...crossRepoValidation.integration_validation_refs,
  ]);
  const selfRefPlaceholder = `evidence://reports/multirepo-coordination-status-${normalizeForId(runId)}.json`;
  const status = action === "release" && blockingReasons.length === 0 ? "released" : blockingReasons.length > 0 ? "blocked" : "ready";
  const lockEvidenceRefs =
    status === "ready" || status === "released"
      ? [selfRefPlaceholder]
      : [];
  const report = {
    status_id: `${init.projectId}.multirepo-coordination.${normalizeForId(runId)}.${Date.now()}`,
    project_id: init.projectId,
    run_id: runId,
    version: 1,
    generated_from: {
      command: "aor multirepo lock",
      action,
      requested_by: ownerRef,
      state_file: statePath,
    },
    lock_scope: {
      repo_ids: repoIds,
      path_globs: pathGlobs,
      owner_ref: ownerRef,
      duration_minutes: durationMinutes,
    },
    lock_state: {
      status: lockStatus,
      lock_id: asString(latestLock?.lock_id) ?? (action === "acquire" ? requestedLockId : asString(options.lockId)),
      owner_ref: asString(latestLock?.owner_ref) ?? ownerRef,
      run_id: asString(latestLock?.run_id) ?? runId,
      acquired_at: asString(latestLock?.acquired_at),
      expires_at: asString(latestLock?.expires_at),
      released_at: releasedAt ?? asString(latestLock?.released_at),
      conflicts,
      release_evidence_refs: releaseEvidenceRefs,
      inspected_locks: action === "inspect" ? inspectedLocks : undefined,
    },
    cross_repo_validation: crossRepoValidation,
    delivery_evidence: {
      coordination_evidence_refs: uniqueStrings([...lockEvidenceRefs, ...validationRefs]),
      lock_evidence_refs: lockEvidenceRefs,
      cross_repo_validation_refs: validationRefs,
    },
    status,
    blocking_reasons: uniqueStrings(blockingReasons),
    evidence_refs: uniqueStrings([...releaseEvidenceRefs, ...validationRefs]),
    created_at: createdAt,
  };

  const reportPath = path.join(
    init.runtimeLayout.reportsRoot,
    `multirepo-coordination-status-${normalizeForId(runId)}-${Date.now()}.json`,
  );
  const actualSelfRef = toEvidenceRef(init.projectRoot, reportPath);
  report.delivery_evidence.coordination_evidence_refs = report.delivery_evidence.coordination_evidence_refs.map((ref) =>
    ref === selfRefPlaceholder ? actualSelfRef : ref,
  );
  report.delivery_evidence.lock_evidence_refs = report.delivery_evidence.lock_evidence_refs.map((ref) =>
    ref === selfRefPlaceholder ? actualSelfRef : ref,
  );
  report.evidence_refs = uniqueStrings([...report.evidence_refs, actualSelfRef]);

  const validation = validateContractDocument({
    family: "multirepo-coordination-status",
    document: report,
    source: "runtime://multirepo-coordination-status",
  });
  if (!validation.ok) {
    const issues = validation.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Generated multirepo coordination status failed contract validation: ${issues}`);
  }

  fs.mkdirSync(init.runtimeLayout.reportsRoot, { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  return {
    ...init,
    statusPath: reportPath,
    statusRef: actualSelfRef,
    report,
    lockStateFile: statePath,
    blocking: status === "blocked",
  };
}
