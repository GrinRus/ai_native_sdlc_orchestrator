#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { runCheckedProcess } from "./process-runner.mjs";

const root = process.cwd();
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const timeoutMs = Number(process.env.AOR_DEPENDENCY_AUDIT_TIMEOUT_MS ?? 120_000);
const exceptionPath = path.join(root, "scripts/dependency-audit-exceptions.json");
const exceptionsDocument = JSON.parse(fs.readFileSync(exceptionPath, "utf8"));
const now = Date.now();
const findings = [];
for (const exception of exceptionsDocument.exceptions ?? []) {
  if (!exception?.advisory || !exception?.owner || !exception?.reason || !exception?.expires_at) {
    findings.push("Every dependency audit exception requires advisory, owner, reason, and expires_at.");
  } else if (Date.parse(`${exception.expires_at}T23:59:59.999Z`) < now) {
    findings.push(`Dependency audit exception '${exception.advisory}' expired on ${exception.expires_at}.`);
  }
}

const commands = [
  { id: "full", args: ["audit", "--audit-level", "high", "--json"] },
  { id: "production", args: ["audit", "--prod", "--audit-level", "high", "--json"] },
];
const audits = commands.map((entry) => runCheckedProcess({
  label: `dependency audit (${entry.id})`,
  command: pnpm,
  args: entry.args,
  cwd: root,
  timeoutMs,
}));
for (const audit of audits) {
  if (!audit.ok) findings.push(`${audit.label}: ${audit.failure_type}: ${audit.message}`);
}

const report = {
  schema_version: 1,
  status: findings.length === 0 ? "pass" : "fail",
  timeout_ms: timeoutMs,
  exceptions: exceptionsDocument.exceptions ?? [],
  audits,
  findings,
};
const reportPath = path.join(root, ".aor/quality/dependency-audit.json");
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
if (findings.length > 0) {
  console.error(findings.join("\n"));
  process.exit(1);
}
console.log("dependency audits ok: full and production high-severity scans passed");
