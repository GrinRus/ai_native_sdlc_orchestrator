import { useState } from "react";
import { Button } from "./ui/components.jsx";

function actionLabel(control) {
  const label = typeof control === "string" ? control : control?.label;
  return typeof label === "string" && label.trim() ? label.trim() : "Run server action";
}

function actionForTask(task) {
  const action = task?.primary_action;
  const actionId = typeof action?.action_id === "string" ? action.action_id.trim() : "";
  if (!actionId || actionId === "review-decide" || action?.category !== "mutation" || action?.permission !== "mutate") return null;
  const schema = action.payload && typeof action.payload === "object" ? action.payload : {};
  const fields = Object.entries(schema).filter(([name, rule]) => (rule?.required || rule?.ui_required)
    && !["expected_revision", "expected_selection_revision"].includes(name));
  const payload = {};
  if (schema.expected_revision?.required || schema.expected_revision?.ui_required) payload.expected_revision = task?.revision;
  if (schema.expected_selection_revision?.required || schema.expected_selection_revision?.ui_required) payload.expected_selection_revision = task?.runner_selection?.selection_revision ?? 0;
  return {
    actionId,
    label: actionLabel(action.operator_control),
    reason: action.reason || "",
    available: action.available !== false && action.operator_control?.availability !== "blocked",
    requiresConfirmation: action.requires_confirmation === true || action.operator_control?.requires_confirmation === true,
    fields,
    payload,
    unsupported: fields.some(([, rule]) => rule?.type !== "string" || (rule?.enum !== undefined && !Array.isArray(rule.enum))),
    validRevision: (!Object.hasOwn(payload, "expected_revision") || Number.isInteger(payload.expected_revision)) && (!Object.hasOwn(payload, "expected_selection_revision") || Number.isInteger(payload.expected_selection_revision)),
  };
}

export function TaskPrimaryActionControl({ task, onTaskAction, onComplete, actionBusy = false, compact = false }) {
  const [formState, setFormState] = useState({ key: "", values: {}, confirming: false });
  const action = actionForTask(task);
  const stateKey = `${task?.task_id ?? ""}:${task?.revision ?? ""}:${action?.actionId ?? ""}`;
  const current = formState.key === stateKey ? formState : { key: stateKey, values: {}, confirming: false };
  if (!action) return null;

  const values = current.values;
  const fieldsValid = action.fields.every(([name, rule]) => typeof values[name] === "string"
    && values[name].trim().length > 0 && (!Array.isArray(rule.enum) || rule.enum.includes(values[name])));
  const canRun = action.available && action.validRevision && !action.unsupported && fieldsValid && !actionBusy;
  const payload = { ...action.payload, ...Object.fromEntries(action.fields.map(([name]) => [name, values[name]?.trim() ?? ""])) };

  async function submit(event) {
    event.preventDefault();
    if (!canRun) return;
    if (action.requiresConfirmation && !current.confirming) { setFormState({ ...current, confirming: true }); return; }
    const result = await onTaskAction?.(task, action.actionId, payload);
    if (result) { setFormState({ key: stateKey, values: {}, confirming: false }); onComplete?.(result); }
  }

  return <section className={`task-primary-action-control${compact ? " task-primary-action-control--compact" : ""}`} aria-label="Server-published Task action">
    <div className="task-primary-action-control__summary"><strong>{action.label}</strong>{action.reason ? <p>{action.reason}</p> : null}{!action.available ? <p className="task-inline-alert" role="status">This action is blocked by the server.</p> : null}{!action.validRevision ? <p className="task-inline-alert" role="status">Refresh Task details before running this action.</p> : null}{action.unsupported ? <p className="task-inline-alert" role="status">The Task Workspace cannot collect every required field for this action.</p> : null}</div>
    {action.available && action.validRevision && !action.unsupported ? <form onSubmit={(event) => void submit(event)}>
      {action.fields.length ? <div className="task-primary-action-control__fields">{action.fields.map(([name, rule]) => <label className="task-primary-action-control__field" key={name}>{name.replaceAll("_", " ")}{rule.enum ? <select required value={values[name] ?? ""} disabled={actionBusy} onChange={(event) => setFormState({ ...current, values: { ...values, [name]: event.target.value }, confirming: false })}><option value="">Choose an option</option>{rule.enum.map((option) => <option value={option} key={option}>{option}</option>)}</select> : <input required value={values[name] ?? ""} disabled={actionBusy} onChange={(event) => setFormState({ ...current, values: { ...values, [name]: event.target.value }, confirming: false })} />}</label>)}</div> : null}
      {current.confirming ? <p className="task-primary-action-control__confirmation" role="status">Confirm “{action.label}”? {action.reason}</p> : null}
      <div className="task-primary-action-control__actions">{current.confirming ? <Button type="button" onClick={() => setFormState({ ...current, confirming: false })} disabled={actionBusy}>Cancel</Button> : null}<Button type="submit" variant="primary" busy={actionBusy} disabled={!canRun}>{current.confirming ? "Confirm and run" : action.requiresConfirmation ? "Review and confirm" : action.label}</Button></div>
    </form> : null}
  </section>;
}
