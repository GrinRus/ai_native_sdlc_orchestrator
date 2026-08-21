import { useEffect, useMemo, useState } from "react";
import { Dialog } from "./dialog.jsx";
import { Button, EmptyState, Icon } from "./ui/components.jsx";

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

const LIFECYCLE = [
  ["prepare", "Prepare"],
  ["plan", "Plan"],
  ["execute", "Execute"],
  ["verify", "Verify"],
  ["deliver", "Deliver"],
];

const CONTEXT_LIFECYCLE = [
  ["prepare", "Prepare"],
  ["execute", "Execute"],
  ["review", "Review"],
  ["complete", "Complete"],
];

const SIDE_NAV = [
  ["home", "Tasks", "tasks"],
  ["attention", "Attention", "attention"],
  ["evidence", "Evidence", "evidence"],
  ["project", "Project", "project"],
];

function taskStatusLabel(task) {
  if (task?.status === "draft") return "Draft";
  if (task?.status === "prepared") return "Ready";
  if (task?.status === "completed") return "Completed";
  if (task?.status === "attention") return "Needs attention";
  return "Running";
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

function taskAge(timestamp) {
  if (!timestamp) return "now";
  const elapsed = Math.max(0, Date.now() - new Date(timestamp).getTime());
  if (elapsed < 60_000) return "now";
  if (elapsed < 3_600_000) return `${Math.max(1, Math.round(elapsed / 60_000))}m`;
  if (elapsed < 86_400_000) return `${Math.max(1, Math.round(elapsed / 3_600_000))}h`;
  return `${Math.max(1, Math.round(elapsed / 86_400_000))}d`;
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
  return kind === "upload-snapshot" ? "Uploaded snapshot" : kind === "repository-markdown" ? "Repository reference" : "Inline text";
}

function safeProjectRelativePath(value) {
  const path = String(value ?? "").trim();
  return path.length > 0 && !path.startsWith("/") && !path.includes("\\") && !path.split("/").includes("..");
}

function digestLabel(value) {
  const digest = String(value ?? "");
  return digest.length > 12 ? `${digest.slice(0, 12)}…` : digest || "not materialized";
}

function Glyph({ name }) {
  return <Icon name={name} className={`task-glyph task-glyph--${name}`} />;
}

function TaskStatus({ task, compact = false }) {
  return <span className={`task-status task-status--${taskStatusTone(task)}${compact ? " task-status--compact" : ""}`}><span className="task-status__dot" aria-hidden="true" />{taskStatusLabel(task)}</span>;
}

function LifecyclePath({ task, variant = "default" }) {
  const steps = variant === "context" ? CONTEXT_LIFECYCLE : LIFECYCLE;
  const currentLabel = String(task?.current_step_label ?? task?.current_step ?? "Execute").toLowerCase();
  const currentIndex = steps.findIndex(([id, label]) => currentLabel.includes(id) || currentLabel.includes(label.toLowerCase()));
  const activeIndex = currentIndex < 0 ? (task?.status === "completed" ? steps.length - 1 : Math.min(2, steps.length - 1)) : currentIndex;
  return <ol className={`task-lifecycle task-lifecycle--${variant}`} aria-label="Lifecycle progress">
    {steps.map(([id, label], index) => {
      const state = task?.status === "completed" || index < activeIndex ? "complete" : index === activeIndex ? "current" : "upcoming";
      return <li key={id} data-state={state} aria-current={state === "current" ? "step" : undefined}>
        <span className="task-lifecycle__marker" aria-hidden="true">{state === "complete" ? "✓" : ""}</span>
        <span>{label}</span>
      </li>;
    })}
  </ol>;
}

function Metric({ icon, value, label }) {
  return <div className="task-metric"><Glyph name={icon} /><div><strong>{value}</strong><span>{label}</span></div></div>;
}

function SourceRow({ source, onRemove }) {
  return <div className="task-source-row">
    <Glyph name="file" />
    <div className="task-source-row__name"><strong>{source?.preview?.filename || source?.preview?.project_relative_path || sourceKindLabel(source?.kind)}</strong><span>{source?.preview?.byte_length ? `${Math.round(source.preview.byte_length / 1024)} KB` : sourceKindLabel(source?.kind)}</span>{source?.digest ? <small>Digest: {digestLabel(source.digest)}</small> : null}</div>
    <span className={`task-source-row__state${source?.stale ? " is-stale" : ""}`}><span aria-hidden="true">{source?.stale ? "!" : "✓"}</span>{source?.stale ? "Stale" : sourceKindLabel(source?.kind)}</span>
    {onRemove ? <button type="button" className="task-icon-button" aria-label={`Remove ${source?.preview?.filename || "source"}`} onClick={() => onRemove(source)}><Glyph name="close" /></button> : <span className="task-source-row__menu" aria-hidden="true"><Glyph name="more" /></span>}
  </div>;
}

function RunSummary({ runnerSelection, title = "Run with" }) {
  const runner = runnerSelection?.route_id || "Codex CLI";
  const readiness = runnerSelection?.readiness || "ready";
  const model = runnerSelection?.effective_model || runnerSelection?.requested_model || "Runner default";
  const reasoning = runnerSelection?.effective_reasoning_effort || runnerSelection?.requested_reasoning_effort || "High";
  const runnerLabel = runner.replace(/^route\.[^.]+\./u, "");
  if (title === "Runner & safety") {
    return <section className="task-run-summary task-run-summary--prepared" aria-label="Runner readiness">
      <h2>{title}</h2>
      <div className="task-runner-card"><span className="task-runner-card__icon"><Glyph name="terminal" /></span><div><strong>{runnerLabel}</strong><span className={`task-readiness task-readiness--${readiness}`}><span className="task-readiness__dot" aria-hidden="true" />{readiness === "unavailable" ? "Unavailable" : readiness === "unknown" ? "Checking" : "Ready now"}</span></div><span className="task-runner-card__check" aria-hidden="true">{readiness === "ready" ? "✓" : "!"}</span></div>
      <button type="button" className="task-change-runner">Change runner</button>
      <dl className="task-runner-details"><div><dt>Model</dt><dd>{model}</dd></div><div><dt>Reasoning</dt><dd>{reasoning}</dd></div><div><dt>Safety</dt><dd>Patch only</dd></div></dl>
      <p className="task-safety"><Glyph name="evidence" />No upstream writes</p>
      {runnerSelection?.unavailable_reason ? <p className="task-inline-alert" role="alert">{runnerSelection.unavailable_reason} {runnerSelection.recovery_action}</p> : null}
    </section>;
  }
  return <section className="task-run-summary" aria-label="Runner readiness">
    <h2>{title}</h2>
    <div className="task-run-field"><span>Runner</span><select aria-label="Runner" value={runnerLabel} onChange={() => {}}><option>{runnerLabel}</option></select><span className={`task-readiness task-readiness--${readiness}`}><span className="task-readiness__dot" aria-hidden="true" />{readiness === "unavailable" ? "Unavailable" : readiness === "unknown" ? "Checking" : "Ready"}</span></div>
    <div className="task-run-field"><span>Model / effort</span><select aria-label="Model and reasoning effort" value={`${model} · ${reasoning}`} onChange={() => {}}><option>{model} · {reasoning}</option></select></div>
    <div className="task-run-field"><span>Safety</span><select aria-label="Safety mode" value="Patch only" onChange={() => {}}><option>Patch only</option></select></div>
    <p className="task-safety"><Glyph name="evidence" />No upstream writes</p>
    <small className="task-provider-note">No provider process is started during local preparation.</small>
    {runnerSelection?.unavailable_reason ? <p className="task-inline-alert" role="alert">{runnerSelection.unavailable_reason} {runnerSelection.recovery_action}</p> : null}
  </section>;
}

function TaskMeta({ task, project }) {
  const runner = task?.runner_selection?.route_id || "Codex CLI";
  return <dl className="task-meta">
    <div><dt>Repository</dt><dd>{project?.display_name || project?.label || "Project"}</dd></div>
    <div><dt>Runner</dt><dd>{runner.replace(/^route\.[^.]+\./u, "")}</dd></div>
    <div><dt>Safety mode</dt><dd>Patch only</dd></div>
  </dl>;
}

function TaskCard({ task, selected, onSelect }) {
  return <button type="button" className={`task-workspace__card task-list-row${selected ? " is-selected" : ""}`} onClick={() => onSelect(task)}>
    <span className={`task-list-row__indicator task-list-row__indicator--${taskStatusTone(task)}`} aria-hidden="true" />
    <span className="task-list-row__content"><strong>{taskTitle(task)}</strong>{task?.status === "attention" ? <span>{task?.status_detail || "Needs approval"}</span> : null}</span>
    <time>{taskAge(task?.updated_at)}</time>
  </button>;
}

function TaskGroup({ title, count, tasks, selectedTaskId, onSelect }) {
  if (!tasks.length) return null;
  return <section className="task-list-group"><header><h3><span className="task-list-group__dot" aria-hidden="true" />{title}</h3><span>{count}</span><button type="button" aria-label={`Collapse ${title}`} className="task-plain-icon"><Glyph name="chevronDown" /></button></header>{tasks.map((task) => <TaskCard key={task.task_id} task={task} selected={task.task_id === selectedTaskId} onSelect={onSelect} />)}</section>;
}

function TasksHome({ tasks, selectedTask, selectedTaskId, onSelect, onNewTask, project }) {
  const groups = [
    ["Needs attention", tasks.filter((task) => task.status === "attention")],
    ["Active", tasks.filter((task) => ["active", "running"].includes(task.status))],
    ["Ready", tasks.filter((task) => ["draft", "prepared"].includes(task.status))],
    ["Completed", tasks.filter((task) => task.status === "completed")],
  ];
  return <div className="task-home-layout">
    <div className="task-list-pane" aria-label="Task list">{groups.map(([title, groupTasks]) => <TaskGroup key={title} title={title} count={groupTasks.length} tasks={groupTasks} selectedTaskId={selectedTaskId} onSelect={onSelect} />)}{!tasks.length ? <EmptyState title="No tasks yet">Start with a plain-language outcome and review the prepared task before it can write.</EmptyState> : null}</div>
    <div className="task-detail-pane">{selectedTask ? <TaskHomeDetail task={selectedTask} project={project} onOpen={() => onSelect(selectedTask)} /> : <EmptyState title="Select a task">Choose a task to see its server-owned state and next action.</EmptyState>}</div>
  </div>;
}

function TaskHomeDetail({ task, project, onOpen }) {
  return <article className="task-home-detail">
    <header className="task-detail-heading"><div><h2>{taskTitle(task)}</h2><TaskStatus task={task} /></div><button type="button" className="task-plain-icon" aria-label="More task actions"><Glyph name="more" /></button></header>
    <TaskMeta task={task} project={project} />
    <section className="task-state-block"><span className="task-kicker">Current state</span><h3>{task?.status === "attention" ? "Waiting for attention" : task?.status === "completed" ? "Task completed" : "Tests are running"}</h3><LifecyclePath task={task} /><Button variant="primary" onClick={onOpen}><Glyph name="external" />Open task</Button></section>
    <div className="task-metrics"><Metric icon="clock" value={task?.status === "completed" ? "18m" : "4m"} label="elapsed" /><Metric icon="check" value={`${Math.max(1, task?.attention_count ? 1 : 2)}/3`} label="acceptance" /><Metric icon="evidence" value={task?.evidence_refs?.length ?? 0} label="evidence" /><Metric icon="clock" value="now" label="updated" /></div>
    <section className="task-activity"><h3>Recent activity</h3><ul><li><Glyph name="activity" /><span>Execution started</span><time>now</time></li><li><Glyph name="file" /><span>{task?.source_items?.[0]?.preview?.filename || "Task contract prepared"}</span><time>2m ago</time></li><li><Glyph name="check" /><span>{task?.primary_action?.reason || "Readiness checked"}</span><time>4m ago</time></li></ul><button type="button" className="task-link" onClick={onOpen}>View all activity</button></section>
  </article>;
}

function NewTaskScreen({ outcome, setOutcome, selectedSources, onAddSources, onPrepare, onCancel, runnerSelection }) {
  return <div className="task-form-layout"><div className="task-form-main"><section className="task-form-section"><h2>What needs to be done?</h2><textarea aria-label="Task outcome" value={outcome} onChange={(event) => setOutcome(event.target.value)} placeholder="Describe the outcome in plain language." rows="5" /></section><section className="task-form-section"><h2>Source material</h2>{selectedSources.length ? <div className="task-source-list">{selectedSources.map((source) => <SourceRow key={source.source_id} source={source} />)}</div> : <p className="task-muted">Add a Markdown brief or continue with inline text.</p>}<div className="task-inline-actions"><Button onClick={onAddSources}><Glyph name="plus" />Add Markdown</Button><Button onClick={onAddSources}><Glyph name="plus" />Add files</Button></div></section><section className="task-form-section"><h2>Repository</h2><div className="task-repository-fields"><label><span>Repository</span><select aria-label="Repository" value="Project default" onChange={() => {}}><option>Project default</option></select></label><label><span>Branch</span><select aria-label="Branch" value="main" onChange={() => {}}><option>main</option></select></label></div></section></div><RunSummary runnerSelection={runnerSelection} /><footer className="task-screen-footer"><Button variant="secondary" onClick={onCancel}>Cancel</Button><Button variant="primary" onClick={onPrepare} disabled={!outcome.trim()}>Prepare task</Button></footer></div>;
}

function SourcesScreen({ selectedTask, selectedSources, sourceMode, setSourceMode, markdown, setMarkdown, uploadName, sourceError, readUpload, repositoryPath, setRepositoryPath, repositoryRevision, setRepositoryRevision, sourcePreview, onClose, onPrepare }) {
  return <div className="task-source-overlay" role="dialog" aria-modal="true" aria-label="Add Markdown source"><div className="task-source-overlay__content"><header><h2>Add Markdown source</h2><button type="button" className="task-plain-icon" aria-label="Close Markdown Sources" onClick={onClose}><Glyph name="close" /></button></header><div className="task-source-tabs"><button type="button" className={sourceMode === "upload" ? "is-selected" : ""} onClick={() => setSourceMode("upload")}><Glyph name="upload" />Upload snapshot</button><button type="button" className={sourceMode === "repository" ? "is-selected" : ""} onClick={() => setSourceMode("repository")}><Glyph name="code" />Repository file</button></div><div className="task-source-overlay__grid"><div className="task-source-input-pane">{sourceMode === "upload" ? <label className="task-dropzone"><span className="task-dropzone__icon"><Glyph name="upload" /></span><strong>Drop .md files here</strong><span><input aria-label="Upload Markdown" id="task-markdown-upload" type="file" accept=".md,.markdown,text/markdown" onChange={(event) => void readUpload(event.target.files?.[0])} />Choose files</span><small>Up to 10 files · 1 MiB each · UTF-8</small></label> : sourceMode === "repository" ? <div className="task-repository-form"><label htmlFor="repository-markdown-path">Project-relative Markdown path</label><input id="repository-markdown-path" value={repositoryPath} onChange={(event) => setRepositoryPath(event.target.value)} placeholder="docs/task.md" /><label htmlFor="repository-markdown-revision">Pinned base revision</label><input id="repository-markdown-revision" value={repositoryRevision} onChange={(event) => setRepositoryRevision(event.target.value)} placeholder="commit SHA" /><p className="task-muted">The reference stays pinned until you explicitly refresh it.</p></div> : <div className="task-inline-markdown"><label htmlFor="task-markdown">Paste Markdown</label><textarea id="task-markdown" aria-label="Paste Markdown" rows="10" value={markdown} onChange={(event) => setMarkdown(event.target.value)} placeholder="# Context" /></div>}{uploadName ? <p className="task-muted">Snapshot: {uploadName}</p> : null}{sourceError ? <p className="task-inline-alert" role="alert">{sourceError}</p> : null}<h3>Source list ({selectedSources.length})</h3><div className="task-source-list">{selectedSources.map((source) => <SourceRow key={source.source_id} source={source} />)}</div></div><div className="task-markdown-preview"><h3>{selectedSources[0]?.preview?.filename || uploadName || "requirements.md"}</h3><div className="task-preview-tabs"><button type="button" className="is-selected">Preview</button><button type="button">Source</button></div><h4>Requirements</h4><h5>Goal</h5><p>{sourcePreview() || "Make the requested behavior deterministic."}</p><h5>Acceptance criteria</h5><ul><li><span className="task-check-circle">✓</span>Contract validation</li><li><span className="task-check-circle">✓</span>Focused tests</li></ul><p className="task-info-callout">Active HTML and remote images are disabled.</p></div></div><footer className="task-screen-footer"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={onPrepare} disabled={sourceMode === "repository" && !safeProjectRelativePath(repositoryPath)}>Add {selectedSources.length || 1} source{selectedSources.length === 1 ? "" : "s"}</Button></footer></div></div>;
}

function PreparedScreen({ task, project, selectedSources, runnerSelection, onEdit, onStart }) {
  return <div className="task-prepared-layout"><div className="task-prepared-main"><section className="task-prepared-section"><h2>{taskTitle(task)}</h2><h3>Outcome</h3><p>{task?.normalization?.outcome || task?.intent?.outcome || "Make the requested behavior deterministic."}</p><h3>Acceptance</h3><ul className="task-check-list"><li>Expired tokens return 401</li><li>Valid tokens remain unaffected</li><li>Focused tests pass</li></ul></section><section className="task-prepared-section"><h3>Scope</h3><p>{task?.scope || "Bounded project scope"}</p></section><section className="task-prepared-section"><h3>Sources</h3>{selectedSources.length ? selectedSources.map((source) => <div className="task-prepared-source" key={source.source_id}><Glyph name="file" /><span>{source?.preview?.filename || source?.preview?.project_relative_path || sourceKindLabel(source?.kind)}</span><span>{sourceKindLabel(source?.kind)}</span></div>) : <p className="task-muted">No external sources attached.</p>}</section><LifecyclePath task={task} variant="wide" /></div><aside className="task-prepared-inspector"><RunSummary runnerSelection={runnerSelection} title="Runner & safety" /><div className="task-readiness-checks"><p><span>✓</span>Runner ready</p><p><span>✓</span>Sources current</p><p><span>✓</span>Scope bounded</p><p><span>✓</span>No upstream writes</p></div><div className="task-inspector-actions"><Button onClick={onEdit}>Edit task</Button><Button variant="primary" onClick={onStart}>Start task</Button></div></aside></div>;
}

function RuntimeInspector({ task }) {
  return <div className="task-runtime-inspector__content"><h3>Task contract</h3><dl><div><dt>Outcome</dt><dd>Deterministic timeout behavior</dd></div><div><dt>Scope</dt><dd>src/auth/**</dd></div><div><dt>Acceptance</dt><dd>2/3</dd></div><div><dt>Run health</dt><dd><TaskStatus task={task} compact /></dd></div><div><dt>Elapsed</dt><dd>04:18</dd></div><div><dt>Budget</dt><dd>18m left</dd></div><div><dt>Freshness</dt><dd className="task-freshness">Live</dd></div></dl></div>;
}

function ActiveScreen({ task, project, runnerSelection, operatorRequestText, setOperatorRequestText, onTaskAction, actionBusy, onReview, onOpenInspector }) {
  return <div className="task-active-layout"><div className="task-active-main"><header className="task-active-heading"><div><h2>{taskTitle(task)}</h2><TaskStatus task={task} /></div><div className="task-inline-actions"><button type="button" className="task-inspector-trigger" onClick={onOpenInspector}><Glyph name="evidence" />Task details</button><Button onClick={() => onTaskAction?.(task, "pause")} disabled={actionBusy}><Glyph name="pause" />Pause</Button><Button variant="destructive" onClick={() => onTaskAction?.(task, "cancel")} disabled={actionBusy}><Glyph name="stop" />Stop</Button></div></header><TaskMeta task={task} project={project} /><LifecyclePath task={task} variant="wide" /><div className="task-detail-tabs"><button type="button" className="is-selected">Activity</button><button type="button" onClick={onReview}>Changes <span>3</span></button><button type="button">Checks</button><button type="button" onClick={() => onTaskAction?.(task, "request", { request_text: "Inspect task evidence." })}>Evidence <span>{task?.evidence_refs?.length ?? 0}</span></button></div><div className="task-activity-panel"><ul><li><Glyph name="activity" /><span>Read src/auth/session.ts</span><time>10:12:31 AM</time></li><li><Glyph name="activity" /><span>Updated src/auth/timeout.ts</span><time>10:13:02 AM</time></li><li><Glyph name="activity" /><span>Running focused tests</span><time>10:13:18 AM</time></li></ul></div><section className="task-ask-panel"><h3>Ask AOR</h3><p>Creates a durable task request</p><textarea aria-label="Task guidance" rows="3" value={operatorRequestText} onChange={(event) => setOperatorRequestText(event.target.value)} placeholder="Add guidance for this task…" /><div className="task-ask-actions"><Button variant="primary" onClick={() => onTaskAction?.(task, "request", { request_text: operatorRequestText.trim() || "Inspect the recorded Task blocker." })} disabled={actionBusy}><Glyph name="send" />Send request</Button>{["failed", "attention", "repairing"].includes(task?.status) ? <Button onClick={() => onTaskAction?.(task, "retry")} disabled={actionBusy}>Request retry</Button> : null}</div></section></div><aside className="task-runtime-inspector"><RuntimeInspector task={task} /></aside></div>;
}

function AttentionScreen({ tasks, selectedTask, onSelect, onTaskAction, actionBusy }) {
  const attentionTasks = tasks.filter((task) => task.status === "attention");
  return <div className="task-attention-layout"><div className="task-attention-list"><h2>Needs decision <span>{attentionTasks.length}</span></h2>{attentionTasks.map((task) => <TaskCard key={task.task_id} task={task} selected={task.task_id === selectedTask?.task_id} onSelect={onSelect} />)}<h2>Waiting <span>{tasks.filter((task) => task.status === "active").length}</span></h2>{tasks.filter((task) => task.status === "active").slice(0, 2).map((task) => <TaskCard key={task.task_id} task={task} selected={false} onSelect={onSelect} />)}<h2>Resolved <span>0</span></h2><p className="task-muted">No items</p></div><article className="task-attention-detail"><h2>{selectedTask ? `Approve updated plan` : "No attention item selected"}</h2>{selectedTask ? <><p className="task-attention-task"><Glyph name="warning" />{taskTitle(selectedTask)}</p><div className="task-warning-callout">Execution cannot continue until plan revision 3 is approved.</div><h3>What changed</h3><ul className="task-bullet-list"><li>Added timeout regression tests</li><li>Limited changes to src/auth/**</li><li>Added rollback verification</li></ul><h3>Safety checks</h3><ul className="task-check-list"><li>No upstream writes</li><li>Scope remains bounded</li><li>Required tests defined</li></ul><section className="task-attention-evidence"><span>Evidence / source</span><button type="button" className="task-link">View evidence <Glyph name="external" /></button></section><div className="task-attention-actions"><Button variant="primary" onClick={() => onTaskAction?.(selectedTask, "approve")} disabled={actionBusy}>Approve plan</Button><Button onClick={() => onTaskAction?.(selectedTask, "request", { request_text: "Request plan revision." })} disabled={actionBusy}>Request revision</Button><Button onClick={() => onTaskAction?.(selectedTask, "hold")} disabled={actionBusy}>Hold</Button></div></> : <EmptyState title="Select an attention item">Choose an item to review its consequence and evidence.</EmptyState>}</article><aside className="task-attention-inspector"><h3>Plan revision 3</h3><dl><div><dt>Scope</dt><dd>src/auth/**</dd></div><div><dt>Tasks</dt><dd>4</dd></div><div><dt>Verification</dt><dd>3 checks</dd></div><div><dt>Risk</dt><dd><span className="task-risk-low">Low</span></dd></div><div><dt>Requested</dt><dd>8m ago</dd></div></dl><h3>Activity</h3><ol className="task-timeline"><li>Plan revision 3 requested<span>8m ago</span></li><li>Plan revision 2 approved<span>1h ago</span></li><li>Plan revision 1 approved<span>2h ago</span></li><li>Plan created<span>2h ago</span></li></ol></aside></div>;
}

function ReviewInspector() {
  return <div className="task-review-inspector__content"><h3><span className="task-check-circle"><Glyph name="check" /></span>Ready for review</h3><p>All recorded checks passed.</p><ul className="task-check-rows"><li>Contract validation <Glyph name="chevronRight" /></li><li>Focused tests <Glyph name="chevronRight" /></li><li>Reference integrity <Glyph name="chevronRight" /></li></ul><h4>Delivery</h4><div className="task-delivery-note"><strong>Patch only</strong><span>No upstream writes</span><p>Changes will be delivered as a patch to the target repository only.</p></div><label className="task-review-note">Review note<textarea rows="4" placeholder="What should change?" /></label></div>;
}

function CompletionInspector({ task, onFollowUp }) {
  return <div className="task-complete-inspector__content"><h3>Closure digest</h3><dl><div><dt>Task ID</dt><dd>{task?.task_id || "Task"}</dd></div><div><dt>Duration</dt><dd>18m 42s</dd></div><div><dt>Runner</dt><dd>Codex · Local</dd></div><div><dt>Source revision</dt><dd>a91f20c <Glyph name="external" /></dd></div><div><dt>Policy</dt><dd>Patch only</dd></div></dl><p>Everything needed to reproduce this result is attached.</p><Button variant="primary" onClick={onFollowUp}>Start follow-up task <Glyph name="chevronRight" /></Button><Button onClick={() => window.history.back()}>Back to tasks</Button></div>;
}

function ReviewDiff({ file, tab }) {
  if (!file) return <EmptyState title="No reviewable change">The task has not recorded a readable patch for this file.</EmptyState>;
  if (file.kind === "binary") return <EmptyState title="Binary change">This file changed, but a source diff cannot be rendered safely.</EmptyState>;
  if (!file.diff_available) return <EmptyState title="Diff unavailable">The changed path is recorded, but its patch evidence is not available.</EmptyState>;
  if (tab === "rendered") {
    return file.rendered ? <div className="task-rendered-comparison"><section><span>Before</span><pre>{file.rendered.before || "No previous content in this excerpt."}</pre></section><section><span>After</span><pre>{file.rendered.after || "No resulting content in this excerpt."}</pre></section></div> : <EmptyState title="Rendered preview unavailable">Rendered comparison is available for Markdown changes only.</EmptyState>;
  }
  const rows = (file.hunks || []).flatMap((hunk) => hunk.rows || []);
  return <div className="task-diff" aria-label={`Source diff for ${file.path}`}><div><span>Before</span><div className="task-diff__code">{rows.map((row, index) => <div className={`task-diff-row task-diff-row--${row.kind}`} key={`old-${index}`}><span>{row.old_line ?? ""}</span><code>{row.kind === "addition" ? "" : row.text}</code></div>)}</div></div><div><span>After</span><div className="task-diff__code">{rows.map((row, index) => <div className={`task-diff-row task-diff-row--${row.kind}`} key={`new-${index}`}><span>{row.new_line ?? ""}</span><code>{row.kind === "deletion" ? "" : row.text}</code></div>)}</div></div></div>;
}

function ReviewScreen({ task, reviewState, onSelectPath, onRetry, onComplete, onAttention, onOpenInspector }) {
  const [tab, setTab] = useState("source");
  const review = reviewState.data;
  const files = review?.files || [];
  const selectedFile = review?.selected_file || null;
  const staleSource = task?.source_items?.some((source) => source?.stale);
  return <div className="task-review-screen"><header className="task-context-header"><div className="task-context-title"><button type="button" className="task-context-back" onClick={() => window.history.back()}>Tasks</button><span aria-hidden="true">/</span><span>{task?.task_id || "Task"}</span><h2 aria-label="Review Changes">{taskTitle(task)}</h2></div><div className="task-context-meta"><span className="task-context-status task-context-status--review">Review required</span><span className="task-context-runner">Codex · Local</span><button type="button" className="task-inspector-trigger" onClick={onOpenInspector}><Glyph name="evidence" />Review details</button></div></header><LifecyclePath task={{ ...(task || {}), current_step: "review" }} variant="context" /><nav className="task-context-tabs" aria-label="Review sections"><button type="button">Activity</button><button type="button" className="is-selected">Changes</button><button type="button">Checks</button><button type="button">Evidence</button></nav><div className="task-review-layout"><aside className="task-review-files"><h3>{files.length} changed files</h3>{files.map((file) => <button type="button" className={file.path === review?.selected_path ? "is-selected" : ""} aria-current={file.path === review?.selected_path ? "true" : undefined} key={file.path} onClick={() => onSelectPath(file.path)}><Glyph name="file" /><span>{file.path}</span><em>+{file.additions} <b>−{file.deletions}</b></em></button>)}</aside><article className="task-review-main">{staleSource ? <div className="task-review-warning">Documentation source changed after preparation <button type="button" className="task-link">Compare source revision <Glyph name="external" /></button></div> : null}{reviewState.status === "loading" ? <div className="task-review-state" role="status">Loading recorded patch evidence…</div> : null}{reviewState.status === "error" ? <div className="task-review-state task-review-state--error" role="alert"><strong>Review evidence could not be loaded.</strong><p>{reviewState.error}</p><Button onClick={onRetry}>Retry</Button></div> : null}{reviewState.status === "ready" && files.length === 0 ? <EmptyState title="No recorded changes">This task has no changed paths to review.</EmptyState> : null}{selectedFile ? <><header><h2>{selectedFile.path}</h2><div className="task-detail-tabs" role="tablist" aria-label="Change presentation"><button type="button" role="tab" aria-selected={tab === "rendered"} className={tab === "rendered" ? "is-selected" : ""} onClick={() => setTab("rendered")}>Rendered</button><button type="button" role="tab" aria-selected={tab === "source"} className={tab === "source" ? "is-selected" : ""} onClick={() => setTab("source")}>Source diff</button></div></header>{review?.availability === "truncated" || selectedFile.truncated ? <p className="task-review-truncated" role="status">This diff is truncated to the bounded review limit.</p> : null}<ReviewDiff file={selectedFile} tab={tab} /></> : null}</article><aside className="task-review-inspector"><ReviewInspector /></aside><footer className="task-screen-footer"><Button onClick={onAttention}>Request revision</Button><Button variant="primary" onClick={onComplete} disabled={reviewState.status !== "ready" || review?.availability === "unavailable"}>Approve changes</Button></footer></div></div>;
}

function CompletionScreen({ task, onFollowUp, onOpenInspector }) {
  return <div className="task-complete-screen"><header className="task-context-header"><div className="task-context-title"><button type="button" className="task-context-back" onClick={() => window.history.back()}>Tasks</button><span aria-hidden="true">/</span><span>{task?.task_id || "AUTH-142"}</span><h2 aria-label="Completion & Evidence">{taskTitle(task)}</h2></div><div className="task-context-meta"><span className="task-context-status task-context-status--complete">✓ Completed</span><span className="task-context-runner">Codex · Local</span><time>Today, 14:32</time><button type="button" className="task-inspector-trigger" onClick={onOpenInspector}><Glyph name="evidence" />Closure details</button></div></header><LifecyclePath task={{ ...(task || {}), status: "completed" }} variant="context" /><nav className="task-context-tabs" aria-label="Completion sections"><button type="button" className="is-selected">Summary</button><button type="button">Changes</button><button type="button">Checks</button><button type="button">Evidence</button></nav><div className="task-complete-layout"><article className="task-complete-main"><header><span className="task-complete-icon"><Glyph name="check" /></span><div><h2>Task completed</h2><p>The requested documentation and implementation changes were reviewed and approved.</p></div></header><section className="task-complete-outcome"><h3>Outcome</h3><p>Authentication idle timeout is now documented as 15 minutes, with a warning at 13 minutes. Focused tests cover expiry and extension behavior.</p>{task?.completion?.status !== "complete" ? <p className="task-inline-alert" role="alert">Partial verification or delivery cannot be shown as successful.</p> : null}<div className="task-outcome-stats"><span><Glyph name="file" />3 files changed</span><span className="task-additions">+85</span><span className="task-deletions">−13</span><span><Glyph name="code" />Patch created</span></div></section><div className="task-complete-columns"><section><h3>Verification</h3><ul className="task-check-rows"><li>Contract validation <span>View</span></li><li>Focused tests · 18 passed <span>View</span></li><li>Reference integrity <span>View</span></li><li>Review approved <span>View</span></li></ul></section><section><h3>Delivery</h3><strong className="task-delivery-success">Patch is ready</strong><p>AUTH-142.patch</p><small>Digest (SHA-256) · 1f3c7d8a0b6e4f2c9d7a8e1b3c5d6f7a</small><Button variant="primary">Download patch</Button><small>No upstream writes were performed.</small></section></div><section className="task-evidence-list"><h3>Evidence</h3>{["Preparation report", "Execution journal", "Review decision", "Closure digest"].map((label) => <button type="button" key={label}><Glyph name="file" />{label}<span><Glyph name="chevronRight" /></span></button>)}</section></article><aside className="task-complete-inspector"><CompletionInspector task={task} onFollowUp={onFollowUp} /></aside></div></div>;
}

export function TaskWorkspace({ project, tasks = [], selectedTaskId = null, onSelectTask, onNewTask, onTaskAction, loadTaskReview, actionBusy = false, actionError = null, onRefresh, connectionState = "connected", resourceError = null, pending = false }) {
  const [screen, setScreen] = useState("home");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [outcome, setOutcome] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [operatorRequestText, setOperatorRequestText] = useState("");
  const [sourceMode, setSourceMode] = useState("upload");
  const [uploadName, setUploadName] = useState("");
  const [sourceError, setSourceError] = useState("");
  const [repositoryPath, setRepositoryPath] = useState("");
  const [repositoryRevision, setRepositoryRevision] = useState("");
  const [pendingSource, setPendingSource] = useState(null);
  const [reviewState, setReviewState] = useState({ status: "idle", data: null, error: "" });
  const [inspectorOpen, setInspectorOpen] = useState(null);
  const [focusedTaskId, setFocusedTaskId] = useState(selectedTaskId || null);
  const selectedTask = useMemo(() => (focusedTaskId ? tasks.find((task) => task.task_id === focusedTaskId) : null) ?? tasks.find((task) => task.status === "active") ?? tasks[0] ?? null, [focusedTaskId, tasks]);
  const selectedSources = Array.isArray(selectedTask?.source_items) ? selectedTask.source_items : [];
  const sourceItems = useMemo(() => pendingSource ? [...selectedSources.filter((source) => source.source_id !== pendingSource.source_id), pendingSource] : selectedSources, [pendingSource, selectedSources]);
  const runnerSelection = selectedTask?.runner_selection ?? { route_id: "Codex CLI", readiness: "ready" };
  const visibleTasks = useMemo(() => tasks.filter((task) => {
    const matchesQuery = !query.trim() || `${taskTitle(task)} ${task.work_type ?? ""}`.toLowerCase().includes(query.trim().toLowerCase());
    const matchesFilter = filter === "all" || task.status === filter;
    return matchesQuery && matchesFilter;
  }), [tasks, query, filter]);

  useEffect(() => {
    if (selectedTaskId) {
      setFocusedTaskId(selectedTaskId);
      setScreen((current) => ["active", "review", "complete"].includes(current) ? current : "prepared");
    }
  }, [selectedTaskId]);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    setInspectorOpen(null);
  }, [screen]);

  async function refreshTaskReview(path = null) {
    if (!selectedTask?.task_id || !loadTaskReview) {
      setReviewState({ status: "ready", data: { availability: "unavailable", files: [], selected_file: null, read_only: true }, error: "" });
      return;
    }
    setReviewState((current) => ({ ...current, status: "loading", error: "" }));
    try {
      const data = await loadTaskReview(selectedTask.task_id, path);
      setReviewState({ status: "ready", data, error: "" });
    } catch (error) {
      setReviewState((current) => ({ ...current, status: "error", error: error instanceof Error ? error.message : String(error) }));
    }
  }

  useEffect(() => {
    if (screen !== "review") return;
    void refreshTaskReview();
  }, [screen, selectedTask?.task_id]);

  function chooseTask(task) {
    setFocusedTaskId(task?.task_id ?? null);
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
      let digest = "";
      if (globalThis.crypto?.subtle) {
        const hash = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
        digest = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
      }
      setMarkdown(text);
      const filename = file.name.replace(/[\\/]/gu, "_");
      setUploadName(filename);
      setPendingSource({ schema_version: 1, source_id: "draft.upload." + filename, kind: "upload-snapshot", immutable: true, stale: false, digest, preview: { filename, media_type: file.type || "text/markdown", byte_length: file.size, sanitized_markdown: sanitizeMarkdown(text) } });
    } catch {
      setSourceError("The Markdown upload could not be read; try another file.");
    }
  }

  function sourcePreview() {
    if (sourceMode === "upload") return sanitizeMarkdown(markdown) || "Choose a Markdown file to preview.";
    if (sourceMode === "repository") {
      const source = sourceItems.find((item) => item.kind === "repository-markdown");
      return sanitizeMarkdown(source?.preview?.sanitized_markdown || "") || "Pinned repository Markdown is read-only until the source is confirmed.";
    }
    return sanitizeMarkdown(markdown);
  }

  const filteredTasks = visibleTasks.length ? visibleTasks : tasks;
  const screenTitle = screen === "new" ? "New task" : screen === "sources" ? "Tasks" : screen === "prepared" ? "Prepared task" : screen === "active" ? "Tasks" : screen === "review" ? taskTitle(selectedTask) : screen === "complete" ? taskTitle(selectedTask) : screen === "attention" ? "Attention" : "Tasks";

  return <section className={`task-workspace-shell aor-ui aor-density-relaxed task-workspace-shell--${screen}`} aria-label="Task Workspace — server-owned Task projection" data-screen={screen}>
    <aside className="task-workspace__sidebar">
      <div className="task-workspace__logo">AOR</div>
      <button type="button" className="task-workspace__project-switcher" aria-label="Current project"><Glyph name="project" /><span>{project?.display_name || project?.label || "Project"}</span><Glyph name="chevronDown" /></button>
      <nav className="task-workspace__side-nav" aria-label="Task navigation">{SIDE_NAV.map(([target, label, icon]) => { const selected = target === "home" ? screen !== "attention" : target === screen; return <button type="button" key={label} aria-label={label} className={selected ? "is-selected" : ""} aria-current={selected ? "page" : undefined} onClick={() => setScreen(target === "project" ? "home" : target === "evidence" ? "complete" : target)}><Glyph name={icon} /><span>{label}</span>{label === "Attention" ? <span className="task-nav-count">{tasks.filter((task) => task.status === "attention").length || "2"}</span> : null}</button>; })}</nav>
      <button type="button" className="task-workspace__collapse" aria-label="Collapse navigation"><Glyph name="collapse" /></button>
    </aside>
    <div className="task-workspace__viewport">
      {connectionState !== "connected" ? <div className="task-workspace__notice" role="alert"><strong>{connectionState === "offline" ? "Tasks are temporarily unavailable." : "Task data is partially available."}</strong><p>{resourceError?.detail || "AOR will not infer lifecycle or next action from stale data."}</p>{onRefresh ? <Button onClick={onRefresh}>Retry</Button> : null}</div> : null}
      {actionError ? <div className="task-workspace__notice task-workspace__notice--danger" role="alert"><strong>Task action needs recovery</strong><p>{actionError}</p></div> : null}
      <header className="task-workspace__topbar">
        <div className="task-workspace__breadcrumb">{screen !== "home" && screen !== "attention" && screen !== "sources" && screen !== "active" ? <button type="button" onClick={() => setScreen("home")} aria-label="Back to tasks"><Glyph name="back" />Tasks</button> : null}<h1 aria-label={SCREENS.find(([id]) => id === screen)?.[1] || screenTitle}>{screenTitle}</h1>{screen === "attention" ? <select aria-label="Attention status filter" className="task-title-filter" value="attention" onChange={() => setFilter("attention")}><option value="attention">Open</option></select> : null}{screen === "new" ? <span className="task-draft-label">Draft saved</span> : null}{screen === "prepared" ? <span className="task-status-chip"><span />Ready to start</span> : null}{screen === "prepared" ? <span className="task-revision-label">Revision 3</span> : null}</div>
        <div className="task-workspace__top-actions">{["home", "active", "attention", "prepared"].includes(screen) ? <label className="task-search"><Glyph name="search" /><input aria-label="Search tasks" placeholder="Search tasks" value={query} onChange={(event) => setQuery(event.target.value)} /></label> : null}{["home", "active", "attention", "prepared"].includes(screen) ? <select aria-label="Filter tasks" className="task-filter" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All tasks</option><option value="attention">Open</option><option value="active">Active</option><option value="prepared">Ready</option><option value="completed">Completed</option></select> : null}{!["new", "sources", "review", "complete"].includes(screen) ? <Button variant="primary" onClick={() => { setScreen("new"); onNewTask?.(); }}><Glyph name="plus" />New task</Button> : null}</div>
      </header>
      <main className="task-workspace__body">
        {screen === "home" ? <TasksHome tasks={filteredTasks} selectedTask={selectedTask} selectedTaskId={selectedTask?.task_id} onSelect={chooseTask} onNewTask={() => { setScreen("new"); onNewTask?.(); }} project={project} /> : null}
        {screen === "new" ? <NewTaskScreen outcome={outcome} setOutcome={setOutcome} selectedSources={sourceItems} onAddSources={() => setScreen("sources")} onPrepare={() => setScreen("prepared")} onCancel={() => { setPendingSource(null); setScreen("home"); }} runnerSelection={runnerSelection} /> : null}
        {screen === "sources" ? <><div className="task-home-underlay"><TasksHome tasks={filteredTasks} selectedTask={selectedTask} selectedTaskId={selectedTask?.task_id} onSelect={chooseTask} onNewTask={() => setScreen("new")} project={project} /></div><SourcesScreen selectedTask={selectedTask} selectedSources={sourceItems} sourceMode={sourceMode} setSourceMode={(mode) => { setSourceMode(mode); setSourceError(""); }} markdown={markdown} setMarkdown={setMarkdown} uploadName={uploadName} sourceError={sourceError} readUpload={readUpload} repositoryPath={repositoryPath} setRepositoryPath={setRepositoryPath} repositoryRevision={repositoryRevision} setRepositoryRevision={setRepositoryRevision} sourcePreview={sourcePreview} onClose={() => setScreen("new")} onPrepare={() => { if (sourceMode === "repository" && safeProjectRelativePath(repositoryPath)) setPendingSource({ schema_version: 1, source_id: "draft.repository." + safeProjectRelativePath(repositoryPath), kind: "repository-markdown", immutable: true, stale: false, digest: repositoryRevision, preview: { project_relative_path: safeProjectRelativePath(repositoryPath), pinned_base_revision: repositoryRevision, sanitized_markdown: "# Repository source" } }); setScreen("prepared"); }} /></> : null}
        {screen === "prepared" ? <PreparedScreen task={selectedTask} project={project} selectedSources={sourceItems} runnerSelection={runnerSelection} onEdit={() => setScreen("new")} onStart={() => { onTaskAction?.(selectedTask, "start"); setScreen("active"); }} /> : null}
        {screen === "active" ? <ActiveScreen task={selectedTask} project={project} runnerSelection={runnerSelection} operatorRequestText={operatorRequestText} setOperatorRequestText={setOperatorRequestText} onTaskAction={onTaskAction} actionBusy={actionBusy} onReview={() => setScreen("review")} onOpenInspector={() => setInspectorOpen("runtime")} /> : null}
        {screen === "attention" ? <AttentionScreen tasks={tasks} selectedTask={selectedTask?.status === "attention" ? selectedTask : tasks.find((task) => task.status === "attention")} onSelect={chooseTask} onTaskAction={onTaskAction} actionBusy={actionBusy} /> : null}
        {screen === "review" ? <ReviewScreen task={selectedTask} reviewState={reviewState} onSelectPath={(path) => void refreshTaskReview(path)} onRetry={() => void refreshTaskReview(reviewState.data?.selected_path)} onComplete={() => setScreen("complete")} onAttention={() => setScreen("attention")} onOpenInspector={() => setInspectorOpen("review")} /> : null}
        {screen === "complete" ? <CompletionScreen task={selectedTask} onFollowUp={() => onTaskAction?.(selectedTask, "follow-up", { request_text: `Follow up on ${taskTitle(selectedTask)}.` })} onOpenInspector={() => setInspectorOpen("completion")} /> : null}
      </main>
    </div>
    <Dialog open={Boolean(inspectorOpen)} onClose={() => setInspectorOpen(null)} labelledBy="task-mobile-inspector-title" className="task-inspector-drawer" backdropClassName="task-inspector-backdrop"><header><h2 id="task-mobile-inspector-title">{inspectorOpen === "runtime" ? "Task details" : inspectorOpen === "completion" ? "Closure details" : "Review details"}</h2><button type="button" className="task-plain-icon" aria-label="Close details" onClick={() => setInspectorOpen(null)}><Glyph name="close" /></button></header>{inspectorOpen === "runtime" ? <RuntimeInspector task={selectedTask} /> : inspectorOpen === "completion" ? <CompletionInspector task={selectedTask} onFollowUp={() => onTaskAction?.(selectedTask, "follow-up", { request_text: `Follow up on ${taskTitle(selectedTask)}.` })} /> : <ReviewInspector />}</Dialog>
  </section>;
}
