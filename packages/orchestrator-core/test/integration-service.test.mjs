import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";

import {
  applyIntegrationToParent,
  computeIntegrationInputFingerprint,
  computeStaleBoundary,
  integrateParentRun,
  requestIntegrationRepair,
} from "../src/integration-service.mjs";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aor-integration-"));
  const source = path.join(root, "source");
  const runtime = path.join(root, ".aor", "projects", "aor-core");
  fs.mkdirSync(source, { recursive: true });
  fs.mkdirSync(path.join(runtime, "reports"), { recursive: true });
  fs.mkdirSync(path.join(runtime, "state"), { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: source });
  fs.writeFileSync(path.join(source, "base.txt"), "base\n");
  execFileSync("git", ["add", "base.txt"], { cwd: source });
  execFileSync("git", ["-c", "user.name=AOR", "-c", "user.email=aor@example.test", "commit", "-qm", "base"], { cwd: source });
  const base = execFileSync("git", ["rev-parse", "HEAD"], { cwd: source, encoding: "utf8" }).trim();
  return {
    root,
    source,
    runtimeLayout: { reportsRoot: path.join(runtime, "reports"), stateRoot: path.join(runtime, "state") },
    workspaceSet: {
      workspace_set_id: "workspace-set-parent-run-1",
      project_id: "aor-core",
      run_id: "parent-run-1",
      status: "ready",
      repositories: [{ repo_id: "main", mount_path: "repos/main", execution_root: path.relative(root, source), resolved_commit: base }],
    },
    parent: {
      parent_run_id: "parent-run-1",
      project_id: "aor-core",
      units: [
        { execution_unit_id: "unit-a", depends_on: [] },
        { execution_unit_id: "unit-b", depends_on: ["unit-a"] },
      ],
    },
  };
}

function patchOutput(fx, unitId, file, content) {
  fs.writeFileSync(path.join(fx.source, file), content);
  const patch = execFileSync("git", ["diff", "--binary"], { cwd: fx.source });
  execFileSync("git", ["checkout", "--", "."], { cwd: fx.source });
  const outputFile = path.join(fx.root, `${unitId}.patch`);
  fs.writeFileSync(outputFile, patch);
  return {
    project_id: "aor-core",
    parent_run_id: "parent-run-1",
    execution_unit_id: unitId,
    child_run_id: `child-${unitId}`,
    attempt: 1,
    repo_id: "main",
    output_kind: "patch",
    output_ref: `evidence://patches/${unitId}.patch`,
    output_file: outputFile,
    output_digest: crypto.createHash("sha256").update(patch).digest("hex"),
    changed_paths: [file],
  };
}

test("integration applies immutable outputs in dependency order and gates parent closure", () => {
  const fx = fixture();
  const outputA = patchOutput(fx, "unit-a", "base.txt", "base\na\n");
  fs.writeFileSync(path.join(fx.source, "base.txt"), "base\na\n");
  execFileSync("git", ["add", "base.txt"], { cwd: fx.source });
  execFileSync("git", ["-c", "user.name=AOR", "-c", "user.email=aor@example.test", "commit", "-qm", "a"], { cwd: fx.source });
  const outputB = patchOutput(fx, "unit-b", "base.txt", "base\na\nb\n");
  execFileSync("git", ["reset", "--hard", "HEAD~1"], { cwd: fx.source });
  const sourceHeadBefore = execFileSync("git", ["rev-parse", "HEAD"], { cwd: fx.source, encoding: "utf8" }).trim();
  const sourceStatusBefore = execFileSync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], { cwd: fx.source, encoding: "utf8" });
  const sourceBytesBefore = fs.readFileSync(path.join(fx.source, "base.txt"));

  const result = integrateParentRun({
    ...fx,
    projectRoot: fx.root,
    projectId: "aor-core",
    parentRunId: "parent-run-1",
    executionPlanRef: "evidence://execution-plan.json",
    workspaceSetRef: "evidence://workspace-set.json",
    childOutputs: [outputB, outputA],
    aggregateGates: [{ gate_id: "integration-tests", kind: "verification", required: true }],
    runGate: () => ({ status: "passed", evidence_refs: ["evidence://integration-tests.json"] }),
    now: "2026-07-17T00:00:00.000Z",
  });
  assert.equal(result.report.status, "passed");
  assert.deepEqual(result.report.source_attempts.map((entry) => entry.execution_unit_id), ["unit-a", "unit-b"]);
  assert.equal(fs.readFileSync(path.join(result.workspaceRoot, "repos/main/base.txt"), "utf8"), "base\na\nb\n");
  assert.equal(result.report.repository_results[0].workspace_isolation.distinct_gitdir, true);
  assert.equal(result.report.repository_results[0].workspace_isolation.distinct_index, true);
  assert.deepEqual(result.report.repository_results[0].workspace_isolation.source_integrity, { head_unchanged: true, status_unchanged: true, bytes_unchanged: true });
  assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { cwd: fx.source, encoding: "utf8" }).trim(), sourceHeadBefore);
  assert.equal(execFileSync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], { cwd: fx.source, encoding: "utf8" }), sourceStatusBefore);
  assert.deepEqual(fs.readFileSync(path.join(fx.source, "base.txt")), sourceBytesBefore);

  const parentFile = path.join(fx.runtimeLayout.stateRoot, "parent-runs", "parent-run-parent-run-1.json");
  fs.mkdirSync(path.dirname(parentFile), { recursive: true });
  fs.writeFileSync(parentFile, `${JSON.stringify({ ...fx.parent, revision: 0, status: "integration-pending" })}\n`);
  const parent = applyIntegrationToParent({
    parentFile,
    expectedRevision: 0,
    reportFile: result.reportFile,
    integrationReportRef: "evidence://integration-report.json",
  });
  assert.equal(parent.status, "succeeded");
  assert.equal(parent.revision, 1);
  assert.equal(parent.integration_report_digest, result.authority.report_digest);
});

test("parent rejects a client-authored integration report outside authoritative materialization", () => {
  const fx = fixture();
  const parentFile = path.join(fx.runtimeLayout.stateRoot, "parent-runs", "parent-run-parent-run-1.json");
  fs.mkdirSync(path.dirname(parentFile), { recursive: true });
  fs.writeFileSync(parentFile, `${JSON.stringify({ ...fx.parent, revision: 0, status: "integration-pending" })}\n`);
  const forged = path.join(fx.root, "forged-integration-report.json");
  fs.writeFileSync(forged, `${JSON.stringify({
    project_id: "aor-core",
    parent_run_id: "parent-run-1",
    status: "passed",
    aggregate_gates: [],
  })}\n`);
  assert.throws(
    () => applyIntegrationToParent({
      parentFile,
      expectedRevision: 0,
      reportFile: forged,
      integrationReportRef: "evidence://forged-integration-report.json",
    }),
    (error) => error.code === "integration-report-not-authoritative",
  );
});

test("integration verifies commit object ancestry and records measured output facts", () => {
  const fx = fixture();
  fs.writeFileSync(path.join(fx.source, "commit.txt"), "commit output\n");
  execFileSync("git", ["add", "commit.txt"], { cwd: fx.source });
  execFileSync("git", ["-c", "user.name=AOR", "-c", "user.email=aor@example.test", "commit", "-qm", "commit-output"], { cwd: fx.source });
  const commitSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: fx.source, encoding: "utf8" }).trim();
  const result = integrateParentRun({
    ...fx,
    parent: { units: [{ execution_unit_id: "unit-a", depends_on: [] }] },
    projectRoot: fx.root,
    projectId: "aor-core",
    parentRunId: "parent-run-1",
    executionPlanRef: "evidence://execution-plan.json",
    workspaceSetRef: "evidence://workspace-set.json",
    childOutputs: [{
      project_id: "aor-core",
      parent_run_id: "parent-run-1",
      execution_unit_id: "unit-a",
      child_run_id: "child-unit-a",
      attempt: 1,
      repo_id: "main",
      output_kind: "commit",
      output_ref: "evidence://commits/unit-a.json",
      commit_sha: commitSha,
      changed_paths: ["commit.txt"],
    }],
    aggregateGates: [],
  });
  assert.equal(result.report.status, "passed");
  assert.deepEqual(result.report.source_attempts[0].measured_changed_paths, ["commit.txt"]);
  assert.equal(fs.readFileSync(path.join(result.workspaceRoot, "repos/main/commit.txt"), "utf8"), "commit output\n");
});

test("integration retains deterministic conflict and missing-output evidence", () => {
  const fx = fixture();
  // Build a patch whose context is incompatible with the authoritative base;
  // integration must reject it even when the child checkout is disposable.
  fs.writeFileSync(path.join(fx.source, "base.txt"), "incompatible\n");
  execFileSync("git", ["add", "base.txt"], { cwd: fx.source });
  fs.writeFileSync(path.join(fx.source, "base.txt"), "incompatible\nchanged\n");
  const patch = execFileSync("git", ["diff", "--binary"], { cwd: fx.source });
  execFileSync("git", ["reset", "--hard", "HEAD"], { cwd: fx.source });
  const outputFile = path.join(fx.root, "unit-a.patch");
  fs.writeFileSync(outputFile, patch);
  const output = {
    project_id: "aor-core",
    parent_run_id: "parent-run-1",
    execution_unit_id: "unit-a",
    child_run_id: "child-unit-a",
    attempt: 1,
    repo_id: "main",
    output_kind: "patch",
    output_ref: "evidence://patches/unit-a.patch",
    output_file: outputFile,
    output_digest: crypto.createHash("sha256").update(patch).digest("hex"),
    changed_paths: ["base.txt"],
  };
  const result = integrateParentRun({
    ...fx,
    projectRoot: fx.root,
    projectId: "aor-core",
    parentRunId: "parent-run-1",
    executionPlanRef: "evidence://execution-plan.json",
    workspaceSetRef: "evidence://workspace-set.json",
    childOutputs: [output],
    aggregateGates: [],
  });
  assert.equal(result.report.status, "blocked");
  assert.ok(result.report.blockers.some((entry) => entry.code === "integration-apply-conflict"));
  assert.equal(result.report.retained_workspace_ref, "runtime://integration-workspaces/parent-run-1");
});

test("integration blocks child output that widens the authoritative unit scope", () => {
  const fx = fixture();
  const output = patchOutput(fx, "unit-a", "base.txt", "base\nchanged\n");
  const result = integrateParentRun({
    ...fx,
    parent: { units: [{ execution_unit_id: "unit-a", depends_on: [], scope: { allowed_paths: ["src/**"] } }] },
    projectRoot: fx.root,
    projectId: "aor-core",
    parentRunId: "parent-run-1",
    executionPlanRef: "evidence://execution-plan.json",
    workspaceSetRef: "evidence://workspace-set.json",
    childOutputs: [output],
    aggregateGates: [],
  });
  assert.equal(result.report.status, "blocked");
  assert.equal(result.report.blockers[0].code, "integration-output-out-of-scope");
});

test("stale invalidation is transitive but preserves unrelated successful units", () => {
  const units = [
    { execution_unit_id: "a", depends_on: [] },
    { execution_unit_id: "b", depends_on: ["a"] },
    { execution_unit_id: "c", depends_on: ["b"] },
    { execution_unit_id: "unrelated", depends_on: [] },
  ];
  assert.deepEqual(computeStaleBoundary(units, [{ execution_unit_id: "a" }]).map((entry) => entry.execution_unit_id), ["b", "c"]);
  assert.equal(computeIntegrationInputFingerprint({ dependencyEvidence: ["b", "a"], changedPaths: ["x"] }).length, 64);
});

test("integration repair reuses W45 lifecycle with additive origin context and bounded exhaustion", () => {
  const fx = fixture();
  const repair = requestIntegrationRepair({
    projectId: "aor-core",
    projectRoot: fx.root,
    runtimeLayout: fx.runtimeLayout,
    runId: "parent-run-1",
    parentRunId: "parent-run-1",
    integrationGateId: "integration-tests",
    inputFingerprint: "f".repeat(64),
    sourceStage: "qa",
    sourceRef: "evidence://integration-qa.json",
    findingRefs: ["finding://integration-tests"],
    attemptBudget: { max_attempts: 1, attempt_index: 1, remaining_attempts: 0 },
    status: "budget-exhausted",
    createdAt: "2026-07-17T00:00:00.000Z",
  });
  assert.equal(repair.request.source_stage, "qa");
  assert.equal(repair.request.origin_context.integration_gate_id, "integration-tests");
  assert.equal(repair.request.status, "budget-exhausted");
  assert.ok(repair.request.blockers.includes("repair-budget-exhausted"));
});
