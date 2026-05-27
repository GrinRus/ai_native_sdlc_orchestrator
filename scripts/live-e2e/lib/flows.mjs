import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  asNonEmptyString,
  asRecord,
  asStringArray,
  evidenceRefMaterialized,
  fileExists,
  normalizeId,
  nowIso,
  readJson,
  uniqueStrings,
  writeJson,
} from "./common.mjs";
import { createStageMap, flattenStageMap, getProfileStages, markStage as markStageRaw } from "./stages.mjs";
import {
  buildLiveE2eStepInstanceId,
  isLiveE2eControllerStop,
  resolveLiveE2eCommandStep,
} from "./step-controller.mjs";
import { DEFAULT_BACKLOG_REFS, createProofRunnerEnvironment, createSessionRoots } from "./profile-catalog.mjs";
import {
  buildGuidedJourneyProof,
  isGuidedJourneyEnabled,
  writeValidatedGuidedJourneyProof,
} from "./guided-proof.mjs";
import {
  materializeFeatureRequestFile,
  materializeGeneratedProjectProfile,
  materializeHostLiveE2eAssets,
  materializeProviderPinnedRouteOverrides,
  materializeTargetCheckout,
  normalizeDeliveryMode,
} from "./target-materialization.mjs";
import { resolveAuthProbeRequired, runLiveAdapterPreflight } from "./preflight.mjs";

/**
 * @param {Record<string, string>} routeOverrides
 * @returns {string | null}
 */
function serializeRouteOverrides(routeOverrides) {
  const pairs = Object.entries(routeOverrides)
    .filter(([, routeId]) => typeof routeId === "string" && routeId.length > 0)
    .map(([step, routeId]) => `${step}=${routeId}`);
  return pairs.length > 0 ? pairs.join(",") : null;
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function looksLikeEvidenceRef(value) {
  return (
    value.startsWith("evidence://") ||
    value.startsWith("compiled-context://") ||
    value.startsWith("packet://") ||
    value.includes("/") ||
    value.includes("\\") ||
    /\.(json|jsonl|yaml|yml|patch|log)$/iu.test(value)
  );
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function collectStringRefs(value) {
  if (typeof value === "string") {
    return looksLikeEvidenceRef(value.trim()) ? [value.trim()] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectStringRefs(entry));
  }
  if (typeof value === "object" && value !== null) {
    return Object.values(value).flatMap((entry) => collectStringRefs(entry));
  }
  return [];
}

/**
 * @param {string} filePath
 * @returns {string}
 */
function canonicalEvidencePath(filePath) {
  try {
    return fs.realpathSync.native(filePath);
  } catch {
    return path.resolve(filePath);
  }
}

/**
 * @param {string} projectRoot
 * @param {string} filePath
 * @returns {string}
 */
function toProjectEvidenceRef(projectRoot, filePath) {
  return `evidence://${path
    .relative(canonicalEvidencePath(projectRoot), canonicalEvidencePath(filePath))
    .replace(/\\/g, "/")}`;
}

/**
 * @param {string} projectRoot
 * @param {string} packetName
 * @param {string | null | undefined} filePath
 * @returns {string | null}
 */
function toPacketEvidenceRef(projectRoot, packetName, filePath) {
  const concreteFilePath = asNonEmptyString(filePath);
  if (!concreteFilePath) {
    return null;
  }
  const sourceRef = path.isAbsolute(concreteFilePath)
    ? toProjectEvidenceRef(projectRoot, concreteFilePath)
    : concreteFilePath;
  return `packet://${packetName}@${sourceRef}`;
}

/**
 * @param {string} label
 * @returns {string}
 */
function normalizeLabel(label) {
  return label.replace(/[^a-z0-9]+/giu, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

/**
 * @param {string[]} args
 * @returns {string[]}
 */
function redactSensitiveCommandArgs(args) {
  const redacted = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    redacted.push(arg);
    if (arg === "--answer" && index + 1 < args.length) {
      redacted.push("[redacted-live-e2e-answer]");
      index += 1;
    }
  }
  return redacted;
}

/**
 * @param {{ hostRoot: string, aorBinOverride: string | null }} options
 */
export function resolveAorLaunch(options) {
  const selected = options.aorBinOverride
    ? path.isAbsolute(options.aorBinOverride)
      ? options.aorBinOverride
      : path.resolve(options.hostRoot, options.aorBinOverride)
    : path.join(options.hostRoot, "apps/cli/bin/aor.mjs");
  const extension = path.extname(selected).toLowerCase();
  if (extension === ".js" || extension === ".mjs" || extension === ".cjs") {
    return {
      command: process.execPath,
      argsPrefix: [selected],
      binaryRef: selected,
    };
  }
  return {
    command: selected,
    argsPrefix: [],
    binaryRef: selected,
  };
}

/**
 * @param {string} value
 * @returns {string}
 */
function shellSingleQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/**
 * @param {{
 *   cwd: string,
 *   command: string,
 *   args: string[],
 *   transcriptFile: string,
 * }} options
 */
function runInstallProofCommand(options) {
  const startedAt = nowIso();
  const run = spawnSync(options.command, options.args, {
    cwd: options.cwd,
    encoding: "utf8",
  });
  const transcript = {
    command: options.command,
    args: options.args,
    cwd: options.cwd,
    status: run.status === 0 ? "pass" : "fail",
    exit_code: run.status ?? -1,
    stdout: run.stdout ?? "",
    stderr: run.stderr ?? (run.error instanceof Error ? run.error.message : ""),
    started_at: startedAt,
    finished_at: nowIso(),
  };
  writeJson(options.transcriptFile, transcript);
  return transcript;
}

const ISOLATED_SOURCE_SKIP_NAMES = new Set([
  ".aor",
  ".git",
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
]);

/**
 * @param {{ sourceRoot: string, destinationRoot: string }} options
 */
function copyAorSourceCheckout(options) {
  fs.rmSync(options.destinationRoot, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(options.destinationRoot), { recursive: true });
  fs.cpSync(options.sourceRoot, options.destinationRoot, {
    recursive: true,
    filter: (sourcePath) => {
      const relative = path.relative(options.sourceRoot, sourcePath);
      if (!relative) return true;
      return !relative.split(path.sep).some((part) => ISOLATED_SOURCE_SKIP_NAMES.has(part));
    },
  });
}

/**
 * @param {{
 *   hostRoot: string,
 *   reportsRoot: string,
 *   runId: string,
 *   profile: Record<string, unknown>,
 *   aorBinOverride: string | null,
 *   installMode?: "isolated" | "repo-local" | "provided-binary",
 *   isolatedWorkspaceRoot?: string | null,
 *   isolatedSourceRoot?: string | null,
 *   runtimeRoot?: string | null,
 * }}
 */
export function prepareAorInstallationProof(options) {
  const policy = asRecord(options.profile.live_e2e);
  const declaredPolicy = asNonEmptyString(policy.installation_policy);
  const effectivePolicy = options.aorBinOverride ? "provided-binary-required" : declaredPolicy || "source-install-required";
  const installMode =
    options.aorBinOverride || options.installMode === "provided-binary"
      ? "provided-binary"
      : options.installMode === "isolated"
      ? "isolated"
      : "repo-local";
  if (!["source-install-required", "provided-binary-required"].includes(effectivePolicy)) {
    throw new Error(
      `Unsupported live_e2e.installation_policy '${declaredPolicy}'. Expected source-install-required or provided-binary-required.`,
    );
  }
  if (effectivePolicy === "provided-binary-required" && !options.aorBinOverride) {
    throw new Error("live_e2e.installation_policy=provided-binary-required requires --aor-bin.");
  }

  const normalizedRunId = normalizeId(options.runId);
  const installRoot = path.join(options.reportsRoot, `live-e2e-aor-install-${normalizedRunId}`);
  fs.mkdirSync(installRoot, { recursive: true });
  const commandTranscripts = [];
  const commandSummaries = [];
  let installCwd = options.hostRoot;
  const addCommand = (label, command, args) => {
    const transcriptFile = path.join(installRoot, `${String(commandTranscripts.length + 1).padStart(2, "0")}-${label}.json`);
    const transcript = runInstallProofCommand({
      cwd: installCwd,
      command,
      args,
      transcriptFile,
    });
    commandTranscripts.push(transcriptFile);
    commandSummaries.push({
      label,
      command,
      args,
      status: asNonEmptyString(transcript.status),
      exit_code: typeof transcript.exit_code === "number" ? transcript.exit_code : null,
      started_at: asNonEmptyString(transcript.started_at) || null,
      finished_at: asNonEmptyString(transcript.finished_at) || null,
      transcript_file: transcriptFile,
    });
    return transcript;
  };

  /** @type {ReturnType<typeof resolveAorLaunch>} */
  let launch;
  let launcherRef = null;
  if (effectivePolicy === "source-install-required" && installMode === "isolated") {
    const isolatedSourceRoot = asNonEmptyString(options.isolatedSourceRoot);
    if (!isolatedSourceRoot) {
      throw new Error("Isolated AOR source install requires isolatedSourceRoot.");
    }
    copyAorSourceCheckout({
      sourceRoot: options.hostRoot,
      destinationRoot: isolatedSourceRoot,
    });
    installCwd = isolatedSourceRoot;
  }

  if (effectivePolicy === "source-install-required") {
    addCommand("corepack-enable", "corepack", ["enable"]);
    addCommand("pnpm-install-frozen-lockfile", "pnpm", ["install", "--frozen-lockfile"]);
    addCommand("pnpm-build", "pnpm", ["build"]);
    addCommand("pnpm-aor-help", "pnpm", ["aor", "--help"]);
    const launcherScript = path.join(installRoot, "aor-session-launcher.sh");
    fs.writeFileSync(
      launcherScript,
      [
        "#!/bin/sh",
        `exec ${shellSingleQuote(process.execPath)} ${shellSingleQuote(path.join(installCwd, "apps/cli/bin/aor.mjs"))} "$@"`,
        "",
      ].join("\n"),
      "utf8",
    );
    fs.chmodSync(launcherScript, 0o755);
    launcherRef = launcherScript;
    launch = {
      command: launcherScript,
      argsPrefix: [],
      binaryRef: launcherScript,
    };
  } else {
    launch = resolveAorLaunch({
      hostRoot: options.hostRoot,
      aorBinOverride: options.aorBinOverride,
    });
    addCommand("provided-aor-help", launch.command, [...launch.argsPrefix, "--help"]);
    launcherRef = launch.binaryRef;
  }

  const failedCommands = commandSummaries.filter((entry) => asNonEmptyString(entry.status) === "fail");
  const proof = {
    status: failedCommands.length === 0 ? "pass" : "fail",
    declared_policy: declaredPolicy || null,
    effective_policy: effectivePolicy,
    install_mode: installMode,
    source_channel: effectivePolicy === "source-install-required" ? "source-only-alpha" : "provided-binary",
    workspace_root: options.isolatedWorkspaceRoot ?? null,
    runtime_root: options.runtimeRoot ?? null,
    original_source_root: options.hostRoot,
    installed_source_root: effectivePolicy === "source-install-required" ? installCwd : null,
    launcher_ref: launcherRef,
    command_transcripts: commandTranscripts,
    commands: commandSummaries,
    started_at: asNonEmptyString(asRecord(commandSummaries[0]).started_at) || null,
    finished_at: nowIso(),
  };
  const proofFile = path.join(options.reportsRoot, `live-e2e-aor-installation-proof-${normalizedRunId}.json`);
  writeJson(proofFile, proof);
  const setupEntry = {
    sequence: 1,
    step_id: "install",
    status: proof.status,
    public_surface: effectivePolicy === "source-install-required" ? "pnpm source install" : "provided aor binary",
    evidence_refs: uniqueStrings([proofFile, ...commandTranscripts]),
    summary:
      proof.status !== "pass"
        ? "AOR installation proof failed before live E2E execution."
        : effectivePolicy === "source-install-required"
        ? "AOR source-only install channel was verified before live E2E execution."
        : "Provided AOR binary was verified before live E2E execution.",
  };
  const installationResult = {
    launch,
    proof,
    proofFile,
    setupEntry,
  };
  if (proof.status !== "pass") {
    const failure = new Error(`AOR installation proof failed; inspect ${proofFile}.`);
    failure.aorInstallation = installationResult;
    throw failure;
  }
  return installationResult;
}

/**
 * @param {{
 *   launch: ReturnType<typeof resolveAorLaunch>,
 *   cwd: string,
 *   args: string[],
 *   env: NodeJS.ProcessEnv,
 *   transcriptsRoot: string,
 *   label: string,
 *   index: number,
 * }}
 */
function runAorCommand(options) {
  const rawArgs = [...options.launch.argsPrefix, ...options.args];
  const startedAt = nowIso();
  const run = spawnSync(options.launch.command, rawArgs, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
  });
  const finishedAt = nowIso();
  const transcriptFile = path.join(
    options.transcriptsRoot,
    `${String(options.index).padStart(2, "0")}-${normalizeLabel(options.label)}.json`,
  );
  /** @type {Record<string, unknown> | null} */
  let parsed = null;
  if ((run.stdout ?? "").trim().length > 0) {
    try {
      parsed = /** @type {Record<string, unknown>} */ (JSON.parse(run.stdout));
    } catch {
      parsed = null;
    }
  }
  const transcript = {
    label: options.label,
    cwd: options.cwd,
    command: options.launch.command,
    args: redactSensitiveCommandArgs(rawArgs),
    exit_code: run.status ?? -1,
    stdout: run.stdout ?? "",
    stderr: run.stderr ?? "",
    parsed_json: parsed,
    started_at: startedAt,
    finished_at: finishedAt,
  };
  writeJson(transcriptFile, transcript);
  return {
    label: options.label,
    ok: run.status === 0 && parsed !== null,
    exitCode: run.status ?? -1,
    stdout: run.stdout ?? "",
    stderr: run.stderr ?? "",
    payload: parsed,
    transcriptFile,
    startedAt,
    finishedAt,
    durationSec: resolveDurationSeconds(startedAt, finishedAt),
    commandSurface: resolveCommandSurface(options.args),
  };
}

/**
 * @param {string[]} args
 */
function resolveCommandSurface(args) {
  return args.length >= 2 && !args[1].startsWith("--") && args[1] !== "."
    ? `aor ${args[0]} ${args[1]}`
    : `aor ${args[0]}`.trim();
}

/**
 * @param {string} startedAt
 * @param {string} finishedAt
 * @returns {number | null}
 */
function resolveDurationSeconds(startedAt, finishedAt) {
  const startedMs = Date.parse(startedAt);
  const finishedMs = Date.parse(finishedAt);
  if (!Number.isFinite(startedMs) || !Number.isFinite(finishedMs) || finishedMs < startedMs) {
    return null;
  }
  return Math.round(((finishedMs - startedMs) / 1000) * 1000) / 1000;
}

/**
 * @param {ReturnType<typeof runAorCommand>} result
 * @returns {Record<string, unknown>}
 */
function buildCommandDiagnostic(result) {
  const payload = asRecord(result.payload);
  const lifecycleCommand = asRecord(payload.lifecycle_command);
  const commandOutput = asRecord(lifecycleCommand.command_output);
  const interactiveContinuation =
    asRecord(payload.interactive_continuation).requested === true
      ? asRecord(payload.interactive_continuation)
      : asRecord(lifecycleCommand.interactive_continuation).requested === true
        ? asRecord(lifecycleCommand.interactive_continuation)
        : asRecord(commandOutput.interactive_continuation).requested === true
          ? asRecord(commandOutput.interactive_continuation)
          : null;
  return {
    label: result.label,
    command_surface: result.commandSurface,
    status: result.ok ? "pass" : "fail",
    exit_code: result.exitCode,
    started_at: result.startedAt,
    finished_at: result.finishedAt,
    duration_sec: result.durationSec,
    transcript_file: result.transcriptFile,
    artifact_refs: uniqueStrings(collectStringRefs(result.payload)),
    failure_class: result.ok ? null : "command-failed",
    missing_evidence: [],
    recommendation: result.ok ? "continue" : "inspect transcript and command stderr",
    interactive_continuation: interactiveContinuation,
  };
}

/**
 * @param {Record<string, unknown>} diagnostic
 * @param {string} label
 * @param {number} iteration
 */
function annotateCommandDiagnosticStep(diagnostic, label, iteration) {
  const step = resolveLiveE2eCommandStep(label);
  if (!step) return;
  const normalizedIteration = Number(iteration) || 1;
  diagnostic.step_id = step;
  diagnostic.step_instance_id = buildLiveE2eStepInstanceId(step, normalizedIteration);
  diagnostic.iteration = normalizedIteration;
}

/**
 * @param {Record<string, unknown>} profile
 * @param {Record<string, unknown> | null} requestedInteraction
 * @returns {{ answer: string, reason: string | null } | null}
 */
function resolveDeterministicInteractionAnswer(profile, requestedInteraction) {
  if (!requestedInteraction) return null;
  if (asNonEmptyString(asRecord(profile.live_e2e).interaction_answer_policy) !== "deterministic-fixture") {
    return null;
  }
  const policy = asRecord(profile.interaction_answer_policy);
  if (asNonEmptyString(policy.mode) !== "deterministic") return null;
  const interactionId = asNonEmptyString(requestedInteraction.interaction_id);
  const answers = Array.isArray(policy.answers) ? policy.answers.map((entry) => asRecord(entry)) : [];
  const matched = answers.find((entry) => asNonEmptyString(entry.interaction_id) === interactionId) ?? {};
  const answer = asNonEmptyString(matched.answer) || asNonEmptyString(policy.default_answer);
  if (!answer) return null;
  return {
    answer,
    reason:
      asNonEmptyString(matched.reason) ||
      asNonEmptyString(policy.reason) ||
      "Live E2E deterministic interaction answer policy.",
  };
}

/**
 * @param {Record<string, unknown>} diagnostic
 * @param {ReturnType<typeof runAorCommand>} answerResult
 */
function updateDiagnosticWithInteractionAnswer(diagnostic, answerResult) {
  const payload = asRecord(answerResult.payload);
  const interactionAnswer = Object.keys(asRecord(payload.interaction_answer)).length > 0
    ? asRecord(payload.interaction_answer)
    : asRecord(payload.interactionAnswer);
  const continuation = asRecord(diagnostic.interactive_continuation);
  if (Object.keys(continuation).length === 0 || Object.keys(interactionAnswer).length === 0) return;
  const answerAuditRef = asNonEmptyString(interactionAnswer.answer_audit_ref);
  continuation.status = asNonEmptyString(interactionAnswer.interaction_status) || asNonEmptyString(continuation.status);
  continuation.interaction_status = continuation.status;
  continuation.answer_audit_refs = uniqueStrings([...asStringArray(continuation.answer_audit_refs), answerAuditRef]);
  continuation.continuation = {
    ...asRecord(continuation.continuation),
    next_action: asNonEmptyString(interactionAnswer.run_control_transition) || "continue_run",
  };
  diagnostic.interactive_continuation = continuation;
  diagnostic.artifact_refs = uniqueStrings([...asStringArray(diagnostic.artifact_refs), answerAuditRef, answerResult.transcriptFile]);
  diagnostic.recommendation = continuation.status === "resumed" ? "continue" : diagnostic.recommendation;
}

/**
 * @param {Record<string, unknown>} diagnostic
 * @returns {ReturnType<typeof runAorCommand> | null}
 */
function buildCachedCommandResult(diagnostic) {
  const transcriptFile = asNonEmptyString(diagnostic.transcript_file);
  if (!transcriptFile || !fileExists(transcriptFile)) return null;
  const transcript = asRecord(readJson(transcriptFile));
  return {
    label: asNonEmptyString(diagnostic.label),
    ok: commandCompletedForCanonicalStatus(diagnostic),
    exitCode: typeof diagnostic.exit_code === "number" ? diagnostic.exit_code : 0,
    stdout: asNonEmptyString(transcript.stdout),
    stderr: asNonEmptyString(transcript.stderr),
    payload: asRecord(transcript.parsed_json),
    transcriptFile,
    startedAt: asNonEmptyString(diagnostic.started_at) || asNonEmptyString(transcript.started_at) || nowIso(),
    finishedAt: asNonEmptyString(diagnostic.finished_at) || asNonEmptyString(transcript.finished_at) || nowIso(),
    durationSec:
      typeof diagnostic.duration_sec === "number"
        ? diagnostic.duration_sec
        : resolveDurationSeconds(asNonEmptyString(transcript.started_at), asNonEmptyString(transcript.finished_at)),
    commandSurface: asNonEmptyString(diagnostic.command_surface) || "cached public AOR command",
  };
}

/**
 * @param {Record<string, unknown>} artifacts
 * @param {unknown} stepController
 */
function hydrateControllerArtifacts(artifacts, stepController) {
  const snapshot = asRecord(asRecord(stepController?.getState?.()).artifacts_snapshot);
  Object.assign(artifacts, snapshot);
}

/**
 * @param {unknown} stepController
 * @param {string} step
 * @param {number} [iteration]
 * @returns {boolean}
 */
function controllerObservedStep(stepController, step, iteration = 1) {
  const journal =
    typeof stepController?.getStepJournal === "function"
      ? stepController.getStepJournal().map((entry) => asRecord(entry))
      : [];
  return journal.some(
    (entry) => asNonEmptyString(entry.step_id) === step && (Number(entry.iteration) || 1) === iteration,
  );
}

/**
 * @param {Record<string, unknown>} diagnostic
 * @returns {boolean}
 */
function commandCompletedForCanonicalStatus(diagnostic) {
  return asNonEmptyString(diagnostic.status) === "pass" || diagnostic.accepted_nonzero_payload === true;
}

/**
 * @param {Record<string, unknown> | null} payload
 * @param {string} field
 * @returns {string | null}
 */
function getStringField(payload, field) {
  if (!payload) return null;
  const value = payload[field];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/**
 * @param {Record<string, unknown> | null} payload
 * @param {string} field
 * @returns {string[]}
 */
function getStringArrayField(payload, field) {
  if (!payload) return [];
  return asStringArray(payload[field]);
}

/**
 * @param {Record<string, unknown>} profile
 * @returns {string[]}
 */
function getBacklogRefs(profile) {
  const learningLoop = asRecord(profile.learning_loop);
  const refs = asStringArray(learningLoop.backlog_refs);
  return refs.length > 0 ? refs : [...DEFAULT_BACKLOG_REFS];
}

/**
 * @param {Record<string, unknown>} profile
 */
function shouldIncludeApprovedHandoff(profile) {
  const liveExecution = asRecord(profile.live_execution);
  if (liveExecution.include_approved_handoff === false) {
    return false;
  }
  return true;
}

/**
 * @param {Record<string, unknown>} profile
 */
function shouldIncludePromotionEvidence(profile) {
  const liveExecution = asRecord(profile.live_execution);
  if (liveExecution.include_promotion_evidence === false) {
    return false;
  }
  return true;
}

/**
 * @param {Record<string, unknown>} profile
 */
function getHarnessCertification(profile) {
  const harness = asRecord(asRecord(profile.verification).harness);
  if (harness.enabled !== true) {
    return null;
  }
  return {
    assetRef: asNonEmptyString(harness.asset_ref) || "wrapper://wrapper.eval.default@v1",
    subjectRef: asNonEmptyString(harness.subject_ref) || "wrapper://wrapper.eval.default@v1",
    suiteRef: asNonEmptyString(harness.suite_ref) || "suite.cert.core@v4",
    stepClass: asNonEmptyString(harness.step_class) || "implement",
  };
}

/**
 * @param {Record<string, unknown>} profile
 * @returns {string}
 */
function getPreferredDeliveryMode(profile) {
  return normalizeDeliveryMode(
    asNonEmptyString(asRecord(profile.output_policy).preferred_delivery_mode) || "patch-only",
  );
}

/**
 * @param {Record<string, unknown>} profile
 * @returns {string[]}
 */
function getEvalSuites(profile) {
  return asStringArray(asRecord(profile.verification).eval_suites);
}

/**
 * @param {Record<string, unknown>} profile
 */
function resolveImplementationLoopPolicy(profile) {
  const loop = asRecord(profile.implementation_loop);
  const runTier = asNonEmptyString(profile.run_tier);
  const acceptanceLike =
    asNonEmptyString(profile.journey_mode) === "full-journey" ||
    runTier === "acceptance" ||
    runTier === "production-proof" ||
    asRecord(profile.production_proof).enabled === true;
  const enabled = typeof loop.enabled === "boolean" ? loop.enabled : acceptanceLike;
  const maxIterations =
    Number.isInteger(loop.max_iterations) && Number(loop.max_iterations) > 0
      ? Number(loop.max_iterations)
      : enabled
      ? 3
      : 1;
  return {
    enabled,
    maxIterations,
    reviewRepairActions: asStringArray(loop.review_repair_actions).length > 0
      ? asStringArray(loop.review_repair_actions)
      : ["request-repair", "repair", "failed-quality-findings"],
    stopOnBlockingReview: loop.stop_on_blocking_review !== false,
  };
}

/**
 * @param {{ cwd: string, args: string[] }} options
 * @returns {string | null}
 */
function runGitOutput(options) {
  const result = spawnSync("git", options.args, {
    cwd: options.cwd,
    encoding: "utf8",
  });
  if (result.status !== 0) return null;
  return (result.stdout ?? "").trim();
}

/**
 * @param {string} targetCheckoutRoot
 * @returns {string[]}
 */
function collectTargetGitStatusWithoutRuntime(targetCheckoutRoot) {
  const result = spawnSync(
    "git",
    [
      "status",
      "--short",
      "--untracked-files=all",
      "--",
      ".",
      ":(exclude).aor",
      ":(exclude).aor/**",
    ],
    {
      cwd: targetCheckoutRoot,
      encoding: "utf8",
    },
  );
  if (result.status !== 0) {
    return [`git-status-failed: ${(result.stderr ?? result.stdout ?? "").trim()}`];
  }
  return (result.stdout ?? "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * @param {string[]} statusLines
 * @returns {string[]}
 */
function trackedTargetStatusLines(statusLines) {
  return statusLines.filter((line) => !line.startsWith("?? "));
}

/**
 * @param {{ targetCheckoutRoot: string, reportsRoot: string, runId: string, phase: string }} options
 */
function writeTargetCleanlinessReport(options) {
  const statusLines = collectTargetGitStatusWithoutRuntime(options.targetCheckoutRoot);
  const trackedLines = trackedTargetStatusLines(statusLines);
  const report = {
    run_id: options.runId,
    phase: options.phase,
    status: trackedLines.length === 0 ? "pass" : "fail",
    target_git_status_without_runtime: statusLines,
    tracked_status_without_runtime: trackedLines,
    summary:
      trackedLines.length === 0
        ? "Target checkout has no tracked setup changes outside .aor."
        : "Target setup changed tracked files outside .aor before agent execution.",
    checked_at: nowIso(),
  };
  const reportFile = path.join(
    options.reportsRoot,
    `live-e2e-target-cleanliness-${normalizeId(options.runId)}-${normalizeId(options.phase)}.json`,
  );
  writeJson(reportFile, report);
  return { report, reportFile };
}

/**
 * @param {unknown} value
 * @returns {Array<{ kpi_id: string, name: string, target: string, measurement?: string }>}
 */
function normalizeMissionKpis(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry, index) => {
      const record = asRecord(entry);
      const kpiId = asNonEmptyString(record.kpi_id) || `mission-kpi-${index + 1}`;
      const name = asNonEmptyString(record.name) || asNonEmptyString(record.label) || `Mission KPI ${index + 1}`;
      const target = asNonEmptyString(record.target) || asNonEmptyString(record.threshold);
      if (!target) return null;
      const measurement = asNonEmptyString(record.measurement);
      return {
        kpi_id: kpiId,
        name,
        target,
        ...(measurement ? { measurement } : {}),
      };
    })
    .filter(Boolean);
}

/**
 * @param {{ mission: Record<string, unknown>, featureRequest: ReturnType<typeof materializeFeatureRequestFile>, profile: Record<string, unknown>, projectProfileFile: string }}
 * @returns {string[]}
 */
function buildGuidedMissionCreateArgs(options) {
  const missionId = asNonEmptyString(options.mission.mission_id);
  const title = asNonEmptyString(options.featureRequest.requestDocument.title) || missionId || "Guided mission";
  const brief =
    asNonEmptyString(options.featureRequest.requestDocument.brief) ||
    asNonEmptyString(options.mission.brief) ||
    "Prepare one bounded guided mission request.";
  const goals = asStringArray(options.mission.goals);
  const constraints = asStringArray(options.mission.acceptance_checks);
  const definitionOfDone =
    asStringArray(options.mission.definition_of_done).length > 0
      ? asStringArray(options.mission.definition_of_done)
      : asStringArray(options.mission.expected_evidence).map((entry) => `Materialize ${entry} evidence.`);
  const kpis = normalizeMissionKpis(options.mission.kpis);
  const effectiveKpis =
    kpis.length > 0
      ? kpis
      : [
          {
            kpi_id: "guided-proof-artifacts",
            name: "Guided proof artifacts",
            target: "All required proof artifacts are materialized",
            measurement: "installed-user guided proof validation",
          },
        ];

  return [
    "mission",
    "create",
    "--project-ref",
    ".",
    "--project-profile",
    options.projectProfileFile,
    "--runtime-root",
    ".aor",
    "--request-file",
    options.featureRequest.requestFile,
    ...(missionId ? ["--mission-id", missionId] : []),
    "--title",
    title,
    "--brief",
    brief,
    "--delivery-mode",
    getPreferredDeliveryMode(options.profile),
    "--source-kind",
    "local-note",
    "--source-ref",
    options.featureRequest.requestFile,
    ...((goals.length > 0 ? goals : [brief]).flatMap((entry) => ["--goal", entry])),
    ...constraints.flatMap((entry) => ["--constraint", entry]),
    ...((definitionOfDone.length > 0 ? definitionOfDone : constraints).flatMap((entry) => ["--dod", entry])),
    ...effectiveKpis.flatMap((entry) => [
      "--kpi",
      `${entry.kpi_id}:${entry.name}:${entry.target}${entry.measurement ? `:${entry.measurement}` : ""}`,
    ]),
  ];
}

/**
 * @param {{
 *   aorLaunch: ReturnType<typeof resolveAorLaunch>,
 *   targetCheckoutRoot: string,
 *   runId: string,
 *   reportsRoot: string,
 *   env: NodeJS.ProcessEnv,
 * }}
 */
function runGuidedAppSmoke(options) {
  const summaryFile = path.join(
    options.reportsRoot,
    `installed-user-guided-app-smoke-${normalizeId(options.runId)}.json`,
  );
  const result = spawnSync(
    options.aorLaunch.command,
    [
      ...options.aorLaunch.argsPrefix,
      "app",
      "--project-ref",
      ".",
      "--runtime-root",
      ".aor",
      "--smoke",
      "true",
      "--open",
      "false",
      "--json",
    ],
    {
      cwd: options.targetCheckoutRoot,
      encoding: "utf8",
      env: options.env,
    },
  );
  if (result.status !== 0) {
    throw new Error(`Guided app smoke failed: ${(result.stderr ?? result.stdout ?? "").trim()}`);
  }
  /** @type {Record<string, unknown>} */
  let summary;
  try {
    summary = asRecord(JSON.parse(result.stdout));
  } catch {
    throw new Error("Guided app smoke did not emit JSON summary.");
  }
  summary.summary_file = summaryFile;
  summary.command = "aor app --smoke true --open false --json";
  writeJson(summaryFile, summary);
  return {
    summaryFile,
    summary,
  };
}

/**
 * @param {unknown} value
 * @returns {"pass" | "warn" | "fail"}
 */
function normalizeVerdictStatus(value) {
  const normalized = asNonEmptyString(value).toLowerCase();
  if (normalized === "fail") return "fail";
  if (normalized === "warn") return "warn";
  return "pass";
}

/**
 * @param {unknown} value
 * @returns {"pass" | "warn" | "fail"}
 */
function normalizeRuntimeHarnessDecisionStatus(value) {
  const normalized = asNonEmptyString(value).toLowerCase();
  if (normalized === "pass" || normalized === "passed" || normalized === "success") return "pass";
  if (normalized === "warn" || normalized === "warning" || normalized === "pass_with_findings") return "warn";
  return "fail";
}

/**
 * @param {Record<string, unknown>} profile
 * @returns {"diagnostic" | "blocking"}
 */
function resolveBaselineGateMode(profile) {
  const mode = asNonEmptyString(asRecord(asRecord(profile.verification).baseline_gate).mode).toLowerCase();
  if (mode === "blocking") return "blocking";
  if (mode === "diagnostic") return "diagnostic";
  return asNonEmptyString(profile.journey_mode) === "full-journey" ? "diagnostic" : "blocking";
}

/**
 * @param {string} value
 * @param {number} maxLength
 * @returns {string}
 */
function truncateToken(value, maxLength) {
  return value.length <= maxLength ? value : value.slice(0, maxLength).replace(/[._-]+$/u, "");
}

/**
 * @param {string} value
 * @returns {string}
 */
function shortHash(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

/**
 * @param {{ sourcePath: string, runId: string, phase: string, index: number }} options
 * @returns {string}
 */
function preservedRuntimeFileName(options) {
  const extension = path.extname(options.sourcePath) || ".json";
  const sourceBase = path.basename(options.sourcePath, extension);
  const phaseToken = truncateToken(normalizeId(options.phase), 32) || "runtime";
  const runToken = truncateToken(normalizeId(options.runId), 72) || "run";
  const sourceToken = truncateToken(normalizeId(sourceBase), 96) || "artifact";
  const digest = shortHash(`${options.runId}\n${options.sourcePath}`);
  return `live-e2e-${phaseToken}-${runToken}-${String(options.index).padStart(2, "0")}-${sourceToken}-${digest}${extension}`;
}

/**
 * @param {{ sourcePath: string | null, destinationRoot: string, runId: string, phase: string, index: number }} options
 * @returns {string | null}
 */
function preserveRuntimeFile(options) {
  const sourcePath = asNonEmptyString(options.sourcePath);
  if (!sourcePath || !fileExists(sourcePath)) return null;
  const destination = path.join(
    options.destinationRoot,
    preservedRuntimeFileName({
      sourcePath,
      runId: options.runId,
      phase: options.phase,
      index: options.index,
    }),
  );
  fs.copyFileSync(sourcePath, destination);
  return destination;
}

/**
 * @param {{ verifyPayload: Record<string, unknown>, summaryFile: string, reportsRoot: string, runId: string, phase: string }} options
 */
function preserveVerifyArtifacts(options) {
  /** @type {string[]} */
  const preservedFiles = [];
  let index = 1;
  const preserve = (filePath) => {
    const preserved = preserveRuntimeFile({
      sourcePath: asNonEmptyString(filePath),
      destinationRoot: options.reportsRoot,
      runId: options.runId,
      phase: options.phase,
      index,
    });
    index += 1;
    if (preserved) preservedFiles.push(preserved);
    return preserved;
  };

  const preservedSummaryFile = preserve(options.summaryFile);
  /** @type {string[]} */
  const preservedStepResultFiles = [];
  for (const stepResultFile of asStringArray(options.verifyPayload.step_result_files)) {
    const preservedStep = preserve(stepResultFile);
    if (preservedStep) preservedStepResultFiles.push(preservedStep);
    if (fileExists(stepResultFile)) {
      const stepResult = readJson(stepResultFile);
      for (const evidenceRef of asStringArray(asRecord(stepResult).evidence_refs)) {
        preserve(evidenceRef);
      }
    }
  }

  return {
    preserved_summary_file: preservedSummaryFile,
    preserved_step_result_files: preservedStepResultFiles,
    preserved_files: preservedFiles,
  };
}

/**
 * @param {{ verifySummary: Record<string, unknown>, verifyPayload: Record<string, unknown>, stepResultFiles: string[], setupCommands: string[], verificationCommands: string[], mode: "diagnostic" | "blocking" }} options
 */
function evaluateBaselineVerifyGate(options) {
  const failedSteps = options.stepResultFiles
    .filter((filePath) => fileExists(filePath))
    .map((filePath) => ({ filePath, document: asRecord(readJson(filePath)) }))
    .filter((entry) => asNonEmptyString(entry.document.status) === "failed");
  const routedStepResultFile = asNonEmptyString(options.verifyPayload.routed_step_result_file);
  const routedStepResult = routedStepResultFile && fileExists(routedStepResultFile)
    ? asRecord(readJson(routedStepResultFile))
    : {};
  const setupCommandSet = new Set(options.setupCommands);
  const verificationCommandSet = new Set(options.verificationCommands);
  const validationGateStatus = asNonEmptyString(options.verifySummary.validation_gate_status);
  /** @type {string[]} */
  const blockingReasons = [];
  /** @type {string[]} */
  const findings = [];
  /** @type {Array<Record<string, unknown>>} */
  const failedCommands = [];

  if (validationGateStatus && validationGateStatus !== "pass") {
    blockingReasons.push(`validation-gate-${validationGateStatus}`);
  }
  if (!routedStepResultFile || !fileExists(routedStepResultFile)) {
    blockingReasons.push("routed-dry-run-missing");
  } else if (asNonEmptyString(routedStepResult.status) !== "passed") {
    blockingReasons.push("routed-dry-run-failed");
  }

  for (const failedStep of failedSteps) {
    const command = asNonEmptyString(failedStep.document.command);
    const missingPrerequisites = asStringArray(failedStep.document.missing_prerequisites);
    const summary = asNonEmptyString(failedStep.document.summary) || "Verification step failed.";
    failedCommands.push({
      command,
      summary,
      missing_prerequisites: missingPrerequisites,
      step_result_file: failedStep.filePath,
    });
    if (missingPrerequisites.length > 0) {
      blockingReasons.push(`missing-prerequisite:${command || "unknown"}`);
    } else if (command && setupCommandSet.has(command)) {
      blockingReasons.push(`readiness-command-failed:${command}`);
    } else if (!command || !verificationCommandSet.has(command)) {
      blockingReasons.push(`unknown-verification-failure:${command || "unknown"}`);
    } else {
      findings.push(summary);
    }
  }

  if (blockingReasons.length > 0) {
    return {
      phase: "baseline_diagnostic",
      mode: options.mode,
      status: "fail",
      decision: "block",
      summary: blockingReasons[0],
      blocking_reasons: uniqueStrings(blockingReasons),
      findings,
      failed_commands: failedCommands,
      routed_step_result_file: routedStepResultFile || null,
    };
  }

  if (asNonEmptyString(options.verifySummary.status) === "failed") {
    return {
      phase: "baseline_diagnostic",
      mode: options.mode,
      status: options.mode === "blocking" ? "fail" : "warn",
      decision: options.mode === "blocking" ? "block" : "continue_with_warnings",
      summary:
        options.mode === "blocking"
          ? "Baseline verification failed in blocking mode."
          : "Baseline target verification failed, but readiness gates passed; continuing to provider execution.",
      blocking_reasons: options.mode === "blocking" ? ["baseline-verification-failed"] : [],
      findings,
      failed_commands: failedCommands,
      routed_step_result_file: routedStepResultFile || null,
    };
  }

  return {
    phase: "baseline_diagnostic",
    mode: options.mode,
    status: "pass",
    decision: "pass",
    summary: "Baseline readiness and target verification passed.",
    blocking_reasons: [],
    findings,
    failed_commands: failedCommands,
    routed_step_result_file: routedStepResultFile || null,
  };
}

/**
 * @param {Record<string, unknown>} mission
 * @param {Record<string, unknown>} catalogVerification
 * @returns {{ primaryCommands: string[], diagnosticCommands: string[], diagnosticFailureMode: "warn" | "fail" }}
 */
function resolvePostRunQualityPolicy(mission, catalogVerification) {
  const policy = hasObjectFields(asRecord(mission.post_run_quality))
    ? asRecord(mission.post_run_quality)
    : asRecord(mission.postRunQuality);
  const primaryCommands = asStringArray(policy.primary_commands);
  const diagnosticCommands = asStringArray(policy.diagnostic_commands);
  const diagnosticFailureMode = asNonEmptyString(policy.diagnostic_failure_mode) === "fail" ? "fail" : "warn";
  return {
    primaryCommands: primaryCommands.length > 0 ? primaryCommands : asStringArray(catalogVerification.commands),
    diagnosticCommands,
    diagnosticFailureMode,
  };
}

/**
 * @param {Record<string, unknown>} profile
 * @returns {"readme-smoke" | "bounded-live" | "full-journey-observation" | "acceptance" | "production-proof"}
 */
function resolveRunTier(profile) {
  const declared = asNonEmptyString(profile.run_tier);
  if (
    declared === "readme-smoke" ||
    declared === "bounded-live" ||
    declared === "full-journey-observation" ||
    declared === "acceptance" ||
    declared === "production-proof"
  ) {
    return declared;
  }
  if (asRecord(profile.production_proof).enabled === true) {
    return "production-proof";
  }
  if (asNonEmptyString(profile.journey_mode) === "full-journey" || asNonEmptyString(profile.target_catalog_id)) {
    return "acceptance";
  }
  return "bounded-live";
}

/**
 * @param {string} featureSize
 * @returns {boolean}
 */
function requiresStrictMissionIntake(featureSize) {
  return featureSize === "medium" || featureSize === "large" || featureSize === "xl";
}

/**
 * @param {{
 *   mission: Record<string, unknown>,
 *   featureSize: string,
 *   scenarioFamily: string,
 *   postRunQualityPolicy: ReturnType<typeof resolvePostRunQualityPolicy>,
 * }}
 */
function evaluateMissionIntakeQuality(options) {
  const strictRequired = requiresStrictMissionIntake(options.featureSize);
  /** @type {string[]} */
  const missingFields = [];
  const hasKpis = normalizeMissionKpis(options.mission.kpis).length > 0;
  const checks = [
    ["goals", asStringArray(options.mission.goals).length > 0],
    ["kpis", hasKpis],
    ["definition_of_done", asStringArray(options.mission.definition_of_done).length > 0],
    ["expected_evidence", asStringArray(options.mission.expected_evidence).length > 0],
    ["post_run_quality.primary_commands", options.postRunQualityPolicy.primaryCommands.length > 0],
  ];
  for (const [field, present] of checks) {
    if (!present) missingFields.push(String(field));
  }
  const findings = strictRequired
    ? missingFields.map((field) => `Medium+ mission intake is missing '${field}'.`)
    : [];
  const status = strictRequired && missingFields.length > 0 ? "fail" : "pass";
  return {
    phase: "feature_intake",
    scenario_family: options.scenarioFamily,
    feature_size: options.featureSize,
    strict_required: strictRequired,
    status,
    missing_fields: missingFields,
    findings,
    summary:
      status === "pass"
        ? strictRequired
          ? "Medium+ mission intake has goals, KPIs, Definition of Done, expected evidence, and primary verification commands."
          : "Small mission intake strictness is not required."
        : `Medium+ mission intake is incomplete: ${missingFields.join(", ")}.`,
  };
}

/**
 * @param {{ mission: Record<string, unknown>, featureRequest: ReturnType<typeof materializeFeatureRequestFile>, profile: Record<string, unknown>, projectProfileFile: string }}
 * @returns {string[]}
 */
function buildIntakeCreateArgs(options) {
  const missionId = asNonEmptyString(options.mission.mission_id);
  const title = asNonEmptyString(options.featureRequest.requestDocument.title) || missionId || "Feature mission";
  const brief =
    asNonEmptyString(options.featureRequest.requestDocument.brief) ||
    asNonEmptyString(options.mission.brief) ||
    "Prepare one bounded catalog mission request.";
  const goals = asStringArray(options.mission.goals);
  const constraints = asStringArray(options.mission.acceptance_checks);
  const definitionOfDone =
    asStringArray(options.mission.definition_of_done).length > 0
      ? asStringArray(options.mission.definition_of_done)
      : asStringArray(options.mission.expected_evidence).map((entry) => `Materialize ${entry} evidence.`);
  const kpis = normalizeMissionKpis(options.mission.kpis);
  const effectiveKpis =
    kpis.length > 0
      ? kpis
      : [
          {
            kpi_id: "mission-evidence",
            name: "Mission evidence",
            target: "Required mission evidence is materialized",
            measurement: "live E2E runner summary",
          },
        ];

  return [
    "intake",
    "create",
    "--project-ref",
    ".",
    "--project-profile",
    options.projectProfileFile,
    "--runtime-root",
    ".aor",
    "--request-file",
    options.featureRequest.requestFile,
    "--mission-id",
    missionId,
    "--request-title",
    title,
    "--request-brief",
    brief,
    ...constraints.flatMap((entry) => ["--request-constraints", entry]),
    ...((goals.length > 0 ? goals : [brief]).flatMap((entry) => ["--goal", entry])),
    ...((definitionOfDone.length > 0 ? definitionOfDone : constraints).flatMap((entry) => ["--dod", entry])),
    ...effectiveKpis.flatMap((entry) => [
      "--kpi",
      `${entry.kpi_id}:${entry.name}:${entry.target}${entry.measurement ? `:${entry.measurement}` : ""}`,
    ]),
  ];
}

/**
 * @param {{ label: string, commands: string[] }} options
 * @returns {string[]}
 */
function buildVerifyOverrideArgs(options) {
  const lintCommands = options.commands.filter((command) => /\b(?:xo|eslint|biome|lint)\b/u.test(command));
  const buildCommands = options.commands.filter((command) => /\b(?:build|tsc)\b/u.test(command));
  const testCommands = options.commands.filter((command) => !lintCommands.includes(command) && !buildCommands.includes(command));
  return [
    "--verification-label",
    options.label,
    ...buildCommands.flatMap((entry) => ["--repo-build-command", entry]),
    ...lintCommands.flatMap((entry) => ["--repo-lint-command", entry]),
    ...testCommands.flatMap((entry) => ["--repo-test-command", entry]),
  ];
}

/**
 * @param {string | null | undefined} reportFile
 * @returns {boolean}
 */
function runtimeHarnessReportHasMeaningfulChanges(reportFile) {
  const resolvedReportFile = asNonEmptyString(reportFile);
  if (!resolvedReportFile || !fileExists(resolvedReportFile)) {
    return false;
  }
  const report = asRecord(readJson(resolvedReportFile));
  const stepDecisions = Array.isArray(report.step_decisions) ? report.step_decisions : [];
  return stepDecisions.some((entry) => {
    const semantics = asRecord(asRecord(entry).mission_semantics);
    return (
      asStringArray(semantics.meaningful_changed_paths).length > 0 ||
      asStringArray(semantics.non_bootstrap_changed_paths).length > 0
    );
  });
}

/**
 * @param {{ runId: string, reportsRoot: string, liveAdapterPreflightFile: string | null, validationReportFile: string | null, baselineGateDecision: Record<string, unknown>, baselineRoutedStepResultFile: string | null }}
 */
function writeExecutionReadinessDecision(options) {
  const decisionFile = path.join(
    options.reportsRoot,
    `live-e2e-execution-readiness-${normalizeId(options.runId)}.json`,
  );
  const decision = {
    run_id: options.runId,
    phase: "readiness",
    status: "pass",
    summary: "Execution readiness passed; baseline target verification is diagnostic evidence for full-journey live E2E.",
    live_adapter_preflight_file: options.liveAdapterPreflightFile,
    validation_report_file: options.validationReportFile,
    baseline_gate_decision: options.baselineGateDecision,
    baseline_routed_step_result_file: options.baselineRoutedStepResultFile,
    checked_at: nowIso(),
  };
  writeJson(decisionFile, decision);
  return { decisionFile, decision };
}

/**
 * @param {string[]} commands
 * @returns {boolean}
 */
function commandsRequirePlaywrightCache(commands) {
  return commands.some((command) => /\bplaywright\b|ms-playwright|browserType\.launch/iu.test(command));
}

/**
 * @param {{ targetCheckoutRoot: string, reportsRoot: string, runId: string, commands: string[], env: NodeJS.ProcessEnv, forceFailure?: boolean }}
 */
function prepareBrowserCachePreflight(options) {
  const reportFile = path.join(
    options.reportsRoot,
    `live-e2e-browser-cache-preflight-${normalizeId(options.runId)}.json`,
  );
  const required = commandsRequirePlaywrightCache(options.commands);
  const cacheRoot = path.join(options.targetCheckoutRoot, ".aor", "cache", "ms-playwright");
  if (!required) {
    const report = {
      run_id: options.runId,
      status: "skipped",
      required: false,
      cache_root: cacheRoot,
      env_var: "PLAYWRIGHT_BROWSERS_PATH",
      summary: "No Playwright/browser cache preflight was required by declared target commands.",
      checked_at: nowIso(),
    };
    writeJson(reportFile, report);
    return { status: "skipped", report, reportFile };
  }

  try {
    if (options.forceFailure === true) {
      throw new Error("forced browser cache preflight failure");
    }
    fs.mkdirSync(cacheRoot, { recursive: true });
    const markerFile = path.join(cacheRoot, `.aor-cache-write-${normalizeId(options.runId)}.txt`);
    fs.writeFileSync(markerFile, `browser-cache-preflight:${options.runId}\n`, "utf8");
    fs.rmSync(markerFile, { force: true });
    options.env.PLAYWRIGHT_BROWSERS_PATH = cacheRoot;
    const report = {
      run_id: options.runId,
      status: "pass",
      required: true,
      cache_root: cacheRoot,
      env_var: "PLAYWRIGHT_BROWSERS_PATH",
      summary: "Playwright/browser cache path is target-local and writable before provider execution.",
      checked_at: nowIso(),
    };
    writeJson(reportFile, report);
    return { status: "pass", report, reportFile };
  } catch (error) {
    const summary = `Playwright/browser cache path is not writable: ${error instanceof Error ? error.message : String(error)}`;
    const report = {
      run_id: options.runId,
      status: "fail",
      required: true,
      cache_root: cacheRoot,
      env_var: "PLAYWRIGHT_BROWSERS_PATH",
      summary,
      checked_at: nowIso(),
    };
    writeJson(reportFile, report);
    return { status: "fail", report, reportFile };
  }
}

/**
 * @param {{
 *   scenarioPolicy: Record<string, unknown>,
 *   stageResults: Array<{ stage: string, status: string, evidence_refs: string[], summary: string | null }>,
 *   artifacts: Record<string, unknown>,
 *   auditPayload: Record<string, unknown>,
 * }} options
 */
function evaluateScenarioCoverage(options) {
  const requiredStages = asStringArray(options.scenarioPolicy.required_stages);
  const requiredEvidence = asStringArray(options.scenarioPolicy.required_evidence);
  const stageStatuses = new Map(
    options.stageResults.map((stageResult) => [stageResult.stage, asNonEmptyString(stageResult.status) || "unknown"]),
  );
  /** @type {string[]} */
  const findings = [];

  for (const stage of requiredStages) {
    const stageStatus = stageStatuses.get(stage) || "missing";
    if (stageStatus !== "pass") {
      findings.push(`Required scenario stage '${stage}' completed with status '${stageStatus}'.`);
    }
  }

  const hasAuditRuns =
    Boolean(options.artifacts.run_audit_file) ||
    Array.isArray(asRecord(options.auditPayload).run_audit_records) ||
    Array.isArray(asRecord(options.auditPayload).run_summaries);
  const evidencePresence = {
    "verify-summary": Boolean(options.artifacts.verify_summary_file),
    "routed-step-result": Boolean(options.artifacts.routed_step_result_file),
    "runtime-harness-report": Boolean(options.artifacts.runtime_harness_report_file),
    "review-report": Boolean(options.artifacts.review_report_file),
    "evaluation-report": Boolean(options.artifacts.evaluation_report_file),
    "delivery-manifest": Boolean(options.artifacts.delivery_manifest_file),
    "release-packet": Boolean(options.artifacts.release_packet_file),
    "audit-runs": hasAuditRuns,
    "learning-loop-scorecard": Boolean(options.artifacts.learning_loop_scorecard_file),
    "learning-loop-handoff": Boolean(options.artifacts.learning_loop_handoff_file),
  };

  for (const evidenceId of requiredEvidence) {
    if (evidencePresence[evidenceId] !== true) {
      findings.push(`Required scenario evidence '${evidenceId}' was not materialized.`);
    }
  }

  return {
    status: findings.length > 0 ? "fail" : "pass",
    required_stages: requiredStages,
    required_evidence: requiredEvidence,
    findings,
    summary:
      findings[0] ??
      `Scenario policy '${asNonEmptyString(options.scenarioPolicy.scenario_family) || "unknown"}' coverage passed.`,
  };
}

/**
 * @param {unknown} value
 * @returns {unknown}
 */
function sortJsonValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => sortJsonValue(entry));
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(/** @type {Record<string, unknown>} */ (value))
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortJsonValue(entry)]),
    );
  }
  return value;
}

/**
 * @param {unknown} left
 * @param {unknown} right
 * @returns {boolean}
 */
function jsonEquivalent(left, right) {
  return JSON.stringify(sortJsonValue(left)) === JSON.stringify(sortJsonValue(right));
}

/**
 * @param {Record<string, unknown>} value
 * @returns {boolean}
 */
function hasObjectFields(value) {
  return Object.keys(value).length > 0;
}

/**
 * @param {{
 *   label: string,
 *   field: string,
 *   expected: Record<string, unknown>,
 *   actual: Record<string, unknown>,
 *   findings: string[],
 * }} options
 */
function compareArtifactObject(options) {
  if (!hasObjectFields(options.actual)) {
    options.findings.push(`Artifact consistency mismatch: ${options.label}.${options.field} is missing.`);
    return;
  }
  if (!jsonEquivalent(options.actual, options.expected)) {
    options.findings.push(`Artifact consistency mismatch: ${options.label}.${options.field} differs from summary.`);
  }
}

/**
 * @param {{
 *   artifacts: Record<string, unknown>,
 *   reviewReport: Record<string, unknown>,
 *   auditPayload: Record<string, unknown>,
 *   runId: string,
 * }} options
 */
function evaluateArtifactConsistency(options) {
  /** @type {string[]} */
  const findings = [];
  const expectedMatrixCell = asRecord(options.artifacts.matrix_cell);
  const expectedCoverageFollowUp = asRecord(options.artifacts.coverage_follow_up);
  const reviewFeatureTraceability = asRecord(options.reviewReport.feature_traceability);
  const auditRecords = Array.isArray(options.auditPayload.run_audit_records)
    ? options.auditPayload.run_audit_records.map((record) => asRecord(record))
    : [];
  const auditRecord =
    auditRecords.find((record) => asNonEmptyString(record.run_id) === options.runId) || auditRecords[0] || {};
  const learningHandoffFile = asNonEmptyString(options.artifacts.learning_loop_handoff_file);
  const learningScorecardFile = asNonEmptyString(options.artifacts.learning_loop_scorecard_file);
  const learningHandoff = learningHandoffFile && fileExists(learningHandoffFile) ? readJson(learningHandoffFile) : {};
  const learningScorecard =
    learningScorecardFile && fileExists(learningScorecardFile) ? readJson(learningScorecardFile) : {};

  if (!hasObjectFields(expectedMatrixCell)) {
    findings.push("Artifact consistency mismatch: summary.matrix_cell is missing.");
  }
  if (!hasObjectFields(expectedCoverageFollowUp)) {
    findings.push("Artifact consistency mismatch: summary.coverage_follow_up is missing.");
  }

  if (hasObjectFields(expectedMatrixCell)) {
    compareArtifactObject({
      label: "review-report.feature_traceability",
      field: "matrix_cell",
      expected: expectedMatrixCell,
      actual: asRecord(reviewFeatureTraceability.matrix_cell),
      findings,
    });
    compareArtifactObject({
      label: "audit-runs.run_audit_records[0]",
      field: "matrix_cell",
      expected: expectedMatrixCell,
      actual: asRecord(auditRecord.matrix_cell),
      findings,
    });
    compareArtifactObject({
      label: "learning-loop-handoff",
      field: "matrix_cell",
      expected: expectedMatrixCell,
      actual: asRecord(learningHandoff.matrix_cell),
      findings,
    });
    compareArtifactObject({
      label: "learning-loop-scorecard",
      field: "matrix_cell",
      expected: expectedMatrixCell,
      actual: asRecord(learningScorecard.matrix_cell),
      findings,
    });
  }

  if (hasObjectFields(expectedCoverageFollowUp)) {
    compareArtifactObject({
      label: "review-report.feature_traceability",
      field: "coverage_follow_up",
      expected: expectedCoverageFollowUp,
      actual: asRecord(reviewFeatureTraceability.coverage_follow_up),
      findings,
    });
    compareArtifactObject({
      label: "audit-runs.run_audit_records[0]",
      field: "coverage_follow_up",
      expected: expectedCoverageFollowUp,
      actual: asRecord(auditRecord.coverage_follow_up),
      findings,
    });
    compareArtifactObject({
      label: "learning-loop-handoff",
      field: "coverage_follow_up",
      expected: expectedCoverageFollowUp,
      actual: asRecord(learningHandoff.coverage_follow_up),
      findings,
    });
    compareArtifactObject({
      label: "learning-loop-scorecard",
      field: "coverage_follow_up",
      expected: expectedCoverageFollowUp,
      actual: asRecord(learningScorecard.coverage_follow_up),
      findings,
    });
  }

  return {
    status: findings.length > 0 ? "fail" : "pass",
    findings,
    summary: findings[0] ?? "Full-journey artifact lineage is internally consistent.",
  };
}

/**
 * @param {unknown} value
 * @returns {"pass" | "warn" | "fail" | "not_attempted"}
 */
function normalizeCanonicalStatus(value) {
  const status = asNonEmptyString(value).toLowerCase();
  if (status === "pass" || status === "passed" || status === "success") return "pass";
  if (status === "warn" || status === "warning" || status === "pass_with_findings") return "warn";
  if (status === "fail" || status === "failed" || status === "not_pass") return "fail";
  return "not_attempted";
}

/**
 * @param {Record<string, unknown>} artifacts
 * @returns {"materialized" | "degraded" | "blocked" | "not_materialized"}
 */
function resolveDeliveryStatus(artifacts) {
  if (!asNonEmptyString(artifacts.delivery_manifest_file)) return "not_materialized";
  if (artifacts.delivery_blocking === true) return "blocked";
  if (asNonEmptyString(artifacts.delivery_quality_gate_status) === "not_pass") return "degraded";
  return "materialized";
}

/**
 * @param {{
 *   commandResults: Array<Record<string, unknown>>,
 *   artifacts: Record<string, unknown>,
 *   artifactConsistency: Record<string, unknown>,
 *   reviewReport: Record<string, unknown>,
 *   scenarioCoverage: Record<string, unknown>,
 *   qualityJudgement: Record<string, unknown>,
 *   runTier: string,
 *   scenarioPolicy: Record<string, unknown>,
 * }}
 */
function buildCanonicalRunStatus(options) {
  const commandStatus =
    options.commandResults.length > 0 && options.commandResults.every((entry) => commandCompletedForCanonicalStatus(entry))
      ? "pass"
      : "fail";
  const targetVerificationStatus = normalizeCanonicalStatus(options.artifacts.post_run_verify_status);
  const intakeGate = asRecord(options.artifacts.intake_quality_gate);
  const reviewArtifactQualityStatus = normalizeCanonicalStatus(asRecord(options.reviewReport.artifact_quality).status);
  const artifactConsistencyStatus = normalizeCanonicalStatus(options.artifactConsistency.status);
  const artifactQualityStatus =
    asNonEmptyString(intakeGate.status) === "fail" ||
    reviewArtifactQualityStatus === "fail" ||
    artifactConsistencyStatus === "fail"
      ? "fail"
      : reviewArtifactQualityStatus === "warn" || artifactConsistencyStatus === "warn"
        ? "warn"
        : "pass";
  const deliveryStatus = resolveDeliveryStatus(options.artifacts);
  const releaseRequired = options.scenarioPolicy.release_required === true;
  const releaseStatus = releaseRequired
    ? normalizeCanonicalStatus(options.artifacts.release_status)
    : asNonEmptyString(options.artifacts.release_status)
      ? normalizeCanonicalStatus(options.artifacts.release_status)
      : "not_attempted";
  const providerExecutionStatus = normalizeCanonicalStatus(options.artifacts.provider_execution_status);
  const realCodeChangeStatus = normalizeCanonicalStatus(options.artifacts.real_code_change_status);
  const scenarioCoverageStatus = normalizeCanonicalStatus(options.scenarioCoverage.status);
  const qualityGateStatus = normalizeCanonicalStatus(options.artifacts.quality_gate_decision);
  const diagnosticStatus = normalizeCanonicalStatus(options.artifacts.post_run_diagnostic_status);
  const strictIntakeFailed = intakeGate.strict_required === true && asNonEmptyString(intakeGate.status) === "fail";
  const releaseMissing = releaseRequired && releaseStatus !== "pass";
  const fatalAcceptance =
    deliveryStatus === "not_materialized" ||
    deliveryStatus === "blocked" ||
    deliveryStatus === "degraded" ||
    commandStatus === "fail" ||
    targetVerificationStatus === "fail" ||
    strictIntakeFailed ||
    artifactQualityStatus === "fail" ||
    providerExecutionStatus === "fail" ||
    realCodeChangeStatus === "fail" ||
    scenarioCoverageStatus === "fail" ||
    qualityGateStatus === "fail" ||
    releaseMissing;
  const acceptanceStatus = fatalAcceptance
    ? "fail"
    : diagnosticStatus === "warn" ||
        diagnosticStatus === "fail" ||
        asNonEmptyString(options.qualityJudgement.overall_status) === "pass_with_findings"
      ? "warn"
      : "pass";
  const hasMatrixCell = hasObjectFields(asRecord(options.artifacts.matrix_cell));
  const proofEligibleTier = options.runTier === "acceptance" || options.runTier === "production-proof";
  const coverageStatus = !hasMatrixCell
    ? "not_attempted"
    : acceptanceStatus === "pass" && proofEligibleTier
      ? "covered_pass"
    : acceptanceStatus === "warn" && deliveryStatus !== "not_materialized"
      ? "covered_with_findings"
      : "attempted_failed";
  const findings = uniqueStrings([
    ...(commandStatus === "fail" ? ["One or more public CLI subprocesses failed."] : []),
    ...(targetVerificationStatus === "fail" ? ["Post-run target verification failed."] : []),
    ...asStringArray(intakeGate.findings),
    ...(artifactConsistencyStatus === "fail" ? asStringArray(options.artifactConsistency.findings) : []),
    ...(deliveryStatus === "blocked" ? ["Delivery evidence was materialized behind a blocking quality finding."] : []),
    ...(deliveryStatus === "degraded" ? ["Delivery quality gate produced observed findings."] : []),
    ...(releaseMissing ? ["Required release stage did not materialize strict release-packet evidence."] : []),
    ...(providerExecutionStatus === "fail" ? ["Provider execution evidence was not materialized."] : []),
    ...(realCodeChangeStatus === "fail" ? ["No meaningful real code change was observed."] : []),
    ...(diagnosticStatus === "warn" || diagnosticStatus === "fail" ? ["Diagnostic post-run verification reported findings."] : []),
  ]);
  return {
    command_status: commandStatus,
    target_verification_status: targetVerificationStatus,
    artifact_quality_status: artifactQualityStatus,
    delivery_status: deliveryStatus,
    coverage_status: coverageStatus,
    acceptance_status: acceptanceStatus,
    run_tier: options.runTier,
    release_status: releaseStatus,
    proof_eligible_tier: proofEligibleTier,
    required_matrix_acceptance_closed: coverageStatus === "covered_pass" && proofEligibleTier,
    findings,
    summary:
      acceptanceStatus === "pass"
        ? "Live E2E acceptance evidence passed."
        : acceptanceStatus === "warn"
          ? "Live E2E reached delivery with findings; required matrix acceptance is not closed."
          : "Live E2E did not meet acceptance requirements.",
  };
}

/**
 * @param {{
 *   hostRoot: string,
 *   layout: ReturnType<typeof ensureRuntimeLayout>,
 *   runId: string,
 *   profilePath: string,
 *   profile: Record<string, unknown>,
 *   aorLaunch: ReturnType<typeof resolveAorLaunch>,
 *   examplesRoot: string,
 *   runnerAuthMode: "host" | "isolated",
 *   runtimeAgentPermissionMode: "full-bypass" | "restricted",
 *   runtimeAgentInteractionPolicy: "fail-closed" | "ask-all" | "orchestrator-mediated",
 *   runtimeAgentAutoApprovalProfile: "none" | "conservative" | "auto-edit" | "trusted-run",
 *   stepController?: ReturnType<import("./step-controller.mjs").createLiveE2eStepController>,
 * }}
 */
export function executeInstalledUserFlow(options) {
  const stageMap = createStageMap(getProfileStages(options.profile));
  const commandResults = [];
  const transcriptsRoot = path.join(options.layout.reportsRoot, `live-e2e-command-traces-${normalizeId(options.runId)}`);
  fs.mkdirSync(transcriptsRoot, { recursive: true });
  const sessionRoots = createSessionRoots({
    sessionsRoot: options.layout.sessionsRoot,
    runId: options.runId,
  });
  const proofRunnerEnvironment = createProofRunnerEnvironment({
    sessionRoots,
    runnerAuthMode: options.runnerAuthMode,
  });
  const env = proofRunnerEnvironment.env;
  env.AOR_RUNTIME_AGENT_PERMISSION_MODE = options.runtimeAgentPermissionMode;
  env.AOR_RUNTIME_AGENT_INTERACTION_POLICY = options.runtimeAgentInteractionPolicy;
  env.AOR_RUNTIME_AGENT_AUTO_APPROVAL_PROFILE = options.runtimeAgentAutoApprovalProfile;

  const artifacts = {
    host_runtime_root: options.layout.runtimeRoot,
    host_reports_root: options.layout.reportsRoot,
    session_root: sessionRoots.sessionRoot,
    aor_home: sessionRoots.aorHome,
    codex_home: sessionRoots.codexHome,
    codex_home_isolated: options.runnerAuthMode === "isolated",
    runner_auth_mode: proofRunnerEnvironment.runnerAuthMode,
    runner_auth_source: proofRunnerEnvironment.runnerAuthSource,
    runtime_agent_permission_mode: options.runtimeAgentPermissionMode,
    runtime_agent_interaction_policy: options.runtimeAgentInteractionPolicy,
    runtime_agent_auto_approval_profile: options.runtimeAgentAutoApprovalProfile,
    run_tier: resolveRunTier(options.profile),
  };
  hydrateControllerArtifacts(artifacts, options.stepController);
  const markStage = (currentStageMap, stage, status, evidenceRefs = [], summary = null, observeOptions = {}) => {
    markStageRaw(currentStageMap, stage, status, evidenceRefs, summary);
    if (currentStageMap === stageMap) {
      options.stepController?.observeStage({
        stage,
        stageResult: currentStageMap[stage],
        commandResults,
        artifacts,
        ...observeOptions,
      });
    }
  };
  const startedAt = nowIso();
  try {
    const targetCheckout = materializeTargetCheckout({
      hostRoot: options.hostRoot,
      layout: options.layout,
      runId: options.runId,
      profile: options.profile,
      reuseExistingCheckout: options.stepController?.hasPersistedProgress?.() === true,
    });
    artifacts.target_checkout_root = targetCheckout.targetCheckoutRoot;
    artifacts.target_repo_ref = targetCheckout.targetRepoRef;
    artifacts.target_repo_url = targetCheckout.targetRepoUrl;
    const installedBrowserCachePreflight = prepareBrowserCachePreflight({
      targetCheckoutRoot: targetCheckout.targetCheckoutRoot,
      reportsRoot: options.layout.reportsRoot,
      runId: options.runId,
      commands: uniqueStrings([
        ...asStringArray(asRecord(options.profile.verification).setup_commands),
        ...asStringArray(asRecord(options.profile.verification).commands),
      ]),
      env,
    });
    artifacts.browser_cache_preflight_file = installedBrowserCachePreflight.reportFile;
    artifacts.browser_cache_preflight = installedBrowserCachePreflight.report;
    if (installedBrowserCachePreflight.status === "fail") {
      markStage(
        stageMap,
        "bootstrap",
        "fail",
        [installedBrowserCachePreflight.reportFile],
        asNonEmptyString(installedBrowserCachePreflight.report.summary) || "Browser cache preflight failed.",
      );
      throw new Error(asNonEmptyString(installedBrowserCachePreflight.report.summary) || "Browser cache preflight failed.");
    }

    const hostAssets = materializeHostLiveE2eAssets({
      examplesRoot: options.examplesRoot,
      generatedAssetsRoot: path.join(options.layout.stateRoot, "live-e2e-assets", normalizeId(options.runId)),
    });
    artifacts.host_live_e2e_assets_root = hostAssets.assetsRoot;

    const generatedProfile = materializeGeneratedProjectProfile({
      hostRoot: options.hostRoot,
      profilePath: options.profilePath,
      profile: options.profile,
      catalogEntry: options.catalogEntry,
      runId: options.runId,
      targetCheckout,
      generatedAssetsRoot: hostAssets.assetsRoot,
    });
    artifacts.generated_project_profile_file = generatedProfile.generatedProjectProfileFile;
    artifacts.project_profile_template_file = generatedProfile.templateProjectProfilePath;
    markStage(
      stageMap,
      "bootstrap",
      "pass",
      [generatedProfile.generatedProjectProfileFile],
      "Target checkout cloned and host-side live E2E project profile prepared.",
    );

    const commandBaseArgs = [
      "--project-ref",
      ".",
      "--project-profile",
      generatedProfile.generatedProjectProfileFile,
      "--runtime-root",
      ".aor",
    ];
    let commandIndex = 1;
    const runCommand = (label, args, runOptions = {}) => {
      const iteration = Number(runOptions.iteration) || 1;
      if (options.stepController?.shouldUseCachedCommand?.(label, iteration) === true) {
        const cachedDiagnostic = asRecord(options.stepController.getCachedCommandResult(label, iteration));
        const cachedResult = buildCachedCommandResult(cachedDiagnostic);
        if (cachedResult) {
          commandIndex += 1;
          if (
            !commandResults.some(
              (entry) =>
                asNonEmptyString(entry.label) === label &&
                (Number(entry.iteration) || 1) === iteration &&
                asNonEmptyString(entry.step_instance_id) === asNonEmptyString(cachedDiagnostic.step_instance_id),
            )
          ) {
            commandResults.push(cachedDiagnostic);
          }
          return cachedResult;
        }
      }
      if (runOptions.suppressControllerPlan !== true) {
        options.stepController?.planCommand?.({
          label,
          commandSurface: resolveCommandSurface(args),
          iteration,
        });
      }
      const result = runAorCommand({
        launch: options.aorLaunch,
        cwd: targetCheckout.targetCheckoutRoot,
        args,
        env,
        transcriptsRoot,
        label,
        index: commandIndex,
      });
      commandIndex += 1;
      const diagnostic = buildCommandDiagnostic(result);
      annotateCommandDiagnosticStep(diagnostic, label, iteration);
      if (!result.ok && runOptions.allowNonZeroWithPayload === true && result.payload) {
        diagnostic.accepted_nonzero_payload = true;
        diagnostic.failure_class = "nonzero-with-readable-payload";
        diagnostic.recommendation = "inspect payload quality fields";
      }
      commandResults.push(diagnostic);
      const requestedInteraction = asRecord(diagnostic.interactive_continuation);
      const deterministicAnswer =
        options.stepController?.mode === "manual"
          ? null
          : resolveDeterministicInteractionAnswer(options.profile, requestedInteraction);
      if (result.ok && deterministicAnswer) {
        const interactionId = asNonEmptyString(requestedInteraction.interaction_id);
        if (!interactionId) {
          throw new Error(`Public CLI command '${label}' requested interaction without interaction_id.`);
        }
        const answerResult = runAorCommand({
          launch: options.aorLaunch,
          cwd: targetCheckout.targetCheckoutRoot,
          args: [
            "run",
            "answer",
            "--project-ref",
            ".",
            "--run-id",
            options.runId,
            "--interaction-id",
            interactionId,
            "--answer",
            deterministicAnswer.answer,
            "--reason",
            deterministicAnswer.reason ?? "Live E2E deterministic interaction answer policy.",
          ],
          env,
          transcriptsRoot,
          label: `${label}-interaction-answer`,
          index: commandIndex,
        });
        commandIndex += 1;
        const answerDiagnostic = buildCommandDiagnostic(answerResult);
        annotateCommandDiagnosticStep(answerDiagnostic, `${label}-interaction-answer`, iteration);
        commandResults.push(answerDiagnostic);
        if (!answerResult.ok) {
          const stderr = answerResult.stderr.trim() || answerResult.stdout.trim() || "interaction answer command failed";
          throw new Error(`Public CLI interaction answer for '${label}' failed: ${stderr}`);
        }
        updateDiagnosticWithInteractionAnswer(diagnostic, answerResult);
      }
      if (!result.ok && !(runOptions.allowNonZeroWithPayload === true && result.payload)) {
        const stderr = result.stderr.trim() || result.stdout.trim() || "command failed";
        throw new Error(`Public CLI command '${label}' failed: ${stderr}`);
      }
      return result;
    };

    const analyze = runCommand("project-analyze", ["project", "analyze", ...commandBaseArgs]);
    Object.assign(artifacts, {
      analysis_report_file: getStringField(analyze.payload, "analysis_report_file"),
      route_resolution_file: getStringField(analyze.payload, "route_resolution_file"),
      asset_resolution_file: getStringField(analyze.payload, "asset_resolution_file"),
      policy_resolution_file: getStringField(analyze.payload, "policy_resolution_file"),
      evaluation_registry_file: getStringField(analyze.payload, "evaluation_registry_file"),
    });
    markStage(
      stageMap,
      "discovery",
      "pass",
      uniqueStrings([analyze.transcriptFile, ...collectStringRefs(analyze.payload)]),
      "Project analysis completed through the public CLI.",
    );

    const validate = runCommand("project-validate", ["project", "validate", ...commandBaseArgs]);
    artifacts.validation_report_file = getStringField(validate.payload, "validation_report_file");
    const validationStatus = getStringField(validate.payload, "validation_status") || "unknown";
    if (validationStatus === "fail") {
      markStage(
        stageMap,
        "spec",
        "fail",
        uniqueStrings([validate.transcriptFile, ...collectStringRefs(validate.payload)]),
        "Project validation failed.",
      );
      throw new Error("Project validation failed.");
    }
    markStage(
      stageMap,
      "spec",
      "pass",
      uniqueStrings([validate.transcriptFile, ...collectStringRefs(validate.payload)]),
      "Project validation completed.",
    );

    const handoffPrepare = runCommand("handoff-prepare", [
      "handoff",
      "prepare",
      ...commandBaseArgs,
      "--ticket-id",
      `${options.runId}.ticket`,
    ]);
    artifacts.handoff_packet_file = getStringField(handoffPrepare.payload, "handoff_packet_file");
    artifacts.wave_ticket_file = getStringField(handoffPrepare.payload, "wave_ticket_file");
    markStage(
      stageMap,
      "planning",
      "pass",
      uniqueStrings([handoffPrepare.transcriptFile, ...collectStringRefs(handoffPrepare.payload)]),
      "Handoff packet prepared through the public CLI.",
    );

    const handoffApprove = runCommand("handoff-approve", [
      "handoff",
      "approve",
      "--project-ref",
      ".",
      "--handoff-packet",
      /** @type {string} */ (artifacts.handoff_packet_file),
      "--approval-ref",
      `approval://installed-user-live-e2e/${normalizeId(options.runId)}`,
    ]);
    artifacts.approved_handoff_packet_file = getStringField(handoffApprove.payload, "handoff_packet_file");
    markStage(
      stageMap,
      "handoff",
      "pass",
      uniqueStrings([handoffApprove.transcriptFile, ...collectStringRefs(handoffApprove.payload)]),
      "Handoff packet approved.",
    );

    const executionAlreadyObserved = controllerObservedStep(options.stepController, "execution");
    const cachedPreflightSummaryPath = asNonEmptyString(artifacts.verify_summary_file);
    const canReusePreExecutionReadiness =
      executionAlreadyObserved &&
      cachedPreflightSummaryPath &&
      fileExists(cachedPreflightSummaryPath) &&
      asNonEmptyString(artifacts.target_cleanliness_before_execution_file) &&
      fileExists(asNonEmptyString(artifacts.target_cleanliness_before_execution_file));
    if (executionAlreadyObserved && !canReusePreExecutionReadiness) {
      const summary = "Observed execution cannot resume without preserved pre-execution readiness evidence.";
      markStageRaw(stageMap, "execution", "fail", [], summary);
      throw new Error(summary);
    }
    let verifySummaryPath = /** @type {string | null} */ (cachedPreflightSummaryPath || null);
    /** @type {string[]} */
    let preflightEvidenceRefs = uniqueStrings([
      verifySummaryPath,
      ...asStringArray(artifacts.preflight_step_result_files),
      asNonEmptyString(artifacts.target_cleanliness_before_execution_file),
    ]);
    if (!executionAlreadyObserved) {
      const verifyPreflight = runCommand("project-verify-preflight", [
        "project",
        "verify",
        ...commandBaseArgs,
        "--require-validation-pass",
        "true",
      ]);
      artifacts.verify_summary_file = getStringField(verifyPreflight.payload, "verify_summary_file");
      artifacts.preflight_step_result_files = getStringArrayField(verifyPreflight.payload, "step_result_files");
      verifySummaryPath = /** @type {string} */ (artifacts.verify_summary_file);
      if (!verifySummaryPath || !fileExists(verifySummaryPath)) {
        throw new Error("Preflight verify summary was not materialized.");
      }
      const verifySummary = readJson(verifySummaryPath);
      if (verifySummary.status === "failed") {
        markStage(
          stageMap,
          "execution",
          "fail",
          uniqueStrings([verifyPreflight.transcriptFile, verifySummaryPath, ...collectStringRefs(verifyPreflight.payload)]),
          "Preflight verify failed before live execution.",
        );
        throw new Error("Preflight verify failed before live execution.");
      }
      const targetCleanliness = writeTargetCleanlinessReport({
        targetCheckoutRoot: targetCheckout.targetCheckoutRoot,
        reportsRoot: options.layout.reportsRoot,
        runId: options.runId,
        phase: "before-execution",
      });
      artifacts.target_cleanliness_before_execution_file = targetCleanliness.reportFile;
      artifacts.target_cleanliness_before_execution = targetCleanliness.report;
      if (targetCleanliness.report.status !== "pass") {
        markStage(
          stageMap,
          "execution",
          "fail",
          [targetCleanliness.reportFile],
          asNonEmptyString(targetCleanliness.report.summary) || "Target setup changed tracked files before execution.",
        );
        throw new Error(asNonEmptyString(targetCleanliness.report.summary) || "Target setup changed tracked files before execution.");
      }
      preflightEvidenceRefs = uniqueStrings([
        verifyPreflight.transcriptFile,
        verifySummaryPath,
        ...collectStringRefs(verifyPreflight.payload),
        targetCleanliness.reportFile,
      ]);
    } else {
      artifacts.pre_execution_readiness_reused_after_resume = true;
    }

    const promotionRefsForLiveExecution = shouldIncludePromotionEvidence(options.profile)
      ? uniqueStrings([verifySummaryPath, ...asStringArray(artifacts.preflight_step_result_files)])
      : [];
    const routedLiveArgs = [
      "project",
      "verify",
      ...commandBaseArgs,
      "--require-validation-pass",
      "true",
      "--routed-live-step",
      "implement",
    ];
    if (shouldIncludeApprovedHandoff(options.profile) && artifacts.approved_handoff_packet_file) {
      routedLiveArgs.push("--approved-handoff-ref", /** @type {string} */ (artifacts.approved_handoff_packet_file));
    }
    if (promotionRefsForLiveExecution.length > 0) {
      routedLiveArgs.push("--promotion-evidence-refs", promotionRefsForLiveExecution.join(","));
    }
    const routedLive = runCommand("project-verify-routed-live", routedLiveArgs);
    artifacts.routed_verify_summary_file = getStringField(routedLive.payload, "verify_summary_file");
    artifacts.routed_step_result_file = getStringField(routedLive.payload, "routed_step_result_file");
    artifacts.routed_step_result_id = getStringField(routedLive.payload, "routed_step_result_id");
    const routedStepResultPath = /** @type {string} */ (artifacts.routed_step_result_file);
    if (!routedStepResultPath || !fileExists(routedStepResultPath)) {
      throw new Error("Routed live step-result was not materialized.");
    }
    const routedStepResult = readJson(routedStepResultPath);
    const routedExecution = asRecord(routedStepResult.routed_execution);
    const adapterResponse = asRecord(routedExecution.adapter_response);
    const adapterOutput = asRecord(adapterResponse.output);
    artifacts.compiled_context_ref = asNonEmptyString(asRecord(routedExecution.context_compilation).compiled_context_ref) || null;
    artifacts.compiled_context_file = asNonEmptyString(asRecord(routedExecution.context_compilation).compiled_context_file) || null;
    artifacts.adapter_raw_evidence_ref = asNonEmptyString(asRecord(adapterOutput.external_runner).raw_evidence_ref) || null;
    const routedStatus = asNonEmptyString(routedStepResult.status);
    if (routedStatus !== "passed") {
      const failureSummary =
        asNonEmptyString(routedStepResult.summary) ||
        asNonEmptyString(adapterResponse.summary) ||
        "Routed live execution failed.";
      markStage(
        stageMap,
        "execution",
        "fail",
        uniqueStrings([routedLive.transcriptFile, routedStepResultPath, ...collectStringRefs(routedStepResult)]),
        failureSummary,
      );
      throw new Error(failureSummary);
    }
    markStage(
      stageMap,
      "execution",
      artifacts.execution_degraded === true ? "fail" : "pass",
      uniqueStrings([
        ...preflightEvidenceRefs,
        routedLive.transcriptFile,
        routedStepResultPath,
        ...collectStringRefs(routedStepResult),
      ]),
      "Preflight verify and routed live execution passed.",
    );

    /** @type {string[]} */
    const promotionEvidenceRefs = [routedStepResultPath];

    const evalSuites = getEvalSuites(options.profile);
    if (evalSuites.length > 0) {
      const evalRun = runCommand("eval-run", [
        "eval",
        "run",
        ...commandBaseArgs,
        "--suite-ref",
        evalSuites[0],
        "--subject-ref",
        `run://${options.runId}`,
      ]);
      artifacts.evaluation_report_file = getStringField(evalRun.payload, "evaluation_report_file");
      const evaluationStatus = getStringField(evalRun.payload, "evaluation_status") || "unknown";
      if (artifacts.evaluation_report_file) {
        promotionEvidenceRefs.push(/** @type {string} */ (artifacts.evaluation_report_file));
      }
      if (evaluationStatus !== "pass") {
        markStage(
          stageMap,
          "qa",
          "fail",
          uniqueStrings([evalRun.transcriptFile, ...collectStringRefs(evalRun.payload)]),
          "Evaluation report failed.",
        );
        throw new Error("Evaluation report failed.");
      }
      markStage(
        stageMap,
        "qa",
        "pass",
        uniqueStrings([evalRun.transcriptFile, ...collectStringRefs(evalRun.payload)]),
        "Eval run passed.",
      );
      if (getHarnessCertification(options.profile) === null) {
        markStage(
          stageMap,
          "review",
          "pass",
          uniqueStrings([evalRun.transcriptFile, ...collectStringRefs(evalRun.payload)]),
          "Review reused evaluation evidence.",
        );
      }
    } else {
      markStage(stageMap, "qa", "skipped", [], "Profile has no eval suites.");
    }

    const harnessCertification = getHarnessCertification(options.profile);
    if (harnessCertification) {
      const certify = runCommand("harness-certify", [
        "harness",
        "certify",
        ...commandBaseArgs,
        "--asset-ref",
        harnessCertification.assetRef,
        "--subject-ref",
        harnessCertification.subjectRef,
        "--suite-ref",
        harnessCertification.suiteRef,
        "--step-class",
        harnessCertification.stepClass,
      ]);
      artifacts.promotion_decision_file = getStringField(certify.payload, "promotion_decision_file");
      artifacts.certification_evaluation_report_file = getStringField(certify.payload, "certification_evaluation_report_file");
      artifacts.certification_harness_capture_file = getStringField(certify.payload, "certification_harness_capture_file");
      artifacts.certification_harness_replay_file = getStringField(certify.payload, "certification_harness_replay_file");
      const promotionStatus = getStringField(certify.payload, "promotion_decision_status") || "unknown";
      if (artifacts.promotion_decision_file) {
        promotionEvidenceRefs.push(/** @type {string} */ (artifacts.promotion_decision_file));
      }
      if (promotionStatus !== "pass") {
        markStage(
          stageMap,
          "review",
          "fail",
          uniqueStrings([certify.transcriptFile, ...collectStringRefs(certify.payload)]),
          "Harness certification did not pass.",
        );
        throw new Error("Harness certification did not pass.");
      }
      markStage(
        stageMap,
        "review",
        "pass",
        uniqueStrings([certify.transcriptFile, ...collectStringRefs(certify.payload)]),
        "Harness certification passed.",
      );
    } else if (stageMap.review?.status === "pending") {
      markStage(stageMap, "review", "skipped", [], "Profile has no harness certification step.");
    }

    const deliverArgs = [
      "deliver",
      "prepare",
      ...commandBaseArgs,
      "--run-id",
      options.runId,
      "--step-class",
      "implement",
      "--mode",
      getPreferredDeliveryMode(options.profile),
      "--quality-gate-mode",
      "observe",
    ];
    if (artifacts.approved_handoff_packet_file) {
      deliverArgs.push("--approved-handoff-ref", /** @type {string} */ (artifacts.approved_handoff_packet_file));
    }
    if (promotionEvidenceRefs.length > 0) {
      deliverArgs.push("--promotion-evidence-refs", uniqueStrings(promotionEvidenceRefs).join(","));
    }
    const deliver = runCommand("deliver-prepare", deliverArgs, { allowNonZeroWithPayload: true });
    const deliveryRuntimeHarnessReportFile = getStringField(deliver.payload, "runtime_harness_report_file");
    Object.assign(artifacts, {
      delivery_plan_file: getStringField(deliver.payload, "delivery_plan_file"),
      delivery_manifest_file: getStringField(deliver.payload, "delivery_manifest_file"),
      delivery_transcript_file: getStringField(deliver.payload, "delivery_transcript_file"),
      delivery_mode: getStringField(deliver.payload, "delivery_mode"),
      delivery_quality_gate_mode: getStringField(deliver.payload, "delivery_quality_gate_mode"),
      delivery_quality_gate_status: getStringField(deliver.payload, "delivery_quality_gate_status"),
      delivery_quality_gate_findings: asStringArray(deliver.payload?.delivery_quality_gate_findings),
      delivery_runtime_harness_report_file: deliveryRuntimeHarnessReportFile,
      runtime_harness_report_file:
        asNonEmptyString(artifacts.runtime_harness_report_file) || deliveryRuntimeHarnessReportFile,
      delivery_blocking: deliver.payload?.delivery_blocking === true,
      delivery_blocking_reasons: asStringArray(deliver.payload?.delivery_blocking_reasons),
    });
    if (!artifacts.delivery_manifest_file) {
      markStage(
        stageMap,
        "delivery",
        "fail",
        uniqueStrings([deliver.transcriptFile, ...collectStringRefs(deliver.payload)]),
        "Delivery prepare did not materialize delivery evidence.",
      );
      throw new Error("Delivery prepare did not materialize delivery evidence.");
    }
    markStage(
      stageMap,
      "delivery",
      artifacts.delivery_blocking === true || artifacts.delivery_quality_gate_status === "not_pass" ? "warn" : "pass",
      uniqueStrings([deliver.transcriptFile, ...collectStringRefs(deliver.payload)]),
      artifacts.delivery_blocking === true || artifacts.delivery_quality_gate_status === "not_pass"
        ? "Delivery evidence materialized with observed quality findings."
        : "Delivery prepare materialized delivery evidence.",
    );
    if (asNonEmptyString(asRecord(options.profile.live_e2e).flow_range_policy) === "full_lifecycle") {
      const releasePrepare = runCommand("release-prepare", [
        "release",
        "prepare",
        ...commandBaseArgs,
        "--run-id",
        options.runId,
        "--step-class",
        "implement",
        "--mode",
        getPreferredDeliveryMode(options.profile),
        ...(artifacts.approved_handoff_packet_file
          ? ["--approved-handoff-ref", /** @type {string} */ (artifacts.approved_handoff_packet_file)]
          : []),
        ...(promotionEvidenceRefs.length > 0 ? ["--promotion-evidence-refs", uniqueStrings(promotionEvidenceRefs).join(",")] : []),
      ], { allowNonZeroWithPayload: true });
      artifacts.release_delivery_manifest_file = getStringField(releasePrepare.payload, "delivery_manifest_file");
      artifacts.release_delivery_transcript_file = getStringField(releasePrepare.payload, "delivery_transcript_file");
      artifacts.release_packet_file = getStringField(releasePrepare.payload, "release_packet_file");
      artifacts.release_packet_status = getStringField(releasePrepare.payload, "release_packet_status");
      artifacts.release_prepare_transcript_file = releasePrepare.transcriptFile;
      artifacts.release_status = artifacts.release_packet_file ? "pass" : "fail";
      markStage(
        stageMap,
        "release",
        artifacts.release_status,
        uniqueStrings([releasePrepare.transcriptFile, ...collectStringRefs(releasePrepare.payload)]),
        artifacts.release_packet_file
          ? "Release prepare materialized release packet evidence for the bounded full-lifecycle profile."
          : "Release prepare did not materialize release packet evidence.",
      );
      if (!artifacts.release_packet_file) {
        throw new Error("Release prepare did not materialize release packet evidence.");
      }

      const auditRuns = runCommand("audit-runs", [
        "audit",
        "runs",
        "--project-ref",
        ".",
        "--project-profile",
        generatedProfile.generatedProjectProfileFile,
        "--runtime-root",
        ".aor",
        "--run-id",
        options.runId,
      ]);
      artifacts.run_audit_file = auditRuns.transcriptFile;

      const learningHandoff = runCommand("learning-handoff", [
        "learning",
        "handoff",
        "--project-ref",
        ".",
        "--project-profile",
        generatedProfile.generatedProjectProfileFile,
        "--runtime-root",
        ".aor",
        "--run-id",
        options.runId,
      ]);
      artifacts.learning_loop_scorecard_file = getStringField(learningHandoff.payload, "learning_loop_scorecard_file");
      artifacts.learning_loop_handoff_file = getStringField(learningHandoff.payload, "learning_loop_handoff_file");
      artifacts.latest_runtime_harness_report_file =
        getStringField(learningHandoff.payload, "runtime_harness_report_file") ||
        artifacts.latest_runtime_harness_report_file ||
        artifacts.runtime_harness_report_file;
      artifacts.latest_runtime_harness_decision =
        getStringField(learningHandoff.payload, "runtime_harness_overall_decision") ||
        artifacts.latest_runtime_harness_decision ||
        artifacts.runtime_harness_overall_decision;
      if (!artifacts.learning_loop_scorecard_file || !artifacts.learning_loop_handoff_file) {
        markStage(
          stageMap,
          "learning",
          "fail",
          uniqueStrings([learningHandoff.transcriptFile, ...collectStringRefs(learningHandoff.payload)]),
          "Learning handoff did not materialize the required public closure artifacts.",
        );
        throw new Error("Learning handoff did not materialize the required public closure artifacts.");
      }
      markStage(
        stageMap,
        "learning",
        "pass",
        uniqueStrings([auditRuns.transcriptFile, learningHandoff.transcriptFile, ...collectStringRefs(learningHandoff.payload)]),
        "Public audit and learning-loop closure artifacts materialized for the bounded full-lifecycle profile.",
      );
    } else {
      artifacts.release_status = "skipped";
      markStage(stageMap, "release", "skipped", [], "Delivery-default flow range excludes release.");
    }

    return {
      startedAt,
      finishedAt: nowIso(),
      status: "pass",
      stageResults: flattenStageMap(stageMap),
      commandResults,
      artifacts,
      sessionRoots,
    };
  } catch (error) {
    if (isLiveE2eControllerStop(error)) {
      artifacts.live_e2e_controller_stop = {
        reason: error.message,
        decision: asRecord(error.decision),
        state: asRecord(error.state),
      };
      return {
        startedAt,
        finishedAt: nowIso(),
        status: asNonEmptyString(asRecord(error.decision).action) === "continue" ? "pass" : "fail",
        stageResults: flattenStageMap(stageMap),
        commandResults,
        artifacts,
        sessionRoots,
      };
    }
    const summary = error instanceof Error ? error.message : String(error);
    if (!flattenStageMap(stageMap).some((stage) => stage.status === "fail")) {
      const fallbackStage = flattenStageMap(stageMap).find((stage) => stage.status === "pending")?.stage ?? "bootstrap";
      markStageRaw(stageMap, fallbackStage, "fail", [], summary);
      try {
        options.stepController?.observeStage({
          stage: fallbackStage,
          stageResult: stageMap[fallbackStage],
          commandResults,
          artifacts,
        });
      } catch (controllerError) {
        if (!isLiveE2eControllerStop(controllerError)) throw controllerError;
      }
    }
    return {
      startedAt,
      finishedAt: nowIso(),
      status: "fail",
      stageResults: flattenStageMap(stageMap),
      commandResults,
      artifacts,
      sessionRoots,
    };
  }
}

/**
 * @param {{
 *   hostRoot: string,
 *   layout: ReturnType<typeof ensureRuntimeLayout>,
 *   runId: string,
 *   profilePath: string,
 *   profile: Record<string, unknown>,
 *   aorLaunch: ReturnType<typeof resolveAorLaunch>,
 *   examplesRoot: string,
 *   examplesRootOverride: string | null,
 *   catalogTargetPath: string,
 *   catalogEntry: Record<string, unknown>,
 *   mission: Record<string, unknown>,
 *   scenarioPolicyPath: string,
 *   scenarioPolicy: Record<string, unknown>,
 *   providerVariantPath: string,
 *   providerVariant: Record<string, unknown>,
 *   featureSize: string,
 *   matrixCell: Record<string, unknown>,
 *   coverageFollowUp: Record<string, unknown>,
 *   coverageTier: string,
 *   runnerAuthMode: "host" | "isolated",
 *   runtimeAgentPermissionMode: "full-bypass" | "restricted",
 *   runtimeAgentInteractionPolicy: "fail-closed" | "ask-all" | "orchestrator-mediated",
 *   runtimeAgentAutoApprovalProfile: "none" | "conservative" | "auto-edit" | "trusted-run",
 *   authProbeRequired: boolean,
 *   stepController?: ReturnType<import("./step-controller.mjs").createLiveE2eStepController>,
 * }} options
 */
export function executeFullJourneyFlow(options) {
  const stageMap = createStageMap(getProfileStages(options.profile));
  const commandResults = [];
  const transcriptsRoot = path.join(options.layout.reportsRoot, `live-e2e-command-traces-${normalizeId(options.runId)}`);
  fs.mkdirSync(transcriptsRoot, { recursive: true });
  const sessionRoots = createSessionRoots({
    sessionsRoot: options.layout.sessionsRoot,
    runId: options.runId,
  });
  const proofRunnerEnvironment = createProofRunnerEnvironment({
    sessionRoots,
    runnerAuthMode: options.runnerAuthMode,
  });
  const env = proofRunnerEnvironment.env;
  env.AOR_RUNTIME_AGENT_PERMISSION_MODE = options.runtimeAgentPermissionMode;
  env.AOR_RUNTIME_AGENT_INTERACTION_POLICY = options.runtimeAgentInteractionPolicy;
  env.AOR_RUNTIME_AGENT_AUTO_APPROVAL_PROFILE = options.runtimeAgentAutoApprovalProfile;
  if (options.examplesRootOverride) {
    env.AOR_BOOTSTRAP_ASSETS_ROOT = options.examplesRootOverride;
    env.AOR_EXAMPLES_ROOT = options.examplesRootOverride;
  }

  const artifacts = {
    host_runtime_root: options.layout.runtimeRoot,
    host_reports_root: options.layout.reportsRoot,
    session_root: sessionRoots.sessionRoot,
    aor_home: sessionRoots.aorHome,
    codex_home: sessionRoots.codexHome,
    codex_home_isolated: options.runnerAuthMode === "isolated",
    runner_auth_mode: proofRunnerEnvironment.runnerAuthMode,
    runner_auth_source: proofRunnerEnvironment.runnerAuthSource,
    runtime_agent_permission_mode: options.runtimeAgentPermissionMode,
    runtime_agent_interaction_policy: options.runtimeAgentInteractionPolicy,
    runtime_agent_auto_approval_profile: options.runtimeAgentAutoApprovalProfile,
    target_catalog_file: options.catalogTargetPath,
    scenario_policy_file: options.scenarioPolicyPath,
    provider_variant_file: options.providerVariantPath,
    feature_mission_id: asNonEmptyString(options.mission.mission_id) || null,
    scenario_family: asNonEmptyString(options.profile.scenario_family) || null,
    provider_variant_id: asNonEmptyString(options.profile.provider_variant_id) || null,
    feature_size: options.featureSize,
    run_tier: resolveRunTier(options.profile),
    matrix_cell: options.matrixCell,
    coverage_follow_up: options.coverageFollowUp,
    coverage_tier: options.coverageTier,
    production_proof: asRecord(options.profile.production_proof),
  };
  hydrateControllerArtifacts(artifacts, options.stepController);
  const markStage = (currentStageMap, stage, status, evidenceRefs = [], summary = null, observeOptions = {}) => {
    markStageRaw(currentStageMap, stage, status, evidenceRefs, summary);
    if (currentStageMap === stageMap) {
      options.stepController?.observeStage({
        stage,
        stageResult: currentStageMap[stage],
        commandResults,
        artifacts,
        ...observeOptions,
      });
    }
  };
  const startedAt = nowIso();
  const internalTestHooks = asRecord(options.profile.internal_test_hooks);
  const guidedJourneyEnabled = isGuidedJourneyEnabled(options.profile);
  let targetHeadBefore = null;

  try {
    const targetCheckout = materializeTargetCheckout({
      hostRoot: options.hostRoot,
      layout: options.layout,
      runId: options.runId,
      profile: options.profile,
      reuseExistingCheckout: options.stepController?.hasPersistedProgress?.() === true,
    });
    artifacts.target_checkout_root = targetCheckout.targetCheckoutRoot;
    artifacts.target_repo_ref = targetCheckout.targetRepoRef;
    artifacts.target_repo_url = targetCheckout.targetRepoUrl;
    artifacts.guided_journey_enabled = guidedJourneyEnabled;
    targetHeadBefore = runGitOutput({
      cwd: targetCheckout.targetCheckoutRoot,
      args: ["rev-parse", "HEAD"],
    });
    const catalogVerification = asRecord(options.catalogEntry.verification);
    const repoLintCommands = asStringArray(catalogVerification.setup_commands);
    const repoVerificationCommands = asStringArray(catalogVerification.commands);
    const postRunQualityPolicy = resolvePostRunQualityPolicy(options.mission, catalogVerification);
    artifacts.post_run_quality_policy = postRunQualityPolicy;
    const browserCachePreflight = prepareBrowserCachePreflight({
      targetCheckoutRoot: targetCheckout.targetCheckoutRoot,
      reportsRoot: options.layout.reportsRoot,
      runId: options.runId,
      commands: uniqueStrings([
        ...repoLintCommands,
        ...repoVerificationCommands,
        ...postRunQualityPolicy.primaryCommands,
        ...postRunQualityPolicy.diagnosticCommands,
      ]),
      env,
      forceFailure: internalTestHooks.force_browser_cache_preflight_failure === true,
    });
    artifacts.browser_cache_preflight_file = browserCachePreflight.reportFile;
    artifacts.browser_cache_preflight = browserCachePreflight.report;
    if (browserCachePreflight.status === "fail") {
      markStage(
        stageMap,
        "bootstrap",
        "fail",
        [browserCachePreflight.reportFile],
        asNonEmptyString(browserCachePreflight.report.summary) || "Browser cache preflight failed.",
      );
      throw new Error(asNonEmptyString(browserCachePreflight.report.summary) || "Browser cache preflight failed.");
    }

    let commandIndex = 1;
    const runCommand = (label, args, runOptions = {}) => {
      const iteration = Number(runOptions.iteration) || 1;
      if (options.stepController?.shouldUseCachedCommand?.(label, iteration) === true) {
        const cachedDiagnostic = asRecord(options.stepController.getCachedCommandResult(label, iteration));
        const cachedResult = buildCachedCommandResult(cachedDiagnostic);
        if (cachedResult) {
          commandIndex += 1;
          if (
            !commandResults.some(
              (entry) =>
                asNonEmptyString(entry.label) === label &&
                (Number(entry.iteration) || 1) === iteration &&
                asNonEmptyString(entry.step_instance_id) === asNonEmptyString(cachedDiagnostic.step_instance_id),
            )
          ) {
            commandResults.push(cachedDiagnostic);
          }
          return cachedResult;
        }
      }
      if (runOptions.suppressControllerPlan !== true) {
        options.stepController?.planCommand?.({
          label,
          commandSurface: resolveCommandSurface(args),
          iteration,
        });
      }
      const result = runAorCommand({
        launch: options.aorLaunch,
        cwd: targetCheckout.targetCheckoutRoot,
        args,
        env,
        transcriptsRoot,
        label,
        index: commandIndex,
      });
      commandIndex += 1;
      const diagnostic = buildCommandDiagnostic(result);
      annotateCommandDiagnosticStep(diagnostic, label, iteration);
      if (!result.ok && runOptions.allowNonZeroWithPayload === true && result.payload) {
        diagnostic.accepted_nonzero_payload = true;
        diagnostic.failure_class = "nonzero-with-readable-payload";
        diagnostic.recommendation = "inspect payload quality fields";
      }
      commandResults.push(diagnostic);
      const requestedInteraction = asRecord(diagnostic.interactive_continuation);
      const deterministicAnswer =
        options.stepController?.mode === "manual"
          ? null
          : resolveDeterministicInteractionAnswer(options.profile, requestedInteraction);
      if (result.ok && deterministicAnswer) {
        const interactionId = asNonEmptyString(requestedInteraction.interaction_id);
        if (!interactionId) {
          throw new Error(`Public CLI command '${label}' requested interaction without interaction_id.`);
        }
        const answerResult = runAorCommand({
          launch: options.aorLaunch,
          cwd: targetCheckout.targetCheckoutRoot,
          args: [
            "run",
            "answer",
            "--project-ref",
            ".",
            "--runtime-root",
            ".aor",
            "--run-id",
            options.runId,
            "--interaction-id",
            interactionId,
            "--answer",
            deterministicAnswer.answer,
            "--reason",
            deterministicAnswer.reason ?? "Live E2E deterministic interaction answer policy.",
          ],
          env,
          transcriptsRoot,
          label: `${label}-interaction-answer`,
          index: commandIndex,
        });
        commandIndex += 1;
        const answerDiagnostic = buildCommandDiagnostic(answerResult);
        annotateCommandDiagnosticStep(answerDiagnostic, `${label}-interaction-answer`, iteration);
        commandResults.push(answerDiagnostic);
        if (!answerResult.ok) {
          const stderr = answerResult.stderr.trim() || answerResult.stdout.trim() || "interaction answer command failed";
          throw new Error(`Public CLI interaction answer for '${label}' failed: ${stderr}`);
        }
        updateDiagnosticWithInteractionAnswer(diagnostic, answerResult);
      }
      if (!result.ok && !(runOptions.allowNonZeroWithPayload === true && result.payload)) {
        const stderr = result.stderr.trim() || result.stdout.trim() || "command failed";
        throw new Error(`Public CLI command '${label}' failed: ${stderr}`);
      }
      return result;
    };

    if (guidedJourneyEnabled) {
      const guidedDoctor = runCommand("guided-doctor", [
        "doctor",
        "--project-ref",
        ".",
        "--runtime-root",
        ".aor",
        "--json",
      ]);
      artifacts.guided_doctor_transcript_file = guidedDoctor.transcriptFile;

      const guidedOnboard = runCommand("guided-onboard", [
        "onboard",
        ".",
        "--runtime-root",
        ".aor",
        "--asset-mode",
        "bundled",
        "--json",
      ]);
      artifacts.onboarding_report_file = getStringField(guidedOnboard.payload, "onboarding_report_file");
      artifacts.guided_onboard_transcript_file = guidedOnboard.transcriptFile;

      const guidedApp = runCommand("guided-app", [
        "app",
        "--project-ref",
        ".",
        "--runtime-root",
        ".aor",
        "--smoke",
        "true",
        "--open",
        "false",
        "--json",
      ]);
      artifacts.guided_app_transcript_file = guidedApp.transcriptFile;

      const guidedNextBeforeMission = runCommand("guided-next-before-mission", [
        "next",
        "--project-ref",
        ".",
        "--runtime-root",
        ".aor",
        "--json",
      ]);
      artifacts.next_action_report_file = getStringField(guidedNextBeforeMission.payload, "next_action_report_file");
      artifacts.guided_next_before_mission_transcript_file = guidedNextBeforeMission.transcriptFile;
    }

    const hostAssets = materializeHostLiveE2eAssets({
      examplesRoot: options.examplesRoot,
      generatedAssetsRoot: path.join(options.layout.stateRoot, "live-e2e-assets", normalizeId(options.runId)),
    });
    artifacts.host_live_e2e_assets_root = hostAssets.assetsRoot;

    const generatedProfile = materializeGeneratedProjectProfile({
      hostRoot: options.hostRoot,
      profilePath: options.profilePath,
      profile: options.profile,
      catalogEntry: options.catalogEntry,
      runId: options.runId,
      targetCheckout,
      generatedAssetsRoot: hostAssets.assetsRoot,
    });
    artifacts.generated_project_profile_file = generatedProfile.generatedProjectProfileFile;
    artifacts.project_profile_template_file = generatedProfile.templateProjectProfilePath;

    const projectInit = runCommand("project-init", [
      "project",
      "init",
      "--project-ref",
      ".",
      "--project-profile",
      generatedProfile.generatedProjectProfileFile,
      "--runtime-root",
      ".aor",
      ...repoVerificationCommands.flatMap((entry) => ["--repo-build-command", entry]),
      ...repoLintCommands.flatMap((entry) => ["--repo-lint-command", entry]),
      ...repoVerificationCommands.flatMap((entry) => ["--repo-test-command", entry]),
    ]);
    artifacts.bootstrap_artifact_packet_file = getStringField(projectInit.payload, "artifact_packet_file");
    const providerRoutes = materializeProviderPinnedRouteOverrides({
      routesRoot: hostAssets.routesRoot,
      providerVariant: options.providerVariant,
      providerVariantId: asNonEmptyString(options.profile.provider_variant_id),
    });
    artifacts.provider_route_override_files = providerRoutes.routeFiles;
    artifacts.provider_route_overrides = providerRoutes.routeOverrides;
    const routeOverridesFlag = serializeRouteOverrides(providerRoutes.routeOverrides);
    const liveAdapterPreflight = runLiveAdapterPreflight({
      targetCheckoutRoot: targetCheckout.targetCheckoutRoot,
      adapterProfileRoot: path.join(hostAssets.assetsRoot, "adapters"),
      providerVariant: options.providerVariant,
      providerVariantId: asNonEmptyString(options.profile.provider_variant_id),
      coverageTier: options.coverageTier,
      env,
      runnerAuthMode: proofRunnerEnvironment.runnerAuthMode,
      runnerAuthSource: proofRunnerEnvironment.runnerAuthSource,
      runtimeAgentPermissionMode: options.runtimeAgentPermissionMode,
      runtimeAgentInteractionPolicy: options.runtimeAgentInteractionPolicy,
      runtimeAgentAutoApprovalProfile: options.runtimeAgentAutoApprovalProfile,
      authProbeRequired: options.authProbeRequired,
      permissionReadinessRequired: asRecord(options.profile.production_proof).require_permission_readiness === true,
      runId: options.runId,
      reportsRoot: options.layout.reportsRoot,
    });
    artifacts.live_adapter_preflight_file = liveAdapterPreflight.reportFile;
    artifacts.live_adapter_preflight = liveAdapterPreflight.report;
    if (liveAdapterPreflight.status !== "pass") {
      markStage(
        stageMap,
        "bootstrap",
        liveAdapterPreflight.status === "interaction_required" ? "interaction_required" : "fail",
        uniqueStrings([projectInit.transcriptFile, liveAdapterPreflight.reportFile, ...collectStringRefs(projectInit.payload)]),
        liveAdapterPreflight.summary,
      );
      throw new Error(liveAdapterPreflight.summary);
    }
    markStage(
      stageMap,
      "bootstrap",
      "pass",
      uniqueStrings([
        projectInit.transcriptFile,
        liveAdapterPreflight.reportFile,
        browserCachePreflight.reportFile,
        ...collectStringRefs(projectInit.payload),
        ...providerRoutes.routeFiles,
      ]),
      "Public bootstrap initialized target .aor while live E2E assets and provider-pinned routes stayed in host runtime state.",
    );

    const featureRequest = materializeFeatureRequestFile({
      targetCheckoutRoot: targetCheckout.targetCheckoutRoot,
      mission: options.mission,
      runId: options.runId,
      scenarioFamily: asNonEmptyString(options.profile.scenario_family),
      providerVariantId: asNonEmptyString(options.profile.provider_variant_id),
      providerVariant: options.providerVariant,
      scenarioPolicy: options.scenarioPolicy,
      featureSize: options.featureSize,
      matrixCell: options.matrixCell,
      coverageFollowUp: options.coverageFollowUp,
    });
    artifacts.feature_request_file = featureRequest.requestFile;

    const intakeCreate = guidedJourneyEnabled
      ? runCommand("mission-create", buildGuidedMissionCreateArgs({
          mission: options.mission,
          featureRequest,
          profile: options.profile,
          projectProfileFile: generatedProfile.generatedProjectProfileFile,
        }))
      : runCommand("intake-create", buildIntakeCreateArgs({
          mission: options.mission,
          featureRequest,
          profile: options.profile,
          projectProfileFile: generatedProfile.generatedProjectProfileFile,
        }));
    artifacts.intake_artifact_packet_file = getStringField(intakeCreate.payload, "artifact_packet_file");
    artifacts.intake_artifact_packet_body_file = getStringField(intakeCreate.payload, "artifact_packet_body_file");
    artifacts.intake_quality_gate = evaluateMissionIntakeQuality({
      mission: options.mission,
      featureSize: options.featureSize,
      scenarioFamily: asNonEmptyString(options.profile.scenario_family),
      postRunQualityPolicy,
    });
    if (guidedJourneyEnabled) {
      artifacts.guided_mission_create_transcript_file = intakeCreate.transcriptFile;
      const guidedNextAfterMission = runCommand("guided-next-after-mission", [
        "next",
        "--project-ref",
        ".",
        "--runtime-root",
        ".aor",
        "--json",
      ]);
      artifacts.next_action_report_file = getStringField(guidedNextAfterMission.payload, "next_action_report_file");
      artifacts.guided_next_after_mission_transcript_file = guidedNextAfterMission.transcriptFile;
    }

    const analyze = runCommand("project-analyze", [
      "project",
      "analyze",
      "--project-ref",
      ".",
      "--project-profile",
      generatedProfile.generatedProjectProfileFile,
      "--runtime-root",
      ".aor",
      ...(routeOverridesFlag ? ["--route-overrides", routeOverridesFlag] : []),
    ]);
    artifacts.analysis_report_file = getStringField(analyze.payload, "analysis_report_file");

    const validate = runCommand("project-validate", [
      "project",
      "validate",
      "--project-ref",
      ".",
      "--project-profile",
      generatedProfile.generatedProjectProfileFile,
      "--runtime-root",
      ".aor",
    ]);
    artifacts.validation_report_file = getStringField(validate.payload, "validation_report_file");

    const executionAlreadyObserved = controllerObservedStep(options.stepController, "execution");
    const cachedBaselineVerifySummaryPath = asNonEmptyString(artifacts.baseline_verify_summary_file);
    const cachedTargetCleanlinessFile = asNonEmptyString(artifacts.target_cleanliness_before_execution_file);
    const cachedExecutionReadinessFile = asNonEmptyString(artifacts.execution_readiness_file);
    let baselineVerifySummaryPath = /** @type {string | null} */ (cachedBaselineVerifySummaryPath || null);
    let baselineGateDecision = asRecord(artifacts.baseline_verify_gate_decision);
    /** @type {string[]} */
    let baselineEvidenceRefs = uniqueStrings([
      baselineVerifySummaryPath,
      ...asStringArray(artifacts.baseline_verify_preserved_files),
      ...asStringArray(artifacts.baseline_verify_step_result_files),
      cachedTargetCleanlinessFile,
      cachedExecutionReadinessFile,
    ]);
    const canReusePreExecutionReadiness =
      executionAlreadyObserved &&
      baselineVerifySummaryPath &&
      fileExists(baselineVerifySummaryPath) &&
      Object.keys(baselineGateDecision).length > 0 &&
      cachedTargetCleanlinessFile &&
      fileExists(cachedTargetCleanlinessFile) &&
      cachedExecutionReadinessFile &&
      fileExists(cachedExecutionReadinessFile);
    if (executionAlreadyObserved && !canReusePreExecutionReadiness) {
      const summary = "Observed execution cannot resume without preserved pre-execution readiness evidence.";
      markStageRaw(stageMap, "execution", "fail", [], summary);
      throw new Error(summary);
    }
    if (!executionAlreadyObserved) {
      const verifyPreflight = runCommand("project-verify-preflight", [
        "project",
        "verify",
        "--project-ref",
        ".",
        "--project-profile",
        generatedProfile.generatedProjectProfileFile,
        "--runtime-root",
        ".aor",
        "--require-validation-pass",
        "true",
        "--verification-label",
        "baseline-diagnostic",
        "--routed-dry-run-step",
        "implement",
        ...(routeOverridesFlag ? ["--route-overrides", routeOverridesFlag] : []),
      ]);
      baselineVerifySummaryPath = getStringField(verifyPreflight.payload, "verify_summary_file");
      artifacts.baseline_verify_summary_file = baselineVerifySummaryPath;
      artifacts.verify_summary_file = baselineVerifySummaryPath;
      artifacts.baseline_verify_step_result_files = getStringArrayField(verifyPreflight.payload, "step_result_files");
      artifacts.preflight_step_result_files = artifacts.baseline_verify_step_result_files;
      artifacts.baseline_routed_dry_run_step_result_file = getStringField(
        verifyPreflight.payload,
        "routed_step_result_file",
      );
      if (
        internalTestHooks.drop_baseline_routed_dry_run_after_preflight === true &&
        typeof artifacts.baseline_routed_dry_run_step_result_file === "string"
      ) {
        fs.rmSync(artifacts.baseline_routed_dry_run_step_result_file, { force: true });
      }
      if (!baselineVerifySummaryPath || !fileExists(baselineVerifySummaryPath)) {
        markStage(
          stageMap,
          "execution",
          "fail",
          uniqueStrings([verifyPreflight.transcriptFile, ...collectStringRefs(verifyPreflight.payload)]),
          "Dry-run verify summary was not materialized.",
        );
        throw new Error("Dry-run verify summary was not materialized.");
      }
      const baselineVerifySummary = readJson(baselineVerifySummaryPath);
      const preservedBaseline = preserveVerifyArtifacts({
        verifyPayload: asRecord(verifyPreflight.payload),
        summaryFile: baselineVerifySummaryPath,
        reportsRoot: options.layout.reportsRoot,
        runId: options.runId,
        phase: "baseline-verify",
      });
      artifacts.baseline_verify_preserved_files = preservedBaseline.preserved_files;
      if (preservedBaseline.preserved_summary_file) {
        artifacts.baseline_verify_summary_file = preservedBaseline.preserved_summary_file;
      }
      if (preservedBaseline.preserved_step_result_files.length > 0) {
        artifacts.baseline_verify_step_result_files = preservedBaseline.preserved_step_result_files;
        artifacts.preflight_step_result_files = preservedBaseline.preserved_step_result_files;
      }
      const baselineGateMode = resolveBaselineGateMode(options.profile);
      baselineGateDecision = evaluateBaselineVerifyGate({
        verifySummary: asRecord(baselineVerifySummary),
        verifyPayload: asRecord(verifyPreflight.payload),
        stepResultFiles: getStringArrayField(verifyPreflight.payload, "step_result_files"),
        setupCommands: repoLintCommands,
        verificationCommands: repoVerificationCommands,
        mode: baselineGateMode,
      });
      artifacts.baseline_verify_status = baselineGateDecision.status;
      artifacts.baseline_verify_gate_decision = baselineGateDecision;
      if (baselineGateDecision.decision === "block") {
        markStage(
          stageMap,
          "execution",
          "fail",
          uniqueStrings([
            verifyPreflight.transcriptFile,
            baselineVerifySummaryPath,
            ...asStringArray(artifacts.baseline_verify_preserved_files),
            ...collectStringRefs(verifyPreflight.payload),
          ]),
          asNonEmptyString(baselineGateDecision.summary) || "Baseline readiness failed before provider execution.",
        );
        throw new Error(asNonEmptyString(baselineGateDecision.summary) || "Baseline readiness failed before provider execution.");
      }
      const targetCleanliness = writeTargetCleanlinessReport({
        targetCheckoutRoot: targetCheckout.targetCheckoutRoot,
        reportsRoot: options.layout.reportsRoot,
        runId: options.runId,
        phase: "before-execution",
      });
      artifacts.target_cleanliness_before_execution_file = targetCleanliness.reportFile;
      artifacts.target_cleanliness_before_execution = targetCleanliness.report;
      if (targetCleanliness.report.status !== "pass") {
        markStage(
          stageMap,
          "execution",
          "fail",
          [targetCleanliness.reportFile],
          asNonEmptyString(targetCleanliness.report.summary) || "Target setup changed tracked files before execution.",
        );
        throw new Error(asNonEmptyString(targetCleanliness.report.summary) || "Target setup changed tracked files before execution.");
      }
      const executionReadiness = writeExecutionReadinessDecision({
        runId: options.runId,
        reportsRoot: options.layout.reportsRoot,
        liveAdapterPreflightFile: asNonEmptyString(artifacts.live_adapter_preflight_file),
        validationReportFile: asNonEmptyString(artifacts.validation_report_file),
        baselineGateDecision,
        baselineRoutedStepResultFile: asNonEmptyString(artifacts.baseline_routed_dry_run_step_result_file),
      });
      artifacts.execution_readiness_file = executionReadiness.decisionFile;
      artifacts.execution_readiness = executionReadiness.decision;
      baselineEvidenceRefs = uniqueStrings([
        verifyPreflight.transcriptFile,
        baselineVerifySummaryPath,
        ...asStringArray(artifacts.baseline_verify_preserved_files),
        ...collectStringRefs(verifyPreflight.payload),
        targetCleanliness.reportFile,
        executionReadiness.decisionFile,
      ]);
    } else {
      artifacts.pre_execution_readiness_reused_after_resume = true;
    }

    const discovery = runCommand("discovery-run", [
      "discovery",
      "run",
      "--project-ref",
      ".",
      "--project-profile",
      generatedProfile.generatedProjectProfileFile,
      "--runtime-root",
      ".aor",
      "--input-packet",
      /** @type {string} */ (artifacts.intake_artifact_packet_file),
      ...(routeOverridesFlag ? ["--route-overrides", routeOverridesFlag] : []),
    ]);
    artifacts.discovery_analysis_report_file = getStringField(discovery.payload, "analysis_report_file");
    markStage(
      stageMap,
      "discovery",
      "pass",
      uniqueStrings([
        analyze.transcriptFile,
        validate.transcriptFile,
        discovery.transcriptFile,
        ...collectStringRefs(discovery.payload),
      ]),
      "Feature-driven discovery completed from catalog-backed intake request.",
    );

    const specBuild = runCommand("spec-build", [
      "spec",
      "build",
      "--project-ref",
      ".",
      "--project-profile",
      generatedProfile.generatedProjectProfileFile,
      "--runtime-root",
      ".aor",
      ...(routeOverridesFlag ? ["--route-overrides", routeOverridesFlag] : []),
    ]);
    artifacts.spec_step_result_file = getStringField(specBuild.payload, "routed_step_result_file");
    if (internalTestHooks.drop_spec_step_result_after_spec_build === true && artifacts.spec_step_result_file) {
      try {
        fs.rmSync(artifacts.spec_step_result_file, { force: true });
      } catch {
        // ignore test-only cleanup failure and let the artifact check below fail deterministically
      }
    }
    if (!artifacts.spec_step_result_file || !fileExists(artifacts.spec_step_result_file)) {
      markStage(
        stageMap,
        "spec",
        "fail",
        uniqueStrings([specBuild.transcriptFile, ...collectStringRefs(specBuild.payload)]),
        "Spec build did not materialize a routed step-result artifact.",
      );
      throw new Error("Spec build did not materialize a routed step-result artifact.");
    }
    markStage(
      stageMap,
      "spec",
      "pass",
      uniqueStrings([specBuild.transcriptFile, ...collectStringRefs(specBuild.payload)]),
      "Spec build produced feature-traceable dry-run evidence.",
    );

    const waveCreate = runCommand("wave-create", [
      "wave",
      "create",
      "--project-ref",
      ".",
      "--project-profile",
      generatedProfile.generatedProjectProfileFile,
      "--runtime-root",
      ".aor",
    ]);
    artifacts.wave_ticket_file = getStringField(waveCreate.payload, "wave_ticket_file");
    artifacts.handoff_packet_file = getStringField(waveCreate.payload, "handoff_packet_file");
    markStage(
      stageMap,
      "planning",
      "pass",
      uniqueStrings([waveCreate.transcriptFile, ...collectStringRefs(waveCreate.payload)]),
      "Wave and handoff packets were materialized from the public planning flow.",
    );

    const handoffApprove = runCommand("handoff-approve", [
      "handoff",
      "approve",
      "--project-ref",
      ".",
      "--runtime-root",
      ".aor",
      "--handoff-packet",
      /** @type {string} */ (artifacts.handoff_packet_file),
      "--approval-ref",
      `approval://live-e2e/full-journey/${normalizeId(options.runId)}`,
    ]);
    artifacts.approved_handoff_packet_file = getStringField(handoffApprove.payload, "handoff_packet_file");
    if (internalTestHooks.block_approved_handoff_validation === true) {
      markStage(
        stageMap,
        "handoff",
        "fail",
        uniqueStrings([handoffApprove.transcriptFile, ...collectStringRefs(handoffApprove.payload)]),
        "Approved handoff validation was blocked by internal test hook.",
      );
      throw new Error("Approved handoff validation was blocked by internal test hook.");
    }
    let validateApproved;
    try {
      validateApproved = runCommand("project-validate-approved-handoff", [
        "project",
        "validate",
        "--project-ref",
        ".",
        "--project-profile",
        generatedProfile.generatedProjectProfileFile,
        "--runtime-root",
        ".aor",
        "--require-approved-handoff",
        "--handoff-packet",
        /** @type {string} */ (artifacts.approved_handoff_packet_file),
      ]);
    } catch (error) {
      const summary = error instanceof Error ? error.message : String(error);
      markStage(
        stageMap,
        "handoff",
        "fail",
        uniqueStrings([handoffApprove.transcriptFile]),
        summary,
      );
      throw error;
    }
    artifacts.approved_validation_report_file = getStringField(validateApproved.payload, "validation_report_file");
    markStage(
      stageMap,
      "handoff",
      "pass",
      uniqueStrings([handoffApprove.transcriptFile, validateApproved.transcriptFile, ...collectStringRefs(handoffApprove.payload)]),
      "Approved handoff validated for execution start.",
    );

    const specPacketEvidenceRef = toPacketEvidenceRef(
      targetCheckout.targetCheckoutRoot,
      "spec",
      asNonEmptyString(artifacts.spec_step_result_file),
    );
    const promotionEvidenceRefs = uniqueStrings([
      ...(artifacts.execution_readiness_file ? [/** @type {string} */ (artifacts.execution_readiness_file)] : []),
      ...(artifacts.baseline_routed_dry_run_step_result_file
        ? [/** @type {string} */ (artifacts.baseline_routed_dry_run_step_result_file)]
        : []),
      ...(specPacketEvidenceRef ? [specPacketEvidenceRef] : []),
    ]);

    const implementationLoopPolicy = resolveImplementationLoopPolicy(options.profile);
    artifacts.implementation_loop = {
      enabled: implementationLoopPolicy.enabled,
      max_iterations: implementationLoopPolicy.maxIterations,
      review_repair_actions: implementationLoopPolicy.reviewRepairActions,
      iterations: [],
    };
    let reviewReport = {};
    let reviewOverallStatus = "fail";
    let featureSizeFitStatus = "fail";
    let latestPromotionEvidenceRefs = [...promotionEvidenceRefs];
    let latestImplementationRunId = options.runId;
    for (let iteration = 1; iteration <= implementationLoopPolicy.maxIterations; iteration += 1) {
      const iterationRunId = iteration === 1 ? options.runId : `${options.runId}.repair-${iteration}`;
      latestImplementationRunId = iterationRunId;
      artifacts.latest_implementation_run_id = iterationRunId;
      const runStart = runCommand("run-start", [
        "run",
        "start",
        "--project-ref",
        ".",
        "--project-profile",
        generatedProfile.generatedProjectProfileFile,
        "--runtime-root",
        ".aor",
        "--run-id",
        iterationRunId,
        "--target-step",
        "implement",
        "--require-validation-pass",
        "true",
        ...(artifacts.approved_handoff_packet_file
          ? ["--approved-handoff-ref", /** @type {string} */ (artifacts.approved_handoff_packet_file)]
          : []),
        ...(latestPromotionEvidenceRefs.length > 0
          ? ["--promotion-evidence-refs", latestPromotionEvidenceRefs.join(",")]
          : []),
        ...(routeOverridesFlag ? ["--route-overrides", routeOverridesFlag] : []),
      ], { iteration });
      artifacts.routed_step_result_file = getStringField(runStart.payload, "routed_step_result_file");
      artifacts.routed_step_result_id = getStringField(runStart.payload, "routed_step_result_id");
      artifacts.runtime_harness_report_file = getStringField(runStart.payload, "runtime_harness_report_file");
      artifacts.runtime_harness_overall_decision = getStringField(runStart.payload, "runtime_harness_overall_decision");
      if (artifacts.runtime_harness_report_file && fileExists(artifacts.runtime_harness_report_file)) {
        artifacts.runtime_harness_overall_decision =
          asNonEmptyString(asRecord(readJson(artifacts.runtime_harness_report_file)).overall_decision) ||
          artifacts.runtime_harness_overall_decision;
      }
      artifacts.run_start_runtime_harness_report_file = artifacts.runtime_harness_report_file;
      artifacts.run_start_runtime_harness_decision = artifacts.runtime_harness_overall_decision;
      artifacts.execution_degraded = asNonEmptyString(artifacts.run_start_runtime_harness_decision) !== "pass";
      artifacts.execution_degraded_reason =
        artifacts.execution_degraded === true
          ? `Runtime Harness decision '${asNonEmptyString(artifacts.run_start_runtime_harness_decision) || "unknown"}'.`
          : null;
      if (artifacts.routed_step_result_file && fileExists(artifacts.routed_step_result_file)) {
        const stepResult = readJson(artifacts.routed_step_result_file);
        const routedExecution = asRecord(stepResult.routed_execution);
        artifacts.compiled_context_ref = asNonEmptyString(asRecord(routedExecution.context_compilation).compiled_context_ref) || null;
        artifacts.compiled_context_file = asNonEmptyString(asRecord(routedExecution.context_compilation).compiled_context_file) || null;
        artifacts.adapter_raw_evidence_ref =
          asNonEmptyString(asRecord(asRecord(asRecord(routedExecution.adapter_response).output).external_runner).raw_evidence_ref) ||
          null;
        if (internalTestHooks.drop_adapter_raw_evidence_after_run_start === true) {
          const adapterResponse = asRecord(routedExecution.adapter_response);
          const adapterOutput = asRecord(adapterResponse.output);
          const externalRunner = asRecord(adapterOutput.external_runner);
          if (Object.prototype.hasOwnProperty.call(externalRunner, "raw_evidence_ref")) {
            delete externalRunner.raw_evidence_ref;
            adapterOutput.external_runner = externalRunner;
            adapterResponse.output = adapterOutput;
            routedExecution.adapter_response = adapterResponse;
            stepResult.routed_execution = routedExecution;
          }
          const topLevelExternalRunner = asRecord(stepResult.external_runner);
          if (Object.prototype.hasOwnProperty.call(topLevelExternalRunner, "raw_evidence_ref")) {
            delete topLevelExternalRunner.raw_evidence_ref;
            stepResult.external_runner = topLevelExternalRunner;
          }
          writeJson(artifacts.routed_step_result_file, stepResult);
          artifacts.adapter_raw_evidence_ref = null;
        }
        if (asNonEmptyString(stepResult.status) !== "passed") {
          artifacts.execution_degraded = true;
          artifacts.execution_degraded_reason = asNonEmptyString(stepResult.summary) || "Run start routed execution failed.";
        }
      } else {
        markStage(
          stageMap,
          "execution",
          "fail",
          uniqueStrings([runStart.transcriptFile, ...collectStringRefs(runStart.payload)]),
          "Run start did not materialize routed execution evidence.",
          { iteration },
        );
        throw new Error("Run start did not materialize routed execution evidence.");
      }
      const runStatus = runCommand("run-status", [
        "run",
        "status",
        "--project-ref",
        ".",
        "--runtime-root",
        ".aor",
        "--run-id",
        latestImplementationRunId,
      ], { iteration, suppressControllerPlan: true });
      artifacts.run_status_snapshot_file = runStatus.transcriptFile;

      const postRunVerify = runCommand("project-verify-post-run-primary", [
        "project",
        "verify",
        "--project-ref",
        ".",
        "--project-profile",
        generatedProfile.generatedProjectProfileFile,
        "--runtime-root",
        ".aor",
        "--require-validation-pass",
        "true",
        ...buildVerifyOverrideArgs({
          label: "post-run-primary",
          commands: postRunQualityPolicy.primaryCommands,
        }),
      ], { iteration, suppressControllerPlan: true });
      artifacts.post_run_verify_summary_file = getStringField(postRunVerify.payload, "verify_summary_file");
      artifacts.post_run_verify_step_result_files = getStringArrayField(postRunVerify.payload, "step_result_files");
      artifacts.post_run_primary_verify_summary_file = artifacts.post_run_verify_summary_file;
      artifacts.post_run_primary_verify_step_result_files = artifacts.post_run_verify_step_result_files;
      artifacts.verify_summary_file = artifacts.post_run_verify_summary_file;
      const postRunVerifySummaryPath = /** @type {string | null} */ (artifacts.post_run_verify_summary_file);
      if (!postRunVerifySummaryPath || !fileExists(postRunVerifySummaryPath)) {
        markStage(
          stageMap,
          "execution",
          "fail",
          uniqueStrings([postRunVerify.transcriptFile, ...collectStringRefs(postRunVerify.payload)]),
          "Post-run verify summary was not materialized.",
          { iteration },
        );
        throw new Error("Post-run verify summary was not materialized.");
      }
      const postRunVerifySummary = readJson(postRunVerifySummaryPath);
      artifacts.post_run_verify_status = asNonEmptyString(postRunVerifySummary.status) === "passed" ? "pass" : "fail";
      const runtimeHarnessStageStatus = normalizeRuntimeHarnessDecisionStatus(artifacts.run_start_runtime_harness_decision);
      const executionStageStatus =
        stageMap.execution?.status === "fail"
          ? "fail"
          : runtimeHarnessStageStatus === "pass"
            ? "pass"
            : "warn";
      const executionStageSummary =
        executionStageStatus === "fail"
          ? "Execution health evidence failed before post-run quality could be judged."
          : executionStageStatus === "warn"
            ? "Runtime Harness recorded execution findings; final quality is judged from agent assessment, review, and post-run verification."
            : "Baseline diagnostics, run start, run status, and post-run verification completed through public execution lifecycle.";
      markStage(
        stageMap,
        "execution",
        executionStageStatus,
        uniqueStrings([
          ...baselineEvidenceRefs,
          asNonEmptyString(artifacts.baseline_verify_summary_file),
          runStart.transcriptFile,
          runStatus.transcriptFile,
          postRunVerify.transcriptFile,
          postRunVerifySummaryPath,
          ...collectStringRefs(runStart.payload),
        ]),
        executionStageSummary,
        { iteration },
      );

      const reviewRun = runCommand("review-run", [
        "review",
        "run",
        "--project-ref",
        ".",
        "--project-profile",
        generatedProfile.generatedProjectProfileFile,
        "--runtime-root",
        ".aor",
        "--run-id",
        latestImplementationRunId,
      ], { allowNonZeroWithPayload: true, iteration });
      artifacts.review_report_file = getStringField(reviewRun.payload, "review_report_file");
      artifacts.latest_runtime_harness_report_file =
        getStringField(reviewRun.payload, "runtime_harness_report_file") || artifacts.runtime_harness_report_file;
      artifacts.latest_runtime_harness_decision =
        getStringField(reviewRun.payload, "runtime_harness_overall_decision") ||
        artifacts.run_start_runtime_harness_decision ||
        artifacts.runtime_harness_overall_decision;
      reviewReport = artifacts.review_report_file && fileExists(artifacts.review_report_file)
        ? readJson(artifacts.review_report_file)
        : {};
      reviewOverallStatus = normalizeVerdictStatus(reviewReport.overall_status);
      featureSizeFitStatus = normalizeVerdictStatus(asRecord(reviewReport.feature_size_fit).status);
      const reviewRepairActions = new Set(implementationLoopPolicy.reviewRepairActions);
      const repairNeeded =
        (reviewOverallStatus === "fail" &&
          (reviewRepairActions.has("request-repair") || reviewRepairActions.has("repair"))) ||
        (artifacts.post_run_verify_status === "fail" && reviewRepairActions.has("failed-quality-findings"));
      const canRepair =
        implementationLoopPolicy.enabled &&
        repairNeeded &&
        iteration < implementationLoopPolicy.maxIterations &&
        !(implementationLoopPolicy.stopOnBlockingReview && runtimeHarnessStageStatus === "fail");
      if (
        repairNeeded &&
        implementationLoopPolicy.enabled &&
        implementationLoopPolicy.stopOnBlockingReview &&
        runtimeHarnessStageStatus === "fail"
      ) {
        artifacts.implementation_loop_blocked = true;
        artifacts.implementation_loop_blocked_reason =
          "Runtime Harness produced a blocking execution-health finding before public repair could continue.";
      }
      markStage(
        stageMap,
        "review",
        canRepair ? "warn" : reviewOverallStatus === "fail" ? "fail" : "pass",
        uniqueStrings([reviewRun.transcriptFile, ...collectStringRefs(reviewRun.payload)]),
        canRepair
          ? `Review requested public repair iteration ${iteration + 1}.`
          : reviewOverallStatus === "fail"
            ? "Review report failed."
            : "Review report materialized.",
        canRepair
          ? {
              iteration,
              decisionOverride: {
                action: "retry_public_step",
                reason: `Review or verification findings require public implementation iteration ${iteration + 1}.`,
                next_step: "execution",
              },
            }
          : { iteration },
      );
      const iterationRecord = {
        iteration,
        run_id: iterationRunId,
        routed_step_result_file: asNonEmptyString(artifacts.routed_step_result_file) || null,
        post_run_verify_summary_file: postRunVerifySummaryPath,
        review_report_file: asNonEmptyString(artifacts.review_report_file) || null,
        runtime_harness_report_file: asNonEmptyString(artifacts.runtime_harness_report_file) || null,
        review_status: reviewOverallStatus,
        post_run_verify_status: asNonEmptyString(artifacts.post_run_verify_status),
        repair_requested: canRepair,
      };
      {
        const currentIterations = Array.isArray(asRecord(artifacts.implementation_loop).iterations)
          ? asRecord(artifacts.implementation_loop).iterations
          : [];
        asRecord(artifacts.implementation_loop).iterations = [...currentIterations, iterationRecord];
      }
      if (!canRepair) {
        if (
          (repairNeeded || reviewOverallStatus === "fail" || artifacts.post_run_verify_status === "fail") &&
          implementationLoopPolicy.enabled &&
          iteration >= implementationLoopPolicy.maxIterations
        ) {
          artifacts.implementation_loop_exhausted = true;
        }
        break;
      }
      const reviewRepairDecision = runCommand("review-decide-request-repair", [
        "review",
        "decide",
        "--project-ref",
        ".",
        "--project-profile",
        generatedProfile.generatedProjectProfileFile,
        "--runtime-root",
        ".aor",
        "--run-id",
        latestImplementationRunId,
        "--decision",
        "request-repair",
        "--decider-ref",
        "operator://live-e2e-step-controller",
        "--reason",
        `Live E2E review iteration ${iteration} requested public repair before delivery.`,
      ], { allowNonZeroWithPayload: true, iteration });
      artifacts.review_repair_decision_files = uniqueStrings([
        ...asStringArray(artifacts.review_repair_decision_files),
        getStringField(reviewRepairDecision.payload, "review_decision_file"),
      ]);
      latestPromotionEvidenceRefs = uniqueStrings([
        ...promotionEvidenceRefs,
        asNonEmptyString(artifacts.routed_step_result_file),
        postRunVerifySummaryPath,
        asNonEmptyString(artifacts.review_report_file),
        getStringField(reviewRepairDecision.payload, "review_decision_file"),
      ]);
    }
    {
      const loopIterations = Array.isArray(asRecord(artifacts.implementation_loop).iterations)
        ? asRecord(artifacts.implementation_loop).iterations
        : [];
      if (loopIterations.length >= implementationLoopPolicy.maxIterations) {
        const lastIteration = asRecord(loopIterations.at(-1));
        if (
          artifacts.implementation_loop_blocked === true ||
          lastIteration.repair_requested === true ||
          reviewOverallStatus === "fail" ||
          artifacts.post_run_verify_status === "fail"
        ) {
          artifacts.implementation_loop_exhausted = true;
        }
      }
    }
    if (artifacts.implementation_loop_blocked === true) {
      throw new Error("Implementation repair loop blocked by runtime health evidence before review and verification passed.");
    }
    if (artifacts.implementation_loop_exhausted === true) {
      throw new Error("Implementation repair loop exhausted before review and verification passed.");
    }
    if (reviewOverallStatus === "fail" || artifacts.post_run_verify_status === "fail") {
      throw new Error("Implementation review or post-run verification failed before delivery.");
    }
    if (guidedJourneyEnabled) {
      const guidedNextAfterReview = runCommand("guided-next-after-review", [
        "next",
        "--project-ref",
        ".",
        "--runtime-root",
        ".aor",
        "--json",
      ]);
      artifacts.next_action_report_file = getStringField(guidedNextAfterReview.payload, "next_action_report_file");
      artifacts.guided_next_after_review_transcript_file = guidedNextAfterReview.transcriptFile;

      const reviewDecision = runCommand("review-decide-approve", [
        "review",
        "decide",
        "--project-ref",
        ".",
        "--project-profile",
        generatedProfile.generatedProjectProfileFile,
        "--runtime-root",
        ".aor",
        "--run-id",
        latestImplementationRunId,
        "--decision",
        "approve",
        "--decider-ref",
        "operator://installed-user-guided-proof",
        "--reason",
        "Approved by installed-user guided proof after review evidence materialized.",
      ]);
      artifacts.review_decision_file = getStringField(reviewDecision.payload, "review_decision_file");
      artifacts.guided_review_decision_transcript_file = reviewDecision.transcriptFile;
    }

    const evalSuites = getEvalSuites(options.profile);
    if (evalSuites.length > 0) {
      const evalRun = runCommand("eval-run", [
        "eval",
        "run",
        "--project-ref",
        ".",
        "--project-profile",
        generatedProfile.generatedProjectProfileFile,
        "--runtime-root",
        ".aor",
        "--suite-ref",
        evalSuites[0],
        "--subject-ref",
        `run://${latestImplementationRunId}`,
      ], { allowNonZeroWithPayload: true });
      artifacts.evaluation_report_file = getStringField(evalRun.payload, "evaluation_report_file");
      markStage(
        stageMap,
        "qa",
        getStringField(evalRun.payload, "evaluation_status") === "pass" ? "pass" : "fail",
        uniqueStrings([evalRun.transcriptFile, ...collectStringRefs(evalRun.payload)]),
        "Evaluation report materialized.",
      );
    } else {
      markStage(stageMap, "qa", "skipped", [], "Profile has no eval suites.");
    }

    if (postRunQualityPolicy.diagnosticCommands.length > 0) {
      const postRunDiagnosticVerify = runCommand("project-verify-post-run-diagnostic", [
        "project",
        "verify",
        "--project-ref",
        ".",
        "--project-profile",
        generatedProfile.generatedProjectProfileFile,
        "--runtime-root",
        ".aor",
        "--require-validation-pass",
        "true",
        ...buildVerifyOverrideArgs({
          label: "post-run-diagnostic",
          commands: postRunQualityPolicy.diagnosticCommands,
        }),
      ]);
      artifacts.post_run_diagnostic_verify_summary_file = getStringField(
        postRunDiagnosticVerify.payload,
        "verify_summary_file",
      );
      artifacts.post_run_diagnostic_verify_step_result_files = getStringArrayField(
        postRunDiagnosticVerify.payload,
        "step_result_files",
      );
      const diagnosticSummaryFile = asNonEmptyString(artifacts.post_run_diagnostic_verify_summary_file);
      const diagnosticSummary =
        diagnosticSummaryFile && fileExists(diagnosticSummaryFile) ? readJson(diagnosticSummaryFile) : {};
      const diagnosticPassed = asNonEmptyString(diagnosticSummary.status) === "passed";
      artifacts.post_run_diagnostic_status = diagnosticPassed ? "pass" : postRunQualityPolicy.diagnosticFailureMode;
      const preservedDiagnostic = diagnosticSummaryFile
        ? preserveVerifyArtifacts({
            verifyPayload: asRecord(postRunDiagnosticVerify.payload),
            summaryFile: diagnosticSummaryFile,
            reportsRoot: options.layout.reportsRoot,
            runId: options.runId,
            phase: "post-run-diagnostic-verify",
          })
        : { preserved_summary_file: null, preserved_step_result_files: [], preserved_files: [] };
      artifacts.post_run_diagnostic_verify_preserved_files = preservedDiagnostic.preserved_files;
      if (preservedDiagnostic.preserved_summary_file) {
        artifacts.post_run_diagnostic_verify_summary_file = preservedDiagnostic.preserved_summary_file;
      }
      if (preservedDiagnostic.preserved_step_result_files.length > 0) {
        artifacts.post_run_diagnostic_verify_step_result_files = preservedDiagnostic.preserved_step_result_files;
      }
    } else {
      artifacts.post_run_diagnostic_status = "pass";
    }

    const harnessCertification = getHarnessCertification(options.profile);
    /** @type {string[]} */
    const deliveryEvidenceRefs = uniqueStrings([
      ...(artifacts.routed_step_result_file ? [artifacts.routed_step_result_file] : []),
      ...(artifacts.evaluation_report_file ? [artifacts.evaluation_report_file] : []),
    ]);
    if (harnessCertification) {
      const certify = runCommand("delivery-harness-certify", [
        "harness",
        "certify",
        "--project-ref",
        ".",
        "--project-profile",
        generatedProfile.generatedProjectProfileFile,
        "--runtime-root",
        ".aor",
        "--asset-ref",
        harnessCertification.assetRef,
        "--subject-ref",
        harnessCertification.subjectRef,
        "--suite-ref",
        harnessCertification.suiteRef,
        "--step-class",
        harnessCertification.stepClass,
      ]);
      artifacts.promotion_decision_file = getStringField(certify.payload, "promotion_decision_file");
      if (artifacts.promotion_decision_file) {
        deliveryEvidenceRefs.push(artifacts.promotion_decision_file);
      }
      if (getStringField(certify.payload, "promotion_decision_status") !== "pass") {
        throw new Error("Harness certification did not pass.");
      }
    }

    let deliverPrepare;
    try {
      deliverPrepare = runCommand("deliver-prepare", [
        "deliver",
        "prepare",
        "--project-ref",
        ".",
        "--project-profile",
        generatedProfile.generatedProjectProfileFile,
        "--runtime-root",
        ".aor",
        "--run-id",
        latestImplementationRunId,
        "--step-class",
        "implement",
        "--mode",
        getPreferredDeliveryMode(options.profile),
        "--quality-gate-mode",
        "observe",
        ...(artifacts.approved_handoff_packet_file
          ? ["--approved-handoff-ref", /** @type {string} */ (artifacts.approved_handoff_packet_file)]
          : []),
        ...(deliveryEvidenceRefs.length > 0 ? ["--promotion-evidence-refs", deliveryEvidenceRefs.join(",")] : []),
        ...(guidedJourneyEnabled ? ["--require-review-decision"] : []),
      ], { allowNonZeroWithPayload: true });
    } catch (error) {
      const summary = error instanceof Error ? error.message : String(error);
      const lowerSummary = summary.toLowerCase();
      artifacts.delivery_blocking = true;
      artifacts.delivery_blocked_by_quality_gate =
        lowerSummary.includes("runtime harness") || lowerSummary.includes("quality gate");
      artifacts.delivery_blocking_reasons = [summary];
      markStage(
        stageMap,
        "delivery",
        "fail",
        [],
        artifacts.delivery_blocked_by_quality_gate === true
          ? "Delivery prepare was blocked by quality/runtime harness gate."
          : summary,
      );
    }
    if (!deliverPrepare) {
      throw new Error("Delivery prepare did not materialize delivery evidence.");
    }
    if (deliverPrepare) {
      const deliveryRuntimeHarnessReportFile = getStringField(deliverPrepare.payload, "runtime_harness_report_file");
      artifacts.delivery_manifest_file = getStringField(deliverPrepare.payload, "delivery_manifest_file");
      artifacts.delivery_plan_file = getStringField(deliverPrepare.payload, "delivery_plan_file");
      artifacts.delivery_transcript_file = getStringField(deliverPrepare.payload, "delivery_transcript_file");
      artifacts.delivery_runtime_harness_report_file = deliveryRuntimeHarnessReportFile;
      artifacts.runtime_harness_report_file =
        asNonEmptyString(artifacts.runtime_harness_report_file) || deliveryRuntimeHarnessReportFile;
      artifacts.delivery_quality_gate_mode = getStringField(deliverPrepare.payload, "delivery_quality_gate_mode");
      artifacts.delivery_quality_gate_status = getStringField(deliverPrepare.payload, "delivery_quality_gate_status");
      artifacts.delivery_quality_gate_findings = asStringArray(deliverPrepare.payload?.delivery_quality_gate_findings);
      if (internalTestHooks.block_delivery_prepare === true) {
        deliverPrepare.payload.delivery_blocking = true;
      }
      artifacts.delivery_blocking = deliverPrepare.payload?.delivery_blocking === true;
      artifacts.delivery_blocking_reasons = asStringArray(deliverPrepare.payload?.delivery_blocking_reasons);
      artifacts.delivery_blocked_by_quality_gate =
        artifacts.delivery_blocking === true &&
        artifacts.delivery_blocking_reasons.some((reason) =>
          /runtime harness|quality gate/iu.test(reason),
        );
      markStage(
        stageMap,
        "delivery",
        artifacts.delivery_manifest_file
          ? artifacts.delivery_blocking === true || artifacts.delivery_quality_gate_status === "not_pass"
            ? "warn"
            : "pass"
          : "fail",
        uniqueStrings([deliverPrepare.transcriptFile, ...collectStringRefs(deliverPrepare.payload)]),
        artifacts.delivery_manifest_file
          ? artifacts.delivery_blocking === true || artifacts.delivery_quality_gate_status === "not_pass"
            ? "Delivery evidence materialized with observed quality findings."
            : "Delivery prepare materialized delivery evidence."
          : "Delivery prepare did not materialize delivery evidence.",
      );
      if (!artifacts.delivery_manifest_file) {
        throw new Error("Delivery prepare did not materialize delivery evidence.");
      }
    }

    if (guidedJourneyEnabled) {
      const guidedNextAfterDelivery = runCommand("guided-next-after-delivery", [
        "next",
        "--project-ref",
        ".",
        "--runtime-root",
        ".aor",
        "--json",
      ]);
      artifacts.next_action_report_file = getStringField(guidedNextAfterDelivery.payload, "next_action_report_file");
      artifacts.guided_next_after_delivery_transcript_file = guidedNextAfterDelivery.transcriptFile;

      if (internalTestHooks.fail_release_prepare === true) {
        artifacts.release_status = "fail";
        markStage(stageMap, "release", "fail", [], "Release prepare failed before release-packet evidence materialized.");
        throw new Error("Release prepare did not materialize release-packet evidence.");
      }

      const releasePrepare = runCommand("release-prepare", [
        "release",
        "prepare",
        "--project-ref",
        ".",
        "--project-profile",
        generatedProfile.generatedProjectProfileFile,
        "--runtime-root",
        ".aor",
        "--run-id",
        latestImplementationRunId,
        "--step-class",
        "implement",
        "--mode",
        getPreferredDeliveryMode(options.profile),
        "--require-review-decision",
        ...(artifacts.approved_handoff_packet_file
          ? ["--approved-handoff-ref", /** @type {string} */ (artifacts.approved_handoff_packet_file)]
          : []),
        ...(deliveryEvidenceRefs.length > 0 ? ["--promotion-evidence-refs", deliveryEvidenceRefs.join(",")] : []),
      ], { allowNonZeroWithPayload: true });
      artifacts.release_delivery_manifest_file = getStringField(releasePrepare.payload, "delivery_manifest_file");
      artifacts.release_delivery_transcript_file = getStringField(releasePrepare.payload, "delivery_transcript_file");
      artifacts.release_packet_file = getStringField(releasePrepare.payload, "release_packet_file");
      artifacts.release_packet_status = getStringField(releasePrepare.payload, "release_packet_status");
      artifacts.guided_release_prepare_transcript_file = releasePrepare.transcriptFile;
      artifacts.release_status = artifacts.release_packet_file ? "pass" : "fail";
      markStage(
        stageMap,
        "release",
        artifacts.release_status,
        uniqueStrings([releasePrepare.transcriptFile, ...collectStringRefs(releasePrepare.payload)]),
        artifacts.release_packet_file
          ? "Release prepare materialized release packet evidence under the review gate."
          : "Release prepare did not materialize release packet evidence.",
      );
      if (!artifacts.release_packet_file) {
        throw new Error("Release prepare did not materialize release packet evidence.");
      }
    } else if (options.scenarioPolicy.release_required === true && getProfileStages(options.profile).includes("release")) {
      if (internalTestHooks.fail_release_prepare === true) {
        artifacts.release_status = "fail";
        markStage(stageMap, "release", "fail", [], "Release prepare failed before release-packet evidence materialized.");
        throw new Error("Release prepare did not materialize release-packet evidence.");
      }

      const releasePrepare = runCommand("release-prepare", [
        "release",
        "prepare",
        "--project-ref",
        ".",
        "--project-profile",
        generatedProfile.generatedProjectProfileFile,
        "--runtime-root",
        ".aor",
        "--run-id",
        latestImplementationRunId,
        "--step-class",
        "implement",
        "--mode",
        getPreferredDeliveryMode(options.profile),
        ...(artifacts.approved_handoff_packet_file
          ? ["--approved-handoff-ref", /** @type {string} */ (artifacts.approved_handoff_packet_file)]
          : []),
        ...(deliveryEvidenceRefs.length > 0 ? ["--promotion-evidence-refs", deliveryEvidenceRefs.join(",")] : []),
      ], { allowNonZeroWithPayload: true });
      artifacts.release_delivery_manifest_file = getStringField(releasePrepare.payload, "delivery_manifest_file");
      artifacts.release_delivery_transcript_file = getStringField(releasePrepare.payload, "delivery_transcript_file");
      artifacts.release_packet_file = getStringField(releasePrepare.payload, "release_packet_file");
      artifacts.release_packet_status = getStringField(releasePrepare.payload, "release_packet_status");
      artifacts.release_prepare_transcript_file = releasePrepare.transcriptFile;
      artifacts.release_status = artifacts.release_packet_file ? "pass" : "fail";
      markStage(
        stageMap,
        "release",
        artifacts.release_status,
        uniqueStrings([releasePrepare.transcriptFile, ...collectStringRefs(releasePrepare.payload)]),
        artifacts.release_packet_file
          ? "Release prepare materialized strict release-packet evidence."
          : "Release prepare did not materialize strict release-packet evidence.",
      );
    } else {
      artifacts.release_status = options.scenarioPolicy.release_required === true ? "fail" : "skipped";
      markStage(stageMap, "release", "skipped", [], "Delivery-default flow range excludes release.");
    }

    const auditRuns = runCommand("audit-runs", [
      "audit",
      "runs",
      "--project-ref",
      ".",
      "--project-profile",
      generatedProfile.generatedProjectProfileFile,
      "--runtime-root",
      ".aor",
      "--run-id",
      latestImplementationRunId,
    ]);
    artifacts.run_audit_file = auditRuns.transcriptFile;
    const auditPayload = asRecord(auditRuns.payload);
    if (internalTestHooks.corrupt_audit_coverage_follow_up === true) {
      const auditRecords = Array.isArray(auditPayload.run_audit_records) ? auditPayload.run_audit_records : [];
      const auditRecord =
        auditRecords.map((record) => asRecord(record)).find((record) => asNonEmptyString(record.run_id) === options.runId) ||
        asRecord(auditRecords[0]);
      if (hasObjectFields(auditRecord)) {
        auditRecord.coverage_follow_up = {
          current_cell_required: false,
          remaining_required_matrix_cells: [],
        };
      }
    }

    let incidentOpen = null;
    if (reviewOverallStatus === "fail") {
      incidentOpen = runCommand("incident-open", [
        "incident",
        "open",
        "--project-ref",
        ".",
        "--project-profile",
        generatedProfile.generatedProjectProfileFile,
        "--runtime-root",
        ".aor",
        "--run-id",
        latestImplementationRunId,
        "--summary",
        "Full-journey review verdict failed.",
      ]);
      artifacts.incident_report_file = getStringField(incidentOpen.payload, "incident_report_file");
    }

    let learningHandoff;
    try {
      learningHandoff = runCommand("learning-handoff", [
        "learning",
        "handoff",
        "--project-ref",
        ".",
        "--project-profile",
        generatedProfile.generatedProjectProfileFile,
        "--runtime-root",
        ".aor",
        "--run-id",
        latestImplementationRunId,
      ]);
    } catch (error) {
      const summary = error instanceof Error ? error.message : String(error);
      markStage(stageMap, "learning", "fail", [], summary);
      throw error;
    }
    if (internalTestHooks.drop_learning_handoff_outputs === true) {
      delete learningHandoff.payload.learning_loop_handoff_file;
    }
    artifacts.learning_loop_scorecard_file = getStringField(learningHandoff.payload, "learning_loop_scorecard_file");
    artifacts.learning_loop_handoff_file = getStringField(learningHandoff.payload, "learning_loop_handoff_file");
    artifacts.latest_runtime_harness_report_file =
      getStringField(learningHandoff.payload, "runtime_harness_report_file") ||
      artifacts.latest_runtime_harness_report_file ||
      artifacts.runtime_harness_report_file;
    artifacts.latest_runtime_harness_decision =
      getStringField(learningHandoff.payload, "runtime_harness_overall_decision") ||
      artifacts.latest_runtime_harness_decision ||
      artifacts.run_start_runtime_harness_decision ||
      artifacts.runtime_harness_overall_decision;
    artifacts.incident_report_file =
      getStringField(learningHandoff.payload, "incident_report_file") ||
      artifacts.incident_report_file ||
      null;
    if (!artifacts.learning_loop_scorecard_file || !artifacts.learning_loop_handoff_file) {
      markStage(
        stageMap,
        "learning",
        "fail",
        uniqueStrings([learningHandoff.transcriptFile, ...collectStringRefs(learningHandoff.payload)]),
        "Learning handoff did not materialize the required public closure artifacts.",
      );
      throw new Error("Learning handoff did not materialize the required public closure artifacts.");
    }
    if (internalTestHooks.corrupt_learning_scorecard_coverage_follow_up === true) {
      const learningScorecard = asRecord(readJson(artifacts.learning_loop_scorecard_file));
      learningScorecard.coverage_follow_up = {
        current_cell_required: false,
        remaining_required_matrix_cells: [],
      };
      writeJson(artifacts.learning_loop_scorecard_file, learningScorecard);
    }
    if (guidedJourneyEnabled) {
      const guidedNextAfterLearning = runCommand("guided-next-after-learning", [
        "next",
        "--project-ref",
        ".",
        "--runtime-root",
        ".aor",
        "--json",
      ]);
      artifacts.next_action_report_file = getStringField(guidedNextAfterLearning.payload, "next_action_report_file");
      artifacts.guided_next_after_learning_transcript_file = guidedNextAfterLearning.transcriptFile;

      const appSmoke = runGuidedAppSmoke({
        aorLaunch: options.aorLaunch,
        targetCheckoutRoot: targetCheckout.targetCheckoutRoot,
        runId: options.runId,
        reportsRoot: options.layout.reportsRoot,
        env,
      });
      artifacts.guided_app_smoke_summary_file = appSmoke.summaryFile;
      artifacts.guided_app_smoke = appSmoke.summary;
    }
    markStage(
      stageMap,
      "learning",
      "pass",
      uniqueStrings([learningHandoff.transcriptFile, ...collectStringRefs(learningHandoff.payload)]),
      "Public learning-loop closure artifacts materialized.",
    );

    if (internalTestHooks.drop_runtime_harness_report_outputs === true) {
      if (typeof artifacts.runtime_harness_report_file === "string") {
        try {
          fs.rmSync(artifacts.runtime_harness_report_file, { force: true });
        } catch {
          // Test hook only: scenario coverage below will fail on the missing proof artifact.
        }
      }
      artifacts.runtime_harness_report_file = null;
      artifacts.runtime_harness_overall_decision = null;
      artifacts.latest_runtime_harness_report_file = null;
      artifacts.latest_runtime_harness_decision = null;
      artifacts.delivery_runtime_harness_report_file = null;
      artifacts.run_start_runtime_harness_report_file = null;
      artifacts.run_start_runtime_harness_decision = null;
    }

    if (guidedJourneyEnabled) {
      const targetHeadAfter = runGitOutput({
        cwd: targetCheckout.targetCheckoutRoot,
        args: ["rev-parse", "HEAD"],
      });
      const targetGitStatusWithoutRuntime = collectTargetGitStatusWithoutRuntime(targetCheckout.targetCheckoutRoot);
      artifacts.target_head_before = targetHeadBefore;
      artifacts.target_head_after = targetHeadAfter;
      artifacts.target_git_status_without_runtime = targetGitStatusWithoutRuntime;
      const guidedProof = buildGuidedJourneyProof({
        runId: options.runId,
        profile: options.profile,
        commandResults,
        artifacts,
        targetCheckoutRoot: targetCheckout.targetCheckoutRoot,
        reportsRoot: options.layout.reportsRoot,
        targetHeadBefore,
        targetHeadAfter,
        targetGitStatusWithoutRuntime,
      });
      const writtenProof = writeValidatedGuidedJourneyProof({
        proof: guidedProof,
        targetCheckoutRoot: targetCheckout.targetCheckoutRoot,
        reportsRoot: options.layout.reportsRoot,
        runId: options.runId,
      });
      artifacts.guided_journey_proof_file = writtenProof.proofFile;
      artifacts.guided_journey_proof = writtenProof.proof;
    }

    const targetBaselineStatus = asNonEmptyString(artifacts.baseline_verify_status) || "fail";
    const postRunVerificationStatus = asNonEmptyString(artifacts.post_run_verify_status) || "fail";
    const postRunDiagnosticStatus = asNonEmptyString(artifacts.post_run_diagnostic_status) || "pass";
    const runtimeHarnessDecision =
      asNonEmptyString(artifacts.run_start_runtime_harness_decision) ||
      asNonEmptyString(artifacts.runtime_harness_overall_decision) ||
      "unknown";
    const latestRuntimeHarnessDecision =
      asNonEmptyString(artifacts.latest_runtime_harness_decision) || runtimeHarnessDecision;
    const realCodeChangeStatus = [
      asNonEmptyString(artifacts.latest_runtime_harness_report_file),
      asNonEmptyString(artifacts.delivery_runtime_harness_report_file),
      asNonEmptyString(artifacts.runtime_harness_report_file),
      asNonEmptyString(artifacts.run_start_runtime_harness_report_file),
    ].some((reportFile) => reportFile && runtimeHarnessReportHasMeaningfulChanges(reportFile))
      ? "pass"
      : "fail";
    const providerExecutionProofStatus = evidenceRefMaterialized(
      asNonEmptyString(artifacts.adapter_raw_evidence_ref),
      targetCheckout.targetCheckoutRoot,
    )
      ? "pass"
      : "fail";
    artifacts.real_code_change_status = realCodeChangeStatus;
    artifacts.runtime_harness_decision = runtimeHarnessDecision;
    artifacts.run_start_runtime_harness_decision = runtimeHarnessDecision;
    artifacts.latest_runtime_harness_decision = latestRuntimeHarnessDecision;
    artifacts.provider_execution_status = providerExecutionProofStatus;
    const artifactConsistency = evaluateArtifactConsistency({
      artifacts,
      reviewReport,
      auditPayload,
      runId: options.runId,
    });
    artifacts.artifact_consistency = artifactConsistency;
    const agentOperatorAssessment = {
      mission_satisfaction:
        postRunVerificationStatus === "pass" && realCodeChangeStatus === "pass" && reviewOverallStatus !== "fail"
          ? "pass"
          : "not_pass",
      implementation_relevance: realCodeChangeStatus,
      diff_quality: normalizeVerdictStatus(asRecord(reviewReport.code_quality).status),
      verification_interpretation: postRunVerificationStatus,
      artifact_consistency: artifactConsistency.status,
      risk_findings: uniqueStrings([
        ...asStringArray(asRecord(reviewReport.code_quality).findings).map((entry) => asNonEmptyString(asRecord(entry).summary) || entry),
        ...asStringArray(artifactConsistency.findings),
      ]),
      final_recommendation:
        postRunVerificationStatus === "pass" && realCodeChangeStatus === "pass" && reviewOverallStatus !== "fail"
          ? "accept"
          : "reject",
    };
    artifacts.agent_operator_assessment = agentOperatorAssessment;
    artifacts.quality_gate_decision =
      postRunVerificationStatus === "pass" &&
      postRunDiagnosticStatus !== "fail" &&
      realCodeChangeStatus === "pass" &&
      reviewOverallStatus !== "fail" &&
      agentOperatorAssessment.mission_satisfaction === "pass"
        ? "pass"
        : "fail";

    const scenarioCoverage = evaluateScenarioCoverage({
      scenarioPolicy: options.scenarioPolicy,
      stageResults: flattenStageMap(stageMap),
      artifacts,
      auditPayload,
    });
    if (artifactConsistency.status === "fail") {
      scenarioCoverage.status = "fail";
      scenarioCoverage.findings = uniqueStrings([
        ...asStringArray(scenarioCoverage.findings),
        ...artifactConsistency.findings,
      ]);
      scenarioCoverage.summary = artifactConsistency.summary;
    }
    artifacts.scenario_coverage = scenarioCoverage;
    const intakeGateStatus = normalizeVerdictStatus(asRecord(artifacts.intake_quality_gate).status);
    const releaseRequired = options.scenarioPolicy.release_required === true;
    const deliveryReleaseQuality =
      artifacts.delivery_blocking === true
        ? "fail"
        : releaseRequired
          ? asNonEmptyString(artifacts.release_status) === "pass" && artifacts.release_packet_file
            ? "pass"
            : "fail"
          : asRecord(options.profile.output_policy).materialize_release_packet === true
            ? artifacts.release_packet_file
              ? "pass"
              : "fail"
            : artifacts.delivery_manifest_file
              ? "pass"
              : "warn";
    const learningLoopClosure =
      artifacts.learning_loop_scorecard_file && artifacts.learning_loop_handoff_file && auditPayload.run_audit_records
        ? "pass"
        : "fail";
    const qualityJudgement = {
      scenario_family: asNonEmptyString(options.profile.scenario_family) || null,
      provider_variant_id: asNonEmptyString(options.profile.provider_variant_id) || null,
      feature_size: options.featureSize,
      target_selection: "pass",
      feature_request_quality: artifacts.intake_artifact_packet_file && artifacts.feature_request_file ? "pass" : "fail",
      scenario_coverage_status: scenarioCoverage.status,
      provider_execution_status: providerExecutionProofStatus,
      target_baseline_status: targetBaselineStatus,
      real_code_change_status: realCodeChangeStatus,
      agent_operator_assessment: agentOperatorAssessment,
      post_run_verification_status: postRunVerificationStatus,
      post_run_diagnostic_status: postRunDiagnosticStatus,
      discovery_quality:
        intakeGateStatus === "fail" ? "fail" : normalizeVerdictStatus(asRecord(reviewReport.discovery_quality).status),
      runtime_success:
        artifacts.routed_step_result_file &&
        artifacts.runtime_harness_report_file &&
        providerExecutionProofStatus === "pass"
          ? "pass"
          : "fail",
      runtime_harness_decision: runtimeHarnessDecision,
      run_start_runtime_harness_decision: runtimeHarnessDecision,
      latest_runtime_harness_decision: latestRuntimeHarnessDecision,
      artifact_quality:
        intakeGateStatus === "fail"
          ? "fail"
          : artifactConsistency.status === "fail"
          ? "fail"
          : normalizeVerdictStatus(asRecord(reviewReport.artifact_quality).status),
      code_quality: normalizeVerdictStatus(asRecord(reviewReport.code_quality).status),
      feature_size_fit_status: featureSizeFitStatus,
      delivery_release_quality: deliveryReleaseQuality,
      learning_loop_closure: learningLoopClosure,
      quality_gate_decision: artifacts.quality_gate_decision,
      overall_status: "pass",
    };
    qualityJudgement.feature_request_quality =
      intakeGateStatus === "fail" ? "fail" : artifacts.intake_artifact_packet_file && artifacts.feature_request_file ? "pass" : "fail";
    const verdictStatuses = [
      qualityJudgement.target_selection,
      qualityJudgement.feature_request_quality,
      qualityJudgement.scenario_coverage_status,
      qualityJudgement.discovery_quality,
      qualityJudgement.runtime_success,
      qualityJudgement.target_baseline_status,
      qualityJudgement.real_code_change_status,
      qualityJudgement.post_run_verification_status,
      qualityJudgement.post_run_diagnostic_status,
      qualityJudgement.artifact_quality,
      qualityJudgement.code_quality,
      qualityJudgement.provider_execution_status,
      qualityJudgement.feature_size_fit_status,
      qualityJudgement.delivery_release_quality,
      qualityJudgement.learning_loop_closure,
      qualityJudgement.quality_gate_decision,
    ];
    qualityJudgement.overall_status = verdictStatuses.includes("fail")
      ? "fail"
      : verdictStatuses.includes("warn")
        ? "pass_with_findings"
        : "pass";
    artifacts.quality_judgement = qualityJudgement;
    artifacts.canonical_status = buildCanonicalRunStatus({
      commandResults,
      artifacts,
      artifactConsistency,
      reviewReport,
      scenarioCoverage,
      qualityJudgement,
      runTier: asNonEmptyString(artifacts.run_tier) || resolveRunTier(options.profile),
      scenarioPolicy: options.scenarioPolicy,
    });
    artifacts.command_status = asNonEmptyString(asRecord(artifacts.canonical_status).command_status);
    artifacts.target_verification_status = asNonEmptyString(asRecord(artifacts.canonical_status).target_verification_status);
    artifacts.artifact_quality_status = asNonEmptyString(asRecord(artifacts.canonical_status).artifact_quality_status);
    artifacts.delivery_status = asNonEmptyString(asRecord(artifacts.canonical_status).delivery_status);
    artifacts.coverage_status = asNonEmptyString(asRecord(artifacts.canonical_status).coverage_status);
    artifacts.acceptance_status = asNonEmptyString(asRecord(artifacts.canonical_status).acceptance_status);

    return {
      startedAt,
      finishedAt: nowIso(),
      status: qualityJudgement.overall_status === "fail" ? "fail" : "pass",
      stageResults: flattenStageMap(stageMap),
      commandResults,
      artifacts,
      sessionRoots,
    };
  } catch (error) {
    if (isLiveE2eControllerStop(error)) {
      artifacts.live_e2e_controller_stop = {
        reason: error.message,
        decision: asRecord(error.decision),
        state: asRecord(error.state),
      };
      return {
        startedAt,
        finishedAt: nowIso(),
        status: asNonEmptyString(asRecord(error.decision).action) === "continue" ? "pass" : "fail",
        stageResults: flattenStageMap(stageMap),
        commandResults,
        artifacts,
        sessionRoots,
      };
    }
    const summary = error instanceof Error ? error.message : String(error);
    if (!flattenStageMap(stageMap).some((stage) => stage.status === "fail")) {
      const fallbackStage = flattenStageMap(stageMap).find((stage) => stage.status === "pending")?.stage ?? "bootstrap";
      markStageRaw(stageMap, fallbackStage, "fail", [], summary);
      try {
        options.stepController?.observeStage({
          stage: fallbackStage,
          stageResult: stageMap[fallbackStage],
          commandResults,
          artifacts,
        });
      } catch (controllerError) {
        if (!isLiveE2eControllerStop(controllerError)) throw controllerError;
      }
    }
    return {
      startedAt,
      finishedAt: nowIso(),
      status: "fail",
      stageResults: flattenStageMap(stageMap),
      commandResults,
      artifacts,
      sessionRoots,
    };
  }
}
