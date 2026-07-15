import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { validateContractDocument } from "../../contracts/src/index.mjs";
import {
  closeQualityRepairRequest,
  appendLiveRunEvent,
  listQualityRepairRequests,
  materializeQualityRepairRequest,
  materializeReviewDecision,
  updateQualityRepairRequest,
} from "../src/index.mjs";

test("live event IDs remain canonical and invalid run IDs fail before log materialization", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aor-canonical-live-event-"));
  const logFile = path.join(root, "nested", "events.jsonl");
  try {
    const runId = `run-${"r".repeat(124)}`;
    const event = appendLiveRunEvent({
      logFile,
      runId,
      eventType: "run.started",
      payload: {},
      timestamp: "2026-07-15T00:00:00.000Z",
    });
    assert.match(event.event_id, /^event-[a-f0-9]{32}$/u);
    assert.equal(event.event_id.length <= 128, true);

    const rejectedLog = path.join(root, "rejected", "events.jsonl");
    assert.throws(
      () => appendLiveRunEvent({ logFile: rejectedLog, runId: "run\nretry: 1", eventType: "run.started", payload: {} }),
      /Invalid run_id/u,
    );
    assert.equal(fs.existsSync(path.dirname(rejectedLog)), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

/**
 * @param {(root: string, runtimeLayout: { reportsRoot: string }) => void} callback
 */
function withRuntime(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aor-quality-repair-"));
  const runtimeLayout = { reportsRoot: path.join(root, ".aor/projects/aor-core/reports") };
  try {
    callback(root, runtimeLayout);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("quality repair request helpers create, read, update, and close bounded requests", () => {
  withRuntime((projectRoot, runtimeLayout) => {
    const created = materializeQualityRepairRequest({
      projectId: "aor-core",
      projectRoot,
      runtimeLayout,
      runId: "run.repair.lifecycle",
      sourceStage: "qa",
      sourceRef: "evidence://reports/runtime-harness-report-run-repair-lifecycle.json",
      findingRefs: ["qa.finding.failed-regression"],
      repairScope: {
        verification_refs: ["evidence://reports/qa-report-run-repair-lifecycle.json"],
        required_evidence_refs: ["evidence://reports/runtime-harness-report-run-repair-lifecycle.json"],
        reason: "Repair QA regression before delivery.",
      },
      attemptBudget: {
        policy_ref: "project-profile://aor-core#quality_repair_policy",
        max_attempts: 2,
        attempt_index: 1,
        remaining_attempts: 1,
      },
      createdAt: "2026-07-04T13:45:00.000Z",
    });

    assert.equal(fs.existsSync(created.requestFile), true);
    assert.equal(created.request.source_stage, "qa");
    assert.equal(created.request.status, "requested");
    assert.equal(created.lineage.request_ref, created.requestRef);
    assert.equal(
      validateContractDocument({
        family: "quality-repair-request",
        document: created.request,
        source: "fixture://quality-repair-request",
      }).ok,
      true,
    );

    const listed = listQualityRepairRequests({ projectRoot, runtimeLayout, runId: "run.repair.lifecycle" });
    assert.equal(listed.length, 1);

    const reviewRequired = updateQualityRepairRequest({
      projectRoot,
      runtimeLayout,
      requestFile: created.requestFile,
      status: "review-required",
      evidenceRefs: ["evidence://reports/step-result-run-repair-lifecycle-repair.json"],
      timestamp: "2026-07-04T13:50:00.000Z",
    });
    assert.equal(reviewRequired.request.status, "review-required");
    assert.equal(reviewRequired.request.status_history.length, 2);

    const closed = closeQualityRepairRequest({
      projectRoot,
      runtimeLayout,
      requestFile: created.requestFile,
      evidenceRefs: ["evidence://reports/review-report-run-repair-lifecycle-repair.json"],
      timestamp: "2026-07-04T14:00:00.000Z",
    });
    assert.equal(closed.request.status, "closed");
    assert.deepEqual(closed.request.blockers, []);
    assert.equal(closed.request.closed_at, "2026-07-04T14:00:00.000Z");
  });
});

test("request-repair review decisions materialize and link one quality repair request", () => {
  withRuntime((projectRoot, runtimeLayout) => {
    const reviewReport = {
      review_report_id: "run.review-request.review-report.v1",
      project_id: "aor-core",
      run_id: "run.review-request",
      overall_status: "fail",
      review_recommendation: "repair",
      findings: [
        {
          finding_id: "review.finding.coverage-gap",
          category: "artifact-quality",
          severity: "fail",
          summary: "Coverage gap blocks delivery.",
          evidence_refs: ["evidence://reports/review-report-run-review-request.json"],
          verification_failure_details: [
            {
              command: "npx xo",
              command_group_id: "post-change-lint",
              role: "lint",
              phase: "post-change",
              enforcement: "required",
              enforcement_result: "fail",
              outcome: null,
              exit_code: 1,
              signal: null,
              error_code: null,
              timed_out: false,
              timeout_class: "focused-test",
              command_timeout_ms: 300000,
              working_dir: ".",
              repo_scope: "target",
              stdout_excerpt: "",
              stderr_excerpt: "test/retry.ts: Type string | null is not assignable to type string.",
              failure_summary: "Post-change verification command 'npx xo' failed with exit code 1.",
              evidence_refs: ["evidence://reports/step-result-post-run-primary-1.json"],
            },
          ],
        },
      ],
      evidence_refs: ["evidence://reports/step-result-run-review-request.json"],
    };
    const runtimeHarnessReport = {
      report_id: "run.review-request.runtime-harness-report.v1",
      project_id: "aor-core",
      run_id: "run.review-request",
      overall_decision: "repair",
      run_findings: [],
      evidence_refs: ["evidence://reports/step-result-run-review-request.json"],
    };

    const result = materializeReviewDecision({
      projectId: "aor-core",
      projectRoot,
      runtimeLayout,
      runId: "run.review-request",
      decision: "request-repair",
      reason: "Coverage gap requires another implementation pass.",
      reviewReport,
      reviewReportRef: "evidence://reports/review-report-run-review-request.json",
      runtimeHarnessReport,
      runtimeHarnessReportRef: "evidence://reports/runtime-harness-report-run-review-request.json",
      timestamp: "2026-07-04T14:10:00.000Z",
    });

    assert.equal(result.decision.decision, "request-repair");
    assert.equal(result.decision.quality_repair_request_ref, result.qualityRepairRequestRef);
    assert.equal(result.decision.quality_repair_lineage.request_ref, result.qualityRepairRequestRef);
    assert.equal(
      result.decision.repair_context.unresolved_finding_details[0].verification_failure_details[0].command,
      "npx xo",
    );
    assert.match(
      result.decision.repair_context.unresolved_finding_details[0].verification_failure_details[0].stderr_excerpt,
      /string \| null/u,
    );
    assert.equal(result.qualityRepairRequest.source_stage, "review");
    assert.equal(result.qualityRepairRequest.status, "requested");
    assert.equal(
      validateContractDocument({
        family: "review-decision",
        document: result.decision,
        source: "fixture://review-decision-request-repair",
      }).ok,
      true,
    );
    assert.equal(listQualityRepairRequests({ projectRoot, runtimeLayout, runId: "run.review-request" }).length, 1);
  });
});
