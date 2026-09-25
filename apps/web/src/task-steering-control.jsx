import { useRef, useState } from "react";

import { STEP_CLASS_VALUES } from "../../../packages/contracts/src/step-class-values.mjs";
import { Button } from "./ui/components.jsx";

function createTaskSteeringCommandId() {
  const randomId = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `task-steer-${randomId}`;
}

export function TaskSteeringControl({ task, onTaskAction, actionBusy }) {
  const [targetStep, setTargetStep] = useState("");
  const [reason, setReason] = useState("");
  const [approvalRef, setApprovalRef] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const commandIdRef = useRef(null);
  const runStatus = String(task?.run_state?.status ?? "");
  if (!["running", "paused"].includes(runStatus)) return null;

  function resetAttempt() {
    commandIdRef.current = null;
    setSuccessMessage("");
  }

  async function submitSteering(event) {
    event.preventDefault();
    if (!targetStep || actionBusy) return;
    const nextCommandId = commandIdRef.current ?? createTaskSteeringCommandId();
    commandIdRef.current = nextCommandId;
    setSuccessMessage("");
    const trimmedReason = reason.trim();
    const trimmedApprovalRef = approvalRef.trim();
    const result = await onTaskAction?.(task, "steer", {
      target_step: targetStep,
      command_id: nextCommandId,
      ...(trimmedReason ? { reason: trimmedReason } : {}),
      ...(trimmedApprovalRef ? { approval_ref: trimmedApprovalRef } : {}),
    });
    if (result) {
      setSuccessMessage(`Steering sent to ${targetStep}.`);
      setReason("");
      setApprovalRef("");
      commandIdRef.current = null;
    }
  }

  return <details className="task-ask-panel task-run-steering">
    <summary>Steer the active run</summary>
    <p>Choose a target step and send direction to this run. Project policy may require an approval reference.</p>
    <form className="task-run-steering__form" onSubmit={(event) => void submitSteering(event)}>
      <label htmlFor="task-steering-target-step">Target step class
        <select id="task-steering-target-step" value={targetStep} onChange={(event) => { setTargetStep(event.target.value); resetAttempt(); }} required>
          <option value="">Choose a step class</option>
          {STEP_CLASS_VALUES.map((stepClass) => <option value={stepClass} key={stepClass}>{stepClass}</option>)}
        </select>
      </label>
      <label htmlFor="task-steering-reason">Direction (optional)
        <textarea id="task-steering-reason" rows="3" value={reason} onChange={(event) => { setReason(event.target.value); resetAttempt(); }} placeholder="What should the run focus on?" />
      </label>
      <label htmlFor="task-steering-approval-ref">Approval reference (if required by project policy)
        <input id="task-steering-approval-ref" value={approvalRef} onChange={(event) => { setApprovalRef(event.target.value); resetAttempt(); }} placeholder="evidence://…" />
      </label>
      <div className="task-run-steering__actions">
        <Button type="submit" variant="primary" busy={actionBusy} disabled={actionBusy || !targetStep}>Send steering</Button>
      </div>
    </form>
    {successMessage ? <p className="task-ask-status" role="status">{successMessage}</p> : null}
  </details>;
}
