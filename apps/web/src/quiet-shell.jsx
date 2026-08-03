import React from "react";
import { Disclosure, Tabs } from "./ui/components.jsx";
export { readQuietPresentation, writeQuietPresentation } from "./quiet-presentation.js";
import "./quiet-shell.css";

export const QUIET_MODES = Object.freeze([{ id: "cockpit", label: "Cockpit" }, { id: "attention", label: "Attention" }, { id: "journey", label: "Journey" }, { id: "evidence", label: "Evidence" }]);

export function QuietShell({ project, flow, stages, currentStage, viewingStage, mode, onStage, onMode, runtimeRoot, version }) {
  const currentStageLabel = stages.find((stage) => stage.id === currentStage)?.label ?? currentStage;
  return <section className="quiet-shell" aria-label="Quiet Cockpit navigation">
    <div className="quiet-view-bar">
      <Tabs label="Flow presentation" tabs={QUIET_MODES} selected={mode} onSelect={onMode}/>
    </div>
    <p className="quiet-stage-current"><span>Current lifecycle stage</span><strong>{currentStageLabel}</strong></p>
    <label className="quiet-stage-mobile"><span>View lifecycle stage</span><select value={viewingStage} onChange={(event) => onStage(event.target.value)}>{stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.label}{stage.id === currentStage ? " — current" : ""}</option>)}</select></label>
    <nav className="quiet-stage-path" aria-label={`Lifecycle stages. Current stage: ${currentStageLabel}`}>{stages.map((stage) => <button type="button" key={stage.id} aria-current={stage.id === currentStage ? "step" : undefined} data-selected={stage.id === viewingStage} onClick={() => onStage(stage.id)}><span>{stage.label}</span></button>)}</nav>
    <Disclosure label="Technical context"><dl><dt>Project</dt><dd>{project?.label ?? project?.project_id ?? "none"}</dd><dt>Project ID</dt><dd>{project?.project_id ?? "none"}</dd><dt>Flow</dt><dd>{flow?.mission_title ?? flow?.title ?? "none"}</dd><dt>Flow ID</dt><dd>{flow?.flow_id ?? "none"}</dd><dt>Runtime root</dt><dd>{runtimeRoot ?? "pending"}</dd><dt>Console version</dt><dd>{version ? `v${version}` : "pending"}</dd></dl></Disclosure>
  </section>;
}
