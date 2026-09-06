import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { invokeCli } from "../src/index.mjs";
import { runGitChecked, withTempRepo } from "../../../scripts/test/helpers/temp-repo.mjs";

const workspaceRoot = path.resolve(new URL("../../..", import.meta.url).pathname);

test("public CLI workspace provision keeps full JSON parity with the shared service", () => {
  withTempRepo({ prefix: "aor-s10-workspace-cli-", workspaceRoot }, (repoRoot) => {
    runGitChecked({ cwd: repoRoot, args: ["branch", "-M", "main"] });
    const result = invokeCli([
      "workspace", "provision",
      "--project-ref", repoRoot,
      "--project-profile", path.join(repoRoot, "examples", "project.aor.yaml"),
      "--run-id", "run-s10-cli",
      "--dry-run", "true",
      "--json",
    ], { cwd: repoRoot });
    assert.equal(result.exitCode, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.workspace_set.status, "planned");
    assert.equal(payload.workspace_set_dry_run, true);
    assert.equal(payload.read_only, true);
    assert.equal(payload.contract_families.some((entry) => entry.family === "workspace-set" || entry === "workspace-set"), true);
  });
});
