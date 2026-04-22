import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  resolveStepPolicyForStep,
  resolveStepPolicyMatrix,
} from "../src/policy-resolution.mjs";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const workspaceRoot = path.resolve(currentDir, "../../..");

/**
 * @param {(repoRoot: string) => void} callback
 */
function withTempRepo(callback) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-w2-s03-"));
  fs.mkdirSync(path.join(repoRoot, ".git"), { recursive: true });
  fs.cpSync(path.join(workspaceRoot, "examples"), path.join(repoRoot, "examples"), { recursive: true });

  try {
    callback(repoRoot);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
}

test("resolveStepPolicyMatrix resolves deterministic bounds and guardrails for all step classes", () => {
  withTempRepo((repoRoot) => {
    const matrix = resolveStepPolicyMatrix({
      projectProfilePath: path.join(repoRoot, "examples/project.aor.yaml"),
      routesRoot: path.join(repoRoot, "examples/routes"),
      policiesRoot: path.join(repoRoot, "examples/policies"),
    });

    assert.equal(matrix.length, 10);
    const planning = matrix.find((entry) => entry.step_class === "planning");
    assert.ok(planning);
    assert.equal(planning.policy.policy_id, "policy.step.planner.default");
    assert.equal(planning.policy.resolution_source.kind, "project-default");
    assert.equal(planning.resolved_bounds.budget.max_cost_usd, 4);
    assert.equal(planning.resolved_bounds.budget.timeout_sec, 300);
    assert.deepEqual(planning.resolved_bounds.retry, {
      max_attempts: 1,
      on: ["provider-timeout"],
      source: "step-policy-profile.retry",
    });
    assert.ok(planning.resolved_bounds.command_constraints.allowed_commands.includes("pnpm lint"));
    assert.equal(planning.resolved_bounds.writeback_mode.mode, "pull-request");
    assert.equal(planning.guardrails.approval_required, true);
    assert.equal(planning.guardrails.provider_allowlist_enforced, true);
    assert.equal(planning.guardrails.redact_secrets, true);
  });
});

test("resolveStepPolicyForStep applies explicit step policy overrides with deterministic precedence", () => {
  withTempRepo((repoRoot) => {
    const overridePolicyPath = path.join(repoRoot, "examples/policies/step-planner-override.yaml");
    fs.writeFileSync(
      overridePolicyPath,
      [
        "policy_id: policy.step.planner.override",
        "step_class: planner",
        "pre_validators:",
        "  - contract-shape",
        "post_validators:",
        "  - output-schema",
        "quality_gate:",
        "  required: false",
        "retry:",
        "  max_attempts: 3",
        "  on:",
        "    - provider-timeout",
        "command_constraints:",
        "  allowed_commands:",
        "    - pnpm test --filter planner",
        "writeback_policy:",
        "  mode: patch",
      ].join("\n"),
      "utf8",
    );

    const resolved = resolveStepPolicyForStep({
      projectProfilePath: path.join(repoRoot, "examples/project.aor.yaml"),
      routesRoot: path.join(repoRoot, "examples/routes"),
      policiesRoot: path.join(repoRoot, "examples/policies"),
      stepClass: "planning",
      policyOverrides: {
        planning: "policy.step.planner.override",
      },
    });

    assert.equal(resolved.policy.policy_id, "policy.step.planner.override");
    assert.equal(resolved.policy.resolution_source.kind, "step-override");
    assert.deepEqual(resolved.resolved_bounds.command_constraints.allowed_commands, [
      "pnpm test --filter planner",
    ]);
    assert.equal(resolved.resolved_bounds.command_constraints.resolution_source.kind, "step-override");
    assert.equal(resolved.resolved_bounds.writeback_mode.mode, "patch");
    assert.equal(resolved.resolved_bounds.writeback_mode.resolution_source.kind, "step-override");
  });
});

test("resolveStepPolicyForStep fails deterministically when required policy source is missing", () => {
  withTempRepo((repoRoot) => {
    const profilePath = path.join(repoRoot, "examples/project.aor.yaml");
    const content = fs.readFileSync(profilePath, "utf8");
    fs.writeFileSync(
      profilePath,
      content.replace("planner: policy.step.planner.default", "planner: ''"),
      "utf8",
    );

    assert.throws(
      () =>
        resolveStepPolicyForStep({
          projectProfilePath: profilePath,
          routesRoot: path.join(repoRoot, "examples/routes"),
          policiesRoot: path.join(repoRoot, "examples/policies"),
          stepClass: "planning",
        }),
      /missing source in policy override and default_step_policies\.planner/i,
    );
  });
});

test("resolveStepPolicyForStep fails deterministically on conflicting override step class", () => {
  withTempRepo((repoRoot) => {
    assert.throws(
      () =>
        resolveStepPolicyForStep({
          projectProfilePath: path.join(repoRoot, "examples/project.aor.yaml"),
          routesRoot: path.join(repoRoot, "examples/routes"),
          policiesRoot: path.join(repoRoot, "examples/policies"),
          stepClass: "planning",
          policyOverrides: {
            planning: "policy.step.runner.default",
          },
        }),
      /Policy resolution conflict for step 'planning'/i,
    );
  });
});
