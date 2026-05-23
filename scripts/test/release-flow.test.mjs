import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  RELEASE_LABEL,
  validatePackedFiles,
  validatePublishEvent,
  RELEASE_NPM_VERSION,
  validateReleaseState,
} from "../release-lib.mjs";

const currentFilePath = fileURLToPath(import.meta.url);
const workspaceRoot = path.resolve(path.dirname(currentFilePath), "../..");

function copyFixtureRepo() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-release-flow-test-"));
  for (const file of [
    "README.md",
    "CONTRIBUTING.md",
    "CHANGELOG.md",
    "SECURITY.md",
    "SUPPORT.md",
    "package.json",
  ]) {
    fs.copyFileSync(path.join(workspaceRoot, file), path.join(tempRoot, file));
  }
  for (const dir of [".github/workflows", "apps", "packages", "docs/ops"]) {
    fs.mkdirSync(path.join(tempRoot, dir), { recursive: true });
    fs.cpSync(path.join(workspaceRoot, dir), path.join(tempRoot, dir), { recursive: true });
  }
  return tempRoot;
}

function updateJson(file, updater) {
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  updater(json);
  fs.writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`, "utf8");
}

function releaseEvent(overrides = {}) {
  return {
    action: "closed",
    pull_request: {
      merged: true,
      base: { ref: "main" },
      head: {
        ref: "release/v0.1.0-alpha.1",
        repo: { full_name: "GrinRus/ai_native_sdlc_orchestrator" },
      },
      labels: [{ name: RELEASE_LABEL }],
    },
    ...overrides,
  };
}

test("release verifier accepts matching release branch and package metadata", () => {
  const result = validateReleaseState({
    rootDir: workspaceRoot,
    releaseBranch: "release/v0.1.0-alpha.1",
    strictReleaseBranch: true,
  });
  assert.deepEqual(result.findings, []);
  assert.equal(result.ok, true);
  assert.equal(result.packageVersion, "0.1.0-alpha.1");
});

test("release verifier rejects release branch version mismatch", () => {
  const tempRoot = copyFixtureRepo();
  try {
    updateJson(path.join(tempRoot, "package.json"), (json) => {
      json.version = "0.1.0-alpha.2";
    });
    const result = validateReleaseState({
      rootDir: tempRoot,
      releaseBranch: "release/v0.1.0-alpha.1",
      strictReleaseBranch: true,
    });
    assert.equal(result.ok, false);
    assert.match(result.findings.join("\n"), /expects version '0\.1\.0-alpha\.1'/u);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("release verifier rejects missing changelog entry", () => {
  const tempRoot = copyFixtureRepo();
  try {
    fs.writeFileSync(path.join(tempRoot, "CHANGELOG.md"), "# Changelog\n\n## Unreleased\n", "utf8");
    const result = validateReleaseState({
      rootDir: tempRoot,
      releaseBranch: "release/v0.1.0-alpha.1",
      strictReleaseBranch: true,
    });
    assert.equal(result.ok, false);
    assert.match(result.findings.join("\n"), /CHANGELOG\.md must mention '## \[0\.1\.0-alpha\.1\]'/u);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("release verifier rejects wrong package name and public internal packages", () => {
  const tempRoot = copyFixtureRepo();
  try {
    updateJson(path.join(tempRoot, "package.json"), (json) => {
      json.name = "aor";
    });
    updateJson(path.join(tempRoot, "packages/contracts/package.json"), (json) => {
      json.private = false;
    });
    const result = validateReleaseState({
      rootDir: tempRoot,
      releaseBranch: "release/v0.1.0-alpha.1",
      strictReleaseBranch: true,
    });
    assert.equal(result.ok, false);
    assert.match(result.findings.join("\n"), /package\.json name must be '@grinrus\/aor'/u);
    assert.match(result.findings.join("\n"), /packages\/contracts\/package\.json must remain private/u);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("release verifier rejects publish workflows without trusted publishing runtime pins, prerelease, and alpha tag", () => {
  const tempRoot = copyFixtureRepo();
  try {
    fs.writeFileSync(
      path.join(tempRoot, ".github/workflows/release-publish.yml"),
      [
        "name: Release publish",
        "permissions:",
        "  contents: write",
        "  id-token: write",
        "jobs:",
        "  publish:",
        "    steps:",
        `      - run: npm install -g npm@${RELEASE_NPM_VERSION}`,
        "      - run: npm publish --access public --provenance",
        "",
      ].join("\n"),
      "utf8",
    );
    const result = validateReleaseState({
      rootDir: tempRoot,
      releaseBranch: "release/v0.1.0-alpha.1",
      strictReleaseBranch: true,
    });
    assert.equal(result.ok, false);
    assert.match(result.findings.join("\n"), /node-version: 22\.14\.0/u);
    assert.match(result.findings.join("\n"), /--prerelease/u);
    assert.match(result.findings.join("\n"), /npm publish --access public --tag alpha --provenance/u);
    assert.doesNotMatch(result.findings.join("\n"), /npm@11\.5\.1/u);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("packed file validation rejects runtime, test, and live E2E artifacts", () => {
  const result = validatePackedFiles([
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
    ".aor/projects/run.json",
    "scripts/test/release-flow.test.mjs",
    "examples/live-e2e/fixture.json",
  ]);
  assert.equal(result.ok, false);
  assert.match(result.findings.join("\n"), /\.aor\/projects\/run\.json/u);
  assert.match(result.findings.join("\n"), /scripts\/test\/release-flow\.test\.mjs/u);
  assert.match(result.findings.join("\n"), /examples\/live-e2e\/fixture\.json/u);
});

test("publish event guard accepts only merged release PRs with publish label", () => {
  const accepted = validatePublishEvent({
    event: releaseEvent(),
    repository: "GrinRus/ai_native_sdlc_orchestrator",
    packageVersion: "0.1.0-alpha.1",
  });
  assert.equal(accepted.shouldPublish, true);

  const missingLabel = validatePublishEvent({
    event: releaseEvent({
      pull_request: {
        ...releaseEvent().pull_request,
        labels: [],
      },
    }),
    repository: "GrinRus/ai_native_sdlc_orchestrator",
    packageVersion: "0.1.0-alpha.1",
  });
  assert.equal(missingLabel.shouldPublish, false);
  assert.match(missingLabel.findings.join("\n"), /release:publish/u);

  const mismatch = validatePublishEvent({
    event: releaseEvent(),
    repository: "GrinRus/ai_native_sdlc_orchestrator",
    packageVersion: "0.1.0-alpha.2",
  });
  assert.equal(mismatch.shouldPublish, false);
  assert.match(mismatch.findings.join("\n"), /expects version '0\.1\.0-alpha\.1'/u);
});
