import { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";

import { readControlPlaneJson as readJson } from "./control-plane-client.js";
import { Dialog } from "./dialog.jsx";
import { TaskWorkspace } from "./task-workspace.jsx";
import { Button } from "./ui/components.jsx";
import "./ui/tokens.css";
import "./ui/components.css";
import "./task-app.css";
import "./task-workspace.css";

const EMPTY_PROJECT_FORM = Object.freeze({ sourceKind: "local", projectRef: "", gitUrl: "", label: "" });

function currentLocation() {
  const params = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
  return { projectId: params.get("project"), taskId: params.get("task") };
}

function writeTaskLocation({ projectId = null, taskId = null } = {}) {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams();
  if (projectId) params.set("project", projectId);
  if (taskId) params.set("task", taskId);
  const query = params.toString();
  window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
}

function projectLabel(project) {
  return project?.display_name || project?.label || project?.project_id || "Project";
}

function ProjectDialog({ open, projects, activeProjectId, busy, result, form, setForm, onClose, onSelect, onConnect, onPickFolder }) {
  const sourceValue = form.sourceKind === "git" ? form.gitUrl : form.projectRef;
  return <Dialog open={open} onClose={onClose} labelledBy="task-project-dialog-title" className="task-project-dialog">
    <header className="task-project-dialog__header">
      <div><span>Workspace</span><h2 id="task-project-dialog-title">Projects</h2><p>Switch to an explicitly connected project or add one source. AOR never scans the filesystem.</p></div>
      <Button size="compact" onClick={onClose}>Close</Button>
    </header>
    <section aria-labelledby="task-project-list-title">
      <h3 id="task-project-list-title">Connected projects</h3>
      <div className="task-project-dialog__list">
        {projects.length ? projects.map((project) => <button type="button" key={project.project_id} aria-current={project.project_id === activeProjectId ? "true" : undefined} onClick={() => onSelect(project.project_id)} disabled={busy}>
          <strong>{projectLabel(project)}</strong><span>{project.project_id}</span>
        </button>) : <p>No projects are connected yet.</p>}
      </div>
    </section>
    <section className="task-project-dialog__connect" aria-labelledby="task-project-connect-title">
      <h3 id="task-project-connect-title">Connect project</h3>
      <label>Source<select value={form.sourceKind} onChange={(event) => setForm((current) => ({ ...current, sourceKind: event.target.value }))}><option value="local">Local Git folder</option><option value="git">Git URL</option></select></label>
      {form.sourceKind === "git"
        ? <label>HTTPS or SSH Git URL<input value={form.gitUrl} onChange={(event) => setForm((current) => ({ ...current, gitUrl: event.target.value }))} placeholder="git@github.com:org/repository.git" /></label>
        : <label>Absolute folder path<span className="task-project-dialog__path"><input value={form.projectRef} onChange={(event) => setForm((current) => ({ ...current, projectRef: event.target.value }))} placeholder="/path/to/repository" /><Button onClick={onPickFolder} disabled={busy}>Choose folder…</Button></span></label>}
      <label>Project label<input value={form.label} onChange={(event) => setForm((current) => ({ ...current, label: event.target.value }))} placeholder="Optional name" /></label>
      <p className="task-project-dialog__help">Credentials in URLs are rejected. Git credential helpers and your SSH agent handle authentication.</p>
      {result ? <p className={`task-project-dialog__result task-project-dialog__result--${result.status}`} role={result.status === "error" ? "alert" : "status"}>{result.message}</p> : null}
      <div className="task-project-dialog__actions"><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" onClick={onConnect} busy={busy} disabled={busy || !sourceValue.trim()}>Connect code</Button></div>
    </section>
  </Dialog>;
}

function EmptyWorkspace({ onOpenProject, error, onRetry }) {
  return <main className="task-app-state aor-ui" aria-labelledby="task-app-empty-title">
    <span>AOR</span><h1 id="task-app-empty-title">Connect a project to start</h1>
    <p>Task Workspace needs one explicit local Git folder or HTTPS/SSH Git URL. Loading this page does not scan or modify your repositories.</p>
    {error ? <p className="task-app-state__error" role="alert">{error}</p> : null}
    <div><Button variant="primary" onClick={onOpenProject}>Connect project</Button>{error ? <Button onClick={onRetry}>Retry</Button> : null}</div>
  </main>;
}

function TaskApp() {
  const initialLocation = useMemo(currentLocation, []);
  const [config, setConfig] = useState(null);
  const [projects, setProjects] = useState([]);
  const [activeProjectId, setActiveProjectId] = useState(initialLocation.projectId);
  const [tasks, setTasks] = useState([]);
  const [selectedTaskId, setSelectedTaskId] = useState(initialLocation.taskId);
  const [connectionState, setConnectionState] = useState("loading");
  const [resourceError, setResourceError] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [projectForm, setProjectForm] = useState({ ...EMPTY_PROJECT_FORM });
  const [projectResult, setProjectResult] = useState(null);

  const activeProject = useMemo(() => projects.find((project) => project.project_id === activeProjectId) ?? null, [activeProjectId, projects]);
  const apiProjectBase = activeProjectId ? `/api/projects/${encodeURIComponent(activeProjectId)}` : null;

  const refresh = useCallback(async ({ projectId = null, silent = false, keepSelection = true } = {}) => {
    if (!silent) setConnectionState("loading");
    setError("");
    try {
      const appConfig = config ?? await readJson("/app-config.json");
      const projectIndex = await readJson("/api/projects").catch(() => ({
        default_project_id: appConfig.default_project_id ?? appConfig.project_id,
        projects: Array.isArray(appConfig.projects) ? appConfig.projects : [],
      }));
      const availableProjects = Array.isArray(projectIndex.projects) && projectIndex.projects.length
        ? projectIndex.projects
        : Array.isArray(appConfig.projects) ? appConfig.projects : [];
      const requestedProjectId = projectId ?? activeProjectId ?? initialLocation.projectId ?? projectIndex.default_project_id ?? appConfig.default_project_id ?? appConfig.project_id;
      const selectedProject = availableProjects.find((project) => project.project_id === requestedProjectId) ?? availableProjects[0] ?? null;
      const nextProjectId = selectedProject?.project_id ?? null;
      setConfig(appConfig);
      setProjects(availableProjects);
      setActiveProjectId(nextProjectId);
      if (!nextProjectId) {
        setTasks([]);
        setConnectionState("connected");
        setLoaded(true);
        writeTaskLocation();
        return { tasks: [], projectId: null };
      }

      const base = `/api/projects/${encodeURIComponent(nextProjectId)}`;
      const [stateResult, taskResult] = await Promise.allSettled([readJson(`${base}/state`), readJson(`${base}/tasks`)]);
      const taskPayload = taskResult.status === "fulfilled" ? taskResult.value : { tasks: [] };
      const nextTasks = Array.isArray(taskPayload.tasks) ? taskPayload.tasks : [];
      const state = stateResult.status === "fulfilled" ? stateResult.value : null;
      setProjects((current) => current.map((project) => project.project_id === nextProjectId && state?.onboarding_summary
        ? { ...project, onboarding_summary: state.onboarding_summary }
        : project));
      if (taskResult.status === "fulfilled") setTasks(nextTasks);
      setConnectionState(taskResult.status === "fulfilled" ? "connected" : "offline");
      setResourceError(taskResult.status === "rejected" ? taskResult.reason : null);
      if (taskResult.status === "rejected") setError(taskResult.reason instanceof Error ? taskResult.reason.message : String(taskResult.reason));
      const taskId = keepSelection && nextTasks.some((task) => task.task_id === selectedTaskId) ? selectedTaskId : null;
      if (!taskId && !keepSelection) setSelectedTaskId(null);
      writeTaskLocation({ projectId: nextProjectId, taskId });
      setLoaded(true);
      return { tasks: nextTasks, projectId: nextProjectId };
    } catch (refreshError) {
      const message = refreshError instanceof Error ? refreshError.message : String(refreshError);
      setConnectionState("offline");
      setError(message);
      setResourceError(refreshError);
      setLoaded(true);
      return { tasks, projectId: activeProjectId, error: refreshError };
    }
  }, [activeProjectId, config, initialLocation.projectId, selectedTaskId, tasks]);

  useEffect(() => { void refresh(); }, []);

  useEffect(() => {
    if (!apiProjectBase) return undefined;
    const activeTask = tasks.find((task) => ["active", "running"].includes(task.status));
    const liveRunId = activeTask?.run_ids?.[0];
    if (!liveRunId || typeof EventSource === "undefined") return undefined;
    let closed = false;
    let cursor = "";
    let source;
    const connect = () => {
      const query = new URLSearchParams({ maxReplay: "0" });
      if (cursor) query.set("after_event_id", cursor);
      source = new EventSource(`${apiProjectBase}/runs/${encodeURIComponent(liveRunId)}/events?${query}`);
      const consume = (event) => { if (event.lastEventId) cursor = event.lastEventId; void refresh({ silent: true }); };
      source.addEventListener("live-run-event", consume);
      source.addEventListener("message", consume);
      source.onerror = () => { source?.close(); if (!closed) window.setTimeout(connect, 1000); };
    };
    connect();
    return () => { closed = true; source?.close(); };
  }, [apiProjectBase, refresh, tasks]);

  async function runTaskAction(task, action, payload = {}) {
    if (!apiProjectBase || !task?.task_id || busy) return null;
    setBusy(true); setError("");
    try {
      const result = await readJson(`${apiProjectBase}/tasks/${encodeURIComponent(task.task_id)}/actions`, {
        method: "POST", headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify({ action, ...payload }),
      });
      await refresh({ silent: true });
      return result;
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
      return null;
    } finally { setBusy(false); }
  }

  async function createTask({ requestText, attachments = [], markdownSources = [] } = {}) {
    if (!apiProjectBase || busy) return null;
    setBusy(true); setError("");
    try {
      const created = await readJson(`${apiProjectBase}/intent-submissions`, {
        method: "POST", headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify({ request_text: requestText, attachments, markdown_sources: markdownSources, auto_prepare: true }),
      });
      const refreshed = await refresh({ silent: true });
      const submissionId = created?.submission?.submission_id;
      const task = refreshed.tasks.find((entry) => entry?.lineage?.intent_submission_id === submissionId) ?? null;
      if (task) { setSelectedTaskId(task.task_id); writeTaskLocation({ projectId: activeProjectId, taskId: task.task_id }); }
      return task;
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : String(createError));
      return null;
    } finally { setBusy(false); }
  }

  async function reviewTask(task, decision, reason = "") {
    if (!apiProjectBase || !task?.run_ids?.[0] || busy) { setError("Review decision is unavailable until a durable run is selected."); return null; }
    setBusy(true); setError("");
    try {
      const result = await readJson(`${apiProjectBase}/lifecycle-command/actions`, {
        method: "POST", headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify({ command: "review decide", flags: { run_id: task.run_ids[0], decision, ...(reason.trim() ? { reason: reason.trim() } : {}) } }),
      });
      await refresh({ silent: true });
      return result;
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : String(reviewError));
      return null;
    } finally { setBusy(false); }
  }

  async function loadTaskReview(taskId, selectedPath = null) {
    if (!apiProjectBase || !taskId) throw new Error("Task review is unavailable until the project is loaded.");
    const query = selectedPath ? `?path=${encodeURIComponent(selectedPath)}` : "";
    return readJson(`${apiProjectBase}/tasks/${encodeURIComponent(taskId)}/review${query}`);
  }

  async function selectProject(projectId) {
    setProjectDialogOpen(false); setSelectedTaskId(null); setTasks([]);
    await refresh({ projectId, keepSelection: false });
  }

  async function connectProject() {
    const sourceValue = projectForm.sourceKind === "git" ? projectForm.gitUrl.trim() : projectForm.projectRef.trim();
    if (!sourceValue || busy) return;
    setBusy(true); setProjectResult(null); setError("");
    try {
      const accepted = await readJson("/api/projects/actions", {
        method: "POST", headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify({ action: "connect", source: projectForm.sourceKind === "git" ? { kind: "git", url: sourceValue } : { kind: "local", path: sourceValue }, ...(projectForm.label.trim() ? { label: projectForm.label.trim() } : {}) }),
      });
      let job = accepted.job;
      for (let attempt = 0; attempt < 240 && ["queued", "running"].includes(job?.status); attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 250));
        job = await readJson(accepted.status_ref);
      }
      if (job?.status !== "succeeded") throw new Error(job?.error || "Project connection did not complete.");
      setProjectForm({ ...EMPTY_PROJECT_FORM });
      setProjectResult({ status: "ok", message: "Project connected. Runtime data remains in AOR Home." });
      setProjectDialogOpen(false);
      await refresh({ projectId: job.project_id, keepSelection: false });
    } catch (connectError) {
      const message = connectError instanceof Error ? connectError.message : String(connectError);
      setProjectResult({ status: "error", message }); setError(message);
    } finally { setBusy(false); }
  }

  async function pickProjectFolder() {
    try {
      const result = await readJson("/api/workspace/folder-picker/actions", { method: "POST", headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify({ action: "open" }) });
      if (result.path) setProjectForm((current) => ({ ...current, sourceKind: "local", projectRef: result.path }));
      else setProjectResult({ status: "error", message: result.message || "Native picker is unavailable; enter an absolute path." });
    } catch (pickerError) { setProjectResult({ status: "error", message: pickerError instanceof Error ? pickerError.message : String(pickerError) }); }
  }

  const projectDialog = <ProjectDialog open={projectDialogOpen} projects={projects} activeProjectId={activeProjectId} busy={busy} result={projectResult} form={projectForm} setForm={setProjectForm} onClose={() => setProjectDialogOpen(false)} onSelect={selectProject} onConnect={connectProject} onPickFolder={pickProjectFolder} />;
  if (!loaded) return <><main className="task-app-state aor-ui" role="status"><span>AOR</span><h1>Loading Task Workspace…</h1><p>Reading the server-owned project and Task projection.</p></main>{projectDialog}</>;
  if (!activeProject) return <><EmptyWorkspace onOpenProject={() => setProjectDialogOpen(true)} error={error} onRetry={() => void refresh()} />{projectDialog}</>;

  return <div className="task-app" data-app-surface="task-workspace">
    <TaskWorkspace project={activeProject} tasks={tasks} selectedTaskId={selectedTaskId} onSelectTask={(task) => { const taskId = task?.task_id ?? null; setSelectedTaskId(taskId); writeTaskLocation({ projectId: activeProjectId, taskId }); }} onNewTask={() => { setSelectedTaskId(null); writeTaskLocation({ projectId: activeProjectId }); }} onCreateTask={createTask} onTaskAction={runTaskAction} onReviewDecision={reviewTask} loadTaskReview={loadTaskReview} actionBusy={busy} actionError={error} onRefresh={() => void refresh()} onOpenProject={() => { setProjectResult(null); setProjectDialogOpen(true); }} connectionState={connectionState} resourceError={resourceError} pending={connectionState === "loading"} />
    {projectDialog}
  </div>;
}

createRoot(document.getElementById("root")).render(<TaskApp />);
