import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  CERTIFICATION_PROJECTION_STAGES,
  NEXT_ACTION_PROJECTION_STAGES,
  RUN_READ_PROJECTION_STAGES,
} from "../src/operator-projection-services.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

test("operator projection stages keep reads, policy, and persistence explicit", () => {
  assert.equal(NEXT_ACTION_PROJECTION_STAGES.includes("select-safe-action"), true);
  assert.equal(RUN_READ_PROJECTION_STAGES.at(-1), "paginate");
  assert.equal(CERTIFICATION_PROJECTION_STAGES[0], "validate-prerequisites");
});

test("public operator projection facades remain bounded and transport neutral", () => {
  for (const [file, name] of [
    ["next-action.mjs", "resolveNextAction"],
    ["control-plane/read-run-projections.mjs", "listRuns"],
    ["certification-decision.mjs", "certifyAssetPromotion"],
  ]) {
    const source = fs.readFileSync(path.join(root, "packages/orchestrator-core/src", file), "utf8");
    const match = new RegExp(`export function ${name}\\([^\\n]*\\{[^\\n]*\\}`, "u").exec(source);
    assert.ok(match, `${name} export must exist`);
    assert.ok(match[0].split("\n").length <= 8, `${name} must stay bounded`);
    assert.match(match[0], /runProjectionCoordinator/u);
    assert.doesNotMatch(source, /from ["'][^"']*apps\/(?:api|cli|web)/u);
  }
});
