import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadContractFile, validateContractDocument } from "../src/index.mjs";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const fixturePath = path.join(workspaceRoot, "examples/tasks/task-projection.prepared.yaml");

test("prepared Task projection validates as a versioned server-owned contract", () => {
  const loaded = loadContractFile({ filePath: fixturePath, family: "task-projection" });
  assert.equal(loaded.ok, true, loaded.issues?.map((entry) => entry.message).join("\n"));
});

test("Task projection rejects intake routes and non-canonical prepared actions", () => {
  const loaded = loadContractFile({ filePath: fixturePath, family: "task-projection" });
  const intakeRoute = structuredClone(loaded.document);
  intakeRoute.prepared_contract.approved_execution_route.route_id = "route.intake-normalize.default";
  const routeResult = validateContractDocument({ family: "task-projection", document: intakeRoute, source: "test://intake-route" });
  assert.ok(routeResult.issues.some((entry) => entry.field === "prepared_contract.approved_execution_route.route_id"));

  const wrongAction = structuredClone(loaded.document);
  wrongAction.primary_action.action_id = "confirm";
  const actionResult = validateContractDocument({ family: "task-projection", document: wrongAction, source: "test://wrong-action" });
  assert.ok(actionResult.issues.some((entry) => entry.field === "primary_action.action_id"));
});

test("legacy Task projection may omit new lineage values without inventing execution identity", () => {
  const loaded = loadContractFile({ filePath: fixturePath, family: "task-projection" });
  const legacy = structuredClone(loaded.document);
  legacy.status = "active";
  legacy.lineage.intent_submission_id = null;
  legacy.prepared_contract.outcome = null;
  legacy.prepared_contract.approved_execution_route.route_id = null;
  legacy.prepared_contract.approved_execution_route.readiness = "unknown";
  legacy.primary_action.action_id = "discovery-run";
  const result = validateContractDocument({ family: "task-projection", document: legacy, source: "test://legacy" });
  assert.equal(result.ok, true, result.issues?.map((entry) => entry.message).join("\n"));
});

test("Task run state is bounded to a listed run and a canonical run-job status", () => {
  const loaded = loadContractFile({ filePath: fixturePath, family: "task-projection" });
  const valid = structuredClone(loaded.document);
  valid.run_ids = ["run.task-projection"];
  valid.run_state = { run_id: "run.task-projection", status: "paused" };
  assert.equal(validateContractDocument({ family: "task-projection", document: valid, source: "test://run-state" }).ok, true);

  const unknownStatus = structuredClone(valid);
  unknownStatus.run_state.status = "sleeping";
  const statusResult = validateContractDocument({ family: "task-projection", document: unknownStatus, source: "test://run-state-status" });
  assert.ok(statusResult.issues.some((entry) => entry.field === "run_state.status"));

  const unlinkedRun = structuredClone(valid);
  unlinkedRun.run_state.run_id = "run.other";
  const runResult = validateContractDocument({ family: "task-projection", document: unlinkedRun, source: "test://run-state-run" });
  assert.ok(runResult.issues.some((entry) => entry.field === "run_state.run_id"));

  const nullState = structuredClone(valid);
  nullState.run_state = null;
  const nullResult = validateContractDocument({ family: "task-projection", document: nullState, source: "test://run-state-null" });
  assert.ok(nullResult.issues.some((entry) => entry.field === "run_state"));
});

test("provider route step is a closed shared vocabulary", () => {
  const result = validateContractDocument({
    family: "provider-route-profile",
    source: "test://route-step",
    document: {
      route_id: "route.invalid",
      step: "provider-normalize",
      route_class: "artifact",
      risk_tier: "low",
      primary: { adapter: "none", provider: "openai" },
    },
  });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((entry) => entry.field === "step" && entry.code === "enum_value_invalid"));
});
