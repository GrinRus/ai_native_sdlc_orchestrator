import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { invokeCli } from "../src/index.mjs";

const currentFilePath = fileURLToPath(import.meta.url);
const fixturesDir = path.join(path.dirname(currentFilePath), "fixtures");
const workspaceRoot = path.resolve(path.dirname(currentFilePath), "../../..");

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
  assert.match(
    result.stdout,
    /Inputs: --project-ref <path> \(optional, defaults to cwd discovery\), --project-profile <path> \(optional\), --runtime-root <path> \(optional\), --help/,
  );
  assert.match(
    result.stdout,
    /Outputs: resolved_project_ref, resolved_runtime_root, project_profile_ref, runtime_layout, runtime_state_file, contract_families, command_catalog_alignment/,
  );
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
  assert.match(result.stderr, /Invalid project reference '\.\/does-not-exist': path does not exist\./);
});

test("planned commands report not implemented status", () => {
  const result = invokeCli(["run", "start"]);

  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Command 'aor run start' is planned and not implemented yet\./);
});

test("project verify resolves runtime root and contract metadata", () => {
  withTempProject((projectRoot) => {
    fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
    fs.cpSync(path.join(workspaceRoot, "examples"), path.join(projectRoot, "examples"), { recursive: true });
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

test("project init discovers repo root from cwd and materializes runtime layout idempotently", () => {
  withTempProject((projectRoot) => {
    fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, "examples"), { recursive: true });
    fs.copyFileSync(
      path.join(workspaceRoot, "examples/project.aor.yaml"),
      path.join(projectRoot, "examples/project.aor.yaml"),
    );

    const nestedCwd = path.join(projectRoot, "nested", "workspace");
    fs.mkdirSync(nestedCwd, { recursive: true });

    const firstRun = invokeCli(["project", "init"], { cwd: nestedCwd });
    const secondRun = invokeCli(["project", "init"], { cwd: nestedCwd });

    assert.equal(firstRun.exitCode, 0, firstRun.stderr);
    assert.equal(secondRun.exitCode, 0, secondRun.stderr);

    const firstPayload = JSON.parse(firstRun.stdout);
    const secondPayload = JSON.parse(secondRun.stdout);

    assert.equal(firstPayload.resolved_project_ref, projectRoot);
    assert.equal(secondPayload.resolved_project_ref, projectRoot);
    assert.equal(firstPayload.project_profile_ref, "examples/project.aor.yaml");
    assert.equal(secondPayload.project_profile_ref, "examples/project.aor.yaml");
    assert.equal(firstPayload.runtime_state_file, secondPayload.runtime_state_file);
    assert.equal(fs.existsSync(firstPayload.runtime_state_file), true);

    const runtimeState = JSON.parse(fs.readFileSync(firstPayload.runtime_state_file, "utf8"));
    assert.equal(runtimeState.project_id, "aor-core");
    assert.equal(runtimeState.selected_profile_ref, "examples/project.aor.yaml");
    assert.equal(runtimeState.project_root, projectRoot);
  });
});

test("project analyze writes durable analysis report under runtime root", () => {
  withTempProject((projectRoot) => {
    fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, "examples"), { recursive: true });
    fs.copyFileSync(
      path.join(workspaceRoot, "examples/project.aor.yaml"),
      path.join(projectRoot, "examples/project.aor.yaml"),
    );
    fs.writeFileSync(
      path.join(projectRoot, "package.json"),
      JSON.stringify({ name: "fixture", scripts: { lint: "eslint .", test: "node --test", build: "tsc -b" } }, null, 2),
      "utf8",
    );
    fs.writeFileSync(path.join(projectRoot, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\\n", "utf8");

    const result = invokeCli(["project", "analyze", "--project-ref", projectRoot]);

    assert.equal(result.exitCode, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.analysis_report_id, "aor-core.analysis.v1");
    assert.equal(fs.existsSync(parsed.analysis_report_file), true);

    const report = JSON.parse(fs.readFileSync(parsed.analysis_report_file, "utf8"));
    assert.equal(report.project_id, "aor-core");
    assert.equal(report.status, "ready-for-bootstrap");
  });
});

test("project validate writes validation report with deterministic status", () => {
  withTempProject((projectRoot) => {
    fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
    fs.cpSync(path.join(workspaceRoot, "examples"), path.join(projectRoot, "examples"), { recursive: true });

    const result = invokeCli(["project", "validate", "--project-ref", projectRoot]);
    assert.equal(result.exitCode, 0, result.stderr);

    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.validation_report_id, "aor-core.validation.v1");
    assert.equal(fs.existsSync(parsed.validation_report_file), true);
    assert.ok(parsed.validation_status === "pass" || parsed.validation_status === "warn");
  });
});

test("project verify refuses to continue when validation gate is enforced and status is fail", () => {
  withTempProject((projectRoot) => {
    fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
    fs.cpSync(path.join(workspaceRoot, "examples"), path.join(projectRoot, "examples"), { recursive: true });
    const profilePath = path.join(projectRoot, "examples/project.aor.yaml");
    const profileContent = fs.readFileSync(profilePath, "utf8");
    fs.writeFileSync(
      profilePath,
      profileContent.replace("allow_direct_write: false", "allow_direct_write: true"),
      "utf8",
    );

    const validateResult = invokeCli(["project", "validate", "--project-ref", projectRoot]);
    assert.equal(validateResult.exitCode, 0, validateResult.stderr);

    const verifyResult = invokeCli([
      "project",
      "verify",
      "--project-ref",
      projectRoot,
      "--require-validation-pass",
    ]);

    assert.equal(verifyResult.exitCode, 1);
    assert.match(verifyResult.stderr, /Validation gate blocked verify flow/);
  });
});
