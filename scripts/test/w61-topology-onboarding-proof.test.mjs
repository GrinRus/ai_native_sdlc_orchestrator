import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = path.resolve(new URL("../..", import.meta.url).pathname);

test("W61 public topology onboarding proof covers three isolated topologies without runtime or secrets", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "aor-w61-proof-test-"));
  const output = path.join(directory, "proof.json");
  try {
    const result = spawnSync(process.execPath, [path.join(root, "scripts/w61-topology-onboarding-proof.mjs"), "--output", output], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(fs.readFileSync(output, "utf8"));
    assert.equal(report.status, "pass");
    assert.deepEqual(report.scenarios.map((entry) => entry.id), ["single-repo", "monorepo", "bounded-multirepo"]);
    assert.equal(report.scenarios.every((entry) => entry.runtime_materialized === false), true);
    assert.equal(report.scenarios.every((entry) => ["pass", "warn"].includes(entry.validation_status)), true);
    assert.equal(report.scenarios.some((entry) => entry.id === "bounded-multirepo" && entry.validation_status === "warn"), true);
    assert.equal(report.project_isolation.project_count, 3);
    assert.equal(report.credentialed_provider_calls, false);
    assert.equal(report.upstream_writes, false);
    assert.equal(report.committed_machine_paths, false);
    assert.doesNotMatch(JSON.stringify(report), /\/private\/|\/tmp\/|[A-Z]:\\/u);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
