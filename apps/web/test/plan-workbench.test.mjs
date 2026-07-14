import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const component = fs.readFileSync(path.join(workspaceRoot, "apps/web/src/plan-workbench.jsx"), "utf8");
const spa = fs.readFileSync(path.join(workspaceRoot, "apps/web/src/spa.jsx"), "utf8");
const css = fs.readFileSync(path.join(workspaceRoot, "apps/web/src/spa.css"), "utf8");

test("Plan workbench exposes accessible task, traceability, dependency, and revision views", () => {
  for (const label of ["Tasks", "Traceability", "Dependencies", "Revisions"]) {
    assert.equal(component.includes(`"${label}"`), true);
  }
  assert.match(component, /role="tablist"/u);
  assert.match(component, /role="dialog"/u);
  assert.match(component, /aria-modal="true"/u);
  assert.match(component, /event\.key !== "Escape"/u);
  assert.match(component, /openerRef\.current\?\.focus/u);
  assert.doesNotMatch(component, /Mark complete/iu);
  assert.doesNotMatch(component, /contentEditable/iu);
});

test("Plan workbench covers loading, empty, error, permission, approved, and revision-required states", () => {
  for (const state of ["loading", "empty", "error", "permission", "approved", "revision-required"]) {
    assert.match(component, new RegExp(state, "u"));
  }
  assert.match(component, /Approve exact version/u);
  assert.match(component, /Approved plan is read-only/u);
  assert.match(component, /Request revision/u);
  assert.match(component, /Semantic evaluation:/u);
});

test("project and flow switches clear scoped plan state and narrow layouts remain usable", () => {
  assert.match(spa, /setPlanWorkbenchState/u);
  assert.match(spa, /scopeKey/u);
  assert.match(spa, /current\.scopeKey === scopeKey/u);
  assert.match(spa, /flows\/\$\{encodedFlowId\}\/plan/u);
  assert.match(css, /\.plan-table-wrap[\s\S]*?overflow: auto/u);
  assert.match(css, /\.plan-task-drawer[\s\S]*?width: min\(620px, calc\(100vw - 24px\)\)/u);
  assert.match(css, /@media \(max-width: 860px\)[\s\S]*?\.plan-task-drawer[\s\S]*?width: 100%/u);
});
