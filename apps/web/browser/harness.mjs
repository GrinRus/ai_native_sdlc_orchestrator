import fs from "node:fs";
import path from "node:path";

export const harnessStatePath = path.resolve("node_modules/.cache/aor/w59-s01-browser-harness.json");

export function readHarnessState() {
  return JSON.parse(fs.readFileSync(harnessStatePath, "utf8"));
}
