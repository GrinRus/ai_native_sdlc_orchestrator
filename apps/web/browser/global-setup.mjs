import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { harnessStatePath } from "./harness.mjs";

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed:\n${result.stderr}`);
}

export default async function globalSetup() {
  const root = process.cwd();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-w59-browser-"));
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
      path.join(root, "apps/cli/bin/aor.mjs"),
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
      cwd: tempRoot,
      env: { ...process.env, AOR_HOME: path.join(tempRoot, "aor-home") },
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
    }, null, 2)}\n`,
  );
  child.unref();
}
