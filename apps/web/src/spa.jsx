import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import "./spa.css";

const STAGES = [
  {
    id: "readiness",
    label: "Readiness",
    command: "project init",
    summary: "Runtime evidence, project profile, and local safety posture.",
  },
  {
    id: "mission",
    label: "Mission",
    command: "mission create",
    summary: "First mission intake with goals, constraints, KPI, DoD, and delivery mode.",
  },
  {
    id: "discovery",
    label: "Discovery / Spec / Plan",
    command: "discovery run",
    summary: "Repository evidence, research, architecture traceability, and planned next steps.",
  },
  {
    id: "execution",
    label: "Execution",
    command: "run start",
    summary: "Bounded runner execution with explicit policy, route, and write-back evidence.",
  },
  {
    id: "review",
    label: "Review / QA",
    command: "review run",
    summary: "Review decision, QA signals, Runtime Harness, and repair or approval state.",
  },
  {
    id: "delivery",
    label: "Delivery / Release",
    command: "deliver prepare",
    summary: "Delivery plan, manifest, release packet, and guarded write-back decision.",
  },
  {
    id: "learning",
    label: "Learning",
    command: "learning handoff",
    summary: "Scorecard, handoff evidence, incidents, and closure state.",
  },
];

const PROJECT_STAGE_TO_UI_STAGE = {
  onboarding: "readiness",
  "mission-intake": "mission",
  discovery: "discovery",
  "spec-build": "discovery",
  planning: "discovery",
  "run-active": "execution",
  execution: "execution",
  review: "review",
  qa: "review",
  delivery: "delivery",
  release: "delivery",
  learning: "learning",
};

const SAFE_TEMPLATE = {
  title: "First AOR walkthrough",
  brief: "Inspect this repository and recommend the next safe SDLC step.",
  goals: "Produce bounded next-action evidence for this project.",
  constraints: "No upstream writes, no source file edits, no external runner execution.",
  kpi: "first-run-ready:First run readiness:ready:status",
  dod: "A next-action report exists under .aor and no project files were edited.",
  deliveryMode: "no-write",
  allowedPaths: "",
};

function splitLines(value) {
  return value
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean);
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
  if (["connected", "ready", "pass", "no-write", "detached"].includes(state)) return "safe";
  if (["blocked", "fail", "error"].includes(state)) return "danger";
  return "warn";
}

function StatusPill({ state }) {
  return <span className={`status-pill ${statusTone(state)}`}>{state}</span>;
}

function RefreshIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M20 12a8 8 0 0 1-13.66 5.66" />
      <path d="M4 12A8 8 0 0 1 17.66 6.34" />
      <path d="M17 2v5h5" />
      <path d="M7 22v-5H2" />
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

function scrollFlowToTop() {
  if (typeof window === "undefined") return;
  window.requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: "auto" }));
}

function Field({ label, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function InfoTile({ label, value, accent }) {
  return (
    <div className="info-tile">
      <span>{label}</span>
      <strong className={accent ? "accent-text" : undefined}>{value}</strong>
    </div>
  );
}

function StageNavigation({ selectedStage, currentStage, onSelect }) {
  const stageRefs = useRef({});

  useEffect(() => {
    const target = stageRefs.current[selectedStage] ?? stageRefs.current[currentStage];
    target?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [currentStage, selectedStage]);

  const currentIndex = Math.max(0, STAGES.findIndex((stage) => stage.id === currentStage));
  return (
    <nav aria-label="AOR flow stages">
      {STAGES.map((stage, index) => {
        const selected = selectedStage === stage.id;
        const done = index < currentIndex;
        const current = currentStage === stage.id;
        return (
          <button
            key={stage.id}
            ref={(element) => {
              if (element) stageRefs.current[stage.id] = element;
            }}
            className={`stage ${selected ? "active" : ""} ${done ? "done" : ""} ${current ? "current" : ""}`}
            type="button"
            onClick={() => onSelect(stage.id)}
          >
            <span>{index + 1}</span>
            <strong>{stage.label}</strong>
            <em>{stage.command}</em>
          </button>
        );
      })}
    </nav>
  );
}

function ReadinessPanel({ busy, initializeProject }) {
  return (
    <div className="stage-panel readiness">
      <div>
        <h3>Initialize runtime evidence</h3>
        <p>Prepare `.aor/` runtime state and refresh the deterministic next-action report.</p>
      </div>
      <button className="primary" type="button" onClick={initializeProject} disabled={busy}>
        {busy ? "Working..." : "Initialize project"}
      </button>
    </div>
  );
}

function StagePanel({ stage, nextPrimary, onRefresh, busy }) {
  return (
    <div className="stage-panel">
      <div className="stage-command">
        <span>Stage command</span>
        <code>{stage.command}</code>
      </div>
      <div className="stage-command">
        <span>Current next action</span>
        <code>{nextPrimary.command ?? "aor next"}</code>
      </div>
      <button className="secondary" type="button" onClick={onRefresh} disabled={busy}>
        Refresh next action
      </button>
    </div>
  );
}

function MissionForm({ form, setForm, busy, submitMission }) {
  return (
    <form className="mission-form" onSubmit={submitMission}>
      <Field label="Title">
        <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
      </Field>
      <Field label="Brief">
        <textarea value={form.brief} onChange={(event) => setForm({ ...form, brief: event.target.value })} />
      </Field>
      <div className="form-grid">
        <Field label="Goals">
          <textarea value={form.goals} onChange={(event) => setForm({ ...form, goals: event.target.value })} />
        </Field>
        <Field label="Constraints">
          <textarea value={form.constraints} onChange={(event) => setForm({ ...form, constraints: event.target.value })} />
        </Field>
      </div>
      <div className="form-grid">
        <Field label="KPI">
          <textarea className="compact-textarea" value={form.kpi} onChange={(event) => setForm({ ...form, kpi: event.target.value })} />
        </Field>
        <Field label="Definition of Done">
          <textarea className="compact-textarea" value={form.dod} onChange={(event) => setForm({ ...form, dod: event.target.value })} />
        </Field>
      </div>
      <div className="form-grid compact">
        <Field label="Delivery mode">
          <select value={form.deliveryMode} onChange={(event) => setForm({ ...form, deliveryMode: event.target.value })}>
            <option value="no-write">no-write</option>
            <option value="patch-only">patch-only</option>
            <option value="local-branch">local-branch</option>
            <option value="fork-first-pr">fork-first-pr</option>
          </select>
        </Field>
        <Field label="Allowed paths">
          <input value={form.allowedPaths} placeholder="apps/web/**,docs/**" onChange={(event) => setForm({ ...form, allowedPaths: event.target.value })} />
        </Field>
      </div>
      <button className="primary" type="submit" disabled={busy}>
        {busy ? "Working..." : "Create mission"}
      </button>
    </form>
  );
}

function App() {
  const [config, setConfig] = useState(null);
  const [projectState, setProjectState] = useState(null);
  const [nextAction, setNextAction] = useState(null);
  const [packets, setPackets] = useState([]);
  const [events, setEvents] = useState([]);
  const [selectedStage, setSelectedStage] = useState("mission");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState(SAFE_TEMPLATE);
  const didChooseStage = useRef(false);
  const didAutoSelectStage = useRef(false);

  const apiProjectBase = useMemo(() => {
    if (!config?.project_id) return null;
    return `/api/projects/${encodeURIComponent(config.project_id)}`;
  }, [config]);

  function chooseStage(stageId) {
    didChooseStage.current = true;
    setSelectedStage(stageId);
    scrollFlowToTop();
  }

  async function refresh() {
    setError("");
    const appConfig = config ?? (await readJson("/app-config.json"));
    setConfig(appConfig);
    const base = `/api/projects/${encodeURIComponent(appConfig.project_id)}`;
    const [state, next, packetList] = await Promise.all([
      readJson(`${base}/state`),
      readJson(`${base}/next-action-report`).catch(() => null),
      readJson(`${base}/packets`).catch(() => []),
    ]);
    const nextReport = next?.document ?? next;
    setProjectState(state);
    setNextAction(nextReport?.primary_action ? nextReport : null);
    if (!didAutoSelectStage.current && !didChooseStage.current) {
      const initialStage =
        resolveUiStageId(nextReport?.primary_action ? nextReport : null) ?? (state?.state_file ? "mission" : "readiness");
      setSelectedStage(initialStage);
      didAutoSelectStage.current = true;
    }
    setPackets(Array.isArray(packetList) ? packetList : []);
    setEvents((current) => [
      {
        id: `refresh-${Date.now()}`,
        label: "Refreshed control-plane state",
        detail: nextReport?.primary_action?.command ?? "No next-action report yet",
      },
      ...current.slice(0, 7),
    ]);
  }

  useEffect(() => {
    refresh().catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  async function runLifecycle(command, flags = {}) {
    if (!apiProjectBase) {
      setError("Control-plane configuration is still loading.");
      return null;
    }
    setError("");
    try {
      const payload = await readJson(`${apiProjectBase}/lifecycle-command/actions`, {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({ command, flags }),
      });
      setEvents((current) => [
        {
          id: `command-${Date.now()}`,
          label: `Ran ${command}`,
          detail: payload.lifecycle_command?.blocked ? "Blocked with evidence" : "Command accepted",
        },
        ...current.slice(0, 7),
      ]);
      return payload;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    }
  }

  async function initializeProject() {
    if (busy) return;
    setBusy(true);
    try {
      const init = await runLifecycle("project init");
      if (!init) return;
      const next = await runLifecycle("next", { json: true });
      if (!next) return;
      setSelectedStage(resolveUiStageId(next) ?? "mission");
      scrollFlowToTop();
      await refresh();
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
        title: form.title,
        brief: form.brief,
        goal: splitLines(form.goals),
        constraint: splitLines(form.constraints),
        kpi: splitLines(form.kpi),
        dod: splitLines(form.dod),
        "delivery-mode": form.deliveryMode,
      };
      const allowedPaths = form.allowedPaths.trim();
      if (allowedPaths) {
        flags["allowed-path"] = allowedPaths;
      }
      const mission = await runLifecycle("mission create", flags);
      if (!mission) return;
      const next = await runLifecycle("next", { json: true });
      if (!next) return;
      setSelectedStage(resolveUiStageId(next) ?? "discovery");
      scrollFlowToTop();
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  const nextPrimary = nextAction?.primary_action ?? {};
  const blockers = Array.isArray(nextAction?.blockers) ? nextAction.blockers : [];
  const evidenceRefs = Array.isArray(nextAction?.evidence_refs) ? nextAction.evidence_refs : [];
  const deliveryMode =
    nextAction?.bounded_execution?.requested_delivery_mode ?? nextAction?.mission_state?.delivery_mode ?? "no-write";
  const currentStage = resolveUiStageId(nextAction) ?? "readiness";
  const activeStage = STAGES.find((stage) => stage.id === selectedStage) ?? STAGES[1];
  const currentStageLabel = STAGES.find((stage) => stage.id === currentStage)?.label ?? "Mission";

  const applySafeTemplate = () => {
    didChooseStage.current = true;
    setSelectedStage("mission");
    setForm(SAFE_TEMPLATE);
    scrollFlowToTop();
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-stack">
          <div className="brand-mark">AOR</div>
          <div>
            <strong>Operator Console</strong>
            <span>local-trusted</span>
          </div>
        </div>
        <StageNavigation selectedStage={selectedStage} currentStage={currentStage} onSelect={chooseStage} />
      </aside>

      <header className="topbar">
        <div>
          <h1>AOR Operator Console</h1>
          <p>{config?.project_ref ?? "Loading project..."}</p>
        </div>
        <div className="topbar-actions">
          <StatusPill state={config ? "connected" : "loading"} />
          <IconButton label="Refresh" onClick={() => refresh().catch((err) => setError(err.message))} disabled={busy}>
            <RefreshIcon />
          </IconButton>
        </div>
      </header>

      <main className="main">
        {error ? <div className="alert" role="alert">{error}</div> : null}

        <section className="status-grid" aria-label="Project runtime summary">
          <InfoTile label="Project" value={config?.project_id ?? "loading"} />
          <InfoTile label="Current stage" value={currentStageLabel} accent />
          <InfoTile label="Delivery mode" value={deliveryMode} />
          <InfoTile label="Runtime root" value={projectState?.runtime_root ?? config?.runtime_root ?? ".aor"} />
        </section>

        <section className="workspace">
          <div className="mission-panel">
            <div className="panel-heading">
              <div>
                <h2>{selectedStage === "mission" ? "Mission intake" : activeStage.label}</h2>
                <p>{activeStage.summary}</p>
              </div>
              {selectedStage === "mission" ? (
                <button className="secondary" type="button" onClick={applySafeTemplate} disabled={busy}>
                  safe-walkthrough
                </button>
              ) : null}
            </div>

            {selectedStage === "readiness" ? (
              <ReadinessPanel busy={busy} initializeProject={initializeProject} />
            ) : selectedStage === "mission" ? (
              <MissionForm form={form} setForm={setForm} busy={busy} submitMission={submitMission} />
            ) : (
              <StagePanel
                stage={activeStage}
                nextPrimary={nextPrimary}
                onRefresh={() => refresh().catch((err) => setError(err.message))}
                busy={busy}
              />
            )}
          </div>

          <aside className="right-rail">
            <section className="rail-card next-card">
              <h3>Next action</h3>
              <p className="command">{nextPrimary.command ?? "Run aor next"}</p>
              <p>{nextPrimary.reason ?? "No next-action report has been materialized yet."}</p>
            </section>
            <section className="rail-card">
              <h3>Safety</h3>
              <StatusPill state={deliveryMode} />
              <p>Runtime root: <code>{projectState?.runtime_root ?? config?.runtime_root ?? ".aor"}</code></p>
              <p>No upstream writes remain the default first-run posture.</p>
            </section>
            <section className="rail-card">
              <h3>Blockers</h3>
              <ul>
                {blockers.length === 0 ? <li>None</li> : blockers.map((blocker, index) => <li key={`${blocker.code}-${index}`}>{blocker.code ?? blocker.summary}</li>)}
              </ul>
            </section>
            <section className="rail-card">
              <h3>Evidence refs</h3>
              <ul>
                {evidenceRefs.length === 0 ? <li>No refs yet</li> : evidenceRefs.slice(0, 5).map((ref) => <li key={ref}><code>{ref}</code></li>)}
              </ul>
            </section>
          </aside>
        </section>

        <section className="activity" aria-live="polite">
          <div>
            <h3>Control-plane activity</h3>
            <ul>{events.map((entry) => <li key={entry.id}><strong>{entry.label}</strong><span>{entry.detail}</span></li>)}</ul>
          </div>
          <div>
            <h3>Artifact links</h3>
            <ul>
              {packets.length === 0 ? <li>No packet artifacts yet</li> : packets.slice(0, 6).map((packet) => (
                <li key={packet.artifact_ref ?? packet.file}><code>{packet.artifact_ref ?? packet.file}</code></li>
              ))}
            </ul>
          </div>
        </section>
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
