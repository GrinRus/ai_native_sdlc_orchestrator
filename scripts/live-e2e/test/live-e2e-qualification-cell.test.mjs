import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { validateContractDocument } from "../lib/contracts/index.mjs";
import {
  REQUIRED_QUALIFICATION_CELLS,
  buildQualificationCellReport,
  evaluateQualificationMatrix,
} from "../lib/qualification-cell.mjs";
import { readYamlDocument } from "../lib/common.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const fixtureFile = path.join(
  repoRoot,
  "scripts/live-e2e/fixtures/contracts/live-e2e-qualification-cell-report.sample.yaml",
);

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "aor-qualification-cell-"));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  return file;
}

test("qualification cell v1 fixture validates and rejects incompatible or contradictory wire shapes", () => {
  const fixture = readYamlDocument(fixtureFile);
  assert.equal(validateContractDocument({
    family: "live-e2e-qualification-cell-report",
    document: fixture,
    source: fixtureFile,
  }).ok, true);

  for (const mutation of [
    { ...fixture, schema_version: 2 },
    { ...fixture, cell_id: "openai-primary.large" },
    {
      ...fixture,
      evidence: [{ ...fixture.evidence[0], digest: "sha256:not-a-digest" }],
    },
    {
      ...fixture,
      evidence: [{ ...fixture.evidence[0], run_id: "wrong-run" }],
    },
    {
      ...fixture,
      evidence: [{ ...fixture.evidence[0], generated_at: "2026-07-27T00:00:00.000Z" }],
    },
    {
      ...fixture,
      dimensions: {
        ...fixture.dimensions,
        diagnostic_verification: { status: "warn", evidence_refs: [] },
      },
    },
  ]) {
    assert.equal(validateContractDocument({
      family: "live-e2e-qualification-cell-report",
      document: mutation,
      source: "<mutation>",
    }).ok, false);
  }
});

test("qualification cell blocks missing final assessment and partial diagnostic verification", () => {
  const root = tempDir();
  try {
    const runId = "live-e2e.test.openai.medium";
    const evidenceTime = new Date(Date.now() - 60_000).toISOString();
    const observationFile = writeJson(path.join(root, "observation.json"), {
      run_id: runId,
      report_status: "complete",
      final_analysis: { status: "pass" },
      generated_at: evidenceTime,
    });
    const runHealthFile = writeJson(path.join(root, "run-health.json"), {
      run_id: runId,
      overall_status: "pass",
      generated_at: evidenceTime,
    });
    const summaryFile = writeJson(path.join(root, "summary.json"), {
      run_id: runId,
      provider_variant_id: "openai-primary",
      feature_size: "medium",
      commit_sha: "0123456789abcdef0123456789abcdef01234567",
      status: "pass",
      live_e2e_observation_report_file: observationFile,
      live_e2e_run_health_report_file: runHealthFile,
      post_run_verify_status: "pass",
      post_run_diagnostic_status: "warn",
      meaningful_changed_paths: ["source/index.ts"],
      delivery_manifest_file: path.join(root, "delivery.json"),
      production_proof: {
        real_code_change_proof_complete: true,
        delivery_integrity: { status: "pass" },
      },
      no_upstream_write_assertion: {
        status: "pass",
        target_head_unchanged: true,
        commit_refs: [],
      },
    });
    const built = buildQualificationCellReport({ summaryFile });
    assert.equal(built.validation.ok, true, JSON.stringify(built.validation.issues, null, 2));
    assert.equal(built.report.status, "blocked");
    assert.equal(built.report.dimensions.final_assessment.status, "blocked");
    assert.equal(built.report.dimensions.diagnostic_verification.status, "blocked");
    assert.equal(built.report.positive_evidence.some((entry) => entry.summary.includes("run_health")), true);
    assert.equal(built.report.blocking_findings.some((entry) => entry.code.includes("final_assessment")), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("required qualification matrix is exactly Codex and Anthropic medium/large cells on one commit", () => {
  assert.deepEqual(
    REQUIRED_QUALIFICATION_CELLS.map((entry) => entry.cell_id),
    [
      "openai-primary.medium",
      "openai-primary.large",
      "anthropic-primary.medium",
      "anthropic-primary.large",
    ],
  );
  const commit = "abcdef0123456789abcdef0123456789abcdef01";
  const reports = REQUIRED_QUALIFICATION_CELLS.map((cell, index) => ({
    ...cell,
    run_id: `run-${index + 1}`,
    commit_sha: commit,
    status: "pass",
  }));
  assert.equal(evaluateQualificationMatrix(reports).status, "pass");
  assert.equal(evaluateQualificationMatrix([...reports, {
    cell_id: "open-code-primary.medium",
    commit_sha: commit,
    status: "blocked",
  }]).status, "pass");
  assert.equal(evaluateQualificationMatrix(reports.slice(1)).status, "blocked");
  assert.equal(evaluateQualificationMatrix([
    reports[0],
    { ...reports[1], commit_sha: "1111111111111111111111111111111111111111" },
  ]).status, "blocked");
});

test("qualification loop cannot record a historical pass summary without final assessment", () => {
  const root = tempDir();
  try {
    const runId = "live-e2e.test.historical-pass";
    const commitSha = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).stdout.trim();
    const branchName = spawnSync("git", ["branch", "--show-current"], { cwd: repoRoot, encoding: "utf8" }).stdout.trim();
    const observationFile = writeJson(path.join(root, "observation.json"), {
      run_id: runId,
      report_status: "complete",
      final_analysis: { status: "pass" },
    });
    const runHealthFile = writeJson(path.join(root, "run-health.json"), {
      run_id: runId,
      overall_status: "pass",
    });
    const summaryFile = writeJson(path.join(root, "summary.json"), {
      run_id: runId,
      profile_id: "live-e2e.full-journey.regress.ky.medium.codex",
      target_catalog_id: "ky",
      feature_mission_id: "ky-fetch-options-regression",
      scenario_family: "regress",
      provider_variant_id: "openai-primary",
      feature_size: "medium",
      commit_sha: commitSha,
      branch_name: branchName,
      status: "pass",
      live_e2e_observation_report_file: observationFile,
      live_e2e_run_health_report_file: runHealthFile,
      post_run_verify_status: "pass",
      post_run_diagnostic_status: "pass",
      meaningful_changed_paths: ["source/index.ts"],
      production_proof: {
        real_code_change_proof_complete: true,
        delivery_integrity: { status: "pass" },
      },
      no_upstream_write_assertion: { status: "pass", target_head_unchanged: true, commit_refs: [] },
    });
    const result = spawnSync(process.execPath, [
      path.join(repoRoot, "scripts/live-e2e/qualification-loop.mjs"),
      "--project-ref",
      repoRoot,
      "--profile",
      path.join(repoRoot, "scripts/live-e2e/profiles/full-journey-regress-ky-medium-codex.yaml"),
      "--record-run-summary-file",
      summaryFile,
    ], { cwd: repoRoot, encoding: "utf8" });
    assert.equal(result.status, 3, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, "blocked");
    const cell = JSON.parse(fs.readFileSync(output.qualification_cell_report_file, "utf8"));
    assert.equal(cell.dimensions.final_assessment.status, "blocked");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
