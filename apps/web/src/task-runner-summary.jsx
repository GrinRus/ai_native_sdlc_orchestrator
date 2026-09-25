import { Button, Icon } from "./ui/components.jsx";

const PROJECT_DEFAULT_ROUTE_OPTION = "__project_default__";

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
    "auth-missing": "Auth not confirmed",
    "model-unsupported": "Model unavailable",
    "capability-mismatch": "Capability mismatch",
    "policy-denied": "Not approved",
    unavailable: "Unavailable",
    blocked: "Blocked",
  }[readiness] || "Status unavailable";
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
    "runner-missing": `Install ${preparationRunnerLabel(runner)} or set AOR_RUNNER_COMMAND_${adapterKey} in the environment that starts the local AOR app. Restart the app, then check again.`,
    "auth-missing": `AOR does not inspect ${preparationRunnerLabel(runner)}'s credential store. If you have signed in, set AOR_AUTH_READY_${adapterKey}=true in the environment that starts the local AOR app. Restart the app, then check again.`,
    stale: "Check this runner again before preparing the task.",
    unconfigured: "Check this runner before preparing the task.",
    unknown: "Check this runner before preparing the task.",
  };
  return recoveryByReadiness[readiness]
    ?? `Resolve ${readinessLabel(readiness).toLowerCase()} for this route before preparing the task.`;
}

function Glyph({ name }) {
  return <Icon name={name} className={`task-glyph task-glyph--${name}`} />;
}

export function ExecutionRunnerSummary({ task, safetyMode = "Policy pending", runnerSelection, projectDefaultSelection = null, runnerOptions = [], runnerStep = "implement", runnerSelectionEnabled = false, selectionNoteOverride = null, onSelectRunner, onCheckRunner, actionBusy = false }) {
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
  return <section className="task-run-summary task-run-summary--prepared" aria-label="Runner readiness">
    <h2>Runner &amp; safety</h2>
    <div className="task-runner-card"><span className="task-runner-card__icon"><Glyph name="terminal" /></span><div><strong>{runnerLabel}</strong><span className={`task-readiness task-readiness--${readiness}`}><span className="task-readiness__dot" aria-hidden="true" />{readinessLabel(readiness)}</span></div><span className="task-runner-card__check" aria-hidden="true">{readiness === "ready" ? "✓" : "!"}</span></div>
    <label className="task-change-runner">Change runner{runnerSelect}</label>
    {onCheckRunner ? <div className="task-preparation-runner__actions"><Button onClick={() => onCheckRunner(runnerStep, selectedRouteId)} disabled={actionBusy || !selectedRouteId} busy={actionBusy}>Check runner</Button></div> : null}
    {runnerSelection?.unavailable_reason ? <p className="task-inline-alert" role="alert">{runnerSelection.unavailable_reason} {runnerSelection.recovery_action}</p> : null}
    <p className="task-control-note">{selectionNote}</p>
    <RouteDetails route={selectedRoute} selection={runnerSelection} />
    <dl className="task-runner-details"><div><dt>Model</dt><dd>{model}</dd></div><div><dt>Reasoning</dt><dd>{reasoning}</dd></div><div><dt>Safety</dt><dd>{safetyMode}</dd></div></dl>
    <p className="task-safety"><Glyph name="evidence" />No upstream writes</p>
  </section>;
}

export function PreparationRunnerSummary({ executionProfile, runnerOptions = [], selectedRouteId = "", onSelect, onCheck, onInitialize, actionBusy = false }) {
  const initialized = executionProfile?.initialized === true;
  const canInitialize = Number.isInteger(executionProfile?.revision);
  const runner = runnerOptions.find((option) => option.route_id === selectedRouteId) ?? null;
  const readiness = runner?.readiness ?? "unknown";
  const ready = initialized && runner?.readiness === "ready";
  return <section id="task-preparation-runner" className="task-run-summary task-run-summary--preparation" aria-label="Task preparation runner">
    <h2>Prepare with</h2>
    {initialized ? runnerOptions.length ? <>
      <label className="task-run-field task-run-field--runner"><span>AI runner</span><select aria-label="Task preparation runner" value={selectedRouteId} disabled={actionBusy} onChange={(event) => onSelect?.(event.target.value)}>
        {runnerOptions.map((option) => <option key={option.route_id} value={option.route_id}>{preparationRunnerLabel(option)} · {readinessLabel(option.readiness)}</option>)}
      </select><span className={`task-readiness task-readiness--${readiness}`}><span className="task-readiness__dot" aria-hidden="true" />{readinessLabel(readiness)}</span></label>
      <div className="task-preparation-runner__actions"><Button onClick={() => onCheck?.(selectedRouteId)} disabled={actionBusy || !selectedRouteId} busy={actionBusy}>Check runner</Button></div>
      {!ready ? <p className="task-inline-alert" role="status">{preparationRecovery(runner) || "Select and check a task-preparation runner before creating the task."}</p> : null}
      <p className="task-control-note">This runner prepares the brief in read-only mode. The task's execution route is selected separately.</p>
      <RouteDetails route={runner} selection={{ source: "task-preparation", readiness, readiness_revision: runner?.readiness_revision }} />
      {runner?.requested_model ? <dl className="task-runner-details"><div><dt>Model</dt><dd>{runner.effective_model || runner.requested_model}</dd></div>{runner.effective_reasoning_effort || runner.requested_reasoning_effort ? <div><dt>Reasoning</dt><dd>{runner.effective_reasoning_effort || runner.requested_reasoning_effort}</dd></div> : null}<div><dt>Runner</dt><dd>{preparationRunnerLabel(runner)}</dd></div></dl> : null}
      <p className="task-safety"><Glyph name="evidence" />No repository writes during preparation</p>
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
