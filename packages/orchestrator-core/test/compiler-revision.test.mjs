import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadContractFile, validateContractDocument } from "../../contracts/src/index.mjs";
import {
  materializeCompilerRevisionStatus,
  parseCompilerRevisionRef,
} from "../src/compiler-revision.mjs";
import { initializeProjectRuntime } from "../src/project-init.mjs";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const workspaceRoot = path.resolve(currentDir, "../../..");

/**
 * @param {(repoRoot: string) => void} callback
 */
function withTempRepo(callback) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-w20-s04-"));
  fs.mkdirSync(path.join(repoRoot, ".git"), { recursive: true });
  fs.cpSync(path.join(workspaceRoot, "examples"), path.join(repoRoot, "examples"), { recursive: true });

  try {
    callback(repoRoot);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
}

/**
 * @param {ReturnType<typeof initializeProjectRuntime>} init
 * @param {string} filePath
 * @returns {string}
 */
function toEvidenceRef(init, filePath) {
  return `evidence://${path.relative(init.projectRoot, filePath).replace(/\\/gu, "/")}`;
}

/**
 * @param {{ family: import("../../contracts/src/index.d.ts").ContractFamily, filePath: string, document: Record<string, unknown> }} options
 */
function writeContractFile(options) {
  const validation = validateContractDocument({
    family: options.family,
    document: options.document,
    source: `fixture://${options.family}`,
  });
  assert.equal(validation.ok, true, `${options.family} fixture must pass contract validation`);
  fs.writeFileSync(options.filePath, `${JSON.stringify(options.document, null, 2)}\n`, "utf8");
}

test("parseCompilerRevisionRef normalizes canonical and legacy compiler refs", () => {
  assert.deepEqual(parseCompilerRevisionRef("compiler://runtime-context-compiler@v1"), {
    compiler_revision_ref: "compiler-revision://runtime-context-compiler@v1",
    source_ref: "compiler://runtime-context-compiler@v1",
    revision_id: "runtime-context-compiler",
    version: 1,
    compiler_family: "runtime-context",
  });
  assert.equal(
    parseCompilerRevisionRef("compiler-revision://policy-compiler-v2").compiler_revision_ref,
    "compiler-revision://policy-compiler@v2",
  );
});

test("materializeCompilerRevisionStatus promotes and freezes with durable decision history", () => {
  withTempRepo((repoRoot) => {
    const init = initializeProjectRuntime({ projectRef: repoRoot, cwd: repoRoot });
    const promotionDecisionPath = path.join(
      init.runtimeLayout.artifactsRoot,
      "promotion-decision-runtime-context-compiler-v1.json",
    );
    writeContractFile({
      family: "promotion-decision",
      filePath: promotionDecisionPath,
      document: {
        decision_id: `${init.projectId}.promotion.runtime-context-compiler.v1`,
        created_at: "2026-05-06T02:00:00.000Z",
        subject_ref: "compiler-revision://runtime-context-compiler@v1",
        from_channel: "candidate",
        to_channel: "stable",
        evidence_refs: ["evidence://reports/evaluation-report-runtime-context-compiler.json"],
        evidence_summary: {
          compiler_revision_lifecycle: {
            compiler_revision_ref: "compiler-revision://runtime-context-compiler@v1",
            lifecycle_state: "stable",
          },
        },
        status: "pass",
      },
    });
    const promotionDecisionRef = toEvidenceRef(init, promotionDecisionPath);

    const promoted = materializeCompilerRevisionStatus({
      projectRef: repoRoot,
      cwd: repoRoot,
      compilerRevisionRef: "compiler-revision://runtime-context-compiler@v1",
      action: "promote",
      promotionDecisionRef,
      compiledContextRefs: ["compiled-context://compiled-context.aor-core.implement.runtime-context-compiler"],
      evaluationRefs: ["evidence://reports/evaluation-report-runtime-context-compiler.json"],
      incidentRefs: ["incident://INC-COMPILER-001"],
      certificationEvidenceRefs: ["evidence://reports/harness-replay-runtime-context-compiler.json"],
      compatibilityStatus: "compatible",
      now: "2026-05-06T02:01:00.000Z",
    });

    assert.equal(fs.existsSync(promoted.statusPath), true);
    const loaded = loadContractFile({
      family: "compiler-revision-status",
      filePath: promoted.statusPath,
    });
    assert.equal(loaded.ok, true);
    assert.equal(promoted.report.lifecycle_state, "stable");
    assert.equal(promoted.report.status, "ready");
    assert.equal(promoted.report.compatibility.status, "compatible");
    assert.deepEqual(promoted.report.evidence_links.incident_refs, ["incident://INC-COMPILER-001"]);
    assert.ok(promoted.report.decision_history.some((entry) => entry.history_kind === "promotion-decision"));

    const frozen = materializeCompilerRevisionStatus({
      projectRef: repoRoot,
      cwd: repoRoot,
      compilerRevisionRef: "compiler://runtime-context-compiler@v1",
      action: "freeze",
      promotionDecisionRef,
      compatibilityStatus: "compatible",
      now: "2026-05-06T02:02:00.000Z",
    });

    assert.equal(frozen.report.compiler_revision_ref, "compiler-revision://runtime-context-compiler@v1");
    assert.equal(frozen.report.lifecycle_state, "frozen");
    assert.equal(frozen.report.status, "ready");
    assert.ok(frozen.report.decision_history.some((entry) => entry.history_kind === "compiler-revision-status"));
  });
});

test("materializeCompilerRevisionStatus blocks state changes without decision evidence", () => {
  withTempRepo((repoRoot) => {
    const result = materializeCompilerRevisionStatus({
      projectRef: repoRoot,
      cwd: repoRoot,
      compilerRevisionRef: "compiler-revision://runtime-context-compiler@v2",
      action: "demote",
      compatibilityStatus: "incompatible",
      now: "2026-05-06T02:03:00.000Z",
    });

    assert.equal(result.blocking, true);
    assert.equal(result.report.status, "blocked");
    assert.equal(result.report.lifecycle_state, "blocked");
    assert.deepEqual(result.report.blocking_reasons, [
      "promotion-decision-required",
      "compiler-revision-incompatible",
    ]);
    assert.equal(fs.existsSync(result.statusPath), true);
  });
});
