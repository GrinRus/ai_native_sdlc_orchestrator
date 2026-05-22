import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { verifyProjectRuntime } from "../src/project-verify.mjs";

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
    assert.equal(result.verifySummary.execution_isolation.mode, "ephemeral");
    assert.equal(result.verifySummary.execution_isolation.execution_root, repoRoot);
    assert.equal(result.verifySummary.execution_isolation.cleanup.status, "skipped");
    assert.equal(fs.existsSync(result.verifySummaryPath), true);
    assert.equal(result.stepResultFiles.every((filePath) => fs.existsSync(filePath)), true);
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
    assert.equal(result.verifySummary.execution_isolation.mode, "worktree");
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
    assert.match(failedStep.summary, /timed out after 1000ms/u);

    const transcript = fs.readFileSync(failedStep.evidence_refs[0], "utf8");
    assert.match(transcript, /timeout_ms: 1000/u);
    assert.match(transcript, /timed_out: true/u);
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
