import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  classifyExternalRunnerFailure,
  resolveExternalRuntimeEnvironment,
  resolveExternalRuntimeNativeTimeoutArgs,
  runExternalRuntimeProcessSync,
  resolveExternalRuntimeExecutionRoot,
  resolveExternalRuntimePermissionPolicy,
} from "../../../packages/adapter-sdk/src/index.mjs";
import { loadContractFile } from "../../../packages/contracts/src/index.mjs";

import {
  asNonEmptyString,
  asPositiveInteger,
  asRecord,
  fileExists,
  normalizeId,
  nowIso,
  stdoutHasStructuredPermissionDenials,
  writeJson,
} from "./common.mjs";

/**
 * @param {Record<string, unknown>} profile
 * @returns {boolean}
 */
export function resolveAuthProbeRequired(profile) {
  const liveAdapterPreflight = asRecord(profile.live_adapter_preflight);
  const liveExecution = asRecord(profile.live_execution);
  const internalPolicy = asRecord(profile.internal_policy);
  return (
    liveAdapterPreflight.auth_probe_required !== false &&
    liveExecution.auth_probe_required !== false &&
    internalPolicy.auth_probe_required !== false
  );
}

/**
 * @param {string} command
 * @param {NodeJS.ProcessEnv} env
 * @param {string} cwd
 * @returns {string | null}
 */
function resolveCommandForPreflight(command, env, cwd) {
  if (path.isAbsolute(command)) {
    try {
      fs.accessSync(command, fs.constants.X_OK);
      return command;
    } catch {
      return null;
    }
  }

  if (command.includes("/") || command.includes("\\")) {
    const candidate = path.resolve(cwd, command);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      return null;
    }
  }

  const pathValue = env.PATH ?? process.env.PATH ?? "";
  for (const dirPath of pathValue.split(path.delimiter).filter((entry) => entry.length > 0)) {
    const candidate = path.join(dirPath, command);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // Keep searching PATH.
    }
  }
  return null;
}

/**
 * @param {Record<string, unknown>} externalRuntime
 * @returns {string}
 */
function resolvePreflightRequestTransport(externalRuntime) {
  const configuredTransport = asNonEmptyString(externalRuntime.request_transport);
  if (configuredTransport) {
    return configuredTransport;
  }
  return externalRuntime.request_via_stdin === false ? "none" : "stdin-json";
}

/**
 * @param {{
 *   targetCheckoutRoot: string,
 *   adapterProfileRoot?: string,
 *   providerVariant: Record<string, unknown>,
 *   providerVariantId: string,
 *   coverageTier: string,
 *   env: NodeJS.ProcessEnv,
 *   runnerAuthMode: string,
 *   runnerAuthSource: string,
 *   runtimeAgentPermissionMode: string,
 *   runtimeAgentInteractionPolicy?: string,
 *   runtimeAgentAutoApprovalProfile?: string,
 *   authProbeRequired: boolean,
 *   permissionReadinessRequired?: boolean,
 *   runId: string,
 *   reportsRoot: string,
 * }} options
 * @returns {{ status: string, summary: string, report: Record<string, unknown>, reportFile: string }}
 */
export function runLiveAdapterPreflight(options) {
  const adapterId = asNonEmptyString(options.providerVariant.primary_adapter);
  const provider = asNonEmptyString(options.providerVariant.provider);
  const providerCoverageTier = asNonEmptyString(options.providerVariant.coverage_tier);
  const requiredProvider = options.coverageTier === "required" || providerCoverageTier === "required";
  const editAndPermissionReadinessRequired = requiredProvider || options.permissionReadinessRequired === true;
  const adapterProfileRoot =
    asNonEmptyString(options.adapterProfileRoot) || path.join(options.targetCheckoutRoot, "examples", "adapters");
  const adapterProfileFile = path.join(adapterProfileRoot, `${normalizeId(adapterId)}.yaml`);
  const reportFile = path.join(
    options.reportsRoot,
    `live-adapter-preflight-${normalizeId(options.runId)}-${normalizeId(options.providerVariantId)}.json`,
  );
  const baseReport = {
    status: "pass",
    run_id: options.runId,
    provider_variant_id: options.providerVariantId,
    provider,
    primary_adapter: adapterId || null,
    coverage_tier: options.coverageTier,
    provider_coverage_tier: providerCoverageTier || null,
    required_provider: requiredProvider,
    runner_auth_mode: options.runnerAuthMode,
    runner_auth_source: options.runnerAuthSource,
    runtime_agent_permission_mode: options.runtimeAgentPermissionMode,
    runtime_agent_interaction_policy: options.runtimeAgentInteractionPolicy ?? "fail-closed",
    runtime_agent_auto_approval_profile: options.runtimeAgentAutoApprovalProfile ?? "none",
    adapter_profile_file: adapterProfileFile,
    auth_probe: {
      enabled: options.authProbeRequired,
      status: options.authProbeRequired ? "pending" : "skipped",
      attempts: [],
    },
    edit_readiness: {
      enabled: false,
      status: "not_required",
    },
    permission_readiness: {
      enabled: false,
      status: "not_required",
    },
    checked_at: nowIso(),
  };
  const fail = (failureKind, summary, extra = {}) => {
    const report = {
      ...baseReport,
      ...extra,
      status: "fail",
      failure_kind: failureKind,
      summary,
    };
    writeJson(reportFile, report);
    return {
      status: "fail",
      summary,
      report,
      reportFile,
    };
  };
  const interactionRequired = (failureKind, summary, extra = {}) => {
    const report = {
      ...baseReport,
      ...extra,
      status: "interaction_required",
      failure_kind: failureKind,
      summary,
    };
    writeJson(reportFile, report);
    return {
      status: "interaction_required",
      summary,
      report,
      reportFile,
    };
  };

  if (!adapterId) {
    return fail("missing-live-runtime", `Provider variant '${options.providerVariantId}' does not declare primary_adapter.`);
  }
  if (!fileExists(adapterProfileFile)) {
    return fail(
      "missing-live-runtime",
      `Provider variant '${options.providerVariantId}' references adapter '${adapterId}', but its adapter profile was not found.`,
    );
  }

  const loaded = loadContractFile({
    filePath: adapterProfileFile,
    family: "adapter-capability-profile",
  });
  if (!loaded.ok) {
    const issues = loaded.validation.issues.map((issue) => issue.message).join("; ");
    return fail("missing-live-runtime", `Adapter profile '${adapterId}' failed contract validation: ${issues}`);
  }

  const adapterProfile = asRecord(loaded.document);
  const execution = asRecord(adapterProfile.execution);
  const externalRuntime = asRecord(execution.external_runtime);
  const runtimeMode = asNonEmptyString(execution.runtime_mode);
  const liveBaseline = execution.live_baseline === true;
  const runtimeCommand = asNonEmptyString(externalRuntime.command);
  const timeoutMs = asPositiveInteger(externalRuntime.timeout_ms, 30000);
  const probeTimeoutMs = asPositiveInteger(externalRuntime.preflight_timeout_ms, Math.min(timeoutMs, 120000));
  const requestTransport = resolvePreflightRequestTransport(externalRuntime);
  const runtimeEnvironment = resolveExternalRuntimeEnvironment({
    externalRuntime,
    baseEnv: options.env,
  });
  const runnerEnv = runtimeEnvironment.env;
  const requestedPermissionMode =
    asNonEmptyString(runnerEnv.AOR_RUNTIME_AGENT_PERMISSION_MODE) || options.runtimeAgentPermissionMode;
  const runtimeInvocation = resolveExternalRuntimePermissionPolicy({
    externalRuntime,
    requestedMode: requestedPermissionMode,
  });
  const runtimeReport = {
    runtime_mode: runtimeMode || null,
    live_baseline: liveBaseline,
    external_runtime: {
      command: runtimeCommand || null,
      args: runtimeInvocation.args,
      timeout_ms: timeoutMs,
      preflight_timeout_ms: probeTimeoutMs,
      auth_probe_timeout_ms: probeTimeoutMs,
      request_transport: requestTransport,
      permission_mode: runtimeInvocation.permissionMode,
      permission_mode_source: runtimeInvocation.source,
      env_from_applied: runtimeEnvironment.applied,
      env_from_missing: runtimeEnvironment.missing,
      native_timeout_args: resolveExternalRuntimeNativeTimeoutArgs({
        externalRuntime,
        timeoutMs: probeTimeoutMs,
      }),
    },
  };

  if (runtimeMode !== "external-process") {
    return fail(
      "missing-live-runtime",
      `Adapter '${adapterId}' live runtime is misconfigured: execution.runtime_mode must be 'external-process'.`,
      runtimeReport,
    );
  }
  if (!runtimeCommand) {
    return fail(
      "missing-live-runtime",
      `Adapter '${adapterId}' live runtime is missing execution.external_runtime.command.`,
      runtimeReport,
    );
  }
  if (!runtimeInvocation.ok) {
    return fail(
      runtimeInvocation.failureKind,
      `Adapter '${adapterId}' live runtime permission policy is invalid: ${runtimeInvocation.message}`,
      runtimeReport,
    );
  }
  if (!["request-artifact", "stdin-json", "file-attachment", "argv-json", "none"].includes(requestTransport)) {
    return fail(
      "request-transport-invalid",
      `Adapter '${adapterId}' live runtime request transport '${requestTransport}' is not supported.`,
      runtimeReport,
    );
  }
  if (requiredProvider && runtimeInvocation.permissionMode !== requestedPermissionMode) {
    return fail(
      "permission-policy-invalid",
      `Adapter '${adapterId}' did not report selected runtime-agent permission mode '${requestedPermissionMode}'.`,
      runtimeReport,
    );
  }
  if (requiredProvider && !liveBaseline) {
    return fail(
      "missing-live-runtime",
      `Required provider variant '${options.providerVariantId}' points at adapter '${adapterId}', but execution.live_baseline is not true.`,
      runtimeReport,
    );
  }

  let executionRootBinding;
  try {
    executionRootBinding = resolveExternalRuntimeExecutionRoot({
      externalRuntime,
      executionRoot: options.targetCheckoutRoot,
    });
  } catch (error) {
    return fail(
      "execution-root-alias-failed",
      `Adapter '${adapterId}' live runtime could not prepare its execution root: ${
        error instanceof Error ? error.message : String(error)
      }`,
      runtimeReport,
    );
  }

  runtimeReport.external_runtime.execution_root = executionRootBinding.executionRoot;
  runtimeReport.external_runtime.execution_root_mode = executionRootBinding.mode;
  runtimeReport.external_runtime.canonical_execution_root = executionRootBinding.canonicalExecutionRoot;

  const resolvedCommand = resolveCommandForPreflight(runtimeCommand, runnerEnv, executionRootBinding.executionRoot);
  if (!resolvedCommand) {
    return fail(
      "missing-command",
      `External runner command '${runtimeCommand}' is not available on PATH for adapter '${adapterId}'.`,
      runtimeReport,
    );
  }

  const permissionProbeRoot = path.join(
    executionRootBinding.executionRoot,
    ".aor",
    "live-e2e-preflight",
    normalizeId(options.runId),
  );
  const permissionNonceFile = path.join(permissionProbeRoot, "permission-nonce.txt");
  const permissionMarkerFile = path.join(permissionProbeRoot, "permission-marker.txt");
  const permissionMarkerContents = `permission-readiness:${options.runId}`;

  const buildProbeInput = (stepClass, objective, extraRequest = {}) => `${JSON.stringify({
    request: {
      request_id: `live-adapter-preflight.${stepClass}`,
      run_id: options.runId,
      step_id: `live-adapter-preflight.${stepClass}`,
      step_class: stepClass,
      objective,
      non_interactive: true,
      ...extraRequest,
    },
    adapter: {
      adapter_id: adapterId,
      provider_variant_id: options.providerVariantId,
      permission_mode: runtimeInvocation.permissionMode,
    },
  })}\n`;
  const runProbeAttempt = (kind, attempt, objective, extraRequest = {}) => {
    const probeInput = buildProbeInput(kind, objective, extraRequest);
    let probeArgs = [
      ...runtimeInvocation.args,
      ...resolveExternalRuntimeNativeTimeoutArgs({
        externalRuntime,
        timeoutMs: probeTimeoutMs,
      }),
    ];
    let probeStdin = undefined;
    if (requestTransport === "stdin-json") {
      probeStdin = probeInput;
    } else if (requestTransport === "argv-json") {
      probeArgs = [...probeArgs, probeInput.trim()];
    } else if (requestTransport === "request-artifact") {
      const requestFileProfile = asRecord(externalRuntime.request_file);
      const requestFileArgument = asNonEmptyString(requestFileProfile.argument);
      fs.mkdirSync(permissionProbeRoot, { recursive: true });
      const requestFile = path.join(permissionProbeRoot, `preflight-${normalizeId(kind)}-${attempt}-work-packet.json`);
      fs.writeFileSync(requestFile, probeInput, "utf8");
      const requestMessageTemplate =
        asNonEmptyString(requestFileProfile.message) ??
        "Execute the approved AOR implementation using the provider work packet at {provider_work_packet_path}. Read it first, open every required resolved_local_refs[].local_path, make direct edits in the ephemeral target checkout when required, do not write upstream, run requested verification when feasible, and return a final report with changed-files, commands-run, verification, and risks. Do not stop after summarizing the packet.";
      const requestMessage = requestMessageTemplate
        .replace(/\{provider_work_packet_path\}/gu, requestFile)
        .replace(/\{provider_work_packet_ref\}/gu, requestFile)
        .replace(/\{request_artifact_ref\}/gu, requestFile);
      probeArgs = requestFileArgument
        ? [...probeArgs, requestMessage, requestFileArgument, requestFile]
        : [...probeArgs, requestMessage];
    } else if (requestTransport === "file-attachment") {
      const requestFileProfile = asRecord(externalRuntime.request_file);
      const requestMessage =
        asNonEmptyString(requestFileProfile.message) ?? "Follow the attached AOR adapter request JSON.";
      const requestFileArgument = asNonEmptyString(requestFileProfile.argument) ?? "--file";
      fs.mkdirSync(permissionProbeRoot, { recursive: true });
      const requestFile = path.join(permissionProbeRoot, `preflight-${normalizeId(kind)}-${attempt}-request.json`);
      fs.writeFileSync(requestFile, probeInput, "utf8");
      probeArgs = [...probeArgs, requestMessage, requestFileArgument, requestFile];
    }
    const probe = runExternalRuntimeProcessSync({
      command: resolvedCommand,
      args: probeArgs,
      cwd: executionRootBinding.executionRoot,
      env: runnerEnv,
      input: probeStdin,
      timeout: probeTimeoutMs,
      maxBuffer: 1024 * 1024,
    });
    const probeError = probe.error instanceof Error ? probe.error : null;
    const probeTimedOut =
      probeError?.code === "ETIMEDOUT" ||
      ((probe.signal === "SIGTERM" || probe.signal === "SIGKILL") && probe.status === null);
    const commandFailed = probeError !== null || probeTimedOut || probe.status !== 0;
    const stdout = probe.stdout ?? "";
    const stderr = probe.stderr ?? "";
    const structuredFailureKind = stdoutHasStructuredPermissionDenials(stdout) ? "permission-mode-blocked" : "none";
    const semanticFailureKind =
      structuredFailureKind !== "none"
        ? structuredFailureKind
        : classifyExternalRunnerFailure({
            stdout,
            stderr,
            errorMessage: probeError?.message ?? null,
            defaultFailureKind: "none",
          });
    const commandFailureKind = classifyExternalRunnerFailure({
      stdout,
      stderr,
      errorMessage: probeError?.message ?? null,
      defaultFailureKind: "external-runner-failed",
    });
    const failureKind =
      probeError?.code === "ENOENT"
        ? "missing-command"
        : structuredFailureKind !== "none"
          ? structuredFailureKind
          : commandFailed
            ? commandFailureKind !== "external-runner-failed"
              ? commandFailureKind
              : probeTimedOut
                ? "external-runner-timeout"
                : commandFailureKind
            : semanticFailureKind === "none"
              ? null
              : semanticFailureKind;
    return {
      attempt,
      kind,
      status: failureKind ? "fail" : "pass",
      exit_code: probe.status,
      signal: probe.signal,
      timed_out: probeTimedOut,
      failure_kind: failureKind,
      error_code: probeError?.code ?? null,
      stdout_excerpt: stdout.slice(0, 4000),
      stderr_excerpt: stderr.slice(0, 4000),
    };
  };
  const authAttempts = [];
  let authProbeReport = {
    enabled: false,
    status: "skipped",
    attempts: authAttempts,
  };
  if (options.authProbeRequired) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const attemptResult = runProbeAttempt(
        "preflight",
        attempt,
        "Confirm that the external runner can authenticate and complete a minimal non-interactive invocation.",
      );
      authAttempts.push(attemptResult);
      if (attemptResult.status === "pass") {
        break;
      }
      const retryable =
        attempt === 1 &&
        ["external-runner-timeout", "auth-failed", "external-runner-failed"].includes(
          asNonEmptyString(attemptResult.failure_kind) || "",
        );
      if (!retryable) {
        break;
      }
    }
    const finalAuthAttempt = authAttempts[authAttempts.length - 1];
    if (!finalAuthAttempt || finalAuthAttempt.status !== "pass") {
      const failureKind = asNonEmptyString(finalAuthAttempt?.failure_kind) || "external-runner-failed";
      return fail(
        failureKind,
        `Live adapter preflight failed for adapter '${adapterId}' before run start.`,
        {
          ...runtimeReport,
          resolved_command: resolvedCommand,
          auth_probe: {
            enabled: true,
            status: "fail",
            attempts: authAttempts,
            exit_code: finalAuthAttempt?.exit_code ?? null,
            signal: finalAuthAttempt?.signal ?? null,
            timed_out: finalAuthAttempt?.timed_out === true,
            failure_kind: failureKind,
            error_code: finalAuthAttempt?.error_code ?? null,
          },
        },
      );
    }
    authProbeReport = {
      enabled: true,
      status: "pass",
      attempts: authAttempts,
      exit_code: finalAuthAttempt.exit_code,
      signal: finalAuthAttempt.signal,
      timed_out: false,
    };
  }

  const editReadiness = editAndPermissionReadinessRequired
    ? runProbeAttempt(
        "preflight-edit-readiness",
        1,
        "Confirm that the external runner is allowed to perform bounded non-interactive edits in this isolated target checkout. Do not ask questions.",
      )
    : null;
  if (editReadiness && editReadiness.status !== "pass") {
    const failureKind = asNonEmptyString(editReadiness.failure_kind) || "permission-mode-blocked";
    const reportPayload = {
      ...runtimeReport,
      resolved_command: resolvedCommand,
      auth_probe: authProbeReport,
      edit_readiness: {
        enabled: true,
        status: "fail",
        failure_kind: failureKind,
        attempts: [editReadiness],
      },
    };
    if (
      (options.runtimeAgentInteractionPolicy ?? "fail-closed") !== "fail-closed" &&
      (failureKind === "permission-mode-blocked" || failureKind === "edit-denied")
    ) {
      return interactionRequired(
        failureKind,
        `Live adapter preflight edit-readiness requires runtime permission interaction for adapter '${adapterId}'.`,
        reportPayload,
      );
    }
    return fail(
      failureKind,
      `Live adapter preflight failed edit-readiness for adapter '${adapterId}' before run start.`,
      reportPayload,
    );
  }

  let permissionReadiness = null;
  if (editAndPermissionReadinessRequired) {
    fs.mkdirSync(permissionProbeRoot, { recursive: true });
    fs.writeFileSync(permissionNonceFile, `${permissionMarkerContents}\n`, "utf8");
    fs.rmSync(permissionMarkerFile, { force: true });
    permissionReadiness = runProbeAttempt(
      "preflight-permission-readiness",
      1,
      [
        "Confirm that the external runner can read a nonce file and write a marker file in the isolated runtime root.",
        `Read ${permissionNonceFile}.`,
        `Write exactly '${permissionMarkerContents}' to ${permissionMarkerFile}.`,
        "Do not ask questions.",
      ].join(" "),
      {
        permission_probe: {
          nonce_file: permissionNonceFile,
          marker_file: permissionMarkerFile,
          expected_marker_contents: permissionMarkerContents,
        },
      },
    );
    const markerContents = fileExists(permissionMarkerFile)
      ? fs.readFileSync(permissionMarkerFile, "utf8").trim()
      : "";
    const markerStatus =
      markerContents === permissionMarkerContents
        ? "present"
        : markerContents
          ? "unexpected-contents"
          : "missing";
    if (
      permissionReadiness.status === "fail" &&
      permissionReadiness.failure_kind === "external-runner-timeout" &&
      markerContents === permissionMarkerContents
    ) {
      permissionReadiness = {
        ...permissionReadiness,
        status: "pass",
        failure_kind: null,
        warning_kind: "post-marker-timeout",
        warnings: [
          {
            code: "post-marker-timeout",
            summary:
              "Permission readiness marker matched before the external runner timed out; access readiness passed, but runner completion was slow.",
          },
        ],
        marker_file: permissionMarkerFile,
        marker_status: markerStatus,
      };
    } else if (permissionReadiness.status === "pass" && markerContents !== permissionMarkerContents) {
      permissionReadiness = {
        ...permissionReadiness,
        status: "fail",
        failure_kind: "permission-mode-blocked",
        marker_file: permissionMarkerFile,
        marker_status: markerStatus,
      };
    } else {
      permissionReadiness = {
        ...permissionReadiness,
        marker_file: permissionMarkerFile,
        marker_status: markerStatus,
      };
    }
  }
  if (permissionReadiness && permissionReadiness.status !== "pass") {
    const failureKind = asNonEmptyString(permissionReadiness.failure_kind) || "permission-mode-blocked";
    const reportPayload = {
      ...runtimeReport,
      resolved_command: resolvedCommand,
      auth_probe: authProbeReport,
      edit_readiness: editReadiness
        ? {
            enabled: true,
            status: "pass",
            attempts: [editReadiness],
          }
        : {
            enabled: false,
            status: "not_required",
          },
      permission_readiness: {
        enabled: true,
        status: "fail",
        failure_kind: failureKind,
        attempts: [permissionReadiness],
        nonce_file: permissionNonceFile,
        marker_file: permissionMarkerFile,
      },
    };
    if ((options.runtimeAgentInteractionPolicy ?? "fail-closed") !== "fail-closed" && failureKind === "permission-mode-blocked") {
      return interactionRequired(
        failureKind,
        `Live adapter preflight permission-readiness requires runtime permission interaction for adapter '${adapterId}'.`,
        reportPayload,
      );
    }
    return fail(
      failureKind,
      `Live adapter preflight failed permission-readiness for adapter '${adapterId}' before run start.`,
      reportPayload,
    );
  }

  const report = {
    ...baseReport,
    ...runtimeReport,
    resolved_command: resolvedCommand,
    auth_probe: authProbeReport,
    edit_readiness: editReadiness
      ? {
          enabled: true,
          status: "pass",
          attempts: [editReadiness],
        }
      : {
          enabled: false,
          status: "not_required",
        },
    permission_readiness: permissionReadiness
      ? {
          enabled: true,
          status: "pass",
          attempts: [permissionReadiness],
          nonce_file: permissionNonceFile,
          marker_file: permissionMarkerFile,
        }
      : {
          enabled: false,
          status: "not_required",
        },
    summary: `Live adapter preflight passed for provider variant '${options.providerVariantId}'.`,
  };
  writeJson(reportFile, report);
  return {
    status: "pass",
    summary: asNonEmptyString(report.summary),
    report,
    reportFile,
  };
}
