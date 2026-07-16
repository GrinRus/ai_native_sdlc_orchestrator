#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const baseline = JSON.parse(fs.readFileSync(path.join(root, "scripts/quality-baseline.json"), "utf8"));
const sourceRoots = ["apps", "packages", "scripts"];
const productionExtensions = new Set([".mjs", ".jsx", ".css"]);
const files = [];

function walk(relative) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) return;
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) {
      if (!["dist", "test", "browser"].includes(entry.name)) walk(child);
    } else if (entry.isFile() && productionExtensions.has(path.extname(entry.name))) {
      files.push(child.split(path.sep).join("/"));
    }
  }
}
for (const sourceRoot of sourceRoots) walk(sourceRoot);

const violations = [];
const fileMetrics = {};
for (const file of files.sort()) {
  const lines = fs.readFileSync(path.join(root, file), "utf8").split("\n").length;
  fileMetrics[file] = { lines };
  const allowed = baseline.file_line_ceiling_overrides[file] ?? baseline.new_file_max_lines;
  if (lines > allowed) violations.push(`${file}: ${lines} lines exceeds ceiling ${allowed}`);
}

const eslintTargets = ["scripts/slice-cycle.mjs", "scripts/typecheck-ratchet.mjs", "scripts/quality-ratchet.mjs", "scripts/dependency-policy.mjs"];
const eslint = spawnSync(
  process.platform === "win32" ? "pnpm.cmd" : "pnpm",
  ["exec", "eslint", ...eslintTargets],
  { cwd: root, encoding: "utf8" },
);
if (eslint.status !== 0) violations.push(`ESLint:\n${eslint.stdout}${eslint.stderr}`);

fs.mkdirSync(path.join(root, ".aor/quality"), { recursive: true });
fs.writeFileSync(
  path.join(root, ".aor/quality/quality-ratchet.json"),
  `${JSON.stringify({ status: violations.length === 0 ? "pass" : "fail", file_metrics: fileMetrics, violations }, null, 2)}\n`,
);
if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exit(1);
}
console.log(`quality ratchet ok: ${files.length} production files checked; scoped ESLint passed`);
