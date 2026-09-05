import assert from "node:assert/strict";
import test from "node:test";

import { classifyProcessResult, nonInteractiveEnvironment, runCheckedProcess } from "../process-runner.mjs";

test("process runner classifies spawn, signal, exit, and timeout failures", () => {
  assert.equal(classifyProcessResult({ error: { code: "ENOENT" } }, 10).failure_type, "spawn_error");
  assert.equal(classifyProcessResult({ status: null, signal: "SIGTERM" }, 10).failure_type, "signal");
  assert.equal(classifyProcessResult({ status: 7 }, 10).failure_type, "exit");
  assert.equal(classifyProcessResult({ error: { code: "ETIMEDOUT" } }, 10).failure_type, "timeout");
});

test("process runner suppresses interactive credential prompts", () => {
  const env = nonInteractiveEnvironment({ PATH: "fixture" });
  assert.equal(env.GIT_TERMINAL_PROMPT, "0");
  assert.equal(env.GCM_INTERACTIVE, "Never");
  assert.equal(env.NPM_CONFIG_YES, "true");
  assert.equal(env.PATH, "fixture");
});

test("process runner returns typed success evidence", () => {
  const result = runCheckedProcess({
    label: "fixture",
    command: "fixture",
    args: ["--ok"],
    runner: (_command, _args, options) => ({ status: 0, stdout: "ok\n", stderr: "", options }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.failure_type, null);
  assert.equal(result.stdout, "ok");
  assert.equal(result.command.join(" "), "fixture --ok");
});
