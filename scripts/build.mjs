#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function exists(file) {
  return fs.existsSync(path.join(root, file));
}

const requiredFiles = [
  "README.md",
  "AGENTS.md",
  "CONTRIBUTING.md",
  "LICENSE",
  "package.json",
  "pnpm-workspace.yaml",
  "pnpm-lock.yaml",
  ".github/workflows/ci.yml",
  "scripts/lint.mjs",
  "scripts/test.mjs",
  "scripts/build.mjs",
  "scripts/slice-cycle.mjs",
  "scripts/slice-cycle-lib.mjs",
  "scripts/test/slice-cycle.test.mjs",
  "docs/backlog/wave-0-implementation-slices.md",
  "docs/backlog/wave-5-implementation-slices.md",
];

const missing = requiredFiles.filter((file) => !exists(file));
if (missing.length > 0) {
  console.error("Missing required scaffold files:");
  for (const file of missing) console.error(`- ${file}`);
  process.exit(1);
}

const packageJson = JSON.parse(read("package.json"));
if (packageJson.license !== "Apache-2.0") {
  console.error("package.json must declare license Apache-2.0");
  process.exit(1);
}
if (!String(packageJson.packageManager || "").startsWith("pnpm@")) {
  console.error("package.json must declare pnpm as packageManager");
  process.exit(1);
}
for (const script of ["build", "test", "lint", "check"]) {
  if (!packageJson.scripts || !packageJson.scripts[script]) {
    console.error(`package.json is missing script '${script}'`);
    process.exit(1);
  }
}

const readme = read("README.md");
for (const section of [
  "## Why AOR",
  "## Contributor quickstart",
  "## How AOR works",
  "## Live E2E target projects",
  "## Roadmap",
  "## Contributing",
  "## License",
]) {
  if (!readme.includes(section)) {
    console.error(`README.md is missing section '${section}'`);
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
  "pnpm install --no-frozen-lockfile",
  "pnpm lint",
  "pnpm test",
  "pnpm build",
]) {
  if (!workflow.includes(needle)) {
    console.error(`.github/workflows/ci.yml is missing '${needle}'`);
    process.exit(1);
  }
}

const pinnedActions = [...workflow.matchAll(/uses:\s+[^@\s]+@([0-9a-f]{40})/g)];
if (pinnedActions.length < 3) {
  console.error("Expected workflow actions to be pinned to full commit SHAs.");
  process.exit(1);
}

console.log("scaffold integrity ok: community files, workflow conventions, and root package settings are present");
