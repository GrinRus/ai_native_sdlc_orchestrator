import { useMemo, useState } from "react";
import { Button, Card, EmptyState, StatusBadge } from "./ui/components.jsx";

const STATUS_TONES = { active: "success", blocked: "danger", completed: "neutral" };

function flowTitle(flow) {
  return flow?.display_title || flow?.mission_settings?.title || flow?.mission_id || "Untitled Flow";
}

function statusLabel(flow) {
  if (flow?.blocker_count > 0 || flow?.status === "blocked") return "Needs attention";
  if (flow?.status === "completed") return "Completed";
  return "Active";
}

export function ProjectHome({ project, flows = [], activeFlow, resumableIntent, onOpenFlow, onNewIntent, onResumeIntent, pending = false }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const visibleFlows = useMemo(() => flows.filter((flow) => {
    const matchesQuery = !query.trim() || `${flowTitle(flow)} ${flow.work_type ?? ""}`.toLowerCase().includes(query.trim().toLowerCase());
    const matchesFilter = filter === "all" || (filter === "attention" ? flow.blocker_count > 0 || flow.status === "blocked" : flow.status === filter);
    return matchesQuery && matchesFilter;
  }), [flows, query, filter]);
  return <section className="project-home aor-ui" aria-label="Project Home">
    <header className="project-home__header">
      <div><p className="mission-eyebrow">Project Home</p><h1>{project?.display_name || project?.project_id || "Your project"}</h1><p>Continue an active Flow or start with a new user intent.</p></div>
      <Button variant="primary" onClick={onNewIntent}>New intent</Button>
    </header>
    {resumableIntent ? <Card className="project-home__recovery"><div><strong>Resume prepared intent</strong><p>{resumableIntent.normalization?.title || resumableIntent.submission?.request_text || "A saved task is waiting for review."}</p></div><Button onClick={() => onResumeIntent(resumableIntent)}>Resume</Button></Card> : null}
    {activeFlow ? <Card className="project-home__active"><div><span className="project-home__eyebrow">Active Flow</span><h2>{flowTitle(activeFlow)}</h2><p>{activeFlow.next_action_summary || "Review the next safe action in the Cockpit."}</p><div className="project-home__meta"><StatusBadge tone={STATUS_TONES[activeFlow.status] || "neutral"}>{statusLabel(activeFlow)}</StatusBadge><span>{activeFlow.work_type || "work"}</span><span>{activeFlow.current_step || "starting"}</span></div></div><Button variant="primary" onClick={() => onOpenFlow(activeFlow.flow_id)}>Continue Flow</Button></Card> : null}
    <div className="project-home__toolbar"><div><h2>Recent Flows</h2><p>{flows.length ? `${flows.length} Flow${flows.length === 1 ? "" : "s"} in this project` : "No Flow yet"}</p></div><div className="project-home__filters"><input aria-label="Search Flows" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Flows" /><select aria-label="Filter Flows" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All</option><option value="active">Active</option><option value="attention">Needs attention</option><option value="completed">Completed</option></select></div></div>
    {pending ? <Card><p>Loading project activity…</p></Card> : visibleFlows.length ? <div className="project-home__grid">{visibleFlows.map((flow) => <button type="button" className="project-home__flow-card" key={flow.flow_id} onClick={() => onOpenFlow(flow.flow_id)}><div className="project-home__flow-card-header"><strong>{flowTitle(flow)}</strong><StatusBadge tone={STATUS_TONES[flow.status] || "neutral"}>{statusLabel(flow)}</StatusBadge></div><span>{flow.work_type || "work"} · {flow.current_step || "starting"}</span><p>{flow.next_action_summary || "Open Cockpit for the current state."}</p><small>{flow.evidence_count ?? 0} evidence · {flow.attention_count ?? 0} attention</small></button>)}</div> : <Card><EmptyState title={flows.length ? "No matching Flows" : "Start with an Intent"}>{flows.length ? "Try a different search or filter." : "Describe the outcome you want AOR to prepare."}</EmptyState></Card>}
  </section>;
}
