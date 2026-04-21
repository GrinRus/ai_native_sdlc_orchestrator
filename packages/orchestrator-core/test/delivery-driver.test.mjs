import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadContractFile } from "../../contracts/src/index.mjs";
import { materializeDeliveryPlan } from "../src/delivery-plan.mjs";
import { runDeliveryDriver } from "../src/delivery-driver.mjs";
import { initializeProjectRuntime } from "../src/project-init.mjs";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const workspaceRoot = path.resolve(currentDir, "../../..");

/**
 * @param {{ cwd: string, args: string[] }} options
 */
function runGitChecked(options) {
  const run = spawnSync("git", options.args, { cwd: options.cwd, encoding: "utf8" });
  assert.equal(
    run.status,
    0,
    `git ${options.args.join(" ")} failed: ${(run.stderr ?? run.stdout ?? "").trim()}`,
  );
}

/**
 * @param {(repoRoot: string) => void} callback
 */
function withTempRepo(callback) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-w4-s03-"));
  fs.cpSync(path.join(workspaceRoot, "examples"), path.join(repoRoot, "examples"), { recursive: true });
  runGitChecked({ cwd: repoRoot, args: ["init"] });
  runGitChecked({ cwd: repoRoot, args: ["config", "user.email", "aor@example.com"] });
  runGitChecked({ cwd: repoRoot, args: ["config", "user.name", "AOR Test"] });
  runGitChecked({ cwd: repoRoot, args: ["add", "-A"] });
  runGitChecked({ cwd: repoRoot, args: ["commit", "-m", "initial"] });

  try {
    callback(repoRoot);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
}

/**
 * @param {{
 *   init: ReturnType<typeof initializeProjectRuntime>,
 *   runId: string,
 *   mode: "patch-only" | "local-branch" | "fork-first-pr",
 * }} options
 * @returns {{ deliveryPlanFile: string }}
 */
function createReadyPlan(options) {
  const plan = materializeDeliveryPlan({
    runtimeLayout: options.init.runtimeLayout,
    projectId: options.init.projectId,
    runId: options.runId,
    stepClass: "implement",
    policyResolution: {
      resolved_bounds: {
        writeback_mode: {
          mode: options.mode,
          resolution_source: {
            kind: "step-override",
            field: "policy_overrides.implement -> writeback_policy.mode",
          },
        },
      },
    },
    handoffApproval: {
      status: "pass",
      ref: path.join(options.init.runtimeLayout.artifactsRoot, `${options.init.projectId}.handoff.bootstrap.v1.json`),
    },
    promotionEvidenceRefs: [
      path.join(options.init.runtimeLayout.reportsRoot, "promotion-decision-wrapper-wrapper.runner.default-v3.json"),
    ],
  });

  return {
    deliveryPlanFile: plan.deliveryPlanFile,
  };
}

/**
 * @param {ReturnType<typeof runDeliveryDriver>} result
 */
function assertDeliveryArtifacts(result) {
  assert.equal(fs.existsSync(result.deliveryManifestFile), true);
  assert.equal(fs.existsSync(result.releasePacketFile), true);

  const manifestLoaded = loadContractFile({
    filePath: result.deliveryManifestFile,
    family: "delivery-manifest",
  });
  assert.equal(manifestLoaded.ok, true);
  assert.equal(manifestLoaded.document.delivery_mode, result.mode);
  assert.equal(typeof manifestLoaded.document.evidence_root, "string");
  assert.equal(typeof manifestLoaded.document.approval_context, "object");

  const releaseLoaded = loadContractFile({
    filePath: result.releasePacketFile,
    family: "release-packet",
  });
  assert.equal(releaseLoaded.ok, true);
  assert.equal(typeof releaseLoaded.document.delivery_manifest_ref, "string");
  assert.equal(typeof releaseLoaded.document.evidence_lineage, "object");
}

test("runDeliveryDriver emits patch artifact and transcript for patch-only mode", () => {
  withTempRepo((repoRoot) => {
    const targetFile = path.join(repoRoot, "examples/project.aor.yaml");
    fs.appendFileSync(targetFile, "\n# w4-s03 patch delivery test\n", "utf8");

    const init = initializeProjectRuntime({ projectRef: repoRoot, cwd: repoRoot });
    const { deliveryPlanFile } = createReadyPlan({
      init,
      runId: "run.delivery.patch.v1",
      mode: "patch-only",
    });

    const result = runDeliveryDriver({
      projectRef: repoRoot,
      cwd: repoRoot,
      runId: "run.delivery.patch.v1",
      mode: "patch-only",
      deliveryPlanPath: deliveryPlanFile,
    });

    assert.equal(result.status, "success");
    assert.equal(fs.existsSync(result.outputs.patch_file), true);
    assert.equal(fs.existsSync(result.transcriptFile), true);
    assert.ok(result.changedPaths.includes("examples/project.aor.yaml"));
    assert.ok(result.diffStats.totals.files >= 1);

    const patchBody = fs.readFileSync(result.outputs.patch_file, "utf8");
    assert.match(patchBody, /examples\/project\.aor\.yaml/);
    assertDeliveryArtifacts(result);
  });
});

test("runDeliveryDriver commits to bounded local branch and captures commit metadata", () => {
  withTempRepo((repoRoot) => {
    const targetFile = path.join(repoRoot, "examples/project.aor.yaml");
    fs.appendFileSync(targetFile, "\n# w4-s03 local-branch delivery test\n", "utf8");

    const init = initializeProjectRuntime({ projectRef: repoRoot, cwd: repoRoot });
    const { deliveryPlanFile } = createReadyPlan({
      init,
      runId: "run.delivery.branch.v1",
      mode: "local-branch",
    });

    const result = runDeliveryDriver({
      projectRef: repoRoot,
      cwd: repoRoot,
      runId: "run.delivery.branch.v1",
      mode: "local-branch",
      branchName: "aor/w4-s03-local-branch",
      deliveryPlanPath: deliveryPlanFile,
    });

    assert.equal(result.status, "success");
    assert.equal(result.outputs.branch_name, "aor/w4-s03-local-branch");
    assert.equal(typeof result.outputs.commit_sha, "string");
    assert.equal(result.outputs.commit_sha.length, 40);
    assert.ok(result.changedPaths.includes("examples/project.aor.yaml"));

    const branchName = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).stdout.trim();
    assert.equal(branchName, "aor/w4-s03-local-branch");

    const transcript = JSON.parse(fs.readFileSync(result.transcriptFile, "utf8"));
    assert.equal(transcript.status, "success");
    assert.equal(Array.isArray(transcript.git.commands), true);
    assert.equal(transcript.git.commands.some((command) => command.includes("push")), false);
    assertDeliveryArtifacts(result);
  });
});

test("runDeliveryDriver records recovery guidance when local-branch mode fails mid-run", () => {
  withTempRepo((repoRoot) => {
    const targetFile = path.join(repoRoot, "examples/project.aor.yaml");
    fs.appendFileSync(targetFile, "\n# w4-s03 local-branch failure test\n", "utf8");

    const init = initializeProjectRuntime({ projectRef: repoRoot, cwd: repoRoot });
    const { deliveryPlanFile } = createReadyPlan({
      init,
      runId: "run.delivery.branch.fail.v1",
      mode: "local-branch",
    });

    const result = runDeliveryDriver({
      projectRef: repoRoot,
      cwd: repoRoot,
      runId: "run.delivery.branch.fail.v1",
      mode: "local-branch",
      branchName: "aor/w4 s03 local branch fail",
      deliveryPlanPath: deliveryPlanFile,
    });

    assert.equal(result.status, "failed");
    assert.equal(fs.existsSync(result.transcriptFile), true);

    const transcript = JSON.parse(fs.readFileSync(result.transcriptFile, "utf8"));
    assert.equal(transcript.status, "failed");
    assert.match(String(transcript.error), /checkout -B/i);
    assert.ok(Array.isArray(transcript.recovery_steps));
    assert.ok(transcript.recovery_steps.some((step) => step.includes("git checkout")));
    assertDeliveryArtifacts(result);

    const releaseLoaded = loadContractFile({
      filePath: result.releasePacketFile,
      family: "release-packet",
    });
    assert.equal(releaseLoaded.ok, true);
    assert.equal(releaseLoaded.document.status, "blocked");
  });
});

test("runDeliveryDriver builds fork-first PR metadata in stubbed network mode", () => {
  withTempRepo((repoRoot) => {
    runGitChecked({
      cwd: repoRoot,
      args: ["remote", "add", "origin", "https://github.com/openai/openai.git"],
    });
    const targetFile = path.join(repoRoot, "examples/project.aor.yaml");
    fs.appendFileSync(targetFile, "\n# w4-s04 fork-first delivery test\n", "utf8");

    const init = initializeProjectRuntime({ projectRef: repoRoot, cwd: repoRoot });
    const { deliveryPlanFile } = createReadyPlan({
      init,
      runId: "run.delivery.fork.v1",
      mode: "fork-first-pr",
    });

    const result = runDeliveryDriver({
      projectRef: repoRoot,
      cwd: repoRoot,
      runId: "run.delivery.fork.v1",
      mode: "fork-first-pr",
      deliveryPlanPath: deliveryPlanFile,
      forkOwner: "aor-bot",
      branchName: "aor/w4-s04-fork-first",
      prTitle: "W4-S04 fork-first draft",
    });

    assert.equal(result.status, "success");
    assert.equal(result.outputs.network_mode, "stubbed");
    assert.equal(result.outputs.fork_target.upstream_repo, "openai/openai");
    assert.equal(result.outputs.fork_target.fork_repo, "aor-bot/openai");
    assert.equal(result.outputs.pr_draft.is_draft, true);
    assert.equal(fs.existsSync(result.outputs.api_intent_file), true);

    const transcript = JSON.parse(fs.readFileSync(result.transcriptFile, "utf8"));
    assert.equal(transcript.status, "success");
    assert.equal(transcript.mode, "fork-first-pr");
    assert.equal(transcript.git.commands.some((command) => command.includes("push")), false);
    assertDeliveryArtifacts(result);
  });
});

test("runDeliveryDriver artifacts reload after runtime restart", () => {
  withTempRepo((repoRoot) => {
    const targetFile = path.join(repoRoot, "examples/project.aor.yaml");
    fs.appendFileSync(targetFile, "\n# w4-s05 reload test\n", "utf8");

    const init = initializeProjectRuntime({ projectRef: repoRoot, cwd: repoRoot });
    const { deliveryPlanFile } = createReadyPlan({
      init,
      runId: "run.delivery.reload.v1",
      mode: "patch-only",
    });

    const firstRun = runDeliveryDriver({
      projectRef: repoRoot,
      cwd: repoRoot,
      runId: "run.delivery.reload.v1",
      mode: "patch-only",
      deliveryPlanPath: deliveryPlanFile,
    });
    assert.equal(firstRun.status, "success");

    const restarted = initializeProjectRuntime({ projectRef: repoRoot, cwd: repoRoot });
    assert.equal(restarted.projectId, firstRun.projectId);

    const manifestReload = loadContractFile({
      filePath: firstRun.deliveryManifestFile,
      family: "delivery-manifest",
    });
    assert.equal(manifestReload.ok, true);
    assert.equal(manifestReload.document.delivery_mode, "patch-only");
    assert.equal(manifestReload.document.step_ref, "delivery.apply");
    assert.ok(Array.isArray(manifestReload.document.repo_deliveries));
    assert.ok(manifestReload.document.repo_deliveries[0].changed_paths.includes("examples/project.aor.yaml"));
    assert.equal(typeof manifestReload.document.approval_context, "object");

    const releaseReload = loadContractFile({
      filePath: firstRun.releasePacketFile,
      family: "release-packet",
    });
    assert.equal(releaseReload.ok, true);
    assert.equal(releaseReload.document.delivery_manifest_ref.includes("delivery-manifest"), true);
    assert.equal(typeof releaseReload.document.evidence_lineage, "object");
    assert.ok(Array.isArray(releaseReload.document.evidence_lineage.handoff_refs));
    assert.ok(Array.isArray(releaseReload.document.evidence_lineage.promotion_refs));
    assert.ok(Array.isArray(releaseReload.document.evidence_lineage.execution_refs));
  });
});
