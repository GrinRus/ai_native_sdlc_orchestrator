import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { resolveEvidenceReference, storeEvidenceReference } from "../src/aor-home.mjs";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aor-evidence-s06-"));
  const runtime = path.join(root, ".aor", "projects", "demo");
  fs.mkdirSync(path.join(runtime, "reports"), { recursive: true });
  return { root, runtime };
}

test("evidence resolver returns immutable bytes and rejects traversal", () => {
  const fx = fixture();
  try {
    const report = path.join(fx.runtime, "reports", "result.json");
    fs.writeFileSync(report, "{\"ok\":true}\n");
    const resolved = resolveEvidenceReference({
      projectRoot: fx.root,
      projectRuntimeRoot: fx.runtime,
      workspaceProjectId: "demo",
      reference: "evidence://projects/demo/reports/result.json",
    });
    assert.equal(resolved.filePath, fs.realpathSync.native(report));
    assert.equal(resolved.sha256.length, 64);
    assert.throws(() => resolveEvidenceReference({ projectRoot: fx.root, projectRuntimeRoot: fx.runtime, workspaceProjectId: "demo", reference: "evidence://projects/other/reports/result.json" }), (error) => error.code === "evidence-project-mismatch");
    assert.throws(() => resolveEvidenceReference({ projectRoot: fx.root, projectRuntimeRoot: fx.runtime, workspaceProjectId: "demo", reference: "evidence://../outside.json" }), (error) => error.code === "evidence-reference-out-of-scope");
    const outside = path.join(fx.root, "outside.json");
    fs.writeFileSync(outside, "outside");
    fs.symlinkSync(outside, path.join(fx.runtime, "reports", "escape.json"));
    assert.throws(() => resolveEvidenceReference({ projectRoot: fx.root, projectRuntimeRoot: fx.runtime, workspaceProjectId: "demo", reference: "evidence://projects/demo/reports/escape.json" }), (error) => error.code === "evidence-reference-invalid" || error.code === "evidence-reference-out-of-scope");
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test("stored evidence is digest-addressed and idempotent", () => {
  const fx = fixture();
  try {
    const first = storeEvidenceReference({ projectRuntimeRoot: fx.runtime, workspaceProjectId: "demo", filename: "report.json", bytes: "immutable", bindings: { run_id: "run-1" }, redaction: { state: "none" } });
    const second = storeEvidenceReference({ projectRuntimeRoot: fx.runtime, workspaceProjectId: "demo", filename: "report.json", bytes: "immutable", bindings: { run_id: "run-1" }, redaction: { state: "none" } });
    assert.equal(first.filePath, second.filePath);
    const resolved = resolveEvidenceReference({ projectRoot: fx.root, projectRuntimeRoot: fx.runtime, workspaceProjectId: "demo", reference: first.reference });
    assert.equal(resolved.sha256, first.sha256);
    assert.throws(() => resolveEvidenceReference({ projectRoot: fx.root, projectRuntimeRoot: fx.runtime, workspaceProjectId: "demo", reference: first.reference, expectedDigest: "0".repeat(64) }), (error) => error.code === "evidence-digest-mismatch");
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});
