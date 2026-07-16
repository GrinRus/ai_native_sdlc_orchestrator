import { issue } from "./utils.mjs";

function stableArrayKey(value) {
  return JSON.stringify([...value].sort());
}

export function validateTaskDag({ taskIds, dependencies, source }) {
  const issues = [];
  for (const [taskId, taskDependencies] of dependencies.entries()) {
    for (const dependency of taskDependencies) {
      if (!taskIds.has(dependency)) {
        issues.push(issue({ code: "enum_value_invalid", source, field: `local_tasks.${taskId}.depends_on`, expected: "known task id", actual: dependency, message: `Task '${taskId}' depends on unknown task '${dependency}'.` }));
      }
    }
  }
  const visiting = new Set();
  const visited = new Set();
  function visit(taskId) {
    if (visiting.has(taskId)) return taskId;
    if (visited.has(taskId)) return null;
    visiting.add(taskId);
    for (const dependency of dependencies.get(taskId) ?? []) {
      const cycle = visit(dependency);
      if (cycle) return cycle;
    }
    visiting.delete(taskId);
    visited.add(taskId);
    return null;
  }
  for (const taskId of taskIds) {
    const cycle = visit(taskId);
    if (cycle) {
      issues.push(issue({ code: "enum_value_invalid", source, field: "local_tasks.depends_on", expected: "acyclic dependency graph", actual: cycle, message: `Task dependency graph contains a cycle through '${cycle}'.` }));
      break;
    }
  }
  return issues;
}

export function validateCriterionCoverage({ criterionIds, referencedCriteria, source }) {
  const issues = [];
  for (const criterionId of criterionIds) {
    if (!referencedCriteria.has(criterionId)) {
      issues.push(issue({ code: "required_field_missing", source, field: "local_tasks.criteria_refs", expected: `coverage for ${criterionId}`, actual: "uncovered", message: `Criterion '${criterionId}' is not owned by any task.` }));
    }
  }
  for (const criterionId of referencedCriteria) {
    if (!criterionIds.has(criterionId)) {
      issues.push(issue({ code: "enum_value_invalid", source, field: "local_tasks.criteria_refs", expected: "known criterion id", actual: criterionId, message: `Task references unknown criterion '${criterionId}'.` }));
    }
  }
  return issues;
}

export function validateEvidenceOwnership({ expectedEvidence, ownedEvidence, source }) {
  return expectedEvidence
    .filter((evidenceType) => !ownedEvidence.has(evidenceType))
    .map((evidenceType) => issue({ code: "required_field_missing", source, field: "local_tasks.expected_evidence", expected: `owner for ${evidenceType}`, actual: "unowned", message: `Expected evidence '${evidenceType}' is not owned by any task.` }));
}

export function validateExecutionGroups({ groups, source }) {
  const issues = [];
  for (const [groupKey, members] of groups.entries()) {
    if (members.length < 2) {
      issues.push(issue({ code: "enum_value_invalid", source, field: `${members[0].field}.execution_hints.group_key`, expected: "group shared by at least two tasks", actual: groupKey, message: `Execution group '${groupKey}' has only one task.` }));
      continue;
    }
    const baseline = members[0];
    const memberIds = new Set(members.map((member) => member.taskId).filter(Boolean));
    const baselineExternalDependencies = baseline.dependsOn.filter((dependency) => !memberIds.has(dependency));
    for (const member of members.slice(1)) {
      const compatible = stableArrayKey(member.repoIds) === stableArrayKey(baseline.repoIds)
        && stableArrayKey(member.allowedPaths) === stableArrayKey(baseline.allowedPaths)
        && stableArrayKey(member.forbiddenPaths) === stableArrayKey(baseline.forbiddenPaths);
      if (!compatible) {
        issues.push(issue({ code: "enum_value_invalid", source, field: `${member.field}.execution_hints.group_key`, expected: "compatible repository and path scope", actual: groupKey, message: `Execution group '${groupKey}' contains incompatible task scopes.` }));
      }
      const memberExternalDependencies = member.dependsOn.filter((dependency) => !memberIds.has(dependency));
      if (
        member.dependsOn.some((dependency) => memberIds.has(dependency))
        || baseline.dependsOn.some((dependency) => memberIds.has(dependency))
        || stableArrayKey(memberExternalDependencies) !== stableArrayKey(baselineExternalDependencies)
      ) {
        issues.push(issue({ code: "enum_value_invalid", source, field: `${member.field}.execution_hints.group_key`, expected: "compatible external dependencies and no intra-group dependency", actual: groupKey, message: `Execution group '${groupKey}' contains incompatible task dependencies.` }));
      }
    }
  }
  return issues;
}
