#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const manifestPath = path.join(root, "scripts/state-transaction-direct-write-exceptions.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const today = new Date().toISOString().slice(0, 10);
const directWrite = /fs\.(?:writeFileSync|appendFileSync|renameSync)\s*\(/u;
const sharedStateReference = /(?:state(?:File|Path)?|requestFile|submission(?:File|Path)?|attempt(?:File|Path)?|runControl)/u;
const entries = Array.isArray(manifest.entries) ? manifest.entries : [];
const violations = [];

function walk(relative) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) return [];
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) return walk(child);
    return entry.isFile() && entry.name.endsWith(".mjs") ? [child.split(path.sep).join("/")] : [];
  });
}

for (const file of [...walk("packages/orchestrator-core/src"), ...walk("packages/observability/src")].sort()) {
  if (file === "packages/observability/src/file-transaction.mjs") continue;
  const lines = fs.readFileSync(path.join(root, file), "utf8").split("\n");
  lines.forEach((line, index) => {
    if (!directWrite.test(line) || !sharedStateReference.test(line)) return;
    const match = entries.find((entry) => entry.file === file && line.includes(entry.match));
    if (!match) violations.push(`${file}:${index + 1}: unowned shared-state direct write`);
    else if (String(match.expires) < today) violations.push(`${file}:${index + 1}: exception '${match.owner}' expired on ${match.expires}`);
  });
}

if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exit(1);
}
console.log(`state transaction ratchet ok: ${entries.length} owned exceptions checked`);
