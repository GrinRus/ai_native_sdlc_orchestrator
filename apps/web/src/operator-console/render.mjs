import { asRecord, escapeHtml, formatPlannerMetric } from "./shared.mjs";

/**
 * @param {Record<string, any>} snapshot
 * @param {{
 *   title?: string,
 *   streamProtocol?: string | null,
 *   streamBackpressure?: Record<string, unknown> | null,
 *   liveEventCount?: number,
 * }} [options]
 * @returns {string}
 */
export function renderOperatorConsoleHtml(snapshot, options = {}) {
  const runs = snapshot.runs
    .map((run) => `<li><code>${escapeHtml(run.run_id)}</code></li>`)
    .join("\n");

  const detailLinks = snapshot.run_detail.step_results
    .map(
      (entry) =>
        `<li><a href="${escapeHtml(String(entry.artifact_ref))}">${escapeHtml(
          String(entry.artifact_ref),
        )}</a></li>`,
    )
    .join("\n");
  const policyHistoryEntries = Array.isArray(snapshot.run_detail.policy_history?.entries)
    ? snapshot.run_detail.policy_history.entries
    : [];
  const policyHistoryLinks = policyHistoryEntries
    .map((entry) => {
      const source = escapeHtml(String(entry.source ?? "unknown"));
      const routeId = escapeHtml(String(entry.route_id ?? "n/a"));
      const policyId = escapeHtml(String(entry.policy_id ?? "n/a"));
      const decision = escapeHtml(String(entry.governance_decision ?? "n/a"));
      return `<li><code>${source}</code> route=<code>${routeId}</code> policy=<code>${policyId}</code> decision=<code>${decision}</code></li>`;
    })
    .join("\n");
  const eventHistoryEntries = Array.isArray(snapshot.run_detail.event_history?.events)
    ? snapshot.run_detail.event_history.events
    : [];
  const eventHistoryLinks = eventHistoryEntries
    .map((entry) => {
      const eventType = escapeHtml(String(entry.event_type ?? "unknown"));
      const sequence = escapeHtml(String(entry.sequence ?? "n/a"));
      const policyRisk = escapeHtml(String(entry.policy_context?.risk_tier ?? "n/a"));
      const interactionId = escapeHtml(String(entry.interaction_id ?? entry.interaction?.interaction_id ?? "n/a"));
      const answerAuditRef = escapeHtml(String(entry.answer_audit_ref ?? "n/a"));
      return `<li><code>${eventType}</code> seq=<code>${sequence}</code> risk=<code>${policyRisk}</code> interaction=<code>${interactionId}</code> answer=<code>${answerAuditRef}</code></li>`;
    })
    .join("\n");
  const interactionItems = (Array.isArray(snapshot.run_detail.interactions) ? snapshot.run_detail.interactions : [])
    .map((interaction) => {
      const interactionId = escapeHtml(String(interaction.interaction_id ?? "n/a"));
      const status = escapeHtml(String(interaction.interaction_status ?? "unknown"));
      const interactionType = escapeHtml(String(interaction.interaction_type ?? "clarification_question"));
      const summary = escapeHtml(String(interaction.question_summary ?? "No summary available."));
      const answerRequired = interaction.answer_required === true ? "yes" : "no";
      const permissionRequest = asRecord(interaction.runtime_permission_request);
      const operation = escapeHtml(String(permissionRequest.operation_type ?? "n/a"));
      const target = escapeHtml(String(permissionRequest.target ?? permissionRequest.command ?? "n/a"));
      return `<li><code>${interactionId}</code> type=<code>${interactionType}</code> status=<code>${status}</code> answer_required=<code>${answerRequired}</code> op=<code>${operation}</code> target=<code>${target}</code> ${summary}</li>`;
    })
    .join("\n");
  const runtimePermissionItems = (
    Array.isArray(snapshot.run_detail.runtime_permission_decisions)
      ? snapshot.run_detail.runtime_permission_decisions
      : []
  )
    .map((entry) => {
      const decision = escapeHtml(String(entry.decision ?? "unknown"));
      const operation = escapeHtml(String(entry.operation_type ?? "unknown"));
      const target = escapeHtml(String(entry.target ?? entry.command ?? "n/a"));
      const adapter = escapeHtml(String(entry.adapter_id ?? "n/a"));
      const mode = escapeHtml(String(entry.permission_mode ?? "n/a"));
      const ruleId = escapeHtml(String(entry.rule_id ?? "n/a"));
      const auditRef = escapeHtml(String(entry.audit_ref ?? "n/a"));
      const continuation = escapeHtml(String(entry.continuation_strategy ?? "n/a"));
      return `<li><code>${decision}</code> op=<code>${operation}</code> target=<code>${target}</code> adapter=<code>${adapter}</code> mode=<code>${mode}</code> rule=<code>${ruleId}</code> continuation=<code>${continuation}</code> audit=<code>${auditRef}</code></li>`;
    })
    .join("\n");
  const lifecycleItems = (snapshot.api_ui_contract_alignment.lifecycle_commands ?? [])
    .map((command) => `<li><code>${escapeHtml(String(command))}</code></li>`)
    .join("\n");
  const guidedStages = Array.isArray(snapshot.guided_lifecycle?.stages) ? snapshot.guided_lifecycle.stages : [];
  const guidedStageItems = guidedStages
    .map((stage) => {
      const evidenceCount = Array.isArray(stage.evidence_refs) ? stage.evidence_refs.length : 0;
      const blockers = Array.isArray(stage.blockers) ? stage.blockers : [];
      const safetyGates = asRecord(stage.safety_gates);
      const closureState = asRecord(stage.closure_state);
      const blockerItems = blockers
        .map((blocker) => {
          const code = escapeHtml(String(blocker.code ?? "blocked"));
          const summary = escapeHtml(String(blocker.summary ?? blocker.message ?? "No blocker summary."));
          return `<li><code>${code}</code> ${summary}</li>`;
        })
        .join("\n");
      const mutation = asRecord(stage.next_action?.mutation);
      return `<li>
        <strong>${escapeHtml(String(stage.label ?? stage.stage_id))}</strong>
        status=<code>${escapeHtml(String(stage.status ?? "unknown"))}</code>
        evidence=<code>${String(evidenceCount)}</code>
        policy=<code>${String(stage.policy_state?.policy_history_entries ?? 0)}</code>
        events=<code>${String(stage.logs_events?.event_history_entries ?? 0)}</code>
        closure=<code>${escapeHtml(String(closureState.status ?? "n/a"))}</code>
        gate=<code>${escapeHtml(String(safetyGates.delivery_gate_status ?? "n/a"))}</code>
        release=<code>${escapeHtml(String(safetyGates.release_packet_status ?? "n/a"))}</code>
        <br />
        next=<code>${escapeHtml(String(stage.next_action?.command ?? "none"))}</code>
        <br />
        mutation=<code>${escapeHtml(String(mutation.transport ?? "read-only"))}</code>
        command=<code>${escapeHtml(String(mutation.command ?? "none"))}</code>
        ${blockerItems ? `<ul>${blockerItems}</ul>` : ""}
      </li>`;
    })
    .join("\n");
  const plannerMetrics = asRecord(snapshot.strategic_snapshot?.planner_metrics);
  const plannerMetricValues = asRecord(plannerMetrics.metrics);
  const financeMonitoring = asRecord(snapshot.finance_monitoring ?? snapshot.strategic_snapshot?.finance_monitoring);
  const monitoringLoop = asRecord(financeMonitoring.monitoring_loop);
  const evidenceClasses = asRecord(monitoringLoop.evidence_classes);
  const productionMonitoring = asRecord(evidenceClasses.production_monitoring);
  const finance = asRecord(financeMonitoring.finance);
  const dimensions = asRecord(finance.dimensions);
  const routeGroups = Array.isArray(dimensions.route) ? dimensions.route : [];

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(options.title ?? "AOR Operator Console")}</title>
    <style>
      :root {
        --bg: #f7f8fa;
        --surface: #ffffff;
        --ink: #111827;
        --muted: #4b5563;
        --accent: #0f766e;
        --line: #d6dde6;
      }
      body {
        margin: 0;
        padding: 24px;
        font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
        background: var(--bg);
        color: var(--ink);
      }
      main {
        display: block;
        max-width: 1180px;
        margin: 0 auto;
      }
      .page-header {
        max-width: 1180px;
        margin: 0 auto 16px;
      }
      .panel {
        background: var(--surface);
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 16px;
        margin-bottom: 16px;
        overflow-x: auto;
      }
      h1, h2 {
        margin: 0 0 8px;
      }
      .eyebrow {
        color: var(--accent);
        font-size: 0.78rem;
        font-weight: 700;
        margin: 0 0 6px;
        text-transform: uppercase;
      }
      .snapshot-boundary {
        color: var(--muted);
        max-width: 72ch;
      }
      p, li {
        color: var(--muted);
      }
      ul {
        padding-left: 1.25rem;
      }
      li {
        margin: 0.25rem 0;
      }
      code {
        color: var(--accent);
      }
      a {
        color: var(--accent);
      }
      code,
      a,
      .ref-list,
      .ref-list li,
      .meta-list li {
        overflow-wrap: anywhere;
        word-break: break-word;
      }
      strong {
        color: var(--ink);
      }
      @media (max-width: 720px) {
        body {
          padding: 12px;
        }
        .panel {
          padding: 12px;
        }
      }
    </style>
  </head>
  <body>
    <header class="page-header panel">
      <p class="eyebrow">Static operator snapshot</p>
      <h1>AOR Operator Console</h1>
      <p id="operator-console-boundary" class="snapshot-boundary">Generated from runtime and control-plane reads. This HTML snapshot does not render browser mutation controls; use the CLI or detached control-plane API for actions, then regenerate the snapshot.</p>
      <p>Project: <code>${escapeHtml(snapshot.project.project_id)}</code></p>
      <p>Selected run: <code>${escapeHtml(snapshot.selected_run_id ?? "none")}</code></p>
      <p>UI lifecycle: <code>${escapeHtml(String(snapshot.ui_lifecycle.connection_state ?? "detached"))}</code></p>
      <p>Guided state: <code>${escapeHtml(String(snapshot.guided_lifecycle?.state ?? "unknown"))}</code></p>
      <p>Stream protocol: <code>${escapeHtml(options.streamProtocol ?? "disabled")}</code></p>
      <p>Live events in session: <code>${String(options.liveEventCount ?? 0)}</code></p>
    </header>
    <main aria-describedby="operator-console-boundary">
    <section class="panel" aria-labelledby="guided-lifecycle-heading">
      <h2 id="guided-lifecycle-heading">Guided lifecycle</h2>
      <p>Current stage: <code>${escapeHtml(String(snapshot.guided_lifecycle?.current_stage_id ?? "unknown"))}</code></p>
      <p>Mutation transport: <code>${escapeHtml(String(snapshot.guided_lifecycle?.mutation_transport?.lifecycle_endpoint ?? "none"))}</code></p>
      <p>Next-action report: <code>${escapeHtml(String(snapshot.guided_lifecycle?.next_action_report_ref ?? "missing"))}</code></p>
      <ul class="ref-list">${guidedStageItems || "<li>No guided stages available.</li>"}</ul>
    </section>
    <section class="panel" aria-labelledby="strategic-snapshot-heading">
      <h2 id="strategic-snapshot-heading">Strategic Snapshot</h2>
      <p>Backlog slices tracked: <code>${String(snapshot.strategic_snapshot.wave_snapshot.total_slices)}</code></p>
      <p>Ready slices: <code>${String(snapshot.strategic_snapshot.wave_snapshot.state_totals.ready)}</code></p>
      <p>Blocked slices: <code>${String(snapshot.strategic_snapshot.wave_snapshot.state_totals.blocked)}</code></p>
      <p>High-risk runs: <code>${String(snapshot.strategic_snapshot.risk_snapshot.level_totals.high)}</code></p>
      <p>Medium-risk runs: <code>${String(snapshot.strategic_snapshot.risk_snapshot.level_totals.medium)}</code></p>
      <p>Planner metrics: <code>${escapeHtml(String(plannerMetrics.status ?? "no-data"))}</code></p>
      <p>Clean-close rate: <code>${escapeHtml(formatPlannerMetric(plannerMetricValues.clean_close_rate))}</code></p>
      <p>Retry rate: <code>${escapeHtml(formatPlannerMetric(plannerMetricValues.retry_rate))}</code></p>
      <p>Repair rate: <code>${escapeHtml(formatPlannerMetric(plannerMetricValues.repair_rate))}</code></p>
      <p>Blocker rate: <code>${escapeHtml(formatPlannerMetric(plannerMetricValues.blocker_rate))}</code></p>
    </section>
    <section class="panel" aria-labelledby="finance-monitoring-heading">
      <h2 id="finance-monitoring-heading">Finance Monitoring</h2>
      <p>Telemetry state: <code>${escapeHtml(String(financeMonitoring.telemetry_state ?? "no-data"))}</code></p>
      <p>Route groups: <code>${String(routeGroups.length)}</code></p>
      <p>Production monitoring: <code>${escapeHtml(String(productionMonitoring.status ?? "no-data"))}</code></p>
      <p>Production events: <code>${String(productionMonitoring.event_count ?? 0)}</code></p>
    </section>
    <section class="panel" aria-labelledby="run-list-heading">
      <h2 id="run-list-heading">Run list</h2>
      <ul class="meta-list">${runs || "<li>No runs found.</li>"}</ul>
    </section>
    <section class="panel" aria-labelledby="lifecycle-commands-heading">
      <h2 id="lifecycle-commands-heading">Lifecycle commands</h2>
      <ul class="ref-list">${lifecycleItems || "<li>No lifecycle command mutations available.</li>"}</ul>
    </section>
    <section class="panel" aria-labelledby="runner-interactions-heading">
      <h2 id="runner-interactions-heading">Runner interactions</h2>
      <ul class="ref-list">${interactionItems || "<li>No pending runner interactions.</li>"}</ul>
    </section>
    <section class="panel" aria-labelledby="runtime-permission-decisions-heading">
      <h2 id="runtime-permission-decisions-heading">Runtime permission decisions</h2>
      <ul class="ref-list">${runtimePermissionItems || "<li>No runtime permission decisions for selected run.</li>"}</ul>
    </section>
    <section class="panel" aria-labelledby="run-detail-evidence-heading">
      <h2 id="run-detail-evidence-heading">Run detail evidence links</h2>
      <ul class="ref-list">${detailLinks || "<li>No step-result artifacts for selected run.</li>"}</ul>
      <p>Policy history entries: <code>${String(snapshot.run_detail.policy_history?.entry_count ?? 0)}</code></p>
      <ul class="ref-list">${policyHistoryLinks || "<li>No policy history for selected run.</li>"}</ul>
      <p>Event history entries: <code>${String(snapshot.run_detail.event_history?.total_events ?? 0)}</code></p>
      <ul class="ref-list">${eventHistoryLinks || "<li>No event history for selected run.</li>"}</ul>
      <p>Stream backpressure: <code>${escapeHtml(
        JSON.stringify(options.streamBackpressure ?? { policy: "not-following" }),
      )}</code></p>
    </section>
    </main>
  </body>
</html>
`;
}
