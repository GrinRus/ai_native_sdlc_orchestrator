import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parseSetupRows } from "../src/project-structure-model.js";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

test("project setup rows preserve explicit repository, component, and dependency identity", () => {
  assert.deepEqual(parseSetupRows("docs:repos/docs\nservice:repos/service", ["repo_id", "workspace_mount"]), [
    { repo_id: "docs", workspace_mount: "repos/docs" },
    { repo_id: "service", workspace_mount: "repos/service" },
  ]);
  assert.deepEqual(parseSetupRows("web:main:apps/web:application", ["component_id", "repo_id", "root", "role"]), [
    { component_id: "web", repo_id: "main", root: "apps/web", role: "application" },
  ]);
});

test("Project Structure source owns setup steps, canonical actions, and responsive accessibility", () => {
  const source = fs.readFileSync(path.join(workspaceRoot, "apps/web/src/project-structure.jsx"), "utf8");
  const css = fs.readFileSync(path.join(workspaceRoot, "apps/web/src/project-structure.css"), "utf8");
  for (const marker of [
    "Add AOR Project",
    "Identity",
    "Topology",
    "Repositories",
    "Components",
    "Dependencies",
    "Review",
    "Portable profile",
    "Machine-local binding",
    "Write-effect preview",
    "Confirm writes and initialize",
    "Project Structure",
    "Add repository",
    "Validate topology",
    "Reanalyze suggestions",
    'role="tablist"',
    'role="tabpanel"',
  ]) assert.match(source, new RegExp(marker, "u"));
  assert.match(css, /@media \(max-width: 860px\)/u);
  assert.match(css, /overflow-x: auto/u);
  assert.match(css, /min-width: 620px/u);
});
