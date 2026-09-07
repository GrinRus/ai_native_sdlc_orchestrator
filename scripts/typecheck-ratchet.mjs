#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { runCheckedProcess } from "./process-runner.mjs";

const root = process.cwd();
const baseline = JSON.parse(fs.readFileSync(path.join(root, "scripts/quality-baseline.json"), "utf8"));
const result = runCheckedProcess({
  label: "typecheck",
  command: process.platform === "win32" ? "pnpm.cmd" : "pnpm",
  args: ["exec", "tsc", "--project", "tsconfig.quality.json", "--pretty", "false"],
  cwd: root,
  timeoutMs: Number(process.env.AOR_TYPECHECK_TIMEOUT_MS ?? 180_000),
});
const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
const diagnostics = output ? output.split("\n").filter((line) => /error TS\d+:/u.test(line)) : [];
fs.mkdirSync(path.join(root, ".aor/quality"), { recursive: true });
fs.writeFileSync(
  path.join(root, ".aor/quality/typecheck.json"),
  `${JSON.stringify({ status: diagnostics.length <= baseline.typecheck_max_diagnostics ? "pass" : "fail", diagnostics }, null, 2)}\n`,
);
if (!result.ok || diagnostics.length > baseline.typecheck_max_diagnostics) {
  console.error(output);
  if (!result.ok) console.error(`Typecheck process failed: ${result.failure_type}: ${result.message}`);
  console.error(`Typecheck diagnostics increased: ${diagnostics.length} > ${baseline.typecheck_max_diagnostics}.`);
  process.exit(1);
}
console.log(`typecheck ratchet ok: ${diagnostics.length}/${baseline.typecheck_max_diagnostics} baseline diagnostics`);
