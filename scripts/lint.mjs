#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();

const requiredAgents = [
  "AGENTS.md",
  "docs/AGENTS.md",
  "docs/product/AGENTS.md",
  "docs/research/AGENTS.md",
  "docs/architecture/AGENTS.md",
  "docs/contracts/AGENTS.md",
  "docs/backlog/AGENTS.md",
  "docs/ops/AGENTS.md",
  "examples/AGENTS.md",
  "examples/routes/AGENTS.md",
  "examples/policies/AGENTS.md",
  "examples/wrappers/AGENTS.md",
  "examples/adapters/AGENTS.md",
  "examples/eval/AGENTS.md",
  "examples/packets/AGENTS.md",
  "examples/live-e2e/AGENTS.md",
  "examples/prompts/AGENTS.md",
  "apps/AGENTS.md",
  "apps/api/AGENTS.md",
  "apps/cli/AGENTS.md",
  "apps/web/AGENTS.md",
  "packages/AGENTS.md",
  "packages/harness/AGENTS.md",
  "packages/adapter-sdk/AGENTS.md",
  "packages/contracts/AGENTS.md",
  "packages/observability/AGENTS.md",
  "packages/orchestrator-core/AGENTS.md",
  "packages/provider-routing/AGENTS.md",
  ".github/AGENTS.md",
  "scripts/AGENTS.md",
];

const requiredDocs = [
  "README.md",
  "CONTRIBUTING.md",
  "LICENSE",
  ".github/workflows/ci.yml",
  "docs/backlog/backlog-operating-model.md",
  "docs/backlog/mvp-roadmap.md",
  "docs/backlog/mvp-implementation-backlog.md",
  "docs/backlog/orchestrator-epics.md",
  "docs/backlog/slice-dependency-graph.md",
  "docs/research/04-readme-contributing-license-ci-best-practices.md",
];

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

/**
 * @param {string} dir
 * @returns {string[]}
 */
function listSourceFiles(dir) {
  const absoluteDir = path.join(root, dir);
  if (!fs.existsSync(absoluteDir)) {
    return [];
  }

  /** @type {string[]} */
  const files = [];
  for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(entryPath));
    } else if (entry.isFile() && entry.name.endsWith(".mjs")) {
      files.push(entryPath);
    }
  }
  return files;
}

/**
 * @param {string} sourceFile
 * @param {string} sourceRoot
 * @param {string} forbiddenRoot
 * @returns {string[]}
 */
function findForbiddenSourceEdges(sourceFile, sourceRoot, forbiddenRoot) {
  const content = read(sourceFile);
  const sourceDir = path.dirname(path.join(root, sourceFile));
  const forbiddenAbsolute = path.join(root, forbiddenRoot);
  const sourceRootLabel = sourceRoot.replace(/\/$/u, "");
  const forbiddenRootLabel = forbiddenRoot.replace(/\/$/u, "");
  /** @type {string[]} */
  const violations = [];
  const specifierRegex = /\b(?:import|export)\b[\s\S]*?\bfrom\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/gu;

  for (const match of content.matchAll(specifierRegex)) {
    const specifier = match[1] ?? match[2];
    if (!specifier) {
      continue;
    }
    if (specifier.includes(forbiddenRootLabel)) {
      violations.push(`${sourceFile} imports ${specifier}`);
      continue;
    }
    if (specifier.startsWith(".")) {
      const resolved = path.resolve(sourceDir, specifier);
      if (resolved === forbiddenAbsolute || resolved.startsWith(`${forbiddenAbsolute}${path.sep}`)) {
        violations.push(`${sourceFile} imports ${specifier}`);
      }
    }
  }

  if (content.includes(`${forbiddenRootLabel}/`)) {
    violations.push(`${sourceFile} references ${forbiddenRootLabel}/`);
  }

  return violations.filter((entry) => entry.includes(sourceRootLabel) || entry.includes(sourceFile));
}

function assertNoAppToAppSourceEdges() {
  const checks = [
    { sourceRoot: "apps/api/src", forbiddenRoot: "apps/cli" },
    { sourceRoot: "apps/cli/src", forbiddenRoot: "apps/api" },
  ];
  const violations = checks.flatMap(({ sourceRoot, forbiddenRoot }) =>
    listSourceFiles(sourceRoot).flatMap((file) => findForbiddenSourceEdges(file, sourceRoot, forbiddenRoot)),
  );
  if (violations.length > 0) {
    console.error("Disallowed API/CLI app-to-app source dependency edges:");
    for (const violation of violations) {
      console.error(`- ${violation}`);
    }
    process.exit(1);
  }
  console.log("app boundary ok: no apps/api <-> apps/cli source edges");
}

const missing = [...requiredAgents, ...requiredDocs].filter(
  (file) => !fs.existsSync(path.join(root, file)),
);

if (missing.length > 0) {
  console.error("Missing required repo-guidance files:");
  for (const file of missing) console.error(`- ${file}`);
  process.exit(1);
}

for (const file of requiredAgents) {
  const content = read(file).trimStart();
  if (!content.startsWith("# AGENTS.md")) {
    console.error(`Expected ${file} to start with '# AGENTS.md'.`);
    process.exit(1);
  }
}

for (const file of [
  "README.md",
  "CONTRIBUTING.md",
  "docs/backlog/backlog-operating-model.md",
  "docs/backlog/mvp-roadmap.md",
  "docs/backlog/mvp-implementation-backlog.md",
  "docs/backlog/orchestrator-epics.md",
  "docs/backlog/slice-dependency-graph.md",
]) {
  const content = read(file).trimStart();
  if (!content.startsWith("# ")) {
    console.error(`Expected ${file} to start with a top-level markdown heading.`);
    process.exit(1);
  }
}

console.log(`guidance coverage ok: ${requiredAgents.length} AGENTS files, ${requiredDocs.length} required docs`);
assertNoAppToAppSourceEdges();
