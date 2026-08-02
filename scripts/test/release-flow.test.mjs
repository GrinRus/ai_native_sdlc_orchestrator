import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
import {
  classifyAlphaPublishState,
  planAlphaPublishReconciliation,
  reconcileAlphaPublication,
} from "../release-publish-transaction-lib.mjs";

const currentFilePath = fileURLToPath(import.meta.url);
const workspaceRoot = path.resolve(path.dirname(currentFilePath), "../..");
const RELEASE_PACKAGE_VERSION = JSON.parse(fs.readFileSync(path.join(workspaceRoot, "package.json"), "utf8")).version;
const RELEASE_BRANCH = `release/v${RELEASE_PACKAGE_VERSION}`;
const MISMATCH_PACKAGE_VERSION = "0.0.0-alpha.0";
const privateRehearsalPath = ["examples", ["live", "e2e"].join("-"), "fixture.json"].join("/");
const privateManualCommandToken = ["manual", ["live", "e2e"].join("-")].join("-");
const expectedPublication = Object.freeze({
  version: RELEASE_PACKAGE_VERSION,
  tag: `v${RELEASE_PACKAGE_VERSION}`,
  commit_sha: "1111111111111111111111111111111111111111",
  release_title: `AOR v${RELEASE_PACKAGE_VERSION}`,
  release_notes: `npm CLI alpha release for @grinrus/aor@${RELEASE_PACKAGE_VERSION}. npm dist-tag: alpha. Release gate: pnpm release:gate.`,
});

function publicationState({ tag = false, release = false, npm = false, alpha = null } = {}) {
  return {
    tag: {
      exists: tag,
      target_sha: tag ? expectedPublication.commit_sha : null,
    },
    release: {
      exists: release,
      tag: release ? expectedPublication.tag : null,
      target_sha: release ? expectedPublication.commit_sha : null,
      prerelease: release ? true : null,
      title: release ? expectedPublication.release_title : null,
      notes: release ? expectedPublication.release_notes : null,
    },
    npm: {
      version_exists: npm,
      alpha_version: alpha,
    },
  };
}

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
        ref: RELEASE_BRANCH,
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
    releaseBranch: RELEASE_BRANCH,
    strictReleaseBranch: true,
  });
  assert.deepEqual(result.findings, []);
  assert.equal(result.ok, true);
  assert.equal(result.packageVersion, RELEASE_PACKAGE_VERSION);
});

test("release verifier rejects release branch version mismatch", () => {
  const tempRoot = copyFixtureRepo();
  try {
    updateJson(path.join(tempRoot, "package.json"), (json) => {
      json.version = MISMATCH_PACKAGE_VERSION;
    });
    const result = validateReleaseState({
      rootDir: tempRoot,
      releaseBranch: RELEASE_BRANCH,
      strictReleaseBranch: true,
    });
    assert.equal(result.ok, false);
    assert.match(result.findings.join("\n"), new RegExp(`expects version '${RELEASE_PACKAGE_VERSION}'`, "u"));
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
      releaseBranch: RELEASE_BRANCH,
      strictReleaseBranch: true,
    });
    assert.equal(result.ok, false);
    assert.match(result.findings.join("\n"), new RegExp(`CHANGELOG\\.md must mention '## \\[${RELEASE_PACKAGE_VERSION}\\]'`, "u"));
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
      releaseBranch: RELEASE_BRANCH,
      strictReleaseBranch: true,
    });
    assert.equal(result.ok, false);
    assert.match(result.findings.join("\n"), /package\.json name must be '@grinrus\/aor'/u);
    assert.match(result.findings.join("\n"), /packages\/contracts\/package\.json must remain private/u);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("release verifier rejects publish workflows without trusted publishing runtime pins and transaction reconciliation", () => {
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
        "      - run: node ./scripts/legacy-publish.mjs",
        "",
      ].join("\n"),
      "utf8",
    );
    const result = validateReleaseState({
      rootDir: tempRoot,
      releaseBranch: RELEASE_BRANCH,
      strictReleaseBranch: true,
    });
    assert.equal(result.ok, false);
    assert.match(result.findings.join("\n"), /node-version: 22\.14\.0/u);
    assert.match(result.findings.join("\n"), /release-publish-transaction\.mjs/u);
    assert.match(result.findings.join("\n"), /RELEASE_COMMIT_SHA/u);
    assert.doesNotMatch(result.findings.join("\n"), /npm@11\.5\.1/u);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("packed file validation rejects runtime, test, and private rehearsal artifacts", () => {
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
    "docs/ops/self-hosted-environment-matrix.md",
    ".aor/projects/run.json",
    "scripts/test/release-flow.test.mjs",
    privateRehearsalPath,
  ]);
  assert.equal(result.ok, false);
  assert.match(result.findings.join("\n"), /\.aor\/projects\/run\.json/u);
  assert.match(result.findings.join("\n"), /scripts\/test\/release-flow\.test\.mjs/u);
  assert.match(result.findings.join("\n"), new RegExp(privateRehearsalPath.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
});

test("packed file validation rejects forbidden private rehearsal tokens in packed content", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-release-packed-content-test-"));
  try {
    const docsRoot = path.join(tempRoot, "docs/contracts");
    fs.mkdirSync(docsRoot, { recursive: true });
    fs.writeFileSync(path.join(docsRoot, "00-index.md"), `# Contracts\n\nDo not expose ${privateManualCommandToken}.\n`, "utf8");

    const result = validatePackedFiles(["docs/contracts/00-index.md"], { rootDir: tempRoot });
    assert.equal(result.ok, false);
    assert.match(result.findings.join("\n"), new RegExp(privateManualCommandToken, "u"));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("publish event guard accepts only merged release PRs with publish label", () => {
  const accepted = validatePublishEvent({
    event: releaseEvent(),
    repository: "GrinRus/ai_native_sdlc_orchestrator",
    packageVersion: RELEASE_PACKAGE_VERSION,
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
    packageVersion: RELEASE_PACKAGE_VERSION,
  });
  assert.equal(missingLabel.shouldPublish, false);
  assert.match(missingLabel.findings.join("\n"), /release:publish/u);

  const mismatch = validatePublishEvent({
    event: releaseEvent(),
    repository: "GrinRus/ai_native_sdlc_orchestrator",
    packageVersion: MISMATCH_PACKAGE_VERSION,
  });
  assert.equal(mismatch.shouldPublish, false);
  assert.match(mismatch.findings.join("\n"), new RegExp(`expects version '${RELEASE_PACKAGE_VERSION}'`, "u"));
});

test("alpha publication classifier covers absent, partial, complete, and conflict states", () => {
  const cases = [
    [publicationState(), "absent"],
    [publicationState({ tag: true }), "tag-only"],
    [publicationState({ release: true }), "release-only"],
    [publicationState({ npm: true, alpha: expectedPublication.version }), "npm-only"],
    [publicationState({ tag: true, release: true, npm: true, alpha: expectedPublication.version }), "complete"],
  ];
  for (const [observed, status] of cases) {
    assert.equal(classifyAlphaPublishState({ expected: expectedPublication, observed }).status, status);
  }

  const mismatchedTag = publicationState({ tag: true });
  mismatchedTag.tag.target_sha = "2222222222222222222222222222222222222222";
  const conflict = classifyAlphaPublishState({ expected: expectedPublication, observed: mismatchedTag });
  assert.equal(conflict.status, "conflict");
  assert.match(conflict.conflicts.join("\n"), /git tag/u);
  assert.deepEqual(planAlphaPublishReconciliation(conflict).operations, []);
});

test("alpha publication plan creates only missing compatible surfaces and deletes branch only when complete", () => {
  const tagOnly = classifyAlphaPublishState({
    expected: expectedPublication,
    observed: publicationState({ tag: true }),
  });
  assert.deepEqual(planAlphaPublishReconciliation(tagOnly), {
    status: "reconcile",
    operations: ["create-release", "publish-npm"],
    delete_branch_allowed: false,
    conflicts: [],
  });

  const complete = classifyAlphaPublishState({
    expected: expectedPublication,
    observed: publicationState({
      tag: true,
      release: true,
      npm: true,
      alpha: expectedPublication.version,
    }),
  });
  assert.deepEqual(planAlphaPublishReconciliation(complete), {
    status: "complete",
    operations: ["delete-release-branch"],
    delete_branch_allowed: true,
    conflicts: [],
  });
});

test("alpha publication reconciliation resumes after every injected partial failure", async () => {
  const failureOperations = ["create-tag", "create-release", "publish-npm"];
  for (const failureOperation of failureOperations) {
    const state = publicationState();
    let failed = false;
    const execute = async (operation) => {
      if (operation === failureOperation && !failed) {
        failed = true;
        const error = new Error(`injected ${operation} failure`);
        error.code = "injected-failure";
        throw error;
      }
      if (operation === "create-tag") state.tag = publicationState({ tag: true }).tag;
      if (operation === "create-release") state.release = publicationState({ release: true }).release;
      if (operation === "publish-npm") {
        state.npm.version_exists = true;
        state.npm.alpha_version = expectedPublication.version;
      }
      if (operation === "set-alpha-dist-tag") state.npm.alpha_version = expectedPublication.version;
      if (operation === "delete-release-branch") state.branch_deleted = true;
    };

    await assert.rejects(
      reconcileAlphaPublication({
        expected: expectedPublication,
        inspect: async () => structuredClone(state),
        execute,
      }),
      new RegExp(`injected ${failureOperation} failure`, "u"),
    );
    assert.notEqual(state.branch_deleted, true);

    const resumed = await reconcileAlphaPublication({
      expected: expectedPublication,
      inspect: async () => structuredClone(state),
      execute,
    });
    assert.equal(resumed.status, "complete");
    assert.equal(state.branch_deleted, true);
  }
});

test("alpha publication conflict fails before mutation and retains recovery branch", async () => {
  const state = publicationState({ tag: true });
  state.tag.target_sha = "3333333333333333333333333333333333333333";
  const operations = [];
  await assert.rejects(
    reconcileAlphaPublication({
      expected: expectedPublication,
      inspect: async () => structuredClone(state),
      execute: async (operation) => operations.push(operation),
    }),
    (error) => error.code === "alpha-publication-conflict",
  );
  assert.deepEqual(operations, []);
});

test("alpha publication resumes a missing dist-tag without republishing the immutable npm version", async () => {
  const state = publicationState({ tag: true, release: true, npm: true });
  const operations = [];
  let injected = true;
  const execute = async (operation) => {
    operations.push(operation);
    if (operation === "set-alpha-dist-tag" && injected) {
      injected = false;
      throw new Error("injected dist-tag failure");
    }
    if (operation === "set-alpha-dist-tag") state.npm.alpha_version = expectedPublication.version;
    if (operation === "delete-release-branch") state.branch_deleted = true;
  };
  await assert.rejects(
    reconcileAlphaPublication({
      expected: expectedPublication,
      inspect: async () => structuredClone(state),
      execute,
    }),
    /injected dist-tag failure/u,
  );
  const resumed = await reconcileAlphaPublication({
    expected: expectedPublication,
    inspect: async () => structuredClone(state),
    execute,
  });
  assert.equal(resumed.status, "complete");
  assert.equal(operations.includes("publish-npm"), false);
});

test("local bare remote preserves exact tag identity used by publication reconciliation", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-alpha-publish-git-"));
  const remote = path.join(tempRoot, "remote.git");
  const source = path.join(tempRoot, "source");
  const git = (args, cwd = tempRoot) => {
    const result = spawnSync("git", args, { cwd, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  try {
    git(["init", "--bare", remote]);
    git(["init", source]);
    git(["config", "user.name", "Release Test"], source);
    git(["config", "user.email", "release@example.test"], source);
    fs.writeFileSync(path.join(source, "fixture.txt"), "alpha\n", "utf8");
    git(["add", "fixture.txt"], source);
    git(["commit", "-m", "fixture"], source);
    const sha = git(["rev-parse", "HEAD"], source);
    git(["remote", "add", "origin", remote], source);
    git(["tag", "-a", expectedPublication.tag, sha, "-m", expectedPublication.tag], source);
    git(["push", "origin", expectedPublication.tag], source);
    const remoteSha = git(["ls-remote", remote, `refs/tags/${expectedPublication.tag}^{}`], source).split(/\s+/u)[0];
    assert.equal(remoteSha, sha);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
