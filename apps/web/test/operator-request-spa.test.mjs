import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentFilePath = fileURLToPath(import.meta.url);
const webRoot = path.resolve(path.dirname(currentFilePath), "..");

test("operator console SPA exposes Ask AOR drawer, evidence workbench, and interactions inbox", () => {
  const source = fs.readFileSync(path.join(webRoot, "src/spa.jsx"), "utf8");

  for (const stage of ["readiness", "mission", "discovery", "implement", "review", "delivery", "learning"]) {
    assert.match(source, new RegExp(`id: "${stage}"`, "u"));
  }

  assert.match(source, /Ask AOR/u);
  assert.match(source, /Evidence & Documents/u);
  assert.match(source, /Interactions Inbox/u);
  assert.match(source, /operator-requests/u);
  assert.match(source, /interactions\/answers/u);
  assert.match(source, /Create and run request/u);
  assert.match(source, /Latest run/u);
  assert.match(source, /Attach as request target/u);
});
