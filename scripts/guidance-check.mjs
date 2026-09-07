import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";

const entrypoints = new Set(["README.md", "CONTRIBUTING.md", ".github/PULL_REQUEST_TEMPLATE.md"]);
const pnpmBuiltins = new Set([
  "add", "approve-builds", "audit", "bin", "cat-file", "cat-index", "config", "create", "dedupe", "deploy",
  "dlx", "env", "exec", "fetch", "find-hash", "help", "import", "init", "install", "install-test", "licenses",
  "link", "list", "outdated", "pack", "patch", "patch-commit", "patch-remove",
  "prune", "publish", "rebuild", "remove", "root", "self-update", "server", "setup",
  "store", "unlink", "update", "view", "why", "i", "it", "ln", "ls", "rb", "rm", "up",
]);
const runBooleanOptions = new Set(["--if-present", "--silent", "--stream", "--parallel"]);
const repoPath = /^(?:docs|examples|apps|packages|scripts|\.agents|\.github)\//u;

export function listRepositoryFiles(root) {
  return [...new Set(execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  }).split("\0").filter(Boolean))].sort();
}

function isGuidance(file) {
  return path.posix.basename(file) === "AGENTS.md"
    || (file.startsWith(".agents/") && file.endsWith(".md"))
    || entrypoints.has(file);
}

function skillMetadata(content, file, findings) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(content);
  if (!match) {
    findings.push(`${file}:1: skill requires YAML frontmatter with name and description.`);
    return;
  }
  const document = parseDocument(match[1]);
  if (document.errors.length > 0) {
    findings.push(`${file}:1: invalid skill frontmatter: ${document.errors[0].message}`);
    return;
  }
  let metadata;
  try {
    metadata = document.toJSON();
  } catch (error) {
    findings.push(`${file}:1: invalid skill frontmatter: ${error.message}`);
    return;
  }
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    findings.push(`${file}:1: skill frontmatter must be a mapping.`);
    return;
  }
  const name = metadata.name;
  if (typeof name !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(name) || name.length > 64) {
    findings.push(`${file}:1: skill name must be lowercase words separated by hyphens, at most 64 characters.`);
  } else if (name !== path.posix.basename(path.posix.dirname(file))) {
    findings.push(`${file}:1: skill name '${name}' must match its directory.`);
  }
  if (typeof metadata.description !== "string" || !metadata.description.trim()) {
    findings.push(`${file}:1: skill description must be a non-empty string.`);
  }
}

function concretePath(value) {
  // Templates, globs and runtime/remote refs are intentionally not local files.
  if (!value || /[<>*{}$]|\.\.\.|^[a-z][a-z0-9+.-]*:|^#/iu.test(value)) return null;
  try {
    return decodeURIComponent(value.split("#")[0]);
  } catch {
    return null;
  }
}

function checkPath(root, file, line, value, markdown, findings) {
  const target = concretePath(value);
  if (!target) return;
  if (!markdown && !repoPath.test(target) && !/^\.\.?\//u.test(target)) return;
  if (target.startsWith(".aor/") || target.startsWith("~")) return;
  // Markdown is document-relative. Inline repository paths are root-relative;
  // explicit ./ and ../ paths are relative to the instruction file. Bare
  // filenames can describe generated output and are not actionable file refs.
  const candidates = markdown
    ? [target.startsWith("/") ? path.resolve(root, `.${target}`) : path.resolve(root, path.dirname(file), target)]
    : repoPath.test(target)
      ? [path.resolve(root, target)]
      : [path.resolve(root, path.dirname(file), target)];
  if (!candidates.some((candidate) => fs.existsSync(candidate))) {
    findings.push(`${file}:${line}: missing local reference '${value}'.`);
  }
}

function checkCommands(root, file, line, content, scripts, findings) {
  for (const match of content.matchAll(/\bpnpm\s+([a-z][\w:-]*)([^`\n;&|]*)/gu)) {
    let command = match[1];
    const explicitRun = command === "run";
    if (explicitRun) {
      const args = match[2].trim().split(/\s+/u);
      // Workspace selectors and options with values need command-specific
      // interpretation. Only resolve a literal root script when unambiguous.
      let optional = false;
      while (runBooleanOptions.has(args[0])) {
        optional ||= args[0] === "--if-present";
        args.shift();
      }
      if (args[0] === "--") args.shift();
      command = args[0];
      if (optional || !command || !/^[a-z][\w:-]*$/u.test(command)) continue;
    }
    if ((explicitRun || !pnpmBuiltins.has(command)) && !Object.hasOwn(scripts, command)) {
      findings.push(`${file}:${line}: unknown package command 'pnpm ${command}'.`);
    }
  }
  for (const match of content.matchAll(/\bnode\s+(?:--[\w=-]+\s+)*((?:\.\/)?(?:scripts|apps|packages)\/[^\s`]+\.mjs)\b/gu)) {
    checkPath(root, file, line, match[1].replace(/^\.\//u, ""), false, findings);
  }
}

function checkReferences(root, file, content, scripts, findings) {
  let fence = null;
  for (const [index, line] of content.split(/\r?\n/u).entries()) {
    const marker = /^\s*(`{3,}|~{3,})/u.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker[0];
      else if (marker[0] === fence) fence = null;
      continue;
    }
    if (fence) {
      checkCommands(root, file, index + 1, line, scripts, findings);
      continue;
    }
    for (const match of line.matchAll(/!?\[[^\]]*\]\((<[^>]+>|[^\s)]+)(?:\s+"[^"]*")?\)/gu)) {
      checkPath(root, file, index + 1, match[1].replace(/^<|>$/gu, ""), true, findings);
    }
    const definition = /^\s*\[[^\]]+\]:\s*(<[^>]+>|\S+)/u.exec(line);
    if (definition) checkPath(root, file, index + 1, definition[1].replace(/^<|>$/gu, ""), true, findings);
    for (const match of line.matchAll(/`([^`\n]+)`/gu)) {
      const value = match[1];
      if (!/\s/u.test(value)) checkPath(root, file, index + 1, value, false, findings);
      checkCommands(root, file, index + 1, value, scripts, findings);
    }
  }
}

export function checkGuidance(root) {
  const repositoryFiles = listRepositoryFiles(root);
  const files = repositoryFiles.filter(isGuidance);
  const scripts = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).scripts ?? {};
  const findings = [];
  const skillDirectories = new Set(repositoryFiles.map((file) => /^\.agents\/skills\/([^/]+)\//u.exec(file)?.[1]).filter(Boolean));
  for (const directory of skillDirectories) {
    const entrypoint = `.agents/skills/${directory}/SKILL.md`;
    if (!repositoryFiles.includes(entrypoint)) findings.push(`${entrypoint}:1: skill directory requires a repository SKILL.md entrypoint.`);
  }
  for (const file of files) {
    const absolute = path.join(root, file);
    if (!fs.existsSync(absolute)) {
      findings.push(`${file}:1: guidance file is missing from the working tree.`);
      continue;
    }
    const content = fs.readFileSync(absolute, "utf8");
    if (path.posix.basename(file) === "AGENTS.md" && !content.trimStart().startsWith("# AGENTS.md")) {
      findings.push(`${file}:1: expected '# AGENTS.md' heading.`);
    }
    if (file.startsWith(".agents/skills/") && file.endsWith("/SKILL.md")) skillMetadata(content, file, findings);
    checkReferences(root, file, content, scripts, findings);
  }
  return {
    ok: findings.length === 0,
    findings: [...new Set(findings)],
    agents: files.filter((file) => path.posix.basename(file) === "AGENTS.md").length,
    skills: files.filter((file) => file.startsWith(".agents/skills/") && file.endsWith("/SKILL.md")).length,
    files,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = checkGuidance(process.cwd());
  if (!result.ok) {
    console.error(result.findings.join("\n"));
    process.exitCode = 1;
  } else {
    console.log(`guidance integrity ok: ${result.agents} AGENTS files, ${result.skills} skills; local references and commands checked`);
  }
}
