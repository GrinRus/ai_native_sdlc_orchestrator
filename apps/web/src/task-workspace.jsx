import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Dialog } from "./dialog.jsx";
import { Button, EmptyState, Icon, useRovingTabs } from "./ui/components.jsx";

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

const NEW_TASK_DRAFT_ID = "__new-task-draft__";

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

function hasSha256Digest(value) {
  return /^[a-f0-9]{64}$/iu.test(String(value ?? ""));
}

function completionEvidenceRefs(task) {
  return Array.isArray(task?.completion?.evidence_refs) ? task.completion.evidence_refs.filter(Boolean) : [];
}

function taskHasCompletionProof(task) {
  return task?.status === "completed"
    && task?.completion?.status === "complete"
    && task?.completion?.verification_status === "pass"
    && task?.completion?.delivery_status === "pass"
    && Boolean(String(task?.completion?.patch_ref ?? "").trim())
    && hasSha256Digest(task?.completion?.digest)
    && completionEvidenceRefs(task).length > 0;
}

function reviewHasRequiredChecks(review, reviewData) {
  const evidenceRefs = Array.isArray(review?.evidence_refs) && review.evidence_refs.length > 0
    ? review.evidence_refs
    : reviewData?.evidence_refs;
  return review?.verification_status === "pass"
    && review?.delivery_status === "pass"
    && reviewData?.availability === "available"
    && Array.isArray(evidenceRefs)
    && evidenceRefs.length > 0;
}

function taskDestination(task) {
  if (!task) return "home";
  if (taskHasCompletionProof(task)) return "complete";
  if (task.status === "attention") return "attention";
  if (task.status === "completed") return "complete";
  if (task.status === "prepared" || task.status === "draft") return "prepared";
  if (task.status === "active" || task.status === "running") {
    const actionId = String(task.primary_action?.action_id ?? "").toLowerCase();
    const step = String(task.current_step ?? task.current_step_label ?? "").toLowerCase();
    if (actionId.includes("prepare") || String(task.primary_action?.operator_control ?? "").toLowerCase().includes("prepare") || step.includes("discover") || step === "prepare") return "prepared";
    if (step.includes("review") || actionId.includes("review")) return "review";
    return "active";
  }
  return "home";
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

function TaskTabList({ label, tabs, selected, onSelect, className = "" }) {
  const { getTabProps } = useRovingTabs({ tabs, selected, onSelect });
  return <div className={className} role="tablist" aria-label={label}>{tabs.map((tab, index) => <button {...getTabProps(tab, index)} key={tab.id} type="button" role="tab" aria-selected={selected === tab.id} aria-controls={tab.controls} className={selected === tab.id ? "is-selected" : ""} onClick={() => onSelect(tab.id)}>{tab.label}{tab.count === undefined ? null : <span>{tab.count}</span>}</button>)}</div>;
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
  const currentLabel = String(task?.current_step ?? task?.current_step_label ?? "Execute").toLowerCase();
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

function SourceRow({ source, onRemove, detailed = false }) {
  const sourceLabel = source?.preview?.filename || source?.preview?.project_relative_path || sourceKindLabel(source?.kind);
  const sourceType = sourceKindLabel(source?.kind);
  const sourceSize = source?.preview?.byte_length ? `${Math.max(1, Math.round(source.preview.byte_length / 1024))} KB` : null;
  return <div className={`task-source-row${detailed ? " task-source-row--detailed" : ""}`}>
    <Glyph name="file" />
    <div className="task-source-row__name"><strong title={sourceLabel}>{sourceLabel}</strong>{detailed ? <span>{[sourceSize, sourceType].filter(Boolean).join(" · ")}</span> : sourceSize ? <span>{sourceSize}</span> : null}</div>
    <span className={`task-source-row__state${source?.stale ? " is-stale" : ""}`}><span aria-hidden="true">{source?.stale ? "!" : "✓"}</span>{source?.stale ? "Stale" : detailed ? "Valid" : sourceType}</span>
    {onRemove ? <button type="button" className="task-icon-button" aria-label={`Remove ${sourceLabel}`} onClick={() => onRemove(source)}><Glyph name="close" /></button> : <span className="task-source-row__menu" aria-hidden="true"><Glyph name="more" /></span>}
    {detailed && source?.digest ? <small className="task-source-row__digest" title={source.digest}>Digest: {digestLabel(source.digest)}</small> : null}
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
      <button type="button" className="task-change-runner" disabled title="Runner selection is read-only in this projection">Change runner</button>
      <p className="task-control-note">Runner selection is fixed by the current project projection.</p>
      <dl className="task-runner-details"><div><dt>Model</dt><dd>{model}</dd></div><div><dt>Reasoning</dt><dd>{reasoning}</dd></div><div><dt>Safety</dt><dd>Patch only</dd></div></dl>
      <p className="task-safety"><Glyph name="evidence" />No upstream writes</p>
      {runnerSelection?.unavailable_reason ? <p className="task-inline-alert" role="alert">{runnerSelection.unavailable_reason} {runnerSelection.recovery_action}</p> : null}
    </section>;
  }
  return <section className="task-run-summary" aria-label="Runner readiness">
    <h2>{title}</h2>
    <div className="task-run-field task-run-field--runner"><span>Runner</span><select aria-label="Runner" value={runnerLabel} disabled onChange={() => {}}><option>{runnerLabel}</option></select><span className={`task-readiness task-readiness--${readiness}`}><span className="task-readiness__dot" aria-hidden="true" />{readiness === "unavailable" ? "Unavailable" : readiness === "unknown" ? "Checking" : "Ready"}</span></div>
    <div className="task-run-field"><span>Model / effort</span><select aria-label="Model and reasoning effort" value={`${model} · ${reasoning}`} disabled onChange={() => {}}><option>{model} · {reasoning}</option></select></div>
    <div className="task-run-field"><span>Safety</span><select aria-label="Safety mode" value="Patch only" disabled onChange={() => {}}><option>Patch only</option></select></div>
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

function TaskGroup({ title, count, tasks, selectedTaskId, selectedTask, project, onSelect }) {
  const [collapsed, setCollapsed] = useState(false);
  if (!tasks.length) return null;
  const groupId = `task-group-${title.toLowerCase().replace(/[^a-z0-9]+/gu, "-")}`;
  return <section className="task-list-group" id={groupId}><header><h3><span className="task-list-group__dot" aria-hidden="true" />{title}</h3><span>{count}</span><button type="button" aria-label={`${collapsed ? "Expand" : "Collapse"} ${title}`} aria-expanded={!collapsed} aria-controls={groupId} className={`task-plain-icon${collapsed ? " is-collapsed" : ""}`} onClick={() => setCollapsed((value) => !value)}><Glyph name="chevronDown" /></button></header>{collapsed ? null : tasks.map((task) => <Fragment key={task.task_id}><TaskCard task={task} selected={task.task_id === selectedTaskId} onSelect={onSelect} />{task.task_id === selectedTaskId && selectedTask ? <div className="task-inline-mobile-detail"><TaskHomeDetail task={selectedTask} project={project} onOpen={() => onSelect(selectedTask)} /></div> : null}</Fragment>)}</section>;
}

function TasksHome({ tasks, selectedTask, selectedTaskId, onSelect, onNewTask, project, totalTaskCount = tasks.length }) {
  const groups = [
    ["Needs attention", tasks.filter((task) => task.status === "attention")],
    ["Active", tasks.filter((task) => ["active", "running"].includes(task.status))],
    ["Ready", tasks.filter((task) => ["draft", "prepared"].includes(task.status))],
    ["Completed", tasks.filter((task) => task.status === "completed")],
  ];
  return <div className="task-home-layout">
    <div className="task-list-pane" aria-label="Task list">{groups.map(([title, groupTasks]) => <TaskGroup key={title} title={title} count={groupTasks.length} tasks={groupTasks} selectedTaskId={selectedTaskId} selectedTask={selectedTask} project={project} onSelect={onSelect} />)}{!tasks.length ? <EmptyState title={totalTaskCount ? "No matching tasks" : "No tasks yet"}>{totalTaskCount ? "Try a different search or clear the filter." : "Start with a plain-language outcome and review the prepared task before it can write."}</EmptyState> : null}</div>
    <div className="task-detail-pane">{selectedTask ? <TaskHomeDetail task={selectedTask} project={project} onOpen={() => onSelect(selectedTask)} /> : <EmptyState title="Select a task">Choose a task to see its server-owned state and next action.</EmptyState>}</div>
  </div>;
}

function TaskHomeDetail({ task, project, onOpen }) {
  return <article className="task-home-detail">
    <header className="task-detail-heading"><div><h2>{taskTitle(task)}</h2><TaskStatus task={task} /></div><span className="task-plain-icon" aria-hidden="true"><Glyph name="more" /></span></header>
    <TaskMeta task={task} project={project} />
    <section className="task-state-block"><span className="task-kicker">Current state</span><h3>{task?.status === "attention" ? "Waiting for attention" : task?.status === "completed" ? "Task completed" : "Tests are running"}</h3><LifecyclePath task={task} /><Button variant="primary" onClick={onOpen}><Glyph name="external" />Open task</Button></section>
    <div className="task-metrics"><Metric icon="clock" value={task?.status === "completed" ? "18m" : "4m"} label="elapsed" /><Metric icon="check" value={`${Math.max(1, task?.attention_count ? 1 : 2)}/3`} label="acceptance" /><Metric icon="evidence" value={task?.evidence_refs?.length ?? 0} label="evidence" /><Metric icon="clock" value="now" label="updated" /></div>
    <section className="task-activity"><h3>Recent activity</h3><ul><li><Glyph name="activity" /><span>Execution started</span><time>now</time></li><li><Glyph name="file" /><span>{task?.source_items?.[0]?.preview?.filename || "Task contract prepared"}</span><time>2m ago</time></li><li><Glyph name="check" /><span>{task?.primary_action?.reason || "Readiness checked"}</span><time>4m ago</time></li></ul><button type="button" className="task-link" onClick={onOpen}>View all activity</button></section>
  </article>;
}

function ActiveTabPanel({ id, children }) {
  return <div id={`task-active-panel-${id}`} role="tabpanel" aria-labelledby={`task-active-tab-${id}`} tabIndex="0" className="task-activity-panel">{children}</div>;
}

function NewTaskScreen({ outcome, setOutcome, selectedSources, onAddSources, onPrepare, onCancel, runnerSelection }) {
  return <div className="task-form-layout"><div className="task-form-main"><section className="task-form-section"><h2>What needs to be done?</h2><textarea aria-label="Task outcome" value={outcome} onChange={(event) => setOutcome(event.target.value)} placeholder="Describe the outcome in plain language." rows="5" /></section><section className="task-form-section"><h2>Source material</h2>{selectedSources.length ? <div className="task-source-list">{selectedSources.map((source) => <SourceRow key={source.source_id} source={source} />)}</div> : <p className="task-muted">Add a Markdown brief or continue with inline text.</p>}<div className="task-inline-actions"><Button onClick={(event) => onAddSources?.(event.currentTarget)}><Glyph name="plus" />Add Markdown</Button><Button onClick={(event) => onAddSources?.(event.currentTarget)}><Glyph name="plus" />Add files</Button></div></section><section className="task-form-section"><h2>Repository</h2><div className="task-repository-fields"><label><span>Repository</span><select aria-label="Repository" value="Project default" disabled onChange={() => {}}><option>Project default</option></select></label><label><span>Branch</span><select aria-label="Branch" value="main" disabled onChange={() => {}}><option>main</option></select></label></div><p className="task-muted">Repository and branch follow the active project. Change them from project settings.</p></section></div><RunSummary runnerSelection={runnerSelection} /><footer className="task-screen-footer"><Button variant="secondary" onClick={onCancel}>Cancel</Button><Button variant="primary" onClick={onPrepare} disabled={!outcome.trim()}>Prepare task</Button></footer></div>;
}

function SourcesScreen({ selectedTask, selectedSources, sourceMode, setSourceMode, markdown, setMarkdown, uploadName, sourceError, readUpload, repositoryPath, setRepositoryPath, repositoryRevision, setRepositoryRevision, sourcePreview, openerRef, onClose, onPrepare }) {
  const [previewTab, setPreviewTab] = useState("preview");
  const preview = sourcePreview() || "Make the requested behavior deterministic.";
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const dialog = document.querySelector(".task-source-overlay");
    if (!dialog) return undefined;
    const opener = openerRef?.current?.isConnected ? openerRef.current : document.activeElement;
    const siblings = Array.from(dialog.parentElement?.children ?? []).filter((element) => element !== dialog);
    siblings.forEach((element) => {
      element.inert = true;
      element.setAttribute("aria-hidden", "true");
    });
    const focusable = () => Array.from(dialog.querySelectorAll("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"));
    const initialFocus = focusable()[0];
    initialFocus?.focus();
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    dialog.addEventListener("keydown", onKeyDown);
    return () => {
      dialog.removeEventListener("keydown", onKeyDown);
      siblings.forEach((element) => {
        element.inert = false;
        element.removeAttribute("aria-hidden");
      });
      if (opener?.isConnected && typeof opener.focus === "function") opener.focus();
    };
  }, []);
  return <div className="task-source-overlay" role="dialog" aria-modal="true" aria-label="Add Markdown source"><div className="task-source-overlay__content"><header><h2>Add Markdown source</h2><button type="button" className="task-plain-icon" aria-label="Close Markdown Sources" onClick={onClose}><Glyph name="close" /></button></header><TaskTabList label="Markdown source type" className="task-source-tabs" tabs={[{ id: "upload", label: <><Glyph name="upload" />Upload snapshot</>, controls: "task-source-upload-panel" }, { id: "repository", label: <><Glyph name="code" />Repository file</>, controls: "task-source-repository-panel" }]} selected={sourceMode} onSelect={setSourceMode} /><div className="task-source-overlay__grid"><div className="task-source-input-pane">{sourceMode === "upload" ? <label className="task-dropzone" id="task-source-upload-panel"><span className="task-dropzone__icon"><Glyph name="upload" /></span><strong>Drop .md files here</strong><span><input aria-label="Upload Markdown" id="task-markdown-upload" type="file" accept=".md,.markdown,text/markdown" onChange={(event) => void readUpload(event.target.files?.[0])} />Choose files</span><small>Up to 10 files · 1 MiB each · UTF-8</small></label> : sourceMode === "repository" ? <div className="task-repository-form" id="task-source-repository-panel"><label htmlFor="repository-markdown-path">Project-relative Markdown path</label><input id="repository-markdown-path" value={repositoryPath} onChange={(event) => setRepositoryPath(event.target.value)} placeholder="docs/task.md" /><label htmlFor="repository-markdown-revision">Pinned base revision</label><input id="repository-markdown-revision" value={repositoryRevision} onChange={(event) => setRepositoryRevision(event.target.value)} placeholder="commit SHA" /><p className="task-muted">The reference stays pinned until you explicitly refresh it.</p></div> : <div className="task-inline-markdown"><label htmlFor="task-markdown">Paste Markdown</label><textarea id="task-markdown" aria-label="Paste Markdown" rows="10" value={markdown} onChange={(event) => setMarkdown(event.target.value)} placeholder="# Context" /></div>}{uploadName ? <p className="task-muted">Snapshot: {uploadName}</p> : null}{sourceError ? <p className="task-inline-alert" role="alert">{sourceError}</p> : null}<h3>Source list ({selectedSources.length})</h3><div className="task-source-list">{selectedSources.map((source) => <SourceRow key={source.source_id} source={source} detailed />)}</div></div><div className="task-markdown-preview"><h3>{selectedSources[0]?.preview?.filename || uploadName || "requirements.md"}</h3><TaskTabList label="Source presentation" className="task-preview-tabs" tabs={[{ id: "preview", label: "Preview", controls: "task-preview-panel" }, { id: "source", label: "Source", controls: "task-preview-panel" }]} selected={previewTab} onSelect={setPreviewTab} />{previewTab === "preview" ? <div id="task-preview-panel"><h4>Requirements</h4><h5>Goal</h5><p>{preview}</p><h5>Acceptance criteria</h5><ul><li><span className="task-check-circle">✓</span>Contract validation</li><li><span className="task-check-circle">✓</span>Focused tests</li></ul><p className="task-info-callout">Active HTML and remote images are disabled.</p></div> : <pre id="task-preview-panel" className="task-markdown-source" aria-label="Sanitized Markdown source">{preview}</pre>}</div></div><footer className="task-screen-footer"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={onPrepare} disabled={sourceMode === "repository" && !safeProjectRelativePath(repositoryPath)}>Add {selectedSources.length || 1} source{selectedSources.length === 1 ? "" : "s"}</Button></footer></div></div>;
}

function PreparedScreen({ task, project, selectedSources, runnerSelection, onEdit, onStart, actionBusy, actionError }) {
  const serverOwned = Boolean(task?.task_id);
  return <div className="task-prepared-layout"><div className="task-prepared-main"><section className="task-prepared-section"><h2>{taskTitle(task)}</h2><h3>Outcome</h3><p>{task?.normalization?.outcome || task?.intent?.outcome || "Make the requested behavior deterministic."}</p><h3>Acceptance</h3><ul className="task-check-list"><li>Expired tokens return 401</li><li>Valid tokens remain unaffected</li><li>Focused tests pass</li></ul></section><section className="task-prepared-section"><h3>Scope</h3><p>{task?.scope || "Bounded project scope"}</p></section><section className="task-prepared-section"><h3>Sources</h3>{selectedSources.length ? selectedSources.map((source) => <div className="task-prepared-source" key={source.source_id}><Glyph name="file" /><span>{source?.preview?.filename || source?.preview?.project_relative_path || sourceKindLabel(source?.kind)}</span><span>{sourceKindLabel(source?.kind)}</span></div>) : <p className="task-muted">No external sources attached.</p>}</section><LifecyclePath task={task} variant="wide" /></div><aside className="task-prepared-inspector"><RunSummary runnerSelection={runnerSelection} title="Runner & safety" /><div className="task-readiness-checks"><p><span>✓</span>Runner ready</p><p><span>✓</span>Sources current</p><p><span>✓</span>Scope bounded</p><p><span>✓</span>No upstream writes</p></div>{actionError ? <p className="task-inline-alert" role="alert">{actionError}</p> : null}<div className="task-inspector-actions"><Button onClick={onEdit} disabled={actionBusy}>Edit task</Button><Button variant="primary" onClick={onStart} busy={actionBusy} disabled={!serverOwned || actionBusy}>{actionBusy ? "Starting task…" : "Start task"}</Button></div>{!serverOwned ? <p className="task-control-note" role="status">This is a local draft preview. Start becomes available after the server publishes a prepared Task.</p> : null}</aside></div>;
}

function RuntimeInspector({ task }) {
  return <div className="task-runtime-inspector__content"><h3>Task contract</h3><dl><div><dt>Outcome</dt><dd>Deterministic timeout behavior</dd></div><div><dt>Scope</dt><dd>src/auth/**</dd></div><div><dt>Acceptance</dt><dd>2/3</dd></div><div><dt>Run health</dt><dd><TaskStatus task={task} compact /></dd></div><div><dt>Elapsed</dt><dd>04:18</dd></div><div><dt>Budget</dt><dd>18m left</dd></div><div><dt>Freshness</dt><dd className="task-freshness">Live</dd></div></dl></div>;
}

function ActiveScreen({ task, project, operatorRequestText, setOperatorRequestText, onTaskAction, actionBusy, onReview, onOpenInspector }) {
  const [tab, setTab] = useState("activity");
  const [stopConfirm, setStopConfirm] = useState(false);
  const request = (action, payload) => onTaskAction?.(task, action, payload);
  return <div className="task-active-layout"><div className="task-active-main"><header className="task-active-heading"><div><h2>{taskTitle(task)}</h2><TaskStatus task={task} /></div><div className="task-inline-actions"><button type="button" className="task-inspector-trigger" onClick={onOpenInspector}><Glyph name="evidence" />Task details</button><Button onClick={() => request("pause")} disabled={actionBusy}><Glyph name="pause" />Pause</Button><Button variant="destructive" onClick={() => setStopConfirm(true)} disabled={actionBusy}><Glyph name="stop" />Stop</Button></div></header><TaskMeta task={task} project={project} /><LifecyclePath task={task} variant="wide" /><TaskTabList label="Task activity sections" className="task-detail-tabs" tabs={[{ id: "activity", label: "Activity", controls: "task-active-panel-activity" }, { id: "changes", label: "Changes", count: task?.review?.changed_paths?.length ?? 0, controls: "task-active-panel-changes" }, { id: "checks", label: "Checks", controls: "task-active-panel-checks" }, { id: "evidence", label: "Evidence", count: task?.evidence_refs?.length ?? 0, controls: "task-active-panel-evidence" }]} selected={tab} onSelect={(nextTab) => { setTab(nextTab); if (nextTab === "changes") onReview?.(); }} />{tab === "activity" ? <ActiveTabPanel id="activity"><ul><li><Glyph name="activity" /><span>Read src/auth/session.ts</span><time>10:12:31 AM</time></li><li><Glyph name="activity" /><span>Updated src/auth/timeout.ts</span><time>10:13:02 AM</time></li><li><Glyph name="activity" /><span>Running focused tests</span><time>10:13:18 AM</time></li></ul></ActiveTabPanel> : null}{tab === "changes" ? <ActiveTabPanel id="changes"><p>Recorded changes are ready for review.</p><Button onClick={onReview}>Open changes</Button></ActiveTabPanel> : null}{tab === "checks" ? <ActiveTabPanel id="checks"><ul><li><Glyph name="check" /><span>Verification</span><strong>{task?.review?.verification_status || "pending"}</strong></li><li><Glyph name="check" /><span>Delivery</span><strong>{task?.review?.delivery_status || "pending"}</strong></li></ul></ActiveTabPanel> : null}{tab === "evidence" ? <ActiveTabPanel id="evidence"><p>{task?.evidence_refs?.length ? "Durable evidence is attached to this task." : "No evidence has been recorded yet."}</p>{task?.evidence_refs?.length ? <ul>{task.evidence_refs.map((ref) => <li key={ref}><Glyph name="file" /><code>{ref}</code></li>)}</ul> : null}<Button onClick={onReview} disabled={!task?.review?.changed_paths?.length}>Open review evidence</Button></ActiveTabPanel> : null}<section className="task-ask-panel"><h3>Ask AOR</h3><p>Creates a durable task request</p><textarea aria-label="Task guidance" rows="3" value={operatorRequestText} onChange={(event) => setOperatorRequestText(event.target.value)} placeholder="Add guidance for this task…" /><div className="task-ask-actions"><Button variant="primary" onClick={() => request("request", { request_text: operatorRequestText.trim() || "Inspect the recorded Task blocker." })} busy={actionBusy}><Glyph name="send" />{actionBusy ? "Sending…" : "Send request"}</Button>{["failed", "attention", "repairing"].includes(task?.status) ? <Button onClick={() => request("retry")} disabled={actionBusy}>Request retry</Button> : null}</div></section></div><aside className="task-runtime-inspector"><RuntimeInspector task={task} /></aside>{stopConfirm ? <div className="task-inline-alert" role="alert"><strong>Stop this task?</strong><p>This requests a durable cancellation and may discard in-flight work.</p><div className="task-inline-actions"><Button onClick={() => setStopConfirm(false)}>Keep running</Button><Button variant="destructive" onClick={() => { setStopConfirm(false); request("cancel"); }} disabled={actionBusy}>Stop task</Button></div></div> : null}</div>;
}

function AttentionScreen({ tasks, selectedTask, onSelect, onTaskAction, actionBusy }) {
  const [showEvidence, setShowEvidence] = useState(false);
  const attentionTasks = tasks.filter((task) => task.status === "attention");
  return <div className="task-attention-layout"><div className="task-attention-list"><h2>Needs decision <span>{attentionTasks.length}</span></h2>{attentionTasks.map((task) => <TaskCard key={task.task_id} task={task} selected={task.task_id === selectedTask?.task_id} onSelect={onSelect} />)}<h2>Waiting <span>{tasks.filter((task) => task.status === "active").length}</span></h2>{tasks.filter((task) => task.status === "active").slice(0, 2).map((task) => <TaskCard key={task.task_id} task={task} selected={false} onSelect={onSelect} />)}<h2>Resolved <span>0</span></h2><p className="task-muted">No items</p></div><article className="task-attention-detail"><h2>{selectedTask ? "Approve updated plan" : "No attention item selected"}</h2>{selectedTask ? <><p className="task-attention-task"><Glyph name="warning" />{taskTitle(selectedTask)}</p><div className="task-warning-callout">Execution cannot continue until plan revision 3 is approved.</div><h3>What changed</h3><ul className="task-bullet-list"><li>Added timeout regression tests</li><li>Limited changes to src/auth/**</li><li>Added rollback verification</li></ul><h3>Safety checks</h3><ul className="task-check-list"><li>No upstream writes</li><li>Scope remains bounded</li><li>Required tests defined</li></ul><section className="task-attention-evidence"><span>Evidence / source</span><button type="button" className="task-link" onClick={() => setShowEvidence((value) => !value)}>{showEvidence ? "Hide evidence" : "View evidence"} <Glyph name="external" /></button>{showEvidence ? <div className="task-evidence-list"><p>Durable references</p>{(selectedTask.evidence_refs || []).map((ref) => <code key={ref}>{ref}</code>)}</div> : null}</section><div className="task-attention-actions"><Button variant="primary" onClick={() => onTaskAction?.(selectedTask, "confirm")} busy={actionBusy}>{actionBusy ? "Approving…" : "Approve plan"}</Button><Button onClick={() => onTaskAction?.(selectedTask, "request", { request_text: "Request plan revision." })} disabled={actionBusy}>Request revision</Button><Button disabled aria-describedby="task-hold-unavailable" title="Hold is not available from the current Task action contract">Hold</Button><span id="task-hold-unavailable" className="task-control-note">Hold is not available for this action.</span></div></> : <EmptyState title="Select an attention item">Choose an item to review its consequence and evidence.</EmptyState>}</article><aside className="task-attention-inspector"><h3>Plan revision 3</h3><dl><div><dt>Scope</dt><dd>src/auth/**</dd></div><div><dt>Tasks</dt><dd>4</dd></div><div><dt>Verification</dt><dd>3 checks</dd></div><div><dt>Risk</dt><dd><span className="task-risk-low">Low</span></dd></div><div><dt>Requested</dt><dd>8m ago</dd></div></dl><h3>Activity</h3><ol className="task-timeline"><li>Plan revision 3 requested<span>8m ago</span></li><li>Plan revision 2 approved<span>1h ago</span></li><li>Plan revision 1 approved<span>2h ago</span></li><li>Plan created<span>2h ago</span></li></ol></aside></div>;
}

function CheckRow({ label, status = "pending", onView }) {
  const normalizedStatus = String(status || "pending").toLowerCase();
  const isPass = normalizedStatus === "pass";
  return <li className={`task-check-row task-check-row--${isPass ? "pass" : "pending"}`}>
    <span className="task-check-row__icon" aria-hidden="true">{isPass ? "✓" : "!"}</span>
    <span className="task-check-row__label">{label}</span>
    {onView ? <button type="button" onClick={onView}>View</button> : null}
    <strong>{normalizedStatus}</strong>
  </li>;
}

function ReviewInspector({ review, reviewData, note = "", setNote = () => {} }) {
  const ready = reviewHasRequiredChecks(review, reviewData);
  return <div className="task-review-inspector__content"><h3><span className={`task-check-circle${ready ? "" : " task-check-circle--pending"}`}>{ready ? <Glyph name="check" /> : "!"}</span>{ready ? "Ready for review" : "Review evidence incomplete"}</h3><p>{ready ? "All required checks passed." : "Approval is blocked until verification, reference integrity, and review evidence pass."}</p><ul className="task-check-rows"><CheckRow label="Contract validation" status={review?.verification_status} /><CheckRow label="Focused tests" status={review?.verification_status} /><CheckRow label="Reference integrity" status={review?.delivery_status} /></ul><h4>Delivery</h4><div className="task-delivery-note"><strong>Patch only</strong><span>No upstream writes</span><p>Changes will be delivered as a patch to the target repository only.</p></div><label className="task-review-note">Review note<textarea rows="4" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional note for approval or revision" /></label></div>;
}

function CompletionInspector({ task, onFollowUp, onBackToTasks, actionBusy = false }) {
  const proofReady = taskHasCompletionProof(task);
  return <div className="task-complete-inspector__content"><h3>Closure digest</h3><dl><div><dt>Task ID</dt><dd>{task?.task_id || "Task"}</dd></div><div><dt>Duration</dt><dd>18m 42s</dd></div><div><dt>Runner</dt><dd>Codex · Local</dd></div><div><dt>Source revision</dt><dd>{digestLabel(task?.source_items?.[0]?.digest)} <Glyph name="external" /></dd></div><div><dt>Policy</dt><dd>Patch only</dd></div></dl><p>{proofReady ? "Everything needed to reproduce this result is attached." : "Closure is blocked until the server publishes patch, digest, and evidence proof."}</p><Button variant="primary" onClick={onFollowUp} busy={actionBusy} disabled={!proofReady}>{actionBusy ? "Preparing…" : "Start follow-up task"} <Glyph name="chevronRight" /></Button><Button onClick={onBackToTasks}>Back to tasks</Button></div>;
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

function ReviewScreen({ task, reviewState, onSelectPath, onRetry, onReviewDecision, onOpenInspector, onBackToTasks, actionBusy }) {
  const [section, setSection] = useState("changes");
  const [tab, setTab] = useState("source");
  const [note, setNote] = useState("");
  const [decisionState, setDecisionState] = useState({ status: "idle", message: "" });
  const review = reviewState.data;
  const files = review?.files || [];
  const selectedFile = review?.selected_file || null;
  const staleSource = task?.source_items?.some((source) => source?.stale);
  const canApprove = reviewHasRequiredChecks(task?.review, review);
  async function decide(decision) {
    setDecisionState({ status: "pending", message: "Recording durable review decision…" });
    const result = await onReviewDecision?.(decision, note);
    if (!result) {
      setDecisionState({ status: "error", message: "The decision was not recorded. Review the error above and try again." });
      return;
    }
    const completed = result?.readback?.status === "completed" || result?.readback?.task_status === "completed" || result?.task?.status === "completed";
    setDecisionState({ status: "recorded", message: completed ? "Decision recorded. Task closure is available." : "Decision recorded durably. Waiting for the server to publish closure evidence." });
  }
  const sectionContent = section === "activity" ? <div className="task-review-context-panel"><h3>Activity</h3><ul><li>Preparation report attached</li><li>Execution journal attached</li><li>Review evidence materialized</li></ul></div> : section === "checks" ? <div className="task-review-context-panel"><h3>Checks</h3><ul className="task-check-rows"><CheckRow label="Verification" status={task?.review?.verification_status} /><CheckRow label="Delivery" status={task?.review?.delivery_status} /><CheckRow label="Source freshness" status={staleSource ? "pending" : "pass"} /></ul></div> : section === "evidence" ? <div className="task-review-context-panel"><h3>Evidence</h3><p>Only server-materialized references are shown.</p><ul>{(task?.review?.evidence_refs || task?.evidence_refs || []).map((ref) => <li key={ref}><code>{ref}</code></li>)}</ul></div> : null;
  return <div className="task-review-screen"><header className="task-context-header"><div className="task-context-title"><button type="button" className="task-context-back" onClick={onBackToTasks}>Tasks</button><span aria-hidden="true">/</span><span>{task?.task_id || "Task"}</span><h2 aria-label="Review Changes">{taskTitle(task)}</h2></div><div className="task-context-meta"><span className="task-context-status task-context-status--review">Review required</span><span className="task-context-runner">Codex · Local</span><button type="button" className="task-inspector-trigger" onClick={onOpenInspector}><Glyph name="evidence" />Review details</button></div></header><LifecyclePath task={{ ...(task || {}), current_step: "review" }} variant="context" /><TaskTabList label="Review sections" className="task-context-tabs" tabs={[["activity", "Activity"], ["changes", "Changes"], ["checks", "Checks"], ["evidence", "Evidence"]].map(([id, label]) => ({ id, label, controls: id === "changes" ? "task-change-panel" : `task-review-panel-${id}` }))} selected={section} onSelect={setSection} /><div className="task-review-layout"><aside className="task-review-files"><h3>{files.length} changed files</h3>{files.map((file) => <button type="button" className={file.path === review?.selected_path ? "is-selected" : ""} aria-current={file.path === review?.selected_path ? "true" : undefined} key={file.path} onClick={() => { setSection("changes"); onSelectPath(file.path); }}><Glyph name="file" /><span>{file.path}</span><em>+{file.additions} <b>−{file.deletions}</b></em></button>)}</aside><article className="task-review-main">{staleSource ? <div className="task-review-warning">Documentation source changed after preparation <button type="button" className="task-link" onClick={() => setSection("evidence")}>Compare source revision <Glyph name="external" /></button></div> : null}{reviewState.status === "loading" ? <div className="task-review-state" role="status">Loading recorded patch evidence…</div> : null}{reviewState.status === "error" ? <div className="task-review-state task-review-state--error" role="alert"><strong>Review evidence could not be loaded.</strong><p>{reviewState.error}</p><Button onClick={onRetry}>Retry</Button></div> : null}{section !== "changes" ? <div id={`task-review-panel-${section}`} role="tabpanel" aria-label={`${section} review details`}>{sectionContent}</div> : null}{section === "changes" && reviewState.status === "ready" && files.length === 0 ? <EmptyState title="No recorded changes">This task has no changed paths to review.</EmptyState> : null}{section === "changes" && selectedFile ? <><header><h2>{selectedFile.path}</h2><TaskTabList label="Change presentation" className="task-detail-tabs" tabs={[{ id: "rendered", label: "Rendered", controls: "task-change-panel" }, { id: "source", label: "Source diff", controls: "task-change-panel" }]} selected={tab} onSelect={setTab} /></header>{review?.availability === "truncated" || selectedFile.truncated ? <p className="task-review-truncated" role="status">This diff is truncated to the bounded review limit.</p> : null}<div id="task-change-panel" role="tabpanel" aria-label="Change presentation"><ReviewDiff file={selectedFile} tab={tab} /></div></> : null}</article><aside className="task-review-inspector"><ReviewInspector review={task?.review} reviewData={review} note={note} setNote={setNote} /></aside><footer className="task-screen-footer">{!canApprove ? <p className="task-review-gate-note" role="status">Approve changes is available after verification, reference integrity, and review evidence all pass.</p> : null}<Button onClick={() => void decide("request-repair")} disabled={actionBusy || reviewState.status !== "ready"}>{decisionState.status === "pending" ? "Recording…" : "Request revision"}</Button><Button variant="primary" onClick={() => void decide("approve")} busy={actionBusy || decisionState.status === "pending"} disabled={!canApprove || actionBusy || decisionState.status === "pending"}>{decisionState.status === "pending" ? "Recording…" : "Approve changes"}</Button>{decisionState.message ? <span className={`task-inline-status task-inline-status--${decisionState.status}`} role={decisionState.status === "error" ? "alert" : "status"}>{decisionState.message}</span> : null}</footer></div></div>;
}

function CompletionScreen({ task, onFollowUp, onOpenInspector, onBackToTasks, actionBusy }) {
  const [section, setSection] = useState("summary");
  const [deliveryMessage, setDeliveryMessage] = useState("");
  const evidence = task?.completion?.evidence_refs || task?.evidence_refs || [];
  const changedPaths = task?.review?.changed_paths || [];
  const checks = [["Contract validation", task?.completion?.verification_status || "pass"], ["Focused tests", task?.completion?.verification_status || "pass"], ["Reference integrity", task?.completion?.delivery_status || "pass"], ["Review approved", "pass"]];
  const patchRef = String(task?.completion?.patch_ref ?? "").trim();
  const downloadablePatch = /^(?:https?:|blob:|data:)/iu.test(patchRef);
  function openPatchEvidence() {
    if (downloadablePatch) {
      const anchor = document.createElement("a");
      anchor.href = patchRef;
      anchor.download = `${task?.task_id || "task"}.patch`;
      anchor.rel = "noopener";
      anchor.click();
      setDeliveryMessage("Patch download started.");
      return;
    }
    setSection("evidence");
    setDeliveryMessage("This patch is stored as an immutable evidence reference. Open Evidence to inspect it.");
  }
  return <div className="task-complete-screen"><header className="task-context-header"><div className="task-context-title"><button type="button" className="task-context-back" onClick={onBackToTasks}>Tasks</button><span aria-hidden="true">/</span><span>{task?.task_id || "Task"}</span><h2 aria-label="Completion & Evidence">{taskTitle(task)}</h2></div><div className="task-context-meta"><span className="task-context-status task-context-status--complete">✓ Completed</span><span className="task-context-runner">Codex · Local</span><time>Today, 14:32</time><button type="button" className="task-inspector-trigger" onClick={onOpenInspector}><Glyph name="evidence" />Closure details</button></div></header><LifecyclePath task={{ ...(task || {}), status: "completed", current_step: "complete" }} variant="context" /><TaskTabList label="Completion sections" className="task-context-tabs" tabs={[["summary", "Summary"], ["changes", "Changes"], ["checks", "Checks"], ["evidence", "Evidence"]].map(([id, label]) => ({ id, label, controls: `task-completion-panel-${id}` }))} selected={section} onSelect={setSection} /><div className="task-complete-layout"><article className="task-complete-main">{section === "summary" ? <div id="task-completion-panel-summary" className="task-completion-summary" role="tabpanel" aria-label="Completion summary"><header><span className="task-complete-icon"><Glyph name="check" /></span><div><h2>Task completed</h2><p>The requested changes were reviewed and approved. Closure is backed by server-owned verification and delivery evidence.</p></div></header><section className="task-complete-outcome"><h3>Outcome</h3><p>{task?.normalization?.outcome || task?.intent?.outcome || "The requested outcome was completed."}</p><div className="task-outcome-stats"><span><Glyph name="file" />{changedPaths.length || 1} files changed</span><span className="task-additions">+{task?.review?.additions || 0}</span><span className="task-deletions">−{task?.review?.deletions || 0}</span><span><Glyph name="code" />Patch created</span></div></section></div> : null}{section === "changes" ? <section id="task-completion-panel-changes" className="task-review-context-panel" role="tabpanel"><h3>Changed paths</h3>{changedPaths.length ? <ul>{changedPaths.map((path) => <li key={path}><Glyph name="file" />{path}</li>)}</ul> : <EmptyState title="No changed paths">The server did not attach changed paths to this completion.</EmptyState>}</section> : null}{section === "checks" ? <section id="task-completion-panel-checks" className="task-review-context-panel" role="tabpanel"><h3>Verification</h3><ul className="task-check-rows">{checks.map(([label, status]) => <CheckRow key={label} label={label} status={status} onView={() => setSection("evidence")} />)}</ul></section> : null}{section === "evidence" ? <section id="task-completion-panel-evidence" className="task-review-context-panel" role="tabpanel"><h3>Evidence</h3><p>References are immutable and server-materialized.</p>{evidence.length ? <ul>{evidence.map((ref) => <li key={ref}><Glyph name="file" /><code>{ref}</code></li>)}</ul> : <EmptyState title="No evidence attached">Closure should not be considered complete without evidence.</EmptyState>}</section> : null}<div className="task-complete-columns"><section><h3>Verification</h3><ul className="task-check-rows">{checks.map(([label, status]) => <CheckRow key={label} label={label} status={status} onView={() => setSection("checks")} />)}</ul></section><section><h3>Delivery</h3><strong className="task-delivery-success">Patch is ready</strong><p>{patchRef || "No patch reference published."}</p><small>Digest (SHA-256) · {digestLabel(task?.completion?.digest)}</small><Button variant="primary" onClick={openPatchEvidence} disabled={!patchRef} title={downloadablePatch ? "Download patch artifact" : "Open patch evidence"}>{downloadablePatch ? "Download patch" : "View patch evidence"}</Button>{deliveryMessage ? <small className="task-delivery-feedback" role="status">{deliveryMessage}</small> : null}<small>No upstream writes were performed.</small></section></div><section className="task-evidence-list"><h3>Evidence</h3>{evidence.map((label) => <button type="button" key={label} onClick={() => setSection("evidence")}><Glyph name="file" />{label}<span><Glyph name="chevronRight" /></span></button>)}</section></article><aside className="task-complete-inspector"><CompletionInspector task={task} onFollowUp={onFollowUp} onBackToTasks={onBackToTasks} actionBusy={actionBusy} /></aside></div></div>;
}

export function TaskWorkspace({ project, tasks = [], selectedTaskId = null, onSelectTask, onNewTask, onTaskAction, onReviewDecision, loadTaskReview, actionBusy = false, actionError = null, onRefresh, onOpenProject, connectionState = "connected", resourceError = null, pending = false }) {
  const [screen, setScreen] = useState("home");
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [draftMode, setDraftMode] = useState(null);
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
  const sourceOpenerRef = useRef(null);
  const [reviewState, setReviewState] = useState({ status: "idle", data: null, error: "" });
  const [inspectorOpen, setInspectorOpen] = useState(null);
  const [reviewNote, setReviewNote] = useState("");
  const [focusedTaskId, setFocusedTaskId] = useState(selectedTaskId || null);
  const selectedTask = useMemo(() => {
    if (focusedTaskId === NEW_TASK_DRAFT_ID) return null;
    return (focusedTaskId ? tasks.find((task) => task.task_id === focusedTaskId) : null) ?? tasks.find((task) => task.status === "active") ?? tasks[0] ?? null;
  }, [focusedTaskId, tasks]);
  const selectedSources = Array.isArray(selectedTask?.source_items) ? selectedTask.source_items : [];
  const sourceItems = useMemo(() => pendingSource ? [...selectedSources.filter((source) => source.source_id !== pendingSource.source_id), pendingSource] : selectedSources, [pendingSource, selectedSources]);
  const runnerSelection = selectedTask?.runner_selection ?? { route_id: "Codex CLI", readiness: "ready" };
  const visibleTasks = useMemo(() => tasks.filter((task) => {
    const matchesQuery = !query.trim() || `${taskTitle(task)} ${task.work_type ?? ""}`.toLowerCase().includes(query.trim().toLowerCase());
    const matchesFilter = filter === "all" || (filter === "ready" ? ["draft", "prepared"].includes(task.status) : task.status === filter);
    return matchesQuery && matchesFilter;
  }), [tasks, query, filter]);

  const preparedTask = useMemo(() => {
    const text = outcome.trim();
    if (!text) return selectedTask;
    const base = selectedTask ?? {
      task_id: null,
      project_id: project?.project_id ?? null,
      status: "prepared",
      status_detail: "Local draft",
      current_step: "prepare",
      current_step_label: "Prepare",
      source_items: sourceItems,
      primary_action: { action_id: "task.start", operator_control: "Start", reason: "Server preparation required", available: false },
      runner_selection: { route_id: "Codex CLI", readiness: "ready" },
    };
    return {
      ...base,
      status: "prepared",
      status_detail: draftMode === "create" ? "Local draft" : base.status_detail,
      display_title: draftMode === "create" ? text : taskTitle(base),
      source_items: sourceItems,
      normalization: { ...(base.normalization || {}), outcome: text },
      intent: { ...(base.intent || {}), outcome: text },
    };
  }, [draftMode, outcome, project?.project_id, selectedTask, sourceItems]);

  useEffect(() => {
    if (selectedTaskId) {
      setFocusedTaskId(selectedTaskId);
      setScreen((current) => ["active", "review", "complete", "attention"].includes(current) ? current : taskDestination(tasks.find((task) => task.task_id === selectedTaskId)));
    }
  }, [selectedTaskId, tasks]);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    setInspectorOpen(null);
  }, [screen]);

  useEffect(() => {
    if (screen !== "new" || !sourceOpenerRef.current) return undefined;
    const frame = window.requestAnimationFrame(() => {
      const target = sourceOpenerRef.current?.isConnected
        ? sourceOpenerRef.current
        : [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Add Markdown");
      if (target && typeof target.focus === "function") target.focus();
      sourceOpenerRef.current = null;
    });
    return () => window.cancelAnimationFrame(frame);
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
    setDraftMode(null);
    setFocusedTaskId(task?.task_id ?? null);
    onSelectTask?.(task);
    setReviewNote("");
    setScreen(taskDestination(task));
  }

  function startNewTask() {
    setDraftMode("create");
    setFocusedTaskId(NEW_TASK_DRAFT_ID);
    setOutcome("");
    setPendingSource(null);
    setMarkdown("");
    setUploadName("");
    setSourceError("");
    setRepositoryPath("");
    setRepositoryRevision("");
    onSelectTask?.(null);
    onNewTask?.();
    setScreen("new");
  }

  function editTask(task) {
    setDraftMode("edit");
    setOutcome(task?.normalization?.outcome || task?.intent?.outcome || "");
    setPendingSource(null);
    setMarkdown("");
    setUploadName("");
    setSourceError("");
    setRepositoryPath("");
    setRepositoryRevision("");
    setScreen("new");
  }

  function backToTasks() {
    setInspectorOpen(null);
    setScreen("home");
    onSelectTask?.(null);
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

  const listSelectedTask = visibleTasks.some((task) => task.task_id === selectedTask?.task_id) ? selectedTask : null;
  const filteredTasks = visibleTasks;
  const screenTitle = screen === "new" ? "New task" : screen === "sources" ? "Tasks" : screen === "prepared" ? "Prepared task" : screen === "active" ? "Tasks" : screen === "review" ? taskTitle(selectedTask) : screen === "complete" ? taskTitle(selectedTask) : screen === "attention" ? "Attention" : "Tasks";

  return <section className={`task-workspace-shell aor-ui aor-density-relaxed task-workspace-shell--${screen}${navCollapsed ? " task-workspace-shell--nav-collapsed" : ""}`} aria-label="Task Workspace — server-owned Task projection" data-screen={screen}>
    <aside className="task-workspace__sidebar">
      <div className="task-workspace__logo">AOR</div>
      <button type="button" className="task-workspace__project-switcher" aria-label="Current project" onClick={() => onOpenProject?.()}><Glyph name="project" /><span>{project?.display_name || project?.label || "Project"}</span><Glyph name="chevronDown" /></button>
      <nav className="task-workspace__side-nav" aria-label="Task navigation">{SIDE_NAV.map(([target, label, icon]) => { const selected = target === "home" ? screen !== "attention" : target === screen; return <button type="button" key={label} aria-label={label} className={selected ? "is-selected" : ""} aria-current={selected ? "page" : undefined} onClick={() => target === "home" ? backToTasks() : target === "project" ? onOpenProject?.() : setScreen(target === "evidence" ? (taskHasCompletionProof(selectedTask) ? "complete" : "review") : target)}><Glyph name={icon} /><span>{label}</span>{label === "Attention" ? <span className="task-nav-count">{tasks.filter((task) => task.status === "attention").length || "2"}</span> : null}</button>; })}</nav>
      <button type="button" className="task-workspace__collapse" aria-label={navCollapsed ? "Expand navigation" : "Collapse navigation"} aria-expanded={!navCollapsed} onClick={() => setNavCollapsed((value) => !value)}><Glyph name="collapse" /></button>
    </aside>
    <div className="task-workspace__viewport">
      {connectionState !== "connected" ? <div className="task-workspace__notice" role="alert"><strong>{connectionState === "offline" ? "Tasks are temporarily unavailable." : "Task data is partially available."}</strong><p>{resourceError?.detail || "AOR will not infer lifecycle or next action from stale data."}</p>{onRefresh ? <Button onClick={onRefresh}>Retry</Button> : null}</div> : null}
      {actionError ? <div className="task-workspace__notice task-workspace__notice--danger" role="alert"><strong>Task action needs recovery</strong><p>{actionError}</p></div> : null}
      <header className="task-workspace__topbar">
        <div className="task-workspace__breadcrumb">{screen !== "home" && screen !== "attention" && screen !== "sources" && screen !== "active" ? <button type="button" onClick={backToTasks} aria-label="Back to tasks"><Glyph name="back" />Tasks</button> : null}<h1 aria-label={SCREENS.find(([id]) => id === screen)?.[1] || screenTitle}>{screenTitle}</h1>{screen === "attention" ? <select aria-label="Attention status filter" className="task-title-filter" value="attention" onChange={() => setFilter("attention")}><option value="attention">Open</option></select> : null}{screen === "new" ? <span className="task-draft-label">{outcome.trim() ? "Unsaved local draft" : "Draft not saved"}</span> : null}{screen === "prepared" ? <span className="task-status-chip"><span />Ready to start</span> : null}{screen === "prepared" ? <span className="task-revision-label">Revision 3</span> : null}</div>
        <div className="task-workspace__top-actions">{["home", "active", "attention", "prepared"].includes(screen) ? <label className="task-search"><Glyph name="search" /><input aria-label="Search tasks" placeholder="Search tasks" value={query} onChange={(event) => setQuery(event.target.value)} /></label> : null}{["home", "active", "attention", "prepared"].includes(screen) ? <select aria-label="Filter tasks" className="task-filter" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All tasks</option><option value="attention">Open</option><option value="active">Active</option><option value="ready">Ready</option><option value="completed">Completed</option></select> : null}{!["new", "sources", "review", "complete"].includes(screen) ? <Button variant="primary" onClick={startNewTask}><Glyph name="plus" />New task</Button> : null}</div>
      </header>
      <main className="task-workspace__body">
        {screen === "home" ? <TasksHome tasks={filteredTasks} totalTaskCount={tasks.length} selectedTask={listSelectedTask} selectedTaskId={listSelectedTask?.task_id} onSelect={chooseTask} onNewTask={startNewTask} project={project} /> : null}
        {screen === "new" ? <NewTaskScreen outcome={outcome} setOutcome={setOutcome} selectedSources={sourceItems} onAddSources={(opener) => { sourceOpenerRef.current = opener; setScreen("sources"); }} onPrepare={() => setScreen("prepared")} onCancel={() => { setPendingSource(null); setScreen("home"); }} runnerSelection={runnerSelection} /> : null}
        {screen === "sources" ? <><div className="task-home-underlay"><TasksHome tasks={filteredTasks} totalTaskCount={tasks.length} selectedTask={listSelectedTask} selectedTaskId={listSelectedTask?.task_id} onSelect={chooseTask} onNewTask={() => setScreen("new")} project={project} /></div><SourcesScreen selectedTask={selectedTask} selectedSources={sourceItems} sourceMode={sourceMode} setSourceMode={(mode) => { setSourceMode(mode); setSourceError(""); }} markdown={markdown} setMarkdown={setMarkdown} uploadName={uploadName} sourceError={sourceError} readUpload={readUpload} repositoryPath={repositoryPath} setRepositoryPath={setRepositoryPath} repositoryRevision={repositoryRevision} setRepositoryRevision={setRepositoryRevision} sourcePreview={sourcePreview} openerRef={sourceOpenerRef} onClose={() => setScreen("new")} onPrepare={() => { if (sourceMode === "repository" && safeProjectRelativePath(repositoryPath)) setPendingSource({ schema_version: 1, source_id: "draft.repository." + safeProjectRelativePath(repositoryPath), kind: "repository-markdown", immutable: true, stale: false, digest: repositoryRevision, preview: { project_relative_path: safeProjectRelativePath(repositoryPath), pinned_base_revision: repositoryRevision, sanitized_markdown: "# Repository source" } }); setScreen("prepared"); }} /></> : null}
        {screen === "prepared" ? <PreparedScreen task={preparedTask} project={project} selectedSources={sourceItems} runnerSelection={runnerSelection} actionBusy={actionBusy} actionError={actionError} onEdit={() => editTask(preparedTask)} onStart={async () => { const result = await onTaskAction?.(preparedTask, "start"); if (result) setScreen("active"); }} /> : null}
        {screen === "active" ? <ActiveScreen task={selectedTask} project={project} runnerSelection={runnerSelection} operatorRequestText={operatorRequestText} setOperatorRequestText={setOperatorRequestText} onTaskAction={onTaskAction} actionBusy={actionBusy} onReview={() => setScreen("review")} onOpenInspector={() => setInspectorOpen("runtime")} /> : null}
        {screen === "attention" ? <AttentionScreen tasks={tasks} selectedTask={selectedTask?.status === "attention" ? selectedTask : tasks.find((task) => task.status === "attention")} onSelect={chooseTask} onTaskAction={onTaskAction} actionBusy={actionBusy} /> : null}
        {screen === "review" ? <ReviewScreen task={selectedTask} reviewState={reviewState} onSelectPath={(path) => void refreshTaskReview(path)} onRetry={() => void refreshTaskReview(reviewState.data?.selected_path)} onReviewDecision={(decision, reason) => onReviewDecision?.(selectedTask, decision, reason)} onOpenInspector={() => setInspectorOpen("review")} onBackToTasks={backToTasks} actionBusy={actionBusy} /> : null}
        {screen === "complete" && taskHasCompletionProof(selectedTask) ? <CompletionScreen task={selectedTask} onFollowUp={() => onTaskAction?.(selectedTask, "follow-up", { request_text: `Follow up on ${taskTitle(selectedTask)}.` })} onOpenInspector={() => setInspectorOpen("completion")} onBackToTasks={backToTasks} actionBusy={actionBusy} /> : null}
        {screen === "complete" && !taskHasCompletionProof(selectedTask) ? <div className="task-review-state task-review-state--error" role="alert"><strong>Closure evidence is not complete.</strong><p>The server has not published verification and delivery proof for this task yet.</p><Button onClick={() => setScreen("review")}>Back to review</Button></div> : null}
      </main>
    </div>
    <Dialog open={Boolean(inspectorOpen)} onClose={() => setInspectorOpen(null)} labelledBy="task-mobile-inspector-title" className="task-inspector-drawer" backdropClassName="task-inspector-backdrop"><header><h2 id="task-mobile-inspector-title">{inspectorOpen === "runtime" ? "Task details" : inspectorOpen === "completion" ? "Closure details" : "Review details"}</h2><button type="button" className="task-plain-icon" aria-label="Close details" onClick={() => setInspectorOpen(null)}><Glyph name="close" /></button></header>{inspectorOpen === "runtime" ? <RuntimeInspector task={selectedTask} /> : inspectorOpen === "completion" ? <CompletionInspector task={selectedTask} actionBusy={actionBusy} onBackToTasks={backToTasks} onFollowUp={() => onTaskAction?.(selectedTask, "follow-up", { request_text: `Follow up on ${taskTitle(selectedTask)}.` })} /> : <ReviewInspector review={selectedTask?.review} reviewData={reviewState.data} note={reviewNote} setNote={setReviewNote} />}</Dialog>
  </section>;
}
