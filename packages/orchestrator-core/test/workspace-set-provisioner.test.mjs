import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  collectWorkspaceSetChanges,
  finalizeWorkspaceSet,
  projectWorkspaceSetProvenance,
  provisionWorkspaceSet,
} from "../src/workspace-set-provisioner.mjs";
import { resumeWorkspaceSetIsolation } from "../src/workspace-isolation.mjs";

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function repository(root, name) {
  const repo = path.join(root, name);
  fs.mkdirSync(repo, { recursive: true });
  git(repo, "init");
  git(repo, "config", "user.email", "aor@example.invalid");
  git(repo, "config", "user.name", "AOR Test");
  fs.writeFileSync(path.join(repo, "README.md"), `${name}\n`);
  git(repo, "add", "README.md");
  git(repo, "commit", "-m", "initial");
  return repo;
}

function runtime(root) {
  const value = path.join(root, "runtime");
  fs.mkdirSync(path.join(value, "reports"), { recursive: true });
  return value;
}

test("workspace set provisions mixed isolated repositories and records per-repository changes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aor-workspace-set-"));
  const first = repository(root, "first");
  const second = repository(root, "second");
  const projectRuntimeRoot = runtime(root);
  const firstBefore = git(first, "status", "--porcelain");
  const manifest = provisionWorkspaceSet({
    workspaceSetId: "workspace-set-run-1",
    projectId: "project-1",
    runId: "run-1",
    bindingRef: "binding://project-1@r1",
    projectRuntimeRoot,
    deliveryCapable: true,
    repositories: [
      { repoId: "main", mountPath: "repos/main", sourceRoot: first, baseRef: "HEAD", accessMode: "write", writeScope: ["src/**"] },
      { repoId: "docs", mountPath: "repos/docs", sourceRoot: second, baseRef: "HEAD", accessMode: "read-only", strategy: "independent-clone" },
    ],
  });
  assert.equal(manifest.status, "ready");
  assert.deepEqual(manifest.repositories.map((entry) => entry.provisioning.strategy), ["detached-worktree", "independent-clone"]);
  assert.notEqual(manifest.repositories[0].execution_root, first);
  fs.writeFileSync(path.join(manifest.repositories[0].execution_root, "added.txt"), "change\n");
  collectWorkspaceSetChanges(manifest);
  assert.deepEqual(manifest.repositories[0].git_evidence.final.untracked_paths, ["added.txt"]);
  const provenance = projectWorkspaceSetProvenance(manifest);
  assert.equal(provenance.workspace_set_ref, manifest.workspace_set_ref);
  assert.equal(provenance.repository_map.main.execution_root, manifest.repositories[0].execution_root);
  const reused = resumeWorkspaceSetIsolation({
    projectRuntimeRoot,
    executionRoot: manifest.repositories[0].execution_root,
  });
  assert.equal(reused.mode, "workspace-set");
  assert.equal(reused.finalize("success").status, "retained-by-workspace-set");
  assert.equal(fs.existsSync(manifest.repositories[0].execution_root), true);
  assert.equal(git(first, "status", "--porcelain"), firstBefore);
  assert.equal(finalizeWorkspaceSet(manifest, "success").cleanup.state, "deleted");
  assert.equal(finalizeWorkspaceSet(manifest, "success").cleanup.state, "deleted");
});

test("workspace set fails before provisioning on dirty, duplicate, and missing-ref input", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aor-workspace-validation-"));
  const source = repository(root, "source");
  const projectRuntimeRoot = runtime(root);
  fs.writeFileSync(path.join(source, "dirty.txt"), "dirty\n");
  assert.throws(() => provisionWorkspaceSet({
    workspaceSetId: "workspace-set-dirty",
    projectId: "project-1",
    runId: "run-dirty",
    bindingRef: "binding://project-1@r1",
    projectRuntimeRoot,
    repositories: [{ repoId: "main", mountPath: "repos/main", sourceRoot: source, baseRef: "HEAD" }],
  }), /dirtyPolicy=reject/u);
  fs.rmSync(path.join(source, "dirty.txt"));
  assert.throws(() => provisionWorkspaceSet({
    workspaceSetId: "workspace-set-invalid",
    projectId: "project-1",
    runId: "run-invalid",
    bindingRef: "binding://project-1@r1",
    projectRuntimeRoot,
    repositories: [
      { repoId: "one", mountPath: "repos/main", sourceRoot: source, baseRef: "missing" },
      { repoId: "two", mountPath: "repos/main", sourceRoot: source, baseRef: "HEAD" },
    ],
  }), /Mount|base ref/u);
});

test("partial provisioning rolls back owned checkouts and retains failure evidence", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aor-workspace-failure-"));
  const first = repository(root, "first");
  const second = repository(root, "second");
  const projectRuntimeRoot = runtime(root);
  assert.throws(() => provisionWorkspaceSet({
    workspaceSetId: "workspace-set-failure",
    projectId: "project-1",
    runId: "run-failure",
    bindingRef: "binding://project-1@r1",
    projectRuntimeRoot,
    failAfterRepository: 1,
    repositories: [
      { repoId: "one", mountPath: "repos/one", sourceRoot: first, baseRef: "HEAD" },
      { repoId: "two", mountPath: "repos/two", sourceRoot: second, baseRef: "HEAD" },
    ],
  }), (error) => {
    assert.equal(error.workspaceSetFailure.status, "failed");
    assert.equal(error.workspaceSetFailure.cleanup.state, "deleted");
    return true;
  });
  assert.equal(fs.existsSync(path.join(projectRuntimeRoot, "workspace-sets", "run-failure")), false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(projectRuntimeRoot, "reports", "workspace-set.run-failure.json"), "utf8")).status, "failed");
});

test("workspace-set cleanup rejects a forged owner marker without deleting the checkout", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aor-workspace-forged-marker-"));
  const source = repository(root, "source");
  const projectRuntimeRoot = runtime(root);
  try {
    const manifest = provisionWorkspaceSet({
      workspaceSetId: "workspace-set-forged",
      projectId: "project-1",
      runId: "run-forged",
      bindingRef: "binding://project-1@r1",
      projectRuntimeRoot,
      repositories: [{ repoId: "main", mountPath: "repos/main", sourceRoot: source, baseRef: "HEAD" }],
    });
    fs.writeFileSync(manifest.owner_marker, JSON.stringify({ ...JSON.parse(fs.readFileSync(manifest.owner_marker, "utf8")), workspace_root: path.join(root, "outside") }), "utf8");
    assert.throws(() => finalizeWorkspaceSet(manifest, "success"), /owner marker/u);
    assert.equal(fs.existsSync(manifest.workspace_root), true);
    assert.equal(fs.existsSync(path.join(source, "README.md")), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("workspace-set provisioning rejects an escaping workspace-sets symlink", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aor-workspace-root-link-"));
  const source = repository(root, "source");
  const projectRuntimeRoot = runtime(root);
  const outside = path.join(root, "outside");
  fs.mkdirSync(outside);
  fs.mkdirSync(path.join(outside, "run-link", "repos", "main"), { recursive: true });
  fs.writeFileSync(path.join(outside, "sentinel.txt"), "keep\n", "utf8");
  fs.symlinkSync(outside, path.join(projectRuntimeRoot, "workspace-sets"), "dir");
  try {
    assert.throws(() => provisionWorkspaceSet({
      workspaceSetId: "workspace-set-link",
      projectId: "project-1",
      runId: "run-link",
      bindingRef: "binding://project-1@r1",
      projectRuntimeRoot,
      repositories: [{ repoId: "main", mountPath: "repos/main", sourceRoot: source, baseRef: "HEAD" }],
    }), /Workspace-set root escaped/u);
    assert.equal(fs.readFileSync(path.join(outside, "sentinel.txt"), "utf8"), "keep\n");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("workspace-set resume rejects an escaping workspace-sets symlink", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aor-workspace-resume-link-"));
  const projectRuntimeRoot = runtime(root);
  const outside = path.join(root, "outside");
  fs.mkdirSync(outside);
  fs.mkdirSync(path.join(outside, "run-link", "repos", "main"), { recursive: true });
  fs.symlinkSync(outside, path.join(projectRuntimeRoot, "workspace-sets"), "dir");
  try {
    assert.throws(() => resumeWorkspaceSetIsolation({
      projectRuntimeRoot,
      executionRoot: path.join(outside, "run-link", "repos", "main"),
    }), /Workspace sets root|workspace-set repository/u);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
