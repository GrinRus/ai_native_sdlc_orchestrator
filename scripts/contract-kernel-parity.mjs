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

export function inspectContractKernelParity() {
  const snapshot = JSON.parse(fs.readFileSync(snapshotFile, "utf8"));
  const errors = [];
  if (snapshot.schema_version !== 2 || !Number.isInteger(snapshot.kernel_version)) {
    errors.push("contract kernel snapshot must declare schema_version=2 and an integer kernel_version");
  }
  for (const [relativeFile, expectedHash] of Object.entries(snapshot.files ?? {})) {
    const sourceFile = path.join(root, snapshot.source, relativeFile);
    if (!fs.existsSync(sourceFile)) errors.push(`missing public kernel source: ${relativeFile}`);
    else if (sha256(sourceFile) !== expectedHash) errors.push(`public kernel drift requires snapshot regeneration: ${relativeFile}`);
  }
  const pinnedByFamily = new Map((snapshot.contract_families ?? []).map((entry) => [entry.family, entry]));
  for (const entry of publicFamilies) {
    if (JSON.stringify(pinnedByFamily.get(entry.family)) !== JSON.stringify(entry)) {
      errors.push(`public contract metadata snapshot drift requires regeneration: ${entry.family}`);
    }
  }
  const pinnedRules = snapshot.example_family_resolution_rules ?? [];
  const effectivePublicRules = publicRules.map((entry) => ({
    regex_source: entry.regex.source,
    regex_flags: entry.regex.flags,
    family: entry.family,
  }));
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
