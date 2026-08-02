import React, { useEffect, useMemo, useState } from "react";

import { Alert, Button, Disclosure, EmptyState, StatusBadge } from "./ui/components.jsx";
import { attentionRows, journeyRows } from "./quiet-modes-model.js";
import "./quiet-modes.css";

const GROUPS = [
  ["needs-attention", "Needs attention"],
  ["running", "Running"],
  ["upcoming", "Upcoming"],
  ["resolved", "Resolved"],
];

function AttentionMode({ projection, status, resourceErrors, onResolve, onInspect }) {
  const rows = useMemo(() => attentionRows(projection, resourceErrors), [projection, resourceErrors]);
  const [selectedId, setSelectedId] = useState(null);
  const [drafts, setDrafts] = useState({});
  useEffect(() => { setSelectedId(null); setDrafts({}); }, [projection?.flow_id]);
  const selected = rows.find((row) => row.item_id === selectedId) ?? rows[0] ?? null;
  if (status === "loading") return <section className="quiet-mode-panel" aria-busy="true"><p>Loading Attention…</p></section>;
  if (rows.length === 0) return <EmptyState title="No attention items">Durable control-plane evidence has no pending operator work.</EmptyState>;
  return <section className="quiet-mode-panel quiet-attention" aria-label="Attention queue">
    <div className="quiet-attention-groups">{GROUPS.map(([state, label]) => {
      const entries = rows.filter((row) => row.state === state);
      if (!entries.length) return null;
      return <section key={state}><h2>{label} <span>{entries.length}</span></h2><ul>{entries.map((row) => <li key={row.item_id}><button type="button" aria-current={selected?.item_id === row.item_id} onClick={() => setSelectedId(row.item_id)}><StatusBadge tone={row.severity}>{row.stage ?? row.source_family}</StatusBadge><strong>{row.title}</strong><span>{row.consequence}</span></button></li>)}</ul></section>;
    })}</div>
    {selected ? <aside className="quiet-attention-detail" aria-label="Selected attention item"><h2>{selected.title}</h2><p>{selected.consequence}</p>{selected.transient_read_error ? <Alert tone="warning">This is a current read failure, not durable completion state.</Alert> : null}<label><span>Operator draft</span><textarea value={drafts[selected.item_id] ?? ""} onChange={(event) => setDrafts((current) => ({ ...current, [selected.item_id]: event.target.value }))}/></label><div className="quiet-mode-actions">{selected.operator_control?.availability === "ready" ? <Button onClick={() => onResolve(selected)}>{selected.operator_control.label}</Button> : null}<Button variant="secondary" onClick={() => onInspect(selected)}>Inspect evidence</Button></div><Disclosure label="Technical source"><code>{selected.source_ref}</code></Disclosure></aside> : null}
  </section>;
}

function JourneyMode({ planState, runs, deliveryManifests }) {
  const rows = journeyRows(planState, runs, deliveryManifests);
  const blocked = rows.some((row) => ["blocked", "failed", "partial", "stale"].includes(String(row.status)));
  return <section className="quiet-mode-panel" aria-label="Journey"><header><h2>Journey</h2><StatusBadge tone={blocked ? "warning" : "information"}>{blocked ? "Blocked work remains" : `${rows.length} recorded steps`}</StatusBadge></header>{rows.length ? <table><thead><tr><th>Type</th><th>Work</th><th>Status</th></tr></thead><tbody>{rows.map((row) => <tr key={`${row.kind}:${row.id}`}><td>{row.kind}</td><td>{row.label}</td><td><StatusBadge tone={["failed", "blocked", "partial"].includes(String(row.status)) ? "warning" : "neutral"}>{row.status}</StatusBadge></td></tr>)}</tbody></table> : <EmptyState title="Journey evidence not available">Create and approve a plan to see evidence-derived progress.</EmptyState>}</section>;
}

function EvidenceMode({ graph, trace, onInspect }) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes.filter((node) => node.family !== "flow") : [];
  return <section className="quiet-mode-panel" aria-label="Evidence"><header><h2>Evidence</h2><StatusBadge tone="neutral">{nodes.length} artifacts</StatusBadge></header>{nodes.length ? <ul className="quiet-evidence-list">{nodes.map((node) => <li key={node.node_id}><div><strong>{node.label}</strong><span>{node.family} · {node.stage ?? "unscoped"}</span></div><StatusBadge tone={node.status === "fail" ? "danger" : "neutral"}>{node.status ?? "recorded"}</StatusBadge><Button variant="secondary" onClick={() => onInspect({ source_ref: node.ref })}>Inspect</Button></li>)}</ul> : <EmptyState title="No flow evidence">Evidence appears after runtime-owned artifacts exist.</EmptyState>}<Disclosure label="Runtime trace"><p>{trace?.trace_items?.length ?? 0} trace events across {trace?.run_ids?.length ?? 0} runs.</p></Disclosure></section>;
}

export function QuietModeSurface({ mode, attention, attentionStatus, resourceErrors, planState, runs, deliveryManifests, graph, trace, onResolve, onInspect }) {
  if (mode === "cockpit") return null;
  if (mode === "attention") return <AttentionMode projection={attention} status={attentionStatus} resourceErrors={resourceErrors} onResolve={onResolve} onInspect={onInspect}/>;
  if (mode === "journey") return <JourneyMode planState={planState} runs={runs} deliveryManifests={deliveryManifests}/>;
  return <EvidenceMode graph={graph} trace={trace} onInspect={onInspect}/>;
}
