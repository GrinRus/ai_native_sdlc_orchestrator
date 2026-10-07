import { Badge, Bounds, Button, Callout, Icon, SectionHeading, originalRequest, criteria } from "./shared.jsx";

export function Prepared({ state, patch, navigate, open }) {
  const blocked = !state.adopted || state.dirty || state.rejected || state.condition !== "normal";
  const reason = state.condition === "offline" ? "Reconnect to confirm the current revision." : state.condition === "budget" ? "Review the budget decision before more work." : state.rejected ? "The proposal was rejected. A new draft is required." : state.dirty ? "Your edits need reconciliation before Start." : !state.adopted ? "Resolve the retry decision before Start." : "Start authorizes only the revision and bounds shown here.";
  return <>
    <div className="page-heading"><div><p className="eyebrow">Prepared task · revision {state.revision}</p><h1 id="task-title" tabIndex={-1}>Fix timeout recovery</h1><p className="subtitle">Review the behavior you want, then authorize bounded work.</p></div><Badge tone={blocked ? "warning" : "success"} icon={blocked ? "alertCircle" : "check"}>{blocked ? "Needs a decision" : "Ready to start"}</Badge></div>
    <div className="workspace-grid">
      <div className="main-column">
        <section className="panel behavior-panel">
          <SectionHeading eyebrow="01 / Desired behavior" title="What this task must do" action={<button className="text-button" onClick={() => open("edit")}><Icon name="code" />Edit outcome</button>} />
          <div className="request-source"><p className="source-label"><Icon name="clipboard" />Your original request</p><blockquote>{originalRequest}</blockquote></div>
          <div className="effective-outcome"><div className="inline-label"><span className="eyebrow">{state.adopted && !state.dirty ? "Effective outcome" : "AI proposal"}</span><Badge tone={state.adopted && !state.dirty ? "success" : "warning"}>{state.adopted && !state.dirty ? "Adopted" : "Not adopted"}</Badge></div><p>{state.candidate}</p></div>
          {state.policy === "auto" && state.adopted && <p className="source-change"><Icon name="history" />DEC-07 explicitly changed the original no-retry requirement.</p>}
          <div className="criteria-list">
            {criteria(state.policy).map((criterion, index) => <div className={`requirement ${index === 2 ? "requirement-negative" : ""}`} key={criterion.id}>
              <span className="criterion-id">{criterion.id}</span><div><div className="requirement-title"><h3>{criterion.title}</h3>{index === 2 && <Badge tone="neutral">Must {state.policy === "manual" ? "not" : "limit"}</Badge>}</div><p>{criterion.expected}</p><span className="source-text">{criterion.source}</span></div>
              <Icon name={index === 2 ? "shield" : "target"} />
            </div>)}
          </div>
        </section>
        {!state.adopted && !state.rejected && <Callout title="The proposal contradicts your request" action={<button className="text-button" onClick={() => navigate("decision")}>Compare options and resolve <Icon name="chevronRight" /></button>}>It adds an automatic retry. Your request explicitly forbids it. This is a behavior decision, not a wording change.</Callout>}
        {state.dirty && <Callout title="Edited proposal · not reconciled" action={<button className="text-button" onClick={() => navigate("decision")}>Review edited outcome <Icon name="chevronRight" /></button>}>The saved draft is preserved. The original requirements still apply until a decision adopts a coherent revision.</Callout>}
        {state.rejected && <Callout title="Proposal rejected" action={<button className="text-button" onClick={() => { patch({ rejected: false, dirty: true }); open("edit"); }}>Create a new draft <Icon name="chevronRight" /></button>}>No work can start from the rejected proposal.</Callout>}
        <section className="source-row"><Icon name="file" /><div><strong>Grounded in your request</strong><p>{state.policy === "auto" && state.adopted ? "Original request retained · C02/C03 revised by DEC-07" : "Source: request-184 · all 3 requirements retained"}</p></div><button className="text-button" onClick={() => open("sources")}>Inspect sources <Icon name="chevronRight" /></button></section>
      </div>
      <aside className="support-column">
        <section className="panel next-action"><p className="eyebrow">02 / Before work begins</p><h2>{blocked ? "One decision stands in the way" : "You are authorizing revision " + state.revision}</h2><p>{blocked ? reason : "AOR may make scoped local changes and run the allowed checks. It must stop when behavior or permissions need a new decision."}</p>
          {blocked && state.condition === "normal" && !state.rejected && <Button variant="primary" onClick={() => navigate("decision")}>Resolve decision <Icon name="chevronRight" /></Button>}
          {state.adopted && !state.dirty && <div className="adoption-record"><Icon name="check" /><span>DEC-07 adopted · revision {state.revision}<br /><small>Required behavior is reconciled.</small></span></div>}
        </section>
        <Bounds state={state} onProject={() => open("project")} />
      </aside>
    </div>
    <div className="action-bar"><div><strong>{blocked ? "Start is blocked" : "Ready for bounded work"}</strong><p id="start-reason">{reason}</p></div><Button variant="primary" disabled={blocked} aria-describedby="start-reason" onClick={() => open("start")}><Icon name="play" />Start task</Button></div>
  </>;
}
