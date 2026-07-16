import React, { useEffect, useMemo, useState } from "react";

import { Dialog } from "./dialog.jsx";
import { ResourceErrorCard } from "./operator-error-card.jsx";
import { EMPTY_PROJECT_SETUP, parseSetupRows } from "./project-structure-model.js";
import "./project-structure.css";

const SETUP_STEPS = ["Identity", "Topology", "Repositories", "Components", "Dependencies", "Review"];
const STRUCTURE_TABS = ["Overview", "Repositories", "Components", "Dependencies", "Validation"];

export { EMPTY_PROJECT_SETUP, parseSetupRows };

function SetupStep({ step, form, setForm }) {
  if (step === "Identity") {
    return (
      <div className="project-setup-fields">
        <label>Project path<input value={form.projectRef} onChange={(event) => setForm({ ...form, projectRef: event.target.value })} placeholder="/path/to/local-project" /></label>
        <label>Project label<input value={form.label} onChange={(event) => setForm({ ...form, label: event.target.value })} placeholder="Optional operator-facing name" /></label>
        <label>Project profile<input value={form.projectProfile} onChange={(event) => setForm({ ...form, projectProfile: event.target.value })} placeholder="Optional project.aor.yaml path" /></label>
      </div>
    );
  }
  if (step === "Topology") {
    return (
      <div className="project-setup-fields">
        <label>Topology<select value={form.topology} onChange={(event) => setForm({ ...form, topology: event.target.value })}>
          <option value="single-repo">Single repository</option>
          <option value="monorepo">Monorepo with components</option>
          <option value="bounded-multirepo">Bounded multirepo</option>
        </select></label>
        <p className="field-help">Topology is portable project data. Local checkout paths remain in machine-local bindings.</p>
      </div>
    );
  }
  if (step === "Repositories") {
    return (
      <div className="project-setup-fields">
        <label>Additional repositories<textarea value={form.repositories} onChange={(event) => setForm({ ...form, repositories: event.target.value })} placeholder={"docs:repos/docs\nservice:repos/service"} /></label>
        <p className="field-help">One repository per line: repository ID and stable mount path. The primary repository is inferred from the project path.</p>
      </div>
    );
  }
  if (step === "Components") {
    return (
      <div className="project-setup-fields">
        <label>Components<textarea value={form.components} onChange={(event) => setForm({ ...form, components: event.target.value })} placeholder={"api:main:apps/api:service\nweb:main:apps/web:application"} /></label>
        <p className="field-help">One component per line: component ID, repository ID, relative root, and role.</p>
      </div>
    );
  }
  if (step === "Dependencies") {
    return (
      <div className="project-setup-fields">
        <label>Component dependencies<textarea value={form.dependencies} onChange={(event) => setForm({ ...form, dependencies: event.target.value })} placeholder="web:api" /></label>
        <p className="field-help">One directed dependency per line: source component and target component.</p>
      </div>
    );
  }
  return (
    <div className="project-setup-review">
      <section><span>Portable profile</span><strong>{form.topology}</strong><p>{parseSetupRows(form.repositories, ["id", "mount"]).length + 1} repositories · {parseSetupRows(form.components, ["id", "repo", "root", "role"]).length} components</p></section>
      <section><span>Machine-local binding</span><strong>{form.projectRef || "Project path required"}</strong><p>Runtime root preview: {form.runtimeRoot || "<project>/.aor"}</p></section>
      <section className="write-effect-preview"><span>Write-effect preview</span><strong>Add registry entry and approved topology revisions</strong><p>Opening, navigation, and validation do not create <code>.aor</code>. Initialization is a separate confirmed action.</p></section>
    </div>
  );
}

export function AddAorProjectDialog({ open, form, setForm, busy, result, onClose, onSubmit }) {
  const [stepIndex, setStepIndex] = useState(0);
  const [confirmClose, setConfirmClose] = useState(false);
  const step = SETUP_STEPS[stepIndex];
  const canContinue = stepIndex > 0 || form.projectRef.trim().length > 0;
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
      setStepIndex(0);
      setConfirmClose(false);
    }
  }, [open]);
  return (
    <>
    <Dialog open={open && !confirmClose} onClose={requestClose} labelledBy="add-aor-project-title" className="request-drawer add-project-drawer project-setup-dialog">
      <div className="drawer-header">
        <div><p className="eyebrow">Local Workspace</p><h2 id="add-aor-project-title">Add AOR Project</h2></div>
        <button className="secondary compact" type="button" onClick={requestClose}>Close</button>
      </div>
      <ol className="project-setup-steps" aria-label="Project setup steps">
        {SETUP_STEPS.map((label, index) => <li key={label} className={index === stepIndex ? "current" : index < stepIndex ? "complete" : ""}><span>{index + 1}</span>{label}</li>)}
      </ol>
      <section className="project-setup-step" aria-labelledby="project-setup-step-title">
        <h3 id="project-setup-step-title">{step}</h3>
        <SetupStep step={step} form={form} setForm={setForm} />
      </section>
      {result ? <div className={result.status === "error" ? "alert" : "success-note"} role="status">{result.message}</div> : null}
      <div className="drawer-actions project-setup-actions">
        <button className="secondary" type="button" onClick={() => setStepIndex((current) => Math.max(0, current - 1))} disabled={stepIndex === 0 || busy}>Back</button>
        {stepIndex < SETUP_STEPS.length - 1 ? (
          <button className="primary" type="button" onClick={() => setStepIndex((current) => current + 1)} disabled={!canContinue || busy}>Continue</button>
        ) : (
          <>
            <button className="secondary" type="button" onClick={() => onSubmit(false)} disabled={busy || !form.projectRef.trim()}>Add to Local Workspace</button>
            <button className="primary" type="button" onClick={() => onSubmit(true)} disabled={busy || !form.projectRef.trim()}>Confirm writes and initialize</button>
          </>
        )}
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

export function ProjectStructure({ topology, status, error, busy, onRefresh, onAction }) {
  const [tab, setTab] = useState("Overview");
  const [repoDraft, setRepoDraft] = useState({ repo_id: "", mount: "" });
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
  return (
    <section className="work-card project-structure" aria-labelledby="project-structure-title">
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
        <div className="project-structure-overview">
          <section><span>Profile</span><StatusBadge value={topology?.initialized === false ? "not-initialized" : "available"} /></section>
          <section><span>Revision</span><strong>{topology?.revision ?? "—"}</strong></section>
          <section><span>Repositories</span><strong>{topology?.repositories?.length ?? 0}</strong></section>
          <section><span>Components</span><strong>{topology?.components?.length ?? 0}</strong></section>
          <section><span>Validation</span><StatusBadge value={validation?.status ?? "not-run"} /></section>
        </div>
      ) : null}
      {tab === "Repositories" ? (
        <>
          <div className="project-structure-add-row">
            <label>Repository ID<input value={repoDraft.repo_id} onChange={(event) => setRepoDraft({ ...repoDraft, repo_id: event.target.value })} /></label>
            <label>Stable mount<input value={repoDraft.mount} onChange={(event) => setRepoDraft({ ...repoDraft, mount: event.target.value })} placeholder="repos/service" /></label>
            <button className="secondary" type="button" disabled={busy || !repoDraft.repo_id || !repoDraft.mount} onClick={() => onAction("repository", "add", { repo_id: repoDraft.repo_id, name: repoDraft.repo_id, source: { kind: "local", root: "." }, workspace_mount: repoDraft.mount, role: "application" })}>Add repository</button>
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
