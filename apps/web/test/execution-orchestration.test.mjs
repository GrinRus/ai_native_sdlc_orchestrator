import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { deliveryTransactionRows, executeOrchestrationCommand, integrationCommand, parentRunRows } from "../src/execution-orchestration-model.js";
import { loadGoldenLifecycle, validateGoldenLifecycle } from "../browser/golden-lifecycle-loader.mjs";
import { loadCutoverParityBaseline } from "../browser/cutover-parity-loader.mjs";
import { loadOperatorAcceptanceFixtures, loadOperatorScenarioCatalog, validateOperatorAcceptanceFixtures, validateOperatorScenarioCatalog } from "../browser/operator-scenario-loader.mjs";

const source = fs.readFileSync(new URL("../src/execution-orchestration.jsx", import.meta.url), "utf8");

test("execution workbench distinguishes parent, unit, attempt, integration, and delivery truth", () => {
  for (const label of ["Execution units", "Integration and recovery", "Coordinated delivery", "Attempts", "Changed paths"]) {
    assert.match(source, new RegExp(label, "u"));
  }
  assert.match(source, /Partial delivery is not success/u);
  assert.match(source, /Serialized:/u);
  assert.match(source, /aria-label/u);
});

test("execution projections stay flow scoped and partial delivery remains failed", () => {
  const parents = parentRunRows([
    { run_id: "parent-a", flow_id: "flow-a", parent_run: { parent_run_id: "parent-a", revision: 2 } },
    { run_id: "parent-b", flow_id: "flow-b", parent_run: { parent_run_id: "parent-b", revision: 1 } },
  ], "flow-a");
  assert.deepEqual(parents.map((entry) => entry.parent_run_id), ["parent-a"]);
  const transactions = deliveryTransactionRows([{ document: {
    manifest_id: "manifest-1",
    status: "failed",
    coordination_transaction: { status: "partial", failed_repo_ids: ["frontend"] },
    repo_deliveries: [{ repo_id: "backend", transaction_stage: "complete" }, { repo_id: "frontend", transaction_stage: "failed" }],
  } }]);
  assert.equal(transactions[0].partial, true);
  assert.equal(transactions[0].status, "partial");
});

test("recovery commands use revisioned canonical lifecycle operations", () => {
  const parent = { parent_run_id: "parent-a", revision: 4 };
  assert.deepEqual(integrationCommand("hold", parent), {
    command: "run integration",
    flags: { "parent-run-id": "parent-a", action: "hold", "command-id": "parent-a-hold-5", "expected-revision": 4 },
  });
  assert.deepEqual(integrationCommand("retry", parent, { execution_unit_id: "unit-a" }), {
    command: "run retry",
    flags: { "parent-run-id": "parent-a", "execution-unit-id": "unit-a", "command-id": "parent-a-retry-5", "expected-revision": 4 },
  });
});

test("orchestration mutations refresh durable state and release busy state", async () => {
  const events = [];
  await executeOrchestrationCommand({
    request: { command: "run integration", flags: { action: "verify" } },
    busy: false,
    runLifecycle: async (command, flags) => events.push([command, flags]),
    refresh: async (options) => events.push(["refresh", options]),
    setBusy: (value) => events.push(["busy", value]),
    setError: (value) => events.push(["error", value]),
  });
  assert.deepEqual(events, [
    ["busy", true], ["error", ""], ["run integration", { action: "verify" }],
    ["refresh", { silent: true }], ["busy", false],
  ]);
});

test("operator journey scenarios declare authoritative state, truthful actions, and recovery coverage", () => {
  const catalog = loadOperatorScenarioCatalog();
  const validation = validateOperatorScenarioCatalog(catalog);
  assert.equal(validation.ok, true, validation.errors.join("\n"));
  assert.deepEqual(catalog.scenarios.map((scenario) => scenario.id), [
    "clean-first-run", "mission-invalid", "mission-complete", "active-flow", "partial-mutation",
    "queued-human-work", "provider-progress", "verification-failure", "bounded-repair",
    "completed-read-only", "follow-up-flow", "partial-offline-reads",
  ]);
  assert.equal(catalog.scenarios.every((scenario) => scenario.authoritative_evidence.length > 0), true);
  assert.equal(catalog.scenarios.every((scenario) => scenario.success_signal && scenario.expected_recovery), true);
  assert.equal(catalog.external_network, false);
  assert.equal(catalog.upstream_writes, false);
});

test("installed acceptance fixtures cover every scenario and blocking environment", () => {
  const catalog = loadOperatorScenarioCatalog();
  const fixtures = loadOperatorAcceptanceFixtures();
  const validation = validateOperatorAcceptanceFixtures(fixtures, catalog);
  assert.equal(validation.ok, true, validation.errors.join("\n"));
  assert.deepEqual(fixtures.fixtures.map((fixture) => fixture.scenario_id), catalog.scenarios.map((scenario) => scenario.id));
  assert.equal(fixtures.package_mode, "installed-tarball");
  assert.equal(fixtures.viewports.length, 7);
  assert.deepEqual(fixtures.environment_modes, ["keyboard-only", "reduced-motion", "zoom-200"]);
  assert.ok(fixtures.safety_assertions.includes("legacy-default-preserved"));
});

test("golden lifecycle is ordered, canonical, no-write, and evidence complete", () => {
  const journey = loadGoldenLifecycle();
  const validation = validateGoldenLifecycle(journey);
  assert.equal(validation.ok, true, validation.errors.join("\n"));
  assert.equal(journey.transitions.length, 15);
  assert.equal(new Set(journey.transitions.map((transition) => transition.transition_id)).size, 15);
  assert.equal(journey.transitions.every((transition) => transition.authoritative_family && transition.evidence_family && transition.recovery), true);
  assert.deepEqual({ external_network: journey.external_network, target_source_writes: journey.target_source_writes, upstream_writes: journey.upstream_writes }, { external_network: false, target_source_writes: false, upstream_writes: false });
});

test("W65 cutover baseline maps every legacy outcome and required runtime state", () => {
  const baseline = loadCutoverParityBaseline();
  assert.equal(baseline.selector.precedence.join(" > "), "query > app-config > compiled-default");
  assert.equal(baseline.selector.current_default, "legacy");
  assert.equal(baseline.outcomes.every((row) => row.contract_owner && row.read_route && row.durable_readback), true);
  assert.deepEqual(new Set(baseline.outcomes.map((row) => row.disposition)), new Set(["preserved", "replaced"]));
  assert.deepEqual(new Set(baseline.states), new Set(["loading", "empty", "partial", "stale", "offline", "permission", "blocked", "error", "active", "completed"]));
});

test("W65 Mission and Cockpit pilot covers resumability, action truth, and presentation identity", () => {
  const pilot = JSON.parse(fs.readFileSync(new URL("../browser/fixtures/w65-mission-cockpit-pilot.json", import.meta.url), "utf8"));
  assert.equal(pilot.schema_version, 1);
  assert.deepEqual(new Set(pilot.action_categories), new Set(["mutation", "workbench", "evidence", "copy", "refresh", "unavailable"]));
  assert.equal(pilot.scenarios.every((scenario) => scenario.canonical_route && scenario.durable_readback && scenario.presentation_switch_identity), true);
  assert.ok(pilot.scenarios.some((scenario) => scenario.scenario_id === "partial-mission-next-retry" && scenario.exactly_once));
  assert.ok(pilot.scenarios.some((scenario) => scenario.scenario_id === "completed-follow-up" && scenario.source_flow_immutable));
  assert.deepEqual(pilot.safety, { external_network: false, target_source_writes: false, upstream_writes: false });
});

test("W65 specialist modes preserve durable truth and legacy workbench outcomes", () => {
  const pilot = JSON.parse(fs.readFileSync(new URL("../browser/fixtures/w65-specialist-modes-pilot.json", import.meta.url), "utf8"));
  assert.equal(pilot.schema_version, 1);
  assert.deepEqual(pilot.modes.map((mode) => mode.mode), ["attention", "journey", "evidence"]);
  assert.equal(pilot.modes.every((mode) => mode.authoritative_contracts.length > 0 && mode.outcomes.length > 0 && mode.aggregate_success_guard), true);
  assert.equal(pilot.legacy_outcomes.every((outcome) => outcome.quiet_mode && outcome.disposition), true);
  assert.equal(pilot.acceptance.browser_owned_completion, false);
  assert.equal(pilot.acceptance.browser_owned_evidence, false);
  assert.equal(pilot.acceptance.project_flow_isolation, true);
  assert.deepEqual(pilot.safety, { external_network: false, target_source_writes: false, upstream_writes: false });
});
