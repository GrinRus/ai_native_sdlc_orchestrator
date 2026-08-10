import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  computeDependencySnapshot,
  materializeDependencySnapshot,
  stabilizeDependencySetupCommand,
} from "../lib/dependency-snapshot.mjs";

function makeTarget() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aor-live-e2e-deps-"));
  fs.mkdirSync(path.join(root, "packages", "child"), { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), '{"name":"fixture","dependencies":{"playwright":"^1.58.2"}}\n');
  fs.writeFileSync(path.join(root, ".npmrc"), "package-lock=false\n");
  fs.writeFileSync(path.join(root, "packages", "child", "package.json"), '{"name":"child"}\n');
  return root;
}

test("dependency snapshot hash is stable across run ids and sensitive to manifest inputs", () => {
  const target = makeTarget();
  const base = {
    targetCheckoutRoot: target,
    targetRepoId: "ky",
    targetRepoRef: "main",
    targetCommitSha: "a".repeat(40),
    setupCommands: ["npm install --prefer-online --no-audit --no-fund"],
    verificationCommands: ["npm test"],
  };
  const first = computeDependencySnapshot(base);
  const second = computeDependencySnapshot({ ...base });
  assert.equal(first.hash, second.hash);
  fs.appendFileSync(path.join(target, "package.json"), "\n");
  const changed = computeDependencySnapshot(base);
  assert.notEqual(first.hash, changed.hash);
});

test("materialized dependency cache uses the same namespace for repeated runs", () => {
  const target = makeTarget();
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-live-e2e-runtime-"));
  const reportsRoot = path.join(runtimeRoot, "reports");
  const options = {
    targetCheckoutRoot: target,
    targetRepoId: "ky",
    targetRepoRef: "main",
    targetCommitSha: "b".repeat(40),
    setupCommands: ["npm install --prefer-online --no-audit --no-fund"],
    verificationCommands: ["npm test"],
    runtimeRoot,
    reportsRoot,
  };
  const first = materializeDependencySnapshot({ ...options, runId: "first" });
  const second = materializeDependencySnapshot({ ...options, runId: "second" });
  assert.equal(first.hash, second.hash);
  assert.equal(first.cacheRoot, second.cacheRoot);
  assert.equal(first.report.cache_reused, false);
  assert.equal(second.report.cache_reused, true);
  assert.equal(second.environment.npm_config_cache, second.cacheRoot);
});

test("offline npm installs are promoted to online resolution for fresh snapshot materialization", () => {
  assert.equal(
    stabilizeDependencySetupCommand("CI=1 npm install --prefer-offline --no-audit --no-fund"),
    "CI=1 npm install --prefer-online --no-audit --no-fund",
  );
  assert.equal(stabilizeDependencySetupCommand("pnpm install --frozen-lockfile"), "pnpm install --frozen-lockfile");
});
