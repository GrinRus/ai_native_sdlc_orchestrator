import React from "react";

import { Dialog } from "./dialog.jsx";

export function textList(values, fallback = "None") {
  return Array.isArray(values) && values.length > 0 ? values.join(", ") : fallback;
}

export function taskStatus(progress, taskId) {
  return progress?.tasks?.find((entry) => entry.task_id === taskId) ?? null;
}

export function TaskDetailDialog({ task, progress, criteria, onClose }) {
  const mappedCriteria = criteria.filter((entry) => task?.criteria_refs?.includes(entry.criterion_id));
  return (
    <Dialog open={Boolean(task)} onClose={onClose} labelledBy="plan-task-title" className="plan-task-drawer" backdropClassName="plan-drawer-backdrop">
      <header className="drawer-header"><div><span className="eyebrow">Task detail</span><h2 id="plan-task-title">{task?.title}</h2><code>{task?.task_id}</code></div><button className="secondary compact" type="button" onClick={onClose}>Close</button></header>
      <dl className="plan-detail-list">
        <div><dt>Status</dt><dd>{progress?.status ?? "planned"}</dd></div><div><dt>Type</dt><dd>{task?.type}</dd></div>
        <div><dt>Objective</dt><dd>{task?.objective}</dd></div><div><dt>Rationale</dt><dd>{task?.rationale}</dd></div>
        <div><dt>Scope</dt><dd><code>{textList(task?.scope?.allowed_paths)}</code></dd></div><div><dt>Repositories</dt><dd>{textList(task?.scope?.repo_ids)}</dd></div>
        <div><dt>Dependencies</dt><dd>{textList(task?.depends_on)}</dd></div>
      </dl>
      <section><h3>Work items</h3><ol>{task?.work_items?.map((item) => <li key={item}>{item}</li>)}</ol></section>
      <section><h3>Criteria</h3><ul>{mappedCriteria.map((entry) => <li key={entry.criterion_id}><code>{entry.criterion_id}</code> {entry.text}</li>)}</ul></section>
      <section><h3>Verification</h3><p><strong>Command groups:</strong> {textList(task?.verification?.command_group_refs)}</p><p><strong>Validators:</strong> {textList(task?.verification?.validators)}</p><p><strong>Manual checks:</strong> {textList(task?.verification?.manual_checks)}</p><ul>{task?.verification?.success_conditions?.map((item) => <li key={item}>{item}</li>)}</ul></section>
      <section><h3>Evidence and recovery</h3><p><strong>Expected:</strong> {textList(task?.expected_evidence)}</p><p><strong>Collected:</strong> {textList(progress?.evidence_refs)}</p><p><strong>Attempts:</strong> {textList(progress?.attempt_refs)}</p><p><strong>Blockers:</strong> {textList(progress?.blocking_findings)}</p></section>
      <section><h3>Risks</h3><ul>{task?.risks?.map((item) => <li key={item}>{item}</li>)}</ul></section>
      <section><h3>Stop conditions</h3><ul>{task?.stop_conditions?.map((item) => <li key={item}>{item}</li>)}</ul></section>
    </Dialog>
  );
}

export function TaskTable({ tasks, progress, onSelect }) {
  return <div className="plan-table-wrap"><table className="plan-task-table"><thead><tr><th>Task</th><th>Type</th><th>Scope</th><th>Dependencies</th><th>Status</th><th>Verification</th><th>Blocker</th></tr></thead><tbody>{tasks.map((task) => {
    const projected = taskStatus(progress, task.task_id);
    return <tr key={task.task_id}><td><button className="plan-task-link" type="button" onClick={() => onSelect(task.task_id)}>{task.title}</button><code>{task.task_id}</code></td><td>{task.type}</td><td><code title={textList(task.scope?.allowed_paths)}>{textList(task.scope?.allowed_paths)}</code></td><td>{textList(task.depends_on, "Ready root")}</td><td>{projected?.status ?? "planned"}</td><td>{textList(task.verification?.command_group_refs?.length ? task.verification.command_group_refs : task.verification?.validators)}</td><td>{projected?.blocking_findings?.[0] ?? projected?.next_action ?? "None"}</td></tr>;
  })}</tbody></table></div>;
}

export function TraceabilityView({ criteria, taskByCriterion }) {
  return <div className="plan-table-wrap"><table className="plan-traceability-table"><thead><tr><th>Criterion</th><th>Kind</th><th>Source</th><th>Owning tasks</th></tr></thead><tbody>{criteria.map((criterion) => <tr key={criterion.criterion_id}><td><code>{criterion.criterion_id}</code><span>{criterion.text}</span></td><td>{criterion.kind}</td><td><code>{criterion.source_ref}</code></td><td>{textList(taskByCriterion.get(criterion.criterion_id)?.map((task) => task.task_id), "Uncovered")}</td></tr>)}</tbody></table></div>;
}

export function DependencyView({ tasks }) {
  return <div className="plan-table-wrap"><table><thead><tr><th>Task</th><th>Depends on</th><th>Parallel candidate</th><th>Execution group</th></tr></thead><tbody>{tasks.map((task) => <tr key={task.task_id}><td>{task.title}</td><td>{textList(task.depends_on, "None")}</td><td>{task.execution_hints?.parallel_candidate ? "Advisory yes" : "No"}</td><td>{task.execution_hints?.group_key ?? "One task per unit"}</td></tr>)}</tbody></table></div>;
}

export function RevisionView({ plan }) {
  return <dl className="plan-revision-grid"><div><dt>Current</dt><dd>v{plan.plan_version} · {plan.plan_status}</dd></div><div><dt>Previous</dt><dd><code>{plan.previous_plan_ref ?? "Initial version"}</code></dd></div><div><dt>Summary</dt><dd>{plan.revision_summary?.reason ?? "No revision summary"}</dd></div><div><dt>Material change</dt><dd>{String(plan.revision_summary?.material_change ?? false)}</dd></div></dl>;
}
