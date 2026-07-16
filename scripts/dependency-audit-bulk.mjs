#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import YAML from "yaml";

const root = process.cwd();
const lock = YAML.parse(fs.readFileSync(path.join(root, "pnpm-lock.yaml"), "utf8"));
const productionDependencies = lock.importers?.["."]?.dependencies ?? {};
const requestBody = {};
for (const [name, metadata] of Object.entries(productionDependencies)) {
  const version = String(metadata.version ?? "").split("(", 1)[0];
  if (version) requestBody[name] = [version];
}

const endpoint = "https://registry.npmjs.org/-/npm/v1/security/advisories/bulk";
const response = await fetch(endpoint, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json" },
  body: JSON.stringify(requestBody),
});
if (!response.ok) throw new Error(`Bulk dependency audit failed with HTTP ${response.status}.`);
const advisories = await response.json();
const advisoryCount = Object.values(advisories).reduce(
  (count, entries) => count + (Array.isArray(entries) ? entries.length : 0),
  0,
);
const report = {
  schema_version: 1,
  status: advisoryCount === 0 ? "pass" : "fail",
  endpoint,
  dependency_scope: "production",
  audited_packages: requestBody,
  advisory_count: advisoryCount,
  advisories,
  audited_at: new Date().toISOString(),
};
const reportPath = path.join(root, "node_modules/.cache/aor/dependency-audit-prod.json");
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ status: report.status, advisory_count: advisoryCount, report: reportPath })}\n`);
if (advisoryCount > 0) process.exit(1);
