import React from "react";

import { deliveryTransactionRows, integrationCommand, parentRunRows } from "./execution-orchestration-model.js";
export { executeOrchestrationCommand } from "./execution-orchestration-model.js";
import "./execution-orchestration.css";

function Status({ value }) {
  return <span className={`orchestration-status orchestration-status-${String(value ?? "unknown")}`}>{value ?? "unknown"}</span>;
}

function UnitRow({ parent, unit, busy, onCommand }) {
  const serialized = (unit.conflict_keys?.length ?? 0) > 0;
  const failed = unit.status === "failed";
  return (
    <li className="orchestration-unit">
      <div><strong>{unit.execution_unit_id}</strong><Status value={unit.status} /></div>
      <p>{unit.task_refs?.join(", ") || "No task refs"}</p>
      <dl>
        <div><dt>Dependencies</dt><dd>{unit.depends_on?.join(", ") || "Ready at start"}</dd></div>
        <div><dt>Scheduling</dt><dd>{serialized ? `Serialized: ${unit.conflict_keys.join(", ")}` : "Parallel candidate when dependencies allow"}</dd></div>
        <div><dt>Attempts</dt><dd>{unit.attempt_count ?? unit.child_runs?.length ?? 0}</dd></div>
        <div><dt>Changed paths</dt><dd>{unit.changed_paths?.join(", ") || "Pending evidence"}</dd></div>
      </dl>
      {failed ? <button type="button" className="secondary compact" disabled={busy} onClick={() => onCommand(integrationCommand("retry", parent, unit))}>Retry failed unit</button> : null}
    </li>
  );
}

function IntegrationPanel({ parent, busy, onCommand }) {
  const held = parent.status === "paused";
  return (
    <section className="orchestration-integration" aria-labelledby={`integration-${parent.parent_run_id}`}>
      <div className="orchestration-section-heading">
        <div><p className="eyebrow">Aggregate gate</p><h4 id={`integration-${parent.parent_run_id}`}>Integration and recovery</h4></div>
        <button type="button" className="secondary compact" disabled={busy} onClick={() => onCommand(integrationCommand(held ? "resume" : "hold", parent))}>{held ? "Resume integration" : "Hold parent run"}</button>
      </div>
      <ul className="orchestration-gates">
        {(parent.integration_gates ?? []).map((gate) => <li key={gate.gate_id}><strong>{gate.gate_id}</strong><Status value={gate.status} /></li>)}
      </ul>
      {parent.stale_units?.length ? <div className="orchestration-warning" role="alert"><strong>Stale work requires rerun</strong><p>{parent.stale_units.map((unit) => unit.execution_unit_id).join(", ")}</p></div> : null}
      {parent.repair_refs?.length ? <details><summary>Bounded repair evidence</summary><ul>{parent.repair_refs.map((ref) => <li key={ref}><code>{ref}</code></li>)}</ul></details> : null}
      {parent.integration_report_ref ? <details><summary>Integration evidence</summary><code>{parent.integration_report_ref}</code></details> : null}
    </section>
  );
}

function DeliveryPanel({ transactions }) {
  if (transactions.length === 0) return <p className="orchestration-empty">No coordinated delivery manifest has been materialized.</p>;
  return transactions.map((transaction) => (
    <section key={transaction.manifest_id} className={`orchestration-delivery ${transaction.partial ? "is-partial" : ""}`}>
      <div className="orchestration-section-heading"><h4>{transaction.manifest_id}</h4><Status value={transaction.status} /></div>
      {transaction.partial ? <div className="orchestration-warning" role="alert"><strong>Partial delivery is not success</strong><p>Use repository recovery evidence before retrying or closing delivery.</p></div> : null}
      <ul className="orchestration-repositories">
        {transaction.repo_deliveries.map((repo) => <li key={repo.repo_id}>
          <div><strong>{repo.repo_id}</strong><Status value={repo.transaction_stage ?? repo.writeback_result} /></div>
          <p>{repo.changed_paths?.length ?? 0} changed paths · {repo.failed_step ?? "no failed step"}</p>
          {repo.recovery_action ? <p>Recovery: {repo.recovery_action}</p> : null}
        </li>)}
      </ul>
      {transaction.integration_report_ref ? <details><summary>Delivery authorization evidence</summary><code>{transaction.integration_report_ref}</code></details> : null}
    </section>
  ));
}

export function ExecutionOrchestration({ runs, deliveryManifests, flowId, busy, onCommand }) {
  const parents = parentRunRows(runs, flowId);
  const transactions = deliveryTransactionRows(deliveryManifests);
  if (parents.length === 0 && transactions.length === 0) return null;
  return (
    <section className="work-card execution-orchestration" aria-labelledby="execution-orchestration-title">
      <div className="orchestration-header"><div><p className="eyebrow">Controlled execution</p><h2 id="execution-orchestration-title">Execution, integration, and delivery</h2><p>Parent missions, child attempts, aggregate gates, and repository transactions remain distinct.</p></div></div>
      {parents.map((parent) => <article key={parent.parent_run_id} className="orchestration-parent">
        <div className="orchestration-section-heading"><div><h3>{parent.parent_run_id}</h3><p>Revision {parent.revision} · max concurrency {parent.max_concurrency ?? 1}</p></div><Status value={parent.status} /></div>
        <ol className="orchestration-units" aria-label={`Execution units for ${parent.parent_run_id}`}>{(parent.units ?? []).map((unit) => <UnitRow key={unit.execution_unit_id} parent={parent} unit={unit} busy={busy} onCommand={onCommand} />)}</ol>
        <IntegrationPanel parent={parent} busy={busy} onCommand={onCommand} />
      </article>)}
      <div className="orchestration-delivery-list"><h3>Coordinated delivery</h3><DeliveryPanel transactions={transactions} /></div>
    </section>
  );
}
