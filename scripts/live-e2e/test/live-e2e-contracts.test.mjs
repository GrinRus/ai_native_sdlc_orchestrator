import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import {
  loadContractFile,
  validateLiveE2eCatalogReferences,
} from "../lib/contracts/index.mjs";

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
    if (!current) continue;
    for (const dirent of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, dirent.name);
      if (dirent.isDirectory()) {
        pending.push(entryPath);
        continue;
      }
      if (dirent.isFile() && /\.ya?ml$/iu.test(dirent.name)) {
        files.push(entryPath);
      }
    }
  }

  return files.sort();
}

/**
 * @param {string} root
 * @param {string} family
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
 * @template T
 * @param {(tempRoot: string) => T} callback
 * @returns {T}
 */
function withTempWorkspace(callback) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-live-e2e-contracts-"));
  fs.cpSync(path.join(workspaceRoot, "examples"), path.join(tempRoot, "examples"), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, "scripts/live-e2e"), { recursive: true });
  fs.cpSync(path.join(workspaceRoot, "scripts/live-e2e/catalog"), path.join(tempRoot, "scripts/live-e2e/catalog"), {
    recursive: true,
  });

  try {
    return callback(tempRoot);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

/**
 * @param {string} tempRoot
 * @param {string} relativeFilePath
 * @param {(document: Record<string, unknown>) => void} mutate
 */
function mutateYamlFile(tempRoot, relativeFilePath, mutate) {
  const filePath = path.join(tempRoot, relativeFilePath);
  const content = fs.readFileSync(filePath, "utf8");
  const document = parseYaml(content);
  mutate(document);
  fs.writeFileSync(filePath, stringifyYaml(document), "utf8");
}

test("live e2e private catalog documents validate through the private loader", () => {
  assertDirectoryContractsLoad(
    path.join(workspaceRoot, "scripts/live-e2e/catalog/providers"),
    "live-e2e-provider-variant",
  );
  assertDirectoryContractsLoad(
    path.join(workspaceRoot, "scripts/live-e2e/catalog/scenarios"),
    "live-e2e-scenario-policy",
  );
  assertDirectoryContractsLoad(
    path.join(workspaceRoot, "scripts/live-e2e/catalog/targets"),
    "live-e2e-target-catalog",
  );
});

test("live e2e private report fixtures validate from the private fixture root", () => {
  const fixtureRoot = path.join(workspaceRoot, "scripts/live-e2e/fixtures/contracts");
  const fixtureFamilies = [
    ["live-e2e-observation-report", /^live-e2e-observation-report/u],
    ["live-e2e-run-health-report", /^live-e2e-run-health-report/u],
    ["live-e2e-quality-assessment-report", /^live-e2e-quality-assessment-report/u],
    ["live-e2e-step-quality-assessment-request", /^live-e2e-step-quality-assessment-request/u],
    ["live-e2e-step-quality-assessment-report", /^live-e2e-step-quality-assessment-report/u],
  ];

  for (const [family, regex] of fixtureFamilies) {
    const files = listYamlFiles(fixtureRoot).filter((filePath) => regex.test(path.basename(filePath)));
    assert.ok(files.length > 0, `expected fixtures for ${family}`);
    for (const filePath of files) {
      const explicitLoaded = loadContractFile({ filePath, family });
      assert.equal(explicitLoaded.ok, true, `${path.relative(workspaceRoot, filePath)} should load as ${family}`);

      const inferredLoaded = loadContractFile({ filePath });
      assert.equal(inferredLoaded.ok, true, `${path.relative(workspaceRoot, filePath)} should infer ${family}`);
      assert.equal(inferredLoaded.family, family);
    }
  }
});

test("live e2e provider catalog required variants point at live-runnable adapters", () => {
  const result = validateLiveE2eCatalogReferences({ workspaceRoot });
  assert.equal(result.ok, true, "expected live E2E provider catalog references to pass");
  assert.equal(result.issues.length, 0, "expected zero live E2E catalog reference issues");
  assert.ok(result.checkedReferences >= 3, "expected provider variants to be checked");
  assert.ok(result.checkedCompatibility >= 2, "expected required provider live-runtime compatibility checks");
});

test("live e2e provider catalog rejects required variants without adapter execution runtime", () => {
  withTempWorkspace((tempRoot) => {
    mutateYamlFile(tempRoot, "examples/adapters/claude-code.yaml", (document) => {
      delete document.execution;
    });

    const result = validateLiveE2eCatalogReferences({ workspaceRoot: tempRoot });
    assert.equal(result.ok, false);

    const issue = result.issues.find(
      (candidate) =>
        candidate.code === "reference_target_incompatible" &&
        candidate.field === "primary_adapter" &&
        candidate.reference === "claude-code",
    );
    assert.ok(issue, "expected required anthropic provider adapter runtime compatibility issue");
  });
});

test("live e2e provider catalog keeps mandatory primary providers live-runnable independent of coverage tier", () => {
  withTempWorkspace((tempRoot) => {
    mutateYamlFile(tempRoot, "scripts/live-e2e/catalog/providers/openai-primary.yaml", (document) => {
      document.coverage_tier = "extended";
    });
    mutateYamlFile(tempRoot, "examples/adapters/codex-cli.yaml", (document) => {
      delete document.execution;
    });

    const result = validateLiveE2eCatalogReferences({ workspaceRoot: tempRoot });
    assert.equal(result.ok, false);

    const issue = result.issues.find(
      (candidate) =>
        candidate.code === "reference_target_incompatible" &&
        candidate.field === "primary_adapter" &&
        candidate.reference === "codex-cli",
    );
    assert.ok(issue, "expected mandatory openai-primary adapter runtime compatibility issue");
  });
});

test("live e2e provider catalog rejects promoted OpenCode without permission policy", () => {
  withTempWorkspace((tempRoot) => {
    mutateYamlFile(tempRoot, "scripts/live-e2e/catalog/providers/open-code-primary.yaml", (document) => {
      document.coverage_tier = "required";
    });
    mutateYamlFile(tempRoot, "examples/adapters/open-code.yaml", (document) => {
      const execution = /** @type {Record<string, unknown>} */ (document.execution);
      execution.live_baseline = true;
      document.certification_state = "stable";
    });
    mutateYamlFile(tempRoot, "examples/adapters/open-code.yaml", (document) => {
      const execution = /** @type {Record<string, unknown>} */ (document.execution);
      const externalRuntime = /** @type {Record<string, unknown>} */ (execution.external_runtime);
      delete externalRuntime.permission_policy;
    });

    const result = validateLiveE2eCatalogReferences({ workspaceRoot: tempRoot });
    assert.equal(result.ok, false);

    const issue = result.issues.find(
      (candidate) =>
        candidate.code === "reference_target_incompatible" &&
        candidate.field === "primary_adapter" &&
        candidate.reference === "open-code",
    );
    assert.ok(issue, "expected promoted OpenCode adapter permission policy compatibility issue");
  });
});

test("live e2e provider catalog rejects missing mandatory primary providers", () => {
  withTempWorkspace((tempRoot) => {
    fs.rmSync(path.join(tempRoot, "scripts/live-e2e/catalog/providers/anthropic-primary.yaml"));

    const result = validateLiveE2eCatalogReferences({ workspaceRoot: tempRoot });
    assert.equal(result.ok, false);

    const issue = result.issues.find(
      (candidate) =>
        candidate.code === "reference_target_missing" &&
        candidate.field === "provider_variant_id" &&
        candidate.reference === "anthropic-primary",
    );
    assert.ok(issue, "expected missing mandatory anthropic-primary provider catalog issue");
  });
});
