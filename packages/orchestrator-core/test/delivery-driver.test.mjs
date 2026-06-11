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
const fixturesDir = path.join(currentDir, "fixtures");

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
 * @param {string} repoRoot
 */
function removeTempRepo(repoRoot) {
  try {
    fs.rmSync(repoRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch {
    spawnSync("rm", ["-rf", repoRoot], { encoding: "utf8" });
  }
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
    removeTempRepo(repoRoot);
  }
}

/**
 * @param {{
 *   init: ReturnType<typeof initializeProjectRuntime>,
 *   runId: string,
 *   mode: "patch-only" | "local-branch" | "fork-first-pr",
 *   coordinationRepos?: Array<{ repo_id: string, role?: string, default_branch?: string, source_root?: string, source_kind?: string }>,
 *   coordinationEvidenceRefs?: string[],
 *   coordinationLockEvidenceRefs?: string[],
 *   crossRepoValidationRefs?: string[],
 *   rerunOfRunRef?: string,
 *   rerunFailedStepRef?: string,
 *   rerunPacketBoundary?: string,
 *   runtimeHarnessGate?: Record<string, unknown>,
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
    coordinationRepos: options.coordinationRepos,
    coordinationEvidenceRefs: options.coordinationEvidenceRefs,
    coordinationLockEvidenceRefs: options.coordinationLockEvidenceRefs,
    crossRepoValidationRefs: options.crossRepoValidationRefs,
    runtimeHarnessGate: options.runtimeHarnessGate,
    rerunOfRunRef: options.rerunOfRunRef,
    rerunFailedStepRef: options.rerunFailedStepRef,
    rerunPacketBoundary: options.rerunPacketBoundary,
  });

  return {
    deliveryPlanFile: plan.deliveryPlanFile,
  };
}

/**
 * @param {string} workspace
 * @returns {string}
 */
function createMockGhCli(workspace) {
  const mockPath = path.join(workspace, "mock-gh.mjs");
  const mockScript = [
    "#!/usr/bin/env node",
    "const args = process.argv.slice(2);",
    "if (args.length === 1 && args[0] === '--version') {",
    "  process.stdout.write('gh version 9.9.9-mock\\n');",
    "  process.exit(0);",
    "}",
    "const endpoint = args.find((entry) => entry.startsWith('/repos/')) || '';",
    "if (endpoint === '/repos/aor-bot/openai') {",
    "  process.stdout.write(JSON.stringify({ full_name: 'aor-bot/openai', html_url: 'https://github.com/aor-bot/openai' }));",
    "  process.exit(0);",
    "}",
    "if (endpoint === '/repos/openai/openai/forks') {",
    "  process.stdout.write(JSON.stringify({ full_name: 'aor-bot/openai', html_url: 'https://github.com/aor-bot/openai' }));",
    "  process.exit(0);",
    "}",
    "if (endpoint === '/repos/openai/openai/pulls') {",
    "  process.stdout.write(JSON.stringify({ number: 4321, html_url: 'https://github.com/openai/openai/pull/4321' }));",
    "  process.exit(0);",
    "}",
    "process.stderr.write(`mock-gh: unsupported args ${args.join(' ')}\\n`);",
    "process.exit(1);",
  ].join("\n");
  fs.writeFileSync(mockPath, `${mockScript}\n`, "utf8");
  fs.chmodSync(mockPath, 0o755);
  return mockPath;
}

/**
 * @param {ReturnType<typeof runDeliveryDriver>} result
 */
function assertDeliveryArtifacts(result) {
  assert.equal(fs.existsSync(result.deliveryManifestFile), true);
  assert.equal(fs.existsSync(result.releasePacketFile), true);
  assert.equal(fs.existsSync(result.learningLoopScorecardFile), true);
  assert.equal(fs.existsSync(result.learningLoopHandoffFile), true);

  const manifestLoaded = loadContractFile({
    filePath: result.deliveryManifestFile,
    family: "delivery-manifest",
  });
  assert.equal(manifestLoaded.ok, true);
  assert.equal(manifestLoaded.document.delivery_mode, result.mode);
  assert.equal(typeof manifestLoaded.document.evidence_root, "string");
  assert.equal(typeof manifestLoaded.document.approval_context, "object");
  assert.equal(typeof manifestLoaded.document.repo_deliveries[0].repo_root, "string");
  assert.equal(typeof manifestLoaded.document.source_refs.delivery_execution_root, "string");
  assert.equal(typeof manifestLoaded.document.source_refs.delivery_execution_root_ref, "string");

  const releaseLoaded = loadContractFile({
    filePath: result.releasePacketFile,
    family: "release-packet",
  });
  assert.equal(releaseLoaded.ok, true);
  assert.equal(typeof releaseLoaded.document.delivery_manifest_ref, "string");
  assert.equal(typeof releaseLoaded.document.evidence_lineage, "object");
  assert.equal(typeof releaseLoaded.document.source_provenance.delivery_execution_root, "string");
  assert.equal(typeof releaseLoaded.document.source_provenance.delivery_execution_root_ref, "string");

  const learningScorecard = JSON.parse(fs.readFileSync(result.learningLoopScorecardFile, "utf8"));
  assert.equal(learningScorecard.run_id, result.runId);
  assert.equal(typeof learningScorecard.source_kind, "string");

  const learningHandoff = JSON.parse(fs.readFileSync(result.learningLoopHandoffFile, "utf8"));
  assert.equal(learningHandoff.run_id, result.runId);
  assert.equal(typeof learningHandoff.scorecard_ref, "string");
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

test("runDeliveryDriver fails when final diff omits Runtime Harness meaningful paths", () => {
  withTempRepo((repoRoot) => {
    const sourceFile = path.join(repoRoot, "examples/project.aor.yaml");
    const testFile = path.join(repoRoot, "examples/project.test.yaml");
    fs.writeFileSync(testFile, "name: delivery-integrity-test\n", "utf8");
    runGitChecked({ cwd: repoRoot, args: ["add", "examples/project.test.yaml"] });
    runGitChecked({ cwd: repoRoot, args: ["commit", "-m", "add delivery integrity fixture"] });

    fs.appendFileSync(sourceFile, "\n# delivery integrity source change\n", "utf8");

    const init = initializeProjectRuntime({ projectRef: repoRoot, cwd: repoRoot });
    const { deliveryPlanFile } = createReadyPlan({
      init,
      runId: "run.delivery.patch.integrity-missing.v1",
      mode: "patch-only",
      runtimeHarnessGate: {
        required: true,
        enforced: true,
        status: "pass",
        reportId: "runtime-harness.delivery-integrity.v1",
        reportRef: "evidence://reports/runtime-harness-delivery-integrity.json",
        overallDecision: "pass",
        runDecision: "pass",
        routedStepDecisionCount: 1,
        meaningfulChangedPaths: ["examples/project.aor.yaml", "examples/project.test.yaml"],
      },
    });

    const result = runDeliveryDriver({
      projectRef: repoRoot,
      cwd: repoRoot,
      runId: "run.delivery.patch.integrity-missing.v1",
      mode: "patch-only",
      deliveryPlanPath: deliveryPlanFile,
    });

    assert.equal(result.status, "failed");
    assert.equal(result.deliveryManifest.status, "failed");
    assert.equal(result.releasePacket.status, "blocked");
    assert.ok(result.changedPaths.includes("examples/project.aor.yaml"));
    assert.equal(result.changedPaths.includes("examples/project.test.yaml"), false);
    assert.deepEqual(result.transcript.delivery_integrity.missing_expected_changed_paths, [
      "examples/project.test.yaml",
    ]);
    assert.match(String(result.transcript.error), /Runtime Harness meaningful changed path/i);
    assertDeliveryArtifacts(result);
  });
});

test("runDeliveryDriver includes expected untracked meaningful paths in patch-only delivery", () => {
  withTempRepo((repoRoot) => {
    const trackedFile = path.join(repoRoot, "examples/project.aor.yaml");
    const newFile = path.join(repoRoot, "examples/generated-output.txt");
    fs.appendFileSync(trackedFile, "\n# delivery integrity tracked change\n", "utf8");
    fs.writeFileSync(newFile, "generated by implementation\n", "utf8");

    const init = initializeProjectRuntime({ projectRef: repoRoot, cwd: repoRoot });
    const { deliveryPlanFile } = createReadyPlan({
      init,
      runId: "run.delivery.patch.untracked-expected.v1",
      mode: "patch-only",
      runtimeHarnessGate: {
        required: true,
        enforced: true,
        status: "pass",
        reportId: "runtime-harness.delivery-untracked.v1",
        reportRef: "evidence://reports/runtime-harness-delivery-untracked.json",
        overallDecision: "pass",
        runDecision: "pass",
        routedStepDecisionCount: 1,
        meaningfulChangedPaths: ["examples/project.aor.yaml", "examples/generated-output.txt"],
      },
    });

    const result = runDeliveryDriver({
      projectRef: repoRoot,
      cwd: repoRoot,
      runId: "run.delivery.patch.untracked-expected.v1",
      mode: "patch-only",
      deliveryPlanPath: deliveryPlanFile,
    });

    assert.equal(result.status, "success");
    assert.ok(result.changedPaths.includes("examples/project.aor.yaml"));
    assert.ok(result.changedPaths.includes("examples/generated-output.txt"));
    assert.equal(result.deliveryManifest.status, "submitted");

    const patchBody = fs.readFileSync(result.outputs.patch_file, "utf8");
    assert.match(patchBody, /examples\/generated-output\.txt/);
    const status = spawnSync("git", ["status", "--short", "--", "examples/generated-output.txt"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).stdout.trim();
    assert.equal(status, "?? examples/generated-output.txt");
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
    assert.equal(typeof result.incidentReportFile, "string");
    assert.equal(fs.existsSync(result.incidentReportFile), true);

    const incidentLoaded = loadContractFile({
      filePath: result.incidentReportFile,
      family: "incident-report",
    });
    assert.equal(incidentLoaded.ok, true);
    assert.ok(Array.isArray(incidentLoaded.document.linked_run_refs));
    assert.ok(incidentLoaded.document.linked_run_refs.some((ref) => String(ref).includes(result.runId)));
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

test("runDeliveryDriver executes networked fork-first flow when explicitly enabled and credentials are present", () => {
  withTempRepo((repoRoot) => {
    runGitChecked({
      cwd: repoRoot,
      args: ["remote", "add", "origin", "https://github.com/openai/openai.git"],
    });
    const targetFile = path.join(repoRoot, "examples/project.aor.yaml");
    fs.appendFileSync(targetFile, "\n# w10-s02 fork-first networked delivery test\n", "utf8");

    const forkRemotePath = path.join(repoRoot, ".tmp-fork-remote.git");
    runGitChecked({
      cwd: repoRoot,
      args: ["init", "--bare", forkRemotePath],
    });
    const mockGhPath = createMockGhCli(repoRoot);

    const init = initializeProjectRuntime({ projectRef: repoRoot, cwd: repoRoot });
    const { deliveryPlanFile } = createReadyPlan({
      init,
      runId: "run.delivery.fork.networked.v1",
      mode: "fork-first-pr",
    });

    const result = runDeliveryDriver({
      projectRef: repoRoot,
      cwd: repoRoot,
      runId: "run.delivery.fork.networked.v1",
      mode: "fork-first-pr",
      deliveryPlanPath: deliveryPlanFile,
      forkOwner: "aor-bot",
      branchName: "aor/w10-s02-fork-networked",
      prTitle: "W10-S02 fork-first networked draft",
      enableNetworkWrite: true,
      githubToken: "test-token",
      githubCliPath: mockGhPath,
      forkRemoteUrl: forkRemotePath,
    });

    assert.equal(result.status, "success");
    assert.equal(result.outputs.network_mode, "networked");
    assert.equal(result.outputs.network_write.requested, true);
    assert.equal(result.outputs.network_write.executed, true);
    assert.equal(result.outputs.network_write.pull_request_number, 4321);
    assert.equal(result.outputs.pr_draft.number, 4321);
    assert.equal(result.outputs.pr_draft.html_url, "https://github.com/openai/openai/pull/4321");
    assert.equal(typeof result.outputs.commit_sha, "string");
    assert.equal(result.outputs.commit_sha.length, 40);
    assert.equal(result.deliveryManifest.writeback_policy.network_mode, "networked");
    assert.equal(result.deliveryManifest.repo_deliveries[0].writeback_result, "fork-pr-draft-created");

    const pushedRef = spawnSync(
      "git",
      ["--git-dir", forkRemotePath, "show-ref", "refs/heads/aor/w10-s02-fork-networked"],
      { encoding: "utf8" },
    );
    assert.equal(pushedRef.status, 0, pushedRef.stderr);
    assertDeliveryArtifacts(result);
  });
});

test("runDeliveryDriver blocks fork-first network execution when credentials are missing", () => {
  withTempRepo((repoRoot) => {
    runGitChecked({
      cwd: repoRoot,
      args: ["remote", "add", "origin", "https://github.com/openai/openai.git"],
    });
    const targetFile = path.join(repoRoot, "examples/project.aor.yaml");
    fs.appendFileSync(targetFile, "\n# w10-s02 missing credentials\n", "utf8");

    const init = initializeProjectRuntime({ projectRef: repoRoot, cwd: repoRoot });
    const { deliveryPlanFile } = createReadyPlan({
      init,
      runId: "run.delivery.fork.missing-credentials.v1",
      mode: "fork-first-pr",
    });

    const result = runDeliveryDriver({
      projectRef: repoRoot,
      cwd: repoRoot,
      runId: "run.delivery.fork.missing-credentials.v1",
      mode: "fork-first-pr",
      deliveryPlanPath: deliveryPlanFile,
      forkOwner: "aor-bot",
      branchName: "aor/w10-s02-missing-creds",
      enableNetworkWrite: true,
      githubToken: "",
    });

    assert.equal(result.status, "failed");
    const transcript = JSON.parse(fs.readFileSync(result.transcriptFile, "utf8"));
    assert.match(String(transcript.error), /GitHub credentials are missing/i);
    assert.equal(transcript.mode, "fork-first-pr");
    assert.ok(transcript.git.commands.every((command) => !command.includes("git push")));
    assert.equal(result.releasePacket.status, "blocked");
    assertDeliveryArtifacts(result);
  });
});

test("runDeliveryDriver persists multi-repo coordination and bounded rerun metadata", () => {
  withTempRepo((repoRoot) => {
    const targetFile = path.join(repoRoot, "examples/project.aor.yaml");
    fs.appendFileSync(targetFile, "\n# w8-s07 coordination rerun metadata\n", "utf8");

    const init = initializeProjectRuntime({ projectRef: repoRoot, cwd: repoRoot });
    const fixture = JSON.parse(
      fs.readFileSync(path.join(fixturesDir, "delivery-rerun-coordination.fixture.json"), "utf8"),
    );
    const { deliveryPlanFile } = createReadyPlan({
      init,
      runId: "run.delivery.rerun.coordination.v1",
      mode: "patch-only",
      coordinationRepos: [
        { repo_id: "main", role: "application", default_branch: "main" },
        { repo_id: "docs", role: "documentation", default_branch: "main" },
      ],
      coordinationEvidenceRefs: ["evidence://coordination/w8-s07"],
      coordinationLockEvidenceRefs: ["evidence://reports/multirepo-coordination-status-w8-s07.json"],
      crossRepoValidationRefs: ["validation://integration/main-docs"],
      rerunOfRunRef: fixture.rerun.rerun_of_run_ref,
      rerunFailedStepRef: fixture.rerun.failed_step_ref,
      rerunPacketBoundary: fixture.rerun.packet_boundary,
    });

    const result = runDeliveryDriver({
      projectRef: repoRoot,
      cwd: repoRoot,
      runId: "run.delivery.rerun.coordination.v1",
      stepId: "deliver.prepare",
      mode: "patch-only",
      deliveryPlanPath: deliveryPlanFile,
    });

    assert.equal(result.status, "success");
    assert.equal(result.deliveryManifest.coordination.required, fixture.coordination_required);
    assert.deepEqual(result.deliveryManifest.coordination.repo_ids, fixture.coordination_repo_ids);
    assert.equal(result.deliveryManifest.rerun_recovery.requested, fixture.rerun.requested);
    assert.equal(result.deliveryManifest.rerun_recovery.status, fixture.rerun.status);
    assert.equal(result.deliveryManifest.rerun_recovery.packet_boundary, fixture.rerun.packet_boundary);
    assert.equal(result.deliveryManifest.rerun_recovery.failed_step_ref, fixture.rerun.failed_step_ref);
    assert.ok(result.releasePacket.evidence_lineage.coordination_refs.includes("evidence://coordination/w8-s07"));
    assert.ok(
      result.releasePacket.evidence_lineage.coordination_lock_refs.includes(
        "evidence://reports/multirepo-coordination-status-w8-s07.json",
      ),
    );
    assert.ok(result.releasePacket.evidence_lineage.cross_repo_validation_refs.includes("validation://integration/main-docs"));
    assert.ok(result.releasePacket.evidence_lineage.rerun_refs.includes(fixture.rerun.rerun_of_run_ref));

    const transcript = JSON.parse(fs.readFileSync(result.transcriptFile, "utf8"));
    assert.equal(transcript.coordination.required, fixture.coordination_required);
    assert.equal(transcript.recovery_scope.packet_boundary, fixture.rerun.packet_boundary);
    assert.equal(transcript.recovery_scope.failed_step_ref, fixture.rerun.failed_step_ref);
  });
});

test("runDeliveryDriver preserves repo-level changed paths for bounded multirepo delivery", () => {
  withTempRepo((repoRoot) => {
    const backendFile = path.join(repoRoot, "repos/backend/src/orders.ts");
    const frontendFile = path.join(repoRoot, "repos/frontend/src/api-client.ts");
    fs.mkdirSync(path.dirname(backendFile), { recursive: true });
    fs.mkdirSync(path.dirname(frontendFile), { recursive: true });
    fs.writeFileSync(backendFile, "export const version = 1;\n", "utf8");
    fs.writeFileSync(frontendFile, "export const version = 1;\n", "utf8");
    runGitChecked({ cwd: repoRoot, args: ["add", "repos"] });
    runGitChecked({ cwd: repoRoot, args: ["commit", "-m", "add bounded multirepo fixture"] });

    fs.writeFileSync(backendFile, "export const version = 2;\n", "utf8");
    fs.writeFileSync(frontendFile, "export const version = 2;\n", "utf8");

    const init = initializeProjectRuntime({ projectRef: repoRoot, cwd: repoRoot });
    const { deliveryPlanFile } = createReadyPlan({
      init,
      runId: "run.delivery.bounded-multirepo.v1",
      mode: "patch-only",
      coordinationRepos: [
        {
          repo_id: "backend",
          role: "backend",
          default_branch: "main",
          source_root: "repos/backend",
          source_kind: "git",
        },
        {
          repo_id: "mobile",
          role: "mobile",
          default_branch: "main",
          source_root: "repos/mobile",
          source_kind: "git",
        },
        {
          repo_id: "frontend",
          role: "frontend",
          default_branch: "main",
          source_root: "repos/frontend",
          source_kind: "git",
        },
      ],
      coordinationEvidenceRefs: ["evidence://coordination/w18-s04"],
      coordinationLockEvidenceRefs: ["evidence://reports/multirepo-coordination-status-w18-s04.json"],
      crossRepoValidationRefs: ["validation://integration/backend-frontend/api-contract"],
    });

    const result = runDeliveryDriver({
      projectRef: repoRoot,
      cwd: repoRoot,
      runId: "run.delivery.bounded-multirepo.v1",
      mode: "patch-only",
      deliveryPlanPath: deliveryPlanFile,
    });

    assert.equal(result.status, "success");
    assert.deepEqual(result.deliveryManifest.coordination.repo_ids, ["backend", "mobile", "frontend"]);
    assert.ok(result.releasePacket.evidence_lineage.coordination_refs.includes("evidence://coordination/w18-s04"));

    const deliveriesByRepo = new Map(
      result.deliveryManifest.repo_deliveries.map((delivery) => [delivery.repo_id, delivery]),
    );
    assert.deepEqual(deliveriesByRepo.get("backend")?.changed_paths, ["repos/backend/src/orders.ts"]);
    assert.deepEqual(deliveriesByRepo.get("frontend")?.changed_paths, ["repos/frontend/src/api-client.ts"]);
    assert.deepEqual(deliveriesByRepo.get("mobile")?.changed_paths, []);
    assert.deepEqual(deliveriesByRepo.get("backend")?.coordination.evidence_refs, [
      "evidence://coordination/w18-s04",
      "evidence://reports/multirepo-coordination-status-w18-s04.json",
      "validation://integration/backend-frontend/api-contract",
    ]);
    assert.deepEqual(deliveriesByRepo.get("backend")?.coordination.lock_evidence_refs, [
      "evidence://reports/multirepo-coordination-status-w18-s04.json",
    ]);
    assert.deepEqual(deliveriesByRepo.get("backend")?.coordination.cross_repo_validation_refs, [
      "validation://integration/backend-frontend/api-contract",
    ]);
  });
});

test("runDeliveryDriver fails safely when rerun failed-step scope does not match executing step", () => {
  withTempRepo((repoRoot) => {
    const targetFile = path.join(repoRoot, "examples/project.aor.yaml");
    fs.appendFileSync(targetFile, "\n# w8-s07 rerun mismatch\n", "utf8");

    const init = initializeProjectRuntime({ projectRef: repoRoot, cwd: repoRoot });
    const { deliveryPlanFile } = createReadyPlan({
      init,
      runId: "run.delivery.rerun.mismatch.v1",
      mode: "patch-only",
      rerunOfRunRef: "run://run.delivery.previous.failed.v1",
      rerunFailedStepRef: "release.prepare",
      rerunPacketBoundary: "release-packet",
    });

    const result = runDeliveryDriver({
      projectRef: repoRoot,
      cwd: repoRoot,
      runId: "run.delivery.rerun.mismatch.v1",
      stepId: "deliver.prepare",
      mode: "patch-only",
      deliveryPlanPath: deliveryPlanFile,
    });

    assert.equal(result.status, "failed");
    const transcript = JSON.parse(fs.readFileSync(result.transcriptFile, "utf8"));
    assert.equal(transcript.status, "failed");
    assert.match(String(transcript.error), /failed_step_ref/i);
    assert.equal(transcript.recovery_scope.failed_step_ref, "release.prepare");
    assert.equal(result.releasePacket.status, "blocked");
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
