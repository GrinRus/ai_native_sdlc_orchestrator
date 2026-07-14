import React, { useEffect, useMemo, useRef, useState } from "react";

const TABS = ["Tasks", "Traceability", "Dependencies", "Revisions"];

function textList(values, fallback = "None") {
  return Array.isArray(values) && values.length > 0 ? values.join(", ") : fallback;
}

function taskStatus(progress, taskId) {
  return progress?.tasks?.find((entry) => entry.task_id === taskId) ?? null;
}

function TaskDrawer({ task, progress, criteria, onClose, openerRef }) {
  const closeRef = useRef(null);
  useEffect(() => {
    closeRef.current?.focus();
    function onKeyDown(event) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => () => openerRef.current?.focus?.(), [openerRef]);

  const mappedCriteria = criteria.filter((entry) => task.criteria_refs?.includes(entry.criterion_id));
  return (
    <div className="plan-drawer-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside className="plan-task-drawer" role="dialog" aria-modal="true" aria-labelledby="plan-task-title">
        <header className="drawer-header">
          <div>
            <span className="eyebrow">Task detail</span>
            <h2 id="plan-task-title">{task.title}</h2>
            <code>{task.task_id}</code>
          </div>
          <button ref={closeRef} className="secondary compact" type="button" onClick={onClose}>Close</button>
        </header>
        <dl className="plan-detail-list">
          <div><dt>Status</dt><dd>{progress?.status ?? "planned"}</dd></div>
          <div><dt>Type</dt><dd>{task.type}</dd></div>
          <div><dt>Objective</dt><dd>{task.objective}</dd></div>
          <div><dt>Rationale</dt><dd>{task.rationale}</dd></div>
          <div><dt>Scope</dt><dd><code>{textList(task.scope?.allowed_paths)}</code></dd></div>
          <div><dt>Repositories</dt><dd>{textList(task.scope?.repo_ids)}</dd></div>
          <div><dt>Dependencies</dt><dd>{textList(task.depends_on)}</dd></div>
        </dl>
        <section><h3>Work items</h3><ol>{task.work_items?.map((item) => <li key={item}>{item}</li>)}</ol></section>
        <section><h3>Criteria</h3><ul>{mappedCriteria.map((entry) => <li key={entry.criterion_id}><code>{entry.criterion_id}</code> {entry.text}</li>)}</ul></section>
        <section><h3>Verification</h3>
          <p><strong>Command groups:</strong> {textList(task.verification?.command_group_refs)}</p>
          <p><strong>Validators:</strong> {textList(task.verification?.validators)}</p>
          <p><strong>Manual checks:</strong> {textList(task.verification?.manual_checks)}</p>
          <ul>{task.verification?.success_conditions?.map((item) => <li key={item}>{item}</li>)}</ul>
        </section>
        <section><h3>Evidence and recovery</h3>
          <p><strong>Expected:</strong> {textList(task.expected_evidence)}</p>
          <p><strong>Collected:</strong> {textList(progress?.evidence_refs)}</p>
          <p><strong>Attempts:</strong> {textList(progress?.attempt_refs)}</p>
          <p><strong>Blockers:</strong> {textList(progress?.blocking_findings)}</p>
        </section>
        <section><h3>Risks</h3><ul>{task.risks?.map((item) => <li key={item}>{item}</li>)}</ul></section>
        <section><h3>Stop conditions</h3><ul>{task.stop_conditions?.map((item) => <li key={item}>{item}</li>)}</ul></section>
      </aside>
    </div>
  );
}

export function PlanWorkbench({ state, busy, onAction }) {
  const [tab, setTab] = useState("Tasks");
  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const [revisionReason, setRevisionReason] = useState("");
  const [approvalRef, setApprovalRef] = useState("");
  const openerRef = useRef(null);
  const plan = state.plan?.plan ?? null;
  const progress = state.progress?.task_progress ?? null;
  const tasks = Array.isArray(plan?.local_tasks) ? plan.local_tasks : [];
  const criteria = Array.isArray(plan?.criteria_catalog) ? plan.criteria_catalog : [];
  const selectedTask = tasks.find((task) => task.task_id === selectedTaskId) ?? null;
  const canApprove = plan?.plan_status === "proposed" && state.plan?.handoff_packet?.approval_state?.state !== "approved";
  const canRevise = ["proposed", "approved", "revision-required"].includes(plan?.plan_status);
  const approved = plan?.plan_status === "approved";
  const taskByCriterion = useMemo(() => new Map(criteria.map((criterion) => [
    criterion.criterion_id,
    tasks.filter((task) => task.criteria_refs?.includes(criterion.criterion_id)),
  ])), [criteria, tasks]);

  useEffect(() => {
    setTab("Tasks");
    setSelectedTaskId(null);
    setRevisionReason("");
    setApprovalRef("");
  }, [state.scopeKey]);

  return (
    <section className="plan-workbench" aria-labelledby="plan-workbench-title">
      <header className="plan-workbench-header">
        <div>
          <span className="eyebrow">Planning stage</span>
          <h2 id="plan-workbench-title">Plan workbench</h2>
          <p>Review task scope, traceability, dependencies, verification, evidence, and revision history before execution.</p>
        </div>
        {plan ? <div className="plan-version"><strong>{plan.plan_id}</strong><span>v{plan.plan_version} · {plan.plan_status}</span></div> : null}
      </header>

      {state.status === "loading" ? <div className="plan-state" role="status">Loading the flow plan…</div> : null}
      {state.status === "permission" ? <div className="plan-state danger" role="alert">You can inspect the flow, but plan reads or mutations require additional permission.</div> : null}
      {state.status === "error" ? <div className="plan-state danger" role="alert">{state.error}</div> : null}
      {state.status === "empty" ? (
        <div className="plan-empty-state">
          <div><h3>No structured plan yet</h3><p>Create a runner-routed candidate. Deterministic completeness validation runs before it becomes approvable.</p></div>
          <button className="primary" type="button" disabled={busy} onClick={() => onAction("create")}>Create plan</button>
        </div>
      ) : null}

      {plan ? (
        <>
          <div className="plan-actions" aria-label="Plan actions">
            <button className="secondary" type="button" disabled={busy || approved} onClick={() => onAction("create")}>{plan.plan_status === "revision-requested" ? "Create revised plan" : "Regenerate plan"}</button>
            <label><span>Revision reason</span><input value={revisionReason} onChange={(event) => setRevisionReason(event.target.value)} disabled={busy || !canRevise} placeholder="What must change?" /></label>
            <button className="secondary" type="button" disabled={busy || !canRevise || !revisionReason.trim()} onClick={() => onAction("request_revision", { reason: revisionReason.trim(), plan_ref: state.plan.plan_ref })}>Request revision</button>
            <label><span>Approval ref</span><input value={approvalRef} onChange={(event) => setApprovalRef(event.target.value)} disabled={busy || !canApprove} placeholder="approval://…" /></label>
            <button className="primary" type="button" disabled={busy || !canApprove || !approvalRef.trim()} onClick={() => onAction("approve", { approval_ref: approvalRef.trim(), plan_ref: state.plan.plan_ref })}>Approve exact version</button>
          </div>
          {approved ? <p className="plan-read-only-note" role="status">Approved plan is read-only. Request a revision to invalidate approval and start another planner attempt.</p> : null}
          {plan.plan_status === "revision-required" ? <p className="plan-read-only-note danger" role="alert">Approval is blocked by deterministic completeness findings. Inspect the validation evidence and request a planner revision.</p> : null}
          {plan.semantic_evaluation && plan.semantic_evaluation.status !== "pass" ? (
            <p className={`plan-read-only-note ${plan.semantic_evaluation.blocking ? "danger" : ""}`} role={plan.semantic_evaluation.blocking ? "alert" : "status"}>
              Semantic evaluation: {plan.semantic_evaluation.status}. {textList(plan.semantic_evaluation.warnings, `${plan.semantic_evaluation.finding_count ?? 0} finding(s); inspect the evaluation report.`)}
            </p>
          ) : null}

          <div className="plan-tabs" role="tablist" aria-label="Plan views">
            {TABS.map((name) => <button key={name} type="button" role="tab" aria-selected={tab === name} className={tab === name ? "active" : ""} onClick={() => setTab(name)}>{name}</button>)}
          </div>

          {tab === "Tasks" ? (
            <div className="plan-table-wrap">
              <table className="plan-task-table">
                <thead><tr><th>Task</th><th>Type</th><th>Scope</th><th>Dependencies</th><th>Status</th><th>Verification</th><th>Blocker</th></tr></thead>
                <tbody>{tasks.map((task) => {
                  const taskProgress = taskStatus(progress, task.task_id);
                  return <tr key={task.task_id}>
                    <td><button className="plan-task-link" type="button" onClick={(event) => { openerRef.current = event.currentTarget; setSelectedTaskId(task.task_id); }}>{task.title}</button><code>{task.task_id}</code></td>
                    <td>{task.type}</td><td><code title={textList(task.scope?.allowed_paths)}>{textList(task.scope?.allowed_paths)}</code></td>
                    <td>{textList(task.depends_on, "Ready root")}</td><td>{taskProgress?.status ?? "planned"}</td>
                    <td>{textList(task.verification?.command_group_refs?.length ? task.verification.command_group_refs : task.verification?.validators)}</td>
                    <td>{taskProgress?.blocking_findings?.[0] ?? taskProgress?.next_action ?? "None"}</td>
                  </tr>;
                })}</tbody>
              </table>
            </div>
          ) : null}

          {tab === "Traceability" ? <div className="plan-table-wrap"><table className="plan-traceability-table"><thead><tr><th>Criterion</th><th>Kind</th><th>Source</th><th>Owning tasks</th></tr></thead><tbody>{criteria.map((criterion) => <tr key={criterion.criterion_id}><td><code>{criterion.criterion_id}</code><span>{criterion.text}</span></td><td>{criterion.kind}</td><td><code>{criterion.source_ref}</code></td><td>{textList(taskByCriterion.get(criterion.criterion_id)?.map((task) => task.task_id), "Uncovered")}</td></tr>)}</tbody></table></div> : null}
          {tab === "Dependencies" ? <div className="plan-table-wrap"><table><thead><tr><th>Task</th><th>Depends on</th><th>Parallel candidate</th><th>Execution group</th></tr></thead><tbody>{tasks.map((task) => <tr key={task.task_id}><td>{task.title}</td><td>{textList(task.depends_on, "None")}</td><td>{task.execution_hints?.parallel_candidate ? "Advisory yes" : "No"}</td><td>{task.execution_hints?.group_key ?? "One task per unit"}</td></tr>)}</tbody></table></div> : null}
          {tab === "Revisions" ? <dl className="plan-revision-grid"><div><dt>Current</dt><dd>v{plan.plan_version} · {plan.plan_status}</dd></div><div><dt>Previous</dt><dd><code>{plan.previous_plan_ref ?? "Initial version"}</code></dd></div><div><dt>Summary</dt><dd>{plan.revision_summary?.reason ?? "No revision summary"}</dd></div><div><dt>Material change</dt><dd>{String(plan.revision_summary?.material_change ?? false)}</dd></div></dl> : null}
        </>
      ) : null}

      {selectedTask ? <TaskDrawer task={selectedTask} progress={taskStatus(progress, selectedTask.task_id)} criteria={criteria} openerRef={openerRef} onClose={() => setSelectedTaskId(null)} /> : null}
    </section>
  );
}
