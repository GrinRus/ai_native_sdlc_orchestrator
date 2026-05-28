import fs from "node:fs";
import path from "node:path";

import { initializeProjectRuntime } from "../project-init.mjs";
import {
  applyReadModelLimit,
  listJsonFiles,
  listOperatorRequests,
  listPacketArtifacts,
  listQualityArtifacts,
  listRunControlAudits,
  listStepResults,
  toEvidenceRef,
} from "./read-artifact-readers.mjs";
import { readRunEvents } from "./live-event-stream.mjs";

const INTAKE_PACKET_REGEX = /^.+\.artifact\.intake\..+\.json$/u;
const NEXT_ACTION_REPORT_REGEX = /^next-action-report.*\.json$/u;
const READ_ONLY_INSPECTION_INTENTS = new Set(["analyze", "explain", "review", "validate"]);

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value)
    : {};
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function asString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
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
 * @param {unknown[]} values
 * @returns {string[]}
 */
function uniqueStrings(values) {
  return Array.from(
    new Set(values.filter((value) => typeof value === "string" && value.trim().length > 0).map((value) => value.trim())),
  );
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeForId(value) {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "");
}

/**
 * @param {string} filePath
 * @returns {Record<string, unknown> | null}
 */
function readJsonFile(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return asRecord(parsed);
  } catch {
    return null;
  }
}

/**
 * @param {ReturnType<typeof initializeProjectRuntime>} init
 * @param {string} ref
 * @param {string} baseFile
 * @returns {string | null}
 */
function resolveRuntimeRef(init, ref, baseFile) {
  if (ref.startsWith("evidence://")) {
    return path.resolve(init.projectRoot, ref.slice("evidence://".length));
  }
  if (path.isAbsolute(ref)) {
    return path.resolve(ref);
  }
  const projectCandidate = path.resolve(init.projectRoot, ref);
  if (fs.existsSync(projectCandidate)) {
    return projectCandidate;
  }
  return path.resolve(path.dirname(baseFile), ref);
}

/**
 * @param {string | null} packetId
 * @param {string} fallback
 * @returns {string}
 */
function missionKeyFromPacketId(packetId, fallback) {
  if (!packetId) return fallback;
  const marker = ".artifact.intake.";
  const markerIndex = packetId.indexOf(marker);
  if (markerIndex < 0) return packetId;
  const suffix = packetId.slice(markerIndex + marker.length);
  return suffix.replace(/\.v\d+$/u, "") || packetId;
}

/**
 * @param {Record<string, unknown>} body
 * @param {Record<string, unknown>} packet
 * @param {string} packetFile
 * @returns {string}
 */
function resolveMissionKey(body, packet, packetFile) {
  const missionTraceability = asRecord(body.mission_traceability);
  const invocationContext = asRecord(packet.invocation_context);
  return (
    asString(missionTraceability.mission_id) ??
    asString(invocationContext.mission_id) ??
    missionKeyFromPacketId(asString(packet.packet_id), normalizeForId(path.basename(packetFile, ".json")) || "flow")
  );
}

/**
 * @param {ReturnType<typeof initializeProjectRuntime>} init
 * @returns {Array<{
 *   packetFile: string,
 *   packetRef: string,
 *   packet: Record<string, unknown>,
 *   bodyFile: string | null,
 *   bodyRef: string | null,
 *   body: Record<string, unknown>,
 *   missionKey: string,
 *   updatedMs: number,
 * }>}
 */
function loadIntakeFlowSeeds(init) {
  return listJsonFiles(init.runtimeLayout.artifactsRoot)
    .filter((filePath) => INTAKE_PACKET_REGEX.test(path.basename(filePath)) && !path.basename(filePath).endsWith(".body.json"))
    .flatMap((packetFile) => {
      const packet = readJsonFile(packetFile);
      if (!packet || asString(packet.packet_type) !== "intake-request") {
        return [];
      }
      const bodyRefValue = asString(packet.body_ref);
      const bodyFile = bodyRefValue ? resolveRuntimeRef(init, bodyRefValue, packetFile) : null;
      const body = bodyFile && fs.existsSync(bodyFile) ? readJsonFile(bodyFile) ?? {} : {};
      const missionKey = resolveMissionKey(body, packet, packetFile);
      return [
        {
          packetFile,
          packetRef: toEvidenceRef(init, packetFile),
          packet,
          bodyFile,
          bodyRef: bodyFile && fs.existsSync(bodyFile) ? toEvidenceRef(init, bodyFile) : null,
          body,
          missionKey,
          updatedMs: fs.statSync(packetFile).mtimeMs,
        },
      ];
    });
}

/**
 * @param {ReturnType<typeof initializeProjectRuntime>} init
 * @returns {Array<{ file: string, artifactRef: string, document: Record<string, unknown>, updatedMs: number }>}
 */
function loadNextActionReports(init) {
  return listJsonFiles(init.runtimeLayout.reportsRoot)
    .filter((filePath) => NEXT_ACTION_REPORT_REGEX.test(path.basename(filePath)))
    .flatMap((file) => {
      const document = readJsonFile(file);
      return document
        ? [
            {
              file,
              artifactRef: toEvidenceRef(init, file),
              document,
              updatedMs: fs.statSync(file).mtimeMs,
            },
          ]
        : [];
    });
}

/**
 * @param {Record<string, unknown>} value
 * @returns {string[]}
 */
function collectNestedRefs(value) {
  const refs = [];
  const visit = (entry) => {
    if (typeof entry === "string") {
      if (/^(evidence|packet|compiled-context|run):\/\//u.test(entry)) {
        refs.push(entry);
      }
      return;
    }
    if (Array.isArray(entry)) {
      for (const item of entry) visit(item);
      return;
    }
    if (typeof entry === "object" && entry !== null) {
      for (const item of Object.values(/** @type {Record<string, unknown>} */ (entry))) visit(item);
    }
  };
  visit(value);
  return uniqueStrings(refs);
}

/**
 * @param {Record<string, unknown>} document
 * @param {{ missionKey: string, packetRef: string, bodyRef: string | null }} flowSeed
 * @returns {boolean}
 */
function nextActionMatchesFlow(document, flowSeed) {
  const missionState = asRecord(document.mission_state);
  return (
    asString(missionState.mission_id) === flowSeed.missionKey ||
    asString(missionState.intake_packet_ref) === flowSeed.packetRef ||
    (flowSeed.bodyRef !== null && asString(missionState.intake_body_ref) === flowSeed.bodyRef)
  );
}

/**
 * @param {Record<string, unknown> | null} report
 * @param {{ missionKey: string }} flowSeed
 * @returns {boolean}
 */
function reportClosureBelongsToFlow(report, flowSeed) {
  if (!report) return true;
  const closureState = asRecord(report.closure_state);
  const runId = asString(closureState.run_id);
  if (!runId) return true;
  return normalizeForId(runId).includes(normalizeForId(flowSeed.missionKey));
}

/**
 * @param {Record<string, unknown> | null} report
 * @param {{ missionKey: string }} flowSeed
 * @returns {"active" | "completed"}
 */
function resolveFlowStatus(report, flowSeed) {
  if (!report) return "active";
  if (!reportClosureBelongsToFlow(report, flowSeed)) return "active";
  const closureState = asRecord(report.closure_state);
  const learning = asRecord(closureState.learning);
  const learningStatus = asString(learning.status);
  const primaryAction = asRecord(report.primary_action);
  if (learningStatus === "handoff-complete" || asString(primaryAction.action_id) === "closure-complete") {
    return "completed";
  }
  return "active";
}

/**
 * @param {Record<string, unknown>} body
 * @returns {string}
 */
function resolveInitialSelectedStage(body) {
  const completeness = asRecord(body.product_intake_completeness);
  return asString(completeness.status) === "complete" ? "discovery" : "mission";
}

/**
 * @param {Record<string, unknown>} body
 * @param {Record<string, unknown> | null} report
 * @returns {Record<string, unknown>}
 */
function resolveWritebackPolicy(body, report) {
  const missionScope = asRecord(body.mission_scope);
  const bodyPolicy = asRecord(missionScope.writeback_policy);
  const boundedExecution = asRecord(report?.bounded_execution);
  const mode =
    asString(bodyPolicy.mode) ??
    asString(missionScope.delivery_mode) ??
    asString(boundedExecution.requested_delivery_mode) ??
    "no-write";
  return {
    mode,
    upstream_writes_default: bodyPolicy.upstream_writes_default === true ? true : false,
    requires_explicit_review:
      typeof bodyPolicy.requires_explicit_review === "boolean"
        ? bodyPolicy.requires_explicit_review
        : mode !== "no-write",
    allowed_paths: asStringArray(missionScope.allowed_paths).length > 0
      ? asStringArray(missionScope.allowed_paths)
      : asStringArray(boundedExecution.allowed_paths),
    forbidden_paths: asStringArray(missionScope.forbidden_paths).length > 0
      ? asStringArray(missionScope.forbidden_paths)
      : asStringArray(boundedExecution.forbidden_paths),
  };
}

/**
 * @param {Record<string, unknown>} body
 * @returns {string | null}
 */
function resolveFollowUpSourceHandoffRef(body) {
  const missionTraceability = asRecord(body.mission_traceability);
  const coverageFollowUp = asRecord(missionTraceability.coverage_follow_up);
  const featureRequest = asRecord(body.feature_request);
  const requestDocument = asRecord(featureRequest.request_document);
  return (
    asString(coverageFollowUp.follow_up_source_handoff_ref) ??
    asString(coverageFollowUp.source_handoff_ref) ??
    asString(coverageFollowUp.handoff_ref) ??
    asString(requestDocument.follow_up_source_handoff_ref)
  );
}

/**
 * @param {Record<string, unknown>} body
 * @returns {Record<string, unknown>}
 */
function buildMissionSettingsProjection(body) {
  const featureRequest = asRecord(body.feature_request);
  const productIntake = asRecord(body.product_intake);
  const writebackPolicy = resolveWritebackPolicy(body, null);
  return {
    title: asString(featureRequest.title),
    brief: asString(featureRequest.brief),
    goals: asStringArray(productIntake.goals),
    constraints: asStringArray(productIntake.constraints),
    kpis: Array.isArray(productIntake.kpis) ? productIntake.kpis.filter((entry) => typeof entry === "object" && entry !== null) : [],
    definition_of_done: asStringArray(productIntake.definition_of_done),
    delivery_mode: writebackPolicy.mode,
    allowed_paths: writebackPolicy.allowed_paths,
    forbidden_paths: writebackPolicy.forbidden_paths,
  };
}

/**
 * @param {Record<string, unknown> | null} report
 * @returns {string[]}
 */
function resolveSourceLearningHandoffRefs(report) {
  const closureState = asRecord(report?.closure_state);
  const learning = asRecord(closureState.learning);
  return uniqueStrings([
    asString(learning.handoff_ref),
    ...asStringArray(learning.linked_evidence_refs).filter((ref) => ref.includes("learning-loop-handoff")),
    ...collectNestedRefs(closureState).filter((ref) => ref.includes("learning-loop-handoff")),
  ]);
}

/**
 * @param {{ report: Record<string, unknown> | null, status: "active" | "completed", followUpSourceHandoffRef: string | null }} options
 * @returns {Record<string, unknown>}
 */
function buildClosureProjection(options) {
  const closureState = asRecord(options.report?.closure_state);
  const learning = asRecord(closureState.learning);
  const sourceLearningHandoffRefs = resolveSourceLearningHandoffRefs(options.report);
  return {
    status: options.status,
    completed: options.status === "completed",
    completed_read_only: options.status === "completed",
    follow_up_eligible: options.status === "completed" && sourceLearningHandoffRefs.length > 0,
    learning_status: asString(learning.status),
    source_run_id: asString(closureState.run_id),
    source_learning_handoff_refs: sourceLearningHandoffRefs,
    recommended_follow_up_source_handoff_ref: sourceLearningHandoffRefs[0] ?? null,
    follow_up_source_handoff_ref: options.followUpSourceHandoffRef,
  };
}

/**
 * @param {{
 *   init: ReturnType<typeof initializeProjectRuntime>,
 *   seed: ReturnType<typeof loadIntakeFlowSeeds>[number],
 *   reportEntry: ReturnType<typeof loadNextActionReports>[number] | null,
 * }} options
 */
function buildFlowProjection({ init, seed, reportEntry }) {
  const report = reportEntry?.document ?? null;
  const flowId = `flow.${init.projectId}.${normalizeForId(seed.missionKey) || "flow"}`;
  const projectState = asRecord(report?.project_state);
  const closureState = asRecord(report?.closure_state);
  const closureBelongsToFlow = reportClosureBelongsToFlow(report, seed);
  const status = resolveFlowStatus(report, seed);
  const followUpSourceHandoffRef = resolveFollowUpSourceHandoffRef(seed.body);
  const evidenceRefs = uniqueStrings([
    seed.packetRef,
    seed.bodyRef,
    reportEntry?.artifactRef,
    ...(closureBelongsToFlow ? asStringArray(report?.evidence_refs) : []),
    ...(closureBelongsToFlow ? collectNestedRefs(closureState) : []),
  ]);
  return {
    flow_id: flowId,
    status,
    selected_stage:
      status === "completed"
        ? "learning"
        : closureBelongsToFlow
          ? asString(projectState.stage) ?? resolveInitialSelectedStage(seed.body)
          : resolveInitialSelectedStage(seed.body),
    mission_id: seed.missionKey,
    intake_packet_ref: seed.packetRef,
    intake_body_ref: seed.bodyRef,
    latest_next_action_report_ref: reportEntry?.artifactRef ?? null,
    evidence_refs: evidenceRefs,
    writeback_policy: resolveWritebackPolicy(seed.body, report),
    mission_settings: buildMissionSettingsProjection(seed.body),
    closure_state: buildClosureProjection({ report, status, followUpSourceHandoffRef }),
    completed_read_only: status === "completed",
    follow_up_source_handoff_ref: followUpSourceHandoffRef,
    updated_at_ref: reportEntry?.artifactRef ?? seed.packetRef,
  };
}

/**
 * @param {{ projectRef?: string, cwd?: string, projectProfile?: string, runtimeRoot?: string, limit?: number }} options
 */
export function listFlowProjections(options = {}) {
  const init = initializeProjectRuntime(options);
  const reports = loadNextActionReports(init);
  const seeds = loadIntakeFlowSeeds(init);
  const latestReport = reports[0] ?? null;
  const flows = seeds.map((seed) => {
    const reportEntry = reports.find((entry) => nextActionMatchesFlow(entry.document, seed)) ?? null;
    return {
      flow: buildFlowProjection({ init, seed, reportEntry }),
      seedUpdatedMs: seed.updatedMs,
      reportUpdatedMs: reportEntry?.updatedMs ?? 0,
      selectedByLatestReport: latestReport ? nextActionMatchesFlow(latestReport.document, seed) : false,
    };
  });

  flows.sort((left, right) => {
    const activeDelta = Number(right.flow.status === "active") - Number(left.flow.status === "active");
    if (activeDelta !== 0) return activeDelta;
    return Math.max(right.reportUpdatedMs, right.seedUpdatedMs) - Math.max(left.reportUpdatedMs, left.seedUpdatedMs);
  });

  const selectedCandidate =
    flows.find((entry) => entry.selectedByLatestReport && entry.flow.status === "active") ??
    flows.find((entry) => entry.flow.status === "active") ??
    flows.find((entry) => entry.selectedByLatestReport) ??
    flows[0] ??
    null;
  const limitedFlows = applyReadModelLimit(flows.map((entry) => entry.flow), options.limit);
  const selectedInWindow = selectedCandidate
    ? limitedFlows.find((flow) => flow.flow_id === selectedCandidate.flow.flow_id) ?? null
    : null;

  return {
    project_id: init.projectId,
    selected_flow_id: selectedInWindow?.flow_id ?? limitedFlows[0]?.flow_id ?? null,
    active_flow_ids: limitedFlows.filter((flow) => flow.status === "active").map((flow) => flow.flow_id),
    completed_flow_ids: limitedFlows.filter((flow) => flow.status === "completed").map((flow) => flow.flow_id),
    flows: limitedFlows,
    generated_from: {
      read_model: "control-plane.flow-projections",
      runtime_root: init.runtimeRoot,
      artifacts_root: init.runtimeLayout.artifactsRoot,
      reports_root: init.runtimeLayout.reportsRoot,
    },
    read_only: true,
  };
}

/**
 * @param {{ projectRef?: string, cwd?: string, projectProfile?: string, runtimeRoot?: string }} options
 */
export function readSelectedFlowProjection(options = {}) {
  const list = listFlowProjections(options);
  return list.flows.find((flow) => flow.flow_id === list.selected_flow_id) ?? null;
}

/**
 * @param {{ projectRef?: string, cwd?: string, projectProfile?: string, runtimeRoot?: string, flowId: string }} options
 */
export function readFlowProjection(options) {
  const flowId = asString(options.flowId);
  if (!flowId) return null;
  return listFlowProjections(options).flows.find((flow) => flow.flow_id === flowId) ?? null;
}

/**
 * @param {Record<string, unknown>} document
 * @returns {string | null}
 */
function resolveDocumentRunId(document) {
  return (
    asString(document.run_id) ??
    asString(asRecord(document.runtime_harness).run_id) ??
    asString(asRecord(document.closure_state).run_id)
  );
}

/**
 * @param {Record<string, unknown>} document
 * @returns {string[]}
 */
function resolveDocumentRunRefs(document) {
  return uniqueStrings([
    resolveDocumentRunId(document),
    ...asStringArray(document.run_refs),
    ...asStringArray(asRecord(document.evidence_lineage).run_refs),
  ]).map((ref) => ref.startsWith("run://") ? ref.slice("run://".length) : ref);
}

/**
 * @param {Record<string, unknown>} document
 * @returns {string | null}
 */
function resolveDocumentStatus(document) {
  return (
    asString(document.status) ??
    asString(document.overall_status) ??
    asString(document.overall_decision) ??
    asString(document.decision) ??
    asString(asRecord(document.delivery_gate).status)
  );
}

/**
 * @param {Record<string, unknown>} document
 * @returns {string | null}
 */
function resolveDocumentStage(document) {
  return (
    asString(document.stage) ??
    asString(document.step_class) ??
    asString(document.target_stage) ??
    asString(document.step_id)?.split(".")[0] ??
    null
  );
}

/**
 * @param {{ family?: string, artifact_ref?: string, operator_request_ref?: string, document?: Record<string, unknown> }} entry
 * @returns {string[]}
 */
function entryRefs(entry) {
  return uniqueStrings([entry.artifact_ref, entry.operator_request_ref]);
}

/**
 * @param {string} ref
 * @returns {string}
 */
function comparableEvidencePath(ref) {
  return ref
    .replace(/^packet:\/\/operator-request@/u, "")
    .replace(/^evidence:\/\//u, "")
    .replace(/^\.aor\/projects\/[^/]+\//u, "");
}

/**
 * @param {string} left
 * @param {string} right
 * @returns {boolean}
 */
function evidenceRefsMatch(left, right) {
  if (left === right) return true;
  const normalizedLeft = comparableEvidencePath(left);
  const normalizedRight = comparableEvidencePath(right);
  return normalizedLeft === normalizedRight || normalizedLeft.endsWith(normalizedRight) || normalizedRight.endsWith(normalizedLeft);
}

/**
 * @param {Record<string, unknown>} flow
 * @param {{ family?: string, artifact_ref?: string, operator_request_ref?: string, document?: Record<string, unknown> }} entry
 * @returns {boolean}
 */
function entryBelongsToFlow(flow, entry) {
  const flowRefs = asStringArray(flow.evidence_refs);
  const refs = entryRefs(entry);
  if (refs.some((ref) => flowRefs.some((flowRef) => evidenceRefsMatch(ref, flowRef)))) {
    return true;
  }
  const document = asRecord(entry.document);
  return asString(document.target_flow_id) === asString(flow.flow_id);
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef?: string,
 *   projectProfile?: string,
 *   runtimeRoot?: string,
 *   limit?: number,
 * }} options
 * @param {Record<string, unknown>} flow
 */
function listFlowScopedEntries(options, flow) {
  const entries = [
    ...listPacketArtifacts(options),
    ...listStepResults(options),
    ...listQualityArtifacts(options),
    ...listRunControlAudits(options),
    ...listOperatorRequests(options),
  ];
  const byRef = new Map();
  for (const entry of entries) {
    if (!entryBelongsToFlow(flow, entry)) continue;
    for (const ref of entryRefs(entry)) {
      byRef.set(ref, entry);
    }
  }
  return Array.from(new Set(byRef.values()));
}

/**
 * @param {{ family?: string, artifact_ref?: string, operator_request_ref?: string, document?: Record<string, unknown> }} entry
 * @param {string} preferredRef
 */
function buildEvidenceNode(entry, preferredRef) {
  const document = asRecord(entry.document);
  return {
    node_id: preferredRef,
    ref: preferredRef,
    family: asString(entry.family) ?? "evidence",
    label:
      asString(document.packet_id) ??
      asString(document.request_id) ??
      asString(document.step_result_id) ??
      asString(document.report_id) ??
      asString(document.manifest_id) ??
      asString(document.packet_id) ??
      path.basename(preferredRef),
    status: resolveDocumentStatus(document),
    stage: resolveDocumentStage(document),
    run_ids: resolveDocumentRunRefs(document),
    target_flow_id: asString(document.target_flow_id),
    summary:
      asString(document.request_summary) ??
      asString(document.summary) ??
      asString(document.title) ??
      asString(document.reason) ??
      null,
  };
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef?: string,
 *   projectProfile?: string,
 *   runtimeRoot?: string,
 *   limit?: number,
 *   flowId: string,
 * }} options
 */
export function readFlowEvidenceGraph(options) {
  const flow = readFlowProjection(options);
  if (!flow) return null;
  const flowRefs = asStringArray(flow.evidence_refs);
  const entries = listFlowScopedEntries(options, flow);
  const entriesByRef = new Map();
  for (const entry of entries) {
    for (const ref of entryRefs(entry)) {
      entriesByRef.set(ref, entry);
      for (const flowRef of flowRefs) {
        if (evidenceRefsMatch(ref, flowRef)) {
          entriesByRef.set(flowRef, entry);
        }
      }
    }
  }

  const nodes = [
    {
      node_id: flow.flow_id,
      ref: flow.flow_id,
      family: "flow",
      label: flow.mission_id,
      status: flow.status,
      stage: flow.selected_stage,
      run_ids: [],
      target_flow_id: flow.flow_id,
      summary: flow.completed_read_only ? "Completed read-only flow." : "Active mutable flow.",
    },
  ];
  const seenNodeIds = new Set([flow.flow_id]);
  const edges = [];

  for (const ref of flowRefs) {
    const entry = entriesByRef.get(ref);
    const node = entry
      ? buildEvidenceNode(entry, ref)
      : {
          node_id: ref,
          ref,
          family: "flow-evidence",
          label: ref,
          status: "ready",
          stage: null,
          run_ids: [],
          target_flow_id: null,
          summary: "Evidence ref projected onto the selected flow.",
        };
    if (!seenNodeIds.has(node.node_id)) {
      nodes.push(node);
      seenNodeIds.add(node.node_id);
    }
    edges.push({ from: flow.flow_id, to: ref, relation: "contains" });
  }

  for (const entry of entries) {
    const document = asRecord(entry.document);
    const refs = entryRefs(entry);
    const sourceRef = refs.find((ref) => flowRefs.some((flowRef) => evidenceRefsMatch(ref, flowRef))) ?? refs[0];
    if (!sourceRef) continue;
    if (!seenNodeIds.has(sourceRef)) {
      const node = buildEvidenceNode(entry, sourceRef);
      nodes.push(node);
      seenNodeIds.add(sourceRef);
      edges.push({ from: flow.flow_id, to: sourceRef, relation: "targets-flow" });
    }
    for (const nestedRef of collectNestedRefs(document)) {
      const matchingFlowRef = flowRefs.find((flowRef) => evidenceRefsMatch(nestedRef, flowRef));
      if (matchingFlowRef) {
        edges.push({ from: sourceRef, to: matchingFlowRef, relation: "references" });
      }
    }
  }

  return {
    project_id: options.projectRef ? initializeProjectRuntime(options).projectId : listFlowProjections(options).project_id,
    flow_id: flow.flow_id,
    status: flow.status,
    read_only: true,
    evidence_refs: flowRefs,
    nodes: applyReadModelLimit(nodes, options.limit),
    edges: applyReadModelLimit(edges, options.limit),
    isolation: {
      mode: "selected-flow-only",
      included_refs: flowRefs.length,
      excludes_unrelated_flows: true,
    },
  };
}

/**
 * @param {{ family?: string, artifact_ref?: string, operator_request_ref?: string, document?: Record<string, unknown> }} entry
 * @returns {Array<Record<string, unknown>>}
 */
function buildTraceItemsForEntry(entry) {
  const document = asRecord(entry.document);
  const refs = entryRefs(entry);
  const primaryRef = refs[0] ?? "unknown";
  const family = asString(entry.family) ?? "evidence";
  const runIds = resolveDocumentRunRefs(document);
  return [
    {
      trace_id: `${family}:${primaryRef}`,
      kind: family,
      ref: primaryRef,
      run_ids: runIds,
      stage: resolveDocumentStage(document),
      status: resolveDocumentStatus(document),
      step_id: asString(document.step_id),
      event_type:
        family === "step-result"
          ? "step-result"
          : family === "runtime-harness-report"
            ? "runtime-harness-decision"
            : family === "delivery-manifest" || family === "release-packet"
              ? "delivery-release-artifact"
              : family,
      summary:
        asString(document.request_summary) ??
        asString(document.summary) ??
        asString(document.reason) ??
        asString(document.decision) ??
        null,
    },
  ];
}

/**
 * @param {string} ref
 * @returns {string}
 */
function inferFamilyFromEvidenceRef(ref) {
  const base = path.basename(comparableEvidencePath(ref));
  if (base.startsWith("step-result-")) return "step-result";
  if (base.startsWith("runtime-harness-report-")) return "runtime-harness-report";
  if (base.startsWith("review-report-")) return "review-report";
  if (base.startsWith("review-decision-")) return "review-decision";
  if (base.startsWith("delivery-manifest-")) return "delivery-manifest";
  if (base.startsWith("delivery-plan-")) return "delivery-plan";
  if (base.startsWith("release-packet-")) return "release-packet";
  if (base.startsWith("learning-loop-handoff-")) return "learning-loop-handoff";
  if (base.startsWith("learning-loop-scorecard-")) return "learning-loop-scorecard";
  if (base.startsWith("next-action-report")) return "next-action-report";
  return "flow-evidence";
}

/**
 * @param {string} family
 * @returns {string}
 */
function traceEventTypeForFamily(family) {
  if (family === "step-result") return "step-result";
  if (family === "runtime-harness-report") return "runtime-harness-decision";
  if (family === "delivery-manifest" || family === "release-packet" || family === "delivery-plan") {
    return "delivery-release-artifact";
  }
  return family;
}

/**
 * @param {string} ref
 * @returns {string[]}
 */
function inferRunIdsFromEvidenceRef(ref) {
  const stem = path.basename(comparableEvidencePath(ref)).replace(/\.json$/u, "");
  const candidates = [
    stem.replace(/^step-result-/u, ""),
    stem.replace(/^runtime-harness-report-/u, ""),
    stem.replace(/^review-report-/u, ""),
    stem.replace(/^delivery-plan-/u, ""),
    stem.replace(/^delivery-manifest-/u, ""),
    stem.replace(/^release-packet-/u, ""),
    stem.replace(/^learning-loop-scorecard-/u, ""),
    stem.replace(/^learning-loop-handoff-/u, ""),
    stem.replace(/^review-decision-/u, "").replace(/-(approve|request-repair|hold)$/u, ""),
  ];
  return uniqueStrings(candidates.filter((candidate) => candidate.startsWith("run.")));
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef?: string,
 *   projectProfile?: string,
 *   runtimeRoot?: string,
 *   limit?: number,
 *   flowId: string,
 * }} options
 */
export function readFlowRuntimeTrace(options) {
  const flow = readFlowProjection(options);
  if (!flow) return null;
  const entries = listFlowScopedEntries(options, flow);
  const traceItems = entries.flatMap((entry) => buildTraceItemsForEntry(entry));
  for (const ref of asStringArray(flow.evidence_refs)) {
    if (traceItems.some((item) => typeof item.ref === "string" && evidenceRefsMatch(item.ref, ref))) {
      continue;
    }
    const family = inferFamilyFromEvidenceRef(ref);
    traceItems.push({
      trace_id: `${family}:${ref}`,
      kind: family,
      ref,
      run_ids: inferRunIdsFromEvidenceRef(ref),
      stage: null,
      status: "referenced",
      step_id: null,
      event_type: traceEventTypeForFamily(family),
      summary: "Flow-projected evidence ref.",
    });
  }
  const runIds = uniqueStrings(traceItems.flatMap((item) => asStringArray(item.run_ids)));
  for (const runId of runIds) {
    for (const event of readRunEvents({ ...options, runId })) {
      traceItems.push({
        trace_id: `live-event:${asString(event.event_id) ?? `${runId}:${traceItems.length}`}`,
        kind: "live-event",
        ref: asString(event.event_id),
        run_ids: [runId],
        stage: null,
        status: null,
        step_id: null,
        event_type: asString(event.event_type) ?? "live-event",
        summary: asString(asRecord(event.payload).summary) ?? asString(event.message),
      });
    }
  }

  return {
    project_id: options.projectRef ? initializeProjectRuntime(options).projectId : listFlowProjections(options).project_id,
    flow_id: flow.flow_id,
    status: flow.status,
    read_only: true,
    run_ids: runIds,
    trace_items: applyReadModelLimit(traceItems, options.limit),
    inspected_evidence_refs: asStringArray(flow.evidence_refs),
    isolation: {
      mode: "selected-flow-only",
      excludes_unrelated_flows: true,
    },
  };
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef?: string,
 *   projectProfile?: string,
 *   runtimeRoot?: string,
 *   targetFlowId?: string | null,
 *   intentType?: string | null,
 *   deliveryMode?: string | null,
 * }} options
 */
export function assertFlowMutationAllowed(options) {
  const targetFlowId = asString(options.targetFlowId);
  if (!targetFlowId) {
    return null;
  }
  const flow = readFlowProjection({ ...options, flowId: targetFlowId });
  if (!flow) {
    const error = new Error(`Target flow '${targetFlowId}' was not found.`);
    error.code = "operator_request.target_flow_not_found";
    error.statusCode = 404;
    throw error;
  }
  if (flow.status !== "completed") {
    return flow;
  }
  const deliveryMode = asString(options.deliveryMode) ?? "no-write";
  const intentType = asString(options.intentType) ?? "";
  if (deliveryMode === "no-write" && READ_ONLY_INSPECTION_INTENTS.has(intentType)) {
    return flow;
  }
  const error = new Error(
    `Completed flow '${targetFlowId}' is read-only. Start a new flow or use a no-write inspection request.`,
  );
  error.code = "operator_request.completed_flow_read_only";
  error.statusCode = 409;
  throw error;
}
