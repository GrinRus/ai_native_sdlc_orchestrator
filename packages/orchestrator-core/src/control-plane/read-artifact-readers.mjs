import fs from "node:fs";
import path from "node:path";

import { loadContractFile } from "../../../contracts/src/index.mjs";
import {
  buildArtifactDisplaySummary,
  uniqueArtifactDisplaySummaries,
} from "../artifact-display-summary.mjs";
import { normalizeProviderStepStatus } from "../provider-step-status.mjs";
import { initializeProjectRuntime, previewProjectRuntime } from "../project-init.mjs";
import {
  listExternalRunHealthArtifactDisplaySummariesForRuntime,
  readLatestExternalRunHealthProjectionForRuntime,
} from "./external-run-health-read-model.mjs";
import { buildOnboardingSummary } from "./onboarding-summary.mjs";

const ARTIFACT_PACKET_REGEX = /^.+\.artifact\..+\.json$/;
const WAVE_TICKET_REGEX = /^wave-ticket-.*\.json$/;
const HANDOFF_PACKET_REGEX = /^[^.]+\.handoff\..*\.json$/;
const DELIVERY_PLAN_REGEX = /^delivery-plan-.*\.json$/;
const DELIVERY_MANIFEST_REGEX = /^delivery-manifest-.*\.json$/;
const RELEASE_PACKET_REGEX = /^release-packet-.*\.json$/;
const PROMOTION_DECISION_REGEX = /^promotion-decision-.*\.json$/;
const STEP_RESULT_REGEX = /^step-result-.*\.json$/;
const VALIDATION_REPORT_REGEX = /^validation-report.*\.json$/;
const VERIFICATION_PLAN_REGEX = /^verification-plan(?:-.+)?\.json$/;
const VERIFY_SUMMARY_REGEX = /^verify-summary(?:-.+)?\.json$/;
const EVALUATION_REPORT_REGEX = /^evaluation-report.*\.json$/;
const REVIEW_REPORT_REGEX = /^review-report.*\.json$/;
const REVIEW_DECISION_REGEX = /^review-decision-.*\.json$/;
const QUALITY_REPAIR_REQUEST_REGEX = /^quality-repair-request-.*\.json$/;
const RUNTIME_HARNESS_REPORT_REGEX = /^runtime-harness-report.*\.json$/;
const MULTIREPO_COORDINATION_STATUS_REGEX = /^multirepo-coordination-status-.*\.json$/;
const COMPILER_REVISION_STATUS_REGEX = /^compiler-revision-status-.*\.json$/;
const INCIDENT_REPORT_REGEX = /^incident-report-.*\.json$/;
const INCIDENT_BACKFILL_PROPOSAL_REGEX = /^incident-backfill-proposal-.*\.json$/;
const LEARNING_LOOP_SCORECARD_REGEX = /^learning-loop-scorecard-.*\.json$/;
const LEARNING_LOOP_HANDOFF_REGEX = /^learning-loop-handoff-.*\.json$/;
const RUN_CONTROL_AUDIT_REGEX = /^run-control-event-.*\.json$/;
const RUN_CONTROL_STATE_REGEX = /^run-control-state-.*\.json$/;
const PROJECT_INIT_STATE_REGEX = /^project-init-state\.json$/;
const ARTIFACT_BODY_REGEX = /^.+\.artifact\..+\.body\.json$/;
const ONBOARDING_REPORT_REGEX = /^onboarding-report\.json$/;
const NEXT_ACTION_REPORT_REGEX = /^next-action-report.*\.json$/;
const OPERATOR_REQUEST_REGEX = /^operator-request-.*\.json$/;

/**
 * @param {unknown} value
 * @returns {number | undefined}
 */
function asNonNegativeInteger(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return undefined;
  }
  return Math.floor(parsed);
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function asString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * @template T
 * @param {T[]} entries
 * @param {unknown} limit
 * @returns {T[]}
 */
export function applyReadModelLimit(entries, limit) {
  const normalizedLimit = asNonNegativeInteger(limit);
  if (typeof normalizedLimit !== "number") {
    return entries;
  }
  return normalizedLimit === 0 ? [] : entries.slice(0, normalizedLimit);
}

/**
 * @param {string} value
 * @returns {string}
 */
function toPosix(value) {
  return value.replace(/\\/g, "/");
}

/**
 * @param {ReturnType<typeof initializeProjectRuntime>} init
 * @param {string} filePath
 * @returns {string}
 */
export function toEvidenceRef(init, filePath) {
  return `evidence://${toPosix(path.relative(init.projectRoot, filePath))}`;
}

/**
 * @param {{
 *   family: string,
 *   file: string,
 *   artifact_ref: string,
 *   document: Record<string, unknown>,
 * }} entry
 * @returns {Record<string, unknown>}
 */
function displaySummaryForEntry(entry) {
  return buildArtifactDisplaySummary({
    family: entry.family,
    file: entry.file,
    artifactRef: entry.artifact_ref,
    document: entry.document,
  });
}

/**
 * @template {{ family: string, file: string, artifact_ref: string, document: Record<string, unknown> }} T
 * @param {T} entry
 * @returns {T & { display_summary: Record<string, unknown>, artifact_display_summaries: Record<string, unknown>[] }}
 */
function withDisplaySummary(entry) {
  const displaySummary = displaySummaryForEntry(entry);
  return {
    ...entry,
    display_summary: displaySummary,
    artifact_display_summaries: [displaySummary],
  };
}

/**
 * @param {string} dirPath
 * @param {{ limit?: number }} [options]
 * @returns {string[]}
 */
export function listJsonFiles(dirPath, options = {}) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  const files = fs
    .readdirSync(dirPath)
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => path.join(dirPath, entry))
    .sort((left, right) => {
      const leftStat = fs.statSync(left);
      const rightStat = fs.statSync(right);
      const mtimeDelta = rightStat.mtimeMs - leftStat.mtimeMs;
      if (mtimeDelta !== 0) {
        return mtimeDelta;
      }
      return path.basename(right).localeCompare(path.basename(left));
    });

  return applyReadModelLimit(files, options.limit);
}

/**
 * @param {string[]} files
 * @returns {string[]}
 */
function sortFilesByFreshness(files) {
  return [...files].sort((left, right) => {
    const leftStat = fs.statSync(left);
    const rightStat = fs.statSync(right);
    const mtimeDelta = rightStat.mtimeMs - leftStat.mtimeMs;
    if (mtimeDelta !== 0) {
      return mtimeDelta;
    }
    return path.basename(right).localeCompare(path.basename(left));
  });
}

/**
 * @param {string} dirPath
 * @param {RegExp[]} matchers
 * @param {unknown} limit
 * @returns {string[]}
 */
function listMatchingJsonFiles(dirPath, matchers, limit) {
  const files = listJsonFiles(dirPath).filter((filePath) => {
    const basename = path.basename(filePath);
    return matchers.some((matcher) => matcher.test(basename));
  });
  return applyReadModelLimit(files, limit);
}

/**
 * @param {{
 *   init: ReturnType<typeof initializeProjectRuntime>,
 *   files: string[],
 *   family: import("../../../contracts/src/index.d.ts").ContractFamily,
 *   matcher: RegExp,
 * }} options
 * @returns {Array<{ family: string, file: string, artifact_ref: string, document: Record<string, unknown> }>}
 */
function loadContractDocuments(options) {
  /** @type {Array<{ family: string, file: string, artifact_ref: string, document: Record<string, unknown> }>} */
  const loaded = [];

  for (const filePath of options.files) {
    const name = path.basename(filePath);
    if (!options.matcher.test(name)) {
      continue;
    }

    const contract = loadContractFile({
      filePath,
      family: options.family,
    });
    if (!contract.ok) {
      continue;
    }

      loaded.push(withDisplaySummary({
        family: options.family,
        file: filePath,
        artifact_ref: toEvidenceRef(options.init, filePath),
        document: /** @type {Record<string, unknown>} */ (contract.document),
      }));
  }

  return loaded;
}

/**
 * @param {{ init: ReturnType<typeof initializeProjectRuntime>, files: string[], matcher: RegExp }}
 * @returns {Array<{ family: string, file: string, artifact_ref: string, document: Record<string, unknown> }>}
 */
function loadJsonDocuments(options) {
  /** @type {Array<{ family: string, file: string, artifact_ref: string, document: Record<string, unknown> }>} */
  const loaded = [];

  for (const filePath of options.files) {
    const name = path.basename(filePath);
    if (!options.matcher.test(name)) {
      continue;
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        continue;
      }
      loaded.push(withDisplaySummary({
        family: "run-control-audit",
        file: filePath,
        artifact_ref: toEvidenceRef(options.init, filePath),
        document: /** @type {Record<string, unknown>} */ (parsed),
      }));
    } catch {
      // Ignore malformed audit sidecars; contract-backed artifacts still load through validators.
    }
  }

  return loaded;
}

/**
 * @param {ReturnType<typeof initializeProjectRuntime>} init
 * @returns {string[]}
 */
export function listRunControlStateFiles(init) {
  const rootStateFiles = listJsonFiles(init.runtimeLayout.stateRoot)
    .filter((filePath) => RUN_CONTROL_STATE_REGEX.test(path.basename(filePath)));
  const currentProjectRuntimeRoot = path.resolve(init.runtimeLayout.projectRuntimeRoot);
  const siblingStateFiles = fs.existsSync(init.runtimeLayout.projectsRoot)
    ? fs.readdirSync(init.runtimeLayout.projectsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((projectEntry) => {
        const projectRuntimeRoot = path.join(init.runtimeLayout.projectsRoot, projectEntry.name);
        if (path.resolve(projectRuntimeRoot) === currentProjectRuntimeRoot) return [];
        const stateRoot = path.join(projectRuntimeRoot, "state");
        return listJsonFiles(stateRoot).filter((filePath) => RUN_CONTROL_STATE_REGEX.test(path.basename(filePath)));
      })
    : [];
  const targetCheckoutsRoot = path.join(init.runtimeLayout.projectRuntimeRoot, "target-checkouts");
  if (!fs.existsSync(targetCheckoutsRoot)) {
    return sortFilesByFreshness([...rootStateFiles, ...siblingStateFiles]);
  }

  const nestedStateFiles = fs.readdirSync(targetCheckoutsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((checkoutEntry) => {
      const targetProjectsRoot = path.join(targetCheckoutsRoot, checkoutEntry.name, ".aor", "projects");
      if (!fs.existsSync(targetProjectsRoot)) return [];
      return fs.readdirSync(targetProjectsRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .flatMap((projectEntry) => {
          const targetStateRoot = path.join(targetProjectsRoot, projectEntry.name, "state");
          return listJsonFiles(targetStateRoot).filter((filePath) => RUN_CONTROL_STATE_REGEX.test(path.basename(filePath)));
        });
    });

  return sortFilesByFreshness([...rootStateFiles, ...siblingStateFiles, ...nestedStateFiles]);
}

/**
 * @param {{
 *   init: ReturnType<typeof initializeProjectRuntime>,
 *   files: string[],
 *   matcher: RegExp,
 *   type: string,
 *   stage: string,
 *   fallbackLabel: string,
 *   fallbackDescription: string,
 * }} options
 * @returns {Array<Record<string, unknown>>}
 */
function loadReadableEvidenceSidecarSummaries(options) {
  /** @type {Array<Record<string, unknown>>} */
  const summaries = [];
  for (const filePath of options.files) {
    if (!options.matcher.test(path.basename(filePath))) continue;
    let document = {};
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        document = /** @type {Record<string, unknown>} */ (parsed);
      }
    } catch {
      document = {};
    }
    summaries.push(buildArtifactDisplaySummary({
      file: filePath,
      artifactRef: toEvidenceRef(options.init, filePath),
      document,
      type: options.type,
      stage: options.stage,
      label: asString(document.title) ?? asString(document.packet_id) ?? options.fallbackLabel,
      description: asString(document.summary) ?? options.fallbackDescription,
      status: "ready",
    }));
  }
  return summaries;
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef?: string,
 *   projectProfile?: string,
 *   runtimeRoot?: string,
 *   limit?: number,
 * }} options
 * @returns {Array<Record<string, unknown>>}
 */
function listReadableEvidenceSidecarSummaries(options = {}) {
  const init = initializeProjectRuntime(options);
  const summaries = [
    ...loadReadableEvidenceSidecarSummaries({
      init,
      files: listJsonFiles(init.runtimeLayout.stateRoot),
      matcher: PROJECT_INIT_STATE_REGEX,
      type: "runtime-state",
      stage: "readiness",
      fallbackLabel: "Project runtime state",
      fallbackDescription: "Runtime initialization state evidence.",
    }),
    ...loadReadableEvidenceSidecarSummaries({
      init,
      files: listJsonFiles(init.runtimeLayout.artifactsRoot),
      matcher: ARTIFACT_BODY_REGEX,
      type: "evidence",
      stage: "mission",
      fallbackLabel: "Mission intake body",
      fallbackDescription: "Mission intake body evidence.",
    }),
    ...loadReadableEvidenceSidecarSummaries({
      init,
      files: listJsonFiles(init.runtimeLayout.reportsRoot),
      matcher: ONBOARDING_REPORT_REGEX,
      type: "onboarding-report",
      stage: "readiness",
      fallbackLabel: "Onboarding report",
      fallbackDescription: "Runtime onboarding report evidence.",
    }),
    ...loadReadableEvidenceSidecarSummaries({
      init,
      files: listJsonFiles(init.runtimeLayout.reportsRoot),
      matcher: VERIFICATION_PLAN_REGEX,
      type: "verification",
      stage: "verification",
      fallbackLabel: "Verification plan",
      fallbackDescription: "Verification command-group plan evidence.",
    }),
  ];
  return applyReadModelLimit(summaries, options.limit);
}

/**
 * @param {ReturnType<typeof initializeProjectRuntime>} init
 * @param {{ runId?: string | null }} [options]
 * @returns {Record<string, unknown> | null}
 */
function readLatestProviderStepStatus(init, options = {}) {
  const requestedRunId = asString(options.runId);
  const runControlStatuses = listRunControlStateFiles(init)
    .flatMap((filePath) => {
      try {
        const state = JSON.parse(fs.readFileSync(filePath, "utf8"));
        const normalized = normalizeProviderStepStatus(asRecord(state).provider_step_status);
        const runId = asString(asRecord(state).run_id);
        return normalized ? [{ status: normalized, runId, updatedMs: fs.statSync(filePath).mtimeMs }] : [];
      } catch {
        return [];
      }
    });

  const statuses = runControlStatuses
    .sort((left, right) => {
      const leftUpdated = Date.parse(String(left.status.updated_at ?? "")) || left.updatedMs;
      const rightUpdated = Date.parse(String(right.status.updated_at ?? "")) || right.updatedMs;
      return rightUpdated - leftUpdated;
    });
  const matchingStatuses = requestedRunId
    ? statuses.filter((entry) => entry.runId === requestedRunId)
    : statuses;
  return (matchingStatuses[0] ?? statuses[0])?.status ?? null;
}

/**
 * @param {string} filePath
 * @returns {Record<string, unknown> | null}
 */
function readJsonObject(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return asRecord(parsed);
  } catch {
    return null;
  }
}

/**
 * @param {ReturnType<typeof initializeProjectRuntime>} init
 * @param {RegExp} matcher
 * @returns {{ file: string, artifact_ref: string, document: Record<string, unknown> } | null}
 */
function readLatestReportSidecar(init, matcher) {
  const file = listMatchingJsonFiles(init.runtimeLayout.reportsRoot, [matcher], 1)[0] ?? null;
  if (!file) return null;
  const document = readJsonObject(file);
  return document ? { file, artifact_ref: toEvidenceRef(init, file), document } : null;
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
 * @param {unknown} value
 * @returns {Map<string, Record<string, unknown>>}
 */
function commandGroupIndex(value) {
  const byId = new Map();
  const groups = Array.isArray(value) ? value : [];
  for (const entry of groups) {
    const group = asRecord(entry);
    const id = asString(group.id);
    if (id) byId.set(id, group);
  }
  return byId;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isFailedStatus(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "failed" || normalized === "fail" || normalized === "error" || normalized === "not_pass";
}

/**
 * @param {ReturnType<typeof initializeProjectRuntime>} init
 * @param {string} ref
 * @returns {string | null}
 */
function localArtifactPathForRef(init, ref) {
  const normalized = asString(ref);
  if (!normalized) return null;
  if (path.isAbsolute(normalized)) return normalized;
  if (normalized.startsWith("evidence://")) {
    const evidencePath = normalized.slice("evidence://".length);
    const projectPath = path.resolve(init.projectRoot, evidencePath);
    if (fs.existsSync(projectPath)) return projectPath;
    const runtimePath = path.resolve(init.runtimeLayout.projectRuntimeRoot, evidencePath);
    if (fs.existsSync(runtimePath)) return runtimePath;
    return projectPath;
  }
  return null;
}

/**
 * @param {ReturnType<typeof initializeProjectRuntime>} init
 * @param {string[]} refs
 * @returns {{ failedStepResultRefs: string[], blockedNextStep: string | null }}
 */
function verificationFailureStepResultSurface(init, refs) {
  const failedStepResultRefs = [];
  let blockedNextStep = null;
  for (const ref of refs) {
    const filePath = localArtifactPathForRef(init, ref);
    if (!filePath) continue;
    const document = readJsonObject(filePath);
    if (!document || !isFailedStatus(document.status)) continue;
    failedStepResultRefs.push(ref);
    blockedNextStep ??= asString(document.blocked_next_step);
  }
  return { failedStepResultRefs, blockedNextStep };
}

/**
 * @param {Record<string, unknown>} group
 * @param {Record<string, unknown> | null} latestGroup
 * @param {ReturnType<typeof initializeProjectRuntime>} init
 * @returns {Record<string, unknown>}
 */
function verificationPlanCommandGroupSurface(group, latestGroup, init) {
  const latestStatus = asString(latestGroup?.status);
  const status = latestStatus ?? asString(group.status) ?? "planned";
  const skipPolicy = asRecord(group.skip_policy);
  const stepResultRefs =
    Array.isArray(latestGroup?.step_result_refs)
      ? latestGroup.step_result_refs
      : Array.isArray(group.step_result_refs)
        ? group.step_result_refs
        : [];
  const failureSurface = verificationFailureStepResultSurface(init, asStringArray(stepResultRefs));
  const failedStepResultRefs =
    asStringArray(latestGroup?.failed_step_result_refs).length > 0
      ? asStringArray(latestGroup?.failed_step_result_refs)
      : asStringArray(group.failed_step_result_refs).length > 0
        ? asStringArray(group.failed_step_result_refs)
        : failureSurface.failedStepResultRefs;
  const failedCommandCount =
    Number.isFinite(Number(latestGroup?.failed_command_count))
      ? Number(latestGroup.failed_command_count)
      : Number.isFinite(Number(group.failed_command_count))
        ? Number(group.failed_command_count)
        : failedStepResultRefs.length;
  return {
    id: asString(group.id) ?? "command-group",
    repo_id: asString(group.repo_id) ?? "main",
    role: asString(group.role) ?? "custom",
    phase: asString(group.phase) ?? "post-change",
    enforcement: asString(group.enforcement) ?? "required",
    timeout_class: asString(group.timeout_class) ?? "focused-test",
    working_dir: asString(group.working_dir) ?? ".",
    depends_on: asStringArray(group.depends_on),
    command_count: Number.isFinite(Number(group.command_count))
      ? Number(group.command_count)
      : asStringArray(group.commands).length,
    status,
    last_result_status: latestStatus,
    outcome:
      asString(latestGroup?.outcome) ??
      asString(latestGroup?.command_group_outcome) ??
      asString(group.outcome) ??
      asString(group.command_group_outcome) ??
      asString(skipPolicy.outcome),
    failed_command_count: failedCommandCount,
    failed_step_result_refs: failedStepResultRefs,
    blocked_next_step:
      asString(latestGroup?.blocked_next_step) ??
      asString(group.blocked_next_step) ??
      failureSurface.blockedNextStep,
    command_source: asString(group.command_source),
    step_result_refs: stepResultRefs,
  };
}

/**
 * @param {ReturnType<typeof initializeProjectRuntime>} init
 * @returns {Record<string, unknown> | null}
 */
function readVerificationPlanSurface(init) {
  const plan = readLatestReportSidecar(init, VERIFICATION_PLAN_REGEX);
  const summary = readLatestReportSidecar(init, VERIFY_SUMMARY_REGEX);
  if (!plan && !summary) return null;

  const planDocument = plan?.document ?? {};
  const summaryDocument = summary?.document ?? {};
  const summaryGroups = commandGroupIndex(summaryDocument.command_groups);
  const sourceGroups =
    Array.isArray(planDocument.command_groups) && planDocument.command_groups.length > 0
      ? planDocument.command_groups
      : Array.isArray(summaryDocument.command_groups)
        ? summaryDocument.command_groups
        : [];
  const commandGroups = sourceGroups.map((entry) => {
    const group = asRecord(entry);
    const id = asString(group.id);
    return verificationPlanCommandGroupSurface(group, id ? summaryGroups.get(id) ?? null : null, init);
  });
  return {
    status: asString(planDocument.status) ?? (commandGroups.length > 0 ? "planned" : "no-tests"),
    verification_label: asString(planDocument.verification_label) ?? asString(summaryDocument.verification_label) ?? "default",
    plan_file: plan?.file ?? null,
    plan_ref: plan?.artifact_ref ?? null,
    latest_summary_file: summary?.file ?? null,
    latest_summary_ref: summary?.artifact_ref ?? null,
    latest_verify_status: asString(summaryDocument.status),
    command_count: Number.isFinite(Number(planDocument.command_count))
      ? Number(planDocument.command_count)
      : commandGroups.reduce((count, group) => count + Number(group.command_count ?? 0), 0),
    command_groups: commandGroups,
    discovered_command_groups: Array.isArray(planDocument.discovered_command_groups)
      ? planDocument.discovered_command_groups
      : [],
    discovery_outcomes: Array.isArray(planDocument.discovery_outcomes) ? planDocument.discovery_outcomes : [],
    discovery_suggestions: Array.isArray(planDocument.discovery_suggestions)
      ? planDocument.discovery_suggestions
      : [],
  };
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef?: string,
 *   projectProfile?: string,
 *   runtimeRoot?: string,
 * }} options
 */
export function readProjectState(options = {}) {
  const preview = previewProjectRuntime({
    cwd: options.cwd,
    projectRef: options.projectRef,
    projectProfile: options.projectProfile,
    runtimeRoot: options.runtimeRoot,
  });
  if (!preview.stateExists) {
    return {
      project_id: preview.projectId,
      display_name: preview.displayName,
      project_root: preview.projectRoot,
      project_profile_ref: preview.projectProfileRef,
      runtime_root: preview.runtimeRoot,
      runtime_layout: preview.runtimeLayout,
      state_file: null,
      onboarding_summary: buildOnboardingSummary(preview),
      provider_step_status: null,
      run_health: null,
      verification_plan: null,
      artifact_display_summaries: [],
    };
  }
  const init = initializeProjectRuntime(options);
  const initializedPreview = previewProjectRuntime({
    cwd: options.cwd,
    projectRef: init.projectRoot,
    projectProfile: options.projectProfile,
    runtimeRoot: options.runtimeRoot,
  });
  const runHealth = readLatestExternalRunHealthProjectionForRuntime(init);
  return {
    project_id: init.projectId,
    display_name: init.displayName,
    project_root: init.projectRoot,
    project_profile_ref: init.projectProfileRef,
    runtime_root: init.runtimeRoot,
    runtime_layout: init.state.runtime_layout,
    state_file: init.stateFile,
    onboarding_summary: buildOnboardingSummary(initializedPreview),
    provider_step_status: readLatestProviderStepStatus(init, { runId: asString(runHealth?.run_id) }),
    run_health: runHealth,
    verification_plan: readVerificationPlanSurface(init),
    artifact_display_summaries: listArtifactDisplaySummaries({ ...options, limit: options.limit ?? 50 }),
  };
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef?: string,
 *   projectProfile?: string,
 *   runtimeRoot?: string,
 * }} options
 */
export function listPacketArtifacts(options = {}) {
  const init = initializeProjectRuntime(options);
  const files = listMatchingJsonFiles(
    init.runtimeLayout.artifactsRoot,
    [
      ARTIFACT_PACKET_REGEX,
      WAVE_TICKET_REGEX,
      HANDOFF_PACKET_REGEX,
      DELIVERY_PLAN_REGEX,
      DELIVERY_MANIFEST_REGEX,
      RELEASE_PACKET_REGEX,
    ],
    options.limit,
  );

  return applyReadModelLimit([
    ...loadContractDocuments({ init, files, family: "artifact-packet", matcher: ARTIFACT_PACKET_REGEX }),
    ...loadContractDocuments({ init, files, family: "wave-ticket", matcher: WAVE_TICKET_REGEX }),
    ...loadContractDocuments({ init, files, family: "handoff-packet", matcher: HANDOFF_PACKET_REGEX }),
    ...loadContractDocuments({ init, files, family: "delivery-plan", matcher: DELIVERY_PLAN_REGEX }),
    ...loadContractDocuments({ init, files, family: "delivery-manifest", matcher: DELIVERY_MANIFEST_REGEX }),
    ...loadContractDocuments({ init, files, family: "release-packet", matcher: RELEASE_PACKET_REGEX }),
  ], options.limit);
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef?: string,
 *   projectProfile?: string,
 *   runtimeRoot?: string,
 * }} options
 */
export function listStepResults(options = {}) {
  const init = initializeProjectRuntime(options);
  const files = listMatchingJsonFiles(init.runtimeLayout.reportsRoot, [STEP_RESULT_REGEX], options.limit);
  return applyReadModelLimit(
    loadContractDocuments({ init, files, family: "step-result", matcher: STEP_RESULT_REGEX }),
    options.limit,
  );
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef?: string,
 *   projectProfile?: string,
 *   runtimeRoot?: string,
 * }} options
 */
export function listDeliveryManifests(options = {}) {
  return listPacketArtifacts(options).filter((entry) => entry.family === "delivery-manifest");
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef?: string,
 *   projectProfile?: string,
 *   runtimeRoot?: string,
 * }} options
 */
export function listPromotionDecisions(options = {}) {
  const init = initializeProjectRuntime(options);
  const files = listMatchingJsonFiles(init.runtimeLayout.artifactsRoot, [PROMOTION_DECISION_REGEX], options.limit);
  return applyReadModelLimit(
    loadContractDocuments({ init, files, family: "promotion-decision", matcher: PROMOTION_DECISION_REGEX }),
    options.limit,
  );
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef?: string,
 *   projectProfile?: string,
 *   runtimeRoot?: string,
 * }} options
 */
export function listQualityArtifacts(options = {}) {
  const init = initializeProjectRuntime(options);
  const reportFiles = listMatchingJsonFiles(
    init.runtimeLayout.reportsRoot,
    [
      VALIDATION_REPORT_REGEX,
      EVALUATION_REPORT_REGEX,
      REVIEW_REPORT_REGEX,
      REVIEW_DECISION_REGEX,
      QUALITY_REPAIR_REQUEST_REGEX,
      RUNTIME_HARNESS_REPORT_REGEX,
      MULTIREPO_COORDINATION_STATUS_REGEX,
      COMPILER_REVISION_STATUS_REGEX,
      INCIDENT_REPORT_REGEX,
      INCIDENT_BACKFILL_PROPOSAL_REGEX,
      LEARNING_LOOP_SCORECARD_REGEX,
      LEARNING_LOOP_HANDOFF_REGEX,
    ],
    options.limit,
  );

  return applyReadModelLimit([
    ...loadContractDocuments({ init, files: reportFiles, family: "validation-report", matcher: VALIDATION_REPORT_REGEX }),
    ...loadContractDocuments({ init, files: reportFiles, family: "evaluation-report", matcher: EVALUATION_REPORT_REGEX }),
    ...loadContractDocuments({ init, files: reportFiles, family: "review-report", matcher: REVIEW_REPORT_REGEX }),
    ...loadContractDocuments({ init, files: reportFiles, family: "review-decision", matcher: REVIEW_DECISION_REGEX }),
    ...loadContractDocuments({
      init,
      files: reportFiles,
      family: "quality-repair-request",
      matcher: QUALITY_REPAIR_REQUEST_REGEX,
    }),
    ...loadContractDocuments({
      init,
      files: reportFiles,
      family: "runtime-harness-report",
      matcher: RUNTIME_HARNESS_REPORT_REGEX,
    }),
    ...loadContractDocuments({
      init,
      files: reportFiles,
      family: "multirepo-coordination-status",
      matcher: MULTIREPO_COORDINATION_STATUS_REGEX,
    }),
    ...loadContractDocuments({
      init,
      files: reportFiles,
      family: "compiler-revision-status",
      matcher: COMPILER_REVISION_STATUS_REGEX,
    }),
    ...loadContractDocuments({ init, files: reportFiles, family: "incident-report", matcher: INCIDENT_REPORT_REGEX }),
    ...loadContractDocuments({
      init,
      files: reportFiles,
      family: "incident-backfill-proposal",
      matcher: INCIDENT_BACKFILL_PROPOSAL_REGEX,
    }),
    ...loadContractDocuments({
      init,
      files: reportFiles,
      family: "learning-loop-scorecard",
      matcher: LEARNING_LOOP_SCORECARD_REGEX,
    }),
    ...loadContractDocuments({
      init,
      files: reportFiles,
      family: "learning-loop-handoff",
      matcher: LEARNING_LOOP_HANDOFF_REGEX,
    }),
    ...listPromotionDecisions(options),
  ], options.limit);
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef?: string,
 *   projectProfile?: string,
 *   runtimeRoot?: string,
 * }} options
 */
export function listMultirepoCoordinationStatuses(options = {}) {
  const init = initializeProjectRuntime(options);
  const reportFiles = listMatchingJsonFiles(init.runtimeLayout.reportsRoot, [MULTIREPO_COORDINATION_STATUS_REGEX], options.limit);
  return applyReadModelLimit(
    loadContractDocuments({
      init,
      files: reportFiles,
      family: "multirepo-coordination-status",
      matcher: MULTIREPO_COORDINATION_STATUS_REGEX,
    }),
    options.limit,
  );
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef?: string,
 *   projectProfile?: string,
 *   runtimeRoot?: string,
 * }} options
 */
export function listCompilerRevisionStatuses(options = {}) {
  const init = initializeProjectRuntime(options);
  const reportFiles = listMatchingJsonFiles(init.runtimeLayout.reportsRoot, [COMPILER_REVISION_STATUS_REGEX], options.limit);
  return applyReadModelLimit(
    loadContractDocuments({
      init,
      files: reportFiles,
      family: "compiler-revision-status",
      matcher: COMPILER_REVISION_STATUS_REGEX,
    }),
    options.limit,
  );
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef?: string,
 *   projectProfile?: string,
 *   runtimeRoot?: string,
 * }} options
 */
export function listRunControlAudits(options = {}) {
  const init = initializeProjectRuntime(options);
  const reportFiles = listMatchingJsonFiles(init.runtimeLayout.reportsRoot, [RUN_CONTROL_AUDIT_REGEX], options.limit);
  return applyReadModelLimit(loadJsonDocuments({ init, files: reportFiles, matcher: RUN_CONTROL_AUDIT_REGEX }), options.limit);
}

/**
 * @param {Record<string, unknown>} document
 * @returns {Record<string, unknown>}
 */
function sanitizeOperatorRequestDocument(document) {
  const sanitized = { ...document };
  delete sanitized.request_text;
  if (typeof sanitized.request_summary !== "string" || sanitized.request_summary.trim().length === 0) {
    const raw = typeof document.request_text === "string" ? document.request_text.replace(/\s+/gu, " ").trim() : "";
    sanitized.request_summary = raw.length > 220 ? `${raw.slice(0, 217)}...` : raw;
  }
  return sanitized;
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef?: string,
 *   projectProfile?: string,
 *   runtimeRoot?: string,
 * }} options
 */
export function listOperatorRequests(options = {}) {
  const init = initializeProjectRuntime(options);
  const reportFiles = listJsonFiles(init.runtimeLayout.reportsRoot);
  return loadContractDocuments({
    init,
    files: reportFiles,
    family: "operator-request",
    matcher: OPERATOR_REQUEST_REGEX,
  }).map((entry) => {
    const operatorRequestRef = `packet://operator-request@${entry.artifact_ref}`;
    const displaySummary = buildArtifactDisplaySummary({
      family: "operator-request",
      file: entry.file,
      artifactRef: operatorRequestRef,
      sourceRef: entry.artifact_ref,
      document: entry.document,
    });
    return {
      ...entry,
      operator_request_ref: operatorRequestRef,
      display_summary: displaySummary,
      artifact_display_summaries: [displaySummary],
      document: sanitizeOperatorRequestDocument(entry.document),
    };
  });
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef?: string,
 *   projectProfile?: string,
 *   runtimeRoot?: string,
 *   limit?: number,
 * }} options
 */
export function listArtifactDisplaySummaries(options = {}) {
  const nextActionReport = readNextActionReport(options);
  const summaries = [
    ...listPacketArtifacts(options).flatMap((entry) => entry.artifact_display_summaries ?? []),
    ...listReadableEvidenceSidecarSummaries(options),
    ...listStepResults(options).flatMap((entry) => entry.artifact_display_summaries ?? []),
    ...listQualityArtifacts(options).flatMap((entry) => entry.artifact_display_summaries ?? []),
    ...listOperatorRequests(options).flatMap((entry) => entry.artifact_display_summaries ?? []),
    ...listExternalRunHealthArtifactDisplaySummariesForRuntime(initializeProjectRuntime(options), options),
    ...(nextActionReport?.artifact_display_summaries ?? []),
  ];
  return applyReadModelLimit(uniqueArtifactDisplaySummaries(summaries), options.limit);
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef?: string,
 *   projectProfile?: string,
 *   runtimeRoot?: string,
 * }} options
 * @returns {{ family: string, file: string, artifact_ref: string, document: Record<string, unknown> } | null}
 */
export function readNextActionReport(options = {}) {
  const init = initializeProjectRuntime(options);
  const reportFiles = listMatchingJsonFiles(init.runtimeLayout.reportsRoot, [NEXT_ACTION_REPORT_REGEX], options.limit);
  return (
    loadContractDocuments({
      init,
      files: reportFiles,
      family: "next-action-report",
      matcher: NEXT_ACTION_REPORT_REGEX,
    })[0] ?? null
  );
}
