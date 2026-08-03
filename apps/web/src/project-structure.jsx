import React, { useEffect, useMemo, useState } from "react";

import { Dialog } from "./dialog.jsx";
import { ResourceErrorCard } from "./operator-error-card.jsx";
import { EMPTY_PROJECT_SETUP, parseSetupRows } from "./project-structure-model.js";
import "./project-structure.css";

const STRUCTURE_TABS = ["Overview", "Repositories", "Components", "Dependencies", "Validation"];

export { EMPTY_PROJECT_SETUP, parseSetupRows };

export function AddAorProjectDialog({ open, form, setForm, busy, result, onClose, onSubmit, onPickFolder }) {
  const [confirmClose, setConfirmClose] = useState(false);
  const selectedValue = form.sourceKind === "git" ? form.gitUrl : form.projectRef;
  const dirty = Object.entries(EMPTY_PROJECT_SETUP).some(([key, initial]) => form[key] !== initial);
  const requestClose = () => {
    if (dirty) setConfirmClose(true);
    else onClose();
  };
  const discardAndClose = () => {
    setConfirmClose(false);
    setForm({ ...EMPTY_PROJECT_SETUP });
    onClose();
  };
  useEffect(() => {
    if (open) {
      setConfirmClose(false);
    }
  }, [open]);
  return (
    <>
    <Dialog open={open && !confirmClose} onClose={requestClose} labelledBy="add-aor-project-title" className="request-drawer add-project-drawer project-setup-dialog">
      <div className="drawer-header">
        <div><p className="eyebrow">Code source</p><h2 id="add-aor-project-title">Connect project</h2><p>Choose a local Git folder or clone a Git URL. AOR derives identity, topology, components, and verification suggestions.</p></div>
        <button className="secondary compact" type="button" onClick={requestClose}>Close</button>
      </div>
      <section className="project-setup-step" aria-labelledby="project-setup-step-title">
        <h3 id="project-setup-step-title">Repository</h3>
        <div className="project-setup-fields">
          <label>Source<select value={form.sourceKind} onChange={(event) => setForm({ ...form, sourceKind: event.target.value })}><option value="local">Local Git folder</option><option value="git">Git URL</option></select></label>
          {form.sourceKind === "git" ? <label>HTTPS or SSH Git URL<input value={form.gitUrl} onChange={(event) => setForm({ ...form, gitUrl: event.target.value })} placeholder="git@github.com:org/repository.git" /></label> : <><label>Absolute folder path<input value={form.projectRef} onChange={(event) => setForm({ ...form, projectRef: event.target.value })} placeholder="/path/to/repository" /></label><button className="secondary" type="button" onClick={onPickFolder} disabled={busy}>Choose folder…</button></>}
          <label>Project label<input value={form.label} onChange={(event) => setForm({ ...form, label: event.target.value })} placeholder="Optional name" /></label>
          <p className="field-help">Credentials in URLs are rejected. Git credential helpers and your SSH agent handle authentication.</p>
        </div>
      </section>
      {result ? <div className={result.status === "error" ? "alert" : "success-note"} role="status">{result.message}</div> : null}
      <div className="drawer-actions project-setup-actions">
        <button className="secondary" type="button" onClick={requestClose} disabled={busy}>Cancel</button>
        <button className="primary" type="button" onClick={onSubmit} disabled={busy || !selectedValue.trim()}>Connect code</button>
      </div>
    </Dialog>
    <Dialog open={confirmClose} onClose={() => setConfirmClose(false)} labelledBy="discard-project-draft-title" className="request-drawer">
      <div className="drawer-header">
        <div><p className="eyebrow">Unsaved setup</p><h2 id="discard-project-draft-title">Discard project draft?</h2></div>
        <button className="secondary compact" type="button" onClick={() => setConfirmClose(false)}>Continue editing</button>
      </div>
      <p>The project has not been added. Closing now discards the portable topology and local binding draft.</p>
      <div className="drawer-actions">
        <button className="secondary" type="button" onClick={() => setConfirmClose(false)}>Keep draft</button>
        <button className="primary" type="button" onClick={discardAndClose}>Discard draft</button>
      </div>
    </Dialog>
    </>
  );
}

function StatusBadge({ value }) {
  return <span className={`topology-status topology-status-${String(value ?? "unknown").toLowerCase()}`}>{value ?? "unknown"}</span>;
}

function EntityTable({ rows, columns, empty }) {
  if (!rows?.length) return <div className="project-structure-empty">{empty}</div>;
  return (
    <div className="project-structure-table"><table><thead><tr>{columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr></thead>
      <tbody>{rows.map((row, index) => <tr key={row.id ?? row.repo_id ?? row.component_id ?? index}>{columns.map((column) => <td key={column.key}>{column.render ? column.render(row) : String(row[column.key] ?? "—")}</td>)}</tr>)}</tbody>
    </table></div>
  );
}

export function ProjectStructure({ topology, status, error, busy, onRefresh, onAction, onProjectAction, projectId }) {
  const [tab, setTab] = useState("Overview");
  const [repoDraft, setRepoDraft] = useState({ sourceKind: "local", path: "", url: "", label: "" });
  const [pendingAction, setPendingAction] = useState(null);
  const validation = topology?.latest_validation;
  const bindingsByRepo = useMemo(() => new Map((topology?.bindings ?? []).map((binding) => [binding.repo_id, binding])), [topology]);
  const requestDisable = (family, id) => setPendingAction({
    family,
    action: "disable",
    payload: { id },
    resource: `${family} ${id}`,
  });
  const confirmPendingAction = async () => {
    const action = pendingAction;
    setPendingAction(null);
    if (action) await onAction(action.family, action.action, action.payload);
  };
  const pickAdditionalRepository = async () => {
    const response = await fetch("/api/workspace/folder-picker/actions", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ action: "open" }),
    });
    const result = await response.json();
    if (response.ok && result.path) setRepoDraft((current) => ({ ...current, sourceKind: "local", path: result.path }));
  };
  return (
    <section id="project-structure" className="work-card project-structure" aria-labelledby="project-structure-title">
      <div className="project-structure-header">
        <div><p className="eyebrow">Project settings</p><h2 id="project-structure-title">Project Structure</h2><p>Portable topology and machine-local binding health from the canonical control plane.</p></div>
        <button className="secondary compact" type="button" onClick={onRefresh} disabled={busy}>Refresh structure</button>
      </div>
      <div className="project-structure-tabs" role="tablist" aria-label="Project Structure views">
        {STRUCTURE_TABS.map((label) => <button key={label} type="button" role="tab" aria-selected={tab === label} className={tab === label ? "selected" : ""} onClick={() => setTab(label)}>{label}</button>)}
      </div>
      <div role="tabpanel" aria-label={tab}>
      {error ? <ResourceErrorCard errors={{ topology: error }} /> : null}
      {status === "loading" ? <div className="project-structure-empty">Loading approved topology…</div> : null}
      {status !== "loading" && tab === "Overview" ? (
        <><div className="project-structure-overview">
          <section><span>Profile</span><StatusBadge value={topology?.initialized === false ? "not-initialized" : "available"} /></section>
          <section><span>Revision</span><strong>{topology?.revision ?? "—"}</strong></section>
          <section><span>Repositories</span><strong>{topology?.repositories?.length ?? 0}</strong></section>
          <section><span>Components</span><strong>{topology?.components?.length ?? 0}</strong></section>
          <section><span>Validation</span><StatusBadge value={validation?.status ?? "not-run"} /></section>
        </div>
        <div className="project-structure-actions">
          <button className="secondary" type="button" disabled={busy} onClick={() => onProjectAction?.("refresh-source")}>Refresh source</button>
          <button className="secondary" type="button" disabled={busy} onClick={() => onProjectAction?.("materialize-project-config")}>Materialize project config</button>
          <button className="secondary" type="button" disabled={busy} onClick={() => window.confirm("Disconnect this project? AOR data will be preserved.") && onProjectAction?.("disconnect")}>Disconnect project</button>
          <button className="secondary danger" type="button" disabled={busy} onClick={() => {
            const confirmation = window.prompt(`Delete all AOR data for ${projectId}? Type the project ID to confirm.`);
            if (confirmation === projectId) onProjectAction?.("delete-aor-data", { confirmation });
          }}>Delete AOR data</button>
        </div></>
      ) : null}
      {tab === "Repositories" ? (
        <>
          <div className="project-structure-add-row">
            <label>Source<select value={repoDraft.sourceKind} onChange={(event) => setRepoDraft({ ...repoDraft, sourceKind: event.target.value })}><option value="local">Local Git folder</option><option value="git">Git URL</option></select></label>
            {repoDraft.sourceKind === "git" ? <label>HTTPS or SSH Git URL<input value={repoDraft.url} onChange={(event) => setRepoDraft({ ...repoDraft, url: event.target.value })} /></label> : <><label>Absolute folder path<input value={repoDraft.path} onChange={(event) => setRepoDraft({ ...repoDraft, path: event.target.value })} /></label><button className="secondary" type="button" disabled={busy} onClick={pickAdditionalRepository}>Choose folder…</button></>}
            <label>Repository label<input value={repoDraft.label} onChange={(event) => setRepoDraft({ ...repoDraft, label: event.target.value })} placeholder="Optional name" /></label>
            <button className="secondary" type="button" disabled={busy || !(repoDraft.sourceKind === "git" ? repoDraft.url.trim() : repoDraft.path.trim())} onClick={() => onProjectAction?.("connect-repository", { source: repoDraft.sourceKind === "git" ? { kind: "git", url: repoDraft.url.trim() } : { kind: "local", path: repoDraft.path.trim() }, label: repoDraft.label.trim() || undefined })}>Connect repository</button>
          </div>
          <EntityTable rows={topology?.repositories} empty="No approved repositories." columns={[
            { key: "repo_id", label: "Repository" },
            { key: "workspace_mount", label: "Portable mount" },
            { key: "binding", label: "Local binding", render: (row) => <StatusBadge value={bindingsByRepo.get(row.repo_id)?.inspection?.status ?? "unbound"} /> },
            { key: "state", label: "Lifecycle", render: (row) => row.disabled ? "Disabled" : "Active" },
            { key: "actions", label: "Actions", render: (row) => <button className="secondary compact" type="button" disabled={busy || row.disabled} onClick={() => requestDisable("repository", row.repo_id)}>Disable</button> },
          ]} />
        </>
      ) : null}
      {tab === "Components" ? <EntityTable rows={topology?.components} empty="No approved components." columns={[
        { key: "component_id", label: "Component" }, { key: "repo_id", label: "Repository" }, { key: "root", label: "Relative root" }, { key: "role", label: "Role" },
        { key: "actions", label: "Actions", render: (row) => <button className="secondary compact" type="button" disabled={busy || row.disabled} onClick={() => requestDisable("component", row.component_id)}>Disable</button> },
      ]} /> : null}
      {tab === "Dependencies" ? <EntityTable rows={topology?.dependencies} empty="No component dependencies." columns={[
        { key: "from_component_id", label: "From" }, { key: "to_component_id", label: "To" }, { key: "relationship", label: "Relationship" },
      ]} /> : null}
      {tab === "Validation" ? (
        <div className="project-structure-validation">
          <div className="project-structure-actions">
            <button className="secondary" type="button" onClick={() => onAction("topology", "validate", {})} disabled={busy}>Validate topology</button>
            <button className="secondary" type="button" onClick={() => onAction("topology", "reanalyze", {})} disabled={busy}>Reanalyze suggestions</button>
          </div>
          <StatusBadge value={validation?.status ?? "not-run"} />
          <EntityTable rows={validation?.findings} empty="No blocking topology findings." columns={[
            { key: "code", label: "Finding" }, { key: "severity", label: "Severity" }, { key: "resource", label: "Resource" },
          ]} />
        </div>
      ) : null}
      </div>
      <Dialog open={Boolean(pendingAction)} onClose={() => setPendingAction(null)} labelledBy="topology-write-preview-title" className="request-drawer topology-write-preview-dialog">
        <div className="drawer-header">
          <div><p className="eyebrow">Write-effect preview</p><h2 id="topology-write-preview-title">Confirm topology change</h2></div>
          <button className="secondary compact" type="button" onClick={() => setPendingAction(null)}>Close</button>
        </div>
        <p>Disable {pendingAction?.resource}. Historical evidence keeps the identity, while new planning and readiness checks stop using it.</p>
        <div className="drawer-actions">
          <button className="secondary" type="button" onClick={() => setPendingAction(null)}>Cancel</button>
          <button className="primary" type="button" onClick={confirmPendingAction} disabled={busy}>Confirm change</button>
        </div>
      </Dialog>
    </section>
  );
}
