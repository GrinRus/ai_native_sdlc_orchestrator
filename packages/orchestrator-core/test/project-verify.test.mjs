import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { planProjectVerification, verifyProjectRuntime } from "../src/project-verify.mjs";
import {
  captureCheckoutSnapshot,
  compareCheckoutSnapshots,
  prepareWorkspaceIsolation,
} from "../src/workspace-isolation.mjs";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const workspaceRoot = path.resolve(currentDir, "../../..");

/**
 * @param {(repoRoot: string) => void} callback
 */
function withTempRepo(callback) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-w1-s05-"));
  fs.mkdirSync(path.join(repoRoot, ".git"), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, "examples"), { recursive: true });
  fs.copyFileSync(
    path.join(workspaceRoot, "examples/project.aor.yaml"),
    path.join(repoRoot, "examples/project.aor.yaml"),
  );

  try {
    callback(repoRoot);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
}

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

test("workspace isolation provisions a detached checkout for a linked worktree without mutating its source", () => {
  const container = fs.mkdtempSync(path.join(os.tmpdir(), "aor-s03 space-ü-"));
  const mainRoot = path.join(container, "main");
  const linkedRoot = path.join(container, "linked checkout");
  fs.mkdirSync(mainRoot);
  try {
    git(mainRoot, ["init"]);
    git(mainRoot, ["config", "user.email", "aor@example.invalid"]);
    git(mainRoot, ["config", "user.name", "AOR Test"]);
    fs.writeFileSync(path.join(mainRoot, ".gitignore"), ".aor/\n", "utf8");
    fs.writeFileSync(path.join(mainRoot, "source.txt"), "baseline\n", "utf8");
    git(mainRoot, ["add", ".gitignore", "source.txt"]);
    git(mainRoot, ["commit", "-m", "fixture"]);
    git(mainRoot, ["worktree", "add", "--detach", linkedRoot, "HEAD"]);

    const projectRuntimeRoot = path.join(linkedRoot, ".aor", "projects", "project-one");
    fs.mkdirSync(projectRuntimeRoot, { recursive: true });
    const before = captureCheckoutSnapshot(linkedRoot);
    const isolation = prepareWorkspaceIsolation({
      projectRoot: linkedRoot,
      runtimeRoot: path.join(linkedRoot, ".aor"),
      projectRuntimeRoot,
      runtimeDefaults: { workspace_mode: "worktree" },
      runId: "project-one.run-one",
    });

    assert.equal(isolation.mode, "worktree");
    assert.notEqual(isolation.executionRoot, linkedRoot);
    assert.notEqual(isolation.checkout.execution_git_dir, isolation.checkout.source_git_dir);
    fs.writeFileSync(path.join(isolation.executionRoot, "source.txt"), "workspace-only\n", "utf8");
    git(isolation.executionRoot, ["add", "source.txt"]);
    assert.deepEqual(compareCheckoutSnapshots(before, captureCheckoutSnapshot(linkedRoot)), {
      unchanged: true,
      changed_fields: [],
    });
    assert.equal(fs.readFileSync(path.join(linkedRoot, "source.txt"), "utf8"), "baseline\n");

    const cleanup = isolation.cleanup("success", "delete");
    assert.equal(cleanup.status, "deleted");
    assert.deepEqual(isolation.cleanup("success", "delete"), cleanup);
    assert.equal(fs.existsSync(isolation.executionRoot), false);
  } finally {
    fs.rmSync(container, { recursive: true, force: true });
  }
});

test("workspace cleanup refuses a symlink replacement and preserves its external target", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-s03-cleanup-"));
  const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-s03-outside-"));
  try {
    fs.writeFileSync(path.join(projectRoot, "source.txt"), "source\n", "utf8");
    fs.writeFileSync(path.join(outsideRoot, "keep.txt"), "keep\n", "utf8");
    const projectRuntimeRoot = path.join(projectRoot, ".aor", "projects", "project-one");
    fs.mkdirSync(projectRuntimeRoot, { recursive: true });
    const isolation = prepareWorkspaceIsolation({
      projectRoot,
      runtimeRoot: path.join(projectRoot, ".aor"),
      projectRuntimeRoot,
      runtimeDefaults: { workspace_mode: "ephemeral" },
      runId: "project-one.cleanup-escape",
    });

    fs.rmSync(isolation.executionRoot, { recursive: true, force: true });
    fs.symlinkSync(outsideRoot, isolation.executionRoot, "dir");
    const cleanup = isolation.cleanup("failure", "delete");
    assert.equal(cleanup.status, "delete-failed");
    assert.match(cleanup.error, /symlinked workspace/u);
    assert.equal(fs.readFileSync(path.join(outsideRoot, "keep.txt"), "utf8"), "keep\n");
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(outsideRoot, { recursive: true, force: true });
  }
});

test("verifyProjectRuntime records passing bounded command execution", () => {
  withTempRepo((repoRoot) => {
    const profilePath = path.join(repoRoot, "examples/project.aor.yaml");
    const profileContent = fs.readFileSync(profilePath, "utf8");
    const patched = profileContent
      .replace("- pnpm build", "- 'node -e \"process.exit(0)\"'")
      .replace("- pnpm test", "- 'node -e \"process.exit(0)\"'")
      .replace("- pnpm lint", "- 'node -e \"process.exit(0)\"'");
    fs.writeFileSync(profilePath, patched, "utf8");

    const result = verifyProjectRuntime({ projectRef: repoRoot, cwd: repoRoot });

    assert.equal(result.verifySummary.status, "passed");
    assert.ok(result.stepResults.length > 0);
    assert.ok(result.stepResults.every((step) => step.status === "passed"));
    assert.deepEqual(result.verifySummary.preflight_safety.sequence, [
      "clone",
      "inspect",
      "analyze",
      "validate",
      "verify",
      "stop",
    ]);
    assert.equal(result.verifySummary.preflight_safety.workspace_mode, "ephemeral");
    assert.equal(result.verifySummary.preflight_safety.network_mode, "deny-by-default");
    assert.equal(result.verifySummary.execution_isolation.requested_mode, "ephemeral");
    assert.equal(result.verifySummary.execution_isolation.mode, "workspace-clone");
    assert.notEqual(result.verifySummary.execution_isolation.execution_root, repoRoot);
    assert.equal(result.verifySummary.execution_isolation.cleanup.status, "deleted");
    assert.equal(fs.existsSync(result.verifySummaryPath), true);
    assert.equal(result.stepResultFiles.every((filePath) => fs.existsSync(filePath)), true);
  });
});

test("planProjectVerification writes command-group plan without running target commands", () => {
  withTempRepo((repoRoot) => {
    const markerFile = path.join(repoRoot, "plan-command-ran.txt");
    fs.writeFileSync(
      path.join(repoRoot, "package.json"),
      `${JSON.stringify(
        {
          scripts: {
            build: "node -e \"process.exit(0)\"",
            test: "node -e \"process.exit(0)\"",
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const planCommand = `${process.execPath} -e "require('node:fs').writeFileSync(${JSON.stringify(markerFile)}, 'ran')"`;
    const result = planProjectVerification({
      projectRef: repoRoot,
      cwd: repoRoot,
      verificationLabel: "post-run-primary",
      repoTestCommands: [planCommand],
    });

    assert.equal(fs.existsSync(result.verificationPlanPath), true);
    assert.equal(fs.existsSync(markerFile), false);
    assert.equal(result.verificationPlan.command_groups.length, 1);
    assert.equal(result.verificationPlan.command_groups[0].status, "planned");
    assert.equal(result.verificationPlan.command_groups[0].command_source, "cli-override");
    assert.ok(result.verificationPlan.discovered_command_groups.length >= 2);
    assert.ok(result.verificationPlan.discovered_command_groups.every((candidate) => candidate.confidence));
    assert.ok(result.verificationPlan.discovered_command_groups.every((candidate) => candidate.source_refs.length > 0));
    const serializedPlan = JSON.stringify(result.verificationPlan);
    assert.equal(/live_e2e|live-e2e|target_readiness|diagnostic_health|step_quality/u.test(serializedPlan), false);
  });
});

test("verifyProjectRuntime records command exit and output evidence", () => {
  withTempRepo((repoRoot) => {
    const command = "node -e \"process.stdout.write('ok-output'); process.stderr.write('ok-stderr')\"";
    const result = verifyProjectRuntime({
      projectRef: repoRoot,
      cwd: repoRoot,
      verificationLabel: "post-run-primary",
      repoTestCommands: [command],
    });

    assert.equal(result.verifySummary.status, "passed");
    const step = result.stepResults.find((candidate) => candidate.command === command);
    assert.ok(step);
    assert.equal(step.status, "passed");
    assert.equal(step.exit_code, 0);
    assert.equal(step.signal, null);
    assert.equal(step.error_code, null);
    assert.equal(typeof step.started_at, "string");
    assert.equal(typeof step.finished_at, "string");
    assert.equal(typeof step.duration_ms, "number");
    assert.equal(step.output_excerpt.stdout_tail, "ok-output");
    assert.equal(step.output_excerpt.stderr_tail, "ok-stderr");
  });
});

test("verifyProjectRuntime fails exit-zero commands that emit warning output on stderr", () => {
  withTempRepo((repoRoot) => {
    const command = "node -e \"process.stderr.write('sys:1: ResourceWarning: unclosed file\\\\n')\"";
    const result = verifyProjectRuntime({
      projectRef: repoRoot,
      cwd: repoRoot,
      verificationLabel: "post-run-primary",
      repoTestCommands: [command],
    });

    assert.equal(result.verifySummary.status, "failed");
    assert.equal(result.verifySummary.output_quality_failed_commands.length, 1);
    const step = result.stepResults.find((candidate) => candidate.command === command);
    assert.ok(step);
    assert.equal(step.status, "failed");
    assert.equal(step.exit_code, 0);
    assert.match(step.summary, /exited 0 but emitted warning output/u);
    assert.equal(step.output_quality_findings.length, 1);
    assert.equal(step.output_quality_findings[0].rule_id, "stderr-language-warning");
    assert.match(step.output_quality_findings[0].excerpt, /ResourceWarning/u);
    assert.match(step.blocked_next_step, /stderr warning output/u);
  });
});

test("verifyProjectRuntime accepts warning output that matches baseline evidence", () => {
  withTempRepo((repoRoot) => {
    const command = "node -e \"process.stderr.write('sys:1: ResourceWarning: unclosed file\\\\n')\"";
    const baseline = verifyProjectRuntime({
      projectRef: repoRoot,
      cwd: repoRoot,
      verificationLabel: "baseline-diagnostic",
      repoTestCommands: [command],
    });

    const result = verifyProjectRuntime({
      projectRef: repoRoot,
      cwd: repoRoot,
      verificationLabel: "post-run-primary",
      repoTestCommands: [command],
      outputQualityBaselineFiles: [baseline.verifySummaryPath],
    });

    assert.equal(baseline.verifySummary.status, "failed");
    assert.equal(result.verifySummary.status, "passed");
    assert.equal(result.verifySummary.output_quality_failed_commands.length, 0);
    assert.equal(result.verifySummary.output_quality_observed_commands.length, 1);
    assert.equal(result.verifySummary.output_quality_baseline_matches.length, 1);
    assert.deepEqual(result.verifySummary.output_quality_baseline_files, [baseline.verifySummaryPath]);
    const step = result.stepResults.find((candidate) => candidate.command === command);
    assert.ok(step);
    assert.equal(step.status, "passed");
    assert.match(step.summary, /matched baseline diagnostic evidence/u);
    assert.equal(step.output_quality_findings.length, 1);
    assert.equal(step.output_quality_findings[0].baseline_status, "pre_existing");
    assert.deepEqual(step.output_quality_findings[0].baseline_evidence_refs, [baseline.verifySummaryPath]);
  });
});

test("verifyProjectRuntime still fails warning output that is not in the baseline", () => {
  withTempRepo((repoRoot) => {
    const baselineCommand = "node -e \"process.stderr.write('sys:1: ResourceWarning: unclosed file\\\\n')\"";
    const currentCommand = "node -e \"process.stderr.write('sys:1: DeprecationWarning: old api\\\\n')\"";
    const baseline = verifyProjectRuntime({
      projectRef: repoRoot,
      cwd: repoRoot,
      verificationLabel: "baseline-diagnostic",
      repoTestCommands: [baselineCommand],
    });

    const result = verifyProjectRuntime({
      projectRef: repoRoot,
      cwd: repoRoot,
      verificationLabel: "post-run-primary",
      repoTestCommands: [currentCommand],
      outputQualityBaselineFiles: [baseline.verifySummaryPath],
    });

    assert.equal(result.verifySummary.status, "failed");
    assert.equal(result.verifySummary.output_quality_failed_commands.length, 1);
    assert.equal(result.verifySummary.output_quality_baseline_matches.length, 0);
    const step = result.stepResults.find((candidate) => candidate.command === currentCommand);
    assert.ok(step);
    assert.equal(step.status, "failed");
    assert.equal(step.output_quality_findings[0].baseline_status, undefined);
    assert.match(step.output_quality_findings[0].excerpt, /DeprecationWarning/u);
  });
});

test("verifyProjectRuntime accepts command failures that match explicit baseline failure evidence", () => {
  withTempRepo((repoRoot) => {
    const counterFile = path.join(repoRoot, "verify-counter.txt");
    const command = [
      "node -e",
      JSON.stringify(
        [
          "const fs=require('node:fs');",
          `const f=${JSON.stringify(counterFile)};`,
          "const next=fs.existsSync(f)?'0.456ms':'0.123ms';",
          "fs.writeFileSync(f,'seen');",
          "console.log('test at tests/example.test.js:1:1');",
          "console.log(`\\u2716 known broken baseline (${next})`);",
          "process.exit(5);",
        ].join(""),
      ),
    ].join(" ");
    const baseline = verifyProjectRuntime({
      projectRef: repoRoot,
      cwd: repoRoot,
      verificationLabel: "baseline-diagnostic",
      repoTestCommands: [command],
    });

    const result = verifyProjectRuntime({
      projectRef: repoRoot,
      cwd: repoRoot,
      verificationLabel: "post-run-primary",
      repoTestCommands: [command],
      outputQualityBaselineFiles: [baseline.verifySummaryPath],
    });

    assert.equal(baseline.verifySummary.status, "failed");
    assert.equal(result.verifySummary.status, "passed");
    assert.equal(result.verifySummary.verification_failure_baseline_matches.length, 1);
    const step = result.stepResults.find((candidate) => candidate.command === command);
    assert.ok(step);
    assert.equal(step.status, "passed");
    assert.equal(step.command_group_outcome, "broken-baseline");
    assert.equal(step.baseline_failure_status, "pre_existing");
    assert.ok(step.baseline_failure_evidence_refs.includes(baseline.verifySummaryPath));
    assert.match(step.summary, /matched pre-existing baseline failure evidence/u);
  });
});

test("verifyProjectRuntime still fails command failures that do not match baseline evidence", () => {
  withTempRepo((repoRoot) => {
    const baselineCommand = "node -e \"console.log('test at tests/example.test.js:1:1'); console.log('\\u2716 old failure'); process.exit(5)\"";
    const currentCommand = "node -e \"console.log('test at tests/example.test.js:1:1'); console.log('\\u2716 new failure'); process.exit(5)\"";
    const baseline = verifyProjectRuntime({
      projectRef: repoRoot,
      cwd: repoRoot,
      verificationLabel: "baseline-diagnostic",
      repoTestCommands: [baselineCommand],
    });

    const result = verifyProjectRuntime({
      projectRef: repoRoot,
      cwd: repoRoot,
      verificationLabel: "post-run-primary",
      repoTestCommands: [currentCommand],
      outputQualityBaselineFiles: [baseline.verifySummaryPath],
    });

    assert.equal(result.verifySummary.status, "failed");
    assert.equal(result.verifySummary.verification_failure_baseline_matches.length, 0);
    const step = result.stepResults.find((candidate) => candidate.command === currentCommand);
    assert.ok(step);
    assert.equal(step.status, "failed");
    assert.equal(step.baseline_failure_status, undefined);
  });
});

test("verifyProjectRuntime keeps labeled step results distinct across repeated verifies", () => {
  withTempRepo((repoRoot) => {
    const primary = verifyProjectRuntime({
      projectRef: repoRoot,
      cwd: repoRoot,
      verificationLabel: "post-run-primary",
      repoTestCommands: ['node -e "process.exit(0)"'],
    });

    const primaryStepRefs = [...primary.verifySummary.step_result_refs];
    assert.equal(primary.verifySummary.status, "passed");
    assert.ok(primaryStepRefs.every((filePath) => path.basename(filePath).startsWith("step-result-post-run-primary-")));

    const diagnostic = verifyProjectRuntime({
      projectRef: repoRoot,
      cwd: repoRoot,
      verificationLabel: "post-run-diagnostic",
      repoTestCommands: ['node -e "process.exit(7)"'],
    });

    assert.equal(diagnostic.verifySummary.status, "failed");
    assert.ok(
      diagnostic.verifySummary.step_result_refs.every((filePath) =>
        path.basename(filePath).startsWith("step-result-post-run-diagnostic-"),
      ),
    );

    for (const filePath of primaryStepRefs) {
      const stepResult = JSON.parse(fs.readFileSync(filePath, "utf8"));
      assert.equal(stepResult.verification_label, "post-run-primary");
      assert.equal(stepResult.status, "passed");
      assert.equal(stepResult.command_source, "cli-override");
    }
  });
});

test("verifyProjectRuntime runs commands in workspace-clone isolation and records cleanup metadata", () => {
  withTempRepo((repoRoot) => {
    const profilePath = path.join(repoRoot, "examples/project.aor.yaml");
    const profileContent = fs.readFileSync(profilePath, "utf8");
    const patched = profileContent
      .replace("workspace_mode: ephemeral", "workspace_mode: workspace-clone")
      .replace("- pnpm build", "- 'node -e \"require(\\\"node:fs\\\").writeFileSync(\\\"isolation-marker.txt\\\",\\\"ok\\\")\"'")
      .replace("- pnpm test", "- 'node -e \"process.exit(0)\"'")
      .replace("- pnpm lint", "- 'node -e \"process.exit(0)\"'");
    fs.writeFileSync(profilePath, patched, "utf8");

    const result = verifyProjectRuntime({ projectRef: repoRoot, cwd: repoRoot });

    assert.equal(result.verifySummary.status, "passed");
    assert.equal(result.verifySummary.execution_isolation.mode, "workspace-clone");
    assert.notEqual(result.verifySummary.execution_isolation.execution_root, repoRoot);
    assert.equal(result.verifySummary.execution_isolation.cleanup.status, "deleted");
    assert.equal(fs.existsSync(result.verifySummary.execution_isolation.execution_root), false);
    assert.equal(fs.existsSync(path.join(repoRoot, "isolation-marker.txt")), false);
  });
});

test("verifyProjectRuntime workspace-clone omits copied Python virtual environments", () => {
  withTempRepo((repoRoot) => {
    const profilePath = path.join(repoRoot, "examples/project.aor.yaml");
    const profileContent = fs.readFileSync(profilePath, "utf8");
    const patched = profileContent
      .replace("workspace_mode: ephemeral", "workspace_mode: workspace-clone")
      .replace("- pnpm build", "- 'node -e \"process.exit(0)\"'")
      .replace("- pnpm test", "- 'node -e \"process.exit(0)\"'")
      .replace(
        "- pnpm lint",
        [
          "- 'node -e \"",
          "const fs = require(\\\"node:fs\\\");",
          "if (fs.existsSync(\\\"venv/pyvenv.cfg\\\")) process.exit(7);",
          "fs.mkdirSync(\\\"venv\\\", { recursive: true });",
          "fs.writeFileSync(\\\"venv/created-in-clone.txt\\\", \\\"ok\\\");",
          "\"'",
        ].join(""),
      );
    fs.writeFileSync(profilePath, patched, "utf8");
    fs.mkdirSync(path.join(repoRoot, "venv", "bin"), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, "venv", "pyvenv.cfg"), "home = /usr/bin\n", "utf8");
    fs.writeFileSync(path.join(repoRoot, "venv", "bin", "python"), "#!/usr/bin/env python\n", "utf8");

    const result = verifyProjectRuntime({ projectRef: repoRoot, cwd: repoRoot });

    assert.equal(result.verifySummary.status, "passed");
    assert.equal(result.verifySummary.execution_isolation.mode, "workspace-clone");
    assert.equal(fs.existsSync(path.join(repoRoot, "venv", "pyvenv.cfg")), true);
    assert.equal(fs.existsSync(path.join(repoRoot, "venv", "created-in-clone.txt")), false);
  });
});

test("verifyProjectRuntime supports worktree isolation mode and retains workspace on failure by default", () => {
  withTempRepo((repoRoot) => {
    const profilePath = path.join(repoRoot, "examples/project.aor.yaml");
    const profileContent = fs.readFileSync(profilePath, "utf8");
    const patched = profileContent
      .replace("workspace_mode: ephemeral", "workspace_mode: worktree")
      .replace("- pnpm build", "- 'node -e \"process.exit(0)\"'")
      .replace("- pnpm test", "- 'node -e \"process.exit(0)\"'")
      .replace("- pnpm lint", "- 'node -e \"process.exit(2)\"'");
    fs.writeFileSync(profilePath, patched, "utf8");

    const result = verifyProjectRuntime({ projectRef: repoRoot, cwd: repoRoot });

    assert.equal(result.verifySummary.status, "failed");
    assert.equal(result.verifySummary.execution_isolation.requested_mode, "worktree");
    assert.equal(result.verifySummary.execution_isolation.mode, "workspace-clone");
    assert.equal(result.verifySummary.execution_isolation.cleanup.status, "retained");
    assert.equal(fs.existsSync(result.verifySummary.execution_isolation.execution_root), true);
  });
});

test("verifyProjectRuntime reports blocked next step when bounded command fails", () => {
  withTempRepo((repoRoot) => {
    const profilePath = path.join(repoRoot, "examples/project.aor.yaml");
    const profileContent = fs.readFileSync(profilePath, "utf8");
    const patched = profileContent
      .replace("- pnpm build", "- 'node -e \"process.exit(0)\"'")
      .replace("- pnpm test", "- 'node -e \"process.exit(0)\"'")
      .replace("- pnpm lint", "- 'node -e \"process.exit(2)\"'");
    fs.writeFileSync(profilePath, patched, "utf8");

    const result = verifyProjectRuntime({ projectRef: repoRoot, cwd: repoRoot });

    assert.equal(result.verifySummary.status, "failed");
    assert.ok(result.stepResults.some((step) => step.status === "failed"));
    assert.ok(result.stepResults.some((step) => step.command_owner === "main"));
    assert.ok(result.stepResults.some((step) => step.status === "failed" && step.exit_code === 2));
    assert.ok(
      result.stepResults.some(
        (step) => typeof step.blocked_next_step === "string" && step.blocked_next_step.length > 0,
      ),
      "expected blocked_next_step guidance in failed step result",
    );
  });
});

test("verifyProjectRuntime times out long-running verification commands", () => {
  withTempRepo((repoRoot) => {
    const result = verifyProjectRuntime({
      projectRef: repoRoot,
      cwd: repoRoot,
      verificationCommandTimeoutMs: 100,
      repoTestCommands: ['node -e "setTimeout(() => {}, 10000)"'],
    });

    assert.equal(result.verifySummary.status, "failed");
    assert.equal(result.verifySummary.command_timeout_ms, 1000);
    assert.equal(result.verifySummary.timed_out_commands.length, 1);

    const failedStep = result.stepResults.find((step) => step.command === 'node -e "setTimeout(() => {}, 10000)"');
    assert.ok(failedStep);
    assert.equal(failedStep.status, "failed");
    assert.equal(failedStep.timed_out, true);
    assert.equal(failedStep.command_timeout_ms, 1000);
    assert.equal(typeof failedStep.duration_ms, "number");
    assert.equal(failedStep.exit_code, null);
    assert.match(failedStep.summary, /timed out after 1000ms/u);

    const transcript = fs.readFileSync(failedStep.evidence_refs[0], "utf8");
    assert.match(transcript, /timeout_ms: 1000/u);
    assert.match(transcript, /timed_out: true/u);
  });
});

test("verifyProjectRuntime preserves output from commands that write then hang", () => {
  withTempRepo((repoRoot) => {
    const command =
      "node -e \"process.stdout.write('terminal stdout before pipe wait\\n'); process.stderr.write('terminal stderr before pipe wait\\n'); setInterval(() => {}, 10000)\"";
    const result = verifyProjectRuntime({
      projectRef: repoRoot,
      cwd: repoRoot,
      verificationCommandTimeoutMs: 3000,
      repoTestCommands: [command],
    });

    assert.equal(result.verifySummary.status, "failed");
    assert.equal(result.verifySummary.command_timeout_ms, 3000);
    assert.equal(result.verifySummary.timed_out_commands.length, 1);

    const failedStep = result.stepResults.find((step) => step.command === command);
    assert.ok(failedStep);
    assert.equal(failedStep.status, "failed");
    assert.equal(failedStep.timed_out, true);
    assert.equal(failedStep.command_timeout_ms, 3000);
    assert.match(failedStep.output_excerpt.stdout_tail, /terminal stdout before pipe wait/u);
    assert.match(failedStep.output_excerpt.stderr_tail, /terminal stderr before pipe wait/u);

    const transcript = fs.readFileSync(failedStep.evidence_refs[0], "utf8");
    assert.match(transcript, /timed_out: true/u);
    assert.match(transcript, /terminal stdout before pipe wait/u);
    assert.match(transcript, /terminal stderr before pipe wait/u);
  });
});

test("verifyProjectRuntime uses a hard timeout signal for target commands", () => {
  withTempRepo((repoRoot) => {
    const command = 'node -e "process.on(\\"SIGTERM\\", () => {}); setTimeout(() => {}, 10000)"';
    const result = verifyProjectRuntime({
      projectRef: repoRoot,
      cwd: repoRoot,
      verificationCommandTimeoutMs: 100,
      repoTestCommands: [command],
    });

    assert.equal(result.verifySummary.status, "failed");
    const failedStep = result.stepResults.find((step) => step.command === command);
    assert.ok(failedStep);
    assert.equal(failedStep.timed_out, true);

    const transcript = fs.readFileSync(failedStep.evidence_refs[0], "utf8");
    assert.match(transcript, /signal: SIGKILL/u);
  });
});

test("verifyProjectRuntime blocks unsafe preflight defaults before running commands", () => {
  withTempRepo((repoRoot) => {
    const profilePath = path.join(repoRoot, "examples/project.aor.yaml");
    const profileContent = fs.readFileSync(profilePath, "utf8");
    const patched = profileContent
      .replace("workspace_mode: ephemeral", "workspace_mode: persistent")
      .replace("network_mode: deny-by-default", "network_mode: allow");
    fs.writeFileSync(profilePath, patched, "utf8");

    const result = verifyProjectRuntime({ projectRef: repoRoot, cwd: repoRoot });
    assert.equal(result.verifySummary.status, "failed");
    assert.ok(
      result.stepResults.some((step) => step.step_id === "verify.preflight.workspace-isolation" && step.status === "failed"),
    );
    assert.ok(result.stepResults.some((step) => step.step_id === "verify.preflight.network-default" && step.status === "failed"));
  });
});

test("verifyProjectRuntime reports missing prerequisites when command is unavailable", () => {
  withTempRepo((repoRoot) => {
    const profilePath = path.join(repoRoot, "examples/project.aor.yaml");
    const profileContent = fs.readFileSync(profilePath, "utf8");
    const patched = profileContent
      .replace("- pnpm build", "- missing-cli-that-does-not-exist")
      .replace("- pnpm test", "- 'node -e \"process.exit(0)\"'")
      .replace("- pnpm lint", "- 'node -e \"process.exit(0)\"'");
    fs.writeFileSync(profilePath, patched, "utf8");

    const result = verifyProjectRuntime({ projectRef: repoRoot, cwd: repoRoot });

    assert.equal(result.verifySummary.status, "failed");
    assert.ok(
      result.stepResults.some(
        (step) =>
          step.command === "missing-cli-that-does-not-exist" &&
          step.command_group_outcome === "missing-tool" &&
          Array.isArray(step.missing_prerequisites) &&
          step.missing_prerequisites.length > 0,
      ),
      "expected missing prerequisite diagnostics for unavailable command",
    );
  });
});

test("verifyProjectRuntime disables inherited Node compile cache for target commands", () => {
  withTempRepo((repoRoot) => {
    const previousCompileCache = process.env.NODE_COMPILE_CACHE;
    const previousDisableCompileCache = process.env.NODE_DISABLE_COMPILE_CACHE;
    process.env.NODE_COMPILE_CACHE = path.join(repoRoot, ".aor", "node-compile-cache");
    delete process.env.NODE_DISABLE_COMPILE_CACHE;

    try {
      const result = verifyProjectRuntime({
        projectRef: repoRoot,
        cwd: repoRoot,
        repoTestCommands: [
          [
            "node -e",
            JSON.stringify(
              [
                "if (process.env.NODE_COMPILE_CACHE) process.exit(3);",
                "if (process.env.NODE_DISABLE_COMPILE_CACHE !== '1') process.exit(4);",
              ].join(""),
            ),
          ].join(" "),
        ],
      });

      assert.equal(result.verifySummary.status, "passed");
      const transcript = fs.readFileSync(result.stepResults[0].evidence_refs[0], "utf8");
      assert.match(transcript, /node_compile_cache: disabled/);
    } finally {
      if (previousCompileCache === undefined) {
        delete process.env.NODE_COMPILE_CACHE;
      } else {
        process.env.NODE_COMPILE_CACHE = previousCompileCache;
      }

      if (previousDisableCompileCache === undefined) {
        delete process.env.NODE_DISABLE_COMPILE_CACHE;
      } else {
        process.env.NODE_DISABLE_COMPILE_CACHE = previousDisableCompileCache;
      }
    }
  });
});

test("verifyProjectRuntime executes project-profile command groups by verification label", () => {
  withTempRepo((repoRoot) => {
    const profilePath = path.join(repoRoot, "examples/project.aor.yaml");
    const profileContent = fs.readFileSync(profilePath, "utf8");
    const patched = profileContent.replace(
      "repo_graph: []",
      [
        "repo_graph: []",
        "verification:",
        "  command_groups:",
        "    - id: setup-readiness",
        "      role: setup",
        "      phase: readiness",
        "      enforcement: required",
        "      timeout_class: install",
        "      commands:",
        "        - 'node -e \"process.stdout.write(\\\"setup\\\")\"'",
        "    - id: baseline-test",
        "      role: test",
        "      phase: baseline",
        "      enforcement: required",
        "      timeout_class: focused-test",
        "      commands:",
        "        - 'node -e \"process.stdout.write(\\\"baseline\\\")\"'",
        "    - id: post-change-only",
        "      role: test",
        "      phase: post-change",
        "      enforcement: required",
        "      timeout_class: focused-test",
        "      commands:",
        "        - 'node -e \"process.exit(9)\"'",
      ].join("\n"),
    );
    fs.writeFileSync(profilePath, patched, "utf8");

    const result = verifyProjectRuntime({
      projectRef: repoRoot,
      cwd: repoRoot,
      verificationLabel: "baseline-diagnostic",
    });

    assert.equal(result.verifySummary.status, "passed");
    assert.deepEqual(
      result.verifySummary.command_groups.map((group) => group.id),
      ["setup-readiness", "baseline-test"],
    );
    assert.equal(result.stepResults.length, 2);
    assert.ok(result.stepResults.every((step) => step.command_group_enforcement === "required"));
    assert.ok(result.stepResults.every((step) => step.enforcement_result === "pass"));
    assert.equal(result.stepResults.some((step) => step.command.includes("process.exit(9)")), false);
  });
});

test("verifyProjectRuntime executes command groups from configured working_dir", () => {
  withTempRepo((repoRoot) => {
    fs.mkdirSync(path.join(repoRoot, "apps/api"), { recursive: true });
    const profilePath = path.join(repoRoot, "examples/project.aor.yaml");
    const profileContent = fs.readFileSync(profilePath, "utf8");
    const patched = profileContent.replace(
      "repo_graph: []",
      [
        "repo_graph: []",
        "verification:",
        "  command_groups:",
        "    - id: api-test",
        "      role: test",
        "      phase: post-change",
        "      enforcement: required",
        "      timeout_class: focused-test",
        "      working_dir: apps/api",
        "      commands:",
        "        - 'node -e \"require(\\\"node:fs\\\").writeFileSync(\\\"working-dir-marker.txt\\\", \\\"ok\\\")\"'",
      ].join("\n"),
    );
    fs.writeFileSync(profilePath, patched, "utf8");

    const result = verifyProjectRuntime({
      projectRef: repoRoot,
      cwd: repoRoot,
      verificationLabel: "post-run-primary",
    });

    assert.equal(result.verifySummary.status, "passed");
    assert.equal(fs.existsSync(path.join(repoRoot, "working-dir-marker.txt")), false);
    assert.equal(fs.existsSync(path.join(repoRoot, "apps/api/working-dir-marker.txt")), false);
    assert.equal(result.stepResults[0].working_dir, "apps/api");
    assert.match(fs.readFileSync(result.stepResults[0].evidence_refs[0], "utf8"), /command_cwd: .*apps\/api/u);
    assert.equal(result.verifySummary.command_groups[0].working_dir, "apps/api");
  });
});

test("verifyProjectRuntime skips dependent groups after required dependency failure", () => {
  withTempRepo((repoRoot) => {
    const profilePath = path.join(repoRoot, "examples/project.aor.yaml");
    const profileContent = fs.readFileSync(profilePath, "utf8");
    const patched = profileContent.replace(
      "repo_graph: []",
      [
        "repo_graph: []",
        "verification:",
        "  command_groups:",
        "    - id: build-required",
        "      role: build",
        "      phase: post-change",
        "      enforcement: required",
        "      timeout_class: build",
        "      commands:",
        "        - 'node -e \"process.exit(3)\"'",
        "    - id: test-dependent",
        "      role: test",
        "      phase: post-change",
        "      enforcement: required",
        "      timeout_class: focused-test",
        "      depends_on:",
        "        - build-required",
        "      commands:",
        "        - 'node -e \"require(\\\"node:fs\\\").writeFileSync(\\\"should-not-run.txt\\\", \\\"bad\\\")\"'",
      ].join("\n"),
    );
    fs.writeFileSync(profilePath, patched, "utf8");

    const result = verifyProjectRuntime({
      projectRef: repoRoot,
      cwd: repoRoot,
      verificationLabel: "post-run-primary",
    });

    assert.equal(result.verifySummary.status, "failed");
    assert.equal(fs.existsSync(path.join(repoRoot, "should-not-run.txt")), false);
    const skipped = result.stepResults.find((step) => step.command_group_id === "test-dependent");
    assert.ok(skipped);
    assert.equal(skipped.command_group_outcome, "not-applicable");
    assert.match(skipped.summary, /Skipped command group 'test-dependent'/u);
    assert.equal(result.verifySummary.command_groups.find((group) => group.id === "test-dependent").status, "skipped");
    assert.equal(result.verifySummary.skipped_command_groups.length, 1);
  });
});

test("verifyProjectRuntime classifies missing tools and broken baseline outcomes", () => {
  withTempRepo((repoRoot) => {
    const profilePath = path.join(repoRoot, "examples/project.aor.yaml");
    const profileContent = fs.readFileSync(profilePath, "utf8");
    const patched = profileContent.replace(
      "repo_graph: []",
      [
        "repo_graph: []",
        "verification:",
        "  command_groups:",
        "    - id: baseline-missing-tool",
        "      role: test",
        "      phase: baseline",
        "      enforcement: required",
        "      timeout_class: focused-test",
        "      commands:",
        "        - missing-cli-that-does-not-exist",
        "    - id: baseline-broken",
        "      role: test",
        "      phase: baseline",
        "      enforcement: required",
        "      timeout_class: focused-test",
        "      commands:",
        "        - 'node -e \"process.exit(5)\"'",
        "    - id: post-change-broken",
        "      role: test",
        "      phase: post-change",
        "      enforcement: required",
        "      timeout_class: focused-test",
        "      commands:",
        "        - 'node -e \"process.exit(6)\"'",
      ].join("\n"),
    );
    fs.writeFileSync(profilePath, patched, "utf8");

    const baseline = verifyProjectRuntime({
      projectRef: repoRoot,
      cwd: repoRoot,
      verificationLabel: "baseline-diagnostic",
    });
    const postChange = verifyProjectRuntime({
      projectRef: repoRoot,
      cwd: repoRoot,
      verificationLabel: "post-run-primary",
    });

    assert.equal(baseline.verifySummary.status, "failed");
    assert.equal(baseline.verifySummary.missing_tool_commands.length, 1);
    assert.ok(baseline.stepResults.some((step) => step.command_group_outcome === "missing-tool"));
    assert.ok(baseline.stepResults.some((step) => step.command_group_outcome === "broken-baseline"));
    assert.equal(baseline.verifySummary.phase_summary.baseline_failed_count, 2);
    assert.equal(baseline.verifySummary.phase_summary.broken_baseline_count, 1);
    assert.equal(postChange.verifySummary.phase_summary.post_change_failed_count, 1);
    assert.equal(postChange.stepResults.some((step) => step.command_group_outcome === "broken-baseline"), false);
  });
});

test("verifyProjectRuntime applies warn and observe command-group enforcement", () => {
  withTempRepo((repoRoot) => {
    const profilePath = path.join(repoRoot, "examples/project.aor.yaml");
    const profileContent = fs.readFileSync(profilePath, "utf8");
    const patched = profileContent.replace(
      "repo_graph: []",
      [
        "repo_graph: []",
        "verification:",
        "  command_groups:",
        "    - id: diagnostic-warn",
        "      role: full-suite",
        "      phase: diagnostic",
        "      enforcement: warn",
        "      timeout_class: full-suite",
        "      commands:",
        "        - 'node -e \"process.exit(7)\"'",
        "    - id: diagnostic-observe",
        "      role: custom",
        "      phase: diagnostic",
        "      enforcement: observe",
        "      timeout_class: quick",
        "      commands:",
        "        - 'node -e \"process.exit(8)\"'",
        "    - id: post-change-observe",
        "      role: custom",
        "      phase: post-change",
        "      enforcement: observe",
        "      timeout_class: quick",
        "      commands:",
        "        - 'node -e \"process.exit(8)\"'",
      ].join("\n"),
    );
    fs.writeFileSync(profilePath, patched, "utf8");

    const diagnostic = verifyProjectRuntime({
      projectRef: repoRoot,
      cwd: repoRoot,
      verificationLabel: "post-run-diagnostic",
    });

    assert.equal(diagnostic.verifySummary.status, "warn");
    assert.equal(diagnostic.verifySummary.enforcement_summary.required_failed_count, 0);
    assert.equal(diagnostic.verifySummary.enforcement_summary.warn_failed_count, 1);
    assert.equal(diagnostic.verifySummary.enforcement_summary.observe_failed_count, 1);
    assert.equal(
      diagnostic.stepResults.find((step) => step.command_group_id === "diagnostic-warn").enforcement_result,
      "warn",
    );
    assert.equal(
      diagnostic.stepResults.find((step) => step.command_group_id === "diagnostic-observe").enforcement_result,
      "observe",
    );

    const observedOnly = verifyProjectRuntime({
      projectRef: repoRoot,
      cwd: repoRoot,
      verificationLabel: "post-run-primary",
    });
    assert.equal(observedOnly.verifySummary.status, "passed");
    assert.equal(observedOnly.verifySummary.enforcement_summary.observe_failed_count, 1);
  });
});

test("verifyProjectRuntime uses timeout-class defaults when profile timeout is omitted", () => {
  withTempRepo((repoRoot) => {
    const profilePath = path.join(repoRoot, "examples/project.aor.yaml");
    const profileContent = fs.readFileSync(profilePath, "utf8");
    const patched = profileContent.replace(
      "repo_graph: []",
      [
        "repo_graph: []",
        "verification:",
        "  command_groups:",
        "    - id: diagnostic-full-suite",
        "      role: full-suite",
        "      phase: diagnostic",
        "      enforcement: warn",
        "      timeout_class: full-suite",
        "      commands:",
        "        - 'node -e \"process.exit(0)\"'",
      ].join("\n"),
    );
    fs.writeFileSync(profilePath, patched, "utf8");

    const result = verifyProjectRuntime({
      projectRef: repoRoot,
      cwd: repoRoot,
      verificationLabel: "post-run-diagnostic",
    });

    assert.equal(result.verifySummary.status, "passed");
    assert.equal(result.verifySummary.command_timeout_ms, 7200000);
    assert.equal(result.stepResults[0].command_group_timeout_class, "full-suite");
    assert.equal(result.stepResults[0].command_timeout_ms, 7200000);
  });
});

test("verifyProjectRuntime handles generic project archetype command groups without live E2E fields", () => {
  const scenarios = [
    {
      name: "node-package",
      label: "baseline-diagnostic",
      expectedStatus: "passed",
      groups: [
        ["node-build", "build", "baseline", "required", "build", 'node -e "process.exit(0)"'],
        ["node-test", "test", "baseline", "required", "focused-test", 'node -e "process.exit(0)"'],
      ],
    },
    {
      name: "python-package",
      label: "baseline-diagnostic",
      expectedStatus: "passed",
      groups: [
        ["python-setup", "setup", "readiness", "required", "install", 'node -e "process.exit(0)"'],
        ["python-tests", "test", "baseline", "required", "focused-test", 'node -e "process.exit(0)"'],
      ],
    },
    {
      name: "monorepo",
      label: "post-run-primary",
      expectedStatus: "passed",
      groups: [
        ["workspace-build", "build", "post-change", "required", "build", 'node -e "process.exit(0)"'],
        ["workspace-test", "test", "post-change", "required", "focused-test", 'node -e "process.exit(0)"'],
      ],
    },
    {
      name: "no-tests",
      label: "post-run-primary",
      expectedStatus: "passed",
      groups: [
        ["no-tests-build", "build", "post-change", "required", "build", 'node -e "process.exit(0)"'],
        ["no-tests-lint", "lint", "post-change", "required", "quick", 'node -e "process.exit(0)"'],
      ],
    },
    {
      name: "broken-baseline",
      label: "baseline-diagnostic",
      expectedStatus: "failed",
      groups: [
        ["broken-baseline-test", "test", "baseline", "required", "focused-test", 'node -e "process.exit(5)"'],
      ],
    },
  ];

  for (const scenario of scenarios) {
    withTempRepo((repoRoot) => {
      const profilePath = path.join(repoRoot, "examples/project.aor.yaml");
      const profileContent = fs.readFileSync(profilePath, "utf8");
      const groupYaml = scenario.groups.flatMap(([id, role, phase, enforcement, timeoutClass, command]) => [
        `    - id: ${id}`,
        `      role: ${role}`,
        `      phase: ${phase}`,
        `      enforcement: ${enforcement}`,
        `      timeout_class: ${timeoutClass}`,
        "      commands:",
        `        - '${command.replace(/'/gu, "''")}'`,
      ]);
      const patched = profileContent.replace(
        "repo_graph: []",
        ["repo_graph: []", "verification:", "  command_groups:", ...groupYaml].join("\n"),
      );
      fs.writeFileSync(profilePath, patched, "utf8");

      const result = verifyProjectRuntime({
        projectRef: repoRoot,
        cwd: repoRoot,
        verificationLabel: scenario.label,
      });

      assert.equal(result.verifySummary.status, scenario.expectedStatus, scenario.name);
      assert.ok(result.verifySummary.command_groups.length > 0, scenario.name);
      const serializedSummary = JSON.stringify(result.verifySummary);
      assert.equal(/live_e2e|live-e2e|target_readiness|diagnostic_health|step_quality/u.test(serializedSummary), false);
    });
  }
});
