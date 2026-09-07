import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadContractFile } from "../../contracts/src/index.mjs";
import { withTempRepo as withTempRepoHelper } from "../../../scripts/test/helpers/temp-repo.mjs";
import { materializeMultirepoCoordinationStatus } from "../src/multirepo-coordination.mjs";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const workspaceRoot = path.resolve(currentDir, "../../..");

/**
 * @param {(repoRoot: string) => void} callback
 */
function withTempRepo(callback) {
  return withTempRepoHelper({ prefix: "aor-w20-s01-", workspaceRoot }, callback);
}

const profilePath = "examples/project.bounded-multirepo.aor.yaml";

test("multirepo coordination acquires scoped lock with passing cross-repo validation evidence", () => {
  withTempRepo((repoRoot) => {
    const result = materializeMultirepoCoordinationStatus({
      projectRef: repoRoot,
      cwd: repoRoot,
      projectProfile: profilePath,
      action: "acquire",
      runId: "w20-s01.lock.ready",
      ownerRef: "operator://delivery-lead",
      repoIds: ["backend", "mobile", "frontend"],
      pathGlobs: ["apps/api/**", "packages/contracts/**"],
      durationMinutes: 30,
      repoValidationRefs: [
        "backend=validation://repos/backend/profile-entry",
        "mobile=validation://repos/mobile/profile-entry",
        "frontend=validation://repos/frontend/profile-entry",
      ],
      integrationValidationRefs: ["validation://integration/backend-frontend/api-contract"],
      now: "2026-05-06T08:00:00.000Z",
    });

    assert.equal(result.blocking, false);
    assert.equal(result.report.status, "ready");
    assert.equal(result.report.lock_state.status, "active");
    assert.equal(result.report.cross_repo_validation.status, "pass");
    assert.ok(result.report.delivery_evidence.lock_evidence_refs.includes(result.statusRef));
    assert.ok(fs.existsSync(result.statusPath));

    const loaded = loadContractFile({
      filePath: result.statusPath,
      family: "multirepo-coordination-status",
    });
    assert.equal(loaded.ok, true);
  });
});

test("multirepo coordination blocks overlapping active locks with deterministic conflict details", () => {
  withTempRepo((repoRoot) => {
    materializeMultirepoCoordinationStatus({
      projectRef: repoRoot,
      cwd: repoRoot,
      projectProfile: profilePath,
      action: "acquire",
      runId: "w20-s01.lock.owner-a",
      ownerRef: "operator://owner-a",
      repoIds: ["backend"],
      pathGlobs: ["apps/api/**"],
      repoValidationRefs: ["backend=validation://repos/backend/profile-entry"],
      now: "2026-05-06T08:00:00.000Z",
    });

    const conflict = materializeMultirepoCoordinationStatus({
      projectRef: repoRoot,
      cwd: repoRoot,
      projectProfile: profilePath,
      action: "acquire",
      runId: "w20-s01.lock.owner-b",
      ownerRef: "operator://owner-b",
      repoIds: ["backend"],
      pathGlobs: ["apps/api/routes/**"],
      repoValidationRefs: ["backend=validation://repos/backend/profile-entry"],
      now: "2026-05-06T08:05:00.000Z",
    });

    assert.equal(conflict.report.status, "blocked");
    assert.equal(conflict.report.lock_state.status, "conflict");
    assert.deepEqual(conflict.report.blocking_reasons, ["lock-conflict"]);
    assert.equal(conflict.report.lock_state.conflicts[0].reason, "active-lock-overlaps-requested-scope");
  });
});

test("multirepo coordination uses segment-aware wildcard-middle overlap and rejects invalid scopes", () => {
  withTempRepo((repoRoot) => {
    materializeMultirepoCoordinationStatus({
      projectRef: repoRoot,
      cwd: repoRoot,
      projectProfile: profilePath,
      action: "acquire",
      runId: "w71-s09.lock.wildcard-a",
      ownerRef: "operator://wildcard-a",
      repoIds: ["backend"],
      pathGlobs: ["apps/**/api"],
      repoValidationRefs: ["backend=validation://repos/backend/profile-entry"],
      now: "2026-05-06T08:00:00.000Z",
    });
    const conflict = materializeMultirepoCoordinationStatus({
      projectRef: repoRoot,
      cwd: repoRoot,
      projectProfile: profilePath,
      action: "acquire",
      runId: "w71-s09.lock.wildcard-b",
      ownerRef: "operator://wildcard-b",
      repoIds: ["backend"],
      pathGlobs: ["apps/api/**"],
      repoValidationRefs: ["backend=validation://repos/backend/profile-entry"],
      now: "2026-05-06T08:01:00.000Z",
    });
    assert.equal(conflict.report.lock_state.status, "conflict");
    assert.ok(conflict.report.blocking_reasons.includes("lock-conflict"));

    const invalid = materializeMultirepoCoordinationStatus({
      projectRef: repoRoot,
      cwd: repoRoot,
      projectProfile: profilePath,
      action: "acquire",
      runId: "w71-s09.lock.invalid",
      ownerRef: "operator://invalid",
      repoIds: ["backend"],
      pathGlobs: ["apps/**api"],
      repoValidationRefs: ["backend=validation://repos/backend/profile-entry"],
      now: "2026-05-06T08:02:00.000Z",
    });
    assert.equal(invalid.report.status, "blocked");
    assert.ok(invalid.report.blocking_reasons.includes("lock-scope-invalid"));
  });
});

test("multirepo coordination quarantines corrupt lock state instead of treating it as empty", () => {
  withTempRepo((repoRoot) => {
    const first = materializeMultirepoCoordinationStatus({
      projectRef: repoRoot,
      cwd: repoRoot,
      projectProfile: profilePath,
      action: "acquire",
      runId: "w71-s09.lock.corrupt-seed",
      ownerRef: "operator://corrupt-seed",
      repoIds: ["backend"],
      pathGlobs: ["apps/api/**"],
      repoValidationRefs: ["backend=validation://repos/backend/profile-entry"],
      now: "2026-05-06T08:00:00.000Z",
    });
    fs.writeFileSync(first.lockStateFile, "{not-json\n", "utf8");
    assert.throws(
      () => materializeMultirepoCoordinationStatus({
        projectRef: repoRoot,
        cwd: repoRoot,
        projectProfile: profilePath,
        action: "acquire",
        runId: "w71-s09.lock.corrupt-retry",
        ownerRef: "operator://corrupt-retry",
        repoIds: ["backend"],
        pathGlobs: ["apps/api/**"],
        repoValidationRefs: ["backend=validation://repos/backend/profile-entry"],
        now: "2026-05-06T08:01:00.000Z",
      }),
      (error) => error.code === "state-corrupt" && typeof error.recovery_ref === "string",
    );
    assert.equal(fs.existsSync(first.lockStateFile), false);
    assert.equal(fs.existsSync(first.lockStateFile.replace(/\.json$/u, "")), false);
    assert.ok(fs.readdirSync(path.dirname(first.lockStateFile)).some((entry) => entry.startsWith("multirepo-locks.json.corrupt-")));
  });
});

test("multirepo lock acquisition has one winner under concurrent processes", async () => {
  await withTempRepo(async (repoRoot) => {
    const modulePath = new URL("../src/multirepo-coordination.mjs", import.meta.url).pathname;
    const workerSource = `import { materializeMultirepoCoordinationStatus } from ${JSON.stringify(modulePath)};
const input = JSON.parse(process.env.AOR_LOCK_CASE);
try {
  const result = materializeMultirepoCoordinationStatus(input);
  process.stdout.write(JSON.stringify({ status: result.report.status, lock: result.report.lock_state.status }));
} catch (error) {
  process.stdout.write(JSON.stringify({ error: error.code ?? error.message }));
  process.exitCode = 1;
}`;
    const base = {
      projectRef: repoRoot,
      cwd: repoRoot,
      projectProfile: profilePath,
      action: "acquire",
      repoIds: ["backend"],
      pathGlobs: ["apps/api/**"],
      repoValidationRefs: ["backend=validation://repos/backend/profile-entry"],
      now: "2026-05-06T08:00:00.000Z",
    };
    materializeMultirepoCoordinationStatus({ ...base, action: "inspect", runId: "w71-s09.lock.concurrent-bootstrap" });
    const runWorker = (runId, ownerRef) => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["--input-type=module", "-e", workerSource], {
        cwd: workspaceRoot,
        env: { ...process.env, AOR_LOCK_CASE: JSON.stringify({ ...base, runId, ownerRef }) },
      });
      let output = "";
      child.stdout.on("data", (chunk) => { output += chunk; });
      child.on("error", reject);
      child.on("close", (code) => {
        try { resolve({ code, result: JSON.parse(output) }); } catch (error) { reject(error); }
      });
    });
    const [first, second] = await Promise.all([
      runWorker("w71-s09.lock.concurrent-a", "operator://concurrent-a"),
      runWorker("w71-s09.lock.concurrent-b", "operator://concurrent-b"),
    ]);
    assert.deepEqual(new Set([first.result.status, second.result.status]), new Set(["ready", "blocked"]));
    assert.equal(first.code, 0);
    assert.equal(second.code, 0);
  });
});

test("multirepo coordination blocks stale overlapping locks until release", () => {
  withTempRepo((repoRoot) => {
    const staleSeed = materializeMultirepoCoordinationStatus({
      projectRef: repoRoot,
      cwd: repoRoot,
      projectProfile: profilePath,
      action: "acquire",
      runId: "w20-s01.lock.stale-seed",
      ownerRef: "operator://owner-a",
      repoIds: ["frontend"],
      pathGlobs: ["apps/web/**"],
      durationMinutes: 1,
      repoValidationRefs: ["frontend=validation://repos/frontend/profile-entry"],
      now: "2026-05-06T08:00:00.000Z",
    });

    const stale = materializeMultirepoCoordinationStatus({
      projectRef: repoRoot,
      cwd: repoRoot,
      projectProfile: profilePath,
      action: "acquire",
      runId: "w20-s01.lock.after-stale",
      ownerRef: "operator://owner-b",
      repoIds: ["frontend"],
      pathGlobs: ["apps/web/console/**"],
      repoValidationRefs: ["frontend=validation://repos/frontend/profile-entry"],
      now: "2026-05-06T08:03:00.000Z",
    });

    assert.equal(stale.report.status, "blocked");
    assert.equal(stale.report.lock_state.status, "stale");
    assert.deepEqual(stale.report.blocking_reasons, ["lock-stale"]);

    const released = materializeMultirepoCoordinationStatus({
      projectRef: repoRoot,
      cwd: repoRoot,
      projectProfile: profilePath,
      action: "release",
      runId: "w20-s01.lock.release-stale",
      ownerRef: "operator://owner-a",
      lockId: staleSeed.report.lock_state.lock_id,
      releaseEvidenceRefs: ["evidence://operator/released-stale-lock"],
      now: "2026-05-06T08:04:00.000Z",
    });

    assert.equal(released.report.status, "released");
    assert.equal(released.report.lock_state.status, "released");
    assert.ok(released.report.lock_state.release_evidence_refs.includes("evidence://operator/released-stale-lock"));
  });
});

test("multirepo coordination reports missing and failed repo validation checks", () => {
  withTempRepo((repoRoot) => {
    const partial = materializeMultirepoCoordinationStatus({
      projectRef: repoRoot,
      cwd: repoRoot,
      projectProfile: profilePath,
      action: "inspect",
      runId: "w20-s01.validation.partial",
      repoIds: ["backend", "mobile", "frontend"],
      repoValidationRefs: ["backend=validation://repos/backend/profile-entry"],
      failedRepoIds: ["frontend"],
      now: "2026-05-06T08:00:00.000Z",
    });

    assert.equal(partial.report.status, "blocked");
    assert.equal(partial.report.cross_repo_validation.status, "fail");
    assert.deepEqual(partial.report.cross_repo_validation.missing_repo_ids, ["mobile"]);
    assert.deepEqual(partial.report.cross_repo_validation.failed_repo_ids, ["frontend"]);
    assert.deepEqual(partial.report.blocking_reasons, [
      "cross-repo-validation-missing",
      "cross-repo-validation-failed",
    ]);
  });
});
