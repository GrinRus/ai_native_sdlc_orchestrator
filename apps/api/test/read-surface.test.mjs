import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateContractDocument } from "../../../packages/contracts/src/index.mjs";
import { materializeDeliveryPlan } from "../../../packages/orchestrator-core/src/delivery-plan.mjs";
import { runDeliveryDriver } from "../../../packages/orchestrator-core/src/delivery-driver.mjs";
import { initializeProjectRuntime } from "../../../packages/orchestrator-core/src/project-init.mjs";
import { appendRunEvent, attachUiLifecycle, detachUiLifecycle, readUiLifecycleState } from "../src/index.mjs";
import {
  listDeliveryManifests,
  listPacketArtifacts,
  listPromotionDecisions,
  listQualityArtifacts,
  readRunEventHistory,
  readRunPolicyHistory,
  listRuns,
  readStrategicSnapshot,
  listStepResults,
  readProjectState,
} from "../src/read-surface.mjs";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const workspaceRoot = path.resolve(currentDir, "../../..");

/**
 * @param {{ cwd: string, args: string[] }} options
 */
function runGitChecked(options) {
  const run = spawnSync("git", options.args, { cwd: options.cwd, encoding: "utf8" });
  assert.equal(
    run.status,
    0,
    `git ${options.args.join(" ")} failed: ${(run.stderr ?? run.stdout ?? "").trim()}`,
  );
}

/**
 * @param {{ family: import("../../../packages/contracts/src/index.d.ts").ContractFamily, filePath: string, document: Record<string, unknown> }} options
 */
function writeContractFile(options) {
  const validation = validateContractDocument({
    family: options.family,
    document: options.document,
    source: `runtime://${options.family}`,
  });
  assert.equal(validation.ok, true, `${options.family} fixture must pass contract validation`);
  fs.writeFileSync(options.filePath, `${JSON.stringify(options.document, null, 2)}\n`, "utf8");
}

/**
 * @param {(repoRoot: string) => void} callback
 */
function withTempRepo(callback) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-w5-s01-"));
  fs.cpSync(path.join(workspaceRoot, "examples"), path.join(repoRoot, "examples"), { recursive: true });
  runGitChecked({ cwd: repoRoot, args: ["init"] });
  runGitChecked({ cwd: repoRoot, args: ["config", "user.email", "aor@example.com"] });
  runGitChecked({ cwd: repoRoot, args: ["config", "user.name", "AOR Test"] });
  runGitChecked({ cwd: repoRoot, args: ["add", "-A"] });
  runGitChecked({ cwd: repoRoot, args: ["commit", "-m", "initial"] });

  try {
    callback(repoRoot);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
}

test("read surface exposes project state, packets, runs, and quality artifacts", () => {
  withTempRepo((repoRoot) => {
    const runId = "run.api.read.v1";
    const init = initializeProjectRuntime({ projectRef: repoRoot, cwd: repoRoot });

    const promotionDecisionPath = path.join(init.runtimeLayout.artifactsRoot, "promotion-decision-seed.json");
    writeContractFile({
      family: "promotion-decision",
      filePath: promotionDecisionPath,
      document: {
        decision_id: `${init.projectId}.promotion.seed`,
        subject_ref: "wrapper://wrapper.runner.default@v3",
        from_channel: "candidate",
        to_channel: "stable",
        evidence_refs: [init.stateFile],
        evidence_summary: {
          reason: "seed fixture for read-surface smoke test",
        },
        status: "pass",
      },
    });

    const plan = materializeDeliveryPlan({
      runtimeLayout: init.runtimeLayout,
      projectId: init.projectId,
      runId,
      stepClass: "implement",
      policyResolution: {
        resolved_bounds: {
          writeback_mode: {
            mode: "patch-only",
            resolution_source: {
              kind: "project-default",
              field: "writeback_policy.default_delivery_mode",
            },
          },
        },
      },
      handoffApproval: {
        status: "pass",
        ref: path.join(init.runtimeLayout.artifactsRoot, `${init.projectId}.handoff.bootstrap.v1.json`),
      },
      promotionEvidenceRefs: [promotionDecisionPath],
    });

    const targetFile = path.join(repoRoot, "examples/project.aor.yaml");
    fs.appendFileSync(targetFile, "\n# w5-s01 api read smoke\n", "utf8");
    const deliveryResult = runDeliveryDriver({
      projectRef: repoRoot,
      cwd: repoRoot,
      runId,
      mode: "patch-only",
      deliveryPlanPath: plan.deliveryPlanFile,
    });
    assert.equal(deliveryResult.status, "success");

    writeContractFile({
      family: "step-result",
      filePath: path.join(init.runtimeLayout.reportsRoot, "step-result-routed-implement.json"),
      document: {
        step_result_id: `${runId}.step.implement`,
        run_id: runId,
        step_id: "routed.implement",
        step_class: "runner",
        status: "passed",
        summary: "Routed dry-run implement step passed.",
        evidence_refs: [deliveryResult.transcriptFile],
      },
    });

    writeContractFile({
      family: "validation-report",
      filePath: path.join(init.runtimeLayout.reportsRoot, "validation-report-runtime.json"),
      document: {
        report_id: `${init.projectId}.validation.runtime`,
        subject_ref: `project://${init.projectId}`,
        validators: ["contract-shape"],
        status: "pass",
        evidence_refs: [init.stateFile],
      },
    });

    writeContractFile({
      family: "evaluation-report",
      filePath: path.join(init.runtimeLayout.reportsRoot, "evaluation-report-runtime.json"),
      document: {
        report_id: `${init.projectId}.evaluation.runtime`,
        subject_ref: "wrapper://wrapper.runner.default@v3",
        subject_type: "wrapper-profile",
        subject_fingerprint: "wrapper.runner.default-v3",
        suite_ref: "suite.release.core@v1",
        dataset_ref: "dataset://dataset.release.core@v1",
        scorer_metadata: [{ scorer: "deterministic", version: "1" }],
        grader_results: { deterministic: { status: "pass", score: 1 } },
        summary_metrics: { overall_score: 1, pass_rate: 1 },
        status: "pass",
        evidence_refs: [deliveryResult.transcriptFile],
      },
    });

    writeContractFile({
      family: "incident-report",
      filePath: path.join(init.runtimeLayout.reportsRoot, "incident-report-runtime.json"),
      document: {
        incident_id: `${init.projectId}.incident.runtime`,
        project_id: init.projectId,
        severity: "high",
        summary: "Delivery failure rehearsal requires follow-up.",
        linked_run_refs: [`run://${runId}`],
        linked_asset_refs: [deliveryResult.transcriptFile],
        status: "open",
      },
    });

    const projectState = readProjectState({ projectRef: repoRoot, cwd: repoRoot });
    assert.equal(projectState.project_id, init.projectId);
    assert.equal(projectState.project_root, repoRoot);

    const packets = listPacketArtifacts({ projectRef: repoRoot, cwd: repoRoot });
    assert.ok(packets.some((packet) => packet.family === "artifact-packet"));
    assert.ok(packets.some((packet) => packet.family === "delivery-plan"));
    assert.ok(packets.some((packet) => packet.family === "delivery-manifest"));
    assert.ok(packets.some((packet) => packet.family === "release-packet"));

    const stepResults = listStepResults({ projectRef: repoRoot, cwd: repoRoot });
    assert.ok(stepResults.some((result) => result.document.run_id === runId));

    const manifests = listDeliveryManifests({ projectRef: repoRoot, cwd: repoRoot });
    assert.ok(manifests.some((manifest) => manifest.document.delivery_mode === "patch-only"));

    const promotions = listPromotionDecisions({ projectRef: repoRoot, cwd: repoRoot });
    assert.ok(promotions.some((decision) => decision.document.status === "pass"));

    const qualityArtifacts = listQualityArtifacts({ projectRef: repoRoot, cwd: repoRoot });
    assert.ok(qualityArtifacts.some((artifact) => artifact.family === "validation-report"));
    assert.ok(qualityArtifacts.some((artifact) => artifact.family === "evaluation-report"));
    assert.ok(qualityArtifacts.some((artifact) => artifact.family === "incident-report"));
    assert.ok(qualityArtifacts.some((artifact) => artifact.family === "promotion-decision"));

    const runs = listRuns({ projectRef: repoRoot, cwd: repoRoot });
    const runSummary = runs.find((run) => run.run_id === runId);
    assert.ok(runSummary);
    assert.ok(runSummary.packet_refs.length >= 1);
    assert.ok(runSummary.step_result_refs.length >= 1);
    assert.ok(runSummary.quality_refs.length >= 1);
  });
});

test("listRuns includes run-control state snapshots even before packet/report artifacts exist", () => {
  withTempRepo((repoRoot) => {
    const init = initializeProjectRuntime({ projectRef: repoRoot, cwd: repoRoot });
    const runId = "run.control.read.v1";
    const stateFile = path.join(init.runtimeLayout.stateRoot, "run-control-state-run-control-read-v1.json");

    fs.writeFileSync(
      stateFile,
      `${JSON.stringify(
        {
          schema_version: 1,
          run_id: runId,
          status: "running",
          current_step: null,
          last_action: "start",
          started_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          action_sequence: 1,
          approval_refs: [],
          audit_refs: [],
          evidence_root: init.runtimeLayout.reportsRoot,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const runs = listRuns({ projectRef: repoRoot, cwd: repoRoot });
    const controlRun = runs.find((run) => run.run_id === runId);
    assert.ok(controlRun);
    assert.deepEqual(controlRun.packet_refs, []);
    assert.deepEqual(controlRun.step_result_refs, []);
    assert.deepEqual(controlRun.quality_refs, []);
  });
});

test("listRuns aggregates finance evidence across multiple run profiles", () => {
  withTempRepo((repoRoot) => {
    const init = initializeProjectRuntime({ projectRef: repoRoot, cwd: repoRoot });
    const runAlpha = "run.finance.audit.alpha.v1";
    const runBeta = "run.finance.audit.beta.v1";

    writeContractFile({
      family: "step-result",
      filePath: path.join(init.runtimeLayout.reportsRoot, "step-result-finance-alpha-a.json"),
      document: {
        step_result_id: `${runAlpha}.step.finance.a`,
        run_id: runAlpha,
        step_id: "runner.finance.a",
        step_class: "runner",
        status: "passed",
        summary: "Alpha finance sample A",
        evidence_refs: [init.stateFile],
        routed_execution: {
          started_at: "2026-01-01T00:00:00.000Z",
          finished_at: "2026-01-01T00:00:05.000Z",
          route_resolution: {
            resolved_route_id: "route.finance.alpha",
          },
          asset_resolution: {
            wrapper: {
              wrapper_ref: "wrapper://wrapper.finance.alpha@v1",
            },
          },
          adapter_resolution: {
            adapter: {
              adapter_id: "adapter.finance.alpha",
            },
          },
          policy_resolution: {
            resolved_bounds: {
              budget: {
                max_cost_usd: 12,
                timeout_sec: 40,
                max_cost_source: "policy.finance.alpha.max_cost",
                timeout_source: "policy.finance.alpha.timeout",
              },
            },
          },
        },
      },
    });

    writeContractFile({
      family: "step-result",
      filePath: path.join(init.runtimeLayout.reportsRoot, "step-result-finance-alpha-b.json"),
      document: {
        step_result_id: `${runAlpha}.step.finance.b`,
        run_id: runAlpha,
        step_id: "runner.finance.b",
        step_class: "runner",
        status: "passed",
        summary: "Alpha finance sample B",
        evidence_refs: [init.stateFile],
        routed_execution: {
          started_at: "2026-01-01T00:00:10.000Z",
          finished_at: "2026-01-01T00:00:17.000Z",
          route_resolution: {
            resolved_route_id: "route.finance.alpha",
          },
          asset_resolution: {
            wrapper: {
              wrapper_ref: "wrapper://wrapper.finance.alpha@v1",
            },
          },
          adapter_resolution: {
            adapter: {
              adapter_id: "adapter.finance.alpha",
            },
          },
          policy_resolution: {
            resolved_bounds: {
              budget: {
                max_cost_usd: 17,
                timeout_sec: 55,
                max_cost_source: "policy.finance.alpha.max_cost.override",
                timeout_source: "policy.finance.alpha.timeout.override",
              },
            },
          },
        },
      },
    });

    writeContractFile({
      family: "promotion-decision",
      filePath: path.join(init.runtimeLayout.artifactsRoot, "promotion-decision-finance-alpha.json"),
      document: {
        decision_id: `${init.projectId}.promotion.finance.alpha`,
        run_id: runAlpha,
        subject_ref: "wrapper://wrapper.finance.alpha@v1",
        from_channel: "candidate",
        to_channel: "stable",
        evidence_refs: [init.stateFile],
        evidence_summary: {
          finance_signals: {
            capture_latency_sec: 0.5,
            replay_latency_sec: 0.4,
            total_latency_sec: 0.9,
          },
          baseline_comparison: {
            baseline_pass_rate: 0.91,
            candidate_pass_rate: 0.87,
          },
        },
        status: "pass",
      },
    });

    writeContractFile({
      family: "step-result",
      filePath: path.join(init.runtimeLayout.reportsRoot, "step-result-finance-beta-a.json"),
      document: {
        step_result_id: `${runBeta}.step.finance.a`,
        run_id: runBeta,
        step_id: "runner.finance.a",
        step_class: "runner",
        status: "passed",
        summary: "Beta finance sample A",
        evidence_refs: [init.stateFile],
        routed_execution: {
          started_at: "2026-01-01T01:00:00.000Z",
          finished_at: "2026-01-01T01:00:03.000Z",
          route_resolution: {
            resolved_route_id: "route.finance.beta",
          },
          asset_resolution: {
            wrapper: {
              wrapper_ref: "wrapper://wrapper.finance.beta@v1",
            },
          },
          adapter_resolution: {
            adapter: {
              adapter_id: "adapter.finance.beta",
            },
          },
          policy_resolution: {
            resolved_bounds: {
              budget: {
                max_cost_usd: 4,
                timeout_sec: 20,
                max_cost_source: "policy.finance.beta.max_cost",
                timeout_source: "policy.finance.beta.timeout",
              },
            },
          },
        },
      },
    });

    writeContractFile({
      family: "promotion-decision",
      filePath: path.join(init.runtimeLayout.artifactsRoot, "promotion-decision-finance-beta.json"),
      document: {
        decision_id: `${init.projectId}.promotion.finance.beta`,
        run_id: runBeta,
        subject_ref: "wrapper://wrapper.finance.beta@v1",
        from_channel: "candidate",
        to_channel: "frozen",
        evidence_refs: [init.stateFile],
        evidence_summary: {
          finance_signals: {
            capture_latency_sec: 0.2,
            replay_latency_sec: 0.3,
            total_latency_sec: 0.5,
          },
          baseline_comparison: {
            baseline_pass_rate: 0.95,
            candidate_pass_rate: 0.95,
          },
        },
        status: "hold",
      },
    });

    const runs = listRuns({ projectRef: repoRoot, cwd: repoRoot });
    const alpha = runs.find((run) => run.run_id === runAlpha);
    const beta = runs.find((run) => run.run_id === runBeta);

    assert.ok(alpha);
    assert.ok(beta);

    assert.deepEqual(alpha.finance_evidence.route_ids, ["route.finance.alpha"]);
    assert.deepEqual(alpha.finance_evidence.wrapper_refs, ["wrapper://wrapper.finance.alpha@v1"]);
    assert.deepEqual(alpha.finance_evidence.adapter_ids, ["adapter.finance.alpha"]);
    assert.equal(alpha.finance_evidence.max_cost_usd, 17);
    assert.equal(alpha.finance_evidence.timeout_sec, 55);
    assert.ok(alpha.finance_evidence.max_cost_sources.includes("policy.finance.alpha.max_cost"));
    assert.ok(alpha.finance_evidence.max_cost_sources.includes("policy.finance.alpha.max_cost.override"));
    assert.ok(alpha.finance_evidence.timeout_sources.includes("policy.finance.alpha.timeout"));
    assert.ok(alpha.finance_evidence.timeout_sources.includes("policy.finance.alpha.timeout.override"));
    assert.deepEqual(alpha.finance_evidence.step_latency_sec, {
      samples: 2,
      min: 5,
      max: 7,
      avg: 6,
    });
    assert.deepEqual(alpha.finance_evidence.certification_latency_sec, {
      samples: 3,
      min: 0.4,
      max: 0.9,
      avg: 0.6,
    });
    assert.equal(alpha.finance_evidence.baseline_pass_rate, 0.91);
    assert.equal(alpha.finance_evidence.candidate_pass_rate, 0.87);

    assert.deepEqual(beta.finance_evidence.route_ids, ["route.finance.beta"]);
    assert.deepEqual(beta.finance_evidence.wrapper_refs, ["wrapper://wrapper.finance.beta@v1"]);
    assert.deepEqual(beta.finance_evidence.adapter_ids, ["adapter.finance.beta"]);
    assert.equal(beta.finance_evidence.max_cost_usd, 4);
    assert.equal(beta.finance_evidence.timeout_sec, 20);
    assert.deepEqual(beta.finance_evidence.step_latency_sec, {
      samples: 1,
      min: 3,
      max: 3,
      avg: 3,
    });
    assert.deepEqual(beta.finance_evidence.certification_latency_sec, {
      samples: 3,
      min: 0.2,
      max: 0.5,
      avg: 0.333,
    });
    assert.equal(beta.finance_evidence.baseline_pass_rate, 0.95);
    assert.equal(beta.finance_evidence.candidate_pass_rate, 0.95);
  });
});

test("listRuns exposes context lifecycle status, provenance, and decision trail", () => {
  withTempRepo((repoRoot) => {
    const init = initializeProjectRuntime({ projectRef: repoRoot, cwd: repoRoot });
    const runId = "run.context.lifecycle.v1";

    writeContractFile({
      family: "promotion-decision",
      filePath: path.join(init.runtimeLayout.artifactsRoot, "promotion-decision-context-runner-v1.json"),
      document: {
        decision_id: `${init.projectId}.promotion.context.runner.v1`,
        created_at: "2026-04-21T00:00:00.000Z",
        run_id: runId,
        linked_run_refs: [`run://${runId}`],
        subject_ref: "context-bundle://context.bundle.runner.foundation@v1",
        from_channel: "draft",
        to_channel: "candidate",
        evidence_refs: [init.stateFile],
        evidence_summary: {
          context_lifecycle: {
            context_asset_ref: "context-bundle://context.bundle.runner.foundation@v1",
            update_status: "initial",
            outdated: false,
            immutable_provenance_refs: ["compiled-context://compiled-context.aor-core.implement.runner-default"],
            decision_trail: [],
          },
        },
        status: "pass",
      },
    });

    writeContractFile({
      family: "promotion-decision",
      filePath: path.join(init.runtimeLayout.artifactsRoot, "promotion-decision-context-runner-v2.json"),
      document: {
        decision_id: `${init.projectId}.promotion.context.runner.v2`,
        created_at: "2026-04-22T00:00:00.000Z",
        run_id: runId,
        linked_run_refs: [`run://${runId}`],
        subject_ref: "context-bundle://context.bundle.runner.foundation@v2",
        from_channel: "candidate",
        to_channel: "stable",
        evidence_refs: [init.stateFile],
        evidence_summary: {
          context_lifecycle: {
            context_asset_ref: "context-bundle://context.bundle.runner.foundation@v2",
            update_status: "upgrade",
            outdated: false,
            immutable_provenance_refs: [
              "compiled-context://compiled-context.aor-core.implement.runner-default",
              "sha256://abc123",
            ],
            decision_trail: [
              {
                decision_id: `${init.projectId}.promotion.context.runner.v1`,
                decision_ref: "evidence://artifacts/promotion-decision-context-runner-v1.json",
                subject_ref: "context-bundle://context.bundle.runner.foundation@v1",
                version: 1,
                from_channel: "draft",
                to_channel: "candidate",
                status: "pass",
                created_at: "2026-04-21T00:00:00.000Z",
              },
            ],
          },
        },
        status: "pass",
      },
    });

    const runs = listRuns({ projectRef: repoRoot, cwd: repoRoot });
    const contextRun = runs.find((run) => run.run_id === runId);
    assert.ok(contextRun);
    assert.ok(
      contextRun.context_lifecycle.context_asset_refs.includes("context-bundle://context.bundle.runner.foundation@v2"),
    );
    assert.ok(
      contextRun.context_lifecycle.provenance_refs.includes(
        "compiled-context://compiled-context.aor-core.implement.runner-default",
      ),
    );
    assert.equal(contextRun.context_lifecycle.decision_trail.length >= 2, true);
    assert.equal(contextRun.context_lifecycle.decision_trail.some((entry) => entry.version === 1), true);
    assert.equal(contextRun.context_lifecycle.decision_trail.some((entry) => entry.version === 2), true);
  });
});

test("selected-run history surfaces expose policy and event troubleshooting context", () => {
  withTempRepo((repoRoot) => {
    const init = initializeProjectRuntime({ projectRef: repoRoot, cwd: repoRoot });
    const runId = "run.operator.policy.visibility.v1";

    writeContractFile({
      family: "step-result",
      filePath: path.join(init.runtimeLayout.reportsRoot, "step-result-policy-visibility.json"),
      document: {
        step_result_id: `${runId}.step.policy.visibility`,
        run_id: runId,
        step_id: "routed.implement",
        step_class: "runner",
        status: "passed",
        summary: "Policy visibility fixture step",
        evidence_refs: [init.stateFile],
        routed_execution: {
          started_at: "2026-01-01T00:00:00.000Z",
          finished_at: "2026-01-01T00:00:04.000Z",
          route_resolution: {
            resolved_route_id: "route.implement.default",
          },
          policy_resolution: {
            policy: {
              policy_id: "policy.step.runner.default",
            },
            resolved_bounds: {
              writeback_mode: {
                mode: "fork-first-pr",
              },
            },
            guardrails: {
              approval_required: true,
            },
            governance_decision: {
              decision: "escalate",
              reasons: [
                {
                  code: "high-risk-human-approval-required",
                  severity: "escalate",
                  message: "Explicit human approval is required.",
                },
              ],
            },
          },
        },
      },
    });

    writeContractFile({
      family: "delivery-plan",
      filePath: path.join(init.runtimeLayout.artifactsRoot, "delivery-plan-policy-visibility.json"),
      document: {
        plan_id: `${init.projectId}.delivery-plan.policy.visibility`,
        project_id: init.projectId,
        run_id: runId,
        step_class: "implement",
        delivery_mode: "fork-first-pr",
        mode_source: {
          resolved_mode: "pull-request",
          canonical_mode: "fork-first-pr",
          resolution_kind: "project-default",
          resolution_field: "writeback_policy.default_delivery_mode",
        },
        preconditions: {
          approved_handoff: {
            required: true,
            status: "missing",
            ref: null,
          },
          promotion_evidence: {
            required: true,
            status: "missing",
            refs: [],
          },
        },
        governance: {
          decision: "escalate",
          route_risk_tier: "high",
          high_risk_delivery: true,
          reasons: [
            {
              code: "high-risk-security-review-required",
              severity: "escalate",
              message: "Security review required before write-back.",
            },
          ],
        },
        writeback_allowed: false,
        blocking_reasons: ["high-risk-security-review-required"],
        status: "blocked",
        evidence_refs: [init.stateFile],
        created_at: "2026-01-02T00:00:00.000Z",
      },
    });

    appendRunEvent({
      projectRef: repoRoot,
      cwd: repoRoot,
      runId,
      eventType: "warning.raised",
      payload: {
        summary: "Run-control action blocked pending approval.",
        control_action: "steer",
        policy_context: {
          action: "steer",
          risk_tier: "high",
          high_risk: true,
          approval_required: true,
          approval_ref_present: false,
        },
      },
    });
    appendRunEvent({
      projectRef: repoRoot,
      cwd: repoRoot,
      runId,
      eventType: "step.updated",
      payload: {
        step_id: "routed.implement",
        status: "running",
      },
    });

    const runs = listRuns({ projectRef: repoRoot, cwd: repoRoot });
    const runSummary = runs.find((run) => run.run_id === runId);
    assert.ok(runSummary);
    assert.ok(runSummary.policy_context.route_ids.includes("route.implement.default"));
    assert.ok(runSummary.policy_context.policy_ids.includes("policy.step.runner.default"));
    assert.ok(runSummary.policy_context.governance_decisions.includes("escalate"));
    assert.equal(runSummary.policy_context.approval_required, true);

    const eventHistory = readRunEventHistory({
      projectRef: repoRoot,
      cwd: repoRoot,
      runId,
      limit: 10,
    });
    assert.equal(eventHistory.run_id, runId);
    assert.equal(eventHistory.total_events, 2);
    assert.equal(eventHistory.events[0].event_type, "warning.raised");
    assert.equal(eventHistory.events[0].policy_context.risk_tier, "high");

    const policyHistory = readRunPolicyHistory({
      projectRef: repoRoot,
      cwd: repoRoot,
      runId,
      limit: 10,
    });
    assert.equal(policyHistory.run_id, runId);
    assert.equal(policyHistory.entry_count, 2);
    assert.ok(policyHistory.entries.some((entry) => entry.source === "step-result"));
    assert.ok(policyHistory.entries.some((entry) => entry.source === "delivery-plan"));
    const stepHistory = policyHistory.entries.find((entry) => entry.source === "step-result");
    assert.equal(stepHistory.route_id, "route.implement.default");
    assert.equal(stepHistory.policy_id, "policy.step.runner.default");
    assert.equal(stepHistory.governance_reasons[0].code, "high-risk-human-approval-required");
  });
});

test("readStrategicSnapshot reports wave progress from backlog state", () => {
  const snapshot = readStrategicSnapshot({ projectRef: workspaceRoot, cwd: workspaceRoot });

  assert.equal(typeof snapshot.generated_at, "string");
  assert.equal(snapshot.wave_snapshot.source_backlog_ref, "docs/backlog/mvp-implementation-backlog.md");
  assert.ok(snapshot.wave_snapshot.total_slices > 0);
  assert.ok(Array.isArray(snapshot.wave_snapshot.waves));
  assert.ok(snapshot.wave_snapshot.waves.some((wave) => wave.wave_id === "W8"));
  assert.equal(typeof snapshot.risk_snapshot.level_totals.high, "number");
});

test("readStrategicSnapshot keeps risk reporting available when backlog file is missing", () => {
  withTempRepo((repoRoot) => {
    const init = initializeProjectRuntime({ projectRef: repoRoot, cwd: repoRoot });
    const runId = "run.strategic.risk.v1";

    writeContractFile({
      family: "incident-report",
      filePath: path.join(init.runtimeLayout.reportsRoot, "incident-report-strategic.json"),
      document: {
        incident_id: `${init.projectId}.incident.strategic`,
        project_id: init.projectId,
        severity: "high",
        summary: "Strategic snapshot risk fixture",
        linked_run_refs: [`run://${runId}`],
        linked_asset_refs: [init.stateFile],
        status: "open",
      },
    });

    writeContractFile({
      family: "promotion-decision",
      filePath: path.join(init.runtimeLayout.artifactsRoot, "promotion-decision-strategic.json"),
      document: {
        decision_id: `${init.projectId}.promotion.strategic`,
        subject_ref: "wrapper://wrapper.eval.default@v1",
        run_id: runId,
        linked_run_refs: [`run://${runId}`],
        from_channel: "candidate",
        to_channel: "stable",
        evidence_refs: [init.stateFile],
        evidence_summary: {
          baseline_comparison: {
            baseline_pass_rate: 0.95,
            candidate_pass_rate: 0.8,
          },
          finance_signals: {
            capture_latency_sec: 0.2,
            replay_latency_sec: 0.2,
          },
        },
        status: "fail",
      },
    });

    const snapshot = readStrategicSnapshot({ projectRef: repoRoot, cwd: repoRoot });
    assert.equal(snapshot.wave_snapshot.total_slices, 0);
    assert.equal(snapshot.wave_snapshot.waves.length, 0);
    assert.equal(snapshot.risk_snapshot.run_count, 1);
    assert.equal(snapshot.risk_snapshot.level_totals.high, 1);
    assert.equal(snapshot.risk_snapshot.signal_totals.incident_linked_runs, 1);
    assert.equal(snapshot.risk_snapshot.signal_totals.regression_runs, 1);
    assert.deepEqual(snapshot.risk_snapshot.high_risk_run_ids, [runId]);
  });
});

test("read surface links incident reports back to run-centric audit views", () => {
  withTempRepo((repoRoot) => {
    const init = initializeProjectRuntime({ projectRef: repoRoot, cwd: repoRoot });
    const runId = "run.incident.audit.v1";
    const incidentFile = path.join(init.runtimeLayout.reportsRoot, "incident-report-run-incident-audit-v1.json");

    writeContractFile({
      family: "incident-report",
      filePath: incidentFile,
      document: {
        incident_id: `${init.projectId}.incident.audit.v1`,
        project_id: init.projectId,
        severity: "high",
        summary: "Run requires incident follow-up.",
        linked_run_refs: [`run://${runId}`],
        linked_asset_refs: ["evidence://reports/learning-loop-scorecard-run-incident-audit-v1.json"],
        status: "open",
      },
    });

    const qualityArtifacts = listQualityArtifacts({ projectRef: repoRoot, cwd: repoRoot });
    const incidentArtifact = qualityArtifacts.find(
      (artifact) => artifact.family === "incident-report" && artifact.document.incident_id === `${init.projectId}.incident.audit.v1`,
    );
    assert.ok(incidentArtifact);

    const runs = listRuns({ projectRef: repoRoot, cwd: repoRoot });
    const auditedRun = runs.find((run) => run.run_id === runId);
    assert.ok(auditedRun);
    assert.ok(auditedRun.quality_refs.includes(/** @type {any} */ (incidentArtifact).artifact_ref));
  });
});

test("ui lifecycle API supports attach/detach idempotency and disconnected mode", () => {
  withTempRepo((repoRoot) => {
    const attached = attachUiLifecycle({
      projectRef: repoRoot,
      cwd: repoRoot,
      runId: "ui-api-smoke",
      controlPlane: "http://localhost:8080",
    });
    assert.equal(attached.action, "attach");
    assert.equal(attached.idempotent, false);
    assert.equal(attached.state.ui_attached, true);
    assert.equal(attached.state.connection_state, "connected");
    assert.equal(fs.existsSync(attached.stateFile), true);

    const attachedRetry = attachUiLifecycle({
      projectRef: repoRoot,
      cwd: repoRoot,
      runId: "ui-api-smoke",
      controlPlane: "http://localhost:8080",
    });
    assert.equal(attachedRetry.idempotent, true);

    const detached = detachUiLifecycle({
      projectRef: repoRoot,
      cwd: repoRoot,
      runId: "ui-api-smoke",
    });
    assert.equal(detached.action, "detach");
    assert.equal(detached.idempotent, false);
    assert.equal(detached.state.ui_attached, false);
    assert.equal(detached.state.connection_state, "detached");

    const detachedRetry = detachUiLifecycle({
      projectRef: repoRoot,
      cwd: repoRoot,
      runId: "ui-api-smoke",
    });
    assert.equal(detachedRetry.idempotent, true);

    const disconnectedAttach = attachUiLifecycle({
      projectRef: repoRoot,
      cwd: repoRoot,
      runId: "ui-api-smoke",
    });
    assert.equal(disconnectedAttach.state.connection_state, "disconnected");
    assert.equal(disconnectedAttach.state.headless_safe, true);

    const lifecycle = readUiLifecycleState({
      projectRef: repoRoot,
      cwd: repoRoot,
    });
    assert.equal(lifecycle.state.ui_attached, true);
    assert.equal(lifecycle.state.connection_state, "disconnected");
    assert.equal(lifecycle.state.headless_safe, true);
  });
});
