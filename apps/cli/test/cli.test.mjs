import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { invokeCli } from "../src/index.mjs";

const currentFilePath = fileURLToPath(import.meta.url);
const fixturesDir = path.join(path.dirname(currentFilePath), "fixtures");
const workspaceRoot = path.resolve(path.dirname(currentFilePath), "../../..");

/**
 * @param {(projectRoot: string) => void} callback
 */
function withTempProject(callback) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-cli-w1-s01-"));
  try {
    callback(tempRoot);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

test("global help transcript matches fixture", () => {
  const expected = fs.readFileSync(path.join(fixturesDir, "help-transcript.txt"), "utf8");
  const result = invokeCli(["--help"]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, expected);
});

test("implemented command help documents inputs outputs and contracts", () => {
  const result = invokeCli(["project", "init", "--help"]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /Status: implemented in bootstrap shell \(W1-S01\)/);
  assert.match(
    result.stdout,
    /Inputs: --project-ref <path> \(optional, defaults to cwd discovery\), --project-profile <path> \(optional\), --runtime-root <path> \(optional\), --help/,
  );
  assert.match(
    result.stdout,
    /Outputs: resolved_project_ref, resolved_runtime_root, project_profile_ref, runtime_layout, runtime_state_file, artifact_packet_id, artifact_packet_file, contract_families, command_catalog_alignment/,
  );
  assert.match(result.stdout, /Contract families: project-profile/);
});

test("unknown command fails clearly", () => {
  const result = invokeCli(["project", "unknown"]);

  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Unknown command 'project unknown'/);
});

test("missing required project-ref fails clearly", () => {
  const result = invokeCli(["project", "analyze"]);

  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Missing required flag '--project-ref'/);
});

test("invalid project-ref fails clearly", () => {
  const result = invokeCli(["project", "validate", "--project-ref", "./does-not-exist"]);

  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Invalid project reference '\.\/does-not-exist': path does not exist\./);
});

test("planned commands report not implemented status", () => {
  const result = invokeCli(["run", "start"]);

  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Command 'aor run start' is planned and not implemented yet\./);
});

test("project verify resolves runtime root and contract metadata", () => {
  withTempProject((projectRoot) => {
    fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
    fs.cpSync(path.join(workspaceRoot, "examples"), path.join(projectRoot, "examples"), { recursive: true });
    const result = invokeCli(["project", "verify", "--project-ref", projectRoot]);

    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");

    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.command, "project verify");
    assert.equal(parsed.status, "implemented");
    assert.equal(parsed.resolved_project_ref, projectRoot);
    assert.equal(parsed.resolved_runtime_root, path.join(projectRoot, ".aor"));
    assert.equal(parsed.command_catalog_alignment, "docs/architecture/14-cli-command-catalog.md");
    assert.equal(fs.existsSync(parsed.verify_summary_file), true);
    assert.ok(Array.isArray(parsed.step_result_files));
    assert.ok(parsed.step_result_files.length > 0);
    assert.ok(parsed.step_result_files.every((filePath) => fs.existsSync(filePath)));
    const verifySummary = JSON.parse(fs.readFileSync(parsed.verify_summary_file, "utf8"));
    assert.deepEqual(verifySummary.preflight_safety.sequence, [
      "clone",
      "inspect",
      "analyze",
      "validate",
      "verify",
      "stop",
    ]);
    assert.equal(verifySummary.preflight_safety.workspace_mode, "ephemeral");
    assert.equal(verifySummary.preflight_safety.network_mode, "deny-by-default");
    assert.ok(Array.isArray(verifySummary.command_owners));
    assert.ok(verifySummary.command_owners.includes("main"));
    assert.equal(verifySummary.reusable_by.bootstrap_rehearsal, true);
    assert.equal(verifySummary.reusable_by.quality_rehearsal, true);
    assert.equal(verifySummary.reusable_by.delivery_rehearsal, true);
    assert.equal(verifySummary.reusable_by.source_runbook, "docs/ops/live-e2e-no-write-preflight.md");

    assert.deepEqual(parsed.contract_families, [
      {
        family: "step-result",
        group: "execution-and-quality",
        source_contract: "docs/contracts/step-result.md",
        status: "implemented",
      },
    ]);
  });
});

test("project verify supports routed dry-run smoke execution and durable routed step-result output", () => {
  withTempProject((projectRoot) => {
    fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
    fs.cpSync(path.join(workspaceRoot, "examples"), path.join(projectRoot, "examples"), { recursive: true });

    const result = invokeCli([
      "project",
      "verify",
      "--project-ref",
      projectRoot,
      "--routed-dry-run-step",
      "implement",
    ]);

    assert.equal(result.exitCode, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(typeof parsed.routed_step_result_id, "string");
    assert.equal(fs.existsSync(parsed.routed_step_result_file), true);
    assert.ok(parsed.step_result_files.includes(parsed.routed_step_result_file));

    const routedStepResult = JSON.parse(fs.readFileSync(parsed.routed_step_result_file, "utf8"));
    assert.equal(routedStepResult.step_class, "runner");
    assert.equal(routedStepResult.status, "passed");
    assert.equal(routedStepResult.routed_execution.mode, "dry-run");
    assert.equal(routedStepResult.routed_execution.no_write_enforced, true);
    assert.equal(routedStepResult.routed_execution.route_resolution.step_class, "implement");
    assert.equal(routedStepResult.routed_execution.adapter_resolution.adapter.adapter_id, "codex-cli");
    assert.equal(routedStepResult.routed_execution.adapter_response.adapter_id, "mock-runner");
  });
});

test("project init discovers repo root from cwd and materializes runtime layout idempotently", () => {
  withTempProject((projectRoot) => {
    fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, "examples"), { recursive: true });
    fs.copyFileSync(
      path.join(workspaceRoot, "examples/project.aor.yaml"),
      path.join(projectRoot, "examples/project.aor.yaml"),
    );

    const nestedCwd = path.join(projectRoot, "nested", "workspace");
    fs.mkdirSync(nestedCwd, { recursive: true });

    const firstRun = invokeCli(["project", "init"], { cwd: nestedCwd });
    const secondRun = invokeCli(["project", "init"], { cwd: nestedCwd });

    assert.equal(firstRun.exitCode, 0, firstRun.stderr);
    assert.equal(secondRun.exitCode, 0, secondRun.stderr);

    const firstPayload = JSON.parse(firstRun.stdout);
    const secondPayload = JSON.parse(secondRun.stdout);

    assert.equal(firstPayload.resolved_project_ref, projectRoot);
    assert.equal(secondPayload.resolved_project_ref, projectRoot);
    assert.equal(firstPayload.project_profile_ref, "examples/project.aor.yaml");
    assert.equal(secondPayload.project_profile_ref, "examples/project.aor.yaml");
    assert.equal(firstPayload.runtime_state_file, secondPayload.runtime_state_file);
    assert.equal(fs.existsSync(firstPayload.runtime_state_file), true);
    assert.equal(firstPayload.artifact_packet_id, "aor-core.artifact.bootstrap.v1");
    assert.equal(firstPayload.artifact_packet_file, secondPayload.artifact_packet_file);
    assert.equal(fs.existsSync(firstPayload.artifact_packet_file), true);

    const runtimeState = JSON.parse(fs.readFileSync(firstPayload.runtime_state_file, "utf8"));
    assert.equal(runtimeState.project_id, "aor-core");
    assert.equal(runtimeState.selected_profile_ref, "examples/project.aor.yaml");
    assert.equal(runtimeState.project_root, projectRoot);

    const artifactPacket = JSON.parse(fs.readFileSync(firstPayload.artifact_packet_file, "utf8"));
    assert.equal(artifactPacket.packet_id, "aor-core.artifact.bootstrap.v1");
    assert.equal(artifactPacket.project_id, "aor-core");
    assert.equal(artifactPacket.packet_type, "bootstrap");
  });
});

test("project analyze writes durable analysis report under runtime root", () => {
  withTempProject((projectRoot) => {
    fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
    fs.cpSync(path.join(workspaceRoot, "examples"), path.join(projectRoot, "examples"), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, "package.json"),
      JSON.stringify({ name: "fixture", scripts: { lint: "eslint .", test: "node --test", build: "tsc -b" } }, null, 2),
      "utf8",
    );
    fs.writeFileSync(path.join(projectRoot, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\\n", "utf8");

    const result = invokeCli([
      "project",
      "analyze",
      "--project-ref",
      projectRoot,
      "--route-overrides",
      "planning=route.plan.default",
      "--policy-overrides",
      "planning=policy.step.planner.default",
    ]);

    assert.equal(result.exitCode, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.analysis_report_id, "aor-core.analysis.v1");
    assert.equal(fs.existsSync(parsed.analysis_report_file), true);
    assert.equal(fs.existsSync(parsed.route_resolution_file), true);
    assert.ok(Array.isArray(parsed.route_resolution_steps));
    assert.equal(parsed.route_resolution_steps.length, 10);
    assert.ok(parsed.route_resolution_steps.every((step) => typeof step.resolved_route_id === "string"));
    assert.equal(fs.existsSync(parsed.asset_resolution_file), true);
    assert.ok(Array.isArray(parsed.asset_resolution_steps));
    assert.equal(parsed.asset_resolution_steps.length, 10);
    assert.equal(fs.existsSync(parsed.policy_resolution_file), true);
    assert.ok(Array.isArray(parsed.policy_resolution_steps));
    assert.equal(parsed.policy_resolution_steps.length, 10);
    const planningRoute = parsed.route_resolution_steps.find((step) => step.step_class === "planning");
    assert.ok(planningRoute);
    assert.equal(planningRoute.resolution_source.kind, "step-override");
    const planningAssets = parsed.asset_resolution_steps.find((step) => step.step_class === "planning");
    assert.ok(planningAssets);
    assert.equal(planningAssets.wrapper.wrapper_ref, "wrapper.planner.default@v1");
    const planningPolicy = parsed.policy_resolution_steps.find((step) => step.step_class === "planning");
    assert.ok(planningPolicy);
    assert.equal(planningPolicy.policy.policy_id, "policy.step.planner.default");
    assert.equal(planningPolicy.policy.resolution_source.kind, "step-override");
    assert.equal(planningPolicy.resolved_bounds.writeback_mode.mode, "pull-request");

    const report = JSON.parse(fs.readFileSync(parsed.analysis_report_file, "utf8"));
    assert.equal(report.project_id, "aor-core");
    assert.equal(report.status, "ready-for-bootstrap");
    assert.equal(report.route_resolution.matrix.length, 10);
    assert.equal(report.asset_resolution.matrix.length, 10);
    assert.equal(report.policy_resolution.matrix.length, 10);
  });
});

test("project validate writes validation report with deterministic status", () => {
  withTempProject((projectRoot) => {
    fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
    fs.cpSync(path.join(workspaceRoot, "examples"), path.join(projectRoot, "examples"), { recursive: true });

    const result = invokeCli(["project", "validate", "--project-ref", projectRoot]);
    assert.equal(result.exitCode, 0, result.stderr);

    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.validation_report_id, "aor-core.validation.v1");
    assert.equal(fs.existsSync(parsed.validation_report_file), true);
    assert.ok(parsed.validation_status === "pass" || parsed.validation_status === "warn");
  });
});

test("handoff prepare materializes wave-ticket and pending handoff packet", () => {
  withTempProject((projectRoot) => {
    fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
    fs.cpSync(path.join(workspaceRoot, "examples"), path.join(projectRoot, "examples"), { recursive: true });

    const result = invokeCli(["handoff", "prepare", "--project-ref", projectRoot]);
    assert.equal(result.exitCode, 0, result.stderr);

    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.command, "handoff prepare");
    assert.equal(typeof parsed.wave_ticket_id, "string");
    assert.equal(fs.existsSync(parsed.wave_ticket_file), true);
    assert.equal(parsed.handoff_status, "pending-approval");
    assert.equal(fs.existsSync(parsed.handoff_packet_file), true);
    assert.equal(parsed.handoff_approval_state.state, "pending");

    const handoffPacket = JSON.parse(fs.readFileSync(parsed.handoff_packet_file, "utf8"));
    assert.equal(typeof handoffPacket.writeback_mode, "string");
    assert.equal(typeof handoffPacket.scope_constraints, "object");
    assert.equal(handoffPacket.command_policy.owner, "project-profile");
  });
});

test("project validate enforces approved handoff gate when required", () => {
  withTempProject((projectRoot) => {
    fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
    fs.cpSync(path.join(workspaceRoot, "examples"), path.join(projectRoot, "examples"), { recursive: true });

    const prepareResult = invokeCli(["handoff", "prepare", "--project-ref", projectRoot]);
    assert.equal(prepareResult.exitCode, 0, prepareResult.stderr);
    const prepared = JSON.parse(prepareResult.stdout);

    const validateBeforeApproval = invokeCli([
      "project",
      "validate",
      "--project-ref",
      projectRoot,
      "--require-approved-handoff",
      "--handoff-packet",
      prepared.handoff_packet_file,
    ]);
    assert.equal(validateBeforeApproval.exitCode, 0, validateBeforeApproval.stderr);
    const beforePayload = JSON.parse(validateBeforeApproval.stdout);
    assert.equal(beforePayload.handoff_gate_status, "fail");
    assert.equal(beforePayload.handoff_gate_blocking, true);
    assert.equal(beforePayload.validation_status, "fail");

    const approveResult = invokeCli([
      "handoff",
      "approve",
      "--project-ref",
      projectRoot,
      "--handoff-packet",
      prepared.handoff_packet_file,
      "--approval-ref",
      "approval://APP-1001",
    ]);
    assert.equal(approveResult.exitCode, 0, approveResult.stderr);
    const approved = JSON.parse(approveResult.stdout);
    assert.equal(approved.handoff_status, "approved");
    assert.equal(approved.handoff_approval_state.state, "approved");

    const validateAfterApproval = invokeCli([
      "project",
      "validate",
      "--project-ref",
      projectRoot,
      "--require-approved-handoff",
      "--handoff-packet",
      prepared.handoff_packet_file,
    ]);
    assert.equal(validateAfterApproval.exitCode, 0, validateAfterApproval.stderr);
    const afterPayload = JSON.parse(validateAfterApproval.stdout);
    assert.equal(afterPayload.handoff_gate_status, "pass");
    assert.equal(afterPayload.handoff_gate_blocking, false);
    assert.notEqual(afterPayload.validation_status, "fail");
  });
});

test("project verify refuses to continue when validation gate is enforced and status is fail", () => {
  withTempProject((projectRoot) => {
    fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
    fs.cpSync(path.join(workspaceRoot, "examples"), path.join(projectRoot, "examples"), { recursive: true });
    const profilePath = path.join(projectRoot, "examples/project.aor.yaml");
    const profileContent = fs.readFileSync(profilePath, "utf8");
    fs.writeFileSync(
      profilePath,
      profileContent.replace("allow_direct_write: false", "allow_direct_write: true"),
      "utf8",
    );

    const validateResult = invokeCli(["project", "validate", "--project-ref", projectRoot]);
    assert.equal(validateResult.exitCode, 0, validateResult.stderr);

    const verifyResult = invokeCli([
      "project",
      "verify",
      "--project-ref",
      projectRoot,
      "--require-validation-pass",
    ]);

    assert.equal(verifyResult.exitCode, 1);
    assert.match(verifyResult.stderr, /Validation gate blocked verify flow/);
  });
});
