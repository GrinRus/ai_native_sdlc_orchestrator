import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runProductionReadinessGate } from "../production-readiness.mjs";

const root = path.resolve(new URL("../..", import.meta.url).pathname);
const proofFixturePath = "examples/live-e2e/fixtures/w25-s03/w25-s03-production-proof.json";

test("production readiness gate passes with the committed W25 proof fixture", () => {
  const result = runProductionReadinessGate({ rootDir: root });
  assert.equal(result.status, "pass");
  assert.equal(
    result.checks.find((check) => check.id === "w25-real-proof-fixture")?.status,
    "pass",
  );
});

test("production readiness gate fails closed without W25 proof evidence", () => {
  const result = runProductionReadinessGate({
    rootDir: root,
    proofFixturePath: "examples/live-e2e/fixtures/w25-s03/missing-production-proof.json",
  });
  assert.equal(result.status, "fail");
  const proofCheck = result.checks.find((check) => check.id === "w25-real-proof-fixture");
  assert.equal(proofCheck?.status, "fail");
  assert.match(proofCheck?.findings?.join("\n") ?? "", /missing-production-proof/u);
});

test("production readiness gate rejects mock-backed full runtime proof claims", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aor-production-ready-"));
  const tempFixture = path.join(tempDir, "mock-backed-proof.json");
  const proof = JSON.parse(fs.readFileSync(path.join(root, proofFixturePath), "utf8"));
  proof.proof_method.external_runner_mode = "deterministic-external-process-mock";
  proof.proof_method.mock_runner_allowed = true;
  fs.writeFileSync(tempFixture, `${JSON.stringify(proof, null, 2)}\n`);

  const result = runProductionReadinessGate({
    rootDir: root,
    proofFixturePath: tempFixture,
  });
  assert.equal(result.status, "fail");
  const proofCheck = result.checks.find((check) => check.id === "w25-real-proof-fixture");
  assert.equal(proofCheck?.status, "fail");
  assert.match(proofCheck?.findings?.join("\n") ?? "", /mock-backed|external_runner_mode/u);
});
