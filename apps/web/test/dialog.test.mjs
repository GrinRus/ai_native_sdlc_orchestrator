import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const source = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/dialog.jsx"),
  "utf8",
);

test("shared dialog primitive owns accessible modal and keyboard semantics", () => {
  for (const marker of [
    'role="dialog"',
    'aria-modal="true"',
    "event.key === \"Escape\"",
    "event.key !== \"Tab\"",
    "event.shiftKey",
    "element.inert = true",
    "opener.focus()",
  ]) {
    assert.ok(source.includes(marker), `dialog primitive should include ${marker}`);
  }
});
