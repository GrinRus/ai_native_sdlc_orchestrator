import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateContractDocument } from "../../contracts/src/index.mjs";
import { materializeIntakeArtifactPacket } from "../src/artifact-store.mjs";
import { initializeProjectRuntime } from "../src/project-init.mjs";
import { executeRuntimeHarnessRun } from "../src/runtime-harness-controller.mjs";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const workspaceRoot = path.resolve(currentDir, "../../..");
const fixturesDir = path.join(currentDir, "fixtures");

/**
 * @param {(repoRoot: string) => void} callback
 */
function withTempRepo(callback) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-w24-s01-"));
  const gitInit = spawnSync("git", ["init"], { cwd: repoRoot, encoding: "utf8" });
  assert.equal(gitInit.status, 0, gitInit.stderr || gitInit.stdout);
  fs.cpSync(path.join(workspaceRoot, "examples"), path.join(repoRoot, "examples"), { recursive: true });

  try {
    callback(repoRoot);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
}

/**
 * @param {string} repoRoot
 * @param {string[]} args
 */
function configureCodexExternalRuntime(repoRoot, args) {
  const adapterPath = path.join(repoRoot, "examples/adapters/codex-cli.yaml");
  const source = fs.readFileSync(adapterPath, "utf8");
  const executionBlock = [
    "execution:",
    "  live_baseline: true",
    "  runtime_mode: external-process",
    "  handler: codex-cli-external-runner",
    "  evidence_namespace: evidence://adapter-live/codex-cli",
    "  external_runtime:",
    `    command: ${JSON.stringify(process.execPath)}`,
    "    permission_policy:",
    "      default_mode: full-bypass",
    "      modes:",
    "        full-bypass:",
    "          args:",
    ...args.map((argument) => `            - ${JSON.stringify(argument)}`),
    "    request_via_stdin: true",
    "    timeout_ms: 30000",
  ].join("\n");
  const updated = source.replace(/execution:\n[\s\S]*?\nsandbox_mode:/u, `${executionBlock}\nsandbox_mode:`);
  fs.writeFileSync(adapterPath, updated, "utf8");
}

/**
 * @param {string} repoRoot
 * @param {string} runId
 */
function executeController(repoRoot, runId) {
  return executeRuntimeHarnessRun({
    projectRef: repoRoot,
    cwd: repoRoot,
    stepClass: "implement",
    dryRun: false,
    runId,
    stepId: "run.start.implement",
    approvedHandoffRef: `evidence://handoff/${runId}`,
    promotionEvidenceRefs: [`evidence://promotion/${runId}`],
    executionRoot: repoRoot,
  });
}

test("run-level Runtime Harness controller closes a pass flow with run decision evidence", () => {
  withTempRepo((repoRoot) => {
    configureCodexExternalRuntime(repoRoot, [
      "-e",
      [
        "const fs=require('node:fs');",
        "const path=require('node:path');",
        "fs.mkdirSync('src',{recursive:true});",
        "fs.writeFileSync(path.join('src','implemented.js'),'export const implemented = true;\\n');",
        "process.stdout.write(JSON.stringify({summary:'pass',output:{result:'pass'},evidence_refs:['evidence://runner/pass']}));",
      ].join(""),
    ]);

    const result = executeController(repoRoot, "runtime-harness-run-pass");

    assert.equal(result.runController.runDecision.terminal_status, "closed");
    assert.equal(result.runController.runDecision.overall_decision, "pass");
    assert.equal(result.runtimeHarness.report.run_controller.status, "closed");
    assert.equal(result.runtimeHarness.report.run_decision.overall_decision, "pass");
    assert.equal(result.runtimeHarness.report.run_transitions.at(-1).stage, "close");
    assert.equal(result.runtimeHarness.report.step_decisions.at(-1).runtime_harness_decision, "pass");
  });
});

test("run-level Runtime Harness controller blocks interactive continuation evidence", () => {
  withTempRepo((repoRoot) => {
    configureCodexExternalRuntime(repoRoot, [
      "-e",
      [
        "process.stdout.write(JSON.stringify({",
        "summary:'needs input',",
        "output:{message:'requires user input before continuing'},",
        "evidence_refs:['evidence://runner/interactive']",
        "}));",
      ].join(""),
    ]);

    const result = executeController(repoRoot, "runtime-harness-run-block");

    assert.equal(result.stepResult.failure_class, "interactive-question-requested");
    assert.equal(result.runController.runDecision.terminal_status, "blocked");
    assert.equal(result.runController.runDecision.overall_decision, "block");
    assert.equal(result.runtimeHarness.report.run_controller.status, "blocked");
    assert.equal(result.runtimeHarness.report.run_transitions.at(-1).stage, "block");
  });
});

test("run-level Runtime Harness controller does not fail run-level closure by path alone", () => {
  withTempRepo((repoRoot) => {
    const init = initializeProjectRuntime({ projectRef: repoRoot, cwd: repoRoot });
    const requestFile = path.join(repoRoot, "feature-request.json");
    fs.writeFileSync(
      requestFile,
      `${JSON.stringify({ goals: ["Implement a result-quality proof change."] }, null, 2)}\n`,
      "utf8",
    );
    materializeIntakeArtifactPacket({
      projectId: init.projectId,
      projectRoot: init.projectRoot,
      projectProfileRef: init.projectProfileRef,
      runtimeLayout: init.runtimeLayout,
      command: "aor intake create",
      missionId: "controller-path-only-quality",
      requestFile,
    });
    configureCodexExternalRuntime(repoRoot, [
      "-e",
      [
        "const fs=require('node:fs');",
        "fs.mkdirSync('docs',{recursive:true});",
        "fs.writeFileSync('docs/out-of-scope.md','forbidden change\\n');",
        "process.stdout.write(JSON.stringify({summary:'docs change',output:{result:'docs-change'},evidence_refs:['evidence://runner/docs-change']}));",
      ].join(""),
    ]);

    const result = executeController(repoRoot, "runtime-harness-run-path-quality");

    assert.equal(result.stepResult.failure_class, "none");
    assert.equal(result.stepResult.runtime_harness_decision, "pass");
    assert.equal(result.runController.runDecision.terminal_status, "closed");
    assert.equal(result.runController.runDecision.overall_decision, "pass");
    assert.equal(result.runtimeHarness.report.overall_decision, "pass");
    assert.equal(result.runtimeHarness.report.run_controller.status, "closed");
    assert.deepEqual(result.stepResult.mission_semantics.meaningful_changed_paths, ["docs/out-of-scope.md"]);
  });
});

test("run-level Runtime Harness controller records repair flow ownership", () => {
  withTempRepo((repoRoot) => {
    configureCodexExternalRuntime(repoRoot, [
      "-e",
      [
        "const fs=require('node:fs');",
        "const path=require('node:path');",
        "const input=JSON.parse(fs.readFileSync(0,'utf8'));",
        "const request=input.request||{};",
        "if(request.step_class==='repair'){fs.mkdirSync('src',{recursive:true});fs.writeFileSync(path.join('src','repaired.js'),'export const repaired = true;\\n');}",
        "process.stdout.write(JSON.stringify({summary:'repair pass',output:{step_class:request.step_class},evidence_refs:['evidence://runner/repair-pass']}));",
      ].join(""),
    ]);

    const result = executeController(repoRoot, "runtime-harness-run-repair");

    assert.equal(result.stepResult.repair_status, "succeeded_after_repair");
    assert.equal(result.runController.runDecision.terminal_status, "closed");
    assert.equal(result.runtimeHarness.report.run_transitions.some((transition) => transition.stage === "repair"), true);
    assert.equal(result.runtimeHarness.report.run_decision.overall_decision, "pass");
  });
});

test("run-level Runtime Harness controller records exhausted-repair ownership", () => {
  withTempRepo((repoRoot) => {
    configureCodexExternalRuntime(repoRoot, [
      "-e",
      [
        "process.stdout.write(JSON.stringify({",
        "summary:'noop',",
        "output:{result:'noop'},",
        "evidence_refs:['evidence://runner/noop']",
        "}));",
      ].join(""),
    ]);

    const result = executeController(repoRoot, "runtime-harness-run-exhausted");

    assert.equal(result.stepResult.repair_status, "exhausted");
    assert.equal(result.runController.runDecision.terminal_status, "blocked");
    assert.equal(result.runController.runDecision.overall_decision, "block");
    assert.equal(result.runtimeHarness.report.run_decision.repair_status, "exhausted");
    assert.equal(result.runtimeHarness.report.run_transitions.some((transition) => transition.stage === "repair"), true);
  });
});

test("run-level Runtime Harness controller fixture validates against the report contract", () => {
  const fixture = JSON.parse(
    fs.readFileSync(path.join(fixturesDir, "runtime-harness-controller-report.fixture.json"), "utf8"),
  );
  const validation = validateContractDocument({
    family: "runtime-harness-report",
    document: fixture,
    source: "fixture://runtime-harness-controller-report",
  });
  assert.equal(validation.ok, true, validation.issues.map((issue) => issue.message).join("; "));
});
