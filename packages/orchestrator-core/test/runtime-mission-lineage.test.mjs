import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { resolveRuntimeMissionProfile } from "../src/runtime-harness-report.mjs";

test("interleaved runs resolve independent intake lineage without mtime selection", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-mission-lineage-"));
  const projectRuntimeRoot = path.join(projectRoot, ".aor/projects/aor-core");
  const artifactsRoot = path.join(projectRuntimeRoot, "artifacts");
  const reportsRoot = path.join(projectRuntimeRoot, "reports");
  fs.mkdirSync(artifactsRoot, { recursive: true });
  fs.mkdirSync(reportsRoot, { recursive: true });
  try {
    const writeLineage = (runId, missionType) => {
      const bodyFile = path.join(artifactsRoot, `${runId}.body.json`);
      const packetFile = path.join(artifactsRoot, `${runId}.artifact.intake.json`);
      fs.writeFileSync(bodyFile, `${JSON.stringify({ feature_request: { request_document: { mission_type: missionType } } })}\n`);
      fs.writeFileSync(packetFile, `${JSON.stringify({ packet_type: "intake-request", body_ref: bodyFile })}\n`);
      fs.writeFileSync(path.join(reportsRoot, `step-${runId}.json`), `${JSON.stringify({ run_id: runId, evidence_refs: [packetFile] })}\n`);
    };
    writeLineage("run-docs", "docs-only");
    writeLineage("run-release", "release");
    const releasePacket = path.join(artifactsRoot, "run-release.artifact.intake.json");
    const old = new Date("2020-01-01T00:00:00.000Z");
    fs.utimesSync(releasePacket, old, old);
    const docs = resolveRuntimeMissionProfile(projectRoot, artifactsRoot, { runId: "run-docs" });
    const release = resolveRuntimeMissionProfile(projectRoot, artifactsRoot, { runId: "run-release" });
    assert.equal(docs.missionType, "docs-only");
    assert.equal(docs.lineage.status, "resolved");
    assert.equal(release.missionType, "release");
    assert.equal(release.lineage.status, "resolved");
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test("run without exact intake lineage remains unknown for strict gates", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-mission-lineage-missing-"));
  const artifactsRoot = path.join(projectRoot, ".aor/projects/aor-core/artifacts");
  fs.mkdirSync(artifactsRoot, { recursive: true });
  try {
    const profile = resolveRuntimeMissionProfile(projectRoot, artifactsRoot, { runId: "legacy-run" });
    assert.equal(profile.strictnessProfile, "unknown");
    assert.equal(profile.lineage.status, "unknown");
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});
