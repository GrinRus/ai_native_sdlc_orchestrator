import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  createAdapterRequestEnvelope,
  resolveAdapterForRoute,
} from "../../adapter-sdk/src/index.mjs";
import { validateContractDocument } from "../../contracts/src/index.mjs";
import { resolveRouteForStep } from "../../provider-routing/src/route-resolution.mjs";

import { appendRunEvent } from "./control-plane/live-event-stream.mjs";
import { resolveAssetBundleForStep } from "./asset-loader.mjs";
import { compileStepContext } from "./context-compiler.mjs";
import { materializeDeliveryPlan } from "./delivery-plan.mjs";
import { initializeProjectRuntime, resolveProjectRegistryRoots } from "./project-init.mjs";
import { analyzeProjectRuntime } from "./project-analysis.mjs";
import {
  collectMissionChangeEvidence,
  filterNonBootstrapChangedPaths,
  filterRunnerOwnedStatePaths,
  listChangedPaths,
} from "./shared/mission-scope.mjs";
import {
  classifyRuntimeStepOutcome,
  materializeRuntimeHarnessReport,
  resolveRuntimeMissionProfile,
  synthesizeRepairAttempts,
} from "./runtime-harness-report.mjs";
import { mergeProviderStepStatus } from "./provider-step-status.mjs";
import { refreshRuntimeHarnessReportForStep } from "./runtime-harness-refresh.mjs";
import { invokeStepAdapterForStep } from "./step-adapter-invocation.mjs";
import { resolveStepPolicyForStep } from "./policy-resolution.mjs";
import { rewriteStepResult, writeStepResult } from "./step-result-writer.mjs";
import {
  evaluateRuntimePermissionRequest,
  normalizeRuntimeAgentAutoApprovalProfile,
  normalizeRuntimeAgentInteractionPolicy,
  writeRuntimePermissionDecisionAudit,
} from "./runtime-permission-policy.mjs";

const STEP_CLASS_TO_RESULT_CLASS = Object.freeze({
  discovery: "artifact",
  research: "artifact",
  spec: "artifact",
  planning: "planner",
  implement: "runner",
  review: "runner",
  qa: "runner",
  repair: "repair",
  eval: "eval",
  harness: "harness",
});
const STEP_ARCHITECTURE_DOC_REFS = Object.freeze([
  "docs/architecture/04-system-of-record-and-core-entities.md",
  "docs/architecture/12-orchestrator-operating-model.md",
  "docs/architecture/14-cli-command-catalog.md",
]);
const STEP_ARCHITECTURE_CONTRACT_REFS = Object.freeze([
  "docs/contracts/project-analysis-report.md",
  "docs/contracts/step-result.md",
  "docs/contracts/wave-ticket.md",
  "docs/contracts/handoff-packet.md",
]);
const DEFAULT_CONTEXT_BUDGET_LIMIT_TOKENS = 180_000;
const CONTEXT_BUDGET_WARN_RATIO = 0.8;
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
 * @returns {string | null}
 */
function asString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * @param {string} value
 * @returns {string}
 */
function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

/**
 * @param {unknown} value
 * @returns {{ bytes: number, chars: number, estimated_tokens: number }}
 */
function estimateContextValue(value) {
  const text = JSON.stringify(value ?? null);
  const chars = text.length;
  return {
    bytes: Buffer.byteLength(text, "utf8"),
    chars,
    estimated_tokens: Math.ceil(chars / 3),
  };
}

/**
 * @param {Array<{ source: string, value: unknown }>} sources
 * @returns {Array<{ source: string, bytes: number, chars: number, estimated_tokens: number }>}
 */
function buildContextSourceBreakdown(sources) {
  return sources.map((entry) => ({
    source: entry.source,
    ...estimateContextValue(entry.value),
  }));
}

/**
 * @param {Array<{ bytes: number, chars: number, estimated_tokens: number }>} entries
 * @returns {{ bytes: number, chars: number, estimated_tokens: number }}
 */
function sumContextEstimates(entries) {
  return entries.reduce(
    (acc, entry) => ({
      bytes: acc.bytes + entry.bytes,
      chars: acc.chars + entry.chars,
      estimated_tokens: acc.estimated_tokens + entry.estimated_tokens,
    }),
    { bytes: 0, chars: 0, estimated_tokens: 0 },
  );
}

/**
 * @param {number} estimatedTokens
 * @param {number} budgetLimitTokens
 * @returns {"pass" | "warn" | "fail"}
 */
function classifyContextBudgetStatus(estimatedTokens, budgetLimitTokens) {
  if (estimatedTokens > budgetLimitTokens) return "fail";
  if (estimatedTokens >= budgetLimitTokens * CONTEXT_BUDGET_WARN_RATIO) return "warn";
  return "pass";
}

/**
 * @param {Record<string, unknown>} adapterProfile
 * @returns {number}
 */
function resolveContextBudgetLimitTokens(adapterProfile) {
  const execution = asRecord(adapterProfile.execution);
  const externalRuntime = asRecord(execution.external_runtime);
  const contextBudget = asRecord(externalRuntime.context_budget);
  const value = contextBudget.max_input_tokens;
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : DEFAULT_CONTEXT_BUDGET_LIMIT_TOKENS;
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeRefSuffix(value) {
  return value.replace(/[^a-zA-Z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "");
}

/**
 * @param {string} packetRef
 * @returns {string | null}
 */
function packetNameFromRef(packetRef) {
  const match = /^packet:\/\/([^@\s/]+)(?:@[^\s]+)?$/u.exec(packetRef);
  return match ? match[1] : null;
}

const STEP_RESULT_FILE_REGEX = /^step-result-.*\.json$/u;

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function asRecord(value) {
  return typeof value === "object" && value !== null ? /** @type {Record<string, unknown>} */ (value) : {};
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
 * @param {string | null | undefined} filePath
 * @param {Record<string, unknown>} patch
 * @returns {Record<string, unknown> | null}
 */
function updateRunControlProviderStepStatus(filePath, patch) {
  if (typeof filePath !== "string" || filePath.trim().length === 0) return null;
  const stateFile = filePath.trim();
  const existingState = readJsonFile(stateFile) ?? {};
  const status = mergeProviderStepStatus(asRecord(existingState.provider_step_status), patch);
  const nextState = {
    ...existingState,
    provider_step_status: status,
    updated_at: status.updated_at,
  };
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, `${JSON.stringify(nextState, null, 2)}\n`, "utf8");
  return status;
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef?: string,
 *   projectProfile?: string,
 *   runtimeRoot?: string,
 *   runId: string,
 *   providerStepStatus: Record<string, unknown> | null | undefined,
 *   summary: string,
 * }} options
 */
function appendProviderHeartbeatEvent(options) {
  const providerStepStatus = asRecord(options.providerStepStatus);
  if (Object.keys(providerStepStatus).length === 0) return null;
  return appendRunEvent({
    cwd: options.cwd,
    projectRef: options.projectRef,
    projectProfile: options.projectProfile,
    runtimeRoot: options.runtimeRoot,
    runId: options.runId,
    eventType: "provider.heartbeat",
    payload: {
      step_id: asString(providerStepStatus.step_id),
      status: asString(providerStepStatus.status),
      summary: options.summary,
      provider_step_status: providerStepStatus,
    },
  });
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function uniqueStrings(value) {
  return [...new Set(asStringArray(value))];
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
 * @param {string[]} before
 * @param {string[]} after
 * @returns {string[]}
 */
function diffChangedPaths(before, after) {
  const beforeSet = new Set(before);
  return after.filter((changedPath) => !beforeSet.has(changedPath));
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
 * @param {string} projectRoot
 * @param {string} sourceRef
 * @returns {string}
 */
function normalizePacketSourceRef(projectRoot, sourceRef) {
  if (sourceRef.startsWith("packet://")) {
    return sourceRef;
  }
  if (path.isAbsolute(sourceRef)) {
    return toEvidenceRef(projectRoot, sourceRef);
  }
  return sourceRef;
}

/**
 * @param {string} projectRoot
 * @param {string} packetName
 * @param {string | null} sourceRef
 * @returns {string | null}
 */
function namedPacketRef(projectRoot, packetName, sourceRef) {
  if (!sourceRef) {
    return null;
  }
  const normalizedSourceRef = normalizePacketSourceRef(projectRoot, sourceRef);
  return packetNameFromRef(normalizedSourceRef) === packetName
    ? normalizedSourceRef
    : `packet://${packetName}@${normalizedSourceRef}`;
}

/**
 * Preserve the first ref for each packet name so concrete refs can override
 * generic bootstrap refs such as packet://handoff.
 *
 * @param {string[]} packetRefs
 * @returns {string[]}
 */
function uniquePacketRefsByName(packetRefs) {
  const seenPacketNames = new Set();
  const output = [];
  for (const packetRef of packetRefs) {
    const packetName = packetNameFromRef(packetRef);
    if (!packetName || seenPacketNames.has(packetName)) {
      continue;
    }
    seenPacketNames.add(packetName);
    output.push(packetRef);
  }
  return output;
}

/**
 * @param {{
 *   stepResultId: string,
 *   summary: string,
 *   evidenceRefs: string[],
 *   timestamp: string,
 * }}
 * @returns {Record<string, unknown>}
 */
function buildRequestedInteraction(options) {
  return {
    requested: true,
    interaction_id: `interaction.${normalizeRefSuffix(options.stepResultId) || "step"}.1`,
    status: "requested",
    prompt_summary: options.summary,
    question_evidence_refs: options.evidenceRefs,
    evidence_refs: options.evidenceRefs,
    answer_audit_refs: [],
    continuation: {
      next_action: "resume_from_boundary",
      reason_code: "operator-answer-required",
    },
    state_history: [
      {
        status: "requested",
        timestamp: options.timestamp,
        summary: options.summary,
        evidence_refs: options.evidenceRefs,
        continuation: {
          next_action: "resume_from_boundary",
          reason_code: "operator-answer-required",
        },
      },
    ],
  };
}

/**
 * @param {{
 *   stepResultId: string,
 *   summary: string,
 *   evidenceRefs: string[],
 *   timestamp: string,
 *   runtimePermissionRequest: Record<string, unknown>,
 *   runtimePermissionDecision: Record<string, unknown>,
 * }}
 * @returns {Record<string, unknown>}
 */
function buildRuntimePermissionRequestedInteraction(options) {
  return {
    ...buildRequestedInteraction({
      stepResultId: options.stepResultId,
      summary: options.summary,
      evidenceRefs: options.evidenceRefs,
      timestamp: options.timestamp,
    }),
    interaction_type: "permission_request",
    runtime_permission_request: options.runtimePermissionRequest,
    runtime_permission_decision: options.runtimePermissionDecision,
    allowed_decisions: ["approve_once", "deny", "approve_for_run"],
  };
}

/**
 * @param {{
 *   stepResultId: string,
 *   summary: string,
 *   evidenceRefs: string[],
 *   adapterOutput: Record<string, unknown>,
 *   adapterResolution: Record<string, unknown> | null,
 * }}
 * @returns {Record<string, unknown>}
 */
function resolveRuntimePermissionRequest(options) {
  const existing = asRecord(options.adapterOutput.runtime_permission_request);
  if (Object.keys(existing).length > 0) {
    return existing;
  }
  const adapter = asRecord(asRecord(options.adapterResolution).adapter);
  const profile = asRecord(adapter.profile);
  const externalRunner = asRecord(options.adapterOutput.external_runner);
  return {
    interaction_type: "permission_request",
    adapter_id: asString(adapter.adapter_id) ?? asString(options.adapterOutput.provider_adapter) ?? "unknown",
    runner_family: asString(profile.runner_family) ?? null,
    permission_mode: asString(externalRunner.permission_mode) ?? null,
    permission_mode_source: asString(externalRunner.permission_mode_source) ?? null,
    operation_type: "unknown",
    tool_name: null,
    target: null,
    target_path: null,
    command: null,
    confidence: "low",
    summary: options.summary,
    evidence_refs: options.evidenceRefs,
  };
}

/**
 * @param {Record<string, unknown> | null} adapterResolution
 * @returns {Record<string, unknown>}
 */
function resolveApprovalFeatures(adapterResolution) {
  const adapter = asRecord(asRecord(adapterResolution).adapter);
  const profile = asRecord(adapter.profile);
  return asRecord(profile.approval_features);
}

/**
 * @param {string | null} value
 * @returns {string}
 */
function normalizePermissionComparable(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/gu, " ") : "";
}

/**
 * @param {Record<string, unknown>} request
 * @returns {{ adapterId: string, operationType: string, target: string, command: string, toolName: string }}
 */
function runtimePermissionSignature(request) {
  return {
    adapterId: normalizePermissionComparable(asString(request.adapter_id)),
    operationType: normalizePermissionComparable(asString(request.operation_type)),
    target: normalizePermissionComparable(asString(request.target) ?? asString(request.target_path)),
    command: normalizePermissionComparable(asString(request.command)),
    toolName: normalizePermissionComparable(asString(request.tool_name)),
  };
}

/**
 * @param {Record<string, unknown>} request
 * @param {Record<string, unknown>} grantRequest
 * @returns {boolean}
 */
function runtimePermissionGrantMatches(request, grantRequest) {
  const current = runtimePermissionSignature(request);
  const granted = runtimePermissionSignature(grantRequest);
  if (current.adapterId && granted.adapterId && current.adapterId !== granted.adapterId) {
    return false;
  }
  if (!current.operationType || !granted.operationType || current.operationType !== granted.operationType) {
    return false;
  }
  if (current.target || granted.target) {
    return current.target !== "" && current.target === granted.target;
  }
  if (current.command || granted.command) {
    return current.command !== "" && current.command === granted.command;
  }
  return current.toolName !== "" && current.toolName === granted.toolName;
}

/**
 * @param {{ runtimeLayout: { reportsRoot: string }, projectRoot: string, runId: string, runtimePermissionRequest: Record<string, unknown> }} options
 * @returns {{ grantRef: string, grantDecision: Record<string, unknown> } | null}
 */
function resolveRunScopedRuntimePermissionGrant(options) {
  if (!fs.existsSync(options.runtimeLayout.reportsRoot)) {
    return null;
  }
  const entries = fs.readdirSync(options.runtimeLayout.reportsRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }
    const filePath = path.join(options.runtimeLayout.reportsRoot, entry.name);
    let document;
    try {
      document = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
      continue;
    }
    const record = asRecord(document);
    if (asString(record.run_id) !== options.runId) {
      continue;
    }
    const requestedInteraction = asRecord(record.requested_interaction);
    const grantDecision = asRecord(record.runtime_permission_decision ?? requestedInteraction.runtime_permission_decision);
    if (
      asString(grantDecision.decision) !== "user_approved" ||
      asString(grantDecision.operator_decision) !== "approve_for_run"
    ) {
      continue;
    }
    const grantRequest = asRecord(record.runtime_permission_request ?? requestedInteraction.runtime_permission_request);
    if (!runtimePermissionGrantMatches(options.runtimePermissionRequest, grantRequest)) {
      continue;
    }
    return {
      grantRef: asString(grantDecision.audit_ref) ?? toEvidenceRef(options.projectRoot, filePath),
      grantDecision,
    };
  }
  return null;
}

/**
 * @param {{
 *   runtimeLayout: { reportsRoot: string },
 *   projectRoot: string,
 *   runId: string,
 *   runtimePermissionRequest: Record<string, unknown>,
 *   runtimePermissionDecision: Record<string, unknown>,
 * }}
 * @returns {Record<string, unknown>}
 */
function applyRunScopedRuntimePermissionGrant(options) {
  if (asString(options.runtimePermissionDecision.decision) !== "ask_user") {
    return options.runtimePermissionDecision;
  }
  const grant = resolveRunScopedRuntimePermissionGrant({
    runtimeLayout: options.runtimeLayout,
    projectRoot: options.projectRoot,
    runId: options.runId,
    runtimePermissionRequest: options.runtimePermissionRequest,
  });
  if (!grant) {
    return options.runtimePermissionDecision;
  }
  return {
    ...options.runtimePermissionDecision,
    decision: "auto_approve",
    rule_id: "runtime-permission.auto-approve.approve-for-run-grant",
    reason: "Matching run-scoped operator approval grant was found for this permission request.",
    approval_scope: asString(grant.grantDecision.approval_scope) ?? asString(options.runtimePermissionDecision.approval_scope) ?? "step-coarse",
    approval_resume_mode:
      asString(grant.grantDecision.approval_resume_mode) ??
      asString(options.runtimePermissionDecision.approval_resume_mode) ??
      "full-bypass",
    grant_ref: grant.grantRef,
  };
}

/**
 * @param {string} projectId
 * @param {string} runId
 * @param {string} stepId
 * @param {string} stepClass
 * @param {string} promptBundleRef
 * @param {number} attempt
 * @returns {string}
 */
function buildCompiledContextId(projectId, runId, stepId, stepClass, promptBundleRef, attempt) {
  const promptMatch = /^prompt-bundle:\/\/([^@]+)@v\d+$/u.exec(promptBundleRef);
  const promptSuffix = normalizeRefSuffix(promptMatch?.[1] ?? promptBundleRef);
  const runSuffix = normalizeRefSuffix(runId) || "run";
  const stepSuffix = normalizeRefSuffix(stepId) || "step";
  const classSuffix = normalizeRefSuffix(stepClass) || "step";
  return `compiled-context.${projectId}.${runSuffix}.${stepSuffix}.${classSuffix}.attempt.${attempt}.${promptSuffix || "default"}`;
}

/**
 * @param {{
 *   runtimeLayout: { reportsRoot: string },
 *   compiledContextArtifact: Record<string, unknown>,
 *   artifactFileName: string,
 * }} options
 */
function writeCompiledContextArtifact(options) {
  const validation = validateContractDocument({
    family: "compiled-context-artifact",
    document: options.compiledContextArtifact,
    source: "runtime://compiled-context-artifact",
  });
  if (!validation.ok) {
    const messages = validation.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Compiled-context artifact failed contract validation: ${messages}`);
  }

  const artifactPath = path.join(options.runtimeLayout.reportsRoot, options.artifactFileName);
  fs.writeFileSync(artifactPath, `${JSON.stringify(options.compiledContextArtifact, null, 2)}\n`, "utf8");
  return artifactPath;
}

/**
 * @param {{ reportsRoot: string }} runtimeLayout
 * @returns {Record<string, unknown> | null}
 */
function readLatestAnalysisFeatureTraceability(runtimeLayout) {
  const reportPath = path.join(runtimeLayout.reportsRoot, "project-analysis-report.json");
  if (!fs.existsSync(reportPath)) {
    return null;
  }
  try {
    const report = /** @type {Record<string, unknown>} */ (JSON.parse(fs.readFileSync(reportPath, "utf8")));
    const featureTraceability = asRecord(report.feature_traceability);
    return Object.keys(featureTraceability).length > 0 ? featureTraceability : null;
  } catch {
    return null;
  }
}

/**
 * @param {unknown} handoffRef
 * @returns {Record<string, unknown> | null}
 */
function readHandoffFeatureTraceability(handoffRef) {
  const handoffPath = asString(handoffRef);
  if (!handoffPath || !path.isAbsolute(handoffPath) || !fs.existsSync(handoffPath)) {
    return null;
  }
  try {
    const document = /** @type {Record<string, unknown>} */ (JSON.parse(fs.readFileSync(handoffPath, "utf8")));
    const featureTraceability = asRecord(document.feature_traceability);
    const repoScopePaths = Array.isArray(document.repo_scopes)
      ? document.repo_scopes.flatMap((scope) => asStringArray(asRecord(scope).paths))
      : [];
    return mergeFeatureTraceabilityRecords(
      featureTraceability,
      {
        allowed_paths: uniqueStrings([...asStringArray(document.allowed_paths), ...repoScopePaths]),
      },
    );
  } catch {
    return null;
  }
}

/**
 * @param {...(Record<string, unknown> | null | undefined)} records
 * @returns {Record<string, unknown> | null}
 */
function mergeFeatureTraceabilityRecords(...records) {
  /** @type {Record<string, unknown>} */
  const merged = {};
  for (const record of records) {
    const source = asRecord(record);
    for (const [key, value] of Object.entries(source)) {
      if (Array.isArray(value)) {
        merged[key] = uniqueStrings([...asStringArray(merged[key]), ...asStringArray(value)]);
        continue;
      }
      if (Object.prototype.hasOwnProperty.call(merged, key)) {
        continue;
      }
      if (value !== null && value !== undefined) {
        merged[key] = value;
      }
    }
  }
  return Object.keys(merged).length > 0 ? merged : null;
}

/**
 * @param {{
 *   reportsRoot: string,
 *   runId: string,
 *   stepId: string,
 *   stepClass: string,
 * }} options
 * @returns {number}
 */
function resolveStepExecutionAttempt(options) {
  if (!fs.existsSync(options.reportsRoot)) {
    return 1;
  }

  const reportFiles = fs.readdirSync(options.reportsRoot).filter((entry) => STEP_RESULT_FILE_REGEX.test(entry));
  let highestAttempt = 0;

  for (const reportFile of reportFiles) {
    const reportPath = path.join(options.reportsRoot, reportFile);
    /** @type {Record<string, unknown>} */
    let stepResultDoc;
    try {
      const raw = fs.readFileSync(reportPath, "utf8");
      const parsed = JSON.parse(raw);
      stepResultDoc = asRecord(parsed);
    } catch {
      continue;
    }

    if (stepResultDoc.run_id !== options.runId || stepResultDoc.step_id !== options.stepId) {
      continue;
    }

    const selectedStep = asRecord(asRecord(asRecord(stepResultDoc.routed_execution).architecture_traceability).selected_step);
    if (typeof selectedStep.step_class === "string" && selectedStep.step_class !== options.stepClass) {
      continue;
    }

    let detectedAttempt = 1;
    if (typeof stepResultDoc.step_result_id === "string") {
      const explicitAttempt = /\.attempt\.(\d+)$/u.exec(stepResultDoc.step_result_id);
      if (explicitAttempt) {
        const parsedAttempt = Number.parseInt(explicitAttempt[1], 10);
        if (Number.isFinite(parsedAttempt) && parsedAttempt > 0) {
          detectedAttempt = parsedAttempt;
        }
      }
    }

    if (detectedAttempt > highestAttempt) {
      highestAttempt = detectedAttempt;
    }
  }

  return highestAttempt + 1;
}

/**
 * @param {Record<string, unknown>} assetResolution
 * @returns {string[]}
 */
function resolveSyntheticPacketRefs(assetResolution) {
  const promptBundle = asRecord(assetResolution.prompt_bundle);
  const promptProfile = asRecord(promptBundle.profile);
  const requiredInputs = asRecord(promptProfile.required_inputs);
  const packets = asRecord(requiredInputs.packets);
  return uniqueStrings(packets.required).map((packetName) => `packet://${packetName}`);
}

/**
 * @param {{
 *   projectRoot: string,
 *   assetResolution: Record<string, unknown>,
 *   approvedHandoffRef?: string | null,
 *   promotionEvidenceRefs?: string[],
 *   runtimeEvidenceRefs?: string[],
 * }} options
 * @returns {string[]}
 */
function resolveStepInputPacketRefs(options) {
  const concreteHandoffRef = namedPacketRef(
    options.projectRoot,
    "handoff",
    asString(options.approvedHandoffRef),
  );
  const packetEvidenceRefs = uniqueStrings([
    ...asStringArray(options.promotionEvidenceRefs),
    ...asStringArray(options.runtimeEvidenceRefs),
  ]).filter((entry) => packetNameFromRef(entry));

  return uniquePacketRefsByName([
    ...(concreteHandoffRef ? [concreteHandoffRef] : []),
    ...packetEvidenceRefs,
    ...resolveSyntheticPacketRefs(options.assetResolution),
  ]);
}

/**
 * @param {Record<string, unknown>} stepResult
 * @returns {"pass" | "retry" | "repair" | "escalate" | "block" | "fail"}
 */
function resolveRuntimeHarnessDecision(stepResult) {
  const decision = asString(stepResult.runtime_harness_decision);
  if (
    decision === "pass" ||
    decision === "retry" ||
    decision === "repair" ||
    decision === "escalate" ||
    decision === "block" ||
    decision === "fail"
  ) {
    return decision;
  }
  return asString(stepResult.status) === "passed" ? "pass" : "repair";
}

/**
 * @param {Record<string, unknown>} stepResult
 * @param {"retry" | "repair" | "escalate"} action
 * @returns {number}
 */
function resolveActionBudget(stepResult, action) {
  const pendingAttempt = asRecordArray(stepResult.repair_attempts).find(
    (attempt) => asString(attempt.policy_action) === action || asString(attempt.runtime_harness_decision) === action,
  );
  const policyBudget = asRecord(pendingAttempt?.policy_budget);
  const maxAttempts = typeof policyBudget.max_attempts === "number" && Number.isFinite(policyBudget.max_attempts)
    ? Math.max(0, Math.floor(policyBudget.max_attempts))
    : null;
  if (maxAttempts !== null) {
    return maxAttempts;
  }
  return action === "escalate" ? 0 : 1;
}

/**
 * @param {Record<string, unknown>} stepResult
 * @returns {string | null}
 */
function resolveApprovalResumeMode(stepResult) {
  const decision = asRecord(stepResult.runtime_permission_decision);
  if (asString(decision.decision) !== "auto_approve" && asString(decision.decision) !== "user_approved") {
    return null;
  }
  return asString(decision.approval_resume_mode);
}

/**
 * @param {string | null} mode
 * @param {() => ReturnType<typeof executeRoutedStep>} callback
 * @returns {ReturnType<typeof executeRoutedStep>}
 */
function runWithRuntimePermissionMode(mode, callback) {
  if (!mode) {
    return callback();
  }
  const previous = process.env.AOR_RUNTIME_AGENT_PERMISSION_MODE;
  process.env.AOR_RUNTIME_AGENT_PERMISSION_MODE = mode;
  try {
    return callback();
  } finally {
    if (previous === undefined) {
      delete process.env.AOR_RUNTIME_AGENT_PERMISSION_MODE;
    } else {
      process.env.AOR_RUNTIME_AGENT_PERMISSION_MODE = previous;
    }
  }
}

/**
 * @param {ReturnType<typeof executeRoutedStep>} result
 * @param {Array<Record<string, unknown>>} attempts
 * @param {"pending" | "not_required" | "succeeded_after_retry" | "succeeded_after_repair" | "exhausted" | "blocked"} status
 */
function persistRuntimeHarnessAttemptLedger(result, attempts, status) {
  result.stepResult.repair_attempts = attempts;
  result.stepResult.repair_status = status;
  rewriteStepResult({
    runtimeLayout: result.runtimeLayout,
    stepResultPath: result.stepResultPath,
    stepResult: result.stepResult,
  });
}

/**
 * @param {{
 *   result: ReturnType<typeof executeRoutedStep>,
 *   attempts: Array<Record<string, unknown>>,
 *   action: "retry" | "repair",
 *   exhausted: boolean,
 * }} options
 */
function persistExhaustedRuntimeDecision(options) {
  const finalDecision = options.exhausted ? "block" : "escalate";
  const attempts = options.attempts.map((attempt, index) =>
    options.exhausted && index === options.attempts.length - 1
      ? {
          ...attempt,
          status: "exhausted",
          result: "exhausted",
          exhausted_budget: true,
        }
      : attempt,
  );
  options.result.stepResult.status = "failed";
  options.result.stepResult.mission_outcome = "not_satisfied";
  options.result.stepResult.runtime_harness_decision = finalDecision;
  options.result.stepResult.repair_status = options.exhausted ? "exhausted" : "blocked";
  options.result.stepResult.summary = `Runtime Harness ${options.action} budget exhausted for failure class '${asString(options.result.stepResult.failure_class) ?? "unknown"}'.`;
  const routedExecution = asRecord(options.result.stepResult.routed_execution);
  routedExecution.blocked_next_step =
    "Inspect Runtime Harness repair ledger and address unresolved failure evidence before continuing delivery.";
  options.result.stepResult.routed_execution = routedExecution;
  options.result.stepResult.repair_attempts = attempts;
  rewriteStepResult({
    runtimeLayout: options.result.runtimeLayout,
    stepResultPath: options.result.stepResultPath,
    stepResult: options.result.stepResult,
  });
}

/**
 * @param {{
 *   result: ReturnType<typeof executeRoutedStep>,
 *   attempt: number,
 *   inputEvidenceRefs: string[],
 * }} options
 * @returns {{ repairInputFile: string, repairInputRef: string }}
 */
function writeRuntimeRepairInput(options) {
  const runtimeHarness = materializeRuntimeHarnessReport({
    projectRef: options.result.projectRoot,
    cwd: options.result.projectRoot,
    runtimeRoot: options.result.runtimeRoot,
    runId: options.result.runId,
  });
  const routedExecution = asRecord(options.result.stepResult.routed_execution);
  const adapterResponse = asRecord(routedExecution.adapter_response);
  const adapterOutput = asRecord(adapterResponse.output);
  const repairInputFile = path.join(
    options.result.runtimeLayout.reportsRoot,
    `runtime-harness-repair-input-${normalizeRefSuffix(options.result.runId)}-${normalizeRefSuffix(options.result.stepId)}-attempt-${options.attempt}.json`,
  );
  const repairInput = {
    repair_input_id: `${options.result.runId}.${options.result.stepId}.repair-input.${options.attempt}`,
    run_id: options.result.runId,
    failed_step_id: options.result.stepId,
    failed_step_result_ref: toEvidenceRef(options.result.projectRoot, options.result.stepResultPath),
    failed_step_result_file: options.result.stepResultPath,
    attempt: options.attempt,
    created_at: new Date().toISOString(),
    previous_findings: [
      {
        failure_class: asString(options.result.stepResult.failure_class) ?? "unknown",
        runtime_harness_decision: asString(options.result.stepResult.runtime_harness_decision) ?? "unknown",
        mission_outcome: asString(options.result.stepResult.mission_outcome) ?? "unknown",
        summary: asString(options.result.stepResult.summary) ?? "Runtime Harness repair trigger.",
      },
    ],
    failed_transcript_refs: uniqueStrings([
      asString(asRecord(adapterOutput.external_runner).raw_evidence_ref) ?? "",
      ...asStringArray(adapterResponse.evidence_refs),
      ...asStringArray(options.result.stepResult.evidence_refs),
    ]),
    diff_status: asRecord(options.result.stepResult.mission_semantics),
    adapter_evidence: {
      status: asString(adapterResponse.status),
      failure_kind: asString(adapterOutput.failure_kind),
      summary: asString(adapterResponse.summary),
      evidence_refs: asStringArray(adapterResponse.evidence_refs),
      tool_traces: Array.isArray(adapterResponse.tool_traces) ? adapterResponse.tool_traces : [],
      output: adapterOutput,
    },
    validator_findings: {
      discovery_completeness_gate: asRecord(routedExecution.discovery_completeness_gate),
      verification: asRecord(options.result.stepResult.verification),
    },
    runtime_harness_report_ref: runtimeHarness.reportRef,
    runtime_harness_report_file: runtimeHarness.reportPath,
    runtime_findings: Array.isArray(runtimeHarness.report.run_findings) ? runtimeHarness.report.run_findings : [],
    input_evidence_refs: uniqueStrings(options.inputEvidenceRefs),
  };
  fs.writeFileSync(repairInputFile, `${JSON.stringify(repairInput, null, 2)}\n`, "utf8");
  return {
    repairInputFile,
    repairInputRef: toEvidenceRef(options.result.projectRoot, repairInputFile),
  };
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef?: string,
 *   projectProfile?: string,
 *   runtimeRoot?: string,
 *   stepClass: string,
 *   dryRun?: boolean,
 *   runId?: string,
 *   stepId?: string,
 *   routeOverrides?: Record<string, string>,
 *   wrapperOverrides?: Record<string, string>,
 *   promptBundleOverrides?: Record<string, string>,
 *   contextBundleOverrides?: Record<string, string[]>,
 *   policyOverrides?: Record<string, string>,
 *   adapterOverrides?: Record<string, string>,
 *   routesRoot?: string,
 *   wrappersRoot?: string,
 *   promptsRoot?: string,
 *   contextBundlesRoot?: string,
 *   policiesRoot?: string,
 *   adaptersRoot?: string,
 *   skillsRoot?: string,
 *   executionRoot?: string,
 *   requireDiscoveryCompleteness?: boolean,
 *   approvedHandoffRef?: string,
 *   promotionEvidenceRefs?: string[],
 *   coordinationEvidenceRefs?: string[],
 *   runtimeEvidenceRefs?: string[],
 *   operatorRequestRef?: string,
 *   providerStepStatusStateFile?: string,
 * }} options
 */
export function executeRoutedStep(options) {
  const init = initializeProjectRuntime(options);
  const registryRoots =
    typeof init.registryRoots === "object" && init.registryRoots !== null
      ? /** @type {Record<string, string>} */ (init.registryRoots)
      : resolveProjectRegistryRoots({}, { projectRoot: init.projectRoot }).roots;

  const routesRoot = options.routesRoot
    ? path.isAbsolute(options.routesRoot)
      ? options.routesRoot
      : path.resolve(init.projectRoot, options.routesRoot)
    : registryRoots.routes;
  const wrappersRoot = options.wrappersRoot
    ? path.isAbsolute(options.wrappersRoot)
      ? options.wrappersRoot
      : path.resolve(init.projectRoot, options.wrappersRoot)
    : registryRoots.wrappers;
  const promptsRoot = options.promptsRoot
    ? path.isAbsolute(options.promptsRoot)
      ? options.promptsRoot
      : path.resolve(init.projectRoot, options.promptsRoot)
    : registryRoots.prompts;
  const contextBundlesRoot = options.contextBundlesRoot
    ? path.isAbsolute(options.contextBundlesRoot)
      ? options.contextBundlesRoot
      : path.resolve(init.projectRoot, options.contextBundlesRoot)
    : registryRoots.context_bundles;
  const policiesRoot = options.policiesRoot
    ? path.isAbsolute(options.policiesRoot)
      ? options.policiesRoot
      : path.resolve(init.projectRoot, options.policiesRoot)
    : registryRoots.policies;
  const adaptersRoot = options.adaptersRoot
    ? path.isAbsolute(options.adaptersRoot)
      ? options.adaptersRoot
      : path.resolve(init.projectRoot, options.adaptersRoot)
    : registryRoots.adapters;
  const skillsRoot = options.skillsRoot
    ? path.isAbsolute(options.skillsRoot)
      ? options.skillsRoot
      : path.resolve(init.projectRoot, options.skillsRoot)
    : registryRoots.skills;
  const executionRoot = options.executionRoot
    ? path.isAbsolute(options.executionRoot)
      ? options.executionRoot
      : path.resolve(init.projectRoot, options.executionRoot)
    : init.projectRoot;
  const changedPathStatusBefore = listChangedPaths(executionRoot);

  const requestedStepClass = options.stepClass;
  const resultStepClass = STEP_CLASS_TO_RESULT_CLASS[requestedStepClass] ?? "runner";
  const runId = options.runId ?? `${init.projectId}.routed-execution.v1`;
  const stepId = options.stepId ?? `routed.${requestedStepClass}`;
  const executionAttempt = resolveStepExecutionAttempt({
    reportsRoot: init.runtimeLayout.reportsRoot,
    runId,
    stepId,
    stepClass: requestedStepClass,
  });
  const stepResultIdBase = `${runId}.step.${requestedStepClass}`;
  const stepResultId = executionAttempt > 1 ? `${stepResultIdBase}.attempt.${executionAttempt}` : stepResultIdBase;
  const runScopeSuffix = normalizeRefSuffix(runId) || "run";
  const stepScopeSuffix = normalizeRefSuffix(stepId) || "step";
  const classScopeSuffix = normalizeRefSuffix(requestedStepClass) || "step";
  const scopedArtifactSuffix = `${runScopeSuffix}.${stepScopeSuffix}.${classScopeSuffix}.attempt.${executionAttempt}`;
  const stepResultFileName = `step-result-routed-${scopedArtifactSuffix}.json`;
  const compiledContextFileName = `compiled-context-${scopedArtifactSuffix}.json`;
  const dryRun = options.dryRun !== false;

  const startedAt = new Date().toISOString();

  /** @type {Record<string, unknown> | null} */
  let routeResolution = null;
  /** @type {Record<string, unknown> | null} */
  let assetResolution = null;
  /** @type {Record<string, unknown> | null} */
  let policyResolution = null;
  /** @type {Record<string, unknown> | null} */
  let adapterResolution = null;
  /** @type {{ deliveryPlan: Record<string, unknown>, deliveryPlanFile: string } | null} */
  let deliveryPlanResult = null;
  /** @type {Record<string, unknown> | null} */
  let adapterRequest = null;
  /** @type {Record<string, unknown> | null} */
  let adapterResponse = null;
  /** @type {Record<string, unknown> | null} */
  let compiledContextArtifact = null;
  /** @type {Record<string, unknown> | null} */
  let contextCompilation = null;
  /** @type {Record<string, unknown> | null} */
  let featureTraceability = null;
  /** @type {string | null} */
  let compiledContextRef = null;
  /** @type {string | null} */
  let compiledContextArtifactPath = null;
  /** @type {string[]} */
  let evidenceRefs = uniqueStrings([
    init.projectProfilePath,
    ...asStringArray(options.runtimeEvidenceRefs),
    ...asStringArray(options.promotionEvidenceRefs),
  ]);
  /** @type {"passed" | "failed"} */
  let status = "passed";
  let summary = dryRun
    ? `Routed step '${requestedStepClass}' completed in dry-run mode.`
    : `Routed live execution for step '${requestedStepClass}' completed.`;
  /** @type {string | null} */
  let blockedNextStep = null;
  /** @type {{
   *   status: "pass" | "fail",
   *   blocking: boolean,
   *   analysis_report_id: string,
   *   analysis_report_file: string,
   *   checks: Array<{ check_id: string, status: "pass" | "fail", blocking: boolean, summary: string, expected: unknown, actual: unknown }>,
   * } | null} */
  let discoveryCompletenessGate = null;
  /** @type {Record<string, unknown> | null} */
  let discoveryResearchGate = null;
  /** @type {{
   *   architecture_doc_refs: string[],
   *   contract_refs: string[],
   *   planning_artifact_families: string[],
   *   step_linkage: Array<{ step_class: string, route_id: string | null, wrapper_ref: string | null, prompt_bundle_ref: string | null, policy_id: string | null }>,
   *   evaluation_refs: { suite_refs: string[], dataset_refs: string[] },
   * } | null} */
  let discoveryArchitectureTraceability = null;

  if (requestedStepClass === "spec" && options.requireDiscoveryCompleteness !== false) {
    const discoveryResult = analyzeProjectRuntime({
      cwd: options.cwd,
      projectRef: options.projectRef,
      projectProfile: options.projectProfile,
      runtimeRoot: options.runtimeRoot,
      routeOverrides: options.routeOverrides,
      policyOverrides: options.policyOverrides,
      adapterOverrides: options.adapterOverrides,
      routesRoot: options.routesRoot,
      wrappersRoot: options.wrappersRoot,
      promptsRoot: options.promptsRoot,
      policiesRoot: options.policiesRoot,
      adaptersRoot: options.adaptersRoot,
    });
    const completeness = discoveryResult.report.discovery_completeness;
    const architectureTraceability = discoveryResult.report.architecture_traceability;
    const discoveryResearch = asRecord(discoveryResult.report.discovery_research);

    if (
      typeof completeness !== "object" ||
      completeness === null ||
      !Array.isArray(completeness.checks) ||
      typeof completeness.status !== "string"
    ) {
      throw new Error(
        "Project analysis report is missing discovery_completeness; run 'aor discovery run' to regenerate analysis outputs.",
      );
    }

    discoveryCompletenessGate = {
      status: completeness.status === "pass" ? "pass" : "fail",
      blocking: Boolean(completeness.blocking),
      analysis_report_id: discoveryResult.report.report_id,
      analysis_report_file: discoveryResult.reportPath,
      checks: completeness.checks
        .filter((check) => typeof check === "object" && check !== null)
        .map((check) => ({
          check_id: typeof check.check_id === "string" ? check.check_id : "unknown",
          status: check.status === "pass" ? "pass" : "fail",
          blocking: Boolean(check.blocking),
          summary: typeof check.summary === "string" ? check.summary : "Discovery completeness check",
          expected: Object.prototype.hasOwnProperty.call(check, "expected") ? check.expected : null,
          actual: Object.prototype.hasOwnProperty.call(check, "actual") ? check.actual : null,
        })),
    };
    discoveryResearchGate = {
      report_id: typeof discoveryResearch.report_id === "string" ? discoveryResearch.report_id : null,
      report_ref: typeof discoveryResearch.report_ref === "string" ? discoveryResearch.report_ref : null,
      status: typeof discoveryResearch.status === "string" ? discoveryResearch.status : "incomplete",
      adr_ready: discoveryResearch.adr_ready === true,
      blocking: Boolean(discoveryResearch.blocking),
      open_questions: Array.isArray(discoveryResearch.open_questions) ? discoveryResearch.open_questions : [],
      checks: Array.isArray(discoveryResearch.checks) ? discoveryResearch.checks : [],
    };
    if (typeof architectureTraceability === "object" && architectureTraceability !== null) {
      discoveryArchitectureTraceability = {
        architecture_doc_refs: Array.isArray(architectureTraceability.architecture_doc_refs)
          ? architectureTraceability.architecture_doc_refs.filter((entry) => typeof entry === "string")
          : [],
        contract_refs: Array.isArray(architectureTraceability.contract_refs)
          ? architectureTraceability.contract_refs.filter((entry) => typeof entry === "string")
          : [],
        planning_artifact_families: Array.isArray(architectureTraceability.planning_artifact_families)
          ? architectureTraceability.planning_artifact_families.filter((entry) => typeof entry === "string")
          : [],
        step_linkage: Array.isArray(architectureTraceability.step_linkage)
          ? architectureTraceability.step_linkage
              .filter((entry) => typeof entry === "object" && entry !== null)
              .map((entry) => ({
                step_class: typeof entry.step_class === "string" ? entry.step_class : "unknown",
                route_id: typeof entry.route_id === "string" ? entry.route_id : null,
                wrapper_ref: typeof entry.wrapper_ref === "string" ? entry.wrapper_ref : null,
                prompt_bundle_ref: typeof entry.prompt_bundle_ref === "string" ? entry.prompt_bundle_ref : null,
                policy_id: typeof entry.policy_id === "string" ? entry.policy_id : null,
              }))
          : [],
        evaluation_refs:
          typeof architectureTraceability.evaluation_refs === "object" && architectureTraceability.evaluation_refs
            ? {
                suite_refs: Array.isArray(architectureTraceability.evaluation_refs.suite_refs)
                  ? architectureTraceability.evaluation_refs.suite_refs.filter((entry) => typeof entry === "string")
                  : [],
                dataset_refs: Array.isArray(architectureTraceability.evaluation_refs.dataset_refs)
                  ? architectureTraceability.evaluation_refs.dataset_refs.filter((entry) => typeof entry === "string")
                  : [],
              }
            : { suite_refs: [], dataset_refs: [] },
      };
    }

    if (discoveryCompletenessGate.blocking) {
      status = "failed";
      summary =
        "Spec build blocked by discovery completeness checks. Run 'aor discovery run' and resolve failed checks before planning handoff.";
      blockedNextStep = "Re-run discovery and close failing completeness checks before executing spec build.";
      evidenceRefs = uniqueStrings([
        init.projectProfilePath,
        discoveryResult.reportPath,
        ...asStringArray(options.runtimeEvidenceRefs),
        ...asStringArray(options.promotionEvidenceRefs),
      ]);
    }
    featureTraceability = asRecord(discoveryResult.report.feature_traceability);
  }

  if (!discoveryCompletenessGate?.blocking) {
    try {
      routeResolution = resolveRouteForStep({
        projectProfilePath: init.projectProfilePath,
        routesRoot,
        stepClass: requestedStepClass,
        stepOverrides: options.routeOverrides,
      });

      assetResolution = resolveAssetBundleForStep({
        projectProfilePath: init.projectProfilePath,
        routesRoot,
        wrappersRoot,
        promptsRoot,
        contextBundlesRoot,
        stepClass: requestedStepClass,
        routeOverrides: options.routeOverrides,
        wrapperOverrides: options.wrapperOverrides,
        promptBundleOverrides: options.promptBundleOverrides,
        contextBundleOverrides: options.contextBundleOverrides,
      });

      policyResolution = resolveStepPolicyForStep({
        projectProfilePath: init.projectProfilePath,
        routesRoot,
        policiesRoot,
        stepClass: requestedStepClass,
        routeOverrides: options.routeOverrides,
        policyOverrides: options.policyOverrides,
      });
      const approvedHandoffRef = asString(options.approvedHandoffRef);
      featureTraceability = mergeFeatureTraceabilityRecords(
        featureTraceability,
        readLatestAnalysisFeatureTraceability(init.runtimeLayout),
        readHandoffFeatureTraceability(approvedHandoffRef),
      );
      deliveryPlanResult = materializeDeliveryPlan({
        runtimeLayout: init.runtimeLayout,
        projectId: init.projectId,
        runId,
        stepClass: requestedStepClass,
        policyResolution: /** @type {Record<string, unknown>} */ (policyResolution),
        handoffApproval: approvedHandoffRef
          ? {
              status: "pass",
              ref: approvedHandoffRef,
            }
          : undefined,
        promotionEvidenceRefs: asStringArray(options.promotionEvidenceRefs),
        coordinationEvidenceRefs: asStringArray(options.coordinationEvidenceRefs),
      });

      adapterResolution = resolveAdapterForRoute({
        routeResolution: /** @type {any} */ (routeResolution),
        adaptersRoot,
        adapterOverrides: options.adapterOverrides,
      });
      const inputPacketRefs = resolveStepInputPacketRefs({
        projectRoot: init.projectRoot,
        assetResolution: /** @type {Record<string, unknown>} */ (assetResolution),
        approvedHandoffRef,
        promotionEvidenceRefs: asStringArray(options.promotionEvidenceRefs),
        runtimeEvidenceRefs: asStringArray(options.runtimeEvidenceRefs),
      });
      const compiled = compileStepContext({
        projectRoot: init.projectRoot,
        projectProfilePath: init.projectProfilePath,
        stepClass: requestedStepClass,
        routeResolution: /** @type {Record<string, unknown>} */ (routeResolution),
        assetResolution: /** @type {Record<string, unknown>} */ (assetResolution),
        policyResolution: /** @type {Record<string, unknown>} */ (policyResolution),
        inputPacketRefs,
        runtimeEvidenceRefs: evidenceRefs,
        skillsRoot,
      });
      contextCompilation = compiled.context_compilation;

      const promptBundleRef = String(
        asRecord(asRecord(assetResolution).prompt_bundle).prompt_bundle_ref ?? "prompt-bundle://unknown@v1",
      );
      const contextBundles = asRecord(asRecord(assetResolution).context_bundles);
      const expandedRefs = asRecord(contextBundles.expanded_refs);
      const resolvedAdapterProfile = asRecord(asRecord(adapterResolution).adapter?.profile);
      const budgetLimitTokens = resolveContextBudgetLimitTokens(resolvedAdapterProfile);
      const contextSourceBreakdown = buildContextSourceBreakdown([
        { source: "instruction_set", value: compiled.compiled_context.instruction_set },
        { source: "required_inputs_resolved", value: compiled.compiled_context.required_inputs_resolved },
        { source: "guardrails", value: compiled.compiled_context.guardrails },
        { source: "context_refs", value: compiled.compiled_context.context_refs },
        { source: "provenance", value: compiled.compiled_context.provenance },
      ]);
      const contextEstimate = sumContextEstimates(contextSourceBreakdown);
      const compiledContextId = buildCompiledContextId(
        init.projectId,
        runId,
        stepId,
        requestedStepClass,
        promptBundleRef,
        executionAttempt,
      );
      compiledContextArtifact = {
        compiled_context_id: compiledContextId,
        version: 1,
        step: requestedStepClass,
        prompt_bundle_ref: promptBundleRef,
        context_bundle_refs: uniqueStrings(contextBundles.bundle_refs),
        context_doc_refs: uniqueStrings(expandedRefs.context_doc_refs),
        context_rule_refs: uniqueStrings(expandedRefs.context_rule_refs),
        context_skill_refs: uniqueStrings(expandedRefs.context_skill_refs),
        packet_refs: uniqueStrings(compiled.context_compilation.resolved_input_packet_refs),
        hashes: {
          prompt_hash: `sha256:${sha256Hex(promptBundleRef)}`,
          context_hash: `sha256:${String(compiled.context_compilation.compiled_context_fingerprint ?? "")}`,
        },
        provenance: {
          compiler_revision_ref: "compiler-revision://runtime-context-compiler@v1",
          project_profile_ref: init.projectProfilePath,
          route_profile_ref: asRecord(routeResolution).resolved_route_id ?? null,
          wrapper_profile_ref: asRecord(asRecord(assetResolution).wrapper).wrapper_ref ?? null,
          generated_at: new Date().toISOString(),
        },
        budget_report: {
          ...contextEstimate,
          budget_limit_tokens: budgetLimitTokens,
          budget_status: classifyContextBudgetStatus(contextEstimate.estimated_tokens, budgetLimitTokens),
          source_breakdown: contextSourceBreakdown,
        },
        compaction_report: {
          strategy: "none",
          original_estimate: contextEstimate,
          final_estimate: contextEstimate,
          dropped_or_summarized_sources: [],
          mandatory_refs_preserved: uniqueStrings(compiled.context_compilation.resolved_input_packet_refs),
        },
      };
      compiledContextArtifactPath = writeCompiledContextArtifact({
        runtimeLayout: init.runtimeLayout,
        compiledContextArtifact,
        artifactFileName: compiledContextFileName,
      });
      compiledContextRef = `compiled-context://${compiledContextId}`;

      const routeProfile = asRecord(routeResolution.route_profile);
      const routePrimary = asRecord(routeProfile.primary);
      const adapterProfile = asRecord(asRecord(adapterResolution).adapter);
      const resolvedBounds = asRecord(policyResolution.resolved_bounds);
      const timeoutSec = asRecord(resolvedBounds.budget).timeout_sec;
      const timeoutBudgetMs =
        typeof timeoutSec === "number" && Number.isFinite(timeoutSec) && timeoutSec > 0
          ? Math.floor(timeoutSec * 1000)
          : null;
      const planReady =
        deliveryPlanResult?.deliveryPlan?.status === "ready" && deliveryPlanResult.deliveryPlan.writeback_allowed === true;
      const providerStepStatusBase = {
        provider: asString(routePrimary.provider),
        adapter: asString(adapterProfile.adapter_id),
        route_id: asString(routeResolution.resolved_route_id),
        step_id: stepId,
        status: "running",
        timeout_budget_ms: timeoutBudgetMs,
        remaining_budget_ms: timeoutBudgetMs,
        last_output_at: null,
        last_artifact_update_at: null,
        current_command_label: "external-provider-runner",
        recommended_action: "Provider is still running.",
      };
      const providerStepStatus =
        !dryRun && planReady
          ? updateRunControlProviderStepStatus(options.providerStepStatusStateFile, providerStepStatusBase)
          : null;
      if (providerStepStatus) {
        appendProviderHeartbeatEvent({
          cwd: options.cwd,
          projectRef: options.projectRef,
          projectProfile: options.projectProfile,
          runtimeRoot: options.runtimeRoot,
          runId,
          providerStepStatus,
          summary: "Provider execution heartbeat started.",
        });
      }

      adapterRequest = createAdapterRequestEnvelope({
        request_id: `${stepResultId}.request`,
        run_id: runId,
        step_id: stepId,
        step_class: requestedStepClass,
        route: routeResolution,
        asset_bundle: assetResolution,
        policy_bundle: policyResolution,
        feature_traceability: featureTraceability,
        input_packet_refs: uniqueStrings(compiled.context_compilation.resolved_input_packet_refs),
        dry_run: dryRun,
        context: {
          compiled_context_ref: compiledContextRef,
          compiled_context_file: compiledContextArtifactPath,
          compiled_context_id: compiledContextId,
          compiled_context_fingerprint: compiled.context_compilation.compiled_context_fingerprint,
          context_bundle_refs: compiledContextArtifact.context_bundle_refs,
          context_doc_refs: compiledContextArtifact.context_doc_refs,
          context_rule_refs: compiledContextArtifact.context_rule_refs,
          context_skill_refs: compiledContextArtifact.context_skill_refs,
          packet_refs: compiledContextArtifact.packet_refs,
          instruction_set: compiled.compiled_context.instruction_set,
          required_inputs_resolved: compiled.compiled_context.required_inputs_resolved,
          guardrails: compiled.compiled_context.guardrails,
          skill_refs: compiled.compiled_context.skill_refs,
          provenance: compiled.compiled_context.provenance,
        },
        provider_step_status: providerStepStatus
          ? {
              ...providerStepStatus,
              state_file: options.providerStepStatusStateFile,
            }
          : null,
      });

      const invocation = invokeStepAdapterForStep({
        dryRun,
        requestedStepClass,
        adapterResolution,
        adapterRequest: /** @type {Record<string, unknown>} */ (adapterRequest),
        deliveryPlan: deliveryPlanResult?.deliveryPlan ?? null,
        runtimeEvidenceRoot: init.runtimeLayout.reportsRoot,
        projectRoot: init.projectRoot,
        executionRoot,
      });
      adapterResponse = invocation.adapterResponse;
      status = invocation.status;
      summary = invocation.summary;
      blockedNextStep = invocation.blockedNextStep;
      if (providerStepStatus) {
        const adapterOutput = asRecord(adapterResponse.output);
        const externalRunner = asRecord(adapterOutput.external_runner);
        const stateFileSnapshot = readJsonFile(options.providerStepStatusStateFile) ?? {};
        const currentProviderStepStatus = asRecord(stateFileSnapshot.provider_step_status);
        const providerInterrupted =
          asString(adapterOutput.failure_kind) === "external-runner-interrupted" ||
          asString(stateFileSnapshot.status) === "canceled" ||
          asString(stateFileSnapshot.status) === "cancelled" ||
          asString(currentProviderStepStatus.status) === "interrupted";
        const terminalProviderStepStatus = updateRunControlProviderStepStatus(options.providerStepStatusStateFile, {
          ...providerStepStatusBase,
          status: providerInterrupted ? "interrupted" : invocation.status === "passed" ? "completed" : "failed",
          last_artifact_update_at: asString(externalRunner.raw_evidence_ref) ? new Date().toISOString() : null,
          recommended_action:
            providerInterrupted
              ? "Provider was stopped by the operator; save partial evidence, then diagnose or retry the public step."
              : invocation.status === "passed"
              ? "Continue with post-run verification."
              : "Inspect provider evidence and failure summary.",
          finished_at: new Date().toISOString(),
        });
        appendProviderHeartbeatEvent({
          cwd: options.cwd,
          projectRef: options.projectRef,
          projectProfile: options.projectProfile,
          runtimeRoot: options.runtimeRoot,
          runId,
          providerStepStatus: terminalProviderStepStatus,
          summary: "Provider execution heartbeat finished.",
        });
      }

      evidenceRefs = [
        ...new Set([
          init.projectProfilePath,
          ...asStringArray(options.runtimeEvidenceRefs),
          ...asStringArray(options.promotionEvidenceRefs),
          ...(deliveryPlanResult ? [deliveryPlanResult.deliveryPlanFile] : []),
          ...(compiledContextRef ? [compiledContextRef] : []),
          ...(compiledContextArtifactPath ? [compiledContextArtifactPath] : []),
          ...asStringArray(adapterResponse?.evidence_refs),
        ]),
      ];
    } catch (error) {
      status = "failed";
      summary = error instanceof Error ? error.message : String(error);
      blockedNextStep = dryRun
        ? "Fix routed resolution inputs (route/asset/policy/adapter) and retry dry-run."
        : "Fix routed resolution inputs (route/asset/policy/adapter) and retry live execution.";
    }
  }

  const finishedAt = new Date().toISOString();
  const changedPathStatusAfter = listChangedPaths(executionRoot);
  const changedPathsDuringStep =
    changedPathStatusBefore.available && changedPathStatusAfter.available
      ? diffChangedPaths(changedPathStatusBefore.changedPaths, changedPathStatusAfter.changedPaths)
      : [];
  const nonBootstrapChangedPathsDuringStep = filterNonBootstrapChangedPaths(changedPathsDuringStep);
  const runnerOwnedStatePathsDuringStep = filterRunnerOwnedStatePaths(changedPathsDuringStep);
  const missionProfile = resolveRuntimeMissionProfile(init.projectRoot, init.runtimeLayout.artifactsRoot);
  const missionEvidence = collectMissionChangeEvidence({
    projectRoot: init.projectRoot,
    artifactsRoot: init.runtimeLayout.artifactsRoot,
    evidenceRoot: executionRoot,
  });
  const strictCodeChangingNoopDetectionApplied =
    !dryRun &&
    requestedStepClass === "implement" &&
    (missionProfile.missionType === "code-changing" || missionProfile.missionType === "release") &&
    changedPathStatusBefore.available &&
    missionEvidence.gitStatusAvailable;
  const strictCodeChangingNoop =
    strictCodeChangingNoopDetectionApplied && missionEvidence.meaningfulChangedPaths.length === 0;
  const adapterOutputForStep = asRecord(adapterResponse?.output);
  const externalRunnerForStep = asRecord(adapterOutputForStep.external_runner);
  const stepResult = {
    step_result_id: stepResultId,
    run_id: runId,
    step_id: stepId,
    step_class: resultStepClass,
    status,
    summary,
    evidence_refs: evidenceRefs,
    routed_execution: {
      mode: dryRun ? "dry-run" : "execute",
      no_write_enforced: dryRun,
      started_at: startedAt,
      finished_at: finishedAt,
      route_resolution: routeResolution,
      asset_resolution: assetResolution,
      policy_resolution: policyResolution,
      delivery_plan: deliveryPlanResult
        ? {
            plan_id: deliveryPlanResult.deliveryPlan.plan_id,
            delivery_mode: deliveryPlanResult.deliveryPlan.delivery_mode,
            status: deliveryPlanResult.deliveryPlan.status,
            writeback_allowed: deliveryPlanResult.deliveryPlan.writeback_allowed,
            delivery_plan_file: deliveryPlanResult.deliveryPlanFile,
          }
        : null,
      adapter_resolution: adapterResolution,
      adapter_request: adapterRequest,
      adapter_response: adapterResponse,
      operator_request_ref: asString(options.operatorRequestRef),
      context_compilation: {
        compiled_context_ref: compiledContextRef,
        compiled_context_file: compiledContextArtifactPath,
        compiled_context_artifact: compiledContextArtifact,
        diagnostics: contextCompilation,
      },
      feature_traceability: featureTraceability,
      discovery_completeness_gate: discoveryCompletenessGate,
      discovery_research_gate: discoveryResearchGate,
      architecture_traceability: {
        architecture_doc_refs: discoveryArchitectureTraceability?.architecture_doc_refs ?? [...STEP_ARCHITECTURE_DOC_REFS],
        contract_refs: discoveryArchitectureTraceability?.contract_refs ?? [...STEP_ARCHITECTURE_CONTRACT_REFS],
        planning_artifact_families: discoveryArchitectureTraceability?.planning_artifact_families ?? [
          "project-analysis-report",
          "step-result",
          "wave-ticket",
          "handoff-packet",
        ],
        step_linkage: discoveryArchitectureTraceability?.step_linkage ?? [],
        evaluation_refs: discoveryArchitectureTraceability?.evaluation_refs ?? {
          suite_refs: [],
          dataset_refs: [],
        },
        selected_step: {
          step_class: requestedStepClass,
          route_id:
            typeof (/** @type {any} */ (routeResolution))?.resolved_route_id === "string"
              ? /** @type {any} */ (routeResolution).resolved_route_id
              : null,
          wrapper_ref:
            typeof (/** @type {any} */ (assetResolution))?.wrapper?.wrapper_ref === "string"
              ? /** @type {any} */ (assetResolution).wrapper.wrapper_ref
              : null,
          prompt_bundle_ref:
            typeof (/** @type {any} */ (assetResolution))?.prompt_bundle?.prompt_bundle_ref === "string"
              ? /** @type {any} */ (assetResolution).prompt_bundle.prompt_bundle_ref
              : null,
          policy_id:
            typeof (/** @type {any} */ (policyResolution))?.policy?.policy_id === "string"
              ? /** @type {any} */ (policyResolution).policy.policy_id
              : null,
          adapter_id:
            typeof (/** @type {any} */ (adapterResolution))?.adapter?.adapter_id === "string"
              ? /** @type {any} */ (adapterResolution).adapter.adapter_id
              : null,
        },
      },
      blocked_next_step: blockedNextStep,
      evidence_root: init.runtimeLayout.reportsRoot,
    },
    mission_semantics: {
      git_status_available: changedPathStatusBefore.available && missionEvidence.gitStatusAvailable,
      git_status_root: missionEvidence.gitStatusRoot,
      changed_paths_before_step: changedPathStatusBefore.changedPaths,
      changed_paths_after_step: missionEvidence.changedPaths,
      changed_paths_during_step: changedPathsDuringStep,
      non_bootstrap_changed_paths: missionEvidence.nonBootstrapChangedPaths,
      non_bootstrap_changed_paths_during_step: nonBootstrapChangedPathsDuringStep,
      non_input_changed_paths: missionEvidence.nonInputChangedPaths,
      meaningful_changed_paths: missionEvidence.meaningfulChangedPaths,
      runner_owned_state_paths: missionEvidence.runnerOwnedStatePaths,
      runner_owned_state_paths_during_step: runnerOwnedStatePathsDuringStep,
      ignored_input_files: missionEvidence.ignoredInputFiles,
      strict_code_changing_noop_detection_applied: strictCodeChangingNoopDetectionApplied,
      strict_code_changing_noop: strictCodeChangingNoop,
      mission_type: missionProfile.missionType,
      strictness_profile: missionProfile.strictnessProfile,
      evidence_root_lineage: {
        project_root: init.projectRoot,
        canonical_target_checkout_root: executionRoot,
        git_status_root: missionEvidence.gitStatusRoot,
      },
    },
  };
  if (Object.keys(externalRunnerForStep).length > 0) {
    stepResult.external_runner = externalRunnerForStep;
  }
  let runtimeOutcome = classifyRuntimeStepOutcome(stepResult, {
    gitStatusAvailable: changedPathStatusBefore.available && missionEvidence.gitStatusAvailable,
    strictCodeChangingNoop,
    nonBootstrapChangedPaths: missionEvidence.nonBootstrapChangedPaths,
    meaningfulChangedPaths: missionEvidence.meaningfulChangedPaths,
    runnerOwnedStatePaths: missionEvidence.runnerOwnedStatePaths,
  });
  let runtimePermissionRequest = null;
  let runtimePermissionDecision = null;
  let runtimePermissionDecisionAuditRef = null;
  let runtimePermissionDecisionAuditFile = null;
  if (runtimeOutcome.failureClass === "permission-mode-blocked" || runtimeOutcome.failureClass === "edit-denied") {
    const interactionPolicy = normalizeRuntimeAgentInteractionPolicy(process.env.AOR_RUNTIME_AGENT_INTERACTION_POLICY);
    const autoApprovalProfile = normalizeRuntimeAgentAutoApprovalProfile(
      process.env.AOR_RUNTIME_AGENT_AUTO_APPROVAL_PROFILE,
      interactionPolicy,
    );
    if (interactionPolicy !== "fail-closed") {
      const approvalFeatures = resolveApprovalFeatures(adapterResolution);
      runtimePermissionRequest = resolveRuntimePermissionRequest({
        stepResultId,
        summary,
        evidenceRefs,
        adapterOutput: adapterOutputForStep,
        adapterResolution,
      });
      runtimePermissionDecision = evaluateRuntimePermissionRequest({
        runtimePermissionRequest,
        context: {
          execution_root: executionRoot,
          runtime_agent_interaction_policy: interactionPolicy,
          runtime_agent_auto_approval_profile: autoApprovalProfile,
          approval_grant_scope: asString(approvalFeatures.approval_grant_scope) ?? "step-coarse",
          approval_resume_mode: asString(approvalFeatures.approval_resume_mode) ?? "full-bypass",
          declared_verification_commands: asStringArray(
            asRecord(asRecord(policyResolution).resolved_bounds).command_constraints?.allowed_commands,
          ),
        },
      });
      runtimePermissionDecision = {
        ...runtimePermissionDecision,
        continuation_strategy: asString(approvalFeatures.continuation_strategy) ?? "reinvoke",
      };
      runtimePermissionDecision = applyRunScopedRuntimePermissionGrant({
        runtimeLayout: init.runtimeLayout,
        projectRoot: init.projectRoot,
        runId,
        runtimePermissionRequest,
        runtimePermissionDecision,
      });
      const audit = writeRuntimePermissionDecisionAudit({
        runtimeLayout: init.runtimeLayout,
        projectRoot: init.projectRoot,
        runId,
        stepResultId,
        runtimePermissionRequest,
        runtimePermissionDecision,
        evidenceRefs: uniqueStrings([...evidenceRefs, asString(runtimePermissionDecision.grant_ref) ?? ""]),
      });
      runtimePermissionDecisionAuditRef = audit.auditRef;
      runtimePermissionDecisionAuditFile = audit.auditFile;
      runtimePermissionDecision = {
        ...runtimePermissionDecision,
        audit_ref: runtimePermissionDecisionAuditRef,
        audit_file: runtimePermissionDecisionAuditFile,
      };
      runtimeOutcome =
        runtimePermissionDecision.decision === "auto_approve"
          ? {
              failureClass: runtimeOutcome.failureClass,
              decision: "retry",
              missionOutcome: "not_satisfied",
            }
          : {
              failureClass: runtimeOutcome.failureClass,
              decision: "block",
              missionOutcome: "not_satisfied",
            };
    }
  }
  stepResult.mission_outcome = runtimeOutcome.missionOutcome;
  stepResult.failure_class = runtimeOutcome.failureClass;
  stepResult.runtime_harness_decision = runtimeOutcome.decision;
  if (runtimePermissionRequest) {
    stepResult.runtime_permission_request = runtimePermissionRequest;
  }
  if (runtimePermissionDecision) {
    stepResult.runtime_permission_decision = runtimePermissionDecision;
  }
  if (runtimePermissionDecisionAuditRef && !stepResult.evidence_refs.includes(runtimePermissionDecisionAuditRef)) {
    stepResult.evidence_refs = [...stepResult.evidence_refs, runtimePermissionDecisionAuditRef];
  }
  stepResult.repair_attempts = synthesizeRepairAttempts(
    stepResult,
    runtimeOutcome,
    toEvidenceRef(init.projectRoot, path.join(init.runtimeLayout.reportsRoot, stepResultFileName)),
  );
  stepResult.repair_status = runtimeOutcome.decision === "repair" ? "pending" : "not_required";
  stepResult.stage_timings = {
    started_at: startedAt,
    finished_at: finishedAt,
    duration_sec: resolveDurationSeconds(startedAt, finishedAt),
  };
  stepResult.permission_denials =
    runtimeOutcome.failureClass === "permission-mode-blocked" || runtimeOutcome.failureClass === "edit-denied"
      ? [
          {
            failure_class: runtimeOutcome.failureClass,
            summary,
            evidence_refs: evidenceRefs,
          },
        ]
      : [];
  stepResult.requested_interaction =
    runtimePermissionRequest && runtimePermissionDecision?.decision === "ask_user"
      ? buildRuntimePermissionRequestedInteraction({
          stepResultId,
          summary: runtimePermissionDecision.reason ?? summary,
          evidenceRefs: runtimePermissionDecisionAuditRef
            ? [...evidenceRefs, runtimePermissionDecisionAuditRef]
            : evidenceRefs,
          timestamp: finishedAt,
          runtimePermissionRequest,
          runtimePermissionDecision,
        })
      : runtimeOutcome.failureClass === "interactive-question-requested"
      ? buildRequestedInteraction({
          stepResultId,
          summary,
          evidenceRefs,
          timestamp: finishedAt,
        })
      : null;

  const stepResultPath = writeStepResult({
    runtimeLayout: init.runtimeLayout,
    stepResultFileName,
    stepResult,
  });

  return {
    ...init,
    runId,
    stepId,
    stepResultId,
    stepResult,
    stepResultPath,
  };
}

/**
 * Execute a routed step through the AOR Runtime Harness controller.
 *
 * The one-shot `executeRoutedStep` surface remains the primitive that writes a
 * single routed step result. This controller is the normal runtime surface for
 * `run start`: it records the first decision, applies bounded retry/repair
 * policy, reruns the original step after repair, and blocks delivery semantics
 * when the policy budget is exhausted.
 *
 * @param {Parameters<typeof executeRoutedStep>[0]} options
 * @returns {ReturnType<typeof executeRoutedStep>}
 */
export function executeRuntimeHarnessControlledStep(options) {
  let current = executeRoutedStep(options);
  refreshRuntimeHarnessReportForStep(current);

  if (options.stepClass === "repair") {
    const repairDecision = resolveRuntimeHarnessDecision(current.stepResult);
    if (repairDecision !== "pass") {
      persistExhaustedRuntimeDecision({
        result: current,
        attempts: asRecordArray(current.stepResult.repair_attempts),
        action: "repair",
        exhausted: true,
      });
      refreshRuntimeHarnessReportForStep(current);
    }
    return current;
  }

  /** @type {Array<Record<string, unknown>>} */
  const executedAttempts = [];
  const counters = {
    retry: 0,
    repair: 0,
  };

  for (let loopIndex = 0; loopIndex < 20; loopIndex += 1) {
    const decision = resolveRuntimeHarnessDecision(current.stepResult);
    if (decision === "pass") {
      if (executedAttempts.length > 0) {
        persistRuntimeHarnessAttemptLedger(
          current,
          executedAttempts,
          executedAttempts.some((attempt) => asString(attempt.policy_action) === "repair")
            ? "succeeded_after_repair"
            : "succeeded_after_retry",
        );
        refreshRuntimeHarnessReportForStep(current);
      }
      return current;
    }
    if (decision === "fail" || decision === "block" || decision === "escalate") {
      if (asString(current.stepResult.status) === "passed") {
        current.stepResult.status = "failed";
        current.stepResult.summary = `Runtime Harness blocked step '${current.stepId}' with decision '${decision}' and failure class '${asString(current.stepResult.failure_class) ?? "unknown"}'.`;
        rewriteStepResult({
          runtimeLayout: current.runtimeLayout,
          stepResultPath: current.stepResultPath,
          stepResult: current.stepResult,
        });
        refreshRuntimeHarnessReportForStep(current);
      }
      return current;
    }
    if (decision !== "retry" && decision !== "repair") {
      return current;
    }

    const maxAttempts = resolveActionBudget(current.stepResult, decision);
    counters[decision] += 1;
    if (counters[decision] > maxAttempts) {
      const exhaustedAttempts = (
        executedAttempts.length > 0 ? executedAttempts : asRecordArray(current.stepResult.repair_attempts)
      ).map((attempt) => ({ ...attempt }));
      if (exhaustedAttempts.length > 0) {
        exhaustedAttempts[exhaustedAttempts.length - 1] = {
          ...exhaustedAttempts[exhaustedAttempts.length - 1],
          exhausted_budget: true,
        };
      }
      persistExhaustedRuntimeDecision({
        result: current,
        attempts: exhaustedAttempts,
        action: decision,
        exhausted: true,
      });
      refreshRuntimeHarnessReportForStep(current);
      return current;
    }

    const attemptStartedAt = new Date().toISOString();
    const baseEvidenceRefs = uniqueStrings([
      toEvidenceRef(current.projectRoot, current.stepResultPath),
      ...asStringArray(current.stepResult.evidence_refs),
    ]);

    if (decision === "retry") {
      const resumeMode = resolveApprovalResumeMode(current.stepResult);
      const permissionDecision = asRecord(current.stepResult.runtime_permission_decision);
      const permissionDecisionRefs = uniqueStrings([
        asString(permissionDecision.audit_ref) ?? "",
        ...asStringArray(options.runtimeEvidenceRefs),
      ]);
      const retried = runWithRuntimePermissionMode(resumeMode, () =>
        executeRoutedStep({
          ...options,
          runtimeEvidenceRefs: permissionDecisionRefs,
        }),
      );
      const attemptFinishedAt = new Date().toISOString();
      executedAttempts.push({
        attempt: executedAttempts.length + 1,
        status: resolveRuntimeHarnessDecision(retried.stepResult) === "pass" ? "pass" : "fail",
        trigger: asString(current.stepResult.failure_class) ?? "unknown",
        failure_class: asString(current.stepResult.failure_class) ?? "unknown",
        runtime_harness_decision: "retry",
        policy_action: "retry",
        started_at: attemptStartedAt,
        finished_at: attemptFinishedAt,
        duration_sec: resolveDurationSeconds(attemptStartedAt, attemptFinishedAt),
        input_evidence_refs: baseEvidenceRefs,
        output_evidence_refs: uniqueStrings([
          toEvidenceRef(retried.projectRoot, retried.stepResultPath),
          ...asStringArray(retried.stepResult.evidence_refs),
        ]),
        repair_route_ref: null,
        repair_compiled_context_ref: null,
        result: resolveRuntimeHarnessDecision(retried.stepResult) === "pass" ? "pass" : "fail",
        exhausted_budget: counters.retry >= maxAttempts && resolveRuntimeHarnessDecision(retried.stepResult) !== "pass",
        policy_budget: {
          max_attempts: maxAttempts,
        },
      });
      persistRuntimeHarnessAttemptLedger(retried, executedAttempts, "pending");
      current = retried;
      refreshRuntimeHarnessReportForStep(current);
      continue;
    }

    const repairStepId = `${current.stepId}.repair.${counters.repair}`;
    const repairInput = writeRuntimeRepairInput({
      result: current,
      attempt: counters.repair,
      inputEvidenceRefs: baseEvidenceRefs,
    });
    const repairInputEvidenceRefs = uniqueStrings([
      repairInput.repairInputRef,
      ...baseEvidenceRefs,
    ]);
    const repair = executeRoutedStep({
      ...options,
      stepClass: "repair",
      stepId: repairStepId,
      requireDiscoveryCompleteness: false,
      runtimeEvidenceRefs: repairInputEvidenceRefs,
    });
    const repairFinishedAt = new Date().toISOString();
    const repairDecision = resolveRuntimeHarnessDecision(repair.stepResult);
    const repairContext = asRecord(asRecord(repair.stepResult.routed_execution).context_compilation);
    const repairRouteResolution = asRecord(asRecord(repair.stepResult.routed_execution).route_resolution);
    const repairAttempt = {
      attempt: executedAttempts.length + 1,
      status: repairDecision === "pass" ? "pass" : "fail",
      trigger: asString(current.stepResult.failure_class) ?? "unknown",
      failure_class: asString(current.stepResult.failure_class) ?? "unknown",
      runtime_harness_decision: "repair",
      policy_action: "repair",
      started_at: attemptStartedAt,
      finished_at: repairFinishedAt,
      duration_sec: resolveDurationSeconds(attemptStartedAt, repairFinishedAt),
      input_evidence_refs: repairInputEvidenceRefs,
      output_evidence_refs: uniqueStrings([
        toEvidenceRef(repair.projectRoot, repair.stepResultPath),
        ...asStringArray(repair.stepResult.evidence_refs),
      ]),
      repair_route_ref: asString(repairRouteResolution.resolved_route_id)
        ? `route://${asString(repairRouteResolution.resolved_route_id)}`
        : null,
      repair_compiled_context_ref: asString(repairContext.compiled_context_ref),
      result: repairDecision === "pass" ? "pass" : "fail",
      exhausted_budget: false,
      policy_budget: {
        max_attempts: maxAttempts,
      },
    };
    executedAttempts.push(repairAttempt);
    persistRuntimeHarnessAttemptLedger(current, executedAttempts, "pending");
    refreshRuntimeHarnessReportForStep(repair);

    if (repairDecision !== "pass") {
      executedAttempts[executedAttempts.length - 1] = {
        ...repairAttempt,
        result: repairDecision === "block" ? "blocked" : "fail",
        exhausted_budget: counters.repair >= maxAttempts,
      };
      persistExhaustedRuntimeDecision({
        result: current,
        attempts: executedAttempts,
        action: "repair",
        exhausted: counters.repair >= maxAttempts,
      });
      refreshRuntimeHarnessReportForStep(current);
      return current;
    }

    const rerun = executeRoutedStep(options);
    persistRuntimeHarnessAttemptLedger(rerun, executedAttempts, "pending");
    current = rerun;
    refreshRuntimeHarnessReportForStep(current);
  }

  persistExhaustedRuntimeDecision({
    result: current,
    attempts: executedAttempts,
    action: "repair",
    exhausted: true,
  });
  refreshRuntimeHarnessReportForStep(current);
  return current;
}
