import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { loadContractFile, validateContractDocument } from "../../contracts/src/index.mjs";

import { initializeProjectRuntime } from "./project-init.mjs";

const RUNTIME_HARNESS_DECISIONS = new Set(["pass", "retry", "repair", "escalate", "block", "fail"]);
const BOOTSTRAP_OWNED_PREFIXES = ["examples/", "context/", ".aor/"];
const BOOTSTRAP_OWNED_FILES = new Set(["project.aor.yaml"]);

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
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
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
 * @param {string} projectRoot
 * @returns {{ available: boolean, changedPaths: string[] }}
 */
function listChangedPaths(projectRoot) {
  const run = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  if (run.status !== 0) {
    return { available: false, changedPaths: [] };
  }
  const changedPaths = (run.stdout ?? "")
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0)
    .map((line) => line.slice(3).trim())
    .map((candidate) => {
      const renameParts = candidate.split(" -> ");
      return renameParts.length > 1 ? renameParts[renameParts.length - 1] : candidate;
    })
    .map((candidate) => candidate.replace(/\\/g, "/"));
  return { available: true, changedPaths };
}

/**
 * @param {string[]} changedPaths
 * @returns {string[]}
 */
function filterNonBootstrapChangedPaths(changedPaths) {
  return changedPaths.filter((candidate) => {
    if (BOOTSTRAP_OWNED_FILES.has(candidate)) return false;
    return !BOOTSTRAP_OWNED_PREFIXES.some((prefix) => candidate === prefix.slice(0, -1) || candidate.startsWith(prefix));
  });
}

/**
 * @param {string} pattern
 * @param {string} candidate
 * @returns {boolean}
 */
function matchesScopePattern(pattern, candidate) {
  const normalizedPattern = pattern.replace(/\\/g, "/");
  const normalizedCandidate = candidate.replace(/\\/g, "/");
  if (normalizedPattern === "**" || normalizedPattern === "**/*") return true;
  if (normalizedPattern.endsWith("/**")) {
    const prefix = normalizedPattern.slice(0, -3);
    return normalizedCandidate === prefix || normalizedCandidate.startsWith(`${prefix}/`);
  }
  if (normalizedPattern.endsWith("/*")) {
    const prefix = normalizedPattern.slice(0, -1);
    return normalizedCandidate.startsWith(prefix) && !normalizedCandidate.slice(prefix.length).includes("/");
  }
  if (!normalizedPattern.includes("*")) {
    return normalizedCandidate === normalizedPattern;
  }
  const wildcardPrefix = normalizedPattern.slice(0, normalizedPattern.indexOf("*"));
  return normalizedCandidate.startsWith(wildcardPrefix);
}

/**
 * @param {string} projectRoot
 * @param {string | null} filePath
 * @returns {string | null}
 */
function resolveProjectRelativeFile(projectRoot, filePath) {
  if (!filePath) return null;
  const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(projectRoot, filePath);
  const relative = path.relative(projectRoot, resolved).replace(/\\/g, "/");
  return relative.startsWith("../") || relative === "" ? null : relative;
}

/**
 * @param {string} projectRoot
 * @param {string} artifactsRoot
 * @returns {{ ignoredInputFiles: string[], allowedPaths: string[], forbiddenPaths: string[] }}
 */
function loadMissionScope(projectRoot, artifactsRoot) {
  const packetFiles = listJsonFiles(artifactsRoot).filter((filePath) => path.basename(filePath).includes(".artifact."));
  for (const packetFile of packetFiles) {
    const packet = readJsonFile(packetFile);
    if (asString(packet?.packet_type) !== "intake-request") continue;
    const bodyRef = asString(packet?.body_ref);
    if (!bodyRef || !fs.existsSync(bodyRef)) continue;
    const body = readJsonFile(bodyRef);
    const featureRequest = asRecord(body?.feature_request);
    const requestDocument = asRecord(featureRequest.request_document);
    const requestFile = resolveProjectRelativeFile(projectRoot, asString(featureRequest.request_file));
    return {
      ignoredInputFiles: requestFile ? [requestFile] : [],
      allowedPaths: asStringArray(requestDocument.allowed_paths),
      forbiddenPaths: asStringArray(requestDocument.forbidden_paths),
    };
  }
  return { ignoredInputFiles: [], allowedPaths: [], forbiddenPaths: [] };
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
 * @param {string[]} changedPaths
 * @param {{ ignoredInputFiles: string[], allowedPaths: string[], forbiddenPaths: string[] }} missionScope
 */
function resolveMissionScopedChanges(changedPaths, missionScope) {
  const ignoredInputFiles = new Set(missionScope.ignoredInputFiles);
  const scopeCandidates = changedPaths.filter((changedPath) => !ignoredInputFiles.has(changedPath));
  const forbiddenChangedPaths = scopeCandidates.filter((changedPath) =>
    missionScope.forbiddenPaths.some((pattern) => matchesScopePattern(pattern, changedPath)),
  );
  const outOfScopeChangedPaths =
    missionScope.allowedPaths.length > 0
      ? scopeCandidates.filter(
          (changedPath) => !missionScope.allowedPaths.some((pattern) => matchesScopePattern(pattern, changedPath)),
        )
      : [];
  const missionScopedChangedPaths =
    missionScope.allowedPaths.length > 0
      ? scopeCandidates.filter((changedPath) =>
          missionScope.allowedPaths.some((pattern) => matchesScopePattern(pattern, changedPath)),
        )
      : scopeCandidates;

  return {
    ignoredInputFiles: missionScope.ignoredInputFiles,
    allowedPaths: missionScope.allowedPaths,
    forbiddenPaths: missionScope.forbiddenPaths,
    nonInputChangedPaths: scopeCandidates,
    missionScopedChangedPaths,
    forbiddenChangedPaths,
    outOfScopeChangedPaths,
    scopeViolationPaths: uniqueStrings([...forbiddenChangedPaths, ...outOfScopeChangedPaths]),
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
 * @param {Record<string, unknown>} stepResult
 * @param {{ gitStatusAvailable?: boolean, strictCodeChangingNoop?: boolean, nonBootstrapChangedPaths?: string[], missionScopedChangedPaths?: string[], scopeViolationPaths?: string[] }} [options]
 * @returns {{ failureClass: string, decision: "pass" | "retry" | "repair" | "escalate" | "block" | "fail", missionOutcome: string }}
 */
export function classifyRuntimeStepOutcome(stepResult, options = {}) {
  const routedExecution = asRecord(stepResult.routed_execution);
  const adapterResponse = asRecord(routedExecution.adapter_response);
  const adapterOutput = asRecord(adapterResponse.output);
  const stepStatus = asString(stepResult.status);
  const adapterStatus = asString(adapterResponse.status);
  const failureKind = asString(adapterOutput.failure_kind);
  const existingDecision = asString(stepResult.runtime_harness_decision);
  const existingOutcome = asString(stepResult.mission_outcome);
  const stepClass = asString(stepResult.step_class);
  const executionMode = asString(routedExecution.mode);
  const meaningfulChangedPaths = Array.isArray(options.missionScopedChangedPaths)
    ? options.missionScopedChangedPaths
    : options.nonBootstrapChangedPaths;

  if (
    stepClass === "runner" &&
    executionMode === "execute" &&
    stepStatus === "passed" &&
    adapterStatus === "success" &&
    Array.isArray(options.scopeViolationPaths) &&
    options.scopeViolationPaths.length > 0
  ) {
    return { failureClass: "repo-scope-violation", decision: "fail", missionOutcome: "not_satisfied" };
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
 * @param {{ gitStatusAvailable: boolean, changedPaths: string[], nonBootstrapChangedPaths: string[], missionScopedChangedPaths: string[], nonInputChangedPaths: string[], ignoredInputFiles: string[], allowedPaths: string[], forbiddenPaths: string[], forbiddenChangedPaths: string[], outOfScopeChangedPaths: string[], scopeViolationPaths: string[], strictCodeChangingNoop: boolean }} missionSemantics
 */
function buildStepDecision(stepResult, artifactRef, missionSemantics) {
  const routedExecution = asRecord(stepResult.routed_execution);
  const contextCompilation = asRecord(routedExecution.context_compilation);
  const adapterResponse = asRecord(routedExecution.adapter_response);
  const classification = classifyRuntimeStepOutcome(stepResult, {
    gitStatusAvailable: missionSemantics.gitStatusAvailable,
    strictCodeChangingNoop: missionSemantics.strictCodeChangingNoop,
    nonBootstrapChangedPaths: missionSemantics.nonBootstrapChangedPaths,
    missionScopedChangedPaths: missionSemantics.missionScopedChangedPaths,
    scopeViolationPaths: missionSemantics.scopeViolationPaths,
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
      mission_scoped_changed_paths: missionSemantics.missionScopedChangedPaths,
      ignored_input_files: missionSemantics.ignoredInputFiles,
      allowed_paths: missionSemantics.allowedPaths,
      forbidden_paths: missionSemantics.forbiddenPaths,
      forbidden_changed_paths: missionSemantics.forbiddenChangedPaths,
      out_of_scope_changed_paths: missionSemantics.outOfScopeChangedPaths,
      scope_violation_paths: missionSemantics.scopeViolationPaths,
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
  const loadedArtifacts = listJsonFiles(options.init.runtimeLayout.reportsRoot)
    .filter((filePath) => path.basename(filePath).startsWith("step-result-"))
    .map((filePath) => {
      const loaded = loadContractFile({ filePath, family: "step-result" });
      if (!loaded.ok) return null;
      const document = asRecord(loaded.document);
      return document.run_id === options.runId
        ? {
            file: filePath,
            artifact_ref: toEvidenceRef(options.init.projectRoot, filePath),
            document,
          }
        : null;
    })
    .filter((entry) => entry !== null);
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
function loadRunQualityArtifacts(options) {
  const families = [
    /** @type {const} */ ("review-report"),
    /** @type {const} */ ("evaluation-report"),
    /** @type {const} */ ("learning-loop-scorecard"),
    /** @type {const} */ ("learning-loop-handoff"),
    /** @type {const} */ ("incident-report"),
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
 * @returns {"pass" | "retry" | "repair" | "escalate" | "block" | "fail"}
 */
function resolveOverallDecision(findings, stepDecisions) {
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
    const nonBootstrapChangedPaths = filterNonBootstrapChangedPaths(changedPaths);
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
    failureClass === "repo-scope-violation" ||
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
 * }} options
 */
export function materializeRuntimeHarnessReport(options) {
  const init = initializeProjectRuntime(options);
  const missionProfile = resolveRuntimeMissionProfile(init.projectRoot, init.runtimeLayout.artifactsRoot);
  const missionType = options.missionType ?? missionProfile.missionType;
  const strictnessProfile = options.strictnessProfile ?? missionProfile.strictnessProfile;
  const changedPathStatus = listChangedPaths(init.projectRoot);
  const nonBootstrapChangedPaths = filterNonBootstrapChangedPaths(changedPathStatus.changedPaths);
  const missionScope = loadMissionScope(init.projectRoot, init.runtimeLayout.artifactsRoot);
  const missionScopedChanges = resolveMissionScopedChanges(nonBootstrapChangedPaths, missionScope);
  const strictCodeChangingNoop = missionType === "code-changing" || missionType === "release";
  const missionSemantics = {
    gitStatusAvailable: changedPathStatus.available,
    changedPaths: changedPathStatus.changedPaths,
    nonBootstrapChangedPaths,
    nonInputChangedPaths: missionScopedChanges.nonInputChangedPaths,
    missionScopedChangedPaths: missionScopedChanges.missionScopedChangedPaths,
    ignoredInputFiles: missionScopedChanges.ignoredInputFiles,
    allowedPaths: missionScopedChanges.allowedPaths,
    forbiddenPaths: missionScopedChanges.forbiddenPaths,
    forbiddenChangedPaths: missionScopedChanges.forbiddenChangedPaths,
    outOfScopeChangedPaths: missionScopedChanges.outOfScopeChangedPaths,
    scopeViolationPaths: missionScopedChanges.scopeViolationPaths,
    strictCodeChangingNoop,
  };
  const stepArtifacts = loadRunStepArtifacts({ init, runId: options.runId });
  const qualityArtifacts = loadRunQualityArtifacts({ init, runId: options.runId });
  const deliveryArtifacts = loadRunDeliveryArtifacts({ init, runId: options.runId });
  const stepDecisions = stepArtifacts.map((artifact) =>
    buildStepDecision(artifact.document, artifact.artifact_ref, missionSemantics),
  );
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
        missionScopedChangedPaths: missionSemantics.missionScopedChangedPaths,
        scopeViolationPaths: missionSemantics.scopeViolationPaths,
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

  const report = {
    report_id: `${options.runId}.runtime-harness-report.v1`,
    project_id: init.projectId,
    run_id: options.runId,
    generated_at: new Date().toISOString(),
    mission_type: missionType,
    strictness_profile: strictnessProfile,
    overall_decision: resolveOverallDecision(runFindings, stepDecisions),
    step_decisions: stepDecisions,
    run_findings: runFindings,
    recommendations,
    impacted_asset_refs: impactedAssetRefs,
    promotion_recommendations: promotionRecommendations,
    unresolved_gaps: unresolvedGaps,
    evidence_refs: evidenceRefs,
  };

  const validation = validateContractDocument({
    family: "runtime-harness-report",
    document: report,
    source: "runtime://runtime-harness-report",
  });
  if (!validation.ok) {
    const issueSummary = validation.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Generated runtime harness report failed contract validation: ${issueSummary}`);
  }

  const reportPath = path.join(
    init.runtimeLayout.reportsRoot,
    `runtime-harness-report-${normalizeId(options.runId)}.json`,
  );
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  return {
    ...init,
    report,
    reportPath,
    reportRef: toEvidenceRef(init.projectRoot, reportPath),
  };
}
