import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  materializeBrowserEvidenceIndex,
  validateInstalledBrowserProof,
} from "../lib/installed-browser-proof.mjs";

const RUN_ID = "run-installed-browser-proof";
const SCENARIO_ID = "installed-console-matrix";

function fixture() {
  const reportsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-browser-proof-"));
  const createdAt = "2026-07-26T10:00:00.000Z";
  const artifacts = [
    "installed-app-smoke",
    "installed-scenario-report",
    "browser-task-proof",
    "dom-snapshot",
    "accessibility-summary",
    "finding-ledger",
  ].map((kind) => {
    const file = path.join(reportsRoot, `${kind}.json`);
    fs.writeFileSync(file, `${JSON.stringify({ kind, run_id: RUN_ID })}\n`);
    return { kind, file };
  });
  const indexed = materializeBrowserEvidenceIndex({
    reportsRoot,
    runId: RUN_ID,
    scenarioId: SCENARIO_ID,
    createdAt,
    artifacts,
  });
  const passEntries = (ids, extra = {}) => ids.map((id) => ({ id, status: "pass", ...extra }));
  const proof = {
    schema_version: 2,
    kind: "installed-browser-proof",
    run_id: RUN_ID,
    scenario_id: SCENARIO_ID,
    scenarios: [{ id: "completed-read-only", status: "pass", observed_state: "completed", expected_state: "completed", durable_precondition_ref: "evidence://state.json" }],
    actions: [{
      id: "create-no-write-request",
      status: "pass",
      visible_label: "Ask AOR",
      canonical_mutation: { method: "POST", route: "/api/projects/aor-core/operator-requests" },
      response_id: "request-1",
      evidence_refs: ["evidence://request-1.json"],
      reload_verified: true,
      durable_readback: { status: "pass", ref: "evidence://request-1.json" },
    }],
    viewport_matrix: passEntries(["desktop", "tablet", "mobile", "zoom-200"]),
    accessibility_matrix: passEntries(["keyboard-only", "dialog-focus", "focus-restoration", "semantic-tree", "contrast-aa", "touch-targets", "reduced-motion"]),
    recovery_matrix: passEntries(["reload", "reconnect", "partial-read", "offline-read", "injected-error", "multi-item-attention", "project-switch", "terminal-read-only"]).map((entry) => entry.id === "injected-error" ? { ...entry, injected: true } : entry),
    findings: [],
    console_errors: [],
    external_requests: [],
  };
  const request = { run_id: RUN_ID, scenario_id: SCENARIO_ID, created_at: createdAt };
  return { reportsRoot, indexed, proof, request };
}

test("installed browser proof accepts immutable, ready, action-backed matrix evidence", () => {
  const fx = fixture();
  const result = validateInstalledBrowserProof({
    proof: fx.proof,
    request: fx.request,
    index: fx.indexed.index,
    reportsRoot: fx.reportsRoot,
    runId: RUN_ID,
    scenarioId: SCENARIO_ID,
    now: Date.parse("2026-07-26T10:05:00.000Z"),
  });
  assert.deepEqual(result, { ok: true, issues: [] });
  assert.equal(fx.indexed.index.artifacts.every((entry) => !path.isAbsolute(entry.object_ref)), true);
});

test("installed browser proof rejects wrong-kind, stale, overwritten, and cross-run evidence", () => {
  for (const mutate of [
    (fx) => { fx.indexed.index.kind = "app-smoke"; },
    (fx) => { fx.indexed.index.created_at = "2026-07-25T10:00:00.000Z"; },
    (fx) => { fs.writeFileSync(path.join(fx.reportsRoot, fx.indexed.index.artifacts[0].object_ref), "overwritten\n"); },
    (fx) => { fx.indexed.index.artifacts[0].run_id = "another-run"; },
  ]) {
    const fx = fixture();
    mutate(fx);
    const result = validateInstalledBrowserProof({
      proof: fx.proof,
      request: fx.request,
      index: fx.indexed.index,
      reportsRoot: fx.reportsRoot,
      runId: RUN_ID,
      scenarioId: SCENARIO_ID,
      now: Date.parse("2026-07-26T10:05:00.000Z"),
    });
    assert.equal(result.ok, false);
  }
});

test("installed browser proof distinguishes loading, partial, offline, timeout, and ready outcomes", () => {
  for (const observedState of ["loading", "partial", "offline"]) {
    const fx = fixture();
    fx.proof.scenarios[0].observed_state = observedState;
    assert.equal(validateInstalledBrowserProof({
      proof: fx.proof,
      request: fx.request,
      index: fx.indexed.index,
      reportsRoot: fx.reportsRoot,
      runId: RUN_ID,
      scenarioId: SCENARIO_ID,
      now: Date.parse("2026-07-26T10:05:00.000Z"),
    }).ok, false);
  }
  const timeout = fixture();
  timeout.proof.scenarios[0] = { id: "timeout", status: "not_pass", observed_state: "timeout" };
  assert.equal(validateInstalledBrowserProof({
    proof: timeout.proof,
    request: timeout.request,
    index: timeout.indexed.index,
    reportsRoot: timeout.reportsRoot,
    runId: RUN_ID,
    scenarioId: SCENARIO_ID,
    now: Date.parse("2026-07-26T10:05:00.000Z"),
  }).ok, false);
});

test("installed browser proof blocks missing readback, matrix gaps, assumed errors, and unresolved P1", () => {
  const mutations = [
    (proof) => { proof.actions[0].durable_readback = null; },
    (proof) => { proof.viewport_matrix = proof.viewport_matrix.filter((entry) => entry.id !== "mobile"); },
    (proof) => { proof.recovery_matrix.find((entry) => entry.id === "injected-error").injected = false; },
    (proof) => { proof.findings.push({ priority: "P1", status: "open" }); },
  ];
  for (const mutate of mutations) {
    const fx = fixture();
    mutate(fx.proof);
    assert.equal(validateInstalledBrowserProof({
      proof: fx.proof,
      request: fx.request,
      index: fx.indexed.index,
      reportsRoot: fx.reportsRoot,
      runId: RUN_ID,
      scenarioId: SCENARIO_ID,
      now: Date.parse("2026-07-26T10:05:00.000Z"),
    }).ok, false);
  }
});
