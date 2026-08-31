import fs from "node:fs";
import path from "node:path";

const EVIDENCE = [
  "README.md",
  "docs/backlog/self-hosted-production-readiness.md",
  "docs/ops/production-readiness-gate.md",
  "docs/ops/self-hosted-release.md",
];

function readText(rootDir, file) {
  return fs.readFileSync(path.join(rootDir, file), "utf8");
}

export function checkReadinessSourceOfTruth(rootDir) {
  const findings = [];
  const documents = new Map(EVIDENCE.map((file) => [file, readText(rootDir, file)]));
  const readme = documents.get(EVIDENCE[0]);
  const readiness = documents.get(EVIDENCE[1]);
  const opsRunbook = documents.get(EVIDENCE[2]);
  const releaseRunbook = documents.get(EVIDENCE[3]);

  for (const required of [
    "W69 and W70 are development-complete",
    "W66 remains the release-qualification blocker",
    "release_clearance=false",
  ]) {
    if (!readme.includes(required)) {
      findings.push(`README.md must preserve current development/release status wording '${required}'.`);
    }
  }
  for (const required of ["pnpm production:ready", "docs/ops/self-hosted-release.md"]) {
    if (!readme.includes(required)) findings.push(`README.md must mention '${required}'.`);
  }
  if (!readme.includes("hosted SaaS") || !readme.includes("enterprise identity")) {
    findings.push("README.md must keep hosted SaaS and enterprise identity out of the supported mode.");
  }
  if (!readiness.includes("historical bounded self-hosted release clearance")) {
    findings.push("self-hosted production readiness doc must preserve historical bounded clearance without presenting it as current.");
  }
  if (!readiness.includes("pnpm production:ready")) {
    findings.push("self-hosted production readiness doc must document the production gate command.");
  }
  if (!/sanitized production proof fixture/u.test(readiness)) {
    findings.push("self-hosted production readiness doc must cite the sanitized production proof fixture.");
  }
  if (!opsRunbook.includes("pnpm production:ready") || !/sanitized (?:production )?proof fixture/u.test(opsRunbook)) {
    findings.push("production-readiness runbook must document command usage and proof evidence.");
  }
  for (const required of [
    "bounded self-hosted release clearance",
    "pnpm production:ready",
    "sanitized production proof fixture",
    "hosted SaaS",
    "enterprise identity",
    "no-upstream-write",
  ]) {
    if (!releaseRunbook.includes(required)) {
      findings.push(`self-hosted release runbook must mention '${required}'.`);
    }
  }
  for (const [file, text] of documents) {
    for (const required of ["W66", "audit-hold"]) {
      if (!text.includes(required)) findings.push(`${file} must preserve the ${required} qualification history.`);
    }
  }

  if (findings.length > 0) {
    return {
      id: "source-of-truth-alignment",
      status: "fail",
      summary: "Production readiness source-of-truth docs are inconsistent.",
      findings,
      evidence: EVIDENCE,
    };
  }
  return {
    id: "source-of-truth-alignment",
    status: "pass",
    summary: "README, readiness source-of-truth, production gate, and release runbook align on the W66 qualification disposition.",
    evidence: EVIDENCE,
  };
}
