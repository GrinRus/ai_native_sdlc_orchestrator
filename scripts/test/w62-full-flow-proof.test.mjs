import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = path.resolve(new URL("../..", import.meta.url).pathname);

test("W62 component fixture preserves topology and stale boundaries without claiming installed delivery proof", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "aor-w62-proof-test-"));
  const output = path.join(directory, "proof.json");
  try {
    const result = spawnSync(process.execPath, [path.join(root, "scripts/w62-full-flow-proof.mjs"), "--output", output], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(fs.readFileSync(output, "utf8"));
    assert.equal(report.status, "pass");
    assert.equal(report.evidence_kind, "deterministic-component-fixture");
    assert.deepEqual(report.exercised_components, ["execution-dag", "stale-boundary"]);
    assert.deepEqual(report.scenarios.map((entry) => entry.topology), ["monorepo-components", "bounded-multirepo"]);
    for (const scenario of report.scenarios) {
      assert.ok(scenario.scheduler.parallel_approved_units.length >= 2);
      assert.ok(scenario.scheduler.serialized_units.length >= 2);
      assert.equal(scenario.recovery.attempts[0].task_id, scenario.recovery.attempts[1].task_id);
      assert.equal(scenario.recovery.attempts[0].execution_unit_id, scenario.recovery.attempts[1].execution_unit_id);
      assert.deepEqual(scenario.recovery.stale_units.map((entry) => entry.execution_unit_id), [scenario.execution_unit_ids.at(-1)]);
      assert.equal(scenario.recovery.stale_units[0].reason, "dependency-input-changed");
      assert.deepEqual(scenario.recovery.stale_units[0].source_units, [scenario.execution_unit_ids[0]]);
      assert.equal(Object.hasOwn(scenario, "delivery_projection"), false);
      assert.equal(Object.hasOwn(scenario, "delivery_manifest_ref"), false);
      assert.equal(Object.hasOwn(scenario, "integration_report_ref"), false);
      assert.equal(Object.hasOwn(scenario.execution_plan, "ref"), false);
      assert.equal(scenario.no_upstream_write, true);
    }
    assert.equal(report.browser_assessment.status, "not-run");
    assert.deepEqual(report.public_surface_parity, []);
    assert.equal(report.quality_assessment.status, "fixture-only");
    assert.ok(report.inspected_evidence_refs.length > 0);
    for (const reference of report.inspected_evidence_refs) assert.equal(fs.existsSync(path.join(root, reference)), true, reference);
    assert.equal(report.credentialed_provider_calls, false);
    assert.equal(report.upstream_writes, false);
    assert.doesNotMatch(JSON.stringify(report), /\/private\/|\/tmp\/|[A-Z]:\\/u);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
