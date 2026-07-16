#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

function runChecked(command, args, options = {}) {
  const env = {
    ...process.env,
    ...(options.env ?? {}),
  };
  delete env.AOR_BOOTSTRAP_ASSETS_ROOT;
  delete env.AOR_EXAMPLES_ROOT;

  const run = spawnSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    encoding: "utf8",
    env,
  });
  if (run.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed\nstdout:\n${run.stdout}\nstderr:\n${run.stderr}`);
  }
  return run;
}

function parseJsonOutput(stdout) {
  const jsonStart = stdout.indexOf("{\n");
  if (jsonStart < 0) {
    throw new Error(`Expected JSON object in output:\n${stdout}`);
  }
  return JSON.parse(stdout.slice(jsonStart));
}

function createTargetRepo(tempRoot) {
  const targetRepo = path.join(tempRoot, "target repo Δ");
  fs.mkdirSync(path.join(targetRepo, "src"), { recursive: true });
  fs.writeFileSync(path.join(targetRepo, "README.md"), "# Package smoke target\n", "utf8");
  fs.writeFileSync(
    path.join(targetRepo, "package.json"),
    `${JSON.stringify(
      {
        name: "package-smoke-target",
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
  runChecked("git", ["config", "user.email", "smoke@example.com"], { cwd: targetRepo });
  runChecked("git", ["config", "user.name", "Smoke User"], { cwd: targetRepo });
  runChecked("git", ["add", "-A"], { cwd: targetRepo });
  runChecked("git", ["commit", "-m", "init smoke target"], { cwd: targetRepo });
  return targetRepo;
}

function assertOnlyRuntimeStateChanged(targetRepo) {
  const status = runChecked("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
    cwd: targetRepo,
  }).stdout
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean);

  if (status.length === 0) {
    throw new Error("Expected package smoke to write runtime state under .aor/.");
  }
  for (const line of status) {
    const changedPath = line.slice(3);
    if (!changedPath.startsWith(".aor/")) {
      throw new Error(`Unexpected target repo change outside .aor/: ${line}`);
    }
  }
}

const sourceRoot = process.cwd();
const reportPath = path.join(sourceRoot, "node_modules/.cache/aor/release-smoke-report.json");
const report = {
  schema_version: 1,
  status: "running",
  git_head: null,
  node_version: process.version,
  started_at: new Date().toISOString(),
  finished_at: null,
  package_name: null,
  package_version: null,
  assertions: {
    clean_neutral_launcher: false,
    first_load_non_materializing: false,
    explicit_mutation_smoke: false,
    primary_head_unchanged: false,
    primary_tracked_files_unchanged: false,
    writes_confined_to_runtime_root: false,
    upstream_writes: false,
    credentialed_provider_calls: false
  }
};

function writeReport() {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-release-smoke-"));
try {
  const packDestination = path.join(tempRoot, "pack");
  const installRoot = path.join(tempRoot, "install");
  const launcherRoot = path.join(tempRoot, "neutral launcher");
  fs.mkdirSync(packDestination, { recursive: true });
  fs.mkdirSync(installRoot, { recursive: true });
  fs.mkdirSync(launcherRoot, { recursive: true });

  report.git_head = runChecked("git", ["rev-parse", "HEAD"], { cwd: sourceRoot }).stdout.trim();
  const packageMetadata = JSON.parse(fs.readFileSync(path.join(sourceRoot, "package.json"), "utf8"));
  report.package_name = packageMetadata.name;
  report.package_version = packageMetadata.version;
  writeReport();

  const packRun = runChecked("npm", ["pack", "--json", "--pack-destination", packDestination]);
  const packJson = JSON.parse(packRun.stdout.slice(packRun.stdout.indexOf("[")));
  const tarballName = packJson[0]?.filename;
  if (typeof tarballName !== "string" || tarballName.length === 0) {
    throw new Error(`Could not resolve npm pack tarball from output:\n${packRun.stdout}`);
  }
  const tarballPath = path.join(packDestination, tarballName);

  fs.writeFileSync(
    path.join(installRoot, "package.json"),
    `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`,
    "utf8",
  );
  runChecked("npm", ["install", "--no-audit", "--ignore-scripts", "--no-fund", tarballPath], {
    cwd: installRoot,
  });

  const installedBin = path.join(installRoot, "node_modules/@grinrus/aor/apps/cli/bin/aor.mjs");
  const help = runChecked(process.execPath, [installedBin, "--help"], { cwd: launcherRoot });
  if (!help.stdout.includes("AOR CLI")) {
    throw new Error(`Installed package help output did not look like AOR help:\n${help.stdout}`);
  }

  const appHelp = runChecked(process.execPath, [installedBin, "app", "--help"], { cwd: launcherRoot });
  if (!appHelp.stdout.includes("local loopback web console") || !appHelp.stdout.includes("--smoke --open false --json")) {
    throw new Error(`Installed package app help did not preserve optional API/web boundary:\n${appHelp.stdout}`);
  }

  const targetRepo = createTargetRepo(tempRoot);
  const runtimeRoot = path.join(targetRepo, ".aor");
  const baseArgs = ["--project-ref", targetRepo, "--runtime-root", runtimeRoot, "--json"];
  const primaryHead = runChecked("git", ["rev-parse", "HEAD"], { cwd: targetRepo }).stdout.trim();

  const doctor = parseJsonOutput(runChecked(process.execPath, [installedBin, "doctor", ...baseArgs], { cwd: launcherRoot }).stdout);
  if (doctor.command !== "doctor" || doctor.guided_status !== "ready") {
    throw new Error(`Installed package doctor smoke failed:\n${JSON.stringify(doctor, null, 2)}`);
  }

  const cleanAppSmoke = parseJsonOutput(
    runChecked(process.execPath, [
      installedBin,
      "app",
      "--project-ref",
      targetRepo,
      "--runtime-root",
      runtimeRoot,
      "--smoke",
      "true",
      "--open",
      "false",
      "--json",
    ], { cwd: launcherRoot }).stdout,
  );
  if (cleanAppSmoke.status !== "smoke-pass" || fs.existsSync(runtimeRoot)) {
    throw new Error("Installed package first-load app smoke materialized runtime state or failed.");
  }
  report.assertions.first_load_non_materializing = true;

  const onboard = parseJsonOutput(runChecked(process.execPath, [installedBin, "onboard", ...baseArgs], { cwd: launcherRoot }).stdout);
  if (onboard.command !== "onboard" || onboard.guided_status !== "ready" || onboard.asset_mode !== "bundled") {
    throw new Error(`Installed package onboard smoke failed:\n${JSON.stringify(onboard, null, 2)}`);
  }
  if (!fs.existsSync(onboard.onboarding_report_file) || !fs.existsSync(onboard.runtime_state_file)) {
    throw new Error("Installed package onboard smoke did not write expected runtime evidence.");
  }
  report.assertions.explicit_mutation_smoke = true;

  const appSmoke = parseJsonOutput(
    runChecked(process.execPath, [
      installedBin,
      "app",
      "--project-ref",
      targetRepo,
      "--runtime-root",
      runtimeRoot,
      "--smoke",
      "true",
      "--open",
      "false",
      "--json",
    ], { cwd: launcherRoot }).stdout,
  );
  if (
    appSmoke.command !== "app" ||
    appSmoke.status !== "smoke-pass" ||
    appSmoke.html_loaded !== true ||
    appSmoke.flow_selector_loaded !== true ||
    appSmoke.new_flow_action_loaded !== true ||
    appSmoke.first_run_wizard_loaded !== true ||
    appSmoke.project_switcher_loaded !== true ||
    appSmoke.config_project_id !== appSmoke.project_id ||
    appSmoke.config_default_project_id !== appSmoke.project_id ||
    appSmoke.project_index_default_project_id !== appSmoke.project_id ||
    appSmoke.project_index_count !== 1 ||
    appSmoke.state_project_id !== appSmoke.project_id
  ) {
    throw new Error(`Installed package app smoke failed:\n${JSON.stringify(appSmoke, null, 2)}`);
  }

  assertOnlyRuntimeStateChanged(targetRepo);
  const finalHead = runChecked("git", ["rev-parse", "HEAD"], { cwd: targetRepo }).stdout.trim();
  const trackedDiff = runChecked("git", ["diff", "--name-only", "HEAD", "--"], { cwd: targetRepo }).stdout.trim();
  const launcherEntries = fs.readdirSync(launcherRoot);
  if (launcherEntries.length > 0) {
    throw new Error(`Neutral launcher was materialized: ${launcherEntries.join(", ")}`);
  }
  report.assertions.clean_neutral_launcher = true;
  report.assertions.primary_head_unchanged = finalHead === primaryHead;
  report.assertions.primary_tracked_files_unchanged = trackedDiff === "";
  report.assertions.writes_confined_to_runtime_root = true;
  if (!report.assertions.primary_head_unchanged || !report.assertions.primary_tracked_files_unchanged) {
    throw new Error("Package smoke changed the target repository HEAD or tracked files.");
  }
  report.status = "pass";
  report.finished_at = new Date().toISOString();
  writeReport();
  process.stdout.write(
    `release smoke ok: installed ${tarballName}; neutral launcher stayed clean and target writes stayed under .aor/\n`,
  );
} catch (error) {
  report.status = "fail";
  report.finished_at = new Date().toISOString();
  report.failure = error instanceof Error ? error.message : String(error);
  writeReport();
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
