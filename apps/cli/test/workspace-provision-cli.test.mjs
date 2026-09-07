import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { parse as parseYaml } from "yaml";

import { invokeCli } from "../src/index.mjs";
import { readProjectState } from "../../../packages/orchestrator-core/src/control-plane/read-surface.mjs";
import { runGitChecked, withTempRepo } from "../../../scripts/test/helpers/temp-repo.mjs";

const workspaceRoot = path.resolve(new URL("../../..", import.meta.url).pathname);

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
