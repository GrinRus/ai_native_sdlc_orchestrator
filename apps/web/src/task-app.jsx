import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import { readControlPlaneJson as readJson } from "./control-plane-client.js";
import { Dialog } from "./dialog.jsx";
import { subscribeToLiveRunEvents } from "./live-run-stream.js";
import { TaskWorkspace } from "./task-workspace.jsx";
import { Button } from "./ui/components.jsx";
import "./ui/tokens.css";
import "./ui/components.css";
import "./task-app.css";
import "./task-workspace.css";
import { firstNonNullish } from "../../../packages/contracts/src/value-normalization.mjs";

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

function postJson(path, payload) {
  return readJson(path, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload),
  });
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function readTaskInteractions(projectBase, tasks) {
  const runIds = [...new Set(tasks
    .filter((task) => ["active", "attention"].includes(task?.status))
    .flatMap((task) => Array.isArray(task?.run_ids) ? task.run_ids : [])
    .filter((runId) => typeof runId === "string" && runId.length > 0))];
  const results = await Promise.allSettled(runIds.map((runId) => readJson(
    `${projectBase}/runs/${encodeURIComponent(runId)}/events/history?limit=50`,
  )));
  const interactionsByRun = {};
  const failures = [];
  results.forEach((result, index) => {
    const runId = runIds[index];
    if (result.status === "rejected") {
      failures.push(`interaction history (${runId}): ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
      return;
    }
    const interactions = new Map();
    for (const event of result.value?.events ?? []) {
      const interaction = event?.interaction;
      if (interaction?.interaction_id) interactions.set(interaction.interaction_id, { ...interaction, run_id: runId });
    }
    interactionsByRun[runId] = [...interactions.values()];
  });
  return { interactionsByRun, failures };
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
  const [interactionsByRun, setInteractionsByRun] = useState({});
  const [operatorRequests, setOperatorRequests] = useState([]);
  const [operatorRequestsAvailable, setOperatorRequestsAvailable] = useState(false);
  const [executionProfile, setExecutionProfile] = useState(null);
  const [selectedTaskId, setSelectedTaskId] = useState(initialLocation.taskId);
  const [connectionState, setConnectionState] = useState("loading");
  const [resourceError, setResourceError] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingSubmission, setPendingSubmission] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [projectForm, setProjectForm] = useState({ ...EMPTY_PROJECT_FORM });
  const [projectResult, setProjectResult] = useState(null);

  const activeProject = useMemo(() => projects.find((project) => project.project_id === activeProjectId) ?? null, [activeProjectId, projects]);
  const apiProjectBase = activeProjectId ? `/api/projects/${encodeURIComponent(activeProjectId)}` : null;
  const liveRunIds = useMemo(() => [...new Set(tasks.filter((task) => ["active", "running"].includes(task.status)).flatMap((task) => task.run_ids || []).filter(Boolean))], [tasks]);

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
      const requestedProjectId = firstNonNullish(projectId, activeProjectId, initialLocation.projectId, projectIndex.default_project_id, appConfig.default_project_id, appConfig.project_id);
      const selectedProject = availableProjects.find((project) => project.project_id === requestedProjectId) ?? availableProjects[0] ?? null;
      const nextProjectId = selectedProject?.project_id ?? null;
      setConfig(appConfig);
      setProjects(availableProjects);
      setActiveProjectId(nextProjectId);
      if (!nextProjectId) {
        setTasks([]); setSelectedTaskId(null);
        setInteractionsByRun({});
        setOperatorRequests([]);
        setOperatorRequestsAvailable(false);
        setExecutionProfile(null);
        setConnectionState("connected");
        setLoaded(true);
        writeTaskLocation();
        return { tasks: [], projectId: null };
      }

      const base = `/api/projects/${encodeURIComponent(nextProjectId)}`;
      const [stateResult, taskResult, executionProfileResult, operatorRequestResult] = await Promise.allSettled([
        readJson(`${base}/state`),
        readJson(`${base}/tasks`),
        readJson(`${base}/execution-profile`),
        readJson(`${base}/operator-requests`),
      ]);
      const taskPayload = taskResult.status === "fulfilled" ? taskResult.value : { tasks: [] };
      const nextTasks = Array.isArray(taskPayload.tasks) ? taskPayload.tasks : [];
      const interactionResult = await readTaskInteractions(base, nextTasks);
      setInteractionsByRun(interactionResult.interactionsByRun);
      const unavailableReads = [
        ["project state", stateResult],
        ["tasks", taskResult],
        ["runner profile", executionProfileResult],
        ["operator requests", operatorRequestResult],
      ].filter(([, result]) => result.status === "rejected");
      const operatorRequestListAvailable = operatorRequestResult.status === "fulfilled"
        && Array.isArray(operatorRequestResult.value);
      const nextOperatorRequests = operatorRequestListAvailable ? operatorRequestResult.value : [];
      const state = stateResult.status === "fulfilled" ? stateResult.value : null;
      setExecutionProfile(executionProfileResult.status === "fulfilled" ? executionProfileResult.value : null);
      setProjects((current) => current.map((project) => project.project_id === nextProjectId && state?.onboarding_summary
        ? { ...project, onboarding_summary: state.onboarding_summary }
        : project));
      if (taskResult.status === "fulfilled") setTasks(nextTasks);
      setOperatorRequests(nextOperatorRequests);
      setOperatorRequestsAvailable(operatorRequestListAvailable);
      setConnectionState(taskResult.status === "rejected" ? "offline" : unavailableReads.length || interactionResult.failures.length ? "partial" : "connected");
      const resourceFailures = [
        ...unavailableReads.map(([label, result]) => {
          const reason = result.reason;
          const message = typeof reason?.detail === "string"
            ? reason.detail
            : reason instanceof Error ? reason.message : String(reason);
          return `${label}: ${message}`;
        }),
        ...interactionResult.failures,
      ];
      setResourceError(resourceFailures.length ? { detail: resourceFailures.join(" ") } : null);
      const staysOnCurrentProject = nextProjectId === activeProjectId
        || (!activeProjectId && !initialLocation.projectId && Boolean(initialLocation.taskId));
      const selectionIsAvailable = taskResult.status === "rejected"
        ? staysOnCurrentProject && Boolean(selectedTaskId)
        : nextTasks.some((task) => task.task_id === selectedTaskId);
      const taskId = keepSelection && staysOnCurrentProject && selectionIsAvailable ? selectedTaskId : null;
      setSelectedTaskId(taskId);
      writeTaskLocation({ projectId: nextProjectId, taskId });
      setLoaded(true);
      return { tasks: nextTasks, projectId: nextProjectId };
    } catch (refreshError) {
      const message = refreshError instanceof Error ? refreshError.message : String(refreshError);
      setConnectionState("offline");
      setOperatorRequests([]);
      setOperatorRequestsAvailable(false);
      setError(message);
      setResourceError(refreshError);
      setLoaded(true);
      return { tasks, projectId: activeProjectId, error: refreshError };
    }
  }, [activeProjectId, config, initialLocation.projectId, selectedTaskId, tasks]);

  const refreshRef = useRef(refresh);
  useEffect(() => { refreshRef.current = refresh; }, [refresh]);
  useEffect(() => { void refreshRef.current(); }, []);

  useEffect(() => {
    if (!pendingSubmission || pendingSubmission.projectId !== activeProjectId || connectionState === "offline" || !loaded) return undefined;
    let cancelled = false;
    let timeoutId = null;
    const poll = async () => {
      const refreshed = await refreshRef.current({ projectId: pendingSubmission.projectId, silent: true });
      if (cancelled) return;
      const task = refreshed.tasks.find((entry) => entry?.lineage?.intent_submission_id === pendingSubmission.submissionId) ?? null;
      if (task) {
        setSelectedTaskId(task.task_id);
        writeTaskLocation({ projectId: pendingSubmission.projectId, taskId: task.task_id });
        if (task.status !== "draft" || !["submitted", "preparing"].includes(task.status_detail)) {
          setPendingSubmission((current) => current?.submissionId === pendingSubmission.submissionId ? null : current);
          return;
        }
      }
      timeoutId = window.setTimeout(poll, 1000);
    };
    timeoutId = window.setTimeout(poll, 1000);
    return () => {
      cancelled = true;
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    };
  }, [activeProjectId, connectionState, loaded, pendingSubmission]);

  useEffect(() => {
    if (!apiProjectBase || !liveRunIds.length || typeof EventSource === "undefined") return undefined;
    const stops = liveRunIds.map((liveRunId) => subscribeToLiveRunEvents({
      eventSourceUrl: `${apiProjectBase}/runs/${encodeURIComponent(liveRunId)}/events`,
      onEvent: () => { void refreshRef.current({ silent: true }); },
      EventSourceImpl: EventSource,
    }));
    return () => stops.forEach((stop) => stop());
  }, [apiProjectBase, liveRunIds]);

  async function runBusyAction(operation, onError = (actionError) => {
    setError(errorMessage(actionError));
    return null;
  }) {
    setBusy(true);
    setError("");
    try {
      return await operation();
    } catch (actionError) {
      return await onError(actionError);
    } finally {
      setBusy(false);
    }
  }

  function trackAcceptedSubmission(projectId, submissionId) {
    setPendingSubmission({ projectId, submissionId });
    setSelectedTaskId(null);
    writeTaskLocation({ projectId });
  }

  async function runTaskAction(task, action, payload = {}) {
    if (!apiProjectBase || !task?.task_id || busy) return null;
    return runBusyAction(async () => {
      const result = await postJson(`${apiProjectBase}/tasks/${encodeURIComponent(task.task_id)}/actions`, { action, ...payload });
      if (["pause", "resume"].includes(action)) await new Promise((resolve) => window.setTimeout(resolve, 300));
      const followUpSubmissionId = action === "follow-up" ? result?.intent_submission?.submission_id : null;
      if (typeof followUpSubmissionId === "string" && followUpSubmissionId) {
        trackAcceptedSubmission(activeProjectId, followUpSubmissionId);
        void refresh({ silent: true, keepSelection: false });
      } else {
        await refresh({ silent: true });
      }
      return result;
    }, async (actionError) => {
      const message = errorMessage(actionError);
      await refresh({ silent: true });
      setError(message);
      return null;
    });
  }

  async function answerInteraction(interaction, answerPayload) {
    if (!apiProjectBase || !interaction?.run_id || !interaction?.interaction_id || busy) {
      throw new Error("The runner interaction is unavailable until its run is selected.");
    }
    return runBusyAction(async () => {
      const result = await postJson(`${apiProjectBase}/interactions/answers`, { run_id: interaction.run_id, interaction_id: interaction.interaction_id, ...answerPayload });
      await refresh({ silent: true });
      return result;
    }, async (answerError) => {
      await refresh({ silent: true });
      throw answerError;
    });
  }

  async function resumeOperatorRequest(operatorRequest) {
    const requestId = operatorRequest?.document?.request_id;
    const requestRef = operatorRequest?.operator_request_ref;
    if (!apiProjectBase || !requestId || !requestRef || busy) return null;
    return runBusyAction(async () => {
      const result = await postJson(`${apiProjectBase}/operator-requests/${encodeURIComponent(requestId)}/actions`, { action: "run", request_ref: requestRef });
      await refresh({ silent: true });
      return result;
    }, async (actionError) => {
      setError(errorMessage(actionError));
      await refresh({ silent: true });
      return null;
    });
  }

  async function createTask({ requestText, attachments = [], markdownSources = [], sourceSubmissionId = null, sourceIds = [], preparationRouteId } = {}) {
    if (!apiProjectBase || busy) return null;
    return runBusyAction(async () => {
      const created = await postJson(`${apiProjectBase}/intent-submissions`, { request_text: requestText, attachments, markdown_sources: markdownSources, ...(sourceSubmissionId ? { source_submission_id: sourceSubmissionId, source_ids: sourceIds } : {}), preparation_route_id: preparationRouteId, auto_prepare: true });
      const submissionId = created?.submission?.submission_id;
      if (submissionId) trackAcceptedSubmission(activeProjectId, submissionId);
      const refreshed = await refresh({ silent: true, ...(submissionId ? { keepSelection: false } : {}) });
      const task = refreshed.tasks.find((entry) => entry?.lineage?.intent_submission_id === submissionId) ?? null;
      if (task) {
        setSelectedTaskId(task.task_id);
        writeTaskLocation({ projectId: activeProjectId, taskId: task.task_id });
        if (task.status !== "draft" || !["submitted", "preparing"].includes(task.status_detail)) {
          setPendingSubmission((current) => current?.submissionId === submissionId ? null : current);
        }
      }
      return task;
    }, async (createError) => {
      const message = errorMessage(createError);
      await refresh({ silent: true });
      setError(message);
      return null;
    });
  }

  async function reviewTask(task, decision, reason = "") {
    if (!apiProjectBase || !task?.run_ids?.[0] || busy) { setError("Review decision is unavailable until a durable run is selected."); return null; }
    return runBusyAction(async () => {
      const result = await postJson(`${apiProjectBase}/lifecycle-command/actions`, { command: "review decide", flags: { run_id: task.run_ids[0], decision, ...(reason.trim() ? { reason: reason.trim() } : {}) } });
      await refresh({ silent: true });
      return result;
    });
  }

  async function loadTaskReview(taskId, selectedPath = null) {
    if (!apiProjectBase || !taskId) throw new Error("Task review is unavailable until the project is loaded.");
    const query = selectedPath ? `?path=${encodeURIComponent(selectedPath)}` : "";
    return readJson(`${apiProjectBase}/tasks/${encodeURIComponent(taskId)}/review${query}`);
  }

  async function selectRunner(task, step, routeId) {
    if (!task?.task_id || !step || busy) return null;
    return runTaskAction(task, routeId ? "select-runner" : "reset-runner", {
      ...(routeId ? { route_id: routeId } : {}),
      expected_revision: task.revision,
      expected_selection_revision: task.runner_selection?.selection_revision ?? 0,
    });
  }

  async function runExecutionProfileAction(action, route = {}) {
    const revision = executionProfile?.revision;
    if (!apiProjectBase || !Number.isInteger(revision) || busy || (action === "check" && (!route.step || !route.route_id))) return null;
    return runBusyAction(async () => {
      const result = await postJson(`${apiProjectBase}/execution-profile/actions`, { action, ...route, expected_revision: revision });
      if (result?.execution_profile) setExecutionProfile(result.execution_profile);
      await refresh({ silent: true });
      return result;
    }, async (checkError) => {
      const message = errorMessage(checkError);
      await refresh({ silent: true });
      setError(message);
      return null;
    });
  }

  function initializeRunnerProfile() { return runExecutionProfileAction("initialize"); }
  function checkPreparationRunner(routeId) { return runExecutionProfileAction("check", { step: "discovery", route_id: routeId }); }
  function checkExecutionRunner(step, routeId) { return runExecutionProfileAction("check", { step, route_id: routeId }); }

  async function selectProject(projectId) {
    setProjectDialogOpen(false); setSelectedTaskId(null); setTasks([]);
    await refresh({ projectId, keepSelection: false });
  }

  async function connectProject() {
    const sourceValue = projectForm.sourceKind === "git" ? projectForm.gitUrl.trim() : projectForm.projectRef.trim();
    if (!sourceValue || busy) return;
    setProjectResult(null);
    return runBusyAction(async () => {
      const accepted = await postJson("/api/projects/actions", { action: "connect", source: projectForm.sourceKind === "git" ? { kind: "git", url: sourceValue } : { kind: "local", path: sourceValue }, ...(projectForm.label.trim() ? { label: projectForm.label.trim() } : {}) });
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
    }, (connectError) => {
      const message = errorMessage(connectError);
      setProjectResult({ status: "error", message }); setError(message);
      return null;
    });
  }

  async function pickProjectFolder() {
    try {
      const result = await postJson("/api/workspace/folder-picker/actions", { action: "open" });
      if (result.path) setProjectForm((current) => ({ ...current, sourceKind: "local", projectRef: result.path }));
      else setProjectResult({ status: "error", message: result.message || "Native picker is unavailable; enter an absolute path." });
    } catch (pickerError) { setProjectResult({ status: "error", message: pickerError instanceof Error ? pickerError.message : String(pickerError) }); }
  }

  const projectDialog = <ProjectDialog open={projectDialogOpen} projects={projects} activeProjectId={activeProjectId} busy={busy} result={projectResult} form={projectForm} setForm={setProjectForm} onClose={() => setProjectDialogOpen(false)} onSelect={selectProject} onConnect={connectProject} onPickFolder={pickProjectFolder} />;
  if (!loaded) return <><main className="task-app-state aor-ui" role="status"><span>AOR</span><h1>Loading Task Workspace…</h1><p>Reading the server-owned project and Task projection.</p></main>{projectDialog}</>;
  if (!activeProject) return <><EmptyWorkspace onOpenProject={() => setProjectDialogOpen(true)} error={error} onRetry={() => void refresh()} />{projectDialog}</>;

  return <div className="task-app" data-app-surface="task-workspace">
    <TaskWorkspace project={activeProject} tasks={tasks} interactionsByRun={interactionsByRun} operatorRequests={operatorRequests} operatorRequestsAvailable={operatorRequestsAvailable} selectedTaskId={selectedTaskId} pendingPreparation={pendingSubmission?.projectId === activeProjectId} pendingSubmissionId={pendingSubmission?.projectId === activeProjectId ? pendingSubmission.submissionId : null} onStopFollowingPreparation={() => setPendingSubmission((current) => current?.projectId === activeProjectId ? null : current)} onSelectTask={(task) => { const taskId = task?.task_id ?? null; setSelectedTaskId(taskId); writeTaskLocation({ projectId: activeProjectId, taskId }); }} onNewTask={() => { setSelectedTaskId(null); writeTaskLocation({ projectId: activeProjectId }); }} onCreateTask={createTask} onTaskAction={runTaskAction} onAnswerInteraction={answerInteraction} onResumeOperatorRequest={resumeOperatorRequest} executionProfile={executionProfile} onSelectRunner={selectRunner} onCheckPreparationRunner={checkPreparationRunner} onCheckExecutionRunner={checkExecutionRunner} onInitializeRunnerProfile={initializeRunnerProfile} onReviewDecision={reviewTask} loadTaskReview={loadTaskReview} actionBusy={busy} actionError={error} onRefresh={() => void refresh()} onOpenProject={() => { setProjectResult(null); setProjectDialogOpen(true); }} connectionState={connectionState} resourceError={resourceError} />
    {projectDialog}
  </div>;
}

createRoot(document.getElementById("root")).render(<TaskApp />);
