import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { derivePublicId, validateContractDocument } from "../../contracts/src/index.mjs";
import { withFileLock, writeJsonAtomic } from "./file-transaction.mjs";

const ATTEMPT_STATUSES = new Set(["reserved", "running", "completed", "failed", "blocked", "canceled"]);
const REQUEST_BLOCKED_STATUSES = new Set(["in-progress", "review-required", "qa-required", "budget-exhausted", "closed"]);

function nowIso() {
  return new Date().toISOString();
}

function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}

function asString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asStringArray(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string" && entry.trim()).map((entry) => entry.trim()) : [];
}

function uniqueStrings(values) {
  return Array.from(new Set(values.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim())));
}

function integer(value, fallback = null) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizeId(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "").replace(/-{2,}/gu, "-");
}

function digest(value) {
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function reportsRootOf(runtimeLayout) {
  return asString(runtimeLayout?.reportsRoot) ?? asString(runtimeLayout?.reports_root);
}

function stateRootOf(runtimeLayout) {
  return asString(runtimeLayout?.stateRoot) ?? asString(runtimeLayout?.state_root);
}

function evidenceRef(projectRoot, filePath, runtimeLayout) {
  if (filePath.startsWith("evidence://") || filePath.startsWith("packet://")) return filePath;
  const reportsRoot = reportsRootOf(runtimeLayout);
  if (reportsRoot && path.isAbsolute(filePath)) {
    const runtimeRoot = path.dirname(reportsRoot);
    const relative = path.relative(runtimeRoot, filePath).replace(/\\/g, "/");
    if (relative && !relative.startsWith("../")) return `evidence://projects/${path.basename(runtimeRoot)}/${relative}`;
  }
  const relative = path.relative(projectRoot, filePath).replace(/\\/g, "/");
  return relative && !relative.startsWith("../") ? `evidence://${relative}` : `evidence://${filePath.replace(/\\/g, "/")}`;
}

function readRequest(requestFile) {
  return /** @type {Record<string, unknown>} */ (JSON.parse(fs.readFileSync(requestFile, "utf8")));
}

function resolveRequest(options) {
  const requestFile = asString(options.requestFile);
  const reportsRoot = reportsRootOf(options.runtimeLayout);
  if (requestFile && fs.existsSync(requestFile)) {
    if (reportsRoot && !isInside(reportsRoot, requestFile)) throw createError("quality-repair-request-outside-runtime", "Quality repair request must be inside the selected runtime reports root.");
    return { file: requestFile, document: readRequest(requestFile) };
  }
  const requestId = asString(options.requestId);
  if (!reportsRoot || !fs.existsSync(reportsRoot)) throw createError("quality-repair-request-not-found", "Quality repair request was not found.");
  const candidate = fs.readdirSync(reportsRoot).filter((entry) => /^quality-repair-request-.*\.json$/u.test(entry)).map((entry) => path.join(reportsRoot, entry)).find((file) => {
    try { return !requestId || readRequest(file).request_id === requestId; } catch { return false; }
  });
  if (!candidate) throw createError("quality-repair-request-not-found", "Quality repair request was not found.");
  return { file: candidate, document: readRequest(candidate) };
}

function createError(code, message, details = undefined) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

function assertPathOwned(options) {
  const projectRoot = path.resolve(options.projectRoot);
  const executionRoot = asString(options.executionRoot);
  const workspaceRef = asString(options.workspaceRef);
  if (!workspaceRef) throw createError("quality-repair-workspace-required", "Retry requires an owner-marked disposable workspace_ref.");
  if (workspaceRef === "workspace://primary" || workspaceRef === projectRoot) throw createError("quality-repair-primary-workspace", "Quality repair retry cannot use the primary checkout.");
  const owner = asString(options.workspaceOwner) ?? `project://${options.projectId}`;
  if (owner !== `project://${options.projectId}` && owner !== options.projectId) throw createError("quality-repair-workspace-owner-mismatch", "Repair workspace is owned by a different project.");
  if (executionRoot) {
    if (!path.isAbsolute(executionRoot)) throw createError("quality-repair-execution-root-invalid", "Repair execution root must be absolute.");
    if (!fs.existsSync(executionRoot) || !fs.statSync(executionRoot).isDirectory()) throw createError("quality-repair-workspace-missing", "Repair workspace does not exist.");
    if (fs.lstatSync(executionRoot).isSymbolicLink()) throw createError("quality-repair-workspace-symlink", "Repair workspace must not be a symlink.");
    const resolved = path.resolve(executionRoot);
    if (resolved === projectRoot) throw createError("quality-repair-primary-workspace", "Quality repair retry cannot use the primary checkout.");
    const workspacesRoot = asString(options.workspacesRoot);
    if (workspacesRoot && !isInside(workspacesRoot, resolved)) throw createError("quality-repair-workspace-external", "Repair workspace is outside the project-owned workspace root.");
  }
  return { workspaceRef, owner, executionRoot: executionRoot ? path.resolve(executionRoot) : null };
}

function isInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function validateAttempt(attempt) {
  const validation = validateContractDocument({ family: "quality-repair-attempt", document: attempt, source: "runtime://quality-repair-attempt" });
  if (!validation.ok) throw createError("quality-repair-attempt-invalid", validation.issues.map((entry) => entry.message).join("; "));
}

function requestRef(options, requestFile) {
  return evidenceRef(options.projectRoot, requestFile, options.runtimeLayout);
}

function commandIndexPath(runtimeLayout) {
  const stateRoot = stateRootOf(runtimeLayout);
  if (!stateRoot) throw createError("quality-repair-state-root-required", "Quality repair retry requires a runtime state root.");
  return path.join(stateRoot, "quality-repair-command-index.json");
}

function readCommandIndex(file) {
  try { return asRecord(JSON.parse(fs.readFileSync(file, "utf8"))); } catch { return { commands: {} }; }
}

function writeRequest(requestFile, request) {
  writeJsonAtomic(requestFile, request);
}

function buildFailureFingerprint(options, request, previous) {
  return asString(options.failureFingerprint) ?? digest({
    finding_fingerprint: asString(options.findingFingerprint) ?? digest(asStringArray(request.finding_refs)),
    input_fingerprint: asString(options.inputFingerprint) ?? digest(asStringArray(request.evidence_refs)),
    workspace_ref: asString(options.workspaceRef),
    diff_fingerprint: asString(options.diffFingerprint),
    verification_fingerprint: asString(options.verificationFingerprint),
    validation_fingerprint: asString(options.validationFingerprint),
    route_ref: asString(options.routeRef),
    model: asString(options.model),
    previous_failure: asString(previous?.failure_fingerprint),
  });
}

function appendRequestHistory(request, status, summary, evidenceRefs, changedAt) {
  request.status_history = [
    ...(Array.isArray(request.status_history) ? request.status_history : []),
    { status, changed_at: changedAt, summary, evidence_refs: evidenceRefs },
  ];
}

function updateRequestReferences(request, attemptRef, attempt, currentRevision, requestRefValue, options) {
  const now = nowIso();
  const refs = uniqueStrings([...(Array.isArray(request.attempt_refs) ? request.attempt_refs : []), attemptRef]);
  request.revision = currentRevision + 1;
  request.attempt_refs = refs;
  request.active_attempt_ref = attemptRef;
  request.latest_attempt_ref = attemptRef;
  request.status = "in-progress";
  request.attempt_budget = {
    ...asRecord(request.attempt_budget),
    attempt_index: attempt.attempt_index,
    remaining_attempts: Math.max(integer(asRecord(request.attempt_budget).max_attempts, attempt.attempt_index) - attempt.attempt_index, 0),
    reserved_attempts: 1,
    debited_attempts: integer(asRecord(request.attempt_budget).debited_attempts, 0),
  };
  request.active_attempt = {
    attempt_ref: attemptRef,
    attempt_id: attempt.attempt_id,
    status: attempt.status,
    workspace_ref: attempt.workspace_ref,
    repair_run_id: attempt.repair_run_id,
  };
  request.workspace_lineage = {
    workspace_ref: attempt.workspace_ref,
    workspace_owner: attempt.workspace_owner,
    execution_root: attempt.owned_workspace?.execution_root ?? null,
    base_commit: attempt.base_commit ?? null,
    diff_fingerprint: attempt.diff_fingerprint ?? null,
  };
  request.updated_at = now;
  appendRequestHistory(request, request.status, `Quality repair attempt ${attempt.attempt_index} reserved.`, uniqueStrings([requestRefValue, ...asStringArray(options.evidenceRefs), attemptRef]), now);
}

/**
 * Reserve one immutable quality repair attempt.
 * @param {{ projectId: string, projectRoot: string, runtimeLayout: Record<string, string>, requestFile?: string, requestId?: string, commandId: string, expectedRevision: number, reason?: string, workspaceRef: string, workspaceOwner?: string, executionRoot?: string, workspacesRoot?: string, repairRunId?: string, inputFingerprint?: string, findingFingerprint?: string, failureFingerprint?: string, diffFingerprint?: string, verificationFingerprint?: string, validationFingerprint?: string, routeRef?: string, model?: string, failureClass?: string, evidenceRefs?: string[], trigger?: string }} options
 */
export function retryQualityRepair(options) {
  const commandId = asString(options.commandId);
  if (!commandId) throw createError("quality-repair-command-id-required", "Quality repair retry requires command_id.");
  if (!Number.isInteger(options.expectedRevision) || options.expectedRevision < 0) throw createError("quality-repair-expected-revision-required", "Quality repair retry requires a non-negative expected_revision.");
  const resolved = resolveRequest(options);
  const requestFile = resolved.file;
  const lockFile = `${requestFile}.lock`;
  return withFileLock(lockFile, () => {
    const request = readRequest(requestFile);
    const currentRevision = integer(request.revision, 0);
    const commandFile = commandIndexPath(options.runtimeLayout);
    const index = readCommandIndex(commandFile);
    index.commands ??= {};
    const requestRefValue = requestRef(options, requestFile);
    const commandPayload = {
      request_id: request.request_id,
      request_ref: requestRefValue,
      expected_revision: options.expectedRevision,
      workspace_ref: options.workspaceRef,
      execution_root: options.executionRoot ?? null,
      reason: options.reason ?? null,
      evidence_refs: uniqueStrings(asStringArray(options.evidenceRefs)),
    };
    const commandDigest = digest(commandPayload);
    const existingCommand = asRecord(index.commands[commandId]);
    if (Object.keys(existingCommand).length > 0) {
      if (existingCommand.request_digest !== commandDigest) throw createError("quality-repair-command-conflict", `Command '${commandId}' was reused with a different repair request.`);
      return { ...(asRecord(existingCommand.result)), replay: true };
    }
    if (currentRevision !== options.expectedRevision) throw createError("quality-repair-stale-revision", `Quality repair request revision is ${currentRevision}; expected ${options.expectedRevision}.`, { current_revision: currentRevision, expected_revision: options.expectedRevision });
    const status = asString(request.status) ?? "requested";
    if (REQUEST_BLOCKED_STATUSES.has(status)) throw createError(`quality-repair-${status}`, `Quality repair retry is blocked while request is '${status}'.`);
    const budget = asRecord(request.attempt_budget);
    const maxAttempts = integer(budget.max_attempts, 0);
    const refs = Array.isArray(request.attempt_refs) ? request.attempt_refs.filter((entry) => typeof entry === "string") : [];
    const attemptIndex = refs.length === 0 ? Math.max(integer(budget.attempt_index, 1), 1) : integer(budget.attempt_index, refs.length) + 1;
    if (maxAttempts <= 0 || attemptIndex > maxAttempts || integer(budget.remaining_attempts, Math.max(maxAttempts - attemptIndex, 0)) <= 0 && refs.length > 0) {
      request.status = "budget-exhausted";
      request.blockers = ["repair-budget-exhausted", "operator-approval-required-before-delivery"];
      request.revision = currentRevision + 1;
      request.updated_at = nowIso();
      appendRequestHistory(request, request.status, "No policy-approved quality repair attempts remain.", request.evidence_refs ?? [], request.updated_at);
      writeRequest(requestFile, request);
      throw createError("quality-repair-budget-exhausted", "No policy-approved quality repair attempts remain.");
    }
    const ownership = assertPathOwned(options);
    const activeAttempt = asRecord(request.active_attempt);
    if (["reserved", "running"].includes(asString(activeAttempt.status) ?? "")) throw createError("quality-repair-active-attempt", "Only one quality repair attempt may be active.");
    const previous = asRecord(request.latest_attempt);
    const failureFingerprint = buildFailureFingerprint(options, request, previous);
    const newEvidenceRefs = uniqueStrings(asStringArray(options.evidenceRefs)).filter((ref) => !asStringArray(previous.evidence_refs).includes(ref));
    if (asString(previous.failure_fingerprint) === failureFingerprint && newEvidenceRefs.length === 0 && asString(previous.route_ref) === asString(options.routeRef)) {
      throw createError("repeated-repair-without-new-evidence", "Identical repair failure is blocked until new evidence or an approved route change is supplied.");
    }
    const generatedAt = nowIso();
    const attemptId = derivePublicId([request.request_id, "attempt", String(attemptIndex), normalizeId(generatedAt)], "quality-repair-attempt");
    const repairRunId = asString(options.repairRunId) ?? `${normalizeId(request.run_id)}.repair.${attemptIndex}`;
    const inputFingerprint = asString(options.inputFingerprint) ?? digest({ request_id: request.request_id, evidence_refs: request.evidence_refs ?? [] });
    const findingFingerprint = asString(options.findingFingerprint) ?? digest(request.finding_refs ?? []);
    const attempt = {
      attempt_id: attemptId,
      request_id: request.request_id,
      cycle_id: request.cycle_id,
      attempt_index: attemptIndex,
      trigger: asString(options.trigger) ?? "operator-retry",
      repair_run_id: repairRunId,
      ...(refs.at(-1) ? { parent_attempt_ref: refs.at(-1) } : {}),
      status: "reserved",
      workspace_ref: ownership.workspaceRef,
      workspace_owner: ownership.owner,
      owned_workspace: {
        disposable: true,
        project_id: options.projectId,
        execution_root: ownership.executionRoot,
        base_commit: asString(options.baseCommit),
      },
      input_fingerprint: inputFingerprint,
      finding_fingerprint: findingFingerprint,
      failure_fingerprint: failureFingerprint,
      ...(asString(options.diffFingerprint) ? { diff_fingerprint: asString(options.diffFingerprint) } : {}),
      ...(asString(options.routeRef) ? { route_ref: asString(options.routeRef) } : {}),
      ...(asString(options.failureClass) ? { failure_class: asString(options.failureClass) } : {}),
      budget: { max_attempts: maxAttempts, reserved: true, debited: false, debit_state: "pending-launch" },
      lineage: { request_ref: requestRefValue, previous_attempt_refs: refs, command_id: commandId },
      review: { status: "pending" },
      qa: { status: "pending" },
      evidence_refs: uniqueStrings([requestRefValue, ...asStringArray(options.evidenceRefs)]),
      created_at: generatedAt,
      updated_at: generatedAt,
    };
    validateAttempt(attempt);
    const reportsRoot = reportsRootOf(options.runtimeLayout);
    if (!reportsRoot) throw createError("quality-repair-reports-root-required", "Quality repair retry requires a runtime reports root.");
    const attemptFile = path.join(reportsRoot, `quality-repair-attempt-${normalizeId(request.request_id)}-${attemptIndex}.json`);
    const attemptRef = evidenceRef(options.projectRoot, attemptFile, options.runtimeLayout);
    writeJsonAtomic(attemptFile, attempt);
    request.latest_attempt = attempt;
    updateRequestReferences(request, attemptRef, attempt, currentRevision, requestRefValue, options);
    request.evidence_refs = uniqueStrings([...(Array.isArray(request.evidence_refs) ? request.evidence_refs : []), ...attempt.evidence_refs]);
    const requestValidation = validateContractDocument({ family: "quality-repair-request", document: request, source: "runtime://quality-repair-request" });
    if (!requestValidation.ok) throw createError("quality-repair-request-invalid", requestValidation.issues.map((entry) => entry.message).join("; "));
    writeRequest(requestFile, request);
    const result = {
      request,
      request_file: requestFile,
      request_ref: requestRefValue,
      attempt,
      attempt_file: attemptFile,
      attempt_ref: attemptRef,
      command_id: commandId,
      request_revision: request.revision,
      next_action: "launch-quality-repair-attempt",
      replay: false,
    };
    index.commands[commandId] = { request_digest: commandDigest, result };
    writeJsonAtomic(commandFile, index);
    return result;
  });
}

/**
 * Mark a reserved attempt running and debit budget exactly once after launch acknowledgement.
 * @param {{ projectRoot: string, runtimeLayout: Record<string, string>, requestFile: string, attemptFile: string, commandId: string, expectedRevision: number }} options
 */
export function acknowledgeQualityRepairLaunch(options) {
  return transitionQualityRepairAttempt({ ...options, status: "running", summary: "Provider launch acknowledged; quality repair budget debited." });
}

/**
 * Apply a terminal attempt state and return the request to review/QA gates after completion.
 * @param {{ projectRoot: string, runtimeLayout: Record<string, string>, requestFile: string, attemptFile: string, status: "completed"|"failed"|"blocked"|"canceled", expectedRevision: number, summary?: string, evidenceRefs?: string[] }} options
 */
export function transitionQualityRepairAttempt(options) {
  if (!ATTEMPT_STATUSES.has(options.status)) throw createError("quality-repair-attempt-status-invalid", `Unsupported attempt status '${options.status}'.`);
  const requestFile = options.requestFile;
  return withFileLock(`${requestFile}.lock`, () => {
    const request = readRequest(requestFile);
    const currentRevision = integer(request.revision, 0);
    if (currentRevision !== options.expectedRevision) throw createError("quality-repair-stale-revision", `Quality repair request revision is ${currentRevision}; expected ${options.expectedRevision}.`);
    const attempt = /** @type {Record<string, unknown>} */ (JSON.parse(fs.readFileSync(options.attemptFile, "utf8")));
    if (options.status === "running" && attempt.status !== "reserved") return { request, attempt, idempotent: attempt.status === "running" };
    if (options.status !== "running" && !["running", "reserved"].includes(asString(attempt.status) ?? "")) return { request, attempt, idempotent: attempt.status === options.status };
    const changedAt = nowIso();
    attempt.status = options.status;
    attempt.updated_at = changedAt;
    attempt.evidence_refs = uniqueStrings([...(Array.isArray(attempt.evidence_refs) ? attempt.evidence_refs : []), ...asStringArray(options.evidenceRefs)]);
    const budget = asRecord(attempt.budget);
    if (options.status === "running") {
      attempt.budget = { ...budget, reserved: true, debited: true, debit_state: "debited-after-launch", debited_at: changedAt };
      request.attempt_budget = { ...asRecord(request.attempt_budget), reserved_attempts: 1, debited_attempts: integer(asRecord(request.attempt_budget).debited_attempts, 0) + (budget.debited === true ? 0 : 1) };
    } else {
      attempt.budget = { ...budget, reserved: false, debited: budget.debited === true, debit_state: budget.debited === true ? "retained" : "released" };
      request.active_attempt = null;
      request.latest_attempt = attempt;
      request.status = options.status === "completed" ? "review-required" : (integer(asRecord(request.attempt_budget).remaining_attempts, 0) > 0 ? "requested" : "budget-exhausted");
      request.blockers = request.status === "review-required" ? ["post-repair-review-required"] : request.status === "budget-exhausted" ? ["repair-budget-exhausted", "operator-approval-required-before-delivery"] : ["repair-retry-available"];
    }
    appendRequestHistory(request, request.status, options.summary ?? `Quality repair attempt entered '${options.status}'.`, attempt.evidence_refs, changedAt);
    request.updated_at = changedAt;
    request.revision = currentRevision + 1;
    validateAttempt(attempt);
    writeJsonAtomic(options.attemptFile, attempt);
    writeRequest(requestFile, request);
    return { request, attempt, idempotent: false };
  });
}
