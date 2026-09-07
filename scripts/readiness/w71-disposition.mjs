import fs from "node:fs";
import path from "node:path";

export const DEFAULT_W71_DISPOSITION_PATH = "docs/research/26-w71-audit-disposition.json";
export const DEFAULT_S14_EVIDENCE_PATH = "docs/research/27-w71-s14-installed-control-plane-evidence.json";

const CLOSED_STATES = new Set(["resolved", "superseded"]);
const INTEGRATED_TIERS = new Set(["baseline", "integrated-local"]);
const INTEGRATED_EVIDENCE_STATUSES = new Set([
  "integrated-local-pass-with-provider-hold",
  "integrated-local-pass-with-open-s14-gaps",
]);
const EXPECTED_FINDINGS = new Set(
  Array.from({ length: 12 }, (_, index) => `W71-AUD-${String(index + 1).padStart(3, "0")}`),
);

function readJson(rootDir, file) {
  return JSON.parse(fs.readFileSync(path.isAbsolute(file) ? file : path.join(rootDir, file), "utf8"));
}

function fileExists(rootDir, file) {
  return fs.existsSync(path.isAbsolute(file) ? file : path.join(rootDir, file));
}

function pass(summary, evidence) {
  return { id: "w71-audit-disposition", status: "pass", summary, evidence };
}

function fail(summary, findings, evidence) {
  return { id: "w71-audit-disposition", status: "fail", summary, findings, evidence };
}

function integratedEvidenceFindings(rootDir, evidenceRef = DEFAULT_S14_EVIDENCE_PATH) {
  try {
    const evidence = readJson(rootDir, evidenceRef);
    return [
      [INTEGRATED_EVIDENCE_STATUSES.has(evidence.status), "Integrated-local W71 evidence must declare a supported integrated-local pass status."],
      [evidence.qualification_freeze?.adversarial_proof_status === "pass", "Integrated-local W71 evidence must include a passing adversarial proof."],
      [String(evidence.qualification_freeze?.manifest_sha256).startsWith("sha256:"), "Integrated-local W71 evidence must include a digest-addressed qualification manifest."],
    ].filter(([valid]) => !valid).map(([, message]) => message);
  } catch (error) {
    return [`Integrated-local W71 evidence is invalid: ${error.message}`];
  }
}

export function checkW71AuditDisposition(
  rootDir,
  dispositionPath = DEFAULT_W71_DISPOSITION_PATH,
) {
  const findings = [];
  if (!fileExists(rootDir, dispositionPath)) {
    return fail("Post-W70 W71 audit disposition is missing.", [`${dispositionPath} is missing.`], [dispositionPath]);
  }

  let disposition;
  try {
    disposition = readJson(rootDir, dispositionPath);
  } catch (error) {
    return fail("Post-W70 W71 audit disposition is invalid.", [error.message], [dispositionPath]);
  }

  if (disposition.schema_version !== 1) findings.push("W71 disposition must declare schema_version=1.");
  if (disposition.disposition_id !== "aor-post-w70-audit-disposition-2026-09") {
    findings.push("W71 disposition_id is not the registered post-W70 disposition.");
  }
  if (disposition.release_disposition !== "audit-hold" || disposition.release_clearance !== false) {
    findings.push("W71 disposition must preserve release_disposition=audit-hold and release_clearance=false.");
  }
  const currentIntegratedTier = disposition.evidence_policy?.current_integrated_tier;
  findings.push(...["W71 disposition current_integrated_tier must be baseline or integrated-local."]
    .filter(() => !INTEGRATED_TIERS.has(currentIntegratedTier)));
  if (disposition.evidence_policy?.historical_provider_evidence_is_current !== false) {
    findings.push("Historical provider evidence must not be treated as current W71 integrated proof.");
  }
  if (disposition.evidence_policy?.mock_or_route_fulfilled_evidence_is_integrated_proof !== false) {
    findings.push("Mock or route-fulfilled evidence must not be treated as integrated proof.");
  }

  const entries = Array.isArray(disposition.findings) ? disposition.findings : [];
  const byId = new Map();
  for (const entry of entries) {
    const id = typeof entry?.finding_id === "string" ? entry.finding_id.trim() : "";
    if (!id) {
      findings.push("Every W71 finding must have a non-empty finding_id.");
      continue;
    }
    if (byId.has(id)) findings.push(`W71 finding '${id}' is duplicated.`);
    byId.set(id, entry);
    if (!/^W71-AUD-\d{3}$/u.test(id)) findings.push(`W71 finding '${id}' has an invalid stable ID.`);
    if (!new Set(["S1", "S2", "S3"]).has(entry.severity)) findings.push(`W71 finding '${id}' has invalid severity '${entry.severity}'.`);
    if (!new Set(["open", "in-progress", "resolved", "accepted-risk", "superseded"]).has(entry.state)) {
      findings.push(`W71 finding '${id}' has invalid state '${entry.state}'.`);
    }
    if (!Array.isArray(entry.owner_slices) || entry.owner_slices.length === 0 || entry.owner_slices.some((slice) => !/^W71-S\d+$/u.test(String(slice)))) {
      findings.push(`W71 finding '${id}' must declare W71 owner_slices.`);
    }
    if (typeof entry.release_blocking !== "boolean") findings.push(`W71 finding '${id}' must declare release_blocking as a boolean.`);
    if (!Array.isArray(entry.affected_invariants) || entry.affected_invariants.length === 0) findings.push(`W71 finding '${id}' must declare affected_invariants.`);
    if (typeof entry.summary !== "string" || entry.summary.trim().length === 0) findings.push(`W71 finding '${id}' must declare a summary.`);
    if (!Array.isArray(entry.evidence_refs) || entry.evidence_refs.length === 0) findings.push(`W71 finding '${id}' must declare evidence_refs.`);
    for (const evidenceRef of Array.isArray(entry.evidence_refs) ? entry.evidence_refs : []) {
      const fileRef = String(evidenceRef).split("#", 1)[0];
      if (!fileRef || !fileExists(rootDir, fileRef)) findings.push(`W71 finding '${id}' cites missing evidence '${evidenceRef}'.`);
    }
    if (!Array.isArray(entry.limitations)) findings.push(`W71 finding '${id}' must declare limitations.`);
    if (entry.state === "resolved" && (!Array.isArray(entry.evidence_refs) || entry.evidence_refs.length === 0)) {
      findings.push(`Resolved W71 finding '${id}' must cite evidence.`);
    }
  }
  for (const id of EXPECTED_FINDINGS) if (!byId.has(id)) findings.push(`W71 disposition must include ${id}.`);
  for (const id of byId.keys()) if (!EXPECTED_FINDINGS.has(id)) findings.push(`Unexpected W71 finding '${id}' appears in the disposition.`);

  const evidenceRef = disposition.evidence_policy?.integrated_evidence_ref;
  findings.push(...integratedEvidenceFindings(rootDir, evidenceRef)
    .filter(() => currentIntegratedTier === "integrated-local"));

  const storyDowngrades = Array.isArray(disposition.story_downgrades) ? disposition.story_downgrades : [];
  for (const downgrade of storyDowngrades) {
    if (!downgrade?.story_id || !downgrade?.to || !Array.isArray(downgrade.owner_slices) || downgrade.owner_slices.length === 0) {
      findings.push("Every W71 story downgrade must declare story_id, to, and owner_slices.");
    }
  }
  if (findings.length > 0) return fail("Post-W70 W71 audit disposition is incomplete or drifting.", findings, [dispositionPath]);

  const blockingInvariants = entries
    .filter((entry) => entry.release_blocking === true && !CLOSED_STATES.has(entry.state))
    .map((entry) => ({ finding_id: entry.finding_id, state: entry.state, owner_slices: entry.owner_slices, summary: entry.summary }))
    .sort((left, right) => left.finding_id.localeCompare(right.finding_id));
  return {
    ...pass(`W71 disposition is valid with ${blockingInvariants.length} open release-blocking findings.`, [dispositionPath]),
    blocking_invariants: blockingInvariants,
    story_downgrades: storyDowngrades,
  };
}
