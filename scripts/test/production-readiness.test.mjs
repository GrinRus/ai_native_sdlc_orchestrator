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
  assert.equal(
    result.checks.find((check) => check.id === "w30-alpha-hardening")?.status,
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

test("production readiness gate fails closed without the OpenAPI route contract", () => {
  const result = runProductionReadinessGate({
    rootDir: root,
    openApiPath: "docs/contracts/missing-control-plane-api.openapi.json",
  });
  assert.equal(result.status, "fail");
  const w30Check = result.checks.find((check) => check.id === "w30-alpha-hardening");
  assert.equal(w30Check?.status, "fail");
  assert.match(w30Check?.findings?.join("\n") ?? "", /missing-control-plane-api\.openapi\.json/u);
});

test("production readiness gate fails closed on API router and OpenAPI drift", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aor-openapi-drift-"));
  const tempOpenApi = path.join(tempDir, "control-plane-api.openapi.json");
  const openApi = JSON.parse(
    fs.readFileSync(path.join(root, "docs/contracts/control-plane-api.openapi.json"), "utf8"),
  );
  delete openApi.paths["/api/projects/{projectId}/state"];
  fs.writeFileSync(tempOpenApi, `${JSON.stringify(openApi, null, 2)}\n`);

  const result = runProductionReadinessGate({
    rootDir: root,
    openApiPath: tempOpenApi,
  });
  assert.equal(result.status, "fail");
  const w30Check = result.checks.find((check) => check.id === "w30-alpha-hardening");
  assert.equal(w30Check?.status, "fail");
  assert.match(w30Check?.findings?.join("\n") ?? "", /project-state/u);
});

test("production readiness gate keeps OpenCode stories blocked without real proof", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aor-story-honesty-"));
  const tempMatrix = path.join(tempDir, "user-story-coverage-matrix.md");
  const matrix = fs
    .readFileSync(path.join(root, "docs/product/user-story-coverage-matrix.md"), "utf8")
    .replace(
      "| DEV-04 | Delivery engineer | MVP | Run OpenCode through a certified live-baseline adapter path. | blocked |",
      "| DEV-04 | Delivery engineer | MVP | Run OpenCode through a certified live-baseline adapter path. | baseline-covered |",
    );
  fs.writeFileSync(tempMatrix, matrix, "utf8");

  const result = runProductionReadinessGate({
    rootDir: root,
    storyMatrixPath: tempMatrix,
  });
  assert.equal(result.status, "fail");
  const storyCheck = result.checks.find((check) => check.id === "story-status-honesty");
  assert.equal(storyCheck?.status, "fail");
  assert.match(storyCheck?.findings?.join("\n") ?? "", /DEV-04 must remain blocked/u);
});
