import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { parse as parseYaml } from "yaml";

import { validateContractDocument } from "../../contracts/src/index.mjs";
import { materializeParentIntegration, provisionProjectWorkspaceSet } from "../src/workspace-set-service.mjs";
import { initializeProjectRuntime } from "../src/project-init.mjs";
import { withTempRepo } from "../../../scripts/test/helpers/temp-repo.mjs";

const workspaceRoot = path.resolve(new URL("../../..", import.meta.url).pathname);

test("public workspace service derives a contract-valid set and supports a no-write dry run", () => {
  withTempRepo({ prefix: "aor-s10-workspace-service-", workspaceRoot }, (repoRoot) => {
    const profile = path.join(repoRoot, "examples", "project.aor.yaml");
    const dryRun = provisionProjectWorkspaceSet({
      cwd: repoRoot,
      projectRef: repoRoot,
      projectProfile: profile,
      runId: "run-s10-dry",
      dryRun: true,
    });
    assert.equal(dryRun.dryRun, true);
    assert.equal(dryRun.workspaceSet.status, "planned");
    assert.equal(fs.existsSync(dryRun.workspaceSet.workspace_root), false);
    const dryValidation = validateContractDocument({ family: "workspace-set", document: dryRun.workspaceSet, source: "runtime://workspace-set-dry-run" });
    assert.equal(dryValidation.ok, true, dryValidation.issues.map((issue) => issue.message).join("; "));

    const provisioned = provisionProjectWorkspaceSet({
      cwd: repoRoot,
      projectRef: repoRoot,
      projectProfile: profile,
      runId: "run-s10-ready",
    });
    assert.equal(provisioned.workspaceSet.status, "ready");
    assert.equal(provisioned.workspaceSet.repositories[0].resolved_commit.length, 40);
    const validation = validateContractDocument({
      family: "workspace-set",
      document: provisioned.workspaceSet,
      source: provisioned.workspaceSetFile,
    });
    assert.equal(validation.ok, true, validation.issues.map((issue) => issue.message).join("; "));
    assert.equal(fs.existsSync(provisioned.workspaceSetFile), true);
    const replay = provisionProjectWorkspaceSet({ cwd: repoRoot, projectRef: repoRoot, projectProfile: profile, runId: "run-s10-ready" });
    assert.equal(replay.idempotent, true);
    assert.equal(replay.workspaceSet.workspace_set_ref, provisioned.workspaceSet.workspace_set_ref);
  });
});

test("public workspace service rejects a dirty source before creating a disposable checkout", () => {
  withTempRepo({ prefix: "aor-s10-workspace-dirty-", workspaceRoot }, (repoRoot) => {
    const profile = path.join(repoRoot, "examples", "project.aor.yaml");
    fs.writeFileSync(path.join(repoRoot, "dirty.txt"), "dirty\n");
    assert.throws(() => provisionProjectWorkspaceSet({
      cwd: repoRoot,
      projectRef: repoRoot,
      projectProfile: profile,
      runId: "run-s10-dirty",
    }), /dirtyPolicy=reject/u);
    assert.equal(fs.existsSync(path.join(process.env.AOR_HOME, "projects", "aor-core", "workspace-sets", "run-s10-dirty")), false);
  });
});

test("public integration materializes and applies a parent report with idempotent readback", () => {
  withTempRepo({ prefix: "aor-s10-integration-service-", workspaceRoot }, (repoRoot) => {
    const profile = path.join(repoRoot, "examples", "project.aor.yaml");
    const provisioned = provisionProjectWorkspaceSet({ cwd: repoRoot, projectRef: repoRoot, projectProfile: profile, runId: "run-s10-integrate" });
    const init = initializeProjectRuntime({ cwd: repoRoot, projectRef: repoRoot, projectProfile: profile });
    const plan = parseYaml(fs.readFileSync(path.join(repoRoot, "examples", "packets", "execution-plan-structured-medium.yaml"), "utf8"));
    plan.project_id = init.projectId;
    plan.execution_plan_id = "aor-core.execution-plan.s10";
    plan.plan_id = "aor-core.plan.s10";
    plan.execution_units = [{ ...plan.execution_units[0], unit_id: "unit.s10", task_refs: ["task.s10"], repository_scope: ["main"], scope: { repo_ids: ["main"], allowed_paths: [] }, depends_on: [] }];
    plan.impacted_scope = { repo_ids: ["main"], component_ids: [], allowed_paths: [], forbidden_paths: [] };
    plan.integration_gates = [];
    const planFile = path.join(init.runtimeLayout.reportsRoot, "execution-plan-s10.json");
    fs.writeFileSync(planFile, `${JSON.stringify(plan, null, 2)}\n`);
    const parentFile = path.join(init.runtimeLayout.stateRoot, "parent-runs", "parent-run-run-s10-integrate.json");
    fs.mkdirSync(path.dirname(parentFile), { recursive: true });
    fs.writeFileSync(parentFile, `${JSON.stringify({
      schema_version: 1,
      parent_run_id: "run-s10-integrate",
      project_id: init.projectId,
      execution_plan_ref: `evidence://projects/${init.workspaceProjectId}/reports/execution-plan-s10.json`,
      workspace_set_ref: provisioned.workspaceSet.workspace_set_ref,
      status: "integration-pending",
      revision: 0,
      units: [{ execution_unit_id: "unit.s10", depends_on: [], status: "succeeded" }],
      integration_gates: [],
    }, null, 2)}\n`);
    const patchFile = path.join(init.runtimeLayout.reportsRoot, "child-output-s10.patch");
    const readme = path.join(repoRoot, "examples", "project.aor.yaml");
    const originalReadme = fs.readFileSync(readme, "utf8");
    fs.writeFileSync(readme, `${originalReadme}\n# s10\n`);
    const patchBytes = execFileSync("git", ["diff", "--binary"], { cwd: repoRoot });
    fs.writeFileSync(readme, originalReadme);
    fs.writeFileSync(patchFile, patchBytes);
    const childOutputFile = path.join(init.runtimeLayout.reportsRoot, "child-output-s10.json");
    const patch = {
      project_id: init.projectId,
      parent_run_id: "run-s10-integrate",
      execution_unit_id: "unit.s10",
      child_run_id: "child-s10",
      attempt: 1,
      repo_id: "main",
      output_kind: "patch",
      output_ref: `evidence://projects/${init.workspaceProjectId}/reports/child-output-s10.patch`,
      output_file: patchFile,
      output_digest: crypto.createHash("sha256").update(patchBytes).digest("hex"),
      changed_paths: ["examples/project.aor.yaml"],
    };
    fs.writeFileSync(childOutputFile, `${JSON.stringify(patch, null, 2)}\n`);
    const result = materializeParentIntegration({
      cwd: repoRoot,
      projectRef: repoRoot,
      projectProfile: profile,
      parentRunId: "run-s10-integrate",
      expectedRevision: 0,
      childOutputRefs: [`evidence://projects/${init.workspaceProjectId}/reports/child-output-s10.json`],
    });
    assert.equal(result.parent.status, "succeeded");
    const replay = materializeParentIntegration({ cwd: repoRoot, projectRef: repoRoot, projectProfile: profile, parentRunId: "run-s10-integrate" });
    assert.equal(replay.idempotent, true);
    assert.equal(replay.report.report_id, result.report.report_id);
  });
});
