import assert from "node:assert/strict";
import test from "node:test";

import { validateInstalledControlPlaneQualification } from "./installed-control-plane-qualification-proof.mjs";

function passingReport() {
  return {
    schema_version: 1,
    evidence_kind: "installed-control-plane-qualification",
    status: "pass",
    upstream_writes: false,
    credentialed_provider_calls: false,
    target_repository_unchanged: true,
    workspace_project_id: "target-proof",
    scenarios: {
      prepare_to_start_to_work: "pass",
      recovery_and_review_completion: "pass",
    },
    commands: Array.from({ length: 12 }, (_, index) => ({ command: `aor step-${index}`, status: 0 })),
    source_snapshots: [{ root: "backend" }, { root: "frontend" }],
  };
}

test("installed control-plane validator accepts complete provider-free evidence", () => {
  assert.deepEqual(validateInstalledControlPlaneQualification(passingReport()), { ok: true, issues: [] });
});

test("installed control-plane validator rejects incomplete lifecycle evidence", () => {
  const report = passingReport();
  report.scenarios.prepare_to_start_to_work = "not-run";
  report.target_repository_unchanged = false;
  assert.equal(validateInstalledControlPlaneQualification(report).ok, false);
});
