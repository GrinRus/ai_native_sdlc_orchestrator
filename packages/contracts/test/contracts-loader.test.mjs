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

test("loads all examples through the shared contracts path", () => {
  const examplesRoot = path.join(workspaceRoot, "examples");
  const expectedYamlCount = listYamlFiles(examplesRoot).length;

  const loaded = loadExampleContracts({ workspaceRoot });
  const failed = loaded.results.filter((result) => !result.ok);

  assert.equal(loaded.results.length, expectedYamlCount, "all YAML examples should be processed");
  assert.equal(failed.length, 0, `expected no validation failures, got ${failed.length}`);
  assert.equal(loaded.ok, true, "batch example loading should pass");
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

test("returns explicit limitation for unsupported narrative-only contract families", () => {
  const validation = validateContractDocument({
    family: "control-plane-api",
    document: {},
    source: "docs/contracts/control-plane-api.md",
  });

  assert.equal(validation.ok, false);
  const limitationIssue = validation.issues.find((problem) => problem.code === "contract_family_limitation");
  assert.ok(limitationIssue, "expected contract_family_limitation issue");
  assert.ok(
    limitationIssue.message.includes("TODO"),
    "expected limitation issue to include explicit TODO guidance",
  );
});

test("live-e2e profile requires preflight block", () => {
  const source = path.join(workspaceRoot, "examples/live-e2e/regress-short.yaml");
  const loaded = loadContractFile({ filePath: source, family: "live-e2e-profile" });
  assert.equal(loaded.ok, true, "fixture should load before mutation");

  const candidate = structuredClone(loaded.document);
  delete candidate.preflight;

  const validation = validateContractDocument({
    family: "live-e2e-profile",
    document: candidate,
    source: "test://live-e2e-missing-preflight",
  });

  assert.equal(validation.ok, false);
  assert.ok(
    validation.issues.some((problem) => problem.code === "required_field_missing" && problem.field === "preflight"),
    "expected required field error for preflight",
  );
});

test("live-e2e profile preflight block must be an object", () => {
  const source = path.join(workspaceRoot, "examples/live-e2e/regress-short.yaml");
  const loaded = loadContractFile({ filePath: source, family: "live-e2e-profile" });
  assert.equal(loaded.ok, true, "fixture should load before mutation");

  const candidate = structuredClone(loaded.document);
  candidate.preflight = "no-write";

  const validation = validateContractDocument({
    family: "live-e2e-profile",
    document: candidate,
    source: "test://live-e2e-preflight-type",
  });

  assert.equal(validation.ok, false);
  const mismatchIssue = validation.issues.find(
    (problem) => problem.code === "field_type_mismatch" && problem.field === "preflight",
  );
  assert.ok(mismatchIssue, "expected field_type_mismatch for preflight");
  assert.equal(mismatchIssue.expected, "object");
  assert.equal(mismatchIssue.actual, "string");
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
  assert.equal(controlPlaneEntry.status, "limitation");
});
