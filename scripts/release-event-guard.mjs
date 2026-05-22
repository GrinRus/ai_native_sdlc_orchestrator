#!/usr/bin/env node
import fs from "node:fs";
import process from "node:process";

import { validatePublishEvent, validateReleaseState } from "./release-lib.mjs";

const eventPath = process.env.GITHUB_EVENT_PATH;
if (!eventPath) {
  process.stderr.write("GITHUB_EVENT_PATH is required.\n");
  process.exit(1);
}

const releaseState = validateReleaseState({
  releaseBranch: process.env.AOR_RELEASE_BRANCH,
  strictReleaseBranch: true,
});
if (!releaseState.ok) {
  process.stderr.write("release event guard failed release-state validation:\n");
  for (const finding of releaseState.findings) {
    process.stderr.write(`- ${finding}\n`);
  }
  process.exit(1);
}

const event = JSON.parse(fs.readFileSync(eventPath, "utf8"));
const eventValidation = validatePublishEvent({
  event,
  repository: process.env.GITHUB_REPOSITORY,
  packageVersion: releaseState.packageVersion,
});

if (!eventValidation.shouldPublish) {
  process.stderr.write("release event guard rejected publish:\n");
  for (const finding of eventValidation.findings) {
    process.stderr.write(`- ${finding}\n`);
  }
  process.exit(1);
}

const output = {
  package_name: releaseState.packageName,
  version: releaseState.packageVersion,
  tag: `v${releaseState.packageVersion}`,
  release_branch: eventValidation.releaseBranch,
};

if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(
    process.env.GITHUB_OUTPUT,
    Object.entries(output)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n") + "\n",
    "utf8",
  );
}

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
