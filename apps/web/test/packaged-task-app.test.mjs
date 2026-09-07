import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentFilePath = fileURLToPath(import.meta.url);
const workspaceRoot = path.resolve(path.dirname(currentFilePath), "../../..");

/**
 * @param {(projectRoot: string) => void} callback
 */
function withTempProject(callback) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-web-app-smoke-"));
  try {
    callback(tempRoot);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

test("web package no longer exports static operator snapshot modules", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(workspaceRoot, "apps/web/package.json"), "utf8"));
  const oldScriptName = `operator-console-${"smoke"}.mjs`;
  const oldEntryName = `operator-console${".mjs"}`;
  const oldSourceDir = `operator-${"console"}`;
  assert.deepEqual(manifest.exports, {});
  assert.equal(fs.existsSync(path.join(workspaceRoot, "apps/web/scripts", oldScriptName)), false);
  assert.equal(fs.existsSync(path.join(workspaceRoot, "apps/web/src", oldEntryName)), false);
  assert.equal(fs.existsSync(path.join(workspaceRoot, "apps/web/src", oldSourceDir)), false);
});

test("aor app smoke verifies the packaged Task Workspace, config, and state routes", () => {
  withTempProject((projectRoot) => {
    fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
    const runtimeRoot = path.join(projectRoot, ".aor");
    const run = spawnSync(
      process.execPath,
      [
        path.join(workspaceRoot, "apps/cli/bin/aor.mjs"),
        "app",
        "--project-ref",
        projectRoot,
        "--smoke",
        "true",
        "--open",
        "false",
        "--json",
      ],
      {
        cwd: projectRoot,
        encoding: "utf8",
        env: { ...process.env, AOR_HOME: runtimeRoot },
      },
    );
    assert.equal(run.status, 0, run.stderr);
    const payload = JSON.parse(run.stdout);
    assert.equal(payload.command, "app");
    assert.equal(payload.mode, "local-spa");
    assert.equal(payload.status, "smoke-pass");
    assert.equal(payload.html_loaded, true);
    assert.equal(payload.task_workspace_loaded, true);
    assert.equal(payload.new_task_action_loaded, true);
    assert.equal(payload.prepare_task_action_loaded, true);
    assert.equal(payload.project_switcher_loaded, true);
    assert.equal(payload.legacy_surface_absent, true);
    assert.equal(payload.config_project_id, payload.project_id);
    assert.equal(payload.config_default_project_id, payload.project_id);
    assert.equal(payload.project_index_default_project_id, payload.project_id);
    assert.equal(payload.project_index_count, 1);
    assert.equal(payload.state_project_id, payload.project_id);
    assert.equal(payload.render_guard_status, "pass");
    assert.equal(payload.blank_root_regression_detected, false);
    assert.equal(payload.render_guard.root_element_present, true);
    assert.ok(payload.render_guard.module_script_count >= 1);
    assert.ok(payload.render_guard.stylesheet_count >= 1);
    assert.equal(payload.render_guard.app_shell_marker_present, true);
    assert.equal(Object.prototype.hasOwnProperty.call(payload, "runtime_root"), false);
  });
});
