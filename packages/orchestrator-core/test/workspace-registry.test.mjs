import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { withTempRepo } from "../../../scripts/test/helpers/temp-repo.mjs";
import { createLocalProjectRegistry } from "../src/control-plane/local-project-registry.mjs";
import { createControlPlaneHttpServer } from "../src/control-plane/http/http-transport.mjs";
import { discoverTopologyProposals, inspectRepositoryBinding } from "../src/control-plane/topology-discovery.mjs";
import { createWorkspaceRegistryStore } from "../src/control-plane/workspace-registry-store.mjs";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

test("persistent Local Workspace registry survives restart without selecting a sticky project", async () => {
  await withTempRepo({ prefix: "aor-workspace-project-", workspaceRoot }, (projectRoot) => {
    const aorHome = fs.mkdtempSync(path.join(os.tmpdir(), "aor-workspace-home-"));
    try {
      const first = createLocalProjectRegistry({
        cwd: projectRoot,
        projects: [{ projectRef: projectRoot, label: "Persistent project" }],
        persistence: { mode: "persistent", root: aorHome },
      });
      assert.equal(first.defaultProjectId, "aor-core");
      assert.equal(first.revision, 1);

      const restarted = createLocalProjectRegistry({
        cwd: os.tmpdir(),
        projects: [],
        persistence: { mode: "persistent", root: aorHome },
      });
      assert.equal(restarted.defaultProjectId, null);
      assert.equal(restarted.listContexts().length, 1);
      assert.equal(restarted.summarize().selected_project_id, null);
      assert.equal(fs.existsSync(path.join(projectRoot, ".aor")), false);
    } finally {
      fs.rmSync(aorHome, { recursive: true, force: true });
    }
  });
});

test("workspace store publishes atomically, detects revision conflicts, and quarantines corruption", () => {
  const aorHome = fs.mkdtempSync(path.join(os.tmpdir(), "aor-workspace-store-"));
  try {
    const store = createWorkspaceRegistryStore({ root: aorHome });
    const first = store.update(0, (document) => ({ ...document, projects: [] }));
    assert.equal(first.revision, 1);
    assert.throws(
      () => store.update(0, (document) => document),
      (error) => error.code === "workspace_registry_revision_conflict",
    );
    fs.writeFileSync(store.paths.registryFile, "{broken", "utf8");
    const recovered = store.read();
    assert.equal(recovered.revision, 0);
    assert.equal(recovered.recovery.status, "quarantined");
    assert.equal(fs.existsSync(recovered.recovery.quarantine_file), true);
  } finally {
    fs.rmSync(aorHome, { recursive: true, force: true });
  }
});

test("topology discovery remains proposal-only and binding inspection is deterministic", async () => {
  await withTempRepo({ prefix: "aor-topology-discovery-", workspaceRoot }, (projectRoot) => {
    fs.mkdirSync(path.join(projectRoot, "apps/api"), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n");
    fs.writeFileSync(path.join(projectRoot, "apps/api/package.json"), `${JSON.stringify({
      name: "fixture-api",
      scripts: { test: "node --test" },
    }, null, 2)}\n`);
    const before = fs.readdirSync(projectRoot).sort();
    const proposal = discoverTopologyProposals({ projectRoot, repoId: "main" });
    assert.ok(proposal.components.some((component) => component.root === "apps/api"));
    assert.ok(proposal.command_groups.every((candidate) => candidate.approval_status === "proposed"));
    assert.equal(proposal.dependencies.length, 0);
    assert.deepEqual(fs.readdirSync(projectRoot).sort(), before);

    const binding = inspectRepositoryBinding(projectRoot);
    assert.equal(binding.status, "available");
    assert.match(binding.resolved_commit, /^[a-f0-9]{40}$/u);
    assert.equal(inspectRepositoryBinding(projectRoot, `${binding.resolved_ref}-other`).status, "ref-drift");
  });
});

test("neutral Local Workspace serves project index without scanning or materializing launcher state", async () => {
  const launcher = fs.mkdtempSync(path.join(os.tmpdir(), "aor-neutral-launcher-"));
  const aorHome = fs.mkdtempSync(path.join(os.tmpdir(), "aor-neutral-home-"));
  try {
    const transport = await createControlPlaneHttpServer({
      cwd: launcher,
      projects: [],
      workspaceRegistry: { mode: "persistent", root: aorHome },
      host: "127.0.0.1",
      port: 0,
    });
    try {
      const response = await fetch(`${transport.baseUrl}/api/projects`);
      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.equal(payload.selected_project_id, null);
      assert.deepEqual(payload.projects, []);
      assert.equal(transport.projectId, null);
      assert.equal(fs.existsSync(path.join(launcher, ".aor")), false);
    } finally {
      await transport.close();
    }
  } finally {
    fs.rmSync(launcher, { recursive: true, force: true });
    fs.rmSync(aorHome, { recursive: true, force: true });
  }
});
