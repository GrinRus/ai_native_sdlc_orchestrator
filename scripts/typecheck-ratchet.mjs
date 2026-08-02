#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const baseline = JSON.parse(fs.readFileSync(path.join(root, "scripts/quality-baseline.json"), "utf8"));
const result = spawnSync(
  process.platform === "win32" ? "pnpm.cmd" : "pnpm",
  ["exec", "tsc", "--project", "tsconfig.quality.json", "--pretty", "false"],
  { cwd: root, encoding: "utf8" },
);
const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
const diagnostics = output ? output.split("\n").filter((line) => /error TS\d+:/u.test(line)) : [];
fs.mkdirSync(path.join(root, ".aor/quality"), { recursive: true });
fs.writeFileSync(
  path.join(root, ".aor/quality/typecheck.json"),
  `${JSON.stringify({ status: diagnostics.length <= baseline.typecheck_max_diagnostics ? "pass" : "fail", diagnostics }, null, 2)}\n`,
);
if (diagnostics.length > baseline.typecheck_max_diagnostics) {
  console.error(output);
  console.error(`Typecheck diagnostics increased: ${diagnostics.length} > ${baseline.typecheck_max_diagnostics}.`);
  process.exit(1);
}
console.log(`typecheck ratchet ok: ${diagnostics.length}/${baseline.typecheck_max_diagnostics} baseline diagnostics`);
