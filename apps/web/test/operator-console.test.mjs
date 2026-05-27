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

test("packaged SPA exposes installed-user guided mission controls", () => {
  const source = fs.readFileSync(path.join(workspaceRoot, "apps/web/src/spa.jsx"), "utf8");
  const css = fs.readFileSync(path.join(workspaceRoot, "apps/web/src/spa.css"), "utf8");

  for (const required of [
    "safe-walkthrough",
    "Create mission",
    "Mission intake",
    "Next action",
    "Evidence refs",
    "No upstream writes",
    "lifecycle-command/actions",
    "operator-requests",
    "Create and run request",
    "operator-request.completed",
    "mission create",
    "next",
    "next?.document ?? next",
  ]) {
    assert.ok(source.includes(required), `SPA source should include '${required}'`);
  }
  assert.ok(css.includes(".app-shell"), "SPA CSS should define app shell layout");
  assert.ok(css.includes(".stage-rail"), "SPA CSS should define guided stage rail layout");
  assert.ok(css.includes(".right-rail"), "SPA CSS should define evidence rail layout");
});

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

test("aor app smoke verifies the real packaged SPA, config, and state routes", () => {
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
        "--runtime-root",
        runtimeRoot,
        "--smoke",
        "true",
        "--open",
        "false",
        "--json",
      ],
      {
        cwd: projectRoot,
        encoding: "utf8",
      },
    );
    assert.equal(run.status, 0, run.stderr);
    const payload = JSON.parse(run.stdout);
    assert.equal(payload.command, "app");
    assert.equal(payload.mode, "local-spa");
    assert.equal(payload.status, "smoke-pass");
    assert.equal(payload.html_loaded, true);
    assert.equal(payload.config_project_id, payload.project_id);
    assert.equal(payload.state_project_id, payload.project_id);
    assert.equal(payload.runtime_root, runtimeRoot);
  });
});
