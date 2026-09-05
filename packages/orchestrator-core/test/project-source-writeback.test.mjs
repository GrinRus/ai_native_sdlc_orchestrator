import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { withTempRepo } from "../../../scripts/test/helpers/temp-repo.mjs";
import { createLocalProjectRegistry } from "../src/control-plane/local-project-registry.mjs";
import { connectAdditionalRepository, createProjectConnectionJob, deleteProjectData, disconnectProject, readProjectConnectionJob } from "../src/control-plane/project-source.mjs";
import { openNativeFolderPicker } from "../src/control-plane/folder-picker.mjs";
import { exportEvidence, materializeProjectConfig, ProjectWritebackError } from "../src/project-writeback.mjs";
import { deriveManagedRepositoryId, sanitizeGitUrl } from "../src/aor-home.mjs";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

async function waitForConnectionJob(aorHome, accepted) {
  let job = accepted;
  for (let attempt = 0; attempt < 300 && ["queued", "running"].includes(job.status); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    job = readProjectConnectionJob(aorHome, accepted.job_id);
  }
  return job;
}

test("native folder picker selects platform commands and keeps a manual fallback", () => {
  const calls = [];
  const exec = (command, args) => {
    calls.push([command, args]);
    return "/tmp/repository\n";
  };
  assert.equal(openNativeFolderPicker({ platform: "darwin", exec }).path, "/tmp/repository");
  assert.equal(calls.at(-1)[0], "osascript");
  assert.equal(openNativeFolderPicker({ platform: "win32", exec }).path, "/tmp/repository");
  assert.equal(calls.at(-1)[0], "powershell");
  assert.equal(openNativeFolderPicker({ platform: "linux", exec }).path, "/tmp/repository");
  assert.equal(calls.at(-1)[0], "zenity");

  const fallbackCalls = [];
  const unavailable = openNativeFolderPicker({
    platform: "linux",
    exec(command) {
      fallbackCalls.push(command);
      throw new Error("not installed");
    },
  });
  assert.deepEqual(fallbackCalls, ["zenity", "kdialog"]);
  assert.equal(unavailable.status, "unavailable");
  assert.match(unavailable.recovery, /absolute path/u);
});

test("managed repository identity normalizes long uncontrolled slug input in linear time", () => {
  const startedAt = performance.now();
  const repositoryId = deriveManagedRepositoryId(`https://example.com/${"!".repeat(250_000)}repository.git`);
  assert.match(repositoryId, /^repository-[a-f0-9]{12}$/u);
  assert.ok(performance.now() - startedAt < 1_000);
});

test("local source connection publishes a durable asynchronous job without target writes", async () => {
  await withTempRepo({ prefix: "aor-source-", workspaceRoot }, async (projectRoot) => {
    const aorHome = fs.mkdtempSync(path.join(os.tmpdir(), "aor-source-home-"));
    try {
      const registry = createLocalProjectRegistry({ cwd: projectRoot, projects: [], persistence: { mode: "persistent", root: aorHome } });
      const accepted = createProjectConnectionJob({ registry, source: { kind: "local", path: projectRoot } });
      let job = accepted;
      for (let attempt = 0; attempt < 100 && ["queued", "running"].includes(job.status); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        job = readProjectConnectionJob(aorHome, accepted.job_id);
      }
      assert.equal(job.status, "succeeded", job.error);
      assert.equal(job.progress.percent, 100);
      assert.equal(job.source_summary.stable_mount, "repos/main");
      assert.match(job.project_id, /-[0-9a-f]{8}$/u);
      assert.equal(fs.existsSync(path.join(projectRoot, ".aor")), false);
      assert.equal(fs.statSync(aorHome).mode & 0o777, 0o700);
      assert.equal(fs.statSync(path.join(aorHome, "workspace", "registry.json")).mode & 0o777, 0o600);
      assert.equal(readProjectConnectionJob(aorHome, "../registry"), null);

      const duplicate = await waitForConnectionJob(aorHome, createProjectConnectionJob({ registry, source: { kind: "local", path: projectRoot } }));
      assert.equal(duplicate.status, "succeeded", duplicate.error);
      assert.equal(duplicate.project_id, job.project_id);
      assert.equal(registry.listContexts().length, 1);
    } finally { fs.rmSync(aorHome, { recursive: true, force: true }); }
  });
});

test("local source connection rejects missing and non-Git directories without publishing a project", async () => {
  const aorHome = fs.mkdtempSync(path.join(os.tmpdir(), "aor-source-invalid-home-"));
  const nonGit = fs.mkdtempSync(path.join(os.tmpdir(), "aor-source-non-git-"));
  try {
    const registry = createLocalProjectRegistry({ cwd: nonGit, projects: [], persistence: { mode: "persistent", root: aorHome } });
    const missing = await waitForConnectionJob(aorHome, createProjectConnectionJob({ registry, source: { kind: "local", path: path.join(nonGit, "missing") } }));
    assert.equal(missing.status, "failed");
    const invalid = await waitForConnectionJob(aorHome, createProjectConnectionJob({ registry, source: { kind: "local", path: nonGit } }));
    assert.equal(invalid.status, "failed");
    assert.match(invalid.error, /Git repository/u);
    assert.equal(registry.listContexts().length, 0);
  } finally {
    fs.rmSync(aorHome, { recursive: true, force: true });
    fs.rmSync(nonGit, { recursive: true, force: true });
  }
});

test("HTTPS managed clone uses system Git, verifies origin and HEAD, and publishes atomically", async () => {
  await withTempRepo({ prefix: "aor-source-origin-", workspaceRoot }, async (originRoot) => {
    const aorHome = fs.mkdtempSync(path.join(os.tmpdir(), "aor-source-clone-home-"));
    const url = "https://example.invalid/repository.git";
    const saved = Object.fromEntries(["GIT_CONFIG_COUNT", "GIT_CONFIG_KEY_0", "GIT_CONFIG_VALUE_0", "GIT_ALLOW_PROTOCOL"].map((key) => [key, process.env[key]]));
    try {
      process.env.GIT_CONFIG_COUNT = "1";
      process.env.GIT_CONFIG_KEY_0 = `url.file://${originRoot}/.insteadOf`;
      process.env.GIT_CONFIG_VALUE_0 = url;
      process.env.GIT_ALLOW_PROTOCOL = "file:https";
      const registry = createLocalProjectRegistry({ cwd: originRoot, projects: [], persistence: { mode: "persistent", root: aorHome } });
      const accepted = createProjectConnectionJob({ registry, source: { kind: "git", url } });
      let job = accepted;
      for (let attempt = 0; attempt < 300 && ["queued", "running"].includes(job.status); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        job = readProjectConnectionJob(aorHome, accepted.job_id);
      }
      assert.equal(job.status, "succeeded", job.error);
      assert.equal(job.source.local_path, undefined, "managed AOR Home paths are not public job fields");
      const checkout = path.join(aorHome, "repositories", job.source.repository_id, "checkout");
      assert.equal(spawnSync("git", ["-C", checkout, "rev-parse", "--verify", "HEAD"]).status, 0);
      assert.equal(spawnSync("git", ["-C", checkout, "remote", "get-url", "origin"]).status, 0);
      assert.deepEqual(fs.readdirSync(path.join(aorHome, "tmp")), []);
      assert.throws(() => sanitizeGitUrl("https://user:secret@example.com/repository.git"), /credentials/u);
      assert.equal(sanitizeGitUrl("ssh://git@example.com/repository.git"), "ssh://git@example.com/repository.git");
    } finally {
      for (const [key, value] of Object.entries(saved)) value === undefined ? delete process.env[key] : process.env[key] = value;
      fs.rmSync(aorHome, { recursive: true, force: true });
    }
  });
});

test("SSH-style managed clone uses the system Git rewrite and publishes a verified checkout", async () => {
  await withTempRepo({ prefix: "aor-source-ssh-origin-", workspaceRoot }, async (originRoot) => {
    const aorHome = fs.mkdtempSync(path.join(os.tmpdir(), "aor-source-ssh-home-"));
    const url = "git@example.invalid:repository.git";
    const keys = ["GIT_CONFIG_COUNT", "GIT_CONFIG_KEY_0", "GIT_CONFIG_VALUE_0", "GIT_ALLOW_PROTOCOL"];
    const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    try {
      process.env.GIT_CONFIG_COUNT = "1";
      process.env.GIT_CONFIG_KEY_0 = `url.file://${originRoot}/.insteadOf`;
      process.env.GIT_CONFIG_VALUE_0 = url;
      process.env.GIT_ALLOW_PROTOCOL = "file:ssh";
      const registry = createLocalProjectRegistry({ cwd: originRoot, projects: [], persistence: { mode: "persistent", root: aorHome } });
      const job = await waitForConnectionJob(aorHome, createProjectConnectionJob({ registry, source: { kind: "git", url } }));
      assert.equal(job.status, "succeeded", job.error);
      assert.equal(job.source.clone_source, url);
      const checkout = path.join(aorHome, "repositories", job.source.repository_id, "checkout");
      assert.equal(spawnSync("git", ["-C", checkout, "rev-parse", "--verify", "HEAD"]).status, 0);
      assert.deepEqual(fs.readdirSync(path.join(aorHome, "tmp")), []);
    } finally {
      for (const [key, value] of Object.entries(saved)) value === undefined ? delete process.env[key] : process.env[key] = value;
      fs.rmSync(aorHome, { recursive: true, force: true });
    }
  });
});

test("clone authentication or transport failures stay recoverable without partial publication", async () => {
  await withTempRepo({ prefix: "aor-source-failed-clone-", workspaceRoot }, async (projectRoot) => {
    const aorHome = fs.mkdtempSync(path.join(os.tmpdir(), "aor-source-failed-clone-home-"));
    try {
      const registry = createLocalProjectRegistry({ cwd: projectRoot, projects: [], persistence: { mode: "persistent", root: aorHome } });
      const source = { kind: "git", url: "https://127.0.0.1:1/private.git" };
      const first = await waitForConnectionJob(aorHome, createProjectConnectionJob({ registry, source }));
      assert.equal(first.status, "failed");
      assert.match(first.error, /connect|failed|refused|unable/u);
      assert.deepEqual(fs.readdirSync(path.join(aorHome, "tmp")), []);
      assert.equal(fs.existsSync(path.join(aorHome, "repositories", deriveManagedRepositoryId(source.url), "checkout")), false);

      const retry = await waitForConnectionJob(aorHome, createProjectConnectionJob({ registry, source }));
      assert.equal(retry.status, "failed");
      assert.notEqual(retry.job_id, first.job_id);
      assert.deepEqual(fs.readdirSync(path.join(aorHome, "tmp")), []);
    } finally { fs.rmSync(aorHome, { recursive: true, force: true }); }
  });
});

test("additional repositories use the same source union and receive inferred identity and mount", async () => {
  await withTempRepo({ prefix: "aor-primary-", workspaceRoot }, async (projectRoot) => {
    await withTempRepo({ prefix: "aor-secondary-", workspaceRoot }, (secondaryRoot) => {
      const aorHome = fs.mkdtempSync(path.join(os.tmpdir(), "aor-additional-home-"));
      try {
        const registry = createLocalProjectRegistry({ cwd: projectRoot, projects: [{ projectRef: projectRoot }], persistence: { mode: "persistent", root: aorHome } });
        const result = connectAdditionalRepository({ registry, projectId: registry.defaultProjectId, source: { kind: "local", path: secondaryRoot }, label: "Secondary" });
        assert.match(result.repository_id, /^aor-secondary-[a-z0-9]+-[0-9a-f]{8}$/u);
        assert.equal(result.stable_mount, `repos/${result.repository_id}`);
        assert.equal(result.topology.repositories.some((entry) => entry.repo_id === result.repository_id), true);
        assert.equal(result.topology.bindings.some((entry) => entry.repo_id === result.repository_id && entry.inspection.status === "available"), true);
      } finally { fs.rmSync(aorHome, { recursive: true, force: true }); }
    });
  });
});

test("portable config and selected evidence export are explicit and never stage Git files", async () => {
  await withTempRepo({ prefix: "aor-writeback-", workspaceRoot }, (projectRoot) => {
    const aorHome = fs.mkdtempSync(path.join(os.tmpdir(), "aor-writeback-home-"));
    try {
      const registry = createLocalProjectRegistry({ cwd: projectRoot, projects: [{ projectRef: projectRoot }], persistence: { mode: "persistent", root: aorHome } });
      const projectId = registry.defaultProjectId;
      const materialized = materializeProjectConfig({ registry, projectId });
      assert.equal(materialized.project_profile_ref, ".aor/project.yaml");
      assert.equal(fs.readFileSync(materialized.file, "utf8").includes(aorHome), false);

      const context = registry.getContext(projectId);
      fs.mkdirSync(path.join(context.projectRuntimeRoot, "reports"), { recursive: true });
      const report = path.join(context.projectRuntimeRoot, "reports", "review-report.json");
      fs.writeFileSync(report, "{\"status\":\"pass\"}\n", { mode: 0o600 });
      const exported = exportEvidence({ registry, projectId, flowId: "flow.test", exportId: "evidence-export.test", evidenceRefs: [`evidence://projects/${projectId}/reports/review-report.json`] });
      assert.equal(exported.manifest.entries.length, 1);
      assert.equal(exported.manifest.entries[0].sha256.length, 64);
      assert.equal(fs.existsSync(path.join(exported.directory, "evidence-export-manifest.json")), true);
      assert.equal(spawnSync("git", ["-C", projectRoot, "diff", "--cached", "--quiet"]).status, 0);
      const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-writeback-outside-"));
      try {
        fs.writeFileSync(path.join(outsideRoot, "secret.json"), "secret\n", { mode: 0o600 });
        fs.symlinkSync(path.join(outsideRoot, "secret.json"), path.join(context.projectRuntimeRoot, "reports", "external.json"), "file");
        assert.throws(() => exportEvidence({ registry, projectId, flowId: "flow.test", exportId: "external", evidenceRefs: [`evidence://projects/${projectId}/reports/external.json`] }), ProjectWritebackError);
      } finally { fs.rmSync(outsideRoot, { recursive: true, force: true }); }
      assert.throws(() => exportEvidence({ registry, projectId, flowId: "flow.test", exportId: "bad", evidenceRefs: [`evidence://projects/${projectId}/inputs/private.txt`] }), ProjectWritebackError);
      fs.mkdirSync(path.join(context.projectRuntimeRoot, "logs"), { recursive: true });
      fs.writeFileSync(path.join(context.projectRuntimeRoot, "logs", "provider-raw.log"), "secret");
      assert.throws(() => exportEvidence({ registry, projectId, flowId: "flow.test", exportId: "bad-log", evidenceRefs: [`evidence://projects/${projectId}/logs/provider-raw.log`] }), ProjectWritebackError);
      assert.throws(() => exportEvidence({ registry, projectId, flowId: "../escape", exportId: "bad-id", evidenceRefs: [`evidence://projects/${projectId}/reports/review-report.json`] }), /canonical public identifier/u);
      assert.throws(() => exportEvidence({ registry, projectId, flowId: "flow.test", exportId: "../escape", evidenceRefs: [`evidence://projects/${projectId}/reports/review-report.json`] }), /canonical public identifier/u);
    } finally { fs.rmSync(aorHome, { recursive: true, force: true }); }
  });
});

test("portable materialization strips secrets and absolute paths inside arrays", async () => {
  await withTempRepo({ prefix: "aor-portable-", workspaceRoot }, (projectRoot) => {
    const aorHome = fs.mkdtempSync(path.join(os.tmpdir(), "aor-portable-home-"));
    try {
      const portableDir = path.join(projectRoot, ".aor");
      fs.mkdirSync(portableDir);
      const profile = parseYaml(fs.readFileSync(path.join(workspaceRoot, "examples/project.aor.yaml"), "utf8"));
      profile.project_id = "portable-project";
      profile.display_name = "Portable project";
      profile.secret_token = "do-not-export";
      profile.runtime_defaults = { ...profile.runtime_defaults, runtime_root: "/tmp/private", helper_paths: ["relative/tool", "/opt/private/tool"] };
      fs.writeFileSync(path.join(portableDir, "project.yaml"), stringifyYaml(profile));
      const registry = createLocalProjectRegistry({ cwd: projectRoot, projects: [{ projectRef: projectRoot }], persistence: { mode: "persistent", root: aorHome } });
      const result = materializeProjectConfig({ registry, projectId: registry.defaultProjectId });
      const materialized = fs.readFileSync(result.file, "utf8");
      assert.equal(materialized.includes("do-not-export"), false);
      assert.equal(materialized.includes("/tmp/private"), false);
      assert.equal(materialized.includes("/opt/private/tool"), false);
      assert.match(materialized, /relative\/tool/u);
    } finally { fs.rmSync(aorHome, { recursive: true, force: true }); }
  });
});

test("disconnect preserves central data while exact confirmed delete removes it", async () => {
  await withTempRepo({ prefix: "aor-lifecycle-", workspaceRoot }, (projectRoot) => {
    const aorHome = fs.mkdtempSync(path.join(os.tmpdir(), "aor-lifecycle-home-"));
    try {
      const registry = createLocalProjectRegistry({ cwd: projectRoot, projects: [{ projectRef: projectRoot }], persistence: { mode: "persistent", root: aorHome } });
      const projectId = registry.defaultProjectId;
      const context = registry.getContext(projectId);
      fs.mkdirSync(context.projectRuntimeRoot, { recursive: true });
      assert.throws(() => deleteProjectData({ registry, projectId, confirmation: "wrong" }), /Confirm deletion/u);
      const deleted = deleteProjectData({ registry, projectId, confirmation: projectId });
      assert.equal(deleted.data_deleted, true);
      assert.equal(fs.existsSync(context.projectRuntimeRoot), false);

      const reconnected = registry.addProject({ projectRef: projectRoot });
      fs.mkdirSync(reconnected.projectRuntimeRoot, { recursive: true });
      const disconnected = disconnectProject({ registry, projectId: reconnected.projectId });
      assert.equal(disconnected.data_preserved, true);
      assert.equal(fs.existsSync(reconnected.projectRuntimeRoot), true);
    } finally { fs.rmSync(aorHome, { recursive: true, force: true }); }
  });
});
