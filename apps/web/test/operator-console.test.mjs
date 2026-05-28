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
    "Create Mission Packet & Resolve Next Action",
    "Mission intake",
    "Flow selector",
    "Active flows",
    "Completed flows (read-only)",
    "Flow completed - evidence locked",
    "Start New Flow",
    "Create follow-up from learning handoff",
    "Duplicate mission settings",
    "follow-up-source-handoff-ref",
    "Evidence Graph",
    "Runtime Trace",
    "Next action",
    "Evidence refs",
    "No upstream writes",
    "/flows/selected",
    "/evidence-graph",
    "/runtime-trace",
    "lifecycle-command/actions",
    "operator-requests",
    "target_flow_id",
    "Create and run request",
    "Create no-write inspection request",
    "Add at least one target ref",
    "operator-request.completed",
    "mission create",
    "next",
    "next?.document ?? next",
  ]) {
    assert.ok(source.includes(required), `SPA source should include '${required}'`);
  }
  assert.ok(css.includes(".app-shell"), "SPA CSS should define app shell layout");
  assert.ok(css.includes(".flow-selector"), "SPA CSS should define flow selector layout");
  assert.ok(css.includes(".flow-cockpit"), "SPA CSS should define flow-first cockpit layout");
  assert.ok(css.includes(".stage-rail"), "SPA CSS should define flow-scoped stage rail layout");
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

test("aor app smoke verifies the real flow-centric packaged SPA, config, and state routes", () => {
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
    assert.equal(payload.flow_selector_loaded, true);
    assert.equal(payload.new_flow_action_loaded, true);
    assert.equal(payload.config_project_id, payload.project_id);
    assert.equal(payload.state_project_id, payload.project_id);
    assert.equal(payload.runtime_root, runtimeRoot);
  });
});
