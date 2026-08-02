#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  CONTRACT_FAMILY_INDEX,
  EXAMPLE_FAMILY_RESOLUTION_RULES,
} from "../packages/contracts/src/families.mjs";

const root = path.resolve(import.meta.dirname, "..");
const source = "packages/contracts/src";
const snapshotFile = path.join(root, "scripts/live-e2e/lib/contracts/public-kernel.snapshot.json");

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

const previous = JSON.parse(fs.readFileSync(snapshotFile, "utf8"));
const files = Object.fromEntries(
  Object.keys(previous.files).sort().map((relativeFile) => [relativeFile, sha256(path.join(root, source, relativeFile))]),
);
const snapshot = {
  schema_version: 2,
  kernel_version: previous.kernel_version + 1,
  source,
  files,
  contract_families: CONTRACT_FAMILY_INDEX,
  example_family_resolution_rules: EXAMPLE_FAMILY_RESOLUTION_RULES.map((entry) => ({
    regex_source: entry.regex.source,
    regex_flags: entry.regex.flags,
    family: entry.family,
  })),
};
fs.writeFileSync(snapshotFile, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
