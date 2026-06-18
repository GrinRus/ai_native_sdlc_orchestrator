import { spawn, spawnSync } from "node:child_process";
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
  materializeProviderPinnedPolicyOverrides,
  materializeProviderPinnedRouteOverrides,
  materializeTargetCheckout,
  normalizeDeliveryMode,
} from "./target-materialization.mjs";
import { resolveAuthProbeRequired, runLiveAdapterPreflight } from "./preflight.mjs";

const MIN_LIVE_E2E_AOR_COMMAND_TIMEOUT_MS = 30_000;
const LIVE_E2E_AOR_COMMAND_TIMEOUT_OVERHEAD_MS = 60_000;
const AOR_OPERATOR_ACCESSIBILITY_CHECK_IDS = Object.freeze([
  "keyboard_navigation",
  "focus_order",
  "contrast_and_readability",
  "semantic_structure",
  "screen_reader_labels",
  "accessible_error_feedback",
]);

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
 * @param {Record<string, string>} policyOverrides
 * @returns {string | null}
 */
function serializePolicyOverrides(policyOverrides) {
  const pairs = Object.entries(policyOverrides)
    .filter(([, policyId]) => typeof policyId === "string" && policyId.length > 0)
    .map(([step, policyId]) => `${step}=${policyId}`);
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
 * @param {Record<string, unknown>} stepResult
 * @param {Record<string, unknown>} adapterOutput
 * @returns {{ owner: string, phase: string, class: string } | null}
 */
function classifyProviderExecutionFailure(stepResult, adapterOutput) {
  const failureKind = asNonEmptyString(adapterOutput.failure_kind);
  const stepFailureClass = asNonEmptyString(stepResult.failure_class);
  const failureClass = failureKind || stepFailureClass;
  if (!failureClass || ["none", "pass", "passed", "completed", "succeeded"].includes(failureClass)) {
    return null;
  }
  if (failureClass === "compiled_context_budget_exceeded") {
    return {
      owner: "aor",
      phase: "provider_execution",
      class: "compiled_context_budget_exceeded",
    };
  }
  if (failureClass === "provider_context_window_exceeded") {
    return {
      owner: "provider",
      phase: "provider_execution",
      class: "provider_context_window_exceeded",
    };
  }
  if (failureClass === "provider_work_packet_not_executed") {
    return {
      owner: "provider",
      phase: "provider_execution",
      class: "provider_work_packet_not_executed",
    };
  }
  if (failureClass === "no-op") {
    return {
      owner: "provider",
      phase: "provider_execution",
      class: "no-op",
    };
  }
  return {
    owner: "provider",
    phase: "provider_execution",
    class: failureClass,
  };
}

/**
 * @param {Record<string, unknown>} artifacts
 * @param {Record<string, unknown>} stepResult
 * @param {Record<string, unknown>} adapterOutput
 */
function applyProviderExecutionFailure(artifacts, stepResult, adapterOutput) {
  const classification = classifyProviderExecutionFailure(stepResult, adapterOutput);
  if (!classification) {
    return;
  }
  artifacts.failure_owner = classification.owner;
  artifacts.failure_phase = classification.phase;
  artifacts.failure_class = classification.class;
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

/**
 * @param {{ launcherRef: string, installRoot: string }} options
 * @returns {{ status: "pass" | "fail", transcriptFile: string }}
 */
function verifyCachedAorLauncher(options) {
  const transcriptFile = path.join(options.installRoot, "00-cached-aor-project-init-help.json");
  const transcript = runInstallProofCommand({
    cwd: path.dirname(options.launcherRef),
    command: options.launcherRef,
    args: ["project", "init", "--help"],
    transcriptFile,
  });
  return {
    status: asNonEmptyString(transcript.status) === "pass" ? "pass" : "fail",
    transcriptFile,
  };
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
  const proofFile = path.join(options.reportsRoot, `live-e2e-aor-installation-proof-${normalizedRunId}.json`);
  const currentSourceCommit = gitHeadOrNull(options.hostRoot);
  if (fileExists(proofFile)) {
    const cachedProof = asRecord(readJson(proofFile));
    const launcherRef = asNonEmptyString(cachedProof.launcher_ref);
    const cachedSourceCommit = asNonEmptyString(cachedProof.source_commit_sha);
    const cachedInstallMode = asNonEmptyString(cachedProof.install_mode);
    const sourceCommitMatches = !currentSourceCommit || !cachedSourceCommit || currentSourceCommit === cachedSourceCommit;
    const cacheLooksReusable =
      asNonEmptyString(cachedProof.status) === "pass" && sourceCommitMatches && launcherRef && fileExists(launcherRef);
    const cachedLauncherSmoke = cacheLooksReusable ? verifyCachedAorLauncher({ launcherRef, installRoot }) : null;
    if (cacheLooksReusable && cachedLauncherSmoke?.status === "pass") {
      const cachedProofWithReuse = {
        ...cachedProof,
        reused_for_manual_resume: true,
        reused_at: nowIso(),
        cached_launcher_smoke_file: cachedLauncherSmoke.transcriptFile,
      };
      writeJson(proofFile, cachedProofWithReuse);
      const setupEntry = {
        sequence: 1,
        step_id: "install",
        status: "pass",
        public_surface:
          cachedInstallMode === "provided-binary" ? "provided aor binary" : "cached pnpm source install",
        evidence_refs: uniqueStrings([
          proofFile,
          ...asStringArray(cachedProof.command_transcripts),
          cachedLauncherSmoke.transcriptFile,
        ]),
        summary: "AOR installation proof was reused for manual resume because the source proof remained valid.",
      };
      return {
        launch: {
          command: launcherRef,
          argsPrefix: [],
          binaryRef: launcherRef,
        },
        proof: cachedProofWithReuse,
        proofFile,
        setupEntry,
      };
    }
  }
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
    addCommand("pnpm-install-frozen-lockfile-force", "pnpm", ["install", "--frozen-lockfile", "--force"]);
    addCommand("pnpm-build", "pnpm", ["build"]);
    addCommand("pnpm-aor-help", "pnpm", ["aor", "--help"]);
    addCommand("pnpm-aor-project-init-help", "pnpm", ["aor", "project", "init", "--help"]);
    addCommand("pnpm-aor-intake-create-help", "pnpm", ["aor", "intake", "create", "--help"]);
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
    source_commit_sha: currentSourceCommit,
    installed_source_root: effectivePolicy === "source-install-required" ? installCwd : null,
    launcher_ref: launcherRef,
    command_transcripts: commandTranscripts,
    commands: commandSummaries,
    started_at: asNonEmptyString(asRecord(commandSummaries[0]).started_at) || null,
    finished_at: nowIso(),
  };
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
 *   timeoutMs?: number | null,
 * }}
 */
function runAorCommand(options) {
  const rawArgs = [...options.launch.argsPrefix, ...options.args];
  const startedAt = nowIso();
  const run = spawnSync(options.launch.command, rawArgs, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    timeout:
      typeof options.timeoutMs === "number" && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
        ? Math.max(Math.floor(options.timeoutMs), MIN_LIVE_E2E_AOR_COMMAND_TIMEOUT_MS)
        : undefined,
    killSignal: "SIGKILL",
    detached: process.platform !== "win32",
  });
  const timedOut = commandTimedOut(run);
  if (timedOut) {
    terminateTimedOutProcessGroup(run.pid);
  }
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
    signal: run.signal ?? null,
    timed_out: timedOut,
    timeout_ms:
      typeof options.timeoutMs === "number" && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
        ? Math.max(Math.floor(options.timeoutMs), MIN_LIVE_E2E_AOR_COMMAND_TIMEOUT_MS)
        : null,
    error_code: /** @type {{ code?: unknown } | undefined} */ (run.error)?.code ?? null,
    stdout: run.stdout ?? "",
    stderr: run.stderr ?? (run.error instanceof Error ? run.error.message : ""),
    parsed_json: parsed,
    started_at: startedAt,
    finished_at: finishedAt,
  };
  writeJson(transcriptFile, transcript);
  return {
    label: options.label,
    ok: run.status === 0 && parsed !== null && !timedOut,
    exitCode: run.status ?? -1,
    stdout: run.stdout ?? "",
    stderr: run.stderr ?? (run.error instanceof Error ? run.error.message : ""),
    payload: parsed,
    transcriptFile,
    startedAt,
    finishedAt,
    durationSec: resolveDurationSeconds(startedAt, finishedAt),
    commandSurface: resolveCommandSurface(options.args),
    timedOut,
    timeoutMs:
      typeof options.timeoutMs === "number" && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
        ? Math.max(Math.floor(options.timeoutMs), MIN_LIVE_E2E_AOR_COMMAND_TIMEOUT_MS)
        : null,
  };
}

/**
 * @param {import("node:child_process").SpawnSyncReturns<string>} commandRun
 * @returns {boolean}
 */
function commandTimedOut(commandRun) {
  const error = /** @type {{ code?: unknown } | undefined} */ (commandRun.error);
  return error?.code === "ETIMEDOUT";
}

/**
 * @param {number | undefined} pid
 */
function terminateTimedOutProcessGroup(pid) {
  if (process.platform === "win32" || !Number.isInteger(pid) || Number(pid) <= 0) {
    return;
  }

  for (const signal of ["SIGTERM", "SIGKILL"]) {
    try {
      process.kill(-Number(pid), signal);
    } catch {
      continue;
    }
  }
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
  const runControlState = asRecord(payload.run_control_state);
  const providerStepStatus = asRecord(runControlState.provider_step_status);
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
    timed_out: result.timedOut,
    timeout_budget_ms: result.timeoutMs,
    transcript_file: result.transcriptFile,
    artifact_refs: uniqueStrings(collectStringRefs(result.payload)),
    failure_class: result.ok ? null : result.timedOut ? "aor-command-timeout" : "command-failed",
    failure_owner: result.ok ? null : "aor",
    failure_phase: result.ok ? null : resolveFailurePhaseForCommandLabel(result.label),
    missing_evidence: [],
    recommendation: result.ok
      ? "continue"
      : result.timedOut
        ? "inspect AOR command transcript and target setup status before judging provider quality"
        : "inspect transcript and command stderr",
    interactive_continuation: interactiveContinuation,
    provider_step_status: Object.keys(providerStepStatus).length > 0 ? providerStepStatus : null,
  };
}

/**
 * @param {string} label
 * @returns {"aor_install" | "target_checkout" | "target_setup" | "target_verification" | "provider_execution" | "controller_decision" | "ui_validation"}
 */
function resolveFailurePhaseForCommandLabel(label) {
  if (label.includes("verify")) return "target_verification";
  if (label.includes("app") || label.includes("web")) return "ui_validation";
  if (label.includes("run-start") || label.includes("request-run")) return "provider_execution";
  if (label.includes("decision") || label.includes("next")) return "controller_decision";
  if (label.includes("init") || label.includes("doctor") || label.includes("onboard")) return "aor_install";
  return "controller_decision";
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
 * @param {Record<string, unknown>} diagnostic
 * @returns {ReturnType<typeof runAorCommand> | null}
 */
function buildCachedCommandResult(diagnostic) {
  const transcriptFile = asNonEmptyString(diagnostic.transcript_file);
  if (!transcriptFile || !fileExists(transcriptFile)) return null;
  const transcript = asRecord(readJson(transcriptFile));
  return {
    label: asNonEmptyString(diagnostic.label),
    ok: commandCompletedForRun(diagnostic),
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
function commandCompletedForRun(diagnostic) {
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
 * @param {{
 *   mission: Record<string, unknown>,
 *   featureRequest: ReturnType<typeof materializeFeatureRequestFile>,
 *   profile: Record<string, unknown>,
 *   projectProfileFile: string,
 *   missionIdOverride?: string | null,
 *   titleOverride?: string | null,
 *   briefOverride?: string | null,
 *   deliveryModeOverride?: string | null,
 *   sourceRefOverride?: string | null,
 *   followUpSourceHandoffRef?: string | null,
 * }}
 * @returns {string[]}
 */
function buildGuidedMissionCreateArgs(options) {
  const missionId = asNonEmptyString(options.missionIdOverride) || asNonEmptyString(options.mission.mission_id);
  const title =
    asNonEmptyString(options.titleOverride) ||
    asNonEmptyString(options.featureRequest.requestDocument.title) ||
    missionId ||
    "Guided mission";
  const brief =
    asNonEmptyString(options.briefOverride) ||
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
    asNonEmptyString(options.deliveryModeOverride) || getPreferredDeliveryMode(options.profile),
    "--source-kind",
    "local-note",
    "--source-ref",
    asNonEmptyString(options.sourceRefOverride) || options.featureRequest.requestFile,
    ...(asNonEmptyString(options.followUpSourceHandoffRef)
      ? ["--follow-up-source-handoff-ref", asNonEmptyString(options.followUpSourceHandoffRef)]
      : []),
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
 * @param {string} targetCheckoutRoot
 * @param {string | null | undefined} value
 * @returns {string | null}
 */
function resolveTargetEvidencePath(targetCheckoutRoot, value) {
  const ref = asNonEmptyString(value);
  if (!ref) return null;
  if (path.isAbsolute(ref)) return ref;
  if (ref.startsWith("evidence://")) {
    const evidencePath = ref.slice("evidence://".length);
    return evidencePath ? path.resolve(targetCheckoutRoot, evidencePath) : null;
  }
  return path.resolve(targetCheckoutRoot, ref);
}

/**
 * @param {string} targetCheckoutRoot
 * @param {string | null | undefined} packetFile
 * @returns {{ flowId: string | null, projectId: string | null, missionId: string | null }}
 */
function resolveFlowIdentityFromPacket(targetCheckoutRoot, packetFile) {
  const resolvedPacketFile = resolveTargetEvidencePath(targetCheckoutRoot, packetFile);
  if (!resolvedPacketFile || !fileExists(resolvedPacketFile)) {
    return { flowId: null, projectId: null, missionId: null };
  }
  const packet = asRecord(readJson(resolvedPacketFile));
  const packetId = asNonEmptyString(packet.packet_id);
  const marker = ".artifact.intake.";
  const markerIndex = packetId.indexOf(marker);
  const projectId = markerIndex > 0 ? packetId.slice(0, markerIndex) : null;
  const invocationContext = asRecord(packet.invocation_context);
  const packetMissionId =
    asNonEmptyString(invocationContext.mission_id) ||
    (markerIndex > 0 ? packetId.slice(markerIndex + marker.length).replace(/\.v\d+$/u, "") : "");
  const normalizedMissionId = normalizeId(packetMissionId);
  return {
    flowId: projectId && normalizedMissionId ? `flow.${projectId}.${normalizedMissionId}` : null,
    projectId,
    missionId: packetMissionId || null,
  };
}

/**
 * @param {string | null | undefined} reportFile
 * @returns {Record<string, unknown>}
 */
function readReportDocument(reportFile) {
  const ref = asNonEmptyString(reportFile);
  if (!ref || !fileExists(ref)) return {};
  return asRecord(readJson(ref));
}

/**
 * @param {string} targetRoot
 * @param {{ projectId: string | null, missionId: string | null }} identity
 * @returns {string | null}
 */
export function archivedNextActionReportForMission(targetRoot, identity) {
  const projectId = asNonEmptyString(identity.projectId);
  const missionId = normalizeId(asNonEmptyString(identity.missionId) || "");
  if (!projectId || !missionId) return null;
  const reportFile = path.join(targetRoot, ".aor", "projects", projectId, "reports", `next-action-report-${missionId}.json`);
  return fileExists(reportFile) ? reportFile : null;
}

/**
 * @param {Record<string, unknown>} report
 * @returns {boolean}
 */
export function nextActionReportClosesFlow(report) {
  const closureState = asRecord(report.closure_state);
  const learningState = asRecord(closureState.learning);
  const primaryAction = asRecord(report.primary_action);
  return (
    asNonEmptyString(learningState.status) === "handoff-complete" ||
    asNonEmptyString(primaryAction.action_id) === "start-new-flow" ||
    asNonEmptyString(primaryAction.action_id) === "closure-complete"
  );
}

/**
 * @param {string | null | undefined} requestFile
 * @returns {Record<string, unknown>}
 */
function readOperatorRequestDocument(requestFile) {
  const ref = asNonEmptyString(requestFile);
  if (!ref || !fileExists(ref)) return {};
  const payload = asRecord(readJson(ref));
  return asRecord(payload.operator_request ?? payload);
}

/**
 * @param {{
 *   aorLaunch: ReturnType<typeof resolveAorLaunch>,
 *   targetCheckoutRoot: string,
 *   runId: string,
 *   reportsRoot: string,
 *   env: NodeJS.ProcessEnv,
 *   projectProfileFile?: string,
 * }}
 */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * @param {string} filePath
 * @returns {Record<string, unknown>}
 */
function tryReadJsonFile(filePath) {
  try {
    return asRecord(JSON.parse(fs.readFileSync(filePath, "utf8")));
  } catch {
    return {};
  }
}

/**
 * @param {{
 *   aorLaunch: ReturnType<typeof resolveAorLaunch>,
 *   targetCheckoutRoot: string,
 *   reportsRoot: string,
 *   runId: string,
 *   env: NodeJS.ProcessEnv,
 *   projectProfileFile?: string,
 * }}
 * @returns {Record<string, unknown>}
 */
function startGuidedBrowserTaskAppSurface(options) {
  const stdoutFile = path.join(
    options.reportsRoot,
    `installed-user-guided-browser-task-app-${normalizeId(options.runId)}.stdout.json`,
  );
  const stderrFile = path.join(
    options.reportsRoot,
    `installed-user-guided-browser-task-app-${normalizeId(options.runId)}.stderr.log`,
  );
  const stdoutFd = fs.openSync(stdoutFile, "w");
  const stderrFd = fs.openSync(stderrFile, "w");
  let child;
  try {
    child = spawn(
      options.aorLaunch.command,
      [
        ...options.aorLaunch.argsPrefix,
        "app",
        "--project-ref",
        ".",
        ...(asNonEmptyString(options.projectProfileFile)
          ? ["--project-profile", asNonEmptyString(options.projectProfileFile)]
          : []),
        "--runtime-root",
        ".aor",
        "--open",
        "false",
        "--json",
      ],
      {
        cwd: options.targetCheckoutRoot,
        detached: true,
        env: options.env,
        stdio: ["ignore", stdoutFd, stderrFd],
      },
    );
    child.unref();
  } finally {
    fs.closeSync(stdoutFd);
    fs.closeSync(stderrFd);
  }

  const startedAt = nowIso();
  let launchSummary = {};
  for (let attempt = 0; attempt < 50; attempt += 1) {
    launchSummary = tryReadJsonFile(stdoutFile);
    if (asNonEmptyString(launchSummary.app_url) && asNonEmptyString(launchSummary.control_plane)) break;
    sleepSync(100);
  }

  const stderr = fileExists(stderrFile) ? fs.readFileSync(stderrFile, "utf8").trim() : "";
  const status =
    asNonEmptyString(launchSummary.app_url) && asNonEmptyString(launchSummary.control_plane)
      ? "running"
      : "launch_failed";
  return {
    kind: "guided-browser-task-app-surface",
    status,
    started_at: startedAt,
    pid: child?.pid ?? null,
    app_url: asNonEmptyString(launchSummary.app_url) || null,
    control_plane: asNonEmptyString(launchSummary.control_plane) || null,
    project_id: asNonEmptyString(launchSummary.project_id) || null,
    stdout_file: stdoutFile,
    stderr_file: stderrFile,
    stderr_summary: stderr ? stderr.slice(0, 1000) : null,
    launch_summary: launchSummary,
  };
}

export function runGuidedWebSmoke(options) {
  const outputHtml = path.join(
    options.reportsRoot,
    `installed-user-guided-web-smoke-${normalizeId(options.runId)}.html`,
  );
  const summaryFile = path.join(
    options.reportsRoot,
    `installed-user-guided-web-smoke-${normalizeId(options.runId)}.json`,
  );
  const domSnapshotFile = path.join(
    options.reportsRoot,
    `installed-user-guided-web-smoke-dom-${normalizeId(options.runId)}.json`,
  );
  const accessibilitySummaryFile = path.join(
    options.reportsRoot,
    `installed-user-guided-web-smoke-accessibility-${normalizeId(options.runId)}.json`,
  );
  const visualSnapshotFile = path.join(
    options.reportsRoot,
    `installed-user-guided-web-smoke-visual-guardrail-${normalizeId(options.runId)}.json`,
  );
  const browserTaskProofRequestFile = path.join(
    options.reportsRoot,
    `installed-user-guided-browser-task-proof-request-${normalizeId(options.runId)}.json`,
  );
  const browserTaskProofFile = path.join(
    options.reportsRoot,
    `installed-user-guided-browser-task-proof-${normalizeId(options.runId)}.json`,
  );
  const result = spawnSync(
    options.aorLaunch.command,
    [
      ...options.aorLaunch.argsPrefix,
      "app",
      "--project-ref",
      ".",
      ...(asNonEmptyString(options.projectProfileFile)
        ? ["--project-profile", asNonEmptyString(options.projectProfileFile)]
        : []),
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
    throw new Error(`Guided web smoke failed: ${(result.stderr ?? result.stdout ?? "").trim()}`);
  }
  /** @type {Record<string, unknown>} */
  let summary;
  try {
    summary = asRecord(JSON.parse(result.stdout));
  } catch {
    throw new Error("Guided web smoke did not emit JSON summary.");
  }
  const taskPassed =
    asNonEmptyString(summary.status) === "smoke-pass" &&
    summary.html_loaded === true &&
    summary.flow_selector_loaded === true &&
    summary.new_flow_action_loaded === true &&
    summary.first_run_wizard_loaded === true &&
    summary.project_switcher_loaded === true &&
    asNonEmptyString(summary.config_project_id) === asNonEmptyString(summary.project_id) &&
    asNonEmptyString(summary.config_default_project_id) === asNonEmptyString(summary.project_id) &&
    asNonEmptyString(summary.project_index_default_project_id) === asNonEmptyString(summary.project_id) &&
    asNonEmptyString(summary.state_project_id) === asNonEmptyString(summary.project_id);
  const browserTaskAppSurface = taskPassed
    ? startGuidedBrowserTaskAppSurface({
        aorLaunch: options.aorLaunch,
        targetCheckoutRoot: options.targetCheckoutRoot,
        runId: options.runId,
        reportsRoot: options.reportsRoot,
        env: options.env,
        projectProfileFile: options.projectProfileFile,
      })
    : {
        kind: "guided-browser-task-app-surface",
        status: "not_started",
        reason: "Guided web smoke did not pass; browser-task proof surface was not started.",
      };
  const browserTaskAppUrl = asNonEmptyString(browserTaskAppSurface.app_url) || null;
  const browserTaskControlPlane = asNonEmptyString(browserTaskAppSurface.control_plane) || null;
  writeJson(browserTaskProofRequestFile, {
    request_id: `${options.runId}.guided-browser-task-proof-request.v1`,
    run_id: options.runId,
    expected_browser_task_proof_file: browserTaskProofFile,
    expected_rendered_html_file: outputHtml,
    expected_dom_snapshot_file: domSnapshotFile,
    expected_accessibility_summary_file: accessibilitySummaryFile,
    expected_visual_guardrail_file: visualSnapshotFile,
    rendered_html_file: outputHtml,
    dom_snapshot_file: domSnapshotFile,
    accessibility_summary_file: accessibilitySummaryFile,
    visual_guardrail_file: visualSnapshotFile,
    evidence_refs: uniqueStrings([outputHtml, domSnapshotFile, accessibilitySummaryFile, visualSnapshotFile]),
    required_surface: "installed-user local AOR app",
    required_evidence: [
      "rendered HTML",
      "DOM snapshot",
      "accessibility summary",
      "screenshot or visual guardrail",
      "AOR operator task success",
      "AOR flow navigation and next action clarity",
      "AOR blocker, error, recovery, loading, empty, and state-feedback findings",
      "AOR visual stability and responsive-state findings",
      "AOR accessibility findings",
      "browser-task proof ref",
    ],
    required_accessibility_checks: AOR_OPERATOR_ACCESSIBILITY_CHECK_IDS,
    assessment_scope:
      "AOR operator and installed-user UI/UX only; checked-repository frontend behavior belongs to implementation and verification evidence.",
    instructions: [
      "Open app_url, not smoke_app_url. smoke_app_url is the short-lived deterministic render guardrail.",
      "Capture browser-task evidence for AOR operator task success, next-action clarity, recovery/error states, responsive stability, and each required_accessibility_checks entry.",
      "Write the completed proof to expected_browser_task_proof_file before accepting the learning operator decision.",
    ],
    app_url: browserTaskAppUrl,
    control_plane: browserTaskControlPlane,
    smoke_app_url: asNonEmptyString(summary.app_url) || null,
    smoke_control_plane: asNonEmptyString(summary.control_plane) || null,
    app_server_status: asNonEmptyString(browserTaskAppSurface.status) || "unknown",
    app_server_pid: browserTaskAppSurface.pid ?? null,
    app_server_stdout_file: asNonEmptyString(browserTaskAppSurface.stdout_file) || null,
    app_server_stderr_file: asNonEmptyString(browserTaskAppSurface.stderr_file) || null,
    app_server_launch_summary: browserTaskAppSurface,
    project_id: asNonEmptyString(summary.project_id) || null,
    created_at: nowIso(),
  });
  fs.writeFileSync(
    outputHtml,
    [
      "<!doctype html>",
      "<html>",
      "<head><meta charset=\"utf-8\"><title>AOR Guided Web Smoke Evidence</title></head>",
      "<body>",
      "<h1>AOR Guided Web Smoke Evidence</h1>",
      `<pre>${JSON.stringify(summary, null, 2).replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[char])}</pre>`,
      "</body>",
      "</html>",
      "",
    ].join("\n"),
    "utf8",
  );
  writeJson(domSnapshotFile, {
    kind: "app-smoke-dom-summary",
    status: taskPassed ? "pass" : "not_pass",
    html_loaded: summary.html_loaded === true,
    flow_selector_loaded: summary.flow_selector_loaded === true,
    new_flow_action_loaded: summary.new_flow_action_loaded === true,
    first_run_wizard_loaded: summary.first_run_wizard_loaded === true,
    project_switcher_loaded: summary.project_switcher_loaded === true,
    app_url: asNonEmptyString(summary.app_url) || null,
    control_plane: asNonEmptyString(summary.control_plane) || null,
    project_id: asNonEmptyString(summary.project_id) || null,
  });
  writeJson(accessibilitySummaryFile, {
    kind: "app-smoke-accessibility-summary",
    status: taskPassed ? "pass" : "not_pass",
    checks: [
      "packaged SPA HTML loaded",
      "app config route loaded",
      "project state route loaded",
      "local project index route loaded",
      "first-run wizard bundle marker loaded",
      "project switcher bundle marker loaded",
      "flow selector bundle marker loaded",
      "New Flow bundle marker loaded",
    ],
    findings: taskPassed ? [] : ["Packaged local app smoke did not satisfy every required route check."],
  });
  writeJson(visualSnapshotFile, {
    kind: "app-smoke-visual-guardrail",
    status: taskPassed ? "warn" : "not_pass",
    surface: "aor app --smoke",
    app_url: asNonEmptyString(summary.app_url) || null,
    html_loaded: summary.html_loaded === true,
    flow_selector_loaded: summary.flow_selector_loaded === true,
    new_flow_action_loaded: summary.new_flow_action_loaded === true,
    first_run_wizard_loaded: summary.first_run_wizard_loaded === true,
    project_switcher_loaded: summary.project_switcher_loaded === true,
    note:
      "This deterministic app-smoke summary is a guardrail only; it is not browser-task-proof screenshot evidence.",
  });
  const browserTaskProof = fileExists(browserTaskProofFile) ? asRecord(readJson(browserTaskProofFile)) : {};
  const browserTaskOutcome = asRecord(browserTaskProof.task_outcome);
  const browserTaskStatus =
    asNonEmptyString(browserTaskOutcome.status) ||
    asNonEmptyString(browserTaskProof.status);
  const browserTaskScreenshotFiles = uniqueStrings([
    ...asStringArray(browserTaskProof.screenshot_files),
    ...asStringArray(browserTaskProof.screenshot_refs),
  ]);
  const browserTaskFindings =
    Object.keys(browserTaskProof).length > 0
      ? uniqueStrings([
          ...asStringArray(browserTaskProof.ux_findings),
          ...asStringArray(browserTaskOutcome.findings),
        ])
      : [
          `browser-task-proof requires skill-agent browser evidence at ${browserTaskProofFile}; deterministic app smoke is only a guardrail.`,
        ];
  const browserTaskPass =
    Object.keys(browserTaskProof).length > 0 &&
    taskPassed &&
    (browserTaskStatus === "pass" || browserTaskStatus === "warn") &&
    (browserTaskScreenshotFiles.length > 0 || asNonEmptyString(browserTaskProof.visual_guardrail_file));
  summary.summary_file = summaryFile;
  summary.rendered_html_file =
    asNonEmptyString(browserTaskProof.rendered_html_file) ||
    asNonEmptyString(browserTaskProof.html_ref) ||
    asNonEmptyString(summary.rendered_html_file) ||
    outputHtml;
  summary.command = "aor app --smoke true --open false --json";
  summary.browser_evidence_mode = browserTaskPass ? "browser-task-proof" : "browser-task-proof-required";
  summary.html_ref = summary.rendered_html_file;
  summary.dom_snapshot_file =
    asNonEmptyString(browserTaskProof.dom_snapshot_file) ||
    asNonEmptyString(browserTaskProof.dom_snapshot_ref) ||
    domSnapshotFile;
  summary.accessibility_summary_file =
    asNonEmptyString(browserTaskProof.accessibility_summary_file) ||
    asNonEmptyString(browserTaskProof.accessibility_summary_ref) ||
    accessibilitySummaryFile;
  summary.visual_guardrail_file = visualSnapshotFile;
  summary.browser_task_proof_request_file = browserTaskProofRequestFile;
  summary.browser_task_proof_file = Object.keys(browserTaskProof).length > 0 ? browserTaskProofFile : null;
  summary.browser_task_app_url = browserTaskAppUrl;
  summary.browser_task_control_plane = browserTaskControlPlane;
  summary.browser_task_app_server_status = asNonEmptyString(browserTaskAppSurface.status) || "unknown";
  summary.browser_task_app_server_pid = browserTaskAppSurface.pid ?? null;
  summary.browser_task_app_server_stdout_file = asNonEmptyString(browserTaskAppSurface.stdout_file) || null;
  summary.browser_task_app_server_stderr_file = asNonEmptyString(browserTaskAppSurface.stderr_file) || null;
  summary.screenshot_files = browserTaskScreenshotFiles;
  summary.dom_snapshot_ref = summary.dom_snapshot_file;
  summary.accessibility_summary_ref = summary.accessibility_summary_file;
  summary.screenshot_refs = browserTaskScreenshotFiles;
  summary.operator_decision_ref = asNonEmptyString(browserTaskProof.operator_decision_ref) || null;
  summary.detached = true;
  summary.guided_lifecycle_state = asNonEmptyString(summary.status) || null;
  summary.guided_current_stage_id = "learning";
  summary.task_outcome = {
    status: browserTaskPass ? "pass" : "not_pass",
    checked_tasks: uniqueStrings([
      "packaged app HTML smoke",
      "config route smoke",
      "project state route smoke",
      "browser-task evidence capture",
      "operator task interaction",
      ...asStringArray(browserTaskOutcome.checked_tasks),
    ]),
    findings: taskPassed
      ? browserTaskFindings
      : ["Guided app smoke failed one or more route checks.", ...browserTaskFindings],
  };
  summary.ux_findings =
    taskPassed
      ? browserTaskFindings
      : ["Installed-user local app smoke did not pass.", ...browserTaskFindings];
  writeJson(summaryFile, summary);
  return {
    summaryFile,
    htmlFile: summary.rendered_html_file,
    domSnapshotFile: summary.dom_snapshot_file,
    accessibilitySummaryFile: summary.accessibility_summary_file,
    screenshotFiles: browserTaskScreenshotFiles,
    visualGuardrailFile: visualSnapshotFile,
    browserTaskProofRequestFile,
    browserTaskProofFile: Object.keys(browserTaskProof).length > 0 ? browserTaskProofFile : null,
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
 * @param {{ existingStageStatus?: unknown, runtimeHarnessDecision?: unknown }} options
 * @returns {"pass" | "warn" | "fail"}
 */
export function resolveExecutionStageStatusForRuntimeHarnessDecision(options) {
  if (asNonEmptyString(options.existingStageStatus) === "fail") return "fail";
  const runtimeHarnessStageStatus = normalizeRuntimeHarnessDecisionStatus(options.runtimeHarnessDecision);
  if (runtimeHarnessStageStatus === "pass") return "pass";
  if (runtimeHarnessStageStatus === "warn") return "warn";
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
 * @param {unknown} value
 * @returns {number | null}
 */
function positiveIntegerOrNull(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? Math.floor(numberValue) : null;
}

/**
 * @param {Record<string, unknown>} profile
 * @returns {number | null}
 */
function resolveLiveE2eTargetCommandTimeoutMs(profile) {
  const livePolicy = asRecord(profile.live_e2e);
  const verification = asRecord(profile.verification);
  const timeoutSec =
    positiveIntegerOrNull(livePolicy.target_command_timeout_sec) ??
    positiveIntegerOrNull(verification.command_timeout_sec);
  return timeoutSec === null ? null : timeoutSec * 1000;
}

/**
 * @param {{ profile: Record<string, unknown>, setupCommands: string[], verificationCommands: string[] }} options
 * @returns {number | null}
 */
function resolveProjectVerifyPreflightTimeoutMs(options) {
  const perCommandTimeoutMs = resolveLiveE2eTargetCommandTimeoutMs(options.profile);
  if (perCommandTimeoutMs === null) return null;
  const commandCount = Math.max(1, options.setupCommands.length + options.verificationCommands.length);
  return Math.max(
    MIN_LIVE_E2E_AOR_COMMAND_TIMEOUT_MS,
    perCommandTimeoutMs * commandCount + LIVE_E2E_AOR_COMMAND_TIMEOUT_OVERHEAD_MS,
  );
}

/**
 * @param {Record<string, unknown>} stepResult
 * @param {Set<string>} setupCommandSet
 * @param {Set<string>} verificationCommandSet
 * @returns {"target_setup" | "target_verification"}
 */
function resolveTargetFailurePhase(stepResult, setupCommandSet, verificationCommandSet) {
  const command = asNonEmptyString(stepResult.command);
  if (command && setupCommandSet.has(command)) return "target_setup";
  if (command && verificationCommandSet.has(command)) return "target_verification";
  const commandKind = asNonEmptyString(stepResult.command_kind);
  if (commandKind === "lint" || commandKind === "setup") return "target_setup";
  return "target_verification";
}

/**
 * @param {Record<string, unknown>} stepResult
 * @returns {string}
 */
function targetFailureTextCorpus(stepResult) {
  const outputExcerpt = asRecord(stepResult.output_excerpt);
  return [
    stepResult.command,
    stepResult.summary,
    stepResult.error,
    stepResult.error_code,
    stepResult.stderr,
    stepResult.stdout,
    outputExcerpt.stdout_tail,
    outputExcerpt.stderr_tail,
  ]
    .map((value) => asNonEmptyString(value))
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
}

/**
 * @param {Record<string, unknown>} stepResult
 * @returns {string | null}
 */
function resolveTargetEnvironmentFailureClass(stepResult) {
  const corpus = targetFailureTextCorpus(stepResult);
  if (
    corpus.includes("enospc") ||
    corpus.includes("no space left on device") ||
    corpus.includes("disk quota exceeded") ||
    corpus.includes("insufficient disk space") ||
    corpus.includes("not enough space")
  ) {
    return "environment_disk_space_exhausted";
  }
  return null;
}

/**
 * @param {Record<string, unknown>} stepResult
 * @returns {"environment" | "target_repository"}
 */
function resolveTargetFailureOwner(stepResult) {
  return resolveTargetEnvironmentFailureClass(stepResult) || asStringArray(stepResult.missing_prerequisites).length > 0
    ? "environment"
    : "target_repository";
}

/**
 * @param {Record<string, unknown>} stepResult
 * @param {"target_setup" | "target_verification"} phase
 * @returns {string}
 */
function resolveTargetFailureClass(stepResult, phase) {
  return resolveTargetEnvironmentFailureClass(stepResult) ??
    (phase === "target_setup" ? "target_setup_blocked" : "target_verification_blocked");
}

/**
 * @param {{
 *   stepResult: Record<string, unknown>,
 *   stepResultFile: string,
 *   setupCommandSet: Set<string>,
 *   verificationCommandSet: Set<string>,
 * }} options
 */
function describeTargetCommandFailure(options) {
  const phase = resolveTargetFailurePhase(options.stepResult, options.setupCommandSet, options.verificationCommandSet);
  const owner = resolveTargetFailureOwner(options.stepResult);
  const failureClass = resolveTargetFailureClass(options.stepResult, phase);
  const command = asNonEmptyString(options.stepResult.command) || null;
  const summary = asNonEmptyString(options.stepResult.summary) || "Target command failed.";
  const evidenceRefs = uniqueStrings([options.stepResultFile, ...asStringArray(options.stepResult.evidence_refs)]);
  return {
    status: "blocked",
    command_label: command,
    elapsed_ms: null,
    timeout_budget_ms:
      typeof options.stepResult.command_timeout_ms === "number" ? Math.floor(options.stepResult.command_timeout_ms) : null,
    blocker_reason: summary,
    evidence_ref: evidenceRefs[0] ?? null,
    evidence_refs: evidenceRefs,
    failure_owner: owner,
    failure_phase: phase,
    failure_class: failureClass,
    provider_independent: true,
    timed_out: options.stepResult.timed_out === true,
    missing_prerequisites: asStringArray(options.stepResult.missing_prerequisites),
  };
}

/**
 * @param {{
 *   verifySummary: Record<string, unknown>,
 *   verifyPayload: Record<string, unknown>,
 *   stepResultFiles: string[],
 *   setupCommands: string[],
 *   verificationCommands: string[],
 *   baselineGateDecision?: Record<string, unknown>,
 *   runResult?: ReturnType<typeof runAorCommand> | null,
 * }} options
 */
export function buildTargetPreExecutionStatusReport(options) {
  const setupCommandSet = new Set(options.setupCommands);
  const verificationCommandSet = new Set(options.verificationCommands);
  const stepEntries = options.stepResultFiles
    .filter((filePath) => fileExists(filePath))
    .map((filePath) => ({ filePath, document: asRecord(readJson(filePath)) }));
  const failedEntries = stepEntries.filter((entry) => asNonEmptyString(entry.document.status) === "failed");
  const failedSetup = failedEntries.find(
    (entry) => resolveTargetFailurePhase(entry.document, setupCommandSet, verificationCommandSet) === "target_setup",
  );
  const failedVerification = failedEntries.find(
    (entry) => resolveTargetFailurePhase(entry.document, setupCommandSet, verificationCommandSet) === "target_verification",
  );
  const runElapsedMs =
    typeof options.runResult?.durationSec === "number" ? Math.max(0, Math.round(options.runResult.durationSec * 1000)) : null;
  const runTimeoutMs =
    typeof options.runResult?.timeoutMs === "number" ? Math.max(0, Math.floor(options.runResult.timeoutMs)) : null;
  const commandTimeoutMs =
    typeof options.verifySummary.command_timeout_ms === "number" ? Math.floor(options.verifySummary.command_timeout_ms) : null;
  const summaryRef = asNonEmptyString(options.verifyPayload.verify_summary_file);
  const transcriptRef = asNonEmptyString(options.runResult?.transcriptFile);
  const setupStatus = failedSetup
    ? describeTargetCommandFailure({
        stepResult: failedSetup.document,
        stepResultFile: failedSetup.filePath,
        setupCommandSet,
        verificationCommandSet,
      })
    : {
        status: "pass",
        command_label: options.setupCommands.at(-1) ?? null,
        elapsed_ms: runElapsedMs,
        timeout_budget_ms: commandTimeoutMs,
        blocker_reason: null,
        evidence_ref: summaryRef || transcriptRef || null,
        evidence_refs: uniqueStrings([summaryRef, transcriptRef]),
        failure_owner: null,
        failure_phase: "target_setup",
        failure_class: null,
        provider_independent: true,
        timed_out: false,
        missing_prerequisites: [],
      };
  let verificationStatus = failedVerification
    ? describeTargetCommandFailure({
        stepResult: failedVerification.document,
        stepResultFile: failedVerification.filePath,
        setupCommandSet,
        verificationCommandSet,
      })
    : failedSetup
      ? {
          status: "not_attempted",
          command_label: options.verificationCommands.at(0) ?? null,
          elapsed_ms: runElapsedMs,
          timeout_budget_ms: commandTimeoutMs,
          blocker_reason: "Target verification was not judged because target setup blocked first.",
          evidence_ref: setupStatus.evidence_ref,
          evidence_refs: asStringArray(setupStatus.evidence_refs),
          failure_owner: asNonEmptyString(setupStatus.failure_owner) || null,
          failure_phase: asNonEmptyString(setupStatus.failure_phase) || "target_setup",
          failure_class: asNonEmptyString(setupStatus.failure_class) || "target_setup_blocked",
          provider_independent: true,
          timed_out: false,
          missing_prerequisites: [],
        }
      : {
          status: asNonEmptyString(options.verifySummary.status) === "failed" ? "blocked" : "pass",
          command_label: options.verificationCommands.at(-1) ?? null,
          elapsed_ms: runElapsedMs,
          timeout_budget_ms: commandTimeoutMs,
          blocker_reason:
            asNonEmptyString(options.verifySummary.status) === "failed"
              ? asNonEmptyString(asRecord(options.baselineGateDecision).summary) || "Target verification failed."
              : null,
          evidence_ref: summaryRef || transcriptRef || null,
          evidence_refs: uniqueStrings([summaryRef, transcriptRef]),
          failure_owner: asNonEmptyString(options.verifySummary.status) === "failed" ? "target_repository" : null,
          failure_phase: "target_verification",
          failure_class:
            asNonEmptyString(options.verifySummary.status) === "failed" ? "target_verification_blocked" : null,
          provider_independent: true,
          timed_out: false,
          missing_prerequisites: [],
        };
  const baselineDecision = asNonEmptyString(asRecord(options.baselineGateDecision).decision);
  if (
    baselineDecision === "continue_with_warnings" &&
    !failedSetup &&
    asNonEmptyString(verificationStatus.status) === "blocked"
  ) {
    verificationStatus = {
      ...verificationStatus,
      status: "warn",
      warning_reason: asNonEmptyString(verificationStatus.blocker_reason) || "Baseline target verification failed.",
      blocker_reason: null,
      failure_owner: null,
      failure_class: null,
    };
  }
  const statuses = [setupStatus, verificationStatus];
  const blockingStatus =
    statuses.find((status) => asNonEmptyString(status.status) === "blocked") ??
    (options.runResult?.timedOut === true
      ? {
          status: "blocked",
          command_label: asNonEmptyString(options.runResult.label) || "project-verify-preflight",
          elapsed_ms: runElapsedMs,
          timeout_budget_ms: runTimeoutMs,
          blocker_reason: "AOR public project verify command timed out before target setup evidence was materialized.",
          evidence_ref: transcriptRef || null,
          evidence_refs: uniqueStrings([transcriptRef]),
          failure_owner: "aor",
          failure_phase: "target_verification",
          failure_class: "aor_failure",
          provider_independent: true,
          timed_out: true,
          missing_prerequisites: [],
        }
      : null);
  const warningStatus = statuses.find((status) => asNonEmptyString(status.status) === "warn");

  return {
    status: blockingStatus ? "blocked" : warningStatus ? "warn" : "pass",
    provider_independent: true,
    failure_owner: blockingStatus ? asNonEmptyString(blockingStatus.failure_owner) : null,
    failure_phase: blockingStatus ? asNonEmptyString(blockingStatus.failure_phase) : null,
    failure_class: blockingStatus ? asNonEmptyString(blockingStatus.failure_class) : null,
    blocker_reason: blockingStatus ? asNonEmptyString(blockingStatus.blocker_reason) : null,
    target_setup_status: setupStatus,
    target_verification_status: verificationStatus,
    baseline_verify_gate_decision: options.baselineGateDecision ?? null,
    verify_summary_file: summaryRef || null,
    step_result_files: options.stepResultFiles,
    command_timeout_ms: commandTimeoutMs,
    aor_command_timeout_ms: runTimeoutMs,
    elapsed_ms: runElapsedMs,
    generated_at: nowIso(),
  };
}

/**
 * @param {{ reportsRoot: string, runId: string, report: Record<string, unknown> }} options
 */
function writeTargetPreExecutionStatusReport(options) {
  const reportFile = path.join(
    options.reportsRoot,
    `live-e2e-target-pre-execution-status-${normalizeId(options.runId)}.json`,
  );
  writeJson(reportFile, options.report);
  return reportFile;
}

/**
 * @param {{ verifySummary: Record<string, unknown>, verifyPayload: Record<string, unknown>, stepResultFiles: string[], setupCommands: string[], verificationCommands: string[], mode: "diagnostic" | "blocking" }} options
 */
export function evaluateBaselineVerifyGate(options) {
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
    const environmentFailureClass = resolveTargetEnvironmentFailureClass(failedStep.document);
    failedCommands.push({
      command,
      summary,
      missing_prerequisites: missingPrerequisites,
      step_result_file: failedStep.filePath,
    });
    if (environmentFailureClass) {
      blockingReasons.push(`${environmentFailureClass}:${command || "unknown"}`);
    } else if (missingPrerequisites.length > 0) {
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
    const failedStepDocument = failedSteps.length > 0 ? failedSteps[0].document : null;
    const failedStepPhase = failedStepDocument
      ? resolveTargetFailurePhase(failedStepDocument, setupCommandSet, verificationCommandSet)
      : null;
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
      failure_owner:
        failedStepDocument
          ? resolveTargetFailureOwner(failedStepDocument)
          : blockingReasons.some((reason) => reason.startsWith("routed-dry-run"))
            ? "aor"
            : "target_repository",
      failure_phase:
        failedStepPhase
          ? failedStepPhase
          : blockingReasons.some((reason) => reason.startsWith("routed-dry-run"))
            ? "controller_decision"
            : "target_verification",
      failure_class:
        failedStepDocument && failedStepPhase
          ? resolveTargetFailureClass(failedStepDocument, failedStepPhase)
          : blockingReasons.some((reason) => reason.startsWith("routed-dry-run"))
            ? "aor_failure"
            : "target_verification_blocked",
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
      failure_owner: "target_repository",
      failure_phase: "target_verification",
      failure_class: "target_verification_blocked",
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
    failure_owner: null,
    failure_phase: null,
    failure_class: null,
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
  return featureSize === "medium" || featureSize === "large" || featureSize === "xlarge" || featureSize === "xl";
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
 * @param {string} value
 * @returns {string}
 */
function normalizeChangedPath(value) {
  return value.replace(/\\/g, "/").replace(/^\.\//u, "");
}

/**
 * @param {Record<string, unknown>} mission
 * @returns {string[]}
 */
function missionRequiredChangePathPrefixes(mission) {
  const changeEvidence = asRecord(mission.change_evidence);
  return uniqueStrings(asStringArray(changeEvidence.required_path_prefixes).map(normalizeChangedPath));
}

/**
 * @param {string} changedPath
 * @param {string} prefix
 * @returns {boolean}
 */
function changedPathMatchesRequiredPrefix(changedPath, prefix) {
  const normalizedPath = normalizeChangedPath(changedPath);
  const normalizedPrefix = normalizeChangedPath(prefix);
  if (!normalizedPrefix) return false;
  if (normalizedPrefix.endsWith("/")) {
    return normalizedPath.startsWith(normalizedPrefix);
  }
  return normalizedPath === normalizedPrefix || normalizedPath.startsWith(`${normalizedPrefix}/`);
}

/**
 * @param {string | null | undefined} reportFile
 * @returns {string[]}
 */
export function collectRuntimeHarnessChangedPaths(reportFile) {
  const resolvedReportFile = asNonEmptyString(reportFile);
  if (!resolvedReportFile || !fileExists(resolvedReportFile)) {
    return [];
  }
  const report = asRecord(readJson(resolvedReportFile));
  const stepDecisions = Array.isArray(report.step_decisions) ? report.step_decisions : [];
  return uniqueStrings(stepDecisions.flatMap((entry) => {
    const semantics = asRecord(asRecord(entry).mission_semantics);
    return [
      ...asStringArray(semantics.meaningful_changed_paths),
      ...asStringArray(semantics.non_bootstrap_changed_paths),
    ].map(normalizeChangedPath);
  }));
}

/**
 * @param {string | null | undefined} reportFile
 * @param {Record<string, unknown>} [mission]
 * @returns {boolean}
 */
export function runtimeHarnessReportHasMissionRelevantChanges(reportFile, mission = {}) {
  const changedPaths = collectRuntimeHarnessChangedPaths(reportFile);
  if (changedPaths.length === 0) {
    return false;
  }
  const requiredPrefixes = missionRequiredChangePathPrefixes(mission);
  if (requiredPrefixes.length === 0) {
    return true;
  }
  return changedPaths.some((changedPath) =>
    requiredPrefixes.some((prefix) => changedPathMatchesRequiredPrefix(changedPath, prefix)),
  );
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
 * @param {string} cwd
 * @returns {string | null}
 */
function gitHeadOrNull(cwd) {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() || null : null;
}

/**
 * @param {Record<string, unknown>} value
 * @returns {boolean}
 */
function hasObjectFields(value) {
  return Object.keys(value).length > 0;
}

/**
 * @param {string} value
 * @returns {string | null}
 */
function localJsonPath(value) {
  if (!value || value.startsWith("evidence://") || value.startsWith("packet://") || value.startsWith("compiled-context://")) {
    return null;
  }
  return value;
}

/**
 * @param {Record<string, unknown>} stepResult
 * @returns {boolean}
 */
function isExitZeroWarningOutputFailure(stepResult) {
  const summary = asNonEmptyString(stepResult.summary);
  return (
    asNonEmptyString(stepResult.status) === "failed" &&
    stepResult.exit_code === 0 &&
    /emitted warning output on stderr/iu.test(summary)
  );
}

/**
 * @param {Record<string, unknown>} summary
 * @returns {boolean}
 */
function verifySummaryFailedOnlyForWarningOutput(summary) {
  const outputQualityFailures = Array.isArray(summary.output_quality_failed_commands)
    ? summary.output_quality_failed_commands
    : [];
  const timedOutCommands = Array.isArray(summary.timed_out_commands) ? summary.timed_out_commands : [];
  const stepResultRefs = asStringArray(summary.step_result_refs);
  if (
    asNonEmptyString(summary.status) !== "failed" ||
    outputQualityFailures.length === 0 ||
    timedOutCommands.length > 0 ||
    stepResultRefs.length === 0
  ) {
    return false;
  }
  const stepResults = stepResultRefs
    .map((ref) => localJsonPath(ref))
    .filter((ref) => ref && fileExists(/** @type {string} */ (ref)))
    .map((ref) => readJson(/** @type {string} */ (ref)));
  if (stepResults.length !== stepResultRefs.length) return false;
  const failedStepResults = stepResults.filter((stepResult) => asNonEmptyString(stepResult.status) === "failed");
  return (
    failedStepResults.length === outputQualityFailures.length &&
    failedStepResults.length > 0 &&
    failedStepResults.every((stepResult) => isExitZeroWarningOutputFailure(stepResult))
  );
}

/**
 * @param {Record<string, unknown>} artifacts
 * @param {string} observedStatus
 * @returns {string}
 */
function resolveEffectiveTargetBaselineStatus(artifacts, observedStatus) {
  if (observedStatus !== "warn") return observedStatus;
  const baselineSummaryFile = localJsonPath(asNonEmptyString(artifacts.baseline_verify_summary_file));
  const postRunSummaryFile = localJsonPath(asNonEmptyString(artifacts.post_run_verify_summary_file));
  if (!baselineSummaryFile || !postRunSummaryFile || !fileExists(baselineSummaryFile) || !fileExists(postRunSummaryFile)) {
    return observedStatus;
  }
  const baselineSummary = readJson(baselineSummaryFile);
  const postRunSummary = readJson(postRunSummaryFile);
  const postRunOutputQualityFailures = Array.isArray(postRunSummary.output_quality_failed_commands)
    ? postRunSummary.output_quality_failed_commands
    : [];
  return verifySummaryFailedOnlyForWarningOutput(baselineSummary) &&
    asNonEmptyString(postRunSummary.status) === "passed" &&
    postRunOutputQualityFailures.length === 0
    ? "pass"
    : observedStatus;
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
      mission: options.mission,
      providerVariant: options.providerVariant,
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
    const hasReusablePreExecutionReadiness =
      cachedPreflightSummaryPath &&
      fileExists(cachedPreflightSummaryPath) &&
      asNonEmptyString(artifacts.target_cleanliness_before_execution_file) &&
      fileExists(asNonEmptyString(artifacts.target_cleanliness_before_execution_file));
    if (executionAlreadyObserved && !hasReusablePreExecutionReadiness) {
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
    if (!hasReusablePreExecutionReadiness) {
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
    const externalRunner = asRecord(adapterOutput.external_runner);
    artifacts.adapter_raw_evidence_ref = asNonEmptyString(externalRunner.raw_evidence_ref) || null;
    artifacts.request_artifact_ref = asNonEmptyString(externalRunner.request_artifact_ref) || null;
    artifacts.provider_work_packet_ref = asNonEmptyString(externalRunner.provider_work_packet_ref) || null;
    artifacts.context_budget_status = asNonEmptyString(externalRunner.context_budget_status) || null;
    artifacts.context_budget_failure_class = asNonEmptyString(externalRunner.context_budget_failure_class) || null;
    artifacts.raw_provider_error_summary = asNonEmptyString(externalRunner.raw_provider_error_summary) || null;
    artifacts.top_context_size_sources = Array.isArray(externalRunner.top_context_size_sources)
      ? externalRunner.top_context_size_sources
      : [];
    applyProviderExecutionFailure(artifacts, routedStepResult, adapterOutput);
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
    const resolvedVerification = {
      ...catalogVerification,
      ...asRecord(options.profile.verification),
    };
    const repoLintCommands = asStringArray(resolvedVerification.setup_commands);
    const repoVerificationCommands = asStringArray(resolvedVerification.commands);
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
        timeoutMs:
          typeof runOptions.timeoutMs === "number" && Number.isFinite(runOptions.timeoutMs)
            ? Number(runOptions.timeoutMs)
            : null,
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
      if (!result.ok && runOptions.allowFailureResult === true) {
        diagnostic.accepted_failure_result = true;
        return result;
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
      mission: options.mission,
      providerVariant: options.providerVariant,
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
      profile: options.profile,
    });
    artifacts.provider_route_override_files = providerRoutes.routeFiles;
    artifacts.provider_route_overrides = providerRoutes.routeOverrides;
    const routeOverridesFlag = serializeRouteOverrides(providerRoutes.routeOverrides);
    const providerPolicies = materializeProviderPinnedPolicyOverrides({
      policiesRoot: path.join(hostAssets.assetsRoot, "policies"),
      providerVariantId: asNonEmptyString(options.profile.provider_variant_id),
      providerVariant: options.providerVariant,
      profile: options.profile,
    });
    artifacts.provider_policy_override_files = providerPolicies.policyFiles;
    artifacts.provider_policy_overrides = providerPolicies.policyOverrides;
    const policyOverridesFlag = serializePolicyOverrides(providerPolicies.policyOverrides);
    const cachedLiveAdapterPreflight = asRecord(artifacts.live_adapter_preflight);
    const cachedLiveAdapterPreflightFile = asNonEmptyString(artifacts.live_adapter_preflight_file);
    const shouldReuseLiveAdapterPreflight =
      asNonEmptyString(cachedLiveAdapterPreflight.status) === "pass" &&
      cachedLiveAdapterPreflightFile.length > 0 &&
      fileExists(cachedLiveAdapterPreflightFile);
    const liveAdapterPreflight = shouldReuseLiveAdapterPreflight
      ? {
          status: "pass",
          summary:
            asNonEmptyString(cachedLiveAdapterPreflight.summary) ||
            "Live adapter preflight reused from earlier manual resume segment.",
          report: cachedLiveAdapterPreflight,
          reportFile: cachedLiveAdapterPreflightFile,
        }
      : runLiveAdapterPreflight({
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
    if (shouldReuseLiveAdapterPreflight) {
      artifacts.live_adapter_preflight_reused_after_resume = true;
    }
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
        ...providerPolicies.policyFiles,
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
        "--project-profile",
        generatedProfile.generatedProjectProfileFile,
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
      ...(policyOverridesFlag ? ["--policy-overrides", policyOverridesFlag] : []),
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
    const hasReusablePreExecutionReadiness =
      baselineVerifySummaryPath &&
      fileExists(baselineVerifySummaryPath) &&
      Object.keys(baselineGateDecision).length > 0 &&
      cachedTargetCleanlinessFile &&
      fileExists(cachedTargetCleanlinessFile) &&
      cachedExecutionReadinessFile &&
      fileExists(cachedExecutionReadinessFile);
    if (executionAlreadyObserved && !hasReusablePreExecutionReadiness) {
      const summary = "Observed execution cannot resume without preserved pre-execution readiness evidence.";
      markStageRaw(stageMap, "execution", "fail", [], summary);
      throw new Error(summary);
    }
    if (!hasReusablePreExecutionReadiness) {
      const verifyPreflight = runCommand(
        "project-verify-preflight",
        [
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
          ...(policyOverridesFlag ? ["--policy-overrides", policyOverridesFlag] : []),
        ],
        {
          allowFailureResult: true,
          timeoutMs: resolveProjectVerifyPreflightTimeoutMs({
            profile: options.profile,
            setupCommands: repoLintCommands,
            verificationCommands: repoVerificationCommands,
          }),
        },
      );
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
        const targetPreExecutionStatus = buildTargetPreExecutionStatusReport({
          verifySummary: {},
          verifyPayload: asRecord(verifyPreflight.payload),
          stepResultFiles: getStringArrayField(verifyPreflight.payload, "step_result_files"),
          setupCommands: repoLintCommands,
          verificationCommands: repoVerificationCommands,
          baselineGateDecision: {
            phase: "baseline_diagnostic",
            mode: resolveBaselineGateMode(options.profile),
            status: "fail",
            decision: "block",
            summary: verifyPreflight.timedOut
              ? "AOR public project verify command timed out before target setup evidence was materialized."
              : "Dry-run verify summary was not materialized.",
            blocking_reasons: [verifyPreflight.timedOut ? "aor-project-verify-timeout" : "verify-summary-missing"],
            failure_owner: "aor",
            failure_phase: "target_verification",
            failure_class: "aor_failure",
          },
          runResult: verifyPreflight,
        });
        const targetPreExecutionStatusFile = writeTargetPreExecutionStatusReport({
          reportsRoot: options.layout.reportsRoot,
          runId: options.runId,
          report: targetPreExecutionStatus,
        });
        artifacts.target_pre_execution_status_file = targetPreExecutionStatusFile;
        artifacts.target_pre_execution_status = targetPreExecutionStatus;
        artifacts.target_setup_status = targetPreExecutionStatus.target_setup_status;
        artifacts.target_verification_status_detail = targetPreExecutionStatus.target_verification_status;
        artifacts.failure_owner = targetPreExecutionStatus.failure_owner;
        artifacts.failure_phase = targetPreExecutionStatus.failure_phase;
        artifacts.failure_class = targetPreExecutionStatus.failure_class;
        markStage(
          stageMap,
          "execution",
          "fail",
          uniqueStrings([verifyPreflight.transcriptFile, targetPreExecutionStatusFile, ...collectStringRefs(verifyPreflight.payload)]),
          asNonEmptyString(targetPreExecutionStatus.blocker_reason) || "Dry-run verify summary was not materialized.",
        );
        throw new Error(asNonEmptyString(targetPreExecutionStatus.blocker_reason) || "Dry-run verify summary was not materialized.");
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
      const targetPreExecutionStatus = buildTargetPreExecutionStatusReport({
        verifySummary: asRecord(baselineVerifySummary),
        verifyPayload: asRecord(verifyPreflight.payload),
        stepResultFiles: getStringArrayField(verifyPreflight.payload, "step_result_files"),
        setupCommands: repoLintCommands,
        verificationCommands: repoVerificationCommands,
        baselineGateDecision,
        runResult: verifyPreflight,
      });
      const targetPreExecutionStatusFile = writeTargetPreExecutionStatusReport({
        reportsRoot: options.layout.reportsRoot,
        runId: options.runId,
        report: targetPreExecutionStatus,
      });
      artifacts.target_pre_execution_status_file = targetPreExecutionStatusFile;
      artifacts.target_pre_execution_status = targetPreExecutionStatus;
      artifacts.target_setup_status = targetPreExecutionStatus.target_setup_status;
      artifacts.target_verification_status_detail = targetPreExecutionStatus.target_verification_status;
      artifacts.failure_owner = targetPreExecutionStatus.failure_owner;
      artifacts.failure_phase = targetPreExecutionStatus.failure_phase;
      artifacts.failure_class = targetPreExecutionStatus.failure_class;
      artifacts.baseline_verify_status = baselineGateDecision.status;
      artifacts.baseline_verify_gate_decision = baselineGateDecision;
      if (baselineGateDecision.decision === "block") {
        markStage(
          stageMap,
          "execution",
          "fail",
          uniqueStrings([
            verifyPreflight.transcriptFile,
            targetPreExecutionStatusFile,
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
        asNonEmptyString(artifacts.target_pre_execution_status_file),
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
      ...(policyOverridesFlag ? ["--policy-overrides", policyOverridesFlag] : []),
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
      ...(policyOverridesFlag ? ["--policy-overrides", policyOverridesFlag] : []),
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
        ...(policyOverridesFlag ? ["--policy-overrides", policyOverridesFlag] : []),
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
        const adapterOutput = asRecord(asRecord(routedExecution.adapter_response).output);
        const externalRunner = asRecord(adapterOutput.external_runner);
        artifacts.adapter_raw_evidence_ref = asNonEmptyString(externalRunner.raw_evidence_ref) || null;
        artifacts.request_artifact_ref = asNonEmptyString(externalRunner.request_artifact_ref) || null;
        artifacts.provider_work_packet_ref = asNonEmptyString(externalRunner.provider_work_packet_ref) || null;
        artifacts.context_budget_status = asNonEmptyString(externalRunner.context_budget_status) || null;
        artifacts.context_budget_failure_class = asNonEmptyString(externalRunner.context_budget_failure_class) || null;
        artifacts.raw_provider_error_summary = asNonEmptyString(externalRunner.raw_provider_error_summary) || null;
        artifacts.top_context_size_sources = Array.isArray(externalRunner.top_context_size_sources)
          ? externalRunner.top_context_size_sources
          : [];
        applyProviderExecutionFailure(artifacts, stepResult, adapterOutput);
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
        ...(asNonEmptyString(artifacts.baseline_verify_summary_file)
          ? ["--output-quality-baseline", /** @type {string} */ (artifacts.baseline_verify_summary_file)]
          : []),
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
      const executionStageStatus = resolveExecutionStageStatusForRuntimeHarnessDecision({
        existingStageStatus: stageMap.execution?.status,
        runtimeHarnessDecision: artifacts.run_start_runtime_harness_decision,
      });
      const executionStageSummary =
        executionStageStatus === "fail" && runtimeHarnessStageStatus === "fail"
          ? `Runtime Harness blocked execution with decision '${asNonEmptyString(artifacts.run_start_runtime_harness_decision) || "unknown"}'.`
          : executionStageStatus === "fail"
          ? "Execution health evidence failed before post-run quality could be judged."
          : executionStageStatus === "warn"
            ? "Runtime Harness recorded execution findings; outcome quality must be assessed after the run from linked evidence."
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
      const reviewNeedsRepair = reviewOverallStatus !== "pass";
      const repairNeeded =
        (reviewNeedsRepair &&
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
      const terminalReviewFailure = !canRepair && (reviewNeedsRepair || artifacts.post_run_verify_status === "fail");
      if (terminalReviewFailure) {
        const repairLoopExhausted = implementationLoopPolicy.enabled && iteration >= implementationLoopPolicy.maxIterations;
        artifacts.failure_owner =
          asNonEmptyString(artifacts.failure_owner) ||
          (reviewNeedsRepair ? "provider" : "target_repository");
        artifacts.failure_phase =
          asNonEmptyString(artifacts.failure_phase) ||
          (reviewNeedsRepair ? "review" : "target_verification");
        artifacts.failure_class =
          asNonEmptyString(artifacts.failure_class) ||
          (repairLoopExhausted
            ? "implementation_repair_loop_exhausted"
            : reviewNeedsRepair
              ? "review_quality_not_approved"
              : "post_run_verification_failed");
        artifacts.implementation_loop_failure_summary =
          artifacts.post_run_verify_status === "fail" && reviewNeedsRepair
            ? "Implementation repair loop stopped because review did not pass and post-run verification failed."
            : reviewNeedsRepair
              ? "Implementation repair loop stopped because review did not pass."
              : "Implementation repair loop stopped because post-run verification failed.";
      }
      markStage(
        stageMap,
        "review",
        canRepair ? "warn" : terminalReviewFailure ? "fail" : "pass",
        uniqueStrings([reviewRun.transcriptFile, ...collectStringRefs(reviewRun.payload)]),
        canRepair
          ? `Review requested public repair iteration ${iteration + 1}.`
          : terminalReviewFailure
            ? asNonEmptyString(artifacts.implementation_loop_failure_summary) ||
              "Implementation review or post-run verification did not pass."
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
          reviewOverallStatus !== "pass" ||
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
    if (reviewOverallStatus !== "pass" || artifacts.post_run_verify_status === "fail") {
      throw new Error("Implementation review or post-run verification failed before delivery.");
    }
    if (guidedJourneyEnabled) {
      const guidedNextAfterReview = runCommand("guided-next-after-review", [
        "next",
        "--project-ref",
        ".",
        "--project-profile",
        generatedProfile.generatedProjectProfileFile,
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
      const cachedDiagnosticSummaryFile = asNonEmptyString(artifacts.post_run_diagnostic_verify_summary_file);
      const cachedDiagnosticSummary =
        cachedDiagnosticSummaryFile && fileExists(cachedDiagnosticSummaryFile)
          ? asRecord(readJson(cachedDiagnosticSummaryFile))
          : {};
      const shouldReuseDiagnostic = Object.keys(cachedDiagnosticSummary).length > 0;
      let postRunDiagnosticVerifyPayload = {};
      if (!shouldReuseDiagnostic) {
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
          ...(asNonEmptyString(artifacts.baseline_verify_summary_file)
            ? ["--output-quality-baseline", /** @type {string} */ (artifacts.baseline_verify_summary_file)]
            : []),
        ]);
        artifacts.post_run_diagnostic_verify_summary_file = getStringField(
          postRunDiagnosticVerify.payload,
          "verify_summary_file",
        );
        artifacts.post_run_diagnostic_verify_step_result_files = getStringArrayField(
          postRunDiagnosticVerify.payload,
          "step_result_files",
        );
        postRunDiagnosticVerifyPayload = asRecord(postRunDiagnosticVerify.payload);
      }
      const diagnosticSummaryFile = asNonEmptyString(artifacts.post_run_diagnostic_verify_summary_file);
      const diagnosticSummary =
        diagnosticSummaryFile && fileExists(diagnosticSummaryFile) ? readJson(diagnosticSummaryFile) : {};
      const diagnosticPassed = asNonEmptyString(diagnosticSummary.status) === "passed";
      artifacts.post_run_diagnostic_status = diagnosticPassed ? "pass" : postRunQualityPolicy.diagnosticFailureMode;
      const preservedDiagnostic = diagnosticSummaryFile && !shouldReuseDiagnostic
        ? preserveVerifyArtifacts({
            verifyPayload: postRunDiagnosticVerifyPayload,
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
        "--project-profile",
        generatedProfile.generatedProjectProfileFile,
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
        "--project-profile",
        generatedProfile.generatedProjectProfileFile,
        "--runtime-root",
        ".aor",
        "--json",
      ]);
      artifacts.next_action_report_file = getStringField(guidedNextAfterLearning.payload, "next_action_report_file");
      artifacts.guided_next_after_learning_transcript_file = guidedNextAfterLearning.transcriptFile;
      const firstFlowIdentity = resolveFlowIdentityFromPacket(
        targetCheckout.targetCheckoutRoot,
        artifacts.intake_artifact_packet_file,
      );
      const completedFlowArchiveFile =
        archivedNextActionReportForMission(targetCheckout.targetCheckoutRoot, firstFlowIdentity);
      const genericCompletedFlowReportFile = asNonEmptyString(artifacts.next_action_report_file);
      const archivedCompletedFlowReport = readReportDocument(completedFlowArchiveFile);
      const genericCompletedFlowReport = readReportDocument(genericCompletedFlowReportFile);
      artifacts.completed_flow_next_action_report_file =
        nextActionReportClosesFlow(archivedCompletedFlowReport)
          ? completedFlowArchiveFile
          : nextActionReportClosesFlow(genericCompletedFlowReport)
            ? genericCompletedFlowReportFile
            : completedFlowArchiveFile || genericCompletedFlowReportFile;
      const completedNextActionReport = readReportDocument(artifacts.completed_flow_next_action_report_file);
      artifacts.first_flow_id = firstFlowIdentity.flowId;
      artifacts.first_flow_status = nextActionReportClosesFlow(completedNextActionReport) ? "completed" : "active";
      artifacts.completed_flow_read_only = artifacts.first_flow_status === "completed";
      artifacts.follow_up_source_handoff_ref = asNonEmptyString(artifacts.learning_loop_handoff_file);

      const followUpMissionId = `${asNonEmptyString(firstFlowIdentity.missionId) || "guided-flow"}-follow-up-${normalizeId(options.runId)}`;
      const followUpMissionCreate = runCommand("follow-up-mission-create", buildGuidedMissionCreateArgs({
        mission: options.mission,
        featureRequest,
        profile: options.profile,
        projectProfileFile: generatedProfile.generatedProjectProfileFile,
        missionIdOverride: followUpMissionId,
        titleOverride: `${asNonEmptyString(featureRequest.requestDocument.title) || followUpMissionId} follow-up`,
        briefOverride: "Start a fresh follow-up flow from the completed learning handoff while keeping the source flow read-only.",
        deliveryModeOverride: "no-write",
        sourceRefOverride: asNonEmptyString(artifacts.learning_loop_handoff_file),
        followUpSourceHandoffRef: asNonEmptyString(artifacts.follow_up_source_handoff_ref),
      }));
      artifacts.new_flow_mission_artifact_packet_file = getStringField(followUpMissionCreate.payload, "artifact_packet_file");
      artifacts.new_flow_mission_artifact_packet_body_file = getStringField(
        followUpMissionCreate.payload,
        "artifact_packet_body_file",
      );
      artifacts.guided_follow_up_mission_create_transcript_file = followUpMissionCreate.transcriptFile;
      const secondFlowIdentity = resolveFlowIdentityFromPacket(
        targetCheckout.targetCheckoutRoot,
        artifacts.new_flow_mission_artifact_packet_file,
      );
      artifacts.second_flow_id = secondFlowIdentity.flowId;
      if (!asNonEmptyString(artifacts.second_flow_id)) {
        throw new Error("Guided follow-up mission did not materialize a second flow id.");
      }

      const guidedNextAfterFollowUp = runCommand("guided-next-after-follow-up", [
        "next",
        "--project-ref",
        ".",
        "--project-profile",
        generatedProfile.generatedProjectProfileFile,
        "--runtime-root",
        ".aor",
        "--json",
      ]);
      artifacts.new_flow_next_action_report_file = getStringField(guidedNextAfterFollowUp.payload, "next_action_report_file");
      artifacts.guided_next_after_follow_up_transcript_file = guidedNextAfterFollowUp.transcriptFile;
      if (
        !asNonEmptyString(artifacts.new_flow_mission_artifact_packet_file) ||
        !asNonEmptyString(artifacts.new_flow_next_action_report_file)
      ) {
        throw new Error("Guided follow-up flow did not materialize fresh intake and next-action evidence.");
      }

      const flowTargetedRequest = runCommand("flow-targeted-request-create", [
        "request",
        "create",
        "--project-ref",
        ".",
        "--project-profile",
        generatedProfile.generatedProjectProfileFile,
        "--runtime-root",
        ".aor",
        "--stage",
        "discovery",
        "--intent",
        "analyze",
        "--request",
        "Inspect the fresh follow-up flow evidence and confirm the next action remains no-write.",
        "--target-flow-id",
        asNonEmptyString(artifacts.second_flow_id),
        "--target-ref",
        asNonEmptyString(artifacts.new_flow_mission_artifact_packet_file),
        "--target-ref",
        asNonEmptyString(artifacts.new_flow_next_action_report_file),
        "--delivery-mode",
        "no-write",
      ]);
      artifacts.flow_targeted_operator_request_file = getStringField(flowTargetedRequest.payload, "operator_request_file");
      artifacts.flow_targeted_operator_request_ref = getStringField(flowTargetedRequest.payload, "operator_request_ref");
      artifacts.flow_targeted_operator_request_id = getStringField(flowTargetedRequest.payload, "operator_request_id");
      artifacts.flow_targeted_operator_request_target_flow_id = asNonEmptyString(artifacts.second_flow_id);
      artifacts.flow_targeted_operator_request = readOperatorRequestDocument(artifacts.flow_targeted_operator_request_file);
      artifacts.guided_flow_targeted_request_transcript_file = flowTargetedRequest.transcriptFile;

      const webSmoke = runGuidedWebSmoke({
        aorLaunch: options.aorLaunch,
        targetCheckoutRoot: targetCheckout.targetCheckoutRoot,
        runId: options.runId,
        reportsRoot: options.layout.reportsRoot,
        env,
        projectProfileFile: generatedProfile.generatedProjectProfileFile,
      });
      artifacts.guided_web_smoke_summary_file = webSmoke.summaryFile;
      artifacts.guided_web_smoke_html_file = webSmoke.htmlFile;
      artifacts.guided_web_dom_snapshot_file = webSmoke.domSnapshotFile;
      artifacts.guided_web_accessibility_summary_file = webSmoke.accessibilitySummaryFile;
      artifacts.guided_web_screenshot_files = webSmoke.screenshotFiles;
      artifacts.guided_web_visual_guardrail_file = webSmoke.visualGuardrailFile;
      artifacts.guided_browser_task_proof_request_file = webSmoke.browserTaskProofRequestFile;
      artifacts.guided_browser_task_proof_file = webSmoke.browserTaskProofFile;
      artifacts.guided_web_smoke = webSmoke.summary;
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

    const targetBaselineObservedStatus = asNonEmptyString(artifacts.baseline_verify_status) || "fail";
    const postRunVerificationStatus = asNonEmptyString(artifacts.post_run_verify_status) || "fail";
    const postRunDiagnosticStatus = asNonEmptyString(artifacts.post_run_diagnostic_status) || "pass";
    const targetBaselineStatus = resolveEffectiveTargetBaselineStatus(artifacts, targetBaselineObservedStatus);
    const runtimeHarnessReportFiles = uniqueStrings([
      asNonEmptyString(artifacts.latest_runtime_harness_report_file),
      asNonEmptyString(artifacts.delivery_runtime_harness_report_file),
      asNonEmptyString(artifacts.runtime_harness_report_file),
      asNonEmptyString(artifacts.run_start_runtime_harness_report_file),
    ]);
    const meaningfulChangedPaths = uniqueStrings(
      runtimeHarnessReportFiles.flatMap((reportFile) => collectRuntimeHarnessChangedPaths(reportFile)),
    );
    const runtimeHarnessDecision =
      asNonEmptyString(artifacts.run_start_runtime_harness_decision) ||
      asNonEmptyString(artifacts.runtime_harness_overall_decision) ||
      "unknown";
    const latestRuntimeHarnessDecision =
      asNonEmptyString(artifacts.latest_runtime_harness_decision) || runtimeHarnessDecision;
    const realCodeChangeStatus = runtimeHarnessReportFiles.some((reportFile) =>
      runtimeHarnessReportHasMissionRelevantChanges(reportFile, options.mission),
    )
      ? "pass"
      : "fail";
    const providerExecutionProofStatus = evidenceRefMaterialized(
      asNonEmptyString(artifacts.adapter_raw_evidence_ref),
      targetCheckout.targetCheckoutRoot,
    )
      ? "pass"
      : "fail";
    artifacts.real_code_change_status = realCodeChangeStatus;
    artifacts.meaningful_changed_paths = meaningfulChangedPaths;
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
    const releaseRequired = options.scenarioPolicy.release_required === true;
    const releaseMaterializationStatus =
      releaseRequired || asRecord(options.profile.output_policy).materialize_release_packet === true
        ? asNonEmptyString(artifacts.release_status) === "pass" && artifacts.release_packet_file
          ? "materialized"
          : "missing"
        : "not_required";
    const learningLoopMaterializationStatus =
      artifacts.learning_loop_scorecard_file && artifacts.learning_loop_handoff_file && auditPayload.run_audit_records
        ? "materialized"
        : "missing";
    const commandCompletionStatus =
      commandResults.length > 0 && commandResults.every((entry) => commandCompletedForRun(entry))
        ? "pass"
        : "fail";
    const stageCompletionStatus = flattenStageMap(stageMap).some((entry) => asNonEmptyString(entry.status) === "fail")
      ? "fail"
      : "pass";
    artifacts.full_flow_facts = {
      scenario_family: asNonEmptyString(options.profile.scenario_family) || null,
      provider_variant_id: asNonEmptyString(options.profile.provider_variant_id) || null,
      feature_size: options.featureSize,
      run_tier: asNonEmptyString(artifacts.run_tier) || resolveRunTier(options.profile),
      command_completion_status: commandCompletionStatus,
      stage_completion_status: stageCompletionStatus,
      provider_execution_status: providerExecutionProofStatus,
      target_baseline_observed_status: targetBaselineObservedStatus,
      target_baseline_status: targetBaselineStatus,
      post_run_verification_status: postRunVerificationStatus,
      post_run_diagnostic_status: postRunDiagnosticStatus,
      review_overall_status: reviewOverallStatus,
      feature_size_fit_status: featureSizeFitStatus,
      real_code_change_status: realCodeChangeStatus,
      meaningful_changed_paths: meaningfulChangedPaths,
      runtime_harness_decision: runtimeHarnessDecision,
      run_start_runtime_harness_decision: runtimeHarnessDecision,
      latest_runtime_harness_decision: latestRuntimeHarnessDecision,
      artifact_consistency_status: artifactConsistency.status,
      scenario_coverage_state: scenarioCoverage.status,
      delivery_blocking: artifacts.delivery_blocking === true,
      delivery_manifest_file: asNonEmptyString(artifacts.delivery_manifest_file) || null,
      release_required: releaseRequired,
      release_materialization_status: releaseMaterializationStatus,
      learning_loop_materialization_status: learningLoopMaterializationStatus,
    };
    const flowStatus = commandCompletionStatus === "pass" && stageCompletionStatus === "pass" ? "pass" : "fail";

    return {
      startedAt,
      finishedAt: nowIso(),
      status: flowStatus,
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
