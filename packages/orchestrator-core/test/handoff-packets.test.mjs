import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  approveHandoffArtifacts,
  prepareHandoffArtifacts,
  validateApprovedHandoffGate,
} from "../src/handoff-packets.mjs";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const workspaceRoot = path.resolve(currentDir, "../../..");

/**
 * @param {(repoRoot: string) => void} callback
 */
function withTempRepo(callback) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-w1-s07-"));
  fs.mkdirSync(path.join(repoRoot, ".git"), { recursive: true });
  fs.cpSync(path.join(workspaceRoot, "examples"), path.join(repoRoot, "examples"), { recursive: true });

  try {
    callback(repoRoot);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
}

test("prepareHandoffArtifacts materializes wave-ticket and pending handoff packet", () => {
  withTempRepo((repoRoot) => {
    const result = prepareHandoffArtifacts({ projectRef: repoRoot, cwd: repoRoot });
    assert.equal(result.waveTicket.project_id, "aor-core");
    assert.equal(result.handoffPacket.project_id, "aor-core");
    assert.equal(result.handoffPacket.status, "pending-approval");
    assert.equal(result.handoffPacket.approval_state.state, "pending");
    assert.equal(typeof result.handoffPacket.writeback_mode, "string");
    assert.equal(typeof result.handoffPacket.scope_constraints, "object");
    assert.equal(fs.existsSync(result.waveTicketFile), true);
    assert.equal(fs.existsSync(result.handoffPacketFile), true);
  });
});

test("approveHandoffArtifacts marks handoff packet as approved and gate passes", () => {
  withTempRepo((repoRoot) => {
    const prepared = prepareHandoffArtifacts({ projectRef: repoRoot, cwd: repoRoot });
    const approved = approveHandoffArtifacts({
      projectRef: repoRoot,
      cwd: repoRoot,
      handoffPacketPath: prepared.handoffPacketFile,
      approvalRef: "approval://APP-2048",
      approvedAt: "2026-01-01T00:00:00.000Z",
    });

    assert.equal(approved.handoffPacket.status, "approved");
    assert.equal(approved.handoffPacket.approval_state.state, "approved");
    assert.ok(approved.handoffPacket.approval_state.approval_refs.includes("approval://APP-2048"));

    const gate = validateApprovedHandoffGate({
      runtimeLayout: approved.runtimeLayout,
      projectId: approved.projectId,
      handoffPacketPath: prepared.handoffPacketFile,
    });
    assert.equal(gate.status, "pass");
    assert.equal(gate.blocking, false);
  });
});

test("validateApprovedHandoffGate fails when handoff packet is missing", () => {
  withTempRepo((repoRoot) => {
    const prepared = prepareHandoffArtifacts({ projectRef: repoRoot, cwd: repoRoot });
    fs.rmSync(prepared.handoffPacketFile, { force: true });

    const gate = validateApprovedHandoffGate({
      runtimeLayout: prepared.runtimeLayout,
      projectId: prepared.projectId,
    });
    assert.equal(gate.status, "fail");
    assert.equal(gate.blocking, true);
    assert.equal(gate.details.reason, "handoff-missing");
  });
});
