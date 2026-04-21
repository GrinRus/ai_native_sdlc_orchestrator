import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateContractDocument } from "../../../packages/contracts/src/index.mjs";
import { materializeDeliveryPlan } from "../../../packages/orchestrator-core/src/delivery-plan.mjs";
import { runDeliveryDriver } from "../../../packages/orchestrator-core/src/delivery-driver.mjs";
import { initializeProjectRuntime } from "../../../packages/orchestrator-core/src/project-init.mjs";
import {
  listDeliveryManifests,
  listPacketArtifacts,
  listPromotionDecisions,
  listQualityArtifacts,
  listRuns,
  listStepResults,
  readProjectState,
} from "../src/read-surface.mjs";

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
 * @param {{ family: import("../../../packages/contracts/src/index.d.ts").ContractFamily, filePath: string, document: Record<string, unknown> }} options
 */
function writeContractFile(options) {
  const validation = validateContractDocument({
    family: options.family,
    document: options.document,
    source: `runtime://${options.family}`,
  });
  assert.equal(validation.ok, true, `${options.family} fixture must pass contract validation`);
  fs.writeFileSync(options.filePath, `${JSON.stringify(options.document, null, 2)}\n`, "utf8");
}

/**
 * @param {(repoRoot: string) => void} callback
 */
function withTempRepo(callback) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-w5-s01-"));
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

test("read surface exposes project state, packets, runs, and quality artifacts", () => {
  withTempRepo((repoRoot) => {
    const runId = "run.api.read.v1";
    const init = initializeProjectRuntime({ projectRef: repoRoot, cwd: repoRoot });

    const promotionDecisionPath = path.join(init.runtimeLayout.artifactsRoot, "promotion-decision-seed.json");
    writeContractFile({
      family: "promotion-decision",
      filePath: promotionDecisionPath,
      document: {
        decision_id: `${init.projectId}.promotion.seed`,
        subject_ref: "wrapper://wrapper.runner.default@v3",
        from_channel: "candidate",
        to_channel: "stable",
        evidence_refs: [init.stateFile],
        evidence_summary: {
          reason: "seed fixture for read-surface smoke test",
        },
        status: "pass",
      },
    });

    const plan = materializeDeliveryPlan({
      runtimeLayout: init.runtimeLayout,
      projectId: init.projectId,
      runId,
      stepClass: "implement",
      policyResolution: {
        resolved_bounds: {
          writeback_mode: {
            mode: "patch-only",
            resolution_source: {
              kind: "project-default",
              field: "writeback_policy.default_delivery_mode",
            },
          },
        },
      },
      handoffApproval: {
        status: "pass",
        ref: path.join(init.runtimeLayout.artifactsRoot, `${init.projectId}.handoff.bootstrap.v1.json`),
      },
      promotionEvidenceRefs: [promotionDecisionPath],
    });

    const targetFile = path.join(repoRoot, "examples/project.aor.yaml");
    fs.appendFileSync(targetFile, "\n# w5-s01 api read smoke\n", "utf8");
    const deliveryResult = runDeliveryDriver({
      projectRef: repoRoot,
      cwd: repoRoot,
      runId,
      mode: "patch-only",
      deliveryPlanPath: plan.deliveryPlanFile,
    });
    assert.equal(deliveryResult.status, "success");

    writeContractFile({
      family: "step-result",
      filePath: path.join(init.runtimeLayout.reportsRoot, "step-result-routed-implement.json"),
      document: {
        step_result_id: `${runId}.step.implement`,
        run_id: runId,
        step_id: "routed.implement",
        step_class: "runner",
        status: "passed",
        summary: "Routed dry-run implement step passed.",
        evidence_refs: [deliveryResult.transcriptFile],
      },
    });

    writeContractFile({
      family: "validation-report",
      filePath: path.join(init.runtimeLayout.reportsRoot, "validation-report-runtime.json"),
      document: {
        report_id: `${init.projectId}.validation.runtime`,
        subject_ref: `project://${init.projectId}`,
        validators: ["contract-shape"],
        status: "pass",
        evidence_refs: [init.stateFile],
      },
    });

    writeContractFile({
      family: "evaluation-report",
      filePath: path.join(init.runtimeLayout.reportsRoot, "evaluation-report-runtime.json"),
      document: {
        report_id: `${init.projectId}.evaluation.runtime`,
        subject_ref: "wrapper://wrapper.runner.default@v3",
        subject_type: "wrapper-profile",
        subject_fingerprint: "wrapper.runner.default-v3",
        suite_ref: "suite.release.core@v1",
        dataset_ref: "dataset://dataset.release.core@v1",
        scorer_metadata: [{ scorer: "deterministic", version: "1" }],
        grader_results: { deterministic: { status: "pass", score: 1 } },
        summary_metrics: { overall_score: 1, pass_rate: 1 },
        status: "pass",
        evidence_refs: [deliveryResult.transcriptFile],
      },
    });

    const projectState = readProjectState({ projectRef: repoRoot, cwd: repoRoot });
    assert.equal(projectState.project_id, init.projectId);
    assert.equal(projectState.project_root, repoRoot);

    const packets = listPacketArtifacts({ projectRef: repoRoot, cwd: repoRoot });
    assert.ok(packets.some((packet) => packet.family === "artifact-packet"));
    assert.ok(packets.some((packet) => packet.family === "delivery-plan"));
    assert.ok(packets.some((packet) => packet.family === "delivery-manifest"));
    assert.ok(packets.some((packet) => packet.family === "release-packet"));

    const stepResults = listStepResults({ projectRef: repoRoot, cwd: repoRoot });
    assert.ok(stepResults.some((result) => result.document.run_id === runId));

    const manifests = listDeliveryManifests({ projectRef: repoRoot, cwd: repoRoot });
    assert.ok(manifests.some((manifest) => manifest.document.delivery_mode === "patch-only"));

    const promotions = listPromotionDecisions({ projectRef: repoRoot, cwd: repoRoot });
    assert.ok(promotions.some((decision) => decision.document.status === "pass"));

    const qualityArtifacts = listQualityArtifacts({ projectRef: repoRoot, cwd: repoRoot });
    assert.ok(qualityArtifacts.some((artifact) => artifact.family === "validation-report"));
    assert.ok(qualityArtifacts.some((artifact) => artifact.family === "evaluation-report"));
    assert.ok(qualityArtifacts.some((artifact) => artifact.family === "promotion-decision"));

    const runs = listRuns({ projectRef: repoRoot, cwd: repoRoot });
    const runSummary = runs.find((run) => run.run_id === runId);
    assert.ok(runSummary);
    assert.ok(runSummary.packet_refs.length >= 1);
    assert.ok(runSummary.step_result_refs.length >= 1);
  });
});
