import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { harnessStatePath } from "./harness.mjs";

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed:\n${result.stderr}`);
}

function installPackedCli(root, tempRoot) {
  const packRoot = path.join(tempRoot, "pack");
  const installRoot = path.join(tempRoot, "installed package");
  fs.mkdirSync(packRoot, { recursive: true });
  fs.mkdirSync(installRoot, { recursive: true });
  const packed = spawnSync("npm", ["pack", "--json", "--pack-destination", packRoot], { cwd: root, encoding: "utf8" });
  if (packed.status !== 0) throw new Error(`npm pack failed:\n${packed.stderr}`);
  const metadata = JSON.parse(packed.stdout.slice(packed.stdout.indexOf("[")))[0];
  const tarball = path.join(packRoot, metadata.filename);
  fs.writeFileSync(path.join(installRoot, "package.json"), '{"private":true,"type":"module"}\n');
  run("npm", ["install", "--no-audit", "--ignore-scripts", "--no-fund", tarball], installRoot);
  return {
    installedBin: path.join(installRoot, "node_modules/@grinrus/aor/apps/cli/bin/aor.mjs"),
    packageName: metadata.name,
    packageVersion: metadata.version,
  };
}

export default async function globalSetup() {
  const root = process.cwd();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-w59-browser-"));
  const launcherRoot = path.join(tempRoot, "neutral launcher");
  const aorHome = path.join(tempRoot, "aor-home");
  fs.mkdirSync(launcherRoot, { recursive: true });
  const installed = installPackedCli(root, tempRoot);
  const projectRoot = path.join(tempRoot, "browser target Δ");
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.writeFileSync(path.join(projectRoot, "README.md"), "# Browser target\n");
  fs.writeFileSync(path.join(projectRoot, "package.json"), '{"name":"browser-target","private":true}\n');
  run("git", ["init", "-b", "main"], projectRoot);
  run("git", ["config", "user.email", "browser@example.com"], projectRoot);
  run("git", ["config", "user.name", "Browser Fixture"], projectRoot);
  run("git", ["add", "-A"], projectRoot);
  run("git", ["commit", "-m", "fixture"], projectRoot);

  const child = spawn(
    process.execPath,
    [
      installed.installedBin,
      "app",
      "--project-ref",
      projectRoot,
      "--host",
      "127.0.0.1",
      "--port",
      "0",
      "--open",
      "false",
      "--json",
    ],
    {
      cwd: launcherRoot,
      env: { ...process.env, AOR_HOME: aorHome },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  const deadline = Date.now() + 15_000;
  let summary = null;
  while (Date.now() < deadline) {
    const trimmed = stdout.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      summary = JSON.parse(trimmed);
      break;
    }
    if (child.exitCode !== null) throw new Error(`aor app exited early:\n${stderr}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!summary?.app_url) {
    process.kill(-child.pid, "SIGTERM");
    throw new Error(`Timed out waiting for aor app URL.\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  }

  fs.mkdirSync(path.dirname(harnessStatePath), { recursive: true });
  fs.writeFileSync(
    harnessStatePath,
    `${JSON.stringify({
      schema_version: 1,
      pid: child.pid,
      temp_root: tempRoot,
      project_root: projectRoot,
      runtime_root: path.join(projectRoot, ".aor"),
      app_url: summary.app_url,
      project_id: summary.project_id,
      installed_bin: installed.installedBin,
      package_name: installed.packageName,
      package_version: installed.packageVersion,
      launcher_root: launcherRoot,
      aor_home: aorHome,
    }, null, 2)}\n`,
  );
  child.unref();
}
