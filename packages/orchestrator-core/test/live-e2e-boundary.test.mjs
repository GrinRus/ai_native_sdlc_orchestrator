import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { verifyProjectRuntime } from "../src/project-verify.mjs";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const workspaceRoot = path.resolve(currentDir, "../../..");
const privateHarnessToken = ["live", "e2e"].join("-");
const privateHarnessUnderscoreToken = ["live", "e2e"].join("_");
const manualPrivateHarnessToken = ["manual", privateHarnessToken].join("-");
const privateHarnessSpaceToken = ["live", "E2E"].join(" ");
const proofRunnerToken = ["proof", "runner"].join("-");
const proofRunnerUnderscoreToken = ["proof", "runner"].join("_");
const proofRunnerSpaceToken = ["proof", "runner"].join(" ");
const publicBoundaryFilePattern = /\.(?:mjs|js|jsx|ts|tsx|json|md|ya?ml|css|html)$/u;
const forbiddenPatterns = [
  { label: "private harness path", pattern: new RegExp(`scripts/${privateHarnessToken}`, "iu") },
  { label: "private harness field", pattern: new RegExp(`\\b${privateHarnessUnderscoreToken}\\w*`, "iu") },
  { label: "private harness token", pattern: new RegExp(`\\b${privateHarnessToken}\\b`, "iu") },
  { label: "manual private harness token", pattern: new RegExp(`\\b${manualPrivateHarnessToken}\\b`, "iu") },
  { label: "private harness display token", pattern: new RegExp(privateHarnessSpaceToken, "iu") },
  { label: "proof runner token", pattern: new RegExp(`\\b${proofRunnerToken}\\b`, "iu") },
  { label: "proof runner field", pattern: new RegExp(`\\b${proofRunnerUnderscoreToken}\\b`, "iu") },
  { label: "proof runner display token", pattern: new RegExp(proofRunnerSpaceToken, "iu") },
  { label: "target matrix field", pattern: /target_matrix/iu },
  { label: "target readiness field", pattern: /target_readiness/iu },
  { label: "diagnostic health field", pattern: /diagnostic_health/iu },
  { label: "step quality field", pattern: /step_quality/iu },
];
const allowedCliCatalogInternalRehearsalSentence = [
  "Installed-user rehearsal is maintained as internal repo tooling under `scripts/",
  privateHarnessToken,
  "/` and is intentionally excluded from the public CLI catalog.",
].join("");

/**
 * @param {string} value
 * @returns {string[]}
 */
function normalizePath(value) {
  return value.split(path.sep).join(path.posix.sep);
}

/**
 * @returns {string[]}
 */
function listWorkspacePackageSourceRoots() {
  const roots = [];
  for (const base of ["packages"]) {
    const basePath = path.join(workspaceRoot, base);
    if (!fs.existsSync(basePath)) continue;
    for (const entry of fs.readdirSync(basePath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const sourceRoot = path.join(basePath, entry.name, "src");
      if (fs.existsSync(sourceRoot)) roots.push(sourceRoot);
    }
  }
  return roots.sort();
}

/**
 * @returns {string[]}
 */
function publicBoundaryRoots() {
  return [
    path.join(workspaceRoot, "apps"),
    ...listWorkspacePackageSourceRoots(),
    path.join(workspaceRoot, "docs/contracts"),
    path.join(workspaceRoot, "docs/product"),
    path.join(workspaceRoot, "docs/architecture"),
    path.join(workspaceRoot, "docs/ops"),
    path.join(workspaceRoot, "examples"),
    path.join(workspaceRoot, "README.md"),
    path.join(workspaceRoot, "CONTRIBUTING.md"),
    path.join(workspaceRoot, "CHANGELOG.md"),
    path.join(workspaceRoot, "package.json"),
  ];
}

/**
 * @param {string} rootOrFile
 * @returns {string[]}
 */
function collectPublicBoundaryFiles(rootOrFile) {
  /** @type {string[]} */
  const files = [];
  if (!fs.existsSync(rootOrFile)) return files;

  const stat = fs.statSync(rootOrFile);
  if (stat.isFile()) {
    return publicBoundaryFilePattern.test(rootOrFile) ? [rootOrFile] : [];
  }

  const pending = [rootOrFile];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || !fs.existsSync(current)) continue;
    for (const dirent of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, dirent.name);
      if (dirent.isDirectory()) {
        if ([".git", ".aor", "node_modules"].includes(dirent.name)) continue;
        pending.push(entryPath);
        continue;
      }
      if (!dirent.isFile() || !publicBoundaryFilePattern.test(dirent.name)) continue;
      files.push(entryPath);
    }
  }
  return files;
}

/**
 * @param {string} filePath
 * @param {string} content
 * @returns {string}
 */
function stripAllowedPublicBoundaryContent(filePath, content) {
  const relativePath = normalizePath(path.relative(workspaceRoot, filePath));
  if (relativePath === "docs/architecture/14-cli-command-catalog.md") {
    return content.replaceAll(allowedCliCatalogInternalRehearsalSentence, "");
  }
  return content;
}

/**
 * @param {string[]} filePaths
 * @returns {string[]}
 */
function findPrivateHarnessBoundaryViolations(filePaths) {
  const violations = [];
  for (const filePath of filePaths) {
    const relativePath = normalizePath(path.relative(workspaceRoot, filePath));
    const content = stripAllowedPublicBoundaryContent(filePath, fs.readFileSync(filePath, "utf8"));
    for (const { label, pattern } of forbiddenPatterns) {
      pattern.lastIndex = 0;
      if (pattern.test(relativePath) || pattern.test(content)) {
        violations.push(`${relativePath} matched ${label}`);
      }
    }
  }
  return violations.sort();
}

/**
 * @param {unknown} document
 * @param {string} label
 */
function assertNoPrivateHarnessVocabulary(document, label) {
  const serialized = JSON.stringify(document);
  for (const { label: forbiddenLabel, pattern } of forbiddenPatterns) {
    pattern.lastIndex = 0;
    assert.equal(pattern.test(serialized), false, `${label} matched ${forbiddenLabel}`);
  }
}

/**
 * @param {(repoRoot: string) => void} callback
 */
function withTempRepo(callback) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-w54-s08-boundary-"));
  fs.mkdirSync(path.join(repoRoot, ".git"), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, "examples"), { recursive: true });
  fs.copyFileSync(
    path.join(workspaceRoot, "examples/project.aor.yaml"),
    path.join(repoRoot, "examples/project.aor.yaml"),
  );

  try {
    callback(repoRoot);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
}

test("public source, docs, and examples do not expose private harness vocabulary", () => {
  const files = publicBoundaryRoots().flatMap((root) => collectPublicBoundaryFiles(root));
  const violations = findPrivateHarnessBoundaryViolations(files);

  assert.deepEqual(violations, []);
});

test("public boundary scanner rejects an artificial private leak fixture", () => {
  const fixturePath = path.join(currentDir, "fixtures/public-boundary-leak.fixture.md");
  const violations = findPrivateHarnessBoundaryViolations([fixturePath]);

  assert.ok(violations.some((violation) => violation.includes("private harness field")));
  assert.ok(violations.some((violation) => violation.includes("step quality field")));
});

test("AOR verify artifacts do not expose private harness fields", () => {
  withTempRepo((repoRoot) => {
    const profilePath = path.join(repoRoot, "examples/project.aor.yaml");
    const profileContent = fs.readFileSync(profilePath, "utf8");
    const patched = profileContent
      .replace("- pnpm build", "- 'node -e \"process.exit(0)\"'")
      .replace("- pnpm test", "- 'node -e \"process.exit(0)\"'")
      .replace("- pnpm lint", "- 'node -e \"process.exit(0)\"'");
    fs.writeFileSync(profilePath, patched, "utf8");

    const result = verifyProjectRuntime({ projectRef: repoRoot, cwd: repoRoot });
    assert.equal(result.verifySummary.status, "passed");

    assertNoPrivateHarnessVocabulary(result.verifySummary, "verify summary");
    for (const [index, stepResult] of result.stepResults.entries()) {
      assertNoPrivateHarnessVocabulary(stepResult, `step result ${index}`);
    }
    for (const artifactPath of [result.verifySummaryPath, ...result.stepResultFiles]) {
      assertNoPrivateHarnessVocabulary(fs.readFileSync(artifactPath, "utf8"), normalizePath(artifactPath));
    }
  });
});
