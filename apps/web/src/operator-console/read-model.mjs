import fs from "node:fs";
import path from "node:path";

import { loadContractFile } from "../../../../packages/contracts/src/index.mjs";
import {
  asRecord,
  asString,
  asStringArray,
  containsRunToken,
  normalizeRunRef,
  uniqueStrings,
} from "./shared.mjs";

const STEP_RESULT_REGEX = /^step-result-.*\.json$/;

/**
 * @param {Record<string, unknown>} document
 * @returns {string[]}
 */
function extractRunRefs(document) {
  return uniqueStrings([
    ...(asString(document.run_id) ? [asString(document.run_id)] : []),
    ...(asString(document.subject_ref) ? [asString(document.subject_ref)] : []),
    ...asStringArray(document.run_refs),
    ...asStringArray(document.linked_run_refs),
  ].map((runRef) => normalizeRunRef(runRef ?? "")));
}

/**
 * @param {Record<string, unknown>} document
 * @param {string | null} runId
 * @returns {boolean}
 */
function documentLinksRun(document, runId) {
  return runId !== null && extractRunRefs(document).includes(runId);
}

/**
 * Routed live execution can mint nested run ids under the public live-e2e run,
 * for example `project.run.<outer-run>.routed-execution.v1`.
 *
 * @param {Record<string, unknown>} document
 * @param {string | null} runId
 * @returns {boolean}
 */
export function stepResultLinksRun(document, runId) {
  if (!runId) return false;
  if (documentLinksRun(document, runId)) return true;
  return [document.run_id, document.step_result_id, document.step_id, document.subject_ref]
    .map((value) => asString(value))
    .some((value) => value !== null && containsRunToken(value, runId));
}

/**
 * @param {string} value
 * @returns {string}
 */
function toPosix(value) {
  return value.replace(/\\/g, "/");
}

/**
 * @param {string} projectRoot
 * @param {string} filePath
 * @returns {string}
 */
function toEvidenceRef(projectRoot, filePath) {
  return `evidence://${toPosix(path.relative(projectRoot, filePath))}`;
}

/**
 * @param {string} dirPath
 * @returns {string[]}
 */
function listJsonFiles(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  return fs
    .readdirSync(dirPath)
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => path.join(dirPath, entry))
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
}

/**
 * @param {Array<{ file?: string, artifact_ref?: string, document: Record<string, unknown> }>} entries
 * @returns {Array<{ file?: string, artifact_ref?: string, document: Record<string, unknown> }>}
 */
export function uniqueArtifactEntries(entries) {
  const seen = new Set();
  return entries.filter((entry) => {
    const key = asString(entry.file) ?? asString(entry.artifact_ref) ?? asString(entry.document.step_result_id);
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Routed live E2E can execute the target under a sibling runtime project whose
 * id is derived from the public run id. The console keeps the public run
 * selected while exposing only the sibling step-results that link back to it.
 *
 * @param {Record<string, unknown>} projectState
 * @param {string | null} runId
 * @returns {Array<{ family: string, file: string, artifact_ref: string, document: Record<string, unknown> }>}
 */
export function listLinkedSiblingStepResults(projectState, runId) {
  const runtimeRoot = asString(projectState.runtime_root);
  const projectRoot = asString(projectState.project_root);
  const currentProjectId = asString(projectState.project_id);
  if (!runtimeRoot || !projectRoot || !runId) return [];
  const projectsRoot = path.join(runtimeRoot, "projects");
  if (!fs.existsSync(projectsRoot)) return [];

  const entries = [];
  for (const projectEntry of fs.readdirSync(projectsRoot, { withFileTypes: true })) {
    if (!projectEntry.isDirectory() || projectEntry.name === currentProjectId) continue;
    if (!containsRunToken(projectEntry.name, runId)) continue;
    const reportsRoot = path.join(projectsRoot, projectEntry.name, "reports");
    for (const filePath of listJsonFiles(reportsRoot)) {
      if (!STEP_RESULT_REGEX.test(path.basename(filePath))) continue;
      const loaded = loadContractFile({ filePath, family: "step-result" });
      if (!loaded.ok) continue;
      const document = asRecord(loaded.document);
      if (!stepResultLinksRun(document, runId)) continue;
      entries.push({
        family: "step-result",
        file: filePath,
        artifact_ref: toEvidenceRef(projectRoot, filePath),
        document,
      });
    }
  }
  return entries;
}

/**
 * @param {Array<{ document: Record<string, unknown> }>} artifacts
 * @param {string | null} runId
 * @returns {Array<{ document: Record<string, unknown> }>}
 */
export function filterArtifactsByRunId(artifacts, runId) {
  if (!runId) return [];
  return artifacts.filter((artifact) => artifact.document.run_id === runId);
}

/**
 * @param {Array<{ document: Record<string, unknown> }>} stepResults
 * @param {string | null} runId
 * @returns {Array<{ document: Record<string, unknown> }>}
 */
export function filterStepResultsByLinkedRunId(stepResults, runId) {
  if (!runId) return [];
  return stepResults.filter((entry) => stepResultLinksRun(entry.document, runId));
}

/**
 * @param {Array<{ family: string, document: Record<string, unknown> }>} packets
 * @param {string | null} runId
 * @returns {Array<{ family: string, document: Record<string, unknown> }>}
 */
export function filterPacketsByRunId(packets, runId) {
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
export function collectRunnerInteractions(stepResults) {
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
export function collectRuntimePermissionDecisions(stepResults) {
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
export function selectRunId(runs, requestedRunId) {
  if (requestedRunId) {
    return runs.some((run) => run.run_id === requestedRunId) ? requestedRunId : null;
  }
  return runs.length > 0 ? runs[0].run_id : null;
}
