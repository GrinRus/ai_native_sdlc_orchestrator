import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = path.resolve(new URL("../..", import.meta.url).pathname);

test("W62 proof preserves topology, identity, bounded recovery, and coordinated delivery truth", () => {
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
    assert.deepEqual(report.scenarios.map((entry) => entry.topology), ["monorepo-components", "bounded-multirepo"]);
    for (const scenario of report.scenarios) {
      assert.ok(scenario.scheduler.parallel_approved_units.length >= 2);
      assert.ok(scenario.scheduler.serialized_units.length >= 2);
      assert.equal(scenario.recovery.attempts[0].task_id, scenario.recovery.attempts[1].task_id);
      assert.equal(scenario.recovery.attempts[0].execution_unit_id, scenario.recovery.attempts[1].execution_unit_id);
      assert.equal(scenario.delivery_projection.status, "complete");
      assert.equal(scenario.delivery_projection.integration_report_ref, scenario.integration_report_ref);
      assert.equal(scenario.no_upstream_write, true);
    }
    assert.equal(report.browser_assessment.status, "pass");
    assert.ok(report.inspected_evidence_refs.length > 0);
    assert.equal(report.credentialed_provider_calls, false);
    assert.equal(report.upstream_writes, false);
    assert.doesNotMatch(JSON.stringify(report), /\/private\/|\/tmp\/|[A-Z]:\\/u);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
