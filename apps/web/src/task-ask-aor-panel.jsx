import { Button, Icon } from "./ui/components.jsx";

const RESUMABLE_REQUEST_STATUSES = new Set(["created", "run-pending", "running"]);

function operatorRequestsForTask(task, operatorRequests) {
  if (!task) return [];
  const taskEvidence = new Set([task.intent_submission_ref, ...(task.evidence_refs || [])].filter(Boolean));
  return (Array.isArray(operatorRequests) ? operatorRequests : [])
    .filter((entry) => {
      const document = entry?.document || {};
      if (task.flow_id && document.target_flow_id === task.flow_id) return true;
      return Array.isArray(document.target_refs) && document.target_refs.some((ref) => taskEvidence.has(ref));
    })
    .sort((left, right) => String(right?.document?.updated_at ?? right?.document?.created_at ?? "")
      .localeCompare(String(left?.document?.updated_at ?? left?.document?.created_at ?? "")));
}

function isResumableOperatorRequest(entry) {
  return RESUMABLE_REQUEST_STATUSES.has(String(entry?.document?.status ?? ""));
}

export function resumableOperatorRequestForTask(task, operatorRequests) {
  return operatorRequestsForTask(task, operatorRequests).find(isResumableOperatorRequest) ?? null;
}

export function hasUnfinishedOperatorRequestForTask(task, operatorRequests) {
  return resumableOperatorRequestForTask(task, operatorRequests) !== null;
}

export function AskAorPanel({ task, operatorRequests = [], operatorRequestText, setOperatorRequestText, onTaskAction, onResumeOperatorRequest, actionBusy = false }) {
  if (!task || task.completed_read_only === true) return null;
  const requests = operatorRequestsForTask(task, operatorRequests);
  const resumableRequest = resumableOperatorRequestForTask(task, operatorRequests);
  const visibleRequest = resumableRequest ?? requests[0] ?? null;
  const requestStatus = String(visibleRequest?.document?.status ?? "");
  const resumable = Boolean(resumableRequest);
  const canRequestRetry = ["failed", "attention", "repairing"].includes(String(task.status ?? ""));
  const statusLabel = {
    created: "saved and waiting to run",
    "run-pending": "waiting to resume",
    running: "running",
    completed: "completed",
    failed: "failed",
    blocked: "blocked",
  }[requestStatus] || "recorded";
  const submitRequest = () => onTaskAction?.(task, "request", {
    request_text: operatorRequestText.trim() || "Inspect the recorded Task blocker.",
  });
  return <section className="task-ask-panel">
    <h3>Ask AOR</h3>
    <p>Runs a bounded request through the project runtime and keeps its result available for recovery.</p>
    {visibleRequest ? <p className="task-ask-status" role="status">
      {resumable ? "Unfinished request" : "Latest request"} {statusLabel}
      {visibleRequest.document?.request_summary ? `: ${visibleRequest.document.request_summary}` : "."}
      {resumable ? " Resume it before sending another request." : ""}
    </p> : null}
    <textarea aria-label="Task guidance" rows="3" value={operatorRequestText} onChange={(event) => setOperatorRequestText(event.target.value)} placeholder="Add guidance for this task…" disabled={actionBusy} />
    <div className="task-ask-actions">
      <Button variant="primary" onClick={submitRequest} busy={actionBusy} disabled={actionBusy || resumable || !task.task_id || task.status === "draft"}>
        <Icon name="send" className="task-glyph task-glyph--send" />{actionBusy ? "Sending…" : "Send request"}
      </Button>
      {canRequestRetry ? <Button onClick={() => onTaskAction?.(task, "retry", { request_text: operatorRequestText.trim() || "Request a bounded retry for this Task after reviewing the recorded failure." })} disabled={actionBusy || resumable} busy={actionBusy}>Request retry</Button> : null}
      {resumable ? <Button onClick={() => onResumeOperatorRequest?.(resumableRequest)} disabled={actionBusy} busy={actionBusy}>
        <Icon name="refresh" className="task-glyph task-glyph--refresh" />Resume request
      </Button> : null}
    </div>
  </section>;
}
