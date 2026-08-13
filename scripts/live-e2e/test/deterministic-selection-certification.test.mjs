import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDeterministicSelectionCertificationManifest,
  certifyDeterministicSelection,
  validateDeterministicSelectionCertificationManifest,
} from "../lib/deterministic-selection-certification.mjs";

test("W68-S05 deterministic manifest covers every adapter and selection case without execution", () => {
  const result = certifyDeterministicSelection({ revision: "test-revision" });
  assert.equal(result.status, "hold");
  assert.equal(result.provider_execution, "not-attempted");
  assert.equal(result.accepted_cells, 35);
  assert.equal(result.release_clearance, false);
  assert.deepEqual(validateDeterministicSelectionCertificationManifest(result.manifest), { ok: true, findings: [] });
});

test("W68-S05 manifest rejects provider execution, duplicate cells, and private readback values", () => {
  const manifest = buildDeterministicSelectionCertificationManifest({ revision: "safe" });
  manifest.provider_execution = "allowed";
  manifest.matrix.cells[0].execution = "executed";
  manifest.matrix.cells.push({ ...manifest.matrix.cells[0] });
  manifest.matrix.cells[1].evidence_ref = "file:///Users/operator/.aor/token";
  const validation = validateDeterministicSelectionCertificationManifest(manifest);
  assert.equal(validation.ok, false);
  assert.match(validation.findings.join("\n"), /provider_execution/);
  assert.match(validation.findings.join("\n"), /must not execute/);
  assert.match(validation.findings.join("\n"), /duplicate certification cell/);
  assert.match(validation.findings.join("\n"), /path-safe/);
});
