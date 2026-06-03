import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildAdapterRegistry,
  classifyExternalRunnerFailure,
  createAdapterRequestEnvelope,
  createAdapterResponseEnvelope,
  createLiveAdapter,
  createMockAdapter,
  resolveAdapterForRoute,
  resolveAdapterMatrix,
  resolveExternalRuntimeNativeTimeoutArgs,
  resolveExternalRuntimePermissionPolicy,
} from "../src/index.mjs";
import { resolveRouteForStep, resolveRouteMatrix } from "../../provider-routing/src/route-resolution.mjs";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const workspaceRoot = path.resolve(currentDir, "../../..");

/**
 * @param {(repoRoot: string) => void} callback
 */
function withTempRepo(callback) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-w2-s04-"));
  fs.mkdirSync(path.join(repoRoot, ".git"), { recursive: true });
  fs.cpSync(path.join(workspaceRoot, "examples"), path.join(repoRoot, "examples"), { recursive: true });

  try {
    callback(repoRoot);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
}

/**
 * @param {{
 *   command: string,
 *   args: string[],
 *   timeoutMs?: number,
 *   handler?: string | null,
 *   permissionPolicy?: Record<string, unknown>,
 *   requestTransport?: string,
 *   requestFile?: Record<string, unknown>,
 *   requestViaStdin?: boolean,
 *   executionRootMode?: string,
 *   env?: Record<string, string>,
 *   envFrom?: Record<string, string>,
 *   nativeTimeoutArg?: Record<string, unknown>,
 * }} options
 */
function buildExternalRunnerProfile(options) {
  const permissionArgs = options.args.length > 0 ? options.args : ["--version"];
  const execution = {
    runtime_mode: "external-process",
    evidence_namespace: "evidence://adapter-live/codex-cli",
    external_runtime: {
      command: options.command,
      request_via_stdin: options.requestViaStdin ?? true,
      timeout_ms: options.timeoutMs ?? 30000,
      permission_policy:
        options.permissionPolicy ??
        {
          default_mode: "full-bypass",
          modes: {
            "full-bypass": {
              args: permissionArgs,
            },
          },
        },
    },
  };
  if (options.requestTransport) {
    execution.external_runtime.request_transport = options.requestTransport;
  }
  if (options.requestFile) {
    execution.external_runtime.request_file = options.requestFile;
  }
  if (options.executionRootMode) {
    execution.external_runtime.execution_root_mode = options.executionRootMode;
  }
  if (options.env) {
    execution.external_runtime.env = options.env;
  }
  if (options.envFrom) {
    execution.external_runtime.env_from = options.envFrom;
  }
  if (options.nativeTimeoutArg) {
    execution.external_runtime.native_timeout_arg = options.nativeTimeoutArg;
  }
  if (options.handler !== null) {
    execution.handler = options.handler ?? "codex-cli-external-runner";
  }
  return {
    execution,
  };
}

test("buildAdapterRegistry loads adapter capability profiles through shared contracts path", () => {
  withTempRepo((repoRoot) => {
    const registry = buildAdapterRegistry({
      adaptersRoot: path.join(repoRoot, "examples/adapters"),
    });

    assert.equal(registry.size >= 3, true);
    assert.equal(registry.has("codex-cli"), true);
    assert.equal(registry.has("mock-runner"), true);
  });
});

test("resolveAdapterForRoute passes when required capabilities are declared by selected adapter", () => {
  withTempRepo((repoRoot) => {
    const routeResolution = resolveRouteForStep({
      projectProfilePath: path.join(repoRoot, "examples/project.aor.yaml"),
      routesRoot: path.join(repoRoot, "examples/routes"),
      stepClass: "implement",
    });

    const resolved = resolveAdapterForRoute({
      routeResolution,
      adaptersRoot: path.join(repoRoot, "examples/adapters"),
    });

    assert.equal(resolved.adapter.adapter_id, "codex-cli");
    assert.equal(resolved.adapter.resolution_source.kind, "route-primary");
    assert.equal(resolved.capability_check.status, "pass");
    assert.deepEqual(resolved.capability_check.missing, []);
  });
});

test("resolveAdapterForRoute fails early when route requires missing adapter capability", () => {
  withTempRepo((repoRoot) => {
    const adapterPath = path.join(repoRoot, "examples/adapters/codex-cli.yaml");
    const content = fs.readFileSync(adapterPath, "utf8");
    fs.writeFileSync(adapterPath, content.replace("live_logs: true", "live_logs: false"), "utf8");

    const routeResolution = resolveRouteForStep({
      projectProfilePath: path.join(repoRoot, "examples/project.aor.yaml"),
      routesRoot: path.join(repoRoot, "examples/routes"),
      stepClass: "implement",
    });

    assert.throws(
      () =>
        resolveAdapterForRoute({
          routeResolution,
          adaptersRoot: path.join(repoRoot, "examples/adapters"),
        }),
      /missing capabilities \[live_logs\]/i,
    );
  });
});

test("resolveAdapterMatrix validates capability negotiation for every resolved step route", () => {
  withTempRepo((repoRoot) => {
    const routeResolutionMatrix = resolveRouteMatrix({
      projectProfilePath: path.join(repoRoot, "examples/project.aor.yaml"),
      routesRoot: path.join(repoRoot, "examples/routes"),
    });

    const matrix = resolveAdapterMatrix({
      routeResolutionMatrix,
      adaptersRoot: path.join(repoRoot, "examples/adapters"),
    });

    assert.equal(matrix.length, 10);
    const discovery = matrix.find((entry) => entry.step_class === "discovery");
    assert.ok(discovery);
    assert.equal(discovery.adapter.adapter_id, "none");
    const implement = matrix.find((entry) => entry.step_class === "implement");
    assert.ok(implement);
    assert.equal(implement.adapter.adapter_id, "codex-cli");
    assert.equal(implement.capability_check.status, "pass");
  });
});

test("adapter request and response envelopes enforce stable required fields", () => {
  const request = createAdapterRequestEnvelope({
    request_id: "req-1",
    run_id: "run-1",
    step_id: "step-1",
    step_class: "implement",
    route: { resolved_route_id: "route.implement.default" },
    asset_bundle: { wrapper_ref: "wrapper.runner.default@v3" },
    policy_bundle: { policy_id: "policy.step.runner.default" },
    input_packet_refs: ["packet://handoff"],
    dry_run: true,
    provider_step_status: {
      provider: "codex",
      adapter: "codex-cli",
      route_id: "route.implement.default",
      step_id: "run.start.implement",
      status: "running",
      current_command_label: "external-provider-runner",
    },
    context: {
      compiled_context_ref: "compiled-context://compiled-context.aor-core.implement.runner-default",
      packet_refs: ["packet://handoff"],
    },
  });

  assert.equal(request.request_id, "req-1");
  assert.equal(request.dry_run, true);
  assert.deepEqual(request.input_packet_refs, ["packet://handoff"]);
  assert.equal(request.context.compiled_context_ref, "compiled-context://compiled-context.aor-core.implement.runner-default");
  assert.equal(request.provider_step_status.current_command_label, "external-provider-runner");

  const response = createAdapterResponseEnvelope({
    request_id: "req-1",
    adapter_id: "mock-runner",
    status: "success",
    summary: "ok",
    evidence_refs: ["evidence://mock-adapter/req-1"],
  });

  assert.equal(response.status, "success");
  assert.deepEqual(response.evidence_refs, ["evidence://mock-adapter/req-1"]);

  assert.throws(
    () =>
      createAdapterResponseEnvelope({
        request_id: "req-1",
        adapter_id: "mock-runner",
        status: "unknown",
        summary: "not-allowed",
      }),
    /must be one of: success, failed, blocked/i,
  );
});

test("mock adapter executes deterministic dry-run outputs for rehearsal coverage", () => {
  const mockAdapter = createMockAdapter();
  const request = {
    request_id: "req-mock-1",
    run_id: "run-mock-1",
    step_id: "step-mock-1",
    step_class: "implement",
    route: { resolved_route_id: "route.implement.default" },
    asset_bundle: { wrapper_ref: "wrapper.runner.default@v3" },
    policy_bundle: { policy_id: "policy.step.runner.default" },
    dry_run: true,
  };

  const first = mockAdapter.execute(request);
  const second = mockAdapter.execute(request);

  assert.deepEqual(first, second);
  assert.equal(first.status, "success");
  assert.equal(first.output.mode, "dry-run");
  assert.ok(first.evidence_refs[0].startsWith("evidence://mock-adapter/"));
});

test("external runtime permission policy resolves env-selected mode args before adapter defaults", () => {
  const externalRuntime = {
    permission_policy: {
      default_mode: "full-bypass",
      modes: {
        "full-bypass": {
          args: ["full"],
        },
        restricted: {
          args: ["restricted"],
        },
      },
    },
  };

  assert.deepEqual(resolveExternalRuntimePermissionPolicy({ externalRuntime, requestedMode: null }), {
    ok: true,
    args: ["full"],
    permissionMode: "full-bypass",
    source: "permission_policy.default_mode",
  });
  assert.deepEqual(resolveExternalRuntimePermissionPolicy({ externalRuntime, requestedMode: "restricted" }), {
    ok: true,
    args: ["restricted"],
    permissionMode: "restricted",
    source: "AOR_RUNTIME_AGENT_PERMISSION_MODE",
  });
  assert.deepEqual(resolveExternalRuntimePermissionPolicy({ externalRuntime: { args: ["legacy"] }, requestedMode: "restricted" }), {
    ok: false,
    args: [],
    permissionMode: "missing",
    source: "external_runtime.permission_policy",
    failureKind: "permission-policy-invalid",
    message: "External runtime permission_policy is required; legacy external_runtime.args is no longer supported.",
  });

  const invalid = resolveExternalRuntimePermissionPolicy({ externalRuntime, requestedMode: "missing" });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.permissionMode, "missing");
  assert.equal(invalid.failureKind, "permission-policy-invalid");
});

test("external runtime native timeout args are derived from the resolved request timeout", () => {
  assert.deepEqual(
    resolveExternalRuntimeNativeTimeoutArgs({
      externalRuntime: {
        native_timeout_arg: {
          flag: "--max-wall-time",
          format: "duration-seconds",
          reserve_ms: 5000,
        },
      },
      timeoutMs: 300000,
    }),
    ["--max-wall-time", "295s"],
  );
});

test("external runner failure classifier ignores benign permission words on successful output", () => {
  for (const stdout of [
    "Confirmed. Bounded non-interactive edits are allowed under the current workspace-write permissions.",
    "External runner completed under the configured workspace-write sandbox.",
    JSON.stringify({ status: "success", summary: "workspace-write permissions and sandbox are configured" }),
    "Confirmed. Bounded non-interactive edits are allowed with no questions or interactive prompts.",
    "Preflight passed. Do not ask questions instruction was followed.",
  ]) {
    assert.equal(
      classifyExternalRunnerFailure({
        stdout,
        stderr: "",
        errorMessage: null,
        defaultFailureKind: "none",
      }),
      "none",
    );
  }

  assert.equal(
    classifyExternalRunnerFailure({
      stdout: "Approval required for tool Read before editing the handoff packet",
      stderr: "",
      errorMessage: null,
      defaultFailureKind: "none",
    }),
    "permission-mode-blocked",
  );
});

test("external runner failure classifier ignores successful authentication confirmation text", () => {
  assert.equal(
    classifyExternalRunnerFailure({
      stdout: JSON.stringify({
        type: "result",
        subtype: "success",
        result: "Ready. Authentication confirmed, minimal non-interactive invocation successful.",
      }),
      stderr: "",
      errorMessage: null,
      defaultFailureKind: "none",
    }),
    "none",
  );

  assert.equal(
    classifyExternalRunnerFailure({
      stdout: "",
      stderr: "authentication transient",
      errorMessage: null,
      defaultFailureKind: "external-runner-failed",
    }),
    "auth-failed",
  );
});

test("external runner failure classifier ignores nested target Permission denied logs", () => {
  const targetOutput = [
    "Running npm test",
    "browser › chromium - baseUrl option",
    "MachPortRendezvousServer failed: Permission denied (1100)",
    "Playwright browser process aborted while running target tests",
  ].join("\n");

  assert.equal(
    classifyExternalRunnerFailure({
      stdout: targetOutput,
      stderr: "",
      errorMessage: null,
      defaultFailureKind: "none",
    }),
    "none",
  );
});

test("live adapter uses selected permission policy args and records the selected mode", () => {
  const previousMode = process.env.AOR_RUNTIME_AGENT_PERMISSION_MODE;
  process.env.AOR_RUNTIME_AGENT_PERMISSION_MODE = "restricted";
  try {
    const adapter = createLiveAdapter({
      adapterId: "codex-cli",
      adapterProfile: buildExternalRunnerProfile({
        command: process.execPath,
        args: ["-e", "process.stdout.write(JSON.stringify({runner:'legacy'}));"],
        permissionPolicy: {
          default_mode: "full-bypass",
          modes: {
            "full-bypass": {
              args: ["-e", "process.stdout.write(JSON.stringify({runner:'full-bypass'}));"],
            },
            restricted: {
              args: ["-e", "process.stdout.write(JSON.stringify({runner:'restricted'}));"],
            },
          },
        },
      }),
    });

    const response = adapter.execute({
      request_id: "req-permission-policy",
      run_id: "run-permission-policy",
      step_id: "step-permission-policy",
      step_class: "implement",
      route: { resolved_route_id: "route.implement.default" },
      asset_bundle: { wrapper_ref: "wrapper.runner.default@v3" },
      policy_bundle: { policy_id: "policy.step.runner.default" },
      dry_run: false,
    });

    assert.equal(response.status, "success");
    assert.equal(response.output.runner_output.runner, "restricted");
    assert.equal(response.output.external_runner.permission_mode, "restricted");
    assert.equal(response.output.external_runner.permission_mode_source, "AOR_RUNTIME_AGENT_PERMISSION_MODE");
  } finally {
    if (previousMode === undefined) {
      delete process.env.AOR_RUNTIME_AGENT_PERMISSION_MODE;
    } else {
      process.env.AOR_RUNTIME_AGENT_PERMISSION_MODE = previousMode;
    }
  }
});

test("live adapter accepts successful runner output that mentions workspace permissions and sandbox", () => {
  const evidenceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-live-adapter-permission-words-"));
  try {
    const adapter = createLiveAdapter({
      adapterId: "codex-cli",
      adapterProfile: buildExternalRunnerProfile({
        command: process.execPath,
        args: [
          "-e",
          [
            "process.stdout.write(JSON.stringify({",
            "status:'success',",
            "summary:'bounded edits allowed under workspace-write permissions and sandbox',",
            "output:{runner:'node-inline',permission_note:'workspace-write permissions and sandbox configured'},",
            "evidence_refs:['evidence://external-runner/permission-words-success'],",
            "tool_traces:[{phase:'invoke_adapter',kind:'external-runner-mock',detail:'permission words are benign'}]",
            "}));",
          ].join(""),
        ],
      }),
      runtimeEvidenceRoot: evidenceRoot,
      projectRoot: evidenceRoot,
      executionRoot: evidenceRoot,
    });

    const response = adapter.execute({
      request_id: "req-live-permission-words",
      run_id: "run-live-permission-words",
      step_id: "step-live-permission-words",
      step_class: "implement",
      route: { resolved_route_id: "route.implement.default" },
      asset_bundle: { wrapper_ref: "wrapper.runner.default@v3" },
      policy_bundle: { policy_id: "policy.step.runner.default" },
      dry_run: false,
    });

    assert.equal(response.status, "success");
    assert.equal(response.output.runner_output.permission_note, "workspace-write permissions and sandbox configured");
  } finally {
    fs.rmSync(evidenceRoot, { recursive: true, force: true });
  }
});

test("live adapter blocks unknown permission policy modes before launching the runner", () => {
  const previousMode = process.env.AOR_RUNTIME_AGENT_PERMISSION_MODE;
  process.env.AOR_RUNTIME_AGENT_PERMISSION_MODE = "missing";
  try {
    const adapter = createLiveAdapter({
      adapterId: "claude-code",
      adapterProfile: buildExternalRunnerProfile({
        command: process.execPath,
        args: ["-e", "process.stdout.write('should-not-run')"],
        permissionPolicy: {
          default_mode: "full-bypass",
          modes: {
            "full-bypass": {
              args: ["-e", "process.stdout.write('ok')"],
            },
          },
        },
      }),
    });

    const response = adapter.execute({
      request_id: "req-permission-policy-invalid",
      run_id: "run-permission-policy-invalid",
      step_id: "step-permission-policy-invalid",
      step_class: "implement",
      route: { resolved_route_id: "route.implement.default" },
      asset_bundle: { wrapper_ref: "wrapper.runner.default@v3" },
      policy_bundle: { policy_id: "policy.step.runner.default" },
      dry_run: false,
    });

    assert.equal(response.status, "blocked");
    assert.equal(response.output.failure_kind, "permission-policy-invalid");
    assert.equal(response.output.external_runner.permission_mode, "missing");
  } finally {
    if (previousMode === undefined) {
      delete process.env.AOR_RUNTIME_AGENT_PERMISSION_MODE;
    } else {
      process.env.AOR_RUNTIME_AGENT_PERMISSION_MODE = previousMode;
    }
  }
});

test("live adapter executes external runner path for supported codex-cli requests", () => {
  const evidenceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-live-adapter-evidence-"));
  const executionRoot = path.join(evidenceRoot, "execution-root");
  fs.mkdirSync(executionRoot, { recursive: true });
  try {
    const adapter = createLiveAdapter({
      adapterId: "codex-cli",
      adapterProfile: buildExternalRunnerProfile({
        command: process.execPath,
        args: [
          "-e",
          [
            "const fs=require('node:fs');",
            "const input=JSON.parse(fs.readFileSync(0,'utf8'));",
            "const request=input.request||{};",
            "process.stdout.write(JSON.stringify({",
            "status:'success',",
            "summary:'external runner ok',",
            "output:{runner:'node-inline',step_class:request.step_class||null,cwd:process.cwd()},",
            "evidence_refs:['evidence://external-runner/mock-success'],",
            "tool_traces:[{phase:'invoke_adapter',kind:'external-runner-mock',detail:'node-inline'}]",
            "}));",
          ].join(""),
        ],
      }),
      runtimeEvidenceRoot: evidenceRoot,
      projectRoot: evidenceRoot,
      executionRoot,
    });

    const response = adapter.execute({
      request_id: "req-live-1",
      run_id: "run-live-1",
      step_id: "step-live-1",
      step_class: "implement",
      route: { resolved_route_id: "route.implement.default" },
      asset_bundle: { wrapper_ref: "wrapper.runner.default@v3" },
      policy_bundle: { policy_id: "policy.step.runner.default" },
      dry_run: false,
      context: {
        compiled_context_ref: "compiled-context://compiled-context.aor-core.live.implement",
      },
    });

    assert.equal(response.adapter_id, "codex-cli");
    assert.equal(response.status, "success");
    assert.equal(response.output.mode, "execute");
    assert.equal(response.output.provider_adapter, "codex-cli");
    assert.equal(response.output.external_runner.runtime_mode, "external-process");
    assert.equal(response.output.external_runner.command, process.execPath);
    assert.equal(
      fs.realpathSync(response.output.external_runner.execution_root),
      fs.realpathSync(executionRoot),
    );
    assert.equal(fs.realpathSync(response.output.runner_output.cwd), fs.realpathSync(executionRoot));
    assert.ok(response.evidence_refs.some((ref) => ref.startsWith("evidence://adapter-live/codex-cli/")));
    assert.ok(response.evidence_refs.includes("evidence://external-runner/mock-success"));
    assert.ok(
      response.evidence_refs.some((ref) => ref.includes("adapter-live-raw-codex-cli")),
      "expected raw external runner evidence ref to be persisted",
    );
  } finally {
    fs.rmSync(evidenceRoot, { recursive: true, force: true });
  }
});

test("live adapter can invoke external runners through a short execution root alias", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-live-adapter-short-root-"));
  const longSegment = "live-e2e-installed-user-guided-journey-qwen-final-ui-1780348266";
  const executionRoot = path.join(tempRoot, longSegment, "runtime", "projects", "aor-core", "target-checkouts", `ky-${longSegment}`);
  const evidenceRoot = path.join(tempRoot, "reports");
  fs.mkdirSync(executionRoot, { recursive: true });
  fs.mkdirSync(evidenceRoot, { recursive: true });
  try {
    const adapter = createLiveAdapter({
      adapterId: "qwen-code",
      adapterProfile: {
        runner_family: "qwen",
        ...buildExternalRunnerProfile({
          command: process.execPath,
          executionRootMode: "short-symlink",
          args: [
            "-e",
            [
              "const fs=require('node:fs');",
              "process.stdout.write(JSON.stringify({",
              "status:'success',",
              "output:{cwd:process.cwd(),real_cwd:fs.realpathSync(process.cwd())}",
              "}));",
            ].join(""),
          ],
          handler: null,
        }),
      },
      runtimeEvidenceRoot: evidenceRoot,
      projectRoot: executionRoot,
      executionRoot,
    });

    const response = adapter.execute({
      request_id: "req-short-execution-root",
      run_id: "run-short-execution-root",
      step_id: "step-short-execution-root",
      step_class: "implement",
      route: { resolved_route_id: "route.implement.default" },
      asset_bundle: { wrapper_ref: "wrapper.runner.default@v3" },
      policy_bundle: { policy_id: "policy.step.runner.default" },
      dry_run: false,
    });

    assert.equal(response.status, "success");
    assert.equal(response.output.external_runner.execution_root_mode, "short-symlink");
    assert.notEqual(response.output.external_runner.execution_root, executionRoot);
    assert.ok(
      response.output.external_runner.execution_root.length < executionRoot.length,
      "expected the external runner cwd to be shorter than the canonical checkout root",
    );
    assert.equal(fs.realpathSync(response.output.external_runner.execution_root), fs.realpathSync(executionRoot));
    assert.equal(fs.realpathSync(response.output.runner_output.cwd), fs.realpathSync(executionRoot));
    assert.equal(fs.realpathSync(response.output.runner_output.real_cwd), fs.realpathSync(executionRoot));
    assert.equal(response.output.external_runner.canonical_execution_root, fs.realpathSync(executionRoot));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("live adapter keeps raw evidence filenames bounded for long live run ids", () => {
  const evidenceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-live-adapter-long-evidence-"));
  const executionRoot = path.join(evidenceRoot, "execution-root");
  fs.mkdirSync(executionRoot, { recursive: true });
  try {
    const adapter = createLiveAdapter({
      adapterId: "claude-code",
      adapterProfile: buildExternalRunnerProfile({
        command: process.execPath,
        args: ["-e", "process.stdout.write(JSON.stringify({status:'success',summary:'ok'}));"],
      }),
      runtimeEvidenceRoot: evidenceRoot,
      projectRoot: evidenceRoot,
      executionRoot,
    });

    const edgePadding = "-".repeat(1024);
    const longRunId = `${edgePadding}live-e2e.${"very-long-segment.".repeat(18)}repair-2${edgePadding}`;
    const response = adapter.execute({
      request_id: `${longRunId}.run-start-implement.${"request.".repeat(8)}`,
      run_id: longRunId,
      step_id: `${longRunId}.step.implement`,
      step_class: "implement",
      route: { resolved_route_id: "route.implement.default" },
      asset_bundle: { wrapper_ref: "wrapper.runner.default@v3" },
      policy_bundle: { policy_id: "policy.step.runner.default" },
      dry_run: false,
    });

    const rawEvidenceRef = response.output.external_runner.raw_evidence_ref;
    const rawEvidenceFile = path.join(evidenceRoot, rawEvidenceRef.replace(/^evidence:\/\//u, ""));
    assert.equal(response.status, "success");
    assert.match(path.basename(rawEvidenceFile), /^adapter-live-raw-claude-code-/u);
    assert.equal(path.basename(rawEvidenceFile).length < 255, true);
    assert.equal(fs.existsSync(rawEvidenceFile), true);
  } finally {
    fs.rmSync(evidenceRoot, { recursive: true, force: true });
  }
});

test("live adapter reports blocked when external runner command is missing", () => {
  const adapter = createLiveAdapter({
    adapterId: "codex-cli",
    adapterProfile: buildExternalRunnerProfile({
      command: "__aor_missing_runner_command__",
      args: [],
    }),
  });

  const response = adapter.execute({
    request_id: "req-live-missing",
    run_id: "run-live-missing",
    step_id: "step-live-missing",
    step_class: "implement",
    route: { resolved_route_id: "route.implement.default" },
    asset_bundle: { wrapper_ref: "wrapper.runner.default@v3" },
    policy_bundle: { policy_id: "policy.step.runner.default" },
    dry_run: false,
  });

  assert.equal(response.status, "blocked");
  assert.equal(response.output.failure_kind, "missing-command");
  assert.match(response.summary, /not available on PATH/i);
});

test("live adapter normalizes external runner launch errors", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-live-adapter-launch-error-"));
  const runnerPath = path.join(tempRoot, "runner");
  fs.writeFileSync(runnerPath, "#!/bin/sh\necho should-not-run\n", { mode: 0o644 });

  try {
    const adapter = createLiveAdapter({
      adapterId: "codex-cli",
      adapterProfile: buildExternalRunnerProfile({
        command: runnerPath,
        args: [],
      }),
    });

    const response = adapter.execute({
      request_id: "req-live-launch-error",
      run_id: "run-live-launch-error",
      step_id: "step-live-launch-error",
      step_class: "implement",
      route: { resolved_route_id: "route.implement.default" },
      asset_bundle: { wrapper_ref: "wrapper.runner.default@v3" },
      policy_bundle: { policy_id: "policy.step.runner.default" },
      dry_run: false,
    });

    assert.equal(response.status, "failed");
    assert.equal(response.output.failure_kind, "external-runner-failed");
    assert.match(response.summary, /launch failed/i);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("live adapter reports failed when external runner exits non-zero", () => {
  const adapter = createLiveAdapter({
    adapterId: "codex-cli",
    adapterProfile: buildExternalRunnerProfile({
      command: process.execPath,
      args: ["-e", "process.stderr.write('boom');process.exit(17);"],
    }),
  });

  const response = adapter.execute({
    request_id: "req-live-failed",
    run_id: "run-live-failed",
    step_id: "step-live-failed",
    step_class: "implement",
    route: { resolved_route_id: "route.implement.default" },
    asset_bundle: { wrapper_ref: "wrapper.runner.default@v3" },
    policy_bundle: { policy_id: "policy.step.runner.default" },
    dry_run: false,
  });

  assert.equal(response.status, "failed");
  assert.equal(response.output.failure_kind, "external-runner-failed");
  assert.match(response.summary, /exited with code 17/i);
});

test("live adapter reports timeout distinctly from launch failures", () => {
  const adapter = createLiveAdapter({
    adapterId: "claude-code",
    adapterProfile: buildExternalRunnerProfile({
      command: process.execPath,
      args: ["-e", "setTimeout(() => {}, 1000);"],
      timeoutMs: 10,
      handler: null,
    }),
  });

  const response = adapter.execute({
    request_id: "req-live-timeout",
    run_id: "run-live-timeout",
    step_id: "step-live-timeout",
    step_class: "implement",
    route: { resolved_route_id: "route.implement.default" },
    asset_bundle: { wrapper_ref: "wrapper.runner.default@v3" },
    policy_bundle: { policy_id: "policy.step.runner.default" },
    dry_run: false,
  });

  assert.equal(response.status, "failed");
  assert.equal(response.output.failure_kind, "external-runner-timeout");
  assert.equal(response.output.external_runner.timed_out, true);
});

test("live adapter hard-kills external runners that ignore SIGTERM on timeout", () => {
  const adapter = createLiveAdapter({
    adapterId: "claude-code",
    adapterProfile: buildExternalRunnerProfile({
      command: process.execPath,
      args: ["-e", "process.on('SIGTERM', () => {}); setTimeout(() => {}, 1000);"],
      timeoutMs: 10,
      handler: null,
    }),
  });

  const response = adapter.execute({
    request_id: "req-live-timeout-hard-kill",
    run_id: "run-live-timeout-hard-kill",
    step_id: "step-live-timeout-hard-kill",
    step_class: "implement",
    route: { resolved_route_id: "route.implement.default" },
    asset_bundle: { wrapper_ref: "wrapper.runner.default@v3" },
    policy_bundle: { policy_id: "policy.step.runner.default" },
    dry_run: false,
  });

  assert.equal(response.status, "failed");
  assert.equal(response.output.failure_kind, "external-runner-timeout");
  assert.equal(response.output.external_runner.timed_out, true);
  assert.equal(response.output.external_runner.signal, "SIGKILL");
});

test("live adapter kills external runner process groups on timeout", () => {
  const markerFile = path.join(os.tmpdir(), `aor-adapter-orphan-${process.pid}-${Date.now()}.txt`);
  const orphanScript = [
    "const fs = require('node:fs');",
    `setTimeout(() => fs.writeFileSync(${JSON.stringify(markerFile)}, 'survived'), 200);`,
    "setTimeout(() => {}, 1000);",
  ].join("");
  const runnerScript = [
    "const { spawn } = require('node:child_process');",
    `spawn(process.execPath, ['-e', ${JSON.stringify(orphanScript)}], { stdio: 'ignore' });`,
    "setTimeout(() => {}, 1000);",
  ].join("");
  const adapter = createLiveAdapter({
    adapterId: "open-code",
    adapterProfile: buildExternalRunnerProfile({
      command: process.execPath,
      args: ["-e", runnerScript],
      timeoutMs: 10,
      handler: null,
    }),
  });

  try {
    const response = adapter.execute({
      request_id: "req-live-timeout-process-group",
      run_id: "run-live-timeout-process-group",
      step_id: "step-live-timeout-process-group",
      step_class: "implement",
      route: { resolved_route_id: "route.implement.default" },
      asset_bundle: { wrapper_ref: "wrapper.runner.default@v3" },
      policy_bundle: { policy_id: "policy.step.runner.default" },
      dry_run: false,
    });

    assert.equal(response.status, "failed");
    assert.equal(response.output.failure_kind, "external-runner-timeout");
    assert.equal(response.output.external_runner.timed_out, true);
    spawnSync(process.execPath, ["-e", "setTimeout(() => {}, 350);"]);
    assert.equal(fs.existsSync(markerFile), false);
  } finally {
    fs.rmSync(markerFile, { force: true });
  }
});

test("live adapter interrupts external runner when public run-control cancel is recorded", () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-adapter-interrupt-"));
  const stateFile = path.join(repoRoot, "run-control-state-interrupted.json");
  fs.writeFileSync(
    stateFile,
    `${JSON.stringify(
      {
        run_id: "run-live-interrupted",
        status: "running",
        provider_step_status: {
          status: "running",
        },
      },
      null,
      2,
    )}\n`,
  );
  const cancelScript = [
    "const fs = require('node:fs');",
    `const stateFile = ${JSON.stringify(stateFile)};`,
    "setTimeout(() => {",
    "  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));",
    "  state.status = 'canceled';",
    "  state.provider_step_status = { ...(state.provider_step_status || {}), status: 'interrupted' };",
    "  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\\n');",
    "}, 75);",
    "setTimeout(() => {}, 5000);",
  ].join("");
  const adapter = createLiveAdapter({
    adapterId: "qwen-code",
    adapterProfile: buildExternalRunnerProfile({
      command: process.execPath,
      args: ["-e", cancelScript],
      timeoutMs: 2000,
      handler: null,
    }),
  });

  try {
    const response = adapter.execute({
      request_id: "req-live-interrupted",
      run_id: "run-live-interrupted",
      step_id: "step-live-interrupted",
      step_class: "implement",
      route: { resolved_route_id: "route.implement.default.qwen-primary" },
      asset_bundle: { wrapper_ref: "wrapper.runner.default@v3" },
      policy_bundle: { policy_id: "policy.step.runner.default" },
      dry_run: false,
      provider_step_status: {
        provider: "qwen",
        adapter: "qwen-code",
        route_id: "route.implement.default.qwen-primary",
        step_id: "run.start.implement",
        state_file: stateFile,
        timeout_budget_ms: 2000,
        heartbeat_interval_ms: 25,
      },
    });

    const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    assert.equal(response.status, "blocked");
    assert.equal(response.output.failure_kind, "external-runner-interrupted");
    assert.equal(response.output.external_runner.timed_out, false);
    assert.equal(state.provider_step_status.status, "interrupted");
    assert.match(state.provider_step_status.recommended_action, /stopped by the operator/i);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("live adapter applies resolved route timeout when it is shorter than the adapter timeout", () => {
  const adapter = createLiveAdapter({
    adapterId: "claude-code",
    adapterProfile: buildExternalRunnerProfile({
      command: process.execPath,
      args: ["-e", "process.stdout.write(JSON.stringify({status:'success'}));"],
      timeoutMs: 3000,
      handler: null,
    }),
  });

  const response = adapter.execute({
    request_id: "req-live-route-timeout",
    run_id: "run-live-route-timeout",
    step_id: "step-live-route-timeout",
    step_class: "implement",
    route: { resolved_route_id: "route.implement.default" },
    asset_bundle: { wrapper_ref: "wrapper.runner.default@v3" },
    policy_bundle: {
      policy_id: "policy.step.runner.default",
      resolved_bounds: {
        budget: {
          timeout_sec: 2,
        },
      },
    },
    dry_run: false,
  });

  assert.equal(response.status, "success");
  assert.equal(response.output.external_runner.timeout_ms, 2000);
  assert.equal(response.output.external_runner.timed_out, false);
});

test("live adapter caps resolved route timeout at the adapter hard timeout", () => {
  const adapter = createLiveAdapter({
    adapterId: "open-code",
    adapterProfile: buildExternalRunnerProfile({
      command: process.execPath,
      args: ["-e", "setTimeout(() => process.stdout.write(JSON.stringify({status:'success'})), 1000);"],
      timeoutMs: 10,
      handler: null,
    }),
  });

  const response = adapter.execute({
    request_id: "req-live-route-timeout-cap",
    run_id: "run-live-route-timeout-cap",
    step_id: "step-live-route-timeout-cap",
    step_class: "implement",
    route: { resolved_route_id: "route.implement.default" },
    asset_bundle: { wrapper_ref: "wrapper.runner.default@v3" },
    policy_bundle: {
      policy_id: "policy.step.runner.default",
      resolved_bounds: {
        budget: {
          timeout_sec: 3,
        },
      },
    },
    dry_run: false,
  });

  assert.equal(response.status, "failed");
  assert.equal(response.output.failure_kind, "external-runner-timeout");
  assert.equal(response.output.external_runner.timeout_ms, 10);
  assert.equal(response.output.external_runner.timed_out, true);
});

test("live adapter baseline accepts non-codex adapter ids when an external runner profile is supplied", () => {
  const adapter = createLiveAdapter({
    adapterId: "open-code",
    adapterProfile: buildExternalRunnerProfile({
      command: process.execPath,
      args: [
        "-e",
        "const fs=require('node:fs');fs.readFileSync(0,'utf8');process.stdout.write(JSON.stringify({status:'success',summary:'ok',output:{runner:'node-inline'},evidence_refs:['evidence://adapter-live/open-code/test']}));",
      ],
      handler: null,
    }),
  });

  const response = adapter.execute({
    request_id: "req-open-code",
    run_id: "run-open-code",
    step_id: "step-open-code",
    step_class: "implement",
    route: { resolved_route_id: "route.implement.default" },
    asset_bundle: { wrapper_ref: "wrapper.runner.default@v3" },
    policy_bundle: { policy_id: "policy.step.runner.default" },
    dry_run: false,
  });

  assert.equal(response.status, "success");
  assert.equal(response.adapter_id, "open-code");
  assert.equal(response.tool_traces[0].kind, "open-code-external-runner");
});

test("live adapter applies env_from aliases without exposing secret values in evidence", () => {
  const previousSource = process.env.AOR_TEST_SOURCE_SECRET;
  const previousTarget = process.env.AOR_TEST_TARGET_SECRET;
  process.env.AOR_TEST_SOURCE_SECRET = "secret-from-env-from";
  delete process.env.AOR_TEST_TARGET_SECRET;
  try {
    const adapter = createLiveAdapter({
      adapterId: "qwen-code",
      adapterProfile: buildExternalRunnerProfile({
        command: process.execPath,
        args: [
          "-e",
          [
            "const fs=require('node:fs');",
            "fs.readFileSync(0,'utf8');",
            "if(!process.env.AOR_TEST_TARGET_SECRET||process.env.AOR_TEST_TARGET_SECRET!==process.env.AOR_TEST_SOURCE_SECRET){process.stderr.write('missing env alias');process.exit(1);}",
            "process.stdout.write(JSON.stringify({status:'success',summary:'env alias ok',output:{target_present:true}}));",
          ].join(""),
        ],
        handler: null,
        envFrom: {
          AOR_TEST_TARGET_SECRET: "AOR_TEST_SOURCE_SECRET",
        },
      }),
    });

    const response = adapter.execute({
      request_id: "req-qwen-env-from",
      run_id: "run-qwen-env-from",
      step_id: "step-qwen-env-from",
      step_class: "implement",
      route: { resolved_route_id: "route.implement.default" },
      asset_bundle: { wrapper_ref: "wrapper.runner.default@v3" },
      policy_bundle: { policy_id: "policy.step.runner.default" },
      dry_run: false,
    });

    assert.equal(response.status, "success");
    assert.deepEqual(response.output.external_runner.env_from_applied, [
      { target: "AOR_TEST_TARGET_SECRET", source: "AOR_TEST_SOURCE_SECRET" },
    ]);
    assert.equal(JSON.stringify(response).includes("secret-from-env-from"), false);
  } finally {
    if (previousSource === undefined) {
      delete process.env.AOR_TEST_SOURCE_SECRET;
    } else {
      process.env.AOR_TEST_SOURCE_SECRET = previousSource;
    }
    if (previousTarget === undefined) {
      delete process.env.AOR_TEST_TARGET_SECRET;
    } else {
      process.env.AOR_TEST_TARGET_SECRET = previousTarget;
    }
  }
});

test("live adapter appends native timeout args before invoking an external runner", () => {
  const adapter = createLiveAdapter({
    adapterId: "qwen-code",
    adapterProfile: buildExternalRunnerProfile({
      command: process.execPath,
      args: [
        "-e",
        [
          "const timeoutIndex=process.argv.indexOf('--max-wall-time');",
          "if(timeoutIndex<0||process.argv[timeoutIndex+1]!=='25s'){process.stderr.write('missing native timeout');process.exit(1);}",
          "process.stdout.write(JSON.stringify({status:'success',summary:'native timeout ok'}));",
        ].join(""),
        "--",
      ],
      handler: null,
      timeoutMs: 30000,
      nativeTimeoutArg: {
        flag: "--max-wall-time",
        format: "duration-seconds",
        reserve_ms: 5000,
      },
    }),
  });

  const response = adapter.execute({
    request_id: "req-qwen-native-timeout",
    run_id: "run-qwen-native-timeout",
    step_id: "step-qwen-native-timeout",
    step_class: "implement",
    route: { resolved_route_id: "route.implement.default" },
    asset_bundle: { wrapper_ref: "wrapper.runner.default@v3" },
    policy_bundle: { policy_id: "policy.step.runner.default" },
    dry_run: false,
  });

  assert.equal(response.status, "success");
  assert.deepEqual(response.output.external_runner.args.slice(-2), ["--max-wall-time", "25s"]);
});

test("live adapter supports file-attached request transport for argv prompt runners", () => {
  withTempRepo((repoRoot) => {
    const evidenceRoot = path.join(repoRoot, ".aor", "projects", "adapter-test", "reports");
    const adapter = createLiveAdapter({
      adapterId: "open-code",
      projectRoot: repoRoot,
      runtimeEvidenceRoot: evidenceRoot,
      executionRoot: repoRoot,
      adapterProfile: buildExternalRunnerProfile({
        command: process.execPath,
        args: [
          "-e",
          [
            "const fs=require('node:fs');",
            "const fileIndex=process.argv.indexOf('--file');",
            "const filePath=fileIndex>=0?process.argv[fileIndex+1]:'';",
            "const request=JSON.parse(fs.readFileSync(filePath,'utf8'));",
            "process.stdout.write(JSON.stringify({",
            "status:'success',",
            "summary:'file transport ok',",
            "output:{message_seen:process.argv.includes('Follow the attached AOR adapter request JSON.'),request_id:request.request.request_id},",
            "evidence_refs:['evidence://adapter-live/open-code/file-transport']",
            "}));",
          ].join(""),
        ],
        handler: null,
        requestViaStdin: false,
        requestTransport: "file-attachment",
        requestFile: {
          message: "Follow the attached AOR adapter request JSON.",
          argument: "--file",
        },
      }),
    });

    const response = adapter.execute({
      request_id: "req-open-code-file",
      run_id: "run-open-code-file",
      step_id: "step-open-code-file",
      step_class: "implement",
      route: { resolved_route_id: "route.implement.default" },
      asset_bundle: { wrapper_ref: "wrapper.runner.default@v3" },
      policy_bundle: { policy_id: "policy.step.runner.default" },
      dry_run: false,
    });

    assert.equal(response.status, "success");
    assert.equal(response.output.external_runner.request_transport, "file-attachment");
    assert.match(response.output.external_runner.request_file_ref, /^evidence:\/\/\.aor\/projects\/adapter-test\/reports\/adapter-live-request-/u);
    assert.equal(response.output.runner_output.message_seen, true);
    assert.equal(response.output.runner_output.request_id, "req-open-code-file");
  });
});

test("live adapter parses JSONL runner output without requiring an AOR envelope", () => {
  const adapter = createLiveAdapter({
    adapterId: "codex-cli",
    adapterProfile: buildExternalRunnerProfile({
      command: process.execPath,
      args: [
        "-e",
        [
          "process.stdout.write(JSON.stringify({type:'session.started',id:'one'})+'\\n');",
          "process.stdout.write(JSON.stringify({type:'message.completed',result:'ok'})+'\\n');",
        ].join(""),
      ],
    }),
  });

  const response = adapter.execute({
    request_id: "req-jsonl",
    run_id: "run-jsonl",
    step_id: "step-jsonl",
    step_class: "implement",
    route: { resolved_route_id: "route.implement.default" },
    asset_bundle: { wrapper_ref: "wrapper.runner.default@v3" },
    policy_bundle: { policy_id: "policy.step.runner.default" },
    dry_run: false,
  });

  assert.equal(response.status, "success");
  assert.equal(response.output.runner_output.jsonl_events.length, 2);
  assert.equal(response.output.runner_output.jsonl_events[1].result, "ok");
});

test("live adapter preserves single JSON runner output without requiring an AOR envelope", () => {
  const adapter = createLiveAdapter({
    adapterId: "claude-code",
    adapterProfile: buildExternalRunnerProfile({
      command: process.execPath,
      args: [
        "-e",
        "process.stdout.write(JSON.stringify({type:'message.completed',result:'ok',runner:'plain-json'}));",
      ],
      handler: null,
    }),
  });

  const response = adapter.execute({
    request_id: "req-single-json",
    run_id: "run-single-json",
    step_id: "step-single-json",
    step_class: "implement",
    route: { resolved_route_id: "route.implement.default" },
    asset_bundle: { wrapper_ref: "wrapper.runner.default@v3" },
    policy_bundle: { policy_id: "policy.step.runner.default" },
    dry_run: false,
  });

  assert.equal(response.status, "success");
  assert.equal(response.output.runner_output.type, "message.completed");
  assert.equal(response.output.runner_output.runner, "plain-json");
  assert.equal(response.tool_traces[0].kind, "claude-code-external-runner");
});

test("live adapter preserves raw stdout fallback when runner output is not JSON", () => {
  const adapter = createLiveAdapter({
    adapterId: "codex-cli",
    adapterProfile: buildExternalRunnerProfile({
      command: process.execPath,
      args: ["-e", "process.stdout.write('plain runner output');"],
    }),
  });

  const response = adapter.execute({
    request_id: "req-raw-stdout",
    run_id: "run-raw-stdout",
    step_id: "step-raw-stdout",
    step_class: "implement",
    route: { resolved_route_id: "route.implement.default" },
    asset_bundle: { wrapper_ref: "wrapper.runner.default@v3" },
    policy_bundle: { policy_id: "policy.step.runner.default" },
    dry_run: false,
  });

  assert.equal(response.status, "success");
  assert.equal(response.output.runner_output.raw_stdout, "plain runner output");
});

test("live adapter classifies external runner auth failures", () => {
  const adapter = createLiveAdapter({
    adapterId: "codex-cli",
    adapterProfile: buildExternalRunnerProfile({
      command: process.execPath,
      args: ["-e", "process.stderr.write('401 Unauthorized: Missing bearer authentication');process.exit(1);"],
    }),
  });

  const response = adapter.execute({
    request_id: "req-auth-failed",
    run_id: "run-auth-failed",
    step_id: "step-auth-failed",
    step_class: "implement",
    route: { resolved_route_id: "route.implement.default" },
    asset_bundle: { wrapper_ref: "wrapper.runner.default@v3" },
    policy_bundle: { policy_id: "policy.step.runner.default" },
    dry_run: false,
  });

  assert.equal(response.status, "blocked");
  assert.equal(response.output.failure_kind, "auth-failed");
});

test("live adapter classifies external runner permission blocks", () => {
  const adapter = createLiveAdapter({
    adapterId: "claude-code",
    adapterProfile: buildExternalRunnerProfile({
      command: process.execPath,
      args: ["-e", "process.stderr.write('Approval required for tool Edit');process.exit(1);"],
      handler: null,
    }),
  });

  const response = adapter.execute({
    request_id: "req-permission-blocked",
    run_id: "run-permission-blocked",
    step_id: "step-permission-blocked",
    step_class: "implement",
    route: { resolved_route_id: "route.implement.default" },
    asset_bundle: { wrapper_ref: "wrapper.runner.default@v3" },
    policy_bundle: { policy_id: "policy.step.runner.default" },
    dry_run: false,
  });

  assert.equal(response.status, "blocked");
  assert.equal(response.output.failure_kind, "permission-mode-blocked");
  assert.equal(response.output.runtime_permission_request.interaction_type, "permission_request");
  assert.equal(response.output.runtime_permission_request.adapter_id, "claude-code");
  assert.equal(response.output.runtime_permission_request.operation_type, "file_write");
});

test("live adapter accepts successful runner output with target Permission denied logs", () => {
  const adapter = createLiveAdapter({
    adapterId: "codex-cli",
    adapterProfile: buildExternalRunnerProfile({
      command: process.execPath,
      args: [
        "-e",
        [
          "process.stderr.write('MachPortRendezvousServer failed: Permission denied (1100)\\n');",
          "process.stdout.write(JSON.stringify({status:'success',summary:'target tests reported browser permission output',output:{changed_files:['source/utils/merge.ts']}}));",
        ].join(""),
      ],
      handler: null,
    }),
  });

  const response = adapter.execute({
    request_id: "req-target-permission-output",
    run_id: "run-target-permission-output",
    step_id: "step-target-permission-output",
    step_class: "implement",
    route: { resolved_route_id: "route.implement.default" },
    asset_bundle: { wrapper_ref: "wrapper.runner.default@v3" },
    policy_bundle: { policy_id: "policy.step.runner.default" },
    dry_run: false,
  });

  assert.equal(response.status, "success");
  assert.equal(response.output.failure_kind, undefined);
});

test("live adapter accepts Codex JSONL agent summaries that mention target Permission denied logs", () => {
  const adapter = createLiveAdapter({
    adapterId: "codex-cli",
    adapterProfile: buildExternalRunnerProfile({
      command: process.execPath,
      args: [
        "-e",
        [
          "process.stdout.write(JSON.stringify({type:'thread.started',thread_id:'t1'})+'\\n');",
          "process.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'Full target npm test failed because Playwright reported Permission denied (1100) inside a browser sandbox; changed source/utils/merge.ts and test/headers.ts.'}})+'\\n');",
        ].join(""),
      ],
      handler: null,
    }),
  });

  const response = adapter.execute({
    request_id: "req-codex-jsonl-target-permission-summary",
    run_id: "run-codex-jsonl-target-permission-summary",
    step_id: "step-codex-jsonl-target-permission-summary",
    step_class: "implement",
    route: { resolved_route_id: "route.implement.default" },
    asset_bundle: { wrapper_ref: "wrapper.runner.default@v3" },
    policy_bundle: { policy_id: "policy.step.runner.default" },
    dry_run: false,
  });

  assert.equal(response.status, "success");
  assert.equal(response.output.failure_kind, undefined);
  assert.equal(response.output.runner_output.jsonl_events.length, 2);
});

test("live adapter ignores successful Codex plugin warm auth noise", () => {
  const adapter = createLiveAdapter({
    adapterId: "codex-cli",
    adapterProfile: buildExternalRunnerProfile({
      command: process.execPath,
      args: [
        "-e",
        [
          "process.stderr.write('failed to warm featured plugin ids cache error=remote plugin sync request failed with status 403 Forbidden\\n');",
          "process.stdout.write(JSON.stringify({type:'thread.started',thread_id:'t1'})+'\\n');",
          "process.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'Implementation completed and target diagnostics were reported.'}})+'\\n');",
        ].join(""),
      ],
      handler: null,
    }),
  });

  const response = adapter.execute({
    request_id: "req-codex-plugin-auth-noise",
    run_id: "run-codex-plugin-auth-noise",
    step_id: "step-codex-plugin-auth-noise",
    step_class: "implement",
    route: { resolved_route_id: "route.implement.default" },
    asset_bundle: { wrapper_ref: "wrapper.runner.default@v3" },
    policy_bundle: { policy_id: "policy.step.runner.default" },
    dry_run: false,
  });

  assert.equal(response.status, "success");
  assert.equal(response.output.failure_kind, undefined);
});

test("live adapter blocks successful Claude JSON results that include permission denials", () => {
  const adapter = createLiveAdapter({
    adapterId: "claude-code",
    adapterProfile: buildExternalRunnerProfile({
      command: process.execPath,
      args: [
        "-e",
        [
          "process.stdout.write(JSON.stringify({",
          "type:'result',",
          "subtype:'success',",
          "result:'Could you grant permission to read the handoff packet?',",
          "permission_denials:[{tool_name:'Read',tool_input:{file_path:'.aor/projects/run/artifacts/handoff.json'}}]",
          "}));",
        ].join(""),
      ],
      handler: null,
    }),
  });

  const response = adapter.execute({
    request_id: "req-structured-permission-denial",
    run_id: "run-structured-permission-denial",
    step_id: "step-structured-permission-denial",
    step_class: "implement",
    route: { resolved_route_id: "route.implement.default" },
    asset_bundle: { wrapper_ref: "wrapper.runner.default@v3" },
    policy_bundle: { policy_id: "policy.step.runner.default" },
    dry_run: false,
  });

  assert.equal(response.status, "blocked");
  assert.equal(response.output.failure_kind, "permission-mode-blocked");
  assert.equal(response.output.runner_output.permission_denials.length, 1);
  assert.equal(response.output.runtime_permission_request.operation_type, "file_read");
  assert.equal(response.output.runtime_permission_request.tool_name, "Read");
  assert.equal(response.output.runtime_permission_request.target, ".aor/projects/run/artifacts/handoff.json");
});

test("live adapter blocks nested runner_output permission denials without relying on raw text", () => {
  const adapter = createLiveAdapter({
    adapterId: "claude-code",
    adapterProfile: buildExternalRunnerProfile({
      command: process.execPath,
      args: [
        "-e",
        [
          "process.stdout.write(JSON.stringify({",
          "status:'success',",
          "summary:'runner completed',",
          "output:{runner_output:{permission_denials:[{tool_name:'Read',tool_input:{file_path:'.aor/spec.json'}}]}}",
          "}));",
        ].join(""),
      ],
      handler: null,
    }),
  });

  const response = adapter.execute({
    request_id: "req-nested-structured-permission-denial",
    run_id: "run-nested-structured-permission-denial",
    step_id: "step-nested-structured-permission-denial",
    step_class: "implement",
    route: { resolved_route_id: "route.implement.default" },
    asset_bundle: { wrapper_ref: "wrapper.runner.default@v3" },
    policy_bundle: { policy_id: "policy.step.runner.default" },
    dry_run: false,
  });

  assert.equal(response.status, "blocked");
  assert.equal(response.output.failure_kind, "permission-mode-blocked");
  assert.equal(response.output.runner_output.runner_output.permission_denials.length, 1);
});

test("live adapter parses Qwen JSON array output and detects permission denials", () => {
  const adapter = createLiveAdapter({
    adapterId: "qwen-code",
    adapterProfile: {
      runner_family: "qwen",
      ...buildExternalRunnerProfile({
        command: process.execPath,
        args: [
          "-e",
          [
            "process.stdout.write(JSON.stringify([",
            "{type:'system',subtype:'session_start',session_id:'qwen-test'},",
            "{type:'result',subtype:'success',permission_denials:[{tool_name:'Bash',tool_input:{command:'git status --short'}}]}",
            "]));",
          ].join(""),
        ],
        handler: null,
      }),
    },
  });

  const response = adapter.execute({
    request_id: "req-qwen-json-array-permission",
    run_id: "run-qwen-json-array-permission",
    step_id: "step-qwen-json-array-permission",
    step_class: "implement",
    route: { resolved_route_id: "route.implement.default" },
    asset_bundle: { wrapper_ref: "wrapper.runner.default@v3" },
    policy_bundle: { policy_id: "policy.step.runner.default" },
    dry_run: false,
  });

  assert.equal(response.status, "blocked");
  assert.equal(response.output.failure_kind, "permission-mode-blocked");
  assert.equal(response.output.runner_output.json_events.length, 2);
  assert.equal(response.output.runtime_permission_request.runner_family, "qwen");
  assert.equal(response.output.runtime_permission_request.operation_type, "shell_command");
  assert.equal(response.output.runtime_permission_request.command, "git status --short");
});

test("live adapter blocks successful runner exits that still emit tool denial evidence", () => {
  const adapter = createLiveAdapter({
    adapterId: "claude-code",
    adapterProfile: buildExternalRunnerProfile({
      command: process.execPath,
      args: ["-e", "process.stderr.write('Tool denied: Edit was not allowed');process.exit(0);"],
      handler: null,
    }),
  });

  const response = adapter.execute({
    request_id: "req-edit-denied-success",
    run_id: "run-edit-denied-success",
    step_id: "step-edit-denied-success",
    step_class: "implement",
    route: { resolved_route_id: "route.implement.default" },
    asset_bundle: { wrapper_ref: "wrapper.runner.default@v3" },
    policy_bundle: { policy_id: "policy.step.runner.default" },
    dry_run: false,
  });

  assert.equal(response.status, "blocked");
  assert.equal(response.output.failure_kind, "edit-denied");
});

test("live adapter blocks successful runner exits that ask interactive questions", () => {
  const adapter = createLiveAdapter({
    adapterId: "claude-code",
    adapterProfile: buildExternalRunnerProfile({
      command: process.execPath,
      args: ["-e", "process.stdout.write('AskUserQuestion: which file should I edit?');process.exit(0);"],
      handler: null,
    }),
  });

  const response = adapter.execute({
    request_id: "req-interactive-success",
    run_id: "run-interactive-success",
    step_id: "step-interactive-success",
    step_class: "implement",
    route: { resolved_route_id: "route.implement.default" },
    asset_bundle: { wrapper_ref: "wrapper.runner.default@v3" },
    policy_bundle: { policy_id: "policy.step.runner.default" },
    dry_run: false,
  });

  assert.equal(response.status, "blocked");
  assert.equal(response.output.failure_kind, "interactive-question-requested");
});
