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
  delivery: ["deliver-prepare"],
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
 * @returns {Record<string, unknown> | undefined}
 */
export function findLiveE2eCommandByPreferredLabel(commandResults, labels) {
  for (const label of labels) {
    const command = commandResults.find((entry) => asNonEmptyString(entry.label) === label);
    if (command) return command;
  }
  return undefined;
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
  const normalizedRunId = normalizeId(options.runId);
  const stateFile = path.join(options.reportsRoot, `live-e2e-controller-state-${normalizedRunId}.json`);
  /** @type {Record<string, Record<string, unknown>>} */
  const entryByStep = {};
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
    retry_counters: retryCounters,
  };

  for (const step of asStringArray(state.completed_steps)) {
    const sequence = includedSteps.indexOf(step) + 1;
    const expectedFile =
      sequence > 0
        ? path.join(
            options.reportsRoot,
            `live-e2e-step-observation-${normalizedRunId}-${String(sequence).padStart(2, "0")}-${normalizeId(step)}.json`,
          )
        : "";
    const evidenceFile =
      asStringArray(state.evidence_refs).find((ref) => ref.includes(`-${normalizeId(step)}.json`)) || expectedFile;
    if (evidenceFile && fileExists(evidenceFile)) {
      entryByStep[step] = readJson(evidenceFile);
    }
  }
  const resolveCurrentStep = () =>
    includedSteps.find(
      (step) => entryByStep[step] && asNonEmptyString(asRecord(entryByStep[step]?.decision).action) !== "continue",
    ) ??
    includedSteps.find((step) => !entryByStep[step]) ??
    null;
  state.completed_steps = includedSteps.filter((step) => entryByStep[step]);
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
    const sequence = Number(entry.sequence) || includedSteps.indexOf(step) + 1;
    const observationFile = path.join(
      options.reportsRoot,
      `live-e2e-step-observation-${normalizedRunId}-${String(sequence).padStart(2, "0")}-${normalizeId(step)}.json`,
    );
    entry.observation_ref = observationFile;
    writeJson(observationFile, entry);
    entryByStep[step] = entry;

    const completed = includedSteps.filter((candidate) => entryByStep[candidate]);
    state.completed_steps = completed;
    state.current_step = resolveCurrentStep();
    state.pending_decision = entry.decision ?? null;
    state.evidence_refs = uniqueStrings([
      ...asStringArray(state.evidence_refs),
      observationFile,
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
   * @param {{ stage: string, stageResult?: Record<string, unknown>, commandResults: Array<Record<string, unknown>>, artifacts: Record<string, unknown> }} input
   * @returns {{ action: string, decision: Record<string, unknown> | null }}
   */
  function observeStage(input) {
    const step = asNonEmptyString(input.stage);
    if (!includedSteps.includes(step)) {
      return { action: "continue", decision: null };
    }
    if (entryByStep[step] && asNonEmptyString(asRecord(entryByStep[step].decision).action) === "continue") {
      return { action: "continue", decision: asRecord(entryByStep[step].decision) };
    }

    const stage = asRecord(input.stageResult);
    const command = findLiveE2eCommandByPreferredLabel(input.commandResults, getLiveE2eCommandLabelPriority(step)) ?? {};
    const artifactRefs = collectArtifactRefs(command, stage);
    const plan = buildLiveE2eStepPlan(step, command);
    const deterministicStatus =
      step === "delivery" &&
      (input.artifacts.delivery_blocking === true ||
        ["fail", "not_pass"].includes(asNonEmptyString(input.artifacts.delivery_quality_gate_status)))
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
          ])
        : [];
    const entry = {
      sequence: includedSteps.indexOf(step) + 1,
      step_id: step,
      flow_stage: step,
      plan,
      public_surface: asNonEmptyString(command.command_surface) || plan.public_surface,
      transcript_ref: asNonEmptyString(command.transcript_file) || null,
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
      semantic_analysis: {
        status: analysisStatus,
        judge_source: "deterministic-runner",
        findings:
          analysisStatus === "pass"
            ? []
            : uniqueStrings([
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
    entry.decision.action = resolveDecisionAction(entry);

    recordPhase(step, "plan", []);
    recordPhase(step, "execute", uniqueStrings([asNonEmptyString(entry.transcript_ref)]));
    recordPhase(step, "inspect", artifactRefs);
    recordPhase(step, "classify", artifactRefs);
    recordPhase(step, "decide", uniqueStrings([asNonEmptyString(entry.transcript_ref), ...artifactRefs]));
    recordPhase(step, "persist", []);
    persistStep(step, entry);
    state.artifacts_snapshot = JSON.parse(JSON.stringify(input.artifacts ?? {}));
    state.command_results = JSON.parse(JSON.stringify(input.commandResults ?? []));
    writeJson(stateFile, state);

    input.artifacts.live_e2e_controller_state_file = stateFile;
    input.artifacts.live_e2e_step_observation_files = Object.values(entryByStep).map((stepEntry) =>
      asNonEmptyString(stepEntry.observation_ref),
    );
    input.artifacts.live_e2e_step_journal_entries = includedSteps
      .filter((candidate) => entryByStep[candidate])
      .map((candidate) => entryByStep[candidate]);

    const action = asNonEmptyString(asRecord(entry.decision).action) || "continue";
    if (mode === "manual" || (mode === "evaluator" && action !== "continue") || (mode === "auto" && action !== "continue")) {
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
    includedSteps.filter((step) => asNonEmptyString(asRecord(entryByStep[step]?.decision).action) === "continue");

  return {
    mode,
    policy,
    includedSteps,
    stateFile,
    observeStage,
    getState: cloneState,
    hasPersistedProgress: () => asStringArray(state.completed_steps).length > 0,
    getCachedCommandResult: (label) => {
      const normalizedLabel = asNonEmptyString(label);
      if (!normalizedLabel) return null;
      const commandResults = Array.isArray(state.command_results)
        ? state.command_results.map((entry) => asRecord(entry))
        : [];
      return commandResults.find((entry) => asNonEmptyString(entry.label) === normalizedLabel) ?? null;
    },
    shouldUseCachedCommand: (label) => {
      const step = COMMAND_LABEL_STEP[asNonEmptyString(label)];
      return step ? completedContinueSteps().includes(step) : false;
    },
    getStepJournal: () => includedSteps.filter((step) => entryByStep[step]).map((step) => entryByStep[step]),
  };
}
