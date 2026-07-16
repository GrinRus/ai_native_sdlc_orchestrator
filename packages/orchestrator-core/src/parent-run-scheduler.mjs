import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { derivePublicId, validatePublicId } from "../../contracts/src/index.mjs";
import { withFileLock, writeJsonAtomic } from "../../observability/src/file-transaction.mjs";
import { initializeProjectRuntime, previewProjectRuntime } from "./project-init.mjs";

const TERMINAL = new Set(["succeeded", "failed", "canceled", "blocked"]);
const ACTIVE = new Set(["queued", "running", "paused", "canceling"]);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function parentFile(layout, parentRunId) {
  return path.join(layout.stateRoot, "parent-runs", `parent-run-${parentRunId}.json`);
}

function requestDigest(options) {
  return crypto.createHash("sha256").update(JSON.stringify({
    execution_plan_ref: options.executionPlanRef,
    workspace_set_ref: options.workspaceSetRef,
    workspace_set_id: options.workspaceSet.workspace_set_id,
    dag_digest: options.executionPlan.dag_digest,
    max_concurrency: options.maxConcurrency,
    capacity: options.capacity,
    budgets: options.budgets,
  })).digest("hex");
}

function unitProjection(unit) {
  return {
    execution_unit_id: unit.unit_id,
    task_refs: unit.task_refs,
    depends_on: unit.depends_on,
    conflict_keys: unit.conflict_keys ?? [],
    status: "pending",
    attempt_count: 0,
    active_child_run_id: null,
    child_runs: [],
    blocker_codes: [],
  };
}

function readyUnits(parent) {
  const byId = new Map(parent.units.map((unit) => [unit.execution_unit_id, unit]));
  const activeKeys = new Set(parent.units.filter((unit) => ACTIVE.has(unit.status)).flatMap((unit) => unit.conflict_keys));
  return parent.units
    .filter((unit) => unit.status === "pending")
    .filter((unit) => unit.depends_on.every((dependency) => byId.get(dependency)?.status === "succeeded"))
    .filter((unit) => !unit.conflict_keys.some((key) => activeKeys.has(key)))
    .sort((left, right) => left.execution_unit_id.localeCompare(right.execution_unit_id));
}

function aggregateStatus(parent) {
  if (parent.status === "paused" || parent.status === "canceling" || parent.status === "canceled") return parent.status;
  if (parent.blocker) return "blocked";
  if (parent.units.some((unit) => unit.status === "failed")) return "blocked";
  if (parent.units.every((unit) => unit.status === "succeeded" || unit.status === "non-run")) {
    return parent.integration_gates.every((gate) => gate.status === "passed") ? "succeeded" : "integration-pending";
  }
  return parent.units.some((unit) => ACTIVE.has(unit.status)) ? "running" : "queued";
}

function updateParent(file, expectedRevision, update) {
  return withFileLock(`${file}.lock`, () => {
    const current = readJson(file);
    if (expectedRevision !== undefined && current.revision !== expectedRevision) {
      const error = new Error(`Parent run revision conflict: expected ${expectedRevision}, found ${current.revision}.`);
      error.code = "parent-run-revision-conflict";
      throw error;
    }
    const next = update(structuredClone(current));
    if (next === null) return current;
    next.revision = current.revision + 1;
    next.updated_at = new Date().toISOString();
    next.status = aggregateStatus(next);
    writeJsonAtomic(file, next);
    return next;
  });
}

export function startParentRun(options) {
  const init = initializeProjectRuntime(options);
  const parentRunId = options.parentRunId ?? options.workspaceSet.run_id;
  if (!validatePublicId(parentRunId).ok) throw new Error(`Invalid parent_run_id '${parentRunId}'.`);
  if (
    options.workspaceSet.status !== "ready" ||
    options.workspaceSet.run_id !== parentRunId ||
    options.workspaceSet.project_id !== init.projectId ||
    (options.workspaceSet.conflicts ?? []).length > 0
  ) {
    const error = new Error("Parent run requires a ready, conflict-free workspace set owned by the same project and run.");
    error.code = "workspace-set-not-ready";
    throw error;
  }
  if (
    options.executionPlan.status !== "ready" ||
    options.executionPlan.approval?.invalidated === true ||
    options.executionPlan.project_id !== init.projectId
  ) {
    const error = new Error("Parent run requires a ready approved execution plan.");
    error.code = "execution-plan-not-ready";
    throw error;
  }
  const workspaceRepositoryIds = new Set(options.workspaceSet.repositories.map((repository) => repository.repo_id));
  const missingRepositories = (options.executionPlan.impacted_scope?.repo_ids ?? [])
    .filter((repoId) => !workspaceRepositoryIds.has(repoId));
  if (missingRepositories.length > 0) {
    const error = new Error(`Workspace set is missing execution-plan repositories: ${missingRepositories.join(", ")}.`);
    error.code = "workspace-set-scope-mismatch";
    throw error;
  }
  const file = parentFile(init.runtimeLayout, parentRunId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const digest = requestDigest(options);
  let createdNew = false;
  const parent = withFileLock(`${file}.lock`, () => {
    if (fs.existsSync(file)) {
      const existing = readJson(file);
      if (existing.request_digest !== digest) {
        const error = new Error(`Parent run '${parentRunId}' exists with a different request.`);
        error.code = "parent-run-request-conflict";
        throw error;
      }
      return existing;
    }
    const now = new Date().toISOString();
    createdNew = true;
    const created = {
      schema_version: 1,
      parent_run_id: parentRunId,
      project_id: init.projectId,
      flow_id: options.flowId ?? null,
      execution_plan_ref: options.executionPlanRef,
      execution_plan_id: options.executionPlan.execution_plan_id,
      dag_digest: options.executionPlan.dag_digest,
      workspace_set_ref: options.workspaceSetRef,
      workspace_set_id: options.workspaceSet.workspace_set_id,
      status: "queued",
      revision: 0,
      max_concurrency: Math.max(1, options.maxConcurrency ?? 1),
      capacity: {
        provider_slots: Math.max(1, options.capacity?.provider_slots ?? options.maxConcurrency ?? 1),
        tool_slots: Math.max(1, options.capacity?.tool_slots ?? options.maxConcurrency ?? 1),
      },
      budgets: { max_child_starts: options.budgets?.max_child_starts ?? options.executionPlan.execution_units.length * 2 },
      consumed: { child_starts: 0 },
      request_digest: digest,
      units: options.executionPlan.execution_units.map(unitProjection),
      integration_gates: (options.executionPlan.integration_gates ?? []).map((gate) => ({ ...gate, status: "pending", evidence_refs: [] })),
      command_ids: [],
      event_cursor: 0,
      created_at: now,
      updated_at: now,
      terminal_at: null,
    };
    writeJsonAtomic(file, created);
    return created;
  });
  return { init, file, parent, idempotent: !createdNew };
}

export function scheduleParentRun(options) {
  const started = [];
  const parent = updateParent(options.parentFile, options.expectedRevision, (current) => {
    if (TERMINAL.has(current.status) || current.status === "paused") return null;
    const concurrencyCeiling = Math.min(
      current.max_concurrency,
      current.capacity.provider_slots,
      current.capacity.tool_slots,
    );
    const capacity = Math.max(0, concurrencyCeiling - current.units.filter((unit) => ACTIVE.has(unit.status)).length);
    const budget = Math.max(0, current.budgets.max_child_starts - current.consumed.child_starts);
    const selected = [];
    const selectedKeys = new Set();
    for (const unit of readyUnits(current)) {
      if (selected.length >= Math.min(capacity, budget)) break;
      if (unit.conflict_keys.some((key) => selectedKeys.has(key))) continue;
      selected.push(unit);
      unit.conflict_keys.forEach((key) => selectedKeys.add(key));
    }
    for (const unit of selected) {
      unit.attempt_count += 1;
      unit.active_child_run_id = derivePublicId([current.parent_run_id, unit.execution_unit_id, `attempt-${unit.attempt_count}`], "child-run");
      unit.status = "queued";
      unit.child_runs.push({
        child_run_id: unit.active_child_run_id,
        attempt: unit.attempt_count,
        status: "queued",
        evidence_refs: [],
      });
      current.consumed.child_starts += 1;
      started.push({ parent_run_id: current.parent_run_id, execution_unit_id: unit.execution_unit_id, child_run_id: unit.active_child_run_id, attempt: unit.attempt_count });
    }
    if (capacity > 0 && budget === 0 && readyUnits(current).length > 0) {
      current.status = "blocked";
      current.blocker = { code: "parent-run-budget-exhausted", detail: "Child start budget is exhausted." };
    }
    return selected.length > 0 || current.blocker ? current : null;
  });
  const launched = started.map((child) => options.startChild?.(child) ?? child);
  return { parent, started: launched };
}

export function completeChildRun(options) {
  return updateParent(options.parentFile, options.expectedRevision, (current) => {
    const unit = current.units.find((candidate) => candidate.execution_unit_id === options.executionUnitId);
    if (!unit || unit.active_child_run_id !== options.childRunId) {
      const error = new Error("Child completion does not match the active parent unit reservation.");
      error.code = "parent-child-identity-conflict";
      throw error;
    }
    const child = unit.child_runs.find((candidate) => candidate.child_run_id === options.childRunId);
    child.status = options.status;
    child.evidence_refs = options.evidenceRefs ?? [];
    unit.status = options.status;
    unit.active_child_run_id = null;
    return current;
  });
}

export function controlParentRun(options) {
  return updateParent(options.parentFile, options.expectedRevision, (current) => {
    if (current.command_ids.includes(options.commandId)) return null;
    current.command_ids.push(options.commandId);
    if (options.action === "pause") current.status = "paused";
    else if (options.action === "resume" && current.status === "paused") current.status = "queued";
    else if (options.action === "cancel") {
      current.status = "canceling";
      for (const unit of current.units.filter((candidate) => ACTIVE.has(candidate.status))) {
        unit.status = "canceling";
      }
    } else {
      const error = new Error(`Parent control action '${options.action}' is invalid from '${current.status}'.`);
      error.code = "parent-run-transition-conflict";
      throw error;
    }
    for (const unit of current.units.filter((candidate) => ACTIVE.has(candidate.status))) {
      options.controlChild?.({
        action: options.action,
        childRunId: unit.active_child_run_id,
        executionUnitId: unit.execution_unit_id,
      });
    }
    return current;
  });
}

export function retryParentUnit(options) {
  return updateParent(options.parentFile, options.expectedRevision, (current) => {
    if (current.command_ids.includes(options.commandId)) return null;
    const unit = current.units.find((candidate) => candidate.execution_unit_id === options.executionUnitId);
    if (!unit || unit.status !== "failed") {
      const error = new Error("Only a failed execution unit can be retried.");
      error.code = "parent-run-retry-conflict";
      throw error;
    }
    current.command_ids.push(options.commandId);
    unit.status = "pending";
    unit.blocker_codes = [];
    return current;
  });
}

export function readParentRun(options) {
  const init = previewProjectRuntime(options);
  const file = parentFile(init.runtimeLayout, options.parentRunId);
  return { init, file, parent: fs.existsSync(file) ? readJson(file) : null };
}
