import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  W66_QUALIFICATION_CELLS,
  validateW66FindingLedger,
  validateW66QualificationManifest,
} from "../readiness/w66-qualification-manifest.mjs";

const SHA = "a".repeat(40);
const DIGEST = "b".repeat(64);

function fixture() {
  return {
    schema_version: 1,
    kind: "w66-qualification-manifest",
    aor_commit: SHA,
    target_commit: SHA,
    source_tree_clean: true,
    release_clearance: "audit-hold",
    network_policy: "provider-calls-prohibited",
    write_policy: "no-upstream-write",
    invalidate_on_source_change: true,
    cells: W66_QUALIFICATION_CELLS.map(([cellId, profileRef]) => ({
      cell_id: cellId,
      profile_ref: profileRef,
      profile_sha256: DIGEST,
      status: "not-run",
    })),
  };
}

test("W66 qualification manifest freezes exactly four not-run cells", () => {
  assert.deepEqual(validateW66QualificationManifest(fixture()), { ok: true, findings: [] });
});

test("W66 qualification manifest rejects dirty, changed, duplicate, and prematurely passing baselines", () => {
  for (const mutate of [
    (document) => { document.source_tree_clean = false; },
    (document) => { document.aor_commit = "c".repeat(40); },
    (document) => { document.cells[1] = { ...document.cells[0] }; },
    (document) => { document.cells[0].status = "pass"; },
    (document) => { document.cells[0].profile_sha256 = "changed"; },
  ]) {
    const document = fixture();
    mutate(document);
    const result = validateW66QualificationManifest(document, { aorCommit: SHA });
    assert.equal(result.ok, false);
  }
});

test("S25 replacement manifest binds one passing proof and keeps historical evidence diagnostic-only", () => {
  const document = fixture();
  document.adversarial_proof = {
    status: "pass",
    source_commit: SHA,
    sha256: `sha256:${DIGEST}`,
    historical_evidence_disposition: "diagnostic-only",
    fresh_qualification_required: true,
  };
  assert.deepEqual(validateW66QualificationManifest(document, { requireAdversarialProof: true }), { ok: true, findings: [] });
  document.adversarial_proof.source_commit = "c".repeat(40);
  assert.equal(validateW66QualificationManifest(document, { requireAdversarialProof: true }).ok, false);
});

test("W66 finding ledger maps every blocking remediation exactly once", () => {
  const ledger = JSON.parse(fs.readFileSync("docs/research/18-w66-deterministic-finding-ledger.json", "utf8"));
  assert.deepEqual(validateW66FindingLedger(ledger), { ok: true, findings: [] });
  ledger.findings.push({ ...ledger.findings[0] });
  ledger.findings[1].status = "open";
  assert.equal(validateW66FindingLedger(ledger).ok, false);
});
