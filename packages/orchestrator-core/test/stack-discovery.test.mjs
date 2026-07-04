import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { discoverVerificationCommandGroups } from "../src/stack-discovery.mjs";

/**
 * @param {(repoRoot: string) => void} callback
 */
function withTempRepo(callback) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-w54-s02-"));
  try {
    callback(repoRoot);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
}

/**
 * @param {string} repoRoot
 * @param {string} relativePath
 * @param {string} content
 */
function writeFile(repoRoot, relativePath, content) {
  const filePath = path.join(repoRoot, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

/**
 * @param {ReturnType<typeof discoverVerificationCommandGroups>} discovery
 * @returns {Array<Record<string, unknown>>}
 */
function commandGroups(discovery) {
  return discovery.command_group_candidates.map((candidate) => candidate.command_group);
}

test("discovers Node package-manager scripts with source refs and confidence", () => {
  withTempRepo((repoRoot) => {
    writeFile(
      repoRoot,
      "package.json",
      JSON.stringify(
        {
          name: "node-fixture",
          scripts: {
            build: "vite build",
            lint: "eslint .",
            test: "vitest run",
            typecheck: "tsc --noEmit",
            "test:e2e": "playwright test",
          },
        },
        null,
        2,
      ),
    );
    writeFile(repoRoot, "pnpm-lock.yaml", "lockfileVersion: '9.0'\n");

    const discovery = discoverVerificationCommandGroups({ projectRoot: repoRoot });
    const groups = commandGroups(discovery);

    assert.ok(discovery.detections.some((entry) => entry.stack === "node" && entry.confidence === "high"));
    assert.ok(
      discovery.command_group_candidates.every(
        (candidate) => candidate.confidence === "high" && candidate.source_refs.length > 0,
      ),
    );
    assert.ok(groups.some((group) => group.id === "post-change-build" && group.commands.includes("pnpm run build")));
    assert.ok(groups.some((group) => group.id === "post-change-lint" && group.commands.includes("pnpm run lint")));
    assert.ok(groups.some((group) => group.id === "post-change-test" && group.commands.includes("pnpm run test")));
    assert.ok(
      groups.some((group) => group.id === "post-change-typecheck" && group.commands.includes("pnpm run typecheck")),
    );
    assert.ok(groups.some((group) => group.id === "post-change-e2e" && group.commands.includes("pnpm run test:e2e")));
    assert.ok(groups.every((group) => group.package_manager === "pnpm"));
  });
});

test("discovers monorepo package boundaries and package-level Node commands", () => {
  withTempRepo((repoRoot) => {
    writeFile(
      repoRoot,
      "package.json",
      JSON.stringify({ name: "monorepo-fixture", workspaces: ["apps/*"] }, null, 2),
    );
    writeFile(repoRoot, "pnpm-workspace.yaml", "packages:\n  - apps/*\n");
    writeFile(
      repoRoot,
      "apps/api/package.json",
      JSON.stringify({ name: "api", scripts: { build: "tsc", test: "node --test" } }, null, 2),
    );

    const discovery = discoverVerificationCommandGroups({ projectRoot: repoRoot });
    const groups = commandGroups(discovery);

    assert.ok(discovery.package_boundaries.some((boundary) => boundary.working_dir === "."));
    assert.ok(discovery.package_boundaries.some((boundary) => boundary.working_dir === "apps/api"));
    assert.ok(
      groups.some(
        (group) =>
          group.working_dir === "apps/api" &&
          group.id === "post-change-test-apps-api" &&
          group.commands.includes("pnpm run test"),
      ),
    );
  });
});

test("normalizes hyphen-heavy working directory ids in linear time", () => {
  withTempRepo((repoRoot) => {
    const packageDir = `${"-".repeat(96)}api${"-".repeat(96)}`;
    writeFile(
      repoRoot,
      `packages/${packageDir}/package.json`,
      JSON.stringify({ name: "hyphen-fixture", scripts: { test: "node --test" } }, null, 2),
    );

    const discovery = discoverVerificationCommandGroups({ projectRoot: repoRoot });
    const group = commandGroups(discovery).find(
      (candidate) =>
        candidate.working_dir === `packages/${packageDir}` &&
        candidate.role === "test" &&
        candidate.phase === "post-change",
    );

    assert.ok(group);
    assert.equal(String(group.id).startsWith("post-change-test-packages-"), true);
    assert.equal(String(group.id).endsWith("api"), true);
  });
});

test("discovers Python pytest, tox, nox, lint, and typecheck signals", () => {
  withTempRepo((repoRoot) => {
    writeFile(
      repoRoot,
      "pyproject.toml",
      "[project]\nname = 'python-fixture'\n[tool.pytest.ini_options]\ntestpaths = ['tests']\n[tool.ruff]\nline-length = 100\n[tool.mypy]\nstrict = true\n",
    );
    writeFile(repoRoot, "tox.ini", "[tox]\nenvlist = py\n");
    writeFile(repoRoot, "noxfile.py", "import nox\n");

    const discovery = discoverVerificationCommandGroups({ projectRoot: repoRoot });
    const groups = commandGroups(discovery);

    assert.ok(discovery.detections.some((entry) => entry.stack === "python" && entry.confidence === "high"));
    assert.ok(groups.some((group) => group.role === "test" && group.commands.includes("python -m pytest")));
    assert.ok(groups.some((group) => group.role === "test" && group.commands.includes("python -m tox")));
    assert.ok(groups.some((group) => group.role === "test" && group.commands.includes("python -m nox")));
    assert.ok(groups.some((group) => group.role === "lint" && group.commands.includes("python -m ruff check .")));
    assert.ok(groups.some((group) => group.role === "typecheck" && group.commands.includes("python -m mypy .")));
  });
});

test("discovers Go and Rust compiled-project manifests", () => {
  withTempRepo((repoRoot) => {
    writeFile(repoRoot, "services/api/go.mod", "module example.com/api\n\ngo 1.22\n");
    writeFile(repoRoot, "crates/core/Cargo.toml", "[package]\nname = 'core'\nversion = '0.1.0'\n");

    const discovery = discoverVerificationCommandGroups({ projectRoot: repoRoot });
    const groups = commandGroups(discovery);

    assert.ok(groups.some((group) => group.working_dir === "services/api" && group.commands.includes("go test ./...")));
    assert.ok(groups.some((group) => group.working_dir === "services/api" && group.commands.includes("go build ./...")));
    assert.ok(groups.some((group) => group.working_dir === "crates/core" && group.commands.includes("cargo test")));
    assert.ok(groups.some((group) => group.working_dir === "crates/core" && group.commands.includes("cargo build")));
  });
});

test("discovers frontend browser config commands without package scripts", () => {
  withTempRepo((repoRoot) => {
    writeFile(repoRoot, "package.json", JSON.stringify({ name: "frontend-fixture" }, null, 2));
    writeFile(repoRoot, "package-lock.json", "{}\n");
    writeFile(repoRoot, "playwright.config.ts", "export default {};\n");
    writeFile(repoRoot, "cypress.config.ts", "export default {};\n");
    writeFile(repoRoot, "vitest.config.ts", "export default {};\n");

    const discovery = discoverVerificationCommandGroups({ projectRoot: repoRoot });
    const groups = commandGroups(discovery);

    assert.ok(groups.some((group) => group.role === "e2e" && group.commands.includes("npx playwright test")));
    assert.ok(groups.some((group) => group.role === "e2e" && group.commands.includes("npx cypress run")));
    assert.ok(groups.some((group) => group.role === "test" && group.commands.includes("npx vitest run")));
    assert.ok(discovery.outcomes.every((outcome) => outcome.outcome !== "no-tests"));
  });
});

test("unknown repositories produce explicit no-tests evidence and custom suggestion", () => {
  withTempRepo((repoRoot) => {
    writeFile(repoRoot, "README.md", "# Unknown fixture\n");

    const discovery = discoverVerificationCommandGroups({ projectRoot: repoRoot });

    assert.equal(discovery.command_group_candidates.length, 0);
    assert.deepEqual(discovery.outcomes.map((entry) => entry.outcome), ["no-tests"]);
    assert.equal(discovery.outcomes[0].working_dir, ".");
    assert.equal(discovery.suggestions[0].kind, "custom");
  });
});
