import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import {
  W66_QUALIFICATION_CELLS,
  sha256File,
} from "./w66-qualification-manifest.mjs";

const SHA40 = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const REQUIRED_CELL_ARTIFACTS = Object.freeze([
  "run_summary",
  "observation_report",
  "run_health_report",
  "final_assessment",
  "qualification_cell_report",
]);
const REQUIRED_INSTALLED_ARTIFACTS = Object.freeze([
  "run_summary",
  "observation_report",
  "run_health_report",
  "final_assessment",
  "browser_proof",
]);
const POST_QUALIFICATION_PATHS = Object.freeze([
  "README.md",
  "docs/backlog/",
  "docs/ops/production-readiness-gate.md",
  "docs/ops/self-hosted-release.md",
  "docs/research/24-w66-live-qualification-evidence-index.json",
  "docs/research/25-w66-qualification-closure.json",
]);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function pathAllowed(file) {
  return POST_QUALIFICATION_PATHS.some((allowed) =>
    allowed.endsWith("/") ? file.startsWith(allowed) : file === allowed,
  );
}

function listChangedPaths(rootDir, qualificationCommit) {
  const committed = execFileSync(
    "git",
    ["diff", "--name-only", `${qualificationCommit}..HEAD`],
    { cwd: rootDir, encoding: "utf8" },
  );
  const working = execFileSync(
    "git",
    ["status", "--short", "--untracked-files=all"],
    { cwd: rootDir, encoding: "utf8" },
  );
  const paths = new Set(committed.split("\n").filter(Boolean));
  for (const line of working.split("\n").filter(Boolean)) {
    const file = line.slice(3).trim().split(" -> ").at(-1);
    if (file) paths.add(file);
  }
  return [...paths].sort();
}

function validateArtifactDigests(digests, required, owner, findings) {
  if (!digests || typeof digests !== "object" || Array.isArray(digests)) {
    findings.push(`${owner} must provide content-addressed artifact_digests`);
    return;
  }
  for (const artifact of required) {
    if (!SHA256.test(digests[artifact] ?? "")) {
      findings.push(`${owner} artifact '${artifact}' must use a SHA-256 digest`);
    }
  }
  for (const key of Object.keys(digests)) {
    if (!required.includes(key)) findings.push(`${owner} has unexpected artifact digest '${key}'`);
  }
}

function validatePathNeutral(document, owner, findings) {
  const serialized = JSON.stringify(document);
  for (const forbidden of ["/var/folders/", "/private/var/", "/tmp/", "\".aor/"]) {
    if (serialized.includes(forbidden)) findings.push(`${owner} must not contain runtime-local path '${forbidden}'`);
  }
}

export function checkW66QualificationClosure({
  rootDir,
  closureReportPath,
  evidenceIndexPath,
}) {
  const closureFile = path.resolve(rootDir, closureReportPath);
  const indexFile = path.resolve(rootDir, evidenceIndexPath);
  const findings = [];
  let closure;
  let index;
  try {
    closure = readJson(closureFile);
    index = readJson(indexFile);
  } catch (error) {
    return {
      id: "w66-qualification-closure",
      status: "fail",
      qualified: false,
      summary: "W66 qualification closure evidence is missing or invalid.",
      findings: [error.message],
      evidence: [closureReportPath, evidenceIndexPath],
    };
  }

  if (
    closure.schema_version !== 1 ||
    closure.kind !== "w66-qualification-closure" ||
    closure.wave !== "W66"
  ) {
    findings.push("closure report must use the W66 qualification closure v1 contract");
  }
  if (
    index.schema_version !== 1 ||
    index.kind !== "w66-live-qualification-evidence-index" ||
    index.path_policy !== "path-neutral-content-addressed"
  ) {
    findings.push("evidence index must use the path-neutral W66 evidence-index v1 contract");
  }
  if (closure.evidence_index !== evidenceIndexPath) findings.push("closure report points to the wrong evidence index");
  if (closure.target_commit !== index.target_commit || !SHA40.test(closure.target_commit ?? "")) {
    findings.push("closure and evidence index must use one full pinned target commit");
  }
  validatePathNeutral(closure, "closure report", findings);
  validatePathNeutral(index, "evidence index", findings);

  const expectedCells = new Map(W66_QUALIFICATION_CELLS);
  const cells = Array.isArray(index.cells) ? index.cells : [];
  if (cells.length !== expectedCells.size) findings.push("evidence index must contain exactly four required cells");
  const seen = new Set();
  for (const cell of cells) {
    if (seen.has(cell.cell_id)) findings.push(`duplicate W66 cell '${cell.cell_id}'`);
    seen.add(cell.cell_id);
    if (expectedCells.get(cell.cell_id) !== cell.profile_ref) findings.push(`cell '${cell.cell_id}' uses the wrong profile`);
    const profileFile = path.resolve(rootDir, cell.profile_ref ?? "");
    if (!fs.existsSync(profileFile) || cell.profile_sha256 !== sha256File(profileFile)) {
      findings.push(`cell '${cell.cell_id}' profile digest does not match the closure checkout`);
    }
  }
  for (const cellId of expectedCells.keys()) {
    if (!seen.has(cellId)) findings.push(`required W66 cell '${cellId}' is missing`);
  }

  if (closure.status === "pending" && index.status === "pending") {
    if (
      closure.release_disposition !== "audit-hold" ||
      closure.release_clearance !== false ||
      closure.passing_cell_count !== 0 ||
      closure.same_commit_matrix !== false ||
      closure.no_upstream_write !== false
    ) {
      findings.push("pending W66 closure must preserve the audit hold and zero passing cells");
    }
    if (
      cells.some(
        (cell) =>
          cell.status !== "not-run" ||
          cell.run_id !== null ||
          cell.run_health_status !== "not-run" ||
          cell.production_proof_status !== "not-run" ||
          cell.final_assessment_status !== "not-run" ||
          cell.no_upstream_write_status !== "not-run",
      )
    ) {
      findings.push("pending W66 evidence cells must remain not-run");
    }
    return {
      id: "w66-qualification-closure",
      status: findings.length === 0 ? "pass" : "fail",
      qualified: false,
      summary:
        findings.length === 0
          ? "W66 qualification closure is validly pending under audit hold."
          : "Pending W66 qualification closure evidence is invalid.",
      findings,
      evidence: [closureReportPath, evidenceIndexPath],
    };
  }

  if (closure.status !== "passed" || index.status !== "passed") {
    findings.push("closure report and evidence index statuses must both be pending or passed");
  }
  if (!SHA40.test(closure.qualification_commit ?? "") || closure.qualification_commit !== index.qualification_commit) {
    findings.push("passed closure must bind both documents to one full qualification commit");
  }
  if (
    closure.required_cell_count !== 4 ||
    closure.passing_cell_count !== 4 ||
    closure.same_commit_matrix !== true ||
    closure.installed_baseline_status !== "pass" ||
    closure.final_assessment_policy !== "all-pass" ||
    closure.no_upstream_write !== true ||
    closure.release_disposition !== "cleared" ||
    closure.release_clearance !== true
  ) {
    findings.push("passed closure must record the complete matrix, installed baseline, all-pass policy, no-write proof, and clearance");
  }
  if (
    index.installed_baseline?.status !== "pass" ||
    !index.installed_baseline?.run_id ||
    index.installed_baseline?.commit_sha !== closure.qualification_commit ||
    index.installed_baseline?.ui_ux_status !== "pass" ||
    index.installed_baseline?.accessibility_status !== "pass" ||
    index.installed_baseline?.no_source_write !== true
  ) {
    findings.push("passed evidence index must include one passing installed baseline");
  } else {
    validateArtifactDigests(
      index.installed_baseline.artifact_digests,
      REQUIRED_INSTALLED_ARTIFACTS,
      "installed baseline",
      findings,
    );
  }
  for (const cell of cells) {
    if (
      cell.status !== "pass" ||
      !cell.run_id ||
      cell.commit_sha !== closure.qualification_commit ||
      cell.run_health_status !== "pass" ||
      cell.production_proof_status !== "pass" ||
      cell.final_assessment_status !== "pass" ||
      cell.no_upstream_write_status !== "pass"
    ) {
      findings.push(`cell '${cell.cell_id}' must pass on the qualification commit`);
    }
    validateArtifactDigests(cell.artifact_digests, REQUIRED_CELL_ARTIFACTS, `cell '${cell.cell_id}'`, findings);
  }

  if (SHA40.test(closure.qualification_commit ?? "")) {
    try {
      execFileSync("git", ["merge-base", "--is-ancestor", closure.qualification_commit, "HEAD"], {
        cwd: rootDir,
        stdio: "ignore",
      });
      const changedPaths = listChangedPaths(rootDir, closure.qualification_commit);
      const invalidPaths = changedPaths.filter((file) => !pathAllowed(file));
      if (invalidPaths.length > 0) {
        findings.push(`post-qualification changes escape the closure allowlist: ${invalidPaths.join(", ")}`);
      }
    } catch {
      findings.push("qualification commit must be an ancestor of the closure checkout");
    }
  }

  return {
    id: "w66-qualification-closure",
    status: findings.length === 0 ? "pass" : "fail",
    qualified: findings.length === 0,
    summary:
      findings.length === 0
        ? "W66 installed baseline and four-cell same-commit qualification closure passed."
        : "W66 qualification closure evidence is incomplete or drifting.",
    findings,
    evidence: [closureReportPath, evidenceIndexPath],
  };
}
