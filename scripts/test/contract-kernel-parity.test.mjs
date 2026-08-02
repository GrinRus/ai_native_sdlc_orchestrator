import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parse as parseYaml } from "yaml";

import { CONTRACT_FAMILY_INDEX as publicFamilies } from "../../packages/contracts/src/families.mjs";
import { validateContractDocument as validatePublicDocument } from "../../packages/contracts/src/loader.mjs";
import { CONTRACT_FAMILY_INDEX as privateFamilies } from "../live-e2e/lib/contracts/contract-kernel.mjs";
import { validateContractDocument as validateBoundaryDocument } from "../live-e2e/lib/contracts/loader.mjs";
import { inspectContractKernelParity } from "../contract-kernel-parity.mjs";

const root = path.resolve(import.meta.dirname, "../..");

test("private live-E2E contracts extend the versioned public contract kernel", () => {
  const result = inspectContractKernelParity();
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
  assert.equal(result.public_family_count, publicFamilies.length);
});

test("public contract families retain source-of-truth metadata in the private loader", () => {
  const privateByFamily = new Map(privateFamilies.map((entry) => [entry.family, entry]));
  for (const family of publicFamilies) {
    assert.deepEqual(privateByFamily.get(family.family), family);
  }
  assert.ok(privateFamilies.length > publicFamilies.length);
});

test("private boundary delegates public validation with identical diagnostics", () => {
  const source = path.join(root, "examples/project.aor.yaml");
  const valid = parseYaml(fs.readFileSync(source, "utf8"));
  const missingProjectId = { ...valid };
  delete missingProjectId.project_id;
  for (const document of [valid, missingProjectId]) {
    const publicResult = validatePublicDocument({ family: "project-profile", document, source });
    const boundaryResult = validateBoundaryDocument({ family: "project-profile", document, source });
    assert.deepEqual(boundaryResult, publicResult);
  }
});

test("snapshot parity discovers additions and removals from the complete public source set", () => {
  const snapshot = JSON.parse(
    fs.readFileSync(path.join(root, "scripts/live-e2e/lib/contracts/public-kernel.snapshot.json"), "utf8"),
  );
  delete snapshot.files["structured-task-plan.mjs"];
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-contract-snapshot-"));
  const snapshotFile = path.join(tempRoot, "snapshot.json");
  fs.writeFileSync(snapshotFile, `${JSON.stringify(snapshot, null, 2)}\n`);
  const result = inspectContractKernelParity({ snapshotFile });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /source set drift/u);
});
