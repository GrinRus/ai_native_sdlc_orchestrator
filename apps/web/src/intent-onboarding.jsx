import React, { useEffect, useState } from "react";
import { Alert, Button, Card, Field, ResponsiveActions, StatusBadge } from "./ui/components.jsx";

async function readJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.detail || payload?.error?.message || `Request failed (${response.status}).`);
  return payload;
}

const EMPTY_SOURCE = { kind: "local", path: "", url: "", label: "" };
const lines = (value) => String(value ?? "").split(/\r?\n/u).map((item) => item.trim()).filter(Boolean);

export function IntentOnboarding({ projectId, project, busy, setBusy, onProjectConnected, onStarted, onCancel }) {
  const [connectedProjectId, setConnectedProjectId] = useState(projectId ?? null);
  const [source, setSource] = useState(EMPTY_SOURCE);
  const [requestText, setRequestText] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [submission, setSubmission] = useState(null);
  const [normalization, setNormalization] = useState(null);
  const [answers, setAnswers] = useState({});
  const [error, setError] = useState("");
  const [polling, setPolling] = useState(false);
  const [startFailure, setStartFailure] = useState(false);

  useEffect(() => {
    if (projectId) setConnectedProjectId(projectId);
  }, [projectId]);

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
      if (result.submission) setSubmission(result.submission);
      if (result.report) setNormalization(result.report);
      if (actionName === "retry") await poll(`${base}/${encodeURIComponent(submission.submission_id)}`);
      if (actionName === "cancel") await onCancel?.();
    } catch (actionError) { setError(actionError instanceof Error ? actionError.message : String(actionError)); }
    finally { setBusy(false); }
  }

  async function chooseFiles(event) {
    const files = [...event.target.files].slice(0, 10);
    const records = await Promise.all(files.map(async (file) => ({ name: file.name, content: await file.text() })));
    setAttachments(records);
  }

  const ready = normalization?.status === "prepared" && submission?.status === "prepared";
  const sourceValue = source.kind === "git" ? source.url : source.path;
  return <section className="mission-builder aor-ui" aria-label="Intent-first task onboarding">
    <header><div><p className="mission-eyebrow">Intent-first onboarding</p><h1>What should AOR do?</h1><p>Connect code, describe the outcome, and prepare a read-only task preview.</p></div><StatusBadge tone={ready ? "success" : submission?.status === "blocked" ? "danger" : "warning"}>{submission?.status || "draft"}</StatusBadge></header>
    {error ? <Alert tone="danger">{error}</Alert> : null}
    {!submission ? <>
      {!connectedProjectId ? <Card><h2>Code source</h2><Field label="Source"><select value={source.kind} onChange={(event) => setSource({ ...source, kind: event.target.value })}><option value="local">Local Git folder</option><option value="git">Git URL</option></select></Field>{source.kind === "git" ? <Field label="HTTPS or SSH Git URL"><input value={source.url} onChange={(event) => setSource({ ...source, url: event.target.value })} placeholder="git@github.com:org/repository.git" /></Field> : <><Field label="Absolute folder path"><input value={source.path} onChange={(event) => setSource({ ...source, path: event.target.value })} placeholder="/path/to/repository" /></Field><Button onClick={pickFolder} disabled={busy}>Choose folder…</Button></>}<Field label="Project label" helper="Optional"><input value={source.label} onChange={(event) => setSource({ ...source, label: event.target.value })} /></Field><p>Credentials in URLs are rejected. Git credential helpers and your SSH agent remain authoritative.</p></Card> : <Card><h2>Code source</h2><p><strong>{project?.display_name || connectedProjectId}</strong> is connected. Source details and inferred topology are available in Project settings.</p></Card>}
      <Card><h2>Intent</h2><Field label="Request" helper="Text, files, or both are required."><textarea value={requestText} onChange={(event) => setRequestText(event.target.value)} placeholder="Review the authorization flow and fix the timeout handling…" /></Field><Field label="Text attachments" helper=".txt, .md, .json, .yaml, .yml · up to 10 files"><input type="file" multiple accept=".txt,.md,.json,.yaml,.yml" onChange={chooseFiles} /></Field>{attachments.length ? <p>{attachments.map((item) => item.name).join(", ")}</p> : null}<ResponsiveActions><Button variant="primary" busy={busy || polling} onClick={prepare} disabled={(!connectedProjectId && !sourceValue.trim()) || (!requestText.trim() && attachments.length === 0)}>Prepare task</Button>{onCancel ? <Button onClick={onCancel}>Cancel</Button> : null}</ResponsiveActions></Card>
    </> : null}
    {submission && normalization ? <><Card><Field label="Task title"><input value={normalization.title || ""} onChange={(event) => setNormalization({ ...normalization, title: event.target.value })} /></Field><Field label="Outcome"><textarea value={normalization.outcome || ""} onChange={(event) => setNormalization({ ...normalization, outcome: event.target.value })} /></Field><div className="mission-preview"><div><span>Code</span><strong>{project?.display_name || connectedProjectId}</strong></div><div><span>Safety</span><strong>{normalization.delivery_mode}</strong></div><div><span>Provider</span><strong>{normalization.provider?.adapter_id || "unavailable"}</strong></div></div><Field label="Work type"><select value={normalization.work_type || "analyze"} onChange={(event) => setNormalization({ ...normalization, work_type: event.target.value })}><option value="analyze">Analyze</option><option value="explain">Explain</option><option value="review">Review</option><option value="document-change">Document change</option><option value="code-change">Code change</option></select></Field><Field label="Constraints" helper="One per line."><textarea value={(normalization.constraints || []).join("\n")} onChange={(event) => setNormalization({ ...normalization, constraints: lines(event.target.value) })} /></Field><Field label="Acceptance" helper="One check per line."><textarea value={(normalization.acceptance || []).join("\n")} onChange={(event) => setNormalization({ ...normalization, acceptance: lines(event.target.value) })} /></Field><Field label="Expected scope"><textarea value={(normalization.scope || []).join("\n")} onChange={(event) => setNormalization({ ...normalization, scope: lines(event.target.value) })} /></Field>{normalization.open_questions?.length ? <div><Alert tone="warning">Answer the blocking questions before confirmation.</Alert>{normalization.open_questions.map((question) => <Field key={question} label={question}><input value={answers[question] || ""} onChange={(event) => setAnswers({ ...answers, [question]: event.target.value })} /></Field>)}<Button onClick={() => action("answer", { answers })} disabled={busy || normalization.open_questions.some((question) => !answers[question]?.trim())}>Save answers</Button></div> : null}{startFailure ? <Alert tone="danger">The Flow was created, but its first action did not start. Retry uses the same Flow.</Alert> : null}</Card><ResponsiveActions><Button onClick={() => action("revise", { normalization })} disabled={busy}>Save revision</Button><Button variant="primary" onClick={() => action("confirm-and-start")} disabled={busy || !ready || startFailure}>Confirm and start</Button>{startFailure ? <Button variant="primary" onClick={() => action("retry-start")} disabled={busy}>Retry start</Button> : null}<Button onClick={() => action("retry")} disabled={busy || submission.status === "confirmed"}>Retry preparation</Button><Button onClick={() => action("cancel")} disabled={busy || submission.status === "confirmed"}>Cancel task</Button></ResponsiveActions></> : null}
    {submission && !normalization ? <Card><p>{polling ? "Preparing a read-only task preview…" : submission.blocker?.message || "Preparation is blocked."}</p><ResponsiveActions><Button onClick={() => action("retry")} disabled={busy || polling}>Retry preparation</Button><Button onClick={() => action("cancel")} disabled={busy || polling}>Cancel task</Button></ResponsiveActions></Card> : null}
  </section>;
}
