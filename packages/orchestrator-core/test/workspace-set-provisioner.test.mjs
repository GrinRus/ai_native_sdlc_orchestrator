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
