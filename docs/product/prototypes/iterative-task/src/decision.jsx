import { Badge, Bounds, Button, Callout, Icon, SectionHeading, originalRequest, manualOutcome, autoOutcome } from "./shared.jsx";

export function Decision({ state, patch, adopt, navigate, open }) {
  const changesRequest = state.selected === "auto";
  const blocked = state.condition !== "normal" || (changesRequest && !state.decisionAcknowledged);
  return <>
    <div className="page-heading"><div><p className="eyebrow">Decision DEC-07 · work has not started</p><h1 id="task-title" tabIndex={-1}>Who should trigger a retry?</h1><p className="subtitle">The AI proposal changes an explicit requirement. Choose the intended behavior.</p></div><Badge tone="warning" icon="pause">Decision required</Badge></div>
    <div className="workspace-grid">
      <div className="main-column">
        <section className="panel">
          <SectionHeading eyebrow="Why you are being asked" title="Two different behaviors" />
          <div className="comparison-grid"><div><p className="source-label"><Icon name="clipboard" />Your request · authoritative</p><h3>Manual recovery</h3><p>{originalRequest}</p></div><div className="comparison-proposed"><p className="source-label"><Icon name="code" />AI proposal · not adopted</p><h3>Automatic recovery</h3><p>{state.candidate}</p><Badge tone="warning">Conflicts with C03</Badge></div></div>
          <button className="text-button source-link" onClick={() => open("sources")}>Inspect request and proposal sources <Icon name="external" /></button>
        </section>
        <section className="panel choice-panel">
          <fieldset><legend>Choose the desired behavior</legend>
            <label className={`choice ${!changesRequest ? "choice-selected" : ""}`}><input type="radio" name="retry-policy" value="manual" checked={!changesRequest} onChange={() => patch({ selected: "manual", decisionAcknowledged: false })} /><div><div className="choice-title"><strong>Keep retries manual</strong><Badge tone="info">Matches your request</Badge></div><p>Show the error. Wait for the user to choose Retry.</p><span className="source-text">C01–C03 preserved · same scope and budget</span></div></label>
            <label className={`choice ${changesRequest ? "choice-selected" : ""}`}><input type="radio" name="retry-policy" value="auto" checked={changesRequest} onChange={() => patch({ selected: "auto", decisionAcknowledged: false })} /><div><div className="choice-title"><strong>Allow one automatic retry</strong><Badge tone="warning">Changes your request</Badge></div><p>Try once more automatically, then offer manual recovery.</p><span className="source-text">C02/C03 change · execution cap 20 → 30 minutes</span></div></label>
          </fieldset>
        </section>
        <section className="panel adoption-preview">
          <SectionHeading eyebrow="Adoption preview" title={`Revision ${state.revision} → ${state.revision + 1}`} />
          <p className="preview-outcome">{changesRequest ? autoOutcome : manualOutcome}</p>
          <dl className="change-list"><div><dt>Behavior</dt><dd>{changesRequest ? "Original retry prohibition is explicitly superseded by DEC-07." : "Automatic retry is removed from the AI proposal."}</dd></div><div><dt>Verification</dt><dd>{changesRequest ? "Observe exactly one automatic retry, then no further requests." : "Observe zero automatic retries before a user action."}</dd></div><div><dt>Authority</dt><dd>{changesRequest ? "New Start approval required · 30-minute cap." : "Scope and 20-minute cap stay the same. Start still requires approval."}</dd></div></dl>
          {changesRequest && <label className="acknowledgement"><input type="checkbox" checked={state.decisionAcknowledged} onChange={(event) => patch({ decisionAcknowledged: event.target.checked })} /><span>I am changing the no-automatic-retry requirement and approving a 30-minute cap for the next Start review.</span></label>}
        </section>
      </div>
      <aside className="support-column"><section className="panel next-action"><p className="eyebrow">What adoption does</p><h2>A decision changes the task</h2><p>AOR will return the new effective revision and its verification requirements. Review it before Start.</p><div className="permission-note"><Icon name="lock" /><span>Choosing an option or adopting a revision does not start a runner.</span></div></section><Bounds state={state} onProject={() => open("project")} /><Callout tone="info" title="Affected criteria">C02 · manual recovery<br />C03 · automatic-retry policy</Callout></aside>
    </div>
    <div className="action-bar"><button className="text-button" onClick={() => { patch({ rejected: true, adopted: false }); navigate("prepared"); }}>Reject proposal</button><div className="action-bar-right"><p id="adopt-reason">{state.condition === "offline" ? "Reconnect before adoption." : state.condition === "budget" ? "Review the budget decision before adoption." : "Review revision " + (state.revision + 1) + " before starting work."}</p><Button variant="primary" disabled={blocked} aria-describedby="adopt-reason" onClick={adopt}>Adopt revision {state.revision + 1}<Icon name="chevronRight" /></Button></div></div>
  </>;
}
