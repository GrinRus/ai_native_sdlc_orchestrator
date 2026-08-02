import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function read(relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

function exportedFacadeLines(relative, name) {
  const source = read(relative);
  const start = source.search(new RegExp(`export\\s+function\\s+${name}\\s*\\(`, "u"));
  assert.notEqual(start, -1, `${name} must remain exported`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1).split("\n").length;
  }
  throw new Error(`Could not find end of ${name}`);
}

test("core application facades stay bounded and preserve stable exports", () => {
  const facades = [
    ["packages/orchestrator-core/src/step-execution-engine.mjs", "executeRoutedStep"],
    ["packages/orchestrator-core/src/review-run.mjs", "materializeReviewReport"],
    ["packages/orchestrator-core/src/operator-cli/command-handlers/operations.mjs", "handleOperationsCommand"],
  ];
  for (const [file, name] of facades) assert.ok(exportedFacadeLines(file, name) <= 100, `${name} exceeds 100 lines`);
});

test("transport adapters retain one-way application-service dependencies", () => {
  const lint = read("scripts/lint.mjs");
  assert.match(lint, /assertNoAppToAppSourceEdges/u);
  assert.match(lint, /assertCanonicalControlPlaneBoundary/u);
  const lifecycle = read("packages/orchestrator-core/src/control-plane/lifecycle-command.mjs");
  assert.doesNotMatch(lifecycle, /apps\/(?:api|cli|web)/u);
  const commandRuntime = read("packages/orchestrator-core/src/operator-cli/command-runtime.mjs");
  assert.doesNotMatch(commandRuntime, /command-handlers\//u);
});

test("characterized facades delegate without changing public result shapes", async () => {
  const engine = await import("../../packages/orchestrator-core/src/step-execution-engine.mjs");
  const review = await import("../../packages/orchestrator-core/src/review-run.mjs");
  const operations = await import("../../packages/orchestrator-core/src/operator-cli/command-handlers/operations.mjs");
  assert.equal(typeof engine.executeRoutedStep, "function");
  assert.equal(typeof review.materializeReviewReport, "function");
  assert.equal(operations.handleOperationsCommand({ command: "unknown", flags: {}, cwd: root, outputState: {} }), false);
});
