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
  if (["connected", "ready", "pass", "completed", "no-write", "detached", "enforced"].includes(state)) return "safe";
  if (["blocked", "fail", "failed", "error"].includes(state)) return "danger";
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

function StageRail({ selectedStage, currentStage, onSelect }) {
  const currentIndex = Math.max(0, STAGES.findIndex((stage) => stage.id === currentStage));
  return (
    <aside className="stage-rail">
      <div className="rail-title">
        <span>Stages</span>
        <strong>{currentIndex + 1}/7</strong>
      </div>
      <nav aria-label="AOR flow stages">
        {STAGES.map((stage, index) => {
          const active = selectedStage === stage.id;
          const done = index < currentIndex;
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
    </aside>
  );
}

function MissionForm({ form, setForm, busy, submitMission, applyTemplate, onAsk }) {
  return (
    <form className="mission-form" aria-label="Mission intake" onSubmit={submitMission}>
      <div className="form-header">
        <div>
          <h2>Mission</h2>
          <p>Define mission intent, desired outcomes, and guardrails.</p>
        </div>
        <div className="form-actions">
          <button className="secondary" type="button" onClick={applyTemplate} disabled={busy}>
            Load template
          </button>
          <button className="secondary" type="button" onClick={onAsk} disabled={busy}>
            <Icon name="target" />
            Ask AOR
          </button>
        </div>
      </div>
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
        Create mission
        <Icon name="target" />
      </button>
    </form>
  );
}

function StageWorkspace({ stage, busy, nextPrimary, onRefresh, onAsk, initializeProject }) {
  if (stage.id === "readiness") {
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

  return (
    <section className="work-card stage-work">
      <div className="work-heading">
        <div>
          <h2>{stage.label}</h2>
          <p>{stage.hint}</p>
        </div>
        <button className="secondary" type="button" onClick={onAsk}>
          Ask AOR
        </button>
      </div>
      <div className="stage-summary-grid">
        <div>
          <span>Stage command</span>
          <code>{stage.command}</code>
        </div>
        <div>
          <span>Next action</span>
          <code>{nextPrimary.command ?? "aor next"}</code>
        </div>
        <div>
          <span>Runtime behavior</span>
          <code>bounded evidence first</code>
        </div>
      </div>
      <button className="secondary" type="button" onClick={onRefresh} disabled={busy}>
        <Icon name="refresh" />
        Refresh next action
      </button>
    </section>
  );
}

function RightRail({ nextAction, projectState, config, operatorRequests }) {
  const nextPrimary = nextAction?.primary_action ?? {};
  const blockers = Array.isArray(nextAction?.blockers) ? nextAction.blockers : [];
  const evidenceRefs = Array.isArray(nextAction?.evidence_refs) ? nextAction.evidence_refs : [];
  const deliveryMode =
    nextAction?.bounded_execution?.requested_delivery_mode ?? nextAction?.mission_state?.delivery_mode ?? "no-write";
  const latestRequest = operatorRequests[0]?.document;

  return (
    <aside className="right-rail">
      <section className="rail-card next-card">
        <h3>Next action</h3>
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

function RequestDrawer({ open, stage, form, setForm, busy, result, onClose, onRun }) {
  const drawerRef = useRef(null);

  useEffect(() => {
    if (open) {
      drawerRef.current?.focus();
    }
  }, [open]);

  if (!open) return null;
  const targetStep = form.targetStep || STAGE_TO_TARGET_STEP[stage.id] || "discovery";
  const scopeMissing = form.deliveryMode !== "no-write" && form.allowedPaths.trim().length === 0;
  const requestPreview =
    form.deliveryMode === "patch-only"
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
            <p>{stage.label}</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close request drawer"><Icon name="close" /></button>
        </div>
        <Field label="Intent">
          <select name="request-intent" value={form.intent} onChange={(event) => setForm({ ...form, intent: event.target.value })}>
            <option value="analyze">analyze</option>
            <option value="explain">explain</option>
            <option value="revise-document">revise-document</option>
            <option value="create-document">create-document</option>
            <option value="repair">repair</option>
            <option value="validate">validate</option>
            <option value="plan">plan</option>
            <option value="implement">implement</option>
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
              <option value="patch-only">patch-only</option>
              <option value="local-branch">local-branch</option>
              <option value="fork-first-pr">fork-first-pr</option>
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
        <button className="primary drawer-submit" type="button" onClick={onRun} disabled={busy || form.requestText.trim().length === 0 || scopeMissing}>
          <Icon name="play" />
          Create and run request
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
  const currentStage = resolveUiStageId(nextAction) ?? (projectState?.state_file ? "mission" : "readiness");
  const nextPrimary = nextAction?.primary_action ?? {};

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

  useEffect(() => {
    if (evidenceRows.length === 0) return;
    if (!selectedRef || !evidenceRows.some((row) => row.ref === selectedRef)) {
      setSelectedRef(evidenceRows[0].ref);
    }
  }, [evidenceRows, selectedRef]);

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

  async function refresh() {
    setError("");
    const appConfig = config ?? (await readJson("/app-config.json"));
    setConfig(appConfig);
    const base = `/api/projects/${encodeURIComponent(appConfig.project_id)}`;
    const [state, next, packetList, stepList, requestList] = await Promise.all([
      readJson(`${base}/state`),
      readJson(`${base}/next-action-report`).catch(() => null),
      readJson(`${base}/packets`).catch(() => []),
      readJson(`${base}/step-results`).catch(() => []),
      readJson(`${base}/operator-requests`).catch(() => []),
    ]);
    const nextReport = next?.document ?? next;
    setProjectState(state);
    setNextAction(nextReport?.primary_action ? nextReport : null);
    setPackets(Array.isArray(packetList) ? packetList : []);
    setStepResults(Array.isArray(stepList) ? stepList : []);
    setOperatorRequests(Array.isArray(requestList) ? requestList : []);
    if (!didAutoSelectStage.current && !didChooseStage.current) {
      setSelectedStage(resolveUiStageId(nextReport?.primary_action ? nextReport : null) ?? (state?.state_file ? "mission" : "readiness"));
      didAutoSelectStage.current = true;
    }
    pushActivity("control-plane.connected", nextReport?.primary_action?.command ?? "state refreshed");
  }

  useEffect(() => {
    refresh().catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  function chooseStage(stageId) {
    didChooseStage.current = true;
    setSelectedStage(stageId);
  }

  function openRequestDrawer(prefillRef = "") {
    const currentText = requestForm.requestText || `Analyze the ${activeStage.label} stage and recommend the next bounded action.`;
    const refs = prefillRef
      ? Array.from(new Set([...splitRefs(requestForm.targetRefs), prefillRef])).join("\n")
      : requestForm.targetRefs;
    setRequestForm({
      ...requestForm,
      requestText: currentText,
      targetRefs: refs,
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
      await runLifecycle("mission create", flags);
      await runLifecycle("next", { json: true });
      await refresh();
      setSelectedStage("discovery");
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
    nextAction?.bounded_execution?.requested_delivery_mode ?? nextAction?.mission_state?.delivery_mode ?? "no-write";

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
        <StatusPill state={`Mission: ${nextAction?.mission_state?.status ?? "draft"}`} />
        <div className="topbar-spacer" />
        <StatusPill state={config ? "connected" : "loading"} />
        <IconButton label="Refresh" onClick={() => refresh().catch((err) => setError(err.message))} disabled={busy}><Icon name="refresh" /></IconButton>
        <button className="utility-button" type="button" onClick={() => copyRef(projectState?.runtime_root ?? config?.runtime_root ?? ".aor")}>
          <Icon name="folder" />Copy runtime path
        </button>
      </header>

      <StageRail
        selectedStage={selectedStage}
        currentStage={currentStage}
        onSelect={chooseStage}
      />

      <main className="main">
        {error ? <div className="alert" role="alert">{error}</div> : null}
        {selectedStage === "mission" ? (
          <section className="work-card">
            <MissionForm
              form={form}
              setForm={setForm}
              busy={busy}
              submitMission={submitMission}
              applyTemplate={() => setForm(SAFE_TEMPLATE)}
              onAsk={() => openRequestDrawer()}
            />
          </section>
        ) : (
          <StageWorkspace
            stage={activeStage}
            busy={busy}
            nextPrimary={nextPrimary}
            onRefresh={() => refresh().catch((err) => setError(err.message))}
            onAsk={() => openRequestDrawer()}
            initializeProject={initializeProject}
          />
        )}
      </main>

      <RightRail nextAction={nextAction} projectState={projectState} config={config} operatorRequests={operatorRequests} />

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
              ) : evidenceRows.slice(0, 5).map((row) => <tr key={row.ref}><td><code>{row.ref}</code></td><td>{row.status ?? "ready"}</td></tr>)}
            </tbody>
          </table>
        </div>
      </section>

      <section className="workbench-row">
        <EvidenceWorkbench
          rows={evidenceRows}
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
