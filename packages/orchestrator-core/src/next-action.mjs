import fs from "node:fs";
import path from "node:path";

import { loadContractFile, validateContractDocument } from "../../contracts/src/index.mjs";
import { initializeProjectRuntime } from "./project-init.mjs";

const TERMINAL_RUN_STATUSES = new Set(["canceled", "cancelled", "completed", "failed", "pass", "fail", "aborted"]);
const DELIVERY_READY_STATUSES = new Set(["ready", "submitted", "ready-for-close", "completed", "pass"]);
const DEFAULT_RUNTIME_ROOT = ".aor";

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
function shellQuote(value) {
  return /^[A-Za-z0-9_./:@=-]+$/u.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeForFileName(value) {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "");
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
 * @param {Record<string, unknown>} document
 * @returns {boolean}
 */
function isClosureRunStepResult(document) {
  const stepClass = asString(document.step_class);
  if (stepClass === "runner" || stepClass === "repair" || stepClass === "eval" || stepClass === "harness") {
    return true;
  }
  const routedExecution = asRecord(document.routed_execution);
  const selectedStep = asRecord(asRecord(routedExecution.architecture_traceability).selected_step);
  const requestedStepClass = asString(selectedStep.step_class);
  return requestedStepClass === "implement" || requestedStepClass === "review" || requestedStepClass === "qa";
}

/**
 * @param {ReturnType<typeof initializeProjectRuntime>} init
 * @param {string} filePath
 * @param {string} family
 * @returns {{ family: string, file: string, artifact_ref: string, document: Record<string, unknown> } | null}
 */
function loadRuntimeDocument(init, filePath, family) {
  const document = readJsonFile(filePath);
  if (!document) return null;
  return {
    family,
    file: filePath,
    artifact_ref: toEvidenceRef(init.projectRoot, filePath),
    document,
  };
}

/**
 * @param {Record<string, unknown>} document
 * @param {string} runId
 * @returns {boolean}
 */
function documentReferencesRun(document, runId) {
  if (asString(document.run_id) === runId) return true;
  const normalizedRunRef = `run://${runId}`;
  return asStringArray(document.run_refs).some((ref) => ref === runId || ref === normalizedRunRef);
}

/**
 * @param {ReturnType<typeof initializeProjectRuntime>} init
 * @param {string} runId
 * @param {string} family
 * @param {RegExp} matcher
 * @param {"reports" | "artifacts"} root
 * @returns {{ family: string, file: string, artifact_ref: string, document: Record<string, unknown> } | null}
 */
function findLatestRunDocument(init, runId, family, matcher, root) {
  const rootPath = root === "reports" ? init.runtimeLayout.reportsRoot : init.runtimeLayout.artifactsRoot;
  for (const filePath of listJsonFiles(rootPath)) {
    if (!matcher.test(path.basename(filePath))) continue;
    const entry = loadRuntimeDocument(init, filePath, family);
    if (entry && documentReferencesRun(entry.document, runId)) {
      return entry;
    }
  }
  return null;
}

/**
 * @param {ReturnType<typeof initializeProjectRuntime>} init
 * @param {{ notBeforeMs?: number }} options
 * @returns {{ runId: string, evidenceRef: string } | null}
 */
function findLatestRunEvidence(init, options = {}) {
  /** @type {Array<{ runId: string, evidenceRef: string, file: string, priority: number }>} */
  const candidates = [];
  const addCandidate = (filePath, document, priority) => {
    if (priority === 40 && !isClosureRunStepResult(document)) {
      return;
    }
    if (typeof options.notBeforeMs === "number" && fs.statSync(filePath).mtimeMs < options.notBeforeMs) {
      return;
    }
    const runId = asString(document.run_id);
    if (runId) {
      candidates.push({ runId, evidenceRef: toEvidenceRef(init.projectRoot, filePath), file: filePath, priority });
      return;
    }
    const runRef = asStringArray(document.run_refs)[0];
    if (runRef) {
      candidates.push({
        runId: runRef.startsWith("run://") ? runRef.slice("run://".length) : runRef,
        evidenceRef: toEvidenceRef(init.projectRoot, filePath),
        file: filePath,
        priority,
      });
    }
  };

  for (const filePath of listJsonFiles(init.runtimeLayout.stateRoot)) {
    if (!path.basename(filePath).startsWith("run-control-state-")) continue;
    const state = readJsonFile(filePath);
    if (state) addCandidate(filePath, state, 30);
  }

  for (const filePath of listJsonFiles(init.runtimeLayout.reportsRoot)) {
    const basename = path.basename(filePath);
    const priority =
      /^learning-loop-handoff-.*\.json$/u.test(basename)
        ? 95
        : /^learning-loop-scorecard-.*\.json$/u.test(basename)
          ? 90
          : /^review-decision-.*\.json$/u.test(basename)
            ? 65
            : /^review-report.*\.json$/u.test(basename) || /^runtime-harness-report.*\.json$/u.test(basename)
              ? 60
              : /^step-result-.*\.json$/u.test(basename)
                ? 40
                : 0;
    if (priority === 0) {
      continue;
    }
    const document = readJsonFile(filePath);
    if (document) addCandidate(filePath, document, priority);
  }

  for (const filePath of listJsonFiles(init.runtimeLayout.artifactsRoot)) {
    const basename = path.basename(filePath);
    const priority =
      /^release-packet-.*\.json$/u.test(basename)
        ? 85
        : /^delivery-manifest-.*\.json$/u.test(basename)
          ? 80
          : /^delivery-plan-.*\.json$/u.test(basename)
            ? 75
            : 0;
    if (priority === 0) {
      continue;
    }
    const document = readJsonFile(filePath);
    if (document) addCandidate(filePath, document, priority);
  }

  candidates.sort((left, right) => {
    if (right.priority !== left.priority) return right.priority - left.priority;
    return fs.statSync(right.file).mtimeMs - fs.statSync(left.file).mtimeMs;
  });
  const latest = candidates[0] ?? null;
  return latest ? { runId: latest.runId, evidenceRef: latest.evidenceRef } : null;
}

/**
 * @param {Record<string, unknown>} document
 * @returns {string[]}
 */
function collectDocumentEvidenceRefs(document) {
  const sourceRefs = asRecord(document.source_refs);
  const evidenceLineage = asRecord(document.evidence_lineage);
  return uniqueStrings([
    ...asStringArray(document.evidence_refs),
    ...asStringArray(document.verification_refs),
    ...asStringArray(document.source_refs),
    ...asStringArray(sourceRefs.delivery_plan_ref ? [sourceRefs.delivery_plan_ref] : []),
    ...asStringArray(sourceRefs.delivery_transcript_ref ? [sourceRefs.delivery_transcript_ref] : []),
    ...asStringArray(document.delivery_manifest_ref ? [document.delivery_manifest_ref] : []),
    ...asStringArray(evidenceLineage.handoff_refs),
    ...asStringArray(evidenceLineage.promotion_refs),
    ...asStringArray(evidenceLineage.execution_refs),
    ...asStringArray(evidenceLineage.delivery_output_refs),
    ...asStringArray(evidenceLineage.coordination_refs),
    ...asStringArray(evidenceLineage.rerun_refs),
  ]);
}

/**
 * @param {string | null} status
 * @returns {boolean}
 */
function isDeliveryReadyStatus(status) {
  return status !== null && DELIVERY_READY_STATUSES.has(status);
}

/**
 * @param {{
 *   init: ReturnType<typeof initializeProjectRuntime>,
 *   runId: string | null,
 *   runEvidenceRef?: string | null,
 * }} options
 * @returns {Record<string, unknown>}
 */
function buildClosureState(options) {
  const runId = options.runId;
  const emptyEvidence = uniqueStrings([options.runEvidenceRef ?? null]);
  if (!runId) {
    return {
      run_id: null,
      review: {
        status: "not-started",
        review_report_ref: null,
        runtime_harness_report_ref: null,
        decision_ref: null,
        decision: null,
        delivery_gate_status: null,
        blocks_downstream: true,
        required_evidence_refs: [],
      },
      delivery: {
        status: "waiting-for-review",
        delivery_plan_ref: null,
        delivery_manifest_ref: null,
        release_packet_ref: null,
        release_packet_status: null,
        writeback_result: null,
        blocked_reasons: ["run-evidence-required"],
        requires_review_decision: true,
      },
      learning: {
        status: "waiting-for-release",
        scorecard_ref: null,
        handoff_ref: null,
        linked_evidence_refs: [],
      },
      evidence_chain: emptyEvidence,
    };
  }

  const reviewReport = findLatestRunDocument(
    options.init,
    runId,
    "review-report",
    /^review-report.*\.json$/u,
    "reports",
  );
  const runtimeHarnessReport = findLatestRunDocument(
    options.init,
    runId,
    "runtime-harness-report",
    /^runtime-harness-report.*\.json$/u,
    "reports",
  );
  const reviewDecision = findLatestRunDocument(
    options.init,
    runId,
    "review-decision",
    /^review-decision-.*\.json$/u,
    "reports",
  );
  const deliveryPlan = findLatestRunDocument(
    options.init,
    runId,
    "delivery-plan",
    /^delivery-plan-.*\.json$/u,
    "artifacts",
  );
  const deliveryManifest = findLatestRunDocument(
    options.init,
    runId,
    "delivery-manifest",
    /^delivery-manifest-.*\.json$/u,
    "artifacts",
  );
  const releasePacket = findLatestRunDocument(
    options.init,
    runId,
    "release-packet",
    /^release-packet-.*\.json$/u,
    "artifacts",
  );
  const learningScorecard = findLatestRunDocument(
    options.init,
    runId,
    "learning-loop-scorecard",
    /^learning-loop-scorecard-.*\.json$/u,
    "reports",
  );
  const learningHandoff = findLatestRunDocument(
    options.init,
    runId,
    "learning-loop-handoff",
    /^learning-loop-handoff-.*\.json$/u,
    "reports",
  );

  const decision = asString(reviewDecision?.document.decision);
  const deliveryGate = asRecord(reviewDecision?.document.delivery_gate);
  const deliveryGateStatus = asString(deliveryGate.status);
  const blocksDownstream = deliveryGate.blocks_downstream === true;
  const approved =
    decision === "approve" &&
    deliveryGateStatus === "pass" &&
    blocksDownstream !== true;
  const reviewStatus = !reviewReport && !runtimeHarnessReport
    ? "missing"
    : !reviewDecision
      ? "decision-required"
      : approved
        ? "approved"
        : decision === "hold"
          ? "held"
          : decision === "request-repair"
            ? "repair-requested"
            : "blocked";
  const deliveryPlanStatus = asString(deliveryPlan?.document.status);
  const releasePacketStatus = asString(releasePacket?.document.status);
  const deliveryPlanBlockers = asStringArray(deliveryPlan?.document.blocking_reasons);
  const releaseRisks = asStringArray(releasePacket?.document.residual_risks);
  const reviewRequiredReason = approved ? [] : ["approved-review-decision-required"];
  const deliveryBlockedReasons = uniqueStrings([...reviewRequiredReason, ...deliveryPlanBlockers, ...releaseRisks]);
  const deliveryStatus = !approved
    ? "blocked-review-required"
    : deliveryPlanStatus === "blocked" || releasePacketStatus === "blocked" || deliveryPlanBlockers.length > 0 || releaseRisks.length > 0
      ? "blocked"
      : releasePacket && isDeliveryReadyStatus(releasePacketStatus)
        ? "release-ready"
        : deliveryManifest
          ? "delivery-prepared"
          : deliveryPlan
            ? isDeliveryReadyStatus(deliveryPlanStatus)
              ? "delivery-plan-ready"
              : "delivery-plan-pending"
            : "ready-to-prepare";
  const repoDeliveries = Array.isArray(deliveryManifest?.document.repo_deliveries)
    ? deliveryManifest.document.repo_deliveries
    : [];
  const writebackResult = repoDeliveries
    .map((entry) => asString(asRecord(entry).writeback_result))
    .find((entry) => entry !== null) ?? null;
  const learningStatus = learningHandoff
    ? "handoff-complete"
    : releasePacket && isDeliveryReadyStatus(releasePacketStatus)
      ? "ready-for-handoff"
      : "waiting-for-release";
  const evidenceChain = uniqueStrings([
    options.runEvidenceRef ?? null,
    reviewReport?.artifact_ref,
    runtimeHarnessReport?.artifact_ref,
    reviewDecision?.artifact_ref,
    deliveryPlan?.artifact_ref,
    deliveryManifest?.artifact_ref,
    releasePacket?.artifact_ref,
    learningScorecard?.artifact_ref,
    learningHandoff?.artifact_ref,
    ...collectDocumentEvidenceRefs(reviewReport?.document ?? {}),
    ...collectDocumentEvidenceRefs(runtimeHarnessReport?.document ?? {}),
    ...collectDocumentEvidenceRefs(reviewDecision?.document ?? {}),
    ...collectDocumentEvidenceRefs(deliveryPlan?.document ?? {}),
    ...collectDocumentEvidenceRefs(deliveryManifest?.document ?? {}),
    ...collectDocumentEvidenceRefs(releasePacket?.document ?? {}),
    ...collectDocumentEvidenceRefs(learningScorecard?.document ?? {}),
    ...collectDocumentEvidenceRefs(learningHandoff?.document ?? {}),
  ]);

  return {
    run_id: runId,
    review: {
      status: reviewStatus,
      review_report_ref: reviewReport?.artifact_ref ?? null,
      runtime_harness_report_ref: runtimeHarnessReport?.artifact_ref ?? null,
      decision_ref: reviewDecision?.artifact_ref ?? null,
      decision: decision ?? null,
      delivery_gate_status: deliveryGateStatus,
      blocks_downstream: blocksDownstream || !approved,
      required_evidence_refs: uniqueStrings([
        reviewReport?.artifact_ref,
        runtimeHarnessReport?.artifact_ref,
        reviewDecision?.artifact_ref,
      ]),
    },
    delivery: {
      status: deliveryStatus,
      delivery_plan_ref: deliveryPlan?.artifact_ref ?? null,
      delivery_manifest_ref: deliveryManifest?.artifact_ref ?? null,
      release_packet_ref: releasePacket?.artifact_ref ?? null,
      release_packet_status: releasePacketStatus,
      writeback_result: writebackResult,
      blocked_reasons: deliveryBlockedReasons,
      requires_review_decision: true,
    },
    learning: {
      status: learningStatus,
      scorecard_ref: learningScorecard?.artifact_ref ?? null,
      handoff_ref: learningHandoff?.artifact_ref ?? null,
      linked_evidence_refs: uniqueStrings([
        learningScorecard?.artifact_ref,
        learningHandoff?.artifact_ref,
        ...asStringArray(learningScorecard?.document.evidence_refs),
        ...asStringArray(learningHandoff?.document.evidence_refs),
      ]),
    },
    evidence_chain: evidenceChain,
  };
}

/**
 * @param {{
 *   projectRoot: string,
 *   runId: string,
 *   closureState: Record<string, unknown>,
 *   evidenceRefs: string[],
 *   missionState: Record<string, unknown>,
 * }} options
 * @returns {{ status: string, stage: string, primaryAction: Record<string, unknown>, blockers: Array<Record<string, unknown>> }}
 */
function resolveClosureAction(options) {
  const review = asRecord(options.closureState.review);
  const delivery = asRecord(options.closureState.delivery);
  const learning = asRecord(options.closureState.learning);
  const reviewStatus = asString(review.status);
  const deliveryStatus = asString(delivery.status);
  const learningStatus = asString(learning.status);
  const evidenceRefs = uniqueStrings([...options.evidenceRefs, ...asStringArray(options.closureState.evidence_chain)]);

  if (reviewStatus === "missing") {
    return {
      status: "ready",
      stage: "review",
      blockers: [],
      primaryAction: {
        action_id: "review-run",
        command: `${projectCommand("review run", options.projectRoot)} --run-id ${shellQuote(options.runId)}`,
        reason: "Execution evidence exists; run review and Runtime Harness checks before any delivery-capable action.",
        low_level_command: "review run",
        evidence_refs: evidenceRefs,
      },
    };
  }

  if (reviewStatus === "decision-required") {
    return {
      status: "ready",
      stage: "review",
      blockers: [],
      primaryAction: {
        action_id: "review-decide",
        command: `${projectCommand("review decide", options.projectRoot)} --run-id ${shellQuote(options.runId)} --decision approve`,
        reason: "Review and Runtime Harness evidence exist; the operator must approve, hold, or request repair before delivery.",
        low_level_command: "review decide",
        evidence_refs: evidenceRefs,
      },
    };
  }

  if (reviewStatus === "held") {
    const nextCommand = `${projectCommand("review decide", options.projectRoot)} --run-id ${shellQuote(options.runId)} --decision approve`;
    return {
      status: "blocked",
      stage: "review",
      blockers: [
        createBlocker({
          projectRoot: options.projectRoot,
          code: "review-held",
          summary: "Latest review decision is hold; delivery and release stay blocked until the operator records an approved decision.",
          evidenceRefs: asStringArray(review.required_evidence_refs),
          nextCommand,
        }),
      ],
      primaryAction: {
        action_id: "resolve-review-hold",
        command: nextCommand,
        reason: "A hold decision intentionally blocks downstream delivery and release preparation.",
        low_level_command: "review decide",
        evidence_refs: evidenceRefs,
      },
    };
  }

  if (reviewStatus === "repair-requested") {
    const nextCommand = `${projectCommand("run start", options.projectRoot)} --run-id ${shellQuote(`${options.runId}.repair`)} --target-step implement`;
    return {
      status: "blocked",
      stage: "review",
      blockers: [
        createBlocker({
          projectRoot: options.projectRoot,
          code: "review-repair-requested",
          summary: "Latest review decision requests repair; delivery and release must wait for repaired execution evidence.",
          evidenceRefs: asStringArray(review.required_evidence_refs),
          nextCommand,
        }),
      ],
      primaryAction: {
        action_id: "run-review-repair",
        command: nextCommand,
        reason: "Repair was requested before delivery can proceed.",
        low_level_command: "run start",
        evidence_refs: evidenceRefs,
      },
    };
  }

  if (reviewStatus !== "approved") {
    const nextCommand = `${projectCommand("review decide", options.projectRoot)} --run-id ${shellQuote(options.runId)} --decision request-repair`;
    return {
      status: "blocked",
      stage: "review",
      blockers: [
        createBlocker({
          projectRoot: options.projectRoot,
          code: "review-approval-blocked",
          summary: "Review decision evidence is present but does not pass the downstream delivery gate.",
          evidenceRefs: asStringArray(review.required_evidence_refs),
          nextCommand,
        }),
      ],
      primaryAction: {
        action_id: "repair-review-gate",
        command: nextCommand,
        reason: "Downstream delivery is blocked until the review decision gate passes.",
        low_level_command: "review decide",
        evidence_refs: evidenceRefs,
      },
    };
  }

  if (learningStatus === "handoff-complete") {
    const learningHandoffRef = asString(learning.handoff_ref);
    const followUpCommand = [
      `${projectCommand("mission create", options.projectRoot)} --delivery-mode no-write`,
      ...(learningHandoffRef ? [`--follow-up-source-handoff-ref ${shellQuote(learningHandoffRef)}`] : []),
    ].join(" ");

    return {
      status: "ready",
      stage: "learning",
      blockers: [],
      primaryAction: {
        action_id: "start-new-flow",
        command: followUpCommand,
        reason: "Review, delivery, release, and learning evidence are linked; start a fresh follow-up flow while keeping the completed flow read-only.",
        low_level_command: "mission create",
        evidence_refs: evidenceRefs,
      },
    };
  }

  if (deliveryStatus === "blocked") {
    const nextCommand = `${projectCommand("deliver prepare", options.projectRoot)} --run-id ${shellQuote(options.runId)} --require-review-decision`;
    return {
      status: "blocked",
      stage: "delivery",
      blockers: asStringArray(delivery.blocked_reasons).map((reason) =>
        createBlocker({
          projectRoot: options.projectRoot,
          code: reason,
          summary: `Delivery or release preparation is blocked: ${reason}.`,
          evidenceRefs,
          nextCommand,
        }),
      ),
      primaryAction: {
        action_id: "fix-delivery-blockers",
        command: nextCommand,
        reason: "Delivery evidence exists but its safety gates are not ready.",
        low_level_command: "deliver prepare",
        evidence_refs: evidenceRefs,
      },
    };
  }

  if (deliveryStatus === "ready-to-prepare" || deliveryStatus === "delivery-plan-pending") {
    return {
      status: "ready",
      stage: "delivery",
      blockers: [],
      primaryAction: {
        action_id: "delivery-prepare",
        command: `${projectCommand("deliver prepare", options.projectRoot)} --run-id ${shellQuote(options.runId)} --require-review-decision`,
        reason: "Approved review evidence exists; prepare delivery while enforcing the review decision gate.",
        low_level_command: "deliver prepare",
        evidence_refs: evidenceRefs,
      },
    };
  }

  if (deliveryStatus === "delivery-plan-ready" || deliveryStatus === "delivery-prepared") {
    return {
      status: "ready",
      stage: "release",
      blockers: [],
      primaryAction: {
        action_id: "release-prepare",
        command: `${projectCommand("release prepare", options.projectRoot)} --run-id ${shellQuote(options.runId)} --require-review-decision`,
        reason: "Delivery evidence is prepared; generate release readiness evidence with the same approval gate.",
        low_level_command: "release prepare",
        evidence_refs: evidenceRefs,
      },
    };
  }

  if (learningStatus !== "handoff-complete") {
    return {
      status: "ready",
      stage: "learning",
      blockers: [],
      primaryAction: {
        action_id: "learning-handoff",
        command: `${projectCommand("learning handoff", options.projectRoot)} --run-id ${shellQuote(options.runId)}`,
        reason: "Release-ready evidence exists; close the run with a learning scorecard and handoff chain.",
        low_level_command: "learning handoff",
        evidence_refs: evidenceRefs,
      },
    };
  }

  const learningHandoffRef = asString(learning.handoff_ref);
  const followUpCommand = [
    `${projectCommand("mission create", options.projectRoot)} --delivery-mode no-write`,
    ...(learningHandoffRef ? [`--follow-up-source-handoff-ref ${shellQuote(learningHandoffRef)}`] : []),
  ].join(" ");

  return {
    status: "ready",
    stage: "learning",
    blockers: [],
    primaryAction: {
      action_id: "start-new-flow",
      command: followUpCommand,
      reason: "Review, delivery, release, and learning evidence are linked; start a fresh follow-up flow while keeping the completed flow read-only.",
      low_level_command: "mission create",
      evidence_refs: evidenceRefs,
    },
  };
}

/**
 * @param {string} command
 * @param {string} projectRoot
 * @returns {string}
 */
function projectCommand(command, projectRoot) {
  return `aor ${command} --project-ref ${shellQuote(projectRoot)}`;
}

/**
 * @param {string} projectRoot
 * @returns {string}
 */
function defaultRuntimeRoot(projectRoot) {
  return path.resolve(projectRoot, DEFAULT_RUNTIME_ROOT);
}

/**
 * @param {{ projectRoot: string, runtimeRoot: string, explicitRuntimeRoot?: boolean }} options
 * @returns {boolean}
 */
function shouldIncludeRuntimeRoot(options) {
  return options.explicitRuntimeRoot === true || path.resolve(options.runtimeRoot) !== defaultRuntimeRoot(options.projectRoot);
}

/**
 * @param {string} command
 * @param {string} runtimeRoot
 * @param {boolean} includeRuntimeRoot
 * @returns {string}
 */
function appendRuntimeRootFlag(command, runtimeRoot, includeRuntimeRoot) {
  if (!includeRuntimeRoot || /\s--runtime-root(?:\s|=)/u.test(command)) {
    return command;
  }
  return `${command} --runtime-root ${shellQuote(runtimeRoot)}`;
}

/**
 * @param {Record<string, unknown>} action
 * @param {string} runtimeRoot
 * @param {boolean} includeRuntimeRoot
 * @returns {Record<string, unknown>}
 */
function withRuntimeRootActionCommand(action, runtimeRoot, includeRuntimeRoot) {
  const command = asString(action.command);
  return command
    ? {
        ...action,
        command: appendRuntimeRootFlag(command, runtimeRoot, includeRuntimeRoot),
      }
    : action;
}

/**
 * @param {Array<Record<string, unknown>>} blockers
 * @param {string} runtimeRoot
 * @param {boolean} includeRuntimeRoot
 * @returns {Array<Record<string, unknown>>}
 */
function withRuntimeRootBlockerCommands(blockers, runtimeRoot, includeRuntimeRoot) {
  return blockers.map((blocker) => {
    const nextCommand = asString(blocker.next_command);
    return nextCommand
      ? {
          ...blocker,
          next_command: appendRuntimeRootFlag(nextCommand, runtimeRoot, includeRuntimeRoot),
        }
      : blocker;
  });
}

/**
 * @param {ReturnType<typeof initializeProjectRuntime>} init
 * @returns {{ packetFile: string, bodyFile: string | null, packet: Record<string, unknown>, body: Record<string, unknown> | null } | null}
 */
function findLatestIntakePacket(init) {
  for (const filePath of listJsonFiles(init.runtimeLayout.artifactsRoot)) {
    if (!path.basename(filePath).includes(".artifact.intake.")) continue;
    const packet = readJsonFile(filePath);
    if (asString(packet?.packet_type) !== "intake-request") continue;
    const bodyFile = asString(packet?.body_ref);
    return {
      packetFile: filePath,
      bodyFile,
      packet,
      body: bodyFile && fs.existsSync(bodyFile) ? readJsonFile(bodyFile) : null,
    };
  }
  return null;
}

/**
 * @param {ReturnType<typeof initializeProjectRuntime>} init
 * @returns {{ stateFile: string, state: Record<string, unknown> } | null}
 */
function findActiveRun(init) {
  for (const filePath of listJsonFiles(init.runtimeLayout.stateRoot)) {
    if (!path.basename(filePath).startsWith("run-control-state-")) continue;
    const state = readJsonFile(filePath);
    const status = asString(state?.status);
    if (status && !TERMINAL_RUN_STATUSES.has(status)) {
      return { stateFile: filePath, state };
    }
  }
  return null;
}

/**
 * @param {ReturnType<typeof initializeProjectRuntime>} init
 * @returns {Record<string, unknown>}
 */
function loadProjectProfileDocument(init) {
  const loaded = loadContractFile({
    filePath: init.projectProfilePath,
    family: "project-profile",
  });
  return loaded.ok ? asRecord(loaded.document) : {};
}

/**
 * @param {ReturnType<typeof initializeProjectRuntime>} init
 * @returns {{ mode: "strict" | "soft", allow_incomplete_research_for_spec: boolean, reason: string | null }}
 */
function resolveArtifactReadinessPolicy(init) {
  const profile = loadProjectProfileDocument(init);
  const policy = asRecord(profile.artifact_readiness_policy);
  const research = asRecord(policy.research);
  const allowIncomplete =
    research.allow_incomplete_for_spec === true ||
    asString(research.incomplete_research_for_spec) === "allow";
  return {
    mode: allowIncomplete ? "soft" : "strict",
    allow_incomplete_research_for_spec: allowIncomplete,
    reason: asString(research.reason),
  };
}

/**
 * @param {string} filePath
 * @returns {number | null}
 */
function fileMtimeMs(filePath) {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * @param {ReturnType<typeof initializeProjectRuntime>} init
 * @param {"reports" | "artifacts"} root
 * @param {string} family
 * @param {(document: Record<string, unknown>, filePath: string) => boolean} predicate
 * @returns {{ family: string, file: string, artifact_ref: string, document: Record<string, unknown>, mtime_ms: number } | null}
 */
function findLatestRuntimeEvidence(init, root, family, predicate) {
  const rootPath = root === "reports" ? init.runtimeLayout.reportsRoot : init.runtimeLayout.artifactsRoot;
  for (const filePath of listJsonFiles(rootPath)) {
    const document = readJsonFile(filePath);
    if (!document || !predicate(document, filePath)) continue;
    return {
      family,
      file: filePath,
      artifact_ref: toEvidenceRef(init.projectRoot, filePath),
      document,
      mtime_ms: fileMtimeMs(filePath) ?? 0,
    };
  }
  return null;
}

/**
 * @param {ReturnType<typeof initializeProjectRuntime>} init
 */
function findAnalysisEvidence(init) {
  return findLatestRuntimeEvidence(
    init,
    "reports",
    "project-analysis-report",
    (document, filePath) =>
      path.basename(filePath) === "project-analysis-report.json" ||
      Boolean(asString(document.report_id)?.includes(".analysis.")) ||
      Boolean(asRecord(document.discovery_completeness).status),
  );
}

/**
 * @param {ReturnType<typeof initializeProjectRuntime>} init
 * @param {{ family: string, file: string, artifact_ref: string, document: Record<string, unknown>, mtime_ms: number } | null} analysis
 */
function findResearchEvidence(init, analysis) {
  return (
    findLatestRuntimeEvidence(
      init,
      "reports",
      "discovery-research-report",
      (document, filePath) =>
        path.basename(filePath) === "discovery-research-report.json" ||
        Boolean(asString(document.report_id)?.includes(".discovery-research.")) ||
        Boolean(asRecord(document.research_inputs).source_refs),
    ) ??
    (asRecord(analysis?.document.discovery_research).status
      ? {
          family: "project-analysis-report",
          file: analysis?.file ?? "",
          artifact_ref: analysis?.artifact_ref ?? "",
          document: asRecord(analysis?.document.discovery_research),
          mtime_ms: analysis?.mtime_ms ?? 0,
        }
      : null)
  );
}

/**
 * @param {ReturnType<typeof initializeProjectRuntime>} init
 */
function findSpecEvidence(init) {
  return findLatestRuntimeEvidence(init, "reports", "step-result", (document) => {
    const routedExecution = asRecord(document.routed_execution);
    const selectedStep = asRecord(asRecord(routedExecution.architecture_traceability).selected_step);
    return asString(selectedStep.step_class) === "spec";
  });
}

/**
 * @param {ReturnType<typeof initializeProjectRuntime>} init
 */
function findPlanningEvidence(init) {
  return findLatestRuntimeEvidence(init, "artifacts", "planning-artifact", (document, filePath) => {
    const basename = path.basename(filePath);
    return (
      basename.startsWith("wave-ticket-") ||
      /^.+\.handoff\..*\.json$/u.test(basename) ||
      asString(document.status) === "ready-for-handoff" ||
      asString(document.status) === "pending-approval"
    );
  });
}

/**
 * @param {Array<{ name: string, mtime_ms: number | null }>} upstreams
 * @param {number | null} evidenceMtime
 * @param {string} stage
 * @returns {string[]}
 */
function staleReasons(upstreams, evidenceMtime, stage) {
  if (typeof evidenceMtime !== "number") return [];
  return upstreams
    .filter((upstream) => typeof upstream.mtime_ms === "number" && upstream.mtime_ms > evidenceMtime)
    .map((upstream) => `${upstream.name}-changed-after-${stage}`);
}

/**
 * @param {{
 *   status: string,
 *   evidenceRef?: string | null,
 *   reason: string,
 *   blockedReasons?: string[],
 *   staleReasons?: string[],
 *   requiredEvidenceRefs?: string[],
 *   softDecision?: Record<string, unknown> | null,
 * }} options
 */
function readinessStage(options) {
  return {
    status: options.status,
    evidence_ref: options.evidenceRef ?? null,
    reason: options.reason,
    blocked_reasons: options.blockedReasons ?? [],
    stale_reasons: options.staleReasons ?? [],
    required_evidence_refs: options.requiredEvidenceRefs ?? [],
    soft_decision: options.softDecision ?? null,
  };
}

/**
 * @param {{
 *   init: ReturnType<typeof initializeProjectRuntime>,
 *   intake: { packetFile: string, bodyFile: string | null, packet: Record<string, unknown>, body: Record<string, unknown> | null } | null,
 *   missionState: Record<string, unknown>,
 * }} options
 */
function buildArtifactReadiness(options) {
  const policy = resolveArtifactReadinessPolicy(options.init);
  const packetRef = options.intake ? toEvidenceRef(options.init.projectRoot, options.intake.packetFile) : null;
  const bodyRef = options.intake?.bodyFile ? toEvidenceRef(options.init.projectRoot, options.intake.bodyFile) : null;
  const missionMtime = Math.max(
    fileMtimeMs(options.intake?.packetFile ?? "") ?? 0,
    fileMtimeMs(options.intake?.bodyFile ?? "") ?? 0,
  );
  const missionComplete = asString(options.missionState.completeness_status) === "complete";
  const missionStage = !options.intake
    ? readinessStage({
        status: "pending",
        reason: "Mission intake has not been materialized.",
        blockedReasons: ["intake-request-required"],
      })
    : !options.intake.body || !missionComplete
      ? readinessStage({
          status: "blocked",
          evidenceRef: packetRef,
          reason: "Mission intake is incomplete or unreadable.",
          blockedReasons: asStringArray(options.missionState.missing_fields).length > 0
            ? asStringArray(options.missionState.missing_fields)
            : ["intake-body-readable-required"],
          requiredEvidenceRefs: uniqueStrings([packetRef, bodyRef]),
        })
      : readinessStage({
          status: "complete",
          evidenceRef: packetRef,
          reason: "Mission intake is complete and current.",
          requiredEvidenceRefs: uniqueStrings([packetRef, bodyRef]),
        });

  const analysis = findAnalysisEvidence(options.init);
  const research = findResearchEvidence(options.init, analysis);
  const spec = findSpecEvidence(options.init);
  const planning = findPlanningEvidence(options.init);
  const missionUpstream = [{ name: "mission", mtime_ms: missionMtime }];
  const discoveryStale = staleReasons(missionUpstream, analysis?.mtime_ms ?? null, "discovery");
  const discoveryCompleteness = asRecord(analysis?.document.discovery_completeness);
  const discoveryBlocking = discoveryCompleteness.blocking === true || asString(discoveryCompleteness.status) === "fail";
  const discoveryStage = !missionComplete
    ? readinessStage({
        status: "pending",
        reason: "Discovery waits for complete mission intake.",
        blockedReasons: ["mission-complete-required"],
        requiredEvidenceRefs: uniqueStrings([packetRef, bodyRef]),
      })
    : !analysis
      ? readinessStage({
          status: "pending",
          reason: "Discovery evidence has not been materialized.",
          requiredEvidenceRefs: uniqueStrings([packetRef, bodyRef]),
        })
      : discoveryStale.length > 0
        ? readinessStage({
            status: "stale",
            evidenceRef: analysis.artifact_ref,
            reason: "Mission intake changed after discovery evidence was created.",
            staleReasons: discoveryStale,
            requiredEvidenceRefs: uniqueStrings([packetRef, bodyRef, analysis.artifact_ref]),
          })
        : discoveryBlocking
          ? readinessStage({
              status: "blocked",
              evidenceRef: analysis.artifact_ref,
              reason: "Discovery completeness checks are blocking downstream spec readiness.",
              blockedReasons: asStringArray(discoveryCompleteness.checks).length > 0
                ? ["discovery-completeness-failed"]
                : [asString(discoveryCompleteness.status) ?? "discovery-blocked"],
              requiredEvidenceRefs: uniqueStrings([analysis.artifact_ref]),
            })
          : readinessStage({
              status: "complete",
              evidenceRef: analysis.artifact_ref,
              reason: "Discovery evidence is complete and current.",
              requiredEvidenceRefs: uniqueStrings([analysis.artifact_ref]),
            });

  const researchStatus = asString(research?.document.status) ?? asString(asRecord(research?.document.completeness).status);
  const researchBlocking = asRecord(research?.document.completeness).blocking === true;
  const researchStale = staleReasons(
    [
      ...missionUpstream,
      { name: "discovery", mtime_ms: analysis?.mtime_ms ?? null },
    ],
    research?.mtime_ms ?? null,
    "research",
  );
  const researchStage = discoveryStage.status === "pending" || discoveryStage.status === "blocked"
    ? readinessStage({
        status: "pending",
        reason: "Research waits for complete discovery evidence.",
        blockedReasons: ["discovery-complete-required"],
        requiredEvidenceRefs: uniqueStrings([analysis?.artifact_ref]),
      })
    : !research
      ? readinessStage({
          status: "pending",
          reason: "Research evidence has not been materialized.",
          requiredEvidenceRefs: uniqueStrings([analysis?.artifact_ref]),
        })
      : researchStale.length > 0
        ? readinessStage({
            status: "stale",
            evidenceRef: research.artifact_ref,
            reason: "Mission or discovery evidence changed after research evidence was created.",
            staleReasons: researchStale,
            requiredEvidenceRefs: uniqueStrings([analysis?.artifact_ref, research.artifact_ref]),
          })
        : researchStatus === "adr-ready" && !researchBlocking
          ? readinessStage({
              status: "adr-ready",
              evidenceRef: research.artifact_ref,
              reason: "Research evidence is ADR-ready.",
              requiredEvidenceRefs: uniqueStrings([research.artifact_ref]),
            })
          : policy.allow_incomplete_research_for_spec && researchStatus === "incomplete"
            ? readinessStage({
                status: "incomplete",
                evidenceRef: research.artifact_ref,
                reason: "Incomplete research is explicitly allowed by the project readiness policy.",
                blockedReasons: [],
                requiredEvidenceRefs: uniqueStrings([research.artifact_ref]),
                softDecision: {
                  allowed: true,
                  reason: policy.reason ?? "project-profile artifact_readiness_policy allows incomplete research for spec",
                  profile_field: "artifact_readiness_policy.research.allow_incomplete_for_spec",
                },
              })
            : readinessStage({
                status: "blocked",
                evidenceRef: research.artifact_ref,
                reason: "Research is not ADR-ready under the strict readiness policy.",
                blockedReasons: ["research-adr-ready-required"],
                requiredEvidenceRefs: uniqueStrings([research.artifact_ref]),
              });

  const specStale = staleReasons(
    [
      ...missionUpstream,
      { name: "discovery", mtime_ms: analysis?.mtime_ms ?? null },
      { name: "research", mtime_ms: research?.mtime_ms ?? null },
    ],
    spec?.mtime_ms ?? null,
    "spec",
  );
  const researchCanFeedSpec = researchStage.status === "adr-ready" || researchStage.status === "incomplete";
  const specStatus = asString(spec?.document.status);
  const specStage = !researchCanFeedSpec
    ? readinessStage({
        status: "blocked",
        evidenceRef: spec?.artifact_ref,
        reason: "Spec cannot be ready until current discovery and research evidence are consumable.",
        blockedReasons: ["current-discovery-and-research-required"],
        requiredEvidenceRefs: uniqueStrings([analysis?.artifact_ref, research?.artifact_ref]),
      })
    : !spec
      ? readinessStage({
          status: "pending",
          reason: "Spec evidence has not been materialized.",
          requiredEvidenceRefs: uniqueStrings([analysis?.artifact_ref, research?.artifact_ref]),
        })
      : specStale.length > 0
        ? readinessStage({
            status: "stale",
            evidenceRef: spec.artifact_ref,
            reason: "Mission, discovery, or research evidence changed after spec evidence was created.",
            staleReasons: specStale,
            requiredEvidenceRefs: uniqueStrings([analysis?.artifact_ref, research?.artifact_ref, spec.artifact_ref]),
          })
        : specStatus === "pass" || specStatus === "passed"
          ? readinessStage({
              status: "ready",
              evidenceRef: spec.artifact_ref,
              reason: "Spec evidence is current and can feed planning.",
              requiredEvidenceRefs: uniqueStrings([analysis?.artifact_ref, research?.artifact_ref, spec.artifact_ref]),
            })
          : readinessStage({
              status: "blocked",
              evidenceRef: spec.artifact_ref,
              reason: "Spec evidence exists but did not pass.",
              blockedReasons: [specStatus ?? "spec-not-passing"],
              requiredEvidenceRefs: uniqueStrings([spec.artifact_ref]),
            });

  const planningStale = staleReasons([{ name: "spec", mtime_ms: spec?.mtime_ms ?? null }], planning?.mtime_ms ?? null, "planning");
  const planningStage = specStage.status !== "ready"
    ? readinessStage({
        status: "blocked",
        evidenceRef: planning?.artifact_ref,
        reason: "Planning waits for current ready spec evidence.",
        blockedReasons: ["spec-ready-required"],
        requiredEvidenceRefs: uniqueStrings([spec?.artifact_ref]),
      })
    : !planning
      ? readinessStage({
          status: "pending",
          reason: "Planning handoff evidence has not been materialized.",
          requiredEvidenceRefs: uniqueStrings([spec.artifact_ref]),
        })
      : planningStale.length > 0
        ? readinessStage({
            status: "stale",
            evidenceRef: planning.artifact_ref,
            reason: "Spec evidence changed after planning handoff evidence was created.",
            staleReasons: planningStale,
            requiredEvidenceRefs: uniqueStrings([spec.artifact_ref, planning.artifact_ref]),
          })
        : readinessStage({
            status: "ready",
            evidenceRef: planning.artifact_ref,
            reason: "Planning evidence is current.",
            requiredEvidenceRefs: uniqueStrings([spec.artifact_ref, planning.artifact_ref]),
          });

  return {
    policy,
    stages: {
      mission: missionStage,
      discovery: discoveryStage,
      research: researchStage,
      spec: specStage,
      planning: planningStage,
    },
  };
}

/**
 * @param {{ projectRoot: string, code: string, summary: string, evidenceRefs?: string[], nextCommand: string }} blocker
 * @returns {Record<string, unknown>}
 */
function createBlocker(blocker) {
  return {
    code: blocker.code,
    summary: blocker.summary,
    evidence_refs: blocker.evidenceRefs ?? [],
    next_command: blocker.nextCommand,
  };
}

/**
 * @param {Record<string, unknown>} readiness
 * @param {string} stage
 * @returns {Record<string, unknown>}
 */
function artifactReadinessStage(readiness, stage) {
  return asRecord(asRecord(readiness.stages)[stage]);
}

/**
 * @param {Record<string, unknown>} stage
 * @returns {string[]}
 */
function artifactReadinessEvidenceRefs(stage) {
  return uniqueStrings([asString(stage.evidence_ref), ...asStringArray(stage.required_evidence_refs)]);
}

/**
 * @param {string} stageName
 * @param {Record<string, unknown>} stage
 * @returns {string}
 */
function artifactReadinessBlockerCode(stageName, stage) {
  const stale = asStringArray(stage.stale_reasons);
  if (stale.length > 0) {
    return `${stageName}-stale`;
  }
  const blocked = asStringArray(stage.blocked_reasons);
  return blocked[0] ?? `${stageName}-blocked`;
}

/**
 * @param {{
 *   projectRoot: string,
 *   stageName: string,
 *   stage: Record<string, unknown>,
 *   nextCommand: string,
 * }} options
 * @returns {Record<string, unknown>}
 */
function createArtifactReadinessBlocker(options) {
  return createBlocker({
    projectRoot: options.projectRoot,
    code: artifactReadinessBlockerCode(options.stageName, options.stage),
    summary: asString(options.stage.reason) ?? `${options.stageName} readiness is blocked.`,
    evidenceRefs: artifactReadinessEvidenceRefs(options.stage),
    nextCommand: options.nextCommand,
  });
}

/**
 * @param {Record<string, unknown> | null} body
 * @returns {{ deliveryMode: string, allowedPaths: string[], forbiddenPaths: string[], missingFields: string[], missionId: string | null, completenessStatus: string }}
 */
function resolveMissionState(body) {
  const missionTraceability = asRecord(body?.mission_traceability);
  const featureRequest = asRecord(body?.feature_request);
  const requestDocument = asRecord(featureRequest.request_document);
  const missionScope = asRecord(body?.mission_scope);
  const completeness = asRecord(body?.product_intake_completeness);
  return {
    deliveryMode:
      asString(missionScope.delivery_mode) ??
      asString(missionTraceability.delivery_mode) ??
      asString(featureRequest.delivery_mode) ??
      asString(requestDocument.delivery_mode) ??
      asString(requestDocument.write_mode) ??
      "no-write",
    allowedPaths: asStringArray(missionScope.allowed_paths).length > 0
      ? asStringArray(missionScope.allowed_paths)
      : asStringArray(featureRequest.allowed_paths).length > 0
        ? asStringArray(featureRequest.allowed_paths)
        : asStringArray(requestDocument.allowed_paths),
    forbiddenPaths: asStringArray(missionScope.forbidden_paths).length > 0
      ? asStringArray(missionScope.forbidden_paths)
      : asStringArray(featureRequest.forbidden_paths).length > 0
        ? asStringArray(featureRequest.forbidden_paths)
        : asStringArray(requestDocument.forbidden_paths),
    missingFields: asStringArray(completeness.missing_fields),
    missionId: asString(missionTraceability.mission_id),
    completenessStatus: asString(completeness.status) ?? "incomplete",
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
export function resolveNextAction(options = {}) {
  const init = initializeProjectRuntime({
    cwd: options.cwd,
    projectRef: options.projectRef,
    projectProfile: options.projectProfile,
    runtimeRoot: options.runtimeRoot,
    command: "aor next",
  });
  const projectRoot = init.projectRoot;
  const includeRuntimeRoot = shouldIncludeRuntimeRoot({
    projectRoot,
    runtimeRoot: init.runtimeRoot,
    explicitRuntimeRoot: options.runtimeRoot !== undefined,
  });
  const reportFile = path.join(init.runtimeLayout.reportsRoot, "next-action-report.json");
  const onboardingStatus = asString(init.onboardingReport?.status) ?? "blocked";
  const onboardingEvidenceRef = toEvidenceRef(projectRoot, init.onboardingReportFile);
  const evidenceRefs = [toEvidenceRef(projectRoot, init.stateFile), onboardingEvidenceRef];

  let status = "ready";
  let stage = "mission-intake";
  let primaryAction = {
    action_id: "mission-create",
    command: `${projectCommand("mission create", projectRoot)} --delivery-mode no-write`,
    reason: "No intake-request packet exists yet.",
    low_level_command: "intake create",
    evidence_refs: [...evidenceRefs],
  };
  let blockers = [];
  let missionState = {
    intake_packet_ref: null,
    intake_body_ref: null,
    completeness_status: "missing",
    missing_fields: ["intake-request"],
    mission_id: null,
    delivery_mode: "no-write",
    allowed_paths: [],
    forbidden_paths: [],
  };
  let closureState = buildClosureState({ init, runId: null });
  let latestIntake = null;
  let artifactReadiness = null;

  const activeRun = findActiveRun(init);
  if (activeRun) {
    const runId = asString(activeRun.state.run_id) ?? "current";
    const activeRunRef = toEvidenceRef(projectRoot, activeRun.stateFile);
    closureState = buildClosureState({ init, runId, runEvidenceRef: activeRunRef });
    status = "ready";
    stage = "run-active";
    primaryAction = {
      action_id: "inspect-active-run",
      command: `${projectCommand("run status", projectRoot)} --run-id ${shellQuote(runId)}`,
      reason: "A non-terminal run-control state is already present; inspect it before starting another action.",
      low_level_command: "run status",
      evidence_refs: [...evidenceRefs, activeRunRef],
    };
  } else if (onboardingStatus !== "ready") {
    status = "blocked";
    stage = "onboarding";
    const nextCommand = asString(asRecord(init.onboardingReport?.next_action).command) ?? projectCommand("onboard", projectRoot);
    blockers = asRecord(init.onboardingReport).blockers && Array.isArray(asRecord(init.onboardingReport).blockers)
      ? /** @type {Array<Record<string, unknown>>} */ (asRecord(init.onboardingReport).blockers)
      : [
          createBlocker({
            projectRoot,
            code: "onboarding-blocked",
            summary: "Onboarding report is not ready.",
            evidenceRefs: [onboardingEvidenceRef],
            nextCommand,
          }),
        ];
    primaryAction = {
      action_id: "fix-onboarding",
      command: nextCommand,
      reason: "Onboarding readiness must pass before mission intake or execution planning.",
      low_level_command: "onboard",
      evidence_refs: [...evidenceRefs],
    };
  } else {
    const intake = findLatestIntakePacket(init);
    latestIntake = intake;
    if (intake) {
      const packetRef = toEvidenceRef(projectRoot, intake.packetFile);
      const bodyRef = intake.bodyFile ? toEvidenceRef(projectRoot, intake.bodyFile) : null;
      evidenceRefs.push(packetRef);
      if (bodyRef) evidenceRefs.push(bodyRef);
      if (!intake.body) {
        status = "blocked";
        stage = "mission-intake";
        blockers = [
          createBlocker({
            projectRoot,
            code: "intake-body-missing",
            summary: "Latest intake-request packet does not have a readable body_ref.",
            evidenceRefs: [packetRef],
            nextCommand: projectCommand("mission create", projectRoot),
          }),
        ];
        primaryAction = {
          action_id: "repair-mission-intake",
          command: projectCommand("mission create", projectRoot),
          reason: "The latest mission intake evidence is not readable.",
          low_level_command: "intake create",
          evidence_refs: [...evidenceRefs],
        };
      } else {
        const resolvedMissionState = resolveMissionState(intake.body);
        missionState = {
          intake_packet_ref: packetRef,
          intake_body_ref: bodyRef,
          completeness_status: resolvedMissionState.completenessStatus,
          missing_fields: resolvedMissionState.missingFields,
          mission_id: resolvedMissionState.missionId,
          delivery_mode: resolvedMissionState.deliveryMode,
          allowed_paths: resolvedMissionState.allowedPaths,
          forbidden_paths: resolvedMissionState.forbiddenPaths,
        };
        if (resolvedMissionState.completenessStatus !== "complete") {
          status = "blocked";
          stage = "mission-intake";
          blockers = resolvedMissionState.missingFields.map((field) =>
            createBlocker({
              projectRoot,
              code: `mission-${field}-missing`,
              summary: `Mission intake is missing ${field}.`,
              evidenceRefs: [packetRef, ...(bodyRef ? [bodyRef] : [])],
              nextCommand: `${projectCommand("mission create", projectRoot)} --delivery-mode ${shellQuote(resolvedMissionState.deliveryMode)}`,
            }),
          );
          primaryAction = {
            action_id: "complete-mission-intake",
            command: `${projectCommand("mission create", projectRoot)} --delivery-mode ${shellQuote(resolvedMissionState.deliveryMode)}`,
            reason: "Mission intake must include goals, constraints, KPIs, Definition of Done, and source refs before discovery planning.",
            low_level_command: "intake create",
            evidence_refs: [...evidenceRefs],
          };
        } else {
          artifactReadiness = buildArtifactReadiness({ init, intake, missionState });
          const runEvidence = findLatestRunEvidence(init, { notBeforeMs: fs.statSync(intake.packetFile).mtimeMs });
          if (runEvidence) {
            closureState = buildClosureState({
              init,
              runId: runEvidence.runId,
              runEvidenceRef: runEvidence.evidenceRef,
            });
            const closureAction = resolveClosureAction({
              projectRoot,
              runId: runEvidence.runId,
              closureState,
              evidenceRefs,
              missionState,
            });
            status = closureAction.status;
            stage = closureAction.stage;
            primaryAction = closureAction.primaryAction;
            blockers = closureAction.blockers;
          } else {
            const discoveryReadiness = artifactReadinessStage(artifactReadiness, "discovery");
            const researchReadiness = artifactReadinessStage(artifactReadiness, "research");
            const specReadiness = artifactReadinessStage(artifactReadiness, "spec");
            const planningReadiness = artifactReadinessStage(artifactReadiness, "planning");
            const discoveryCommand = `${projectCommand("discovery run", projectRoot)} --input-packet ${shellQuote(intake.packetFile)}`;
            const specCommand = `${projectCommand("spec build", projectRoot)} --input-packet ${shellQuote(intake.packetFile)}`;
            const handoffPrepareCommand = `${projectCommand("handoff prepare", projectRoot)} --approved-artifact ${shellQuote(intake.packetFile)}`;
            const discoveryStatus = asString(discoveryReadiness.status);
            const researchStatus = asString(researchReadiness.status);
            const specStatus = asString(specReadiness.status);
            const planningStatus = asString(planningReadiness.status);

            if (discoveryStatus !== "complete") {
              status = discoveryStatus === "blocked" ? "blocked" : "ready";
              stage = "discovery";
              primaryAction = {
                action_id: "discovery-run",
                command: discoveryCommand,
                reason: asString(discoveryReadiness.reason) ?? "Mission intake is complete; discovery evidence should be refreshed.",
                low_level_command: "discovery run",
                evidence_refs: uniqueStrings([...evidenceRefs, ...artifactReadinessEvidenceRefs(discoveryReadiness)]),
              };
              blockers = discoveryStatus === "blocked"
                ? [
                    createArtifactReadinessBlocker({
                      projectRoot,
                      stageName: "discovery",
                      stage: discoveryReadiness,
                      nextCommand: discoveryCommand,
                    }),
                  ]
                : [];
            } else if (researchStatus !== "adr-ready" && researchStatus !== "incomplete") {
              status = "blocked";
              stage = "research";
              primaryAction = {
                action_id: "discovery-run",
                command: discoveryCommand,
                reason: asString(researchReadiness.reason) ?? "Research readiness must be refreshed before spec build.",
                low_level_command: "discovery run",
                evidence_refs: uniqueStrings([...evidenceRefs, ...artifactReadinessEvidenceRefs(researchReadiness)]),
              };
              blockers = [
                createArtifactReadinessBlocker({
                  projectRoot,
                  stageName: "research",
                  stage: researchReadiness,
                  nextCommand: discoveryCommand,
                }),
              ];
            } else if (specStatus !== "ready") {
              status = specStatus === "pending" ? "ready" : "blocked";
              stage = "spec-build";
              primaryAction = {
                action_id: "spec-build",
                command: specCommand,
                reason: asString(specReadiness.reason) ?? "Discovery and research evidence are ready; build the routed specification next.",
                low_level_command: "spec build",
                evidence_refs: uniqueStrings([...evidenceRefs, ...artifactReadinessEvidenceRefs(specReadiness)]),
              };
              blockers = specStatus === "pending"
                ? []
                : [
                    createArtifactReadinessBlocker({
                      projectRoot,
                      stageName: "spec",
                      stage: specReadiness,
                      nextCommand: specCommand,
                    }),
                  ];
            } else if (planningStatus !== "ready") {
              status = planningStatus === "pending" ? "ready" : "blocked";
              stage = "planning";
              primaryAction = {
                action_id: "handoff-prepare",
                command: handoffPrepareCommand,
                reason: asString(planningReadiness.reason) ?? "Spec evidence is ready; prepare bounded planning handoff evidence next.",
                low_level_command: "handoff prepare",
                evidence_refs: uniqueStrings([...evidenceRefs, ...artifactReadinessEvidenceRefs(planningReadiness)]),
              };
              blockers = planningStatus === "pending"
                ? []
                : [
                    createArtifactReadinessBlocker({
                      projectRoot,
                      stageName: "planning",
                      stage: planningReadiness,
                      nextCommand: handoffPrepareCommand,
                    }),
                  ];
            } else {
              const approvalRef = `approval://operator/${normalizeForFileName(asString(missionState.mission_id) ?? "current") || "current"}`;
              stage = "planning";
              primaryAction = {
                action_id: "handoff-approve",
                command: `${projectCommand("handoff approve", projectRoot)} --approval-ref ${shellQuote(approvalRef)}`,
                reason: asString(planningReadiness.reason) ?? "Planning evidence is current; approve the handoff before execution-style flows.",
                low_level_command: "handoff approve",
                evidence_refs: uniqueStrings([...evidenceRefs, ...artifactReadinessEvidenceRefs(planningReadiness)]),
              };
            }
          }
        }
      }
    }
  }

  artifactReadiness ??= buildArtifactReadiness({ init, intake: latestIntake, missionState });

  primaryAction = withRuntimeRootActionCommand(primaryAction, init.runtimeRoot, includeRuntimeRoot);
  blockers = withRuntimeRootBlockerCommands(blockers, init.runtimeRoot, includeRuntimeRoot);

  const report = {
    report_id: `${init.projectId}.next-action.v1`,
    project_id: init.projectId,
    version: 1,
    generated_from: {
      command: "aor next",
      project_root: projectRoot,
      project_profile_ref: init.projectProfileRef,
    },
    project_state: {
      stage,
      runtime_root: init.runtimeRoot,
      runtime_state_file: init.stateFile,
      onboarding_report_ref: onboardingEvidenceRef,
      active_run_ref: activeRun ? toEvidenceRef(projectRoot, activeRun.stateFile) : null,
    },
    mission_state: missionState,
    artifact_readiness: artifactReadiness,
    closure_state: closureState,
    primary_action: primaryAction,
    blockers,
    bounded_execution: {
      requested_delivery_mode: missionState.delivery_mode,
      upstream_writes_default: false,
      delivery_capable_mode: missionState.delivery_mode !== "no-write",
      allowed_paths: missionState.allowed_paths,
      forbidden_paths: missionState.forbidden_paths,
      requires_review_before_writeback: missionState.delivery_mode !== "no-write",
    },
    evidence_refs: Array.from(new Set([...evidenceRefs, ...primaryAction.evidence_refs])),
    status,
    created_at: new Date().toISOString(),
  };

  const validation = validateContractDocument({
    family: "next-action-report",
    document: report,
    source: "runtime://next-action-report",
  });
  if (!validation.ok) {
    const issueSummary = validation.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Generated next-action report failed contract validation: ${issueSummary}`);
  }
  const archiveSuffix =
    normalizeForFileName(asString(missionState.mission_id) ?? path.basename(asString(missionState.intake_packet_ref) ?? "current", ".json")) ||
    "current";
  const archiveReportFile = path.join(init.runtimeLayout.reportsRoot, `next-action-report-${archiveSuffix}.json`);
  if (archiveReportFile !== reportFile) {
    fs.writeFileSync(archiveReportFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  return {
    ...init,
    nextActionReport: report,
    nextActionReportFile: reportFile,
    nextActionReportArchiveFile: archiveReportFile,
    nextActionReportId: report.report_id,
  };
}
