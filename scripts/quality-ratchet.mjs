#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { runCheckedProcess } from "./process-runner.mjs";

const root = process.cwd();
const baseline = JSON.parse(fs.readFileSync(path.join(root, "scripts/quality-baseline.json"), "utf8"));
const sourceRoots = ["apps", "packages", "scripts"];
const productionExtensions = new Set([".mjs", ".js", ".jsx", ".css"]);
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
function functionLineCount(file, functionName) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  const start = source.search(new RegExp(`export\\s+function\\s+${functionName}\\s*\\(`, "u"));
  if (start < 0) return null;
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1).split("\n").length;
  }
  return null;
}
for (const file of files.sort()) {
  const lines = fs.readFileSync(path.join(root, file), "utf8").split("\n").length;
  fileMetrics[file] = { lines };
  const allowed = baseline.file_line_ceiling_overrides[file] ?? baseline.new_file_max_lines;
  if (lines > allowed) violations.push(`${file}: ${lines} lines exceeds ceiling ${allowed}`);
}
for (const entry of baseline.facade_functions ?? []) {
  const lines = functionLineCount(entry.file, entry.name);
  if (lines === null) violations.push(`${entry.file}: exported facade '${entry.name}' was not found`);
  else if (lines > baseline.facade_function_max_lines) {
    violations.push(`${entry.file}: exported facade '${entry.name}' has ${lines} lines; maximum is ${baseline.facade_function_max_lines}`);
  }
}

const eslintTargets = files.filter((file) => /\.(?:mjs|js)$/u.test(file));
const eslint = runCheckedProcess({
  label: "quality ESLint",
  command: process.platform === "win32" ? "pnpm.cmd" : "pnpm",
  args: ["exec", "eslint", ...eslintTargets],
  cwd: root,
  timeoutMs: Number(process.env.AOR_LINT_TIMEOUT_MS ?? 180_000),
});
if (!eslint.ok) violations.push(`ESLint (${eslint.failure_type}):\n${eslint.stdout}\n${eslint.stderr}`);

fs.mkdirSync(path.join(root, ".aor/quality"), { recursive: true });
fs.writeFileSync(
  path.join(root, ".aor/quality/quality-ratchet.json"),
  `${JSON.stringify({ status: violations.length === 0 ? "pass" : "fail", file_metrics: fileMetrics, violations }, null, 2)}\n`,
);
if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exit(1);
}
console.log(`quality ratchet ok: ${files.length} production files checked; ESLint passed for ${eslintTargets.length} JavaScript modules`);
