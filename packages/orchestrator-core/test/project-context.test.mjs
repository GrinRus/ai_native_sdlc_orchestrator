import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { withTempRepo } from "../../../scripts/test/helpers/temp-repo.mjs";
import { createProjectContext, resolveProjectContextReference } from "../src/control-plane/project-context.mjs";
import { createLocalProjectRegistry } from "../src/control-plane/local-project-registry.mjs";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

test("project context is immutable and independent from launcher cwd", async () => {
  await withTempRepo({ prefix: "aor-context-target-", workspaceRoot }, (projectRoot) => {
    const launcherA = fs.mkdtempSync(path.join(os.tmpdir(), "aor-launcher-a-"));
    const launcherB = fs.mkdtempSync(path.join(os.tmpdir(), "aor-launcher-b-"));
    const externalRuntime = path.join(os.tmpdir(), "AOR runtime Юникод", path.basename(projectRoot));
    try {
      const first = createProjectContext({ cwd: launcherA, projectRef: projectRoot, runtimeRoot: externalRuntime });
      const second = createProjectContext({ cwd: launcherB, projectRef: projectRoot, runtimeRoot: externalRuntime });
      assert.equal(first.projectRoot, second.projectRoot);
      assert.equal(first.runtimeRoot, second.runtimeRoot);
      assert.equal(first.projectRuntimeRoot, second.projectRuntimeRoot);
      assert.equal(first.registryIdentity, second.registryIdentity);
      assert.equal(first.runtimeOptions.cwd, first.projectRoot);
      assert.equal(first.runtimeOptions.projectRef, first.projectRoot);
      assert.equal(Object.isFrozen(first), true);
      assert.equal(Object.isFrozen(first.runtimeOptions), true);
      assert.equal(fs.existsSync(path.join(launcherA, ".aor")), false);
      assert.equal(fs.existsSync(path.join(launcherB, ".aor")), false);
      assert.equal(fs.existsSync(externalRuntime), false, "read-only context creation must not materialize runtime");

      assert.equal(resolveProjectContextReference(first, "src/example.ts", "project-relative"), path.join(first.projectRoot, "src/example.ts"));
      assert.equal(resolveProjectContextReference(first, "evidence://reports/result.json", "evidence-relative"), path.join(first.projectRuntimeRoot, "reports/result.json"));
      assert.throws(() => resolveProjectContextReference(first, "../escape", "project-relative"), /invalid path segment/u);
      assert.throws(() => resolveProjectContextReference(first, "/absolute", "runtime-relative"), /canonical relative path/u);
    } finally {
      fs.rmSync(launcherA, { recursive: true, force: true });
      fs.rmSync(launcherB, { recursive: true, force: true });
      fs.rmSync(path.dirname(externalRuntime), { recursive: true, force: true });
    }
  });
});

test("one registry keeps equal runtime ids in different roots isolated", async () => {
  await withTempRepo({ prefix: "aor-context-one-", workspaceRoot }, async (firstRoot) => {
    await withTempRepo({ prefix: "aor-context-two-", workspaceRoot }, (secondRoot) => {
      const launcher = fs.mkdtempSync(path.join(os.tmpdir(), "aor-registry-launcher-"));
      try {
        const registry = createLocalProjectRegistry({ cwd: launcher, projects: [{ projectRef: firstRoot }, { projectRef: secondRoot }] });
        const contexts = registry.listContexts();
        assert.equal(contexts.length, 2);
        assert.notEqual(contexts[0].projectId, contexts[1].projectId);
        assert.notEqual(contexts[0].registryIdentity, contexts[1].registryIdentity);
        assert.notEqual(contexts[0].projectRoot, contexts[1].projectRoot);
        assert.equal(contexts.every((context) => context.runtimeOptions.cwd === context.projectRoot), true);
        assert.equal(fs.existsSync(path.join(launcher, ".aor")), false);
      } finally {
        fs.rmSync(launcher, { recursive: true, force: true });
      }
    });
  });
});
