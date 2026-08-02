export function attentionRows(projection, resourceErrors = {}) {
  const durable = Array.isArray(projection?.items) ? projection.items : [];
  const readErrors = Object.entries(resourceErrors).map(([resource, error]) => ({
    item_id: `read-error.${resource}`,
    source_family: "control-plane-read",
    source_ref: resource,
    stage: null,
    state: "needs-attention",
    severity: "warning",
    title: error?.title ?? `${resource} unavailable`,
    consequence: error?.consequence ?? error?.detail ?? error?.message ?? "Last-known data may be stale.",
    operator_control: null,
    evidence_refs: error?.evidenceRefs ?? [],
    transient_read_error: true,
  }));
  return [...readErrors, ...durable];
}

export function journeyRows(planState, runs = [], deliveryManifests = []) {
  const tasks = planState?.progress?.task_progress?.tasks ?? planState?.progress?.tasks ?? [];
  const taskRows = tasks.map((task) => ({ id: task.task_id, label: task.title ?? task.task_id, status: task.status ?? task.progress_status ?? "unknown", kind: "Task" }));
  const runRows = runs.map((run) => ({ id: run.run_id, label: run.run_id, status: run.status ?? run.job_status ?? "unknown", kind: run.parent_run_id ? "Child run" : "Run" }));
  const deliveryRows = deliveryManifests.map((entry) => ({ id: entry.manifest_id ?? entry.artifact_ref, label: entry.manifest_id ?? "Delivery", status: entry.status ?? "unknown", kind: "Delivery" }));
  return [...taskRows, ...runRows, ...deliveryRows];
}
