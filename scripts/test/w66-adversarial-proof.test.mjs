import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { materializeQualityRepairRequest } from "../../packages/observability/src/quality-repair-request.mjs";
import { acknowledgeQualityRepairLaunch, retryQualityRepair, transitionQualityRepairAttempt } from "../../packages/observability/src/quality-repair-attempt.mjs";

const root = path.resolve(new URL("../..", import.meta.url).pathname);

test("W66 adversarial corpus fails closed and preserves provider-format parity", () => {
  const result = spawnSync(process.execPath, [path.join(root, "scripts/w66-adversarial-proof.mjs")], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "pass");
  assert.equal(report.provider_calls, false);
  assert.equal(report.upstream_writes, false);
  assert.equal(report.provider_format_parity.equivalent, true);
  assert.ok(report.cases.filter((entry) => entry.kind !== "positive").every((entry) => entry.accepted === false));
  assert.ok(report.family_matrix.every((entry) => entry.negative_never_passes && entry.no_write));
  assert.doesNotMatch(JSON.stringify(report), /raw-output|credentials|\/private\/|\/tmp\/|[A-Z]:\\/u);
});

function repairFixture() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "aor-w66-repair-proof-"));
  const projectRoot = path.join(rootDir, "project");
  const reportsRoot = path.join(rootDir, "runtime", "reports");
  const stateRoot = path.join(rootDir, "runtime", "state");
  const workspacesRoot = path.join(rootDir, "runtime", "workspaces");
  const executionRoot = path.join(workspacesRoot, "repair-1");
  for (const directory of [projectRoot, reportsRoot, stateRoot, executionRoot]) fs.mkdirSync(directory, { recursive: true });
  const request = materializeQualityRepairRequest({
    projectId: "w66-proof",
    projectRoot,
    runtimeLayout: { reportsRoot },
    runId: "run-w66-proof",
    sourceStage: "review",
    sourceRef: "evidence://w66-proof/review",
    findingRefs: ["finding://w66-proof/output-contract"],
    attemptBudget: { policy_ref: "project-profile://w66-proof#quality-repair", max_attempts: 2, attempt_index: 1, remaining_attempts: 1 },
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  return { rootDir, projectRoot, reportsRoot, stateRoot, workspacesRoot, executionRoot, request };
}

test("W66 repair proof keeps one active attempt, exactly-once debit, CAS, and review return", () => {
  const value = repairFixture();
  try {
    const options = {
      projectId: "w66-proof",
      projectRoot: value.projectRoot,
      runtimeLayout: { reportsRoot: value.reportsRoot, stateRoot: value.stateRoot },
      requestFile: value.request.requestFile,
      commandId: "w66-repair-1",
      expectedRevision: 0,
      workspaceRef: "workspace://projects/w66-proof/repair-1",
      workspaceOwner: "project://w66-proof",
      executionRoot: value.executionRoot,
      workspacesRoot: value.workspacesRoot,
      inputFingerprint: "sha256:w66-input",
      findingFingerprint: "sha256:w66-finding",
      failureFingerprint: "sha256:w66-failure",
      routeRef: "route://w66-proof/default",
    };
    const reserved = retryQualityRepair(options);
    const replay = retryQualityRepair(options);
    assert.equal(replay.replay, true);
    const running = acknowledgeQualityRepairLaunch({ projectRoot: value.projectRoot, runtimeLayout: options.runtimeLayout, requestFile: value.request.requestFile, attemptFile: reserved.attempt_file, commandId: "w66-launch-1", expectedRevision: reserved.request_revision });
    const idempotent = acknowledgeQualityRepairLaunch({ projectRoot: value.projectRoot, runtimeLayout: options.runtimeLayout, requestFile: value.request.requestFile, attemptFile: reserved.attempt_file, commandId: "w66-launch-1", expectedRevision: running.request.revision });
    assert.equal(running.attempt.budget.debited, true);
    assert.equal(running.request.attempt_budget.debited_attempts, 1);
    assert.equal(idempotent.idempotent, true);
    const completed = transitionQualityRepairAttempt({ projectRoot: value.projectRoot, runtimeLayout: options.runtimeLayout, requestFile: value.request.requestFile, attemptFile: reserved.attempt_file, status: "completed", expectedRevision: running.request.revision });
    assert.equal(completed.request.status, "review-required");
    assert.throws(() => retryQualityRepair({ ...options, commandId: "w66-review-block", expectedRevision: completed.request.revision }), (error) => error.code === "quality-repair-review-required");
    assert.deepEqual(fs.readdirSync(value.projectRoot), []);
  } finally {
    fs.rmSync(value.rootDir, { recursive: true, force: true });
  }
});
