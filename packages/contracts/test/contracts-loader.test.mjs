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

test("artifact workflow prompt bundles validate as artifact execution prompts", () => {
  const expected = {
    discovery: {
      ref: "prompt-bundle://discovery-default@v1",
      fileName: "discovery-default.yaml",
      requiredPackets: ["step-input-context"],
    },
    research: {
      ref: "prompt-bundle://research-default@v1",
      fileName: "research-default.yaml",
      requiredPackets: ["discovery"],
    },
    spec: {
      ref: "prompt-bundle://spec-default@v1",
      fileName: "spec-default.yaml",
      requiredPackets: ["discovery", "research"],
    },
  };

  const projectProfile = loadContractFile({
    filePath: path.join(workspaceRoot, "examples/project.aor.yaml"),
    family: "project-profile",
  });
  assert.equal(projectProfile.ok, true, "project profile should load as project-profile");
  const defaultPromptBundles = /** @type {Record<string, string>} */ (projectProfile.document.default_prompt_bundles);
  assert.equal(new Set(Object.values(expected).map((entry) => entry.ref)).size, 3);

  for (const [step, metadata] of Object.entries(expected)) {
    assert.equal(defaultPromptBundles[step], metadata.ref);
    const prompt = loadContractFile({
      filePath: path.join(workspaceRoot, "examples/prompts", metadata.fileName),
      family: "prompt-bundle",
    });
    assert.equal(prompt.ok, true, `${metadata.fileName} should load as prompt-bundle`);
    assert.equal(prompt.document.step_class, "artifact");
    const requiredInputs = /** @type {Record<string, unknown>} */ (prompt.document.required_inputs);
    const packets = /** @type {Record<string, unknown>} */ (requiredInputs.packets);
    assert.deepEqual(packets.required, metadata.requiredPackets);
  }
});

test("verification archetype profile documents migration command-group examples", () => {
  const loaded = loadContractFile({
    filePath: path.join(workspaceRoot, "examples/project.verification-archetypes.aor.yaml"),
    family: "project-profile",
  });
  assert.equal(loaded.ok, true, "verification archetype profile should load as project-profile");

  const verification = /** @type {Record<string, unknown>} */ (loaded.document.verification);
  const groups = /** @type {Array<Record<string, unknown>>} */ (verification.command_groups);
  const roles = new Set(groups.map((group) => group.role));
  assert.ok(roles.has("setup"));
  assert.ok(roles.has("build"));
  assert.ok(roles.has("lint"));
  assert.ok(roles.has("test"));
  assert.ok(roles.has("e2e"));
  assert.ok(roles.has("full-suite"));

  const browserGroup = groups.find((group) => group.id === "browser-app-post-change-e2e");
  assert.ok(browserGroup, "expected browser e2e command group");
  assert.equal(browserGroup?.enforcement, "warn");
  assert.equal(browserGroup?.timeout_class, "browser-e2e");
  assert.equal(/** @type {Record<string, unknown>} */ (browserGroup?.skip_policy).outcome, "missing-tool");

  const fullSuiteGroup = groups.find((group) => group.id === "workspace-post-change-full-suite");
  assert.ok(fullSuiteGroup, "expected workspace full-suite command group");
  assert.equal(fullSuiteGroup?.enforcement, "observe");

  const baselineGroup = groups.find((group) => group.id === "legacy-service-baseline-test");
  assert.ok(baselineGroup, "expected legacy-service baseline command group");
  assert.equal(baselineGroup?.phase, "baseline");
  assert.equal(/** @type {Record<string, unknown>} */ (baselineGroup?.skip_policy).outcome, "broken-baseline");

  const outcomes = /** @type {Array<Record<string, unknown>>} */ (verification.discovery_outcomes);
  assert.equal(outcomes.some((outcome) => outcome.outcome === "no-tests" && outcome.working_dir === "docs"), true);
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

test("project profile validates verification command group enums", () => {
  const source = path.join(workspaceRoot, "examples/project.github.aor.yaml");
  const loaded = loadContractFile({ filePath: source, family: "project-profile" });
  assert.equal(loaded.ok, true, "fixture should load before mutation");

  const candidate = structuredClone(loaded.document);
  candidate.verification.command_groups[0].role = "live-e2e-diagnostic";

  assertValidationIssue(
    validateContractDocument({
      family: "project-profile",
      document: candidate,
      source: "test://invalid-verification-command-group-role",
    }),
    "enum_value_invalid",
    "verification.command_groups[0].role",
  );
});

test("verification command groups accept W54 authoring metadata", () => {
  const source = path.join(workspaceRoot, "examples/project.github.aor.yaml");
  const loaded = loadContractFile({ filePath: source, family: "project-profile" });
  assert.equal(loaded.ok, true, "fixture should load before mutation");

  const candidate = structuredClone(loaded.document);
  candidate.verification.command_groups[0] = {
    ...candidate.verification.command_groups[0],
    repo_id: "target",
    working_dir: "packages/app",
    depends_on: ["setup-readiness"],
    detected_from: ["package.json#scripts.test"],
    package_manager: "pnpm",
    tool_requirements: [
      {
        tool: "node",
        version_range: ">=22",
        install_hint: "Use the project-pinned Node runtime.",
      },
    ],
    skip_policy: {
      outcome: "no-tests",
      applies_when: "No test script is declared.",
      reason: "No synthetic passing test command should be invented.",
    },
  };

  const validation = validateContractDocument({
    family: "project-profile",
    document: candidate,
    source: "test://w54-command-group-authoring-fields",
  });

  assert.equal(validation.ok, true);
});

test("verification command groups reject private proof-harness fields", () => {
  const source = path.join(workspaceRoot, "examples/project.github.aor.yaml");
  const loaded = loadContractFile({ filePath: source, family: "project-profile" });
  assert.equal(loaded.ok, true, "fixture should load before mutation");

  const candidate = structuredClone(loaded.document);
  candidate.verification.command_groups[0].target_readiness = {
    owner: "live-e2e",
  };

  assertValidationIssue(
    validateContractDocument({
      family: "project-profile",
      document: candidate,
      source: "test://private-proof-harness-command-group-field",
    }),
    "unsupported_field_present",
    "verification.command_groups[0].target_readiness",
  );
});

test("step result validates generic command group outcomes", () => {
  const source = path.join(workspaceRoot, "examples/reports/step-result.verify-missing-tool.yaml");
  const loaded = loadContractFile({ filePath: source, family: "step-result" });
  assert.equal(loaded.ok, true, "fixture should load before mutation");

  const candidate = structuredClone(loaded.document);
  candidate.command_group_outcome = "live-e2e-blocked";

  assertValidationIssue(
    validateContractDocument({
      family: "step-result",
      document: candidate,
      source: "test://invalid-command-group-outcome",
    }),
    "enum_value_invalid",
    "command_group_outcome",
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

test("compiled-context artifact requires budget and compaction reports", () => {
  const loaded = loadContractFile({
    filePath: path.join(workspaceRoot, "examples/context/compiled/implement-runner-default.sample.yaml"),
    family: "compiled-context-artifact",
  });
  assert.equal(loaded.ok, true, "expected compiled-context sample to load");

  const missingBudget = structuredClone(loaded.document);
  delete missingBudget.budget_report;

  const missingBudgetValidation = validateContractDocument({
    family: "compiled-context-artifact",
    document: missingBudget,
    source: "test://compiled-context-missing-budget",
  });

  assertValidationIssue(missingBudgetValidation, "required_field_missing", "budget_report");

  const invalidSourceBreakdown = structuredClone(loaded.document);
  invalidSourceBreakdown.budget_report.source_breakdown = [{ source: "context" }];

  const invalidBreakdownValidation = validateContractDocument({
    family: "compiled-context-artifact",
    document: invalidSourceBreakdown,
    source: "test://compiled-context-invalid-breakdown",
  });

  assertValidationIssue(invalidBreakdownValidation, "required_field_missing", "budget_report.source_breakdown[0].bytes");
});

test("adapter capability profile rejects unrestricted stdin-json for external-process adapters", () => {
  const invalidProfile = {
    adapter_id: "test-live-adapter",
    version: 1,
    capabilities: {},
    constraints: {},
    execution: {
      runtime_mode: "external-process",
      external_runtime: {
        command: "node",
        request_transport: "stdin-json",
      },
    },
  };

  const invalidValidation = validateContractDocument({
    family: "adapter-capability-profile",
    document: invalidProfile,
    source: "test://adapter-stdin-json-unscoped",
  });

  assertValidationIssue(
    invalidValidation,
    "required_field_missing",
    "execution.external_runtime.stdin_json_scope",
  );

  const validProfile = structuredClone(invalidProfile);
  validProfile.execution.external_runtime.stdin_json_scope = "test-only";

  const validValidation = validateContractDocument({
    family: "adapter-capability-profile",
    document: validProfile,
    source: "test://adapter-stdin-json-test-only",
  });

  assert.equal(validValidation.ok, true);
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
  assert.deepEqual(loaded.document.repair_context, {
    source_phase: "none",
    cycle_iteration: 0,
    unresolved_findings: [],
    unresolved_finding_details: [],
    meaningful_changed_paths: [],
	    verification_status: "pass",
	    verification_refs: [],
	    previous_repair_decision_refs: [],
	    context_fingerprint: "none",
	    new_context_since_previous: [],
	    stop_reason: "none",
	    requested_next_step: "none",
	  });

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

  const missingRepairContext = structuredClone(loaded.document);
  delete missingRepairContext.repair_context;
  assertValidationIssue(
    validateContractDocument({
      family: "review-decision",
      document: missingRepairContext,
      source: "test://review-decision-missing-repair-context",
    }),
    "required_field_missing",
    "repair_context",
  );

  const invalidRepair = structuredClone(loaded.document);
  invalidRepair.decision = "request-repair";
  invalidRepair.repair_context = {
    source_phase: "none",
    cycle_iteration: 0,
    unresolved_findings: [],
    unresolved_finding_details: [],
    meaningful_changed_paths: [],
    verification_status: "not_pass",
    verification_refs: [],
    previous_repair_decision_refs: [],
    context_fingerprint: "",
    new_context_since_previous: [],
    stop_reason: "",
    requested_next_step: "none",
  };
  const invalidRepairValidation = validateContractDocument({
    family: "review-decision",
    document: invalidRepair,
    source: "test://review-decision-invalid-repair-context",
  });
  assert.equal(invalidRepairValidation.ok, false);
  assert.ok(
    invalidRepairValidation.issues.some(
      (problem) => problem.code === "enum_value_invalid" && problem.field === "repair_context.source_phase",
    ),
    "expected request-repair decisions to require a supported repair source phase",
  );
  assert.ok(
    invalidRepairValidation.issues.some(
      (problem) => problem.code === "required_field_missing" && problem.field === "repair_context.unresolved_findings",
    ),
    "expected request-repair decisions to preserve unresolved findings",
  );
  assert.ok(
    invalidRepairValidation.issues.some(
      (problem) => problem.code === "required_field_missing" && problem.field === "repair_context.context_fingerprint",
    ),
    "expected request-repair decisions to preserve a context fingerprint",
  );
  assert.ok(
    invalidRepairValidation.issues.some(
      (problem) => problem.code === "required_field_missing" && problem.field === "repair_context.unresolved_finding_details",
    ),
    "expected request-repair decisions to preserve structured unresolved finding details",
  );

  const validRepair = structuredClone(loaded.document);
  validRepair.decision = "request-repair";
  validRepair.repair_context = {
    source_phase: "qa",
    cycle_iteration: 2,
    unresolved_findings: ["QA evaluation found a regression that requires another implementation iteration."],
    unresolved_finding_details: [
      {
        finding_id: "qa.evaluation-status",
        category: "qa",
        severity: "blocking",
        summary: "QA evaluation found a regression that requires another implementation iteration.",
        evidence_refs: [loaded.document.review_report_ref],
        resolution_requirement: "Repair the regression or provide fresh evidence that the QA finding is stale.",
      },
    ],
    meaningful_changed_paths: ["src/client.py", "tests/test_client.py"],
    verification_status: "fail",
    verification_refs: [loaded.document.review_report_ref],
    previous_repair_decision_refs: [],
    context_fingerprint: "sha256:valid-qa-repair-context",
    new_context_since_previous: ["first-repair-decision"],
    stop_reason: "QA failed after a passing review.",
    requested_next_step: "execution",
  };
  const validRepairValidation = validateContractDocument({
    family: "review-decision",
    document: validRepair,
    source: "test://review-decision-valid-qa-repair-context",
  });
  assert.equal(validRepairValidation.ok, true, JSON.stringify(validRepairValidation.issues, null, 2));

  const repeatedRepair = structuredClone(validRepair);
  repeatedRepair.repair_context.previous_repair_decision_refs = ["evidence://reports/review-decision-1.json"];
  repeatedRepair.repair_context.new_context_since_previous = [];
  assertValidationIssue(
    validateContractDocument({
      family: "review-decision",
      document: repeatedRepair,
      source: "test://review-decision-repeated-repair-without-new-context",
    }),
    "required_field_missing",
    "repair_context.new_context_since_previous",
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

test("control-plane API baseline documents W34 flow projection examples", () => {
  const source = path.join(workspaceRoot, "examples/control-plane-api/module-surface-baseline.yaml");
  const loaded = loadContractFile({ filePath: source, family: "control-plane-api" });
  assert.equal(loaded.ok, true, "fixture should load before assertions");

  const contract = loaded.document.flow_projection_contract;
  assert.equal(contract?.owning_slice, "W34-S02");
  assert.equal(contract?.status, "implemented-read-baseline");
  assert.ok(contract?.projection_fields?.includes("flow_id"), "expected stable flow id field");
  assert.ok(contract?.projection_fields?.includes("follow_up_source_handoff_ref"), "expected follow-up lineage field");
  assert.ok(contract?.projection_fields?.includes("closure_state"), "expected closure projection field");
  assert.ok(contract?.projection_fields?.includes("mission_settings"), "expected duplicate mission settings field");
  assert.ok(
    contract?.read_models?.some((entry) => entry.route === "GET /api/projects/:projectId/flows"),
    "expected implemented flow list route",
  );
  assert.equal(contract?.lifecycle_semantics?.new_flow?.creates_fresh_intake, true);
  assert.equal(contract?.lifecycle_semantics?.new_flow?.archives_mission_next_action_report, true);
  assert.equal(contract?.lifecycle_semantics?.new_flow?.mutates_completed_source_flow, false);
  assert.equal(contract?.lifecycle_semantics?.follow_up_flow?.source_flow_read_only, true);
  assert.equal(contract?.lifecycle_semantics?.follow_up_flow?.duplicate_settings_create_fresh_intake, true);

  const examples = contract?.example_payloads ?? {};
  assert.equal(examples.active_flow?.status, "active");
  assert.equal(examples.completed_flow?.completed_read_only, true);
  assert.equal(examples.completed_flow?.closure_state?.follow_up_eligible, true);
  assert.ok(
    examples.follow_up_flow?.follow_up_source_handoff_ref,
    "expected follow-up flow example to cite source handoff",
  );
  assert.equal(examples.flow_targeted_operator_request_summary?.target_flow_id, examples.active_flow?.flow_id);
  assert.equal(examples.completed_flow_mutation_block?.error_code, "operator_request.completed_flow_read_only");
});

test("operator-request examples may target a W34 flow projection", () => {
  const source = path.join(workspaceRoot, "examples/reports/operator-request.flow-target.yaml");
  const loaded = loadContractFile({ filePath: source, family: "operator-request" });
  assert.equal(loaded.ok, true, "expected flow-targeted operator-request example to load");
  assert.equal(loaded.document.target_flow_id, "flow.aor-core.checkout-risk");
  assert.equal(loaded.document.delivery_mode, "no-write");
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
  const missingVerificationCoverageReport = structuredClone(reviewReport.document);
  delete missingVerificationCoverageReport.artifact_quality.verification_coverage;
  assertValidationIssue(
    validateContractDocument({
      family: "review-report",
      document: missingVerificationCoverageReport,
      source: "test://w50-review-report-missing-verification-coverage",
    }),
    "required_field_missing",
    "artifact_quality.verification_coverage",
  );
  const invalidReviewTraceability = structuredClone(reviewReport.document);
  invalidReviewTraceability.feature_traceability.required_path_prefixes = ["source/", 42];
  assertValidationIssue(
    validateContractDocument({
      family: "review-report",
      document: invalidReviewTraceability,
      source: "test://w35-review-report-invalid-required-path-prefix",
    }),
    "field_type_mismatch",
    "feature_traceability.required_path_prefixes[1]",
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
