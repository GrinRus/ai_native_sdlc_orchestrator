import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  CONTRACT_FAMILY_INDEX as publicFamilies,
  EXAMPLE_FAMILY_RESOLUTION_RULES as publicRules,
} from "../packages/contracts/src/families.mjs";
import { CONTRACT_FAMILY_INDEX as privateFamilies } from "./live-e2e/lib/contracts/contract-kernel.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const snapshotFile = path.join(root, "scripts/live-e2e/lib/contracts/public-kernel.snapshot.json");

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function discoverKernelFiles(sourceRoot) {
  return fs.readdirSync(sourceRoot, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(?:mjs|d\.ts)$/u.test(entry.name))
    .map((entry) => path.relative(sourceRoot, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"))
    .sort();
}

function serializePublicRules() {
  return publicRules.map((entry) => ({
    regex_source: entry.regex.source,
    regex_flags: entry.regex.flags,
    family: entry.family,
  }));
}

export function buildContractKernelSnapshot(previous = {}) {
  const source = previous.source ?? "packages/contracts/src";
  const sourceRoot = path.join(root, source);
  const files = Object.fromEntries(discoverKernelFiles(sourceRoot).map((relativeFile) => [
    relativeFile,
    sha256(path.join(sourceRoot, relativeFile)),
  ]));
  return {
    schema_version: 3,
    kernel_version: Math.max(11, Number(previous.kernel_version) || 0),
    source,
    generation: {
      generator: "scripts/contract-kernel-parity.mjs",
      source_file_count: Object.keys(files).length,
      source_manifest_sha256: crypto.createHash("sha256").update(JSON.stringify(files)).digest("hex"),
    },
    files,
    contract_families: publicFamilies,
    example_family_resolution_rules: serializePublicRules(),
  };
}

export function inspectContractKernelParity(options = {}) {
  const effectiveSnapshotFile = options.snapshotFile ?? snapshotFile;
  const snapshot = JSON.parse(fs.readFileSync(effectiveSnapshotFile, "utf8"));
  const errors = [];
  if (snapshot.schema_version !== 3 || !Number.isInteger(snapshot.kernel_version)) {
    errors.push("contract kernel snapshot must declare schema_version=3 and an integer kernel_version");
  }
  const sourceRoot = path.join(root, snapshot.source);
  const discoveredFiles = discoverKernelFiles(sourceRoot);
  const pinnedFiles = Object.keys(snapshot.files ?? {}).sort();
  if (JSON.stringify(pinnedFiles) !== JSON.stringify(discoveredFiles)) {
    errors.push("public kernel source set drift requires snapshot regeneration");
  }
  for (const [relativeFile, expectedHash] of Object.entries(snapshot.files ?? {})) {
    const sourceFile = path.join(sourceRoot, relativeFile);
    if (!fs.existsSync(sourceFile)) errors.push(`missing public kernel source: ${relativeFile}`);
    else if (sha256(sourceFile) !== expectedHash) errors.push(`public kernel drift requires snapshot regeneration: ${relativeFile}`);
  }
  const expectedManifestHash = crypto.createHash("sha256").update(JSON.stringify(snapshot.files ?? {})).digest("hex");
  if (
    snapshot.generation?.generator !== "scripts/contract-kernel-parity.mjs"
    || snapshot.generation?.source_file_count !== discoveredFiles.length
    || snapshot.generation?.source_manifest_sha256 !== expectedManifestHash
  ) {
    errors.push("contract kernel generation metadata is missing or stale");
  }
  const pinnedByFamily = new Map((snapshot.contract_families ?? []).map((entry) => [entry.family, entry]));
  for (const entry of publicFamilies) {
    if (JSON.stringify(pinnedByFamily.get(entry.family)) !== JSON.stringify(entry)) {
      errors.push(`public contract metadata snapshot drift requires regeneration: ${entry.family}`);
    }
  }
  const pinnedRules = snapshot.example_family_resolution_rules ?? [];
  const effectivePublicRules = serializePublicRules();
  if (JSON.stringify(pinnedRules) !== JSON.stringify(effectivePublicRules)) {
    errors.push("public example resolution metadata snapshot drift requires regeneration");
  }
  return {
    ok: errors.length === 0,
    kernel_version: snapshot.kernel_version,
    public_family_count: publicFamilies.length,
    private_family_count: privateFamilies.length,
    errors,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--write")) {
    const previous = fs.existsSync(snapshotFile) ? JSON.parse(fs.readFileSync(snapshotFile, "utf8")) : {};
    fs.writeFileSync(snapshotFile, `${JSON.stringify(buildContractKernelSnapshot(previous), null, 2)}\n`);
  }
  const result = inspectContractKernelParity();
  if (!result.ok) {
    process.stderr.write(`${result.errors.join("\n")}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(
      `contract kernel parity ok: v${result.kernel_version}, ${result.public_family_count} public families, ${result.private_family_count} effective private families\n`,
    );
  }
}
