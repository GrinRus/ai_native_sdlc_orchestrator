import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { materializeDeliveryPlan } from "../src/delivery-plan.mjs";
import { resolveStepPolicyForStep } from "../src/policy-resolution.mjs";
import { initializeProjectRuntime } from "../src/project-init.mjs";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const workspaceRoot = path.resolve(currentDir, "../../..");

/**
 * @param {(repoRoot: string) => void} callback
 */
function withTempRepo(callback) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-w4-s02-"));
  fs.mkdirSync(path.join(repoRoot, ".git"), { recursive: true });
  fs.cpSync(path.join(workspaceRoot, "examples"), path.join(repoRoot, "examples"), { recursive: true });

  try {
    callback(repoRoot);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
}

test("materializeDeliveryPlan blocks non-read-only mode without approved handoff and promotion evidence", () => {
  withTempRepo((repoRoot) => {
    const init = initializeProjectRuntime({ projectRef: repoRoot, cwd: repoRoot });
    const policyResolution = resolveStepPolicyForStep({
      projectProfilePath: path.join(repoRoot, "examples/project.aor.yaml"),
      routesRoot: path.join(repoRoot, "examples/routes"),
      policiesRoot: path.join(repoRoot, "examples/policies"),
      stepClass: "implement",
    });

    const result = materializeDeliveryPlan({
      runtimeLayout: init.runtimeLayout,
      projectId: init.projectId,
      runId: "run.delivery.plan.v1",
      stepClass: "implement",
      policyResolution,
    });

    assert.equal(fs.existsSync(result.deliveryPlanFile), true);
    assert.equal(result.deliveryPlan.delivery_mode, "fork-first-pr");
    assert.equal(result.deliveryPlan.status, "blocked");
    assert.equal(result.deliveryPlan.writeback_allowed, false);
    assert.ok(result.deliveryPlan.blocking_reasons.includes("approved-handoff-required"));
    assert.ok(result.deliveryPlan.blocking_reasons.includes("promotion-evidence-required"));
    assert.equal(result.deliveryPlan.governance.decision, "allow");
  });
});

test("materializeDeliveryPlan allows non-read-only mode only with approved handoff and promotion evidence", () => {
  withTempRepo((repoRoot) => {
    const init = initializeProjectRuntime({ projectRef: repoRoot, cwd: repoRoot });
    const policyResolution = resolveStepPolicyForStep({
      projectProfilePath: path.join(repoRoot, "examples/project.aor.yaml"),
      routesRoot: path.join(repoRoot, "examples/routes"),
      policiesRoot: path.join(repoRoot, "examples/policies"),
      stepClass: "implement",
    });

    const handoffRef = path.join(init.runtimeLayout.artifactsRoot, `${init.projectId}.handoff.bootstrap.v1.json`);
    const promotionRef = path.join(
      init.runtimeLayout.reportsRoot,
      "promotion-decision-wrapper-wrapper.runner.default-v3-1776793902247.json",
    );

    const result = materializeDeliveryPlan({
      runtimeLayout: init.runtimeLayout,
      projectId: init.projectId,
      runId: "run.delivery.plan.v2",
      stepClass: "implement",
      policyResolution,
      handoffApproval: {
        status: "pass",
        ref: handoffRef,
      },
      promotionEvidenceRefs: [promotionRef],
    });

    assert.equal(result.deliveryPlan.delivery_mode, "fork-first-pr");
    assert.equal(result.deliveryPlan.status, "ready");
    assert.equal(result.deliveryPlan.writeback_allowed, true);
    assert.deepEqual(result.deliveryPlan.blocking_reasons, []);
    assert.equal(result.deliveryPlan.governance.decision, "allow");
    assert.equal(result.deliveryPlan.preconditions.approved_handoff.status, "present");
    assert.equal(result.deliveryPlan.preconditions.promotion_evidence.status, "present");
    assert.ok(result.deliveryPlan.evidence_refs.includes(handoffRef));
    assert.ok(result.deliveryPlan.evidence_refs.includes(promotionRef));
  });
});

test("materializeDeliveryPlan keeps no-write mode ready without handoff or promotion evidence", () => {
  withTempRepo((repoRoot) => {
    const init = initializeProjectRuntime({ projectRef: repoRoot, cwd: repoRoot });

    const result = materializeDeliveryPlan({
      runtimeLayout: init.runtimeLayout,
      projectId: init.projectId,
      runId: "run.delivery.plan.v3",
      stepClass: "planning",
      policyResolution: {
        resolved_bounds: {
          writeback_mode: {
            mode: "no-write",
            resolution_source: {
              kind: "step-override",
              field: "policy_overrides.planning -> writeback_policy.mode",
            },
          },
        },
      },
    });

    assert.equal(result.deliveryPlan.delivery_mode, "no-write");
    assert.equal(result.deliveryPlan.status, "ready");
    assert.equal(result.deliveryPlan.writeback_allowed, true);
    assert.deepEqual(result.deliveryPlan.blocking_reasons, []);
    assert.equal(result.deliveryPlan.preconditions.approved_handoff.status, "not-required");
    assert.equal(result.deliveryPlan.preconditions.promotion_evidence.status, "not-required");
    assert.equal(result.deliveryPlan.governance.decision, "allow");
  });
});

test("materializeDeliveryPlan blocks delivery when governance decision is deny", () => {
  withTempRepo((repoRoot) => {
    const profilePath = path.join(repoRoot, "examples/project.aor.yaml");
    const profileContent = fs.readFileSync(profilePath, "utf8");
    fs.writeFileSync(
      profilePath,
      profileContent.replace("  - openai\n  - anthropic\n  - open-code", "  - anthropic\n  - open-code"),
      "utf8",
    );

    const init = initializeProjectRuntime({ projectRef: repoRoot, cwd: repoRoot });
    const policyResolution = resolveStepPolicyForStep({
      projectProfilePath: profilePath,
      routesRoot: path.join(repoRoot, "examples/routes"),
      policiesRoot: path.join(repoRoot, "examples/policies"),
      stepClass: "implement",
    });

    const result = materializeDeliveryPlan({
      runtimeLayout: init.runtimeLayout,
      projectId: init.projectId,
      runId: "run.delivery.plan.deny.v1",
      stepClass: "implement",
      policyResolution,
      handoffApproval: { status: "pass", ref: "evidence://handoff/approved" },
      promotionEvidenceRefs: ["evidence://promotion/pass"],
    });

    assert.equal(result.deliveryPlan.governance.decision, "deny");
    assert.equal(result.deliveryPlan.status, "blocked");
    assert.ok(result.deliveryPlan.blocking_reasons.includes("provider-not-allowlisted"));
  });
});

test("materializeDeliveryPlan blocks delivery when governance decision escalates high-risk route", () => {
  withTempRepo((repoRoot) => {
    const routePath = path.join(repoRoot, "examples/routes/implement-default.yaml");
    const routeContent = fs.readFileSync(routePath, "utf8");
    fs.writeFileSync(routePath, routeContent.replace("risk_tier: medium", "risk_tier: high"), "utf8");

    const init = initializeProjectRuntime({ projectRef: repoRoot, cwd: repoRoot });
    const policyResolution = resolveStepPolicyForStep({
      projectProfilePath: path.join(repoRoot, "examples/project.aor.yaml"),
      routesRoot: path.join(repoRoot, "examples/routes"),
      policiesRoot: path.join(repoRoot, "examples/policies"),
      stepClass: "implement",
    });

    const result = materializeDeliveryPlan({
      runtimeLayout: init.runtimeLayout,
      projectId: init.projectId,
      runId: "run.delivery.plan.escalate.v1",
      stepClass: "implement",
      policyResolution,
      handoffApproval: { status: "pass", ref: "evidence://handoff/approved" },
      promotionEvidenceRefs: ["evidence://promotion/pass"],
    });

    assert.equal(result.deliveryPlan.governance.decision, "escalate");
    assert.equal(result.deliveryPlan.status, "blocked");
    assert.ok(result.deliveryPlan.blocking_reasons.includes("high-risk-security-review-required"));
    assert.ok(result.deliveryPlan.blocking_reasons.includes("high-risk-human-approval-required"));
  });
});

test("materializeDeliveryPlan requires coordination evidence for non-read-only multi-repo flows", () => {
  withTempRepo((repoRoot) => {
    const init = initializeProjectRuntime({ projectRef: repoRoot, cwd: repoRoot });
    const policyResolution = resolveStepPolicyForStep({
      projectProfilePath: path.join(repoRoot, "examples/project.aor.yaml"),
      routesRoot: path.join(repoRoot, "examples/routes"),
      policiesRoot: path.join(repoRoot, "examples/policies"),
      stepClass: "implement",
    });

    const result = materializeDeliveryPlan({
      runtimeLayout: init.runtimeLayout,
      projectId: init.projectId,
      runId: "run.delivery.plan.coordination.v1",
      stepClass: "implement",
      policyResolution,
      handoffApproval: { status: "pass", ref: "evidence://handoff/approved" },
      promotionEvidenceRefs: ["evidence://promotion/pass"],
      coordinationRepos: [
        { repo_id: "main", role: "application", default_branch: "main" },
        { repo_id: "docs", role: "documentation", default_branch: "main" },
      ],
    });

    assert.equal(result.deliveryPlan.coordination.required, true);
    assert.equal(result.deliveryPlan.coordination.status, "missing");
    assert.deepEqual(result.deliveryPlan.coordination.repo_ids, ["main", "docs"]);
    assert.equal(result.deliveryPlan.status, "blocked");
    assert.ok(result.deliveryPlan.blocking_reasons.includes("multi-repo-coordination-evidence-required"));
  });
});

test("materializeDeliveryPlan keeps rerun recovery bounded by run-ref, failed-step, and packet boundary", () => {
  withTempRepo((repoRoot) => {
    const init = initializeProjectRuntime({ projectRef: repoRoot, cwd: repoRoot });
    const policyResolution = resolveStepPolicyForStep({
      projectProfilePath: path.join(repoRoot, "examples/project.aor.yaml"),
      routesRoot: path.join(repoRoot, "examples/routes"),
      policiesRoot: path.join(repoRoot, "examples/policies"),
      stepClass: "implement",
    });

    const blocked = materializeDeliveryPlan({
      runtimeLayout: init.runtimeLayout,
      projectId: init.projectId,
      runId: "run.delivery.plan.rerun.blocked.v1",
      stepClass: "implement",
      policyResolution,
      handoffApproval: { status: "pass", ref: "evidence://handoff/approved" },
      promotionEvidenceRefs: ["evidence://promotion/pass"],
      rerunOfRunRef: "run://run.delivery.plan.failed.v1",
      rerunPacketBoundary: "delivery-manifest",
    });
    assert.equal(blocked.deliveryPlan.rerun_recovery.requested, true);
    assert.equal(blocked.deliveryPlan.rerun_recovery.status, "blocked");
    assert.ok(blocked.deliveryPlan.blocking_reasons.includes("rerun-failed-step-required"));

    const ready = materializeDeliveryPlan({
      runtimeLayout: init.runtimeLayout,
      projectId: init.projectId,
      runId: "run.delivery.plan.rerun.ready.v1",
      stepClass: "implement",
      policyResolution,
      handoffApproval: { status: "pass", ref: "evidence://handoff/approved" },
      promotionEvidenceRefs: ["evidence://promotion/pass"],
      rerunOfRunRef: "run://run.delivery.plan.failed.v1",
      rerunFailedStepRef: "deliver.prepare",
      rerunPacketBoundary: "delivery-manifest",
    });
    assert.equal(ready.deliveryPlan.rerun_recovery.requested, true);
    assert.equal(ready.deliveryPlan.rerun_recovery.status, "ready");
    assert.equal(ready.deliveryPlan.rerun_recovery.failed_step_ref, "deliver.prepare");
    assert.equal(ready.deliveryPlan.rerun_recovery.packet_boundary, "delivery-manifest");
    assert.equal(ready.deliveryPlan.status, "ready");
  });
});
