import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { collectDebtMetrics, validateQualityExceptions } from "../quality-ratchet-lib.mjs";
import { validateCriticalPathManifest } from "../critical-path-coverage-lib.mjs";

const root = process.cwd();

function runScript(script) {
  return spawnSync(process.execPath, [path.join(root, script)], {
    cwd: root,
    encoding: "utf8",
  });
}

test("canonical slice gate delegates to check without repeating root stages", () => {
  const source = fs.readFileSync(path.join(root, "scripts/slice-cycle.mjs"), "utf8");
  const runGate = source.slice(source.indexOf("function runGate()"), source.indexOf("function executeTransition"));
  assert.match(runGate, /runPnpmScript\("check"\)/u);
  assert.doesNotMatch(runGate, /\["lint", "test", "build", "check"\]/u);
});

test("typecheck, quality, and dependency ratchets pass the committed baseline", () => {
  for (const script of [
    "scripts/typecheck-ratchet.mjs",
    "scripts/quality-ratchet.mjs",
    "scripts/dependency-policy.mjs",
  ]) {
    const result = runScript(script);
    assert.equal(result.status, 0, `${script}\n${result.stdout}\n${result.stderr}`);
  }
});

test("reference integrity reuses one loaded example graph within its performance budget", () => {
  const source = fs.readFileSync(path.join(root, "scripts/reference-integrity.mjs"), "utf8");
  assert.match(source, /validateExampleReferences\(\{ workspaceRoot, loadedExamples \}\)/u);
  const started = Date.now();
  const result = runScript("scripts/reference-integrity.mjs");
  assert.equal(result.status, 0, result.stderr);
  assert.ok(Date.now() - started < 5_000, "reference integrity exceeded the 5 second bounded fixture");
});

test("structural debt fixtures fail closed when complexity, clones, or dead-code markers increase", () => {
  const baseline = collectDebtMetrics({ "fixture.mjs": "export function stable() {\n  return true;\n}\n" });
  const mutated = collectDebtMetrics({
    "fixture.mjs": "export function stable(value) {\n  const readyValue = value && value.ready;\n  const safeValue = readyValue && Boolean(value);\n  const checkedValue = safeValue && value.ready === true;\n  const auditValue = checkedValue && value.ready === true;\n  if (auditValue) {\n    return Boolean(value.ready);\n  }\n  return false;\n}\n",
    "copy.mjs": "export function stable(value) {\n  const readyValue = value && value.ready;\n  const safeValue = readyValue && Boolean(value);\n  const checkedValue = safeValue && value.ready === true;\n  const auditValue = checkedValue && value.ready === true;\n  if (auditValue) {\n    return Boolean(value.ready);\n  }\n  return false;\n}\n",
    "dead.mjs": "// @aor-dead-code candidate\nexport const unused = 1;\n",
    "nested.mjs": "export function nested(value) {\n  if (value) {\n    if (value.ready) {\n      if (value.safe) {\n        return true;\n      }\n    }\n  }\n  return false;\n}\n",
  });
  assert.ok(mutated.total_lines > baseline.total_lines);
  assert.ok(mutated.complexity_units > baseline.complexity_units);
  assert.ok(mutated.max_function_lines > baseline.max_function_lines);
  assert.ok(mutated.max_nesting > baseline.max_nesting);
  assert.ok(mutated.clone_windows > baseline.clone_windows);
  assert.ok(mutated.dead_code_candidates > baseline.dead_code_candidates);
});

test("quality exceptions require ownership, expiry, ceiling, and successor slice", () => {
  const findings = validateQualityExceptions([{ id: "expired", path: "fixture.mjs", category: "file-lines", owner: "", rationale: "", expires_at: "2000-01-01", ceiling: -1, successor_slice: "" }], {
    sourceFiles: ["fixture.mjs"],
  });
  assert.match(findings.join("\n"), /missing owner/u);
  assert.match(findings.join("\n"), /expired/u);
  assert.match(findings.join("\n"), /ceiling/u);
  assert.match(findings.join("\n"), /successor_slice/u);
});

test("critical-path coverage fixture fails when a negative branch marker is removed", () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-critical-path-"));
  fs.writeFileSync(path.join(fixtureRoot, "fixture.mjs"), "export function fixture() { return true; }\n");
  fs.writeFileSync(path.join(fixtureRoot, "fixture.test.mjs"), "test(\"accepts\", () => {});\n");
  const manifest = {
    schema_version: 1,
    paths: [{ id: "fixture", source: "fixture.mjs", test: "fixture.test.mjs", positive_marker: "accepts", negative_marker: "rejects" }],
  };
  try {
    const findings = validateCriticalPathManifest(manifest, fixtureRoot);
    assert.ok(findings.some((finding) => finding.includes("negative evidence marker")));
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
