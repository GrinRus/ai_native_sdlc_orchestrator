import crypto from "node:crypto";

function records(value) {
  return Array.isArray(value) ? value.filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry)) : [];
}

function strings(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string" && entry.length > 0) : [];
}

function unique(values) {
  return [...new Set(values)].sort();
}

function overlaps(left, right) {
  return left.some((value) => right.some((candidate) => value === candidate || value.startsWith(`${candidate}/`) || candidate.startsWith(`${value}/`)));
}

function repositoryMap(topology) {
  return new Map(records(topology?.repos ?? topology?.repositories).map((repository) => [
    String(repository.repo_id),
    repository,
  ]));
}

function unitTaskRecords(unit, tasks) {
  const refs = new Set(strings(unit.task_refs));
  return records(tasks).filter((task) => refs.has(String(task.task_id)));
}

function concurrencyReasons(unit, allUnits) {
  const reasons = [];
  if (unit.depends_on.length > 0) reasons.push("dependency");
  const scope = unit.scope ?? {};
  for (const candidate of allUnits) {
    if (candidate.unit_id === unit.unit_id) continue;
    const sharedRepository = overlaps(strings(scope.repo_ids), strings(candidate.scope?.repo_ids));
    if (sharedRepository && overlaps(strings(scope.allowed_paths), strings(candidate.scope?.allowed_paths))) reasons.push("path-overlap");
    if (overlaps(strings(scope.component_ids), strings(candidate.scope?.component_ids))) reasons.push("shared-component");
    if (overlaps(strings(unit.conflict_keys), strings(candidate.conflict_keys))) reasons.push("conflict-key");
    if (overlaps(strings(unit.command_locks), strings(candidate.command_locks))) reasons.push("command-lock");
  }
  if (unit.parallel_candidate !== true) reasons.push("policy-limit");
  return unique(reasons);
}

export function enrichExecutionDag({ units, tasks, topology = {}, integrationVerification = [] }) {
  const repos = repositoryMap(topology);
  const enriched = units.map((unit) => {
    const members = unitTaskRecords(unit, tasks);
    const hints = members.map((task) => task.execution_hints ?? {});
    const repoIds = unique(strings(unit.scope?.repo_ids));
    const componentIds = unique(strings(unit.scope?.component_ids));
    return {
      ...unit,
      repository_scope: repoIds,
      component_scope: componentIds,
      workspace_mounts: repoIds.map((repoId) => ({
        repo_id: repoId,
        mount_path: repos.get(repoId)?.workspace_mount ?? `repos/${repoId}`,
      })),
      conflict_keys: unique(hints.flatMap((hint) => strings(hint.conflict_keys))),
      command_locks: unique(hints.flatMap((hint) => strings(hint.command_locks))),
      verification_gates: members.flatMap((task) => records(task.verification).map((gate) => ({
        task_ref: String(task.task_id),
        ...gate,
      }))),
      criteria_coverage: members.flatMap((task) => strings(task.criteria_refs).map((criterion) => ({
        criterion_ref: criterion,
        task_ref: String(task.task_id),
        gate: "unit",
      }))),
    };
  });
  for (const unit of enriched) {
    const reasons = concurrencyReasons(unit, enriched);
    unit.concurrency = {
      classification: reasons.length === 0 ? "parallel-candidate" : "serialized",
      reasons,
    };
    unit.parallel_candidate = reasons.length === 0;
  }
  const integrationGates = records(integrationVerification).map((gate, index) => ({
    gate_id: gate.gate_id ?? `integration-${index + 1}`,
    ...gate,
  }));
  return { units: enriched, integrationGates };
}

export function executionDagDigest(value) {
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

export function validateExecutionDagCoverage({ tasks, units, nonRunTasks = [], approvedScope = null }) {
  const findings = [];
  const unitRecords = records(units);
  const unitsById = new Map(unitRecords.map((unit) => [String(unit.unit_id), unit]));
  const taskIds = new Set(records(tasks).map((task) => String(task.task_id)));
  const mappings = new Map([...taskIds].map((taskId) => [taskId, 0]));
  for (const unit of unitRecords) {
    for (const taskRef of strings(unit.task_refs)) {
      if (!taskIds.has(taskRef)) findings.push({ code: "unknown-task-ref", task_ref: taskRef, unit_id: unit.unit_id });
      else mappings.set(taskRef, mappings.get(taskRef) + 1);
    }
    for (const dependency of strings(unit.depends_on)) {
      if (!unitsById.has(dependency)) findings.push({ code: "unknown-unit-dependency", unit_id: unit.unit_id, dependency });
    }
    if (approvedScope) {
      for (const repoId of strings(unit.scope?.repo_ids)) {
        if (!strings(approvedScope.repo_ids).includes(repoId)) findings.push({ code: "scope-expansion", unit_id: unit.unit_id, resource: repoId });
      }
    }
  }
  const visiting = new Set();
  const visited = new Set();
  function visit(unitId) {
    if (visiting.has(unitId)) {
      findings.push({ code: "dependency-cycle", unit_id: unitId });
      return;
    }
    if (visited.has(unitId) || !unitsById.has(unitId)) return;
    visiting.add(unitId);
    for (const dependency of strings(unitsById.get(unitId).depends_on)) visit(dependency);
    visiting.delete(unitId);
    visited.add(unitId);
  }
  for (const unitId of unitsById.keys()) visit(unitId);
  for (const taskRef of strings(nonRunTasks)) {
    if (!taskIds.has(taskRef)) findings.push({ code: "unknown-non-run-task", task_ref: taskRef });
    else mappings.set(taskRef, mappings.get(taskRef) + 1);
  }
  for (const [taskRef, count] of mappings) {
    if (count === 0) findings.push({ code: "dropped-task", task_ref: taskRef });
    if (count > 1) findings.push({ code: "duplicate-task-mapping", task_ref: taskRef });
  }
  return { ok: findings.length === 0, findings };
}
