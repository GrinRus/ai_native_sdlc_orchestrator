import { createHash } from "node:crypto";
import fs from "node:fs";

export const W66_QUALIFICATION_CELLS = Object.freeze([
  ["openai-primary.medium", "scripts/live-e2e/profiles/full-journey-regress-ky-medium-codex.yaml"],
  ["openai-primary.large", "scripts/live-e2e/profiles/full-journey-governance-ky-large-codex.yaml"],
  ["anthropic-primary.medium", "scripts/live-e2e/profiles/full-journey-regress-ky-medium-anthropic.yaml"],
  ["anthropic-primary.large", "scripts/live-e2e/profiles/full-journey-governance-ky-large-anthropic.yaml"],
]);

export function sha256File(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

export function validateW66QualificationManifest(document, options = {}) {
  const findings = [];
  if (document?.schema_version !== 1 || document?.kind !== "w66-qualification-manifest") {
    findings.push("manifest must use schema_version=1 and kind=w66-qualification-manifest");
  }
  if (!/^[a-f0-9]{40}$/u.test(document?.aor_commit ?? "")) findings.push("aor_commit must be a full commit SHA");
  if (!/^[a-f0-9]{40}$/u.test(document?.target_commit ?? "")) findings.push("target_commit must be a full commit SHA");
  if (document?.source_tree_clean !== true) findings.push("qualification requires a clean AOR source tree");
  if (document?.release_clearance !== "audit-hold") findings.push("S08 manifest must preserve release_clearance=audit-hold");
  if (document?.network_policy !== "provider-calls-prohibited") findings.push("S08 manifest must prohibit provider calls");
  if (document?.write_policy !== "no-upstream-write") findings.push("manifest must preserve no-upstream-write policy");
  if (document?.invalidate_on_source_change !== true) findings.push("manifest must invalidate on any source change");

  const expectedCells = new Map(W66_QUALIFICATION_CELLS);
  const cells = Array.isArray(document?.cells) ? document.cells : [];
  if (cells.length !== expectedCells.size) findings.push("manifest must contain exactly four W66 provider cells");
  const seen = new Set();
  for (const cell of cells) {
    if (seen.has(cell.cell_id)) findings.push(`duplicate qualification cell '${cell.cell_id}'`);
    seen.add(cell.cell_id);
    if (expectedCells.get(cell.cell_id) !== cell.profile_ref) findings.push(`qualification cell '${cell.cell_id}' uses the wrong profile`);
    if (!/^[a-f0-9]{64}$/u.test(cell.profile_sha256 ?? "")) findings.push(`qualification cell '${cell.cell_id}' lacks a profile digest`);
    if (cell.status !== "not-run") findings.push(`S08 qualification cell '${cell.cell_id}' must remain not-run`);
  }
  for (const cellId of expectedCells.keys()) if (!seen.has(cellId)) findings.push(`qualification cell '${cellId}' is missing`);

  if (options.aorCommit && document?.aor_commit !== options.aorCommit) findings.push("manifest AOR commit does not match current HEAD");
  if (options.targetCommit && document?.target_commit !== options.targetCommit) findings.push("manifest target commit does not match the pinned target");
  if (options.profileDigests) {
    for (const cell of cells) {
      if (options.profileDigests[cell.profile_ref] !== cell.profile_sha256) {
        findings.push(`qualification profile '${cell.profile_ref}' changed after freeze`);
      }
    }
  }
  const proof = document?.adversarial_proof;
  if (options.requireAdversarialProof && (!proof || proof.status !== "pass")) {
    findings.push("S25 replacement manifest must bind a passing adversarial proof");
  }
  if (proof) {
    if (proof.status !== "pass") findings.push("adversarial proof must have status=pass");
    if (proof.source_commit !== document?.aor_commit) findings.push("adversarial proof must bind the frozen AOR commit");
    if (!/^sha256:[a-f0-9]{64}$/u.test(proof.sha256 ?? "")) findings.push("adversarial proof must include a content digest");
    if (proof.historical_evidence_disposition !== "diagnostic-only") findings.push("pre-S20 evidence must remain diagnostic-only");
    if (proof.fresh_qualification_required !== true) findings.push("replacement manifest must require a fresh qualification matrix");
  }
  return { ok: findings.length === 0, findings };
}

export function validateW66FindingLedger(document) {
  const findings = [];
  if (document?.schema_version !== 1 || document?.wave !== "W66" || document?.closure_status !== "pass") {
    findings.push("W66 finding ledger must declare schema_version=1, wave=W66, and closure_status=pass");
  }
  const entries = Array.isArray(document?.findings) ? document.findings : [];
  const expected = new Set(["W66-001", "W66-002", "W66-003", "W66-004", "W66-005", "W66-006", "W66-007"]);
  const seen = new Set();
  for (const entry of entries) {
    if (!expected.has(entry.finding_id)) findings.push(`unexpected W66 finding '${entry.finding_id}'`);
    if (seen.has(entry.finding_id)) findings.push(`duplicate W66 finding '${entry.finding_id}'`);
    seen.add(entry.finding_id);
    if (!["P0", "P1"].includes(entry.severity)) findings.push(`finding '${entry.finding_id}' lacks blocking severity`);
    if (entry.status !== "resolved") findings.push(`finding '${entry.finding_id}' is unresolved`);
    if (!entry.owner || !entry.reproduction || !Array.isArray(entry.evidence) || entry.evidence.length === 0) {
      findings.push(`finding '${entry.finding_id}' lacks owner, reproduction, or focused evidence`);
    }
    if (!entry.residual_limitation) findings.push(`finding '${entry.finding_id}' lacks a residual limitation`);
  }
  for (const findingId of expected) if (!seen.has(findingId)) findings.push(`W66 finding '${findingId}' is missing`);
  if (document?.open_p0_count !== 0 || document?.open_p1_count !== 0) {
    findings.push("W66 finding ledger must have zero open P0/P1 findings");
  }
  return { ok: findings.length === 0, findings };
}
