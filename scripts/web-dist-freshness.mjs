#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();
const distRoot = path.join(repoRoot, "apps/web/dist");
const manifestPath = path.join(distRoot, "aor-web-dist-manifest.json");
const sourceEntries = [
  "apps/web/index.html",
  "apps/web/package.json",
  "apps/web/vite.config.mjs",
  "apps/web/src",
];

/**
 * @param {string} value
 * @returns {string}
 */
function normalizePath(value) {
  return value.split(path.sep).join("/");
}

/**
 * @param {string} absolutePath
 * @returns {string}
 */
function repoRelative(absolutePath) {
  return normalizePath(path.relative(repoRoot, absolutePath));
}

/**
 * @param {string} entry
 * @returns {string[]}
 */
function collectFiles(entry) {
  const absolute = path.join(repoRoot, entry);
  if (!fs.existsSync(absolute)) return [];
  const stat = fs.statSync(absolute);
  if (stat.isFile()) return [absolute];
  if (!stat.isDirectory()) return [];

  /** @type {string[]} */
  const files = [];
  /** @param {string} directory */
  function walk(directory) {
    for (const name of fs.readdirSync(directory).sort()) {
      const child = path.join(directory, name);
      const childStat = fs.statSync(child);
      if (childStat.isDirectory()) {
        walk(child);
      } else if (childStat.isFile()) {
        files.push(child);
      }
    }
  }
  walk(absolute);
  return files;
}

/**
 * @returns {{ hash: string, files: string[] }}
 */
function computeSourceFingerprint() {
  const files = sourceEntries.flatMap((entry) => collectFiles(entry)).sort();
  const hash = crypto.createHash("sha256");
  for (const file of files) {
    const relative = repoRelative(file);
    hash.update(relative);
    hash.update("\0");
    hash.update(fs.readFileSync(file));
    hash.update("\0");
  }
  return {
    hash: hash.digest("hex"),
    files: files.map((file) => repoRelative(file)),
  };
}

/**
 * @returns {string[]}
 */
function collectDistFiles() {
  if (!fs.existsSync(distRoot)) return [];
  return collectFiles("apps/web/dist")
    .map((file) => repoRelative(file))
    .filter((file) => file !== repoRelative(manifestPath))
    .sort();
}

/**
 * @returns {{ manifest_version: number, source_hash: string, source_files: string[], dist_files: string[], dist_hashes: Record<string, string> }}
 */
function buildManifest() {
  const source = computeSourceFingerprint();
  const distFiles = collectDistFiles();
  return {
    manifest_version: 2,
    source_hash: source.hash,
    source_files: source.files,
    dist_files: distFiles,
    dist_hashes: Object.fromEntries(
      distFiles.map((file) => [
        file,
        crypto.createHash("sha256").update(fs.readFileSync(path.join(repoRoot, file))).digest("hex"),
      ]),
    ),
  };
}

/**
 * @returns {number}
 */
function writeManifest() {
  fs.mkdirSync(distRoot, { recursive: true });
  const manifest = buildManifest();
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`web dist manifest written: ${repoRelative(manifestPath)}`);
  return 0;
}

/**
 * @returns {number}
 */
function checkManifest() {
  if (!fs.existsSync(manifestPath)) {
    console.error("web dist freshness check failed: apps/web/dist/aor-web-dist-manifest.json is missing.");
    console.error("Run `pnpm web:build` and commit the generated packaged SPA bundle.");
    return 1;
  }

  const actual = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const expected = buildManifest();
  const errors = [];
  if (actual?.manifest_version !== expected.manifest_version) {
    errors.push("manifest_version mismatch");
  }
  if (actual?.source_hash !== expected.source_hash) {
    errors.push("source_hash mismatch");
  }
  if (JSON.stringify(actual?.source_files ?? []) !== JSON.stringify(expected.source_files)) {
    errors.push("source_files mismatch");
  }
  if (JSON.stringify(actual?.dist_files ?? []) !== JSON.stringify(expected.dist_files)) {
    errors.push("dist_files mismatch");
  }
  if (JSON.stringify(actual?.dist_hashes ?? {}) !== JSON.stringify(expected.dist_hashes)) {
    errors.push("dist_hashes mismatch");
  }
  if (!fs.existsSync(path.join(distRoot, "index.html"))) {
    errors.push("apps/web/dist/index.html is missing");
  }

  if (errors.length > 0) {
    console.error(`web dist freshness check failed: ${errors.join(", ")}.`);
    console.error("Run `pnpm web:build` and commit the regenerated apps/web/dist artifacts.");
    return 1;
  }

  console.log("web dist freshness ok: packaged SPA matches apps/web source");
  return 0;
}

const command = process.argv[2] ?? "check";
if (command === "write") {
  process.exit(writeManifest());
}
if (command === "check") {
  process.exit(checkManifest());
}

console.error("Usage: node ./scripts/web-dist-freshness.mjs <check|write>");
process.exit(1);
