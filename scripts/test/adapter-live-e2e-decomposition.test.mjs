import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../..");

function source(relativeFile) {
  return fs.readFileSync(path.join(root, relativeFile), "utf8");
}

test("adapter and live-E2E public orchestrators stay bounded", () => {
  const adapter = source("packages/adapter-sdk/src/index.mjs");
  const flows = source("scripts/live-e2e/lib/flows.mjs");
  const profile = source("scripts/live-e2e/run-profile.mjs");
  assert.match(adapter, /execute\(request\) \{ return executeLiveAdapterRequest\(request\); \}/);
  assert.match(flows, /export function executeFullJourneyFlow\(options\) \{ return executeFullJourneyFlowImplementation\(options\); \}/);
  assert.match(profile, /export function writeProofRunnerArtifacts\(options\) \{ return writeProofRunnerArtifactsImplementation\(options\); \}/);
});

test("provider-neutral adapter boundaries remain focused and package-owned", () => {
  for (const relativeFile of [
    "packages/adapter-sdk/src/supervisor.mjs",
    "packages/adapter-sdk/src/packet-transport.mjs",
    "packages/adapter-sdk/src/evidence-normalization.mjs",
    "packages/adapter-sdk/src/permission-policy.mjs",
  ]) {
    const text = source(relativeFile);
    assert.ok(text.split(/\r?\n/u).length <= 1000, `${relativeFile} must stay below the production file ceiling`);
    assert.doesNotMatch(text, /scripts\/live-e2e|live-e2e-/u);
  }
});

test("private proof contracts consume the public kernel without production reverse imports", () => {
  assert.match(
    source("scripts/live-e2e/lib/contracts/contract-kernel.mjs"),
    /packages\/contracts\/src\/families\.mjs/u,
  );
  for (const relativeFile of [
    "packages/adapter-sdk/src/index.mjs",
    "packages/contracts/src/index.mjs",
    "packages/orchestrator-core/src/step-execution-engine.mjs",
  ]) {
    assert.doesNotMatch(source(relativeFile), /scripts\/live-e2e/u);
  }
});
