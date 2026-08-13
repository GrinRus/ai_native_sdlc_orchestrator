export const TASK_WORKSPACE_SCREEN_IDS = Object.freeze([
  "tasks-home",
  "new-task",
  "markdown-sources",
  "prepared-task",
  "active-task-workspace",
  "attention",
  "review-changes",
  "completion-evidence",
]);

export const TASK_WORKSPACE_ACTION_IDS = Object.freeze([
  "task.create",
  "task.source.add",
  "task.prepare",
  "task.confirm",
  "task.start",
  "task.pause",
  "task.cancel",
  "task.retry",
  "task.review",
  "task.request-revision",
  "task.complete",
]);

export const TASK_WORKSPACE_SCENARIO_IDS = Object.freeze([
  "text-only",
  "upload-markdown",
  "repository-markdown",
  "stale-source",
  "runner-unavailable",
  "attention",
  "failure",
  "review",
  "completion",
  "reload",
  "offline",
  "accessibility",
]);

const FORBIDDEN_LEGACY_MARKERS = [".flow-cockpit", "Continue Flow", "Ask AOR for selected flow", "selected-Flow readiness"];

export function buildTaskWorkspaceProofManifest(options = {}) {
  return {
    schema_version: 1,
    kind: "task-workspace-browser-proof",
    acceptance_mode: "development-local-browser",
    provider_execution: "prohibited",
    screens: [...TASK_WORKSPACE_SCREEN_IDS],
    actions: [...TASK_WORKSPACE_ACTION_IDS],
    lifecycle: ["Project", "Task", "Prepare", "Start", "Work", "Review", "Complete"],
    evidence_requirements: ["visible-screen", "canonical-action", "durable-public-id", "post-reload-readback"],
    compatibility: { historical_v2_readable: true, historical_v2_counts_for_acceptance: false },
    fixture_server: options.fixture_server ?? "local-fixture-server",
    scenarios: [...TASK_WORKSPACE_SCENARIO_IDS],
    scenario_matrix: TASK_WORKSPACE_SCENARIO_IDS.map((id) => ({
      id,
      provider_execution: "prohibited",
      upstream_write: "prohibited",
      requires: ["visible-screen", "durable-public-id", "post-reload-readback"],
    })),
    closure_requirements: {
      no_runtime_state_commit: true,
      no_credentials: true,
      no_private_paths: true,
      no_upstream_write: true,
      historical_v2_counts_for_acceptance: false,
    },
  };
}

export function validateTaskWorkspaceProofManifest(value) {
  const findings = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, findings: ["manifest must be an object"] };
  if (value.schema_version !== 1) findings.push("schema_version must be 1");
  if (value.kind !== "task-workspace-browser-proof") findings.push("kind must identify Task Workspace proof");
  if (value.acceptance_mode !== "development-local-browser") findings.push("acceptance_mode must be local-browser development");
  if (value.provider_execution !== "prohibited") findings.push("provider execution must be prohibited");
  const screens = Array.isArray(value.screens) ? value.screens : [];
  const actions = Array.isArray(value.actions) ? value.actions : [];
  for (const id of TASK_WORKSPACE_SCREEN_IDS) if (!screens.includes(id)) findings.push(`missing screen ${id}`);
  for (const id of TASK_WORKSPACE_ACTION_IDS) if (!actions.includes(id)) findings.push(`missing action ${id}`);
  const scenarios = Array.isArray(value.scenarios) ? value.scenarios : [];
  for (const id of TASK_WORKSPACE_SCENARIO_IDS) if (!scenarios.includes(id)) findings.push(`missing scenario ${id}`);
  const scenarioMatrix = Array.isArray(value.scenario_matrix) ? value.scenario_matrix : [];
  for (const id of TASK_WORKSPACE_SCENARIO_IDS) {
    const entry = scenarioMatrix.find((candidate) => candidate?.id === id);
    if (!entry) findings.push(`missing scenario matrix entry ${id}`);
    else {
      if (entry.provider_execution !== "prohibited") findings.push(`scenario ${id} permits provider execution`);
      if (entry.upstream_write !== "prohibited") findings.push(`scenario ${id} permits upstream write`);
    }
  }
  const evidence = Array.isArray(value.evidence_requirements) ? value.evidence_requirements : [];
  for (const requirement of ["visible-screen", "canonical-action", "durable-public-id", "post-reload-readback"]) {
    if (!evidence.includes(requirement)) findings.push(`missing evidence requirement ${requirement}`);
  }
  if (value.compatibility?.historical_v2_counts_for_acceptance !== false) findings.push("historical v2 proof must not count for acceptance");
  for (const [field, expected] of Object.entries({ no_runtime_state_commit: true, no_credentials: true, no_private_paths: true, no_upstream_write: true, historical_v2_counts_for_acceptance: false })) {
    if (value.closure_requirements?.[field] !== expected) findings.push(`closure requirement ${field} is not fail-closed`);
  }
  if (Array.isArray(value.source_text)) {
    for (const marker of FORBIDDEN_LEGACY_MARKERS) if (value.source_text.some((text) => String(text).includes(marker))) findings.push(`forbidden legacy marker ${marker}`);
  }
  return findings.length ? { ok: false, findings } : { ok: true, findings: [] };
}

export function validateTaskWorkspaceScenarioEvidence(evidence) {
  const findings = [];
  if (!evidence || typeof evidence !== "object") return { ok: false, findings: ["scenario evidence must be an object"] };
  if (!TASK_WORKSPACE_SCREEN_IDS.includes(evidence.screen_id)) findings.push("screen_id must be canonical");
  if (!TASK_WORKSPACE_ACTION_IDS.includes(evidence.action_id)) findings.push("action_id must be canonical");
  if (!TASK_WORKSPACE_SCENARIO_IDS.includes(evidence.scenario_id)) findings.push("scenario_id must be canonical");
  if (!String(evidence.durable_public_id ?? "").trim()) findings.push("durable_public_id is required");
  if (!String(evidence.post_reload_readback_ref ?? "").trim()) findings.push("post_reload_readback_ref is required");
  if (evidence.ui_interaction !== true) findings.push("ui_interaction must be true");
  if (evidence.provider_execution !== "prohibited") findings.push("provider_execution must be prohibited");
  if (evidence.upstream_write !== "prohibited") findings.push("upstream_write must be prohibited");
  return findings.length ? { ok: false, findings } : { ok: true, findings: [] };
}
