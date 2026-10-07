import { Badge, Bounds, Button, Callout, Icon, SectionHeading, criteria, useRovingTabs } from "./shared.jsx";

const tabs = [
  { id: "overview", label: "Overview" }, { id: "changes", label: "Changes" },
  { id: "checks", label: "Checks" }, { id: "evidence", label: "Evidence" },
  { id: "activity", label: "Activity" },
];

function proofStatus(state, index) {
  if (state.proof === "stale") return { tone: "warning", label: "Stale proof", icon: "history" };
  if (index === 2 && state.proof === "missing") return { tone: "warning", label: "Unknown", icon: "help" };
  return { tone: "success", label: "Verified", icon: "check" };
}

function CriterionReview({ state, open, replay, busy }) {
  const ordered = criteria(state.policy).map((criterion, index) => ({ criterion, index }));
  if (state.proof !== "current") ordered.sort((a, b) => Number(b.index === 2) - Number(a.index === 2));
  return <div className="review-criteria">{ordered.map(({ criterion, index }) => {
    const status = proofStatus(state, index);
    const missing = status.label === "Unknown";
    return <article data-criterion={criterion.id} className={`criterion-review ${status.tone === "warning" ? "criterion-unresolved" : ""}`} key={criterion.id}>
      <div className="criterion-heading"><div><span className="criterion-id">{criterion.id}</span><h3>{criterion.title}</h3>{index === 2 && <span className="required-label">{state.policy === "manual" ? "Negative requirement" : "Required limit"}</span>}</div><Badge {...status}>{status.label}</Badge></div>
      <div className="observation-grid"><div><p className="eyebrow">Expected</p><p>{criterion.expected}</p></div><div><p className="eyebrow">Observed</p><p>{missing ? "No request-count observation is attached. The test command passed, but this behavior is unproven." : criterion.observed}</p></div></div>
      <div className="proof-row"><div><Icon name={missing ? "help" : "evidence"} /><span>{missing ? "Required proof is missing" : `proof-${criterion.id.toLowerCase()} · revision ${state.proof === "stale" ? state.revision - 1 : state.revision} · attempt 1`}</span>{state.proof === "stale" && <span className="stale-note">Current: revision {state.revision}</span>}</div>{missing ? <Button size="compact" onClick={replay} busy={busy} disabled={state.condition !== "normal"}>Replay missing check <Icon name="play" /></Button> : <button className="text-button" onClick={() => open({ type: "proof", criterion: index })}>Inspect proof <Icon name="external" /></button>}</div>
    </article>;
  })}</div>;
}

function Drilldown({ state, open }) {
  if (state.tab === "changes") return <section className="panel drilldown"><SectionHeading eyebrow="Local workspace · head fixture-8c41" title="Behavioral change" /><div className="file-heading"><Icon name="file" /><code>src/auth/timeout.ts</code><Badge tone="neutral">Local diff</Badge></div><div className="diff-lines"><div className="diff-remove"><span>−</span><code>retryOnTimeout: true</code></div><div className="diff-add"><span>+</span><code>{state.policy === "manual" ? "retryOnTimeout: false" : "automaticRetryLimit: 1"}</code></div><div className="diff-add"><span>+</span><code>showTimeoutError();</code></div><div className="diff-add"><span>+</span><code>onRetryClick(() =&gt; sendRequest());</code></div></div><p className="muted">Synthetic diff for visual review. Verification belongs to the criterion proof.</p><div className="file-list"><div><Icon name="file" /><code>tests/auth/timeout.test.ts</code><span>3 behavior checks</span></div><div><Icon name="file" /><code>src/auth/timeout.ts</code><span>Recovery behavior</span></div></div></section>;
  if (state.tab === "checks") return <section className="panel drilldown"><SectionHeading eyebrow="Command results" title="Checks are inputs to verification" /><Callout tone="info" title="A passing command is not complete proof">C03 needs an observed request count bound to this revision, attempt, and workspace head.</Callout><div className="check-table"><div><code>pnpm test:auth</code><Badge tone="success" icon="check">Exit 0</Badge><span>12 tests · attempt 1</span></div><div><code>pnpm lint:auth</code><Badge tone="success" icon="check">Exit 0</Badge><span>Scoped files · attempt 1</span></div><div><span>Request-count observation</span><Badge tone={state.proof === "current" ? "success" : "warning"} icon={state.proof === "current" ? "check" : "help"}>{state.proof === "current" ? "Attached" : state.proof === "stale" ? "Stale" : "Missing"}</Badge><span>Required by C03</span></div></div></section>;
  if (state.tab === "evidence") return <section className="panel drilldown"><SectionHeading eyebrow="Bound to the effective task" title="Evidence index" /><div className="evidence-index">{criteria(state.policy).map((criterion, index) => <button key={criterion.id} onClick={() => open({ type: "proof", criterion: index })}><Icon name="evidence" /><div><strong>{criterion.id} · {criterion.title}</strong><span>{index === 2 && state.proof === "missing" ? "Observation missing" : `proof-${criterion.id.toLowerCase()} · attempt 1 · fixture-8c41`}</span></div><Badge tone={proofStatus(state, index).tone}>{proofStatus(state, index).label}</Badge><Icon name="chevronRight" /></button>)}</div></section>;
  return <section className="panel drilldown"><SectionHeading eyebrow="Decision and execution trail" title="Activity" /><ol className="activity-list"><li><Icon name="clipboard" /><div><strong>Request captured</strong><p>All 3 requirements retained, including no automatic retries.</p></div><span>14:02</span></li><li><Icon name="attention" /><div><strong>Contradiction surfaced</strong><p>The AI proposal added automatic recovery. Start was blocked.</p></div><span>14:03</span></li><li><Icon name="check" /><div><strong>DEC-07 adopted · revision {state.revision}</strong><p>{state.policy === "manual" ? "Manual recovery selected; original requirements preserved." : "One automatic retry selected; request change acknowledged."}</p></div><span>14:05</span></li><li><Icon name="play" /><div><strong>Start authorized</strong><p>Scoped local work, {state.budget}-minute cap, 2 attempts.</p></div><span>14:06</span></li><li><Icon name="evidence" /><div><strong>Result ready for criterion review</strong><p>{state.proof === "current" ? "All required fixture observations attached." : "Verification still needs current proof."}</p></div><span>14:12</span></li></ol><p className="muted">Fixture timeline · no real work was executed.</p></section>;
}

export function Review({ state, patch, open, replay, busy }) {
  const verified = state.proof === "current";
  const blocked = !verified || state.condition !== "normal";
  const { getTabProps } = useRovingTabs({ tabs, selected: state.tab, onSelect: (tab) => patch({ tab }) });
  const count = state.proof === "stale" ? 0 : verified ? 3 : 2;
  return <>
    <div className="page-heading"><div><p className="eyebrow">{state.completed ? "Completed task" : "Review result"} · revision {state.revision} · attempt 1</p><h1 id="task-title" tabIndex={-1}>{state.completed ? "Timeout recovery accepted" : "Did we deliver the right behavior?"}</h1><p className="subtitle">{state.completed ? "An immutable acceptance record is attached to this local fixture result." : "Verify the requirements you approved, including what must never happen."}</p></div><Badge tone={state.completed ? "success" : "warning"} icon={state.completed ? "check" : "eye"}>{state.completed ? "Accepted · fixture" : "Review required"}</Badge></div>
    <div className="task-tabs" role="tablist" aria-label="Task result views">{tabs.map((tab, index) => <button key={tab.id} id={`tab-${tab.id}`} role="tab" aria-selected={state.tab === tab.id} aria-controls="result-panel" {...getTabProps(tab, index)} onClick={() => patch({ tab: tab.id })}>{tab.label}</button>)}</div>
    <div className="workspace-grid review-grid">
      <div id="result-panel" role="tabpanel" aria-labelledby={`tab-${state.tab}`} className="main-column">
        {state.tab === "overview" ? <>
          <section className="review-summary"><div><p className="eyebrow">Requirement verification</p><h2>{count} of 3 criteria verified</h2></div><p>{state.proof === "stale" ? "Proof belongs to an older revision." : verified ? "Every required behavior has current proof." : "A passing test command left one behavior unproven."}</p></section>
          <CriterionReview state={state} open={open} replay={replay} busy={busy} />
          {state.proof === "stale" && <Callout title="Older proof cannot close this revision" action={<Button size="compact" onClick={replay} busy={busy} disabled={state.condition !== "normal"}>Replay current checks <Icon name="refresh" /></Button>}>The attached observations refer to revision {state.revision - 1}. Bind fresh observations to revision {state.revision}, attempt 1, and the current workspace head.</Callout>}
        </> : <Drilldown state={state} open={open} />}
      </div>
      <aside className="support-column">
        <section className="panel next-action"><p className="eyebrow">Your review decision</p><h2>{state.completed ? "Accepted locally" : blocked ? "Verification is incomplete" : "Ready for your acceptance"}</h2><p>{state.completed ? "The accepted revision is frozen. A different outcome requires a follow-up task." : state.condition === "budget" ? "The execution cap has been reached. Approve a bounded extension before replaying checks." : state.condition === "offline" ? "The cached result is visible. Reconnect before sending review actions." : state.proof === "stale" ? "Refresh the evidence for this revision. Old proof remains inspectable." : !verified ? "C03 has no request-count observation. Review stays open until it does." : "All three required behaviors have current fixture proof. Inspect the local delivery effect before approving."}</p><div className="verification-count"><Badge tone="success" icon="check">{count} verified</Badge><Badge tone={verified ? "neutral" : "warning"} icon={verified ? "shield" : "help"}>{3 - count} unresolved</Badge></div></section>
        <section className="delivery-panel"><p className="eyebrow">Approval effect</p><h2>Accept this local result</h2><p>Record acceptance of revision {state.revision} at <code>fixture-8c41</code>.</p><div className="permission-note"><Icon name="lock" /><span>Integration, upstream writes, and deployment remain separate actions.</span></div><button className="text-button" onClick={() => patch({ tab: "changes" })}>Inspect local changes <Icon name="chevronRight" /></button></section>
        <Bounds state={state} onProject={() => open("project")} />
      </aside>
    </div>
    {state.completed ? <div className="action-bar"><div><strong>Acceptance recorded · ACC-184</strong><p>Revision {state.revision} · current fixture evidence · local result only</p></div><Button onClick={() => open("followup")}><Icon name="plus" />Create follow-up</Button></div> : <div className="action-bar"><button className="text-button" onClick={() => open("revision")}><Icon name="code" />Request revision</button><div className="action-bar-right"><p id="review-blocker">{state.condition === "budget" ? "Budget decision required." : state.condition === "offline" ? "Reconnect before approval." : blocked ? "Current proof is required for all criteria." : "Revision " + state.revision + " · local acceptance only"}</p><Button variant="primary" disabled={blocked} aria-describedby="review-blocker" onClick={() => open("approve")}><Icon name="check" />Approve result</Button></div></div>}
  </>;
}
