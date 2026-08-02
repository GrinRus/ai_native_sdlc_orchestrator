import React, { useEffect, useMemo, useState } from "react";

import { Dialog } from "./dialog.jsx";
import { ResourceErrorCard } from "./operator-error-card.jsx";
import "./execution-setup.css";

const RECOVERY_BY_STATUS = Object.freeze({
  unconfigured: "Configure an approved project route.",
  "runner-missing": "Install the approved runner, then check setup again.",
  "auth-missing": "Complete runner authentication outside the browser, then check setup again.",
  "model-unsupported": "Select an approved route with a supported model.",
  "capability-mismatch": "Select a route whose runner satisfies the required capabilities.",
  "policy-denied": "Review the project execution policy or select another approved route.",
  stale: "Check setup again to refresh machine-local readiness.",
  ready: "Execution preflight is current.",
});

function StatusBadge({ value }) {
  return <span className={`execution-status execution-status-${String(value ?? "unknown")}`}>{value ?? "unknown"}</span>;
}

function RouteSummary({ route }) {
  if (!route) return <div className="execution-setup-empty">No approved route is configured for this step.</div>;
  return (
    <div className="execution-route-summary">
      <section><span>Mode</span><strong>{route.mode === "simulation" ? "Simulation" : route.mode === "live" ? "Live execution" : "Unknown"}</strong></section>
      <section><span>Runner</span><strong>{route.runner ?? "Not resolved"}</strong></section>
      <section><span>Provider</span><strong>{route.provider ?? "Not resolved"}</strong></section>
      <section><span>Model</span><strong>{route.effective_model ?? route.requested_model ?? "Not resolved"}</strong><small>{route.model_source ?? "unresolved"}</small></section>
      <section><span>Qualification</span><strong>{route.qualification ?? "unresolved"}</strong></section>
      <section><span>Readiness</span><StatusBadge value={route.readiness} /></section>
    </div>
  );
}

export function ExecutionSetup({ profile, status, error, busy, onRefresh, onAction }) {
  const routes = Array.isArray(profile?.routes) ? profile.routes : [];
  const [step, setStep] = useState("");
  const [routeId, setRouteId] = useState("");
  const [pendingAction, setPendingAction] = useState(null);
  const selected = useMemo(() => routes.find((route) => route.step === step) ?? routes[0] ?? null, [routes, step]);
  const approvedRoutes = selected?.approved_routes ?? [];

  useEffect(() => {
    if (!selected) {
      setStep("");
      setRouteId("");
      return;
    }
    if (!step || !routes.some((route) => route.step === step)) setStep(selected.step);
    setRouteId(selected.route_id ?? "");
  }, [routes, selected?.step, selected?.route_id, step]);

  const requestMutation = (action) => setPendingAction({
    action,
    step: selected?.step,
    route_id: action === "select" ? routeId : null,
  });
  const confirmMutation = async () => {
    const action = pendingAction;
    setPendingAction(null);
    if (action) await onAction(action.action, action);
  };
  const recovery = RECOVERY_BY_STATUS[selected?.readiness] ?? "Inspect the structured blocker and retry the bounded setup action.";

  return (
    <section className="work-card execution-setup" aria-labelledby="execution-setup-title">
      <div className="execution-setup-header">
        <div>
          <p className="eyebrow">Project settings</p>
          <h2 id="execution-setup-title">Execution Setup</h2>
          <p>Select an approved route preset and verify machine-local readiness before provider execution.</p>
        </div>
        <button className="secondary compact" type="button" onClick={onRefresh} disabled={busy}>Refresh setup</button>
      </div>
      {error ? <ResourceErrorCard errors={{ execution_setup: error }} /> : null}
      {status === "loading" ? <div className="execution-setup-empty">Loading approved execution routes…</div> : null}
      {status !== "loading" && profile?.initialized === false ? (
        <div className="execution-setup-empty">No portable project profile is configured. Add or import an AOR Project first.</div>
      ) : null}
      {routes.length > 0 ? (
        <>
          <div className="execution-setup-controls">
            <label>Step class<select value={selected?.step ?? ""} onChange={(event) => setStep(event.target.value)}>
              {routes.map((route) => <option key={route.step} value={route.step}>{route.step}</option>)}
            </select></label>
            <label>Approved route preset<select value={routeId} onChange={(event) => setRouteId(event.target.value)}>
              {approvedRoutes.map((route) => <option key={route.route_id} value={route.route_id}>{route.route_id} · {route.mode}</option>)}
            </select></label>
          </div>
          <RouteSummary route={selected} />
          <details className="execution-setup-advanced">
            <summary>Advanced route details</summary>
            <dl>
              <div><dt>Requested model</dt><dd>{selected?.requested_model ?? "—"}</dd></div>
              <div><dt>Fallback routes</dt><dd>{selected?.fallback?.count ?? 0}</dd></div>
              <div><dt>Capabilities</dt><dd>{selected?.required_capabilities?.join(", ") || "None declared"}</dd></div>
              <div><dt>Evidence</dt><dd>{profile?.latest_readiness_ref ?? "Check setup to create readiness evidence"}</dd></div>
            </dl>
          </details>
          <div className="execution-recovery" role="status" aria-live="polite">
            <strong>{selected?.readiness === "ready" ? "Setup ready" : "Setup requires attention"}</strong>
            <p>{recovery}</p>
          </div>
          <div className="execution-setup-actions">
            <button className="secondary" type="button" onClick={() => onAction("check", { step: selected?.step })} disabled={busy || !selected}>Check setup</button>
            <button className="secondary" type="button" onClick={() => requestMutation("reset")} disabled={busy || !selected}>Reset to inherited default</button>
            <button className="primary" type="button" onClick={() => requestMutation("select")} disabled={busy || !selected || !routeId || routeId === selected.route_id}>Select route</button>
          </div>
        </>
      ) : null}
      <Dialog open={Boolean(pendingAction)} onClose={() => setPendingAction(null)} labelledBy="execution-write-preview-title" className="request-drawer execution-write-preview">
        <div className="drawer-header">
          <div><p className="eyebrow">Write-effect preview</p><h2 id="execution-write-preview-title">Confirm execution route change</h2></div>
          <button className="secondary compact" type="button" onClick={() => setPendingAction(null)}>Close</button>
        </div>
        <p>
          Project <strong>{profile?.project_id}</strong>, step <strong>{pendingAction?.step}</strong>.
          {pendingAction?.action === "select"
            ? <> Select approved route <strong>{pendingAction.route_id}</strong>.</>
            : " Remove the explicit selection and use the inherited project default."}
        </p>
        <p>Readiness becomes stale until the next explicit check. No provider process is started.</p>
        <div className="drawer-actions">
          <button className="secondary" type="button" onClick={() => setPendingAction(null)}>Cancel</button>
          <button className="primary" type="button" onClick={confirmMutation} disabled={busy}>Confirm route change</button>
        </div>
      </Dialog>
    </section>
  );
}
