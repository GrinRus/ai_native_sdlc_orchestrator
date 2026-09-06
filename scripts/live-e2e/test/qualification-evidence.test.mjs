import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { resolveQualificationEvidence } from "../lib/qualification-evidence.mjs";
import { buildProviderQualificationMatrix } from "../lib/provider-qualification-matrix.mjs";
import { evaluateQualificationMatrix, REQUIRED_QUALIFICATION_CELLS } from "../lib/qualification-cell.mjs";
import { storeEvidenceReference } from "../../../packages/orchestrator-core/src/aor-home.mjs";

test("qualification evidence resolves through AOR Home and fails on moved or mutated bytes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aor-s11-evidence-"));
  try {
    const runtime = path.join(root, "aor-home", "projects", "demo");
    const stored = storeEvidenceReference({
      projectRuntimeRoot: runtime,
      workspaceProjectId: "demo",
      filename: "run-summary.json",
      bytes: JSON.stringify({ run_id: "run-1", generated_at: "2026-09-06T10:00:00.000Z" }),
      bindings: { run_id: "run-1", cell_id: "openai-primary.medium" },
      redaction: { state: "none" },
    });
    const first = resolveQualificationEvidence({
      reference: stored.reference,
      projectRoot: root,
      projectRuntimeRoot: runtime,
      workspaceProjectId: "demo",
      expectedRunId: "run-1",
      expectedIdentity: { cell_id: "openai-primary.medium" },
      expectedDigest: `sha256:${stored.sha256}`,
      reportGeneratedAt: "2026-09-06T11:00:00.000Z",
    });
    assert.equal(first.ok, true, first.issues.join("; "));
    assert.equal(first.entry.ref.startsWith("evidence://projects/demo/"), true);
    assert.equal(first.entry.digest, `sha256:${stored.sha256}`);

    fs.appendFileSync(stored.filePath, "mutated");
    const mutated = resolveQualificationEvidence({
      reference: stored.reference,
      projectRoot: root,
      projectRuntimeRoot: runtime,
      workspaceProjectId: "demo",
      expectedRunId: "run-1",
      expectedDigest: `sha256:${stored.sha256}`,
    });
    assert.equal(mutated.ok, false);
    assert.match(mutated.issues.join("; "), /evidence-digest-mismatch/u);

    const moved = resolveQualificationEvidence({
      reference: "evidence://projects/demo/evidence/demo/missing/run-summary.json",
      projectRoot: root,
      projectRuntimeRoot: runtime,
      workspaceProjectId: "demo",
    });
    assert.equal(moved.ok, false);
    assert.match(moved.issues.join("; "), /evidence-(?:not-found|reference-out-of-scope)/u);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("qualification freshness resets stale passing attempts and all required cells", () => {
  const identity = {
    source_commit: "a".repeat(40),
    target_commit: "b".repeat(40),
    profile_sha256: "c".repeat(64),
    proof_sha256: "d".repeat(64),
  };
  const matrix = buildProviderQualificationMatrix({
    providers: [{ provider_variant_id: "openai-primary", provider: "openai", coverage_tier: "required" }],
    requiredProviderCounts: { "openai-primary": 1 },
    qualificationIdentity: identity,
    attempts: [{
      provider_variant_id: "openai-primary",
      run_id: "old-pass",
      status: "passed",
      ...identity,
      source_commit: "e".repeat(40),
    }],
  });
  const cell = matrix.provider_cells[0];
  assert.equal(cell.passing_run_count, 0);
  assert.equal(cell.qualification_status, "not-run");
  assert.equal(cell.freshness_status, "stale");
  assert.equal(cell.stale_attempt_count, 1);
  assert.equal(cell.invalidation_reason.includes("diagnostic-only"), true);

  const reports = REQUIRED_QUALIFICATION_CELLS.map((required) => ({
    ...required,
    run_id: `${required.cell_id}-old`,
    commit_sha: "e".repeat(40),
    status: "pass",
    qualification_identity: { ...identity, source_commit: "e".repeat(40) },
  }));
  const requiredMatrix = evaluateQualificationMatrix(reports, { qualificationIdentity: identity });
  assert.equal(requiredMatrix.status, "blocked");
  assert.ok(requiredMatrix.required_cells.every((entry) => entry.status === "stale"));
  assert.equal(requiredMatrix.blocking_findings.filter((entry) => entry.code === "qualification.identity_stale").length, 4);
});
