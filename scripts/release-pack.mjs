#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import process from "node:process";

import { packedFilesFromNpmPackJson, validatePackedFiles } from "./release-lib.mjs";

const packRun = spawnSync("npm", ["pack", "--dry-run", "--json"], {
  cwd: process.cwd(),
  encoding: "utf8",
});

if (packRun.status !== 0) {
  process.stderr.write(packRun.stderr || packRun.stdout || "npm pack --dry-run failed.\n");
  process.exit(packRun.status ?? 1);
}

const jsonStart = packRun.stdout.indexOf("[");
if (jsonStart < 0) {
  process.stderr.write(`npm pack --dry-run did not return JSON:\n${packRun.stdout}\n`);
  process.exit(1);
}

const packJson = JSON.parse(packRun.stdout.slice(jsonStart));
const files = packedFilesFromNpmPackJson(packJson);
const validation = validatePackedFiles(files);

if (!validation.ok) {
  process.stderr.write("release pack failed:\n");
  for (const finding of validation.findings) {
    process.stderr.write(`- ${finding}\n`);
  }
  process.exit(1);
}

process.stdout.write(`release pack ok: ${files.length} files in npm dry-run artifact\n`);
