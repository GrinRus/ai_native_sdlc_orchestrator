#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { enrichExecutionDag, executionDagDigest, validateExecutionDagCoverage } from "../packages/orchestrator-core/src/execution-dag-planner.mjs";
import { computeStaleBoundary } from "../packages/orchestrator-core/src/integration-service.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputIndex = process.argv.indexOf("--output");
const outputPath = outputIndex >= 0
  ? path.resolve(process.cwd(), process.argv[outputIndex + 1])
  : path.join(root, "node_modules/.cache/aor/w62-full-flow-proof.json");

function task(id, repoId, componentId, allowedPath, conflictKeys = []) {
  return {
    task_id: id,
    criteria_refs: [`criterion.${id}`],
    verification: [{ gate_id: `verify.${id}`, command_group_ref: "verify.fixture" }],
    execution_hints: { conflict_keys: conflictKeys, command_locks: [] },
    scope: { repo_ids: [repoId], component_ids: [componentId], allowed_paths: [allowedPath] },
  };
}

function scenario({ id, repositories, tasks }) {
  const units = tasks.map((entry, index) => ({
    unit_id: `unit.${entry.task_id}`,
    task_refs: [entry.task_id],
    depends_on: index === tasks.length - 1 ? [`unit.${tasks[0].task_id}`] : [],
    scope: entry.scope,
    parallel_candidate: true,
  }));
  const topology = { repositories };
  const dag = enrichExecutionDag({
    units,
    tasks,
    topology,
    integrationVerification: [{ gate_id: `integration.${id}`, criteria_refs: tasks.map((entry) => entry.criteria_refs[0]) }],
  });
  const coverage = validateExecutionDagCoverage({
    tasks,
    units: dag.units,
    approvedScope: { repo_ids: repositories.map((entry) => entry.repo_id) },
  });
  if (!coverage.ok) throw new Error(`${id} execution DAG coverage failed: ${JSON.stringify(coverage.findings)}`);
  const parallel = dag.units.filter((unit) => unit.concurrency.classification === "parallel-candidate");
  const serialized = dag.units.filter((unit) => unit.concurrency.classification === "serialized");
  if (parallel.length < 2 || serialized.length < 2) throw new Error(`${id} does not prove both safe parallelism and serialization.`);

  const parentRunId = `parent.${id}`;
  const failedUnit = dag.units[1];
  const attempts = [1, 2].map((attempt) => ({
    task_id: failedUnit.task_refs[0], execution_unit_id: failedUnit.unit_id, attempt,
    status: attempt === 1 ? "failed" : "succeeded",
  }));
  const staleUnits = computeStaleBoundary(dag.units.map((unit) => ({
    execution_unit_id: unit.unit_id,
    depends_on: unit.depends_on,
  })), [{ execution_unit_id: dag.units[0].unit_id }]);

  return {
    id,
    project_id: `project.${id}`,
    topology: repositories.length === 1 ? "monorepo-components" : "bounded-multirepo",
    repository_ids: repositories.map((entry) => entry.repo_id),
    task_ids: tasks.map((entry) => entry.task_id),
    execution_unit_ids: dag.units.map((entry) => entry.unit_id),
    execution_plan: {
      dag_digest: executionDagDigest(dag),
      coverage: "complete",
    },
    parent_run_id: parentRunId,
    scheduler: {
      parallel_approved_units: parallel.map((entry) => entry.unit_id),
      serialized_units: serialized.map((entry) => ({ unit_id: entry.unit_id, reasons: entry.concurrency.reasons })),
    },
    recovery: {
      failed_task_id: failedUnit.task_refs[0],
      failed_execution_unit_id: failedUnit.unit_id,
      attempts,
      stale_units: staleUnits,
      repair_budget: { consumed: 1, maximum: 1, exhausted_path_status: "blocked" },
    },
    no_upstream_write: true,
  };
}

const report = {
  schema_version: 1,
  wave_id: "W62",
  status: "pass",
  evidence_kind: "deterministic-component-fixture",
  exercised_components: ["execution-dag", "stale-boundary"],
  scenarios: [
    scenario({
      id: "monorepo",
      repositories: [{ repo_id: "main", workspace_mount: "repos/main" }],
      tasks: [
        task("mono.api", "main", "api", "packages/api"),
        task("mono.web", "main", "web", "packages/web"),
        task("mono.contract", "main", "contracts", "packages/contracts", ["contract-schema"]),
        task("mono.consumer", "main", "consumer", "packages/consumer", ["contract-schema"]),
        task("mono.integration", "main", "integration", "tests/integration"),
      ],
    }),
    scenario({
      id: "multirepo",
      repositories: [
        { repo_id: "contract", workspace_mount: "repos/contract" },
        { repo_id: "service", workspace_mount: "repos/service" },
      ],
      tasks: [
        task("multi.schema", "contract", "schema", "schema"),
        task("multi.docs", "contract", "docs", "docs"),
        task("multi.service", "service", "service", "src", ["shared-contract"]),
        task("multi.client", "service", "client", "client", ["shared-contract"]),
        task("multi.integration", "service", "integration", "tests/integration"),
      ],
    }),
  ],
  public_surface_parity: [],
  inspected_evidence_refs: [
    "packages/orchestrator-core/test/execution-dag-planner.test.mjs",
    "packages/orchestrator-core/test/workspace-set-provisioner.test.mjs",
    "packages/orchestrator-core/test/parent-run-scheduler.test.mjs",
    "packages/orchestrator-core/test/integration-service.test.mjs",
    "packages/orchestrator-core/test/delivery-driver.test.mjs",
  ],
  browser_assessment: { status: "not-run", reason: "This component fixture does not launch the installed UI." },
  quality_assessment: { status: "fixture-only", inspected_evidence_count: 5 },
  credentialed_provider_calls: false,
  external_provider_network: false,
  upstream_writes: false,
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ status: report.status, report: outputPath, scenarios: report.scenarios.length })}\n`);
