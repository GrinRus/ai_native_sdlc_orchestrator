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
  const targetRepo = path.join(tempRoot, "target-repo");
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

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-release-smoke-"));
try {
  const packDestination = path.join(tempRoot, "pack");
  const installRoot = path.join(tempRoot, "install");
  fs.mkdirSync(packDestination, { recursive: true });
  fs.mkdirSync(installRoot, { recursive: true });

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
  const help = runChecked(process.execPath, [installedBin, "--help"], { cwd: installRoot });
  if (!help.stdout.includes("AOR CLI")) {
    throw new Error(`Installed package help output did not look like AOR help:\n${help.stdout}`);
  }

  const appHelp = runChecked(process.execPath, [installedBin, "app", "--help"], { cwd: installRoot });
  if (!appHelp.stdout.includes("local loopback web console") || !appHelp.stdout.includes("--smoke --open false --json")) {
    throw new Error(`Installed package app help did not preserve optional API/web boundary:\n${appHelp.stdout}`);
  }

  const targetRepo = createTargetRepo(tempRoot);
  const runtimeRoot = path.join(targetRepo, ".aor");
  const baseArgs = ["--project-ref", targetRepo, "--runtime-root", runtimeRoot, "--json"];

  const doctor = parseJsonOutput(runChecked(process.execPath, [installedBin, "doctor", ...baseArgs]).stdout);
  if (doctor.command !== "doctor" || doctor.guided_status !== "ready") {
    throw new Error(`Installed package doctor smoke failed:\n${JSON.stringify(doctor, null, 2)}`);
  }

  const onboard = parseJsonOutput(runChecked(process.execPath, [installedBin, "onboard", ...baseArgs]).stdout);
  if (onboard.command !== "onboard" || onboard.guided_status !== "ready" || onboard.asset_mode !== "bundled") {
    throw new Error(`Installed package onboard smoke failed:\n${JSON.stringify(onboard, null, 2)}`);
  }
  if (!fs.existsSync(onboard.onboarding_report_file) || !fs.existsSync(onboard.runtime_state_file)) {
    throw new Error("Installed package onboard smoke did not write expected runtime evidence.");
  }

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
    ]).stdout,
  );
  if (
    appSmoke.command !== "app" ||
    appSmoke.status !== "smoke-pass" ||
    appSmoke.html_loaded !== true ||
    appSmoke.flow_selector_loaded !== true ||
    appSmoke.new_flow_action_loaded !== true ||
    appSmoke.config_project_id !== appSmoke.project_id ||
    appSmoke.state_project_id !== appSmoke.project_id
  ) {
    throw new Error(`Installed package app smoke failed:\n${JSON.stringify(appSmoke, null, 2)}`);
  }

  assertOnlyRuntimeStateChanged(targetRepo);
  process.stdout.write(`release smoke ok: installed ${tarballName} and ran no-write onboarding plus flow-centric local app smoke\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
