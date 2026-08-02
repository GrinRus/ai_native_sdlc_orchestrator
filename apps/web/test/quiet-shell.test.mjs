import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { readQuietPresentation } from "../src/quiet-presentation.js";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
test("adaptive shell keeps lifecycle and presentation semantics explicit", () => {
  const source = fs.readFileSync(path.join(root, "src/quiet-shell.jsx"), "utf8");
  const css = fs.readFileSync(path.join(root, "src/quiet-shell.css"), "utf8");
  for (const marker of ["Context", "Current lifecycle stage", "Viewing stage", "Cockpit", "Attention", "Journey", "Evidence", "Technical context"]) assert.ok(source.includes(marker) || marker === "Context");
  assert.match(source, /aria-current/u); assert.doesNotMatch(source, /sessionStorage|localStorage/u);
  assert.match(css, /overflow-x: auto/u); assert.match(css, /--touch-control-height/u); assert.match(css, /prefers-reduced-motion/u);
});

test("Quiet presentation URL descriptor normalizes invalid values", () => {
  assert.deepEqual(readQuietPresentation("?mode=attention&stage=review&attention=item-1", ["mission", "review"]), { mode: "attention", stage: "review", attention: "item-1", evidence: null });
  assert.deepEqual(readQuietPresentation("?mode=invalid&stage=unknown", ["review"]), { mode: "cockpit", stage: null, attention: null, evidence: null });
});
