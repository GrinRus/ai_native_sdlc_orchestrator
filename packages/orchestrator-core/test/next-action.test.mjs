import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { materializeIntakeArtifactPacket } from "../src/artifact-store.mjs";
import { resolveNextAction } from "../src/next-action.mjs";
import { initializeProjectRuntime } from "../src/project-init.mjs";

/**
 * @param {(tempRoot: string) => void} callback
 */
function withCleanRepo(callback) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-w21-s04-next-"));
  fs.mkdirSync(path.join(tempRoot, ".git"), { recursive: true });
  fs.writeFileSync(path.join(tempRoot, "package.json"), `${JSON.stringify({ name: "next-target" }, null, 2)}\n`, "utf8");
  try {
    callback(tempRoot);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

/**
 * @param {ReturnType<typeof initializeProjectRuntime>} init
 * @param {Partial<Parameters<typeof materializeIntakeArtifactPacket>[0]>} overrides
 */
function writeMission(init, overrides = {}) {
  return materializeIntakeArtifactPacket({
    projectId: init.projectId,
    projectRoot: init.projectRoot,
    projectProfileRef: init.projectProfileRef,
    runtimeLayout: init.runtimeLayout,
    command: "aor mission create",
    missionId: "checkout-risk",
    requestTitle: "Checkout risk",
    requestBrief: "Reduce checkout risk.",
    requestConstraints: ["Keep changes bounded."],
    goals: ["Make checkout failures actionable."],
    kpis: [
      {
        kpi_id: "checkout-risk",
        name: "Checkout risk",
        target: "Reduce support tickets.",
      },
    ],
    definitionOfDone: ["Checkout error copy is actionable."],
    allowedPaths: ["apps/web/**"],
    forbiddenPaths: ["packages/settlement/**"],
    deliveryMode: "patch-only",
    sourceKind: "local-prd",
    sourceRef: "docs/product/checkout-risk.md",
    ...overrides,
  });
}

test("resolveNextAction recommends discovery for complete guided mission intake", () => {
  withCleanRepo((tempRoot) => {
    const init = initializeProjectRuntime({ cwd: tempRoot, projectRef: tempRoot });
    writeMission(init);

    const resolved = resolveNextAction({ cwd: tempRoot, projectRef: tempRoot });
    const report = resolved.nextActionReport;

    assert.equal(report.status, "ready");
    assert.equal(report.project_state.stage, "discovery");
    assert.equal(report.primary_action.action_id, "discovery-run");
    assert.match(report.primary_action.command, /aor discovery run/);
    assert.equal(report.mission_state.completeness_status, "complete");
    assert.equal(report.mission_state.delivery_mode, "patch-only");
    assert.deepEqual(report.mission_state.allowed_paths, ["apps/web/**"]);
    assert.equal(report.bounded_execution.upstream_writes_default, false);
    assert.equal(report.bounded_execution.requires_review_before_writeback, true);
    assert.equal(fs.existsSync(resolved.nextActionReportFile), true);
  });
});

test("resolveNextAction blocks when guided mission intake is missing KPI and Definition of Done", () => {
  withCleanRepo((tempRoot) => {
    const init = initializeProjectRuntime({ cwd: tempRoot, projectRef: tempRoot });
    writeMission(init, {
      kpis: [],
      definitionOfDone: [],
      deliveryMode: "no-write",
    });

    const report = resolveNextAction({ cwd: tempRoot, projectRef: tempRoot }).nextActionReport;
    const blockerCodes = report.blockers.map((blocker) => blocker.code);

    assert.equal(report.status, "blocked");
    assert.equal(report.project_state.stage, "mission-intake");
    assert.equal(report.primary_action.action_id, "complete-mission-intake");
    assert.deepEqual(report.mission_state.missing_fields, ["kpis", "definition_of_done"]);
    assert.ok(blockerCodes.includes("mission-kpis-missing"));
    assert.ok(blockerCodes.includes("mission-definition_of_done-missing"));
    assert.equal(report.bounded_execution.delivery_capable_mode, false);
  });
});

test("resolveNextAction points to run status when a run is already active", () => {
  withCleanRepo((tempRoot) => {
    const init = initializeProjectRuntime({ cwd: tempRoot, projectRef: tempRoot });
    const runStateFile = path.join(init.runtimeLayout.stateRoot, "run-control-state-active-mission.json");
    fs.writeFileSync(
      runStateFile,
      `${JSON.stringify({ run_id: "active-mission", status: "running" }, null, 2)}\n`,
      "utf8",
    );

    const report = resolveNextAction({ cwd: tempRoot, projectRef: tempRoot }).nextActionReport;

    assert.equal(report.status, "ready");
    assert.equal(report.project_state.stage, "run-active");
    assert.equal(report.primary_action.action_id, "inspect-active-run");
    assert.match(report.primary_action.command, /aor run status/);
    assert.match(report.primary_action.command, /--run-id active-mission/);
  });
});

test("resolveNextAction blocks invalid mission packet state when body_ref is unreadable", () => {
  withCleanRepo((tempRoot) => {
    const init = initializeProjectRuntime({ cwd: tempRoot, projectRef: tempRoot });
    const intake = writeMission(init);
    fs.rmSync(intake.packetBodyFile, { force: true });

    const report = resolveNextAction({ cwd: tempRoot, projectRef: tempRoot }).nextActionReport;

    assert.equal(report.status, "blocked");
    assert.equal(report.primary_action.action_id, "repair-mission-intake");
    assert.equal(report.blockers[0].code, "intake-body-missing");
  });
});
