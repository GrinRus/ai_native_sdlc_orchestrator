import fs from "node:fs";
import path from "node:path";

const S1_FINDINGS = new Set([
  "AUD-001", "AUD-002", "AUD-003", "AUD-004", "AUD-005", "AUD-006", "AUD-007", "AUD-008",
  "AUD-009", "AUD-010", "AUD-011", "AUD-012", "AUD-013", "AUD-014", "AUD-015", "AUD-016",
  "AUD-017", "AUD-018", "AUD-019", "AUD-020", "AUD-022", "project-context-cwd-divergence",
]);

function readJson(rootDir, file) {
  return JSON.parse(fs.readFileSync(path.isAbsolute(file) ? file : path.join(rootDir, file), "utf8"));
}

function exists(rootDir, file) {
  return fs.existsSync(path.isAbsolute(file) ? file : path.join(rootDir, file));
}

function evidenceExists(rootDir, ref) {
  const file = String(ref).split("#", 1)[0];
  return file.length > 0 && exists(rootDir, file);
}

export function checkW59ClosureReport(options) {
  const { rootDir, auditLedgerPath, closureReportPath, independentReviewPath } = options;
  const evidence = [auditLedgerPath, closureReportPath, independentReviewPath];
  const findings = [];
  let ledger;
  let report;
  let review;
  try {
    ledger = readJson(rootDir, auditLedgerPath);
    report = readJson(rootDir, closureReportPath);
    review = readJson(rootDir, independentReviewPath);
  } catch (error) {
    return {
      id: "w59-audit-closure",
      status: "fail",
      summary: "W59 closure or independent review evidence is missing or invalid.",
      findings: [error.message],
      evidence,
    };
  }

  if (report.schema_version !== 1 || report.wave_id !== "W59" || report.status !== "passed") {
    findings.push("W59 closure must declare schema_version=1, wave_id=W59, and status=passed.");
  }
  if (report.release_disposition_after_wave !== "cleared" || report.release_clearance !== true) {
    findings.push("W59 closure must record cleared bounded self-hosted release disposition.");
  }
  if (!/^[a-f0-9]{40}$/u.test(report.baseline_commit) || !/^[a-f0-9]{40}$/u.test(report.closure_commit)) {
    findings.push("W59 closure must pin full baseline and closure commit SHAs.");
  }
  if (report.commit_range !== `${report.baseline_commit}..${report.closure_commit}`) {
    findings.push("W59 closure commit_range must exactly match baseline_commit..closure_commit.");
  }
  if (report.baseline_commit !== "db9951718083804bab1e1e4028a8a713bd2ec574") {
    findings.push("W59 closure must retain the July audit baseline db995171.");
  }

  const ledgerById = new Map((ledger.findings ?? []).map((entry) => [entry.finding_id, entry]));
  const entries = Array.isArray(report.findings) ? report.findings : [];
  const reportById = new Map();
  for (const entry of entries) {
    if (reportById.has(entry.finding_id)) findings.push(`W59 closure finding '${entry.finding_id}' is duplicated.`);
    reportById.set(entry.finding_id, entry);
  }
  for (let sequence = 1; sequence <= 55; sequence += 1) {
    const findingId = `AUD-${String(sequence).padStart(3, "0")}`;
    const entry = reportById.get(findingId);
    const ledgerEntry = ledgerById.get(findingId);
    if (!entry) {
      findings.push(`W59 closure report is missing '${findingId}'.`);
      continue;
    }
    if (entry.disposition !== "resolved" || !ledgerEntry) {
      findings.push(`W59 closure finding '${findingId}' must be resolved in the report and present in the ledger.`);
    }
    const refs = Array.isArray(entry.evidence_refs) ? entry.evidence_refs : [];
    if (refs.length === 0) findings.push(`W59 closure finding '${findingId}' must cite direct evidence.`);
    for (const ref of refs) {
      if (!evidenceExists(rootDir, ref)) findings.push(`W59 closure evidence '${ref}' for '${findingId}' does not exist.`);
    }
  }
  for (const findingId of reportById.keys()) {
    if (!/^AUD-(?:00[1-9]|0[1-4][0-9]|05[0-5])$/u.test(findingId)) {
      findings.push(`Unexpected finding '${findingId}' appears in the W59 closure report.`);
    }
  }
  if (
    review.schema_version !== 1 ||
    review.decision !== "pass" ||
    review.review_target_commit !== report.closure_commit ||
    typeof review.reviewer_identity !== "string" ||
    review.reviewer_identity.length === 0
  ) {
    findings.push("Independent S1 review must pass with reviewer identity and the exact W59 closure target SHA.");
  }
  const reviewed = new Map();
  for (const entry of Array.isArray(review.reviews) ? review.reviews : []) {
    if (reviewed.has(entry.finding_id)) findings.push(`Independent review duplicates '${entry.finding_id}'.`);
    reviewed.set(entry.finding_id, entry);
  }
  for (const findingId of S1_FINDINGS) {
    const entry = reviewed.get(findingId);
    if (!entry || entry.result !== "pass") findings.push(`Independent S1 review is missing a passing '${findingId}' result.`);
    for (const ref of entry?.evidence_refs ?? []) {
      if (!evidenceExists(rootDir, ref)) findings.push(`Independent review evidence '${ref}' for '${findingId}' does not exist.`);
    }
  }
  for (const findingId of reviewed.keys()) {
    if (!S1_FINDINGS.has(findingId)) findings.push(`Independent S1 review contains unexpected '${findingId}'.`);
  }
  if (!Array.isArray(review.review_urls) || review.review_urls.length === 0) {
    findings.push("Independent S1 review must cite external review/check URLs.");
  }

  if (findings.length > 0) {
    return {
      id: "w59-audit-closure",
      status: "fail",
      summary: "W59 audit closure evidence is incomplete or drifting.",
      findings,
      evidence,
    };
  }
  return {
    id: "w59-audit-closure",
    status: "pass",
    summary: "All 55 audit findings and original S1 regressions have evidence-backed closure for the bounded self-hosted scope.",
    evidence,
  };
}
