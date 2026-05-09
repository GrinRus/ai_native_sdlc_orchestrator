import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentFilePath = fileURLToPath(import.meta.url);
const workspaceRoot = path.resolve(path.dirname(currentFilePath), "../..");

function runChecked(command, args, options = {}) {
  const run = spawnSync(command, args, {
    cwd: options.cwd ?? workspaceRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      ...(options.env ?? {}),
    },
  });
  assert.equal(
    run.status,
    0,
    `${command} ${args.join(" ")} failed\nstdout:\n${run.stdout}\nstderr:\n${run.stderr}`,
  );
  return run;
}

function parsePnpmJsonOutput(stdout) {
  const jsonStart = stdout.indexOf("{\n");
  assert.notEqual(jsonStart, -1, `expected JSON object in output:\n${stdout}`);
  return JSON.parse(stdout.slice(jsonStart));
}

function runAorJson(args) {
  const run = runChecked("pnpm", ["aor", ...args, "--json"]);
  return parsePnpmJsonOutput(run.stdout);
}

function createTargetRepo(tempRoot) {
  const targetRepo = path.join(tempRoot, "local-project");
  fs.mkdirSync(path.join(targetRepo, "src"), { recursive: true });
  fs.writeFileSync(path.join(targetRepo, "README.md"), "# Local project\n", "utf8");
  fs.writeFileSync(
    path.join(targetRepo, "package.json"),
    `${JSON.stringify(
      {
        name: "local-project",
        private: true,
        version: "0.0.0",
        type: "module",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  fs.writeFileSync(path.join(targetRepo, "src/index.js"), "export const ok = true;\n", "utf8");
  runChecked("git", ["init", "-b", "main"], { cwd: targetRepo });
  runChecked("git", ["config", "user.email", "local@example.com"], { cwd: targetRepo });
  runChecked("git", ["config", "user.name", "Local User"], { cwd: targetRepo });
  runChecked("git", ["add", "-A"], { cwd: targetRepo });
  runChecked("git", ["commit", "-m", "init local project"], { cwd: targetRepo });
  return targetRepo;
}

function assertOnlyRuntimeStateChanged(targetRepo) {
  const status = runChecked("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
    cwd: targetRepo,
  }).stdout
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean);

  assert.ok(status.length > 0, "expected README smoke to write runtime state under .aor/");
  for (const line of status) {
    const changedPath = line.slice(3);
    assert.match(changedPath, /^\.aor\//u, `unexpected target repo change outside .aor/: ${line}`);
  }
}

test("README black-box quickstart runs no-write against an external local target repo", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-readme-black-box-"));
  try {
    const targetRepo = createTargetRepo(tempRoot);
    const runtimeRoot = path.join(targetRepo, ".aor");
    const baseArgs = ["--project-ref", targetRepo, "--runtime-root", runtimeRoot];

    const doctor = runAorJson(["doctor", ...baseArgs]);
    assert.equal(doctor.command, "doctor");
    assert.equal(doctor.guided_status, "ready");

    const onboard = runAorJson(["onboard", ...baseArgs]);
    assert.equal(onboard.command, "onboard");
    assert.equal(onboard.guided_status, "ready");
    assert.equal(onboard.asset_mode, "bundled");
    assert.ok(fs.existsSync(onboard.onboarding_report_file));
    assert.ok(fs.existsSync(onboard.artifact_packet_file));
    assert.ok(fs.existsSync(onboard.runtime_state_file));
    assert.match(onboard.project_profile_ref, /^\.aor\/projects\/local-project\/state\/project\.aor\.yaml$/u);

    const mission = runAorJson([
      "mission",
      "create",
      ...baseArgs,
      "--title",
      "Small safe trial",
      "--brief",
      "Inspect the project and recommend the next no-write step",
      "--goal",
      "Produce bounded next-action evidence",
      "--constraint",
      "No upstream writes, no target file edits, and no external runner execution",
      "--kpi",
      "trial-ready:Trial readiness:ready:status",
      "--dod",
      "No upstream writes are attempted",
      "--delivery-mode",
      "no-write",
    ]);
    assert.equal(mission.command, "mission create");
    assert.equal(mission.guided_status, "ready");
    assert.equal(mission.delivery_mode, "no-write");
    assert.ok(fs.existsSync(mission.artifact_packet_file));
    assert.ok(fs.existsSync(mission.artifact_packet_body_file));

    const next = runAorJson(["next", ...baseArgs]);
    assert.equal(next.command, "next");
    assert.equal(next.guided_status, "ready");
    assert.equal(next.next_action_status, "ready");
    assert.equal(next.next_action_bounded_execution?.requested_delivery_mode, "no-write");
    assert.equal(next.next_action_bounded_execution?.upstream_writes_default, false);
    assert.ok(fs.existsSync(next.next_action_report_file));
    assert.match(next.next_action_report_file, /\/\.aor\/projects\/local-project\/reports\/next-action-report\.json$/u);

    assertOnlyRuntimeStateChanged(targetRepo);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
