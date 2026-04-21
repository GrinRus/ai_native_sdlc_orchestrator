import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { invokeCli } from "../src/index.mjs";

const currentFilePath = fileURLToPath(import.meta.url);
const fixturesDir = path.join(path.dirname(currentFilePath), "fixtures");

/**
 * @param {(projectRoot: string) => void} callback
 */
function withTempProject(callback) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-cli-w1-s01-"));
  try {
    callback(tempRoot);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

test("global help transcript matches fixture", () => {
  const expected = fs.readFileSync(path.join(fixturesDir, "help-transcript.txt"), "utf8");
  const result = invokeCli(["--help"]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, expected);
});

test("implemented command help documents inputs outputs and contracts", () => {
  const result = invokeCli(["project", "init", "--help"]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /Status: implemented in bootstrap shell \(W1-S01\)/);
  assert.match(result.stdout, /Inputs: --project-ref <path>, --runtime-root <path> \(optional\), --help/);
  assert.match(result.stdout, /Outputs: resolved_project_ref, resolved_runtime_root, contract_families, command_catalog_alignment/);
  assert.match(result.stdout, /Contract families: project-profile/);
});

test("unknown command fails clearly", () => {
  const result = invokeCli(["project", "unknown"]);

  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Unknown command 'project unknown'/);
});

test("missing required project-ref fails clearly", () => {
  const result = invokeCli(["project", "analyze"]);

  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Missing required flag '--project-ref'/);
});

test("invalid project-ref fails clearly", () => {
  const result = invokeCli(["project", "validate", "--project-ref", "./does-not-exist"]);

  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Invalid --project-ref '\.\/does-not-exist': path does not exist\./);
});

test("planned commands report not implemented status", () => {
  const result = invokeCli(["run", "start"]);

  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Command 'aor run start' is planned and not implemented yet\./);
});

test("project verify resolves runtime root and contract metadata", () => {
  withTempProject((projectRoot) => {
    const result = invokeCli(["project", "verify", "--project-ref", projectRoot]);

    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");

    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.command, "project verify");
    assert.equal(parsed.status, "implemented");
    assert.equal(parsed.resolved_project_ref, projectRoot);
    assert.equal(parsed.resolved_runtime_root, path.join(projectRoot, ".aor"));
    assert.equal(parsed.command_catalog_alignment, "docs/architecture/14-cli-command-catalog.md");

    assert.deepEqual(parsed.contract_families, [
      {
        family: "step-result",
        group: "execution-and-quality",
        source_contract: "docs/contracts/step-result.md",
        status: "implemented",
      },
    ]);
  });
});
