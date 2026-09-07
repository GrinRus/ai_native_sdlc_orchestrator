import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { invokeCli } from "../src/index.mjs";
import { readProjectState } from "../../../packages/orchestrator-core/src/control-plane/read-surface.mjs";
import { runGitChecked, withTempRepo } from "../../../scripts/test/helpers/temp-repo.mjs";

const workspaceRoot = path.resolve(new URL("../../..", import.meta.url).pathname);

function initializeNestedRepository(repoRoot, relativePath, files) {
  const root = path.join(repoRoot, relativePath);
  for (const [file, contents] of Object.entries(files)) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents, "utf8");
  }
  runGitChecked({ cwd: root, args: ["init"] });
  runGitChecked({ cwd: root, args: ["config", "user.email", "aor@example.com"] });
  runGitChecked({ cwd: root, args: ["config", "user.name", "AOR Test"] });
  runGitChecked({ cwd: root, args: ["add", "."] });
  runGitChecked({ cwd: root, args: ["commit", "-m", "initial"] });
  runGitChecked({ cwd: root, args: ["branch", "-M", "main"] });
  return root;
}

function buildTwoRepositoryProfile(repoRoot) {
  const source = parseYaml(fs.readFileSync(path.join(repoRoot, "examples", "project.bounded-multirepo.aor.yaml"), "utf8"));
  source.repos = source.repos.filter((repo) => ["backend", "frontend"].includes(repo.repo_id));
  source.components = source.components.filter((component) => ["backend-api", "web-app"].includes(component.component_id));
  source.repo_graph = source.repo_graph.filter((edge) => edge.from_repo_id === "backend" && edge.to_repo_id === "frontend");
  source.component_graph = source.component_graph.filter((edge) => edge.from_component_id === "web-app");
  const profile = path.join(repoRoot, "project.two-repository.yaml");
  fs.writeFileSync(profile, stringifyYaml(source), "utf8");
  fs.mkdirSync(path.join(repoRoot, ".aor"), { recursive: true });
  fs.copyFileSync(profile, path.join(repoRoot, ".aor", "project.yaml"));
  return profile;
}

function buildClosureTasks() {
  return [
    ["backend", ["services/api/index.js", "services/api/index.js"]],
    ["frontend", ["apps/web/index.js"]],
  ].flatMap(([repoId, paths]) => paths.map((allowedPath, index) => ({
    task_id: `task.s14.${repoId}.${index + 1}`,
    title: `Verify ${repoId} closure ${index + 1}`,
    type: "implementation",
    objective: `Exercise the bounded ${repoId} repository path ${allowedPath}.`,
    rationale: "The installed closure must preserve independent repository ownership.",
    scope: {
      repo_ids: [repoId],
      component_ids: [],
      allowed_paths: [allowedPath],
      forbidden_paths: [],
    },
    depends_on: [],
    work_items: ["Run the bounded repository scenario."],
    criteria_refs: ["goal.1", "dod.1", "acceptance.1"],
    verification: {
      command_group_refs: [],
      validators: ["repo-scope"],
      manual_checks: ["Confirm the source checkout remains unchanged."],
      success_conditions: ["The repository output stays inside its declared scope."],
    },
    expected_evidence: ["verify-summary", "review-report"],
    risks: ["A repository-specific failure must remain recoverable."],
    stop_conditions: ["The scenario requires an upstream write."],
    execution_hints: {
      group_key: repoId === "backend" ? "backend-closure" : null,
      group_reason: repoId === "backend" ? "Backend files share one serialized integration unit." : null,
      parallel_candidate: false,
      conflict_keys: repoId === "backend" ? ["repo:backend"] : [],
    },
  })));
}

function createPatchEvidence({ sourceRoot, changedPaths, patchFile }) {
  const originals = changedPaths.map((relativePath) => ({
    relativePath,
    contents: fs.readFileSync(path.join(sourceRoot, relativePath), "utf8"),
  }));
  try {
    for (const entry of originals) {
      fs.writeFileSync(path.join(sourceRoot, entry.relativePath), `${entry.contents}// s14 closure evidence\n`, "utf8");
    }
    const bytes = execFileSync("git", ["diff", "--binary", "--", ...changedPaths], { cwd: sourceRoot });
    fs.writeFileSync(patchFile, bytes);
    return bytes;
  } finally {
    for (const entry of originals) fs.writeFileSync(path.join(sourceRoot, entry.relativePath), entry.contents, "utf8");
  }
}

test("public CLI workspace provision keeps full JSON parity with the shared service", () => {
  withTempRepo({ prefix: "aor-s10-workspace-cli-", workspaceRoot }, (repoRoot) => {
    runGitChecked({ cwd: repoRoot, args: ["branch", "-M", "main"] });
    const result = invokeCli([
      "workspace", "provision",
      "--project-ref", repoRoot,
      "--project-profile", path.join(repoRoot, "examples", "project.aor.yaml"),
      "--run-id", "run-s10-cli",
      "--dry-run", "true",
      "--json",
    ], { cwd: repoRoot });
    assert.equal(result.exitCode, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.workspace_set.status, "planned");
    assert.equal(payload.workspace_set_dry_run, true);
    assert.equal(payload.read_only, true);
    assert.equal(payload.contract_families.some((entry) => entry.family === "workspace-set" || entry === "workspace-set"), true);
  });
});

test("public CLI parent start resolves project evidence refs from AOR Home", () => {
  withTempRepo({ prefix: "aor-s14-parent-cli-", workspaceRoot }, (repoRoot) => {
    runGitChecked({ cwd: repoRoot, args: ["branch", "-M", "main"] });
    const profile = path.join(repoRoot, "examples", "project.aor.yaml");
    const provision = invokeCli([
      "workspace", "provision",
      "--project-ref", repoRoot,
      "--project-profile", profile,
      "--run-id", "run-s14-parent-cli",
      "--json",
    ], { cwd: repoRoot });
    assert.equal(provision.exitCode, 0, provision.stderr);
    const provisionPayload = JSON.parse(provision.stdout);
    const workspaceSetRef = provisionPayload.workspace_set_ref;
    const workspaceProjectId = /^evidence:\/\/projects\/([^/]+)\//u.exec(workspaceSetRef)?.[1];
    assert.ok(workspaceProjectId, workspaceSetRef);

    const state = readProjectState({ cwd: repoRoot, projectRef: repoRoot, projectProfile: profile });
    const plan = parseYaml(fs.readFileSync(path.join(repoRoot, "examples", "packets", "execution-plan-structured-medium.yaml"), "utf8"));
    const planRef = `evidence://projects/${workspaceProjectId}/reports/execution-plan-s14-parent.json`;
    plan.project_id = "aor-core";
    plan.execution_plan_id = "aor-core.execution-plan.s14-parent";
    plan.plan_id = "aor-core.plan.s14-parent";
    plan.plan_ref = planRef;
    plan.source_plan_refs = [planRef];
    plan.plan_digest = "sha256:s14-parent-plan";
    plan.dag_digest = "sha256:s14-parent-dag";
    plan.execution_units = [];
    plan.impacted_scope = { repo_ids: ["main"], component_ids: [], allowed_paths: [], forbidden_paths: [] };
    plan.integration_gates = [];
    plan.approval = { state: "approved", plan_digest: plan.plan_digest, dag_digest: plan.dag_digest, invalidated: false };
    fs.writeFileSync(
      path.join(state.runtime_layout.reports_root, "execution-plan-s14-parent.json"),
      `${JSON.stringify(plan, null, 2)}\n`,
      "utf8",
    );

    const started = invokeCli([
      "run", "start",
      "--project-ref", repoRoot,
      "--project-profile", profile,
      "--run-id", "run-s14-parent-cli",
      "--execution-plan-ref", planRef,
      "--workspace-set-ref", workspaceSetRef,
      "--require-validation-pass", "false",
      "--max-child-starts", "1",
      "--json",
    ], { cwd: repoRoot });
    assert.equal(started.exitCode, 0, started.stderr);
    const startedPayload = JSON.parse(started.stdout);
    assert.ok(startedPayload.parent_run, started.stdout);
    assert.equal(startedPayload.parent_run.parent_run_id, "run-s14-parent-cli");
    assert.equal(startedPayload.parent_run.status, "queued");
    assert.equal(startedPayload.parent_run.workspace_set_ref, workspaceSetRef);
  });
});

test("public CLI closes a two-repository provision, integration, and delivery journey", async () => {
  await withTempRepo({ prefix: "aor-s14-two-repo-cli-", workspaceRoot }, async (repoRoot) => {
    runGitChecked({ cwd: repoRoot, args: ["branch", "-M", "main"] });
    const profile = buildTwoRepositoryProfile(repoRoot);
    const backendRoot = initializeNestedRepository(repoRoot, "repos/backend", {
      "services/api/index.js": "export const service = 'backend';\n",
      "services/api/schema.js": "export const schema = 1;\n",
    });
    const frontendRoot = initializeNestedRepository(repoRoot, "repos/frontend", {
      "apps/web/index.js": "export const app = 'frontend';\n",
    });
    const sourceSnapshot = [backendRoot, frontendRoot].map((root) => ({
      root,
      head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
      status: execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }),
    }));
    const requestFile = path.join(repoRoot, "s14-two-repository-request.json");
    fs.writeFileSync(requestFile, JSON.stringify({
      mission_id: "mission.s14.two-repository-closure",
      feature_size: "medium",
      mission_type: "code-changing",
      work_type: "code-change",
      delivery_mode: "no-write",
      goals: ["Prove the public two-repository closure."],
      definition_of_done: ["Every source checkout remains unchanged."],
      acceptance_checks: ["Integration and delivery evidence resolve from AOR Home."],
      allowed_paths: ["services/api/**", "apps/web/**"],
      task_plan: { local_tasks: buildClosureTasks() },
    }, null, 2));

    const intake = invokeCli([
      "intake", "create",
      "--project-ref", repoRoot,
      "--project-profile", profile,
      "--request-file", requestFile,
      "--json",
    ], { cwd: repoRoot });
    assert.equal(intake.exitCode, 0, intake.stderr);
    const intakePayload = JSON.parse(intake.stdout);

    const plan = invokeCli([
      "plan", "create",
      "--project-ref", repoRoot,
      "--project-profile", profile,
      "--approved-artifact", intakePayload.artifact_packet_file,
      "--json",
    ], { cwd: repoRoot });
    assert.equal(plan.exitCode, 0, plan.stderr);
    const planPayload = JSON.parse(plan.stdout);
    assert.equal(planPayload.plan.plan_status, "proposed", JSON.stringify(planPayload.plan_validation_report));
    assert.equal(planPayload.plan_validation_report.status, "pass");
    assert.equal(planPayload.plan.local_tasks.length, 3);

    const approved = invokeCli([
      "plan", "approve",
      "--project-ref", repoRoot,
      "--plan-ref", planPayload.plan_ref,
      "--approval-ref", "approval://w71-s14-two-repository",
      "--json",
    ], { cwd: repoRoot });
    assert.equal(approved.exitCode, 0, approved.stderr);
    const approvedPayload = JSON.parse(approved.stdout);
    assert.equal(approvedPayload.execution_plan.status, "ready");
    assert.equal(approvedPayload.execution_plan.execution_units.length, 2);

    const provision = invokeCli([
      "workspace", "provision",
      "--project-ref", repoRoot,
      "--project-profile", profile,
      "--run-id", "run-s14-two-repository",
      "--json",
    ], { cwd: repoRoot });
    assert.equal(provision.exitCode, 0, provision.stderr);
    const provisionPayload = JSON.parse(provision.stdout);
    assert.equal(provisionPayload.workspace_set.status, "ready");
    assert.equal(provisionPayload.workspace_set.repositories.length, 2);

    const parentFile = path.join(
      intakePayload.runtime_layout.stateRoot,
      "parent-runs",
      "parent-run-run-s14-two-repository.json",
    );
    const workspaceProjectId = /^evidence:\/\/projects\/([^/]+)\//u.exec(provisionPayload.workspace_set_ref)?.[1];
    assert.ok(workspaceProjectId, provisionPayload.workspace_set_ref);
    const planRef = `evidence://projects/${workspaceProjectId}/artifacts/${path.basename(approvedPayload.execution_plan_file)}`;
    const parent = {
      schema_version: 1,
      parent_run_id: "run-s14-two-repository",
      project_id: approvedPayload.plan.project_id,
      execution_plan_ref: planRef,
      workspace_set_ref: provisionPayload.workspace_set_ref,
      status: "integration-pending",
      revision: 0,
      units: approvedPayload.execution_plan.execution_units.map((unit) => ({
        execution_unit_id: unit.unit_id,
        task_refs: unit.task_refs,
        depends_on: unit.depends_on,
        conflict_keys: unit.conflict_keys,
        repository_scope: unit.repository_scope,
        status: "succeeded",
        attempt_count: 1,
        active_child_run_id: null,
        child_runs: [{
          child_run_id: `child.${unit.unit_id}`,
          attempt: 1,
          status: "succeeded",
          evidence_refs: [],
        }],
        blocker_codes: [],
      })),
      integration_gates: [],
      command_ids: [],
      event_cursor: 0,
      events: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      terminal_at: null,
    };
    fs.mkdirSync(path.dirname(parentFile), { recursive: true });
    fs.writeFileSync(parentFile, `${JSON.stringify(parent, null, 2)}\n`, "utf8");
    const childOutputRefs = [];
    for (const unit of approvedPayload.execution_plan.execution_units) {
      const parentUnit = parent.units.find((candidate) => candidate.execution_unit_id === unit.unit_id);
      assert.ok(parentUnit?.child_runs?.[0], unit.unit_id);
      const changedPaths = unit.scope.allowed_paths;
      const sourceRoot = unit.scope.repo_ids[0] === "backend" ? backendRoot : frontendRoot;
      const patchFile = path.join(
        intakePayload.runtime_layout.reportsRoot,
        `child-output-${unit.unit_id}.patch`,
      );
      const patchBytes = createPatchEvidence({ sourceRoot, changedPaths, patchFile });
      const childOutputFile = path.join(
        intakePayload.runtime_layout.reportsRoot,
        `child-output-${unit.unit_id}.json`,
      );
      const childOutput = {
        project_id: approvedPayload.plan.project_id,
        parent_run_id: "run-s14-two-repository",
        execution_unit_id: unit.unit_id,
        child_run_id: parentUnit.child_runs[0].child_run_id,
        attempt: parentUnit.child_runs[0].attempt,
        repo_id: unit.scope.repo_ids[0],
        output_kind: "patch",
        output_ref: `evidence://projects/${workspaceProjectId}/reports/${path.basename(patchFile)}`,
        output_file: patchFile,
        output_digest: crypto.createHash("sha256").update(patchBytes).digest("hex"),
        changed_paths: changedPaths,
      };
      fs.writeFileSync(childOutputFile, `${JSON.stringify(childOutput, null, 2)}\n`, "utf8");
      childOutputRefs.push(childOutputFile);
    }

    const integrated = invokeCli([
      "run", "integration",
      "--project-ref", repoRoot,
      "--parent-run-id", "run-s14-two-repository",
      "--action", "materialize",
      "--execution-plan-ref", approvedPayload.execution_plan_file,
      "--workspace-set-ref", provisionPayload.workspace_set_ref,
      ...childOutputRefs.flatMap((ref) => ["--child-output-file", ref]),
      "--command-id", "integrate-s14-two-repository",
      "--expected-revision", String(parent.revision),
      "--json",
    ], { cwd: repoRoot });
    assert.equal(integrated.exitCode, 0, integrated.stderr);
    const integratedPayload = JSON.parse(integrated.stdout);
    assert.equal(integratedPayload.integration_report.status, "passed");
    assert.equal(integratedPayload.parent_run.status, "succeeded");
    assert.equal(fs.existsSync(integratedPayload.integration_authority_file), true);
    assert.equal(integratedPayload.integration_report.repository_results.length, 2);

    const delivery = invokeCli([
      "deliver", "prepare",
      "--project-ref", repoRoot,
      "--project-profile", profile,
      "--run-id", "run-s14-two-repository",
      "--mode", "no-write",
      "--integration-report", integratedPayload.integration_report_file,
      "--json",
    ], { cwd: repoRoot });
    assert.equal(delivery.exitCode, 0, delivery.stderr);
    const deliveryPayload = JSON.parse(delivery.stdout);
    assert.equal(deliveryPayload.delivery_plan_status, "ready");
    assert.equal(deliveryPayload.delivery_mode, "no-write");
    assert.ok(deliveryPayload.delivery_manifest_file);

    for (const before of sourceSnapshot) {
      assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { cwd: before.root, encoding: "utf8" }).trim(), before.head);
      assert.equal(execFileSync("git", ["status", "--porcelain"], { cwd: before.root, encoding: "utf8" }), before.status);
    }
  });
});
