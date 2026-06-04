import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentFilePath = fileURLToPath(import.meta.url);
const workspaceRoot = path.resolve(path.dirname(currentFilePath), "../..");
const packageVersion = JSON.parse(fs.readFileSync(path.join(workspaceRoot, "package.json"), "utf8")).version;
const registryPackageSpec = `@grinrus/aor@${packageVersion}`;

function readRepoFile(filePath) {
  return fs.readFileSync(path.join(workspaceRoot, filePath), "utf8");
}

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

function runAorJson(args, env = {}) {
  const run = runChecked("pnpm", ["aor", ...args, "--json"], { env });
  return parsePnpmJsonOutput(run.stdout);
}

function parseJsonObject(stdout) {
  const jsonStart = stdout.indexOf("{\n");
  assert.notEqual(jsonStart, -1, `expected JSON object in output:\n${stdout}`);
  return JSON.parse(stdout.slice(jsonStart));
}

function createFakePnpmBin(tempRoot) {
  const binRoot = path.join(tempRoot, "fake-pnpm-bin");
  fs.mkdirSync(binRoot, { recursive: true });
  const pnpmPath = path.join(binRoot, "pnpm");
  fs.writeFileSync(
    pnpmPath,
    [
      "#!/usr/bin/env node",
      "const { spawnSync } = require('node:child_process');",
      "const args = process.argv.slice(2);",
      "if (args[0] === 'aor') {",
      `  const run = spawnSync(process.execPath, [${JSON.stringify(
        path.join(workspaceRoot, "apps/cli/bin/aor.mjs"),
      )}, ...args.slice(1)], { cwd: ${JSON.stringify(workspaceRoot)}, encoding: 'utf8' });`,
      "  process.stdout.write(run.stdout || '');",
      "  process.stderr.write(run.stderr || '');",
      "  process.exit(run.status ?? 1);",
      "}",
      "process.stderr.write(`unsupported fake pnpm invocation: ${args.join(' ')}\\n`);",
      "process.exit(1);",
      "",
    ].join("\n"),
    "utf8",
  );
  fs.chmodSync(pnpmPath, 0o755);
  return binRoot;
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
    const fakePnpmBin = createFakePnpmBin(tempRoot);
    const env = {
      PATH: [fakePnpmBin, process.env.PATH].filter(Boolean).join(path.delimiter),
    };

    const doctor = runAorJson(["doctor", ...baseArgs], env);
    assert.equal(doctor.command, "doctor");
    assert.equal(doctor.guided_status, "ready");

    const onboard = runAorJson(["onboard", ...baseArgs], env);
    assert.equal(onboard.command, "onboard");
    assert.equal(onboard.guided_status, "ready");
    assert.equal(onboard.asset_mode, "bundled");
    assert.ok(fs.existsSync(onboard.onboarding_report_file));
    assert.ok(fs.existsSync(onboard.artifact_packet_file));
    assert.ok(fs.existsSync(onboard.runtime_state_file));
    assert.match(onboard.project_profile_ref, /^\.aor\/projects\/local-project\/state\/project\.aor\.yaml$/u);

    const mission = runAorJson(
      [
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
      ],
      env,
    );
    assert.equal(mission.command, "mission create");
    assert.equal(mission.guided_status, "ready");
    assert.equal(mission.delivery_mode, "no-write");
    assert.ok(fs.existsSync(mission.artifact_packet_file));
    assert.ok(fs.existsSync(mission.artifact_packet_body_file));

    const next = runAorJson(["next", ...baseArgs], env);
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

test("installed-user docs require neutral registry package smoke", () => {
  for (const filePath of [
    "README.md",
    "docs/ops/installed-user-first-run.md",
    "docs/ops/npm-cli-alpha-release.md",
  ]) {
    const content = readRepoFile(filePath);
    assert.ok(content.includes('mkdir -p "$TMP/target" "$TMP/runner"'), `${filePath} must create separate target and runner directories.`);
    assert.ok(content.includes('cd "$TMP/runner"'), `${filePath} must run registry smoke from the neutral runner directory.`);
    assert.ok(
      content.includes(`npm exec --yes --package ${registryPackageSpec} -- aor --help`),
      `${filePath} must prove the published package help command.`,
    );
    assert.ok(
      content.includes(`--package ${registryPackageSpec} --`),
      `${filePath} must pin npm exec to the current published package version.`,
    );
    assert.match(content, /source checkout/u, `${filePath} must warn against source-checkout package shadowing.`);
  }
});

test("documented app smoke does not initialize clean target runtime", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-readme-app-smoke-"));
  try {
    runChecked("pnpm", ["web:build"]);
    const targetRepo = createTargetRepo(tempRoot);
    const runtimeRoot = path.join(targetRepo, ".aor");
    const run = runChecked(process.execPath, [
      path.join(workspaceRoot, "apps/cli/bin/aor.mjs"),
      "app",
      "--project-ref",
      targetRepo,
      "--runtime-root",
      runtimeRoot,
      "--smoke",
      "--open",
      "false",
      "--json",
    ], {
      cwd: path.join(tempRoot),
    });
    const smoke = parseJsonObject(run.stdout);
    assert.equal(smoke.status, "smoke-pass");
    assert.equal(smoke.first_run_wizard_loaded, true);
    assert.equal(smoke.project_switcher_loaded, true);
    assert.equal(smoke.flow_selector_loaded, true);
    assert.equal(smoke.new_flow_action_loaded, true);
    assert.equal(smoke.runtime_root, runtimeRoot);
    assert.equal(fs.existsSync(runtimeRoot), false, "clean app smoke must not create .aor before explicit initialization");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
