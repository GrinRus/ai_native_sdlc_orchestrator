import fs from "node:fs";
import path from "node:path";

import { initializeProjectRuntime } from "../project-init.mjs";
import { applyReadModelLimit, listJsonFiles, toEvidenceRef } from "./read-artifact-readers.mjs";

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
    completed_read_only: status === "completed",
    follow_up_source_handoff_ref: resolveFollowUpSourceHandoffRef(seed.body),
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
