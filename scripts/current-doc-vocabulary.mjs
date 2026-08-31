import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const roots = ["README.md", "docs/architecture", "docs/ops"];
const excluded = new Set([
  "docs/ops/quiet-cockpit-cutover.md",
]);
const forbidden = [
  { pattern: /\bFlow selector\b/iu, replacement: "Task list or internal Flow lineage" },
  { pattern: /\bNew Flow\b/iu, replacement: "New task or follow-up Task" },
  { pattern: /\bConfirm and start\b/iu, replacement: "Prepare task and Start task" },
  { pattern: /\bfirst-run wizard\b/iu, replacement: "clean-project Task Workspace" },
  { pattern: /Quiet Cockpit is the packaged/iu, replacement: "Task Workspace is the packaged" },
];

function markdownFiles(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (fs.statSync(absolutePath).isFile()) return [relativePath];
  const files = [];
  for (const entry of fs.readdirSync(absolutePath, { withFileTypes: true })) {
    const child = path.join(relativePath, entry.name);
    if (entry.isDirectory()) {
      if (child === "docs/architecture/adr") continue;
      files.push(...markdownFiles(child));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(child);
    }
  }
  return files;
}

const findings = [];
for (const file of roots.flatMap(markdownFiles).filter((entry) => !excluded.has(entry)).sort()) {
  const lines = fs.readFileSync(path.join(root, file), "utf8").split(/\r?\n/u);
  lines.forEach((line, index) => {
    for (const rule of forbidden) {
      if (rule.pattern.test(line)) findings.push(`${file}:${index + 1} uses retired installed-UI vocabulary; use '${rule.replacement}' or move historical evidence under docs/research/.`);
    }
  });
}

if (findings.length) {
  process.stderr.write(`${findings.join("\n")}\n`);
  process.exit(1);
}

process.stdout.write("current docs use Task Workspace vocabulary\n");
