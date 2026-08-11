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
import {
  buildPlanningInputManifest,
  revisionAdviceForValidationIssue,
  selectPlannerCandidate,
  validateMissionSpecificPlannerCandidate,
} from "../src/planner-decomposition.mjs";
import {
  EXECUTION_PLAN_STAGES,
  TASK_PROGRESS_STAGES,
  resolveOverallTaskProgressStatus,
  resolveTaskProgressStatus,
} from "../src/task-progress-projection.mjs";
import { toLogicalEvidenceRef } from "../src/aor-home.mjs";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function withTempRepo(callback) {
  const repoRoot = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "aor-w60-plan-")));
  fs.mkdirSync(path.join(repoRoot, ".git"), { recursive: true });
  fs.cpSync(path.join(workspaceRoot, "examples"), path.join(repoRoot, "examples"), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, ".aor"), { recursive: true });
  fs.linkSync(path.join(repoRoot, "examples/project.aor.yaml"), path.join(repoRoot, ".aor/project.yaml"));
  try {
    return callback(repoRoot);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
}

function missionPlannerCandidate(taskId = "task.mission") {
  const tasks = ["design", "implement", "verify"].map((phase, index) => ({
    task_id: `${taskId}.${phase}`,
    title: `${phase[0].toUpperCase()}${phase.slice(1)} mission-specific behavior`,
    type: phase === "design" ? "design" : phase === "verify" ? "verification" : "implementation",
    objective: `${phase[0].toUpperCase()}${phase.slice(1)} and verify the approved mission behavior.`,
    rationale: "The approved mission requires explicit bounded and independently verifiable work.",
    scope: {
      repo_ids: ["main"],
      component_ids: [],
      allowed_paths: ["src/**"],
      forbidden_paths: [],
    },
    depends_on: index === 0 ? [] : [`${taskId}.${["design", "implement"][index - 1]}`],
    work_items: [`${phase} the approved bounded behavior.`, "Preserve the approved mission boundary."],
    criteria_refs: ["acceptance.bounded-objective"],
    verification: {
      command_group_refs: [],
      validators: ["repo-scope"],
      manual_checks: ["Inspect the behavior against the approved mission."],
      success_conditions: ["The mission behavior is implemented and verified."],
    },
    expected_evidence: ["verify-summary", "review-report"],
    risks: ["The implementation may reveal a narrower follow-up requirement."],
    stop_conditions: ["The task requires work outside the approved mission scope."],
    execution_hints: { group_key: null, group_reason: null, parallel_candidate: false },
  }));
  return {
    local_tasks: tasks,
  };
}

test("planner decomposition records input provenance and candidate precedence", () => {
  assert.deepEqual(buildPlanningInputManifest([
    "evidence://artifacts/intake.artifact.json",
    "evidence://reports/project-analysis.json",
    "evidence://reports/spec.step-result.json",
  ]).map((entry) => entry.kind), ["approved-intake", "project-analysis", "specification"]);
  assert.equal(selectPlannerCandidate({
    explicitCandidate: { local_tasks: [{ task_id: "task.explicit" }] },
    adapterOutput: { wave_ticket_candidate: { local_tasks: [{ task_id: "task.runner" }] } },
  }).source, "explicit-candidate");
  assert.match(revisionAdviceForValidationIssue({ field: "local_tasks[0].depends_on" }), /dependencies/u);
});

test("planner fallback is small-only and medium/large candidates fail closed before evaluation", () => {
  assert.equal(validateMissionSpecificPlannerCandidate({
    candidate: {},
    featureSize: "small",
    source: "missing",
  }).ok, true);
  for (const featureSize of ["medium", "large"]) {
    const missing = validateMissionSpecificPlannerCandidate({ candidate: {}, featureSize, source: "missing" });
    assert.equal(missing.ok, false);
    assert.equal(missing.blocker.code, "mission-specific-plan-required");
  }
  const malformed = validateMissionSpecificPlannerCandidate({
    candidate: { local_tasks: [{ title: "Generic task" }] },
    featureSize: "medium",
    source: "runner-structured-plan",
  });
  assert.equal(malformed.ok, false);
  assert.equal(malformed.blocker.code, "mission-specific-plan-malformed");
  assert.equal(validateMissionSpecificPlannerCandidate({
    candidate: {
      local_tasks: [{ task_id: "task.api", title: "Implement API behavior", objective: "Close mission API behavior." }],
    },
    featureSize: "large",
    source: "runner-structured-plan",
  }).ok, true);
});

test("execution and progress projections keep lifecycle identities separate", () => {
  assert.equal(EXECUTION_PLAN_STAGES.includes("preserve-dependencies"), true);
  assert.equal(TASK_PROGRESS_STAGES.includes("project-attempts"), true);
  assert.equal(resolveTaskProgressStatus({
    stale: false,
    failed: false,
    blockingFindings: 0,
    running: false,
    adapterSucceeded: true,
    evidenceComplete: false,
    verificationPass: false,
    criteriaSatisfied: false,
    dependenciesComplete: true,
  }), "verification-pending");
  assert.equal(resolveTaskProgressStatus({
    stale: true,
    failed: false,
    blockingFindings: 0,
    running: false,
    adapterSucceeded: true,
    evidenceComplete: true,
    verificationPass: true,
    criteriaSatisfied: true,
    dependenciesComplete: true,
  }), "stale");
  assert.equal(resolveOverallTaskProgressStatus(["complete", "blocked"]), "blocked");
});

test("structured plan create is routed, idempotent, approvable, and materializes execution progress", () => {
  withTempRepo((repoRoot) => {
    const semanticEvaluation = { status: "warn", warnings: ["Keep the integration boundary explicit."] };
    const plannerCandidate = missionPlannerCandidate();
    const first = createTaskPlan({ projectRef: repoRoot, cwd: repoRoot, planningRunId: "plan.test.first", semanticEvaluation, plannerCandidate });
    const second = createTaskPlan({ projectRef: repoRoot, cwd: repoRoot, planningRunId: "plan.test.second", semanticEvaluation, plannerCandidate });

    assert.equal(first.planningRun.status, "passed");
    assert.equal(first.plan.plan_status, "proposed", JSON.stringify(first.planValidationReport.validators, null, 2));
    assert.equal(first.plan.semantic_evaluation.status, "warn");
    assert.equal(first.plan.semantic_evaluation.blocking, false);
    assert.equal(first.planEvaluationReport.status, "warn");
    assert.equal(first.plan.plan_version, 1);
    assert.equal(first.plan.source_refs.planner_candidate_source, "explicit-candidate");
    assert.equal(first.plan.source_refs.planning_input_manifest.length > 0, true);
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
      executionPlanRef: toLogicalEvidenceRef({ projectRoot: repoRoot, filePath: approved.executionPlanFile, workspaceProjectId: first.workspaceProjectId }),
      executionUnitId: unit.unit_id,
    });
    assert.deepEqual(resolvedUnit.taskRefs, unit.task_refs);
    const workspaceSetRoot = path.join(first.runtimeLayout.workspacesRoot, "parent-run-plan");
    const executionRoot = path.join(workspaceSetRoot, "repos", "main");
    const ownerMarker = path.join(workspaceSetRoot, ".aor-workspace-set-owner.json");
    fs.mkdirSync(executionRoot, { recursive: true });
    fs.writeFileSync(ownerMarker, `${JSON.stringify({
      workspace_set_id: "workspace-set-parent-run-plan",
      project_id: "aor-core",
      run_id: "parent-run-plan",
      workspace_root: workspaceSetRoot,
    })}\n`);
    const workspaceSetFile = path.join(first.runtimeLayout.reportsRoot, "workspace-set.parent-run-plan.json");
    fs.writeFileSync(workspaceSetFile, `${JSON.stringify({
      schema_version: 2,
      workspace_set_id: "workspace-set-parent-run-plan",
      project_id: "aor-core",
      run_id: "parent-run-plan",
      binding_ref: "binding://main",
      status: "ready",
      workspace_root: workspaceSetRoot,
      owner_marker: ownerMarker,
      repositories: [{
        repo_id: "main",
        mount_path: "repos/main",
        base_ref: "main",
        resolved_commit: "1".repeat(40),
        execution_root: executionRoot,
        provisioning: { strategy: "independent-clone", state: "ready" },
      }],
      conflicts: [],
      cleanup: {
        policy: { on_success: "delete", on_abort: "delete", on_failure: "retain" },
        state: "pending",
      },
      evidence_refs: ["evidence://workspace-set.parent-run-plan.json"],
    })}\n`);
    const workspaceBoundUnit = resolveExecutionUnitContext({
      projectRef: repoRoot,
      cwd: repoRoot,
      executionPlanRef: toLogicalEvidenceRef({ projectRoot: repoRoot, filePath: approved.executionPlanFile, workspaceProjectId: first.workspaceProjectId }),
      executionUnitId: unit.unit_id,
      workspaceSetRef: toLogicalEvidenceRef({ projectRoot: repoRoot, filePath: workspaceSetFile, workspaceProjectId: first.workspaceProjectId }),
    });
    assert.equal(workspaceBoundUnit.executionRoot, executionRoot);
    fs.writeFileSync(ownerMarker, `${JSON.stringify({ workspace_set_id: "wrong" })}\n`);
    assert.throws(() => resolveExecutionUnitContext({
      projectRef: repoRoot,
      cwd: repoRoot,
      executionPlanRef: toLogicalEvidenceRef({ projectRoot: repoRoot, filePath: approved.executionPlanFile, workspaceProjectId: first.workspaceProjectId }),
      executionUnitId: unit.unit_id,
      workspaceSetRef: toLogicalEvidenceRef({ projectRoot: repoRoot, filePath: workspaceSetFile, workspaceProjectId: first.workspaceProjectId }),
    }), /owner marker/u);

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
    assert.equal(
      created.planValidationReport.validators.every((entry) => typeof entry.details.revision_advice === "string"),
      true,
    );
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
    const created = createTaskPlan({
      projectRef: repoRoot,
      cwd: repoRoot,
      planningRunId: "plan.test.revision",
      plannerCandidate: missionPlannerCandidate(),
    });
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
      plannerCandidate: missionPlannerCandidate(),
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

test("semantic evaluation is fail-closed when transport succeeds without an evaluator candidate", () => {
  withTempRepo((repoRoot) => {
    const missing = createTaskPlan({
      projectRef: repoRoot,
      cwd: repoRoot,
      planningRunId: "plan.test.semantic-missing",
      plannerCandidate: missionPlannerCandidate("task.semantic-missing"),
    });
    assert.equal(missing.planEvaluationReport.status, "not_evaluated");
    assert.equal(missing.plan.semantic_evaluation.status, "not_evaluated");
    assert.notEqual(missing.plan.semantic_evaluation.status, "pass");

    const malformed = createTaskPlan({
      projectRef: repoRoot,
      cwd: repoRoot,
      planningRunId: "plan.test.semantic-malformed",
      plannerCandidate: missionPlannerCandidate("task.semantic-malformed"),
      semanticEvaluation: { result: "{not-json" },
    });
    assert.equal(malformed.planEvaluationReport.status, "fail");

    const explicitPass = createTaskPlan({
      projectRef: repoRoot,
      cwd: repoRoot,
      planningRunId: "plan.test.semantic-pass",
      plannerCandidate: missionPlannerCandidate("task.semantic-pass"),
      semanticEvaluation: { status: "pass", findings: [], warnings: [] },
    });
    assert.equal(explicitPass.planEvaluationReport.status, "pass");
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
    const revised = createTaskPlan({
      projectRef: repoRoot,
      cwd: repoRoot,
      planningRunId: "plan.proof.v2",
      plannerCandidate: missionPlannerCandidate("task.valid-v2"),
    });
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
