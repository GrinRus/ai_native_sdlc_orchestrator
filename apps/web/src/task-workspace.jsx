import { useEffect, useMemo, useState } from "react";
import { Button, Card, EmptyState, StatusBadge } from "./ui/components.jsx";

const SCREENS = [
  ["home", "Tasks Home"],
  ["new", "New Task"],
  ["sources", "Markdown Sources"],
  ["prepared", "Prepared Task"],
  ["active", "Active Task Workspace"],
  ["attention", "Attention"],
  ["review", "Review Changes"],
  ["complete", "Completion & Evidence"],
];

function taskStatusLabel(task) {
  if (task?.status === "draft") return "Draft";
  if (task?.status === "prepared") return "Ready";
  if (task?.status === "completed") return "Completed";
  if (task?.status === "attention") return "Needs attention";
  return "Active";
}

function taskStatusTone(task) {
  if (task?.status === "completed") return "neutral";
  if (task?.status === "draft") return "neutral";
  if (task?.status === "prepared") return "success";
  if (task?.status === "attention") return "warning";
  return "success";
}

function taskTitle(task) {
  return task?.display_title || "Untitled task";
}

function sanitizeMarkdown(value) {
  const input = String(value ?? "");
  let output = "";
  let index = 0;
  while (index < input.length) {
    if (input[index] !== "<") {
      output += input[index];
      index += 1;
      continue;
    }

    const remainder = input.slice(index).toLowerCase();
    if (remainder.startsWith("<script")) {
      const closingStart = remainder.indexOf("</script");
      if (closingStart < 0) break;
      const closingEnd = input.indexOf(">", index + closingStart + 2);
      index = closingEnd < 0 ? input.length : closingEnd + 1;
      continue;
    }

    const tagEnd = input.indexOf(">", index + 1);
    if (tagEnd < 0) break;
    index = tagEnd + 1;
  }
  return output;
}

function EmptyTaskState({ onNewTask }) {
  return <Card><EmptyState title="No tasks yet">Start with a plain-language outcome and review the prepared task before it can write.</EmptyState><Button variant="primary" onClick={onNewTask}>New Task</Button></Card>;
}

export function TaskWorkspace({ project, tasks = [], selectedTaskId = null, onSelectTask, onNewTask, onRefresh, connectionState = "connected", resourceError = null, pending = false }) {
  const [screen, setScreen] = useState("home");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [outcome, setOutcome] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [focusedTaskId, setFocusedTaskId] = useState(selectedTaskId);
  const selectedTask = (focusedTaskId ? tasks.find((task) => task.task_id === focusedTaskId) : tasks[0]) ?? null;
  useEffect(() => {
    setFocusedTaskId(selectedTaskId);
    if (selectedTaskId) setScreen("prepared");
  }, [selectedTaskId]);
  const visibleTasks = useMemo(() => tasks.filter((task) => {
    const matchesQuery = !query.trim() || `${taskTitle(task)} ${task.work_type ?? ""}`.toLowerCase().includes(query.trim().toLowerCase());
    const matchesFilter = filter === "all" || task.status === filter;
    return matchesQuery && matchesFilter;
  }), [tasks, query, filter]);

  function chooseTask(task) {
    setFocusedTaskId(task.task_id);
    onSelectTask?.(task);
    setScreen("prepared");
  }

  return <section className="task-workspace aor-ui" aria-label="Task Workspace">
    <header className="task-workspace__header">
      <div><p className="mission-eyebrow">Task Workspace</p><h1>{project?.display_name || project?.project_id || "Your project"}</h1><p>Work from a server-owned Task projection. Runtime lifecycle and next actions remain authoritative.</p></div>
      <Button variant="primary" onClick={() => { setScreen("new"); onNewTask?.(); }}>New Task</Button>
    </header>
    <nav className="task-workspace__nav" aria-label="Task screens">
      {SCREENS.map(([id, label]) => <button type="button" className={screen === id ? "selected" : ""} key={id} onClick={() => setScreen(id)}>{label}</button>)}
    </nav>
    {connectionState !== "connected" ? <Card role="alert"><strong>{connectionState === "offline" ? "Tasks are temporarily unavailable." : "Task data is partially available."}</strong><p>{resourceError?.detail || "AOR will not infer lifecycle or next action from stale data."}</p>{onRefresh ? <Button onClick={onRefresh}>Retry</Button> : null}</Card> : null}
    {screen === "home" ? <>
      <div className="task-workspace__toolbar"><div><h2>Tasks</h2><p>{tasks.length ? `${tasks.length} task${tasks.length === 1 ? "" : "s"}` : "No tasks yet"}</p></div><div><input aria-label="Search tasks" placeholder="Search tasks" value={query} onChange={(event) => setQuery(event.target.value)} /><select aria-label="Filter tasks" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All</option><option value="draft">Draft</option><option value="prepared">Ready</option><option value="active">Active</option><option value="attention">Attention</option><option value="completed">Completed</option></select></div></div>
      {pending ? <Card><p>Loading tasks…</p></Card> : visibleTasks.length ? <div className="task-workspace__grid">{visibleTasks.map((task) => <button type="button" className="task-workspace__card" key={task.task_id} onClick={() => chooseTask(task)}><div><strong>{taskTitle(task)}</strong><StatusBadge tone={taskStatusTone(task)}>{taskStatusLabel(task)}</StatusBadge></div><span>{task.work_type || "work"} · {task.current_step_label || "Ready"}</span><p>{task.primary_action?.reason || "Open the server-owned task read model."}</p><small>{task.attention_count ?? 0} attention · {task.blocker_count ?? 0} blockers · {task.evidence_refs?.length ?? 0} evidence{task.updated_at ? ` · Updated ${new Date(task.updated_at).toLocaleString()}` : ""}</small></button>)}</div> : <EmptyTaskState onNewTask={() => { setScreen("new"); onNewTask?.(); }} />}
    </> : null}
    {screen === "new" ? <Card><h2>New Task</h2><p>Describe the outcome in plain language. Nothing writes until review and explicit confirmation.</p><label htmlFor="task-outcome">Outcome</label><textarea id="task-outcome" rows="5" value={outcome} onChange={(event) => setOutcome(event.target.value)} placeholder="What should be true when this task is complete?" /><div className="task-workspace__actions"><Button onClick={() => setScreen("sources")} disabled={!outcome.trim()}>Add Markdown sources</Button><Button variant="secondary" onClick={() => setScreen("home")}>Cancel</Button></div></Card> : null}
    {screen === "sources" ? <Card><h2>Markdown Sources</h2><p>Sources are immutable snapshots. Previews are sanitized text and never execute HTML, scripts, embeds, or remote loads.</p><label htmlFor="task-markdown">Paste Markdown</label><textarea id="task-markdown" rows="8" value={markdown} onChange={(event) => setMarkdown(event.target.value)} placeholder="# Context" /><div className="task-workspace__source-preview"><strong>Sanitized preview</strong><pre>{sanitizeMarkdown(markdown)}</pre></div><div className="task-workspace__actions"><Button variant="primary" onClick={() => setScreen("prepared")}>Prepare Task</Button><Button variant="secondary" onClick={() => setScreen("new")}>Back</Button></div></Card> : null}
    {screen === "prepared" ? <Card><h2>Prepared Task</h2><p className="task-workspace__read-only">Read-only review until Edit is selected.</p><dl className="task-workspace__details"><dt>Outcome</dt><dd>{outcome || taskTitle(selectedTask)}</dd><dt>Acceptance</dt><dd>Reviewed by the operator before confirmation.</dd><dt>Scope and safety</dt><dd>No-write preparation; approved route policy remains server-owned.</dd><dt>Revision</dt><dd>{selectedTask?.updated_at || "draft"}</dd></dl><div className="task-workspace__actions"><Button onClick={() => setScreen("new")}>Edit</Button><Button variant="primary" disabled={!selectedTask && !outcome.trim()} onClick={() => setScreen("active")}>Confirm and Start</Button></div></Card> : null}
    {screen === "active" ? <Card><h2>Active Task Workspace</h2><p>{taskTitle(selectedTask)}</p><div className="task-workspace__tabs"><button type="button" className="selected">Activity</button><button type="button" onClick={() => setScreen("review")}>Changes</button><button type="button">Checks</button><button type="button" onClick={() => setScreen("attention")}>Evidence</button></div><p>{selectedTask?.current_step_label || "Waiting for runtime activity"}</p><div className="task-workspace__actions"><Button onClick={() => setScreen("attention")}>Pause</Button><Button variant="secondary" onClick={() => setScreen("review")}>Review</Button></div></Card> : null}
    {screen === "attention" ? <Card><h2>Attention</h2><p>Resolve the recorded blocker or durable operator request before continuing.</p><ul><li>{selectedTask?.blocker_count ?? 0} blockers</li><li>{selectedTask?.attention_count ?? 0} attention items</li></ul><Button variant="primary" onClick={() => setScreen("active")}>Return to task</Button></Card> : null}
    {screen === "review" ? <Card><h2>Review Changes</h2><p>Review the diff, Markdown before/after, checks, and evidence lineage before delivery.</p><div className="task-workspace__diff"><pre>{sanitizeMarkdown(markdown) || "No changes have been materialized."}</pre></div><div className="task-workspace__actions"><Button variant="primary" onClick={() => setScreen("complete")}>Open delivery preview</Button><Button variant="secondary" onClick={() => setScreen("attention")}>Request revision</Button></div></Card> : null}
    {screen === "complete" ? <Card><h2>Completion & Evidence</h2><p>Completion is immutable and only follows complete verification and delivery evidence.</p><dl className="task-workspace__details"><dt>Task</dt><dd>{selectedTask?.task_id || "draft"}</dd><dt>Evidence</dt><dd>{selectedTask?.evidence_refs?.length ?? 0} durable references</dd><dt>Follow-up</dt><dd>A follow-up creates a new Intent and Task lineage.</dd></dl><Button variant="secondary" onClick={() => setScreen("home")}>Back to Tasks</Button></Card> : null}
  </section>;
}
