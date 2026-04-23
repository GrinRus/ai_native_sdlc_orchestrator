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
 * @param {unknown} value
 * @returns {string | null}
 */
function asString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function asNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * @param {unknown} value
 * @returns {Array<unknown>}
 */
function asArray(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeControlPlaneBaseUrl(value) {
  const url = new URL(value);
  if (url.pathname !== "/") {
    url.pathname = url.pathname.replace(/\/+$/u, "");
  }
  return url.toString().replace(/\/+$/u, "");
}

/**
 * @param {{
 *   controlPlane: string,
 *   pathname: string,
 *   query?: Record<string, string | number | undefined>,
 * }} options
 * @returns {URL}
 */
function buildControlPlaneUrl(options) {
  const normalizedBase = normalizeControlPlaneBaseUrl(options.controlPlane);
  const baseWithSlash = normalizedBase.endsWith("/") ? normalizedBase : `${normalizedBase}/`;
  const url = new URL(options.pathname.replace(/^\/+/u, ""), baseWithSlash);
  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      if (value === undefined) continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

/**
 * @param {{
 *   controlPlane: string,
 *   pathname: string,
 *   query?: Record<string, string | number | undefined>,
 * }} options
 */
async function readControlPlaneJson(options) {
  const url = buildControlPlaneUrl(options);
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
    },
  });
  if (!response.ok) {
    const message = (await response.text()).trim();
    throw new Error(`Control-plane request failed (${response.status}) for '${url}': ${message || response.statusText}`);
  }
  return response.json();
}

/**
 * @param {{
 *   controlPlane: string,
 *   pathname: string,
 *   query?: Record<string, string | number | undefined>,
 *   onEvent: (event: Record<string, unknown>) => void,
 * }} options
 */
function openControlPlaneSseStream(options) {
  const controller = new AbortController();

  const done = (async () => {
    const url = buildControlPlaneUrl({
      controlPlane: options.controlPlane,
      pathname: options.pathname,
      query: options.query,
    });
    const response = await fetch(url, {
      headers: {
        accept: "text/event-stream",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      const message = (await response.text()).trim();
      throw new Error(`Control-plane SSE failed (${response.status}) for '${url}': ${message || response.statusText}`);
    }
    if (!response.body) {
      throw new Error("Control-plane SSE stream has no response body.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        return;
      }
      buffer += decoder.decode(chunk.value, { stream: true });

      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");

        const normalizedBlock = block.replace(/\r/g, "");
        const lines = normalizedBlock.split("\n");
        let eventName = "message";
        let data = "";
        for (const line of lines) {
          if (line.startsWith("event:")) {
            eventName = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            const payloadLine = line.slice(5).trimStart();
            data = data.length > 0 ? `${data}\n${payloadLine}` : payloadLine;
          }
        }
        if (eventName !== "live-run-event" || data.length === 0) {
          continue;
        }
        options.onEvent(/** @type {Record<string, unknown>} */ (JSON.parse(data)));
      }
    }
  })();

  return {
    close() {
      controller.abort();
    },
    done: done.catch((error) => {
      if (error instanceof Error && error.name === "AbortError") {
        return;
      }
      throw error;
    }),
  };
}

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
 *   requestedControlPlane: string | null,
 *   uiLifecycleState: Record<string, unknown>,
 * }} options
 * @returns {string | null}
 */
function resolveControlPlaneUrl(options) {
  if (options.requestedControlPlane) {
    return options.requestedControlPlane;
  }
  const controlPlane = asString(options.uiLifecycleState.control_plane);
  const connectionState = asString(options.uiLifecycleState.connection_state);
  if (!controlPlane || connectionState !== "connected") {
    return null;
  }
  return controlPlane;
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef: string,
 *   runtimeRoot?: string,
 *   runId?: string,
 *   controlPlane?: string,
 * }} options
 */
export async function buildOperatorConsoleSnapshot(options) {
  const uiLifecycle = readUiLifecycleState(options);
  const requestedControlPlane = asString(options.controlPlane);
  const connectedControlPlane = resolveControlPlaneUrl({
    requestedControlPlane,
    uiLifecycleState: uiLifecycle.state,
  });
  const strategicSnapshot = readStrategicSnapshot(options);

  if (!connectedControlPlane) {
    const state = readProjectState(options);
    const runs = listRuns(options).sort((left, right) => left.run_id.localeCompare(right.run_id));
    const packets = listPacketArtifacts(options);
    const stepResults = listStepResults(options);
    const qualityArtifacts = listQualityArtifacts(options);
    const deliveryManifests = listDeliveryManifests(options);
    const promotionDecisions = listPromotionDecisions(options);
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
        binding_mode: "module-in-process",
        control_plane: null,
        read_model: [
          "GET /api/projects/:projectId/state",
          "GET /api/projects/:projectId/runs",
          "GET /api/projects/:projectId/packets",
          "GET /api/projects/:projectId/step-results",
          "GET /api/projects/:projectId/quality-artifacts",
          "GET /api/projects/:projectId/delivery-manifests",
          "GET /api/projects/:projectId/promotion-decisions",
          "GET /api/projects/:projectId/strategic-snapshot",
          "GET /api/projects/:projectId/runs/:runId/events/history",
          "GET /api/projects/:projectId/runs/:runId/policy-history",
        ],
        live_stream: "GET /api/projects/:projectId/runs/:runId/events",
        event_contract_family: "live-run-event",
      },
    };
  }

  const projectState = readProjectState(options);
  const projectId = projectState.project_id;

  const [state, runsRaw, packetsRaw, stepResultsRaw, qualityRaw, deliveryRaw, promotionRaw, strategicRaw] =
    await Promise.all([
      readControlPlaneJson({
        controlPlane: connectedControlPlane,
        pathname: `/api/projects/${encodeURIComponent(projectId)}/state`,
      }),
      readControlPlaneJson({
        controlPlane: connectedControlPlane,
        pathname: `/api/projects/${encodeURIComponent(projectId)}/runs`,
      }),
      readControlPlaneJson({
        controlPlane: connectedControlPlane,
        pathname: `/api/projects/${encodeURIComponent(projectId)}/packets`,
      }),
      readControlPlaneJson({
        controlPlane: connectedControlPlane,
        pathname: `/api/projects/${encodeURIComponent(projectId)}/step-results`,
      }),
      readControlPlaneJson({
        controlPlane: connectedControlPlane,
        pathname: `/api/projects/${encodeURIComponent(projectId)}/quality-artifacts`,
      }),
      readControlPlaneJson({
        controlPlane: connectedControlPlane,
        pathname: `/api/projects/${encodeURIComponent(projectId)}/delivery-manifests`,
      }),
      readControlPlaneJson({
        controlPlane: connectedControlPlane,
        pathname: `/api/projects/${encodeURIComponent(projectId)}/promotion-decisions`,
      }),
      readControlPlaneJson({
        controlPlane: connectedControlPlane,
        pathname: `/api/projects/${encodeURIComponent(projectId)}/strategic-snapshot`,
      }).catch(() => strategicSnapshot),
    ]);

  const runs = asArray(runsRaw).sort((left, right) => {
    const leftId = asString(asRecord(left).run_id) ?? "";
    const rightId = asString(asRecord(right).run_id) ?? "";
    return leftId.localeCompare(rightId);
  });
  const packets = /** @type {Array<{ family: string, document: Record<string, unknown> }>} */ (asArray(packetsRaw));
  const stepResults = /** @type {Array<{ document: Record<string, unknown> }>} */ (asArray(stepResultsRaw));
  const qualityArtifacts = /** @type {Array<{ document: Record<string, unknown> }>} */ (asArray(qualityRaw));
  const deliveryManifests = /** @type {Array<{ document: Record<string, unknown> }>} */ (asArray(deliveryRaw));
  const promotionDecisions = /** @type {Array<{ document: Record<string, unknown> }>} */ (asArray(promotionRaw));

  const selectedRunId = selectRunId(/** @type {Array<{ run_id: string }>} */ (runs), options.runId);
  const [selectedRunEventHistory, selectedRunPolicyHistory] = selectedRunId
    ? await Promise.all([
        readControlPlaneJson({
          controlPlane: connectedControlPlane,
          pathname: `/api/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(selectedRunId)}/events/history`,
          query: { limit: 50 },
        }),
        readControlPlaneJson({
          controlPlane: connectedControlPlane,
          pathname: `/api/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(selectedRunId)}/policy-history`,
          query: { limit: 100 },
        }),
      ])
    : [null, null];

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
    strategic_snapshot: strategicRaw,
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
      binding_mode: "detached-http-sse",
      control_plane: connectedControlPlane,
      read_model: [
        "GET /api/projects/:projectId/state",
        "GET /api/projects/:projectId/runs",
        "GET /api/projects/:projectId/packets",
        "GET /api/projects/:projectId/step-results",
        "GET /api/projects/:projectId/quality-artifacts",
        "GET /api/projects/:projectId/delivery-manifests",
        "GET /api/projects/:projectId/promotion-decisions",
        "GET /api/projects/:projectId/strategic-snapshot",
        "GET /api/projects/:projectId/runs/:runId/events/history",
        "GET /api/projects/:projectId/runs/:runId/policy-history",
      ],
      live_stream: "GET /api/projects/:projectId/runs/:runId/events",
      event_contract_family: "live-run-event",
    },
  };
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function asRecord(value) {
  return typeof value === "object" && value !== null ? /** @type {Record<string, unknown>} */ (value) : {};
}

/**
 * @param {Awaited<ReturnType<typeof buildOperatorConsoleSnapshot>>} snapshot
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
 *   controlPlane?: string,
 * }} options
 */
export async function attachOperatorConsoleSession(options) {
  const snapshot = await buildOperatorConsoleSnapshot(options);
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
  /** @type {Promise<void> | null} */
  let streamDone = null;

  if (follow && runId) {
    if (snapshot.api_ui_contract_alignment.binding_mode === "detached-http-sse") {
      const controlPlane = asString(snapshot.api_ui_contract_alignment.control_plane);
      if (!controlPlane) {
        throw new Error("Connected mode is selected but no control-plane base URL is available.");
      }

      const maxReplay = asNumber(options.maxReplay);
      const replayLimit = maxReplay !== null ? Math.floor(maxReplay) : 50;
      const replay = await readControlPlaneJson({
        controlPlane,
        pathname: `/api/projects/${encodeURIComponent(snapshot.project.project_id)}/runs/${encodeURIComponent(runId)}/events/history`,
        query: { limit: replayLimit },
      });
      const replayEvents = asArray(replay.events);
      for (const event of replayEvents) {
        liveEvents.push(/** @type {Record<string, unknown>} */ (event));
      }
      const afterEventId = asString(options.afterEventId) ?? asString(replayEvents.at(-1)?.event_id);

      const stream = openControlPlaneSseStream({
        controlPlane,
        pathname: `/api/projects/${encodeURIComponent(snapshot.project.project_id)}/runs/${encodeURIComponent(runId)}/events`,
        query: {
          after_event_id: afterEventId ?? undefined,
          max_replay: replayLimit,
        },
        onEvent(event) {
          liveEvents.push(event);
          for (const listener of listeners) {
            listener(event);
          }
        },
      });
      streamProtocol = "sse";
      streamBackpressure = { policy: "bounded-replay-window" };
      streamDone = stream.done.catch(() => {});
      unsubscribeStream = () => {
        stream.close();
      };
    } else {
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
    async awaitStreamIdle() {
      if (streamDone) {
        await streamDone;
      }
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
