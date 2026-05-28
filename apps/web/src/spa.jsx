import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import "./spa.css";

const STAGES = [
  { id: "readiness", label: "Readiness", command: "project init", hint: "Environment and guardrails" },
  { id: "mission", label: "Mission", command: "mission create", hint: "Intent and outcomes" },
  { id: "discovery", label: "Discovery / Spec / Plan", command: "discovery run", hint: "Understand and plan" },
  { id: "implement", label: "Execution", command: "run start", hint: "Implement and integrate" },
  { id: "review", label: "Review / QA", command: "review run", hint: "Validate and verify" },
  { id: "delivery", label: "Delivery / Release", command: "deliver prepare", hint: "Package and ship" },
  { id: "learning", label: "Learning", command: "learning handoff", hint: "Retro and improve" },
];

const PROJECT_STAGE_TO_UI_STAGE = {
  onboarding: "readiness",
  "mission-intake": "mission",
  discovery: "discovery",
  "spec-build": "discovery",
  planning: "discovery",
  "run-active": "implement",
  execution: "implement",
  implement: "implement",
  review: "review",
  qa: "review",
  delivery: "delivery",
  release: "delivery",
  learning: "learning",
};

const STAGE_TO_TARGET_STEP = {
  readiness: "discovery",
  mission: "discovery",
  discovery: "discovery",
  implement: "implement",
  review: "review",
  delivery: "implement",
  learning: "review",
};

const READ_ONLY_INSPECTION_INTENTS = new Set(["analyze", "explain", "review", "validate"]);

const SAFE_TEMPLATE_ID = "safe-walkthrough";

const SAFE_TEMPLATE = {
  templateId: SAFE_TEMPLATE_ID,
  title: "First AOR walkthrough",
  brief: "Inspect this repository and recommend the next safe SDLC step.",
  goals: "Produce bounded next-action evidence for this project.",
  constraints: "No upstream writes, no source file edits, no external runner execution.",
  kpi: "first-run-ready:First run readiness:ready:status",
  dod: "A next-action report exists under .aor and no project files were edited.",
  deliveryMode: "no-write",
  allowedPaths: "",
};

const DEFAULT_REQUEST = {
  intent: "analyze",
  requestText: "",
  targetRefs: "",
  allowedPaths: "",
  deliveryMode: "no-write",
  targetStep: "",
};

function splitLines(value) {
  return value
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function splitRefs(value) {
  return value
    .split(/[,\n]/u)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function missionIdFromTitle(title) {
  const base = String(title ?? "flow").toLowerCase().replace(/[^a-z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "");
  return `${base || "flow"}-${Date.now().toString(36)}`;
}

function interactionKey(interaction) {
  return `${interaction.run_id ?? "run"}:${interaction.interaction_id ?? "interaction"}`;
}

async function readJson(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      ...(options.headers ?? {}),
    },
    ...options,
  });
  const raw = await response.text();
  const payload = raw.trim().length > 0 ? JSON.parse(raw) : {};
  if (!response.ok) {
    const message = payload?.error?.message ?? response.statusText;
    throw new Error(message);
  }
  return payload;
}

function resolveUiStageId(nextAction) {
  const projectStage = nextAction?.project_state?.stage;
  return PROJECT_STAGE_TO_UI_STAGE[projectStage] ?? null;
}

function statusTone(state) {
  const normalized = String(state ?? "").toLowerCase();
  if (["connected", "ready", "pass", "completed", "active", "isolated", "no-write", "detached", "enforced"].includes(normalized)) return "safe";
  if (normalized.includes("connected") || normalized.includes("active") || normalized.includes("safe")) return "safe";
  if (normalized.includes("completed") || normalized.includes("enforced")) return "safe";
  if (["blocked", "fail", "failed", "error"].includes(normalized)) return "danger";
  if (normalized.includes("blocked") || normalized.includes("failed") || normalized.includes("error")) return "danger";
  return "warn";
}

function StatusPill({ state }) {
  return <span className={`status-pill ${statusTone(state)}`}>{state}</span>;
}

function Icon({ name }) {
  const paths = {
    refresh: (
      <>
        <path d="M20 12a8 8 0 0 1-13.66 5.66" />
        <path d="M4 12A8 8 0 0 1 17.66 6.34" />
        <path d="M17 2v5h5" />
        <path d="M7 22v-5H2" />
      </>
    ),
    folder: <path d="M3 7h6l2 2h10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />,
    target: (
      <>
        <circle cx="12" cy="12" r="8" />
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
      </>
    ),
    plus: (
      <>
        <path d="M12 5v14" />
        <path d="M5 12h14" />
      </>
    ),
    play: <path d="m8 5 11 7-11 7V5Z" />,
    copy: (
      <>
        <rect x="9" y="9" width="11" height="11" rx="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
      </>
    ),
    close: (
      <>
        <path d="M18 6 6 18" />
        <path d="m6 6 12 12" />
      </>
    ),
    lock: (
      <>
        <rect x="5" y="11" width="14" height="10" rx="2" />
        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      </>
    ),
    shield: (
      <>
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
        <path d="m9 12 2 2 4-4" />
      </>
    ),
    eye: (
      <>
        <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
  };
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      {paths[name] ?? null}
    </svg>
  );
}

function IconButton({ label, children, onClick, disabled = false }) {
  return (
    <button className="icon-button" type="button" onClick={onClick} title={label} aria-label={label} disabled={disabled}>
      {children}
    </button>
  );
}

function Field({ label, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function flowDisplayName(flow) {
  if (!flow) return "New flow draft";
  return flow.mission_id ?? flow.flow_id ?? "selected flow";
}

function isCompletedFlow(flow) {
  return flow?.completed_read_only === true || flow?.status === "completed";
}

function formatKpiForForm(kpi) {
  if (!kpi || typeof kpi !== "object") return "";
  return [kpi.kpi_id, kpi.name, kpi.target, kpi.measurement].filter(Boolean).join(":");
}

function formFromFlowSettings(flow, { followUp = false } = {}) {
  const settings = flow?.mission_settings ?? {};
  const title = settings.title ?? flowDisplayName(flow);
  return {
    templateId: followUp ? "follow-up-from-closure" : "duplicate-mission-settings",
    title: followUp ? `${title} follow-up` : title,
    brief:
      settings.brief ??
      (followUp ? `Continue from completed flow ${flowDisplayName(flow)}.` : "Duplicate mission settings into a fresh flow."),
    goals: Array.isArray(settings.goals) ? settings.goals.join("\n") : "",
    constraints: Array.isArray(settings.constraints) ? settings.constraints.join("\n") : "",
    kpi: Array.isArray(settings.kpis) ? settings.kpis.map(formatKpiForForm).filter(Boolean).join("\n") : "",
    dod: Array.isArray(settings.definition_of_done) ? settings.definition_of_done.join("\n") : "",
    deliveryMode: settings.delivery_mode ?? flow?.writeback_policy?.mode ?? "no-write",
    allowedPaths: Array.isArray(settings.allowed_paths) ? settings.allowed_paths.join(",") : "",
  };
}

function toUiStageId(stageId) {
  return PROJECT_STAGE_TO_UI_STAGE[stageId] ?? stageId ?? "mission";
}

function flowStageId(flow, nextAction, projectState) {
  if (flow?.selected_stage) return toUiStageId(flow.selected_stage);
  return resolveUiStageId(nextAction) ?? (projectState?.state_file ? "mission" : "readiness");
}

function evidenceRowsForFlow(flow, rows) {
  if (!flow?.evidence_refs?.length) return rows;
  const byRef = new Map(rows.map((row) => [row.ref, row]));
  return flow.evidence_refs.map((ref) => byRef.get(ref) ?? {
    kind: "flow-evidence",
    ref,
    label: "flow evidence",
    status: "ready",
    summary: "Evidence linked to the selected flow projection.",
  });
}

function FlowSelector({ flows, selectedFlowId, newFlowDraft, onSelectFlow, onNewFlow }) {
  const activeFlows = flows.filter((flow) => flow.status === "active");
  const completedFlows = flows.filter((flow) => flow.status === "completed");
  const value = newFlowDraft ? "__new__" : selectedFlowId ?? "";
  return (
    <div className="flow-selector">
      <label>
        <span>Flow</span>
        <select name="flow-selector" value={value} aria-label="Flow selector" onChange={(event) => onSelectFlow(event.target.value)}>
          {newFlowDraft ? <option value="__new__">New flow draft</option> : null}
          {flows.length === 0 ? <option value="">No flows yet</option> : null}
          {activeFlows.length > 0 ? (
            <optgroup label="Active flows">
              {activeFlows.map((flow) => (
                <option key={flow.flow_id} value={flow.flow_id}>
                  {flowDisplayName(flow)} - Active
                </option>
              ))}
            </optgroup>
          ) : null}
          {completedFlows.length > 0 ? (
            <optgroup label="Completed flows (read-only)">
              {completedFlows.map((flow) => (
                <option key={flow.flow_id} value={flow.flow_id}>
                  {flowDisplayName(flow)} - Completed
                </option>
              ))}
            </optgroup>
          ) : null}
        </select>
      </label>
      <button className="secondary new-flow-button" type="button" onClick={onNewFlow}>
        <Icon name="plus" />
        New Flow
      </button>
    </div>
  );
}

function StageRail({ selectedStage, currentStage, onSelect, flow, newFlowDraft }) {
  const currentIndex = Math.max(0, STAGES.findIndex((stage) => stage.id === currentStage));
  const completed = isCompletedFlow(flow);
  return (
    <aside className="stage-rail">
      <div className="rail-title">
        <span>Flow stages</span>
        <strong>{newFlowDraft ? "Draft" : flow?.status ?? `${currentIndex + 1}/7`}</strong>
      </div>
      <nav aria-label="AOR flow stages">
        {STAGES.map((stage, index) => {
          const active = selectedStage === stage.id;
          const done = completed ? index <= currentIndex : index < currentIndex;
          const current = currentStage === stage.id;
          return (
            <button
              key={stage.id}
              className={`stage-row ${active ? "active" : ""} ${done ? "done" : ""} ${current ? "current" : ""}`}
              type="button"
              onClick={() => onSelect(stage.id)}
            >
              <span className="stage-index">{index + 1}</span>
              <span className="stage-copy">
                <strong>{stage.label}</strong>
                <em>{stage.hint}</em>
              </span>
              <span className="stage-dot" />
            </button>
          );
        })}
      </nav>
      <div className="rail-note">
        <strong>{flowDisplayName(flow)}</strong>
        <p>{completed ? "Closed flow evidence is immutable and read-only." : "Navigation is scoped to the selected flow."}</p>
      </div>
    </aside>
  );
}

function MissionForm({ form, setForm, busy, submitMission, applyTemplate, onAsk, askDisabled = false, title = "Start New Flow", description = "Create a fresh mission/intake packet, then let AOR resolve the first next action.", followUpSourceHandoffRef = null }) {
  return (
    <form className="mission-form" aria-label="Mission intake" onSubmit={submitMission}>
      <div className="form-header">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <div className="form-actions">
          <button className="secondary" type="button" onClick={applyTemplate} disabled={busy}>
            Load template
          </button>
          <button className="secondary" type="button" onClick={onAsk} disabled={busy || askDisabled}>
            <Icon name="target" />
            Ask AOR
          </button>
        </div>
      </div>
      {followUpSourceHandoffRef ? (
        <div className="follow-up-lineage">
          <Icon name="lock" />
          <div>
            <span>Follow-up source handoff</span>
            <code>{followUpSourceHandoffRef}</code>
          </div>
        </div>
      ) : null}
      <Field label="Title">
        <input name="mission-title" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
      </Field>
      <Field label="Brief">
        <textarea name="mission-brief" value={form.brief} onChange={(event) => setForm({ ...form, brief: event.target.value })} />
      </Field>
      <Field label="Goals">
        <textarea name="mission-goals" value={form.goals} onChange={(event) => setForm({ ...form, goals: event.target.value })} />
      </Field>
      <Field label="Constraints">
        <textarea name="mission-constraints" value={form.constraints} onChange={(event) => setForm({ ...form, constraints: event.target.value })} />
      </Field>
      <div className="form-grid">
        <Field label="KPI">
          <textarea name="mission-kpi" className="compact-textarea" value={form.kpi} onChange={(event) => setForm({ ...form, kpi: event.target.value })} />
        </Field>
        <Field label="Definition of Done">
          <textarea name="mission-dod" className="compact-textarea" value={form.dod} onChange={(event) => setForm({ ...form, dod: event.target.value })} />
        </Field>
      </div>
      <div className="form-grid compact">
        <Field label="Delivery mode">
          <select name="mission-delivery-mode" value={form.deliveryMode} onChange={(event) => setForm({ ...form, deliveryMode: event.target.value })}>
            <option value="no-write">Safe-walkthrough (no-write)</option>
            <option value="patch-only">Patch-only</option>
            <option value="local-branch">Local branch</option>
            <option value="fork-first-pr">Fork-first PR</option>
          </select>
        </Field>
        <Field label="Allowed paths">
          <input name="mission-allowed-paths" value={form.allowedPaths} placeholder="apps/web/**, docs/**" onChange={(event) => setForm({ ...form, allowedPaths: event.target.value })} />
        </Field>
      </div>
      <button className="primary" type="submit" disabled={busy}>
        {followUpSourceHandoffRef ? "Create Follow-up Mission & Resolve Next Action" : "Create Mission Packet & Resolve Next Action"}
        <Icon name="target" />
      </button>
    </form>
  );
}

function FlowTimeline({ currentStage, completed }) {
  const currentIndex = Math.max(0, STAGES.findIndex((stage) => stage.id === currentStage));
  return (
    <div className="flow-timeline" aria-label="Flow lifecycle">
      {STAGES.map((stage, index) => {
        const done = completed ? index <= currentIndex : index < currentIndex;
        const current = currentStage === stage.id;
        return (
          <div key={stage.id} className={`timeline-step ${done ? "done" : ""} ${current ? "current" : ""}`}>
            <span>{index + 1}</span>
            <strong>{stage.label}</strong>
            <em>{done ? "Complete" : current ? "Active" : "Pending"}</em>
          </div>
        );
      })}
    </div>
  );
}

function FlowCockpit({
  flow,
  stage,
  currentStage,
  nextAction,
  projectState,
  config,
  busy,
  onResolveNext,
  onRefresh,
  onAsk,
  onStartNewFlow,
  onCreateFollowUp,
  onDuplicateMission,
  initializeProject,
}) {
  if (!flow && stage.id === "readiness") {
    return (
      <section className="work-card stage-work">
        <div className="work-heading">
          <div>
            <h2>Readiness</h2>
            <p>Initialize `.aor/`, confirm guardrails, and materialize next-action evidence.</p>
          </div>
          <button className="secondary" type="button" onClick={onAsk}>Ask AOR</button>
        </div>
        <div className="readiness-grid">
          <div>
            <span>Recommended action</span>
            <strong>Initialize project runtime</strong>
            <p>Creates runtime folders and onboarding evidence under `.aor/`.</p>
          </div>
          <button className="primary" type="button" onClick={initializeProject} disabled={busy}>
            Initialize
          </button>
        </div>
      </section>
    );
  }

  const completed = isCompletedFlow(flow);
  const followUpEligible = flow?.closure_state?.follow_up_eligible === true;
  const blockers = Array.isArray(nextAction?.blockers) && !completed ? nextAction.blockers : [];
  const evidenceRefs = Array.isArray(flow?.evidence_refs) && flow.evidence_refs.length > 0
    ? flow.evidence_refs
    : Array.isArray(nextAction?.evidence_refs)
      ? nextAction.evidence_refs
      : [];
  const deliveryMode =
    flow?.writeback_policy?.mode ??
    nextAction?.bounded_execution?.requested_delivery_mode ??
    nextAction?.mission_state?.delivery_mode ??
    "no-write";
  const nextPrimary = completed
    ? nextAction?.primary_action?.action_id === "start-new-flow"
      ? nextAction.primary_action
      : {
        command: "read-only evidence inspection",
        reason: "This flow is closed. Its evidence chain remains available for audit and follow-up planning.",
      }
    : nextAction?.primary_action ?? {
        command: "aor next",
        reason: "Resolve the next deterministic action for the selected flow.",
      };

  return (
    <section className={`work-card flow-cockpit ${completed ? "read-only" : "active"}`}>
      <div className="work-heading">
        <div>
          <div className="heading-line">
            <h2>{completed ? "Learning / Closure" : stage.label}</h2>
            <StatusPill state={completed ? "Completed" : "Active"} />
          </div>
          <p>{completed ? "Completed artifacts are immutable, read-only evidence." : stage.hint}</p>
        </div>
        <button className="secondary" type="button" onClick={onAsk}>
          <Icon name={completed ? "eye" : "target"} />
          {completed ? "Inspect" : "Ask AOR"}
        </button>
      </div>

      <FlowTimeline currentStage={currentStage} completed={completed} />

      {completed ? (
        <div className="flow-lock-banner">
          <Icon name="lock" />
          <div>
            <strong>Flow completed - evidence locked</strong>
            <p>Mutation controls are replaced by no-write inspection actions. Start New Flow to continue work.</p>
          </div>
          <div className="closure-actions">
            <button className="primary" type="button" onClick={onStartNewFlow} disabled={busy}>
              <Icon name="plus" />
              Start New Flow
            </button>
            <button className="secondary" type="button" onClick={onCreateFollowUp} disabled={busy || !followUpEligible}>
              Create follow-up from learning handoff
            </button>
            <button className="secondary" type="button" onClick={onDuplicateMission} disabled={busy}>
              Duplicate mission settings
            </button>
          </div>
        </div>
      ) : null}

      <div className="recommended-action">
        <div className="action-header">
          <div>
            <h3>One Recommended Action</h3>
            <p>{completed ? "Single read-only action" : "Single safest next step"}</p>
          </div>
          <StatusPill state={blockers.length > 0 ? "blocked" : completed ? "read-only" : "ready"} />
        </div>
        <div className="action-grid">
          <div className="command-panel">
            <span>Command</span>
            <code>{nextPrimary.command}</code>
            <p>{nextPrimary.reason}</p>
          </div>
          <div>
            <span>Runtime root</span>
            <code>{projectState?.runtime_root ?? config?.runtime_root ?? ".aor"}</code>
          </div>
          <div>
            <span>Write-back mode</span>
            <code>{deliveryMode}</code>
          </div>
          <div>
            <span>Safety status</span>
            <strong>{deliveryMode === "no-write" ? "No upstream writes" : "Explicit review required"}</strong>
          </div>
        </div>
        <div className="cockpit-actions">
          <button className="primary" type="button" onClick={onResolveNext} disabled={busy || completed}>
            <Icon name="play" />
            Resolve Next Action
          </button>
          <button className="secondary" type="button" onClick={onRefresh} disabled={busy}>
            <Icon name="refresh" />
            Refresh
          </button>
        </div>
      </div>

      <div className="flow-snapshot-grid">
        <div>
          <span>Blockers</span>
          <strong>{blockers.length}</strong>
          <p>{blockers.length === 0 ? "No blockers for the visible next step." : blockers[0]?.summary ?? blockers[0]?.code}</p>
        </div>
        <div>
          <span>Evidence refs</span>
          <strong>{evidenceRefs.length}</strong>
          <p>{evidenceRefs[0] ?? "No flow evidence refs yet."}</p>
        </div>
        <div>
          <span>Flow ID</span>
          <strong>{flow?.mission_id ?? "draft"}</strong>
          <p>{flow?.flow_id ?? "Mission packet will create the flow identity."}</p>
        </div>
      </div>
    </section>
  );
}

function RightRail({ nextAction, selectedFlow, projectState, config, operatorRequests }) {
  const completed = isCompletedFlow(selectedFlow);
  const nextPrimary = completed
    ? nextAction?.primary_action?.action_id === "start-new-flow"
      ? nextAction.primary_action
      : { command: "read-only evidence inspection", reason: "Completed flow evidence remains inspectable." }
    : nextAction?.primary_action ?? {};
  const blockers = Array.isArray(nextAction?.blockers) && !completed ? nextAction.blockers : [];
  const evidenceRefs = Array.isArray(selectedFlow?.evidence_refs) && selectedFlow.evidence_refs.length > 0
    ? selectedFlow.evidence_refs
    : Array.isArray(nextAction?.evidence_refs)
      ? nextAction.evidence_refs
      : [];
  const deliveryMode =
    selectedFlow?.writeback_policy?.mode ??
    nextAction?.bounded_execution?.requested_delivery_mode ??
    nextAction?.mission_state?.delivery_mode ??
    "no-write";
  const latestRequest = operatorRequests.find((request) => request.document?.target_flow_id === selectedFlow?.flow_id)?.document ?? operatorRequests[0]?.document;

  return (
    <aside className="right-rail">
      <section className="rail-card next-card">
        <h3>Next action <span>{completed ? "read-only" : "single step"}</span></h3>
        <p className="command">{nextPrimary.command ?? "Run aor next"}</p>
        <p>{nextPrimary.reason ?? "No next-action report has been materialized yet."}</p>
      </section>
      <section className="rail-card">
        <h3>Blockers <span>{blockers.length}</span></h3>
        <ul>
          {blockers.length === 0 ? <li>None</li> : blockers.slice(0, 4).map((blocker, index) => <li key={`${blocker.code}-${index}`}>{blocker.summary ?? blocker.code}</li>)}
        </ul>
      </section>
      <section className="rail-card">
        <h3>Evidence refs <span>{evidenceRefs.length}</span></h3>
        <ul>
          {evidenceRefs.length === 0 ? <li>No refs yet</li> : evidenceRefs.slice(0, 4).map((ref) => <li key={ref}><code>{ref}</code></li>)}
        </ul>
      </section>
      <section className="rail-card">
        <h3>Runtime root</h3>
        <p><code>{projectState?.runtime_root ?? config?.runtime_root ?? ".aor"}</code></p>
        <div className="meter"><span /></div>
      </section>
      <section className="rail-card">
        <h3>Safety status</h3>
        <StatusPill state={deliveryMode === "no-write" ? "enforced" : deliveryMode} />
        <p>AOR will not write to upstream remotes by default.</p>
      </section>
      <section className="rail-card">
        <h3>Latest request</h3>
        {latestRequest ? (
          <>
            <p className="command">{latestRequest.request_summary}</p>
            <StatusPill state={latestRequest.status} />
          </>
        ) : (
          <p>No operator request yet.</p>
        )}
      </section>
    </aside>
  );
}

function EvidenceWorkbench({ rows, selectedRef, setSelectedRef, attachTarget, copyRef }) {
  const selected = rows.find((row) => row.ref === selectedRef) ?? rows[0] ?? null;
  return (
    <section className="work-card evidence-workbench">
      <div className="work-heading compact-heading">
        <div>
          <h3>Evidence & Documents</h3>
          <p>Preview safe metadata, copy refs, or attach refs to an operator request.</p>
        </div>
      </div>
      <div className="evidence-grid">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Kind</th>
                <th>Ref</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan="4">No evidence yet</td></tr>
              ) : rows.slice(0, 12).map((row) => (
                <tr key={`${row.kind}-${row.ref}`} className={selected?.ref === row.ref ? "selected" : ""}>
                  <td>{row.kind}</td>
                  <td><button className="link-button" type="button" onClick={() => setSelectedRef(row.ref)}>{row.ref}</button></td>
                  <td>{row.status ?? "ready"}</td>
                  <td className="row-actions">
                    <IconButton label="Copy ref" onClick={() => copyRef(row.ref)}><Icon name="copy" /></IconButton>
                    <IconButton label="Attach as request target" onClick={() => attachTarget(row.ref)}><Icon name="target" /></IconButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="preview-pane">
          <span>Preview</span>
          {selected ? (
            <>
              <strong>{selected.label}</strong>
              <code>{selected.ref}</code>
              <p>{selected.summary}</p>
            </>
          ) : (
            <p>Select evidence to preview.</p>
          )}
        </div>
      </div>
    </section>
  );
}

function InteractionsInbox({ interactions, answers, setAnswers, submitAnswer, busy }) {
  return (
    <section className="work-card inbox">
      <div className="work-heading compact-heading">
        <div>
          <h3>Interactions Inbox</h3>
          <p>Answer runtime-initiated questions through audited continuation.</p>
        </div>
      </div>
      {interactions.length === 0 ? (
        <p className="empty-state">No requested interactions.</p>
      ) : interactions.map((interaction) => {
        const key = interactionKey(interaction);
        const answer = answers[key] ?? { answer: "", decision: "" };
        const canSend = (answer.answer ?? "").trim().length > 0 || (answer.decision ?? "").length > 0;
        return (
          <div className="interaction-row" key={key}>
            <div>
              <strong>{interaction.prompt_summary ?? "Runtime requested input"}</strong>
              <span>{interaction.run_id}</span>
              <code>{interaction.step_result_ref}</code>
            </div>
            <select name="interaction-decision" value={answer.decision} onChange={(event) => setAnswers({ ...answers, [key]: { ...answer, decision: event.target.value } })}>
              <option value="">answer</option>
              <option value="approve_once">approve_once</option>
              <option value="deny">deny</option>
              <option value="approve_for_run">approve_for_run</option>
            </select>
            <input name="interaction-answer" value={answer.answer} placeholder="Answer or reason" onChange={(event) => setAnswers({ ...answers, [key]: { ...answer, answer: event.target.value } })} />
            <button className="secondary" type="button" onClick={() => submitAnswer(interaction)} disabled={busy || !canSend}>
              Send
            </button>
          </div>
        );
      })}
    </section>
  );
}

function EvidenceGraphPanel({ graph }) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];
  return (
    <section className="work-card graph-panel">
      <div className="work-heading compact-heading">
        <div>
          <h3>Evidence Graph</h3>
          <p>Selected-flow evidence only. Unrelated flow refs are excluded.</p>
        </div>
        <StatusPill state={graph?.isolation?.excludes_unrelated_flows ? "isolated" : "loading"} />
      </div>
      <div className="graph-summary">
        <div>
          <span>Nodes</span>
          <strong>{nodes.length}</strong>
        </div>
        <div>
          <span>Edges</span>
          <strong>{edges.length}</strong>
        </div>
        <div>
          <span>Mode</span>
          <strong>{graph?.isolation?.mode ?? "selected-flow-only"}</strong>
        </div>
      </div>
      <div className="graph-node-list">
        {nodes.length === 0 ? (
          <p className="empty-state">No flow graph loaded.</p>
        ) : nodes.slice(0, 8).map((node) => (
          <div className="graph-node" key={node.node_id}>
            <span>{node.family}</span>
            <strong>{node.label ?? node.ref}</strong>
            <code>{node.ref}</code>
          </div>
        ))}
      </div>
    </section>
  );
}

function RuntimeTracePanel({ trace }) {
  const items = Array.isArray(trace?.trace_items) ? trace.trace_items : [];
  return (
    <section className="work-card trace-panel">
      <div className="work-heading compact-heading">
        <div>
          <h3>Runtime Trace</h3>
          <p>Run events, step results, harness decisions, and delivery artifacts for this flow.</p>
        </div>
        <StatusPill state={`${items.length} items`} />
      </div>
      <div className="table-wrap trace-table">
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th>Run</th>
              <th>Status</th>
              <th>Ref</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr><td colSpan="4">No runtime trace yet</td></tr>
            ) : items.slice(0, 10).map((item) => (
              <tr key={item.trace_id}>
                <td>{item.event_type ?? item.kind}</td>
                <td>{Array.isArray(item.run_ids) ? item.run_ids.join(", ") : ""}</td>
                <td>{item.status ?? "read"}</td>
                <td><code>{item.ref ?? item.trace_id}</code></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RequestDrawer({ open, stage, flow, form, setForm, busy, result, onClose, onRun }) {
  const drawerRef = useRef(null);

  useEffect(() => {
    if (open) {
      drawerRef.current?.focus();
    }
  }, [open]);

  if (!open) return null;
  const completed = isCompletedFlow(flow);
  const targetStep = form.targetStep || STAGE_TO_TARGET_STEP[stage.id] || "discovery";
  const scopeMissing = form.deliveryMode !== "no-write" && form.allowedPaths.trim().length === 0;
  const targetRefsMissing = splitRefs(form.targetRefs).length === 0;
  const flowMissing = !flow?.flow_id;
  const readOnlyAllowed = !completed || (form.deliveryMode === "no-write" && READ_ONLY_INSPECTION_INTENTS.has(form.intent));
  const requestPreview =
    flowMissing
      ? "Select an existing flow before creating an operator request."
      : targetRefsMissing
        ? "Add at least one target ref so the request is auditable and flow-scoped."
        : completed && !readOnlyAllowed
      ? "Completed flows are read-only. Use a no-write analyze, explain, review, or validate request, or start a new flow."
      : form.deliveryMode === "patch-only"
        ? `AOR will compile this request into the ${targetStep} step, run in no-silent-mutation mode, and create proposal plus patch evidence inside allowed paths.`
      : form.deliveryMode === "no-write"
        ? `AOR will compile this request into the ${targetStep} step and create no-write analysis/proposal evidence.`
        : `AOR will record the requested ${form.deliveryMode} mode, validate explicit scope, and create proposal evidence; v1 will not silently mutate files.`;
  return (
    <div className="drawer-backdrop" role="presentation">
      <aside
        ref={drawerRef}
        className="request-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="request-drawer-title"
        tabIndex="-1"
      >
        <div className="drawer-header">
          <div>
            <h2 id="request-drawer-title">Ask AOR</h2>
            <p>{flow ? `${flowDisplayName(flow)} / ${stage.label}` : stage.label}</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close request drawer"><Icon name="close" /></button>
        </div>
        <div className={`target-flow-card ${completed ? "read-only" : ""}`}>
          <span>Target flow</span>
          <strong>{flowDisplayName(flow)}</strong>
          <code>{flow?.flow_id ?? "new-flow-draft"}</code>
          <p>{flowMissing ? "Ask AOR requires a selected flow." : completed ? "Read-only inspection only. Mutation requests are blocked by the control plane." : "Requests are scoped to the selected active flow."}</p>
        </div>
        <Field label="Intent">
          <select name="request-intent" value={form.intent} onChange={(event) => setForm({ ...form, intent: event.target.value })}>
            <option value="analyze">analyze</option>
            <option value="explain">explain</option>
            <option value="revise-document" disabled={completed}>revise-document</option>
            <option value="create-document" disabled={completed}>create-document</option>
            <option value="repair" disabled={completed}>repair</option>
            <option value="validate">validate</option>
            <option value="plan" disabled={completed}>plan</option>
            <option value="implement" disabled={completed}>implement</option>
            <option value="review">review</option>
          </select>
        </Field>
        <Field label="Request">
          <textarea name="request-text" value={form.requestText} placeholder="Ask for analysis, explanation, proposal, patch, validation, or review." onChange={(event) => setForm({ ...form, requestText: event.target.value })} />
        </Field>
        <Field label="Target refs">
          <textarea name="request-target-refs" className="compact-textarea" value={form.targetRefs} placeholder="README.md, evidence://..., packet://..." onChange={(event) => setForm({ ...form, targetRefs: event.target.value })} />
        </Field>
        <Field label="Allowed paths">
          <input name="request-allowed-paths" value={form.allowedPaths} placeholder="docs/**, apps/web/**" onChange={(event) => setForm({ ...form, allowedPaths: event.target.value })} />
        </Field>
        <div className="form-grid">
          <Field label="Delivery mode">
            <select name="request-delivery-mode" value={form.deliveryMode} onChange={(event) => setForm({ ...form, deliveryMode: event.target.value })}>
              <option value="no-write">no-write</option>
              <option value="patch-only" disabled={completed}>patch-only</option>
              <option value="local-branch" disabled={completed}>local-branch</option>
              <option value="fork-first-pr" disabled={completed}>fork-first-pr</option>
            </select>
          </Field>
          <Field label="Target step">
            <select name="request-target-step" value={form.targetStep} onChange={(event) => setForm({ ...form, targetStep: event.target.value })}>
              <option value="">stage default</option>
              <option value="discovery">discovery</option>
              <option value="research">research</option>
              <option value="spec">spec</option>
              <option value="planning">planning</option>
              <option value="implement">implement</option>
              <option value="review">review</option>
              <option value="qa">qa</option>
              <option value="repair">repair</option>
            </select>
          </Field>
        </div>
        <div className="runtime-preview">
          <span>What runtime will do</span>
          <p>{scopeMissing ? `${requestPreview} Add allowed paths before running this non-no-write request.` : requestPreview}</p>
        </div>
        <button className="primary drawer-submit" type="button" onClick={onRun} disabled={busy || flowMissing || targetRefsMissing || form.requestText.trim().length === 0 || scopeMissing || !readOnlyAllowed}>
          <Icon name="play" />
          {completed ? "Create no-write inspection request" : "Create and run request"}
        </button>
        {result ? (
          <div className="run-result" role="status" aria-live="polite">
            <div className="run-result-header">
              <span>Latest run</span>
              <StatusPill state="completed" />
            </div>
            <dl>
              <dt>Run</dt>
              <dd><code>{result.run_id}</code></dd>
              <dt>Context</dt>
              <dd><code>{result.compiled_context_ref}</code></dd>
              <dt>Step result</dt>
              <dd><code>{result.routed_step_result_ref ?? result.routed_step_result_file}</code></dd>
              <dt>Next action</dt>
              <dd><code>{result.next_action_report_ref ?? result.next_action_report_file}</code></dd>
            </dl>
            <div className="result-ref-list">
              <span>Proposal refs</span>
              {result.proposal_refs?.length ? (
                <ul>{result.proposal_refs.map((ref) => <li key={ref}><code>{ref}</code></li>)}</ul>
              ) : (
                <p>No proposal refs returned.</p>
              )}
            </div>
            {result.patch_refs?.length ? (
              <div className="result-ref-list">
                <span>Patch refs</span>
                <ul>{result.patch_refs.map((ref) => <li key={ref}><code>{ref}</code></li>)}</ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </aside>
    </div>
  );
}

function App() {
  const [config, setConfig] = useState(null);
  const [projectState, setProjectState] = useState(null);
  const [nextAction, setNextAction] = useState(null);
  const [flowList, setFlowList] = useState({ flows: [], selected_flow_id: null });
  const [selectedFlow, setSelectedFlow] = useState(null);
  const [selectedFlowId, setSelectedFlowId] = useState(null);
  const [newFlowDraft, setNewFlowDraft] = useState(false);
  const [draftSourceFlow, setDraftSourceFlow] = useState(null);
  const [draftFollowUpHandoffRef, setDraftFollowUpHandoffRef] = useState(null);
  const [flowEvidenceGraph, setFlowEvidenceGraph] = useState(null);
  const [flowRuntimeTrace, setFlowRuntimeTrace] = useState(null);
  const [packets, setPackets] = useState([]);
  const [stepResults, setStepResults] = useState([]);
  const [operatorRequests, setOperatorRequests] = useState([]);
  const [activity, setActivity] = useState([]);
  const [selectedStage, setSelectedStage] = useState("mission");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState(SAFE_TEMPLATE);
  const [requestDrawerOpen, setRequestDrawerOpen] = useState(false);
  const [requestForm, setRequestForm] = useState(DEFAULT_REQUEST);
  const [requestResult, setRequestResult] = useState(null);
  const [selectedRef, setSelectedRef] = useState("");
  const [answers, setAnswers] = useState({});
  const didChooseStage = useRef(false);
  const didAutoSelectStage = useRef(false);

  const apiProjectBase = useMemo(() => {
    if (!config?.project_id) return null;
    return `/api/projects/${encodeURIComponent(config.project_id)}`;
  }, [config]);

  const activeStage = STAGES.find((stage) => stage.id === selectedStage) ?? STAGES[1];
  const currentStage = newFlowDraft ? "mission" : flowStageId(selectedFlow, nextAction, projectState);
  const flowOptions = Array.isArray(flowList?.flows) ? flowList.flows : [];

  const evidenceRows = useMemo(() => {
    const packetRows = packets.map((packet) => ({
      kind: packet.family ?? "packet",
      ref: packet.artifact_ref ?? packet.file,
      label: packet.document?.packet_id ?? packet.document?.request_id ?? packet.family ?? "packet",
      status: packet.document?.status,
      summary: packet.document?.summary ?? packet.document?.title ?? "Packet artifact metadata.",
    }));
    const stepRows = stepResults.map((step) => ({
      kind: "step-result",
      ref: step.artifact_ref ?? step.file,
      label: step.document?.step_result_id ?? "step-result",
      status: step.document?.status,
      summary: step.document?.summary ?? "Step result metadata.",
    }));
    const requestRows = operatorRequests.map((request) => ({
      kind: "operator-request",
      ref: request.operator_request_ref ?? request.artifact_ref ?? request.file,
      label: request.document?.request_id ?? "operator-request",
      status: request.document?.status,
      summary: request.document?.request_summary ?? "Operator request metadata.",
    }));
    const nextRows = (Array.isArray(nextAction?.evidence_refs) ? nextAction.evidence_refs : []).map((ref) => ({
      kind: "next-action-ref",
      ref,
      label: "next-action evidence",
      status: "ready",
      summary: "Evidence referenced by the latest next-action report.",
    }));
    return [...requestRows, ...packetRows, ...stepRows, ...nextRows].filter((row) => typeof row.ref === "string");
  }, [packets, stepResults, operatorRequests, nextAction]);

  const flowEvidenceRows = useMemo(() => evidenceRowsForFlow(selectedFlow, evidenceRows), [selectedFlow, evidenceRows]);

  useEffect(() => {
    if (flowEvidenceRows.length === 0) return;
    if (!selectedRef || !flowEvidenceRows.some((row) => row.ref === selectedRef)) {
      setSelectedRef(flowEvidenceRows[0].ref);
    }
  }, [flowEvidenceRows, selectedRef]);

  const interactions = useMemo(() => {
    return stepResults
      .map((step) => {
        const requested = step.document?.requested_interaction;
        if (!requested?.requested) return null;
        const status = requested.status ?? "requested";
        if (status !== "requested" && status !== "blocked") return null;
        return {
          run_id: step.document?.run_id,
          interaction_id: requested.interaction_id,
          prompt_summary: requested.prompt_summary ?? requested.summary,
          step_result_ref: step.artifact_ref ?? step.file,
          interaction_type: requested.interaction_type,
        };
      })
      .filter(Boolean);
  }, [stepResults]);

  function pushActivity(label, detail) {
    setActivity((current) => [{ id: `${Date.now()}-${Math.random()}`, label, detail }, ...current.slice(0, 9)]);
  }

  async function loadFlowWorkbench(base, flow) {
    if (!flow?.flow_id) {
      setFlowEvidenceGraph(null);
      setFlowRuntimeTrace(null);
      return;
    }
    const encodedFlowId = encodeURIComponent(flow.flow_id);
    const [graph, trace] = await Promise.all([
      readJson(`${base}/flows/${encodedFlowId}/evidence-graph`).catch(() => null),
      readJson(`${base}/flows/${encodedFlowId}/runtime-trace`).catch(() => null),
    ]);
    setFlowEvidenceGraph(graph);
    setFlowRuntimeTrace(trace);
  }

  async function refresh(options = {}) {
    setError("");
    const appConfig = config ?? (await readJson("/app-config.json"));
    setConfig(appConfig);
    const base = `/api/projects/${encodeURIComponent(appConfig.project_id)}`;
    const [state, next, flowPayload, selectedFlowPayload, packetList, stepList, requestList] = await Promise.all([
      readJson(`${base}/state`),
      readJson(`${base}/next-action-report`).catch(() => null),
      readJson(`${base}/flows`).catch(() => ({ flows: [], selected_flow_id: null })),
      readJson(`${base}/flows/selected`).catch(() => null),
      readJson(`${base}/packets`).catch(() => []),
      readJson(`${base}/step-results`).catch(() => []),
      readJson(`${base}/operator-requests`).catch(() => []),
    ]);
    const nextReport = next?.document ?? next;
    const flows = Array.isArray(flowPayload?.flows) ? flowPayload.flows : [];
    const draftMode = typeof options.newFlowDraft === "boolean" ? options.newFlowDraft : newFlowDraft;
    const preferredSelectedFlowId = Object.prototype.hasOwnProperty.call(options, "selectedFlowId")
      ? options.selectedFlowId
      : selectedFlowId;
    const preferredFlowId = draftMode ? null : preferredSelectedFlowId ?? flowPayload?.selected_flow_id ?? selectedFlowPayload?.flow_id ?? null;
    const refreshedSelectedFlow =
      flows.find((flow) => flow.flow_id === preferredFlowId) ??
      flows.find((flow) => flow.flow_id === selectedFlowPayload?.flow_id) ??
      selectedFlowPayload ??
      flows[0] ??
      null;
    setProjectState(state);
    setNextAction(nextReport?.primary_action ? nextReport : null);
    setFlowList({ ...flowPayload, flows });
    if (!draftMode) {
      setSelectedFlow(refreshedSelectedFlow);
      setSelectedFlowId(refreshedSelectedFlow?.flow_id ?? null);
      await loadFlowWorkbench(base, refreshedSelectedFlow);
    } else {
      await loadFlowWorkbench(base, null);
    }
    setPackets(Array.isArray(packetList) ? packetList : []);
    setStepResults(Array.isArray(stepList) ? stepList : []);
    setOperatorRequests(Array.isArray(requestList) ? requestList : []);
    if (!didAutoSelectStage.current && !didChooseStage.current) {
      setSelectedStage(draftMode ? "mission" : flowStageId(refreshedSelectedFlow, nextReport?.primary_action ? nextReport : null, state));
      didAutoSelectStage.current = true;
    }
    pushActivity("control-plane.connected", refreshedSelectedFlow?.flow_id ?? nextReport?.primary_action?.command ?? "state refreshed");
  }

  useEffect(() => {
    refresh().catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  function chooseStage(stageId) {
    didChooseStage.current = true;
    setSelectedStage(stageId);
  }

  function startNewFlow({ sourceFlow = null, followUp = false, duplicate = false } = {}) {
    const sourceHandoffRef =
      followUp
        ? sourceFlow?.closure_state?.recommended_follow_up_source_handoff_ref ??
          sourceFlow?.closure_state?.source_learning_handoff_refs?.[0] ??
          null
        : null;
    setNewFlowDraft(true);
    setSelectedFlow(null);
    setSelectedFlowId(null);
    setDraftSourceFlow(sourceFlow);
    setDraftFollowUpHandoffRef(sourceHandoffRef);
    setFlowEvidenceGraph(null);
    setFlowRuntimeTrace(null);
    setSelectedStage("mission");
    setForm(sourceFlow && (followUp || duplicate) ? formFromFlowSettings(sourceFlow, { followUp }) : SAFE_TEMPLATE);
    setRequestDrawerOpen(false);
    pushActivity(
      followUp ? "flow.follow-up-draft" : duplicate ? "flow.duplicate-draft" : "flow.new-draft",
      sourceHandoffRef ?? "mission intake pending",
    );
  }

  function selectFlow(flowId) {
    if (flowId === "__new__") {
      startNewFlow();
      return;
    }
    const flow = flowOptions.find((candidate) => candidate.flow_id === flowId) ?? null;
    setNewFlowDraft(false);
    setDraftSourceFlow(null);
    setDraftFollowUpHandoffRef(null);
    setSelectedFlow(flow);
    setSelectedFlowId(flow?.flow_id ?? null);
    setSelectedStage(flowStageId(flow, nextAction, projectState));
    if (apiProjectBase) {
      loadFlowWorkbench(apiProjectBase, flow).catch((err) => setError(err instanceof Error ? err.message : String(err)));
    }
  }

  function openRequestDrawer(prefillRef = "") {
    const completed = isCompletedFlow(selectedFlow);
    const currentText = requestForm.requestText || `Analyze the ${activeStage.label} stage and recommend the next bounded action.`;
    const defaultTargetRef =
      selectedFlow?.latest_next_action_report_ref ??
      selectedFlow?.intake_packet_ref ??
      selectedFlow?.evidence_refs?.[0] ??
      "";
    const refs = prefillRef
      ? Array.from(new Set([...splitRefs(requestForm.targetRefs), prefillRef])).join("\n")
      : requestForm.targetRefs || defaultTargetRef;
    setRequestForm({
      ...requestForm,
      intent: completed && !READ_ONLY_INSPECTION_INTENTS.has(requestForm.intent) ? "analyze" : requestForm.intent,
      requestText: currentText,
      targetRefs: refs,
      deliveryMode: completed ? "no-write" : requestForm.deliveryMode,
      allowedPaths: completed ? "" : requestForm.allowedPaths,
      targetStep: requestForm.targetStep || STAGE_TO_TARGET_STEP[activeStage.id] || "discovery",
    });
    setRequestResult(null);
    setRequestDrawerOpen(true);
  }

  function closeRequestDrawer() {
    setRequestDrawerOpen(false);
    setRequestResult(null);
  }

  useEffect(() => {
    if (!requestDrawerOpen) return undefined;
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        closeRequestDrawer();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [requestDrawerOpen]);

  async function runLifecycle(command, flags = {}) {
    if (!apiProjectBase) {
      setError("Control-plane configuration is still loading.");
      return null;
    }
    const payload = await readJson(`${apiProjectBase}/lifecycle-command/actions`, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ command, flags }),
    });
    pushActivity(`lifecycle.${command}`, payload.lifecycle_command?.blocked ? "blocked" : "accepted");
    return payload;
  }

  async function initializeProject() {
    if (busy) return;
    setBusy(true);
    try {
      await runLifecycle("project init");
      await runLifecycle("next", { json: true });
      await refresh();
      setSelectedStage("mission");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitMission(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const flags = {
        "mission-id": missionIdFromTitle(form.title),
        title: form.title,
        brief: form.brief,
        goal: splitLines(form.goals),
        constraint: splitLines(form.constraints),
        kpi: splitLines(form.kpi),
        dod: splitLines(form.dod),
        "delivery-mode": form.deliveryMode,
      };
      if (form.allowedPaths.trim()) {
        flags["allowed-path"] = form.allowedPaths;
      }
      if (draftFollowUpHandoffRef) {
        flags["follow-up-source-handoff-ref"] = draftFollowUpHandoffRef;
      }
      await runLifecycle("mission create", flags);
      await runLifecycle("next", { json: true });
      setNewFlowDraft(false);
      setDraftSourceFlow(null);
      setDraftFollowUpHandoffRef(null);
      setSelectedFlowId(null);
      await refresh({ newFlowDraft: false, selectedFlowId: null });
      setSelectedStage("discovery");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function resolveNextForSelectedFlow() {
    if (busy) return;
    setBusy(true);
    try {
      await runLifecycle("next", { json: true });
      await refresh();
      setSelectedStage(flowStageId(selectedFlow, nextAction, projectState));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function createAndRunRequest() {
    if (!apiProjectBase || busy) return;
    setBusy(true);
    setError("");
    try {
      const create = await readJson(`${apiProjectBase}/operator-requests`, {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          source_surface: "web",
          target_stage: activeStage.id,
          intent_type: requestForm.intent,
          request_text: requestForm.requestText,
          ...(selectedFlow?.flow_id ? { target_flow_id: selectedFlow.flow_id } : {}),
          target_refs: splitRefs(requestForm.targetRefs),
          allowed_paths: splitRefs(requestForm.allowedPaths),
          delivery_mode: requestForm.deliveryMode,
        }),
      });
      const request = create.operator_request;
      const run = await readJson(`${apiProjectBase}/operator-requests/${encodeURIComponent(request.request_id)}/actions`, {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          action: "run",
          request_ref: request.operator_request_ref,
          target_step: requestForm.targetStep || STAGE_TO_TARGET_STEP[activeStage.id] || "discovery",
        }),
      });
      pushActivity("operator-request.completed", run.operator_request_run?.compiled_context_ref ?? request.operator_request_ref);
      setRequestResult(run.operator_request_run ?? null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitAnswer(interaction) {
    if (!apiProjectBase || busy) return;
    const answer = answers[interactionKey(interaction)] ?? {};
    setBusy(true);
    try {
      await readJson(`${apiProjectBase}/interactions/answers`, {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          run_id: interaction.run_id,
          interaction_id: interaction.interaction_id,
          answer: answer.answer ?? "",
          decision: answer.decision || undefined,
          reason: answer.answer || answer.decision || "operator answered from web console",
        }),
      });
      pushActivity("interaction.answered", interaction.interaction_id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function attachTarget(ref) {
    openRequestDrawer(ref);
  }

  async function copyRef(ref) {
    try {
      await navigator.clipboard?.writeText(ref);
      pushActivity("ref.copied", ref);
    } catch {
      pushActivity("ref.selected", ref);
    }
  }

  const deliveryMode =
    selectedFlow?.writeback_policy?.mode ??
    nextAction?.bounded_execution?.requested_delivery_mode ??
    nextAction?.mission_state?.delivery_mode ??
    "no-write";

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">A</div>
          <div>
            <strong>AOR Operator Console</strong>
            <span>v0.4.2</span>
          </div>
        </div>
        <div className="top-context">
          <span>Project</span>
          <code>{config?.project_ref ?? "loading"}</code>
        </div>
        <FlowSelector
          flows={flowOptions}
          selectedFlowId={selectedFlowId}
          newFlowDraft={newFlowDraft}
          onSelectFlow={selectFlow}
          onNewFlow={startNewFlow}
        />
        <div className="top-context runtime-context">
          <span>Runtime root</span>
          <code>{projectState?.runtime_root ?? config?.runtime_root ?? ".aor"}</code>
        </div>
        <StatusPill state={newFlowDraft ? "Draft flow" : selectedFlow?.status ?? "No flow"} />
        <div className="topbar-spacer" />
        <StatusPill state={config ? "connected" : "loading"} />
        <StatusPill state={deliveryMode === "no-write" ? "NO-WRITE SAFETY: ON" : deliveryMode} />
        <IconButton label="Refresh" onClick={() => refresh().catch((err) => setError(err.message))} disabled={busy}><Icon name="refresh" /></IconButton>
        <button className="utility-button" type="button" onClick={() => copyRef(projectState?.runtime_root ?? config?.runtime_root ?? ".aor")}>
          <Icon name="folder" />Copy runtime path
        </button>
      </header>

      <StageRail
        selectedStage={selectedStage}
        currentStage={currentStage}
        onSelect={chooseStage}
        flow={selectedFlow}
        newFlowDraft={newFlowDraft}
      />

      <main className="main">
        {error ? <div className="alert" role="alert">{error}</div> : null}
        {newFlowDraft || (!selectedFlow && selectedStage === "mission") ? (
          <section className="work-card">
            <MissionForm
              form={form}
              setForm={setForm}
              busy={busy}
              submitMission={submitMission}
              applyTemplate={() => setForm(SAFE_TEMPLATE)}
              onAsk={() => openRequestDrawer()}
              askDisabled={!selectedFlow}
              title={draftFollowUpHandoffRef ? "Create Follow-up Flow" : "Start New Flow"}
              description={
                draftSourceFlow
                  ? "Create fresh mission/intake evidence from completed-flow settings; the source flow remains read-only."
                  : "Create a fresh mission/intake packet, then let AOR resolve the first next action."
              }
              followUpSourceHandoffRef={draftFollowUpHandoffRef}
            />
          </section>
        ) : (
          <FlowCockpit
            flow={selectedFlow}
            stage={activeStage}
            currentStage={currentStage}
            busy={busy}
            nextAction={nextAction}
            projectState={projectState}
            config={config}
            onResolveNext={resolveNextForSelectedFlow}
            onRefresh={() => refresh().catch((err) => setError(err.message))}
            onAsk={() => openRequestDrawer()}
            onStartNewFlow={() => startNewFlow()}
            onCreateFollowUp={() => startNewFlow({ sourceFlow: selectedFlow, followUp: true })}
            onDuplicateMission={() => startNewFlow({ sourceFlow: selectedFlow, duplicate: true })}
            initializeProject={initializeProject}
          />
        )}
      </main>

      <RightRail nextAction={newFlowDraft ? null : nextAction} selectedFlow={selectedFlow} projectState={projectState} config={config} operatorRequests={operatorRequests} />

      <section className="bottom-bar">
        <div className="activity-table">
          <h3>Activity / Events</h3>
          <table>
            <thead><tr><th>Event</th><th>Details</th></tr></thead>
            <tbody>
              {activity.length === 0 ? <tr><td colSpan="2">No activity yet</td></tr> : activity.map((entry) => (
                <tr key={entry.id}><td>{entry.label}</td><td>{entry.detail}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="activity-table">
          <h3>Artifacts (Recent)</h3>
          <table>
            <thead><tr><th>Ref</th><th>Status</th></tr></thead>
            <tbody>
              {evidenceRows.length === 0 ? (
                <tr><td colSpan="2">No artifacts yet</td></tr>
              ) : flowEvidenceRows.slice(0, 5).map((row) => <tr key={row.ref}><td><code>{row.ref}</code></td><td>{row.status ?? "ready"}</td></tr>)}
            </tbody>
          </table>
        </div>
      </section>

      <section className="workbench-row">
        <EvidenceGraphPanel graph={flowEvidenceGraph} />
        <RuntimeTracePanel trace={flowRuntimeTrace} />
      </section>

      <section className="workbench-row secondary-workbench-row">
        <EvidenceWorkbench
          rows={flowEvidenceRows}
          selectedRef={selectedRef}
          setSelectedRef={setSelectedRef}
          attachTarget={attachTarget}
          copyRef={copyRef}
        />
        <InteractionsInbox
          interactions={interactions}
          answers={answers}
          setAnswers={setAnswers}
          submitAnswer={submitAnswer}
          busy={busy}
        />
      </section>

      <RequestDrawer
        open={requestDrawerOpen}
        stage={activeStage}
        flow={selectedFlow}
        form={requestForm}
        setForm={setRequestForm}
        busy={busy}
        result={requestResult}
        onClose={closeRequestDrawer}
        onRun={createAndRunRequest}
      />
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
