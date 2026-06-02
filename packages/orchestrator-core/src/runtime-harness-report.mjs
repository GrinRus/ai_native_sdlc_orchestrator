import fs from "node:fs";
import path from "node:path";

import { loadContractFile, validateContractDocument } from "../../contracts/src/index.mjs";

import { initializeProjectRuntime } from "./project-init.mjs";
import {
  filterMeaningfulCodeChangedPaths,
  filterNonBootstrapChangedPaths,
  filterRunnerOwnedStatePaths,
  listChangedPaths,
  loadMissionScope,
  resolveMissionScopedChanges,
} from "./shared/mission-scope.mjs";

const RUNTIME_HARNESS_DECISIONS = new Set(["pass", "retry", "repair", "escalate", "block", "fail"]);
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
 * @returns {number | null}
 */
function asNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
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
 * @returns {Array<Record<string, unknown>>}
 */
function asRecordArray(value) {
  return Array.isArray(value)
    ? value.filter((entry) => typeof entry === "object" && entry !== null && !Array.isArray(entry))
    : [];
}

/**
 * @param {unknown} value
 * @returns {unknown}
 */
function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function hasNonEmptyPermissionDenials(value) {
  if (Array.isArray(value)) {
    return value.some((entry) => hasNonEmptyPermissionDenials(entry));
  }

  const record = asRecord(value);
  const entries = Object.entries(record);
  if (entries.length === 0) {
    return false;
  }

  const permissionDenials = record.permission_denials;
  if (Array.isArray(permissionDenials) && permissionDenials.length > 0) {
    return true;
  }

  return entries.some(([, entry]) => hasNonEmptyPermissionDenials(entry));
}

/**
 * @param {string[]} values
 * @returns {string[]}
 */
function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))];
}

/**
 * @param {string} filePath
 * @returns {Record<string, unknown> | null}
 */
function readJsonFile(filePath) {
  try {
    return /** @type {Record<string, unknown>} */ (JSON.parse(fs.readFileSync(filePath, "utf8")));
  } catch {
    return null;
  }
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeId(value) {
  const normalized = [];
  let previousWasReplacement = false;
  for (const char of value.toLowerCase()) {
    const code = char.charCodeAt(0);
    const allowed =
      (code >= 97 && code <= 122) ||
      (code >= 48 && code <= 57) ||
      char === "." ||
      char === "_" ||
      char === "-";
    if (allowed) {
      normalized.push(char);
      previousWasReplacement = false;
      continue;
    }
    if (!previousWasReplacement) {
      normalized.push("-");
      previousWasReplacement = true;
    }
  }

  let start = 0;
  let end = normalized.length;
  while (start < end && normalized[start] === "-") start += 1;
  while (end > start && normalized[end - 1] === "-") end -= 1;
  return normalized.slice(start, end).join("");
}

/**
 * @param {string | undefined} value
 * @returns {boolean}
 */
function isRunTokenBoundary(value) {
  return value === undefined || value === "." || value === "_" || value === "-" || value === ":";
}

/**
 * @param {string} projectRoot
 * @param {string} filePath
 * @returns {string}
 */
function toEvidenceRef(projectRoot, filePath) {
  return `evidence://${path.relative(projectRoot, filePath).replace(/\\/g, "/")}`;
}

/**
 * @param {string} dirPath
 * @returns {string[]}
 */
function listJsonFiles(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }
  return fs
    .readdirSync(dirPath)
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => path.join(dirPath, entry))
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
}

/**
 * @param {unknown} startedAt
 * @param {unknown} finishedAt
 * @returns {number | null}
 */
function resolveDurationSeconds(startedAt, finishedAt) {
  if (typeof startedAt !== "string" || typeof finishedAt !== "string") {
    return null;
  }
  const startedMs = Date.parse(startedAt);
  const finishedMs = Date.parse(finishedAt);
  if (!Number.isFinite(startedMs) || !Number.isFinite(finishedMs) || finishedMs < startedMs) {
    return null;
  }
  return Math.round(((finishedMs - startedMs) / 1000) * 1000) / 1000;
}

/**
 * @param {unknown} decision
 * @param {"pass" | "retry" | "repair" | "escalate" | "block" | "fail"} fallback
 * @returns {"pass" | "retry" | "repair" | "escalate" | "block" | "fail"}
 */
function normalizeDecision(decision, fallback) {
  return typeof decision === "string" && RUNTIME_HARNESS_DECISIONS.has(decision)
    ? /** @type {"pass" | "retry" | "repair" | "escalate" | "block" | "fail"} */ (decision)
    : fallback;
}

/**
 * @param {string} missionType
 * @returns {string}
 */
export function strictnessProfileForMissionType(missionType) {
  if (missionType === "code-changing") return "strict-code-changing";
  if (missionType === "release") return "strict-release";
  if (missionType === "docs-only") return "soft-docs";
  if (missionType === "no-write-rehearsal") return "soft-no-write";
  if (missionType === "asset-certification") return "asset-certification";
  return "unknown";
}

/**
 * @param {Record<string, unknown>} requestDocument
 * @returns {string | null}
 */
function missionTypeFromRequestDocument(requestDocument) {
  const explicit = asString(requestDocument.mission_type);
  if (explicit) return explicit;
  const scenarioFamily = asString(requestDocument.scenario_family);
  if (scenarioFamily === "release") return "release";
  const writeMode = asString(requestDocument.write_mode) ?? asString(requestDocument.delivery_mode);
  if (writeMode === "no-write" || requestDocument.no_write === true) return "no-write-rehearsal";
  const changeKind = asString(requestDocument.change_kind) ?? asString(requestDocument.request_kind);
  if (changeKind === "docs" || changeKind === "docs-only") return "docs-only";
  return null;
}

/**
 * @param {string} projectRoot
 * @param {string} artifactsRoot
 * @returns {{ missionType: string, strictnessProfile: string, source: string }}
 */
export function resolveRuntimeMissionProfile(projectRoot, artifactsRoot) {
  const packetFiles = listJsonFiles(artifactsRoot).filter((filePath) => path.basename(filePath).includes(".artifact."));
  for (const packetFile of packetFiles) {
    const packet = readJsonFile(packetFile);
    if (asString(packet?.packet_type) !== "intake-request") continue;
    const bodyRef = asString(packet?.body_ref);
    if (!bodyRef || !fs.existsSync(bodyRef)) continue;
    const body = readJsonFile(bodyRef);
    const featureRequest = asRecord(body?.feature_request);
    const requestDocument = asRecord(featureRequest.request_document);
    const missionType = missionTypeFromRequestDocument(requestDocument) ?? "code-changing";
    return {
      missionType,
      strictnessProfile: strictnessProfileForMissionType(missionType),
      source: packetFile,
    };
  }
  return {
    missionType: "code-changing",
    strictnessProfile: "strict-code-changing",
    source: "runtime://default-mission-profile",
  };
}

/**
 * @param {string} runRef
 * @returns {string}
 */
function normalizeRunRef(runRef) {
  return runRef.startsWith("run://") ? runRef.slice("run://".length) : runRef;
}

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
 * @param {string} runId
 * @returns {boolean}
 */
function documentLinksRun(document, runId) {
  return extractRunRefs(document).includes(runId);
}

/**
 * Routed live execution can mint nested run ids under the public live-e2e run,
 * for example `project.run.<outer-run>.routed-execution.v1`.
 *
 * @param {string} value
 * @param {string} runId
 * @returns {boolean}
 */
function containsRunToken(value, runId) {
  const normalizedValue = normalizeId(value);
  const normalizedRunId = normalizeId(runId);
  if (!normalizedValue || !normalizedRunId) {
    return false;
  }
  if (normalizedValue === normalizedRunId) {
    return true;
  }
  let index = normalizedValue.indexOf(normalizedRunId);
  while (index !== -1) {
    const before = index === 0 ? undefined : normalizedValue[index - 1];
    const afterIndex = index + normalizedRunId.length;
    const after = afterIndex >= normalizedValue.length ? undefined : normalizedValue[afterIndex];
    if (isRunTokenBoundary(before) && isRunTokenBoundary(after)) {
      return true;
    }
    index = normalizedValue.indexOf(normalizedRunId, index + 1);
  }
  return false;
}

/**
 * @param {Record<string, unknown>} document
 * @param {string} runId
 * @returns {boolean}
 */
function stepResultLinksRun(document, runId) {
  if (documentLinksRun(document, runId)) {
    return true;
  }
  return [document.run_id, document.step_result_id, document.step_id, document.subject_ref]
    .map((value) => asString(value))
    .some((value) => value !== null && containsRunToken(value, runId));
}

/**
 * @param {Record<string, unknown>} adapterOutput
 * @returns {string | null}
 */
function permissionFailureKindFromAdapterOutput(adapterOutput) {
  const runnerOutput = asRecord(adapterOutput.runner_output);
  if (hasNonEmptyPermissionDenials(runnerOutput)) {
    return "permission-mode-blocked";
  }

  let serialized = "";
  try {
    serialized = JSON.stringify(runnerOutput) ?? "";
  } catch {
    serialized = "";
  }
  const normalized = serialized.toLowerCase();
  if (
    normalized.includes("edit denied") ||
    normalized.includes("edit tool denied") ||
    normalized.includes("tool denied: edit") ||
    normalized.includes("denied tool edit")
  ) {
    return "edit-denied";
  }
  if (
    normalized.includes("tool_use_denied") ||
    normalized.includes("tool use denied") ||
    normalized.includes("tool denied") ||
    normalized.includes("approval required for tool") ||
    normalized.includes("approval is required for tool") ||
    normalized.includes("requesting permission to use") ||
    normalized.includes("grant permission to use") ||
    /\bpermissions?\s+(?:is\s+|are\s+)?required\s+for\s+(?:tool|edit|write|command)\b/u.test(normalized) ||
    /\bpermission[- ]mode\s+(?:blocked|denied|requires|required)\b/u.test(normalized) ||
    /\b(?:blocked|denied)\s+by\s+permission[- ]mode\b/u.test(normalized) ||
    normalized.includes("workspace trust") ||
    normalized.includes("not trusted") ||
    /\brunner\s+sandbox\s+(?:blocked|denied|violation|requires|required)\b/u.test(normalized) ||
    /\btool\s+sandbox\s+(?:blocked|denied|violation|requires|required)\b/u.test(normalized)
  ) {
    return "permission-mode-blocked";
  }
  return null;
}

/**
 * @param {Record<string, unknown>} stepResult
 * @returns {{ failureClass: string, decision: "retry" | "block", missionOutcome: string } | null}
 */
function runtimePermissionDecisionOutcome(stepResult) {
  const decision = asRecord(stepResult.runtime_permission_decision);
  const value = asString(decision.decision);
  if (!value) {
    return null;
  }
  const failureClass = asString(stepResult.failure_class) ?? "permission-mode-blocked";
  if (value === "auto_approve" || value === "user_approved") {
    return { failureClass, decision: "retry", missionOutcome: "not_satisfied" };
  }
  if (value === "ask_user" || value === "auto_deny" || value === "user_denied") {
    return { failureClass, decision: "block", missionOutcome: "not_satisfied" };
  }
  return null;
}

/**
 * @param {Record<string, unknown>} stepResult
 * @param {{ gitStatusAvailable?: boolean, strictCodeChangingNoop?: boolean, nonBootstrapChangedPaths?: string[], meaningfulChangedPaths?: string[], runnerOwnedStatePaths?: string[] }} [options]
 * @returns {{ failureClass: string, decision: "pass" | "retry" | "repair" | "escalate" | "block" | "fail", missionOutcome: string }}
 */
export function classifyRuntimeStepOutcome(stepResult, options = {}) {
  const routedExecution = asRecord(stepResult.routed_execution);
  const adapterResponse = asRecord(routedExecution.adapter_response);
  const adapterOutput = asRecord(adapterResponse.output);
  const stepStatus = asString(stepResult.status);
  const adapterStatus = asString(adapterResponse.status);
  const failureKind = asString(adapterOutput.failure_kind);
  const permissionFailureKind = permissionFailureKindFromAdapterOutput(adapterOutput);
  const existingDecision = asString(stepResult.runtime_harness_decision);
  const existingOutcome = asString(stepResult.mission_outcome);
  const stepClass = asString(stepResult.step_class);
  const executionMode = asString(routedExecution.mode);
  const stepMissionSemantics = asRecord(stepResult.mission_semantics);
  const stepRunnerOwnedStatePaths = asStringArray(stepMissionSemantics.runner_owned_state_paths);
  const meaningfulChangedPaths = Array.isArray(options.meaningfulChangedPaths)
    ? options.meaningfulChangedPaths
    : options.nonBootstrapChangedPaths;
  const runnerOwnedStatePaths = Array.isArray(options.runnerOwnedStatePaths)
    ? options.runnerOwnedStatePaths
    : stepRunnerOwnedStatePaths;
  const runtimePermissionOutcome = runtimePermissionDecisionOutcome(stepResult);

  if (runtimePermissionOutcome) {
    return runtimePermissionOutcome;
  }

  if (permissionFailureKind === "permission-mode-blocked") {
    return { failureClass: "permission-mode-blocked", decision: "repair", missionOutcome: "not_satisfied" };
  }
  if (permissionFailureKind === "edit-denied") {
    return { failureClass: "edit-denied", decision: "repair", missionOutcome: "not_satisfied" };
  }

  if (
    stepClass === "runner" &&
    executionMode === "execute" &&
    options.gitStatusAvailable !== false &&
    runnerOwnedStatePaths.length > 0
  ) {
    return { failureClass: "runner-owned-state-leak", decision: "block", missionOutcome: "not_satisfied" };
  }

  if (
    options.strictCodeChangingNoop === true &&
    stepClass === "runner" &&
    executionMode === "execute" &&
    stepStatus === "passed" &&
    adapterStatus === "success" &&
    options.gitStatusAvailable !== false &&
    Array.isArray(meaningfulChangedPaths) &&
    meaningfulChangedPaths.length === 0
  ) {
    return { failureClass: "no-op", decision: "repair", missionOutcome: "not_satisfied" };
  }

  if (existingDecision || existingOutcome || asString(stepResult.failure_class)) {
    const fallbackDecision = stepStatus === "passed" ? "pass" : adapterStatus === "blocked" ? "block" : "repair";
    return {
      failureClass: asString(stepResult.failure_class) ?? failureKind ?? "unknown",
      decision: normalizeDecision(existingDecision, fallbackDecision),
      missionOutcome: existingOutcome ?? (stepStatus === "passed" ? "satisfied" : "not_satisfied"),
    };
  }

  if (failureKind === "external-runner-timeout") {
    return { failureClass: "provider-timeout", decision: "retry", missionOutcome: "not_satisfied" };
  }
  if (failureKind === "auth-failed") {
    return { failureClass: "auth-failure", decision: "block", missionOutcome: "not_satisfied" };
  }
  if (failureKind === "permission-mode-blocked") {
    return { failureClass: "permission-mode-blocked", decision: "repair", missionOutcome: "not_satisfied" };
  }
  if (failureKind === "edit-denied") {
    return { failureClass: "edit-denied", decision: "repair", missionOutcome: "not_satisfied" };
  }
  if (failureKind === "interactive-question-requested") {
    return { failureClass: "interactive-question-requested", decision: "block", missionOutcome: "not_satisfied" };
  }
  if (adapterStatus === "blocked") {
    return { failureClass: failureKind ?? "runtime-failed", decision: "block", missionOutcome: "not_satisfied" };
  }
  if (stepStatus !== "passed" || adapterStatus === "failed") {
    return { failureClass: failureKind ?? "runtime-failed", decision: "repair", missionOutcome: "not_satisfied" };
  }
  return { failureClass: "none", decision: "pass", missionOutcome: "satisfied" };
}

/**
 * @param {Record<string, unknown>} stepResult
 * @returns {string[]}
 */
function extractImpactedAssetRefs(stepResult) {
  const routedExecution = asRecord(stepResult.routed_execution);
  const routeResolution = asRecord(routedExecution.route_resolution);
  const assetResolution = asRecord(routedExecution.asset_resolution);
  const wrapper = asRecord(assetResolution.wrapper);
  const promptBundle = asRecord(assetResolution.prompt_bundle);
  const policyResolution = asRecord(routedExecution.policy_resolution);
  const adapterResolution = asRecord(routedExecution.adapter_resolution);
  const adapter = asRecord(adapterResolution.adapter);

  return uniqueStrings([
    asString(routeResolution.resolved_route_id) ? `route://${asString(routeResolution.resolved_route_id)}` : "",
    asString(wrapper.wrapper_ref) ?? "",
    asString(promptBundle.prompt_bundle_ref) ?? "",
    asString(asRecord(policyResolution.policy).policy_id)
      ? `policy://${asString(asRecord(policyResolution.policy).policy_id)}`
      : "",
    asString(adapter.adapter_id) ? `adapter://${asString(adapter.adapter_id)}` : "",
  ]);
}

/**
 * @param {Record<string, unknown>} stepResult
 * @returns {{ retry: Record<string, unknown>, repair: Record<string, unknown>, escalation: Record<string, unknown> }}
 */
function resolvePolicyControls(stepResult) {
  const routedExecution = asRecord(stepResult.routed_execution);
  const policyResolution = asRecord(routedExecution.policy_resolution);
  const policy = asRecord(policyResolution.policy);
  const profile = asRecord(policy.profile);
  return {
    retry: asRecord(profile.retry),
    repair: asRecord(profile.repair),
    escalation: asRecord(profile.escalation),
  };
}

/**
 * @param {Record<string, unknown>} policyControl
 * @param {string} decision
 * @returns {number | null}
 */
function resolveMaxAttempts(policyControl, decision) {
  if (decision === "escalate") {
    return asNumber(policyControl.after_total_failures);
  }
  return asNumber(policyControl.max_attempts);
}

/**
 * @param {Record<string, unknown>} stepResult
 * @param {{ failureClass: string, decision: "pass" | "retry" | "repair" | "escalate" | "block" | "fail" }} classification
 * @param {string} artifactRef
 * @returns {Array<Record<string, unknown>>}
 */
export function synthesizeRepairAttempts(stepResult, classification, artifactRef) {
  const existingAttempts = asRecordArray(stepResult.repair_attempts);
  if (existingAttempts.length > 0 || classification.decision === "pass") {
    return existingAttempts;
  }

  const controls = resolvePolicyControls(stepResult);
  const selectedControl =
    classification.decision === "retry"
      ? controls.retry
      : classification.decision === "repair"
        ? controls.repair
        : classification.decision === "escalate"
          ? controls.escalation
          : {};
  const policyOn = asStringArray(selectedControl.on);
  const maxAttempts = resolveMaxAttempts(selectedControl, classification.decision);
  const policyAction =
    classification.decision === "retry" || classification.decision === "repair" || classification.decision === "escalate"
      ? classification.decision
      : "none";

  return [
    {
      attempt: 0,
      status: policyAction === "none" ? classification.decision : "pending",
      trigger: classification.failureClass,
      failure_class: classification.failureClass,
      runtime_harness_decision: classification.decision,
      policy_action: policyAction,
      input_evidence_refs: uniqueStrings([artifactRef, ...asStringArray(stepResult.evidence_refs)]),
      repair_route_ref: null,
      repair_compiled_context_ref: null,
      result: "not_started",
      exhausted_budget: maxAttempts === 0,
      policy_budget: {
        max_attempts: maxAttempts,
        failure_class_listed: policyOn.includes(classification.failureClass),
        on: policyOn,
      },
    },
  ];
}

/**
 * @param {Record<string, unknown>} stepResult
 * @param {string} artifactRef
 * @param {{ gitStatusAvailable: boolean, changedPaths: string[], nonBootstrapChangedPaths: string[], meaningfulChangedPaths: string[], nonInputChangedPaths: string[], runnerOwnedStatePaths?: string[], ignoredInputFiles: string[], strictCodeChangingNoop: boolean }} missionSemantics
 */
function buildStepDecision(stepResult, artifactRef, missionSemantics) {
  const routedExecution = asRecord(stepResult.routed_execution);
  const contextCompilation = asRecord(routedExecution.context_compilation);
  const adapterResponse = asRecord(routedExecution.adapter_response);
  const classification = classifyRuntimeStepOutcome(stepResult, {
    gitStatusAvailable: missionSemantics.gitStatusAvailable,
    strictCodeChangingNoop: missionSemantics.strictCodeChangingNoop,
    nonBootstrapChangedPaths: missionSemantics.nonBootstrapChangedPaths,
    meaningfulChangedPaths: missionSemantics.meaningfulChangedPaths,
    runnerOwnedStatePaths: missionSemantics.runnerOwnedStatePaths,
  });
  const startedAt = asString(routedExecution.started_at);
  const finishedAt = asString(routedExecution.finished_at);

  return {
    step_id: asString(stepResult.step_id) ?? "unknown",
    step_class: asString(stepResult.step_class) ?? "unknown",
    compiled_context_ref: asString(contextCompilation.compiled_context_ref),
    adapter_status: asString(adapterResponse.status),
    failure_class: classification.failureClass,
    mission_outcome: classification.missionOutcome,
    runtime_harness_decision: classification.decision,
    repair_attempts: synthesizeRepairAttempts(stepResult, classification, artifactRef),
    verification_status: asString(asRecord(stepResult.verification).status) ?? "not_run",
    stage_timings: {
      started_at: startedAt,
      finished_at: finishedAt,
      duration_sec: resolveDurationSeconds(startedAt, finishedAt),
    },
    mission_semantics: {
      git_status_available: missionSemantics.gitStatusAvailable,
      changed_paths: missionSemantics.changedPaths,
      non_bootstrap_changed_paths: missionSemantics.nonBootstrapChangedPaths,
      non_input_changed_paths: missionSemantics.nonInputChangedPaths,
      meaningful_changed_paths: missionSemantics.meaningfulChangedPaths,
      runner_owned_state_paths: asStringArray(missionSemantics.runnerOwnedStatePaths),
      ignored_input_files: missionSemantics.ignoredInputFiles,
      strict_code_changing_noop: missionSemantics.strictCodeChangingNoop,
    },
    evidence_refs: uniqueStrings([artifactRef, ...asStringArray(stepResult.evidence_refs)]),
  };
}

/**
 * @param {{
 *   init: ReturnType<typeof initializeProjectRuntime>,
 *   runId: string,
 * }} options
 */
function loadRunStepArtifacts(options) {
  const loadedArtifacts = loadAllRunStepArtifacts(options);
  const seenStepKeys = new Set();
  return loadedArtifacts.filter((entry) => {
    const stepId = asString(entry.document.step_id) ?? entry.file;
    const stepClass = asString(entry.document.step_class) ?? "unknown";
    const key = `${stepId}:${stepClass}`;
    if (seenStepKeys.has(key)) return false;
    seenStepKeys.add(key);
    return true;
  });
}

/**
 * @param {{
 *   init: ReturnType<typeof initializeProjectRuntime>,
 *   runId: string,
 * }} options
 */
function loadAllRunStepArtifacts(options) {
  return listJsonFiles(options.init.runtimeLayout.reportsRoot)
    .filter((filePath) => path.basename(filePath).startsWith("step-result-"))
    .map((filePath) => {
      const loaded = loadContractFile({ filePath, family: "step-result" });
      if (!loaded.ok) return null;
      const document = asRecord(loaded.document);
      return documentLinksRun(document, options.runId)
        ? {
            file: filePath,
            artifact_ref: toEvidenceRef(options.init.projectRoot, filePath),
            document,
          }
        : null;
    })
    .filter((entry) => entry !== null);
}

/**
 * @param {{
 *   init: ReturnType<typeof initializeProjectRuntime>,
 *   runId: string,
 * }} options
 */
function loadRuntimePermissionStepArtifacts(options) {
  return listJsonFiles(options.init.runtimeLayout.reportsRoot)
    .filter((filePath) => path.basename(filePath).startsWith("step-result-"))
    .map((filePath) => {
      const loaded = loadContractFile({ filePath, family: "step-result" });
      if (!loaded.ok) return null;
      const document = asRecord(loaded.document);
      return stepResultLinksRun(document, options.runId)
        ? {
            file: filePath,
            artifact_ref: toEvidenceRef(options.init.projectRoot, filePath),
            document,
          }
        : null;
    })
    .filter((entry) => entry !== null);
}

/**
 * @param {Array<{ artifact_ref: string, document: Record<string, unknown> }>} stepArtifacts
 * @returns {Array<Record<string, unknown>>}
 */
function collectRuntimePermissionDecisions(stepArtifacts) {
  return stepArtifacts.flatMap((artifact) => {
    const requestedInteraction = asRecord(artifact.document.requested_interaction);
    const topLevelRequest = asRecord(artifact.document.runtime_permission_request);
    const interactionRequest = asRecord(requestedInteraction.runtime_permission_request);
    const runtimePermissionRequest =
      Object.keys(topLevelRequest).length > 0 ? topLevelRequest : interactionRequest;
    const topLevelDecision = asRecord(artifact.document.runtime_permission_decision);
    const interactionDecision = asRecord(requestedInteraction.runtime_permission_decision);
    const runtimePermissionDecision =
      Object.keys(topLevelDecision).length > 0 ? topLevelDecision : interactionDecision;
    if (Object.keys(runtimePermissionDecision).length === 0) {
      return [];
    }

    const externalRunner = asRecord(artifact.document.external_runner);
    return [
      {
        step_id: asString(artifact.document.step_id),
        step_result_id: asString(artifact.document.step_result_id),
        step_result_ref: artifact.artifact_ref,
        interaction_id: asString(requestedInteraction.interaction_id),
        adapter_id: asString(runtimePermissionRequest.adapter_id),
        runner_family: asString(runtimePermissionRequest.runner_family),
        permission_mode:
          asString(runtimePermissionRequest.permission_mode) ?? asString(externalRunner.permission_mode),
        operation_type: asString(runtimePermissionRequest.operation_type) ?? "unknown",
        tool_name: asString(runtimePermissionRequest.tool_name),
        target: asString(runtimePermissionRequest.target) ?? asString(runtimePermissionRequest.target_path),
        command: asString(runtimePermissionRequest.command),
        confidence: asString(runtimePermissionRequest.confidence),
        decision: asString(runtimePermissionDecision.decision) ?? "unknown",
        operator_decision: asString(runtimePermissionDecision.operator_decision),
        rule_id: asString(runtimePermissionDecision.rule_id),
        interaction_policy: asString(runtimePermissionDecision.interaction_policy),
        auto_approval_profile: asString(runtimePermissionDecision.profile),
        approval_scope: asString(runtimePermissionDecision.approval_scope),
        approval_resume_mode: asString(runtimePermissionDecision.approval_resume_mode),
        continuation_strategy: asString(runtimePermissionDecision.continuation_strategy),
        audit_ref: asString(runtimePermissionDecision.audit_ref),
        grant_ref: asString(runtimePermissionDecision.grant_ref),
        evidence_refs: uniqueStrings([
          artifact.artifact_ref,
          asString(runtimePermissionDecision.audit_ref) ?? "",
          asString(runtimePermissionDecision.grant_ref) ?? "",
          ...asStringArray(runtimePermissionRequest.evidence_refs),
          ...asStringArray(artifact.document.evidence_refs),
        ]),
      },
    ];
  });
}

/**
 * @param {Array<Record<string, unknown>>} runtimePermissionDecisions
 * @returns {Record<string, unknown>}
 */
function buildRuntimePermissionSummary(runtimePermissionDecisions) {
  const decisionCounts = {};
  for (const decision of runtimePermissionDecisions) {
    const key = asString(decision.decision) ?? "unknown";
    decisionCounts[key] = (Number(decisionCounts[key]) || 0) + 1;
  }
  return {
    total: runtimePermissionDecisions.length,
    decision_counts: decisionCounts,
    permission_modes: uniqueStrings(runtimePermissionDecisions.map((decision) => asString(decision.permission_mode) ?? "")),
    interaction_policies: uniqueStrings(
      runtimePermissionDecisions.map((decision) => asString(decision.interaction_policy) ?? ""),
    ),
    auto_approval_profiles: uniqueStrings(
      runtimePermissionDecisions.map((decision) => asString(decision.auto_approval_profile) ?? ""),
    ),
    approval_scopes: uniqueStrings(runtimePermissionDecisions.map((decision) => asString(decision.approval_scope) ?? "")),
    approval_resume_modes: uniqueStrings(
      runtimePermissionDecisions.map((decision) => asString(decision.approval_resume_mode) ?? ""),
    ),
    continuation_strategies: uniqueStrings(
      runtimePermissionDecisions.map((decision) => asString(decision.continuation_strategy) ?? ""),
    ),
    audit_refs: uniqueStrings(runtimePermissionDecisions.map((decision) => asString(decision.audit_ref) ?? "")),
    grant_refs: uniqueStrings(runtimePermissionDecisions.map((decision) => asString(decision.grant_ref) ?? "")),
  };
}

/**
 * @param {{
 *   init: ReturnType<typeof initializeProjectRuntime>,
 *   runId: string,
 * }} options
 */
function loadRunQualityArtifacts(options) {
  const families = [
    /** @type {const} */ ("review-report"),
    /** @type {const} */ ("review-decision"),
    /** @type {const} */ ("evaluation-report"),
    /** @type {const} */ ("learning-loop-scorecard"),
    /** @type {const} */ ("learning-loop-handoff"),
    /** @type {const} */ ("incident-report"),
    /** @type {const} */ ("incident-backfill-proposal"),
  ];
  const files = listJsonFiles(options.init.runtimeLayout.reportsRoot);
  /** @type {Array<{ family: string, file: string, artifact_ref: string, document: Record<string, unknown> }>} */
  const artifacts = [];

  for (const filePath of files) {
    for (const family of families) {
      const loaded = loadContractFile({ filePath, family });
      if (!loaded.ok) continue;
      const document = asRecord(loaded.document);
      if (documentLinksRun(document, options.runId)) {
        artifacts.push({
          family,
          file: filePath,
          artifact_ref: toEvidenceRef(options.init.projectRoot, filePath),
          document,
        });
      }
      break;
    }
  }

  return artifacts;
}

/**
 * @param {{
 *   init: ReturnType<typeof initializeProjectRuntime>,
 *   runId: string,
 * }} options
 */
function loadRunDeliveryArtifacts(options) {
  return listJsonFiles(options.init.runtimeLayout.artifactsRoot)
    .filter((filePath) => path.basename(filePath).startsWith("delivery-manifest-"))
    .map((filePath) => {
      const loaded = loadContractFile({ filePath, family: "delivery-manifest" });
      if (!loaded.ok) return null;
      const document = asRecord(loaded.document);
      return documentLinksRun(document, options.runId)
        ? {
            family: "delivery-manifest",
            file: filePath,
            artifact_ref: toEvidenceRef(options.init.projectRoot, filePath),
            document,
          }
        : null;
    })
    .filter((entry) => entry !== null);
}

/**
 * @param {Array<{ severity: string }>} findings
 * @param {Array<Record<string, unknown>>} stepDecisions
 * @param {Record<string, unknown>} [runDecision]
 * @returns {"pass" | "retry" | "repair" | "escalate" | "block" | "fail"}
 */
function resolveOverallDecision(findings, stepDecisions, runDecision = {}) {
  const controllerDecision = asString(runDecision.overall_decision);
  if (controllerDecision && RUNTIME_HARNESS_DECISIONS.has(controllerDecision)) {
    return /** @type {"pass" | "retry" | "repair" | "escalate" | "block" | "fail"} */ (controllerDecision);
  }
  if (findings.some((finding) => finding.severity === "fail")) return "fail";
  const decisions = stepDecisions.map((decision) => asString(decision.runtime_harness_decision));
  if (decisions.includes("fail")) return "fail";
  if (decisions.includes("block")) return "block";
  if (decisions.includes("escalate")) return "escalate";
  if (decisions.includes("repair")) return "repair";
  if (decisions.includes("retry")) return "retry";
  return "pass";
}

/**
 * @param {Record<string, unknown>} finding
 * @returns {string}
 */
function failureClassForReviewFinding(finding) {
  const category = asString(finding.category) ?? "review";
  const summary = (asString(finding.summary) ?? "").toLowerCase();
  if (
    summary.includes("no non-bootstrap changed paths") ||
    summary.includes("empty changed paths") ||
    summary.includes("empty patch") ||
    summary.includes("no-op")
  ) {
    return "no-op";
  }
  if (category === "artifact-quality") return "missing-evidence";
  if (category === "feature-traceability" || category === "discovery-quality") return "validation-failed";
  if (category === "code-quality") return "review-failed";
  return "review-failed";
}

/**
 * @param {Array<{ family: string, artifact_ref: string, document: Record<string, unknown> }>} qualityArtifacts
 */
function resolveReviewFindings(qualityArtifacts) {
  return qualityArtifacts
    .filter((artifact) => artifact.family === "review-report")
    .flatMap((artifact) =>
      asRecordArray(artifact.document.findings).map((finding) => ({
        finding_id: asString(finding.finding_id) ?? `review.${normalizeId(asString(finding.category) ?? "finding")}`,
        severity: asString(finding.severity) ?? "warn",
        category: asString(finding.category) ?? "review",
        failure_class: failureClassForReviewFinding(finding),
        summary: asString(finding.summary) ?? "Review finding.",
        evidence_refs: uniqueStrings([artifact.artifact_ref, ...asStringArray(finding.evidence_refs)]),
      })),
    );
}

/**
 * @param {Array<{ family: string, artifact_ref: string, document: Record<string, unknown> }>} qualityArtifacts
 */
function resolveEvaluationFindings(qualityArtifacts) {
  return qualityArtifacts
    .filter((artifact) => artifact.family === "evaluation-report")
    .filter((artifact) => asString(artifact.document.status) !== "pass")
    .map((artifact) => {
      const status = asString(artifact.document.status) ?? "unknown";
      return {
        finding_id: `${asString(artifact.document.report_id) ?? "evaluation-report"}.eval-${normalizeId(status)}`,
        severity: status === "fail" || status === "failed" ? "fail" : "warn",
        category: "eval",
        failure_class: "eval-failed",
        summary: `Evaluation report '${asString(artifact.document.report_id) ?? "unknown"}' ended with status '${status}'.`,
        evidence_refs: uniqueStrings([artifact.artifact_ref, ...asStringArray(artifact.document.evidence_refs)]),
      };
    });
}

/**
 * @param {Record<string, unknown>} deliveryManifest
 * @returns {string[]}
 */
function extractDeliveryChangedPaths(deliveryManifest) {
  return asRecordArray(deliveryManifest.repo_deliveries).flatMap((delivery) =>
    asStringArray(delivery.changed_paths).map((changedPath) => changedPath.replace(/\\/g, "/")),
  );
}

/**
 * @param {Array<{ family: string, artifact_ref: string, document: Record<string, unknown> }>} deliveryArtifacts
 * @param {{ strictCodeChangingNoop: boolean }} missionSemantics
 */
function resolveDeliveryFindings(deliveryArtifacts, missionSemantics) {
  return deliveryArtifacts.flatMap((artifact) => {
    const findings = [];
    const manifestId = asString(artifact.document.manifest_id) ?? "delivery-manifest";
    const status = asString(artifact.document.status) ?? "unknown";
    if (status === "failed" || status === "blocked") {
      findings.push({
        finding_id: `${manifestId}.delivery-${normalizeId(status)}`,
        severity: "fail",
        category: "delivery",
        failure_class: "delivery-failed",
        summary: `Delivery manifest '${manifestId}' ended with status '${status}'.`,
        evidence_refs: uniqueStrings([artifact.artifact_ref, ...asStringArray(artifact.document.evidence_refs)]),
      });
    }

    const changedPaths = extractDeliveryChangedPaths(artifact.document);
    const nonBootstrapChangedPaths = filterMeaningfulCodeChangedPaths(filterNonBootstrapChangedPaths(changedPaths));
    if (missionSemantics.strictCodeChangingNoop && nonBootstrapChangedPaths.length === 0) {
      findings.push({
        finding_id: `${manifestId}.delivery-empty-patch`,
        severity: "fail",
        category: "delivery",
        failure_class: "delivery-empty-patch",
        summary: `Delivery manifest '${manifestId}' has no non-bootstrap changed paths for a strict code-changing mission.`,
        evidence_refs: uniqueStrings([artifact.artifact_ref, ...asStringArray(artifact.document.evidence_refs)]),
      });
    }

    return findings;
  });
}

/**
 * @param {Record<string, unknown>} finding
 * @returns {string}
 */
function recommendationActionForFinding(finding) {
  const failureClass = asString(finding.failure_class);
  if (failureClass === "provider-timeout") return "retry";
  if (failureClass === "auth-failure" || failureClass === "interactive-question-requested") return "escalate";
  if (
    failureClass === "no-op" ||
    failureClass === "edit-denied" ||
    failureClass === "permission-mode-blocked" ||
    failureClass === "missing-evidence" ||
    failureClass === "review-failed" ||
    failureClass === "eval-failed" ||
    failureClass === "delivery-empty-patch"
  ) {
    return "repair";
  }
  return "investigate";
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef?: string,
 *   projectProfile?: string,
 *   runtimeRoot?: string,
 *   runId: string,
 *   missionType?: string,
 *   strictnessProfile?: string,
 *   runController?: Record<string, unknown>,
 *   runTransitions?: Array<Record<string, unknown>>,
 *   runDecision?: Record<string, unknown>,
 * }} options
 */
export function materializeRuntimeHarnessReport(options) {
  const init = initializeProjectRuntime(options);
  const missionProfile = resolveRuntimeMissionProfile(init.projectRoot, init.runtimeLayout.artifactsRoot);
  const missionType = options.missionType ?? missionProfile.missionType;
  const strictnessProfile = options.strictnessProfile ?? missionProfile.strictnessProfile;
  const changedPathStatus = listChangedPaths(init.projectRoot);
  const nonBootstrapChangedPaths = filterNonBootstrapChangedPaths(changedPathStatus.changedPaths);
  const runnerOwnedStatePaths = filterRunnerOwnedStatePaths(changedPathStatus.changedPaths);
  const missionScope = loadMissionScope(init.projectRoot, init.runtimeLayout.artifactsRoot);
  const missionScopedChanges = resolveMissionScopedChanges(nonBootstrapChangedPaths, missionScope);
  const strictCodeChangingNoop = missionType === "code-changing" || missionType === "release";
  const missionSemantics = {
    gitStatusAvailable: changedPathStatus.available,
    changedPaths: changedPathStatus.changedPaths,
    nonBootstrapChangedPaths,
    nonInputChangedPaths: missionScopedChanges.nonInputChangedPaths,
    meaningfulChangedPaths: missionScopedChanges.meaningfulChangedPaths,
    runnerOwnedStatePaths,
    ignoredInputFiles: missionScopedChanges.ignoredInputFiles,
    strictCodeChangingNoop,
  };
  const stepArtifacts = loadRunStepArtifacts({ init, runId: options.runId });
  const runtimePermissionStepArtifacts = loadRuntimePermissionStepArtifacts({ init, runId: options.runId });
  const qualityArtifacts = loadRunQualityArtifacts({ init, runId: options.runId });
  const deliveryArtifacts = loadRunDeliveryArtifacts({ init, runId: options.runId });
  const stepDecisions = stepArtifacts.map((artifact) =>
    buildStepDecision(artifact.document, artifact.artifact_ref, missionSemantics),
  );
  const runtimePermissionDecisions = collectRuntimePermissionDecisions(runtimePermissionStepArtifacts);
  const runtimePermissionSummary = buildRuntimePermissionSummary(runtimePermissionDecisions);
  const stepFindings = stepDecisions
    .filter((decision) => asString(decision.runtime_harness_decision) !== "pass")
    .map((decision) => ({
      finding_id: `${options.runId}.${normalizeId(asString(decision.step_id) ?? "step")}.${asString(decision.failure_class) ?? "unknown"}`,
      severity: ["block", "fail"].includes(asString(decision.runtime_harness_decision) ?? "") ? "fail" : "warn",
      category: "runtime",
      failure_class: asString(decision.failure_class) ?? "unknown",
      summary: `Runtime step '${asString(decision.step_id) ?? "unknown"}' ended with decision '${asString(decision.runtime_harness_decision) ?? "unknown"}' and failure class '${asString(decision.failure_class) ?? "unknown"}'.`,
      evidence_refs: asStringArray(decision.evidence_refs),
    }));
  const reviewFindings = resolveReviewFindings(qualityArtifacts);
  const evalFindings = resolveEvaluationFindings(qualityArtifacts);
  const deliveryFindings = resolveDeliveryFindings(deliveryArtifacts, missionSemantics);
  const runFindings = [...stepFindings, ...reviewFindings, ...evalFindings, ...deliveryFindings];
  const impactedAssetRefs = uniqueStrings(
    stepArtifacts.flatMap((artifact) =>
      classifyRuntimeStepOutcome(artifact.document, {
        gitStatusAvailable: missionSemantics.gitStatusAvailable,
        strictCodeChangingNoop: missionSemantics.strictCodeChangingNoop,
        nonBootstrapChangedPaths: missionSemantics.nonBootstrapChangedPaths,
        meaningfulChangedPaths: missionSemantics.meaningfulChangedPaths,
        runnerOwnedStatePaths: missionSemantics.runnerOwnedStatePaths,
      }).decision === "pass"
        ? []
        : extractImpactedAssetRefs(artifact.document),
    ),
  );
  const promotionRecommendations = impactedAssetRefs.map((assetRef) => ({
    asset_ref: assetRef,
    recommendation: "recertify-before-promotion",
    reason: "Runtime Harness diagnosis found unresolved runtime or quality findings linked to this asset.",
  }));
  const unresolvedGaps = runFindings
    .filter((finding) => finding.severity === "fail")
    .map((finding) => ({
      gap_id: `${finding.finding_id}.gap`,
      summary: finding.summary,
      evidence_refs: finding.evidence_refs,
    }));
  const recommendations = runFindings.map((finding) => ({
    recommendation_id: `${finding.finding_id}.recommendation`,
    action: recommendationActionForFinding(finding),
    summary: finding.summary,
    evidence_refs: finding.evidence_refs,
  }));
  const evidenceRefs = uniqueStrings([
    ...stepArtifacts.map((artifact) => artifact.artifact_ref),
    ...qualityArtifacts.map((artifact) => artifact.artifact_ref),
    ...deliveryArtifacts.map((artifact) => artifact.artifact_ref),
    ...stepDecisions.flatMap((decision) => asStringArray(decision.evidence_refs)),
  ]);

  const reportPath = path.join(
    init.runtimeLayout.reportsRoot,
    `runtime-harness-report-${normalizeId(options.runId)}.json`,
  );
  const previousReport = readJsonFile(reportPath);
  const previousRunController = asRecord(previousReport?.run_controller);
  const previousRunTransitions = Array.isArray(previousReport?.run_transitions)
    ? previousReport.run_transitions
    : null;
  const previousRunDecision = asRecord(previousReport?.run_decision);
  const activeRunDecision =
    options.runDecision && Object.keys(asRecord(options.runDecision)).length > 0
      ? asRecord(options.runDecision)
      : previousRunDecision;
  const activeRunController =
    options.runController && Object.keys(asRecord(options.runController)).length > 0
      ? asRecord(options.runController)
      : previousRunController;

  const report = {
    report_id: `${options.runId}.runtime-harness-report.v1`,
    project_id: init.projectId,
    run_id: options.runId,
    generated_at: new Date().toISOString(),
    mission_type: missionType,
    strictness_profile: strictnessProfile,
    overall_decision: resolveOverallDecision(runFindings, stepDecisions, activeRunDecision),
    step_decisions: stepDecisions,
    runtime_permission_summary: runtimePermissionSummary,
    runtime_permission_decisions: runtimePermissionDecisions,
    run_findings: runFindings,
    recommendations,
    impacted_asset_refs: impactedAssetRefs,
    promotion_recommendations: promotionRecommendations,
    unresolved_gaps: unresolvedGaps,
    evidence_refs: evidenceRefs,
  };
  if (Object.keys(activeRunController).length > 0) {
    report.run_controller = cloneJson(activeRunController);
  }
  if (Array.isArray(options.runTransitions)) {
    report.run_transitions = cloneJson(options.runTransitions);
  } else if (previousRunTransitions) {
    report.run_transitions = cloneJson(previousRunTransitions);
  }
  if (Object.keys(activeRunDecision).length > 0) {
    report.run_decision = cloneJson(activeRunDecision);
  }

  const validation = validateContractDocument({
    family: "runtime-harness-report",
    document: report,
    source: "runtime://runtime-harness-report",
  });
  if (!validation.ok) {
    const issueSummary = validation.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Generated runtime harness report failed contract validation: ${issueSummary}`);
  }

  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  return {
    ...init,
    report,
    reportPath,
    reportRef: toEvidenceRef(init.projectRoot, reportPath),
  };
}
