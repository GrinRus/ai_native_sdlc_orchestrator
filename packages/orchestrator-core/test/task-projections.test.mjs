import assert from "node:assert/strict";
import test from "node:test";

import { listTaskProjections, projectTaskFromFlow } from "../src/control-plane/task-projections.mjs";

const baseFlow = {
  flow_id: "flow.project-alpha.mission-1",
  display_title: "Ship a safe change",
  work_type: "change",
  status: "active",
  mission_id: "mission-1",
  intake_packet_ref: "evidence://projects/project-alpha/packets/intent.json",
  intake_body_ref: "evidence://projects/project-alpha/packets/intent.body.json",
  lifecycle_path: { path_id: "change", owner: "runtime", steps: [{ id: "discovery", state: "current" }] },
  current_step: "discovery",
  current_step_label: "Discover",
  attention_count: 2,
  blocker_count: 1,
  evidence_refs: ["evidence://projects/project-alpha/packets/intent.json", "run://run.task-projection.v1", "run.task-projection.v1"],
  primary_action: { action_id: "discovery-run", operator_control: "Run discovery", reason: "Ready", available: true },
  updated_at: "2026-08-13T10:00:00.000Z",
};

test("Task projection has stable lineage identity and delegates lifecycle to Flow", () => {
  const task = projectTaskFromFlow({ projectId: "project-alpha", flow: baseFlow });
  assert.equal(task.task_id, "task.project-alpha.flow.project-alpha.mission-1");
  assert.equal(task.status, "active");
  assert.deepEqual(task.lineage, {
    intent_submission_ref: baseFlow.intake_packet_ref,
    intent_submission_id: null,
    normalization_revision: null,
    mission_id: "mission-1",
    flow_id: baseFlow.flow_id,
    run_ids: ["run.task-projection.v1"],
  });
  assert.equal(task.lifecycle_path.owner, "runtime");
  assert.equal(task.primary_action.operator_control, "Run discovery");
  assert.deepEqual(task.run_ids, ["run.task-projection.v1"]);
  assert.equal(task.read_only, true);
});

test("completed Flow projects to immutable completed Task without inventing a next action", () => {
  const task = projectTaskFromFlow({ projectId: "project-alpha", flow: {
    ...baseFlow,
    status: "completed",
    closure_state: { review_status: "approved", verification_status: "passed", delivery_status: "complete", patch_ref: "evidence://closure/pass.patch", digest: "a".repeat(64), delivery_manifest_ref: "evidence://closure/pass.manifest", evidence_chain: ["evidence://closure/pass"] },
    primary_action: { action_id: "closure-complete", operator_control: null, reason: "Closed", available: false },
  } });
  assert.equal(task.status, "completed");
  assert.equal(task.completed_read_only, true);
  assert.equal(task.primary_action.available, false);
  assert.equal(task.completion.status, "complete");
  assert.equal(task.completion.immutable, true);
  assert.equal(task.completion.patch_ref, "evidence://closure/pass.patch");
  assert.equal(task.completion.digest, "a".repeat(64));
  assert.equal(task.completion.delivery_manifest_ref, "evidence://closure/pass.manifest");
});

test("Flow-backed Tasks retain the exact confirmed prepared contract for review and completion", () => {
  const task = projectTaskFromFlow({
    projectId: "project-alpha",
    flow: { ...baseFlow, normalization_revision: 4, writeback_policy: { mode: "patch-only" } },
    intentSubmission: {
      submission: { execution_route_override: null, runner_selection_revision: 0 },
      normalization: {
        revision: 4,
        outcome: "Preserve the approved Task outcome through completion.",
        acceptance: ["The exact outcome remains visible."],
        scope: ["apps/web/**"],
        delivery_mode: "patch-only",
      },
    },
  });
  assert.equal(task.prepared_contract.outcome, "Preserve the approved Task outcome through completion.");
  assert.deepEqual(task.prepared_contract.acceptance_criteria, ["The exact outcome remains visible."]);
  assert.deepEqual(task.prepared_contract.scope.allowed_paths, ["apps/web/**"]);
  assert.equal(task.prepared_contract.normalization_revision, 4);
  assert.equal(task.prepared_contract.delivery_mode, "patch-only");

  const stale = projectTaskFromFlow({
    projectId: "project-alpha",
    flow: { ...baseFlow, normalization_revision: 5 },
    intentSubmission: { normalization: { revision: 4, outcome: "Do not surface stale outcome." } },
  });
  assert.equal(stale.prepared_contract.outcome, null);
});

test("partial completion evidence remains blocked instead of rendering success", () => {
  const task = projectTaskFromFlow({ projectId: "project-alpha", flow: {
    ...baseFlow,
    status: "completed",
    closure_state: { review_status: "approved", verification_status: "partial", delivery_status: "complete" },
  } });
  assert.equal(task.completion.status, "blocked");
  assert.equal(task.completion.verification_status, "partial");
});

test("intent submissions project into draft, prepared, and attention Task states", () => {
  const tasks = [
    {
      submission: {
        submission_id: "intent-draft",
        status: "submitted",
        request_text: "Draft a task",
        created_at: "2026-08-13T10:00:00.000Z",
        updated_at: "2026-08-13T10:00:00.000Z",
        attachments: [],
        normalization_refs: [],
      },
      normalization: null,
    },
    {
      submission: {
        submission_id: "intent-prepared",
        status: "prepared",
        request_text: "Prepared task",
        created_at: "2026-08-13T10:00:00.000Z",
        updated_at: "2026-08-13T10:01:00.000Z",
        attachments: [],
        markdown_sources: [{
          source_id: "source.readme",
          project_relative_path: "docs/README.md",
          pinned_base_revision: "a".repeat(40),
          digest: `sha256:${"b".repeat(64)}`,
          media_type: "text/markdown",
          byte_length: 24,
          stale: true,
          preview: { sanitized_markdown: "# Readme" },
        }],
        normalization_refs: ["evidence://projects/project-alpha/reports/intent-normalization-report-intent-prepared-v1.json"],
      },
      normalization: { title: "Prepared task", work_type: "code-change", provider: { route_id: "route.intake-normalize.default" } },
    },
    {
      submission: {
        submission_id: "intent-blocked",
        status: "blocked",
        request_text: "Blocked task",
        created_at: "2026-08-13T10:00:00.000Z",
        updated_at: "2026-08-13T10:02:00.000Z",
        attachments: [],
        normalization_refs: [],
        blocker: {
          code: "intent_provider.not_ready",
          message: "Configure and authenticate an approved runner before preparing this task.",
          recovery_action: "Choose an approved route and retry preparation.",
        },
      },
      normalization: null,
    },
  ];
  const projection = listTaskProjections({ projectId: "project-alpha", projectRef: ".", intentSubmissions: tasks });
  assert.deepEqual(projection.tasks.slice(0, 3).map((task) => task.status), ["draft", "prepared", "attention"]);
  assert.equal(projection.prepared_task_ids.length, 1);
  assert.equal(projection.tasks[1].lineage.flow_id, null);
  assert.equal(projection.tasks[1].primary_action.action_id, "start");
  assert.equal(projection.tasks[1].primary_action.operator_control, "Start task");
  assert.equal(projection.tasks[2].runner_selection.readiness, "blocked");
  assert.equal(projection.tasks[2].attention_items[0].code, "intent_provider.not_ready");
  assert.equal(projection.tasks[2].attention_items[0].message, "Configure and authenticate an approved runner before preparing this task.");
  assert.equal(projection.tasks[2].attention_items[0].recovery_action, "Choose an approved route and retry preparation.");
  assert.equal(projection.tasks[2].primary_action.reason, "Configure and authenticate an approved runner before preparing this task.");
  assert.equal(projection.tasks[2].runner_selection.unavailable_reason, "Configure and authenticate an approved runner before preparing this task.");
  const repositorySource = projection.tasks[1].source_items.find((source) => source.kind === "repository-markdown");
  assert.equal(repositorySource.stale, true);
  assert.equal(projection.tasks[1].primary_action.available, false);
  assert.match(projection.tasks[1].primary_action.reason, /source changed after preparation/u);
});

test("prepared Task uses the approved execution profile and never exposes intake provenance as route", () => {
  const projectionInput = {
    projectId: "project-alpha",
    projectRef: ".",
    executionProfile: {
      revision: 9,
      routes: [{ step: "implement", route_id: "route.implement.default", readiness: "ready", readiness_revision: 9, requested_model: "coding-primary", effective_model: "coding-primary" }],
    },
    intentSubmissions: [{
      submission: {
        submission_id: "intent-prepared",
        status: "prepared",
        request_text: "Implement a bounded change",
        created_at: "2026-08-13T10:00:00.000Z",
        updated_at: "2026-08-13T10:01:00.000Z",
        attachments: [],
        normalization_refs: ["evidence://projects/project-alpha/reports/normalization-v2.json"],
      },
      normalization: {
        title: "Implement a bounded change",
        outcome: "Implement the requested change.",
        acceptance: ["Focused test passes."],
        scope: ["packages/**"],
        work_type: "code-change",
        delivery_mode: "patch-only",
        revision: 2,
        provider: { route_id: "route.intake-normalize.default", adapter_id: "codex-cli" },
      },
    }],
  };
  const projection = listTaskProjections(projectionInput);
  const task = projection.tasks[0];
  assert.equal(task.prepared_contract.approved_execution_route.route_id, "route.implement.default");
  assert.equal(task.runner_selection.route_id, "route.implement.default");
  assert.equal(task.prepared_contract.readiness_revision, 9);
  assert.equal(task.prepared_contract.write_effects.upstream_writes_allowed, false);
  assert.equal(task.primary_action.action_id, "start");
  assert.equal(task.primary_action.available, true);

  const unversionedProjection = listTaskProjections({
    ...projectionInput,
    executionProfile: {
      ...projectionInput.executionProfile,
      routes: projectionInput.executionProfile.routes.map((route) => ({
        step: route.step,
        route_id: route.route_id,
        readiness: route.readiness,
        requested_model: route.requested_model,
        effective_model: route.effective_model,
      })),
    },
  });
  assert.equal(unversionedProjection.tasks[0].runner_selection.readiness, "stale");
  assert.equal(unversionedProjection.tasks[0].runner_selection.readiness_revision, null);
  assert.equal(unversionedProjection.tasks[0].primary_action.available, false);
});
