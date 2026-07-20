import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
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

test("production and private live-E2E runtime modules have no executable cross-boundary imports", () => {
  const tracked = execFileSync("git", ["ls-files", "packages/*/src/**/*.mjs", "apps/*/src/**/*.mjs", "scripts/live-e2e/lib/**/*.mjs"], {
    cwd: root,
    encoding: "utf8",
  }).trim().split("\n").filter(Boolean);
  for (const relativeFile of tracked) {
    const text = source(relativeFile);
    if (relativeFile.startsWith("scripts/live-e2e/lib/")) {
      const imports = [...text.matchAll(/(?:from\s+|import\s*\()\s*["']([^"']+)["']/gu)].map((match) => match[1]);
      for (const specifier of imports.filter((entry) => entry.startsWith("."))) {
        const resolved = path.resolve(root, path.dirname(relativeFile), specifier);
        assert.equal(resolved.startsWith(path.join(root, "packages")), false, `${relativeFile} imports ${specifier}`);
        assert.equal(resolved.startsWith(path.join(root, "apps")), false, `${relativeFile} imports ${specifier}`);
      }
    } else {
      assert.doesNotMatch(text, /scripts\/live-e2e/u, relativeFile);
    }
  }
  assert.doesNotMatch(source("scripts/live-e2e/lib/contracts/contract-kernel.mjs"), /packages\/|apps\//u);
});
