#!/usr/bin/env node
import process from "node:process";

import { validateReleaseState } from "./release-lib.mjs";

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--strict-release-branch") {
      options.strictReleaseBranch = true;
      continue;
    }
    if (arg === "--release-branch") {
      const value = argv[index + 1];
      if (!value) throw new Error("--release-branch requires a value.");
      options.releaseBranch = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument '${arg}'.`);
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
const result = validateReleaseState(options);

if (options.json) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else if (result.ok) {
  process.stdout.write(
    `release verify ok: ${result.packageName}@${result.packageVersion} (${result.releaseBranch || "no branch"})\n`,
  );
} else {
  process.stderr.write("release verify failed:\n");
  for (const finding of result.findings) {
    process.stderr.write(`- ${finding}\n`);
  }
}

process.exit(result.ok ? 0 : 1);
