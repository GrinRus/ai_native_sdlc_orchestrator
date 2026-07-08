import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { readProjectState, listRuns } from "../src/control-plane/read-surface.mjs";
import { initializeProjectRuntime } from "../src/project-init.mjs";

test("control-plane read model projects sibling live E2E run-health for target checkouts", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-live-e2e-read-model-"));
  try {
    const runId = "live-e2e.test.run";
    const liveProjectRoot = path.join(tempRoot, "runtime", "projects", "aor-core");
    const reportsRoot = path.join(liveProjectRoot, "reports");
    const targetRoot = path.join(liveProjectRoot, "target-checkouts", "sample-target");
    fs.mkdirSync(reportsRoot, { recursive: true });
    fs.mkdirSync(targetRoot, { recursive: true });
    fs.mkdirSync(path.join(targetRoot, ".git"), { recursive: true });
    fs.writeFileSync(path.join(targetRoot, "README.md"), "# Sample target\n", "utf8");
    const targetRuntimeRoot = path.join(targetRoot, ".aor");
    initializeProjectRuntime({ projectRef: targetRoot, cwd: targetRoot, runtimeRoot: targetRuntimeRoot });

    const controllerFile = path.join(reportsRoot, `live-e2e-controller-state-${runId}.json`);
    const observationFile = path.join(reportsRoot, `live-e2e-observation-report-${runId}.json`);
    const healthFile = path.join(reportsRoot, `live-e2e-run-health-report-${runId}.json`);
    const requestFile = path.join(reportsRoot, `live-e2e-agent-decision-request-${runId}-15-delivery.json`);
    const expectedDecisionFile = path.join(reportsRoot, `live-e2e-operator-decision-${runId}-15-delivery.json`);

    fs.writeFileSync(
      controllerFile,
      `${JSON.stringify(
        {
          run_id: runId,
          current_step: "delivery",
          completed_steps: ["discovery", "spec", "planning", "handoff", "execution", "review", "qa", "delivery"],
          pending_decision: {
            action: "diagnose",
            reason: "Skill-agent operator decision is required before continuation.",
            next_step: null,
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    fs.writeFileSync(
      observationFile,
      `${JSON.stringify(
        {
          report_id: `${runId}.live-e2e-observation.v1`,
          run_id: runId,
          profile_id: "live-e2e.test.profile",
          report_status: "in_progress",
          overall_status: "blocked",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    fs.writeFileSync(
      requestFile,
      `${JSON.stringify(
        {
          request_id: `${runId}.delivery.operator-decision-request`,
          run_id: runId,
          step_id: "delivery",
          deterministic_analysis: {
            status: "not_pass",
            failure_class: "delivery-failed",
            recommendation: "diagnose",
          },
          decision_rubric: {
            required_checks: [
              "inspect-public-command-transcript",
              "inspect-materialized-artifact-refs",
            ],
            required_evidence_refs: [
              requestFile,
              path.join(reportsRoot, `live-e2e-step-plan-${runId}-15-delivery.json`),
            ],
          },
          expected_response_shape: {
            action: "continue|diagnose|block",
            evidence_refs: [
              requestFile,
              path.join(reportsRoot, `live-e2e-step-classification-${runId}-15-delivery.json`),
            ],
          },
          operator_decision_expected_ref: expectedDecisionFile,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    fs.writeFileSync(
      healthFile,
      `${JSON.stringify(
        {
          report_id: `${runId}.live-e2e-run-health.v1`,
          run_id: runId,
          profile_id: "live-e2e.test.profile",
          generated_at: "2026-07-08T17:06:10.961Z",
          source_observation_report_file: observationFile,
          overall_status: "blocked",
          lifecycle_completion: {
            pending_steps: ["delivery"],
            missing_operator_decision_steps: ["delivery"],
            blocked_step_id: "delivery",
          },
          controller_health: {
            status: "blocked",
            controller_state_ref: controllerFile,
            missing_phase_evidence: [],
            missing_operator_decision_steps: ["delivery"],
            rejected_operator_decision_steps: [],
          },
          evidence_health: {
            status: "warn",
            missing_evidence_refs: ["missing-ref-1"],
          },
          failure_summary: {
            owner: "provider",
            phase: "review",
            class: "verification_mapping_gap",
            summary: "Run artifacts declared a primary failure owner, phase, or class.",
          },
          resume_interaction_health: {
            status: "blocked",
            pending_interaction_count: 0,
            pending_decision_count: 1,
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    const siblingRunStateRoot = path.join(
      targetRuntimeRoot,
      "projects",
      "sample-target-live-run",
      "state",
    );
    fs.mkdirSync(siblingRunStateRoot, { recursive: true });
    const providerUpdatedAt = new Date().toISOString();
    fs.writeFileSync(
      path.join(siblingRunStateRoot, `run-control-state-${runId}.json`),
      `${JSON.stringify(
        {
          run_id: runId,
          status: "running",
          current_step: "execution",
          updated_at: providerUpdatedAt,
          provider_step_status: {
            provider: "openai",
            adapter: "codex-cli",
            route_id: "route.implement.default.openai-primary",
            step_id: "run.start.implement",
            status: "running",
            elapsed_ms: 42000,
            timeout_budget_ms: 1800000,
            remaining_budget_ms: 1758000,
            last_output_at: providerUpdatedAt,
            current_command_label: "external-provider-runner",
            recommended_action: "Provider is still running.",
            started_at: providerUpdatedAt,
            updated_at: providerUpdatedAt,
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const projectState = readProjectState({ projectRef: targetRoot, cwd: targetRoot, runtimeRoot: targetRuntimeRoot });
    assert.equal(projectState.provider_step_status.status, "running");
    assert.equal(projectState.provider_step_status.step_id, "run.start.implement");
    assert.equal(projectState.run_health.status, "blocked");
    assert.equal(projectState.run_health.current_step, "delivery");
    assert.equal(projectState.run_health.failure_summary.class, "verification_mapping_gap");
    assert.equal(projectState.run_health.pending_decision.request_ref, requestFile);
    assert.equal(projectState.run_health.pending_decision.decision_rubric_summary.required_check_count, 2);
    assert.equal(projectState.run_health.pending_decision.decision_rubric_summary.required_evidence_ref_count, 3);
    assert.equal(projectState.run_health.pending_decision.decision_rubric_summary.recommended_action, "diagnose");
    assert.ok(projectState.run_health.blockers.some((blocker) => blocker.code === "run_health.delivery.operator_decision_missing"));
    const decisionSummary = projectState.artifact_display_summaries.find(
      (summary) => summary.label === "Delivery operator decision request" && summary.status === "awaiting-decision",
    );
    assert.ok(decisionSummary);
    assert.equal(decisionSummary.decision_rubric_summary.required_check_count, 2);
    assert.equal(decisionSummary.decision_rubric_summary.required_evidence_ref_count, 3);
    assert.ok(decisionSummary.decision_rubric_summary.evidence_refs.some((entry) => entry.label === "Decision request"));
    assert.ok(decisionSummary.decision_rubric_summary.evidence_refs.some((entry) => entry.label === "Step plan"));

    const runs = listRuns({ projectRef: targetRoot, cwd: targetRoot, runtimeRoot: targetRuntimeRoot });
    const runSummary = runs.find((run) => run.run_id === runId);
    assert.ok(runSummary);
    assert.equal(runSummary.provider_step_status.status, "running");
    assert.equal(runSummary.run_health.status, "blocked");
    assert.ok(runSummary.artifact_display_summaries.some((summary) => summary.label === "Run health"));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
