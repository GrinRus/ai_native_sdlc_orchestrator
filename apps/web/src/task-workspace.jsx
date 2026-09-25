import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog } from "./dialog.jsx";
import { AskAorPanel, hasUnfinishedOperatorRequestForTask } from "./task-ask-aor-panel.jsx";
import { TaskInteractionPanel } from "./task-interaction-panel.jsx";
import { MarkdownSourceDialog } from "./task-markdown-source-dialog.jsx";
import { TaskSteeringControl } from "./task-steering-control.jsx";
import { taskAcceptanceCriteria, taskOutcome, taskScopeIsPublished, taskScopeLabel, taskScopePaths } from "./task-projection-content.js";
import { Button, EmptyState, Icon, useRovingTabs } from "./ui/components.jsx";
import { WORK_TYPE_TO_STEP } from "../../../packages/contracts/src/task-work-type.mjs";
import { firstNonNullish } from "../../../packages/contracts/src/value-normalization.mjs";

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

const SIDE_NAV = [
  ["home", "Tasks", "grid"],
  ["attention", "Attention", "alertCircle"],
  ["evidence", "Evidence", "shield"],
  ["project", "Project", "layers"],
];

const NEW_TASK_DRAFT_ID = "__new-task-draft__";
const PROJECT_DEFAULT_ROUTE_OPTION = "__project_default__";

function executionStepFor(task) {
  const publishedStep = String(task?.runner_selection?.step ?? "").trim();
  return publishedStep || WORK_TYPE_TO_STEP[String(task?.work_type ?? "").trim()] || "implement";
}

function interactionsForTask(task, interactionsByRun) {
  const interactions = new Map();
  for (const runId of task?.run_ids ?? []) {
    for (const interaction of interactionsByRun?.[runId] ?? []) interactions.set(interaction.interaction_id, interaction);
  }
  return [...interactions.values()];
}

function routeDisplayLabel(route) {
  const routeId = String(route?.route_id ?? "").trim();
  if (!routeId) return "Runner not selected";
  const name = routeId.replace(/^route\.[^.]+\./u, "").replaceAll("-", " ");
  const provider = String(route?.provider ?? "").trim();
  return provider && provider !== "none" ? `${name} · ${provider}` : name;
}

function executionRouteOptionLabel(route) {
  const label = routeDisplayLabel(route);
  return route?.readiness ? `${label} · ${readinessLabel(route.readiness)}` : label;
}

function preparationRunnerLabel(route) {
  const labels = { "codex-cli": "Codex CLI", "claude-code": "Claude Code", "qwen-code": "Qwen Code" };
  return labels[route?.adapter] || route?.adapter || routeDisplayLabel(route);
}

function readinessLabel(readiness) {
  return {
    ready: "Ready",
    unconfigured: "Check required",
    unknown: "Not checked",
    stale: "Check again",
    "runner-missing": "Runner missing",
    "auth-missing": "Sign in required",
    "model-unsupported": "Model unavailable",
    "capability-mismatch": "Capability mismatch",
    "policy-denied": "Not approved",
    unavailable: "Unavailable",
    blocked: "Blocked",
  }[readiness] || "Status unavailable";
}

function taskDeliveryModeValue(task) {
  return String(firstNonNullish(task?.prepared_contract?.delivery_mode, task?.normalization?.delivery_mode, task?.writeback_policy?.mode, "")).trim();
}

function deliveryMode(task) {
  const value = taskDeliveryModeValue(task);
  return {
    "no-write": "No-write",
    "patch-only": "Patch only",
    "local-branch": "Local branch",
    "fork-first-pr": "Fork-first PR",
    "fork-first": "Fork-first PR",
  }[value] || "Policy pending";
}

function deliveryModeDescription(task) {
  const value = taskDeliveryModeValue(task);
  return {
    "no-write": "This Task produces analysis and evidence without writing repository changes.",
    "patch-only": "Changes are captured as patch evidence; upstream writes remain off.",
    "local-branch": "Changes are delivered to a local branch after explicit approval.",
    "fork-first-pr": "Delivery uses a fork-first pull request after explicit approval.",
    "fork-first": "Delivery uses a fork-first pull request after explicit approval.",
  }[value] || "The server has not published this Task's delivery policy.";
}

function RouteDetails({ route, selection }) {
  if (!route && !selection) return null;
  const capabilities = Array.isArray(route?.required_capabilities) ? route.required_capabilities : [];
  const source = { "task-override": "Task override", "project-default": "Project default" }[selection?.source] ?? "Task preparation";
  const readiness = selection?.readiness ?? route?.readiness;
  const rows = [
    ["Selection", source],
    ["Readiness", readiness ? readinessLabel(readiness) : null],
    ["Readiness revision", selection?.readiness_revision ?? route?.readiness_revision],
    ["Runner", route?.runner || route?.adapter],
    ["Adapter", route?.adapter],
    ["Provider", route?.provider],
    ["Execution mode", route?.mode],
    ["Requested model", route?.requested_model],
    ["Effective model", route?.effective_model],
    ["Requested reasoning", route?.requested_reasoning_effort],
    ["Effective reasoning", route?.effective_reasoning_effort],
    ["Route class", route?.route_class],
    ["Risk tier", route?.risk_tier],
    ["Required capabilities", capabilities.length ? capabilities.join(", ") : "None published"],
    ["Qualification", route?.qualification],
  ];
  return <details className="task-route-details"><summary>Route details</summary><dl>{rows.filter(([, value]) => value !== undefined && value !== null && value !== "").map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></details>;
}

function preparationRecovery(runner) {
  const readiness = runner?.readiness;
  if (!readiness || readiness === "ready") return null;
  const adapterKey = String(runner?.adapter ?? "").replace(/[^a-z0-9]/giu, "_").toUpperCase();
  const recoveryByReadiness = {
    "runner-missing": `Install ${preparationRunnerLabel(runner)} or set AOR_RUNNER_COMMAND_${adapterKey} for the local app, then check again.`,
    "auth-missing": `Sign in to ${preparationRunnerLabel(runner)} and set AOR_AUTH_READY_${adapterKey}=true for the local app, then check again.`,
    stale: "Check this runner again before preparing the task.",
    unconfigured: "Check this runner before preparing the task.",
    unknown: "Check this runner before preparing the task.",
  };
  return recoveryByReadiness[readiness]
    ?? `Resolve ${readinessLabel(readiness).toLowerCase()} for this route before preparing the task.`;
}

function approvedRunnerOptions(executionProfile, step, runnerSelection) {
  const row = Array.isArray(executionProfile?.routes)
    ? executionProfile.routes.find((candidate) => candidate?.step === step)
    : null;
  const options = Array.isArray(row?.approved_routes)
    ? row.approved_routes.filter((candidate) => String(candidate?.route_id ?? "").trim())
    : [];
  const selectedRouteId = String(runnerSelection?.route_id ?? "").trim();
  if (selectedRouteId && !options.some((candidate) => candidate.route_id === selectedRouteId)) {
    options.unshift({
      route_id: selectedRouteId,
      mode: runnerSelection.mode,
      provider: runnerSelection.provider,
      requested_model: runnerSelection.requested_model,
      requested_reasoning_effort: runnerSelection.requested_reasoning_effort,
    });
  }
  return options;
}

function taskStatusLabel(task) { return { queued: "Queued", running: "Running", paused: "Paused", "waiting-input": "Waiting for input", canceling: "Stopping", succeeded: "Run succeeded", failed: "Run failed", canceled: "Canceled" }[task?.run_state?.status] || { draft: "Draft", prepared: "Ready", completed: "Completed", attention: "Needs attention", failed: "Failed", blocked: "Blocked", active: "In progress", running: "Running" }[task?.status] || "Status unavailable"; }

function taskStatusTone(task) { return { paused: "warning", canceling: "warning", failed: "warning", canceled: "warning" }[task?.run_state?.status] || { completed: "neutral", draft: "neutral", prepared: "success", attention: "warning", failed: "warning", blocked: "warning", active: "success", running: "success" }[task?.status] || "warning"; }

function taskRuntimeControls(task) {
  const status = task?.run_state?.status;
  const control = { paused: { action: "resume", canStop: true }, running: { action: "pause", canStop: true } }[status];
  return control ?? { action: null, canStop: false };
}

function operatorControlLabel(control, fallback) { const label = typeof control === "string" ? control : control?.label; return typeof label === "string" && label.trim() ? label.trim() : fallback; }
function runnableTaskAction(task) { const action = task?.primary_action || {}, control = action.operator_control; return [action.category === "mutation", action.permission === "mutate", action.available !== false, action.requires_confirmation !== true, control?.availability !== "blocked", control?.requires_confirmation !== true, Object.keys(action.payload || {}).length === 0].every(Boolean) ? { action_id: action.action_id, label: operatorControlLabel(control, "Run server action") } : null; }
function taskCanOpenReview(task) { return [Array.isArray(task?.review?.changed_paths) ? task.review.changed_paths.length > 0 : false, ["decision-required", "held", "repair-requested", "blocked"].includes(task?.review?.status)].some(Boolean); }

function taskTitle(task) {
  return task?.display_title || "Untitled task";
}

function taskIdLabel(task) {
  const value = String(task?.task_id ?? "").trim();
  if (!value) return "—";
  if (/^T-[A-Z0-9-]+$/u.test(value)) return value;
  const tail = value.split(".").at(-1) || value;
  return tail.length > 16 ? `${tail.slice(0, 13)}…` : tail;
}

function taskRunnerLabel(task) {
  const route = String(task?.runner_selection?.route_id ?? "").trim();
  if (!route) return "—";
  return route.replace(/^route\.[^.]+\./u, "").replaceAll("-", " ");
}

function completionEvidenceRefs(task) {
  return Array.isArray(task?.completion?.evidence_refs) ? task.completion.evidence_refs.filter(Boolean) : [];
}

function taskHasCompletionProof(task) {
  return task?.status === "completed"
    && task?.completion?.status === "complete"
    && task?.completion?.verification_status === "pass"
    && task?.completion?.delivery_status === "pass"
    && Boolean(String(firstNonNullish(task?.completion?.patch_ref, task?.completion?.delivery_manifest_ref, "")).trim())
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
  const actionId = String(task.primary_action?.action_id ?? "").toLowerCase();
  if (["confirm", "start", "prepare", "task.prepare", "intent.resume"].includes(actionId)) return "prepared";
  if (["review", "request_review", "task.review"].includes(actionId)) return "review";
  if (task.status === "prepared" || task.status === "draft") return "prepared";
  if (task.status === "active" || task.status === "running") {
    const step = String(firstNonNullish(task.current_step, task.current_step_label, "")).toLowerCase();
    if (step.includes("review")) return "review";
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

function sourceKindLabel(kind) {
  return kind === "upload-snapshot" ? "Uploaded snapshot" : kind === "repository-markdown" ? "Repository reference" : "Inline text";
}

function TaskTabList({ label, tabs, selected, onSelect, className = "" }) {
  const { getTabProps } = useRovingTabs({ tabs, selected, onSelect });
  const idPrefix = String(label).toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "");
  return <div className={className} role="tablist" aria-label={label}>{tabs.map((tab, index) => {
    const tabId = tab.tabId || `task-tab-${idPrefix}-${tab.id}`;
    return <button {...getTabProps(tab, index)} id={tabId} key={tab.id} type="button" role="tab" aria-selected={selected === tab.id} aria-controls={selected === tab.id ? tab.controls : undefined} className={selected === tab.id ? "is-selected" : ""} onClick={() => onSelect(tab.id)}>{tab.label}{tab.count === undefined ? null : <span>{tab.count}</span>}</button>;
  })}</div>;
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
  const steps = Array.isArray(task?.lifecycle_path?.steps) ? task.lifecycle_path.steps : [];
  if (steps.length === 0) return <p className="task-control-note">Lifecycle path is not published by the server yet.</p>;
  return <ol className={`task-lifecycle task-lifecycle--${variant}`} aria-label="Lifecycle progress">
    {steps.map((step, index) => {
      const id = String(step?.id ?? `step-${index + 1}`);
      const label = String(firstNonNullish(step?.label, step?.title, id));
      const rawState = String(step?.state ?? "upcoming").toLowerCase();
      const state = ["complete", "completed", "done", "passed"].includes(rawState) ? "complete" : rawState === "current" ? "current" : "upcoming";
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

function RunSummary({ task, runnerSelection, projectDefaultSelection = null, title = "Run with", runnerOptions = [], runnerStep = "implement", runnerSelectionEnabled = false, selectionNoteOverride = null, onSelectRunner, onCheckRunner, actionBusy = false }) {
  const runner = runnerSelection?.route_id || "Runner not selected";
  const readiness = runnerSelection?.readiness || "unknown";
  const model = runnerSelection?.effective_model || runnerSelection?.requested_model || "Not published";
  const reasoning = runnerSelection?.effective_reasoning_effort || runnerSelection?.requested_reasoning_effort || "Not published";
  const runnerLabel = routeDisplayLabel({ route_id: runner, provider: runnerSelection?.provider });
  const selectedRouteId = String(runnerSelection?.route_id ?? "");
  const projectDefaultLabel = projectDefaultSelection?.route_id
    ? routeDisplayLabel(projectDefaultSelection)
    : "not configured";
  const selectedRoute = runnerOptions.find((option) => option.route_id === selectedRouteId) ?? projectDefaultSelection;
  const selectedValue = runnerSelection?.source === "task-override" ? selectedRouteId : PROJECT_DEFAULT_ROUTE_OPTION;
  const canSelectRunner = Boolean(onSelectRunner) && runnerSelectionEnabled && runnerOptions.length > 0 && !actionBusy;
  const runnerSelect = <select aria-label="Runner" value={selectedValue} disabled={!canSelectRunner} onChange={(event) => onSelectRunner?.(task, runnerStep, event.target.value === PROJECT_DEFAULT_ROUTE_OPTION ? null : event.target.value)}>
    <option value={PROJECT_DEFAULT_ROUTE_OPTION}>Project default · {projectDefaultLabel}</option>
    {runnerOptions.map((option) => <option key={option.route_id} value={option.route_id}>{executionRouteOptionLabel(option)}</option>)}
  </select>;
  const selectionNote = selectionNoteOverride || (runnerSelectionEnabled && runnerOptions.length
    ? "Choose a Task override or follow the project default. Check the selected route before starting."
    : "No approved execution route is published for this project yet.");
  if (title === "Runner & safety") {
    return <section className="task-run-summary task-run-summary--prepared" aria-label="Runner readiness">
      <h2>{title}</h2>
      <div className="task-runner-card"><span className="task-runner-card__icon"><Glyph name="terminal" /></span><div><strong>{runnerLabel}</strong><span className={`task-readiness task-readiness--${readiness}`}><span className="task-readiness__dot" aria-hidden="true" />{readinessLabel(readiness)}</span></div><span className="task-runner-card__check" aria-hidden="true">{readiness === "ready" ? "✓" : "!"}</span></div>
      <label className="task-change-runner">Change runner{runnerSelect}</label>
      {onCheckRunner ? <div className="task-preparation-runner__actions"><Button onClick={() => onCheckRunner(runnerStep, selectedRouteId)} disabled={actionBusy || !selectedRouteId} busy={actionBusy}>Check runner</Button></div> : null}
      <p className="task-control-note">{selectionNote}</p>
      <RouteDetails route={selectedRoute} selection={runnerSelection} />
      <dl className="task-runner-details"><div><dt>Model</dt><dd>{model}</dd></div><div><dt>Reasoning</dt><dd>{reasoning}</dd></div><div><dt>Safety</dt><dd>{deliveryMode(task)}</dd></div></dl>
      <p className="task-safety"><Glyph name="evidence" />No upstream writes</p>
      {runnerSelection?.unavailable_reason ? <p className="task-inline-alert" role="alert">{runnerSelection.unavailable_reason} {runnerSelection.recovery_action}</p> : null}
    </section>;
  }
  return <section className="task-run-summary" aria-label="Runner readiness">
    <h2>{title}</h2>
    <div className="task-run-field task-run-field--runner"><span>Runner</span>{runnerSelect}<span className={`task-readiness task-readiness--${readiness}`}><span className="task-readiness__dot" aria-hidden="true" />{readinessLabel(readiness)}</span></div>
    <p className="task-control-note">{selectionNote}</p>
    <RouteDetails route={selectedRoute} selection={runnerSelection} />
    <div className="task-run-field"><span>Model / effort</span><select aria-label="Model and reasoning effort" value={`${model} · ${reasoning}`} disabled onChange={() => {}}><option>{model} · {reasoning}</option></select></div>
    <div className="task-run-field"><span>Safety</span><select aria-label="Safety mode" value={deliveryMode(task)} disabled onChange={() => {}}><option>{deliveryMode(task)}</option></select></div>
    <p className="task-safety"><Glyph name="evidence" />No upstream writes</p>
    <small className="task-provider-note">Readiness checks do not start a runner. The selected route runs when the task reaches this step.</small>
    {runnerSelection?.unavailable_reason ? <p className="task-inline-alert" role="alert">{runnerSelection.unavailable_reason} {runnerSelection.recovery_action}</p> : null}
  </section>;
}

function PreparationRunnerSummary({ executionProfile, runnerOptions = [], selectedRouteId = "", onSelect, onCheck, onInitialize, actionBusy = false }) {
  const initialized = executionProfile?.initialized === true;
  const canInitialize = Number.isInteger(executionProfile?.revision);
  const runner = runnerOptions.find((option) => option.route_id === selectedRouteId) ?? null;
  const readiness = runner?.readiness ?? "unknown";
  const ready = initialized && runner?.readiness === "ready";
  return <section className="task-run-summary task-run-summary--preparation" aria-label="Task preparation runner">
    <h2>Prepare with</h2>
    {initialized ? runnerOptions.length ? <>
      <label className="task-run-field task-run-field--runner"><span>AI runner</span><select aria-label="Task preparation runner" value={selectedRouteId} disabled={actionBusy} onChange={(event) => onSelect?.(event.target.value)}>
        {runnerOptions.map((option) => <option key={option.route_id} value={option.route_id}>{preparationRunnerLabel(option)} · {readinessLabel(option.readiness)}</option>)}
      </select><span className={`task-readiness task-readiness--${readiness}`}><span className="task-readiness__dot" aria-hidden="true" />{readinessLabel(readiness)}</span></label>
      <div className="task-preparation-runner__actions"><Button onClick={() => onCheck?.(selectedRouteId)} disabled={actionBusy || !selectedRouteId} busy={actionBusy}>Check runner</Button></div>
      <p className="task-control-note">This runner prepares the brief in read-only mode. The task's execution route is selected separately.</p>
      <RouteDetails route={runner} selection={{ source: "task-preparation", readiness, readiness_revision: runner?.readiness_revision }} />
      {runner?.requested_model ? <dl className="task-runner-details"><div><dt>Model</dt><dd>{runner.effective_model || runner.requested_model}</dd></div>{runner.effective_reasoning_effort || runner.requested_reasoning_effort ? <div><dt>Reasoning</dt><dd>{runner.effective_reasoning_effort || runner.requested_reasoning_effort}</dd></div> : null}<div><dt>Runner</dt><dd>{preparationRunnerLabel(runner)}</dd></div></dl> : null}
      <p className="task-safety"><Glyph name="evidence" />No repository writes during preparation</p>
      {!ready ? <p className="task-inline-alert" role="status">{preparationRecovery(runner) || "Select and check a task-preparation runner before creating the task."}</p> : null}
    </> : <>
      <p className="task-control-note">No approved task-preparation routes are published for this project.</p>
      <p className="task-inline-alert" role="status">Review the project's route configuration before preparing a task.</p>
    </> : <>
      <p className="task-control-note">Set up the project's local AOR runner profile to choose a task-preparation runner.</p>
      <p className="task-safety"><Glyph name="evidence" />Profile data is stored under AOR Home</p>
      <div className="task-preparation-runner__actions"><Button variant="primary" onClick={onInitialize} disabled={!canInitialize || actionBusy} busy={actionBusy}>Set up runner profile</Button></div>
    </>}
  </section>;
}

function TaskMeta({ task, project }) {
  const runner = task?.runner_selection?.route_id || "Runner not selected";
  return <dl className="task-meta">
    <div><dt>Repository</dt><dd>{project?.display_name || project?.label || "Project"}</dd></div>
    <div><dt>Runner</dt><dd>{runner.replace(/^route\.[^.]+\./u, "")}</dd></div>
    <div><dt>Safety mode</dt><dd>{deliveryMode(task)}</dd></div>
  </dl>;
}

function TaskCard({ task, selected, onSelect }) {
  const statusDetail = task?.status_detail || (task?.status === "attention" ? "Needs attention" : taskStatusLabel(task));
  return <button type="button" className={`task-workspace__card task-list-row${selected ? " is-selected" : ""}`} onClick={() => onSelect(task)}>
    <span className="task-list-row__id" title={task?.task_id || undefined}><span className="task-list-row__id-dot" aria-hidden="true" /><span className="task-list-row__id-label">{taskIdLabel(task)}</span></span>
    <span className="task-list-row__content"><strong>{taskTitle(task)}</strong><span>{task?.work_type || (task?.status === "attention" ? "Needs approval" : "Task outcome")}</span></span>
    <span className={`task-list-row__status task-status--${taskStatusTone(task)} task-list-row__status--${task?.status || "unknown"}`}><span className="task-status__dot" aria-hidden="true" /><span>{taskStatusLabel(task)}</span><small>{statusDetail}</small></span>
    <time>{taskAge(task?.updated_at)}</time>
    <span className="task-list-row__runner">{taskRunnerLabel(task)}</span>
    <Glyph name="chevronRight" />
  </button>;
}

function TaskGroup({ title, count, tasks, selectedTaskId, onSelect }) {
  const [collapsed, setCollapsed] = useState(false);
  if (!tasks.length) return null;
  const groupId = `task-group-${title.toLowerCase().replace(/[^a-z0-9]+/gu, "-")}`;
  const groupClass = title.toLowerCase().replace(/[^a-z0-9]+/gu, "-");
  const groupIcon = title === "Needs attention" ? "alertCircle" : title === "Active" ? "lightning" : title === "Completed" ? "history" : "clipboard";
  return <section className={`task-list-group task-list-group--${groupClass}`} id={groupId}><header><h3><Glyph name={groupIcon} />{title}</h3><span>{count}</span><button type="button" aria-label={`${collapsed ? "Expand" : "Collapse"} ${title}`} aria-expanded={!collapsed} aria-controls={groupId} className={`task-plain-icon${collapsed ? " is-collapsed" : ""}`} onClick={() => setCollapsed((value) => !value)}><Glyph name="chevronDown" /></button></header>{collapsed ? null : tasks.map((task) => <TaskCard key={task.task_id} task={task} selected={task.task_id === selectedTaskId} onSelect={onSelect} />)}</section>;
}

function TaskShortcutList() {
  return <div className="task-workspace__shortcuts" aria-label="Keyboard shortcuts">
    <p><kbd>⌘K</kbd><span>Command palette</span></p>
    <p><kbd>/</kbd><span>Search tasks</span></p>
    <p><kbd>N</kbd><span>New task</span></p>
    <p><kbd>A</kbd><span>Attention</span></p>
    <p><kbd>E</kbd><span>Evidence</span></p>
    <p><kbd>?</kbd><span>Help</span></p>
  </div>;
}

function HelpDialog({ open, onClose }) { return <Dialog open={open} onClose={onClose} labelledBy="task-help-dialog-title" className="task-project-dialog"><header className="task-project-dialog__header"><div><span>Task Workspace</span><h2 id="task-help-dialog-title">Help and shortcuts</h2></div><Button size="compact" onClick={onClose}>Close</Button></header><section><h3>Keyboard shortcuts</h3><p>⌘K or / search · N new task · A attention · E evidence · question help</p><h3>Task flow</h3><p>Prepare is read-only. Start is the explicit boundary for execution. Review, checks, and delivery evidence must pass before completion.</p><p>No upstream writes are performed by the Task Workspace.</p></section></Dialog>; }
function TasksHome({ tasks, selectedTask, selectedTaskId, onSelect, onNewTask, project, totalTaskCount = tasks.length }) {
  const groups = [
    ["Needs attention", tasks.filter((task) => task.status === "attention")],
    ["Active", tasks.filter((task) => ["active", "running"].includes(task.status))],
    ["Ready", tasks.filter((task) => ["draft", "prepared"].includes(task.status))],
    ["Completed", tasks.filter((task) => task.status === "completed")],
  ];
  return <div className="task-home-layout">
    <div className="task-list-pane" aria-label="Task list"><div className="task-queue-header" aria-hidden="true"><span>ID</span><span>Task</span><span>Status</span><span>Updated</span><span>Runner</span><span /></div>{groups.map(([title, groupTasks]) => <TaskGroup key={title} title={title} count={groupTasks.length} tasks={groupTasks} selectedTaskId={selectedTaskId} onSelect={onSelect} />)}{!tasks.length ? <EmptyState title={totalTaskCount ? "No matching tasks" : "No tasks yet"}>{totalTaskCount ? "Try a different search or clear the filter." : "Start with a plain-language outcome and review the prepared task before it can write."}</EmptyState> : null}</div>
    <div className="task-detail-pane">{selectedTask ? <TaskHomeDetail task={selectedTask} project={project} onOpen={() => onSelect(selectedTask)} /> : <EmptyState title="Select a task">Choose a task to see its server-owned state and next action.</EmptyState>}</div>
  </div>;
}

function TaskHomeDetail({ task, project, onOpen }) {
  const activity = Array.isArray(task?.activity) ? task.activity : [];
  const stateTitle = task?.status === "attention"
    ? "Waiting for attention"
    : task?.status === "completed"
      ? "Task completed"
      : task?.status === "prepared"
        ? "Ready to start"
        : task?.status === "draft"
          ? "Draft not prepared"
          : task?.status === "active" || task?.status === "running"
            ? "Running"
            : "State not published";
  return <article className="task-home-detail">
    <header className="task-detail-heading"><div><h2>{taskTitle(task)}</h2><TaskStatus task={task} /></div><span className="task-plain-icon" aria-hidden="true"><Glyph name="more" /></span></header>
    <TaskMeta task={task} project={project} />
    <section className="task-state-block"><span className="task-kicker">Current state</span><h3>{stateTitle}</h3><LifecyclePath task={task} /><Button variant="primary" onClick={onOpen}><Glyph name="external" />Open task</Button></section>
    <div className="task-metrics"><Metric icon="clock" value={task?.metrics?.elapsed || "—"} label="elapsed" /><Metric icon="check" value={task?.metrics?.acceptance || "—"} label="acceptance" /><Metric icon="evidence" value={task?.evidence_refs?.length ?? 0} label="evidence" /><Metric icon="clock" value={task?.updated_at ? taskAge(task.updated_at) : "—"} label="updated" /></div>
    <section className="task-activity"><h3>Recent activity</h3>{activity.length ? <ul>{activity.slice(0, 3).map((entry, index) => <li key={`${entry?.id ?? "activity"}-${index}`}><Glyph name="activity" /><span>{entry?.summary || entry?.label || "Recorded activity"}</span><time>{entry?.occurred_at ? taskAge(entry.occurred_at) : "—"}</time></li>)}</ul> : <p className="task-muted">No durable activity has been published for this Task yet.</p>}<button type="button" className="task-link" onClick={onOpen}>View all activity</button></section>
  </article>;
}

function taskEvidenceRecords(tasks) {
  return tasks.flatMap((task) => {
    const refs = [
      ...(Array.isArray(task?.evidence_refs) ? task.evidence_refs : []),
      ...(Array.isArray(task?.review?.evidence_refs) ? task.review.evidence_refs : []),
      ...(Array.isArray(task?.completion?.evidence_refs) ? task.completion.evidence_refs : []),
    ];
    return [...new Set(refs.filter((ref) => typeof ref === "string" && ref.trim()))]
      .map((ref) => ({ ref, task }));
  });
}

function EvidenceIndexDialog({ open, tasks, onClose, onOpenTask }) {
  const [query, setQuery] = useState("");
  const entries = useMemo(() => {
    const term = query.trim().toLowerCase();
    return taskEvidenceRecords(tasks)
      .filter(({ ref, task }) => !term || `${ref} ${taskTitle(task)} ${task?.task_id ?? ""}`.toLowerCase().includes(term))
      .sort((left, right) => String(right.task?.updated_at ?? "").localeCompare(String(left.task?.updated_at ?? "")));
  }, [tasks, query]);
  const taskCount = new Set(entries.map(({ task }) => task?.task_id).filter(Boolean)).size;

  return <Dialog open={open} onClose={onClose} labelledBy="task-evidence-index-title" className="task-evidence-dialog">
    <header className="task-evidence-dialog__header">
      <div><span>Project Evidence</span><h2 id="task-evidence-index-title">Evidence index</h2><p>Search durable evidence references published by Tasks.</p></div>
      <Button size="compact" onClick={onClose}>Close</Button>
    </header>
    <label className="task-evidence-dialog__search" htmlFor="task-evidence-search">Search references<input id="task-evidence-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Task, ID, or evidence reference" /></label>
    <p className="task-evidence-dialog__count" role="status">{entries.length} {entries.length === 1 ? "reference" : "references"} across {taskCount} {taskCount === 1 ? "Task" : "Tasks"}</p>
    {entries.length ? <ul className="task-evidence-dialog__list">{entries.map(({ ref, task }) => <li key={`${task.task_id}:${ref}`}>
      <div><strong>{taskTitle(task)}</strong><span>{taskStatusLabel(task)} · {task.task_id}</span><code title={ref}>{ref}</code></div>
      <Button size="compact" aria-label={`Open task ${taskTitle(task)}`} onClick={() => { onClose(); onOpenTask(task); }}>Open task</Button>
    </li>)}</ul> : <EmptyState title={query.trim() ? "No matching evidence" : "No Task evidence yet"}>{query.trim() ? "Try a task title, task ID, or another part of the reference." : "Durable references appear here when the server publishes them on a Task."}</EmptyState>}
    <p className="task-evidence-dialog__note">The index uses Task projections only. It does not resolve arbitrary files or change runtime state.</p>
  </Dialog>;
}

function ActiveTabPanel({ id, children, hidden = false }) {
  return <div id={`task-active-panel-${id}`} role="tabpanel" aria-labelledby={`task-active-tab-${id}`} tabIndex="0" hidden={hidden} className="task-activity-panel">{children}</div>;
}

function NewTaskScreen({ outcome, setOutcome, selectedSources, onAddSources, onPrepare, onCancel, executionProfile, preparationRunnerOptions, preparationRouteId, onSelectPreparationRunner, onCheckPreparationRunner, onInitializeRunnerProfile, preparationRunnerReady, actionBusy = false, preparing = false, pendingPreparation = false, hidden = false }) {
  const staleSources = selectedSources.filter((source) => source?.stale === true);
  return <div className="task-form-layout" hidden={hidden}>
    <div className="task-form-main">
      <header className="task-form-intro"><span className="task-kicker">Task · Prepare</span><h2>Define the outcome</h2><p>AOR will turn this brief into a bounded, reviewable task before anything runs.</p></header>
      {pendingPreparation ? <p className="task-control-note" role="status">The task request was accepted. Waiting for the server to publish its Task; this page will check again automatically.</p> : null}
      <section className="task-form-section"><header className="task-form-section__heading"><span className="task-form-step" aria-hidden="true">01</span><h2>Outcome</h2><button type="button" className="task-example-link" onClick={() => setOutcome("Make the requested behavior deterministic and covered by focused tests.")} disabled={pendingPreparation}>Use example brief</button></header><label className="task-form-field" htmlFor="task-outcome"><span>What should change?</span><textarea id="task-outcome" name="task-outcome" aria-label="Task outcome" value={outcome} onChange={(event) => setOutcome(event.target.value)} placeholder="Describe the result, not the implementation steps." rows="5" disabled={pendingPreparation} /></label></section>
      <section className="task-form-section"><header className="task-form-section__heading"><span className="task-form-step" aria-hidden="true">02</span><h2>Sources</h2></header>{selectedSources.length ? <div className="task-source-list">{selectedSources.map((source) => <SourceRow key={source.source_id} source={source} />)}</div> : <p className="task-muted">Add a Markdown brief or continue with inline text.</p>}{staleSources.length ? <p className="task-inline-alert" role="alert">Remove stale repository sources and add their current snapshots before preparing this Task.</p> : null}<div className="task-inline-actions"><Button onClick={(event) => onAddSources?.(event.currentTarget)} disabled={pendingPreparation}><Glyph name="plus" />Add Markdown</Button></div></section>
      <section className="task-form-section"><header className="task-form-section__heading"><span className="task-form-step" aria-hidden="true">03</span><h2>Repository</h2></header><div className="task-repository-fields"><label><span>Repository</span><select aria-label="Repository" value="Project default" disabled onChange={() => {}}><option>Project default</option></select></label><label><span>Branch</span><select aria-label="Branch" value="main" disabled onChange={() => {}}><option>main</option></select></label></div><p className="task-muted">Repository and branch follow the active project. Change them from project settings.</p></section>
    </div>
    <PreparationRunnerSummary executionProfile={executionProfile} runnerOptions={preparationRunnerOptions} selectedRouteId={preparationRouteId} onSelect={onSelectPreparationRunner} onCheck={onCheckPreparationRunner} onInitialize={onInitializeRunnerProfile} actionBusy={actionBusy || pendingPreparation} />
    <footer className="task-screen-footer"><Button variant="secondary" onClick={onCancel} disabled={actionBusy}>{pendingPreparation ? "Return to tasks" : "Cancel"}</Button><Button variant="primary" onClick={onPrepare} busy={preparing} disabled={!outcome.trim() || !preparationRunnerReady || staleSources.length > 0 || actionBusy || preparing || pendingPreparation}>{preparing ? "Preparing task…" : pendingPreparation ? "Waiting for server…" : "Prepare task"}</Button></footer>
  </div>;
}

function PreparedScreen({ task, selectedSources, runnerSelection, projectDefaultSelection, runnerOptions, runnerStep, runnerSelectionEnabled, operatorRequests, operatorRequestsAvailable, operatorRequestText, setOperatorRequestText, onTaskAction, onResumeOperatorRequest, onSelectRunner, onCheckRunner, onEdit, onStart, actionBusy, actionError }) {
  const serverOwned = Boolean(task?.task_id);
  const preparationPending = task?.status === "draft" && ["submitted", "preparing"].includes(task?.status_detail);
  const canSelectRunner = runnerSelectionEnabled && serverOwned && task?.status === "prepared";
  const primaryAction = task?.primary_action ?? {};
  const startAction = ["confirm", "start"].includes(String(primaryAction.action_id ?? "")) ? primaryAction.action_id : null;
  const startAvailable = serverOwned && Boolean(startAction) && primaryAction.available !== false && actionBusy !== true;
  const acceptance = taskAcceptanceCriteria(task);
  const scopePublished = taskScopeIsPublished(task);
  const scopePaths = taskScopePaths(task);
  const staleSources = selectedSources.filter((source) => source?.stale === true);
  return <div className="task-prepared-layout"><div className="task-prepared-main"><section className="task-prepared-section"><h2>{taskTitle(task)}</h2>{preparationPending ? <p className="task-control-note" role="status">Task preparation is running on the server. This view updates automatically.</p> : null}<h3>Outcome</h3><p>{taskOutcome(task) || "The server has not published the prepared outcome yet."}</p><h3>Acceptance</h3><ul className="task-check-list">{acceptance.length ? acceptance.map((item, index) => <li key={`${item}-${index}`}>{item}</li>) : <li className="task-muted">Acceptance criteria will appear after server preparation.</li>}</ul></section><section className="task-prepared-section"><h3>Scope</h3><p>{taskScopeLabel(task) || "Bounded scope has not been published yet."}</p></section><section className="task-prepared-section"><h3>Sources</h3>{selectedSources.length ? selectedSources.map((source) => <div className="task-prepared-source" key={source.source_id}><Glyph name="file" /><span>{source?.preview?.filename || source?.preview?.project_relative_path || sourceKindLabel(source?.kind)}</span><span>{sourceKindLabel(source?.kind)}</span><strong className={source?.stale ? "is-stale" : ""}>{source?.stale ? "Stale" : "Current"}</strong></div>) : <p className="task-muted">No external sources attached.</p>}</section>{staleSources.length ? <p className="task-inline-alert" role="alert">{task?.primary_action?.reason || "Remove stale repository sources and add their current snapshots before starting this Task."}</p> : null}<LifecyclePath task={task} variant="wide" /><AskAorPanel task={task} operatorRequests={operatorRequests} operatorRequestsAvailable={operatorRequestsAvailable} operatorRequestText={operatorRequestText} setOperatorRequestText={setOperatorRequestText} onTaskAction={onTaskAction} onResumeOperatorRequest={onResumeOperatorRequest} actionBusy={actionBusy} /></div><aside className="task-prepared-inspector"><RunSummary task={task} runnerSelection={runnerSelection} projectDefaultSelection={projectDefaultSelection} runnerOptions={runnerOptions} runnerStep={runnerStep} runnerSelectionEnabled={canSelectRunner} selectionNoteOverride={preparationPending ? "Runner selection becomes available after task preparation." : null} onSelectRunner={onSelectRunner} onCheckRunner={preparationPending ? null : onCheckRunner} actionBusy={actionBusy} title="Runner & safety" /><div className="task-readiness-checks"><p>{runnerSelection?.readiness === "ready" ? "✓" : "!"} Runner {runnerSelection?.readiness === "ready" ? "ready" : "status not confirmed"}</p><p>{staleSources.length ? "! Sources stale" : selectedSources.length ? "✓ Sources current" : "! Sources not attached"}</p><p>{scopePublished ? "✓" : "!"} Scope {scopePaths.length ? "bounded" : scopePublished ? "published" : "not published"}</p><p>✓ No upstream writes</p></div>{actionError ? <p className="task-inline-alert" role="alert">{actionError}</p> : null}<div className="task-inspector-actions"><Button onClick={onEdit} disabled={actionBusy || preparationPending}>Edit task</Button><Button variant="primary" onClick={() => onStart?.(startAction)} busy={actionBusy} disabled={!startAvailable}>{actionBusy ? "Starting task…" : startAction ? "Start task" : preparationPending ? "Preparing task…" : "Waiting for server action"}</Button></div>{preparationPending ? <p className="task-control-note" role="status">The server has accepted this task and is still preparing it. Runner selection and Start will be available after preparation.</p> : !serverOwned ? <p className="task-control-note" role="status">This Task is not server-owned yet. Start is unavailable until the server publishes a prepared Task.</p> : serverOwned && !startAction ? <p className="task-control-note" role="status">{primaryAction.reason || "The server has not published a runnable action for this Task."}</p> : null}</aside></div>;
}

function RuntimeInspector({ task }) {
  const acceptance = taskAcceptanceCriteria(task);
  return <div className="task-runtime-inspector__content"><h3>Task contract</h3><dl><div><dt>Outcome</dt><dd>{taskOutcome(task) || "Not published"}</dd></div><div><dt>Scope</dt><dd>{taskScopeLabel(task) || "Not published"}</dd></div><div><dt>Acceptance</dt><dd>{acceptance.length ? `${acceptance.length} criteria` : "Not published"}</dd></div><div><dt>Run health</dt><dd><TaskStatus task={task} compact /></dd></div><div><dt>Elapsed</dt><dd>{task?.metrics?.elapsed || "Not reported"}</dd></div><div><dt>Budget</dt><dd>{task?.budget?.remaining || "Not reported"}</dd></div><div><dt>Freshness</dt><dd className="task-freshness">{task?.updated_at ? `Updated ${taskAge(task.updated_at)} ago` : "Unknown"}</dd></div></dl></div>;
}

function ActiveScreen({ task, project, interactions, onAnswerInteraction, operatorRequests, operatorRequestsAvailable, operatorRequestText, setOperatorRequestText, onTaskAction, onResumeOperatorRequest, actionBusy, onReview, onOpenInspector }) {
  const [tab, setTab] = useState("activity");
  const [stopConfirm, setStopConfirm] = useState(false);
  const [stopApprovalRef, setStopApprovalRef] = useState("");
  const activity = Array.isArray(task?.activity) ? task.activity : [];
  const runtimeControls = taskRuntimeControls(task);
  const request = (action, payload) => onTaskAction?.(task, action, payload);
  async function confirmStop() {
    const approvalRef = stopApprovalRef.trim();
    const result = await request("cancel", approvalRef ? { approval_ref: approvalRef } : {});
    if (result) { setStopConfirm(false); setStopApprovalRef(""); }
  }
  return <div className="task-active-layout"><div className="task-active-main"><header className="task-active-heading"><div><h2>{taskTitle(task)}</h2><TaskStatus task={task} /></div><div className="task-inline-actions"><button type="button" className="task-inspector-trigger" onClick={onOpenInspector}><Glyph name="evidence" />Task details</button>{runtimeControls.action ? <Button onClick={() => request(runtimeControls.action)} disabled={actionBusy}><Glyph name={runtimeControls.action === "resume" ? "play" : "pause"} />{runtimeControls.action === "resume" ? "Resume" : "Pause"}</Button> : null}{runtimeControls.canStop ? <Button variant="destructive" onClick={() => setStopConfirm(true)} disabled={actionBusy}><Glyph name="stop" />Stop</Button> : null}</div></header><TaskMeta task={task} project={project} /><TaskInteractionPanel interactions={interactions} onSubmit={onAnswerInteraction} busy={actionBusy} /><TaskSteeringControl task={task} onTaskAction={onTaskAction} actionBusy={actionBusy} /><LifecyclePath task={task} variant="wide" /><TaskTabList label="Task activity sections" className="task-detail-tabs" tabs={[{ id: "activity", tabId: "task-active-tab-activity", label: "Activity", controls: "task-active-panel-activity" }, { id: "changes", tabId: "task-active-tab-changes", label: "Changes", count: task?.review?.changed_paths?.length ?? 0, controls: "task-active-panel-changes" }, { id: "checks", tabId: "task-active-tab-checks", label: "Checks", controls: "task-active-panel-checks" }, { id: "evidence", tabId: "task-active-tab-evidence", label: "Evidence", count: task?.evidence_refs?.length ?? 0, controls: "task-active-panel-evidence" }]} selected={tab} onSelect={(nextTab) => { setTab(nextTab); if (nextTab === "changes") onReview?.(); }} /><ActiveTabPanel id="activity" hidden={tab !== "activity"}>{activity.length ? <ul>{activity.map((entry, index) => <li key={`${entry?.id ?? "activity"}-${index}`}><Glyph name="activity" /><span>{entry?.summary || entry?.label || "Recorded activity"}</span><time>{entry?.occurred_at ? taskAge(entry.occurred_at) : "—"}</time></li>)}</ul> : <p className="task-muted">No durable activity has been published for this Task yet.</p>}</ActiveTabPanel><ActiveTabPanel id="changes" hidden={tab !== "changes"}><p>{task?.review?.changed_paths?.length ? "Recorded changes are ready for review." : "No changed paths have been published yet."}</p><Button onClick={onReview} disabled={!task?.review?.changed_paths?.length}>Open changes</Button></ActiveTabPanel><ActiveTabPanel id="checks" hidden={tab !== "checks"}><ul><li><Glyph name="check" /><span>Verification</span><strong>{task?.review?.verification_status || "pending"}</strong></li><li><Glyph name="check" /><span>Delivery</span><strong>{task?.review?.delivery_status || "pending"}</strong></li></ul></ActiveTabPanel><ActiveTabPanel id="evidence" hidden={tab !== "evidence"}><p>{task?.evidence_refs?.length ? "Durable evidence is attached to this task." : "No evidence has been recorded yet."}</p>{task?.evidence_refs?.length ? <ul>{task.evidence_refs.map((ref) => <li key={ref}><Glyph name="file" /><code>{ref}</code></li>)}</ul> : null}<Button onClick={onReview} disabled={!task?.review?.changed_paths?.length}>Open review evidence</Button></ActiveTabPanel><AskAorPanel task={task} operatorRequests={operatorRequests} operatorRequestsAvailable={operatorRequestsAvailable} operatorRequestText={operatorRequestText} setOperatorRequestText={setOperatorRequestText} onTaskAction={onTaskAction} onResumeOperatorRequest={onResumeOperatorRequest} actionBusy={actionBusy} /></div><aside className="task-runtime-inspector"><RuntimeInspector task={task} /></aside>{stopConfirm ? <div className="task-inline-alert" role="alert"><strong>Stop this task?</strong><p>This requests a durable cancellation and may discard in-flight work.</p><label className="task-stop-approval">Approval reference (if required by project policy)<input value={stopApprovalRef} onChange={(event) => setStopApprovalRef(event.target.value)} placeholder="evidence://…" /></label><div className="task-inline-actions"><Button onClick={() => { setStopConfirm(false); setStopApprovalRef(""); }}>Keep running</Button><Button variant="destructive" onClick={() => void confirmStop()} disabled={actionBusy}>Stop task</Button></div></div> : null}</div>;
}

function AttentionScreen({ tasks, selectedTask, interactions, onAnswerInteraction, operatorRequests, operatorRequestsAvailable, operatorRequestText, setOperatorRequestText, onSelect, onTaskAction, onResumeOperatorRequest, onEditTask, onOpenReview, actionBusy }) {
  const [showEvidence, setShowEvidence] = useState(false);
  const attentionTasks = tasks.filter((task) => task.status === "attention");
  const waitingTasks = tasks.filter((task) => task.status === "active");
  const resolvedTasks = tasks.filter((task) => task.status === "completed");
  const attentionItems = Array.isArray(selectedTask?.attention_items) ? selectedTask.attention_items : [];
  const primaryAction = selectedTask?.primary_action ?? {};
  const action = ["confirm", "request", "retry", "intent.resume"].includes(String(primaryAction.action_id ?? "")) ? primaryAction.action_id : null;
  const requestSubmissionBlocked = ["request", "retry"].includes(action)
    && (operatorRequestsAvailable !== true || hasUnfinishedOperatorRequestForTask(selectedTask, operatorRequests));
  return <div className="task-attention-layout"><div className="task-attention-list"><h2>Needs decision <span>{attentionTasks.length}</span></h2>{attentionTasks.map((task) => <TaskCard key={task.task_id} task={task} selected={task.task_id === selectedTask?.task_id} onSelect={onSelect} />)}<h2>Waiting <span>{waitingTasks.length}</span></h2>{waitingTasks.slice(0, 2).map((task) => <TaskCard key={task.task_id} task={task} selected={false} onSelect={onSelect} />)}<h2>Resolved <span>{resolvedTasks.length}</span></h2>{resolvedTasks.length ? resolvedTasks.slice(0, 2).map((task) => <TaskCard key={task.task_id} task={task} selected={false} onSelect={onSelect} />) : <p className="task-muted">No items</p>}</div><article className="task-attention-detail"><h2>{selectedTask ? operatorControlLabel(primaryAction.operator_control, "Review Task decision") : "No attention item selected"}</h2>{selectedTask ? <><p className="task-attention-task"><Glyph name="warning" />{taskTitle(selectedTask)}</p><div className="task-warning-callout">{primaryAction.reason || selectedTask.status_detail || "Execution is waiting for a server-owned decision."}</div><TaskInteractionPanel interactions={interactions} onSubmit={onAnswerInteraction} busy={actionBusy} /><h3>Recorded blockers</h3>{attentionItems.length ? <ul className="task-bullet-list">{attentionItems.map((item) => <li key={item.item_id || item.consequence}><strong>{item.message || item.consequence || item.summary || "Recorded blocker"}</strong>{item.code ? <code>{item.code}</code> : null}{item.recovery_action ? <span>{item.recovery_action}</span> : null}</li>)}</ul> : <p className="task-muted">No blocker details have been published.</p>}<h3>Safety checks</h3><ul className="task-check-list"><li>✓ No upstream writes</li><li>{selectedTask.scope ? "✓ Scope is bounded" : "! Scope is not published"}</li><li>{selectedTask.evidence_refs?.length ? "✓ Evidence is attached" : "! Evidence is not attached"}</li></ul><section className="task-attention-evidence"><span>Evidence / source</span><button type="button" className="task-link" onClick={() => setShowEvidence((value) => !value)}>{showEvidence ? "Hide evidence" : "View evidence"} <Glyph name="external" /></button>{showEvidence ? <div className="task-evidence-list"><p>Durable references</p>{(selectedTask.evidence_refs || []).map((ref) => <code key={ref}>{ref}</code>)}</div> : null}</section><div className="task-attention-actions">{action ? <Button variant="primary" onClick={() => onTaskAction?.(selectedTask, action, action === "request" ? { expected_revision: selectedTask.revision, request_text: operatorRequestText.trim() || "Request a bounded revision." } : action === "intent.resume" ? {} : { expected_revision: selectedTask.revision })} busy={actionBusy} disabled={actionBusy || primaryAction.available === false || requestSubmissionBlocked}>{actionBusy ? "Applying…" : operatorControlLabel(primaryAction.operator_control, "Apply server action")}</Button> : taskCanOpenReview(selectedTask) ? <Button variant="primary" onClick={() => onOpenReview?.(selectedTask)} disabled={actionBusy}>Open review</Button> : <Button variant="primary" disabled>{operatorControlLabel(primaryAction.operator_control, "Apply server action")}</Button>}{action === "intent.resume" ? <Button variant="secondary" onClick={() => onEditTask?.(selectedTask)} disabled={actionBusy}>Change preparation runner</Button> : null}<span className="task-control-note">Only server-published actions are executable from this view.</span></div><AskAorPanel task={selectedTask} operatorRequests={operatorRequests} operatorRequestsAvailable={operatorRequestsAvailable} operatorRequestText={operatorRequestText} setOperatorRequestText={setOperatorRequestText} onTaskAction={onTaskAction} onResumeOperatorRequest={onResumeOperatorRequest} actionBusy={actionBusy} /></> : <EmptyState title="Select an attention item">Choose an item to review its consequence and evidence.</EmptyState>}</article><aside className="task-attention-inspector"><h3>Task details</h3><dl><div><dt>Revision</dt><dd>{selectedTask?.revision ?? "Not published"}</dd></div><div><dt>Scope</dt><dd>{selectedTask?.scope || "Not published"}</dd></div><div><dt>Tasks</dt><dd>{selectedTask?.attention_items?.length ?? 0}</dd></div><div><dt>Evidence</dt><dd>{selectedTask?.evidence_refs?.length ?? 0} refs</dd></div><div><dt>Updated</dt><dd>{selectedTask?.updated_at ? taskAge(selectedTask.updated_at) : "—"}</dd></div></dl><h3>Activity</h3>{Array.isArray(selectedTask?.activity) && selectedTask.activity.length ? <ol className="task-timeline">{selectedTask.activity.slice(0, 4).map((entry, index) => <li key={`${entry?.id ?? "activity"}-${index}`}>{entry?.summary || entry?.label || "Recorded activity"}<span>{entry?.occurred_at ? taskAge(entry.occurred_at) : "—"}</span></li>)}</ol> : <p className="task-muted">No durable activity has been published.</p>}</aside></div>;
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

function ReviewInspector({ task, review, reviewData, note = "", setNote = () => {} }) {
  const ready = reviewHasRequiredChecks(review, reviewData);
  return <div className="task-review-inspector__content"><h3><span className={`task-check-circle${ready ? "" : " task-check-circle--pending"}`}>{ready ? <Glyph name="check" /> : "!"}</span>{ready ? "Ready for review" : "Review evidence incomplete"}</h3><p>{ready ? "All required checks passed." : "Approval is blocked until verification, reference integrity, and review evidence pass."}</p><ul className="task-check-rows"><CheckRow label="Contract validation" status={review?.verification_status} /><CheckRow label="Focused tests" status={review?.verification_status} /><CheckRow label="Reference integrity" status={review?.delivery_status} /></ul><h4>Delivery</h4><div className="task-delivery-note"><strong>{deliveryMode(task)}</strong><span>No upstream writes</span><p>{deliveryModeDescription(task)}</p></div><label className="task-review-note">Review note<textarea rows="4" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional note for approval or revision" /></label></div>;
}

function CompletionInspector({ task, onFollowUp, onBackToTasks, actionBusy = false }) {
  const proofReady = taskHasCompletionProof(task);
  const deliveryRef = task?.completion?.patch_ref || task?.completion?.delivery_manifest_ref || null;
  return <div className="task-complete-inspector__content"><h3>Closure evidence</h3><dl><div><dt>Task ID</dt><dd>{task?.task_id || "Task"}</dd></div><div><dt>Duration</dt><dd>{task?.metrics?.elapsed || "Not reported"}</dd></div><div><dt>Runner</dt><dd>{task?.runner_selection?.route_id || "Runner not selected"}</dd></div><div><dt>Source revision</dt><dd>{digestLabel(task?.source_items?.[0]?.digest)} <Glyph name="external" /></dd></div><div><dt>Delivery ref</dt><dd>{deliveryRef || "Not published"}</dd></div></dl><p>{proofReady ? "Everything needed to reproduce this result is attached." : "Closure is blocked until the server publishes verification, delivery, and evidence proof."}</p><Button variant="primary" onClick={onFollowUp} busy={actionBusy} disabled={!proofReady}>{actionBusy ? "Preparing…" : "Start follow-up task"} <Glyph name="chevronRight" /></Button><Button onClick={onBackToTasks}>Back to tasks</Button></div>;
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

function ReviewScreen({ task, reviewState, operatorRequests, operatorRequestsAvailable, operatorRequestText, setOperatorRequestText, onTaskAction, onResumeOperatorRequest, onSelectPath, onRetry, onReviewDecision, onOpenInspector, onBackToTasks, actionBusy }) {
  const [section, setSection] = useState("changes");
  const [tab, setTab] = useState("source");
  const [note, setNote] = useState("");
  const [decisionState, setDecisionState] = useState({ status: "idle", message: "" });
  const review = reviewState.data;
  const files = review?.files || [];
  const selectedFile = review?.selected_file || null;
  const staleSource = task?.source_items?.some((source) => source?.stale);
  const runner = task?.runner_selection?.route_id || "Runner not selected";
  const activity = Array.isArray(task?.activity) ? task.activity : [];
  const sourceItems = Array.isArray(task?.source_items) ? task.source_items : [];
  const sourceFreshness = sourceItems.length === 0 ? "not-published" : staleSource ? "pending" : "pass";
  const canApprove = reviewHasRequiredChecks(task?.review, review), serverAction = runnableTaskAction(task);
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
  const sectionContent = section === "activity" ? <div className="task-review-context-panel"><h3>Activity</h3>{activity.length ? <ul>{activity.map((entry, index) => <li key={`${entry?.id ?? "activity"}-${index}`}><Glyph name="activity" /><span>{entry?.summary || entry?.label || "Recorded activity"}</span><time>{entry?.occurred_at ? taskAge(entry.occurred_at) : "—"}</time></li>)}</ul> : <p className="task-muted">No durable activity has been published for this Task yet.</p>}</div> : section === "checks" ? <div className="task-review-context-panel"><h3>Checks</h3><ul className="task-check-rows"><CheckRow label="Verification" status={task?.review?.verification_status} /><CheckRow label="Delivery" status={task?.review?.delivery_status} /><CheckRow label="Source freshness" status={sourceFreshness} /></ul></div> : section === "evidence" ? <div className="task-review-context-panel"><h3>Evidence</h3><p>Only server-materialized references are shown.</p>{(task?.review?.evidence_refs || task?.evidence_refs || []).length ? <ul>{(task?.review?.evidence_refs || task?.evidence_refs || []).map((ref) => <li key={ref}><code>{ref}</code></li>)}</ul> : <p className="task-muted">No durable evidence has been published for this Task yet.</p>}</div> : null;
  return <div className="task-review-screen"><header className="task-context-header"><div className="task-context-title"><button type="button" className="task-context-back" onClick={onBackToTasks}><Glyph name="back" />Tasks</button><span aria-hidden="true">/</span><span>{task?.task_id || "Task"}</span><h2 aria-label="Review Changes">{taskTitle(task)}</h2></div><div className="task-context-meta"><span className="task-context-status task-context-status--review">Review required</span><span className="task-context-runner">{runner}</span><button type="button" className="task-inspector-trigger" onClick={onOpenInspector}><Glyph name="evidence" />Review details</button></div></header><LifecyclePath task={task} variant="context" /><TaskTabList label="Review sections" className="task-context-tabs" tabs={[["activity", "Activity"], ["changes", "Changes"], ["checks", "Checks"], ["evidence", "Evidence"]].map(([id, label]) => ({ id, label, controls: id === "changes" ? "task-change-panel" : `task-review-panel-${id}` }))} selected={section} onSelect={setSection} /><div className="task-review-layout"><aside className="task-review-files"><h3>{files.length} changed files</h3>{files.map((file) => <button type="button" className={file.path === review?.selected_path ? "is-selected" : ""} aria-current={file.path === review?.selected_path ? "true" : undefined} key={file.path} onClick={() => { setSection("changes"); onSelectPath(file.path); }}><Glyph name="file" /><span>{file.path}</span><em>+{file.additions} <b>−{file.deletions}</b></em></button>)}</aside><article className="task-review-main">{staleSource ? <div className="task-review-warning">Documentation source changed after preparation <button type="button" className="task-link" onClick={() => setSection("evidence")}>Compare source revision <Glyph name="external" /></button></div> : null}{reviewState.status === "loading" ? <div className="task-review-state" role="status">Loading recorded patch evidence…</div> : null}{reviewState.status === "error" ? <div className="task-review-state task-review-state--error" role="alert"><strong>Review evidence could not be loaded.</strong><p>{reviewState.error}</p><Button onClick={onRetry}>Retry</Button></div> : null}{section !== "changes" ? <div id={`task-review-panel-${section}`} role="tabpanel" aria-label={`${section} review details`}>{sectionContent}</div> : null}{section === "changes" && reviewState.status === "ready" && files.length === 0 ? <EmptyState title="No recorded changes">This task has no changed paths to review.</EmptyState> : null}{section === "changes" && selectedFile ? <><header><h2>{selectedFile.path}</h2><TaskTabList label="Change presentation" className="task-detail-tabs" tabs={[{ id: "rendered", label: "Rendered", controls: "task-change-panel" }, { id: "source", label: "Source diff", controls: "task-change-panel" }]} selected={tab} onSelect={setTab} /></header>{review?.availability === "truncated" || selectedFile.truncated ? <p className="task-review-truncated" role="status">This diff is truncated to the bounded review limit.</p> : null}<div id="task-change-panel" role="tabpanel" aria-label="Change presentation"><ReviewDiff file={selectedFile} tab={tab} /></div></> : null}</article><aside className="task-review-inspector"><ReviewInspector task={task} review={task?.review} reviewData={review} note={note} setNote={setNote} /></aside><footer className={`task-screen-footer${!canApprove ? " task-screen-footer--gated" : ""}`}>{!canApprove ? <p className="task-review-gate-note" role="status">Approve changes is available after verification, reference integrity, and review evidence all pass.</p> : null}{serverAction ? <Button variant="primary" onClick={async () => { await onTaskAction?.(task, serverAction.action_id, {}); onRetry?.(); }} busy={actionBusy} disabled={actionBusy}>{actionBusy ? "Running…" : serverAction.label}</Button> : null}<Button onClick={() => void decide("request-repair")} disabled={actionBusy || reviewState.status !== "ready"}>{decisionState.status === "pending" ? "Recording…" : "Request revision"}</Button><Button variant="primary" onClick={() => void decide("approve")} busy={actionBusy || decisionState.status === "pending"} disabled={!canApprove || actionBusy || decisionState.status === "pending"}>{decisionState.status === "pending" ? "Recording…" : "Approve changes"}</Button>{decisionState.message ? <span className={`task-inline-status task-inline-status--${decisionState.status}`} role={decisionState.status === "error" ? "alert" : "status"}>{decisionState.message}</span> : null}</footer><AskAorPanel task={task} operatorRequests={operatorRequests} operatorRequestsAvailable={operatorRequestsAvailable} operatorRequestText={operatorRequestText} setOperatorRequestText={setOperatorRequestText} onTaskAction={onTaskAction} onResumeOperatorRequest={onResumeOperatorRequest} actionBusy={actionBusy} /></div></div>;
}

function TruthfulCompletionScreen({ task, onFollowUp, onOpenInspector, onBackToTasks, actionBusy }) {
  const [section, setSection] = useState("summary");
  const evidence = task?.completion?.evidence_refs || task?.evidence_refs || [];
  const changedPaths = task?.review?.changed_paths || [];
  const deliveryRef = task?.completion?.patch_ref || task?.completion?.delivery_manifest_ref || null;
  const runner = task?.runner_selection?.route_id || "Runner not selected";
  const checks = [["Verification", task?.completion?.verification_status || "unknown"], ["Delivery", task?.completion?.delivery_status || "unknown"], ["Review", task?.review?.status || "unknown"]];
  const panel = section === "summary"
    ? <section id="task-completion-panel-summary" className="task-completion-summary" role="tabpanel" aria-labelledby="task-completion-tab-summary"><header><span className="task-complete-icon"><Glyph name="check" /></span><div><h2>Task completed</h2><p>Closure is backed by server-owned verification and delivery evidence.</p></div></header><section className="task-complete-outcome"><h3>Outcome</h3><p>{taskOutcome(task, "The requested outcome was completed.")}</p><div className="task-outcome-stats"><span><Glyph name="file" />{changedPaths.length} files changed</span><span><Glyph name="code" />{deliveryRef ? "Delivery evidence attached" : "Delivery reference pending"}</span></div></section></section>
    : section === "changes"
      ? <section id="task-completion-panel-changes" className="task-review-context-panel" role="tabpanel" aria-labelledby="task-completion-tab-changes"><h3>Changed paths</h3>{changedPaths.length ? <ul>{changedPaths.map((path) => <li key={path}><Glyph name="file" />{path}</li>)}</ul> : <EmptyState title="No changed paths">The server did not attach changed paths to this completion.</EmptyState>}</section>
      : section === "checks"
        ? <section id="task-completion-panel-checks" className="task-review-context-panel" role="tabpanel" aria-labelledby="task-completion-tab-checks"><h3>Verification</h3><ul className="task-check-rows">{checks.map(([label, status]) => <CheckRow key={label} label={label} status={status} />)}</ul></section>
        : <section id="task-completion-panel-evidence" className="task-review-context-panel" role="tabpanel" aria-labelledby="task-completion-tab-evidence"><h3>Evidence</h3><p>References are immutable and server-materialized.</p>{evidence.length ? <ul>{evidence.map((ref) => <li key={ref}><Glyph name="file" /><code>{ref}</code></li>)}</ul> : <EmptyState title="No evidence attached">Closure should not be considered complete without evidence.</EmptyState>}</section>;
  return <div className="task-complete-screen"><header className="task-context-header"><div className="task-context-title"><button type="button" className="task-context-back" onClick={onBackToTasks}><Glyph name="back" />Tasks</button><span aria-hidden="true">/</span><span>{task?.task_id || "Task"}</span><h2 aria-label="Completion & Evidence">{taskTitle(task)}</h2></div><div className="task-context-meta"><span className="task-context-status task-context-status--complete">✓ Completed</span><span className="task-context-runner">{runner}</span><time>{task?.updated_at ? "Updated " + taskAge(task.updated_at) + " ago" : "Time not published"}</time><button type="button" className="task-inspector-trigger" onClick={onOpenInspector}><Glyph name="evidence" />Closure details</button></div></header><LifecyclePath task={task} variant="context" /><TaskTabList label="Completion sections" className="task-context-tabs" tabs={[["summary", "Summary"], ["changes", "Changes"], ["checks", "Checks"], ["evidence", "Evidence"]].map(([id, label]) => ({ id, tabId: `task-completion-tab-${id}`, label, controls: "task-completion-panel-" + id }))} selected={section} onSelect={setSection} /><div className="task-complete-layout"><article className="task-complete-main">{panel}<div className="task-complete-columns"><section><h3>Verification</h3><ul className="task-check-rows">{checks.map(([label, status]) => <CheckRow key={label} label={label} status={status} onView={() => setSection("checks")} />)}</ul></section><section><h3>Delivery</h3><strong className="task-delivery-success">{deliveryRef ? "Delivery evidence is ready" : "Delivery evidence is incomplete"}</strong><p>{deliveryRef || "No delivery reference published."}</p><small>Digest (SHA-256) · {digestLabel(task?.completion?.digest)}</small><small>No upstream writes were performed.</small></section></div></article><aside className="task-complete-inspector"><CompletionInspector task={task} onFollowUp={onFollowUp} onBackToTasks={onBackToTasks} actionBusy={actionBusy} /></aside></div></div>;
}

function CompletionScreen({ task, onFollowUp, onOpenInspector, onBackToTasks, actionBusy }) {
  return <TruthfulCompletionScreen task={task} onFollowUp={onFollowUp} onOpenInspector={onOpenInspector} onBackToTasks={onBackToTasks} actionBusy={actionBusy} />;
}
export function TaskWorkspace({ project, tasks = [], operatorRequests = [], operatorRequestsAvailable = true, interactionsByRun = {}, selectedTaskId = null, pendingPreparation = false, pendingSubmissionId = null, onStopFollowingPreparation, onSelectTask, onNewTask, onCreateTask, onTaskAction, onAnswerInteraction, onResumeOperatorRequest, onSelectRunner, onCheckPreparationRunner, onCheckExecutionRunner, onInitializeRunnerProfile, executionProfile = null, onReviewDecision, loadTaskReview, actionBusy = false, actionError = null, onRefresh, onOpenProject, connectionState = "connected", resourceError = null }) {
  const [screen, setScreen] = useState("home");
  const [navCollapsed, setNavCollapsed] = useState(false); const [helpOpen, setHelpOpen] = useState(false);
  const [evidenceIndexOpen, setEvidenceIndexOpen] = useState(false);
  const [draftMode, setDraftMode] = useState(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [outcome, setOutcome] = useState("");
  const [operatorRequestText, setOperatorRequestText] = useState("");
  const [pendingSources, setPendingSources] = useState([]);
  const [sourceContinuation, setSourceContinuation] = useState({ submissionId: null, sourceIds: [] });
  const sourceOpenerRef = useRef(null);
  const [reviewState, setReviewState] = useState({ status: "idle", data: null, error: "" });
  const [inspectorOpen, setInspectorOpen] = useState(null);
  const [reviewNote, setReviewNote] = useState("");
  const [focusedTaskId, setFocusedTaskId] = useState(selectedTaskId || null);
  const [preparationRunnerChoice, setPreparationRunnerChoice] = useState({ projectId: null, routeId: "" });
  const [preparingTask, setPreparingTask] = useState(false);
  const selectedTask = useMemo(() => {
    if (focusedTaskId === NEW_TASK_DRAFT_ID) return null;
    return (focusedTaskId ? tasks.find((task) => task.task_id === focusedTaskId) : null) ?? tasks.find((task) => task.status === "active") ?? tasks[0] ?? null;
  }, [focusedTaskId, tasks]);
  const selectedInteractions = useMemo(() => interactionsForTask(selectedTask, interactionsByRun), [selectedTask, interactionsByRun]);
  const attentionTask = selectedTask?.status === "attention" ? selectedTask : tasks.find((task) => task.status === "attention");
  const attentionInteractions = useMemo(() => interactionsForTask(attentionTask, interactionsByRun), [attentionTask, interactionsByRun]);
  const selectedSources = Array.isArray(selectedTask?.source_items) ? selectedTask.source_items : [];
  const retainedTaskSources = useMemo(() => {
    const selectedIds = new Set(sourceContinuation.sourceIds);
    return sourceContinuation.submissionId
      ? selectedSources.filter((source) => selectedIds.has(source.source_id) && ["upload-snapshot", "repository-markdown"].includes(source.kind))
      : [];
  }, [selectedSources, sourceContinuation]);
  const sourceItems = useMemo(() => {
    const existingIds = new Set(selectedSources.map((source) => source.source_id));
    const draftItems = pendingSources.map(({ attachment, reference, ...source }) => source).filter((source) => !existingIds.has(source.source_id));
    const taskSources = draftMode === "edit" ? retainedTaskSources : selectedSources;
    return [...taskSources, ...draftItems];
  }, [draftMode, pendingSources, retainedTaskSources, selectedSources]);
  useEffect(() => {
    if (!pendingSubmissionId || pendingSources.length === 0) return;
    const acceptedTask = tasks.some((task) => task?.lineage?.intent_submission_id === pendingSubmissionId);
    if (acceptedTask) {
      setPendingSources([]);
      setSourceContinuation({ submissionId: null, sourceIds: [] });
    }
  }, [pendingSubmissionId, pendingSources.length, tasks]);
  const runnerStep = executionStepFor(selectedTask);
  const profileSelection = Array.isArray(executionProfile?.routes)
    ? executionProfile.routes.find((route) => route?.step === runnerStep)
    : null;
  const runnerSelection = selectedTask?.runner_selection ?? profileSelection ?? { route_id: null, step: runnerStep, readiness: "unknown", recovery_action: "Wait for the server to publish runner readiness." };
  const runnerOptions = approvedRunnerOptions(executionProfile, runnerStep, runnerSelection);
  const runnerSelectionEnabled = executionProfile?.initialized === true && Number.isInteger(executionProfile?.revision);
  const preparationRunnerOptions = Array.isArray(executionProfile?.preparation_runners) ? executionProfile.preparation_runners : [];
  useEffect(() => {
    const projectId = executionProfile?.project_id ?? null;
    const defaultRouteId = preparationRunnerOptions.find((option) => option.route_id?.endsWith(".default"))?.route_id
      ?? preparationRunnerOptions[0]?.route_id
      ?? "";
    setPreparationRunnerChoice((current) => {
      if (current.projectId !== projectId) return { projectId, routeId: defaultRouteId };
      if (preparationRunnerOptions.some((option) => option.route_id === current.routeId)) return current;
      return { projectId, routeId: defaultRouteId };
    });
  }, [executionProfile]);
  const preparationRouteId = preparationRunnerChoice.projectId === (executionProfile?.project_id ?? null)
    ? preparationRunnerChoice.routeId
    : preparationRunnerOptions.find((option) => option.route_id?.endsWith(".default"))?.route_id ?? preparationRunnerOptions[0]?.route_id ?? "";
  const preparationRunnerReady = executionProfile?.initialized === true
    && preparationRunnerOptions.some((option) => option.route_id === preparationRouteId && option.readiness === "ready");
  const visibleTasks = useMemo(() => tasks.filter((task) => {
    const matchesQuery = !query.trim() || `${taskTitle(task)} ${task.work_type ?? ""}`.toLowerCase().includes(query.trim().toLowerCase());
    const matchesFilter = filter === "all" || (filter === "ready" ? ["draft", "prepared"].includes(task.status) : task.status === filter);
    return matchesQuery && matchesFilter;
  }), [tasks, query, filter]);

  const preparedTask = useMemo(() => {
    const text = outcome.trim();
    if (!text || !draftMode || (draftMode === "create" && selectedTask)) return selectedTask;
    const base = selectedTask ?? {
      task_id: null,
      project_id: project?.project_id ?? null,
      status: "prepared",
      status_detail: "Local draft",
      current_step: "prepare",
      current_step_label: "Prepare",
      source_items: sourceItems,
      primary_action: { action_id: "task.start", operator_control: "Start", reason: "Server preparation required", available: false },
      runner_selection: { route_id: null, readiness: "unknown" },
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
      setScreen((current) => ["active", "review", "complete", "attention"].includes(current)
        || (!pendingPreparation && ["new", "sources"].includes(current))
        ? current
        : taskDestination(tasks.find((task) => task.task_id === selectedTaskId)));
    }
  }, [pendingPreparation, selectedTaskId, tasks]);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    setInspectorOpen(null);
  }, [screen]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.defaultPrevented || event.isComposing) return;
      const target = event.target;
      const editing = target instanceof HTMLElement && Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && key === "k") {
        event.preventDefault();
        document.querySelector("#task-search-input")?.focus();
      } else if (!editing && key === "/") {
        event.preventDefault();
        document.querySelector("#task-search-input")?.focus();
      } else if (!editing && key === "n") {
        event.preventDefault();
        startNewTask();
      } else if (!editing && key === "a") {
        event.preventDefault();
        setScreen("attention");
      } else if (!editing && key === "e") {
        event.preventDefault();
        setEvidenceIndexOpen(true);
      } else if (!editing && key === "?") { event.preventDefault(); setHelpOpen(true); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pendingPreparation, screen, selectedTask]);

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
    if (task?.lineage?.intent_submission_id !== pendingSubmissionId) onStopFollowingPreparation?.();
    setDraftMode(null);
    setFocusedTaskId(task?.task_id ?? null);
    onSelectTask?.(task);
    setReviewNote("");
    setScreen(taskDestination(task));
  }

  function startNewTask() {
    if (pendingPreparation) return;
    setDraftMode("create");
    setFocusedTaskId(NEW_TASK_DRAFT_ID);
    setOutcome("");
    setPendingSources([]);
    setSourceContinuation({ submissionId: null, sourceIds: [] });
    onSelectTask?.(null);
    onNewTask?.();
    setScreen("new");
  }

  async function startFollowUpTask(task) {
    const result = await onTaskAction?.(task, "follow-up", { request_text: `Follow up on ${taskTitle(task)}.` });
    if (result?.readback?.follow_up === true) {
      setInspectorOpen(null);
      setScreen("home");
    }
  }

  async function prepareTask() {
    if (!preparationRunnerReady || !preparationRouteId || actionBusy || preparingTask || pendingPreparation) return;
    setPreparingTask(true);
    try {
      const task = await onCreateTask?.({
        requestText: outcome.trim(),
        attachments: pendingSources.flatMap((source) => source.attachment ? [source.attachment] : []),
        markdownSources: pendingSources.flatMap((source) => source.kind === "repository-markdown" && source.reference?.project_relative_path ? [source.reference] : []),
        sourceSubmissionId: sourceContinuation.submissionId,
        sourceIds: sourceContinuation.sourceIds,
        preparationRouteId,
      });
      if (!task?.task_id) return;
      setPendingSources([]);
      setSourceContinuation({ submissionId: null, sourceIds: [] });
      setDraftMode(null);
      setOutcome("");
      setFocusedTaskId(task.task_id);
      onSelectTask?.(task);
      setScreen(taskDestination(task));
    } finally {
      setPreparingTask(false);
    }
  }

  function editTask(task) {
    setDraftMode("edit");
    setOutcome(taskOutcome(task));
    setPendingSources([]);
    setSourceContinuation({
      submissionId: task?.lineage?.intent_submission_id ?? null,
      sourceIds: (Array.isArray(task?.source_items) ? task.source_items : [])
        .filter((source) => ["upload-snapshot", "repository-markdown"].includes(source?.kind))
        .map((source) => source.source_id),
    });
    setScreen("new");
  }

  function addMarkdownSources({ sources = [], pastedText = "", sourceIds = [] } = {}) {
    setPendingSources(sources);
    if (sourceContinuation.submissionId) setSourceContinuation((current) => ({ ...current, sourceIds }));
    if (pastedText.trim()) setOutcome((current) => [current.trim(), pastedText.trim()].filter(Boolean).join("\n\n"));
    setScreen("new");
  }

  function backToTasks() {
    setInspectorOpen(null);
    if (pendingPreparation) {
      onStopFollowingPreparation?.();
      onRefresh?.();
    }
    setScreen("home");
    onSelectTask?.(null);
  }

  const listSelectedTask = visibleTasks.some((task) => task.task_id === selectedTask?.task_id) ? selectedTask : null;
  const filteredTasks = visibleTasks;
  const preparationPending = preparedTask?.status === "draft" && ["submitted", "preparing"].includes(preparedTask?.status_detail);
  const connectionStatus = {
    loading: ["checking", "Checking"],
    connected: ["connected", "Connected"],
    partial: ["partial", "Partial"],
    offline: ["offline", "Offline"],
  }[connectionState] ?? ["unknown", "Status unavailable"];
  const screenTitle = ({ new: "New task", sources: "Tasks", prepared: "Prepared task", active: "Active task", review: taskTitle(selectedTask), complete: taskTitle(selectedTask), attention: "Attention" })[screen] || "Tasks";
  const newTaskScreen = <NewTaskScreen outcome={outcome} setOutcome={setOutcome} selectedSources={sourceItems} onAddSources={(opener) => { sourceOpenerRef.current = opener; setScreen("sources"); }} onPrepare={prepareTask} onCancel={() => { setPendingSources([]); setSourceContinuation({ submissionId: null, sourceIds: [] }); if (pendingPreparation) { onStopFollowingPreparation?.(); onRefresh?.(); } setScreen("home"); }} executionProfile={executionProfile} preparationRunnerOptions={preparationRunnerOptions} preparationRouteId={preparationRouteId} onSelectPreparationRunner={(routeId) => setPreparationRunnerChoice({ projectId: executionProfile?.project_id ?? null, routeId })} onCheckPreparationRunner={onCheckPreparationRunner} onInitializeRunnerProfile={onInitializeRunnerProfile} preparationRunnerReady={preparationRunnerReady} actionBusy={actionBusy} preparing={preparingTask} pendingPreparation={pendingPreparation} hidden={screen !== "new"} />;
  const completionScreenByProof = new Map([
    [true, <CompletionScreen task={selectedTask} onFollowUp={() => void startFollowUpTask(selectedTask)} onOpenInspector={() => setInspectorOpen("completion")} onBackToTasks={backToTasks} actionBusy={actionBusy} />],
    [false, <div className="task-review-state task-review-state--error" role="alert"><strong>Closure evidence is not complete.</strong><p>The server has not published verification and delivery proof for this task yet.</p><Button onClick={() => setScreen("review")}>Back to review</Button></div>],
  ]).get(taskHasCompletionProof(selectedTask));
  const screenContent = {
    home: <TasksHome tasks={filteredTasks} totalTaskCount={tasks.length} selectedTask={listSelectedTask} selectedTaskId={listSelectedTask?.task_id} onSelect={chooseTask} onNewTask={startNewTask} project={project} />,
    new: newTaskScreen,
    sources: <>{newTaskScreen}<div className="task-home-underlay"><TasksHome tasks={filteredTasks} totalTaskCount={tasks.length} selectedTask={listSelectedTask} selectedTaskId={listSelectedTask?.task_id} onSelect={chooseTask} onNewTask={() => setScreen("new")} project={project} /></div><MarkdownSourceDialog selectedSources={retainedTaskSources} initialSources={pendingSources} sourceSubmissionId={sourceContinuation.submissionId} openerElementRef={sourceOpenerRef} onClose={() => setScreen("new")} onAdd={addMarkdownSources} /></>,
    prepared: <PreparedScreen task={preparedTask} selectedSources={sourceItems} operatorRequests={operatorRequests} operatorRequestsAvailable={operatorRequestsAvailable} operatorRequestText={operatorRequestText} setOperatorRequestText={setOperatorRequestText} onTaskAction={onTaskAction} onResumeOperatorRequest={onResumeOperatorRequest} runnerSelection={runnerSelection} projectDefaultSelection={profileSelection} runnerOptions={runnerOptions} runnerStep={runnerStep} runnerSelectionEnabled={runnerSelectionEnabled} onSelectRunner={onSelectRunner} onCheckRunner={onCheckExecutionRunner} actionBusy={actionBusy} actionError={actionError} onEdit={() => editTask(preparedTask)} onStart={async (action) => { if (!action) return; const result = await onTaskAction?.(preparedTask, action, { expected_revision: preparedTask?.revision, expected_selection_revision: preparedTask?.runner_selection?.selection_revision ?? 0 }); if (result) setScreen("active"); }} />,
    active: <ActiveScreen task={selectedTask} project={project} interactions={selectedInteractions} onAnswerInteraction={onAnswerInteraction} runnerSelection={runnerSelection} operatorRequests={operatorRequests} operatorRequestsAvailable={operatorRequestsAvailable} operatorRequestText={operatorRequestText} setOperatorRequestText={setOperatorRequestText} onTaskAction={onTaskAction} onResumeOperatorRequest={onResumeOperatorRequest} actionBusy={actionBusy} onReview={() => setScreen("review")} onOpenInspector={() => setInspectorOpen("runtime")} />,
    attention: <AttentionScreen tasks={tasks} selectedTask={attentionTask} interactions={attentionInteractions} onAnswerInteraction={onAnswerInteraction} operatorRequests={operatorRequests} operatorRequestsAvailable={operatorRequestsAvailable} operatorRequestText={operatorRequestText} setOperatorRequestText={setOperatorRequestText} onSelect={chooseTask} onTaskAction={onTaskAction} onResumeOperatorRequest={onResumeOperatorRequest} onEditTask={editTask} onOpenReview={() => setScreen("review")} actionBusy={actionBusy} />,
    review: <ReviewScreen task={selectedTask} reviewState={reviewState} operatorRequests={operatorRequests} operatorRequestsAvailable={operatorRequestsAvailable} operatorRequestText={operatorRequestText} setOperatorRequestText={setOperatorRequestText} onTaskAction={onTaskAction} onResumeOperatorRequest={onResumeOperatorRequest} onSelectPath={(path) => void refreshTaskReview(path)} onRetry={() => void refreshTaskReview(reviewState.data?.selected_path)} onReviewDecision={(decision, reason) => onReviewDecision?.(selectedTask, decision, reason)} onOpenInspector={() => setInspectorOpen("review")} onBackToTasks={backToTasks} actionBusy={actionBusy} />,
    complete: completionScreenByProof,
  };
  const inspectorContent = new Map([
    ["runtime", <RuntimeInspector task={selectedTask} />],
    ["completion", <CompletionInspector task={selectedTask} actionBusy={actionBusy} onBackToTasks={backToTasks} onFollowUp={() => void startFollowUpTask(selectedTask)} />],
    ["review", <ReviewInspector task={selectedTask} review={selectedTask?.review} reviewData={reviewState.data} note={reviewNote} setNote={setReviewNote} />],
  ]).get(inspectorOpen);

  return <section className={`task-workspace-shell aor-ui aor-density-relaxed task-workspace-shell--${screen}${navCollapsed ? " task-workspace-shell--nav-collapsed" : ""}`} aria-label="Task Workspace — server-owned Task projection" data-screen={screen}>
    <aside className="task-workspace__sidebar">
      <div className="task-workspace__logo">AOR</div>
      <button type="button" className="task-workspace__project-switcher" aria-label="Current project" onClick={() => onOpenProject?.()}><Glyph name="layers" /><span>{project?.display_name || project?.label || "Project"}</span><Glyph name="chevronDown" /></button>
      <nav className="task-workspace__side-nav" aria-label="Task navigation">{SIDE_NAV.map(([target, label, icon]) => { const selected = target === "home" ? screen !== "attention" && !evidenceIndexOpen : target === "evidence" ? evidenceIndexOpen : target === screen; const attentionCount = tasks.filter((task) => task.status === "attention").length; return <button type="button" key={label} aria-label={label} className={selected ? "is-selected" : ""} aria-current={selected ? "page" : undefined} onClick={() => target === "home" ? backToTasks() : target === "project" ? onOpenProject?.() : target === "evidence" ? setEvidenceIndexOpen(true) : setScreen(target)}><Glyph name={icon} /><span>{label}</span>{label === "Attention" && attentionCount > 0 ? <span className="task-nav-count">{attentionCount}</span> : null}</button>; })}</nav>
      <div className="task-workspace__sidebar-footer">
        <TaskShortcutList />
        <div className="task-workspace__operator"><span className="task-workspace__operator-dot" aria-hidden="true" /><span>Operator</span><small>Local</small></div>
        <button type="button" className="task-workspace__collapse" aria-label={navCollapsed ? "Expand navigation" : "Collapse navigation"} aria-expanded={!navCollapsed} onClick={() => setNavCollapsed((value) => !value)}><Glyph name="collapse" /></button>
      </div>
    </aside>
    <div className="task-workspace__viewport">
      {connectionState !== "connected" ? <div className={`task-workspace__notice${connectionState === "offline" ? " task-workspace__notice--danger" : ""}`} role={connectionState === "loading" ? "status" : "alert"}><strong>{connectionState === "offline" ? "Tasks are temporarily unavailable." : connectionState === "loading" ? "Loading project data…" : "Some project data is unavailable."}</strong>{connectionState !== "loading" ? <p>{resourceError?.detail || "AOR will not infer lifecycle or next action from stale data."}</p> : null}{connectionState !== "loading" && onRefresh ? <Button onClick={onRefresh}>Retry</Button> : null}</div> : null}
      {actionError ? <div className="task-workspace__notice task-workspace__notice--danger" role="alert"><strong>Task action needs recovery</strong><p>{actionError}</p></div> : null}
      <header className="task-workspace__topbar">
        <div className="task-workspace__breadcrumb">{screen !== "home" && screen !== "attention" && screen !== "sources" ? <button type="button" onClick={backToTasks} aria-label="Back to tasks"><Glyph name="back" />Tasks</button> : null}<div className="task-workspace__title-stack">{screen === "home" ? <span className="task-workspace__product-label">Command Desk</span> : null}<h1 aria-label={SCREENS.find(([id]) => id === screen)?.[1] || screenTitle}>{screenTitle}</h1></div>{screen === "attention" ? <select aria-label="Attention status filter" className="task-title-filter" value="attention" onChange={() => setFilter("attention")}><option value="attention">Open</option></select> : null}{screen === "new" ? <span className="task-draft-label">{pendingPreparation ? "Task accepted" : outcome.trim() ? "Unsaved local draft" : "Draft not saved"}</span> : null}{screen === "prepared" ? <span className={`task-status-chip${preparationPending ? " task-status-chip--preparing" : ""}`}><span />{preparedTask?.status === "prepared" ? "Ready to start" : preparationPending ? "Preparing task…" : taskStatusLabel(preparedTask)}</span> : null}{screen === "prepared" && Number.isInteger(preparedTask?.revision) ? <span className="task-revision-label">Revision {preparedTask.revision}</span> : null}</div>
        <div className="task-workspace__top-actions">{["home", "active", "attention", "prepared"].includes(screen) ? <label className="task-search" htmlFor="task-search-input"><Glyph name="search" /><input id="task-search-input" name="task-search" aria-label="Search tasks" placeholder="Search tasks" value={query} onChange={(event) => setQuery(event.target.value)} /><kbd>/</kbd></label> : null}{["home", "active", "attention", "prepared"].includes(screen) ? <select id="task-filter" name="task-filter" aria-label="Filter tasks" className="task-filter" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All tasks</option><option value="attention">Open</option><option value="active">Active</option><option value="ready">Ready</option><option value="completed">Completed</option></select> : null}<span className={`task-connection-badge task-connection-badge--${connectionStatus[0]}`} role="status" aria-label={`AOR data connection: ${connectionStatus[1]}`} title={`AOR data connection: ${connectionStatus[1]}`}><Glyph name="signal" />{connectionStatus[1]}</span><span className="task-safe-badge"><Glyph name="shield" />{deliveryMode(selectedTask)}</span><button type="button" className="task-top-icon task-top-icon--utility" aria-label="Help" onClick={() => setHelpOpen(true)}><Glyph name="help" /></button><Button variant="primary" onClick={startNewTask} disabled={pendingPreparation} title={pendingPreparation ? "Wait for task preparation to finish or return to the task queue." : undefined}><Glyph name="plus" />New task<kbd aria-hidden="true">N</kbd></Button><button type="button" className="task-top-icon task-top-icon--keyboard" aria-label="Open command palette" onClick={() => document.querySelector('[aria-label="Search tasks"]')?.focus()}><kbd>⌘</kbd></button></div>
      </header>
      <main className="task-workspace__body">
        {screenContent[screen]}
      </main>
    </div>
    <Dialog open={Boolean(inspectorOpen)} onClose={() => setInspectorOpen(null)} labelledBy="task-mobile-inspector-title" className="task-inspector-drawer" backdropClassName="task-inspector-backdrop"><header><h2 id="task-mobile-inspector-title">{({ runtime: "Task details", completion: "Closure details" })[inspectorOpen] || "Review details"}</h2><button type="button" className="task-plain-icon" aria-label="Close details" onClick={() => setInspectorOpen(null)}><Glyph name="close" /></button></header>{inspectorContent}</Dialog>
    <EvidenceIndexDialog open={evidenceIndexOpen} tasks={tasks} onClose={() => setEvidenceIndexOpen(false)} onOpenTask={chooseTask} />
    <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
  </section>;
}
