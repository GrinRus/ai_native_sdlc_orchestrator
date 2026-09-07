import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "scripts/path-containment-manifest.json"), "utf8"));
const sinkPattern = /fs\.(?:rmSync|cpSync|copyFileSync)/gu;

function discoveredSinks() {
  const result = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git" || /(?:^|[\\/])(test|browser)(?:[\\/]|$)/u.test(file)) continue;
        walk(file);
      } else if (entry.isFile() && entry.name.endsWith(".mjs")) {
        const relative = path.relative(root, file).split(path.sep).join("/");
        if (!relative.startsWith("packages/") && !relative.startsWith("apps/") && !relative.startsWith("scripts/")) continue;
        if (/(?:^|\/)(test|browser)(?:\/|$)/u.test(relative)) continue;
        const count = (fs.readFileSync(file, "utf8").match(sinkPattern) ?? []).length;
        if (count > 0) result.push({ path: relative, sink_count: count });
      }
    }
  }
  walk(root);
  return result.sort((a, b) => a.path.localeCompare(b.path));
}

test("every production recursive filesystem sink is explicitly inventoried", () => {
  const expected = [...manifest.entries].map(({ path: file, sink_count }) => ({ path: file, sink_count })).sort((a, b) => a.path.localeCompare(b.path));
  assert.deepEqual(discoveredSinks(), expected);
  for (const entry of manifest.entries) {
    assert.ok(entry.disposition, `${entry.path} must declare a review disposition`);
    assert.ok(fs.existsSync(path.join(root, entry.path)), `${entry.path} is missing`);
  }
});
