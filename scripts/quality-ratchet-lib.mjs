import fs from "node:fs";
import path from "node:path";

const FUNCTION_PATTERN = /(?:export\s+)?(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{/gu;
const BRANCH_PATTERN = /\b(?:if|for|while|case|catch|switch)\b|&&|\|\||\?(?!\.)/gu;
const DEAD_CODE_MARKER = new RegExp(`${["@aor-", "dead-code"].join("")}\\b`, "gu");

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/(^|\s)\/\/.*$/gmu, "$1");
}

function findClosingBrace(source, openingIndex) {
  let depth = 0;
  for (let index = openingIndex; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return index;
  }
  return null;
}

function lineCount(source) {
  return source.split("\n").length;
}

export function functionMetrics(source) {
  const metrics = [];
  for (const match of source.matchAll(FUNCTION_PATTERN)) {
    const openingIndex = match.index + match[0].length - 1;
    const closingIndex = findClosingBrace(source, openingIndex);
    if (closingIndex === null) continue;
    metrics.push({
      name: /function\s+([A-Za-z_$][\w$]*)/u.exec(match[0])?.[1] ?? "anonymous",
      lines: lineCount(source.slice(match.index, closingIndex + 1)),
    });
  }
  return metrics;
}

export function maxBraceNesting(source) {
  let depth = 0;
  let maximum = 0;
  for (const character of stripComments(source)) {
    if (character === "{") {
      depth += 1;
      maximum = Math.max(maximum, depth);
    } else if (character === "}") {
      depth = Math.max(0, depth - 1);
    }
  }
  return maximum;
}

function normalizedCloneLines(source) {
  return stripComments(source)
    .split("\n")
    .map((line) => line.trim().replace(/\s+/gu, " "))
    .filter((line) => line.length >= 20);
}

export function duplicateWindowCount(fileSources, windowSize = 6) {
  const windows = new Map();
  for (const [file, source] of Object.entries(fileSources)) {
    const lines = normalizedCloneLines(source);
    for (let index = 0; index <= lines.length - windowSize; index += 1) {
      const signature = lines.slice(index, index + windowSize).join("\n");
      const entries = windows.get(signature) ?? [];
      entries.push(file);
      windows.set(signature, entries);
    }
  }
  let duplicates = 0;
  for (const entries of windows.values()) {
    const distinctFiles = new Set(entries);
    if (distinctFiles.size > 1) duplicates += distinctFiles.size - 1;
  }
  return duplicates;
}

export function collectDebtMetrics(fileSources, { longFunctionMaxLines = 100 } = {}) {
  const fileMetrics = {};
  let totalLines = 0;
  let complexityUnits = 0;
  let maxComplexity = 0;
  let maxFunctionLines = 0;
  let longFunctionCount = 0;
  let maxNesting = 0;
  let deadCodeCandidates = 0;
  for (const file of Object.keys(fileSources).sort()) {
    const source = fileSources[file];
    const functions = functionMetrics(source);
    const complexity = 1 + (stripComments(source).match(BRANCH_PATTERN) ?? []).length;
    const lines = lineCount(source);
    const nesting = maxBraceNesting(source);
    const fileLongFunctions = functions.filter(({ lines: count }) => count > longFunctionMaxLines).length;
    totalLines += lines;
    complexityUnits += complexity;
    maxComplexity = Math.max(maxComplexity, complexity);
    maxFunctionLines = Math.max(maxFunctionLines, ...functions.map(({ lines: count }) => count), 0);
    longFunctionCount += fileLongFunctions;
    maxNesting = Math.max(maxNesting, nesting);
    deadCodeCandidates += (source.match(DEAD_CODE_MARKER) ?? []).length;
    fileMetrics[file] = { lines, complexity, max_function_lines: Math.max(...functions.map(({ lines: count }) => count), 0), long_functions: fileLongFunctions, nesting };
  }
  return {
    file_count: Object.keys(fileSources).length,
    total_lines: totalLines,
    complexity_units: complexityUnits,
    max_complexity: maxComplexity,
    long_function_count: longFunctionCount,
    max_function_lines: maxFunctionLines,
    max_nesting: maxNesting,
    clone_windows: duplicateWindowCount(fileSources),
    dead_code_candidates: deadCodeCandidates,
    files: fileMetrics,
  };
}

export function validateQualityExceptions(exceptions, { now = new Date(), sourceFiles = [] } = {}) {
  const findings = [];
  const seen = new Set();
  for (const [index, entry] of exceptions.entries()) {
    const label = entry?.id ?? `entry-${index + 1}`;
    for (const field of ["id", "path", "category", "owner", "rationale", "expires_at", "successor_slice"]) {
      if (typeof entry?.[field] !== "string" || entry[field].trim() === "") findings.push(`${label}: missing ${field}`);
    }
    if (seen.has(entry?.id)) findings.push(`${label}: duplicate id`);
    seen.add(entry?.id);
    if (typeof entry?.path === "string" && sourceFiles.length > 0 && !sourceFiles.includes(entry.path)) {
      findings.push(`${label}: path '${entry.path}' is not a production source file`);
    }
    if (typeof entry?.expires_at === "string" && Number.isNaN(Date.parse(`${entry.expires_at}T23:59:59.999Z`))) {
      findings.push(`${label}: expires_at must be an ISO date`);
    } else if (typeof entry?.expires_at === "string" && Date.parse(`${entry.expires_at}T23:59:59.999Z`) < now.getTime()) {
      findings.push(`${label}: exception expired on ${entry.expires_at}`);
    }
    if (!Number.isFinite(entry?.ceiling) || entry.ceiling < 0) findings.push(`${label}: ceiling must be a non-negative number`);
  }
  return findings;
}

export function readSourceFiles(root, sourceRoots = ["apps", "packages", "scripts"]) {
  const extensions = new Set([".mjs", ".js", ".jsx", ".css", ".ts", ".tsx"]);
  const files = [];
  function walk(relative) {
    const absolute = path.join(root, relative);
    if (!fs.existsSync(absolute)) return;
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
      const child = path.join(relative, entry.name);
      if (entry.isDirectory()) {
        if (!["dist", "test", "browser", "node_modules"].includes(entry.name)) walk(child);
      } else if (entry.isFile() && !entry.name.endsWith(".d.ts") && extensions.has(path.extname(entry.name))) {
        files.push(child.split(path.sep).join("/"));
      }
    }
  }
  for (const sourceRoot of sourceRoots) walk(sourceRoot);
  return files.sort();
}
