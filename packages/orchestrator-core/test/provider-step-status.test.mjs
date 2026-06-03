import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { listRuns, readProjectState } from "../src/control-plane/read-surface.mjs";
import { finalizeRunControlState } from "../src/operator-cli/command-runtime.mjs";
import { mergeProviderStepStatus, normalizeProviderStepStatus } from "../src/provider-step-status.mjs";
import { initializeProjectRuntime } from "../src/project-init.mjs";
import { applyRunControlAction } from "../src/run-control.mjs";

/**
 * @param {(repoRoot: string) => void} callback
 */
function withCleanRepo(callback) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-provider-step-status-"));
  fs.mkdirSync(path.join(repoRoot, ".git"), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, "package.json"), `${JSON.stringify({ name: "provider-status-target" }, null, 2)}\n`, "utf8");
  try {
    callback(repoRoot);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
}

/**
 * @param {string} filePath
 * @param {Record<string, unknown>} document
 */
function writeJson(filePath, document) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
}

test("provider step status normalizes silent-running and budget fields", () => {
  const startedAt = "2026-06-02T00:00:00.000Z";
  const status = normalizeProviderStepStatus(
    {
      provider: "qwen",
      adapter: "qwen-code",
      route_id: "route.implement.qwen",
      step_id: "run.start.implement",
      status: "running",
      timeout_budget_ms: 120_000,
      started_at: startedAt,
      current_command_label: "external-provider-runner",
    },
    { nowMs: Date.parse("2026-06-02T00:01:10.000Z") },
  );

  assert.equal(status?.status, "silent-running");
  assert.equal(status?.elapsed_ms, 70_000);
  assert.equal(status?.remaining_budget_ms, 50_000);
  assert.equal(status?.recommended_action, "No output yet; keep monitoring or diagnose if budget risk increases.");
});

test("provider step status reports timeout risk near budget exhaustion", () => {
  const status = mergeProviderStepStatus(
    null,
    {
      provider: "codex",
      adapter: "codex-cli",
      route_id: "route.implement.default",
      step_id: "run.start.implement",
      status: "running",
      timeout_budget_ms: 120_000,
      started_at: "2026-06-02T00:00:00.000Z",
      last_output_at: "2026-06-02T00:01:50.000Z",
    },
    { nowMs: Date.parse("2026-06-02T00:01:55.000Z") },
  );

  assert.equal(status.status, "timeout-risk");
  assert.equal(status.remaining_budget_ms, 5_000);
  assert.match(status.recommended_action, /stop before budget/i);
});

test("provider step status downgrades stale artifact updates to silent-running", () => {
  const status = normalizeProviderStepStatus(
    {
      provider: "qwen",
      adapter: "qwen-code",
      route_id: "route.implement.qwen",
      step_id: "run.start.implement",
      status: "artifact-updated",
      timeout_budget_ms: 600_000,
      started_at: "2026-06-02T00:00:00.000Z",
      last_artifact_update_at: "2026-06-02T00:00:10.000Z",
    },
    { nowMs: Date.parse("2026-06-02T00:02:00.000Z"), silentAfterMs: 60_000 },
  );

  assert.equal(status?.status, "silent-running");
  assert.equal(status?.remaining_budget_ms, 480_000);
});

test("provider step status treats recent stream progress as activity", () => {
  const status = normalizeProviderStepStatus(
    {
      provider: "qwen",
      adapter: "qwen-code",
      route_id: "route.implement.qwen",
      step_id: "run.start.implement",
      status: "running",
      timeout_budget_ms: 600_000,
      started_at: "2026-06-02T00:00:00.000Z",
      last_progress_at: "2026-06-02T00:01:50.000Z",
      last_progress_kind: "tool_call",
      last_progress_label: "read_file",
      progress_event_count: 4,
      output_mode: "stream-json",
    },
    { nowMs: Date.parse("2026-06-02T00:02:00.000Z"), silentAfterMs: 60_000 },
  );

  assert.equal(status?.status, "running");
  assert.equal(status?.last_progress_kind, "tool_call");
  assert.equal(status?.last_progress_label, "read_file");
  assert.equal(status?.progress_event_count, 4);
  assert.equal(status?.output_mode, "stream-json");
});

test("provider step status is exposed through project state and run summaries", () => {
  withCleanRepo((repoRoot) => {
    const init = initializeProjectRuntime({ cwd: repoRoot, projectRef: repoRoot });
    const stateFile = path.join(init.runtimeLayout.stateRoot, "run-control-state-live-e2e-provider.json");
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(
      stateFile,
      `${JSON.stringify(
        {
          schema_version: 1,
          run_id: "live-e2e-provider",
          status: "running",
          current_step: "implement",
          last_action: "start",
          started_at: "2026-06-02T00:00:00.000Z",
          updated_at: "2026-06-02T00:00:05.000Z",
          action_sequence: 1,
          provider_step_status: {
            provider: "codex",
            adapter: "codex-cli",
            route_id: "route.implement.default",
            step_id: "run.start.implement",
            status: "running",
            timeout_budget_ms: 300_000,
            elapsed_ms: 5_000,
            current_command_label: "external-provider-runner",
            recommended_action: "Provider is still running.",
            started_at: "2026-06-02T00:00:00.000Z",
            updated_at: "2026-06-02T00:00:05.000Z",
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const projectState = readProjectState({ cwd: repoRoot, projectRef: repoRoot });
    assert.equal(projectState.provider_step_status?.provider, "codex");
    assert.equal(projectState.provider_step_status?.current_command_label, "external-provider-runner");

    const runs = listRuns({ cwd: repoRoot, projectRef: repoRoot });
    const run = runs.find((entry) => entry.run_id === "live-e2e-provider");
    assert.equal(run?.run_control_state?.status, "running");
    assert.equal(run?.provider_step_status?.adapter, "codex-cli");
    assert.equal(Object.hasOwn(run?.provider_step_status ?? {}, "state_file"), false);
    assert.equal(run?.execution_evidence?.provider_execution_status, "running");
    assert.equal(run?.execution_evidence?.actions.find((entry) => entry.action_id === "stop_provider")?.enabled, true);
  });
});

test("run summaries preserve mission required path prefixes for execution evidence", () => {
  withCleanRepo((repoRoot) => {
    const init = initializeProjectRuntime({ cwd: repoRoot, projectRef: repoRoot });
    writeJson(path.join(init.runtimeLayout.reportsRoot, "step-result-run.mission-prefix.json"), {
      step_result_id: "run.mission-prefix.implement.pass",
      run_id: "run.mission-prefix",
      step_id: "run.start.implement",
      step_class: "runner",
      status: "pass",
      summary: "Provider changed an unrelated document.",
      evidence_refs: ["evidence://reports/step-result-run.mission-prefix.json"],
      routed_execution: {
        feature_traceability: {
          mission_id: "ky-header-regression",
          required_path_prefixes: ["source/"],
        },
      },
      mission_semantics: {
        changed_paths_after_step: ["docs/out-of-scope.md"],
        non_bootstrap_changed_paths: ["docs/out-of-scope.md"],
        meaningful_changed_paths: ["docs/out-of-scope.md"],
      },
    });

    const runs = listRuns({ cwd: repoRoot, projectRef: repoRoot });
    const run = runs.find((entry) => entry.run_id === "run.mission-prefix");
    assert.deepEqual(run?.execution_evidence?.required_path_prefixes, ["source/"]);
    assert.equal(run?.execution_evidence?.real_code_change_status, "fail");
    const missionGroup = run?.execution_evidence?.changed_path_groups.find((entry) => entry.group_id === "mission-relevant");
    const scratchGroup = run?.execution_evidence?.changed_path_groups.find((entry) => entry.group_id === "scratch-unrelated");
    assert.deepEqual(missionGroup?.paths, []);
    assert.deepEqual(scratchGroup?.paths, ["docs/out-of-scope.md"]);
  });
});

test("run cancel records provider interruption instead of pass or crash", () => {
  withCleanRepo((repoRoot) => {
    const init = initializeProjectRuntime({ cwd: repoRoot, projectRef: repoRoot });
    const stateFile = path.join(init.runtimeLayout.stateRoot, "run-control-state-live-e2e-provider-stop.json");
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(
      stateFile,
      `${JSON.stringify(
        {
          schema_version: 1,
          run_id: "live-e2e-provider-stop",
          status: "running",
          current_step: "implement",
          last_action: "start",
          started_at: "2026-06-02T00:00:00.000Z",
          updated_at: "2026-06-02T00:01:00.000Z",
          action_sequence: 1,
          provider_step_status: {
            provider: "qwen",
            adapter: "qwen-code",
            route_id: "route.implement.qwen",
            step_id: "run.start.implement",
            status: "silent-running",
            timeout_budget_ms: 3_600_000,
            elapsed_ms: 60_000,
            current_command_label: "external-provider-runner",
            started_at: "2026-06-02T00:00:00.000Z",
            updated_at: "2026-06-02T00:01:00.000Z",
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const result = applyRunControlAction({
      cwd: repoRoot,
      projectRef: repoRoot,
      runId: "live-e2e-provider-stop",
      action: "cancel",
      reason: "Operator stopped a silent provider step.",
      approvalRef: "approval://operator-stop",
    });

    assert.equal(result.blocked, false);
    assert.equal(result.state.status, "canceled");
    assert.equal(result.state.provider_step_status.status, "interrupted");
    assert.equal(result.state.provider_step_status.provider, "qwen");
    assert.match(result.state.provider_step_status.recommended_action, /stopped by the operator/i);
    const audit = JSON.parse(fs.readFileSync(result.auditFile, "utf8"));
    assert.equal(audit.provider_interruption.status, "operator-stopped");

    const runs = listRuns({ cwd: repoRoot, projectRef: repoRoot });
    const run = runs.find((entry) => entry.run_id === "live-e2e-provider-stop");
    assert.equal(run?.provider_step_status?.status, "interrupted");
    assert.equal(run?.execution_evidence?.provider_execution_status, "interrupted");
    assert.equal(run?.execution_evidence?.actions.find((entry) => entry.action_id === "save_partial_evidence")?.enabled, true);
  });
});

test("run finalization preserves public provider interruption instead of overwriting it as failed", () => {
  withCleanRepo((repoRoot) => {
    const init = initializeProjectRuntime({ cwd: repoRoot, projectRef: repoRoot });
    const stateFile = path.join(init.runtimeLayout.stateRoot, "run-control-state-live-e2e-provider-finalize.json");
    const stepResultFile = path.join(init.runtimeLayout.reportsRoot, "step-result-live-e2e-provider-finalize.json");
    const previousState = {
      schema_version: 1,
      run_id: "live-e2e-provider-finalize",
      status: "canceled",
      current_step: "implement",
      last_action: "cancel",
      started_at: "2026-06-02T00:00:00.000Z",
      updated_at: "2026-06-02T00:01:00.000Z",
      action_sequence: 2,
      audit_refs: ["evidence://.aor/projects/provider-status-target/reports/run-control-event-live-e2e-provider-finalize-0002.json"],
      provider_step_status: {
        provider: "qwen",
        adapter: "qwen-code",
        route_id: "route.implement.qwen",
        step_id: "run.start.implement",
        status: "interrupted",
        timeout_budget_ms: 3_600_000,
        elapsed_ms: 90_000,
        current_command_label: "external-provider-runner",
        recommended_action: "Provider was stopped by the operator; save partial evidence, then diagnose or retry the public step.",
        started_at: "2026-06-02T00:00:00.000Z",
        updated_at: "2026-06-02T00:01:30.000Z",
        finished_at: "2026-06-02T00:01:30.000Z",
      },
    };
    writeJson(stateFile, previousState);
    writeJson(stepResultFile, {
      step_result_id: "live-e2e-provider-finalize.implement.failed",
      run_id: "live-e2e-provider-finalize",
      step_id: "run.start.implement",
      step_class: "runner",
      status: "failed",
      summary: "Provider was interrupted through public run-control.",
      evidence_refs: ["evidence://reports/step-result-live-e2e-provider-finalize.json"],
    });

    const finalized = finalizeRunControlState({
      projectRoot: init.projectRoot,
      stateFile,
      previousState,
      stepStatus: "failed",
      targetStep: "implement",
      stepResultFile,
    });

    assert.equal(finalized.status, "canceled");
    assert.equal(finalized.last_action, "cancel");
    assert.equal(finalized.provider_step_status.status, "interrupted");
    const runs = listRuns({ cwd: repoRoot, projectRef: repoRoot });
    const run = runs.find((entry) => entry.run_id === "live-e2e-provider-finalize");
    assert.equal(run?.provider_step_status?.status, "interrupted");
    assert.equal(run?.execution_evidence?.provider_execution_status, "interrupted");
  });
});
