import { Button, Icon } from "./ui/components.jsx";

const RESUMABLE_REQUEST_STATUSES = new Set(["created", "run-pending", "running"]);

function operatorRequestStateForTask(task, operatorRequests) {
  if (!task) return { requests: [], resumableRequest: null, visibleRequest: null };
  const taskEvidence = new Set([task.intent_submission_ref, ...(task.evidence_refs || [])].filter(Boolean));
  const requests = (Array.isArray(operatorRequests) ? operatorRequests : [])
    .filter((entry) => {
      const document = entry?.document || {};
      if (document.target_flow_id !== undefined && document.target_flow_id !== null) {
        return typeof document.target_flow_id === "string"
          && document.target_flow_id.length > 0
          && document.target_flow_id === task.flow_id;
      }
      return Array.isArray(document.target_refs) && document.target_refs.some((ref) => taskEvidence.has(ref));
    })
    .sort((left, right) => String(right?.document?.updated_at ?? right?.document?.created_at ?? "")
      .localeCompare(String(left?.document?.updated_at ?? left?.document?.created_at ?? "")));
  const resumableRequest = requests.find(isResumableOperatorRequest) ?? null;
  return {
    requests,
    resumableRequest,
    visibleRequest: resumableRequest ?? requests[0] ?? null,
  };
}

function isResumableOperatorRequest(entry) {
  return RESUMABLE_REQUEST_STATUSES.has(String(entry?.document?.status ?? ""));
}

export function resumableOperatorRequestForTask(task, operatorRequests) {
  return operatorRequestStateForTask(task, operatorRequests).resumableRequest;
}

export function hasUnfinishedOperatorRequestForTask(task, operatorRequests) {
  return resumableOperatorRequestForTask(task, operatorRequests) !== null;
}

export function AskAorPanel({ task, operatorRequests = [], operatorRequestsAvailable = true, operatorRequestText, setOperatorRequestText, onTaskAction, onResumeOperatorRequest, actionBusy = false }) {
  if (!task || task.completed_read_only === true) return null;
  const { resumableRequest, visibleRequest } = operatorRequestStateForTask(task, operatorRequests);
  const requestStatus = String(visibleRequest?.document?.status ?? "");
  const resumable = Boolean(resumableRequest);
  const requestListUnavailable = operatorRequestsAvailable !== true;
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
    {requestListUnavailable ? <p className="task-ask-status" role="alert">Saved requests could not be checked. Retry loading project data before sending or retrying a request.</p> : null}
    {visibleRequest ? <p className="task-ask-status" role="status">
      {resumable ? "Unfinished request" : "Latest request"} {statusLabel}
      {visibleRequest.document?.request_summary ? `: ${visibleRequest.document.request_summary}` : "."}
      {resumable ? " Resume it before sending another request." : ""}
    </p> : null}
    <textarea aria-label="Task guidance" rows="3" value={operatorRequestText} onChange={(event) => setOperatorRequestText(event.target.value)} placeholder="Add guidance for this task…" disabled={actionBusy || requestListUnavailable} />
    <div className="task-ask-actions">
      <Button variant="primary" onClick={submitRequest} busy={actionBusy} disabled={actionBusy || requestListUnavailable || resumable || !task.task_id || task.status === "draft"}>
        <Icon name="send" className="task-glyph task-glyph--send" />{actionBusy ? "Sending…" : "Send request"}
      </Button>
      {canRequestRetry ? <Button onClick={() => onTaskAction?.(task, "retry", { request_text: operatorRequestText.trim() || "Request a bounded retry for this Task after reviewing the recorded failure." })} disabled={actionBusy || requestListUnavailable || resumable} busy={actionBusy}>Request retry</Button> : null}
      {resumable ? <Button onClick={() => onResumeOperatorRequest?.(resumableRequest)} disabled={actionBusy} busy={actionBusy}>
        <Icon name="refresh" className="task-glyph task-glyph--refresh" />Resume request
      </Button> : null}
    </div>
  </section>;
}
