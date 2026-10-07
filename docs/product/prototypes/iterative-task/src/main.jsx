import { useEffect, useRef, useState } from "react";
import { Badge, Button, Callout, Dialog, Icon, autoOutcome, criteria, manualOutcome, originalRequest, seed } from "./shared.jsx";
import { Prepared } from "./prepared.jsx";
import { Decision } from "./decision.jsx";
import { Review } from "./review.jsx";

const screenNames = { prepared: "Prepared Task", decision: "Decision", review: "Review" };

export default function App() {
  const initialScreen = Object.hasOwn(screenNames, location.hash.slice(1)) ? location.hash.slice(1) : "prepared";
  const [state, setState] = useState(() => seed(initialScreen));
  const [dialog, setDialog] = useState(null);
  const [draft, setDraft] = useState("");
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    const loadHashPreview = () => {
      const screen = location.hash.slice(1);
      if (!Object.hasOwn(screenNames, screen)) return;
      clearTimeout(timer.current);
      setBusy(false); setDialog(null); setState(seed(screen));
      setAnnouncement(`${screenNames[screen]} fixture loaded. Scenario reset.`);
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", loadHashPreview);
    return () => window.removeEventListener("hashchange", loadHashPreview);
  }, []);
  const patch = (next) => setState((current) => ({ ...current, ...next }));
  const navigate = (screen) => {
    patch({ screen });
    history.replaceState(null, "", `#${screen}`);
    setAnnouncement(`${screenNames[screen]} opened.`);
    requestAnimationFrame(() => document.getElementById("task-title")?.focus());
    window.scrollTo(0, 0);
  };
  const preview = (screen) => {
    clearTimeout(timer.current);
    setBusy(false);
    setState(seed(screen));
    setDialog(null);
    history.replaceState(null, "", `#${screen}`);
    setAnnouncement(`${screenNames[screen]} fixture loaded. Scenario reset.`);
    window.scrollTo(0, 0);
  };
  const open = (value) => { setAck(false); setDraft(value === "edit" ? state.candidate : ""); setDialog(typeof value === "string" ? { type: value } : value); };
  const close = () => setDialog(null);
  const adopt = () => {
    if (state.condition !== "normal" || (state.selected === "auto" && !state.decisionAcknowledged)) return;
    patch({ adopted: true, dirty: false, rejected: false, revision: state.revision + 1, policy: state.selected, candidate: state.selected === "manual" ? manualOutcome : autoOutcome, budget: state.selected === "auto" ? 30 : 20 });
    navigate("prepared");
    setAnnouncement(`Decision DEC-07 adopted. Revision ${state.revision + 1} returned. Work has not started.`);
  };
  const replay = () => {
    if (state.condition !== "normal" || busy || state.completed) return;
    setBusy(true);
    setAnnouncement("Replaying the fixture observation for the current revision.");
    timer.current = setTimeout(() => {
      patch({ proof: "current" }); setBusy(false);
      setAnnouncement("Current proof attached. All 3 criteria are verified in the fixture.");
      requestAnimationFrame(() => document.querySelector('[data-criterion="C03"] .text-button')?.focus());
    }, 500);
  };
  const condition = (value) => {
    clearTimeout(timer.current);
    setBusy(false);
    if (value === "stale" || value === "missing" || value === "current") patch({ proof: value, condition: "normal", completed: false });
    else patch({ condition: value, completed: false });
    setAnnouncement(`Fixture state changed to ${value}.`);
  };
  const start = () => {
    if (!ack || !state.adopted || state.dirty || state.rejected || state.condition !== "normal") return;
    patch({ started: true, proof: "missing", tab: "overview" });
    close(); navigate("review");
    setAnnouncement(`Fixture Start accepted for revision ${state.revision}. Review has one missing observation.`);
  };
  const approve = () => {
    if (!ack || state.proof !== "current" || state.condition !== "normal") return;
    patch({ completed: true, tab: "overview" }); close(); setAnnouncement("Fixture acceptance ACC-184 recorded. The revision is frozen.");
  };
  return <div className="aor-ui prototype-app">
    <a className="skip-link" href="#task-title">Skip to task</a>
    <aside className="nav-rail"><a href="#prepared" className="brand" onClick={(event) => { event.preventDefault(); preview("prepared"); }}>AOR</a><button className="project-switch" aria-label="Project Atlas" onClick={() => open("project")}><Icon name="layers" /><span>Project Atlas</span><Icon name="chevronDown" /></button><nav aria-label="Workspace"><button aria-label="Tasks" className={state.screen !== "decision" ? "nav-active" : ""} onClick={() => preview("prepared")}><Icon name="tasks" /><span>Tasks</span></button><button aria-label="Attention" className={state.screen === "decision" ? "nav-active" : ""} onClick={() => preview("decision")}><Icon name="attention" /><span>Attention</span>{!state.adopted && <span className="nav-count">1</span>}</button><button aria-label="Evidence" onClick={() => { preview("review"); patch({ tab: "evidence" }); }}><Icon name="evidence" /><span>Evidence</span></button><button aria-label="Project" onClick={() => open("project")}><Icon name="layers" /><span>Project</span></button></nav><div className="rail-bottom"><Icon name="lock" /><div><strong>Local workspace</strong><span>Explicit decisions. Bounded work.</span></div></div></aside>
    <main className="main-shell">
      <header className="workspace-header"><div className="breadcrumb"><Icon name="tasks" /><span>Tasks</span><span className="muted">/</span><span>TASK-184</span></div><div className="header-context"><Badge tone={state.condition === "offline" ? "warning" : "neutral"} icon="signal">{state.condition === "offline" ? "Offline fixture" : "Local fixture"}</Badge><span>Project Atlas</span></div></header>
      <section className="prototype-controls" aria-label="Prototype controls"><div className="prototype-label"><Badge tone="info">W72 prototype</Badge><span>Synthetic data · no runtime actions</span></div><nav className="screen-previews" aria-label="Screen previews">{Object.entries(screenNames).map(([id, label]) => <button key={id} aria-current={state.screen === id ? "page" : undefined} onClick={() => preview(id)}>{label}</button>)}</nav><button className="text-button reset-button" onClick={() => preview("prepared")}><Icon name="refresh" />Reset demo</button></section>
      {state.screen === "review" && <div className="scenario-controls"><label htmlFor="fixture-state">Fixture state</label><select id="fixture-state" value={state.condition !== "normal" ? state.condition : state.proof} onChange={(event) => condition(event.target.value)} disabled={busy}><option value="missing">Missing behavioral proof</option><option value="current">All proof current</option><option value="stale">Proof from older revision</option><option value="budget">Execution cap reached</option><option value="offline">Offline · cached result</option></select><span>Preview state only</span></div>}
      <div className="task-content">
        {state.condition === "offline" && <Callout tone="info" title="Offline · showing cached fixture data" action={<Button size="compact" onClick={() => { patch({ condition: "normal" }); setAnnouncement("Connection restored. Fixture actions available."); }}>Reconnect <Icon name="refresh" /></Button>}>Existing runtime work would continue independently. Review actions are unavailable until connection and revision are confirmed.</Callout>}
        {state.condition === "budget" && <Callout title="Execution cap reached · work is paused" action={<Button size="compact" onClick={() => open("budget")}>Review budget extension <Icon name="chevronRight" /></Button>}>No further checks can run under the current {state.budget}-minute cap. A bounded extension needs an explicit new approval.</Callout>}
        {state.screen === "prepared" ? <Prepared {...{ state, patch, navigate, open }} /> : state.screen === "decision" ? <Decision {...{ state, patch, adopt, navigate, open }} /> : <Review {...{ state, patch, open, replay, busy }} />}
      </div>
      <footer className="prototype-footer">Design fixture · screen previews reset the scenario · actions within a screen retain the journey</footer>
    </main>
    <div className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</div>
    {dialog && <Dialog key={dialog.type} title={dialogTitle(dialog.type)} onClose={close} wide={dialog.type === "proof"}>
      {dialog.type === "edit" && <><p>Update the proposed outcome. Your original request and its requirements are retained for reconciliation.</p><label className="field-label" htmlFor="outcome-draft">Proposed outcome</label><textarea id="outcome-draft" rows={5} value={draft} onChange={(event) => setDraft(event.target.value)} /><Callout tone="info" title="Start will stay blocked">Saving an edit does not adopt a revision or change the original negative requirement.</Callout><div className="dialog-actions"><Button onClick={close}>Cancel</Button><Button variant="primary" disabled={!draft.trim()} onClick={() => { patch({ candidate: draft.trim(), dirty: true, adopted: false }); close(); setAnnouncement("Draft saved. Reconciliation required before Start."); }}>Save draft</Button></div></>}
      {dialog.type === "start" && <><p>Authorize <strong>revision {state.revision}</strong> of “Fix timeout recovery”.</p><div className="confirmation-outcome">{state.candidate}</div><dl className="facts"><div><dt>Scope</dt><dd><code>src/auth/</code> · <code>tests/auth/</code></dd></div><div><dt>Commands</dt><dd><code>pnpm test:auth</code><br /><code>pnpm lint:auth</code></dd></div><div><dt>Execution cap</dt><dd>{state.budget} minutes · 2 attempts</dd></div><div><dt>Write mode</dt><dd>Isolated local workspace</dd></div><div><dt>Approval identity</dt><dd><code>start-r{state.revision}-fixture</code></dd></div></dl><label className="acknowledgement"><input type="checkbox" checked={ack} onChange={(event) => setAck(event.target.checked)} /><span>I authorize this revision and these bounds. A new behavior or permission requires another decision.</span></label><p className="fixture-disclaimer">This prototype simulates Start; it runs no commands.</p><div className="dialog-actions"><Button onClick={close}>Keep reviewing</Button><Button variant="primary" disabled={!ack} onClick={start}>Authorize fixture Start</Button></div></>}
      {dialog.type === "approve" && <><p>All 3 criteria have current fixture evidence for <strong>revision {state.revision}</strong>, attempt 1, head <code>fixture-8c41</code>.</p><Callout tone="info" title="Local acceptance only">Record the reviewed result. Integration, upstream writes, and deployment need separate authority.</Callout><label className="acknowledgement"><input type="checkbox" checked={ack} onChange={(event) => setAck(event.target.checked)} /><span>I reviewed the required behavior and its evidence for this revision.</span></label><div className="dialog-actions"><Button onClick={close}>Back to review</Button><Button variant="primary" disabled={!ack} onClick={approve}>Record fixture acceptance</Button></div></>}
      {dialog.type === "proof" && <ProofDetails state={state} index={dialog.criterion} />}
      {dialog.type === "sources" && <><p className="eyebrow">request-184 · operator source</p><blockquote className="source-quote">{originalRequest}</blockquote><p className="eyebrow">proposal-03 · AI candidate</p><p>Show timeout feedback and retry the request once automatically.</p><div className="source-binding"><Icon name="shield" /><span>The original request requires C03. A proposal cannot remove it; an explicit decision may supersede it.</span></div><p className="muted">These are synthetic sources authored for the contradiction scenario.</p></>}
      {dialog.type === "project" && <><p>Project Atlas is a synthetic single-repository fixture.</p><dl className="facts"><div><dt>Repository</dt><dd><code>atlas-web</code></dd></div><div><dt>Branch</dt><dd><code>fixture/timeout-recovery</code></dd></div><div><dt>Target scope</dt><dd><code>src/auth/</code>, <code>tests/auth/</code></dd></div><div><dt>Permitted commands</dt><dd><code>pnpm test:auth</code><br /><code>pnpm lint:auth</code></dd></div></dl><div className="permission-note"><Icon name="lock" /><span>No project files or runtime stores are read by this prototype.</span></div></>}
      {dialog.type === "budget" && <><p>The current <strong>{state.budget}-minute cap</strong> is exhausted. Extend it by <strong>10 minutes</strong> for the current scoped checks.</p><dl className="facts"><div><dt>New cap</dt><dd>{state.budget + 10} minutes · same 2-attempt limit</dd></div><div><dt>Scope and permissions</dt><dd>Unchanged · local workspace only</dd></div><div><dt>Effective revision</dt><dd>{state.revision} → {state.revision + 1}</dd></div></dl><Callout title="Evidence must be refreshed">The budget decision creates a new revision. Prior proof stays inspectable but cannot close the new revision.</Callout><label className="acknowledgement"><input type="checkbox" checked={ack} onChange={(event) => setAck(event.target.checked)} /><span>I authorize this 10-minute extension for scoped verification only.</span></label><div className="dialog-actions"><Button onClick={close}>Keep paused</Button><Button variant="primary" disabled={!ack} onClick={() => { patch({ budget: state.budget + 10, revision: state.revision + 1, condition: "normal", proof: "stale", tab: "overview" }); close(); setAnnouncement("Budget extension approved in the fixture. Current proof is required for the new revision."); }}>Approve bounded extension</Button></div></>}
      {dialog.type === "revision" && <><p>Explain the observed behavior that needs another bounded iteration. Existing proof will become stale for the revised task.</p><label className="field-label" htmlFor="revision-note">Requested change</label><textarea id="revision-note" rows={4} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Describe the expected behavior and what you observed." /><p className="fixture-disclaimer">This three-screen prototype retains the request for review; it cannot reconcile arbitrary behavior changes.</p><div className="dialog-actions"><Button onClick={close}>Cancel</Button><Button variant="primary" disabled={!draft.trim()} onClick={() => { patch({ candidate: draft.trim(), dirty: true, adopted: false, started: false, proof: "stale" }); close(); navigate("prepared"); setAnnouncement("Revision draft retained. A new coherent contract and Start approval are required."); }}>Save revision draft</Button></div></>}
      {dialog.type === "followup" && <><p>The accepted result for revision {state.revision} stays frozen. Capture a separate desired outcome.</p><label className="field-label" htmlFor="followup-note">Follow-up outcome</label><textarea id="followup-note" rows={4} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="What should change next?" /><p className="fixture-disclaimer">Follow-up handoff preview only. Full follow-up planning is outside this prototype.</p><div className="dialog-actions"><Button onClick={close}>Cancel</Button><Button variant="primary" disabled={!draft.trim()} onClick={() => setDialog({ type: "followup-saved" })}>Keep follow-up draft</Button></div></>}
      {dialog.type === "followup-saved" && <><Callout tone="success" title="Follow-up draft retained">The accepted task is unchanged. This draft is held in this open prototype only.</Callout><blockquote className="source-quote">{draft}</blockquote><div className="dialog-actions"><Button onClick={close}>Return to accepted result</Button></div></>}
    </Dialog>}
  </div>;
}

function dialogTitle(type) {
  return { edit: "Edit the proposed outcome", start: "Review Start authority", approve: "Accept the reviewed result", proof: "Inspect criterion proof", sources: "Request and proposal sources", project: "Project and permitted scope", budget: "Approve a bounded extension", revision: "Request another iteration", followup: "Create a follow-up draft", "followup-saved": "Follow-up handoff" }[type];
}

function ProofDetails({ state, index }) {
  const criterion = criteria(state.policy)[index];
  const missing = index === 2 && state.proof === "missing";
  const stale = state.proof === "stale";
  return <><div className="proof-dialog-title"><span className="criterion-id">{criterion.id}</span><h3>{criterion.title}</h3><Badge tone={missing || stale ? "warning" : "success"} icon={missing ? "help" : stale ? "history" : "check"}>{missing ? "Missing" : stale ? "Stale" : "Current"}</Badge></div><dl className="facts"><div><dt>Expected</dt><dd>{criterion.expected}</dd></div><div><dt>Observed</dt><dd>{missing ? "No behavioral observation attached." : criterion.observed}</dd></div><div><dt>{missing ? "Required producer" : "Producer"}</dt><dd>{missing ? "Behavior observer · observation not attached" : "Fixture behavior observer · deterministic"}</dd></div><div><dt>Revision / attempt</dt><dd>{stale ? state.revision - 1 : state.revision} / 1 · current revision {state.revision}</dd></div><div><dt>Workspace head</dt><dd><code>fixture-8c41</code></dd></div><div><dt>Proof identity</dt><dd>{missing ? "Unavailable" : <code>proof-{criterion.id.toLowerCase()}-r{stale ? state.revision - 1 : state.revision}</code>}</dd></div></dl><pre className="observation-log">{missing ? "command: pnpm test:auth\nexit_code: 0\nrequest_count_observation: absent\ncriterion_verdict: unknown" : `criterion: ${criterion.id}\nrevision: ${stale ? state.revision - 1 : state.revision}\nattempt: 1\nhead: fixture-8c41\nobservation: ${criterion.observed}\nverdict_for_current_revision: ${stale ? "stale" : "verified"}`}</pre><p className="fixture-disclaimer">Synthetic proof for interface review. This is not AOR runtime evidence.</p></>;
}
