import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  getContractFamilyIndex,
  loadContractFile,
  loadExampleContracts,
  validateContractDocument,
} from "../src/index.mjs";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const workspaceRoot = path.resolve(currentDir, "../../..");

/**
 * @param {string} root
 * @returns {string[]}
 */
function listYamlFiles(root) {
  /** @type {string[]} */
  const files = [];
  /** @type {string[]} */
  const pending = [root];

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) {
      continue;
    }

    for (const dirent of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, dirent.name);
      if (dirent.isDirectory()) {
        pending.push(entryPath);
        continue;
      }
      if (dirent.isFile() && /\.ya?ml$/i.test(dirent.name)) {
        files.push(entryPath);
      }
    }
  }

  return files;
}

/**
 * @param {string} root
 * @param {import("../src/index.d.ts").ContractFamily} family
 */
function assertDirectoryContractsLoad(root, family) {
  const files = listYamlFiles(root);
  assert.ok(files.length > 0, `expected at least one YAML document under ${root}`);
  for (const filePath of files) {
    const loaded = loadContractFile({ filePath, family });
    assert.equal(loaded.ok, true, `${path.relative(workspaceRoot, filePath)} should load as ${family}`);
  }
}

/**
 * @param {import("../src/index.d.ts").ContractValidationResult} validation
 * @param {string} code
 * @param {string} field
 */
function assertValidationIssue(validation, code, field) {
  assert.equal(validation.ok, false, `expected validation to fail for ${field}`);
  assert.ok(
    validation.issues.some((problem) => problem.code === code && problem.field === field),
    `expected ${code} for ${field}`,
  );
}

test("loads all examples through the shared contracts path", () => {
  const examplesRoot = path.join(workspaceRoot, "examples");
  const expectedYamlCount = listYamlFiles(examplesRoot).length;

  const loaded = loadExampleContracts({ workspaceRoot });
  const failed = loaded.results.filter((result) => !result.ok);

  assert.equal(loaded.results.length, expectedYamlCount, "all YAML examples should be processed");
  assert.equal(failed.length, 0, `expected no validation failures, got ${failed.length}`);
  assert.equal(loaded.ok, true, "batch example loading should pass");
});

test("loads monorepo and bounded multirepo profiles through the same project-profile contract path", () => {
  for (const profileName of ["project.aor.yaml", "project.bounded-multirepo.aor.yaml"]) {
    const loaded = loadContractFile({
      filePath: path.join(workspaceRoot, "examples", profileName),
      family: "project-profile",
    });
    assert.equal(loaded.ok, true, `${profileName} should load as project-profile`);
  }
});

test("returns actionable error when required field is missing", () => {
  const source = path.join(workspaceRoot, "examples/project.aor.yaml");
  const loaded = loadContractFile({ filePath: source, family: "project-profile" });
  assert.equal(loaded.ok, true, "fixture should load before mutation");

  const candidate = structuredClone(loaded.document);
  delete candidate.project_id;

  const validation = validateContractDocument({
    family: "project-profile",
    document: candidate,
    source: "test://missing-required",
  });

  assert.equal(validation.ok, false);
  assert.ok(
    validation.issues.some((problem) => problem.code === "required_field_missing" && problem.field === "project_id"),
    "expected required field error for project_id",
  );
});

test("project profile requires default skill refs and step overrides maps", () => {
  const source = path.join(workspaceRoot, "examples/project.aor.yaml");
  const loaded = loadContractFile({ filePath: source, family: "project-profile" });
  assert.equal(loaded.ok, true, "fixture should load before mutation");

  const candidate = structuredClone(loaded.document);
  delete candidate.default_skill_profiles;
  delete candidate.skill_overrides;

  const validation = validateContractDocument({
    family: "project-profile",
    document: candidate,
    source: "test://missing-skill-maps",
  });

  assert.equal(validation.ok, false);
  assert.ok(
    validation.issues.some(
      (problem) => problem.code === "required_field_missing" && problem.field === "default_skill_profiles",
    ),
    "expected required field error for default_skill_profiles",
  );
  assert.ok(
    validation.issues.some(
      (problem) => problem.code === "required_field_missing" && problem.field === "skill_overrides",
    ),
    "expected required field error for skill_overrides",
  );
});

test("skill profile requires workflow field", () => {
  const source = path.join(workspaceRoot, "examples/skills/skill-runner-default.yaml");
  const loaded = loadContractFile({ filePath: source, family: "skill-profile" });
  assert.equal(loaded.ok, true, "fixture should load before mutation");

  const candidate = structuredClone(loaded.document);
  delete candidate.workflow;

  const validation = validateContractDocument({
    family: "skill-profile",
    document: candidate,
    source: "test://skill-profile-missing-workflow",
  });

  assert.equal(validation.ok, false);
  assert.ok(
    validation.issues.some(
      (problem) => problem.code === "required_field_missing" && problem.field === "workflow",
    ),
    "expected required field error for workflow",
  );
});

test("returns actionable error when field type mismatches", () => {
  const source = path.join(workspaceRoot, "examples/project.aor.yaml");
  const loaded = loadContractFile({ filePath: source, family: "project-profile" });
  assert.equal(loaded.ok, true, "fixture should load before mutation");

  const candidate = structuredClone(loaded.document);
  candidate.repos = { invalid: true };

  const validation = validateContractDocument({
    family: "project-profile",
    document: candidate,
    source: "test://type-mismatch",
  });

  assert.equal(validation.ok, false);
  const mismatchIssue = validation.issues.find(
    (problem) => problem.code === "field_type_mismatch" && problem.field === "repos",
  );
  assert.ok(mismatchIssue, "expected field_type_mismatch for repos");
  assert.ok(
    mismatchIssue.expected === "array" && mismatchIssue.actual === "object",
    "expected mismatch issue to include expected=array and actual=object details",
  );
});

test("returns actionable error when explicit enum value is invalid", () => {
  const source = path.join(workspaceRoot, "examples/wrappers/wrapper-runner-default.yaml");
  const loaded = loadContractFile({ filePath: source, family: "wrapper-profile" });
  assert.equal(loaded.ok, true, "fixture should load before mutation");

  const candidate = structuredClone(loaded.document);
  candidate.step_class = "unknown-step-class";

  const validation = validateContractDocument({
    family: "wrapper-profile",
    document: candidate,
    source: "test://invalid-enum",
  });

  assert.equal(validation.ok, false);
  const enumIssue = validation.issues.find(
    (problem) => problem.code === "enum_value_invalid" && problem.field === "step_class",
  );
  assert.ok(enumIssue, "expected enum_value_invalid for step_class");
  assert.ok(
    enumIssue.expected === "artifact|planner|runner|repair|eval|harness",
    "expected enum issue to include allowed-values detail",
  );
});

test("project profile requires default prompt and context bundle defaults", () => {
  const source = path.join(workspaceRoot, "examples/project.aor.yaml");
  const loaded = loadContractFile({ filePath: source, family: "project-profile" });
  assert.equal(loaded.ok, true, "fixture should load before mutation");

  const candidate = structuredClone(loaded.document);
  delete candidate.default_prompt_bundles;

  const validation = validateContractDocument({
    family: "project-profile",
    document: candidate,
    source: "test://missing-default-prompt-bundles",
  });

  assert.equal(validation.ok, false);
  assert.ok(
    validation.issues.some(
      (problem) => problem.code === "required_field_missing" && problem.field === "default_prompt_bundles",
    ),
    "expected required field error for default_prompt_bundles",
  );
});

test("provider-route-profile rejects legacy wrapper ownership field", () => {
  const source = path.join(workspaceRoot, "examples/routes/implement-default.yaml");
  const loaded = loadContractFile({ filePath: source, family: "provider-route-profile" });
  assert.equal(loaded.ok, true, "fixture should load before mutation");

  const candidate = structuredClone(loaded.document);
  candidate.wrapper_profile_ref = "wrapper.runner.default@v3";

  const validation = validateContractDocument({
    family: "provider-route-profile",
    document: candidate,
    source: "test://legacy-route-wrapper-field",
  });

  assert.equal(validation.ok, false);
  assert.ok(
    validation.issues.some(
      (problem) => problem.code === "unsupported_field_present" && problem.field === "wrapper_profile_ref",
    ),
    "expected unsupported_field_present for wrapper_profile_ref",
  );
});

test("wrapper-profile rejects legacy prompt and session bootstrap fields", () => {
  const source = path.join(workspaceRoot, "examples/wrappers/wrapper-runner-default.yaml");
  const loaded = loadContractFile({ filePath: source, family: "wrapper-profile" });
  assert.equal(loaded.ok, true, "fixture should load before mutation");

  const candidate = structuredClone(loaded.document);
  candidate.prompt_bundle_ref = "prompt-bundle://runner-default@v3";
  candidate.session_bootstrap = { include_files: ["README.md"] };

  const validation = validateContractDocument({
    family: "wrapper-profile",
    document: candidate,
    source: "test://legacy-wrapper-fields",
  });

  assert.equal(validation.ok, false);
  assert.ok(
    validation.issues.some(
      (problem) => problem.code === "unsupported_field_present" && problem.field === "prompt_bundle_ref",
    ),
    "expected unsupported_field_present for prompt_bundle_ref",
  );
  assert.ok(
    validation.issues.some(
      (problem) => problem.code === "unsupported_field_present" && problem.field === "session_bootstrap",
    ),
    "expected unsupported_field_present for session_bootstrap",
  );
});

test("W14 live-e2e provider variant catalog documents validate", () => {
  assertDirectoryContractsLoad(
    path.join(workspaceRoot, "scripts/live-e2e/catalog/providers"),
    "live-e2e-provider-variant",
  );
});

test("W14 live-e2e scenario policy documents validate", () => {
  assertDirectoryContractsLoad(
    path.join(workspaceRoot, "scripts/live-e2e/catalog/scenarios"),
    "live-e2e-scenario-policy",
  );
});

test("W14 live-e2e target catalog documents validate", () => {
  assertDirectoryContractsLoad(
    path.join(workspaceRoot, "scripts/live-e2e/catalog/targets"),
    "live-e2e-target-catalog",
  );
});

test("new runtime context family examples load through the shared contract path", () => {
  const examples = [
    [path.join(workspaceRoot, "examples/context/docs/repo-map-core.yaml"), "context-doc"],
    [path.join(workspaceRoot, "examples/context/rules/public-repo-safety.yaml"), "context-rule"],
    [path.join(workspaceRoot, "examples/context/skills/runner-verification-default.yaml"), "context-skill"],
    [path.join(workspaceRoot, "examples/context/bundles/runner-foundation.yaml"), "context-bundle"],
    [path.join(workspaceRoot, "examples/context/compiled/implement-runner-default.sample.yaml"), "compiled-context-artifact"],
  ];

  for (const [filePath, family] of examples) {
    const loaded = loadContractFile({ filePath, family });
    assert.equal(loaded.ok, true, `expected ${family} example to load`);
  }
});

test("runtime harness report example loads through the shared contract path", () => {
  const loaded = loadContractFile({
    filePath: path.join(workspaceRoot, "examples/reports/runtime-harness-report.sample.yaml"),
    family: "runtime-harness-report",
  });

  assert.equal(loaded.ok, true, "expected runtime-harness-report example to load");
});

test("runtime harness report rejects invalid run-level controller evidence", () => {
  const loaded = loadContractFile({
    filePath: path.join(workspaceRoot, "examples/reports/runtime-harness-report.sample.yaml"),
    family: "runtime-harness-report",
  });
  assert.equal(loaded.ok, true, "fixture should load before mutation");

  const invalidStage = structuredClone(loaded.document);
  invalidStage.run_transitions[0].stage = "teleport";
  assertValidationIssue(
    validateContractDocument({
      family: "runtime-harness-report",
      document: invalidStage,
      source: "test://runtime-harness-report-invalid-stage",
    }),
    "enum_value_invalid",
    "run_transitions[0].stage",
  );

  const missingDecisionEvidence = structuredClone(loaded.document);
  delete missingDecisionEvidence.run_decision.evidence_refs;
  assertValidationIssue(
    validateContractDocument({
      family: "runtime-harness-report",
      document: missingDecisionEvidence,
      source: "test://runtime-harness-report-missing-decision-evidence",
    }),
    "required_field_missing",
    "run_decision.evidence_refs",
  );
});

test("review decision example preserves explicit approval vocabulary", () => {
  const loaded = loadContractFile({
    filePath: path.join(workspaceRoot, "examples/reports/review-decision.approve.yaml"),
    family: "review-decision",
  });
  assert.equal(loaded.ok, true, "expected review-decision example to load");
  assert.equal(loaded.document.decision, "approve");
  assert.equal(loaded.document.delivery_gate.status, "pass");

  const invalid = structuredClone(loaded.document);
  invalid.decision = "proceed";
  const validation = validateContractDocument({
    family: "review-decision",
    document: invalid,
    source: "test://review-decision-invalid-decision",
  });
  assert.equal(validation.ok, false);
  assert.ok(
    validation.issues.some((problem) => problem.code === "enum_value_invalid" && problem.field === "decision"),
    "expected invalid review decision value to be rejected",
  );
});

test("planner metrics snapshot example preserves no-data capable metric vocabulary", () => {
  const loaded = loadContractFile({
    filePath: path.join(workspaceRoot, "examples/reports/planner-metrics-snapshot.sample.yaml"),
    family: "planner-metrics-snapshot",
  });
  assert.equal(loaded.ok, true, "expected planner-metrics-snapshot example to load");
  assert.deepEqual(loaded.document.metric_names, [
    "clean_close_rate",
    "retry_rate",
    "repair_rate",
    "blocker_rate",
  ]);
  assert.equal(loaded.document.metrics.clean_close_rate.value, 0.25);

  const invalid = structuredClone(loaded.document);
  invalid.status = "green";
  const validation = validateContractDocument({
    family: "planner-metrics-snapshot",
    document: invalid,
    source: "test://planner-metrics-invalid-status",
  });
  assert.equal(validation.ok, false);
  assert.ok(
    validation.issues.some((problem) => problem.code === "enum_value_invalid" && problem.field === "status"),
    "expected invalid planner metrics status to be rejected",
  );
});

test("discovery research report examples distinguish ADR-ready and incomplete evidence", () => {
  const ready = loadContractFile({
    filePath: path.join(workspaceRoot, "examples/reports/discovery-research-report.adr-ready.yaml"),
    family: "discovery-research-report",
  });
  assert.equal(ready.ok, true, "expected ADR-ready discovery research example to load");
  assert.equal(ready.document.status, "adr-ready");

  const incomplete = loadContractFile({
    filePath: path.join(workspaceRoot, "examples/reports/discovery-research-report.incomplete.yaml"),
    family: "discovery-research-report",
  });
  assert.equal(incomplete.ok, true, "expected incomplete discovery research example to load");
  assert.equal(incomplete.document.status, "incomplete");

  const invalid = structuredClone(ready.document);
  invalid.status = "ready";
  const validation = validateContractDocument({
    family: "discovery-research-report",
    document: invalid,
    source: "test://discovery-research-invalid-status",
  });
  assert.equal(validation.ok, false);
  assert.ok(
    validation.issues.some((problem) => problem.code === "enum_value_invalid" && problem.field === "status"),
    "expected invalid discovery research status to be rejected",
  );
});

test("incident backfill proposal example preserves proposal-only review state", () => {
  const loaded = loadContractFile({
    filePath: path.join(workspaceRoot, "examples/reports/incident-backfill-proposal.proposed.yaml"),
    family: "incident-backfill-proposal",
  });
  assert.equal(loaded.ok, true, "expected incident-backfill-proposal example to load");
  assert.equal(loaded.document.proposal_state, "proposed");
  assert.equal(loaded.document.target.dataset_mutation_mode, "proposal-only");
  assert.equal(loaded.document.mutation_policy.stable_dataset_mutation, "blocked");

  const invalidState = structuredClone(loaded.document);
  invalidState.proposal_state = "applied";
  const invalidStateValidation = validateContractDocument({
    family: "incident-backfill-proposal",
    document: invalidState,
    source: "test://incident-backfill-invalid-state",
  });
  assert.equal(invalidStateValidation.ok, false);
  assert.ok(
    invalidStateValidation.issues.some(
      (problem) => problem.code === "enum_value_invalid" && problem.field === "proposal_state",
    ),
    "expected applied proposal state to be rejected",
  );

  const missingTarget = structuredClone(loaded.document);
  delete missingTarget.target;
  const missingTargetValidation = validateContractDocument({
    family: "incident-backfill-proposal",
    document: missingTarget,
    source: "test://incident-backfill-missing-target",
  });
  assert.equal(missingTargetValidation.ok, false);
  assert.ok(
    missingTargetValidation.issues.some(
      (problem) => problem.code === "required_field_missing" && problem.field === "target",
    ),
    "expected missing target to be rejected",
  );
});

test("intake request body validates local source refs and rejects malformed product evidence", () => {
  const loaded = loadContractFile({
    filePath: path.join(workspaceRoot, "examples/packets/intake-request-body.complete.yaml"),
    family: "intake-request-body",
  });
  assert.equal(loaded.ok, true, "expected complete intake-request-body example to load");

  const invalidSource = structuredClone(loaded.document);
  invalidSource.product_intake.source_refs[0].source_kind = "github-issue";
  const invalidSourceValidation = validateContractDocument({
    family: "intake-request-body",
    document: invalidSource,
    source: "test://intake-request-body-external-source",
  });
  assert.equal(invalidSourceValidation.ok, false);
  assert.ok(
    invalidSourceValidation.issues.some(
      (problem) =>
        problem.code === "enum_value_invalid" && problem.field === "product_intake.source_refs[0].source_kind",
    ),
    "expected external SaaS source kind to be rejected",
  );

  const missingKpis = structuredClone(loaded.document);
  delete missingKpis.product_intake.kpis;
  const missingKpisValidation = validateContractDocument({
    family: "intake-request-body",
    document: missingKpis,
    source: "test://intake-request-body-missing-kpis",
  });
  assert.equal(missingKpisValidation.ok, false);
  assert.ok(
    missingKpisValidation.issues.some(
      (problem) => problem.code === "required_field_missing" && problem.field === "product_intake.kpis",
    ),
    "expected missing product_intake.kpis to be rejected",
  );

  const malformedKpi = structuredClone(loaded.document);
  delete malformedKpi.product_intake.kpis[0].target;
  const malformedKpiValidation = validateContractDocument({
    family: "intake-request-body",
    document: malformedKpi,
    source: "test://intake-request-body-malformed-kpi",
  });
  assert.equal(malformedKpiValidation.ok, false);
  assert.ok(
    malformedKpiValidation.issues.some(
      (problem) => problem.code === "required_field_missing" && problem.field === "product_intake.kpis[0].target",
    ),
    "expected malformed KPI target to be rejected",
  );

  const invalidDeliveryMode = structuredClone(loaded.document);
  invalidDeliveryMode.mission_scope.delivery_mode = "upstream-main";
  const invalidDeliveryModeValidation = validateContractDocument({
    family: "intake-request-body",
    document: invalidDeliveryMode,
    source: "test://intake-request-body-invalid-delivery-mode",
  });
  assert.equal(invalidDeliveryModeValidation.ok, false);
  assert.ok(
    invalidDeliveryModeValidation.issues.some(
      (problem) => problem.code === "enum_value_invalid" && problem.field === "mission_scope.delivery_mode",
    ),
    "expected unsupported mission delivery mode to be rejected",
  );
});

test("context assets require metadata and source reference fields in the supported shape", () => {
  const source = path.join(workspaceRoot, "examples/context/skills/runner-verification-default.yaml");
  const loaded = loadContractFile({ filePath: source, family: "context-skill" });
  assert.equal(loaded.ok, true, "fixture should load before mutation");

  const candidate = structuredClone(loaded.document);
  delete candidate.metadata;
  delete candidate.source_refs;

  const validation = validateContractDocument({
    family: "context-skill",
    document: candidate,
    source: "test://context-skill-missing-metadata-source-refs",
  });

  assert.equal(validation.ok, false);
  assert.ok(
    validation.issues.some((problem) => problem.code === "required_field_missing" && problem.field === "metadata"),
    "expected required field error for metadata",
  );
  assert.ok(
    validation.issues.some((problem) => problem.code === "required_field_missing" && problem.field === "source_refs"),
    "expected required field error for source_refs",
  );
});

test("control-plane API baseline example loads through the shared contract path", () => {
  const source = path.join(workspaceRoot, "examples/control-plane-api/module-surface-baseline.yaml");
  const loaded = loadContractFile({ filePath: source, family: "control-plane-api" });
  assert.equal(loaded.ok, true, "expected control-plane-api baseline example to load");
});

test("control-plane API baseline documents interactive continuation target metadata", () => {
  const source = path.join(workspaceRoot, "examples/control-plane-api/module-surface-baseline.yaml");
  const loaded = loadContractFile({ filePath: source, family: "control-plane-api" });
  assert.equal(loaded.ok, true, "fixture should load before assertions");

  assert.equal(loaded.document.interactive_continuation?.owning_slice, "W18-S01");
  assert.equal(loaded.document.interactive_continuation?.request_contract_family, "step-result");
  assert.equal(loaded.document.interactive_continuation?.event_contract_family, "live-run-event");
  assert.equal(
    loaded.document.interactive_continuation?.answer_submission?.implementation_status,
    "implemented-w18-s02",
  );
  assert.equal(loaded.document.lifecycle_command_operations?.owning_slice, "W18-S02");
  assert.ok(
    loaded.document.lifecycle_command_operations?.commands?.some(
      (entry) => entry.command === "intake create",
    ),
    "expected lifecycle command subset to include intake create",
  );
  assert.ok(
    loaded.document.lifecycle_command_operations?.commands?.some(
      (entry) => entry.command === "mission create",
    ),
    "expected lifecycle command subset to include guided mission create",
  );
  assert.ok(
    loaded.document.deferred_transport?.implemented_mappings?.includes(
      "GET /api/projects/:projectId/next-action-report",
    ),
    "expected next-action report read mapping for guided web",
  );
  assert.ok(
    loaded.document.interactive_continuation?.audit_behavior?.query_safe_refs?.includes("answer_audit_ref"),
    "expected answer audit refs to be query-safe",
  );
});

test("control-plane API baseline documents production hardening metadata", () => {
  const source = path.join(workspaceRoot, "examples/control-plane-api/module-surface-baseline.yaml");
  const loaded = loadContractFile({ filePath: source, family: "control-plane-api" });
  assert.equal(loaded.ok, true, "fixture should load before assertions");

  assert.equal(loaded.document.production_hardening?.owning_slice, "W20-S02");
  assert.equal(loaded.document.production_hardening?.status, "implemented-baseline");
  assert.ok(
    loaded.document.production_hardening?.transport_modes?.some(
      (entry) => entry.mode === "production-hardened" && entry.auth_required === true,
    ),
    "expected production-hardened mode to require auth",
  );
  assert.ok(
    loaded.document.production_hardening?.redaction?.response_surfaces?.includes("SSE data payloads"),
    "expected SSE response redaction metadata",
  );
});

test("control-plane API contract rejects invalid binding mode", () => {
  const source = path.join(workspaceRoot, "examples/control-plane-api/module-surface-baseline.yaml");
  const loaded = loadContractFile({ filePath: source, family: "control-plane-api" });
  assert.equal(loaded.ok, true, "fixture should load before mutation");

  const candidate = structuredClone(loaded.document);
  candidate.binding_mode = "detached-http";

  const validation = validateContractDocument({
    family: "control-plane-api",
    document: candidate,
    source: "test://control-plane-api-invalid-binding-mode",
  });

  assert.equal(validation.ok, false);
  const enumIssue = validation.issues.find(
    (problem) => problem.code === "enum_value_invalid" && problem.field === "binding_mode",
  );
  assert.ok(enumIssue, "expected enum_value_invalid for binding_mode");
});

test("live E2E observation report loads and enforces status scale", () => {
  const source = path.join(workspaceRoot, "examples/reports/live-e2e-observation-report.sample.yaml");
  const loaded = loadContractFile({ filePath: source, family: "live-e2e-observation-report" });
  assert.equal(loaded.ok, true, "expected live-e2e-observation-report sample to load");

  const candidate = structuredClone(loaded.document);
  candidate.overall_status = "fail";

  const validation = validateContractDocument({
    family: "live-e2e-observation-report",
    document: candidate,
    source: "test://live-e2e-observation-invalid-status",
  });

  assert.equal(validation.ok, false);
  const enumIssue = validation.issues.find(
    (problem) => problem.code === "enum_value_invalid" && problem.field === "overall_status",
  );
  assert.ok(enumIssue, "expected enum_value_invalid for overall_status");

  const invalidFlowRangePolicyCandidate = structuredClone(loaded.document);
  invalidFlowRangePolicyCandidate.flow_range_policy = "report_first";

  const invalidFlowRangePolicyValidation = validateContractDocument({
    family: "live-e2e-observation-report",
    document: invalidFlowRangePolicyCandidate,
    source: "test://live-e2e-observation-invalid-flow-range-policy",
  });

  assert.equal(invalidFlowRangePolicyValidation.ok, false);
  assert.ok(
    invalidFlowRangePolicyValidation.issues.some(
      (problem) => problem.code === "enum_value_invalid" && problem.field === "flow_range_policy",
    ),
    "expected flow_range_policy to use the supported live E2E policy set",
  );

  const nestedCandidate = structuredClone(loaded.document);
  nestedCandidate.step_journal[0].final_step_verdict = "fail";
  nestedCandidate.step_journal[0].deterministic_analysis.status = "fail";
  nestedCandidate.step_journal[0].semantic_analysis.status = "fail";
  nestedCandidate.final_analysis.status = "fail";

  const nestedValidation = validateContractDocument({
    family: "live-e2e-observation-report",
    document: nestedCandidate,
    source: "test://live-e2e-observation-invalid-nested-status",
  });

  assert.equal(nestedValidation.ok, false);
  for (const field of [
    "step_journal[0].final_step_verdict",
    "step_journal[0].deterministic_analysis.status",
    "step_journal[0].semantic_analysis.status",
    "final_analysis.status",
  ]) {
    assert.ok(
      nestedValidation.issues.some((problem) => problem.code === "enum_value_invalid" && problem.field === field),
      `expected enum_value_invalid for ${field}`,
    );
  }

  const missingPlanCandidate = structuredClone(loaded.document);
  delete missingPlanCandidate.step_journal[0].plan;

  const missingPlanValidation = validateContractDocument({
    family: "live-e2e-observation-report",
    document: missingPlanCandidate,
    source: "test://live-e2e-observation-missing-plan",
  });

  assert.equal(missingPlanValidation.ok, false);
  assert.ok(
    missingPlanValidation.issues.some(
      (problem) => problem.code === "required_field_missing" && problem.field === "step_journal[0].plan",
    ),
    "expected step_journal entries without plan to be rejected",
  );

  const missingOperatorCandidate = structuredClone(loaded.document);
  delete missingOperatorCandidate.operator_context;

  const missingOperatorValidation = validateContractDocument({
    family: "live-e2e-observation-report",
    document: missingOperatorCandidate,
    source: "test://live-e2e-observation-missing-operator-context",
  });

  assert.equal(missingOperatorValidation.ok, false);
  assert.ok(
    missingOperatorValidation.issues.some(
      (problem) => problem.code === "required_field_missing" && problem.field === "operator_context.operator_kind",
    ),
    "expected live E2E reports without operator context to be rejected",
  );

  const skillAgentDecisionCandidate = structuredClone(loaded.document);
  skillAgentDecisionCandidate.operator_context = {
    operator_kind: "skill-agent",
    operator_ref: "skill://live-e2e-runner",
    decision_policy: "required",
    answer_policy: "agent-public-control-plane",
    target_write_policy: "aor-runtime-only-before-execution",
  };
  skillAgentDecisionCandidate.step_journal[0].operator_decision_status = "missing";
  skillAgentDecisionCandidate.step_journal[0].semantic_analysis.judge_source = "deterministic-runner";

  const skillAgentDecisionValidation = validateContractDocument({
    family: "live-e2e-observation-report",
    document: skillAgentDecisionCandidate,
    source: "test://live-e2e-observation-missing-skill-agent-decision",
  });

  assert.equal(skillAgentDecisionValidation.ok, false);
  assert.ok(
    skillAgentDecisionValidation.issues.some(
      (problem) =>
        problem.code === "enum_value_invalid" &&
        problem.field === "step_journal[0].operator_decision_status",
    ),
    "expected acceptance reports without accepted skill-agent decisions to be rejected",
  );
  assert.ok(
    skillAgentDecisionValidation.issues.some(
      (problem) =>
        problem.code === "enum_value_invalid" &&
        problem.field === "step_journal[0].semantic_analysis.judge_source",
    ),
    "expected deterministic semantic analysis to be rejected for skill-agent reports",
  );

  const inProgressSkillAgentCandidate = structuredClone(skillAgentDecisionCandidate);
  inProgressSkillAgentCandidate.report_status = "in_progress";

  const inProgressSkillAgentValidation = validateContractDocument({
    family: "live-e2e-observation-report",
    document: inProgressSkillAgentCandidate,
    source: "test://live-e2e-observation-in-progress-skill-agent-decision",
  });

  assert.equal(inProgressSkillAgentValidation.ok, true);

  const missingInstallCandidate = structuredClone(loaded.document);
  delete missingInstallCandidate.aor_installation_proof_file;

  const missingInstallValidation = validateContractDocument({
    family: "live-e2e-observation-report",
    document: missingInstallCandidate,
    source: "test://live-e2e-observation-missing-install-proof",
  });

  assert.equal(missingInstallValidation.ok, false);
  assert.ok(
    missingInstallValidation.issues.some(
      (problem) => problem.code === "required_field_missing" && problem.field === "aor_installation_proof_file",
    ),
    "expected live E2E reports without installation proof to be rejected",
  );

  const missingSetupCandidate = structuredClone(loaded.document);
  missingSetupCandidate.setup_journal = [];

  const missingSetupValidation = validateContractDocument({
    family: "live-e2e-observation-report",
    document: missingSetupCandidate,
    source: "test://live-e2e-observation-missing-setup-journal",
  });

  assert.equal(missingSetupValidation.ok, false);
  assert.ok(
    missingSetupValidation.issues.some(
      (problem) => problem.code === "required_field_missing" && problem.field === "setup_journal",
    ),
    "expected live E2E reports without setup evidence to be rejected",
  );

  const invalidPreludeCandidate = structuredClone(loaded.document);
  invalidPreludeCandidate.flow_range.prelude_steps = invalidPreludeCandidate.flow_range.prelude_steps.filter(
    (step) => step !== "install",
  );

  const invalidPreludeValidation = validateContractDocument({
    family: "live-e2e-observation-report",
    document: invalidPreludeCandidate,
    source: "test://live-e2e-observation-invalid-prelude-steps",
  });

  assert.equal(invalidPreludeValidation.ok, false);
  assert.ok(
    invalidPreludeValidation.issues.some(
      (problem) => problem.code === "enum_value_invalid" && problem.field === "flow_range.prelude_steps[0]",
    ),
    "expected flow_range.prelude_steps to start with install",
  );

  const reorderedSetupCandidate = structuredClone(loaded.document);
  reorderedSetupCandidate.setup_journal = reorderedSetupCandidate.setup_journal.filter(
    (entry) => entry.step_id !== "install",
  );

  const reorderedSetupValidation = validateContractDocument({
    family: "live-e2e-observation-report",
    document: reorderedSetupCandidate,
    source: "test://live-e2e-observation-reordered-setup-journal",
  });

  assert.equal(reorderedSetupValidation.ok, false);
  assert.ok(
    reorderedSetupValidation.issues.some(
      (problem) => problem.code === "enum_value_invalid" && problem.field === "setup_journal[0].step_id",
    ),
    "expected live E2E setup evidence to require the install prelude first",
  );

  const malformedSetupEvidenceCandidate = structuredClone(loaded.document);
  malformedSetupEvidenceCandidate.setup_journal[0].evidence_refs = [123];

  const malformedSetupEvidenceValidation = validateContractDocument({
    family: "live-e2e-observation-report",
    document: malformedSetupEvidenceCandidate,
    source: "test://live-e2e-observation-malformed-setup-evidence",
  });

  assert.equal(malformedSetupEvidenceValidation.ok, false);
  assert.ok(
    malformedSetupEvidenceValidation.issues.some(
      (problem) => problem.code === "field_type_mismatch" && problem.field === "setup_journal[0].evidence_refs[0]",
    ),
    "expected setup evidence refs to contain strings only",
  );

  for (const legacyField of ["step_matrix", "verdict_matrix", "artifact_quality_matrix", "continuation_decisions"]) {
    const legacyCandidate = structuredClone(loaded.document);
    legacyCandidate[legacyField] = [];

    const legacyValidation = validateContractDocument({
      family: "live-e2e-observation-report",
      document: legacyCandidate,
      source: `test://live-e2e-observation-legacy-${legacyField}`,
    });

    assert.equal(legacyValidation.ok, false);
    assert.ok(
      legacyValidation.issues.some(
        (problem) => problem.code === "unsupported_field_present" && problem.field === legacyField,
      ),
      `expected legacy ${legacyField} to be rejected`,
    );
  }
});

test("W23 nested canonical contract examples load through the shared contract path", () => {
  const examples = [
    [path.join(workspaceRoot, "examples/packets/artifact-packet.canonical.yaml"), "artifact-packet"],
    [path.join(workspaceRoot, "examples/reports/step-result.canonical.yaml"), "step-result"],
    [path.join(workspaceRoot, "examples/reports/validation-report.canonical.yaml"), "validation-report"],
    [path.join(workspaceRoot, "examples/reports/review-report.canonical.yaml"), "review-report"],
    [path.join(workspaceRoot, "examples/reports/live-run-event.canonical.yaml"), "live-run-event"],
    [path.join(workspaceRoot, "examples/reports/incident-report.canonical.yaml"), "incident-report"],
    [path.join(workspaceRoot, "examples/reports/learning-loop-scorecard.canonical.yaml"), "learning-loop-scorecard"],
    [path.join(workspaceRoot, "examples/reports/learning-loop-handoff.canonical.yaml"), "learning-loop-handoff"],
  ];

  for (const [filePath, family] of examples) {
    const loaded = loadContractFile({ filePath, family });
    assert.equal(loaded.ok, true, `expected ${family} canonical example to load`);
  }
});

test("W23 nested validators reject invalid nested shapes deterministically", () => {
  const artifactPacket = loadContractFile({
    filePath: path.join(workspaceRoot, "examples/packets/artifact-packet.canonical.yaml"),
    family: "artifact-packet",
  });
  assert.equal(artifactPacket.ok, true);
  const invalidArtifactPacket = structuredClone(artifactPacket.document);
  invalidArtifactPacket.invocation_context.mission_id = 42;
  assertValidationIssue(
    validateContractDocument({
      family: "artifact-packet",
      document: invalidArtifactPacket,
      source: "test://w23-artifact-packet-invalid-nested",
    }),
    "field_type_mismatch",
    "invocation_context.mission_id",
  );

  const stepResult = loadContractFile({
    filePath: path.join(workspaceRoot, "examples/reports/step-result.canonical.yaml"),
    family: "step-result",
  });
  assert.equal(stepResult.ok, true);
  const invalidStepResult = structuredClone(stepResult.document);
  invalidStepResult.requested_interaction.answer_text = "sensitive answer";
  assertValidationIssue(
    validateContractDocument({
      family: "step-result",
      document: invalidStepResult,
      source: "test://w23-step-result-raw-answer",
    }),
    "unsupported_field_present",
    "requested_interaction.answer_text",
  );
  const invalidInteractionHistory = structuredClone(stepResult.document);
  invalidInteractionHistory.requested_interaction.state_history[0].status = "waiting";
  assertValidationIssue(
    validateContractDocument({
      family: "step-result",
      document: invalidInteractionHistory,
      source: "test://w24-step-result-invalid-interaction-state-history",
    }),
    "enum_value_invalid",
    "requested_interaction.state_history[0].status",
  );
  const invalidInteractionHistoryAnswer = structuredClone(stepResult.document);
  invalidInteractionHistoryAnswer.requested_interaction.state_history[0].answer_text = "sensitive answer";
  assertValidationIssue(
    validateContractDocument({
      family: "step-result",
      document: invalidInteractionHistoryAnswer,
      source: "test://w24-step-result-state-history-raw-answer",
    }),
    "unsupported_field_present",
    "requested_interaction.state_history[0].answer_text",
  );

  const validationReport = loadContractFile({
    filePath: path.join(workspaceRoot, "examples/reports/validation-report.canonical.yaml"),
    family: "validation-report",
  });
  assert.equal(validationReport.ok, true);
  const invalidValidationReport = structuredClone(validationReport.document);
  invalidValidationReport.validators[0].status = "green";
  assertValidationIssue(
    validateContractDocument({
      family: "validation-report",
      document: invalidValidationReport,
      source: "test://w23-validation-report-invalid-status",
    }),
    "enum_value_invalid",
    "validators[0].status",
  );

  const reviewReport = loadContractFile({
    filePath: path.join(workspaceRoot, "examples/reports/review-report.canonical.yaml"),
    family: "review-report",
  });
  assert.equal(reviewReport.ok, true);
  const invalidReviewReport = structuredClone(reviewReport.document);
  invalidReviewReport.findings[0].evidence_refs = "evidence://contracts/w23-s01/not-array";
  assertValidationIssue(
    validateContractDocument({
      family: "review-report",
      document: invalidReviewReport,
      source: "test://w23-review-report-invalid-finding-evidence",
    }),
    "field_type_mismatch",
    "findings[0].evidence_refs",
  );

  const liveRunEvent = loadContractFile({
    filePath: path.join(workspaceRoot, "examples/reports/live-run-event.canonical.yaml"),
    family: "live-run-event",
  });
  assert.equal(liveRunEvent.ok, true);
  const invalidLiveRunEvent = structuredClone(liveRunEvent.document);
  invalidLiveRunEvent.payload.sequence = "1";
  assertValidationIssue(
    validateContractDocument({
      family: "live-run-event",
      document: invalidLiveRunEvent,
      source: "test://w23-live-run-event-invalid-sequence",
    }),
    "field_type_mismatch",
    "payload.sequence",
  );
  const invalidLiveRunEventContinuation = structuredClone(liveRunEvent.document);
  delete invalidLiveRunEventContinuation.payload.interaction.continuation.next_action;
  assertValidationIssue(
    validateContractDocument({
      family: "live-run-event",
      document: invalidLiveRunEventContinuation,
      source: "test://w24-live-run-event-invalid-continuation",
    }),
    "required_field_missing",
    "payload.interaction.continuation.next_action",
  );

  const incidentReport = loadContractFile({
    filePath: path.join(workspaceRoot, "examples/reports/incident-report.canonical.yaml"),
    family: "incident-report",
  });
  assert.equal(incidentReport.ok, true);
  const invalidIncidentReport = structuredClone(incidentReport.document);
  invalidIncidentReport.recertification.platform_recertification.rollback_required = "true";
  assertValidationIssue(
    validateContractDocument({
      family: "incident-report",
      document: invalidIncidentReport,
      source: "test://w23-incident-report-invalid-rollback",
    }),
    "field_type_mismatch",
    "recertification.platform_recertification.rollback_required",
  );

  const scorecard = loadContractFile({
    filePath: path.join(workspaceRoot, "examples/reports/learning-loop-scorecard.canonical.yaml"),
    family: "learning-loop-scorecard",
  });
  assert.equal(scorecard.ok, true);
  const invalidScorecard = structuredClone(scorecard.document);
  invalidScorecard.matrix_cell.scenario_family = "unknown";
  assertValidationIssue(
    validateContractDocument({
      family: "learning-loop-scorecard",
      document: invalidScorecard,
      source: "test://w23-scorecard-invalid-scenario",
    }),
    "enum_value_invalid",
    "matrix_cell.scenario_family",
  );

  const handoff = loadContractFile({
    filePath: path.join(workspaceRoot, "examples/reports/learning-loop-handoff.canonical.yaml"),
    family: "learning-loop-handoff",
  });
  assert.equal(handoff.ok, true);
  const invalidHandoff = structuredClone(handoff.document);
  invalidHandoff.coverage_follow_up.remaining_required_matrix_cells[0] = "not-a-cell";
  assertValidationIssue(
    validateContractDocument({
      family: "learning-loop-handoff",
      document: invalidHandoff,
      source: "test://w23-handoff-invalid-remaining-cell",
    }),
    "field_type_mismatch",
    "coverage_follow_up.remaining_required_matrix_cells[0]",
  );
});

test("contract index mapping covers every docs/contracts/00-index entry", () => {
  const contractsIndexPath = path.join(workspaceRoot, "docs/contracts/00-index.md");
  const contractsIndexContent = fs.readFileSync(contractsIndexPath, "utf8");
  const expectedContractDocs = [...contractsIndexContent.matchAll(/- `([^`]+\.md)`/g)].map((match) => match[1]);

  const familyIndex = getContractFamilyIndex();

  for (const contractDoc of expectedContractDocs) {
    const covered = familyIndex.find((entry) => path.basename(entry.sourceContract) === contractDoc);
    assert.ok(covered, `expected mapping for ${contractDoc}`);
    assert.ok(
      covered.status === "implemented" || covered.status === "limitation",
      `expected ${contractDoc} to be implemented or limitation`,
    );
  }

  const controlPlaneEntry = familyIndex.find((entry) => entry.family === "control-plane-api");
  assert.ok(controlPlaneEntry, "expected control-plane-api in family index");
  assert.equal(controlPlaneEntry.status, "implemented");
  assert.equal(controlPlaneEntry.exampleGlob, "examples/control-plane-api/*.yaml");
});
