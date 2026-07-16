import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  captureHarnessReplayArtifact,
  replayHarnessCapture,
} from "../src/harness-capture-replay.mjs";
import { initializeProjectRuntime } from "../src/project-init.mjs";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const workspaceRoot = path.resolve(currentDir, "../../..");

/**
 * @param {(repoRoot: string) => void} callback
 */
function withTempRepo(callback) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-w3-s04-"));
  fs.mkdirSync(path.join(repoRoot, ".git"), { recursive: true });
  fs.cpSync(path.join(workspaceRoot, "examples"), path.join(repoRoot, "examples"), { recursive: true });

  try {
    callback(repoRoot);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
}

function writeRunSubject(repoRoot, runId, status = "pass") {
  const init = initializeProjectRuntime({ cwd: repoRoot, projectRef: repoRoot });
  const filePath = path.join(init.runtimeLayout.reportsRoot, `run-subject-${runId}.json`);
  fs.writeFileSync(filePath, `${JSON.stringify({ run_id: runId, status })}\n`, "utf8");
  return filePath;
}

test("captureHarnessReplayArtifact writes reusable harness capture with routed trace evidence", () => {
  withTempRepo((repoRoot) => {
    writeRunSubject(repoRoot, "harness-candidate");
    const capture = captureHarnessReplayArtifact({
      cwd: repoRoot,
      projectRef: repoRoot,
      stepClass: "implement",
      suiteRef: "suite.release.core@v1",
      subjectRef: "run://harness-candidate",
    });

    assert.equal(fs.existsSync(capture.capturePath), true);
    assert.equal(capture.capture.capture_kind, "harness-step-execution");
    assert.equal(capture.capture.schema_version, 2);
    assert.equal(capture.capture.compatibility.route_id, "route.implement.default");
    assert.equal(typeof capture.capture.trace.step_input, "object");
    assert.equal(typeof capture.capture.trace.selected_assets, "object");
    assert.equal(typeof capture.capture.trace.normalized_output, "object");
    assert.equal(typeof capture.capture.scoring_snapshot.summary_metrics, "object");
  });
});

test("replayHarnessCapture replays through eval scoring path and produces comparable output", () => {
  withTempRepo((repoRoot) => {
    writeRunSubject(repoRoot, "harness-candidate");
    const capture = captureHarnessReplayArtifact({
      cwd: repoRoot,
      projectRef: repoRoot,
      stepClass: "implement",
      suiteRef: "suite.release.core@v1",
      subjectRef: "run://harness-candidate",
    });

    const replay = replayHarnessCapture({
      cwd: repoRoot,
      projectRef: repoRoot,
      capturePath: capture.capturePath,
    });

    assert.equal(fs.existsSync(replay.replayReportPath), true);
    assert.equal(replay.replayReport.status, "pass");
    assert.equal(replay.replayReport.compatibility.compatible, true);
    assert.equal(replay.replayReport.replay_snapshot.comparable, true);
    assert.equal(typeof replay.replayEvaluationReportPath, "string");
    assert.equal(fs.existsSync(replay.replayEvaluationReportPath), true);
  });
});

test("replayHarnessCapture rejects incompatible captures explicitly", () => {
  withTempRepo((repoRoot) => {
    writeRunSubject(repoRoot, "harness-candidate");
    const capture = captureHarnessReplayArtifact({
      cwd: repoRoot,
      projectRef: repoRoot,
      stepClass: "implement",
      suiteRef: "suite.release.core@v1",
      subjectRef: "run://harness-candidate",
    });

    const captureBody = JSON.parse(fs.readFileSync(capture.capturePath, "utf8"));
    captureBody.compatibility.adapter_id = "adapter-that-does-not-match";
    fs.writeFileSync(capture.capturePath, `${JSON.stringify(captureBody, null, 2)}\n`, "utf8");

    const replay = replayHarnessCapture({
      cwd: repoRoot,
      projectRef: repoRoot,
      capturePath: capture.capturePath,
    });

    assert.equal(replay.replayReport.status, "incompatible");
    assert.equal(replay.replayReport.compatibility.compatible, false);
    assert.ok(replay.replayReport.compatibility.mismatches.some((entry) => entry.field === "adapter_id"));
    assert.match(replay.replayReport.blocked_next_step, /Refresh harness capture/);
  });
});

test("replayHarnessCapture rejects same-id changed subject content", () => {
  withTempRepo((repoRoot) => {
    const subjectFile = writeRunSubject(repoRoot, "harness-candidate");
    const capture = captureHarnessReplayArtifact({ cwd: repoRoot, projectRef: repoRoot, stepClass: "implement", suiteRef: "suite.release.core@v1", subjectRef: "run://harness-candidate" });
    fs.writeFileSync(subjectFile, `${JSON.stringify({ run_id: "harness-candidate", status: "changed" })}\n`, "utf8");
    const replay = replayHarnessCapture({ cwd: repoRoot, projectRef: repoRoot, capturePath: capture.capturePath });
    assert.equal(replay.replayReport.status, "incompatible");
    assert.ok(replay.replayReport.compatibility.mismatches.some((entry) => entry.field === "subject_digest"));
  });
});
