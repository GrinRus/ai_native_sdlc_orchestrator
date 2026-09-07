import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { CONTRACT_FAMILY_INDEX as publicFamilies } from "../../packages/contracts/src/families.mjs";
import { loadExampleContracts } from "../../packages/contracts/src/example-loader.mjs";
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

test("private boundary preserves public example validation and missing-field diagnostics", () => {
  const loaded = loadExampleContracts({ workspaceRoot: root });
  assert.equal(loaded.ok, true, JSON.stringify(loaded.issues));
  const examplesByFamily = new Map(loaded.results.map((example) => [example.family, example]));
  for (const family of [
    "adapter-capability-profile",
    "provider-route-profile",
    "compiled-context-artifact",
    "intake-request-body",
    "artifact-packet",
    "step-result",
    "validation-report",
    "review-report",
    "review-decision",
    "live-run-event",
    "incident-report",
    "learning-loop-scorecard",
    "learning-loop-handoff",
    "runtime-harness-report",
  ]) {
    const definition = publicFamilies.find((entry) => entry.family === family);
    const example = examplesByFamily.get(family);
    assert.ok(definition, `${family} must have public contract metadata`);
    assert.ok(example, `${family} must have a canonical example`);
    const { source, document } = example;
    assert.deepEqual(
      validateBoundaryDocument({ family, document, source }),
      example.validation,
      `${family} canonical example must retain public validation`,
    );
    const requiredField = definition.requiredFields[0];
    if (!requiredField) continue;
    const missingField = { ...document };
    delete missingField[requiredField];
    const publicResult = validatePublicDocument({ family, document: missingField, source });
    assert.equal(publicResult.ok, false, `${family} must reject missing ${requiredField}`);
    assert.deepEqual(
      validateBoundaryDocument({ family, document: missingField, source }),
      publicResult,
      `${family} missing-field diagnostics must match public validation`,
    );
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
