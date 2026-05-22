import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const RELEASE_PACKAGE_NAME = "@grinrus/aor";
export const RELEASE_LABEL = "release:publish";
export const RELEASE_VERSION_PATTERN = /^\d+\.\d+\.\d+-alpha\.\d+$/u;
export const RELEASE_BRANCH_PATTERN = /^release\/v(\d+\.\d+\.\d+-alpha\.\d+)$/u;

const REQUIRED_PACKAGE_FILE_PATTERNS = [
  "apps/cli/bin",
  "apps/cli/src",
  "packages/adapter-sdk/src",
  "packages/contracts/src",
  "packages/harness/src",
  "packages/observability/src",
  "packages/orchestrator-core/src",
  "packages/provider-routing/src",
  "examples/project*.aor.yaml",
  "examples/adapters",
  "examples/context",
  "examples/control-plane-api",
  "examples/delivery-manifest*.yaml",
  "examples/eval",
  "examples/packets",
  "examples/policies",
  "examples/project-analysis-report.sample.yaml",
  "examples/prompts",
  "examples/reports",
  "examples/routes",
  "examples/skills",
  "examples/wrappers",
  "docs/contracts",
  "docs/ops/npm-cli-alpha-release.md",
  "docs/ops/production-readiness-gate.md",
  "docs/ops/self-hosted-release.md",
  "CHANGELOG.md",
  "README.md",
  "LICENSE",
];

const REQUIRED_PACKED_FILES = [
  "package.json",
  "README.md",
  "LICENSE",
  "CHANGELOG.md",
  "apps/cli/bin/aor.mjs",
  "apps/cli/src/index.mjs",
  "packages/orchestrator-core/src/project-init.mjs",
  "packages/orchestrator-core/src/operator-cli/index.mjs",
  "packages/contracts/src/index.mjs",
  "packages/provider-routing/src/route-resolution.mjs",
  "packages/adapter-sdk/src/index.mjs",
  "packages/harness/src/capture-format.mjs",
  "packages/observability/src/index.mjs",
  "examples/project.aor.yaml",
  "examples/routes/implement-default.yaml",
  "examples/wrappers/wrapper-runner-default.yaml",
  "docs/contracts/00-index.md",
  "docs/ops/npm-cli-alpha-release.md",
];

const FORBIDDEN_PACKED_PATHS = [
  /^\.aor(?:\/|$)/u,
  /^\.github(?:\/|$)/u,
  /^node_modules(?:\/|$)/u,
  /^scripts(?:\/|$)/u,
  /^examples\/live-e2e(?:\/|$)/u,
  /(?:^|\/)target-checkouts(?:\/|$)/u,
  /(?:^|\/)\.env(?:\.|$)/u,
  /(?:^|\/)test(?:\/|$)/u,
  /(?:^|\/)__tests__(?:\/|$)/u,
];

function readText(rootDir, file) {
  return fs.readFileSync(path.join(rootDir, file), "utf8");
}

function readJson(rootDir, file) {
  return JSON.parse(readText(rootDir, file));
}

function fileExists(rootDir, file) {
  return fs.existsSync(path.join(rootDir, file));
}

function listPackageManifestPaths(rootDir) {
  const manifests = [];
  for (const base of ["apps", "packages"]) {
    const basePath = path.join(rootDir, base);
    if (!fs.existsSync(basePath)) continue;
    for (const entry of fs.readdirSync(basePath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(base, entry.name, "package.json");
      if (fileExists(rootDir, manifestPath)) {
        manifests.push(manifestPath);
      }
    }
  }
  return manifests.sort();
}

export function getCurrentGitBranch(rootDir) {
  const run = spawnSync("git", ["branch", "--show-current"], {
    cwd: rootDir,
    encoding: "utf8",
  });
  if (run.status !== 0) return "";
  return run.stdout.trim();
}

export function releaseBranchVersion(branchName) {
  const match = RELEASE_BRANCH_PATTERN.exec(branchName ?? "");
  return match ? match[1] : null;
}

function ensureIncludes(findings, content, needle, file) {
  if (!content.includes(needle)) {
    findings.push(`${file} must mention '${needle}'.`);
  }
}

export function validateReleaseState(options = {}) {
  const rootDir = options.rootDir ?? process.cwd();
  const releaseBranch =
    options.releaseBranch ??
    process.env.AOR_RELEASE_BRANCH ??
    process.env.GITHUB_HEAD_REF ??
    getCurrentGitBranch(rootDir);
  const strictReleaseBranch =
    options.strictReleaseBranch ?? process.env.AOR_RELEASE_STRICT_BRANCH === "true";
  const findings = [];

  const packageJson = readJson(rootDir, "package.json");
  const packageVersion = String(packageJson.version ?? "");
  const expectedBranchVersion = releaseBranchVersion(releaseBranch);

  if (packageJson.name !== RELEASE_PACKAGE_NAME) {
    findings.push(`package.json name must be '${RELEASE_PACKAGE_NAME}'.`);
  }
  if (packageJson.private !== false) {
    findings.push("package.json private must be false for the published CLI package.");
  }
  if (!RELEASE_VERSION_PATTERN.test(packageVersion)) {
    findings.push("package.json version must be an alpha semver such as 0.1.0-alpha.1.");
  }
  if (packageJson.bin?.aor !== "apps/cli/bin/aor.mjs") {
    findings.push("package.json bin.aor must point to apps/cli/bin/aor.mjs.");
  }
  if (packageJson.engines?.node !== ">=22") {
    findings.push("package.json engines.node must remain >=22.");
  }
  if (packageJson.dependencies?.yaml !== "^2.8.1") {
    findings.push("package.json must declare runtime dependency yaml@^2.8.1.");
  }
  for (const scriptName of ["release:verify", "release:pack", "release:smoke", "release:gate"]) {
    if (typeof packageJson.scripts?.[scriptName] !== "string") {
      findings.push(`package.json scripts.${scriptName} is required.`);
    }
  }
  if (!Array.isArray(packageJson.files)) {
    findings.push("package.json files whitelist is required.");
  } else {
    for (const required of REQUIRED_PACKAGE_FILE_PATTERNS) {
      if (!packageJson.files.includes(required)) {
        findings.push(`package.json files must include '${required}'.`);
      }
    }
  }

  if (strictReleaseBranch && !expectedBranchVersion) {
    findings.push("Release publishing requires a release/v<semver-alpha> branch.");
  }
  if (expectedBranchVersion && expectedBranchVersion !== packageVersion) {
    findings.push(`Release branch '${releaseBranch}' expects version '${expectedBranchVersion}', but package.json has '${packageVersion}'.`);
  }

  for (const manifestPath of listPackageManifestPaths(rootDir)) {
    const manifest = readJson(rootDir, manifestPath);
    if (manifest.private !== true) {
      findings.push(`${manifestPath} must remain private; only the root CLI package is published.`);
    }
  }

  const readme = readText(rootDir, "README.md");
  ensureIncludes(findings, readme, RELEASE_PACKAGE_NAME, "README.md");
  ensureIncludes(findings, readme, `npm install -g ${RELEASE_PACKAGE_NAME}@${packageVersion}`, "README.md");
  ensureIncludes(findings, readme, "docs/ops/npm-cli-alpha-release.md", "README.md");

  const contributing = readText(rootDir, "CONTRIBUTING.md");
  ensureIncludes(findings, contributing, "release/v<semver-alpha>", "CONTRIBUTING.md");
  ensureIncludes(findings, contributing, RELEASE_LABEL, "CONTRIBUTING.md");
  ensureIncludes(findings, contributing, "pnpm release:gate", "CONTRIBUTING.md");

  const changelog = readText(rootDir, "CHANGELOG.md");
  ensureIncludes(findings, changelog, `## [${packageVersion}]`, "CHANGELOG.md");

  const security = readText(rootDir, "SECURITY.md");
  ensureIncludes(findings, security, RELEASE_PACKAGE_NAME, "SECURITY.md");

  const support = readText(rootDir, "SUPPORT.md");
  ensureIncludes(findings, support, RELEASE_PACKAGE_NAME, "SUPPORT.md");

  const runbookPath = "docs/ops/npm-cli-alpha-release.md";
  if (!fileExists(rootDir, runbookPath)) {
    findings.push(`${runbookPath} is required.`);
  } else {
    const runbook = readText(rootDir, runbookPath);
    for (const required of [
      RELEASE_PACKAGE_NAME,
      "release/v<semver-alpha>",
      RELEASE_LABEL,
      "npm Trusted Publishing",
      "npm publish --access public --tag alpha --provenance",
      "pnpm release:gate",
    ]) {
      ensureIncludes(findings, runbook, required, runbookPath);
    }
  }

  for (const workflowPath of [".github/workflows/release-candidate.yml", ".github/workflows/release-publish.yml"]) {
    if (!fileExists(rootDir, workflowPath)) {
      findings.push(`${workflowPath} is required.`);
      continue;
    }
    const workflow = readText(rootDir, workflowPath);
    ensureIncludes(findings, workflow, "node-version: 22.14.0", workflowPath);
    ensureIncludes(findings, workflow, "npm@11.5.1", workflowPath);
    if (workflowPath.endsWith("release-publish.yml")) {
      ensureIncludes(findings, workflow, "id-token: write", workflowPath);
      ensureIncludes(findings, workflow, "npm publish --access public --tag alpha --provenance", workflowPath);
    }
  }

  return {
    ok: findings.length === 0,
    findings,
    packageName: packageJson.name,
    packageVersion,
    releaseBranch,
    expectedBranchVersion,
  };
}

export function packedFilesFromNpmPackJson(packJson) {
  const pack = Array.isArray(packJson) ? packJson[0] : packJson;
  const files = Array.isArray(pack?.files) ? pack.files : [];
  return files
    .map((entry) => (typeof entry.path === "string" ? entry.path.replace(/\\/g, "/") : ""))
    .filter(Boolean)
    .sort();
}

export function validatePackedFiles(files) {
  const findings = [];
  const fileSet = new Set(files);
  for (const required of REQUIRED_PACKED_FILES) {
    if (!fileSet.has(required)) {
      findings.push(`Packed npm artifact is missing '${required}'.`);
    }
  }
  for (const file of files) {
    for (const pattern of FORBIDDEN_PACKED_PATHS) {
      if (pattern.test(file)) {
        findings.push(`Packed npm artifact must not include '${file}'.`);
      }
    }
  }
  return {
    ok: findings.length === 0,
    findings,
  };
}

export function validatePublishEvent(options) {
  const event = options.event;
  const repository = options.repository;
  const packageVersion = options.packageVersion;
  const pullRequest = event?.pull_request ?? {};
  const labels = Array.isArray(pullRequest.labels)
    ? pullRequest.labels.map((label) => label?.name).filter((name) => typeof name === "string")
    : [];
  const branchName = String(pullRequest.head?.ref ?? "");
  const expectedBranchVersion = releaseBranchVersion(branchName);
  const findings = [];

  if (event?.action !== "closed") findings.push("GitHub event action must be pull_request.closed.");
  if (pullRequest.merged !== true) findings.push("Release PR must be merged.");
  if (pullRequest.base?.ref !== "main") findings.push("Release PR base branch must be main.");
  if (!expectedBranchVersion) findings.push("Release PR head branch must match release/v<semver-alpha>.");
  if (pullRequest.head?.repo?.full_name !== repository) {
    findings.push("Release PR must come from the same repository, not a fork.");
  }
  if (!labels.includes(RELEASE_LABEL)) {
    findings.push(`Release PR must carry label '${RELEASE_LABEL}'.`);
  }
  if (expectedBranchVersion && expectedBranchVersion !== packageVersion) {
    findings.push(`Release PR branch expects version '${expectedBranchVersion}', but package.json has '${packageVersion}'.`);
  }

  return {
    shouldPublish: findings.length === 0,
    findings,
    releaseBranch: branchName,
    expectedBranchVersion,
    labels,
  };
}
