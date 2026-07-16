import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";

import { runProductionReadinessGate } from "../production-readiness.mjs";
import { evaluateAuditReleaseHold } from "../../packages/orchestrator-core/src/audit-release-hold.mjs";
import { getCommandDefinition } from "../../packages/orchestrator-core/src/operator-cli/command-catalog.mjs";
import {
  buildTestExecutionPlan,
  discoverTestExecutionPlan,
  readGitHead,
  validateTestExecutionReport,
} from "../test-discovery.mjs";

const root = path.resolve(new URL("../..", import.meta.url).pathname);
const proofFixturePath = path.posix.join(
  "scripts",
  "production-readiness",
  "fixtures",
  "w25-s03-production-proof.json",
);

function writeCurrentPassingTestReport() {
  const plan = discoverTestExecutionPlan(root);
  const reportPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "aor-readiness-report-")), "test-report.json");
  fs.writeFileSync(reportPath, `${JSON.stringify({
    status: "pass",
    git_head: readGitHead(root),
    manifest_digest: plan.manifest_digest,
    discovered_files: plan.candidates,
    executed_files: plan.candidates,
    groups: plan.groups.map((group) => ({ ...group, status: "pass" })),
    duplicate_files: [],
    missing_files: [],
  }, null, 2)}\n`);
  return reportPath;
}

test("production readiness gate enforces the committed audit hold with healthy internal checks", () => {
  const ledger = JSON.parse(
    fs.readFileSync(path.join(root, "docs/research/07-codebase-audit-remediation-ledger-2026-07.json"), "utf8"),
  );
  const auditIds = ledger.findings
    .map((entry) => entry.finding_id)
    .filter((findingId) => /^AUD-[0-9]{3}$/u.test(findingId));
  assert.equal(auditIds.length, 55);
  assert.ok(auditIds.includes("AUD-055"));
  const result = runProductionReadinessGate({ rootDir: root, testReportPath: writeCurrentPassingTestReport() });
  assert.equal(result.status, "blocked");
  assert.equal(result.gate_execution_status, "pass");
  assert.equal(result.release_disposition, "audit-hold");
  assert.equal(result.release_clearance, false);
  assert.ok(!result.blocking_invariants.some((entry) => entry.finding_id === "AUD-006"));
  assert.ok(!result.blocking_invariants.some((entry) => entry.finding_id === "AUD-018"));
  assert.ok(!result.blocking_invariants.some((entry) => entry.finding_id === "AUD-009"));
  assert.ok(!result.blocking_invariants.some((entry) => entry.finding_id === "AUD-020"));
  assert.ok(!result.blocking_invariants.some((entry) => entry.finding_id === "AUD-046"));
  assert.ok(result.blocking_invariants.some((entry) => entry.finding_id === "AUD-039"));
  assert.equal(
    result.checks.find((check) => check.id === "w25-real-proof-fixture")?.status,
    "pass",
  );
  assert.equal(
    result.checks.find((check) => check.id === "w30-alpha-hardening")?.status,
    "pass",
  );
  assert.equal(result.checks.find((check) => check.id === "dependency-safety")?.status, "pass");
  assert.equal(result.checks.find((check) => check.id === "w57-remediation-closure")?.status, "pass");
  assert.equal(
    result.remediation_closure_reports.W57,
    "docs/research/08-w57-security-reliability-closure.json",
  );
});

test("W57 closure report maps its audit scope exactly once and fails closed on drift", () => {
  const source = JSON.parse(
    fs.readFileSync(path.join(root, "docs/research/08-w57-security-reliability-closure.json"), "utf8"),
  );
  assert.equal(source.findings.length, 21);
  assert.equal(new Set(source.findings.map((entry) => entry.finding_id)).size, 21);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aor-w57-closure-"));
  const tempClosure = path.join(tempDir, "w57-closure.json");
  source.findings = source.findings.filter((entry) => entry.finding_id !== "AUD-017");
  fs.writeFileSync(tempClosure, `${JSON.stringify(source, null, 2)}\n`);
  const result = runProductionReadinessGate({
    rootDir: root,
    w57ClosurePath: tempClosure,
    testReportPath: writeCurrentPassingTestReport(),
  });
  assert.equal(result.status, "fail");
  const closureCheck = result.checks.find((check) => check.id === "w57-remediation-closure");
  assert.equal(closureCheck?.status, "fail");
  assert.match(closureCheck?.findings?.join("\n") ?? "", /missing 'AUD-017'/u);
});

test("production readiness gate clears only a valid ledger with evidence-backed closed blockers", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aor-audit-ledger-"));
  const tempLedger = path.join(tempDir, "audit-ledger.json");
  const ledger = JSON.parse(
    fs.readFileSync(path.join(root, "docs/research/07-codebase-audit-remediation-ledger-2026-07.json"), "utf8"),
  );
  ledger.release_disposition = "cleared";
  ledger.findings = ledger.findings.map((entry) => ({
    ...entry,
    state: "resolved",
    evidence_refs: entry.evidence_refs.length > 0 ? entry.evidence_refs : [`evidence://closure/${entry.finding_id}`],
  }));
  fs.writeFileSync(tempLedger, `${JSON.stringify(ledger, null, 2)}\n`);

  const result = runProductionReadinessGate({ rootDir: root, auditLedgerPath: tempLedger, testReportPath: writeCurrentPassingTestReport() });
  assert.equal(result.status, "pass");
  assert.equal(result.gate_execution_status, "pass");
  assert.equal(result.release_disposition, "cleared");
  assert.equal(result.release_clearance, true);
});

test("production readiness gate distinguishes an invalid ledger from an expected hold", () => {
  const result = runProductionReadinessGate({
    rootDir: root,
    auditLedgerPath: "docs/research/missing-audit-ledger.json",
  });
  assert.equal(result.status, "fail");
  assert.equal(result.gate_execution_status, "fail");
  assert.equal(result.release_disposition, "unknown");
  assert.equal(result.release_clearance, false);
});

test("CI workflow accepts only the explicit healthy audit-hold mode", () => {
  const workflow = fs.readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8");
  assert.match(workflow, /pnpm production:ready --json --expect-audit-hold/u);
  assert.doesNotMatch(workflow, /run: pnpm production:ready\s*$/mu);
});

test("test discovery maps all 61 tracked candidates exactly once", () => {
  const plan = discoverTestExecutionPlan(root);
  assert.equal(plan.ok, true, plan.errors.join("\n"));
  assert.equal(plan.candidate_count, 61);
  assert.equal(plan.excluded.length, 0);
  assert.equal(plan.groups.flatMap((group) => group.files).length, 61);
});

test("test discovery fails on unmapped, duplicate, and invalid exclusion policies", () => {
  const candidates = ["area/test/example.test.mjs"];
  const unmapped = buildTestExecutionPlan({ rootDir: root, manifest: { groups: [], exclusions: [] }, candidates });
  assert.equal(unmapped.ok, false);
  assert.match(unmapped.errors.join("\n"), /not mapped/u);

  const duplicate = buildTestExecutionPlan({
    rootDir: root,
    manifest: {
      groups: [
        { group_id: "one", path_prefixes: ["area/"], timeout_class: "standard" },
        { group_id: "two", path_prefixes: ["area/test/"], timeout_class: "standard" },
      ],
      exclusions: [],
    },
    candidates,
  });
  assert.equal(duplicate.ok, false);
  assert.match(duplicate.errors.join("\n"), /multiple groups/u);

  const invalidExclusion = buildTestExecutionPlan({
    rootDir: root,
    manifest: { groups: [], exclusions: [{ path: candidates[0], owner: "", reason: "", expires_at: "2020-01-01" }] },
    candidates,
    now: new Date("2026-07-15T00:00:00Z"),
  });
  assert.equal(invalidExclusion.ok, false);
  assert.match(invalidExclusion.errors.join("\n"), /owner|reason|expired/u);
});

test("readiness test evidence rejects stale head and accepts complete current execution", () => {
  const plan = discoverTestExecutionPlan(root);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aor-test-report-"));
  const reportPath = path.join(tempDir, "test-report.json");
  const report = {
    status: "pass",
    git_head: readGitHead(root),
    manifest_digest: plan.manifest_digest,
    discovered_files: plan.candidates,
    executed_files: plan.candidates,
    groups: plan.groups.map((group) => ({ ...group, status: "pass" })),
    duplicate_files: [],
    missing_files: [],
  };
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  assert.equal(validateTestExecutionReport(root, { reportPath }).ok, true);
  report.git_head = "stale";
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  const stale = validateTestExecutionReport(root, { reportPath });
  assert.equal(stale.ok, false);
  assert.match(stale.errors.join("\n"), /current Git HEAD/u);
});

test("audit release hold blocks only external write-capable live execution without explicit override", () => {
  const externalRuntime = { command: "provider" };
  assert.equal(
    evaluateAuditReleaseHold({ dryRun: true, externalRuntime, deliveryMode: "patch-only" }).allowed,
    true,
  );
  assert.equal(
    evaluateAuditReleaseHold({ dryRun: false, externalRuntime, deliveryMode: "no-write" }).allowed,
    true,
  );
  const blocked = evaluateAuditReleaseHold({ dryRun: false, externalRuntime, deliveryMode: "patch-only" });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.code, "audit_release_hold");
  const overridden = evaluateAuditReleaseHold({
    dryRun: false,
    externalRuntime,
    deliveryMode: "patch-only",
    unsafeDevelopmentOverride: true,
  });
  assert.equal(overridden.allowed, true);
  assert.equal(overridden.override_used, true);
});

test("write-capable command surfaces expose the explicit unsafe development override", () => {
  for (const command of ["project verify", "run start", "deliver prepare", "release prepare"]) {
    const definition = getCommandDefinition(command);
    assert.ok(definition?.inputs.some((input) => input.includes("--unsafe-development-override")), command);
  }
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
  assert.equal(
    schemas.LifecycleCommandActionRequest.properties.unsafe_development_override.default,
    false,
  );

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

  for (const [pathName, pathItem] of Object.entries(openApi.paths)) {
    if (!pathItem.post) continue;
    assert.equal(pathItem.post.responses["408"].$ref, "#/components/responses/RequestTimeout", pathName);
    assert.equal(pathItem.post.responses["413"].$ref, "#/components/responses/PayloadTooLarge", pathName);
    assert.equal(pathItem.post.responses["415"].$ref, "#/components/responses/UnsupportedMediaType", pathName);
  }

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

test("OpenAPI 3.1 validates the canonical typed operator error envelope", () => {
  const openApi = JSON.parse(fs.readFileSync(path.join(root, "docs/contracts/control-plane-api.openapi.json"), "utf8"));
  const validate = new Ajv2020({ strict: false }).compile({
    components: openApi.components,
    $ref: "#/components/schemas/ErrorEnvelope",
  });
  const payload = {
    error: {
      code: "invalid_lifecycle_flags",
      title: "Invalid lifecycle flags",
      detail: "Unknown flag '--typo'.",
      message: "Unknown flag '--typo'.",
      operation: "intake create",
      phase: "lifecycle",
      resource: null,
      consequence: "command_not_invoked",
      retryable: false,
      project_ref: null,
      flow_ref: null,
      run_ref: null,
      field_errors: [],
      evidence_refs: [],
      recovery_actions: [{ action: "inspect", payload: { resource: null } }],
    },
  };
  assert.equal(validate(payload), true, JSON.stringify(validate.errors));
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
