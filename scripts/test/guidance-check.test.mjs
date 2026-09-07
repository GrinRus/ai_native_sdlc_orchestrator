import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { checkGuidance } from "../guidance-check.mjs";

function fixture(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aor-guidance-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "--quiet", root]);
  const write = (file, content) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  };
  write("package.json", JSON.stringify({ scripts: { check: "node check.mjs", "test:references": "node refs.mjs" } }));
  write("AGENTS.md", "# AGENTS.md\n");
  for (const [file, content] of Object.entries(files)) write(file, content);
  return { root, write };
}

const skill = (body = "", metadata = "name: review-flow\ndescription: Review a bounded flow.") =>
  `---\n${metadata}\n---\n\n${body}\n`;

test("discovers nested guidance and pending new skills without scanning ignored runtime state", (t) => {
  const { root } = fixture(t, {
    ".gitignore": ".aor/\nnode_modules/\n",
    "scripts/live-e2e/fixtures/evidence/AGENTS.md": "# AGENTS.md\n",
    "examples/skills/AGENTS.md": "# AGENTS.md\n",
    ".agents/skills/review-flow/SKILL.md": skill(),
    ".aor/AGENTS.md": "invalid runtime data",
    "node_modules/vendor/AGENTS.md": "not repository guidance",
    "examples/skills/runner.yaml": "skill_id: runtime.runner",
  });
  const result = checkGuidance(root);
  assert.equal(result.ok, true, result.findings.join("\n"));
  assert.equal(result.agents, 3);
  assert.equal(result.skills, 1);
  assert.equal(result.files.some((file) => file.includes("node_modules") || file.startsWith(".aor")), false);
});

test("reports broken skill entrypoint and supporting references at their source lines", (t) => {
  const { root } = fixture(t, {
    ".agents/skills/review-flow/SKILL.md": skill("Read `docs/ops/removed.md` and [detail](references/missing.md)."),
  });
  const result = checkGuidance(root);
  assert.equal(result.ok, false);
  assert.equal(result.findings.length, 2);
  assert.ok(result.findings.every((finding) => finding.includes("SKILL.md:6:")));
  assert.ok(result.findings.some((finding) => finding.includes("docs/ops/removed.md")));
  assert.ok(result.findings.some((finding) => finding.includes("references/missing.md")));
});

test("a root filename collision cannot satisfy a missing instruction-relative reference", (t) => {
  const { root } = fixture(t, {
    ".agents/skills/review-flow/SKILL.md": skill("Read `./details.md`."),
    "details.md": "# Unrelated root document\n",
  });
  assert.ok(checkGuidance(root).findings.some((finding) => finding.includes("missing local reference './details.md'")));
});

test("a skill with supporting resources needs its own discoverable entrypoint", (t) => {
  const { root } = fixture(t, { ".agents/skills/review-flow/references/details.md": "# Details\n" });
  assert.ok(checkGuidance(root).findings.some((finding) => finding.includes("requires a repository SKILL.md entrypoint")));
});

test("explicit skill-local scripts stay relative while Node examples use the repository working directory", (t) => {
  const { root } = fixture(t, {
    ".agents/skills/review-flow/SKILL.md": skill("Read `./scripts/helper.mjs`. Run `node ./scripts/repository-check.mjs`."),
    ".agents/skills/review-flow/scripts/helper.mjs": "",
    "scripts/repository-check.mjs": "",
  });
  assert.deepEqual(checkGuidance(root).findings, []);
});

test("checks Markdown and root-relative code references with spaces and fragments", (t) => {
  const { root } = fixture(t, {
    "docs/AGENTS.md": "# AGENTS.md\nRead [local](<Guide One.md#scope>), [root](/CONTRIBUTING.md), [encoded](Guide%20One.md).\nUse `scripts/verify.mjs` and `Guide One.md`.\n[details]: Guide%20One.md\n",
    "docs/Guide One.md": "# Scope\n",
    "CONTRIBUTING.md": "# Contributing\n",
    "scripts/verify.mjs": "",
  });
  assert.deepEqual(checkGuidance(root).findings, []);
});

test("validates skill metadata including duplicate YAML keys and directory identity", (t) => {
  const { root, write } = fixture(t, {});
  for (const [metadata, expected] of [
    ["name: other\ndescription: valid", "match its directory"],
    ["name: Review Flow\ndescription: valid", "lowercase"],
    ["name: review-flow\ndescription: []", "non-empty string"],
    ["name: review-flow\nname: other\ndescription: valid", "invalid skill frontmatter"],
    ["name: *missing\ndescription: valid", "invalid skill frontmatter"],
  ]) {
    write(".agents/skills/review-flow/SKILL.md", skill("", metadata));
    assert.ok(checkGuidance(root).findings.some((finding) => finding.includes(expected)), expected);
  }
  write(".agents/skills/review-flow/SKILL.md", "# Missing frontmatter\n");
  assert.ok(checkGuidance(root).findings.some((finding) => finding.includes("requires YAML frontmatter")));
});

test("accepts optional skill metadata and runtime/glob/template references", (t) => {
  const { root } = fixture(t, {
    ".agents/skills/review-flow/SKILL.md": skill(
      "Read `docs/contracts/*.md`, `.aor/reports/missing.json`, `docs/<area>/AGENTS.md`, `packet://handoff@1`, and [upstream](https://example.com/guide).\nRun `pnpm install --frozen-lockfile`, `pnpm exec node --version`, or `pnpm run check`.",
      "name: review-flow\ndescription: Review a flow.\nmetadata:\n  short-description: A review helper",
    ),
  });
  assert.deepEqual(checkGuidance(root).findings, []);
});

test("rejects stale package commands and missing Node scripts without executing them", (t) => {
  const { root } = fixture(t, {
    "CONTRIBUTING.md": "# Contributing\nUse `pnpm obsolete:gate`.\n```sh\npnpm run test:references\nnode ./scripts/missing.mjs --apply\nnode scripts/also-missing.mjs\n```\n",
  });
  const findings = checkGuidance(root).findings;
  assert.equal(findings.length, 3);
  assert.ok(findings.some((finding) => finding.includes("CONTRIBUTING.md:2: unknown package command")));
  assert.ok(findings.some((finding) => finding.includes("CONTRIBUTING.md:5: missing local reference")));
  assert.ok(findings.some((finding) => finding.includes("CONTRIBUTING.md:6: missing local reference")));
});

test("accepts pnpm builtins and resolves literal run commands with supported options", (t) => {
  const { root } = fixture(t, {
    "CONTRIBUTING.md": "# Contributing\n`pnpm config get store-dir`\n`pnpm run --if-present optional:check`\n`pnpm run --silent check`\n`pnpm --filter example run build`\n`pnpm run --stream removed:check`\n`pnpm run config`\n",
  });
  const findings = checkGuidance(root).findings;
  assert.equal(findings.length, 2);
  assert.ok(findings.some((finding) => finding.includes("unknown package command 'pnpm removed:check'")));
  assert.ok(findings.some((finding) => finding.includes("unknown package command 'pnpm config'")));
});

test("checks newly added AGENTS headers and detects deleted tracked guidance", (t) => {
  const { root, write } = fixture(t, { "packages/new/AGENTS.md": "# Incorrect heading\n" });
  assert.ok(checkGuidance(root).findings.some((finding) => finding.includes("packages/new/AGENTS.md:1:")));
  write("packages/new/AGENTS.md", "# AGENTS.md\n");
  execFileSync("git", ["-C", root, "add", "AGENTS.md"]);
  fs.rmSync(path.join(root, "AGENTS.md"));
  assert.ok(checkGuidance(root).findings.some((finding) => finding.includes("missing from the working tree")));
});
