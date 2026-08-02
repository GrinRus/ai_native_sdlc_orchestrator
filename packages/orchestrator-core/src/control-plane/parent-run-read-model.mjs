import fs from "node:fs";
import path from "node:path";

import { applyReadModelLimit } from "./read-artifact-readers.mjs";
import { createProjectReadContext } from "./project-context.mjs";

function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}

function asString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asStringArray(value) {
  return Array.isArray(value)
    ? value.filter((entry) => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim())
    : [];
}

function asNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function listParentRunProjections(options = {}) {
  const init = createProjectReadContext(options);
  const root = path.join(init.runtimeLayout.stateRoot, "parent-runs");
  if (!fs.existsSync(root)) return [];
  return applyReadModelLimit(
    fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^parent-run-.*\.json$/u.test(entry.name))
      .map((entry) => path.join(root, entry.name))
      .sort()
      .flatMap((file) => {
        try {
          const parent = JSON.parse(fs.readFileSync(file, "utf8"));
          const parentRunId = asString(parent.parent_run_id);
          if (!parentRunId) return [];
          return [{
            parent_run_id: parentRunId,
            status: asString(parent.status),
            revision: asNumber(parent.revision),
            execution_plan_ref: asString(parent.execution_plan_ref),
            workspace_set_ref: asString(parent.workspace_set_ref),
            max_concurrency: asNumber(parent.max_concurrency),
            capacity: asRecord(parent.capacity),
            budgets: asRecord(parent.budgets),
            consumed: asRecord(parent.consumed),
            units: Array.isArray(parent.units) ? parent.units : [],
            integration_gates: Array.isArray(parent.integration_gates) ? parent.integration_gates : [],
            integration_report_ref: asString(parent.integration_report_ref),
            stale_units: Array.isArray(parent.stale_units) ? parent.stale_units : [],
            repair_refs: asStringArray(parent.repair_refs),
            blocker: asRecord(parent.blocker),
            state_file: file,
          }];
        } catch {
          return [];
        }
      }),
    options.limit,
  );
}

export function projectParentRunRelations(parent) {
  return parent.units.flatMap((unitRaw) => {
    const unit = asRecord(unitRaw);
    return (Array.isArray(unit.child_runs) ? unit.child_runs : []).flatMap((childRaw) => {
      const child = asRecord(childRaw);
      const childRunId = asString(child.child_run_id);
      if (!childRunId) return [];
      return [{
        child_run_id: childRunId,
        parent_run_id: parent.parent_run_id,
        execution_unit_id: asString(unit.execution_unit_id),
        task_refs: asStringArray(unit.task_refs),
        attempt: asNumber(child.attempt),
      }];
    });
  });
}

export function attachParentRunProjections(options, ensureRun, normalizeRunRef) {
  for (const parentProjection of listParentRunProjections(options)) {
    const parentRunId = normalizeRunRef(parentProjection.parent_run_id);
    ensureRun(parentRunId).parent_run = parentProjection;
    for (const relation of projectParentRunRelations(parentProjection)) {
      const childRunId = normalizeRunRef(relation.child_run_id);
      const publicRelation = { ...relation };
      delete publicRelation.child_run_id;
      ensureRun(childRunId).parent_relation = publicRelation;
    }
  }
}
