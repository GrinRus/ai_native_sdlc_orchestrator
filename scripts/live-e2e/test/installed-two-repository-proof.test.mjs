import assert from "node:assert/strict";
import test from "node:test";

import { validateInstalledTwoRepositoryClosure } from "./installed-two-repository-proof.mjs";

function passingReport() {
  return {
    schema_version: 1,
    evidence_kind: "installed-public-two-repository-closure",
    status: "pass",
    upstream_writes: false,
    credentialed_provider_calls: false,
    target_repository_unchanged: true,
    scenarios: {
      provision: "pass",
      conflict_serialization: "pass",
      retry: "pass",
      integration: "pass",
      delivery: "pass",
      cleanup: "pass",
    },
    commands: Array.from({ length: 8 }, (_, index) => ({ command: `aor step-${index}`, status: 0 })),
    source_snapshots: [{ root: "backend" }, { root: "frontend" }],
  };
}

test("installed two-repository closure validator accepts complete provider-free evidence", () => {
  assert.deepEqual(validateInstalledTwoRepositoryClosure(passingReport()), { ok: true, issues: [] });
});

test("installed two-repository closure validator rejects missing lifecycle evidence", () => {
  const report = passingReport();
  report.scenarios.integration = "not-run";
  report.upstream_writes = true;
  assert.equal(validateInstalledTwoRepositoryClosure(report).ok, false);
});
