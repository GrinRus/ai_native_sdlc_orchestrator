import assert from "node:assert/strict";
import test from "node:test";

import {
  buildChangedFileExecutionPlan,
  runCheckedCommand,
} from "../bootstrap-remediation-gate.mjs";

const manifest = {
  file_classes: [
    { class_id: "test-source", path_prefixes: ["scripts/"], suffixes: [".test.mjs"], required_checks: ["lint", "typecheck", "test"] },
    { class_id: "runtime-source", path_prefixes: ["scripts/"], extensions: [".mjs"], exclude_suffixes: [".test.mjs"], required_checks: ["lint", "typecheck"] },
  ],
  ignored_path_prefixes: ["apps/web/dist/"],
};

test("changed source and test files receive explicit focused checks", () => {
  const plan = buildChangedFileExecutionPlan({
    changedFiles: ["scripts/bootstrap-remediation-gate.mjs", "scripts/test/bootstrap-remediation-gate.test.mjs", "README.md"],
    manifest,
  });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.executable_files, ["scripts/bootstrap-remediation-gate.mjs", "scripts/test/bootstrap-remediation-gate.test.mjs"]);
  assert.deepEqual(plan.checks.map((check) => check.check_id), ["lint", "test", "typecheck"]);
  assert.equal(plan.files.find((entry) => entry.file.endsWith(".test.mjs"))?.required_checks.includes("test"), true);
});

test("an unaccounted changed source file fails closed", () => {
  const plan = buildChangedFileExecutionPlan({ changedFiles: ["docs/untracked-source.mjs"], manifest });
  assert.equal(plan.ok, false);
  assert.match(plan.errors.join("\n"), /not covered/u);
});

test("ignored generated output is not treated as a source gap", () => {
  const plan = buildChangedFileExecutionPlan({ changedFiles: ["apps/web/dist/assets/index.js"], manifest });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.executable_files, []);
});

test("spawn errors are authoritative failures", () => {
  const result = runCheckedCommand({
    label: "missing binary",
    command: "missing",
    runner: () => ({ error: Object.assign(new Error("ENOENT"), { code: "ENOENT" }), status: null }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.failure_type, "spawn_error");
});

test("silent non-zero exits are authoritative failures", () => {
  const result = runCheckedCommand({ label: "silent failure", command: "fake", runner: () => ({ status: 7, stdout: "", stderr: "" }) });
  assert.equal(result.ok, false);
  assert.equal(result.failure_type, "exit");
});

test("signals are authoritative failures", () => {
  const result = runCheckedCommand({ label: "signaled", command: "fake", runner: () => ({ status: null, signal: "SIGTERM" }) });
  assert.equal(result.ok, false);
  assert.equal(result.failure_type, "signal");
});

test("timeouts are authoritative failures", () => {
  const result = runCheckedCommand({
    label: "timed out",
    command: "fake",
    timeoutMs: 25,
    runner: () => ({ status: null, signal: "SIGKILL", error: Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }) }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.failure_type, "timeout");
  assert.match(result.message, /25ms/u);
});
