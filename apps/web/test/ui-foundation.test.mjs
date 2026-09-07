import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tokens = fs.readFileSync(path.join(root, "src/ui/tokens.css"), "utf8");
const styles = fs.readFileSync(path.join(root, "src/ui/components.css"), "utf8");
const components = fs.readFileSync(path.join(root, "src/ui/components.jsx"), "utf8");
const taskStyles = fs.readFileSync(path.join(root, "src/task-workspace.css"), "utf8");

test("foundation tokens cover the consumed semantic system", () => {
  for (const family of ["color", "type", "space", "radius", "elevation", "motion", "control", "focus", "data-row"]) assert.match(tokens, new RegExp(`--aor-${family}`, "u"));
  const declared = new Set([...tokens.matchAll(/(--aor-[a-z0-9-]+)\s*:/gu)].map((match) => match[1]));
  const consumed = [...styles.matchAll(/var\((--aor-[a-z0-9-]+)/gu)].map((match) => match[1]);
  assert.deepEqual(consumed.filter((token) => !declared.has(token)), []);
  assert.match(tokens, /prefers-reduced-motion/u);
});

test("shared controls retain keyboard, state, and responsive behavior", () => {
  assert.match(components, /useRovingTabs/u);
  for (const key of ["ArrowLeft", "ArrowRight", "Home", "End"]) assert.match(components, new RegExp(`event\\.key === "${key}"`, "u"));
  assert.match(styles, /min-height: var\(--aor-control-touch\)/u);
  assert.match(styles, /focus-visible/u);
  assert.match(taskStyles, /--aor-layout-content-max/u);
  assert.match(taskStyles, /prefers-reduced-motion/u);
  assert.doesNotMatch(taskStyles, /#[0-9a-f]{3,8}/iu);
  assert.match(taskStyles, /overflow-x: auto/u);
});
