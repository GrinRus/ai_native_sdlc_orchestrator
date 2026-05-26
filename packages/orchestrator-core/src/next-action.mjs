import fs from "node:fs";
import path from "node:path";

import { validateContractDocument } from "../../contracts/src/index.mjs";
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
 * @returns {{ runId: string, evidenceRef: string } | null}
 */
function findLatestRunEvidence(init) {
  /** @type {Array<{ runId: string, evidenceRef: string, file: string }>} */
  const candidates = [];
  const addCandidate = (filePath, document) => {
    const runId = asString(document.run_id);
    if (runId) {
      candidates.push({ runId, evidenceRef: toEvidenceRef(init.projectRoot, filePath), file: filePath });
      return;
    }
    const runRef = asStringArray(document.run_refs)[0];
    if (runRef) {
      candidates.push({
        runId: runRef.startsWith("run://") ? runRef.slice("run://".length) : runRef,
        evidenceRef: toEvidenceRef(init.projectRoot, filePath),
        file: filePath,
      });
    }
  };

  for (const filePath of listJsonFiles(init.runtimeLayout.stateRoot)) {
    if (!path.basename(filePath).startsWith("run-control-state-")) continue;
    const state = readJsonFile(filePath);
    if (state) addCandidate(filePath, state);
  }

  for (const filePath of listJsonFiles(init.runtimeLayout.reportsRoot)) {
    if (
      !/^step-result-.*\.json$/u.test(path.basename(filePath)) &&
      !/^review-report.*\.json$/u.test(path.basename(filePath)) &&
      !/^review-decision-.*\.json$/u.test(path.basename(filePath)) &&
      !/^runtime-harness-report.*\.json$/u.test(path.basename(filePath)) &&
      !/^learning-loop-(?:scorecard|handoff)-.*\.json$/u.test(path.basename(filePath))
    ) {
      continue;
    }
    const document = readJsonFile(filePath);
    if (document) addCandidate(filePath, document);
  }

  for (const filePath of listJsonFiles(init.runtimeLayout.artifactsRoot)) {
    if (
      !/^delivery-plan-.*\.json$/u.test(path.basename(filePath)) &&
      !/^delivery-manifest-.*\.json$/u.test(path.basename(filePath)) &&
      !/^release-packet-.*\.json$/u.test(path.basename(filePath))
    ) {
      continue;
    }
    const document = readJsonFile(filePath);
    if (document) addCandidate(filePath, document);
  }

  candidates.sort((left, right) => fs.statSync(right.file).mtimeMs - fs.statSync(left.file).mtimeMs);
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

  return {
    status: "ready",
    stage: "learning",
    blockers: [],
    primaryAction: {
      action_id: "closure-complete",
      command: `${projectCommand("evidence show", options.projectRoot)} --run-id ${shellQuote(options.runId)}`,
      reason: "Review, delivery, release, and learning evidence are linked; inspect the closure evidence chain.",
      low_level_command: "evidence show",
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
 * @returns {string | null}
 */
function findDiscoveryReport(init) {
  return (
    listJsonFiles(init.runtimeLayout.reportsRoot).find((filePath) => {
      const report = readJsonFile(filePath);
      return asString(report?.report_id)?.includes(".analysis.") || asRecord(report?.discovery_research).status;
    }) ?? null
  );
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
          const discoveryReport = findDiscoveryReport(init);
          const runEvidence = findLatestRunEvidence(init);
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
          } else if (discoveryReport) {
            const discoveryRef = toEvidenceRef(projectRoot, discoveryReport);
            stage = "spec-build";
            primaryAction = {
              action_id: "spec-build",
              command: `${projectCommand("spec build", projectRoot)} --input-packet ${shellQuote(intake.packetFile)}`,
              reason: "Mission intake and discovery evidence exist; build the routed specification next.",
              low_level_command: "spec build",
              evidence_refs: [...evidenceRefs, discoveryRef],
            };
          } else {
            stage = "discovery";
            primaryAction = {
              action_id: "discovery-run",
              command: `${projectCommand("discovery run", projectRoot)} --input-packet ${shellQuote(intake.packetFile)}`,
              reason: "Mission intake is complete; discovery should collect repository and research evidence before planning.",
              low_level_command: "discovery run",
              evidence_refs: [...evidenceRefs],
            };
          }
        }
      }
    }
  }

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
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  return {
    ...init,
    nextActionReport: report,
    nextActionReportFile: reportFile,
    nextActionReportId: report.report_id,
  };
}
