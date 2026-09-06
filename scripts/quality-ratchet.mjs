#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { runCheckedProcess } from "./process-runner.mjs";
import {
  collectDebtMetrics,
  readSourceFiles,
  validateQualityExceptions,
} from "./quality-ratchet-lib.mjs";

const root = process.cwd();
const baseline = JSON.parse(fs.readFileSync(path.join(root, "scripts/quality-baseline.json"), "utf8"));
const exceptionPath = path.join(root, "scripts/quality-exceptions.json");
const exceptions = JSON.parse(fs.readFileSync(exceptionPath, "utf8"));
const sourceFiles = readSourceFiles(root);
const sourceSet = new Set(sourceFiles);
const sourceMap = Object.fromEntries(sourceFiles.map((file) => [file, fs.readFileSync(path.join(root, file), "utf8")]));
const violations = [];

if (exceptions.schema_version !== 1 || !Array.isArray(exceptions.exceptions)) {
  violations.push("quality exceptions manifest must use schema_version 1 and an exceptions array");
} else {
  violations.push(...validateQualityExceptions(exceptions.exceptions, { sourceFiles }));
}

const exceptionByPath = new Map(
  (exceptions.exceptions ?? [])
    .filter((entry) => entry?.category === "file-lines")
    .map((entry) => [entry.path, entry]),
);
for (const [file, source] of Object.entries(sourceMap)) {
  const lines = source.split("\n").length;
  const exception = exceptionByPath.get(file);
  const allowed = exception?.ceiling ?? baseline.file_line_ceiling_overrides?.[file] ?? baseline.new_file_max_lines;
  if (lines > allowed) violations.push(`${file}: ${lines} lines exceeds ceiling ${allowed}`);
  if (exception && baseline.file_line_ceiling_overrides?.[file] !== exception.ceiling) {
    violations.push(`${file}: file-lines exception ceiling must match quality-baseline.json`);
  }
}
for (const [file, ceiling] of Object.entries(baseline.file_line_ceiling_overrides ?? {})) {
  if (!sourceSet.has(file)) violations.push(`quality baseline override references missing source file '${file}'`);
  if (!exceptionByPath.has(file)) violations.push(`${file}: baseline file ceiling lacks an owned exception`);
  if (exceptionByPath.has(file) && exceptionByPath.get(file).ceiling !== ceiling) {
    violations.push(`${file}: baseline and exception ceilings differ`);
  }
}

const facadeFunctions = baseline.facade_functions ?? [];
function functionLineCount(file, functionName) {
  const source = sourceMap[file];
  if (!source) return null;
  const start = source.search(new RegExp(`export\\s+(?:async\\s+)?function\\s+${functionName}\\s*\\(`, "u"));
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
for (const entry of facadeFunctions) {
  const lines = functionLineCount(entry.file, entry.name);
  if (lines === null) violations.push(`${entry.file}: exported facade '${entry.name}' was not found`);
  else if (lines > baseline.facade_function_max_lines) {
    violations.push(`${entry.file}: exported facade '${entry.name}' has ${lines} lines; maximum is ${baseline.facade_function_max_lines}`);
  }
}

const debtMetrics = collectDebtMetrics(sourceMap, {
  longFunctionMaxLines: baseline.debt_policy?.long_function_max_lines ?? 100,
});
const baselineMetrics = baseline.debt_metrics ?? {};
const debtKeys = [
  "total_lines",
  "complexity_units",
  "max_complexity",
  "long_function_count",
  "max_function_lines",
  "max_nesting",
  "clone_windows",
  "dead_code_candidates",
];
for (const key of debtKeys) {
  if (!Number.isFinite(baselineMetrics[key])) {
    violations.push(`quality baseline is missing debt_metrics.${key}`);
  } else if (debtMetrics[key] > baselineMetrics[key]) {
    violations.push(`quality debt increased for ${key}: ${debtMetrics[key]} > ${baselineMetrics[key]}`);
  }
}

const eslintTargets = sourceFiles.filter((file) => /\.(?:mjs|js|jsx)$/u.test(file));
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
  `${JSON.stringify({
    schema_version: 1,
    status: violations.length === 0 ? "pass" : "fail",
    source_files: sourceFiles,
    debt_metrics: debtMetrics,
    baseline_metrics: baselineMetrics,
    exceptions: exceptions.exceptions ?? [],
    violations,
  }, null, 2)}\n`,
);
if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exit(1);
}
console.log(`quality ratchet ok: ${sourceFiles.length} production files checked; ESLint passed for ${eslintTargets.length} JavaScript modules; structural debt is non-increasing`);
