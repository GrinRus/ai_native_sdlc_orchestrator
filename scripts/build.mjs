#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const root = process.cwd();

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function exists(file) {
  return fs.existsSync(path.join(root, file));
}

function normalizePath(file) {
  return file.split(path.sep).join(path.posix.sep);
}

function listWorkspacePackageDirs() {
  const workspaceBases = ["apps", "packages"];
  const dirs = [];

  for (const base of workspaceBases) {
    const basePath = path.join(root, base);
    if (!fs.existsSync(basePath)) continue;

    for (const entry of fs.readdirSync(basePath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;

      const relativeDir = path.posix.join(base, entry.name);
      if (exists(path.posix.join(relativeDir, "package.json"))) {
        dirs.push(relativeDir);
      }
    }
  }

  return dirs.sort();
}

function parseModuleMapPackagePaths(content) {
  return [
    ...new Set(
      [...content.matchAll(/`((?:apps|packages)\/[^`/\s]+)`/g)]
        .map((match) => normalizePath(match[1]))
        .sort(),
    ),
  ];
}

function assertPackageModuleMapIntegrity() {
  const moduleMapPath = "docs/architecture/13-package-and-module-map.md";
  const moduleMap = read(moduleMapPath);
  const documentedPaths = parseModuleMapPackagePaths(moduleMap);
  const documentedPathSet = new Set(documentedPaths);
  const workspacePackageDirs = listWorkspacePackageDirs();

  for (const modulePath of documentedPaths) {
    if (!exists(modulePath)) {
      console.error(`${moduleMapPath} lists ${modulePath}, but the directory does not exist.`);
      process.exit(1);
    }
    if (!exists(path.posix.join(modulePath, "package.json"))) {
      console.error(`${moduleMapPath} lists ${modulePath}, but it has no package.json.`);
      process.exit(1);
    }

    const manifestPath = path.posix.join(modulePath, "package.json");
    const manifest = JSON.parse(read(manifestPath));
    const missingManifestFields = [];
    if (typeof manifest.name !== "string" || manifest.name.length === 0) missingManifestFields.push("name");
    if (manifest.private !== true) missingManifestFields.push("private=true");
    if (typeof manifest.version !== "string" || manifest.version.length === 0) missingManifestFields.push("version");
    if (manifest.type !== "module") missingManifestFields.push("type=module");
    if (!manifest.exports) missingManifestFields.push("exports");

    if (missingManifestFields.length > 0) {
      console.error(`${manifestPath} is missing required package-managed manifest fields: ${missingManifestFields.join(", ")}.`);
      process.exit(1);
    }
  }

  for (const workspacePackageDir of workspacePackageDirs) {
    if (!documentedPathSet.has(workspacePackageDir)) {
      console.error(`${workspacePackageDir} has package.json but is missing from ${moduleMapPath}.`);
      process.exit(1);
    }
  }

  console.log(`package/module map integrity ok: ${documentedPaths.length} package-managed apps/packages`);
}

function discoverWaveFiles() {
  const backlogDir = path.join(root, "docs/backlog");
  const entries = fs
    .readdirSync(backlogDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .map((name) => {
      const match = /^wave-(\d+)-implementation-slices\.md$/.exec(name);
      if (!match) return null;
      return {
        waveIndex: Number(match[1]),
        name,
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.waveIndex !== b.waveIndex) return a.waveIndex - b.waveIndex;
      return a.name.localeCompare(b.name);
    });

  if (entries.length === 0) {
    console.error("Could not find any wave implementation documents under docs/backlog/.");
    process.exit(1);
  }

  if (entries[0].waveIndex !== 0) {
    console.error("Wave documents must start at wave-0-implementation-slices.md.");
    process.exit(1);
  }

  for (let index = 1; index < entries.length; index += 1) {
    const previous = entries[index - 1];
    const current = entries[index];
    if (current.waveIndex !== previous.waveIndex + 1) {
      console.error(`Wave numbering gap detected between ${previous.name} and ${current.name}.`);
      process.exit(1);
    }
  }

  return entries.map((entry) => path.posix.join("docs/backlog", entry.name));
}

const waveFiles = discoverWaveFiles();

const requiredFiles = [
  "README.md",
  "AGENTS.md",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  "SECURITY.md",
  "SUPPORT.md",
  "CHANGELOG.md",
  "LICENSE",
  "package.json",
  "pnpm-workspace.yaml",
  "pnpm-lock.yaml",
  ".github/CODEOWNERS",
  ".github/dependabot.yml",
  ".github/workflows/ci.yml",
  ".github/workflows/dependency-review.yml",
  ".github/workflows/codeql.yml",
  ".github/workflows/scorecard.yml",
  ".github/workflows/release-candidate.yml",
  ".github/workflows/release-publish.yml",
  "docs/ops/npm-cli-alpha-release.md",
  "scripts/lint.mjs",
  "scripts/test.mjs",
  "scripts/build.mjs",
  "scripts/release-event-guard.mjs",
  "scripts/release-lib.mjs",
  "scripts/release-pack.mjs",
  "scripts/release-smoke.mjs",
  "scripts/release-verify.mjs",
  "scripts/slice-cycle.mjs",
  "scripts/slice-cycle-lib.mjs",
  "scripts/test/release-flow.test.mjs",
  "scripts/test/slice-cycle.test.mjs",
  ...waveFiles,
];

const missing = requiredFiles.filter((file) => !exists(file));
if (missing.length > 0) {
  console.error("Missing required scaffold files:");
  for (const file of missing) console.error(`- ${file}`);
  process.exit(1);
}

assertPackageModuleMapIntegrity();

const packageJson = JSON.parse(read("package.json"));
if (packageJson.license !== "Apache-2.0") {
  console.error("package.json must declare license Apache-2.0");
  process.exit(1);
}
if (!String(packageJson.packageManager || "").startsWith("pnpm@")) {
  console.error("package.json must declare pnpm as packageManager");
  process.exit(1);
}
if (packageJson.name !== "@grinrus/aor") {
  console.error("package.json must publish the CLI alpha package as @grinrus/aor.");
  process.exit(1);
}
if (packageJson.private !== false) {
  console.error("package.json must be publishable for the root CLI alpha package.");
  process.exit(1);
}
if (packageJson.bin?.aor !== "apps/cli/bin/aor.mjs") {
  console.error("package.json must expose bin.aor as apps/cli/bin/aor.mjs.");
  process.exit(1);
}
if (packageJson.dependencies?.yaml !== "^2.8.1") {
  console.error("package.json must declare yaml as a root runtime dependency for npm packaging.");
  process.exit(1);
}
for (const script of ["build", "test", "lint", "check"]) {
  if (!packageJson.scripts || !packageJson.scripts[script]) {
    console.error(`package.json is missing script '${script}'`);
    process.exit(1);
  }
}
for (const script of ["release:verify", "release:pack", "release:smoke", "release:gate"]) {
  if (!packageJson.scripts || !packageJson.scripts[script]) {
    console.error(`package.json is missing release script '${script}'`);
    process.exit(1);
  }
}
if (packageJson.scripts?.aor !== "node ./apps/cli/bin/aor.mjs") {
  console.error("package.json must expose the source-checkout CLI as script 'aor'.");
  process.exit(1);
}
if (packageJson.scripts?.["production:ready"] !== "node ./scripts/production-readiness.mjs") {
  console.error("package.json must expose production:ready as the separate production-readiness gate.");
  process.exit(1);
}

const readme = read("README.md");
for (const section of [
  "## Status: alpha distribution",
  "## Current distribution channels",
  "## What is AOR?",
  "## Requirements",
  "## Install CLI from npm alpha",
  "## Clone and install from source",
  "## Run your first no-write local mission",
  "## What you should see",
  "## Choose a runner",
  "## Inspect artifacts",
  "## Optional API/web surfaces",
  "## What works today",
  "## Readiness evidence",
  "## When not to use AOR yet",
  "## Docs map",
  "## Contributor quickstart",
  "## How AOR works",
  "## Roadmap",
  "## Contributing",
  "## License",
]) {
  if (!readme.includes(section)) {
    console.error(`README.md is missing section '${section}'`);
    process.exit(1);
  }
}

for (const needle of [
  "git clone https://github.com/GrinRus/ai_native_sdlc_orchestrator.git",
  "npm install -g @grinrus/aor@0.1.0-alpha.5",
  "docs/ops/npm-cli-alpha-release.md",
  "workspace packages stay `private:true`",
  "pnpm install --frozen-lockfile",
  "pnpm aor doctor --project-ref",
  "pnpm aor onboard",
  "pnpm aor mission create",
  "--constraint \"No upstream writes, no target file edits, and no external runner execution\"",
  "--delivery-mode no-write",
  "In no-write mode, AOR still writes runtime state",
  "do not pass `examples/project.aor.yaml`",
  "--asset-mode materialized",
  "creates target-repo files outside `.aor/`",
  "delivery_mode=no-write",
  "upstream_writes_default=false",
  ".aor/` is ignored runtime state",
]) {
  if (!readme.includes(needle)) {
    console.error(`README.md is missing required operator quickstart detail '${needle}'`);
    process.exit(1);
  }
}

for (const { pattern, message } of [
  {
    pattern: /live-e2e-runbook\.md/u,
    message: "README.md must not link to internal live E2E runbooks.",
  },
  {
    pattern: /live-e2e-standard-runner\.md/u,
    message: "README.md must not route users to internal live E2E runner docs.",
  },
  {
    pattern: /scripts\/live-e2e\/run-profile\.mjs/u,
    message: "README.md must not expose internal live E2E runner commands as a user workflow.",
  },
  {
    pattern: /examples\/live-e2e\//u,
    message: "README.md must not route users to internal live E2E fixtures.",
  },
  {
    pattern: /live\s*E2E|live-e2e/iu,
    message: "README.md must keep live E2E as internal maintainer/eval material, not user-facing README content.",
  },
  {
    pattern: /pnpm exec aor/u,
    message: "README.md must use the root pnpm aor script instead of pnpm exec aor.",
  },
  {
    pattern: /pnpm install(?! --frozen-lockfile)/u,
    message: "README.md setup commands must use pnpm install --frozen-lockfile.",
  },
]) {
  if (pattern.test(readme)) {
    console.error(message);
    process.exit(1);
  }
}

const contributing = read("CONTRIBUTING.md");
for (const section of [
  "## Development workflow",
  "## Repo-specific rules",
  "## Pull request checklist",
  "## Bug reports",
  "## Feature requests",
]) {
  if (!contributing.includes(section)) {
    console.error(`CONTRIBUTING.md is missing section '${section}'`);
    process.exit(1);
  }
}

const workflow = read(".github/workflows/ci.yml");
for (const needle of [
  "permissions:",
  "contents: read",
  "concurrency:",
  "cancel-in-progress: true",
  "actions/checkout@",
  "actions/setup-node@",
  "pnpm/action-setup@",
  "pnpm install --frozen-lockfile",
  "pnpm check",
  "pnpm production:ready",
]) {
  if (!workflow.includes(needle)) {
    console.error(`.github/workflows/ci.yml is missing '${needle}'`);
    process.exit(1);
  }
}

const workflowExpectations = new Map([
  [
    ".github/workflows/dependency-review.yml",
    [
      "pull_request:",
      "contents: read",
      "pull-requests: read",
      "actions/dependency-review-action@",
    ],
  ],
  [
    ".github/workflows/codeql.yml",
    [
      "pull_request:",
      "push:",
      "security-events: write",
      "github/codeql-action/init@",
      "github/codeql-action/analyze@",
      "languages: javascript-typescript",
    ],
  ],
  [
    ".github/workflows/scorecard.yml",
    [
      "pull_request:",
      "workflow_dispatch:",
      "security-events: write",
      "publish_results: false",
      "ossf/scorecard-action@",
      "github/codeql-action/upload-sarif@",
    ],
  ],
  [
    ".github/workflows/release-candidate.yml",
    [
      "pull_request:",
      "release/v",
      "contents: read",
      "npm@11.15.0",
      "pnpm install --frozen-lockfile",
      "pnpm release:gate",
    ],
  ],
  [
    ".github/workflows/release-publish.yml",
    [
      "pull_request:",
      "types:",
      "contents: write",
      "id-token: write",
      "release:publish",
      "npm@11.15.0",
      "node ./scripts/release-event-guard.mjs",
      "pnpm release:gate",
      "--prerelease",
      "npm publish --access public --tag alpha --provenance",
    ],
  ],
]);

for (const [workflowPath, needles] of workflowExpectations) {
  const workflowContent = read(workflowPath);
  for (const needle of needles) {
    if (!workflowContent.includes(needle)) {
      console.error(`${workflowPath} is missing '${needle}'`);
      process.exit(1);
    }
  }
}

const workflowDir = path.join(root, ".github/workflows");
for (const entry of fs.readdirSync(workflowDir, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith(".yml")) continue;

  const workflowPath = path.posix.join(".github/workflows", entry.name);
  const workflowContent = read(workflowPath);
  const usesLines = [...workflowContent.matchAll(/uses:\s+([^@\s]+)@([^\s#]+)/g)];

  for (const match of usesLines) {
    const actionRef = match[2];
    if (!/^[0-9a-f]{40}$/.test(actionRef)) {
      console.error(`${workflowPath} uses ${match[1]} without a full commit SHA pin.`);
      process.exit(1);
    }
  }
}

const webBuild = spawnSync("pnpm", ["web:build"], {
  cwd: root,
  stdio: "inherit",
});
if (webBuild.status !== 0) {
  process.exit(webBuild.status ?? 1);
}

console.log("scaffold integrity ok: community files, workflow conventions, root package settings, and web app build are present");
