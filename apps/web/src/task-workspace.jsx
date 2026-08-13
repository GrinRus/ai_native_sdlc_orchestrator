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

function sourceKindLabel(kind) {
  return kind === "upload-snapshot" ? "Uploaded Markdown" : kind === "repository-markdown" ? "Repository Markdown" : "Inline text";
}

function safeProjectRelativePath(value) {
  const path = String(value ?? "").trim();
  return path.length > 0 && !path.startsWith("/") && !path.includes("\\") && !path.split("/").includes("..");
}

function digestLabel(value) {
  const digest = String(value ?? "");
  return digest.length > 12 ? `${digest.slice(0, 12)}…` : digest || "not materialized";
}

function EmptyTaskState({ onNewTask }) {
  return <Card><EmptyState title="No tasks yet">Start with a plain-language outcome and review the prepared task before it can write.</EmptyState><Button variant="primary" onClick={onNewTask}>New Task</Button></Card>;
}

export function TaskWorkspace({ project, tasks = [], selectedTaskId = null, onSelectTask, onNewTask, onTaskAction, actionBusy = false, actionError = null, onRefresh, connectionState = "connected", resourceError = null, pending = false }) {
  const [screen, setScreen] = useState("home");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [outcome, setOutcome] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [operatorRequestText, setOperatorRequestText] = useState("");
  const [reviewView, setReviewView] = useState("rendered");
  const [sourceMode, setSourceMode] = useState("inline");
  const [uploadName, setUploadName] = useState("");
  const [sourceError, setSourceError] = useState("");
  const [repositoryPath, setRepositoryPath] = useState("");
  const [repositoryRevision, setRepositoryRevision] = useState("");
  const [focusedTaskId, setFocusedTaskId] = useState(selectedTaskId);
  const selectedTask = (focusedTaskId ? tasks.find((task) => task.task_id === focusedTaskId) : tasks[0]) ?? null;
  const selectedSources = Array.isArray(selectedTask?.source_items) ? selectedTask.source_items : [];
  const runnerSelection = selectedTask?.runner_selection ?? null;
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

  async function readUpload(file) {
    setSourceError("");
    if (!file) return;
    if (!/\.md(?:own)?$/iu.test(file.name) || file.size > 1_000_000) {
      setSourceError("Upload a UTF-8 Markdown file smaller than 1 MB.");
      return;
    }
    try {
      const text = await file.text();
      setMarkdown(text);
      setUploadName(file.name.replace(/[\\/]/gu, "_"));
    } catch {
      setSourceError("The Markdown upload could not be read; try another file.");
    }
  }

  function sourcePreview() {
    if (sourceMode === "upload") return sanitizeMarkdown(markdown) || "Choose a Markdown file to preview.";
    if (sourceMode === "repository") {
      const source = selectedSources.find((item) => item.kind === "repository-markdown");
      return sanitizeMarkdown(source?.preview?.sanitized_markdown || "") || "Pinned repository Markdown is read-only until the source is confirmed.";
    }
    return sanitizeMarkdown(markdown);
  }

  return <section className="task-workspace aor-ui aor-density-relaxed" aria-label="Task Workspace" data-density="relaxed">
    <header className="task-workspace__header">
      <div><p className="mission-eyebrow">Task Workspace</p><h1>{project?.display_name || project?.project_id || "Your project"}</h1><p>Work from a server-owned Task projection. Runtime lifecycle and next actions remain authoritative.</p></div>
      <Button variant="primary" onClick={() => { setScreen("new"); onNewTask?.(); }}>New Task</Button>
    </header>
    <nav className="task-workspace__nav" aria-label="Task screens">
      {SCREENS.map(([id, label]) => <button type="button" className={screen === id ? "selected" : ""} key={id} onClick={() => setScreen(id)}>{label}</button>)}
    </nav>
    {connectionState !== "connected" ? <Card role="alert"><strong>{connectionState === "offline" ? "Tasks are temporarily unavailable." : "Task data is partially available."}</strong><p>{resourceError?.detail || "AOR will not infer lifecycle or next action from stale data."}</p>{onRefresh ? <Button onClick={onRefresh}>Retry</Button> : null}</Card> : null}
    {actionError ? <Card role="alert"><strong>Task action needs recovery</strong><p>{actionError}</p></Card> : null}
    {screen === "home" ? <>
      <div className="task-workspace__toolbar"><div><h2>Tasks</h2><p>{tasks.length ? `${tasks.length} task${tasks.length === 1 ? "" : "s"}` : "No tasks yet"}</p></div><div><input aria-label="Search tasks" placeholder="Search tasks" value={query} onChange={(event) => setQuery(event.target.value)} /><select aria-label="Filter tasks" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All</option><option value="draft">Draft</option><option value="prepared">Ready</option><option value="active">Active</option><option value="attention">Attention</option><option value="completed">Completed</option></select></div></div>
      {pending ? <Card><p>Loading tasks…</p></Card> : visibleTasks.length ? <div className="task-workspace__grid">{visibleTasks.map((task) => <button type="button" className="task-workspace__card" key={task.task_id} onClick={() => chooseTask(task)}><div><strong>{taskTitle(task)}</strong><StatusBadge tone={taskStatusTone(task)}>{taskStatusLabel(task)}</StatusBadge></div><span>{task.work_type || "work"} · {task.current_step_label || "Ready"}</span><p>{task.primary_action?.reason || "Open the server-owned task read model."}</p><small>{task.attention_count ?? 0} attention · {task.blocker_count ?? 0} blockers · {task.evidence_refs?.length ?? 0} evidence{task.updated_at ? ` · Updated ${new Date(task.updated_at).toLocaleString()}` : ""}</small></button>)}</div> : <EmptyTaskState onNewTask={() => { setScreen("new"); onNewTask?.(); }} />}
    </> : null}
    {screen === "new" ? <Card><h2>New Task</h2><p>Describe the outcome in plain language. Nothing writes until review and explicit confirmation.</p><label htmlFor="task-outcome">Outcome</label><textarea id="task-outcome" rows="5" value={outcome} onChange={(event) => setOutcome(event.target.value)} placeholder="What should be true when this task is complete?" /><div className="task-workspace__actions"><Button onClick={() => setScreen("sources")} disabled={!outcome.trim()}>Add Markdown sources</Button><Button variant="secondary" onClick={() => setScreen("home")}>Cancel</Button></div></Card> : null}
    {screen === "sources" ? <Card><h2>Markdown Sources</h2><p>Sources are immutable snapshots. Previews are sanitized text and never execute HTML, scripts, embeds, or remote loads.</p><label htmlFor="task-source-kind">Source type</label><select id="task-source-kind" aria-label="Markdown source kind" value={sourceMode} onChange={(event) => { setSourceMode(event.target.value); setSourceError(""); }}><option value="inline">Inline text</option><option value="upload">Upload Markdown</option><option value="repository">Repository Markdown</option></select>{sourceMode === "inline" ? <><label htmlFor="task-markdown">Paste Markdown</label><textarea id="task-markdown" rows="8" value={markdown} onChange={(event) => setMarkdown(event.target.value)} placeholder="# Context" /></> : null}{sourceMode === "upload" ? <><label htmlFor="task-markdown-upload">Upload Markdown</label><input id="task-markdown-upload" type="file" accept=".md,.markdown,text/markdown" onChange={(event) => void readUpload(event.target.files?.[0])} />{uploadName ? <small>Snapshot: {uploadName}</small> : null}</> : null}{sourceMode === "repository" ? <><label htmlFor="repository-markdown-path">Project-relative Markdown path</label><input id="repository-markdown-path" value={repositoryPath} onChange={(event) => setRepositoryPath(event.target.value)} placeholder="docs/task.md" /><label htmlFor="repository-markdown-revision">Pinned base revision</label><input id="repository-markdown-revision" value={repositoryRevision} onChange={(event) => setRepositoryRevision(event.target.value)} placeholder="commit SHA" />{selectedSources.filter((item) => item.kind === "repository-markdown").map((item) => <p key={item.source_id} role={item.stale ? "alert" : undefined}>{item.stale ? "This pinned source is stale. Refresh or keep the pinned revision explicitly." : `Pinned source: ${item.preview?.project_relative_path || "repository Markdown"}`} · digest {digestLabel(item.digest)}</p>)}</> : null}{sourceError ? <p role="alert">{sourceError}</p> : null}{selectedSources.length ? <ul aria-label="Task sources">{selectedSources.map((item) => <li key={item.source_id}>{sourceKindLabel(item.kind)} · {digestLabel(item.digest)}{item.stale ? " · stale" : ""}</li>)}</ul> : null}<div className="task-workspace__source-preview"><strong>Sanitized preview</strong><pre>{sourcePreview()}</pre></div><div className="task-workspace__actions"><Button variant="primary" onClick={() => setScreen("prepared")} disabled={sourceMode === "repository" && !safeProjectRelativePath(repositoryPath)}>Prepare Task</Button><Button variant="secondary" onClick={() => setScreen("new")}>Back</Button></div></Card> : null}
    {screen === "prepared" ? <Card><h2>Prepared Task</h2><p className="task-workspace__read-only">Read-only review until Edit is selected.</p><dl className="task-workspace__details"><dt>Outcome</dt><dd>{outcome || taskTitle(selectedTask)}</dd><dt>Acceptance</dt><dd>Reviewed by the operator before confirmation.</dd><dt>Scope and safety</dt><dd>No-write preparation; approved route policy remains server-owned.</dd><dt>Revision</dt><dd>{(selectedTask?.revision ?? selectedTask?.updated_at) || "draft"}</dd></dl>{runnerSelection ? <section aria-label="Runner readiness"><strong>Runner readiness</strong><p>{runnerSelection.route_id || "Project default route"} · {runnerSelection.readiness || "unknown"}</p><p>{runnerSelection.requested_model || runnerSelection.effective_model ? `Model: ${runnerSelection.effective_model || runnerSelection.requested_model}` : "Model: runner default"} · {runnerSelection.effective_reasoning_effort || runnerSelection.requested_reasoning_effort ? `Reasoning: ${runnerSelection.effective_reasoning_effort || runnerSelection.requested_reasoning_effort}` : "Reasoning: runner default"}</p>{runnerSelection.unavailable_reason ? <p role="alert">{runnerSelection.unavailable_reason} {runnerSelection.recovery_action}</p> : null}<small>No provider process is started during local preparation.</small></section> : null}<div className="task-workspace__actions"><Button onClick={() => setScreen("new")}>Edit</Button><Button variant="primary" disabled={actionBusy || (!selectedTask && !outcome.trim())} onClick={() => onTaskAction?.(selectedTask, "start")}>Confirm and Start</Button></div></Card> : null}
    {screen === "active" ? <Card><h2>Active Task Workspace</h2><p>{taskTitle(selectedTask)}</p><div className="task-workspace__tabs"><button type="button" className="selected">Activity</button><button type="button" onClick={() => setScreen("review")}>Changes</button><button type="button">Checks</button><button type="button" onClick={() => setScreen("attention")}>Evidence</button></div><p>{selectedTask?.current_step_label || "Waiting for runtime activity"}</p>{runnerSelection ? <p>Runner: {runnerSelection.route_id || "project default"} · {runnerSelection.readiness || "unknown"}</p> : null}{selectedTask?.completed_read_only ? <p className="task-workspace__read-only">Completed Tasks are immutable. Create a follow-up Intent for new work.</p> : <div className="task-workspace__actions"><Button onClick={() => onTaskAction?.(selectedTask, "pause")} disabled={actionBusy}>Pause</Button><Button variant="secondary" onClick={() => onTaskAction?.(selectedTask, "cancel")} disabled={actionBusy}>Cancel</Button><Button variant="secondary" onClick={() => onTaskAction?.(selectedTask, "retry")} disabled={actionBusy}>Request retry</Button><Button variant="secondary" onClick={() => setScreen("review")}>Review</Button></div>}</Card> : null}
    {screen === "attention" ? <Card><h2>Attention</h2><p>Resolve authoritative blockers or durable requests before continuing.</p>{selectedTask?.attention_items?.length ? <ul>{selectedTask.attention_items.map((item) => <li key={item.item_id}><strong>{item.consequence}</strong>{item.evidence_refs?.length ? <small> · {item.evidence_refs.length} evidence refs</small> : null}</li>)}</ul> : <ul><li>{selectedTask?.blocker_count ?? 0} blockers</li><li>{selectedTask?.attention_count ?? 0} attention items</li></ul>}<label htmlFor="task-operator-request">Bounded operator request</label><textarea id="task-operator-request" rows="4" value={operatorRequestText} onChange={(event) => setOperatorRequestText(event.target.value)} placeholder="Describe the bounded recovery or question." /><div className="task-workspace__actions"><Button variant="primary" onClick={() => onTaskAction?.(selectedTask, "request", { request_text: operatorRequestText.trim() || "Inspect the recorded Task blocker." })} disabled={actionBusy || selectedTask?.completed_read_only}>Create durable request</Button><Button variant="secondary" onClick={() => setScreen("active")}>Return to task</Button></div></Card> : null}
    {screen === "review" ? <Card><h2>Review Changes</h2><p>Review the diff, Markdown before/after, checks, and evidence lineage before delivery.</p><div className="task-workspace__tabs"><button type="button" className={reviewView === "rendered" ? "selected" : ""} onClick={() => setReviewView("rendered")}>Rendered Markdown</button><button type="button" className={reviewView === "source" ? "selected" : ""} onClick={() => setReviewView("source")}>Source diff</button></div><dl className="task-workspace__details"><dt>Verification</dt><dd>{selectedTask?.review?.verification_status || "unknown"}</dd><dt>Delivery</dt><dd>{selectedTask?.review?.delivery_status || "unknown"}</dd><dt>Changed paths</dt><dd>{selectedTask?.review?.changed_paths?.length || 0}</dd></dl><div className="task-workspace__diff"><pre>{reviewView === "source" ? (selectedTask?.review?.changed_paths?.join("\n") || "No changed paths have been materialized.") : (selectedTask?.source_items?.find((item) => item.kind === "repository-markdown")?.preview?.sanitized_markdown || sanitizeMarkdown(markdown) || "No changes have been materialized.")}</pre></div><div className="task-workspace__actions"><Button variant="primary" onClick={() => setScreen("complete")}>Open delivery preview</Button><Button variant="secondary" onClick={() => setScreen("attention")}>Request revision</Button></div></Card> : null}
    {screen === "complete" ? <Card><h2>Completion & Evidence</h2><p>Completion is immutable and only follows complete verification and delivery evidence.</p><dl className="task-workspace__details"><dt>Task</dt><dd>{selectedTask?.task_id || "draft"}</dd><dt>Completion verdict</dt><dd>{selectedTask?.completion?.status || "incomplete"}</dd><dt>Verification</dt><dd>{selectedTask?.completion?.verification_status || "unknown"}</dd><dt>Delivery</dt><dd>{selectedTask?.completion?.delivery_status || "unknown"}</dd><dt>Evidence</dt><dd>{selectedTask?.completion?.evidence_refs?.length ?? selectedTask?.evidence_refs?.length ?? 0} durable references</dd></dl>{selectedTask?.completion?.status !== "complete" ? <p role="alert">Partial verification or delivery cannot be shown as successful.</p> : null}<div className="task-workspace__actions"><Button variant="primary" onClick={() => onTaskAction?.(selectedTask, "follow-up", { request_text: operatorRequestText.trim() || `Follow up on ${taskTitle(selectedTask)}.` })} disabled={actionBusy || !selectedTask?.completed_read_only}>Start follow-up task</Button><Button variant="secondary" onClick={() => setScreen("home")}>Back to Tasks</Button></div></Card> : null}
  </section>;
}
