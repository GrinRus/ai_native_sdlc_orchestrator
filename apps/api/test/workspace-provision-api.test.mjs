import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { createControlPlaneHttpServer } from "../src/index.mjs";
import { withTempRepo } from "../../../scripts/test/helpers/temp-repo.mjs";

const workspaceRoot = path.resolve(new URL("../../..", import.meta.url).pathname);

test("public API provisions a workspace set through the shared project action boundary", async () => {
  await withTempRepo({ prefix: "aor-s10-workspace-api-", workspaceRoot }, async (repoRoot) => {
    const runtimeRoot = process.env.AOR_HOME;
    const transport = await createControlPlaneHttpServer({
      projectRef: repoRoot,
      projectProfile: path.join(repoRoot, "examples", "project.aor.yaml"),
      cwd: repoRoot,
      host: "127.0.0.1",
      port: 0,
    });
    try {
      const response = await fetch(`${transport.baseUrl}/api/projects/actions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "provision-workspace-set",
          project_id: transport.projectId,
          run_id: "run-s10-api-dry",
          dry_run: true,
        }),
      });
      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.equal(payload.workspace_set.status, "planned");
      assert.equal(payload.dry_run, true);
      assert.equal(fs.existsSync(path.join(runtimeRoot, "projects", transport.projectId, "workspace-sets", "run-s10-api-dry")), false);
    } finally {
      await transport.close();
    }
  });
});
