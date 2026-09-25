export function taskOutcome(task, fallback = "") {
  return String(task?.prepared_contract?.outcome ?? task?.normalization?.outcome ?? task?.intent?.outcome ?? fallback).trim();
}

export function taskAcceptanceCriteria(task) {
  const candidates = [task?.prepared_contract?.acceptance_criteria, task?.acceptance_criteria, task?.normalization?.acceptance];
  return candidates.find(Array.isArray) ?? [];
}

export function taskScopePaths(task) {
  const candidates = [task?.prepared_contract?.scope?.allowed_paths, task?.scope?.allowed_paths, task?.scope];
  const value = candidates.find(Array.isArray);
  return value ?? [];
}

export function taskScopeLabel(task) {
  const scope = task?.prepared_contract?.scope;
  const allowed = Array.isArray(scope?.allowed_paths) ? scope.allowed_paths : taskScopePaths(task);
  const forbidden = Array.isArray(scope?.forbidden_paths) ? scope.forbidden_paths : [];
  const labels = [];
  if (allowed.length) labels.push(`Allowed: ${allowed.join(", ")}`);
  if (forbidden.length) labels.push(`Excluded: ${forbidden.join(", ")}`);
  if (labels.length) return labels.join(" · ");
  if (scope && typeof scope === "object") return "No path restrictions published.";
  return typeof task?.scope === "string" ? task.scope : "";
}

export function taskScopeIsPublished(task) {
  return Boolean(task?.prepared_contract?.scope || taskScopePaths(task).length || task?.scope);
}
