import { useEffect, useState } from "react";
import { Alert, Button, Card, Field, ResponsiveActions, StatusBadge } from "./ui/components.jsx";
import { readControlPlaneJson as readJson } from "./control-plane-client.js";

const EMPTY_SOURCE = { kind: "local", path: "", url: "", label: "" };
const lines = (value) => String(value ?? "").split(/\r?\n/u).map((item) => item.trim()).filter(Boolean);

export function IntentOnboarding({ projectId, project, busy, setBusy, onProjectConnected, onStarted, onConfirmed, onCancel, initialSubmission }) {
  const [connectedProjectId, setConnectedProjectId] = useState(projectId ?? null);
  const [source, setSource] = useState(EMPTY_SOURCE);
  const [requestText, setRequestText] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [submission, setSubmission] = useState(initialSubmission?.submission ?? null);
  const [normalization, setNormalization] = useState(initialSubmission?.normalization ?? null);
  const [savedNormalization, setSavedNormalization] = useState(initialSubmission?.normalization ?? null);
  const [serverRevision, setServerRevision] = useState(initialSubmission?.normalization?.revision ?? null);
  const [dirty, setDirty] = useState(false);
  const [editing, setEditing] = useState(false);
  const [answers, setAnswers] = useState({});
  const [error, setError] = useState("");
  const [polling, setPolling] = useState(false);
  const [startFailure, setStartFailure] = useState(false);

  useEffect(() => {
    if (projectId) setConnectedProjectId(projectId);
  }, [projectId]);

  useEffect(() => {
    if (!initialSubmission) return;
    setSubmission(initialSubmission.submission ?? null);
    setNormalization(initialSubmission.normalization ?? null);
    setSavedNormalization(initialSubmission.normalization ?? null);
    setServerRevision(initialSubmission.normalization?.revision ?? null);
    setDirty(false);
    setEditing(false);
  }, [initialSubmission]);

  function submissionBase(selectedProjectId = connectedProjectId) {
    return `/api/projects/${encodeURIComponent(selectedProjectId)}/intent-submissions`;
  }

  async function poll(statusRef) {
    setPolling(true);
    try {
      for (let attempt = 0; attempt < 240; attempt += 1) {
        const state = await readJson(statusRef);
        setSubmission(state.submission);
        setNormalization(state.normalization);
        setSavedNormalization(state.normalization);
        setServerRevision(state.normalization?.revision ?? null);
        setDirty(false);
        if (!["submitted", "preparing"].includes(state.submission?.status)) return state;
        await new Promise((resolve) => window.setTimeout(resolve, 250));
      }
      throw new Error("Task preparation is still running. You can retry from this saved submission.");
    } finally { setPolling(false); }
  }

  async function connectCode() {
    const value = source.kind === "git" ? source.url.trim() : source.path.trim();
    if (!value) throw new Error("Choose a local Git folder or enter a Git URL.");
    const accepted = await readJson("/api/projects/actions", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        action: "connect",
        source: source.kind === "git" ? { kind: "git", url: value } : { kind: "local", path: value },
        ...(source.label.trim() ? { label: source.label.trim() } : {}),
      }),
    });
    let job = accepted.job;
    for (let attempt = 0; attempt < 240 && ["queued", "running"].includes(job?.status); attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 250));
      job = await readJson(accepted.status_ref);
    }
    if (job?.status !== "succeeded") throw new Error(job?.error || "Project connection did not complete.");
    setConnectedProjectId(job.project_id);
    await onProjectConnected?.(job.project_id);
    return job.project_id;
  }

  async function pickFolder() {
    setError("");
    try {
      const result = await readJson("/api/workspace/folder-picker/actions", {
        method: "POST", headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify({ action: "open" }),
      });
      if (result.path) setSource((current) => ({ ...current, kind: "local", path: result.path }));
      else setError(result.recovery || "Native folder picker is unavailable; enter an absolute path manually.");
    } catch (pickerError) { setError(pickerError instanceof Error ? pickerError.message : String(pickerError)); }
  }

  async function prepare() {
    setBusy(true); setError(""); setStartFailure(false);
    try {
      const selectedProjectId = connectedProjectId || await connectCode();
      const created = await readJson(submissionBase(selectedProjectId), {
        method: "POST", headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({ request_text: requestText, attachments }),
      });
      setSubmission(created.submission);
      await poll(created.status_ref);
    } catch (prepareError) { setError(prepareError instanceof Error ? prepareError.message : String(prepareError)); }
    finally { setBusy(false); }
  }

  async function action(actionName, body = {}) {
    setBusy(true); setError("");
    try {
      const base = submissionBase();
      const result = await readJson(`${base}/${encodeURIComponent(submission.submission_id)}/actions`, {
        method: "POST", headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify({ action: actionName, ...body }),
      });
      if (actionName === "confirm-and-start" || actionName === "retry-start") {
        if (result.retryable_start === true) {
          setStartFailure(true);
          setSubmission((current) => ({ ...current, status: "confirmed", confirmation: result }));
          return;
        }
        await onStarted(result);
        return;
      }
      if (actionName === "confirm") {
        setSubmission((current) => ({ ...current, status: "confirmed", confirmation: result }));
        await onConfirmed?.(result);
        return;
      }
      if (result.submission) setSubmission(result.submission);
      if (result.report) {
        setNormalization(result.report);
        setSavedNormalization(result.report);
        setServerRevision(result.report.revision ?? null);
        setDirty(false);
        if (actionName === "revise") setEditing(false);
      }
      if (actionName === "retry") await poll(`${base}/${encodeURIComponent(submission.submission_id)}`);
      if (actionName === "cancel") await onCancel?.();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
      if (actionError?.code === "intent_submission.stale_revision" && submission?.submission_id) {
        try {
          const refreshed = await readJson(`${submissionBase()}/${encodeURIComponent(submission.submission_id)}`);
          setSubmission(refreshed.submission);
          setNormalization(refreshed.normalization);
          setSavedNormalization(refreshed.normalization);
          setServerRevision(refreshed.normalization?.revision ?? null);
          setDirty(false);
          setEditing(false);
        } catch { /* keep the durable stale-revision error visible */ }
      }
    }
    finally { setBusy(false); }
  }

  function updateNormalization(next) {
    if (!editing) return;
    setNormalization(next);
    setDirty(true);
  }

  async function chooseFiles(event) {
    const files = [...event.target.files].slice(0, 10);
    const records = await Promise.all(files.map(async (file) => ({ name: file.name, content: await file.text() })));
    setAttachments(records);
  }

  const ready = normalization?.status === "prepared" && submission?.status === "prepared" && !dirty && !editing;
  const sourceValue = source.kind === "git" ? source.url : source.path;
  const pathSteps = normalization?.planned_path?.steps ?? [];
  const statusTone = ready ? "success" : submission?.status === "blocked" ? "danger" : dirty || editing ? "warning" : "neutral";
  return <section className="mission-builder aor-ui" aria-label="Intent-first task onboarding" data-server-revision={serverRevision ?? undefined}>
    <header><div><p className="mission-eyebrow">Intent-first onboarding</p><h1>What should AOR do?</h1><p>Connect code, describe the outcome, and prepare a read-only task preview.</p></div><StatusBadge tone={statusTone}>{submission?.status || "draft"}</StatusBadge></header>
    {error ? <Alert tone="danger">{error}</Alert> : null}
    {!submission ? <>
      {!connectedProjectId ? <Card><h2>Code source</h2><Field label="Source"><select name="intent-source-kind" value={source.kind} onChange={(event) => setSource({ ...source, kind: event.target.value })}><option value="local">Local Git folder</option><option value="git">Git URL</option></select></Field>{source.kind === "git" ? <Field label="HTTPS or SSH Git URL"><input name="intent-source-url" value={source.url} onChange={(event) => setSource({ ...source, url: event.target.value })} placeholder="git@github.com:org/repository.git" /></Field> : <><Field label="Absolute folder path"><input name="intent-source-path" value={source.path} onChange={(event) => setSource({ ...source, path: event.target.value })} placeholder="/path/to/repository" /></Field><Button onClick={pickFolder} disabled={busy}>Choose folder…</Button></>}<Field label="Project label" helper="Optional"><input name="intent-project-label" value={source.label} onChange={(event) => setSource({ ...source, label: event.target.value })} /></Field><p>Credentials in URLs are rejected. Git credential helpers and your SSH agent remain authoritative.</p></Card> : <Card><h2>Code source</h2><p><strong>{project?.display_name || connectedProjectId}</strong> is connected. Source details and inferred topology are available in Project settings.</p></Card>}
      <Card><h2>Intent</h2><Field label="Request" helper="Text, files, or both are required."><textarea name="intent-request" value={requestText} onChange={(event) => setRequestText(event.target.value)} placeholder="Review the authorization flow and fix the timeout handling…" /></Field><Field label="Text attachments" helper=".txt, .md, .json, .yaml, .yml · up to 10 files"><input name="intent-attachments" type="file" multiple accept=".txt,.md,.json,.yaml,.yml" onChange={chooseFiles} /></Field>{attachments.length ? <p>{attachments.map((item) => item.name).join(", ")}</p> : null}<ResponsiveActions><Button variant="primary" busy={busy || polling} onClick={prepare} disabled={(!connectedProjectId && !sourceValue.trim()) || (!requestText.trim() && attachments.length === 0)}>Prepare task</Button>{onCancel ? <Button onClick={onCancel}>Cancel</Button> : null}</ResponsiveActions></Card>
    </> : null}
    {submission && normalization ? <>
      <Card className="intent-review-card">
        <div className="intent-review-heading">
          <div><p className="mission-eyebrow">Prepared task · revision {serverRevision ?? "—"}</p><h2>Review before creating a Flow</h2><p>Preparation is read-only. Edit only when the proposed contract needs correction.</p></div>
          {!editing ? <Button size="compact" onClick={() => setEditing(true)}>Edit task</Button> : <Button size="compact" onClick={() => { setEditing(false); setDirty(false); setNormalization(savedNormalization ?? normalization); }}>Cancel edit</Button>}
        </div>
        <div className="intent-review-summary">
          <Field label="Task title"><input name="normalization-title" readOnly={!editing} value={normalization.title || ""} onChange={(event) => updateNormalization({ ...normalization, title: event.target.value })} /></Field>
          <Field label="Outcome"><textarea name="normalization-outcome" readOnly={!editing} value={normalization.outcome || ""} onChange={(event) => updateNormalization({ ...normalization, outcome: event.target.value })} /></Field>
          <div className="mission-preview"><div><span>Code</span><strong>{project?.display_name || connectedProjectId}</strong></div><div><span>Safety</span><strong>{normalization.delivery_mode}</strong></div><div><span>Provider</span><strong>{normalization.provider?.adapter_id || "unavailable"}</strong></div><div><span>Confidence</span><strong>{Number.isFinite(normalization.confidence) ? `${Math.round(normalization.confidence * 100)}%` : "Unknown"}</strong></div></div>
          <Field label="Work type"><select name="normalization-work-type" disabled={!editing} value={normalization.work_type || "analyze"} onChange={(event) => updateNormalization({ ...normalization, work_type: event.target.value })}><option value="analyze">Analyze</option><option value="explain">Explain</option><option value="review">Review</option><option value="document-change">Document change</option><option value="code-change">Code change</option></select></Field>
          <div className="intent-planned-path"><span>Planned path</span><strong>{pathSteps.length ? pathSteps.map((step) => step.label).join(" → ") : "Runtime will derive the path"}</strong>{pathSteps.some((step) => step.reason) ? <small>{pathSteps.filter((step) => step.reason).map((step) => `${step.label}: ${step.reason}`).join(" · ")}</small> : null}</div>
          <Field label="Constraints" helper="One per line."><textarea name="normalization-constraints" readOnly={!editing} value={(normalization.constraints || []).join("\n")} onChange={(event) => updateNormalization({ ...normalization, constraints: lines(event.target.value) })} /></Field>
          <Field label="Acceptance" helper="One check per line."><textarea name="normalization-acceptance" readOnly={!editing} value={(normalization.acceptance || []).join("\n")} onChange={(event) => updateNormalization({ ...normalization, acceptance: lines(event.target.value) })} /></Field>
          <Field label="Expected scope"><textarea name="normalization-scope" readOnly={!editing} value={(normalization.scope || []).join("\n")} onChange={(event) => updateNormalization({ ...normalization, scope: lines(event.target.value) })} /></Field>
          {normalization.assumptions?.length ? <div className="intent-review-list"><strong>Assumptions</strong><ul>{normalization.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}</ul></div> : null}
          {normalization.open_questions?.length ? <div><Alert tone="warning">Answer the blocking questions before confirmation.</Alert>{normalization.open_questions.map((question, index) => <Field key={question} label={question}><input name={`normalization-question-${index + 1}`} value={answers[question] || ""} onChange={(event) => setAnswers({ ...answers, [question]: event.target.value })} /></Field>)}<Button onClick={() => action("answer", { answers })} disabled={busy || normalization.open_questions.some((question) => !answers[question]?.trim())}>Save answers</Button></div> : null}
          {dirty ? <Alert tone="warning">Unsaved changes are not confirmable. Save this revision before creating the Flow.</Alert> : null}
          {startFailure ? <Alert tone="danger">The Flow was created, but its first action did not start. Retry uses the same Flow.</Alert> : null}
        </div>
      </Card>
      <ResponsiveActions>
        <Button onClick={() => action("revise", { normalization })} disabled={busy || !dirty || !editing}>Save revision</Button>
        <Button variant="primary" onClick={() => action("confirm", { expected_revision: serverRevision })} disabled={busy || !ready || startFailure}>Confirm and create Flow</Button>
        {startFailure ? <Button variant="primary" onClick={() => action("retry-start")} disabled={busy}>Retry start</Button> : null}
        <Button onClick={() => action("retry")} disabled={busy || submission.status === "confirmed"}>Retry preparation</Button>
        <Button variant="destructive" onClick={() => action("cancel")} disabled={busy || submission.status === "confirmed"}>Cancel task</Button>
      </ResponsiveActions>
    </> : null}
    {submission && !normalization ? <Card><p>{polling ? "Preparing a read-only task preview…" : submission.blocker?.message || "Preparation is blocked."}</p><ResponsiveActions><Button onClick={() => action("retry")} disabled={busy || polling}>Retry preparation</Button><Button onClick={() => action("cancel")} disabled={busy || polling}>Cancel task</Button></ResponsiveActions></Card> : null}
  </section>;
}
