import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runProductionReadinessGate } from "../production-readiness.mjs";

const root = path.resolve(new URL("../..", import.meta.url).pathname);
const proofFixturePath = path.posix.join(
  "scripts",
  "production-readiness",
  "fixtures",
  "w25-s03-production-proof.json",
);

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
    proofFixturePath: path.posix.join(
      "scripts",
      "production-readiness",
      "fixtures",
      "missing-production-proof.json",
    ),
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

test("control-plane OpenAPI documents typed local-alpha read and mutation payloads", () => {
  const openApi = JSON.parse(
    fs.readFileSync(path.join(root, "docs/contracts/control-plane-api.openapi.json"), "utf8"),
  );
  const responses = openApi.components.responses;
  const requestBodies = openApi.components.requestBodies;
  const schemas = openApi.components.schemas;

  const responseRefs = {
    projectState: openApi.paths["/api/projects/{projectId}/state"].get.responses["200"].$ref,
    flows: openApi.paths["/api/projects/{projectId}/flows"].get.responses["200"].$ref,
    selectedFlow: openApi.paths["/api/projects/{projectId}/flows/selected"].get.responses["200"].$ref,
    flowDetail: openApi.paths["/api/projects/{projectId}/flows/{flowId}"].get.responses["200"].$ref,
    flowEvidenceGraph: openApi.paths["/api/projects/{projectId}/flows/{flowId}/evidence-graph"].get.responses["200"].$ref,
    flowRuntimeTrace: openApi.paths["/api/projects/{projectId}/flows/{flowId}/runtime-trace"].get.responses["200"].$ref,
    runs: openApi.paths["/api/projects/{projectId}/runs"].get.responses["200"].$ref,
    eventHistory: openApi.paths["/api/projects/{projectId}/runs/{runId}/events/history"].get.responses["200"].$ref,
    runControl: openApi.paths["/api/projects/{projectId}/run-control/actions"].post.responses["200"].$ref,
    runControlBlocked: openApi.paths["/api/projects/{projectId}/run-control/actions"].post.responses["409"].$ref,
    uiLifecycle: openApi.paths["/api/projects/{projectId}/ui-lifecycle/actions"].post.responses["200"].$ref,
    lifecycleCommand: openApi.paths["/api/projects/{projectId}/lifecycle-command/actions"].post.responses["200"].$ref,
    lifecycleCommandBlocked: openApi.paths["/api/projects/{projectId}/lifecycle-command/actions"].post.responses["409"].$ref,
    interactionAnswer: openApi.paths["/api/projects/{projectId}/interactions/answers"].post.responses["200"].$ref,
    interactionAnswerBlocked: openApi.paths["/api/projects/{projectId}/interactions/answers"].post.responses["409"].$ref,
  };

  assert.deepEqual(responseRefs, {
    projectState: "#/components/responses/ProjectState",
    flows: "#/components/responses/FlowList",
    selectedFlow: "#/components/responses/FlowDetail",
    flowDetail: "#/components/responses/FlowDetail",
    flowEvidenceGraph: "#/components/responses/FlowEvidenceGraph",
    flowRuntimeTrace: "#/components/responses/FlowRuntimeTrace",
    runs: "#/components/responses/Runs",
    eventHistory: "#/components/responses/RunEventHistory",
    runControl: "#/components/responses/RunControlAction",
    runControlBlocked: "#/components/responses/RunControlActionError",
    uiLifecycle: "#/components/responses/UiLifecycleAction",
    lifecycleCommand: "#/components/responses/LifecycleCommandAction",
    lifecycleCommandBlocked: "#/components/responses/LifecycleCommandActionError",
    interactionAnswer: "#/components/responses/InteractionAnswer",
    interactionAnswerBlocked: "#/components/responses/InteractionAnswerError",
  });

  assert.equal(openApi.paths["/api/projects/{projectId}/run-control/actions"].post.requestBody.$ref, "#/components/requestBodies/RunControlAction");
  assert.equal(openApi.paths["/api/projects/{projectId}/ui-lifecycle/actions"].post.requestBody.$ref, "#/components/requestBodies/UiLifecycleAction");
  assert.equal(openApi.paths["/api/projects/{projectId}/lifecycle-command/actions"].post.requestBody.$ref, "#/components/requestBodies/LifecycleCommandAction");
  assert.equal(openApi.paths["/api/projects/{projectId}/interactions/answers"].post.requestBody.$ref, "#/components/requestBodies/InteractionAnswer");

  for (const responseName of [
    "ProjectState",
    "FlowList",
    "FlowDetail",
    "Runs",
    "RunEventHistory",
    "RunControlAction",
    "RunControlActionError",
    "UiLifecycleAction",
    "LifecycleCommandAction",
    "LifecycleCommandActionError",
    "InteractionAnswer",
    "InteractionAnswerError",
  ]) {
    assert.ok(responses[responseName], `${responseName} response is documented`);
  }

  for (const requestName of [
    "RunControlAction",
    "UiLifecycleAction",
    "LifecycleCommandAction",
    "InteractionAnswer",
  ]) {
    assert.ok(requestBodies[requestName], `${requestName} request body is documented`);
  }

  for (const schemaName of [
    "ProjectStateResponse",
    "FlowListResponse",
    "FlowProjection",
    "RunsResponse",
    "RunSummary",
    "RunEventHistoryResponse",
    "RunControlActionRequest",
    "RunControlPayload",
    "UiLifecycleActionRequest",
    "UiLifecyclePayload",
    "LifecycleCommandActionRequest",
    "LifecycleCommandPayload",
    "InteractionAnswerRequest",
    "InteractionAnswerPayload",
  ]) {
    assert.ok(schemas[schemaName], `${schemaName} schema is documented`);
  }
});

test("control-plane OpenAPI documents bounded read-model limit parameters", () => {
  const openApi = JSON.parse(
    fs.readFileSync(path.join(root, "docs/contracts/control-plane-api.openapi.json"), "utf8"),
  );
  assert.equal(openApi.components.parameters.readModelLimit.schema.default, 200);
  assert.equal(openApi.components.parameters.readModelLimit.schema.maximum, 1000);

  for (const pathName of [
    "/api/projects/{projectId}/packets",
    "/api/projects/{projectId}/step-results",
    "/api/projects/{projectId}/quality-artifacts",
    "/api/projects/{projectId}/delivery-manifests",
    "/api/projects/{projectId}/promotion-decisions",
    "/api/projects/{projectId}/strategic-snapshot",
    "/api/projects/{projectId}/planner-metrics",
    "/api/projects/{projectId}/finance-monitoring",
    "/api/projects/{projectId}/flows",
    "/api/projects/{projectId}/flows/{flowId}/evidence-graph",
    "/api/projects/{projectId}/flows/{flowId}/runtime-trace",
    "/api/projects/{projectId}/multirepo-coordination",
    "/api/projects/{projectId}/compiler-revisions",
    "/api/projects/{projectId}/runs",
  ]) {
    const refs = openApi.paths[pathName].get.parameters.map((parameter) => parameter.$ref);
    assert.ok(refs.includes("#/components/parameters/readModelLimit"), `${pathName} documents readModelLimit`);
  }

  for (const pathName of [
    "/api/projects/{projectId}/runs/{runId}/events/history",
    "/api/projects/{projectId}/runs/{runId}/policy-history",
  ]) {
    const refs = openApi.paths[pathName].get.parameters.map((parameter) => parameter.$ref);
    assert.ok(refs.includes("#/components/parameters/eventHistoryLimit"), `${pathName} documents eventHistoryLimit`);
  }
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
