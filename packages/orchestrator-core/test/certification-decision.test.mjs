import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  certifyAssetPromotion,
  resolveCertificationDecisionStatus,
} from "../src/certification-decision.mjs";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const workspaceRoot = path.resolve(currentDir, "../../..");

/**
 * @param {(repoRoot: string) => void} callback
 */
function withTempRepo(callback) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-w3-s05-"));
  fs.mkdirSync(path.join(repoRoot, ".git"), { recursive: true });
  fs.cpSync(path.join(workspaceRoot, "examples"), path.join(repoRoot, "examples"), { recursive: true });

  try {
    callback(repoRoot);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
}

test("resolveCertificationDecisionStatus maps pass/hold/fail semantics deterministically", () => {
  assert.equal(
    resolveCertificationDecisionStatus({ evaluationStatus: "pass", replayStatus: "pass" }),
    "pass",
  );
  assert.equal(
    resolveCertificationDecisionStatus({ evaluationStatus: "pass", replayStatus: "incompatible" }),
    "hold",
  );
  assert.equal(
    resolveCertificationDecisionStatus({ evaluationStatus: "pass", replayStatus: "fail" }),
    "fail",
  );
  assert.equal(
    resolveCertificationDecisionStatus({ evaluationStatus: "fail", replayStatus: "pass" }),
    "fail",
  );
});

test("certifyAssetPromotion combines eval and harness evidence into durable promotion decision", () => {
  withTempRepo((repoRoot) => {
    const result = certifyAssetPromotion({
      cwd: repoRoot,
      projectRef: repoRoot,
      assetRef: "wrapper://wrapper.eval.default@v1",
      subjectRef: "wrapper://wrapper.eval.default@v1",
      suiteRef: "suite.cert.core@v4",
      stepClass: "implement",
      fromChannel: "candidate",
      toChannel: "stable",
    });

    assert.equal(fs.existsSync(result.decisionPath), true);
    assert.equal(result.decision.subject_ref, "wrapper://wrapper.eval.default@v1");
    assert.equal(result.decision.from_channel, "candidate");
    assert.equal(result.decision.to_channel, "stable");
    assert.equal(result.decision.status, "pass");
    assert.ok(Array.isArray(result.decision.evidence_refs));
    assert.ok(result.decision.evidence_refs.length >= 3);
    assert.equal(result.decision.evidence_summary.evaluation_status, "pass");
    assert.equal(result.decision.evidence_summary.harness_replay_status, "pass");
    assert.deepEqual(result.decision.evidence_summary.evidence_bar.required, [
      "evaluation-report",
      "harness-capture",
      "harness-replay",
    ]);
  });
});
