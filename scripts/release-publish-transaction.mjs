#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import process from "node:process";

import { RELEASE_PACKAGE_NAME } from "./release-lib.mjs";
import { reconcileAlphaPublication } from "./release-publish-transaction-lib.mjs";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
  });
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}.`);
  }
  return result;
}

function output(command, args) {
  const result = run(command, args, { capture: true, allowFailure: true });
  return result.status === 0 ? result.stdout.trim() : null;
}

const version = process.env.RELEASE_VERSION;
const tag = process.env.RELEASE_TAG;
const commitSha = process.env.RELEASE_COMMIT_SHA ?? process.env.GITHUB_SHA;
const releaseBranch = process.env.AOR_RELEASE_BRANCH;
const repository = process.env.GITHUB_REPOSITORY;
if (!version || !tag || !commitSha || !releaseBranch || !repository) {
  process.stderr.write("RELEASE_VERSION, RELEASE_TAG, RELEASE_COMMIT_SHA/GITHUB_SHA, AOR_RELEASE_BRANCH, and GITHUB_REPOSITORY are required.\n");
  process.exit(1);
}

const expected = {
  version,
  tag,
  commit_sha: commitSha,
  release_title: `AOR ${tag}`,
  release_notes: `npm CLI alpha release for ${RELEASE_PACKAGE_NAME}@${version}. npm dist-tag: alpha. Release gate: pnpm release:gate.`,
};

async function inspect() {
  const tagTarget = output("git", ["ls-remote", "origin", `refs/tags/${tag}^{}`])
    ?? output("git", ["ls-remote", "origin", `refs/tags/${tag}`]);
  const releaseJson = output("gh", ["api", `repos/${repository}/releases/tags/${tag}`]);
  const npmVersion = output("npm", ["view", `${RELEASE_PACKAGE_NAME}@${version}`, "version"]);
  const alphaVersion = output("npm", ["view", RELEASE_PACKAGE_NAME, "dist-tags.alpha"]);
  const release = releaseJson ? JSON.parse(releaseJson) : null;
  return {
    tag: {
      exists: tagTarget !== null,
      target_sha: tagTarget?.split(/\s+/u)[0] ?? null,
    },
    release: {
      exists: release !== null,
      tag: release?.tag_name ?? null,
      target_sha: release?.target_commitish ?? null,
      prerelease: release?.prerelease ?? null,
      title: release?.name ?? null,
      notes: release?.body ?? null,
    },
    npm: {
      version_exists: npmVersion === version,
      alpha_version: alphaVersion,
    },
  };
}

async function execute(operation) {
  if (operation === "create-tag") {
    run("git", ["config", "user.name", "github-actions[bot]"]);
    run("git", ["config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"]);
    run("git", ["tag", "-a", tag, commitSha, "-m", tag]);
    run("git", ["push", "origin", tag]);
    return;
  }
  if (operation === "create-release") {
    run("gh", [
      "release", "create", tag,
      "--target", commitSha,
      "--prerelease",
      "--title", expected.release_title,
      "--notes", expected.release_notes,
    ]);
    return;
  }
  if (operation === "publish-npm") {
    run("npm", ["publish", "--access", "public", "--tag", "alpha", "--provenance"]);
    return;
  }
  if (operation === "set-alpha-dist-tag") {
    run("npm", ["dist-tag", "add", `${RELEASE_PACKAGE_NAME}@${version}`, "alpha"]);
    return;
  }
  if (operation === "delete-release-branch") {
    run("git", ["push", "origin", "--delete", releaseBranch]);
    return;
  }
  throw new Error(`Unsupported alpha publication operation '${operation}'.`);
}

try {
  const result = await reconcileAlphaPublication({
    expected,
    inspect,
    execute,
    onTransition(transition) {
      process.stdout.write(`${JSON.stringify({
        state: transition.classification.status,
        surfaces: transition.classification.surfaces,
        next_operations: transition.plan.operations,
      })}\n`);
    },
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
