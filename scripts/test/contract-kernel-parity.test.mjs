import assert from "node:assert/strict";
import test from "node:test";

import { CONTRACT_FAMILY_INDEX as publicFamilies } from "../../packages/contracts/src/families.mjs";
import { CONTRACT_FAMILY_INDEX as privateFamilies } from "../live-e2e/lib/contracts/contract-kernel.mjs";
import { inspectContractKernelParity } from "../contract-kernel-parity.mjs";

test("private live-E2E contracts extend the versioned public contract kernel", () => {
  const result = inspectContractKernelParity();
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
  assert.equal(result.public_family_count, publicFamilies.length);
});

test("public contract families retain source-of-truth identity in the private loader", () => {
  const privateByFamily = new Map(privateFamilies.map((entry) => [entry.family, entry]));
  for (const family of publicFamilies) {
    assert.equal(privateByFamily.get(family.family), family);
  }
  assert.ok(privateFamilies.length > publicFamilies.length);
});
