import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentFilePath = fileURLToPath(import.meta.url);
const workspaceRoot = path.resolve(path.dirname(currentFilePath), "../../..");
const cliPath = path.join(workspaceRoot, "apps/cli/bin/aor.mjs");

/**
 * @param {string[]} args
 * @param {string} cwd
 * @returns {Record<string, unknown>}
 */
function runCliJson(args, cwd) {
  const run = spawnSync(process.execPath, [cliPath, ...args, "--json"], {
    cwd,
    encoding: "utf8",
  });
  assert.equal(run.status, 0, `${run.stderr}\n${run.stdout}`);
  return JSON.parse(run.stdout);
}

test("intake create preserves goal, KPI, and Definition of Done flags in product intake", () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-intake-create-"));
  try {
    const gitInit = spawnSync("git", ["init"], { cwd: repoRoot, encoding: "utf8" });
    assert.equal(gitInit.status, 0, gitInit.stderr || gitInit.stdout);
    fs.cpSync(path.join(workspaceRoot, "examples"), path.join(repoRoot, "examples"), { recursive: true });

    const result = runCliJson(
      [
        "intake",
        "create",
        "--project-ref",
        repoRoot,
        "--runtime-root",
        path.join(repoRoot, ".aor"),
        "--mission-id",
        "catalog-mission",
        "--request-title",
        "Catalog mission",
        "--request-brief",
        "Exercise one bounded catalog mission.",
        "--request-constraints",
        "No upstream writes",
        "--goal",
        "Preserve complete intake evidence",
        "--kpi",
        "intake-complete:Intake completeness:complete:product intake gate",
        "--dod",
        "Generated intake packet records KPI and DoD evidence",
      ],
      workspaceRoot,
    );

    const bodyFile = String(result.artifact_packet_body_file);
    assert.equal(fs.existsSync(bodyFile), true);
    const body = JSON.parse(fs.readFileSync(bodyFile, "utf8"));

    assert.equal(body.product_intake_completeness.status, "complete");
    assert.deepEqual(body.product_intake.goals, ["Preserve complete intake evidence"]);
    assert.deepEqual(body.product_intake.definition_of_done, [
      "Generated intake packet records KPI and DoD evidence",
    ]);
    assert.deepEqual(body.product_intake.kpis, [
      {
        kpi_id: "intake-complete",
        name: "Intake completeness",
        target: "complete",
        measurement: "product intake gate",
      },
    ]);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});
