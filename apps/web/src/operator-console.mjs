import {
  applyRunControlAction,
  attachUiLifecycle,
  detachUiLifecycle,
  listDeliveryManifests,
  listPacketArtifacts,
  listPromotionDecisions,
  listQualityArtifacts,
  readNextActionReport,
  readFinanceMonitoringSnapshot,
  readRunEventHistory,
  readRunPolicyHistory,
  listRuns,
  listStepResults,
  openRunEventStream,
  readStrategicSnapshot,
  readUiLifecycleState,
  readProjectState,
  runLifecycleCommand,
  submitInteractionAnswer,
} from "../../api/src/index.mjs";

const LIFECYCLE_COMMANDS = Object.freeze([
  "project init",
  "intake create",
  "mission create",
  "next",
  "discovery run",
  "spec build",
  "wave create",
  "handoff prepare",
  "handoff approve",
  "run start",
  "run pause",
  "run resume",
  "run steer",
  "run cancel",
  "review run",
  "review decide",
  "deliver prepare",
  "release prepare",
  "learning handoff",
]);

const GUIDED_STAGE_DEFINITIONS = Object.freeze([
  {
    stage_id: "readiness",
    label: "Readiness",
    stage_keys: ["onboarding"],
    default_command: "project init",
  },
  {
    stage_id: "mission",
    label: "Mission",
    stage_keys: ["mission-intake"],
    default_command: "mission create",
  },
  {
    stage_id: "discovery-spec-plan",
    label: "Discovery, Spec, Plan",
    stage_keys: ["discovery", "spec-build", "planning"],
    default_command: "discovery run",
  },
  {
    stage_id: "execution",
    label: "Execution",
    stage_keys: ["run-active", "execution"],
    default_command: "run start",
  },
  {
    stage_id: "review-qa",
    label: "Review and QA",
    stage_keys: ["review", "qa"],
    default_command: "review run",
  },
  {
    stage_id: "delivery-release",
    label: "Delivery and Release",
    stage_keys: ["delivery", "release"],
    default_command: "deliver prepare",
  },
  {
    stage_id: "learning",
    label: "Learning",
    stage_keys: ["learning"],
    default_command: "learning handoff",
  },
]);

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
 *   authToken?: string,
 *   accept: string,
 *   contentType?: string,
 * }} options
 */
function buildControlPlaneHeaders(options) {
  /** @type {Record<string, string>} */
  const headers = {
    accept: options.accept,
  };
  if (options.accept !== "text/event-stream") {
    headers.connection = "close";
  }
  if (options.contentType) {
    headers["content-type"] = options.contentType;
  }
  const authToken = asString(options.authToken);
  if (authToken) {
    headers.authorization = `Bearer ${authToken}`;
  }
  return headers;
}

/**
 * @param {{
 *   controlPlane: string,
  *   pathname: string,
  *   query?: Record<string, string | number | undefined>,
 *   authToken?: string,
 * }} options
 */
async function readControlPlaneJson(options) {
  const url = buildControlPlaneUrl(options);
  const response = await fetch(url, {
    headers: buildControlPlaneHeaders({
      accept: "application/json",
      authToken: options.authToken,
    }),
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
  *   body: Record<string, unknown>,
 *   authToken?: string,
 *   allowedStatusCodes?: number[],
 * }} options
 */
async function writeControlPlaneJson(options) {
  const url = buildControlPlaneUrl(options);
  const response = await fetch(url, {
    method: "POST",
    headers: buildControlPlaneHeaders({
      accept: "application/json",
      contentType: "application/json; charset=utf-8",
      authToken: options.authToken,
    }),
    body: JSON.stringify(options.body),
  });

  const raw = await response.text();
  let payload = {};
  if (raw.trim().length > 0) {
    try {
      payload = /** @type {Record<string, unknown>} */ (JSON.parse(raw));
    } catch {
      throw new Error(`Control-plane mutation returned invalid JSON (${response.status}) for '${url}'.`);
    }
  }

  const allowedStatusCodes = options.allowedStatusCodes ?? [];
  if (!response.ok && !allowedStatusCodes.includes(response.status)) {
    const errorPayload = asRecord(asRecord(payload).error);
    const message = asString(errorPayload.message) ?? (raw.trim().length > 0 ? raw.trim() : response.statusText);
    throw new Error(`Control-plane mutation failed (${response.status}) for '${url}': ${message}`);
  }
  return payload;
}

/**
 * @param {{
 *   controlPlane: string,
  *   pathname: string,
  *   query?: Record<string, string | number | undefined>,
 *   authToken?: string,
 *   onEvent: (event: Record<string, unknown>) => void,
 * }} options
 */
function openControlPlaneSseStream(options) {
  const controller = new AbortController();
  /** @type {ReadableStreamDefaultReader<Uint8Array> | null} */
  let reader = null;

  const done = (async () => {
    const url = buildControlPlaneUrl({
      controlPlane: options.controlPlane,
      pathname: options.pathname,
      query: options.query,
    });
    const response = await fetch(url, {
      headers: buildControlPlaneHeaders({
        accept: "text/event-stream",
        authToken: options.authToken,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const message = (await response.text()).trim();
      throw new Error(`Control-plane SSE failed (${response.status}) for '${url}': ${message || response.statusText}`);
    }
    if (!response.body) {
      throw new Error("Control-plane SSE stream has no response body.");
    }

    reader = response.body.getReader();
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
      if (reader) {
        reader.cancel().catch(() => {});
      }
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
 * @param {Array<{ artifact_ref?: string, file?: string, document: Record<string, unknown> }>} stepResults
 * @returns {Array<Record<string, unknown>>}
 */
function collectRunnerInteractions(stepResults) {
  return stepResults
    .map((entry) => {
      const requestedInteraction = asRecord(entry.document.requested_interaction);
      if (requestedInteraction.requested !== true) {
        return null;
      }
      const status = asString(requestedInteraction.status) ?? "requested";
      return {
        run_id: asString(entry.document.run_id),
        step_id: asString(entry.document.step_id),
        step_result_id: asString(entry.document.step_result_id),
        step_result_ref: asString(entry.artifact_ref) ?? asString(entry.file),
        interaction_id: asString(requestedInteraction.interaction_id),
        interaction_type: asString(requestedInteraction.interaction_type) ?? "clarification_question",
        interaction_status: status,
        question_summary: asString(requestedInteraction.prompt_summary) ?? asString(requestedInteraction.summary),
        answer_required: status === "requested",
        runtime_permission_request: asRecord(requestedInteraction.runtime_permission_request),
        runtime_permission_decision: asRecord(requestedInteraction.runtime_permission_decision),
        answer_audit_refs: Array.isArray(requestedInteraction.answer_audit_refs)
          ? requestedInteraction.answer_audit_refs.filter((value) => typeof value === "string")
          : [],
        continuation: asRecord(requestedInteraction.continuation),
      };
    })
    .filter(Boolean);
}

/**
 * @param {Array<{ artifact_ref?: string, file?: string, document: Record<string, unknown> }>} stepResults
 * @returns {Array<Record<string, unknown>>}
 */
function collectRuntimePermissionDecisions(stepResults) {
  return stepResults
    .map((entry) => {
      const requestedInteraction = asRecord(entry.document.requested_interaction);
      const topLevelRequest = asRecord(entry.document.runtime_permission_request);
      const interactionRequest = asRecord(requestedInteraction.runtime_permission_request);
      const permissionRequest = Object.keys(topLevelRequest).length > 0 ? topLevelRequest : interactionRequest;
      const topLevelDecision = asRecord(entry.document.runtime_permission_decision);
      const interactionDecision = asRecord(requestedInteraction.runtime_permission_decision);
      const permissionDecision = Object.keys(topLevelDecision).length > 0 ? topLevelDecision : interactionDecision;
      if (Object.keys(permissionDecision).length === 0) {
        return null;
      }
      return {
        run_id: asString(entry.document.run_id),
        step_id: asString(entry.document.step_id),
        step_result_id: asString(entry.document.step_result_id),
        step_result_ref: asString(entry.artifact_ref) ?? asString(entry.file),
        interaction_id: asString(requestedInteraction.interaction_id),
        adapter_id: asString(permissionRequest.adapter_id),
        permission_mode: asString(permissionRequest.permission_mode),
        operation_type: asString(permissionRequest.operation_type) ?? "unknown",
        target: asString(permissionRequest.target) ?? asString(permissionRequest.target_path),
        command: asString(permissionRequest.command),
        decision: asString(permissionDecision.decision) ?? "unknown",
        rule_id: asString(permissionDecision.rule_id),
        approval_scope: asString(permissionDecision.approval_scope),
        approval_resume_mode: asString(permissionDecision.approval_resume_mode),
        continuation_strategy: asString(permissionDecision.continuation_strategy),
        audit_ref: asString(permissionDecision.audit_ref),
        grant_ref: asString(permissionDecision.grant_ref),
      };
    })
    .filter(Boolean);
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
 * @param {unknown[]} values
 * @returns {string[]}
 */
function uniqueStrings(values) {
  return Array.from(
    new Set(values.filter((value) => typeof value === "string" && value.trim().length > 0).map((value) => value.trim())),
  );
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function asStringArray(value) {
  return Array.isArray(value)
    ? value.filter((entry) => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim())
    : [];
}

/**
 * @param {Record<string, unknown> | null | undefined} report
 * @returns {string | null}
 */
function resolveNextActionStageId(report) {
  const stage = asString(asRecord(asRecord(report).project_state).stage);
  if (!stage) return null;
  for (const stageDefinition of GUIDED_STAGE_DEFINITIONS) {
    if (stageDefinition.stage_keys.includes(stage)) {
      return stageDefinition.stage_id;
    }
  }
  return null;
}

/**
 * @param {Record<string, unknown> | null | undefined} report
 * @param {string} stageId
 * @returns {Record<string, unknown>}
 */
function resolveClosureStageState(report, stageId) {
  const closureState = asRecord(asRecord(report).closure_state);
  if (stageId === "review-qa") return asRecord(closureState.review);
  if (stageId === "delivery-release") return asRecord(closureState.delivery);
  if (stageId === "learning") return asRecord(closureState.learning);
  return {};
}

/**
 * @param {Record<string, unknown> | null | undefined} report
 * @returns {Record<string, unknown>}
 */
function buildClosureSafetyGates(report) {
  const closureState = asRecord(asRecord(report).closure_state);
  const review = asRecord(closureState.review);
  const delivery = asRecord(closureState.delivery);
  const learning = asRecord(closureState.learning);
  return {
    run_id: asString(closureState.run_id),
    review_decision: asString(review.decision),
    review_status: asString(review.status),
    delivery_gate_status: asString(review.delivery_gate_status),
    blocks_downstream: review.blocks_downstream === true,
    required_review_evidence_refs: asStringArray(review.required_evidence_refs),
    delivery_status: asString(delivery.status),
    delivery_blocked_reasons: asStringArray(delivery.blocked_reasons),
    release_packet_status: asString(delivery.release_packet_status),
    learning_status: asString(learning.status),
  };
}

/**
 * @param {Record<string, unknown>} primaryAction
 * @returns {string | null}
 */
function resolveMutationCommand(primaryAction) {
  const actionId = asString(primaryAction.action_id);
  if (actionId === "mission-create" || actionId === "complete-mission-intake" || actionId === "repair-mission-intake") {
    return "mission create";
  }
  const lowLevelCommand = asString(primaryAction.low_level_command);
  if (lowLevelCommand && LIFECYCLE_COMMANDS.includes(lowLevelCommand)) {
    return lowLevelCommand;
  }
  return null;
}

/**
 * @param {{
 *   command: string | null,
 *   bindingMode: string,
 *   readOnly: boolean,
 * }} options
 */
function buildGuidedMutationDescriptor(options) {
  if (options.readOnly) {
    return {
      available: false,
      command: options.command,
      transport: "read-only",
      endpoint: null,
      unavailable_reason: "The console was opened in read-only mode; runtime evidence is still visible.",
    };
  }
  if (!options.command || !LIFECYCLE_COMMANDS.includes(options.command)) {
    return {
      available: false,
      command: options.command,
      transport: "read-only",
      endpoint: null,
      unavailable_reason: "The current next action is an inspection or external command, not a lifecycle mutation.",
    };
  }
  return {
    available: true,
    command: options.command,
    transport: options.bindingMode === "detached-http-sse" ? "control-plane" : "module-runtime",
    endpoint:
      options.bindingMode === "detached-http-sse"
        ? "POST /api/projects/:projectId/lifecycle-command/actions"
        : "MODULE lifecycle-command.apply",
    unavailable_reason: null,
  };
}

/**
 * @param {Array<{ family?: string, artifact_ref?: string, file?: string, document: Record<string, unknown> }>} entries
 * @param {(entry: { family?: string, artifact_ref?: string, file?: string, document: Record<string, unknown> }) => boolean} predicate
 * @returns {string[]}
 */
function evidenceRefsFor(entries, predicate) {
  return uniqueStrings(
    entries
      .filter(predicate)
      .flatMap((entry) => [
        asString(entry.artifact_ref),
        asString(entry.file),
        ...asArray(entry.document.evidence_refs),
        ...asArray(entry.document.verification_refs),
        ...asArray(entry.document.source_refs),
      ]),
  );
}

/**
 * @param {{
 *   stageId: string,
 *   snapshot: Record<string, unknown>,
 *   nextActionReport: Record<string, unknown> | null,
 * }} options
 * @returns {string[]}
 */
function collectGuidedStageEvidence(options) {
  const snapshot = options.snapshot;
  const packets = /** @type {Array<{ family?: string, artifact_ref?: string, file?: string, document: Record<string, unknown> }>} */ (
    asArray(snapshot.packet_artifacts)
  );
  const stepResults = /** @type {Array<{ family?: string, artifact_ref?: string, file?: string, document: Record<string, unknown> }>} */ (
    asArray(snapshot.step_results)
  );
  const qualityArtifacts = /** @type {Array<{ family?: string, artifact_ref?: string, file?: string, document: Record<string, unknown> }>} */ (
    asArray(snapshot.quality_artifacts)
  );
  const deliveryManifests = /** @type {Array<{ family?: string, artifact_ref?: string, file?: string, document: Record<string, unknown> }>} */ (
    asArray(snapshot.delivery_manifests)
  );
  const promotionDecisions = /** @type {Array<{ family?: string, artifact_ref?: string, file?: string, document: Record<string, unknown> }>} */ (
    asArray(snapshot.promotion_decisions)
  );
  const nextActionEvidence = asStringArray(asRecord(options.nextActionReport).evidence_refs);
  const missionState = asRecord(asRecord(options.nextActionReport).mission_state);
  const closureState = asRecord(asRecord(options.nextActionReport).closure_state);
  const reviewClosure = asRecord(closureState.review);
  const deliveryClosure = asRecord(closureState.delivery);
  const learningClosure = asRecord(closureState.learning);
  const closureEvidence = asStringArray(closureState.evidence_chain);

  if (options.stageId === "readiness") {
    return uniqueStrings([
      asString(asRecord(snapshot.project).state_file),
      asString(asRecord(asRecord(options.nextActionReport).project_state).onboarding_report_ref),
      ...nextActionEvidence,
    ]);
  }

  if (options.stageId === "mission") {
    return uniqueStrings([
      asString(missionState.intake_packet_ref),
      asString(missionState.intake_body_ref),
      ...evidenceRefsFor(packets, (entry) => entry.document.packet_type === "intake-request"),
      ...nextActionEvidence,
    ]);
  }

  if (options.stageId === "discovery-spec-plan") {
    return uniqueStrings([
      ...evidenceRefsFor(stepResults, (entry) =>
        ["discovery", "spec", "planner", "planning"].includes(asString(entry.document.step_class) ?? ""),
      ),
      ...nextActionEvidence,
    ]);
  }

  if (options.stageId === "execution") {
    return uniqueStrings([
      ...evidenceRefsFor(stepResults, (entry) => asString(entry.document.run_id) === asString(snapshot.selected_run_id)),
      ...asArray(asRecord(asRecord(snapshot.run_detail).event_history).events).map((event) => asString(asRecord(event).event_id)),
      ...nextActionEvidence,
    ]);
  }

  if (options.stageId === "review-qa") {
    return uniqueStrings([
      asString(reviewClosure.review_report_ref),
      asString(reviewClosure.runtime_harness_report_ref),
      asString(reviewClosure.decision_ref),
      ...asStringArray(reviewClosure.required_evidence_refs),
      ...evidenceRefsFor(qualityArtifacts, (entry) =>
        ["review-report", "review-decision", "runtime-harness-report", "evaluation-report", "validation-report"].includes(
          asString(entry.family) ?? "",
        ),
      ),
      ...closureEvidence,
      ...nextActionEvidence,
    ]);
  }

  if (options.stageId === "delivery-release") {
    return uniqueStrings([
      asString(deliveryClosure.delivery_plan_ref),
      asString(deliveryClosure.delivery_manifest_ref),
      asString(deliveryClosure.release_packet_ref),
      ...evidenceRefsFor(packets, (entry) =>
        ["delivery-plan", "delivery-manifest", "release-packet"].includes(asString(entry.family) ?? ""),
      ),
      ...evidenceRefsFor(deliveryManifests, () => true),
      ...closureEvidence,
      ...nextActionEvidence,
    ]);
  }

  if (options.stageId === "learning") {
    return uniqueStrings([
      asString(learningClosure.scorecard_ref),
      asString(learningClosure.handoff_ref),
      ...asStringArray(learningClosure.linked_evidence_refs),
      ...evidenceRefsFor(qualityArtifacts, (entry) =>
        ["learning-loop-scorecard", "learning-loop-handoff", "incident-report", "incident-backfill-proposal"].includes(
          asString(entry.family) ?? "",
        ),
      ),
      ...evidenceRefsFor(promotionDecisions, () => true),
      ...closureEvidence,
      ...nextActionEvidence,
    ]);
  }

  return nextActionEvidence;
}

/**
 * @param {{
 *   stageId: string,
 *   snapshot: Record<string, unknown>,
 *   nextActionReport: Record<string, unknown> | null,
 * }} options
 * @returns {boolean}
 */
function isGuidedStageDone(options) {
  const snapshot = options.snapshot;
  const packets = /** @type {Array<{ family?: string, document: Record<string, unknown> }>} */ (asArray(snapshot.packet_artifacts));
  const stepResults = /** @type {Array<{ family?: string, document: Record<string, unknown> }>} */ (asArray(snapshot.step_results));
  const qualityArtifacts = /** @type {Array<{ family?: string, document: Record<string, unknown> }>} */ (asArray(snapshot.quality_artifacts));
  const deliveryManifests = /** @type {Array<{ family?: string, document: Record<string, unknown> }>} */ (
    asArray(snapshot.delivery_manifests)
  );
  const nextReport = asRecord(options.nextActionReport);
  const closureState = asRecord(nextReport.closure_state);
  const reviewClosure = asRecord(closureState.review);
  const deliveryClosure = asRecord(closureState.delivery);
  const learningClosure = asRecord(closureState.learning);

  if (options.stageId === "readiness") {
    return asString(asRecord(nextReport.project_state).onboarding_report_ref) !== null || asString(asRecord(snapshot.project).state_file) !== null;
  }
  if (options.stageId === "mission") {
    const missionState = asRecord(nextReport.mission_state);
    return (
      asString(missionState.completeness_status) === "complete" ||
      packets.some((entry) => entry.document.packet_type === "intake-request")
    );
  }
  if (options.stageId === "discovery-spec-plan") {
    return stepResults.some((entry) =>
      ["discovery", "spec", "planner", "planning"].includes(asString(entry.document.step_class) ?? ""),
    );
  }
  if (options.stageId === "execution") {
    return stepResults.some((entry) => asString(entry.document.run_id) === asString(snapshot.selected_run_id));
  }
  if (options.stageId === "review-qa") {
    return (
      asString(reviewClosure.status) === "approved" ||
      asString(reviewClosure.status) === "held" ||
      asString(reviewClosure.status) === "repair-requested" ||
      qualityArtifacts.some((entry) =>
        ["review-report", "review-decision", "runtime-harness-report", "evaluation-report"].includes(asString(entry.family) ?? ""),
      )
    );
  }
  if (options.stageId === "delivery-release") {
    return (
      ["delivery-plan-ready", "delivery-prepared", "release-ready"].includes(asString(deliveryClosure.status) ?? "") ||
      deliveryManifests.length > 0 ||
      packets.some((entry) => ["delivery-plan", "delivery-manifest", "release-packet"].includes(asString(entry.family) ?? ""))
    );
  }
  if (options.stageId === "learning") {
    return (
      asString(learningClosure.status) === "handoff-complete" ||
      qualityArtifacts.some((entry) =>
        ["learning-loop-scorecard", "learning-loop-handoff"].includes(asString(entry.family) ?? ""),
      )
    );
  }
  return false;
}

/**
 * @param {{
 *   snapshot: Record<string, unknown>,
 *   readOnly?: boolean,
 * }} options
 */
function buildGuidedLifecycle(options) {
  const snapshot = options.snapshot;
  const nextActionEntry = asRecord(snapshot.next_action_report);
  const nextActionReport = Object.keys(nextActionEntry).length > 0 ? asRecord(nextActionEntry.document) : null;
  const primaryAction = asRecord(asRecord(nextActionReport).primary_action);
  const activeStageId = resolveNextActionStageId(nextActionReport) ?? "mission";
  const bindingMode = asString(asRecord(snapshot.api_ui_contract_alignment).binding_mode) ?? "module-in-process";
  const readOnly = options.readOnly === true;
  const selectedRunId = asString(snapshot.selected_run_id);
  const eventHistory = asRecord(asRecord(snapshot.run_detail).event_history);
  const policyHistory = asRecord(asRecord(snapshot.run_detail).policy_history);
  const nextActionStatus = asString(asRecord(nextActionReport).status);
  const mutationCommand = Object.keys(primaryAction).length > 0 ? resolveMutationCommand(primaryAction) : "next";
  const currentNextAction =
    Object.keys(primaryAction).length > 0
      ? {
          action_id: asString(primaryAction.action_id) ?? "unknown",
          command: asString(primaryAction.command) ?? "aor next",
          reason: asString(primaryAction.reason) ?? "Inspect the durable next-action report.",
          low_level_command: asString(primaryAction.low_level_command) ?? mutationCommand,
          evidence_refs: asStringArray(primaryAction.evidence_refs),
          mutation: buildGuidedMutationDescriptor({
            command: mutationCommand,
            bindingMode,
            readOnly,
          }),
        }
      : {
          action_id: "refresh-next-action",
          command: `aor next --project-ref ${String(asRecord(snapshot.project).project_root ?? ".")}`,
          reason: "No durable next-action-report is available for the console snapshot.",
          low_level_command: "next",
          evidence_refs: uniqueStrings([asString(asRecord(snapshot.project).state_file)]),
          mutation: buildGuidedMutationDescriptor({
            command: "next",
            bindingMode,
            readOnly,
          }),
        };

  const stages = GUIDED_STAGE_DEFINITIONS.map((stageDefinition) => {
    const done = isGuidedStageDone({
      stageId: stageDefinition.stage_id,
      snapshot,
      nextActionReport,
    });
    const current = stageDefinition.stage_id === activeStageId;
    const status = current
      ? nextActionStatus === "blocked"
        ? "blocked"
        : stageDefinition.stage_id === "execution" && selectedRunId
          ? "active"
          : "ready"
      : done
        ? "done"
        : "pending";
    const blockers = current ? asArray(asRecord(nextActionReport).blockers) : [];
    const stageNextAction = current
      ? currentNextAction
      : {
          action_id: status === "done" ? `inspect-${stageDefinition.stage_id}` : `wait-for-${stageDefinition.stage_id}`,
          command:
            status === "done"
              ? `Inspect ${stageDefinition.label.toLowerCase()} evidence in the console.`
              : "Complete the current guided stage first.",
          reason:
            status === "done"
              ? "Stage evidence already exists in durable runtime artifacts."
              : "Guided lifecycle order is derived from the current next-action report.",
          low_level_command: stageDefinition.default_command,
          evidence_refs: [],
          mutation: buildGuidedMutationDescriptor({
            command: null,
            bindingMode,
            readOnly: true,
          }),
        };

    return {
      stage_id: stageDefinition.stage_id,
      label: stageDefinition.label,
      status,
      closure_state: resolveClosureStageState(nextActionReport, stageDefinition.stage_id),
      safety_gates: buildClosureSafetyGates(nextActionReport),
      evidence_refs: collectGuidedStageEvidence({
        stageId: stageDefinition.stage_id,
        snapshot,
        nextActionReport,
      }),
      blockers,
      policy_state: {
        selected_run_id: selectedRunId,
        policy_history_entries: asNumber(policyHistory.entry_count) ?? asArray(policyHistory.entries).length,
      },
      logs_events: {
        selected_run_id: selectedRunId,
        event_history_entries: asNumber(eventHistory.total_events) ?? asArray(eventHistory.events).length,
        live_stream: asString(asRecord(snapshot.api_ui_contract_alignment).live_stream),
      },
      next_action: stageNextAction,
    };
  });

  const blocked = stages.some((stage) => stage.status === "blocked");
  const connectionState = asString(asRecord(snapshot.ui_lifecycle).connection_state) ?? "detached";

  return {
    stage_model_version: 1,
    current_stage_id: activeStageId,
    state: readOnly ? "read_only" : blocked ? "blocked" : connectionState,
    read_only: readOnly,
    mutation_transport: {
      binding_mode: bindingMode,
      available: !readOnly,
      lifecycle_endpoint:
        bindingMode === "detached-http-sse"
          ? "POST /api/projects/:projectId/lifecycle-command/actions"
          : "MODULE lifecycle-command.apply",
      headless_safe: asRecord(snapshot.ui_lifecycle).headless_safe === true,
    },
    next_action_report_ref: asString(nextActionEntry.artifact_ref) ?? asString(nextActionEntry.file),
    closure_state: asRecord(asRecord(nextActionReport).closure_state),
    stages,
  };
}

/**
 * @param {Record<string, unknown>} snapshot
 * @param {{ readOnly?: boolean }} options
 */
function withGuidedLifecycle(snapshot, options = {}) {
  return {
    ...snapshot,
    guided_lifecycle: buildGuidedLifecycle({
      snapshot,
      readOnly: options.readOnly,
    }),
  };
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
 * @param {ReturnType<typeof applyRunControlAction>} result
 * @returns {Record<string, unknown>}
 */
function toRunControlMutationPayload(result) {
  return {
    action: result.action,
    run_id: result.runId,
    blocked: result.blocked,
    blocked_reason: result.blockedReason ?? null,
    applied: result.applied,
    transition: result.transition,
    guardrails: result.guardrails,
    state: result.state,
    state_file: result.stateFile,
    audit_id: result.auditRecord.audit_id,
    audit_file: result.auditFile,
    primary_event_id: result.primaryEvent.event_id,
    evidence_event_id: result.evidenceEvent.event_id,
    stream_log_file: result.streamLogFile,
    next_actions: result.nextActions,
  };
}

/**
 * @param {ReturnType<typeof attachUiLifecycle> | ReturnType<typeof detachUiLifecycle>} result
 * @returns {Record<string, unknown>}
 */
function toUiLifecycleMutationPayload(result) {
  return {
    action: result.action,
    idempotent: result.idempotent,
    connection_state: asString(result.state.connection_state) ?? "detached",
    headless_safe: result.state.headless_safe === true,
    state: result.state,
    state_file: result.stateFile,
  };
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef: string,
 *   runtimeRoot?: string,
 *   controlPlane?: string,
 *   controlPlaneAuthToken?: string,
 *   runId?: string,
 *   action: "start" | "pause" | "resume" | "steer" | "cancel",
 *   targetStep?: string,
 *   reason?: string,
 *   approvalRef?: string,
 * }} options
 */
export async function applyOperatorRunControl(options) {
  const requestedControlPlane = asString(options.controlPlane);
  const controlPlaneAuthToken = asString(options.controlPlaneAuthToken) ?? undefined;
  const uiLifecycle = readUiLifecycleState(options);
  const connectedControlPlane = resolveControlPlaneUrl({
    requestedControlPlane,
    uiLifecycleState: uiLifecycle.state,
  });

  if (connectedControlPlane) {
    const projectState = readProjectState(options);
    const payload = await writeControlPlaneJson({
      controlPlane: connectedControlPlane,
      pathname: `/api/projects/${encodeURIComponent(projectState.project_id)}/run-control/actions`,
      body: {
        action: options.action,
        run_id: options.runId ?? null,
        target_step: options.targetStep ?? null,
        reason: options.reason ?? null,
        approval_ref: options.approvalRef ?? null,
      },
      authToken: controlPlaneAuthToken,
    });
    return {
      binding_mode: "detached-http-mutation",
      control_plane: connectedControlPlane,
      run_control: asRecord(payload).run_control ?? {},
    };
  }

  const result = applyRunControlAction({
    cwd: options.cwd,
    projectRef: options.projectRef,
    runtimeRoot: options.runtimeRoot,
    runId: options.runId,
    action: options.action,
    targetStep: options.targetStep,
    reason: options.reason,
    approvalRef: options.approvalRef,
  });

  return {
    binding_mode: "module-in-process",
    control_plane: null,
    run_control: toRunControlMutationPayload(result),
  };
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef: string,
 *   runtimeRoot?: string,
 *   controlPlane?: string,
 *   controlPlaneAuthToken?: string,
 *   runId?: string,
 *   action: "attach" | "detach",
 * }} options
 */
export async function applyOperatorUiLifecycle(options) {
  const requestedControlPlane = asString(options.controlPlane);
  const controlPlaneAuthToken = asString(options.controlPlaneAuthToken) ?? undefined;
  const uiLifecycle = readUiLifecycleState(options);
  const connectedControlPlane = resolveControlPlaneUrl({
    requestedControlPlane,
    uiLifecycleState: uiLifecycle.state,
  });

  if (connectedControlPlane) {
    const projectState = readProjectState(options);
    const payload = await writeControlPlaneJson({
      controlPlane: connectedControlPlane,
      pathname: `/api/projects/${encodeURIComponent(projectState.project_id)}/ui-lifecycle/actions`,
      body: {
        action: options.action,
        run_id: options.runId ?? null,
        control_plane: options.action === "attach" ? connectedControlPlane : null,
      },
      authToken: controlPlaneAuthToken,
    });
    return {
      binding_mode: "detached-http-mutation",
      control_plane: connectedControlPlane,
      ui_lifecycle: asRecord(payload).ui_lifecycle ?? {},
    };
  }

  const result =
    options.action === "attach"
      ? attachUiLifecycle({
          cwd: options.cwd,
          projectRef: options.projectRef,
          runtimeRoot: options.runtimeRoot,
          runId: options.runId,
          controlPlane: requestedControlPlane ?? undefined,
        })
      : detachUiLifecycle({
          cwd: options.cwd,
          projectRef: options.projectRef,
          runtimeRoot: options.runtimeRoot,
          runId: options.runId,
        });

  return {
    binding_mode: "module-in-process",
    control_plane: null,
    ui_lifecycle: toUiLifecycleMutationPayload(result),
  };
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef: string,
 *   runtimeRoot?: string,
 *   controlPlane?: string,
 *   controlPlaneAuthToken?: string,
 *   command: string,
 *   flags?: Record<string, unknown>,
 * }} options
 */
export async function applyOperatorLifecycleCommand(options) {
  const requestedControlPlane = asString(options.controlPlane);
  const controlPlaneAuthToken = asString(options.controlPlaneAuthToken) ?? undefined;
  const uiLifecycle = readUiLifecycleState(options);
  const connectedControlPlane = resolveControlPlaneUrl({
    requestedControlPlane,
    uiLifecycleState: uiLifecycle.state,
  });

  if (connectedControlPlane) {
    const projectState = readProjectState(options);
    const payload = await writeControlPlaneJson({
      controlPlane: connectedControlPlane,
      pathname: `/api/projects/${encodeURIComponent(projectState.project_id)}/lifecycle-command/actions`,
      body: {
        command: options.command,
        flags: options.flags ?? {},
      },
      authToken: controlPlaneAuthToken,
      allowedStatusCodes: [409],
    });
    return {
      binding_mode: "detached-http-mutation",
      control_plane: connectedControlPlane,
      lifecycle_command: asRecord(payload).lifecycle_command ?? {},
      error: asRecord(payload).error ?? null,
    };
  }

  const result = runLifecycleCommand({
    cwd: options.cwd,
    projectRef: options.projectRef,
    runtimeRoot: options.runtimeRoot,
    command: options.command,
    flags: options.flags,
  });

  return {
    binding_mode: "module-runtime-command",
    control_plane: null,
    lifecycle_command: result.ok ? result.result : result.result ?? {},
    error: result.ok ? null : result.error,
  };
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef: string,
 *   runtimeRoot?: string,
 *   controlPlane?: string,
 *   controlPlaneAuthToken?: string,
 *   runId: string,
 *   interactionId: string,
 *   answer: string,
 *   decision?: string,
 *   reason?: string,
 *   approvalRef?: string,
 *   answerEvidenceRef?: string,
 * }} options
 */
export async function submitOperatorInteractionAnswer(options) {
  const requestedControlPlane = asString(options.controlPlane);
  const controlPlaneAuthToken = asString(options.controlPlaneAuthToken) ?? undefined;
  const uiLifecycle = readUiLifecycleState(options);
  const connectedControlPlane = resolveControlPlaneUrl({
    requestedControlPlane,
    uiLifecycleState: uiLifecycle.state,
  });

  if (connectedControlPlane) {
    const projectState = readProjectState(options);
    const payload = await writeControlPlaneJson({
      controlPlane: connectedControlPlane,
      pathname: `/api/projects/${encodeURIComponent(projectState.project_id)}/interactions/answers`,
      body: {
        run_id: options.runId,
        interaction_id: options.interactionId,
        answer: options.answer,
        decision: options.decision ?? null,
        reason: options.reason ?? null,
        approval_ref: options.approvalRef ?? null,
        answer_evidence_ref: options.answerEvidenceRef ?? null,
      },
      authToken: controlPlaneAuthToken,
      allowedStatusCodes: [409],
    });
    return {
      binding_mode: "detached-http-mutation",
      control_plane: connectedControlPlane,
      interaction_answer: asRecord(payload).interaction_answer ?? {},
      error: asRecord(payload).error ?? null,
    };
  }

  const result = submitInteractionAnswer({
    cwd: options.cwd,
    projectRef: options.projectRef,
    runtimeRoot: options.runtimeRoot,
    runId: options.runId,
    interactionId: options.interactionId,
    answer: options.answer,
    decision: options.decision,
    reason: options.reason,
    approvalRef: options.approvalRef,
    answerEvidenceRef: options.answerEvidenceRef,
  });

  return {
    binding_mode: "module-runtime-command",
    control_plane: null,
    interaction_answer: {
      run_id: result.runId,
      interaction_id: result.interactionId,
      interaction_status: result.interactionStatus,
      answer_accepted: result.answerAccepted,
      decision: result.decision ?? null,
      answer_audit_ref: result.answerAuditRef,
      step_result_ref: result.stepResultRef,
      blocked: result.blocked,
      blocked_reason: result.blockedReason,
      blocked_event_id: result.blockedEvent?.event_id ?? null,
    },
    error: result.blocked
      ? {
          code: "interaction.continuation_blocked",
          message: result.blockedReason?.message,
        }
      : null,
  };
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef: string,
 *   runtimeRoot?: string,
 *   runId?: string,
 *   controlPlane?: string,
 *   controlPlaneAuthToken?: string,
 *   readOnly?: boolean,
 * }} options
 */
export async function buildOperatorConsoleSnapshot(options) {
  const uiLifecycle = readUiLifecycleState(options);
  const requestedControlPlane = asString(options.controlPlane);
  const controlPlaneAuthToken = asString(options.controlPlaneAuthToken) ?? undefined;
  const connectedControlPlane = resolveControlPlaneUrl({
    requestedControlPlane,
    uiLifecycleState: uiLifecycle.state,
  });
  const strategicSnapshot = readStrategicSnapshot(options);
  const financeMonitoring = readFinanceMonitoringSnapshot(options);

  if (!connectedControlPlane) {
    const state = readProjectState(options);
    const runs = listRuns(options).sort((left, right) => left.run_id.localeCompare(right.run_id));
    const packets = listPacketArtifacts(options);
    const stepResults = listStepResults(options);
    const qualityArtifacts = listQualityArtifacts(options);
    const deliveryManifests = listDeliveryManifests(options);
    const promotionDecisions = listPromotionDecisions(options);
    const nextActionReport = readNextActionReport(options);
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

    const selectedStepResults = filterArtifactsByRunId(stepResults, selectedRunId);
    return withGuidedLifecycle({
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
      next_action_report: nextActionReport,
      strategic_snapshot: strategicSnapshot,
      finance_monitoring: financeMonitoring,
      run_detail: {
        packet_artifacts: filterPacketsByRunId(packets, selectedRunId),
        step_results: selectedStepResults,
        interactions: collectRunnerInteractions(selectedStepResults),
        runtime_permission_decisions: collectRuntimePermissionDecisions(selectedStepResults),
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
          "GET /api/projects/:projectId/planner-metrics",
          "GET /api/projects/:projectId/finance-monitoring",
          "GET /api/projects/:projectId/next-action-report",
          "GET /api/projects/:projectId/runs/:runId/events/history",
          "GET /api/projects/:projectId/runs/:runId/policy-history",
        ],
        mutation_model: [
          "MODULE run-control.apply (start|pause|resume|steer|cancel)",
          "MODULE ui-lifecycle.attach",
          "MODULE ui-lifecycle.detach",
          "MODULE lifecycle-command.apply",
          "MODULE interaction-answer.submit",
        ],
        lifecycle_commands: LIFECYCLE_COMMANDS,
        mutation_error_shapes: ["run_control.blocked", "lifecycle_command.blocked", "interaction.continuation_blocked", "invalid_payload"],
        live_stream: "GET /api/projects/:projectId/runs/:runId/events",
        event_contract_family: "live-run-event",
      },
    }, { readOnly: options.readOnly === true });
  }

  const projectState = readProjectState(options);
  const projectId = projectState.project_id;

  const [state, runsRaw, packetsRaw, stepResultsRaw, qualityRaw, deliveryRaw, promotionRaw, strategicRaw, financeRaw, nextActionRaw] =
    await Promise.all([
      readControlPlaneJson({
        controlPlane: connectedControlPlane,
        pathname: `/api/projects/${encodeURIComponent(projectId)}/state`,
        authToken: controlPlaneAuthToken,
      }),
      readControlPlaneJson({
        controlPlane: connectedControlPlane,
        pathname: `/api/projects/${encodeURIComponent(projectId)}/runs`,
        authToken: controlPlaneAuthToken,
      }),
      readControlPlaneJson({
        controlPlane: connectedControlPlane,
        pathname: `/api/projects/${encodeURIComponent(projectId)}/packets`,
        authToken: controlPlaneAuthToken,
      }),
      readControlPlaneJson({
        controlPlane: connectedControlPlane,
        pathname: `/api/projects/${encodeURIComponent(projectId)}/step-results`,
        authToken: controlPlaneAuthToken,
      }),
      readControlPlaneJson({
        controlPlane: connectedControlPlane,
        pathname: `/api/projects/${encodeURIComponent(projectId)}/quality-artifacts`,
        authToken: controlPlaneAuthToken,
      }),
      readControlPlaneJson({
        controlPlane: connectedControlPlane,
        pathname: `/api/projects/${encodeURIComponent(projectId)}/delivery-manifests`,
        authToken: controlPlaneAuthToken,
      }),
      readControlPlaneJson({
        controlPlane: connectedControlPlane,
        pathname: `/api/projects/${encodeURIComponent(projectId)}/promotion-decisions`,
        authToken: controlPlaneAuthToken,
      }),
      readControlPlaneJson({
        controlPlane: connectedControlPlane,
        pathname: `/api/projects/${encodeURIComponent(projectId)}/strategic-snapshot`,
        authToken: controlPlaneAuthToken,
      }).catch(() => strategicSnapshot),
      readControlPlaneJson({
        controlPlane: connectedControlPlane,
        pathname: `/api/projects/${encodeURIComponent(projectId)}/finance-monitoring`,
        authToken: controlPlaneAuthToken,
      }).catch(() => readFinanceMonitoringSnapshot(options)),
      readControlPlaneJson({
        controlPlane: connectedControlPlane,
        pathname: `/api/projects/${encodeURIComponent(projectId)}/next-action-report`,
        authToken: controlPlaneAuthToken,
      }).catch(() => readNextActionReport(options)),
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
          authToken: controlPlaneAuthToken,
        }),
        readControlPlaneJson({
          controlPlane: connectedControlPlane,
          pathname: `/api/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(selectedRunId)}/policy-history`,
          query: { limit: 100 },
          authToken: controlPlaneAuthToken,
        }),
      ])
    : [null, null];

  const selectedStepResults = filterArtifactsByRunId(stepResults, selectedRunId);
  return withGuidedLifecycle({
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
    next_action_report: nextActionRaw,
    strategic_snapshot: strategicRaw,
    finance_monitoring: financeRaw,
    run_detail: {
      packet_artifacts: filterPacketsByRunId(packets, selectedRunId),
      step_results: selectedStepResults,
      interactions: collectRunnerInteractions(selectedStepResults),
      runtime_permission_decisions: collectRuntimePermissionDecisions(selectedStepResults),
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
        "GET /api/projects/:projectId/planner-metrics",
        "GET /api/projects/:projectId/finance-monitoring",
        "GET /api/projects/:projectId/next-action-report",
        "GET /api/projects/:projectId/runs/:runId/events/history",
        "GET /api/projects/:projectId/runs/:runId/policy-history",
      ],
      mutation_model: [
        "POST /api/projects/:projectId/run-control/actions",
        "POST /api/projects/:projectId/ui-lifecycle/actions",
        "POST /api/projects/:projectId/lifecycle-command/actions",
        "POST /api/projects/:projectId/interactions/answers",
      ],
      lifecycle_commands: LIFECYCLE_COMMANDS,
      mutation_error_shapes: [
        "invalid_json",
        "invalid_payload",
        "invalid_run_control_action",
        "invalid_lifecycle_command",
        "run_control.blocked",
        "lifecycle_command.blocked",
        "interaction.continuation_blocked",
      ],
      auth_mode: "optional-bearer-token",
      live_stream: "GET /api/projects/:projectId/runs/:runId/events",
      event_contract_family: "live-run-event",
    },
  }, { readOnly: options.readOnly === true });
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function asRecord(value) {
  return typeof value === "object" && value !== null ? /** @type {Record<string, unknown>} */ (value) : {};
}

/**
 * @param {unknown} metric
 * @returns {string}
 */
function formatPlannerMetric(metric) {
  const record = asRecord(metric);
  const value = typeof record.value === "number" ? record.value : null;
  const numerator = typeof record.numerator === "number" ? record.numerator : null;
  const denominator = typeof record.denominator === "number" ? record.denominator : null;
  if (value === null || denominator === null || denominator === 0) {
    return "no-data";
  }
  return `${Math.round(value * 100)}% (${numerator ?? 0}/${denominator})`;
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
      .panel {
        background: var(--surface);
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 16px;
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
      strong {
        color: var(--ink);
      }
    </style>
  </head>
  <body>
    <section class="panel">
      <h1>AOR Operator Console</h1>
      <p>Project: <code>${escapeHtml(snapshot.project.project_id)}</code></p>
      <p>Selected run: <code>${escapeHtml(snapshot.selected_run_id ?? "none")}</code></p>
      <p>UI lifecycle: <code>${escapeHtml(String(snapshot.ui_lifecycle.connection_state ?? "detached"))}</code></p>
      <p>Guided state: <code>${escapeHtml(String(snapshot.guided_lifecycle?.state ?? "unknown"))}</code></p>
      <p>Stream protocol: <code>${escapeHtml(options.streamProtocol ?? "disabled")}</code></p>
      <p>Live events in session: <code>${String(options.liveEventCount ?? 0)}</code></p>
    </section>
    <section class="panel">
      <h2>Guided lifecycle</h2>
      <p>Current stage: <code>${escapeHtml(String(snapshot.guided_lifecycle?.current_stage_id ?? "unknown"))}</code></p>
      <p>Mutation transport: <code>${escapeHtml(String(snapshot.guided_lifecycle?.mutation_transport?.lifecycle_endpoint ?? "none"))}</code></p>
      <p>Next-action report: <code>${escapeHtml(String(snapshot.guided_lifecycle?.next_action_report_ref ?? "missing"))}</code></p>
      <ul>${guidedStageItems || "<li>No guided stages available.</li>"}</ul>
    </section>
    <section class="panel">
      <h2>Strategic Snapshot</h2>
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
    <section class="panel">
      <h2>Finance Monitoring</h2>
      <p>Telemetry state: <code>${escapeHtml(String(financeMonitoring.telemetry_state ?? "no-data"))}</code></p>
      <p>Route groups: <code>${String(routeGroups.length)}</code></p>
      <p>Production monitoring: <code>${escapeHtml(String(productionMonitoring.status ?? "no-data"))}</code></p>
      <p>Production events: <code>${String(productionMonitoring.event_count ?? 0)}</code></p>
    </section>
    <section class="panel">
      <h2>Run list</h2>
      <ul>${runs || "<li>No runs found.</li>"}</ul>
    </section>
    <section class="panel">
      <h2>Lifecycle commands</h2>
      <ul>${lifecycleItems || "<li>No lifecycle command mutations available.</li>"}</ul>
    </section>
    <section class="panel">
      <h2>Runner interactions</h2>
      <ul>${interactionItems || "<li>No pending runner interactions.</li>"}</ul>
    </section>
    <section class="panel">
      <h2>Runtime permission decisions</h2>
      <ul>${runtimePermissionItems || "<li>No runtime permission decisions for selected run.</li>"}</ul>
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
 *   controlPlaneAuthToken?: string,
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
        authToken: asString(options.controlPlaneAuthToken) ?? undefined,
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
        authToken: asString(options.controlPlaneAuthToken) ?? undefined,
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
