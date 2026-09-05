import assert from "node:assert/strict";
import test from "node:test";

import { signalProcessGroup } from "../src/run-job.mjs";

test("run-job cancellation signals a detached process group with a safe fallback", () => {
  const calls = [];
  const result = signalProcessGroup(4321, "SIGTERM", (pid, signal) => {
    calls.push([pid, signal]);
  });
  assert.equal(result, true);
  assert.deepEqual(calls, [[-4321, "SIGTERM"]]);
});

test("run-job supervision ignores invalid or self process identifiers", () => {
  const calls = [];
  assert.equal(signalProcessGroup(0, "SIGTERM", (...args) => calls.push(args)), false);
  assert.equal(signalProcessGroup(-1, "SIGTERM", (...args) => calls.push(args)), false);
  assert.equal(signalProcessGroup(process.pid, "SIGTERM", (...args) => calls.push(args)), false);
  assert.deepEqual(calls, []);
});
