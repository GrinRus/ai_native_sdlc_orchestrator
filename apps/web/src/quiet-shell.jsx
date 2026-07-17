import React from "react";
import { CountBadge, Disclosure, StatusBadge, Tabs } from "./ui/components.jsx";
export { readQuietPresentation, writeQuietPresentation } from "./quiet-presentation.js";
import "./quiet-shell.css";

export const QUIET_MODES = Object.freeze([{ id: "cockpit", label: "Cockpit" }, { id: "attention", label: "Attention" }, { id: "journey", label: "Journey" }, { id: "evidence", label: "Evidence" }]);

export function QuietShell({ project, flow, connection, safetyMode, attentionCount, stages, currentStage, viewingStage, mode, onStage, onMode }) {
  return <section className="quiet-shell" aria-label="Quiet Cockpit navigation">
    <div className="quiet-context-bar"><div><span>Project</span><strong>{project?.label ?? project?.project_id ?? "No project"}</strong></div><div><span>Flow</span><strong>{flow?.mission_title ?? flow?.title ?? (flow ? "Current Flow" : "No Flow")}</strong></div><StatusBadge tone={connection === "connected" ? "success" : "warning"}>{connection ?? "loading"}</StatusBadge><StatusBadge tone="information">{safetyMode ?? "no-write"}</StatusBadge><CountBadge label={`${attentionCount} attention items`}>{attentionCount}</CountBadge></div>
    <Tabs label="Flow presentation" tabs={QUIET_MODES} selected={mode} onSelect={onMode}/>
    <div className="quiet-stage-selector"><div><span>Current lifecycle stage</span><strong>{stages.find((stage) => stage.id === currentStage)?.label ?? currentStage}</strong></div><label><span>Viewing stage</span><select value={viewingStage} onChange={(event) => onStage(event.target.value)}>{stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.label}</option>)}</select></label></div>
    <nav className="quiet-stage-path" aria-label="Lifecycle stages">{stages.map((stage) => <button type="button" key={stage.id} aria-current={stage.id === currentStage ? "step" : undefined} data-selected={stage.id === viewingStage} onClick={() => onStage(stage.id)}>{stage.label}</button>)}</nav>
    <Disclosure label="Technical context"><dl><dt>Project ID</dt><dd>{project?.project_id ?? "none"}</dd><dt>Flow ID</dt><dd>{flow?.flow_id ?? "none"}</dd></dl></Disclosure>
  </section>;
}
