import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { analyzeProjectRuntime } from "../src/project-analysis.mjs";
import { validateProjectRuntime } from "../src/project-validate.mjs";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const workspaceRoot = path.resolve(currentDir, "../../..");

/**
 * @param {(repoRoot: string) => void} callback
 */
function withTempRepo(callback) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-w1-s04-"));
  fs.mkdirSync(path.join(repoRoot, ".git"), { recursive: true });
  fs.cpSync(path.join(workspaceRoot, "examples"), path.join(repoRoot, "examples"), { recursive: true });

  try {
    callback(repoRoot);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
}

test("validateProjectRuntime emits pass status when safety checks and analysis report are present", () => {
  withTempRepo((repoRoot) => {
    fs.writeFileSync(
      path.join(repoRoot, "package.json"),
      JSON.stringify({ name: "fixture", scripts: { lint: "echo lint", test: "echo test", build: "echo build" } }, null, 2),
      "utf8",
    );

    analyzeProjectRuntime({ projectRef: repoRoot, cwd: repoRoot });
    const result = validateProjectRuntime({ projectRef: repoRoot, cwd: repoRoot });

    assert.equal(result.report.status, "pass");
    assert.equal(result.blocking, false);
    assert.equal(fs.existsSync(result.validationReportPath), true);
  });
});

test("validateProjectRuntime emits fail status for unsafe writeback policy", () => {
  withTempRepo((repoRoot) => {
    const profilePath = path.join(repoRoot, "examples/project.aor.yaml");
    const profileContent = fs.readFileSync(profilePath, "utf8");
    fs.writeFileSync(
      profilePath,
      profileContent.replace("allow_direct_write: false", "allow_direct_write: true"),
      "utf8",
    );

    const result = validateProjectRuntime({ projectRef: repoRoot, cwd: repoRoot });

    assert.equal(result.report.status, "fail");
    assert.equal(result.blocking, true);
    assert.ok(
      result.report.validators.some(
        (validator) =>
          validator.validator_id === "writeback-safety" && validator.status === "fail",
      ),
      "expected writeback-safety validator to fail",
    );
  });
});
