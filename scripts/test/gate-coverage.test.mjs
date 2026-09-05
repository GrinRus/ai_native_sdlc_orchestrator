import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = process.cwd();

test("gate coverage reports exact source, unit, browser, and generated ownership", () => {
  const run = spawnSync(process.execPath, [path.join(root, "scripts/gate-coverage.mjs")], { cwd: root, encoding: "utf8" });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  const report = JSON.parse(fs.readFileSync(path.join(root, ".aor/quality/gate-coverage.json"), "utf8"));
  assert.equal(report.status, "pass");
  assert.ok(report.source_files.length > 0);
  assert.ok(report.unit_tests.length > 0);
  assert.ok(report.browser_tests.length > 0);
  assert.ok(report.excluded_files.some((entry) => entry.file.startsWith("apps/web/dist/")));
});

test("coverage expiry is fail-closed", () => {
  const manifestPath = path.join(root, "scripts/test-manifest.json");
  const original = fs.readFileSync(manifestPath, "utf8");
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "aor-coverage-test-"));
  try {
    const manifest = JSON.parse(original);
    manifest.gate_coverage.exclusions[0].expires_at = "2000-01-01";
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const run = spawnSync(process.execPath, [path.join(root, "scripts/gate-coverage.mjs")], { cwd: root, encoding: "utf8" });
    assert.notEqual(run.status, 0);
    assert.match(`${run.stdout}\n${run.stderr}`, /expired/u);
  } finally {
    fs.writeFileSync(manifestPath, original);
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
