import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { materializeQualityRepairRequest } from "../src/quality-repair-request.mjs";
import {
  acknowledgeQualityRepairLaunch,
  retryQualityRepair,
  transitionQualityRepairAttempt,
} from "../src/quality-repair-attempt.mjs";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aor-quality-repair-attempt-"));
  const projectRoot = path.join(root, "project");
  const reportsRoot = path.join(root, "runtime", "reports");
  const stateRoot = path.join(root, "runtime", "state");
  const workspacesRoot = path.join(root, "runtime", "workspaces");
  const executionRoot = path.join(workspacesRoot, "repair-1");
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.mkdirSync(reportsRoot, { recursive: true });
  fs.mkdirSync(stateRoot, { recursive: true });
  fs.mkdirSync(executionRoot, { recursive: true });
  const request = materializeQualityRepairRequest({
    projectId: "demo",
    projectRoot,
    runtimeLayout: { reportsRoot },
    runId: "run-123",
    sourceStage: "review",
    sourceRef: "evidence://projects/demo/reports/review.json",
    findingRefs: ["finding://demo/output-contract"],
    attemptBudget: { policy_ref: "project-profile://demo#quality_repair_policy", max_attempts: 3, attempt_index: 1, remaining_attempts: 2 },
    createdAt: "2026-08-11T10:00:00.000Z",
  });
  return { root, projectRoot, reportsRoot, stateRoot, workspacesRoot, executionRoot, request };
}

function retryOptions(fixtureValue, overrides = {}) {
  return {
    projectId: "demo",
    projectRoot: fixtureValue.projectRoot,
    runtimeLayout: { reportsRoot: fixtureValue.reportsRoot, stateRoot: fixtureValue.stateRoot },
    requestFile: fixtureValue.request.requestFile,
    commandId: "repair-retry-1",
    expectedRevision: 0,
    workspaceRef: "workspace://projects/demo/repair-1",
    workspaceOwner: "project://demo",
    executionRoot: fixtureValue.executionRoot,
    workspacesRoot: fixtureValue.workspacesRoot,
    inputFingerprint: "sha256:input-1",
    findingFingerprint: "sha256:finding-1",
    failureFingerprint: "sha256:failure-1",
    diffFingerprint: "sha256:diff-1",
    routeRef: "route://repair/default",
    ...overrides,
  };
}

test("retryQualityRepair reserves an immutable attempt and replays the same command", () => {
  const value = fixture();
  const first = retryQualityRepair(retryOptions(value));
  assert.equal(first.replay, false);
  assert.equal(first.attempt.status, "reserved");
  assert.equal(first.attempt.attempt_index, 1);
  assert.equal(first.request.status, "in-progress");
  assert.equal(first.request.revision, 1);
  assert.equal(first.request.attempt_budget.remaining_attempts, 2);

  const replay = retryQualityRepair(retryOptions(value));
  assert.equal(replay.replay, true);
  assert.equal(replay.attempt.attempt_id, first.attempt.attempt_id);
  assert.equal(replay.request_revision, 1);
});

test("launch acknowledgement debits budget once, then terminal failure returns to retryable request", () => {
  const value = fixture();
  const reserved = retryQualityRepair(retryOptions(value));
  const running = acknowledgeQualityRepairLaunch({
    projectRoot: value.projectRoot,
    runtimeLayout: { reportsRoot: value.reportsRoot, stateRoot: value.stateRoot },
    requestFile: value.request.requestFile,
    attemptFile: reserved.attempt_file,
    commandId: "launch-1",
    expectedRevision: reserved.request_revision,
  });
  assert.equal(running.attempt.status, "running");
  assert.equal(running.attempt.budget.debited, true);
  assert.equal(running.request.attempt_budget.debited_attempts, 1);
  const failed = transitionQualityRepairAttempt({
    projectRoot: value.projectRoot,
    runtimeLayout: { reportsRoot: value.reportsRoot, stateRoot: value.stateRoot },
    requestFile: value.request.requestFile,
    attemptFile: reserved.attempt_file,
    status: "failed",
    expectedRevision: running.request.revision,
  });
  assert.equal(failed.attempt.status, "failed");
  assert.equal(failed.request.status, "requested");
  assert.equal(failed.request.active_attempt, null);
});

test("CAS, active-attempt and convergence guards fail closed", () => {
  const value = fixture();
  const reserved = retryQualityRepair(retryOptions(value));
  assert.throws(
    () => retryQualityRepair(retryOptions(value, { commandId: "repair-retry-stale", expectedRevision: 0 })),
    (error) => error.code === "quality-repair-in-progress" || error.code === "quality-repair-stale-revision",
  );
  assert.throws(
    () => retryQualityRepair(retryOptions(value, { commandId: "repair-retry-identical", expectedRevision: 1 })),
    (error) => error.code === "quality-repair-in-progress" || error.code === "repeated-repair-without-new-evidence",
  );
  assert.throws(
    () => retryQualityRepair(retryOptions(value, { commandId: "repair-retry-owner", expectedRevision: 1, workspaceOwner: "project://other" })),
    (error) => error.code === "quality-repair-in-progress" || error.code === "quality-repair-workspace-owner-mismatch",
  );
  assert.equal(reserved.attempt.status, "reserved");
});

test("retry rejects primary, external and missing workspaces before reservation", () => {
  const value = fixture();
  assert.throws(
    () => retryQualityRepair(retryOptions(value, { workspaceRef: "workspace://primary", commandId: "repair-primary" })),
    (error) => error.code === "quality-repair-primary-workspace",
  );
  assert.throws(
    () => retryQualityRepair(retryOptions(value, { executionRoot: path.join(value.root, "external"), commandId: "repair-external" })),
    (error) => error.code === "quality-repair-workspace-missing" || error.code === "quality-repair-workspace-external",
  );
});

test("retry rejects review-required, QA-required, exhausted and closed requests", () => {
  for (const status of ["review-required", "qa-required", "budget-exhausted", "closed"]) {
    const value = fixture();
    const request = JSON.parse(fs.readFileSync(value.request.requestFile, "utf8"));
    request.status = status;
    request.revision = 1;
    fs.writeFileSync(value.request.requestFile, `${JSON.stringify(request)}\n`, "utf8");
    assert.throws(
      () => retryQualityRepair(retryOptions(value, { commandId: `repair-${status}`, expectedRevision: 1 })),
      (error) => error.code === `quality-repair-${status}`,
    );
  }
});
