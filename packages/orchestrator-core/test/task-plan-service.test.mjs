import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  approveTaskPlan,
  createTaskPlan,
  diffTaskPlans,
  getTaskPlanStatus,
  materializeTaskProgress,
  requestTaskPlanRevision,
  resolveExecutionUnitContext,
  showTaskPlan,
} from "../src/task-plan-service.mjs";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function withTempRepo(callback) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-w60-plan-"));
  fs.mkdirSync(path.join(repoRoot, ".git"), { recursive: true });
  fs.cpSync(path.join(workspaceRoot, "examples"), path.join(repoRoot, "examples"), { recursive: true });
  try {
    return callback(repoRoot);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
}

test("structured plan create is routed, idempotent, approvable, and materializes execution progress", () => {
  withTempRepo((repoRoot) => {
    const semanticEvaluation = { status: "warn", warnings: ["Keep the integration boundary explicit."] };
    const first = createTaskPlan({ projectRef: repoRoot, cwd: repoRoot, planningRunId: "plan.test.first", semanticEvaluation });
    const second = createTaskPlan({ projectRef: repoRoot, cwd: repoRoot, planningRunId: "plan.test.second", semanticEvaluation });

    assert.equal(first.planningRun.status, "passed");
    assert.equal(first.plan.plan_status, "proposed");
    assert.equal(first.plan.semantic_evaluation.status, "warn");
    assert.equal(first.plan.semantic_evaluation.blocking, false);
    assert.equal(first.planEvaluationReport.status, "warn");
    assert.equal(first.plan.plan_version, 1);
    assert.equal(second.plan.plan_version, 1);
    assert.equal(second.plan.plan_digest, first.plan.plan_digest);
    assert.equal(second.plan.local_tasks.some((task) => task.task_id.startsWith("local-task.")), false);

    const approved = approveTaskPlan({
      projectRef: repoRoot,
      cwd: repoRoot,
      planRef: second.planRef,
      approvalRef: "approval://PLAN-W60",
      approvedAt: "2026-07-13T00:00:00.000Z",
    });
    assert.equal(approved.plan.plan_status, "approved");
    assert.equal(approved.executionPlan.execution_units.length, approved.plan.local_tasks.length);
    assert.equal(approved.taskProgress.tasks[0].status, "ready");

    const unit = approved.executionPlan.execution_units[0];
    const resolvedUnit = resolveExecutionUnitContext({
      projectRef: repoRoot,
      cwd: repoRoot,
      executionPlanRef: `evidence://${path.relative(repoRoot, approved.executionPlanFile)}`,
      executionUnitId: unit.unit_id,
    });
    assert.deepEqual(resolvedUnit.taskRefs, unit.task_refs);

    const task = approved.plan.local_tasks[0];
    const pending = materializeTaskProgress({
      projectRef: repoRoot,
      cwd: repoRoot,
      planRef: approved.planFile,
      evidenceDocuments: [{
        ref: "evidence://reports/adapter-success.json",
        document: {
          run_id: "run.plan-task.attempt-1",
          task_refs: [task.task_id],
          plan_digest: approved.plan.plan_digest,
          status: "passed",
        },
      }],
    });
    assert.equal(pending.taskProgress.tasks[0].status, "verification-pending");
    assert.deepEqual(pending.taskProgress.tasks[0].attempt_refs, ["run.plan-task.attempt-1"]);

    const completed = materializeTaskProgress({
      projectRef: repoRoot,
      cwd: repoRoot,
      planRef: approved.planFile,
      evidenceDocuments: [
        {
          ref: "evidence://reports/attempt-1-failed.json",
          document: { run_id: "run.plan-task.attempt-1", task_refs: [task.task_id], plan_digest: approved.plan.plan_digest, status: "failed" },
        },
        {
          ref: "evidence://reports/attempt-2-passed.json",
          document: { run_id: "run.plan-task.attempt-2", task_refs: [task.task_id], plan_digest: approved.plan.plan_digest, status: "passed" },
        },
        {
          ref: "evidence://reports/verify-task-pass.json",
          document: { task_refs: [task.task_id], plan_digest: approved.plan.plan_digest, verification_status: "pass", criteria_status: "satisfied" },
        },
        ...task.expected_evidence.map((family) => ({
          ref: `evidence://reports/${family}.json`,
          document: {
            family,
            task_refs: [task.task_id],
            plan_digest: approved.plan.plan_digest,
            verification_status: family === "verify-summary" ? "pass" : undefined,
            criteria_status: family === "verify-summary" ? "satisfied" : undefined,
          },
        })),
      ],
    });
    assert.equal(completed.taskProgress.tasks[0].status, "complete");
    assert.deepEqual(completed.taskProgress.tasks[0].attempt_refs, ["run.plan-task.attempt-1", "run.plan-task.attempt-2"]);

    const status = getTaskPlanStatus({ projectRef: repoRoot, cwd: repoRoot, planRef: approved.planFile });
    assert.equal(status.executionPlan.plan_id, approved.plan.plan_id);
    assert.equal(status.taskProgress.tasks[0].task_id, task.task_id);
  });
});

test("incomplete planner output remains readable as revision-required but cannot be approved", () => {
  withTempRepo((repoRoot) => {
    const created = createTaskPlan({
      projectRef: repoRoot,
      cwd: repoRoot,
      planningRunId: "plan.test.incomplete",
      plannerCandidate: {
        local_tasks: [{
          task_id: "task.incomplete",
          title: "Incomplete task",
          type: "implementation",
          objective: "Demonstrate deterministic rejection.",
        }],
      },
    });
    assert.equal(created.plan.plan_status, "revision-required");
    assert.equal(created.planValidationReport.status, "fail");
    assert.equal(created.planEvaluationReport, null);
    assert.equal(showTaskPlan({ projectRef: repoRoot, cwd: repoRoot, planRef: created.planRef }).plan.plan_status, "revision-required");
    assert.throws(
      () => approveTaskPlan({ projectRef: repoRoot, cwd: repoRoot, planRef: created.planRef, approvalRef: "approval://invalid" }),
      (error) => error.code === "plan-incomplete",
    );
  });
});

test("revision requests invalidate approval and plan diff classifies material task changes", () => {
  withTempRepo((repoRoot) => {
    const created = createTaskPlan({ projectRef: repoRoot, cwd: repoRoot, planningRunId: "plan.test.revision" });
    const approved = approveTaskPlan({
      projectRef: repoRoot,
      cwd: repoRoot,
      planRef: created.planRef,
      approvalRef: "approval://revision-base",
    });
    const requested = requestTaskPlanRevision({
      projectRef: repoRoot,
      cwd: repoRoot,
      planRef: approved.planFile,
      reason: "Narrow the implementation boundary.",
      requestedAt: "2026-07-13T01:00:00.000Z",
    });
    assert.equal(requested.plan.plan_status, "revision-requested");
    assert.equal(requested.planningRun.status, "passed");
    assert.equal(typeof requested.planningRunRef, "string");
    assert.equal(fs.existsSync(requested.planningRunFile), true);
    assert.equal(JSON.parse(fs.readFileSync(requested.handoffFile, "utf8")).approval_state.state, "pending");

    const revisedTasks = structuredClone(approved.plan.local_tasks);
    revisedTasks[0].objective = "A materially revised task objective.";
    const revised = createTaskPlan({
      projectRef: repoRoot,
      cwd: repoRoot,
      planningRunId: "plan.test.revision.v2",
      plannerCandidate: { local_tasks: revisedTasks },
    });
    assert.equal(revised.plan.plan_version, 2);
    assert.deepEqual(revised.plan.local_tasks.map((task) => task.task_id), approved.plan.local_tasks.map((task) => task.task_id));
    const previousPlanFile = path.resolve(repoRoot, revised.plan.previous_plan_ref.slice("evidence://".length));
    assert.equal(JSON.parse(fs.readFileSync(previousPlanFile, "utf8")).plan_status, "superseded");

    const diff = diffTaskPlans(approved.plan, revised.plan);
    assert.equal(diff.material_change, true);
    assert.deepEqual(diff.modified_task_ids, [approved.plan.local_tasks[0].task_id]);
  });
});

test("project policy can make semantic plan evaluation blocking", () => {
  withTempRepo((repoRoot) => {
    const profileFile = path.join(repoRoot, "examples", "project.aor.yaml");
    fs.appendFileSync(profileFile, "\nstructured_plan_policy:\n  semantic_evaluator_blocking: true\n", "utf8");
    const created = createTaskPlan({
      projectRef: repoRoot,
      cwd: repoRoot,
      planningRunId: "plan.test.semantic-blocking",
      semanticEvaluation: { status: "warn", warnings: ["Split the cross-component task."] },
    });
    assert.equal(created.planValidationReport.status, "pass");
    assert.equal(created.planEvaluationReport.status, "warn");
    assert.equal(created.plan.semantic_evaluation.blocking, true);
    assert.equal(created.plan.plan_status, "revision-required");
    assert.throws(
      () => approveTaskPlan({ projectRef: repoRoot, cwd: repoRoot, planRef: created.planRef, approvalRef: "approval://semantic" }),
      (error) => error.code === "plan-incomplete",
    );
  });
});

test("medium plan revision proof preserves task identity across failed attempt, retry, verification, and completion", () => {
  withTempRepo((repoRoot) => {
    const rejected = createTaskPlan({
      projectRef: repoRoot,
      cwd: repoRoot,
      planningRunId: "plan.proof.v1",
      plannerCandidate: { local_tasks: [{ task_id: "task.invalid-v1", title: "Incomplete", type: "implementation", objective: "Force revision." }] },
    });
    assert.equal(rejected.plan.plan_version, 1);
    assert.equal(rejected.plan.plan_status, "revision-required");

    requestTaskPlanRevision({
      projectRef: repoRoot,
      cwd: repoRoot,
      planRef: rejected.planRef,
      reason: "Replace the incomplete candidate with independently verifiable work.",
      planningRunId: "plan.proof.revise",
    });
    const revised = createTaskPlan({ projectRef: repoRoot, cwd: repoRoot, planningRunId: "plan.proof.v2" });
    assert.equal(revised.plan.plan_version, 2);
    assert.equal(revised.plan.plan_status, "proposed");
    assert.equal(revised.plan.plan_size, "medium");

    const approved = approveTaskPlan({
      projectRef: repoRoot,
      cwd: repoRoot,
      planRef: revised.planRef,
      approvalRef: "approval://W60-E2E",
    });
    assert.equal(approved.executionPlan.execution_units.length, approved.plan.local_tasks.length);
    const task = approved.plan.local_tasks[0];
    const failedAttempt = {
      ref: "evidence://reports/proof-attempt-1.json",
      document: { run_id: "run.proof.attempt-1", task_refs: [task.task_id], plan_digest: approved.plan.plan_digest, status: "failed" },
    };
    const failed = materializeTaskProgress({ projectRef: repoRoot, cwd: repoRoot, planRef: approved.planFile, evidenceDocuments: [failedAttempt] });
    assert.equal(failed.taskProgress.tasks[0].status, "failed");

    const retryAttempt = {
      ref: "evidence://reports/proof-attempt-2.json",
      document: { run_id: "run.proof.attempt-2", task_refs: [task.task_id], plan_digest: approved.plan.plan_digest, status: "passed" },
    };
    const retried = materializeTaskProgress({ projectRef: repoRoot, cwd: repoRoot, planRef: approved.planFile, evidenceDocuments: [failedAttempt, retryAttempt] });
    assert.equal(retried.taskProgress.tasks[0].task_id, task.task_id);
    assert.equal(retried.taskProgress.tasks[0].status, "verification-pending");
    assert.deepEqual(retried.taskProgress.tasks[0].attempt_refs, ["run.proof.attempt-1", "run.proof.attempt-2"]);

    const acceptanceEvidence = [
      failedAttempt,
      retryAttempt,
      { ref: "evidence://reports/verify-proof.json", document: { task_refs: [task.task_id], plan_digest: approved.plan.plan_digest, verification_status: "pass", criteria_status: "satisfied" } },
      ...task.expected_evidence.map((family) => ({
        ref: `evidence://reports/${family}-proof.json`,
        document: { family, task_refs: [task.task_id], plan_digest: approved.plan.plan_digest },
      })),
    ];
    const completed = materializeTaskProgress({ projectRef: repoRoot, cwd: repoRoot, planRef: approved.planFile, evidenceDocuments: acceptanceEvidence });
    assert.equal(completed.taskProgress.tasks[0].status, "complete");
  });
});
