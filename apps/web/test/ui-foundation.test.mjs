import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { COMPONENT_CONTRACTS, requireSemanticTone, SEMANTIC_TONES } from "../src/ui/semantics.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tokens = fs.readFileSync(path.join(root, "src/ui/tokens.css"), "utf8");
const styles = fs.readFileSync(path.join(root, "src/ui/components.css"), "utf8");
const components = fs.readFileSync(path.join(root, "src/ui/components.jsx"), "utf8");

test("semantic tones reject arbitrary status-string inference", () => {
  assert.deepEqual(SEMANTIC_TONES, ["neutral", "information", "success", "warning", "danger"]);
  assert.equal(requireSemanticTone("success"), "success");
  assert.equal(requireSemanticTone("provider-failed-with-secret"), "neutral");
});

test("foundation tokens cover the consumed semantic system", () => {
  for (const family of ["color", "type", "space", "radius", "elevation", "motion", "control", "focus", "data-row"]) assert.match(tokens, new RegExp(`--aor-${family}`, "u"));
  const declared = new Set([...tokens.matchAll(/(--aor-[a-z0-9-]+)\s*:/gu)].map((match) => match[1]));
  const consumed = [...styles.matchAll(/var\((--aor-[a-z0-9-]+)/gu)].map((match) => match[1]);
  assert.deepEqual(consumed.filter((token) => !declared.has(token)), []);
  assert.match(tokens, /prefers-reduced-motion/u);
});

test("component contracts include keyboard, state, and responsive behavior", () => {
  assert.ok(COMPONENT_CONTRACTS.button.states.includes("loading"));
  assert.ok(COMPONENT_CONTRACTS.field.states.includes("invalid"));
  assert.deepEqual(COMPONENT_CONTRACTS.dialog.keyboard, ["Tab", "Shift+Tab", "Escape"]);
  assert.equal(COMPONENT_CONTRACTS.dataList.responsive, true);
  for (const marker of ["Button", "IconButton", "Field", "Drawer", "StatusBadge", "CountBadge", "Alert", "Card", "Section", "EmptyState", "Disclosure", "Tabs", "ProgressPath", "ResponsiveActions"]) assert.match(components, new RegExp(`function ${marker}`, "u"));
  assert.match(styles, /min-height: var\(--aor-control-touch\)/u);
  assert.match(styles, /focus-visible/u);
});
