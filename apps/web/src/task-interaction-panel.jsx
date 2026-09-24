import { useState } from "react";
import { Button } from "./ui/components.jsx";

const DECISIONS = Object.freeze({ approve_once: "Approve once", deny: "Deny", approve_for_run: "Approve for this run" });

function InteractionCard({ interaction, onSubmit, busy }) {
  const [answer, setAnswer] = useState("");
  const [reason, setReason] = useState("");
  const [decision, setDecision] = useState("");
  const [error, setError] = useState("");
  const permission = interaction?.interaction_type === "permission_request";
  const summary = interaction?.question_summary || "The runner is waiting for an operator response.";
  const request = interaction?.permission_request ?? {};
  const capabilities = Array.isArray(request.capabilities) ? request.capabilities : [];
  const hasPermissionContext = Boolean(request.operation_type && request.resource_type && request.resource_label && capabilities.length);
  const allowedDecisions = (Array.isArray(request.allowed_decisions) ? request.allowed_decisions : [])
    .filter((value) => DECISIONS[value] && (value === "deny" || hasPermissionContext));
  const awaiting = interaction?.status === "requested" && interaction?.answer_required === true;

  async function submit(event) {
    event.preventDefault();
    setError("");
    try {
      await onSubmit?.(interaction, permission ? { decision, reason: reason.trim() } : { answer: answer.trim(), reason: reason.trim() });
      setAnswer("");
      setReason("");
      setDecision("");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
    }
  }

  if (!awaiting) {
    const message = interaction?.status === "resumed"
      ? "Answer recorded. The run resumed from this interaction."
      : interaction?.status === "blocked" || interaction?.status === "resume_failed"
        ? "Answer recorded, but the run remains blocked."
        : "Answer recorded. The run is processing the continuation.";
    return <section className="task-interaction-card" aria-label="Runner question status" role="status">
      <h3>Runner question</h3><p>{summary}</p><p>{message}</p>
      {interaction?.continuation?.reason_code ? <code>{interaction.continuation.reason_code}</code> : null}
    </section>;
  }

  return <section className="task-interaction-card" aria-label="Runner question">
    <h3>{permission ? "Runner permission request" : "Runner question"}</h3><p>{summary}</p>
    {permission ? <>
      <dl><div><dt>Operation</dt><dd>{request.operation_type || "Not supplied"}</dd></div><div><dt>Resource</dt><dd>{request.resource_label || request.resource_type || "Details unavailable"}</dd></div><div><dt>Capabilities</dt><dd>{capabilities.length ? capabilities.join(", ") : "Not supplied"}</dd></div></dl>
      <form onSubmit={submit}>
        <fieldset><legend>Decision</legend>{allowedDecisions.map((value) => <label key={value}><input type="radio" name={`interaction-${interaction.interaction_id}`} value={value} checked={decision === value} onChange={() => setDecision(value)} />{DECISIONS[value]}</label>)}</fieldset>
        {!allowedDecisions.length ? <p role="alert">Permission details are incomplete. A decision is unavailable; retry the read or answer from the CLI.</p> : null}
        <label>Reason <textarea rows="2" value={reason} onChange={(event) => setReason(event.target.value)} /></label>
        {error ? <p role="alert">{error}</p> : null}
        <Button type="submit" variant="primary" busy={busy} disabled={busy || !decision}>Submit decision</Button>
      </form>
    </> : <form onSubmit={submit}>
      <label>Answer <textarea rows="3" value={answer} onChange={(event) => setAnswer(event.target.value)} required /></label>
      <label>Reason <textarea rows="2" value={reason} onChange={(event) => setReason(event.target.value)} /></label>
      {error ? <p role="alert">{error}</p> : null}
      <Button type="submit" variant="primary" busy={busy} disabled={busy || !answer.trim()}>Submit answer</Button>
    </form>}
  </section>;
}

export function TaskInteractionPanel({ interactions = [], onSubmit, busy = false }) {
  if (!interactions.length) return null;
  return <div className="task-interactions" aria-label="Runner interactions">
    {interactions.map((interaction) => <InteractionCard key={`${interaction.run_id}-${interaction.interaction_id}`} interaction={interaction} onSubmit={onSubmit} busy={busy} />)}
  </div>;
}
