import assert from "node:assert/strict";
import test from "node:test";

import {
  enrichExecutionDag,
  executionDagDigest,
  validateExecutionDagCoverage,
} from "../src/execution-dag-planner.mjs";

const tasks = [
  {
    task_id: "task-api",
    scope: { repo_ids: ["api"], component_ids: ["contracts"], allowed_paths: ["src/contracts"] },
    criteria_refs: ["criterion-api"],
    verification: [],
    execution_hints: { parallel_candidate: true, conflict_keys: ["public-contract"] },
  },
  {
    task_id: "task-web",
    scope: { repo_ids: ["web"], component_ids: ["console"], allowed_paths: ["src/ui"] },
    criteria_refs: ["criterion-web"],
    verification: [],
    execution_hints: { parallel_candidate: true, conflict_keys: ["public-contract"] },
  },
];

test("execution DAG enriches topology scope and serializes deterministic conflicts", () => {
  const result = enrichExecutionDag({
    tasks,
    topology: { repos: [{ repo_id: "api", workspace_mount: "repos/api" }, { repo_id: "web", workspace_mount: "repos/web" }] },
    units: tasks.map((task) => ({
      unit_id: `unit-${task.task_id}`,
      task_refs: [task.task_id],
      depends_on: [],
      scope: task.scope,
      required_evidence: [],
      integration_requirements: [],
      grouping_rationale: null,
      parallel_candidate: true,
    })),
  });
  assert.deepEqual(result.units[0].workspace_mounts, [{ repo_id: "api", mount_path: "repos/api" }]);
  assert.equal(result.units.every((unit) => unit.concurrency.classification === "serialized"), true);
  assert.equal(result.units[0].concurrency.reasons.includes("conflict-key"), true);
  assert.match(executionDagDigest(result), /^sha256:[0-9a-f]{64}$/u);
});

test("execution DAG coverage fails on dropped, duplicate, unknown, and expanded scope", () => {
  const result = validateExecutionDagCoverage({
    tasks,
    approvedScope: { repo_ids: ["api"] },
    units: [
      { unit_id: "unit-one", task_refs: ["task-api", "task-api"], depends_on: ["missing"], scope: { repo_ids: ["outside"] } },
    ],
  });
  assert.equal(result.ok, false);
  assert.deepEqual(new Set(result.findings.map((finding) => finding.code)), new Set([
    "unknown-unit-dependency",
    "scope-expansion",
    "duplicate-task-mapping",
    "dropped-task",
  ]));
});
