import path from "node:path";

import {
  asNonEmptyString,
  asRecord,
  asStringArray,
  fileExists,
  normalizeId,
  nowIso,
  readJson,
  uniqueStrings,
  writeJson,
} from "./common.mjs";

const DELIVERY_STEPS = Object.freeze(["discovery", "spec", "planning", "handoff", "execution", "review", "qa", "delivery"]);
const FULL_LIFECYCLE_STEPS = Object.freeze([...DELIVERY_STEPS, "release", "learning"]);

const STEP_COMMAND_LABELS = Object.freeze({
  discovery: ["discovery-run", "project-analyze"],
  spec: ["spec-build", "project-validate"],
  planning: ["wave-create", "handoff-prepare"],
  handoff: ["handoff-approve"],
  execution: ["run-start", "project-verify-routed-live"],
  review: ["review-run", "harness-certify", "eval-run"],
  qa: ["eval-run", "project-verify-post-run-primary"],
  delivery: ["deliver-prepare", "delivery-harness-certify"],
  release: ["release-prepare"],
  learning: ["learning-handoff", "audit-runs"],
});

const COMMAND_LABEL_STEP = Object.freeze(
  Object.fromEntries(
    Object.entries(STEP_COMMAND_LABELS).flatMap(([step, labels]) => labels.map((label) => [label, step])),
  ),
);

const STEP_OBJECTIVES = Object.freeze({
  discovery: "Observe project analysis and discovery evidence through installed public flow surfaces.",
  spec: "Observe specification or validation evidence for the current requested change.",
  planning: "Observe wave or handoff planning artifacts before execution.",
  handoff: "Observe approved handoff evidence before routed execution.",
  execution: "Observe routed live execution and runtime evidence through the public control plane.",
  review: "Observe review or harness certification evidence for the executed change.",
  qa: "Observe evaluation, verification, or QA evidence after execution.",
  delivery: "Observe delivery preparation and delivery evidence materialization.",
  release: "Observe release preparation as a first-class public lifecycle step.",
  learning: "Observe learning-loop closure, audit, and guided frontend proof evidence.",
});

const STEP_EXPECTED_ARTIFACTS = Object.freeze({
  discovery: ["analysis_report_file", "discovery_analysis_report_file"],
  spec: ["validation_report_file", "spec_step_result_file"],
  planning: ["wave_ticket_file", "handoff_packet_file"],
  handoff: ["approved_handoff_packet_file"],
  execution: ["routed_step_result_file", "runtime_harness_report_file", "adapter_raw_evidence_ref"],
  review: ["review_report_file", "promotion_decision_file", "certification_evaluation_report_file"],
  qa: ["evaluation_report_file", "post_run_verify_summary_file", "post_run_diagnostic_verify_summary_file"],
  delivery: ["delivery_manifest_file", "delivery_transcript_file", "delivery_plan_file"],
  release: ["release_packet_file", "release_delivery_manifest_file"],
  learning: ["learning_loop_scorecard_file", "learning_loop_handoff_file", "run_audit_file", "guided_journey_proof_file"],
});

const OPERATOR_ACTIONS = Object.freeze([
  "continue",
  "answer",
  "frontend_interact",
  "retry_public_step",
  "diagnose",
  "block",
]);

/**
 * @param {string} status
 * @returns {"pass" | "warn" | "not_pass" | "blocked" | "interaction_required" | "resumed"}
 */
export function toLiveE2eObservationStatus(status) {
  const normalized = asNonEmptyString(status).toLowerCase();
  if (normalized === "pass" || normalized === "passed" || normalized === "success") return "pass";
  if (normalized === "warn" || normalized === "warning" || normalized === "skipped") return "warn";
  if (normalized === "blocked" || normalized === "block") return "blocked";
  if (normalized === "interaction_required" || normalized === "interactive" || normalized === "requested") {
    return "interaction_required";
  }
  if (normalized === "resumed") return "resumed";
  return "not_pass";
}

/**
 * @param {Record<string, unknown>} profile
 * @returns {"delivery_default" | "full_lifecycle"}
 */
export function resolveLiveE2eFlowRangePolicy(profile) {
  const policy = asNonEmptyString(asRecord(profile.live_e2e).flow_range_policy);
  return policy === "full_lifecycle" ? "full_lifecycle" : "delivery_default";
}

/**
 * @param {"delivery_default" | "full_lifecycle"} policy
 * @returns {string[]}
 */
export function getLiveE2eIncludedSteps(policy) {
  return policy === "full_lifecycle" ? [...FULL_LIFECYCLE_STEPS] : [...DELIVERY_STEPS];
}

/**
 * @param {Record<string, unknown>} controllerStop
 * @param {string[]} includedSteps
 * @returns {boolean}
 */
export function isLiveE2eControllerStopInProgress(controllerStop, includedSteps) {
  const stop = asRecord(controllerStop);
  if (Object.keys(stop).length === 0) return false;

  const decision = asRecord(stop.decision);
  const state = asRecord(stop.state);
  const completedSteps = new Set(asStringArray(state.completed_steps));
  const allIncludedStepsCompleted =
    includedSteps.length > 0 && includedSteps.every((step) => completedSteps.has(step));
  const terminalManualContinue =
    asNonEmptyString(decision.action) === "continue" &&
    !asNonEmptyString(decision.next_step) &&
    !asNonEmptyString(state.current_step) &&
    allIncludedStepsCompleted;

  return !terminalManualContinue;
}

/**
 * @param {Record<string, unknown>} profile
 */
export function resolveLiveE2eOperatorContext(profile) {
  const liveE2e = asRecord(profile.live_e2e);
  return {
    operator_kind: "skill-agent",
    operator_ref: asNonEmptyString(liveE2e.operator_ref) || "skill://live-e2e-runner",
    decision_policy: "required",
    answer_policy: "agent-public-control-plane",
    target_write_policy:
      asNonEmptyString(liveE2e.target_write_policy) || "aor-runtime-only-before-execution",
  };
}

/**
 * @param {string} step
 * @returns {string[]}
 */
export function getLiveE2eCommandLabelPriority(step) {
  return [...(STEP_COMMAND_LABELS[step] ?? [])];
}

/**
 * @param {string} step
 * @param {Record<string, unknown> | null | undefined} command
 * @returns {Record<string, unknown>}
 */
export function buildLiveE2eStepPlan(step, command = null) {
  const commandLabels = getLiveE2eCommandLabelPriority(step);
  const publicSurface = asNonEmptyString(command?.command_surface) || "installed public AOR flow";
  return {
    objective: STEP_OBJECTIVES[step] ?? `Observe ${step} through the installed public flow.`,
    public_surface: publicSurface,
    command_labels: commandLabels,
    expected_artifacts: [...(STEP_EXPECTED_ARTIFACTS[step] ?? [])],
    inspection_sources: ["command_transcript", "stage_result", "artifact_refs", "api_output", "logs_or_ui_when_available"],
    safety_constraints: [
      "black-box-public-surfaces-only",
      "no-runtime-internal-imports",
      "no-upstream-write-by-default",
      "persist-observation-before-next-step",
    ],
  };
}

/**
 * @param {Array<Record<string, unknown>>} commandResults
 * @param {string[]} labels
 * @param {string} [step]
 * @param {number} [iteration]
 * @returns {Record<string, unknown> | undefined}
 */
export function findLiveE2eCommandByPreferredLabel(commandResults, labels, step = "", iteration = 1) {
  const normalizedStep = asNonEmptyString(step);
  const normalizedIteration = Number(iteration) || 1;
  const stepInstanceId = normalizedStep ? buildLiveE2eStepInstanceId(normalizedStep, normalizedIteration) : "";
  for (const label of labels) {
    const matchingCommands = commandResults.filter((entry) => asNonEmptyString(entry.label) === label);
    const command = stepInstanceId
      ? matchingCommands.findLast((entry) => {
          const entryStepInstanceId = asNonEmptyString(entry.step_instance_id);
          if (entryStepInstanceId) return entryStepInstanceId === stepInstanceId;
          const entryStep = asNonEmptyString(entry.step_id);
          const entryIteration = Number(entry.iteration) || 1;
          return entryStep === normalizedStep && entryIteration === normalizedIteration;
        }) ?? matchingCommands.findLast((entry) => asNonEmptyString(entry.label) === label)
      : matchingCommands.findLast((entry) => asNonEmptyString(entry.label) === label);
    if (command) return command;
  }
  return undefined;
}

/**
 * @param {string} label
 * @returns {string}
 */
export function resolveLiveE2eCommandStep(label) {
  return COMMAND_LABEL_STEP[asNonEmptyString(label)] ?? "";
}

/**
 * @param {Record<string, unknown>} command
 * @returns {Record<string, unknown> | null}
 */
function extractRequestedInteraction(command) {
  const continuation = asRecord(command.interactive_continuation);
  return Object.keys(continuation).length > 0 ? continuation : null;
}

/**
 * @param {Record<string, unknown>} entry
 * @returns {"continue" | "answer" | "frontend_interact" | "retry_public_step" | "diagnose" | "block"}
 */
function resolveDecisionAction(entry) {
  const requestedInteraction = asRecord(entry.requested_interaction);
  if (Object.keys(requestedInteraction).length > 0) {
    const interactionStatus = asNonEmptyString(requestedInteraction.interaction_status) || asNonEmptyString(requestedInteraction.status);
    if (interactionStatus === "resumed") {
      return asStringArray(requestedInteraction.answer_audit_refs).length > 0 ? "continue" : "block";
    }
    if (interactionStatus === "blocked" || interactionStatus === "resume_failed") return "block";
    return "answer";
  }

  const frontendRefs = asStringArray(entry.frontend_interaction_refs);
  if (asNonEmptyString(entry.step_id) === "learning" && asNonEmptyString(entry.final_step_verdict) === "interaction_required") {
    return frontendRefs.length > 0 ? "continue" : "frontend_interact";
  }

  const verdict = toLiveE2eObservationStatus(asNonEmptyString(entry.final_step_verdict));
  if (verdict === "blocked") return "block";
  if (verdict === "interaction_required") return "answer";
  if (verdict === "not_pass") return "diagnose";
  return "continue";
}

/**
 * @param {string} action
 */
function isOperatorAction(action) {
  return OPERATOR_ACTIONS.includes(action);
}

/**
 * @param {string} evidenceRef
 * @param {string} reportsRoot
 * @returns {boolean}
 */
function localEvidenceRefExists(evidenceRef, reportsRoot) {
  const ref = asNonEmptyString(evidenceRef);
  if (!ref) return true;
  if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(ref)) {
    if (!ref.startsWith("evidence://")) return true;
    const evidencePath = ref.slice("evidence://".length);
    return !path.isAbsolute(evidencePath) || fileExists(evidencePath);
  }
  if (path.isAbsolute(ref)) return fileExists(ref);
  if (ref.startsWith(".") || ref.includes("/") || ref.includes("\\")) {
    return fileExists(path.resolve(reportsRoot, ref));
  }
  return true;
}

/**
 * @param {Record<string, unknown>} entry
 * @returns {string[]}
 */
function requiredInspectionRefsForEntry(entry) {
  return uniqueStrings([
    asNonEmptyString(entry.agent_decision_request_ref),
    asNonEmptyString(entry.transcript_ref),
    asNonEmptyString(entry.inspection_ref),
    asNonEmptyString(entry.classification_ref),
    ...asStringArray(entry.artifact_refs),
    ...asStringArray(entry.frontend_interaction_refs),
  ]);
}

/**
 * @param {Record<string, unknown>} decision
 * @param {string} action
 * @param {Record<string, unknown>} entry
 * @returns {string | null}
 */
function rejectInconsistentSkillAgentDecision(decision, action, entry, profile = {}, reportsRoot = "") {
  const semantic = asRecord(decision.semantic_analysis);
  const judgeSource = asNonEmptyString(semantic.judge_source) || asNonEmptyString(decision.judge_source);
  if (judgeSource !== "skill-agent") {
    return "Skill-agent operator decisions must declare semantic_analysis.judge_source=skill-agent.";
  }
  const inspectedEvidenceRefs = asStringArray(decision.inspected_evidence_refs);
  if (inspectedEvidenceRefs.length === 0) {
    return "Skill-agent operator decisions must include non-empty inspected_evidence_refs.";
  }
  const missingInspectionRefs = requiredInspectionRefsForEntry(entry).filter((ref) => !inspectedEvidenceRefs.includes(ref));
  if (missingInspectionRefs.length > 0) {
    return `Skill-agent operator decisions must cite required inspected evidence refs: ${missingInspectionRefs.join(", ")}.`;
  }
  const missingMaterializedRefs = inspectedEvidenceRefs.filter((ref) => !localEvidenceRefExists(ref, reportsRoot));
  if (missingMaterializedRefs.length > 0) {
    return `Skill-agent operator decisions cite missing local evidence refs: ${missingMaterializedRefs.join(", ")}.`;
  }
  const deterministicStatus = toLiveE2eObservationStatus(
    asNonEmptyString(asRecord(entry.deterministic_analysis).status) || asNonEmptyString(entry.final_step_verdict),
  );
  if (action === "continue" && !["pass", "warn", "resumed"].includes(deterministicStatus)) {
    return `Skill-agent operator decision cannot continue with deterministic status '${deterministicStatus}'.`;
  }
  const semanticStatus = toLiveE2eObservationStatus(asNonEmptyString(semantic.status));
  if (action === "continue" && !["pass", "warn", "resumed"].includes(semanticStatus)) {
    return `Skill-agent operator decision cannot continue with semantic status '${semanticStatus}'.`;
  }
  const frontendCapability = asNonEmptyString(asRecord(asRecord(profile).live_e2e).frontend_capability);
  const frontendRefs = asStringArray(entry.frontend_interaction_refs);
  if (frontendCapability && frontendCapability !== "none" && frontendRefs.length > 0) {
    const decisionEvidenceRefs = asStringArray(decision.evidence_refs);
    const missingFrontendRefs = frontendRefs.filter((ref) => !decisionEvidenceRefs.includes(ref));
    if (missingFrontendRefs.length > 0) {
      return `Skill-agent UI/UX decisions must cite frontend evidence refs: ${missingFrontendRefs.join(", ")}.`;
    }
  }
  return null;
}

/**
 * @param {{ reportsRoot: string, runId: string, sequence: number, step: string }}
 */
function operatorFilePaths(options) {
  const prefix = `${normalizeId(options.runId)}-${String(options.sequence).padStart(2, "0")}-${normalizeId(options.step)}`;
  return {
    requestFile: path.join(options.reportsRoot, `live-e2e-agent-decision-request-${prefix}.json`),
    decisionFile: path.join(options.reportsRoot, `live-e2e-operator-decision-${prefix}.json`),
  };
}

/**
 * @param {string} step
 * @param {number} iteration
 */
export function buildLiveE2eStepInstanceId(step, iteration) {
  return iteration > 1 ? `${step}#${iteration}` : step;
}

/**
 * @param {string} step
 * @param {number} iteration
 */
function buildStepInstanceId(step, iteration) {
  return buildLiveE2eStepInstanceId(step, iteration);
}

/**
 * @param {{ profile: Record<string, unknown>, entry: Record<string, unknown>, decisionFile: string, operatorContext: Record<string, unknown> }}
 */
function resolveOperatorDecision(options) {
  if (fileExists(options.decisionFile)) {
    const decision = asRecord(readJson(options.decisionFile));
    const action = asNonEmptyString(decision.action) || asNonEmptyString(asRecord(decision.decision).action);
    const status = asNonEmptyString(decision.status) || "accepted";
    const rejectionReason = rejectInconsistentSkillAgentDecision(
      decision,
      action,
      options.entry,
      options.profile,
      options.reportsRoot,
    );
    const stepMatches =
      !asNonEmptyString(decision.step_id) ||
      asNonEmptyString(decision.step_id) === asNonEmptyString(options.entry.step_id) ||
      asNonEmptyString(decision.step_id) === asNonEmptyString(options.entry.step_instance_id) ||
      asNonEmptyString(decision.step_instance_id) === asNonEmptyString(options.entry.step_instance_id);
    if (status === "accepted" && stepMatches && isOperatorAction(action) && !rejectionReason) {
      return {
        status: "accepted",
        decision,
        action,
        ref: options.decisionFile,
      };
    }
    return {
      status: "rejected",
      decision: {
        ...decision,
        rejection_reason: rejectionReason || null,
      },
      action: isOperatorAction(action) ? action : "diagnose",
      ref: options.decisionFile,
    };
  }

  return {
    status: "missing",
    decision: {},
    action: "diagnose",
    ref: null,
  };
}

/**
 * @param {Record<string, unknown> | null} requestedInteraction
 * @param {string} deterministicStatus
 * @returns {"pass" | "warn" | "not_pass" | "blocked" | "interaction_required" | "resumed"}
 */
function resolveFinalStepVerdict(requestedInteraction, deterministicStatus) {
  if (!requestedInteraction) return toLiveE2eObservationStatus(deterministicStatus);
  const interactionStatus =
    asNonEmptyString(requestedInteraction.interaction_status) || asNonEmptyString(requestedInteraction.status);
  if (interactionStatus === "resumed") {
    return asStringArray(requestedInteraction.answer_audit_refs).length > 0 ? "resumed" : "blocked";
  }
  if (interactionStatus === "blocked" || interactionStatus === "resume_failed") return "blocked";
  return "interaction_required";
}

/**
 * @param {Record<string, unknown>} artifacts
 * @param {string} key
 * @param {string} label
 * @returns {string | null}
 */
function failingArtifactGate(artifacts, key, label) {
  const rawStatus = asNonEmptyString(artifacts[key]);
  if (!rawStatus) return null;
  const status = toLiveE2eObservationStatus(rawStatus);
  if (status === "not_pass" || status === "blocked") return `${label} reported '${rawStatus}'.`;
  return null;
}

/**
 * @param {Record<string, unknown>} artifacts
 * @param {string} key
 * @param {string} message
 * @returns {string | null}
 */
function artifactBooleanFailure(artifacts, key, message) {
  return artifacts[key] === true ? message : null;
}

/**
 * @param {string} step
 * @param {Record<string, unknown>} artifacts
 * @returns {string[]}
 */
function resolveStepArtifactGateFailures(step, artifacts) {
  if (step === "execution") {
    return uniqueStrings([
      failingArtifactGate(artifacts, "provider_execution_status", "provider execution"),
      failingArtifactGate(artifacts, "real_code_change_status", "real code change gate"),
      failingArtifactGate(artifacts, "post_run_verify_status", "post-run verification"),
    ]);
  }
  if (step === "review") {
    return uniqueStrings([
      failingArtifactGate(artifacts, "review_overall_status", "review"),
      failingArtifactGate(artifacts, "quality_gate_decision", "quality gate"),
    ]);
  }
  if (step === "qa") {
    return uniqueStrings([
      failingArtifactGate(artifacts, "evaluation_status", "evaluation"),
      failingArtifactGate(artifacts, "post_run_verify_status", "post-run verification"),
      failingArtifactGate(artifacts, "post_run_diagnostic_status", "post-run diagnostic verification"),
    ]);
  }
  if (step === "delivery") {
    return uniqueStrings([
      artifactBooleanFailure(artifacts, "delivery_blocking", "delivery prepare was blocked."),
      failingArtifactGate(artifacts, "delivery_quality_gate_status", "delivery quality gate"),
    ]);
  }
  return [];
}

export class LiveE2eControllerStop extends Error {
  /**
   * @param {{ reason: string, state: Record<string, unknown>, decision: Record<string, unknown> }} options
   */
  constructor(options) {
    super(options.reason);
    this.name = "LiveE2eControllerStop";
    this.state = options.state;
    this.decision = options.decision;
  }
}

/**
 * @param {unknown} error
 * @returns {error is LiveE2eControllerStop}
 */
export function isLiveE2eControllerStop(error) {
  return error instanceof LiveE2eControllerStop || asNonEmptyString(asRecord(error).name) === "LiveE2eControllerStop";
}

/**
 * @param {{
 *   reportsRoot: string,
 *   runId: string,
 *   profile: Record<string, unknown>,
 *   mode?: "auto" | "manual" | "evaluator",
 * }} options
 */
export function createLiveE2eStepController(options) {
  const mode = options.mode === "manual" || options.mode === "evaluator" ? options.mode : "auto";
  const policy = resolveLiveE2eFlowRangePolicy(options.profile);
  const includedSteps = getLiveE2eIncludedSteps(policy);
  const operatorContext = resolveLiveE2eOperatorContext(options.profile);
  const normalizedRunId = normalizeId(options.runId);
  const stateFile = path.join(options.reportsRoot, `live-e2e-controller-state-${normalizedRunId}.json`);
  /** @type {Record<string, Record<string, unknown>>} */
  const entryByStep = {};
  /** @type {Record<string, Record<string, unknown>>} */
  const planByStep = {};
  /** @type {Record<string, unknown>} */
  const loadedState = fileExists(stateFile) ? asRecord(readJson(stateFile)) : {};
  /** @type {Record<string, number>} */
  const retryCounters = asRecord(loadedState.retry_counters);
  /** @type {Record<string, unknown>} */
  const state = {
    run_id: options.runId,
    mode,
    flow_range_policy: policy,
    included_steps: includedSteps,
    current_step: includedSteps[0] ?? null,
    completed_steps: [],
    pending_decision: null,
    operator_context: operatorContext,
    retry_counters: retryCounters,
    evidence_refs: [],
    artifacts_snapshot: {},
    command_results: [],
    phase_history: [],
    updated_at: nowIso(),
    ...loadedState,
    mode,
    flow_range_policy: policy,
    included_steps: includedSteps,
    operator_context: operatorContext,
    retry_counters: retryCounters,
  };

  for (const evidenceFile of asStringArray(state.evidence_refs)) {
    if (!evidenceFile || !fileExists(evidenceFile)) continue;
    const basename = path.basename(evidenceFile);
    if (basename.startsWith("live-e2e-step-plan-")) {
      const planDocument = asRecord(readJson(evidenceFile));
      const step = asNonEmptyString(planDocument.step_id);
      const iteration = Number(planDocument.iteration) || 1;
      if (step) {
        planByStep[buildStepInstanceId(step, iteration)] = {
          plan_ref: evidenceFile,
          plan: asRecord(planDocument.plan),
          sequence: Number(planDocument.sequence) || 0,
        };
      }
      continue;
    }
    if (!basename.startsWith("live-e2e-step-observation-")) continue;
    const entry = asRecord(readJson(evidenceFile));
    const step = asNonEmptyString(entry.step_id);
    const iteration = Number(entry.iteration) || 1;
    if (!step) continue;
    entryByStep[asNonEmptyString(entry.step_instance_id) || buildStepInstanceId(step, iteration)] = entry;
  }
  const resolveCurrentStep = () =>
    includedSteps.find(
      (step) =>
        Object.values(entryByStep).some(
          (entry) =>
            asNonEmptyString(entry.step_id) === step &&
            !["continue", "retry_public_step"].includes(asNonEmptyString(asRecord(entry.decision).action)),
        ),
    ) ??
    includedSteps.find(
      (step) =>
        !Object.values(entryByStep).some(
          (entry) => asNonEmptyString(entry.step_id) === step && (Number(entry.iteration) || 1) === 1,
        ),
    ) ??
    null;
  state.completed_steps = Object.values(entryByStep)
    .sort((left, right) => (Number(left.sequence) || 0) - (Number(right.sequence) || 0))
    .map((entry) => asNonEmptyString(entry.step_instance_id) || asNonEmptyString(entry.step_id))
    .filter(Boolean);
  state.current_step = resolveCurrentStep();

  /**
   * @returns {Record<string, unknown>}
   */
  function cloneState() {
    return JSON.parse(JSON.stringify(state));
  }

  /**
   * @param {Record<string, unknown>} command
   * @param {Record<string, unknown>} stage
   * @returns {string[]}
   */
  function collectArtifactRefs(command, stage) {
    return uniqueStrings([...asStringArray(stage.evidence_refs), ...asStringArray(command.artifact_refs)]);
  }

  /**
   * @param {string} step
   * @param {Record<string, unknown>} entry
   */
  function persistStep(step, entry) {
    const iteration = Number(entry.iteration) || 1;
    const stepInstanceId = asNonEmptyString(entry.step_instance_id) || buildStepInstanceId(step, iteration);
    const sequence = Number(entry.sequence) || Object.keys(entryByStep).length + 1;
    const observationFile = path.join(
      options.reportsRoot,
      `live-e2e-step-observation-${normalizedRunId}-${String(sequence).padStart(2, "0")}-${normalizeId(stepInstanceId)}.json`,
    );
    entry.sequence = sequence;
    entry.iteration = iteration;
    entry.step_instance_id = stepInstanceId;
    entry.observation_ref = observationFile;
    writeJson(observationFile, entry);
    entryByStep[stepInstanceId] = entry;

    state.completed_steps = Object.values(entryByStep)
      .sort((left, right) => (Number(left.sequence) || 0) - (Number(right.sequence) || 0))
      .map((stepEntry) => asNonEmptyString(stepEntry.step_instance_id) || asNonEmptyString(stepEntry.step_id))
      .filter(Boolean);
    state.current_step = resolveCurrentStep();
    state.pending_decision = entry.decision ?? null;
    state.evidence_refs = uniqueStrings([
      ...asStringArray(state.evidence_refs),
      observationFile,
      asNonEmptyString(entry.plan_ref),
      asNonEmptyString(entry.execution_ref),
      asNonEmptyString(entry.inspection_ref),
      asNonEmptyString(entry.classification_ref),
      asNonEmptyString(entry.agent_decision_request_ref),
      asNonEmptyString(entry.operator_decision_ref),
      ...asStringArray(entry.artifact_refs),
      asNonEmptyString(entry.transcript_ref),
    ]);
    state.updated_at = nowIso();
    writeJson(stateFile, state);
  }

  /**
   * @param {string} step
   * @param {string} phase
   * @param {string[]} evidenceRefs
   */
  function recordPhase(step, phase, evidenceRefs = []) {
    const history = Array.isArray(state.phase_history) ? state.phase_history : [];
    history.push({
      step_id: step,
      phase,
      observed_at: nowIso(),
      evidence_refs: uniqueStrings(evidenceRefs),
    });
    state.phase_history = history;
  }

  /**
   * @param {{ label: string, commandSurface?: string | null, iteration?: number }} input
   * @returns {Record<string, unknown> | null}
   */
  function planCommand(input) {
    const step = COMMAND_LABEL_STEP[asNonEmptyString(input.label)];
    if (!step || !includedSteps.includes(step)) return null;
    const iteration = Number(input.iteration) || 1;
    const stepInstanceId = buildStepInstanceId(step, iteration);
    if (planByStep[stepInstanceId]) return planByStep[stepInstanceId];
    const sequence = Object.keys(entryByStep).length + Object.keys(planByStep).length + 1;
    const plan = buildLiveE2eStepPlan(step, {
      command_surface: asNonEmptyString(input.commandSurface) || null,
    });
    const planFile = path.join(
      options.reportsRoot,
      `live-e2e-step-plan-${normalizedRunId}-${String(sequence).padStart(2, "0")}-${normalizeId(stepInstanceId)}.json`,
    );
    const document = {
      run_id: options.runId,
      sequence,
      step_id: step,
      step_instance_id: stepInstanceId,
      iteration,
      plan,
      planned_command_label: asNonEmptyString(input.label),
      created_at: nowIso(),
    };
    writeJson(planFile, document);
    planByStep[stepInstanceId] = {
      plan_ref: planFile,
      plan,
      sequence,
    };
    state.current_step = step;
    state.evidence_refs = uniqueStrings([...asStringArray(state.evidence_refs), planFile]);
    recordPhase(step, "plan", [planFile]);
    state.updated_at = nowIso();
    writeJson(stateFile, state);
    return planByStep[stepInstanceId];
  }

  /**
   * @param {{ stage: string, stageResult?: Record<string, unknown>, commandResults: Array<Record<string, unknown>>, artifacts: Record<string, unknown>, iteration?: number, decisionOverride?: Record<string, unknown> }} input
   * @returns {{ action: string, decision: Record<string, unknown> | null }}
   */
  function observeStage(input) {
    const step = asNonEmptyString(input.stage);
    if (!includedSteps.includes(step)) {
      return { action: "continue", decision: null };
    }
    const iteration = Number(input.iteration) || 1;
    const stepInstanceId = buildStepInstanceId(step, iteration);
    const persistedEntry = entryByStep[stepInstanceId];
    if (persistedEntry) {
      const persistedAction = asNonEmptyString(asRecord(persistedEntry.decision).action);
      if (["continue", "retry_public_step"].includes(persistedAction)) {
        return { action: "continue", decision: asRecord(persistedEntry.decision) };
      }
      if (mode === "manual" && asNonEmptyString(persistedEntry.operator_decision_status) === "missing") {
        const persistedSequence = Number(persistedEntry.sequence) || 1;
        const files = operatorFilePaths({
          reportsRoot: options.reportsRoot,
          runId: options.runId,
          sequence: persistedSequence,
          step: stepInstanceId,
        });
        const operatorDecision = resolveOperatorDecision({
          profile: options.profile,
          entry: persistedEntry,
          decisionFile: files.decisionFile,
          operatorContext,
          reportsRoot: options.reportsRoot,
        });
        const entry = { ...persistedEntry };
        entry.operator_decision_ref = operatorDecision.ref;
        entry.operator_decision_status = operatorDecision.status;
        if (operatorDecision.status === "accepted") {
          const semantic = asRecord(asRecord(operatorDecision.decision).semantic_analysis);
          entry.inspected_evidence_refs = asStringArray(operatorDecision.decision.inspected_evidence_refs);
          entry.semantic_analysis = {
            status: toLiveE2eObservationStatus(
              asNonEmptyString(semantic.status) || asNonEmptyString(asRecord(entry.semantic_analysis).status),
            ),
            judge_source:
              asNonEmptyString(semantic.judge_source) ||
              asNonEmptyString(asRecord(operatorDecision.decision).judge_source) ||
              asNonEmptyString(operatorContext.operator_ref),
            findings: uniqueStrings([
              ...asStringArray(asRecord(entry.semantic_analysis).findings),
              ...asStringArray(semantic.findings),
              ...asStringArray(asRecord(operatorDecision.decision).findings),
            ]),
          };
          entry.final_step_verdict =
            operatorDecision.action === "continue" && asNonEmptyString(asRecord(entry.resume_result).status) === "resumed"
              ? "resumed"
              : asNonEmptyString(entry.semantic_analysis.status);
          entry.decision = {
            ...asRecord(entry.decision),
            action: operatorDecision.action,
            reason:
              asNonEmptyString(asRecord(operatorDecision.decision).reason) ||
              asNonEmptyString(asRecord(entry.decision).reason) ||
              "Skill-agent operator decision accepted.",
          };
        } else if (operatorDecision.status === "rejected") {
          entry.semantic_analysis = {
            ...asRecord(entry.semantic_analysis),
            status: "blocked",
            findings: uniqueStrings([
              ...asStringArray(asRecord(entry.semantic_analysis).findings),
              "Operator decision artifact was rejected.",
            ]),
          };
          entry.final_step_verdict = "blocked";
          entry.decision = {
            ...asRecord(entry.decision),
            action: "block",
            reason: "Operator decision artifact was rejected.",
          };
        } else {
          throw new LiveE2eControllerStop({
            reason: `Live E2E controller stopped at '${step}' with decision '${persistedAction}'.`,
            state: cloneState(),
            decision: asRecord(entry.decision),
          });
        }
        recordPhase(
          step,
          "decide",
          uniqueStrings([asNonEmptyString(entry.operator_decision_ref), asNonEmptyString(entry.transcript_ref), ...asStringArray(entry.artifact_refs)]),
        );
        persistStep(step, entry);
        throw new LiveE2eControllerStop({
          reason: `Live E2E controller stopped at '${step}' with decision '${asNonEmptyString(asRecord(entry.decision).action)}'.`,
          state: cloneState(),
          decision: asRecord(entry.decision),
        });
      }
    }

    const stage = asRecord(input.stageResult);
    const command =
      findLiveE2eCommandByPreferredLabel(input.commandResults, getLiveE2eCommandLabelPriority(step), step, iteration) ?? {};
    const artifactRefs = collectArtifactRefs(command, stage);
    const planned = planByStep[stepInstanceId] ?? planCommand({
      label: asNonEmptyString(command.label) || getLiveE2eCommandLabelPriority(step)[0] || step,
      commandSurface: asNonEmptyString(command.command_surface) || null,
      iteration,
    });
    const plan = asRecord(planned?.plan) || buildLiveE2eStepPlan(step, command);
    const executionRef =
      asNonEmptyString(command.transcript_file) ||
      asStringArray(stage.evidence_refs)[0] ||
      artifactRefs[0] ||
      asNonEmptyString(planned?.plan_ref) ||
      null;
    const artifactGateFailures = resolveStepArtifactGateFailures(step, input.artifacts);
    const deterministicStatus =
      artifactGateFailures.length > 0
        ? "not_pass"
        : toLiveE2eObservationStatus(asNonEmptyString(stage.status) || asNonEmptyString(command.status) || "not_pass");
    const requestedInteraction = Object.keys(command).length > 0 ? extractRequestedInteraction(command) : null;
    const finalStepVerdict = resolveFinalStepVerdict(requestedInteraction, deterministicStatus);
    const missingResumeAudit =
      requestedInteraction &&
      (asNonEmptyString(requestedInteraction.interaction_status) || asNonEmptyString(requestedInteraction.status)) ===
        "resumed" &&
      asStringArray(requestedInteraction.answer_audit_refs).length === 0;
    const analysisStatus = missingResumeAudit ? "blocked" : deterministicStatus;
    const frontendInteractionRefs =
      step === "learning"
        ? uniqueStrings([
            asNonEmptyString(input.artifacts.guided_web_smoke_summary_file),
            asNonEmptyString(input.artifacts.guided_web_smoke_html_file),
            asNonEmptyString(input.artifacts.guided_web_dom_snapshot_file),
            asNonEmptyString(input.artifacts.guided_web_accessibility_summary_file),
            asNonEmptyString(input.artifacts.guided_web_visual_guardrail_file),
            ...asStringArray(input.artifacts.guided_web_screenshot_files),
          ])
        : [];
    const entry = {
      run_id: options.runId,
      sequence: Number(planned?.sequence) || Object.keys(entryByStep).length + 1,
      step_id: step,
      step_instance_id: stepInstanceId,
      iteration,
      flow_stage: step,
      plan,
      plan_ref: asNonEmptyString(planned?.plan_ref) || null,
      public_surface: asNonEmptyString(command.command_surface) || plan.public_surface,
      transcript_ref: asNonEmptyString(command.transcript_file) || executionRef,
      execution_ref: executionRef,
      artifact_refs: artifactRefs,
      started_at: asNonEmptyString(stage.started_at) || asNonEmptyString(command.started_at) || null,
      finished_at: asNonEmptyString(stage.finished_at) || asNonEmptyString(command.finished_at) || null,
      duration_sec:
        typeof stage.duration_sec === "number"
          ? stage.duration_sec
          : typeof command.duration_sec === "number"
            ? command.duration_sec
            : null,
      deterministic_analysis: {
        status: analysisStatus,
        exit_code: typeof command.exit_code === "number" ? command.exit_code : null,
        failure_class: asNonEmptyString(stage.failure_class) || asNonEmptyString(command.failure_class) || null,
        missing_evidence: uniqueStrings([
          ...asStringArray(stage.missing_evidence),
          ...asStringArray(command.missing_evidence),
          ...(missingResumeAudit ? ["answer_audit_refs"] : []),
        ]),
        recommendation: asNonEmptyString(stage.recommendation) || asNonEmptyString(command.recommendation) || "continue",
      },
      inspection_ref: null,
      classification_ref: null,
      semantic_analysis: {
        status: analysisStatus,
        judge_source: "deterministic-runner",
        findings:
          analysisStatus === "pass"
            ? []
            : uniqueStrings([
                ...artifactGateFailures,
                missingResumeAudit ? "Interaction resume is missing answer audit evidence." : "",
                asNonEmptyString(stage.summary) || `${step} requires inspection`,
              ]),
      },
      requested_interaction: requestedInteraction,
      decision: {
        action: "continue",
        reason:
          missingResumeAudit
            ? "Interaction resume is missing answer audit evidence."
            : deterministicStatus === "pass"
            ? "Public step completed with required evidence."
            : asNonEmptyString(stage.summary) || `${step} completed with observed findings.`,
        next_step: includedSteps[includedSteps.indexOf(step) + 1] ?? null,
      },
      decision_override: asRecord(input.decisionOverride),
      resume_result: requestedInteraction
        ? {
            status:
              asNonEmptyString(requestedInteraction.interaction_status) ||
              asNonEmptyString(requestedInteraction.status) ||
              "interaction_required",
            evidence_refs: asStringArray(requestedInteraction.answer_audit_refs),
          }
        : null,
      frontend_interaction_refs: frontendInteractionRefs,
      final_step_verdict: finalStepVerdict,
    };
    const inspectionFile = path.join(
      options.reportsRoot,
      `live-e2e-step-inspection-${normalizedRunId}-${String(Number(entry.sequence)).padStart(2, "0")}-${normalizeId(stepInstanceId)}.json`,
    );
    writeJson(inspectionFile, {
      run_id: options.runId,
      step_id: step,
      step_instance_id: stepInstanceId,
      iteration,
      transcript_ref: entry.transcript_ref,
      artifact_refs: artifactRefs,
      stage_result: stage,
      command_diagnostic: command,
      inspected_at: nowIso(),
    });
    entry.inspection_ref = inspectionFile;
    const classificationFile = path.join(
      options.reportsRoot,
      `live-e2e-step-classification-${normalizedRunId}-${String(Number(entry.sequence)).padStart(2, "0")}-${normalizeId(stepInstanceId)}.json`,
    );
    writeJson(classificationFile, {
      run_id: options.runId,
      step_id: step,
      step_instance_id: stepInstanceId,
      iteration,
      deterministic_analysis: entry.deterministic_analysis,
      requested_interaction: entry.requested_interaction,
      final_step_verdict: entry.final_step_verdict,
      classified_at: nowIso(),
    });
    entry.classification_ref = classificationFile;
    const files = operatorFilePaths({
      reportsRoot: options.reportsRoot,
      runId: options.runId,
      sequence: Number(entry.sequence),
      step: stepInstanceId,
    });
    entry.agent_decision_request_ref = files.requestFile;
    const requiredInspectionRefs = requiredInspectionRefsForEntry(entry);
    const decisionRequest = {
      request_id: `${options.runId}.${step}.operator-decision-request`,
      run_id: options.runId,
      step_id: step,
      step_instance_id: stepInstanceId,
      iteration,
      operator_context: operatorContext,
      plan: entry.plan,
      plan_ref: entry.plan_ref,
      public_surface: entry.public_surface,
      transcript_ref: entry.transcript_ref,
      artifact_refs: entry.artifact_refs,
      inspection_ref: entry.inspection_ref,
      classification_ref: entry.classification_ref,
      deterministic_analysis: entry.deterministic_analysis,
      requested_interaction: entry.requested_interaction,
      decision_hint: asRecord(input.decisionOverride),
      decision_rubric: {
        required_checks: uniqueStrings([
          "inspect-public-command-transcript",
          "inspect-materialized-artifact-refs",
          "inspect-target-diff-and-no-upstream-write-evidence",
          "inspect-verification-logs-and-quality-gates",
          "inspect-provider-or-raw-adapter-evidence-when-present",
          ...(asStringArray(entry.frontend_interaction_refs).length > 0
            ? [
                "inspect-installed-web-html",
                "inspect-ui-dom-snapshot",
                "inspect-ui-screenshot",
                "inspect-accessibility-summary",
                "judge-installed-user-task-outcome",
              ]
            : []),
        ]),
        required_evidence_refs: requiredInspectionRefs,
        frontend_evidence_refs: asStringArray(entry.frontend_interaction_refs),
        continuation_rule:
          "continue is allowed only when deterministic guardrails pass or warn and semantic_analysis.judge_source is skill-agent",
      },
      operator_decision_expected_ref: files.decisionFile,
      expected_response_shape: {
        step_id: step,
        step_instance_id: stepInstanceId,
        iteration,
        status: "accepted",
        operator_ref: asNonEmptyString(operatorContext.operator_ref),
        action: OPERATOR_ACTIONS.join("|"),
        semantic_analysis: {
          status: "pass|warn|not_pass|blocked|interaction_required|resumed",
          judge_source: "skill-agent",
          findings: [],
        },
        inspected_evidence_refs: requiredInspectionRefs,
        evidence_refs: requiredInspectionRefs,
        ui_ux_analysis:
          asStringArray(entry.frontend_interaction_refs).length > 0
            ? {
                status: "pass|warn|not_pass|blocked",
                task_outcome: "pass|warn|not_pass|blocked",
                findings: [],
              }
            : null,
      },
      created_at: nowIso(),
    };
    writeJson(files.requestFile, decisionRequest);

    const operatorDecision = resolveOperatorDecision({
      profile: options.profile,
      entry,
      decisionFile: files.decisionFile,
      operatorContext,
      reportsRoot: options.reportsRoot,
    });
    entry.operator_decision_ref = operatorDecision.ref;
    entry.operator_decision_status = operatorDecision.status;
    if (operatorDecision.status === "accepted") {
      const semantic = asRecord(asRecord(operatorDecision.decision).semantic_analysis);
      entry.inspected_evidence_refs = asStringArray(operatorDecision.decision.inspected_evidence_refs);
      entry.semantic_analysis = {
        status: toLiveE2eObservationStatus(asNonEmptyString(semantic.status) || asNonEmptyString(entry.semantic_analysis.status)),
        judge_source:
          asNonEmptyString(semantic.judge_source) ||
          asNonEmptyString(asRecord(operatorDecision.decision).judge_source) ||
          asNonEmptyString(operatorContext.operator_ref),
        findings: uniqueStrings([
          ...asStringArray(asRecord(entry.semantic_analysis).findings),
          ...asStringArray(semantic.findings),
          ...asStringArray(asRecord(operatorDecision.decision).findings),
        ]),
      };
      entry.final_step_verdict =
        operatorDecision.action === "continue" && asNonEmptyString(asRecord(entry.resume_result).status) === "resumed"
          ? "resumed"
          : asNonEmptyString(entry.semantic_analysis.status);
      entry.decision = {
        ...asRecord(entry.decision),
        action: operatorDecision.action,
        reason:
          asNonEmptyString(asRecord(operatorDecision.decision).reason) ||
          asNonEmptyString(asRecord(entry.decision).reason) ||
          "Skill-agent operator decision accepted.",
      };
    } else if (operatorDecision.status === "missing") {
      entry.semantic_analysis = {
        ...asRecord(entry.semantic_analysis),
        status: "blocked",
        findings: uniqueStrings([
          ...asStringArray(asRecord(entry.semantic_analysis).findings),
          "Skill-agent operator decision is required before the next public step.",
        ]),
      };
      entry.final_step_verdict = "blocked";
      entry.decision = {
        ...asRecord(entry.decision),
        action: "diagnose",
        reason: "Skill-agent operator decision is required before continuation.",
      };
    } else if (operatorDecision.status === "rejected") {
      entry.semantic_analysis = {
        ...asRecord(entry.semantic_analysis),
        status: "blocked",
        findings: uniqueStrings([
          ...asStringArray(asRecord(entry.semantic_analysis).findings),
          "Operator decision artifact was rejected.",
        ]),
      };
      entry.final_step_verdict = "blocked";
      entry.decision = {
        ...asRecord(entry.decision),
        action: "block",
        reason: "Operator decision artifact was rejected.",
      };
    } else {
      entry.decision.action = resolveDecisionAction(entry);
    }

    recordPhase(step, "plan", []);
    recordPhase(step, "execute", uniqueStrings([asNonEmptyString(entry.transcript_ref)]));
    recordPhase(step, "inspect", artifactRefs);
    recordPhase(step, "classify", uniqueStrings([files.requestFile, ...artifactRefs]));
    recordPhase(
      step,
      "decide",
      uniqueStrings([asNonEmptyString(entry.operator_decision_ref), asNonEmptyString(entry.transcript_ref), ...artifactRefs]),
    );
    recordPhase(step, "persist", []);
    persistStep(step, entry);
    state.artifacts_snapshot = JSON.parse(JSON.stringify(input.artifacts ?? {}));
    state.command_results = JSON.parse(JSON.stringify(input.commandResults ?? []));
    writeJson(stateFile, state);

    input.artifacts.live_e2e_controller_state_file = stateFile;
    input.artifacts.live_e2e_step_observation_files = Object.values(entryByStep).map((stepEntry) =>
      asNonEmptyString(stepEntry.observation_ref),
    );
    input.artifacts.live_e2e_step_journal_entries = Object.values(entryByStep).sort(
      (left, right) => (Number(left.sequence) || 0) - (Number(right.sequence) || 0),
    );

    const action = asNonEmptyString(asRecord(entry.decision).action) || "continue";
    const actionContinuesController = action === "continue" || (mode === "auto" && action === "retry_public_step");
    const terminalManualContinue = mode === "manual" && actionContinuesController && state.current_step === null;
    if (
      (mode === "manual" && !terminalManualContinue) ||
      (mode === "evaluator" && !actionContinuesController) ||
      (mode === "auto" && !actionContinuesController)
    ) {
      throw new LiveE2eControllerStop({
        reason: `Live E2E controller stopped at '${step}' with decision '${action}'.`,
        state: cloneState(),
        decision: asRecord(entry.decision),
      });
    }

    return { action, decision: asRecord(entry.decision) };
  }

  writeJson(stateFile, state);

  const completedContinueSteps = () =>
    Object.values(entryByStep)
      .filter((entry) => asNonEmptyString(asRecord(entry.decision).action) === "continue")
      .map((entry) => asNonEmptyString(entry.step_id))
      .filter(Boolean);
  const observedStepInstances = () =>
    Object.values(entryByStep)
      .map((entry) => asNonEmptyString(entry.step_instance_id) || asNonEmptyString(entry.step_id))
      .filter(Boolean);
  const findCachedCommandResult = (label, iteration = 1) => {
    const normalizedLabel = asNonEmptyString(label);
    if (!normalizedLabel) return null;
    const commandResults = Array.isArray(state.command_results)
      ? state.command_results.map((entry) => asRecord(entry))
      : [];
    const matchingCommands = commandResults.filter((entry) => asNonEmptyString(entry.label) === normalizedLabel);

    const step = resolveLiveE2eCommandStep(normalizedLabel);
    if (!step) {
      return matchingCommands.length === 1 ? matchingCommands[0] : null;
    }

    const normalizedIteration = Number(iteration) || 1;
    const stepInstanceId = buildStepInstanceId(step, normalizedIteration);
    const exact = matchingCommands.findLast((entry) => {
      const entryStepInstanceId = asNonEmptyString(entry.step_instance_id);
      if (entryStepInstanceId) return entryStepInstanceId === stepInstanceId;
      const entryStep = asNonEmptyString(entry.step_id);
      const entryIteration = Number(entry.iteration) || 1;
      return entryStep === step && entryIteration === normalizedIteration;
    });
    if (exact) return exact;

    const persistedEntry = asRecord(entryByStep[stepInstanceId]);
    const persistedTranscriptRef = asNonEmptyString(persistedEntry.transcript_ref);
    if (persistedTranscriptRef) {
      const transcriptMatched = matchingCommands.findLast(
        (entry) => asNonEmptyString(entry.transcript_file) === persistedTranscriptRef,
      );
      if (transcriptMatched) return transcriptMatched;
      if (fileExists(persistedTranscriptRef)) {
        return {
          label: normalizedLabel,
          command_surface: asNonEmptyString(persistedEntry.public_surface) || "cached public AOR command",
          status: ["pass", "warn", "resumed"].includes(asNonEmptyString(asRecord(persistedEntry.deterministic_analysis).status))
            ? "pass"
            : "fail",
          exit_code:
            typeof asRecord(persistedEntry.deterministic_analysis).exit_code === "number"
              ? asRecord(persistedEntry.deterministic_analysis).exit_code
              : 0,
          transcript_file: persistedTranscriptRef,
          artifact_refs: asStringArray(persistedEntry.artifact_refs),
          step_id: step,
          step_instance_id: stepInstanceId,
          iteration: normalizedIteration,
        };
      }
    }

    return matchingCommands.length === 1 ? matchingCommands[0] : null;
  };

  return {
    mode,
    policy,
    includedSteps,
    stateFile,
    planCommand,
    observeStage,
    getState: cloneState,
    hasPersistedProgress: () => asStringArray(state.completed_steps).length > 0,
    getCachedCommandResult: findCachedCommandResult,
    shouldUseCachedCommand: (label, iteration = 1) => {
      const step = resolveLiveE2eCommandStep(label);
      if (!step) return false;
      const normalizedIteration = Number(iteration) || 1;
      const stepInstanceId = buildStepInstanceId(step, normalizedIteration);
      if (mode === "manual" && observedStepInstances().includes(stepInstanceId)) {
        return findCachedCommandResult(label, normalizedIteration) !== null;
      }
      if (normalizedIteration > 1) return false;
      if (completedContinueSteps().includes(step)) {
        return findCachedCommandResult(label, normalizedIteration) !== null;
      }
      return mode === "manual" && observedStepInstances().includes(stepInstanceId) && findCachedCommandResult(label, normalizedIteration) !== null;
    },
    getStepJournal: () =>
      Object.values(entryByStep).sort((left, right) => (Number(left.sequence) || 0) - (Number(right.sequence) || 0)),
  };
}
