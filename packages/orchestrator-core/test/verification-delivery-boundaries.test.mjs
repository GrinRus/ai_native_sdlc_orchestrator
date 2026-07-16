import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  DELIVERY_PLAN_STAGES,
  DELIVERY_TRANSACTION_STAGES,
  VERIFICATION_TRANSACTION_STAGES,
} from "../src/verification-delivery-transactions.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

test("verification and delivery stages expose explicit side-effect ownership", () => {
  assert.equal(VERIFICATION_TRANSACTION_STAGES[0], "resolve-inputs");
  assert.equal(DELIVERY_PLAN_STAGES.includes("authorize-exact-diff"), true);
  assert.equal(DELIVERY_TRANSACTION_STAGES.at(-1), "rollback-or-retain-recovery");
});

test("public verification and delivery facades remain bounded coordinators", () => {
  for (const [file, name] of [
    ["project-verify.mjs", "verifyProjectRuntime"],
    ["delivery-plan.mjs", "materializeDeliveryPlan"],
    ["delivery-driver.mjs", "runDeliveryDriver"],
    ["delivery-mode-runners.mjs", "runForkFirstPrDeliveryMode"],
  ]) {
    const source = fs.readFileSync(path.join(root, "packages/orchestrator-core/src", file), "utf8");
    const match = new RegExp(`export function ${name}\\([^]*?\\n\\}`, "u").exec(source);
    assert.ok(match, `${name} export must exist`);
    assert.ok(match[0].split("\n").length <= 8, `${name} must stay bounded`);
    assert.match(match[0], /runTransactionCoordinator/u);
  }
});
