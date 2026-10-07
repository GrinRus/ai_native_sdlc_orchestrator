import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  checkBidirectionalIndexes,
  checkEvidenceTiers,
  checkPlanningSummary,
  checkReadinessSourceOfTruth,
  checkRuntimeRootGuidance,
} from "../readiness/source-of-truth.mjs";

const root = path.resolve(new URL("../..", import.meta.url).pathname);

function copyDocs(relativePaths) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-source-truth-"));
  for (const relativePath of relativePaths) {
    const source = path.join(root, relativePath);
    const target = path.join(tempRoot, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
  return tempRoot;
}

function copyDirectories(tempRoot, directories) {
  for (const directory of directories) {
    fs.cpSync(path.join(root, directory), path.join(tempRoot, directory), { recursive: true });
  }
}

function copyBacklogFixture(t) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-source-truth-"));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  copyDirectories(tempRoot, ["docs/backlog"]);
  return tempRoot;
}

test("source-of-truth checks report current W72 planning and retain W71 evidence", () => {
  const result = checkReadinessSourceOfTruth(root);
  assert.equal(result.status, "pass");
  assert.equal(result.planning_report.wave_id, "W72");
  assert.equal(result.planning_report.latest_wave, "W72");
  assert.equal(result.planning_report.slice_count, 21);
  assert.ok(result.evidence.includes("docs/backlog/w71-planning-readiness.json"));
  assert.ok(result.evidence.includes("docs/backlog/w72-planning-readiness.json"));
  assert.equal(result.evidence_tier_report.story_count, 116);
  assert.ok(result.index_report.every((report) => report.missing.length === 0 && report.dangling.length === 0));
});

test("historical W71 planning summary remains checked after W72 registration", (t) => {
  const tempRoot = copyBacklogFixture(t);
  const summaryPath = path.join(tempRoot, "docs/backlog/w71-planning-readiness.json");
  const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
  summary.status_counts.done += 1;
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary)}\n`);
  assert.match(checkPlanningSummary(tempRoot).findings.join("\n"), /status count for done/u);
});

test("current planning summary rejects false completed work", (t) => {
  const tempRoot = copyBacklogFixture(t);
  const summaryPath = path.join(tempRoot, "docs/backlog/w72-planning-readiness.json");
  const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
  summary.status_counts.done += 1;
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary)}\n`);
  assert.match(checkPlanningSummary(tempRoot).findings.join("\n"), /w72-planning-readiness\.json status count for done/u);
});

test("missing current planning summary fails even with a valid W71 snapshot", (t) => {
  const tempRoot = copyBacklogFixture(t);
  fs.unlinkSync(path.join(tempRoot, "docs/backlog/w72-planning-readiness.json"));
  assert.match(checkPlanningSummary(tempRoot).findings.join("\n"), /w72-planning-readiness\.json is missing/u);
});

test("current planning summary rejects a stale wave identity", (t) => {
  const tempRoot = copyBacklogFixture(t);
  const summaryPath = path.join(tempRoot, "docs/backlog/w72-planning-readiness.json");
  const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
  summary.latest_wave = "W71";
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary)}\n`);
  assert.match(checkPlanningSummary(tempRoot).findings.join("\n"), /snapshot latest_wave=W72/u);
});

test("current roadmap count must match its actual registered slices", (t) => {
  const tempRoot = copyBacklogFixture(t);
  const roadmapPath = path.join(tempRoot, "docs/backlog/mvp-roadmap.md");
  const roadmap = fs.readFileSync(roadmapPath, "utf8").replace(
    /^(\| W72 \|[^\n]*\|) 21 \|/mu,
    "$1 20 |",
  );
  fs.writeFileSync(roadmapPath, roadmap);
  assert.match(checkPlanningSummary(tempRoot).findings.join("\n"), /Roadmap W72 row must declare 21 slices/u);
});

test("bidirectional index check rejects an unindexed public contract", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-source-truth-"));
  copyDirectories(tempRoot, ["docs/contracts", "docs/ops"]);
  const contractDir = path.join(tempRoot, "docs/contracts");
  fs.writeFileSync(path.join(contractDir, "unindexed-contract.md"), "# test\n");
  const result = checkBidirectionalIndexes(tempRoot);
  assert.ok(result.findings.some((finding) => finding.includes("unindexed-contract.md")));
});

test("story evidence tiers reject promotion of an audited story", () => {
  const tempRoot = copyDocs(["docs/product/story-evidence-tiers.json", "docs/product/user-story-coverage-matrix.md"]);
  const matrixPath = path.join(tempRoot, "docs/product/user-story-coverage-matrix.md");
  const matrix = fs.readFileSync(matrixPath, "utf8").replace(
    /^\| PBO-10 \|([^|]+\|[^|]+\|[^|]+\|) partial \|/mu,
    "| PBO-10 |$1 proof-covered |",
  );
  fs.writeFileSync(matrixPath, matrix);
  const result = checkEvidenceTiers(tempRoot);
  assert.ok(result.findings.some((finding) => finding.includes("PBO-10 has status 'proof-covered'")));
});

test("runtime-root guidance rejects an unlabeled target-local runtime path", () => {
  const files = [
    "README.md",
    "docs/architecture/12-orchestrator-operating-model.md",
    "docs/contracts/project-profile.md",
    "docs/ops/installed-user-first-run.md",
    "docs/ops/local-workspace-registry.md",
    "docs/ops/project-topology-onboarding.md",
    "docs/ops/self-hosted-backup-restore.md",
    "docs/ops/self-hosted-release.md",
  ];
  const tempRoot = copyDocs(files);
  const target = path.join(tempRoot, "docs/ops/installed-user-first-run.md");
  fs.appendFileSync(target, "\nRuntime outputs stay under target-repo `.aor/` for convenience.\n");
  const findings = checkRuntimeRootGuidance(tempRoot);
  assert.ok(findings.some((finding) => finding.includes("target-local .aor")));
});
