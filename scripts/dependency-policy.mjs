#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import YAML from "yaml";

const root = process.cwd();
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const lockfile = YAML.parse(fs.readFileSync(path.join(root, "pnpm-lock.yaml"), "utf8"));
const direct = { ...packageJson.dependencies, ...packageJson.devDependencies };
const findings = [];
const importer = lockfile.importers?.["."] ?? {};
const lockedDirect = { ...importer.dependencies, ...importer.devDependencies };
for (const dependency of Object.keys(direct)) {
  if (!Object.prototype.hasOwnProperty.call(lockedDirect, dependency)) {
    findings.push(`${dependency} is absent from pnpm-lock.yaml`);
  }
}
if (Object.keys(packageJson.dependencies ?? {}).some((name) => name !== "yaml")) {
  findings.push("The root runtime dependency allowlist permits only yaml during W59.");
}
if (packageJson.engines?.node !== ">=22 <23") {
  findings.push("package.json engines.node must remain the tested Node 22.x range >=22 <23.");
}
for (const scriptName of ["audit:all", "audit:prod:bulk"]) {
  if (typeof packageJson.scripts?.[scriptName] !== "string") findings.push(`package.json scripts.${scriptName} is required for dependency policy.`);
}
const auditExceptions = JSON.parse(fs.readFileSync(path.join(root, "scripts/dependency-audit-exceptions.json"), "utf8"));
for (const exception of auditExceptions.exceptions ?? []) {
  if (!exception?.advisory || !exception?.owner || !exception?.reason || !exception?.expires_at) {
    findings.push("Dependency audit exceptions require advisory, owner, reason, and expires_at.");
  } else if (Date.parse(`${exception.expires_at}T23:59:59.999Z`) < Date.now()) {
    findings.push(`Dependency audit exception '${exception.advisory}' has expired.`);
  }
}
const report = {
  schema_version: 1,
  status: findings.length === 0 ? "pass" : "fail",
  package_model: "documented-root-monolith",
  runtime_dependencies: packageJson.dependencies,
  development_dependencies: packageJson.devDependencies,
  findings,
};
fs.mkdirSync(path.join(root, ".aor/quality"), { recursive: true });
fs.writeFileSync(path.join(root, ".aor/quality/dependency-policy.json"), `${JSON.stringify(report, null, 2)}\n`);
if (findings.length > 0) {
  console.error(findings.join("\n"));
  process.exit(1);
}
console.log(`dependency policy ok: ${Object.keys(direct).length} direct dependencies are locked; runtime allowlist unchanged`);
