import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

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
