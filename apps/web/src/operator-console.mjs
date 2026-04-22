import {
  listDeliveryManifests,
  listPacketArtifacts,
  listPromotionDecisions,
  listQualityArtifacts,
  readRunEventHistory,
  readRunPolicyHistory,
  listRuns,
  listStepResults,
  openRunEventStream,
  readStrategicSnapshot,
  readUiLifecycleState,
  readProjectState,
} from "../../api/src/index.mjs";

/**
 * @param {string} value
 * @returns {string}
 */
function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * @param {Array<{ document: Record<string, unknown> }>} artifacts
 * @param {string | null} runId
 * @returns {Array<{ document: Record<string, unknown> }>}
 */
function filterArtifactsByRunId(artifacts, runId) {
  if (!runId) return [];
  return artifacts.filter((artifact) => artifact.document.run_id === runId);
}

/**
 * @param {Array<{ family: string, document: Record<string, unknown> }>} packets
 * @param {string | null} runId
 * @returns {Array<{ family: string, document: Record<string, unknown> }>}
 */
function filterPacketsByRunId(packets, runId) {
  if (!runId) return [];
  return packets.filter((packet) => {
    const runRefs = Array.isArray(packet.document.run_refs) ? packet.document.run_refs : [];
    return runRefs.includes(runId);
  });
}

/**
 * @param {Array<{ run_id: string }>} runs
 * @param {string | undefined} requestedRunId
 * @returns {string | null}
 */
function selectRunId(runs, requestedRunId) {
  if (requestedRunId) {
    return runs.some((run) => run.run_id === requestedRunId) ? requestedRunId : null;
  }
  return runs.length > 0 ? runs[0].run_id : null;
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef: string,
 *   runtimeRoot?: string,
 *   runId?: string,
 * }} options
 */
export function buildOperatorConsoleSnapshot(options) {
  const state = readProjectState(options);
  const uiLifecycle = readUiLifecycleState(options);
  const runs = listRuns(options).sort((left, right) => left.run_id.localeCompare(right.run_id));
  const packets = listPacketArtifacts(options);
  const stepResults = listStepResults(options);
  const qualityArtifacts = listQualityArtifacts(options);
  const deliveryManifests = listDeliveryManifests(options);
  const promotionDecisions = listPromotionDecisions(options);
  const strategicSnapshot = readStrategicSnapshot(options);
  const selectedRunId = selectRunId(runs, options.runId);
  const selectedRunEventHistory = selectedRunId
    ? readRunEventHistory({
        ...options,
        runId: selectedRunId,
        limit: 50,
      })
    : null;
  const selectedRunPolicyHistory = selectedRunId
    ? readRunPolicyHistory({
        ...options,
        runId: selectedRunId,
        limit: 100,
      })
    : null;

  return {
    project: state,
    ui_lifecycle: uiLifecycle.state,
    ui_lifecycle_state_file: uiLifecycle.stateFile,
    runs,
    selected_run_id: selectedRunId,
    packet_artifacts: packets,
    step_results: stepResults,
    quality_artifacts: qualityArtifacts,
    delivery_manifests: deliveryManifests,
    promotion_decisions: promotionDecisions,
    strategic_snapshot: strategicSnapshot,
    run_detail: {
      packet_artifacts: filterPacketsByRunId(packets, selectedRunId),
      step_results: filterArtifactsByRunId(stepResults, selectedRunId),
      quality_artifacts: filterArtifactsByRunId(qualityArtifacts, selectedRunId),
      delivery_manifests: filterArtifactsByRunId(deliveryManifests, selectedRunId),
      promotion_decisions: filterArtifactsByRunId(promotionDecisions, selectedRunId),
      event_history: selectedRunEventHistory,
      policy_history: selectedRunPolicyHistory,
    },
    api_ui_contract_alignment: {
      read_model: [
        "GET /api/projects/:projectId/runs",
        "GET /api/projects/:projectId/packets",
        "GET /api/projects/:projectId/step-results",
        "GET /api/projects/:projectId/quality-artifacts",
        "GET /api/projects/:projectId/runs/:runId/events/history",
        "GET /api/projects/:projectId/runs/:runId/policy-history",
      ],
      live_stream: "GET /api/projects/:projectId/runs/:runId/events",
      event_contract_family: "live-run-event",
    },
  };
}

/**
 * @param {ReturnType<typeof buildOperatorConsoleSnapshot>} snapshot
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
      return `<li><code>${eventType}</code> seq=<code>${sequence}</code> risk=<code>${policyRisk}</code></li>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(options.title ?? "AOR Operator Console")}</title>
    <style>
      :root {
        --bg: #f3f4f6;
        --surface: #ffffff;
        --ink: #111827;
        --muted: #4b5563;
        --accent: #0f766e;
      }
      body {
        margin: 0;
        padding: 24px;
        font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
        background: radial-gradient(circle at 20% 20%, #d1fae5 0%, var(--bg) 35%, #e0f2fe 100%);
        color: var(--ink);
      }
      .panel {
        background: var(--surface);
        border-radius: 12px;
        padding: 16px;
        box-shadow: 0 8px 30px rgb(15 23 42 / 10%);
        margin-bottom: 16px;
      }
      h1, h2 {
        margin: 0 0 8px;
      }
      p, li {
        color: var(--muted);
      }
      code {
        color: var(--accent);
      }
    </style>
  </head>
  <body>
    <section class="panel">
      <h1>AOR Operator Console</h1>
      <p>Project: <code>${escapeHtml(snapshot.project.project_id)}</code></p>
      <p>Selected run: <code>${escapeHtml(snapshot.selected_run_id ?? "none")}</code></p>
      <p>UI lifecycle: <code>${escapeHtml(String(snapshot.ui_lifecycle.connection_state ?? "detached"))}</code></p>
      <p>Stream protocol: <code>${escapeHtml(options.streamProtocol ?? "disabled")}</code></p>
      <p>Live events in session: <code>${String(options.liveEventCount ?? 0)}</code></p>
    </section>
    <section class="panel">
      <h2>Strategic Snapshot</h2>
      <p>Backlog slices tracked: <code>${String(snapshot.strategic_snapshot.wave_snapshot.total_slices)}</code></p>
      <p>Ready slices: <code>${String(snapshot.strategic_snapshot.wave_snapshot.state_totals.ready)}</code></p>
      <p>Blocked slices: <code>${String(snapshot.strategic_snapshot.wave_snapshot.state_totals.blocked)}</code></p>
      <p>High-risk runs: <code>${String(snapshot.strategic_snapshot.risk_snapshot.level_totals.high)}</code></p>
      <p>Medium-risk runs: <code>${String(snapshot.strategic_snapshot.risk_snapshot.level_totals.medium)}</code></p>
    </section>
    <section class="panel">
      <h2>Run list</h2>
      <ul>${runs || "<li>No runs found.</li>"}</ul>
    </section>
    <section class="panel">
      <h2>Run detail evidence links</h2>
      <ul>${detailLinks || "<li>No step-result artifacts for selected run.</li>"}</ul>
      <p>Policy history entries: <code>${String(snapshot.run_detail.policy_history?.entry_count ?? 0)}</code></p>
      <ul>${policyHistoryLinks || "<li>No policy history for selected run.</li>"}</ul>
      <p>Event history entries: <code>${String(snapshot.run_detail.event_history?.total_events ?? 0)}</code></p>
      <ul>${eventHistoryLinks || "<li>No event history for selected run.</li>"}</ul>
      <p>Stream backpressure: <code>${escapeHtml(
        JSON.stringify(options.streamBackpressure ?? { policy: "not-following" }),
      )}</code></p>
    </section>
  </body>
</html>
`;
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef: string,
 *   runtimeRoot?: string,
 *   runId?: string,
 *   follow?: boolean,
 *   afterEventId?: string,
 *   maxReplay?: number,
 * }} options
 */
export function attachOperatorConsoleSession(options) {
  const snapshot = buildOperatorConsoleSnapshot(options);
  const follow = Boolean(options.follow);
  const runId = options.runId ?? snapshot.selected_run_id;

  if (follow && !runId) {
    throw new Error("attachOperatorConsoleSession requires runId when follow mode is enabled.");
  }

  /** @type {Array<Record<string, unknown>>} */
  const liveEvents = [];
  /** @type {Set<(event: Record<string, unknown>) => void>} */
  const listeners = new Set();
  let unsubscribeStream = () => {};
  let streamProtocol = null;
  let streamBackpressure = null;
  let streamLogFile = null;

  if (follow && runId) {
    const stream = openRunEventStream({
      cwd: options.cwd,
      projectRef: options.projectRef,
      runtimeRoot: options.runtimeRoot,
      runId,
      afterEventId: options.afterEventId,
      maxReplay: options.maxReplay,
    });
    streamProtocol = stream.protocol;
    streamBackpressure = stream.backpressure;
    streamLogFile = stream.log_file;
    for (const event of stream.replay_events) {
      liveEvents.push(event);
    }
    unsubscribeStream = stream.subscribe((event) => {
      liveEvents.push(event);
      for (const listener of listeners) {
        listener(event);
      }
    });
  }

  return {
    mode: "detachable-web-console",
    follow_enabled: follow,
    stream_protocol: streamProtocol,
    stream_backpressure: streamBackpressure,
    stream_log_file: streamLogFile,
    replay_events: liveEvents,
    snapshot,
    onEvent(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    render() {
      return renderOperatorConsoleHtml(snapshot, {
        streamProtocol,
        streamBackpressure,
        liveEventCount: liveEvents.length,
      });
    },
    detach() {
      unsubscribeStream();
      listeners.clear();
      return {
        detached: true,
        captured_event_count: liveEvents.length,
      };
    },
  };
}
