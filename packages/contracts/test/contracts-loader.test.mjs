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
    loaded.document.interactive_continuation?.audit_behavior?.query_safe_refs?.includes("answer_audit_ref"),
    "expected answer audit refs to be query-safe",
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

  const nestedCandidate = structuredClone(loaded.document);
  nestedCandidate.step_matrix[0].status = "fail";
  nestedCandidate.artifact_quality_matrix[0].status = "fail";
  nestedCandidate.code_quality_after_delivery.status = "fail";

  const nestedValidation = validateContractDocument({
    family: "live-e2e-observation-report",
    document: nestedCandidate,
    source: "test://live-e2e-observation-invalid-nested-status",
  });

  assert.equal(nestedValidation.ok, false);
  for (const field of [
    "step_matrix[0].status",
    "artifact_quality_matrix[0].status",
    "code_quality_after_delivery.status",
  ]) {
    assert.ok(
      nestedValidation.issues.some((problem) => problem.code === "enum_value_invalid" && problem.field === field),
      `expected enum_value_invalid for ${field}`,
    );
  }
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
