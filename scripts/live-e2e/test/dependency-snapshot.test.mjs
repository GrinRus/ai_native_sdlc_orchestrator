import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  computeDependencySnapshot,
  materializeDependencySnapshot,
  resolveNpmDependencyCutoff,
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

test("unpinned npm installs use a target-commit cutoff while lockfile installs stay unchanged", () => {
  const target = makeTarget();
  const targetCommitDate = "2026-07-07T00:20:39+02:00";
  const cutoff = resolveNpmDependencyCutoff(targetCommitDate);
  assert.equal(cutoff, "2026-07-07T22:20:39.000Z");
  assert.equal(
    stabilizeDependencySetupCommand("CI=1 npm install --prefer-online --no-audit --no-fund", {
      targetCheckoutRoot: target,
      targetCommitDate,
    }),
    `CI=1 npm install --before=${cutoff} --prefer-online --no-audit --no-fund`,
  );
  assert.equal(
    stabilizeDependencySetupCommand(`npm install --before=${cutoff} --no-audit`, {
      targetCheckoutRoot: target,
      targetCommitDate,
    }),
    `npm install --before=${cutoff} --no-audit`,
  );
  fs.writeFileSync(path.join(target, "package-lock.json"), "{}\n");
  assert.equal(
    stabilizeDependencySetupCommand("npm install --prefer-online --no-audit --no-fund", {
      targetCheckoutRoot: target,
      targetCommitDate,
    }),
    "npm install --prefer-online --no-audit --no-fund",
  );
  const policy = computeDependencySnapshot({
    targetCheckoutRoot: target,
    targetRepoId: "ky",
    targetRepoRef: "main",
    targetCommitSha: "d".repeat(40),
    targetCommitDate,
  }).payload.dependency_resolution;
  assert.equal(policy.strategy, "lockfile");
});

test("dependency snapshot records the target-commit resolution policy", () => {
  const target = makeTarget();
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-live-e2e-runtime-"));
  const reportsRoot = path.join(runtimeRoot, "reports");
  const targetCommitDate = "2026-07-07T00:20:39+02:00";
  const snapshot = materializeDependencySnapshot({
    targetCheckoutRoot: target,
    targetRepoId: "ky",
    targetRepoRef: "main",
    targetCommitSha: "c".repeat(40),
    targetCommitDate,
    setupCommands: ["npm install --before=2026-07-07T22:20:39.000Z"],
    verificationCommands: ["npx xo"],
    runtimeRoot,
    reportsRoot,
    runId: "target-commit-policy",
  });
  assert.equal(snapshot.report.target_commit_date, targetCommitDate);
  assert.deepEqual(snapshot.report.dependency_resolution, {
    strategy: "npm-before-target-commit",
    target_commit_date: targetCommitDate,
    npm_cutoff: "2026-07-07T22:20:39.000Z",
    lockfile_present: false,
  });
});
