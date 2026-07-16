import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { withTempRepo } from "../../../scripts/test/helpers/temp-repo.mjs";
import { createControlPlaneHttpServer } from "../src/control-plane/http/http-transport.mjs";
import { createLocalProjectRegistry } from "../src/control-plane/local-project-registry.mjs";
import { applyTopologyAction, readProjectTopology } from "../src/control-plane/topology-management.mjs";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

async function postJson(url, body) {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("topology application service preserves revision history and fails closed", async () => {
  await withTempRepo({ prefix: "aor-topology-control-", workspaceRoot }, (projectRoot) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "aor-topology-home-"));
    try {
      const registry = createLocalProjectRegistry({
        cwd: projectRoot,
        projects: [{ projectRef: projectRoot, projectProfile: "examples/project.aor.yaml" }],
        persistence: { mode: "persistent", root: home },
      });
      const projectId = registry.defaultProjectId;
      const before = readProjectTopology({ registry, projectId });
      assert.equal(before.components.length, 2);

      const result = applyTopologyAction({
        registry,
        projectId,
        expectedRevision: registry.revision,
        family: "component",
        action: "add",
        payload: {
          component_id: "worker",
          repo_id: "main",
          name: "Worker",
          root: "packages/worker",
          role: "service",
          command_group_refs: [],
        },
      });
      assert.equal(result.topology.components.length, 3);
      assert.deepEqual(result.revision_event.invalidated, ["execution-readiness", "workspace-set", "plan-approval"]);
      assert.throws(
        () => applyTopologyAction({
          registry,
          projectId,
          expectedRevision: before.revision,
          family: "component",
          action: "disable",
          payload: { id: "worker" },
        }),
        (error) => error.code === "topology.stale_revision",
      );
      assert.throws(
        () => applyTopologyAction({
          registry,
          projectId,
          family: "component",
          action: "add",
          payload: { component_id: "orphan", repo_id: "missing", root: "orphan", role: "service" },
        }),
        (error) => error.code === "topology.validation_failed",
      );
      assert.equal(readProjectTopology({ registry, projectId }).components.some((entry) => entry.component_id === "orphan"), false);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});

test("topology reads return a stable empty model without materializing a missing profile", async () => {
  await withTempRepo({ prefix: "aor-topology-empty-", workspaceRoot }, (projectRoot) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "aor-topology-empty-home-"));
    try {
      const registry = createLocalProjectRegistry({
        cwd: projectRoot,
        projects: [{ projectRef: projectRoot }],
        persistence: { mode: "persistent", root: home },
      });
      const projectId = registry.defaultProjectId;
      const profilePath = registry.getContext(projectId).canonicalProfilePath;
      fs.rmSync(profilePath);
      const before = fs.readdirSync(projectRoot).sort();
      const topology = readProjectTopology({ registry, projectId });
      assert.equal(topology.initialized, false);
      assert.deepEqual(topology.repositories, []);
      assert.deepEqual(topology.components, []);
      assert.deepEqual(topology.dependencies, []);
      assert.equal(fs.existsSync(profilePath), false);
      assert.deepEqual(fs.readdirSync(projectRoot).sort(), before);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});

test("topology HTTP reads and mutations are project scoped and revision protected", async () => {
  await withTempRepo({ prefix: "aor-topology-http-", workspaceRoot }, async (projectRoot) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "aor-topology-http-home-"));
    const transport = await createControlPlaneHttpServer({
      cwd: projectRoot,
      projects: [{ projectRef: projectRoot, projectProfile: "examples/project.aor.yaml" }],
      workspaceRegistry: { mode: "persistent", root: home },
      host: "127.0.0.1",
      port: 0,
    });
    try {
      const topologyResponse = await fetch(`${transport.baseUrl}/api/projects/${transport.projectId}/topology`);
      assert.equal(topologyResponse.status, 200);
      const topology = await topologyResponse.json();
      const validateResponse = await postJson(`${transport.baseUrl}/api/projects/${transport.projectId}/topology/actions`, {
        action: "validate",
        family: "topology",
        expected_revision: topology.revision,
      });
      assert.equal(validateResponse.status, 200);
      const validation = await validateResponse.json();
      assert.equal(validation.validation.status, "pass");

      const staleResponse = await postJson(`${transport.baseUrl}/api/projects/${transport.projectId}/topology/actions`, {
        action: "disable",
        family: "component",
        expected_revision: topology.revision,
        value: { id: "api" },
      });
      assert.equal(staleResponse.status, 409);
      assert.equal((await staleResponse.json()).error.code, "topology.stale_revision");

      const wrongProject = await fetch(`${transport.baseUrl}/api/projects/wrong/topology`);
      assert.equal(wrongProject.status, 404);
    } finally {
      await transport.close();
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
