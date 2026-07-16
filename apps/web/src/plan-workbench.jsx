import React, { useEffect, useMemo, useState } from "react";

import { DependencyView, RevisionView, TaskDetailDialog, TaskTable, TraceabilityView, taskStatus, textList } from "./plan-workbench-views.jsx";

const TABS = ["Tasks", "Traceability", "Dependencies", "Revisions"];
export function PlanWorkbench({ state, busy, onAction }) {
  const [tab, setTab] = useState("Tasks");
  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const [revisionReason, setRevisionReason] = useState("");
  const [approvalRef, setApprovalRef] = useState("");
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

          {tab === "Tasks" ? <TaskTable tasks={tasks} progress={progress} onSelect={setSelectedTaskId} /> : null}
          {tab === "Traceability" ? <TraceabilityView criteria={criteria} taskByCriterion={taskByCriterion} /> : null}
          {tab === "Dependencies" ? <DependencyView tasks={tasks} /> : null}
          {tab === "Revisions" ? <RevisionView plan={plan} /> : null}
        </>
      ) : null}

      <TaskDetailDialog task={selectedTask} progress={taskStatus(progress, selectedTask?.task_id)} criteria={criteria} onClose={() => setSelectedTaskId(null)} />
    </section>
  );
}
