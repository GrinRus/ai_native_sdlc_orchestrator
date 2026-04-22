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
